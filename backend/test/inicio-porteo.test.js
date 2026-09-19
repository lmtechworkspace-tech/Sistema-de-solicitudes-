'use strict';

/**
 * Prueba de portabilidad: Inicio.getResumen (Inicio.gs, M-02), corrida
 * contra inicio.js. Escenarios adaptados de backend/test/inicio-una-llamada
 * .test.js (el .gs, vía gasSandbox): que solo traiga los bloques pedidos,
 * que una fuente que revienta no tumbe a las demás, que un rechazo llegue
 * como {ok:false} sin datos adjuntos, y que cada bloque delegue en la MISMA
 * función Node que atiende su acción suelta (con el contexto intacto).
 *
 * El gate de módulo por bloque (cuentaTieneElModuloDelBloque_ en el .gs)
 * NO se porta -- decisión consciente, ver la cabecera de inicio.js -- así
 * que, a diferencia de inicio-modulos.test.js (el .gs), acá NO hay pruebas
 * de "una cuenta sin el módulo X se queda sin el bloque X": ese gate no
 * existe todavía en Node para ninguna acción.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Inicio = require('../logica/inicio');
const Actividades = require('../logica/actividades');
const Calidad = require('../logica/calidadSgc');
const Dashboard = require('../logica/dashboard');
const Jefatura = require('../logica/jefatura');
const Pausas = require('../logica/pausas');

function db_() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  return db;
}

const ADM = { email: 'adm@x.cl', nombre: 'Ada Admin', rol: 'ADM' };
const TODOS = ['mi_trabajo', 'calidad', 'bandeja', 'jefatura', 'pausas'];

test('getInicio: solo trae los bloques que se piden', () => {
  const db = db_();
  const r = Inicio.getResumen(db, { bloques: ['mi_trabajo', 'pausas'] }, ADM);
  assert.deepEqual(Object.keys(r.bloques).sort(), ['mi_trabajo', 'pausas']);
  assert.equal(r.bloques.calidad, undefined, 'no debe traer lo que nadie pidió');
});

test('getInicio: sin lista de bloques no trae ninguno', () => {
  const db = db_();
  assert.deepEqual(Inicio.getResumen(db, {}, ADM).bloques, {});
  assert.deepEqual(Inicio.getResumen(db, null, ADM).bloques, {});
});

test('getInicio: cada bloque llega con la misma forma {ok, data} que tenía su acción suelta', () => {
  const db = db_();
  const r = Inicio.getResumen(db, { bloques: TODOS }, ADM);
  TODOS.forEach((b) => {
    assert.ok(r.bloques[b], 'falta el bloque ' + b);
    assert.equal(typeof r.bloques[b].ok, 'boolean', 'el bloque ' + b + ' debe traer {ok, data}');
  });
});

test('getInicio: una fuente que revienta NO se lleva a las demás', () => {
  const db = db_();
  const original = Pausas.getPausaHoyTrabajador;
  Pausas.getPausaHoyTrabajador = () => { throw new Error('fallo simulado'); };
  try {
    const r = Inicio.getResumen(db, { bloques: TODOS }, ADM);
    assert.equal(r.bloques.pausas.ok, false, 'la que falló se marca como fallida');
    assert.ok(r.bloques.mi_trabajo.ok, 'y las demás llegan igual');
    assert.ok(r.bloques.calidad.ok);
    assert.ok(r.bloques.bandeja.ok);
  } finally {
    Pausas.getPausaHoyTrabajador = original;
  }
});

test('getInicio: un bloque rechazado por permisos vuelve como {ok:false}, no como datos', () => {
  const db = db_();
  const original = Jefatura.getPanel;
  Jefatura.getPanel = () => ({ _forbidden: true, message: 'No tienes acceso.' });
  try {
    const r = Inicio.getResumen(db, { bloques: ['jefatura', 'calidad'] }, ADM);
    assert.equal(r.bloques.jefatura.ok, false);
    assert.equal(r.bloques.jefatura.data, undefined, 'un rechazo no puede traer datos adjuntos');
    assert.ok(r.bloques.calidad.ok, 'y no contamina al resto');
  } finally {
    Jefatura.getPanel = original;
  }
});

test('getInicio NO decide permisos: delega en quien ya los decidía, con el contexto intacto', () => {
  const db = db_();
  const vistos = [];
  const modulos = { Actividades, Calidad, Dashboard, Jefatura, Pausas };
  const metodos = {
    Actividades: 'listar', Calidad: 'listarDocumentos', Dashboard: 'getData',
    Jefatura: 'getPanel', Pausas: 'getPausaHoyTrabajador'
  };
  const originales = {};
  Object.keys(metodos).forEach((nombreModulo) => {
    const met = metodos[nombreModulo];
    originales[nombreModulo] = modulos[nombreModulo][met];
    modulos[nombreModulo][met] = function (dbArg, data, contexto) {
      vistos.push({ ruta: nombreModulo + '.' + met, email: contexto && contexto.email, rol: contexto && contexto.rol });
      return originales[nombreModulo].apply(this, arguments);
    };
  });
  try {
    Inicio.getResumen(db, { bloques: TODOS }, ADM);
    assert.equal(vistos.length, 5, 'los cinco bloques deben delegar');
    vistos.forEach((v) => {
      assert.equal(v.email, 'adm@x.cl', v.ruta + ' recibió otro email');
      assert.equal(v.rol, 'ADM', v.ruta + ' recibió otro rol: el contexto debe pasar intacto');
    });
  } finally {
    Object.keys(metodos).forEach((nombreModulo) => { modulos[nombreModulo][metodos[nombreModulo]] = originales[nombreModulo]; });
  }
});

test('getInicio: mi_trabajo se pide con el correo de quien mira, no con el de otro', () => {
  const db = db_();
  let recibido = null;
  const original = Actividades.listar;
  Actividades.listar = function (dbArg, data, contexto) { recibido = data; return original.apply(this, arguments); };
  try {
    Inicio.getResumen(db, { bloques: ['mi_trabajo'] }, { email: 'dev@x.cl', rol: 'DEV' });
    assert.equal(recibido.responsable_email, 'dev@x.cl');
  } finally {
    Actividades.listar = original;
  }
});
