'use strict';

/**
 * Control interno, versión "espejo del Excel" (2026-10-01): 54 matrices con
 * las columnas de sus planillas, permisos reales (módulo + departamento +
 * quién libera), situación calculada con las columnas, períodos por mes /
 * por fecha / lista, liberación sin auto-liberar, columnas sensibles e
 * historial.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Calidad = require('../logica/calidadSgc');
const Procesos = require('../logica/procesosSgc');
const Prestaciones = require('../logica/prestacionesSgc');
const CI = require('../logica/controlInterno');
const { MATRICES, matriz_ } = require('../logica/controlInternoMatrices');
const P = require('../logica/controlInternoPlanillas');

const ADM = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: [] };
const conModulo = (email, rol) => ({ email, rol: rol || 'DEV', modulos: ['control_interno'] });
const FRANCISCA = conModulo('francisca@homepymes.cl');
const BARBARA = conModulo('barbara@homepymes.cl', 'JEFATURA');
const VANESSA = conModulo('vanessa@homepymes.cl');
const LECTORA = conModulo('lectora@homepymes.cl');
const GERENCIA = conModulo('gerente@homepymes.cl', 'GERENCIA');
// Está en la lista de Contabilidad pero su cuenta no tiene el módulo: desde 2026-10-03 entra igual.
const SIN_MODULO = { email: 'francisca@homepymes.cl', rol: 'DEV', modulos: [] };
const AJENA = { email: 'ajena@homepymes.cl', rol: 'DEV', modulos: ['control_interno'] };

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  ['Constructora Andes SpA', 'Pyme Sur Ltda', 'Servicios Norte SpA'].forEach((n, i) => agregarFila_(db, 'CAT_CLIENTES', {
    cliente_id: 'CLI-' + (i + 1), razon_social: n, rut: '7' + i + '.111.111-1', codigo_cliente: 'HP-00' + i, contacto: '', correo: '', telefono: '',
    representante_legal: '', direccion: '', estado: 'ACTIVO', bloqueo: '', activo: true
  }));
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'C1', usuario: 'ffeliu', nombre: 'Francisca Feliú', cargo: 'Asistente', emails: JSON.stringify([FRANCISCA.email]), rol: 'DEV', modulos: '[]', empresa_id: 'HP', activo: true });
  const ENC = { email: 'sgc@homepymes.cl', rol: 'DEV' };
  Calidad.gestionarRol(db, { usuario_email: ENC.email, rol_sgc: 'ENCARGADO_SGC' }, ADM);
  Procesos.sembrarMapa(db, {}, ENC);
  const mapa = Procesos.listar(db, {}, ENC).mapa;
  Procesos.guardar(db, { nombre: 'IVA', tipo: 'OPERATIVO', nivel: 'SERVICIO', proceso_padre_id: mapa.find((p) => p.codigo === 'PO-04').proceso_id }, ENC);
  Procesos.guardar(db, { nombre: 'Remuneraciones', tipo: 'OPERATIVO', nivel: 'SERVICIO', proceso_padre_id: mapa.find((p) => p.codigo === 'PO-03').proceso_id }, ENC);
  CI.guardarMiembros(db, { depto: 'CONTABILIDAD', miembros: [{ email: FRANCISCA.email, rol: 'REGISTRA' }, { email: LECTORA.email, rol: 'LECTURA' }] }, ADM);
  CI.guardarMiembros(db, { depto: 'RRHH', miembros: [{ email: VANESSA.email, rol: 'REGISTRA' }] }, ADM);
  Prestaciones.guardarLiberadores(db, { areas: [{ area_clave: 'CONTABILIDAD', emails: [BARBARA.email] }] }, ADM);
  return db;
}
function nuevo(db, extra, ctx) {
  return CI.guardar(db, Object.assign({ matriz: 'IVA', periodo: '2026-M09', cliente_id: 'CLI-1' }, extra || {}), ctx || FRANCISCA);
}

test('las 54 matrices son espejo de sus planillas y están bien declaradas', () => {
  // 54 de las planillas + "Servicios sin matriz" (reunión con Francisca, 2026-10-01).
  assert.equal(MATRICES.length, 56, '+ Cobranza de honorarios (2026-10-03)');
  assert.equal(MATRICES.filter((m) => m.archivo).length, 54);
  assert.equal(MATRICES.filter((m) => m.depto === 'RRHH').length, 39, 'RR.HH.: una matriz por hoja del libro');
  const claves = new Set();
  MATRICES.forEach((m) => {
    assert.ok(!claves.has(m.clave), 'clave repetida ' + m.clave);
    claves.add(m.clave);
    assert.ok(['mensual', 'registro', 'lista'].indexOf(m.tipo) !== -1, m.clave + ': tipo');
    assert.ok(m.estados.some((e) => e.final), m.clave + ' necesita una situación final');
    const cols = new Set();
    m.columnas.forEach((c) => {
      assert.ok(!cols.has(c.clave), m.clave + ': columna repetida ' + c.clave);
      cols.add(c.clave);
      // Nunca columnas de usuarios o claves de plataformas.
      assert.equal(P.esColumnaDeClave_(P.n_(c.etiqueta)), false, m.clave + ': columna de clave ' + c.etiqueta);
    });
    if (!m.sinCliente) assert.ok(m.columnas.some((c) => c.rol === 'cliente'), m.clave + ' sin columna de cliente');
  });
  // Mismo orden que la planilla.
  assert.deepEqual(matriz_('FACTURACION').columnas.slice(0, 5).map((c) => c.clave), ['codigo', 'empresa', 'rut', 'clasificacion_interna', 'recepcion_informacion']);
  // Contabilización: quién y cuándo POR BLOQUE, con su grupo (encabezado de dos niveles).
  const cont = matriz_('CONTABILIZACION').columnas;
  assert.ok(cont.find((c) => c.clave === 'pagos_quien_realiza_sueldos' && c.grupo === 'PAGOS'));
  assert.ok(cont.find((c) => c.clave === 'centralizaciones_banco' && c.grupo === 'CENTRALIZACIONES'));
  assert.ok(matriz_('LICENCIAS').sensibles.indexOf('motivo') !== -1);
});

test('cada uno ve solo su departamento: lo decide la lista del área, no la cuenta', () => {
  const db = crear();
  assert.equal(CI.getConfig(db, {}, AJENA)._forbidden, true, 'sin estar en ninguna lista no entra, aunque tenga el módulo');
  assert.deepEqual(CI.getConfig(db, {}, SIN_MODULO).departamentos.map((d) => d.clave), ['CONTABILIDAD'], 'estar en la lista basta');
  const f = CI.getConfig(db, {}, FRANCISCA);
  assert.deepEqual(f.departamentos.map((d) => d.clave), ['CONTABILIDAD']);
  assert.ok(f.matrices.every((m) => m.depto === 'CONTABILIDAD'));
  assert.deepEqual(CI.getConfig(db, {}, VANESSA).departamentos.map((d) => d.clave), ['RRHH']);
  assert.equal(CI.listar(db, { matriz: 'IVA', periodo: '2026-M09' }, VANESSA)._forbidden, true);
  assert.deepEqual(CI.getConfig(db, {}, BARBARA).departamentos.map((d) => d.clave), ['CONTABILIDAD']);
  assert.equal(CI.getConfig(db, {}, ADM).departamentos.length, 6);
});

test('departamentos del organigrama: un módulo cada uno, con su lista y su jefatura', () => {
  const db = crear();
  // El menú: cada persona recibe solo los módulos de sus áreas.
  assert.deepEqual(CI.modulosDeDepartamento_(db, FRANCISCA), ['dep_contabilidad']);
  assert.deepEqual(CI.modulosDeDepartamento_(db, VANESSA), ['dep_rrhh']);
  assert.deepEqual(CI.modulosDeDepartamento_(db, BARBARA), ['dep_contabilidad'], 'quien libera el área también entra');
  assert.deepEqual(CI.modulosDeDepartamento_(db, AJENA), []);
  // La sesión los lleva al navegador (solo para pintar el menú).
  assert.deepEqual(require('../logica/portal').perfilPublico({ cuenta_id: 'C1', emails: JSON.stringify([FRANCISCA.email]), rol: 'DEV', modulos: '[]' }, db).departamentos, ['dep_contabilidad']);
  assert.deepEqual(CI.modulosDeDepartamento_(db, ADM), ['dep_contabilidad', 'dep_rrhh', 'dep_prevencion', 'dep_marketing', 'dep_cobranzas', 'dep_administracion']);
  assert.equal(CI.modulosDeDepartamento_(db, GERENCIA).length, 6, 'Gerencia con "ver todas las áreas"');
  assert.deepEqual(CI.modulosDeDepartamento_(db, { email: 'gerente@homepymes.cl', rol: 'GERENCIA', modulos: [] }), [], 'Gerencia sin ese permiso no ve áreas ajenas');
  // Prevención y Marketing, sin matrices todavía.
  const camila = { email: 'camila@homepymes.cl', rol: 'DEV', modulos: [] };
  CI.guardarMiembros(db, { depto: 'PREVENCION', miembros: [{ email: camila.email, rol: 'JEFATURA' }, { email: 'amarlla@homepymes.cl', rol: 'REGISTRA' }] }, ADM);
  assert.deepEqual(CI.modulosDeDepartamento_(db, camila), ['dep_prevencion']);
  const c = CI.getConfig(db, { depto: 'PREVENCION' }, camila);
  assert.deepEqual(c.departamentos.map((d) => [d.clave, d.rol, d.jefatura, d.registra]), [['PREVENCION', 'JEFATURA', true, true]]);
  assert.equal(c.matrices.length, 0);
  // Un módulo pide solo lo suyo; un área ajena se rechaza.
  assert.ok(CI.getConfig(db, { depto: 'CONTABILIDAD' }, ADM).matrices.every((m) => m.depto === 'CONTABILIDAD'));
  assert.equal(CI.getConfig(db, { depto: 'RRHH' }, FRANCISCA)._forbidden, true);
  assert.equal(CI.getConfig(db, { depto: 'VENTAS' }, ADM).ok, false);
  // Accesos de una sola área, con el rol Jefatura.
  const acc = CI.listarMiembros(db, { depto: 'PREVENCION' }, ADM);
  assert.deepEqual(acc.departamentos.map((d) => d.clave), ['PREVENCION']);
  assert.deepEqual(acc.departamentos[0].miembros.map((m) => m.rol), ['JEFATURA', 'REGISTRA']);
  assert.ok(acc.roles.indexOf('JEFATURA') !== -1);
});

test('solo lectura no registra', () => {
  const db = crear();
  assert.equal(nuevo(db, {}, LECTORA)._forbidden, true);
  assert.equal(CI.listar(db, { matriz: 'IVA', periodo: '2026-M09' }, LECTORA).puede_registrar, false);
});

test('la celda se guarda como en la planilla: montos con puntos, "NA" tal cual, claves nunca', () => {
  const db = crear();
  const r = nuevo(db, { datos: { monto_pago: '1.234.567', fecha_declaracion: '2026-09-20', posterga_si_no: 'NO', monto_ppm: 'NA', obs: 'Clave SII: 1234abcd' } });
  assert.equal(r.ok, true);
  assert.equal(r.registro.datos.monto_pago, 1234567);
  assert.equal(r.registro.datos.monto_ppm, 'NA', 'lo que no es número se ve igual que en la planilla');
  assert.equal(r.registro.datos.obs, '[clave omitida]');
  assert.equal(r.registro.fecha, '');
  assert.equal(r.registro.estado, 'EN_PROCESO', 'hay declaración pero no se envió el F29');
  assert.match(nuevo(db).message, /ya tiene su fila/);
  assert.match(nuevo(db, { cliente_id: 'NO-EXISTE' }).message, /no está en el catálogo/);
  const fuera = nuevo(db, { cliente_id: '', cliente_nombre: 'Cliente Nuevo SpA' });
  assert.equal(fuera.ok, true);
  assert.equal(fuera.registro.cliente_id, '');
});

test('la situación la calculan las columnas; editar por celda conserva lo demás y deja historial', () => {
  const db = crear();
  const r = nuevo(db, { datos: { monto_pago: 1000, fecha_envio_carta: '2026-09-10' } }).registro;
  const e = CI.guardar(db, { registro_id: r.registro_id, datos: { enviado_f29: 'OK' } }, FRANCISCA);
  assert.equal(e.registro.estado, 'TERMINADO');
  assert.equal(e.registro.datos.fecha_envio_carta, '2026-09-10', 'la edición parcial no borra las otras columnas');
  assert.equal(CI.guardar(db, { registro_id: r.registro_id, datos: { enviado_f29: 'OK' } }, FRANCISCA).message, 'Sin cambios.');
  const h = CI.getRegistro(db, { registro_id: r.registro_id }, FRANCISCA).historial;
  assert.deepEqual(h.map((x) => x.accion).sort(), ['CREADO', 'EDITADO']);
  assert.match(h.find((x) => x.accion === 'EDITADO').detalle, /ENVIADO EL F29/i);
  assert.match(h.find((x) => x.accion === 'EDITADO').detalle, /Situación: En proceso → Terminado/);
});

test('el responsable sale de "QUIÉN REALIZA": el nombre de la planilla contra las cuentas', () => {
  const db = crear();
  const r = nuevo(db, { datos: { quien_realiza: 'FRANCISCA' } }).registro;
  assert.equal(r.responsable_email, FRANCISCA.email);
  assert.equal(r.datos.quien_realiza, 'FRANCISCA', 'el texto de la planilla se conserva');
  const otro = nuevo(db, { cliente_id: 'CLI-2', datos: { quien_realiza: 'Paulette' } }).registro;
  assert.equal(otro.responsable_email, '', 'sin cuenta: queda el nombre');
});

test('RR.HH.: una fila por requerimiento, el mes sale de la fecha y se lista por año', () => {
  const db = crear();
  const r = CI.guardar(db, { matriz: 'FINIQUITOS', cliente_id: 'CLI-1', datos: { recepcion_requerimiento: '2026-08-14', nombre: 'Juan Pérez', causal_finiquito: 'RENUNCIA' } }, VANESSA);
  assert.equal(r.ok, true);
  assert.equal(r.registro.periodo, '2026-M08');
  assert.equal(r.registro.estado, 'PENDIENTE');
  const mover = CI.guardar(db, { registro_id: r.registro.registro_id, datos: { recepcion_requerimiento: '2026-09-02', envio_doc_cliente: '2026-09-03' } }, VANESSA);
  assert.equal(mover.registro.periodo, '2026-M09');
  assert.equal(mover.registro.estado, 'TERMINADO');
  const l = CI.listar(db, { matriz: 'FINIQUITOS', anio: '2026' }, VANESSA);
  assert.equal(l.registros.length, 1);
  assert.deepEqual(l.anios, ['2026']);
  // Un error de tipeo en la fecha (año 0204) no inventa un mes.
  const tipeo = CI.guardar(db, { matriz: 'FINIQUITOS', cliente_id: 'CLI-1', datos: { recepcion_requerimiento: '0204-04-12' } }, VANESSA);
  assert.equal(tipeo.registro.periodo, CI.periodoActual_());
});

test('convenios: la situación sale de las cuotas vencidas', () => {
  const db = crear();
  const sin = CI.guardar(db, { matriz: 'CONVENIOS', periodo: '2026-M09', cliente_id: 'CLI-1', datos: { convenios: 'NO' } }, FRANCISCA);
  assert.equal(sin.registro.estado, 'SIN_CONVENIO');
  const al = CI.guardar(db, { registro_id: sin.registro.registro_id, datos: { convenios: 'SI', folio_convenio_1: '123', cuotas_canceladas_convenio_1: 7 } }, FRANCISCA);
  assert.equal(al.registro.estado, 'AL_DIA');
  const venc = CI.guardar(db, { registro_id: sin.registro.registro_id, datos: { cuotas_vencidas_convenio_2: 2 } }, FRANCISCA);
  assert.equal(venc.registro.estado, 'CON_VENCIDAS');
});

test('contabilización: ESTADO FINAL manda; sin él, las tareas del mes', () => {
  const db = crear();
  const base = { matriz: 'CONTABILIZACION', periodo: '2026-M09' };
  const fin = CI.guardar(db, Object.assign({ cliente_id: 'CLI-1', datos: { estado_final: 'FINALIZADO' } }, base), FRANCISCA);
  assert.equal(fin.registro.estado, 'TERMINADO');
  const tareas = { centralizaciones_compras: 'OK', centralizaciones_banco: 'NO APLICA', centralizaciones_ventas: 'OK', centralizaciones_honorarios: 'OK', contabilizaciones_f29: 'OK', contabilizaciones_ppm: 'OK', pagos_sueldos: 'OK', pagos_imposiciones: 'OK' };
  const ok = CI.guardar(db, Object.assign({ cliente_id: 'CLI-2', datos: tareas }, base), FRANCISCA);
  assert.equal(ok.registro.estado, 'TERMINADO');
  const pend = CI.guardar(db, Object.assign({ cliente_id: 'CLI-3', datos: Object.assign({}, tareas, { pagos_sueldos: 'PENDIENTE' }) }, base), FRANCISCA);
  assert.equal(pend.registro.estado, 'EN_PROCESO');
});

test('abrir el mes copia los clientes del mes anterior una sola vez, con lo que se arrastra', () => {
  const db = crear();
  nuevo(db, { periodo: '2026-M08', datos: { clasificacion: 'HP', monto_pago: 500 } });
  nuevo(db, { periodo: '2026-M08', cliente_id: 'CLI-2', datos: { clasificacion: 'HC' } });
  nuevo(db, { periodo: '2026-M09', cliente_id: 'CLI-2' });
  const r = CI.abrirPeriodo(db, { matriz: 'IVA', periodo: '2026-M09' }, FRANCISCA);
  assert.equal(r.creadas, 1);
  assert.equal(r.omitidas, 1);
  const sep = CI.listar(db, { matriz: 'IVA', periodo: '2026-M09' }, FRANCISCA).registros.find((x) => x.cliente_id === 'CLI-1');
  assert.equal(sep.datos.clasificacion, 'HP', 'la clasificación se arrastra');
  assert.equal(sep.datos.monto_pago, undefined, 'el monto del mes no');
  assert.equal(CI.abrirPeriodo(db, { matriz: 'IVA', periodo: '2026-M09' }, FRANCISCA).creadas, 0);
});

test('libera quien libera el área, solo lo terminado y nunca lo propio; editar lo liberado lo devuelve a revisión', () => {
  const db = crear();
  const r = nuevo(db, { datos: { quien_realiza: BARBARA.email } }).registro;
  assert.match(CI.accionLote(db, { matriz: 'IVA', accion: 'liberar', ids: [r.registro_id] }, BARBARA).omitidas[0].motivo, /no está terminado/i);
  CI.guardar(db, { registro_id: r.registro_id, datos: { enviado_f29: 'OK' } }, FRANCISCA);
  assert.match(CI.accionLote(db, { matriz: 'IVA', accion: 'liberar', ids: [r.registro_id] }, BARBARA).omitidas[0].motivo, /lo realizaste tú/i);
  CI.guardar(db, { registro_id: r.registro_id, datos: { quien_realiza: 'FRANCISCA' } }, FRANCISCA);
  assert.equal(CI.accionLote(db, { matriz: 'IVA', accion: 'liberar', ids: [r.registro_id] }, FRANCISCA)._forbidden, true, 'Francisca no libera');
  assert.equal(CI.accionLote(db, { matriz: 'IVA', accion: 'liberar', ids: [r.registro_id] }, BARBARA).hechos, 1);
  const e = CI.guardar(db, { registro_id: r.registro_id, datos: { obs: 'corregido' } }, FRANCISCA);
  assert.equal(e.registro.liberado_por, '');
  assert.match(e.message, /liberar de nuevo/);
});

test('las listas no tienen mes ni liberación', () => {
  const db = crear();
  const r = CI.guardar(db, { matriz: 'ARRIENDOS', cliente_id: 'CLI-1', datos: { arriendo_si_no: 'SI', monto: '250.000' } }, FRANCISCA);
  assert.equal(r.registro.periodo, CI.PERIODO_LISTA);
  assert.equal(r.registro.estado, 'REGISTRADO');
  assert.equal(CI.listar(db, { matriz: 'ARRIENDOS' }, FRANCISCA).registros.length, 1);
  assert.match(CI.accionLote(db, { matriz: 'ARRIENDOS', accion: 'liberar', ids: [r.registro.registro_id] }, BARBARA).message, /no se libera/);
});

test('el motivo de la licencia solo lo ve RR.HH.: Gerencia ve "•••" y no lo puede pisar', () => {
  const db = crear();
  const r = CI.guardar(db, { matriz: 'LICENCIAS', cliente_id: 'CLI-1', datos: { fecha_tramite: '2026-09-01', motivo: 'ENFERMEDAD COMÚN', nombre_personal: 'Ana' } }, VANESSA).registro;
  assert.equal(r.datos.motivo, 'ENFERMEDAD COMÚN');
  const g = CI.listar(db, { matriz: 'LICENCIAS', anio: '2026' }, GERENCIA);
  assert.equal(g.registros[0].datos.motivo, '•••');
  assert.equal(CI.getRegistro(db, { registro_id: r.registro_id }, GERENCIA).registro.datos.motivo, '•••');
  CI.guardar(db, { registro_id: r.registro_id, datos: { motivo: '•••', nombre_personal: 'Ana María' } }, ADM);
  assert.equal(CI.listar(db, { matriz: 'LICENCIAS', anio: '2026' }, VANESSA).registros[0].datos.motivo, 'ENFERMEDAD COMÚN');
});

test('anular: lo liberado solo lo anula el Encargado', () => {
  const db = crear();
  const r = nuevo(db, { datos: { enviado_f29: 'OK', quien_realiza: 'FRANCISCA' } }).registro;
  CI.accionLote(db, { matriz: 'IVA', accion: 'liberar', ids: [r.registro_id] }, BARBARA);
  assert.match(CI.accionLote(db, { matriz: 'IVA', accion: 'anular', ids: [r.registro_id] }, FRANCISCA).omitidas[0].motivo, /Encargado/);
  const otro = nuevo(db, { cliente_id: 'CLI-2' }).registro;
  assert.equal(CI.accionLote(db, { matriz: 'IVA', accion: 'anular', ids: [otro.registro_id] }, FRANCISCA).hechos, 1);
  assert.equal(CI.listar(db, { matriz: 'IVA', periodo: '2026-M09' }, FRANCISCA).registros.length, 1);
});

test('los accesos los reparte solo el administrador', () => {
  const db = crear();
  assert.equal(CI.guardarMiembros(db, { depto: 'RRHH', miembros: [] }, FRANCISCA)._forbidden, true);
  assert.equal(CI.listarMiembros(db, {}, FRANCISCA)._forbidden, true);
  assert.equal(CI.guardarMiembros(db, { depto: 'RRHH', miembros: [{ email: 'nueva@homepymes.cl', rol: 'LECTURA' }] }, ADM).ok, true);
});

test('las consultas van por índice (matriz, período)', () => {
  const db = crear();
  CI.listar(db, { matriz: 'IVA', periodo: '2026-M09' }, FRANCISCA);
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM "CI_REGISTROS" WHERE "matriz" = ? AND "periodo" = ?').all('"IVA"', '"2026-M09"');
  assert.ok(plan.some((p) => /ix_ci_registros_matriz_periodo/.test(p.detail)), JSON.stringify(plan));
});
