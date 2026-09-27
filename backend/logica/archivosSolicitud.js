'use strict';

/**
 * archivosSolicitud.js — adjuntos de las solicitudes en el servidor Node + R2
 * (antes: backend/intake/Drive.gs → Google Drive vía Apps Script). Era la última
 * pieza que ataba el ingreso de solicitudes a Apps Script.
 *
 * Mismas reglas que Drive.gs, portadas tal cual:
 *  - el TIPO se decide por la firma de los bytes, nunca por la extensión ni por
 *    lo que declara el navegador (imágenes JPG/PNG/GIF; documentos PDF/Word/Excel/
 *    PowerPoint, cuyo mime exacto se refina por extensión dentro de su familia);
 *  - tamaño máximo: 5 MB imagen, 10 MB documento;
 *  - cantidad: 5 imágenes / 3 documentos por ítem; 30 / 15 por solicitud.
 *
 * Lo que se AGREGA respecto de Apps Script: quien sube debe probar que la
 * solicitud es suya (su correo o el del cliente registrado), igual que editar o
 * quitar un adjunto. Antes bastaba con conocer el número de solicitud.
 *
 * Cómo se abre un archivo: la fila de ARCHIVOS guarda una URL estable a este
 * mismo servidor (/v1/archivo/<id>?k=<llave>), con una llave aleatoria por
 * archivo. Así los enlaces existentes (Bandeja, Mis solicitudes, estado, Orden
 * de trabajo) siguen funcionando sin cambios, igual que los de Drive: quien
 * tiene el enlace puede ver el archivo, nadie puede adivinarlo.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion, errorForbidden } = require('./errores');
const Almacenamiento = require('./almacenamiento');

const URL_PUBLICA = (process.env.SIGSO_URL_PUBLICA || 'https://api.ctrly.cl').replace(/\/+$/, '');
const LIMITES_TAMANO = { imagen: 5 * 1024 * 1024, documento: 10 * 1024 * 1024 };
const LIMITES_POR_ITEM = { imagen: 5, documento: 3 };
const LIMITES_POR_SOLICITUD = { imagen: 30, documento: 15 };

const FIRMAS = [
  { categoria: 'imagen', mime: 'image/jpeg', firma: [0xFF, 0xD8, 0xFF] },
  { categoria: 'imagen', mime: 'image/png', firma: [0x89, 0x50, 0x4E, 0x47] },
  { categoria: 'imagen', mime: 'image/gif', firma: [0x47, 0x49, 0x46, 0x38] },
  { categoria: 'documento', familia: 'pdf', firma: [0x25, 0x50, 0x44, 0x46] },
  { categoria: 'documento', familia: 'zip', firma: [0x50, 0x4B, 0x03, 0x04] },
  { categoria: 'documento', familia: 'ole', firma: [0xD0, 0xCF, 0x11, 0xE0] }
];
const EXTENSIONES_DOCUMENTO = {
  pdf: { mime: 'application/pdf', familia: 'pdf' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', familia: 'zip' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', familia: 'zip' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', familia: 'zip' },
  xls: { mime: 'application/vnd.ms-excel', familia: 'ole' },
  doc: { mime: 'application/msword', familia: 'ole' }
};
const MIMES_IMAGEN = ['image/jpeg', 'image/png', 'image/gif'];

function extension_(nombre) {
  const m = String(nombre || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}
function categoriaDeMime_(mime) {
  if (MIMES_IMAGEN.indexOf(mime) !== -1) return 'imagen';
  return Object.keys(EXTENSIONES_DOCUMENTO).some((e) => EXTENSIONES_DOCUMENTO[e].mime === mime) ? 'documento' : null;
}
// { categoria, mime } o null si no se reconoce (o la extensión no calza con la firma).
function resolverTipo_(bytes, nombre) {
  const firma = FIRMAS.find((c) => c.firma.every((b, i) => bytes[i] === b));
  if (!firma) return null;
  if (firma.categoria === 'imagen') return { categoria: 'imagen', mime: firma.mime };
  const conf = EXTENSIONES_DOCUMENTO[extension_(nombre)];
  if (!conf || conf.familia !== firma.familia) return null;
  return { categoria: 'documento', mime: conf.mime };
}
function compararEmail_(a, b) {
  return !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}
function buscarSolicitud_(db, id) {
  return leerFilas_(db, 'SOLICITUDES', COLUMNAS.SOLICITUDES).find((s) => s.solicitud_id === id) || null;
}
function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1 || v === 'true'; }
function nombreSeguro_(n) {
  return String(n || 'archivo').replace(/[\\/\u0000-\u001f"]/g, '_').slice(0, 180) || 'archivo';
}
function claveR2_(solicitudId, archivoId) { return 'solicitudes/' + solicitudId + '/' + archivoId; }

/**
 * data: { solicitud_id, subsolicitud_id?, nombre_archivo, contenido_base64, email }.
 * Pública (el formulario de ingreso no tiene sesión): la prueba es el correo.
 */
async function subirArchivo(db, data) {
  data = data || {};
  if (!data.solicitud_id || !data.nombre_archivo || !data.contenido_base64) {
    return errorValidacion('archivo', 'Faltan datos del archivo (solicitud_id, nombre_archivo o contenido).');
  }
  const solicitud = buscarSolicitud_(db, data.solicitud_id);
  if (!solicitud) return errorValidacion('solicitud_id', 'No existe una solicitud con ese número.');
  const esDuenio = compararEmail_(data.email, solicitud.solicitante_email) ||
    (esVerdadero_(solicitud.es_cliente) && compararEmail_(data.email, solicitud.correo_cliente));
  if (!esDuenio) return errorForbidden('El correo no coincide con el registrado para esta solicitud.');

  let bytes;
  try { bytes = Buffer.from(String(data.contenido_base64), 'base64'); } catch (e) { bytes = null; }
  if (!bytes || !bytes.length) return errorValidacion('contenido_base64', 'El contenido del archivo no es base64 válido.');

  const tipo = resolverTipo_(bytes, data.nombre_archivo);
  if (!tipo) return errorValidacion('archivo', 'Tipo de archivo no permitido o no reconocido (imágenes JPG/PNG/GIF; documentos PDF/Word/Excel).');
  if (bytes.length > LIMITES_TAMANO[tipo.categoria]) {
    return errorValidacion('archivo', 'El archivo supera el tamaño máximo permitido (' + Math.round(LIMITES_TAMANO[tipo.categoria] / (1024 * 1024)) + ' MB).');
  }

  const archivos = leerFilas_(db, 'ARCHIVOS', COLUMNAS.ARCHIVOS).filter((a) => a.solicitud_id === data.solicitud_id && categoriaDeMime_(a.tipo_mime) === tipo.categoria);
  if (data.subsolicitud_id && archivos.filter((a) => a.subsolicitud_id === data.subsolicitud_id).length >= LIMITES_POR_ITEM[tipo.categoria]) {
    return errorValidacion('archivo', 'Se alcanzó el máximo de ' + LIMITES_POR_ITEM[tipo.categoria] + ' archivos de tipo ' + tipo.categoria + ' para este ítem.');
  }
  if (archivos.length >= LIMITES_POR_SOLICITUD[tipo.categoria]) {
    return errorValidacion('archivo', 'Se alcanzó el máximo de ' + LIMITES_POR_SOLICITUD[tipo.categoria] + ' archivos de tipo ' + tipo.categoria + ' para esta solicitud.');
  }

  const archivoId = crypto.randomUUID();
  const subida = await Almacenamiento.subirArchivo_(claveR2_(data.solicitud_id, archivoId), bytes.toString('base64'), tipo.mime);
  if (!subida.ok) return errorValidacion('archivo', subida.message);

  const llave = crypto.randomBytes(24).toString('base64url');
  const url = URL_PUBLICA + '/v1/archivo/' + archivoId + '?k=' + llave;
  agregarFila_(db, 'ARCHIVOS', {
    archivo_id: archivoId, solicitud_id: data.solicitud_id, subsolicitud_id: data.subsolicitud_id || '',
    nombre_original: nombreSeguro_(data.nombre_archivo), url, tipo_mime: tipo.mime, tamano_bytes: bytes.length,
    fecha_subida: new Date().toISOString()
  });
  return { archivo_id: archivoId, url, tipo_mime: tipo.mime, tamano_bytes: bytes.length };
}

// ¿La URL guardada es de las servidas por este servidor? (las antiguas son de Drive).
function esArchivoPropio(archivo) {
  return !!archivo && /\/v1\/archivo\/[0-9a-f-]{36}\?k=/.test(String(archivo.url || ''));
}

/**
 * Para GET /v1/archivo/<id>?k=<llave>: devuelve { buffer, mime, nombre } o null
 * (si no existe o la llave no coincide: misma respuesta, no se distingue).
 */
async function servirArchivo(db, archivoId, llave) {
  if (!/^[0-9a-f-]{36}$/.test(String(archivoId || '')) || !llave) return null;
  const a = leerFilas_(db, 'ARCHIVOS', COLUMNAS.ARCHIVOS).find((x) => x.archivo_id === archivoId);
  if (!esArchivoPropio(a)) return null;
  const guardada = (String(a.url).match(/[?&]k=([^&]+)/) || [])[1] || '';
  const x = Buffer.from(String(llave)), y = Buffer.from(guardada);
  if (x.length !== y.length || !crypto.timingSafeEqual(x, y)) return null;
  const d = await Almacenamiento.descargarArchivo_(claveR2_(a.solicitud_id, a.archivo_id));
  if (!d.ok) return null;
  return { buffer: Buffer.from(d.contenido_base64, 'base64'), mime: a.tipo_mime || d.content_type, nombre: a.nombre_original || 'archivo' };
}

/** Borra el objeto en R2 de un adjunto propio (los de Drive no se tocan). */
async function eliminarDelAlmacen(archivo) {
  if (!esArchivoPropio(archivo)) return { ok: true };
  return Almacenamiento.eliminarArchivo_(claveR2_(archivo.solicitud_id, archivo.archivo_id));
}

module.exports = { subirArchivo, servirArchivo, eliminarDelAlmacen, esArchivoPropio, resolverTipo_, LIMITES_TAMANO, URL_PUBLICA };
