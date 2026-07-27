/**
 * Config.gs — App Gestion (Backoffice)
 *
 * Mismo criterio que backend/intake/Config.gs: los IDs se leen de Script
 * Properties, nunca se hardcodean. Cada Web App (Intake/Backoffice) es un
 * proyecto Apps Script separado por diseno (§2.1), por lo que este archivo
 * se duplica deliberadamente en vez de compartirse via libreria.
 */

var CONFIG_KEYS = {
  SHEET_ID: 'SIGSO_SHEET_ID',
  DRIVE_ROOT_FOLDER_ID: 'SIGSO_DRIVE_ROOT_FOLDER_ID',
  TIMEZONE: 'SIGSO_TIMEZONE',
  // v6.0 (Pausas P4.1): URL publica del sitio (GitHub Pages), para construir
  // enlaces magicos DESDE el servidor (recordatorios por correo). Es la MISMA
  // nocion que frontend/js/config.js SITIO_PUBLICO, pero ese vive en el
  // navegador -- el servidor necesita su propia copia via Script Properties.
  // Si no esta configurada, el enlace simplemente no se incluye (el correo
  // sigue saliendo, solo sin el boton de acceso directo).
  SITIO_PUBLICO: 'SIGSO_SITIO_PUBLICO'
};

function getConfig_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  return {
    sheetId: props[CONFIG_KEYS.SHEET_ID] || null,
    driveRootFolderId: props[CONFIG_KEYS.DRIVE_ROOT_FOLDER_ID] || null,
    timezone: props[CONFIG_KEYS.TIMEZONE] || 'America/Santiago',
    sitioPublico: props[CONFIG_KEYS.SITIO_PUBLICO] || ''
  };
}
