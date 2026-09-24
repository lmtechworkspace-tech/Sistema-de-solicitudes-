'use strict';

/**
 * resumenGerencia.js — SIGSO v2, Módulo 4A: "Resumen ejecutivo" de Gerencia
 * (análisis y decisiones en documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 * Una sola lectura que junta lo que hoy vive en tres pantallas separadas
 * (solicitudes, actividades, pausas) MÁS el portafolio de proyectos, que
 * Gerencia no veía. No calcula nada nuevo por su cuenta: cada bloque delega
 * en la misma función que ya atiende su pantalla de detalle, así los números
 * del resumen y del detalle coinciden.
 *
 * Decisión del dueño (2026-09-24): el atraso se muestra con AMBAS medidas.
 * "Fuera de plazo (SLA)" es el titular; "atrasadas vs. fecha comprometida"
 * (la medida histórica del panel) y "sin fecha comprometida" van al lado,
 * porque la segunda sola decía "4 atrasadas" cuando 33 ítems estaban fuera
 * de SLA y 36 ni siquiera tenían fecha.
 *
 * Alcance: organización completa, igual que el Panel de gerencia. Quien
 * tiene el módulo Gerencia (o rol ADM/GERENCIA) lee con alcance de
 * Gerencia; es solo lectura y agregada.
 */

const Dashboard = require('./dashboard');
const Gerencia = require('./gerencia');
const Proyectos = require('./proyectos');
const Actividades = require('./actividades');
const Pausas = require('./pausas');

const CERRADOS_SOL = ['S08', 'S09', 'S10', 'S11'];
const DIA = 86400000;

function puedeVer_(contexto) {
  if (!contexto) return false;
  if (contexto.rol === 'ADM' || contexto.rol === 'GERENCIA') return true;
  return (contexto.modulos || []).indexOf('gerencia') !== -1;
}

// Una parte que falla no tumba el resumen (mismo criterio que getInicio).
function seccion_(fn) {
  try {
    const r = fn();
    if (r && (r._forbidden || r._validationError)) return { ok: false, message: r.message || '' };
    return { ok: true, data: r };
  } catch (err) {
    return { ok: false, message: 'No se pudo calcular esta parte.' };
  }
}

function solicitudes_(db, contexto, ctxGerencia) {
  // getCola sin acotar = alcance ADM (toda la cola); Gerencia.getPanel no
  // acota por persona. Ambos, solo lectura.
  const cola = Dashboard.getCola(db, {}, { rol: 'ADM', email: contexto.email });
  const ger = Gerencia.getPanel(db, {}, ctxGerencia);
  const ahora = Date.now();
  const abiertos = cola.items.filter((i) => CERRADOS_SOL.indexOf(i.estado) === -1);
  const hace30 = ahora - 30 * DIA;
  return {
    resumen: cola.resumen,
    atrasadas_compromiso: ger.kpis.atrasadas_activas,
    pct_cumplimiento_compromiso: ger.kpis.pct_cumplimiento_desarrollador,
    atraso_promedio_dias: ger.kpis.atraso_promedio_dias,
    ingresados_30: ger.items.filter((i) => new Date(i.fecha_creacion).getTime() >= hace30).length,
    cerrados_30: ger.items.filter((i) => i.estado === 'S09' && i.fecha_terminada && new Date(i.fecha_terminada).getTime() >= hace30).length,
    abiertos_mas_60: abiertos.filter((i) => ahora - new Date(i.fecha_creacion).getTime() > 60 * DIA).length,
    criticos: abiertos.filter((i) => i.prioridad === 'P1')
      .sort((a, b) => new Date(a.fecha_creacion) - new Date(b.fecha_creacion))
      .slice(0, 5)
      .map((i) => ({
        subsolicitud_id: i.subsolicitud_id, solicitud_id: i.solicitud_id, titulo: i.titulo,
        empresa_nombre: i.empresa_nombre, estado: i.estado, asignado: i.asignado, asignado_nombre: i.asignado_nombre,
        situacion_sla: i.situacion_sla, dias_abierto: Math.floor((ahora - new Date(i.fecha_creacion).getTime()) / DIA)
      }))
  };
}

function proyectos_(db, ctxGerencia) {
  const activos = Proyectos.listar(db, {}, ctxGerencia).filter((p) => p.estado !== 'CERRADO' && p.estado !== 'CANCELADO');
  const porSalud = { critico: 0, riesgo: 0, normal: 0 };
  const porEstado = {};
  activos.forEach((p) => {
    porSalud[p.salud] = (porSalud[p.salud] || 0) + 1;
    porEstado[p.estado] = (porEstado[p.estado] || 0) + 1;
  });
  const conAvance = activos.filter((p) => p.avance_pct !== null && p.avance_pct !== undefined && p.avance_pct !== '');
  return {
    total: activos.length,
    por_salud: porSalud,
    por_estado: porEstado,
    avance_promedio: conAvance.length ? Math.round(conAvance.reduce((s, p) => s + Number(p.avance_pct), 0) / conAvance.length) : null,
    sin_tareas: activos.filter((p) => !p.total_tareas).length,
    atencion: activos.filter((p) => p.salud !== 'normal').slice(0, 6).map((p) => ({
      proyecto_id: p.proyecto_id, nombre: p.nombre, lider_email: p.lider_email, estado: p.estado,
      salud: p.salud, salud_etiqueta: p.salud_etiqueta, motivos: (p.salud_motivos || []).slice(0, 2),
      avance_pct: p.avance_pct, fecha_objetivo: p.fecha_objetivo || ''
    }))
  };
}

function tareas_(db, contexto, ctxGerencia) {
  const panel = Actividades.getPanelGerencia(db, {}, ctxGerencia);
  const abiertas = Actividades.listar(db, {}, { rol: 'ADM', email: contexto.email })
    .filter((a) => a.estado !== 'TERMINADA' && a.estado !== 'CANCELADA');
  return {
    abiertas: abiertas.length,
    atrasadas: abiertas.filter((a) => a.semaforo === 'atrasada').length,
    bloqueadas: abiertas.filter((a) => a.semaforo === 'bloqueada' || a.estado === 'BLOQUEADA').length,
    por_confirmar: abiertas.filter((a) => a.fecha_propuesta && !a.confirmada_en).length,
    pct_cumplidas_a_tiempo: panel.kpis.pct_cumplidas_a_tiempo,
    criticas: panel.criticas.length,
    criticas_top: panel.criticas.slice(0, 5)
  };
}

// ¿Quién carga el trabajo? Tareas abiertas + ítems de solicitudes abiertos
// por persona, con lo atrasado de cada lado.
function personas_(db, contexto) {
  const nombres = Gerencia.mapaNombresUsuarios_(db);
  const p = {};
  function de(email, nombre) {
    const k = String(email || '').toLowerCase();
    if (!k) return null;
    if (!p[k]) p[k] = { email: k, nombre: nombres[k] || nombre || k, tareas: 0, tareas_atrasadas: 0, items: 0, items_fuera_sla: 0 };
    return p[k];
  }
  Actividades.listar(db, {}, { rol: 'ADM', email: contexto.email })
    .filter((a) => a.estado !== 'TERMINADA' && a.estado !== 'CANCELADA')
    .forEach((a) => {
      const x = de(a.responsable_email, a.responsable_nombre);
      if (!x) return;
      x.tareas++;
      if (a.semaforo === 'atrasada') x.tareas_atrasadas++;
    });
  Dashboard.getCola(db, {}, { rol: 'ADM', email: contexto.email }).items
    .filter((i) => CERRADOS_SOL.indexOf(i.estado) === -1)
    .forEach((i) => {
      const x = de(i.asignado, i.asignado_nombre);
      if (!x) return;
      x.items++;
      if (i.situacion_sla === 'FUERA_DE_PLAZO') x.items_fuera_sla++;
    });
  return Object.keys(p).map((k) => p[k])
    .sort((a, b) => (b.tareas + b.items) - (a.tareas + a.items))
    .slice(0, 8);
}

function pausas_(db, ctxGerencia) {
  const r = Pausas.getReporteGerencia(db, {}, ctxGerencia);
  return { sin_datos: !!r.sin_datos, periodo: r.periodo || null, kpis: r.kpis || {} };
}

function getResumen(db, data, contexto) {
  if (!puedeVer_(contexto)) return { _forbidden: true, message: 'El resumen ejecutivo es para Gerencia.' };
  const ctxGerencia = Object.assign({}, contexto, { rol: contexto.rol === 'ADM' ? 'ADM' : 'GERENCIA' });
  return {
    generado_en: new Date().toISOString(),
    solicitudes: seccion_(() => solicitudes_(db, contexto, ctxGerencia)),
    proyectos: seccion_(() => proyectos_(db, ctxGerencia)),
    tareas: seccion_(() => tareas_(db, contexto, ctxGerencia)),
    personas: seccion_(() => personas_(db, contexto)),
    pausas: seccion_(() => pausas_(db, ctxGerencia))
  };
}

module.exports = { getResumen, puedeVer_ };
