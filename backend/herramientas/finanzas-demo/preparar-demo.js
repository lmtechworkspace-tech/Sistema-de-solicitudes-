'use strict';

/**
 * preparar-demo.js — base de DEMOSTRACIÓN de Finanzas (datos inventados) para ver
 * y probar el módulo en local: tres meses de cartola, registro con borradores,
 * fondos, cobranza con facturas de dos emisores y planificación.
 *
 *   node backend/herramientas/finanzas-demo/preparar-demo.js <carpeta-demo>
 *   node backend/herramientas/finanzas-demo/servidor.js <carpeta-demo>
 *
 * La carpeta debe estar FUERA del repositorio y llamarse «demo…» (ver guardia.js).
 * La clave y los secretos TOTP se generan al azar y quedan en <carpeta>/acceso.txt.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const G = require('./guardia');

const DIR = G.carpetaSegura(process.argv[2]);
G.prepararCarpeta(DIR, { SIGSO_FINANZAS_ACCESO: 'c-demo,c-lee', SIGSO_FINANZAS_SOLO_LECTURA: 'c-lee' });

const { sembrarTabla_, agregarFila_ } = require(G.RAIZ + '/db/sqliteRepo');
const { COLUMNAS } = require(G.RAIZ + '/db/schema');
const Hash = require(G.RAIZ + '/logica/passwordHash');
const B = require(G.RAIZ + '/logica/finanzasBoveda');
const F = require(G.RAIZ + '/logica/finanzasBancos');
const Op = require(G.RAIZ + '/logica/finanzasOperaciones');
const Fo = require(G.RAIZ + '/logica/finanzasFondos');
const Pl = require(G.RAIZ + '/logica/finanzasPlanificacion');
const Co = require(G.RAIZ + '/logica/finanzasCobranza');
const { cartola } = require(G.RAIZ + '/test/_finanzasPrueba');

const db = require(G.RAIZ + '/db').abrirDbProduccion();
Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* ya existe */ } });
const clave = 'demo-' + crypto.randomBytes(5).toString('hex');
const cuenta = (id, usuario, nombre, rol) => {
  const salt = Hash.generarSalt();
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: id, usuario, nombre, emails: '["' + usuario + '@demo.invalid"]', rol, modulos: '[]', activo: true, salt, hash_password: Hash.hashPassword(clave, salt), debe_cambiar_password: false, super_admin: false });
};
cuenta('c-demo', 'demo', 'Operadora Demo', 'ADM');
cuenta('c-lee', 'lectura', 'Gerencia Demo', 'GERENCIA');
[['CL-1', 'ANDES MONTAJES INDUSTRIALES SPA', '76.086.428-5'], ['CL-2', 'CONSTRUCTORA NORTE SPA', '77.123.456-1'], ['CL-3', 'PANADERIA SOL DE MAYO SPA', '76.543.210-3'], ['CL-4', 'ELECTRICA PACIFICO LTDA', '76.111.222-9'], ['CL-5', 'TRANSPORTES DEL SUR LTDA', '78.222.333-4']]
  .forEach((c) => agregarFila_(db, 'CAT_CLIENTES', { cliente_id: c[0], razon_social: c[1], rut: c[2], activo: true }));
agregarFila_(db, 'PROYECTOS', { proyecto_id: 'PY-1', codigo: 'PY-1', nombre: 'Implementación ERP cliente', estado: 'EN_CURSO', activa: true, presupuesto_monto: 3000000 });

const ctx = { cuenta_id: 'c-demo', email: 'demo@demo.invalid' }, ctxL = { cuenta_id: 'c-lee', email: 'lectura@demo.invalid' };
const activar = (c) => {
  const p = B.prepararAutenticador(db, { password: clave }, c);
  const sec = p.clave.replace(/ /g, '');
  const r = B.activarAutenticador(db, { codigo: B.codigoTotp(sec, B.contadorActual_(Date.now())) }, c);
  return { sec, tok: r.boveda_token };
};
const a1 = activar(ctx), a2 = activar(ctxL);
fs.writeFileSync(path.join(DIR, 'acceso.txt'), 'Base de DEMOSTRACIÓN (datos ficticios). Usuarios: demo (opera) y lectura (solo lectura).\nClave: ' + clave + '\nSecretos TOTP: demo ' + a1.sec + ' · lectura ' + a2.sec + '\n');
fs.writeFileSync(path.join(DIR, 'secretos.json'), JSON.stringify({ clave, demo: a1.sec, lectura: a2.sec }));
const D = (o) => Object.assign({ boveda_token: a1.tok }, o);
const ok = (r, q) => { if (!r || r._validationError || r._forbidden || r.ok === false) throw new Error(q + ': ' + JSON.stringify(r).slice(0, 300)); return r; };

// Cartolas ficticias: agosto, septiembre y octubre.
ok(F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola([
  ['04/08/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '1'], ['05/08/2026', 'TRANSFER DE CONSTRUCTORA NORTE', 0, 1200000, '2'], ['08/08/2026', 'PAGO CUENTAS VIA INTERNET', 980000, 0, '3'],
  ['10/08/2026', 'ARRIENDO OFICINA', 450000, 0, '4'], ['12/08/2026', 'TRANSFER DE PANADERIA SOL', 0, 119000, '5'], ['20/08/2026', 'REMUNERACIONES', 1800000, 0, '6'], ['25/08/2026', 'TRANSFER DE ELECTRICA PACIF', 0, 238000, '7']
], { anterior: 5200000, periodo: '01-08-2026 al 31-08-2026' }) }), ctx), 'cartola ago');
ok(F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola([
  ['03/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '11'], ['05/09/2026', 'TRANSFER DE CONSTRUCTORA NORTE', 0, 900000, '12'], ['09/09/2026', 'PAGO CUENTAS VIA INTERNET', 870000, 0, '13'],
  ['10/09/2026', 'ARRIENDO OFICINA', 450000, 0, '14'], ['15/09/2026', 'TRANSFER DE TRANSPORTES DEL', 0, 476000, '15'], ['20/09/2026', 'REMUNERACIONES', 1800000, 0, '16'], ['28/09/2026', 'INTERNET Y TELEFONIA', 89000, 0, '17']
], { anterior: 3884000, periodo: '01-09-2026 al 30-09-2026' }) }), ctx), 'cartola sep');
ok(F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola([
  ['02/10/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '21'], ['06/10/2026', 'TRANSFER DE CONSTRUCTORA NORTE', 0, 1500000, '22'], ['08/10/2026', 'PAGO CUENTAS VIA INTERNET', 1350000, 0, '23'],
  ['10/10/2026', 'ARRIENDO OFICINA', 450000, 0, '24'], ['14/10/2026', 'TRANSFER DE PANADERIA SOL', 0, 619000, '25']
], { anterior: 2408000, periodo: '01-10-2026 al 31-10-2026' }) }), ctx), 'cartola oct');

// Lo de la cartola clasificado y confirmado; octubre queda en parte por revisar.
const clasif = {
  'TRANSFER DE ANDES MONTAJE': { tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' },
  'TRANSFER DE CONSTRUCTORA NORTE': { tipo: 'FONDO_RECIBIDO', subtipo: 'RECEPCION', cuenta: 'Imposiciones', cliente_id: 'CL-2' },
  'PAGO CUENTAS VIA INTERNET': { tipo: 'FONDO_PAGADO', subtipo: 'PAGO_OBLIGACION', cuenta: 'Imposiciones', cliente_id: 'CL-2' },
  'ARRIENDO OFICINA': { tipo: 'EGRESO', cuenta: 'Arriendo Mensual' }, REMUNERACIONES: { tipo: 'EGRESO', cuenta: 'Sueldos' }, 'INTERNET Y TELEFONIA': { tipo: 'EGRESO', cuenta: 'Cuentas Básicas' },
  'TRANSFER DE PANADERIA SOL': { tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-3' }, 'TRANSFER DE ELECTRICA PACIF': { tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-4' },
  'TRANSFER DE TRANSPORTES DEL': { tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-5' }
};
const items = [];
['2026-08', '2026-09', '2026-10'].forEach((p) => (F.movimientos(db, D({ periodo: p, filtro: 'todos' }), ctx).movimientos || []).forEach((m) => {
  const c = clasif[m.glosa]; if (!c || m.fecha >= '2026-10-08') return;
  items.push(Object.assign({ id: m.id, expected_version: m.version, recordar: false }, c));
}));
ok(F.clasificar(db, D({ items }), ctx), 'clasificar');

// Registro diario: confirmadas, borradores y una que calza con la cartola de octubre.
ok(Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-10-14', sentido: 'ENTRADA', monto: 619000, tercero: 'Panadería Sol de Mayo', referencia: 'TRF 5521', tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-3', confirmar: true }), ctx), 'op 1');
ok(Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-10-15', sentido: 'ENTRADA', monto: 300000, tercero: 'Constructora Norte', tipo: 'FONDO_RECIBIDO', subtipo: 'RECEPCION', cuenta: 'IVA', cliente_id: 'CL-2', periodo_obligacion: '2026-09', confirmar: true }), ctx), 'op 2');
ok(Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-10-16', sentido: 'SALIDA', medio: 'EFECTIVO', monto: 25000, tercero: 'Caja chica', tipo: 'EGRESO', cuenta: 'Caja Chica', confirmar: true }), ctx), 'op 3');
ok(Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-10-17', sentido: 'SALIDA', monto: 89000, tercero: 'Movistar', tipo: 'EGRESO' }), ctx), 'borrador 1');
ok(Op.guardar(db, D({ empresa: 'HomePymes', fecha: '2026-10-18', sentido: 'ENTRADA', monto: 476000, tercero: 'Transportes del Sur' }), ctx), 'borrador 2');
ok(Op.guardar(db, D({ idempotency_key: 'demo-arriendo', empresa: 'HomePymes', fecha: '2026-10-10', sentido: 'SALIDA', monto: 500000, tercero: 'Inmobiliaria Centro', referencia: 'Arriendo oct', tipo: 'EGRESO', cuenta: 'Arriendo Mensual', confirmar: true }), ctx), 'arriendo (banco $450.000)');

// Fondos: una gestión y un saldo inicial propuesto (queda por aprobar).
const g = ok(Fo.guardarGestion(db, D({ cliente_id: 'CL-2', empresa: 'HomePymes', obligacion: 'Imposiciones', periodo_obligacion: '2026-08', solicitado: 1200000, destinos: [{ nombre: 'Obra Norte', monto: 980000 }] }), ctx), 'gestión');
ok(Fo.guardarApertura(db, D({ cliente_id: 'CL-2', empresa: 'HomePymes', fecha_corte: '2026-07-31', monto: 150000, fuente: 'Planilla SIGECO al 31-07 (demo)', gestion_id: g.id }), ctx), 'apertura');

// Cobranza: facturas de dos emisores (el mismo folio en ambos), una nota de crédito y un tercero que paga por otro.
const ENC = 'Nro;Tipo Doc;Tipo Venta;Rut cliente;Razon Social;Folio;Fecha Docto;Fecha Recepcion;Fecha Acuse Recibo;Fecha Reclamo;Monto Exento;Monto Neto;Monto IVA;Monto total';
ok(Co.importarVentas(db, D({ empresa: 'HomePymes', nombre: 'RCV_VENTA_demo_HP_202610.csv', texto: [ENC,
  '1;33;Del Giro;76543210-3;PANADERIA SOL DE MAYO SPA;9001;01/09/2026;;;;0;420168;79832;500000', '2;33;Del Giro;76543210-3;PANADERIA SOL DE MAYO SPA;9002;01/10/2026;;;;0;252101;47899;300000',
  '3;33;Del Giro;76111222-9;ELECTRICA PACIFICO LTDA;9003;15/09/2026;;;;0;168067;31933;200000', '4;33;Del Giro;78222333-4;TRANSPORTES DEL SUR LTDA;9004;05/10/2026;;;;0;400000;76000;476000',
  '5;61;Del Giro;76543210-3;PANADERIA SOL DE MAYO SPA;50;03/10/2026;;;;0;42017;7983;50000'].join('\n') }), ctx), 'ventas HP');
ok(Co.importarVentas(db, D({ empresa: 'GDE', nombre: 'RCV_VENTA_demo_GDE_202610.csv', texto: [ENC, '1;33;Del Giro;76543210-3;PANADERIA SOL DE MAYO SPA;9001;01/09/2026;;;;0;100840;19160;120000'].join('\n') }), ctx), 'ventas GDE');
{
  const nc = Co.facturas(db, D({ estado: 'todas' }), ctx).facturas.find((x) => Number(x.tipo_doc) === 61);
  ok(Co.editarFactura(db, D({ id: nc.id, expected_version: nc.version, referencia: '9002' }), ctx), 'referencia NC');
}
ok(Co.guardarRelacion(db, D({ tipo: 'CLIENTE', pagador_id: 'CL-5', beneficiario_id: 'CL-4', emisor: 'HomePymes', desde: '2026-09-01', hasta: '2026-12-31', autorizado_por: 'Gerencia (demo)', motivo: 'Transportes del Sur paga los servicios de Eléctrica Pacífico (demo)' }), ctx), 'relación de terceros');

// Planificación.
ok(Pl.guardarGastoCompartido(db, D({ periodo: '2026-09', pagadora: 'HomePymes', concepto: 'Arriendo oficina (compartido)', monto: 450000, reparto: { modo: 'PORCENTAJE', partes: [{ empresa: 'HomePymes', valor: 60 }, { empresa: 'GDE', valor: 40 }] } }), ctx), 'gasto compartido');
ok(Pl.guardarPrestamo(db, D({ origen: 'HomePymes', destino: 'GDE', monto: 1000000, fecha: '2026-09-03', concepto: 'Capital de trabajo' }), ctx), 'préstamo');
ok(Pl.guardarCompromiso(db, D({ fecha: '2026-11-10', empresa: 'HomePymes', monto: 450000, concepto: 'Arriendo oficina', sentido: 'SALIDA', tipo: 'CONFIRMADO', recurrencia: 'MENSUAL' }), ctx), 'compromiso');

console.log('Demo lista en ' + DIR + ' (usuarios y clave en acceso.txt).');
