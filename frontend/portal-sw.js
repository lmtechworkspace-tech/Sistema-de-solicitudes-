/**
 * portal-sw.js — trabajador en segundo plano del Portal de clientes (2026-10-08).
 * Solo hace dos cosas: mostrar el aviso que manda el servidor (portalPush.js)
 * y, al tocarlo, abrir el pedido en el portal. No guarda páginas ni intercepta
 * pedidos de red: el portal siempre se ve con su última versión. Su alcance es
 * solo portal.html (se registra con scope './portal.html'), nunca la plataforma.
 */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (ev) { ev.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (ev) {
  var d = {};
  try { d = ev.data ? ev.data.json() : {}; } catch (e) { d = { cuerpo: ev.data ? ev.data.text() : '' }; }
  ev.waitUntil(self.registration.showNotification(d.titulo || 'HomePymes', {
    body: d.cuerpo || 'Tienes novedades en tu portal.',
    icon: 'assets/portal/icono-192.png',
    badge: 'assets/portal/insignia-96.png',
    tag: d.tag || 'portal',
    renotify: true,
    lang: 'es-CL',
    data: { pedido: d.pedido || '' }
  }));
});

self.addEventListener('notificationclick', function (ev) {
  ev.notification.close();
  var pedido = (ev.notification.data || {}).pedido || '';
  var destino = new URL('portal.html' + (pedido ? '#pedido=' + encodeURIComponent(pedido) : ''), self.registration.scope).href;
  ev.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (ventanas) {
    var abierta = ventanas.filter(function (v) { return v.url.indexOf('portal.html') !== -1; })[0];
    if (abierta) { abierta.postMessage({ tipo: 'abrir-pedido', pedido: pedido }); return abierta.focus(); }
    return self.clients.openWindow(destino);
  }));
});
