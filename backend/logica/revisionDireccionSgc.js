'use strict';

/**
 * revisionDireccionSgc.js — puerto de backend/backoffice/RevisionDireccion.gs
 * (SGC ISO 9001, Fase 5b, PRO-05, §9.3). El registro es el FO-PRO-05-01
 * "Informe de revisión por la gerencia": una reunión anual donde la
 * Dirección revisa el SGC completo. Trece entradas obligatorias (§9.3.2),
 * tres salidas obligatorias (§9.3.3).
 *
 * LO QUE HACE DISTINTA A ESTA FASE: las entradas no se preguntan en blanco.
 * El sistema resuelve solo, con sus propios datos:
 *   Item 1  <- los acuerdos de la revisión anterior y en qué quedaron
 *   Item 7  <- las quejas del período (satisfacción del cliente)
 *   Item 10 <- las no conformidades y sus acciones correctivas
 *   Item 12 <- las auditorías internas del período
 *   Item 13 <- el desempeño de los proveedores externos
 * El resumen no reemplaza el juicio de la Dirección: es el texto inicial
 * del campo Observaciones, editable. El sistema aporta el DATO, la
 * conclusión la escribe quien preside.
 *
 * PENDIENTE EXPLÍCITO, NO FINGIDO: el item 8 (grado de logro de los
 * objetivos de calidad, DOC-07) depende del tablero de Objetivos -- Fase 6a
 * del SGC, todavía no portada a Node en este incremento. Se declara
 * `auto: false, pendiente_fase: 'Fase 6a'` (no se inventa un resumen).
 * Cuando se porte Objetivos, este archivo debe pasar el item 8 a
 * `auto: true` y llamar a su `resumenParaRevision`, igual que hace el .gs.
 *
 * LOS ACUERDOS SON ACTIVIDADES (crearTareaSgc_, compartido con
 * NoConformidades): un acuerdo de directorio que vive solo dentro del acta
 * es un acuerdo que nadie cumple.
 *
 * PLAZO DE CONVOCATORIA EN DÍAS HÁBILES, contado hacia ATRÁS desde la
 * reunión (Utils.restarDiasHabiles_, inverso de sumarDiasHabiles_).
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const { crearTareaSgc_, tareaResumen_ } = require('./noConformidadesSgc');
const Utils = require('./utils');
const Cumplimiento = require('./cumplimiento');
const Notificaciones = require('./notificaciones');
const NotificacionesApp = require('./notificacionesApp');

// Las 13 entradas de §9.3.2, en el orden y con la redacción del
// FO-PRO-05-01. `auto` marca cuáles resuelve el sistema con sus propios
// datos; `pendiente_fase` deja declarado lo que todavía no puede resolver.
const ENTRADAS_REVISION = [
  { numero: 1, titulo: 'El estado de las acciones de las revisiones por la dirección previas', auto: true },
  { numero: 2, titulo: 'Los cambios en las cuestiones externas e internas que sean pertinentes al sistema de gestión de la calidad', auto: false },
  { numero: 3, titulo: 'La adecuación de los recursos', auto: false },
  { numero: 4, titulo: 'La eficacia de las acciones tomadas para abordar los riesgos y las oportunidades', auto: false },
  { numero: 5, titulo: 'Las oportunidades de mejora', auto: false },
  { numero: 6, titulo: 'La información sobre el desempeño y la eficacia del sistema de gestión de la calidad', auto: false },
  { numero: 7, titulo: 'La satisfacción del cliente y la retroalimentación de las partes interesadas pertinentes', auto: true },
  // Se prellenará cuando se porte el tablero de Objetivos (DOC-07, Fase 6a).
  { numero: 8, titulo: 'El grado en que se han logrado los objetivos de la calidad', auto: false, pendiente_fase: 'Fase 6a' },
  { numero: 9, titulo: 'El desempeño de los procesos y conformidad de los productos y servicios', auto: false },
  { numero: 10, titulo: 'Las no conformidades y acciones correctivas', auto: true },
  { numero: 11, titulo: 'Los resultados de seguimiento y medición', auto: false },
  { numero: 12, titulo: 'Los resultados de las auditorías', auto: true },
  { numero: 13, titulo: 'El desempeño de los proveedores externos', auto: true }
];
// Las 3 salidas de §9.3.3, tal como las lista la tabla 3 del formulario.
const TIPOS_ACUERDO_REVISION = [
  { tipo: 'MEJORA', etiqueta: 'Las oportunidades de mejora' },
  { tipo: 'CAMBIO_SGC', etiqueta: 'Cualquier necesidad de cambio en el sistema de gestión de la calidad' },
  { tipo: 'RECURSOS', etiqueta: 'Las necesidades de recursos' }
];
const DIAS_CONVOCATORIA_REVISION = 10; // días HÁBILES (PRO-05 §6)
const MESES_FRECUENCIA_REVISION = 12;

function uuid_() { return crypto.randomUUID(); }
function errorValidacion_(campo, mensaje) { return { _validationError: true, campo, message: mensaje }; }
function normalizarEmail_(email) { return String(email || '').trim().toLowerCase(); }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function esActivo_(fila) { return esVerdadero_(fila.activa); }
function leer_(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function leerSeguro_(db, hoja) { try { return leer_(db, hoja); } catch (err) { return []; } }
function registrarLogSgc_(db, accion, detalle, contexto) {
  try {
    agregarFila_(db, 'LOG_SISTEMA', {
      log_id: uuid_(), timestamp: new Date().toISOString(), contexto: accion,
      mensaje: ((contexto && contexto.email) || '') + ' → ' + detalle, ref: 'SGC'
    });
  } catch (err) { /* trazabilidad, no el flujo principal */ }
}
function encolarAviso_(db, destinatario, titulo, mensaje, vidaHoras) {
  if (!destinatario) return;
  NotificacionesApp.encolarLote(db, [{ destinatario, tipo: 'SGC_REVISION', titulo, mensaje, modulo_id: 'calidad', texto_accion: 'Ver revisiones', vidaHoras: vidaHoras || 72 }]);
}
function encargadosSgc_(db) {
  return leerSeguro_(db, 'SGC_ROLES').filter((r) => esVerdadero_(r.activo) && r.rol_sgc === 'ENCARGADO_SGC').map((r) => normalizarEmail_(r.usuario_email)).filter(Boolean);
}
function obtenerFeriados_(db) { try { return Cumplimiento.obtenerFeriados(db); } catch (err) { return []; } }
function sumarMesesSgc_(fecha, meses) {
  const f = new Date(fecha);
  if (isNaN(f.getTime())) return '';
  const r = new Date(f.getTime());
  r.setMonth(r.getMonth() + meses);
  return r.toISOString();
}
function diasHastaSgc_(fecha, ahora) {
  if (!fecha) return null;
  const f = new Date(fecha);
  if (isNaN(f.getTime())) return null;
  return Math.round((f - (ahora || new Date())) / 86400000);
}

// --- helpers -----------------------------------------------------------------
function buscarRevision_(db, revisionId) {
  if (!revisionId) return null;
  return leerSeguro_(db, 'SGC_REVISIONES').find((r) => r.revision_id === revisionId && esActivo_(r)) || null;
}
function siguienteCorrelativoRevision_(db, fecha) {
  let anio = new Date(fecha).getFullYear();
  if (isNaN(anio)) anio = new Date().getFullYear();
  const delAnio = leerSeguro_(db, 'SGC_REVISIONES').filter((r) => Number(r.anio) === anio).length;
  return 'RD-' + anio + '-' + ('0' + (delAnio + 1)).slice(-2);
}
function etiquetaAcuerdoRevision_(tipo) {
  const t = TIPOS_ACUERDO_REVISION.find((x) => x.tipo === tipo);
  return t ? t.etiqueta : tipo;
}
// Acepta [{nombre, cargo}] o texto "Nombre - Cargo" por línea, que es como
// se copia desde el acta en papel.
function normalizarAsistentes_(valor) {
  let lista = valor;
  if (typeof lista === 'string') {
    lista = lista.split('\n').map((linea) => {
      const partes = String(linea).split(/\s+[-–]\s+/);
      return { nombre: (partes[0] || '').trim(), cargo: (partes[1] || '').trim() };
    });
  }
  if (!Array.isArray(lista)) return [];
  return lista.map((a) => ({ nombre: String((a && a.nombre) || '').trim(), cargo: String((a && a.cargo) || '').trim() })).filter((a) => a.nombre);
}
// Acepta { "1": "texto", ... } o [{item, observaciones}].
function normalizarEntradasRevision_(valor) {
  const salida = {};
  if (!valor) return salida;
  if (Array.isArray(valor)) {
    valor.forEach((e) => { if (e && e.item !== undefined) salida[Number(e.item)] = e.observaciones; });
    return salida;
  }
  Object.keys(valor).forEach((k) => { salida[Number(k)] = valor[k]; });
  return salida;
}
function entradasDeRevision_(revision) {
  const guardadas = {};
  try {
    const parsed = JSON.parse(revision.entradas || '[]');
    if (Array.isArray(parsed)) parsed.forEach((e) => { guardadas[Number(e.item)] = e.observaciones; });
  } catch (err) { /* celda editada a mano: se trata como vacia */ }

  return ENTRADAS_REVISION.map((e) => ({
    numero: e.numero, titulo: e.titulo, auto: !!e.auto, pendiente_fase: e.pendiente_fase || '',
    observaciones: guardadas[e.numero] || ''
  }));
}
function asistentesDeRevision_(revision) {
  try {
    const parsed = JSON.parse(revision.asistentes || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) { return []; }
}
function resumenRevision_(r, acuerdos, ahora) {
  const mios = (acuerdos || []).filter((a) => a.revision_id === r.revision_id);
  const entradas = entradasDeRevision_(r);
  return {
    revision_id: r.revision_id, correlativo: r.correlativo, anio: Number(r.anio) || null,
    fecha_programada: r.fecha_programada, aviso_plazo: r.aviso_plazo, fecha_convocatoria: r.fecha_convocatoria,
    fecha_reunion: r.fecha_reunion, asistentes: asistentesDeRevision_(r), conclusiones: r.conclusiones,
    anexos: r.anexos, director_email: r.director_email, responsable_calidad_email: r.responsable_calidad_email,
    estado: r.estado, fecha_cierre: r.fecha_cierre, total_acuerdos: mios.length,
    entradas_completas: entradas.filter((e) => !!e.observaciones).length, total_entradas: ENTRADAS_REVISION.length,
    // Señal calculada: falta convocar y ya se paso el plazo de 10 dias
    // habiles. No se persiste para que nunca quede desfasada.
    convocatoria_atrasada: r.estado === 'PROGRAMADA' && !!r.aviso_plazo && new Date(r.aviso_plazo) < ahora,
    dias_para_convocar: r.aviso_plazo ? diasHastaSgc_(r.aviso_plazo, ahora) : null
  };
}
// Cuando vencio (o vence) la obligacion de hacer la proxima revision.
function vigenciaRevision_(revisiones, ahora) {
  const cerradas = (revisiones || []).filter((r) => r.estado === 'CERRADA' && r.fecha_reunion)
    .sort((a, b) => new Date(b.fecha_reunion) - new Date(a.fecha_reunion));
  if (!cerradas.length) {
    // Nunca se hizo una: esta vencida por definicion, no "al dia por no
    // tener antecedentes".
    return { vencida: true, ultima_fecha: '', proxima: '', dias_restantes: null };
  }
  const ultima = cerradas[0].fecha_reunion;
  const proxima = sumarMesesSgc_(ultima, MESES_FRECUENCIA_REVISION);
  return { vencida: new Date(proxima) < ahora, ultima_fecha: ultima, proxima, dias_restantes: diasHastaSgc_(proxima, ahora) };
}

/**
 * Arma el texto inicial de las entradas que el sistema puede responder con
 * sus propios datos. Devuelve { numero: texto }. El periodo es el año de la
 * revision: es el corte natural de una revision anual.
 */
function resumenAutomaticoRevision_(db, revision) {
  const anio = Number(revision.anio) || new Date(revision.fecha_programada || Date.now()).getFullYear();
  const desde = new Date(Date.UTC(anio, 0, 1));
  const hasta = new Date(Date.UTC(anio, 11, 31, 23, 59, 59));
  const enPeriodo = (valor) => { const f = new Date(valor); return !isNaN(f.getTime()) && f >= desde && f <= hasta; };

  const resumen = {};

  // Item 1 -- acuerdos de la revision anterior y en que quedaron.
  const previas = leerSeguro_(db, 'SGC_REVISIONES').filter((r) => esActivo_(r) && r.revision_id !== revision.revision_id && r.estado === 'CERRADA')
    .sort((a, b) => new Date(b.fecha_reunion || 0) - new Date(a.fecha_reunion || 0));
  if (!previas.length) {
    resumen[1] = 'Es la primera revisión por la dirección registrada: no hay acuerdos previos que revisar.';
  } else {
    const anterior = previas[0];
    const acuerdosPrevios = leerSeguro_(db, 'SGC_REVISION_ACUERDOS').filter((a) => a.revision_id === anterior.revision_id && esActivo_(a));
    const actividades = leerSeguro_(db, 'ACTIVIDADES');
    let terminados = 0;
    acuerdosPrevios.forEach((a) => {
      const act = actividades.find((x) => x.actividad_id === a.actividad_id);
      if (act && act.estado === 'TERMINADA') terminados++;
    });
    resumen[1] = 'Revisión anterior: ' + anterior.correlativo + ' (' + String(anterior.fecha_reunion || '').slice(0, 10) + '). ' +
      acuerdosPrevios.length + ' acuerdo(s), ' + terminados + ' cumplido(s) y ' + (acuerdosPrevios.length - terminados) + ' pendiente(s).';
  }

  // Item 7 -- satisfaccion del cliente: las quejas del periodo.
  const quejas = leerSeguro_(db, 'SGC_QUEJAS').filter((q) => esVerdadero_(q.activa) && enPeriodo(q.fecha_envio));
  const porTipo = { QUEJA: 0, RECLAMACION: 0, FELICITACION: 0, CONSULTA: 0 };
  let conformes = 0, medidos = 0;
  quejas.forEach((q) => {
    if (porTipo[q.tipo] !== undefined) porTipo[q.tipo]++;
    if (q.cliente_conforme !== '' && q.cliente_conforme !== undefined && q.fecha_seguimiento) {
      medidos++;
      if (esVerdadero_(q.cliente_conforme)) conformes++;
    }
  });
  resumen[7] = quejas.length
    ? 'En ' + anio + ' se recibieron ' + quejas.length + ' mensajes: ' + porTipo.QUEJA + ' quejas, ' + porTipo.RECLAMACION +
      ' reclamaciones, ' + porTipo.FELICITACION + ' felicitaciones y ' + porTipo.CONSULTA + ' consultas. ' +
      (medidos ? 'De los casos con seguimiento cerrado, ' + conformes + ' de ' + medidos + ' clientes quedaron conformes.'
        : 'Todavía no hay seguimientos cerrados que midan conformidad.')
    : 'En ' + anio + ' no se recibieron quejas, felicitaciones ni consultas por el canal formal.';

  // Item 8 -- pendiente hasta que se porte el tablero de Objetivos (Fase 6a).
  // No se calcula aca a propósito (ver nota de cabecera del archivo).

  // Item 10 -- no conformidades y acciones correctivas.
  const ncs = leerSeguro_(db, 'SGC_NC').filter((n) => esVerdadero_(n.activa) && enPeriodo(n.fecha_deteccion || n.fecha_creacion));
  const cerradas = ncs.filter((n) => n.estado === 'CERRADA').length;
  const eficaces = ncs.filter((n) => n.eficacia_resultado === 'EFICAZ').length;
  resumen[10] = ncs.length
    ? 'En ' + anio + ' se levantaron ' + ncs.length + ' no conformidades: ' + cerradas + ' cerradas y ' + (ncs.length - cerradas) +
      ' en curso. ' + eficaces + ' verificaron su acción correctiva como eficaz.'
    : 'En ' + anio + ' no se levantaron no conformidades.';

  // Item 12 -- auditorias internas.
  const auds = leerSeguro_(db, 'SGC_AUDITORIAS').filter((a) => esVerdadero_(a.activa) && (Number(a.anio) === anio || enPeriodo(a.fecha_programada)));
  const ejecutadas = auds.filter((a) => a.fecha_ejecucion).length;
  const hallazgos = leerSeguro_(db, 'SGC_AUD_HALLAZGOS').filter((h) => esVerdadero_(h.activo) && auds.some((a) => a.auditoria_id === h.auditoria_id));
  const noConformes = hallazgos.filter((h) => h.resultado === 'NO_CONFORMIDAD').length;
  resumen[12] = auds.length
    ? 'Programa ' + anio + ': ' + auds.length + ' auditoría(s), ' + ejecutadas + ' ejecutada(s). Se registraron ' +
      hallazgos.length + ' hallazgos, de los cuales ' + noConformes + ' fueron no conformidades.'
    : 'En ' + anio + ' no se registraron auditorías internas en el programa.';

  // Item 13 -- desempeño de proveedores externos (Fase 5a).
  const provs = leerSeguro_(db, 'SGC_PROVEEDORES').filter(esActivo_);
  const aprob = provs.filter((p) => p.estado === 'APROBADO').length;
  const reprob = provs.filter((p) => p.estado === 'REPROBADO').length;
  const sinEval = provs.filter((p) => p.estado === 'SIN_EVALUAR').length;
  resumen[13] = provs.length
    ? provs.length + ' proveedores en el listado: ' + aprob + ' aprobados, ' + reprob + ' reprobados y ' + sinEval + ' sin evaluar.' +
      (reprob ? ' Los reprobados requieren decisión de la Dirección (PRO-04 §6.2).' : '')
    : 'No hay proveedores externos registrados en el listado.';

  return resumen;
}

// ===========================================================================
// API publica
// ===========================================================================

function listar(db, data, contexto) {
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!Calidad.veTodoSgc_(db, contexto, rol, gobierna)) return { _forbidden: true, message: 'No tienes acceso a las revisiones por la dirección.' };

  const ahora = new Date();
  const todas = leerSeguro_(db, 'SGC_REVISIONES').filter(esActivo_);
  const acuerdos = leerSeguro_(db, 'SGC_REVISION_ACUERDOS').filter(esActivo_);

  return {
    puede_gestionar: gobierna, dias_convocatoria: DIAS_CONVOCATORIA_REVISION, meses_frecuencia: MESES_FRECUENCIA_REVISION,
    vigencia: vigenciaRevision_(todas, ahora),
    revisiones: todas.map((r) => resumenRevision_(r, acuerdos, ahora)).sort((a, b) => new Date(b.fecha_programada || 0) - new Date(a.fecha_programada || 0))
  };
}

function getDetalle(db, data, contexto) {
  const revision = buscarRevision_(db, data.revision_id);
  if (!revision) return errorValidacion_('revision_id', 'Revisión no encontrada.');
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!Calidad.veTodoSgc_(db, contexto, rol, gobierna)) return { _forbidden: true, message: 'No tienes acceso a esta revisión.' };

  const acuerdos = leerSeguro_(db, 'SGC_REVISION_ACUERDOS').filter(esActivo_);
  const actividades = leerSeguro_(db, 'ACTIVIDADES');

  return {
    revision: resumenRevision_(revision, acuerdos, new Date()), puede_gestionar: gobierna,
    dias_convocatoria: DIAS_CONVOCATORIA_REVISION,
    catalogo_entradas: ENTRADAS_REVISION, catalogo_acuerdos: TIPOS_ACUERDO_REVISION,
    entradas: entradasDeRevision_(revision),
    acuerdos: acuerdos.filter((a) => a.revision_id === revision.revision_id).map((a) => {
      const act = actividades.find((x) => x.actividad_id === a.actividad_id);
      return {
        acuerdo_id: a.acuerdo_id, tipo: a.tipo, tipo_etiqueta: etiquetaAcuerdoRevision_(a.tipo),
        observaciones: a.observaciones, responsable_email: a.responsable_email, plazo: a.plazo, tarea: tareaResumen_(act)
      };
    })
  };
}

// --- Programar la reunion (§9.3 + PRO-05 §6) ------------------------------
function programar(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden programar la revisión.' };
  const fechaProgramada = String(data.fecha_programada || '').trim();
  if (!fechaProgramada) return errorValidacion_('fecha_programada', 'Indica la fecha de la reunión.');
  const fecha = new Date(fechaProgramada);
  if (isNaN(fecha.getTime())) return errorValidacion_('fecha_programada', 'La fecha de la reunión no es válida.');

  const ahora = new Date();
  const revision = {
    revision_id: uuid_(), correlativo: siguienteCorrelativoRevision_(db, fecha), anio: fecha.getFullYear(),
    fecha_programada: fecha.toISOString(),
    // La fecha limite para avisar: 10 dias habiles ANTES de la reunion.
    aviso_plazo: Utils.restarDiasHabiles_(fecha.toISOString(), DIAS_CONVOCATORIA_REVISION, { feriados: obtenerFeriados_(db), timezone: 'America/Santiago' }),
    fecha_convocatoria: '', fecha_reunion: '', asistentes: JSON.stringify([]), entradas: JSON.stringify([]),
    conclusiones: '', anexos: String(data.anexos || '').trim(),
    director_email: normalizarEmail_(data.director_email || ''),
    responsable_calidad_email: normalizarEmail_(data.responsable_calidad_email || (contexto && contexto.email) || ''),
    estado: 'PROGRAMADA', fecha_cierre: '', cerrada_por: '',
    creada_por: (contexto && contexto.email) || '', fecha_creacion: ahora.toISOString(), activa: true
  };
  agregarFila_(db, 'SGC_REVISIONES', revision);
  registrarLogSgc_(db, 'SGC_REVISION_PROGRAMADA', revision.correlativo, contexto);
  return revision;
}

// --- Convocar: avisar a los asistentes con la agenda ----------------------
async function convocar(db, data, contexto) {
  const revision = buscarRevision_(db, data.revision_id);
  if (!revision) return errorValidacion_('revision_id', 'Revisión no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden convocar.' };
  const asistentes = normalizarAsistentes_(data.asistentes);
  if (!asistentes.length) return errorValidacion_('asistentes', 'Indica al menos un asistente (nombre y cargo).');
  const correos = (data.correos || []).map(normalizarEmail_).filter(Boolean);
  if (!correos.length) return errorValidacion_('correos', 'Indica a qué correos se envía la convocatoria: PRO-05 §6 exige notificar a los asistentes.');

  const ahora = new Date().toISOString();
  // La agenda que se envia son los 13 temas de la norma.
  const agenda = ENTRADAS_REVISION.map((e) => e.numero + '. ' + e.titulo).join('\n');
  const cuerpo = 'Se convoca a la revisión por la dirección del Sistema de Gestión de Calidad.\n\n' +
    'Fecha: ' + String(revision.fecha_programada).slice(0, 10) + '\n' + 'Correlativo: ' + revision.correlativo + '\n\n' +
    'Temas a tratar (ISO 9001 §9.3.2):\n' + agenda;

  for (const email of correos) {
    await Notificaciones.enviarCorreoModulo(db, {
      solicitudId: 'SGC_REVISION_CONVOCATORIA_' + revision.revision_id + ':' + email, destinatario: email,
      evento: 'SGC_REVISION_CONVOCATORIA', asunto: 'SIGSO — Convocatoria: revisión por la dirección ' + revision.correlativo, cuerpo
    });
  }

  const actualizada = actualizarFilaPorId_(db, 'SGC_REVISIONES', 'revision_id', revision.revision_id, {
    asistentes: JSON.stringify(asistentes), fecha_convocatoria: ahora, estado: 'CONVOCADA'
  });
  registrarLogSgc_(db, 'SGC_REVISION_CONVOCADA', revision.correlativo + ' → ' + correos.length + ' asistente(s)', contexto);
  return actualizada;
}

// --- El resumen que el sistema arma solo ---------------------------------
function getResumenAutomatico(db, data, contexto) {
  const revision = buscarRevision_(db, data.revision_id);
  if (!revision) return errorValidacion_('revision_id', 'Revisión no encontrada.');
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!Calidad.veTodoSgc_(db, contexto, rol, gobierna)) return { _forbidden: true, message: 'No tienes acceso a esta revisión.' };
  return { revision_id: revision.revision_id, resumen: resumenAutomaticoRevision_(db, revision) };
}

// --- Registrar el acta (tabla 2 del formulario) --------------------------
function registrarActa(db, data, contexto) {
  const revision = buscarRevision_(db, data.revision_id);
  if (!revision) return errorValidacion_('revision_id', 'Revisión no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar el acta.' };
  if (revision.estado === 'CERRADA') return errorValidacion_('revision_id', 'La revisión ya está cerrada.');

  const fechaReunion = String(data.fecha_reunion || '').trim();
  if (!fechaReunion) return errorValidacion_('fecha_reunion', 'Indica la fecha en que se realizó la reunión.');

  const entradas = normalizarEntradasRevision_(data.entradas);
  // Las 13 entradas son obligatorias por norma. Dejar una en blanco es
  // exactamente el hallazgo que un auditor levanta sobre §9.3.2.
  const vacias = ENTRADAS_REVISION.filter((e) => !String(entradas[e.numero] || '').trim());
  if (vacias.length) {
    return errorValidacion_('entradas', 'Faltan observaciones en ' + vacias.length + ' de los 13 temas obligatorios (§9.3.2). ' +
      'El primero sin completar es el ' + vacias[0].numero + ': ' + vacias[0].titulo);
  }

  const asistentes = normalizarAsistentes_(data.asistentes);
  if (!asistentes.length) return errorValidacion_('asistentes', 'Registra quiénes asistieron (nombre y cargo).');

  const actualizada = actualizarFilaPorId_(db, 'SGC_REVISIONES', 'revision_id', revision.revision_id, {
    fecha_reunion: new Date(fechaReunion).toISOString(), asistentes: JSON.stringify(asistentes),
    entradas: JSON.stringify(ENTRADAS_REVISION.map((e) => ({ item: e.numero, observaciones: String(entradas[e.numero] || '').trim() }))),
    conclusiones: String(data.conclusiones || '').trim(), anexos: String(data.anexos || revision.anexos || '').trim(),
    director_email: normalizarEmail_(data.director_email || revision.director_email || ''), estado: 'REALIZADA'
  });
  registrarLogSgc_(db, 'SGC_REVISION_ACTA', revision.correlativo, contexto);
  return actualizada;
}

// --- Acuerdos: cada uno es una ACTIVIDAD ---------------------------------
async function registrarAcuerdo(db, data, contexto) {
  const revision = buscarRevision_(db, data.revision_id);
  if (!revision) return errorValidacion_('revision_id', 'Revisión no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar acuerdos.' };
  if (TIPOS_ACUERDO_REVISION.map((t) => t.tipo).indexOf(data.tipo) === -1) {
    return errorValidacion_('tipo', 'El acuerdo debe ser de mejora, de cambio en el SGC o de recursos (§9.3.3).');
  }
  const observaciones = String(data.observaciones || '').trim();
  if (observaciones.length < 10) return errorValidacion_('observaciones', 'Describe el acuerdo (mínimo 10 caracteres).');
  const responsable = normalizarEmail_(data.responsable_email || '');
  if (!responsable) return errorValidacion_('responsable_email', 'Indica el responsable: el formulario pide "Responsable actividad" para cada acuerdo.');
  const plazo = String(data.plazo || '').trim();
  if (!plazo) return errorValidacion_('plazo', 'Indica el plazo establecido para el acuerdo.');

  const etiqueta = etiquetaAcuerdoRevision_(data.tipo);
  // La decision central: el acuerdo es una tarea real, con el mismo motor
  // que todo lo demas que la persona tiene que hacer.
  const tarea = await crearTareaSgc_(db, {
    titulo: 'Acuerdo de revisión por la dirección — ' + etiqueta,
    descripcion: observaciones + '\n\n(Acuerdo de la revisión ' + revision.correlativo + ', ISO 9001 §9.3.3.)',
    responsable_email: responsable, fecha_compromiso: new Date(plazo).toISOString(),
    origen_tipo: 'REVISION_ACUERDO', origen_id: revision.revision_id
  }, contexto);
  if (tarea && (tarea._validationError || tarea._forbidden)) return tarea;

  const acuerdo = {
    acuerdo_id: uuid_(), revision_id: revision.revision_id, tipo: data.tipo, observaciones,
    responsable_email: responsable, plazo: new Date(plazo).toISOString(), actividad_id: tarea ? tarea.actividad_id : '',
    creado_por: (contexto && contexto.email) || '', fecha_creacion: new Date().toISOString(), activa: true
  };
  agregarFila_(db, 'SGC_REVISION_ACUERDOS', acuerdo);
  registrarLogSgc_(db, 'SGC_REVISION_ACUERDO', revision.correlativo + ' — ' + etiqueta, contexto);
  return { acuerdo, tarea: tareaResumen_(tarea) };
}

// --- Cierre ---------------------------------------------------------------
function cerrar(db, data, contexto) {
  const revision = buscarRevision_(db, data.revision_id);
  if (!revision) return errorValidacion_('revision_id', 'Revisión no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden cerrar la revisión.' };
  if (revision.estado !== 'REALIZADA') return errorValidacion_('revision_id', 'Primero hay que registrar el acta de la reunión.');
  if (!String(revision.conclusiones || '').trim()) {
    return errorValidacion_('conclusiones', 'PRO-05 §6.2 pide concluir si el SGC es adecuado y eficaz, y si hay recursos para las mejoras.');
  }
  // §9.3.3 exige que la revision produzca decisiones y acciones. Cerrarla
  // sin ningun acuerdo es declarar que no salio nada de una revision anual
  // completa: es justo lo que un auditor cuestiona.
  const acuerdos = leerSeguro_(db, 'SGC_REVISION_ACUERDOS').filter((a) => a.revision_id === revision.revision_id && esActivo_(a));
  if (!acuerdos.length) return errorValidacion_('acuerdos', 'No se puede cerrar sin acuerdos: §9.3.3 exige que la revisión produzca decisiones y acciones.');

  const actualizada = actualizarFilaPorId_(db, 'SGC_REVISIONES', 'revision_id', revision.revision_id, {
    estado: 'CERRADA', fecha_cierre: new Date().toISOString(), cerrada_por: (contexto && contexto.email) || ''
  });
  registrarLogSgc_(db, 'SGC_REVISION_CERRADA', revision.correlativo, contexto);
  return actualizada;
}

function anular(db, data, contexto) {
  const revision = buscarRevision_(db, data.revision_id);
  if (!revision) return errorValidacion_('revision_id', 'Revisión no encontrada.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden anular.' };
  const motivo = String(data.motivo || '').trim();
  if (motivo.length < 10) return errorValidacion_('motivo', 'Explica por qué se anula (mínimo 10 caracteres).');

  const actualizada = actualizarFilaPorId_(db, 'SGC_REVISIONES', 'revision_id', revision.revision_id, { estado: 'ANULADA', activa: false });
  registrarLogSgc_(db, 'SGC_REVISION_ANULADA', revision.correlativo + ' — ' + motivo, contexto);
  return actualizada;
}

// --- avisos diarios -----------------------------------------------------------
async function recordatorioPendientes(db) {
  const ahora = new Date();
  const hoy = ahora.toISOString().slice(0, 10);
  const encargados = encargadosSgc_(db);
  if (!encargados.length) return { avisos: 0 };

  const activas = leerSeguro_(db, 'SGC_REVISIONES').filter(esActivo_);
  let avisos = 0;

  // 1. Convocatoria: hay que avisar 10 dias habiles antes. Se recuerda
  // MIENTRAS todavia se puede cumplir, no cuando ya se paso.
  for (const r of activas) {
    if (r.estado !== 'PROGRAMADA' || !r.aviso_plazo) continue;
    const limite = new Date(r.aviso_plazo);
    if (isNaN(limite.getTime()) || limite > ahora) continue;
    const cuerpo = 'La revisión por la dirección ' + r.correlativo + ' está programada para el ' + String(r.fecha_programada).slice(0, 10) +
      ' y todavía no se ha convocado.\n\nPRO-05 §6 exige avisar a los asistentes con al menos ' + DIAS_CONVOCATORIA_REVISION + ' días hábiles de anticipación.';
    for (const email of encargados) {
      const r2 = await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'SGC_REVISION_CONVOCAR:' + hoy, destinatario: email, evento: 'SGC_REVISION_CONVOCAR', asunto: 'SIGSO — Falta convocar la revisión por la dirección ' + r.correlativo, cuerpo, ventanaMinutos: 24 * 60 });
      if (r2 && r2.enviado) avisos++;
      encolarAviso_(db, email, 'Falta convocar la revisión por la dirección', r.correlativo + ' se realiza el ' + String(r.fecha_programada).slice(0, 10) + '.');
    }
  }

  // 2. Frecuencia: PRO-05 pide una revision al menos cada 12 meses.
  const vig = vigenciaRevision_(activas, ahora);
  if (vig.vencida) {
    const cuerpo = vig.ultima_fecha
      ? 'La última revisión por la dirección fue el ' + String(vig.ultima_fecha).slice(0, 10) + '. PRO-05 §6 pide una al menos cada ' + MESES_FRECUENCIA_REVISION + ' meses.'
      : 'Todavía no se ha registrado ninguna revisión por la dirección. La norma (§9.3) la exige.';
    for (const email of encargados) {
      const r2 = await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'SGC_REVISION_VENCIDA:' + hoy, destinatario: email, evento: 'SGC_REVISION_VENCIDA', asunto: 'SIGSO — Revisión por la dirección pendiente', cuerpo, ventanaMinutos: 24 * 60 });
      if (r2 && r2.enviado) avisos++;
    }
  }

  return {
    avisos, convocatoria_pendiente: activas.filter((r) => r.estado === 'PROGRAMADA' && r.aviso_plazo && new Date(r.aviso_plazo) <= ahora).length,
    frecuencia_vencida: vig.vencida
  };
}

module.exports = {
  listar, getDetalle, programar, convocar, getResumenAutomatico, registrarActa,
  registrarAcuerdo, cerrar, anular, recordatorioPendientes
};
