'use strict';

/**
 * controlDocumentalSgc.js — SIGSO v2, Módulo 8B: "Control documental".
 * Análisis y decisiones en documentacion/SIGSO-v2-hoja-de-ruta.md.
 *
 * Junta lo que le falta a los documentos para que la norma los dé por
 * controlados (reglas en Calidad.alertasControlSgc_, una sola fuente) y
 * permite arreglarlo EN LOTE (decisión del dueño): registrar revisión y
 * aprobación de varios documentos a la vez, y devolver a vigente las normas
 * externas que la importación dejó obsoletas. Cada cambio pasa por
 * Calidad.actualizarDocumento: mismas validaciones, permisos y log.
 *
 * Solo quien gobierna el SGC (Encargado SGC o ADM).
 */

const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');

function leer_(db, hoja) { try { return leerFilas_(db, hoja, COLUMNAS[hoja]); } catch (e) { return []; } }
function v_(x) { return x === true || x === 'TRUE' || x === 1; }
function enlaces_(d) { try { const l = JSON.parse(d.enlaces || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }

const GRUPOS = ['sin_aprobacion', 'sin_copia', 'externo_fuera', 'revision'];
// Solo estos campos se pueden cambiar en lote: lo que arregla una alerta.
const CAMPOS_LOTE = ['revisado_por', 'aprobado_por', 'fecha_aprobacion', 'elaborado_por', 'estado'];
const MAX_LOTE = 200;

function getControl(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'El control documental es para el Encargado SGC.' };
  const ahora = new Date();
  const grupos = {};
  GRUPOS.forEach((g) => { grupos[g] = []; });
  const firmantes = {};
  leer_(db, 'SGC_DOCUMENTOS').filter((d) => v_(d.activa)).forEach((d) => {
    ['elaborado_por', 'revisado_por', 'aprobado_por'].forEach((k) => { const n = String(d[k] || '').trim(); if (n) firmantes[n] = true; });
    Calidad.alertasControlSgc_(d, ahora).forEach((g) => {
      const it = { documento_id: d.documento_id, codigo: d.codigo, nombre: d.nombre, tipo: d.tipo, estado: d.estado };
      if (g === 'sin_aprobacion') { it.elaborado_por = d.elaborado_por || ''; it.revisado_por = d.revisado_por || ''; it.aprobado_por = d.aprobado_por || ''; }
      if (g === 'sin_copia') { const e = enlaces_(d); it.enlace = e.length ? e[0].url : ''; it.enlace_editable = e.some((x) => /docs\.google\.com\/.+\/edit/.test(x.url || '')); }
      if (g === 'revision') { it.proxima_revision = d.proxima_revision; it.dias = Calidad.diasHasta_(d.proxima_revision, ahora); }
      grupos[g].push(it);
    });
  });
  GRUPOS.forEach((g) => grupos[g].sort((a, b) => String(a.codigo).localeCompare(String(b.codigo))));
  grupos.revision.sort((a, b) => a.dias - b.dias);
  const totales = {};
  GRUPOS.forEach((g) => { totales[g] = grupos[g].length; });
  return {
    grupos, totales,
    total: GRUPOS.reduce((s, g) => s + totales[g], 0),
    // Nombres ya usados como elaborador/revisor/aprobador, para sugerirlos.
    firmantes: Object.keys(firmantes).sort()
  };
}

async function actualizarEnLote(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden editar documentos.' };
  const ids = Array.isArray(data && data.documento_ids) ? data.documento_ids.filter(Boolean) : [];
  if (!ids.length) return { _validationError: true, message: 'Elige al menos un documento.' };
  if (ids.length > MAX_LOTE) return { _validationError: true, message: 'Demasiados documentos de una vez (máximo ' + MAX_LOTE + ').' };
  const cambios = {};
  CAMPOS_LOTE.forEach((k) => { if (data.cambios && data.cambios[k] !== undefined) cambios[k] = typeof data.cambios[k] === 'string' ? data.cambios[k].trim() : data.cambios[k]; });
  if (!Object.keys(cambios).length) return { _validationError: true, message: 'No hay cambios que aplicar.' };
  if ((cambios.revisado_por !== undefined && !cambios.revisado_por) || (cambios.aprobado_por !== undefined && !cambios.aprobado_por)) {
    return { _validationError: true, message: 'Indica quién revisó y quién aprobó.' };
  }
  if (cambios.aprobado_por && cambios.fecha_aprobacion === undefined) cambios.fecha_aprobacion = new Date().toISOString();
  let aplicados = 0;
  const fallas = [];
  for (const id of ids) {
    const r = await Calidad.actualizarDocumento(db, Object.assign({ documento_id: id }, cambios), contexto);
    if (r && (r._validationError || r._forbidden)) fallas.push((r.message || 'Error') + ' (' + id + ')'); else aplicados++;
  }
  return { aplicados, fallas, control: getControl(db, {}, contexto).totales };
}

module.exports = { getControl, actualizarEnLote };
