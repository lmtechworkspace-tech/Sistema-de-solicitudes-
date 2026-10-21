'use strict';

/**
 * preparar-piloto.js — base FICTICIA para el piloto con las operadoras (I13.3).
 * Deja el mismo punto de partida para cada sesión: seis tareas (cobro mensual,
 * fondos recibidos para una obligación, pagos por destino, pago parcial,
 * pegado con errores y banco posterior). Guion: documentacion/finanzas-v2-correccion/I13-guion-piloto.md
 *
 *   node backend/herramientas/finanzas-demo/preparar-piloto.js <carpeta-piloto>
 *
 * La carpeta debe estar FUERA del repositorio y llamarse «piloto…» (ver guardia.js).
 * Deja ahí: sigso.db, finanzas.db, env.json, acceso.txt (clave y secretos TOTP
 * generados al azar), secretos.json y pegado-piloto.txt. Se borra al terminar el piloto.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const G = require('./guardia');

const DIR = G.carpetaSegura(process.argv[2]);
G.prepararCarpeta(DIR, { SIGSO_FINANZAS_ACCESO: 'c-p1,c-p2,c-lee', SIGSO_FINANZAS_SOLO_LECTURA: 'c-lee' });

const { sembrarTabla_, agregarFila_ } = require(G.RAIZ + '/db/sqliteRepo');
const { COLUMNAS } = require(G.RAIZ + '/db/schema');
const Hash = require(G.RAIZ + '/logica/passwordHash');
const B = require(G.RAIZ + '/logica/finanzasBoveda');
const F = require(G.RAIZ + '/logica/finanzasBancos');
const Op = require(G.RAIZ + '/logica/finanzasOperaciones');
const Co = require(G.RAIZ + '/logica/finanzasCobranza');
const { cartola } = require(G.RAIZ + '/test/_finanzasPrueba');

const db = require(G.RAIZ + '/db').abrirDbProduccion();
Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* ya existe */ } });
const clave = 'piloto-' + crypto.randomBytes(5).toString('hex'); // al azar: no hay una clave conocida que se repita
const cuenta = (id, usuario, nombre, rol) => {
  const salt = Hash.generarSalt();
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: id, usuario, nombre, emails: '["' + usuario + '@piloto.invalid"]', rol, modulos: '[]', activo: true, salt, hash_password: Hash.hashPassword(clave, salt), debe_cambiar_password: false, super_admin: false });
};
cuenta('c-p1', 'piloto1', 'Operadora A (piloto)', 'ADM');
cuenta('c-p2', 'piloto2', 'Operadora B (piloto)', 'ADM');
cuenta('c-lee', 'lectura', 'Gerencia (piloto)', 'GERENCIA');
[['CL-1', 'ANDES MONTAJES INDUSTRIALES SPA', '76.086.428-5'], ['CL-2', 'CONSTRUCTORA NORTE SPA', '77.123.456-1'], ['CL-3', 'PANADERIA SOL DE MAYO SPA', '76.543.210-3'],
  ['CL-4', 'ELECTRICA PACIFICO LTDA', '76.111.222-9'], ['CL-5', 'TRANSPORTES DEL SUR LTDA', '78.222.333-4'], ['CL-6', 'CONSTRUCTORA NORTE GRANDE LTDA', '79.555.666-7']]
  .forEach((c) => agregarFila_(db, 'CAT_CLIENTES', { cliente_id: c[0], razon_social: c[1], rut: c[2], activo: true }));

const ctx = { cuenta_id: 'c-p1', email: 'piloto1@piloto.invalid' };
const activar = (c) => {
  const p = B.prepararAutenticador(db, { password: clave }, c);
  const sec = p.clave.replace(/ /g, '');
  const r = B.activarAutenticador(db, { codigo: B.codigoTotp(sec, B.contadorActual_(Date.now())) }, c);
  return { sec, tok: r.boveda_token };
};
const a1 = activar(ctx), a2 = activar({ cuenta_id: 'c-p2', email: 'piloto2@piloto.invalid' }), a3 = activar({ cuenta_id: 'c-lee', email: 'lectura@piloto.invalid' });
fs.writeFileSync(path.join(DIR, 'acceso.txt'), 'Base de PILOTO (datos ficticios). Usuarios: piloto1, piloto2 (operan) y lectura.\nClave: ' + clave +
  '\nSecretos TOTP (cargar en Authenticator o usar codigo.js): piloto1 ' + a1.sec + ' · piloto2 ' + a2.sec + ' · lectura ' + a3.sec + '\nBorrar esta carpeta al terminar el piloto.\n');
fs.writeFileSync(path.join(DIR, 'secretos.json'), JSON.stringify({ clave, piloto1: a1.sec, piloto2: a2.sec, lectura: a3.sec }));
const D = (o) => Object.assign({ boveda_token: a1.tok }, o);
const ok = (r, q) => { if (!r || r._validationError || r._forbidden || r.ok === false) throw new Error(q + ': ' + JSON.stringify(r).slice(0, 300)); return r; };

// Septiembre ya trabajado; la cartola de octubre trae lo que las tareas tienen que resolver.
ok(F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola([
  ['05/09/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '1'], ['10/09/2026', 'ARRIENDO OFICINA', 450000, 0, '2'], ['20/09/2026', 'REMUNERACIONES', 1800000, 0, '3']
], { anterior: 6000000, periodo: '01-09-2026 al 30-09-2026', numero: '22223333' }) }), ctx), 'cartola sep');
ok(F.importarCartola(db, D({ empresa: 'HomePymes', filas: cartola([
  ['02/10/2026', 'PAGO TRANSF INMOBILIARIA CENTRO', 450000, 0, '11'], // tarea 6: el arriendo registrado el 30-09
  ['05/10/2026', 'TRANSFER DE ANDES MONTAJE', 0, 357000, '12'], // tarea 1: cobro mensual de Andes (factura 9101)
  ['07/10/2026', 'TRANSFER DE CONSTRUCTORA NORTE', 0, 2100000, '13'], // tarea 2: fondos para imposiciones de septiembre
  ['13/10/2026', 'PAGO EN LINEA PREVIRED', 1258430, 0, '14'], ['13/10/2026', 'PAGO EN LINEA PREVIRED', 386260, 0, '15'], ['13/10/2026', 'PAGO EN LINEA PREVIRED', 353571, 0, '16'], // tarea 3
  ['15/10/2026', 'TRANSFER DE PANADERIA SOL', 0, 200000, '17'] // tarea 4: pago parcial de la factura 9102 ($500.000)
], { anterior: 4107000, periodo: '01-10-2026 al 31-10-2026', numero: '22223333' }) }), ctx), 'cartola oct');
const sep = F.movimientos(db, D({ periodo: '2026-09' }), ctx).movimientos;
const cls = { 'TRANSFER DE ANDES MONTAJE': { tipo: 'INGRESO', cuenta: 'Servicio Mensual', cliente_id: 'CL-1' }, 'ARRIENDO OFICINA': { tipo: 'EGRESO', cuenta: 'Arriendo Mensual' }, REMUNERACIONES: { tipo: 'EGRESO', cuenta: 'Sueldos' } };
ok(F.clasificar(db, D({ items: sep.map((m) => Object.assign({ id: m.id, expected_version: m.version, recordar: false }, cls[m.glosa])) }), ctx), 'clasificar sep');
ok(Op.guardar(db, D({ idempotency_key: 'piloto-arriendo', empresa: 'HomePymes', fecha: '2026-09-30', sentido: 'SALIDA', medio: 'TRANSFERENCIA', monto: 450000, tercero: 'Inmobiliaria Centro', referencia: 'Arriendo octubre', tipo: 'EGRESO', cuenta: 'Arriendo Mensual', confirmar: true }), ctx), 'arriendo');
const ENC = 'Nro;Tipo Doc;Tipo Venta;Rut cliente;Razon Social;Folio;Fecha Docto;Fecha Recepcion;Fecha Acuse Recibo;Fecha Reclamo;Monto Exento;Monto Neto;Monto IVA;Monto total';
ok(Co.importarVentas(db, D({ empresa: 'HomePymes', nombre: 'RCV_VENTA_piloto_202610.csv', texto: [ENC,
  '0;33;Del Giro;76086428-5;ANDES MONTAJES INDUSTRIALES SPA;9001;01/09/2026;;;;0;300000;57000;357000',
  '1;33;Del Giro;76086428-5;ANDES MONTAJES INDUSTRIALES SPA;9101;01/10/2026;;;;0;300000;57000;357000',
  '2;33;Del Giro;76543210-3;PANADERIA SOL DE MAYO SPA;9102;01/10/2026;;;;0;420168;79832;500000',
  '3;33;Del Giro;76111222-9;ELECTRICA PACIFICO LTDA;9103;01/10/2026;;;;0;200000;38000;238000'].join('\n') }), ctx), 'ventas');
{ // Septiembre de Andes ya cobrado y aplicado a la 9001: en la tarea 1 solo queda el cobro de octubre.
  const f9001 = Co.facturas(db, D({ estado: 'todas', busca: '9001' }), ctx).facturas.find((x) => x.folio === '9001');
  const el = ok(Co.cobrosElegibles(db, D({ factura_ids: [f9001.id] }), ctx), 'elegibles sep');
  ok(Co.aplicar(db, D({ idempotency_key: 'piloto-sep', grupos: [{ recepcion_ref: el.cobros[0].ref, aplicaciones: [{ factura_id: f9001.id, monto: 357000, expected_version: f9001.version }] }] }), ctx), 'aplicar sep');
}
// Tarea 5: 6 filas como vendrían de la planilla; una fecha imposible y un cliente que calza con dos.
fs.writeFileSync(path.join(DIR, 'pegado-piloto.txt'), [
  ['16/10/2026', 'Movistar', '', 'gasto', 'Cuentas Básicas', '', '89.000'],
  ['16/10/2026', 'Electrica Pacifico', '76.111.222-9', 'ingreso', 'Servicio Mensual', '238.000', ''],
  ['31/09/2026', 'Librería Central', '', 'gasto', 'Otros Egresos', '', '23.500'],
  ['17/10/2026', 'Constructora Norte', 'Constructora Norte', 'fondo recibido', 'IVA', '640.000', ''],
  ['17/10/2026', 'Transportes del Sur', '78.222.333-4', 'ingreso', 'Servicio Mensual', '476.000', ''],
  ['18/10/2026', 'Caja chica', '', 'gasto', 'Caja Chica', '', '25.000']].map((f) => f.join('\t')).join('\n') + '\n');
console.log('Base de piloto lista en ' + DIR + ' (usuarios y clave en acceso.txt).');
