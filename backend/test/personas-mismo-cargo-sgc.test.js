'use strict';

/**
 * Un cargo, varias personas (2026-10-28). Caso real: entra una segunda
 * Asistente de RR.HH. (mismo cargo que Vanessa); se activó su cuenta y se le
 * dio rol en Calidad → Accesos, pero su "Mi ficha" quedaba vacía: activar no
 * crea la ficha, y el descriptor vivía solo en la ficha de la primera.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Personas = require('../logica/personasSgc');
const Panel = require('../logica/personasPanelSgc');

const TABLAS = [
  'SGC_PERSONAS', 'SGC_DESCRIPTORES', 'SGC_PERSONA_DOCUMENTOS', 'SGC_INDUCCIONES', 'SGC_ROLES', 'CUENTAS_PORTAL',
  'JEFATURAS', 'LOG_SISTEMA', 'SGC_EVALUACIONES', 'SGC_CAPACITACIONES', 'SGC_CAPACITACION_ASISTENTES',
  'NOTIFICACIONES_APP', 'LOG_NOTIFICACIONES', 'CONFIG_NOTIFICACIONES', 'DIRECTORIO_PERSONAS'
];
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function cuenta(db, email, nombre, cargo) {
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'c-' + email, usuario: email, nombre, cargo: cargo || '', emails: JSON.stringify([email]), rol: 'DEV', activo: true });
}

const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };
const CTX_ENCARGADO = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_NUEVA = { email: 'nueva@gmail.com', nombre: 'Constanza', rol: 'DEV' };

async function sembrar(db) {
  Calidad.gestionarRol(db, { usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'vanessa@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'RRHH' }, CTX_ADM);
  cuenta(db, 'vanessa@homepymes.cl', 'Vanessa Sepúlveda', 'Asistente de RR.HH.');
  const vanessa = Personas.guardarPersona(db, { usuario_email: 'vanessa@homepymes.cl', nombre: 'Vanessa Sepúlveda', cargo: 'Asistente de Recursos Humanos', tipo: 'INT', area_id: 'RRHH', jefatura_email: 'jefa@homepymes.cl' }, CTX_ENCARGADO);
  await Personas.guardarDescriptor(db, { persona_id: vanessa.persona_id, version: 'v02', objetivo: 'Apoyar la gestión de personas.', items_responsabilidades: ['Contratos', 'Previred'], items_habilidades: ['Orden'] }, CTX_ENCARGADO);
  // La nueva: cuenta activa + rol en Accesos, SIN ficha.
  cuenta(db, 'nueva@gmail.com', 'Constanza Cardenas', '');
  Calidad.gestionarRol(db, { usuario_email: 'nueva@gmail.com', rol_sgc: 'OPERATIVO', area_id: 'RRHH' }, CTX_ADM);
  return { vanessa };
}

test('cuenta con rol SGC y sin ficha: aparece para el Encargado, no para el personal', async () => {
  const db = db_();
  await sembrar(db);
  const enc = Personas.listar(db, {}, CTX_ENCARGADO);
  assert.deepEqual(enc.cuentas_sin_ficha.map((c) => c.email), ['nueva@gmail.com']);
  assert.equal(enc.cuentas_sin_ficha[0].area_id, 'RRHH');
  assert.equal(Personas.listar(db, {}, CTX_NUEVA).cuentas_sin_ficha.length, 0);
  // El panel v2 lo pasa a la pantalla.
  assert.equal(Panel.getPanel(db, {}, CTX_ENCARGADO).cuentas_sin_ficha.length, 1);
  assert.ok(Panel.getPanel(db, {}, CTX_ENCARGADO).cargos.some((c) => c.cargo === 'Asistente de Recursos Humanos' && c.descriptor_version === 'v02'));
});

test('crear la ficha con un cargo que ya existe hereda el descriptor vigente; cada una conserva lo suyo', async () => {
  const db = db_();
  const { vanessa } = await sembrar(db);
  // Escrito distinto (mayúsculas, sin tilde, espacios): es el mismo cargo.
  const nueva = Personas.guardarPersona(db, { usuario_email: 'nueva@gmail.com', nombre: 'Constanza Cardenas', cargo: '  asistente de recursos  HUMANOS', tipo: 'INT', area_id: 'RRHH' }, CTX_ENCARGADO);
  assert.equal(nueva.descriptor_copiado_de, 'Vanessa Sepúlveda');
  assert.equal(nueva.descriptor_version, 'v02');

  const ficha = Personas.getFicha(db, { persona_id: nueva.persona_id }, CTX_NUEVA);
  assert.ok(ficha.persona, 'la nueva ve su ficha');
  assert.equal(ficha.descriptor_vigente.version, 'v02');
  assert.deepEqual(ficha.items_responsabilidades, ['Contratos', 'Previred']);
  assert.equal(ficha.induccion.length, 5, 'inducción propia, toda pendiente');
  assert.ok(ficha.induccion.every((i) => i.estado === 'PENDIENTE'));
  // El descriptor de Vanessa sigue vigente y es una fila aparte.
  assert.equal(Personas.getFicha(db, { persona_id: vanessa.persona_id }, CTX_ENCARGADO).descriptor_vigente.version, 'v02');
  assert.equal(filas(db, 'SGC_DESCRIPTORES').filter((d) => d.vigente === true || d.vigente === 'TRUE' || d.vigente === 1).length, 2);
  // Y ya no figura como "sin ficha".
  assert.equal(Personas.listar(db, {}, CTX_ENCARGADO).cuentas_sin_ficha.length, 0);
  // Su listado: solo ella.
  assert.deepEqual(Personas.listar(db, {}, CTX_NUEVA).personas.map((p) => p.nombre), ['Constanza Cardenas']);
});

test('"Mismo cargo que…" elige de quién copiar aunque el cargo escrito sea otro', async () => {
  const db = db_();
  const { vanessa } = await sembrar(db);
  const nueva = Personas.guardarPersona(db, { usuario_email: 'nueva@gmail.com', nombre: 'Constanza Cardenas', cargo: 'Asistente RRHH', tipo: 'INT', copiar_descriptor_de: vanessa.persona_id }, CTX_ENCARGADO);
  assert.equal(nueva.descriptor_copiado_de, 'Vanessa Sepúlveda');
});

test('cargo nuevo: no copia nada', async () => {
  const db = db_();
  await sembrar(db);
  const nueva = Personas.guardarPersona(db, { usuario_email: 'nueva@gmail.com', nombre: 'Constanza Cardenas', cargo: 'Analista de Marketing', tipo: 'INT' }, CTX_ENCARGADO);
  assert.equal(nueva.descriptor_copiado_de, undefined);
  assert.equal(Personas.getFicha(db, { persona_id: nueva.persona_id }, CTX_ENCARGADO).descriptor_vigente, null);
});

test('nueva versión o corrección del descriptor se aplica a todo el cargo si se pide', async () => {
  const db = db_();
  const { vanessa } = await sembrar(db);
  const nueva = Personas.guardarPersona(db, { usuario_email: 'nueva@gmail.com', nombre: 'Constanza Cardenas', cargo: 'Asistente de Recursos Humanos', tipo: 'INT' }, CTX_ENCARGADO);
  assert.deepEqual(Personas.getFicha(db, { persona_id: vanessa.persona_id }, CTX_ENCARGADO).mismo_cargo.map((m) => m.nombre), ['Constanza Cardenas']);

  const v3 = await Personas.guardarDescriptor(db, { persona_id: vanessa.persona_id, version: 'v03', objetivo: 'Gestión de personas v3.', items_responsabilidades: ['Contratos'], items_habilidades: ['Orden'], aplicar_mismo_cargo: true }, CTX_ENCARGADO);
  assert.deepEqual(v3.aplicado_a, ['Constanza Cardenas']);
  assert.equal(Personas.getFicha(db, { persona_id: nueva.persona_id }, CTX_ENCARGADO).descriptor_vigente.version, 'v03');

  const fichaV = Personas.getFicha(db, { persona_id: vanessa.persona_id }, CTX_ENCARGADO);
  await Personas.actualizarDescriptor(db, { persona_id: vanessa.persona_id, descriptor_id: fichaV.descriptor_vigente.descriptor_id, objetivo: 'Corregido.', items_responsabilidades: ['Contratos', 'Finiquitos'], items_habilidades: ['Orden'], aplicar_mismo_cargo: true }, CTX_ENCARGADO);
  const fichaN = Personas.getFicha(db, { persona_id: nueva.persona_id }, CTX_ENCARGADO);
  assert.equal(fichaN.descriptor_vigente.objetivo, 'Corregido.');
  assert.deepEqual(fichaN.items_responsabilidades, ['Contratos', 'Finiquitos']);

  // Sin marcar la casilla, solo cambia la ficha propia.
  await Personas.guardarDescriptor(db, { persona_id: vanessa.persona_id, version: 'v04', objetivo: 'Solo Vanessa.', items_responsabilidades: ['x'], items_habilidades: ['y'] }, CTX_ENCARGADO);
  assert.equal(Personas.getFicha(db, { persona_id: nueva.persona_id }, CTX_ENCARGADO).descriptor_vigente.version, 'v03');
});
