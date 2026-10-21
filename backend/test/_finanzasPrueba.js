'use strict';

/**
 * Ayudante de las pruebas de Finanzas v2 (no es un archivo de pruebas: no
 * termina en .test.js). Arma una bóveda limpia en una carpeta temporal, con
 * dos cuentas en la lista (c-1 opera, c-2 opcionalmente solo lectura),
 * clientes ficticios y una sesión de bóveda abierta. Datos inventados.
 */

const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { abrirDb_, sembrarTabla_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const B = require('../logica/finanzasBoveda');

const MODULOS = ['finanzasCatalogos', 'finanzasHechos', 'finanzasFondos', 'finanzasOperaciones', 'finanzasConciliacion', 'finanzasClientes', 'finanzasPlanificacion', 'finanzasCobranza', 'finanzasReportes', 'finanzasCargas', 'finanzasReglas', 'finanzasExportar'];

function preparar(t, opciones) {
  opciones = opciones || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigso-finv2-'));
  const claves = ['SIGSO_FINANZAS_DB_PATH', 'SIGSO_FINANZAS_LLAVE', 'SIGSO_FINANZAS_ACCESO', 'SIGSO_FINANZAS_SOLO_LECTURA', 'SIGSO_FINANZAS_CAPACIDADES'];
  const previo = {};
  claves.forEach((k) => { previo[k] = process.env[k]; });
  process.env.SIGSO_FINANZAS_DB_PATH = path.join(dir, 'finanzas.db');
  process.env.SIGSO_FINANZAS_LLAVE = crypto.randomBytes(32).toString('base64');
  process.env.SIGSO_FINANZAS_ACCESO = 'c-1,c-2';
  if (opciones.soloLectura) process.env.SIGSO_FINANZAS_SOLO_LECTURA = 'c-2'; else delete process.env.SIGSO_FINANZAS_SOLO_LECTURA;
  if (opciones.capacidades) process.env.SIGSO_FINANZAS_CAPACIDADES = opciones.capacidades; else delete process.env.SIGSO_FINANZAS_CAPACIDADES;
  B.reiniciarParaPruebas_();
  MODULOS.forEach((m) => { try { const x = require('../logica/' + m); if (x.reiniciar_) x.reiniciar_(); } catch (e) { /* módulo aún no existe */ } });
  t.after(() => {
    B.reiniciarParaPruebas_();
    claves.forEach((k) => { if (previo[k] === undefined) delete process.env[k]; else process.env[k] = previo[k]; });
  });
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'c-1', usuario: 'uno', nombre: 'Persona Uno', emails: '["uno@demo.cl"]', rol: 'DEV', modulos: '[]', activo: true });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'c-2', usuario: 'dos', nombre: 'Persona Dos', emails: '["dos@demo.cl"]', rol: 'GERENCIA', modulos: '[]', activo: true });
  [['CL-1', 'ANDES MONTAJES INDUSTRIALES SPA', '76.086.428-5'], ['CL-2', 'CONSTRUCTORA NORTE SPA', '77.123.456-1'], ['CL-3', 'PANADERIA SOL DE MAYO SPA', '76.543.210-3'],
    ['CL-4', 'ELECTRICA PACIFICO LTDA', '76.111.222-9']]
    .forEach((c) => agregarFila_(db, 'CAT_CLIENTES', { cliente_id: c[0], razon_social: c[1], rut: c[2], activo: true }));
  agregarFila_(db, 'PROYECTOS', { proyecto_id: 'PY-1', codigo: 'PY-1', nombre: 'Proyecto de prueba', estado: 'EN_CURSO', activa: true, presupuesto_monto: 1000000 });
  const sesion = (cuentaId) => {
    const tok = crypto.randomBytes(16).toString('hex');
    B.dbFin().prepare('INSERT INTO FIN_SESIONES (token_hash, cuenta_id, creada_en, ultimo_uso) VALUES (?,?,?,?)')
      .run(crypto.createHash('sha256').update(tok).digest('hex'), cuentaId, Date.now(), Date.now());
    return tok;
  };
  const tok1 = sesion('c-1'), tok2 = sesion('c-2');
  const ctx = { cuenta_id: 'c-1', email: 'uno@demo.cl' };
  const ctx2 = { cuenta_id: 'c-2', email: 'dos@demo.cl' };
  const D = (o) => Object.assign({ boveda_token: tok1 }, o);
  const D2 = (o) => Object.assign({ boveda_token: tok2 }, o);
  return { db, ctx, ctx2, D, D2, dir };
}

/** I11.2 · La versión actual de un registro de la bóveda (lo que la pantalla tendría a la vista al guardar). */
function versionDe(tabla, id) {
  try {
    const r = B.dbFin().prepare('SELECT version FROM ' + tabla + ' WHERE id = ?').get(id);
    return r ? (r.version == null ? 0 : r.version) : undefined; // una fila nueva sin versión vale 0 (como la lee el sistema)
  } catch (e) { return undefined; } // la tabla aún no existe: no hay nada que actualizar
}

// Cartola FICTICIA en el formato del BCI (como la entrega lector-xlsx.js).
function cartola(movs, opciones) {
  opciones = opciones || {};
  const anterior = opciones.anterior != null ? opciones.anterior : 1000000;
  let saldo = anterior;
  const filas = [];
  filas[1] = [' Cartola de cuenta corriente'];
  filas[2] = ['Empresa', null, null, null, opciones.titular || 'EMPRESA DEMO SPA'];
  filas[3] = ['N° de cuenta', null, null, null, opciones.numero || '11112222', null, null, null, 'Periodo', null, opciones.periodo || '01-08-2026 al 31-08-2026'];
  const lineas = movs.map((m) => {
    saldo = saldo - (m[2] || 0) + (m[3] || 0);
    return [m[0], null, 'OF', null, null, m[1], null, m[4] || '1', null, m[2] ? m[2].toLocaleString('es-CL') : null, m[3] ? m[3].toLocaleString('es-CL') : null, saldo.toLocaleString('es-CL')];
  });
  const cargos = movs.reduce((s, m) => s + (m[2] || 0), 0), abonos = movs.reduce((s, m) => s + (m[3] || 0), 0);
  filas[8] = ['Periodo', null, null, null, 'Saldo Anterior', null, 'Total Cargos y Cheques', null, 'Total Abonos y Depósitos', null, 'Saldo Contable Final del Periodo'];
  filas[9] = [opciones.periodo || '01-08-2026 al 31-08-2026', null, null, null, anterior.toLocaleString('es-CL'), null, cargos.toLocaleString('es-CL'), null, abonos.toLocaleString('es-CL'), null, (anterior - cargos + abonos).toLocaleString('es-CL')];
  filas[17] = ['Fecha', null, 'Sucursal', null, null, 'Descripción', null, 'N° Documento', null, 'Cheques y otros cargos', 'Depósitos y Abono', 'Saldo diario'];
  lineas.forEach((l, i) => { filas[18 + i] = l; });
  return filas;
}

module.exports = { preparar, cartola, versionDe };
