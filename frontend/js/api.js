/**
 * api.js — cliente compartido para llamar al backend de SIGSO.
 *
 * Un solo destino: el servidor Node (SIGSO_CONFIG.NODE_API_URL, api.ctrly.cl).
 * Apps Script se apagó el 2026-09-27: ya no hay enrutamiento por nombre de
 * acción, ni reparto entre cuentas de Google, ni puente google.script.run.
 * El primer argumento `url` de llamarApi se conserva solo para no tocar a los
 * cientos de llamadores; se ignora.
 *
 * Transporte: POST + Content-Type text/plain;charset=utf-8 + cuerpo string
 * JSON { action, data }. text/plain evita el preflight CORS. Con sesión de la
 * plataforma activa, el token viaja en data.portal_token y el servidor
 * resuelve la identidad a partir de él (nunca la declara el cliente).
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
  getColaSolicitudes: true, getResumenGerencia: true, getMiEquipo: true, getSaludConfig: true, getCaminoCertificacionSgc: true, getControlDocumentalSgc: true, getPanelPersonasSgc: true,
  listarCatalogo: true, listarUsuarios: true, listarLogs: true,
  // v7.1 (notificaciones vivas): polling de solo lectura cada 2-3 min --
  // un fallo de transporte no debe silenciar el ciclo hasta el proximo tick.
  sincronizarNotificacionesApp: true
};
var MAX_INTENTOS_LECTURA = 3;

// v3.4 (resiliencia audita, sep-2026): además del mapa explícito de arriba,
// se reintenta CUALQUIER acción cuyo nombre empiece por un verbo de LECTURA.
// Motivo: en producción, la implementación "por token" del Backoffice corre
// como una sola cuenta (la dueña), y Apps Script serializa las peticiones de
// una misma cuenta. Una mañana con varias personas usando Calidad/Proyectos a
// la vez encola las llamadas; la que queda atrás (o un arranque en frío) puede
// pasarse de los 35 s y abortaba mostrando "El servidor tardó demasiado en
// responder", sin volver a intentar -- aunque un segundo intento 1-2 s después
// entra con el contenedor ya caliente y la cola drenada. Estas acciones son de
// SOLO LECTURA (idempotentes): reintentarlas NO puede duplicar ninguna
// escritura. Los verbos de escritura (crear/guardar/registrar/actualizar/
// sembrar/marcar/checkin...) NO empiezan por estos prefijos, así que siguen a
// un único intento. Es la misma convención de lectura que usa calidad.js
// (api_) para decidir qué caché invalidar.
var PREFIJOS_LECTURA = /^(listar|get|obtener|resumen|consultar|buscar|previsualizar|sugerir|export|descargar)/i;
function esAccionDeLectura_(action) {
  return !!action && (ACCIONES_REINTENTABLES[action] || PREFIJOS_LECTURA.test(action));
}

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

// === Muestra rodante de rendimiento (sep-2026) ==========================
//
// POR QUE. "SIGSO va lento" tiene dos causas que se arreglan distinto: el
// trabajo del servidor o la red (el servidor está en Helsinki: cada viaje
// desde Chile cuesta ~0,25 s). Esto guarda, EN SILENCIO, las ultimas ~400
// llamadas de ESTE navegador con su desglose, y no cambia nada de lo que se
// ve. Tras una semana de uso normal:
//
//   SigsoPerf.resumen()   imprime una tabla por accion (medianas)
//   SigsoPerf.csv()       vuelca todo para analizar fuera
//   SigsoPerf.limpiar()   borra la muestra
//
// Cada registro:
//   t    momento de la llamada (Date.now)
//   a    accion
//   rt   round-trip real medido en el navegador (ms)
//   s    ms de trabajo que reporto el servidor (cabecera X-Server-Ms), o null
//   io/ops  campos de la era Apps Script (siempre null; se conservan por formato)
//   i    numero de intento (1..3 en lecturas)
//   ok   si la vuelta resolvio sin excepcion
//
// red = rt - s  ->  viaje de ida y vuelta + conexión.
var SIGSO_PERF_LLAVE = 'sigso_perf_log';
var SIGSO_PERF_TOPE = 400;

function perfRegistrar_(registro) {
  try {
    var crudo = localStorage.getItem(SIGSO_PERF_LLAVE);
    var lista = crudo ? JSON.parse(crudo) : [];
    if (!Array.isArray(lista)) lista = [];
    lista.push(registro);
    if (lista.length > SIGSO_PERF_TOPE) lista = lista.slice(lista.length - SIGSO_PERF_TOPE);
    localStorage.setItem(SIGSO_PERF_LLAVE, JSON.stringify(lista));
  } catch (err) { /* sin storage / cuota llena: se pierde la muestra, no pasa nada */ }
}

if (typeof window !== 'undefined') {
  window.SigsoPerf = {
    dump: function () {
      try { return JSON.parse(localStorage.getItem(SIGSO_PERF_LLAVE) || '[]'); }
      catch (err) { return []; }
    },
    limpiar: function () {
      try { localStorage.removeItem(SIGSO_PERF_LLAVE); } catch (err) {}
    },
    csv: function () {
      var filas = window.SigsoPerf.dump();
      var cab = 'fecha,accion,round_trip_ms,server_ms,io_ms,io_ops,overhead_ms,intento,ok,puente,despliegue';
      var cuerpo = filas.map(function (r) {
        var overhead = (r.rt != null && r.s != null) ? (r.rt - r.s) : '';
        return [
          new Date(r.t).toISOString(), r.a, r.rt, (r.s == null ? '' : r.s),
          (r.io == null ? '' : r.io), (r.ops == null ? '' : r.ops),
          overhead, r.i, (r.ok ? 1 : 0), (r.br ? 1 : 0), (r.d == null ? '' : r.d)
        ].join(',');
      });
      return [cab].concat(cuerpo).join('\n');
    },
    resumen: function () {
      var filas = window.SigsoPerf.dump();
      if (!filas.length) { console.info('[SigsoPerf] sin muestras todavia'); return; }
      var mediana = function (arr) {
        var xs = arr.filter(function (n) { return typeof n === 'number'; }).sort(function (a, b) { return a - b; });
        if (!xs.length) return null;
        var m = Math.floor(xs.length / 2);
        return xs.length % 2 ? xs[m] : Math.round((xs[m - 1] + xs[m]) / 2);
      };
      var porAccion = {};
      filas.forEach(function (r) {
        var g = porAccion[r.a] || (porAccion[r.a] = { rt: [], s: [], io: [], over: [], n: 0, fallos: 0 });
        g.n++;
        if (!r.ok) g.fallos++;
        if (typeof r.rt === 'number') g.rt.push(r.rt);
        if (typeof r.s === 'number') g.s.push(r.s);
        if (typeof r.io === 'number') g.io.push(r.io);
        if (typeof r.rt === 'number' && typeof r.s === 'number') g.over.push(r.rt - r.s);
      });
      var tabla = Object.keys(porAccion).sort().map(function (a) {
        var g = porAccion[a];
        return {
          accion: a, llamadas: g.n, fallos: g.fallos,
          'total ms (med)': mediana(g.rt),
          'servidor ms (med)': mediana(g.s),
          'red ms (med)': mediana(g.over)
        };
      });
      console.info('[SigsoPerf] ' + filas.length + ' muestras · ' +
        new Date(filas[0].t).toLocaleString() + ' → ' + new Date(filas[filas.length - 1].t).toLocaleString());
      if (console.table) console.table(tabla); else console.info(JSON.stringify(tabla, null, 2));
      var todoRed = mediana(filas.map(function (r) {
        return (typeof r.rt === 'number' && typeof r.s === 'number') ? r.rt - r.s : null;
      }));
      var todoServidor = mediana(filas.map(function (r) { return r.s; }));
      console.info('[SigsoPerf] Global: red mediana ' + todoRed + ' ms · servidor mediana ' + todoServidor + ' ms. ' +
        'Si la red domina, lo que ayuda es acercar el servidor o hacer menos llamadas encadenadas; ' +
        'si domina el servidor, hay que optimizar esa acción.');
    }
  };
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

// Un único intento contra el servidor.
// Resultado de una llamada -> ms que reportó el servidor (cabecera X-Server-Ms).
// WeakMap: varias llamadas corren a la vez y el número no ensucia el resultado.
var MS_SERVIDOR_ = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;

function ejecutarLlamada_(url, action, data) {
  var msServidor = null;
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
    var cab = respuesta.headers && respuesta.headers.get('X-Server-Ms');
    if (cab) msServidor = Number(cab);
    return respuesta.text();
  }).then(function (texto) {
    limpiar();
    try {
      var json = JSON.parse(texto);
      if (MS_SERVIDOR_ && msServidor != null && json && typeof json === 'object') MS_SERVIDOR_.set(json, msServidor);
      return json;
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
// lectura cuando el transporte falla. Las escrituras no se reintentan (ver
// ACCIONES_REINTENTABLES). Solo se reintenta ante un fallo de transporte
// (promesa rechazada), nunca ante un {ok:false} del backend (eso llega como
// valor resuelto y se devuelve tal cual).
async function llamarApi(url, action, data) {
  const cfg = window.SIGSO_CONFIG || {};
  let tokenPortal = null;
  try { tokenPortal = localStorage.getItem('sigso_portal_token'); } catch (err) { /* sin storage */ }
  const destino = cfg.NODE_API_URL;
  if (tokenPortal) data = Object.assign({}, data, { portal_token: tokenPortal });

  const medir = medicionTimingActiva_();
  const maxIntentos = esAccionDeLectura_(action) ? MAX_INTENTOS_LECTURA : 1;
  let ultimoError;
  for (let intento = 1; intento <= maxIntentos; intento++) {
    const inicio = performance.now();
    try {
      const resultado = await ejecutarLlamada_(destino, action, data);
      const rt = Math.round(performance.now() - inicio);
      const s = (MS_SERVIDOR_ && resultado && typeof resultado === 'object' && MS_SERVIDOR_.has(resultado)) ? MS_SERVIDOR_.get(resultado) : null;
      perfRegistrar_({ t: Date.now(), a: action, rt: rt, s: s, io: null, ops: null, i: intento, ok: true });
      if (medir) console.info('[SIGSO][timing] ' + action + ' ' + rt + 'ms' + (s != null ? ' (servidor ' + s + 'ms)' : '') + (intento > 1 ? ' (intento ' + intento + ')' : ''));
      return resultado;
    } catch (err) {
      const rt = Math.round(performance.now() - inicio);
      perfRegistrar_({ t: Date.now(), a: action, rt: rt, s: null, io: null, ops: null, i: intento, ok: false });
      if (medir) console.info('[SIGSO][timing] ' + action + ' ' + rt + 'ms (fallo, intento ' + intento + ')');
      ultimoError = err;
      if (intento < maxIntentos) await esperar_(300 * intento);
    }
  }
  throw ultimoError;
}
