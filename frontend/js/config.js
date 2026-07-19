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
  // '' porque este archivo se sirve desde el sitio publico (GitHub Pages):
  // los enlaces "propios" del header (index.html/estado.html) son relativos.
  // El stub de SIGSO_CONFIG embebido en App.html/Admin.html (Fase 8) usa
  // el valor real de este sitio, porque ahi SI es el "otro" sitio.
  SITIO_PUBLICO: '',
  // v3.3 (plataforma): a donde apuntan los modulos del staff mientras viven
  // en el Backoffice con login Google (P3/P4 los traeran adentro del shell).
  // Son la misma URL /exec del Backoffice con ?page=app / ?page=admin.
  BACKOFFICE_APP_URL: 'https://script.google.com/macros/s/AKfycbzoC2IsvrwPIElUeTgIxmNxLcNsEH3SXU8TrKLM-sFntZjd8ratSv8w_1-zGo1MmdCcFg/exec?page=app',
  BACKOFFICE_ADMIN_URL: 'https://script.google.com/macros/s/AKfycbzoC2IsvrwPIElUeTgIxmNxLcNsEH3SXU8TrKLM-sFntZjd8ratSv8w_1-zGo1MmdCcFg/exec?page=admin',
  // v3.3 P3: SEGUNDA implementacion del MISMO proyecto Backoffice, publicada
  // como "Ejecutar como: yo / Acceso: cualquier persona" -- es la que
  // reciben las llamadas por token de la plataforma (la identidad la pone el
  // token, no Google). '' = aun no creada: la bandeja del shell avisara que
  // falta desplegarla. Ver DEPLOY v33-p3.
  BACKOFFICE_TOKEN_URL: '',
  TIMEZONE: 'America/Santiago'
});
