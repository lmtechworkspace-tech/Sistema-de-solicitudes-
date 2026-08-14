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
    '<p class="sigso-header__subtitulo">Control y Gesti&oacute;n Empresarial</p>' +
    '</div>' +
    '</div>' +
    '<nav class="sigso-nav">' + enlaces + '</nav>' +
    // v6.4: hueco para la identidad del usuario (avatar + menu "Mi perfil").
    // Queda VACIO en index.html y estado.html, que son publicas y no tienen
    // sesion; solo lo rellena SigsoPerfil.montarHeaderUsuario(), que llaman
    // app.js y admin.js -- las paginas con login de Google.
    '<div class="sigso-header__usuario" id="sigso-header-usuario"></div>' +
    '</div>';
}

// v4.0 Frente 6 (marca): el mismo distintivo visual del favicon, ahora
// dentro de la pagina -- antes "SIGSO" era solo texto, sin una marca que se
// reconociera de un vistazo entre pestanas o capturas de pantalla.
var MARCA_SIGSO_SVG = '<svg class="sigso-marca" width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">' +
  '<rect width="32" height="32" rx="8" fill="#14213D"></rect>' +
  '<rect x="1" y="1" width="30" height="30" rx="7" fill="none" stroke="#2A5FD6" stroke-width="1.5"></rect>' +
  '<text x="16" y="22.5" font-family="Georgia, \'Times New Roman\', serif" font-weight="700" font-size="18" fill="#fff" text-anchor="middle">S</text>' +
  '</svg>';
