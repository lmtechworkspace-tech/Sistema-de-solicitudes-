'use strict';

/**
 * cumplimientoResponsables.js — el ÍNDICE DE CUMPLIMIENTO por responsable
 * (Plan de control y certificación, pieza P3; aprobado por el dueño el
 * 13-11-2026 «con lo recomendado»).
 *
 * Pedido de gerencia en la reunión de cierre de año: «incorporar el
 * porcentaje de cumplimiento de las responsabilidades de cada uno» y
 * «controlar sin tener que perseguir a cada persona». No se pide registrar
 * nada nuevo: el índice sale de lo que ya se anota al trabajar.
 *
 * Índice del mes = Σ (peso × cumplimiento) ÷ Σ pesos de los componentes con
 * al menos MIN_CASOS casos (con menos, una sola tarea definiría el mes):
 *
 *   A · Compromisos con fecha   35  tareas que vencieron en el mes y se
 *                                   entregaron a tiempo
 *   B · Obligaciones del área   25  tareas internas de la Agenda del área
 *                                   (comité, pre-IVA, informes…) hechas a tiempo
 *   C · Responsabilidades SGC   20  acuses de documentos y etapas de no
 *                                   conformidades dentro de su plazo
 *   D · Reportabilidad          20  reporte mensual del área (autor día hábil 3,
 *                                   jefatura día hábil 5) + tareas abiertas que
 *                                   no están dormidas
 *
 * Reglas para que el número sea justo y no se pueda maquillar (decisiones
 * del dueño, sección 5 del plan):
 *  - Se mide contra la FECHA ORIGINAL. Una reprogramación solo mueve la meta
 *    si la hizo OTRA persona (supervisor, jefatura, administración) ANTES de
 *    que venciera la meta vigente. Reprogramarse a uno mismo, o después del
 *    vencimiento, no borra el atraso.
 *  - Una tarea con validación se mide por el día en que la persona la
 *    ENTREGÓ, no por el día en que el supervisor la aprobó.
 *  - Bloqueada por otra persona desde antes de vencer: queda neutra (no suma
 *    ni resta) y se lista aparte.
 *  - Lo que vence HOY y sigue abierto todavía no es atraso.
 *  - Señales que no entran a la fórmula pero se muestran siempre: tareas sin
 *    fecha, tareas dormidas (abiertas y sin movimiento en DIAS_DORMIDA días) y
 *    reprogramaciones del mes (y cuántas no cuentan).
 *
 * Quién ve qué (decisión 4): cada persona lo suyo; la jefatura su equipo
 * (JEFATURAS + jefatura de área); gerencia, administración y el encargado
 * del SGC, toda la empresa. Sin ranking entre compañeros: el orden de la
 * lista es alfabético, no por puntaje.
 */

const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { DEPARTAMENTOS } = require('./controlInternoMatrices');

const TZ = 'America/Santiago';
const DIA_MS = 86400000;
const MIN_CASOS = 3;
const DIAS_DORMIDA = 14;
const PESOS = { A: 35, B: 25, C: 20, D: 20 };
const NOMBRES = {
  A: 'Compromisos con fecha',
  B: 'Obligaciones del área',
  C: 'Responsabilidades del SGC',
  D: 'Reportabilidad'
};
const CORTES = { ok: 90, alerta: 75 };
const TERMINALES = ['TERMINADA', 'CANCELADA'];
const ETAPAS_NC = [
  { etapa: 'Corrección', plazo: 'correccion_plazo', cierre: 'correccion_fecha_cierre' },
  { etapa: 'Acción correctiva', plazo: 'accion_plazo', cierre: 'accion_fecha_cierre' },
  { etapa: 'Verificación de eficacia', plazo: 'eficacia_plazo', cierre: 'eficacia_fecha' }
];

// --- utilidades ------------------------------------------------------------------
function leer_(db, t) { try { return leerFilas_(db, t, COLUMNAS[t]); } catch (e) { return []; } }
function norm_(e) { return String(e || '').trim().toLowerCase(); }
function verdadero_(v) { return v === true || v === 'TRUE' || v === 1 || v === 'true'; }
function activa_(f) { return f.activa === undefined || f.activa === '' || verdadero_(f.activa); }
function json_(v) { if (v && typeof v === 'object') return v; try { return v ? JSON.parse(v) : {}; } catch (e) { return {}; } }
function hoy_() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); }

/**
 * Día (YYYY-MM-DD) de una fecha guardada. Dos familias:
 *  - fechas de PLAN (compromiso, plazo, límite): se guardan como día o como
 *    medianoche UTC de ese día → se toma la parte de la fecha tal cual (así lo
 *    lee también el semáforo de Actividades, con componentes UTC);
 *  - instantes REALES (terminó, acusó, envió): un timestamp → día de Chile.
 * Un 'YYYY-MM-DD' suelto siempre es ese día (convertirlo a Chile lo correría
 * al día anterior).
 */
function diaPlan_(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}
function diaReal_(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}
function restarDias_(dia, n) { return new Date(Date.parse(dia + 'T00:00:00Z') - n * DIA_MS).toISOString().slice(0, 10); }
function pct_(ok, tot) { return tot ? Math.round((ok / tot) * 1000) / 10 : null; }
function estado_(p) { return p === null ? 'sin_dato' : (p >= CORTES.ok ? 'ok' : (p >= CORTES.alerta ? 'alerta' : 'critico')); }

/** '2026-11' → { desde, hasta, ci: '2026-M11' }. */
function periodo_(periodo) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periodo || ''));
  const base = m ? { a: Number(m[1]), m: Number(m[2]) } : { a: Number(hoy_().slice(0, 4)), m: Number(hoy_().slice(5, 7)) };
  const mm = String(base.m).padStart(2, '0');
  const ultimo = new Date(Date.UTC(base.a, base.m, 0)).getUTCDate();
  return { periodo: base.a + '-' + mm, desde: base.a + '-' + mm + '-01', hasta: base.a + '-' + mm + '-' + String(ultimo).padStart(2, '0'), ci: base.a + '-M' + mm };
}
const MESES_HISTORIA = 6;
// Desde cuándo existen las herramientas que se miden (no se puede exigir
// antes): la Agenda de los departamentos y el reporte mensual del área
// partieron en octubre de 2026 (el primer reporte, el de septiembre).
const INICIO_AGENDA = '2026-M10';
const INICIO_REPORTES = '2026-10-01';
/** '2026-11' ± k meses → 'YYYY-MM'. */
function moverPeriodo_(periodo, k) {
  const a = Number(periodo.slice(0, 4)), m = Number(periodo.slice(5, 7)) - 1 + k;
  const aa = a + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  return aa + '-' + String(mm + 1).padStart(2, '0');
}
function periodoCiAnterior_(ci) {
  const a = Number(ci.slice(0, 4)), m = Number(ci.slice(6));
  return m === 1 ? (a - 1) + '-M12' : a + '-M' + String(m - 1).padStart(2, '0');
}

// --- A · compromisos con fecha -------------------------------------------------------
/**
 * La meta de una tarea: la fecha original, corrida solo por reprogramaciones
 * que hizo otra persona antes de que venciera la meta de ese momento.
 */
function metaDeTarea_(a, eventos) {
  const reprog = eventos.filter((e) => e.tipo === 'REPROGRAMACION').sort((x, y) => String(x.timestamp).localeCompare(String(y.timestamp)));
  const primera = reprog.length ? diaPlan_(json_(reprog[0].datos).fecha_anterior) : '';
  const original = primera || diaPlan_(a.fecha_compromiso);
  let meta = original;
  const detalle = [];
  reprog.forEach((e) => {
    const d = json_(e.datos);
    const nueva = diaPlan_(d.fecha_nueva);
    const cuando = diaReal_(e.timestamp);
    const porOtro = norm_(e.autor_email) && norm_(e.autor_email) !== norm_(a.responsable_email);
    const aTiempo = !!meta && cuando <= meta;
    const cuenta = !!nueva && porOtro && aTiempo;
    detalle.push({ dia: cuando, de: diaPlan_(d.fecha_anterior), a: nueva, por: e.autor_email || '', cuenta,
      motivo_no_cuenta: cuenta ? '' : (!porOtro ? 'la reprogramó la misma persona' : 'se reprogramó después de vencer') });
    if (cuenta) meta = nueva;
  });
  return { original, meta, reprogramaciones: detalle };
}

/** Día en que la persona cumplió: el de su última entrega si pasó por validación. */
function diaEntrega_(a, eventos) {
  const entregas = eventos.filter((e) => e.tipo === 'ENTREGA').map((e) => diaReal_(e.timestamp)).filter(Boolean).sort();
  if (a.estado === 'EN_REVISION') return entregas.length ? entregas[entregas.length - 1] : '';
  if (a.estado !== 'TERMINADA') return '';
  if (verdadero_(a.requiere_validacion) && entregas.length) return entregas[entregas.length - 1];
  return diaReal_(a.fecha_terminada);
}

function ultimoMovimiento_(a, eventos, corte) {
  const dias = [diaReal_(a.fecha_creacion), diaPlan_(a.fecha_inicio_real)]
    .concat(eventos.map((e) => diaReal_(e.timestamp)))
    .filter((d) => d && d <= corte);
  return dias.sort().pop() || '';
}

function compromisos_(tareas, eventosPor, per, corte, hoy) {
  const casos = [], neutras = [], abiertas = [], senales = { sin_fecha: [], dormidas: [], reprogramaciones: 0, reprogramaciones_que_no_cuentan: 0 };
  const limiteDormida = restarDias_(corte, DIAS_DORMIDA);
  tareas.forEach((a) => {
    const ev = eventosPor[a.actividad_id] || [];
    const m = metaDeTarea_(a, ev);
    m.reprogramaciones.filter((r) => r.dia >= per.desde && r.dia <= corte).forEach((r) => {
      senales.reprogramaciones++;
      if (!r.cuenta) senales.reprogramaciones_que_no_cuentan++;
    });
    const creada = diaReal_(a.fecha_creacion);
    const entrega = diaEntrega_(a, ev);
    const abiertaAlCorte = a.estado !== 'CANCELADA' && (!entrega || entrega > corte) && (!creada || creada <= corte);
    if (abiertaAlCorte) {
      abiertas.push(a);
      const porConfirmar = a.fecha_propuesta && !a.confirmada_en;
      if (!m.meta && !porConfirmar) senales.sin_fecha.push({ actividad_id: a.actividad_id, titulo: a.titulo });
      const ultimo = ultimoMovimiento_(a, ev, corte);
      if (ultimo && ultimo < limiteDormida) senales.dormidas.push({ actividad_id: a.actividad_id, titulo: a.titulo, sin_movimiento_desde: ultimo });
    }
    if (a.estado === 'CANCELADA' || !m.meta || m.meta < per.desde || m.meta > corte) return;
    if (!entrega && m.meta >= hoy) return; // vence hoy y sigue abierta: todavía no es atraso
    const base = { actividad_id: a.actividad_id, titulo: a.titulo, fecha_original: m.original, meta: m.meta, entregada: entrega || '',
      reprogramaciones: m.reprogramaciones };
    const bloqueadaPorOtro = a.estado === 'BLOQUEADA' && norm_(a.bloqueo_responsable_email) && norm_(a.bloqueo_responsable_email) !== norm_(a.responsable_email) &&
      diaReal_(a.bloqueo_desde) && diaReal_(a.bloqueo_desde) <= m.meta;
    if (bloqueadaPorOtro) { neutras.push(Object.assign(base, { motivo: 'Bloqueada por ' + a.bloqueo_responsable_email })); return; }
    const ok = !!entrega && entrega <= m.meta;
    casos.push(Object.assign(base, { ok, estado: ok ? 'A tiempo' : (entrega ? 'Tarde' : 'Atrasada') }));
  });
  return { casos, neutras, senales, abiertas };
}

// --- B · obligaciones del área (Agenda) ---------------------------------------------------
function obligacionesArea_(db, deptos, per, corte, hoy) {
  // Antes de que existiera la Agenda (octubre de 2026) nadie podía marcar
  // nada: medirlo sería contar como «sin hacer» lo que no tenía dónde anotarse.
  if (!deptos.length || per.ci < INICIO_AGENDA) return [];
  let Agenda;
  try { Agenda = require('./agendaDepto'); } catch (e) { return []; }
  const casos = [];
  deptos.forEach((dep) => {
    let c;
    try { c = Agenda.cumplimientoMes_(db, dep, per.ci, corte); } catch (e) { return; }
    const nombre = (DEPARTAMENTOS.find((d) => d.clave === dep) || {}).nombre || dep;
    (c.internas || []).forEach((x) => {
      if (x.estado === 'SIN_HACER' && x.fecha >= hoy) return;
      casos.push({ area: nombre, tarea: x.tarea + ' · ' + x.obligacion, fecha: x.fecha, hecho: x.hecho || '', ok: x.estado === 'A_TIEMPO',
        estado: x.estado === 'A_TIEMPO' ? 'A tiempo' : (x.estado === 'TARDE' ? 'Tarde' : 'Sin hacer') });
    });
  });
  return casos;
}

// --- C · responsabilidades del SGC ---------------------------------------------------------
function sgc_(db, email, datos, per, corte, hoy) {
  const casos = [];
  // Acuses: documentos vigentes que piden acuse, con fecha límite en el mes.
  datos.documentos.forEach((d) => {
    const limite = diaPlan_(d.fecha_limite_acuse);
    if (!limite || limite < per.desde || limite > corte) return;
    if (datos.audiencia(d).indexOf(email) === -1) return;
    const acuse = datos.acuses.find((a) => a.documento_id === d.documento_id && a.version === d.version_vigente && norm_(a.usuario_email) === email);
    const dia = acuse ? diaReal_(acuse.acusado_en) : '';
    if (!dia && limite >= hoy) return;
    casos.push({ tipo: 'Acuse de documento', referencia: (d.codigo ? d.codigo + ' ' : '') + (d.nombre || ''), plazo: limite, hecho: dia, ok: !!dia && dia <= limite });
  });
  // Etapas de no conformidades a su cargo con plazo en el mes.
  datos.nc.filter((n) => norm_(n.responsable_email) === email && n.estado !== 'ANULADA').forEach((n) => {
    ETAPAS_NC.forEach((e) => {
      const plazo = diaPlan_(n[e.plazo]);
      if (!plazo || plazo < per.desde || plazo > corte) return;
      const cierre = diaReal_(n[e.cierre]);
      if (!cierre && plazo >= hoy) return;
      casos.push({ tipo: 'No conformidad · ' + e.etapa, referencia: n.correlativo || n.nc_id, plazo, hecho: cierre, ok: !!cierre && cierre <= plazo });
    });
  });
  return casos.map((c) => Object.assign(c, { estado: c.ok ? 'A tiempo' : (c.hecho ? 'Tarde' : 'Sin hacer') }));
}

// --- D · reportabilidad ------------------------------------------------------------------------
function reportabilidad_(datos, email, miembro, per, corte, hoy, tareasAbiertas, dormidas) {
  const casos = [];
  const informado = periodoCiAnterior_(per.ci);
  miembro.forEach((m) => {
    const dep = DEPARTAMENTOS.find((d) => d.clave === m.depto);
    if (!dep || dep.reporta === false || dep.recibe) return;
    const rep = datos.reportes.find((r) => r.depto === m.depto && r.periodo === informado && r.tipo === 'MENSUAL' && activa_(r));
    const pasos = m.rol === 'JEFATURA'
      ? [{ que: 'Validar el reporte mensual', dia: 5, hecho: rep ? diaReal_(rep.fecha_validacion) : '' }]
      : [{ que: 'Enviar el reporte mensual', dia: 3, hecho: rep ? diaReal_(rep.fecha_envio) : '' }];
    pasos.forEach((p) => {
      const plazo = datos.diaHabil(informado, p.dia);
      if (!plazo || plazo < per.desde || plazo > corte || plazo < INICIO_REPORTES) return;
      if (!p.hecho && plazo >= hoy) return;
      casos.push({ tipo: p.que + ' · ' + dep.nombre, plazo, hecho: p.hecho, ok: !!p.hecho && p.hecho <= plazo, estado: p.hecho ? (p.hecho <= plazo ? 'A tiempo' : 'Tarde') : 'Sin hacer' });
    });
  });
  const idsDormidas = {};
  dormidas.forEach((d) => { idsDormidas[d.actividad_id] = true; });
  tareasAbiertas.forEach((a) => {
    const dormida = !!idsDormidas[a.actividad_id];
    casos.push({ tipo: 'Tarea abierta con movimiento en ' + DIAS_DORMIDA + ' días', referencia: a.titulo, ok: !dormida, estado: dormida ? 'Dormida' : 'Al día' });
  });
  return casos;
}

// --- armado -------------------------------------------------------------------------------------
function componente_(clave, casos, extra) {
  const ok = casos.filter((c) => c.ok).length;
  const aplica = casos.length >= MIN_CASOS;
  return Object.assign({ clave, nombre: NOMBRES[clave], peso: PESOS[clave], casos: casos.length, cumplidos: ok,
    pct: pct_(ok, casos.length), aplica, detalle: casos }, extra || {});
}
function indice_(componentes) {
  const usados = componentes.filter((c) => c.aplica);
  const pesos = usados.reduce((s, c) => s + c.peso, 0);
  if (!pesos) return null;
  return Math.round((usados.reduce((s, c) => s + c.peso * c.pct, 0) / pesos) * 10) / 10;
}

function cargarDatos_(db) {
  const eventosPor = {};
  leer_(db, 'ACTIVIDADES_BITACORA').forEach((b) => { (eventosPor[b.actividad_id] = eventosPor[b.actividad_id] || []).push(b); });
  let vigente = () => true;
  try { vigente = require('./actividades').filtroProyectoVigente_(db); } catch (e) { /* sin proyectos */ }
  const tareas = leer_(db, 'ACTIVIDADES').filter((a) => verdadero_(a.activa) && vigente(a));
  let audienciaDe = () => [];
  try {
    const Calidad = require('./calidadSgc');
    if (typeof Calidad.audienciaDocumentoSgc_ === 'function') audienciaDe = (d) => Calidad.audienciaDocumentoSgc_(db, d).map(norm_);
  } catch (e) { /* sin SGC */ }
  const cacheAud = {};
  let feriados = new Set();
  try { feriados = new Set(require('./cumplimiento').obtenerFeriados(db).map((f) => String(f).slice(0, 10))); } catch (e) { /* */ }
  let diaHabil = () => '';
  try { const IG = require('./informesGestion'); diaHabil = (p, n) => IG.diaHabil_(p, n, feriados); } catch (e) { /* */ }
  return {
    tareas, eventosPor,
    documentos: leer_(db, 'SGC_DOCUMENTOS').filter((d) => activa_(d) && d.estado === 'VIGENTE' && verdadero_(d.requiere_acuse)),
    acuses: leer_(db, 'SGC_DOC_ACUSES'),
    audiencia: (d) => (cacheAud[d.documento_id] = cacheAud[d.documento_id] || audienciaDe(d)),
    nc: leer_(db, 'SGC_NC').filter(activa_),
    reportes: leer_(db, 'DEP_REPORTES'),
    miembros: leer_(db, 'CI_MIEMBROS').filter(activa_),
    diaHabil
  };
}

/** Cálculo de una persona para un mes. `hoy` se puede fijar (pruebas). */
function calcularPersona_(db, email, periodo, opciones) {
  const o = opciones || {};
  const hoy = o.hoy || hoy_();
  const per = periodo_(periodo);
  const corte = hoy < per.hasta ? hoy : per.hasta;
  const datos = o.datos || cargarDatos_(db);
  const yo = norm_(email);
  const mias = datos.tareas.filter((a) => norm_(a.responsable_email) === yo);
  const A = compromisos_(mias, datos.eventosPor, per, corte, hoy);
  const miembro = datos.miembros.filter((m) => norm_(m.usuario_email) === yo && m.rol !== 'LECTURA');
  const B = obligacionesArea_(db, miembro.map((m) => m.depto).filter((d, i, t) => t.indexOf(d) === i), per, corte, hoy);
  const C = sgc_(db, yo, datos, per, corte, hoy);
  const D = reportabilidad_(datos, yo, miembro, per, corte, hoy, A.abiertas, A.senales.dormidas);
  const componentes = [componente_('A', A.casos, { neutras: A.neutras }), componente_('B', B), componente_('C', C), componente_('D', D)];
  const indice = indice_(componentes);
  return {
    email: yo, periodo: per.periodo, corte, indice, estado: estado_(indice),
    explicacion: indice === null ? 'Sin datos suficientes este mes: ningún componente tuvo ' + MIN_CASOS + ' casos o más.' : '',
    componentes,
    senales: {
      sin_fecha: A.senales.sin_fecha.length, dormidas: A.senales.dormidas.length,
      reprogramaciones: A.senales.reprogramaciones, reprogramaciones_que_no_cuentan: A.senales.reprogramaciones_que_no_cuentan,
      detalle_sin_fecha: A.senales.sin_fecha, detalle_dormidas: A.senales.dormidas
    }
  };
}

// --- permisos y acción pública -------------------------------------------------------------------
function veEmpresa_(db, contexto) {
  if (!contexto) return false;
  if (contexto.rol === 'ADM' || contexto.rol === 'GERENCIA') return true;
  if ((contexto.modulos || []).indexOf('gerencia') !== -1) return true;
  const yo = norm_(contexto.email);
  return leer_(db, 'SGC_ROLES').some((r) => verdadero_(r.activo) && norm_(r.usuario_email) === yo && ['ENCARGADO_SGC', 'DIRECCION'].indexOf(r.rol_sgc) !== -1);
}
function equipo_(db, contexto) {
  try { return require('./jefatura').obtenerEquipoJefe_(db, contexto && contexto.email).map(norm_); } catch (e) { return []; }
}
function nombres_(db) {
  const m = {};
  leer_(db, 'USUARIOS').forEach((u) => { if (u.email) m[norm_(u.email)] = u.nombre || u.email; });
  return m;
}
function personasEmpresa_(db, datos) {
  const set = {};
  leer_(db, 'USUARIOS').filter((u) => u.email && (u.activo === undefined || u.activo === '' || verdadero_(u.activo))).forEach((u) => { set[norm_(u.email)] = true; });
  datos.tareas.forEach((a) => { if (a.responsable_email && !TERMINALES.includes(a.estado)) set[norm_(a.responsable_email)] = true; });
  return Object.keys(set);
}
function resumenPersona_(r, nombre) {
  return { email: r.email, nombre, indice: r.indice, estado: r.estado,
    componentes: r.componentes.map((c) => ({ clave: c.clave, nombre: c.nombre, pct: c.pct, casos: c.casos, aplica: c.aplica })),
    senales: { sin_fecha: r.senales.sin_fecha, dormidas: r.senales.dormidas, reprogramaciones: r.senales.reprogramaciones, reprogramaciones_que_no_cuentan: r.senales.reprogramaciones_que_no_cuentan } };
}

/**
 * getCumplimientoResponsables({ periodo?: 'YYYY-MM', alcance?: 'yo'|'equipo'|'empresa', email? })
 *  - alcance 'yo' (por defecto) o un `email`: el detalle completo de una persona.
 *  - 'equipo' / 'empresa': la lista resumida (sin detalle) y el promedio.
 */
function getCumplimiento(db, data, contexto) {
  const d = data || {};
  const yo = norm_(contexto && contexto.email);
  if (!yo) return { _forbidden: true, message: 'Ingresa de nuevo para ver el cumplimiento.' };
  const empresa = veEmpresa_(db, contexto);
  const equipo = equipo_(db, contexto);
  const nombres = nombres_(db);
  const datos = cargarDatos_(db);
  const opciones = { datos, hoy: d.hoy && (contexto.rol === 'ADM') ? d.hoy : undefined };

  if (d.email || !d.alcance || d.alcance === 'yo') {
    const quien = norm_(d.email || yo);
    if (quien !== yo && !empresa && equipo.indexOf(quien) === -1) return { _forbidden: true, message: 'Solo puedes ver el cumplimiento de tu equipo.' };
    const r = calcularPersona_(db, quien, d.periodo, opciones);
    // Tendencia: el índice de los meses anteriores con la misma regla (los
    // datos ya están leídos: solo se recalcula).
    const historial = [];
    for (let k = MESES_HISTORIA - 1; k >= 1; k--) {
      const p = moverPeriodo_(r.periodo, -k);
      const h = calcularPersona_(db, quien, p, opciones);
      historial.push({ periodo: p, indice: h.indice, estado: h.estado });
    }
    historial.push({ periodo: r.periodo, indice: r.indice, estado: r.estado });
    return Object.assign(r, { nombre: nombres[quien] || quien, pesos: PESOS, cortes: CORTES, min_casos: MIN_CASOS, dias_dormida: DIAS_DORMIDA, historial });
  }
  let lista;
  if (d.alcance === 'empresa') {
    if (!empresa) return { _forbidden: true, message: 'La vista de toda la empresa es para Gerencia y Control.' };
    lista = personasEmpresa_(db, datos);
  } else {
    lista = equipo;
    if (!lista.length) return { periodo: periodo_(d.periodo).periodo, personas: [], resumen: { personas: 0, indice_promedio: null } };
  }
  // En la empresa se omite a quien no tiene nada que medir (cuentas sin
  // trabajo asignado); la jefatura, en cambio, ve a todo su equipo.
  const anterior = moverPeriodo_(periodo_(d.periodo).periodo, -1);
  const personas = lista.map((e) => {
    const p = resumenPersona_(calcularPersona_(db, e, d.periodo, opciones), nombres[e] || e);
    p.indice_anterior = calcularPersona_(db, e, anterior, opciones).indice;
    return p;
  })
    .filter((p) => d.alcance !== 'empresa' || p.indice !== null || p.senales.sin_fecha || p.senales.dormidas)
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  const conIndice = personas.filter((p) => p.indice !== null);
  const promedio = conIndice.length ? Math.round((conIndice.reduce((s, p) => s + p.indice, 0) / conIndice.length) * 10) / 10 : null;
  const conAnterior = personas.filter((p) => p.indice_anterior !== null && p.indice_anterior !== undefined);
  const promedioAnterior = conAnterior.length ? Math.round((conAnterior.reduce((s, p) => s + p.indice_anterior, 0) / conAnterior.length) * 10) / 10 : null;
  const reparto = { ok: 0, alerta: 0, critico: 0, sin_dato: 0 };
  personas.forEach((p) => { reparto[p.estado] = (reparto[p.estado] || 0) + 1; });
  return {
    periodo: periodo_(d.periodo).periodo, alcance: d.alcance, pesos: PESOS, cortes: CORTES,
    personas,
    resumen: {
      personas: personas.length, con_indice: conIndice.length, indice_promedio: promedio, estado: estado_(promedio),
      indice_promedio_anterior: promedioAnterior, periodo_anterior: anterior, reparto,
      en_rojo: conIndice.filter((p) => p.estado === 'critico').length,
      sin_fecha: personas.reduce((s, p) => s + p.senales.sin_fecha, 0),
      dormidas: personas.reduce((s, p) => s + p.senales.dormidas, 0)
    }
  };
}

module.exports = {
  getCumplimiento, calcularPersona_, metaDeTarea_, diaEntrega_, periodo_, moverPeriodo_, diaPlan_, diaReal_,
  // Para el aviso semanal (avisoCumplimiento.js): mismos datos y mismas personas.
  cargarDatos_, personasEmpresa_,
  PESOS, CORTES, MIN_CASOS, DIAS_DORMIDA
};
