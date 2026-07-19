'use strict';

/**
 * v3.1 (§1) — atencion directa: registrar una solicitud que YA fue resuelta.
 *
 * El caso real: algo urgente se cae, llaman al desarrollador, se arregla por
 * telefono, y despues hay que dejar registro. Lo que se cubre aqui es que ese
 * registro sea completo (los 3 campos son obligatorios), honesto (una sola
 * entrada de historial, sin inventar transiciones) y que no dispare avisos
 * que no corresponden.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadIntakeProject, seedSheet } = require('./helpers/gasSandbox');

function loadIntakeConSchema() {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'COUNTERS', ctx.COLUMNAS.COUNTERS);
  seedSheet(ctx, 'CONFIG_SLA', ctx.COLUMNAS.CONFIG_SLA, [
    ['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']
  ]);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Analista Uno', 'analista@homepymes.cl', 'HP', 'ANA', true, '', 'sistema'],
    ['U2', 'Dev Uno', 'dev@homepymes.cl', 'HP', 'DEV', true, '', 'sistema']
  ]);
  return ctx;
}

const ATENCION_OK = {
  resuelto_por: 'Leo',
  fecha_resolucion: '2026-01-15T10:30',
  detalle: 'Se reinicio el servicio de facturacion y se limpio la cola atascada'
};

function datos(overrides) {
  return Object.assign(
    {
      empresa_id: 'HP',
      plataforma: 'ERP',
      es_cliente: false,
      solicitante_nombre: 'Juan Perez',
      solicitante_cargo: 'Jefe de Operaciones',
      solicitante_email: 'juan.perez@homepymes.cl',
      fecha_propuesta: '2026-08-01T18:00',
      subsolicitudes: [
        {
          titulo: 'No cargan las facturas', descripcion: 'La pantalla queda en blanco',
          impacto: 'SISTEMA_CAIDO', modulo: 'Facturacion', tipo: 'ERR'
        }
      ]
    },
    overrides
  );
}

test('una solicitud normal sigue naciendo en S01 (sin regresion)', () => {
  const ctx = loadIntakeConSchema();
  const res = ctx.Solicitudes.crearSolicitud(datos());

  assert.equal(res.estado, 'S01');
  assert.equal(res.atencion_directa, false);
  assert.equal(ctx.leerFilas_('SOLICITUDES')[0].atencion_directa, false);
});

test('atencion directa nace Cerrada (S09), no en S01', () => {
  const ctx = loadIntakeConSchema();
  const res = ctx.Solicitudes.crearSolicitud(datos({ atencion_directa: ATENCION_OK }));

  assert.equal(res.estado, 'S09');
  assert.equal(res.atencion_directa, true);
  assert.equal(ctx.leerFilas_('SOLICITUDES')[0].estado_derivado, 'S09');
  assert.equal(ctx.leerFilas_('SUBSOLICITUDES')[0].estado, 'S09');
});

test('atencion directa guarda el registro (quien, cuando, que se hizo)', () => {
  const ctx = loadIntakeConSchema();
  ctx.Solicitudes.crearSolicitud(datos({ atencion_directa: ATENCION_OK }));

  const sub = ctx.leerFilas_('SUBSOLICITUDES')[0];
  assert.equal(sub.atencion_resuelto_por, 'Leo');
  assert.equal(sub.atencion_fecha_resolucion, '2026-01-15T10:30');
  assert.match(sub.atencion_detalle, /reinicio el servicio/);
  // La marca va en la cabecera: es lo que filtran Dashboard y Gerencia.
  assert.equal(ctx.leerFilas_('SOLICITUDES')[0].atencion_directa, true);
});

// §1.7: NO se fabrica la cadena S01->S02->...->S09. Inventar transiciones que
// nunca ocurrieron haria inservible el historial como fuente de verdad.
test('atencion directa deja UNA sola entrada de historial, honesta', () => {
  const ctx = loadIntakeConSchema();
  ctx.Solicitudes.crearSolicitud(datos({ atencion_directa: ATENCION_OK }));

  const historial = ctx.leerFilas_('HISTORIAL_ESTADOS');
  assert.equal(historial.length, 1);
  assert.equal(historial[0].estado_anterior, '');
  assert.equal(historial[0].estado_nuevo, 'S09');
  assert.match(historial[0].comentario, /Atencion directa/);
  assert.match(historial[0].comentario, /Leo/);
  assert.match(historial[0].comentario, /reinicio el servicio/);
  // Atribuida a quien la registro, no a "sistema".
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
    const ctx = loadIntakeConSchema();
    const res = ctx.Solicitudes.crearSolicitud(datos({ atencion_directa: atencion }));
    assert.equal(res._validationError, true, nombre + ' deberia fallar');
    assert.equal(ctx.leerFilas_('SOLICITUDES').length, 0, nombre + ': no debe crear nada');
  });
});

// Marcar el switch sin llenar nada convertiria "atencion directa" en un boton
// para crear solicitudes ya cerradas sin explicacion.
test('activar atencion directa sin llenar los campos no crea nada', () => {
  const ctx = loadIntakeConSchema();
  const res = ctx.Solicitudes.crearSolicitud(datos({ atencion_directa: true }));

  assert.equal(res._validationError, true);
  assert.equal(ctx.leerFilas_('SOLICITUDES').length, 0);
});

test('la fecha de resolucion no puede ser futura ni invalida', () => {
  const futura = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  [futura, 'no es una fecha'].forEach((fecha) => {
    const ctx = loadIntakeConSchema();
    const res = ctx.Solicitudes.crearSolicitud(datos({
      atencion_directa: Object.assign({}, ATENCION_OK, { fecha_resolucion: fecha })
    }));
    assert.equal(res._validationError, true, fecha + ' deberia fallar');
  });
});

// El bloque puede llegar desactivado desde el formulario (el usuario lo
// marco y lo desmarco): eso es una solicitud normal, no un error.
test('atencion_directa desactivada se trata como solicitud normal', () => {
  const ctx = loadIntakeConSchema();
  const res = ctx.Solicitudes.crearSolicitud(datos({
    atencion_directa: { activo: false, resuelto_por: '', fecha_resolucion: '', detalle: '' }
  }));

  assert.equal(res.estado, 'S01');
  assert.equal(res.atencion_directa, false);
});

// §1.8: el error mas facil de cometer seria avisarle al desarrollador
// "tienes una solicitud nueva" por algo que el mismo acaba de arreglar.
test('no se manda el aviso de "solicitud nueva"; va un acuse de registro', () => {
  const ctx = loadIntakeConSchema();
  ctx.Solicitudes.crearSolicitud(datos({ atencion_directa: ATENCION_OK }));

  const eventos = ctx.leerFilas_('LOG_NOTIFICACIONES').map((l) => l.evento);
  assert.equal(eventos.indexOf('AVISO_DESARROLLO'), -1, 'no debe avisar "solicitud nueva"');
  assert.ok(eventos.indexOf('ATENCION_DIRECTA') !== -1, 'debe mandar el acuse');
});

test('una solicitud normal SI manda el aviso de desarrollo (sin regresion)', () => {
  const ctx = loadIntakeConSchema();
  ctx.Solicitudes.crearSolicitud(datos());

  const eventos = ctx.leerFilas_('LOG_NOTIFICACIONES').map((l) => l.evento);
  assert.ok(eventos.indexOf('AVISO_DESARROLLO') !== -1);
  assert.equal(eventos.indexOf('ATENCION_DIRECTA'), -1);
});

// El acuse normal dice "derivada al equipo responsable para su revision":
// en una atencion directa eso dejaria al solicitante esperando una respuesta
// que no va a llegar.
test('el acuse al solicitante dice que queda cerrada, no que sera revisada', () => {
  const ctx = loadIntakeConSchema();
  ctx.Solicitudes.crearSolicitud(datos({ atencion_directa: ATENCION_OK }));

  // El LOG solo guarda el cuerpo cuando el envio queda pendiente de
  // reintento; para leer el correo enviado se usa el mock de MailApp.
  const acuse = ctx.GmailApp._enviados.find((c) => /Confirmación de recepción/.test(c.asunto));
  assert.ok(acuse, 'debe existir el acuse');
  assert.match(acuse.cuerpo, /atención directa/i);
  assert.match(acuse.cuerpo, /cerrada/i);
  assert.equal(/derivada al equipo responsable/.test(acuse.cuerpo), false);
});

// --- §1.3B: cierre directo desde "Mis solicitudes" ----------------------
// Caso distinto al registro al ingreso: la solicitud YA existe en el sistema,
// en un estado intermedio, y se termino resolviendo por telefono.

function seedSolicitudAbierta(ctx, estadoItem) {
  const res = ctx.Solicitudes.crearSolicitud(datos());
  const subId = res.solicitud_id + '-01';
  ctx.actualizarFilaPorId_('SUBSOLICITUDES', 'subsolicitud_id', subId, { estado: estadoItem });
  ctx.actualizarFilaPorId_('SOLICITUDES', 'solicitud_id', res.solicitud_id, { estado_derivado: estadoItem });
  return { solicitudId: res.solicitud_id, subId: subId };
}

test('cerrar_directo cierra un item desde cualquier estado abierto', () => {
  ['S02', 'S05', 'S06'].forEach((estado) => {
    const ctx = loadIntakeConSchema();
    const { solicitudId, subId } = seedSolicitudAbierta(ctx, estado);

    const res = ctx.Solicitudes.validarCierre({
      solicitud_id: solicitudId, subsolicitud_id: subId,
      email: 'juan.perez@homepymes.cl', accion: 'cerrar_directo',
      atencion_directa: ATENCION_OK
    });

    assert.equal(res.estado_nuevo, 'S09', 'desde ' + estado + ' deberia cerrar');
    assert.equal(res.estado_anterior, estado);
    assert.equal(ctx.leerFilas_('SUBSOLICITUDES')[0].estado, 'S09');
  });
});

test('cerrar_directo guarda el registro en el item y en el historial', () => {
  const ctx = loadIntakeConSchema();
  const { solicitudId, subId } = seedSolicitudAbierta(ctx, 'S05');

  ctx.Solicitudes.validarCierre({
    solicitud_id: solicitudId, subsolicitud_id: subId,
    email: 'juan.perez@homepymes.cl', accion: 'cerrar_directo',
    atencion_directa: ATENCION_OK
  });

  const sub = ctx.leerFilas_('SUBSOLICITUDES')[0];
  assert.equal(sub.atencion_resuelto_por, 'Leo');
  assert.match(sub.atencion_detalle, /reinicio el servicio/);

  const ultima = ctx.leerFilas_('HISTORIAL_ESTADOS').slice(-1)[0];
  assert.equal(ultima.estado_nuevo, 'S09');
  assert.match(ultima.comentario, /Atencion directa/);
  assert.equal(ultima.usuario, 'juan.perez@homepymes.cl');
});

test('cerrar_directo tambien exige los tres campos del registro', () => {
  const ctx = loadIntakeConSchema();
  const { solicitudId, subId } = seedSolicitudAbierta(ctx, 'S05');

  const res = ctx.Solicitudes.validarCierre({
    solicitud_id: solicitudId, subsolicitud_id: subId,
    email: 'juan.perez@homepymes.cl', accion: 'cerrar_directo'
  });

  assert.equal(res._validationError, true);
  assert.equal(ctx.leerFilas_('SUBSOLICITUDES')[0].estado, 'S05', 'no debe cerrar');
});

test('cerrar_directo no aplica a un item ya cerrado', () => {
  const ctx = loadIntakeConSchema();
  const { solicitudId, subId } = seedSolicitudAbierta(ctx, 'S09');

  const res = ctx.Solicitudes.validarCierre({
    solicitud_id: solicitudId, subsolicitud_id: subId,
    email: 'juan.perez@homepymes.cl', accion: 'cerrar_directo',
    atencion_directa: ATENCION_OK
  });

  assert.equal(res._validationError, true);
  assert.match(res.message, /ya esta cerrado/);
});

test('cerrar_directo respeta la verificacion de correo del solicitante', () => {
  const ctx = loadIntakeConSchema();
  const { solicitudId, subId } = seedSolicitudAbierta(ctx, 'S05');

  const res = ctx.Solicitudes.validarCierre({
    solicitud_id: solicitudId, subsolicitud_id: subId,
    email: 'otro@homepymes.cl', accion: 'cerrar_directo',
    atencion_directa: ATENCION_OK
  });

  assert.equal(res._forbidden, true);
  assert.equal(ctx.leerFilas_('SUBSOLICITUDES')[0].estado, 'S05');
});

// Sin distinguir la accion, el correo anunciaria "Ítem reabierto", que es
// exactamente lo contrario de lo que paso.
test('el aviso de un cierre directo no dice "reabierto"', () => {
  const ctx = loadIntakeConSchema();
  const { solicitudId, subId } = seedSolicitudAbierta(ctx, 'S05');

  ctx.Solicitudes.validarCierre({
    solicitud_id: solicitudId, subsolicitud_id: subId,
    email: 'juan.perez@homepymes.cl', accion: 'cerrar_directo',
    atencion_directa: ATENCION_OK
  });

  const aviso = ctx.GmailApp._enviados.slice(-1)[0];
  assert.match(aviso.asunto, /atención directa/i);
  assert.equal(/reabierto/i.test(aviso.asunto), false);
  assert.equal(/reabri/i.test(aviso.cuerpo), false);
});

// La marca atencion_directa existe para excluir de los KPIs a lo que se crea
// y cierra en el mismo instante. Una solicitud que vivio dias en el sistema
// tiene un tiempo real que SI debe medirse, aunque el desenlace fuera por
// telefono.
test('un cierre directo NO marca la solicitud como atencion_directa', () => {
  const ctx = loadIntakeConSchema();
  const { solicitudId, subId } = seedSolicitudAbierta(ctx, 'S05');

  ctx.Solicitudes.validarCierre({
    solicitud_id: solicitudId, subsolicitud_id: subId,
    email: 'juan.perez@homepymes.cl', accion: 'cerrar_directo',
    atencion_directa: ATENCION_OK
  });

  assert.equal(ctx.leerFilas_('SOLICITUDES')[0].atencion_directa, false);
});

test('confirmar/reabrir siguen exigiendo S08 (sin regresion)', () => {
  const ctx = loadIntakeConSchema();
  const { solicitudId, subId } = seedSolicitudAbierta(ctx, 'S05');

  const res = ctx.Solicitudes.validarCierre({
    solicitud_id: solicitudId, subsolicitud_id: subId,
    email: 'juan.perez@homepymes.cl', accion: 'confirmar'
  });

  assert.equal(res._validationError, true);
  assert.match(res.message, /Terminada/);
});

// Bug encontrado verificando en el navegador: la validacion de v2.1 exigia
// fecha_propuesta ("¿para cuando lo necesitas?") en solicitudes P1/cliente.
// Eso bloqueaba el registro de justamente los casos que se resuelven por
// telefono -- los urgentes.
test('atencion directa no exige fecha_propuesta aunque sea P1 o de cliente', () => {
  // datos() usa impacto SISTEMA_CAIDO (P1) y aqui se omite fecha_propuesta.
  const sinFecha = Object.assign(datos({ atencion_directa: ATENCION_OK }));
  delete sinFecha.fecha_propuesta;

  const ctx = loadIntakeConSchema();
  const res = ctx.Solicitudes.crearSolicitud(sinFecha);

  assert.equal(res._validationError, undefined, 'no deberia pedir fecha propuesta');
  assert.equal(res.estado, 'S09');
});

test('una solicitud normal P1 SIGUE exigiendo fecha_propuesta (sin regresion)', () => {
  const sinFecha = datos();
  delete sinFecha.fecha_propuesta;

  const ctx = loadIntakeConSchema();
  const res = ctx.Solicitudes.crearSolicitud(sinFecha);

  assert.equal(res._validationError, true);
  assert.ok(res.fields.some((f) => f.campo === 'fecha_propuesta'));
});
