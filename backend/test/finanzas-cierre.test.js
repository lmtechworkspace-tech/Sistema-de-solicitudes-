'use strict';

/**
 * Finanzas, Etapa 6 (2026-10-06): cierre de mes, paralelo con la planilla
 * SIGECO y lista de retiro. Datos FICTICIOS.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const B = require('../logica/finanzasBoveda');
const F = require('../logica/finanzasBancos');
const C = require('../logica/finanzasCierre');

function cartola(movs, anterior, periodo) {
  let saldo = anterior;
  const filas = [];
  filas[2] = ['Empresa', null, null, null, 'EMPRESA DEMO SPA'];
  filas[3] = ['N° de cuenta', null, null, null, '1111', null, null, null, 'Periodo', null, periodo];
  const c = movs.reduce((s, m) => s + (m[2] || 0), 0), a = movs.reduce((s, m) => s + (m[3] || 0), 0);
  filas[8] = ['Periodo', null, null, null, 'Saldo Anterior', null, 'Total Cargos y Cheques', null, 'Total Abonos y Depósitos', null, 'Saldo Contable Final del Periodo'];
  filas[9] = [periodo, null, null, null, String(anterior), null, String(c), null, String(a), null, String(anterior - c + a)];
  filas[17] = ['Fecha', null, 'Sucursal', null, null, 'Descripción', null, 'N° Documento', null, 'Cheques y otros cargos', 'Depósitos y Abono', 'Saldo diario'];
  movs.forEach((m, i) => { saldo = saldo - (m[2] || 0) + (m[3] || 0); filas[18 + i] = [m[0], null, 'OF', null, null, m[1], null, m[4] || String(i + 1), null, m[2] ? String(m[2]) : null, m[3] ? String(m[3]) : null, String(saldo)]; });
  return filas;
}

function preparar(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigso-finx-'));
  const previo = { a: process.env.SIGSO_FINANZAS_DB_PATH, b: process.env.SIGSO_FINANZAS_LLAVE, c: process.env.SIGSO_FINANZAS_ACCESO, d: process.env.SIGSO_FINANZAS_SOLO_LECTURA };
  process.env.SIGSO_FINANZAS_DB_PATH = path.join(dir, 'finanzas.db');
  process.env.SIGSO_FINANZAS_LLAVE = crypto.randomBytes(32).toString('base64');
  process.env.SIGSO_FINANZAS_ACCESO = 'c-1';
  delete process.env.SIGSO_FINANZAS_SOLO_LECTURA;
  B.reiniciarParaPruebas_();
  t.after(() => {
    B.reiniciarParaPruebas_();
    const r = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
    r('SIGSO_FINANZAS_DB_PATH', previo.a); r('SIGSO_FINANZAS_LLAVE', previo.b); r('SIGSO_FINANZAS_ACCESO', previo.c); r('SIGSO_FINANZAS_SOLO_LECTURA', previo.d);
  });
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'c-1', usuario: 'uno', nombre: 'Persona Uno', emails: '["uno@demo.cl"]', rol: 'DEV', modulos: '[]', activo: true });
  const tok = crypto.randomBytes(16).toString('hex');
  B.dbFin().prepare('INSERT INTO FIN_SESIONES (token_hash, cuenta_id, creada_en, ultimo_uso) VALUES (?,?,?,?)').run(crypto.createHash('sha256').update(tok).digest('hex'), 'c-1', Date.now(), Date.now());
  const ctx = { cuenta_id: 'c-1', email: 'uno@demo.cl' };
  const D = (o) => Object.assign({ boveda_token: tok }, o);
  // Agosto en dos cartolas, la segunda deja un hueco del 16 al 19.
  F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola([['05/08/2026', 'HONORARIOS', 0, 500000], ['10/08/2026', 'SUELDOS', 300000, 0]], 1000000, '01-08-2026 al 15-08-2026') }), ctx);
  return { db, ctx, D };
}
const todosConfirmados = (db, D, ctx, periodo) => {
  const mv = F.movimientos(db, D({ periodo }), ctx).movimientos.filter((m) => m.estado !== 'CONFIRMADO');
  return F.clasificar(db, D({ items: mv.map((m) => ({ id: m.id, tipo: m.abono ? 'INGRESO' : 'EGRESO', cuenta: m.abono ? 'Servicio Mensual' : 'Sueldos' })) }), ctx);
};

test('la lista del mes pide cartolas completas, que cuadren y nada sin revisar; recién ahí se cierra', (t) => {
  const { db, ctx, D } = preparar(t);
  let mes = C.estado(db, D({}), ctx).meses.find((m) => m.periodo === '2026-08');
  const paso = (id) => mes.pasos.find((p) => p.id === id);
  assert.equal(paso('cartolas').ok, false, 'falta del 16 al 31');
  assert.match(paso('cartolas').detalle, /falta desde el 16/);
  assert.equal(paso('cuadra').ok, true);
  assert.equal(paso('revisado').ok, false);
  assert.ok(C.cerrar(db, D({ periodo: '2026-08' }), ctx)._validationError);
  F.importarCartola(db, D({ filas: cartola([['20/08/2026', 'ARRIENDO', 100000, 0, '9']], 1200000, '16-08-2026 al 31-08-2026') }), ctx);
  todosConfirmados(db, D, ctx, '2026-08');
  mes = C.estado(db, D({}), ctx).meses.find((m) => m.periodo === '2026-08');
  assert.deepEqual(mes.pasos.filter((p) => p.obligatorio).map((p) => p.ok), [true, true, true]);
  assert.equal(mes.pasos.find((p) => p.id === 'ventas').ok, false, 'aviso, no bloquea');
  const r = C.cerrar(db, D({ periodo: '2026-08' }), ctx);
  assert.equal(r.estado, 'CERRADO');
  assert.deepEqual([r.foto.ingresos, r.foto.egresos, r.foto.resultado], [500000, 400000, 100000]);
});

test('un mes cerrado no se reclasifica ni recibe movimientos nuevos; reabrir exige motivo', (t) => {
  const { db, ctx, D } = preparar(t);
  F.importarCartola(db, D({ filas: cartola([['20/08/2026', 'ARRIENDO', 100000, 0, '9']], 1200000, '16-08-2026 al 31-08-2026') }), ctx);
  todosConfirmados(db, D, ctx, '2026-08');
  C.cerrar(db, D({ periodo: '2026-08' }), ctx);
  const m = F.movimientos(db, D({ periodo: '2026-08' }), ctx).movimientos[0];
  const r = F.clasificar(db, D({ items: [{ id: m.id, tipo: 'INGRESO', cuenta: 'Otros Ingresos' }] }), ctx);
  assert.equal(r.hechos, 0);
  assert.match(r.errores[0].mensaje, /está cerrado/);
  // Volver a subir la misma cartola no molesta (nada nuevo); una con un movimiento nuevo de agosto, sí.
  assert.equal(F.importarCartola(db, D({ filas: cartola([['20/08/2026', 'ARRIENDO', 100000, 0, '9']], 1200000, '16-08-2026 al 31-08-2026') }), ctx).nuevas, 0);
  const nueva = F.importarCartola(db, D({ filas: cartola([['21/08/2026', 'OTRO', 5000, 0, '10']], 1100000, '21-08-2026 al 21-08-2026') }), ctx);
  assert.ok(nueva._validationError);
  assert.match(nueva.message, /mes cerrado \(2026-08\)/);
  assert.ok(C.reabrir(db, D({ periodo: '2026-08', motivo: 'x' }), ctx)._validationError);
  assert.equal(C.reabrir(db, D({ periodo: '2026-08', motivo: 'faltaba una comisión' }), ctx).estado, 'ABIERTO');
  assert.equal(F.clasificar(db, D({ items: [{ id: m.id, tipo: 'INGRESO', cuenta: 'Otros Ingresos' }] }), ctx).hechos, 1);
  const acciones = B.dbFin().prepare('SELECT accion FROM FIN_BITACORA').all().map((x) => x.accion);
  assert.ok(acciones.includes('CERRAR_MES') && acciones.includes('REABRIR_MES'));
});

test('paralelo: compara la planilla con el banco y dice qué falta en cada lado', (t) => {
  const { db, ctx, D } = preparar(t);
  const serial = (iso) => String((Date.parse(iso) - Date.UTC(1899, 11, 30)) / 864e5);
  const banco = [
    ['FECHA', 'BANCO', 'EMPRESA', 'TIPO', 'CLIENTE / GLOSA', 'DETALLE', 'INGRESO', 'EGRESO', 'SALDO', 'ORIGEN', 'OBSERVACIONES'],
    [serial('2026-08-06'), 'BCI', 'HomePymes Antiguo', 'Ingreso', 'X', '', '500000', '', '', 'Manual', ''],
    [serial('2026-08-11'), 'BCI', 'HomePymes', 'Egreso', 'X', '', '', '777', '', 'Manual', ''],
    [serial('2026-08-11'), 'BancoEstado', 'Homeconsulting', 'Egreso', 'X', '', '', '50', '', 'Manual', '']
  ];
  const facturas = [['N° FACTURA', 'FECHA EMISIÓN', 'ID CLIENTE', 'CLIENTE', 'EMPRESA EMISORA', 'CONCEPTO', 'NETO', 'IVA', 'TOTAL', 'FECHA VENCIMIENTO', 'ESTADO'],
    ['501.0', serial('2026-07-01'), 'C1', 'X', 'HomePymes', '', '100', '19', '119', '', 'Vencida']];
  // Para la comparación, el banco BCI de la cartola se llama "BCI" en la planilla.
  const r = C.paralelo(db, D({ banco, facturas }), ctx);
  const ago = r.meses.find((m) => m.periodo === '2026-08');
  assert.equal(ago.planilla.movimientos, 2, 'la de BancoEstado no tiene cartola cargada: va aparte');
  assert.equal(ago.en_ambos, 1);
  assert.deepEqual([ago.solo_banco.n, ago.solo_banco.egresos], [1, 300000], 'los sueldos no estaban en la planilla');
  assert.deepEqual([ago.solo_planilla.n, ago.solo_planilla.egresos], [1, 777]);
  assert.equal(ago.ok, false);
  assert.deepEqual(r.cuentas_sin_cartola, ['Homeconsulting · BANCOESTADO']);
  assert.deepEqual([r.facturas.planilla, r.facturas.faltan_en_boveda, r.facturas.mora_planilla], [1, 1, 119]);
  const ret = C.estado(db, D({}), ctx).retiro;
  assert.equal(ret.automaticos.find((a) => a.id === 'paralelo').ok, false);
});

test('lista de retiro: lo automático se verifica solo y lo manual lo marca una persona', (t) => {
  const { db, ctx, D } = preparar(t);
  let ret = C.estado(db, D({}), ctx).retiro;
  assert.deepEqual(ret.automaticos.map((a) => [a.id, a.ok]), [['autenticadores', false], ['solo_lectura_rogelio', false], ['mes_cerrado', false], ['paralelo', false]]);
  assert.equal(ret.listo_para_archivar, false);
  assert.ok(C.marcarPasoRetiro(db, D({ id: 'inventado', hecho: true }), ctx)._validationError);
  C.marcarPasoRetiro(db, D({ id: 'activadores', hecho: true }), ctx);
  ret = C.estado(db, D({}), ctx).retiro;
  const a = ret.manuales.find((m) => m.id === 'activadores');
  assert.deepEqual([a.ok, a.por], [true, 'Persona Uno']);
  C.marcarPasoRetiro(db, D({ id: 'activadores', hecho: false }), ctx);
  assert.equal(C.estado(db, D({}), ctx).retiro.manuales.find((m) => m.id === 'activadores').ok, false);
});
