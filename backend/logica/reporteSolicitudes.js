'use strict';

/**
 * reporteSolicitudes.js — Solicitudes, etapa 4 (auditoría 2026-10-05): los
 * reportes de los pedidos a los departamentos.
 *
 * Por departamento, por servicio y por persona: cuántos pedidos llegaron,
 * cuánto se tardó en tomarlos, cuánto en resolverlos y cuántos se resolvieron
 * dentro del plazo de su servicio. Se mide en HORAS HÁBILES con la misma regla
 * que la Bandeja (Utils.horasHabilesEntre: 09:00–18:00, sin fines de semana ni
 * feriados de CONFIG_FERIADOS).
 *
 * Definiciones (las mismas en la pantalla y en el informe mensual del área):
 *  - Tomado: el pedido sale de "Nueva" (alguien lo tomó, lo recibió o lo empezó).
 *    Tiempo hasta tomarlo = de la llegada a esa primera salida.
 *  - Resuelto: entra a "Resuelta" (o se cierra directo). El tiempo que estuvo
 *    "Esperando respuesta" del solicitante NO cuenta: ese reloj es suyo.
 *  - A tiempo: resuelto dentro del plazo del servicio (sla_objetivo_horas, que
 *    el servicio fija al crearse: días hábiles × 9 h).
 *  - Atrasado: abierto (no resuelto, rechazado ni cancelado) y con el plazo
 *    vencido a la fecha de corte.
 * Los rechazados y cancelados no entran al cumplimiento: se informan aparte.
 *
 * Se conecta al informe mensual de cada área: indicadoresDepto.js toma
 * kpisDelArea_ (tema "Pedidos internos").
 */

const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Utils = require('./utils');
const Servicios = require('./serviciosSolicitud');

const HORAS_DIA = 9;
const FINALES = ['S10', 'S11'];          // rechazado / cancelado: fuera del cumplimiento
const RESUELTOS = ['S08', 'S09'];
const MESES_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function leer_(db, t) { try { return leerFilas_(db, t, COLUMNAS[t]); } catch (e) { return []; } }
function fechaLocal_(v) {
  const d = v instanceof Date ? v : new Date(String(v || '').replace(' ', 'T'));
  return isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(d);
}
function periodoDe_(v) { const f = fechaLocal_(v); return f ? f.slice(0, 4) + '-M' + f.slice(5, 7) : ''; }
function moverPeriodo_(p, n) {
  const a = Number(p.slice(0, 4)), m = Number(p.slice(6)) - 1 + n;
  const y = a + Math.floor(m / 12), mm = ((m % 12) + 12) % 12 + 1;
  return y + '-M' + String(mm).padStart(2, '0');
}
function periodoActual_() { return periodoDe_(new Date()); }
function mesAnio_(p) { const m = /^(\d{4})-M(\d{2})$/.exec(p || ''); return m ? MESES_[Number(m[2]) - 1] + ' de ' + m[1] : String(p || ''); }
/** Fin del mes (último instante, hora de Chile aproximada con UTC-3) — corte para "atrasado". */
// Último segundo del mes en Chile (medianoche local real: UTC−3 en verano, UTC−4 en invierno).
function finDePeriodo_(p) {
  const sig = moverPeriodo_(p, 1);
  return new Date(Utils.instanteLocal_(sig.slice(0, 4) + '-' + sig.slice(6) + '-01', 0, 0, 'America/Santiago').getTime() - 1000);
}
function mediana_(xs) {
  const v = xs.filter((x) => x !== null && x !== undefined && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const k = Math.floor(v.length / 2);
  return Math.round((v.length % 2 ? v[k] : (v[k - 1] + v[k]) / 2) * 10) / 10;
}
function pct_(a, b) { return b ? Math.round(1000 * a / b) / 10 : null; }

/**
 * Los pedidos a departamentos con sus tiempos ya calculados. Se lee una vez
 * por llamada (SUBSOLICITUDES + HISTORIAL_ESTADOS) y se reutiliza para todos
 * los meses y cortes.
 */
function pedidos_(db) {
  let feriados = [];
  try { feriados = require('./cumplimiento').obtenerFeriados(db).map((f) => String(f).slice(0, 10)); } catch (e) { /* sin feriados */ }
  const subs = leer_(db, 'SUBSOLICITUDES').filter((s) => s.depto);
  const ids = new Set(subs.map((s) => s.subsolicitud_id));
  const hist = {};
  leer_(db, 'HISTORIAL_ESTADOS').forEach((h) => {
    if (!ids.has(h.subsolicitud_id)) return;
    (hist[h.subsolicitud_id] = hist[h.subsolicitud_id] || []).push(h);
  });
  // Revisión Codex Tanda 2 (H1): el responsable y el plazo que tenía cada ítem EN CADA FECHA,
  // desde HISTORIAL_ASIGNACION y HISTORIAL_PRIORIDAD (un cambio de hoy no reescribe agosto).
  const itemsDeSol = {};
  subs.forEach((s) => { (itemsDeSol[s.solicitud_id] = itemsDeSol[s.solicitud_id] || []).push(s.subsolicitud_id); });
  const asig = {}, prio = {};
  leer_(db, 'HISTORIAL_ASIGNACION').forEach((h) => {
    const empuja = (id, ant) => { if (ids.has(id)) (asig[id] = asig[id] || []).push({ ts: h.timestamp, ant: String(ant || '').toLowerCase(), nuevo: String(h.responsable_nuevo || '').toLowerCase() }); };
    if (h.subsolicitud_id) return empuja(h.subsolicitud_id, h.responsable_anterior);
    let mapa = null;
    try { mapa = h.detalle_items ? JSON.parse(h.detalle_items) : null; } catch (e) { mapa = null; }
    if (mapa && typeof mapa === 'object') Object.keys(mapa).forEach((id) => empuja(id, mapa[id]));
    else (itemsDeSol[h.solicitud_id] || []).forEach((id) => empuja(id, h.responsable_anterior)); // fila antigua: toda la solicitud
  });
  leer_(db, 'HISTORIAL_PRIORIDAD').forEach((h) => {
    if (!ids.has(h.subsolicitud_id)) return;
    const num = (v) => (v === '' || v === null || v === undefined || !isFinite(Number(v)) ? null : Number(v));
    (prio[h.subsolicitud_id] = prio[h.subsolicitud_id] || []).push({ ts: h.timestamp, ant: num(h.sla_anterior_horas), nuevo: num(h.sla_nuevo_horas) });
  });
  const porFecha = (a, b) => new Date(a.ts) - new Date(b.ts);
  Object.keys(asig).forEach((k) => asig[k].sort(porFecha));
  Object.keys(prio).forEach((k) => prio[k].sort(porFecha));
  const horas = (a, b, pausas) => Utils.horasHabilesEntre(a, b, { feriados, pausas: pausas || [] });
  const lista = subs.map((s) => {
    const hs = (hist[s.subsolicitud_id] || []).slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const llega = s.fecha_creacion;
    // Tomarlo es empezar a trabajarlo: un rechazo o una cancelación desde Nueva no cuenta.
    const tomado = hs.find((h) => h.estado_anterior === 'S01' && h.estado_nuevo && h.estado_nuevo !== 'S01' && FINALES.indexOf(h.estado_nuevo) === -1);
    // Tramos "Esperando respuesta" (S06): el reloj del equipo se detiene.
    // Sigue esperando al solicitante: la pausa corre hasta hoy (el corte la recorta).
    // D-005 (E2-3): el mismo cálculo que la cola y el detalle (Cumplimiento).
    const pausas = require('./cumplimiento').pausasEsperandoSolicitante(hs, new Date());
    // D-005 E2-7: un ítem puede resolverse, reabrirse y resolverse otra vez. Se guarda
    // cada RESOLUCIÓN (entrada a S08/S09 desde un estado no resuelto) y los tramos en
    // que estuvo resuelto; el estado se reconstruye al corte de cada mes (un cambio
    // posterior no altera un mes ya cerrado).
    const cambios = hs.filter((h) => h.estado_nuevo).map((h) => ({ ts: h.timestamp, estado: h.estado_nuevo }));
    const resoluciones = [], tramosResueltos = [];
    let desdeResuelto = null;
    cambios.forEach((c) => {
      const r = RESUELTOS.indexOf(c.estado) !== -1;
      if (r && !desdeResuelto) { resoluciones.push(c.ts); desdeResuelto = c.ts; }
      else if (!r && desdeResuelto) { tramosResueltos.push({ inicio: desdeResuelto, fin: c.ts }); desdeResuelto = null; }
    });
    if (desdeResuelto) tramosResueltos.push({ inicio: desdeResuelto, fin: new Date().toISOString() });
    // Sin historial (datos antiguos): la fecha de término, si está resuelto.
    if (!cambios.length && RESUELTOS.indexOf(s.estado) !== -1 && s.fecha_terminada) resoluciones.push(s.fecha_terminada);
    const estadoAl = (corte) => {
      let e = null;
      cambios.forEach((c) => { if (new Date(c.ts) <= corte) e = c.estado; });
      if (e) return e;
      if (cambios.length) return 'S01';
      return resoluciones[0] && new Date(resoluciones[0]) <= corte ? 'S08' : (FINALES.indexOf(s.estado) !== -1 ? s.estado : 'S01');
    };
    // Horas del equipo hasta `ts`: sin esperas al solicitante ni tramos ya resueltos.
    const recorta = (lista, ts) => lista.filter((x) => new Date(x.inicio) < new Date(ts)).map((x) => ({ inicio: x.inicio, fin: new Date(x.fin) > new Date(ts) ? ts : x.fin }));
    const horasHasta = (ts) => horas(llega, ts, recorta(pausas, ts).concat(recorta(tramosResueltos, ts)));
    const tsResuelto = resoluciones.length ? resoluciones[resoluciones.length - 1] : '';
    const plazo = s.sla_objetivo_horas === '' || s.sla_objetivo_horas === null || s.sla_objetivo_horas === undefined ? null : Number(s.sla_objetivo_horas);
    const plazoHoy = plazo && isFinite(plazo) ? plazo : null, quienHoy = String(s.desarrollador_asignado || '').toLowerCase();
    // Lo vigente en `ts`: el último cambio hasta esa fecha; antes del primero, lo que había
    // «antes» de él. Registros antiguos sin ese dato usan el valor de hoy y quedan marcados
    // (`dato_actual`), para que el reporte lo diga en vez de atribuirlo en silencio.
    const vigente = (lista, ts, actual) => {
      if (!lista || !lista.length) return { v: actual, actual: false };
      const t = new Date(ts);
      let u = null;
      lista.forEach((c) => { if (new Date(c.ts) <= t) u = c; });
      const v = u ? u.nuevo : lista[0].ant;
      return v === null || v === undefined || v === '' ? { v: actual, actual: true } : { v, actual: false };
    };
    const plazoAl = (ts) => vigente(prio[s.subsolicitud_id], ts, plazoHoy);
    const asignadoAl = (ts) => vigente(asig[s.subsolicitud_id], ts, quienHoy).v;
    const hResolver = tsResuelto ? horasHasta(tsResuelto) : null;
    return {
      id: s.subsolicitud_id, solicitud_id: s.solicitud_id, titulo: s.titulo || '', depto: s.depto, depto_nombre: s.depto_nombre || '',
      servicio_id: s.servicio_id || '', servicio: s.servicio_nombre || 'Otro pedido', asignado: String(s.desarrollador_asignado || '').toLowerCase(),
      estado: s.estado, llega, periodo_llega: periodoDe_(llega),
      h_tomar: tomado ? horas(llega, tomado.timestamp) : null, ts_tomado: tomado ? tomado.timestamp : '',
      ts_resuelto: tsResuelto, periodo_resuelto: tsResuelto ? periodoDe_(tsResuelto) : '',
      h_resolver: hResolver, plazo_h: plazo && isFinite(plazo) ? plazo : null,
      a_tiempo: hResolver !== null && plazo ? hResolver <= plazo : null,
      final: FINALES.indexOf(s.estado) !== -1,
      pausas, horas, resoluciones, estadoAl, horasHasta, plazoAl, asignadoAl
    };
  });
  return { lista, horas };
}

/** ¿Abierto y fuera de plazo al corte? (y cuántas horas hábiles de atraso). */
/** ¿Abierto al corte? (según el estado que tenía ESE día, no el de hoy). */
function abiertoAl_(p, corte) {
  if (new Date(p.llega) > corte) return false;
  const e = p.estadoAl(corte);
  return RESUELTOS.indexOf(e) === -1 && FINALES.indexOf(e) === -1;
}
function atrasoAl_(p, corte) {
  const ts = corte instanceof Date ? corte.toISOString() : corte;
  const plazo = p.plazoAl(ts).v;
  if (!plazo || !abiertoAl_(p, corte)) return null;
  const h = p.horasHasta(ts);
  return h > plazo ? h - plazo : null;
}
/** La resolución del ítem que cae en ese mes (la última, si hubo varias) o null. */
function resolucionEn_(p, periodo) {
  const ts = p.resoluciones.filter((t) => periodoDe_(t) === periodo).pop();
  if (!ts) return null;
  const h = p.horasHasta(ts), plazo = p.plazoAl(ts);
  return { ts, h, a_tiempo: plazo.v ? h <= plazo.v : null, dato_actual: plazo.actual };
}

/** Las cifras de un grupo de pedidos en un mes. Resueltos = ítems con una resolución en el mes. */
function agregar_(lista, periodo, corte) {
  const llegaron = lista.filter((p) => p.periodo_llega === periodo);
  // Revisión Codex Tanda 2: tomado y rechazado según lo que había pasado AL CORTE (un mes
  // cerrado no cambia porque el ítem se tome o se cancele después).
  const tomados = llegaron.filter((p) => p.h_tomar !== null && new Date(p.ts_tomado) <= corte);
  const resueltos = lista.map((p) => resolucionEn_(p, periodo)).filter(Boolean);
  const conPlazo = resueltos.filter((r) => r.a_tiempo !== null);
  const aTiempo = conPlazo.filter((r) => r.a_tiempo).length;
  const atrasados = lista.filter((p) => atrasoAl_(p, corte) !== null);
  const abiertos = lista.filter((p) => abiertoAl_(p, corte));
  return {
    recibidos: llegaron.length,
    rechazados: llegaron.filter((p) => FINALES.indexOf(p.estadoAl(corte)) !== -1).length,
    tomados: tomados.length,
    mediana_tomar_h: mediana_(tomados.map((p) => p.h_tomar)),
    resueltos: resueltos.length,
    mediana_resolver_h: mediana_(resueltos.map((r) => r.h)),
    con_plazo: conPlazo.length, a_tiempo: aTiempo, pct_a_tiempo: pct_(aTiempo, conPlazo.length),
    // Resueltos medidos con el plazo de HOY por falta de historial (registros antiguos).
    con_dato_actual: conPlazo.filter((r) => r.dato_actual).length,
    abiertos: abiertos.length, atrasados: atrasados.length
  };
}

/** Cifras de un área en un mes, con la serie de 12 meses (para el informe mensual). */
function resumenArea_(db, depto, periodo, cache) {
  const datos = cache && cache.pedidos ? cache.pedidos : pedidos_(db);
  if (cache) cache.pedidos = datos;
  const lista = datos.lista.filter((p) => p.depto === depto);
  const ahora = new Date();
  const corteDe = (p) => { const f = finDePeriodo_(p); return f > ahora ? ahora : f; };
  const meses = [];
  for (let i = 11; i >= 0; i--) meses.push(moverPeriodo_(periodo, -i));
  const serie = meses.map((p) => Object.assign({ periodo: p }, agregar_(lista, p, corteDe(p))));
  return { lista, mes: serie[serie.length - 1], serie, corte: corteDe(periodo) };
}

// --- acción: el reporte de la Bandeja ------------------------------------------------------
function puedeVer_(db, contexto, depto) {
  if (contexto && contexto.rol === 'ADM') return true;
  return !!Servicios.rolesEnDeptos_(db, contexto)[depto];
}

/**
 * data: { depto (vacío = todos, solo ADM), periodo ('2026-M10'; por defecto el mes en curso) }.
 * Devuelve las cifras del mes, la serie de 6 meses, por servicio, por persona
 * (carga y cumplimiento) y los pedidos atrasados.
 */
function reporte(db, data, contexto) {
  const d = data || {};
  const esAdm = contexto && contexto.rol === 'ADM';
  const roles = Servicios.rolesEnDeptos_(db, contexto);
  const disponibles = Servicios.departamentos_().filter((x) => esAdm || roles[x.clave]);
  if (!disponibles.length) return { _forbidden: true, message: 'Los reportes de pedidos los ven quienes están en la lista de un departamento.' };
  const depto = String(d.depto || '').toUpperCase();
  if (depto && !puedeVer_(db, contexto, depto)) return { _forbidden: true, message: 'No estás en la lista de ese departamento.' };
  if (!depto && !esAdm) return { ok: false, message: 'Elige un departamento.' };
  const periodo = /^\d{4}-M(0[1-9]|1[0-2])$/.test(String(d.periodo || '')) ? d.periodo : periodoActual_();
  const datos = pedidos_(db);
  const lista = datos.lista.filter((p) => !depto || p.depto === depto);
  const ahora = new Date();
  const corteDe = (p) => { const f = finDePeriodo_(p); return f > ahora ? ahora : f; };
  const corte = corteDe(periodo);

  const total = agregar_(lista, periodo, corte);
  const serie = [];
  for (let i = 5; i >= 0; i--) { const p = moverPeriodo_(periodo, -i); serie.push(Object.assign({ periodo: p, periodo_texto: mesAnio_(p) }, agregar_(lista, p, corteDe(p)))); }

  const grupos = (clave, nombre) => {
    const g = {};
    lista.forEach((p) => { const k = clave(p); if (k === null) return; (g[k] = g[k] || { clave: k, nombre: nombre(p), items: [] }).items.push(p); });
    return Object.keys(g).map((k) => Object.assign({ clave: g[k].clave, nombre: g[k].nombre }, agregar_(g[k].items, periodo, corte)))
      .filter((x) => x.recibidos || x.resueltos || x.abiertos);
  };
  const porServicio = grupos((p) => (depto ? '' : p.depto + '|') + (p.servicio_id || 'OTRO'), (p) => (depto ? '' : p.depto_nombre + ' · ') + p.servicio)
    .sort((a, b) => (b.recibidos - a.recibidos) || (b.abiertos - a.abiertos));
  // Por persona: quien lo tenía AL CORTE (no quien lo tiene hoy).
  const quien = (p) => p.asignadoAl(corte.toISOString());
  const porPersona = grupos((p) => quien(p) || 'SIN_ASIGNAR', (p) => quien(p) || '')
    .sort((a, b) => (b.abiertos - a.abiertos) || (b.resueltos - a.resueltos));
  const porDepto = depto ? [] : grupos((p) => p.depto, (p) => p.depto_nombre).sort((a, b) => b.recibidos - a.recibidos);
  const atrasados = lista.map((p) => ({ p, h: atrasoAl_(p, corte) })).filter((x) => x.h !== null)
    .sort((a, b) => b.h - a.h).slice(0, 15)
    .map((x) => ({ subsolicitud_id: x.p.id, solicitud_id: x.p.solicitud_id, titulo: x.p.titulo, servicio: x.p.servicio, depto_nombre: x.p.depto_nombre,
      asignado: quien(x.p), dias_atraso: Math.round(10 * x.h / HORAS_DIA) / 10, estado: x.p.estadoAl(corte) }));

  return {
    periodo, periodo_texto: mesAnio_(periodo), en_curso: periodo === periodoActual_(),
    depto, depto_nombre: depto ? (Servicios.departamento_(depto) || {}).nombre : 'Todos los departamentos',
    departamentos: disponibles.map((x) => ({ clave: x.clave, nombre: x.nombre })), puede_todos: esAdm,
    total, serie, por_servicio: porServicio, por_persona: porPersona, por_departamento: porDepto, atrasados,
    horas_dia: HORAS_DIA
  };
}

module.exports = { reporte, resumenArea_, pedidos_, agregar_, mediana_, periodoDe_, finDePeriodo_, HORAS_DIA };
