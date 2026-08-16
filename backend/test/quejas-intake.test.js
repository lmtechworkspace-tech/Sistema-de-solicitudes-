'use strict';

// v10.0 Fase 4 (documentacion/SIGSO-v10.0-propuesta-modulo-sgc-iso9001.md):
// formulario publico de quejas, felicitaciones y consultas (PRO-07, Parte 1
// del FO-PRO-07-01). Lo que un visitante del sitio -- sin cuenta -- llena.
//
// Lo que protegen estos tests, en orden de importancia:
//  1. Que se pueda registrar SIN CUENTA (transporte identico a
//     crearSolicitud): esa es la razon de ser de la fase.
//  2. Que el correlativo, la confirmacion al remitente y el aviso interno
//     salgan solos -- es lo que elimina la transcripcion manual que
//     PRO-07 §6.1 hoy exige.
//  3. Validaciones minimas (nombre, email, tipo, area, descripcion).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadIntakeProject, seedSheet } = require('./helpers/gasSandbox');

function loadIntakeConSchema() {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SGC_QUEJAS', ctx.COLUMNAS.SGC_QUEJAS);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  return ctx;
}

function datosValidos(overrides) {
  return Object.assign({
    nombre_completo: 'Juan Pérez',
    empresa: 'Constructora ABC',
    rut: '12.345.678-9',
    email: 'juan.perez@abc.cl',
    telefono: '+56912345678',
    tipo: 'QUEJA',
    area: 'CONTABILIDAD',
    descripcion: 'El informe de renta llegó con más de una semana de atraso respecto a lo comprometido.',
    canal: 'WEB'
  }, overrides);
}

test('se registra sin cuenta, con correlativo Q-<año>-NNN', () => {
  const ctx = loadIntakeConSchema();
  const r = ctx.Quejas.crear(datosValidos());
  assert.ok(r.queja_id);
  assert.match(r.correlativo, /^Q-\d{4}-001$/);

  const fila = ctx.leerFilas_('SGC_QUEJAS')[0];
  assert.equal(fila.estado, 'RECIBIDA');
  assert.equal(fila.tipo, 'QUEJA');
  assert.equal(fila.area, 'CONTABILIDAD');
  assert.equal(fila.canal, 'WEB');
  assert.ok(fila.fecha_envio);
  // Las partes 2-5 (internas) empiezan vacias: las llena el Backoffice.
  assert.equal(fila.investigador_email, '');
  assert.equal(fila.estado, 'RECIBIDA');
});

test('el correlativo es correlativo POR AÑO, como el resto del SGC', () => {
  const ctx = loadIntakeConSchema();
  ctx.Quejas.crear(datosValidos());
  const segunda = ctx.Quejas.crear(datosValidos({ nombre_completo: 'Otra persona' }));
  assert.equal(segunda.correlativo, 'Q-' + new Date().getFullYear() + '-002');
});

test('el canal por defecto es WEB si no se indica uno valido', () => {
  const ctx = loadIntakeConSchema();
  ctx.Quejas.crear(datosValidos({ canal: undefined }));
  assert.equal(ctx.leerFilas_('SGC_QUEJAS')[0].canal, 'WEB');
});

test('exige nombre, email valido, tipo, area y descripcion con contenido real', () => {
  const ctx = loadIntakeConSchema();
  assert.equal(ctx.Quejas.crear(datosValidos({ nombre_completo: '  ' }))._validationError, true);
  assert.equal(ctx.Quejas.crear(datosValidos({ email: 'no-es-un-correo' }))._validationError, true);
  assert.equal(ctx.Quejas.crear(datosValidos({ tipo: 'INVENTADO' }))._validationError, true);
  assert.equal(ctx.Quejas.crear(datosValidos({ area: 'INVENTADA' }))._validationError, true);
  assert.equal(ctx.Quejas.crear(datosValidos({ descripcion: 'Muy corto' }))._validationError, true);
  assert.equal(ctx.leerFilas_('SGC_QUEJAS').length, 0, 'ningun intento invalido debe escribir fila');
});

test('la respuesta al remitente solo trae lo que le corresponde ver', () => {
  const ctx = loadIntakeConSchema();
  const r = ctx.Quejas.crear(datosValidos());
  assert.deepEqual(Object.keys(r).sort(), ['correlativo', 'fecha_envio', 'queja_id', 'tipo'].sort());
});

test('se envia confirmacion al remitente y aviso interno a la casilla del SGC', () => {
  const ctx = loadIntakeConSchema();
  ctx.Quejas.crear(datosValidos());
  const destinos = ctx.leerFilas_('LOG_NOTIFICACIONES').map((n) => n.destinatario);
  assert.ok(destinos.includes('juan.perez@abc.cl'), 'confirmacion al remitente');
  assert.ok(destinos.includes('homepymes.control@gmail.com'), 'aviso a la casilla del SGC');
});

test('los cuatro tipos y las seis areas del formulario real son validos', () => {
  const ctx = loadIntakeConSchema();
  ['QUEJA', 'RECLAMACION', 'FELICITACION', 'CONSULTA'].forEach((tipo) => {
    assert.ok(ctx.Quejas.crear(datosValidos({ tipo: tipo })).queja_id);
  });
  ['RRHH', 'CONTABILIDAD', 'PREVENCION', 'MARKETING', 'ADMINISTRACION', 'OTRO'].forEach((area) => {
    assert.ok(ctx.Quejas.crear(datosValidos({ area: area })).queja_id);
  });
});
