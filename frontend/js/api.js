/**
 * api.js — Cliente compartido para llamar a los Web Apps de Apps Script.
 *
 * Dos transportes segun donde corra la pagina:
 * - Intake (index.html/estado.html, GitHub Pages): POST + Content-Type
 *   text/plain;charset=utf-8 + cuerpo string JSON { action, data } (§4.1).
 *   Nunca application/json ni headers custom: cualquiera de los dos
 *   dispara un preflight OPTIONS que el Web App no responde.
 * - Backoffice (app.html/admin.html, Fase 8): estas paginas las sirve el
 *   propio proyecto Apps Script via HtmlService, y usan `google.script.run`
 *   en vez de fetch. No es una preferencia de estilo: un fetch cross-origin
 *   contra un Web App que exige identidad de Google (no anonimo) requiere
 *   la cookie de sesion de Google como "cookie de tercero", y los
 *   navegadores actuales la bloquean cada vez mas agresivo incluso fuera de
 *   modo incognito -- rompe el fetch con 401 antes de llegar al script.
 *   `google.script.run` no usa red ni cookies (puente nativo del sandbox
 *   de Apps Script), asi que evita ese problema por completo.
 */
// v3.0 (Fase 1): acciones seguras de reintentar automaticamente -- son de
// SOLO LECTURA. Reintentar una escritura (crearSolicitud, actualizarEstado,
// comprometerFecha, guardarCatalogo...) podria ejecutarla dos veces si la
// falla ocurrio DESPUES de escribir pero antes de responder. Por eso solo se
// reintentan las lecturas; las escrituras van a un unico intento y, si
// fallan, el llamador muestra el error para que el usuario reintente a mano.
var ACCIONES_REINTENTABLES = {
  ping: true, getCatalogos: true, consultarEstado: true,
  getDashboardData: true, getPanelGerencia: true, getSolicitudDetalle: true,
  listarCatalogo: true, listarUsuarios: true, listarLogs: true
};
var MAX_INTENTOS_LECTURA = 3;

function esperar_(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// Un unico intento contra el Web App, por el transporte que corresponda.
function ejecutarLlamada_(url, action, data) {
  if (typeof google !== 'undefined' && google.script && google.script.run) {
    return new Promise(function (resolve, reject) {
      google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(reject)
        .ejecutarAccionBackoffice(action, data || {});
    });
  }
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, data: data || {} })
  }).then(function (respuesta) { return respuesta.json(); });
}

// v3.0 (Fase 1, robustez): reintenta con espera creciente las acciones de
// lectura cuando el transporte falla (el error "se perdio la conexion con
// Apps Script" que reportaba el usuario al navegar). Las escrituras no se
// reintentan (ver ACCIONES_REINTENTABLES). Solo se reintenta ante un fallo
// de transporte (promesa rechazada), nunca ante un {ok:false} del backend
// (eso llega como valor resuelto y se devuelve tal cual).
async function llamarApi(url, action, data) {
  const maxIntentos = ACCIONES_REINTENTABLES[action] ? MAX_INTENTOS_LECTURA : 1;
  let ultimoError;
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      return await ejecutarLlamada_(url, action, data);
    } catch (err) {
      ultimoError = err;
      if (intento < maxIntentos) {
        await esperar_(300 * intento);
      }
    }
  }
  throw ultimoError;
}
