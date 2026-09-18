'use strict';

/**
 * almacenamiento.js — cliente de almacenamiento de archivos (Cloudflare R2,
 * API S3-compatible), reemplazo de Drive/DriveRepo.gs para el ecosistema
 * Node. Primitivo compartido: subir/descargar/eliminar un archivo por
 * "clave" (ruta dentro del bucket) — cada módulo decide su propia
 * convención de clave (ej. `novedades/<novedad_id>/<archivo_id>.pdf`).
 *
 * Usa `aws4fetch` (paquete real, ~5 KB) en vez del SDK oficial de AWS
 * (varias decenas de MB) -- mismo criterio de dependencias mínimas que el
 * resto de la migración (scrypt vía `node:crypto` en vez de bcrypt, Resend
 * vía `fetch` nativo en vez de su SDK).
 *
 * Configuración por variables de entorno del servicio (systemd drop-in en
 * el VPS, mismo patrón que RESEND_API_KEY): `R2_ACCOUNT_ID`,
 * `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Sin ellas,
 * `disponible_()` da `false` y las tres funciones devuelven el mismo
 * mensaje de "no disponible" que ya usan los módulos gateados
 * (Novedades/Pausas/Proyectos/SGC) -- se reemplaza ese texto por una
 * llamada real cuando cada módulo se desgatea, nunca al revés.
 */

const { AwsClient } = require('aws4fetch');

const MENSAJE_NO_CONFIGURADO = 'El almacenamiento de archivos no está configurado en este servidor.';

let clienteCache_ = null;
function config_() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  const endpoint = process.env.R2_ENDPOINT || ('https://' + accountId + '.r2.cloudflarestorage.com');
  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint };
}

function disponible_() { return !!config_(); }

function cliente_(cfg) {
  // Cachea el cliente (no las credenciales en una variable aparte): si
  // cambian las env vars en un proceso ya corriendo (no pasa en systemd,
  // pero sí entre tests), conviene reconstruirlo -- se compara por
  // accessKeyId, barato y suficiente.
  if (clienteCache_ && clienteCache_._cfgKey === cfg.accessKeyId) return clienteCache_.client;
  // retries: 0 -- un reintento automático con backoff (10 por defecto)
  // convierte un solo 5xx en hasta ~25s de espera; cada acción que llama a
  // este módulo ya devuelve un error claro que el usuario puede reintentar
  // desde la UI, así que el reintento de red no aporta y sí cuesta latencia.
  const client = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: 's3', region: 'auto', retries: 0 });
  clienteCache_ = { _cfgKey: cfg.accessKeyId, client };
  return client;
}

function urlObjeto_(cfg, clave) {
  return cfg.endpoint + '/' + cfg.bucket + '/' + clave.split('/').map(encodeURIComponent).join('/');
}

/**
 * Sube un archivo. `contenidoBase64` es el contenido codificado en base64
 * (mismo formato `contenido_base64` que ya usan los formularios del
 * frontend para adjuntos). Sobrescribe si la clave ya existe -- el
 * llamador decide si eso es válido (ej. "no se reemplaza un documento ya
 * confirmado" es una regla de negocio de cada módulo, no de este cliente).
 */
async function subirArchivo_(clave, contenidoBase64, contentType) {
  const cfg = config_();
  if (!cfg) return { ok: false, message: MENSAJE_NO_CONFIGURADO };
  if (!clave) return { ok: false, message: 'Falta la clave del archivo.' };
  if (!contenidoBase64) return { ok: false, message: 'Falta el contenido del archivo.' };

  let buffer;
  try {
    buffer = Buffer.from(contenidoBase64, 'base64');
  } catch (err) {
    return { ok: false, message: 'El contenido del archivo no es base64 válido.' };
  }
  if (!buffer.length) return { ok: false, message: 'El archivo está vacío.' };

  const client = cliente_(cfg);
  const resp = await client.fetch(urlObjeto_(cfg, clave), {
    method: 'PUT',
    body: buffer,
    headers: contentType ? { 'Content-Type': contentType } : undefined
  });
  if (!resp.ok) return { ok: false, message: 'No se pudo subir el archivo (R2 respondió ' + resp.status + ').' };
  return { ok: true, clave, tamano: buffer.length };
}

/**
 * Descarga un archivo. Devuelve el contenido en base64 (mismo formato que
 * `subirArchivo_` recibe), para que el llamador lo entregue tal cual al
 * frontend o lo escriba a disco según necesite.
 */
async function descargarArchivo_(clave) {
  const cfg = config_();
  if (!cfg) return { ok: false, message: MENSAJE_NO_CONFIGURADO };
  if (!clave) return { ok: false, message: 'Falta la clave del archivo.' };

  const client = cliente_(cfg);
  const resp = await client.fetch(urlObjeto_(cfg, clave), { method: 'GET' });
  if (resp.status === 404) return { ok: false, message: 'El archivo no existe.' };
  if (!resp.ok) return { ok: false, message: 'No se pudo descargar el archivo (R2 respondió ' + resp.status + ').' };

  const arrayBuffer = await resp.arrayBuffer();
  return {
    ok: true,
    contenido_base64: Buffer.from(arrayBuffer).toString('base64'),
    content_type: resp.headers.get('content-type') || 'application/octet-stream'
  };
}

/**
 * Elimina un archivo. Es idempotente a propósito (borrar algo que ya no
 * existe no es un error): R2 devuelve 204 igual para una clave inexistente,
 * así que no hace falta comprobar antes.
 */
async function eliminarArchivo_(clave) {
  const cfg = config_();
  if (!cfg) return { ok: false, message: MENSAJE_NO_CONFIGURADO };
  if (!clave) return { ok: false, message: 'Falta la clave del archivo.' };

  const client = cliente_(cfg);
  const resp = await client.fetch(urlObjeto_(cfg, clave), { method: 'DELETE' });
  if (!resp.ok && resp.status !== 404) return { ok: false, message: 'No se pudo eliminar el archivo (R2 respondió ' + resp.status + ').' };
  return { ok: true };
}

module.exports = { disponible_, subirArchivo_, descargarArchivo_, eliminarArchivo_, MENSAJE_NO_CONFIGURADO };
