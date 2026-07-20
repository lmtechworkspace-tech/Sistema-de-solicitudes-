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
  // v4.0: `icono` pasa de emoji a clave de iconos.js -- el emoji lo dibujaba
  // el sistema operativo (distinto en Windows/Mac/Android y sin heredar el
  // color del texto).
  var MODULOS_SHELL = {
    nueva_solicitud: { icono: 'nueva', nombre: 'Nueva solicitud', descripcion: 'Ingresa un pedido al equipo', interno: true },
    mis_solicitudes: { icono: 'lista', nombre: 'Mis solicitudes', descripcion: 'El estado de todo lo tuyo, de todos tus correos', interno: true },
    // P3: bandeja y gerencia viven DENTRO del shell (dashboard.js/detalle.js/
    // gerencia.js orquestados aqui, con el token de la sesion via api.js).
    bandeja: { icono: 'bandeja', nombre: 'Bandeja de trabajo', descripcion: 'Solicitudes del equipo: estados, fechas, derivaciones', interno: true },
    gerencia: { icono: 'grafico', nombre: 'Panel de gerencia', descripcion: 'KPIs, semáforo de cumplimiento y seguimiento', interno: true },
    // v4.2: "Gerencia acotado" al equipo del jefe (JEFATURAS, por correo) --
    // ver documentacion/SIGSO-v4.2-propuestas-modulo-jefatura.md.
    jefatura: { icono: 'grafico', nombre: 'Mi departamento', descripcion: 'Qué pasó hoy con tu equipo: KPIs, seguimiento y validaciones pendientes', interno: true },
    // P4: administracion tambien vive dentro del shell (admin.js con el
    // token de la sesion; el backend exige el modulo en cada accion).
    administracion: { icono: 'config', nombre: 'Administración', descripcion: 'Catálogos, usuarios y cuentas de la plataforma', interno: true }
  };

  // v4.0 Frente 3: cada modulo tiene su propio acento -- antes todo el shell
  // (nav activo, icono de tarjeta) usaba el mismo naranja de marca sin
  // importar donde estuvieras, asi que no ayudaba a orientarse. Los pares
  // acento/suave reusan tokens ya existentes (§main.css), no colores nuevos.
  var MODULO_COLOR = {
    nueva_solicitud: { acento: 'var(--naranja)', suave: 'var(--naranja-claro)' },
    mis_solicitudes: { acento: 'var(--info)', suave: 'var(--info-suave)' },
    bandeja: { acento: 'var(--ok)', suave: 'var(--ok-suave)' },
    gerencia: { acento: 'var(--alerta)', suave: 'var(--alerta-suave)' },
    jefatura: { acento: 'var(--alerta)', suave: 'var(--alerta-suave)' },
    administracion: { acento: 'var(--texto-2)', suave: 'var(--superficie-2)' }
  };

  function acentoInline_(id) {
    var c = MODULO_COLOR[id];
    return c ? ' style="--acento:' + c.acento + ';--acento-suave:' + c.suave + '"' : '';
  }

  var sesion = { token: null, cuenta: null };
  var autocompletadoHecho = false;

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('form-login').addEventListener('submit', manejarLogin_);
    document.getElementById('form-cambiar-clave').addEventListener('submit', manejarCambioClave_);
    document.getElementById('btn-logout').addEventListener('click', manejarLogout_);
    wireMenuUsuario_();
    wireVerContrasena_();

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

  var ETIQUETA_ROL = {
    ADM: 'Administrador',
    ANA: 'Gestor / Analista',
    DEV: 'Gestor técnico',
    GERENCIA: 'Gerencia',
    JEFATURA: 'Jefatura',
    SOLICITANTE: 'Solicitante'
  };

  function entrarAlShell_() {
    mostrarVista_('vista-shell');
    renderIdentidad_();
    renderNav_();
    renderHome_();
    mostrarModulo_('home');
  }

  // v4.0: avatar de iniciales + rol visible. Antes solo se veia el nombre
  // suelto junto a un boton de salir, y el rol no aparecia en ningun lado.
  function renderIdentidad_() {
    var cuenta = sesion.cuenta;
    document.getElementById('nav-nombre-usuario').textContent = cuenta.nombre;
    document.getElementById('nav-rol-usuario').textContent =
      ETIQUETA_ROL[cuenta.rol] || cuenta.rol;
    document.getElementById('nav-avatar').textContent = iniciales_(cuenta.nombre);
    document.getElementById('nav-chevron').innerHTML = Iconos.svg('abajo', { tam: 14 });
    document.getElementById('ico-salir').innerHTML = Iconos.svg('salir', { tam: 15 });
    document.getElementById('menu-correos').innerHTML =
      '<div class="plataforma-menu__nombre">' + Componentes.escaparHtml(cuenta.nombre) + '</div>' +
      (cuenta.emails || []).map(function (e) {
        return '<div class="plataforma-menu__correo">' + Componentes.escaparHtml(e) + '</div>';
      }).join('');
  }

  function iniciales_(nombre) {
    var partes = String(nombre || '').trim().split(/\s+/);
    var texto = (partes[0] || '').charAt(0) + (partes.length > 1 ? partes[partes.length - 1].charAt(0) : '');
    return texto.toUpperCase();
  }

  function wireMenuUsuario_() {
    var boton = document.getElementById('btn-menu-usuario');
    var menu = document.getElementById('menu-usuario');
    if (!boton || !menu) return;

    boton.addEventListener('click', function (evento) {
      evento.stopPropagation();
      var abierto = !menu.classList.contains('sigso-oculto');
      menu.classList.toggle('sigso-oculto', abierto);
      boton.setAttribute('aria-expanded', String(!abierto));
    });
    // Cerrar al hacer clic fuera o con Escape: lo que espera cualquiera de
    // un menu desplegable.
    document.addEventListener('click', function () {
      menu.classList.add('sigso-oculto');
      boton.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', function (evento) {
      if (evento.key === 'Escape') {
        menu.classList.add('sigso-oculto');
        boton.setAttribute('aria-expanded', 'false');
      }
    });
    menu.addEventListener('click', function (evento) { evento.stopPropagation(); });
  }

  function modulosDeLaCuenta_() {
    return (sesion.cuenta.modulos || []).filter(function (m) { return MODULOS_SHELL[m]; });
  }

  function urlExterna_(def) {
    return (window.SIGSO_CONFIG && window.SIGSO_CONFIG[def.urlConfig]) || '';
  }

  function renderNav_() {
    var nav = document.getElementById('nav-modulos');
    nav.innerHTML = '<button type="button" class="plataforma-nav__item" data-modulo="home">' +
      Iconos.svg('inicio') + ' Inicio</button>' +
      modulosDeLaCuenta_().map(function (id) {
        var def = MODULOS_SHELL[id];
        // v4.0: contador de pendientes -- lo rellena actualizarContadores_()
        // cuando llegan los datos; asi no hay que entrar al modulo para
        // descubrir que hay algo esperando.
        var ranura = '<span class="plataforma-nav__badge sigso-oculto" data-badge="' + id + '"></span>';
        var acento = acentoInline_(id);
        if (def.interno) {
          return '<button type="button" class="plataforma-nav__item" data-modulo="' + id + '"' + acento + '>' +
            Iconos.svg(def.icono) + ' ' + def.nombre + ranura + '</button>';
        }
        var url = urlExterna_(def);
        return url
          ? '<a class="plataforma-nav__item" href="' + Componentes.escaparHtml(url) + '" target="_blank" rel="noopener"' + acento + '>' +
            Iconos.svg(def.icono) + ' ' + def.nombre + '</a>'
          : '';
      }).join('');

    nav.querySelectorAll('[data-modulo]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        mostrarModulo_(boton.getAttribute('data-modulo'));
      });
    });
  }

  // "Hola" a cualquier hora no distinguia si alguien entraba a las 8am o a
  // las 11pm; el saludo por franja horaria y la fecha dan un ancla de
  // contexto minima en la pantalla que la persona ve primero cada dia.
  function saludoSegunHora_() {
    var hora = new Date().getHours();
    if (hora < 12) return 'Buenos días';
    if (hora < 20) return 'Buenas tardes';
    return 'Buenas noches';
  }

  function renderHome_() {
    var nombrePila = String(sesion.cuenta.nombre || '').split(' ')[0];
    document.getElementById('saludo-home').textContent = saludoSegunHora_() + ', ' + nombrePila;
    var fecha = document.getElementById('fecha-home');
    if (fecha) {
      var texto = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
      fecha.textContent = texto.charAt(0).toUpperCase() + texto.slice(1);
    }

    document.getElementById('cards-home').innerHTML = modulosDeLaCuenta_().map(function (id) {
      var def = MODULOS_SHELL[id];
      var icono = '<span class="plataforma-card__icono">' + Iconos.svg(def.icono, { tam: 22 }) + '</span>';
      var acento = acentoInline_(id);
      if (def.interno) {
        return '<button type="button" class="plataforma-card" data-modulo="' + id + '"' + acento + '>' +
          icono +
          '<strong>' + def.nombre + '</strong>' +
          '<span class="sigso-ayuda">' + def.descripcion + '</span>' +
          '</button>';
      }
      var url = urlExterna_(def);
      return url
        ? '<a class="plataforma-card" href="' + Componentes.escaparHtml(url) + '" target="_blank" rel="noopener"' + acento + '>' +
          icono +
          '<strong>' + def.nombre + '</strong>' +
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

          // v4.0: el numero pendiente viaja al badge del nav -- antes habia
          // que entrar al modulo para enterarse.
          pintarBadge_('mis_solicitudes', resumen.pendientes_validar);

          var pendientes = document.getElementById('pendientes-home');
          if (resumen.pendientes_validar > 0) {
            pendientes.innerHTML =
              '<div class="plataforma-aviso plataforma-aviso--accion">' +
              Iconos.svg('alerta', { tam: 18 }) +
              '<div><strong>' + resumen.pendientes_validar + ' ítem(s) esperan tu validación.</strong>' +
              '<div class="sigso-ayuda">Revísalos y confirma si quedaron resueltos.</div></div>' +
              '<button type="button" class="sigso-boton--secundario" data-ir="mis_solicitudes">Revisar</button>' +
              '</div>';
            var btn = pendientes.querySelector('[data-ir]');
            if (btn) {
              btn.addEventListener('click', function () { mostrarModulo_('mis_solicitudes'); });
            }
          } else if (resumen.abiertas > 0) {
            pendientes.innerHTML =
              '<div class="plataforma-aviso">' + Iconos.svg('info', { tam: 18 }) +
              '<div>Tienes <strong>' + resumen.abiertas + '</strong> solicitud(es) en curso. Nada pendiente de tu parte.</div>' +
              '</div>';
          } else {
            pendientes.innerHTML = '';
          }
        })
        .catch(function () {});
    }

    // Bandeja: lo que esta fuera de plazo es lo que necesita accion hoy.
    if (modulosDeLaCuenta_().indexOf('bandeja') !== -1 && backofficeDisponible_()) {
      llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'getDashboardData', {})
        .then(function (respuesta) {
          if (respuesta.ok) {
            pintarBadge_('bandeja', respuesta.data.resumen.sla_vencido);
          }
        })
        .catch(function () {});
    }
  }

  // v4.0: mostrar/ocultar la contrasena. Con claves temporales del tipo
  // "W8f5JG7Z8h" escribir a ciegas es la principal fuente de "no puedo
  // entrar" -- y hoy no hay forma de comprobar lo tecleado.
  function wireVerContrasena_() {
    document.querySelectorAll('input[type="password"]').forEach(function (input) {
      var envoltura = document.createElement('div');
      envoltura.className = 'sigso-campo-clave';
      input.parentNode.insertBefore(envoltura, input);
      envoltura.appendChild(input);

      var boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'sigso-ver-clave';
      boton.setAttribute('aria-label', 'Mostrar contraseña');
      boton.innerHTML = Iconos.svg('ojo', { tam: 16 });
      envoltura.appendChild(boton);

      boton.addEventListener('click', function () {
        var oculta = input.type === 'password';
        input.type = oculta ? 'text' : 'password';
        boton.innerHTML = Iconos.svg(oculta ? 'ojoTachado' : 'ojo', { tam: 16 });
        boton.setAttribute('aria-label', oculta ? 'Ocultar contraseña' : 'Mostrar contraseña');
        input.focus();
      });
    });
  }

  function pintarBadge_(modulo, cantidad) {
    var badge = document.querySelector('[data-badge="' + modulo + '"]');
    if (!badge) return;
    badge.textContent = cantidad > 99 ? '99+' : String(cantidad);
    badge.classList.toggle('sigso-oculto', !cantidad);
  }

  // Modulos "de trabajo" (tablas, dashboard, detalle de 3 columnas): necesitan
  // el contenedor ancho, como app.html. Los demas (formulario, mis
  // solicitudes) se leen mejor angostos y centrados -- por eso el ancho del
  // <main> se adapta al modulo en vez de ser fijo.
  var MODULOS_ANCHOS = ['bandeja', 'gerencia', 'jefatura', 'administracion'];

  function mostrarModulo_(id) {
    // bandeja, gerencia y jefatura comparten la seccion modulo-bandeja
    // (vistas internas dashboard/detalle/gerencia/jefatura, mismo layout
    // que app.html).
    var seccionId = (id === 'bandeja' || id === 'gerencia' || id === 'jefatura') ? 'modulo-bandeja' : 'modulo-' + id;
    document.querySelectorAll('.plataforma-modulo').forEach(function (seccion) {
      seccion.classList.toggle('sigso-oculto', seccion.id !== seccionId);
    });
    var main = document.querySelector('#vista-shell .sigso-contenido');
    if (main) {
      main.classList.toggle('plataforma-contenido--ancho', MODULOS_ANCHOS.indexOf(id) !== -1);
      var color = MODULO_COLOR[id];
      main.style.setProperty('--acento-modulo', color ? color.acento : 'var(--naranja)');
    }
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
    if (id === 'jefatura') {
      abrirBandeja_('jefatura');
    }
    if (id === 'administracion') {
      abrirAdministracion_();
    }
    window.scrollTo(0, 0);
  }

  // P4: Administracion usa las mismas acciones del Backoffice por token, asi
  // que comparte el requisito de la implementacion por token con la bandeja.
  function abrirAdministracion_() {
    if (!backofficeDisponible_()) {
      document.getElementById('admin-contenido').innerHTML = Componentes.alerta(
        'La administración por token aún no está desplegada (falta la implementación ' +
        '"por token" del Backoffice y su URL en config.js — ver el paquete de deploy v3.3 P3). ' +
        'Mientras tanto puedes usar el panel con tu cuenta Google.', 'aviso');
      return;
    }
    // Cada apertura re-entra por la primera pestaña (mismo comportamiento
    // que abrir admin.html de cero); el binding del menu ya lo hizo admin.js.
    window.SigsoAdmin.abrir();
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
      // v4.2: Jefatura ("Mi departamento") -- mismo patron que Gerencia.
      document.getElementById('btn-volver-dashboard-jefatura').addEventListener('click', window.SigsoApp.mostrarDashboard);
      document.getElementById('btn-actualizar-jefatura').addEventListener('click', function () {
        SigsoJefatura.cargar();
      });
    }

    if (vista === 'gerencia') {
      mostrarVistaBandeja_('vista-gerencia');
      SigsoGerencia.inicializarFiltros();
      SigsoGerencia.cargar();
    } else if (vista === 'jefatura') {
      mostrarVistaBandeja_('vista-jefatura');
      SigsoJefatura.cargar();
    } else {
      mostrarVistaBandeja_('vista-dashboard');
      SigsoDashboard.cargar();
    }
  }

  function mostrarVistaBandeja_(id) {
    ['vista-dashboard', 'vista-detalle', 'vista-gerencia', 'vista-jefatura'].forEach(function (vista) {
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
