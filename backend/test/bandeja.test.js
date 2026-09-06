'use strict';

// v3.0 (Fase 2, documentacion/SIGSO-v3.0-multi-responsable-y-control.md §5):
// bandeja por responsable. Un responsable individual (DEV) ve SIEMPRE solo
// lo suyo (sin importar otros filtros); ADM ve todo por defecto y puede
// elegir una bandeja puntual con el filtro "verBandeja".
//
// v4.1.1 (hallazgo real, ver dashboard.test.js): GERENCIA dejo de estar en
// el grupo "ve todo por defecto" -- ahora queda auto-acotada a su propia
// bandeja igual que cualquier otro rol que no sea ADM, e ignora
// "verBandeja" (ese selector ya no se le ofrece). Gerencia sigue viendo
// todas las solicitudes desde el Panel de Gerencia (Gerencia.getPanel).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'SOLICITUDES', ctx.COLUMNAS.SOLICITUDES);
  seedSheet(ctx, 'SUBSOLICITUDES', ctx.COLUMNAS.SUBSOLICITUDES);
  seedSheet(ctx, 'HISTORIAL_ESTADOS', ctx.COLUMNAS.HISTORIAL_ESTADOS);
  seedSheet(ctx, 'CONFIG_FERIADOS', ctx.COLUMNAS.CONFIG_FERIADOS);
  seedSheet(ctx, 'COMENTARIOS', ctx.COLUMNAS.COMENTARIOS);
  // Hasta ahora este arnes solo LEIA la bandeja y con esas hojas bastaba. Los
  // tests de escritura de mas abajo llegan hasta el aviso del cambio, que
  // necesita esta. Se agrega SOLO esta: probe a sembrar tambien USUARIOS y
  // rompi dos tests de aqui mismo -- uno comprueba justamente que la bandeja
  // aguante SIN esa hoja. El arnes compartido se toca lo minimo.
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  return ctx;
}

function seedSolicitud(ctx, overrides) {
  const base = Object.assign(
    {
      solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', plataforma: 'ERP', modulo: 'Facturacion',
      tipo: 'ERR', solicitante_nombre: 'Juan', solicitante_cargo: 'Analista', solicitante_email: 'juan@homepymes.cl',
      estado_derivado: 'S05', prioridad_derivada: 'P2', dedup_hash: 'x',
      estimacion_total_horas: 4, fecha_creacion: new Date().toISOString(), creado_por: 'juan@homepymes.cl'
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SOLICITUDES.map((col) => (base[col] !== undefined ? base[col] : ''));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SOLICITUDES').appendRow(fila);
  return base;
}

function seedSubsolicitud(ctx, overrides) {
  const base = Object.assign(
    {
      subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001', numero_item: 1,
      titulo: 't', descripcion: 'd', prioridad: 'P2', estado: 'S05',
      sla_objetivo_horas: 24, fecha_creacion: new Date().toISOString()
    },
    overrides
  );
  const fila = ctx.COLUMNAS.SUBSOLICITUDES.map((col) => (base[col] !== undefined ? base[col] : ''));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SUBSOLICITUDES').appendRow(fila);
  return base;
}

test('Dashboard.getData (v3.0): un DEV ve solo su bandeja aunque ademas filtre por estado', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'dev@homepymes.cl', estado_derivado: 'S05' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001', estado: 'S05' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0002', desarrollador_asignado: 'otro@homepymes.cl', estado_derivado: 'S05' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0002-01', solicitud_id: 'SOL-2026-HP-0002', estado: 'S05' });

  // Antes del fix, agregar un filtro de estado cancelaba el auto-scope del
  // DEV y le dejaba ver TODAS las solicitudes de ese estado.
  const datos = ctx.Dashboard.getData({ estado: 'S05' }, { rol: 'DEV', email: 'dev@homepymes.cl' });

  const ids = datos.recientes.map((r) => r.solicitud_id);
  assert.deepEqual(ids, ['SOL-2026-HP-0001']);
});

test('Dashboard.getData (v3.0): ADM ve todo por defecto (sin bandeja elegida)', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'dev1@homepymes.cl' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0002', desarrollador_asignado: 'dev2@homepymes.cl' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0002-01', solicitud_id: 'SOL-2026-HP-0002' });

  const datos = ctx.Dashboard.getData({}, { rol: 'ADM', email: 'admin@homepymes.cl' });

  assert.equal(datos.recientes.length, 2);
});

test('Dashboard.getData (v3.0): ADM elige "verBandeja" y ve solo esa persona', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'dev1@homepymes.cl' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001' });
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0002', desarrollador_asignado: 'dev2@homepymes.cl' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0002-01', solicitud_id: 'SOL-2026-HP-0002' });

  const datos = ctx.Dashboard.getData({ verBandeja: 'dev2@homepymes.cl' }, { rol: 'ADM', email: 'admin@homepymes.cl' });

  const ids = datos.recientes.map((r) => r.solicitud_id);
  assert.deepEqual(ids, ['SOL-2026-HP-0002']);
});

// v4.1.1: GERENCIA ya NO puede elegir "verBandeja" -- queda siempre
// auto-acotada a su propia bandeja, aunque mande ese filtro explicitamente
// (el selector que lo generaba tampoco se le ofrece mas, ver dashboard.js).
test('Dashboard.getData (v4.1.1): GERENCIA ignora "verBandeja" -- siempre ve solo la suya', () => {
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0001', desarrollador_asignado: 'dev1@homepymes.cl' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0001-01', solicitud_id: 'SOL-2026-HP-0001' });

  const datos = ctx.Dashboard.getData({ verBandeja: 'dev1@homepymes.cl' }, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });

  assert.equal(datos.recientes.length, 0);
});

test('Dashboard.getData (v4.1.1): expone "responsables" (DEV/ANA activos) solo para ADM', () => {
  const ctx = loadConSchema();
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Dev Uno', 'dev1@homepymes.cl', 'HP', 'DEV', true, '', 'sistema'],
    ['U2', 'Analista Dos', 'ana2@homepymes.cl', 'HP', 'ANA', true, '', 'sistema'],
    ['U3', 'Inactivo', 'x@homepymes.cl', 'HP', 'DEV', false, '', 'sistema'],
    ['U4', 'Admin Uno', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);

  const datosAdmin = ctx.Dashboard.getData({}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  const datosGerencia = ctx.Dashboard.getData({}, { rol: 'GERENCIA', email: 'gerencia@homepymes.cl' });
  const datosDev = ctx.Dashboard.getData({}, { rol: 'DEV', email: 'dev1@homepymes.cl' });

  const emailsAdmin = datosAdmin.responsables.map((r) => r.email).sort();
  assert.deepEqual(emailsAdmin, ['ana2@homepymes.cl', 'dev1@homepymes.cl']);
  // Ni Gerencia ni un DEV necesitan la lista completa -- ya estan
  // auto-acotados a su propia bandeja.
  assert.equal(datosGerencia.responsables, undefined);
  assert.equal(datosDev.responsables, undefined);
});

test('Dashboard.getData (v3.0): sin la hoja USUARIOS, "responsables" queda vacio sin romper', () => {
  const ctx = loadConSchema();
  const datos = ctx.Dashboard.getData({}, { rol: 'ADM', email: 'admin@homepymes.cl' });
  assert.equal(datos.responsables.length, 0);
});

// --- cuenta del portal con bandeja: escribir SOLO lo suyo ---------------
//
// Code.gs normaliza una cuenta SOLICITANTE con modulo "bandeja" a rol DEV,
// con esta frase escrita al lado: "el rol mas restringido con escritura:
// solo su propio trabajo". No lo era. La LECTURA si estaba acotada (los
// tests de arriba), pero las escrituras miraban solo el rol -- que ya decia
// DEV -- asi que con el id a mano se podia mover el item de otra persona.
// Los ids son correlativos y salen en los correos.

/** Cuenta del portal normalizada a DEV (rol_origen la delata). */
function ctxPortal(email) {
  return { email: email || 'portal@homepymes.cl', rol: 'DEV', rol_origen: 'SOLICITANTE', via_portal: true };
}
/** Personal de plantilla: mismo rol, sin rol_origen. */
function ctxPlantilla(email) {
  return { email: email || 'portal@homepymes.cl', rol: 'DEV' };
}

function seedItemAjeno(ctx) {
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0009', desarrollador_asignado: 'ajeno@homepymes.cl' });
  return seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0009-01', solicitud_id: 'SOL-2026-HP-0009', desarrollador_asignado: 'ajeno@homepymes.cl', titulo: 'Trabajo del ajeno' });
}

test('cuenta del portal: no puede tocar un item que no tiene asignado', () => {
  const ctx = loadConSchema();
  seedItemAjeno(ctx);

  const estado = ctx.Solicitudes.actualizarEstado({ subsolicitud_id: 'SOL-2026-HP-0009-01', estado_nuevo: 'S07', comentario: 'x' }, ctxPortal());
  const fecha = ctx.Solicitudes.comprometerFecha({ subsolicitud_id: 'SOL-2026-HP-0009-01', fecha_comprometida: '2099-01-01' }, ctxPortal());
  const edicion = ctx.Solicitudes.editarContenidoSubsolicitud({ subsolicitud_id: 'SOL-2026-HP-0009-01', titulo: 'REESCRITO', descripcion: 'Descripcion larga suficiente para pasar la validacion de longitud.' }, ctxPortal());

  assert.equal(estado._forbidden, true, 'no puede cambiar el estado de un item ajeno');
  assert.equal(fecha._forbidden, true, 'no puede comprometer fecha en un item ajeno');
  assert.equal(edicion._forbidden, true, 'no puede reescribir el contenido de un item ajeno');

  // Lo que de verdad importa: que la fila no se haya tocado. Un forbidden
  // que igual escribe no sirve de nada.
  const fila = ctx.leerFilas_('SUBSOLICITUDES')[0];
  assert.equal(fila.estado, 'S05');
  assert.equal(fila.titulo, 'Trabajo del ajeno');
  assert.equal(fila.fecha_comprometida, '');
});

test('cuenta del portal: SI puede con lo suyo -- el arreglo no la deja sin trabajo', () => {
  // Contrapeso imprescindible. Un porton que cierra de mas convierte una
  // cuenta de trabajo en una cuenta de solo lectura, y eso se notaria el
  // primer dia de uso y no antes.
  const ctx = loadConSchema();
  seedSolicitud(ctx, { solicitud_id: 'SOL-2026-HP-0010', desarrollador_asignado: 'portal@homepymes.cl' });
  seedSubsolicitud(ctx, { subsolicitud_id: 'SOL-2026-HP-0010-01', solicitud_id: 'SOL-2026-HP-0010', desarrollador_asignado: 'portal@homepymes.cl' });

  const r = ctx.Solicitudes.actualizarEstado({ subsolicitud_id: 'SOL-2026-HP-0010-01', estado_nuevo: 'S07', comentario: 'avanzo lo mio' }, ctxPortal());

  assert.notEqual(r._forbidden, true, 'sobre su propio item tiene que poder');
  assert.equal(ctx.leerFilas_('SUBSOLICITUDES')[0].estado, 'S07');
});

test('el personal de plantilla NO cambia: sigue pudiendo cubrir a un companero', () => {
  // Que un DEV o un ANA de plantilla muevan el item de otro es una decision
  // tomada y escrita (Fase 10.1: "el rol resuelve el acceso"), y en un
  // equipo de tres o cuatro personas que se cubren tiene sentido. El arreglo
  // se aplica SOLO a las cuentas del portal, y este test lo fija: si alguien
  // extiende el veto a todo DEV, se entera aqui y no en produccion.
  const ctx = loadConSchema();
  seedItemAjeno(ctx);

  const r = ctx.Solicitudes.actualizarEstado({ subsolicitud_id: 'SOL-2026-HP-0009-01', estado_nuevo: 'S07', comentario: 'cubro a mi companero' }, ctxPlantilla());

  assert.notEqual(r._forbidden, true);
  assert.equal(ctx.leerFilas_('SUBSOLICITUDES')[0].estado, 'S07');
});
