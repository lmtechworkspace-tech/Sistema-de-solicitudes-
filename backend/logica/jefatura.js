'use strict';

/**
 * jefatura.js — puerto PARCIAL de backend/backoffice/Jefatura.gs.
 *
 * Se porta: el CRUD de la relacion jefe->subordinado (listar/gestionar,
 * solo ADM) y las funciones de guardia que Solicitudes.getDetalle necesita
 * para acotar el rol JEFATURA a su equipo (esDelEquipoJefatura_/
 * esDelEquipoJefaturaSolicitud_/obtenerEquipoJefe_).
 *
 * NO portado (documentado, no fingido): Jefatura.getPanel -- el panel "Mi
 * departamento" completo (KPIs, "hoy", desglose por persona, carga,
 * tendencia de 6 meses). Es un modulo de reporte aparte, del mismo tamano
 * y con las mismas dependencias que Gerencia.gs (ninguno de los dos
 * portado todavia: mapaNombresUsuarios_, diasHabilesRedondeado_,
 * lineaBasePorItem_, contarPorSubsolicitud_, contarReaperturasPorSubsolicitud_,
 * coincideFiltroItem_ viven ahi). getDetalle (el objetivo de este turno)
 * no depende de getPanel para nada.
 */

const crypto = require('node:crypto');
const { agregarFila_, actualizarFilaPorId_, eliminarFilasPorId_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion, errorForbidden } = require('./errores');

function leerFilasSeguro_(db, hoja) {
  try { return leerFilas_(db, hoja, COLUMNAS[hoja]); } catch (err) { return []; }
}

// Equipo ACTIVO de un jefe -- lista de correos (sin el propio). [] si el
// jefe no tiene a nadie a cargo (tolerante a instalaciones sin la hoja).
function obtenerEquipoJefe_(db, jefeEmail) {
  if (!jefeEmail) return [];
  return leerFilasSeguro_(db, 'JEFATURAS')
    .filter((j) => {
      const activo = j.activo === true || j.activo === 'TRUE' || j.activo === 1;
      return activo && j.jefe_email === jefeEmail;
    })
    .map((j) => j.subordinado_email)
    .filter((email, i, todos) => email && todos.indexOf(email) === i);
}

/**
 * Una solicitud/subsolicitud es "de mi equipo" si el SOLICITANTE o el
 * RESOLUTOR (del item puntual, o el de la cabecera como respaldo) esta en
 * el equipo. Reusada por getDetalle (el guardia de acceso al detalle
 * individual) -- si Jefatura.getPanel se porta despues, debe reusar esta
 * MISMA funcion, no reimplementar el criterio (ver la nota real en el .gs
 * sobre por que dos implementaciones divergieron una vez).
 */
function esDelEquipoJefatura_(solicitud, subsolicitud, equipoSet) {
  if (equipoSet[solicitud.solicitante_email]) return true;
  const responsable = (subsolicitud && subsolicitud.desarrollador_asignado) || solicitud.desarrollador_asignado;
  return !!(responsable && equipoSet[responsable]);
}

// Igual que esDelEquipoJefatura_ pero evaluando TODAS las subsolicitudes de
// la solicitud (el guardia de getDetalle no recibe una subsolicitud
// puntual sino el id de la solicitud completa).
function esDelEquipoJefaturaSolicitud_(solicitud, subsolicitudes, equipoSet) {
  if (esDelEquipoJefatura_(solicitud, null, equipoSet)) return true;
  return (subsolicitudes || []).some((sub) => equipoSet[sub.desarrollador_asignado]);
}

function listar(db, data, contexto) {
  if (contexto.rol !== 'ADM') {
    return errorForbidden('Solo un Administrador puede ver las jefaturas.');
  }
  return leerFilasSeguro_(db, 'JEFATURAS');
}

function crearJefatura_(db, data) {
  const jefeEmail = String(data.jefe_email || '').trim().toLowerCase();
  const subordinadoEmail = String(data.subordinado_email || '').trim().toLowerCase();
  if (!jefeEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(jefeEmail)) {
    return errorValidacion('jefe_email', 'Correo del jefe invalido.');
  }
  if (!subordinadoEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(subordinadoEmail)) {
    return errorValidacion('subordinado_email', 'Correo de la persona a cargo invalido.');
  }
  if (jefeEmail === subordinadoEmail) {
    return errorValidacion('subordinado_email', 'Una persona no puede ser su propio jefe.');
  }
  const existente = leerFilasSeguro_(db, 'JEFATURAS').find((j) => {
    const activo = j.activo === true || j.activo === 'TRUE' || j.activo === 1;
    return activo && j.jefe_email === jefeEmail && j.subordinado_email === subordinadoEmail;
  });
  if (existente) {
    return errorValidacion('subordinado_email', 'Esa persona ya esta a cargo de ese jefe.');
  }
  const fila = { jefatura_id: crypto.randomUUID(), jefe_email: jefeEmail, subordinado_email: subordinadoEmail, activo: true };
  agregarFila_(db, 'JEFATURAS', fila);
  return fila;
}

function activarJefatura_(db, data) {
  if (!data.jefatura_id) return errorValidacion('jefatura_id', 'Falta indicar la relacion a modificar.');
  actualizarFilaPorId_(db, 'JEFATURAS', 'jefatura_id', data.jefatura_id, { activo: data.activo !== false });
  return { jefatura_id: data.jefatura_id, activo: data.activo !== false };
}

function eliminarJefatura_(db, data) {
  if (!data.jefatura_id) return errorValidacion('jefatura_id', 'Falta indicar la relacion a eliminar.');
  eliminarFilasPorId_(db, 'JEFATURAS', 'jefatura_id', data.jefatura_id);
  return { jefatura_id: data.jefatura_id, eliminada: true };
}

function gestionar(db, data, contexto) {
  if (contexto.rol !== 'ADM') {
    return errorForbidden('Solo un Administrador puede gestionar jefaturas.');
  }
  switch (data.operacion) {
    case 'crear': return crearJefatura_(db, data);
    case 'activar': return activarJefatura_(db, data);
    case 'eliminar': return eliminarJefatura_(db, data);
    default:
      return errorValidacion('operacion', 'Operacion invalida: ' + data.operacion);
  }
}

module.exports = { listar, gestionar, obtenerEquipoJefe_, esDelEquipoJefatura_, esDelEquipoJefaturaSolicitud_ };
