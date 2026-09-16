'use strict';

/**
 * Prueba de portabilidad: los MISMOS escenarios de backend/test/
 * solicitudes.test.js (crearSolicitud, el nucleo del helpdesk), corridos
 * contra backend/logica/solicitudes.js (Node + SQLite) en vez del .gs.
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

function seed(db, hoja, filas) {
  sembrarTabla_(db, hoja, COLUMNAS[hoja], filas);
}

function filas(db, hoja) {
  return leerFilas_(db, hoja, COLUMNAS[hoja]);
}

function datosValidos(overrides) {
  return Object.assign(
    {
      empresa_id: 'HP', plataforma: 'ERP', es_cliente: false,
      solicitante_nombre: 'Juan Perez', solicitante_cargo: 'Jefe de Operaciones',
      solicitante_email: 'juan.perez@homepymes.cl',
      fecha_propuesta: '2026-08-01T18:00',
      subsolicitudes: [
        { titulo: 'No cargan las facturas', descripcion: 'La pantalla queda en blanco', impacto: 'SISTEMA_CAIDO', modulo: 'Facturacion', tipo: 'ERR' }
      ]
    },
    overrides
  );
}

test('crearSolicitud escribe SOLICITUDES, SUBSOLICITUDES e HISTORIAL_ESTADOS y responde S01', () => {
  const db = dbConSchema();
  const resultado = Solicitudes.crearSolicitud(db, datosValidos());

  assert.match(resultado.solicitud_id, /^SOL-\d{4}-HP-0001$/);
  assert.equal(resultado.estado, 'S01');
  assert.ok(resultado.resumen_whatsapp.includes(resultado.solicitud_id));

  const solicitudes = filas(db, 'SOLICITUDES');
  const subsolicitudes = filas(db, 'SUBSOLICITUDES');
  const historial = filas(db, 'HISTORIAL_ESTADOS');

  assert.equal(solicitudes.length, 1);
  assert.equal(solicitudes[0].prioridad_derivada, 'P1');
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
  const db = dbConSchema();
  const resultado = Solicitudes.crearSolicitud(db, datosValidos({
    empresa_id: '',
    subsolicitudes: [{ titulo: 'x', descripcion: 'y', impacto: 'SISTEMA_CAIDO', modulo: 'Facturacion', tipo: '' }]
  }));

  assert.equal(resultado._validationError, true);
  const campos = resultado.fields.map((f) => f.campo);
  assert.ok(campos.includes('empresa_id'));
  assert.ok(campos.includes('subsolicitudes[0].tipo'));
});

test('crearSolicitud exige tipo y modulo por item (RN-002, Fase 10)', () => {
  const db = dbConSchema();
  const resultado = Solicitudes.crearSolicitud(db, datosValidos({
    subsolicitudes: [{ titulo: 'x', descripcion: 'y', impacto: 'SISTEMA_CAIDO' }]
  }));

  assert.equal(resultado._validationError, true);
  const campos = resultado.fields.map((f) => f.campo);
  assert.ok(campos.includes('subsolicitudes[0].tipo'));
  assert.ok(campos.includes('subsolicitudes[0].modulo'));
});

test('crearSolicitud exige al menos una subsolicitud con titulo y descripcion (RN-004)', () => {
  const db = dbConSchema();
  const resultado = Solicitudes.crearSolicitud(db, datosValidos({ subsolicitudes: [] }));

  assert.equal(resultado._validationError, true);
  assert.ok(resultado.fields.some((f) => f.campo === 'subsolicitudes'));
});

test('crearSolicitud exige datos de cliente cuando es_cliente=true (RN-005)', () => {
  const db = dbConSchema();
  const resultado = Solicitudes.crearSolicitud(db, datosValidos({ es_cliente: true }));

  assert.equal(resultado._validationError, true);
  const campos = resultado.fields.map((f) => f.campo);
  assert.ok(campos.includes('empresa_cliente'));
  assert.ok(campos.includes('contacto_cliente'));
  assert.ok(campos.includes('correo_cliente'));
});

test('crearSolicitud detecta un duplicado abierto sin bloquear la creacion (RF-F06)', () => {
  const db = dbConSchema();
  const primero = Solicitudes.crearSolicitud(db, datosValidos());
  const segundo = Solicitudes.crearSolicitud(db, datosValidos());

  assert.ok(!primero.posible_duplicado);
  assert.equal(segundo.posible_duplicado.solicitud_id, primero.solicitud_id);
  assert.notEqual(segundo.solicitud_id, primero.solicitud_id);
});

test('derivarPrioridad_ aplica la tabla de impacto (RN-006) y P4 por defecto', () => {
  assert.equal(Solicitudes.derivarPrioridad_('SISTEMA_CAIDO'), 'P1');
  assert.equal(Solicitudes.derivarPrioridad_('PERDIDA_DATOS'), 'P1');
  assert.equal(Solicitudes.derivarPrioridad_('BLOQUEO_OPERATIVO'), 'P1');
  assert.equal(Solicitudes.derivarPrioridad_('DEGRADACION_IMPORTANTE'), 'P2');
  assert.equal(Solicitudes.derivarPrioridad_('PARCIAL_CON_WORKAROUND'), 'P3');
  assert.equal(Solicitudes.derivarPrioridad_('PLANIFICADO'), 'P5');
  assert.equal(Solicitudes.derivarPrioridad_(undefined), 'P4');
  assert.equal(Solicitudes.derivarPrioridad_('ALGO_DESCONOCIDO'), 'P4');
});

test('derivarPrioridad_ (P2): con esUrgente=true, nunca baja de P2 -- pero un impacto P1 sigue ganando', () => {
  assert.equal(Solicitudes.derivarPrioridad_('PLANIFICADO', true), 'P2');
  assert.equal(Solicitudes.derivarPrioridad_('PARCIAL_CON_WORKAROUND', true), 'P2');
  assert.equal(Solicitudes.derivarPrioridad_('DEGRADACION_IMPORTANTE', true), 'P2');
  assert.equal(Solicitudes.derivarPrioridad_('SISTEMA_CAIDO', true), 'P1');
  assert.equal(Solicitudes.derivarPrioridad_(undefined, true), 'P2');
  assert.equal(Solicitudes.derivarPrioridad_('PLANIFICADO', false), 'P5');
});

test('crearSolicitud (P2): un tipo con es_urgente=true en CAT_TIPOS sube la prioridad a P2 aunque el impacto sea bajo', () => {
  const db = dbConSchema();
  seed(db, 'CAT_TIPOS', [['ERR', 'Error / Bug', 'P2', true, true], ['MEJ', 'Mejora', 'P3', true, false]]);

  Solicitudes.crearSolicitud(db, datosValidos({
    subsolicitudes: [{ titulo: 'Idea nueva', descripcion: 'seria bueno tener esto', impacto: 'PLANIFICADO', modulo: 'Facturacion', tipo: 'ERR' }]
  }));

  assert.equal(filas(db, 'SUBSOLICITUDES')[0].prioridad, 'P2');
  assert.equal(filas(db, 'SOLICITUDES')[0].prioridad_derivada, 'P2');
});

test('crearSolicitud (P2): un tipo con es_urgente=false NO sube la prioridad -- sigue derivandose solo del impacto', () => {
  const db = dbConSchema();
  seed(db, 'CAT_TIPOS', [['MEJ', 'Mejora', 'P3', true, false]]);

  Solicitudes.crearSolicitud(db, datosValidos({
    subsolicitudes: [{ titulo: 'Idea nueva', descripcion: 'seria bueno tener esto', impacto: 'PLANIFICADO', modulo: 'Facturacion', tipo: 'MEJ' }]
  }));

  assert.equal(filas(db, 'SUBSOLICITUDES')[0].prioridad, 'P5');
});

test('crearSolicitud (P12) NO avisa a Leo si AVISO_LEO esta desactivado, aunque sea P1', () => {
  const db = dbConSchema();
  seed(db, 'CONFIG_NOTIFICACIONES', [['AVISO_LEO', 'AVISO_DESARROLLO', '', '', false]]);

  Solicitudes.crearSolicitud(db, datosValidos());

  const avisos = filas(db, 'LOG_NOTIFICACIONES').filter((n) => n.evento === 'AVISO_DESARROLLO');
  assert.equal(avisos.length, 0);
});

test('crearSolicitud (P12) SI avisa a Leo si no existe el registro AVISO_LEO (compatibilidad hacia atras)', () => {
  const db = dbConSchema();

  Solicitudes.crearSolicitud(db, datosValidos());

  const avisos = filas(db, 'LOG_NOTIFICACIONES').filter((n) => n.evento === 'AVISO_DESARROLLO');
  assert.equal(avisos.length, 1);
});

test('crearSolicitud (P2): toda solicitud de cliente sube a P2 aunque el tipo no sea urgente (RN-005/P4 formalizado)', () => {
  const db = dbConSchema();
  seed(db, 'CAT_TIPOS', [['MEJ', 'Mejora', 'P3', true, false]]);

  Solicitudes.crearSolicitud(db, datosValidos({
    es_cliente: true, empresa_cliente: 'Constructora X', contacto_cliente: 'Ana', correo_cliente: 'ana@constructorax.cl',
    subsolicitudes: [{ titulo: 'Idea nueva', descripcion: 'pedido de cliente', impacto: 'PLANIFICADO', modulo: 'Facturacion', tipo: 'MEJ' }]
  }));

  assert.equal(filas(db, 'SUBSOLICITUDES')[0].prioridad, 'P2');
});

test('la prioridad_derivada del padre es la mas critica entre sus subsolicitudes', () => {
  const db = dbConSchema();
  const resultado = Solicitudes.crearSolicitud(db, datosValidos({
    subsolicitudes: [
      { titulo: 'Item menor', descripcion: 'algo parcial', impacto: 'PARCIAL_CON_WORKAROUND', modulo: 'Facturacion', tipo: 'ERR' },
      { titulo: 'Item critico', descripcion: 'todo caido', impacto: 'SISTEMA_CAIDO', modulo: 'Facturacion', tipo: 'ERR' }
    ]
  }));

  assert.equal(resultado.estado, 'S01');
  assert.equal(filas(db, 'SOLICITUDES')[0].prioridad_derivada, 'P1');
});

test('crearSolicitud exige el cargo del solicitante (RF-001, v1.0)', () => {
  const db = dbConSchema();
  const resultado = Solicitudes.crearSolicitud(db, datosValidos({ solicitante_cargo: '' }));

  assert.equal(resultado._validationError, true);
  assert.ok(resultado.fields.some((f) => f.campo === 'solicitante_cargo'));
});

test('crearSolicitud guarda los campos ampliados de v1.0 (cargo, cliente, subsolicitud)', () => {
  const db = dbConSchema();
  Solicitudes.crearSolicitud(db, datosValidos({
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
  }));

  const solicitud = filas(db, 'SOLICITUDES')[0];
  assert.equal(solicitud.solicitante_cargo, 'Jefe de Operaciones');
  assert.equal(solicitud.cliente_mandante, 'Mandante SA');
  assert.equal(solicitud.cliente_obra, 'Obra Norte');
  assert.equal(solicitud.telefono_cliente, '+56911111111');
  assert.equal(solicitud.urgencia_cliente, 'Alta');
  assert.equal(solicitud.observaciones_generales, 'Urgente para el cliente');

  const subsolicitud = filas(db, 'SUBSOLICITUDES')[0];
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
  const db = dbConSchema();
  Solicitudes.crearSolicitud(db, datosValidos({
    es_cliente: true,
    empresa_cliente: 'Alfacorp SpA', contacto_cliente: 'Manuel Alfaro',
    correo_cliente: 'contacto.alfacorp1@gmail.com', telefono_cliente: '955309287',
    rut_cliente: '76.897.217-6', codigo_cliente: 'HP-013-1',
    subsolicitudes: [{ titulo: 'T', descripcion: 'D', impacto: 'SISTEMA_CAIDO', modulo: 'Facturacion', tipo: 'ERR' }]
  }));
  const solicitud = filas(db, 'SOLICITUDES')[0];
  assert.equal(solicitud.rut_cliente, '76.897.217-6');
  assert.equal(solicitud.codigo_cliente, 'HP-013-1');
});

test('crearSolicitud deja rut_cliente/codigo_cliente vacios en solicitud interna (sin cliente)', () => {
  const db = dbConSchema();
  Solicitudes.crearSolicitud(db, datosValidos({}));
  const solicitud = filas(db, 'SOLICITUDES')[0];
  assert.equal(solicitud.rut_cliente, '');
  assert.equal(solicitud.codigo_cliente, '');
});

test('crearSolicitud guarda cc y urls_adicionales (Fase 9, hallazgo de datos reales)', () => {
  const db = dbConSchema();
  Solicitudes.crearSolicitud(db, datosValidos({
    cc: 'copia@empresa.cl',
    subsolicitudes: [{
      titulo: 'Titulo', descripcion: 'Desc', impacto: 'PLANIFICADO',
      modulo: 'Facturacion', tipo: 'ERR', url_modulo: 'https://x.cl/principal',
      urls_adicionales: [
        { titulo: 'Modal de validacion', url: 'https://x.cl/validacion' },
        { titulo: 'Documento generado', url: 'https://x.cl/doc' }
      ],
      ref_credencial: 'Ver gestor de credenciales #123'
    }]
  }));

  const solicitud = filas(db, 'SOLICITUDES')[0];
  assert.equal(solicitud.cc, 'copia@empresa.cl');

  const subsolicitud = filas(db, 'SUBSOLICITUDES')[0];
  assert.equal(subsolicitud.ref_credencial, 'Ver gestor de credenciales #123');
  assert.deepEqual(JSON.parse(subsolicitud.urls_adicionales), [
    { titulo: 'Modal de validacion', url: 'https://x.cl/validacion' },
    { titulo: 'Documento generado', url: 'https://x.cl/doc' }
  ]);
});

test('crearSolicitud guarda tipo/modulo por item, frecuencia/personas_afectadas e imagen_descripciones (Fase 10)', () => {
  const db = dbConSchema();
  seed(db, 'CAT_TIPOS', [['ERR', 'Error / Bug', 'P2', true], ['MEJ', 'Mejora', 'P3', true]]);
  seed(db, 'CAT_MODULOS', [
    ['Facturacion', 'Facturacion Electronica', 'ERP', '', true],
    ['Reportes', 'Reportes', 'ERP', '', true]
  ]);

  Solicitudes.crearSolicitud(db, datosValidos({
    subsolicitudes: [
      {
        titulo: 'Item 1', descripcion: 'Desc 1', impacto: 'SISTEMA_CAIDO', modulo: 'Facturacion', tipo: 'ERR',
        frecuencia: 'SIEMPRE', personas_afectadas: 12, imagen_descripciones: ['Pantalla en blanco', 'Consola con el error']
      },
      {
        titulo: 'Item 2', descripcion: 'Desc 2', impacto: 'PLANIFICADO', modulo: 'Reportes', tipo: 'MEJ',
        frecuencia: 'A_VECES', personas_afectadas: 3
      }
    ]
  }));

  const subsolicitudes = filas(db, 'SUBSOLICITUDES');
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

  const solicitud = filas(db, 'SOLICITUDES')[0];
  assert.equal(solicitud.modulo, 'Facturacion');
  assert.equal(solicitud.modulo_nombre, 'Facturacion Electronica');
  assert.equal(solicitud.tipo, 'ERR');
  assert.equal(solicitud.tipo_nombre, 'Error / Bug');
});

test('crearSolicitud rechaza un cc con formato de correo invalido', () => {
  const db = dbConSchema();
  const resultado = Solicitudes.crearSolicitud(db, datosValidos({ cc: 'no-es-un-correo' }));

  assert.equal(resultado._validationError, true);
  assert.ok(resultado.fields.some((f) => f.campo === 'cc'));
});

test('crearSolicitud (v2.1) exige fecha+hora propuesta cuando el impacto deriva P1', () => {
  const db = dbConSchema();
  const resultado = Solicitudes.crearSolicitud(db, datosValidos({ fecha_propuesta: '' }));

  assert.equal(resultado._validationError, true);
  assert.ok(resultado.fields.some((f) => f.campo === 'fecha_propuesta'));
});

test('crearSolicitud (v2.1) exige fecha+hora propuesta cuando es_cliente=true, aunque el impacto no sea P1', () => {
  const db = dbConSchema();
  const resultado = Solicitudes.crearSolicitud(db, datosValidos({
    es_cliente: true, empresa_cliente: 'Constructora X', contacto_cliente: 'Ana', correo_cliente: 'ana@constructorax.cl',
    fecha_propuesta: '',
    subsolicitudes: [{ titulo: 'x', descripcion: 'y', impacto: 'PLANIFICADO', modulo: 'Facturacion', tipo: 'ERR' }]
  }));

  assert.equal(resultado._validationError, true);
  assert.ok(resultado.fields.some((f) => f.campo === 'fecha_propuesta'));
});

test('crearSolicitud (v2.1) rechaza fecha propuesta SIN hora cuando se requiere (cliente/P1)', () => {
  const db = dbConSchema();
  const resultado = Solicitudes.crearSolicitud(db, datosValidos({ fecha_propuesta: '2026-08-01' }));

  assert.equal(resultado._validationError, true);
  assert.ok(resultado.fields.some((f) => f.campo === 'fecha_propuesta'));
});

test('crearSolicitud (v2.1) NO exige fecha propuesta cuando no es cliente ni P1 (es opcional)', () => {
  const db = dbConSchema();
  const resultado = Solicitudes.crearSolicitud(db, datosValidos({
    fecha_propuesta: '',
    subsolicitudes: [{ titulo: 'x', descripcion: 'y', impacto: 'PLANIFICADO', modulo: 'Facturacion', tipo: 'ERR' }]
  }));

  assert.equal(resultado._validationError, undefined);
});

test('crearSolicitud (v2.1) acepta solo fecha (sin hora) cuando la propuesta es opcional', () => {
  const db = dbConSchema();
  const resultado = Solicitudes.crearSolicitud(db, datosValidos({
    fecha_propuesta: '2026-08-01',
    subsolicitudes: [{ titulo: 'x', descripcion: 'y', impacto: 'PLANIFICADO', modulo: 'Facturacion', tipo: 'ERR' }]
  }));

  assert.equal(resultado._validationError, undefined);
  assert.equal(filas(db, 'SUBSOLICITUDES')[0].fecha_propuesta, '2026-08-01');
});

test('crearSolicitud (v2.1) replica fecha_propuesta en cada item y deja fecha_comprometida/fecha_terminada/comprometida_por vacias', () => {
  const db = dbConSchema();
  Solicitudes.crearSolicitud(db, datosValidos({
    subsolicitudes: [
      { titulo: 'Item 1', descripcion: 'Desc 1', impacto: 'SISTEMA_CAIDO', modulo: 'Facturacion', tipo: 'ERR' },
      { titulo: 'Item 2', descripcion: 'Desc 2', impacto: 'PLANIFICADO', modulo: 'Facturacion', tipo: 'ERR' }
    ]
  }));

  const subsolicitudes = filas(db, 'SUBSOLICITUDES');
  assert.equal(subsolicitudes[0].fecha_propuesta, '2026-08-01T18:00');
  assert.equal(subsolicitudes[1].fecha_propuesta, '2026-08-01T18:00');
  subsolicitudes.forEach((s) => {
    assert.equal(s.fecha_comprometida, '');
    assert.equal(s.fecha_terminada, '');
    assert.equal(s.comprometida_por, '');
  });
});

test('generarResumenWhatsapp_ sigue el formato de RF-015 con un solo item', () => {
  const db = dbConSchema();
  const resultado = Solicitudes.crearSolicitud(db, datosValidos());

  const lineas = resultado.resumen_whatsapp.split('\n');
  assert.match(lineas[0], /^📋 SOLICITUD N° SOL-/);
  assert.match(lineas[1], /^🔴 PRIORIDAD: Critica$/);
  assert.equal(lineas[2], '🏢 Empresa: HP');
  assert.equal(lineas[3], '💻 Sistema: ERP');
  assert.equal(lineas[6], '📝 Resumen: La pantalla queda en blanco');
});

test('crearSolicitud guarda los nombres desnormalizados de los catalogos (§13.2 v1.0)', () => {
  const db = dbConSchema();
  seed(db, 'CAT_EMPRESAS', [['HP', 'HomePymes', '', true]]);
  seed(db, 'CAT_PLATAFORMAS', [['ERP', 'Sistema ERP', 'HP', '', true]]);
  seed(db, 'CAT_MODULOS', [['Facturacion', 'Facturacion Electronica', 'ERP', '', true]]);
  seed(db, 'CAT_TIPOS', [['ERR', 'Error / Bug', 'P2', true]]);

  Solicitudes.crearSolicitud(db, datosValidos());

  const solicitud = filas(db, 'SOLICITUDES')[0];
  assert.equal(solicitud.empresa_nombre, 'HomePymes');
  assert.equal(solicitud.plataforma_nombre, 'Sistema ERP');
  assert.equal(solicitud.modulo_nombre, 'Facturacion Electronica');
  assert.equal(solicitud.tipo_nombre, 'Error / Bug');
});

test('crearSolicitud no falla si los catalogos aun no existen (nombre desnormalizado queda vacio)', () => {
  const db = abrirDb_();
  // A proposito NO se siembran CAT_* -- solo lo minimo que crearSolicitud necesita.
  ['SOLICITUDES', 'SUBSOLICITUDES', 'HISTORIAL_ESTADOS', 'COUNTERS', 'LOG_NOTIFICACIONES', 'CONFIG_NOTIFICACIONES'].forEach((h) =>
    sembrarTabla_(db, h, COLUMNAS[h], []));
  sembrarTabla_(db, 'CONFIG_SLA', COLUMNAS.CONFIG_SLA, [['P1', 2]]);

  const resultado = Solicitudes.crearSolicitud(db, datosValidos());

  assert.ok(resultado.solicitud_id);
  const solicitud = filas(db, 'SOLICITUDES')[0];
  assert.equal(solicitud.empresa_nombre, '');
});

test('generarResumenWhatsapp_ indica la cantidad de items en vez de listarlos (RF-F07)', () => {
  const db = dbConSchema();
  const resultado = Solicitudes.crearSolicitud(db, datosValidos({
    subsolicitudes: [
      { titulo: 'Item 1', descripcion: 'Desc 1', impacto: 'PARCIAL_CON_WORKAROUND', modulo: 'Facturacion', tipo: 'ERR' },
      { titulo: 'Item 2', descripcion: 'Desc 2', impacto: 'PARCIAL_CON_WORKAROUND', modulo: 'Facturacion', tipo: 'ERR' }
    ]
  }));

  assert.ok(resultado.resumen_whatsapp.includes('📝 Resumen: 2 items — ver detalle en correo'));
});

test('crearSolicitud (v3.0): sin plataforma asociada NO exige plataforma ni modulo', () => {
  const db = dbConSchema();
  const resultado = Solicitudes.crearSolicitud(db, datosValidos({
    asociada_plataforma: false, plataforma: '', fecha_propuesta: '',
    subsolicitudes: [{ titulo: 'Pedido administrativo', descripcion: 'Necesito acceso a la carpeta X', impacto: 'PLANIFICADO', tipo: 'CON' }]
  }));

  assert.match(resultado.solicitud_id, /^SOL-\d{4}-HP-0001$/);
  assert.equal(resultado.estado, 'S01');
  const solicitud = filas(db, 'SOLICITUDES')[0];
  assert.equal(solicitud.plataforma, '');
  const sub = filas(db, 'SUBSOLICITUDES')[0];
  assert.equal(sub.modulo, '');
  assert.equal(sub.tipo, 'CON');
});

test('crearSolicitud (v3.0): sin plataforma, el resumen WhatsApp omite Sistema/Modulo', () => {
  const db = dbConSchema();
  const resultado = Solicitudes.crearSolicitud(db, datosValidos({
    asociada_plataforma: false, plataforma: '', fecha_propuesta: '',
    subsolicitudes: [{ titulo: 'Pedido', descripcion: 'Algo no técnico', impacto: 'PLANIFICADO', tipo: 'CON' }]
  }));

  assert.ok(resultado.resumen_whatsapp.indexOf('💻 Sistema:') === -1);
  assert.ok(resultado.resumen_whatsapp.indexOf('📦 Modulo:') === -1);
  assert.ok(resultado.resumen_whatsapp.indexOf('🏢 Empresa: HP') !== -1);
});

test('crearSolicitud (v3.0): CON plataforma (o sin la bandera) SIGUE exigiendo plataforma y modulo', () => {
  const db = dbConSchema();
  const sinPlataforma = Solicitudes.crearSolicitud(db, datosValidos({ plataforma: '' }));
  assert.equal(sinPlataforma._validationError, true);
  assert.ok(sinPlataforma.fields.some((f) => f.campo === 'plataforma'));

  const sinModulo = Solicitudes.crearSolicitud(db, datosValidos({
    asociada_plataforma: true,
    subsolicitudes: [{ titulo: 'x', descripcion: 'y', impacto: 'PLANIFICADO', tipo: 'ERR' }]
  }));
  assert.equal(sinModulo._validationError, true);
  assert.ok(sinModulo.fields.some((f) => f.campo === 'subsolicitudes[0].modulo'));
});
