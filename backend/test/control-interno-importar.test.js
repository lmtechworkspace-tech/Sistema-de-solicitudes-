'use strict';

/**
 * Importación "espejo" de las planillas del Drive a Control interno y sus
 * reportes (2026-10-01). Hojas sintéticas con la forma de las reales:
 * encabezado en distintas filas y versiones, fechas como número de serie,
 * "NA", hojas sin año, encabezado de dos niveles, listas pegadas abajo,
 * claves escritas en celdas, fichas por cliente y la hoja de subsanación.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const CI = require('../logica/controlInterno');
const Imp = require('../logica/controlInternoImportar');
const Rep = require('../logica/controlInternoReportes');
const P = require('../logica/controlInternoPlanillas');

const ADM = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: [] };
const OTRO = { email: 'francisca@homepymes.cl', rol: 'DEV', modulos: ['control_interno'] };
// Serie de Excel: 46265 = 2026-08-31, 46280 = 2026-09-15, 46245 = 2026-08-11.
const SEP15 = '46280', AGO31 = '46265', AGO11 = '46245';

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'CLI-1', razon_social: 'ATON CONSTRUCCIONES SPA', rut: '76.841.123-4', codigo_cliente: 'HP-002-1', contacto: '', correo: '', telefono: '', representante_legal: '', direccion: '', estado: 'ACTIVO', bloqueo: '', activo: true });
  agregarFila_(db, 'CAT_CLIENTES', { cliente_id: 'CLI-2', razon_social: 'Pyme Sur Limitada', rut: '77.222.222-2', codigo_cliente: 'HC-010-1', contacto: '', correo: '', telefono: '', representante_legal: '', direccion: '', estado: 'ACTIVO', bloqueo: '', activo: true });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'C1', usuario: 'ffeliu', nombre: 'Francisca Feliú', cargo: 'Asistente', emails: JSON.stringify(['francisca@homepymes.cl']), rol: 'DEV', modulos: '[]', empresa_id: 'HP', activo: true });
  return db;
}
const registros = (db, matriz) => leerFilas_(db, 'CI_REGISTROS', COLUMNAS.CI_REGISTROS).filter((r) => r.matriz === matriz && r.activa === true);
const LIBRO_IVA = 'MATRIZ INFORME Y PAGO DE IVA_ (2).xlsx';
const HOJAS_IVA = ['SEPTIEMBRE 2026', 'AGOSTO 2026', 'Hoja 23', 'ENERO 23', 'SEPTIEMBRE', 'OCTUBRE', 'DICIEMBRE '];
const hojaIva = (preIva) => [
  ['INFORME Y PAGO DE IVA'],
  [],
  ['EMPRESA', 'RUT', 'CLASIFICACION', 'ESTATUS', preIva || 'MONTO PRE IVA', 'QUIEN REALIZA', 'FECHA DECLARACION', 'ENVIADO EL F29', 'OBS', 'USUARIO'],
  ['Aton Construcciones SpA', '76.841.123-4', 'HP', 'WHATSAPP', '1.250.000', 'FRANCISCA', SEP15, 'OK', 'ok', 'aton123'],
  ['Pyme Sur Ltda', '77222222-2', 'HC', 'enviar a wsp', 'NA', 'FRANCISCA', '', 'NO', 'Clave SII: 77abc', 'x'],
  ['Cliente Nuevo SpA', '78.000.000-1', 'NA', 'NA', 'NA', 'Paulette', '', '', '', ''],
  [],
  // Lista de clientes pegada abajo: no son filas de la matriz.
  ['Otra Empresa SpA', '79.000.000-1']
];

test('el período de cada hoja sale de su nombre; las sin año toman el de la última que lo dice', () => {
  const p = P.periodosDeHojas_(HOJAS_IVA);
  assert.equal(p['SEPTIEMBRE 2026'], '2026-M09');
  assert.equal(p['Hoja 23'], '');
  assert.equal(p['ENERO 23'], '2023-M01');
  // Al final del libro las viejas van en orden ascendente: todas son de 2022.
  assert.equal(p.SEPTIEMBRE, '2022-M09');
  assert.equal(p.OCTUBRE, '2022-M10');
  assert.equal(p['DICIEMBRE '], '2022-M12');
  assert.equal(P.periodosDeHojas_(['AGOSTO25'])['AGOSTO25'], '2025-M08');
});

test('encabezado de dos niveles: "quién realiza" y "fecha" son del bloque que firman', () => {
  const grupos = ['', '', 'CENTRALIZACIONES', '', '', '', '', '', 'PAGOS', '', ''];
  const enc = ['EMPRESA', 'ASIENTO DE APERTURA', 'QUIEN REALIZA', 'FECHA REALIZACION', 'COMPRAS', 'QUIEN REALIZA', 'FECHA REALIZACION', 'VENTAS', 'QUIEN REALIZA', 'FECHA REALIZACION', 'COMPRAS'];
  const cols = P.columnasDeEncabezado_(enc, grupos, { siempreGrupo: true, gruposValidos: ['CENTRALIZACIONES', 'PAGOS'], sinGrupo: ['EMPRESA', 'ASIENTO DE APERTURA'] });
  assert.deepEqual(cols.map((c) => c.clave), [
    'EMPRESA', 'ASIENTO DE APERTURA', 'CENTRALIZACIONES / QUIEN REALIZA > COMPRAS', 'CENTRALIZACIONES / FECHA REALIZACION > COMPRAS', 'CENTRALIZACIONES / COMPRAS',
    'CENTRALIZACIONES / QUIEN REALIZA > VENTAS', 'CENTRALIZACIONES / FECHA REALIZACION > VENTAS', 'CENTRALIZACIONES / VENTAS',
    'PAGOS / QUIEN REALIZA > COMPRAS', 'PAGOS / FECHA REALIZACION > COMPRAS', 'PAGOS / COMPRAS'
  ]);
});

test('importar una hoja mensual: espejo de la fila, cliente, responsable, situación, NA y claves', () => {
  const db = crear();
  const sim = Imp.importarHoja(db, { archivo: LIBRO_IVA, hoja: 'SEPTIEMBRE 2026', hojas: HOJAS_IVA, filas: hojaIva(), simular: true }, ADM);
  assert.equal(sim.matriz, 'IVA');
  assert.equal(sim.periodo, '2026-M09');
  assert.equal(sim.nuevas, 3, 'la lista pegada abajo no cuenta');
  assert.deepEqual(sim.columnas_excluidas, ['USUARIO']);
  assert.equal(registros(db, 'IVA').length, 0, 'simular no escribe');

  const r = Imp.importarHoja(db, { archivo: LIBRO_IVA, hoja: 'SEPTIEMBRE 2026', hojas: HOJAS_IVA, filas: hojaIva() }, ADM);
  assert.equal(r.nuevas, 3);
  const regs = CI.listar(db, { matriz: 'IVA', periodo: '2026-M09' }, ADM).registros;
  const aton = regs.find((x) => x.cliente_id === 'CLI-1');
  assert.equal(aton.datos.monto_pre_iva, 1250000);
  assert.equal(aton.datos.fecha_declaracion, '2026-09-15');
  assert.equal(aton.responsable_email, 'francisca@homepymes.cl');
  assert.equal(aton.datos.quien_realiza, 'FRANCISCA');
  assert.equal(aton.estado, 'TERMINADO');
  assert.equal(aton.datos.usuario, undefined, 'la columna USUARIO no se guarda');
  const pyme = regs.find((x) => x.cliente_id === 'CLI-2');
  assert.equal(pyme.datos.monto_pre_iva, 'NA', '"NA" se ve igual que en la planilla');
  assert.equal(pyme.datos.obs, '[clave omitida]');
  assert.equal(pyme.estado, 'PENDIENTE', 'ENVIADO EL F29 = NO');
  const nuevo = regs.find((x) => !x.cliente_id);
  assert.equal(nuevo.cliente_nombre, 'Cliente Nuevo SpA');
  assert.equal(r.fuera_catalogo, 1);
  assert.deepEqual(r.sin_cuenta, ['Paulette']);
  // Mismo orden que la planilla.
  assert.deepEqual(regs.map((x) => x.cliente_nombre), ['ATON CONSTRUCCIONES SPA', 'Pyme Sur Limitada', 'Cliente Nuevo SpA']);
  // Volver a importar lo mismo no duplica.
  assert.equal(Imp.importarHoja(db, { archivo: LIBRO_IVA, hoja: 'SEPTIEMBRE 2026', hojas: HOJAS_IVA, filas: hojaIva() }, ADM).ya_estaban, 3);
  assert.equal(registros(db, 'IVA').length, 3);
});

test('una versión vieja del encabezado ("PRE IVA") cae en la misma columna; solo ADM importa', () => {
  const db = crear();
  const r = Imp.importarHoja(db, { archivo: LIBRO_IVA, hoja: 'ENERO 23', hojas: HOJAS_IVA, filas: hojaIva('PRE IVA') }, ADM);
  assert.equal(r.periodo, '2023-M01');
  const aton = CI.listar(db, { matriz: 'IVA', periodo: '2023-M01' }, ADM).registros.find((x) => x.cliente_id === 'CLI-1');
  assert.equal(aton.datos.monto_pre_iva, 1250000);
  assert.equal(Imp.importarHoja(db, { archivo: LIBRO_IVA, hoja: 'ENERO 23', hojas: HOJAS_IVA, filas: hojaIva() }, OTRO)._forbidden, true);
  assert.equal(Imp.importarHoja(db, { archivo: LIBRO_IVA, hoja: 'Hoja 23', hojas: HOJAS_IVA, filas: hojaIva() }, ADM).omitida, true);
});

test('RR.HH.: una hoja = una matriz; el mes sale de la fecha y la fila sin fecha toma el de la anterior', () => {
  const db = crear();
  const filas = [
    ['RH-M-2', 'SOLICITUDES DE CLIENTES'],
    ['RH-M-2.7', 'FINIQUITOS'],
    ['EMPRESA', 'RECEPCION DEL REQUERIMIENTO', 'QUIEN REALIZA', 'CAUSAL DE FINIQUITO', 'NOMBRE', 'RUT', 'N° TRABAJADORES', 'ENVIO DE LA DOC. AL CLIENTE'],
    ['HP-002-1 ATON CONSTRUCCIONES SPA 76.841.123-4', AGO11, 'Francisca', 'RENUNCIA', 'Juan Pérez', '11.111.111-1', '1', AGO31],
    ['HC-010-1 PYME SUR LIMITADA', '', 'Francisca', 'MUTUO ACUERDO', 'Ana Soto', '', '1', ''],
    ['HP-002-1 ATON CONSTRUCCIONES SPA', '0204-04-12', 'Francisca', 'RENUNCIA', 'Luis Díaz', '', '1', '']
  ];
  const r = Imp.importarHoja(db, { archivo: 'control de matrices (2).xlsx', hoja: 'Finiquitos', hojas: ['Finiquitos'], filas }, ADM);
  assert.equal(r.matriz, 'FINIQUITOS');
  assert.equal(r.nuevas, 3);
  const regs = CI.listar(db, { matriz: 'FINIQUITOS', anio: '2026' }, ADM).registros;
  assert.ok(regs.every((x) => x.periodo === '2026-M08'), 'sin fecha o con año mal tipeado: el mes de la fila anterior');
  assert.equal(regs[0].cliente_id, 'CLI-1', 'el código de cliente de la planilla calza con el catálogo');
  assert.equal(regs[1].cliente_id, 'CLI-2');
  assert.equal(regs[0].estado, 'TERMINADO');
  assert.equal(regs[1].estado, 'PENDIENTE');
  assert.equal(regs[2].datos.recepcion_requerimiento, '0204-04-12', 'el valor se conserva tal cual');
});

test('fichas A–W (notificaciones y anotaciones) y subsanación se leen como filas', () => {
  const fichas = [
    [], ['', 'Realizado por:', '', 'Krishna'], ['', 'Última actualización', '', '46175'], [], [],
    ['', 'ATON CONSTRUCCIONES SPA'], [], ['', 'Notificaciones ', '', '', '', '', 'Anotaciones'], [],
    ['', '45478', '', '', '', '', '44218'], ['', 'Giro Pago Diferido 2024', '', '', '', '', 'Debe demostrar domicilio'],
    [], ['', 'Pyme Sur Limitada'], [], ['', 'Notificaciones', '', '', '', '', 'Anotaciones'], [], ['', '45500'], ['', 'Giro renta']
  ];
  const f = Imp.filasDeFichas_(fichas);
  assert.equal(f.length, 3);
  assert.deepEqual(f.map((x) => [x.datos.empresa, x.datos.tipo, x.datos.fecha]), [
    ['ATON CONSTRUCCIONES SPA', 'NOTIFICACIÓN', '2024-07-05'], ['ATON CONSTRUCCIONES SPA', 'ANOTACIÓN', '2021-01-22'], ['Pyme Sur Limitada', 'NOTIFICACIÓN', '2024-07-27']
  ]);
  assert.equal(f[0].datos.realizado_por, 'Krishna');
  const subs = [
    [], [], ['', 'EMPRESAS QUE SE DEBE DEMOSTRAR'], [],
    ['', 'Con domicilio en Grecia 1938', '', '', '', 'PETICIÓN', '', '', 'Otro domicilio'],
    ['N°', '', '', '', '', 'fecha', 'folio', 'N°'],
    ['1.0', 'ATON CONSTRUCCIONES SPA', '', '', '', '45917.0', '7.7325920254E10', '1.0', 'PYME SUR LIMITADA', '', '', '', '', '', '', '1.0', 'LOS MANZANOS 1237'],
    ['', '', '', '', 'segunda peticion', '45931.0', '7.7325941447E10']
  ];
  const s = Imp.filasDeSubsanacion_(subs);
  assert.equal(s.length, 2);
  assert.equal(s[0].datos.peticion_1_fecha, '2025-09-17');
  assert.equal(s[0].datos.peticion_2_folio, '77325941447');
  assert.equal(s[1].datos.domicilio, 'LOS MANZANOS 1237');
  assert.equal(s[1].datos.seccion, 'Otro domicilio');
});

test('preparar la importación borra lo importado (también la estructura vieja) y conserva lo ingresado a mano', () => {
  const db = crear();
  Imp.importarHoja(db, { archivo: LIBRO_IVA, hoja: 'SEPTIEMBRE 2026', hojas: HOJAS_IVA, filas: hojaIva() }, ADM);
  CI.guardar(db, { matriz: 'IVA', periodo: '2026-M10', cliente_id: 'CLI-1', datos: { obs: 'a mano' } }, ADM);
  // Fila de la carga anterior: matriz que ya no existe, con _origen.
  agregarFila_(db, 'CI_REGISTROS', { registro_id: 'viejo', depto: 'RRHH', matriz: 'CERTIFICADOS', periodo: '2026-M01', datos: { _origen: 'x' }, estado: 'PENDIENTE', activa: true });
  const sim = Imp.prepararImportacion(db, { simular: true }, ADM);
  assert.equal(sim.a_borrar, 4);
  assert.equal(sim.conservadas_a_mano, 1);
  assert.equal(registros(db, 'IVA').length, 4, 'simular no borra');
  assert.equal(Imp.prepararImportacion(db, { simular: true }, OTRO)._forbidden, true);
  Imp.prepararImportacion(db, {}, ADM);
  const quedan = leerFilas_(db, 'CI_REGISTROS', COLUMNAS.CI_REGISTROS);
  assert.equal(quedan.length, 1);
  assert.equal(quedan[0].datos.obs, 'a mano');
});

test('reportes: informe mensual, panel histórico, ficha por cliente y personas y tiempos', () => {
  const db = crear();
  Imp.importarHoja(db, { archivo: LIBRO_IVA, hoja: 'SEPTIEMBRE 2026', hojas: HOJAS_IVA, filas: hojaIva() }, ADM);
  Imp.importarHoja(db, { archivo: LIBRO_IVA, hoja: 'AGOSTO 2026', hojas: HOJAS_IVA, filas: hojaIva() }, ADM);
  const inf = Rep.informeMensual(db, { matriz: 'IVA', periodo: '2026-M09' }, ADM);
  assert.equal(inf.resumen.clientes_activos, 3);
  assert.equal(inf.resumen.terminados, 1);
  assert.equal(inf.resumen.avance_pct, 33);
  assert.equal(inf.anterior.periodo, '2026-M08');
  assert.equal(inf.anterior.filas, 3);
  assert.equal(inf.detalle.length, 3);
  assert.ok(inf.montos.find((m) => m.clave === 'monto_pre_iva').total === 1250000);
  const pan = Rep.panelHistorico(db, { matriz: 'IVA', desde: '2026-M01', hasta: '2026-M09' }, ADM);
  assert.equal(pan.serie.find((s) => s.periodo === '2026-M09').total, 3);
  assert.equal(pan.anio_contra_anio[0].meses[7], 3, 'agosto');
  const ficha = Rep.fichaCliente(db, { cliente_id: 'CLI-1' }, ADM);
  assert.equal(ficha.total_filas, 2);
  assert.equal(ficha.matrices[0].clave, 'IVA');
  const busq = Rep.buscarClientes(db, { q: 'aton' }, ADM);
  assert.equal(busq.clientes[0].cliente_id, 'CLI-1');
  const per = Rep.personasTiempos(db, { depto: 'CONTABILIDAD', desde: '2026-M08', hasta: '2026-M09' }, ADM);
  assert.equal(per.personas.find((p) => p.clave === 'francisca@homepymes.cl').total, 4);
  assert.ok(per.total_pendientes >= 2);
  assert.equal(Rep.informeMensual(db, { matriz: 'IVA' }, { email: 'x@x.cl', rol: 'DEV', modulos: [] })._forbidden, true);
});
