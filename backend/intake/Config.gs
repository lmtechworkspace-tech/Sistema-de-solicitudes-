/**
 * Config.gs — App Publica (Intake)
 *
 * Los IDs de Sheets/Drive NUNCA se hardcodean en el codigo fuente: se leen de
 * Script Properties (Project Settings > Script Properties) para que cada
 * ambiente (dev/prod) despliegue el mismo codigo con distinta configuracion.
 * Ver checklist de preparacion (documentacion/fases/FASE-00-fundamentos.md).
 */

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
