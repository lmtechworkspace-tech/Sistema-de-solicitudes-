/**
 * DriveRepo.gs — estructura de carpetas de Drive (§11.1).
 *
 * SIGSO_Sistema/ (raiz, ya creada por el Admin -- su ID vive en Script
 * Properties, SIGSO_DRIVE_ROOT_FOLDER_ID) / SIGSO_Solicitudes/[AÑO]/[EMPRESA]/[N°_SOL]/.
 *
 * Se crea la carpeta de la solicitud (y su subcarpeta Adjuntos) desde el
 * momento en que se sube el primer archivo, no recien al aprobar (S04):
 * subirArchivo ocurre justo despues de crearSolicitud (§5.1 paso 6), antes
 * de cualquier aprobacion. RN-025 ("carpeta creada al aprobar") se
 * interpreta como que el Doc/PDF generado se coloca ahi al aprobar -- no
 * que la carpeta en si no pueda existir antes (supuesto documentado en
 * FASE-04-documentos-notificaciones.md).
 *
 * Duplicado deliberado en backend/backoffice/DriveRepo.gs (mismo criterio
 * que SheetsRepo.gs): Documentos.gs necesita la misma carpeta para dejar el
 * Doc/PDF generado.
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
