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
function finDePeriodo_(p) { const a = Number(p.slice(0, 4)), m = Number(p.slice(6)); return new Date(Date.UTC(a, m, 1, 3, 0, 0) - 1000); }
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
  const horas = (a, b, pausas) => Utils.horasHabilesEntre(a, b, { feriados, pausas: pausas || [] });
  const lista = subs.map((s) => {
    const hs = (hist[s.subsolicitud_id] || []).slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const llega = s.fecha_creacion;
    // Tomarlo es empezar a trabajarlo: un rechazo o una cancelación desde Nueva no cuenta.
    const tomado = hs.find((h) => h.estado_anterior === 'S01' && h.estado_nuevo && h.estado_nuevo !== 'S01' && FINALES.indexOf(h.estado_nuevo) === -1);
    const resuelto = hs.find((h) => RESUELTOS.indexOf(h.estado_nuevo) !== -1);
    // Tramos "Esperando respuesta" (S06): el reloj del equipo se detiene.
    const pausas = [];
    let desde = null;
    hs.forEach((h) => {
      if (h.estado_nuevo === 'S06' && !desde) desde = h.timestamp;
      else if (desde && h.estado_nuevo !== 'S06') { pausas.push({ inicio: desde, fin: h.timestamp }); desde = null; }
    });
    // Sigue esperando al solicitante: la pausa corre hasta hoy (el corte la recorta).
    if (desde) pausas.push({ inicio: desde, fin: new Date().toISOString() });
    const tsResuelto = resuelto ? resuelto.timestamp : (RESUELTOS.indexOf(s.estado) !== -1 && s.fecha_terminada ? s.fecha_terminada : '');
    const plazo = s.sla_objetivo_horas === '' || s.sla_objetivo_horas === null || s.sla_objetivo_horas === undefined ? null : Number(s.sla_objetivo_horas);
    const hResolver = tsResuelto ? horas(llega, tsResuelto, pausas) : null;
    return {
      id: s.subsolicitud_id, solicitud_id: s.solicitud_id, titulo: s.titulo || '', depto: s.depto, depto_nombre: s.depto_nombre || '',
      servicio_id: s.servicio_id || '', servicio: s.servicio_nombre || 'Otro pedido', asignado: String(s.desarrollador_asignado || '').toLowerCase(),
      estado: s.estado, llega, periodo_llega: periodoDe_(llega),
      h_tomar: tomado ? horas(llega, tomado.timestamp) : null,
      ts_resuelto: tsResuelto, periodo_resuelto: tsResuelto ? periodoDe_(tsResuelto) : '',
      h_resolver: hResolver, plazo_h: plazo && isFinite(plazo) ? plazo : null,
      a_tiempo: hResolver !== null && plazo ? hResolver <= plazo : null,
      final: FINALES.indexOf(s.estado) !== -1,
      pausas, horas
    };
  });
  return { lista, horas };
}

/** ¿Abierto y fuera de plazo al corte? (y cuántas horas hábiles de atraso). */
function atrasoAl_(p, corte) {
  if (p.final || !p.plazo_h) return null;
  if (p.ts_resuelto && new Date(p.ts_resuelto) <= corte) return null;
  if (new Date(p.llega) > corte) return null;
  const pausas = p.pausas.map((x) => ({ inicio: x.inicio, fin: new Date(x.fin) > corte ? corte : x.fin }));
  const h = p.horas(p.llega, corte, pausas);
  return h > p.plazo_h ? h - p.plazo_h : null;
}

/** Las cifras de un grupo de pedidos en un mes. */
function agregar_(lista, periodo, corte) {
  const llegaron = lista.filter((p) => p.periodo_llega === periodo);
  const tomados = llegaron.filter((p) => p.h_tomar !== null);
  const resueltos = lista.filter((p) => p.periodo_resuelto === periodo && !p.final);
  const conPlazo = resueltos.filter((p) => p.a_tiempo !== null);
  const aTiempo = conPlazo.filter((p) => p.a_tiempo).length;
  const atrasados = lista.filter((p) => atrasoAl_(p, corte) !== null);
  const abiertos = lista.filter((p) => !p.final && !(p.ts_resuelto && new Date(p.ts_resuelto) <= corte) && new Date(p.llega) <= corte);
  return {
    recibidos: llegaron.length,
    rechazados: llegaron.filter((p) => p.final).length,
    tomados: tomados.length,
    mediana_tomar_h: mediana_(tomados.map((p) => p.h_tomar)),
    resueltos: resueltos.length,
    mediana_resolver_h: mediana_(resueltos.map((p) => p.h_resolver)),
    con_plazo: conPlazo.length, a_tiempo: aTiempo, pct_a_tiempo: pct_(aTiempo, conPlazo.length),
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
  const porPersona = grupos((p) => p.asignado || 'SIN_ASIGNAR', (p) => p.asignado || '')
    .sort((a, b) => (b.abiertos - a.abiertos) || (b.resueltos - a.resueltos));
  const porDepto = depto ? [] : grupos((p) => p.depto, (p) => p.depto_nombre).sort((a, b) => b.recibidos - a.recibidos);
  const atrasados = lista.map((p) => ({ p, h: atrasoAl_(p, corte) })).filter((x) => x.h !== null)
    .sort((a, b) => b.h - a.h).slice(0, 15)
    .map((x) => ({ subsolicitud_id: x.p.id, solicitud_id: x.p.solicitud_id, titulo: x.p.titulo, servicio: x.p.servicio, depto_nombre: x.p.depto_nombre,
      asignado: x.p.asignado, dias_atraso: Math.round(10 * x.h / HORAS_DIA) / 10, estado: x.p.estado }));

  return {
    periodo, periodo_texto: mesAnio_(periodo), en_curso: periodo === periodoActual_(),
    depto, depto_nombre: depto ? (Servicios.departamento_(depto) || {}).nombre : 'Todos los departamentos',
    departamentos: disponibles.map((x) => ({ clave: x.clave, nombre: x.nombre })), puede_todos: esAdm,
    total, serie, por_servicio: porServicio, por_persona: porPersona, por_departamento: porDepto, atrasados,
    horas_dia: HORAS_DIA
  };
}

module.exports = { reporte, resumenArea_, pedidos_, agregar_, mediana_, periodoDe_, HORAS_DIA };
