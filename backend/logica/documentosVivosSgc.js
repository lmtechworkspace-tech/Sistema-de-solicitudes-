'use strict';

/**
 * documentosVivosSgc.js — documentos del SGC escritos DENTRO de SIGSO (y ya no
 * solo como archivo adjunto o enlace a Google Drive).
 *
 * Pedido del dueño (2026-09-29): que toda la información del SGC quede en
 * SIGSO, editable ahí, y que se pueda descargar con el formato de los
 * documentos originales (logo de la empresa que se certifica, código, versión,
 * vigencia, página X de Y, elaborado/revisado/aprobado y control de cambios).
 * Mientras tanto se conserva el enlace a la copia de trabajo en Drive.
 *
 * Dos clases de contenido:
 *   - ESCRITO: el texto vive en SGC_DOCUMENTOS.contenido (JSON con secciones).
 *     Procedimientos, manual, política, misión y visión, instructivos...
 *   - GENERADO: el documento se arma con los datos que el módulo ya tiene
 *     (FODA desde Contexto, riesgos desde Riesgos, DOC-10..13 desde los
 *     procesos de servicio, listado maestro desde los propios documentos...).
 *     Así hay UNA sola fuente de verdad: se edita en su sección y el PDF
 *     siempre sale al día.
 *
 * Control documental (PRO-01, ISO 7.5): el contenido de la versión vigente
 * solo se corrige en el lugar mientras nadie haya confirmado su lectura (mismo
 * criterio que el archivo adjunto en calidadSgc.actualizarDocumento); después,
 * el cambio se guarda como BORRADOR y se publica como versión nueva, que deja
 * copia del texto en SGC_DOC_VERSIONES y una fila en el control de cambios.
 *
 * El logo es el de la organización que implementa el SGC (HomePymes), solo
 * para los documentos de Calidad; el resto de SIGSO usa su propia marca.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('./calidadSgc');
const Contexto = require('./contextoSgc');
const Riesgos = require('./riesgosSgc');
const Procesos = require('./procesosSgc');
const Motor = require('./pdfChromium');
const ReportePdf = require('./reportePdf');

// --- constantes ----------------------------------------------------------------
const MAX_SECCIONES = 60;
const MAX_TEXTO_SECCION = 40000;
const MAX_TITULO = 200;

// Estructura de los procedimientos de la empresa (PRO-01 §6.6, "Capítulos de
// los Procedimientos"): la plantilla con la que nace un PRO nuevo.
const SECCIONES_PROCEDIMIENTO = [
  'OBJETIVO', 'ALCANCE', 'REFERENCIAS NORMATIVAS', 'RESPONSABLES', 'DEFINICIONES',
  'DESCRIPCIÓN DEL PROCEDIMIENTO', 'LISTADO DE EQUIPOS Y MATERIALES', 'FORMULARIOS ASOCIADOS'
];

// Documentos que se arman con datos del módulo (no se escriben a mano).
const FUENTES = {
  FODA: { titulo: 'Análisis FODA', seccion: 'contexto', etiqueta: 'Contexto' },
  PARTES: { titulo: 'Matriz de partes interesadas', seccion: 'contexto', etiqueta: 'Contexto', horizontal: true },
  OBJETIVOS: { titulo: 'Objetivos de calidad', seccion: 'objetivos', etiqueta: 'Objetivos', horizontal: true },
  RIESGOS: { titulo: 'Matriz de riesgos y oportunidades', seccion: 'riesgos', etiqueta: 'Riesgos', horizontal: true },
  MAPA: { titulo: 'Mapa de procesos', seccion: 'procesos', etiqueta: 'Mapa de procesos' },
  SERVICIOS: { titulo: 'Documentos servicios a clientes', seccion: 'procesos', etiqueta: 'Mapa de procesos', horizontal: true },
  LISTADO_MAESTRO: { titulo: 'Listado maestro de control de documentos y formularios', seccion: 'documentos', etiqueta: 'Documentos', horizontal: true },
  PROVEEDORES: { titulo: 'Listado de proveedores aprobados', seccion: 'proveedores', etiqueta: 'Proveedores', horizontal: true }
};
// Una sola tabla código → fuente, compartida con el control documental.
const FUENTE_POR_CODIGO = Calidad.FUENTE_DOCUMENTO_POR_CODIGO_SGC;
const ETIQUETA_TIPO = { DOC: 'DOCUMENTO', PRO: 'PROCEDIMIENTO', INS: 'INSTRUCTIVO', FO: 'FORMATO', EXTERNO: 'DOCUMENTO EXTERNO' };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// --- utilidades ------------------------------------------------------------------
function uuid_() { return crypto.randomUUID(); }
function errorValidacion_(campo, mensaje) { return { _validationError: true, campo, message: mensaje }; }
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1; }
function leerSeguro_(db, hoja) { try { return leerFilas_(db, hoja, COLUMNAS[hoja]); } catch (err) { return []; } }
function normalizarEmail_(e) { return String(e || '').trim().toLowerCase(); }
function esc_(t) {
  return String(t === undefined || t === null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function buscarDoc_(db, id) {
  if (!id) return null;
  return leerSeguro_(db, 'SGC_DOCUMENTOS').find((d) => d.documento_id === id && esVerdadero_(d.activa)) || null;
}
function mesAnio_(valor) {
  if (!valor) return '';
  const s = String(valor);
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (!m) return s;
  const mes = MESES[Number(m[2]) - 1] || '';
  return mes ? mes.charAt(0).toUpperCase() + mes.slice(1) + ' ' + m[1] : s;
}
// Correo → nombre de la persona (Personas del SGC): un documento impreso se
// lee con nombres, no con correos.
function nombrePersona_(db, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return '';
  const p = leerSeguro_(db, 'SGC_PERSONAS').find((x) => esVerdadero_(x.activa) && String(x.usuario_email || '').trim().toLowerCase() === e);
  return p ? p.nombre : e;
}
// Fechas guardadas como ISO se muestran como "Agosto 2026"; un texto libre
// ("Septiembre 2026", "Continuo") se deja tal cual.
function fechaLibre_(valor) {
  return /^\d{4}-\d{2}-\d{2}T/.test(String(valor || '')) ? mesAnio_(valor) : String(valor || '');
}
function fechaCorta_(valor) {
  const m = String(valor || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : String(valor || '');
}
// "v01" → "01"; "v2" → "02"; "2015" (externo) → "2015".
function numeroVersion_(v) {
  const s = String(v || '').trim().replace(/^v/i, '');
  return /^\d$/.test(s) ? '0' + s : s;
}
function fuenteDe_(doc) {
  const f = String(doc.contenido_fuente || '').trim().toUpperCase();
  if (f === 'TEXTO') return '';
  if (FUENTES[f]) return f;
  return FUENTE_POR_CODIGO[String(doc.codigo || '').toUpperCase()] || '';
}

// --- contenido: validación y parseo -------------------------------------------------
function parsearContenido_(valor) {
  if (!valor) return null;
  let o = valor;
  if (typeof valor === 'string') { try { o = JSON.parse(valor); } catch (e) { return null; } }
  return o && Array.isArray(o.secciones) ? o : null;
}
/** Limpia lo que llega del editor: secciones con título y texto, control de cambios. */
function contenidoValido_(entrada) {
  const o = parsearContenido_(entrada);
  if (!o) return errorValidacion_('contenido', 'El contenido no tiene el formato esperado (secciones).');
  if (o.secciones.length > MAX_SECCIONES) return errorValidacion_('contenido', 'Máximo ' + MAX_SECCIONES + ' secciones.');
  const secciones = [];
  for (const s of o.secciones) {
    if (!s) continue;
    const titulo = String(s.titulo || '').trim().slice(0, MAX_TITULO);
    const texto = String(s.texto || '').replace(/\r\n/g, '\n');
    if (texto.length > MAX_TEXTO_SECCION) return errorValidacion_('contenido', 'La sección "' + titulo + '" es demasiado larga.');
    if (!titulo && !texto.trim()) continue;
    secciones.push({ id: String(s.id || uuid_()).slice(0, 40), titulo, texto });
  }
  const control = (Array.isArray(o.control_cambios) ? o.control_cambios : []).slice(0, 100).map((c) => ({
    version: String((c && c.version) || '').trim().slice(0, 20),
    fecha: String((c && c.fecha) || '').trim().slice(0, 40),
    descripcion: String((c && c.descripcion) || '').trim().slice(0, 1000)
  })).filter((c) => c.version || c.descripcion);
  return {
    secciones,
    control_cambios: control,
    portada: o.portada === false ? false : (o.portada === true ? true : undefined),
    subtitulo: String(o.subtitulo || '').trim().slice(0, 200)
  };
}
function plantillaVacia_(doc) {
  const titulos = doc.tipo === 'PRO' ? SECCIONES_PROCEDIMIENTO : ['CONTENIDO'];
  return { secciones: titulos.map((t) => ({ id: uuid_(), titulo: t, texto: '' })), control_cambios: [] };
}

// --- texto → HTML (marcado liviano, sin HTML crudo del usuario) ----------------------
function enLinea_(t) {
  return esc_(t)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:]|$)/g, '$1<i>$2</i>')
    .replace(/\bhttps?:\/\/[^\s<]+/g, (u) => '<a href="' + u + '">' + u + '</a>');
}
/**
 * Marcado: línea en blanco separa párrafos; "- " o "• " viñeta; "1. ", "a) "
 * lista ordenada (conserva el marcador escrito); "### " subtítulo; líneas que
 * empiezan con "|" forman una tabla (la primera fila es encabezado);
 * **negrita** y _cursiva_.
 */
function textoAHtml_(texto) {
  const lineas = String(texto || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lineas.length) {
    const l = lineas[i];
    const t = l.trim();
    if (!t) { i++; continue; }
    if (/^###\s+/.test(t)) { out.push('<h3>' + enLinea_(t.replace(/^###\s+/, '')) + '</h3>'); i++; continue; }
    if (/^\|/.test(t)) {
      const filas = [];
      while (i < lineas.length && /^\|/.test(lineas[i].trim())) {
        const celdas = lineas[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        if (!celdas.every((c) => /^:?-{2,}:?$/.test(c))) filas.push(celdas);
        i++;
      }
      if (filas.length) {
        out.push('<table class="tabla"><thead><tr>' + filas[0].map((c) => '<th>' + enLinea_(c) + '</th>').join('') + '</tr></thead><tbody>' +
          filas.slice(1).map((f) => '<tr>' + f.map((c) => '<td>' + enLinea_(c).replace(/\\n/g, '<br>') + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
      }
      continue;
    }
    if (/^([-•*])\s+/.test(t)) {
      const items = [];
      while (i < lineas.length && /^([-•*])\s+/.test(lineas[i].trim())) { items.push(lineas[i].trim().replace(/^([-•*])\s+/, '')); i++; }
      out.push('<ul>' + items.map((x) => '<li>' + enLinea_(x) + '</li>').join('') + '</ul>');
      continue;
    }
    if (/^(\d{1,2}[.)]|[a-z][.)])\s+/i.test(t)) {
      const items = [];
      while (i < lineas.length && /^(\d{1,2}[.)]|[a-z][.)])\s+/i.test(lineas[i].trim())) {
        const m = lineas[i].trim().match(/^(\d{1,2}[.)]|[a-z][.)])\s+(.*)$/i);
        items.push({ marca: m[1], texto: m[2] });
        i++;
      }
      out.push('<ol class="marcada">' + items.map((x) => '<li><span class="marca">' + esc_(x.marca) + '</span> ' + enLinea_(x.texto) + '</li>').join('') + '</ol>');
      continue;
    }
    const parrafo = [];
    while (i < lineas.length && lineas[i].trim() && !/^(\||###\s|[-•*]\s|\d{1,2}[.)]\s|[a-z][.)]\s)/i.test(lineas[i].trim())) { parrafo.push(lineas[i].trim()); i++; }
    if (!parrafo.length) { parrafo.push(t); i++; }
    out.push('<p>' + parrafo.map(enLinea_).join('<br>') + '</p>');
  }
  return out.join('\n');
}

// --- secciones generadas desde los datos del módulo -------------------------------
function tabla_(encabezados, filas, clase) {
  return '<table class="tabla' + (clase ? ' ' + clase : '') + '"><thead><tr>' + encabezados.map((e) => '<th>' + esc_(e) + '</th>').join('') + '</tr></thead><tbody>' +
    (filas.length ? filas.map((f) => '<tr>' + f.map((c) => '<td>' + (c && c.html !== undefined ? c.html : esc_(c).replace(/\n/g, '<br>')) + '</td>').join('') + '</tr>').join('')
      : '<tr><td colspan="' + encabezados.length + '" class="vacio">Sin registros.</td></tr>') + '</tbody></table>';
}
function lista_(items) { return items.length ? '<ol class="foda">' + items.map((x) => '<li>' + esc_(x) + '</li>').join('') + '</ol>' : '<p class="vacio">—</p>'; }

function generarFoda_(db) {
  const f = Contexto.factoresContextoActivos_(db).sort((a, b) => Number(a.numero) - Number(b.numero));
  const de = (t) => f.filter((x) => x.tipo === t).map((x) => x.descripcion);
  return [{ titulo: '', html: '<table class="tabla foda-grid"><tbody>' +
    '<tr><th>FORTALEZAS (INTERNO)</th><th>OPORTUNIDADES (EXTERNO)</th></tr>' +
    '<tr><td>' + lista_(de('FORTALEZA')) + '</td><td>' + lista_(de('OPORTUNIDAD')) + '</td></tr>' +
    '<tr><th>DEBILIDADES (INTERNO)</th><th>AMENAZAS (EXTERNO)</th></tr>' +
    '<tr><td>' + lista_(de('DEBILIDAD')) + '</td><td>' + lista_(de('AMENAZA')) + '</td></tr></tbody></table>' }];
}
function generarPartes_(db) {
  const partes = Contexto.partesInteresadasActivas_(db);
  return [{ titulo: '', html: tabla_(['Parte interesada', 'Necesidades', 'Impacto', 'Nivel de influencia', 'Expectativa', 'Cómo afecta al SGC', 'Seguimiento'],
    partes.map((p) => [p.nombre, p.necesidades, p.impacto, p.influencia, p.expectativa, p.efecto_sgc,
      [p.metodo_seguimiento, p.frecuencia_seguimiento].filter(Boolean).join(' · ')])) }];
}
function generarObjetivos_(db) {
  const anios = leerSeguro_(db, 'SGC_OBJETIVOS').filter((o) => esVerdadero_(o.activa)).map((o) => Number(o.anio)).filter(isFinite);
  const anio = anios.length ? Math.max.apply(null, anios) : new Date().getFullYear();
  const objs = leerSeguro_(db, 'SGC_OBJETIVOS').filter((o) => esVerdadero_(o.activa) && Number(o.anio) === anio)
    .sort((a, b) => Number(a.numero) - Number(b.numero));
  return [{ titulo: 'Objetivos ' + anio, html: tabla_(['Objetivo general', 'Objetivo específico', 'Indicador', 'Meta', 'Acciones para lograrlo', 'Frecuencia de seguimiento', 'Responsable'],
    objs.map((o) => [o.objetivo_general, o.objetivo_especifico, o.indicador, o.meta_texto, o.acciones, o.frecuencia_texto || o.frecuencia, o.responsable_texto])) }];
}
function generarRiesgos_(db) {
  const factores = {};
  Contexto.factoresContextoActivos_(db).forEach((f) => { factores[f.factor_id] = String(f.tipo || '').slice(0, 1) + f.numero; });
  const lista = Riesgos.riesgosActivos_(db).map((r) => Riesgos.formatearRiesgo_(r, factores[r.factor_contexto_id] || '', null))
    .sort((a, b) => (Number(String(a.codigo).replace(/\D/g, '')) || 0) - (Number(String(b.codigo).replace(/\D/g, '')) || 0));
  const val = (v) => v ? String(v.magnitud).replace('.', ',') + ' ' + v.banda : '—';
  const fila = (r) => [r.codigo, r.relacion_actividad, r.factor, fechaCorta_(r.fecha_identificacion), r.descripcion, r.analisis_causa, r.procedencia,
    String(r.probabilidad).replace('.', ','), String(r.impacto), val(r.inherente), r.accion, fechaLibre_(r.fecha_implementacion), r.medidas_control, nombrePersona_(db, r.responsable_email), val(r.residual)];
  const enc = ['N°', 'Relación / actividad', 'Factor', 'Identificación', 'Descripción', 'Análisis de causa', 'Procedencia', 'P', 'I', 'Valoración', 'Acciones', 'Implementación', 'Medidas de control', 'Responsable', 'Revaloración'];
  return [
    { titulo: 'RIESGOS', html: tabla_(enc, lista.filter((r) => r.clase !== 'OPORTUNIDAD').map(fila), 'densa') },
    { titulo: 'OPORTUNIDADES', html: tabla_(enc, lista.filter((r) => r.clase === 'OPORTUNIDAD').map(fila), 'densa') },
    { titulo: 'CRITERIOS DE VALORACIÓN', html: '<p>Valoración = Probabilidad (0,1 baja · 0,5 media · 1,0 alta) × Impacto (1 insignificante · 5 bajo · 10 moderado · 25 alto · 50 crítico). Magnitud: insignificante &lt; 0,5 · bajo 0,5 a 2,5 · moderado 2,5 a 10 · alto 10 a 25 · crítico ≥ 25.</p>' }
  ];
}
function generarMapa_(db) {
  const procesos = Procesos.procesosActivos_(db).filter((p) => p.nivel === 'MAPA');
  const grupo = (tipo, titulo) => {
    const ps = procesos.filter((p) => p.tipo === tipo).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
    return { titulo, html: tabla_(['Código', 'Proceso', 'Objetivo', 'Actividades', 'Responsable'],
      ps.map((p) => [p.codigo, p.nombre, p.objetivo, p.actividades, nombrePersona_(db, p.responsable_email)])) };
  };
  return [grupo('ESTRATEGICO', 'PROCESOS ESTRATÉGICOS'), grupo('OPERATIVO', 'PROCESOS OPERATIVOS — REALIZACIÓN DEL SERVICIO'), grupo('APOYO', 'PROCESOS DE APOYO')];
}
function generarServicios_(db, doc) {
  const codigo = String(doc.codigo || '').toUpperCase();
  const pasos = Procesos.pasosActivos_(db);
  const servicios = Procesos.procesosActivos_(db).filter((p) => p.nivel === 'SERVICIO' && String(p.documentos || '').toUpperCase().indexOf(codigo) !== -1)
    .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'es', { numeric: true }));
  if (!servicios.length) return [{ titulo: '', html: '<p class="vacio">No hay procesos de servicio asociados a ' + esc_(codigo) + '.</p>' }];
  return servicios.map((s) => {
    const ps = pasos.filter((p) => p.proceso_id === s.proceso_id).sort((a, b) => Number(a.numero) - Number(b.numero));
    return { titulo: s.nombre, salto: true, html: (s.objetivo ? '<p>' + esc_(s.objetivo) + '</p>' : '') +
      tabla_(['Paso', 'Responsable', 'Input — ¿qué necesito para empezar?', 'Actividades', 'Evidencias', 'Output — ¿qué entrego al terminar?'],
        ps.map((p) => [(p.numero ? 'Paso ' + p.numero + '\n' : '') + (p.nombre || ''), p.responsable, p.input, p.actividades, p.evidencias, p.output]), 'densa') };
  });
}
function generarListadoMaestro_(db) {
  const docs = leerSeguro_(db, 'SGC_DOCUMENTOS').filter((d) => esVerdadero_(d.activa) && d.estado === 'VIGENTE')
    .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'es', { numeric: true }));
  const TIPO = { DOC: 'Documento', PRO: 'Procedimiento', INS: 'Instructivo', FO: 'Formulario' };
  const internos = docs.filter((d) => d.tipo !== 'EXTERNO');
  const externos = docs.filter((d) => d.tipo === 'EXTERNO');
  return [
    { titulo: 'DOCUMENTOS INTERNOS', html: tabla_(['Tipo documento', 'Área', 'Código + título + versión', 'Fecha entrada vigencia', 'Fecha revisión'],
      internos.map((d) => [TIPO[d.tipo] || d.tipo, d.area_id, d.codigo + ' ' + d.nombre + ' ' + (d.version_vigente || ''), fechaCorta_(d.fecha_vigencia), fechaCorta_(d.proxima_revision)])) },
    { titulo: 'DOCUMENTOS EXTERNOS', html: tabla_(['Tipo documento', 'Área', 'Código + título', 'Emisor', 'Edición', 'Fecha revisión'],
      externos.map((d) => [d.clase_externa || 'Externo', d.area_id, d.codigo + ' — ' + d.nombre, d.emisor, d.version_vigente, fechaCorta_(d.proxima_revision)])) }
  ];
}
function generarProveedores_(db) {
  const provs = leerSeguro_(db, 'SGC_PROVEEDORES').filter((p) => esVerdadero_(p.activa));
  return [{ titulo: '', html: tabla_(['Producto o servicio', 'Nombre proveedor', 'RUT', 'Contacto', 'Resultado evaluación', 'Estatus'],
    provs.map((p) => [p.producto_servicio, p.nombre, p.rut, [p.email, p.telefono].filter(Boolean).join(' · '),
      p.ultima_evaluacion_promedio ? String(p.ultima_evaluacion_promedio).replace('.', ',') + (p.ultima_evaluacion_fecha ? ' (' + fechaCorta_(p.ultima_evaluacion_fecha) + ')' : '') : '—',
      p.estado ? p.estado.charAt(0) + p.estado.slice(1).toLowerCase() : ''])) +
    '<p class="nota">Estatus: aprobado si la calificación promedio es mayor a 5,0 (escala 1 a 10, PRO-04). Evaluación anual en FO-PRO-04-02.</p>' }];
}
function seccionesGeneradas_(db, doc, fuente) {
  switch (fuente) {
    case 'FODA': return generarFoda_(db);
    case 'PARTES': return generarPartes_(db);
    case 'OBJETIVOS': return generarObjetivos_(db);
    case 'RIESGOS': return generarRiesgos_(db);
    case 'MAPA': return generarMapa_(db);
    case 'SERVICIOS': return generarServicios_(db, doc);
    case 'LISTADO_MAESTRO': return generarListadoMaestro_(db);
    case 'PROVEEDORES': return generarProveedores_(db);
    default: return [];
  }
}

// --- control de cambios: el escrito + las versiones publicadas en SIGSO --------------
function controlCambios_(db, doc, contenido) {
  const filas = (contenido && contenido.control_cambios ? contenido.control_cambios : []).map((c) => ({ version: numeroVersion_(c.version), fecha: c.fecha, descripcion: c.descripcion }));
  const vistas = {};
  filas.forEach((f) => { vistas[f.version] = true; });
  leerSeguro_(db, 'SGC_DOC_VERSIONES').filter((v) => v.documento_id === doc.documento_id)
    .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')))
    .forEach((v) => {
      const n = numeroVersion_(v.version);
      if (vistas[n] || !String(v.cambios || '').trim()) return;
      vistas[n] = true;
      filas.push({ version: n, fecha: mesAnio_(v.fecha), descripcion: v.cambios });
    });
  if (!filas.length) filas.push({ version: numeroVersion_(doc.version_vigente), fecha: mesAnio_(doc.fecha_vigencia), descripcion: 'Primera edición del documento (creación)' });
  // En orden de versión (01, 02...): el escrito y las versiones de SIGSO se
  // juntan de dos fuentes y no llegan ordenados.
  return filas.map((f, i) => ({ f, i })).sort((a, b) => ((parseFloat(a.f.version) || 0) - (parseFloat(b.f.version) || 0)) || (a.i - b.i)).map((x) => x.f);
}

// --- armado del documento (HTML para pantalla y para el PDF) ----------------------
let logoDataUri_ = null;
function logoDataUri_Leer() {
  if (logoDataUri_ !== null) return logoDataUri_;
  try {
    logoDataUri_ = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'assets', 'marca', 'homepymes-logo.png')).toString('base64');
  } catch (e) { logoDataUri_ = ''; }
  return logoDataUri_;
}

/**
 * Datos comunes del documento: lo que va en el encabezado y en la portada.
 * version: fila de SGC_DOC_VERSIONES si se pide una versión anterior.
 */
function metaDocumento_(doc, version) {
  return {
    codigo: doc.codigo, nombre: doc.nombre, tipo: doc.tipo,
    etiqueta: ETIQUETA_TIPO[doc.tipo] || 'DOCUMENTO',
    version: numeroVersion_(version ? version.version : doc.version_vigente),
    vigencia: mesAnio_(version ? version.fecha : doc.fecha_vigencia),
    elaborado: doc.elaborado_por || '', revisado: doc.revisado_por || '', aprobado: doc.aprobado_por || '',
    fecha_aprobacion: mesAnio_(doc.fecha_aprobacion || doc.fecha_vigencia)
  };
}

/** Cuerpo del documento en HTML (secciones numeradas + control de cambios). */
function cuerpoHtml_(db, doc, contenido, fuente) {
  const partes = [];
  const meta = metaDocumento_(doc, null);
  const conPortada = contenido && contenido.portada !== undefined ? contenido.portada : (doc.tipo === 'PRO' || String(doc.codigo).toUpperCase() === 'DOC-01');
  if (conPortada) {
    partes.push('<section class="portada"><div class="portada__titulo">' + esc_(String(doc.nombre || '').toUpperCase()) + '</div>' +
      tabla_(['Elaborado por:', 'Revisado por:', 'Aprobado por:'], [[meta.elaborado, meta.revisado, meta.aprobado], [meta.vigencia, meta.vigencia, meta.fecha_aprobacion || meta.vigencia]], 'firmas') +
      '</section>');
  } else {
    partes.push('<h1 class="titulo-doc">' + esc_(String(doc.nombre || '').toUpperCase()) + '</h1>' +
      (contenido && contenido.subtitulo ? '<p class="subtitulo-doc">' + esc_(contenido.subtitulo) + '</p>' : ''));
  }
  let n = 0;
  if (fuente) {
    seccionesGeneradas_(db, doc, fuente).forEach((s) => {
      partes.push('<section class="seccion' + (s.salto ? ' seccion--salto' : '') + '">' + (s.titulo ? '<h2>' + esc_(s.titulo) + '</h2>' : '') + s.html + '</section>');
    });
    // Un documento generado puede tener además texto propio (notas, alcance...).
    (contenido ? contenido.secciones : []).forEach((s) => {
      if (!s.texto.trim()) return;
      partes.push('<section class="seccion">' + (s.titulo ? '<h2>' + esc_(s.titulo) + '</h2>' : '') + textoAHtml_(s.texto) + '</section>');
    });
  } else {
    (contenido ? contenido.secciones : []).forEach((s) => {
      const numerada = doc.tipo === 'PRO' || conPortada;
      if (numerada && s.titulo) n++;
      partes.push('<section class="seccion">' + (s.titulo ? '<h2>' + (numerada ? n + '. ' : '') + esc_(s.titulo) + '</h2>' : '') +
        (s.texto.trim() ? textoAHtml_(s.texto) : '<p class="vacio">—</p>') + '</section>');
    });
  }
  const cc = controlCambios_(db, doc, contenido);
  partes.push('<section class="seccion seccion--cambios"><h2>' + ((doc.tipo === 'PRO' || conPortada) && !fuente ? (n + 1) + '. ' : '') + 'CONTROL DE CAMBIOS</h2>' +
    tabla_(['Versión', 'Fecha', 'Identificación de la modificación'], cc.map((c) => [c.version, c.fecha, c.descripcion]), 'cambios') + '</section>');
  return partes.join('\n');
}

const CSS_DOCUMENTO_ = [
  '*{box-sizing:border-box}',
  'body{margin:0;font-family:Arial,"Liberation Sans",Helvetica,sans-serif;font-size:10pt;color:#000;line-height:1.35}',
  'a{color:#1a3a5c}',
  '.portada{page-break-after:always;padding-top:6mm}',
  '.portada__titulo{border:1px solid #000;height:120mm;display:flex;align-items:center;justify-content:center;text-align:center;font-weight:bold;font-size:14pt;padding:10mm;margin-bottom:14mm}',
  '.titulo-doc{font-size:13pt;text-align:center;margin:2mm 0 5mm;font-weight:bold}',
  '.subtitulo-doc{text-align:center;margin:-3mm 0 5mm}',
  'h2{font-size:10.5pt;font-weight:bold;margin:6mm 0 2.5mm;text-transform:none}',
  'h3{font-size:10pt;font-weight:bold;margin:4mm 0 2mm}',
  'p{margin:0 0 2.5mm;text-align:justify}',
  'ul,ol{margin:0 0 2.5mm;padding-left:7mm}',
  'li{margin:0 0 1mm}',
  'ol.marcada{list-style:none;padding-left:4mm}',
  'ol.marcada .marca{font-weight:bold}',
  'ol.foda{margin:0;padding-left:5mm}',
  '.seccion{break-inside:auto}',
  // Un título nunca queda solo al pie de una página.
  'h2,h3{break-after:avoid;page-break-after:avoid}',
  '.seccion--salto{break-before:page}',
  '.seccion--cambios{break-inside:avoid;margin-top:8mm}',
  'table.tabla{width:100%;border-collapse:collapse;margin:1mm 0 4mm;font-size:9pt}',
  'table.tabla th,table.tabla td{border:1px solid #000;padding:1.6mm 2mm;vertical-align:top;text-align:left}',
  'table.tabla th{background:#e7eaee;font-weight:bold}',
  'table.tabla thead{display:table-header-group}',
  'table.tabla tr{break-inside:avoid}',
  'table.densa{font-size:7.5pt}',
  'table.densa th,table.densa td{padding:1.2mm 1.4mm}',
  'table.firmas th,table.firmas td{text-align:center;width:33.3%;padding:3mm 2mm}',
  'table.foda-grid th{text-align:center;width:50%}',
  'table.cambios td:first-child,table.cambios th:first-child{width:18mm;text-align:center}',
  'table.cambios td:nth-child(2),table.cambios th:nth-child(2){width:32mm}',
  '.vacio{color:#666}',
  '.nota{font-size:8.5pt;color:#333}'
].join('\n');

/** Plantilla del encabezado de Chromium (se repite en cada página). */
function cabeceraPdf_(meta) {
  const logo = logoDataUri_Leer();
  const celda = 'border:1px solid #000;padding:3px 6px;';
  return '<div style="width:100%;padding:0 12mm;font-family:Arial,Helvetica,sans-serif;font-size:8.5px;color:#000;-webkit-print-color-adjust:exact">' +
    '<table style="width:100%;border-collapse:collapse;table-layout:fixed"><tr>' +
      '<td rowspan="3" style="' + celda + 'width:22%;text-align:center">' + (logo ? '<img src="' + logo + '" style="height:46px">' : '<b>HOMEPYMES</b>') + '</td>' +
      '<td rowspan="3" style="' + celda + 'width:48%;text-align:center;font-weight:bold;font-size:11px">' + esc_(meta.etiqueta) + '</td>' +
      '<td colspan="2" style="' + celda + 'width:30%">Código: <b>' + esc_(meta.codigo) + '</b>' + (meta.version ? ' &nbsp; Versión: <b>' + esc_(meta.version) + '</b>' : '') + '</td></tr>' +
    '<tr><td style="' + celda + '">Fecha vigencia</td><td style="' + celda + '">' + esc_(meta.vigencia || '—') + '</td></tr>' +
    '<tr><td style="' + celda + '">Página</td><td style="' + celda + '"><span class="pageNumber"></span> de <span class="totalPages"></span></td></tr>' +
    '</table></div>';
}
function piePdf_(meta) {
  return '<div style="width:100%;padding:0 12mm;font-family:Arial,Helvetica,sans-serif;font-size:7px;color:#555;display:flex;justify-content:space-between">' +
    '<span>' + esc_(meta.codigo + ' · ' + meta.nombre) + '</span><span>Documento controlado en SIGSO · una copia impresa no es controlada</span></div>';
}

function htmlCompleto_(cuerpo, titulo) {
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + esc_(titulo) + '</title><style>' + CSS_DOCUMENTO_ + '</style></head><body>' + cuerpo + '</body></html>';
}

// ===========================================================================
// API pública
// ===========================================================================

/** Contenido del documento para leerlo o editarlo en SIGSO. */
function getContenido(db, data, contexto) {
  const doc = buscarDoc_(db, data.documento_id);
  if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
  const acceso = Calidad.getDocumento(db, { documento_id: doc.documento_id }, contexto);
  if (acceso && (acceso._forbidden || acceso._validationError)) return acceso;
  const gobierna = Calidad.gobiernaSgc_(db, contexto);
  const fuente = fuenteDe_(doc);
  const contenido = parsearContenido_(doc.contenido);
  const borrador = gobierna ? parsearContenido_(doc.contenido_borrador) : null;
  const confirmada = leerSeguro_(db, 'SGC_DOC_ACUSES').some((a) => a.documento_id === doc.documento_id && String(a.version) === String(doc.version_vigente));
  return {
    documento_id: doc.documento_id, codigo: doc.codigo, nombre: doc.nombre, tipo: doc.tipo,
    version_vigente: doc.version_vigente, fecha_vigencia: doc.fecha_vigencia, estado: doc.estado,
    fuente, fuente_info: fuente ? FUENTES[fuente] : null,
    contenido, borrador, tiene_contenido: !!(contenido && contenido.secciones.length) || !!fuente,
    plantilla: gobierna && !contenido ? plantillaVacia_(doc) : null,
    enlace_drive: doc.enlace_drive || '',
    puede_editar: gobierna, version_confirmada: confirmada,
    html: cuerpoHtml_(db, doc, contenido, fuente),
    css: CSS_DOCUMENTO_,
    // El mismo encabezado del PDF, para que la vista en pantalla sea el papel.
    cabecera: cabeceraPdf_(metaDocumento_(doc, null)),
    meta: metaDocumento_(doc, null)
  };
}

/**
 * Guarda el texto. modo 'vigente' corrige la versión vigente en el lugar (solo
 * si nadie la confirmó todavía); si ya hay confirmaciones, o modo 'borrador',
 * queda como borrador para publicarlo como versión nueva.
 */
function guardarContenido(db, data, contexto) {
  const doc = buscarDoc_(db, data.documento_id);
  if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden editar el contenido.' };
  if (doc.tipo === 'EXTERNO') return errorValidacion_('documento_id', 'Un documento externo (norma o ley) no se redacta en SIGSO.');
  const cambios = {};
  if (data.enlace_drive !== undefined) {
    const url = String(data.enlace_drive || '').trim();
    if (url && !/^https:\/\/(drive|docs)\.google\.com\/\S+$/i.test(url)) return errorValidacion_('enlace_drive', 'El enlace debe ser de Google Drive o Google Docs.');
    cambios.enlace_drive = url.slice(0, 2000);
  }
  if (data.contenido_fuente !== undefined) {
    const f = String(data.contenido_fuente || '').toUpperCase();
    if (f && f !== 'TEXTO' && !FUENTES[f]) return errorValidacion_('contenido_fuente', 'Fuente inválida.');
    cambios.contenido_fuente = f;
  }
  let modo = '';
  if (data.contenido !== undefined) {
    const c = contenidoValido_(data.contenido);
    if (c._validationError) return c;
    const confirmada = leerSeguro_(db, 'SGC_DOC_ACUSES').some((a) => a.documento_id === doc.documento_id && String(a.version) === String(doc.version_vigente));
    modo = data.modo === 'borrador' || confirmada ? 'borrador' : 'vigente';
    if (modo === 'vigente') {
      cambios.contenido = JSON.stringify(c);
      cambios.contenido_borrador = '';
      sincronizarVersion_(db, doc, c, contexto);
    } else {
      cambios.contenido_borrador = JSON.stringify(c);
    }
  }
  if (!Object.keys(cambios).length) return errorValidacion_('contenido', 'No hay cambios que guardar.');
  const act = actualizarFilaPorId_(db, 'SGC_DOCUMENTOS', 'documento_id', doc.documento_id, cambios);
  registrarLog_(db, modo === 'borrador' ? 'SGC_DOC_BORRADOR' : 'SGC_DOC_CONTENIDO', doc.codigo + (modo ? ' (' + modo + ')' : ''), contexto);
  return { documento_id: act.documento_id, modo: modo || 'datos', message: modo === 'borrador' ? 'Guardado como borrador: publícalo como versión nueva para que rija.' : 'Guardado.' };
}

function sincronizarVersion_(db, doc, contenido, contexto) {
  const fila = leerSeguro_(db, 'SGC_DOC_VERSIONES').find((v) => v.documento_id === doc.documento_id && String(v.version) === String(doc.version_vigente));
  if (fila) {
    actualizarFilaPorId_(db, 'SGC_DOC_VERSIONES', 'version_id', fila.version_id, { contenido: JSON.stringify(contenido) });
    return;
  }
  agregarFila_(db, 'SGC_DOC_VERSIONES', {
    version_id: uuid_(), documento_id: doc.documento_id, version: doc.version_vigente, cambios: '',
    archivo_id: doc.archivo_id || '', archivo_nombre: doc.archivo_nombre || '', archivo_mime: doc.archivo_mime || '',
    subido_por: (contexto && contexto.email) || '', fecha: doc.fecha_vigencia || new Date().toISOString(), vigente: true,
    contenido: JSON.stringify(contenido)
  });
}

/** Publica el borrador como versión nueva (con su fila en el control de cambios). */
function publicarBorrador(db, data, contexto) {
  const doc = buscarDoc_(db, data.documento_id);
  if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden publicar versiones.' };
  const borrador = parsearContenido_(doc.contenido_borrador) || (data.contenido ? contenidoValido_(data.contenido) : null);
  if (!borrador || borrador._validationError) return errorValidacion_('contenido', 'No hay un borrador que publicar.');
  const version = String(data.version || '').trim();
  if (!version) return errorValidacion_('version', 'Indica el número de la nueva versión (ej. v02).');
  if (version === doc.version_vigente) return errorValidacion_('version', 'Esa ya es la versión vigente.');
  const cambiosTxt = String(data.cambios || '').trim();
  if (!cambiosTxt) return errorValidacion_('cambios', 'Describe qué cambió: queda en el control de cambios.');
  const fechaVig = data.fecha_vigencia || new Date().toISOString();
  const cc = (borrador.control_cambios || []).slice();
  cc.push({ version: numeroVersion_(version), fecha: mesAnio_(fechaVig), descripcion: cambiosTxt });
  const contenido = Object.assign({}, borrador, { control_cambios: cc });

  leerSeguro_(db, 'SGC_DOC_VERSIONES').forEach((v) => {
    if (v.documento_id === doc.documento_id && esVerdadero_(v.vigente)) actualizarFilaPorId_(db, 'SGC_DOC_VERSIONES', 'version_id', v.version_id, { vigente: false });
  });
  agregarFila_(db, 'SGC_DOC_VERSIONES', {
    version_id: uuid_(), documento_id: doc.documento_id, version, cambios: cambiosTxt,
    archivo_id: '', archivo_nombre: '', archivo_mime: '',
    subido_por: (contexto && contexto.email) || '', fecha: fechaVig, vigente: true, contenido: JSON.stringify(contenido)
  });
  const prox = new Date(fechaVig);
  if (!isNaN(prox.getTime())) prox.setFullYear(prox.getFullYear() + 1);
  actualizarFilaPorId_(db, 'SGC_DOCUMENTOS', 'documento_id', doc.documento_id, {
    version_vigente: version, fecha_vigencia: fechaVig, proxima_revision: isNaN(prox.getTime()) ? '' : prox.toISOString(),
    contenido: JSON.stringify(contenido), contenido_borrador: '',
    // La copia controlada ahora es el texto en SIGSO: el archivo de la versión
    // anterior queda en su fila del historial, no como copia vigente.
    archivo_id: '', archivo_nombre: '', archivo_mime: '', estado: 'VIGENTE'
  });
  registrarLog_(db, 'SGC_DOC_NUEVA_VERSION', doc.codigo + ' → ' + version + ' (contenido en SIGSO)', contexto);
  return { documento_id: doc.documento_id, version, message: 'Versión ' + version + ' publicada.' };
}

function descartarBorrador(db, data, contexto) {
  const doc = buscarDoc_(db, data.documento_id);
  if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
  if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC o un administrador pueden descartar borradores.' };
  actualizarFilaPorId_(db, 'SGC_DOCUMENTOS', 'documento_id', doc.documento_id, { contenido_borrador: '' });
  return { documento_id: doc.documento_id, message: 'Borrador descartado.' };
}

/** PDF con el formato de la empresa. version_id opcional (histórico, solo quien gobierna). */
async function descargarPdf(db, data, contexto) {
  const doc = buscarDoc_(db, data.documento_id);
  if (!doc) return errorValidacion_('documento_id', 'Documento no encontrado.');
  const acceso = Calidad.getDocumento(db, { documento_id: doc.documento_id }, contexto);
  if (acceso && (acceso._forbidden || acceso._validationError)) return acceso;
  if (doc.tipo === 'EXTERNO') return errorValidacion_('documento_id', 'Un documento externo no se genera en SIGSO.');
  let contenido = parsearContenido_(doc.contenido);
  let version = null;
  if (data.version_id) {
    if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC puede descargar versiones anteriores.' };
    version = leerSeguro_(db, 'SGC_DOC_VERSIONES').find((v) => v.version_id === data.version_id && v.documento_id === doc.documento_id);
    if (!version) return errorValidacion_('version_id', 'Versión no encontrada.');
    contenido = parsearContenido_(version.contenido);
  }
  if (data.borrador) {
    if (!Calidad.gobiernaSgc_(db, contexto)) return { _forbidden: true, message: 'Solo el Encargado SGC puede ver borradores.' };
    contenido = parsearContenido_(doc.contenido_borrador) || contenido;
  }
  const fuente = fuenteDe_(doc);
  if (!fuente && !(contenido && contenido.secciones.length)) return errorValidacion_('documento_id', 'Este documento todavía no tiene contenido escrito en SIGSO.');
  if (!Motor.disponible()) return errorValidacion_('documento_id', 'El generador de PDF no está disponible en este servidor.');
  const meta = metaDocumento_(doc, version);
  const html = htmlCompleto_(cuerpoHtml_(db, doc, contenido, fuente), doc.codigo + ' ' + doc.nombre);
  const horizontal = !!(fuente && FUENTES[fuente].horizontal);
  try {
    const buf = await Motor.htmlAPdf(html, {
      cabecera: cabeceraPdf_(meta), pie: piePdf_(meta), horizontal,
      margen: { top: '34mm', bottom: '14mm', left: '14mm', right: '14mm' }
    });
    registrarLog_(db, 'SGC_DOC_DESCARGADO', doc.codigo + ' ' + doc.nombre + ' (PDF generado)', contexto);
    const nombre = ReportePdf.nombreArchivo_(doc.codigo + ' ' + doc.nombre + ' v' + meta.version + (data.borrador ? ' BORRADOR' : ''));
    return { contenido_base64: buf.toString('base64'), nombre_archivo: nombre, mime: 'application/pdf' };
  } catch (e) {
    const msg = e && e.codigo === 'OCUPADO' ? 'El generador de PDF está ocupado. Inténtalo en unos segundos.' : 'No se pudo generar el PDF.';
    return errorValidacion_('documento_id', msg);
  }
}

function registrarLog_(db, accion, detalle, contexto) {
  try {
    agregarFila_(db, 'LOG_SISTEMA', {
      log_id: uuid_(), timestamp: new Date().toISOString(), contexto: accion,
      mensaje: ((contexto && contexto.email) || '') + ' → ' + detalle, ref: 'SGC'
    });
  } catch (err) { /* trazabilidad, no el flujo principal */ }
}

module.exports = {
  getContenido, guardarContenido, publicarBorrador, descartarBorrador, descargarPdf,
  // Para tests y para el control documental (un documento con texto o
  // generado desde datos ya tiene copia controlada: la de SIGSO).
  textoAHtml_, contenidoValido_, fuenteDe_, cuerpoHtml_, cabeceraPdf_, FUENTES, FUENTE_POR_CODIGO, SECCIONES_PROCEDIMIENTO
};
