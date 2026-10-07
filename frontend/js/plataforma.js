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

  // Catálogo de módulos del shell: todos viven en esta página.
  // v4.0: `icono` pasa de emoji a clave de iconos.js -- el emoji lo dibujaba
  // el sistema operativo (distinto en Windows/Mac/Android y sin heredar el
  // color del texto).
  var MODULOS_SHELL = {
    nueva_solicitud: { icono: 'nueva', nombre: 'Nueva solicitud', descripcion: 'Ingresa un pedido al equipo' },
    mis_solicitudes: { icono: 'lista', nombre: 'Mis solicitudes', descripcion: 'El estado de todo lo tuyo, de todos tus correos' },
    // P3: bandeja y gerencia viven DENTRO del shell (dashboard.js/detalle.js/
    // gerencia.js orquestados aqui, con el token de la sesion via api.js).
    bandeja: { icono: 'bandeja', nombre: 'Bandeja de trabajo', descripcion: 'Solicitudes del equipo: estados, fechas, derivaciones' },
    // v14.0 (piel nueva): icono propio por modulo -- antes gerencia/jefatura/
    // coordinacion compartian 'grafico' y no se distinguian en el sidebar.
    gerencia: { icono: 'tendencia', nombre: 'Panel de gerencia', descripcion: 'KPIs, semáforo de cumplimiento y seguimiento' },
    // v4.2: "Gerencia acotado" al equipo del jefe (JEFATURAS, por correo) --
    // ver documentacion/SIGSO-v4.2-propuestas-modulo-jefatura.md.
    jefatura: { icono: 'equipo', nombre: 'Mi departamento', descripcion: 'Qué pasó hoy con tu equipo: KPIs, seguimiento y validaciones pendientes' },
    // P4: administracion tambien vive dentro del shell (admin.js con el
    // token de la sesion; el backend exige el modulo en cada accion).
    administracion: { icono: 'ajustes', nombre: 'Administración', descripcion: 'Catálogos, usuarios y cuentas de la plataforma' },
    // v6.0 Fase P2: el trabajador registra su participacion en la pausa activa
    // del dia (pausas.js). Cero friccion, pensado para el enlace magico.
    pausas: { icono: 'actividad', nombre: 'Pausas activas', descripcion: 'Registra tu participación en la pausa de hoy' },
    // v6.0 Fase P3: la coordinadora (prevencionista) opera la pausa del dia y
    // ve sus reportes de cumplimiento (coordinacion.js).
    pausas_coordinacion: { icono: 'portapapeles', nombre: 'Coordinación de pausas', descripcion: 'Opera la pausa del día y ve el cumplimiento' },
    // v6.5: Novedades es un modulo CORE, no asignable por cuenta (ver
    // modulosDeLaCuenta_) -- igual que "Mi perfil", disponible para
    // cualquiera con sesion, sin que un Admin tenga que activarlo cuenta por
    // cuenta.
    novedades: { icono: 'periodico', nombre: 'Novedades', descripcion: 'Leyes, avisos y novedades de todas las áreas' },
    // v7.0 (Fase 2, modulo de Gestion Operacional): compromisos con
    // check-in de 1 clic (documentacion/SIGSO-v7.0-propuesta-modulo-
    // gestion-operacional.md §4.4/§5.1). No es core como 'novedades' --
    // depende de que la cuenta lo tenga en CUENTAS_PORTAL.modulos.
    mi_trabajo: { icono: 'tareas', nombre: 'Mi trabajo', descripcion: 'Tus compromisos, con un check-in de un clic' },
    // v9.0 (documentacion/SIGSO-v9.0-propuesta-modulo-gestion-proyectos.md):
    // portafolio + sala de trabajo de proyectos internos. No es core --
    // depende de que la cuenta lo tenga en CUENTAS_PORTAL.modulos, igual
    // que 'mi_trabajo'.
    proyectos: { icono: 'capas', nombre: 'Proyectos', descripcion: 'Portafolio, equipo y sala de trabajo de tus proyectos' },
    // v10.0 (documentacion/SIGSO-v10.0-propuesta-modulo-sgc-iso9001.md):
    // repositorio documental del Sistema de Gestion de Calidad. Cada
    // persona ve SOLO los documentos que le corresponden -- el filtrado lo
    // hace el backend (Calidad.gs), no el shell. No es core: depende de que
    // la cuenta tenga 'calidad' en CUENTAS_PORTAL.modulos.
    calidad: { icono: 'medalla', nombre: 'Calidad', descripcion: 'Documentación, procesos, personas, control y mejora del SGC' },
    // Finanzas (2026-10-06, finanzas-v2.js): la bóveda de las finanzas del
    // grupo. No se asigna en la cuenta: solo aparece si la sesión trae
    // cuenta.finanzas (lista fija del servidor) y cada acción lo re-verifica.
    finanzas: { icono: 'candado', nombre: 'Finanzas', descripcion: 'Bóveda: caja, cobranza y resultados del grupo' },
    // Credenciales (2026-10-07, credenciales-v2.js): claves de la empresa por
    // categoría. Lo pinta cuenta.credenciales; cada acción lo re-verifica.
    credenciales: { icono: 'llave', nombre: 'Credenciales', descripcion: 'Claves de la empresa y quién tiene acceso' },
    // Hompy (2026-10-06, hompy-v2.js): la mascota. Se asigna en la cuenta
    // (módulo `hompy`) y el servidor lo exige en cada acción. Su ícono es la
    // cara de Hompy (iconos.js la dibuja como imagen).
    hompy: { icono: 'hompy', nombre: 'Hompy', descripcion: 'La mascota: calendario, salidas a terreno y contenido' }
  };

  // 2026-10-03: los DEPARTAMENTOS del organigrama, un módulo cada uno
  // (control-interno-v2.js). Reemplazan al antiguo "Control interno". No se
  // asignan en la cuenta: el servidor manda en la sesión (cuenta.departamentos)
  // los que ve cada persona según la lista de cada área, y verifica el permiso
  // en cada acción. Todos comparten acento: son una misma familia.
  var DEPARTAMENTOS_SHELL = [
    ['dep_contabilidad', 'Contabilidad', 'dinero', 'Matrices del área, reporte mensual y su equipo'],
    ['dep_rrhh', 'Recursos Humanos', 'gafete', 'Matrices del área, reporte mensual y su equipo'],
    ['dep_prevencion', 'Prevención de riesgos', 'casco', 'Trabajo del área, reporte mensual y su equipo'],
    ['dep_marketing', 'Marketing corporativo', 'megafono', 'Trabajo del área, reporte mensual y su equipo'],
    ['dep_cobranzas', 'Facturación y cobranzas', 'recibo', 'Lo que HomePymes factura y cobra a sus clientes'],
    ['dep_administracion', 'Administración', 'maletin', 'Los reportes mensuales de las áreas, ya validados por su jefatura']
  ];
  var IDS_DEPARTAMENTO = DEPARTAMENTOS_SHELL.map(function (d) { return d[0]; });
  DEPARTAMENTOS_SHELL.forEach(function (d) { MODULOS_SHELL[d[0]] = { icono: d[2], nombre: d[1], descripcion: d[3] }; });
  function esDepartamento_(id) { return IDS_DEPARTAMENTO.indexOf(id) !== -1; }
  // Barra lateral (2026-10-05, decisión 2): nombre corto donde falta espacio
  // (fijados, recientes) y título completo en el riel. "Administración" a
  // secas es el área; la del sistema se nombra entera para no confundirlas.
  var CORTOS_SHELL = {
    bandeja: 'Bandeja', gerencia: 'Gerencia', jefatura: 'Mi depto.', pausas_coordinacion: 'Coord. de pausas',
    administracion: 'Sistema', dep_rrhh: 'RR.HH.', dep_prevencion: 'Prevención', dep_marketing: 'Marketing', dep_cobranzas: 'Facturación'
  };
  var TITULOS_SHELL = { administracion: 'Administración del sistema' };
  Object.keys(MODULOS_SHELL).forEach(function (id) {
    MODULOS_SHELL[id].corto = CORTOS_SHELL[id] || MODULOS_SHELL[id].nombre;
    MODULOS_SHELL[id].titulo = TITULOS_SHELL[id] || MODULOS_SHELL[id].nombre;
  });
  function moduloDepartamento_(id) { return window.SigsoDepartamentos ? window.SigsoDepartamentos.modulo(id) : null; }

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
    calidad: { acento: 'var(--mod-calidad)', suave: 'var(--mod-calidad-suave)' },
    finanzas: { acento: 'var(--mod-finanzas)', suave: 'var(--mod-finanzas-suave)' },
    credenciales: { acento: 'var(--mod-credenciales)', suave: 'var(--mod-credenciales-suave)' },
    hompy: { acento: 'var(--mod-hompy)', suave: 'var(--mod-hompy-suave)' }
  };
  // Barra lateral, segunda versión (2026-10-05): cada área con su color, para reconocerla de lejos.
  var COLOR_AREA = { dep_contabilidad: 'contab', dep_rrhh: 'rrhh', dep_prevencion: 'prev', dep_marketing: 'mkt', dep_cobranzas: 'fact', dep_administracion: 'admarea' };
  IDS_DEPARTAMENTO.forEach(function (id) { var k = COLOR_AREA[id] || 'control'; MODULO_COLOR[id] = { acento: 'var(--mod-' + k + ')', suave: 'var(--mod-' + k + '-suave)' }; });

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
    // Fase "Recuperar contraseña" (Arquitectura de Accesos, 2026-09-19).
    document.getElementById('form-recuperar').addEventListener('submit', manejarSolicitarRecuperacion_);
    document.getElementById('form-restablecer').addEventListener('submit', manejarRestablecer_);
    document.getElementById('link-olvide-clave').addEventListener('click', function (e) {
      e.preventDefault();
      mostrarVista_('vista-recuperar');
    });
    document.getElementById('link-volver-login').addEventListener('click', function (e) {
      e.preventDefault();
      mostrarVista_('vista-login');
    });
    document.getElementById('link-volver-login-restablecer').addEventListener('click', function (e) {
      e.preventDefault();
      mostrarVista_('vista-login');
    });
    wireMenuUsuario_();
    wireMiPerfil_();
    wireVerContrasena_();
    wirePaleta_();
    wireAtajos_();
    wireSidebar_();
    wireShellV2_();
    wireTour_();

    wireAutorefresco_();

    // Fase "Recuperar contraseña" (Arquitectura de Accesos, 2026-09-19):
    // "?reset=" en la URL viene del correo de recuperación -- va directo a
    // elegir contraseña nueva, sin tocar ninguna sesión existente ni
    // intentar restaurarla. Mismo criterio de privacidad que el enlace
    // mágico: se limpia de la URL enseguida.
    var tokenRestablecer_ = null;
    try {
      tokenRestablecer_ = new URLSearchParams(window.location.search).get('reset');
    } catch (err) { /* navegador viejo sin URLSearchParams */ }
    if (tokenRestablecer_) {
      document.getElementById('form-restablecer').setAttribute('data-token', tokenRestablecer_);
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      mostrarVista_('vista-restablecer');
      return;
    }

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
          if (!document.getElementById('vista-shell').hidden) {
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
    mensajeAcceso_(salida, '');

    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'portalLogin', {
      usuario: document.getElementById('campo-login-usuario').value,
      password: document.getElementById('campo-login-password').value
    }).then(function (respuesta) {
      if (!respuesta.ok) {
        mensajeAcceso_(salida, respuesta.message || 'No se pudo ingresar.', 'error');
        return;
      }
      document.getElementById('campo-login-password').value = '';
      guardarSesionLocal_(respuesta.data.token, respuesta.data.cuenta);
      iniciarSesion_(respuesta.data.token, respuesta.data.cuenta);
    }).catch(function () {
      mensajeAcceso_(salida, 'No se pudo conectar con el servidor. Intenta nuevamente.', 'error');
    }).finally(function () {
      boton.disabled = false;
    });
  }

  function manejarCambioClave_(evento) {
    evento.preventDefault();
    var salida = document.getElementById('resultado-cambiar-clave');
    var nueva = document.getElementById('campo-clave-nueva').value;
    if (nueva !== document.getElementById('campo-clave-repetir').value) {
      mensajeAcceso_(salida, 'Las contraseñas nuevas no coinciden.', 'error');
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
        mensajeAcceso_(salida, respuesta.message || 'No se pudo cambiar la contraseña.', 'error');
        return;
      }
      sesion.cuenta.debe_cambiar_password = false;
      guardarSesionLocal_(sesion.token, sesion.cuenta);
      entrarAlShell_();
    }).catch(function () {
      mensajeAcceso_(salida, 'No se pudo conectar con el servidor. Intenta nuevamente.', 'error');
    }).finally(function () {
      boton.disabled = false;
    });
  }

  // Fase "Recuperar contraseña" (Arquitectura de Accesos, 2026-09-19).
  // La respuesta del servidor es SIEMPRE la misma (anti-enumeración, ver
  // recuperarPassword.js) -- este formulario no distingue "cuenta
  // encontrada" de "no existe", solo confirma que el pedido se hizo.
  function manejarSolicitarRecuperacion_(evento) {
    evento.preventDefault();
    var boton = document.getElementById('btn-recuperar');
    var salida = document.getElementById('resultado-recuperar');
    var identificador = document.getElementById('campo-recuperar-identificador').value;
    boton.disabled = true;
    mensajeAcceso_(salida, '');
    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'portalSolicitarRecuperacion', { identificador: identificador })
      .then(function (respuesta) {
        mensajeAcceso_(salida,
          (respuesta.data && respuesta.data.message) || respuesta.message || 'Si el usuario o correo existe, te llegará un enlace.',
          'exito');
        document.getElementById('campo-recuperar-identificador').value = '';
      }).catch(function () {
        mensajeAcceso_(salida, 'No se pudo conectar con el servidor. Intenta nuevamente.', 'error');
      }).finally(function () {
        boton.disabled = false;
      });
  }

  function manejarRestablecer_(evento) {
    evento.preventDefault();
    var salida = document.getElementById('resultado-restablecer');
    var nueva = document.getElementById('campo-restablecer-nueva').value;
    if (nueva.length < 8) {
      mensajeAcceso_(salida, 'La contraseña nueva debe tener al menos 8 caracteres.', 'error');
      return;
    }
    if (nueva !== document.getElementById('campo-restablecer-repetir').value) {
      mensajeAcceso_(salida, 'Las contraseñas nuevas no coinciden.', 'error');
      return;
    }
    var boton = document.getElementById('btn-restablecer');
    var token = document.getElementById('form-restablecer').getAttribute('data-token');
    boton.disabled = true;
    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'portalRestablecerPassword', { token: token, password_nueva: nueva })
      .then(function (respuesta) {
        if (!respuesta.ok) {
          mensajeAcceso_(salida, respuesta.message || 'No se pudo restablecer la contraseña.', 'error');
          return;
        }
        mensajeAcceso_(salida, 'Contraseña actualizada. Ya puedes ingresar con ella.', 'exito');
        document.getElementById('campo-restablecer-nueva').value = '';
        document.getElementById('campo-restablecer-repetir').value = '';
        setTimeout(function () { mostrarVista_('vista-login'); }, 1800);
      }).catch(function () {
        mensajeAcceso_(salida, 'No se pudo conectar con el servidor. Intenta nuevamente.', 'error');
      }).finally(function () {
        boton.disabled = false;
      });
  }

  function manejarLogout_() {
    llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'portalLogout', { token: sesion.token }).catch(function () {});
    olvidarSesion_();
    sesion = { token: null, cuenta: null };
    autocompletadoHecho = false;
    actualizarModuloV2_(null); // quita el interruptor flotante de v2
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
    // Los avisos vivos esperan a este momento (nunca sobre el acceso).
    document.dispatchEvent(new CustomEvent('sigso:shell-listo'));
    renderIdentidad_();
    // v6.4: la foto propia se pide DESPUES de pintar la identidad, para que
    // el header aparezca de inmediato con las iniciales y la foto lo
    // reemplace al llegar (nunca un hueco esperando la red).
    cargarFotoPropia_();
    // Fijados de la cuenta (la siguen a cualquier equipo) y recientes de este equipo.
    if (window.SigsoBarra) SigsoBarra.iniciar({ cuenta: (sesion.cuenta && sesion.cuenta.cuenta_id) || '' });
    renderNav_();
    renderHome_();
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
        if (window.SigsoBarra && moduloActivo_) SigsoBarra.visita(moduloActivo_, itemId);
        renderNav_();
      },
      // El modulo avisa que cambiaron sus permisos (llego seccionesVisibles_)
      // para que el arbol muestre lo que de verdad puede abrir.
      refrescarArbol: function () { renderNav_(); },
      // Un módulo que lleva su propio contador en el menú (reportes de los departamentos).
      // tono: 'rojo' atrasado, 'ambar' para hoy, 'gris' por revisar (sin tono, el del módulo).
      pintarBadge: function (id, n, tono) { pintarBadge_(id, n, tono); }
    };

    mostrarModulo_(moduloInicial);
    // Reportes de departamento que esperan a esta persona: el número en el menú desde que entra.
    if (window.SigsoDepartamentos && modulosDeLaCuenta_().some(esDepartamento_)) window.SigsoDepartamentos.contadores();

    // Calidad sale del camino critico (carga-diferida.js) pero se pide en
    // cuanto el navegador queda ocioso: asi no se paga en el arranque y ya
    // esta cuando alguien la abre. Al llegar hay que repintar el arbol --
    // Calidad registra sus submodulos al cargar, y de eso depende que el
    // sidebar le dibuje la flechita de desplegable.
    if (window.SigsoCarga) {
      window.SigsoCarga.precargar().then(function () { renderNav_(); });
    }

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
    if (document.getElementById('vista-shell').hidden) return;
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
        var modMs = moduloImpl_('mis_solicitudes');
        if (modMs) { if (modMs.refrescar) modMs.refrescar(); else modMs.cargar(); }
        break;
      case 'bandeja':
        var modBj = moduloImpl_('bandeja');
        if (modBj) { if (modBj.refrescar) modBj.refrescar(); else modBj.cargar(); }
        break;
      case 'gerencia':
        if (window.SigsoGerencia) window.SigsoGerencia.cargar();
        break;
      case 'jefatura':
        if (window.SigsoJefatura) window.SigsoJefatura.cargar();
        break;
      case 'mi_trabajo':
        var modMt = moduloImpl_('mi_trabajo');
        if (modMt) { if (modMt.refrescar) modMt.refrescar(); else modMt.cargar(); }
        break;
      case 'proyectos':
        // v9.0b: 'refrescar' (no 'cargar') -- si el usuario tiene un
        // proyecto abierto, lo mantiene ahi en vez de devolverlo al
        // portafolio en cada refresco de fondo (ver proyectos.js).
        var modPy = moduloProyectos_();
        if (modPy) {
          if (modPy.refrescar) modPy.refrescar();
          else modPy.cargar();
        }
        break;
      case 'dep_contabilidad': case 'dep_rrhh': case 'dep_prevencion': case 'dep_marketing': case 'dep_cobranzas': case 'dep_administracion':
        if (moduloDepartamento_(moduloActivo_)) moduloDepartamento_(moduloActivo_).refrescar();
        break;
      case 'calidad':
        // Mismo criterio que Proyectos: si hay un documento abierto, el
        // refresco de fondo no debe sacar al usuario de ahi.
        if (window.SigsoCalidad) {
          if (window.SigsoCalidad.refrescar) window.SigsoCalidad.refrescar();
          else window.SigsoCalidad.cargar();
        }
        break;
      case 'hompy':
        if (window.SigsoHompy) window.SigsoHompy.refrescar();
        break;
      default:
        break; // nueva_solicitud / administracion: sin auto-refresco
    }
  }

  // Tour de bienvenida: solo la primera sesión (por navegador), en escritorio.
  // Señala el marco, no datos, así sirve para cualquier rol. En celular el
  // sidebar es un cajón oculto: se deja para la primera sesión en escritorio.
  // 2026-10-05: llave nueva para que quien ya vio el recorrido anterior vea
  // una vez la barra renovada (riel + panel); a quien entra por primera vez
  // se le da la bienvenida de siempre.
  // 2026-10-05 (segunda versión de la barra): llave nueva para que todos vean
  // una vez cómo se lee la barra con nombres, colores y secciones.
  // 2026-10-06 (barra «Bloques»): llave nueva, todos ven una vez cómo se lee la barra nueva.
  var LLAVE_TOUR = 'sigso_tour_barra_3'; // ojo: una llave terminada en _v2 la borra la limpieza de abajo (preferencias de la versión clásica)
  var LLAVE_TOUR_ANTERIOR = 'sigso_tour_visto';
  var TOUR_PASOS = [
    { selector: '#plataforma-sidebar .plataforma-header__marca', titulo: 'Bienvenido a SIGSO',
      texto: 'Este es tu panel: desde aquí llegas a todo lo que tu cuenta puede ver.' },
    { selector: '#sb-riel', titulo: 'Tus áreas, a la izquierda',
      texto: 'Pasa el mouse por los íconos y se despliegan con su nombre completo y cuánto te espera: rojo, atrasado; ámbar, para hoy.' },
    { selector: '#sb-portada', titulo: 'El área abierta',
      texto: 'Su nombre, para qué sirve y cuánto tiene atrasado. Con la estrella dejas la pantalla en tus atajos de Inicio.' },
    { selector: '#nav-modulos', titulo: 'El menú, en bloques',
      texto: 'Cada tarjeta es un módulo: ábrela y aparecen sus secciones. Si una sección tiene más, se abre su bandeja. Solo queda abierta una a la vez.' },
    { selector: '#sb-buscar-caja', titulo: 'Busca en el área o en todo SIGSO',
      texto: 'Escribe para filtrar el menú del área. Con Ctrl+K (Cmd+K en Mac) buscas en todo SIGSO, incluso una solicitud por su número.' },
    { selector: '#plataforma-sidebar .js-shell-campana', titulo: 'Tus avisos',
      texto: 'Lo que requiere tu atención llega aquí: asignaciones, novedades por leer y cambios en tus solicitudes.' },
    { selector: '#btn-menu-usuario', titulo: 'Tu cuenta',
      texto: 'Tu perfil y foto, el modo oscuro, los atajos de teclado y cerrar sesión. Con Ctrl+B ocultas o muestras el menú del área.' }
  ];
  var tourPasoActual_ = 0;

  function iniciarTourSiCorresponde_() {
    var visto = false;
    try { visto = localStorage.getItem(LLAVE_TOUR) === '1'; } catch (err) { visto = true; }
    if (visto || window.innerWidth <= UMBRAL_ANGOSTO) return;
    var conocia = false;
    try { conocia = localStorage.getItem(LLAVE_TOUR_ANTERIOR) === '1' || localStorage.getItem('sigso_tour_barra_v1') === '1' || localStorage.getItem('sigso_tour_barra_2') === '1'; } catch (err) { conocia = false; }
    if (conocia) {
      TOUR_PASOS[0] = { selector: '#plataforma-sidebar .plataforma-header__marca', titulo: 'Tu barra lateral, renovada',
        texto: 'La barra cambió: íconos que se despliegan al pasar el mouse y un menú en bloques que se abre de a uno. Te muestro lo nuevo en unos pasos.' };
    }
    tourPasoActual_ = 0;
    mostrarPasoTour_();
  }

  function limpiarResaltadoTour_() {
    var actual = document.querySelector('.sx2-tour-foco');
    if (actual) actual.classList.remove('sx2-tour-foco');
  }

  // Lo que está en el sidebar se explica a su derecha (nunca encima): la
  // flecha apunta a la altura del elemento señalado.
  function posicionarTour_(tour, elemento) {
    tour.classList.toggle('sx2-tour--flecha', !!elemento);
    if (!elemento) {
      tour.style.top = '45%';
      tour.style.left = '50%';
      tour.style.transform = 'translate(-50%, -50%)';
      return;
    }
    var rect = elemento.getBoundingClientRect();
    var sidebar = elemento.closest('.plataforma-sidebar');
    var izquierda = (sidebar ? sidebar.getBoundingClientRect().right : rect.right) + 16;
    var alto = tour.offsetHeight || 200;
    var centro = rect.top + Math.min(rect.height, 64) / 2;
    var arriba = Math.min(Math.max(centro - 28, 12), window.innerHeight - alto - 12);
    tour.style.top = arriba + 'px';
    tour.style.left = izquierda + 'px';
    tour.style.transform = 'none';
    tour.style.setProperty('--sx-tour-flecha', Math.max(16, Math.min(centro - arriba, alto - 16)) + 'px');
  }

  function mostrarPasoTour_() {
    limpiarResaltadoTour_();
    var paso = TOUR_PASOS[tourPasoActual_];
    var elemento = paso.selector ? document.querySelector(paso.selector) : null;
    // Si el elemento de este paso no está a la vista para esta cuenta (p. ej.
    // la campana antes de tener avisos), se salta en vez de apuntar a la nada.
    if (paso.selector && !(elemento && elemento.getClientRects().length)) {
      if (tourPasoActual_ < TOUR_PASOS.length - 1) { tourPasoActual_++; mostrarPasoTour_(); }
      else cerrarTour_();
      return;
    }
    if (elemento) elemento.classList.add('sx2-tour-foco');

    document.getElementById('tour-paso-contador').textContent = 'Paso ' + (tourPasoActual_ + 1) + ' de ' + TOUR_PASOS.length;
    document.getElementById('tour-titulo').textContent = paso.titulo;
    document.getElementById('tour-texto').textContent = paso.texto;
    document.getElementById('btn-tour-atras').hidden = tourPasoActual_ === 0;
    var siguiente = document.getElementById('btn-tour-siguiente');
    siguiente.textContent = tourPasoActual_ === TOUR_PASOS.length - 1 ? 'Listo' : 'Siguiente';

    var tour = document.getElementById('tour-bienvenida');
    tour.hidden = false;
    posicionarTour_(tour, elemento);
    siguiente.focus();
  }

  function tourAbierto_() { return !document.getElementById('tour-bienvenida').hidden; }

  function cerrarTour_() {
    limpiarResaltadoTour_();
    document.getElementById('tour-bienvenida').hidden = true;
    try { localStorage.setItem(LLAVE_TOUR, '1'); } catch (err) { /* sin storage */ }
  }

  function wireTour_() {
    var btnSiguiente = document.getElementById('btn-tour-siguiente');
    if (!btnSiguiente) return;
    btnSiguiente.addEventListener('click', function () {
      if (tourPasoActual_ < TOUR_PASOS.length - 1) { tourPasoActual_++; mostrarPasoTour_(); }
      else cerrarTour_();
    });
    document.getElementById('btn-tour-atras').addEventListener('click', function () {
      if (tourPasoActual_ > 0) { tourPasoActual_--; mostrarPasoTour_(); }
    });
    document.getElementById('btn-tour-saltar').addEventListener('click', cerrarTour_);
    window.addEventListener('resize', function () { if (tourAbierto_()) mostrarPasoTour_(); });
  }

  // v4.0: avatar de iniciales + rol visible. Antes solo se veia el nombre
  // suelto junto a un boton de salir, y el rol no aparecia en ningun lado.
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
      email: (cuenta.emails || [])[0] || '',
      // super_admin: viaja en cuenta.super_admin desde el backend (ver
      // portal.js#perfilPublico). Solo decide si se MUESTRA la UI del panel
      // de datos crudo -- el gate real vive en el servidor.
      super_admin: cuenta.super_admin === true
    };
    document.getElementById('nav-nombre-usuario').textContent = cuenta.nombre;
    // El riel desplegado muestra nombre y cargo (sin cargo, el rol).
    document.getElementById('nav-rol-usuario').textContent =
      cuenta.cargo || ETIQUETA_ROL[cuenta.rol] || cuenta.rol;
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
  // de tema. El colapso y el tema se recuerdan entre sesiones.
  // 2026-10-06 (barra «Bloques»): lo que se oculta es el PANEL del área (Ctrl+B,
  // «[» o su botón); el riel queda siempre. La llave anterior se migra una vez.
  var LLAVE_SIDEBAR_COLAPSADO = 'sigso.sidebar.panelCollapsed';
  var LLAVE_SIDEBAR_ANTERIOR = 'sigso_sidebar_colapsado';
  var LLAVE_TEMA = 'sigso_tema';
  // Bajo 1024 px la barra es un cajón; entre 1024 y 1279 el panel parte oculto y se abre encima.
  var UMBRAL_MOVIL = 1023;
  var UMBRAL_ANGOSTO = 1279;

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
    var btnExpandir = document.getElementById('btn-expandir-sidebar');
    var btnAbrir = document.getElementById('btn-abrir-sidebar');
    var btnTema = document.getElementById('btn-tema');
    if (!sidebar || !btnColapsar || !btnAbrir || !btnTema) return;

    document.getElementById('ico-colapsar').innerHTML = Iconos.svg('colapsar', { tam: 17 });
    document.getElementById('ico-hamburguesa').innerHTML = Iconos.svg('menu', { tam: 18 });
    if (leer_(LLAVE_SIDEBAR_COLAPSADO) === null && leer_(LLAVE_SIDEBAR_ANTERIOR) !== null) {
      guardar_(LLAVE_SIDEBAR_COLAPSADO, leer_(LLAVE_SIDEBAR_ANTERIOR) === '1' ? '1' : '0');
    }

    function esMovil_() { return window.innerWidth <= UMBRAL_MOVIL; }
    function esAngosto_() { return !esMovil_() && window.innerWidth <= UMBRAL_ANGOSTO; }
    function ocultoGuardado_() { return leer_(LLAVE_SIDEBAR_COLAPSADO) === '1'; }

    // --- celular: un cajón con el riel desplegado; al tocar un área, su menú (con «← Áreas») ---
    function cerrarDrawer_() {
      sidebar.classList.remove('plataforma-sidebar--abierto', 'sb--ver-panel');
      telon.classList.remove('plataforma-sidebar__telon--visible');
      telon.classList.add('sigso-oculto');
      btnAbrir.setAttribute('aria-expanded', 'false');
      var volver = document.getElementById('sb-volver');
      if (volver) volver.hidden = true;
    }
    function abrirDrawer_() {
      sidebar.classList.remove('sb--ver-panel');
      sidebar.classList.add('plataforma-sidebar--abierto');
      telon.classList.remove('sigso-oculto');
      telon.classList.add('plataforma-sidebar__telon--visible');
      btnAbrir.setAttribute('aria-expanded', 'true');
    }
    btnAbrir.addEventListener('click', function () {
      if (sidebar.classList.contains('plataforma-sidebar--abierto')) cerrarDrawer_(); else abrirDrawer_();
    });
    telon.addEventListener('click', cerrarDrawer_);
    volverAreasBarra_ = function () {
      sidebar.classList.remove('sb--ver-panel');
      document.getElementById('sb-volver').hidden = true;
      var act = sidebar.querySelector('.sb-rb--act') || sidebar.querySelector('.sb-rb');
      if (act) act.focus();
    };

    // --- 1024-1279: el panel se abre ENCIMA del contenido y se cierra al hacer clic fuera ---
    function cerrarFlotante_() { sidebar.classList.remove('sb--flotante'); }
    // Al elegir una pantalla: se cierra el cajón (celular) o el panel encima.
    alNavegarBarra_ = function () { if (esMovil_()) cerrarDrawer_(); cerrarFlotante_(); };
    // Al tocar en el riel un área con menú.
    abrirMenuBarra_ = function (mismo) {
      if (esMovil_()) {
        sidebar.classList.add('sb--ver-panel');
        var volver = document.getElementById('sb-volver');
        if (volver) { volver.hidden = false; setTimeout(function () { volver.focus(); }, 0); }
        return;
      }
      if (!sidebar.classList.contains('plataforma-sidebar--colapsado')) return;
      if (esAngosto_()) {
        // Tocar de nuevo el área abierta cierra su panel.
        if (mismo && sidebar.classList.contains('sb--flotante')) { cerrarFlotante_(); return; }
        sidebar.classList.add('sb--flotante');
        return;
      }
      // Pantalla amplia con el panel oculto: tocar un área lo vuelve a mostrar.
      aplicarColapso_(false);
      guardar_(LLAVE_SIDEBAR_COLAPSADO, '0');
    };
    document.addEventListener('click', function (ev) { if (!sidebar.contains(ev.target)) cerrarFlotante_(); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') cerrarFlotante_(); });

    function aplicarColapso_(colapsado) {
      sidebar.classList.toggle('plataforma-sidebar--colapsado', colapsado);
      cerrarFlotante_();
      var texto = colapsado ? 'Mostrar el menú del área' : 'Ocultar el menú del área';
      [btnColapsar, btnExpandir].forEach(function (b) {
        if (!b) return;
        b.setAttribute('aria-expanded', String(!colapsado));
        b.setAttribute('aria-label', texto);
        b.setAttribute('title', texto + ' (Ctrl+B)');
      });
      if (btnExpandir) {
        document.getElementById('ico-expandir').innerHTML = Iconos.svg('colapsar', { tam: 20 });
        btnExpandir.classList.toggle('sb-expandir--mostrar', colapsado);
        var txt = document.getElementById('txt-expandir');
        if (txt) txt.textContent = colapsado ? 'Mostrar menú' : 'Ocultar menú';
      }
    }
    function alternarColapso_() {
      if (esMovil_()) return;
      if (esAngosto_()) {
        // Angosto: el panel no se fija; el botón lo abre o lo cierra encima.
        if (sidebar.classList.contains('sb--flotante')) cerrarFlotante_();
        else { aplicarColapso_(true); sidebar.classList.add('sb--flotante'); }
        return;
      }
      var colapsado = !sidebar.classList.contains('plataforma-sidebar--colapsado');
      aplicarColapso_(colapsado);
      guardar_(LLAVE_SIDEBAR_COLAPSADO, colapsado ? '1' : '0');
    }
    function aplicarSegunAncho_() {
      if (esMovil_()) { sidebar.classList.remove('plataforma-sidebar--colapsado'); cerrarFlotante_(); return; }
      cerrarDrawer_();
      aplicarColapso_(esAngosto_() ? true : ocultoGuardado_());
    }
    aplicarSegunAncho_();

    btnColapsar.addEventListener('click', function (ev) { ev.stopPropagation(); alternarColapso_(); });
    if (btnExpandir) btnExpandir.addEventListener('click', function (ev) { ev.stopPropagation(); alternarColapso_(); });
    // Ctrl/Cmd+B (y «[», como antes) ocultan o muestran el panel, salvo mientras se escribe.
    document.addEventListener('keydown', function (ev) {
      var conB = (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && (ev.key === 'b' || ev.key === 'B');
      var corchete = ev.key === '[' && !ev.ctrlKey && !ev.metaKey && !ev.altKey;
      if (!conB && !corchete) return;
      var t = ev.target;
      if (corchete && t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (conB && t && t.isContentEditable) return;
      if (document.getElementById('vista-shell').hidden) return;
      ev.preventDefault();
      alternarColapso_();
    });

    // Al cruzar un umbral se limpia el estado del otro ancho (un panel encima
    // atascado como cajón, o al revés).
    var anchoPrevio_ = esMovil_() ? 'movil' : esAngosto_() ? 'angosto' : 'amplio';
    window.addEventListener('resize', function () {
      var ahora = esMovil_() ? 'movil' : esAngosto_() ? 'angosto' : 'amplio';
      if (ahora === anchoPrevio_) return;
      anchoPrevio_ = ahora;
      aplicarSegunAncho_();
    });

    // Sin preferencia guardada, el SO manda (media query de tokens.css);
    // solo se fija data-tema cuando la persona elige explicitamente, para
    // no pisar "sigue al sistema" con un "claro" a la fuerza.
    function pintarIconoTema_(esOscuro) {
      document.getElementById('ico-tema').innerHTML = Iconos.svg(esOscuro ? 'sol' : 'luna', { tam: 16 });
      document.getElementById('txt-tema').textContent = esOscuro ? 'Modo claro' : 'Modo oscuro';
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

  // Buscar y saltar (Ctrl+K): pantallas de la cuenta (los módulos y las
  // secciones de sus árboles, con el mismo permiso que usa el sidebar) y
  // solicitudes recientes. Índice en memoria, sin backend. Enter abre lo
  // resaltado; flechas mueven; Esc cierra.
  var paletaSeleccion_ = 0;
  var PATRON_SOLICITUD_ = /^sol-\d{4}-[a-z]+-\d+$/i;

  function paletaAbierta_() { return !document.getElementById('paleta-comandos').hidden; }
  function itemsPaleta_() { return [].slice.call(document.querySelectorAll('#paleta-resultados .sx2-paleta__item')); }

  function wirePaleta_() {
    var input = document.getElementById('paleta-input');
    var resultados = document.getElementById('paleta-resultados');
    if (!input || !resultados) return;
    document.getElementById('ico-paleta-buscar').innerHTML = Iconos.svg('lupa', { tam: 18 });
    document.getElementById('paleta-telon').addEventListener('click', cerrarPaleta_);
    input.addEventListener('input', function () {
      paletaSeleccion_ = 0;
      renderResultadosPaleta_(input.value);
    });
    input.addEventListener('keydown', function (evento) {
      var items = itemsPaleta_();
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
    resultados.addEventListener('mousemove', function (evento) {
      var item = evento.target.closest('.sx2-paleta__item');
      var items = itemsPaleta_();
      var i = items.indexOf(item);
      if (i !== -1 && i !== paletaSeleccion_) { paletaSeleccion_ = i; marcarSeleccionPaleta_(items, true); }
    });
    resultados.addEventListener('click', function (evento) {
      var boton = evento.target.closest('.sx2-paleta__item');
      if (!boton) return;
      cerrarPaleta_();
      var accion = boton.getAttribute('data-accion');
      if (accion === 'ir') mostrarModulo_(boton.getAttribute('data-modulo'));
      else if (accion === 'item') irAItemArbol_(boton.getAttribute('data-modulo'), boton.getAttribute('data-item'));
      else if (accion === 'solicitud') abrirSolicitudDesdePaleta_(boton.getAttribute('data-id'));
    });
  }

  function marcarSeleccionPaleta_(items, sinDesplazar) {
    items.forEach(function (el, idx) {
      var sel = idx === paletaSeleccion_;
      el.classList.toggle('sx2-paleta__item--activo', sel);
      el.setAttribute('aria-selected', sel ? 'true' : 'false');
    });
    if (!sinDesplazar && items[paletaSeleccion_]) items[paletaSeleccion_].scrollIntoView({ block: 'nearest' });
  }

  function abrirPaleta_() {
    cerrarAtajos_();
    document.getElementById('paleta-comandos').hidden = false;
    var input = document.getElementById('paleta-input');
    input.value = '';
    paletaSeleccion_ = 0;
    renderResultadosPaleta_('');
    input.focus();
  }

  function cerrarPaleta_() {
    document.getElementById('paleta-comandos').hidden = true;
  }

  function normalizar_(texto) {
    return String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // Módulos de la cuenta + las secciones de sus árboles que la cuenta puede
  // ver (el mismo predicado `visible` que obedece el sidebar).
  function pantallasDeLaCuenta_() {
    var lista = [{ modulo: 'home', item: '', nombre: 'Inicio', ruta: '', icono: 'inicio' }];
    modulosDeLaCuenta_().forEach(function (id) {
      var def = MODULOS_SHELL[id];
      lista.push({ modulo: id, item: '', nombre: def.nombre, ruta: '', icono: def.icono });
      var reg = window.SigsoNav && SigsoNav.obtener(id);
      if (!reg || !reg.submodulos) return;
      reg.submodulos.forEach(function (sub) {
        (sub.items || []).forEach(function (it) {
          var llave = it.permiso || SigsoNav.partes(it.id).seccion;
          if (typeof reg.visible === 'function' && reg.visible(llave, it) === false) return;
          var ruta = sub.plano || sub.nombre === it.nombre ? def.nombre : def.nombre + ' › ' + sub.nombre;
          // Un ítem con tercer nivel (barra «Bloques») no es una pantalla: lo son sus hijos.
          if (it.hijos && it.hijos.length) {
            it.hijos.forEach(function (h) { lista.push({ modulo: id, item: h.id, nombre: h.nombre, ruta: ruta + ' › ' + it.nombre, icono: sub.icono || def.icono }); });
            return;
          }
          lista.push({ modulo: id, item: it.id, nombre: it.nombre, ruta: ruta, icono: sub.icono || def.icono });
        });
      });
    });
    return lista;
  }

  function itemPaletaHtml_(o) {
    return '<button type="button" class="sx2-paleta__item" role="option" aria-selected="false" data-accion="' + o.accion + '"' +
        ' data-modulo="' + UIv2.esc(o.modulo || '') + '" data-item="' + UIv2.esc(o.item || '') + '" data-id="' + UIv2.esc(o.id || '') + '">' +
      '<span class="sx2-paleta__ico">' + Iconos.svg(o.icono || 'caja', { tam: 16 }) + '</span>' +
      '<span class="sx2-paleta__txt"><strong>' + UIv2.esc(o.titulo) + '</strong>' +
        (o.detalle ? '<span>' + UIv2.esc(o.detalle) + '</span>' : '') + '</span>' +
    '</button>';
  }

  function renderResultadosPaleta_(texto) {
    var crudo = String(texto || '').trim();
    var q = normalizar_(crudo);
    var cont = document.getElementById('paleta-resultados');
    var html = '';

    // Sin texto: los módulos. Con texto: módulos y secciones que coinciden,
    // ordenadas por dónde coincide (el nombre pesa más que el grupo en que
    // vive: "report" trae todos los "Centro de reportes" antes que cada
    // pantalla suelta del grupo Reportes).
    var relevancia = function (p) {
      var n = normalizar_(p.nombre);
      if (n.indexOf(q) === 0) return 0;
      if (n.split(/\s+/).some(function (w) { return w.indexOf(q) === 0; })) return 1;
      return n.indexOf(q) !== -1 ? 2 : 3;
    };
    var pantallas = pantallasDeLaCuenta_().filter(function (p) {
      return q ? normalizar_(p.nombre + ' ' + p.ruta).indexOf(q) !== -1 : !p.item;
    });
    if (q) {
      pantallas.sort(function (a, b) { return relevancia(a) - relevancia(b); });
      pantallas = pantallas.slice(0, 8);
    }
    if (pantallas.length) {
      html += '<div class="sx2-paleta__grupo">Ir a</div>' + pantallas.map(function (p) {
        return itemPaletaHtml_({ accion: p.item ? 'item' : 'ir', modulo: p.modulo, item: p.item, icono: p.icono, titulo: p.nombre, detalle: p.ruta });
      }).join('');
    }

    var conBandeja = modulosDeLaCuenta_().indexOf('bandeja') !== -1;
    var solicitudes = q && conBandeja
      ? ultimosRecientes_.filter(function (s) {
          return normalizar_(s.solicitud_id).indexOf(q) !== -1 ||
            normalizar_(s.empresa_id).indexOf(q) !== -1 ||
            normalizar_(s.modulo).indexOf(q) !== -1;
        }).slice(0, 6).map(function (s) {
          return { id: s.solicitud_id, detalle: [s.empresa_id, s.modulo].filter(Boolean).join(' · ') };
        })
      : [];
    // Un N° completo que no está entre las recientes igual se puede abrir: la
    // Bandeja pide su detalle y el backend decide si la cuenta puede verla.
    if (conBandeja && PATRON_SOLICITUD_.test(crudo) &&
        !solicitudes.some(function (s) { return normalizar_(s.id) === q; })) {
      solicitudes.unshift({ id: crudo.toUpperCase(), detalle: 'Abrir esta solicitud' });
    }
    if (solicitudes.length) {
      html += '<div class="sx2-paleta__grupo">Solicitudes</div>' + solicitudes.map(function (s) {
        return itemPaletaHtml_({ accion: 'solicitud', id: s.id, icono: 'documento', titulo: s.id, detalle: s.detalle });
      }).join('');
    }

    if (!html) {
      html = '<div class="sx2-paleta__vacio">Nada coincide con «' + UIv2.esc(crudo) + '».</div>';
    }
    cont.innerHTML = html;
    marcarSeleccionPaleta_(itemsPaleta_());
  }

  function abrirSolicitudDesdePaleta_(id) {
    mostrarModulo_('bandeja');
    if (window.SigsoBandejaV2 && SigsoBandejaV2.abrirSolicitud) SigsoBandejaV2.abrirSolicitud(id);
  }

  // Atajos de teclado: los de una letra se ignoran mientras el foco está en
  // un campo de texto (para no interceptar mientras se escribe).
  var esperandoG_ = false;
  var temporizadorG_ = null;

  function enCampoDeTexto_(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function wireAtajos_() {
    var btnCerrarAtajos = document.getElementById('btn-cerrar-atajos');
    if (btnCerrarAtajos) {
      document.getElementById('ico-cerrar-atajos').innerHTML = Iconos.svg('equis', { tam: 16 });
      btnCerrarAtajos.addEventListener('click', cerrarAtajos_);
      document.getElementById('atajos-telon').addEventListener('click', cerrarAtajos_);
    }
    // Manuales de uso (2026-10-06): todos los que corresponden a tu cuenta.
    var manuales = document.getElementById('btn-menu-manuales');
    if (manuales) {
      document.getElementById('ico-manuales').innerHTML = Iconos.svg('libro', { tam: 15 });
      manuales.addEventListener('click', function () {
        document.getElementById('menu-usuario').classList.add('sigso-oculto');
        document.getElementById('btn-menu-usuario').setAttribute('aria-expanded', 'false');
        if (window.SigsoManual) SigsoManual.centro();
      });
    }
    var desdeMenu = document.getElementById('btn-menu-atajos');
    if (desdeMenu) {
      document.getElementById('ico-atajos').innerHTML = Iconos.svg('info', { tam: 15 });
      desdeMenu.addEventListener('click', function () {
        document.getElementById('menu-usuario').classList.add('sigso-oculto');
        document.getElementById('btn-menu-usuario').setAttribute('aria-expanded', 'false');
        abrirAtajos_();
      });
    }

    document.addEventListener('keydown', function (evento) {
      if (document.getElementById('vista-shell').hidden) return; // acceso: sin buscador ni atajos

      // Ctrl/Cmd+K abre el buscador desde cualquier parte, incluso con foco
      // en un campo de texto (es la convención de la industria).
      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'k') {
        evento.preventDefault();
        abrirPaleta_();
        return;
      }
      if (evento.key === 'Escape') {
        if (paletaAbierta_()) cerrarPaleta_();
        else if (atajosAbiertos_()) cerrarAtajos_();
        else if (tourAbierto_()) cerrarTour_();
        return;
      }
      if (paletaAbierta_() || atajosAbiertos_() || tourAbierto_()) return;
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
        var buscador = document.querySelector('#modulo-bandeja .js-bj2-buscar');
        if (buscador && buscador.getClientRects().length) {
          evento.preventDefault();
          buscador.focus();
        }
      }
    });
  }

  function atajosAbiertos_() { return !document.getElementById('panel-atajos').hidden; }

  function abrirAtajos_() {
    cerrarPaleta_();
    document.getElementById('panel-atajos').hidden = false;
    document.getElementById('btn-cerrar-atajos').focus();
  }

  function cerrarAtajos_() {
    document.getElementById('panel-atajos').hidden = true;
  }

  function modulosDeLaCuenta_() {
    // La sesion puede no haber cargado todavia (o el backend no responder).
    // Sin esta guarda, renderNavAhora_ moria con una excepcion y el sidebar
    // quedaba VACIO: la persona no veia ni Inicio para reintentar.
    var cuenta = (sesion && sesion.cuenta) || {};
    var propios = (cuenta.modulos || []).filter(function (m) { return MODULOS_SHELL[m] && !esDepartamento_(m) && m !== 'finanzas' && m !== 'credenciales'; })
      .concat((cuenta.departamentos || []).filter(esDepartamento_));
    // Quien es jefatura de un área tiene "Mi equipo" dentro de ella: el módulo
    // suelto "Mi departamento" queda para las jefaturas sin área (2026-10-03).
    if ((cuenta.jefatura_de || []).length) propios = propios.filter(function (m) { return m !== 'jefatura'; });
    // Finanzas: solo la lista fija de la bóveda (la sesión trae cuenta.finanzas).
    if (cuenta.finanzas === true) propios.push('finanzas');
    if (cuenta.credenciales === true) propios.push('credenciales');
    // Solicitudes, etapa 2: quien está en la lista de un departamento recibe
    // sus pedidos en la Bandeja (la cola del área), tenga o no el módulo.
    if ((cuenta.colas_solicitudes || []).length && propios.indexOf('bandeja') === -1) propios.push('bandeja');
    // v6.5: "novedades" es core -- se agrega siempre, aunque la cuenta no lo
    // tenga en su lista asignada. Justo despues de home (primera posicion
    // entre los internos) porque es lo que se quiere que se vea primero.
    if (propios.indexOf('novedades') === -1) propios = ['novedades'].concat(propios);
    return propios;
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
  // 2026-10-06 (barra «Bloques»): tres grupos. «Mis solicitudes» y «Pausas
  // activas» salen del riel y viven en el panel de Inicio (FUERA_DEL_RIEL).
  var GRUPOS_SIDEBAR = [
    { titulo: 'Mi espacio', modulos: ['home', 'novedades', 'mi_trabajo', 'bandeja'] },
    // Cada persona ve solo su(s) área(s); el orden es el del organigrama.
    { titulo: 'Áreas', modulos: IDS_DEPARTAMENTO.concat(['hompy', 'proyectos', 'jefatura', 'gerencia', 'pausas_coordinacion', 'calidad']) },
    { titulo: 'Sistema', modulos: ['administracion'] }
  ];
  var FUERA_DEL_RIEL = ['mis_solicitudes', 'pausas'];

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

  // 2026-10-05: la barra es riel + panel (barra-lateral.js). "Nueva solicitud"
  // sale del riel: es una acción, va como botón arriba del panel.
  function renderNavAhora_() {
    if (!window.SigsoBarra) return;
    var grupoDe = {};
    GRUPOS_SIDEBAR.forEach(function (g) { g.modulos.forEach(function (id) { grupoDe[id] = g.titulo; }); });
    var modulos = [{ id: 'home', nombre: 'Inicio', corto: 'Inicio', titulo: 'Inicio', icono: 'inicio', grupo: '', desc: 'Lo tuyo, tus atajos y lo pendiente de todos tus módulos', acento: 'var(--mod-inicio)' }]
      .concat(modulosDeLaCuenta_().filter(function (id) { return id !== 'nueva_solicitud'; }).map(function (id) {
        var def = MODULOS_SHELL[id];
        var color = MODULO_COLOR[id];
        return { id: id, nombre: def.nombre, corto: def.corto, titulo: def.titulo, icono: def.icono, grupo: grupoDe[id] || '', acento: color ? color.acento : '', desc: def.descripcion || '' };
      }));
    SigsoBarra.actualizar({
      modulos: modulos,
      grupos: GRUPOS_SIDEBAR,
      fueraDelRiel: FUERA_DEL_RIEL,
      volverAreas: function () { if (volverAreasBarra_) volverAreasBarra_(); },
      moduloActivo: moduloActivo_,
      itemActivo: itemActivoDelModulo_,
      accion: puedeAbrirModulo_('nueva_solicitud') ? { modulo: 'nueva_solicitud', texto: 'Nueva solicitud', icono: 'nueva', ir: function () { mostrarModulo_('nueva_solicitud'); } } : null,
      onModulo: function (id) { if (id !== moduloActivo_) mostrarModulo_(id); },
      onItem: irAItemArbol_,
      // Los módulos con menú propio (aunque todavía no lo hayan registrado al hacer clic).
      conMenu: function (id) { return !!IR_A_ITEM_POR_MODULO[id]; },
      alNavegar: function () { if (alNavegarBarra_) alNavegarBarra_(); },
      abrirMenu: function (mismo) { if (abrirMenuBarra_) abrirMenuBarra_(mismo); }
    });
  }
  // Los define wireSidebar_: cerrar el cajón (celular) o el menú flotante (barra angosta).
  var alNavegarBarra_ = null;
  var abrirMenuBarra_ = null;
  var volverAreasBarra_ = null;

  // Cada módulo expone cómo ir a una de sus secciones. Se busca por convención
  // (SigsoX.irAItem) para no tener que enumerarlos acá y que agregar un módulo
  // nuevo no obligue a tocar el shell.
  var IR_A_ITEM_POR_MODULO = {
    calidad: function (id) { return window.SigsoCalidad && window.SigsoCalidad.irAItem && window.SigsoCalidad.irAItem(id); },
    administracion: function (id) { return window.SigsoAdmin && window.SigsoAdmin.irAItem && window.SigsoAdmin.irAItem(id); },
    gerencia: function (id) { return window.SigsoGerencia && window.SigsoGerencia.irAItem && window.SigsoGerencia.irAItem(id); },
    jefatura: function (id) { return window.SigsoJefatura && window.SigsoJefatura.irAItem && window.SigsoJefatura.irAItem(id); },
    proyectos: function (id) { var m = moduloProyectos_(); return m && m.irAItem && m.irAItem(id); },
    novedades: function (id) { return window.SigsoNovedades && window.SigsoNovedades.irAItem && window.SigsoNovedades.irAItem(id); },
    pausas_coordinacion: function (id) { return window.SigsoCoordinacion && window.SigsoCoordinacion.irAItem && window.SigsoCoordinacion.irAItem(id); },
    hompy: function (id) { return window.SigsoHompy && window.SigsoHompy.irAItem(id); }
  };
  IDS_DEPARTAMENTO.forEach(function (dep) { IR_A_ITEM_POR_MODULO[dep] = function (id) { var m = moduloDepartamento_(dep); return m && m.irAItem(id); }; });

  // Ir a una sección de un árbol (sidebar y buscador). Si es de OTRO módulo,
  // primero se abre: el módulo consume la ruta al montarse (tomarItemDeRuta).
  function irAItemArbol_(moduloId, itemId) {
    if (moduloId !== moduloActivo_) {
      itemPendienteDeRuta_ = itemId;
      mostrarModulo_(moduloId);
      return;
    }
    irAItemDelModuloActivo_(moduloId, itemId);
  }

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
      pintarBadge_(id, badgesRecordados_[id].n, badgesRecordados_[id].tono);
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

  // Inicio se pinta al entrar y, desde SIGSO v2 (módulo 2), también cada vez
  // que se vuelve a él: antes mostraba los números del momento del login
  // hasta el siguiente auto-refresco (volvías de confirmar una fecha en Mi
  // trabajo y el Inicio seguía pidiéndotela).
  var ultimoRenderHome_ = 0;
  function renderHome_() {
    ultimoRenderHome_ = Date.now();
    var inicio = moduloImpl_('home');
    if (inicio) {
      inicio.render({
        cuenta: sesion.cuenta,
        token: sesion.token,
        modulos: modulosDeLaCuenta_(),
        irAModulo: function (id) { mostrarModulo_(id); },
        pintarBadge: pintarBadge_,
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
      envoltura.className = 'sx2-clave';
      input.parentNode.insertBefore(envoltura, input);
      envoltura.appendChild(input);

      var boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'sx2-clave__ver';
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

  // 2026-10-05 (decisión 4): cada contador dice QUÉ tan urgente es. Lo que el
  // módulo no indica toma el tono de lo que cuenta: la Bandeja cuenta lo que
  // venció su plazo (rojo), Mis solicitudes lo que espera tu validación
  // (ámbar) y Novedades lo que falta leer (gris).
  var TONO_CONTADOR = { bandeja: 'rojo', mis_solicitudes: 'ambar', mi_trabajo: 'ambar', novedades: 'gris' };
  function pintarBadge_(modulo, cantidad, tono) {
    var t = tono || TONO_CONTADOR[modulo] || 'ambar';
    badgesRecordados_[modulo] = { n: Number(cantidad) || 0, tono: t };
    if (window.SigsoBarra) SigsoBarra.badge(modulo, cantidad, t);
  }

  // Modulos "de trabajo" (tablas, dashboard, detalle de 3 columnas): necesitan
  // el contenedor ancho, como app.html. Los demas (formulario, mis
  // solicitudes) se leen mejor angostos y centrados -- por eso el ancho del
  // <main> se adapta al modulo en vez de ser fijo.
  var MODULOS_ANCHOS = ['bandeja', 'gerencia', 'jefatura', 'administracion', 'proyectos', 'calidad', 'hompy', 'finanzas'].concat(IDS_DEPARTAMENTO);

  // SIGSO v2 (documentacion/SIGSO-v2-hoja-de-ruta.md). Desde el 2026-09-25 la
  // versión clásica está retirada: cada módulo tiene UNA implementación, la v2.
  var MODULOS_V2 = {
    proyectos: function () { return window.SigsoProyectosV2; },
    mi_trabajo: function () { return window.SigsoMiTrabajoV2; },
    // Inicio no es un módulo con cargar(): se pinta con render(ctx) desde renderHome_.
    home: function () { return window.SigsoInicioV2; },
    bandeja: function () { return window.SigsoBandejaV2; },
    mis_solicitudes: function () { return window.SigsoMisSolicitudesV2; },
    nueva_solicitud: function () { return window.SigsoNuevaSolicitudV2; },
    gerencia: function () { return window.SigsoGerenciaV2; },
    jefatura: function () { return window.SigsoJefaturaV2; },
    pausas_coordinacion: function () { return window.SigsoCoordinacionV2; },
    pausas: function () { return window.SigsoPausasV2; },
    novedades: function () { return window.SigsoNovedadesV2; },
    administracion: function () { return window.SigsoAdminV2; },
    calidad: function () { return window.SigsoCalidadV2; }
  };
  IDS_DEPARTAMENTO.forEach(function (id) { MODULOS_V2[id] = function () { return moduloDepartamento_(id); }; });
  function usaV2_(id) { return !!(MODULOS_V2[id] && MODULOS_V2[id]()); }
  function moduloImpl_(id) { return MODULOS_V2[id] ? MODULOS_V2[id]() : null; }
  function moduloProyectos_() { return moduloImpl_('proyectos'); }
  // Pantalla completa para los módulos v2.
  function actualizarModuloV2_(id) {
    var main = document.querySelector('#vista-shell .sigso-contenido');
    if (main) main.classList.toggle('plataforma-contenido--total', usaV2_(id));
  }
  // Quien había elegido la clásica tenía la preferencia guardada: se limpia.
  try {
    Object.keys(localStorage).forEach(function (k) { if (/^sigso_[a-z_]+_v2$/.test(k)) localStorage.removeItem(k); });
  } catch (e) { /* sin storage */ }

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

  // SIGSO v2, Módulo 9B: botón "Buscar" del sidebar y barra inferior del
  // celular (Inicio · Mi trabajo · Buscar · Menú).
  function wireShellV2_() {
    var btn = document.getElementById('btn-shell-buscar');
    if (btn) {
      document.getElementById('ico-shell-buscar').innerHTML = Iconos.svg('lupa', { tam: 16 });
      if (/Mac|iPhone|iPad/.test(navigator.platform || '')) {
        var k = btn.querySelector('kbd');
        if (k) k.textContent = '⌘K';
      }
      btn.addEventListener('click', abrirPaleta_);
    }
    var barra = document.getElementById('shell-barra');
    if (barra) {
      barra.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-barra]');
        if (!b) return;
        var dest = b.getAttribute('data-barra');
        if (dest === 'buscar') { abrirPaleta_(); return; }
        if (dest === 'menu') { var h = document.getElementById('btn-abrir-sidebar'); if (h) h.click(); return; }
        if (puedeAbrirModulo_(dest)) mostrarModulo_(dest);
      });
    }
  }
  // El segundo destino es "Mi trabajo" si la cuenta lo tiene; si no, sus solicitudes.
  function pintarBarraInferior_(activo) {
    var barra = document.getElementById('shell-barra');
    if (!barra) return;
    var segundo = puedeAbrirModulo_('mi_trabajo') ? { id: 'mi_trabajo', texto: 'Mi trabajo', icono: 'tareas' }
      : { id: 'mis_solicitudes', texto: 'Solicitudes', icono: 'lista' };
    var items = [{ id: 'home', texto: 'Inicio', icono: 'inicio' }, segundo,
      { id: 'buscar', texto: 'Buscar', icono: 'lupa' }, { id: 'menu', texto: 'Menú', icono: 'menu' }];
    barra.innerHTML = items.map(function (it) {
      var on = it.id === activo;
      return '<button type="button" class="shell-barra__item' + (on ? ' shell-barra__item--activo' : '') + '" data-barra="' + it.id + '"' +
        (on ? ' aria-current="page"' : '') + '>' + Iconos.svg(it.icono, { tam: 20 }) + '<span>' + it.texto + '</span></button>';
    }).join('');
  }

  function mostrarModulo_(id) {
    moduloActivo_ = id;
    pintarBarraInferior_(id);
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
      // Barra lateral, segunda versión (cambio 4): el encabezado de cada página lleva el ícono del módulo.
      var defIco = MODULOS_SHELL[id] && MODULOS_SHELL[id].icono;
      var trazo = defIco && window.Iconos ? /<svg[^>]*>([\s\S]*)<\/svg>/.exec(Iconos.svg(defIco, { tam: 24 })) : null;
      if (trazo) {
        main.style.setProperty('--sx-mod-ico', 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" ' +
          'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + trazo[1] + '</svg>') + '")');
      } else main.style.removeProperty('--sx-mod-ico');
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
    if (window.SigsoBarra) SigsoBarra.visita(id, '');
    renderNav_();

    if (id === 'home' && Date.now() - ultimoRenderHome_ > 3000) renderHome_();
    if (id === 'mis_solicitudes') {
      moduloImpl_('mis_solicitudes').cargar();
    }
    if (id === 'nueva_solicitud') {
      moduloImpl_('nueva_solicitud').cargar();
      autocompletarFormulario_();
    }
    if (id === 'bandeja') {
      moduloImpl_('bandeja').cargar();
    }
    if ((id === 'gerencia' || id === 'jefatura') && window.SigsoBandejaV2) window.SigsoBandejaV2.desmontar();
    if (id !== 'gerencia' && window.SigsoGerenciaV2) window.SigsoGerenciaV2.desmontar();
    if (id !== 'jefatura' && window.SigsoJefaturaV2) window.SigsoJefaturaV2.desmontar();
    if (id === 'gerencia') {
      // R6: el Panel de gerencia es 100 % v2 (gerencia-v2.js + gerencia-vistas-v2.js).
      if (window.SigsoGerencia) window.SigsoGerencia.cargar();
    }
    if (id === 'jefatura') {
      // R5: Mi departamento es 100 % v2 (jefatura-vistas-v2.js). Si venía
      // pintándose dentro de un departamento, vuelve a su lugar.
      if (window.SigsoJefatura && window.SigsoJefatura.soltar) window.SigsoJefatura.soltar();
      if (window.SigsoJefatura) window.SigsoJefatura.cargar();
    }
    if (id === 'administracion') {
      abrirAdministracion_();
    }
    // Finanzas: sin auto-refresco a propósito (mantendría la bóveda abierta).
    if (id === 'finanzas' && window.SigsoFinanzas) window.SigsoFinanzas.cargar();
    if (id === 'credenciales' && window.SigsoCredenciales) window.SigsoCredenciales.cargar();
    if (id === 'hompy' && window.SigsoHompy) window.SigsoHompy.cargar();
    if (id === 'pausas' && moduloImpl_('pausas')) {
      moduloImpl_('pausas').cargar();
    }
    if (id === 'pausas_coordinacion' && window.SigsoCoordinacion) {
      window.SigsoCoordinacion.cargar();
    }
    if (id === 'novedades' && window.SigsoNovedades) {
      window.SigsoNovedades.cargar();
    }
    if (id === 'mi_trabajo' && moduloImpl_('mi_trabajo')) {
      moduloImpl_('mi_trabajo').cargar();
    }
    if (id === 'proyectos' && moduloProyectos_()) {
      moduloProyectos_().cargar();
    }
    actualizarModuloV2_(id);
    if (id === 'calidad') {
      abrirCalidad_();
    }
    if (esDepartamento_(id) && moduloDepartamento_(id)) {
      moduloDepartamento_(id).cargar();
    }
    window.scrollTo(0, 0);
  }

  // Calidad y Administración son v2 y se cargan con la página (sin la
  // carga diferida de calidad.js ni la compuerta del Backoffice por token de
  // Apps Script: todo lo que la plataforma llama ya corre en Node).
  function abrirCalidad_() {
    if (window.SigsoCalidad) window.SigsoCalidad.cargar();
  }

  function abrirAdministracion_() {
    if (window.SigsoAdmin) window.SigsoAdmin.abrir();
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

  // Las cuatro vistas de acceso comparten #acceso (un solo panel de marca):
  // se ve #acceso solo cuando la vista pedida es una de ellas.
  var VISTAS_ACCESO_ = ['vista-login', 'vista-recuperar', 'vista-restablecer', 'vista-cambiar-clave'];
  function mostrarVista_(id) {
    VISTAS_ACCESO_.concat(['vista-cargando', 'vista-shell']).forEach(function (vista) {
      var el = document.getElementById(vista);
      if (el) el.hidden = vista !== id;
    });
    var acceso = document.getElementById('acceso');
    var esAcceso = VISTAS_ACCESO_.indexOf(id) !== -1;
    if (acceso) acceso.hidden = !esAcceso;
    if (esAcceso) {
      var primero = document.querySelector('#' + id + ' input:not([type=hidden])');
      if (primero) primero.focus();
    }
  }

  // Mensaje de un formulario de acceso: '' lo oculta. Por textContent (el
  // texto puede venir del servidor).
  function mensajeAcceso_(el, texto, tipo) {
    if (!el) return;
    el.textContent = texto || '';
    el.className = 'sx2-acceso__msg sx2-tono-' + (tipo === 'exito' ? 'ok' : 'critico');
    el.hidden = !texto;
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
