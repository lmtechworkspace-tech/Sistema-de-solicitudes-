/**
 * app.js — Backoffice: orquesta las vistas dashboard/detalle (§12.4/12.5).
 */
(function () {
  window.SigsoApp = {
    mostrarDetalle: mostrarDetalle_,
    mostrarDashboard: mostrarDashboard_,
    // v7.1 (notificaciones vivas): navegacion por id de modulo, para que un
    // click en una notificacion funcione igual aca que en el shell del
    // portal (window.SigsoShell.irAModulo en plataforma.js). 'pausas' y
    // 'pausas_coordinacion' no tienen vista en este shell (solo existen en
    // el portal) -- si llega una notificacion con esos modulos aca, no hay
    // a donde navegar; se ignora en vez de romper.
    irAModulo: function (id) {
      var destinos = {
        home: mostrarDashboard_,
        gerencia: mostrarGerencia_,
        jefatura: mostrarJefatura_,
        novedades: mostrarNovedades_,
        mi_trabajo: mostrarMiTrabajo_
      };
      if (destinos[id]) destinos[id]();
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof renderHeaderSigso === 'function') {
      renderHeaderSigso('app');
    }
    // v6.4: identidad + "Mi perfil" en el header. Antes esta pagina no
    // mostraba en ningun lado con que usuario estabas trabajando.
    if (window.SigsoPerfil) {
      SigsoPerfil.montarHeaderUsuario();
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

    // v6.5: Novedades es CORE -- visible para todos, sin gate de rol.
    document.getElementById('btn-ver-novedades').addEventListener('click', mostrarNovedades_);
    document.getElementById('btn-volver-dashboard-novedades').addEventListener('click', mostrarDashboard_);
    if (window.SigsoNovedades) {
      SigsoNovedades.actualizarBadge();
      // Fase 3: tarjeta con la novedad pendiente mas relevante en el
      // Dashboard (que aqui hace de "Home" -- app.html no tiene una
      // pantalla de inicio separada).
      SigsoNovedades.pintarTarjetaHome('novedades-home');
    }

    // v7.0 (Fase 2): "Mi trabajo" -- disponible para cualquier sesion de
    // staff, mismo criterio de visibilidad que la bandeja.
    document.getElementById('btn-ver-mi-trabajo').addEventListener('click', mostrarMiTrabajo_);
    document.getElementById('btn-volver-dashboard-mi-trabajo').addEventListener('click', mostrarDashboard_);
  });

  function ocultarTodasLasVistas_() {
    ['vista-dashboard', 'vista-detalle', 'vista-gerencia', 'vista-jefatura', 'vista-novedades', 'vista-mi-trabajo'].forEach(function (id) {
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

  function mostrarNovedades_() {
    ocultarTodasLasVistas_();
    document.getElementById('vista-novedades').classList.remove('sigso-oculto');
    if (window.SigsoNovedades) SigsoNovedades.cargar();
  }

  function mostrarMiTrabajo_() {
    ocultarTodasLasVistas_();
    document.getElementById('vista-mi-trabajo').classList.remove('sigso-oculto');
    if (window.SigsoActividades) SigsoActividades.cargar();
  }
})();
