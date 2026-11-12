'use strict';

/**
 * Robots de Finanzas con varios meses (12-11-2026; controlInternoRobot.js, robotBci.js, robotSii.js, agente.js).
 *  - Qué cartolas se traen para un rango y cómo queda cada mes.
 *  - Un pedido de varios meses solo lo toma un programa del PC que sepa de meses (uno antiguo no: se dice).
 *  - El PC entrega cada archivo apenas lo baja: la pantalla ve lo que va llegando, sin el contenido (se pide aparte), y lo
 *    llegado no se pierde aunque el robot se detenga después. Al final no se repite nada.
 *  - En Finanzas: «desde/hasta» validado; la bitácora dice el rango.
 * Datos inventados.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const RB = require('../logica/controlInternoRobot');
const Bci = require('../logica/robotBci');
const B = require('../logica/finanzasBoveda');
const { preparar } = require('./_finanzasPrueba');
const { ACCIONES } = require('../server/router');
const ejecutarAccion = (db, n, data, ctx) => ACCIONES[n](db, data, ctx);

const ADM = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: [] };
const xls = (s) => Buffer.from(s).toString('base64');
const cartola = (n, f) => ({ nombre: 'Cartola BCI N° ' + n + ' del ' + f + '.xlsx', numero: n, fecha: f, base64: xls('PK-' + n) });

function dbVacia() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  return db;
}

test('rango de meses: qué cartolas se traen y cómo queda cada mes', () => {
  assert.deepEqual(Bci.meses_('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepEqual(Bci.meses_('2026-05'), ['2026-05']);
  const filas = [{ numero: '022', fecha: '2026-10-30' }, { numero: '021', fecha: '2026-10-19' }, { numero: '020', fecha: '2026-09-30' },
    { numero: '019', fecha: '2026-09-16' }, { numero: '018', fecha: '2026-08-31' }, { numero: '017', fecha: '2026-08-14' }];
  assert.deepEqual(Bci.elegir_(filas, '2026-08', '2026-09').map((f) => f.numero), ['017', '018', '019', '020', '021'], 'el rango y la primera del mes siguiente');
  assert.deepEqual(Bci.elegir_(filas, '2026-09').map((f) => f.numero), ['019', '020', '021'], 'un mes, como siempre');
  const lista = Bci.meses_('2026-06', '2026-09');
  const archivos = [{ numero: '017', fecha: '2026-08-14' }, { numero: '019', fecha: '2026-09-16' }, { numero: '021', fecha: '2026-10-19' }];
  const m = Bci.resumenMeses_(lista, archivos, [{ numero: '018', fecha: '2026-08-31' }, { numero: '020', fecha: '2026-09-30' }], filas);
  assert.deepEqual(m.map((x) => [x.periodo, x.estado, x.numeros.join('/')]), [
    ['2026-06', 'SIN_CARTOLAS', ''], ['2026-07', 'SIN_CARTOLAS', ''], ['2026-08', 'INCOMPLETO', '017'], ['2026-09', 'INCOMPLETO', '019/021']]);
  assert.match(m[0].mensaje, /solo desde el 14-08-2026/, 'un mes anterior a lo que muestra el banco lo dice');
});

test('PC de la oficina: varios meses solo con un programa que sabe; entrega por partes, sin repetir y sin perder lo llegado', async () => {
  const db = dbVacia();
  RB._reiniciar();
  try {
    const a = RB.crearAgente(db, { nombre: 'PC oficina' }, ADM).llave;
    // Un programa que sabe del BCI pero no de meses: un mes sí, varios no (y se dice por qué).
    const viejo = RB.agenteTomar(db, { agente_token: a, capacidades: 'lote,bci,sii' });
    const r0 = RB.iniciarBanco_(db, { email: 'uno@demo.cl', periodo: '2026-01', hasta: '2026-03' });
    assert.equal(r0.ok, false);
    assert.match(r0.message, /todavía no sabe traer varios meses/);
    assert.equal(RB.generalBanco_(db).meses, false);
    RB._reiniciar();
    void viejo;

    const tomar = RB.agenteTomar(db, { agente_token: a, capacidades: 'lote,bci,sii,meses,parcial' });
    assert.equal(RB.generalBanco_(db).meses_max, 12);
    assert.match(RB.iniciarBanco_(db, { email: 'uno@demo.cl', periodo: '2026-05', hasta: '2026-03' }).message, /no puede ser antes/);
    assert.match(RB.iniciarBanco_(db, { email: 'uno@demo.cl', periodo: '2025-01', hasta: '2026-01' }).message, /Hasta 12 meses/);
    const r = RB.iniciarBanco_(db, { email: 'uno@demo.cl', periodo: '2026-07', hasta: '2026-09', rut_empresa: '78.194.394-0' });
    assert.equal(r.ok, true, r.message);
    const { trabajo } = await tomar;
    assert.deepEqual([trabajo.periodo, trabajo.hasta], ['2026-07', '2026-09']);
    assert.match(RB.iniciarBanco_(db, { email: 'otro@demo.cl', periodo: '2026-09', tipo: 'SII_VENTAS' }).message, /ocupado con las cartolas de 2026-07 a 2026-09/, 'el otro robot dice en qué está');

    // Llegan dos cartolas y julio queda listo: la pantalla lo ve sin el contenido.
    assert.equal(RB.agenteParcial(db, { agente_token: a, trabajo_id: r.trabajo_id, archivo: cartola('015', '2026-07-15') }).ok, true);
    RB.agenteParcial(db, { agente_token: a, trabajo_id: r.trabajo_id, archivo: cartola('016', '2026-07-31') });
    RB.agenteParcial(db, { agente_token: a, trabajo_id: r.trabajo_id, archivo: cartola('016', '2026-07-31') });
    assert.equal(RB.agenteParcial(db, { agente_token: a, trabajo_id: r.trabajo_id, archivo: { nombre: 'virus.exe', base64: xls('MZ') } }).ok, false, 'lo que no es una cartola no entra');
    RB.agenteParcial(db, { agente_token: a, trabajo_id: r.trabajo_id, mes: { periodo: '2026-07', estado: 'OK', numeros: ['015', '016'] } });
    RB.agentePaso(db, { agente_token: a, trabajo_id: r.trabajo_id, paso: 'Cartola 3 de 6 · N° 017 del 14-08-2026' });
    let e = RB.estadoBanco_(r.trabajo_id, 'uno@demo.cl');
    assert.deepEqual([e.estado, e.n_meses, e.avance.archivos.map((f) => f.numero), e.avance.archivos[0].base64, e.avance.meses.map((m) => m.periodo)],
      ['EN_CURSO', 3, ['015', '016'], undefined, ['2026-07']]);
    assert.equal(Buffer.from(RB.archivoBanco_(r.trabajo_id, 'uno@demo.cl', 'BCI', cartola('015', '2026-07-15').nombre).archivo.base64, 'base64').toString(), 'PK-015', 'lo llegado se puede revisar mientras sigue trabajando');

    // El robot se detiene en septiembre: la entrega final trae lo que no había llegado; nada se repite ni se pierde.
    RB.agenteEntregar(db, { agente_token: a, trabajo_id: r.trabajo_id, resultado: { estado: 'SIN_RESPUESTA', mensaje: 'El banco no respondió (detalle de la cartola N° 019).',
      archivos: [cartola('016', '2026-07-31'), cartola('017', '2026-08-14')], meses: [{ periodo: '2026-08', estado: 'OK', numeros: ['017'] }, { periodo: '2026-09', estado: 'FALLO', mensaje: 'No se pudo bajar la N° 019' }] } });
    e = RB.estadoBanco_(r.trabajo_id, 'uno@demo.cl');
    assert.equal(e.estado, 'LISTO', 'trajo algo: se puede importar');
    assert.deepEqual(e.resultado.archivos.map((f) => f.numero), ['015', '016', '017']);
    assert.deepEqual(e.resultado.meses.map((m) => m.periodo + ':' + m.estado), ['2026-07:OK', '2026-08:OK', '2026-09:FALLO']);
    assert.match(e.resultado.mensaje, /3 archivo\(s\) alcanzaron a llegar/);
    assert.equal(e.avance, null);
    assert.equal(RB.generalBanco_(db).ocupado, false);
  } finally { RB._reiniciar(); }
});

test('en Finanzas: desde/hasta, lo que va llegando y la bitácora con el rango', async (t) => {
  const { db, ctx, D } = preparar(t, { soloLectura: true });
  RB._reiniciar();
  let recibido = null;
  RB._usarBanco(async (datos, o) => {
    recibido = datos;
    await o.alArchivo(cartola('017', '2026-08-14'));
    o.alMes({ periodo: '2026-08', estado: 'OK', numeros: ['017'] });
    return { estado: 'OK', mensaje: '2 cartolas descargadas de 2026-08 a 2026-09.', archivos: [cartola('017', '2026-08-14'), cartola('019', '2026-09-16')],
      meses: [{ periodo: '2026-08', estado: 'OK', numeros: ['017'] }, { periodo: '2026-09', estado: 'OK', numeros: ['019'] }] };
  });
  try {
    assert.equal(ejecutarAccion(db, 'finanzasRobotBciIniciar', D({ periodo: '2026-08', hasta: '2026-13' }), ctx)._validationError, true);
    const r = ejecutarAccion(db, 'finanzasRobotBciIniciar', D({ periodo: '2026-08', hasta: '2026-09' }), ctx);
    assert.ok(r.trabajo_id, r.message);
    await RB._esperar(r.trabajo_id);
    assert.deepEqual([recibido.periodo, recibido.hasta], ['2026-08', '2026-09']);
    const e = ejecutarAccion(db, 'finanzasRobotBciEstado', D({ trabajo_id: r.trabajo_id }), ctx);
    assert.deepEqual([e.estado, e.hasta, e.resultado.archivos.map((f) => f.numero), e.resultado.meses.length], ['LISTO', '2026-09', ['017', '019'], 2]);
    const f = ejecutarAccion(db, 'finanzasRobotBciArchivo', D({ trabajo_id: r.trabajo_id, nombre: e.resultado.archivos[1].nombre }), ctx);
    assert.equal(Buffer.from(f.archivo.base64, 'base64').toString(), 'PK-019');
    assert.equal(ejecutarAccion(db, 'finanzasRobotBciArchivo', D({ trabajo_id: r.trabajo_id, nombre: 'otro.xlsx' }), ctx)._validationError, true);
    const bit = B.dbFin().prepare("SELECT detalle FROM FIN_BITACORA WHERE accion = 'ROBOT_BCI' ORDER BY id").all().map((x) => x.detalle);
    assert.deepEqual(bit, ['Pidió las cartolas de 2026-08 a 2026-09 (entrada a mano en el PC de la oficina)', '2026-08 a 2026-09 · OK · N° 017, N° 019']);
  } finally { RB._reiniciar(); }
});
