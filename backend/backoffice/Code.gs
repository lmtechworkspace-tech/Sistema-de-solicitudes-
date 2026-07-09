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
  getPanelGerencia: handleGetPanelGerencia_,
  getSolicitudDetalle: handleGetSolicitudDetalle_,
  actualizarEstado: handleActualizarEstado_,
  actualizarPrioridad: handleActualizarPrioridad_,
  comprometerFecha: handleComprometerFecha_,
  agregarComentario: handleAgregarComentario_,
  guardarCatalogo: handleGuardarCatalogo_,
  listarCatalogo: handleListarCatalogo_,
  gestionarUsuario: handleGestionarUsuario_,
  listarUsuarios: handleListarUsuarios_,
  listarLogs: handleListarLogs_
};

// ?page=app / ?page=admin sirve la UI real (Fase 8); sin ese parametro se
// mantiene el health-check JSON de siempre (usado por monitoreo/tests).
var PAGINAS_HTML = { app: 'App', admin: 'Admin' };

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
    var resuelto = resolverIdentidadYRol_();
    if (resuelto.error) {
      return jsonResponse_(resuelto.error);
    }

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
    return handler(body.data || {}, resuelto.contexto);
  } catch (err) {
    var ref = logError_(err, 'Backoffice.doPost');
    return jsonResponse_({ ok: false, error: 'internal', ref: ref });
  }
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
    return { ok: false, error: 'internal', ref: ref };
  }
}

// Compartido por doPost y ejecutarAccionBackoffice: resuelve email+rol o
// devuelve el objeto de error listo para responder (evita repetir la
// misma validacion en los dos puntos de entrada).
function resolverIdentidadYRol_() {
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

function handleGetDashboardData_(data, contexto) {
  return jsonResponse_({ ok: true, data: Dashboard.getData(data, contexto) });
}

// v2.1 (Fase C): Panel de Control de Gerencia (documentacion/SIGSO-v2.1-
// plazos-y-control.md §7). Solo lectura, como el resto del Dashboard --
// cualquier rol autenticado puede pedirlo (la UI solo lo ofrece a GERENCIA).
function handleGetPanelGerencia_(data, contexto) {
  return jsonResponse_({ ok: true, data: Gerencia.getPanel(data, contexto) });
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

function handleListarCatalogo_(data, contexto) {
  return responderResultado_(Catalogos.listar(data, contexto));
}

function handleListarUsuarios_(data, contexto) {
  return responderResultado_(Auth.listarUsuarios(data, contexto));
}

function handleListarLogs_(data, contexto) {
  return responderResultado_(Notificaciones.listarLogs(data, contexto));
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
