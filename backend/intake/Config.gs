/**
 * Config.gs — App Publica (Intake)
 *
 * Los IDs de Sheets/Drive NUNCA se hardcodean en el codigo fuente: se leen de
 * Script Properties (Project Settings > Script Properties) para que cada
 * ambiente (dev/prod) despliegue el mismo codigo con distinta configuracion.
 * Ver checklist de preparacion (documentacion/fases/FASE-00-fundamentos.md).
 */

/**
 * Version del codigo que esta REALMENTE pegado en este proyecto de Apps
 * Script. Se sube a mano al armar cada paquete de despliegue.
 *
 * POR QUE EXISTE. El backend se despliega copiando y pegando archivos, asi
 * que no hay forma de saber, mirando la planilla o la app, si lo que corre
 * es lo ultimo. Ya paso: la planilla quedo dos fases atrasada y solo se
 * descubrio cuando unos datos entraron corridos de columna.
 *
 * El frontend se publica solo con cada push, asi que su version (ver
 * frontend/js/config.js) es SIEMPRE la esperada. Si esta no coincide con
 * aquella, es que falta pegar el backend -- y la plataforma lo avisa.
 *
 * IMPORTANTE: el mismo valor va en los tres proyectos (Backoffice, Intake,
 * Setup) y en frontend/js/config.js. Hay un test que falla si divergen.
 */
var VERSION_SIGSO = '2026-08-22';

var CONFIG_KEYS = {
  SHEET_ID: 'SIGSO_SHEET_ID',
  DRIVE_ROOT_FOLDER_ID: 'SIGSO_DRIVE_ROOT_FOLDER_ID',
  TIMEZONE: 'SIGSO_TIMEZONE'
};

function getConfig_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  return {
    sheetId: props[CONFIG_KEYS.SHEET_ID] || null,
    driveRootFolderId: props[CONFIG_KEYS.DRIVE_ROOT_FOLDER_ID] || null,
    timezone: props[CONFIG_KEYS.TIMEZONE] || 'America/Santiago'
  };
}
