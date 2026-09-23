'use strict';

/**
 * proyectos.js — puerto de backend/backoffice/Proyectos.gs.
 * Incremento 1: MVP + Sala + reuniones/decisiones + entregables/riesgos +
 * plantillas + portafolio.
 * Incremento 2 (v11 Reingenieria Cronograma): registro diario de la Carta
 * Gantt (guardarRegistroDia/eliminarRegistroDia), Plan/Esperado/Real +
 * baseline (obtenerRendimiento/congelarBaseline), analitica avanzada
 * (obtenerAnalitica), workload cruzado del portafolio
 * (obtenerWorkloadPortafolio) y reprogramar con motivo desde el Cronograma
 * (reprogramarTarea, delega en Actividades.reprogramar).
 * Centro documental + adjuntos de Sala (v10 Fase D / v13 Fase 4) usan R2
 * de verdad desde 2026-09-18 (almacenamiento.js). Lo que sigue gateado
 * (PDF de reporte/acta y libro Excel, bloqueados por el motor de PDF) esta
 * al final de este archivo y en router.js, mismo criterio que Pausas/
 * Actividades.
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
const Calidad = require('./calidadSgc');
const Almacenamiento = require('./almacenamiento');

// v10 (Fase D, "adjuntos por proyecto"): mismo tope que Calidad.gs/Novedades.gs.
const MAX_ADJUNTO_PROYECTO_BYTES = 10 * 1024 * 1024;

// Mismas firmas binarias que Perfiles.gs (detectarMimeImagen_) -- esa
// funcion vive dentro de su propio modulo y no es global, asi que se
// copia aca en vez de exportarla solo para este uso.
const FIRMAS_IMAGEN_PROYECTO_ = [
  { mime: 'image/jpeg', firma: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png', firma: [0x89, 0x50, 0x4E, 0x47] },
  // GIF sumado al desgatear la evidencia fotografica de Pausas (Fase 2 del
  // plan post-migracion): el .gs de Pausas la soportaba (FIRMAS_IMAGEN_PAUSAS)
  // y no habia motivo para perder esa capacidad solo por reusar este
  // detector compartido en vez de reimplementar uno local.
  { mime: 'image/gif', firma: [0x47, 0x49, 0x46, 0x38] }
];
function esWebpProyecto_(bytes) {
  if (!bytes || bytes.length < 12) return false;
  const riff = [0x52, 0x49, 0x46, 0x46], webp = [0x57, 0x45, 0x42, 0x50];
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== riff[i]) return false;
    if (bytes[8 + i] !== webp[i]) return false;
  }
  return true;
}
function detectarMimeImagenProyecto_(bytes) {
  if (!bytes || !bytes.length) return null;
  for (const candidato of FIRMAS_IMAGEN_PROYECTO_) {
    if (bytes.length >= candidato.firma.length && bytes.subarray(0, candidato.firma.length).equals(Buffer.from(candidato.firma))) {
      return candidato.mime;
    }
  }
  return esWebpProyecto_(bytes) ? 'image/webp' : null;
}

// v13 (Fase 4, "centro documental"): categorías fijas -- un enum chico y
// genérico (a diferencia del `tipo` de SGC, que sigue una taxonomía ISO)
// que cubre lo que de verdad varía entre documentos de un proyecto interno.
const PROYECTO_DOC_CATEGORIAS_ = ['REQUISITOS', 'DISEÑO', 'CONTRATO', 'ACTA', 'APROBACION', 'ENTREGABLE', 'OTRO'];

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
function buscarHito_(db, hitoId) {
  if (!hitoId) return null;
  return leerSeguro_(db, 'PROYECTO_HITOS').find((h) => h.hito_id === hitoId) || null;
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

  // `id` (aditivo, auditoría UX 2026-09-22 Fase B): el id de la entidad
  // (actividad/hito/riesgo) para que el frontend, al hacer clic en el ítem, no
  // solo abra la pestaña sino que lleve el foco a ESA fila (§9 del brief:
  // indicador → contexto → acción, no solo → pestaña).
  const items = [];
  criticasAtrasadas.forEach((a) => items.push({ tipo: 'tarea_critica_atrasada', tab: 'tareas', id: a.actividad_id, titulo: a.titulo, meta: 'Prioridad ' + a.prioridad + ' · vencida' }));
  bloqueadas.forEach((a) => items.push({ tipo: 'tarea_bloqueada', tab: 'tareas', id: a.actividad_id, titulo: a.titulo, meta: a.bloqueo_motivo || 'Bloqueada' }));
  vencidas.forEach((a) => {
    if (['P1', 'P2'].indexOf(a.prioridad) !== -1) return;
    items.push({ tipo: 'tarea_vencida', tab: 'tareas', id: a.actividad_id, titulo: a.titulo, meta: 'Venció ' + fechaCorta_(a.fecha_compromiso) });
  });
  hitosAtrasados.forEach((h) => items.push({ tipo: 'hito_atrasado', tab: 'hitos', id: h.hito_id, titulo: h.nombre, meta: 'Vencía ' + fechaCorta_(h.fecha_objetivo) }));
  riesgosAltos.forEach((r) => items.push({ tipo: 'riesgo_alto', tab: 'riesgos', id: r.riesgo_id, titulo: r.descripcion, meta: 'Riesgo alto · abierto' }));

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
function buscarDocumentoProyecto_(db, documentoId) { return leerSeguro_(db, 'PROYECTO_DOCUMENTOS').find((d) => d.documento_id === documentoId) || null; }

// Valida y sube el binario a R2 -- MISMA validación que subirAdjunto
// (tamaño, firma binaria real, nunca la extensión ni el mime del
// navegador), reusada aquí para no duplicar la regla de seguridad en dos
// lugares. A diferencia de Calidad.subirArchivoSgc_ (solo PDF/Office),
// esta también acepta imágenes -- por eso no se reusa completa, solo el
// detector de firma (Calidad.mimeArchivoSgc_).
async function subirArchivoDocumentoProyecto_(proyectoId, data, subcarpeta) {
  if (!data.nombre_archivo) return errorValidacion_('nombre_archivo', 'Falta el nombre del archivo.');
  let bytes;
  try {
    bytes = Buffer.from(data.contenido_base64, 'base64');
  } catch (err) {
    return errorValidacion_('contenido_base64', 'El archivo no es base64 válido.');
  }
  if (!bytes.length) return errorValidacion_('contenido_base64', 'El archivo está vacío.');
  if (bytes.length > MAX_ADJUNTO_PROYECTO_BYTES) {
    return errorValidacion_('contenido_base64', 'El archivo supera el tamaño máximo (' + Math.round(MAX_ADJUNTO_PROYECTO_BYTES / (1024 * 1024)) + ' MB).');
  }
  const mime = Calidad.mimeArchivoSgc_(bytes, data.nombre_archivo) || detectarMimeImagenProyecto_(bytes);
  if (!mime) return errorValidacion_('contenido_base64', 'Formato no admitido. Se aceptan PDF, Word, Excel, PowerPoint, JPG, PNG o WebP.');

  const clave = 'proyectos/' + proyectoId + '/' + subcarpeta + '/' + uuid_() + '/' + data.nombre_archivo;
  const subida = await Almacenamiento.subirArchivo_(clave, data.contenido_base64, mime);
  if (!subida.ok) return errorValidacion_('contenido_base64', subida.message);
  return { archivo_id: clave, archivo_nombre: data.nombre_archivo, archivo_mime: mime, tamano_bytes: bytes.length };
}

// vN autoincremental por documento -- un documento de proyecto no necesita
// el código de versión formal que SGC exige para auditoría externa (v01,
// v02...); alcanza con un entero simple que nunca colisiona.
function siguienteVersionDocumentoProyecto_(db, documentoId) {
  let max = 0;
  leerSeguro_(db, 'PROYECTO_DOC_VERSIONES').forEach((v) => {
    if (v.documento_id !== documentoId) return;
    const n = Number(String(v.version || '').replace(/[^0-9]/g, ''));
    if (n > max) max = n;
  });
  return 'v' + (max + 1);
}

// Registra la nueva versión (append-only, nunca se borra) y sincroniza la
// copia denormalizada en PROYECTO_DOCUMENTOS -- mismo patrón que
// registrarVersionSgc_/nuevaVersion en calidadSgc.js.
function registrarVersionDocumentoProyecto_(db, documentoId, version, comentario, archivo, contexto) {
  leerSeguro_(db, 'PROYECTO_DOC_VERSIONES').forEach((v) => {
    if (v.documento_id === documentoId && esVerdadero_(v.vigente)) {
      actualizarFilaPorId_(db, 'PROYECTO_DOC_VERSIONES', 'version_id', v.version_id, { vigente: false });
    }
  });
  const fila = {
    version_id: uuid_(), documento_id: documentoId, version, comentario: comentario || '',
    archivo_id: archivo.archivo_id, archivo_nombre: archivo.archivo_nombre, archivo_mime: archivo.archivo_mime,
    tamano_bytes: archivo.tamano_bytes || 0, subido_por: (contexto && contexto.email) || '',
    fecha: new Date().toISOString(), vigente: true
  };
  agregarFila_(db, 'PROYECTO_DOC_VERSIONES', fila);
  actualizarFilaPorId_(db, 'PROYECTO_DOCUMENTOS', 'documento_id', documentoId, {
    version_vigente: version, archivo_id: archivo.archivo_id, archivo_nombre: archivo.archivo_nombre,
    archivo_mime: archivo.archivo_mime, tamano_bytes: archivo.tamano_bytes || 0
  });
  return fila;
}

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
    // El permiso de arriba se valido contra data.proyecto_id: sin este
    // chequeo, un LIDER de SU proyecto podia eliminar el hito de OTRO
    // proyecto con solo conocer su UUID. crearTarea (linea 888-891) ya
    // exige esta misma pertenencia cuando el hito_id llega como
    // referencia externa -- el CRUD de hitos no se protegia con la misma
    // regla que el mismo le exige a sus consumidores.
    const hitoAEliminar = buscarHito_(db, data.hito_id);
    if (!hitoAEliminar || hitoAEliminar.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('hito_id', 'Hito no encontrado.');
    const tareasDelHito = leerSeguro_(db, 'ACTIVIDADES').filter((a) => a.hito_id === data.hito_id);
    if (tareasDelHito.length > 0) return errorValidacion_('hito_id', 'Este hito tiene tareas asociadas; muévelas antes de eliminarlo.');
    return eliminarFilaHito_(db, data.hito_id);
  }
  if (data.hito_id) {
    const hitoAEditar = buscarHito_(db, data.hito_id);
    if (!hitoAEditar || hitoAEditar.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('hito_id', 'Hito no encontrado.');
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
  // Reasignar una tarea de proyecto tenia menos rigor que Actividades.
  // reasignar (actividad suelta): no validaba que el nuevo responsable
  // fuera integrante del proyecto (un email que no encontraba en
  // PROYECTO_INTEGRANTES igual se guardaba, solo se omitia el nombre), y
  // no tocaba estado/confirmada_en/bloqueo_*/confianza/avance_pct -- la
  // tarea podia quedar EN_CURSO con la confirmacion de la persona
  // ANTERIOR, como si el nuevo responsable ya hubiera aceptado un
  // compromiso que nunca vio. No se porta el motivo/chequeo de JEFATURA de
  // reasignar (no aplican al contexto de un proyecto, donde la autoridad
  // real es el lider), pero si la consistencia de estado y la traza.
  const seReasigna = data.responsable_email !== undefined &&
    normalizarEmail_(data.responsable_email) !== normalizarEmail_(actividad.responsable_email);
  let nuevoRespIntegrante = null;
  if (seReasigna) {
    nuevoRespIntegrante = leerSeguro_(db, 'PROYECTO_INTEGRANTES').find((i) =>
      i.proyecto_id === proyecto.proyecto_id && esVerdadero_(i.activo) && normalizarEmail_(i.usuario_email) === normalizarEmail_(data.responsable_email));
    if (!nuevoRespIntegrante) return errorValidacion_('responsable_email', 'El nuevo responsable debe ser integrante activo de este proyecto.');
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
  if (seReasigna) {
    cambios.responsable_nombre = nuevoRespIntegrante.usuario_nombre || '';
    cambios.estado = Actividades.ACTIVIDADES_ESTADOS.NO_INICIADA;
    cambios.fecha_propuesta = data.fecha_compromiso !== undefined ? data.fecha_compromiso : (actividad.fecha_compromiso || actividad.fecha_propuesta);
    cambios.fecha_compromiso = '';
    cambios.confirmada_en = '';
    cambios.bloqueo_motivo = '';
    cambios.bloqueo_responsable_email = '';
    cambios.bloqueo_desde = '';
    cambios.confianza = 'VERDE';
    cambios.avance_pct = '';
  }
  cambios.ultima_actualizacion = new Date().toISOString();
  const actualizado = actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', actividad.actividad_id, cambios);
  if (seReasigna) {
    Actividades.registrarEventoActividad_(db, actividad.actividad_id, 'REASIGNACION', contexto, 'Reasignada desde el proyecto',
      { responsable_anterior: actividad.responsable_email, responsable_nuevo: normalizarEmail_(data.responsable_email) });
  }
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
    // Dos bugs corregidos aca: (1) sin comprobar pertenencia, cualquier
    // integrante de este proyecto podia cancelar un entregable de OTRO
    // proyecto con solo su UUID (mismo patron que hitos/riesgos arriba);
    // (2) el "if (paraEliminar && ...)" original dejaba pasar un
    // entregable INEXISTENTE derecho al actualizarFilaPorId_ final -- el
    // `&&` cortocircuitaba cuando paraEliminar era null, sin error.
    if (!paraEliminar || paraEliminar.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('entregable_id', 'Entregable no encontrado.');
    if (paraEliminar.estado !== 'PENDIENTE') return errorValidacion_('entregable_id', 'Solo se puede eliminar un entregable que aun no se ha marcado como entregado.');
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
    const paraEditar = buscarEntregable_(db, data.entregable_id);
    if (!paraEditar || paraEditar.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('entregable_id', 'Entregable no encontrado.');
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
    // Sin este chequeo, cualquier integrante de CUALQUIER proyecto podia
    // cerrar el riesgo de OTRO proyecto con solo su UUID: el permiso de
    // arriba solo exige pertenecer al proyecto de data.proyecto_id, no al
    // proyecto DUEÑO del riesgo. La rama 'materializar' (abajo) ya hace
    // este mismo chequeo -- mismo criterio aca.
    const riesgoAEliminar = buscarRiesgo_(db, data.riesgo_id);
    if (!riesgoAEliminar || riesgoAEliminar.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('riesgo_id', 'Riesgo no encontrado.');
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
    if (!actual || actual.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('riesgo_id', 'Riesgo no encontrado.');
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

// --- Fase H (Camino B): avance físico -- curva S de control -----------------
//
// Puntos de control MANUALES (% proyectado / % real por fecha), a nivel de
// PROYECTO -- independientes del avance derivado de las tareas
// (avance_pct/avance_esperado_pct, que YA existen). Es lo que un líder
// reporta semanalmente sin tener que desglosar tarea por tarea, igual que la
// "curva S" de control físico que cualquier PM de obra/proyecto lleva a mano
// (la referencia ITO la llama "Avance Simple"). Gateado igual que el
// baseline (congelarBaseline): solo quien gestiona el proyecto -- es una
// declaración de gestión, no un dato operativo de cualquier integrante.
function buscarControlAvance_(db, controlId) {
  if (!controlId) return null;
  return leerSeguro_(db, 'PROYECTO_CONTROL_AVANCE').find((c) => c.control_id === controlId) || null;
}

function listarControlAvance(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data && data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeVerProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
  const puntos = leerSeguro_(db, 'PROYECTO_CONTROL_AVANCE')
    .filter((c) => c.proyecto_id === proyecto.proyecto_id)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  return { puntos };
}

function gestionarControlAvance(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data && data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeGestionarProyecto_(db, proyecto, contexto)) {
    return { _forbidden: true, message: 'Solo quien gestiona el proyecto puede registrar el avance físico.' };
  }

  if (data.accion === 'eliminar') {
    if (!data.control_id) return errorValidacion_('control_id', 'Falta indicar el punto de control.');
    const actual = buscarControlAvance_(db, data.control_id);
    if (!actual || actual.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('control_id', 'Punto de control no encontrado.');
    eliminarFilasPorId_(db, 'PROYECTO_CONTROL_AVANCE', 'control_id', data.control_id);
    return { eliminado: true };
  }

  const fecha = String(data.fecha || '').trim();
  if (!fecha || isNaN(new Date(fecha).getTime())) return errorValidacion_('fecha', 'La fecha de control es obligatoria.');
  const pctProyectado = Number(data.pct_proyectado);
  if (data.pct_proyectado === undefined || data.pct_proyectado === '' || isNaN(pctProyectado) || pctProyectado < 0 || pctProyectado > 100) {
    return errorValidacion_('pct_proyectado', 'El porcentaje proyectado debe ser un número entre 0 y 100.');
  }
  let pctReal = '';
  if (data.pct_real !== undefined && data.pct_real !== null && data.pct_real !== '') {
    pctReal = Number(data.pct_real);
    if (isNaN(pctReal) || pctReal < 0 || pctReal > 100) return errorValidacion_('pct_real', 'El porcentaje real debe ser un número entre 0 y 100.');
  }
  const nota = String(data.nota || '').trim();
  const cambios = { pct_proyectado: pctProyectado, pct_real: pctReal, nota, registrado_por: (contexto && contexto.email) || '' };

  // UPSERT por (proyecto_id, fecha): una fecha, un punto -- reeditar el mismo
  // día actualiza en vez de duplicar (mismo criterio que el registro del día
  // de Dedicación).
  const existente = leerSeguro_(db, 'PROYECTO_CONTROL_AVANCE')
    .find((c) => c.proyecto_id === proyecto.proyecto_id && claveFecha_(c.fecha) === claveFecha_(fecha));
  if (existente) return actualizarFilaPorId_(db, 'PROYECTO_CONTROL_AVANCE', 'control_id', existente.control_id, cambios);

  const nuevo = Object.assign(
    { control_id: uuid_(), proyecto_id: proyecto.proyecto_id, fecha, fecha_creacion: new Date().toISOString() },
    cambios
  );
  agregarFila_(db, 'PROYECTO_CONTROL_AVANCE', nuevo);
  return nuevo;
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

// ===========================================================================
// Incremento 2 (v11 Reingenieria Cronograma): registro diario, Plan/Esperado/
// Real + baseline, analitica avanzada, workload cruzado, reprogramar.
// ===========================================================================

// v11 (P0): los 9 estados-del-dia del registro diario -- el estado del DIA
// (que paso ese dia en esa tarea), distinto del estado de la tarea completa.
// SIGSO no es vigilancia: "sin registro" no es un estado, es la AUSENCIA de
// fila; no existe un "no_trabajo".
const REGISTRO_DIA_ESTADOS_ = [
  'asignado', 'planificado', 'en_proceso', 'bloqueado', 'pausado',
  'finalizado', 'entregado', 'revision', 'esperando_tercero'
];

// Mismo criterio que clavePdf_ del .gs (UTC, no zona horaria de negocio):
// usado sobre fechas ya-ISO de ACTIVIDADES (fecha_creacion/fecha_compromiso),
// no sobre "el dia de hoy" (eso usa Utils.claveDia_ con TZ Chile, ver abajo).
function claveFecha_(valor) {
  if (!valor) return '';
  const f = new Date(valor);
  return isNaN(f.getTime()) ? '' : f.toISOString().slice(0, 10);
}

function redond1Analitica_(n) { return Math.round(n * 10) / 10; }

// v11 (P3): suma la duracion de cada intervalo [apertura, cierre],
// emparejando cronologicamente. Un intervalo que sigue abierto (aun
// bloqueada/en revision ahora mismo) cuenta hasta AHORA.
function sumarIntervalosBitacora_(eventos, tiposApertura, tiposCierre, ahora) {
  const ordenados = eventos.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  let totalMs = 0, abiertoDesde = null;
  ordenados.forEach((ev) => {
    if (tiposApertura.indexOf(ev.tipo) !== -1 && abiertoDesde === null) {
      abiertoDesde = new Date(ev.timestamp);
    } else if (tiposCierre.indexOf(ev.tipo) !== -1 && abiertoDesde !== null) {
      totalMs += new Date(ev.timestamp).getTime() - abiertoDesde.getTime();
      abiertoDesde = null;
    }
  });
  if (abiertoDesde !== null) totalMs += ahora.getTime() - abiertoDesde.getTime();
  return totalMs / 86400000;
}

const CYCLE_TIME_TIPOS_TRABAJO_ = ['CHECKIN_AVANCE', 'CHECKIN_SIN_CAMBIO', 'DESBLOQUEO'];
const CYCLE_TIME_ESTADOS_DIA_INTENCION_ = ['asignado', 'planificado'];
function calcularLeadTimeDias_(a) {
  if (!a.fecha_creacion || !a.fecha_terminada) return null;
  return redond1Analitica_((new Date(a.fecha_terminada) - new Date(a.fecha_creacion)) / 86400000);
}
function calcularCycleTimeDias_(a, eventos) {
  if (!a.fecha_terminada) return null;
  let primeraSenal = null;
  eventos.forEach((b) => {
    let esTrabajo = CYCLE_TIME_TIPOS_TRABAJO_.indexOf(b.tipo) !== -1;
    if (!esTrabajo && b.tipo === 'REGISTRO_DIA') {
      const d = datosDeBitacora_(b);
      esTrabajo = CYCLE_TIME_ESTADOS_DIA_INTENCION_.indexOf(d.estado_dia) === -1;
    }
    if (!esTrabajo) return;
    const t = new Date(b.timestamp);
    if (isNaN(t.getTime())) return;
    if (primeraSenal === null || t < primeraSenal) primeraSenal = t;
  });
  if (primeraSenal === null) return null;
  return redond1Analitica_((new Date(a.fecha_terminada) - primeraSenal) / 86400000);
}
// Reexpone el parseo de 'datos' de una fila de bitacora (mismo criterio que
// filaBitacoraSalida_, que ya lo hace inline) -- lo necesita calcularCycleTimeDias_.
function datosDeBitacora_(fila) {
  if (!fila || !fila.datos) return {};
  try { const d = JSON.parse(fila.datos); return (d && typeof d === 'object') ? d : {}; }
  catch (e) { return {}; }
}

function guardarRegistroDia(db, data, contexto) {
  data = data || {};
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeVerProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
  const actividad = leerSeguro_(db, 'ACTIVIDADES').find((a) => a.actividad_id === data.actividad_id && a.proyecto_id === proyecto.proyecto_id);
  if (!actividad) return errorValidacion_('actividad_id', 'Tarea no encontrada en este proyecto.');
  const email = normalizarEmail_(contexto && contexto.email);
  if (!Actividades.trabajaLaActividad_(actividad, email) && !puedeGestionarProyecto_(db, proyecto, contexto)) {
    return { _forbidden: true, message: 'Solo quien trabaja la tarea o el líder del proyecto puede registrar el día.' };
  }

  const dia = String(data.dia || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return errorValidacion_('dia', 'El día debe tener formato AAAA-MM-DD.');
  const hoyClave = Utils.claveDia_(new Date(), 'America/Santiago');
  if (dia > hoyClave) return errorValidacion_('dia', 'No se puede registrar un día futuro.');

  const estadoDia = String(data.estado_dia || '').trim();
  if (REGISTRO_DIA_ESTADOS_.indexOf(estadoDia) === -1) return errorValidacion_('estado_dia', 'Estado del día no válido.');

  let horas;
  if (data.horas !== undefined && data.horas !== null && data.horas !== '') {
    horas = Number(data.horas);
    if (isNaN(horas) || horas < 0 || horas > 24) return errorValidacion_('horas', 'Las horas deben ser un número entre 0 y 24.');
  }

  const bloqueoMotivo = String(data.bloqueo_motivo || '').trim();
  if (estadoDia === 'bloqueado' && !bloqueoMotivo) return errorValidacion_('bloqueo_motivo', 'Un día bloqueado necesita un motivo.');

  let tramos = [];
  if (Array.isArray(data.tramos)) {
    tramos = data.tramos.map((t) => ({
      desde: String((t && t.desde) || '').slice(0, 5),
      hasta: String((t && t.hasta) || '').slice(0, 5),
      nota: String((t && t.nota) || '').slice(0, 200)
    })).filter((t) => t.desde || t.hasta || t.nota);
  }

  const nota = String(data.nota || '').slice(0, 2000);
  const ahora = new Date().toISOString();

  const existente = leerSeguro_(db, 'ACTIVIDADES_BITACORA').find((b) => {
    if (b.tipo !== 'REGISTRO_DIA' || b.actividad_id !== actividad.actividad_id) return false;
    return datosDeBitacora_(b).dia === dia;
  });

  const datos = {
    dia, estado_dia: estadoDia, horas: (horas !== undefined) ? horas : '', bloqueo_motivo: bloqueoMotivo, tramos,
    creado_por: email, creado_en: (existente ? (datosDeBitacora_(existente).creado_en || ahora) : ahora),
    editado_por: email, editado_en: ahora, ediciones: []
  };
  const timestampDia = dia + 'T13:00:00.000Z';

  if (existente) {
    const previo = datosDeBitacora_(existente);
    const edicionesPrevias = Array.isArray(previo.ediciones) ? previo.ediciones : [];
    edicionesPrevias.push({
      estado_dia: previo.estado_dia || '', horas: (previo.horas !== undefined) ? previo.horas : '',
      nota: existente.nota || '', bloqueo_motivo: previo.bloqueo_motivo || '',
      editado_por: previo.editado_por || previo.creado_por || '', editado_en: previo.editado_en || previo.creado_en || existente.timestamp || ''
    });
    datos.ediciones = edicionesPrevias.slice(-50);
    actualizarFilaPorId_(db, 'ACTIVIDADES_BITACORA', 'bitacora_id', existente.bitacora_id, {
      nota, avance_pct: '', confianza: '', datos: JSON.stringify(datos),
      autor_nombre: (contexto && contexto.nombre) || existente.autor_nombre || '', timestamp: timestampDia
    });
  } else {
    agregarFila_(db, 'ACTIVIDADES_BITACORA', {
      bitacora_id: uuid_(), actividad_id: actividad.actividad_id, tipo: 'REGISTRO_DIA',
      autor_email: (contexto && contexto.email) || '', autor_nombre: (contexto && contexto.nombre) || '',
      nota, avance_pct: '', confianza: '', datos: JSON.stringify(datos), timestamp: timestampDia
    });
  }

  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', actividad.actividad_id, { ultima_actualizacion: ahora });
  return { ok: true, dia, estado_dia: estadoDia, editado: !!existente };
}

function eliminarRegistroDia(db, data, contexto) {
  data = data || {};
  const proyecto = buscarProyecto_(db, data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeVerProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
  const actividad = leerSeguro_(db, 'ACTIVIDADES').find((a) => a.actividad_id === data.actividad_id && a.proyecto_id === proyecto.proyecto_id);
  if (!actividad) return errorValidacion_('actividad_id', 'Tarea no encontrada en este proyecto.');
  const email = normalizarEmail_(contexto && contexto.email);
  if (!Actividades.trabajaLaActividad_(actividad, email) && !puedeGestionarProyecto_(db, proyecto, contexto)) {
    return { _forbidden: true, message: 'Solo quien trabaja la tarea o el líder del proyecto puede eliminar el registro.' };
  }
  const dia = String(data.dia || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return errorValidacion_('dia', 'El día debe tener formato AAAA-MM-DD.');
  const existente = leerSeguro_(db, 'ACTIVIDADES_BITACORA').find((b) => b.tipo === 'REGISTRO_DIA' && b.actividad_id === actividad.actividad_id && datosDeBitacora_(b).dia === dia);
  if (!existente) return errorValidacion_('dia', 'No hay un registro para ese día.');
  eliminarFilasPorId_(db, 'ACTIVIDADES_BITACORA', 'bitacora_id', existente.bitacora_id);
  actualizarFilaPorId_(db, 'ACTIVIDADES', 'actividad_id', actividad.actividad_id, { ultima_actualizacion: new Date().toISOString() });
  return { ok: true, dia, eliminado: true };
}

function obtenerRendimiento(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data && data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeVerProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
  const tareas = leerSeguro_(db, 'ACTIVIDADES').filter((a) => esVerdadero_(a.activa) && a.proyecto_id === proyecto.proyecto_id);
  const idsTarea = {};
  tareas.forEach((a) => { idsTarea[a.actividad_id] = true; });

  const horasPorTarea = {}, diasPorTarea = {};
  leerSeguro_(db, 'ACTIVIDADES_BITACORA').forEach((b) => {
    if (!idsTarea[b.actividad_id]) return;
    const horas = Number(datosDeBitacora_(b).horas) || 0;
    if (horas) horasPorTarea[b.actividad_id] = (horasPorTarea[b.actividad_id] || 0) + horas;
    const f = new Date(b.timestamp);
    if (isNaN(f.getTime())) return;
    const clave = f.toISOString().slice(0, 10);
    (diasPorTarea[b.actividad_id] = diasPorTarea[b.actividad_id] || {})[clave] = true;
  });

  const porTarea = tareas.filter((a) => a.meta_cantidad).map((a) => {
    const horas = horasPorTarea[a.actividad_id] || 0;
    const dias = Object.keys(diasPorTarea[a.actividad_id] || {}).length;
    const terminada = a.estado === 'TERMINADA';
    return {
      actividad_id: a.actividad_id, titulo: a.titulo, estado: a.estado,
      meta_cantidad: a.meta_cantidad, meta_unidad: a.meta_unidad,
      horas_totales: horas ? Math.round(horas * 10) / 10 : '',
      dias_trabajados: dias,
      unidades_por_dia: (terminada && dias > 0) ? Math.round((a.meta_cantidad / dias) * 10) / 10 : '',
      horas_por_unidad: (terminada && horas > 0) ? Math.round((horas / a.meta_cantidad) * 100) / 100 : ''
    };
  });

  const conRitmo = porTarea.filter((t) => t.unidades_por_dia !== '');
  const horasTotalesProyecto = Object.keys(horasPorTarea).reduce((s, k) => s + horasPorTarea[k], 0);

  const baseline = obtenerUltimaBaseline_(db, proyecto.proyecto_id);
  const ahora = new Date();
  const claveInicioProyecto = proyecto.fecha_inicio ? claveFecha_(proyecto.fecha_inicio) : '';
  const planSeguimiento = tareas.map((a) => {
    const real = avanceRealTarea_(a);
    const claveCreacion = claveFecha_(a.fecha_creacion);
    const claveCompromiso = claveFecha_(a.fecha_compromiso);
    const planInicio = planInicioEfectivoClave_(claveCreacion, claveCompromiso, claveInicioProyecto);
    const esperado = calcularAvanceEsperado_(planInicio, a.fecha_compromiso, ahora);
    const baseTarea = baseline && baseline.por_tarea[a.actividad_id];
    return {
      actividad_id: a.actividad_id, plan_inicio: planInicio, plan_fin: a.fecha_compromiso || '',
      baseline_inicio: baseTarea ? baseTarea.fecha_inicio : '', baseline_fin: baseTarea ? baseTarea.fecha_fin : '',
      avance_real_pct: real, avance_esperado_pct: esperado,
      desviacion_pp: (real !== null && esperado !== null) ? Math.round((real - esperado) * 10) / 10 : null,
      spi: (real !== null && esperado > 0) ? Math.round((real / esperado) * 100) / 100 : null
    };
  });

  return {
    por_tarea: porTarea,
    promedio_unidades_dia: conRitmo.length ? Math.round((conRitmo.reduce((s, t) => s + t.unidades_por_dia, 0) / conRitmo.length) * 10) / 10 : null,
    horas_totales_proyecto: horasTotalesProyecto ? Math.round(horasTotalesProyecto * 10) / 10 : 0,
    tareas_sin_avance: tareas.filter((a) => a.estado === 'NO_INICIADA').length,
    cumplimiento_tareas: calcularCumplimientoTareasProyecto_(tareas),
    plan_seguimiento: planSeguimiento,
    baseline: baseline ? { timestamp: baseline.timestamp, autor_nombre: baseline.autor_nombre } : null
  };
}
// v15.4: el inicio de plan efectivo -- fecha_creacion si es coherente con el
// compromiso; si no, el inicio del proyecto; si tampoco, el propio compromiso.
function planInicioEfectivoClave_(claveCreacion, claveCompromiso, claveInicioProyecto) {
  if (!claveCompromiso) return claveCreacion || '';
  if (claveCreacion && claveCreacion <= claveCompromiso) return claveCreacion;
  if (claveInicioProyecto && claveInicioProyecto <= claveCompromiso) return claveInicioProyecto;
  return claveCompromiso;
}
// v11 (P1): la baseline vigente es el evento BASELINE mas reciente. Un
// .reverse() antes del sort (estable) resuelve empates a favor del ULTIMO
// congelado, no del primero -- dos congelamientos en la misma ejecucion
// pueden empatar al milisegundo.
function obtenerUltimaBaseline_(db, proyectoId) {
  const eventos = leerSeguro_(db, 'PROYECTO_EVENTOS').filter((e) => e.proyecto_id === proyectoId && e.tipo === 'BASELINE')
    .reverse().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  if (!eventos.length) return null;
  const evento = eventos[0];
  let datos;
  try { datos = JSON.parse(evento.cuerpo); } catch (e) { datos = null; }
  if (!datos || !Array.isArray(datos.tareas)) return null;
  const porTarea = {};
  datos.tareas.forEach((t) => { porTarea[t.actividad_id] = { fecha_inicio: t.fecha_inicio || '', fecha_fin: t.fecha_fin || '' }; });
  return { timestamp: evento.timestamp, autor_nombre: evento.autor_nombre || evento.autor_email, por_tarea: porTarea };
}

function obtenerAnalitica(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data && data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeVerProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
  const tareas = leerSeguro_(db, 'ACTIVIDADES').filter((a) => esVerdadero_(a.activa) && a.proyecto_id === proyecto.proyecto_id);
  const idsTarea = {};
  tareas.forEach((a) => { idsTarea[a.actividad_id] = true; });
  const bitacoraPorTarea = {};
  leerSeguro_(db, 'ACTIVIDADES_BITACORA').forEach((b) => {
    if (!idsTarea[b.actividad_id]) return;
    (bitacoraPorTarea[b.actividad_id] = bitacoraPorTarea[b.actividad_id] || []).push(b);
  });

  const ahora = new Date();
  const porTarea = tareas.map((a) => {
    const eventos = bitacoraPorTarea[a.actividad_id] || [];
    return {
      actividad_id: a.actividad_id, titulo: a.titulo,
      lead_time_dias: calcularLeadTimeDias_(a),
      cycle_time_dias: calcularCycleTimeDias_(a, eventos),
      tiempo_bloqueo_dias: redond1Analitica_(sumarIntervalosBitacora_(eventos, ['BLOQUEO'], ['DESBLOQUEO', 'ENTREGA'], ahora)),
      tiempo_revision_dias: a.requiere_validacion ? redond1Analitica_(sumarIntervalosBitacora_(eventos, ['ENTREGA'], ['VALIDACION'], ahora)) : 0
    };
  });

  function promedioDe_(campo) {
    const valores = porTarea.map((t) => t[campo]).filter((v) => v !== null && v !== undefined);
    if (!valores.length) return null;
    return redond1Analitica_(valores.reduce((s, v) => s + v, 0) / valores.length);
  }
  function sumaDe_(campo) { return redond1Analitica_(porTarea.reduce((s, t) => s + (t[campo] || 0), 0)); }
  const spiValores = tareas.map((a) => {
    const real = avanceRealTarea_(a);
    const esperado = calcularAvanceEsperado_(a.fecha_creacion, a.fecha_compromiso, ahora);
    return (real !== null && esperado > 0) ? real / esperado : null;
  }).filter((v) => v !== null);

  return {
    por_tarea: porTarea,
    lead_time_promedio_dias: promedioDe_('lead_time_dias'),
    cycle_time_promedio_dias: promedioDe_('cycle_time_dias'),
    tiempo_bloqueo_total_dias: sumaDe_('tiempo_bloqueo_dias'),
    tiempo_revision_total_dias: sumaDe_('tiempo_revision_dias'),
    spi_promedio: spiValores.length ? Math.round((spiValores.reduce((s, v) => s + v, 0) / spiValores.length) * 100) / 100 : null
  };
}

function obtenerWorkloadPortafolio(db, data, contexto) {
  const proyectosVisibles = listar(db, {}, contexto).filter((p) => p.estado !== 'CERRADO' && p.estado !== 'CANCELADO');
  const nombrePorProyecto = {}, idsProyecto = {};
  proyectosVisibles.forEach((p) => { nombrePorProyecto[p.proyecto_id] = p.nombre; idsProyecto[p.proyecto_id] = true; });
  const tareas = leerSeguro_(db, 'ACTIVIDADES').filter((a) => esVerdadero_(a.activa) && a.proyecto_id && idsProyecto[a.proyecto_id])
    .map((a) => ({
      actividad_id: a.actividad_id, titulo: a.titulo, estado: a.estado, semaforo: Actividades.semaforoActividad_(a).codigo,
      responsable_email: a.responsable_email, responsable_nombre: a.responsable_nombre,
      proyecto_id: a.proyecto_id, proyecto_nombre: nombrePorProyecto[a.proyecto_id] || ''
    }));
  const idsTarea = {};
  tareas.forEach((a) => { idsTarea[a.actividad_id] = true; });
  const bitacora = leerSeguro_(db, 'ACTIVIDADES_BITACORA').filter((b) => idsTarea[b.actividad_id]).map(filaBitacoraSalida_);
  return { proyectos: proyectosVisibles.map((p) => ({ proyecto_id: p.proyecto_id, nombre: p.nombre })), tareas, bitacora };
}

function congelarBaseline(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data && data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeGestionarProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'Solo el líder del proyecto (o ADM) puede congelar la línea base.' };
  const tareas = leerSeguro_(db, 'ACTIVIDADES').filter((a) => esVerdadero_(a.activa) && a.proyecto_id === proyecto.proyecto_id);
  const snapshot = tareas.map((a) => ({ actividad_id: a.actividad_id, titulo: a.titulo, fecha_inicio: a.fecha_creacion || '', fecha_fin: a.fecha_compromiso || '' }));
  const evento = registrarEventoProyecto_(db, proyecto.proyecto_id, 'BASELINE', contexto,
    'Línea base congelada (' + snapshot.length + ' tarea[s])', '', '', JSON.stringify({ tareas: snapshot }));
  return { ok: true, evento_id: evento.evento_id, timestamp: evento.timestamp, total_tareas: snapshot.length };
}

function reprogramarTarea(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data && data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeVerProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
  const actividad = leerSeguro_(db, 'ACTIVIDADES').find((a) => a.actividad_id === data.actividad_id && a.proyecto_id === proyecto.proyecto_id);
  if (!actividad) return errorValidacion_('actividad_id', 'Tarea no encontrada en este proyecto.');
  return Actividades.reprogramar(db, data, contexto);
}

// --- Adjuntos de la Sala (v10 Fase D): una zona de archivos por proyecto,
// "enlazable desde la sala" -- en vez de una hoja nueva solo para metadata
// de archivos, el adjunto ES un evento mas de la Sala (tipo ARCHIVO,
// ref_id = clave del archivo en R2): aparece en el feed como cualquier
// otra novedad, con su autor y su fecha, sin duplicar "quien publico que y
// cuando" en dos tablas distintas. Mismo circulo que puede crear tareas
// (LIDER/INTEGRANTE/COLABORADOR o ADM).
async function subirAdjunto(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data && data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  const rol = rolEnProyecto_(db, proyecto.proyecto_id, contexto);
  if (!(contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR')) {
    return { _forbidden: true, message: 'No puedes subir archivos a este proyecto.' };
  }
  const archivo = await subirArchivoDocumentoProyecto_(proyecto.proyecto_id, data, 'adjuntos');
  if (archivo._validationError) return archivo;
  return registrarEventoProyecto_(db, proyecto.proyecto_id, 'ARCHIVO', contexto,
    data.nombre_archivo, 'ARCHIVO', archivo.archivo_id, data.comentario || '');
}

// Sirve el archivo por backend (nunca la clave de R2 directo): re-valida
// el acceso al proyecto en cada descarga, mismo criterio que
// Novedades.descargarAdjunto/Calidad.descargarDocumento.
async function descargarAdjunto(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data && data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeVerProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
  const evento = leerSeguro_(db, 'PROYECTO_EVENTOS').find((e) => e.evento_id === data.evento_id && e.proyecto_id === proyecto.proyecto_id && e.tipo === 'ARCHIVO');
  if (!evento) return errorValidacion_('evento_id', 'Archivo no encontrado.');
  const descarga = await Almacenamiento.descargarArchivo_(evento.ref_id);
  if (!descarga.ok) return errorValidacion_('evento_id', descarga.message);
  return { contenido_base64: descarga.contenido_base64, nombre_archivo: evento.titulo, mime: descarga.content_type };
}

// --- Documentos (Fase 4, "centro documental"): repositorio FORMAL, con
// categoría, versionado real e historial -- distinto del adjunto suelto de
// la Sala (subirAdjunto/descargarAdjunto, arriba), que sigue existiendo
// igual para el archivo rápido de conversación. Mismo patrón ya probado en
// calidadSgc.js (PROYECTO_DOCUMENTOS/PROYECTO_DOC_VERSIONES, documento
// controlado), sin los campos propios de esa norma (clausulas, acuse,
// área) -- un documento de proyecto no necesita ese formalismo, solo
// trazabilidad.
async function gestionarDocumento(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data && data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  const rol = rolEnProyecto_(db, proyecto.proyecto_id, contexto);
  const puedeGestionar = contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR';
  if (!puedeGestionar) return { _forbidden: true, message: 'No puedes gestionar documentos en este proyecto.' };

  if (data.accion === 'eliminar') {
    if (!data.documento_id) return errorValidacion_('documento_id', 'Falta indicar el documento.');
    const paraEliminar = buscarDocumentoProyecto_(db, data.documento_id);
    if (!paraEliminar || paraEliminar.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('documento_id', 'Documento no encontrado.');
    // Soft-delete (igual criterio que el resto del módulo: nunca se pierde
    // historial). Las versiones en PROYECTO_DOC_VERSIONES y los archivos en
    // R2 quedan intactos -- si algún día se necesita, sigue ahí.
    return actualizarFilaPorId_(db, 'PROYECTO_DOCUMENTOS', 'documento_id', data.documento_id, { activo: false });
  }

  // Referencia opcional a una tarea, hito, reunión o decisión -- RN-709 de
  // siempre: debe ser del MISMO proyecto (nunca un enlace cruzado a otro).
  let refTipo = '', refId = '';
  if (data.ref_tipo === 'ACTIVIDAD' && data.ref_id) {
    const tareaRef = leerSeguro_(db, 'ACTIVIDADES').find((a) => a.actividad_id === data.ref_id);
    if (!tareaRef || tareaRef.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('ref_id', 'La tarea indicada no pertenece a este proyecto.');
    refTipo = 'ACTIVIDAD'; refId = data.ref_id;
  } else if (data.ref_tipo === 'HITO' && data.ref_id) {
    const hitoRef = leerSeguro_(db, 'PROYECTO_HITOS').find((h) => h.hito_id === data.ref_id);
    if (!hitoRef || hitoRef.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('ref_id', 'El hito indicado no pertenece a este proyecto.');
    refTipo = 'HITO'; refId = data.ref_id;
  } else if (data.ref_tipo === 'REUNION' && data.ref_id) {
    const reunionRef = buscarReunionProyecto_(db, data.ref_id);
    if (!reunionRef || reunionRef.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('ref_id', 'La reunión indicada no pertenece a este proyecto.');
    refTipo = 'REUNION'; refId = data.ref_id;
  } else if (data.ref_tipo === 'DECISION' && data.ref_id) {
    const decisionRef = buscarDecisionProyecto_(db, data.ref_id);
    if (!decisionRef || decisionRef.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('ref_id', 'La decisión indicada no pertenece a este proyecto.');
    refTipo = 'DECISION'; refId = data.ref_id;
  }

  if (data.documento_id) {
    // Editar METADATA (nombre/categoría/descripción/referencia) -- nunca el
    // archivo desde aquí, eso es subirVersionDocumento (deja traza propia).
    const actual = buscarDocumentoProyecto_(db, data.documento_id);
    if (!actual || actual.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('documento_id', 'Documento no encontrado.');
    const cambios = { ref_tipo: refTipo, ref_id: refId };
    if (data.nombre !== undefined) {
      const nombreEdit = String(data.nombre || '').trim();
      if (!nombreEdit) return errorValidacion_('nombre', 'El nombre del documento es obligatorio.');
      cambios.nombre = nombreEdit;
    }
    if (data.categoria !== undefined) cambios.categoria = PROYECTO_DOC_CATEGORIAS_.indexOf(data.categoria) !== -1 ? data.categoria : 'OTRO';
    if (data.descripcion !== undefined) cambios.descripcion = data.descripcion || '';
    return actualizarFilaPorId_(db, 'PROYECTO_DOCUMENTOS', 'documento_id', data.documento_id, cambios);
  }

  // Crear: exige nombre + primer archivo -- un documento sin ninguna
  // versión no tiene sentido en un repositorio (a diferencia del adjunto
  // suelto de la Sala, este SIEMPRE nace versionado).
  const nombre = String(data.nombre || '').trim();
  if (!nombre) return errorValidacion_('nombre', 'El nombre del documento es obligatorio.');
  if (!data.contenido_base64) return errorValidacion_('contenido_base64', 'Adjunta el archivo del documento.');
  const archivo = await subirArchivoDocumentoProyecto_(proyecto.proyecto_id, data, 'documentos');
  if (archivo._validationError) return archivo;

  const documentoId = uuid_();
  const categoria = PROYECTO_DOC_CATEGORIAS_.indexOf(data.categoria) !== -1 ? data.categoria : 'OTRO';
  const version = 'v1';
  const doc = {
    documento_id: documentoId, proyecto_id: proyecto.proyecto_id, nombre, categoria, descripcion: data.descripcion || '',
    ref_tipo: refTipo, ref_id: refId, version_vigente: version,
    archivo_id: archivo.archivo_id, archivo_nombre: archivo.archivo_nombre, archivo_mime: archivo.archivo_mime, tamano_bytes: archivo.tamano_bytes,
    creado_por: contexto.email || '', fecha_creacion: new Date().toISOString(), activo: true
  };
  agregarFila_(db, 'PROYECTO_DOCUMENTOS', doc);
  registrarVersionDocumentoProyecto_(db, documentoId, version, data.comentario || 'Carga inicial', archivo, contexto);
  registrarEventoProyecto_(db, proyecto.proyecto_id, 'ARCHIVO', contexto, 'Documento: ' + nombre, 'DOCUMENTO', documentoId, '');
  return buscarDocumentoProyecto_(db, documentoId);
}

// Sube una nueva versión de un documento EXISTENTE -- la anterior deja de
// ser vigente pero se conserva completa (nunca se borra, es el historial
// auditable "qué versión regía en qué fecha").
async function subirVersionDocumento(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data && data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  const rol = rolEnProyecto_(db, proyecto.proyecto_id, contexto);
  if (!(contexto.rol === 'ADM' || rol === 'LIDER' || rol === 'INTEGRANTE' || rol === 'COLABORADOR')) {
    return { _forbidden: true, message: 'No puedes subir versiones en este proyecto.' };
  }
  const doc = buscarDocumentoProyecto_(db, data.documento_id);
  if (!doc || doc.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('documento_id', 'Documento no encontrado.');
  if (!data.contenido_base64) return errorValidacion_('contenido_base64', 'Adjunta el archivo de la nueva versión.');
  const archivo = await subirArchivoDocumentoProyecto_(proyecto.proyecto_id, data, 'documentos');
  if (archivo._validationError) return archivo;
  const version = siguienteVersionDocumentoProyecto_(db, doc.documento_id);
  registrarVersionDocumentoProyecto_(db, doc.documento_id, version, data.comentario || '', archivo, contexto);
  registrarEventoProyecto_(db, proyecto.proyecto_id, 'ARCHIVO', contexto, 'Nueva versión (' + version + '): ' + doc.nombre, 'DOCUMENTO', doc.documento_id, '');
  return buscarDocumentoProyecto_(db, doc.documento_id);
}

// "Marcar vigente" (rollback): vuelve a poner una versión ANTERIOR como la
// vigente, sin borrar la que hoy lo es -- para cuando una versión nueva
// resultó ser un error. Exclusivo de quien gestiona el proyecto (no
// cualquier colaborador, a diferencia de subir una versión nueva).
function marcarVersionVigente(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data && data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeGestionarProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'Solo el líder del proyecto o un administrador pueden cambiar la versión vigente.' };
  const doc = buscarDocumentoProyecto_(db, data.documento_id);
  if (!doc || doc.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('documento_id', 'Documento no encontrado.');
  const version = leerSeguro_(db, 'PROYECTO_DOC_VERSIONES').find((v) => v.version_id === data.version_id && v.documento_id === doc.documento_id);
  if (!version) return errorValidacion_('version_id', 'Versión no encontrada.');
  leerSeguro_(db, 'PROYECTO_DOC_VERSIONES').forEach((v) => {
    if (v.documento_id === doc.documento_id) actualizarFilaPorId_(db, 'PROYECTO_DOC_VERSIONES', 'version_id', v.version_id, { vigente: v.version_id === version.version_id });
  });
  actualizarFilaPorId_(db, 'PROYECTO_DOCUMENTOS', 'documento_id', doc.documento_id, {
    version_vigente: version.version, archivo_id: version.archivo_id, archivo_nombre: version.archivo_nombre,
    archivo_mime: version.archivo_mime, tamano_bytes: version.tamano_bytes || 0
  });
  registrarEventoProyecto_(db, proyecto.proyecto_id, 'ARCHIVO', contexto, 'Vigente cambiada a ' + version.version + ': ' + doc.nombre, 'DOCUMENTO', doc.documento_id, '');
  return buscarDocumentoProyecto_(db, doc.documento_id);
}

// Historial completo de un documento -- pedido LAZY (solo cuando alguien
// abre "Ver historial"), igual criterio que la bitácora del Cronograma.
function listarVersionesDocumento(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data && data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeVerProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
  const doc = buscarDocumentoProyecto_(db, data.documento_id);
  if (!doc || doc.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('documento_id', 'Documento no encontrado.');
  return leerSeguro_(db, 'PROYECTO_DOC_VERSIONES').filter((v) => v.documento_id === doc.documento_id)
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

// Sirve una versión puntual (no necesariamente la vigente) -- re-valida el
// acceso al proyecto en cada descarga, mismo criterio que descargarAdjunto.
async function descargarVersionDocumento(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data && data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeVerProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
  const version = leerSeguro_(db, 'PROYECTO_DOC_VERSIONES').find((v) => v.version_id === data.version_id);
  if (!version) return errorValidacion_('version_id', 'Versión no encontrada.');
  const doc = buscarDocumentoProyecto_(db, version.documento_id);
  if (!doc || doc.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('version_id', 'Versión no encontrada en este proyecto.');
  const descarga = await Almacenamiento.descargarArchivo_(version.archivo_id);
  if (!descarga.ok) return errorValidacion_('version_id', descarga.message);
  return { contenido_base64: descarga.contenido_base64, nombre_archivo: version.archivo_nombre, mime: descarga.content_type };
}

// Descarga directa de la versión VIGENTE de un documento -- usa el
// archivo_id ya denormalizado en PROYECTO_DOCUMENTOS, sin tener que
// resolver primero el version_id (eso es lo que hace posible el botón
// "Descargar" de la lista, sin un viaje extra a listarVersionesDocumento).
async function descargarDocumentoProyecto(db, data, contexto) {
  const proyecto = buscarProyecto_(db, data && data.proyecto_id);
  if (!proyecto) return errorValidacion_('proyecto_id', 'Proyecto no encontrado.');
  if (!puedeVerProyecto_(db, proyecto, contexto)) return { _forbidden: true, message: 'No tienes acceso a este proyecto.' };
  const doc = buscarDocumentoProyecto_(db, data.documento_id);
  if (!doc || doc.proyecto_id !== proyecto.proyecto_id) return errorValidacion_('documento_id', 'Documento no encontrado.');
  const descarga = await Almacenamiento.descargarArchivo_(doc.archivo_id);
  if (!descarga.ok) return errorValidacion_('documento_id', descarga.message);
  return { contenido_base64: descarga.contenido_base64, nombre_archivo: doc.archivo_nombre, mime: descarga.content_type };
}

module.exports = {
  listar, listarMisTareas, listarCalendario, getDetalle, getDetalleCompleto, marcarSalaVisitada,
  crear, guardarComoPlantilla, listarPlantillas, actualizar, gestionarIntegrante, gestionarHito,
  crearTarea, editarTarea, listarTareas, listarBitacora, listarMiBitacora,
  listarSala, publicarEnSala, convertirEventoEnTarea,
  gestionarReunion, agregarAcuerdoReunion, eliminarAcuerdoReunion, convertirAcuerdoEnTarea, listarReuniones,
  gestionarDecision, listarDecisiones,
  gestionarEntregable, revisarEntregable, gestionarRiesgo, getResumenPortafolio,
  // Fase H (Camino B): avance físico -- curva S de control manual.
  gestionarControlAvance, listarControlAvance,
  // Incremento 2 (v11 Reingenieria Cronograma).
  guardarRegistroDia, eliminarRegistroDia, obtenerRendimiento, obtenerAnalitica,
  obtenerWorkloadPortafolio, congelarBaseline, reprogramarTarea,
  // Centro documental + adjuntos de Sala (R2, desgateado 2026-09-18).
  subirAdjunto, descargarAdjunto, gestionarDocumento, subirVersionDocumento,
  marcarVersionVigente, listarVersionesDocumento, descargarVersionDocumento, descargarDocumentoProyecto,
  // Exportadas: rolEnProyecto_ es el gate que actividades.js consulta para
  // el acoplamiento (RN-709); el resto queda disponible para tests, nunca
  // duplicadas.
  rolEnProyecto_, puedeVerProyecto_, puedeGestionarProyecto_, buscarProyecto_,
  calcularSaludProyecto_, calcularAvanceProyecto_, calcularCumplimientoTareasProyecto_,
  calcularRutaCritica_, calcularImpactoDependencia_, avanceRealTarea_, esTareaTerminalProyecto_,
  // Fase 2 (evidencia fotografica de Pausas): reusado, no reimplementado.
  detectarMimeImagenProyecto_
};
