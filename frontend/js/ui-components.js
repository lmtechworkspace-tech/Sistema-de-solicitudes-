/**
 * ui-components.js — header/nav compartido entre index.html, estado.html y
 * app.html (§2.4), para no duplicar el marcado en cada pagina.
 */
function renderHeaderSigso(paginaActiva) {
  var contenedor = document.getElementById('sigso-header');
  if (!contenedor) {
    return;
  }

  var paginas = [
    { href: 'index.html', id: 'formulario', texto: 'Nueva solicitud' },
    { href: 'estado.html', id: 'estado', texto: 'Consultar estado' },
    { href: 'app.html', id: 'app', texto: 'Backoffice' },
    { href: 'admin.html', id: 'admin', texto: 'Administración' }
  ];

  var enlaces = paginas
    .map(function (p) {
      var actual = p.id === paginaActiva ? ' aria-current="page"' : '';
      return '<a href="' + p.href + '"' + actual + '>' + p.texto + '</a>';
    })
    .join('');

  contenedor.innerHTML =
    '<div class="sigso-header__interior">' +
    '<div>' +
    '<p class="sigso-header__titulo">SIGSO</p>' +
    '<p class="sigso-header__subtitulo">HomePymes / RLD &mdash; Gesti&oacute;n de solicitudes</p>' +
    '</div>' +
    '<nav class="sigso-nav">' + enlaces + '</nav>' +
    '</div>';
}
