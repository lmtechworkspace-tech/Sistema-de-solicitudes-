/**
 * Code.gs — App Publica (Intake)
 *
 * Contrato de transporte (C-02 / R-014, ver documentacion/fases/FASE-00-fundamentos.md):
 *  - El frontend llama SIEMPRE con POST y Content-Type: text/plain;charset=utf-8.
 *  - Eso evita el preflight OPTIONS que un Web App de Apps Script no responde.
 *  - El cuerpo es un string JSON: { action: string, data: object }.
 *  - La respuesta es siempre JSON con la envoltura { ok, data } o { ok:false, error, ... }.
 *
 * Fase 0: transporte, router y manejo de errores de punta a punta.
 * Fase 1: crearSolicitud y getCatalogos ya llaman logica real (Solicitudes.gs,
 * Catalogos.gs). Fase 3: consultarEstado llama Solicitudes.estadoPublico.
 * Fase 4: subirArchivo llama Drive.subirArchivo (§5.3).
 */

var INTAKE_ACTIONS = {
  ping: handlePing_,
  crearSolicitud: handleCrearSolicitud_,
  subirArchivo: handleSubirArchivo_,
  getCatalogos: handleGetCatalogos_,
  getClientes: handleGetClientes_,
  consultarEstado: handleConsultarEstado_,
  responderConsulta: handleResponderConsulta_,
  validarCierre: handleValidarCierre_,
  solicitarCodigoAcceso: handleSolicitarCodigoAcceso_,
  misSolicitudes: handleMisSolicitudes_,
  // v3.3: identidad de la plataforma (Portal.gs). Acciones publicas como el
  // resto de Intake -- la proteccion es el hash/token, no el transporte.
  portalLogin: handlePortalLogin_,
  portalLogout: handlePortalLogout_,
  portalSesion: handlePortalSesion_,
  portalCambiarPassword: handlePortalCambiarPassword_
};

function doGet(e) {
  return jsonResponse_({ ok: true, data: { servicio: 'SIGSO Intake', estado: 'activo' } });
}

function doPost(e) {
  try {
    var body = parseRequestBody_(e);
    var handler = INTAKE_ACTIONS[body.action];
    if (!handler) {
      return jsonResponse_({
        ok: false,
        error: 'validation',
        message: 'Accion desconocida: ' + body.action,
        fields: ['action']
      });
    }
    return handler(body.data || {});
  } catch (err) {
    var ref = logError_(err, 'Intake.doPost');
    return jsonResponse_({ ok: false, error: 'internal', ref: ref, message: 'Error interno: ' + String(err && err.message ? err.message : err).slice(0, 300) });
  }
}

function handlePing_() {
  return jsonResponse_({
    ok: true,
    data: { pong: true, ts: new Date().toISOString(), tz: getConfig_().timezone }
  });
}

function handleNotImplemented_() {
  return jsonResponse_({ ok: false, error: 'internal', ref: 'NOT_IMPLEMENTED_FASE0' });
}

function handleCrearSolicitud_(data) {
  return responderResultado_(Solicitudes.crearSolicitud(data));
}

function handleGetCatalogos_() {
  return jsonResponse_({ ok: true, data: Catalogos.getAll() });
}

// Cartera de clientes GDE/HomePymes para el buscador del formulario. Aparte
// de getCatalogos por tamano y por carga lazy (ver Catalogos.getClientes).
function handleGetClientes_() {
  return jsonResponse_({ ok: true, data: Catalogos.getClientes() });
}

function handleConsultarEstado_(data) {
  return responderResultado_(Solicitudes.estadoPublico(data.solicitud_id, data.email));
}

function handleResponderConsulta_(data) {
  return responderResultado_(Solicitudes.responderConsulta(data));
}

function handleValidarCierre_(data) {
  return responderResultado_(Solicitudes.validarCierre(data));
}

function handleSolicitarCodigoAcceso_(data) {
  return responderResultado_(Solicitudes.solicitarCodigoAcceso(data));
}

function handleMisSolicitudes_(data) {
  return responderResultado_(Solicitudes.misSolicitudes(data));
}

function handleSubirArchivo_(data) {
  return responderResultado_(Drive.subirArchivo(data));
}

function handlePortalLogin_(data) {
  return responderResultado_(Portal.login(data));
}

function handlePortalLogout_(data) {
  return responderResultado_(Portal.logout(data));
}

function handlePortalSesion_(data) {
  return responderResultado_(Portal.sesion(data));
}

function handlePortalCambiarPassword_(data) {
  return responderResultado_(Portal.cambiarPassword(data));
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
