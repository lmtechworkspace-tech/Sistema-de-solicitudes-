'use strict';

/**
 * objetivosSgc.js — puerto de backend/backoffice/Objetivos.gs (SGC ISO
 * 9001, Fase 6a, DOC-07 "Objetivos de Calidad", §6.2). DOC-07 es una tabla
 * de seis objetivos con indicador, meta, frecuencia y responsable; este
 * módulo la convierte en un tablero vivo: cada objetivo acumula LECTURAS
 * por período, y cada lectura se compara sola contra la meta.
 *
 * Tres decisiones que conviene tener a la vista:
 * 1) Los objetivos viven en una HOJA, no en el código -- los define la
 *    empresa en su DOC-07 y los ajusta, a diferencia de las 13 entradas de
 *    la revisión o las 28 cláusulas ISO, que las define la norma. Se
 *    guardan por AÑO para que subir una meta en 2027 no reescriba contra
 *    qué se midió 2026.
 * 2) Solo el objetivo 4 (horas de formación) se calcula ENTERO hoy. El 2
 *    (reclamos/servicios) es ASISTIDO: el sistema sabe el numerador
 *    (SGC_QUEJAS) pero no el denominador ("total de servicios prestados",
 *    Fase 7). Los demás son MANUAL, declarado explícito, no simulado.
 * 3) Una lectura ya registrada guarda su propio veredicto (`cumple`): se
 *    recalcularía distinto si mañana cambia la meta, y el histórico dejaría
 *    de ser evidencia de lo que se evaluó en su momento.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const Personas = require('./personasSgc');
const NotificacionesApp = require('./notificacionesApp');
const Notificaciones = require('./notificaciones');

// Los seis objetivos tal como están en DOC-07 v01. Es SEMILLA, no catálogo:
// se copian a la hoja al abrir un año y desde ahí se editan.
const OBJETIVOS_DOC07_SEMILLA = [
  {
    numero: 1, objetivo_general: 'Satisfacción del cliente',
    objetivo_especifico: 'Medir la percepción general del cliente sobre el servicio recibido.',
    indicador: 'Calificación de satisfacción en encuesta post-servicio (escala 1-10).',
    meta_texto: '≥ 90% anual, con calificación ≥ nota 8',
    meta_operador: 'MAYOR_IGUAL', meta_valor: 90, unidad: 'PORCENTAJE',
    acciones: 'Aplicar encuesta de satisfacción al cliente. Analizar resultados y definir acciones de mejora.',
    frecuencia: 'ANUAL', frecuencia_texto: 'Anual (post-proyecto)',
    responsable_texto: 'Gerencia / Encargada de Administración', fuente: 'MANUAL', calculo: ''
  },
  {
    numero: 2, objetivo_general: 'Gestión de reclamos',
    objetivo_especifico: 'Reducir la cantidad de reclamos recibidos sobre el total de servicios prestados.',
    indicador: 'N.° de reclamos recibidos / Total de servicios prestados (%).',
    meta_texto: '< 2% de reclamos sobre total de servicios',
    meta_operador: 'MENOR', meta_valor: 2, unidad: 'PORCENTAJE',
    acciones: 'Implementar procedimiento formal de gestión de quejas y reclamos. Hacer seguimiento de cada caso.',
    frecuencia: 'MENSUAL', frecuencia_texto: 'Mensual / Trimestral',
    responsable_texto: 'Encargada de Administración / Enc. de Área', fuente: 'ASISTIDA', calculo: 'RECLAMOS_RECIBIDOS'
  },
  {
    numero: 3, objetivo_general: 'Cumplimiento de plazos de entrega',
    objetivo_especifico: 'Asegurar que los servicios sean entregados dentro de los plazos comprometidos con el cliente.',
    indicador: '% de servicios entregados a tiempo respecto al total comprometido.',
    meta_texto: '≥ 90% de servicios entregados en fecha comprometida',
    meta_operador: 'MAYOR_IGUAL', meta_valor: 90, unidad: 'PORCENTAJE',
    acciones: 'Monitorear fechas de entrega por área. Establecer alertas internas. Gestionar impedimentos de forma proactiva.',
    frecuencia: 'MENSUAL', frecuencia_texto: 'Mensual / Trimestral',
    responsable_texto: 'Encargadas de Área / Gerencia', fuente: 'MANUAL', calculo: ''
  },
  {
    numero: 4, objetivo_general: 'Desarrollo y competencia del personal',
    objetivo_especifico: 'Mejorar las competencias técnicas y metodológicas de los colaboradores.',
    indicador: 'N.° de horas de formación por colaborador al año.',
    meta_texto: '≥ 5 horas de formación por colaborador/año',
    meta_operador: 'MAYOR_IGUAL', meta_valor: 5, unidad: 'HORAS',
    acciones: 'Ejecutar plan anual de capacitaciones. Registrar horas por colaborador. Evaluar impacto en desempeño.',
    frecuencia: 'SEMESTRAL', frecuencia_texto: 'Semestral',
    responsable_texto: 'Gerencia / Encargadas de Área', fuente: 'AUTO', calculo: 'HORAS_FORMACION'
  },
  {
    numero: 5, objetivo_general: 'Crecimiento por nuevos servicios',
    objetivo_especifico: 'Aumentar la contratación de servicios adicionales',
    indicador: 'N° de clientes que contratan servicios nuevos / Total de clientes activos en el periodo (%)',
    meta_texto: '≥ 15% de la cartera activa contrata un nuevo servicio anualmente.',
    meta_operador: 'MAYOR_IGUAL', meta_valor: 15, unidad: 'PORCENTAJE',
    acciones: 'Presentación proactiva de nuevos servicios en reuniones de seguimiento. Envío de reportes con propuestas de mejora u optimización para el cliente.',
    frecuencia: 'SEMESTRAL', frecuencia_texto: 'Semestral',
    responsable_texto: 'Gerencia / Enc. comercial', fuente: 'MANUAL', calculo: ''
  },
  {
    numero: 6, objetivo_general: 'Fidelización de clientes',
    objetivo_especifico: 'Mantener la cartera de clientes activos y reducir la tasa de abandono.',
    indicador: '% de clientes activos retenidos al término del período respecto al inicio.',
    meta_texto: '≥ 70% de clientes activos retenidos anualmente',
    meta_operador: 'MAYOR_IGUAL', meta_valor: 70, unidad: 'PORCENTAJE',
    acciones: 'Contacto periódico con clientes. Mejorar comunicación. Implementar planes de seguimiento y fidelización.',
    frecuencia: 'SEMESTRAL', frecuencia_texto: 'Semestral',
    responsable_texto: 'Gerencia / Encargada de administración', fuente: 'MANUAL', calculo: ''
  }
];

const FRECUENCIAS_OBJETIVO = [
  { clave: 'MENSUAL', etiqueta: 'Mensual', periodos: 12 },
  { clave: 'TRIMESTRAL', etiqueta: 'Trimestral', periodos: 4 },
  { clave: 'SEMESTRAL', etiqueta: 'Semestral', periodos: 2 },
  { clave: 'ANUAL', etiqueta: 'Anual', periodos: 1 }
];
const OPERADORES_META = [
  { clave: 'MAYOR_IGUAL', etiqueta: '≥ (mayor o igual que)' },
  { clave: 'MAYOR', etiqueta: '> (mayor que)' },
  { clave: 'MENOR_IGUAL', etiqueta: '≤ (menor o igual que)' },
  { clave: 'MENOR', etiqueta: '< (menor que)' }
];
const UNIDADES_INDICADOR = [
  { clave: 'PORCENTAJE', etiqueta: '%', sufijo: '%' },
  { clave: 'HORAS', etiqueta: 'horas', sufijo: ' h' },
  { clave: 'NUMERO', etiqueta: 'número', sufijo: '' }
];
const FUENTES_INDICADOR = [
  { clave: 'AUTO', etiqueta: 'Lo calcula el sistema' },
  { clave: 'ASISTIDA', etiqueta: 'El sistema aporta parte del dato' },
  { clave: 'MANUAL', etiqueta: 'Lo registra la persona responsable' }
];
const MESES_SGC = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

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
  NotificacionesApp.encolarLote(db, [{ destinatario, tipo: 'SGC_OBJETIVOS', titulo, mensaje, modulo_id: 'calidad', texto_accion: 'Ver objetivos', vidaHoras: vidaHoras || 72 }]);
}
function encargadosSgc_(db) {
  return leerSeguro_(db, 'SGC_ROLES').filter((r) => esVerdadero_(r.activo) && r.rol_sgc === 'ENCARGADO_SGC').map((r) => normalizarEmail_(r.usuario_email)).filter(Boolean);
}
function esEmailValidoSgc_(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim()); }
function claveDia_(fecha) { return fecha.toISOString().slice(0, 10); }

// --- periodos ----------------------------------------------------------------
// Claves ordenables y sin ambigüedad: '2026-M03', '2026-T2', '2026-S1',
// '2026'. La forma la impone la frecuencia del objetivo.
function periodosDelAnio_(frecuencia, anio) {
  const hoy = new Date();
  const cerrado = (finMes) => hoy >= new Date(Date.UTC(anio, finMes, 1));
  const lista = [];
  if (frecuencia === 'MENSUAL') {
    for (let m = 1; m <= 12; m++) lista.push({ clave: anio + '-M' + ('0' + m).slice(-2), cerrado: cerrado(m) });
  } else if (frecuencia === 'TRIMESTRAL') {
    for (let t = 1; t <= 4; t++) lista.push({ clave: anio + '-T' + t, cerrado: cerrado(t * 3) });
  } else if (frecuencia === 'SEMESTRAL') {
    for (let s = 1; s <= 2; s++) lista.push({ clave: anio + '-S' + s, cerrado: cerrado(s * 6) });
  } else {
    lista.push({ clave: String(anio), cerrado: cerrado(12) });
  }
  return lista.map((p) => ({ clave: p.clave, etiqueta: etiquetaPeriodo_(p.clave), cerrado: p.cerrado }));
}
function etiquetaPeriodo_(clave) {
  const s = String(clave || '');
  let m = s.match(/^(\d{4})-M(\d{2})$/);
  if (m) return MESES_SGC[Number(m[2]) - 1] + ' ' + m[1];
  const t = s.match(/^(\d{4})-T(\d)$/);
  if (t) return 'trimestre ' + t[2] + ' de ' + t[1];
  const e = s.match(/^(\d{4})-S(\d)$/);
  if (e) return (e[2] === '1' ? 'primer' : 'segundo') + ' semestre de ' + e[1];
  return s;
}
// Rango de fechas [desde, hasta] que cubre una clave de periodo, en UTC: las
// claves son días calendario, no instantes.
function rangoDePeriodo_(clave) {
  const s = String(clave || '');
  let m = s.match(/^(\d{4})-M(\d{2})$/);
  if (m) { const a = Number(m[1]), mes = Number(m[2]) - 1; return { desde: new Date(Date.UTC(a, mes, 1)), hasta: new Date(Date.UTC(a, mes + 1, 0, 23, 59, 59)) }; }
  const t = s.match(/^(\d{4})-T(\d)$/);
  if (t) { const a = Number(t[1]), ini = (Number(t[2]) - 1) * 3; return { desde: new Date(Date.UTC(a, ini, 1)), hasta: new Date(Date.UTC(a, ini + 3, 0, 23, 59, 59)) }; }
  const e = s.match(/^(\d{4})-S(\d)$/);
  if (e) { const a = Number(e[1]), ini = (Number(e[2]) - 1) * 6; return { desde: new Date(Date.UTC(a, ini, 1)), hasta: new Date(Date.UTC(a, ini + 6, 0, 23, 59, 59)) }; }
  const anio = Number(s) || new Date().getFullYear();
  return { desde: new Date(Date.UTC(anio, 0, 1)), hasta: new Date(Date.UTC(anio, 11, 31, 23, 59, 59)) };
}
function periodoValido_(periodo, objetivo) {
  return periodosDelAnio_(objetivo.frecuencia, Number(objetivo.anio)).some((p) => p.clave === periodo);
}

// --- calculos automaticos ----------------------------------------------------
// Cada clave sabe calcular su indicador para un periodo. Devuelven siempre
// la misma forma: {fuente, valor, numerador, denominador, detalle, nota,
// completo}. `completo: false` = falta que la persona ponga el resto.
const CALCULOS_INDICADOR_SGC = {
  // Objetivo 4. Horas de formación por colaborador en el AÑO (no en el
  // período): la meta de DOC-07 es anual, así que una lectura semestral
  // informa el acumulado del año a esa fecha.
  HORAS_FORMACION: (db, objetivo) => {
    const anio = Number(objetivo.anio);
    const porPersona = Personas.horasFormacionPorPersonaSgc_(db, anio);
    if (!porPersona.length) {
      return { fuente: 'AUTO', valor: 0, numerador: '', denominador: '', completo: true, detalle: { bajo_meta: [] }, nota: 'No hay personal vigente cargado, así que el promedio de horas es 0.' };
    }
    const total = porPersona.reduce((s, p) => s + p.horas, 0);
    const promedio = Math.round((total / porPersona.length) * 10) / 10;
    const meta = Number(objetivo.meta_valor);
    const bajoMeta = porPersona.filter((p) => p.horas < meta);
    return {
      fuente: 'AUTO', valor: promedio, numerador: total, denominador: porPersona.length, completo: true,
      detalle: { bajo_meta: bajoMeta.map((p) => ({ nombre: p.nombre, horas: p.horas })) },
      nota: 'Promedio de ' + promedio + ' h por colaborador (' + total + ' h entre ' + porPersona.length + ' personas). ' +
        (bajoMeta.length ? bajoMeta.length + ' bajo la meta de ' + meta + ' h.' : 'Todos alcanzan la meta.')
    };
  },
  // Objetivo 2. El sistema sabe el NUMERADOR (reclamos por el canal formal)
  // pero no el denominador ("total de servicios prestados", Fase 7).
  RECLAMOS_RECIBIDOS: (db, objetivo, periodo) => {
    const rango = rangoDePeriodo_(periodo);
    const reclamos = leerSeguro_(db, 'SGC_QUEJAS').filter((q) => {
      if (!esVerdadero_(q.activa)) return false;
      if (q.tipo !== 'QUEJA' && q.tipo !== 'RECLAMACION') return false;
      const f = new Date(q.fecha_envio);
      return !isNaN(f.getTime()) && f >= rango.desde && f <= rango.hasta;
    });
    return {
      fuente: 'ASISTIDA', valor: null, numerador: reclamos.length, denominador: '', completo: false, detalle: null,
      nota: 'En ' + etiquetaPeriodo_(periodo) + ' se recibieron ' + reclamos.length + (reclamos.length === 1 ? ' reclamo' : ' reclamos') +
        ' por el canal formal. Falta el total de servicios prestados en el período (ese dato lo traerá la evidencia de servicios); al escribirlo se calcula el porcentaje.'
    };
  }
};
function calcularIndicador_(db, objetivo, periodo) {
  const calculo = CALCULOS_INDICADOR_SGC[objetivo.calculo];
  if (!calculo) {
    return { fuente: 'MANUAL', valor: null, numerador: '', denominador: '', completo: false, detalle: null, nota: 'Este indicador se registra a mano: el sistema todavía no tiene la fuente de datos que lo alimenta.' };
  }
  return calculo(db, objetivo, periodo);
}

// --- helpers -----------------------------------------------------------------
function buscarObjetivo_(db, objetivoId) {
  if (!objetivoId) return null;
  return leerSeguro_(db, 'SGC_OBJETIVOS').find((o) => o.objetivo_id === objetivoId && esActivo_(o)) || null;
}
function objetivosDelAnio_(db, anio) {
  return leerSeguro_(db, 'SGC_OBJETIVOS').filter((o) => esActivo_(o) && Number(o.anio) === Number(anio)).sort((a, b) => Number(a.numero) - Number(b.numero));
}
function aniosConObjetivos_(db) {
  const vistos = {};
  leerSeguro_(db, 'SGC_OBJETIVOS').forEach((o) => { if (esActivo_(o)) vistos[Number(o.anio)] = true; });
  return Object.keys(vistos).map(Number).sort((a, b) => b - a);
}
function lecturasDeObjetivo_(objetivo, lecturas) {
  return lecturas.filter((l) => l.objetivo_id === objetivo.objetivo_id).sort((a, b) => String(a.periodo).localeCompare(String(b.periodo)));
}
// Compara el valor contra la meta según el operador. Es la única función
// que decide si un objetivo se cumple.
function cumpleMeta_(valor, objetivo) {
  const meta = Number(objetivo.meta_valor);
  const v = Number(valor);
  if (!isFinite(meta) || !isFinite(v)) return false;
  switch (objetivo.meta_operador) {
    case 'MAYOR_IGUAL': return v >= meta;
    case 'MAYOR': return v > meta;
    case 'MENOR_IGUAL': return v <= meta;
    case 'MENOR': return v < meta;
    default: return false;
  }
}
function resumenObjetivo_(o, lecturas) {
  const propias = lecturasDeObjetivo_(o, lecturas);
  const ultima = propias.length ? propias[propias.length - 1] : null;
  const periodos = periodosDelAnio_(o.frecuencia, Number(o.anio));
  const cerrados = periodos.filter((p) => p.cerrado);
  const medidos = cerrados.filter((p) => propias.some((l) => l.periodo === p.clave));
  return {
    objetivo_id: o.objetivo_id, anio: Number(o.anio), numero: Number(o.numero),
    objetivo_general: o.objetivo_general, objetivo_especifico: o.objetivo_especifico, indicador: o.indicador,
    meta_texto: o.meta_texto, meta_operador: o.meta_operador, meta_valor: Number(o.meta_valor), unidad: o.unidad,
    acciones: o.acciones, frecuencia: o.frecuencia, frecuencia_texto: o.frecuencia_texto,
    responsable_texto: o.responsable_texto, responsable_email: o.responsable_email, fuente: o.fuente, calculo: o.calculo,
    total_periodos: periodos.length, periodos_cerrados: cerrados.length, periodos_medidos: medidos.length,
    // Señal accionable: no es lo mismo "no cumple" que "nadie lo midió".
    lecturas_pendientes: cerrados.length - medidos.length,
    ultima_lectura: ultima ? {
      periodo: ultima.periodo, periodo_etiqueta: etiquetaPeriodo_(ultima.periodo), valor: Number(ultima.valor),
      cumple: esVerdadero_(ultima.cumple), fecha_registro: ultima.fecha_registro
    } : null,
    tendencia: propias.slice(-6).map((l) => ({ periodo: l.periodo, valor: Number(l.valor), cumple: esVerdadero_(l.cumple) }))
  };
}
function indicadoresTablero_(filas) {
  const ind = { total: filas.length, cumplen: 0, no_cumplen: 0, sin_medir: 0, lecturas_pendientes: 0 };
  filas.forEach((f) => {
    if (!f.ultima_lectura) ind.sin_medir++;
    else if (f.ultima_lectura.cumple) ind.cumplen++;
    else ind.no_cumplen++;
    ind.lecturas_pendientes += f.lecturas_pendientes;
  });
  return ind;
}
function parsearDetalleLectura_(valor) {
  if (!valor) return null;
  try { return JSON.parse(valor); } catch (err) { return null; }
}
function operadorValido_(clave) { return OPERADORES_META.some((o) => o.clave === clave); }
function frecuenciaValida_(clave) { return FRECUENCIAS_OBJETIVO.some((f) => f.clave === clave); }
function unidadValida_(clave) { return UNIDADES_INDICADOR.some((u) => u.clave === clave); }

async function avisarObjetivoIncumplido_(db, objetivo, lectura, contexto) {
  const sufijo = objetivo.unidad === 'PORCENTAJE' ? '%' : (objetivo.unidad === 'HORAS' ? ' h' : '');
  const asunto = 'SIGSO — Objetivo de calidad sin cumplir: ' + objetivo.objetivo_general;
  const cuerpo = objetivo.objetivo_general + ' midió ' + lectura.valor + sufijo + ' en ' + etiquetaPeriodo_(lectura.periodo) +
    ', contra una meta de ' + objetivo.meta_texto + '.\n\nIndicador: ' + objetivo.indicador + '\nResponsable: ' + (objetivo.responsable_texto || '—') +
    '\n\nUn objetivo que no se alcanza es entrada obligatoria de la revisión por la dirección (§9.3.2 e).';

  for (const email of encargadosSgc_(db)) {
    await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'SGC_OBJETIVO_INCUMPLIDO_' + lectura.lectura_id, destinatario: email, evento: 'SGC_OBJETIVO_INCUMPLIDO', asunto, cuerpo });
    encolarAviso_(db, email, 'Objetivo sin cumplir', objetivo.objetivo_general + ' midió ' + lectura.valor + sufijo + ' (meta: ' + objetivo.meta_texto + ').');
  }
}

// ===========================================================================
// API publica
// ===========================================================================

function listar(db, data, contexto) {
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!Calidad.veTodoSgc_(db, contexto, rol, gobierna)) return { _forbidden: true, message: 'No tienes acceso al tablero de objetivos de calidad.' };

  const anio = Number(data && data.anio) || new Date().getFullYear();
  const objetivos = objetivosDelAnio_(db, anio);
  const lecturas = leerSeguro_(db, 'SGC_INDICADOR_LECTURAS').filter(esActivo_);
  const filas = objetivos.map((o) => resumenObjetivo_(o, lecturas));

  return {
    anio, puede_gestionar: gobierna, anios_disponibles: aniosConObjetivos_(db), sembrado: objetivos.length > 0,
    catalogos: { frecuencias: FRECUENCIAS_OBJETIVO, operadores: OPERADORES_META, unidades: UNIDADES_INDICADOR, fuentes: FUENTES_INDICADOR },
    indicadores: indicadoresTablero_(filas), objetivos: filas
  };
}

function getDetalle(db, data, contexto) {
  const objetivo = buscarObjetivo_(db, data && data.objetivo_id);
  if (!objetivo) return errorValidacion_('objetivo_id', 'Objetivo no encontrado.');
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!Calidad.veTodoSgc_(db, contexto, rol, gobierna)) return { _forbidden: true, message: 'No tienes acceso a este objetivo.' };

  const lecturas = leerSeguro_(db, 'SGC_INDICADOR_LECTURAS').filter(esActivo_);
  return {
    objetivo: resumenObjetivo_(objetivo, lecturas), puede_gestionar: gobierna,
    periodos: periodosDelAnio_(objetivo.frecuencia, Number(objetivo.anio)),
    lecturas: lecturasDeObjetivo_(objetivo, lecturas).map((l) => ({
      lectura_id: l.lectura_id, periodo: l.periodo, periodo_etiqueta: etiquetaPeriodo_(l.periodo), valor: Number(l.valor),
      numerador: l.numerador === '' ? null : Number(l.numerador), denominador: l.denominador === '' ? null : Number(l.denominador),
      cumple: esVerdadero_(l.cumple), origen: l.origen, detalle: parsearDetalleLectura_(l.detalle), observaciones: l.observaciones,
      registrado_por: l.registrado_por, fecha_registro: l.fecha_registro
    }))
  };
}

// --- Abrir el año --------------------------------------------------------
function sembrarAnio(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden abrir el año de objetivos.' };
  const anio = Number(data && data.anio);
  if (!anio || anio < 2000 || anio > 2200) return errorValidacion_('anio', 'Indica un año válido.');
  if (objetivosDelAnio_(db, anio).length) return errorValidacion_('anio', 'El año ' + anio + ' ya tiene objetivos cargados.');

  // Si el año anterior existe, se copia DE AHI: conserva los ajustes que la
  // empresa ya hizo en vez de devolverlos a la semilla original de DOC-07.
  const base = objetivosDelAnio_(db, anio - 1);
  const origen = base.length ? 'AÑO_ANTERIOR' : 'DOC-07';
  const plantilla = base.length ? base.map((o) => ({
    numero: Number(o.numero), objetivo_general: o.objetivo_general, objetivo_especifico: o.objetivo_especifico,
    indicador: o.indicador, meta_texto: o.meta_texto, meta_operador: o.meta_operador, meta_valor: Number(o.meta_valor), unidad: o.unidad,
    acciones: o.acciones, frecuencia: o.frecuencia, frecuencia_texto: o.frecuencia_texto,
    responsable_texto: o.responsable_texto, responsable_email: o.responsable_email, fuente: o.fuente, calculo: o.calculo
  })) : OBJETIVOS_DOC07_SEMILLA;

  const ahora = new Date().toISOString();
  const email = (contexto && contexto.email) || '';
  plantilla.forEach((p) => {
    agregarFila_(db, 'SGC_OBJETIVOS', {
      objetivo_id: uuid_(), anio, numero: p.numero, objetivo_general: p.objetivo_general, objetivo_especifico: p.objetivo_especifico,
      indicador: p.indicador, meta_texto: p.meta_texto, meta_operador: p.meta_operador, meta_valor: p.meta_valor, unidad: p.unidad,
      acciones: p.acciones, frecuencia: p.frecuencia, frecuencia_texto: p.frecuencia_texto,
      responsable_texto: p.responsable_texto, responsable_email: p.responsable_email || '', fuente: p.fuente, calculo: p.calculo,
      creado_por: email, fecha_creacion: ahora, activa: true
    });
  });

  registrarLogSgc_(db, 'SGC_OBJETIVOS_ANIO_ABIERTO', anio + ' (' + origen + ')', contexto);
  return { ok: true, anio, creados: plantilla.length, origen };
}

// --- Edicion del objetivo ------------------------------------------------
function guardar(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden editar los objetivos.' };
  const objetivo = buscarObjetivo_(db, data && data.objetivo_id);
  if (!objetivo) return errorValidacion_('objetivo_id', 'Objetivo no encontrado.');

  const indicador = String(data.indicador || '').trim();
  if (!indicador) return errorValidacion_('indicador', 'El indicador es obligatorio: sin él el objetivo no es medible (§6.2).');
  const metaValor = Number(data.meta_valor);
  if (!isFinite(metaValor)) return errorValidacion_('meta_valor', 'La meta tiene que ser un número para poder compararla.');
  if (!operadorValido_(data.meta_operador)) return errorValidacion_('meta_operador', 'Operador de meta desconocido.');
  if (!frecuenciaValida_(data.frecuencia)) return errorValidacion_('frecuencia', 'Frecuencia de seguimiento desconocida.');
  const email = String(data.responsable_email || '').trim();
  if (email && !esEmailValidoSgc_(email)) return errorValidacion_('responsable_email', 'El correo del responsable no es válido.');

  // La fuente y el cálculo NO se editan desde la pantalla: dependen de qué
  // datos existen en el sistema, no de una preferencia.
  const campos = {
    objetivo_general: String(data.objetivo_general || '').trim(), objetivo_especifico: String(data.objetivo_especifico || '').trim(),
    indicador, meta_texto: String(data.meta_texto || '').trim(), meta_operador: data.meta_operador, meta_valor: metaValor,
    unidad: unidadValida_(data.unidad) ? data.unidad : 'PORCENTAJE', acciones: String(data.acciones || '').trim(),
    frecuencia: data.frecuencia, frecuencia_texto: String(data.frecuencia_texto || '').trim(),
    responsable_texto: String(data.responsable_texto || '').trim(), responsable_email: email
  };

  const ok = actualizarFilaPorId_(db, 'SGC_OBJETIVOS', 'objetivo_id', objetivo.objetivo_id, campos);
  registrarLogSgc_(db, 'SGC_OBJETIVO_EDITADO', objetivo.anio + '/' + objetivo.numero, contexto);
  return ok;
}

// --- Lecturas ------------------------------------------------------------
function sugerirLectura(db, data, contexto) {
  const objetivo = buscarObjetivo_(db, data && data.objetivo_id);
  if (!objetivo) return errorValidacion_('objetivo_id', 'Objetivo no encontrado.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar lecturas.' };
  const periodo = String((data && data.periodo) || '').trim();
  if (!periodoValido_(periodo, objetivo)) return errorValidacion_('periodo', 'El período no corresponde a la frecuencia de este objetivo.');
  return calcularIndicador_(db, objetivo, periodo);
}

async function registrarLectura(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden registrar lecturas.' };
  const objetivo = buscarObjetivo_(db, data && data.objetivo_id);
  if (!objetivo) return errorValidacion_('objetivo_id', 'Objetivo no encontrado.');

  const periodo = String(data.periodo || '').trim();
  if (!periodoValido_(periodo, objetivo)) return errorValidacion_('periodo', 'El período no corresponde a la frecuencia de este objetivo.');

  const valor = Number(data.valor);
  if (!isFinite(valor)) return errorValidacion_('valor', 'El valor medido es obligatorio y tiene que ser un número.');
  if (objetivo.unidad === 'PORCENTAJE' && (valor < 0 || valor > 100)) return errorValidacion_('valor', 'Un porcentaje va entre 0 y 100.');
  if (valor < 0) return errorValidacion_('valor', 'El valor no puede ser negativo.');

  const numerador = data.numerador === '' || data.numerador === undefined || data.numerador === null ? '' : Number(data.numerador);
  const denominador = data.denominador === '' || data.denominador === undefined || data.denominador === null ? '' : Number(data.denominador);
  if (denominador !== '' && denominador <= 0) return errorValidacion_('denominador', 'El denominador tiene que ser mayor que cero.');

  // Una lectura por (objetivo, periodo): volver a medir el mismo mes
  // reemplaza, no acumula. Se conserva la anterior como anulada.
  const previa = leerSeguro_(db, 'SGC_INDICADOR_LECTURAS').find((l) => esActivo_(l) && l.objetivo_id === objetivo.objetivo_id && l.periodo === periodo);
  if (previa) actualizarFilaPorId_(db, 'SGC_INDICADOR_LECTURAS', 'lectura_id', previa.lectura_id, { activa: false });

  const lectura = {
    lectura_id: uuid_(), objetivo_id: objetivo.objetivo_id, indicador_id: '', anio: Number(objetivo.anio), periodo, valor,
    numerador, denominador, cumple: cumpleMeta_(valor, objetivo), origen: data.origen === 'AUTO' ? 'AUTO' : 'MANUAL',
    detalle: data.detalle ? JSON.stringify(data.detalle) : '', observaciones: String(data.observaciones || '').trim(),
    registrado_por: (contexto && contexto.email) || '', fecha_registro: new Date().toISOString(), activa: true
  };
  agregarFila_(db, 'SGC_INDICADOR_LECTURAS', lectura);
  registrarLogSgc_(db, 'SGC_LECTURA_REGISTRADA', objetivo.objetivo_general + ' ' + periodo + ': ' + valor, contexto);

  // Un objetivo que no cumple es justamente lo que §9.3.2 quiere que la
  // Dirección vea. Se avisa al momento, no recién en la revisión anual.
  if (!lectura.cumple) await avisarObjetivoIncumplido_(db, objetivo, lectura, contexto);

  return { ok: true, lectura_id: lectura.lectura_id, cumple: lectura.cumple, reemplazo: !!previa };
}

function anularLectura(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden anular lecturas.' };
  const motivo = String((data && data.motivo) || '').trim();
  if (!motivo) return errorValidacion_('motivo', 'Indica por qué se anula la lectura.');
  const lectura = leerSeguro_(db, 'SGC_INDICADOR_LECTURAS').find((l) => l.lectura_id === (data && data.lectura_id) && esActivo_(l));
  if (!lectura) return errorValidacion_('lectura_id', 'Lectura no encontrada.');

  actualizarFilaPorId_(db, 'SGC_INDICADOR_LECTURAS', 'lectura_id', lectura.lectura_id, {
    activa: false, observaciones: String(lectura.observaciones || '') + ' [ANULADA: ' + motivo + ']'
  });
  registrarLogSgc_(db, 'SGC_LECTURA_ANULADA', lectura.periodo + ' — ' + motivo, contexto);
  return { ok: true };
}

// --- Aviso de lectura pendiente ------------------------------------------
// Un objetivo cuyo período ya cerró y sigue sin medirse es un
// incumplimiento de §9.1.1: la organización tiene que "evaluar el
// desempeño", y no medir es no evaluar.
async function alertarLecturasPendientes(db) {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const objetivos = objetivosDelAnio_(db, anio);
  if (!objetivos.length) return [];

  const lecturas = leerSeguro_(db, 'SGC_INDICADOR_LECTURAS').filter(esActivo_);
  const pendientes = [];
  objetivos.forEach((o) => {
    periodosDelAnio_(o.frecuencia, anio).forEach((p) => {
      if (!p.cerrado) return; // el periodo en curso todavia no se puede medir
      const medido = lecturas.some((l) => l.objetivo_id === o.objetivo_id && l.periodo === p.clave);
      if (!medido) pendientes.push({ objetivo: o, periodo: p });
    });
  });
  if (!pendientes.length) return [];

  const lineas = pendientes.map((x) => '- ' + x.objetivo.objetivo_general + ' (' + etiquetaPeriodo_(x.periodo.clave) + ')').join('\n');
  const asunto = 'SIGSO — Objetivos de calidad: ' + pendientes.length + (pendientes.length === 1 ? ' lectura pendiente' : ' lecturas pendientes');
  const cuerpo = 'Hay períodos ya cerrados sin su lectura registrada:\n\n' + lineas + '\n\nMedir cada objetivo en su frecuencia es lo que sostiene el seguimiento de §9.1.1.';
  const claveDia = claveDia_(hoy);

  const resultados = [];
  for (const email of encargadosSgc_(db)) {
    encolarAviso_(db, email, 'Lecturas de objetivos pendientes', pendientes.length + (pendientes.length === 1 ? ' período cerrado sin medir.' : ' períodos cerrados sin medir.'));
    resultados.push(await Notificaciones.enviarCorreoModulo(db, { solicitudId: 'SGC_OBJETIVOS_PENDIENTES_' + claveDia, destinatario: email, evento: 'SGC_OBJETIVOS_PENDIENTES', asunto, cuerpo, ventanaMinutos: 24 * 60 }));
  }
  return resultados;
}

// --- Entrada 8 de la revision por la direccion (Fase 5b) -----------------
// Devuelve el texto que prellena el item 8 del acta. Vive acá y no en
// revisionDireccionSgc.js por la misma razón que los demás resúmenes: el
// que sabe leer un objetivo es este módulo.
function resumenParaRevision(db, anio) {
  const objetivos = objetivosDelAnio_(db, anio);
  if (!objetivos.length) {
    return 'No hay objetivos de calidad cargados para ' + anio + ' en el tablero (DOC-07), así que no es posible informar su grado de logro.';
  }
  const lecturas = leerSeguro_(db, 'SGC_INDICADOR_LECTURAS').filter(esActivo_);
  let conLectura = 0, cumplen = 0;
  const sinMedir = [];
  objetivos.forEach((o) => {
    const r = resumenObjetivo_(o, lecturas);
    if (r.ultima_lectura) {
      conLectura++;
      if (r.ultima_lectura.cumple) cumplen++;
    } else {
      sinMedir.push(o.objetivo_general);
    }
  });

  return 'DOC-07 define ' + objetivos.length + ' objetivos de calidad para ' + anio + '. ' +
    (conLectura ? conLectura + ' tienen medición registrada, y de esos ' + cumplen + ' alcanzan su meta.' : 'Ninguno tiene mediciones registradas todavía.') +
    (sinMedir.length ? ' Sin medir: ' + sinMedir.join(', ') + '.' : '');
}

module.exports = {
  listar, getDetalle, sembrarAnio, guardar, sugerirLectura, registrarLectura, anularLectura,
  alertarLecturasPendientes,
  // Consumido por revisionDireccionSgc.js (Fase 5b, ítem 8 del acta).
  resumenParaRevision,
  // Catálogos y helpers de evaluación/periodos consumidos por
  // indicadoresSgc.js (v11 Fase 6, §9.1.1): un indicador de proceso comparte
  // el mismo modelo meta/tolerancia/frecuencia que un objetivo, y nunca se
  // duplica.
  FRECUENCIAS_OBJETIVO, OPERADORES_META, UNIDADES_INDICADOR, FUENTES_INDICADOR,
  periodosDelAnio_, etiquetaPeriodo_, cumpleMeta_, operadorValido_, frecuenciaValida_, unidadValida_
};
