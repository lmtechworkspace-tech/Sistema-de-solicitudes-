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
// acceso al dato (Sheets) o la cola de ejecucion de la cuenta del token.
// Decidir una migracion grande sin datos seria a ciegas. Esto guarda, EN
// SILENCIO, las ultimas ~400 llamadas de ESTE navegador con su desglose, y
// no cambia nada de lo que se ve. Tras una semana de uso normal:
//
//   SigsoPerf.resumen()   imprime una tabla por accion (medianas)
//   SigsoPerf.csv()       vuelca todo para analizar fuera
//   SigsoPerf.limpiar()   borra la muestra
//
// Cada registro:
//   t    momento de la llamada (Date.now)
//   a    accion
//   rt   round-trip real medido en el navegador (ms)
//   s    server_ms que reporto el backend (Perf.gs), o null
//   io   de ese server_ms, cuanto fue viajes a Sheets
//   ops  cuantos viajes a Sheets (lec + esc)
//   i    numero de intento (1..3 en lecturas)
//   ok   si la vuelta resolvio sin excepcion
//   br   true si fue por el puente google.script.run (app/admin.html),
//        false si fue fetch por token (plataforma.html) -- son colas distintas
//
// overhead = rt - s  ->  red + cola + arranque en frio. Si ese numero crece
// en las horas de mas gente, la cola es el problema y cambiar de base de
// datos no lo tocaria.
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
          'round_trip (med)': mediana(g.rt),
          'server (med)': mediana(g.s),
          'io Sheets (med)': mediana(g.io),
          'overhead=cola+red (med)': mediana(g.over)
        };
      });
      console.info('[SigsoPerf] ' + filas.length + ' muestras · ' +
        new Date(filas[0].t).toLocaleString() + ' → ' + new Date(filas[filas.length - 1].t).toLocaleString());
      if (console.table) console.table(tabla); else console.info(JSON.stringify(tabla, null, 2));
      var todoOver = mediana(filas.map(function (r) {
        return (typeof r.rt === 'number' && typeof r.s === 'number') ? r.rt - r.s : null;
      }));
      var todoIo = mediana(filas.map(function (r) { return r.io; }));
      console.info('[SigsoPerf] Global: overhead (cola+red) mediana ' + todoOver +
        ' ms  ·  io Sheets mediana ' + todoIo + ' ms. ' +
        'Si el overhead domina y sube en horas de mas gente -> es la cola, no la base de datos.');
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

// === Reparto de carga entre despliegues por token (sep-2026) ============
//
// Apps Script serializa las ejecuciones de una MISMA cuenta de Google. La
// implementacion "por token" corre toda como una sola cuenta, asi que con
// varias personas a la vez las llamadas hacen cola. La solucion $0: publicar
// el mismo proyecto Backoffice como varias implementaciones, cada una desde
// otra cuenta, y repartir el trafico entre ellas -- N cuentas, N carriles.
//
// El reparto es ESTABLE por usuario (hash del token de sesion): el mismo
// usuario cae siempre en la misma implementacion, para que el cache
// persistente de esa cuenta (CacheService) le siga sirviendo caliente y los
// logs de una sesion no se dispersen. En un REINTENTO se rota a la siguiente
// -- asi una implementacion caida se sortea en el segundo intento en vez de
// romper a ese usuario.

/** [primaria, ...extras] sin vacios ni duplicados. Nunca vacio. */
function construirPoolToken_(cfg) {
  var base = cfg.BACKOFFICE_TOKEN_URL || cfg.BACKOFFICE_URL;
  var extra = Array.isArray(cfg.BACKOFFICE_TOKEN_URLS) ? cfg.BACKOFFICE_TOKEN_URLS : [];
  var pool = [base].concat(extra).filter(function (u, i, arr) {
    return u && arr.indexOf(u) === i;
  });
  return pool.length ? pool : [cfg.BACKOFFICE_URL];
}

/** Elige de forma estable por token; en el reintento `intento` rota +1. */
function elegirUrlToken_(pool, token, intento) {
  if (pool.length <= 1) return pool[0];
  var h = 0;
  var s = String(token || '');
  for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  var base = Math.abs(h) % pool.length;
  return pool[(base + (intento - 1)) % pool.length];
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

  // Backoffice por token: se reparte entre los despliegues del pool. La URL
  // efectiva se elige DENTRO del bucle, para que un reintento pueda rotar a
  // otro despliegue si el primero fallo.
  const esBackofficePorToken = !!(tokenPortal && url === cfg.BACKOFFICE_URL && cfg.BACKOFFICE_TOKEN_URL);
  let poolToken = null;
  if (esBackofficePorToken) {
    poolToken = construirPoolToken_(cfg);
    data = Object.assign({}, data, { portal_token: tokenPortal });
  }

  const medir = medicionTimingActiva_();
  // La muestra rodante (SigsoPerf) va SIEMPRE: es silenciosa y performance.now
  // es gratis. `medir` solo controla el console.info ruidoso de siempre.
  const porPuente = !!(typeof google !== 'undefined' && google.script && google.script.run);
  const maxIntentos = esAccionDeLectura_(action) ? MAX_INTENTOS_LECTURA : 1;
  let ultimoError;
  for (let intento = 1; intento <= maxIntentos; intento++) {
    const urlEfectiva = esBackofficePorToken ? elegirUrlToken_(poolToken, tokenPortal, intento) : url;
    const despliegueIdx = esBackofficePorToken ? poolToken.indexOf(urlEfectiva) : null;
    const inicio = performance.now();
    try {
      const resultado = await ejecutarLlamada_(urlEfectiva, action, data);
      const rt = Math.round(performance.now() - inicio);
      const t = (resultado && typeof resultado === 'object') ? resultado._timing : null;
      perfRegistrar_({
        t: Date.now(), a: action, rt: rt,
        s: t ? t.server_ms : null, io: t ? t.io_ms : null, ops: t ? t.io_ops : null,
        i: intento, ok: true, br: porPuente, d: despliegueIdx
      });
      if (medir) {
        console.info('[SIGSO][timing] ' + action + ' ' + rt + 'ms' +
          (t ? (' (server ' + t.server_ms + 'ms, io ' + t.io_ms + 'ms/' + t.io_ops + ')') : '') +
          (intento > 1 ? ' (intento ' + intento + ')' : ''));
      }
      return resultado;
    } catch (err) {
      const rt = Math.round(performance.now() - inicio);
      perfRegistrar_({
        t: Date.now(), a: action, rt: rt,
        s: null, io: null, ops: null,
        i: intento, ok: false, br: porPuente, d: despliegueIdx
      });
      if (medir) {
        console.info('[SIGSO][timing] ' + action + ' ' + rt + 'ms (fallo, intento ' + intento + ')');
      }
      ultimoError = err;
      if (intento < maxIntentos) {
        await esperar_(300 * intento);
      }
    }
  }
  throw ultimoError;
}
