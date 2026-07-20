'use strict';

// v4.2 (documentacion/SIGSO-v4.2-propuestas-modulo-jefatura.md): rol
// JEFATURA -- un "Gerencia acotado" al equipo del jefe (JEFATURAS, por
// correo), tanto si la persona a cargo aparece como solicitante como si
// aparece como resolutor. El aislamiento se impone SIEMPRE en el servidor.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'HISTORIAL_COMPROMISO', ctx.COLUMNAS.HISTORIAL_COMPROMISO);
  seedSheet(ctx, 'HISTORIAL_PRIORIDAD', ctx.COLUMNAS.HISTORIAL_PRIORIDAD);
  seedSheet(ctx, 'ARCHIVOS', ctx.COLUMNAS.ARCHIVOS);
  seedSheet(ctx, 'CONFIG_FERIADOS', ctx.COLUMNAS.CONFIG_FERIADOS);
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  seedSheet(ctx, 'JEFATURAS', ctx.COLUMNAS.JEFATURAS);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Vanessa Reyes', 'vanessa@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U2', 'Juan Dominguez', 'juan@rld.cl', 'RLD', 'DEV', true, '', 'sistema'],
    ['U3', 'Lisseth Jefa', 'lisseth@rld.cl', 'RLD', 'JEFATURA', true, '', 'sistema']
  ]);
  return ctx;
}

function seedJefatura(ctx, overrides) {
  const base = Object.assign(
    { jefatura_id: 'JEF-' + Math.random().toString(36).slice(2), jefe_email: 'lisseth@rld.cl', subordinado_email: 'vanessa@rld.cl', activo: true },
    overrides
  );
  const fila = ctx.COLUMNAS.JEFATURAS.map((col) => base[col]);
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('JEFATURAS').appendRow(fila);
  return base;
}

function seedSolicitud(ctx, overrides, subestados) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD', plataforma: 'GDE', plataforma_nombre: 'GDE',
      modulo: 'LIQ', modulo_nombre: 'Liquidaciones', tipo: 'ERR', tipo_nombre: 'Error / Bug',
      solicitante_nombre: 'Vanessa Reyes', solicitante_cargo: 'Analista', solicitante_email: 'vanessa@rld.cl',
      es_cliente: false, estado_derivado: 'S02', prioridad_derivada: 'P2', orden_atencion: '',
      dedup_hash: 'x', estimacion_total_horas: 4, horas_reales: '', observaciones_generales: '',
      resumen_whatsapp: '', fecha_creacion: new Date().toISOString(), creado_por: 'vanessa@rld.cl',
      desarrollador_asignado: '', atencion_directa: false
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SOLICITUDES.map((col) => (base[col] !== undefined ? base[col] : ''));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SOLICITUDES').appendRow(fila);

  (subestados || ['S02']).forEach((estado, idx) => {
    const datosSub = {
      subsolicitud_id: base.solicitud_id + '-0' + (idx + 1), solicitud_id: base.solicitud_id, numero_item: idx + 1,
      titulo: 'Item', descripcion: 'Descripcion', contexto: '', resultado_esperado: '', impacto: '',
      prioridad: base.prioridad_derivada, estado: estado, sla_objetivo_horas: 24, estimacion_horas: '',
      horas_reales: '', fecha_creacion: base.fecha_creacion, desarrollador_asignado: base.desarrollador_asignado,
      tipo: base.tipo, tipo_nombre: base.tipo_nombre, modulo: base.modulo, modulo_nombre: base.modulo_nombre
    };
    const subFila = ctx.COLUMNAS.SUBSOLICITUDES.map((col) => (datosSub[col] !== undefined ? datosSub[col] : ''));
    ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SUBSOLICITUDES').appendRow(subFila);
  });

  return base;
}

// --- aislamiento: el nucleo de lo que se pidio ----------------------------

test('Jefatura.getPanel solo incluye solicitudes de personas a cargo (solicitante o resolutor)', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx, { subordinado_email: 'vanessa@rld.cl' });
  // De mi equipo: Vanessa reporto esta.
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl' });
  // Fuera de mi equipo: ni la reporto ni la resuelve nadie de mi equipo.
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0002', solicitante_email: 'otro@rld.cl', desarrollador_asignado: 'otro-dev@rld.cl' });

  const panel = ctx.Jefatura.getPanel({}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });

  assert.deepEqual(panel.items.map((i) => i.solicitud_id), ['SOL-2026-RLD-0001']);
});

test('Jefatura.getPanel (§0) incluye a la persona a cargo tanto si reporta como si resuelve', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx, { subordinado_email: 'vanessa@rld.cl' });
  seedJefatura(ctx, { jefatura_id: 'JEF-2', subordinado_email: 'juan@rld.cl' });
  // Vanessa reporta, Juan (otro subordinado) la resuelve -- ambos de mi equipo.
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', desarrollador_asignado: 'juan@rld.cl' });

  const panel = ctx.Jefatura.getPanel({}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });

  assert.equal(panel.items.length, 1);
  assert.equal(panel.items[0].persona_solicitante, 'vanessa@rld.cl');
  assert.equal(panel.items[0].persona_resolutor, 'juan@rld.cl');
});

test('Jefatura.getPanel considera la asignacion por ITEM (subsolicitud), no solo la de la solicitud', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'nadie-a-cargo@rld.cl', desarrollador_asignado: ''
  }, ['S02']);
  ctx.actualizarFilaPorId_(ctx.SHEETS.SUBSOLICITUDES, 'subsolicitud_id', 'SOL-2026-RLD-0001-01', {
    desarrollador_asignado: 'vanessa@rld.cl'
  });

  const panel = ctx.Jefatura.getPanel({}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });

  assert.equal(panel.items.length, 1);
  assert.equal(panel.items[0].persona_resolutor, 'vanessa@rld.cl');
});

test('Jefatura.getPanel: un jefe sin equipo (o inactivo) obtiene un panel vacio, no un error', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl' });

  const sinRelaciones = ctx.Jefatura.getPanel({}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  assert.equal(sinRelaciones.items.length, 0);
  assert.equal(sinRelaciones.equipo.length, 0);

  seedJefatura(ctx, { subordinado_email: 'vanessa@rld.cl', activo: false });
  const relacionInactiva = ctx.Jefatura.getPanel({}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });
  assert.equal(relacionInactiva.items.length, 0);
});

test('Jefatura.getPanel excluye atenciones directas (mismo criterio que Gerencia, §1.6)', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', atencion_directa: true }, ['S09']);

  const panel = ctx.Jefatura.getPanel({}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });

  assert.equal(panel.items.length, 0);
});

// --- §2 KPIs ---------------------------------------------------------------

test('Jefatura.getPanel calcula KPIs basicos del equipo', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', estado_derivado: 'S02' }, ['S02']);
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0002', solicitante_email: 'vanessa@rld.cl', estado_derivado: 'S09' }, ['S09']);

  const panel = ctx.Jefatura.getPanel({}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });

  assert.equal(panel.kpis.total_equipo, 2);
  assert.equal(panel.kpis.abiertas, 1);
});

// --- §4 "Hoy en mi departamento" -------------------------------------------

test('Jefatura.getPanel (§4) "hoy" cuenta las nuevas del equipo creadas hoy', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', fecha_creacion: new Date().toISOString() });
  const hace10Dias = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0002', solicitante_email: 'vanessa@rld.cl', fecha_creacion: hace10Dias });

  const panel = ctx.Jefatura.getPanel({}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });

  assert.equal(panel.hoy.resumen.nuevas, 1);
  assert.equal(panel.hoy.nuevas[0].solicitud_id, 'SOL-2026-RLD-0001');
});

test('Jefatura.getPanel (§4) "hoy" cuenta cerradas y avanzadas via HISTORIAL_ESTADOS, una vez por item', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', estado_derivado: 'S09' }, ['S09']);
  const ahora = new Date().toISOString();
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('HISTORIAL_ESTADOS').appendRow([
    'h1', 'SOL-2026-RLD-0001', 'SOL-2026-RLD-0001-01', '', 'S01', 'sistema', '', ahora
  ]);
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('HISTORIAL_ESTADOS').appendRow([
    'h2', 'SOL-2026-RLD-0001', 'SOL-2026-RLD-0001-01', 'S01', 'S02', 'sistema', '', ahora
  ]);
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('HISTORIAL_ESTADOS').appendRow([
    'h3', 'SOL-2026-RLD-0001', 'SOL-2026-RLD-0001-01', 'S02', 'S09', 'sistema', '', ahora
  ]);

  const panel = ctx.Jefatura.getPanel({}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });

  assert.equal(panel.hoy.resumen.avanzaron, 1, 'dos transiciones el mismo dia cuentan como un solo item que avanzo');
  assert.equal(panel.hoy.resumen.cerradas, 1);
});

test('Jefatura.getPanel (§4) "requieren accion" son items ESPERANDO_VALIDACION donde el solicitante es de mi equipo', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl',
    estado_derivado: 'S08', fecha_comprometida: '2020-01-01T18:00'
  }, ['S08']);
  ctx.actualizarFilaPorId_(ctx.SHEETS.SUBSOLICITUDES, 'subsolicitud_id', 'SOL-2026-RLD-0001-01', {
    fecha_comprometida: '2020-01-01T18:00', fecha_terminada: '2020-01-05T10:00:00.000Z'
  });

  const panel = ctx.Jefatura.getPanel({}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });

  assert.equal(panel.hoy.resumen.requieren_accion, 1);
});

// --- §5 por persona ---------------------------------------------------------

test('Jefatura.getPanel (§5) desglosa por cada persona del equipo', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx, { subordinado_email: 'vanessa@rld.cl' });
  seedJefatura(ctx, { jefatura_id: 'JEF-2', subordinado_email: 'juan@rld.cl' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', estado_derivado: 'S02' }, ['S02']);
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0002', solicitante_email: 'otro@rld.cl', desarrollador_asignado: 'juan@rld.cl', estado_derivado: 'S05' }, ['S05']);

  const panel = ctx.Jefatura.getPanel({}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });

  const vanessa = panel.por_persona.find((p) => p.email === 'vanessa@rld.cl');
  const juan = panel.por_persona.find((p) => p.email === 'juan@rld.cl');
  assert.equal(vanessa.solicitadas_total, 1);
  assert.equal(juan.asignadas_total, 1);
  assert.equal(juan.nombre, 'Juan Dominguez');
});

// --- §6 carga ---------------------------------------------------------------

test('Jefatura.getPanel (§6) agrupa la carga del equipo por modulo y tipo', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl',
    modulo_nombre: 'Liquidaciones', tipo_nombre: 'Error / Bug'
  });
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-RLD-0002', solicitante_email: 'vanessa@rld.cl',
    modulo_nombre: 'Liquidaciones', tipo_nombre: 'Error / Bug'
  });

  const panel = ctx.Jefatura.getPanel({}, { email: 'lisseth@rld.cl', rol: 'JEFATURA' });

  assert.equal(panel.carga.por_modulo[0].etiqueta, 'Liquidaciones');
  assert.equal(panel.carga.por_modulo[0].cantidad, 2);
});

// --- guardia de acceso al detalle (getDetalle) ------------------------------

test('Solicitudes.getDetalle: Jefatura SI puede abrir el detalle de una solicitud de su equipo, de solo lectura', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl' });

  const detalle = ctx.Solicitudes.getDetalle('SOL-2026-RLD-0001', { email: 'lisseth@rld.cl', rol: 'JEFATURA' });

  assert.equal(detalle._forbidden, undefined);
  assert.equal(detalle.solicitud.solicitud_id, 'SOL-2026-RLD-0001');
  assert.equal(detalle.responsables.length, 0);
  assert.equal(detalle.transiciones_por_subsolicitud['SOL-2026-RLD-0001-01'].length, 0);
});

test('Solicitudes.getDetalle: Jefatura NO puede abrir el detalle de una solicitud fuera de su equipo', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'otro@rld.cl', desarrollador_asignado: 'otro-dev@rld.cl' });

  const detalle = ctx.Solicitudes.getDetalle('SOL-2026-RLD-0001', { email: 'lisseth@rld.cl', rol: 'JEFATURA' });

  assert.equal(detalle._forbidden, true);
});

// --- CRUD de JEFATURAS (solo ADM) -------------------------------------------

test('Jefatura.gestionar (crear): rechaza si quien pide no es ADM', () => {
  const ctx = loadConSchema();
  const resultado = ctx.Jefatura.gestionar(
    { operacion: 'crear', jefe_email: 'lisseth@rld.cl', subordinado_email: 'vanessa@rld.cl' },
    { rol: 'JEFATURA', email: 'lisseth@rld.cl' }
  );
  assert.equal(resultado._forbidden, true);
});

test('Jefatura.gestionar (crear): ADM crea la relacion, rechaza duplicados y auto-jefatura', () => {
  const ctx = loadConSchema();
  const creada = ctx.Jefatura.gestionar(
    { operacion: 'crear', jefe_email: 'Lisseth@RLD.cl', subordinado_email: 'Vanessa@RLD.cl' },
    { rol: 'ADM', email: 'admin@rld.cl' }
  );
  assert.equal(creada.jefe_email, 'lisseth@rld.cl', 'normaliza a minusculas');

  const duplicada = ctx.Jefatura.gestionar(
    { operacion: 'crear', jefe_email: 'lisseth@rld.cl', subordinado_email: 'vanessa@rld.cl' },
    { rol: 'ADM', email: 'admin@rld.cl' }
  );
  assert.equal(duplicada._validationError, true);

  const autoJefatura = ctx.Jefatura.gestionar(
    { operacion: 'crear', jefe_email: 'x@rld.cl', subordinado_email: 'x@rld.cl' },
    { rol: 'ADM', email: 'admin@rld.cl' }
  );
  assert.equal(autoJefatura._validationError, true);
});

test('Jefatura.gestionar (eliminar/activar): ADM puede desactivar y eliminar una relacion', () => {
  const ctx = loadConSchema();
  const jefatura = seedJefatura(ctx, {});

  const desactivada = ctx.Jefatura.gestionar(
    { operacion: 'activar', jefatura_id: jefatura.jefatura_id, activo: false },
    { rol: 'ADM', email: 'admin@rld.cl' }
  );
  assert.equal(desactivada.activo, false);

  const eliminada = ctx.Jefatura.gestionar(
    { operacion: 'eliminar', jefatura_id: jefatura.jefatura_id },
    { rol: 'ADM', email: 'admin@rld.cl' }
  );
  assert.equal(eliminada.eliminada, true);
  assert.equal(ctx.leerFilas_('JEFATURAS').length, 0);
});

// --- v4.2 (§4) digest diario por correo -------------------------------------

test('Notificaciones.enviarDigestJefatura manda un correo por jefe con novedades hoy', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedJefatura(ctx, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', fecha_creacion: new Date().toISOString() });

  const resultados = ctx.Notificaciones.enviarDigestJefatura();

  assert.equal(resultados[0].enviado, true);
  assert.equal(ctx.GmailApp._enviados.length, 1);
  assert.equal(ctx.GmailApp._enviados[0].destinatario, 'lisseth@rld.cl');
  assert.ok(ctx.GmailApp._enviados[0].cuerpo.indexOf('SOL-2026-RLD-0001') !== -1);
});

test('Notificaciones.enviarDigestJefatura NO manda correo si el jefe no tuvo ninguna novedad hoy', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedJefatura(ctx, { subordinado_email: 'vanessa@rld.cl' });
  // Solicitud vieja, sin transiciones ni riesgos hoy.
  seedSolicitud(ctx, {
    solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl',
    fecha_creacion: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(), estado_derivado: 'S02'
  }, ['S02']);

  const resultados = ctx.Notificaciones.enviarDigestJefatura();

  assert.equal(resultados[0].enviado, false);
  assert.equal(resultados[0].motivo, 'sin_novedades');
  assert.equal(ctx.GmailApp._enviados.length, 0);
});

// --- v4.1.1: Jefatura tambien queda auto-acotada en "Bandeja de trabajo" ---
// (mismo hallazgo real que Gerencia -- ver dashboard.test.js) -- se prueba
// aca de nuevo porque JEFATURA es un rol nuevo, no cubierto por esos tests.

test('Dashboard.getData: JEFATURA en "Bandeja de trabajo" solo ve lo asignado a su propio correo (no a su equipo)', () => {
  const ctx = loadConSchema();
  seedJefatura(ctx, { subordinado_email: 'vanessa@rld.cl' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-RLD-0001', solicitante_email: 'vanessa@rld.cl', desarrollador_asignado: 'vanessa@rld.cl' }, ['S02']);

  const datos = ctx.Dashboard.getData({}, { rol: 'JEFATURA', email: 'lisseth@rld.cl' });

  assert.equal(datos.recientes.length, 0, '"Bandeja de trabajo" no es "Mi departamento" -- se ve desde el Panel de Jefatura');
});
