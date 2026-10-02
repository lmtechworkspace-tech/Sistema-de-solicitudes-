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
 * Uso (desde la carpeta del proyecto SIGSO):
 *   node backend/herramientas/robot-oficina/agente.js configurar   (una vez: pega la llave)
 *   node backend/herramientas/robot-oficina/agente.js              (dejar abierto)
 *   node backend/herramientas/robot-oficina/agente.js --ventana    (piloto: se ve el navegador)
 * Ver LEEME.md.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const Robot = require('../../logica/robotTgr');

const URL_SIGSO = 'https://api.ctrly.cl/v1/accion';
const RUTA_CONFIG = process.env.SIGSO_ROBOT_CONFIG ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.config'), 'SIGSO', 'robot-oficina.json');
const args = process.argv.slice(2);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const hora = () => new Date().toLocaleTimeString('es-CL');
const log = (m) => console.log('[' + hora() + '] ' + m);

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
  if (!cfg || !cfg.llave) { console.log('Falta configurar el robot. Corre primero:\n  node backend/herramientas/robot-oficina/agente.js configurar'); process.exit(1); }
  if (!/^https?:\/\/[^\s]+$/.test(String(cfg.url || ''))) {
    console.log('La dirección de SIGSO guardada no es válida ("' + String(cfg.url).slice(0, 60) + '"). Vuelve a configurar y, cuando pregunte la dirección, presiona solo Enter:\n  node backend/herramientas/robot-oficina/agente.js configurar');
    process.exit(1);
  }
  const ventana = args.includes('--ventana');
  const receta = recetaDePrueba();
  if (!Robot.disponible()) { console.log('No se encontró Chrome ni Edge en este PC: el robot los necesita.'); process.exit(1); }
  log('Robot TGR de la oficina conectado a ' + cfg.url.replace(/\/v1\/accion$/, '') + (ventana ? ' (se verá el navegador)' : '') + '. Esperando revisiones… (Ctrl+C para detener)');
  let fallos = 0;
  for (;;) {
    let r;
    try { r = await llamar(cfg, 'robotAgenteTomar', {}, 40000); } catch (e) {
      fallos++;
      if (fallos === 1 || fallos % 10 === 0) log('Sin conexión con SIGSO; reintento en 10 s.');
      await espera(10000);
      continue;
    }
    if (fallos) { log('Conexión con SIGSO recuperada.'); fallos = 0; }
    if (!r || r.ok === false) {
      if (r && r.error === 'forbidden') { log('SIGSO rechazó la llave de este equipo (¿fue dada de baja?). Vuelve a configurar.'); process.exit(1); }
      await espera(10000);
      continue;
    }
    const tr = r.data && r.data.trabajo;
    if (!tr) continue;
    log('Revisión recibida. Entrando a la TGR…');
    let clave = tr.clave;
    tr.clave = '';
    let ultimo = 0;
    const res = await Robot.revisarCliente({ rut: tr.rut, clave }, {
      ventana, receta: receta || undefined,
      alPaso: (p) => {
        const ahora = Date.now();
        if (ahora - ultimo < 800) return;
        ultimo = ahora;
        llamar(cfg, 'robotAgentePaso', { trabajo_id: tr.trabajo_id, paso: p }, 10000).catch(() => null);
      }
    }).catch((e) => ({ estado: 'ERROR', mensaje: 'El robot falló en el PC: ' + String((e && e.message) || e).slice(0, 200), convenios: [] }));
    clave = '';
    let entregado = false;
    for (let i = 0; i < 3 && !entregado; i++) {
      try { entregado = (await llamar(cfg, 'robotAgenteEntregar', { trabajo_id: tr.trabajo_id, resultado: res }, 30000)).ok !== false; } catch (e) { await espera(3000); }
    }
    log('Revisión terminada: ' + res.estado + (res.estado === 'OK' ? ' (' + res.convenios.length + ' convenios)' : ' · ' + res.mensaje) + (entregado ? '' : ' · NO se pudo entregar a SIGSO'));
  }
}

(args[0] === 'configurar' ? configurar() : iniciar()).catch((e) => { console.error('Error:', e && e.message); process.exit(1); });
