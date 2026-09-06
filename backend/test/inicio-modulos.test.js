'use strict';

/**
 * getInicio no puede ser la puerta de atrás al control de módulo.
 *
 * El control de módulo vive en el ROUTER: `MODULO_POR_ACCION` dice qué acción
 * pide qué módulo y `doPost` rechaza antes de llamar al handler. `getInicio`
 * no puede estar en esa tabla, porque no pide UN módulo sino uno distinto por
 * cada bloque — y esa excepción fue, durante un tiempo, un agujero real.
 *
 * MEDIDO por el camino real, con una cuenta GERENCIA sin el módulo `bandeja`:
 *
 *     getDashboardData               ->  forbidden, "no tiene acceso (bandeja)"
 *     getInicio bloques=['bandeja']  ->  ok, con resumen/por_empresa/por_tipo…
 *
 * Es decir: pedir el bloque era la forma de obtener los datos que la acción
 * suelta negaba.
 *
 * Estas pruebas van por `doPost` con un token de verdad, NO llamando a
 * `Inicio.getResumen` directamente. Llamar al módulo por dentro se saltaría
 * justo la capa donde vive el fallo, y pasaría en verde con el agujero
 * abierto.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

const HOJAS_BASE = [
  'SOLICITUDES', 'SUBSOLICITUDES', 'HISTORIAL_ESTADOS', 'HISTORIAL_PRIORIDAD',
  'HISTORIAL_COMPROMISO', 'HISTORIAL_ASIGNACION', 'COMENTARIOS', 'ARCHIVOS',
  'USUARIOS', 'LOG_NOTIFICACIONES', 'LOG_SISTEMA', 'CONFIG_FERIADOS',
  'CONFIG_SLA', 'CONFIG_NOTIFICACIONES'
];

function cuentaCon(rol, modulos) {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' },
    activeUserEmail: ''   // sin Google: solo el token identifica
  });
  HOJAS_BASE.forEach((h) => seedSheet(ctx, h, ctx.COLUMNAS[h]));
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL, [
    ['CTA-1', 'leo', 'Leo Estay', 'Desarrollador', 'hash-x', 'sal-x',
      JSON.stringify(['leo@rld.cl']), rol, JSON.stringify(modulos),
      'RLD', true, false, '', 'test']
  ]);
  seedSheet(ctx, 'SESIONES_PORTAL', ctx.COLUMNAS.SESIONES_PORTAL, [
    ['token-vigente', 'CTA-1', new Date(Date.now() + 3600000).toISOString(), new Date().toISOString()]
  ]);
  return ctx;
}

function pedir(ctx, action, data) {
  return JSON.parse(ctx.doPost({
    postData: {
      contents: JSON.stringify({ action: action, data: Object.assign({ portal_token: 'token-vigente' }, data || {}) }),
      type: 'text/plain'
    }
  }).getContent());
}

const bloquesDe = (r) => (r.data && r.data.bloques) || {};

test('un bloque da EXACTAMENTE lo que daría su acción suelta', () => {
  // La invariante de fondo: pedir por getInicio no puede conseguir nada que
  // pedir la acción directa niegue.
  const ctx = cuentaCon('GERENCIA', ['nueva_solicitud', 'mis_solicitudes', 'gerencia']);

  const suelta = pedir(ctx, 'getDashboardData');
  assert.equal(suelta.ok, false, 'la acción suelta debe negarse: la cuenta no tiene bandeja');
  assert.equal(suelta.error, 'forbidden');

  const porBloque = bloquesDe(pedir(ctx, 'getInicio', { bloques: ['bandeja'] }));
  assert.equal(porBloque.bandeja.ok, false, 'y el bloque tiene que negarse igual');
  assert.equal(porBloque.bandeja.data, undefined, 'un rechazo no puede traer datos adjuntos');
});

test('cada bloque respeta el módulo de SU acción, no uno genérico', () => {
  // GERENCIA no tiene bandeja, jefatura, pausas ni mi_trabajo; SÍ tiene
  // gerencia, y el gate de los documentos del SGC es ['calidad','gerencia'].
  // Si el control fuera un módulo único para toda la acción, calidad caería
  // con el resto -- y sería un rechazo incorrecto.
  const ctx = cuentaCon('GERENCIA', ['nueva_solicitud', 'mis_solicitudes', 'gerencia']);
  const b = bloquesDe(pedir(ctx, 'getInicio', {
    bloques: ['bandeja', 'jefatura', 'pausas', 'mi_trabajo', 'calidad']
  }));

  assert.equal(b.bandeja.ok, false, 'bandeja pide el módulo bandeja');
  assert.equal(b.jefatura.ok, false, 'jefatura pide el módulo jefatura');
  assert.equal(b.pausas.ok, false, 'pausas pide el módulo pausas');
  assert.equal(b.mi_trabajo.ok, false, 'mi_trabajo pide mi_trabajo o jefatura');
  assert.equal(b.calidad.ok, true,
    'calidad pide calidad O gerencia: esta cuenta tiene gerencia y debe pasar');
});

test('quien SÍ tiene el módulo recibe su bloque', () => {
  // La otra mitad: una guarda que niega de más rompe el Inicio de todo el
  // mundo, y eso se nota tarde porque la pantalla simplemente sale a medias.
  const ctx = cuentaCon('DEV', ['nueva_solicitud', 'mis_solicitudes', 'bandeja', 'mi_trabajo']);
  const b = bloquesDe(pedir(ctx, 'getInicio', { bloques: ['bandeja', 'mi_trabajo', 'calidad'] }));

  assert.equal(b.bandeja.ok, true, 'tiene bandeja');
  assert.ok(b.bandeja.data, 'y con sus datos');
  assert.equal(b.mi_trabajo.ok, true, 'tiene mi_trabajo');
  assert.equal(b.calidad.ok, false, 'no tiene calidad ni gerencia');
});

test('el módulo de cada bloque sale de MODULO_POR_ACCION, no de una copia', () => {
  // Si los módulos se escribieran a mano en Inicio.gs, cambiar el gate de una
  // acción dejaría el bloque con el permiso viejo, en silencio. Se comprueba
  // que el mapa apunta a acciones REALES y que la tabla del router es la que
  // manda.
  const ctx = cuentaCon('ADM', ['bandeja']);
  const mapa = ctx.ACCION_DEL_BLOQUE_INICIO;

  Object.keys(mapa).forEach((bloque) => {
    const accion = mapa[bloque];
    assert.ok(ctx.BACKOFFICE_ACTIONS[accion],
      'el bloque ' + bloque + ' apunta a "' + accion + '", que no es una acción del router');
    assert.ok(ctx.MODULO_POR_ACCION[accion],
      'la acción "' + accion + '" no tiene módulo declarado: el bloque quedaría abierto');
  });
});

test('sin lista de módulos (identidad de Google) no se aplica el control', () => {
  // El gate del router vive dentro de la rama del portal: por el enlace de
  // Google no hay módulos que comprobar. El bloque tiene que seguir el MISMO
  // criterio, o quien entra por ahí se quedaría con un Inicio vacío.
  const ctx = cuentaCon('ADM', ['bandeja']);
  assert.equal(ctx.cuentaTieneElModuloDelBloque_('calidad', { email: 'a@x.cl', rol: 'ADM' }), true);
  assert.equal(ctx.cuentaTieneElModuloDelBloque_('calidad', { email: 'a@x.cl', rol: 'ADM', modulos: [] }), true);
  assert.equal(ctx.cuentaTieneElModuloDelBloque_('calidad', { email: 'a@x.cl', rol: 'ADM', modulos: ['bandeja'] }), false);
});
