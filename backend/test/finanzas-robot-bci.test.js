'use strict';

/**
 * Robot de cartolas del BCI (03-11-2026; robotBci.js, controlInternoRobot.js, finanzasRobotBci.js).
 *  - Qué cartolas trae para un mes (las del mes y la primera del siguiente).
 *  - El PC de la oficina toma el pedido solo si su programa sabe hacerlo; la clave del banco no queda en ninguna parte;
 *    lo que entrega el PC se valida y solo lo ve quien lo pidió.
 *  - En Finanzas: bóveda + REGISTRAR para pedir; queda en la bitácora sin la clave.
 *  - De punta a punta contra un sitio local que imita el BCI Pyme: ingreso, Cuentas › Cartola Histórica, flecha,
 *    Exportar › Descargar Excel, salir; y una clave mala se intenta UNA vez. Necesita Chrome o Edge: se salta sin
 *    navegador o en CI. Datos inventados.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { abrirDb_, sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const RB = require('../logica/controlInternoRobot');
const Bci = require('../logica/robotBci');
const PdfChromium = require('../logica/pdfChromium');
const B = require('../logica/finanzasBoveda');
const { preparar } = require('./_finanzasPrueba');
const { ACCIONES } = require('../server/router');
const ejecutarAccion = (db, n, data, ctx) => ACCIONES[n](db, data, ctx);

const ADM = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: [] };
const CLAVE = 'Clave-Banco-De-Prueba-9';
const xls = (s) => Buffer.from(s).toString('base64');

function dbVacia() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  return db;
}

test('qué cartolas trae: las del mes y la primera del siguiente (los últimos días del mes)', () => {
  const filas = [{ numero: '022', fecha: '2026-10-30' }, { numero: '021', fecha: '2026-10-19' }, { numero: '020', fecha: '2026-09-30' },
    { numero: '019', fecha: '2026-09-16' }, { numero: '018', fecha: '2026-08-31' }, { numero: '019', fecha: '2026-09-16' }];
  assert.deepEqual(Bci.elegir_(filas, '2026-09').map((f) => f.numero), ['019', '020', '021']);
  assert.deepEqual(Bci.elegir_(filas, '2026-10').map((f) => f.numero), ['021', '022'], 'el mes en curso: sin la siguiente, que aún no existe');
  assert.deepEqual(Bci.elegir_(filas, '2026-11'), [], 'un mes sin cartolas no trae nada');
  assert.equal(Bci.rutTeclas_('12.345.678-5'), '123456785');
  assert.equal(Bci.rutTeclas_('1-9'), '');
});

test('PC de la oficina: lo toma solo un programa que sabe; la clave se entrega una vez y lo traído se valida', async () => {
  const db = dbVacia();
  RB._reiniciar();
  const a = RB.crearAgente(db, { nombre: 'PC oficina' }, ADM).llave;
  // Un programa antiguo (solo sabe del TGR) no sirve: se dice que hay que actualizarlo.
  const viejo = RB.agenteTomar(db, { agente_token: a, capacidades: 'lote' });
  const r0 = RB.iniciarBanco_(db, { email: 'uno@demo.cl', periodo: '2026-09', rut: '12.345.678-5', clave: CLAVE });
  assert.equal(r0.sin_agente, true);
  assert.match(r0.message, /versión anterior/);
  RB._reiniciar();
  void viejo;

  const tomar = RB.agenteTomar(db, { agente_token: a, capacidades: 'lote,bci' });
  const pedido = { email: 'Uno@demo.cl', periodo: '2026-09', rut: '12.345.678-5', clave: CLAVE };
  const r = RB.iniciarBanco_(db, pedido);
  assert.equal(r.ok, true);
  assert.equal(pedido.clave, '', 'el pedido suelta la clave');
  const { trabajo } = await tomar;
  assert.deepEqual([trabajo.tipo, trabajo.periodo, trabajo.rut, trabajo.clave], ['BCI', '2026-09', '12345678-5', CLAVE]);
  assert.equal(RB.iniciarBanco_(db, { email: 'uno@demo.cl', periodo: '2026-09' }).ocupado, true, 'un robot a la vez');
  RB.agentePaso(db, { agente_token: a, trabajo_id: r.trabajo_id, paso: 'Descargando la cartola N° 019' });
  let e = RB.estadoBanco_(r.trabajo_id, 'uno@demo.cl');
  assert.deepEqual([e.estado, e.paso, e.asistido], ['EN_CURSO', 'Descargando la cartola N° 019', false]);
  assert.ok(!JSON.stringify(e).includes(CLAVE), 'la clave no queda en el trabajo');
  RB.agenteEntregar(db, { agente_token: a, trabajo_id: r.trabajo_id, resultado: { estado: 'OK', mensaje: '2 cartolas descargadas.',
    archivos: [{ nombre: 'Cartola BCI N° 019 del 2026-09-16.xlsx', numero: '019', fecha: '2026-09-16', base64: xls('PK-019') },
      { nombre: 'virus.exe', numero: '1', fecha: '2026-09-30', base64: xls('MZ') }, { nombre: 'x.xlsx', base64: '<script>' }],
    disponibles: [{ numero: '019', fecha: '2026-09-16' }] } });
  e = RB.estadoBanco_(r.trabajo_id, 'uno@demo.cl');
  assert.equal(e.estado, 'LISTO');
  assert.deepEqual(e.resultado.archivos.map((f) => [f.nombre, f.numero, Buffer.from(f.base64, 'base64').toString()]), [['Cartola BCI N° 019 del 2026-09-16.xlsx', '019', 'PK-019']], 'solo Excel con contenido válido');
  assert.equal(RB.estadoBanco_(r.trabajo_id, 'otra@demo.cl')._forbidden, true, 'solo quien lo pidió');
  // Sin clave: asistido (alguien entra a mano en el PC).
  const t2 = RB.agenteTomar(db, { agente_token: a, capacidades: 'lote,bci' });
  const r2 = RB.iniciarBanco_(db, { email: 'uno@demo.cl', periodo: '2026-10' });
  const w2 = (await t2).trabajo;
  assert.deepEqual([w2.clave, w2.rut, RB.estadoBanco_(r2.trabajo_id, 'uno@demo.cl').asistido], ['', '', true]);
  RB.agenteEntregar(db, { agente_token: a, trabajo_id: r2.trabajo_id, resultado: { estado: 'SIN_INGRESO', mensaje: 'Nadie entró al banco.', archivos: [] } });
  assert.deepEqual([RB.estadoBanco_(r2.trabajo_id, 'uno@demo.cl').estado, RB.estadoBanco_(r2.trabajo_id, 'uno@demo.cl').resultado.estado], ['DETENIDO', 'SIN_INGRESO']);
  RB._reiniciar();
});

test('en Finanzas: bóveda y REGISTRAR para pedir; la bitácora no guarda la clave', async (t) => {
  const { db, ctx, ctx2, D, D2 } = preparar(t, { soloLectura: true });
  RB._reiniciar();
  let recibida = '';
  RB._usarBanco(async (datos, o) => { recibida = datos.clave; o.alPaso('Descargando'); return { estado: 'OK', mensaje: '1 cartola descargada.', archivos: [{ nombre: 'Cartola BCI N° 020 del 2026-09-30.xlsx', numero: '020', fecha: '2026-09-30', base64: xls('PK-020') }] }; });
  try {
    const sinPermiso = ejecutarAccion(db, 'finanzasRobotBciIniciar', D2({ periodo: '2026-09', rut: '12345678-5', clave: CLAVE }), ctx2);
    assert.equal(sinPermiso.codigo, 'PERMISO', 'solo lectura no pide cartolas');
    assert.equal(ejecutarAccion(db, 'finanzasRobotBciIniciar', D({ periodo: '2026-13' }), ctx)._validationError, true);
    assert.equal(ejecutarAccion(db, 'finanzasRobotBciIniciar', { periodo: '2026-09' }, ctx).boveda_cerrada, true, 'sin bóveda abierta, nada');
    const r = ejecutarAccion(db, 'finanzasRobotBciIniciar', D({ periodo: '2026-09', rut: '12345678-5', clave: CLAVE }), ctx);
    assert.ok(r.trabajo_id, r.message);
    await RB._esperar(r.trabajo_id);
    assert.equal(recibida, CLAVE);
    const e = ejecutarAccion(db, 'finanzasRobotBciEstado', D({ trabajo_id: r.trabajo_id }), ctx);
    assert.deepEqual([e.estado, e.resultado.archivos.length], ['LISTO', 1]);
    assert.equal(ejecutarAccion(db, 'finanzasRobotBciEstado', D2({ trabajo_id: r.trabajo_id }), ctx2)._forbidden, true);
    assert.equal(ejecutarAccion(db, 'finanzasRobotBciGeneral', D({}), ctx).en_servidor, true);
    const bit = B.dbFin().prepare("SELECT detalle FROM FIN_BITACORA WHERE accion = 'ROBOT_BCI' ORDER BY id").all().map((x) => x.detalle);
    assert.deepEqual(bit, ['Pidió las cartolas de 2026-09', '2026-09 · OK · N° 020']);
    assert.ok(!JSON.stringify(B.dbFin().prepare('SELECT * FROM FIN_BITACORA').all()).includes(CLAVE));
  } finally { RB._reiniciar(); }
});

// --- De punta a punta, con el navegador real y un sitio que imita el BCI Pyme -------------------------
const RUTA = PdfChromium.rutaChrome();
const sinNavegador = !RUTA || process.env.CI ? 'sin navegador local (o en CI)' : false;
const CARTOLAS = [['octubre', '30/10/2026', '022'], ['octubre', '19/10/2026', '021'], ['septiembre', '30/09/2026', '020'], ['septiembre', '16/09/2026', '019'], ['agosto', '31/08/2026', '018']];

function sitio() {
  const visto = { intentos: 0, salir: 0, excel: [] };
  // Como el BCI real: reCAPTCHA invisible en todas las páginas (no pide nada; no es un CAPTCHA que detenga al robot).
  const invisible = '<div class="grecaptcha-badge" style="width:256px;height:60px"><iframe src="/recaptcha/api2/anchor?size=invisible" style="width:256px;height:60px"></iframe></div>';
  const html = (res, cuerpo) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><meta charset="utf-8"><body>' + cuerpo + invisible + '</body>'); };
  const menu = '<nav><a href="#" id="cu" onclick="document.getElementById(\'sub\').style.display=\'block\';return false">Cuentas</a>' +
    '<ul id="sub" style="display:none"><li><a href="/movimientos">Mis Movimientos</a></li><li><a href="/cartolas">Cartola Histórica</a></li></ul><a href="/salir">Salir</a></nav>';
  const S = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/login' || u.pathname === '/login-extra' || u.pathname === '/login-corta') {
      const extra = u.pathname === '/login-extra' ? '<label for="rut_emp">RUT empresa</label><input id="rut_emp" name="rut_emp">' : '';
      const max = u.pathname === '/login-corta' ? ' maxlength="8"' : '';
      return html(res, '<a href="/ayuda">¿Clave bloqueada?</a><div id="onetrust"><button id="onetrust-reject-all-handler" onclick="this.parentNode.remove()">Rechazar opcionales</button></div>' +
        (u.searchParams.get('e') ? '<div class="error">Clave incorrecta. Te quedan 2 intentos.</div>' : '') +
        '<form method="post" action="/entrar"><input id="rut_aux" name="rut">' + extra + '<input id="clave" name="clave" type="password"' + max + '><label><input type="checkbox" name="recordar">Recordar RUT</label><button type="submit">INGRESAR</button></form>');
    }
    if (u.pathname === '/entrar') {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => { visto.intentos++; const p = new URLSearchParams(b); res.writeHead(302, { Location: p.get('rut') === '123456785' && p.get('clave') === CLAVE ? '/portal' : p.get('clave') === 'antigua' ? '/login?e=1' : '/pyme/clave-invalida' }); res.end(); });
      return;
    }
    // Lo que respondió el BCI real el 03-11-2026 con una clave que no aceptó.
    if (u.pathname === '/pyme/clave-invalida') return html(res, '<header><a href="/">Personas</a><a href="/">Empresas</a></header><h1>Autentificación incorrecta</h1><a href="/login">Reintentar</a>');
    if (u.pathname === '/portal') return html(res, menu + '<h1>Inicio</h1>');
    if (u.pathname === '/cartolas') {
      return html(res, menu + '<h2>Cartola Histórica</h2><table><tr><th>Mes</th><th>Fecha</th><th>Nº de cartola</th><th>Ver Cartola</th></tr>' +
        CARTOLAS.map((c) => '<tr><td>' + c[0] + '</td><td>' + c[1] + '</td><td>' + c[2] + '</td><td><a href="/detalle?n=' + c[2] + '">→</a></td></tr>').join('') + '</table>');
    }
    if (u.pathname === '/detalle') {
      return html(res, menu + '<h2>Detalle Cartola Histórica</h2><div>CARTOLA DE CUENTA CORRIENTE</div>' +
        '<button onclick="document.getElementById(\'m\').style.display=\'block\'">Exportar ▲</button><div id="m" style="display:none"><a href="#">Imprimir Pantalla</a><a href="/excel?n=' + u.searchParams.get('n') + '">Descargar Excel</a></div>');
    }
    if (u.pathname === '/excel') {
      visto.excel.push(u.searchParams.get('n'));
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="cartola_' + u.searchParams.get('n') + '.xlsx"' });
      return res.end('PK-falso-' + u.searchParams.get('n'));
    }
    if (u.pathname === '/login-captcha') return html(res, '<iframe src="/recaptcha/api2/anchor?size=normal" style="width:304px;height:78px"></iframe>');
    if (u.pathname === '/salir') { visto.salir++; return html(res, '<h1>Sesión cerrada</h1>'); }
    res.writeHead(404); res.end();
  });
  return new Promise((ok) => S.listen(0, '127.0.0.1', () => ok({ S, visto, url: 'http://127.0.0.1:' + S.address().port + '/login' })));
}

test('de punta a punta: entra, abre Cartola Histórica, descarga las del mes y sale; una clave mala, un solo intento', { skip: sinNavegador, timeout: 180000 }, async () => {
  const { S, visto, url } = await sitio();
  try {
    const receta = { inicio: url, esperaMs: 15000, descargaMs: 15000 };
    const pasos = [];
    const r = await Bci.traerCartolas({ rut: '12.345.678-5', clave: CLAVE, periodo: '2026-09' }, { receta, oculto: true, alPaso: (p) => pasos.push(p) });
    assert.equal(r.estado, 'OK', r.mensaje + ' ' + JSON.stringify(r.diagnostico));
    assert.deepEqual(r.archivos.map((a) => [a.numero, a.fecha, Buffer.from(a.base64, 'base64').toString()]),
      [['019', '2026-09-16', 'PK-falso-019'], ['020', '2026-09-30', 'PK-falso-020'], ['021', '2026-10-19', 'PK-falso-021']]);
    assert.match(r.archivos[0].nombre, /^Cartola BCI N° 019 del 2026-09-16\.xlsx$/);
    assert.deepEqual([visto.intentos, visto.salir], [1, 1], 'un ingreso y cierra la sesión');
    assert.ok(pasos.some((p) => /Cartola Histórica/.test(p)));

    const sinMes = await Bci.traerCartolas({ rut: '12345678-5', clave: CLAVE, periodo: '2026-12' }, { receta, oculto: true });
    assert.equal(sinMes.estado, 'SIN_CARTOLAS');
    assert.match(sinMes.mensaje, /N° 022 del 2026-10-30/);

    visto.intentos = 0;
    const t0 = Date.now();
    const mala = await Bci.traerCartolas({ rut: '12345678-5', clave: 'otra-clave', periodo: '2026-09' }, { receta, oculto: true });
    assert.equal(mala.estado, 'CLAVE_INVALIDA', mala.mensaje);
    assert.match(mala.mensaje, /Autentificación incorrecta/);
    assert.ok(Date.now() - t0 < 12000, 'la página «clave inválida» del BCI se reconoce al tiro, sin esperar el plazo');
    assert.equal(visto.intentos, 1, 'no reintenta: el banco bloquea la clave');
    assert.equal(mala.diagnostico.url, '127.0.0.1/pyme/clave-invalida');
    const dg = JSON.stringify(mala.diagnostico);
    assert.ok(!dg.includes('otra-clave') && !dg.includes('12345678'), 'el diagnóstico no lleva el RUT ni la clave');
    assert.ok(mala.diagnostico.formulario.some((c) => /#clave/.test(c) && /10 escritos/.test(c)), 'del formulario solo cuántos caracteres: ' + dg);

    // Un aviso en la misma página de ingreso también se reconoce (un solo intento).
    visto.intentos = 0;
    const antigua = await Bci.traerCartolas({ rut: '12345678-5', clave: 'antigua', periodo: '2026-09' }, { receta, oculto: true });
    assert.deepEqual([antigua.estado, visto.intentos], ['CLAVE_INVALIDA', 1], antigua.mensaje);

    // Si el formulario pide otro dato o la clave no cabe, se detiene ANTES de «Ingresar»: no gasta ningún intento.
    visto.intentos = 0;
    const extra = await Bci.traerCartolas({ rut: '12345678-5', clave: CLAVE, periodo: '2026-09' }, { receta: Object.assign({}, receta, { inicio: url.replace('/login', '/login-extra') }), oculto: true });
    assert.equal(extra.estado, 'NO_INGRESADO', extra.mensaje);
    assert.match(extra.mensaje, /RUT empresa/);
    const corta = await Bci.traerCartolas({ rut: '12345678-5', clave: CLAVE, periodo: '2026-09' }, { receta: Object.assign({}, receta, { inicio: url.replace('/login', '/login-corta') }), oculto: true });
    assert.equal(corta.estado, 'NO_INGRESADO', corta.mensaje);
    assert.match(corta.mensaje, /8 de 23 caracteres/);
    assert.equal(visto.intentos, 0, 'ninguno de los dos llegó al banco');
    assert.ok(mala.diagnostico.formulario.some((c) => /reCAPTCHA invisible/.test(c)), 'el diagnóstico avisa del reCAPTCHA invisible');

    // Un CAPTCHA que sí pide algo (la casilla «No soy un robot») detiene al robot; el invisible no.
    const cap = await Bci.traerCartolas({ periodo: '2026-09' }, { receta: Object.assign({}, receta, { inicio: url.replace('/login', '/login-captcha'), ingresoManualMs: 5000 }), oculto: true });
    assert.equal(cap.estado, 'CAPTCHA', cap.mensaje);
  } finally { S.close(); }
});
