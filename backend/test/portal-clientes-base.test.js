'use strict';

/**
 * Portal de clientes · base de contratistas (2026-10-08).
 *  - La ficha de clientes de SIGSO (CAT_CLIENTES) se edita desde el portal, con
 *    RUT válido y sin repetir, y cada cambio queda en el registro.
 *  - Un contratista que no estaba se crea y se habilita en un solo paso; si
 *    algo falla, no queda una ficha a medias.
 *  - Nunca se borra: se da de baja, y no mientras tenga el portal habilitado.
 *  - Solo el super admin o quien él autorice.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { ejecutarAccion } = require('../server/router');
const Sesiones = require('../logica/sesiones');

delete process.env.RESEND_API_KEY;

const SUPER = 'luis@ctrly.cl', VANESSA = 'vanessa@homepymes.cl';

function dv(cuerpo) {
  let suma = 0, mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo[i]) * mult; mult = mult === 7 ? 2 : mult + 1; }
  const r = 11 - (suma % 11);
  return r === 11 ? '0' : (r === 10 ? 'K' : String(r));
}
const rut = (cuerpo) => cuerpo + '-' + dv(cuerpo);

function dbBase() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  sembrarTabla_(db, 'CAT_EMPRESAS', COLUMNAS.CAT_EMPRESAS, [['HP', 'HomePymes', '', true, '']]);
  const vacio = (hoja) => Object.fromEntries(COLUMNAS[hoja].map((c) => [c, '']));
  [['Luis', SUPER, 'ADM', true], ['Vanessa Sepúlveda', VANESSA, 'SOLICITANTE', false]]
    .forEach(([n, e, r, sa]) => agregarFila_(db, 'CUENTAS_PORTAL', Object.assign(vacio('CUENTAS_PORTAL'), {
      cuenta_id: 'c-' + e, usuario: e.split('@')[0], nombre: n, emails: JSON.stringify([e]), rol: r, activo: true, empresa_id: 'HP', super_admin: sa })));
  agregarFila_(db, 'CI_MIEMBROS', { miembro_id: 'm0', depto: 'RRHH', usuario_email: VANESSA, rol: 'REGISTRA', activa: true });
  // CLI-1 trae un RUT antiguo mal escrito (pasa en la base real): igual se pueden corregir sus otros datos.
  [['CLI-1', 'Constructora Cerro Alto SpA', '76.543.210-K'], ['CLI-2', 'Constructora Vecina SpA', rut('77777777')]]
    .forEach(([id, n, r]) => agregarFila_(db, 'CAT_CLIENTES', Object.assign(vacio('CAT_CLIENTES'), { cliente_id: id, razon_social: n, rut: r, activo: true })));
  return db;
}
async function staff(db, email, action, data) {
  return ejecutarAccion(db, action, Object.assign({ portal_token: Sesiones.crearSesion(db, 'c-' + email) }, data || {}), { ip: '10.0.0.1' });
}
const cat = (db) => leerFilas_(db, 'CAT_CLIENTES', COLUMNAS.CAT_CLIENTES);
const registro = (db) => leerFilas_(db, 'PORTAL_REGISTRO', COLUMNAS.PORTAL_REGISTRO);

test('la base se lista y se corrige celda a celda, con validación y registro', async () => {
  const db = dbBase();
  let r = await staff(db, SUPER, 'portalAdmBase');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.data.contratistas.map((c) => c.cliente_id), ['CLI-1', 'CLI-2']);
  assert.equal(r.body.data.contratistas[0].portal, '');

  r = await staff(db, SUPER, 'portalAdmGuardarFicha', { cliente_id: 'CLI-1', cambios: { telefono: '+56 9 1234 5678', correo: 'obra@cerroalto.cl' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.data.cambiados.sort(), ['correo', 'telefono']);
  const c1 = cat(db).find((c) => c.cliente_id === 'CLI-1');
  assert.equal(c1.telefono, '+56 9 1234 5678');
  assert.equal(c1.rut, '76.543.210-K', 'el RUT antiguo no se toca si no se edita');
  const reg = registro(db).filter((x) => x.accion === 'BASE_EDITADA');
  assert.equal(reg.length, 1);
  assert.match(reg[0].detalle, /Teléfono: «» → «\+56 9 1234 5678»/);
  assert.equal(reg[0].actor, SUPER);

  // Sin cambios reales no se escribe ni se registra.
  r = await staff(db, SUPER, 'portalAdmGuardarFicha', { cliente_id: 'CLI-1', cambios: { telefono: '+56 9 1234 5678' } });
  assert.deepEqual(r.body.data.cambiados, []);
  assert.equal(registro(db).filter((x) => x.accion === 'BASE_EDITADA').length, 1);

  for (const [cambios, motivo] of [[{ rut: '76.543.210-0' }, 'RUT inválido'], [{ rut: rut('77777777') }, 'RUT de otro'], [{ razon_social: '  ' }, 'vacía'],
    [{ correo: 'sin-arroba' }, 'correo'], [{ estado: 'X' }, 'campo no editable']]) {
    r = await staff(db, SUPER, 'portalAdmGuardarFicha', { cliente_id: 'CLI-1', cambios });
    assert.equal(r.status, 400, motivo);
  }
  r = await staff(db, SUPER, 'portalAdmGuardarFicha', { cliente_id: 'CLI-1', cambios: { rut: '76543210-3' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(cat(db).find((c) => c.cliente_id === 'CLI-1').rut, '76.543.210-3', 'se guarda con puntos y guion');
});

test('contratista nuevo: solo en la base, o creado y habilitado de una vez', async () => {
  const db = dbBase();
  let r = await staff(db, SUPER, 'portalAdmGuardarFicha', { datos: { razon_social: 'Maestranza Sur Ltda.', rut: '78123456' + dv('78123456') } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.contratista.rut, '78.123.456-' + dv('78123456'));
  assert.equal(r.body.data.contratista.cliente_id, 'CLI-78123456');
  assert.ok(registro(db).some((x) => x.accion === 'BASE_NUEVO' && x.cliente_id === 'CLI-78123456'));
  r = await staff(db, SUPER, 'portalAdmGuardarFicha', { datos: { razon_social: 'Otra', rut: rut('78123456') } });
  assert.equal(r.status, 400, 'el RUT no se repite');

  // Habilitar uno nuevo: si el encargado no es del área, no se crea nada.
  const antes = cat(db).length;
  r = await staff(db, SUPER, 'portalAdmGuardarCliente', { nuevo: { razon_social: 'Obras Norte SpA', rut: rut('79111222') }, servicios: ['RRHH'], encargados: { RRHH: 'nadie@x.cl' } });
  assert.equal(r.status, 400);
  assert.equal(cat(db).length, antes, 'un error no deja una ficha a medias');
  r = await staff(db, SUPER, 'portalAdmGuardarCliente', { nuevo: { razon_social: 'Obras Norte SpA', rut: '79111222' + dv('79111222') }, servicios: ['RRHH'], encargados: { RRHH: VANESSA },
    correo: 'contacto@obrasnorte.cl', telefono: '+56 9 8888 7777' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.cliente.razon_social, 'Obras Norte SpA');
  assert.equal(r.body.data.perfil.habilitado, true);
  const ficha = cat(db).find((c) => c.razon_social === 'Obras Norte SpA');
  assert.equal(ficha.correo, 'contacto@obrasnorte.cl', 'los datos de contacto también quedan en la base');
  r = await staff(db, SUPER, 'portalAdmBase');
  assert.equal(r.body.data.contratistas.find((c) => c.razon_social === 'Obras Norte SpA').portal, 'HABILITADO');
});

test('dar de baja: no con portal habilitado; reactivar; y solo quien administra', async () => {
  const db = dbBase();
  await staff(db, SUPER, 'portalAdmGuardarCliente', { cliente_id: 'CLI-2', habilitado: true });
  let r = await staff(db, SUPER, 'portalAdmGuardarFicha', { cliente_id: 'CLI-2', cambios: { activo: false } });
  assert.equal(r.status, 400, 'tiene el portal habilitado');
  r = await staff(db, SUPER, 'portalAdmGuardarFicha', { cliente_id: 'CLI-1', cambios: { activo: false } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.contratista.activo, false);
  r = await staff(db, SUPER, 'portalAdmEstado');
  assert.ok(!r.body.data.catalogo_clientes.some((c) => c.cliente_id === 'CLI-1'), 'dado de baja no aparece para habilitar');
  r = await staff(db, SUPER, 'portalAdmGuardarFicha', { cliente_id: 'CLI-1', cambios: { activo: true } });
  assert.equal(r.body.data.contratista.activo, true);
  assert.equal(cat(db).length, 2, 'nunca se borra');

  for (const [accion, data] of [['portalAdmBase', {}], ['portalAdmGuardarFicha', { cliente_id: 'CLI-1', cambios: { telefono: '1' } }], ['portalAdmGuardarFicha', { datos: { razon_social: 'X', rut: rut('70000001') } }]]) {
    r = await staff(db, VANESSA, accion, data);
    assert.equal(r.status, 403, accion + ' sin permiso');
  }
  await staff(db, SUPER, 'portalAdmPermisos', { operacion: 'otorgar', email: VANESSA });
  r = await staff(db, VANESSA, 'portalAdmGuardarFicha', { cliente_id: 'CLI-1', cambios: { contacto: 'Rosa Díaz' } });
  assert.equal(r.status, 200, 'con permiso, sí');
});
