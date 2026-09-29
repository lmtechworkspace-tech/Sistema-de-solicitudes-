'use strict';

/**
 * Carga del SGC desde Drive (cargaDriveSgc.js, 2026-09-29): solo super
 * admin, simulación que no deja rastro, idempotencia (una segunda corrida no
 * cambia nada), fechas históricas, texto editado en SIGSO protegido y
 * "todo o nada" ante un error.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Carga = require('../logica/cargaDriveSgc');

const SUPER = { email: 'encargado@x.cl', rol: 'ADM', super_admin: true, nombre: 'Encargado' };

function db_() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  const persona = (id, nombre, email) => agregarFila_(db, 'SGC_PERSONAS', {
    persona_id: id, usuario_email: email, nombre, rut: '', cargo: '', tipo: 'INT', area_id: '', jefatura_email: '', subrogante_email: '',
    fecha_ingreso: '', estado: 'ACTIVO', fecha_desvinculacion: '', creado_por: '', fecha_creacion: '', activa: true
  });
  persona('P1', 'Ana Pérez Soto', 'ana@x.cl');
  persona('P2', 'Bruno Díaz', 'bruno@x.cl');
  persona('P3', 'Carla Rojas', 'carla@x.cl');
  agregarFila_(db, 'SGC_INDUCCIONES', { induccion_id: 'I1', persona_id: 'P1', item: 'Organigrama', fecha: '', relator_email: '', estado: 'PENDIENTE', observaciones: '' });
  agregarFila_(db, 'SGC_DOCUMENTOS', {
    documento_id: 'D1', codigo: 'PRO-01', nombre: 'Control de documentos', descripcion: '', tipo: 'PRO', area_id: 'CALIDAD',
    version_vigente: 'v01', estado: 'VIGENTE', visibilidad: 'TODOS', fecha_vigencia: '2026-06-01', proxima_revision: '2027-06-01',
    elaborado_por: '', revisado_por: '', aprobado_por: '', archivo_id: 'F1', archivo_nombre: 'pro01.docx', archivo_mime: '',
    creado_por: '', fecha_creacion: '', activa: true, requiere_acuse: false, fecha_limite_acuse: '', clausulas_iso: '["7.5"]',
    emisor: '', clase_externa: '', enlaces: '[]', fecha_aprobacion: '', contenido: '', contenido_borrador: '', contenido_fuente: '', enlace_drive: ''
  });
  agregarFila_(db, 'SGC_DOC_VERSIONES', { version_id: 'V1', documento_id: 'D1', version: 'v01', cambios: '', archivo_id: 'F1', archivo_nombre: 'pro01.docx', archivo_mime: '', subido_por: '', fecha: '2026-06-01', vigente: true, contenido: '' });
  agregarFila_(db, 'SGC_REVISIONES', {
    revision_id: 'R1', correlativo: 'RD-2026-01', anio: 2026, fecha_programada: '2026-08-19', aviso_plazo: '', fecha_convocatoria: '', fecha_reunion: '2026-08-19',
    asistentes: '[]', entradas: '[]', conclusiones: '', anexos: '', director_email: '', responsable_calidad_email: '',
    estado: 'REALIZADA', fecha_cierre: '', cerrada_por: '', creada_por: '', fecha_creacion: '', activa: true
  });
  agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'C1', razon_social: 'CONSTRUCTORA UNO SPA', rut: '76.111.222-3', codigo_cliente: '', contacto: '', correo: '', telefono: '', representante_legal: '', direccion: '', estado: 'ACTIVO', bloqueo: '', activo: true });
  agregarFila_(db, 'SGC_PROCESOS', {
    proceso_id: 'SRV-01', codigo: 'SRV-01', nombre: '1. Facturas - Puntual', tipo: 'OPERATIVO', nivel: 'SERVICIO', proceso_padre_id: '', area: 'Contabilidad',
    objetivo: '', alcance: '', responsable_email: '', entradas: '', actividades: '', salidas: '', clientes: '', proveedores: '', recursos: '',
    documentos: 'DOC-10', clausulas_iso: '', estado: 'VIGENTE', observaciones: '', fecha_ultima_revision: '', revisado_por: '', creado_por: '', fecha_creacion: '', activa: true
  });
  return db;
}
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

const PAQUETE = {
  documentos: [{
    codigo: 'PRO-01', enlace_drive: 'https://drive.google.com/file/d/abc/view', clausulas_agregar: ['7.5', '4.3'],
    contenido: { secciones: [{ id: 's1', titulo: 'OBJETIVO', texto: 'Establecer la metodología.' }], control_cambios: [{ version: '01', fecha: 'Junio 2026', descripcion: 'Primera edición' }] }
  }],
  procesos: { renombrar: [{ codigo: 'SRV-01', nombre: 'Facturas' }] },
  auditorias: [{
    registro: '01-2026', proceso: 'SGC completo', clausulas: ['4.1'], auditor: 'Auditor Externo (externo)', auditados: ['Ana Pérez'],
    objetivo: 'Auditoría 2026', alcance: 'Todo el SGC', fecha_programada: '2026-08-24', fecha_plan: '2026-08-24', fecha_ejecucion: '2026-08-27',
    estado: 'CERRADA', fecha_cierre: '2026-08-28', informe: { fecha: '2026-08-28', conclusion: 'SGC implementado.', entrevistados: ['Ana Pérez — Directora'] },
    hallazgos: [
      { clausula: '4.1', aspecto: 'Cambio climático', evidencia: 'FODA', resultado: 'NO_CONFORMIDAD', descripcion: 'No se consideró el cambio climático.',
        nc: { referencia: 'NC-1', descripcion: 'No se consideró el cambio climático.', fecha_deteccion: '2026-08-28', responsable: 'Bruno Díaz', detectada_por: 'Auditor Externo (externo)',
          porques: ['Porque el FODA era clásico.'], causa_raiz: 'Requisito 2024 no incorporado.',
          correccion: { descripcion: 'Agregar la amenaza al FODA.', plazo: '2026-09-11', cerrada: '2026-09-11' },
          accion: { descripcion: 'Verificar actualizaciones normativas en PRO-01.', plazo: '2026-10-09' },
          eficacia: { plazo: '2026-11-20', criterio: 'Sin hallazgo en 4.1.' } } },
      { clausula: '9.2', aspecto: 'Modalidad', resultado: 'OBSERVACION', descripcion: 'Remota y presencial.' }
    ]
  }],
  revision: {
    correlativo: 'RD-2026-01', conclusiones: 'Primera revisión (línea base).',
    acuerdos: [{ tipo: 'RECURSOS', observaciones: 'No se requieren recursos adicionales para el periodo.', responsable: 'Ana Pérez', plazo: '2026-09-07', terminado: '2026-09-07' }],
    cerrar: true, fecha_cierre: '2026-09-07'
  },
  inducciones: [{ persona: 'Ana Pérez', fecha: '2026-07-15', relator: 'Bruno Díaz' }, { persona: 'Carla Rojas', fecha: '2026-07-20', relator: 'Bruno Díaz' }],
  prestaciones: [{ registro: 'P01', proceso_codigo: 'SRV-01', cliente: { rut: '76111222-3', nombres: ['Otra razón social'] }, periodo: '', fecha: '2026-08-03', responsable: 'Carla Rojas', evidencia: 'Factura enviada.' }],
  desvinculaciones: [{ persona: 'Persona Inexistente', fecha: '2026-08-19' }]
};

test('solo la cuenta super administrador puede ejecutar la carga', () => {
  const db = db_();
  const r = Carga.importar(db, { paquete: PAQUETE }, { email: 'encargado@x.cl', rol: 'ADM' });
  assert.equal(r._forbidden, true);
  assert.equal(filas(db, 'SGC_AUDITORIAS').length, 0);
});

test('simular mide el efecto y no deja nada escrito', () => {
  const db = db_();
  const r = Carga.importar(db, { paquete: PAQUETE, simular: true }, SUPER);
  assert.equal(r.simulacion, true);
  assert.equal(r.conteo.nc, 1);
  assert.equal(r.cobertura_despues.por_clausula['9.2'], 'COMPLETO');
  assert.equal(filas(db, 'SGC_AUDITORIAS').length, 0);
  assert.equal(filas(db, 'SGC_NC').length, 0);
  assert.equal(filas(db, 'ACTIVIDADES').length, 0);
  assert.equal(filas(db, 'SGC_DOCUMENTOS')[0].enlace_drive, '');
});

test('carga real: fechas históricas, NC con su ciclo, revisión cerrada, inducciones y prestación; la segunda corrida no cambia nada', () => {
  const db = db_();
  const r = Carga.importar(db, { paquete: PAQUETE }, SUPER);
  assert.ok(!r._validationError, r.message);

  const doc = filas(db, 'SGC_DOCUMENTOS')[0];
  assert.equal(doc.enlace_drive, 'https://drive.google.com/file/d/abc/view');
  assert.deepEqual(JSON.parse(doc.clausulas_iso), ['7.5', '4.3']);
  assert.equal(JSON.parse(doc.contenido).origen, 'DRIVE');
  assert.equal(filas(db, 'SGC_PROCESOS')[0].nombre, 'Facturas');

  const aud = filas(db, 'SGC_AUDITORIAS')[0];
  assert.equal(aud.correlativo, 'AI-2026-001');
  assert.equal(aud.estado, 'CERRADA');
  assert.equal(String(aud.fecha_ejecucion).slice(0, 10), '2026-08-27');
  assert.deepEqual(JSON.parse(aud.auditados), ['ana@x.cl']);
  const hallazgos = filas(db, 'SGC_AUD_HALLAZGOS');
  assert.equal(hallazgos.length, 2);

  const nc = filas(db, 'SGC_NC')[0];
  assert.equal(nc.correlativo, 'NC-2026-001');
  assert.equal(nc.responsable_email, 'bruno@x.cl');
  assert.equal(nc.estado, 'EN_ACCION');
  assert.equal(String(nc.correccion_fecha_cierre).slice(0, 10), '2026-09-11');
  assert.equal(hallazgos.find((h) => h.resultado === 'NO_CONFORMIDAD').nc_id, nc.nc_id);
  const actividades = filas(db, 'ACTIVIDADES');
  assert.equal(actividades.find((a) => a.actividad_id === nc.correccion_actividad_id).estado, 'TERMINADA');
  assert.equal(actividades.find((a) => a.actividad_id === nc.accion_actividad_id).estado, 'NO_INICIADA');

  const rev = filas(db, 'SGC_REVISIONES')[0];
  assert.equal(rev.estado, 'CERRADA');
  assert.equal(rev.conclusiones, 'Primera revisión (línea base).');
  assert.equal(filas(db, 'SGC_REVISION_ACUERDOS').length, 1);

  // Ana tenía un ítem pendiente (se completa); Carla no tenía ninguno (se crean los 5).
  const ind = filas(db, 'SGC_INDUCCIONES');
  assert.equal(ind.find((i) => i.induccion_id === 'I1').estado, 'COMPLETADA');
  assert.equal(ind.filter((i) => i.persona_id === 'P3' && i.estado === 'COMPLETADA').length, 5);

  // El cliente se encuentra por RUT aunque la razón social no calce.
  const p = filas(db, 'SGC_PRESTACIONES')[0];
  assert.equal(p.cliente_id, 'C1');
  assert.equal(p.responsable_email, 'carla@x.cl');
  assert.equal(p.estado, 'PRESTADO');

  const r2 = Carga.importar(db, { paquete: PAQUETE }, SUPER);
  Object.keys(r2.conteo).forEach((k) => assert.equal(r2.conteo[k], 0, 'segunda corrida cambió ' + k));
  assert.equal(filas(db, 'SGC_NC').length, 1);
});

test('no pisa un texto editado en SIGSO después de la carga', () => {
  const db = db_();
  Carga.importar(db, { paquete: PAQUETE }, SUPER);
  const { actualizarFilaPorId_ } = require('../db/sqliteRepo');
  actualizarFilaPorId_(db, 'SGC_DOCUMENTOS', 'documento_id', 'D1', { contenido: JSON.stringify({ secciones: [{ titulo: 'OBJETIVO', texto: 'Editado a mano.' }], control_cambios: [] }) });
  const r = Carga.importar(db, { paquete: PAQUETE }, SUPER);
  assert.equal(r.conteo.documentos_escritos, 0);
  assert.match(r.omitidos.join(' '), /PRO-01: ya tiene texto editado/);
  assert.match(filas(db, 'SGC_DOCUMENTOS')[0].contenido, /Editado a mano/);
});

test('un error a mitad de camino revierte todo (todo o nada)', () => {
  const db = db_();
  const malo = Object.assign({}, PAQUETE, { revision: Object.assign({}, PAQUETE.revision, { acuerdos: [{ tipo: 'INVENTADO', observaciones: 'Acuerdo con tipo inválido.', responsable: 'Ana Pérez', plazo: '2026-09-30' }] }) });
  const r = Carga.importar(db, { paquete: malo }, SUPER);
  assert.equal(r._validationError, true);
  assert.match(r.message, /no se guardó nada/);
  assert.equal(filas(db, 'SGC_AUDITORIAS').length, 0);
  assert.equal(filas(db, 'ACTIVIDADES').length, 0);
  assert.equal(filas(db, 'SGC_DOCUMENTOS')[0].enlace_drive, '');
});
