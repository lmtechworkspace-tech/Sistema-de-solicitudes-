'use strict';

/**
 * personasPanelSgc.js — SIGSO v2, Módulo 8C: Personas v2 e inducciones en
 * lote. Análisis y decisiones en documentacion/SIGSO-v2-hoja-de-ruta.md.
 *
 *  - getPanelPersonasSgc: las personas que quien pregunta puede ver (mismas
 *    reglas que Personas.listar) con su inducción ítem por ítem, su última
 *    evaluación y lo que le falta. "Requiere capacitación" se calcula con la
 *    regla del sistema (promedio < 3), no con lo que trajo la importación
 *    (decisión del dueño: mostrar según la regla y avisar, sin tocar datos).
 *  - registrarInduccionesEnLoteSgc: las inducciones se hicieron pero nunca se
 *    registraron. Se registran varias personas × ítems a la vez con la fecha
 *    que se indique (por defecto la de ingreso de cada persona; nunca
 *    futura). Cada ítem pasa por Personas.registrarInduccion: el Encargado
 *    SGC registra a todos y cada jefatura solo a su equipo.
 */

const crypto = require('crypto');
const { leerFilas_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const Personas = require('./personasSgc');

const ITEMS = ['Organigrama', 'Política de Calidad', 'Objetivos de Calidad', 'Descriptor de cargo', 'Inducción ISO 9001'];
const UMBRAL = 3;
const MAX_LOTE = 500;

function leer_(db, hoja) { try { return leerFilas_(db, hoja, COLUMNAS[hoja]); } catch (e) { return []; } }
function v_(x) { return x === true || x === 'TRUE' || x === 1; }
function json_(x) { if (Array.isArray(x)) return x; try { const l = JSON.parse(x || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
function hoyChile_() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
function clave_(f) { const k = String(f || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : ''; }

function getPanel(db, data, contexto) {
  const base = Personas.listar(db, {}, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  const ids = {};
  base.personas.forEach((p) => { ids[p.persona_id] = true; });
  const filas = {};
  leer_(db, 'SGC_PERSONAS').forEach((p) => { if (ids[p.persona_id]) filas[p.persona_id] = p; });
  const induccion = {};
  leer_(db, 'SGC_INDUCCIONES').forEach((i) => { if (ids[i.persona_id]) (induccion[i.persona_id] = induccion[i.persona_id] || []).push(i); });
  const evals = {};
  leer_(db, 'SGC_EVALUACIONES').forEach((e) => { if (ids[e.persona_id]) (evals[e.persona_id] = evals[e.persona_id] || []).push(e); });
  const docs = {};
  leer_(db, 'SGC_PERSONA_DOCUMENTOS').forEach((d) => { if (ids[d.persona_id] && v_(d.activa)) docs[d.persona_id] = (docs[d.persona_id] || 0) + 1; });
  const descriptores = {};
  leer_(db, 'SGC_DESCRIPTORES').forEach((d) => { if (ids[d.persona_id] && v_(d.vigente)) descriptores[d.persona_id] = d; });
  const horas = {};
  Personas.horasFormacionPorPersonaSgc_(db, new Date().getFullYear()).forEach((h) => { horas[h.persona_id] = h.horas; });
  const hoy = hoyChile_();

  const personas = base.personas.map((p) => {
    const fila = filas[p.persona_id] || {};
    const items = ITEMS.map((nombre) => {
      const i = (induccion[p.persona_id] || []).find((x) => x.item === nombre);
      return i ? { induccion_id: i.induccion_id, item: nombre, estado: i.estado, fecha: i.fecha || '', relator_email: i.relator_email || '', observaciones: i.observaciones || '' }
        : { induccion_id: '', item: nombre, estado: 'PENDIENTE', fecha: '', relator_email: '', observaciones: '' };
    });
    const ev = (evals[p.persona_id] || []).slice().sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))[0] || null;
    let evaluacion = null;
    if (ev) {
      const pr = Number(ev.promedio_responsabilidades) || 0, ph = Number(ev.promedio_habilidades) || 0;
      evaluacion = {
        fecha: ev.fecha || '', promedio_responsabilidades: pr, promedio_habilidades: ph,
        requiere_capacitacion: pr < UMBRAL || ph < UMBRAL,
        // Lo que dice la fila cuando no coincide con la regla (importación).
        difiere_de_regla: v_(ev.requiere_capacitacion) !== (pr < UMBRAL || ph < UMBRAL),
        sin_fecha: !clave_(ev.fecha),
        vencida: !!(clave_(ev.proxima_evaluacion) && clave_(ev.proxima_evaluacion) < hoy)
      };
    }
    const desc = descriptores[p.persona_id];
    const pendientes = items.filter((i) => i.estado !== 'COMPLETADA').length;
    const alertas = [];
    if (pendientes) alertas.push('induccion');
    if (!desc) alertas.push('sin_descriptor');
    if (!evaluacion) alertas.push('sin_evaluacion');
    else {
      if (evaluacion.sin_fecha) alertas.push('evaluacion_sin_fecha');
      if (evaluacion.vencida) alertas.push('evaluacion_vencida');
      if (evaluacion.requiere_capacitacion) alertas.push('requiere_capacitacion');
    }
    return Object.assign({}, p, {
      subrogante_email: fila.subrogante_email || '',
      induccion: items, induccion_pendientes: pendientes,
      puede_registrar_induccion: gobierna || Personas.esJefaturaDe_(db, fila, contexto),
      evaluacion, documentos_n: docs[p.persona_id] || 0,
      descriptor_evaluable: !!(desc && json_(desc.items_responsabilidades).length && json_(desc.items_habilidades).length),
      horas_formacion_anio: horas[p.persona_id] || 0,
      alertas
    });
  });
  const cuenta = (a) => personas.filter((p) => p.alertas.indexOf(a) !== -1).length;
  return {
    puede_gestionar: base.puede_gestionar, rol_sgc: base.rol_sgc,
    // Para que el árbol lateral se pode igual al entrar directo a Personas.
    secciones_visibles: Calidad.seccionesVisiblesSgc_(db, contexto),
    items_induccion: ITEMS, hoy,
    puede_registrar_alguna: personas.some((p) => p.puede_registrar_induccion),
    resumen: {
      personas: personas.length,
      induccion_completa: personas.filter((p) => !p.induccion_pendientes).length,
      induccion_items_pendientes: personas.reduce((s, p) => s + p.induccion_pendientes, 0),
      induccion: cuenta('induccion'), sin_evaluacion: cuenta('sin_evaluacion'), evaluacion_sin_fecha: cuenta('evaluacion_sin_fecha'),
      evaluacion_vencida: cuenta('evaluacion_vencida'), requiere_capacitacion: cuenta('requiere_capacitacion'),
      evaluaciones_difieren: personas.filter((p) => p.evaluacion && p.evaluacion.difiere_de_regla).length
    },
    personas
  };
}

// registros: [{ persona_id, items: ['Organigrama', ...], fecha: 'AAAA-MM-DD' }]
function registrarEnLote(db, data, contexto) {
  const registros = Array.isArray(data && data.registros) ? data.registros : [];
  if (!registros.length) return { _validationError: true, message: 'Elige al menos una persona y un ítem.' };
  const total = registros.reduce((s, r) => s + (Array.isArray(r.items) ? r.items.length : 0), 0);
  if (!total) return { _validationError: true, message: 'Elige al menos un ítem de inducción.' };
  if (total > MAX_LOTE) return { _validationError: true, message: 'Demasiados ítems de una vez (máximo ' + MAX_LOTE + ').' };
  const hoy = hoyChile_();
  for (const r of registros) {
    const k = clave_(r.fecha);
    if (!k) return { _validationError: true, message: 'Falta la fecha de la inducción.' };
    if (k > hoy) return { _validationError: true, message: 'La fecha de la inducción no puede ser futura (' + k + ').' };
    if (k < '2000-01-01') return { _validationError: true, message: 'Fecha de inducción inválida (' + k + ').' };
    if ((r.items || []).some((it) => ITEMS.indexOf(it) === -1)) return { _validationError: true, message: 'Ítem de inducción desconocido.' };
  }
  const filas = leer_(db, 'SGC_INDUCCIONES');
  const fichas = {};
  leer_(db, 'SGC_PERSONAS').forEach((p) => { if (v_(p.activa)) fichas[p.persona_id] = p; });
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  let aplicados = 0;
  const personas = {};
  const fallas = [];
  registros.forEach((r) => {
    (r.items || []).forEach((item) => {
      let fila = filas.find((i) => i.persona_id === r.persona_id && i.item === item);
      // Ficha antigua sin la fila de ese ítem: se crea pendiente (su estado
      // normal) solo si quien registra tiene permiso sobre esa persona.
      if (!fila && fichas[r.persona_id] && (gobierna || Personas.esJefaturaDe_(db, fichas[r.persona_id], contexto))) {
        fila = { induccion_id: crypto.randomUUID(), persona_id: r.persona_id, item, fecha: '', relator_email: '', estado: 'PENDIENTE', observaciones: '' };
        agregarFila_(db, 'SGC_INDUCCIONES', fila);
        filas.push(fila);
      }
      const res = Personas.registrarInduccion(db, {
        persona_id: r.persona_id, induccion_id: fila ? fila.induccion_id : '', estado: 'COMPLETADA',
        // Mediodía UTC: el día no cambia al mostrarlo en Chile.
        fecha: clave_(r.fecha) + 'T12:00:00.000Z',
        relator_email: data.relator_email || '', observaciones: data.observaciones || ''
      }, contexto);
      if (res && (res._validationError || res._forbidden)) fallas.push(res.message);
      else { aplicados++; personas[r.persona_id] = true; }
    });
  });
  return { aplicados, personas: Object.keys(personas).length, fallas: fallas.filter((m, i) => fallas.indexOf(m) === i) };
}

module.exports = { getPanel, registrarEnLote, ITEMS };
