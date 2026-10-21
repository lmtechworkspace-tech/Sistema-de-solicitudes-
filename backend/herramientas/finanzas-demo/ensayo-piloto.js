'use strict';

/**
 * ensayo-piloto.js — resuelve las 6 tareas del piloto por servicios sobre una
 * COPIA de la base de piloto (la original no se toca) y muestra el resultado
 * esperado de cada una. Sirve para comprobar que el punto de partida se puede
 * resolver; no mide tiempos humanos ni reemplaza la sesión con las operadoras.
 *
 *   node backend/herramientas/finanzas-demo/ensayo-piloto.js <carpeta-piloto>
 *
 * La copia queda en «<carpeta-piloto>-ensayo» (se rehace cada vez).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const G = require('./guardia');

const ORIG = G.carpetaSegura(process.argv[2]);
const DIR = G.carpetaSegura(ORIG + '-ensayo');
fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR);
{
  const { DatabaseSync } = require('node:sqlite');
  ['sigso.db', 'finanzas.db'].forEach((f) => { const d = new DatabaseSync(path.join(ORIG, f)); d.exec("VACUUM INTO '" + path.join(DIR, f).split(path.sep).join('/').replace(/'/g, "''") + "'"); d.close(); });
}
const env = JSON.parse(fs.readFileSync(path.join(ORIG, 'env.json'), 'utf8'));
Object.assign(process.env, env, { SIGSO_DB_PATH: path.join(DIR, 'sigso.db'), SIGSO_FINANZAS_DB_PATH: path.join(DIR, 'finanzas.db') });
const B = require(G.RAIZ + '/logica/finanzasBoveda');
const F = require(G.RAIZ + '/logica/finanzasBancos');
const Op = require(G.RAIZ + '/logica/finanzasOperaciones');
const Co = require(G.RAIZ + '/logica/finanzasCobranza');
const Fo = require(G.RAIZ + '/logica/finanzasFondos');
const Conc = require(G.RAIZ + '/logica/finanzasConciliacion');
const Pe = require(G.RAIZ + '/logica/finanzasPendientes');
const db = require(G.RAIZ + '/db').abrirDbProduccion();
const tok = crypto.randomBytes(16).toString('hex');
B.dbFin().prepare('INSERT INTO FIN_SESIONES (token_hash, cuenta_id, creada_en, ultimo_uso) VALUES (?,?,?,?)').run(crypto.createHash('sha256').update(tok).digest('hex'), 'c-p1', Date.now(), Date.now());
const ctx = { cuenta_id: 'c-p1', email: 'piloto1@piloto.invalid' };
const D = (o) => Object.assign({ boveda_token: tok }, o);
const ok = (r, q) => { if (!r || r._validationError || r._forbidden || r.ok === false) throw new Error(q + ': ' + JSON.stringify(r).slice(0, 400)); return r; };
const mov = (glosa, monto) => F.movimientos(db, D({ periodo: '2026-10' }), ctx).movimientos.find((m) => m.glosa === glosa && (m.abono || m.cargo) === monto && m.estado === 'PENDIENTE');
const conciliar = (m, o, q) => ok(Conc.conciliar(db, D({ movimientos: [{ id: m.id, expected_version: m.version }], operaciones: [{ id: o.id, expected_version: o.version }] }), ctx), q);
const factura = (folio) => Co.facturas(db, D({ estado: 'todas', busca: folio }), ctx).facturas.find((f) => f.folio === folio);
const aplicar = (folio, monto, clave) => {
  const f = factura(folio);
  const el = ok(Co.cobrosElegibles(db, D({ factura_ids: [f.id] }), ctx), clave);
  ok(Co.aplicar(db, D({ idempotency_key: clave, grupos: [{ recepcion_ref: el.cobros[0].ref, aplicaciones: [{ factura_id: f.id, monto, expected_version: f.version }] }] }), ctx), clave);
  const g = factura(folio);
  return [g.saldo_confirmado, g.situacion];
};
const pendientes = () => { const p = Pe.pendientes(db, D({}), ctx); return p.total !== undefined ? p.total : (p.items || []).length; };
const res = { pendientes_al_partir: pendientes() };

// 1 · Cobro mensual de Andes.
const o1 = ok(Op.guardar(db, D({ idempotency_key: 'e1', empresa: 'HomePymes', fecha: '2026-10-05', sentido: 'ENTRADA', medio: 'TRANSFERENCIA', monto: 357000, tercero: 'Andes Montajes', tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1', confirmar: true }), ctx), 't1');
conciliar(mov('TRANSFER DE ANDES MONTAJE', 357000), o1, 't1 conciliar');
res.tarea1_factura_9101 = aplicar('9101', 357000, 'e1-ap');
// 2 y 3 · Fondos para imposiciones de septiembre y tres pagos por obra.
const g = ok(Fo.guardarGestion(db, D({ cliente_id: 'CL-2', empresa: 'HomePymes', obligacion: 'Imposiciones', periodo_obligacion: '2026-09', destinos: [{ nombre: 'Obra A' }, { nombre: 'Obra B' }, { nombre: 'Obra C' }] }), ctx), 't2');
const o2 = ok(Op.guardar(db, D({ idempotency_key: 'e2', empresa: 'HomePymes', fecha: '2026-10-07', sentido: 'ENTRADA', medio: 'TRANSFERENCIA', monto: 2100000, tercero: 'Constructora Norte', tipo: 'FONDO_RECIBIDO', cuenta: 'Imposiciones', cliente_id: 'CL-2', gestion_id: g.id, periodo_obligacion: '2026-09', confirmar: true }), ctx), 't2');
conciliar(mov('TRANSFER DE CONSTRUCTORA NORTE', 2100000), o2, 't2 conciliar');
[['Obra A', 1258430], ['Obra B', 386260], ['Obra C', 353571]].forEach(([destino, monto], i) => {
  const o = ok(Op.guardar(db, D({ idempotency_key: 'e3-' + i, empresa: 'HomePymes', fecha: '2026-10-13', sentido: 'SALIDA', medio: 'TRANSFERENCIA', monto, tercero: 'Previred', tipo: 'FONDO_PAGADO', subtipo: 'PAGO_OBLIGACION', cuenta: 'Imposiciones', cliente_id: 'CL-2', gestion_id: g.id, destino, periodo_obligacion: '2026-09', confirmar: true }), ctx), 't3');
  conciliar(mov('PAGO EN LINEA PREVIRED', monto), o, 't3 conciliar');
});
const ge = ok(Fo.fichaFondos(db, D({ cliente_id: 'CL-2' }), ctx), 'ficha').gestiones.find((x) => x.id === g.id);
res.tareas2y3_gestion = { saldo: ge.saldo, periodo: ge.periodo_obligacion, por_destino: ge.destinos.map((d) => [d.nombre, d.pagado]) };
// 4 · Pago parcial de Panadería.
const o4 = ok(Op.guardar(db, D({ idempotency_key: 'e4', empresa: 'HomePymes', fecha: '2026-10-15', sentido: 'ENTRADA', medio: 'TRANSFERENCIA', monto: 200000, tercero: 'Panadería Sol de Mayo', tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-3', confirmar: true }), ctx), 't4');
conciliar(mov('TRANSFER DE PANADERIA SOL', 200000), o4, 't4 conciliar');
res.tarea4_factura_9102 = aplicar('9102', 200000, 'e4-ap');
// 5 · Pegado: se marcan las 2 filas malas, se corrigen y se publica; repetir no duplica.
const filas = fs.readFileSync(path.join(ORIG, 'pegado-piloto.txt'), 'utf8').trim().split('\n').map((l) => l.split('\t'));
const mapeo = { 0: 'fecha', 1: 'tercero', 2: 'cliente', 3: 'tipo', 4: 'concepto', 5: 'entrada', 6: 'salida' };
const rev = ok(Op.revisarPegado(db, D({ filas, mapeo, empresa: 'HomePymes' }), ctx), 't5');
const corr = filas.map((x) => x.slice()); corr[2][0] = '30/09/2026'; corr[3][2] = '77.123.456-1';
const rev2 = ok(Op.revisarPegado(db, D({ filas: corr, mapeo, empresa: 'HomePymes' }), ctx), 't5 corregido');
const pub = (k) => ok(Op.publicarPegado(db, D({ filas: corr, mapeo, empresa: 'HomePymes', token: rev2.token, seleccion: corr.map((_, i) => i), como: 'BORRADOR' }), ctx), k);
const p1 = pub('t5 publicar'), p2 = pub('t5 repetir');
res.tarea5_pegado = { filas_marcadas: rev.revision.map((r, i) => [i + 1, Object.keys(r.errores || {})]).filter((x) => x[1].length), validas_tras_corregir: rev2.validas, publicadas: p1.publicadas, al_repetir: { publicadas: p2.publicadas, repetidas: p2.repetidas } };
// 6 · Banco posterior al registro.
const arr = Op.listar(db, D({ periodo: '2026-09' }), ctx).operaciones.find((o) => o.tercero === 'Inmobiliaria Centro');
const m6 = mov('PAGO TRANSF INMOBILIARIA CENTRO', 450000);
const cand = ok(Conc.candidatos(db, D({ movimiento_id: m6.id }), ctx), 't6');
conciliar(m6, arr, 't6 conciliar');
const arr2 = Op.listar(db, D({ periodo: '2026-09' }), ctx).operaciones.find((o) => o.id === arr.id);
res.tarea6_banco_posterior = { propuesto: JSON.stringify(cand).indexOf(arr.id) !== -1, fecha: arr2.fecha, conciliacion: arr2.conciliacion };
res.pendientes_al_terminar = pendientes();
console.log(JSON.stringify(res, null, 1));
