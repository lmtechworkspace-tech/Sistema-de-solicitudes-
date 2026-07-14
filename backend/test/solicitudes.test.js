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
      es_cliente: false,
      solicitante_nombre: 'Juan Perez',
      solicitante_cargo: 'Jefe de Operaciones',
      solicitante_email: 'juan.perez@homepymes.cl',
      // v2.1 (Fase A): el impacto por defecto (SISTEMA_CAIDO) es P1, asi que
      // hace falta fecha+hora para que datosValidos() sea realmente valido.
      fecha_propuesta: '2026-08-01T18:00',
      // Fase 10: modulo/tipo se piden por item, no a nivel raiz.
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
  // Fase 10: SOLICITUDES.tipo/modulo se derivan del primer item.
  assert.equal(solicitudes[0].modulo, 'Facturacion');
  assert.equal(solicitudes[0].tipo, 'ERR');
  assert.equal(subsolicitudes.length, 1);
  assert.equal(subsolicitudes[0].prioridad, 'P1');
  assert.equal(subsolicitudes[0].sla_objetivo_horas, 2);
  assert.equal(subsolicitudes[0].modulo, 'Facturacion');
  assert.equal(subsolicitudes[0].tipo, 'ERR');
  assert.equal(historial.length, 1);
  assert.equal(historial[0].estado_nuevo, 'S01');
});

test('crearSolicitud rechaza datos incompletos (RN-002) con error de validacion', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({
    empresa_id: '',
    subsolicitudes: [{ titulo: 'x', descripcion: 'y', impacto: 'SISTEMA_CAIDO', modulo: 'Facturacion', tipo: '' }]
  }));

  assert.equal(resultado._validationError, true);
  const campos = resultado.fields.map((f) => f.campo);
  assert.ok(campos.includes('empresa_id'));
  assert.ok(campos.includes('subsolicitudes[0].tipo'));
});

test('crearSolicitud exige tipo y modulo por item (RN-002, Fase 10)', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({
    subsolicitudes: [{ titulo: 'x', descripcion: 'y', impacto: 'SISTEMA_CAIDO' }]
  }));

  assert.equal(resultado._validationError, true);
  const campos = resultado.fields.map((f) => f.campo);
  assert.ok(campos.includes('subsolicitudes[0].tipo'));
  assert.ok(campos.includes('subsolicitudes[0].modulo'));
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

// P2 (v2.0, Sprint 2): un tipo urgente por naturaleza (o una solicitud de
// cliente) pone un piso de P2, sin diluir un impacto realmente critico.
test('derivarPrioridad_ (P2): con esUrgente=true, nunca baja de P2 -- pero un impacto P1 sigue ganando', () => {
  const ctx = loadIntakeConSchema();
  assert.equal(ctx.derivarPrioridad_('PLANIFICADO', true), 'P2');
  assert.equal(ctx.derivarPrioridad_('PARCIAL_CON_WORKAROUND', true), 'P2');
  assert.equal(ctx.derivarPrioridad_('DEGRADACION_IMPORTANTE', true), 'P2');
  assert.equal(ctx.derivarPrioridad_('SISTEMA_CAIDO', true), 'P1');
  assert.equal(ctx.derivarPrioridad_(undefined, true), 'P2');
  // Sin la bandera, se comporta igual que antes.
  assert.equal(ctx.derivarPrioridad_('PLANIFICADO', false), 'P5');
});

test('crearSolicitud (P2): un tipo con es_urgente=true en CAT_TIPOS sube la prioridad a P2 aunque el impacto sea bajo', () => {
  const ctx = loadIntakeConSchema();
  seedSheet(ctx, 'CAT_TIPOS', ctx.COLUMNAS.CAT_TIPOS, [
    ['ERR', 'Error / Bug', 'P2', true, true],
    ['MEJ', 'Mejora', 'P3', true, false]
  ]);

  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({
    subsolicitudes: [{ titulo: 'Idea nueva', descripcion: 'seria bueno tener esto', impacto: 'PLANIFICADO', modulo: 'Facturacion', tipo: 'ERR' }]
  }));

  const subsolicitudes = ctx.leerFilas_('SUBSOLICITUDES');
  assert.equal(subsolicitudes[0].prioridad, 'P2');
  assert.equal(ctx.leerFilas_('SOLICITUDES')[0].prioridad_derivada, 'P2');
});

test('crearSolicitud (P2): un tipo con es_urgente=false NO sube la prioridad -- sigue derivandose solo del impacto', () => {
  const ctx = loadIntakeConSchema();
  seedSheet(ctx, 'CAT_TIPOS', ctx.COLUMNAS.CAT_TIPOS, [
    ['MEJ', 'Mejora', 'P3', true, false]
  ]);

  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({
    subsolicitudes: [{ titulo: 'Idea nueva', descripcion: 'seria bueno tener esto', impacto: 'PLANIFICADO', modulo: 'Facturacion', tipo: 'MEJ' }]
  }));

  assert.equal(ctx.leerFilas_('SUBSOLICITUDES')[0].prioridad, 'P5');
});

// P12 (v2.0, Sprint 3): switch global CONFIG_NOTIFICACIONES.AVISO_LEO.
test('crearSolicitud (P12) NO avisa a Leo si AVISO_LEO esta desactivado, aunque sea P1', () => {
  const ctx = loadIntakeConSchema();
  seedSheet(ctx, 'CONFIG_NOTIFICACIONES', ctx.COLUMNAS.CONFIG_NOTIFICACIONES, [
    ['AVISO_LEO', 'AVISO_DESARROLLO', '', '', false]
  ]);

  ctx.Solicitudes.crearSolicitud(datosValidos());

  const avisos = ctx.leerFilas_('LOG_NOTIFICACIONES').filter((n) => n.evento === 'AVISO_DESARROLLO');
  assert.equal(avisos.length, 0);
});

test('crearSolicitud (P12) SI avisa a Leo si no existe el registro AVISO_LEO (compatibilidad hacia atras)', () => {
  const ctx = loadIntakeConSchema();
  seedSheet(ctx, 'CONFIG_NOTIFICACIONES', ctx.COLUMNAS.CONFIG_NOTIFICACIONES);

  ctx.Solicitudes.crearSolicitud(datosValidos());

  const avisos = ctx.leerFilas_('LOG_NOTIFICACIONES').filter((n) => n.evento === 'AVISO_DESARROLLO');
  assert.equal(avisos.length, 1);
});

test('crearSolicitud (P2): toda solicitud de cliente sube a P2 aunque el tipo no sea urgente (RN-005/P4 formalizado)', () => {
  const ctx = loadIntakeConSchema();
  seedSheet(ctx, 'CAT_TIPOS', ctx.COLUMNAS.CAT_TIPOS, [
    ['MEJ', 'Mejora', 'P3', true, false]
  ]);

  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({
    es_cliente: true, empresa_cliente: 'Constructora X', contacto_cliente: 'Ana', correo_cliente: 'ana@constructorax.cl',
    subsolicitudes: [{ titulo: 'Idea nueva', descripcion: 'pedido de cliente', impacto: 'PLANIFICADO', modulo: 'Facturacion', tipo: 'MEJ' }]
  }));

  assert.equal(ctx.leerFilas_('SUBSOLICITUDES')[0].prioridad, 'P2');
});

test('la prioridad_derivada del padre es la mas critica entre sus subsolicitudes', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(
    datosValidos({
      subsolicitudes: [
        { titulo: 'Item menor', descripcion: 'algo parcial', impacto: 'PARCIAL_CON_WORKAROUND', modulo: 'Facturacion', tipo: 'ERR' },
        { titulo: 'Item critico', descripcion: 'todo caido', impacto: 'SISTEMA_CAIDO', modulo: 'Facturacion', tipo: 'ERR' }
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
        estimacion_horas: 8, modulo: 'Facturacion', tipo: 'ERR'
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

test('crearSolicitud guarda rut_cliente y codigo_cliente del cliente elegido en el buscador (Idea 1)', () => {
  const ctx = loadIntakeConSchema();
  ctx.Solicitudes.crearSolicitud(
    datosValidos({
      es_cliente: true,
      empresa_cliente: 'Alfacorp SpA', contacto_cliente: 'Manuel Alfaro',
      correo_cliente: 'contacto.alfacorp1@gmail.com', telefono_cliente: '955309287',
      rut_cliente: '76.897.217-6', codigo_cliente: 'HP-013-1',
      subsolicitudes: [{ titulo: 'T', descripcion: 'D', impacto: 'SISTEMA_CAIDO', modulo: 'Facturacion', tipo: 'ERR' }]
    })
  );
  const solicitud = ctx.leerFilas_('SOLICITUDES')[0];
  assert.equal(solicitud.rut_cliente, '76.897.217-6');
  assert.equal(solicitud.codigo_cliente, 'HP-013-1');
});

test('crearSolicitud deja rut_cliente/codigo_cliente vacios en solicitud interna (sin cliente)', () => {
  const ctx = loadIntakeConSchema();
  ctx.Solicitudes.crearSolicitud(datosValidos({}));
  const solicitud = ctx.leerFilas_('SOLICITUDES')[0];
  assert.equal(solicitud.rut_cliente, '');
  assert.equal(solicitud.codigo_cliente, '');
});

test('crearSolicitud guarda cc y urls_adicionales (Fase 9, hallazgo de datos reales)', () => {
  const ctx = loadIntakeConSchema();
  ctx.Solicitudes.crearSolicitud(
    datosValidos({
      cc: 'copia@empresa.cl',
      subsolicitudes: [{
        titulo: 'Titulo', descripcion: 'Desc', impacto: 'PLANIFICADO',
        modulo: 'Facturacion', tipo: 'ERR',
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

test('crearSolicitud guarda tipo/modulo por item, frecuencia/personas_afectadas e imagen_descripciones (Fase 10)', () => {
  const ctx = loadIntakeConSchema();
  seedSheet(ctx, 'CAT_TIPOS', ctx.COLUMNAS.CAT_TIPOS, [
    ['ERR', 'Error / Bug', 'P2', true], ['MEJ', 'Mejora', 'P3', true]
  ]);
  seedSheet(ctx, 'CAT_MODULOS', ctx.COLUMNAS.CAT_MODULOS, [
    ['Facturacion', 'Facturacion Electronica', 'ERP', '', true],
    ['Reportes', 'Reportes', 'ERP', '', true]
  ]);

  ctx.Solicitudes.crearSolicitud(
    datosValidos({
      subsolicitudes: [
        {
          titulo: 'Item 1', descripcion: 'Desc 1', impacto: 'SISTEMA_CAIDO',
          modulo: 'Facturacion', tipo: 'ERR',
          frecuencia: 'SIEMPRE', personas_afectadas: 12,
          imagen_descripciones: ['Pantalla en blanco', 'Consola con el error']
        },
        {
          titulo: 'Item 2', descripcion: 'Desc 2', impacto: 'PLANIFICADO',
          modulo: 'Reportes', tipo: 'MEJ',
          frecuencia: 'A_VECES', personas_afectadas: 3
        }
      ]
    })
  );

  const subsolicitudes = ctx.leerFilas_('SUBSOLICITUDES');
  assert.equal(subsolicitudes[0].modulo, 'Facturacion');
  assert.equal(subsolicitudes[0].modulo_nombre, 'Facturacion Electronica');
  assert.equal(subsolicitudes[0].tipo, 'ERR');
  assert.equal(subsolicitudes[0].tipo_nombre, 'Error / Bug');
  assert.equal(subsolicitudes[0].frecuencia, 'SIEMPRE');
  assert.equal(subsolicitudes[0].personas_afectadas, 12);
  assert.deepEqual(JSON.parse(subsolicitudes[0].imagen_descripciones), ['Pantalla en blanco', 'Consola con el error']);

  assert.equal(subsolicitudes[1].modulo, 'Reportes');
  assert.equal(subsolicitudes[1].tipo, 'MEJ');
  assert.equal(subsolicitudes[1].frecuencia, 'A_VECES');
  assert.equal(subsolicitudes[1].personas_afectadas, 3);
  assert.deepEqual(JSON.parse(subsolicitudes[1].imagen_descripciones), []);

  // SOLICITUDES.modulo/tipo se derivan del PRIMER item, no del segundo.
  const solicitud = ctx.leerFilas_('SOLICITUDES')[0];
  assert.equal(solicitud.modulo, 'Facturacion');
  assert.equal(solicitud.modulo_nombre, 'Facturacion Electronica');
  assert.equal(solicitud.tipo, 'ERR');
  assert.equal(solicitud.tipo_nombre, 'Error / Bug');
});

test('crearSolicitud rechaza un cc con formato de correo invalido', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({ cc: 'no-es-un-correo' }));

  assert.equal(resultado._validationError, true);
  assert.ok(resultado.fields.some((f) => f.campo === 'cc'));
});

// v2.1 (Fase A, documentacion/SIGSO-v2.1-plazos-y-control.md §4): "para
// cuando lo necesitas" es obligatorio CON hora en cliente/P1 (se puede
// resolver en horas/minutos), opcional (solo fecha) para el resto.
test('crearSolicitud (v2.1) exige fecha+hora propuesta cuando el impacto deriva P1', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({ fecha_propuesta: '' }));

  assert.equal(resultado._validationError, true);
  assert.ok(resultado.fields.some((f) => f.campo === 'fecha_propuesta'));
});

test('crearSolicitud (v2.1) exige fecha+hora propuesta cuando es_cliente=true, aunque el impacto no sea P1', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({
    es_cliente: true,
    empresa_cliente: 'Constructora X', contacto_cliente: 'Ana', correo_cliente: 'ana@constructorax.cl',
    fecha_propuesta: '',
    subsolicitudes: [{ titulo: 'x', descripcion: 'y', impacto: 'PLANIFICADO', modulo: 'Facturacion', tipo: 'ERR' }]
  }));

  assert.equal(resultado._validationError, true);
  assert.ok(resultado.fields.some((f) => f.campo === 'fecha_propuesta'));
});

test('crearSolicitud (v2.1) rechaza fecha propuesta SIN hora cuando se requiere (cliente/P1)', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({ fecha_propuesta: '2026-08-01' }));

  assert.equal(resultado._validationError, true);
  assert.ok(resultado.fields.some((f) => f.campo === 'fecha_propuesta'));
});

test('crearSolicitud (v2.1) NO exige fecha propuesta cuando no es cliente ni P1 (es opcional)', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({
    fecha_propuesta: '',
    subsolicitudes: [{ titulo: 'x', descripcion: 'y', impacto: 'PLANIFICADO', modulo: 'Facturacion', tipo: 'ERR' }]
  }));

  assert.equal(resultado._validationError, undefined);
});

test('crearSolicitud (v2.1) acepta solo fecha (sin hora) cuando la propuesta es opcional', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({
    fecha_propuesta: '2026-08-01',
    subsolicitudes: [{ titulo: 'x', descripcion: 'y', impacto: 'PLANIFICADO', modulo: 'Facturacion', tipo: 'ERR' }]
  }));

  assert.equal(resultado._validationError, undefined);
  assert.equal(ctx.leerFilas_('SUBSOLICITUDES')[0].fecha_propuesta, '2026-08-01');
});

test('crearSolicitud (v2.1) replica fecha_propuesta en cada item y deja fecha_comprometida/fecha_terminada/comprometida_por vacias', () => {
  const ctx = loadIntakeConSchema();
  ctx.Solicitudes.crearSolicitud(datosValidos({
    subsolicitudes: [
      { titulo: 'Item 1', descripcion: 'Desc 1', impacto: 'SISTEMA_CAIDO', modulo: 'Facturacion', tipo: 'ERR' },
      { titulo: 'Item 2', descripcion: 'Desc 2', impacto: 'PLANIFICADO', modulo: 'Facturacion', tipo: 'ERR' }
    ]
  }));

  const subsolicitudes = ctx.leerFilas_('SUBSOLICITUDES');
  assert.equal(subsolicitudes[0].fecha_propuesta, '2026-08-01T18:00');
  assert.equal(subsolicitudes[1].fecha_propuesta, '2026-08-01T18:00');
  subsolicitudes.forEach((s) => {
    assert.equal(s.fecha_comprometida, '');
    assert.equal(s.fecha_terminada, '');
    assert.equal(s.comprometida_por, '');
  });
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
        { titulo: 'Item 1', descripcion: 'Desc 1', impacto: 'PARCIAL_CON_WORKAROUND', modulo: 'Facturacion', tipo: 'ERR' },
        { titulo: 'Item 2', descripcion: 'Desc 2', impacto: 'PARCIAL_CON_WORKAROUND', modulo: 'Facturacion', tipo: 'ERR' }
      ]
    })
  );

  assert.ok(resultado.resumen_whatsapp.includes('📝 Resumen: 2 items — ver detalle en correo'));
});

// v3.0 (Fase 5): solicitud "sin plataforma" (otro tipo de pedido, se
// clasifica por tipo + area). asociada_plataforma:false relaja la
// obligatoriedad de plataforma (solicitud) y modulo (por item).

test('crearSolicitud (v3.0): sin plataforma asociada NO exige plataforma ni modulo', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({
    asociada_plataforma: false,
    plataforma: '',
    fecha_propuesta: '', // el item de abajo no es P1, no requiere fecha+hora
    subsolicitudes: [
      { titulo: 'Pedido administrativo', descripcion: 'Necesito acceso a la carpeta X', impacto: 'PLANIFICADO', tipo: 'CON' }
    ]
  }));

  assert.match(resultado.solicitud_id, /^SOL-\d{4}-HP-0001$/);
  assert.equal(resultado.estado, 'S01');
  const solicitud = ctx.leerFilas_('SOLICITUDES')[0];
  assert.equal(solicitud.plataforma, '');
  const sub = ctx.leerFilas_('SUBSOLICITUDES')[0];
  assert.equal(sub.modulo, '');
  assert.equal(sub.tipo, 'CON');
});

test('crearSolicitud (v3.0): sin plataforma, el resumen WhatsApp omite Sistema/Modulo', () => {
  const ctx = loadIntakeConSchema();
  const resultado = ctx.Solicitudes.crearSolicitud(datosValidos({
    asociada_plataforma: false,
    plataforma: '',
    fecha_propuesta: '',
    subsolicitudes: [
      { titulo: 'Pedido', descripcion: 'Algo no técnico', impacto: 'PLANIFICADO', tipo: 'CON' }
    ]
  }));

  assert.ok(resultado.resumen_whatsapp.indexOf('💻 Sistema:') === -1);
  assert.ok(resultado.resumen_whatsapp.indexOf('📦 Modulo:') === -1);
  assert.ok(resultado.resumen_whatsapp.indexOf('🏢 Empresa: HP') !== -1);
});

test('crearSolicitud (v3.0): CON plataforma (o sin la bandera) SIGUE exigiendo plataforma y modulo', () => {
  const ctx = loadIntakeConSchema();
  // Sin la bandera (cliente viejo) y sin plataforma -> debe rechazar.
  const sinPlataforma = ctx.Solicitudes.crearSolicitud(datosValidos({ plataforma: '' }));
  assert.equal(sinPlataforma._validationError, true);
  assert.ok(sinPlataforma.fields.some((f) => f.campo === 'plataforma'));

  // asociada_plataforma:true (explicito) sin modulo en el item -> rechaza modulo.
  const sinModulo = ctx.Solicitudes.crearSolicitud(datosValidos({
    asociada_plataforma: true,
    subsolicitudes: [
      { titulo: 'x', descripcion: 'y', impacto: 'PLANIFICADO', tipo: 'ERR' } // sin modulo
    ]
  }));
  assert.equal(sinModulo._validationError, true);
  assert.ok(sinModulo.fields.some((f) => f.campo === 'subsolicitudes[0].modulo'));
});
