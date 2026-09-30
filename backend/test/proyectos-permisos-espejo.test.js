'use strict';

/**
 * Fase 6: el frontend de Proyectos NO puede esconder lo que el backend concede.
 *
 * EL DEFECTO QUE MOTIVA ESTE TEST. Entrando como ADM a un proyecto donde no se
 * es miembro, cuatro pestañas (Sala, Entregables, Documentos, Riesgos) se
 * mostraban SIN un solo control -- ni siquiera un boton para crear el primer
 * elemento. No era una restriccion de permisos: las siete acciones que mutan
 * un proyecto abren en el backend con
 *
 *     contexto.rol === 'ADM' || rol en {LIDER, INTEGRANTE, COLABORADOR}
 *
 * mientras que el frontend repetia, en OCHO lugares distintos, la condicion
 *
 *     detalle.rol_actual && detalle.rol_actual !== 'OBSERVADOR'
 *
 * que para un ADM ajeno al proyecto es falsa: su rol_actual viene vacio. La
 * regla estaba escrita dos veces y divergio en silencio -- nada fallaba, la
 * interfaz simplemente no ofrecia la accion.
 *
 * POR QUE UN TEST QUE LEE EL FUENTE. La suite corre el backend en un sandbox;
 * el frontend no se ejecuta aqui. Pero el riesgo real no es que la funcion se
 * rompa: es que alguien vuelva a escribir la condicion a mano en una pestaña
 * nueva, como paso siete veces. Eso SI se puede detectar leyendo el archivo, y
 * es el mismo criterio de fuentes-texto.test.js.
 *
 * 2026-09-30: el frontend clásico (proyectos.js) se borró; la regla vive ahora
 * en PY.puedeAportar (proyectos-v2/nucleo.js) y se vigila toda la carpeta v2.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const DIR_V2 = path.join(RAIZ, 'frontend/js/proyectos-v2');
const NUCLEO = path.join(DIR_V2, 'nucleo.js');
const BACK = path.join(RAIZ, 'backend/logica/proyectos.js');

test('el frontend de Proyectos no repite a mano la regla de "quien puede aportar"', () => {
  const sueltas = [];
  fs.readdirSync(DIR_V2).filter((f) => f.endsWith('.js')).forEach((f) => {
    fs.readFileSync(path.join(DIR_V2, f), 'utf8').split('\n')
      .map((linea, i) => ({ n: f + ':' + (i + 1), linea: linea.trim() }))
      .filter((l) => /rol_actual\s*!==\s*'OBSERVADOR'/.test(l.linea))
      // La unica aparicion legitima es dentro del propio helper.
      .filter((l) => !(l.n.startsWith('nucleo.js:') && /^return\s+!!detalle\.rol_actual/.test(l.linea)))
      .forEach((l) => sueltas.push(l));
  });

  assert.deepEqual(
    sueltas, [],
    'Hay ' + sueltas.length + ' lugar(es) que vuelven a escribir la condicion a mano ' +
    'en vez de llamar a PY.puedeAportar(detalle):\n' +
    sueltas.map((l) => '  linea ' + l.n + ': ' + l.linea).join('\n') +
    '\nEsa duplicacion es la que dejo al ADM sin controles en cuatro pestañas.'
  );
});

test('PY.puedeAportar existe y contempla puede_gestionar (el caso del ADM)', () => {
  const fuente = fs.readFileSync(NUCLEO, 'utf8');
  assert.ok(/function puedeAportar\(/.test(fuente), 'falta el helper puedeAportar');

  const cuerpo = fuente.slice(fuente.indexOf('function puedeAportar('));
  const hasta = cuerpo.slice(0, cuerpo.indexOf('\n  }') + 4);
  assert.ok(
    /detalle\.puede_gestionar\s*===\s*true/.test(hasta),
    'puedeAportar tiene que aceptar puede_gestionar: es la unica via por la que ' +
    'un ADM que no pertenece al proyecto obtiene los controles que el backend si le concede.'
  );
  assert.ok(
    /rol_actual\s*!==\s*'OBSERVADOR'/.test(hasta),
    'puedeAportar tiene que seguir excluyendo al OBSERVADOR.'
  );
});

test('el backend sigue concediendo esas acciones al ADM', () => {
  // Si esta regla cambiara en el backend, el espejo del frontend quedaria de
  // mas -- y hay que enterarse aca, no por una pantalla que ofrece un boton
  // que el servidor rechaza.
  const fuente = fs.readFileSync(BACK, 'utf8');
  const ACCIONES = [
    'crearTarea', 'gestionarReunion', 'gestionarDecision',
    'gestionarEntregable', 'gestionarRiesgo', 'gestionarDocumento'
  ];
  const sinAdm = ACCIONES.filter((accion) => {
    const m = fuente.match(new RegExp('\\n(async )?function ' + accion + '\\('));
    const i = m ? m.index : -1;
    if (i === -1) return true;                       // la accion ya no existe
    const bloque = fuente.slice(i, i + 1400);
    return !/contexto\.rol === 'ADM'/.test(bloque);
  });
  assert.deepEqual(
    sinAdm, [],
    'Estas acciones dejaron de conceder al ADM: ' + sinAdm.join(', ') +
    '. Si el cambio es intencional, hay que ajustar PY.puedeAportar (proyectos-v2/nucleo.js).'
  );

  // publicarEnSala usa la forma equivalente, escrita distinto.
  const iSala = fuente.indexOf('\nfunction publicarEnSala(');
  assert.ok(iSala !== -1, 'publicarEnSala ya no existe');
  assert.ok(
    /contexto\.rol === 'ADM'/.test(fuente.slice(iSala, iSala + 900)),
    'publicarEnSala dejo de conceder al ADM.'
  );
});
