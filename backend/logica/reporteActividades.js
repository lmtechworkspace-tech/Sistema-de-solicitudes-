'use strict';

/**
 * reporteActividades.js — puerto de backend/backoffice/ReporteActividades.gs
 * (v7.0 Fase 5, §4.8): "3 motores + filtros comunes" en PDF, más la
 * "Acta de reunión de seguimiento". La lógica de datos (qué filas salen,
 * cómo se calculan los resúmenes) ya vive portada en actividades.js
 * (generarReporte/generarActaReunion) — este módulo SOLO dibuja esos
 * datos como PDF, igual que el .gs solo los convertía a HTML.
 *
 * Diferencia de diseño respecto del .gs: reusa el mismo "chrome"
 * (pdfDocumento.js) que Orden de Trabajo, en vez de un encabezado propio
 * más simple — mismo criterio ya documentado ahí (contenido > pixel a
 * pixel) y de paso unifica la papelería de SIGSO en un solo estilo.
 */

const Actividades = require('./actividades');
const Utils = require('./utils');
const PdfDoc = require('./pdfDocumento');
const DocV2 = require('./documentoV2');

const TITULOS = {
  estado_actual: 'Estado actual',
  cumplimiento_periodo: 'Cumplimiento del período',
  carga_capacidad: 'Carga y capacidad'
};

const ETIQUETAS_RESUMEN = {
  total: 'Total', comprometidas: 'Comprometidas', cumplidas_a_tiempo: 'Cumplidas a tiempo',
  pct_cumplimiento: '% cumplimiento', vencidas: 'Vencidas',
  reprogramaciones_promedio: 'Reprogramaciones prom.', emergentes: 'Emergentes', pct_emergente: '% emergente'
};

function formatearCelda_(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(valor)) return PdfDoc.fechaCorta_(valor);
  return String(valor);
}

// Reporte tabular v2 (R-3b): el resumen como tarjetas y la tabla con nombres (no
// correos), fechas legibles y la situación con color. Es un listado para exportar;
// el análisis en 4 niveles es el de la pantalla (Gerencia › Actividades).
const ESTADO_ACT = { NO_INICIADA: 'No iniciada', EN_CURSO: 'En curso', BLOQUEADA: 'Bloqueada', EN_REVISION: 'En revisión',
  TERMINADA: 'Terminada', CANCELADA: 'Cancelada' };
const TONO_SEMAFORO = { Atrasada: 'critico', Bloqueada: 'critico', 'Vence hoy': 'alerta', 'Vence mañana': 'alerta',
  'Por confirmar': 'info', 'En revisión': 'info', 'Al día': 'ok', Terminada: 'neutro' };
async function descargarReporteV2_(db, data, contexto, reporte) {
  const { R, U } = DocV2.piezas();
  const nombres = DocV2.nombresPorCorreo(db);
  const celda = (campo, v) => {
    if (v === null || v === undefined || v === '') return '—';
    const t = String(v);
    if (campo === 'semaforo') return U.badge(t, TONO_SEMAFORO[t] || 'neutro', true);
    if (campo === 'estado') return U.esc(ESTADO_ACT[t] || t);
    if (t === '(sin área)') return '—';
    if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(t)) return U.esc(DocV2.fecha_(t, true));
    if (/^[^\s@]+@[^\s@]+$/.test(t)) return U.esc(nombres[t.toLowerCase()] || t);
    return U.esc(t);
  };
  const resumen = Object.keys(reporte.resumen || {}).map((k) => ({ etiqueta: ETIQUETAS_RESUMEN[k] || k, valor: formatearCelda_(reporte.resumen[k]) }));
  const tabla = '<div class="rp2-detalle">' + R.tabla(reporte.columnas.map((c) => ({ campo: c.campo, titulo: c.etiqueta, html: true })),
    reporte.filas.map((f) => { const o = {}; reporte.columnas.forEach((c) => { o[c.campo] = celda(c.campo, f[c.campo]); }); return o; }),
    { vacio: 'Sin datos para estos filtros.' }) + '</div>';
  return DocV2.aPdf(db, contexto, {
    titulo: 'Actividades · ' + (TITULOS[reporte.tipo] || 'Reporte'), modulo: 'Panel de gerencia · Actividades',
    codigo: 'SIGSO-REP-ACT-' + String(reporte.tipo || '').toUpperCase(),
    cuerpo: (resumen.length ? R.nivel('Resumen', R.kpis(resumen)) : '') + R.nivel('Detalle', tabla, { nota: reporte.filas.length + ' filas' }),
    nombreArchivo: 'sigso-actividades-' + reporte.tipo
  });
}

async function descargarReporte(db, data, contexto) {
  const reporte = Actividades.generarReporte(db, data, contexto);
  if (reporte && (reporte._validationError || reporte._forbidden)) return reporte;
  if (DocV2.disponible()) {
    try { return await descargarReporteV2_(db, data, contexto, reporte); } catch (e) {
      console.error('[reporte actividades] sin diseño v2, se usa pdfkit:', e && e.message);
    }
  }

  const doc = PdfDoc.crearDocumento();
  PdfDoc.encabezado(doc, { tipoDoc: TITULOS[reporte.tipo] || 'Reporte', referencia: '', etiquetaReferencia: '' });
  const resumenPares = Object.keys(reporte.resumen || {}).map((k) => [ETIQUETAS_RESUMEN[k] || k, formatearCelda_(reporte.resumen[k])]);
  if (resumenPares.length) PdfDoc.lineaResumen(doc, resumenPares);
  PdfDoc.tablaGenerica(doc, reporte.columnas, reporte.filas, (v) => formatearCelda_(v));
  PdfDoc.pie(doc);
  const buffer = await PdfDoc.finalizar(doc);

  const filename = 'SIGSO-reporte-' + data.tipo + '-' + Utils.claveDia_(new Date(), 'America/Santiago') + '.pdf';
  return { pdf_base64: buffer.toString('base64'), filename };
}

function seccionActa_(doc, titulo, filas, campoExtra) {
  PdfDoc.seccion(doc, titulo);
  if (!filas.length) {
    doc.font('Helvetica').fontSize(9).fillColor(PdfDoc.DOC.MUTED).text('Nada que reportar.', PdfDoc.MARGIN, doc.y);
    doc.moveDown(0.6);
    return;
  }
  const items = filas.map((f) => {
    let linea = f.titulo + ' — ' + f.responsable + ' (' + f.area + ')';
    if (campoExtra && f[campoExtra]) linea += ' · ' + f[campoExtra];
    if (f.fecha_compromiso) linea += ' · vence ' + PdfDoc.fechaCorta_(f.fecha_compromiso);
    return { texto: linea };
  });
  PdfDoc.asegurarEspacio(doc, 14);
  items.forEach((it) => {
    doc.font('Helvetica').fontSize(9).fillColor(PdfDoc.DOC.INK);
    const altura = doc.heightOfString('•  ' + it.texto, { width: PdfDoc.CONTENT_WIDTH - 10 }) + 4;
    PdfDoc.asegurarEspacio(doc, altura);
    doc.text('•  ' + it.texto, PdfDoc.MARGIN, doc.y, { width: PdfDoc.CONTENT_WIDTH - 10 });
    doc.moveDown(0.15);
  });
  doc.x = PdfDoc.MARGIN;
  doc.moveDown(0.4);
}

// --- Acta v2 (R-3b de la auditoría de reportes) -------------------------------------------
// ¿Qué decidimos y quién lo hace? En una línea (conteos) · Lo que requiere decisión
// (vencido y bloqueado AGRUPADO POR RESPONSABLE) · Para planificar (vence la semana
// entrante, lo reprogramado) · Acuerdos (una fila por punto con espacio para escribir).
// Se arma con las mismas piezas de los reportes en pantalla (ver documentoV2.js).
function diasDesde_(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const hoy = Utils.claveDia_(new Date(), 'America/Santiago').split('-').map(Number);
  return Math.round((Date.UTC(hoy[0], hoy[1] - 1, hoy[2]) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000);
}
function cuerpoActaV2_(acta, nombres, R, U, fecha) {
  const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);
  const alta = (a) => a.prioridad === 'P1' || a.prioridad === 'P2';
  const clave = (a) => String(a.responsable_email || a.responsable || '').toLowerCase();
  const nombre = (a) => nombres[String(a.responsable_email || '').toLowerCase()] ||
    (a.responsable && !/@/.test(a.responsable) ? a.responsable : nombres[String(a.responsable || '').toLowerCase()] || a.responsable || '(sin responsable)');
  const venc = acta.vencidas || [], blo = acta.bloqueadas || [], rep = acta.reprogramadas_semana || [], prox = acta.vence_semana_entrante || [];
  const vencAltas = venc.filter(alta).length;

  // 1 · En una línea
  const nada = !venc.length && !blo.length && !rep.length && !prox.length;
  const estado = nada ? 'neutro' : (vencAltas || blo.length ? 'critico' : (venc.length ? 'alerta' : 'ok'));
  const frase = nada ? 'No hay actividades vencidas, bloqueadas, reprogramadas ni por vencer: reunión corta.' :
    'Para esta reunión: ' + plural(venc.length, 'actividad vencida', 'actividades vencidas') + (vencAltas ? ' (' + vencAltas + ' P1/P2)' : '') +
    ', ' + plural(blo.length, 'bloqueada', 'bloqueadas') + ', ' + plural(rep.length, 'se reprogramó', 'se reprogramaron') + ' esta semana y ' +
    plural(prox.length, 'vence', 'vencen') + ' la semana entrante.';
  const linea = R.enUnaLinea({ estado, frase, kpis: [
    { etiqueta: 'Vencidas', valor: venc.length, icono: 'alerta', tono: venc.length ? 'critico' : 'ok', nota: vencAltas ? vencAltas + ' de prioridad alta' : 'ninguna P1/P2' },
    { etiqueta: 'Bloqueadas', valor: blo.length, icono: 'pausado', tono: blo.length ? 'critico' : 'ok', nota: blo.length ? 'necesitan que alguien destrabe' : 'ninguna' },
    { etiqueta: 'Reprogramadas', valor: rep.length, icono: 'calendario', tono: rep.length ? 'alerta' : 'ok', nota: 'esta semana' },
    { etiqueta: 'Vencen pronto', valor: prox.length, icono: 'reloj', tono: prox.length ? 'info' : 'neutro', nota: 'la semana entrante' }
  ] });

  // 2 · Lo que requiere decisión: una fila por responsable con lo vencido y bloqueado.
  const porPersona = {};
  venc.concat(blo).forEach((a) => {
    const k = clave(a);
    const p = porPersona[k] = porPersona[k] || { nombre: nombre(a), venc: 0, blo: 0, altas: 0, masVieja: 0, ej: [] };
    if (blo.indexOf(a) === -1) { p.venc++; p.masVieja = Math.max(p.masVieja, diasDesde_(a.fecha_compromiso) || 0); } else p.blo++;
    if (alta(a)) p.altas++;
    const t = '«' + a.titulo + '»';
    if (p.ej.indexOf(t) === -1 && (p.ej.length < 2 || alta(a))) p.ej.push(t);
  });
  const alertas = Object.keys(porPersona).map((k) => {
    const p = porPersona[k], n = p.venc + p.blo;
    return { severidad: p.altas || p.blo || n >= 3 || p.masVieja > 10 ? 'critico' : 'alerta', cantidad: n, titulo: p.nombre,
      detalle: [p.venc ? plural(p.venc, 'vencida', 'vencidas') + (p.masVieja ? ', la más antigua hace ' + plural(p.masVieja, 'día', 'días') : '') : '',
        p.blo ? plural(p.blo, 'bloqueada', 'bloqueadas') : '', p.altas ? p.altas + ' P1/P2' : ''].filter(Boolean).join(' · ') +
        (p.ej.length ? ' — ' + p.ej.slice(0, 2).join(', ') : '') };
  });
  const decision = R.requiereDecision(alertas, { vacio: 'Nadie tiene actividades vencidas ni bloqueadas.' });

  // 3 · Para planificar
  const area = (a) => (a.area && a.area !== '(sin área)' ? a.area : '');
  const item = (a, extra) => '<span class="rp2-item"><strong>' + U.esc(a.titulo) + '</strong>' + (extra ? '<small>' + U.esc(extra) + '</small>' : '') + '</span>';
  const filaCorta = (a, extra) => ({ act: item(a, area(a)),
    resp: U.esc(nombre(a)), extra: extra });
  // Una debajo de la otra: en A4, lado a lado cortan la columna del motivo.
  const planificar =
    '<div><h3 class="rp2-sub">Vence la semana entrante</h3><div class="rp2-detalle">' +
      R.tabla([{ campo: 'act', titulo: 'Actividad', html: true }, { campo: 'resp', titulo: 'Responsable', html: true }, { campo: 'extra', titulo: 'Vence', html: true }],
        prox.slice().sort((a, b) => String(a.fecha_compromiso).localeCompare(String(b.fecha_compromiso))).map((a) => filaCorta(a, U.esc(fecha(a.fecha_compromiso)))),
        { vacio: 'Nada vence la semana entrante.' }) + '</div></div>' +
    '<div><h3 class="rp2-sub">Se reprogramó esta semana</h3><div class="rp2-detalle">' +
      R.tabla([{ campo: 'act', titulo: 'Actividad', html: true }, { campo: 'resp', titulo: 'Responsable', html: true }, { campo: 'extra', titulo: 'Motivo', html: true }],
        rep.map((a) => filaCorta(a, U.esc(a.motivo || '—'))), { vacio: 'Nada se reprogramó esta semana.' }) + '</div></div>';

  // 4 · Acuerdos: lo que se discute, con espacio para escribir el acuerdo en la reunión.
  const puntos = venc.map((a) => ({ a, sit: U.badge('Vencida' + (diasDesde_(a.fecha_compromiso) ? ' hace ' + diasDesde_(a.fecha_compromiso) + ' d' : ''), 'critico', true) }))
    .concat(blo.map((a) => ({ a, sit: U.badge('Bloqueada', 'critico', true) + (a.motivo ? '<small class="rp2-acta-motivo">' + U.esc(a.motivo) + '</small>' : '') })))
    .sort((x, y) => (alta(y.a) ? 1 : 0) - (alta(x.a) ? 1 : 0) || nombre(x.a).localeCompare(nombre(y.a), 'es'));
  const acuerdos = '<div class="rp2-detalle rp2-acta">' + R.tabla([
    { campo: 'act', titulo: 'Punto', html: true }, { campo: 'resp', titulo: 'Responsable', html: true }, { campo: 'sit', titulo: 'Situación', html: true },
    { campo: 'acuerdo', titulo: 'Acuerdo', html: true }, { campo: 'fecha', titulo: 'Nueva fecha', html: true }
  ], puntos.map((p) => ({
    act: item(p.a, [area(p.a), p.a.prioridad].filter(Boolean).join(' · ')),
    resp: U.esc(nombre(p.a)), sit: p.sit, acuerdo: '<span class="rp2-escribir"></span>', fecha: '<span class="rp2-escribir"></span>'
  })), { vacio: 'Sin puntos pendientes.' }) + '</div>' +
  '<div class="rp2-acta-firmas"><div><span class="rp2-escribir"></span><small>Asistentes</small></div><div><span class="rp2-escribir"></span><small>Próxima reunión</small></div></div>';

  return R.nivel('En una línea', linea) +
    R.nivel('Lo que requiere decisión', decision, { nota: alertas.length ? 'por responsable · la cifra es cuántas' : '' }) +
    R.nivel('Para planificar', planificar) +
    R.nivel('Acuerdos', acuerdos, { clase: 'rp2-nivel--detalle', nota: plural(puntos.length, 'punto', 'puntos') + ' · se completa en la reunión' });
}

async function descargarActaV2_(db, data, contexto, acta) {
  const { R, U } = DocV2.piezas();
  const semana = acta.semana ? DocV2.fecha_(acta.semana.desde) + ' al ' + DocV2.fecha_(acta.semana.hasta, true) : '';
  return DocV2.aPdf(db, contexto, {
    titulo: 'Acta de reunión de seguimiento', subtitulo: '¿Qué decidimos y quién lo hace?', modulo: 'Panel de gerencia · Actividades',
    codigo: 'SIGSO-ACTA-' + Utils.claveDia_(new Date(), 'America/Santiago'), periodo: semana ? 'Semana del ' + semana : '',
    filtros: [{ etiqueta: 'Área', valor: acta.area || 'Todas' }, { etiqueta: 'Prioridad', valor: acta.prioridad || 'Todas' }],
    cuerpo: cuerpoActaV2_(acta, DocV2.nombresPorCorreo(db), R, U, DocV2.fecha_),
    nombreArchivo: 'sigso-acta-reunion'
  });
}

async function descargarActa(db, data, contexto) {
  const acta = Actividades.generarActaReunion(db, data || {}, contexto);
  if (DocV2.disponible()) {
    try { return await descargarActaV2_(db, data, contexto, acta); } catch (e) {
      console.error('[acta] sin diseño v2, se usa pdfkit:', e && e.message);
    }
  }

  const doc = PdfDoc.crearDocumento();
  PdfDoc.encabezado(doc, { tipoDoc: 'Acta de reunión de seguimiento', referencia: '', etiquetaReferencia: '' });
  seccionActa_(doc, '1. Venció', acta.vencidas);
  seccionActa_(doc, '2. Bloqueado', acta.bloqueadas, 'motivo');
  seccionActa_(doc, '3. Se reprogramó esta semana', acta.reprogramadas_semana, 'motivo');
  seccionActa_(doc, '4. Vence la semana entrante', acta.vence_semana_entrante);
  PdfDoc.pie(doc);
  const buffer = await PdfDoc.finalizar(doc);

  const filename = 'SIGSO-acta-reunion-' + Utils.claveDia_(new Date(), 'America/Santiago') + '.pdf';
  return { pdf_base64: buffer.toString('base64'), filename };
}

module.exports = { descargarReporte, descargarActa, cuerpoActaV2_ };
