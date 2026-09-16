'use strict';

/**
 * router.js — equivalente de BACKOFFICE_ACTIONS + responderResultado_ +
 * resolverContextoPortal_ en backend/backoffice/Code.gs: un mapa accion ->
 * funcion de logica, y una traduccion uniforme del resultado a {status,
 * body} HTTP.
 *
 * ARREGLO DE SEGURIDAD respecto de la version anterior de este archivo: ya
 * NO se acepta un `contexto` mandado por el cliente en el cuerpo de la
 * peticion (eso permitia a cualquiera declararse rol:'ADM' y saltarse todos
 * los permisos -- un hueco real, documentado como temporal cuando se agrego
 * la primera version de este router). Ahora, para toda accion protegida, el
 * contexto se resuelve del lado del servidor a partir de `data.portal_token`
 * contra SESIONES_PORTAL/CUENTAS_PORTAL -- exactamente como ya hacia
 * resolverContextoPortal_ en el .gs, mismo campo, mismo nombre (asi el
 * frontend actual, que ya manda portal_token, no necesita cambios cuando se
 * apunte a este servidor).
 *
 * PENDIENTE, documentado y no fingido: el .gs valida ademas, por cada
 * accion, que la cuenta tenga el MODULO requerido (MODULO_POR_ACCION /
 * resolverContextoPortal_) -- una capa de autorizacion mas fina que el rol.
 * Todavia no se porta: no hay suficientes modulos migrados para que valga la
 * pena el mapa completo. Cuando se porten mas, agregar ese mapa aqui mismo.
 */

const Catalogos = require('../logica/catalogos');
const Portal = require('../logica/portal');
const CuentasPortal = require('../logica/cuentasPortal');
const Sesiones = require('../logica/sesiones');
const Solicitudes = require('../logica/solicitudes');
const SolicitudesBO = require('../logica/solicitudesBackoffice');
const Jefatura = require('../logica/jefatura');

// Acciones que NO requieren una sesion ya resuelta: o bien la crean
// (portalLogin), o bien resuelven su propio token internamente y devuelven
// forbidden si no sirve (portalLogout/portalSesion/portalCambiarPassword) --
// mismo contrato que Portal.gs, que las expone como self-service, no como
// acciones gateadas por rol. crearSolicitud tambien es publica a proposito:
// es el formulario de ingreso (backend/intake), que cualquier persona sin
// cuenta puede enviar -- igual que en Apps Script, donde Intake es un
// proyecto separado sin gate de identidad.
const ACCIONES_PUBLICAS = new Set(['portalLogin', 'portalLogout', 'portalSesion', 'portalCambiarPassword', 'crearSolicitud']);

const ACCIONES = {
  portalLogin: (db, data) => Portal.login(db, data),
  portalLogout: (db, data) => Portal.logout(db, data),
  portalSesion: (db, data) => Portal.sesion(db, data),
  portalCambiarPassword: (db, data) => Portal.cambiarPassword(db, data),

  listarCuentasPortal: (db, data, contexto) => CuentasPortal.listar(db, data, contexto),
  gestionarCuentaPortal: (db, data, contexto) => CuentasPortal.gestionar(db, data, contexto),

  guardarCatalogo: (db, data, contexto) => Catalogos.guardar(db, data, contexto),
  listarCatalogo: (db, data, contexto) => Catalogos.listar(db, data, contexto),

  crearSolicitud: (db, data) => Solicitudes.crearSolicitud(db, data),

  actualizarEstado: (db, data, contexto) => SolicitudesBO.actualizarEstado(db, data, contexto),
  actualizarPrioridad: (db, data, contexto) => SolicitudesBO.actualizarPrioridad(db, data, contexto),
  comprometerFecha: (db, data, contexto) => SolicitudesBO.comprometerFecha(db, data, contexto),
  derivarSolicitud: (db, data, contexto) => SolicitudesBO.derivarSolicitud(db, data, contexto),
  editarContenidoSubsolicitud: (db, data, contexto) => SolicitudesBO.editarContenidoSubsolicitud(db, data, contexto),
  getSolicitudDetalle: (db, data, contexto) => SolicitudesBO.getDetalle(db, data.solicitud_id, contexto),

  listarJefaturas: (db, data, contexto) => Jefatura.listar(db, data, contexto),
  gestionarJefatura: (db, data, contexto) => Jefatura.gestionar(db, data, contexto)
};

function responderResultado_(resultado) {
  if (resultado && resultado._validationError) {
    return { status: 400, body: { ok: false, error: 'validation', message: resultado.message, fields: resultado.fields } };
  }
  if (resultado && resultado._forbidden) {
    return { status: 403, body: { ok: false, error: 'forbidden', message: resultado.message } };
  }
  return { status: 200, body: { ok: true, data: resultado } };
}

/**
 * Mismo criterio de normalizacion de rol que resolverContextoPortal_: una
 * cuenta SOLICITANTE a la que el Admin le dio "bandeja" se trata como DEV
 * (el rol mas restringido con escritura) en los checks del Backoffice, que
 * solo conocen ANA/DEV/ADM/GERENCIA. `rol_origen` conserva el rol real para
 * quien lo necesite (p.ej. mostrar el rol verdadero en el panel de cuentas).
 */
function resolverContextoPortal_(db, token) {
  const cuenta = Sesiones.resolverCuentaPorToken(db, token);
  if (!cuenta) return null;
  const emails = Portal.parsearListaPortal(cuenta.emails);
  const modulos = Portal.parsearListaPortal(cuenta.modulos);
  return {
    email: emails[0] || '',
    rol: cuenta.rol === 'SOLICITANTE' ? 'DEV' : cuenta.rol,
    rol_origen: cuenta.rol,
    modulos: modulos,
    via_portal: true,
    cuenta_id: cuenta.cuenta_id,
    empresa_id: cuenta.empresa_id
  };
}

function ejecutarAccion(db, action, data) {
  data = data || {};
  const fn = ACCIONES[action];
  if (!fn) {
    return { status: 404, body: { ok: false, error: 'Acción desconocida: ' + action } };
  }

  if (ACCIONES_PUBLICAS.has(action)) {
    return responderResultado_(fn(db, data));
  }

  const contexto = resolverContextoPortal_(db, data.portal_token);
  if (!contexto) {
    return { status: 403, body: { ok: false, error: 'forbidden', message: 'Sesión inválida o expirada. Ingresa de nuevo.' } };
  }
  return responderResultado_(fn(db, data, contexto));
}

module.exports = { ejecutarAccion, ACCIONES, resolverContextoPortal_ };
