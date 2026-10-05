'use strict';

/**
 * cierreAutomaticoSolicitudes.js — Solicitudes, etapa 1 (auditoría 2026-10-05,
 * decisión del dueño): lo que el equipo marca como Terminado (S08) y el
 * solicitante no confirma se cierra solo a los 5 días hábiles, con un aviso
 * 2 días hábiles antes. Antes no existía (el .gs lo mencionaba pero nunca se
 * portó): lo terminado esperaba para siempre.
 *
 * Regla que protege al solicitante: un ítem solo se cierra si ya se le avisó
 * y pasaron al menos 2 días hábiles desde ese aviso. Así, lo que ya llevaba
 * semanas terminado el día que esto entra en producción recibe primero su
 * aviso y se cierra después, nunca de golpe.
 *
 * Corre una vez al día (server/index.js, 08:00). Idempotente: correrlo de
 * más no avisa dos veces el mismo día ni cierra lo que ya cerró.
 */

const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { ESTADOS } = require('./constantesSolicitudes');
const Utils = require('./utils');
const Notificaciones = require('./notificaciones');
const SolicitudesBO = require('./solicitudesBackoffice');

const DIAS_HABILES_CIERRE = 5;
const DIAS_HABILES_AVISO_PREVIO = 2;
const TZ = 'America/Santiago';
const CONTEXTO_SISTEMA = { email: 'sistema', rol: 'SISTEMA' };

function feriadosSet_(db) {
  const set = {};
  try { leerFilas_(db, 'CONFIG_FERIADOS', COLUMNAS.CONFIG_FERIADOS).forEach((f) => { set[String(f.fecha).slice(0, 10)] = true; }); } catch (err) { /* sin feriados */ }
  return set;
}
// Días hábiles completos entre el día de `desde` (excluido) y `hasta` (incluido).
function diasHabilesEntre_(desde, hasta, feriados) {
  const inicio = new Date(desde);
  if (isNaN(inicio.getTime())) return 0;
  let clave = Utils.claveDia_(inicio, TZ);
  const fin = Utils.claveDia_(hasta, TZ);
  let n = 0, guarda = 0;
  while (clave < fin && guarda < 2000) {
    clave = Utils.siguienteDiaClave_(clave);
    if (Utils.esDiaHabil_(clave, feriados)) n++;
    guarda++;
  }
  return n;
}
function sumarHabiles_(desde, dias, feriados) {
  return Utils.sumarDiasHabiles_(desde, dias, { feriados: Object.keys(feriados) });
}

// Último aviso de cierre de la solicitud enviado DESPUÉS de que el ítem quedó terminado.
function avisoPrevio_(avisos, solicitudId, fechaTerminada) {
  const t = new Date(fechaTerminada).getTime();
  return avisos
    .filter((a) => a.solicitud_id === solicitudId && new Date(a.timestamp).getTime() >= t)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0] || null;
}

/**
 * Cuándo se cerraría un ítem terminado (para mostrárselo al solicitante): el
 * día 5 hábil desde que quedó terminado, o 2 hábiles después del aviso si el
 * aviso aún no sale o salió tarde. ISO o ''.
 */
function fechaCierreEstimada(db, item, ahora, contexto) {
  if (!item || item.estado !== ESTADOS.S08 || !item.fecha_terminada) return '';
  const ctx = contexto || {};
  const feriados = ctx.feriados || feriadosSet_(db);
  const avisos = ctx.avisos || avisosRegistrados_(db);
  const hoy = ahora || new Date();
  const porPlazo = sumarHabiles_(item.fecha_terminada, DIAS_HABILES_CIERRE, feriados);
  const aviso = avisoPrevio_(avisos, item.solicitud_id, item.fecha_terminada);
  // Sin aviso todavía: el aviso sale hoy o cuando toque, y el cierre 2 hábiles después.
  const baseAviso = aviso ? aviso.timestamp : maxIso_(hoy.toISOString(), sumarHabiles_(item.fecha_terminada, DIAS_HABILES_CIERRE - DIAS_HABILES_AVISO_PREVIO, feriados));
  const porAviso = sumarHabiles_(baseAviso, DIAS_HABILES_AVISO_PREVIO, feriados);
  return maxIso_(porPlazo, porAviso);
}
function maxIso_(a, b) { return new Date(a) > new Date(b) ? a : b; }

function avisosRegistrados_(db) {
  try {
    return leerFilas_(db, 'LOG_NOTIFICACIONES', COLUMNAS.LOG_NOTIFICACIONES)
      .filter((f) => String(f.evento || '').indexOf('AVISO_CIERRE:') === 0 && f.resultado !== 'ERROR');
  } catch (err) { return []; }
}

/** Avisa y cierra lo que corresponda. Devuelve { avisadas, cerrados }. */
function revisar(db, ahora) {
  const hoy = ahora || new Date();
  const feriados = feriadosSet_(db);
  const avisos = avisosRegistrados_(db);
  const solicitudes = {};
  leerFilas_(db, 'SOLICITUDES', COLUMNAS.SOLICITUDES).forEach((s) => { solicitudes[s.solicitud_id] = s; });
  const terminados = leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES)
    .filter((i) => i.estado === ESTADOS.S08 && i.fecha_terminada && solicitudes[i.solicitud_id]);

  const porAvisar = {};
  let cerrados = 0;
  terminados.forEach((item) => {
    const solicitud = solicitudes[item.solicitud_id];
    const dias = diasHabilesEntre_(item.fecha_terminada, hoy, feriados);
    const aviso = avisoPrevio_(avisos, item.solicitud_id, item.fecha_terminada);
    const sinDestinatario = !solicitud.solicitante_email;
    const avisoCumplido = aviso && diasHabilesEntre_(aviso.timestamp, hoy, feriados) >= DIAS_HABILES_AVISO_PREVIO;
    if (dias >= DIAS_HABILES_CIERRE && (avisoCumplido || sinDestinatario)) {
      const r = SolicitudesBO.actualizarEstado(db, {
        subsolicitud_id: item.subsolicitud_id, estado_nuevo: ESTADOS.S09,
        comentario: 'Cierre automático: el solicitante no respondió en ' + DIAS_HABILES_CIERRE + ' días hábiles desde que se marcó como terminada.'
      }, CONTEXTO_SISTEMA, { sistemaAutomatico: true });
      if (r && !r._validationError && !r._forbidden) cerrados++;
      return;
    }
    if (!aviso && !sinDestinatario && dias >= DIAS_HABILES_CIERRE - DIAS_HABILES_AVISO_PREVIO) {
      (porAvisar[item.solicitud_id] = porAvisar[item.solicitud_id] || []).push(item);
    }
  });

  let avisadas = 0;
  Object.keys(porAvisar).forEach((id) => {
    const items = porAvisar[id];
    const cierre = items.map((i) => fechaCierreEstimada(db, i, hoy, { feriados, avisos })).sort().pop();
    const r = Notificaciones.avisarCierreProximo(db, solicitudes[id], items, cierre);
    if (r && r.encolado) avisadas++;
  });
  return { avisadas, cerrados };
}

module.exports = { revisar, fechaCierreEstimada, diasHabilesEntre_, DIAS_HABILES_CIERRE, DIAS_HABILES_AVISO_PREVIO };
