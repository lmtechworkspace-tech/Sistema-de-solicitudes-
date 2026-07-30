/**
 * DriveRepo.gs — estructura de carpetas de Drive (§11.1).
 * Duplicado deliberado de backend/intake/DriveRepo.gs (ver la nota de
 * duplicacion en Config.gs); Documentos.gs necesita la misma carpeta de la
 * solicitud para dejar ahi el Doc/PDF generado.
 */

function obtenerCarpetaRaiz_() {
  var config = getConfig_();
  if (!config.driveRootFolderId) {
    throw new Error('SIGSO_DRIVE_ROOT_FOLDER_ID no esta configurado en Script Properties.');
  }
  return DriveApp.getFolderById(config.driveRootFolderId);
}

function obtenerOCrearSubcarpeta_(carpetaPadre, nombre) {
  var existentes = carpetaPadre.getFoldersByName(nombre);
  if (existentes.hasNext()) {
    return existentes.next();
  }
  return carpetaPadre.createFolder(nombre);
}

function obtenerCarpetaSolicitud_(solicitud) {
  var raiz = obtenerCarpetaRaiz_();
  var carpetaSolicitudes = obtenerOCrearSubcarpeta_(raiz, 'SIGSO_Solicitudes');
  var anio = String(new Date(solicitud.fecha_creacion).getFullYear());
  var carpetaAnio = obtenerOCrearSubcarpeta_(carpetaSolicitudes, anio);
  var carpetaEmpresa = obtenerOCrearSubcarpeta_(carpetaAnio, solicitud.empresa_id);
  return obtenerOCrearSubcarpeta_(carpetaEmpresa, solicitud.solicitud_id);
}

function obtenerCarpetaAdjuntos_(solicitud) {
  var carpetaSolicitud = obtenerCarpetaSolicitud_(solicitud);
  return obtenerOCrearSubcarpeta_(carpetaSolicitud, 'Adjuntos');
}

// v6.4 (foto de perfil): originales de las fotos de perfil. Cuelga de la
// misma raiz que el resto y NUNCA se llama setSharing sobre ella ni sobre
// sus archivos: al heredar los permisos de la raiz (privada), la foto de una
// persona no queda accesible para cualquiera con el enlace. Lo que se muestra
// en pantalla es la miniatura de PERFILES.foto_thumb, no este archivo.
function obtenerCarpetaPerfiles_() {
  return obtenerOCrearSubcarpeta_(obtenerCarpetaRaiz_(), 'SIGSO_Perfiles');
}

// v6.5 (modulo Novedades): adjuntos de las novedades (ej. el PDF de una
// ley). Privada como el resto -- a diferencia de la foto de perfil, aqui SI
// hace falta que cualquier lector autenticado pueda bajar el archivo, pero
// eso se resuelve por una accion de backend que sirve el base64 (Novedades.
// descargarAdjunto), nunca haciendo publica la carpeta.
function obtenerCarpetaNovedades_() {
  return obtenerOCrearSubcarpeta_(obtenerCarpetaRaiz_(), 'SIGSO_Novedades');
}
