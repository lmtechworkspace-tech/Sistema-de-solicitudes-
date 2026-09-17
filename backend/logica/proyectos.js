'use strict';

/**
 * proyectos.js — puerto de backend/backoffice/Proyectos.gs (incremento 1:
 * MVP + Sala + reuniones/decisiones + entregables/riesgos + plantillas +
 * portafolio -- todo lo que NO depende de R2 (adjuntos/documentos, gateados,
 * ver el final de este archivo) ni del motor de PDF/Cronograma avanzado
 * (guardarRegistroDia/obtenerRendimiento/obtenerAnalitica/
 * obtenerWorkloadPortafolio/congelarBaseline/reprogramarTarea, v11
 * Reingenieria Cronograma -- queda para el incremento 2).
 *
 * Decision central de la propuesta (§0): las TAREAS de un proyecto NO son
 * una entidad nueva -- son ACTIVIDADES (actividades.js, motor de Gestion
 * Operacional v7.0), extendida con proyecto_id/hito_id. Este archivo es la
 * capa contenedora + sala de trabajo encima de ese motor ya probado: nunca
 * reimplementa check-in, estados, bloqueos, semaforo o reasignacion --
 * llama a Actividades.* tal cual, con datos enriquecidos.
 *
 * Patron de permisos (igual que Actividades/Jefatura/Novedades): la
 * membresia en PROYECTO_INTEGRANTES es el gate FINO (quien ve/edita que
 * proyecto). ADM y GERENCIA ven todo (GERENCIA de solo lectura).
 *
 * Este modulo desgatea el acoplamiento documentado en actividades.js: al
 * existir `rolEnProyecto_` aqui, el brazo de RN-709 que permite crear una
 * actividad para un integrante del MISMO proyecto empieza a conceder.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, agregarFilas_, actualizarFilaPorId_, eliminarFilasPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Utils = require('./utils');
const Cumplimiento = require('./cumplimiento');
const Actividades = require('./actividades');
const NotificacionesApp = require('./notificacionesApp');

const ORDEN_PRIORIDAD = ['P1', 'P2', 'P3', 'P4'];
const PRIORIDAD_POR_DEFECTO = 'P3';

const PROYECTOS_ESTADOS = {
  PLANIFICACION: 'PLANIFICACION', ACTIVO: 'ACTIVO', EN_PAUSA: 'EN_PAUSA',
  EN_REVISION: 'EN_REVISION', CERRADO: 'CERRADO', CANCELADO: 'CANCELADO'
};

// v11 (P1, "score de salud explicable y ponderado"): pesos documentados que
// restan de 100, uno por cada senal objetiva que ya alimenta el semaforo.
const SALUD_PESOS_ = {
  hito_vencido: 15, tarea_critica_atrasada: 12, tarea_atrasada: 5,
  bloqueo_estancado: 15, tarea_bloqueada: 6, sin_actualizar: 4,
  entregable_vencido: 8, entregable_observado: 5
};

function uuid_() { return crypto.randomUUID(); }
function errorValidacion_(campo, mensaje) { return { _validationError: true, campo, message: mensaje }; }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function normalizarEmail_(email) { return String(email || '').trim().toLowerCase(); }
function leer_(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function leerSeguro_(db, hoja) { try { return leer_(db, hoja); } catch (err) { return []; } }
function obtenerFeriados_(db) { try { return Cumplimiento.obtenerFeriados(db); } catch (err) { return []; } }
function fechaCorta_(valor) {
  if (!valor) return '—';
  try { return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(valor)).replace(/\//g, '-'); }
  catch (err) { return String(valor).slice(0, 10); }
}

// --- permisos (gate fino: membresia en PROYECTO_INTEGRANTES) ---------------
function proyectosDelUsuario_(db, email) {
  const normalizado = normalizarEmail_(email);
  return leerSeguro_(db, 'PROYECTO_INTEGRANTES')
    .filter((i) => normalizarEmail_(i.usuario_email) === normalizado && esVerdadero_(i.activo))
    .map((i) => i.proyecto_id);
}

// Exportada: es el gate fino que actividades.js consulta para el circulo de
// confianza del proyecto en RN-709 (ver la nota de acoplamiento ahi).
function rolEnProyecto_(db, proyectoId, contexto) {
  const email = normalizarEmail_(contexto && contexto.email);
  const fila = leerSeguro_(db, 'PROYECTO_INTEGRANTES').filter((i) =>
    i.proyecto_id === proyectoId && normalizarEmail_(i.usuario_email) === email && esVerdadero_(i.activo))[0];
  return fila ? fila.rol_proyecto : '';
}

function puedeVerProyecto_(db, proyecto, contexto) {
  if (!contexto) return false;
  if (contexto.rol === 'ADM' || contexto.rol === 'GERENCIA') return true;
  return !!rolEnProyecto_(db, proyecto.proyecto_id, contexto);
}

function puedeGestionarProyecto_(db, proyecto, contexto) {
  if (!contexto) return false;
  if (contexto.rol === 'ADM') return true;
  if (contexto.rol === 'GERENCIA') return false;
  return rolEnProyecto_(db, proyecto.proyecto_id, contexto) === 'LIDER';
}

function errorFechasProyecto_(inicio, objetivo) {
  if (!inicio || !objetivo) return null;
  const i = new Date(inicio), o = new Date(objetivo);
  if (isNaN(i.getTime()) || isNaN(o.getTime())) return null;
  if (o < i) return errorValidacion_('fecha_objetivo', 'La fecha objetivo no puede ser anterior a la fecha de inicio.');
  return null;
}

// --- helpers internos --------------------------------------------------
function buscarProyecto_(db, proyectoId) {
  if (!proyectoId) return null;
  return leerSeguro_(db, 'PROYECTOS').find((p) => p.proyecto_id === proyectoId) || null;
}
function buscarPlantilla_(db, plantillaId) {
  if (!plantillaId) return null;
  return leerSeguro_(db, 'PROYECTO_PLANTILLAS').find((p) => p.plantilla_id === plantillaId && esVerdadero_(p.activa)) || null;
}
function buscarIntegranteProyecto_(db, integranteId) {
  return leerSeguro_(db, 'PROYECTO_INTEGRANTES').find((i) => i.integrante_id === integranteId) || null;
}
function agregarIntegrante_(db, proyectoId, email, nombre, rolProyecto, responsabilidad, contexto) {
  const integrante = {
    integrante_id: uuid_(), proyecto_id: proyectoId, usuario_email: normalizarEmail_(email),
    usuario_nombre: nombre || '', rol_proyecto: rolProyecto, responsabilidad: responsabilidad || '',
    activo: true, agregado_por: (contexto && contexto.email) || '', fecha_creacion: new Date().toISOString(),
    ultima_visita_sala: ''
  };
  agregarFila_(db, 'PROYECTO_INTEGRANTES', integrante);
  return integrante;
}
function buscarEntregable_(db, entregableId) {
  if (!entregableId) return null;
  return leerSeguro_(db, 'PROYECTO_ENTREGABLES').find((e) => e.entregable_id === entregableId) || null;
}
function buscarRiesgo_(db, riesgoId) {
  if (!riesgoId) return null;
  return leerSeguro_(db, 'PROYECTO_RIESGOS').find((r) => r.riesgo_id === riesgoId) || null;
}
function calcularNivelRiesgo_(probabilidad, impacto) {
  const peso = { BAJA: 1, MEDIA: 2, ALTA: 3 };
  const score = (peso[probabilidad] || 2) * (peso[impacto] || 2);
  if (score >= 6) return 'ALTA';
  if (score >= 3) return 'MEDIA';
  return 'BAJA';
}
function notificarLideresProyecto_(db, proyecto, contexto, titulo, mensaje) {
  const items = leerSeguro_(db, 'PROYECTO_INTEGRANTES')
    .filter((i) => i.proyecto_id === proyecto.proyecto_id && i.rol_proyecto === 'LIDER' && esVerdadero_(i.activo) &&
      normalizarEmail_(i.usuario_email) !== normalizarEmail_(contexto.email))
    .map((i) => ({ destinatario: i.usuario_email, tipo: 'PROYECTO_ENTREGABLE', titulo, mensaje, modulo_id: 'proyectos', texto_accion: 'Ver proyecto', vidaHoras: 72 }));
  NotificacionesApp.encolarLote(db, items);
}
function eliminarFilaHito_(db, hitoId) {
  return actualizarFilaPorId_(db, 'PROYECTO_HITOS', 'hito_id', hitoId, { estado: 'CANCELADO' });
}
function registrarEventoProyecto_(db, proyectoId, tipo, contexto, cuerpoOTitulo, refTipo, refId, cuerpo, menciones) {
  const evento = {
    evento_id: uuid_(), proyecto_id: proyectoId, tipo: tipo,
    autor_email: (contexto && contexto.email) || '', autor_nombre: (contexto && contexto.nombre) || '',
    titulo: cuerpoOTitulo || '', cuerpo: cuerpo || '', ref_tipo: refTipo || '', ref_id: refId || '',
    menciones: menciones ? (Array.isArray(menciones) ? menciones.join(',') : menciones) : '',
    timestamp: new Date().toISOString()
  };
  agregarFila_(db, 'PROYECTO_EVENTOS', evento);
  actualizarFilaPorId_(db, 'PROYECTOS', 'proyecto_id', proyectoId, { ultima_actualizacion: evento.timestamp });
  return evento;
}
function notificarSala_(db, proyecto, evento, contexto) {
  const destinatarios = {};
  (evento.menciones || '').split(',').forEach((email) => {
    const normalizado = normalizarEmail_(email);
    if (normalizado) destinatarios[normalizado] = true;
  });
  if (evento.tipo === 'SOLICITUD_LIDER') {
    leerSeguro_(db, 'PROYECTO_INTEGRANTES').forEach((i) => {
      if (i.proyecto_id === proyecto.proyecto_id && esVerdadero_(i.activo) &&
        normalizarEmail_(i.usuario_email) !== normalizarEmail_(contexto.email)) {
        destinatarios[normalizarEmail_(i.usuario_email)] = true;
      }
    });
  }
  const titulo = evento.tipo === 'SOLICITUD_LIDER' ? 'Solicitud del líder en ' + proyecto.nombre : 'Actividad en ' + proyecto.nombre;
  const items = Object.keys(destinatarios).map((email) => ({
    destinatario: email, tipo: 'PROYECTO_SALA', titulo,
    mensaje: (evento.titulo || evento.cuerpo || '').slice(0, 140), modulo_id: 'proyectos', texto_accion: 'Ver sala', vidaHoras: 72
  }));
  NotificacionesApp.encolarLote(db, items);
}

// --- avance y salud (§J de la propuesta: explicable, no caja negra) -------
function calcularCumplimientoTareasProyecto_(tareas) {
  const activas = (tareas || []).filter((a) => esVerdadero_(a.activa));
  const entregadas = activas.filter((a) => a.fecha_terminada && a.fecha_compromiso);
  const aTiempo = entregadas.filter((a) => new Date(a.fecha_terminada) <= new Date(a.fecha_compromiso));
  return {
    total: activas.length, entregadas: entregadas.length, a_tiempo: aTiempo.length,
    sin_comprometer: activas.filter((a) => !a.fecha_compromiso).length,
    pct: entregadas.length ? Math.round((aTiempo.length / entregadas.length) * 1000) / 10 : null
  };
}
function calcularAvanceProyecto_(tareas) {
  const activas = tareas.filter((a) => esVerdadero_(a.activa));
  if (activas.length === 0) return null;
  const terminadas = activas.filter((a) => a.estado === 'TERMINADA');
  return Math.round((terminadas.length / activas.length) * 1000) / 10;
}

function calcularSaludProyecto_(db, proyecto, tareas, hitos, entregables) {
  if (proyecto.salud_override) {
    const etiquetas = { critico: 'Crítico', riesgo: 'En riesgo', normal: 'Normal' };
    return {
      codigo: proyecto.salud_override, etiqueta: etiquetas[proyecto.salud_override] || proyecto.salud_override,
      motivos: [proyecto.salud_override_motivo || 'Fijado manualmente.'], score: null, penalizacion: null, desglose: []
    };
  }
  if (proyecto.estado === PROYECTOS_ESTADOS.CERRADO || proyecto.estado === PROYECTOS_ESTADOS.CANCELADO) {
    return { codigo: 'normal', etiqueta: 'Normal', motivos: [], score: 100, penalizacion: 0, desglose: [] };
  }
  const activas = tareas.filter((a) => esVerdadero_(a.activa));
  const motivosCriticos = [], motivosRiesgo = [], desglose = [];
  const ahora = new Date();
  function anota(bucket, factor, cantidad, texto) {
    const puntos = cantidad * SALUD_PESOS_[factor];
    bucket.push(cantidad + texto);
    desglose.push({ factor, cantidad, puntos });
  }

  const hitosVencidos = (hitos || []).filter((h) => h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO' && h.fecha_objetivo && new Date(h.fecha_objetivo) < ahora);
  if (hitosVencidos.length > 0) anota(motivosCriticos, 'hito_vencido', hitosVencidos.length, ' hito(s) vencido(s)');

  const tareasAtrasadas = activas.filter((a) => Actividades.semaforoActividad_(a).codigo === 'atrasada');
  const criticasAtrasadas = tareasAtrasadas.filter((a) => ['P1', 'P2'].indexOf(a.prioridad) !== -1);
  if (criticasAtrasadas.length > 0) anota(motivosCriticos, 'tarea_critica_atrasada', criticasAtrasadas.length, ' tarea(s) crítica(s) atrasada(s)');
  else if (tareasAtrasadas.length > 0) anota(motivosRiesgo, 'tarea_atrasada', tareasAtrasadas.length, ' tarea(s) atrasada(s)');

  const bloqueadas = activas.filter((a) => a.estado === 'BLOQUEADA');
  const feriados = obtenerFeriados_(db);
  const bloqueoEstancado = bloqueadas.filter((a) => a.bloqueo_desde && Utils.horasHabilesEntre(a.bloqueo_desde, ahora, { feriados }) / 9 >= 2);
  if (bloqueoEstancado.length > 0) anota(motivosCriticos, 'bloqueo_estancado', bloqueoEstancado.length, ' bloqueo(s) estancado(s) (2+ días hábiles)');
  else if (bloqueadas.length > 0) anota(motivosRiesgo, 'tarea_bloqueada', bloqueadas.length, ' tarea(s) bloqueada(s)');

  const sinActualizar = activas.filter((a) => a.ultima_actualizacion && Utils.horasHabilesEntre(a.ultima_actualizacion, ahora, { feriados }) / 9 >= 5);
  if (sinActualizar.length > 0) anota(motivosRiesgo, 'sin_actualizar', sinActualizar.length, ' tarea(s) sin actualizar hace 5+ días hábiles');

  const entregablesVigentes = (entregables || []).filter((e) => e.estado !== 'APROBADO' && e.estado !== 'CANCELADO');
  const entregablesVencidos = entregablesVigentes.filter((e) => e.fecha_comprometida && new Date(e.fecha_comprometida) < ahora);
  if (entregablesVencidos.length > 0) anota(motivosRiesgo, 'entregable_vencido', entregablesVencidos.length, ' entregable(s) vencido(s)');
  const entregablesObservados = entregablesVigentes.filter((e) => e.estado === 'OBSERVADO');
  if (entregablesObservados.length > 0) anota(motivosRiesgo, 'entregable_observado', entregablesObservados.length, ' entregable(s) observado(s)');

  const penalizacion = Math.min(100, desglose.reduce((s, d) => s + d.puntos, 0));
  const score = Math.max(0, 100 - penalizacion);

  if (motivosCriticos.length > 0) return { codigo: 'critico', etiqueta: 'Crítico', motivos: motivosCriticos.concat(motivosRiesgo), score, penalizacion, desglose };
  if (motivosRiesgo.length > 0) return { codigo: 'riesgo', etiqueta: 'En riesgo', motivos: motivosRiesgo, score, penalizacion, desglose };
  return { codigo: 'normal', etiqueta: 'Normal', motivos: [], score: 100, desglose: [] };
}

function calcularRequiereAtencion_(tareas, hitos, integrantes, riesgos) {
  const ahora = new Date();
  const activas = tareas.filter((a) => esVerdadero_(a.activa));
  const vencidas = activas.filter((a) => Actividades.semaforoActividad_(a).codigo === 'atrasada');
  const bloqueadas = activas.filter((a) => a.estado === 'BLOQUEADA');
  const hitosAtrasados = (hitos || []).filter((h) => h.estado !== 'COMPLETADO' && h.estado !== 'CANCELADO' && h.fecha_objetivo && new Date(h.fecha_objetivo) < ahora);
  const criticasAtrasadas = vencidas.filter((a) => ['P1', 'P2'].indexOf(a.prioridad) !== -1);
  const riesgosAltos = (riesgos || []).filter((r) => r.nivel === 'ALTA' && r.estado === 'ABIERTO');

  const items = [];
  criticasAtrasadas.forEach((a) => items.push({ tipo: 'tarea_critica_atrasada', tab: 'tareas', titulo: a.titulo, meta: 'Prioridad ' + a.prioridad + ' · vencida' }));
  bloqueadas.forEach((a) => items.push({ tipo: 'tarea_bloqueada', tab: 'tareas', titulo: a.titulo, meta: a.bloqueo_motivo || 'Bloqueada' }));
  vencidas.forEach((a) => {
    if (['P1', 'P2'].indexOf(a.prioridad) !== -1) return;
    items.push({ tipo: 'tarea_vencida', tab: 'tareas', titulo: a.titulo, meta: 'Venció ' + fechaCorta_(a.fecha_compromiso) });
  });
  hitosAtrasados.forEach((h) => items.push({ tipo: 'hito_atrasado', tab: 'hitos', titulo: h.nombre, meta: 'Vencía ' + fechaCorta_(h.fecha_objetivo) }));
  riesgosAltos.forEach((r) => items.push({ tipo: 'riesgo_alto', tab: 'riesgos', titulo: r.descripcion, meta: 'Riesgo alto · abierto' }));

  return {
    tareas_vencidas: vencidas.length, tareas_bloqueadas: bloqueadas.length, hitos_atrasados: hitosAtrasados.length,
    total_integrantes: (integrantes || []).length, tareas_criticas_atrasadas: criticasAtrasadas.length,
    riesgos_altos: riesgosAltos.length, items: items.slice(0, 8), items_total: items.length
  };
}

function calcularAvanceEsperado_(fechaInicio, fechaFin, ahora) {
  if (!fechaInicio || !fechaFin) return null;
  const ini = new Date(fechaInicio), fin = new Date(fechaFin);
  if (isNaN(ini.getTime()) || isNaN(fin.getTime()) || fin <= ini) return null;
  const pct = ((ahora.getTime() - ini.getTime()) / (fin.getTime() - ini.getTime())) * 100;
  return Math.round(Math.max(0, Math.min(100, pct)) * 10) / 10;
}

function calcularResumenVisitaProyecto_(db, proyecto, contexto, integrantes, tareas) {
  const miIntegrante = integrantes.find((i) => normalizarEmail_(i.usuario_email) === normalizarEmail_(contexto && contexto.email));
  if (!miIntegrante || !miIntegrante.ultima_visita_sala) return null;
  const desde = miIntegrante.ultima_visita_sala;
  const desdeMs = new Date(desde).getTime();
  const eventos = leerSeguro_(db, 'PROYECTO_EVENTOS').filter((e) => e.proyecto_id === proyecto.proyecto_id && new Date(e.timestamp).getTime() >= desdeMs);
  const tareasCompletadas = tareas.filter((a) => a.estado === 'TERMINADA' && a.ultima_actualizacion && new Date(a.ultima_actualizacion).getTime() >= desdeMs).length;
  const tareasBloqueadas = tareas.filter((a) => a.estado === 'BLOQUEADA' && a.ultima_actualizacion && new Date(a.ultima_actualizacion).getTime() >= desdeMs).length;
  const entregablesAprobados = eventos.filter((e) => e.tipo === 'ENTREGABLE' && /aprobado/.test(e.titulo || '')).length;
  return { desde, eventos_sala: eventos.length, tareas_completadas: tareasCompletadas, tareas_bloqueadas: tareasBloqueadas, entregables_aprobados: entregablesAprobados };
}

// v13 (Fase 1, "ruta crítica"): CPM clasico sobre la red de dependencias.
function calcularRutaCritica_(tareas) {
  function dur(t) {
    if (!t || !t.fecha_creacion || !t.fecha_compromiso) return 1;
    const d = (new Date(t.fecha_compromiso) - new Date(t.fecha_creacion)) / 86400000;
    return d > 1 ? d : 1;
  }
  const vivas = (tareas || []).filter((t) => t.estado !== 'CANCELADA');
  const porId = {};
  vivas.forEach((t) => { porId[t.actividad_id] = t; });
  const sucesores = {}, tienePred = {};
  let hayDependencias = false;
  vivas.forEach((t) => {
    if (t.depende_de && porId[t.depende_de]) {
      (sucesores[t.depende_de] = sucesores[t.depende_de] || []).push(t.actividad_id);
      tienePred[t.actividad_id] = true;
      hayDependencias = true;
    }
  });
  if (!hayDependencias) return { disponible: false, porTarea: {} };

  const EF = {}, ES = {};
  function calcEF(id, pila) {
    if (EF[id] !== undefined) return EF[id];
    pila = pila || {};
    if (pila[id]) return (EF[id] = dur(porId[id]));
    pila[id] = true;
    const t = porId[id];
    const es = (t.depende_de && porId[t.depende_de]) ? calcEF(t.depende_de, pila) : 0;
    ES[id] = es; EF[id] = es + dur(t);
    delete pila[id];
    return EF[id];
  }
  vivas.forEach((t) => calcEF(t.actividad_id));

  let finProyecto = 0;
  vivas.forEach((t) => {
    if ((tienePred[t.actividad_id] || sucesores[t.actividad_id]) && EF[t.actividad_id] > finProyecto) finProyecto = EF[t.actividad_id];
  });

  const LF = {}, LS = {};
  function calcLF(id, pila) {
    if (LF[id] !== undefined) return LF[id];
    pila = pila || {};
    if (pila[id]) return (LF[id] = finProyecto);
    pila[id] = true;
    const succ = sucesores[id] || [];
    let lf = finProyecto;
    if (succ.length) {
      lf = Infinity;
      succ.forEach((sid) => { const ls = calcLF(sid, pila) - dur(porId[sid]); if (ls < lf) lf = ls; });
    }
    LF[id] = lf; LS[id] = lf - dur(porId[id]);
    delete pila[id];
    return LF[id];
  }
  vivas.forEach((t) => calcLF(t.actividad_id));

  const porTarea = {};
  vivas.forEach((t) => {
    const id = t.actividad_id;
    if (!(tienePred[id] || sucesores[id])) { porTarea[id] = { en_red: false, es_critica: false, holgura_dias: null }; return; }
    const holgura = Math.round((LS[id] - ES[id]) * 10) / 10;
    porTarea[id] = { en_red: true, es_critica: holgura <= 0.5 && !esTareaTerminalProyecto_(t), holgura_dias: holgura };
  });
  return { disponible: true, porTarea };
}
function esTareaTerminalProyecto_(a) { return !!a && (a.estado === 'TERMINADA' || a.estado === 'CANCELADA'); }
function avanceRealTarea_(a) {
  if (a.avance_pct !== undefined && a.avance_pct !== null && a.avance_pct !== '') return Number(a.avance_pct);
  if (a.estado === 'TERMINADA') return 100;
  if (a.estado === 'NO_INICIADA') return 0;
  return null;
}
function calcularImpactoDependencia_(actividadId, dependientesDirectosPorId) {
  const vistos = {};
  const cola = (dependientesDirectosPorId[actividadId] || []).slice();
  cola.forEach((a) => { vistos[a.actividad_id] = true; });
  const resultado = [];
  while (cola.length) {
    const actual = cola.shift();
    resultado.push(actual);
    (dependientesDirectosPorId[actual.actividad_id] || []).forEach((siguiente) => {
      if (!vistos[siguiente.actividad_id]) { vistos[siguiente.actividad_id] = true; cola.push(siguiente); }
    });
  }
  return resultado;
}

function filaBitacoraSalida_(b) {
  let d = {};
  if (b.datos) { try { const p = JSON.parse(b.datos); if (p && typeof p === 'object') d = p; } catch (e) { /* dato viejo o corrupto */ } }
  const salida = {
    actividad_id: b.actividad_id, tipo: b.tipo, nota: b.nota,
    horas: (d.horas !== undefined) ? d.horas : undefined,
    timestamp: b.timestamp, autor_nombre: b.autor_nombre || b.autor_email, autor_email: b.autor_email
  };
  if (b.tipo === 'REGISTRO_DIA') {
    salida.dia = d.dia || ''; salida.estado_dia = d.estado_dia || ''; salida.bloqueo_motivo = d.bloqueo_motivo || '';
    salida.tramos = Array.isArray(d.tramos) ? d.tramos : [];
    salida.editado_por = d.editado_por || ''; salida.editado_en = d.editado_en || '';
    salida.ediciones = Array.isArray(d.ediciones) ? d.ediciones.length : 0;
  }
  if (b.tipo === 'REPROGRAMACION') { salida.fecha_anterior = d.fecha_anterior || ''; salida.fecha_nueva = d.fecha_nueva || ''; }
  if (b.tipo === 'REASIGNACION') { salida.responsable_anterior = d.responsable_anterior || ''; salida.responsable_nuevo = d.responsable_nuevo || ''; }
  return salida;
}
function buscarReunionProyecto_(db, reunionId) { return leerSeguro_(db, 'PROYECTO_REUNIONES').find((r) => r.reunion_id === reunionId) || null; }
function buscarDecisionProyecto_(db, decisionId) { return leerSeguro_(db, 'PROYECTO_DECISIONES').find((d) => d.decision_id === decisionId) || null; }

// ===========================================================================
// API publica
// ===========================================================================

function listar(db, filtros, contexto) {
  const todos = leerSeguro_(db, 'PROYECTOS').filter((p) => esVerdadero_(p.activa));
  const vePropios = contexto.rol !== 'ADM' && contexto.rol !== 'GERENCIA';
  const misProyectos = vePropios ? proyectosDelUsuario_(db, contexto.email) : null;
  let visibles = todos.filter((p) => !vePropios || misProyectos.indexOf(p.proyecto_id) !== -1);
  if (filtros && filtros.estado) visibles = visibles.filter((p) => p.estado === filtros.estado);
  if (filtros && filtros.area_id) visibles = visibles.filter((p) => p.area_id === filtros.area_id);

  const todasActividades = leerSeguro_(db, 'ACTIVIDADES');
  const todosIntegrantes = leerSeguro_(db, 'PROYECTO_INTEGRANTES');
  const todosHitos = leerSeguro_(db, 'PROYECTO_HITOS');
  const todosEntregables = leerSeguro_(db, 'PROYECTO_ENTREGABLES');

  return visibles.map((p) => {
    const tareas = todasActividades.filter((a) => a.proyecto_id === p.proyecto_id);
    const hitos = todosHitos.filter((h) => h.proyecto_id === p.proyecto_id);
    const entregables = todosEntregables.filter((e) => e.proyecto_id === p.proyecto_id);
    const integrantes = todosIntegrantes.filter((i) => i.proyecto_id === p.proyecto_id && esVerdadero_(i.activo));
    const salud = calcularSaludProyecto_(db, p, tareas, hitos, entregables);
    return {
      proyecto_id: p.proyecto_id, codigo: p.codigo, nombre: p.nombre, descripcion: p.descripcion,
      lider_email: p.lider_email, estado: p.estado, prioridad: p.prioridad,
      fecha_inicio: p.fecha_inicio, fecha_objetivo: p.fecha_objetivo, ultima_actualizacion: p.ultima_actualizacion,
      avance_pct: calcularAvanceProyecto_(tareas),
      cumplimiento_tareas: calcularCumplimientoTareasProyecto_(tareas),
      total_integrantes: integrantes.length,
      integrantes: integrantes.slice()
        .sort((a, b) => (a.rol_proyecto === 'LIDER' ? -1 : 0) - (b.rol_proyecto === 'LIDER' ? -1 : 0))
        .map((i) => ({ email: i.usuario_email, nombre: i.usuario_nombre || i.usuario_email })),
      total_tareas: tareas.filter((a) => esVerdadero_(a.activa)).length,
      salud: salud.codigo, salud_etiqueta: salud.etiqueta, salud_motivos: salud.motivos,
      salud_score: salud.score, salud_penalizacion: salud.penalizacion
    };
  }).sort((a, b) => {
    const orden = { critico: 0, riesgo: 1, normal: 2 };
    const porSalud = orden[a.salud] - orden[b.salud];
    if (porSalud !== 0) return porSalud;
    return new Date(b.ultima_actualizacion || 0) - new Date(a.ultima_actualizacion || 0);
  });
}

function listarMisTareas(db, data, contexto) {
  const email = normalizarEmail_(contexto.email);
  const misProyectos = {};
  proyectosDelUsuario_(db, contexto.email).forEach((id) => { misProyectos[id] = true; });
  const esAdmGerencia = contexto.rol === 'ADM' || contexto.rol === 'GERENCIA';
  const proyectosPorId = {};
  leerSeguro_(db, 'PROYECTOS').forEach((p) => { proyectosPorId[p.proyecto_id] = p; });

  function esMiaYVisible(proyectoId, responsableEmail) {
    if (normalizarEmail_(responsableEmail) !== email) return false;
    return esAdmGerencia || misProyectos[proyectoId];
  }
  function esMiaOColaboroYVisible(a) {
    if (!(esAdmGerencia || misProyectos[a.proyecto_id])) return false;
    return Actividades.trabajaLaActividad_(a, email);
  }

  const tareas = leerSeguro_(db, 'ACTIVIDADES').filter((a) => esVerdadero_(a.activa) && a.proyecto_id && esMiaOColaboroYVisible(a))
    .map((a) => {
      const s = Actividades.semaforoActividad_(a);
      const proyecto = proyectosPorId[a.proyecto_id];
      return {
        actividad_id: a.actividad_id, titulo: a.titulo, estado: a.estado,
        prioridad: a.prioridad, fecha_compromiso: a.fecha_compromiso,
        avance_pct: a.avance_pct, bloqueo_motivo: a.bloqueo_motivo,
        fecha_propuesta: a.fecha_propuesta, confirmada_en: a.confirmada_en,
        semaforo: s.codigo, semaforo_etiqueta: s.etiqueta,
        proyecto_id: a.proyecto_id, proyecto_nombre: proyecto ? proyecto.nombre : '(proyecto eliminado)',
        meta_cantidad: a.meta_cantidad, meta_unidad: a.meta_unidad,
        soy_responsable: normalizarEmail_(a.responsable_email) === email
      };
    }).sort((a, b) => {
      const orden = { atrasada: 0, riesgo: 1, pendiente: 2, bloqueada: 3, 'al-dia': 4, revision: 5, terminada: 6, cancelada: 7 };
      const oa = orden[a.semaforo] === undefined ? 9 : orden[a.semaforo];
      const ob = orden[b.semaforo] === undefined ? 9 : orden[b.semaforo];
      if (oa !== ob) return oa - ob;
      return new Date(a.fecha_compromiso || '9999-12-31') - new Date(b.fecha_compromiso || '9999-12-31');
    });

  const entregables = leerSeguro_(db, 'PROYECTO_ENTREGABLES')
    .filter((e) => e.estado !== 'APROBADO' && e.estado !== 'CANCELADO' && esMiaYVisible(e.proyecto_id, e.responsable_email))
    .map((e) => {
      const proyecto = proyectosPorId[e.proyecto_id];
      return {
        entregable_id: e.entregable_id, nombre: e.nombre, estado: e.estado, fecha_comprometida: e.fecha_comprometida,
        proyecto_id: e.proyecto_id, proyecto_nombre: proyecto ? proyecto.nombre : '(proyecto eliminado)'
      };
    }).sort((a, b) => new Date(a.fecha_comprometida || '9999-12-31') - new Date(b.fecha_comprometida || '9999-12-31'));

  return { tareas, entregables };
}

function listarCalendario(db, data, contexto) {
  const proyectosActivos = leerSeguro_(db, 'PROYECTOS').filter((p) => esVerdadero_(p.activa));
  const vePropios = contexto.rol !== 'ADM' && contexto.rol !== 'GERENCIA';
  const misProyectos = vePropios ? proyectosDelUsuario_(db, contexto.email) : null;
  const visibles = proyectosActivos.filter((p) => !vePropios || misProyectos.indexOf(p.proyecto_id) !== -1);
  const proyectosPorId = {};
  visibles.forEach((p) => { proyectosPorId[p.proyecto_id] = p; });

  const items = [];
  leerSeguro_(db, 'ACTIVIDADES').forEach((a) => {
    if (!esVerdadero_(a.activa) || !a.fecha_compromiso || !proyectosPorId[a.proyecto_id]) return;
    const s = Actividades.semaforoActividad_(a);
    items.push({
      tipo: 'tarea', fecha: a.fecha_compromiso, titulo: a.titulo, responsable_email: a.responsable_email,
      semaforo: s.codigo, semaforo_etiqueta: s.etiqueta, proyecto_id: a.proyecto_id, proyecto_nombre: proyectosPorId[a.proyecto_id].nombre
    });
  });
  leerSeguro_(db, 'PROYECTO_HITOS').forEach((h) => {
    if (!h.fecha_objetivo || !proyectosPorId[h.proyecto_id]) return;
    items.push({ tipo: 'hito', fecha: h.fecha_objetivo, titulo: h.nombre, estado: h.estado, proyecto_id: h.proyecto_id, proyecto_nombre: proyectosPorId[h.proyecto_id].nombre });
  });
  leerSeguro_(db, 'PROYECTO_ENTREGABLES').forEach((e) => {
    if (!e.fecha_comprometida || e.estado === 'APROBADO' || e.estado === 'CANCELADO' || !proyectosPorId[e.proyecto_id]) return;
    items.push({ tipo: 'entregable', fecha: e.fecha_comprometida, titulo: e.nombre, estado: e.estado, responsable_email: e.responsable_email, proyecto_id: e.proyecto_id, proyecto_nombre: proyectosPorId[e.proyecto_id].nombre });
  });

  return {
    items: items.sort((a, b) => new Date(a.fecha) - new Date(b.fecha)),
    proyectos: visibles.map((p) => ({ proyecto_id: p.proyecto_id, nombre: p.nombre }))
  };
}

function getDetalle(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeVerProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
  const tareas = leerSeguro_(db, 'ACTIVIDADES').filter((a) => a.proyecto_id === proyecto.proyecto_id);
  const hitos = leerSeguro_(db, 'PROYECTO_HITOS').filter((h) => h.proyecto_id === proyecto.proyecto_id)
    .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
  const integrantes = leerSeguro_(db, 'PROYECTO_INTEGRANTES').filter((i) => i.proyecto_id === proyecto.proyecto_id && esVerdadero_(i.activo));
  const entregables = leerSeguro_(db, 'PROYECTO_ENTREGABLES').filter((e) => e.proyecto_id === proyecto.proyecto_id);
  const riesgos = leerSeguro_(db, 'PROYECTO_RIESGOS').filter((r) => r.proyecto_id === proyecto.proyecto_id);
  const documentos = leerSeguro_(db, 'PROYECTO_DOCUMENTOS')
    .filter((d) => d.proyecto_id === proyecto.proyecto_id && esVerdadero_(d.activo))
    .sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));
  const salud = calcularSaludProyecto_(db, proyecto, tareas, hitos, entregables);

  return {
    proyecto: proyecto,
    rol_actual: rolEnProyecto_(db, proyecto.proyecto_id, contexto),
    puede_gestionar: puedeGestionarProyecto_(db, proyecto, contexto),
    integrantes, documentos,
    hitos: hitos.map((h) => {
      const tareasHito = tareas.filter((a) => a.hito_id === h.hito_id);
      return { hito_id: h.hito_id, nombre: h.nombre, descripcion: h.descripcion, fecha_objetivo: h.fecha_objetivo, estado: h.estado, orden: h.orden, total_tareas: tareasHito.length, avance_pct: calcularAvanceProyecto_(tareasHito) };
    }),
    entregables, riesgos,
    avance_pct: calcularAvanceProyecto_(tareas),
    cumplimiento_tareas: calcularCumplimientoTareasProyecto_(tareas),
    salud: salud.codigo, salud_etiqueta: salud.etiqueta, salud_motivos: salud.motivos,
    salud_score: salud.score, salud_penalizacion: salud.penalizacion, salud_desglose: salud.desglose,
    requiere_atencion: calcularRequiereAtencion_(tareas, hitos, integrantes, riesgos),
    avance_esperado_pct: calcularAvanceEsperado_(proyecto.fecha_inicio, proyecto.fecha_objetivo, new Date()),
    resumen_desde_ultima_visita: calcularResumenVisitaProyecto_(db, proyecto, contexto, integrantes, tareas),
    feriados: obtenerFeriados_(db)
  };
}

function getDetalleCompleto(db, data, contexto) {
  const detalle = getDetalle(db, data, contexto);
  if (detalle && (detalle._forbidden || detalle._validationError)) return detalle;
  return { detalle, tareas: listarTareas(db, data, contexto), sala: listarSala(db, data, contexto) };
}

function marcarSalaVisitada(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data && data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  const integrante = leerSeguro_(db, 'PROYECTO_INTEGRANTES').find((i) =>
    i.proyecto_id === proyecto.proyecto_id && normalizarEmail_(i.usuario_email) === normalizarEmail_(contexto.email) && esVerdadero_(i.activo));
  if (!integrante) return { actualizado: false };
  actualizarFilaPorId_(db, 'PROYECTO_INTEGRANTES', 'integrante_id', integrante.integrante_id, { ultima_visita_sala: new Date().toISOString() });
  return { actualizado: true };
}

function crear(db, data, contexto) {
  const nombre = String(data.nombre || '').trim();
  if (!nombre) return errorValidacion_('nombre', 'El nombre es obligatorio.');
  const liderEmail = normalizarEmail_(data.lider_email || contexto.email);
  if (!liderEmail) return errorValidacion_('lider_email', 'Falta el líder del proyecto.');
  if (!data.fecha_inicio) return errorValidacion_('fecha_inicio', 'La fecha de inicio es obligatoria.');
  if (!data.fecha_objetivo) return errorValidacion_('fecha_objetivo', 'La fecha objetivo es obligatoria.');
  const errFechas = errorFechasProyecto_(data.fecha_inicio, data.fecha_objetivo);
  if (errFechas) return errFechas;

  let solicitudOrigen = null;
  if (data.solicitud_id) {
    solicitudOrigen = leerSeguro_(db, 'SOLICITUDES').find((s) => s.solicitud_id === data.solicitud_id) || null;
    if (!solicitudOrigen) return errorValidacion_('solicitud_id', 'La solicitud de origen no existe.');
    if (solicitudOrigen.proyecto_id) return errorValidacion_('solicitud_id', 'Esa solicitud ya se convirtió en el proyecto ' + solicitudOrigen.proyecto_id + '.');
  }

  const ahora = new Date();
  const proyecto = {
    proyecto_id: uuid_(), codigo: String(data.codigo || '').trim(), nombre, descripcion: data.descripcion || '',
    objetivo: data.objetivo || '', resultado_esperado: data.resultado_esperado || '', lider_email: liderEmail,
    area_id: data.area_id || '', cliente_id: data.cliente_id || '', categoria: data.categoria || '',
    prioridad: ORDEN_PRIORIDAD.indexOf(data.prioridad) !== -1 ? data.prioridad : PRIORIDAD_POR_DEFECTO,
    estado: PROYECTOS_ESTADOS.PLANIFICACION, fecha_inicio: data.fecha_inicio, fecha_objetivo: data.fecha_objetivo,
    fecha_cierre_real: '', salud_override: '', salud_override_motivo: '', ultima_actualizacion: ahora.toISOString(),
    creado_por: contexto.email || '', fecha_creacion: ahora.toISOString(), activa: true,
    solicitud_origen_id: data.solicitud_id || ''
  };
  agregarFila_(db, 'PROYECTOS', proyecto);

  agregarIntegrante_(db, proyecto.proyecto_id, liderEmail, data.lider_nombre || '', 'LIDER', '', contexto);
  if (normalizarEmail_(contexto.email) !== liderEmail) {
    agregarIntegrante_(db, proyecto.proyecto_id, contexto.email, contexto.nombre || '', 'INTEGRANTE', 'Creador del proyecto', contexto);
  }
  if (solicitudOrigen) {
    actualizarFilaPorId_(db, 'SOLICITUDES', 'solicitud_id', solicitudOrigen.solicitud_id, { proyecto_id: proyecto.proyecto_id });
    registrarEventoProyecto_(db, proyecto.proyecto_id, 'ACTUALIZACION', contexto,
      'Proyecto creado a partir de la solicitud ' + solicitudOrigen.solicitud_id +
        (solicitudOrigen.solicitante_nombre ? ' (solicitante: ' + solicitudOrigen.solicitante_nombre + ')' : ''), '', '', '');
  }
  if (data.plantilla_id) {
    const plantillaUsada = buscarPlantilla_(db, data.plantilla_id);
    if (plantillaUsada) {
      leerSeguro_(db, 'PROYECTO_PLANTILLA_HITOS')
        .filter((h) => h.plantilla_id === plantillaUsada.plantilla_id)
        .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0))
        .forEach((h, indice) => {
          agregarFila_(db, 'PROYECTO_HITOS', { hito_id: uuid_(), proyecto_id: proyecto.proyecto_id, nombre: h.nombre, descripcion: h.descripcion || '', fecha_objetivo: '', estado: 'PENDIENTE', orden: indice, fecha_creacion: ahora.toISOString() });
        });
      registrarEventoProyecto_(db, proyecto.proyecto_id, 'ACTUALIZACION', contexto, 'Proyecto creado desde la plantilla "' + plantillaUsada.nombre + '"', '', '', '');
    }
  }
  registrarEventoProyecto_(db, proyecto.proyecto_id, 'ACTUALIZACION', contexto, 'Proyecto creado', '', '', '');
  return proyecto;
}

function guardarComoPlantilla(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeGestionarProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'Solo el líder del proyecto o un administrador pueden guardarlo como plantilla.' };
  const nombre = String(data.nombre || '').trim();
  if (!nombre) return errorValidacion_('nombre', 'El nombre de la plantilla es obligatorio.');

  const plantilla = { plantilla_id: uuid_(), nombre, descripcion: data.descripcion || '', creado_por: contexto.email || '', fecha_creacion: new Date().toISOString(), activa: true };
  agregarFila_(db, 'PROYECTO_PLANTILLAS', plantilla);

  const hitos = leerSeguro_(db, 'PROYECTO_HITOS').filter((h) => h.proyecto_id === proyecto.proyecto_id).sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
  hitos.forEach((h, indice) => {
    agregarFila_(db, 'PROYECTO_PLANTILLA_HITOS', { plantilla_hito_id: uuid_(), plantilla_id: plantilla.plantilla_id, nombre: h.nombre, descripcion: h.descripcion || '', orden: indice });
  });
  plantilla.total_hitos = hitos.length;
  return plantilla;
}

function listarPlantillas(db) {
  const hitosPorPlantilla = {};
  leerSeguro_(db, 'PROYECTO_PLANTILLA_HITOS').forEach((h) => { hitosPorPlantilla[h.plantilla_id] = (hitosPorPlantilla[h.plantilla_id] || 0) + 1; });
  return leerSeguro_(db, 'PROYECTO_PLANTILLAS').filter((p) => esVerdadero_(p.activa))
    .map((p) => ({ plantilla_id: p.plantilla_id, nombre: p.nombre, descripcion: p.descripcion, total_hitos: hitosPorPlantilla[p.plantilla_id] || 0 }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function actualizar(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeGestionarProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'Solo el líder del proyecto o un administrador pueden editarlo.' };
  const camposEditables = ['nombre', 'descripcion', 'objetivo', 'resultado_esperado', 'area_id', 'cliente_id', 'categoria', 'fecha_inicio', 'fecha_objetivo', 'codigo'];
  const cambios = { ultima_actualizacion: new Date().toISOString() };
  camposEditables.forEach((campo) => { if (data[campo] !== undefined) cambios[campo] = data[campo]; });
  if (data.prioridad && ORDEN_PRIORIDAD.indexOf(data.prioridad) !== -1) cambios.prioridad = data.prioridad;

  const errFechasAct = errorFechasProyecto_(
    data.fecha_inicio !== undefined ? data.fecha_inicio : proyecto.fecha_inicio,
    data.fecha_objetivo !== undefined ? data.fecha_objetivo : proyecto.fecha_objetivo
  );
  if (errFechasAct) return errFechasAct;

  let notaEstado = '';
  if (data.estado && data.estado !== proyecto.estado) {
    if (Object.keys(PROYECTOS_ESTADOS).indexOf(data.estado) === -1) return errorValidacion_('estado', 'Estado de proyecto inválido.');
    if (data.estado === PROYECTOS_ESTADOS.CERRADO) {
      if (!String(data.motivo || '').trim()) return errorValidacion_('motivo', 'Cerrar un proyecto exige un resumen de cierre.');
      cambios.fecha_cierre_real = new Date().toISOString();
    }
    cambios.estado = data.estado;
    notaEstado = 'Estado: ' + proyecto.estado + ' → ' + data.estado + (data.motivo ? '. ' + data.motivo : '');
  }

  if (data.salud_override !== undefined) {
    if (data.salud_override && !String(data.motivo_salud || '').trim()) return errorValidacion_('motivo_salud', 'Fijar la salud manualmente exige un motivo.');
    cambios.salud_override = data.salud_override || '';
    cambios.salud_override_motivo = data.salud_override ? data.motivo_salud : '';
  }

  const actualizado = actualizarFilaPorId_(db, 'PROYECTOS', 'proyecto_id', proyecto.proyecto_id, cambios);
  if (notaEstado) registrarEventoProyecto_(db, proyecto.proyecto_id, 'CAMBIO_ESTADO', contexto, notaEstado, '', '', '');
  return actualizado;
}

function gestionarIntegrante(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeGestionarProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'Solo el líder del proyecto o un administrador pueden gestionar el equipo.' };

  if (data.accion === 'quitar') {
    if (!data.integrante_id) return errorValidacion_('integrante_id', 'Falta indicar el integrante.');
    const fila = buscarIntegranteProyecto_(db, data.integrante_id);
    if (fila && fila.rol_proyecto === 'LIDER') {
      const lideresActivos = leerSeguro_(db, 'PROYECTO_INTEGRANTES').filter((i) => i.proyecto_id === proyecto.proyecto_id && i.rol_proyecto === 'LIDER' && esVerdadero_(i.activo));
      if (lideresActivos.length <= 1) return errorValidacion_('integrante_id', 'El proyecto necesita al menos un líder.');
    }
    const quitado = actualizarFilaPorId_(db, 'PROYECTO_INTEGRANTES', 'integrante_id', data.integrante_id, { activo: false });
    registrarEventoProyecto_(db, proyecto.proyecto_id, 'ACTUALIZACION', contexto, 'Se quitó del equipo a ' + (fila ? (fila.usuario_nombre || fila.usuario_email) : ''), '', '', '');
    return quitado;
  }

  const email = normalizarEmail_(data.usuario_email);
  if (!email) return errorValidacion_('usuario_email', 'Falta el correo del integrante.');
  const rol = ['LIDER', 'INTEGRANTE', 'COLABORADOR', 'OBSERVADOR'].indexOf(data.rol_proyecto) !== -1 ? data.rol_proyecto : 'INTEGRANTE';
  const existente = leerSeguro_(db, 'PROYECTO_INTEGRANTES').find((i) => i.proyecto_id === proyecto.proyecto_id && normalizarEmail_(i.usuario_email) === email);
  let resultado;
  if (existente) {
    resultado = actualizarFilaPorId_(db, 'PROYECTO_INTEGRANTES', 'integrante_id', existente.integrante_id, { rol_proyecto: rol, responsabilidad: data.responsabilidad || existente.responsabilidad || '', activo: true });
  } else {
    resultado = agregarIntegrante_(db, proyecto.proyecto_id, email, data.usuario_nombre || '', rol, data.responsabilidad || '', contexto);
  }
  registrarEventoProyecto_(db, proyecto.proyecto_id, 'ACTUALIZACION', contexto, (data.usuario_nombre || email) + ' se une al equipo como ' + rol, '', '', '');
  NotificacionesApp.encolarLote(db, [{ destinatario: email, tipo: 'PROYECTO_INTEGRANTE', titulo: 'Te agregaron a un proyecto', mensaje: 'Ahora participas en "' + proyecto.nombre + '" como ' + rol + '.', modulo_id: 'proyectos', texto_accion: 'Ver proyecto', vidaHoras: 72 }]);
  return resultado;
}

function gestionarHito(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeGestionarProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'Solo el líder del proyecto o un administrador pueden gestionar hitos.' };

  if (data.accion === 'eliminar') {
    if (!data.hito_id) return errorValidacion_('hito_id', 'Falta indicar el hito.');
    const tareasDelHito = leerSeguro_(db, 'ACTIVIDADES').filter((a) => a.hito_id === data.hito_id);
    if (tareasDelHito.length > 0) return errorValidacion_('hito_id', 'Este hito tiene tareas asociadas; muévelas antes de eliminarlo.');
    return eliminarFilaHito_(db, data.hito_id);
  }
  if (data.hito_id) {
    const cambios = {};
    ['nombre', 'descripcion', 'fecha_objetivo', 'estado', 'orden'].forEach((campo) => { if (data[campo] !== undefined) cambios[campo] = data[campo]; });
    return actualizarFilaPorId_(db, 'PROYECTO_HITOS', 'hito_id', data.hito_id, cambios);
  }
  const nombre = String(data.nombre || '').trim();
  if (!nombre) return errorValidacion_('nombre', 'El nombre del hito es obligatorio.');
  const totalHitos = leerSeguro_(db, 'PROYECTO_HITOS').filter((h) => h.proyecto_id === proyecto.proyecto_id).length;
  const hito = {
    hito_id: uuid_(), proyecto_id: proyecto.proyecto_id, nombre, descripcion: data.descripcion || '',
    fecha_objetivo: data.fecha_objetivo || '', estado: 'PENDIENTE', orden: data.orden !== undefined ? data.orden : totalHitos,
    fecha_creacion: new Date().toISOString()
  };
  agregarFila_(db, 'PROYECTO_HITOS', hito);
  return hito;
}

function crearTarea(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  const rol = rolEnProyecto_(db, proyecto.proyecto_id, contexto);
  if (!(contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR')) {
    return { _forbidden: true, message: 'No puedes crear tareas en este proyecto.' };
  }
  if (data.hito_id) {
    const hito = leerSeguro_(db, 'PROYECTO_HITOS').find((h) => h.hito_id === data.hito_id);
    if (!hito || hito.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('hito_id', 'El hito no pertenece a este proyecto.');
  }
  if (data.depende_de) {
    const dependencia = leerSeguro_(db, 'ACTIVIDADES').find((a) => a.actividad_id === data.depende_de);
    if (!dependencia || dependencia.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('depende_de', 'La tarea de la que depende debe ser del mismo proyecto.');
  }
  if (data.tarea_padre_id) {
    const padre = leerSeguro_(db, 'ACTIVIDADES').find((a) => a.actividad_id === data.tarea_padre_id);
    if (!padre || padre.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('tarea_padre_id', 'La tarea padre debe ser del mismo proyecto.');
    if (padre.tarea_padre_id) return errorValidacion_('tarea_padre_id', 'Esa tarea ya es una subtarea -- no se puede anidar un tercer nivel.');
  }
  const enriquecido = Object.assign({}, data);
  enriquecido.proyecto = proyecto.nombre;
  enriquecido.proyecto_id = proyecto.proyecto_id;
  if (data.colaboradores_emails) {
    const miembros = {};
    leerSeguro_(db, 'PROYECTO_INTEGRANTES').forEach((i) => { if (i.proyecto_id === proyecto.proyecto_id && esVerdadero_(i.activo)) miembros[normalizarEmail_(i.usuario_email)] = true; });
    let lista = data.colaboradores_emails;
    if (typeof lista === 'string') { try { lista = JSON.parse(lista); } catch (e) { lista = []; } }
    enriquecido.colaboradores_emails = (Array.isArray(lista) ? lista : []).filter((correo) => miembros[normalizarEmail_(correo)]);
  }
  enriquecido.hito_id = data.hito_id || '';
  if (!enriquecido.area_id) enriquecido.area_id = proyecto.area_id;
  if (!enriquecido.supervisor_email) enriquecido.supervisor_email = proyecto.lider_email;
  const tarea = Actividades.crear(db, enriquecido, contexto);
  if (tarea && (tarea._validationError || tarea._forbidden)) return tarea;
  registrarEventoProyecto_(db, proyecto.proyecto_id, 'ACTUALIZACION', contexto, 'Nueva tarea: ' + tarea.titulo, 'ACTIVIDAD', tarea.actividad_id, '');
  return tarea;
}

function editarTarea(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!data.actividad_id) return errorValidacion_('actividad_id', 'Falta indicar la tarea.');
  const actividad = leerSeguro_(db, 'ACTIVIDADES').find((a) => a.actividad_id === data.actividad_id && a.proyecto_id === proyecto.proyecto_id);
  if (!actividad) return errorValidacion_('actividad_id', 'Tarea no encontrada en este proyecto.');
  const esGestor = puedeGestionarProyecto_(db, proyecto, contexto);
  const esTrabajador = Actividades.trabajaLaActividad_(actividad, contexto.email);
  if (!esGestor && !esTrabajador) return { _forbidden: true, message: 'Solo el líder, un administrador, o quien trabaja la tarea pueden editarla.' };
  if (data.hito_id) {
    const hito = leerSeguro_(db, 'PROYECTO_HITOS').find((h) => h.hito_id === data.hito_id);
    if (!hito || hito.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('hito_id', 'El hito no pertenece a este proyecto.');
  }
  if (data.depende_de) {
    const dependencia = leerSeguro_(db, 'ACTIVIDADES').find((a) => a.actividad_id === data.depende_de);
    if (!dependencia || dependencia.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('depende_de', 'La tarea de la que depende debe ser del mismo proyecto.');
  }
  if (data.tarea_padre_id) {
    const padre = leerSeguro_(db, 'ACTIVIDADES').find((a) => a.actividad_id === data.tarea_padre_id);
    if (!padre || padre.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('tarea_padre_id', 'La tarea padre debe ser del mismo proyecto.');
    if (padre.tarea_padre_id) return errorValidacion_('tarea_padre_id', 'Esa tarea ya es una subtarea -- no se puede anidar un tercer nivel.');
    if (data.tarea_padre_id === data.actividad_id) return errorValidacion_('tarea_padre_id', 'Una tarea no puede ser padre de sí misma.');
  }
  const cambios = {};
  const camposPermitidos = ['titulo', 'descripcion', 'responsable_email', 'fecha_compromiso', 'prioridad', 'hito_id', 'depende_de', 'tarea_padre_id', 'meta_cantidad', 'meta_unidad'];
  camposPermitidos.forEach((campo) => { if (data[campo] !== undefined) cambios[campo] = data[campo]; });
  if (data.colaboradores_emails !== undefined) {
    const miembros = {};
    leerSeguro_(db, 'PROYECTO_INTEGRANTES').forEach((i) => { if (i.proyecto_id === proyecto.proyecto_id && esVerdadero_(i.activo)) miembros[normalizarEmail_(i.usuario_email)] = true; });
    let lista = data.colaboradores_emails;
    if (typeof lista === 'string') { try { lista = JSON.parse(lista); } catch (e) { lista = []; } }
    const responsable = normalizarEmail_(data.responsable_email || actividad.responsable_email);
    cambios.colaboradores_emails = JSON.stringify((Array.isArray(lista) ? lista : []).filter((correo) => miembros[normalizarEmail_(correo)] && normalizarEmail_(correo) !== responsable));
  }
  if (data.responsable_email && data.responsable_email !== actividad.responsable_email) {
    const nuevoResp = leerSeguro_(db, 'PROYECTO_INTEGRANTES').find((i) => i.proyecto_id === proyecto.proyecto_id && normalizarEmail_(i.usuario_email) === normalizarEmail_(data.responsable_email));
    if (nuevoResp) cambios.responsable_nombre = nuevoResp.usuario_nombre || '';
  }
  cambios.ultima_actualizacion = new Date().toISOString();
  const actualizado = actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', actividad.actividad_id, cambios);
  registrarEventoProyecto_(db, proyecto.proyecto_id, 'ACTUALIZACION', contexto, 'Tarea editada: ' + (cambios.titulo || actividad.titulo), 'ACTIVIDAD', actividad.actividad_id, '');
  return actualizado;
}

function listarTareas(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeVerProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
  const tareas = leerSeguro_(db, 'ACTIVIDADES').filter((a) => esVerdadero_(a.activa) && a.proyecto_id === proyecto.proyecto_id);
  const porId = {};
  tareas.forEach((a) => { porId[a.actividad_id] = a; });
  const nombrePorEmail = {};
  leerSeguro_(db, 'PROYECTO_INTEGRANTES').forEach((i) => { if (i.proyecto_id === proyecto.proyecto_id) nombrePorEmail[normalizarEmail_(i.usuario_email)] = i.usuario_nombre || i.usuario_email; });
  const dependientesDirectosPorId = {};
  tareas.forEach((a) => { if (!a.depende_de || esTareaTerminalProyecto_(a)) return; (dependientesDirectosPorId[a.depende_de] = dependientesDirectosPorId[a.depende_de] || []).push(a); });
  const hijasPorPadre = {};
  tareas.forEach((a) => { if (a.tarea_padre_id) (hijasPorPadre[a.tarea_padre_id] = hijasPorPadre[a.tarea_padre_id] || []).push(a); });
  const rutaCritica = calcularRutaCritica_(tareas);

  return tareas.map((a) => {
    a.semaforo = Actividades.semaforoActividad_(a).codigo;
    a.semaforo_etiqueta = Actividades.semaforoActividad_(a).etiqueta;
    if (a.depende_de) {
      const dependencia = porId[a.depende_de];
      a.dependencia_titulo = dependencia ? dependencia.titulo : '';
      a.dependencia_comprometida = !!dependencia && Actividades.semaforoActividad_(dependencia).codigo === 'atrasada';
    }
    const dependientes = calcularImpactoDependencia_(a.actividad_id, dependientesDirectosPorId);
    a.impacto_dependientes = dependientes.length;
    a.impacto_titulos = dependientes.slice(0, 3).map((d) => d.titulo);
    const rc = rutaCritica.porTarea[a.actividad_id];
    a.es_critica = !!(rc && rc.es_critica);
    a.holgura_dias = rc ? rc.holgura_dias : null;
    a.colaboradores = Actividades.colaboradoresDeActividad_(a).map((email) => ({ email, nombre: nombrePorEmail[email] || email }));
    const hijas = hijasPorPadre[a.actividad_id] || [];
    if (hijas.length) {
      a.subtareas_total = hijas.length;
      a.subtareas_terminadas = hijas.filter((h) => h.estado === 'TERMINADA').length;
      const suma = hijas.reduce((s, h) => s + (avanceRealTarea_(h) || 0), 0);
      a.avance_rollup_pct = Math.round((suma / hijas.length) * 10) / 10;
    }
    a.es_subtarea = !!a.tarea_padre_id;
    if (a.es_subtarea && porId[a.tarea_padre_id]) a.padre_titulo = porId[a.tarea_padre_id].titulo;
    return a;
  });
}

function listarBitacora(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data && data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeVerProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
  const idsTarea = {};
  leerSeguro_(db, 'ACTIVIDADES').forEach((a) => { if (a.proyecto_id === proyecto.proyecto_id) idsTarea[a.actividad_id] = true; });
  return leerSeguro_(db, 'ACTIVIDADES_BITACORA').filter((b) => idsTarea[b.actividad_id]).map(filaBitacoraSalida_).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function listarMiBitacora(db, data, contexto) {
  const email = normalizarEmail_(contexto.email);
  const misProyectos = {};
  proyectosDelUsuario_(db, contexto.email).forEach((id) => { misProyectos[id] = true; });
  const esAdmGerencia = contexto.rol === 'ADM' || contexto.rol === 'GERENCIA';
  const idsTarea = {};
  leerSeguro_(db, 'ACTIVIDADES').forEach((a) => {
    if (!esVerdadero_(a.activa) || !a.proyecto_id) return;
    if (!Actividades.trabajaLaActividad_(a, email)) return;
    if (!esAdmGerencia && !misProyectos[a.proyecto_id]) return;
    idsTarea[a.actividad_id] = true;
  });
  return leerSeguro_(db, 'ACTIVIDADES_BITACORA').filter((b) => idsTarea[b.actividad_id]).map(filaBitacoraSalida_).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function listarSala(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeVerProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
  return leerSeguro_(db, 'PROYECTO_EVENTOS').filter((e) => e.proyecto_id === proyecto.proyecto_id).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function publicarEnSala(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  const rol = rolEnProyecto_(db, proyecto.proyecto_id, contexto);
  if (!(contexto.rol === 'ADM' || (rol && rol !== 'OBSERVADOR'))) return { _forbidden: true, message: 'No puedes publicar en este proyecto.' };
  const tipo = ['ACTUALIZACION', 'COMENTARIO', 'DECISION', 'REUNION', 'BLOQUEO', 'SOLICITUD_LIDER'].indexOf(data.tipo) !== -1 ? data.tipo : 'COMENTARIO';
  if (tipo === 'SOLICITUD_LIDER' && rol !== 'LIDER' && contexto.rol !== 'ADM') return { _forbidden: true, message: 'Solo el líder puede publicar una solicitud.' };
  const cuerpo = String(data.cuerpo || '').trim();
  if (!cuerpo) return errorValidacion_('cuerpo', 'Escribe algo antes de publicar.');

  const evento = registrarEventoProyecto_(db, proyecto.proyecto_id, tipo, contexto, data.titulo || '', data.ref_tipo || '', data.ref_id || '', cuerpo, data.menciones);
  notificarSala_(db, proyecto, evento, contexto);
  return evento;
}

function convertirEventoEnTarea(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!data.titulo) return errorValidacion_('titulo', 'Falta el título de la tarea.');
  const tarea = crearTarea(db, {
    proyecto_id: proyecto.proyecto_id, hito_id: data.hito_id || '', titulo: data.titulo, descripcion: data.descripcion || '',
    responsable_email: data.responsable_email, responsable_nombre: data.responsable_nombre || '',
    fecha_compromiso: data.fecha_compromiso, prioridad: data.prioridad, origen: 'SOLICITUD'
  }, contexto);
  if (tarea && (tarea._validationError || tarea._forbidden)) return tarea;
  if (data.evento_id) actualizarFilaPorId_(db, 'PROYECTO_EVENTOS', 'evento_id', data.evento_id, { ref_tipo: 'ACTIVIDAD', ref_id: tarea.actividad_id });
  return tarea;
}

function gestionarReunion(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  const rol = rolEnProyecto_(db, proyecto.proyecto_id, contexto);
  if (!(contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR')) return { _forbidden: true, message: 'No puedes gestionar reuniones en este proyecto.' };

  if (data.accion === 'eliminar') {
    if (!data.reunion_id) return errorValidacion_('reunion_id', 'Falta indicar la reunión.');
    const paraEliminar = buscarReunionProyecto_(db, data.reunion_id);
    if (!paraEliminar || paraEliminar.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('reunion_id', 'Reunión no encontrada.');
    const acuerdosExistentes = leerSeguro_(db, 'PROYECTO_REUNION_ACUERDOS').filter((a) => a.reunion_id === data.reunion_id);
    if (acuerdosExistentes.some((a) => a.ref_id)) return errorValidacion_('reunion_id', 'Esta reunión tiene acuerdos ya convertidos en tarea; no se puede eliminar (perdería la trazabilidad).');
    eliminarFilasPorId_(db, 'PROYECTO_REUNION_ACUERDOS', 'reunion_id', data.reunion_id);
    eliminarFilasPorId_(db, 'PROYECTO_REUNIONES', 'reunion_id', data.reunion_id);
    return { ok: true };
  }

  const participantes = Array.isArray(data.participantes) ? data.participantes.filter(Boolean) : [];

  if (data.reunion_id) {
    const actual = buscarReunionProyecto_(db, data.reunion_id);
    if (!actual || actual.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('reunion_id', 'Reunión no encontrada.');
    const cambios = {};
    if (data.titulo !== undefined) {
      const tituloEdit = String(data.titulo || '').trim();
      if (!tituloEdit) return errorValidacion_('titulo', 'El título es obligatorio.');
      cambios.titulo = tituloEdit;
    }
    if (data.fecha !== undefined) cambios.fecha = data.fecha || '';
    if (data.objetivo !== undefined) cambios.objetivo = data.objetivo || '';
    if (data.minuta !== undefined) cambios.minuta = data.minuta || '';
    if (data.participantes !== undefined) cambios.participantes = JSON.stringify(participantes);
    return actualizarFilaPorId_(db, 'PROYECTO_REUNIONES', 'reunion_id', data.reunion_id, cambios);
  }

  const titulo = String(data.titulo || '').trim();
  if (!titulo) return errorValidacion_('titulo', 'El título de la reunión es obligatorio.');
  const reunionId = uuid_();
  const reunion = {
    reunion_id: reunionId, proyecto_id: proyecto.proyecto_id, titulo, fecha: data.fecha || new Date().toISOString(),
    participantes: JSON.stringify(participantes), objetivo: data.objetivo || '', minuta: data.minuta || '',
    creado_por: contexto.email || '', fecha_creacion: new Date().toISOString()
  };
  agregarFila_(db, 'PROYECTO_REUNIONES', reunion);
  const acuerdosIniciales = Array.isArray(data.acuerdos) ? data.acuerdos.filter((t) => String(t || '').trim()) : [];
  acuerdosIniciales.forEach((texto, i) => {
    agregarFila_(db, 'PROYECTO_REUNION_ACUERDOS', { acuerdo_id: uuid_(), reunion_id: reunionId, texto: String(texto).trim(), ref_tipo: '', ref_id: '', orden: i });
  });
  registrarEventoProyecto_(db, proyecto.proyecto_id, 'REUNION', contexto, 'Reunión: ' + titulo, 'REUNION', reunionId, data.objetivo || '');
  return buscarReunionProyecto_(db, reunionId);
}

function agregarAcuerdoReunion(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  const rol = rolEnProyecto_(db, proyecto.proyecto_id, contexto);
  if (!(contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR')) return { _forbidden: true, message: 'No puedes agregar acuerdos en este proyecto.' };
  const reunion = buscarReunionProyecto_(db, data.reunion_id);
  if (!reunion || reunion.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('reunion_id', 'Reunión no encontrada.');
  const texto = String(data.texto || '').trim();
  if (!texto) return errorValidacion_('texto', 'El acuerdo no puede estar vacío.');
  const totalActual = leerSeguro_(db, 'PROYECTO_REUNION_ACUERDOS').filter((a) => a.reunion_id === data.reunion_id).length;
  const acuerdo = { acuerdo_id: uuid_(), reunion_id: data.reunion_id, texto, ref_tipo: '', ref_id: '', orden: totalActual };
  agregarFila_(db, 'PROYECTO_REUNION_ACUERDOS', acuerdo);
  return acuerdo;
}

function eliminarAcuerdoReunion(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  const rol = rolEnProyecto_(db, proyecto.proyecto_id, contexto);
  if (!(contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR')) return { _forbidden: true, message: 'No puedes eliminar acuerdos en este proyecto.' };
  const acuerdo = leerSeguro_(db, 'PROYECTO_REUNION_ACUERDOS').find((a) => a.acuerdo_id === data.acuerdo_id);
  if (!acuerdo) return errorValidacion_('acuerdo_id', 'Acuerdo no encontrado.');
  const reunion = buscarReunionProyecto_(db, acuerdo.reunion_id);
  if (!reunion || reunion.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('acuerdo_id', 'Acuerdo no encontrado en este proyecto.');
  if (acuerdo.ref_id) return errorValidacion_('acuerdo_id', 'Este acuerdo ya se convirtió en tarea; no se puede eliminar.');
  eliminarFilasPorId_(db, 'PROYECTO_REUNION_ACUERDOS', 'acuerdo_id', data.acuerdo_id);
  return { ok: true };
}

function convertirAcuerdoEnTarea(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  const acuerdo = leerSeguro_(db, 'PROYECTO_REUNION_ACUERDOS').find((a) => a.acuerdo_id === data.acuerdo_id);
  if (!acuerdo) return errorValidacion_('acuerdo_id', 'Acuerdo no encontrado.');
  if (acuerdo.ref_id) return errorValidacion_('acuerdo_id', 'Este acuerdo ya se convirtió en tarea.');
  const reunion = buscarReunionProyecto_(db, acuerdo.reunion_id);
  if (!reunion || reunion.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('acuerdo_id', 'Acuerdo no encontrado en este proyecto.');
  if (!data.responsable_email) return errorValidacion_('responsable_email', 'Falta el responsable.');
  if (!data.fecha_compromiso) return errorValidacion_('fecha_compromiso', 'Falta la fecha comprometida.');
  const tarea = crearTarea(db, {
    proyecto_id: proyecto.proyecto_id, hito_id: data.hito_id || '', titulo: data.titulo || acuerdo.texto,
    descripcion: 'Acuerdo de la reunión "' + reunion.titulo + '": ' + acuerdo.texto,
    responsable_email: data.responsable_email, fecha_compromiso: data.fecha_compromiso, prioridad: data.prioridad
  }, contexto);
  if (tarea && (tarea._validationError || tarea._forbidden)) return tarea;
  actualizarFilaPorId_(db, 'PROYECTO_REUNION_ACUERDOS', 'acuerdo_id', data.acuerdo_id, { ref_tipo: 'ACTIVIDAD', ref_id: tarea.actividad_id });
  return tarea;
}

function listarReuniones(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeVerProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
  const acuerdosPorReunion = {};
  leerSeguro_(db, 'PROYECTO_REUNION_ACUERDOS').forEach((a) => { (acuerdosPorReunion[a.reunion_id] = acuerdosPorReunion[a.reunion_id] || []).push(a); });
  return leerSeguro_(db, 'PROYECTO_REUNIONES').filter((r) => r.proyecto_id === proyecto.proyecto_id)
    .map((r) => {
      let participantes = [];
      try { participantes = JSON.parse(r.participantes || '[]'); } catch (e) { participantes = []; }
      const acuerdos = (acuerdosPorReunion[r.reunion_id] || []).sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
      return { reunion_id: r.reunion_id, titulo: r.titulo, fecha: r.fecha, objetivo: r.objetivo, minuta: r.minuta, participantes, creado_por: r.creado_por, fecha_creacion: r.fecha_creacion, acuerdos };
    }).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

function gestionarDecision(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  const rol = rolEnProyecto_(db, proyecto.proyecto_id, contexto);
  if (!(contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR')) return { _forbidden: true, message: 'No puedes registrar decisiones en este proyecto.' };

  if (data.accion === 'eliminar') {
    if (!data.decision_id) return errorValidacion_('decision_id', 'Falta indicar la decisión.');
    const paraEliminar = buscarDecisionProyecto_(db, data.decision_id);
    if (!paraEliminar || paraEliminar.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('decision_id', 'Decisión no encontrada.');
    return actualizarFilaPorId_(db, 'PROYECTO_DECISIONES', 'decision_id', data.decision_id, { activo: false });
  }

  if (data.decision_id) {
    const actual = buscarDecisionProyecto_(db, data.decision_id);
    if (!actual || actual.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('decision_id', 'Decisión no encontrada.');
    const cambios = {};
    if (data.descripcion !== undefined) {
      const descripcionEdit = String(data.descripcion || '').trim();
      if (!descripcionEdit) return errorValidacion_('descripcion', 'La descripción de la decisión es obligatoria.');
      cambios.descripcion = descripcionEdit;
    }
    if (data.contexto !== undefined) cambios.contexto = data.contexto || '';
    if (data.impacto !== undefined) cambios.impacto = data.impacto || '';
    if (data.responsable_email !== undefined) cambios.responsable_email = normalizarEmail_(data.responsable_email) || proyecto.lider_email;
    if (data.fecha_decision !== undefined) cambios.fecha_decision = data.fecha_decision || '';
    return actualizarFilaPorId_(db, 'PROYECTO_DECISIONES', 'decision_id', data.decision_id, cambios);
  }

  const descripcion = String(data.descripcion || '').trim();
  if (!descripcion) return errorValidacion_('descripcion', 'La descripción de la decisión es obligatoria.');
  const decisionId = uuid_();
  const decision = {
    decision_id: decisionId, proyecto_id: proyecto.proyecto_id, descripcion,
    contexto: data.contexto || '', impacto: data.impacto || '',
    responsable_email: normalizarEmail_(data.responsable_email) || proyecto.lider_email,
    fecha_decision: data.fecha_decision || new Date().toISOString(),
    creado_por: contexto.email || '', fecha_creacion: new Date().toISOString(), activo: true
  };
  agregarFila_(db, 'PROYECTO_DECISIONES', decision);
  registrarEventoProyecto_(db, proyecto.proyecto_id, 'DECISION', contexto, 'Decisión: ' + descripcion, 'DECISION', decisionId, data.contexto || '');
  return buscarDecisionProyecto_(db, decisionId);
}

function listarDecisiones(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeVerProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
  return leerSeguro_(db, 'PROYECTO_DECISIONES').filter((d) => d.proyecto_id === proyecto.proyecto_id && esVerdadero_(d.activo)).sort((a, b) => new Date(b.fecha_decision) - new Date(a.fecha_decision));
}

function gestionarEntregable(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  const rol = rolEnProyecto_(db, proyecto.proyecto_id, contexto);
  const puedeGestionar = contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR';
  if (!puedeGestionar) return { _forbidden: true, message: 'No puedes gestionar entregables en este proyecto.' };

  if (data.accion === 'eliminar') {
    if (!data.entregable_id) return errorValidacion_('entregable_id', 'Falta indicar el entregable.');
    const paraEliminar = buscarEntregable_(db, data.entregable_id);
    if (paraEliminar && paraEliminar.estado !== 'PENDIENTE') return errorValidacion_('entregable_id', 'Solo se puede eliminar un entregable que aun no se ha marcado como entregado.');
    return actualizarFilaPorId_(db, 'PROYECTO_ENTREGABLES', 'entregable_id', data.entregable_id, { estado: 'CANCELADO' });
  }

  if (data.accion === 'marcarEntregado') {
    if (!data.entregable_id) return errorValidacion_('entregable_id', 'Falta indicar el entregable.');
    const entregable = buscarEntregable_(db, data.entregable_id);
    if (!entregable || entregable.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('entregable_id', 'Entregable no encontrado.');
    const esResponsable = normalizarEmail_(entregable.responsable_email) === normalizarEmail_(contexto.email);
    if (!esResponsable && contexto.rol !== 'ADM' && rol !== 'LIDER') return { _forbidden: true, message: 'Solo el responsable del entregable puede marcarlo como entregado.' };
    const marcado = actualizarFilaPorId_(db, 'PROYECTO_ENTREGABLES', 'entregable_id', data.entregable_id, {
      estado: 'ENTREGADO', url_evidencia: data.url_evidencia || entregable.url_evidencia || '', fecha_entrega_real: new Date().toISOString()
    });
    registrarEventoProyecto_(db, proyecto.proyecto_id, 'ENTREGABLE', contexto, 'Entregable "' + entregable.nombre + '" listo para revisión', 'ENTREGABLE', data.entregable_id, '');
    notificarLideresProyecto_(db, proyecto, contexto, 'Entregable listo para revisar', entregable.nombre + ' está listo para tu revisión.');
    return marcado;
  }

  if (data.entregable_id) {
    const cambios = {};
    ['nombre', 'descripcion', 'hito_id', 'responsable_email', 'fecha_comprometida'].forEach((campo) => { if (data[campo] !== undefined) cambios[campo] = data[campo]; });
    return actualizarFilaPorId_(db, 'PROYECTO_ENTREGABLES', 'entregable_id', data.entregable_id, cambios);
  }

  const nombre = String(data.nombre || '').trim();
  if (!nombre) return errorValidacion_('nombre', 'El nombre del entregable es obligatorio.');
  const responsable = normalizarEmail_(data.responsable_email);
  if (!responsable) return errorValidacion_('responsable_email', 'Falta el responsable del entregable.');
  if (!data.fecha_comprometida) return errorValidacion_('fecha_comprometida', 'La fecha comprometida es obligatoria.');
  const nuevo = {
    entregable_id: uuid_(), proyecto_id: proyecto.proyecto_id, hito_id: data.hito_id || '', nombre,
    descripcion: data.descripcion || '', responsable_email: responsable, fecha_comprometida: data.fecha_comprometida,
    estado: 'PENDIENTE', url_evidencia: '', fecha_entrega_real: '', revisado_por: '', resultado_revision: '',
    observaciones: '', fecha_creacion: new Date().toISOString()
  };
  agregarFila_(db, 'PROYECTO_ENTREGABLES', nuevo);
  registrarEventoProyecto_(db, proyecto.proyecto_id, 'ENTREGABLE', contexto, 'Nuevo entregable: ' + nombre, 'ENTREGABLE', nuevo.entregable_id, '');
  return nuevo;
}

function revisarEntregable(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeGestionarProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'Solo el líder del proyecto o un administrador pueden revisar entregables.' };
  const entregable = buscarEntregable_(db, data.entregable_id);
  if (!entregable || entregable.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('entregable_id', 'Entregable no encontrado.');
  if (entregable.estado !== 'ENTREGADO') return errorValidacion_('entregable_id', 'Solo se puede revisar un entregable que ya fue marcado como entregado.');
  const resultado = data.resultado === 'OBSERVADO' ? 'OBSERVADO' : 'APROBADO';
  if (resultado === 'OBSERVADO' && !String(data.observaciones || '').trim()) return errorValidacion_('observaciones', 'Observar un entregable exige indicar el motivo.');
  const revisado = actualizarFilaPorId_(db, 'PROYECTO_ENTREGABLES', 'entregable_id', data.entregable_id, {
    estado: resultado, revisado_por: contexto.email || '', resultado_revision: resultado, observaciones: data.observaciones || ''
  });
  registrarEventoProyecto_(db, proyecto.proyecto_id, 'ENTREGABLE', contexto,
    'Entregable "' + entregable.nombre + '": ' + (resultado === 'APROBADO' ? 'aprobado' : 'observado') + (data.observaciones ? '. ' + data.observaciones : ''), 'ENTREGABLE', data.entregable_id, '');
  NotificacionesApp.encolarLote(db, [{
    destinatario: entregable.responsable_email, tipo: 'PROYECTO_ENTREGABLE',
    titulo: resultado === 'APROBADO' ? 'Entregable aprobado' : 'Entregable observado',
    mensaje: entregable.nombre + (data.observaciones ? ': ' + data.observaciones : ''), modulo_id: 'proyectos', texto_accion: 'Ver proyecto', vidaHoras: 72
  }]);
  return revisado;
}

function gestionarRiesgo(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  const rol = rolEnProyecto_(db, proyecto.proyecto_id, contexto);
  const puedeGestionar = contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR';
  if (!puedeGestionar) return { _forbidden: true, message: 'No puedes gestionar riesgos en este proyecto.' };

  if (data.accion === 'eliminar') {
    if (!data.riesgo_id) return errorValidacion_('riesgo_id', 'Falta indicar el riesgo.');
    return actualizarFilaPorId_(db, 'PROYECTO_RIESGOS', 'riesgo_id', data.riesgo_id, { estado: 'CERRADO' });
  }
  if (data.accion === 'materializar') {
    if (!data.riesgo_id) return errorValidacion_('riesgo_id', 'Falta indicar el riesgo.');
    const riesgoMat = buscarRiesgo_(db, data.riesgo_id);
    if (!riesgoMat || riesgoMat.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('riesgo_id', 'Riesgo no encontrado.');
    if (riesgoMat.estado !== 'ABIERTO') return errorValidacion_('riesgo_id', 'Solo un riesgo abierto puede materializarse en problema.');
    const materializado = actualizarFilaPorId_(db, 'PROYECTO_RIESGOS', 'riesgo_id', data.riesgo_id, { estado: 'MATERIALIZADO' });
    registrarEventoProyecto_(db, proyecto.proyecto_id, 'RIESGO', contexto, 'Riesgo materializado en problema: ' + riesgoMat.descripcion, 'RIESGO', data.riesgo_id, '');
    return materializado;
  }
  if (data.riesgo_id) {
    const actual = buscarRiesgo_(db, data.riesgo_id);
    if (!actual) return errorValidacion_('riesgo_id', 'Riesgo no encontrado.');
    const cambios = {};
    ['descripcion', 'responsable_email', 'mitigacion'].forEach((campo) => { if (data[campo] !== undefined) cambios[campo] = data[campo]; });
    if (data.probabilidad !== undefined) cambios.probabilidad = data.probabilidad;
    if (data.impacto !== undefined) cambios.impacto = data.impacto;
    if (data.probabilidad !== undefined || data.impacto !== undefined) cambios.nivel = calcularNivelRiesgo_(cambios.probabilidad || actual.probabilidad, cambios.impacto || actual.impacto);
    return actualizarFilaPorId_(db, 'PROYECTO_RIESGOS', 'riesgo_id', data.riesgo_id, cambios);
  }

  const descripcion = String(data.descripcion || '').trim();
  if (!descripcion) return errorValidacion_('descripcion', 'La descripción del riesgo es obligatoria.');
  const probabilidad = ['BAJA', 'MEDIA', 'ALTA'].indexOf(data.probabilidad) !== -1 ? data.probabilidad : 'MEDIA';
  const impacto = ['BAJA', 'MEDIA', 'ALTA'].indexOf(data.impacto) !== -1 ? data.impacto : 'MEDIA';
  const riesgo = {
    riesgo_id: uuid_(), proyecto_id: proyecto.proyecto_id, descripcion, probabilidad, impacto,
    nivel: calcularNivelRiesgo_(probabilidad, impacto), responsable_email: normalizarEmail_(data.responsable_email) || proyecto.lider_email,
    mitigacion: data.mitigacion || '', estado: 'ABIERTO', fecha_creacion: new Date().toISOString()
  };
  agregarFila_(db, 'PROYECTO_RIESGOS', riesgo);
  registrarEventoProyecto_(db, proyecto.proyecto_id, 'RIESGO', contexto, 'Riesgo registrado (' + riesgo.nivel + '): ' + descripcion, 'RIESGO', riesgo.riesgo_id, '');
  return riesgo;
}

function getResumenPortafolio(db, contexto) {
  const proyectos = listar(db, {}, contexto);
  const activos = proyectos.filter((p) => p.estado !== 'CERRADO' && p.estado !== 'CANCELADO');
  const porSalud = { normal: 0, riesgo: 0, critico: 0 };
  activos.forEach((p) => { porSalud[p.salud] = (porSalud[p.salud] || 0) + 1; });

  const ahora = new Date();
  const proximosACerrar = activos.filter((p) => {
    if (!p.fecha_objetivo) return false;
    const dias = (new Date(p.fecha_objetivo) - ahora) / 86400000;
    return dias >= 0 && dias <= 14;
  });
  const sinActualizacionReciente = activos.filter((p) => p.ultima_actualizacion && (ahora - new Date(p.ultima_actualizacion)) / 86400000 >= 7);

  const idsActivos = {};
  activos.forEach((p) => { idsActivos[p.proyecto_id] = true; });
  const pesoTamano = { S: 1, M: 2, L: 3, XL: 5 };
  const cargaPorPersona = {};
  leerSeguro_(db, 'ACTIVIDADES').forEach((a) => {
    if (!esVerdadero_(a.activa) || !a.proyecto_id || !idsActivos[a.proyecto_id] || Actividades.esEstadoTerminal_(a.estado)) return;
    const email = a.responsable_email || '(sin responsable)';
    if (!cargaPorPersona[email]) cargaPorPersona[email] = { email, nombre: a.responsable_nombre || email, total_tareas: 0, carga_ponderada: 0 };
    cargaPorPersona[email].total_tareas += 1;
    cargaPorPersona[email].carga_ponderada += pesoTamano[a.tamano] || 2;
  });

  return {
    total_proyectos: activos.length, por_salud: porSalud,
    proximos_a_cerrar: proximosACerrar.length, sin_actualizacion_reciente: sinActualizacionReciente.length,
    carga_por_persona: Object.keys(cargaPorPersona).map((email) => cargaPorPersona[email]).sort((x, y) => y.carga_ponderada - x.carga_ponderada)
  };
}

module.exports = {
  listar, listarMisTareas, listarCalendario, getDetalle, getDetalleCompleto, marcarSalaVisitada,
  crear, guardarComoPlantilla, listarPlantillas, actualizar, gestionarIntegrante, gestionarHito,
  crearTarea, editarTarea, listarTareas, listarBitacora, listarMiBitacora,
  listarSala, publicarEnSala, convertirEventoEnTarea,
  gestionarReunion, agregarAcuerdoReunion, eliminarAcuerdoReunion, convertirAcuerdoEnTarea, listarReuniones,
  gestionarDecision, listarDecisiones,
  gestionarEntregable, revisarEntregable, gestionarRiesgo, getResumenPortafolio,
  // Exportadas: rolEnProyecto_ es el gate que actividades.js consulta para
  // el acoplamiento (RN-709); el resto queda disponible para el incremento 2
  // (cronograma avanzado) y para tests, nunca duplicadas.
  rolEnProyecto_, puedeVerProyecto_, puedeGestionarProyecto_, buscarProyecto_,
  calcularSaludProyecto_, calcularAvanceProyecto_, calcularCumplimientoTareasProyecto_,
  calcularRutaCritica_, calcularImpactoDependencia_, avanceRealTarea_, esTareaTerminalProyecto_
};
