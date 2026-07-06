/**
 * config.js — URLs de ambos Web Apps (§2.4).
 *
 * Esta URL de /exec NO es secreta: viaja al navegador en cada request: la
 * seguridad nunca depende de ocultarla (§2.4, nota GitHub Pages). Se
 * reemplaza por el ID real al desplegar cada Web App (checklist §17.2).
 */
window.SIGSO_CONFIG = Object.freeze({
  INTAKE_URL: 'https://script.google.com/macros/s/AKfycbypI38IfuisU2DFMnvM9_knsbqgm8T-9rnkUUr5MbLlc5_J7BZuXhy8mZC-GtVHzEV9aA/exec',
  BACKOFFICE_URL: 'https://script.google.com/macros/s/AKfycbzoC2IsvrwPIElUeTgIxmNxLcNsEH3SXU8TrKLM-sFntZjd8ratSv8w_1-zGo1MmdCcFg/exec',
  TIMEZONE: 'America/Santiago'
});
