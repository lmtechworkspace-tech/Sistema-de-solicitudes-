'use strict';

/**
 * actualizar.js — el robot de la oficina se pone al día solo (09-11-2026).
 *
 * Antes, cada arreglo del robot pedía ir al PC de la oficina a escribir `git pull` y reiniciarlo. Ahora el programa,
 * entre pedido y pedido, revisa si la rama de la carpeta del robot (C:\SIGSO-robot, que sigue a origin/main) tiene una
 * versión nueva publicada y, si la hay, la trae y avisa para reiniciarse.
 *
 * Con cuidado:
 *  - solo avanza («fast-forward»): si la carpeta tiene cambios propios sin subir o la historia no calza, NO toca nada y
 *    lo deja anotado en el registro;
 *  - si cambió package.json o package-lock.json, instala las dependencias (npm install) antes de reiniciar;
 *  - nunca durante un pedido (el programa lo llama solo cuando está libre).
 *
 * `ejecutar(cmd, args, opciones)` se inyecta (por defecto, child_process.execFileSync) para poder probarlo.
 */

const cp = require('node:child_process');

function ejecutarPorDefecto(cmd, args, o) {
  return String(cp.execFileSync(cmd, args, Object.assign({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 120000 }, o || {})) || '').trim();
}

/**
 * Revisa y, si hay versión nueva, actualiza. Devuelve { estado, mensaje, antes?, despues? } con estado:
 *  AL_DIA · ACTUALIZADO (hay que reiniciar) · CAMBIOS_LOCALES · SIN_RAMA · DIVERGE · ERROR.
 */
function revisar(o) {
  const proyecto = o.proyecto;
  const ejecutar = o.ejecutar || ejecutarPorDefecto;
  const git = (...a) => ejecutar('git', a, { cwd: proyecto });
  try {
    let arriba;
    try { arriba = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'); } catch (e) {
      return { estado: 'SIN_RAMA', mensaje: 'La carpeta del robot no sigue ninguna rama publicada: no se actualiza sola (ver LEEME, «Actualizarse solo»).' };
    }
    if (git('status', '--porcelain', '--untracked-files=no')) {
      return { estado: 'CAMBIOS_LOCALES', mensaje: 'La carpeta del robot tiene cambios sin subir: no se actualiza sola para no pisarlos.' };
    }
    git('fetch', '--quiet', '--no-tags', arriba.split('/')[0], arriba.split('/').slice(1).join('/'));
    const antes = git('rev-parse', 'HEAD');
    const nuevos = Number(git('rev-list', '--count', 'HEAD..@{u}')) || 0;
    if (!nuevos) return { estado: 'AL_DIA', mensaje: 'Al día.', antes };
    if (Number(git('rev-list', '--count', '@{u}..HEAD')) > 0) {
      return { estado: 'DIVERGE', mensaje: 'La carpeta del robot tiene commits propios que no están publicados: no se actualiza sola.' };
    }
    git('merge', '--ff-only', '--quiet', '@{u}');
    const despues = git('rev-parse', 'HEAD');
    const cambiados = git('diff', '--name-only', antes, despues).split(/\r?\n/).filter(Boolean);
    let deps = '';
    if (cambiados.some((f) => /(^|\/)package(-lock)?\.json$/.test(f))) {
      try {
        // Por cmd.exe en Windows (npm es un .cmd); PowerShell bloquea npm.ps1 en algunos PC.
        ejecutar(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm install --no-audit --no-fund'] : ['install', '--no-audit', '--no-fund'], { cwd: proyecto, timeout: 600000 });
        deps = ' e instaló sus dependencias';
      } catch (e) { deps = ' (no se pudieron instalar las dependencias: ' + String((e && e.message) || e).slice(0, 120) + ')'; }
    }
    return { estado: 'ACTUALIZADO', mensaje: 'Se actualizó (' + nuevos + ' cambio(s) publicados: ' + antes.slice(0, 7) + ' → ' + despues.slice(0, 7) + ')' + deps + '.', antes, despues, cambiados };
  } catch (e) {
    return { estado: 'ERROR', mensaje: 'No se pudo revisar si hay versión nueva: ' + String((e && (e.stderr || e.message)) || e).replace(/\s+/g, ' ').slice(0, 200) };
  }
}

/** La versión con que está la carpeta ahora (o '' si no se sabe). */
function head(proyecto, ejecutar) {
  try { return (ejecutar || ejecutarPorDefecto)('git', ['rev-parse', 'HEAD'], { cwd: proyecto }); } catch (e) { return ''; }
}

module.exports = { revisar, head };
