'use strict';

/**
 * El "personal activo" de SIGSO (directorioPersonal.js) sale solo de las
 * cuentas del portal (2026-09-30). USUARIOS era la identidad de Google de Apps
 * Script, apagada el 2026-09-27: quien solo está ahí ya no puede entrar.
 *
 * Caso real medido en la copia de producción: el correo VIEJO de una persona
 * (hoy entra con otro) seguía apareciendo en Calidad → Accesos con un rol, en
 * la matriz de distribución y como destinatario de "Enviar alerta".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, agregarFila_ } = require('../db/sqliteRepo');
const { asegurarEsquema } = require('../db/schema');
const { directorioPersonalActivo_ } = require('../logica/directorioPersonal');
const Calidad = require('../logica/calidadSgc');

const CTX_ADM = { email: 'admin@grupohb.cl', nombre: 'Admin', rol: 'ADM' };

function db_() {
  const db = abrirDb_();
  asegurarEsquema(db);
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'C1', usuario: 'ventas', nombre: 'Valentina Caballero', hash_password: 'h', salt: 's',
    emails: JSON.stringify(['ventas@grupohb.cl']), rol: 'DEV', empresa_id: 'HP', activo: true, creado_por: 'seed' });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'C2', usuario: 'falvarez', nombre: 'Felipe Alvarez', hash_password: 'h', salt: 's',
    emails: JSON.stringify(['falvarez@grupohb.cl', 'contacto@rld.cl']), rol: 'DEV', empresa_id: 'RLD', activo: true, creado_por: 'seed' });
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U1', nombre: 'Valentina Caballero', email: 'vcaballero@impulsapartners.cl', empresa_id: 'HP', rol: 'DEV', activo: true, creado_por: 'seed' });
  agregarFila_(db, 'SGC_ROLES', { rol_id: 'R1', usuario_email: 'vcaballero@impulsapartners.cl', rol_sgc: 'OPERATIVO', activo: true });
  agregarFila_(db, 'SGC_ROLES', { rol_id: 'R2', usuario_email: 'ventas@grupohb.cl', rol_sgc: 'OPERATIVO', activo: true });
  asegurarEsquema(db); // siembra el Directorio de Personas con las cuentas
  return db;
}

test('el personal activo son las cuentas del portal (un correo por fila), no la identidad de Google', () => {
  const emails = directorioPersonalActivo_(db_()).map((p) => p.email).sort();
  assert.deepEqual(emails, ['contacto@rld.cl', 'falvarez@grupohb.cl', 'ventas@grupohb.cl']);
});

test('Accesos: el rol que quedó en el correo viejo aparece como "rol sin cuenta" (para limpiarlo), no como una persona', () => {
  const r = Calidad.listarAccesos(db_(), {}, CTX_ADM);
  assert.ok(!r.cuentas.some((c) => c.email === 'vcaballero@impulsapartners.cl'));
  assert.equal(r.cuentas.find((c) => c.email === 'ventas@grupohb.cl').rol_sgc, 'OPERATIVO', 'su rol real sigue');
  assert.deepEqual(r.enrolamiento.roles_sin_cuenta.map((x) => x.email), ['vcaballero@impulsapartners.cl']);
});
