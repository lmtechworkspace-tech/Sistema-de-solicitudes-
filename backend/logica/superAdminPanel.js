'use strict';

/**
 * superAdminPanel.js — panel de datos crudo, solo para la cuenta marcada
 * `super_admin` en CUENTAS_PORTAL (ver la nota en schema.js). Pedido directo
 * del dueño de esa cuenta (2026-09-21): tras la migración de datos del
 * Sheets viejo, ya no hay forma de corregir a mano un error en una
 * solicitud/pausa/etc. como antes se podía editar la hoja de cálculo
 * directamente. Este módulo es ESE acceso directo, pero acotado a una sola
 * cuenta -- nunca a un rol que otra persona pudiera tener o recibir.
 *
 * Deliberadamente genérico: opera sobre CUALQUIER tabla declarada en
 * COLUMNAS (schema.js) usando los mismos primitivos que ya usa toda la
 * lógica de negocio (leerFilas_/agregarFila_/actualizarFilaPorId_/
 * eliminarFilasPorId_) -- no reimplementa nada, no valida reglas de negocio
 * de ningún módulo (eso es justamente lo que este panel se salta a
 * propósito). Cada escritura queda en LOG_SISTEMA con el detalle exacto,
 * porque sin las validaciones normales, ese registro es la única red de
 * seguridad que queda.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_, eliminarFilasPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion, errorForbidden } = require('./errores');

function esSuperAdmin_(contexto) {
  return !!contexto && contexto.super_admin === true;
}
function guardaSuperAdmin_() {
  return errorForbidden('Este panel es exclusivo de la cuenta de super administrador.');
}
function tablaValida_(tabla) {
  return typeof tabla === 'string' && Object.prototype.hasOwnProperty.call(COLUMNAS, tabla);
}
function registrarLog_(contexto, accion, detalle) {
  return { accion, detalle, autor: (contexto && contexto.email) || '' };
}
function escribirLog_(db, entrada) {
  try {
    agregarFila_(db, 'LOG_SISTEMA', {
      log_id: crypto.randomUUID(), timestamp: new Date().toISOString(),
      contexto: 'SUPER_ADMIN_PANEL:' + entrada.accion,
      mensaje: entrada.autor + ' → ' + entrada.detalle, ref: 'SUPER_ADMIN'
    });
  } catch (err) { /* trazabilidad, nunca debe tumbar la operacion real */ }
}

function listarTablas(db, data, contexto) {
  if (!esSuperAdmin_(contexto)) return guardaSuperAdmin_();
  const tablas = Object.keys(COLUMNAS).sort().map((nombre) => {
    let filas = 0;
    try { filas = leerFilas_(db, nombre, COLUMNAS[nombre]).length; } catch (err) { filas = 0; }
    return { nombre, columnas: COLUMNAS[nombre], filas };
  });
  return { tablas };
}

function listarFilasTabla(db, data, contexto) {
  if (!esSuperAdmin_(contexto)) return guardaSuperAdmin_();
  const tabla = data.tabla;
  if (!tablaValida_(tabla)) return errorValidacion('tabla', 'Tabla desconocida: ' + tabla);
  return { tabla, columnas: COLUMNAS[tabla], filas: leerFilas_(db, tabla, COLUMNAS[tabla]) };
}

function agregarFilaTabla(db, data, contexto) {
  if (!esSuperAdmin_(contexto)) return guardaSuperAdmin_();
  const tabla = data.tabla;
  if (!tablaValida_(tabla)) return errorValidacion('tabla', 'Tabla desconocida: ' + tabla);
  const fila = data.fila;
  if (!fila || typeof fila !== 'object' || Array.isArray(fila)) return errorValidacion('fila', 'Falta el objeto con los valores de la fila nueva.');
  const creada = agregarFila_(db, tabla, fila);
  escribirLog_(db, registrarLog_(contexto, 'FILA_AGREGADA', tabla + ': ' + JSON.stringify(fila).slice(0, 500)));
  return { tabla, fila: creada };
}

function actualizarFilaTabla(db, data, contexto) {
  if (!esSuperAdmin_(contexto)) return guardaSuperAdmin_();
  const tabla = data.tabla;
  if (!tablaValida_(tabla)) return errorValidacion('tabla', 'Tabla desconocida: ' + tabla);
  const idCampo = data.id_campo;
  if (!idCampo || COLUMNAS[tabla].indexOf(idCampo) === -1) return errorValidacion('id_campo', 'Columna desconocida en ' + tabla + ': ' + idCampo);
  if (data.id_valor === undefined || data.id_valor === null || data.id_valor === '') return errorValidacion('id_valor', 'Falta el valor de ' + idCampo + ' de la fila a editar.');
  const cambios = data.cambios;
  if (!cambios || typeof cambios !== 'object' || Array.isArray(cambios)) return errorValidacion('cambios', 'Falta el objeto con los campos a cambiar.');

  const actualizada = actualizarFilaPorId_(db, tabla, idCampo, data.id_valor, cambios);
  if (!actualizada) return errorValidacion('id_valor', 'No se encontró ninguna fila en ' + tabla + ' con ' + idCampo + ' = ' + data.id_valor + '.');
  escribirLog_(db, registrarLog_(contexto, 'FILA_EDITADA', tabla + ' (' + idCampo + '=' + data.id_valor + '): ' + JSON.stringify(cambios).slice(0, 500)));
  return { tabla, fila: actualizada };
}

function eliminarFilaTabla(db, data, contexto) {
  if (!esSuperAdmin_(contexto)) return guardaSuperAdmin_();
  const tabla = data.tabla;
  if (!tablaValida_(tabla)) return errorValidacion('tabla', 'Tabla desconocida: ' + tabla);
  const idCampo = data.id_campo;
  if (!idCampo || COLUMNAS[tabla].indexOf(idCampo) === -1) return errorValidacion('id_campo', 'Columna desconocida en ' + tabla + ': ' + idCampo);
  if (data.id_valor === undefined || data.id_valor === null || data.id_valor === '') return errorValidacion('id_valor', 'Falta el valor de ' + idCampo + ' de la fila a eliminar.');

  const eliminadas = eliminarFilasPorId_(db, tabla, idCampo, data.id_valor);
  if (eliminadas > 0) escribirLog_(db, registrarLog_(contexto, 'FILA_ELIMINADA', tabla + ' (' + idCampo + '=' + data.id_valor + '), ' + eliminadas + ' fila(s)'));
  return { tabla, eliminadas };
}

module.exports = { listarTablas, listarFilasTabla, agregarFilaTabla, actualizarFilaTabla, eliminarFilaTabla };
