'use strict';

/**
 * serviciosSolicitud.js — Solicitudes, etapa 2 (auditoría 2026-10-05,
 * decisiones del dueño: el módulo es para TODOS los departamentos; la
 * jefatura reparte y los miembros toman).
 *
 * Un pedido ya no va "al área de una persona" (CAT_AREAS) sino a un
 * DEPARTAMENTO del organigrama (los mismos de controlInternoMatrices:
 * Contabilidad, RR.HH., Prevención, Marketing, Facturación y Cobranzas,
 * Administración) y, dentro de él, a un SERVICIO del catálogo, con su plazo.
 *
 * Quién es quién en cada departamento sale de la MISMA lista que ya usa el
 * módulo del área (CI_MIEMBROS): JEFATURA reparte y puede actuar sobre todo
 * lo del departamento; REGISTRA toma lo que llega sin asignar y trabaja lo
 * suyo; LECTURA solo mira. No hay una lista nueva que mantener.
 *
 * El catálogo (SOL_SERVICIOS) lo arma la jefatura del departamento (o ADM),
 * y puede partir de los servicios del mapa de procesos del SGC
 * (SGC_PROCESOS nivel SERVICIO, DOC-10 a DOC-13). Si un departamento no
 * tiene servicios, igual recibe pedidos: "Otro pedido" existe siempre.
 *
 * "Soporte de plataformas" (Desarrollo / TI) NO está aquí: sigue con su
 * formulario técnico (plataforma, módulo, tipo, gravedad) y su ruteo.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { DEPARTAMENTOS } = require('./controlInternoMatrices');
const DirectorioPersonas = require('./directorioPersonas');

const HORAS_JORNADA = 9; // la misma jornada con que cumplimiento.js mide los plazos
const PLAZO_DIAS_DEFECTO = 3;
const PRIORIDAD_DEFECTO = 'P3';
const PRIORIDADES = ['P1', 'P2', 'P3', 'P4', 'P5'];
const ROLES_QUE_TRABAJAN = ['JEFATURA', 'REGISTRA'];
// Etapa 4: el formulario muestra el cliente solo si el servicio lo pide.
const PIDE_CLIENTE = ['no', 'opcional', 'si'];
function pideCliente_(v) { return PIDE_CLIENTE.indexOf(v) !== -1 ? v : 'opcional'; }

function esVerdadero_(v) { return v === true || v === 'TRUE' || v === 1 || v === 'true'; }
function normalizarEmail_(e) { return String(e || '').trim().toLowerCase(); }
function leerSeguro_(db, hoja) { try { return leerFilas_(db, hoja, COLUMNAS[hoja]); } catch (err) { return []; } }
function error_(m) { return { _validationError: true, message: m, fields: [] }; }
function prohibido_(m) { return { _forbidden: true, message: m }; }

// Departamentos que reciben pedidos (todos los del organigrama).
function departamentos_() { return DEPARTAMENTOS.map((d) => ({ clave: d.clave, nombre: d.nombre, icono: d.icono })); }
function departamento_(clave) { return departamentos_().find((d) => d.clave === String(clave || '').toUpperCase()) || null; }

// --- quién está en cada departamento -----------------------------------------------------

function miembrosActivos_(db) { return leerSeguro_(db, 'CI_MIEMBROS').filter((m) => esVerdadero_(m.activa)); }

/** { CLAVE: 'JEFATURA'|'REGISTRA'|'LECTURA' } de una persona. ADM = JEFATURA en todos. */
function rolesEnDeptos_(db, contexto) {
  const roles = {};
  if (contexto && contexto.rol === 'ADM') { departamentos_().forEach((d) => { roles[d.clave] = 'JEFATURA'; }); return roles; }
  const email = normalizarEmail_(contexto && contexto.email);
  if (!email) return roles;
  const rango = { JEFATURA: 3, REGISTRA: 2, LECTURA: 1 };
  miembrosActivos_(db).forEach((m) => {
    if (normalizarEmail_(m.usuario_email) !== email || !departamento_(m.depto)) return;
    if (!roles[m.depto] || (rango[m.rol] || 0) > (rango[roles[m.depto]] || 0)) roles[m.depto] = m.rol;
  });
  return roles;
}
/** Los departamentos donde la persona está en la lista (cualquier rol), sin contar ADM. */
function colasDe_(db, contexto) {
  return Object.keys(rolesEnDeptos_(db, Object.assign({}, contexto, { rol: '' })));
}
/** Correos de quienes trabajan el departamento: [{email, rol}] (JEFATURA primero). */
function equipoDepto_(db, clave) {
  const vistos = {};
  return miembrosActivos_(db)
    .filter((m) => m.depto === clave && ROLES_QUE_TRABAJAN.indexOf(m.rol) !== -1)
    .sort((a, b) => (a.rol === 'JEFATURA' ? 0 : 1) - (b.rol === 'JEFATURA' ? 0 : 1))
    .map((m) => ({ email: normalizarEmail_(m.usuario_email), rol: m.rol }))
    .filter((m) => { if (!m.email || vistos[m.email]) return false; vistos[m.email] = true; return true; });
}
function puedeTrabajar_(rol) { return ROLES_QUE_TRABAJAN.indexOf(rol) !== -1; }
/**
 * El mismo equipo, con la persona completa (2026-10-06): [{email, rol,
 * nombre, cargo, empresa}]. Es lo que ve quien pide: a quiénes les llega
 * y, si quiere, a cuál de ellos se lo envía directamente.
 */
function personasDepto_(db, clave) {
  const equipo = equipoDepto_(db, clave);
  const f = DirectorioPersonas.fichas(db, equipo.map((m) => m.email));
  return equipo.map((m) => Object.assign({ rol: m.rol }, f[m.email] || { email: m.email, nombre: m.email, cargo: '', empresa: '' }));
}

// --- catálogo ----------------------------------------------------------------------------

function servicios_(db) { return leerSeguro_(db, 'SOL_SERVICIOS'); }
function servicioPorId_(db, id) { return id ? servicios_(db).find((s) => s.servicio_id === id) || null : null; }
function proyectar_(s) {
  return {
    servicio_id: s.servicio_id, depto: s.depto, nombre: s.nombre, descripcion: s.descripcion || '',
    ayuda: s.ayuda || '', plazo_dias: Number(s.plazo_dias) || PLAZO_DIAS_DEFECTO,
    prioridad: PRIORIDADES.indexOf(s.prioridad) !== -1 ? s.prioridad : PRIORIDAD_DEFECTO,
    proceso_codigo: s.proceso_codigo || '', orden: Number(s.orden) || 0, activa: esVerdadero_(s.activa),
    pide_cliente: pideCliente_(s.pide_cliente)
  };
}
function ordenar_(a, b) { return (a.orden - b.orden) || a.nombre.localeCompare(b.nombre, 'es'); }

/**
 * Lo que ve el formulario de Nueva solicitud: cada departamento con sus
 * servicios activos y QUIÉNES lo reciben (nombre, cargo, empresa). Si no
 * tiene a nadie, el pedido igual entra y lo ve Administración del sistema.
 * Exige sesión (no es acción pública), así que el correo puede viajar: es
 * con lo que se elige a una persona en particular.
 */
function catalogo(db) {
  const todos = servicios_(db).map(proyectar_).filter((s) => s.activa);
  return {
    departamentos: departamentos_().map((d) => {
      const equipo = personasDepto_(db, d.clave);
      return Object.assign({}, d, {
        servicios: todos.filter((s) => s.depto === d.clave).sort(ordenar_),
        equipo: equipo,
        con_equipo: equipo.length > 0
      });
    })
  };
}

function puedeAdministrar_(db, contexto, depto) {
  return (contexto && contexto.rol === 'ADM') || rolesEnDeptos_(db, contexto)[depto] === 'JEFATURA';
}

/** Para administrar el catálogo: todos los servicios (también los desactivados) de los deptos que la persona administra. */
function listarAdmin(db, data, contexto) {
  const roles = rolesEnDeptos_(db, contexto);
  const deptos = departamentos_().filter((d) => roles[d.clave] === 'JEFATURA');
  if (!deptos.length) return prohibido_('Solo la jefatura del departamento administra su catálogo de servicios.');
  const todos = servicios_(db).map(proyectar_);
  return {
    departamentos: deptos.map((d) => Object.assign({}, d, { servicios: todos.filter((s) => s.depto === d.clave).sort(ordenar_) })),
    procesos_disponibles: deptos.reduce((acc, d) => { acc[d.clave] = procesosDelDepto_(db, d.clave).length; return acc; }, {})
  };
}

function guardar(db, data, contexto) {
  const d = data || {};
  const existente = d.servicio_id ? servicioPorId_(db, d.servicio_id) : null;
  const depto = existente ? existente.depto : String(d.depto || '').toUpperCase();
  if (!departamento_(depto)) return error_('Elige el departamento.');
  if (!puedeAdministrar_(db, contexto, depto)) return prohibido_('Solo la jefatura de ' + departamento_(depto).nombre + ' administra su catálogo.');
  const nombre = String(d.nombre !== undefined ? d.nombre : (existente || {}).nombre || '').trim();
  if (nombre.length < 3) return error_('El nombre del servicio debe tener al menos 3 caracteres.');
  const plazo = Number(d.plazo_dias !== undefined ? d.plazo_dias : (existente || {}).plazo_dias || PLAZO_DIAS_DEFECTO);
  if (!(plazo >= 1 && plazo <= 60) || Math.floor(plazo) !== plazo) return error_('El plazo va en días hábiles: un número entero de 1 a 60.');
  const prioridad = String(d.prioridad || (existente || {}).prioridad || PRIORIDAD_DEFECTO);
  if (PRIORIDADES.indexOf(prioridad) === -1) return error_('Prioridad inválida.');
  const duplicado = servicios_(db).find((s) => s.depto === depto && esVerdadero_(s.activa) && s.servicio_id !== (existente || {}).servicio_id &&
    String(s.nombre).trim().toLowerCase() === nombre.toLowerCase());
  if (duplicado) return error_('Ya existe un servicio activo con ese nombre en el departamento.');
  const ahora = new Date().toISOString();
  const campos = {
    nombre, plazo_dias: plazo, prioridad,
    descripcion: String(d.descripcion !== undefined ? d.descripcion : (existente || {}).descripcion || '').trim().slice(0, 500),
    ayuda: String(d.ayuda !== undefined ? d.ayuda : (existente || {}).ayuda || '').trim().slice(0, 300),
    orden: Number(d.orden !== undefined ? d.orden : (existente || {}).orden || 0) || 0,
    pide_cliente: pideCliente_(d.pide_cliente !== undefined ? d.pide_cliente : (existente || {}).pide_cliente),
    activa: d.activa === undefined ? (existente ? esVerdadero_(existente.activa) : true) : esVerdadero_(d.activa),
    actualizado_por: normalizarEmail_(contexto.email), fecha_actualizacion: ahora
  };
  if (existente) {
    actualizarFilaPorId_(db, 'SOL_SERVICIOS', 'servicio_id', existente.servicio_id, campos);
    return proyectar_(Object.assign({}, existente, campos));
  }
  const fila = Object.assign({
    servicio_id: 'SRV-' + crypto.randomUUID().slice(0, 8).toUpperCase(), depto,
    proceso_codigo: String(d.proceso_codigo || ''), creado_por: normalizarEmail_(contexto.email), fecha_creacion: ahora
  }, campos);
  agregarFila_(db, 'SOL_SERVICIOS', fila);
  return proyectar_(fila);
}

// Servicios del mapa de procesos del SGC (DOC-10 a 13) que son de este departamento.
function procesosDelDepto_(db, depto) {
  let lista = [];
  try { lista = procesosServicioLocal_(db); } catch (err) { lista = []; }
  const area = (DEPARTAMENTOS.find((d) => d.clave === depto) || {}).area || depto;
  return lista.filter((p) => p.clave_area === area);
}
function procesosServicioLocal_(db) {
  const { claveArea_ } = require('./prestacionesSgc');
  const todos = leerSeguro_(db, 'SGC_PROCESOS').filter((p) => esVerdadero_(p.activa));
  const porId = {};
  todos.forEach((p) => { porId[p.proceso_id] = p; });
  return todos.filter((p) => p.nivel === 'SERVICIO').map((p) => Object.assign({}, p, {
    clave_area: claveArea_(p.area || (porId[p.proceso_padre_id] || {}).area)
  }));
}

/** Crea en el catálogo los servicios del mapa de procesos que aún no están (por código). */
function importarDesdeProcesos(db, data, contexto) {
  const depto = String((data && data.depto) || '').toUpperCase();
  if (!departamento_(depto)) return error_('Elige el departamento.');
  if (!puedeAdministrar_(db, contexto, depto)) return prohibido_('Solo la jefatura de ' + departamento_(depto).nombre + ' administra su catálogo.');
  const ya = {};
  servicios_(db).filter((s) => s.depto === depto).forEach((s) => { if (s.proceso_codigo) ya[s.proceso_codigo] = true; ya['n:' + String(s.nombre).trim().toLowerCase()] = true; });
  const procesos = procesosDelDepto_(db, depto).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
  let creados = 0;
  procesos.forEach((p, i) => {
    if (ya[p.codigo] || ya['n:' + String(p.nombre).trim().toLowerCase()]) return;
    const r = guardar(db, { depto, nombre: p.nombre, descripcion: p.objetivo || '', orden: (i + 1) * 10 }, contexto);
    if (r && !r._validationError && !r._forbidden) {
      actualizarFilaPorId_(db, 'SOL_SERVICIOS', 'servicio_id', r.servicio_id, { proceso_codigo: p.codigo || '' });
      creados++;
    }
  });
  return { creados, revisados: procesos.length };
}

/** Lo que un servicio fija en el ítem al crearse: prioridad y plazo (horas hábiles). */
function condicionesDelServicio_(db, servicioId, urgente, slaPorPrioridad) {
  const s = servicioId ? servicioPorId_(db, servicioId) : null;
  const base = s ? proyectar_(s) : null;
  let prioridad = base ? base.prioridad : PRIORIDAD_DEFECTO;
  if (urgente && PRIORIDADES.indexOf(prioridad) > PRIORIDADES.indexOf('P2')) prioridad = 'P2';
  let sla = base ? base.plazo_dias * HORAS_JORNADA : slaPorPrioridad(prioridad);
  if (urgente) {
    const slaUrgente = slaPorPrioridad('P2');
    if (slaUrgente !== '' && (sla === '' || Number(slaUrgente) < Number(sla))) sla = Number(slaUrgente);
  }
  return { servicio: base, prioridad, sla };
}

module.exports = {
  catalogo, listarAdmin, guardar, importarDesdeProcesos,
  departamentos_, departamento_, rolesEnDeptos_, colasDe_, equipoDepto_, personasDepto_, puedeTrabajar_, condicionesDelServicio_,
  servicioPorId_, HORAS_JORNADA, PLAZO_DIAS_DEFECTO
};
