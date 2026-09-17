'use strict';

/**
 * pausas.js — puerto de backend/backoffice/Pausas.gs (v6.0-v7.2), modulo de
 * Control de Pausas Activas.
 *
 * Cubre: configuracion por empresa, coordinadores, roster de trabajadores,
 * programacion diaria (maquina de estados de la pausa), registro del
 * trabajador (individual + pasada de lista grupal), panel del coordinador,
 * reportes de cumplimiento (coordinador + gerencia, con rachas por area y
 * tendencia semanal), historial por trabajador, clima emocional, y los
 * avisos por correo (recordatorio, ultima llamada, aviso a coordinadora,
 * escalada a admin, resumen diario, reporte periodico) via triggers.
 *
 * Diferencias deliberadas, documentadas:
 *  - EVIDENCIA de la charla (foto) y los PDF descargables (reporte de
 *    cumplimiento / gerencia) NO se portan: dependen de almacenamiento de
 *    archivos (R2, pendiente) y de un motor HTML->PDF. `finalizar` con
 *    evidencia y las dos acciones de PDF devuelven un error claro. El reporte
 *    en DATOS (getReporteCumplimiento/getReporteGerencia) si funciona.
 *  - El ENLACE MAGICO personal de los correos (entrar directo al modulo sin
 *    clave) todavia no se porta -- los correos salen igual, con el texto
 *    "entra a la plataforma" en vez del boton. enlaceMagicoPausas_ devuelve
 *    '' (mismo caso que el .gs ya maneja cuando no hay sitio configurado).
 *  - Correos via Notificaciones.enviarCorreoModulo (mismo transporte/dedup/
 *    cola); el HTML branded lo genera el transporte desde el texto plano.
 *  - Sin memoizacion global; se lee fresco de SQLite (barato).
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, agregarFilas_, actualizarFilaPorId_, eliminarFilasPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion, errorForbidden } = require('./errores');
const { claveDia_ } = require('./utils');
const { parsearListaPortal } = require('./portal');
const Notificaciones = require('./notificaciones');
const NotificacionesApp = require('./notificacionesApp');

const TZ = 'America/Santiago';
const PAUSAS_TIPOS_COORDINADOR = ['titular', 'reemplazo'];

const ESTADOS_PAUSA = {
  PROGRAMADA: 'Programada', RECORDATORIO_ENVIADO: 'Recordatorio_enviado', EN_CURSO: 'En_curso',
  REALIZADA: 'Realizada', CERRADA: 'Cerrada', SUSPENDIDA: 'Suspendida',
  NO_REALIZADA: 'No_realizada', CANCELADA: 'Cancelada'
};
const ESTADOS_PAUSA_TERMINALES = ['Cerrada', 'No_realizada', 'Cancelada'];
const PAUSAS_ESTADOS_REGISTRABLES = ['Programada', 'Recordatorio_enviado', 'En_curso'];
const TRANSICIONES_PAUSA = {
  Programada: ['Recordatorio_enviado', 'En_curso', 'Suspendida', 'No_realizada', 'Cancelada'],
  Recordatorio_enviado: ['En_curso', 'Suspendida', 'No_realizada', 'Cancelada'],
  En_curso: ['Realizada', 'No_realizada'],
  Realizada: ['Cerrada'],
  Suspendida: ['Programada', 'Cancelada'],
  Cerrada: [], No_realizada: [], Cancelada: []
};

// ---- utils base -----------------------------------------------------------
function leerSeguro_(db, hoja) {
  try { return leerFilas_(db, hoja, COLUMNAS[hoja]); } catch (err) { return []; }
}
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1 || v === '1'; }
function normEmail_(e) { return String(e || '').trim().toLowerCase(); }

function guardaAdmin_(contexto, accion) {
  if (!contexto || contexto.rol !== 'ADM') {
    return errorForbidden('Solo un Administrador puede ' + accion + '.');
  }
  return null;
}

function diaSemanaIso_(fecha, tz) {
  if (!(fecha instanceof Date) || isNaN(fecha.getTime())) return 0;
  const nombre = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(fecha);
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[nombre] || 0;
}
function claveFecha_(valor) {
  if (valor instanceof Date) return claveDia_(valor, TZ);
  const s = String(valor || '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}
function horaCelda_(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    if (isNaN(valor.getTime())) return '';
    const hh = valor.getHours(), mm = valor.getMinutes();
    return (hh < 10 ? '0' + hh : '' + hh) + ':' + (mm < 10 ? '0' + mm : '' + mm);
  }
  const s = String(valor).trim();
  const directo = s.match(/^(\d{1,2}):(\d{2})/);
  if (directo) return normalizarHora_(directo[1] + ':' + directo[2]) || (directo[1] + ':' + directo[2]);
  const iso = s.match(/T(\d{2}):(\d{2})/);
  if (iso) return iso[1] + ':' + iso[2];
  return '';
}
function leerConfig_(db) {
  return leerSeguro_(db, 'PAUSAS_CONFIG').map((c) => { c.hora_habitual = horaCelda_(c.hora_habitual); return c; });
}
function leerProgramadas_(db) {
  return leerSeguro_(db, 'PAUSAS_PROGRAMADAS').map((p) => { p.hora_programada = horaCelda_(p.hora_programada); return p; });
}
function normalizarHora_(valor) {
  if (valor === undefined || valor === null || valor === '') return '';
  const m = String(valor).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return '';
  return (h < 10 ? '0' + h : '' + h) + ':' + m[2];
}
function normalizarDias_(valor) {
  if (valor === undefined || valor === null || valor === '') return '';
  const partes = Array.isArray(valor) ? valor : String(valor).split(',');
  const vistos = {};
  const dias = [];
  for (let i = 0; i < partes.length; i++) {
    const s = String(partes[i]).trim();
    if (s === '') continue;
    if (!/^\d+$/.test(s)) return null;
    const d = parseInt(s, 10);
    if (d < 1 || d > 7) return null;
    if (!vistos[d]) { vistos[d] = true; dias.push(d); }
  }
  dias.sort((a, b) => a - b);
  return dias.join(',');
}
function enteroPositivo_(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!isFinite(n) || Math.floor(n) !== n || n <= 0) return null;
  return n;
}
function enteroNoNegativo_(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!isFinite(n) || Math.floor(n) !== n || n < 0) return null;
  return n;
}
function porcentaje_(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!isFinite(n) || n < 0 || n > 100) return null;
  return n;
}
function horaAMinutos_(hhmm) {
  const m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}
function minutosDelDia_() {
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const min = horaAMinutos_(hhmm);
  return min === null ? 0 : min;
}
function registrarLog_(db, pausaId, contexto, accion, detalle) {
  try {
    agregarFila_(db, 'PAUSAS_LOG', {
      log_id: crypto.randomUUID(), timestamp: new Date().toISOString(),
      pausa_id: pausaId || '', usuario: (contexto && contexto.email) || '', accion: accion, detalle: detalle || ''
    });
  } catch (err) { /* la tabla puede no existir; el log es secundario */ }
}
function obtenerEmailsPorRol_(db, empresaId, roles) {
  return leerSeguro_(db, 'USUARIOS')
    .filter((u) => esVerdadero_(u.activo) && u.empresa_id === empresaId && roles.indexOf(u.rol) !== -1)
    .map((u) => u.email);
}

// ---- busquedas / resolucion ----------------------------------------------
function buscarPausa_(db, pausaId) {
  return leerProgramadas_(db).find((p) => String(p.pausa_id) === String(pausaId)) || null;
}
function pausaDeHoyEmpresa_(db, empresaId) {
  const hoy = claveDia_(new Date(), TZ);
  return leerProgramadas_(db).find((p) => String(p.empresa_id) === String(empresaId) &&
    claveFecha_(p.fecha) === hoy && ESTADOS_PAUSA_TERMINALES.indexOf(p.estado) === -1) || null;
}
function buscarRegistro_(db, pausaId, email) {
  const correo = normEmail_(email);
  return leerSeguro_(db, 'PAUSAS_ASISTENCIA').find((r) => String(r.pausa_id) === String(pausaId) && normEmail_(r.email) === correo) || null;
}
function resolverTrabajador_(db, email) {
  const correo = normEmail_(email);
  if (!correo) return { empresa_id: '', trabajador_id: '', nombre: '' };
  const enRoster = leerSeguro_(db, 'PAUSAS_TRABAJADORES').find((t) => esVerdadero_(t.activo) && normEmail_(t.email) === correo);
  if (enRoster) return { empresa_id: enRoster.empresa_id, trabajador_id: enRoster.trabajador_id, nombre: enRoster.nombre || '' };
  const cuenta = leerSeguro_(db, 'CUENTAS_PORTAL').find((c) => parsearListaPortal(c.emails).map(normEmail_).indexOf(correo) !== -1);
  if (cuenta && cuenta.empresa_id) return { empresa_id: cuenta.empresa_id, trabajador_id: '', nombre: cuenta.nombre || '' };
  const usuario = leerSeguro_(db, 'USUARIOS').find((u) => normEmail_(u.email) === correo);
  if (usuario && usuario.empresa_id) return { empresa_id: usuario.empresa_id, trabajador_id: '', nombre: usuario.nombre || '' };
  return { empresa_id: '', trabajador_id: '', nombre: '' };
}
function empresasQueCoordina_(db, contexto) {
  if (contexto && contexto.rol === 'ADM') return leerConfig_(db).map((c) => String(c.empresa_id));
  const correo = normEmail_(contexto && contexto.email);
  if (!correo) return [];
  const vistas = {};
  leerSeguro_(db, 'PAUSAS_COORDINADORES').forEach((co) => {
    if (esVerdadero_(co.activo) && normEmail_(co.email) === correo) vistas[String(co.empresa_id)] = true;
  });
  return Object.keys(vistas);
}
function guardaCoordinador_(db, contexto, pausa) {
  if (contexto && contexto.rol === 'ADM') return null;
  if (empresasQueCoordina_(db, contexto).indexOf(String(pausa.empresa_id)) === -1) {
    return errorForbidden('No eres coordinador(a) de la empresa de esta pausa.');
  }
  return null;
}
function empresasVisiblesGerencia_(db, contexto) {
  const rol = contexto && contexto.rol;
  if (rol !== 'GERENCIA' && rol !== 'ADM') return [];
  return leerConfig_(db).map((c) => String(c.empresa_id));
}
function coordinadorasDeEmpresa_(db, empresaId) {
  return leerSeguro_(db, 'PAUSAS_COORDINADORES')
    .filter((c) => esVerdadero_(c.activo) && String(c.empresa_id) === String(empresaId) && c.email)
    .map((c) => c.email);
}
function destinatariosRecordatorio_(db, empresaId) {
  const set = {};
  leerSeguro_(db, 'PAUSAS_TRABAJADORES').forEach((t) => {
    if (esVerdadero_(t.activo) && String(t.empresa_id) === String(empresaId) && t.email) set[normEmail_(t.email)] = t.email;
  });
  coordinadorasDeEmpresa_(db, empresaId).forEach((c) => { set[normEmail_(c)] = c; });
  return Object.keys(set).map((k) => set[k]);
}
function destinatariosResumen_(db, empresaId) {
  const set = {};
  coordinadorasDeEmpresa_(db, empresaId).forEach((c) => { set[normEmail_(c)] = c; });
  try { obtenerEmailsPorRol_(db, empresaId, ['ADM']).forEach((e) => { if (e) set[normEmail_(e)] = e; }); } catch (err) { /* USUARIOS puede faltar */ }
  return Object.keys(set).map((k) => set[k]);
}
function destinatariosReporteGerencia_(db) {
  const set = {};
  leerSeguro_(db, 'USUARIOS').forEach((u) => {
    if (esVerdadero_(u.activo) && (u.rol === 'GERENCIA' || u.rol === 'ADM') && u.email) set[normEmail_(u.email)] = u.email;
  });
  leerSeguro_(db, 'PAUSAS_COORDINADORES').forEach((c) => {
    if (esVerdadero_(c.activo) && c.email) set[normEmail_(c.email)] = c.email;
  });
  return Object.keys(set).map((k) => set[k]);
}

// Enlace magico personal: no portado todavia -> '' (el correo sale sin boton,
// mismo caso que el .gs maneja cuando no hay sitio configurado).
function enlaceMagico_(/* db, email, modulo */) { return ''; }

// ---- maquina de estados ---------------------------------------------------
function transicionar_(db, pausa, nuevoEstado, contexto, campos) {
  const permitidas = TRANSICIONES_PAUSA[pausa.estado] || [];
  if (permitidas.indexOf(nuevoEstado) === -1) {
    return errorValidacion('estado', 'No se puede pasar de "' + pausa.estado + '" a "' + nuevoEstado + '".');
  }
  const cambios = Object.assign({ estado: nuevoEstado }, campos || {});
  actualizarFilaPorId_(db, 'PAUSAS_PROGRAMADAS', 'pausa_id', pausa.pausa_id, cambios);
  registrarLog_(db, pausa.pausa_id, contexto, 'pausa_estado_' + nuevoEstado, pausa.estado + ' -> ' + nuevoEstado);
  return Object.assign({}, pausa, cambios);
}
function claveAvisoHorario_(pausa, sufijo) {
  return pausa.pausa_id + '|' + claveFecha_(pausa.fecha) + ' ' + String(pausa.hora_programada || '') + (sufijo ? ':' + sufijo : '');
}

// ---- participacion / reportes ---------------------------------------------
function participacionDePausa_(db, pausaId, empresaId) {
  const roster = leerSeguro_(db, 'PAUSAS_TRABAJADORES').filter((t) => esVerdadero_(t.activo) && String(t.empresa_id) === String(empresaId));
  const registros = leerSeguro_(db, 'PAUSAS_ASISTENCIA').filter((r) => String(r.pausa_id) === String(pausaId));
  const porCorreo = {};
  registros.forEach((r) => { porCorreo[normEmail_(r.email)] = r; });
  const participaron = [], justificaron = [], pendientes = [];
  roster.forEach((t) => {
    const reg = porCorreo[normEmail_(t.email)];
    const item = { trabajador_id: t.trabajador_id, nombre: t.nombre || t.email, email: t.email, area: t.area || '' };
    if (reg && reg.estado === 'participo') participaron.push(item);
    else if (reg && reg.estado === 'no_participo') justificaron.push(Object.assign({ motivo: reg.motivo || '' }, item));
    else pendientes.push(item);
  });
  const correosRoster = {};
  roster.forEach((t) => { correosRoster[normEmail_(t.email)] = true; });
  registros.forEach((r) => {
    if (correosRoster[normEmail_(r.email)]) return;
    const item = { nombre: r.email, email: r.email, area: '' };
    if (r.estado === 'participo') participaron.push(item);
    else if (r.estado === 'no_participo') justificaron.push(Object.assign({ motivo: r.motivo || '' }, item));
  });
  const totalRoster = roster.length;
  return {
    total_roster: totalRoster, participaron, justificaron, pendientes,
    n_participaron: participaron.length, n_justificaron: justificaron.length, n_pendientes: pendientes.length,
    pct_participacion: totalRoster === 0 ? null : Math.round((participaron.length / totalRoster) * 1000) / 10
  };
}

function inicioSemanaIso_(fecha) {
  const dow = diaSemanaIso_(fecha, TZ);
  return new Date(fecha.getTime() - (dow - 1) * 24 * 3600 * 1000);
}

function calcularRachasPorArea_(db, empresaIds, desde, hasta) {
  const umbralPorEmpresa = {};
  leerConfig_(db).forEach((c) => { const u = porcentaje_(c.umbral_verde); umbralPorEmpresa[String(c.empresa_id)] = u === null ? 80 : u; });
  const rosterPorAreaEmpresa = {};
  leerSeguro_(db, 'PAUSAS_TRABAJADORES').forEach((t) => {
    if (!esVerdadero_(t.activo) || empresaIds.indexOf(String(t.empresa_id)) === -1) return;
    const area = String(t.area || '').trim() || '(sin área)';
    const clave = t.empresa_id + '|' + area;
    (rosterPorAreaEmpresa[clave] = rosterPorAreaEmpresa[clave] || []).push(normEmail_(t.email));
  });
  const pausas = leerProgramadas_(db).filter((p) => {
    const f = claveFecha_(p.fecha);
    return empresaIds.indexOf(String(p.empresa_id)) !== -1 && f >= desde && f <= hasta &&
      (p.estado === ESTADOS_PAUSA.REALIZADA || p.estado === ESTADOS_PAUSA.CERRADA || p.estado === ESTADOS_PAUSA.NO_REALIZADA);
  }).sort((a, b) => claveFecha_(a.fecha) < claveFecha_(b.fecha) ? -1 : 1);
  const registrosPorPausa = {};
  leerSeguro_(db, 'PAUSAS_ASISTENCIA').forEach((r) => { (registrosPorPausa[String(r.pausa_id)] = registrosPorPausa[String(r.pausa_id)] || []).push(r); });

  const resultado = [];
  Object.keys(rosterPorAreaEmpresa).forEach((clave) => {
    const partes = clave.split('|');
    const empresaId = partes[0], area = partes.slice(1).join('|');
    const emails = rosterPorAreaEmpresa[clave];
    if (!emails.length) return;
    const setEmails = {};
    emails.forEach((e) => { setEmails[e] = true; });
    const umbral = umbralPorEmpresa[empresaId] === undefined ? 80 : umbralPorEmpresa[empresaId];
    const cumpleSerie = [];
    pausas.filter((p) => String(p.empresa_id) === empresaId).forEach((p) => {
      if (p.estado === ESTADOS_PAUSA.NO_REALIZADA) { cumpleSerie.push(null); return; }
      const regs = registrosPorPausa[String(p.pausa_id)] || [];
      const participaronArea = regs.filter((r) => setEmails[normEmail_(r.email)] && r.estado === 'participo').length;
      const pct = Math.round((participaronArea / emails.length) * 1000) / 10;
      cumpleSerie.push(pct >= umbral);
    });
    let rachaActual = 0;
    for (let i = cumpleSerie.length - 1; i >= 0; i--) { if (cumpleSerie[i] === null) continue; if (cumpleSerie[i]) rachaActual++; else break; }
    let rachaMaxima = 0, corrida = 0;
    cumpleSerie.forEach((c) => { if (c === null) return; corrida = c ? corrida + 1 : 0; if (corrida > rachaMaxima) rachaMaxima = corrida; });
    resultado.push({ empresa_id: empresaId, area: area, roster: emails.length, racha_actual: rachaActual, racha_maxima: rachaMaxima, umbral_pct: umbral });
  });
  return resultado.sort((a, b) => b.racha_actual - a.racha_actual);
}

function calcularTendencia_(db, empresaIds) {
  const SEMANAS = 8;
  const setEmp = {};
  empresaIds.forEach((e) => { setEmp[String(e)] = true; });
  const hoy = new Date();
  const buckets = [];
  for (let i = SEMANAS - 1; i >= 0; i--) {
    const inicio = inicioSemanaIso_(new Date(hoy.getTime() - i * 7 * 24 * 3600 * 1000));
    const fin = new Date(inicio.getTime() + 6 * 24 * 3600 * 1000);
    buckets.push({
      desde: claveDia_(inicio, TZ), hasta: claveDia_(fin, TZ),
      etiqueta: 'sem. ' + claveDia_(inicio, TZ).slice(5).replace('-', '/'),
      realizadas: 0, no_realizadas: 0, resueltas: 0
    });
  }
  leerProgramadas_(db).filter((p) => setEmp[String(p.empresa_id)]).forEach((p) => {
    const f = claveFecha_(p.fecha);
    const bucket = buckets.find((b) => f >= b.desde && f <= b.hasta);
    if (!bucket) return;
    if (p.estado === ESTADOS_PAUSA.REALIZADA || p.estado === ESTADOS_PAUSA.CERRADA) { bucket.realizadas++; bucket.resueltas++; }
    else if (p.estado === ESTADOS_PAUSA.NO_REALIZADA) { bucket.no_realizadas++; bucket.resueltas++; }
  });
  return buckets.map((b) => ({
    etiqueta: b.etiqueta, realizadas: b.realizadas, no_realizadas: b.no_realizadas,
    pct_cumplimiento: b.resueltas === 0 ? null : Math.round((b.realizadas / b.resueltas) * 1000) / 10
  }));
}

function calcularReporte_(db, empresaIds, desde, hasta) {
  const setEmp = {};
  empresaIds.forEach((e) => { setEmp[String(e)] = true; });
  const hoy = claveDia_(new Date(), TZ);
  const hastaC = /^\d{4}-\d{2}-\d{2}$/.test(String(hasta || '')) ? hasta : hoy;
  const desdeC = /^\d{4}-\d{2}-\d{2}$/.test(String(desde || '')) ? desde
    : claveDia_(new Date(Date.now() - 30 * 24 * 3600 * 1000), TZ);
  const pausas = leerProgramadas_(db).filter((p) => { const f = claveFecha_(p.fecha); return setEmp[String(p.empresa_id)] && f >= desdeC && f <= hastaC; });
  const idsPausa = {};
  pausas.forEach((p) => { idsPausa[p.pausa_id] = p; });
  const registros = leerSeguro_(db, 'PAUSAS_ASISTENCIA').filter((r) => idsPausa[r.pausa_id]);

  const realizadas = pausas.filter((p) => p.estado === 'Realizada' || p.estado === 'Cerrada');
  const noRealizadas = pausas.filter((p) => p.estado === 'No_realizada');
  const canceladas = pausas.filter((p) => p.estado === 'Cancelada');
  const resueltas = realizadas.length + noRealizadas.length;
  const participaciones = registros.filter((r) => r.estado === 'participo');
  const justificaciones = registros.filter((r) => r.estado === 'no_participo');

  const animos = registros.map((r) => Number(r.animo)).filter((n) => n >= 1 && n <= 5);
  const animoPromedio = animos.length === 0 ? null : Math.round((animos.reduce((a, b) => a + b, 0) / animos.length) * 10) / 10;
  const animoDistribucion = [1, 2, 3, 4, 5].map((valor) => {
    const cantidad = animos.filter((a) => a === valor).length;
    return { valor: valor, cantidad: cantidad, pct: animos.length === 0 ? 0 : Math.round((cantidad / animos.length) * 1000) / 10 };
  });

  const motivos = {};
  justificaciones.forEach((r) => { const m = String(r.motivo || '(sin motivo)').trim() || '(sin motivo)'; motivos[m] = (motivos[m] || 0) + 1; });
  const motivosLista = Object.keys(motivos).map((m) => ({ motivo: m, cantidad: motivos[m] })).sort((a, b) => b.cantidad - a.cantidad);

  const areaPorCorreo = {};
  const nombrePorCorreo = {};
  leerSeguro_(db, 'PAUSAS_TRABAJADORES').forEach((t) => {
    if (!setEmp[String(t.empresa_id)]) return;
    const correo = normEmail_(t.email);
    areaPorCorreo[correo] = t.area || '(sin área)';
    nombrePorCorreo[correo] = t.nombre || t.email;
  });
  const porArea = {};
  participaciones.forEach((r) => { const area = areaPorCorreo[normEmail_(r.email)] || '(sin área)'; porArea[area] = (porArea[area] || 0) + 1; });
  const porAreaLista = Object.keys(porArea).map((a) => ({ area: a, participaciones: porArea[a] })).sort((a, b) => b.participaciones - a.participaciones);

  const detalleAnimo = registros
    .filter((r) => Number(r.animo) >= 1 && Number(r.animo) <= 5)
    .map((r) => {
      const pausa = idsPausa[r.pausa_id];
      return {
        fecha: pausa ? claveFecha_(pausa.fecha) : '', empresa_id: pausa ? pausa.empresa_id : '',
        nombre: nombrePorCorreo[normEmail_(r.email)] || r.email, area: areaPorCorreo[normEmail_(r.email)] || '(sin área)',
        valor: Number(r.animo)
      };
    })
    .sort((a, b) => a.fecha < b.fecha ? 1 : (a.fecha > b.fecha ? -1 : 0));

  return {
    periodo: { desde: desdeC, hasta: hastaC },
    kpis: {
      programadas: pausas.length, realizadas: realizadas.length, no_realizadas: noRealizadas.length,
      canceladas: canceladas.length, pct_cumplimiento: resueltas === 0 ? null : Math.round((realizadas.length / resueltas) * 1000) / 10,
      participaciones: participaciones.length, justificaciones: justificaciones.length, animo_promedio: animoPromedio
    },
    motivos: motivosLista,
    por_area: porAreaLista,
    rachas_area: calcularRachasPorArea_(db, empresaIds, desdeC, hastaC),
    tendencia: calcularTendencia_(db, empresaIds),
    clima_emocional: { respuestas: animos.length, distribucion: animoDistribucion, detalle: detalleAnimo },
    pausas: pausas.map((p) => ({
      pausa_id: p.pausa_id, empresa_id: p.empresa_id, fecha: claveFecha_(p.fecha), estado: p.estado, hora_programada: p.hora_programada || ''
    })).sort((a, b) => a.fecha < b.fecha ? 1 : -1)
  };
}

// ==== CRUD: config / coordinadores / trabajadores / roster ================
function listarConfig(db, data, contexto) {
  const g = guardaAdmin_(contexto, 'ver la configuracion de pausas'); if (g) return g;
  return leerConfig_(db);
}
function guardarConfig(db, data, contexto) {
  const g = guardaAdmin_(contexto, 'configurar las pausas'); if (g) return g;
  const empresaId = String(data.empresa_id || '').trim();
  if (!empresaId) return errorValidacion('empresa_id', 'Indica la empresa a configurar.');
  const hora = normalizarHora_(data.hora_habitual);
  if (data.hora_habitual && !hora) return errorValidacion('hora_habitual', 'Hora invalida. Usa el formato HH:mm (00:00 a 23:59).');
  const dias = normalizarDias_(data.dias_semana);
  if (dias === null) return errorValidacion('dias_semana', 'Dias invalidos. Usa numeros 1..7 separados por coma (1=lunes).');
  const duracion = enteroPositivo_(data.duracion_min);
  if (data.duracion_min !== undefined && data.duracion_min !== '' && duracion === null) return errorValidacion('duracion_min', 'La duracion debe ser un numero de minutos mayor a 0.');
  const anticipacion = enteroNoNegativo_(data.min_anticipacion);
  if (data.min_anticipacion !== undefined && data.min_anticipacion !== '' && anticipacion === null) return errorValidacion('min_anticipacion', 'La anticipacion debe ser un numero de minutos (0 o mas).');
  const verde = porcentaje_(data.umbral_verde);
  if (data.umbral_verde !== undefined && data.umbral_verde !== '' && verde === null) return errorValidacion('umbral_verde', 'El umbral verde debe ser un porcentaje entre 0 y 100.');
  const amarillo = porcentaje_(data.umbral_amarillo);
  if (data.umbral_amarillo !== undefined && data.umbral_amarillo !== '' && amarillo === null) return errorValidacion('umbral_amarillo', 'El umbral amarillo debe ser un porcentaje entre 0 y 100.');
  if (verde !== null && amarillo !== null && amarillo > verde) return errorValidacion('umbral_amarillo', 'El umbral amarillo no puede ser mayor que el verde.');

  const registro = {
    empresa_id: empresaId, hora_habitual: hora || '', dias_semana: dias,
    duracion_min: duracion === null ? '' : duracion, min_anticipacion: anticipacion === null ? '' : anticipacion,
    umbral_verde: verde === null ? '' : verde, umbral_amarillo: amarillo === null ? '' : amarillo,
    activo: data.activo === false ? false : true
  };
  const actualizado = actualizarFilaPorId_(db, 'PAUSAS_CONFIG', 'empresa_id', empresaId, registro);
  if (actualizado) { registrarLog_(db, '', contexto, 'config_actualizada', 'empresa ' + empresaId); return actualizado; }
  agregarFila_(db, 'PAUSAS_CONFIG', registro);
  registrarLog_(db, '', contexto, 'config_creada', 'empresa ' + empresaId);
  return registro;
}

function listarCoordinadores(db, data, contexto) {
  const g = guardaAdmin_(contexto, 'ver las coordinadoras de pausas'); if (g) return g;
  return leerSeguro_(db, 'PAUSAS_COORDINADORES');
}
function gestionarCoordinador(db, data, contexto) {
  const g = guardaAdmin_(contexto, 'gestionar las coordinadoras de pausas'); if (g) return g;
  switch (data.operacion) {
    case 'crear': return crearCoordinador_(db, data, contexto);
    case 'activar': return activarCoordinador_(db, data, contexto);
    case 'eliminar': return eliminarCoordinador_(db, data, contexto);
    default: return errorValidacion('operacion', 'Operacion invalida: ' + data.operacion);
  }
}
function crearCoordinador_(db, data, contexto) {
  const empresaId = String(data.empresa_id || '').trim();
  if (!empresaId) return errorValidacion('empresa_id', 'Indica la empresa de la coordinadora.');
  const nombre = String(data.nombre || '').trim();
  if (!nombre) return errorValidacion('nombre', 'Indica el nombre de la coordinadora.');
  const email = normEmail_(data.email);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return errorValidacion('email', 'Correo de la coordinadora invalido.');
  const tipo = String(data.tipo || 'titular').trim().toLowerCase();
  if (PAUSAS_TIPOS_COORDINADOR.indexOf(tipo) === -1) return errorValidacion('tipo', 'Tipo invalido. Usa "titular" o "reemplazo".');
  const duplicada = leerSeguro_(db, 'PAUSAS_COORDINADORES').find((c) => esVerdadero_(c.activo) && c.empresa_id === empresaId && normEmail_(c.email) === email);
  if (duplicada) return errorValidacion('email', 'Esa coordinadora ya esta registrada en la empresa.');
  const fila = { coord_id: crypto.randomUUID(), empresa_id: empresaId, nombre: nombre, email: email, tipo: tipo, activo: true };
  agregarFila_(db, 'PAUSAS_COORDINADORES', fila);
  registrarLog_(db, '', contexto, 'coordinador_creado', nombre + ' (' + tipo + ') en ' + empresaId);
  return fila;
}
function activarCoordinador_(db, data, contexto) {
  if (!data.coord_id) return errorValidacion('coord_id', 'Falta indicar la coordinadora a modificar.');
  const activo = data.activo !== false;
  actualizarFilaPorId_(db, 'PAUSAS_COORDINADORES', 'coord_id', data.coord_id, { activo: activo });
  registrarLog_(db, '', contexto, activo ? 'coordinador_activado' : 'coordinador_desactivado', data.coord_id);
  return { coord_id: data.coord_id, activo: activo };
}
function eliminarCoordinador_(db, data, contexto) {
  if (!data.coord_id) return errorValidacion('coord_id', 'Falta indicar la coordinadora a eliminar.');
  eliminarFilasPorId_(db, 'PAUSAS_COORDINADORES', 'coord_id', data.coord_id);
  registrarLog_(db, '', contexto, 'coordinador_eliminado', data.coord_id);
  return { coord_id: data.coord_id, eliminada: true };
}

function listarTrabajadores(db, data, contexto) {
  const g = guardaAdmin_(contexto, 'ver el roster de pausas'); if (g) return g;
  return leerSeguro_(db, 'PAUSAS_TRABAJADORES');
}
function gestionarTrabajador(db, data, contexto) {
  const g = guardaAdmin_(contexto, 'gestionar el roster de pausas'); if (g) return g;
  switch (data.operacion) {
    case 'crear': return crearTrabajador_(db, data, contexto);
    case 'activar': return activarTrabajador_(db, data, contexto);
    case 'eliminar': return eliminarTrabajador_(db, data, contexto);
    default: return errorValidacion('operacion', 'Operacion invalida: ' + data.operacion);
  }
}
function crearTrabajador_(db, data, contexto) {
  const empresaId = String(data.empresa_id || '').trim();
  if (!empresaId) return errorValidacion('empresa_id', 'Indica la empresa del trabajador.');
  const nombre = String(data.nombre || '').trim();
  if (!nombre) return errorValidacion('nombre', 'Indica el nombre del trabajador.');
  const email = normEmail_(data.email);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return errorValidacion('email', 'Correo del trabajador invalido.');
  const duplicado = leerSeguro_(db, 'PAUSAS_TRABAJADORES').find((t) => esVerdadero_(t.activo) && t.empresa_id === empresaId && normEmail_(t.email) === email);
  if (duplicado) return errorValidacion('email', 'Ese trabajador ya esta en el roster de la empresa.');
  const fila = {
    trabajador_id: crypto.randomUUID(), empresa_id: empresaId, nombre: nombre, email: email,
    area: String(data.area || '').trim(), cargo: String(data.cargo || '').trim(), activo: true,
    fecha_ingreso: data.fecha_ingreso ? String(data.fecha_ingreso) : new Date().toISOString()
  };
  agregarFila_(db, 'PAUSAS_TRABAJADORES', fila);
  registrarLog_(db, '', contexto, 'trabajador_creado', nombre + ' en ' + empresaId);
  return fila;
}
function activarTrabajador_(db, data, contexto) {
  if (!data.trabajador_id) return errorValidacion('trabajador_id', 'Falta indicar el trabajador a modificar.');
  const activo = data.activo !== false;
  actualizarFilaPorId_(db, 'PAUSAS_TRABAJADORES', 'trabajador_id', data.trabajador_id, { activo: activo });
  registrarLog_(db, '', contexto, activo ? 'trabajador_activado' : 'trabajador_desactivado', data.trabajador_id);
  return { trabajador_id: data.trabajador_id, activo: activo };
}
function eliminarTrabajador_(db, data, contexto) {
  if (!data.trabajador_id) return errorValidacion('trabajador_id', 'Falta indicar el trabajador a eliminar.');
  eliminarFilasPorId_(db, 'PAUSAS_TRABAJADORES', 'trabajador_id', data.trabajador_id);
  registrarLog_(db, '', contexto, 'trabajador_eliminado', data.trabajador_id);
  return { trabajador_id: data.trabajador_id, eliminado: true };
}

function sembrarRosterDesdeCuentas(db, data, contexto) {
  const g = guardaAdmin_(contexto, 'sembrar el roster de pausas'); if (g) return g;
  const empresaId = String(data.empresa_id || '').trim();
  if (!empresaId) return errorValidacion('empresa_id', 'Indica la empresa a sembrar.');
  const yaEnRoster = {};
  leerSeguro_(db, 'PAUSAS_TRABAJADORES').forEach((t) => { if (String(t.empresa_id) === empresaId) yaEnRoster[normEmail_(t.email)] = true; });
  let creados = 0;
  const vistos = {};
  leerSeguro_(db, 'CUENTAS_PORTAL').forEach((cuenta) => {
    if (!esVerdadero_(cuenta.activo) || String(cuenta.empresa_id) !== empresaId) return;
    parsearListaPortal(cuenta.emails).forEach((email) => {
      const correo = normEmail_(email);
      if (!correo || yaEnRoster[correo] || vistos[correo]) return;
      vistos[correo] = true;
      agregarFila_(db, 'PAUSAS_TRABAJADORES', {
        trabajador_id: crypto.randomUUID(), empresa_id: empresaId, nombre: cuenta.nombre || email, email: email,
        area: '', cargo: cuenta.cargo || '', activo: true, fecha_ingreso: new Date().toISOString()
      });
      creados++;
    });
  });
  registrarLog_(db, '', contexto, 'roster_sembrado', empresaId + ': ' + creados + ' nuevos desde cuentas');
  return { empresa_id: empresaId, creados: creados };
}
function asignarModuloPausasRoster(db, data, contexto) {
  const g = guardaAdmin_(contexto, 'asignar el modulo de pausas'); if (g) return g;
  const empresaId = String(data.empresa_id || '').trim();
  if (!empresaId) return errorValidacion('empresa_id', 'Indica la empresa.');
  const correosRoster = {};
  leerSeguro_(db, 'PAUSAS_TRABAJADORES').forEach((t) => {
    if (esVerdadero_(t.activo) && String(t.empresa_id) === empresaId && t.email) correosRoster[normEmail_(t.email)] = true;
  });
  let actualizadas = 0;
  const correosConCuenta = {};
  leerSeguro_(db, 'CUENTAS_PORTAL').forEach((cuenta) => {
    if (!esVerdadero_(cuenta.activo)) return;
    const emails = parsearListaPortal(cuenta.emails);
    const coincide = emails.some((e) => { const correo = normEmail_(e); if (correosRoster[correo]) correosConCuenta[correo] = true; return correosRoster[correo]; });
    if (!coincide) return;
    const modulos = parsearListaPortal(cuenta.modulos);
    if (modulos.indexOf('pausas') === -1) {
      modulos.push('pausas');
      actualizarFilaPorId_(db, 'CUENTAS_PORTAL', 'cuenta_id', cuenta.cuenta_id, { modulos: JSON.stringify(modulos) });
      actualizadas++;
    }
  });
  const sinCuenta = Object.keys(correosRoster).filter((c) => !correosConCuenta[c]);
  registrarLog_(db, '', contexto, 'modulo_pausas_masivo', empresaId + ': ' + actualizadas + ' cuentas actualizadas');
  return { empresa_id: empresaId, cuentas_actualizadas: actualizadas, sin_cuenta: sinCuenta };
}

// ==== programacion + estados ==============================================
function programarDelDia(db, refFecha, contexto) {
  const fecha = refFecha ? new Date(refFecha) : new Date();
  const claveHoy = claveDia_(fecha, TZ);
  const diaIso = diaSemanaIso_(fecha, TZ);
  const configs = leerConfig_(db).filter((c) => esVerdadero_(c.activo));
  const yaProgramadas = leerProgramadas_(db);
  const creadas = [];
  configs.forEach((config) => {
    const dias = String(config.dias_semana || '').split(',').map((d) => String(d).trim());
    if (dias.indexOf(String(diaIso)) === -1) return;
    const existe = yaProgramadas.some((p) => String(p.empresa_id) === String(config.empresa_id) &&
      claveFecha_(p.fecha) === claveHoy && ESTADOS_PAUSA_TERMINALES.indexOf(p.estado) === -1);
    if (existe) return;
    const fila = {
      pausa_id: crypto.randomUUID(), empresa_id: config.empresa_id, fecha: claveHoy,
      hora_programada: config.hora_habitual || '', hora_inicio_real: '', hora_fin: '', coordinador_email: '',
      estado: ESTADOS_PAUSA.PROGRAMADA, duracion_min: config.duracion_min || '', observaciones: ''
    };
    agregarFila_(db, 'PAUSAS_PROGRAMADAS', fila);
    registrarLog_(db, fila.pausa_id, contexto || { email: 'sistema' }, 'pausa_programada', 'empresa ' + config.empresa_id + ' ' + claveHoy + ' ' + fila.hora_programada);
    creadas.push(fila);
  });
  return { fecha: claveHoy, dia_semana: diaIso, creadas: creadas, total_creadas: creadas.length };
}
function programarDelDiaAdmin(db, data, contexto) {
  const g = guardaAdmin_(contexto, 'programar las pausas del dia'); if (g) return g;
  return programarDelDia(db, new Date(), contexto);
}
function listarProgramadas(db, data, contexto) {
  const g = guardaAdmin_(contexto, 'ver las pausas programadas'); if (g) return g;
  data = data || {};
  let filas = leerProgramadas_(db);
  if (data.empresa_id) filas = filas.filter((p) => String(p.empresa_id) === String(data.empresa_id));
  if (data.estado) filas = filas.filter((p) => p.estado === data.estado);
  filas.sort((a, b) => {
    const fa = claveFecha_(a.fecha), fb = claveFecha_(b.fecha);
    if (fa !== fb) return fa < fb ? 1 : -1;
    return String(b.hora_programada).localeCompare(String(a.hora_programada));
  });
  return filas;
}
function gestionarPausaProgramada(db, data, contexto) {
  const g = guardaAdmin_(contexto, 'gestionar las pausas programadas'); if (g) return g;
  switch (data.operacion) {
    case 'crear_manual': return crearPausaManual_(db, data, contexto);
    case 'reprogramar': return reprogramarPausa_(db, data, contexto);
    case 'cancelar': return cancelarPausa_(db, data, contexto);
    default: return errorValidacion('operacion', 'Operacion invalida: ' + data.operacion);
  }
}
function crearPausaManual_(db, data, contexto) {
  const empresaId = String(data.empresa_id || '').trim();
  if (!empresaId) return errorValidacion('empresa_id', 'Indica la empresa de la pausa.');
  const fecha = String(data.fecha || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return errorValidacion('fecha', 'Indica la fecha en formato AAAA-MM-DD.');
  const hora = normalizarHora_(data.hora_programada);
  if (data.hora_programada && !hora) return errorValidacion('hora_programada', 'Hora invalida. Usa el formato HH:mm.');
  const existe = leerProgramadas_(db).some((p) => String(p.empresa_id) === empresaId && claveFecha_(p.fecha) === fecha && ESTADOS_PAUSA_TERMINALES.indexOf(p.estado) === -1);
  if (existe) return errorValidacion('fecha', 'Ya hay una pausa viva para esa empresa en esa fecha.');
  const duracion = enteroPositivo_(data.duracion_min);
  const fila = {
    pausa_id: crypto.randomUUID(), empresa_id: empresaId, fecha: fecha, hora_programada: hora || '',
    hora_inicio_real: '', hora_fin: '', coordinador_email: '', estado: ESTADOS_PAUSA.PROGRAMADA,
    duracion_min: duracion === null ? '' : duracion, observaciones: String(data.observaciones || '').trim()
  };
  agregarFila_(db, 'PAUSAS_PROGRAMADAS', fila);
  registrarLog_(db, fila.pausa_id, contexto, 'pausa_creada_manual', 'empresa ' + empresaId + ' ' + fecha);
  return fila;
}
function reprogramarPausa_(db, data, contexto) {
  if (!data.pausa_id) return errorValidacion('pausa_id', 'Falta indicar la pausa a reprogramar.');
  const pausa = buscarPausa_(db, data.pausa_id);
  if (!pausa) return errorValidacion('pausa_id', 'Pausa no encontrada.');
  if ([ESTADOS_PAUSA.PROGRAMADA, ESTADOS_PAUSA.RECORDATORIO_ENVIADO, ESTADOS_PAUSA.SUSPENDIDA].indexOf(pausa.estado) === -1) {
    return errorValidacion('estado', 'Solo se puede reprogramar una pausa que aun no comenzo (estado actual: ' + pausa.estado + ').');
  }
  const cambios = {};
  if (data.fecha !== undefined && data.fecha !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.fecha).trim())) return errorValidacion('fecha', 'Indica la fecha en formato AAAA-MM-DD.');
    cambios.fecha = String(data.fecha).trim();
  }
  if (data.hora_programada !== undefined && data.hora_programada !== '') {
    const hora = normalizarHora_(data.hora_programada);
    if (!hora) return errorValidacion('hora_programada', 'Hora invalida. Usa el formato HH:mm.');
    cambios.hora_programada = hora;
  }
  if (Object.keys(cambios).length === 0) return errorValidacion('fecha', 'Indica al menos la nueva fecha o la nueva hora.');
  if (pausa.estado === ESTADOS_PAUSA.SUSPENDIDA || pausa.estado === ESTADOS_PAUSA.RECORDATORIO_ENVIADO) cambios.estado = ESTADOS_PAUSA.PROGRAMADA;
  cambios.ultima_llamada_enviada = false;
  cambios.aviso_coordinador_enviado = false;
  cambios.escalada_admin_enviada = false;
  actualizarFilaPorId_(db, 'PAUSAS_PROGRAMADAS', 'pausa_id', data.pausa_id, cambios);
  registrarLog_(db, data.pausa_id, contexto, 'pausa_reprogramada', (cambios.fecha || pausa.fecha) + ' ' + (cambios.hora_programada || pausa.hora_programada));
  return Object.assign({}, pausa, cambios);
}
function cancelarPausa_(db, data, contexto) {
  if (!data.pausa_id) return errorValidacion('pausa_id', 'Falta indicar la pausa a cancelar.');
  const pausa = buscarPausa_(db, data.pausa_id);
  if (!pausa) return errorValidacion('pausa_id', 'Pausa no encontrada.');
  return transicionar_(db, pausa, ESTADOS_PAUSA.CANCELADA, contexto, { observaciones: data.motivo ? String(data.motivo).trim() : pausa.observaciones });
}

// ==== registro del trabajador =============================================
function getPausaHoyTrabajador(db, data, contexto) {
  const email = contexto && contexto.email;
  if (!email) return errorForbidden('No fue posible identificar tu cuenta.');
  const trab = resolverTrabajador_(db, email);
  if (!trab.empresa_id) return { sin_empresa: true, email: email };
  const pausa = pausaDeHoyEmpresa_(db, trab.empresa_id);
  if (!pausa) return { empresa_id: trab.empresa_id, pausa: null, registrable: false };
  const registrable = PAUSAS_ESTADOS_REGISTRABLES.indexOf(pausa.estado) !== -1;
  const miRegistro = buscarRegistro_(db, pausa.pausa_id, email);
  return {
    empresa_id: trab.empresa_id, nombre: trab.nombre || '',
    pausa: { pausa_id: pausa.pausa_id, fecha: claveFecha_(pausa.fecha), hora_programada: pausa.hora_programada || '', duracion_min: pausa.duracion_min || '', estado: pausa.estado },
    registrable: registrable,
    mi_registro: miRegistro ? { estado: miRegistro.estado, motivo: miRegistro.motivo || '', comentario: miRegistro.comentario || '', fecha_hora_registro: miRegistro.fecha_hora_registro } : null
  };
}
function registrarAsistencia(db, data, contexto) {
  const email = contexto && contexto.email;
  if (!email) return errorForbidden('No fue posible identificar tu cuenta.');
  const estado = String(data.estado || '').trim();
  if (['participo', 'no_participo'].indexOf(estado) === -1) return errorValidacion('estado', 'Indica si participaste o no en la pausa.');
  const trab = resolverTrabajador_(db, email);
  if (!trab.empresa_id) return errorValidacion('empresa_id', 'No pudimos determinar tu empresa. Avisa al administrador.');
  const pausa = pausaDeHoyEmpresa_(db, trab.empresa_id);
  if (!pausa) return errorValidacion('pausa', 'No hay una pausa activa programada para hoy.');
  if (PAUSAS_ESTADOS_REGISTRABLES.indexOf(pausa.estado) === -1) return errorValidacion('pausa', 'La pausa de hoy ya no admite registros (estado: ' + pausa.estado + ').');
  if (estado === 'participo' && data.confirmacion !== true && data.confirmacion !== 'true') return errorValidacion('confirmacion', 'Debes marcar la declaración de participación.');
  const motivo = String(data.motivo || '').trim();
  if (estado === 'no_participo' && !motivo) return errorValidacion('motivo', 'Indica el motivo por el que no pudiste participar.');
  let animo = enteroPositivo_(data.animo);
  if (animo !== null && (animo < 1 || animo > 5)) animo = null;

  const fila = {
    pausa_id: pausa.pausa_id, trabajador_id: trab.trabajador_id || '', email: email,
    fecha_hora_registro: new Date().toISOString(), estado: estado,
    motivo: estado === 'no_participo' ? motivo : '', comentario: String(data.comentario || '').trim(),
    confirmacion: estado === 'participo', origen: 'autoservicio', animo: animo === null ? '' : animo
  };
  const previo = buscarRegistro_(db, pausa.pausa_id, email);
  if (previo) {
    actualizarFilaPorId_(db, 'PAUSAS_ASISTENCIA', 'registro_id', previo.registro_id, fila);
    registrarLog_(db, pausa.pausa_id, contexto, 'asistencia_actualizada', email + ' -> ' + estado);
    return Object.assign({ registro_id: previo.registro_id }, fila);
  }
  fila.registro_id = crypto.randomUUID();
  agregarFila_(db, 'PAUSAS_ASISTENCIA', fila);
  registrarLog_(db, pausa.pausa_id, contexto, 'asistencia_registrada', email + ' -> ' + estado);
  return fila;
}
function registrarAsistenciaGrupal(db, data, contexto) {
  const pausa = buscarPausa_(db, data.pausa_id);
  if (!pausa) return errorValidacion('pausa_id', 'Pausa no encontrada.');
  const g = guardaCoordinador_(db, contexto, pausa); if (g) return g;
  if (PAUSAS_ESTADOS_REGISTRABLES.indexOf(pausa.estado) === -1) return errorValidacion('pausa', 'La pausa de hoy ya no admite registros (estado: ' + pausa.estado + ').');
  const registros = Array.isArray(data.registros) ? data.registros : [];
  if (!registros.length) return errorValidacion('registros', 'Indica al menos un trabajador a marcar.');
  const roster = leerSeguro_(db, 'PAUSAS_TRABAJADORES').filter((t) => esVerdadero_(t.activo) && String(t.empresa_id) === String(pausa.empresa_id));
  const porId = {};
  roster.forEach((t) => { porId[String(t.trabajador_id)] = t; });
  let actualizados = 0, omitidos = 0, invalidos = 0;
  registros.forEach((r) => {
    const trab = porId[String(r && r.trabajador_id)];
    if (!trab) { invalidos++; return; }
    const estado = String((r && r.estado) || '').trim();
    if (['participo', 'no_participo'].indexOf(estado) === -1) { invalidos++; return; }
    const previo = buscarRegistro_(db, pausa.pausa_id, trab.email);
    if (previo && previo.origen === 'autoservicio' && data.sobrescribir !== true) { omitidos++; return; }
    const fila = {
      pausa_id: pausa.pausa_id, trabajador_id: trab.trabajador_id, email: trab.email,
      fecha_hora_registro: new Date().toISOString(), estado: estado,
      motivo: estado === 'no_participo' ? String((r && r.motivo) || '').trim() : '', comentario: '',
      confirmacion: estado === 'participo', origen: 'pasada_lista', animo: ''
    };
    if (previo) actualizarFilaPorId_(db, 'PAUSAS_ASISTENCIA', 'registro_id', previo.registro_id, fila);
    else { fila.registro_id = crypto.randomUUID(); agregarFila_(db, 'PAUSAS_ASISTENCIA', fila); }
    actualizados++;
  });
  registrarLog_(db, pausa.pausa_id, contexto, 'asistencia_grupal', actualizados + ' marcados, ' + omitidos + ' omitidos (autoservicio), ' + invalidos + ' invalidos');
  return { pausa_id: pausa.pausa_id, actualizados: actualizados, omitidos: omitidos, invalidos: invalidos };
}

// ==== coordinador =========================================================
function getPanelCoordinador(db, data, contexto) {
  const email = contexto && contexto.email;
  if (!email) return errorForbidden('No fue posible identificar tu cuenta.');
  const empresas = empresasQueCoordina_(db, contexto);
  if (empresas.length === 0) return { sin_empresa: true, pausas: [] };
  const hoy = claveDia_(new Date(), TZ);
  const pausas = leerProgramadas_(db)
    .filter((p) => empresas.indexOf(String(p.empresa_id)) !== -1 && claveFecha_(p.fecha) === hoy)
    .map((p) => ({
      pausa_id: p.pausa_id, empresa_id: p.empresa_id, fecha: claveFecha_(p.fecha),
      hora_programada: p.hora_programada || '', hora_inicio_real: p.hora_inicio_real || '', hora_fin: p.hora_fin || '',
      estado: p.estado, duracion_min: p.duracion_min || '', observaciones: p.observaciones || '', evidencia_url: p.evidencia_url || '',
      participacion: participacionDePausa_(db, p.pausa_id, p.empresa_id)
    }));
  return { empresas: empresas, pausas: pausas };
}
function gestionarPausaCoordinador(db, data, contexto) {
  const pausa = buscarPausa_(db, data.pausa_id);
  if (!pausa) return errorValidacion('pausa_id', 'Pausa no encontrada.');
  const g = guardaCoordinador_(db, contexto, pausa); if (g) return g;
  switch (data.operacion) {
    case 'iniciar':
      return transicionar_(db, pausa, ESTADOS_PAUSA.EN_CURSO, contexto, { hora_inicio_real: new Date().toISOString(), coordinador_email: contexto.email });
    case 'finalizar': {
      // Evidencia (foto): bloqueada hasta que exista almacenamiento (R2). Si
      // el coordinador intenta adjuntarla, se avisa claro -- puede finalizar
      // sin ella (es opcional).
      if (data.evidencia_base64) {
        return errorValidacion('evidencia_base64', 'La evidencia (foto) todavía no está disponible en el nuevo sistema (falta configurar el almacenamiento de archivos). Finaliza la pausa sin adjuntar la foto por ahora.');
      }
      return transicionar_(db, pausa, ESTADOS_PAUSA.REALIZADA, contexto, {
        hora_fin: new Date().toISOString(), coordinador_email: pausa.coordinador_email || contexto.email,
        observaciones: data.observaciones ? String(data.observaciones).trim() : pausa.observaciones
      });
    }
    case 'no_realizada': {
      const motivo = String(data.motivo || '').trim();
      if (!motivo) return errorValidacion('motivo', 'Indica el motivo por el que no se realizo la pausa.');
      return transicionar_(db, pausa, ESTADOS_PAUSA.NO_REALIZADA, contexto, { coordinador_email: contexto.email, observaciones: motivo });
    }
    default: return errorValidacion('operacion', 'Operacion invalida: ' + data.operacion);
  }
}
function getReporteCumplimiento(db, data, contexto) {
  const empresas = empresasQueCoordina_(db, contexto);
  if (empresas.length === 0) return { sin_empresa: true };
  return calcularReporte_(db, empresas, data && data.desde, data && data.hasta);
}
function listarRosterCoordinador(db, data, contexto) {
  const empresas = empresasQueCoordina_(db, contexto);
  if (empresas.length === 0) return { sin_empresa: true, roster: [] };
  const roster = leerSeguro_(db, 'PAUSAS_TRABAJADORES')
    .filter((t) => esVerdadero_(t.activo) && empresas.indexOf(String(t.empresa_id)) !== -1)
    .map((t) => ({ trabajador_id: t.trabajador_id, nombre: t.nombre || t.email, email: t.email, area: t.area || '', empresa_id: t.empresa_id }))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  return { roster: roster };
}
function getHistorialTrabajador(db, data, contexto) {
  const trabajadorId = String(data.trabajador_id || '').trim();
  if (!trabajadorId) return errorValidacion('trabajador_id', 'Indica el trabajador.');
  const trabajador = leerSeguro_(db, 'PAUSAS_TRABAJADORES').find((t) => String(t.trabajador_id) === trabajadorId);
  if (!trabajador) return errorValidacion('trabajador_id', 'Trabajador no encontrado.');
  const empresas = empresasQueCoordina_(db, contexto);
  if (empresas.indexOf(String(trabajador.empresa_id)) === -1) return errorForbidden('No coordinas la empresa de este trabajador.');

  const hoy = claveDia_(new Date(), TZ);
  const hastaC = /^\d{4}-\d{2}-\d{2}$/.test(String(data.hasta || '')) ? data.hasta : hoy;
  const desdeC = /^\d{4}-\d{2}-\d{2}$/.test(String(data.desde || '')) ? data.desde : claveDia_(new Date(Date.now() - 90 * 24 * 3600 * 1000), TZ);
  const RESUELTOS = [ESTADOS_PAUSA.REALIZADA, ESTADOS_PAUSA.CERRADA, ESTADOS_PAUSA.NO_REALIZADA];
  const pausas = leerProgramadas_(db).filter((p) => {
    const f = claveFecha_(p.fecha);
    return String(p.empresa_id) === String(trabajador.empresa_id) && f >= desdeC && f <= hastaC && RESUELTOS.indexOf(p.estado) !== -1;
  }).sort((a, b) => claveFecha_(a.fecha) < claveFecha_(b.fecha) ? -1 : 1);

  const registrosPorPausa = {};
  leerSeguro_(db, 'PAUSAS_ASISTENCIA').forEach((r) => { if (normEmail_(r.email) === normEmail_(trabajador.email)) registrosPorPausa[String(r.pausa_id)] = r; });

  const detalle = pausas.map((p) => {
    const reg = registrosPorPausa[String(p.pausa_id)];
    let miEstado;
    if (p.estado === ESTADOS_PAUSA.NO_REALIZADA) miEstado = 'no_aplica';
    else miEstado = reg ? reg.estado : 'sin_registro';
    return { fecha: claveFecha_(p.fecha), estado_pausa: p.estado, mi_estado: miEstado, motivo: (reg && reg.motivo) || '' };
  });
  const participaciones = detalle.filter((d) => d.mi_estado === 'participo').length;
  const justificaciones = detalle.filter((d) => d.mi_estado === 'no_participo').length;
  const sinRegistro = detalle.filter((d) => d.mi_estado === 'sin_registro').length;
  const noAplica = detalle.filter((d) => d.mi_estado === 'no_aplica').length;
  let rachaActual = 0;
  for (let i = detalle.length - 1; i >= 0; i--) { if (detalle[i].mi_estado === 'no_aplica') continue; if (detalle[i].mi_estado === 'participo') rachaActual++; else break; }
  let rachaMaxima = 0, corrida = 0;
  detalle.forEach((d) => { if (d.mi_estado === 'no_aplica') return; corrida = d.mi_estado === 'participo' ? corrida + 1 : 0; if (corrida > rachaMaxima) rachaMaxima = corrida; });
  const diasQueContaban = detalle.length - noAplica;
  return {
    trabajador: { trabajador_id: trabajador.trabajador_id, nombre: trabajador.nombre || trabajador.email, email: trabajador.email, area: trabajador.area || '', empresa_id: trabajador.empresa_id },
    periodo: { desde: desdeC, hasta: hastaC },
    resumen: {
      total_pausas: detalle.length, participaciones: participaciones, justificaciones: justificaciones,
      sin_registro: sinRegistro, no_aplica: noAplica,
      pct_participacion: diasQueContaban === 0 ? null : Math.round((participaciones / diasQueContaban) * 1000) / 10,
      racha_actual: rachaActual, racha_maxima: rachaMaxima
    },
    detalle: detalle.slice().reverse()
  };
}

// ==== gerencia + PDF (PDF bloqueado por R2) ================================
function getReporteGerencia(db, data, contexto) {
  let empresas = empresasVisiblesGerencia_(db, contexto);
  if (empresas.length === 0) return { sin_datos: true, kpis: {}, motivos: [], por_area: [], pausas: [] };
  if (data && data.empresa_id) empresas = empresas.filter((e) => String(e) === String(data.empresa_id));
  return calcularReporte_(db, empresas, data && data.desde, data && data.hasta);
}
function descargarReporteCumplimientoPdf(db, data, contexto) {
  const empresas = empresasQueCoordina_(db, contexto);
  if (empresas.length === 0) return errorValidacion('empresa_id', 'No coordinas ninguna empresa con pausas activas.');
  return errorValidacion('pdf', 'La descarga en PDF todavía no está disponible en el nuevo sistema (falta el generador de PDF). Usa el reporte en pantalla por ahora.');
}
function descargarReporteGerenciaPdf(db, data, contexto) {
  const empresas = empresasVisiblesGerencia_(db, contexto);
  if (empresas.length === 0) return errorValidacion('empresa_id', 'No hay pausas activas configuradas.');
  return errorValidacion('pdf', 'La descarga en PDF todavía no está disponible en el nuevo sistema (falta el generador de PDF). Usa el reporte en pantalla por ahora.');
}

// ==== triggers de correo (background) =====================================
async function enviarRecordatorios(db, opts) {
  opts = opts || {};
  const ahoraMin = (opts.ahoraMin === undefined || opts.ahoraMin === null) ? minutosDelDia_() : opts.ahoraMin;
  const hoy = claveDia_(new Date(), TZ);
  const configs = leerConfig_(db).filter((c) => esVerdadero_(c.activo));
  const pausas = leerProgramadas_(db);
  let enviados = 0, avisadas = 0;
  for (const config of configs) {
    const pausa = pausas.find((p) => String(p.empresa_id) === String(config.empresa_id) && claveFecha_(p.fecha) === hoy && p.estado === ESTADOS_PAUSA.PROGRAMADA);
    if (!pausa) continue;
    const horaMin = horaAMinutos_(pausa.hora_programada);
    if (horaMin === null) continue;
    let anticip = enteroNoNegativo_(config.min_anticipacion);
    if (anticip === null) anticip = 15;
    if (ahoraMin < horaMin - anticip) continue;
    const destinatarios = destinatariosRecordatorio_(db, config.empresa_id);
    const asunto = 'SIGSO — Recordatorio de pausa activa (' + (pausa.hora_programada || '') + ')';
    const texto = 'Hoy tienes tu pausa activa a las ' + (pausa.hora_programada || '') + '. Registra tu participación en la plataforma (módulo Pausas activas).';
    for (const correo of destinatarios) {
      const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: claveAvisoHorario_(pausa), destinatario: correo, evento: 'PAUSA_RECORDATORIO', asunto, cuerpo: texto, ventanaMinutos: 720 });
      if (r.enviado) enviados++;
    }
    NotificacionesApp.encolarLote(db, destinatarios.map((correo) => ({ destinatario: correo, tipo: 'PAUSA_RECORDATORIO', titulo: 'Pausa activa de hoy', mensaje: 'Tu pausa activa es a las ' + (pausa.hora_programada || '') + '.', modulo_id: 'pausas', texto_accion: 'Ver pausas activas', vidaHoras: 6 })));
    transicionar_(db, pausa, ESTADOS_PAUSA.RECORDATORIO_ENVIADO, { email: 'sistema' }, {});
    avisadas++;
  }
  return { pausas_avisadas: avisadas, correos_enviados: enviados };
}
async function enviarSegundosAvisos(db, opts) {
  opts = opts || {};
  const ahoraMin = (opts.ahoraMin === undefined || opts.ahoraMin === null) ? minutosDelDia_() : opts.ahoraMin;
  const hoy = claveDia_(new Date(), TZ);
  const pausas = leerProgramadas_(db).filter((p) => claveFecha_(p.fecha) === hoy && (p.estado === ESTADOS_PAUSA.PROGRAMADA || p.estado === ESTADOS_PAUSA.RECORDATORIO_ENVIADO));
  let ultimaLlamada = 0, avisoCoordinadora = 0;
  for (const pausa of pausas) {
    const horaMin = horaAMinutos_(pausa.hora_programada);
    if (horaMin === null || ahoraMin < horaMin) continue;
    if (!esVerdadero_(pausa.ultima_llamada_enviada)) {
      const asunto = 'SIGSO — ¡Es ahora! Tu pausa activa (' + (pausa.hora_programada || '') + ')';
      const texto = 'Tu pausa activa de hoy es ahora mismo. Registra tu participación en la plataforma.';
      for (const correo of destinatariosRecordatorio_(db, pausa.empresa_id)) {
        const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: claveAvisoHorario_(pausa, 'ultima_llamada'), destinatario: correo, evento: 'PAUSA_ULTIMA_LLAMADA', asunto, cuerpo: texto, ventanaMinutos: 720 });
        if (r.enviado) ultimaLlamada++;
      }
      NotificacionesApp.encolarLote(db, destinatariosRecordatorio_(db, pausa.empresa_id).map((correo) => ({ destinatario: correo, tipo: 'PAUSA_ULTIMA_LLAMADA', titulo: '¡Es ahora tu pausa activa!', mensaje: 'Tu pausa activa de hoy es ahora mismo. Registra tu participación al terminar.', modulo_id: 'pausas', texto_accion: 'Registrar participación', vidaHoras: 2 })));
      actualizarFilaPorId_(db, 'PAUSAS_PROGRAMADAS', 'pausa_id', pausa.pausa_id, { ultima_llamada_enviada: true });
    }
    if (!esVerdadero_(pausa.aviso_coordinador_enviado)) {
      const asuntoCoord = 'SIGSO — Inicia la pausa activa de ' + pausa.empresa_id;
      const texto = 'Ya llegó la hora de la pausa activa de ' + pausa.empresa_id + '. Inícala desde Coordinación de pausas.';
      const destCoord = coordinadorasDeEmpresa_(db, pausa.empresa_id);
      for (const correo of destCoord) {
        const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: claveAvisoHorario_(pausa, 'aviso_coordinador'), destinatario: correo, evento: 'PAUSA_AVISO_COORDINADOR', asunto: asuntoCoord, cuerpo: texto, ventanaMinutos: 720 });
        if (r.enviado) avisoCoordinadora++;
      }
      NotificacionesApp.encolarLote(db, destCoord.map((correo) => ({ destinatario: correo, tipo: 'PAUSA_AVISO_COORDINADOR', titulo: 'Es hora de iniciar la pausa', mensaje: 'La pausa activa de ' + pausa.empresa_id + ' ya debería iniciar.', modulo_id: 'pausas_coordinacion', texto_accion: 'Iniciar la pausa', vidaHoras: 2 })));
      actualizarFilaPorId_(db, 'PAUSAS_PROGRAMADAS', 'pausa_id', pausa.pausa_id, { aviso_coordinador_enviado: true });
    }
  }
  return { ultima_llamada: ultimaLlamada, aviso_coordinadora: avisoCoordinadora };
}
async function escalarPausasSinIniciar(db, opts) {
  opts = opts || {};
  const margenMin = opts.margenMin === undefined ? 30 : opts.margenMin;
  const ahoraMin = (opts.ahoraMin === undefined || opts.ahoraMin === null) ? minutosDelDia_() : opts.ahoraMin;
  const hoy = claveDia_(new Date(), TZ);
  const pausas = leerProgramadas_(db).filter((p) => claveFecha_(p.fecha) === hoy && (p.estado === ESTADOS_PAUSA.PROGRAMADA || p.estado === ESTADOS_PAUSA.RECORDATORIO_ENVIADO) && !esVerdadero_(p.escalada_admin_enviada));
  let escaladas = 0, correosEnviados = 0;
  for (const pausa of pausas) {
    const horaMin = horaAMinutos_(pausa.hora_programada);
    if (horaMin === null || ahoraMin < horaMin + margenMin) continue;
    let destinatarios = [];
    try { destinatarios = obtenerEmailsPorRol_(db, pausa.empresa_id, ['ADM']); } catch (err) { /* USUARIOS puede faltar */ }
    if (!destinatarios.length) { actualizarFilaPorId_(db, 'PAUSAS_PROGRAMADAS', 'pausa_id', pausa.pausa_id, { escalada_admin_enviada: true }); continue; }
    const asunto = 'SIGSO — Nadie inició la pausa activa de ' + pausa.empresa_id;
    const texto = 'La pausa activa de ' + pausa.empresa_id + ' (' + (pausa.hora_programada || '') + ') sigue sin iniciarse ' + margenMin + ' minutos después.';
    for (const correo of destinatarios) {
      const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: pausa.pausa_id + ':escalada_admin', destinatario: correo, evento: 'PAUSA_ESCALADA_ADMIN', asunto, cuerpo: texto, ventanaMinutos: 720 });
      if (r.enviado) correosEnviados++;
    }
    NotificacionesApp.encolarLote(db, destinatarios.map((correo) => ({ destinatario: correo, tipo: 'PAUSA_ESCALADA_ADMIN', titulo: 'Nadie inició la pausa de ' + pausa.empresa_id, mensaje: 'Han pasado ' + margenMin + ' min desde la hora programada sin que la coordinadora la inicie.', modulo_id: 'pausas_coordinacion', texto_accion: 'Ver pausas', vidaHoras: 4 })));
    actualizarFilaPorId_(db, 'PAUSAS_PROGRAMADAS', 'pausa_id', pausa.pausa_id, { escalada_admin_enviada: true });
    escaladas++;
  }
  return { pausas_escaladas: escaladas, correos_enviados: correosEnviados };
}
async function enviarResumenDiario(db) {
  const hoy = claveDia_(new Date(), TZ);
  const pausas = leerProgramadas_(db).filter((p) => claveFecha_(p.fecha) === hoy && p.estado !== ESTADOS_PAUSA.CANCELADA);
  let enviados = 0;
  for (const pausa of pausas) {
    const part = participacionDePausa_(db, pausa.pausa_id, pausa.empresa_id);
    const asunto = 'SIGSO — Resumen de la pausa activa de hoy (' + pausa.empresa_id + ')';
    const texto = 'Pausa de hoy (' + pausa.empresa_id + '): estado ' + pausa.estado + ', participaron ' + part.n_participaron + ' de ' + part.total_roster + '.';
    for (const correo of destinatariosResumen_(db, pausa.empresa_id)) {
      const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: pausa.pausa_id, destinatario: correo, evento: 'PAUSA_RESUMEN_DIARIO', asunto, cuerpo: texto, ventanaMinutos: 720 });
      if (r.enviado) enviados++;
    }
  }
  return { pausas: pausas.length, correos_enviados: enviados };
}
async function enviarReportePeriodico(db, periodo) {
  const dias = periodo === 'mensual' ? 30 : 7;
  const hoy = claveDia_(new Date(), TZ);
  const desde = claveDia_(new Date(Date.now() - dias * 24 * 3600 * 1000), TZ);
  const empresas = leerConfig_(db).map((c) => String(c.empresa_id));
  if (empresas.length === 0) return { enviado: false, motivo: 'sin_config' };
  const reporte = calcularReporte_(db, empresas, desde, hoy);
  const etiqueta = periodo === 'mensual' ? 'mensual' : 'semanal';
  const titulo = 'Reporte ' + etiqueta + ' de pausas activas';
  const k = reporte.kpis;
  const texto = titulo + ' (' + reporte.periodo.desde + ' a ' + reporte.periodo.hasta + '): cumplimiento ' +
    (k.pct_cumplimiento == null ? '—' : k.pct_cumplimiento + '%') + ', ' + k.realizadas + ' realizadas.';
  const claveDedup = 'PAUSAS_REPORTE_' + etiqueta.toUpperCase() + ':' + hoy;
  let enviados = 0;
  for (const correo of destinatariosReporteGerencia_(db)) {
    const r = await Notificaciones.enviarCorreoModulo(db, { solicitudId: claveDedup, destinatario: correo, evento: 'PAUSA_REPORTE_' + etiqueta.toUpperCase(), asunto: 'SIGSO — ' + titulo, cuerpo: texto, ventanaMinutos: 60 * 24 });
    if (r.enviado) enviados++;
  }
  return { periodo: etiqueta, correos_enviados: enviados, kpis: k };
}
function cerrarPausasAbiertas(db) {
  const hoy = claveDia_(new Date(), TZ);
  const pausas = leerProgramadas_(db).filter((p) => claveFecha_(p.fecha) === hoy &&
    (p.estado === ESTADOS_PAUSA.EN_CURSO || p.estado === ESTADOS_PAUSA.PROGRAMADA || p.estado === ESTADOS_PAUSA.RECORDATORIO_ENVIADO));
  const sistema = { email: 'sistema' };
  let cerradas = 0;
  pausas.forEach((p) => {
    if (p.estado === ESTADOS_PAUSA.EN_CURSO) {
      transicionar_(db, p, ESTADOS_PAUSA.REALIZADA, sistema, { hora_fin: new Date().toISOString(), observaciones: (p.observaciones ? p.observaciones + ' — ' : '') + 'Cerrada automáticamente al final del día (la coordinadora no la finalizó).' });
    } else {
      transicionar_(db, p, ESTADOS_PAUSA.NO_REALIZADA, sistema, { observaciones: 'Cierre automático: la coordinadora no inició la pausa.' });
    }
    cerradas++;
  });
  return { cerradas: cerradas };
}

module.exports = {
  // HTTP actions
  listarConfig, guardarConfig, listarCoordinadores, gestionarCoordinador,
  listarTrabajadores, gestionarTrabajador, sembrarRosterDesdeCuentas, asignarModuloPausasRoster,
  listarProgramadas, programarDelDiaAdmin, gestionarPausaProgramada,
  getPausaHoyTrabajador, registrarAsistencia, registrarAsistenciaGrupal,
  getPanelCoordinador, gestionarPausaCoordinador, getReporteCumplimiento,
  listarRosterCoordinador, getHistorialTrabajador,
  getReporteGerencia, descargarReporteCumplimientoPdf, descargarReporteGerenciaPdf,
  // triggers (background)
  programarDelDia, enviarRecordatorios, enviarSegundosAvisos, escalarPausasSinIniciar,
  enviarResumenDiario, enviarReportePeriodico, cerrarPausasAbiertas
};
