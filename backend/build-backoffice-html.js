'use strict';

/**
 * build-backoffice-html.js — genera backend/backoffice/App.html y Admin.html
 * a partir de frontend/app.html y frontend/admin.html, inlineando su CSS y
 * JS locales (Apps Script HtmlService no sirve archivos estaticos sueltos:
 * todo el contenido de una pagina tiene que vivir en un unico archivo del
 * proyecto). frontend/app.html, frontend/admin.html y frontend/js/*.js
 * siguen siendo la fuente real (se usan para el dev-server local, Fase 5/6);
 * este script es lo que mantiene sincronizados los artefactos que van
 * pegados en el editor de Apps Script (Fase 8, ver MANUAL-DESPLIEGUE.md).
 *
 * Reemplaza ademas <script src="js/config.js"> por un stub inline: estas
 * paginas ya no llaman por fetch a BACKOFFICE_URL (usan google.script.run,
 * ver api.js), solo necesitan SITIO_PUBLICO para los enlaces cruzados del
 * header (ui-components.js).
 *
 * Uso: node backend/build-backoffice-html.js
 */

const fs = require('fs');
const path = require('path');

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const BACKOFFICE_DIR = path.join(__dirname, 'backoffice');
const SITIO_PUBLICO = 'https://lmtechworkspace-tech.github.io/Sistema-de-solicitudes-/';

const PAGINAS = [
  { origen: 'app.html', destino: 'App.html' },
  { origen: 'admin.html', destino: 'Admin.html' }
];

function leer(relPath) {
  return fs.readFileSync(path.join(FRONTEND_DIR, relPath), 'utf8');
}

function construirPagina(nombreArchivo) {
  let html = leer(nombreArchivo);

  // <link rel="stylesheet" href="css/X.css"> -> <style>...contenido...</style>
  html = html.replace(/<link rel="stylesheet" href="css\/([^"]+)"\s*\/?>/g, (match, archivoCss) => {
    const contenido = leer(path.join('css', archivoCss));
    return '<style>\n' + contenido + '\n</style>';
  });

  // <script src="js/config.js"></script> -> stub inline (Fase 8: sin fetch a
  // Backoffice, solo hace falta SITIO_PUBLICO para los enlaces del header).
  html = html.replace(
    /<script src="js\/config\.js"><\/script>/,
    '<script>\n' +
      "window.SIGSO_CONFIG = { BACKOFFICE_URL: '', SITIO_PUBLICO: '" + SITIO_PUBLICO + "' };\n" +
      '</script>'
  );

  // <script src="js/X.js"></script> (el resto) -> <script>...contenido...</script>
  html = html.replace(/<script src="js\/([^"]+)"><\/script>/g, (match, archivoJs) => {
    const contenido = leer(path.join('js', archivoJs));
    return '<script>\n' + contenido + '\n</script>';
  });

  return html;
}

const AVISO_GENERADO =
  '<!-- ARCHIVO GENERADO por backend/build-backoffice-html.js -- no editar a mano. ' +
  'Edita frontend/' +
  '%ORIGEN%' +
  ' y frontend/js/*.js, y vuelve a correr "npm run build:backoffice-html". -->\n';

PAGINAS.forEach(({ origen, destino }) => {
  const html = AVISO_GENERADO.replace('%ORIGEN%', origen) + construirPagina(origen);
  fs.writeFileSync(path.join(BACKOFFICE_DIR, destino), html);
  console.log('Generado backend/backoffice/' + destino + ' desde frontend/' + origen);
});
