/**
 * ReporteActividades.gs — v7.0 Fase 5 (§4.8): "3 motores + filtros
 * comunes" en PDF, mas la "Acta de reunion de seguimiento" (extra
 * propuesto, §4.8). Mismo patron HTML->PDF que OrdenTrabajo.gs -- HTML
 * autocontenido (estilos inline, tablas simples), conversion via
 * Utilities.newBlob(html, 'text/html').getAs('application/pdf'). Reusa
 * escaparHtml_/formatearFechaLegible_ (definidos en OrdenTrabajo.gs, mismo
 * scope global de Apps Script) para no duplicar el escape de HTML.
 *
 * La logica de datos (que filas salen, como se calculan los resumenes) vive
 * en Actividades.gs (generarReporte/generarActaReunion) -- este archivo
 * SOLO convierte esos datos a HTML y despues a PDF.
 */

// v7.6 (correos y descargables "corporativo sobrio"): mismo navy + sello
// "S" que ya usan la Orden de Trabajo (OrdenTrabajo.gs) y los correos
// (Notificaciones.gs) -- toda la papeleria de SIGSO sale de la misma casa.
var COLOR_MARCA_REPORTES_ = '#14213D';
var COLOR_TEXTO_SUAVE_REPORTES_ = '#6B7280';
var COLOR_LINEA_REPORTES_ = '#E5E7EB';

var TITULOS_REPORTE_ACTIVIDADES_ = {
  estado_actual: 'Estado actual',
  cumplimiento_periodo: 'Cumplimiento del período',
  carga_capacidad: 'Carga y capacidad'
};

var ReporteActividades = {
  /**
   * descargarReporte({ tipo, ...filtros }, contexto) -> { pdf_base64, filename }.
   * Accion de router para el boton "Descargar PDF" de la pestaña Actividades
   * del Panel de Gerencia.
   */
  descargarReporte: function (data, contexto) {
    if (!data || !data.tipo) {
      return errorValidacion_('tipo', 'Falta indicar el tipo de reporte.');
    }
    var reporte = Actividades.generarReporte(data, contexto);
    if (reporte && (reporte._validationError || reporte._forbidden)) {
      return reporte;
    }
    var html = construirHtmlReporteActividades_(reporte);
    var pdf = Utilities.newBlob(html, 'text/html', 'reporte.html').getAs('application/pdf');
    pdf.setName('SIGSO-reporte-' + data.tipo + '-' + claveDia_(new Date(), 'America/Santiago') + '.pdf');
    return { pdf_base64: Utilities.base64Encode(pdf.getBytes()), filename: pdf.getName() };
  },

  /**
   * descargarActa(filtros, contexto) -> { pdf_base64, filename }. Boton
   * "Acta de reunión (PDF)": la pauta lista para la reunión semanal.
   */
  descargarActa: function (data, contexto) {
    var acta = Actividades.generarActaReunion(data || {}, contexto);
    var html = construirHtmlActaReunion_(acta);
    var pdf = Utilities.newBlob(html, 'text/html', 'acta.html').getAs('application/pdf');
    pdf.setName('SIGSO-acta-reunion-' + claveDia_(new Date(), 'America/Santiago') + '.pdf');
    return { pdf_base64: Utilities.base64Encode(pdf.getBytes()), filename: pdf.getName() };
  }
};

function encabezadoReporteActividades_(titulo) {
  return '<table width="100%" style="border-collapse:collapse;"><tr>' +
    '<td style="background:' + COLOR_MARCA_REPORTES_ + ';padding:16px 22px;">' +
    '<table cellpadding="0" cellspacing="0"><tr>' +
    '<td style="width:30px;height:30px;background:#ffffff;text-align:center;vertical-align:middle;font-family:Georgia,\'Times New Roman\',serif;font-weight:bold;font-size:15px;color:' + COLOR_MARCA_REPORTES_ + ';">S</td>' +
    '<td style="padding-left:12px;vertical-align:middle;">' +
    '<span style="color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:0.3px;font-family:Georgia,\'Times New Roman\',serif;">SIGSO</span>' +
    '<span style="color:#AEB8CC;font-size:13px;margin-left:10px;">' + escaparHtml_(titulo) + '</span>' +
    '</td></tr></table>' +
    '</td></tr></table>';
}

function etiquetaResumenActividades_(clave) {
  var etiquetas = {
    total: 'Total',
    comprometidas: 'Comprometidas',
    cumplidas_a_tiempo: 'Cumplidas a tiempo',
    pct_cumplimiento: '% cumplimiento',
    vencidas: 'Vencidas',
    reprogramaciones_promedio: 'Reprogramaciones prom.',
    emergentes: 'Emergentes',
    pct_emergente: '% emergente'
  };
  return etiquetas[clave] || clave;
}

function formatearCeldaReporteActividades_(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(valor)) return fechaCortaOt_(valor);
  return String(valor);
}

function construirHtmlReporteActividades_(reporte) {
  var titulo = TITULOS_REPORTE_ACTIVIDADES_[reporte.tipo] || 'Reporte';
  var resumenHtml = Object.keys(reporte.resumen || {}).map(function (clave) {
    var valor = reporte.resumen[clave];
    return '<span style="margin-right:18px;"><strong>' + escaparHtml_(etiquetaResumenActividades_(clave)) + ':</strong> ' +
      escaparHtml_(formatearCeldaReporteActividades_(valor)) + '</span>';
  }).join('');

  var encabezadoTabla = '<tr>' + reporte.columnas.map(function (c) {
    return '<th style="padding:6px 8px;text-align:left;border-bottom:2px solid #1F2937;">' + escaparHtml_(c.etiqueta) + '</th>';
  }).join('') + '</tr>';

  var filasHtml = reporte.filas.map(function (fila) {
    return '<tr>' + reporte.columnas.map(function (c) {
      return '<td style="padding:6px 8px;border-bottom:1px solid #E5E7EB;">' + escaparHtml_(formatearCeldaReporteActividades_(fila[c.campo])) + '</td>';
    }).join('') + '</tr>';
  }).join('');

  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;font-family:Arial,Helvetica,sans-serif;color:#1F2937;font-size:12px;line-height:1.4;">' +
    encabezadoReporteActividades_(titulo) +
    '<div style="padding:20px 22px;">' +
    '<p style="margin:0 0 4px;font-size:11px;color:#6B7280;">Generado el ' + escaparHtml_(formatearFechaLegible_(new Date())) + '</p>' +
    '<p style="margin:0 0 14px;">' + resumenHtml + '</p>' +
    '<table width="100%" style="border-collapse:collapse;">' + encabezadoTabla + filasHtml + '</table>' +
    (reporte.filas.length === 0
      ? '<p style="color:#6B7280;margin-top:12px;">Sin datos para los filtros elegidos.</p>'
      : '') +
    '</div></body></html>';
}

function seccionActaReunion_(titulo, filas, campoExtra) {
  if (!filas.length) {
    return '<h2 style="font-size:15px;margin:18px 0 6px;">' + escaparHtml_(titulo) + '</h2>' +
      '<p style="color:#6B7280;margin:0;">Nada que reportar.</p>';
  }
  var items = filas.map(function (f) {
    return '<li style="margin-bottom:6px;"><strong>' + escaparHtml_(f.titulo) + '</strong> — ' +
      escaparHtml_(f.responsable) + ' (' + escaparHtml_(f.area) + ')' +
      (campoExtra && f[campoExtra] ? ' · ' + escaparHtml_(f[campoExtra]) : '') +
      (f.fecha_compromiso ? ' · vence ' + escaparHtml_(fechaCortaOt_(f.fecha_compromiso)) : '') +
      '</li>';
  }).join('');
  return '<h2 style="font-size:15px;margin:18px 0 6px;">' + escaparHtml_(titulo) + '</h2>' +
    '<ul style="margin:0;padding-left:20px;font-size:13px;">' + items + '</ul>';
}

function construirHtmlActaReunion_(acta) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;font-family:Arial,Helvetica,sans-serif;color:#1F2937;font-size:13px;line-height:1.45;">' +
    encabezadoReporteActividades_('Acta de reunión de seguimiento') +
    '<div style="padding:20px 22px;">' +
    '<p style="margin:0 0 14px;font-size:11px;color:#6B7280;">Generada el ' + escaparHtml_(formatearFechaLegible_(new Date(acta.generado_en))) + '</p>' +
    seccionActaReunion_('1. Venció', acta.vencidas) +
    seccionActaReunion_('2. Bloqueado', acta.bloqueadas, 'motivo') +
    seccionActaReunion_('3. Se reprogramó esta semana', acta.reprogramadas_semana, 'motivo') +
    seccionActaReunion_('4. Vence la semana entrante', acta.vence_semana_entrante) +
    '</div></body></html>';
}
