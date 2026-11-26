'use strict';

// Oficina virtual: quién se sienta dónde, con su descriptor, y qué NO sale nunca.
const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Oficina = require('../logica/oficinaVirtual');
const { ejecutarAccion, ACCIONES } = require('../server/router');

const TABLAS = ['SGC_PERSONAS', 'SGC_DESCRIPTORES', 'SGC_ROLES', 'OFICINA_PUESTOS', 'JEFATURAS'];
const CTX_OPERATIVA = { email: 'asistente@homepymes.cl', nombre: 'Asistente', rol: 'DEV' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };

function persona(db, id, nombre, cargo, extra = {}) {
  agregarFila_(db, 'SGC_PERSONAS', Object.assign({
    persona_id: id, usuario_email: id + '@homepymes.cl', nombre, rut: '11.111.111-1', cargo, tipo: 'INT',
    area_id: '', jefatura_email: '', estado: 'ACTIVO', activa: true
  }, extra));
}
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  persona(db, 'gaf', 'Paula Gerenta', 'Gerenta de Administración y Finanzas');
  persona(db, 'fac', 'Fernanda Cobros', 'Gerenta de Facturación y Cobranzas', { jefatura_email: 'gaf@homepymes.cl' });
  persona(db, 'con', 'Carla Contable', 'Asistente de Contabilidad', { jefatura_email: 'gaf@homepymes.cl' });
  persona(db, 'pra', 'Pía Práctica', 'Practicante Administración de Plataformas');
  persona(db, 'pre', 'Valeria Segura', 'Encargada de Prevención');
  persona(db, 'ext', 'Asesor Externo', 'Contador externo', { tipo: 'EXT' });
  persona(db, 'gg', 'Gerente General', 'Gerente General');
  persona(db, 'baja', 'Ya No Está', 'Asistente de RR.HH.', { estado: 'DESVINCULADO' });
  agregarFila_(db, 'SGC_DESCRIPTORES', {
    descriptor_id: 'd1', persona_id: 'con', version: '2', objetivo: 'Registrar la contabilidad del mes.',
    funciones: '• Registrar compras y ventas\n• Preparar el F29', responsabilidades: 'Libros al día',
    items_responsabilidades: JSON.stringify(['Libros al día', 'Respaldos archivados']), habilidades: 'Excel\nOrden',
    nivel_educacional: 'Técnico contable', experiencia: '1 año', vigente: true, fecha: '2026-11-01'
  });
  agregarFila_(db, 'SGC_DESCRIPTORES', { descriptor_id: 'd0', persona_id: 'con', version: '1', objetivo: 'VIEJO', vigente: false });
  return db;
}

test('cada persona cae en su oficina por el cargo, con su descriptor vigente y su jefatura', () => {
  const db = db_();
  const r = Oficina.getOficina(db, {}, CTX_OPERATIVA);
  const por = Object.fromEntries(r.personas.map((p) => [p.persona_id, p]));
  assert.equal(por.gaf.sala_id, 'jefaturas');
  assert.equal(por.fac.sala_id, 'recepcion');
  assert.equal(por.con.sala_id, 'operativo');
  assert.equal(por.pra.sala_id, 'plataformas');
  assert.equal(por.pre.sala_id, 'prevencion');
  assert.equal(por.con.jefatura_persona_id, 'gaf');
  assert.deepEqual(por.con.descriptor.funciones, ['Registrar compras y ventas', 'Preparar el F29']);
  assert.deepEqual(por.con.descriptor.responsabilidades, ['Libros al día', 'Respaldos archivados']);
  assert.deepEqual(por.con.descriptor.habilidades, ['Excel', 'Orden']);
  assert.equal(por.con.descriptor.objetivo, 'Registrar la contabilidad del mes.');
  assert.equal(por.gaf.descriptor, null);
  // los externos y los sin regla no se sientan solos; los desvinculados no aparecen
  assert.ok(!por.ext && !por.gg && !por.baja);
  assert.equal(r.puede_ordenar, false);
  assert.deepEqual(r.sin_oficina, []);
});

test('nunca salen RUT ni correos, ni a quien administra', () => {
  const db = db_();
  for (const ctx of [CTX_OPERATIVA, CTX_ADM]) {
    const texto = JSON.stringify(Oficina.getOficina(db, {}, ctx));
    assert.ok(!texto.includes('11.111.111-1'), 'RUT');
    assert.ok(!texto.includes('@homepymes.cl'), 'correo');
  }
});

test('quien administra ve a los sin oficina y los sienta; la asignación manda sobre el cargo', () => {
  const db = db_();
  const antes = Oficina.getOficina(db, {}, CTX_ADM);
  assert.equal(antes.puede_ordenar, true);
  assert.deepEqual(antes.sin_oficina.map((p) => p.persona_id).sort(), ['ext', 'gg']);

  Oficina.asignarPuesto(db, { persona_id: 'gg', sala_id: 'jefaturas' }, CTX_ADM);
  Oficina.asignarPuesto(db, { persona_id: 'pra', sala_id: 'podcast' }, CTX_ADM);
  Oficina.asignarPuesto(db, { persona_id: 'pra', sala_id: 'recepcion' }, CTX_ADM); // se cambia de nuevo
  const por = Object.fromEntries(Oficina.getOficina(db, {}, CTX_OPERATIVA).personas.map((p) => [p.persona_id, p]));
  assert.equal(por.gg.sala_id, 'jefaturas');
  assert.equal(por.pra.sala_id, 'recepcion');
  assert.equal(por.pra.sala_asignada, true);
  assert.equal(leerFilas_(db, 'OFICINA_PUESTOS', COLUMNAS.OFICINA_PUESTOS).filter((p) => p.persona_id === 'pra' && p.activa).length, 1);

  // sala vacía = vuelve a la sugerida por el cargo
  Oficina.asignarPuesto(db, { persona_id: 'pra', sala_id: '' }, CTX_ADM);
  const pra = Oficina.getOficina(db, {}, CTX_OPERATIVA).personas.find((p) => p.persona_id === 'pra');
  assert.equal(pra.sala_id, 'plataformas');
  assert.equal(pra.sala_asignada, false);
});

test('una persona operativa no puede ordenar la oficina, y no se aceptan oficinas fuera del plano', () => {
  const db = db_();
  assert.ok(Oficina.asignarPuesto(db, { persona_id: 'gg', sala_id: 'jefaturas' }, CTX_OPERATIVA)._validationError);
  assert.ok(Oficina.asignarPuesto(db, { persona_id: 'gg', sala_id: 'azotea' }, CTX_ADM)._validationError);
  assert.ok(Oficina.asignarPuesto(db, { persona_id: 'nadie', sala_id: 'jefaturas' }, CTX_ADM)._validationError);
  assert.ok(Oficina.getOficina(db, {}, null)._validationError);
});

test('una persona con dos cargos (dos fichas, mismo correo) aparece UNA vez, con ambos cargos y descriptores', () => {
  const db = db_();
  // Camila: dos fichas con el mismo correo; la prevencionista le reporta a la ficha "secundaria"
  persona(db, 'cam1', 'Camila Pérez', 'Encargada de Prevención', { usuario_email: 'camila@homepymes.cl' });
  persona(db, 'cam2', 'Camila Pérez', 'Coordinadora de Pausas Activas', { usuario_email: 'camila@homepymes.cl' });
  persona(db, 'pre2', 'Ana Riesgos', 'Prevencionista de Riesgos', { jefatura_email: 'camila@homepymes.cl' });
  agregarFila_(db, 'SGC_DESCRIPTORES', { descriptor_id: 'dc1', persona_id: 'cam1', version: '1', objetivo: 'Prevenir accidentes.', vigente: true });
  agregarFila_(db, 'SGC_DESCRIPTORES', { descriptor_id: 'dc2', persona_id: 'cam2', version: '1', objetivo: 'Coordinar pausas.', vigente: true });
  const r = Oficina.getOficina(db, {}, CTX_OPERATIVA);
  const camilas = r.personas.filter((p) => p.nombre === 'Camila Pérez');
  assert.equal(camilas.length, 1);
  assert.equal(camilas[0].sala_id, 'prevencion');
  assert.equal(camilas[0].cargo, 'Encargada de Prevención · Coordinadora de Pausas Activas');
  assert.deepEqual(camilas[0].descriptores.map((d) => d.objetivo), ['Prevenir accidentes.', 'Coordinar pausas.']);
  assert.equal(r.personas.find((p) => p.persona_id === 'pre2').jefatura_persona_id, camilas[0].persona_id);
  assert.equal(Oficina.salaSugerida_('Practicante de Prevención de Riesgos'), 'prevencion');
  assert.equal(Oficina.salaSugerida_('Practicante Administración de Plataformas'), 'plataformas');

  // asignarla por una ficha la mueve entera, y no queda otro puesto viejo de la otra ficha
  Oficina.asignarPuesto(db, { persona_id: 'cam2', sala_id: 'jefaturas' }, CTX_ADM);
  Oficina.asignarPuesto(db, { persona_id: 'cam1', sala_id: 'operativo' }, CTX_ADM);
  const despues = Oficina.getOficina(db, {}, CTX_OPERATIVA).personas.filter((p) => p.nombre === 'Camila Pérez');
  assert.equal(despues.length, 1);
  assert.equal(despues[0].sala_id, 'operativo');
});

test('fantasmas: por ficha o por cuenta sin ficha, sin duplicar, y cada uno se reconoce a sí mismo', () => {
  const db = db_();
  sembrarTabla_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL, []);
  sembrarTabla_(db, 'OFICINA_FANTASMAS', COLUMNAS.OFICINA_FANTASMAS, []);
  const cuenta = (id, nombre, cargo, correo) => agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: id, nombre, cargo, emails: JSON.stringify([correo]), activo: true });
  cuenta('c-luis', 'Luis Desarrollo', 'Desarrollo SIGSO', 'luis@otro.cl');           // sin ficha
  cuenta('c-con', 'Carla Contable', 'Asistente', 'con@homepymes.cl');                // tiene ficha
  persona(db, 'val', 'Valentina Equis', 'Jefa de Proyectos');                         // ficha sin oficina por cargo

  // candidatos: solo cuentas SIN ficha, sin correos
  const cand = Oficina.getOficina(db, {}, CTX_ADM).candidatos_fantasma;
  assert.deepEqual(cand.map((c) => c.persona_id), ['cuenta:c-luis']);
  assert.ok(!JSON.stringify(cand).includes('@'));

  assert.ok(Oficina.marcarFantasma(db, { persona_id: 'cuenta:c-luis', fantasma: true }, CTX_OPERATIVA)._validationError);
  Oficina.marcarFantasma(db, { persona_id: 'cuenta:c-luis', fantasma: true }, CTX_ADM);
  Oficina.marcarFantasma(db, { persona_id: 'val', fantasma: true }, CTX_ADM);
  Oficina.marcarFantasma(db, { persona_id: 'cuenta:c-con', fantasma: true }, CTX_ADM); // cuenta con ficha → la ficha

  const r = Oficina.getOficina(db, {}, { email: 'luis@otro.cl', emails: ['luis@otro.cl'], cuenta_id: 'c-luis', rol: 'DEV' });
  const fantas = r.personas.filter((p) => p.fantasma).map((p) => p.persona_id).sort();
  assert.deepEqual(fantas, ['con', 'cuenta:c-luis', 'val']);
  assert.equal(r.personas.filter((p) => p.nombre === 'Carla Contable').length, 1);
  assert.equal(r.yo.persona_id, 'cuenta:c-luis');
  assert.equal(r.yo.nombre, 'Luis Desarrollo');
  // quien tiene ficha se reconoce por su correo
  assert.equal(Oficina.getOficina(db, {}, { email: 'pre@homepymes.cl', emails: ['pre@homepymes.cl'], rol: 'DEV' }).yo.persona_id, 'pre');

  // desmarcar: Valentina vuelve a "sin oficina" (su cargo no indica dónde)
  Oficina.marcarFantasma(db, { persona_id: 'val', fantasma: false }, CTX_ADM);
  const admin = Oficina.getOficina(db, {}, CTX_ADM);
  assert.ok(!admin.personas.some((p) => p.persona_id === 'val'));
  assert.ok(admin.sin_oficina.some((p) => p.persona_id === 'val'));
});

test('el módulo «oficina» se activa una sola vez en todas las cuentas y después manda el Admin', () => {
  const CuentasPortal = require('../logica/cuentasPortal');
  const db = abrirDb_();
  ['CUENTAS_PORTAL', 'LOG_SISTEMA'].forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'a', nombre: 'A', modulos: JSON.stringify(['bandeja']), activo: true });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'b', nombre: 'B', modulos: JSON.stringify(['bandeja', 'oficina']), activo: true });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'c', nombre: 'C', modulos: '', activo: false });
  const mods = (id) => JSON.parse(leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL).find((c) => c.cuenta_id === id).modulos);

  assert.deepEqual(Oficina.activarModuloEnCuentas_(db), { ya_hecha: false, cuentas: 2 });
  assert.deepEqual(mods('a'), ['bandeja', 'oficina']);
  assert.deepEqual(mods('b'), ['bandeja', 'oficina']);
  assert.deepEqual(mods('c'), ['oficina']);

  // el Admin se la quita a «a»: al reiniciar el servidor NO se le vuelve a poner
  require('../db/sqliteRepo').actualizarFilaPorId_(db, 'CUENTAS_PORTAL', 'cuenta_id', 'a', { modulos: JSON.stringify(['bandeja']) });
  assert.equal(Oficina.activarModuloEnCuentas_(db).ya_hecha, true);
  assert.deepEqual(mods('a'), ['bandeja']);

  // y se puede asignar a mano desde Administración
  assert.ok(CuentasPortal.MODULOS_VALIDOS.includes('oficina'));
  Object.values(CuentasPortal.MODULOS_POR_ROL).forEach((l) => assert.ok(l.includes('oficina')));
});

test('presencia en vivo: se ven entre todos, los saludos llegan y quien se va desaparece', () => {
  Oficina.reiniciarPresencia_();
  const db = db_();
  const carla = { email: 'con@homepymes.cl', emails: ['con@homepymes.cl'], cuenta_id: 'c-carla', rol: 'DEV' };
  const vale = { email: 'pre@homepymes.cl', emails: ['pre@homepymes.cl'], cuenta_id: 'c-vale', rol: 'DEV' };
  const mira = { email: 'x@otro.cl', emails: ['x@otro.cl'], cuenta_id: 'c-mira', rol: 'DEV' };
  const t0 = 1_000_000;

  const r1 = Oficina.presencia(db, { estado: { x: 1, z: -3, ry: 0.5, mov: true } }, carla, t0);
  assert.deepEqual(r1.otros, []);
  Oficina.presencia(db, { estado: { x: 2, z: -6, ry: 0, mov: false } }, vale, t0 + 100);
  // quien solo mira (sin estado) ve a las dos, pero no aparece
  const r3 = Oficina.presencia(db, {}, mira, t0 + 200);
  assert.deepEqual(r3.otros.map((o) => o.persona_id).sort(), ['con', 'pre']);
  const c = r3.otros.find((o) => o.persona_id === 'con');
  assert.equal(c.x, 1); assert.equal(c.z, -3); assert.equal(c.mov, true);
  assert.equal(c.nombre, 'Carla'); // solo el primer nombre
  assert.ok(!JSON.stringify(r3).includes('@') && !JSON.stringify(r3).includes('c-carla'), 'ni correos ni ids de cuenta');

  // Carla saluda a Valentina → le llega una sola vez
  Oficina.presencia(db, { estado: { x: 1.5, z: -4 }, saludar_a: r3.otros.find((o) => o.persona_id === 'pre').clave }, carla, t0 + 300);
  const v1 = Oficina.presencia(db, { estado: { x: 2, z: -6 } }, vale, t0 + 400);
  assert.deepEqual(v1.saludos.map((s) => s.nombre), ['Carla']);
  assert.deepEqual(Oficina.presencia(db, { estado: { x: 2, z: -6 } }, vale, t0 + 500).saludos, []);

  // las posiciones absurdas se recortan; «fin» la saca; y sin reportar 8 s, desaparece
  Oficina.presencia(db, { estado: { x: 9999, z: -9999 } }, carla, t0 + 600);
  assert.deepEqual(Oficina.presencia(db, {}, mira, t0 + 650).otros.find((o) => o.persona_id === 'con').x, 12);
  Oficina.presencia(db, { fin: true }, carla, t0 + 700);
  assert.deepEqual(Oficina.presencia(db, {}, mira, t0 + 800).otros.map((o) => o.persona_id), ['pre']);
  assert.deepEqual(Oficina.presencia(db, {}, mira, t0 + 500 + 8001).otros, []);
  assert.ok(Oficina.presencia(db, {}, null)._validationError);
  Oficina.reiniciarPresencia_();
});

test('canal en vivo: cada posición se empuja al instante a los demás, no a uno mismo', () => {
  Oficina.reiniciarPresencia_();
  const db = db_();
  const carla = { email: 'con@homepymes.cl', emails: ['con@homepymes.cl'], cuenta_id: 'c-carla', rol: 'DEV' };
  const vale = { email: 'pre@homepymes.cl', emails: ['pre@homepymes.cl'], cuenta_id: 'c-vale', rol: 'DEV' };
  const t0 = 2_000_000;
  const aCarla = [], aVale = [];
  const cerrarCarla = Oficina.suscribir(db, carla, (e) => aCarla.push(e), t0);
  Oficina.suscribir(db, vale, (e) => aVale.push(e), t0);
  assert.equal(aVale[0].tipo, 'estado'); assert.deepEqual(aVale[0].otros, []);

  Oficina.presencia(db, { estado: { x: 1, z: -3, mov: true }, ligero: true }, carla, t0 + 50);
  const pos = aVale.find((e) => e.tipo === 'pos');
  assert.equal(pos.persona_id, 'con'); assert.equal(pos.x, 1); assert.equal(pos.mov, true);
  assert.ok(!aCarla.some((e) => e.tipo === 'pos'), 'a una misma no le llega su propia posición');
  // «ligero» no devuelve listas (con el canal abierto no hacen falta)
  assert.deepEqual(Object.keys(Oficina.presencia(db, { estado: { x: 1.2, z: -3 }, ligero: true }, carla, t0 + 100)), ['yo']);

  // saludo en vivo: llega por el canal, no queda en el buzón
  Oficina.presencia(db, { estado: { x: 2, z: -6 }, ligero: true }, vale, t0 + 150);
  Oficina.presencia(db, { saludar_a: aCarla[0].yo, ligero: true }, vale, t0 + 200); // aCarla[0] = su «estado» inicial, trae su clave
  assert.deepEqual(aCarla.filter((e) => e.tipo === 'saludo').map((e) => e.nombre), ['Valeria']);

  // «fin» avisa a todos; quien cierra el canal deja de recibir
  Oficina.presencia(db, { fin: true }, carla, t0 + 300);
  assert.ok(aVale.some((e) => e.tipo === 'sale' && e.clave === pos.clave));
  cerrarCarla();
  const antes = aCarla.length;
  Oficina.presencia(db, { estado: { x: 3, z: -6 }, ligero: true }, vale, t0 + 400);
  assert.equal(aCarla.length, antes);
  Oficina.reiniciarPresencia_();
});

test('canal en vivo por HTTP: pide sesión válida y entrega eventos', async () => {
  Oficina.reiniciarPresencia_();
  const { crearServidor } = require('../server/app');
  const Sesiones = require('../logica/sesiones');
  const db = db_();
  ['SESIONES_PORTAL', 'CUENTAS_PORTAL'].forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'c1', usuario: 'c1', nombre: 'Carla', emails: JSON.stringify(['con@homepymes.cl']), rol: 'DEV', modulos: '[]', activo: true });
  const token = Sesiones.crearSesion(db, 'c1', 1);
  const servidor = crearServidor(db);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + servidor.address().port + '/v1/oficina/vivo';
  try {
    const malo = await fetch(url, { method: 'POST', body: JSON.stringify({ portal_token: 'no' }) });
    assert.equal(malo.status, 403);
    const control = new AbortController();
    const r = await fetch(url, { method: 'POST', body: JSON.stringify({ portal_token: token }), signal: control.signal });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/event-stream/);
    const lector = r.body.getReader();
    const { value } = await lector.read();
    const primero = JSON.parse(new TextDecoder().decode(value).replace(/^data: /, '').trim());
    assert.equal(primero.tipo, 'estado');
    control.abort();
  } finally {
    await new Promise((r) => { servidor.closeAllConnections && servidor.closeAllConnections(); servidor.close(r); });
    Oficina.reiniciarPresencia_();
  }
});

test('las acciones están en el router y piden sesión', async () => {
  assert.equal(typeof ACCIONES.getOficinaVirtual, 'function');
  assert.equal(typeof ACCIONES.asignarPuestoOficina, 'function');
  const db = db_();
  ['SESIONES_PORTAL', 'CUENTAS_PORTAL'].forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  const r = await ejecutarAccion(db, 'getOficinaVirtual', { portal_token: 'no-existe' }, {});
  assert.equal(r.status, 403);
});
