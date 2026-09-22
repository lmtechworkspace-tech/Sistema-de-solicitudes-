'use strict';

/**
 * perfiles.js — puerto de Perfiles.gs (v6.4): `getMiPerfil` (perfil propio,
 * nombre/email/cargo/rol/empresa) + foto de perfil (`guardarFoto`/
 * `eliminarFoto`/`getFotosDe`). La foto se portó el 2026-09-22 (Fase 3c la
 * había dejado fuera a propósito -- ver historial de este archivo): R2 ya
 * estaba disponible, solo faltaba conectarlo.
 *
 * Como en el .gs, la identidad sale SIEMPRE de `contexto`, nunca de un
 * identificador que mande el cliente en `data` -- no hay parámetro que
 * falsificar porque no existe (ver tests "SEGURIDAD" en perfiles.test.js,
 * el .gs vía gasSandbox, y perfiles-node.test.js para el equivalente
 * Node). GOOGLE (por email normalizado) y PORTAL (por cuenta_id) son las
 * dos poblaciones; hoy en Node solo la rama PORTAL es alcanzable
 * (`contexto.via_portal` siempre viene `true`), pero se porta la rama
 * GOOGLE igual, fiel al .gs, para el día en que haya sesión de Google en
 * Node.
 *
 * Foto: el navegador ya entrega la miniatura recortada y redimensionada
 * (ver frontend/js/perfil.js#montarRecortador_, SIEMPRE JPEG 160x160 sin
 * importar el formato del original) -- el backend la guarda TAL CUAL,
 * inline en la tabla PERFILES (igual que en Sheets: una celda de ~10-14k
 * caracteres es barata, y así pintar un avatar nunca dispara una llamada
 * aparte a R2). Lo único que el backend valida por sí mismo es el ARCHIVO
 * ORIGINAL, por firma binaria (nunca el nombre ni el mime que declaró el
 * cliente) -- sube a R2 solo como respaldo de esa validación; ninguna
 * pantalla lo vuelve a pedir.
 *
 * NO se porta el cache de lecturas que tenía el .gs (PERF/CACHE en
 * perfiles.test.js): existía para no pagar cuota/latencia de
 * SpreadsheetApp en cada avatar -- un problema de Sheets, no de SQLite. Acá
 * leerFilas_ ya lee un archivo local en memoria; agregar una capa de cache
 * propia sería complejidad sin problema real que resolver.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorFiltro_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion, errorForbidden } = require('./errores');
const Almacenamiento = require('./almacenamiento');
const { detectarMimeImagenProyecto_ } = require('./proyectos');

const MAX_FOTO_BYTES = 5 * 1024 * 1024;
// El navegador genera ~10-14k caracteres; el techo es solo para no aceptar
// cualquier cosa como "miniatura" (no es el límite real esperado).
const MAX_THUMB_BYTES = 500 * 1024;

function normalizarEmail_(email) {
  return String(email || '').trim().toLowerCase();
}
function leerSeguro_(db, hoja) {
  try { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
  catch (err) { return []; }
}
function parsearListaEmails_(valor) {
  if (Array.isArray(valor)) return valor;
  if (!valor) return [];
  try { const l = JSON.parse(valor); return Array.isArray(l) ? l : []; } catch (err) { return []; }
}
function soloBase64_(valor) {
  return String(valor || '').replace(/^data:[^,]+;base64,/, '');
}
function dataUri_(mime, base64) {
  return base64 ? 'data:' + mime + ';base64,' + base64 : '';
}

function identidadDe_(contexto) {
  if (!contexto) return null;
  if (contexto.via_portal) {
    return contexto.cuenta_id ? { tipo: 'PORTAL', clave: String(contexto.cuenta_id) } : null;
  }
  return contexto.email ? { tipo: 'GOOGLE', clave: normalizarEmail_(contexto.email) } : null;
}

// No se copian nombre/rol/empresa a un perfil propio: se leen de donde ya
// viven (USUARIOS o CUENTAS_PORTAL), para que no haya dos versiones del
// mismo dato.
function datosIdentidad_(db, contexto, identidad) {
  if (identidad.tipo === 'PORTAL') {
    const cuenta = leerSeguro_(db, 'CUENTAS_PORTAL').find((c) => String(c.cuenta_id) === identidad.clave) || {};
    return {
      nombre: cuenta.nombre || contexto.email || '',
      email: contexto.email || '',
      cargo: cuenta.cargo || '',
      rol: cuenta.rol || contexto.rol || '',
      empresa_id: cuenta.empresa_id || '',
      ultimo_acceso: cuenta.ultimo_acceso || ''
    };
  }
  const usuario = leerSeguro_(db, 'USUARIOS').find((u) => normalizarEmail_(u.email) === identidad.clave) || {};
  return {
    nombre: usuario.nombre || contexto.email || '',
    email: usuario.email || contexto.email || '',
    cargo: '',
    rol: usuario.rol || contexto.rol || '',
    empresa_id: usuario.empresa_id || '',
    // Los correos GOOGLE (legado) no tienen "último acceso" registrado en
    // ningún lado -- USUARIOS nunca guardó eso.
    ultimo_acceso: ''
  };
}

function nombreEmpresa_(db, empresaId) {
  if (!empresaId) return '';
  const fila = leerSeguro_(db, 'CAT_EMPRESAS').find((e) => e.empresa_id === empresaId);
  return fila ? (fila.nombre || empresaId) : empresaId;
}

function leerFilaPerfil_(db, identidad) {
  return leerSeguro_(db, 'PERFILES')
    .find((p) => p.identidad_tipo === identidad.tipo && p.identidad_clave === identidad.clave) || null;
}

function getMiPerfil(db, data, contexto) {
  const identidad = identidadDe_(contexto);
  if (!identidad) {
    return { _forbidden: true, message: 'No fue posible resolver tu identidad.' };
  }
  const base = datosIdentidad_(db, contexto, identidad);
  const filaFoto = leerFilaPerfil_(db, identidad);
  const foto = dataUri_(filaFoto && filaFoto.thumb_mime, filaFoto && filaFoto.thumb_base64);
  return {
    nombre: base.nombre,
    email: base.email,
    cargo: base.cargo,
    rol: base.rol,
    empresa_id: base.empresa_id,
    empresa_nombre: nombreEmpresa_(db, base.empresa_id),
    // El origen sirve al frontend para rotular de donde viene la cuenta; no
    // es un identificador utilizable para escribir.
    origen: identidad.tipo,
    ultimo_acceso: base.ultimo_acceso,
    tiene_foto: !!foto,
    foto_thumb: foto
  };
}

// --- foto de perfil --------------------------------------------------------

// Clave ESTABLE (sin uuid): una persona tiene una sola foto vigente, así que
// subir una nueva sobrescribe la anterior en R2 en vez de ir acumulando
// archivos huérfanos que nadie vuelve a referenciar.
function claveOriginal_(identidad) {
  return 'perfiles/' + identidad.tipo.toLowerCase() + '/' + identidad.clave + '/original';
}

async function guardarFoto(db, data, contexto) {
  const identidad = identidadDe_(contexto);
  if (!identidad) return errorForbidden('No fue posible resolver tu identidad.');

  const contenidoBase64 = soloBase64_(data && data.contenido_base64);
  const thumbBase64 = soloBase64_(data && data.thumb_base64);
  if (!contenidoBase64) return errorValidacion('contenido_base64', 'Falta la imagen.');
  if (!thumbBase64) return errorValidacion('thumb_base64', 'Falta la miniatura.');

  let bytesOriginal, bytesThumb;
  try { bytesOriginal = Buffer.from(contenidoBase64, 'base64'); }
  catch (err) { return errorValidacion('contenido_base64', 'La imagen no es base64 válida.'); }
  try { bytesThumb = Buffer.from(thumbBase64, 'base64'); }
  catch (err) { return errorValidacion('thumb_base64', 'La miniatura no es base64 válida.'); }

  if (!bytesOriginal.length) return errorValidacion('contenido_base64', 'La imagen está vacía.');
  if (bytesOriginal.length > MAX_FOTO_BYTES) {
    return errorValidacion('contenido_base64', 'La imagen supera el tamaño máximo (' + Math.round(MAX_FOTO_BYTES / (1024 * 1024)) + ' MB).');
  }
  if (bytesThumb.length > MAX_THUMB_BYTES) {
    return errorValidacion('thumb_base64', 'La miniatura recibida es demasiado pesada.');
  }

  // Firma binaria real, nunca el nombre ni el mime que declaró el cliente
  // (mismo criterio que Calidad/Novedades/Pausas para sus propios archivos;
  // el mime declarado por el cliente, si viene, se ignora por completo).
  const mimeOriginal = detectarMimeImagenProyecto_(bytesOriginal);
  if (!mimeOriginal) return errorValidacion('contenido_base64', 'El archivo no es una imagen JPG, PNG o WebP válida.');
  const mimeThumb = detectarMimeImagenProyecto_(bytesThumb);
  if (!mimeThumb) return errorValidacion('thumb_base64', 'La miniatura generada no es una imagen válida.');

  const clave = claveOriginal_(identidad);
  const subida = await Almacenamiento.subirArchivo_(clave, contenidoBase64, mimeOriginal);
  if (!subida.ok) return errorValidacion('contenido_base64', subida.message);

  const cambios = {
    thumb_base64: thumbBase64, thumb_mime: mimeThumb,
    original_clave: clave, original_mime: mimeOriginal,
    actualizado_en: new Date().toISOString()
  };
  const actualizado = actualizarFilaPorFiltro_(db, 'PERFILES',
    (p) => p.identidad_tipo === identidad.tipo && p.identidad_clave === identidad.clave, cambios);
  if (!actualizado) {
    agregarFila_(db, 'PERFILES', Object.assign({
      perfil_id: crypto.randomUUID(), identidad_tipo: identidad.tipo, identidad_clave: identidad.clave
    }, cambios));
  }

  return { tiene_foto: true, foto_thumb: dataUri_(mimeThumb, thumbBase64) };
}

async function eliminarFoto(db, data, contexto) {
  const identidad = identidadDe_(contexto);
  if (!identidad) return errorForbidden('No fue posible resolver tu identidad.');

  const fila = leerFilaPerfil_(db, identidad);
  // Borrado en R2 best-effort: si falla (infraestructura), igual se limpia
  // la fila -- el usuario pidió "sacar la foto" y eso se cumple aunque el
  // archivo original quede huérfano en el bucket (no se vuelve a servir).
  if (fila && fila.original_clave) {
    await Almacenamiento.eliminarArchivo_(fila.original_clave).catch(() => {});
  }
  actualizarFilaPorFiltro_(db, 'PERFILES',
    (p) => p.identidad_tipo === identidad.tipo && p.identidad_clave === identidad.clave,
    { thumb_base64: '', thumb_mime: '', original_clave: '', original_mime: '', actualizado_en: new Date().toISOString() });

  return { tiene_foto: false, foto_thumb: '' };
}

// Dado un lote de correos, resuelve a qué IDENTIDAD corresponde cada uno
// (una cuenta portal puede tener varios correos, ver CUENTAS_PORTAL.emails)
// y devuelve mapa correo -> miniatura (data URI). Es lo que evita que una
// lista de comentarios/tareas dispare una llamada por autor.
function getFotosDe(db, data, contexto) {
  const identidadPropia = identidadDe_(contexto);
  if (!identidadPropia) return errorForbidden('No fue posible resolver tu identidad.');

  const correos = Array.isArray(data && data.emails) ? data.emails : [];
  if (!correos.length) return { fotos: {} };

  const cuentas = leerSeguro_(db, 'CUENTAS_PORTAL');
  const porIdentidad = {};
  leerSeguro_(db, 'PERFILES').forEach((p) => { porIdentidad[p.identidad_tipo + ':' + p.identidad_clave] = p; });

  const fotos = {};
  correos.forEach((correoCrudo) => {
    const correo = normalizarEmail_(correoCrudo);
    if (!correo) return;
    const cuenta = cuentas.find((c) => parsearListaEmails_(c.emails).some((e) => normalizarEmail_(e) === correo));
    const fila = cuenta
      ? porIdentidad['PORTAL:' + String(cuenta.cuenta_id)]
      : porIdentidad['GOOGLE:' + correo];
    if (fila && fila.thumb_base64) fotos[correo] = dataUri_(fila.thumb_mime, fila.thumb_base64);
  });
  return { fotos };
}

module.exports = { getMiPerfil, guardarFoto, eliminarFoto, getFotosDe };
