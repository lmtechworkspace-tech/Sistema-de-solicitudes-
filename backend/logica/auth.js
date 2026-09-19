'use strict';

/**
 * auth.js — puerto de Auth.gs (RF-019, CU-007, §8.7): gestión de la tabla
 * USUARIOS (cuentas de staff identificadas, en el .gs, por sesión de
 * Google). Solo Administrador. Esto NO es login -- la identidad en Node
 * sigue resolviéndose de `portal_token`/CUENTAS_PORTAL (router.js no
 * resuelve sesión de Google todavía, ver su propia cabecera), así que en
 * la práctica gestiona esta tabla cualquier cuenta de PORTAL con
 * `contexto.rol === 'ADM'` -- mismo campo, misma normalización de rol, que
 * ya usa el resto del backend (`resolverContextoPortal_`).
 *
 * Gate de MODULO ('administracion' en MODULO_POR_ACCION del .gs): NO se
 * porta, mismo criterio ya documentado para Fase 3b (inicio.js) --
 * `MODULO_POR_ACCION` no existe en Node en ningún lado. La protección real
 * de estas dos acciones es el chequeo de rol, que SÍ se porta íntegro.
 *
 * suspenderInactivos (A-11, RN-029) es solo-trigger en el .gs (corre
 * semanalmente vía Triggers.gs, ningún cliente la llama) -- se porta la
 * LÓGICA acá para cuando exista un mecanismo de cron en el VPS (mismo
 * criterio que backend/scripts/backup-db.js), pero NO se expone como
 * acción de router.js: eso abriría una superficie que el .gs nunca tuvo
 * (un cliente disparando suspensiones masivas a demanda).
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion } = require('./errores');

const DIAS_INACTIVIDAD_SUSPENSION = 90;

function esActivo_(usuario) {
  return usuario.activo === true || usuario.activo === 'TRUE' || usuario.activo === 1;
}
function buscarUsuarioPorEmail_(db, email) {
  return leerFilas_(db, 'USUARIOS', COLUMNAS.USUARIOS).find((u) => u.email === email) || null;
}

function gestionarUsuario(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') {
    return { _forbidden: true, message: 'Solo un Administrador puede gestionar usuarios.' };
  }
  if (!data || !data.email) {
    return errorValidacion('email', 'Falta el email del usuario.');
  }

  const usuarioExistente = buscarUsuarioPorEmail_(db, data.email);

  // RN-030: no puede quedar una empresa con menos de 2 Administradores
  // activos. Se valida antes de desactivar o de cambiar el rol de un Admin
  // a otro rol.
  const vaAQuedarSinRolAdmin = usuarioExistente && usuarioExistente.rol === 'ADM' &&
    (data.activo === false || (data.rol && data.rol !== 'ADM'));
  if (vaAQuedarSinRolAdmin) {
    const otrosAdminsActivos = leerFilas_(db, 'USUARIOS', COLUMNAS.USUARIOS).filter((u) =>
      u.empresa_id === usuarioExistente.empresa_id && u.rol === 'ADM' &&
      u.email !== data.email && esActivo_(u)
    );
    if (otrosAdminsActivos.length < 1) {
      return errorValidacion('rol',
        'No se puede aplicar: quedaría menos de 2 Administradores activos en ' +
        usuarioExistente.empresa_id + ' (RN-030).');
    }
  }

  const cambios = {};
  if (data.nombre !== undefined) cambios.nombre = data.nombre;
  if (data.rol !== undefined) cambios.rol = data.rol;
  if (data.activo !== undefined) cambios.activo = data.activo;
  if (data.empresa_id !== undefined) cambios.empresa_id = data.empresa_id;

  if (usuarioExistente) {
    return actualizarFilaPorId_(db, 'USUARIOS', 'email', data.email, cambios);
  }

  // RN-031: un usuario pertenece a una sola empresa (ya lo garantiza el
  // esquema: una fila = un email = un empresa_id).
  if (!data.empresa_id) {
    return errorValidacion('empresa_id', 'Falta la empresa para crear el usuario.');
  }
  const nuevoUsuario = {
    usuario_id: crypto.randomUUID(),
    nombre: data.nombre || '',
    email: data.email,
    empresa_id: data.empresa_id,
    rol: data.rol || 'ANA',
    activo: data.activo !== undefined ? data.activo : true,
    ultimo_acceso: '',
    creado_por: contexto.email
  };
  agregarFila_(db, 'USUARIOS', nuevoUsuario);
  return nuevoUsuario;
}

function listarUsuarios(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') {
    return { _forbidden: true, message: 'Solo un Administrador puede ver la lista de usuarios.' };
  }
  return leerFilas_(db, 'USUARIOS', COLUMNAS.USUARIOS);
}

// A-11 (RN-029): NO expuesta como acción de router.js -- ver la cabecera.
function suspenderInactivos(db) {
  const ahora = Date.now();
  const suspendidos = [];
  leerFilas_(db, 'USUARIOS', COLUMNAS.USUARIOS).forEach((usuario) => {
    if (!esActivo_(usuario) || !usuario.ultimo_acceso) return;
    const diasSinAcceso = (ahora - new Date(usuario.ultimo_acceso).getTime()) / (24 * 60 * 60 * 1000);
    if (diasSinAcceso > DIAS_INACTIVIDAD_SUSPENSION) {
      actualizarFilaPorId_(db, 'USUARIOS', 'email', usuario.email, { activo: false });
      suspendidos.push(usuario.email);
    }
  });
  return suspendidos;
}

module.exports = { gestionarUsuario, listarUsuarios, suspenderInactivos };
