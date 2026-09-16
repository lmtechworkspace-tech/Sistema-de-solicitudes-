'use strict';

/**
 * Prueba de portabilidad: la parte de backend/test/atencion-directa.test.js
 * que pertenece a la CREACION (crearSolicitud con atencion_directa). No se
 * porta la seccion "cerrar_directo" (Solicitudes.validarCierre): es una
 * accion distinta sobre una solicitud YA existente, todavia no portada.
 *
 * El test "el acuse dice que queda cerrada" se adapta: el .gs lo verificaba
 * contra un mock de GmailApp; aqui se lee directo de LOG_NOTIFICACIONES
 * (columnas asunto/cuerpo, ver notificaciones.js) ya que el envio real
 * todavia no existe.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Solicitudes = require('../logica/solicitudes');

function dbConSchema() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  sembrarTabla_(db, 'CONFIG_SLA', COLUMNAS.CONFIG_SLA, [
    ['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']
  ]);
  return db;
}

function filas(db, hoja) {
  return leerFilas_(db, hoja, COLUMNAS[hoja]);
}

const ATENCION_OK = {
  resuelto_por: 'Leo',
  fecha_resolucion: '2026-01-15T10:30',
  detalle: 'Se reinicio el servicio de facturacion y se limpio la cola atascada'
};

function datos(overrides) {
  return Object.assign(
    {
      empresa_id: 'HP', plataforma: 'ERP', es_cliente: false,
      solicitante_nombre: 'Juan Perez', solicitante_cargo: 'Jefe de Operaciones',
      solicitante_email: 'juan.perez@homepymes.cl', fecha_propuesta: '2026-08-01T18:00',
      subsolicitudes: [
        { titulo: 'No cargan las facturas', descripcion: 'La pantalla queda en blanco', impacto: 'SISTEMA_CAIDO', modulo: 'Facturacion', tipo: 'ERR' }
      ]
    },
    overrides
  );
}

test('una solicitud normal sigue naciendo en S01 (sin regresion)', () => {
  const db = dbConSchema();
  const res = Solicitudes.crearSolicitud(db, datos());

  assert.equal(res.estado, 'S01');
  assert.equal(res.atencion_directa, false);
  assert.equal(filas(db, 'SOLICITUDES')[0].atencion_directa, false);
});

test('atencion directa nace Cerrada (S09), no en S01', () => {
  const db = dbConSchema();
  const res = Solicitudes.crearSolicitud(db, datos({ atencion_directa: ATENCION_OK }));

  assert.equal(res.estado, 'S09');
  assert.equal(res.atencion_directa, true);
  assert.equal(filas(db, 'SOLICITUDES')[0].estado_derivado, 'S09');
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].estado, 'S09');
});

test('atencion directa guarda el registro (quien, cuando, que se hizo)', () => {
  const db = dbConSchema();
  Solicitudes.crearSolicitud(db, datos({ atencion_directa: ATENCION_OK }));

  const sub = filas(db, 'SUBSOLICITUDES')[0];
  assert.equal(sub.atencion_resuelto_por, 'Leo');
  assert.equal(sub.atencion_fecha_resolucion, '2026-01-15T10:30');
  assert.match(sub.atencion_detalle, /reinicio el servicio/);
  assert.equal(filas(db, 'SOLICITUDES')[0].atencion_directa, true);
});

test('atencion directa deja UNA sola entrada de historial, honesta', () => {
  const db = dbConSchema();
  Solicitudes.crearSolicitud(db, datos({ atencion_directa: ATENCION_OK }));

  const historial = filas(db, 'HISTORIAL_ESTADOS');
  assert.equal(historial.length, 1);
  assert.equal(historial[0].estado_anterior, '');
  assert.equal(historial[0].estado_nuevo, 'S09');
  assert.match(historial[0].comentario, /Atencion directa/);
  assert.match(historial[0].comentario, /Leo/);
  assert.match(historial[0].comentario, /reinicio el servicio/);
  assert.equal(historial[0].usuario, 'juan.perez@homepymes.cl');
});

test('los tres campos del registro son obligatorios', () => {
  const casos = [
    ['sin quien', { resuelto_por: '', fecha_resolucion: '2026-01-15T10:30', detalle: 'algo que se hizo aqui' }],
    ['sin cuando', { resuelto_por: 'Leo', fecha_resolucion: '', detalle: 'algo que se hizo aqui' }],
    ['sin detalle', { resuelto_por: 'Leo', fecha_resolucion: '2026-01-15T10:30', detalle: '' }],
    ['detalle muy corto', { resuelto_por: 'Leo', fecha_resolucion: '2026-01-15T10:30', detalle: 'ok' }]
  ];
  casos.forEach(([nombre, atencion]) => {
    const db = dbConSchema();
    const res = Solicitudes.crearSolicitud(db, datos({ atencion_directa: atencion }));
    assert.equal(res._validationError, true, nombre + ' deberia fallar');
    assert.equal(filas(db, 'SOLICITUDES').length, 0, nombre + ': no debe crear nada');
  });
});

test('activar atencion directa sin llenar los campos no crea nada', () => {
  const db = dbConSchema();
  const res = Solicitudes.crearSolicitud(db, datos({ atencion_directa: true }));

  assert.equal(res._validationError, true);
  assert.equal(filas(db, 'SOLICITUDES').length, 0);
});

test('la fecha de resolucion no puede ser futura ni invalida', () => {
  const futura = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  [futura, 'no es una fecha'].forEach((fecha) => {
    const db = dbConSchema();
    const res = Solicitudes.crearSolicitud(db, datos({
      atencion_directa: Object.assign({}, ATENCION_OK, { fecha_resolucion: fecha })
    }));
    assert.equal(res._validationError, true, fecha + ' deberia fallar');
  });
});

test('atencion_directa desactivada se trata como solicitud normal', () => {
  const db = dbConSchema();
  const res = Solicitudes.crearSolicitud(db, datos({
    atencion_directa: { activo: false, resuelto_por: '', fecha_resolucion: '', detalle: '' }
  }));

  assert.equal(res.estado, 'S01');
  assert.equal(res.atencion_directa, false);
});

test('no se manda el aviso de "solicitud nueva"; va un acuse de registro', () => {
  const db = dbConSchema();
  Solicitudes.crearSolicitud(db, datos({ atencion_directa: ATENCION_OK }));

  const eventos = filas(db, 'LOG_NOTIFICACIONES').map((l) => l.evento);
  assert.equal(eventos.indexOf('AVISO_DESARROLLO'), -1, 'no debe avisar "solicitud nueva"');
  assert.ok(eventos.indexOf('ATENCION_DIRECTA') !== -1, 'debe mandar el acuse');
});

test('una solicitud normal SI manda el aviso de desarrollo (sin regresion)', () => {
  const db = dbConSchema();
  Solicitudes.crearSolicitud(db, datos());

  const eventos = filas(db, 'LOG_NOTIFICACIONES').map((l) => l.evento);
  assert.ok(eventos.indexOf('AVISO_DESARROLLO') !== -1);
  assert.equal(eventos.indexOf('ATENCION_DIRECTA'), -1);
});

test('el acuse al solicitante dice que queda cerrada, no que sera revisada', () => {
  const db = dbConSchema();
  Solicitudes.crearSolicitud(db, datos({ atencion_directa: ATENCION_OK }));

  const acuse = filas(db, 'LOG_NOTIFICACIONES').find((n) => n.evento === 'ACUSE_RECIBO');
  assert.ok(acuse, 'debe existir el acuse');
  assert.match(acuse.cuerpo, /atención directa/i);
  assert.match(acuse.cuerpo, /cerrada/i);
  assert.equal(/derivada al equipo responsable/.test(acuse.cuerpo), false);
});
