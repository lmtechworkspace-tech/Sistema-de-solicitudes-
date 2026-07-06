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
