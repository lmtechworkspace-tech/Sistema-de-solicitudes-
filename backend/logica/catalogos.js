'use strict';

/**
 * catalogos.js — puerto directo de backend/backoffice/Catalogos.gs (CU-006,
 * RF-019, §4.2). Misma logica exacta, mismos casos de prueba (ver
 * backend/test/catalogos-porteo.test.js, portados de
 * backend/test/catalogos-admin.test.js): CRUD sobre los catalogos
 * administrables (crear si no existe, actualizar si existe; "desactivar" es
 * la misma operacion con activo=false -- los catalogos nunca se eliminan).
 *
 * Unica diferencia real con el .gs: en Apps Script leerFilas_/agregarFila_/
 * actualizarFilaPorId_ son globales que ya saben a que spreadsheet ir; aqui
 * reciben `db` como primer argumento explicito (no hay estado global de
 * modulo entre requests en un server Node).
 *
 * Permisos por tipo de catalogo (Actor Admin/Analista, doc 5 v1.0):
 * Admin administra los 4; Analista solo Modulos y Tipos ("nivel basico").
 */

const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { errorValidacion, errorForbidden } = require('./errores');
const { COLUMNAS } = require('../db/schema');
const DirectorioPersonas = require('./directorioPersonas');
const { EMAIL_DESARROLLO } = require('./constantesSolicitudes');

const CATALOGOS_CONFIG = {
  EMPRESA: { hoja: 'CAT_EMPRESAS', idCampo: 'empresa_id', roles: ['ADM'] },
  PLATAFORMA: { hoja: 'CAT_PLATAFORMAS', idCampo: 'plataforma_id', roles: ['ADM'] },
  MODULO: { hoja: 'CAT_MODULOS', idCampo: 'modulo_id', roles: ['ADM', 'ANA'] },
  TIPO: { hoja: 'CAT_TIPOS', idCampo: 'tipo_id', roles: ['ADM', 'ANA'] },
  // v3.0 (Fase 1, multi-responsable): areas -> responsable. Solo Admin: a
  // quien se le rutean las solicitudes es una decision de gobierno, no de
  // operacion diaria (mismo criterio que empresas/plataformas).
  AREA: { hoja: 'CAT_AREAS', idCampo: 'area_id', roles: ['ADM'] },
  // P12 (v2.0, Sprint 3): CONFIG_NOTIFICACIONES via el mismo CRUD generico
  // -- solo Admin, es una decision de gobierno (C2), no de operacion diaria.
  NOTIFICACION: { hoja: 'CONFIG_NOTIFICACIONES', idCampo: 'notif_id', roles: ['ADM'] }
};

function guardar(db, data, contexto) {
  const config = CATALOGOS_CONFIG[data.tipo];
  if (!config) {
    return errorValidacion('tipo', 'Tipo de catalogo desconocido: ' + data.tipo);
  }
  if (config.roles.indexOf(contexto.rol) === -1) {
    return errorForbidden('El rol ' + contexto.rol + ' no puede administrar el catalogo ' + data.tipo + '.');
  }
  if (!data.registro || !data.registro[config.idCampo]) {
    return errorValidacion(config.idCampo, 'Falta el identificador del registro (' + config.idCampo + ').');
  }

  const actualizado = actualizarFilaPorId_(db, config.hoja, config.idCampo, data.registro[config.idCampo], data.registro);
  if (actualizado) {
    return actualizado;
  }
  agregarFila_(db, config.hoja, data.registro);
  return data.registro;
}

/**
 * Lista TODAS las filas de un catalogo (activas e inactivas) para el panel
 * de administracion (§12.6, CU-006) -- a diferencia del catalogo publico de
 * Intake, que solo expone activos al formulario.
 */
function listar(db, data, contexto) {
  const config = CATALOGOS_CONFIG[data.tipo];
  if (!config) {
    return errorValidacion('tipo', 'Tipo de catalogo desconocido: ' + data.tipo);
  }
  if (config.roles.indexOf(contexto.rol) === -1) {
    return errorForbidden('El rol ' + contexto.rol + ' no puede ver el catalogo ' + data.tipo + '.');
  }
  return leerFilas_(db, config.hoja, COLUMNAS[config.hoja]);
}

// Puerto de backend/intake/Catalogos.gs (Catalogos.getAll): el catalogo
// PUBLICO que ve el formulario de nueva solicitud -- solo activos, sin auth,
// y con CAT_AREAS proyectada a {area_id, nombre} (el responsable_email
// nunca viaja al navegador publico; se resuelve server-side en
// crearSolicitud, ver solicitudes.js). No se porta CacheService (300s TTL):
// SQLite local no tiene el costo de red que esa cache evitaba en Sheets.
function activo_(valor) {
  return valor === true || valor === 'TRUE' || valor === 1;
}

function filtrarActivos_(filas) {
  return filas.filter((f) => activo_(f.activo));
}

// 2026-10-05 (auditoría de Solicitudes, etapa 1): en producción CAT_AREAS
// tiene un área POR PERSONA ("RRHH_LISSETH", "CONTABILIDAD_FRANCISCA",
// "DESARROLADOR_LEO") y esos nombres los veía quien pide algo en "¿A qué área
// va dirigida?". Al solicitante se le muestra el DEPARTAMENTO, una vez: lo que
// va antes del "_", con su nombre legible. Mientras el ruteo siga siendo por
// área (la etapa 2 lo lleva a la cola del departamento), cada departamento
// envía a su primera área activa (por area_id), que es como ya estaba
// configurado. Un área sin "_" ("Plataformas", "CONTROL Y GESTIÓN") conserva
// su nombre, con mayúsculas normales.
const NOMBRE_DEPARTAMENTO = {
  RRHH: 'Recursos Humanos', 'RECURSOS HUMANOS': 'Recursos Humanos', CONTABILIDAD: 'Contabilidad',
  FACTURACION: 'Facturación y Cobranzas', COBRANZAS: 'Facturación y Cobranzas',
  PREVENCION: 'Prevención de Riesgos', MARKETING: 'Marketing', COMERCIAL: 'Comercial',
  DESARROLADOR: 'Desarrollo / TI', DESARROLLADOR: 'Desarrollo / TI', DESARROLLO: 'Desarrollo / TI', TI: 'Desarrollo / TI',
  OPERACIONES: 'Operaciones', GERENCIA: 'Gerencia', ADMINISTRACION: 'Administración', CALIDAD: 'Calidad'
};
const MARCAS_DIACRITICAS = new RegExp('[\\u0300-\\u036f]', 'g');
function sinTildes_(t) { return String(t || '').normalize('NFD').replace(MARCAS_DIACRITICAS, ''); }
function nombreLegible_(t) {
  const s = String(t || '').trim().toLowerCase();
  return s.replace(/(^|\s)(\S)/g, (m, sp, c) => sp + c.toUpperCase()).replace(/\b(Y|De|Del|La|Las|El|Los)\b/g, (p) => p.toLowerCase());
}
function departamentoDeArea_(nombre) {
  const base = String(nombre || '').trim();
  const prefijo = base.indexOf('_') !== -1 ? base.slice(0, base.indexOf('_')) : base;
  const clave = sinTildes_(prefijo).toUpperCase().trim();
  if (NOMBRE_DEPARTAMENTO[clave]) return NOMBRE_DEPARTAMENTO[clave];
  // Un nombre ya legible ("Plataformas", "Soporte TI") se respeta tal cual.
  if (base.indexOf('_') === -1 && base !== base.toUpperCase()) return base;
  return nombreLegible_(prefijo);
}
// 2026-10-06 (pedido del dueño): ya no se agrupa por departamento. Mostrar
// solo «Contabilidad» mandaba todo a la primera persona del área sin que nadie
// lo supiera, y «No estoy seguro» no decía a quién llegaba (una solicitud a
// Soporte de plataformas no la vio Leo). Ahora cada opción es UNA PERSONA:
// nombre, cargo y empresa, con su departamento para agruparlas. El correo
// sigue sin viajar (esta acción es pública): el ruteo se hace con area_id.
function proyectarAreasPublicas_(db) {
  let filas;
  try { filas = leerFilas_(db, 'CAT_AREAS', COLUMNAS.CAT_AREAS); } catch (err) { return []; }
  const activas = filtrarActivos_(filas).slice().sort((a, b) => String(a.area_id).localeCompare(String(b.area_id)));
  const fichas = DirectorioPersonas.fichas(db, activas.map((a) => a.responsable_email));
  const vistos = {};
  return activas
    .map((a) => {
      const email = String(a.responsable_email || '').trim().toLowerCase();
      const f = fichas[email];
      const nombre = departamentoDeArea_(a.nombre);
      const persona = f && f.nombre !== email ? f.nombre : '';
      return { area_id: a.area_id, nombre: nombre, persona: persona, cargo: f ? f.cargo : '', empresa: f ? f.empresa : '', _clave: email || a.area_id };
    })
    .filter((a) => { if (vistos[a._clave]) return false; vistos[a._clave] = true; return true; })
    .map((a) => { delete a._clave; return a; })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.persona.localeCompare(b.persona, 'es'));
}

// Quién recibe lo que llega a Soporte de plataformas sin elegir persona
// («No estoy seguro»): el mismo correo al que rutea resolverResponsable_.
function soportePorDefecto_(db) {
  const f = DirectorioPersonas.fichas(db, [EMAIL_DESARROLLO])[EMAIL_DESARROLLO.toLowerCase()];
  return f ? { persona: f.nombre !== f.email ? f.nombre : '', cargo: f.cargo, empresa: f.empresa } : null;
}

function getCatalogosPublicos(db) {
  return {
    empresas: filtrarActivos_(leerFilas_(db, 'CAT_EMPRESAS', COLUMNAS.CAT_EMPRESAS)),
    plataformas: filtrarActivos_(leerFilas_(db, 'CAT_PLATAFORMAS', COLUMNAS.CAT_PLATAFORMAS)),
    modulos: filtrarActivos_(leerFilas_(db, 'CAT_MODULOS', COLUMNAS.CAT_MODULOS)),
    tipos: filtrarActivos_(leerFilas_(db, 'CAT_TIPOS', COLUMNAS.CAT_TIPOS)),
    areas: proyectarAreasPublicas_(db),
    soporte: soportePorDefecto_(db)
  };
}

// Cartera de clientes para el buscador de "Nueva solicitud" (antes
// backend/intake/Catalogos.gs, que la entregaba SIN login a cualquiera: razón
// social, RUT, correo y teléfono de toda la cartera). Acá exige sesión -- el
// router la trata como acción protegida. En el formulario público sin cuenta
// el buscador queda vacío y los datos del cliente se escriben a mano, que es
// el camino que el formulario ya tenía para cuando la cartera no carga.
const CAMPOS_CLIENTE_BUSCADOR = ['cliente_id', 'razon_social', 'rut', 'codigo_cliente', 'contacto',
  'correo', 'telefono', 'representante_legal', 'direccion', 'estado', 'bloqueo'];
function getClientes(db) {
  let filas;
  try { filas = leerFilas_(db, 'CAT_CLIENTES', COLUMNAS.CAT_CLIENTES); } catch (err) { return []; }
  return filtrarActivos_(filas).map((c) => {
    const o = {};
    CAMPOS_CLIENTE_BUSCADOR.forEach((k) => { o[k] = c[k] == null ? '' : c[k]; });
    return o;
  });
}

module.exports = { CATALOGOS_CONFIG, guardar, listar, getCatalogosPublicos, getClientes };
