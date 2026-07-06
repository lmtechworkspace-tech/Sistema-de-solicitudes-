/**
 * Config.gs — proyecto de instalacion (Instalador).
 * Duplicado deliberado de backend/intake/Config.gs (ver esa nota): este es
 * un tercer proyecto Apps Script, separado de Intake y Backoffice, que se
 * ejecuta una sola vez para crear el esquema en la planilla (§17.2).
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
