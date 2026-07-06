/**
 * app.js — Backoffice: orquesta las vistas dashboard/detalle (§12.4/12.5).
 */
(function () {
  window.SigsoApp = { mostrarDetalle: mostrarDetalle_, mostrarDashboard: mostrarDashboard_ };

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof renderHeaderSigso === 'function') {
      renderHeaderSigso('app');
    }
    SigsoDashboard.inicializarFiltros();
    SigsoDashboard.cargar();

    document.getElementById('btn-actualizar-dashboard').addEventListener('click', function () {
      SigsoDashboard.cargar();
    });
    document.getElementById('btn-volver-dashboard').addEventListener('click', mostrarDashboard_);
  });

  function mostrarDetalle_(solicitudId) {
    document.getElementById('vista-dashboard').classList.add('sigso-oculto');
    document.getElementById('vista-detalle').classList.remove('sigso-oculto');
    SigsoDetalle.cargar(solicitudId);
  }

  function mostrarDashboard_() {
    document.getElementById('vista-detalle').classList.add('sigso-oculto');
    document.getElementById('vista-dashboard').classList.remove('sigso-oculto');
    SigsoDashboard.cargar();
  }
})();
