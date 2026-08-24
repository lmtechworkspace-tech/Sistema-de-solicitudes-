/**
 * Config.gs — App Gestion (Backoffice)
 *
 * Mismo criterio que backend/intake/Config.gs: los IDs se leen de Script
 * Properties, nunca se hardcodean. Cada Web App (Intake/Backoffice) es un
 * proyecto Apps Script separado por diseno (§2.1), por lo que este archivo
 * se duplica deliberadamente en vez de compartirse via libreria.
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
var VERSION_SIGSO = '2026-08-23';

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
