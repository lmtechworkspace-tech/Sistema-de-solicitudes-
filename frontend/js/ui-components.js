/**
 * ui-components.js — header/nav compartido entre index.html, estado.html
 * (GitHub Pages) y App.html/Admin.html (servidos por Apps Script, Fase 8).
 *
 * Los enlaces cruzan de sitio (GitHub Pages <-> Apps Script), asi que no
 * pueden ser rutas relativas fijas: usan SITIO_PUBLICO/BACKOFFICE_URL de
 * SIGSO_CONFIG. En cada sitio, la ruta "propia" queda vacia/relativa
 * (SITIO_PUBLICO='' en config.js de GitHub Pages, BACKOFFICE_URL='' en el
 * stub de App.html/Admin.html) y la ruta "del otro sitio" es absoluta.
 */
function renderHeaderSigso(paginaActiva) {
  var contenedor = document.getElementById('sigso-header');
  if (!contenedor) {
    return;
  }

  var cfg = window.SIGSO_CONFIG || {};
  var sitioPublico = cfg.SITIO_PUBLICO || '';
  var backofficeUrl = cfg.BACKOFFICE_URL || '';

  var paginas = [
    { href: sitioPublico + 'index.html', id: 'formulario', texto: 'Nueva solicitud' },
    { href: sitioPublico + 'estado.html', id: 'estado', texto: 'Consultar estado' },
    { href: backofficeUrl + '?page=app', id: 'app', texto: 'Backoffice' },
    { href: backofficeUrl + '?page=admin', id: 'admin', texto: 'Administración' }
  ];

  var enlaces = paginas
    .map(function (p) {
      var actual = p.id === paginaActiva ? ' aria-current="page"' : '';
      return '<a href="' + p.href + '"' + actual + '>' + p.texto + '</a>';
    })
    .join('');

  contenedor.innerHTML =
    '<div class="sigso-header__interior">' +
    '<div class="sigso-header__marca">' +
    MARCA_SIGSO_SVG +
    '<div>' +
    '<p class="sigso-header__titulo">SIGSO</p>' +
    '<p class="sigso-header__subtitulo">HomePymes / RLD &mdash; Gesti&oacute;n de solicitudes</p>' +
    '</div>' +
    '</div>' +
    '<nav class="sigso-nav">' + enlaces + '</nav>' +
    '</div>';
}

// v4.0 Frente 6 (marca): el mismo distintivo visual del favicon, ahora
// dentro de la pagina -- antes "SIGSO" era solo texto, sin una marca que se
// reconociera de un vistazo entre pestanas o capturas de pantalla.
var MARCA_SIGSO_SVG = '<svg class="sigso-marca" width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">' +
  '<rect width="32" height="32" rx="8" fill="#E8622A"></rect>' +
  '<text x="16" y="23" font-family="Arial, sans-serif" font-weight="700" font-size="20" fill="#fff" text-anchor="middle">S</text>' +
  '</svg>';
