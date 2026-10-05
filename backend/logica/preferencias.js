'use strict';

/**
 * preferencias.js — lo que cada persona deja a su gusto en SIGSO y la sigue a
 * cualquier equipo (2026-10-05, rediseño de la barra lateral, decisión 3).
 *
 * Hoy guarda los FIJADOS de la barra: hasta 8 pantallas que la persona usa
 * todos los días («Contabilidad › Seguimiento de cuotas TGR»). Se guardan por
 * cuenta (no por navegador) y solo la propia persona los lee o cambia.
 *
 * `fijados: null` = nunca los eligió: la barra le propone tres según su área.
 * Una lista vacía es una elección («no quiero fijados») y se respeta.
 */

const { leerFilas_, agregarFila_, actualizarFilaPorFiltro_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');

const MAX_FIJADOS = 8;
const RE_MODULO = /^[a-z][a-z0-9_]{1,39}$/;

function ahora_() { return new Date().toISOString(); }
function leer_(db) { try { return leerFilas_(db, 'PREFERENCIAS_CUENTA', COLUMNAS.PREFERENCIAS_CUENTA); } catch (e) { return []; } }
function fila_(db, cuentaId, clave) { return leer_(db).find((f) => f.cuenta_id === cuentaId && f.clave === clave) || null; }
function texto_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }

/** Un fijado válido, o null. Solo dice A DÓNDE ir: el permiso lo vuelve a decidir el módulo al abrir. */
function limpiarFijado_(f) {
  if (!f || typeof f !== 'object') return null;
  const modulo = texto_(f.modulo, 40);
  if (!RE_MODULO.test(modulo)) return null;
  const nombre = texto_(f.nombre, 80);
  if (!nombre) return null;
  return { modulo, item: texto_(f.item, 160), nombre, ruta: texto_(f.ruta, 60) };
}

function obtener(db, data, contexto) {
  if (!contexto || !contexto.cuenta_id) return { _forbidden: true, message: 'Ingresa con tu cuenta de SIGSO.' };
  const f = fila_(db, contexto.cuenta_id, 'barra_fijados');
  let fijados = null;
  if (f) { try { const v = JSON.parse(f.valor); fijados = Array.isArray(v) ? v.map(limpiarFijado_).filter(Boolean) : null; } catch (e) { fijados = null; } }
  return { fijados };
}

function guardarFijados(db, data, contexto) {
  if (!contexto || !contexto.cuenta_id) return { _forbidden: true, message: 'Ingresa con tu cuenta de SIGSO.' };
  const lista = Array.isArray(data && data.fijados) ? data.fijados : null;
  if (!lista) return { ok: false, message: 'No llegó la lista de fijados.' };
  const vistos = new Set();
  const limpios = [];
  lista.forEach((x) => {
    const f = limpiarFijado_(x);
    if (!f) return;
    const llave = f.modulo + '/' + f.item;
    if (vistos.has(llave)) return;
    vistos.add(llave);
    limpios.push(f);
  });
  if (limpios.length > MAX_FIJADOS) return { ok: false, message: 'Hasta ' + MAX_FIJADOS + ' fijados: quita uno antes de agregar otro.' };
  const valor = JSON.stringify(limpios);
  const cambios = { valor, fecha_actualizacion: ahora_() };
  if (fila_(db, contexto.cuenta_id, 'barra_fijados')) {
    actualizarFilaPorFiltro_(db, 'PREFERENCIAS_CUENTA', (r) => r.cuenta_id === contexto.cuenta_id && r.clave === 'barra_fijados', cambios);
  } else {
    agregarFila_(db, 'PREFERENCIAS_CUENTA', Object.assign({ cuenta_id: contexto.cuenta_id, clave: 'barra_fijados' }, cambios));
  }
  return { ok: true, fijados: limpios };
}

module.exports = { obtener, guardarFijados, MAX_FIJADOS };
