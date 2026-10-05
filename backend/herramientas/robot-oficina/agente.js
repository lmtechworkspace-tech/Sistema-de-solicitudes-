#!/usr/bin/env node
'use strict';

/**
 * Robot TGR de la oficina (2026-10-02).
 *
 * La TGR rechaza las conexiones del servidor de SIGSO (403), así que el robot
 * corre en un PC de la oficina, con la misma conexión a internet que usa el
 * equipo. Este programa:
 *  1. le pregunta a SIGSO si hay una revisión pendiente (la consulta queda
 *     abierta hasta 20 s; no se abre ningún puerto en este PC);
 *  2. si la hay, entra a la TGR con el RUT y la clave que escribió la persona
 *     en SIGSO (robotTgr.js: un intento, se detiene ante verificación por
 *     correo, cambio de clave, CAPTCHA o bloqueo; no se disfraza);
 *  3. devuelve las cuotas leídas a SIGSO, donde se revisan antes de aplicar.
 * La clave solo existe en memoria durante la revisión: no se escribe en el
 * disco ni en la consola. Tampoco las capturas de diagnóstico (van a SIGSO).
 *
 * POR LOTE (2026-10-05): si SIGSO le entrega varios clientes, los recorre uno
 * tras otro con una pausa entre cada uno; cada clave se borra apenas se usa, y
 * ante un bloqueo o CAPTCHA de la TGR detiene el resto del lote.
 *
 * Uso (desde la carpeta del proyecto SIGSO):
 *   node backend/herramientas/robot-oficina/agente.js configurar       (una vez: pega la llave)
 *   node backend/herramientas/robot-oficina/agente.js                  (dejar abierto)
 *   node backend/herramientas/robot-oficina/agente.js --ventana        (piloto: se ve el navegador)
 *   node backend/herramientas/robot-oficina/agente.js instalar-inicio  (que arranque solo con Windows)
 *   node backend/herramientas/robot-oficina/agente.js quitar-inicio    (deja de arrancar solo y lo detiene)
 *   node backend/herramientas/robot-oficina/agente.js estado           (¿está instalado y corriendo?)
 * Ver LEEME.md.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const Robot = require('../../logica/robotTgr');

const URL_SIGSO = 'https://api.ctrly.cl/v1/accion';
const CARPETA = process.env.SIGSO_ROBOT_CARPETA || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.config'), 'SIGSO');
const RUTA_CONFIG = process.env.SIGSO_ROBOT_CONFIG || path.join(CARPETA, 'robot-oficina.json');
const RUTA_LOG = path.join(CARPETA, 'robot-oficina.log');
const RUTA_CANDADO = path.join(CARPETA, 'robot-oficina.lock');
const PROYECTO = path.resolve(__dirname, '..', '..', '..');
// Arranque con Windows: la carpeta Inicio del usuario (no necesita permisos de administrador).
const CARPETA_INICIO = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
// En Inicio queda un acceso directo; el script que abre el robot sin ventana vive en CARPETA.
const ACCESO_INICIO = path.join(CARPETA_INICIO, 'SIGSO Robot TGR.lnk');
const ARRANQUE_VIEJO = path.join(CARPETA_INICIO, 'SIGSO Robot TGR.vbs');   // versión anterior del instalador
const ARRANQUE_VBS = path.join(CARPETA, 'robot-oficina.vbs');
const LANZADOR_CMD = path.join(CARPETA, 'robot-oficina.cmd');
const args = process.argv.slice(2);
const OCULTO = args.includes('--oculto');      // lo inicia el arranque con Windows: sin consola, al registro
// Salidas que el lanzador NO debe reintentar (configuración, llave, otro robot ya corriendo).
const SALIDA_DEFINITIVA = 2;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const hora = () => new Date().toLocaleString('es-CL');
/** A la consola y, siempre, al registro (nunca claves: solo estados y RUT). */
function log(m) {
  const linea = '[' + hora() + '] ' + m;
  if (!OCULTO) console.log(linea);
  try {
    fs.mkdirSync(CARPETA, { recursive: true });
    try { if (fs.statSync(RUTA_LOG).size > 1024 * 1024) fs.renameSync(RUTA_LOG, RUTA_LOG + '.1'); } catch (e) { /* no existe aún */ }
    fs.appendFileSync(RUTA_LOG, linea + '\n');
  } catch (e) { /* sin registro no se detiene el robot */ }
}
function vivo(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
/** Un solo robot por PC: si ya hay uno corriendo (a mano o con Windows), este no parte. */
function tomarCandado() {
  fs.mkdirSync(CARPETA, { recursive: true });
  try {
    const otro = Number(fs.readFileSync(RUTA_CANDADO, 'utf8'));
    if (otro && otro !== process.pid && vivo(otro)) return otro;
  } catch (e) { /* sin candado */ }
  fs.writeFileSync(RUTA_CANDADO, String(process.pid));
  const soltar = () => { try { if (Number(fs.readFileSync(RUTA_CANDADO, 'utf8')) === process.pid) fs.unlinkSync(RUTA_CANDADO); } catch (e) { /* */ } };
  process.on('exit', soltar);
  ['SIGINT', 'SIGTERM', 'SIGBREAK'].forEach((sg) => process.on(sg, () => { log('Robot detenido.'); process.exit(0); }));
  return 0;
}

function leerConfig() {
  try { return JSON.parse(fs.readFileSync(RUTA_CONFIG, 'utf8')); } catch (e) { return null; }
}
function preguntar(texto, oculto) {
  return new Promise((ok) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (oculto) rl._writeToOutput = (s) => { if (s.includes(texto)) process.stdout.write(s); else process.stdout.write(s.replace(/[^\r\n]/g, '*')); };
    rl.question(texto, (r) => { rl.close(); if (oculto) process.stdout.write('\n'); ok(r.trim()); });
  });
}

async function configurar() {
  console.log('Robot TGR de la oficina · configuración');
  console.log('La llave se crea en SIGSO: Control interno › Convenios y postergaciones › Seguimiento de cuotas TGR › Recibir desde la TGR › "Robot de la oficina" (solo administrador).');
  const llave = await preguntar('Pega la llave del robot (empieza con sgr_): ', true);
  if (!/^sgr_[A-Za-z0-9_-]{40,}$/.test(llave)) { console.log('Esa no parece una llave del robot. No se guardó nada.'); process.exit(1); }
  let url = (await preguntar('Dirección de SIGSO (presiona Enter para usar ' + URL_SIGSO + '): ')) || URL_SIGSO;
  if (!/^https?:\/\/[^\s]+$/.test(url)) {
    console.log('Eso no es una dirección web: se usa ' + URL_SIGSO + '.');
    url = URL_SIGSO;
  }
  fs.mkdirSync(path.dirname(RUTA_CONFIG), { recursive: true });
  fs.writeFileSync(RUTA_CONFIG, JSON.stringify({ url, llave }, null, 2), { mode: 0o600 });
  console.log('Guardado en ' + RUTA_CONFIG + ' (fuera de OneDrive). Ahora inicia el robot con:');
  console.log('  node backend/herramientas/robot-oficina/agente.js');
}

async function llamar(cfg, action, data, ms) {
  const r = await fetch(cfg.url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, data: Object.assign({ agente_token: cfg.llave }, data || {}) }),
    signal: AbortSignal.timeout(ms || 40000)
  });
  return r.json();
}

/** Solo para probar contra un sitio local que imita la TGR (nunca otro host). */
function recetaDePrueba() {
  const i = args.indexOf('--prueba-tgr');
  if (i === -1) return null;
  const u = String(args[i + 1] || '');
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(u)) { console.log('--prueba-tgr solo acepta un sitio local (http://localhost:PUERTO/...).'); process.exit(1); }
  return { inicio: u, hostsIngreso: ['127.0.0.1'], esperaMs: 10000 };
}

async function iniciar() {
  const cfg = leerConfig();
  if (!cfg || !cfg.llave) { log('Falta configurar el robot. Corre primero: node backend/herramientas/robot-oficina/agente.js configurar'); process.exit(SALIDA_DEFINITIVA); }
  if (!/^https?:\/\/[^\s]+$/.test(String(cfg.url || ''))) {
    log('La dirección de SIGSO guardada no es válida ("' + String(cfg.url).slice(0, 60) + '"). Vuelve a configurar y, cuando pregunte la dirección, presiona solo Enter: node backend/herramientas/robot-oficina/agente.js configurar');
    process.exit(SALIDA_DEFINITIVA);
  }
  const ventana = args.includes('--ventana');
  const receta = recetaDePrueba();
  if (!Robot.disponible()) { log('No se encontró Chrome ni Edge en este PC: el robot los necesita.'); process.exit(SALIDA_DEFINITIVA); }
  const otro = tomarCandado();
  if (otro) { log('Ya hay un robot corriendo en este PC (proceso ' + otro + '): no se inicia otro.'); process.exit(SALIDA_DEFINITIVA); }
  log('Robot TGR de la oficina conectado a ' + cfg.url.replace(/\/v1\/accion$/, '') + (ventana ? ' (se verá el navegador)' : '') + '. Esperando revisiones… (Ctrl+C para detener)');
  let fallos = 0;
  for (;;) {
    let r;
    try { r = await llamar(cfg, 'robotAgenteTomar', { capacidades: 'lote' }, 40000); } catch (e) {
      fallos++;
      if (fallos === 1 || fallos % 10 === 0) log('Sin conexión con SIGSO; reintento en 10 s.');
      await espera(10000);
      continue;
    }
    if (fallos) { log('Conexión con SIGSO recuperada.'); fallos = 0; }
    if (!r || r.ok === false) {
      if (r && r.error === 'forbidden') { log('SIGSO rechazó la llave de este equipo (¿fue dada de baja?). Vuelve a configurar.'); process.exit(SALIDA_DEFINITIVA); }
      await espera(10000);
      continue;
    }
    const lote = r.data && r.data.lote;
    if (lote && Array.isArray(lote.trabajos)) { await revisarLote(cfg, lote, { ventana, receta }); continue; }
    const tr = r.data && r.data.trabajo;
    if (!tr) continue;
    log('Revisión recibida (RUT ' + tr.rut + '). Entrando a la TGR…');
    await revisarUno(cfg, tr, { ventana, receta });
  }
}

/** Una revisión: entra con la clave (y la suelta), entrega el resultado a SIGSO. */
async function revisarUno(cfg, tr, o) {
  let clave = tr.clave;
  tr.clave = '';
  let ultimo = 0;
  const res = await Robot.revisarCliente({ rut: tr.rut, clave }, {
    ventana: o.ventana, receta: o.receta || undefined,
    alPaso: (p) => {
      const ahora = Date.now();
      if (ahora - ultimo < 800) return;
      ultimo = ahora;
      llamar(cfg, 'robotAgentePaso', { trabajo_id: tr.trabajo_id, paso: p }, 10000).catch(() => null);
    }
  }).catch((e) => ({ estado: 'ERROR', mensaje: 'El robot falló en el PC: ' + String((e && e.message) || e).slice(0, 200), convenios: [] }));
  clave = '';
  const entregado = await entregar(cfg, tr.trabajo_id, res);
  log('Revisión terminada (RUT ' + tr.rut + '): ' + res.estado + (res.estado === 'OK' ? ' (' + res.convenios.length + ' convenios)' : ' · ' + res.mensaje) + (entregado ? '' : ' · NO se pudo entregar a SIGSO'));
  return res;
}
async function entregar(cfg, trabajoId, res) {
  for (let i = 0; i < 3; i++) {
    try { if ((await llamar(cfg, 'robotAgenteEntregar', { trabajo_id: trabajoId, resultado: res }, 30000)).ok !== false) return true; } catch (e) { await espera(3000); }
  }
  return false;
}
/**
 * Un lote: uno tras otro, con una pausa entre clientes. Ante un bloqueo o un
 * CAPTCHA de la TGR se detiene todo lo que queda (seguir solo empeoraría el
 * bloqueo de la IP de la oficina) y se borran las claves que no se usaron.
 */
async function revisarLote(cfg, lote, o) {
  const n = lote.trabajos.length;
  const pausa = Math.min(Math.max(Number(lote.pausa_ms) || 20000, 5000), 120000);
  log('Lote recibido: ' + n + (n === 1 ? ' cliente.' : ' clientes.'));
  let detencion = '';
  for (let i = 0; i < n; i++) {
    const tr = lote.trabajos[i];
    if (detencion) {
      tr.clave = '';
      await entregar(cfg, tr.trabajo_id, { estado: 'DETENIDO', mensaje: 'No se revisó: el lote se detuvo porque ' + detencion + '.', convenios: [] });
      continue;
    }
    if (i) {
      await llamar(cfg, 'robotAgentePaso', { trabajo_id: tr.trabajo_id, paso: 'Esperando su turno (pausa entre clientes)' }, 10000).catch(() => null);
      await espera(pausa);
    }
    log('Lote: cliente ' + (i + 1) + ' de ' + n + ' (RUT ' + tr.rut + ').');
    const res = await revisarUno(cfg, tr, o);
    if (res.estado === 'BLOQUEADO') detencion = 'la TGR rechazó el acceso';
    else if (res.estado === 'CAPTCHA') detencion = 'la TGR pidió un CAPTCHA';
  }
  lote.trabajos.forEach((t) => { t.clave = ''; });
  log('Lote terminado' + (detencion ? ' antes de tiempo: ' + detencion : '') + '.');
}

// --- Arranque con Windows ----------------------------------------------------------------
// Un lanzador oculto en la carpeta Inicio del usuario abre el robot al iniciar sesión y lo
// vuelve a abrir si se cae (salvo un error de configuración, que no se arregla solo).
function instalarInicio() {
  if (process.platform !== 'win32') { console.log('El arranque automático es para Windows.'); process.exit(1); }
  if (!leerConfig()) { console.log('Primero configura el robot:\n  node backend/herramientas/robot-oficina/agente.js configurar'); process.exit(1); }
  if (!fs.existsSync(CARPETA_INICIO)) { console.log('No se encontró la carpeta Inicio de Windows (' + CARPETA_INICIO + ').'); process.exit(1); }
  fs.mkdirSync(CARPETA, { recursive: true });
  const agente = path.join(PROYECTO, 'backend', 'herramientas', 'robot-oficina', 'agente.js');
  fs.writeFileSync(LANZADOR_CMD, [
    '@echo off',
    'rem Robot TGR de la oficina (SIGSO): lo abre la carpeta Inicio de Windows. No editar a mano:',
    'rem se rehace con "agente.js instalar-inicio".',
    'cd /d "' + PROYECTO + '"',
    ':otra',
    '"' + process.execPath + '" "' + agente + '" --oculto',
    'if errorlevel ' + SALIDA_DEFINITIVA + ' goto fin',
    // timeout no espera sin ventana: ping sí (30 s entre un reintento y otro).
    'ping -n 31 127.0.0.1 >nul',
    'goto otra',
    ':fin',
    ''
  ].join('\r\n'));
  fs.writeFileSync(ARRANQUE_VBS, 'Rem Robot TGR de la oficina (SIGSO): abre el robot sin ventana al iniciar sesion.\r\nCreateObject("WScript.Shell").Run """' + LANZADOR_CMD + '""", 0, False\r\n');
  try { fs.unlinkSync(ARRANQUE_VIEJO); } catch (e) { /* no estaba */ }
  crearAcceso_(ACCESO_INICIO);
  console.log('Listo: el robot arrancará solo cada vez que inicies sesión en Windows (sin ventana).');
  console.log('  Acceso directo: ' + ACCESO_INICIO);
  console.log('  Registro: ' + RUTA_LOG);
  const otro = candadoActivo();
  if (otro) { console.log('Ya hay un robot corriendo (proceso ' + otro + '): se usará ese hasta que se cierre.'); return; }
  require('node:child_process').spawn('wscript.exe', [ARRANQUE_VBS], { detached: true, stdio: 'ignore' }).unref();
  console.log('Se inició ahora en segundo plano. En SIGSO la tarjeta del robot debería decir "conectado" en unos segundos.');
}
/** Acceso directo de Windows (.lnk) a wscript con el script oculto; las rutas van por el entorno. */
function crearAcceso_(destino) {
  require('node:child_process').execFileSync('powershell.exe', ['-NoProfile', '-Command',
    '$a = (New-Object -ComObject WScript.Shell).CreateShortcut($env:SIGSO_ACCESO); ' +
    '$a.TargetPath = "$env:SystemRoot\\System32\\wscript.exe"; $a.Arguments = \'"\' + $env:SIGSO_VBS + \'"\'; ' +
    '$a.WorkingDirectory = $env:SIGSO_PROYECTO; $a.IconLocation = $env:SIGSO_ICONO + ",0"; ' +
    '$a.Description = "Robot TGR de la oficina (SIGSO): se abre sin ventana"; $a.Save()'],
  { stdio: 'ignore', env: Object.assign({}, process.env, { SIGSO_ACCESO: destino, SIGSO_VBS: ARRANQUE_VBS, SIGSO_PROYECTO: PROYECTO, SIGSO_ICONO: process.execPath }) });
}
function candadoActivo() { try { const p = Number(fs.readFileSync(RUTA_CANDADO, 'utf8')); return p && vivo(p) ? p : 0; } catch (e) { return 0; } }
function quitarInicio() {
  let algo = false;
  [ACCESO_INICIO, ARRANQUE_VIEJO].forEach((f) => { try { fs.unlinkSync(f); algo = true; } catch (e) { /* no estaba */ } });
  if (algo) console.log('Quitado del inicio de Windows.');
  try { fs.unlinkSync(ARRANQUE_VBS); } catch (e) { /* */ }
  try { fs.unlinkSync(LANZADOR_CMD); } catch (e) { /* */ }
  // Detiene el lanzador (para que no lo vuelva a abrir) y el robot.
  if (process.platform === 'win32') {
    try {
      require('node:child_process').execFileSync('powershell.exe', ['-NoProfile', '-Command',
        "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*' + $env:SIGSO_LANZADOR + '*') -or ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*robot-oficina*agente.js*--oculto*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],
        { stdio: 'ignore', env: Object.assign({}, process.env, { SIGSO_LANZADOR: LANZADOR_CMD }) });
    } catch (e) { /* nada que detener */ }
  }
  const p = candadoActivo();
  if (p) { try { process.kill(p); } catch (e) { /* */ } }
  console.log(algo || p ? 'Robot detenido.' : 'No estaba instalado ni corriendo.');
}
function estadoInicio() {
  const instalado = fs.existsSync(ACCESO_INICIO) || fs.existsSync(ARRANQUE_VIEJO);
  const p = candadoActivo();
  console.log('Arranque con Windows: ' + (instalado ? 'instalado' : 'no instalado') + '.');
  console.log('Robot: ' + (p ? 'corriendo (proceso ' + p + ')' : 'detenido') + '.');
  try {
    const l = fs.readFileSync(RUTA_LOG, 'utf8').trim().split('\n').slice(-8);
    console.log('Últimas líneas del registro (' + RUTA_LOG + '):\n  ' + l.join('\n  '));
  } catch (e) { console.log('Todavía no hay registro.'); }
}

const ORDENES = { configurar, 'instalar-inicio': instalarInicio, 'quitar-inicio': quitarInicio, estado: estadoInicio };
Promise.resolve().then(() => (ORDENES[args[0]] || iniciar)()).catch((e) => { log('Error: ' + (e && e.message)); process.exit(1); });
