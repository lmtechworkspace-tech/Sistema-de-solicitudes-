'use strict';

/**
 * Robot TGR semiautomático (2026-10-02).
 *  - La clave se usa una vez: no queda en el trabajo, en la respuesta ni en el historial.
 *  - Un robot a la vez; solo quien registra Contabilidad lo usa.
 *  - Sus cuotas pasan por "Recibir desde la TGR" (con la resolución recordada).
 *  - De punta a punta contra un sitio local que imita la TGR y el SII: ingreso,
 *    recuadro de otro origen, varios convenios, y cada motivo de detención
 *    (clave mala con un solo intento, verificación por correo, cambio de clave,
 *    CAPTCHA, acceso rechazado). Necesita Chrome o Edge: se salta sin navegador
 *    o en CI.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const CI = require('../logica/controlInterno');
const CV = require('../logica/controlInternoConvenios');
const RB = require('../logica/controlInternoRobot');
const Robot = require('../logica/robotTgr');
const PdfChromium = require('../logica/pdfChromium');

const ADM = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: [] };
const conModulo = (email) => ({ email, rol: 'DEV', modulos: ['control_interno'] });
const FRANCISCA = conModulo('francisca@homepymes.cl');
const LECTORA = conModulo('lectora@homepymes.cl');
const rechazado = (r) => !!r && (r._forbidden === true || r.ok === false);
const CLAVE = 'Clave-De-Prueba-123';

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'CLI-1', razon_social: 'Barrales Pavimentos SpA', rut: '76.123.456-7', codigo_cliente: 'HP-001', contacto: '', correo: '', telefono: '', representante_legal: '', direccion: '', estado: 'ACTIVO', bloqueo: '', activo: true });
  CI.guardarMiembros(db, { depto: 'CONTABILIDAD', miembros: [{ email: FRANCISCA.email, rol: 'REGISTRA' }, { email: LECTORA.email, rol: 'LECTURA' }] }, ADM);
  return db;
}
const CUOTAS = [{ n: 1, vencimiento: '2025-12-31', monto: 97570, tgr: 'SI' }, { n: 2, vencimiento: '2026-01-31', monto: 190039, tgr: 'NO' }];

test('RUT del formulario y texto de las cuotas (vuelve a leerse igual)', () => {
  assert.equal(Robot.rutFormulario_('76.123.456-7'), '76123456-7');
  assert.equal(Robot.rutFormulario_('12345678k'), '12345678-K');
  assert.equal(Robot.rutFormulario_('123'), '');
  const t = Robot.comoTexto([{ resolucion: '60225', cuotas: CUOTAS }, { resolucion: '70001', cuotas: [CUOTAS[0]] }]);
  const b = CV.bloquesTGR_(t).bloques;
  assert.deepEqual(b.map((x) => [x.folio, x.cuotas.length]), [['60225', 2], ['70001', 1]]);
  assert.deepEqual(b[0].cuotas[1], { n: 2, vencimiento: '2026-01-31', monto: 190039, tgr: 'NO' });
});

test('la clave se usa una vez y no queda en ninguna parte; un robot a la vez', async () => {
  const db = crear();
  let recibida = '', soltar;
  const espera = new Promise((r) => { soltar = r; });
  RB._reiniciar();
  RB._usar(async (datos, o) => { recibida = datos.clave; o.alPaso('Leyendo los convenios'); await espera; return { estado: 'OK', mensaje: '1 convenio leído.', convenios: [{ resolucion: '60225', cuotas: CUOTAS }] }; });
  try {
    const data = { cliente_id: 'CLI-1', rut: '76.123.456-7', clave: CLAVE };
    const r = RB.revisar(db, data, FRANCISCA);
    assert.equal(r.ok, true, r.message);
    assert.equal(data.clave, '', 'la petición ya no la retiene');
    // Mientras corre: ocupado para todos.
    const otro = RB.revisar(db, { rut: '76123456-7', clave: 'x' }, FRANCISCA);
    assert.equal(otro.ocupado, true);
    await new Promise((ok) => setImmediate(ok)); // el robot arranca en segundo plano
    let e = RB.estado(db, { trabajo_id: r.trabajo_id }, FRANCISCA);
    assert.deepEqual([e.estado, e.paso], ['EN_CURSO', 'Leyendo los convenios']);
    soltar();
    await RB._esperar(r.trabajo_id);
    e = RB.estado(db, { trabajo_id: r.trabajo_id }, FRANCISCA);
    assert.equal(recibida, CLAVE, 'el robot la recibió');
    assert.equal(e.estado, 'LISTO');
    assert.match(e.resultado.texto, /Folio N°: 60225/);
    assert.deepEqual(e.resultado.convenios, [{ resolucion: '60225', cuotas: 2, pagadas: 1 }]);
    assert.ok(!JSON.stringify(e).includes(CLAVE), 'ni en la respuesta');
    const hist = CI.consultar_(db, 'CI_HISTORIAL', { registro_id: 'ROBOT_TGR' });
    assert.equal(hist.length, 1);
    assert.match(hist[0].detalle, /Barrales Pavimentos SpA · RUT 76123456-7 · OK · 1 convenios/);
    assert.ok(!JSON.stringify(hist).includes(CLAVE), 'ni en el historial');
    // Otra persona no ve la revisión ajena (un ADM sí).
    assert.ok(rechazado(RB.estado(db, { trabajo_id: r.trabajo_id }, conModulo('otra@homepymes.cl'))));
    assert.equal(RB.estado(db, { trabajo_id: r.trabajo_id }, ADM).ok, true);
  } finally { soltar(); RB._usar(); }
});

test('validaciones y permisos; una detención llega con su motivo', async () => {
  const db = crear();
  RB._reiniciar();
  RB._usar(async () => ({ estado: 'CLAVE_INVALIDA', mensaje: 'El SII no aceptó el RUT o la clave.', convenios: [], diagnostico: { url: 'www2.sii.cl/x', textos: [], captura: '' } }));
  try {
    assert.ok(rechazado(RB.revisar(db, { rut: '76123456-7', clave: CLAVE }, LECTORA)), 'solo lectura no lo usa');
    assert.equal(RB.revisar(db, { rut: '1-9', clave: CLAVE }, FRANCISCA).ok, false);
    assert.equal(RB.revisar(db, { rut: '76123456-7', clave: '' }, FRANCISCA).ok, false);
    assert.equal(RB.revisar(db, { rut: '76123456-7', clave: CLAVE, cliente_id: 'NO-EXISTE' }, FRANCISCA).ok, false);
    const r = RB.revisar(db, { rut: '76123456-7', clave: CLAVE }, FRANCISCA);
    await RB._esperar(r.trabajo_id);
    const e = RB.estado(db, { trabajo_id: r.trabajo_id }, FRANCISCA);
    assert.deepEqual([e.estado, e.resultado.estado, e.resultado.texto], ['DETENIDO', 'CLAVE_INVALIDA', '']);
    assert.equal(e.resultado.diagnostico.url, 'www2.sii.cl/x');
    RB._usar(null);
    const sin = RB.revisar(db, { rut: '76123456-7', clave: CLAVE }, FRANCISCA);
    assert.equal(sin.sin_agente, true, 'sin robot de la oficina conectado no se inicia');
  } finally { RB._usar(); }
});

test('lo que trae el robot se asigna una vez y la resolución queda recordada', () => {
  const db = crear();
  const id = CV.guardar(db, { cliente_id: 'CLI-1', folio: '181614' }, FRANCISCA).convenio.convenio_id;
  const texto = Robot.comoTexto([{ resolucion: '60225', cuotas: CUOTAS }]);
  // La TGR dice 60225 y Contabilidad anota 181614: la primera vez se asigna.
  assert.equal(CV.recibirTGR(db, { texto, simular: true }, FRANCISCA).convenios[0].nuevo, true);
  const r = CV.recibirTGR(db, { texto, origen: 'robot', asignar: { 0: id } }, FRANCISCA);
  assert.equal(r.actualizados, 1);
  const c = CV.get(db, { convenio_id: id }, FRANCISCA);
  assert.equal(c.convenio.resolucion, '60225');
  assert.ok(c.historial.some((h) => /^Revisado por el robot TGR: .*resolución 60225/.test(h.detalle)));
  // La próxima vez la reconoce sola.
  const sim = CV.recibirTGR(db, { texto, simular: true }, FRANCISCA).convenios[0];
  assert.deepEqual([sim.convenio_id, sim.asignado], [id, false]);
});

test('robot de la oficina: llave como hash, toma la revisión, avisa su avance y entrega', async () => {
  const db = crear();
  RB._reiniciar();
  // Solo un ADM autoriza equipos; la llave se ve una vez y en la base queda su hash.
  assert.ok(rechazado(RB.crearAgente(db, { nombre: 'PC Luis' }, FRANCISCA)));
  const c = RB.crearAgente(db, { nombre: 'PC Luis' }, ADM);
  assert.match(c.llave, /^sgr_[A-Za-z0-9_-]{40,}$/);
  const fila = CI.consultar_(db, 'CI_ROBOT_AGENTES', { agente_id: c.agente.agente_id })[0];
  assert.ok(!JSON.stringify(fila).includes(c.llave), 'la llave no se guarda');
  assert.equal(fila.token_hash.length, 64);
  assert.equal(RB.listarAgentes(db, {}, ADM).agentes[0].conectado, false);
  // Sin el equipo conectado no se inicia.
  assert.equal(RB.revisar(db, { rut: '76123456-7', clave: CLAVE }, FRANCISCA).sin_agente, true);
  assert.ok(rechazado(RB.agenteTomar(db, { agente_token: 'sgr_' + 'x'.repeat(43) })), 'llave falsa');
  // El equipo pregunta (queda esperando) y la revisión le llega en cuanto se pide.
  const espera = RB.agenteTomar(db, { agente_token: c.llave });
  assert.ok(espera instanceof Promise);
  assert.equal(RB.general(db, {}, FRANCISCA).conectado, true);
  const r = RB.revisar(db, { cliente_id: 'CLI-1', rut: '76.123.456-7', clave: CLAVE }, FRANCISCA);
  assert.equal(r.ok, true, r.message);
  const tomado = await espera;
  assert.deepEqual(tomado.trabajo, { trabajo_id: r.trabajo_id, rut: '76123456-7', clave: CLAVE });
  let e = RB.estado(db, { trabajo_id: r.trabajo_id }, FRANCISCA);
  assert.match(e.paso, /tomó la revisión/);
  assert.ok(!JSON.stringify(e).includes(CLAVE), 'una vez tomada, el servidor ya no la tiene');
  assert.equal(RB.agentePaso(db, { agente_token: c.llave, trabajo_id: r.trabajo_id, paso: 'Leyendo el convenio 60225 (1 de 1)' }).ok, true);
  assert.equal(RB.estado(db, { trabajo_id: r.trabajo_id }, FRANCISCA).paso, 'Leyendo el convenio 60225 (1 de 1)');
  // Otro equipo no puede entregar un trabajo ajeno.
  const otro = RB.crearAgente(db, { nombre: 'Otro PC' }, ADM);
  assert.equal(RB.agenteEntregar(db, { agente_token: otro.llave, trabajo_id: r.trabajo_id, resultado: { estado: 'OK', convenios: [] } }).ok, false);
  // Lo que entrega se valida (una cuota mal formada no pasa).
  const malas = CUOTAS.concat([{ n: 'x', vencimiento: 'ayer', monto: 'mucho', tgr: 'QUIZAS' }]);
  assert.equal(RB.agenteEntregar(db, { agente_token: c.llave, trabajo_id: r.trabajo_id, resultado: { estado: 'OK', mensaje: '1 convenio leído.', convenios: [{ resolucion: '60225', cuotas: malas }] } }).ok, true);
  await RB._esperar(r.trabajo_id);
  e = RB.estado(db, { trabajo_id: r.trabajo_id }, FRANCISCA);
  assert.deepEqual([e.estado, e.agente], ['LISTO', 'PC Luis']);
  assert.equal(CV.bloquesTGR_(e.resultado.texto).bloques[0].cuotas.length, 2);
  const hist = CI.consultar_(db, 'CI_HISTORIAL', { registro_id: 'ROBOT_TGR' }).map((h) => h.detalle).join(' | ');
  assert.match(hist, /PC Luis · OK · 1 convenios/);
  assert.ok(!hist.includes(CLAVE) && !hist.includes(c.llave));
  // Dado de baja: su llave deja de servir.
  assert.equal(RB.revocarAgente(db, { agente_id: c.agente.agente_id }, ADM).ok, true);
  assert.ok(rechazado(RB.agenteTomar(db, { agente_token: c.llave })));
  RB._reiniciar();
});

test('por lote: uno tras otro, la clave no queda y un CAPTCHA detiene el resto', async () => {
  const db = crear();
  agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'CLI-2', razon_social: 'Inversiones Provial Ltda', rut: '77.111.222-3', codigo_cliente: 'HP-002', contacto: '', correo: '', telefono: '', representante_legal: '', direccion: '', estado: 'ACTIVO', bloqueo: '', activo: true });
  RB._reiniciar();
  const vistos = [];
  RB._usar(async (datos) => {
    vistos.push(datos.rut + ':' + datos.clave);
    if (datos.rut === '77111222-3') return { estado: 'CAPTCHA', mensaje: 'La TGR pidió un CAPTCHA.', convenios: [] };
    return { estado: 'OK', mensaje: '1 convenio leído.', convenios: [{ resolucion: '60225', cuotas: CUOTAS }] };
  });
  try {
    // Validaciones: hasta 15, RUT y clave en cada fila, sin repetir.
    assert.match(RB.revisarLote(db, { clientes: [] }, FRANCISCA).message, /al menos un cliente/);
    assert.match(RB.revisarLote(db, { clientes: Array.from({ length: 16 }, () => ({ rut: '76123456-7', clave: 'x' })) }, FRANCISCA).message, /Hasta 15/);
    const malo = { clientes: [{ rut: '76123456-7', clave: CLAVE }, { rut: '76123456-7', clave: 'otra' }] };
    assert.match(RB.revisarLote(db, malo, FRANCISCA).message, /ya está en el lote/);
    assert.equal(malo.clientes[0].clave, '', 'un rechazo también borra las claves de la petición');
    assert.ok(rechazado(RB.revisarLote(db, { clientes: [{ rut: '76123456-7', clave: CLAVE }] }, LECTORA)), 'solo lectura no lo usa');

    const data = { clientes: [{ cliente_id: 'CLI-1', rut: '76.123.456-7', clave: CLAVE }, { cliente_id: 'CLI-2', rut: '77111222-3', clave: 'Clave-Dos' }, { rut: '78999888-1', clave: 'Clave-Tres' }] };
    const r = RB.revisarLote(db, data, FRANCISCA);
    assert.equal(r.ok, true, r.message);
    assert.ok(data.clientes.every((c) => c.clave === ''), 'la petición ya no retiene ninguna clave');
    assert.equal(RB.revisar(db, { rut: '76123456-7', clave: 'x' }, FRANCISCA).ocupado, true, 'mientras corre el lote, ocupado');
    await RB._esperarLote(r.lote_id);
    assert.deepEqual(vistos, ['76123456-7:' + CLAVE, '77111222-3:Clave-Dos'], 'en orden; el tercero no se intentó');
    const e = RB.estadoLote(db, { lote_id: r.lote_id }, FRANCISCA);
    assert.equal(e.terminado, true);
    assert.deepEqual(e.items.map((x) => [x.rut, x.estado, x.resultado.estado]), [['76123456-7', 'LISTO', 'OK'], ['77111222-3', 'DETENIDO', 'CAPTCHA'], ['78999888-1', 'DETENIDO', 'DETENIDO']]);
    assert.match(e.items[2].resultado.mensaje, /el lote se detuvo porque la TGR pidió un CAPTCHA/);
    assert.match(e.items[0].resultado.texto, /Folio N°: 60225/);
    assert.ok(!JSON.stringify(e).includes(CLAVE) && !JSON.stringify(e).includes('Clave-Dos'), 'ninguna clave en el estado');
    const hist = CI.consultar_(db, 'CI_HISTORIAL', { registro_id: 'ROBOT_TGR' }).map((h) => h.detalle).join(' | ');
    assert.ok(!hist.includes(CLAVE) && !hist.includes('Clave-Dos'), 'ni en el historial');
    assert.equal(RB.general(db, {}, FRANCISCA).ocupado, false, 'al terminar, libre');
    assert.ok(rechazado(RB.estadoLote(db, { lote_id: r.lote_id }, conModulo('otra@homepymes.cl'))), 'el lote ajeno no se ve');
  } finally { RB._usar(); RB._reiniciar(); }
});

test('por lote con el robot de la oficina: solo lo toma un programa que sabe de lotes', async () => {
  const db = crear();
  RB._reiniciar();
  const c = RB.crearAgente(db, { nombre: 'PC Luis' }, ADM);
  // Un programa antiguo (sin capacidades) está conectado: el lote no se inicia y se explica por qué.
  const viejo = RB.agenteTomar(db, { agente_token: c.llave });
  assert.equal(RB.general(db, {}, FRANCISCA).lote, false);
  const r0 = RB.revisarLote(db, { clientes: [{ rut: '76123456-7', clave: CLAVE }] }, FRANCISCA);
  assert.equal(r0.sin_lote, true);
  RB._reiniciar();
  const c2 = RB.crearAgente(db, { nombre: 'PC Luis' }, ADM);
  const espera = RB.agenteTomar(db, { agente_token: c2.llave, capacidades: 'lote' });
  assert.equal(RB.general(db, {}, FRANCISCA).lote, true);
  const r = RB.revisarLote(db, { clientes: [{ cliente_id: 'CLI-1', rut: '76123456-7', clave: CLAVE }, { rut: '78999888-1', clave: 'Clave-Tres' }] }, FRANCISCA);
  assert.equal(r.ok, true, r.message);
  const tomado = await espera;
  assert.deepEqual(tomado.lote.trabajos.map((t) => [t.rut, t.clave]), [['76123456-7', CLAVE], ['78999888-1', 'Clave-Tres']]);
  assert.equal(tomado.lote.pausa_ms, 20000);
  let e = RB.estadoLote(db, { lote_id: r.lote_id }, FRANCISCA);
  assert.ok(!JSON.stringify(e).includes(CLAVE), 'entregado el lote, el servidor ya no tiene claves');
  assert.match(e.items[1].paso, /En cola \(2 de 2\)/);
  // Revisando, el programa no consulta por trabajo nuevo: no debe verse "no conectado".
  const reloj = Date.now;
  Date.now = () => reloj() + 10 * 60 * 1000;
  try { assert.equal(RB.general(db, {}, FRANCISCA).conectado, true, 'con un lote en curso sigue conectado'); } finally { Date.now = reloj; }
  const [t1, t2] = tomado.lote.trabajos;
  assert.equal(RB.agenteEntregar(db, { agente_token: c2.llave, trabajo_id: t1.trabajo_id, resultado: { estado: 'OK', mensaje: '1 convenio leído.', convenios: [{ resolucion: '60225', cuotas: CUOTAS }] } }).ok, true);
  assert.equal(RB.general(db, {}, FRANCISCA).ocupado, true, 'falta uno: sigue ocupado');
  assert.equal(RB.agenteEntregar(db, { agente_token: c2.llave, trabajo_id: t2.trabajo_id, resultado: { estado: 'OK', mensaje: 'El cliente no tiene convenios vigentes en la TGR.', convenios: [] } }).ok, true);
  e = RB.estadoLote(db, { lote_id: r.lote_id }, FRANCISCA);
  assert.deepEqual([e.terminado, e.items[0].estado, e.items[1].estado], [true, 'LISTO', 'LISTO']);
  assert.equal(RB.general(db, {}, FRANCISCA).ocupado, false);
  RB._reiniciar();
  void viejo;
});

// --- De punta a punta, con el navegador real y un sitio de prueba ---------------------------
const RUTA = PdfChromium.rutaChrome();
const sinNavegador = !RUTA || process.env.CI ? 'sin navegador local (o en CI)' : false;

function sitio() {
  // A: TGR/portal (localhost) y "SII" (127.0.0.1, el host de ingreso). B: el recuadro de otro origen.
  const intentos = [];
  const pagos = [];
  const B = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Como puede venir en la TGR real: el número en una celda y un botón "Ver cuotas" en la fila.
    if (u.pathname === '/lista2') return res.end('<table><tr><th>N° Resolución</th><th>Activación</th><th></th></tr><tr><td>60225</td><td>31-03-2026</td><td><button onclick="location.href=\'/cuotas?res=60225\'">Ver cuotas</button></td></tr></table>');
    // Como es la TGR real (2-10-2026): "Convenios Activos y Propuestas Aceptadas", el enlace es el
    // N° de la izquierda (no la resolución) y el recuadro llega tarde.
    // El menú "Convenios" real: el robot debe tocar Imprimir Documentos › "Cuotas convenios vigentes"
    // y NUNCA "Cuotas de convenios vigentes" (Pagar). El enlace correcto abre la página COMPLETA
    // "Convenios Vigentes" (target=_top), que no se deja mostrar dentro de un recuadro.
    if (u.pathname === '/menu') return res.end('<h3>Convenios</h3><b>Pagar</b><p><a href="/pagar">Cuotas de convenios vigentes</a></p>' +
      '<b>Imprimir Documentos</b><p><a href="/x">Comprobante de resolución</a><br><a href="/x">Estado de pago de convenio</a><br>' +
      '<a href="http://localhost:' + A.address().port + '/convenios-vigentes?go=' + encodeURIComponent('http://localhost:' + B.address().port + '/lista3') + '" target="_top">Cuotas convenios vigentes</a></p>' +
      '<b>Consultas</b><p><a href="/x">Convenios Vigentes</a><br><a href="/x">Convenios Caducados</a></p>');
    if (u.pathname === '/pagar') { pagos.push(1); return res.end('<p>Seleccione las cuotas que desea pagar</p><table><tr><th>N° de Resolución</th><th>N° de Cuota</th><th>N° de Folio</th></tr><tr><td>60225</td><td>6</td><td><a href="/x">6022506</a></td></tr></table><button>IR A PAGAR</button>'); }
    if (u.pathname === '/lista3') {
      return setTimeout(() => res.end('<b>IMPRIMIR CUOTAS</b><p>Convenios Activos y Propuestas Aceptadas</p><table><tr><th>N°</th><th>N° Resolución</th><th>Fecha Resolución</th><th>Tipo de Convenio</th><th>N° Cuotas</th></tr>' +
        '<tr><td><a href="/cuotas?res=60225">1</a></td><td>60225</td><td>31-03-2026</td><td>Convenio Propyme Fiscal</td><td>16</td></tr></table>' +
        '<p>Haga "click" sobre el número ubicado a la izquierda del convenio o propuesta aceptada cuyas cuotas desea imprimir.</p><button>SALIR</button>'), 2000);
    }
    if (u.pathname === '/lista') return res.end('<h3>Convenios vigentes</h3><table><tr><th>N° Resolución</th></tr><tr><td><a href="/cuotas?res=60225">60225</a></td></tr><tr><td><a href="/cuotas?res=70001">70001</a></td></tr></table>');
    if (u.pathname === '/cuotas') {
      const filas = u.searchParams.get('res') === '60225'
        ? [['(*) 1', '31-12-2025', '97.570', 'SI'], ['(*) 2', '31-01-2026', '190.039', 'NO'], ['3', '28-02-2026', '0', 'NO']]
        : [['1', '10-05-2026', '50.000', 'SI']];
      return res.end('<h3>IMPRIMIR CUOTAS</h3><table><tr><th>Cuota</th><th>Fecha de Vencimiento</th><th>Monto ($)</th><th>Pagada</th></tr>' +
        filas.map((f) => '<tr>' + f.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</table>');
    }
    res.statusCode = 404; res.end('no');
  });
  const A = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const pa = A.address().port, pb = B.address().port;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (u.pathname === '/tramite') { res.statusCode = 302; res.setHeader('Location', 'http://127.0.0.1:' + pa + '/autentica'); return res.end(); }
    if (u.pathname === '/tramite-captcha') { res.statusCode = 302; res.setHeader('Location', 'http://127.0.0.1:' + pa + '/autentica?captcha=1'); return res.end(); }
    if (u.pathname === '/bloqueado') { res.statusCode = 403; return res.end('Forbidden'); }
    if (u.pathname === '/no-existe') { res.statusCode = 404; return res.end('<h1>Ups! Lo sentimos</h1><p>La página que buscabas no existe</p>'); }
    if (u.pathname === '/autentica') {
      return res.end('<h1>Te damos la bienvenida</h1>' + (u.searchParams.get('captcha') ? '<div class="g-recaptcha"></div>' : '') +
        '<button id="id-button-idp-claveTributaria" onclick="location.href=\'/sii\'">Clave Tributaria</button>');
    }
    if (u.pathname === '/intento') { intentos.push(u.searchParams.get('rut')); return res.end('ok'); }
    if (u.pathname === '/sii') {
      return res.end(`<form onsubmit="return false"><input id="inputRut"><input id="inputPass" type="password"><button id="bt_ingresar">Ingresar</button></form>
        <div id="err" class="alert-error" style="display:none">RUT o clave incorrecta</div>
        <div style="display:none" id="mCorreo"><input id="correo"></div>
        <div style="display:none" id="mCambio"><input id="MCurrentPass2" type="password"></div>
        <script>document.getElementById('bt_ingresar').onclick=function(){
          var rut=document.getElementById('inputRut').value, cl=document.getElementById('inputPass').value;
          fetch('/intento?rut='+encodeURIComponent(rut)).then(function(){
            if (rut==='11111111-1') return document.getElementById('mCorreo').style.display='block';
            if (rut==='22222222-2') return document.getElementById('mCambio').style.display='block';
            if (rut==='33333333-3') { alert('RUT o clave tributaria incorrecta'); return; }
            if (cl==='buena4') return location.href='http://localhost:${'${pa}'}/portal4';
            if (cl==='buena3') return location.href='http://localhost:${'${pa}'}/portal3';
            if (cl==='buena2') return location.href='http://localhost:${'${pa}'}/portal2';
            if (cl==='buena') return location.href='http://localhost:${'${pa}'}/portal';
            document.getElementById('err').style.display='block';
          });
        };</script>`.split('${pa}').join(pa));
    }
    if (u.pathname === '/convenios-vigentes') {
      res.setHeader('X-Frame-Options', 'DENY'); // como la TGR: dentro de un recuadro queda en blanco
      return res.end('<h1>Convenios Vigentes</h1><iframe src="' + u.searchParams.get('go') + '" style="width:900px;height:500px"></iframe>');
    }
    if (u.pathname === '/portal4') return res.end('<h1>Imprimir Cuotas de Convenios Vigentes</h1><nav>Pagos · Consulta tu resolución</nav><iframe src="http://localhost:' + pb + '/menu" style="width:900px;height:500px"></iframe>');
    if (u.pathname === '/portal3') return res.end('<h1>Imprimir Cuotas de Convenios Vigentes</h1><nav>Pagos · Certificados · Consulta tu resolución</nav><iframe src="http://localhost:' + pb + '/lista3" style="width:900px;height:500px"></iframe>');
    if (u.pathname === '/portal2') return res.end('<h1>Imprimir Cuotas de Convenios Vigentes</h1><iframe src="http://localhost:' + pb + '/lista2" style="width:900px;height:500px"></iframe>');
    if (u.pathname === '/portal') return res.end('<h1>Imprimir Cuotas de Convenios Vigentes</h1><iframe src="http://localhost:' + pb + '/lista" style="width:900px;height:500px"></iframe>');
    res.statusCode = 404; res.end('no');
  });
  return new Promise((ok) => B.listen(0, '127.0.0.1', () => A.listen(0, '127.0.0.1', () => ok({ A, B, intentos, pagos }))));
}
function receta(s, ruta) {
  const base = 'http://localhost:' + s.A.address().port;
  return { inicio: Array.isArray(ruta) ? ruta.map((r) => base + r) : base + (ruta || '/tramite'), hostsIngreso: ['127.0.0.1'], hostsMenu: ['localhost'], esperaMs: 8000 };
}

test('de punta a punta: ingresa, recorre los convenios del recuadro y se detiene cuando corresponde', { skip: sinNavegador, timeout: 180000 }, async () => {
  const s = await sitio();
  try {
    const pasos = [];
    let r = await Robot.revisarCliente({ rut: '76.123.456-7', clave: 'buena' }, { receta: receta(s), alPaso: (p) => pasos.push(p) });
    assert.equal(r.estado, 'OK', r.mensaje + ' ' + JSON.stringify(r.diagnostico && r.diagnostico.textos));
    assert.deepEqual(r.convenios.map((c) => [c.resolucion, c.cuotas.length]), [['60225', 3], ['70001', 1]]);
    assert.deepEqual(r.convenios[0].cuotas[1], { n: 2, vencimiento: '2026-01-31', monto: 190039, tgr: 'NO' });
    assert.ok(pasos.includes('Ingresando con la Clave Tributaria'));

    // Como pasó el 2-10-2026 con www.tgr.cl: la primera dirección "no existe" → prueba la siguiente.
    r = await Robot.revisarCliente({ rut: '76.123.456-7', clave: 'buena' }, { receta: receta(s, ['/no-existe', '/tramite']) });
    assert.equal(r.estado, 'OK', r.mensaje);
    assert.equal(r.convenios.length, 2);
    r = await Robot.revisarCliente({ rut: '76.123.456-7', clave: 'buena' }, { receta: receta(s, ['/no-existe']) });
    assert.equal(r.estado, 'PAGINA_DISTINTA');
    assert.match(r.mensaje, /no existe/);

    r = await Robot.revisarCliente({ rut: '76123456-7', clave: 'mala' }, { receta: receta(s) });
    assert.equal(r.estado, 'CLAVE_INVALIDA', r.mensaje);
    assert.ok(r.diagnostico && r.diagnostico.captura, 'trae la captura para entender qué pasó');
    assert.equal(s.intentos.filter((x) => x === '76123456-7').length, 3, 'un solo intento por revisión (2 buenos + 1 malo)');
    assert.ok(r.diagnostico && Array.isArray(r.diagnostico.elementos), 'el diagnóstico trae los botones de la página');

    r = await Robot.revisarCliente({ rut: '11111111-1', clave: 'buena' }, { receta: receta(s) });
    assert.equal(r.estado, 'DESAFIO');
    // 2-10-2026: un aviso emergente del SII congelaba la página. Ahora se lee, se cierra y se detiene.
    const t0 = Date.now();
    r = await Robot.revisarCliente({ rut: '33333333-3', clave: 'buena' }, { receta: receta(s) });
    assert.equal(r.estado, 'CLAVE_INVALIDA', r.mensaje);
    assert.match(r.mensaje, /RUT o clave tributaria incorrecta/);
    assert.ok(Date.now() - t0 < 30000, 'no se queda congelado');
    // Lista con botón "Ver cuotas" en la fila de la resolución.
    r = await Robot.revisarCliente({ rut: '76123456-7', clave: 'buena2' }, { receta: receta(s) });
    assert.equal(r.estado, 'OK', r.mensaje + ' ' + JSON.stringify(r.diagnostico && r.diagnostico.elementos));
    assert.deepEqual(r.convenios.map((c) => [c.resolucion, c.cuotas.length]), [['60225', 3]]);
    // El paso a paso real: menú › "Cuotas convenios vigentes" › "1" de la fila › cuotas. Nunca la página de pago.
    const pasos4 = [];
    r = await Robot.revisarCliente({ rut: '76123456-7', clave: 'buena4' }, { receta: receta(s), alPaso: (x) => pasos4.push(x) });
    assert.equal(r.estado, 'OK', r.mensaje + ' ' + JSON.stringify(r.diagnostico && r.diagnostico.elementos));
    assert.deepEqual(r.convenios.map((c) => [c.resolucion, c.cuotas.length]), [['60225', 3]]);
    assert.ok(pasos4.includes('Abriendo "Cuotas convenios vigentes"'));
    assert.equal(s.pagos.length, 0, 'nunca entra a la página de pago');
    // La página real: la palabra "Resolución" afuera no engaña; espera el recuadro y toca el "1" de la fila.
    r = await Robot.revisarCliente({ rut: '76123456-7', clave: 'buena3' }, { receta: receta(s) });
    assert.equal(r.estado, 'OK', r.mensaje + ' ' + JSON.stringify(r.diagnostico && r.diagnostico.elementos));
    assert.deepEqual(r.convenios.map((c) => [c.resolucion, c.cuotas.length]), [['60225', 3]]);
    r = await Robot.revisarCliente({ rut: '22222222-2', clave: 'buena' }, { receta: receta(s) });
    assert.equal(r.estado, 'CAMBIO_CLAVE');
    r = await Robot.revisarCliente({ rut: '76123456-7', clave: 'buena' }, { receta: receta(s, '/tramite-captcha') });
    assert.equal(r.estado, 'CAPTCHA');
    r = await Robot.revisarCliente({ rut: '76123456-7', clave: 'buena' }, { receta: receta(s, '/bloqueado') });
    assert.equal(r.estado, 'BLOQUEADO');
  } finally {
    s.A.close();
    s.B.close();
  }
});
