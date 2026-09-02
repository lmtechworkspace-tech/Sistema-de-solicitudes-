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
  listarCatalogo: true, listarUsuarios: true, listarLogs: true,
  // v7.1 (notificaciones vivas): polling de solo lectura cada 2-3 min --
  // un fallo de transporte no debe silenciar el ciclo hasta el proximo tick.
  sincronizarNotificacionesApp: true
};
var MAX_INTENTOS_LECTURA = 3;

// F1 (rediseño "Mis solicitudes", medicion de rendimiento): la auditoria F0
// midio lecturas/filas del lado del servidor (sandbox), pero NO pudo medir
// milisegundos reales de produccion -- eso necesita la sesion real del
// usuario. En vez de inventar un numero, esto deja la medicion lista para
// que el propio usuario la active cuando quiera: por defecto NO hace nada
// (ni console.log ni red), asi que no cambia el comportamiento de nadie.
//
// Para activarla: en la consola del navegador, en produccion,
//   localStorage.setItem('sigso_debug_timing', '1')
// y usar el modulo con normalidad. Cada llamada imprime una linea con la
// accion y los milisegundos reales que tardo esa vuelta (ida+vuelta a Apps
// Script incluida). Para desactivar: localStorage.removeItem('sigso_debug_timing').
function medicionTimingActiva_() {
  try { return localStorage.getItem('sigso_debug_timing') === '1'; }
  catch (err) { return false; }
}

// Techo de espera por intento. Sin esto, un Web App que se cuelga o que
// quedo con un deploy roto deja el fetch PENDIENTE PARA SIEMPRE, y el modulo
// gira sin fin sin avisar nada (el sintoma "no cargan los datos"). Apps
// Script puede tardar hasta ~30 s de forma legitima en operaciones pesadas o
// arranques en frio; 35 s da margen para eso sin dejar la app colgada.
var TIMEOUT_FETCH_MS = 35000;

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

  // AbortController corta el fetch si el backend no responde a tiempo, y asi
  // una caida se convierte en un error claro (reintentable en lecturas) en
  // vez de un spinner infinito.
  var control = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var idTimeout = control ? setTimeout(function () { control.abort(); }, TIMEOUT_FETCH_MS) : null;
  var limpiar = function () { if (idTimeout) { clearTimeout(idTimeout); idTimeout = null; } };

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, data: data || {} }),
    signal: control ? control.signal : undefined
  }).then(function (respuesta) {
    // Se lee como texto y se parsea a mano para poder distinguir "el backend
    // respondio algo que no es JSON" (una pagina de error o de login de Apps
    // Script, tipico de un deploy roto o de la implementacion por token
    // exigiendo identidad de Google) de un fallo de red. Antes esto era un
    // SyntaxError cripticо; ahora es un mensaje accionable.
    return respuesta.text();
  }).then(function (texto) {
    limpiar();
    try {
      return JSON.parse(texto);
    } catch (err) {
      throw new Error('El servidor respondió algo inesperado (posible problema de despliegue o de sesión). Reintenta o vuelve a ingresar a la plataforma.');
    }
  }, function (err) {
    limpiar();
    if (err && err.name === 'AbortError') {
      throw new Error('El servidor tardó demasiado en responder. Reintenta en unos segundos.');
    }
    throw err;
  });
}

// v3.0 (Fase 1, robustez): reintenta con espera creciente las acciones de
// lectura cuando el transporte falla (el error "se perdio la conexion con
// Apps Script" que reportaba el usuario al navegar). Las escrituras no se
// reintentan (ver ACCIONES_REINTENTABLES). Solo se reintenta ante un fallo
// de transporte (promesa rechazada), nunca ante un {ok:false} del backend
// (eso llega como valor resuelto y se devuelve tal cual).
async function llamarApi(url, action, data) {
  // v3.3 P3: con sesion de la plataforma activa, las llamadas al Backoffice
  // viajan con el token en el body y hacia la implementacion "por token"
  // (BACKOFFICE_TOKEN_URL, ejecutar como yo / cualquiera). Punto UNICO de
  // enrutamiento: dashboard.js/detalle.js/gerencia.js no cambian. Las
  // paginas Google (App/Admin via HtmlService) usan google.script.run y no
  // pasan por aqui.
  const cfg = window.SIGSO_CONFIG || {};
  let tokenPortal = null;
  try { tokenPortal = localStorage.getItem('sigso_portal_token'); } catch (err) { /* sin storage */ }
  if (tokenPortal && url === cfg.BACKOFFICE_URL) {
    if (cfg.BACKOFFICE_TOKEN_URL) {
      url = cfg.BACKOFFICE_TOKEN_URL;
    }
    data = Object.assign({}, data, { portal_token: tokenPortal });
  }

  const medir = medicionTimingActiva_();
  const maxIntentos = ACCIONES_REINTENTABLES[action] ? MAX_INTENTOS_LECTURA : 1;
  let ultimoError;
  for (let intento = 1; intento <= maxIntentos; intento++) {
    const inicio = medir ? performance.now() : 0;
    try {
      const resultado = await ejecutarLlamada_(url, action, data);
      if (medir) {
        const ms = Math.round(performance.now() - inicio);
        console.info('[SIGSO][timing] ' + action + ' ' + ms + 'ms' + (intento > 1 ? ' (intento ' + intento + ')' : ''));
      }
      return resultado;
    } catch (err) {
      if (medir) {
        const ms = Math.round(performance.now() - inicio);
        console.info('[SIGSO][timing] ' + action + ' ' + ms + 'ms (fallo, intento ' + intento + ')');
      }
      ultimoError = err;
      if (intento < maxIntentos) {
        await esperar_(300 * intento);
      }
    }
  }
  throw ultimoError;
}
