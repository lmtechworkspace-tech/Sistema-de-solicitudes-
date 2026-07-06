/**
 * config.js — URLs de ambos Web Apps (§2.4).
 *
 * Esta URL de /exec NO es secreta: viaja al navegador en cada request: la
 * seguridad nunca depende de ocultarla (§2.4, nota GitHub Pages). Se
 * reemplaza por el ID real al desplegar cada Web App (checklist §17.2).
 */
window.SIGSO_CONFIG = Object.freeze({
  INTAKE_URL: 'https://script.google.com/macros/s/REEMPLAZAR_ID_PUB/exec',
  BACKOFFICE_URL: 'https://script.google.com/macros/s/REEMPLAZAR_ID_MGMT/exec',
  TIMEZONE: 'America/Santiago'
});
