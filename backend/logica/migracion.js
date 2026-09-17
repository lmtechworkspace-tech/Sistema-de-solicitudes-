'use strict';

/**
 * migracion.js — herramienta TEMPORAL, una sola vez: importa los datos
 * reales de la planilla vieja (exportados a JSON fuera de este backend) a
 * las tablas SQLite del backend nuevo. Se puede borrar (junto a su entrada
 * en router.js) una vez terminado el corte.
 *
 * Por que existe como accion HTTP y no como script suelto contra el archivo
 * de la base de datos: node:sqlite bloquea el archivo en exclusiva mientras
 * el servicio lo tiene abierto (ver nota en sigso-ecosistema-nuevo.md) --
 * hacerlo por HTTP, en el mismo proceso que ya tiene la base abierta, evita
 * parar el servicio y es el mismo patron de siempre (deploy por git, accion
 * por HTTP) en vez de tocar el VPS a mano.
 *
 * importarTabla(db, data, contexto):
 *  - Solo ADM.
 *  - data = { hoja, filas } -- filas es un array de OBJETOS (mismo shape
 *    que agregarFila_), no de arrays posicionales.
 *  - Vacia la tabla y la vuelve a llenar con `filas` (sembrarTabla_, el
 *    mismo primitivo "recrear" que ya usan los tests) -- deliberado: el
 *    unico dato que hay hoy en cada tabla de esta lista es dato de PRUEBA
 *    de este mismo proceso de migracion, nunca dato real de un usuario.
 *  - CUENTAS_PORTAL es un caso especial: el hash_password/salt de la
 *    planilla vieja usa un algoritmo incompatible (SHA-256x1000 vs scrypt,
 *    ver passwordHash.js) -- nunca se copia. Cada cuenta migra con una
 *    clave temporal NUEVA y distinta (debe_cambiar_password=true, mismo
 *    criterio que cuando el Admin crea una cuenta a mano), preservando el
 *    resto de sus datos (usuario, nombre, cargo, emails, rol, modulos,
 *    empresa_id, activo -- incluidas las cuentas ya desactivadas, que NO
 *    se reactivan solo por migrar, ultimo_acceso, creado_por). Devuelve la
 *    lista de claves temporales UNA sola vez, para que el Admin las
 *    redistribuya.
 */

const { sembrarTabla_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion, errorForbidden } = require('./errores');
const Hash = require('./passwordHash');

const TABLAS_MIGRABLES = [
  'CAT_EMPRESAS', 'CAT_PLATAFORMAS', 'CAT_MODULOS', 'CAT_TIPOS', 'CAT_AREAS',
  'CONFIG_NOTIFICACIONES', 'CONFIG_SLA', 'CONFIG_FERIADOS',
  'USUARIOS', 'JEFATURAS',
  'SOLICITUDES', 'SUBSOLICITUDES', 'HISTORIAL_ESTADOS',
  'HISTORIAL_PRIORIDAD', 'HISTORIAL_COMPROMISO', 'HISTORIAL_ASIGNACION',
  'COMENTARIOS', 'ARCHIVOS', 'COUNTERS', 'CUENTAS_PORTAL'
];

function activo_(valor) {
  return valor === true || valor === 'TRUE' || valor === 1;
}

function migrarCuentaPortal_(fila) {
  const claveTemporal = Hash.generarClaveTemporal();
  const salt = Hash.generarSalt();
  return {
    fila: Object.assign({}, fila, {
      hash_password: Hash.hashPassword(claveTemporal, salt),
      salt: salt,
      activo: activo_(fila.activo),
      debe_cambiar_password: true
    }),
    credencial: { usuario: fila.usuario, password_temporal: claveTemporal }
  };
}

function importarTabla(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') {
    return errorForbidden('Solo un Administrador puede importar datos de migracion.');
  }
  const hoja = data && data.hoja;
  if (!hoja || TABLAS_MIGRABLES.indexOf(hoja) === -1) {
    return errorValidacion('hoja', 'Hoja no reconocida para migracion: ' + hoja);
  }
  const columnas = COLUMNAS[hoja];
  const filasEntrada = Array.isArray(data.filas) ? data.filas : [];

  let credenciales;
  const filasFinal = hoja === 'CUENTAS_PORTAL'
    ? filasEntrada.map((f) => {
        const { fila, credencial } = migrarCuentaPortal_(f);
        (credenciales = credenciales || []).push(credencial);
        return fila;
      })
    : filasEntrada;

  const filasPosicionales = filasFinal.map((obj) => columnas.map((c) => (obj[c] !== undefined ? obj[c] : '')));
  sembrarTabla_(db, hoja, columnas, filasPosicionales);

  const resultado = { hoja: hoja, importadas: filasFinal.length };
  if (credenciales) resultado.credenciales = credenciales;
  return resultado;
}

module.exports = { importarTabla, TABLAS_MIGRABLES };
