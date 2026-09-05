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
  // v5.1: se cachea la cuenta junto al token para restaurar la sesion SIN
  // esperar la red (Apps Script tarda 1-3s). Elimina el parpadeo del login
  // al recargar: se entra al shell de inmediato con la cuenta cacheada y se
  // revalida en segundo plano (stale-while-revalidate).
  var LLAVE_CUENTA = 'sigso_portal_cuenta';

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
    // v14.0 (piel nueva): icono propio por modulo -- antes gerencia/jefatura/
    // coordinacion compartian 'grafico' y no se distinguian en el sidebar.
    gerencia: { icono: 'tendencia', nombre: 'Panel de gerencia', descripcion: 'KPIs, semáforo de cumplimiento y seguimiento', interno: true },
    // v4.2: "Gerencia acotado" al equipo del jefe (JEFATURAS, por correo) --
    // ver documentacion/SIGSO-v4.2-propuestas-modulo-jefatura.md.
    jefatura: { icono: 'equipo', nombre: 'Mi departamento', descripcion: 'Qué pasó hoy con tu equipo: KPIs, seguimiento y validaciones pendientes', interno: true },
    // P4: administracion tambien vive dentro del shell (admin.js con el
    // token de la sesion; el backend exige el modulo en cada accion).
    administracion: { icono: 'ajustes', nombre: 'Administración', descripcion: 'Catálogos, usuarios y cuentas de la plataforma', interno: true },
    // v6.0 Fase P2: el trabajador registra su participacion en la pausa activa
    // del dia (pausas.js). Cero friccion, pensado para el enlace magico.
    pausas: { icono: 'actividad', nombre: 'Pausas activas', descripcion: 'Registra tu participación en la pausa de hoy', interno: true },
    // v6.0 Fase P3: la coordinadora (prevencionista) opera la pausa del dia y
    // ve sus reportes de cumplimiento (coordinacion.js).
    pausas_coordinacion: { icono: 'portapapeles', nombre: 'Coordinación de pausas', descripcion: 'Opera la pausa del día y ve el cumplimiento', interno: true },
    // v6.5: Novedades es un modulo CORE, no asignable por cuenta (ver
    // modulosDeLaCuenta_) -- igual que "Mi perfil", disponible para
    // cualquiera con sesion, sin que un Admin tenga que activarlo cuenta por
    // cuenta.
    novedades: { icono: 'campana', nombre: 'Novedades', descripcion: 'Leyes, avisos y novedades de todas las áreas', interno: true },
    // v7.0 (Fase 2, modulo de Gestion Operacional): compromisos con
    // check-in de 1 clic (documentacion/SIGSO-v7.0-propuesta-modulo-
    // gestion-operacional.md §4.4/§5.1). No es core como 'novedades' --
    // depende de que la cuenta lo tenga en CUENTAS_PORTAL.modulos.
    mi_trabajo: { icono: 'tareas', nombre: 'Mi trabajo', descripcion: 'Tus compromisos, con un check-in de un clic', interno: true },
    // v9.0 (documentacion/SIGSO-v9.0-propuesta-modulo-gestion-proyectos.md):
    // portafolio + sala de trabajo de proyectos internos. No es core --
    // depende de que la cuenta lo tenga en CUENTAS_PORTAL.modulos, igual
    // que 'mi_trabajo'.
    proyectos: { icono: 'capas', nombre: 'Proyectos', descripcion: 'Portafolio, equipo y sala de trabajo de tus proyectos', interno: true },
    // v10.0 (documentacion/SIGSO-v10.0-propuesta-modulo-sgc-iso9001.md):
    // repositorio documental del Sistema de Gestion de Calidad. Cada
    // persona ve SOLO los documentos que le corresponden -- el filtrado lo
    // hace el backend (Calidad.gs), no el shell. No es core: depende de que
    // la cuenta tenga 'calidad' en CUENTAS_PORTAL.modulos.
    calidad: { icono: 'escudoCheck', nombre: 'Calidad', descripcion: 'Documentación, procesos, personas, control y mejora del SGC', interno: true }
  };

  // v4.0 Frente 3: cada modulo tiene su propio acento -- antes todo el shell
  // (nav activo, icono de tarjeta) usaba el mismo naranja de marca sin
  // importar donde estuvieras, asi que no ayudaba a orientarse. Los pares
  // acento/suave reusan tokens ya existentes (§main.css), no colores nuevos.
  // v14.0 (piel nueva): cada modulo con su acento propio (tokens --mod-*
  // en tokens.css, con par claro/oscuro). Antes se reusaban colores de
  // ESTADO como identidad -- verde-exito para Calidad/Bandeja, ambar-alerta
  // para Gerencia/Jefatura -- lo que confundia y repetia color entre modulos.
  var MODULO_COLOR = {
    nueva_solicitud: { acento: 'var(--mod-nueva)', suave: 'var(--mod-nueva-suave)' },
    mis_solicitudes: { acento: 'var(--mod-mis)', suave: 'var(--mod-mis-suave)' },
    bandeja: { acento: 'var(--mod-bandeja)', suave: 'var(--mod-bandeja-suave)' },
    gerencia: { acento: 'var(--mod-gerencia)', suave: 'var(--mod-gerencia-suave)' },
    jefatura: { acento: 'var(--mod-jefatura)', suave: 'var(--mod-jefatura-suave)' },
    administracion: { acento: 'var(--mod-admin)', suave: 'var(--mod-admin-suave)' },
    pausas: { acento: 'var(--mod-pausas)', suave: 'var(--mod-pausas-suave)' },
    pausas_coordinacion: { acento: 'var(--mod-coord)', suave: 'var(--mod-coord-suave)' },
    novedades: { acento: 'var(--mod-novedades)', suave: 'var(--mod-novedades-suave)' },
    mi_trabajo: { acento: 'var(--mod-mi-trabajo)', suave: 'var(--mod-mi-trabajo-suave)' },
    proyectos: { acento: 'var(--mod-proyectos)', suave: 'var(--mod-proyectos-suave)' },
    calidad: { acento: 'var(--mod-calidad)', suave: 'var(--mod-calidad-suave)' }
  };

  function acentoInline_(id) {
    var c = MODULO_COLOR[id];
    return c ? ' style="--acento:' + c.acento + ';--acento-suave:' + c.suave + '"' : '';
  }

  var sesion = { token: null, cuenta: null };
  // v6.0 (Pausas P4.1): si el enlace magico traia "?modulo=", se guarda aca
  // para abrir directo ese modulo al entrar al shell (en vez de "home"). Se
  // consume una sola vez (se limpia despues de usarse).
  var moduloObjetivoEnlace_ = null;
  var autocompletadoHecho = false;
  // v5.0 F4 (§6.1): recientes ya cargados por el resumen del Home -- el
  // command palette los reusa para buscar solicitudes, sin pedir nada
  // nuevo al backend.
  var ultimosRecientes_ = [];

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('form-login').addEventListener('submit', manejarLogin_);
    document.getElementById('form-cambiar-clave').addEventListener('submit', manejarCambioClave_);
    document.getElementById('btn-logout').addEventListener('click', manejarLogout_);
    wireMenuUsuario_();
    wireMiPerfil_();
    wireVerContrasena_();
    wirePaleta_();
    wireAtajos_();
    wireSidebar_();
    wireTour_();

    wireAutorefresco_();

    // v5.2 (Fase C, propuesta de adopcion): "enlace magico" -- un token en
    // la URL (generado por el Admin, CuentasPortal.generarEnlaceMagico_)
    // entra SIN pedir usuario/clave. Se guarda igual que un login normal y
    // se limpia de la URL enseguida: no debe quedar visible en el historial
    // del navegador ni en una captura de pantalla compartida sin querer.
    var tokenDeEnlace = null;
    try {
      var parametrosEnlace_ = new URLSearchParams(window.location.search);
      tokenDeEnlace = parametrosEnlace_.get('token');
      // v6.0 (Pausas P4.1): "?modulo=" opcional -- lo manda p.ej. el
      // recordatorio de pausas para que el enlace abra directo ese modulo en
      // vez de Home. Se lee ANTES de limpiar la URL (replaceState de abajo).
      moduloObjetivoEnlace_ = parametrosEnlace_.get('modulo');
    } catch (err) { /* navegador viejo sin URLSearchParams */ }
    if (tokenDeEnlace) {
      // Descarta cualquier cuenta cacheada de una sesion PREVIA en este
      // navegador: sin esto, un enlace magico para otra persona mostraria
      // por un instante la identidad equivocada (la cache vieja) antes de
      // que la validacion de red la corrija.
      olvidarSesion_();
      try { localStorage.setItem(LLAVE_TOKEN, tokenDeEnlace); } catch (err) { /* sin storage */ }
      // v12.1: se conserva el HASH. location.pathname solo lo descartaba, y
      // eso rompia los enlaces que traen token Y seccion a la vez
      // (?token=...#/calidad/riesgos): la seccion se perdia al limpiar la
      // URL y el usuario caia en Home sin saber por que.
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }

    // Sesion guardada: restaurar sin re-loguear. Si expiro, al login.
    var token = tokenDeEnlace;
    if (!token) {
      try { token = localStorage.getItem(LLAVE_TOKEN); } catch (err) { /* sin storage */ }
    }
    if (!token) {
      mostrarVista_('vista-login');
      return;
    }

    // v5.1: con la cuenta cacheada se entra al shell de INMEDIATO (sin
    // parpadeo del login ni espera de red) y se revalida el token en
    // segundo plano. Sin cache, se muestra un splash mientras valida.
    // Un enlace magico (recien consumido arriba) siempre pasa por la
    // validacion de red -- justo se borro cualquier cache anterior.
    var cuentaCache = tokenDeEnlace ? null : leerCuentaCache_();
    if (cuentaCache) {
      iniciarSesion_(token, cuentaCache);
      revalidarSesionEnSegundoPlano_(token);
      return;
    }

    mostrarVista_('vista-cargando');
    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'portalSesion', { token: token })
      .then(function (respuesta) {
        if (!respuesta.ok) {
          olvidarSesion_();
          mostrarVista_('vista-login');
          return;
        }
        guardarSesionLocal_(token, respuesta.data.cuenta);
        iniciarSesion_(token, respuesta.data.cuenta);
      })
      .catch(function () {
        // Sin red: mejor pedir login de nuevo que un shell a medias.
        mostrarVista_('vista-login');
      });
  });

  // v5.1: valida el token ya usado para entrar (con cuenta cacheada). Si el
  // servidor lo rechaza, se cierra sesion; si responde, se refresca la
  // cuenta por si cambio algo (rol, modulos, nombre). Un fallo de red no
  // expulsa al usuario: sigue trabajando con la cuenta cacheada.
  function revalidarSesionEnSegundoPlano_(token) {
    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'portalSesion', { token: token })
      .then(function (respuesta) {
        if (!respuesta.ok) {
          manejarLogout_();
          return;
        }
        var cuenta = respuesta.data.cuenta;
        guardarSesionLocal_(token, cuenta);
        // Caso raro: un admin marco "debe cambiar clave" desde el servidor
        // mientras habia sesion cacheada -- se envia al cambio de clave.
        if (cuenta.debe_cambiar_password) {
          sesion.cuenta = cuenta;
          mostrarVista_('vista-cambiar-clave');
          return;
        }
        // Si cambio algo relevante desde la cache, re-render sin recargar.
        if (JSON.stringify(cuenta) !== JSON.stringify(sesion.cuenta)) {
          sesion.cuenta = cuenta;
          if (!document.getElementById('vista-shell').classList.contains('sigso-oculto')) {
            renderIdentidad_();
            renderNav_();
          }
        }
      })
      .catch(function () { /* sin red: seguir con la cuenta cacheada */ });
  }

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
      guardarSesionLocal_(respuesta.data.token, respuesta.data.cuenta);
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
      guardarSesionLocal_(sesion.token, sesion.cuenta);
      entrarAlShell_();
    }).catch(function () {
      salida.innerHTML = Componentes.alerta('No se pudo conectar con el servidor. Intenta nuevamente.', 'error');
    }).finally(function () {
      boton.disabled = false;
    });
  }

  function manejarLogout_() {
    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'portalLogout', { token: sesion.token }).catch(function () {});
    olvidarSesion_();
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
    // v6.4: la foto propia se pide DESPUES de pintar la identidad, para que
    // el header aparezca de inmediato con las iniciales y la foto lo
    // reemplace al llegar (nunca un hueco esperando la red).
    cargarFotoPropia_();
    renderNav_();
    renderHome_();
    // H-04: qué versión del backend está respondiendo de verdad.
    comprobarVersionBackend_();
    // v6.0 (Pausas P4.1): si el enlace magico pedia un modulo puntual (p.ej.
    // el recordatorio de pausas) y la cuenta SI lo tiene, se abre directo ese
    // modulo -- si no, se ignora en silencio y entra a Home como siempre. Se
    // consume una sola vez (no debe reaplicarse en un logout/login posterior).
    // v12.1: el modulo inicial puede venir de TRES lados, en este orden:
    //   1. la URL (#/calidad) -- un enlace compartido o un bookmark;
    //   2. el enlace magico (?modulo=), que se consume una sola vez;
    //   3. Home.
    // En los tres casos se valida contra los modulos DE LA CUENTA: una URL no
    // es una autorizacion. Si pide un modulo que no le toca, entra a Home en
    // silencio (el backend igual rechaza cada accion por su cuenta).
    var rutaInicial = window.SigsoRutas ? SigsoRutas.leer() : { modulo: '', item: '' };
    var moduloInicial = 'home';
    if (rutaInicial.modulo && puedeAbrirModulo_(rutaInicial.modulo)) {
      moduloInicial = rutaInicial.modulo;
      itemPendienteDeRuta_ = rutaInicial.item;
    } else if (moduloObjetivoEnlace_ && puedeAbrirModulo_(moduloObjetivoEnlace_)) {
      moduloInicial = moduloObjetivoEnlace_;
    }
    moduloObjetivoEnlace_ = null;
    // v12.1: SigsoShell se define ANTES de abrir el primer modulo. Estaba
    // despues, y por eso un enlace directo a una seccion (#/calidad/riesgos)
    // abria el modulo pero caia en su seccion por defecto: cuando el modulo
    // preguntaba por la ruta, el puente todavia no existia.
    // v5.1: puente para que el formulario (formulario.js, compartido con
    // index.html) sepa que corre DENTRO del shell y navegue por modulos en
    // vez de saltar a estado.html (que sacaba al usuario del sistema).
    window.SigsoShell = {
      irAModulo: function (id) { mostrarModulo_(id); },
      tieneModulo: function (id) { return modulosDeLaCuenta_().indexOf(id) !== -1; },
      // v12.1: el modulo pregunta si la URL pedia una seccion concreta.
      // Devuelve '' si no, y se consume una sola vez.
      tomarItemDeRuta: tomarItemDeRuta_,
      // Para que el modulo publique en que seccion quedo, sin conocer el
      // formato de la URL.
      publicarItem: function (itemId) {
        if (window.SigsoRutas && moduloActivo_) SigsoRutas.escribir(moduloActivo_, itemId);
        // v13.0: el arbol del sidebar marca la hoja activa y deja su rama
        // abierta. Sin esto, navegar dentro del modulo no se reflejaria en la
        // navegacion -- que es justamente donde el usuario mira para saber
        // donde esta.
        itemActivoDelModulo_ = itemId;
        renderNav_();
      },
      // El modulo avisa que cambiaron sus permisos (llego seccionesVisibles_)
      // para que el arbol muestre lo que de verdad puede abrir.
      refrescarArbol: function () { renderNav_(); }
    };

    mostrarModulo_(moduloInicial);

    // Atras/adelante del navegador: hasta la v12.0 sacaban al usuario de
    // SIGSO entero, porque no habia historial interno que recorrer.
    if (window.SigsoRutas) {
      SigsoRutas.alCambiar(function (ruta) {
        var destino = ruta.modulo && puedeAbrirModulo_(ruta.modulo) ? ruta.modulo : 'home';
        itemPendienteDeRuta_ = ruta.item;
        mostrarModulo_(destino);
      });
    }
    setTimeout(iniciarTourSiCorresponde_, 400);
  }

  // v5.1: auto-refresco al volver a la pestana -- resuelve "hay que recargar
  // la pagina para ver algo nuevo" SIN el costo (y el parpadeo del login) de
  // un reload completo. Solo refresca si pasaron >UMBRAL segundos desde la
  // ultima carga del modulo activo, para no golpear el backend al alternar
  // de pestana rapido.
  var UMBRAL_REFRESCO_MS = 20000;

  function wireAutorefresco_() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') refrescarModuloActivoSiCorresponde_();
    });
    window.addEventListener('focus', refrescarModuloActivoSiCorresponde_);
  }

  function refrescarModuloActivoSiCorresponde_() {
    if (!sesion.token || !moduloActivo_) return;
    if (document.getElementById('vista-shell').classList.contains('sigso-oculto')) return;
    // v9.0b: nunca interrumpir un formulario abierto (modal) con un
    // refresco de fondo -- si el usuario esta a mitad de "Nueva tarea" en
    // Proyectos (u otro modal similar) y llega este refresco, un re-render
    // por debajo puede dejar el guardado apuntando a datos viejos.
    if (document.querySelector('.sigso-modal-fondo')) return;
    var ultima = ultimaCargaModulo_[moduloActivo_] || 0;
    if (Date.now() - ultima < UMBRAL_REFRESCO_MS) return;
    ultimaCargaModulo_[moduloActivo_] = Date.now();
    refrescarModuloActivo_();
  }

  function refrescarModuloActivo_() {
    switch (moduloActivo_) {
      case 'home':
        renderHome_();
        break;
      case 'mis_solicitudes':
        if (window.SigsoMisSolicitudes) window.SigsoMisSolicitudes.cargarConToken(sesion.token);
        break;
      case 'bandeja':
        if (window.SigsoDashboard) window.SigsoDashboard.cargar();
        break;
      case 'gerencia':
        if (window.SigsoGerencia) window.SigsoGerencia.cargar();
        break;
      case 'jefatura':
        if (window.SigsoJefatura) window.SigsoJefatura.cargar();
        break;
      case 'mi_trabajo':
        if (window.SigsoActividades) window.SigsoActividades.cargar();
        break;
      case 'proyectos':
        // v9.0b: 'refrescar' (no 'cargar') -- si el usuario tiene un
        // proyecto abierto, lo mantiene ahi en vez de devolverlo al
        // portafolio en cada refresco de fondo (ver proyectos.js).
        if (window.SigsoProyectos) {
          if (window.SigsoProyectos.refrescar) window.SigsoProyectos.refrescar();
          else window.SigsoProyectos.cargar();
        }
        break;
      case 'calidad':
        // Mismo criterio que Proyectos: si hay un documento abierto, el
        // refresco de fondo no debe sacar al usuario de ahi.
        if (window.SigsoCalidad) {
          if (window.SigsoCalidad.refrescar) window.SigsoCalidad.refrescar();
          else window.SigsoCalidad.cargar();
        }
        break;
      default:
        break; // nueva_solicitud / administracion: sin auto-refresco
    }
  }

  // v5.0 F4 (§6.5): tour de bienvenida -- solo la primera sesion (por
  // cuenta), generico entre roles (senala el chrome del shell, no datos).
  // En movil el sidebar es un drawer oculto por defecto -- posicionar el
  // tour ahi suma complejidad sin aportar mucho, asi que se omite y queda
  // pendiente para la primera sesion en escritorio.
  var LLAVE_TOUR = 'sigso_tour_visto';
  var TOUR_PASOS = [
    { selector: '.plataforma-sidebar__cab .plataforma-header__marca', titulo: 'Bienvenido a SIGSO',
      texto: 'Este es tu panel: desde aquí llegas a todo lo que tu cuenta puede ver.' },
    { selector: '#nav-modulos', titulo: 'Tus módulos',
      texto: 'La lista se arma según tu cuenta. Un clic te lleva de uno a otro sin recargar la página.' },
    { selector: '#btn-tema', titulo: 'Modo oscuro',
      texto: 'Si prefieres trabajar en oscuro, actívalo aquí — se recuerda para la próxima vez.' },
    { selector: null, titulo: 'Busca y salta rápido',
      texto: 'Presiona Ctrl+K (Cmd+K en Mac) en cualquier momento para buscar una pantalla o una solicitud por número.' },
    { selector: '.plataforma-usuario', titulo: 'Tu cuenta',
      texto: 'Aquí ves tu rol y cierras sesión cuando termines.' }
  ];
  var tourPasoActual_ = 0;

  function iniciarTourSiCorresponde_() {
    var visto = false;
    try { visto = localStorage.getItem(LLAVE_TOUR) === '1'; } catch (err) { visto = true; }
    if (visto || window.innerWidth <= 900) return;
    tourPasoActual_ = 0;
    mostrarPasoTour_();
  }

  function limpiarResaltadoTour_() {
    var actual = document.querySelector('.sigso-tour-resaltado');
    if (actual) actual.classList.remove('sigso-tour-resaltado');
  }

  function posicionarTour_(el, elemento) {
    var tour = document.getElementById('tour-bienvenida');
    if (!elemento) {
      tour.style.top = '45%';
      tour.style.left = '50%';
      tour.style.transform = 'translate(-50%, -50%)';
      return;
    }
    var rect = elemento.getBoundingClientRect();
    var top = Math.min(Math.max(rect.top, 12), window.innerHeight - 220);
    tour.style.top = top + 'px';
    tour.style.left = (rect.right + 16) + 'px';
    tour.style.transform = 'none';
  }

  function mostrarPasoTour_() {
    limpiarResaltadoTour_();
    var paso = TOUR_PASOS[tourPasoActual_];
    var elemento = paso.selector ? document.querySelector(paso.selector) : null;
    // Si el elemento de este paso no existe para esta cuenta (ej. modulo
    // sin bandeja), se salta al siguiente en vez de apuntar a la nada.
    if (paso.selector && !elemento) {
      if (tourPasoActual_ < TOUR_PASOS.length - 1) { tourPasoActual_++; mostrarPasoTour_(); }
      else cerrarTour_();
      return;
    }
    if (elemento) elemento.classList.add('sigso-tour-resaltado');

    document.getElementById('tour-paso-contador').textContent =
      'Paso ' + (tourPasoActual_ + 1) + ' de ' + TOUR_PASOS.length;
    document.getElementById('tour-titulo').textContent = paso.titulo;
    document.getElementById('tour-texto').textContent = paso.texto;
    document.getElementById('btn-tour-atras').classList.toggle('sigso-oculto', tourPasoActual_ === 0);
    document.getElementById('btn-tour-siguiente').textContent =
      tourPasoActual_ === TOUR_PASOS.length - 1 ? 'Listo' : 'Siguiente';

    var tour = document.getElementById('tour-bienvenida');
    tour.classList.remove('sigso-oculto');
    posicionarTour_(tour, elemento);
  }

  function cerrarTour_() {
    limpiarResaltadoTour_();
    document.getElementById('tour-bienvenida').classList.add('sigso-oculto');
    try { localStorage.setItem(LLAVE_TOUR, '1'); } catch (err) { /* sin storage */ }
  }

  function wireTour_() {
    var btnSiguiente = document.getElementById('btn-tour-siguiente');
    var btnAtras = document.getElementById('btn-tour-atras');
    var btnSaltar = document.getElementById('btn-tour-saltar');
    if (!btnSiguiente) return;
    btnSiguiente.addEventListener('click', function () {
      if (tourPasoActual_ < TOUR_PASOS.length - 1) { tourPasoActual_++; mostrarPasoTour_(); }
      else cerrarTour_();
    });
    btnAtras.addEventListener('click', function () {
      if (tourPasoActual_ > 0) { tourPasoActual_--; mostrarPasoTour_(); }
    });
    btnSaltar.addEventListener('click', cerrarTour_);
  }

  // v4.0: avatar de iniciales + rol visible. Antes solo se veia el nombre
  // suelto junto a un boton de salir, y el rol no aparecia en ningun lado.
  /**
   * H-04: pregunta al backend qué versión está corriendo y la deja visible.
   *
   * El frontend se publica solo con cada push; el backend se pega a mano en
   * Apps Script. Por eso la versión del frontend es siempre la buena: si el
   * backend responde otra, es que falta pegarlo. Antes no había forma de
   * notarlo — la planilla llegó a quedar dos fases atrás y solo se supo
   * cuando unos datos entraron corridos de columna.
   *
   * El aviso es solo para Admin: al resto no le sirve de nada enterarse de
   * algo que no puede resolver. Y si la consulta falla, no pasa nada: es
   * información de apoyo, no puede romper la entrada al sistema.
   */
  function comprobarVersionBackend_() {
    var el = document.getElementById('sigso-version');
    if (!el) return;
    var esperada = (window.SIGSO_CONFIG || {}).VERSION || '';

    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'ping', {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok || !respuesta.data) return;
      var backend = respuesta.data.version || '';
      if (!backend) return;

      el.hidden = false;
      var desfasado = esperada && backend !== esperada;
      var esAdmin = sesion && sesion.cuenta && sesion.cuenta.rol === 'ADM';

      if (desfasado && esAdmin) {
        el.classList.add('plataforma-sidebar__version--alerta');
        el.textContent = 'Backend ' + backend + ' — falta pegar ' + esperada;
        el.title = 'El backend de Apps Script quedó atrás respecto de esta versión del sitio. ' +
          'Pega los archivos del último paquete y vuelve a publicar la implementación.';
      } else {
        el.textContent = 'v' + backend;
        el.title = desfasado
          ? 'Backend ' + backend + ' · sitio ' + esperada
          : 'Versión desplegada';
      }
    }).catch(function () { /* sin versión: no es motivo para molestar a nadie */ });
  }

  function renderIdentidad_() {
    var cuenta = sesion.cuenta;
    // v13.6: quien esta usando la plataforma, publicado para los modulos.
    // Las cabeceras de documento de los 38 reportes (Calidad, Gerencia,
    // Jefatura, Proyectos) leen window.SIGSO_USUARIO para el "Generado por",
    // y ese global no lo definia NADIE: el campo salia vacio siempre y la
    // cabecera lo omitia en silencio. Se publica aca porque renderIdentidad_
    // corre en todos los caminos por los que se establece la sesion.
    window.SIGSO_USUARIO = {
      nombre: cuenta.nombre,
      rol: cuenta.rol,
      email: (cuenta.emails || [])[0] || ''
    };
    document.getElementById('nav-nombre-usuario').textContent = cuenta.nombre;
    document.getElementById('nav-rol-usuario').textContent =
      ETIQUETA_ROL[cuenta.rol] || cuenta.rol;
    // v6.4: el avatar pasa a ser el componente unico (foto si la hay,
    // iniciales si no). El contenedor #nav-avatar se conserva para no tocar
    // el layout del header; dentro va ahora Componentes.avatar.
    document.getElementById('nav-avatar').innerHTML = Componentes.avatar(
      { nombre: cuenta.nombre, foto: fotoPerfilPropia_ }, { tam: 'md' }
    );
    document.getElementById('nav-chevron').innerHTML = Iconos.svg('abajo', { tam: 14 });
    document.getElementById('ico-salir').innerHTML = Iconos.svg('salir', { tam: 15 });
    document.getElementById('ico-perfil').innerHTML = Iconos.svg('persona', { tam: 15 });
    document.getElementById('menu-correos').innerHTML =
      '<div class="plataforma-menu__nombre">' + Componentes.escaparHtml(cuenta.nombre) + '</div>' +
      (cuenta.emails || []).map(function (e) {
        return '<div class="plataforma-menu__correo">' + Componentes.escaparHtml(e) + '</div>';
      }).join('');
  }

  // v6.4: la foto propia del usuario, cacheada para no volver a pedirla en
  // cada repintado del header. La rellena cargarFotoPropia_ al iniciar
  // sesion y la actualiza el evento 'sigso:perfil-actualizado'.
  var fotoPerfilPropia_ = '';

  // v6.4: iniciales_ se elimino. Vivia aqui una copia (y otra en admin.js)
  // que tomaba primera + ULTIMA palabra y no manejaba tildes ni particulas.
  // Ahora la unica implementacion es Componentes.iniciales, usada a traves
  // de Componentes.avatar.

  // v6.4: "Mi perfil" abre el panel de perfil.js. El menu se cierra primero
  // para que no quede flotando por encima del modal.
  function wireMiPerfil_() {
    var boton = document.getElementById('btn-mi-perfil');
    if (!boton) return;

    boton.addEventListener('click', function () {
      var menu = document.getElementById('menu-usuario');
      if (menu) menu.classList.add('sigso-oculto');
      document.getElementById('btn-menu-usuario').setAttribute('aria-expanded', 'false');
      SigsoPerfil.abrir();
    });

    // Cuando el usuario cambia o borra su foto, el header se repinta solo.
    document.addEventListener('sigso:perfil-actualizado', function (ev) {
      fotoPerfilPropia_ = (ev.detail && ev.detail.foto) || '';
      renderIdentidad_();
    });
  }

  function cargarFotoPropia_() {
    if (!window.SigsoPerfil) return;
    var correo = (sesion.cuenta && (sesion.cuenta.emails || [])[0]) || '';
    if (!correo) return;

    // v6.4 (rendimiento): si la foto ya esta en el cache (persistido entre
    // navegaciones), se pinta de inmediato y NO se hace ninguna llamada.
    // Antes esto disparaba siempre una peticion que, del lado del servidor,
    // obligaba a leer la hoja PERFILES entera solo para traer UNA foto.
    var enCache = SigsoPerfil.fotoDe(correo);
    if (enCache) {
      fotoPerfilPropia_ = enCache;
      renderIdentidad_();
      return;
    }

    SigsoPerfil.precargarFotos([correo]).then(function () {
      fotoPerfilPropia_ = SigsoPerfil.fotoDe(correo);
      if (fotoPerfilPropia_) renderIdentidad_();
    });
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

  // v5.0 F2: sidebar colapsable (escritorio) + drawer (movil) + conmutador
  // de tema. El colapso y el tema se recuerdan entre sesiones -- nadie
  // quiere volver a elegir lo mismo cada vez que entra.
  var LLAVE_SIDEBAR_COLAPSADO = 'sigso_sidebar_colapsado';
  var LLAVE_TEMA = 'sigso_tema';
  var UMBRAL_MOVIL = 900;

  function guardar_(llave, valor) {
    try { localStorage.setItem(llave, valor); } catch (err) { /* sin storage */ }
  }

  function leer_(llave) {
    try { return localStorage.getItem(llave); } catch (err) { return null; }
  }

  function wireSidebar_() {
    var sidebar = document.getElementById('plataforma-sidebar');
    var telon = document.getElementById('telon-sidebar');
    var btnColapsar = document.getElementById('btn-colapsar-sidebar');
    var btnAbrir = document.getElementById('btn-abrir-sidebar');
    var btnTema = document.getElementById('btn-tema');
    if (!sidebar || !btnColapsar || !btnAbrir || !btnTema) return;

    document.getElementById('ico-colapsar').innerHTML = Iconos.svg('colapsar', { tam: 16 });
    document.getElementById('ico-hamburguesa').innerHTML = Iconos.svg('menu', { tam: 18 });

    function esMovil_() {
      return window.innerWidth <= UMBRAL_MOVIL;
    }

    function cerrarDrawer_() {
      sidebar.classList.remove('plataforma-sidebar--abierto');
      telon.classList.remove('plataforma-sidebar__telon--visible');
      telon.classList.add('sigso-oculto');
      btnAbrir.setAttribute('aria-expanded', 'false');
    }

    function abrirDrawer_() {
      sidebar.classList.add('plataforma-sidebar--abierto');
      telon.classList.remove('sigso-oculto');
      telon.classList.add('plataforma-sidebar__telon--visible');
      btnAbrir.setAttribute('aria-expanded', 'true');
    }

    btnAbrir.addEventListener('click', function () {
      var abierto = sidebar.classList.contains('plataforma-sidebar--abierto');
      if (abierto) cerrarDrawer_(); else abrirDrawer_();
    });
    telon.addEventListener('click', cerrarDrawer_);
    // Al elegir un modulo desde el drawer, se cierra solo -- de otro modo
    // taparia el contenido recien elegido.
    document.getElementById('nav-modulos').addEventListener('click', function () {
      if (esMovil_()) cerrarDrawer_();
    });

    function aplicarColapso_(colapsado) {
      sidebar.classList.toggle('plataforma-sidebar--colapsado', colapsado);
      btnColapsar.setAttribute('aria-expanded', String(!colapsado));
      btnColapsar.setAttribute('aria-label', colapsado ? 'Expandir menú' : 'Colapsar menú');
    }

    var colapsadoGuardado = leer_(LLAVE_SIDEBAR_COLAPSADO) === '1';
    aplicarColapso_(colapsadoGuardado);

    btnColapsar.addEventListener('click', function () {
      var colapsado = !sidebar.classList.contains('plataforma-sidebar--colapsado');
      aplicarColapso_(colapsado);
      guardar_(LLAVE_SIDEBAR_COLAPSADO, colapsado ? '1' : '0');
    });

    // El colapso es de escritorio y el drawer es de movil: si la ventana
    // cruza el umbral con el otro estado activo, se limpia para no mezclar
    // ambos (ej. un sidebar angosto de 68px atascado como drawer movil).
    window.addEventListener('resize', function () {
      if (esMovil_()) {
        sidebar.classList.remove('plataforma-sidebar--colapsado');
      } else {
        cerrarDrawer_();
        aplicarColapso_(leer_(LLAVE_SIDEBAR_COLAPSADO) === '1');
      }
    });

    // Sin preferencia guardada, el SO manda (media query de tokens.css);
    // solo se fija data-tema cuando la persona elige explicitamente, para
    // no pisar "sigue al sistema" con un "claro" a la fuerza.
    function pintarIconoTema_(esOscuro) {
      document.getElementById('ico-tema').innerHTML = Iconos.svg(esOscuro ? 'sol' : 'luna', { tam: 16 });
      document.querySelector('#btn-tema .plataforma-sidebar__txt').textContent =
        esOscuro ? 'Modo claro' : 'Modo oscuro';
      btnTema.setAttribute('aria-label', esOscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    }

    function aplicarTema_(tema) {
      document.documentElement.setAttribute('data-tema', tema);
      pintarIconoTema_(tema === 'oscuro');
    }

    var temaGuardado = leer_(LLAVE_TEMA);
    if (temaGuardado === 'oscuro' || temaGuardado === 'claro') {
      aplicarTema_(temaGuardado);
    } else {
      var prefiereOscuro = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      pintarIconoTema_(prefiereOscuro);
    }

    btnTema.addEventListener('click', function () {
      var actualOscuro = document.documentElement.getAttribute('data-tema') === 'oscuro' ||
        (!document.documentElement.getAttribute('data-tema') && window.matchMedia &&
          window.matchMedia('(prefers-color-scheme: dark)').matches);
      var nuevo = actualOscuro ? 'claro' : 'oscuro';
      aplicarTema_(nuevo);
      guardar_(LLAVE_TEMA, nuevo);
    });
  }

  // v5.0 F4 (§6.1): command palette -- indice en memoria (modulos de la
  // cuenta + recientes ya cargados), sin backend nuevo. Enter ejecuta el
  // resultado resaltado; flechas mueven la seleccion; Esc cierra.
  var paletaSeleccion_ = 0;

  function wirePaleta_() {
    var telon = document.getElementById('paleta-telon');
    var input = document.getElementById('paleta-input');
    if (!telon || !input) return;
    document.getElementById('ico-paleta-buscar').innerHTML = Iconos.svg('lupa', { tam: 16 });
    telon.addEventListener('click', cerrarPaleta_);
    input.addEventListener('input', function () {
      paletaSeleccion_ = 0;
      renderResultadosPaleta_(input.value);
    });
    input.addEventListener('keydown', function (evento) {
      var items = [].slice.call(document.querySelectorAll('.sigso-paleta__item'));
      if (evento.key === 'ArrowDown') {
        evento.preventDefault();
        paletaSeleccion_ = Math.min(paletaSeleccion_ + 1, items.length - 1);
        marcarSeleccionPaleta_(items);
      } else if (evento.key === 'ArrowUp') {
        evento.preventDefault();
        paletaSeleccion_ = Math.max(paletaSeleccion_ - 1, 0);
        marcarSeleccionPaleta_(items);
      } else if (evento.key === 'Enter') {
        evento.preventDefault();
        if (items[paletaSeleccion_]) items[paletaSeleccion_].click();
      }
    });
  }

  function marcarSeleccionPaleta_(items) {
    items.forEach(function (el, idx) {
      el.classList.toggle('sigso-paleta__item--activo', idx === paletaSeleccion_);
    });
    if (items[paletaSeleccion_]) items[paletaSeleccion_].scrollIntoView({ block: 'nearest' });
  }

  function abrirPaleta_() {
    document.getElementById('paleta-telon').classList.remove('sigso-oculto');
    document.getElementById('paleta-comandos').classList.remove('sigso-oculto');
    var input = document.getElementById('paleta-input');
    input.value = '';
    paletaSeleccion_ = 0;
    renderResultadosPaleta_('');
    input.focus();
  }

  function cerrarPaleta_() {
    document.getElementById('paleta-telon').classList.add('sigso-oculto');
    document.getElementById('paleta-comandos').classList.add('sigso-oculto');
  }

  function normalizar_(texto) {
    return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function renderResultadosPaleta_(texto) {
    var q = normalizar_(texto);
    var cont = document.getElementById('paleta-resultados');
    var html = '';

    var navegacion = [{ id: 'home', nombre: 'Inicio', icono: 'inicio' }]
      .concat(modulosDeLaCuenta_().filter(function (id) { return MODULOS_SHELL[id].interno; })
        .map(function (id) { return { id: id, nombre: MODULOS_SHELL[id].nombre, icono: MODULOS_SHELL[id].icono }; }))
      .filter(function (item) { return !q || normalizar_(item.nombre).indexOf(q) !== -1; });

    if (navegacion.length) {
      html += '<div class="sigso-paleta__grupo">Ir a</div>' + navegacion.map(function (item) {
        return '<button type="button" class="sigso-paleta__item" data-accion="ir" data-modulo="' + item.id + '">' +
          Iconos.svg(item.icono, { tam: 16 }) + '<strong>' + Componentes.escaparHtml(item.nombre) + '</strong></button>';
      }).join('');
    }

    var solicitudes = q && modulosDeLaCuenta_().indexOf('bandeja') !== -1
      ? ultimosRecientes_.filter(function (s) {
          return normalizar_(s.solicitud_id).indexOf(q) !== -1 ||
            normalizar_(s.empresa_id).indexOf(q) !== -1 ||
            normalizar_(s.modulo).indexOf(q) !== -1;
        }).slice(0, 6)
      : [];

    if (solicitudes.length) {
      html += '<div class="sigso-paleta__grupo">Solicitudes</div>' + solicitudes.map(function (s) {
        return '<button type="button" class="sigso-paleta__item" data-accion="solicitud" data-id="' + Componentes.escaparHtml(s.solicitud_id) + '">' +
          Iconos.svg('caja', { tam: 16 }) +
          '<strong>' + Componentes.escaparHtml(s.solicitud_id) + '</strong>' +
          '<span>' + Componentes.escaparHtml(s.empresa_id) + ' · ' + Componentes.escaparHtml(s.modulo || '—') + '</span>' +
          '</button>';
      }).join('');
    }

    if (!navegacion.length && !solicitudes.length) {
      html = '<div class="sigso-paleta__vacio">Nada coincide con "' + Componentes.escaparHtml(texto) + '".</div>';
    }

    cont.innerHTML = html;
    cont.querySelectorAll('[data-accion="ir"]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        cerrarPaleta_();
        mostrarModulo_(boton.getAttribute('data-modulo'));
      });
    });
    cont.querySelectorAll('[data-accion="solicitud"]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var id = boton.getAttribute('data-id');
        cerrarPaleta_();
        mostrarModulo_('bandeja');
        // La bandeja ya tiene su propio buscador (dashboard.js): se reusa
        // en vez de duplicar la logica de filtrado aqui.
        setTimeout(function () {
          var buscador = document.getElementById('buscar-recientes');
          if (buscador) {
            buscador.value = id;
            buscador.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, 50);
      });
    });
    marcarSeleccionPaleta_([].slice.call(cont.querySelectorAll('.sigso-paleta__item')));
  }

  // v5.0 F4 (§6.2): atajos de teclado -- se ignoran mientras el foco esta
  // en un campo de texto (para no interceptar mientras se escribe).
  var esperandoG_ = false;
  var temporizadorG_ = null;

  function enCampoDeTexto_(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function wireAtajos_() {
    var btnCerrarAtajos = document.getElementById('btn-cerrar-atajos');
    var telonAtajos = document.getElementById('atajos-telon');
    if (btnCerrarAtajos) {
      document.getElementById('ico-cerrar-atajos').innerHTML = Iconos.svg('equis', { tam: 16 });
      btnCerrarAtajos.addEventListener('click', cerrarAtajos_);
    }
    if (telonAtajos) telonAtajos.addEventListener('click', cerrarAtajos_);

    document.addEventListener('keydown', function (evento) {
      var paletaAbierta = !document.getElementById('paleta-comandos').classList.contains('sigso-oculto');
      var atajosAbiertos = !document.getElementById('panel-atajos').classList.contains('sigso-oculto');
      var conSesion = !document.getElementById('vista-shell').classList.contains('sigso-oculto');
      if (!conSesion) return; // login/cambio de clave: sin paleta ni atajos

      // Ctrl/Cmd+K abre la paleta desde cualquier parte, incluso con foco
      // en un campo de texto (es la convencion de la industria).
      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'k') {
        evento.preventDefault();
        abrirPaleta_();
        return;
      }
      var tourAbierto = !document.getElementById('tour-bienvenida').classList.contains('sigso-oculto');
      if (evento.key === 'Escape') {
        if (paletaAbierta) cerrarPaleta_();
        else if (atajosAbiertos) cerrarAtajos_();
        else if (tourAbierto) cerrarTour_();
        return;
      }
      if (paletaAbierta || atajosAbiertos || tourAbierto) return;
      if (enCampoDeTexto_(evento.target)) return;
      if (evento.ctrlKey || evento.metaKey || evento.altKey) return;

      if (evento.key === '?') {
        evento.preventDefault();
        abrirAtajos_();
      } else if (evento.key.toLowerCase() === 'n') {
        if (modulosDeLaCuenta_().indexOf('nueva_solicitud') !== -1) {
          evento.preventDefault();
          mostrarModulo_('nueva_solicitud');
        }
      } else if (evento.key.toLowerCase() === 'g') {
        esperandoG_ = true;
        clearTimeout(temporizadorG_);
        temporizadorG_ = setTimeout(function () { esperandoG_ = false; }, 1200);
      } else if (evento.key.toLowerCase() === 'b' && esperandoG_) {
        esperandoG_ = false;
        if (modulosDeLaCuenta_().indexOf('bandeja') !== -1) {
          evento.preventDefault();
          mostrarModulo_('bandeja');
        }
      } else if (evento.key === '/') {
        var buscador = document.getElementById('buscar-recientes');
        if (buscador && buscador.offsetParent !== null) {
          evento.preventDefault();
          buscador.focus();
        }
      }
    });
  }

  function abrirAtajos_() {
    document.getElementById('atajos-telon').classList.remove('sigso-oculto');
    document.getElementById('panel-atajos').classList.remove('sigso-oculto');
  }

  function cerrarAtajos_() {
    document.getElementById('atajos-telon').classList.add('sigso-oculto');
    document.getElementById('panel-atajos').classList.add('sigso-oculto');
  }

  function modulosDeLaCuenta_() {
    // La sesion puede no haber cargado todavia (o el backend no responder).
    // Sin esta guarda, renderNavAhora_ moria con una excepcion y el sidebar
    // quedaba VACIO: la persona no veia ni Inicio para reintentar.
    var cuenta = (sesion && sesion.cuenta) || {};
    var propios = (cuenta.modulos || []).filter(function (m) { return MODULOS_SHELL[m]; });
    // v6.5: "novedades" es core -- se agrega siempre, aunque la cuenta no lo
    // tenga en su lista asignada. Justo despues de home (primera posicion
    // entre los internos) porque es lo que se quiere que se vea primero.
    if (propios.indexOf('novedades') === -1) propios = ['novedades'].concat(propios);
    return propios;
  }

  function urlExterna_(def) {
    return (window.SIGSO_CONFIG && window.SIGSO_CONFIG[def.urlConfig]) || '';
  }

  // v13.0: el nav del sidebar deja de ser una lista plana de módulos y pasa a
  // ser el ÁRBOL de navegación de SIGSO (SigsoNav.renderArbol). Cada módulo
  // que haya registrado su arquitectura se despliega aquí, en la barra azul;
  // el que no tenga árbol sigue siendo un enlace simple, como siempre.
  //
  // itemActivoDelModulo_ lo publica el propio módulo (SigsoShell.publicarItem)
  // para que el árbol marque la hoja correcta y deje su rama abierta.
  var itemActivoDelModulo_ = '';
  var badgesRecordados_ = {};

  // v13.1: familias de modulos para el sidebar. SIGSO fue creciendo modulo a
  // modulo y la lista quedo plana; agrupar por lo que la persona esta HACIENDO
  // es lo que la vuelve legible cuando son doce.
  //
  // El orden dentro de cada grupo lo manda esta lista, no el orden en que el
  // Admin marco los modulos en la cuenta.
  //
  // Un modulo que no este aca igual aparece (al final): agregar uno nuevo y
  // olvidar clasificarlo nunca puede hacerlo desaparecer del menu.
  var GRUPOS_SIDEBAR = [
    // Inicio va primero y SIN encabezado: no es una familia, es el punto de
    // partida. Si cayera en 'sueltos' terminaria abajo del todo.
    { titulo: '', modulos: ['home'] },
    { titulo: 'Mi espacio', modulos: ['novedades', 'mis_solicitudes', 'mi_trabajo', 'pausas'] },
    { titulo: 'Solicitudes', modulos: ['nueva_solicitud', 'bandeja'] },
    { titulo: 'Gestión', modulos: ['proyectos', 'jefatura', 'gerencia', 'pausas_coordinacion', 'calidad'] },
    { titulo: 'Sistema', modulos: ['administracion'] }
  ];

  // Debajo de este numero de destinos NO se agrupa. Un solicitante ve cuatro
  // cosas: ponerle tres encabezados encima seria decorar, no ordenar.
  var MINIMO_PARA_AGRUPAR = 7;

  // Una sola navegacion dispara hasta tres repintados (el modulo se monta,
  // publica su item y refresca sus permisos). Cada uno reconstruia el arbol
  // entero. Se agrupan en uno por frame: el resultado visible es el mismo y
  // se evita el parpadeo de reconstruir el DOM tres veces seguidas.
  var repintadoPedido_ = false;

  function renderNav_() {
    if (repintadoPedido_) return;
    repintadoPedido_ = true;
    // setTimeout y NO requestAnimationFrame: rAF no dispara cuando la pagina
    // no se esta pintando (pestaña en segundo plano). Con rAF, volver a una
    // pestaña dejada atras mostraba el menu VACIO -- el repintado quedaba
    // pendiente para siempre. Un timeout corre igual, y agrupa lo mismo.
    setTimeout(function () { repintadoPedido_ = false; renderNavAhora_(); }, 0);
  }

  function renderNavAhora_() {
    var nav = document.getElementById('nav-modulos');
    if (!nav) return;

    var modulos = [{ id: 'home', nombre: 'Inicio', icono: 'inicio' }]
      .concat(modulosDeLaCuenta_().map(function (id) {
        var def = MODULOS_SHELL[id];
        var url = def.interno ? '' : urlExterna_(def);
        return {
          id: id,
          nombre: def.nombre,
          icono: def.icono,
          acento: acentoInline_(id),
          esEnlace: !def.interno,
          href: url
        };
      }).filter(function (m) { return m.esEnlace ? !!m.href : true; }));

    SigsoNav.renderArbol({
      contenedor: nav,
      modulos: modulos,
      grupos: modulos.length >= MINIMO_PARA_AGRUPAR ? GRUPOS_SIDEBAR : null,
      moduloActivo: moduloActivo_,
      itemActivo: itemActivoDelModulo_,
      onModulo: function (id) {
        // Volver a tocar el módulo abierto lo cierra; tocar otro lo abre.
        if (id === moduloActivo_ && id !== 'home') {
          moduloActivo_ = null;
          renderNav_();
          return;
        }
        mostrarModulo_(id);
      },
      onItem: function (moduloId, itemId) {
        // Si la hoja es de OTRO módulo, primero hay que abrirlo: el módulo
        // consume la ruta al montarse (tomarItemDeRuta).
        if (moduloId !== moduloActivo_) {
          itemPendienteDeRuta_ = itemId;
          mostrarModulo_(moduloId);
          return;
        }
        irAItemDelModuloActivo_(moduloId, itemId);
      }
    });

    // Los contadores los rellena actualizarContadores_ sobre [data-badge].
    actualizarContadoresSiHay_();
  }

  // Cada módulo expone cómo ir a una de sus secciones. Se busca por convención
  // (SigsoX.irAItem) para no tener que enumerarlos acá y que agregar un módulo
  // nuevo no obligue a tocar el shell.
  var IR_A_ITEM_POR_MODULO = {
    calidad: function (id) { return window.SigsoCalidad && window.SigsoCalidad.irAItem && window.SigsoCalidad.irAItem(id); },
    administracion: function (id) { return window.SigsoAdmin && window.SigsoAdmin.irAItem && window.SigsoAdmin.irAItem(id); },
    gerencia: function (id) { return window.SigsoGerencia && window.SigsoGerencia.irAItem && window.SigsoGerencia.irAItem(id); },
    jefatura: function (id) { return window.SigsoJefatura && window.SigsoJefatura.irAItem && window.SigsoJefatura.irAItem(id); },
    proyectos: function (id) { return window.SigsoProyectos && window.SigsoProyectos.irAItem && window.SigsoProyectos.irAItem(id); },
    novedades: function (id) { return window.SigsoNovedades && window.SigsoNovedades.irAItem && window.SigsoNovedades.irAItem(id); },
    pausas_coordinacion: function (id) { return window.SigsoCoordinacion && window.SigsoCoordinacion.irAItem && window.SigsoCoordinacion.irAItem(id); }
  };

  function irAItemDelModuloActivo_(moduloId, itemId) {
    var ir = IR_A_ITEM_POR_MODULO[moduloId];
    if (ir) { ir(itemId); return; }
    // Sin puente: al menos deja la URL y el árbol coherentes.
    itemActivoDelModulo_ = itemId;
    if (window.SigsoRutas) SigsoRutas.escribir(moduloId, itemId);
    renderNav_();
  }

  // Los badges se piden una sola vez al entrar, pero el arbol se repinta cada
  // vez que se abre o cierra una rama. Sin recordarlos, el contador
  // desaparecia al primer clic en el sidebar.
  function actualizarContadoresSiHay_() {
    Object.keys(badgesRecordados_).forEach(function (id) {
      pintarBadge_(id, badgesRecordados_[id]);
    });
  }

  // v14.0: el Inicio vive en inicio.js. Este shell le pasa lo que solo el
  // conoce (sesion, modulos de la cuenta, navegacion y badges) y no sabe
  // nada de como se arma la pantalla.
  // v14.0 (Fase 3): envuelve el <h1> directo de una seccion de modulo en un
  // encabezado consistente (icono del modulo en pastilla de acento + titulo +
  // subtitulo). Idempotente: si el h1 ya esta dentro de la pastilla, no
  // vuelve a envolver. 'home' se excluye (tiene su propio diseno de saludo).
  function decorarCabModulo_(seccion, id) {
    if (!seccion || id === 'home') return;
    var h1 = seccion.querySelector(':scope > h1');
    if (!h1 || (h1.parentNode && h1.parentNode.classList && h1.parentNode.classList.contains('sigso-modulo-cab__texto'))) return;
    var def = MODULOS_SHELL[id];
    var color = MODULO_COLOR[id];

    var cab = document.createElement('header');
    cab.className = 'sigso-modulo-cab';
    if (color) {
      cab.style.setProperty('--acento', color.acento);
      cab.style.setProperty('--acento-suave', color.suave);
    }
    var icono = document.createElement('span');
    icono.className = 'sigso-modulo-cab__icono';
    icono.innerHTML = def ? Iconos.svg(def.icono, { tam: 22 }) : '';
    var texto = document.createElement('div');
    texto.className = 'sigso-modulo-cab__texto';

    // El subtitulo (<p class="sigso-ayuda"> inmediatamente despues del h1) se
    // mueve junto al titulo para que quede dentro del encabezado.
    var sub = h1.nextElementSibling;
    h1.parentNode.insertBefore(cab, h1);
    cab.appendChild(icono);
    cab.appendChild(texto);
    texto.appendChild(h1);
    if (sub && sub.classList && sub.classList.contains('sigso-ayuda')) texto.appendChild(sub);
  }

  function renderHome_() {
    if (window.SigsoInicio) {
      SigsoInicio.render({
        cuenta: sesion.cuenta,
        token: sesion.token,
        modulos: modulosDeLaCuenta_(),
        irAModulo: function (id) { mostrarModulo_(id); },
        pintarBadge: pintarBadge_,
        backofficeDisponible: backofficeDisponible_,
        // El command palette reusa los recientes ya cargados por el Inicio,
        // sin pedirle nada nuevo al backend (v5.0 F4 §6.1).
        onRecientes: function (recientes) { ultimosRecientes_ = recientes || []; }
      });
    }

    // v6.5: badge de novedades pendientes en el sidebar. La TARJETA suelta de
    // novedades se retiro en la v14.0: las novedades por leer ahora salen en
    // "Requiere tu atencion" (inicio.js), asi no aparecen dos veces.
    if (window.SigsoNovedades) {
      window.SigsoNovedades.actualizarBadge();
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
    // v13.0: se recuerda, porque el arbol del sidebar se repinta al abrir y
    // cerrar ramas y el contador se perdia en el primer clic.
    badgesRecordados_[modulo] = cantidad;
    var badge = document.querySelector('[data-badge="' + modulo + '"]');
    if (!badge) return;
    badge.textContent = cantidad > 99 ? '99+' : String(cantidad);
    badge.classList.toggle('sigso-oculto', !cantidad);
  }

  // Modulos "de trabajo" (tablas, dashboard, detalle de 3 columnas): necesitan
  // el contenedor ancho, como app.html. Los demas (formulario, mis
  // solicitudes) se leen mejor angostos y centrados -- por eso el ancho del
  // <main> se adapta al modulo en vez de ser fijo.
  var MODULOS_ANCHOS = ['bandeja', 'gerencia', 'jefatura', 'administracion', 'proyectos', 'calidad'];

  // v5.1: modulo activo + cuando se cargaron por ultima vez sus datos, para
  // el auto-refresco al volver a la pestana (sin recargar la pagina).
  var moduloActivo_ = null;
  var ultimaCargaModulo_ = {};
  // v12.1: item pedido por la URL, para que el modulo lo abra al montarse.
  // Se consume una sola vez: despues manda la navegacion del usuario.
  var itemPendienteDeRuta_ = '';

  // 'home' no esta en MODULOS_SHELL pero es un destino valido del shell.
  function puedeAbrirModulo_(id) {
    if (id === 'home') return true;
    return modulosDeLaCuenta_().indexOf(id) !== -1;
  }

  // Lo consume el modulo al montarse (hoy Calidad).
  function tomarItemDeRuta_() {
    var v = itemPendienteDeRuta_;
    itemPendienteDeRuta_ = '';
    return v;
  }

  function mostrarModulo_(id) {
    moduloActivo_ = id;
    ultimaCargaModulo_[id] = Date.now();
    // v12.1: la URL refleja donde estas. replaceState (reemplazar=true) para
    // que abrir un modulo no meta un paso extra en el historial: el paso lo
    // mete el propio cambio de hash cuando navega el usuario.
    if (window.SigsoRutas) SigsoRutas.escribir(id, itemPendienteDeRuta_, true);
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
    // v14.0 (piel nueva, Fase 3): encabezado de modulo UNIFICADO. Cada modulo
    // tenia un <h1> plano distinto; se decora con el icono del modulo en una
    // pastilla de su acento + titulo + subtitulo. Se hace desde el shell (un
    // solo lugar) en vez de retocar el markup de cada seccion. Solo toca el
    // <h1> hijo DIRECTO de la seccion: los dashboards (bandeja/gerencia/
    // jefatura) tienen su h1 anidado en una sub-vista y conservan su cabecera.
    decorarCabModulo_(document.getElementById(seccionId), id);
    // v13.0: el arbol se repinta entero -- ya no basta con mover una clase,
    // porque al cambiar de modulo hay que cerrar la rama del anterior y abrir
    // la del nuevo. El item lo publicara el modulo al montarse.
    itemActivoDelModulo_ = itemPendienteDeRuta_ || '';
    renderNav_();

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
    if (id === 'pausas' && window.SigsoPausas) {
      window.SigsoPausas.cargar();
    }
    if (id === 'pausas_coordinacion' && window.SigsoCoordinacion) {
      window.SigsoCoordinacion.cargar();
    }
    if (id === 'novedades' && window.SigsoNovedades) {
      window.SigsoNovedades.cargar();
    }
    if (id === 'mi_trabajo' && window.SigsoActividades) {
      window.SigsoActividades.cargar();
    }
    if (id === 'proyectos' && window.SigsoProyectos) {
      window.SigsoProyectos.cargar();
    }
    if (id === 'calidad' && window.SigsoCalidad) {
      window.SigsoCalidad.cargar();
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
    ['vista-login', 'vista-cambiar-clave', 'vista-cargando', 'vista-shell'].forEach(function (vista) {
      var el = document.getElementById(vista);
      if (el) el.classList.toggle('sigso-oculto', vista !== id);
    });
  }

  function guardarSesionLocal_(token, cuenta) {
    try {
      localStorage.setItem(LLAVE_TOKEN, token);
      localStorage.setItem(LLAVE_CUENTA, JSON.stringify(cuenta));
    } catch (err) { /* sin storage: sesion solo en memoria */ }
  }

  function leerCuentaCache_() {
    try {
      var crudo = localStorage.getItem(LLAVE_CUENTA);
      return crudo ? JSON.parse(crudo) : null;
    } catch (err) { return null; }
  }

  function olvidarSesion_() {
    try {
      localStorage.removeItem(LLAVE_TOKEN);
      localStorage.removeItem(LLAVE_CUENTA);
    } catch (err) { /* idem */ }
  }
})();
