'use strict';

/**
 * responsabilidades.js — el MAPA DE RESPONSABILIDADES de cada persona (Plan de
 * control y certificación, pieza P2; aprobado 13-11-2026).
 *
 * «Se acaba el no sabía que eso me tocaba» y es la evidencia más directa de
 * roles y responsabilidades que pide el auditor (ISO 9001 §5.3, §7.2, §7.3).
 *
 *  - PROPUESTA: SIGSO arma el mapa juntando lo que ya está escrito: las
 *    responsabilidades del DESCRIPTOR DE CARGO vigente, los PROCESOS donde la
 *    persona es responsable y las obligaciones de la AGENDA de su área.
 *  - La jefatura (o Control/administración) revisa, ajusta frecuencia y cómo
 *    se comprueba, y APRUEBA. Solo lo aprobado se le pide a la persona.
 *  - Cómo se comprueba: AUTOMATICA (SIGSO ya lo ve: Agenda, tareas, SGC) o
 *    EVIDENCIA (la persona la marca hecha en cada período y deja el respaldo:
 *    un enlace al Drive o una descripción). Es el checklist que antes vivía
 *    en papel o en la memoria de cada uno.
 *  - Las de EVIDENCIA semanales y mensuales entran al índice de cumplimiento
 *    (componente C, «Responsabilidades del cargo y SGC»): hecha a tiempo si se
 *    marcó dentro de su período.
 *
 * Quién ve qué: cada persona su mapa; la jefatura el de su equipo (y lo
 * edita); Control/administración/gerencia, el de toda la empresa.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');

const TZ = 'America/Santiago';
const FRECUENCIAS = ['DIARIA', 'SEMANAL', 'MENSUAL', 'TRIMESTRAL', 'ANUAL', 'EVENTUAL'];
const MEDICIONES = ['AUTOMATICA', 'EVIDENCIA'];
const ESTADOS = { PROPUESTA: 'PROPUESTA', APROBADA: 'APROBADA' };
const ORIGENES = { DESCRIPTOR: 'Descriptor de cargo', PROCESO: 'Proceso a cargo', AGENDA: 'Agenda del área', MANUAL: 'Agregada por la jefatura' };
/** Frecuencias que entran al índice (las demás se registran, pero no se miden por mes). */
const MEDIBLES = ['SEMANAL', 'MENSUAL'];

function leer_(db, t) { try { return leerFilas_(db, t, COLUMNAS[t]); } catch (e) { return []; } }
function norm_(e) { return String(e || '').trim().toLowerCase(); }
function verdadero_(v) { return v === true || v === 'TRUE' || v === 1 || v === 'true'; }
function activa_(f) { return f.activa === undefined || f.activa === '' || verdadero_(f.activa); }
function hoy_() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); }
function ahora_() { return new Date().toISOString(); }
function uuid_() { return crypto.randomUUID(); }
function texto_(v, tope) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, tope || 500); }
function errorValidacion_(campo, message) { return { _validationError: true, campo, message }; }
function sumarDias_(dia, n) { return new Date(Date.parse(dia + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
function lunesDe_(dia) { const d = new Date(dia + 'T00:00:00Z'); return sumarDias_(dia, -((d.getUTCDay() + 6) % 7)); }
function ultimoDiaMes_(a, m) { return a + '-' + String(m).padStart(2, '0') + '-' + String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0'); }
function diaDe_(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

/** Período que contiene `dia` para una frecuencia: { clave, desde, hasta }. */
function periodoDe_(frecuencia, dia) {
  const a = Number(dia.slice(0, 4)), m = Number(dia.slice(5, 7));
  if (frecuencia === 'DIARIA') return { clave: 'D:' + dia, desde: dia, hasta: dia };
  if (frecuencia === 'SEMANAL') { const l = lunesDe_(dia); return { clave: 'S:' + l, desde: l, hasta: sumarDias_(l, 6) }; }
  if (frecuencia === 'MENSUAL') return { clave: 'M:' + dia.slice(0, 7), desde: dia.slice(0, 8) + '01', hasta: ultimoDiaMes_(a, m) };
  if (frecuencia === 'TRIMESTRAL') { const t = Math.ceil(m / 3); return { clave: 'T:' + a + '-' + t, desde: a + '-' + String(t * 3 - 2).padStart(2, '0') + '-01', hasta: ultimoDiaMes_(a, t * 3) }; }
  if (frecuencia === 'ANUAL') return { clave: 'A:' + a, desde: a + '-01-01', hasta: a + '-12-31' };
  return { clave: 'E', desde: '', hasta: '' };
}

/** Frecuencia probable según el texto (la jefatura la corrige al revisar). */
function frecuenciaDelTexto_(t) {
  const s = String(t || '').toLowerCase();
  if (/diari|cada d[ií]a|todos los d[ií]as/.test(s)) return 'DIARIA';
  if (/semanal|cada semana|lunes|viernes/.test(s)) return 'SEMANAL';
  if (/trimestr/.test(s)) return 'TRIMESTRAL';
  if (/anual|cada año|una vez al año|renta|balance anual/.test(s)) return 'ANUAL';
  if (/cuando|ante |en caso|eventual|según se requiera/.test(s)) return 'EVENTUAL';
  return 'MENSUAL';
}

// --- permisos ------------------------------------------------------------------------
function equipo_(db, contexto) {
  try { return require('./jefatura').obtenerEquipoJefe_(db, contexto && contexto.email).map(norm_); } catch (e) { return []; }
}
function veEmpresa_(db, contexto) {
  if (!contexto) return false;
  if (contexto.rol === 'ADM' || contexto.rol === 'GERENCIA') return true;
  try { return require('./calidadSgc').gobiernaSgc_(db, contexto); } catch (e) { return false; }
}
function puedeEditar_(db, contexto, persona) {
  if (!contexto) return false;
  if (contexto.rol === 'ADM') return true;
  try { if (require('./calidadSgc').gobiernaSgc_(db, contexto)) return true; } catch (e) { /* */ }
  return equipo_(db, contexto).indexOf(norm_(persona)) !== -1;
}
function puedeVer_(db, contexto, persona) {
  return norm_(contexto && contexto.email) === norm_(persona) || veEmpresa_(db, contexto) || equipo_(db, contexto).indexOf(norm_(persona)) !== -1;
}

// --- propuesta --------------------------------------------------------------------------
function propuestaPara_(db, persona) {
  const items = [];
  const ficha = leer_(db, 'SGC_PERSONAS').find((p) => activa_(p) && norm_(p.usuario_email) === persona);
  if (ficha) {
    const desc = leer_(db, 'SGC_DESCRIPTORES').find((d) => d.persona_id === ficha.persona_id && verdadero_(d.vigente));
    let lista = desc ? desc.items_responsabilidades : [];
    if (typeof lista === 'string') { try { lista = JSON.parse(lista); } catch (e) { lista = lista.split('\n'); } }
    (Array.isArray(lista) ? lista : []).map((s) => texto_(s)).filter(Boolean).forEach((t, i) => {
      items.push({ texto: t, origen: 'DESCRIPTOR', origen_ref: (desc.descriptor_id || '') + '#' + i, frecuencia: frecuenciaDelTexto_(t), medicion: 'EVIDENCIA', fuente_auto: '' });
    });
  }
  leer_(db, 'SGC_PROCESOS').filter((p) => activa_(p) && norm_(p.responsable_email) === persona && p.estado !== 'OBSOLETO').forEach((p) => {
    items.push({ texto: 'Mantener al día los registros del proceso ' + (p.codigo ? p.codigo + ' ' : '') + (p.nombre || '') + ' y revisar sus indicadores',
      origen: 'PROCESO', origen_ref: p.proceso_id, frecuencia: 'MENSUAL', medicion: 'EVIDENCIA', fuente_auto: '' });
  });
  // Obligaciones de la Agenda de las áreas donde registra: SIGSO ya las mide.
  let Agenda = null;
  try { Agenda = require('./agendaDepto'); } catch (e) { /* */ }
  const deptos = leer_(db, 'CI_MIEMBROS').filter((m) => activa_(m) && norm_(m.usuario_email) === persona && m.rol !== 'LECTURA').map((m) => m.depto);
  if (Agenda) {
    deptos.filter((d, i, t) => t.indexOf(d) === i).forEach((dep) => {
      let obls = [];
      try { obls = Agenda.obligaciones_(db, dep); } catch (e) { obls = []; }
      obls.filter((o) => o.tipo === 'INTERNO').forEach((o) => {
        items.push({ texto: o.nombre, origen: 'AGENDA', origen_ref: o.obligacion_id, frecuencia: frecuenciaDelTexto_(o.nombre + ' ' + (o.descripcion || '')), medicion: 'AUTOMATICA', fuente_auto: 'Agenda del área' });
      });
    });
  }
  return items;
}

// --- estado de un ítem en el período actual --------------------------------------------
function estadoItem_(item, registros, hoy) {
  if (item.medicion === 'AUTOMATICA') return { periodo: '', estado: 'AUTOMATICA', texto: 'SIGSO lo mide: ' + (item.fuente_auto || 'datos del sistema') };
  const p = periodoDe_(item.frecuencia, hoy);
  const reg = registros.find((r) => r.resp_id === item.resp_id && r.periodo === p.clave && activa_(r));
  if (reg) return { periodo: p.clave, hasta: p.hasta, estado: 'HECHA', registro: { registro_id: reg.registro_id, hecho_en: diaDe_(reg.hecho_en), evidencia: reg.evidencia, nota: reg.nota } };
  if (item.frecuencia === 'EVENTUAL') return { periodo: 'E', estado: 'EVENTUAL', texto: 'Se registra cada vez que ocurre' };
  return { periodo: p.clave, hasta: p.hasta, estado: 'PENDIENTE' };
}

function resumenItem_(i, registros, hoy) {
  return Object.assign({ resp_id: i.resp_id, texto: i.texto, origen: i.origen, origen_txt: ORIGENES[i.origen] || i.origen, frecuencia: i.frecuencia,
    medicion: i.medicion, fuente_auto: i.fuente_auto || '', estado_mapa: i.estado, aprobado_por: i.aprobado_por || '', fecha_aprobacion: i.fecha_aprobacion || '' },
  { periodo_actual: estadoItem_(i, registros, hoy) });
}

function mapaDe_(db, persona, hoy) {
  const items = leer_(db, 'RESP_MAPA').filter((i) => activa_(i) && norm_(i.persona_email) === persona);
  const registros = leer_(db, 'RESP_REGISTROS').filter((r) => activa_(r) && norm_(r.persona_email) === persona);
  const lista = items.map((i) => resumenItem_(i, registros, hoy))
    .sort((a, b) => FRECUENCIAS.indexOf(a.frecuencia) - FRECUENCIAS.indexOf(b.frecuencia) || String(a.texto).localeCompare(String(b.texto), 'es'));
  const aprob = lista.filter((i) => i.estado_mapa === ESTADOS.APROBADA);
  const conEvidencia = aprob.filter((i) => i.medicion === 'EVIDENCIA' && i.frecuencia !== 'EVENTUAL');
  return {
    items: lista,
    resumen: { total: lista.length, aprobadas: aprob.length, propuestas: lista.length - aprob.length,
      con_evidencia: conEvidencia.length, hechas: conEvidencia.filter((i) => i.periodo_actual.estado === 'HECHA').length,
      automaticas: aprob.filter((i) => i.medicion === 'AUTOMATICA').length }
  };
}

function nombres_(db) {
  const m = {};
  leer_(db, 'USUARIOS').forEach((u) => { if (u.email) m[norm_(u.email)] = u.nombre || u.email; });
  leer_(db, 'SGC_PERSONAS').forEach((p) => { if (p.usuario_email && p.nombre) m[norm_(p.usuario_email)] = m[norm_(p.usuario_email)] || p.nombre; });
  return m;
}
function cargo_(db, persona) {
  const f = leer_(db, 'SGC_PERSONAS').find((p) => activa_(p) && norm_(p.usuario_email) === persona);
  return f ? f.cargo || '' : '';
}

// --- acciones -------------------------------------------------------------------------------
/**
 * listar({ alcance?: 'yo'|'equipo'|'empresa', email? })
 *  - 'yo' o `email`: el mapa completo de una persona.
 *  - 'equipo' / 'empresa': una fila por persona con su resumen.
 */
function listar(db, data, contexto) {
  const d = data || {};
  const yo = norm_(contexto && contexto.email);
  if (!yo) return { _forbidden: true, message: 'Ingresa de nuevo.' };
  const hoy = hoy_();
  const nombres = nombres_(db);
  if (d.email || !d.alcance || d.alcance === 'yo') {
    const quien = norm_(d.email || yo);
    if (!puedeVer_(db, contexto, quien)) return { _forbidden: true, message: 'Solo puedes ver el mapa de tu equipo.' };
    return Object.assign(mapaDe_(db, quien, hoy), { email: quien, nombre: nombres[quien] || quien, cargo: cargo_(db, quien),
      puede_editar: puedeEditar_(db, contexto, quien), es_propio: quien === yo, frecuencias: FRECUENCIAS, origenes: ORIGENES });
  }
  let lista;
  if (d.alcance === 'empresa') {
    if (!veEmpresa_(db, contexto)) return { _forbidden: true, message: 'La vista de toda la empresa es para Control, administración y gerencia.' };
    const set = {};
    leer_(db, 'SGC_PERSONAS').filter((p) => activa_(p) && p.usuario_email && p.estado !== 'DESVINCULADO').forEach((p) => { set[norm_(p.usuario_email)] = true; });
    leer_(db, 'RESP_MAPA').filter(activa_).forEach((i) => { set[norm_(i.persona_email)] = true; });
    lista = Object.keys(set);
  } else lista = equipo_(db, contexto);
  const personas = lista.map((e) => {
    const m = mapaDe_(db, e, hoy);
    return { email: e, nombre: nombres[e] || e, cargo: cargo_(db, e), resumen: m.resumen, puede_editar: puedeEditar_(db, contexto, e) };
  }).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  return { alcance: d.alcance, personas,
    resumen: { personas: personas.length, sin_mapa: personas.filter((p) => !p.resumen.total).length,
      por_aprobar: personas.filter((p) => p.resumen.propuestas).length, aprobados: personas.filter((p) => p.resumen.aprobadas && !p.resumen.propuestas).length } };
}

function proponer(db, data, contexto) {
  const persona = norm_(data && data.email);
  if (!persona) return errorValidacion_('email', 'Falta la persona.');
  if (!puedeEditar_(db, contexto, persona)) return { _forbidden: true, message: 'Solo la jefatura o Control arman el mapa.' };
  const existentes = leer_(db, 'RESP_MAPA').filter((i) => norm_(i.persona_email) === persona);
  const ya = {};
  existentes.forEach((i) => { if (i.origen_ref) ya[i.origen + '|' + i.origen_ref] = true; });
  const nuevos = propuestaPara_(db, persona).filter((i) => !ya[i.origen + '|' + i.origen_ref]);
  nuevos.forEach((i) => agregarFila_(db, 'RESP_MAPA', Object.assign({ resp_id: uuid_(), persona_email: persona, estado: ESTADOS.PROPUESTA,
    creado_por: norm_(contexto.email), fecha_creacion: ahora_(), aprobado_por: '', fecha_aprobacion: '', activa: true }, i)));
  return { agregadas: nuevos.length, sin_fuentes: !nuevos.length && !existentes.length };
}

function guardar(db, data, contexto) {
  const d = data || {};
  const previo = d.resp_id ? leer_(db, 'RESP_MAPA').find((i) => i.resp_id === d.resp_id && activa_(i)) : null;
  if (d.resp_id && !previo) return errorValidacion_('resp_id', 'La responsabilidad no existe.');
  const persona = norm_(previo ? previo.persona_email : d.persona_email);
  if (!persona) return errorValidacion_('persona_email', 'Falta la persona.');
  if (!puedeEditar_(db, contexto, persona)) return { _forbidden: true, message: 'Solo la jefatura o Control editan el mapa.' };
  const texto = d.texto !== undefined ? texto_(d.texto) : (previo ? previo.texto : '');
  if (!texto) return errorValidacion_('texto', 'Escribe la responsabilidad.');
  const frecuencia = d.frecuencia !== undefined ? d.frecuencia : (previo ? previo.frecuencia : 'MENSUAL');
  if (FRECUENCIAS.indexOf(frecuencia) === -1) return errorValidacion_('frecuencia', 'Elige la frecuencia.');
  const medicion = d.medicion !== undefined ? d.medicion : (previo ? previo.medicion : 'EVIDENCIA');
  if (MEDICIONES.indexOf(medicion) === -1) return errorValidacion_('medicion', 'Elige cómo se comprueba.');
  const campos = { texto, frecuencia, medicion, fuente_auto: medicion === 'AUTOMATICA' ? (texto_(d.fuente_auto, 120) || (previo && previo.fuente_auto) || 'datos del sistema') : '' };
  if (previo) {
    // Cambiar lo que se exige devuelve la responsabilidad a propuesta: la jefatura la vuelve a aprobar.
    const cambia = campos.texto !== previo.texto || campos.frecuencia !== previo.frecuencia || campos.medicion !== previo.medicion;
    if (cambia && previo.estado === ESTADOS.APROBADA && !d.aprobar) Object.assign(campos, { estado: ESTADOS.PROPUESTA, aprobado_por: '', fecha_aprobacion: '' });
    if (d.aprobar) Object.assign(campos, { estado: ESTADOS.APROBADA, aprobado_por: norm_(contexto.email), fecha_aprobacion: ahora_() });
    actualizarFilaPorId_(db, 'RESP_MAPA', 'resp_id', previo.resp_id, campos);
    return Object.assign({}, previo, campos);
  }
  const nuevo = Object.assign({ resp_id: uuid_(), persona_email: persona, origen: 'MANUAL', origen_ref: '', creado_por: norm_(contexto.email), fecha_creacion: ahora_(), activa: true,
    estado: d.aprobar ? ESTADOS.APROBADA : ESTADOS.PROPUESTA, aprobado_por: d.aprobar ? norm_(contexto.email) : '', fecha_aprobacion: d.aprobar ? ahora_() : '' }, campos);
  agregarFila_(db, 'RESP_MAPA', nuevo);
  return nuevo;
}

function quitar(db, data, contexto) {
  const i = leer_(db, 'RESP_MAPA').find((x) => x.resp_id === (data && data.resp_id) && activa_(x));
  if (!i) return errorValidacion_('resp_id', 'La responsabilidad no existe.');
  if (!puedeEditar_(db, contexto, i.persona_email)) return { _forbidden: true, message: 'Solo la jefatura o Control editan el mapa.' };
  actualizarFilaPorId_(db, 'RESP_MAPA', 'resp_id', i.resp_id, { activa: false });
  return { resp_id: i.resp_id, quitada: true };
}

function aprobar(db, data, contexto) {
  const persona = norm_(data && data.email);
  if (!persona) return errorValidacion_('email', 'Falta la persona.');
  if (!puedeEditar_(db, contexto, persona)) return { _forbidden: true, message: 'Solo la jefatura o Control aprueban el mapa.' };
  const propuestas = leer_(db, 'RESP_MAPA').filter((i) => activa_(i) && norm_(i.persona_email) === persona && i.estado === ESTADOS.PROPUESTA);
  if (!propuestas.length) return errorValidacion_('email', 'No hay responsabilidades por aprobar.');
  const cambios = { estado: ESTADOS.APROBADA, aprobado_por: norm_(contexto.email), fecha_aprobacion: ahora_() };
  propuestas.forEach((i) => actualizarFilaPorId_(db, 'RESP_MAPA', 'resp_id', i.resp_id, cambios));
  try {
    require('./notificacionesApp').encolarLote(db, [{ destinatario: persona, tipo: 'RESPONSABILIDADES_APROBADAS', titulo: 'Tu mapa de responsabilidades está aprobado',
      mensaje: 'Revisa qué te toca y marca las que se comprueban con evidencia en «Mis responsabilidades».', modulo_id: 'mi_trabajo', texto_accion: 'Ver mis responsabilidades', vidaHoras: 168 }]);
  } catch (e) { /* el aviso nunca bloquea la aprobación */ }
  return { aprobadas: propuestas.length };
}

/** La persona marca hecha una responsabilidad con evidencia en el período actual. */
function registrar(db, data, contexto) {
  const d = data || {};
  const i = leer_(db, 'RESP_MAPA').find((x) => x.resp_id === d.resp_id && activa_(x));
  if (!i) return errorValidacion_('resp_id', 'La responsabilidad no existe.');
  const yo = norm_(contexto && contexto.email);
  if (norm_(i.persona_email) !== yo) return { _forbidden: true, message: 'Cada persona marca sus propias responsabilidades.' };
  if (i.estado !== ESTADOS.APROBADA) return errorValidacion_('resp_id', 'Tu jefatura todavía no aprueba esta responsabilidad.');
  if (i.medicion !== 'EVIDENCIA') return errorValidacion_('resp_id', 'Esta la mide SIGSO solo: no hay que marcarla.');
  const evidencia = texto_(d.evidencia, 600);
  if (!evidencia) return errorValidacion_('evidencia', 'Deja el respaldo: un enlace al Drive o qué hiciste y dónde quedó.');
  const p = periodoDe_(i.frecuencia, hoy_());
  const clave = i.frecuencia === 'EVENTUAL' ? 'E:' + hoy_() : p.clave;
  const previo = leer_(db, 'RESP_REGISTROS').find((r) => activa_(r) && r.resp_id === i.resp_id && r.periodo === clave);
  if (previo) {
    actualizarFilaPorId_(db, 'RESP_REGISTROS', 'registro_id', previo.registro_id, { evidencia, nota: texto_(d.nota, 600) });
    return Object.assign({}, previo, { evidencia });
  }
  const reg = { registro_id: uuid_(), resp_id: i.resp_id, persona_email: yo, periodo: clave, hecho_en: ahora_(), evidencia, nota: texto_(d.nota, 600), activa: true };
  agregarFila_(db, 'RESP_REGISTROS', reg);
  return reg;
}
function deshacer(db, data, contexto) {
  const r = leer_(db, 'RESP_REGISTROS').find((x) => x.registro_id === (data && data.registro_id) && activa_(x));
  if (!r) return errorValidacion_('registro_id', 'El registro no existe.');
  if (norm_(r.persona_email) !== norm_(contexto && contexto.email)) return { _forbidden: true, message: 'Solo quien lo marcó lo puede deshacer.' };
  actualizarFilaPorId_(db, 'RESP_REGISTROS', 'registro_id', r.registro_id, { activa: false });
  return { registro_id: r.registro_id, deshecho: true };
}

/**
 * Casos para el índice de cumplimiento (componente C): responsabilidades
 * APROBADAS con evidencia, semanales y mensuales, cuyo período terminó dentro
 * del mes medido (hasta `corte`). A tiempo = marcada dentro de su período.
 */
function casosIndice_(db, persona, desde, corte, cache, hoy) {
  const c = cache || {};
  const items = (c.mapa || (c.mapa = leer_(db, 'RESP_MAPA').filter(activa_)))
    .filter((i) => norm_(i.persona_email) === persona && i.estado === ESTADOS.APROBADA && i.medicion === 'EVIDENCIA' && MEDIBLES.indexOf(i.frecuencia) !== -1);
  if (!items.length) return [];
  const regs = (c.registros || (c.registros = leer_(db, 'RESP_REGISTROS').filter(activa_))).filter((r) => norm_(r.persona_email) === persona);
  const casos = [];
  items.forEach((i) => {
    const aprobadaDesde = diaDe_(i.fecha_aprobacion) || desde;
    // Recorre los períodos que terminan entre desde y corte.
    let dia = desde;
    const vistos = {};
    while (dia <= corte) {
      const p = periodoDe_(i.frecuencia, dia);
      dia = sumarDias_(p.hasta, 1);
      if (vistos[p.clave] || p.hasta < desde || p.hasta > corte || p.hasta < aprobadaDesde) { vistos[p.clave] = true; continue; }
      vistos[p.clave] = true;
      const reg = regs.find((r) => r.resp_id === i.resp_id && r.periodo === p.clave);
      const hecho = reg ? diaDe_(reg.hecho_en) : '';
      if (!hecho && hoy && p.hasta >= hoy) continue; // el período termina hoy: todavía se puede marcar
      casos.push({ tipo: 'Responsabilidad del cargo', referencia: i.texto, plazo: p.hasta, hecho, ok: !!hecho && hecho <= p.hasta });
    }
  });
  return casos;
}

module.exports = { listar, proponer, guardar, quitar, aprobar, registrar, deshacer, casosIndice_, periodoDe_, frecuenciaDelTexto_, FRECUENCIAS, ESTADOS };
