/**
 * plataforma.js — el shell de la plataforma (v3.3, P2).
 *
 * Maneja: login/logout, sesion persistida (localStorage), cambio de clave
 * obligatorio al primer ingreso, y la navegacion por modulos segun la
 * cuenta. Los modulos en si son los archivos de siempre (formulario.js,
 * estado.js): este script solo decide cual se ve y les pasa el contexto de
 * la sesion (autocompletado, token).
 *
 * P2 monta nueva_solicitud y mis_solicitudes. Los modulos del staff
 * (bandeja/gerencia/administracion) todavia viven en app.html/admin.html
 * con login de Google: si la cuenta los tiene, se muestran como enlaces
 * hacia alla (P3/P4 los traeran adentro).
 */
(function () {
  var LLAVE_TOKEN = 'sigso_portal_token';

  // Catalogo de modulos del shell. `interno: true` = vive en esta pagina;
  // si no, es un enlace externo (transicion P2 -> P3/P4).
  var MODULOS_SHELL = {
    nueva_solicitud: { icono: '📝', nombre: 'Nueva solicitud', descripcion: 'Ingresa un pedido al equipo', interno: true },
    mis_solicitudes: { icono: '📋', nombre: 'Mis solicitudes', descripcion: 'El estado de todo lo tuyo, de todos tus correos', interno: true },
    // P3: bandeja y gerencia viven DENTRO del shell (dashboard.js/detalle.js/
    // gerencia.js orquestados aqui, con el token de la sesion via api.js).
    bandeja: { icono: '🗂', nombre: 'Bandeja de trabajo', descripcion: 'Solicitudes del equipo: estados, fechas, derivaciones', interno: true },
    gerencia: { icono: '📊', nombre: 'Panel de gerencia', descripcion: 'KPIs, semáforo de cumplimiento y seguimiento', interno: true },
    administracion: { icono: '⚙️', nombre: 'Administración', descripcion: 'Catálogos, usuarios y cuentas (abre con tu cuenta Google)', urlConfig: 'BACKOFFICE_ADMIN_URL' }
  };

  var sesion = { token: null, cuenta: null };
  var autocompletadoHecho = false;

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('form-login').addEventListener('submit', manejarLogin_);
    document.getElementById('form-cambiar-clave').addEventListener('submit', manejarCambioClave_);
    document.getElementById('btn-logout').addEventListener('click', manejarLogout_);

    // Sesion guardada: restaurar sin re-loguear. Si expiro, al login.
    var token = null;
    try { token = localStorage.getItem(LLAVE_TOKEN); } catch (err) { /* sin storage */ }
    if (!token) {
      mostrarVista_('vista-login');
      return;
    }
    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'portalSesion', { token: token })
      .then(function (respuesta) {
        if (!respuesta.ok) {
          olvidarToken_();
          mostrarVista_('vista-login');
          return;
        }
        iniciarSesion_(token, respuesta.data.cuenta);
      })
      .catch(function () {
        // Sin red: mejor pedir login de nuevo que un shell a medias.
        mostrarVista_('vista-login');
      });
  });

  // --- login / logout / cambio de clave ---------------------------------

  function manejarLogin_(evento) {
    evento.preventDefault();
    var boton = document.getElementById('btn-login');
    var salida = document.getElementById('resultado-login');
    boton.disabled = true;
    salida.innerHTML = '';

    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'portalLogin', {
      usuario: document.getElementById('campo-login-usuario').value,
      password: document.getElementById('campo-login-password').value
    }).then(function (respuesta) {
      if (!respuesta.ok) {
        salida.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo ingresar.', 'error');
        return;
      }
      document.getElementById('campo-login-password').value = '';
      guardarToken_(respuesta.data.token);
      iniciarSesion_(respuesta.data.token, respuesta.data.cuenta);
    }).catch(function () {
      salida.innerHTML = Componentes.alerta('No se pudo conectar con el servidor. Intenta nuevamente.', 'error');
    }).finally(function () {
      boton.disabled = false;
    });
  }

  function manejarCambioClave_(evento) {
    evento.preventDefault();
    var salida = document.getElementById('resultado-cambiar-clave');
    var nueva = document.getElementById('campo-clave-nueva').value;
    if (nueva !== document.getElementById('campo-clave-repetir').value) {
      salida.innerHTML = Componentes.alerta('Las contraseñas nuevas no coinciden.', 'error');
      return;
    }
    var boton = document.getElementById('btn-cambiar-clave');
    boton.disabled = true;
    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'portalCambiarPassword', {
      token: sesion.token,
      password_actual: document.getElementById('campo-clave-actual').value,
      password_nueva: nueva
    }).then(function (respuesta) {
      if (!respuesta.ok) {
        salida.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cambiar la contraseña.', 'error');
        return;
      }
      sesion.cuenta.debe_cambiar_password = false;
      entrarAlShell_();
    }).catch(function () {
      salida.innerHTML = Componentes.alerta('No se pudo conectar con el servidor. Intenta nuevamente.', 'error');
    }).finally(function () {
      boton.disabled = false;
    });
  }

  function manejarLogout_() {
    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'portalLogout', { token: sesion.token }).catch(function () {});
    olvidarToken_();
    sesion = { token: null, cuenta: null };
    autocompletadoHecho = false;
    mostrarVista_('vista-login');
  }

  function iniciarSesion_(token, cuenta) {
    sesion = { token: token, cuenta: cuenta };
    if (cuenta.debe_cambiar_password) {
      mostrarVista_('vista-cambiar-clave');
      return;
    }
    entrarAlShell_();
  }

  // --- shell -------------------------------------------------------------

  function entrarAlShell_() {
    mostrarVista_('vista-shell');
    document.getElementById('nav-nombre-usuario').textContent = sesion.cuenta.nombre;
    renderNav_();
    renderHome_();
    mostrarModulo_('home');
  }

  function modulosDeLaCuenta_() {
    return (sesion.cuenta.modulos || []).filter(function (m) { return MODULOS_SHELL[m]; });
  }

  function urlExterna_(def) {
    return (window.SIGSO_CONFIG && window.SIGSO_CONFIG[def.urlConfig]) || '';
  }

  function renderNav_() {
    var nav = document.getElementById('nav-modulos');
    nav.innerHTML = '<button type="button" class="plataforma-nav__item" data-modulo="home">🏠 Inicio</button>' +
      modulosDeLaCuenta_().map(function (id) {
        var def = MODULOS_SHELL[id];
        if (def.interno) {
          return '<button type="button" class="plataforma-nav__item" data-modulo="' + id + '">' +
            def.icono + ' ' + def.nombre + '</button>';
        }
        var url = urlExterna_(def);
        return url
          ? '<a class="plataforma-nav__item" href="' + Componentes.escaparHtml(url) + '" target="_blank" rel="noopener">' +
            def.icono + ' ' + def.nombre + ' ↗</a>'
          : '';
      }).join('');

    nav.querySelectorAll('[data-modulo]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        mostrarModulo_(boton.getAttribute('data-modulo'));
      });
    });
  }

  function renderHome_() {
    var nombrePila = String(sesion.cuenta.nombre || '').split(' ')[0];
    document.getElementById('saludo-home').textContent = 'Hola, ' + nombrePila;

    document.getElementById('cards-home').innerHTML = modulosDeLaCuenta_().map(function (id) {
      var def = MODULOS_SHELL[id];
      if (def.interno) {
        return '<button type="button" class="plataforma-card" data-modulo="' + id + '">' +
          '<span class="plataforma-card__icono">' + def.icono + '</span>' +
          '<strong>' + def.nombre + '</strong>' +
          '<span class="sigso-ayuda">' + def.descripcion + '</span>' +
          '</button>';
      }
      var url = urlExterna_(def);
      return url
        ? '<a class="plataforma-card" href="' + Componentes.escaparHtml(url) + '" target="_blank" rel="noopener">' +
          '<span class="plataforma-card__icono">' + def.icono + '</span>' +
          '<strong>' + def.nombre + ' ↗</strong>' +
          '<span class="sigso-ayuda">' + def.descripcion + '</span>' +
          '</a>'
        : '';
    }).join('');

    document.getElementById('cards-home').querySelectorAll('[data-modulo]').forEach(function (card) {
      card.addEventListener('click', function () {
        mostrarModulo_(card.getAttribute('data-modulo'));
      });
    });

    // "Requieren tu accion" del inicio: se pide el resumen una vez, en
    // segundo plano -- si falla, el inicio funciona igual (sin el aviso).
    if (modulosDeLaCuenta_().indexOf('mis_solicitudes') !== -1) {
      llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'misSolicitudes', { token: sesion.token })
        .then(function (respuesta) {
          if (!respuesta.ok) return;
          var resumen = respuesta.data.resumen;
          var avisos = [];
          if (resumen.pendientes_validar > 0) {
            avisos.push('⚠ Tienes <strong>' + resumen.pendientes_validar +
              '</strong> ítem(s) terminado(s) esperando tu validación.');
          }
          if (resumen.abiertas > 0) {
            avisos.push('Tienes ' + resumen.abiertas + ' solicitud(es) abierta(s).');
          }
          document.getElementById('pendientes-home').innerHTML = avisos.length
            ? '<div class="sigso-card plataforma-pendientes">' + avisos.join('<br>') + '</div>'
            : '';
        })
        .catch(function () {});
    }
  }

  function mostrarModulo_(id) {
    // bandeja y gerencia comparten la seccion modulo-bandeja (vistas
    // internas dashboard/detalle/gerencia, mismo layout que app.html).
    var seccionId = (id === 'bandeja' || id === 'gerencia') ? 'modulo-bandeja' : 'modulo-' + id;
    document.querySelectorAll('.plataforma-modulo').forEach(function (seccion) {
      seccion.classList.toggle('sigso-oculto', seccion.id !== seccionId);
    });
    document.querySelectorAll('.plataforma-nav__item[data-modulo]').forEach(function (boton) {
      boton.classList.toggle('plataforma-nav__item--activo', boton.getAttribute('data-modulo') === id);
    });

    if (id === 'mis_solicitudes') {
      document.getElementById('nota-correos-cuenta').textContent =
        'Mostrando lo asociado a: ' + (sesion.cuenta.emails || []).join(', ');
      window.SigsoMisSolicitudes.cargarConToken(sesion.token);
    }
    if (id === 'nueva_solicitud') {
      autocompletarFormulario_();
    }
    if (id === 'bandeja') {
      abrirBandeja_('dashboard');
    }
    if (id === 'gerencia') {
      abrirBandeja_('gerencia');
    }
    window.scrollTo(0, 0);
  }

  // --- P3: orquestacion de la bandeja (el rol que cumplia app.js) --------

  var bandejaLista = false;

  // En produccion, las llamadas por token necesitan la SEGUNDA
  // implementacion del Web App (BACKOFFICE_TOKEN_URL). En local, el
  // dev-server (localhost) acepta el token directo.
  function backofficeDisponible_() {
    var cfg = window.SIGSO_CONFIG || {};
    return !!cfg.BACKOFFICE_TOKEN_URL || /localhost/.test(cfg.BACKOFFICE_URL || '');
  }

  function abrirBandeja_(vista) {
    var aviso = document.getElementById('aviso-bandeja-sin-deploy');
    if (!backofficeDisponible_()) {
      aviso.innerHTML = Componentes.alerta(
        'La bandeja por token aún no está desplegada (falta la implementación ' +
        '"por token" del Backoffice y su URL en config.js — ver el paquete de deploy v3.3 P3). ' +
        'Mientras tanto puedes usar el Backoffice con tu cuenta Google.', 'aviso');
      mostrarVistaBandeja_(null);
      return;
    }
    aviso.innerHTML = '';

    if (!bandejaLista) {
      bandejaLista = true;
      SigsoDashboard.inicializarFiltros();
      // Puente que dashboard.js/detalle.js ya usan para navegar entre
      // vistas (mismo contrato que definia app.js).
      window.SigsoApp = {
        mostrarDetalle: function (solicitudId) {
          mostrarVistaBandeja_('vista-detalle');
          SigsoDetalle.cargar(solicitudId);
        },
        mostrarDashboard: function () {
          mostrarVistaBandeja_('vista-dashboard');
          SigsoDashboard.cargar();
        }
      };
      document.getElementById('btn-actualizar-dashboard').addEventListener('click', function () {
        SigsoDashboard.cargar();
      });
      document.getElementById('btn-volver-dashboard').addEventListener('click', window.SigsoApp.mostrarDashboard);
      document.getElementById('btn-ver-gerencia').addEventListener('click', function () {
        abrirBandeja_('gerencia');
      });
      document.getElementById('btn-volver-dashboard-gerencia').addEventListener('click', window.SigsoApp.mostrarDashboard);
      document.getElementById('btn-actualizar-gerencia').addEventListener('click', function () {
        SigsoGerencia.cargar();
      });
    }

    if (vista === 'gerencia') {
      mostrarVistaBandeja_('vista-gerencia');
      SigsoGerencia.inicializarFiltros();
      SigsoGerencia.cargar();
    } else {
      mostrarVistaBandeja_('vista-dashboard');
      SigsoDashboard.cargar();
    }
  }

  function mostrarVistaBandeja_(id) {
    ['vista-dashboard', 'vista-detalle', 'vista-gerencia'].forEach(function (vista) {
      document.getElementById(vista).classList.toggle('sigso-oculto', vista !== id);
    });
  }

  // La gracia de tener cuenta: el formulario deja de pedirte quien eres.
  // Solo llena campos VACIOS (no pisa un borrador a medio escribir) y los
  // deja editables (una solicitud puntual puede ir a nombre de otro correo).
  function autocompletarFormulario_() {
    if (autocompletadoHecho) return;
    autocompletadoHecho = true;

    var llenar = function (id, valor) {
      var campo = document.getElementById(id);
      if (campo && !campo.value && valor) {
        campo.value = valor;
        campo.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    llenar('campo-solicitante-nombre', sesion.cuenta.nombre);
    llenar('campo-solicitante-cargo', sesion.cuenta.cargo);
    llenar('campo-solicitante-email', (sesion.cuenta.emails || [])[0]);
    llenar('campo-empresa', sesion.cuenta.empresa_id);

    var nota = document.getElementById('nota-autocompletado');
    if (nota) nota.style.display = '';
  }

  // --- helpers -----------------------------------------------------------

  function mostrarVista_(id) {
    ['vista-login', 'vista-cambiar-clave', 'vista-shell'].forEach(function (vista) {
      document.getElementById(vista).classList.toggle('sigso-oculto', vista !== id);
    });
  }

  function guardarToken_(token) {
    try { localStorage.setItem(LLAVE_TOKEN, token); } catch (err) { /* sin storage: sesion solo en memoria */ }
  }

  function olvidarToken_() {
    try { localStorage.removeItem(LLAVE_TOKEN); } catch (err) { /* idem */ }
  }
})();
