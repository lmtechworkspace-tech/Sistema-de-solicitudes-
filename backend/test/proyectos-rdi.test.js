'use strict';

/**
 * Fase H item 3 (Camino B, 2026-09-23): RDI (Requerimiento de Información)
 * modelado como TIPO dentro de Solicitudes (Proyectos.crearRdi/listarRdi).
 * Ver documentacion/SIGSO-Proyectos-2.0-auditoria-y-propuesta.md §13/§16/§18.
 *
 * Lo que estos tests protegen, por orden de importancia:
 *  1. Un RDI ES una Solicitud real (SOLICITUDES + SUBSOLICITUDES +
 *     HISTORIAL_ESTADOS), no una tabla paralela -- así hereda triage/SLA/
 *     notificaciones/PDF gratis.
 *  2. Cualquier INTEGRANTE puede levantar un RDI (es una pregunta, no una
 *     decisión de gestión) -- distinto del gateo de avance físico/financiero.
 *  3. listarRdi filtra por proyecto_id Y tipo='RDI': un RDI de otro proyecto,
 *     o una solicitud no-RDI del mismo proyecto, nunca se mezclan.
 *  4. El catálogo CAT_TIPOS['RDI'] se autocrea la primera vez (sin paso de
 *     instalación manual).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Proyectos = require('../logica/proyectos');
const Solicitudes = require('../logica/solicitudes');

const CTX_LEO = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV', empresa_id: 'RLD' };
const CTX_MARCELO = { email: 'marcelo@rld.cl', nombre: 'Marcelo Integrante', rol: 'DEV', empresa_id: 'RLD' };
const CTX_OTRO = { email: 'otro@rld.cl', nombre: 'Otro Ajeno', rol: 'DEV', empresa_id: 'RLD' };

function db_() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  sembrarTabla_(db, 'CONFIG_SLA', COLUMNAS.CONFIG_SLA, [
    ['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']
  ]);
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

function crearProyectoBase(db, over) {
  return Proyectos.crear(db, Object.assign({ nombre: 'Migración ERP', fecha_inicio: '2026-08-01', fecha_objetivo: '2026-10-01' }, over), CTX_LEO);
}
function armarProyectoConMarcelo(db) {
  const proyecto = crearProyectoBase(db);
  Proyectos.gestionarIntegrante(db, { proyecto_id: proyecto.proyecto_id, usuario_email: 'marcelo@rld.cl', rol_proyecto: 'INTEGRANTE' }, CTX_LEO);
  return proyecto;
}

// --- crear -----------------------------------------------------------------

test('crearRdi: el líder levanta un RDI -- es una Solicitud real', async () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const r = await Proyectos.crearRdi(db, {
    proyecto_id: proyecto.proyecto_id, titulo: 'Definir alcance del módulo de reportes',
    descripcion: '¿La fase 2 incluye exportar a Excel o solo PDF?'
  }, CTX_LEO);
  assert.ok(r.solicitud_id);
  assert.equal(r.estado, 'S01');

  const solicitudes = filas(db, 'SOLICITUDES');
  const subsolicitudes = filas(db, 'SUBSOLICITUDES');
  assert.equal(solicitudes.length, 1);
  assert.equal(solicitudes[0].proyecto_id, proyecto.proyecto_id);
  assert.equal(solicitudes[0].tipo, 'RDI');
  assert.equal(solicitudes[0].solicitante_email, 'leo@rld.cl');
  assert.equal(subsolicitudes.length, 1);
  assert.equal(subsolicitudes[0].titulo, 'Definir alcance del módulo de reportes');
  assert.equal(subsolicitudes[0].tipo, 'RDI');
  assert.equal(filas(db, 'HISTORIAL_ESTADOS').length, 1, 'hereda el historial de Solicitudes gratis');
});

test('crearRdi: un integrante SIN rol de líder también puede levantar un RDI (es una pregunta, no gestión)', async () => {
  const db = db_();
  const proyecto = armarProyectoConMarcelo(db);
  const r = await Proyectos.crearRdi(db, {
    proyecto_id: proyecto.proyecto_id, titulo: 'Duda de especificación', descripcion: '¿Qué formato de fecha usa el cliente?'
  }, CTX_MARCELO);
  assert.ok(r.solicitud_id);
});

test('crearRdi: un ajeno al proyecto no puede levantar un RDI', async () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const r = await Proyectos.crearRdi(db, { proyecto_id: proyecto.proyecto_id, titulo: 'X', descripcion: 'Y' }, CTX_OTRO);
  assert.equal(r._forbidden, true);
  assert.equal(filas(db, 'SOLICITUDES').length, 0);
});

test('crearRdi: título y descripción son obligatorios', async () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const sinTitulo = await Proyectos.crearRdi(db, { proyecto_id: proyecto.proyecto_id, descripcion: 'Y' }, CTX_LEO);
  assert.equal(sinTitulo._validationError, true);
  const sinDescripcion = await Proyectos.crearRdi(db, { proyecto_id: proyecto.proyecto_id, titulo: 'X' }, CTX_LEO);
  assert.equal(sinDescripcion._validationError, true);
  assert.equal(filas(db, 'SOLICITUDES').length, 0);
});

test('crearRdi: proyecto_id inexistente devuelve error de validación', async () => {
  const db = db_();
  const r = await Proyectos.crearRdi(db, { proyecto_id: 'no-existe', titulo: 'X', descripcion: 'Y' }, CTX_LEO);
  assert.equal(r._validationError, true);
});

test('crearRdi: una cuenta sin empresa_id recibe un error claro (no el genérico de Solicitudes)', async () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const ctxSinEmpresa = { email: 'leo@rld.cl', nombre: 'Leo Lider', rol: 'DEV', empresa_id: '' };
  const r = await Proyectos.crearRdi(db, { proyecto_id: proyecto.proyecto_id, titulo: 'X', descripcion: 'Y' }, ctxSinEmpresa);
  assert.equal(r._validationError, true);
  assert.match(r.message, /empresa/i);
  assert.equal(filas(db, 'SOLICITUDES').length, 0);
});

test('crearRdi: el catálogo CAT_TIPOS["RDI"] se autocrea una sola vez', async () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  await Proyectos.crearRdi(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Uno', descripcion: 'Uno' }, CTX_LEO);
  await Proyectos.crearRdi(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Dos', descripcion: 'Dos' }, CTX_LEO);
  const tipos = filas(db, 'CAT_TIPOS').filter((t) => t.tipo_id === 'RDI');
  assert.equal(tipos.length, 1, 'no duplica el catálogo en el segundo RDI');
});

test('crearRdi: sin datos en el Directorio, usa el correo y un cargo genérico (degradación elegante)', async () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  const r = await Proyectos.crearRdi(db, { proyecto_id: proyecto.proyecto_id, titulo: 'X', descripcion: 'Y' }, CTX_LEO);
  assert.ok(r.solicitud_id, 'no bloquea la creación aunque leo@rld.cl no esté en DIRECTORIO_PERSONAS');
  const solicitud = filas(db, 'SOLICITUDES')[0];
  assert.equal(solicitud.solicitante_nombre, 'leo@rld.cl');
  assert.equal(solicitud.solicitante_cargo, 'Integrante del proyecto');
});

// --- listar / seguridad cruzada ---------------------------------------------

test('listarRdi: cualquier integrante ve los RDI del proyecto; un ajeno no', async () => {
  const db = db_();
  const proyecto = armarProyectoConMarcelo(db);
  await Proyectos.crearRdi(db, { proyecto_id: proyecto.proyecto_id, titulo: 'X', descripcion: 'Y' }, CTX_LEO);

  const paraMarcelo = Proyectos.listarRdi(db, { proyecto_id: proyecto.proyecto_id }, CTX_MARCELO);
  assert.equal(paraMarcelo.rdis.length, 1);
  assert.equal(paraMarcelo.rdis[0].titulo, 'X');

  const paraAjeno = Proyectos.listarRdi(db, { proyecto_id: proyecto.proyecto_id }, CTX_OTRO);
  assert.equal(paraAjeno._forbidden, true);
});

test('SEGURIDAD: un RDI de OTRO proyecto no aparece al listar', async () => {
  const db = db_();
  const proyectoA = crearProyectoBase(db, { nombre: 'Proyecto A' });
  const proyectoB = crearProyectoBase(db, { nombre: 'Proyecto B' });
  await Proyectos.crearRdi(db, { proyecto_id: proyectoA.proyecto_id, titulo: 'RDI de A', descripcion: 'Y' }, CTX_LEO);
  await Proyectos.crearRdi(db, { proyecto_id: proyectoB.proyecto_id, titulo: 'RDI de B', descripcion: 'Y' }, CTX_LEO);

  const listaA = Proyectos.listarRdi(db, { proyecto_id: proyectoA.proyecto_id }, CTX_LEO);
  assert.equal(listaA.rdis.length, 1);
  assert.equal(listaA.rdis[0].titulo, 'RDI de A');

  const listaB = Proyectos.listarRdi(db, { proyecto_id: proyectoB.proyecto_id }, CTX_LEO);
  assert.equal(listaB.rdis.length, 1);
  assert.equal(listaB.rdis[0].titulo, 'RDI de B');
});

test('listarRdi: una Solicitud NO-RDI vinculada a otro flujo no se cuela en la lista', async () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  await Proyectos.crearRdi(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Es un RDI', descripcion: 'Y' }, CTX_LEO);
  // Una solicitud comun (no RDI) que por algun motivo quedo con el mismo
  // proyecto_id (ej. la solicitud ORIGEN que se convirtio en este proyecto)
  // no debe aparecer como si fuera un RDI.
  await Solicitudes.crearSolicitud(db, {
    empresa_id: 'RLD', plataforma: 'ERP', solicitante_nombre: 'Juan', solicitante_cargo: 'Jefe',
    solicitante_email: 'juan@rld.cl', proyecto_id: proyecto.proyecto_id,
    subsolicitudes: [{ titulo: 'No es un RDI', descripcion: 'Otra cosa', modulo: 'Facturacion', tipo: 'ERR' }]
  });

  const lista = Proyectos.listarRdi(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.equal(lista.rdis.length, 1);
  assert.equal(lista.rdis[0].titulo, 'Es un RDI');
});

test('listarRdi: orden más reciente primero', async () => {
  const db = db_();
  const proyecto = crearProyectoBase(db);
  await Proyectos.crearRdi(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Primero', descripcion: 'Y' }, CTX_LEO);
  await Proyectos.crearRdi(db, { proyecto_id: proyecto.proyecto_id, titulo: 'Segundo', descripcion: 'Y' }, CTX_LEO);
  const lista = Proyectos.listarRdi(db, { proyecto_id: proyecto.proyecto_id }, CTX_LEO);
  assert.deepEqual(lista.rdis.map((r) => r.titulo), ['Segundo', 'Primero']);
});
