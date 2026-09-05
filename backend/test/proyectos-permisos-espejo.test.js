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
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const FRONT = path.join(RAIZ, 'frontend/js/proyectos.js');
const BACK = path.join(RAIZ, 'backend/backoffice/Proyectos.gs');

test('el frontend de Proyectos no repite a mano la regla de "quien puede aportar"', () => {
  const fuente = fs.readFileSync(FRONT, 'utf8');
  const sueltas = fuente.split('\n')
    .map((linea, i) => ({ n: i + 1, linea: linea.trim() }))
    .filter((l) => /rol_actual\s*!==\s*'OBSERVADOR'/.test(l.linea))
    // La unica aparicion legitima es dentro del propio helper.
    .filter((l) => !/^return\s+!!detalle\.rol_actual/.test(l.linea));

  assert.deepEqual(
    sueltas, [],
    'Hay ' + sueltas.length + ' lugar(es) que vuelven a escribir la condicion a mano ' +
    'en vez de llamar a puedeAportar_(detalle):\n' +
    sueltas.map((l) => '  linea ' + l.n + ': ' + l.linea).join('\n') +
    '\nEsa duplicacion es la que dejo al ADM sin controles en cuatro pestañas.'
  );
});

test('puedeAportar_ existe y contempla puede_gestionar (el caso del ADM)', () => {
  const fuente = fs.readFileSync(FRONT, 'utf8');
  assert.ok(/function puedeAportar_\(/.test(fuente), 'falta el helper puedeAportar_');

  const cuerpo = fuente.slice(fuente.indexOf('function puedeAportar_('));
  const hasta = cuerpo.slice(0, cuerpo.indexOf('\n  }') + 4);
  assert.ok(
    /detalle\.puede_gestionar\s*===\s*true/.test(hasta),
    'puedeAportar_ tiene que aceptar puede_gestionar: es la unica via por la que ' +
    'un ADM que no pertenece al proyecto obtiene los controles que el backend si le concede.'
  );
  assert.ok(
    /rol_actual\s*!==\s*'OBSERVADOR'/.test(hasta),
    'puedeAportar_ tiene que seguir excluyendo al OBSERVADOR.'
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
    const i = fuente.indexOf('\n  ' + accion + ': function');
    if (i === -1) return true;                       // la accion ya no existe
    const bloque = fuente.slice(i, i + 1400);
    return !/contexto\.rol === 'ADM'/.test(bloque);
  });
  assert.deepEqual(
    sinAdm, [],
    'Estas acciones dejaron de conceder al ADM: ' + sinAdm.join(', ') +
    '. Si el cambio es intencional, hay que ajustar puedeAportar_ en el frontend.'
  );

  // publicarEnSala usa la forma equivalente, escrita distinto.
  const iSala = fuente.indexOf('\n  publicarEnSala: function');
  assert.ok(iSala !== -1, 'publicarEnSala ya no existe');
  assert.ok(
    /contexto\.rol === 'ADM'/.test(fuente.slice(iSala, iSala + 900)),
    'publicarEnSala dejo de conceder al ADM.'
  );
});
