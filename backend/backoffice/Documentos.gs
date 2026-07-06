/**
 * Documentos.gs — cola de generacion de documentos, encolada y diferida
 * (§5.2, C-04). NO se genera el Doc/PDF dentro del request sincrono de
 * actualizarEstado (riesgo de timeout de 6 min): actualizarEstado solo
 * marca doc_estado='PENDIENTE'; procesarColaDocumentos() la procesa desde
 * un trigger de tiempo (Triggers.gs, ~5 min).
 *
 * Plantilla: la especificacion (§11.1) modela template_solicitud.gdoc como
 * un Google Doc real en Drive con marcadores {{CAMPO}}, mantenido por el
 * Admin. Este codigo no depende de leer ese archivo: la plantilla vive como
 * una constante de texto con los mismos marcadores, para que la generacion
 * sea autocontenida y testeable sin una cuenta Google. Migrar a leer el
 * .gdoc real (copiarlo con DriveApp y reemplazar marcadores en su cuerpo)
 * es un cambio de una sola funcion (generarDocumento_) cuando exista esa
 * infraestructura -- ver supuesto documentado en
 * FASE-04-documentos-notificaciones.md.
 */

var PLANTILLA_DOCUMENTO = [
  'SIGSO - Ficha de Solicitud',
  '',
  'Numero: {{SOLICITUD_ID}}',
  'Empresa: {{EMPRESA_ID}}',
  'Plataforma / Modulo: {{PLATAFORMA}} / {{MODULO}}',
  'Tipo: {{TIPO}}',
  'Prioridad: {{PRIORIDAD}}',
  'Solicitante: {{SOLICITANTE_NOMBRE}} ({{SOLICITANTE_EMAIL}})',
  'Fecha de creacion: {{FECHA_CREACION}}',
  '',
  'Subsolicitudes:',
  '{{DETALLE_SUBSOLICITUDES}}'
].join('\n');

var MAX_REINTENTOS_DOCUMENTO = 3;

var Documentos = {
  procesarColaDocumentos: function () {
    var candidatas = leerFilas_(SHEETS.SOLICITUDES).filter(function (s) {
      return s.doc_estado === 'PENDIENTE' ||
        (s.doc_estado === 'ERROR' && Number(s.doc_reintentos) < MAX_REINTENTOS_DOCUMENTO);
    });

    return candidatas.map(function (solicitud) {
      try {
        var subsolicitudes = obtenerSubsolicitudesDeSolicitud_(solicitud.solicitud_id);
        var generado = generarDocumento_(solicitud, subsolicitudes);
        var historial = agregarUrlHistorial_(solicitud.url_pdf_historial, solicitud.url_pdf);

        actualizarFilaPorId_(SHEETS.SOLICITUDES, 'solicitud_id', solicitud.solicitud_id, {
          doc_estado: 'LISTO',
          doc_reintentos: 0,
          url_doc: generado.urlDoc,
          url_pdf: generado.urlPdf,
          version_documento: generado.version,
          url_pdf_historial: historial
        });

        Notificaciones.notificarDesarrollador(solicitud);
        return { solicitud_id: solicitud.solicitud_id, resultado: 'LISTO' };
      } catch (err) {
        var reintentos = (Number(solicitud.doc_reintentos) || 0) + 1;
        actualizarFilaPorId_(SHEETS.SOLICITUDES, 'solicitud_id', solicitud.solicitud_id, {
          doc_estado: 'ERROR',
          doc_reintentos: reintentos
        });
        var ref = logError_(err, 'Documentos.procesarColaDocumentos:' + solicitud.solicitud_id);
        if (reintentos >= MAX_REINTENTOS_DOCUMENTO) {
          Notificaciones.alertarAdminFalloDocumento(solicitud, ref);
        }
        return { solicitud_id: solicitud.solicitud_id, resultado: 'ERROR', ref: ref, reintentos: reintentos };
      }
    });
  }
};

function resolverMarcadores_(plantilla, solicitud, subsolicitudes) {
  var detalle = subsolicitudes.map(function (s, idx) {
    return (idx + 1) + '. ' + s.titulo + ' -- ' + s.descripcion + ' (' + s.prioridad + ', ' + s.estado + ')';
  }).join('\n');

  var valores = {
    '{{SOLICITUD_ID}}': solicitud.solicitud_id,
    '{{EMPRESA_ID}}': solicitud.empresa_id,
    '{{PLATAFORMA}}': solicitud.plataforma,
    '{{MODULO}}': solicitud.modulo,
    '{{TIPO}}': solicitud.tipo,
    '{{PRIORIDAD}}': solicitud.prioridad_derivada,
    '{{SOLICITANTE_NOMBRE}}': solicitud.solicitante_nombre,
    '{{SOLICITANTE_EMAIL}}': solicitud.solicitante_email,
    '{{FECHA_CREACION}}': solicitud.fecha_creacion,
    '{{DETALLE_SUBSOLICITUDES}}': detalle
  };

  var resultado = plantilla;
  Object.keys(valores).forEach(function (marcador) {
    resultado = resultado.split(marcador).join(String(valores[marcador]));
  });
  return resultado;
}

// Genera el Google Doc, lo exporta a PDF y lo guarda en la carpeta de la
// solicitud (§11.1). Versiona el PDF: solicitud_v1.pdf, _v2.pdf, ... (§11.3).
function generarDocumento_(solicitud, subsolicitudes) {
  var texto = resolverMarcadores_(PLANTILLA_DOCUMENTO, solicitud, subsolicitudes);

  var doc = DocumentApp.create(solicitud.solicitud_id);
  texto.split('\n').forEach(function (linea) {
    doc.getBody().appendParagraph(linea);
  });
  doc.saveAndClose();

  var carpetaSolicitud = obtenerCarpetaSolicitud_(solicitud);
  var nuevaVersion = (Number(solicitud.version_documento) || 0) + 1;
  var nombrePdf = solicitud.solicitud_id + '_v' + nuevaVersion + '.pdf';

  var pdfOriginal = DocumentApp.openById(doc.getId()).getAs('application/pdf');
  var pdfBlob = Utilities.newBlob(pdfOriginal.getBytes(), 'application/pdf', nombrePdf);
  var archivoPdf = carpetaSolicitud.createFile(pdfBlob);

  return {
    urlDoc: 'https://docs.mock/document/' + doc.getId(),
    urlPdf: archivoPdf.getUrl(),
    version: nuevaVersion
  };
}

// Guarda el PDF anterior en el historial (JSON) antes de sobrescribir
// url_pdf con el mas reciente (§11.3: "se conservan url_pdf_v1, v2, ...").
function agregarUrlHistorial_(historialJson, urlAnterior) {
  var historial = [];
  try {
    historial = historialJson ? JSON.parse(historialJson) : [];
  } catch (err) {
    historial = [];
  }
  if (urlAnterior) {
    historial.push(urlAnterior);
  }
  return JSON.stringify(historial);
}
