/**
 * Drive.gs — Drive.subirArchivo (§5.3, C-06).
 *
 * Un archivo por request (nunca Base64 monolitico de todos los adjuntos).
 * El servidor valida tamano y tipo real por firma de bytes -- nunca confia en
 * la extension ni en el Content-Type que declara el cliente para decidir la
 * CATEGORIA (imagen/documento). La firma prueba a que familia de bytes
 * pertenece el archivo; dentro de la categoria "documento", el mime especifico
 * se refina por la extension (ver EXTENSIONES_DOCUMENTO), porque los Office
 * Open XML (docx/xlsx/pptx) comparten la firma ZIP y los Office legacy
 * (doc/xls) comparten la firma OLE -- imposibles de distinguir por bytes sin
 * inspeccionar el interior del contenedor. La extension solo elige la etiqueta
 * DENTRO de una categoria ya validada por firma, y un archivo cuya extension
 * no este permitida se rechaza aunque su firma sea valida (ej. un .zip suelto).
 */

var LIMITES_TAMANO_BYTES = {
  imagen: 5 * 1024 * 1024,
  documento: 10 * 1024 * 1024
};

// Adjuntos POR ITEM (subsolicitud): una solicitud real mezcla varios items y
// cada uno puede necesitar su propia evidencia (Fase 10). Antes el limite era
// por SOLICITUD completa (5 img / 3 doc, RF-003 de v1.0), lo que quedaba corto
// con 10 items posibles.
var LIMITES_CANTIDAD_POR_ITEM = {
  imagen: 5,
  documento: 3
};

// Tope de seguridad por SOLICITUD completa (anti-abuso): con 10 items al maximo
// por item se llegaria a 50 img / 30 doc, mucho para una sola solicitud.
var LIMITES_CANTIDAD_POR_SOLICITUD = {
  imagen: 30,
  documento: 15
};

// Firmas (magic numbers) minimas para detectar la FAMILIA real del archivo.
// - imagen: la firma es autoritativa y no ambigua -> el mime sale de aqui.
// - documento: la firma solo dice la familia (pdf/zip/ole); el mime especifico
//   se refina despues por la extension (EXTENSIONES_DOCUMENTO).
var FIRMAS = [
  { categoria: 'imagen', mime: 'image/jpeg', firma: [0xFF, 0xD8, 0xFF] },
  { categoria: 'imagen', mime: 'image/png', firma: [0x89, 0x50, 0x4E, 0x47] },
  { categoria: 'imagen', mime: 'image/gif', firma: [0x47, 0x49, 0x46, 0x38] },
  { categoria: 'documento', familia: 'pdf', firma: [0x25, 0x50, 0x44, 0x46] },
  // Office Open XML (docx/xlsx/pptx) y cualquier .zip comparten la firma PK.
  { categoria: 'documento', familia: 'zip', firma: [0x50, 0x4B, 0x03, 0x04] },
  // Office legacy (doc/xls) comparten el contenedor OLE compound file.
  { categoria: 'documento', familia: 'ole', firma: [0xD0, 0xCF, 0x11, 0xE0] }
];

// extension -> { mime, familia }. La familia debe coincidir con la firma
// detectada: un .xlsx debe traer firma zip, un .xls firma ole, etc. Asi se
// evita que se cuele un .zip suelto (firma zip pero extension no permitida) o
// un archivo con extension falsa.
var EXTENSIONES_DOCUMENTO = {
  pdf: { mime: 'application/pdf', familia: 'pdf' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', familia: 'zip' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', familia: 'zip' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', familia: 'zip' },
  xls: { mime: 'application/vnd.ms-excel', familia: 'ole' },
  doc: { mime: 'application/msword', familia: 'ole' }
};

var MIMES_IMAGEN = ['image/jpeg', 'image/png', 'image/gif'];

function extensionDe_(nombreArchivo) {
  var partes = String(nombreArchivo || '').split('.');
  return partes.length > 1 ? partes.pop().toLowerCase() : '';
}

// Clasifica un tipo_mime ya guardado (para contar cuantos hay). Los mimes de
// documento son todos los de EXTENSIONES_DOCUMENTO.
function categoriaDeMime_(mime) {
  if (MIMES_IMAGEN.indexOf(mime) !== -1) return 'imagen';
  for (var ext in EXTENSIONES_DOCUMENTO) {
    if (EXTENSIONES_DOCUMENTO[ext].mime === mime) return 'documento';
  }
  return null;
}

// Cuenta archivos ya subidos de una categoria. Si se pasa subsolicitudId,
// acota a ese item (limite por item); si no, cuenta toda la solicitud (tope
// global).
function contarArchivos_(solicitudId, categoria, subsolicitudId) {
  return leerFilas_(SHEETS.ARCHIVOS).filter(function (archivo) {
    if (archivo.solicitud_id !== solicitudId) return false;
    if (subsolicitudId && archivo.subsolicitud_id !== subsolicitudId) return false;
    return categoriaDeMime_(archivo.tipo_mime) === categoria;
  }).length;
}

function detectarFirma_(bytes) {
  for (var i = 0; i < FIRMAS.length; i++) {
    var candidato = FIRMAS[i];
    var coincide = candidato.firma.every(function (byte, idx) {
      // Utilities.base64Decode devuelve Byte[] CON SIGNO (-128..127): un
      // 0x89 (137) llega como -119. Sin el & 0xFF, ninguna firma con byte
      // >127 (PNG 0x89, JPEG 0xFF, OLE 0xD0) coincidiria.
      return (bytes[idx] & 0xFF) === byte;
    });
    if (coincide) {
      return candidato;
    }
  }
  return null;
}

// Devuelve { categoria, mime } del archivo, o null si no se reconoce / la
// extension no calza con la firma para documentos.
function resolverTipoArchivo_(bytes, nombreArchivo) {
  var firma = detectarFirma_(bytes);
  if (!firma) {
    return null;
  }
  if (firma.categoria === 'imagen') {
    return { categoria: 'imagen', mime: firma.mime };
  }
  // documento: refinar el mime por la extension, exigiendo que su familia
  // coincida con la firma detectada.
  var ext = extensionDe_(nombreArchivo);
  var conf = EXTENSIONES_DOCUMENTO[ext];
  if (!conf || conf.familia !== firma.familia) {
    return null;
  }
  return { categoria: 'documento', mime: conf.mime };
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

    var tipo = resolverTipoArchivo_(bytes, data.nombre_archivo);
    if (!tipo) {
      return errorValidacion_('archivo', 'Tipo de archivo no permitido o no reconocido (imagenes JPG/PNG/GIF; documentos PDF/Word/Excel).');
    }

    var limite = LIMITES_TAMANO_BYTES[tipo.categoria];
    if (bytes.length > limite) {
      return errorValidacion_(
        'archivo',
        'El archivo supera el tamano maximo permitido (' + Math.round(limite / (1024 * 1024)) + ' MB).'
      );
    }

    // Limite por item (subsolicitud) y tope global por solicitud. El por-item
    // es el que el solicitante ve; el global evita abusos.
    if (data.subsolicitud_id) {
      var enItem = contarArchivos_(data.solicitud_id, tipo.categoria, data.subsolicitud_id);
      if (enItem >= LIMITES_CANTIDAD_POR_ITEM[tipo.categoria]) {
        return errorValidacion_(
          'archivo',
          'Se alcanzo el maximo de ' + LIMITES_CANTIDAD_POR_ITEM[tipo.categoria] +
            ' archivos de tipo ' + tipo.categoria + ' para este item.'
        );
      }
    }
    var enSolicitud = contarArchivos_(data.solicitud_id, tipo.categoria);
    if (enSolicitud >= LIMITES_CANTIDAD_POR_SOLICITUD[tipo.categoria]) {
      return errorValidacion_(
        'archivo',
        'Se alcanzo el maximo de ' + LIMITES_CANTIDAD_POR_SOLICITUD[tipo.categoria] +
          ' archivos de tipo ' + tipo.categoria + ' para esta solicitud.'
      );
    }

    var carpetaAdjuntos = obtenerCarpetaAdjuntos_(solicitud);
    var blob = Utilities.newBlob(bytes, tipo.mime, data.nombre_archivo);
    var archivoDrive = carpetaAdjuntos.createFile(blob);
    var archivoId = Utilities.getUuid();
    var timestamp = new Date().toISOString();

    agregarFila_(SHEETS.ARCHIVOS, {
      archivo_id: archivoId,
      solicitud_id: data.solicitud_id,
      subsolicitud_id: data.subsolicitud_id || '',
      nombre_original: data.nombre_archivo,
      url: archivoDrive.getUrl(),
      tipo_mime: tipo.mime,
      tamano_bytes: bytes.length,
      fecha_subida: timestamp
    });

    return {
      archivo_id: archivoId,
      url: archivoDrive.getUrl(),
      tipo_mime: tipo.mime,
      tamano_bytes: bytes.length
    };
  }
};
