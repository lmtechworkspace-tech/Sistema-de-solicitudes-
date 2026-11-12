'use strict';

/**
 * Robot de ventas del SII (09-11-2026; robotSii.js, controlInternoRobot.js, finanzasRobotSii.js).
 *  - El PC de la oficina toma el pedido solo si su programa sabe hacerlo; la Clave Tributaria no queda en ninguna parte;
 *    lo que entrega el PC se valida (solo el CSV del RCV de ventas) y solo lo ve quien lo pidió.
 *  - En Finanzas: bóveda + REGISTRAR para pedir; queda en la bitácora sin la clave.
 *  - De punta a punta contra un sitio local que imita el SII (capturas del 09-11-2026): ingreso con RUT de la empresa y
 *    Clave Tributaria, Registro de Compras y Ventas › RUT · Período › Consultar › VENTA › Descargar Detalles; por el menú
 *    si el SII no vuelve solo; un mes sin ventas; una empresa que no está; una clave mala se intenta UNA vez. Necesita
 *    Chrome o Edge: se salta sin navegador o en CI. Datos inventados.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { abrirDb_, sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const RB = require('../logica/controlInternoRobot');
const Sii = require('../logica/robotSii');
const SiiLector = require('../logica/controlInternoSII');
const PdfChromium = require('../logica/pdfChromium');
const B = require('../logica/finanzasBoveda');
const { preparar } = require('./_finanzasPrueba');
const { ACCIONES } = require('../server/router');
const ejecutarAccion = (db, n, data, ctx) => ACCIONES[n](db, data, ctx);

const ADM = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: [] };
const CLAVE = 'Clave-Tributaria-De-Prueba-7';
const RUT = '76748513-1';
const CSV = 'Nro;Tipo Doc;Tipo Venta;Rut cliente;Razon Social;Folio;Fecha Docto;Fecha Recepcion;Fecha Acuse Recibo;Fecha Reclamo;Monto Exento;Monto Neto;Monto IVA;Monto total\r\n' +
  '1;33;Del Giro;11111111-1;CLIENTE DE PRUEBA SPA;1201;15/10/2026;15/10/2026 10:00:00;;;0;100000;19000;119000\r\n' +
  '2;61;Del Giro;11111111-1;CLIENTE DE PRUEBA SPA;88;20/10/2026;20/10/2026 10:00:00;;;0;10000;1900;11900\r\n';
const b64 = (s) => Buffer.from(s).toString('base64');

function dbVacia() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  return db;
}

test('PC de la oficina: lo toma solo un programa que sabe del SII; la clave se entrega una vez y solo vuelve el CSV de ventas', async () => {
  const db = dbVacia();
  RB._reiniciar();
  const a = RB.crearAgente(db, { nombre: 'PC oficina' }, ADM).llave;
  // Un programa que solo sabe de cartolas del BCI no sirve para el SII: se pide actualizarlo.
  const viejo = RB.agenteTomar(db, { agente_token: a, capacidades: 'lote,bci' });
  const r0 = RB.iniciarBanco_(db, { tipo: 'SII_VENTAS', email: 'uno@demo.cl', periodo: '2026-10', rut: RUT, clave: CLAVE });
  assert.equal(r0.sin_agente, true);
  assert.match(r0.message, /versión anterior.*ventas del SII/);
  assert.equal(RB.generalBanco_(db, 'SII_VENTAS').conectado_antiguo, true);
  assert.equal(RB.generalBanco_(db, 'BCI').conectado, true, 'para el BCI sí sirve');
  RB._reiniciar();
  void viejo;

  const tomar = RB.agenteTomar(db, { agente_token: a, capacidades: 'lote,bci,sii' });
  const pedido = { tipo: 'SII_VENTAS', email: 'Uno@demo.cl', periodo: '2026-10', rut: '76.748.513-1', clave: CLAVE };
  const r = RB.iniciarBanco_(db, pedido);
  assert.equal(r.ok, true, r.message);
  assert.equal(pedido.clave, '', 'el pedido suelta la clave');
  const { trabajo } = await tomar;
  assert.deepEqual([trabajo.tipo, trabajo.periodo, trabajo.rut, trabajo.clave], ['SII_VENTAS', '2026-10', RUT, CLAVE]);
  let e = RB.estadoBanco_(r.trabajo_id, 'uno@demo.cl', 'SII_VENTAS');
  assert.equal(e.estado, 'EN_CURSO');
  assert.ok(!JSON.stringify(e).includes(CLAVE), 'la clave no queda en el trabajo');
  assert.equal(RB.estadoBanco_(r.trabajo_id, 'uno@demo.cl').ok, false, 'no se confunde con un pedido del BCI');
  RB.agenteEntregar(db, { agente_token: a, trabajo_id: r.trabajo_id, resultado: { estado: 'OK', mensaje: 'Detalle descargado.', ruts: [RUT],
    archivos: [{ nombre: 'RCV_VENTA_' + RUT + '_202610.csv', rut: RUT, periodo: '2026-10', base64: b64(CSV) },
      { nombre: 'virus.exe', base64: b64('MZ') }, { nombre: 'Cartola.xlsx', base64: b64('PK') }, { nombre: 'RCV_COMPRA_' + RUT + '_202610.csv', base64: b64(CSV) }] } });
  e = RB.estadoBanco_(r.trabajo_id, 'uno@demo.cl', 'SII_VENTAS');
  assert.equal(e.estado, 'LISTO');
  assert.deepEqual(e.resultado.archivos.map((f) => [f.nombre, f.rut, f.periodo]), [['RCV_VENTA_' + RUT + '_202610.csv', RUT, '2026-10']], 'solo el CSV del RCV de ventas');
  assert.equal(RB.estadoBanco_(r.trabajo_id, 'otra@demo.cl', 'SII_VENTAS')._forbidden, true, 'solo quien lo pidió');
  assert.equal(RB.ultimoBanco_('uno@demo.cl', 'SII_VENTAS').trabajo_id, r.trabajo_id);
  assert.equal(RB.ultimoBanco_('uno@demo.cl', 'BCI'), null);
  // Sin clave: asistido, con el RUT de la empresa para elegirla en el RCV.
  const t2 = RB.agenteTomar(db, { agente_token: a, capacidades: 'lote,bci,sii' });
  const r2 = RB.iniciarBanco_(db, { tipo: 'SII_VENTAS', email: 'uno@demo.cl', periodo: '2026-09', rut: RUT });
  const w2 = (await t2).trabajo;
  assert.deepEqual([w2.clave, w2.rut, RB.estadoBanco_(r2.trabajo_id, 'uno@demo.cl', 'SII_VENTAS').asistido], ['', RUT, true]);
  RB.agenteEntregar(db, { agente_token: a, trabajo_id: r2.trabajo_id, resultado: { estado: 'SIN_VENTAS', mensaje: 'Sin ventas.', archivos: [] } });
  assert.equal(RB.estadoBanco_(r2.trabajo_id, 'uno@demo.cl', 'SII_VENTAS').estado, 'DETENIDO');
  assert.match(RB.iniciarBanco_(db, { tipo: 'SII_VENTAS', email: 'uno@demo.cl', periodo: '2026-09', rut: '1-2' }).message, /RUT de la empresa no es válido/);
  RB._reiniciar();
});

test('en Finanzas: bóveda y REGISTRAR para pedir; la bitácora no guarda la clave; el CSV se lee como Registro de Ventas', async (t) => {
  const { db, ctx, ctx2, D, D2 } = preparar(t, { soloLectura: true });
  RB._reiniciar();
  let recibido = null;
  RB._usarSii(async (datos, o) => { recibido = datos; o.alPaso('Descargando el detalle de ventas'); return { estado: 'OK', mensaje: 'Detalle descargado.', archivos: [{ nombre: 'RCV_VENTA_' + RUT + '_202610.csv', rut: RUT, periodo: '2026-10', base64: b64(CSV) }] }; });
  try {
    assert.equal(ejecutarAccion(db, 'finanzasRobotSiiIniciar', D2({ periodo: '2026-10', rut: RUT, clave: CLAVE }), ctx2).codigo, 'PERMISO', 'solo lectura no pide ventas');
    assert.equal(ejecutarAccion(db, 'finanzasRobotSiiIniciar', D({ periodo: '2026-13' }), ctx)._validationError, true);
    assert.equal(ejecutarAccion(db, 'finanzasRobotSiiIniciar', { periodo: '2026-10' }, ctx).boveda_cerrada, true, 'sin bóveda abierta, nada');
    const r = ejecutarAccion(db, 'finanzasRobotSiiIniciar', D({ periodo: '2026-10', rut: RUT, clave: CLAVE }), ctx);
    assert.ok(r.trabajo_id, r.message);
    await RB._esperar(r.trabajo_id);
    assert.deepEqual([recibido.clave, recibido.rut, recibido.periodo], [CLAVE, RUT, '2026-10']);
    const e = ejecutarAccion(db, 'finanzasRobotSiiEstado', D({ trabajo_id: r.trabajo_id }), ctx);
    assert.deepEqual([e.estado, e.resultado.archivos.length], ['LISTO', 1]);
    assert.equal(ejecutarAccion(db, 'finanzasRobotSiiEstado', D2({ trabajo_id: r.trabajo_id }), ctx2)._forbidden, true);
    assert.equal(ejecutarAccion(db, 'finanzasRobotSiiUltimo', D({}), ctx).trabajo.trabajo_id, r.trabajo_id);
    assert.equal(ejecutarAccion(db, 'finanzasRobotSiiGeneral', D({}), ctx).en_servidor, true);
    // El avance no lleva el contenido (se pregunta seguido): se pide aparte, por nombre, y solo quien lo pidió.
    assert.equal(e.resultado.archivos[0].base64, undefined);
    assert.ok(e.resultado.archivos[0].kb >= 1);
    assert.equal(ejecutarAccion(db, 'finanzasRobotSiiArchivo', D2({ trabajo_id: r.trabajo_id, nombre: e.resultado.archivos[0].nombre }), ctx2)._forbidden, true);
    // Lo que trajo entra por el lector de siempre: detalle del RCV de ventas, con la empresa y el período del nombre.
    const a = ejecutarAccion(db, 'finanzasRobotSiiArchivo', D({ trabajo_id: r.trabajo_id, nombre: e.resultado.archivos[0].nombre }), ctx).archivo;
    const leido = SiiLector.leer_(Buffer.from(a.base64, 'base64').toString(), a.nombre);
    assert.deepEqual([leido.fuente, leido.nivel, leido.tipo, leido.rut, leido.periodo, leido.documentos.length], ['rcv', 'detalle', 'ventas', RUT, '2026-M10', 2]);
    const rv = ejecutarAccion(db, 'finanzasRevisarVentas', D({ texto: Buffer.from(a.base64, 'base64').toString(), nombre: a.nombre }), ctx);
    assert.equal(rv.facturas + rv.notas_credito, 2, JSON.stringify(rv));
    const bit = B.dbFin().prepare("SELECT detalle FROM FIN_BITACORA WHERE accion = 'ROBOT_SII' ORDER BY id").all().map((x) => x.detalle);
    assert.deepEqual(bit, ['Pidió las ventas de 2026-10', '2026-10 · OK · RCV_VENTA_' + RUT + '_202610.csv']);
    assert.ok(!JSON.stringify(B.dbFin().prepare('SELECT * FROM FIN_BITACORA').all()).includes(CLAVE));
  } finally { RB._reiniciar(); }
});

// --- De punta a punta, con el navegador real y un sitio que imita el SII --------------------------------
const RUTA = PdfChromium.rutaChrome();
const sinNavegador = !RUTA || process.env.CI ? 'sin navegador local (o en CI)' : false;

function sitio() {
  const visto = { intentos: 0, prohibido: [], csv: 0, menu: false };
  const invisible = '<div class="grecaptcha-badge" style="width:256px;height:60px"><iframe src="/recaptcha/api2/anchor?size=invisible" style="width:256px;height:60px"></iframe></div>';
  const html = (res, cuerpo) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><meta charset="utf-8"><body>' + cuerpo + invisible + '</body>'); };
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  // El RCV: RUT · Período (mes, año) · Consultar; pestañas COMPRA / VENTA; botones de descarga y los que nunca se tocan.
  const rcv = '<h1>REGISTRO DE COMPRAS Y VENTAS</h1><div><b>RUT:</b><select id="r"><option value="0">76748513-1</option><option value="1">77111222-3</option></select>' +
    '<b>Periodo:</b><select id="m">' + MESES.map((n, i) => '<option value="' + (i + 1) + '">' + n + '</option>').join('') + '</select>' +
    '<select id="a"><option>2025</option><option>2026</option></select><button onclick="consultar()">Consultar</button></div><div id="tabs"></div><div id="cont"></div>' +
    '<script>var q=null;function consultar(){q={r:document.getElementById("r").selectedOptions[0].text,m:document.getElementById("m").value,a:document.getElementById("a").value};' +
    'setTimeout(function(){document.getElementById("tabs").innerHTML=\'<a href="#" onclick="ver(0);return false">COMPRA</a> <a href="#" onclick="ver(1);return false">VENTA</a> <a href="#">Documentos Observados</a> <a href="#">Descargas Diferidas</a>\';ver(0)},400)}' +
    'function ver(v){var mm=("0"+q.m).slice(-2),c=document.getElementById("cont");' +
    'if(!v){c.innerHTML="<h3>RESUMEN REGISTRO DE COMPRAS "+q.a+mm+"</h3><button onclick=\\"location.href=\'/prohibido?b=compra\'\\">Descargar Detalles</button>";return}' +
    'if(q.m!=="10"&&q.m!=="8"){c.innerHTML="<p>No existen registros de ventas para el periodo consultado.</p>";return}' +
    'setTimeout(function(){c.innerHTML="<h3>RESUMEN REGISTRO DE VENTAS "+q.a+mm+"</h3><table><tr><th>Tipo Documento</th></tr><tr><td>Factura Electrónica (33)</td></tr></table>"+' +
    '"<button onclick=\\"location.href=\'/csv?r="+q.r+"&p="+q.a+mm+"&n=0\'\\">Descargar Resumenes</button> <button onclick=\\"location.href=\'/csv?r="+q.r+"&p="+q.a+mm+"&n=1\'\\">Descargar Detalles</button> "+' +
    '"<button onclick=\\"location.href=\'/prohibido?b=agregar\'\\">Agregar resumen de boletas u otros</button> <button onclick=\\"location.href=\'/prohibido?b=f29\'\\">Ir a propuesta F29</button>"},300)}</script>';
  const S = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/login') {
      return html(res, '<h2>Identificación de Contribuyentes</h2>' + (u.searchParams.get('e') ? '<div class="alert">Rut o Clave Tributaria incorrecta</div>' : '') +
        '<form method="post" action="/entrar?' + (u.searchParams.get('menu') ? 'menu=1' : '') + '"><label for="rutcntr">RUT</label><input id="rutcntr" name="rutcntr" placeholder="Ej: 123456789">' +
        '<label for="clave">Ingresar Clave Tributaria</label><input id="clave" name="clave" type="password"><button id="bt_ingresar" type="submit">INGRESAR</button></form><a href="#">Recuperar Clave</a>' +
        // ?a_mano=1: imita a la persona que entra a mano en la ventana del robot (a los 2 segundos).
        (u.searchParams.get('a_mano') ? '<script>setTimeout(function(){document.getElementById("rutcntr").value="76.748.513-1";document.getElementById("clave").value=' + JSON.stringify(CLAVE) + ';document.forms[0].submit()},2000)</script>' : ''));
    }
    if (u.pathname === '/entrar') {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        visto.intentos++;
        const p = new URLSearchParams(b);
        // La clave de prueba sirve con dos RUT; el segundo (96555444-9) no tiene empresas en el RCV de prueba.
        const ok = ['767485131', '965554449'].includes(p.get('rutcntr').replace(/\D/g, '')) && p.get('clave') === CLAVE;
        res.writeHead(302, { Location: !ok ? '/login?e=1' : u.searchParams.get('menu') ? '/misii' : '/rcv' }); res.end();
      });
      return;
    }
    if (u.pathname === '/rcv') return html(res, rcv);
    if (u.pathname === '/misii') {
      visto.menu = true;
      return html(res, '<nav><a href="#">Mi Sii</a> <a href="#" onclick="document.getElementById(\'so\').style.display=\'block\';return false">Servicios online ▾</a></nav>' +
        '<ul id="so" style="display:none"><li><a href="#">Factura electrónica</a></li><li><a href="/impuestos">Impuestos mensuales</a></li><li><a href="#">Declaración de renta</a></li></ul><h2>Inicio Mi SII</h2>');
    }
    if (u.pathname === '/impuestos') return html(res, '<h1>Impuestos mensuales</h1><a href="#">Declaración mensual (F29)</a><a href="/rcvinfo">Registro de compras y ventas</a>');
    if (u.pathname === '/rcvinfo') return html(res, '<h1>Registro de compras y ventas</h1><a href="/rcv">Ingresar al Registro de Compras y Ventas</a>');
    if (u.pathname === '/csv') {
      visto.csv++;
      const r = u.searchParams.get('r'), p = u.searchParams.get('p'), det = u.searchParams.get('n') === '1';
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="RCV_' + (det ? '' : 'RESUMEN_') + 'VENTA_' + r + '_' + p + '.csv"' });
      return res.end(det ? CSV : 'Tipo Documento;Total Documentos\r\n33;1\r\n');
    }
    if (u.pathname === '/prohibido') { visto.prohibido.push(u.searchParams.get('b')); return html(res, '<h1>No debió llegar aquí</h1>'); }
    res.writeHead(404); res.end();
  });
  return new Promise((ok) => S.listen(0, '127.0.0.1', () => {
    const base = 'http://127.0.0.1:' + S.address().port;
    ok({ S, visto, base, receta: { inicio: base + '/login', rcv: base + '/rcv', misii: base + '/misii', salirUrl: '', hostsIngreso: [], esperaMs: 15000, descargaMs: 15000 } });
  }));
}

test('de punta a punta: entra con el RUT de la empresa, consulta el mes, VENTA › Descargar Detalles; una clave mala, un solo intento', { skip: sinNavegador, timeout: 240000 }, async () => {
  const { S, visto, base, receta } = await sitio();
  try {
    const pasos = [];
    const r = await Sii.traerVentas({ rut: '76.748.513-1', clave: CLAVE, periodo: '2026-10' }, { receta, oculto: true, alPaso: (p) => pasos.push(p) });
    assert.equal(r.estado, 'OK', r.mensaje + ' ' + JSON.stringify(r.diagnostico));
    assert.deepEqual(r.archivos.map((a) => [a.nombre, a.rut, a.periodo, Buffer.from(a.base64, 'base64').toString()]), [['RCV_VENTA_' + RUT + '_202610.csv', RUT, '2026-10', CSV]]);
    assert.deepEqual(r.ruts, ['767485131', '771112223']);
    assert.deepEqual([visto.intentos, visto.csv, visto.prohibido, visto.menu], [1, 1, [], false], 'un ingreso, solo «Descargar Detalles» de VENTA, sin pasar por el menú');
    assert.ok(pasos.some((p) => /Consultando octubre 2026 de la empresa 76748513-1/.test(p)), pasos.join(' | '));

    // Si el SII no vuelve solo al RCV: por el menú (Servicios online › Impuestos mensuales › Registro… › Ingresar).
    visto.intentos = 0;
    const menu = await Sii.traerVentas({ rut: RUT, clave: CLAVE, periodo: '2026-10' }, { receta: Object.assign({}, receta, { inicio: base + '/login?menu=1', rcv: base + '/no-existe' }), oculto: true });
    assert.equal(menu.estado, 'OK', menu.mensaje + ' ' + JSON.stringify(menu.diagnostico && menu.diagnostico.recorrido));
    assert.equal(visto.menu, true);

    // Un mes sin ventas: lo dice, sin archivo.
    const vacio = await Sii.traerVentas({ rut: RUT, clave: CLAVE, periodo: '2026-09' }, { receta, oculto: true });
    assert.equal(vacio.estado, 'SIN_VENTAS', vacio.mensaje);
    assert.match(vacio.mensaje, /septiembre 2026/);

    // Una empresa que no está en el RCV: se detiene y dice cuáles hay.
    const otra = await Sii.traerVentas({ rut: '96.555.444-9', clave: CLAVE, periodo: '2026-10' }, { receta, oculto: true });
    assert.equal(otra.estado, 'EMPRESA', otra.mensaje);
    assert.match(otra.mensaje, /no aparece el RUT 96555444-9\. Aparecen: 76748513-1, 77111222-3/);

    // Clave mala: un solo intento y se detiene al tiro.
    visto.intentos = 0;
    const t0 = Date.now();
    const mala = await Sii.traerVentas({ rut: RUT, clave: 'otra-clave', periodo: '2026-10' }, { receta, oculto: true });
    assert.equal(mala.estado, 'CLAVE_INVALIDA', mala.mensaje);
    assert.equal(visto.intentos, 1, 'no reintenta');
    assert.ok(Date.now() - t0 < 12000, 'el aviso del SII se reconoce sin esperar el plazo');
    const dg = JSON.stringify(mala.diagnostico);
    assert.ok(!dg.includes('otra-clave') && !dg.includes(CLAVE), 'el diagnóstico no lleva la clave');
    assert.deepEqual(visto.prohibido, [], 'nunca tocó COMPRA, «Agregar…» ni la propuesta F29');
  } finally { S.close(); }
});

test('de punta a punta, sin clave: espera la entrada a mano y elige en el RCV la empresa pedida', { skip: sinNavegador, timeout: 120000 }, async () => {
  const { S, visto, base, receta } = await sitio();
  try {
    const pasos = [];
    const r = await Sii.traerVentas({ rut: '77.111.222-3', periodo: '2026-10' }, { receta: Object.assign({}, receta, { inicio: base + '/login?a_mano=1', ingresoManualMs: 30000 }), oculto: true, alPaso: (x) => pasos.push(x) });
    assert.equal(r.estado, 'OK', r.mensaje + ' ' + JSON.stringify(r.diagnostico));
    assert.ok(pasos.some((x) => /Esperando que alguien entre al SII/.test(x)));
    assert.ok(!pasos.some((x) => /Escribiendo/.test(x)), 'sin clave el robot no escribe nada en el ingreso');
    assert.deepEqual(r.archivos.map((a) => a.nombre), ['RCV_VENTA_77111222-3_202610.csv'], 'la empresa pedida, no la que venía elegida');
    assert.deepEqual([visto.intentos, visto.prohibido], [1, []]);
  } finally { S.close(); }
});

test('varios meses (12-11-2026): una sola entrada al SII, un detalle por mes; un mes sin ventas no detiene el resto', { skip: sinNavegador, timeout: 240000 }, async () => {
  const { S, visto, receta } = await sitio();
  try {
    const llegaron = [], meses = [], pasos = [];
    const r = await Sii.traerVentas({ rut: RUT, clave: CLAVE, periodo: '2026-08', hasta: '2026-10' }, { receta: Object.assign({}, receta, { pausaMesMs: 200 }), oculto: true,
      alPaso: (p) => pasos.push(p), alArchivo: (a) => llegaron.push(a.nombre), alMes: (m) => meses.push(m.periodo + ':' + m.estado) });
    assert.equal(r.estado, 'OK', r.mensaje + ' ' + JSON.stringify(r.diagnostico));
    assert.deepEqual(r.archivos.map((a) => [a.nombre, a.periodo]), [['RCV_VENTA_' + RUT + '_202608.csv', '2026-08'], ['RCV_VENTA_' + RUT + '_202610.csv', '2026-10']]);
    assert.deepEqual(r.meses.map((m) => m.periodo + ':' + m.estado), ['2026-08:OK', '2026-09:SIN_VENTAS', '2026-10:OK']);
    assert.deepEqual(llegaron, r.archivos.map((a) => a.nombre), 'cada archivo se entrega apenas baja');
    assert.deepEqual(meses, ['2026-08:OK', '2026-09:SIN_VENTAS', '2026-10:OK'], 'cada mes se avisa al terminar');
    assert.deepEqual([visto.intentos, visto.csv, visto.prohibido], [1, 2, []], 'un solo ingreso para los tres meses');
    assert.ok(pasos.some((p) => /^Mes 2 de 3 · Consultando septiembre 2026/.test(p)), pasos.join(' | '));
    assert.equal((await Sii.traerVentas({ rut: RUT, clave: CLAVE, periodo: '2025-01', hasta: '2026-02' }, { receta, oculto: true })).estado, 'DATOS', 'hasta 12 meses');
  } finally { S.close(); }
});
