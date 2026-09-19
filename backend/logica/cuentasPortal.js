'use strict';

/**
 * cuentasPortal.js — puerto de backend/backoffice/CuentasPortal.gs. Solo
 * Admin gestiona cuentas (sin auto-registro: grupo chico y conocido).
 *
 * No se porta generar_enlace (enlace magico, v5.2): es una comodidad de
 * adopcion sobre el mismo mecanismo de sesiones ya portado (Sesiones.
 * crearEnlaceMagico existe y podria conectarse cuando haga falta), no una
 * pieza que bloquee el resto del modulo.
 */

const { agregarFila_, actualizarFilaPorId_, eliminarFilasPorId_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion, errorForbidden } = require('./errores');
const Hash = require('./passwordHash');
const { parsearListaPortal, normalizarUsuario } = require('./portal');

// Plantilla de modulos por rol (§2.3). Solo aplica al CREAR la cuenta (o al
// resetear modulos): despues manda la lista por cuenta.
//
// NO hay un rol COORDINADOR (retirado 2026-09-19, documento "Arquitectura
// de Accesos"): nunca fue un gate real -- el acceso real a coordinar la
// pausa de una empresa lo decide el roster PAUSAS_COORDINADORES (por
// email, en pausas.js), no este mapa. El rol solo prellenaba modulos, que
// hoy tampoco se aplica server-side (ver router.js) -- mantenerlo sugeria
// una proteccion que nunca existio. Para dar de alta a quien coordina una
// pausa: crear su cuenta con el rol que corresponda (DEV/ANA/...) y
// agregarla al roster de Pausas por separado, que es el paso que de
// verdad importa.
const MODULOS_POR_ROL = {
  SOLICITANTE: ['nueva_solicitud', 'mis_solicitudes', 'mi_trabajo'],
  DEV: ['nueva_solicitud', 'mis_solicitudes', 'bandeja', 'mi_trabajo'],
  ANA: ['nueva_solicitud', 'mis_solicitudes', 'bandeja', 'mi_trabajo'],
  GERENCIA: ['nueva_solicitud', 'mis_solicitudes', 'gerencia', 'mi_trabajo'],
  JEFATURA: ['nueva_solicitud', 'mis_solicitudes', 'jefatura', 'mi_trabajo'],
  ADM: ['nueva_solicitud', 'mis_solicitudes', 'bandeja', 'gerencia', 'jefatura', 'administracion', 'pausas', 'pausas_coordinacion', 'mi_trabajo', 'proyectos', 'calidad']
};

const MODULOS_VALIDOS = ['nueva_solicitud', 'mis_solicitudes', 'bandeja', 'gerencia', 'jefatura', 'administracion', 'pausas', 'pausas_coordinacion', 'mi_trabajo', 'proyectos', 'calidad'];

function leerCuentas(db) {
  return leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL);
}

function buscarCuenta(db, cuentaId) {
  return leerCuentas(db).find((c) => c.cuenta_id === cuentaId) || null;
}

function normalizarEmails(emails) {
  const lista = Array.isArray(emails) ? emails : String(emails || '').split(/[,;\n]/);
  const vistos = {};
  return lista
    .map((e) => String(e).trim().toLowerCase())
    .filter((e) => {
      if (!e || vistos[e] || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return false;
      vistos[e] = true;
      return true;
    });
}

function validarModulos(modulos) {
  if (modulos === undefined || modulos === null || modulos === '') return null;
  const lista = Array.isArray(modulos) ? modulos : parsearListaPortal(modulos);
  const validos = lista.filter((m) => MODULOS_VALIDOS.indexOf(m) !== -1);
  return validos.length === lista.length && validos.length > 0 ? validos : null;
}

function listar(db, data, contexto) {
  if (contexto.rol !== 'ADM') {
    return errorForbidden('Solo Admin puede gestionar cuentas de la plataforma.');
  }
  return {
    cuentas: leerCuentas(db).map((c) => ({
      // Nunca viajan hash ni sal, ni siquiera al Admin.
      cuenta_id: c.cuenta_id,
      usuario: c.usuario,
      nombre: c.nombre,
      cargo: c.cargo,
      emails: parsearListaPortal(c.emails),
      rol: c.rol,
      modulos: parsearListaPortal(c.modulos),
      empresa_id: c.empresa_id,
      activo: c.activo === true || c.activo === 'TRUE' || c.activo === 1,
      debe_cambiar_password: c.debe_cambiar_password === true || c.debe_cambiar_password === 'TRUE' || c.debe_cambiar_password === 1,
      ultimo_acceso: c.ultimo_acceso
    }))
  };
}

function gestionar(db, data, contexto) {
  if (contexto.rol !== 'ADM') {
    return errorForbidden('Solo Admin puede gestionar cuentas de la plataforma.');
  }
  switch (data.operacion) {
    case 'crear': return crear(db, data, contexto);
    case 'actualizar': return actualizar(db, data);
    case 'resetear_password': return resetearPassword(db, data);
    case 'activar': return activar(db, data);
    case 'renombrar': return renombrar(db, data);
    case 'asignar_password': return asignarPassword(db, data);
    case 'eliminar': return eliminar(db, data);
    default:
      return errorValidacion('operacion', 'Operacion invalida: ' + data.operacion);
  }
}

function crear(db, data, contexto) {
  const usuario = normalizarUsuario(data.usuario);
  if (!usuario || !/^[a-z0-9._-]{3,30}$/.test(usuario)) {
    return errorValidacion('usuario', 'Usuario invalido: 3-30 caracteres, letras/numeros/punto/guion.');
  }
  if (!data.nombre || !String(data.nombre).trim()) {
    return errorValidacion('nombre', 'Indica el nombre de la persona.');
  }
  const emails = normalizarEmails(data.emails);
  if (emails.length === 0) {
    return errorValidacion('emails', 'Indica al menos un correo asociado.');
  }
  const rol = data.rol || 'SOLICITANTE';
  if (!MODULOS_POR_ROL[rol]) {
    return errorValidacion('rol', 'Rol invalido: ' + rol);
  }
  if (leerCuentas(db).some((c) => normalizarUsuario(c.usuario) === usuario)) {
    return errorValidacion('usuario', 'Ya existe una cuenta con el usuario "' + usuario + '".');
  }

  const claveTemporal = data.password_temporal ? String(data.password_temporal) : Hash.generarClaveTemporal();
  if (claveTemporal.length < 8) {
    return errorValidacion('password_temporal', 'La clave temporal debe tener al menos 8 caracteres.');
  }

  const salt = Hash.generarSalt();
  const cuentaId = require('node:crypto').randomUUID();
  agregarFila_(db, 'CUENTAS_PORTAL', {
    cuenta_id: cuentaId,
    usuario: usuario,
    nombre: String(data.nombre).trim(),
    cargo: String(data.cargo || '').trim(),
    hash_password: Hash.hashPassword(claveTemporal, salt),
    salt: salt,
    emails: JSON.stringify(emails),
    rol: rol,
    modulos: JSON.stringify(validarModulos(data.modulos) || MODULOS_POR_ROL[rol]),
    empresa_id: data.empresa_id || '',
    activo: true,
    debe_cambiar_password: true,
    ultimo_acceso: '',
    creado_por: contexto.email
  });

  // La clave temporal se devuelve UNA sola vez, para que el Admin la
  // entregue en persona/WhatsApp. No queda guardada en ninguna parte.
  return { cuenta_id: cuentaId, usuario: usuario, password_temporal: claveTemporal };
}

function actualizar(db, data) {
  const cuenta = buscarCuenta(db, data.cuenta_id);
  if (!cuenta) return errorValidacion('cuenta_id', 'Cuenta no encontrada.');

  const cambios = {};
  if (data.nombre !== undefined) cambios.nombre = String(data.nombre).trim();
  if (data.cargo !== undefined) cambios.cargo = String(data.cargo).trim();
  if (data.empresa_id !== undefined) cambios.empresa_id = data.empresa_id;
  if (data.rol !== undefined) {
    if (!MODULOS_POR_ROL[data.rol]) return errorValidacion('rol', 'Rol invalido: ' + data.rol);
    cambios.rol = data.rol;
  }
  if (data.emails !== undefined) {
    const emails = normalizarEmails(data.emails);
    if (emails.length === 0) return errorValidacion('emails', 'La cuenta debe conservar al menos un correo.');
    cambios.emails = JSON.stringify(emails);
  }
  if (data.modulos !== undefined) {
    const modulos = validarModulos(data.modulos);
    if (!modulos) return errorValidacion('modulos', 'Lista de modulos invalida. Validos: ' + MODULOS_VALIDOS.join(', '));
    cambios.modulos = JSON.stringify(modulos);
  }
  actualizarFilaPorId_(db, 'CUENTAS_PORTAL', 'cuenta_id', data.cuenta_id, cambios);
  return { cuenta_id: data.cuenta_id, actualizado: Object.keys(cambios) };
}

function resetearPassword(db, data) {
  const cuenta = buscarCuenta(db, data.cuenta_id);
  if (!cuenta) return errorValidacion('cuenta_id', 'Cuenta no encontrada.');
  const claveTemporal = Hash.generarClaveTemporal();
  const salt = Hash.generarSalt();
  actualizarFilaPorId_(db, 'CUENTAS_PORTAL', 'cuenta_id', data.cuenta_id, {
    salt: salt,
    hash_password: Hash.hashPassword(claveTemporal, salt),
    debe_cambiar_password: true
  });
  return { cuenta_id: data.cuenta_id, usuario: cuenta.usuario, password_temporal: claveTemporal };
}

function activar(db, data) {
  const cuenta = buscarCuenta(db, data.cuenta_id);
  if (!cuenta) return errorValidacion('cuenta_id', 'Cuenta no encontrada.');
  actualizarFilaPorId_(db, 'CUENTAS_PORTAL', 'cuenta_id', data.cuenta_id, { activo: data.activo !== false });
  return { cuenta_id: data.cuenta_id, activo: data.activo !== false };
}

function renombrar(db, data) {
  const cuenta = buscarCuenta(db, data.cuenta_id);
  if (!cuenta) return errorValidacion('cuenta_id', 'Cuenta no encontrada.');
  const nuevoUsuario = normalizarUsuario(data.usuario);
  if (!nuevoUsuario || !/^[a-z0-9._-]{3,30}$/.test(nuevoUsuario)) {
    return errorValidacion('usuario', 'Usuario invalido: 3-30 caracteres, letras/numeros/punto/guion.');
  }
  const enUso = leerCuentas(db).some((c) => c.cuenta_id !== data.cuenta_id && normalizarUsuario(c.usuario) === nuevoUsuario);
  if (enUso) return errorValidacion('usuario', 'Ya existe una cuenta con el usuario "' + nuevoUsuario + '".');
  actualizarFilaPorId_(db, 'CUENTAS_PORTAL', 'cuenta_id', data.cuenta_id, { usuario: nuevoUsuario });
  return { cuenta_id: data.cuenta_id, usuario: nuevoUsuario };
}

function asignarPassword(db, data) {
  const cuenta = buscarCuenta(db, data.cuenta_id);
  if (!cuenta) return errorValidacion('cuenta_id', 'Cuenta no encontrada.');
  const password = String(data.password || '');
  if (password.length < 8) return errorValidacion('password', 'La clave debe tener al menos 8 caracteres.');
  const salt = Hash.generarSalt();
  actualizarFilaPorId_(db, 'CUENTAS_PORTAL', 'cuenta_id', data.cuenta_id, {
    salt: salt,
    hash_password: Hash.hashPassword(password, salt),
    debe_cambiar_password: true
  });
  return { cuenta_id: data.cuenta_id, usuario: cuenta.usuario, password: password };
}

function eliminar(db, data) {
  const cuenta = buscarCuenta(db, data.cuenta_id);
  if (!cuenta) return errorValidacion('cuenta_id', 'Cuenta no encontrada.');
  eliminarFilasPorId_(db, 'CUENTAS_PORTAL', 'cuenta_id', data.cuenta_id);
  eliminarFilasPorId_(db, 'SESIONES_PORTAL', 'cuenta_id', data.cuenta_id);
  return { cuenta_id: data.cuenta_id, usuario: cuenta.usuario, eliminada: true };
}

module.exports = { listar, gestionar, MODULOS_POR_ROL, MODULOS_VALIDOS };
