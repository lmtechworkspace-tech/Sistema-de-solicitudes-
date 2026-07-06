'use strict';

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

function datosValidos(overrides) {
  return Object.assign(
    {
      empresa_id: 'HP',
      plataforma: 'ERP',
      modulo: 'Facturacion',
      tipo: 'ERR',
      es_cliente: false,
      solicitante_nombre: 'Juan Perez',
      solicitante_cargo: 'Jefe de Operaciones',
      solicitante_email: 'juan.perez@homepymes.cl',
      subsolicitudes: [
        { titulo: 'No cargan las facturas', descripcion: 'La pantalla queda en blanco', impacto: 'SISTEMA_CAIDO' }
      ]
    },
    overrides
  );
}

test('crearSolicitud escribe SOLICITUDES, SUBSOLICITUDES e HISTORIAL_ESTADOS y responde S01', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos());

  assert.match(resultado.solicitud_id, /^SOL-\d{4}-HP-0001$/);
  assert.equal(resultado.estado, 'S01');
  assert.ok(resultado.resumen_whatsapp.includes(resultado.solicitud_id));

  const solicitudes = ctx.leerFilas_('SOLICITUDES');
  const subsolicitudes = ctx.leerFilas_('SUBSOLICITUDES');
  const historial = ctx.leerFilas_('HISTORIAL_ESTADOS');

  assert.equal(solicitudes.length, 1);
  assert.equal(solicitudes[0].prioridad_derivada, 'P1');
  assert.equal(subsolicitudes.length, 1);
  assert.equal(subsolicitudes[0].prioridad, 'P1');
  assert.equal(subsolicitudes[0].sla_objetivo_horas, 2);
  assert.equal(historial.length, 1);
  assert.equal(historial[0].estado_nuevo, 'S01');
});

test('crearSolicitud rechaza datos incompletos (RN-002) con error de validacion', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({ empresa_id: '', tipo: '' }));

  assert.equal(resultado._validationError, true);
  const campos = resultado.fields.map((f) => f.campo);
  assert.ok(campos.includes('empresa_id'));
  assert.ok(campos.includes('tipo'));
});

test('crearSolicitud exige al menos una subsolicitud con titulo y descripcion (RN-004)', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({ subsolicitudes: [] }));

  assert.equal(resultado._validationError, true);
  assert.ok(resultado.fields.some((f) => f.campo === 'subsolicitudes'));
});

test('crearSolicitud exige datos de cliente cuando es_cliente=true (RN-005)', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({ es_cliente: true }));

  assert.equal(resultado._validationError, true);
  const campos = resultado.fields.map((f) => f.campo);
  assert.ok(campos.includes('empresa_cliente'));
  assert.ok(campos.includes('contacto_cliente'));
  assert.ok(campos.includes('correo_cliente'));
});

test('crearSolicitud detecta un duplicado abierto sin bloquear la creacion (RF-F06)', () => {
  const ctx = loadIntakeConSchema();
  const primero = ctx.Solicitudes.crearSolicitud(datosValidos());
  const segundo = ctx.Solicitudes.crearSolicitud(datosValidos());

  assert.ok(!primero.posible_duplicado);
  assert.equal(segundo.posible_duplicado.solicitud_id, primero.solicitud_id);
  // Se crea igual: RF-F06 dice "avisar", no "bloquear".
  assert.notEqual(segundo.solicitud_id, primero.solicitud_id);
});

test('derivarPrioridad_ aplica la tabla de impacto (RN-006) y P4 por defecto', () => {
  const ctx = loadIntakeConSchema();
  assert.equal(ctx.derivarPrioridad_('SISTEMA_CAIDO'), 'P1');
  assert.equal(ctx.derivarPrioridad_('PERDIDA_DATOS'), 'P1');
  assert.equal(ctx.derivarPrioridad_('BLOQUEO_OPERATIVO'), 'P1');
  assert.equal(ctx.derivarPrioridad_('DEGRADACION_IMPORTANTE'), 'P2');
  assert.equal(ctx.derivarPrioridad_('PARCIAL_CON_WORKAROUND'), 'P3');
  assert.equal(ctx.derivarPrioridad_('PLANIFICADO'), 'P5');
  assert.equal(ctx.derivarPrioridad_(undefined), 'P4');
  assert.equal(ctx.derivarPrioridad_('ALGO_DESCONOCIDO'), 'P4');
});

test('la prioridad_derivada del padre es la mas critica entre sus subsolicitudes', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(
    datosValidos({
      subsolicitudes: [
        { titulo: 'Item menor', descripcion: 'algo parcial', impacto: 'PARCIAL_CON_WORKAROUND' },
        { titulo: 'Item critico', descripcion: 'todo caido', impacto: 'SISTEMA_CAIDO' }
      ]
    })
  );

  assert.equal(resultado.estado, 'S01');
  const solicitudes = ctx.leerFilas_('SOLICITUDES');
  assert.equal(solicitudes[0].prioridad_derivada, 'P1');
});

test('crearSolicitud exige el cargo del solicitante (RF-001, v1.0)', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({ solicitante_cargo: '' }));

  assert.equal(resultado._validationError, true);
  assert.ok(resultado.fields.some((f) => f.campo === 'solicitante_cargo'));
});

test('crearSolicitud guarda los campos ampliados de v1.0 (cargo, cliente, subsolicitud)', () => {
  const ctx = loadIntakeConSchema();
  ctx.Solicitudes.crearSolicitud(
    datosValidos({
      es_cliente: true,
      empresa_cliente: 'Cliente SA', cliente_mandante: 'Mandante SA', cliente_obra: 'Obra Norte',
      contacto_cliente: 'Pedro', correo_cliente: 'pedro@cliente.cl', telefono_cliente: '+56911111111',
      urgencia_cliente: 'Alta', observaciones_generales: 'Urgente para el cliente',
      subsolicitudes: [{
        titulo: 'Titulo', descripcion: 'Desc', contexto: 'Contexto', resultado_esperado: 'Resultado',
        impacto: 'SISTEMA_CAIDO', url_modulo: 'https://x.cl/modulo', usuario_prueba: 'demo',
        centro_costos: 'CC-01', url_video: 'https://video.cl/1', observaciones: 'obs item',
        estimacion_horas: 8
      }]
    })
  );

  const solicitud = ctx.leerFilas_('SOLICITUDES')[0];
  assert.equal(solicitud.solicitante_cargo, 'Jefe de Operaciones');
  assert.equal(solicitud.cliente_mandante, 'Mandante SA');
  assert.equal(solicitud.cliente_obra, 'Obra Norte');
  assert.equal(solicitud.telefono_cliente, '+56911111111');
  assert.equal(solicitud.urgencia_cliente, 'Alta');
  assert.equal(solicitud.observaciones_generales, 'Urgente para el cliente');

  const subsolicitud = ctx.leerFilas_('SUBSOLICITUDES')[0];
  assert.equal(subsolicitud.numero_item, 1);
  assert.equal(subsolicitud.contexto, 'Contexto');
  assert.equal(subsolicitud.resultado_esperado, 'Resultado');
  assert.equal(subsolicitud.url_modulo, 'https://x.cl/modulo');
  assert.equal(subsolicitud.usuario_prueba, 'demo');
  assert.equal(subsolicitud.centro_costos, 'CC-01');
  assert.equal(subsolicitud.url_video, 'https://video.cl/1');
  assert.equal(subsolicitud.observaciones, 'obs item');
  assert.equal(subsolicitud.estimacion_horas, 8);
});

test('crearSolicitud guarda cc y urls_adicionales (Fase 9, hallazgo de datos reales)', () => {
  const ctx = loadIntakeConSchema();
  ctx.Solicitudes.crearSolicitud(
    datosValidos({
      cc: 'copia@empresa.cl',
      subsolicitudes: [{
        titulo: 'Titulo', descripcion: 'Desc', impacto: 'PLANIFICADO',
        url_modulo: 'https://x.cl/principal',
        urls_adicionales: [
          { titulo: 'Modal de validacion', url: 'https://x.cl/validacion' },
          { titulo: 'Documento generado', url: 'https://x.cl/doc' }
        ],
        ref_credencial: 'Ver gestor de credenciales #123'
      }]
    })
  );

  const solicitud = ctx.leerFilas_('SOLICITUDES')[0];
  assert.equal(solicitud.cc, 'copia@empresa.cl');

  const subsolicitud = ctx.leerFilas_('SUBSOLICITUDES')[0];
  assert.equal(subsolicitud.ref_credencial, 'Ver gestor de credenciales #123');
  assert.deepEqual(JSON.parse(subsolicitud.urls_adicionales), [
    { titulo: 'Modal de validacion', url: 'https://x.cl/validacion' },
    { titulo: 'Documento generado', url: 'https://x.cl/doc' }
  ]);
});

test('crearSolicitud rechaza un cc con formato de correo invalido', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({ cc: 'no-es-un-correo' }));

  assert.equal(resultado._validationError, true);
  assert.ok(resultado.fields.some((f) => f.campo === 'cc'));
});

test('generarResumenWhatsapp_ sigue el formato de RF-015 con un solo item', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos());

  const lineas = resultado.resumen_whatsapp.split('\n');
  assert.match(lineas[0], /^📋 SOLICITUD N° SOL-/);
  assert.match(lineas[1], /^🔴 PRIORIDAD: Critica$/);
  assert.equal(lineas[2], '🏢 Empresa: HP');
  assert.equal(lineas[3], '💻 Sistema: ERP');
  assert.equal(lineas[6], '📝 Resumen: La pantalla queda en blanco');
});

test('crearSolicitud guarda los nombres desnormalizados de los catalogos (§13.2 v1.0)', () => {
  const ctx = loadIntakeConSchema();
  seedSheet(ctx, 'CAT_EMPRESAS', ctx.COLUMNAS.CAT_EMPRESAS, [['HP', 'HomePymes', '', true]]);
  seedSheet(ctx, 'CAT_PLATAFORMAS', ctx.COLUMNAS.CAT_PLATAFORMAS, [['ERP', 'Sistema ERP', 'HP', '', true]]);
  seedSheet(ctx, 'CAT_MODULOS', ctx.COLUMNAS.CAT_MODULOS, [['Facturacion', 'Facturacion Electronica', 'ERP', '', true]]);
  seedSheet(ctx, 'CAT_TIPOS', ctx.COLUMNAS.CAT_TIPOS, [['ERR', 'Error / Bug', 'P2', true]]);

  ctx.Solicitudes.crearSolicitud(datosValidos());

  const solicitud = ctx.leerFilas_('SOLICITUDES')[0];
  assert.equal(solicitud.empresa_nombre, 'HomePymes');
  assert.equal(solicitud.plataforma_nombre, 'Sistema ERP');
  assert.equal(solicitud.modulo_nombre, 'Facturacion Electronica');
  assert.equal(solicitud.tipo_nombre, 'Error / Bug');
});

test('crearSolicitud no falla si los catalogos aun no existen (nombre desnormalizado queda vacio)', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos());

  assert.ok(resultado.solicitud_id);
  const solicitud = ctx.leerFilas_('SOLICITUDES')[0];
  assert.equal(solicitud.empresa_nombre, '');
});

test('generarResumenWhatsapp_ indica la cantidad de items en vez de listarlos (RF-F07)', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(
    datosValidos({
      subsolicitudes: [
        { titulo: 'Item 1', descripcion: 'Desc 1', impacto: 'PARCIAL_CON_WORKAROUND' },
        { titulo: 'Item 2', descripcion: 'Desc 2', impacto: 'PARCIAL_CON_WORKAROUND' }
      ]
    })
  );

  assert.ok(resultado.resumen_whatsapp.includes('📝 Resumen: 2 items — ver detalle en correo'));
});
