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

test('las acciones están en el router y piden sesión', async () => {
  assert.equal(typeof ACCIONES.getOficinaVirtual, 'function');
  assert.equal(typeof ACCIONES.asignarPuestoOficina, 'function');
  const db = db_();
  ['SESIONES_PORTAL', 'CUENTAS_PORTAL'].forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  const r = await ejecutarAccion(db, 'getOficinaVirtual', { portal_token: 'no-existe' }, {});
  assert.equal(r.status, 403);
});
