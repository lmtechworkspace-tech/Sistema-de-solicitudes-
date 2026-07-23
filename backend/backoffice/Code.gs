/**
 * Code.gs — App Gestion (Backoffice)
 *
 * Se publica con "Ejecutar como: usuario que accede" y acceso "Cualquier
 * cuenta de Google" o "Dominio" segun el Workspace real (§2.1, §3.1).
 * Google ya bloquea a quien no pertenece al dominio/no tiene cuenta antes
 * de llegar aqui; igual se valida la identidad de forma defensiva porque
 * no existe token de sesion propio que revisar.
 *
 * Mismo contrato de transporte que Intake: POST + text/plain + JSON;
 * ninguna llamada agrega headers custom ni usa application/json (§4.1).
 * Esto sigue valiendo para llamadas externas (p.ej. otra integracion), pero
 * `app.html`/`admin.html` (Fase 8, ver notas de despliegue) ya NO llaman
 * por fetch: los navegadores bloquean cada vez mas agresivo las cookies de
 * terceros necesarias para autenticar un fetch cross-origin contra un Web
 * App no anonimo, asi que esas paginas ahora las sirve este mismo proyecto
 * via HtmlService (mismo origen) y llaman a `ejecutarAccionBackoffice`
 * mediante `google.script.run` (sin red, sin cookies, sin CORS).
 *
 * Fase 0: transporte, router y resolucion de identidad. Fase 2: resolucion
 * de rol (USUARIOS) y maquina de estados/prioridad. Fase 5: getDashboardData,
 * getSolicitudDetalle y agregarComentario. Fase 6: guardarCatalogo y
 * gestionarUsuario (administracion) ya llaman logica real -- todas las
 * acciones del router (§4.2) estan conectadas desde esta fase.
 */

var BACKOFFICE_ACTIONS = {
  ping: handlePing_,
  getDashboardData: handleGetDashboardData_,
  // v5.2 (Fase B, §3.4): pauta de trabajo por lote (PDF) de un desarrollador.
  getPautaTrabajo: handleGetPautaTrabajo_,
  // v5.2 (mejora OT): genera la Orden de Trabajo en PDF del lado del servidor
  // (con imagenes embebidas y enlaces reales) y la devuelve en base64.
  descargarOrdenTrabajo: handleDescargarOrdenTrabajo_,
  getPanelGerencia: handleGetPanelGerencia_,
  // v5.2 (§4.2): envio manual del reporte ejecutivo, solo ADM.
  enviarReporteGerenciaAhora: handleEnviarReporteGerenciaAhora_,
  // v4.2: panel de Jefatura (solo lectura, acotado al equipo).
  getPanelJefatura: handleGetPanelJefatura_,
  getSolicitudDetalle: handleGetSolicitudDetalle_,
  actualizarEstado: handleActualizarEstado_,
  actualizarPrioridad: handleActualizarPrioridad_,
  comprometerFecha: handleComprometerFecha_,
  derivarSolicitud: handleDerivarSolicitud_,
  agregarComentario: handleAgregarComentario_,
  guardarCatalogo: handleGuardarCatalogo_,
  listarCatalogo: handleListarCatalogo_,
  gestionarUsuario: handleGestionarUsuario_,
  // v3.3: cuentas de la plataforma (CuentasPortal.gs, solo ADM).
  listarCuentasPortal: handleListarCuentasPortal_,
  gestionarCuentaPortal: handleGestionarCuentaPortal_,
  listarUsuarios: handleListarUsuarios_,
  listarLogs: handleListarLogs_,
  // v4.2: relaciones jefe->subordinado (Jefatura.gs, solo ADM las edita).
  listarJefaturas: handleListarJefaturas_,
  gestionarJefatura: handleGestionarJefatura_
};

// ?page=app / ?page=admin sirve la UI real (Fase 8); sin ese parametro se
// mantiene el health-check JSON de siempre (usado por monitoreo/tests).
var PAGINAS_HTML = { app: 'App', admin: 'Admin' };

// v3.3 P3 (SIGSO-v3.3-propuesta-plataforma-modular.md §2.3): que modulo de
// la plataforma exige cada accion. Solo aplica a contextos de PORTAL (token):
// el camino Google (Session) mantiene su autorizacion por rol de siempre.
// Esta es la mitad backend de "el shell esconde botones": esconder no
// protege nada -- aqui se rechaza aunque manipulen el navegador.
var MODULO_POR_ACCION = {
  getDashboardData: 'bandeja',
  getPautaTrabajo: 'bandeja',
  descargarOrdenTrabajo: 'bandeja',
  // Ver el detalle es de lectura y Gerencia ya lo necesita desde su propio
  // panel (Solicitudes.getDetalle ya le devuelve una version de solo lectura
  // -- sin transiciones ni responsables -- para el rol GERENCIA). Por eso
  // acepta CUALQUIERA de los dos modulos, a diferencia del resto de acciones
  // de bandeja, que siguen exigiendo 'bandeja' exclusivamente.
  // v4.2: Jefatura tambien necesita el detalle de solo lectura desde su
  // propio panel, igual que Gerencia (getDetalle ya valida por su cuenta
  // que la solicitud pertenezca al equipo del jefe, ver Solicitudes.gs).
  getSolicitudDetalle: ['bandeja', 'gerencia', 'jefatura'],
  actualizarEstado: 'bandeja',
  actualizarPrioridad: 'bandeja',
  comprometerFecha: 'bandeja',
  derivarSolicitud: 'bandeja',
  agregarComentario: 'bandeja',
  getPanelGerencia: 'gerencia',
  // v5.2 (§4.2): el boton vive en el panel de Gerencia, pero Notificaciones.
  // enviarReporteEjecutivoAhora ya rechaza a cualquiera que no sea ADM --
  // esto solo exige el modulo (mismo criterio que el resto de "gerencia").
  enviarReporteGerenciaAhora: 'gerencia',
  getPanelJefatura: 'jefatura',
  guardarCatalogo: 'administracion',
  listarCatalogo: 'administracion',
  gestionarUsuario: 'administracion',
  listarUsuarios: 'administracion',
  listarLogs: 'administracion',
  listarCuentasPortal: 'administracion',
  gestionarCuentaPortal: 'administracion',
  listarJefaturas: 'administracion',
  gestionarJefatura: 'administracion'
  // ping: sin modulo -- cualquier sesion valida.
};

function doGet(e) {
  var pagina = e && e.parameter && e.parameter.page;
  var archivo = PAGINAS_HTML[pagina];
  if (archivo) {
    return HtmlService.createHtmlOutputFromFile(archivo)
      .setTitle('SIGSO - ' + (pagina === 'admin' ? 'Administracion' : 'Backoffice'))
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return jsonResponse_({ ok: true, data: { servicio: 'SIGSO Backoffice', estado: 'activo' } });
}

function doPost(e) {
  try {
    // v3.3 P3: el body se parsea ANTES de resolver identidad, porque el
    // token de la plataforma viaja en el body (portal_token). El contrato de
    // transporte no cambia (POST text/plain, sin headers custom, §4.1).
    var body = parseRequestBody_(e);
    var handler = BACKOFFICE_ACTIONS[body.action];
    if (!handler) {
      return jsonResponse_({
        ok: false,
        error: 'validation',
        message: 'Accion desconocida: ' + body.action,
        fields: ['action']
      });
    }

    var resuelto = resolverIdentidadYRol_(body.data && body.data.portal_token, body.action);
    if (resuelto.error) {
      return jsonResponse_(resuelto.error);
    }
    return handler(body.data || {}, resuelto.contexto);
  } catch (err) {
    var ref = logError_(err, 'Backoffice.doPost');
    // Backoffice es solo-staff: se incluye el motivo real para que el error
    // se vea en pantalla y no haya que entrar a los logs para diagnosticar.
    return jsonResponse_({ ok: false, error: 'internal', ref: ref, message: 'Error interno: ' + mensajeError_(err) });
  }
}

// Motivo corto y legible de una excepcion, para mostrarlo en pantalla.
function mensajeError_(err) {
  return String(err && err.message ? err.message : err).slice(0, 300);
}

// Puente para app.html/admin.html servidos via HtmlService (Fase 8):
// mismo router y misma resolucion de identidad/rol que doPost, pero
// invocado por google.script.run (sin red) en vez de un POST. Devuelve el
// objeto plano (no un ContentService) porque google.script.run serializa
// el valor de retorno directamente.
function ejecutarAccionBackoffice(action, data) {
  try {
    var resuelto = resolverIdentidadYRol_();
    if (resuelto.error) {
      return resuelto.error;
    }

    var handler = BACKOFFICE_ACTIONS[action];
    if (!handler) {
      return { ok: false, error: 'validation', message: 'Accion desconocida: ' + action, fields: ['action'] };
    }
    var salida = handler(data || {}, resuelto.contexto);
    return JSON.parse(salida.getContent());
  } catch (err) {
    var ref = logError_(err, 'Backoffice.ejecutarAccionBackoffice:' + action);
    return { ok: false, error: 'internal', ref: ref, message: 'Error interno: ' + mensajeError_(err) };
  }
}

// Compartido por doPost y ejecutarAccionBackoffice: resuelve email+rol o
// devuelve el objeto de error listo para responder (evita repetir la
// misma validacion en los dos puntos de entrada).
//
// v3.3 P3: dos caminos de identidad. Si viene un token de la plataforma, la
// identidad sale de CUENTAS_PORTAL/SESIONES_PORTAL y SOLO de ahi -- un token
// invalido NUNCA cae al camino de Session (si lo hiciera, en la
// implementacion "ejecutar como yo / cualquiera" un token vencido podria
// heredar la identidad equivocada). Sin token, el camino Google de siempre.
function resolverIdentidadYRol_(portalToken, action) {
  if (portalToken) {
    return resolverContextoPortal_(portalToken, action);
  }
  var email = getIdentidadActiva_();
  if (!email) {
    return { error: { ok: false, error: 'forbidden', message: 'No fue posible resolver la identidad del dominio.' } };
  }
  var rol = obtenerRolUsuario_(email);
  if (!rol) {
    return {
      error: {
        ok: false,
        error: 'forbidden',
        message: 'El usuario ' + email + ' no esta registrado o esta inactivo en SIGSO.'
      }
    };
  }
  // RN-029: Auth.suspenderInactivos() (Fase 7) decide en base a este campo;
  // sin registrarlo aqui, todos los usuarios activos se verian "inactivos".
  actualizarFilaPorId_(SHEETS.USUARIOS, 'email', email, { ultimo_acceso: new Date().toISOString() });
  return { contexto: { email: email, rol: rol } };
}

// v3.3 P3: identidad desde una sesion de la plataforma. La hoja es la
// verdad: token vigente + cuenta activa + modulo requerido por la accion.
function resolverContextoPortal_(token, action) {
  var forbidden = {
    error: { ok: false, error: 'forbidden', message: 'Sesion invalida o expirada. Ingresa de nuevo a la plataforma.' }
  };

  var sesion = leerFilasSeguro_(SHEETS.SESIONES_PORTAL).filter(function (s) {
    return s.token === token;
  })[0];
  if (!sesion || new Date(sesion.expira).getTime() <= Date.now()) {
    return forbidden;
  }

  var cuenta = leerFilasSeguro_(SHEETS.CUENTAS_PORTAL).filter(function (c) {
    var activa = c.activo === true || c.activo === 'TRUE' || c.activo === 1;
    return c.cuenta_id === sesion.cuenta_id && activa;
  })[0];
  if (!cuenta) {
    return forbidden;
  }

  var modulos = parsearListaPortal_(cuenta.modulos);
  var requerido = MODULO_POR_ACCION[action];
  if (requerido) {
    // La mayoria de las acciones piden UN modulo (string); getSolicitudDetalle
    // acepta una lista (basta con tener alguno de los dos).
    var requeridos = Array.isArray(requerido) ? requerido : [requerido];
    var tieneAlguno = requeridos.some(function (m) { return modulos.indexOf(m) !== -1; });
    if (!tieneAlguno) {
      return {
        error: { ok: false, error: 'forbidden', message: 'Tu cuenta no tiene acceso a este modulo (' + requeridos.join(' o ') + ').' }
      };
    }
  }

  var emails = parsearListaPortal_(cuenta.emails);
  // El PRIMER correo de la cuenta es el "correo de trabajo": es el que se
  // compara con desarrollador_asignado (bandeja propia del DEV) y el que
  // queda en historiales como autor. Documentado en la seccion de cuentas
  // del admin.
  //
  // Normalizacion de rol: los checks del Backoffice conocen ANA/DEV/ADM/
  // GERENCIA. Una cuenta SOLICITANTE a la que el Admin le dio "bandeja" se
  // trata como DEV (el rol mas restringido con escritura: solo su propio
  // trabajo) -- sin esto pasaria los checks pensados para ANA/ADM.
  var rol = cuenta.rol === 'SOLICITANTE' ? 'DEV' : cuenta.rol;

  actualizarFilaPorId_(SHEETS.CUENTAS_PORTAL, 'cuenta_id', cuenta.cuenta_id, {
    ultimo_acceso: new Date().toISOString()
  });

  return { contexto: { email: emails[0] || '', rol: rol, modulos: modulos, via_portal: true } };
}

function leerFilasSeguro_(hoja) {
  try {
    return leerFilas_(hoja);
  } catch (err) {
    return []; // instalacion sin las hojas del portal
  }
}

// parsearListaPortal_ vive en CuentasPortal.gs (mismo scope del proyecto).

function getIdentidadActiva_() {
  var email = Session.getActiveUser().getEmail();
  return email || null;
}

// §3.1: la autorizacion es por rol, leido de USUARIOS (email -> rol activo).
// Devuelve null si el email no esta registrado o esta inactivo (RN-029).
function obtenerRolUsuario_(email) {
  var filas = leerFilas_(SHEETS.USUARIOS);
  for (var i = 0; i < filas.length; i++) {
    var esActivo = filas[i].activo === true || filas[i].activo === 'TRUE' || filas[i].activo === 1;
    if (filas[i].email === email && esActivo) {
      return filas[i].rol;
    }
  }
  return null;
}

function handlePing_(data, contexto) {
  return jsonResponse_({
    ok: true,
    data: {
      pong: true,
      ts: new Date().toISOString(),
      tz: getConfig_().timezone,
      usuario: contexto.email,
      rol: contexto.rol
    }
  });
}

function handleActualizarEstado_(data, contexto) {
  var resultado = Solicitudes.actualizarEstado(data, contexto);
  return responderResultado_(resultado);
}

function handleActualizarPrioridad_(data, contexto) {
  var resultado = Solicitudes.actualizarPrioridad(data, contexto);
  return responderResultado_(resultado);
}

function handleComprometerFecha_(data, contexto) {
  var resultado = Solicitudes.comprometerFecha(data, contexto);
  return responderResultado_(resultado);
}

// v3.1 (§2.2): la reasignacion era alcanzable de forma lateral desde
// actualizarPrioridad; aqui pasa a ser una accion propia, con registro y
// aviso. Ese camino viejo se mantiene por compatibilidad.
function handleDerivarSolicitud_(data, contexto) {
  return responderResultado_(Solicitudes.derivarSolicitud(data, contexto));
}

function handleGetDashboardData_(data, contexto) {
  return jsonResponse_({ ok: true, data: Dashboard.getData(data, contexto) });
}

// v2.1 (Fase C): Panel de Control de Gerencia (documentacion/SIGSO-v2.1-
// plazos-y-control.md §7). Solo lectura, como el resto del Dashboard --
// cualquier rol autenticado puede pedirlo (la UI solo lo ofrece a GERENCIA).
function handleGetPanelGerencia_(data, contexto) {
  return jsonResponse_({ ok: true, data: Gerencia.getPanel(data, contexto) });
}

function handleEnviarReporteGerenciaAhora_(data, contexto) {
  return responderResultado_(Notificaciones.enviarReporteEjecutivoAhora(data, contexto));
}

function handleGetPanelJefatura_(data, contexto) {
  return jsonResponse_({ ok: true, data: Jefatura.getPanel(data, contexto) });
}

function handleGetPautaTrabajo_(data, contexto) {
  return responderResultado_(Dashboard.getPautaDesarrollador(data, contexto));
}

function handleDescargarOrdenTrabajo_(data, contexto) {
  return responderResultado_(OrdenTrabajo.descargar(data, contexto));
}

function handleGetSolicitudDetalle_(data, contexto) {
  return responderResultado_(Solicitudes.getDetalle(data.solicitud_id, contexto));
}

function handleAgregarComentario_(data, contexto) {
  return responderResultado_(Comentarios.agregarComentario(data, contexto));
}

function handleGuardarCatalogo_(data, contexto) {
  return responderResultado_(Catalogos.guardar(data, contexto));
}

function handleGestionarUsuario_(data, contexto) {
  return responderResultado_(Auth.gestionarUsuario(data, contexto));
}

function handleListarCuentasPortal_(data, contexto) {
  return responderResultado_(CuentasPortal.listar(data, contexto));
}

function handleGestionarCuentaPortal_(data, contexto) {
  return responderResultado_(CuentasPortal.gestionar(data, contexto));
}

function handleListarCatalogo_(data, contexto) {
  return responderResultado_(Catalogos.listar(data, contexto));
}

function handleListarUsuarios_(data, contexto) {
  return responderResultado_(Auth.listarUsuarios(data, contexto));
}

function handleListarLogs_(data, contexto) {
  return responderResultado_(Notificaciones.listarLogs(data, contexto));
}

function handleListarJefaturas_(data, contexto) {
  return responderResultado_(Jefatura.listar(data, contexto));
}

function handleGestionarJefatura_(data, contexto) {
  return responderResultado_(Jefatura.gestionar(data, contexto));
}

function responderResultado_(resultado) {
  if (resultado && resultado._validationError) {
    return jsonResponse_({
      ok: false,
      error: 'validation',
      message: resultado.message,
      fields: resultado.fields
    });
  }
  if (resultado && resultado._forbidden) {
    return jsonResponse_({ ok: false, error: 'forbidden', message: resultado.message });
  }
  return jsonResponse_({ ok: true, data: resultado });
}

function handleNotImplemented_() {
  return jsonResponse_({ ok: false, error: 'internal', ref: 'NOT_IMPLEMENTED_FASE0' });
}

function parseRequestBody_(e) {
  if (!e || !e.postData || typeof e.postData.contents !== 'string') {
    throw new Error('Cuerpo de request vacio o invalido');
  }
  var body = JSON.parse(e.postData.contents);
  if (!body || typeof body.action !== 'string') {
    throw new Error('Falta el campo "action" en el body');
  }
  return body;
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function logError_(err, contexto) {
  var ref = Utilities.getUuid();
  Logger.log('[' + ref + '] ' + contexto + ': ' + (err && err.stack ? err.stack : err));
  return ref;
}
