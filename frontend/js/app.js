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

    // v2.1 (Fase C): Panel de Control de Gerencia.
    document.getElementById('btn-ver-gerencia').addEventListener('click', mostrarGerencia_);
    document.getElementById('btn-volver-dashboard-gerencia').addEventListener('click', mostrarDashboard_);
    document.getElementById('btn-actualizar-gerencia').addEventListener('click', function () {
      SigsoGerencia.cargar();
    });

    // v4.2: Panel de Jefatura ("Mi departamento").
    document.getElementById('btn-ver-jefatura').addEventListener('click', mostrarJefatura_);
    document.getElementById('btn-volver-dashboard-jefatura').addEventListener('click', mostrarDashboard_);
    document.getElementById('btn-actualizar-jefatura').addEventListener('click', function () {
      SigsoJefatura.cargar();
    });
  });

  function ocultarTodasLasVistas_() {
    ['vista-dashboard', 'vista-detalle', 'vista-gerencia', 'vista-jefatura'].forEach(function (id) {
      document.getElementById(id).classList.add('sigso-oculto');
    });
  }

  function mostrarDetalle_(solicitudId) {
    ocultarTodasLasVistas_();
    document.getElementById('vista-detalle').classList.remove('sigso-oculto');
    SigsoDetalle.cargar(solicitudId);
  }

  function mostrarDashboard_() {
    ocultarTodasLasVistas_();
    document.getElementById('vista-dashboard').classList.remove('sigso-oculto');
    SigsoDashboard.cargar();
  }

  function mostrarGerencia_() {
    ocultarTodasLasVistas_();
    document.getElementById('vista-gerencia').classList.remove('sigso-oculto');
    SigsoGerencia.inicializarFiltros();
    SigsoGerencia.cargar();
  }

  function mostrarJefatura_() {
    ocultarTodasLasVistas_();
    document.getElementById('vista-jefatura').classList.remove('sigso-oculto');
    SigsoJefatura.cargar();
  }
})();
