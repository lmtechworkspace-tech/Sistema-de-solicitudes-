'use strict';

/**
 * preparacionSgc.js — el informe «¿Estamos preparados para certificar?»
 * (Plan de control y certificación, pieza P6; aprobado 13-11-2026).
 *
 * Pedido de gerencia en la reunión de cierre de año: reunirse con cada
 * responsable y responder con seriedad si la empresa está lista para la
 * auditoría de SCI (enero de 2027), porque «la auditoría ya se movió una vez
 * y no debe repetirse». Una RONDA de evaluación junta tres fuentes:
 *
 *  A · Lo que dice el sistema: la salud del SGC por capítulo (la MISMA matriz
 *      de cobertura del tablero), sus alertas, y por área el índice de
 *      cumplimiento, las no conformidades vencidas y los acuses pendientes.
 *  B · Lo que dice cada responsable: una entrevista guiada de 8 preguntas
 *      (respuesta, si se vio evidencia, puntaje 0-3) y su autoevaluación.
 *  C · Lo que muestra la muestra: SIGSO elige al azar registros de las
 *      matrices de cada área (5 por área, mes cerrado) y se revisa la
 *      trazabilidad: quién hizo, quién revisó, quién liberó (§8.5.2 / §8.6,
 *      lo que falló en 7 hallazgos de la auditoría de procesos del 30-09).
 *
 * Con eso cada área recibe un VEREDICTO con reglas fijas (sección 6 del plan)
 * y la ronda una RECOMENDACIÓN global. Cada brecha puede volverse tarea con
 * responsable y fecha (entra al índice de cumplimiento). Al EMITIR, la ronda
 * se congela (snapshot): lo que se entregó a gerencia no cambia después.
 * Se pueden abrir rondas nuevas (versión 1 en diciembre, versión 2 en enero).
 *
 * Permisos: gestiona quien gobierna el SGC (Encargado SGC / ADM); lee además
 * gerencia y quien tiene lectura total del SGC.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { DEPARTAMENTOS, MATRICES } = require('./controlInternoMatrices');

const TZ = 'America/Santiago';
const MUESTRAS_POR_AREA = 5;
const ESTADOS = { BORRADOR: 'BORRADOR', EMITIDO: 'EMITIDO' };
const VEREDICTOS = { LISTA: 'LISTA', RIESGOS: 'LISTA_CON_RIESGOS', NO_LISTA: 'NO_LISTA', SIN_EVALUAR: 'SIN_EVALUAR' };
const RESULTADOS_MUESTRA = ['CONFORME', 'PARCIAL', 'NO_CONFORME'];
const AUTOEVALUACION = ['LISTA', 'CON_RIESGOS', 'NO_LISTA'];
const EVIDENCIA = ['SI', 'PARCIAL', 'NO'];
const AREAS = DEPARTAMENTOS.map((d) => ({ clave: d.clave, nombre: d.nombre }));

/** Las preguntas de la entrevista (sección 6 del plan). */
const PREGUNTAS = [
  { id: 'P1', bloque: 'Procesos', clausulas: '8.5 · 8.6', texto: '¿Cuál es el procedimiento de tu proceso? Muéstrame el último registro y dónde queda quién lo revisó y lo liberó.' },
  { id: 'P2', bloque: 'Responsabilidades', clausulas: '5.3', texto: '¿Cuáles son tus responsabilidades según tu descriptor de cargo? ¿Qué tienes pendiente y desde cuándo?' },
  { id: 'P3', bloque: 'Política y objetivos', clausulas: '7.3 · 6.2', texto: '¿Cuál es la política de calidad? ¿Qué objetivo de calidad toca a tu área y cómo va este mes?' },
  { id: 'P4', bloque: 'Mejora', clausulas: '10.2', texto: '¿Qué no conformidades tiene tu área? ¿Qué acción se tomó? ¿Está cerrada y se verificó que funcionó?' },
  { id: 'P5', bloque: 'Cliente', clausulas: '9.1.2', texto: '¿Cómo sabe un cliente dónde reclamar? ¿Recibiste algún reclamo informal este trimestre? ¿Lo registraste?' },
  { id: 'P6', bloque: 'Riesgos', clausulas: '6.1 · 7.1.2', texto: '¿Qué podría hacer fallar tu servicio en enero? ¿Quién te reemplaza si sales de vacaciones?' },
  { id: 'P7', bloque: 'Competencia', clausulas: '7.2', texto: '¿Tienes tu evaluación de desempeño y tus capacitaciones al día?' },
  { id: 'P8', bloque: 'Autoevaluación', clausulas: '9.3', texto: '¿Tu área está lista para la auditoría? ¿Por qué?' }
];

/** Reglas del veredicto (sección 6 del plan). */
const REGLAS = { entrevista_lista: 2.5, entrevista_no: 2, evidencia_lista: 80, cumplimiento_lista: 85, cumplimiento_no: 75, muestras_lista: 80, muestras_no: 60 };

// --- utilidades ------------------------------------------------------------------
function leer_(db, t) { try { return leerFilas_(db, t, COLUMNAS[t]); } catch (e) { return []; } }
function norm_(e) { return String(e || '').trim().toLowerCase(); }
function verdadero_(v) { return v === true || v === 'TRUE' || v === 1 || v === 'true'; }
function activa_(f) { return f.activa === undefined || f.activa === '' || verdadero_(f.activa); }
function hoy_() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); }
function ahora_() { return new Date().toISOString(); }
function uuid_() { return crypto.randomUUID(); }
function texto_(v, tope) { return String(v == null ? '' : v).trim().slice(0, tope || 2000); }
function errorValidacion_(campo, message) { return { _validationError: true, campo, message }; }
function redondear_(n) { return n === null || n === undefined ? null : Math.round(n * 10) / 10; }
function promedio_(l) { return l.length ? l.reduce((s, x) => s + x, 0) / l.length : null; }
function diasEntre_(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }
function diaDe_(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}
/** Mes anterior al de `hoy` en formato de las matrices (2026-M10). */
function periodoCerrado_(hoy) {
  const a = Number(hoy.slice(0, 4)), m = Number(hoy.slice(5, 7));
  return m === 1 ? (a - 1) + '-M12' : a + '-M' + String(m - 1).padStart(2, '0');
}

function Calidad_() { return require('./calidadSgc'); }
function permisos_(db, contexto) {
  const C = Calidad_();
  const gobierna = C.gobiernaSgc_(db, contexto);
  const ve = gobierna || C.veTodoSgc_(db, contexto, C.rolSgc_(db, contexto), gobierna);
  return { gobierna, ve };
}
function nombres_(db) {
  const m = {};
  leer_(db, 'USUARIOS').forEach((u) => { if (u.email) m[norm_(u.email)] = u.nombre || u.email; });
  return m;
}
/** Responsables de cada área: la lista del departamento (jefatura y quien registra). */
function miembrosPorArea_(db) {
  const o = {};
  AREAS.forEach((a) => { o[a.clave] = []; });
  leer_(db, 'CI_MIEMBROS').filter((m) => activa_(m) && m.rol !== 'LECTURA' && o[m.depto]).forEach((m) => {
    const e = norm_(m.usuario_email);
    if (e && o[m.depto].indexOf(e) === -1) o[m.depto].push(e);
  });
  return o;
}

// --- muestras al azar ----------------------------------------------------------------
/** Generador determinista (mismo informe → misma muestra si se vuelve a sortear). */
function azar_(semilla) {
  let h = 2166136261;
  for (let i = 0; i < semilla.length; i++) { h ^= semilla.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}
function sortearMuestras_(db, informeId, hoy) {
  let CI;
  try { CI = require('./controlInterno'); } catch (e) { return []; }
  const periodo = periodoCerrado_(hoy);
  const rnd = azar_(informeId);
  const filas = [];
  AREAS.forEach((a) => {
    let registros = [];
    try { registros = CI.consultar_(db, 'CI_REGISTROS', { depto: a.clave, periodo, activa: true }); } catch (e) { registros = []; }
    registros = registros.filter((r) => r.estado !== 'ANULADO');
    const elegidos = [];
    const copia = registros.slice();
    while (copia.length && elegidos.length < MUESTRAS_POR_AREA) elegidos.push(copia.splice(Math.floor(rnd() * copia.length), 1)[0]);
    elegidos.forEach((r) => {
      const mat = MATRICES.find((m) => m.clave === r.matriz);
      filas.push({
        muestra_id: uuid_(), informe_id: informeId, area: a.clave, origen: 'CI_REGISTROS', ref_id: r.registro_id,
        descripcion: (mat ? mat.nombre : r.matriz) + ' · ' + (r.cliente_nombre || 'sin cliente'), periodo: r.periodo,
        hizo: r.responsable_email || '', reviso: '', libero: r.liberado_por || '', resultado: '', observacion: '',
        revisado_por: '', fecha_revision: '', activa: true
      });
    });
  });
  filas.forEach((f) => agregarFila_(db, 'SGC_PREP_MUESTRAS', f));
  return filas;
}

// --- parte A: lo que dice el sistema ----------------------------------------------------
function sistema_(db, contexto) {
  let tablero = null;
  try { tablero = require('./tableroSgc').resumen(db, {}, contexto); } catch (e) { tablero = null; }
  if (!tablero || tablero._forbidden) return { salud: null, alertas: [], conteos: {} };
  return {
    salud: tablero.salud,
    alertas: (tablero.alertas || []).slice(0, 12).map((a) => ({ severidad: a.severidad, titulo: a.titulo, detalle: a.detalle, cantidad: a.total, seccion: a.seccion })),
    conteos: tablero.conteos || {}
  };
}

function datosArea_(db, area, miembros, hoy, ctx) {
  // Índice de cumplimiento del mes (mismo motor que las pantallas).
  const indices = miembros.map((e) => ctx.R.calcularPersona_(db, e, hoy.slice(0, 7), { datos: ctx.datos, hoy }).indice).filter((x) => x !== null);
  // No conformidades a cargo de la gente del área con una etapa vencida.
  // La etapa en curso es la que manda; si ya tiene su fecha de cierre, no está vencida.
  const ncVencidas = ctx.nc.filter((n) => miembros.indexOf(norm_(n.responsable_email)) !== -1 && ['CERRADA', 'ANULADA'].indexOf(n.estado) === -1).filter((n) => {
    const etapa = n.estado === 'EN_VERIFICACION' ? ['eficacia_plazo', 'eficacia_fecha'] : (n.estado === 'EN_ACCION' ? ['accion_plazo', 'accion_fecha_cierre'] : ['correccion_plazo', 'correccion_fecha_cierre']);
    const plazo = String(n[etapa[0]] || '').slice(0, 10);
    return plazo && plazo < hoy && !n[etapa[1]];
  }).map((n) => n.correlativo || n.nc_id);
  // Acuses de documentos vigentes pendientes de la gente del área.
  let acuses = 0;
  ctx.documentos.forEach((d) => {
    const audiencia = ctx.audiencia(d);
    miembros.forEach((e) => {
      if (audiencia.indexOf(e) === -1) return;
      if (!ctx.acuses.some((a) => a.documento_id === d.documento_id && a.version === d.version_vigente && norm_(a.usuario_email) === e)) acuses++;
    });
  });
  return { cumplimiento: redondear_(promedio_(indices)), personas_con_indice: indices.length, nc_vencidas: ncVencidas, acuses_pendientes: acuses };
}

function evaluarEntrevistas_(entrevistas) {
  const puntajes = [], evid = [];
  entrevistas.forEach((en) => (en.respuestas || []).forEach((r) => {
    if (r.puntaje !== '' && r.puntaje !== null && r.puntaje !== undefined && !isNaN(Number(r.puntaje))) puntajes.push(Number(r.puntaje));
    if (EVIDENCIA.indexOf(r.evidencia) !== -1) evid.push(r.evidencia === 'SI' ? 1 : (r.evidencia === 'PARCIAL' ? 0.5 : 0));
  }));
  return { promedio: redondear_(promedio_(puntajes)), evidencia_pct: evid.length ? redondear_(promedio_(evid) * 100) : null, respondidas: puntajes.length };
}
function evaluarMuestras_(muestras) {
  const revisadas = muestras.filter((m) => RESULTADOS_MUESTRA.indexOf(m.resultado) !== -1);
  const puntos = revisadas.map((m) => (m.resultado === 'CONFORME' ? 1 : (m.resultado === 'PARCIAL' ? 0.5 : 0)));
  return { total: muestras.length, revisadas: revisadas.length, conformes_pct: revisadas.length ? redondear_(promedio_(puntos) * 100) : null };
}

/** El veredicto de un área con las reglas fijas del plan. Devuelve también el porqué. */
function veredicto_(m) {
  const brechas = [];
  const fuertes = [];
  if (!m.entrevista.respondidas) return { veredicto: VEREDICTOS.SIN_EVALUAR, brechas: ['Falta entrevistar a los responsables del área.'] };
  if (m.entrevista.promedio < REGLAS.entrevista_no) fuertes.push('La entrevista promedia ' + m.entrevista.promedio + ' de 3 (bajo ' + REGLAS.entrevista_no + ').');
  else if (m.entrevista.promedio < REGLAS.entrevista_lista) brechas.push('La entrevista promedia ' + m.entrevista.promedio + ' de 3 (se pide ' + REGLAS.entrevista_lista + ').');
  if (m.entrevista.evidencia_pct !== null && m.entrevista.evidencia_pct < REGLAS.evidencia_lista) brechas.push('Se vio evidencia en el ' + m.entrevista.evidencia_pct + ' % de las respuestas (se pide ' + REGLAS.evidencia_lista + ' %).');
  if (m.datos.cumplimiento !== null && m.datos.cumplimiento < REGLAS.cumplimiento_no) fuertes.push('Índice de cumplimiento del área en ' + m.datos.cumplimiento + ' % (bajo ' + REGLAS.cumplimiento_no + ' %).');
  else if (m.datos.cumplimiento !== null && m.datos.cumplimiento < REGLAS.cumplimiento_lista) brechas.push('Índice de cumplimiento del área en ' + m.datos.cumplimiento + ' % (se pide ' + REGLAS.cumplimiento_lista + ' %).');
  if (m.datos.nc_vencidas.length) fuertes.push('No conformidades con una etapa vencida: ' + m.datos.nc_vencidas.join(', ') + '.');
  if (m.datos.acuses_pendientes) brechas.push(m.datos.acuses_pendientes + (m.datos.acuses_pendientes === 1 ? ' documento sin acusar.' : ' documentos sin acusar.'));
  if (m.muestras.revisadas && m.muestras.conformes_pct < REGLAS.muestras_no) fuertes.push('Solo el ' + m.muestras.conformes_pct + ' % de las muestras tiene la trazabilidad completa.');
  else if (m.muestras.revisadas && m.muestras.conformes_pct < REGLAS.muestras_lista) brechas.push('El ' + m.muestras.conformes_pct + ' % de las muestras tiene la trazabilidad completa (se pide ' + REGLAS.muestras_lista + ' %).');
  if (m.muestras.total && m.muestras.revisadas < m.muestras.total) brechas.push('Faltan ' + (m.muestras.total - m.muestras.revisadas) + ' muestras por revisar.');
  if (m.autoevaluacion.no) brechas.push('Un responsable dice que el área NO está lista.');
  // Decimales con coma, como se escriben en Chile (75,2 %).
  const coma = (l) => l.map((t) => t.replace(/(\d)\.(\d)/g, (m, a, b) => a + ',' + b));
  if (fuertes.length) return { veredicto: VEREDICTOS.NO_LISTA, brechas: coma(fuertes.concat(brechas)) };
  if (brechas.length) return { veredicto: VEREDICTOS.RIESGOS, brechas: coma(brechas) };
  return { veredicto: VEREDICTOS.LISTA, brechas: [] };
}

function recomendacion_(areas) {
  const evaluadas = areas.filter((a) => a.veredicto !== VEREDICTOS.SIN_EVALUAR);
  const n = (v) => areas.filter((a) => a.veredicto === v).length;
  if (!evaluadas.length) return { codigo: 'SIN_EVALUAR', texto: 'Todavía no hay áreas evaluadas.' };
  if (n(VEREDICTOS.NO_LISTA)) return { codigo: 'NO_IR', texto: n(VEREDICTOS.NO_LISTA) + (n(VEREDICTOS.NO_LISTA) === 1 ? ' área no está lista' : ' áreas no están listas') + ': conviene cerrar esas brechas antes de la auditoría o proponer otra fecha a tiempo.' };
  if (n(VEREDICTOS.SIN_EVALUAR)) return { codigo: 'FALTA_EVALUAR', texto: 'Faltan ' + n(VEREDICTOS.SIN_EVALUAR) + (n(VEREDICTOS.SIN_EVALUAR) === 1 ? ' área' : ' áreas') + ' por evaluar antes de recomendar.' };
  if (n(VEREDICTOS.RIESGOS)) return { codigo: 'IR_CON_RIESGOS', texto: 'Se puede ir a la auditoría si las brechas de ' + n(VEREDICTOS.RIESGOS) + (n(VEREDICTOS.RIESGOS) === 1 ? ' área' : ' áreas') + ' tienen tarea, responsable y fecha anterior a la auditoría.' };
  return { codigo: 'IR', texto: 'Todas las áreas evaluadas están listas.' };
}

function contexto_(db) {
  const R = require('./cumplimientoResponsables');
  const datos = R.cargarDatos_(db);
  return { R, datos, nc: datos.nc, documentos: datos.documentos, acuses: datos.acuses, audiencia: datos.audiencia };
}

/** El informe calculado (o el congelado si ya se emitió). */
function armar_(db, informe, contexto, hoy) {
  if (informe.estado === ESTADOS.EMITIDO && informe.snapshot && typeof informe.snapshot === 'object') {
    return Object.assign({}, informe.snapshot, { informe: resumenInforme_(informe), congelado: true });
  }
  const nombres = nombres_(db);
  const entrevistas = leer_(db, 'SGC_PREP_ENTREVISTAS').filter((e) => activa_(e) && e.informe_id === informe.informe_id);
  const muestras = leer_(db, 'SGC_PREP_MUESTRAS').filter((m) => activa_(m) && m.informe_id === informe.informe_id);
  const miembros = miembrosPorArea_(db);
  const ctx = contexto_(db);
  const areas = AREAS.map((a) => {
    const en = entrevistas.filter((e) => e.area === a.clave);
    const mu = muestras.filter((m) => m.area === a.clave);
    const m = {
      entrevista: evaluarEntrevistas_(en),
      datos: datosArea_(db, a.clave, miembros[a.clave], hoy, ctx),
      muestras: evaluarMuestras_(mu),
      autoevaluacion: { no: en.some((e) => e.autoevaluacion === 'NO_LISTA'), con_riesgos: en.some((e) => e.autoevaluacion === 'CON_RIESGOS') }
    };
    const v = veredicto_(m);
    return Object.assign({ clave: a.clave, nombre: a.nombre, responsables: miembros[a.clave].map((e) => ({ email: e, nombre: nombres[e] || e })),
      entrevistas: en.length }, m, v);
  });
  const dias = informe.fecha_auditoria ? diasEntre_(hoy, String(informe.fecha_auditoria).slice(0, 10)) : null;
  return {
    informe: resumenInforme_(informe),
    fecha: hoy,
    dias_para_auditoria: dias,
    recomendacion: recomendacion_(areas),
    areas,
    sistema: sistema_(db, contexto),
    entrevistas: entrevistas.map((e) => Object.assign({}, e, { persona_nombre: e.persona_nombre || nombres[norm_(e.persona_email)] || e.persona_email,
      entrevistador_nombre: nombres[norm_(e.entrevistador_email)] || e.entrevistador_email })),
    muestras: muestras.map((m) => Object.assign({}, m, { hizo_nombre: nombres[norm_(m.hizo)] || m.hizo, libero_nombre: nombres[norm_(m.libero)] || m.libero })),
    preguntas: PREGUNTAS,
    reglas: REGLAS,
    congelado: false
  };
}
function resumenInforme_(i) {
  return { informe_id: i.informe_id, correlativo: i.correlativo, titulo: i.titulo, estado: i.estado, fecha_auditoria: i.fecha_auditoria || '',
    conclusion: i.conclusion || '', recomendacion_texto: i.recomendacion || '', creado_por: i.creado_por, fecha_creacion: i.fecha_creacion,
    emitido_por: i.emitido_por || '', fecha_emision: i.fecha_emision || '' };
}
function buscar_(db, id) { return leer_(db, 'SGC_PREPARACION').find((i) => i.informe_id === id && activa_(i)) || null; }

// --- acciones -----------------------------------------------------------------------------
function listar(db, data, contexto) {
  const p = permisos_(db, contexto);
  if (!p.ve) return { _forbidden: true, message: 'La preparación para la certificación es para quien gobierna o supervisa el SGC.' };
  const informes = leer_(db, 'SGC_PREPARACION').filter(activa_).sort((a, b) => String(b.fecha_creacion).localeCompare(String(a.fecha_creacion))).map(resumenInforme_);
  return { informes, puede_gestionar: p.gobierna, preguntas: PREGUNTAS, areas: AREAS };
}

function obtener(db, data, contexto) {
  const p = permisos_(db, contexto);
  if (!p.ve) return { _forbidden: true, message: 'La preparación para la certificación es para quien gobierna o supervisa el SGC.' };
  const d = data || {};
  const informe = d.informe_id ? buscar_(db, d.informe_id) : leer_(db, 'SGC_PREPARACION').filter(activa_).sort((a, b) => String(b.fecha_creacion).localeCompare(String(a.fecha_creacion)))[0];
  if (!informe) return { informe: null, puede_gestionar: p.gobierna, preguntas: PREGUNTAS, areas: AREAS };
  const hoy = (d.hoy && contexto && contexto.rol === 'ADM') ? d.hoy : hoy_();
  return Object.assign(armar_(db, informe, contexto, hoy), { puede_gestionar: p.gobierna && informe.estado !== ESTADOS.EMITIDO });
}

function crear(db, data, contexto) {
  if (!permisos_(db, contexto).gobierna) return { _forbidden: true, message: 'Solo el Encargado del SGC abre una evaluación.' };
  const d = data || {};
  const titulo = texto_(d.titulo, 200);
  if (!titulo) return errorValidacion_('titulo', 'Ponle un nombre a la evaluación (por ejemplo «Versión 1 — diciembre 2026»).');
  const fecha = String(d.fecha_auditoria || '').slice(0, 10);
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return errorValidacion_('fecha_auditoria', 'La fecha de la auditoría no es válida.');
  const anio = hoy_().slice(0, 4);
  const n = leer_(db, 'SGC_PREPARACION').filter((i) => String(i.correlativo || '').indexOf('PREP-' + anio) === 0).length + 1;
  const informe = { informe_id: uuid_(), correlativo: 'PREP-' + anio + '-' + String(n).padStart(2, '0'), titulo, fecha_corte: hoy_(), estado: ESTADOS.BORRADOR,
    conclusion: '', recomendacion: '', fecha_auditoria: fecha, snapshot: '', creado_por: norm_(contexto.email), fecha_creacion: ahora_(),
    emitido_por: '', fecha_emision: '', activa: true };
  agregarFila_(db, 'SGC_PREPARACION', informe);
  const muestras = sortearMuestras_(db, informe.informe_id, hoy_());
  return { informe: resumenInforme_(informe), muestras: muestras.length };
}

function editable_(db, informeId, contexto) {
  if (!permisos_(db, contexto).gobierna) return { _forbidden: true, message: 'Solo el Encargado del SGC registra la evaluación.' };
  const informe = buscar_(db, informeId);
  if (!informe) return errorValidacion_('informe_id', 'La evaluación no existe.');
  if (informe.estado === ESTADOS.EMITIDO) return errorValidacion_('informe_id', 'La evaluación ya se emitió: abre una nueva ronda para volver a medir.');
  return { informe };
}

function guardarEntrevista(db, data, contexto) {
  const d = data || {};
  const ok = editable_(db, d.informe_id, contexto);
  if (!ok.informe) return ok;
  if (!AREAS.some((a) => a.clave === d.area)) return errorValidacion_('area', 'Elige el área.');
  const persona = norm_(d.persona_email);
  if (!persona) return errorValidacion_('persona_email', 'Indica a quién entrevistaste.');
  const respuestas = PREGUNTAS.map((p) => {
    const r = (Array.isArray(d.respuestas) ? d.respuestas : []).find((x) => x && x.pregunta_id === p.id) || {};
    const puntaje = r.puntaje === '' || r.puntaje === null || r.puntaje === undefined ? '' : Number(r.puntaje);
    return { pregunta_id: p.id, respuesta: texto_(r.respuesta, 1500), evidencia: EVIDENCIA.indexOf(r.evidencia) !== -1 ? r.evidencia : '',
      puntaje: puntaje === '' || isNaN(puntaje) ? '' : Math.max(0, Math.min(3, Math.round(puntaje))) };
  });
  if (!respuestas.some((r) => r.puntaje !== '')) return errorValidacion_('respuestas', 'Califica al menos una pregunta (0 a 3).');
  const auto = AUTOEVALUACION.indexOf(d.autoevaluacion) !== -1 ? d.autoevaluacion : '';
  const fila = { informe_id: ok.informe.informe_id, area: d.area, persona_email: persona, persona_nombre: texto_(d.persona_nombre, 120), cargo: texto_(d.cargo, 120),
    entrevistador_email: norm_(contexto.email), fecha: String(d.fecha || hoy_()).slice(0, 10), respuestas, autoevaluacion: auto,
    autoevaluacion_motivo: texto_(d.autoevaluacion_motivo, 1500), comentario: texto_(d.comentario, 2000), actualizado_en: ahora_(), activa: true };
  if (d.entrevista_id) {
    const previa = leer_(db, 'SGC_PREP_ENTREVISTAS').find((e) => e.entrevista_id === d.entrevista_id && e.informe_id === ok.informe.informe_id && activa_(e));
    if (!previa) return errorValidacion_('entrevista_id', 'La entrevista no existe.');
    actualizarFilaPorId_(db, 'SGC_PREP_ENTREVISTAS', 'entrevista_id', d.entrevista_id, fila);
    return Object.assign({ entrevista_id: d.entrevista_id }, fila);
  }
  const nueva = Object.assign({ entrevista_id: uuid_() }, fila);
  agregarFila_(db, 'SGC_PREP_ENTREVISTAS', nueva);
  return nueva;
}

function guardarMuestra(db, data, contexto) {
  const d = data || {};
  const muestra = leer_(db, 'SGC_PREP_MUESTRAS').find((m) => m.muestra_id === d.muestra_id && activa_(m));
  if (!muestra) return errorValidacion_('muestra_id', 'La muestra no existe.');
  const ok = editable_(db, muestra.informe_id, contexto);
  if (!ok.informe) return ok;
  if (RESULTADOS_MUESTRA.indexOf(d.resultado) === -1) return errorValidacion_('resultado', 'Indica si la trazabilidad está completa, parcial o no está.');
  const cambios = { hizo: texto_(d.hizo, 160), reviso: texto_(d.reviso, 160), libero: texto_(d.libero, 160), resultado: d.resultado,
    observacion: texto_(d.observacion, 1000), revisado_por: norm_(contexto.email), fecha_revision: ahora_() };
  actualizarFilaPorId_(db, 'SGC_PREP_MUESTRAS', 'muestra_id', muestra.muestra_id, cambios);
  return Object.assign({}, muestra, cambios);
}

function sortearDeNuevo(db, data, contexto) {
  const d = data || {};
  const ok = editable_(db, d.informe_id, contexto);
  if (!ok.informe) return ok;
  const muestras = leer_(db, 'SGC_PREP_MUESTRAS').filter((m) => activa_(m) && m.informe_id === d.informe_id);
  if (muestras.some((m) => m.resultado)) return errorValidacion_('informe_id', 'Ya hay muestras revisadas: no se vuelven a sortear.');
  muestras.forEach((m) => actualizarFilaPorId_(db, 'SGC_PREP_MUESTRAS', 'muestra_id', m.muestra_id, { activa: false }));
  return { muestras: sortearMuestras_(db, d.informe_id + ':' + ahora_(), hoy_()).length };
}

/** Una brecha se vuelve tarea con responsable y fecha (entra al índice de cumplimiento). */
async function crearTareaBrecha(db, data, contexto) {
  const d = data || {};
  const ok = editable_(db, d.informe_id, contexto);
  if (!ok.informe) return ok;
  const texto = texto_(d.texto, 300);
  if (!texto) return errorValidacion_('texto', 'Describe qué hay que hacer.');
  if (!norm_(d.responsable_email)) return errorValidacion_('responsable_email', 'Elige un responsable.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha_compromiso || ''))) return errorValidacion_('fecha_compromiso', 'Elige la fecha de cumplimiento.');
  const area = AREAS.find((a) => a.clave === d.area);
  return require('./actividades').crear(db, {
    titulo: 'Preparación ISO · ' + (area ? area.nombre + ': ' : '') + texto,
    descripcion: 'Brecha detectada en la evaluación «' + ok.informe.titulo + '» (' + ok.informe.correlativo + '). Cerrarla antes de la auditoría de certificación.',
    responsable_email: norm_(d.responsable_email), fecha_compromiso: d.fecha_compromiso, prioridad: 'P1', origen: 'ASIGNADA',
    requiere_validacion: false, sgc_origen_tipo: 'PREPARACION', sgc_origen_id: ok.informe.informe_id
  }, contexto);
}

function emitir(db, data, contexto) {
  const d = data || {};
  const ok = editable_(db, d.informe_id, contexto);
  if (!ok.informe) return ok;
  const conclusion = texto_(d.conclusion, 4000);
  if (!conclusion) return errorValidacion_('conclusion', 'Escribe la conclusión: es lo primero que leerá gerencia.');
  const vista = armar_(db, ok.informe, contexto, hoy_());
  if (vista.areas.every((a) => a.veredicto === VEREDICTOS.SIN_EVALUAR)) return errorValidacion_('informe_id', 'Antes de emitir hay que evaluar al menos un área.');
  const cambios = { estado: ESTADOS.EMITIDO, conclusion, recomendacion: texto_(d.recomendacion, 2000) || vista.recomendacion.texto,
    snapshot: Object.assign({}, vista, { informe: undefined }), emitido_por: norm_(contexto.email), fecha_emision: ahora_() };
  actualizarFilaPorId_(db, 'SGC_PREPARACION', 'informe_id', ok.informe.informe_id, cambios);
  return resumenInforme_(Object.assign({}, ok.informe, cambios));
}

function actualizar(db, data, contexto) {
  const d = data || {};
  const ok = editable_(db, d.informe_id, contexto);
  if (!ok.informe) return ok;
  const cambios = {};
  if (d.titulo !== undefined) { const t = texto_(d.titulo, 200); if (!t) return errorValidacion_('titulo', 'El nombre no puede quedar vacío.'); cambios.titulo = t; }
  if (d.fecha_auditoria !== undefined) {
    const f = String(d.fecha_auditoria || '').slice(0, 10);
    if (f && !/^\d{4}-\d{2}-\d{2}$/.test(f)) return errorValidacion_('fecha_auditoria', 'La fecha no es válida.');
    cambios.fecha_auditoria = f;
  }
  if (d.conclusion !== undefined) cambios.conclusion = texto_(d.conclusion, 4000);
  actualizarFilaPorId_(db, 'SGC_PREPARACION', 'informe_id', ok.informe.informe_id, cambios);
  return resumenInforme_(Object.assign({}, ok.informe, cambios));
}

module.exports = {
  listar, obtener, crear, actualizar, guardarEntrevista, guardarMuestra, sortearDeNuevo, crearTareaBrecha, emitir,
  veredicto_, recomendacion_, periodoCerrado_, PREGUNTAS, REGLAS, VEREDICTOS, AREAS
};
