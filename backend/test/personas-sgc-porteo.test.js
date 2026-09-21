'use strict';

/**
 * Prueba de portabilidad: SGC ISO 9001 Fase 2a + 2b (PRO-02) -- escenarios
 * de personas-sgc.test.js, corridos contra backend/logica/personasSgc.js.
 *
 * Los archivos (descriptor de cargo, documentos del personal) usan R2 de
 * verdad desde 2026-09-18 (mismo incremento que desgateó SGC Documentos):
 * `descriptorConItems()`/`guardarDescriptor` vuelven a adjuntar (u ofrecer
 * adjuntar) un PDF real, igual que el `.gs` original, y las 5 funciones de
 * archivo (guardarDescriptor/actualizarDescriptor/descargarDescriptor/
 * guardarDocumento/descargarDocumento) son ahora `async`. El mock de
 * Almacenamiento vive por-test vía `conMockAlmacenamiento_(t)`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Personas = require('../logica/personasSgc');
const Resend = require('../logica/resend');
const Almacenamiento = require('../logica/almacenamiento');

const TABLAS = [
  'SGC_PERSONAS', 'SGC_DESCRIPTORES', 'SGC_PERSONA_DOCUMENTOS', 'SGC_INDUCCIONES', 'SGC_ROLES',
  'JEFATURAS', 'LOG_SISTEMA', 'SGC_EVALUACIONES', 'SGC_CAPACITACIONES', 'SGC_CAPACITACION_ASISTENTES',
  'NOTIFICACIONES_APP', 'LOG_NOTIFICACIONES', 'CONFIG_NOTIFICACIONES'
];
function db_() {
  const db = abrirDb_();
  TABLAS.forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

const CTX_ENCARGADO = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_JEFA = { email: 'jefa@homepymes.cl', nombre: 'Jefa Prevencion', rol: 'DEV' };
const CTX_ANA = { email: 'ana@homepymes.cl', nombre: 'Ana', rol: 'DEV' };
const CTX_PEDRO = { email: 'pedro@homepymes.cl', nombre: 'Pedro', rol: 'DEV' };
const CTX_ADM = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };
const CTX_GERENCIA = { email: 'gerencia@homepymes.cl', nombre: 'Gerencia', rol: 'GERENCIA' };
const PDF_B64 = Buffer.from('%PDF-1.4 descriptor').toString('base64');

// Mock de Almacenamiento (R2): un Map en memoria que se comporta como un
// bucket real -- lo subido es lo que se lee de vuelta. Mismo criterio que
// novedades-sgc-porteo.test.js / calidad-sgc-porteo.test.js.
function conMockAlmacenamiento_(t) {
  const bucket = new Map();
  t.mock.method(Almacenamiento, 'subirArchivo_', async (clave, contenidoBase64, contentType) => {
    bucket.set(clave, { contenidoBase64, contentType });
    return { ok: true, clave, tamano: Buffer.byteLength(contenidoBase64, 'base64') };
  });
  t.mock.method(Almacenamiento, 'descargarArchivo_', async (clave) => {
    const obj = bucket.get(clave);
    if (!obj) return { ok: false, message: 'El archivo no existe.' };
    return { ok: true, contenido_base64: obj.contenidoBase64, content_type: obj.contentType };
  });
}

function sembrar(db) {
  Calidad.gestionarRol(db, { usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'jefa@homepymes.cl', rol_sgc: 'JEFATURA_AREA', area_id: 'PREVENCION' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADM);
  Calidad.gestionarRol(db, { usuario_email: 'pedro@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'CONTABILIDAD' }, CTX_ADM);
  const ana = Personas.guardarPersona(db, { usuario_email: 'ana@homepymes.cl', nombre: 'Ana Perez', rut: '11.111.111-1', cargo: 'Prevencionista', tipo: 'EXT', area_id: 'PREVENCION', jefatura_email: 'jefa@homepymes.cl', fecha_ingreso: '2025-03-01' }, CTX_ENCARGADO);
  const pedro = Personas.guardarPersona(db, { usuario_email: 'pedro@homepymes.cl', nombre: 'Pedro Soto', rut: '22.222.222-2', cargo: 'Analista Contable', tipo: 'INT', area_id: 'CONTABILIDAD', fecha_ingreso: '2024-05-01' }, CTX_ENCARGADO);
  return { ana, pedro };
}
async function descriptorConItems(db, personaId, overrides) {
  return Personas.guardarDescriptor(db, Object.assign({
    persona_id: personaId, version: 'v01', objetivo: 'Objetivo del cargo.',
    items_responsabilidades: ['Cumple plazos', 'Aplica el SGC', 'Reporta desviaciones'],
    items_habilidades: ['Conocimiento técnico', 'Trabajo en equipo']
  }, overrides), CTX_ENCARGADO);
}
function respuestas(valor, n) { return new Array(n).fill(valor); }

// ===== aislamiento de la ficha ==============================================

test('el personal operativo ve UNICAMENTE su propia ficha', () => {
  const db = db_();
  const { ana, pedro } = sembrar(db);
  const listaAna = Personas.listar(db, {}, CTX_ANA);
  assert.equal(listaAna.personas.length, 1);
  assert.equal(listaAna.personas[0].usuario_email, 'ana@homepymes.cl');
  assert.equal(listaAna.puede_gestionar, false);
  assert.equal(Personas.getFicha(db, { persona_id: pedro.persona_id }, CTX_ANA)._forbidden, true);
  assert.ok(Personas.getFicha(db, { persona_id: ana.persona_id }, CTX_ANA).persona);
});

test('la jefatura ve su ficha y la de su equipo, no la de otras areas', () => {
  const db = db_();
  const { ana, pedro } = sembrar(db);
  assert.ok(Personas.getFicha(db, { persona_id: ana.persona_id }, CTX_JEFA).persona);
  assert.equal(Personas.getFicha(db, { persona_id: pedro.persona_id }, CTX_JEFA)._forbidden, true);
});

test('la jerarquia de JEFATURAS tambien da acceso, sin repetir el dato en la ficha', () => {
  const db = db_();
  sembrar(db);
  agregarFila_(db, 'JEFATURAS', { jefatura_id: 'J1', jefe_email: 'jefa@homepymes.cl', subordinado_email: 'pedro@homepymes.cl', activo: true });
  const pedro = filas(db, 'SGC_PERSONAS').find((p) => p.usuario_email === 'pedro@homepymes.cl');
  assert.ok(Personas.getFicha(db, { persona_id: pedro.persona_id }, CTX_JEFA).persona);
});

test('Encargado SGC, ADM, Direccion y Gerencia ven todas las fichas', () => {
  const db = db_();
  sembrar(db);
  assert.equal(Personas.listar(db, {}, CTX_ENCARGADO).personas.length, 2);
  assert.equal(Personas.listar(db, {}, CTX_ADM).personas.length, 2);
  assert.equal(Personas.listar(db, {}, CTX_GERENCIA).personas.length, 2);
});

// ===== alta y baja ===========================================================

test('guardarPersona: exige nombre/correo/tipo; el mismo correo+cargo EXACTO no se puede duplicar', () => {
  const db = db_();
  sembrar(db);
  assert.equal(Personas.guardarPersona(db, { usuario_email: 'x@y.cl', tipo: 'INT' }, CTX_ENCARGADO)._validationError, true);
  assert.equal(Personas.guardarPersona(db, { nombre: 'X', tipo: 'INT' }, CTX_ENCARGADO)._validationError, true);
  assert.equal(Personas.guardarPersona(db, { nombre: 'X', usuario_email: 'x@y.cl', tipo: 'RARO' }, CTX_ENCARGADO)._validationError, true);
  assert.equal(Personas.guardarPersona(db, { nombre: 'Ana Duplicada', usuario_email: 'ana@homepymes.cl', cargo: 'Prevencionista', tipo: 'INT' }, CTX_ENCARGADO)._validationError, true);
});

test('guardarPersona: un duplicado rechazado no bloquea la siguiente creacion', () => {
  const db = db_();
  const { ana } = sembrar(db);
  const rechazado = Personas.guardarPersona(db, { nombre: 'Ana Duplicada', usuario_email: 'ana@homepymes.cl', cargo: 'Prevencionista', tipo: 'INT' }, CTX_ENCARGADO);
  assert.equal(rechazado._validationError, true);
  const nueva = Personas.guardarPersona(db, { nombre: 'Otra Persona', usuario_email: 'otra@homepymes.cl', cargo: 'Analista', tipo: 'INT' }, CTX_ENCARGADO);
  assert.equal(nueva._validationError, undefined);
  assert.notEqual(nueva.persona_id, ana.persona_id);
});

// Bug confirmado por la auditoria de modulos (2026-09): el chequeo de
// correo+cargo duplicado solo corria al CREAR -- editar una ficha para
// dejarla con el mismo correo+cargo de OTRA ficha activa no se validaba.
test('guardarPersona: el correo+cargo tampoco se puede duplicar AL EDITAR (no solo al crear)', () => {
  const db = db_();
  const { ana, pedro } = sembrar(db);

  // Intenta dejar a pedro con el mismo correo+cargo que ana.
  const editado = Personas.guardarPersona(db, {
    persona_id: pedro.persona_id, nombre: pedro.nombre, usuario_email: 'ana@homepymes.cl', cargo: 'Prevencionista', tipo: 'INT'
  }, CTX_ENCARGADO);
  assert.equal(editado._validationError, true, 'editar hacia un correo+cargo ya usado por otra ficha debe rechazarse');

  // Editar la ficha propia SIN chocar (mismo correo+cargo que ya tenia) sigue funcionando.
  const propio = Personas.guardarPersona(db, {
    persona_id: ana.persona_id, nombre: 'Ana Actualizada', usuario_email: 'ana@homepymes.cl', cargo: 'Prevencionista', tipo: 'EXT'
  }, CTX_ENCARGADO);
  assert.equal(propio._validationError, undefined, JSON.stringify(propio));
  assert.equal(propio.nombre, 'Ana Actualizada');
});

test('una persona puede tener DOS fichas (dos cargos) con el MISMO correo, cada una con su propio descriptor', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const { ana } = sembrar(db);
  const anaExterna = Personas.guardarPersona(db, { nombre: 'Ana Perez', usuario_email: 'ana@homepymes.cl', cargo: 'Prevencionista (servicios a clientes)', tipo: 'EXT', area_id: 'PREVENCION' }, CTX_ENCARGADO);
  assert.equal(anaExterna._validationError, undefined);
  assert.notEqual(anaExterna.persona_id, ana.persona_id);
  const propias = Personas.listar(db, {}, CTX_ANA).personas;
  assert.equal(propias.length, 2);

  await Personas.guardarDescriptor(db, { persona_id: ana.persona_id, version: 'v01', objetivo: 'Objetivo del cargo interno.' }, CTX_ENCARGADO);
  await Personas.guardarDescriptor(db, { persona_id: anaExterna.persona_id, version: 'v01', objetivo: 'Objetivo del cargo externo (clientes).' }, CTX_ENCARGADO);
  assert.equal(Personas.getFicha(db, { persona_id: ana.persona_id }, CTX_ENCARGADO).descriptor_vigente.objetivo, 'Objetivo del cargo interno.');
  assert.equal(Personas.getFicha(db, { persona_id: anaExterna.persona_id }, CTX_ENCARGADO).descriptor_vigente.objetivo, 'Objetivo del cargo externo (clientes).');
});

test('guardarPersona: solo el Encargado SGC o ADM; el personal no crea fichas', () => {
  const db = db_();
  sembrar(db);
  assert.equal(Personas.guardarPersona(db, { nombre: 'Intruso', usuario_email: 'intruso@y.cl', tipo: 'INT' }, CTX_ANA)._forbidden, true);
});

test('al crear una persona se siembra su induccion con los 5 items del SGC', () => {
  const db = db_();
  const { ana } = sembrar(db);
  const items = filas(db, 'SGC_INDUCCIONES').filter((i) => i.persona_id === ana.persona_id);
  assert.equal(items.length, 5);
  assert.ok(items.every((i) => i.estado === 'PENDIENTE'));
  assert.ok(items.some((i) => i.item === 'Política de Calidad'));
});

test('desvincular NO borra: sale del listado pero conserva su historial; se puede reactivar', () => {
  const db = db_();
  const { ana } = sembrar(db);
  Personas.desvincular(db, { persona_id: ana.persona_id }, CTX_ENCARGADO);
  assert.equal(Personas.listar(db, {}, CTX_ENCARGADO).personas.length, 1);
  assert.equal(Personas.listar(db, { incluir_desvinculados: true }, CTX_ENCARGADO).personas.length, 2);
  assert.equal(filas(db, 'SGC_PERSONAS').length, 2);
  assert.equal(filas(db, 'SGC_INDUCCIONES').filter((i) => i.persona_id === ana.persona_id).length, 5);
  const reactivada = Personas.desvincular(db, { persona_id: ana.persona_id, reactivar: true }, CTX_ENCARGADO);
  assert.equal(reactivada.estado, 'ACTIVO');
});

test('quitarDelAlcance: NO es lo mismo que desvincular -- no toca estado ni fecha_desvinculacion', () => {
  const db = db_();
  const { ana } = sembrar(db);
  Personas.quitarDelAlcance(db, { persona_id: ana.persona_id }, CTX_ENCARGADO);
  assert.equal(Personas.listar(db, {}, CTX_ENCARGADO).personas.length, 1);
  const fila = filas(db, 'SGC_PERSONAS').find((p) => p.persona_id === ana.persona_id);
  assert.equal(fila.estado, 'ACTIVO');
  assert.equal(fila.fecha_desvinculacion, '');
  assert.equal(fila.activa, false);
});

test('quitarDelAlcance: solo quien gobierna; incluir_fuera_alcance solo lo puede pedir quien gobierna', () => {
  const db = db_();
  const { ana, pedro } = sembrar(db);
  assert.equal(Personas.quitarDelAlcance(db, { persona_id: ana.persona_id }, CTX_ANA)._forbidden, true);
  Personas.quitarDelAlcance(db, { persona_id: ana.persona_id }, CTX_ENCARGADO);
  const reincluida = Personas.quitarDelAlcance(db, { persona_id: ana.persona_id, reactivar: true }, CTX_ENCARGADO);
  assert.equal(reincluida.activa, true);
  assert.equal(Personas.listar(db, {}, CTX_ENCARGADO).personas.length, 2);

  Personas.quitarDelAlcance(db, { persona_id: ana.persona_id }, CTX_ENCARGADO);
  const conFiltro = Personas.listar(db, { incluir_fuera_alcance: true }, CTX_ENCARGADO).personas;
  assert.equal(conFiltro.length, 2);
  assert.equal(conFiltro.find((p) => p.persona_id === ana.persona_id).fuera_de_alcance, true);
  const sinPermiso = Personas.listar(db, { incluir_fuera_alcance: true }, CTX_PEDRO).personas;
  assert.equal(sinPermiso.filter((p) => p.persona_id === ana.persona_id).length, 0);
});

// ===== descriptor de cargo ====================================================

test('descriptor: se versiona -- el anterior deja de ser vigente pero se conserva', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const { ana } = sembrar(db);
  await Personas.guardarDescriptor(db, { persona_id: ana.persona_id, version: 'v01', objetivo: 'Asesorar en prevencion.', funciones: 'Visitas a terreno.', nivel_educacional: 'Tecnico' }, CTX_ENCARGADO);
  await Personas.guardarDescriptor(db, { persona_id: ana.persona_id, version: 'v02', objetivo: 'Asesorar y capacitar en prevencion.', funciones: 'Visitas a terreno y capacitaciones.' }, CTX_ENCARGADO);
  const todos = filas(db, 'SGC_DESCRIPTORES').filter((d) => d.persona_id === ana.persona_id);
  assert.equal(todos.length, 2);
  const vigentes = todos.filter((d) => d.vigente === true || d.vigente === 'TRUE');
  assert.equal(vigentes.length, 1);
  assert.equal(vigentes[0].version, 'v02');
  assert.equal(Personas.getFicha(db, { persona_id: ana.persona_id }, CTX_ENCARGADO).descriptor_vigente.version, 'v02');
});

test('descriptor: exige version y objetivo, y solo lo edita quien gobierna el SGC', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const { ana } = sembrar(db);
  assert.equal((await Personas.guardarDescriptor(db, { persona_id: ana.persona_id, objetivo: 'X' }, CTX_ENCARGADO))._validationError, true);
  assert.equal((await Personas.guardarDescriptor(db, { persona_id: ana.persona_id, version: 'v01' }, CTX_ENCARGADO))._validationError, true);
  assert.equal((await Personas.guardarDescriptor(db, { persona_id: ana.persona_id, version: 'v01', objetivo: 'X' }, CTX_ANA))._forbidden, true);
});

test('el listado avisa quien no tiene descriptor todavia', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const { ana } = sembrar(db);
  await Personas.guardarDescriptor(db, { persona_id: ana.persona_id, version: 'v01', objetivo: 'X' }, CTX_ENCARGADO);
  const lista = Personas.listar(db, {}, CTX_ENCARGADO).personas;
  const fAna = lista.find((p) => p.usuario_email === 'ana@homepymes.cl');
  const fPedro = lista.find((p) => p.usuario_email === 'pedro@homepymes.cl');
  assert.equal(fAna.tiene_descriptor, true);
  assert.equal(fAna.descriptor_version, 'v01');
  assert.equal(fPedro.tiene_descriptor, false);
});

test('actualizarDescriptor: corrige la version vigente SIN versionar (misma fila)', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const { ana } = sembrar(db);
  const v01 = await Personas.guardarDescriptor(db, { persona_id: ana.persona_id, version: 'v01', objetivo: 'Asesorar en prevencion de riesgos.', items_responsabilidades: ['Cumple plazos'] }, CTX_ENCARGADO);
  await Personas.actualizarDescriptor(db, { persona_id: ana.persona_id, descriptor_id: v01.descriptor_id, objetivo: 'Asesorar en prevención de riesgos laborales (corregido).', items_responsabilidades: ['Cumple plazos'] }, CTX_ENCARGADO);
  const todos = filas(db, 'SGC_DESCRIPTORES').filter((d) => d.persona_id === ana.persona_id);
  assert.equal(todos.length, 1, 'editar NO crea una fila nueva');
  assert.equal(todos[0].version, 'v01', 'la version no se toca al editar');
  assert.equal(todos[0].objetivo, 'Asesorar en prevención de riesgos laborales (corregido).');
  assert.equal(Personas.getFicha(db, { persona_id: ana.persona_id }, CTX_ENCARGADO).descriptor_vigente.objetivo, 'Asesorar en prevención de riesgos laborales (corregido).');
});

test('actualizarDescriptor: exige objetivo, solo gobierna lo edita, y no toca un descriptor ya archivado', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const { ana } = sembrar(db);
  const v01 = await Personas.guardarDescriptor(db, { persona_id: ana.persona_id, version: 'v01', objetivo: 'X' }, CTX_ENCARGADO);
  assert.equal((await Personas.actualizarDescriptor(db, { persona_id: ana.persona_id, descriptor_id: v01.descriptor_id, objetivo: '' }, CTX_ENCARGADO))._validationError, true);
  assert.equal((await Personas.actualizarDescriptor(db, { persona_id: ana.persona_id, descriptor_id: v01.descriptor_id, objetivo: 'Y' }, CTX_ANA))._forbidden, true, 'el propio trabajador no edita su descriptor');
  // Se archiva v01 al crear v02 -- ahora v01 ya no es la vigente.
  await Personas.guardarDescriptor(db, { persona_id: ana.persona_id, version: 'v02', objetivo: 'Z' }, CTX_ENCARGADO);
  assert.equal((await Personas.actualizarDescriptor(db, { persona_id: ana.persona_id, descriptor_id: v01.descriptor_id, objetivo: 'Y' }, CTX_ENCARGADO))._validationError, true, 'no se puede editar una version ya archivada');
});

test('actualizarDescriptor: si llega un archivo nuevo, reemplaza el de la MISMA fila', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const { ana } = sembrar(db);
  const v01 = await Personas.guardarDescriptor(db, { persona_id: ana.persona_id, version: 'v01', objetivo: 'X', nombre_archivo: 'original.pdf', contenido_base64: PDF_B64 }, CTX_ENCARGADO);
  await Personas.actualizarDescriptor(db, { persona_id: ana.persona_id, descriptor_id: v01.descriptor_id, objetivo: 'X', nombre_archivo: 'corregido.pdf', contenido_base64: PDF_B64 }, CTX_ENCARGADO);
  const todos = filas(db, 'SGC_DESCRIPTORES').filter((d) => d.persona_id === ana.persona_id);
  assert.equal(todos.length, 1);
  assert.equal(todos[0].archivo_nombre, 'corregido.pdf');
});

test('descargarDescriptor: mismo permiso que ver la ficha, y exige que haya archivo', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const { ana, pedro } = sembrar(db);
  const v01 = await Personas.guardarDescriptor(db, { persona_id: ana.persona_id, version: 'v01', objetivo: 'X', nombre_archivo: 'descriptor.pdf', contenido_base64: PDF_B64 }, CTX_ENCARGADO);

  const propio = await Personas.descargarDescriptor(db, { persona_id: ana.persona_id, descriptor_id: v01.descriptor_id }, CTX_ANA);
  assert.ok(propio.contenido_base64, 'Ana puede bajar el suyo');
  assert.equal(Buffer.from(propio.contenido_base64, 'base64').toString(), '%PDF-1.4 descriptor');

  assert.equal((await Personas.descargarDescriptor(db, { persona_id: ana.persona_id, descriptor_id: v01.descriptor_id }, CTX_PEDRO))._forbidden, true, 'Pedro no ve la ficha de Ana');

  const sinArchivo = await Personas.guardarDescriptor(db, { persona_id: pedro.persona_id, version: 'v01', objetivo: 'X' }, CTX_ENCARGADO);
  assert.equal((await Personas.descargarDescriptor(db, { persona_id: pedro.persona_id, descriptor_id: sinArchivo.descriptor_id }, CTX_PEDRO))._validationError, true, 'sin archivo adjunto, no hay que descargar');
});

// ===== documentos del personal ================================================

test('documentos del personal: se cargan validados y solo los ve quien ve la ficha', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const { ana } = sembrar(db);

  const doc = await Personas.guardarDocumento(db, { persona_id: ana.persona_id, tipo: 'CV', nombre: 'CV Ana', nombre_archivo: 'cv.pdf', contenido_base64: PDF_B64 }, CTX_ENCARGADO);
  assert.ok(doc.archivo_id);

  assert.equal((await Personas.guardarDocumento(db, { persona_id: ana.persona_id, tipo: 'INVENTADO', nombre_archivo: 'x.pdf', contenido_base64: PDF_B64 }, CTX_ENCARGADO))._validationError, true);

  // Pedro no ve la ficha de Ana -> tampoco puede bajar su CV.
  assert.equal((await Personas.descargarDocumento(db, { persona_id: ana.persona_id, doc_id: doc.doc_id }, CTX_PEDRO))._forbidden, true);

  // Ana si puede bajar el suyo.
  const propio = await Personas.descargarDocumento(db, { persona_id: ana.persona_id, doc_id: doc.doc_id }, CTX_ANA);
  assert.ok(propio.contenido_base64);
  assert.equal(Buffer.from(propio.contenido_base64, 'base64').toString(), '%PDF-1.4 descriptor');
});

test('guardarDocumento: valida el permiso ANTES que el tipo/archivo', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const { ana } = sembrar(db);
  assert.equal((await Personas.guardarDocumento(db, { persona_id: ana.persona_id, tipo: 'CV', nombre_archivo: 'cv.pdf', contenido_base64: PDF_B64 }, CTX_ANA))._forbidden, true, 'la guardia de permiso corre antes que la de archivo');
});

// ===== induccion ==============================================================

test('induccion: la completa el Encargado SGC o la jefatura directa, no el propio trabajador', () => {
  const db = db_();
  const { ana } = sembrar(db);
  const item = filas(db, 'SGC_INDUCCIONES').find((i) => i.persona_id === ana.persona_id);
  assert.equal(Personas.registrarInduccion(db, { persona_id: ana.persona_id, induccion_id: item.induccion_id, estado: 'COMPLETADA' }, CTX_ANA)._forbidden, true);
  const porJefa = Personas.registrarInduccion(db, { persona_id: ana.persona_id, induccion_id: item.induccion_id, estado: 'COMPLETADA', fecha: '2025-03-05' }, CTX_JEFA);
  assert.equal(porJefa.estado, 'COMPLETADA');
  assert.equal(porJefa.relator_email, 'jefa@homepymes.cl');
  const lista = Personas.listar(db, {}, CTX_ENCARGADO).personas.find((p) => p.usuario_email === 'ana@homepymes.cl');
  assert.equal(lista.induccion_completadas, 1);
  assert.equal(lista.induccion_total, 5);
});

// ===== monitoreo de competencias =============================================

test('no se puede evaluar sin un descriptor de cargo con items cargados', () => {
  const db = db_();
  const { ana } = sembrar(db);
  const r = Personas.registrarEvaluacion(db, { persona_id: ana.persona_id }, CTX_JEFA);
  assert.equal(r._validationError, true);
  assert.match(r.message, /descriptor/i);
});

test('evaluacion: los promedios se derivan de los puntajes del descriptor; agenda proxima a 12 meses', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const { ana } = sembrar(db);
  await descriptorConItems(db, ana.persona_id);
  const e = Personas.registrarEvaluacion(db, { persona_id: ana.persona_id, respuestas_responsabilidades: respuestas(4, 3), respuestas_habilidades: respuestas(4, 2) }, CTX_JEFA);
  assert.equal(e.promedio_responsabilidades, 4);
  assert.equal(e.promedio_habilidades, 4);
  assert.equal(e.requiere_capacitacion, false);
  assert.equal(new Date(e.proxima_evaluacion).getFullYear() - new Date(e.fecha).getFullYear(), 1);
});

test('evaluacion: promedio bajo 3 en CUALQUIERA de los dos bloques marca necesidad de capacitacion y avisa al Encargado', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const { ana } = sembrar(db);
  await descriptorConItems(db, ana.persona_id);
  const mixta = Personas.registrarEvaluacion(db, { persona_id: ana.persona_id, respuestas_responsabilidades: respuestas(4, 3), respuestas_habilidades: respuestas(2, 2) }, CTX_JEFA);
  assert.equal(mixta.promedio_responsabilidades, 4);
  assert.equal(mixta.promedio_habilidades, 2);
  assert.equal(mixta.requiere_capacitacion, true);
  const notifs = filas(db, 'NOTIFICACIONES_APP').filter((n) => n.tipo === 'SGC_COMPETENCIA' && n.destinatario_email === 'sgc@homepymes.cl');
  assert.ok(notifs.length >= 1);
});

test('evaluacion: exige calificar TODOS los items del descriptor, entre 1 y 4', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const { ana } = sembrar(db);
  await descriptorConItems(db, ana.persona_id);
  assert.equal(Personas.registrarEvaluacion(db, { persona_id: ana.persona_id, respuestas_responsabilidades: respuestas(3, 3) }, CTX_JEFA)._validationError, true);
  assert.equal(Personas.registrarEvaluacion(db, { persona_id: ana.persona_id, respuestas_responsabilidades: respuestas(5, 3), respuestas_habilidades: respuestas(3, 2) }, CTX_JEFA)._validationError, true);
  assert.equal(Personas.registrarEvaluacion(db, { persona_id: ana.persona_id, respuestas_responsabilidades: respuestas(0, 3), respuestas_habilidades: respuestas(3, 2) }, CTX_JEFA)._validationError, true);
});

test('evaluacion: la hace la jefatura directa o el Encargado SGC, y nadie se evalua a si mismo', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const { ana, pedro } = sembrar(db);
  await descriptorConItems(db, ana.persona_id);
  await descriptorConItems(db, pedro.persona_id);
  const datosAna = { persona_id: ana.persona_id, respuestas_responsabilidades: respuestas(3, 3), respuestas_habilidades: respuestas(3, 2) };
  const datosPedro = { persona_id: pedro.persona_id, respuestas_responsabilidades: respuestas(3, 3), respuestas_habilidades: respuestas(3, 2) };
  assert.equal(Personas.registrarEvaluacion(db, datosAna, CTX_PEDRO)._forbidden, true);
  assert.equal(Personas.registrarEvaluacion(db, datosAna, CTX_ANA)._forbidden, true);
  assert.ok(Personas.registrarEvaluacion(db, datosAna, CTX_JEFA).evaluacion_id);
  assert.ok(Personas.registrarEvaluacion(db, datosPedro, CTX_ENCARGADO).evaluacion_id);
});

test('la ficha trae el historial de evaluaciones y marca si esta vencida', async (t) => {
  const db = db_();
  conMockAlmacenamiento_(t);
  const { ana } = sembrar(db);
  await descriptorConItems(db, ana.persona_id);
  Personas.registrarEvaluacion(db, { persona_id: ana.persona_id, fecha: '2020-01-01T00:00:00.000Z', respuestas_responsabilidades: respuestas(3, 3), respuestas_habilidades: respuestas(3, 2) }, CTX_JEFA);
  const ficha = Personas.getFicha(db, { persona_id: ana.persona_id }, CTX_ENCARGADO);
  assert.equal(ficha.evaluaciones.length, 1);
  assert.equal(ficha.evaluacion_vencida, true);
  assert.equal(ficha.escala_evaluacion.length, 4);
  assert.equal(ficha.items_responsabilidades.length, 3);
  assert.equal(ficha.evaluaciones[0].respuestas_responsabilidades[0].item, 'Cumple plazos');
});

// ===== capacitaciones ==========================================================

test('capacitacion: se programa, se realiza con asistentes, y suma horas solo a quien asistio', () => {
  const db = db_();
  const { ana, pedro } = sembrar(db);
  const cap = Personas.guardarCapacitacion(db, { nombre: 'Interpretacion ISO 9001', horas: 8, fecha_programada: '2026-04-10', relator: 'Consultora X' }, CTX_ENCARGADO);
  assert.equal(cap.estado, 'PROGRAMADA');
  Personas.registrarRealizacion(db, { capacitacion_id: cap.capacitacion_id, fecha_realizada: new Date().toISOString(), asistentes: [ana.persona_id] }, CTX_ENCARGADO);
  const r = Personas.listarCapacitaciones(db, {}, CTX_ENCARGADO);
  const horas = {};
  r.horas_por_persona.forEach((h) => { horas[h.persona_id] = h; });
  assert.equal(horas[ana.persona_id].horas, 8);
  assert.equal(horas[ana.persona_id].cumple_meta, true);
  assert.equal(horas[pedro.persona_id].horas, 0);
  assert.equal(horas[pedro.persona_id].cumple_meta, false);
});

test('capacitacion: exige nombre y horas positivas; solo la gestiona el Encargado SGC', () => {
  const db = db_();
  sembrar(db);
  assert.equal(Personas.guardarCapacitacion(db, { horas: 4 }, CTX_ENCARGADO)._validationError, true);
  assert.equal(Personas.guardarCapacitacion(db, { nombre: 'X', horas: 0 }, CTX_ENCARGADO)._validationError, true);
  assert.equal(Personas.guardarCapacitacion(db, { nombre: 'X', horas: 4 }, CTX_ANA)._forbidden, true);
});

test('listarCapacitaciones: es de quien gobierna/ve todo; el operativo debe ver su formacion en su ficha, no aca', () => {
  const db = db_();
  sembrar(db);
  assert.equal(Personas.listarCapacitaciones(db, {}, CTX_ANA)._forbidden, true);
});

test('eficacia: es POR PARTICIPANTE, no por curso -- dos personas pueden tener resultado distinto', () => {
  const db = db_();
  const { ana, pedro } = sembrar(db);
  const cap = Personas.guardarCapacitacion(db, { nombre: 'Curso', horas: 4 }, CTX_ENCARGADO);
  assert.equal(Personas.registrarEficaciaAsistente(db, { capacitacion_id: cap.capacitacion_id, persona_id: ana.persona_id, resultado: 'EFICAZ' }, CTX_ENCARGADO)._validationError, true);
  Personas.registrarRealizacion(db, { capacitacion_id: cap.capacitacion_id, asistentes: [ana.persona_id, pedro.persona_id] }, CTX_ENCARGADO);
  assert.equal(Personas.registrarEficaciaAsistente(db, { capacitacion_id: cap.capacitacion_id, persona_id: ana.persona_id, resultado: 'NO_EFICAZ' }, CTX_ENCARGADO)._validationError, true);
  const okAna = Personas.registrarEficaciaAsistente(db, { capacitacion_id: cap.capacitacion_id, persona_id: ana.persona_id, resultado: 'EFICAZ' }, CTX_ENCARGADO);
  assert.equal(okAna.eficacia_resultado, 'EFICAZ');
  const okPedro = Personas.registrarEficaciaAsistente(db, { capacitacion_id: cap.capacitacion_id, persona_id: pedro.persona_id, resultado: 'NO_EFICAZ', observaciones: 'No aplicó lo aprendido.' }, CTX_ENCARGADO);
  assert.equal(okPedro.eficacia_resultado, 'NO_EFICAZ');
});

test('eficacia: no se puede evaluar a quien no asistio', () => {
  const db = db_();
  const { ana, pedro } = sembrar(db);
  const cap = Personas.guardarCapacitacion(db, { nombre: 'Curso', horas: 4 }, CTX_ENCARGADO);
  Personas.registrarRealizacion(db, { capacitacion_id: cap.capacitacion_id, asistentes: [ana.persona_id] }, CTX_ENCARGADO);
  assert.equal(Personas.registrarEficaciaAsistente(db, { capacitacion_id: cap.capacitacion_id, persona_id: pedro.persona_id, resultado: 'EFICAZ' }, CTX_ENCARGADO)._validationError, true);
});

test('eficacia pendiente: se marca sola a los 60 dias de realizada, por participante', () => {
  const db = db_();
  const { ana, pedro } = sembrar(db);
  const cap = Personas.guardarCapacitacion(db, { nombre: 'Curso viejo', horas: 4 }, CTX_ENCARGADO);
  const hace70dias = new Date(Date.now() - 70 * 86400000).toISOString();
  Personas.registrarRealizacion(db, { capacitacion_id: cap.capacitacion_id, fecha_realizada: hace70dias, asistentes: [ana.persona_id, pedro.persona_id] }, CTX_ENCARGADO);
  Personas.registrarEficaciaAsistente(db, { capacitacion_id: cap.capacitacion_id, persona_id: ana.persona_id, resultado: 'EFICAZ' }, CTX_ENCARGADO);
  const fila = Personas.listarCapacitaciones(db, {}, CTX_ENCARGADO).capacitaciones[0];
  assert.equal(fila.eficacia_pendiente, true);
  assert.equal(fila.asistentes.find((a) => a.persona_id === ana.persona_id).eficacia_pendiente, false);
  assert.equal(fila.asistentes.find((a) => a.persona_id === pedro.persona_id).eficacia_pendiente, true);
});

// ===== avisos automaticos =====================================================

function conMockCorreo(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  const mock = t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'x' }));
  t.after(() => { delete process.env.RESEND_API_KEY; });
  return mock;
}

test('aviso: quien nunca fue evaluado aparece como pendiente; no se repite en la misma ventana', async (t) => {
  const mock = conMockCorreo(t);
  const db = db_();
  sembrar(db);
  const r = await Personas.recordatorioCompetencias(db);
  assert.ok(r.evaluaciones >= 1);
  assert.ok(mock.mock.calls.some((c) => c.arguments[0].to[0] === 'sgc@homepymes.cl'));

  mock.mock.resetCalls();
  await Personas.recordatorioCompetencias(db);
  assert.equal(mock.mock.callCount(), 0, 'forzar la pasada de nuevo no debe reenviar');
});

test('aviso: una persona recien evaluada deja de aparecer', async (t) => {
  conMockCorreo(t);
  conMockAlmacenamiento_(t);
  const db = db_();
  const { ana, pedro } = sembrar(db);
  await descriptorConItems(db, ana.persona_id);
  await descriptorConItems(db, pedro.persona_id);
  const datos = { respuestas_responsabilidades: respuestas(4, 3), respuestas_habilidades: respuestas(4, 2) };
  Personas.registrarEvaluacion(db, Object.assign({ persona_id: ana.persona_id }, datos), CTX_JEFA);
  Personas.registrarEvaluacion(db, Object.assign({ persona_id: pedro.persona_id }, datos), CTX_ENCARGADO);
  const r = await Personas.recordatorioCompetencias(db);
  assert.equal(r.evaluaciones, 0);
});

test('aviso: horas bajo la meta llegan al Encargado SGC (Objetivo 4)', async (t) => {
  const mock = conMockCorreo(t);
  const db = db_();
  sembrar(db);
  await Personas.recordatorioCompetencias(db);
  assert.ok(mock.mock.calls.some((c) => c.arguments[0].to[0] === 'sgc@homepymes.cl'));
});
