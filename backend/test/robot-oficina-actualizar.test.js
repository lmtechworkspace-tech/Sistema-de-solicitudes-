'use strict';

/**
 * El robot de la oficina se actualiza solo (09-11-2026; herramientas/robot-oficina/actualizar.js), con repositorios git
 * de verdad en una carpeta temporal: avanza cuando hay versión nueva, instala dependencias si cambió package.json, y
 * NUNCA pisa cambios locales ni commits propios.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const A = require('../herramientas/robot-oficina/actualizar');

const g = (cwd, ...a) => cp.execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let hayGit = true;
try { cp.execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (e) { hayGit = false; }

function armar() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sigso-act-'));
  const remoto = path.join(base, 'remoto.git'), dev = path.join(base, 'dev'), robot = path.join(base, 'robot');
  g(base, 'init', '-q', '--bare', '-b', 'main', remoto);
  g(base, 'clone', '-q', '-c', 'core.autocrlf=false', remoto, dev);
  const cfg = (d) => { g(d, 'config', 'user.email', 'prueba@demo.cl'); g(d, 'config', 'user.name', 'Prueba'); g(d, 'config', 'commit.gpgsign', 'false'); g(d, 'config', 'core.autocrlf', 'false'); };
  cfg(dev);
  fs.writeFileSync(path.join(dev, 'robot.js'), 'v1\n');
  g(dev, 'add', '.'); g(dev, 'commit', '-q', '-m', 'v1'); g(dev, 'push', '-q', 'origin', 'HEAD:main');
  // Sin conversión de saltos de línea (en Windows core.autocrlf=true dejaría «v2\r\n» en la carpeta).
  g(base, 'clone', '-q', '-c', 'core.autocrlf=false', '-b', 'main', remoto, robot);
  cfg(robot);
  const publicar = (archivo, texto) => { fs.writeFileSync(path.join(dev, archivo), texto); g(dev, 'add', '.'); g(dev, 'commit', '-q', '-m', archivo); g(dev, 'push', '-q', 'origin', 'HEAD:main'); };
  return { base, robot, publicar };
}

test('se pone al día solo: avanza, instala dependencias si cambian y no pisa nada local', { skip: hayGit ? false : 'sin git' }, () => {
  const { base, robot, publicar } = armar();
  try {
    const npm = [];
    const ejecutar = (cmd, args, o) => {
      if (cmd !== 'git') { npm.push([cmd, args.join(' ')]); return ''; }
      return cp.execFileSync(cmd, args, Object.assign({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, o)).trim();
    };
    const rev = () => A.revisar({ proyecto: robot, ejecutar });
    assert.equal(rev().estado, 'AL_DIA');
    const v1 = A.head(robot);

    publicar('robot.js', 'v2\n');
    let r = rev();
    assert.equal(r.estado, 'ACTUALIZADO', r.mensaje);
    assert.equal(fs.readFileSync(path.join(robot, 'robot.js'), 'utf8'), 'v2\n');
    assert.deepEqual([r.antes, r.despues !== v1, npm.length], [v1, true, 0], 'sin cambios de dependencias no instala nada');
    assert.equal(rev().estado, 'AL_DIA');

    publicar('package.json', '{"name":"x"}\n');
    r = rev();
    assert.equal(r.estado, 'ACTUALIZADO');
    assert.match(r.mensaje, /instaló sus dependencias/);
    assert.equal(npm.length, 1, 'cambió package.json: npm install');

    // Cambios sin subir en la carpeta del robot: no se toca nada.
    fs.writeFileSync(path.join(robot, 'robot.js'), 'tocado a mano\n');
    publicar('robot.js', 'v3\n');
    r = rev();
    assert.equal(r.estado, 'CAMBIOS_LOCALES', r.mensaje);
    assert.equal(fs.readFileSync(path.join(robot, 'robot.js'), 'utf8'), 'tocado a mano\n');
    g(robot, 'checkout', '-q', '--', 'robot.js');

    // Un commit propio que no está publicado: la historia no calza, no se fuerza.
    fs.writeFileSync(path.join(robot, 'otro.txt'), 'propio\n');
    g(robot, 'add', '.'); g(robot, 'commit', '-q', '-m', 'propio');
    r = rev();
    assert.equal(r.estado, 'DIVERGE', r.mensaje);
    assert.equal(fs.readFileSync(path.join(robot, 'robot.js'), 'utf8'), 'v2\n');

    // Una rama sin seguimiento (como la carpeta de OneDrive): no se actualiza sola.
    g(robot, 'checkout', '-q', '-b', 'suelta');
    assert.equal(A.revisar({ proyecto: robot }).estado, 'SIN_RAMA');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
