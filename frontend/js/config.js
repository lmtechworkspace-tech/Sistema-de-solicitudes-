/**
 * config.js — a dónde habla el frontend.
 *
 * Desde el 2026-09-27 SIGSO tiene UN solo backend: el servidor Node
 * (api.ctrly.cl). Apps Script se apagó. INTAKE_URL y BACKOFFICE_URL se
 * conservan con el mismo valor solo porque cientos de llamadas los pasan como
 * primer argumento de llamarApi (que igual los ignora, ver api.js).
 *
 * Esta URL NO es secreta: viaja al navegador en cada request; la seguridad
 * nunca depende de ocultarla.
 */
window.SIGSO_CONFIG = Object.freeze({
  VERSION: '2026-09-05',
  NODE_API_URL: 'https://api.ctrly.cl/v1/accion',
  INTAKE_URL: 'https://api.ctrly.cl/v1/accion',
  BACKOFFICE_URL: 'https://api.ctrly.cl/v1/accion',
  // '' porque este archivo se sirve desde el sitio público (GitHub Pages):
  // los enlaces "propios" del header (index.html/estado.html) son relativos.
  SITIO_PUBLICO: '',
  TIMEZONE: 'America/Santiago'
});
