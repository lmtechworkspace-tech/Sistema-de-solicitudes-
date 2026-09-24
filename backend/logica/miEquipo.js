'use strict';

/**
 * miEquipo.js — SIGSO v2, Módulo 4B: "Mi departamento" centrado en las
 * PERSONAS (decisión del dueño, 2026-09-24; análisis en
 * documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 * El panel clásico miraba solo solicitudes, pero 92 de 100 actividades son
 * tareas de proyecto: el equipo de un jefe podía tener 13 tareas y aparecer
 * con 0. Aquí cada persona del equipo trae TODO su trabajo:
 *  - tareas abiertas (de proyecto y personales) con su semáforo — la misma
 *    regla de Mi trabajo (Actividades.semaforoActividad_);
 *  - horas registradas por la persona en los últimos 7 días (y los 7
 *    anteriores), con la misma regla de Mi trabajo: por tarea y día manda
 *    el REGISTRO_DIA; si no hay, suman las horas de los check-in;
 *  - ítems de solicitudes a su cargo y lo que pidió y espera validar.
 *
 * Alcance: SOLO el equipo configurado en JEFATURAS para quien pregunta
 * (también para un ADM: antes "Actividades del equipo" le mostraba a toda la
 * empresa). Sin equipo, responde vacío.
 */

const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Utils = require('./utils');
const Jefatura = require('./jefatura');
const Gerencia = require('./gerencia');
const Actividades = require('./actividades');
const Dashboard = require('./dashboard');

const TZ = 'America/Santiago';
const DIA = 86400000;
const CERRADOS_SOL = ['S09', 'S10', 'S11'];

function leerSeguro_(db, hoja) {
  try { return leerFilas_(db, hoja, COLUMNAS[hoja]); } catch (e) { return []; }
}
function norm_(e) { return String(e || '').trim().toLowerCase(); }
function verdadero_(v) { return v === true || v === 'TRUE' || v === 1 || v === 'true'; }
function datosBitacora_(b) {
  if (!b.datos) return {};
  try { const d = JSON.parse(b.datos); return d && typeof d === 'object' ? d : {}; } catch (e) { return {}; }
}

// Orden de "lo que el jefe debería mirar primero".
const PESO_SEMAFORO = { atrasada: 0, bloqueada: 1, riesgo: 2 };

function getMiEquipo(db, data, contexto) {
  const equipo = Jefatura.obtenerEquipoJefe_(db, contexto && contexto.email);
  const vacio = { equipo: [], personas: [], resumen: { personas: 0, tareas_abiertas: 0, tareas_atrasadas: 0, bloqueadas: 0, por_confirmar: 0, horas_7d: 0, sin_registro_7d: 0 } };
  if (!equipo.length) return vacio;

  const nombres = Gerencia.mapaNombresUsuarios_(db);
  const cuentaPorEmail = {};
  leerSeguro_(db, 'CUENTAS_PORTAL').forEach((c) => {
    let emails = c.emails;
    if (typeof emails === 'string') { try { emails = JSON.parse(emails); } catch (e) { emails = String(emails).split(','); } }
    (Array.isArray(emails) ? emails : []).forEach((e) => { cuentaPorEmail[norm_(e)] = c; });
  });
  const proyectos = {};
  leerSeguro_(db, 'PROYECTOS').forEach((p) => { proyectos[p.proyecto_id] = p.nombre; });
  const actividades = leerSeguro_(db, 'ACTIVIDADES').filter((a) => verdadero_(a.activa));
  const bitacora = leerSeguro_(db, 'ACTIVIDADES_BITACORA');
  const solicitudes = leerSeguro_(db, 'SOLICITUDES');
  const subsPorSolicitud = {};
  leerSeguro_(db, 'SUBSOLICITUDES').forEach((i) => { (subsPorSolicitud[i.solicitud_id] = subsPorSolicitud[i.solicitud_id] || []).push(i); });

  const ahora = Date.now();
  const hoy = Utils.claveDia_(new Date(), TZ);
  const dias = [];
  for (let i = 13; i >= 0; i--) dias.push(Utils.claveDia_(new Date(ahora - i * DIA), TZ));
  const ultimos7 = dias.slice(7), previos7 = dias.slice(0, 7);

  const personas = equipo.map((emailOriginal) => {
    const email = norm_(emailOriginal);
    const cuenta = cuentaPorEmail[email];

    // --- Tareas -------------------------------------------------------------
    const suyas = actividades.filter((a) => norm_(a.responsable_email) === email);
    const abiertas = suyas.filter((a) => a.estado !== 'TERMINADA' && a.estado !== 'CANCELADA').map((a) => {
      const s = Actividades.semaforoActividad_(a);
      const ultima = a.ultima_actualizacion || a.fecha_creacion;
      return {
        actividad_id: a.actividad_id, titulo: a.titulo, estado: a.estado, prioridad: a.prioridad,
        proyecto_id: a.proyecto_id || '', proyecto_nombre: a.proyecto_id ? (proyectos[a.proyecto_id] || '') : '',
        personal: !a.proyecto_id, proyecto_texto: a.proyecto || '',
        semaforo: s.codigo, semaforo_etiqueta: s.etiqueta,
        fecha_compromiso: a.fecha_compromiso || '', fecha_propuesta: a.fecha_propuesta || '',
        por_confirmar: !!a.fecha_propuesta && !a.confirmada_en,
        avance_pct: Number(a.avance_pct) || 0, bloqueo_motivo: a.bloqueo_motivo || '',
        dias_sin_movimiento: ultima ? Math.floor((ahora - new Date(ultima).getTime()) / DIA) : null
      };
    }).sort((x, y) => {
      const px = PESO_SEMAFORO[x.semaforo] !== undefined ? PESO_SEMAFORO[x.semaforo] : (x.por_confirmar ? 3 : 4);
      const py = PESO_SEMAFORO[y.semaforo] !== undefined ? PESO_SEMAFORO[y.semaforo] : (y.por_confirmar ? 3 : 4);
      return (px - py) || (new Date(x.fecha_compromiso || '2999-01-01') - new Date(y.fecha_compromiso || '2999-01-01'));
    });
    const terminadas7 = suyas.filter((a) => a.estado === 'TERMINADA' && a.fecha_terminada && ahora - new Date(a.fecha_terminada).getTime() <= 7 * DIA).length;

    // --- Horas (lo que registró la propia persona) ---------------------------
    const idsSuyas = {};
    actividades.forEach((a) => { if (Actividades.trabajaLaActividad_(a, email)) idsSuyas[a.actividad_id] = true; });
    const registro = {}, checkin = {};
    let ultimaActividad = null;
    bitacora.forEach((b) => {
      if (!idsSuyas[b.actividad_id] || norm_(b.autor_email) !== email) return;
      if (!ultimaActividad || new Date(b.timestamp) > new Date(ultimaActividad)) ultimaActividad = b.timestamp;
      const d = datosBitacora_(b);
      if (b.tipo === 'REGISTRO_DIA') {
        if (d.dia) (registro[b.actividad_id] = registro[b.actividad_id] || {})[d.dia] = Number(d.horas) || 0;
      } else if (d.horas) {
        const k = Utils.claveDia_(new Date(b.timestamp), TZ);
        const m = (checkin[b.actividad_id] = checkin[b.actividad_id] || {});
        m[k] = (m[k] || 0) + (Number(d.horas) || 0);
      }
    });
    const horasPorDia = {};
    dias.forEach((k) => { horasPorDia[k] = 0; });
    Object.keys(idsSuyas).forEach((id) => {
      dias.forEach((k) => {
        const r = registro[id] && registro[id][k];
        horasPorDia[k] += (r !== undefined) ? r : ((checkin[id] && checkin[id][k]) || 0);
      });
    });
    const redondear = (v) => Math.round(v * 10) / 10;
    const horas7 = redondear(ultimos7.reduce((s, k) => s + horasPorDia[k], 0));
    const horasPrevias = redondear(previos7.reduce((s, k) => s + horasPorDia[k], 0));

    // --- Solicitudes ----------------------------------------------------------
    const aCargo = Dashboard.getCola(db, { solo_mios: true }, { rol: 'DEV', email: email }).items;
    const pedidas = solicitudes.filter((s) => norm_(s.solicitante_email) === email);
    let pedidasAbiertas = 0, porValidar = 0;
    pedidas.forEach((s) => {
      (subsPorSolicitud[s.solicitud_id] || []).forEach((i) => {
        if (CERRADOS_SOL.indexOf(i.estado) === -1) pedidasAbiertas++;
        if (i.estado === 'S08') porValidar++;
      });
    });

    return {
      email: email,
      nombre: nombres[email] || (cuenta && cuenta.nombre) || email,
      tiene_cuenta: !!cuenta,
      tareas: {
        abiertas: abiertas.length,
        atrasadas: abiertas.filter((a) => a.semaforo === 'atrasada').length,
        bloqueadas: abiertas.filter((a) => a.semaforo === 'bloqueada' || a.estado === 'BLOQUEADA').length,
        por_confirmar: abiertas.filter((a) => a.por_confirmar).length,
        sin_movimiento_7d: abiertas.filter((a) => a.dias_sin_movimiento !== null && a.dias_sin_movimiento > 7).length,
        terminadas_7d: terminadas7,
        lista: abiertas
      },
      horas: {
        ultimos_7d: horas7, previos_7d: horasPrevias,
        por_dia: ultimos7.map((k) => ({ dia: k, horas: redondear(horasPorDia[k]), hoy: k === hoy })),
        ultima_actividad: ultimaActividad
      },
      solicitudes: {
        a_cargo: aCargo.length,
        a_cargo_fuera_sla: aCargo.filter((i) => i.situacion_sla === 'FUERA_DE_PLAZO').length,
        pedidas_abiertas: pedidasAbiertas,
        por_validar: porValidar
      },
      sin_actividad: !suyas.length && !aCargo.length && !pedidas.length
    };
  });

  return {
    equipo: equipo,
    personas: personas,
    resumen: {
      personas: personas.length,
      tareas_abiertas: personas.reduce((s, p) => s + p.tareas.abiertas, 0),
      tareas_atrasadas: personas.reduce((s, p) => s + p.tareas.atrasadas, 0),
      bloqueadas: personas.reduce((s, p) => s + p.tareas.bloqueadas, 0),
      por_confirmar: personas.reduce((s, p) => s + p.tareas.por_confirmar, 0),
      horas_7d: Math.round(personas.reduce((s, p) => s + p.horas.ultimos_7d, 0) * 10) / 10,
      sin_registro_7d: personas.filter((p) => !p.horas.ultimos_7d && p.tareas.abiertas).length
    }
  };
}

module.exports = { getMiEquipo };
