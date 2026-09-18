'use strict';

/**
 * riesgosSgc.js — puerto de backend/backoffice/Riesgos.gs (SGC ISO 9001,
 * v11.0 Fase 3, §6.1: riesgos y oportunidades). El DOC-08 es el documento
 * que más gana al digitalizarse: no es una lista, es un modelo de
 * valoración numérico completo -- probabilidad x impacto = magnitud, con
 * bandas definidas, y una SEGUNDA pasada de revaloración tras los controles.
 *
 * Cuatro decisiones (idénticas al .gs):
 * 1) La magnitud y su banda NO se guardan, se CALCULAN. En el DOC-08
 *    original 7 de las 32 valoraciones no coinciden con su propia tabla de
 *    criterios (la más clara: 0,1 x 10 = 1, que es "Bajo", rotulado
 *    "Moderado"). Calculándolas deja de ser posible que discrepen.
 * 2) En una OPORTUNIDAD una magnitud alta es BUENA y la revaloración
 *    debería SUBIR, no bajar -- el tono del semáforo se invierte.
 * 3) La acción de tratamiento es una ACTIVIDAD del motor v7.0, mismo
 *    eslabón que las correcciones de NC y los acuerdos de revisión.
 * 4) Un riesgo se enlaza al FACTOR DEL FODA que lo origina (7 de los 11 del
 *    DOC-08 son literalmente debilidades/amenazas del DOC-02).
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const Contexto = require('./contextoSgc');
const { crearTareaSgc_, tareaResumen_ } = require('./noConformidadesSgc');

// Escalas del DOC-08, hoja "Valoración". Son de la empresa, no propuestas
// por el sistema.
const PROBABILIDAD_RIESGO = [
  { valor: 0.1, etiqueta: 'Baja', detalle: 'Frecuencia del evento como máximo 1 vez al año' },
  { valor: 0.5, etiqueta: 'Media', detalle: 'Frecuencia del evento como máximo 2 a 3 veces al año (meses no seguidos)' },
  { valor: 1.0, etiqueta: 'Alta', detalle: 'Frecuencia del evento a lo menos 3 a 5 veces y 2 meses seguidos' }
];
const IMPACTO_RIESGO = [
  { valor: 1, etiqueta: 'Insignificante' }, { valor: 5, etiqueta: 'Bajo' }, { valor: 10, etiqueta: 'Moderado' },
  { valor: 25, etiqueta: 'Alto' }, { valor: 50, etiqueta: 'Crítico' }
];
// Bandas con el límite INFERIOR inclusivo -- así está escrito en la tabla
// de criterios del DOC-08 ("Alto: 10 ≤ X > 25"). Varias filas del
// documento no siguen su propia tabla en los bordes; manda la tabla.
const BANDAS_MAGNITUD = [
  { hasta: 0.5, etiqueta: 'Insignificante', tono: 'neutro' },
  { hasta: 2.5, etiqueta: 'Bajo', tono: 'ok' },
  { hasta: 10, etiqueta: 'Moderado', tono: 'info' },
  { hasta: 25, etiqueta: 'Alto', tono: 'alerta' },
  { hasta: Infinity, etiqueta: 'Crítico', tono: 'critico' }
];
// Misma frecuencia anual que el contexto, para que el ciclo del SGC sea uno solo.
const MESES_REVISION_RIESGOS = 12;

// Los 11 riesgos del DOC-08, transcritos. factor_foda es el código del
// factor del DOC-02 que origina el riesgo; NO se transcribe magnitud ni
// banda, se calculan.
const RIESGOS_PROPUESTOS_DOC08 = [
  { clase: 'RIESGO', codigo: 'R1', factor_foda: 'D1', relacion_actividad: 'Gestión de Procesos', factor: 'Ausencia de indicadores de gestión (KPIs)', descripcion: 'No se han establecido, definido e implementado indicadores de gestión (KPI) en todas las áreas', analisis_causa: 'Falta de estandarización en la medición de la gestión por área; no existen tableros de control formalizados', procedencia: 'Factores internos: Falta de indicadores de gestión formalizados', origen: 'INTERNO', probabilidad: 0.5, impacto: 10, accion: 'Definir e implementar KPIs por área alineados a los objetivos de calidad del SGC', fecha_implementacion: 'Agosto 2026', medidas_control: 'Tableros de control por área, revisión mensual de indicadores, integración con objetivos DOC-07', probabilidad_residual: 0.1, impacto_residual: 10 },
  { clase: 'RIESGO', codigo: 'R2', factor_foda: 'D2', relacion_actividad: 'Gestión de RRHH', factor: 'Ausencia de evaluaciones de desempeño', descripcion: 'No se han implementado evaluaciones de desempeño en todas las áreas', analisis_causa: 'Falta de instrumentos formales de evaluación del personal; no existe periodicidad definida', procedencia: 'Factores internos: Falta de procedimiento de evaluación del personal', origen: 'INTERNO', probabilidad: 0.5, impacto: 10, accion: 'Implementar formulario de monitoreo de competencias (FO-PRO-02-04) para los 14 trabajadores bajo alcance del SGC', fecha_implementacion: 'Agosto 2026', medidas_control: 'Evaluación anual por cargo según descriptor (escala 1-4), resultado alimenta programa de capacitación', probabilidad_residual: 0.1, impacto_residual: 10 },
  { clase: 'RIESGO', codigo: 'R3', factor_foda: 'D3', relacion_actividad: 'Gestión Comercial', factor: 'Falta de contratos formales con clientes', descripcion: 'Falta de contratos formales con clientes (acuerdos actuales son verbales o por correo)', analisis_causa: 'Informalidad en la relación comercial; acuerdos de servicio no documentados contractualmente', procedencia: 'Factores internos: Ausencia de formalización contractual', origen: 'INTERNO', probabilidad: 1.0, impacto: 25, accion: 'Elaborar modelo de contrato estándar de prestación de servicios y formalizar relación con clientes activos', fecha_implementacion: 'Septiembre 2026', medidas_control: 'Contrato estándar aprobado por gerencia, registro de contratos firmados, seguimiento de vigencia', probabilidad_residual: 0.5, impacto_residual: 10 },
  { clase: 'RIESGO', codigo: 'R4', factor_foda: 'D4', relacion_actividad: 'Gestión Comercial', factor: 'Ausencia de plan de fidelización', descripcion: 'No existe plan de fidelización con los clientes', analisis_causa: 'Falta de estrategia de retención; no se monitorea la satisfacción de forma sistemática', procedencia: 'Factores internos: Falta de estrategia comercial de retención', origen: 'INTERNO', probabilidad: 0.5, impacto: 25, accion: 'Diseñar e implementar plan de fidelización alineado al objetivo de calidad de retención (≥70%)', fecha_implementacion: 'Septiembre 2026', medidas_control: 'Encuesta de satisfacción post-servicio, seguimiento de retención semestral, acciones correctivas ante reclamos', probabilidad_residual: 0.1, impacto_residual: 25 },
  { clase: 'RIESGO', codigo: 'R5', factor_foda: 'D5', relacion_actividad: 'Gestión Documental', factor: 'Documentación dispersa en múltiples canales', descripcion: 'Documentación dispersa en múltiples canales (Drive, correo, Intranet), riesgo de extravío', analisis_causa: 'Ausencia de repositorio centralizado; múltiples plataformas sin estructura unificada de almacenamiento', procedencia: 'Factores internos: Falta de control documental centralizado', origen: 'INTERNO', probabilidad: 1.0, impacto: 10, accion: 'Implementar procedimiento de control de documentos del SGC con repositorio centralizado en Drive', fecha_implementacion: 'Agosto 2026', medidas_control: 'Procedimiento de Control de Documentos, codificación DOC/PRO/FO/INS, listado maestro actualizado', probabilidad_residual: 0.1, impacto_residual: 10 },
  { clase: 'RIESGO', codigo: 'R6', factor_foda: 'D6', relacion_actividad: 'Gestión de Procesos', factor: 'Procesos internos sin estandarización completa', descripcion: 'Procesos internos que carecen de estandarización completa, afectando la eficiencia', analisis_causa: 'Falta de procedimientos documentados e instructivos técnicos en las áreas operativas', procedencia: 'Factores internos: Falta de documentación y estandarización de procesos', origen: 'INTERNO', probabilidad: 0.5, impacto: 25, accion: 'Levantar instructivos técnicos (INS-01, INS-02, etc.) para servicios de RRHH, Contabilidad y Prevención', fecha_implementacion: 'Agosto 2026', medidas_control: 'Instructivos documentados por área, mapa de procesos (DOC-03), revisión periódica cada 12 meses', probabilidad_residual: 0.1, impacto_residual: 25 },
  { clase: 'RIESGO', codigo: 'R7', factor_foda: 'D7', relacion_actividad: 'Prevención de Riesgos', factor: 'Cobertura geográfica limitada', descripcion: 'Cobertura geográfica limitada en Prevención de Riesgos (solo Región Metropolitana)', analisis_causa: 'Recursos de prevención concentrados en RM; falta de prevencionistas en otras regiones', procedencia: 'Factores internos: Limitación de recursos y cobertura territorial', origen: 'INTERNO', probabilidad: 0.5, impacto: 10, accion: 'Evaluar alianzas o contratación de prevencionistas en regiones con demanda activa', fecha_implementacion: 'Post-certificación', medidas_control: 'Monitoreo de demanda por región, evaluación de viabilidad de expansión geográfica', probabilidad_residual: 0.5, impacto_residual: 10 },
  { clase: 'RIESGO', codigo: 'R8', factor_foda: 'A1', relacion_actividad: 'Entorno Competitivo', factor: 'Alta competencia en el sector de asesorías', descripcion: 'Alta competencia en el sector de asesorías (empresas nacionales)', analisis_causa: 'Mercado de asesorías con múltiples competidores nacionales que ofrecen servicios similares', procedencia: 'Factor externo: Competencia del mercado nacional de asesorías', origen: 'EXTERNO', probabilidad: 0.5, impacto: 25, accion: 'Diferenciación mediante certificación ISO 9001 y servicio integral; posicionamiento de marca HomePymes', fecha_implementacion: 'Septiembre 2026', medidas_control: 'Certificación ISO 9001, estrategia de marketing corporativo, encuesta de satisfacción al cliente', probabilidad_residual: 0.5, impacto_residual: 25 },
  { clase: 'RIESGO', codigo: 'R9', factor_foda: 'A2', relacion_actividad: 'Gestión Tecnológica', factor: 'Rápida obsolescencia tecnológica', descripcion: 'Rápida obsolescencia de tecnologías y necesidad de actualización constante', analisis_causa: 'Avances tecnológicos acelerados que pueden dejar las plataformas actuales desactualizadas', procedencia: 'Factor externo: Avances tecnológicos rápidos del mercado', origen: 'EXTERNO', probabilidad: 0.5, impacto: 10, accion: 'Migración a plataforma HomePymes Digital; evaluación periódica de herramientas tecnológicas', fecha_implementacion: 'Continuo', medidas_control: 'Evaluación anual de plataformas, presupuesto de actualización tecnológica', probabilidad_residual: 0.1, impacto_residual: 10 },
  { clase: 'RIESGO', codigo: 'R10', factor_foda: 'A3', relacion_actividad: 'Gestión de Infraestructura', factor: 'Normativas de ciberseguridad más estrictas', descripcion: 'Normativas más estrictas en ciberseguridad que pueden aumentar costos', analisis_causa: 'Regulación gubernamental en materia de protección de datos y ciberseguridad más exigente', procedencia: 'Factor externo: Regulación gubernamental en ciberseguridad', origen: 'EXTERNO', probabilidad: 0.1, impacto: 10, accion: 'Monitoreo de cambios regulatorios; asegurar cumplimiento de protección de datos en plataformas', fecha_implementacion: 'Continuo', medidas_control: 'Revisión periódica de normativa vigente, evaluación de cumplimiento en plataformas (FácilCont, Fácil Remu, HomePymes Digital)', probabilidad_residual: 0.1, impacto_residual: 10 },
  { clase: 'RIESGO', codigo: 'R11', factor_foda: 'A4', relacion_actividad: 'Gestión Comercial', factor: 'Clientes sin compromiso contractual de permanencia', descripcion: 'Clientes sin compromiso contractual de permanencia mínima', analisis_causa: 'Relaciones comerciales informales que permiten al cliente retirarse sin aviso ni penalidad', procedencia: 'Factor externo: Dinámica del mercado sin retención contractual', origen: 'EXTERNO', probabilidad: 1.0, impacto: 25, accion: 'Formalizar contratos con cláusula de permanencia; implementar plan de fidelización', fecha_implementacion: 'Septiembre 2026', medidas_control: 'Contratos formales, encuesta de satisfacción, seguimiento retención (objetivo ≥70%)', probabilidad_residual: 0.5, impacto_residual: 10 }
];
// Las 5 oportunidades del DOC-08. La hoja de oportunidades no tiene
// columna de análisis de causa: no se inventa una.
const OPORTUNIDADES_PROPUESTAS_DOC08 = [
  { clase: 'OPORTUNIDAD', codigo: 'O1', factor_foda: 'O1', relacion_actividad: 'Crecimiento Empresarial', factor: 'Aumento de demanda de externalización en pymes', descripcion: 'Aumento de la demanda de soluciones integrales por parte de pymes que buscan externalizar servicios administrativos', procedencia: 'Externo: Tendencia del mercado pyme hacia la externalización de servicios', origen: 'EXTERNO', probabilidad: 1.0, impacto: 25, accion: 'Fortalecer oferta integral de servicios y posicionar marca HomePymes en segmento pyme', fecha_implementacion: 'Continuo', medidas_control: 'Estrategia de marketing, certificación ISO 9001, seguimiento de objetivo de crecimiento (≥15% nuevos servicios)', probabilidad_residual: 1.0, impacto_residual: 50 },
  { clase: 'OPORTUNIDAD', codigo: 'O2', factor_foda: 'O2', relacion_actividad: 'Crecimiento Empresarial', factor: 'Expansión a otros rubros de pymes y contratistas', descripcion: 'Expansión a otros rubros de pymes y contratistas (agrícola, naviero, retail, etc.)', procedencia: 'Externo: Demanda en nuevos sectores económicos', origen: 'EXTERNO', probabilidad: 0.5, impacto: 25, accion: 'Evaluar demanda y adaptar servicios para rubros agrícola, naviero y retail', fecha_implementacion: 'Post-certificación', medidas_control: 'Estudio de mercado por sector, adaptación de servicios, alianzas estratégicas sectoriales', probabilidad_residual: 1.0, impacto_residual: 25 },
  { clase: 'OPORTUNIDAD', codigo: 'O3', factor_foda: 'O3', relacion_actividad: 'Entorno Sectorial', factor: 'Reactivación del sector construcción', descripcion: 'Reactivación del sector construcción (mayor demanda potencial)', procedencia: 'Externo: Ciclo económico del sector construcción', origen: 'EXTERNO', probabilidad: 0.5, impacto: 25, accion: 'Intensificar acciones comerciales hacia contratistas y subcontratistas del sector construcción', fecha_implementacion: 'Continuo', medidas_control: 'Plan de ventas enfocado en construcción, seguimiento de indicadores sectoriales, fidelización de clientes actuales', probabilidad_residual: 0.5, impacto_residual: 25 },
  { clase: 'OPORTUNIDAD', codigo: 'O4', factor_foda: 'O4', relacion_actividad: 'Gestión Tecnológica', factor: 'Transformación digital acelerada', descripcion: 'Transformación digital acelerada: empresas necesitan migrar sus servicios a sistemas en línea', procedencia: 'Externo: Tendencia de digitalización del mercado', origen: 'EXTERNO', probabilidad: 1.0, impacto: 25, accion: 'Consolidar migración a plataforma HomePymes Digital y ampliar funcionalidades en línea', fecha_implementacion: 'Continuo', medidas_control: 'Migración a HomePymes Digital, integración con GDE/Facilita/RLD, capacitación a clientes en uso de plataforma', probabilidad_residual: 1.0, impacto_residual: 50 },
  { clase: 'OPORTUNIDAD', codigo: 'O5', factor_foda: 'O5', relacion_actividad: 'Crecimiento Empresarial', factor: 'Internacionalización post-certificación', descripcion: 'Internacionalización post-certificación con casa certificadora reconocida', procedencia: 'Externo: Reconocimiento internacional de certificación ISO 9001', origen: 'EXTERNO', probabilidad: 0.5, impacto: 50, accion: 'Seleccionar casa certificadora con reconocimiento internacional (TUV recomendada) para facilitar expansión', fecha_implementacion: 'Post-certificación', medidas_control: 'Certificación ISO 9001 con casa internacional, evaluación de mercados potenciales, plan de internacionalización', probabilidad_residual: 0.5, impacto_residual: 50 }
];

const CLASES_RIESGO = ['RIESGO', 'OPORTUNIDAD'];
const ESTADOS_RIESGO = ['ABIERTO', 'TRATADO', 'CERRADO'];

function uuid_() { return crypto.randomUUID(); }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
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
function mesesDesde_(claveFecha) {
  if (!claveFecha) return null;
  const partes = String(claveFecha).slice(0, 10).split('-');
  if (partes.length !== 3) return null;
  const desde = Date.UTC(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));
  if (!isFinite(desde)) return null;
  const dias = Math.floor((Date.now() - desde) / 86400000);
  return Math.floor(dias / 30.4375);
}

// --- calculo de la valoracion -----------------------------------------------
/**
 * magnitud = probabilidad x impacto, y la banda sale de la tabla de
 * criterios. Mientras esto se calcule, la etiqueta no puede contradecir al
 * número.
 */
function valorarRiesgo_(probabilidad, impacto) {
  const p = Number(probabilidad);
  const i = Number(impacto);
  if (!isFinite(p) || !isFinite(i) || p <= 0 || i <= 0) return null;
  // Redondeo defensivo a dos decimales (ver nota del .gs sobre bordes exactos).
  const magnitud = Math.round(p * i * 100) / 100;
  for (const b of BANDAS_MAGNITUD) {
    if (magnitud < b.hasta) return { magnitud, banda: b.etiqueta, tono: b.tono };
  }
  const ultima = BANDAS_MAGNITUD[BANDAS_MAGNITUD.length - 1];
  return { magnitud, banda: ultima.etiqueta, tono: ultima.tono };
}
/** El tono del semáforo. En una OPORTUNIDAD el significado se invierte. */
function tonoValoracion_(valoracion, clase) {
  if (!valoracion) return 'neutro';
  if (clase !== 'OPORTUNIDAD') return valoracion.tono;
  const INVERSO = { neutro: 'neutro', ok: 'neutro', info: 'info', alerta: 'ok', critico: 'ok' };
  return INVERSO[valoracion.tono] || 'neutro';
}

// --- helpers -----------------------------------------------------------------
function riesgosActivos_(db) {
  return leerSeguro_(db, 'SGC_RIESGOS').filter((r) => esVerdadero_(r.activa));
}
function indiceFactoresPorCodigo_(db) {
  const indice = {};
  Contexto.factoresContextoActivos_(db).forEach((f) => { indice[String(f.tipo || '').slice(0, 1) + f.numero] = f.factor_id; });
  return indice;
}
function buscarActividadSgc_(db, actividadId) {
  if (!actividadId) return null;
  return leerSeguro_(db, 'ACTIVIDADES').find((a) => a.actividad_id === actividadId) || null;
}
function siguienteCodigoRiesgo_(db, clase) {
  const prefijo = clase === 'OPORTUNIDAD' ? 'O' : 'R';
  let max = 0;
  riesgosActivos_(db).forEach((r) => { if (r.clase !== clase) return; const n = parseInt(String(r.codigo || '').replace(/\D/g, ''), 10); if (isFinite(n) && n > max) max = n; });
  return prefijo + (max + 1);
}
function formatearRiesgo_(r, factorTexto, tarea) {
  const inherente = valorarRiesgo_(r.probabilidad, r.impacto);
  const residual = valorarRiesgo_(r.probabilidad_residual, r.impacto_residual);

  // Para un riesgo, tratar significa BAJAR la magnitud; para una
  // oportunidad, SUBIRLA.
  let mejora = null;
  if (inherente && residual) {
    mejora = r.clase === 'OPORTUNIDAD' ? residual.magnitud > inherente.magnitud : residual.magnitud < inherente.magnitud;
  }

  return {
    riesgo_id: r.riesgo_id, clase: r.clase, codigo: r.codigo, relacion_actividad: r.relacion_actividad || '',
    factor: r.factor || '', descripcion: r.descripcion || '', analisis_causa: r.analisis_causa || '',
    procedencia: r.procedencia || '', origen: r.origen || '', factor_contexto_id: r.factor_contexto_id || '',
    factor_contexto: factorTexto, probabilidad: Number(r.probabilidad) || 0, impacto: Number(r.impacto) || 0,
    inherente, tono_inherente: tonoValoracion_(inherente, r.clase),
    probabilidad_residual: Number(r.probabilidad_residual) || 0, impacto_residual: Number(r.impacto_residual) || 0,
    residual, tono_residual: tonoValoracion_(residual, r.clase), mejora,
    // En una oportunidad, "favorable" invierte la lectura del semáforo.
    favorable: r.clase === 'OPORTUNIDAD',
    accion: r.accion || '', fecha_implementacion: r.fecha_implementacion || '', medidas_control: r.medidas_control || '',
    responsable_email: r.responsable_email || '', accion_actividad_id: r.accion_actividad_id || '', tarea,
    estado: r.estado || 'ABIERTO', observaciones: r.observaciones || '', fecha_identificacion: r.fecha_identificacion || '',
    fecha_ultima_revision: r.fecha_ultima_revision || '', revisado_por: r.revisado_por || ''
  };
}
function resumenRiesgos_(lista) {
  const riesgos = lista.filter((r) => r.clase === 'RIESGO');
  const criticos = riesgos.filter((r) => r.inherente && (r.inherente.banda === 'Crítico' || r.inherente.banda === 'Alto'));
  // "Sin tratar" mira el RESIDUAL, no la acción escrita: un riesgo alto con
  // una acción redactada pero sin revaloración sigue estando sin tratar.
  const sinTratar = criticos.filter((r) => !r.residual);
  const sinAccion = riesgos.filter((r) => !String(r.accion || '').trim());
  const conActividad = lista.filter((r) => !!r.accion_actividad_id);

  const fechas = lista.map((r) => String(r.fecha_ultima_revision || '').slice(0, 10)).filter(Boolean).sort();
  const ultima = fechas.length ? fechas[0] : '';
  const meses = mesesDesde_(ultima);

  return {
    total: lista.length, total_riesgos: riesgos.length, total_oportunidades: lista.length - riesgos.length,
    criticos_o_altos: criticos.length, sin_tratar: sinTratar.length, sin_accion: sinAccion.length,
    con_actividad: conActividad.length, ultima_revision: ultima, meses_desde_revision: meses,
    revision_vencida: meses !== null && meses >= MESES_REVISION_RIESGOS
  };
}
function validarRiesgo_(data) {
  const d = data || {};
  const clase = String(d.clase || 'RIESGO').trim().toUpperCase();
  if (CLASES_RIESGO.indexOf(clase) === -1) return { error: 'Indica si es un riesgo o una oportunidad.' };
  const descripcion = String(d.descripcion || '').trim();
  if (!descripcion) return { error: 'Describe el riesgo u oportunidad.' };
  const factor = String(d.factor || '').trim();
  if (!factor) return { error: 'Indica el factor: es el título corto con el que se identifica.' };

  const valores = PROBABILIDAD_RIESGO.map((p) => p.valor);
  const impactos = IMPACTO_RIESGO.map((i) => i.valor);

  const p = Number(d.probabilidad);
  if (valores.indexOf(p) === -1) return { error: 'La probabilidad tiene que ser una de la escala: ' + valores.join(', ') + '.' };
  const i = Number(d.impacto);
  if (impactos.indexOf(i) === -1) return { error: 'El impacto tiene que ser uno de la escala: ' + impactos.join(', ') + '.' };

  // La revaloración es OPCIONAL: un riesgo recién identificado todavía no
  // la tiene. Pero si viene una, tiene que venir completa.
  const pr = d.probabilidad_residual === '' || d.probabilidad_residual === undefined || d.probabilidad_residual === null ? '' : Number(d.probabilidad_residual);
  const ir = d.impacto_residual === '' || d.impacto_residual === undefined || d.impacto_residual === null ? '' : Number(d.impacto_residual);
  if ((pr === '') !== (ir === '')) return { error: 'La revaloración necesita probabilidad e impacto: con uno solo no se puede calcular la magnitud.' };
  if (pr !== '' && valores.indexOf(pr) === -1) return { error: 'La probabilidad residual tiene que ser una de la escala: ' + valores.join(', ') + '.' };
  if (ir !== '' && impactos.indexOf(ir) === -1) return { error: 'El impacto residual tiene que ser uno de la escala: ' + impactos.join(', ') + '.' };

  let estado = String(d.estado || 'ABIERTO').trim().toUpperCase();
  if (ESTADOS_RIESGO.indexOf(estado) === -1) estado = 'ABIERTO';

  return {
    datos: {
      clase, relacion_actividad: String(d.relacion_actividad || '').trim(), factor, descripcion,
      analisis_causa: String(d.analisis_causa || '').trim(), procedencia: String(d.procedencia || '').trim(),
      origen: String(d.origen || '').trim().toUpperCase() === 'EXTERNO' ? 'EXTERNO' : 'INTERNO',
      factor_contexto_id: String(d.factor_contexto_id || '').trim(), probabilidad: p, impacto: i,
      accion: String(d.accion || '').trim(), fecha_implementacion: String(d.fecha_implementacion || '').trim(),
      medidas_control: String(d.medidas_control || '').trim(), probabilidad_residual: pr, impacto_residual: ir,
      estado, observaciones: String(d.observaciones || '').trim()
    }
  };
}

// ===========================================================================
// API publica
// ===========================================================================

function listar(db, data, contexto) {
  const rol = Calidad.rolSgc_(db, contexto);
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  if (!Calidad.veTodoSgc_(db, contexto, rol, gobierna)) return { _forbidden: true, message: 'No tienes acceso a la matriz de riesgos.' };

  const filas = riesgosActivos_(db);
  const factores = Contexto.factoresContextoActivos_(db);
  const porFactor = {};
  factores.forEach((f) => { porFactor[f.factor_id] = String(f.tipo || '').slice(0, 1) + f.numero + ' — ' + f.descripcion; });

  const actividades = {};
  filas.forEach((r) => {
    if (!r.accion_actividad_id) return;
    const a = buscarActividadSgc_(db, r.accion_actividad_id);
    if (a) actividades[r.riesgo_id] = tareaResumen_(a);
  });

  const lista = filas.map((r) => formatearRiesgo_(r, porFactor[r.factor_contexto_id] || '', actividades[r.riesgo_id] || null));

  return {
    puede_gestionar: gobierna, escala_probabilidad: PROBABILIDAD_RIESGO, escala_impacto: IMPACTO_RIESGO,
    bandas: BANDAS_MAGNITUD.map((b) => ({ hasta: b.hasta === Infinity ? null : b.hasta, etiqueta: b.etiqueta })),
    meses_revision: MESES_REVISION_RIESGOS,
    factores_contexto: factores.map((f) => ({ factor_id: f.factor_id, codigo: String(f.tipo || '').slice(0, 1) + f.numero, descripcion: f.descripcion })),
    riesgos: lista.filter((r) => r.clase === 'RIESGO'), oportunidades: lista.filter((r) => r.clase === 'OPORTUNIDAD'),
    resumen: resumenRiesgos_(lista),
    propuesta: filas.length ? null : { riesgos: RIESGOS_PROPUESTOS_DOC08.length, oportunidades: OPORTUNIDADES_PROPUESTAS_DOC08.length }
  };
}

/**
 * Carga la matriz del DOC-08. Se siembran SOLO probabilidad e impacto: las
 * magnitudes y bandas las calcula el sistema.
 */
function sembrarDesdeDoc08(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado del SGC puede cargar la matriz de riesgos.' };
  if (riesgosActivos_(db).length) return { ok: false, message: 'La matriz ya está cargada. Agrega o edita los registros uno a uno.' };

  const ahora = new Date().toISOString();
  const hoy = ahora.slice(0, 10);
  const email = (contexto && contexto.email) || '';
  const indiceFactores = indiceFactoresPorCodigo_(db);
  let total = 0, enlazados = 0;

  [].concat(RIESGOS_PROPUESTOS_DOC08, OPORTUNIDADES_PROPUESTAS_DOC08).forEach((r) => {
    const factorId = r.factor_foda && indiceFactores[r.factor_foda] ? indiceFactores[r.factor_foda] : '';
    if (factorId) enlazados++;
    agregarFila_(db, 'SGC_RIESGOS', {
      riesgo_id: uuid_(), clase: r.clase, codigo: r.codigo, relacion_actividad: r.relacion_actividad, factor: r.factor,
      descripcion: r.descripcion, analisis_causa: r.analisis_causa || '', procedencia: r.procedencia, origen: r.origen,
      factor_contexto_id: factorId, probabilidad: r.probabilidad, impacto: r.impacto, accion: r.accion,
      fecha_implementacion: r.fecha_implementacion, medidas_control: r.medidas_control, responsable_email: '',
      accion_actividad_id: '', probabilidad_residual: r.probabilidad_residual, impacto_residual: r.impacto_residual,
      estado: 'ABIERTO', observaciones: '', fecha_identificacion: hoy, fecha_ultima_revision: hoy,
      revisado_por: email, creado_por: email, fecha_creacion: ahora, activa: true
    });
    total++;
  });

  registrarLogSgc_(db, 'SGC_RIESGOS_SEMBRADOS', total + ' registros del DOC-08 cargados (' + enlazados + ' enlazados al FODA)', contexto);
  return { ok: true, total, enlazados, message: 'Matriz cargada: ' + total + ' registros, ' + enlazados + ' enlazados a un factor del contexto.' };
}

function guardar(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado del SGC puede editar la matriz de riesgos.' };

  const val = validarRiesgo_(data);
  if (val.error) return { ok: false, message: val.error };

  const ahora = new Date().toISOString();
  const campos = val.datos;
  campos.fecha_ultima_revision = ahora.slice(0, 10);
  campos.revisado_por = (contexto && contexto.email) || '';

  if (data.riesgo_id) {
    const actual = riesgosActivos_(db).find((r) => r.riesgo_id === data.riesgo_id);
    if (!actual) return { ok: false, message: 'No se encontró el registro.' };
    actualizarFilaPorId_(db, 'SGC_RIESGOS', 'riesgo_id', actual.riesgo_id, campos);
    registrarLogSgc_(db, 'SGC_RIESGO_EDITADO', actual.codigo + ' actualizado', contexto);
    return { ok: true, riesgo_id: actual.riesgo_id, message: 'Registro actualizado.' };
  }

  campos.riesgo_id = uuid_();
  campos.codigo = siguienteCodigoRiesgo_(db, campos.clase);
  campos.estado = 'ABIERTO';
  campos.accion_actividad_id = '';
  campos.fecha_identificacion = ahora.slice(0, 10);
  campos.creado_por = (contexto && contexto.email) || '';
  campos.fecha_creacion = ahora;
  campos.activa = true;
  agregarFila_(db, 'SGC_RIESGOS', campos);
  registrarLogSgc_(db, 'SGC_RIESGO_AGREGADO', campos.codigo + ' agregado', contexto);
  return { ok: true, riesgo_id: campos.riesgo_id, message: 'Registro agregado.' };
}

/**
 * Convierte la acción de tratamiento en una ACTIVIDAD asignada. Mismo
 * eslabón que usan las NC y los acuerdos de dirección.
 */
async function asignarAccion(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado del SGC puede asignar la acción.' };

  const r = riesgosActivos_(db).find((x) => x.riesgo_id === data.riesgo_id);
  if (!r) return { ok: false, message: 'No se encontró el registro.' };
  if (r.accion_actividad_id) return { ok: false, message: 'Este registro ya tiene una actividad asignada.' };
  if (!String(r.accion || '').trim()) return { ok: false, message: 'Escribe primero la acción de tratamiento.' };
  const responsable = String((data && data.responsable_email) || '').trim();
  if (!responsable) return { ok: false, message: 'Indica quién es responsable de la acción.' };
  const fecha = String((data && data.fecha_compromiso) || '').trim();
  if (!fecha) return { ok: false, message: 'Indica la fecha comprometida de la acción.' };

  const esOportunidad = r.clase === 'OPORTUNIDAD';
  const tarea = await crearTareaSgc_(db, {
    titulo: (esOportunidad ? 'Oportunidad ' : 'Riesgo ') + r.codigo + ': ' + String(r.factor || '').slice(0, 80),
    descripcion: r.accion + (r.medidas_control ? '\n\nControles: ' + r.medidas_control : ''),
    responsable_email: responsable, fecha_compromiso: fecha, origen_tipo: 'RIESGO_SGC', origen_id: r.riesgo_id
  }, contexto);

  if (!tarea || !tarea.actividad_id) return { ok: false, message: (tarea && tarea.message) || 'No se pudo crear la actividad.' };

  actualizarFilaPorId_(db, 'SGC_RIESGOS', 'riesgo_id', r.riesgo_id, { accion_actividad_id: tarea.actividad_id, responsable_email: responsable, estado: 'TRATADO' });
  registrarLogSgc_(db, 'SGC_RIESGO_ACCION_ASIGNADA', r.codigo + ' → actividad para ' + responsable, contexto);
  return { ok: true, actividad_id: tarea.actividad_id, message: 'Acción asignada a ' + responsable + '.' };
}

function registrarRevision(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado del SGC puede registrar la revisión.' };
  const filas = riesgosActivos_(db);
  if (!filas.length) return { ok: false, message: 'No hay nada que revisar todavía.' };

  const hoy = new Date().toISOString().slice(0, 10);
  const email = (contexto && contexto.email) || '';
  filas.forEach((r) => actualizarFilaPorId_(db, 'SGC_RIESGOS', 'riesgo_id', r.riesgo_id, { fecha_ultima_revision: hoy, revisado_por: email }));
  registrarLogSgc_(db, 'SGC_RIESGOS_REVISADOS', 'Matriz de riesgos revisada al ' + hoy, contexto);
  return { ok: true, message: 'Revisión registrada al ' + hoy + '.' };
}

function anular(db, data, contexto) {
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado del SGC puede quitar registros.' };
  const r = riesgosActivos_(db).find((x) => x.riesgo_id === data.riesgo_id);
  if (!r) return { ok: false, message: 'No se encontró el registro.' };
  actualizarFilaPorId_(db, 'SGC_RIESGOS', 'riesgo_id', r.riesgo_id, { activa: false });
  registrarLogSgc_(db, 'SGC_RIESGO_QUITADO', r.codigo + ' quitado de la matriz', contexto);
  return { ok: true, message: 'Registro quitado de la matriz.' };
}

module.exports = {
  listar, sembrarDesdeDoc08, guardar, asignarAccion, registrarRevision, anular,
  // Consumidos por matrizCoberturaSgc.js (Fase 6b, evaluador de §6.1) en
  // lugar del stub que devolvía [] hasta este incremento, y por tests.
  riesgosActivos_, formatearRiesgo_, resumenRiesgos_, valorarRiesgo_, tonoValoracion_,
  RIESGOS_PROPUESTOS_DOC08, OPORTUNIDADES_PROPUESTAS_DOC08, MESES_REVISION_RIESGOS
};
