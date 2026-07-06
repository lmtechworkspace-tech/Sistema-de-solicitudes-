/**
 * Drive.gs — Drive.subirArchivo (§5.3, C-06).
 *
 * Un archivo por request (nunca Base64 monolitico de todos los adjuntos).
 * El servidor valida tamano y tipo MIME real por firma de bytes -- nunca
 * confia en la extension ni en el Content-Type que declara el cliente.
 */

var LIMITES_TAMANO_BYTES = {
  imagen: 5 * 1024 * 1024,
  documento: 10 * 1024 * 1024
};

// RF-003 (doc 3 de v1.0): maximo 5 imagenes y 3 archivos adjuntos por
// solicitud (no por subsolicitud: Bloque 5 del formulario, doc 12.1, adjunta
// archivos a nivel de solicitud).
var LIMITES_CANTIDAD = {
  imagen: 5,
  documento: 3
};

// Firmas (magic numbers) minimas para detectar el tipo real del archivo.
// XLSX (y cualquier Office Open XML: docx/pptx) es un contenedor ZIP, asi
// que comparte la firma PK con cualquier .zip -- no se puede distinguir de
// forma confiable sin inspeccionar las entradas internas del archivo, algo
// fuera de alcance para una validacion liviana de firma de bytes. Se
// documenta la ambiguedad en vez de fingir una deteccion mas precisa de la
// que realmente se hace.
var FIRMAS_MIME = [
  { mime: 'image/jpeg', categoria: 'imagen', firma: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png', categoria: 'imagen', firma: [0x89, 0x50, 0x4E, 0x47] },
  { mime: 'image/gif', categoria: 'imagen', firma: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'application/pdf', categoria: 'documento', firma: [0x25, 0x50, 0x44, 0x46] },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    categoria: 'documento',
    firma: [0x50, 0x4B, 0x03, 0x04]
  }
];

function contarArchivosPorCategoria_(solicitudId, categoria) {
  var mimesDeLaCategoria = FIRMAS_MIME
    .filter(function (f) { return f.categoria === categoria; })
    .map(function (f) { return f.mime; });

  return leerFilas_(SHEETS.ARCHIVOS).filter(function (archivo) {
    return archivo.solicitud_id === solicitudId && mimesDeLaCategoria.indexOf(archivo.tipo_mime) !== -1;
  }).length;
}

function detectarMimeReal_(bytes) {
  for (var i = 0; i < FIRMAS_MIME.length; i++) {
    var candidato = FIRMAS_MIME[i];
    var coincide = candidato.firma.every(function (byte, idx) {
      return bytes[idx] === byte;
    });
    if (coincide) {
      return candidato;
    }
  }
  return null;
}

var Drive = {
  subirArchivo: function (data) {
    if (!data.solicitud_id || !data.nombre_archivo || !data.contenido_base64) {
      return errorValidacion_('archivo', 'Faltan datos del archivo (solicitud_id, nombre_archivo o contenido).');
    }

    var solicitud = buscarSolicitudPorId_(data.solicitud_id);
    if (!solicitud) {
      return errorValidacion_('solicitud_id', 'No existe una solicitud con ese numero.');
    }

    var bytes;
    try {
      bytes = Utilities.base64Decode(data.contenido_base64);
    } catch (err) {
      return errorValidacion_('contenido_base64', 'El contenido del archivo no es base64 valido.');
    }

    var firma = detectarMimeReal_(bytes);
    if (!firma) {
      return errorValidacion_('archivo', 'Tipo de archivo no permitido o no reconocido.');
    }

    var limite = LIMITES_TAMANO_BYTES[firma.categoria];
    if (bytes.length > limite) {
      return errorValidacion_(
        'archivo',
        'El archivo supera el tamano maximo permitido (' + Math.round(limite / (1024 * 1024)) + ' MB).'
      );
    }

    var cantidadActual = contarArchivosPorCategoria_(data.solicitud_id, firma.categoria);
    if (cantidadActual >= LIMITES_CANTIDAD[firma.categoria]) {
      return errorValidacion_(
        'archivo',
        'Se alcanzo el maximo de ' + LIMITES_CANTIDAD[firma.categoria] + ' archivos de tipo ' +
          firma.categoria + ' para esta solicitud (RF-003).'
      );
    }

    var carpetaAdjuntos = obtenerCarpetaAdjuntos_(solicitud);
    var blob = Utilities.newBlob(bytes, firma.mime, data.nombre_archivo);
    var archivoDrive = carpetaAdjuntos.createFile(blob);
    var archivoId = Utilities.getUuid();
    var timestamp = new Date().toISOString();

    agregarFila_(SHEETS.ARCHIVOS, {
      archivo_id: archivoId,
      solicitud_id: data.solicitud_id,
      subsolicitud_id: data.subsolicitud_id || '',
      nombre_original: data.nombre_archivo,
      url: archivoDrive.getUrl(),
      tipo_mime: firma.mime,
      tamano_bytes: bytes.length,
      fecha_subida: timestamp
    });

    return {
      archivo_id: archivoId,
      url: archivoDrive.getUrl(),
      tipo_mime: firma.mime,
      tamano_bytes: bytes.length
    };
  }
};
