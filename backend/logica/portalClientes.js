'use strict';

/**
 * portalClientes.js — Portal de clientes (2026-10-07): SIGSO usado por
 * HomePymes con sus contratistas. Etapa 1, la base segura.
 *
 * Por qué es un mundo aparte de las cuentas del personal: hoy una cuenta
 * SOLICITANTE se trata como DEV en el servidor y los «módulos» de una cuenta
 * solo pintan el menú. Si a un contratista se le diera una cuenta así,
 * llegaría a acciones internas. Aquí, en cambio:
 *  - las personas del cliente viven en PORTAL_CONTACTOS (no en CUENTAS_PORTAL);
 *  - sus sesiones, en PORTAL_SESIONES (solo el hash del token);
 *  - el router despacha SOLO la lista ACCIONES_CLIENTE con `cliente_token`, y
 *    ese token nunca resuelve una sesión del personal (ni al revés);
 *  - cada consulta se acota al cliente_id de la sesión: el cliente nunca lo
 *    elige.
 *
 * Entrada: RUT + clave de 6 números (decisión del dueño: los contratistas
 * saben su RUT de memoria y 6 números se escriben fácil en el teléfono). La
 * primera vez, un enlace de invitación de un solo uso (48 h) que el personal
 * manda por WhatsApp. Freno de fuerza bruta en dos capas: por RUT+IP en
 * memoria (como el login interno) y por contacto en la base (5 fallos = pausa
 * de 15 min; 10 seguidos = bloqueado hasta que alguien del personal lo
 * desbloquee).
 *
 * Quién administra: el super admin y quien él autorice (PORTAL_PERMISOS).
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion, errorForbidden } = require('./errores');
const PH = require('./passwordHash');
const Sesiones = require('./sesiones');
const Servicios = require('./serviciosSolicitud');
const DirectorioPersonas = require('./directorioPersonas');

const HORAS_SESION = 12;
const DIAS_RECORDAR = 90;
const HORAS_INVITACION = 48;
const FALLOS_PAUSA = 5;
const PAUSA_MS = 15 * 60 * 1000;
const FALLOS_BLOQUEO = 10;
const AREAS_PORTAL = ['RRHH', 'CONTABILIDAD', 'PREVENCION'];
const MENSAJE_ENTRADA = 'RUT o clave incorrectos.';
const MENSAJE_INVITACION = 'Este enlace ya no sirve. Pídele uno nuevo a tu encargado.';
// Dónde vive la aplicación del contratista. Mientras no exista
// homepymes.ctrly.cl, GitHub Pages; se cambia con una variable de entorno.
const URL_PORTAL = process.env.PORTAL_CLIENTES_URL || 'https://lmtechworkspace-tech.github.io/Sistema-de-solicitudes-/portal.html';

// ---------------------------------------------------------------- utilidades
function ahora_() { return new Date().toISOString(); }
function v_(x) { return x === true || x === 'TRUE' || x === 1 || x === 'true'; }
function txt_(x, max) { return String(x == null ? '' : x).trim().slice(0, max || 200); }
function leer_(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
function json_(x, def) { if (x && typeof x === 'object') return x; try { return JSON.parse(x || ''); } catch (e) { return def; } }
function normalizarEmail_(e) { return String(e || '').trim().toLowerCase(); }

/** RUT sin puntos ni guion, en mayúsculas: '13456789-2' → '134567892'. */
function rutNorm_(rut) { return String(rut || '').replace(/[^0-9kK]/g, '').toUpperCase(); }
/** Valida el dígito verificador (módulo 11). */
function rutValido_(rut) {
  const r = rutNorm_(rut);
  if (r.length < 2 || r.length > 9) return false;
  const cuerpo = r.slice(0, -1), dv = r.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return false;
  let suma = 0, mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo[i]) * mult; mult = mult === 7 ? 2 : mult + 1; }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? '0' : (resto === 10 ? 'K' : String(resto));
  return dv === esperado;
}
/** '134567892' → '13.456.789-2' */
function rutBonito_(rut) {
  const r = rutNorm_(rut);
  if (r.length < 2) return r;
  return r.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + r.slice(-1);
}
/** Una clave de 6 números que no sea obvia (111111, 123456, 654321). */
function pinDebil_(pin) {
  if (!/^\d{6}$/.test(pin)) return 'La clave son 6 números.';
  if (/^(\d)\1{5}$/.test(pin)) return 'No uses el mismo número 6 veces.';
  const subeOBaja = [1, -1].some((paso) => pin.split('').every((d, i) => i === 0 || Number(d) === (Number(pin[i - 1]) + paso + 10) % 10));
  if (subeOBaja) return 'No uses números seguidos (como 123456).';
  return '';
}
function telefonoWa_(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.length === 9 && d[0] === '9') d = '56' + d;
  return d.length >= 11 ? d : '';
}
function dispositivo_(data) { return txt_(data && data.dispositivo, 120); }

// ---------------------------------------------------------------- registro (evidencia)
function registrar_(db, d) {
  agregarFila_(db, 'PORTAL_REGISTRO', {
    registro_id: crypto.randomUUID(), timestamp: ahora_(),
    cliente_id: d.cliente_id || '', contacto_id: d.contacto_id || '', actor: d.actor || '',
    accion: d.accion, detalle: txt_(d.detalle, 500), ip: d.ip || '', dispositivo: d.dispositivo || ''
  });
}

// ---------------------------------------------------------------- lecturas
function clienteCat_(db, clienteId) { return leer_(db, 'CAT_CLIENTES').find((c) => c.cliente_id === clienteId) || null; }
function perfilCliente_(db, clienteId) { return leer_(db, 'PORTAL_CLIENTES').find((c) => c.cliente_id === clienteId) || null; }
function contacto_(db, id) { return leer_(db, 'PORTAL_CONTACTOS').find((c) => c.contacto_id === id) || null; }
function obras_(db, clienteId) { return leer_(db, 'PORTAL_OBRAS').filter((o) => o.cliente_id === clienteId && v_(o.activa)); }
function contactoPublico_(c) {
  return { contacto_id: c.contacto_id, cliente_id: c.cliente_id, nombre: c.nombre, rut: rutBonito_(c.rut), telefono: c.telefono, correo: c.correo,
    cargo: c.cargo, rol: c.rol, estado: c.estado, ultimo_ingreso: c.ultimo_ingreso,
    invitacion_vigente: c.estado === 'INVITADO' && !!c.invitacion_hash && new Date(c.invitacion_expira).getTime() > Date.now(),
    fecha_creacion: c.fecha_creacion };
}
function encargados_(db, perfil) {
  const e = json_(perfil && perfil.encargados, {}) || {};
  const correos = AREAS_PORTAL.map((a) => e[a]).filter(Boolean);
  const fichas = correos.length ? DirectorioPersonas.fichas(db, correos) : {};
  return AREAS_PORTAL.filter((a) => e[a]).map((a) => {
    const f = fichas[normalizarEmail_(e[a])] || {};
    return { area: a, area_nombre: (Servicios.departamento_(a) || {}).nombre || a, email: normalizarEmail_(e[a]), nombre: f.nombre || e[a], cargo: f.cargo || '' };
  });
}

// ---------------------------------------------------------------- sesiones del contratista
function crearSesion_(db, contacto, recordar, data, ip) {
  const token = crypto.randomBytes(32).toString('base64url');
  const horas = recordar ? DIAS_RECORDAR * 24 : HORAS_SESION;
  agregarFila_(db, 'PORTAL_SESIONES', {
    sesion_id: crypto.randomUUID(), token_hash: PH.hashToken(token), contacto_id: contacto.contacto_id,
    recordar: !!recordar, dispositivo: dispositivo_(data), ip: ip || '', creada: ahora_(),
    expira: new Date(Date.now() + horas * 3600 * 1000).toISOString(), ultimo_uso: ahora_(), revocada: false
  });
  return token;
}
function revocarSesiones_(db, contactoId) {
  leer_(db, 'PORTAL_SESIONES').filter((s) => s.contacto_id === contactoId && !v_(s.revocada))
    .forEach((s) => actualizarFilaPorId_(db, 'PORTAL_SESIONES', 'sesion_id', s.sesion_id, { revocada: true }));
}
/** Contexto del contratista para un token, o null. El cliente_id sale de aquí, nunca del pedido. */
function resolverCliente_(db, token) {
  if (!token) return null;
  const hash = PH.hashToken(token);
  const s = leer_(db, 'PORTAL_SESIONES').find((x) => x.token_hash === hash);
  if (!s || v_(s.revocada) || new Date(s.expira).getTime() <= Date.now()) return null;
  const c = contacto_(db, s.contacto_id);
  if (!c || c.estado !== 'ACTIVO') return null;
  const p = perfilCliente_(db, c.cliente_id);
  if (!p || !v_(p.habilitado)) return null;
  if (Date.now() - new Date(s.ultimo_uso || 0).getTime() > 5 * 60 * 1000) {
    actualizarFilaPorId_(db, 'PORTAL_SESIONES', 'sesion_id', s.sesion_id, { ultimo_uso: ahora_() });
  }
  return { contacto_id: c.contacto_id, cliente_id: c.cliente_id, rol: c.rol, nombre: c.nombre, sesion_id: s.sesion_id };
}

// ---------------------------------------------------------------- acciones del contratista
function invitacionValida_(db, codigo) {
  if (!codigo) return null;
  const hash = PH.hashToken(codigo);
  const c = leer_(db, 'PORTAL_CONTACTOS').find((x) => x.invitacion_hash && x.invitacion_hash === hash);
  if (!c || c.estado === 'BLOQUEADO' || new Date(c.invitacion_expira).getTime() <= Date.now()) return null;
  const p = perfilCliente_(db, c.cliente_id);
  if (!p || !v_(p.habilitado)) return null;
  return c;
}

function verInvitacion(db, data) {
  const c = invitacionValida_(db, txt_(data.invitacion, 100));
  if (!c) return errorForbidden(MENSAJE_INVITACION);
  const cat = clienteCat_(db, c.cliente_id) || {};
  return { nombre: c.nombre, empresa: cat.razon_social || '', rut: rutBonito_(c.rut) };
}

function activar(db, data, meta) {
  const c = invitacionValida_(db, txt_(data.invitacion, 100));
  if (!c) return errorForbidden(MENSAJE_INVITACION);
  const pin = String(data.pin || '');
  const debil = pinDebil_(pin);
  if (debil) return errorValidacion('pin', debil);
  if (String(data.pin2 || '') !== pin) return errorValidacion('pin2', 'Las dos claves no son iguales.');
  const salt = PH.generarSalt();
  actualizarFilaPorId_(db, 'PORTAL_CONTACTOS', 'contacto_id', c.contacto_id, {
    pin_hash: PH.hashPassword(pin, salt), pin_salt: salt, invitacion_hash: '', invitacion_expira: '',
    estado: 'ACTIVO', fallos: 0, pausa_hasta: '', ultimo_ingreso: ahora_(), actualizado_por: 'contacto', fecha_actualizacion: ahora_()
  });
  revocarSesiones_(db, c.contacto_id);
  const ip = (meta && meta.ip) || '';
  const token = crearSesion_(db, c, data.recordar !== false, data, ip);
  registrar_(db, { cliente_id: c.cliente_id, contacto_id: c.contacto_id, actor: 'contacto', accion: 'ACTIVACION', detalle: 'Eligió su clave', ip, dispositivo: dispositivo_(data) });
  registrar_(db, { cliente_id: c.cliente_id, contacto_id: c.contacto_id, actor: 'contacto', accion: 'INGRESO', detalle: data.recordar !== false ? 'Recordar este teléfono' : '', ip, dispositivo: dispositivo_(data) });
  return { cliente_token: token, perfil: perfil_(db, contacto_(db, c.contacto_id)) };
}

function entrar(db, data, meta) {
  const rut = rutNorm_(data.rut);
  const pin = String(data.pin || '');
  const ip = (meta && meta.ip) || '';
  if (!rut || !pin) return errorValidacion('rut', 'Escribe tu RUT y tu clave.');
  const clave = 'cliente:' + rut;
  if (Sesiones.loginBloqueado(clave, ip)) return errorForbidden('Demasiados intentos. Espera 10 minutos y vuelve a intentarlo.');
  const c = leer_(db, 'PORTAL_CONTACTOS').find((x) => x.rut === rut && x.estado !== 'BLOQUEADO' && x.pin_hash);
  // El hash corre siempre (exista o no la persona): el tiempo de respuesta no delata si el RUT existe.
  const ok = PH.coincide(pin, c ? c.pin_salt : 'relleno', c ? c.pin_hash : '00');
  if (c && c.pausa_hasta && new Date(c.pausa_hasta).getTime() > Date.now()) {
    return errorForbidden('Por seguridad, espera unos minutos antes de volver a intentarlo.');
  }
  const perfil = c ? perfilCliente_(db, c.cliente_id) : null;
  if (!c || !ok || c.estado !== 'ACTIVO' || !perfil || !v_(perfil.habilitado)) {
    Sesiones.registrarIntentoFallido(clave, ip);
    if (c) {
      const fallos = (Number(c.fallos) || 0) + 1;
      const cambios = { fallos };
      if (fallos >= FALLOS_BLOQUEO) cambios.estado = 'BLOQUEADO';
      else if (fallos % FALLOS_PAUSA === 0) cambios.pausa_hasta = new Date(Date.now() + PAUSA_MS).toISOString();
      actualizarFilaPorId_(db, 'PORTAL_CONTACTOS', 'contacto_id', c.contacto_id, cambios);
      registrar_(db, { cliente_id: c.cliente_id, contacto_id: c.contacto_id, actor: 'contacto', accion: 'INGRESO_FALLIDO',
        detalle: cambios.estado === 'BLOQUEADO' ? 'Bloqueado tras ' + fallos + ' intentos' : 'Intento ' + fallos, ip, dispositivo: dispositivo_(data) });
    }
    return errorForbidden(MENSAJE_ENTRADA);
  }
  Sesiones.limpiarIntentos(clave, ip);
  actualizarFilaPorId_(db, 'PORTAL_CONTACTOS', 'contacto_id', c.contacto_id, { fallos: 0, pausa_hasta: '', ultimo_ingreso: ahora_() });
  const token = crearSesion_(db, c, !!data.recordar, data, ip);
  registrar_(db, { cliente_id: c.cliente_id, contacto_id: c.contacto_id, actor: 'contacto', accion: 'INGRESO', detalle: data.recordar ? 'Recordar este teléfono' : '', ip, dispositivo: dispositivo_(data) });
  return { cliente_token: token, perfil: perfil_(db, contacto_(db, c.contacto_id)) };
}

function perfil_(db, c) {
  const cat = clienteCat_(db, c.cliente_id) || {};
  const p = perfilCliente_(db, c.cliente_id) || {};
  return {
    marca: { producto: 'SIGSO', empresa: 'HomePymes' },
    contacto: { nombre: c.nombre, rol: c.rol, cargo: c.cargo, rut: rutBonito_(c.rut), telefono: c.telefono, correo: c.correo },
    cliente: { cliente_id: c.cliente_id, razon_social: cat.razon_social || '', rut: rutBonito_(cat.rut), correo: p.correo || '', telefono: p.telefono || '',
      direccion: p.direccion || '', representante: p.representante || '', servicios: json_(p.servicios, []) || [] },
    obras: obras_(db, c.cliente_id).map((o) => ({ obra_id: o.obra_id, nombre: o.nombre, comuna: o.comuna, direccion: o.direccion })),
    encargados: encargados_(db, p).map((e) => ({ area: e.area, area_nombre: e.area_nombre, nombre: e.nombre, cargo: e.cargo }))
  };
}

function sesion(db, data, ctx) { return perfil_(db, contacto_(db, ctx.contacto_id)); }

function salir(db, data, ctx, meta) {
  actualizarFilaPorId_(db, 'PORTAL_SESIONES', 'sesion_id', ctx.sesion_id, { revocada: true });
  registrar_(db, { cliente_id: ctx.cliente_id, contacto_id: ctx.contacto_id, actor: 'contacto', accion: 'SALIDA', ip: (meta && meta.ip) || '' });
  return { ok: true };
}

// «Mis trabajadores»: siempre los del cliente de la sesión.
function trabajadorPublico_(t) {
  return { trabajador_id: t.trabajador_id, obra_id: t.obra_id, nombre: t.nombre, rut: rutBonito_(t.rut), cargo: t.cargo, fecha_inicio: t.fecha_inicio,
    fecha_termino: t.fecha_termino, sueldo: t.sueldo, afp: t.afp, salud: t.salud, estado: t.estado };
}
function trabajadores(db, data, ctx) {
  return { trabajadores: leer_(db, 'PORTAL_TRABAJADORES').filter((t) => t.cliente_id === ctx.cliente_id).map(trabajadorPublico_) };
}
function guardarTrabajador_(db, clienteId, data, actor) {
  const nombre = txt_(data.nombre, 120);
  if (!nombre) return errorValidacion('nombre', 'Escribe el nombre del trabajador.');
  const rut = rutNorm_(data.rut);
  if (rut && !rutValido_(rut)) return errorValidacion('rut', 'Ese RUT no es válido. Revísalo.');
  const obraId = txt_(data.obra_id, 60);
  if (obraId && !obras_(db, clienteId).some((o) => o.obra_id === obraId)) return errorValidacion('obra_id', 'Esa obra no es tuya.');
  const todos = leer_(db, 'PORTAL_TRABAJADORES').filter((t) => t.cliente_id === clienteId);
  const actual = data.trabajador_id ? todos.find((t) => t.trabajador_id === data.trabajador_id) : null;
  if (data.trabajador_id && !actual) return errorValidacion('trabajador_id', 'Ese trabajador no existe.');
  if (rut && todos.some((t) => t.rut === rut && (!actual || t.trabajador_id !== actual.trabajador_id))) return errorValidacion('rut', 'Ya tienes un trabajador con ese RUT.');
  const estado = ['ACTIVO', 'TRAMITE', 'FINIQUITADO'].indexOf(data.estado) !== -1 ? data.estado : (actual ? actual.estado : 'ACTIVO');
  const fila = { obra_id: obraId, nombre, rut, cargo: txt_(data.cargo, 80), fecha_inicio: txt_(data.fecha_inicio, 10), fecha_termino: txt_(data.fecha_termino, 10),
    sueldo: txt_(data.sueldo, 20), afp: txt_(data.afp, 40), salud: txt_(data.salud, 60), estado, actualizado_por: actor, fecha_actualizacion: ahora_() };
  if (actual) { actualizarFilaPorId_(db, 'PORTAL_TRABAJADORES', 'trabajador_id', actual.trabajador_id, fila); return trabajadorPublico_(Object.assign({}, actual, fila)); }
  const nuevo = Object.assign({ trabajador_id: crypto.randomUUID(), cliente_id: clienteId, creado_por: actor, fecha_creacion: ahora_() }, fila);
  agregarFila_(db, 'PORTAL_TRABAJADORES', nuevo);
  return trabajadorPublico_(nuevo);
}
function guardarTrabajador(db, data, ctx, meta) {
  const r = guardarTrabajador_(db, ctx.cliente_id, data, 'contacto:' + ctx.contacto_id);
  if (!r._validationError) registrar_(db, { cliente_id: ctx.cliente_id, contacto_id: ctx.contacto_id, actor: 'contacto', accion: data.trabajador_id ? 'TRABAJADOR_EDITADO' : 'TRABAJADOR_NUEVO', detalle: r.nombre, ip: (meta && meta.ip) || '' });
  return r;
}
function guardarObra_(db, clienteId, data, actor) {
  const nombre = txt_(data.nombre, 100);
  if (!nombre) return errorValidacion('nombre', 'Escribe el nombre de la obra.');
  const actual = data.obra_id ? leer_(db, 'PORTAL_OBRAS').find((o) => o.obra_id === data.obra_id && o.cliente_id === clienteId) : null;
  if (data.obra_id && !actual) return errorValidacion('obra_id', 'Esa obra no existe.');
  const fila = { nombre, comuna: txt_(data.comuna, 60), direccion: txt_(data.direccion, 150), activa: data.activa !== false };
  if (actual) { actualizarFilaPorId_(db, 'PORTAL_OBRAS', 'obra_id', actual.obra_id, fila); return Object.assign({}, actual, fila); }
  const nueva = Object.assign({ obra_id: crypto.randomUUID(), cliente_id: clienteId, creado_por: actor, fecha_creacion: ahora_() }, fila);
  agregarFila_(db, 'PORTAL_OBRAS', nueva);
  return nueva;
}
function guardarObra(db, data, ctx, meta) {
  const r = guardarObra_(db, ctx.cliente_id, data, 'contacto:' + ctx.contacto_id);
  if (!r._validationError) registrar_(db, { cliente_id: ctx.cliente_id, contacto_id: ctx.contacto_id, actor: 'contacto', accion: 'OBRA', detalle: r.nombre, ip: (meta && meta.ip) || '' });
  return r;
}

// Lista CERRADA de lo que un contratista puede hacer. `publica` = sin sesión.
const ACCIONES_CLIENTE = {
  clienteVerInvitacion: { publica: true, fn: verInvitacion },
  clienteActivar: { publica: true, fn: activar },
  clienteEntrar: { publica: true, fn: entrar },
  clienteSesion: { fn: sesion },
  clienteSalir: { fn: salir },
  clienteTrabajadores: { fn: trabajadores },
  clienteGuardarTrabajador: { fn: guardarTrabajador },
  clienteGuardarObra: { fn: guardarObra }
};

async function ejecutarCliente(db, action, data, meta) {
  const def = ACCIONES_CLIENTE[action];
  data = data || {};
  if (def.publica) return def.fn(db, data, meta);
  const ctx = resolverCliente_(db, data.cliente_token);
  if (!ctx) return Object.assign(errorForbidden('Tu sesión terminó. Vuelve a entrar.'), { sesion_vencida: true });
  return def.fn(db, data, ctx, meta);
}

// ---------------------------------------------------------------- administración (personal)
function puedeAdministrar_(db, contexto) {
  if (!contexto) return false;
  if (contexto.super_admin) return true;
  const email = normalizarEmail_(contexto.email);
  return !!email && leer_(db, 'PORTAL_PERMISOS').some((p) => v_(p.activo) && normalizarEmail_(p.usuario_email) === email && p.permiso === 'ADMINISTRAR');
}
function negar_() { return errorForbidden('No tienes permiso para administrar el portal de clientes.'); }
function actorStaff_(contexto) { return normalizarEmail_(contexto.email) || 'personal'; }

function admEstado(db, data, contexto) {
  if (!puedeAdministrar_(db, contexto)) return negar_();
  const perfiles = leer_(db, 'PORTAL_CLIENTES');
  const contactos = leer_(db, 'PORTAL_CONTACTOS');
  const trab = leer_(db, 'PORTAL_TRABAJADORES');
  const cat = leer_(db, 'CAT_CLIENTES');
  const porId = {}; cat.forEach((c) => { porId[c.cliente_id] = c; });
  const clientes = perfiles.map((p) => {
    const cs = contactos.filter((c) => c.cliente_id === p.cliente_id);
    const ult = cs.map((c) => c.ultimo_ingreso).filter(Boolean).sort().pop() || '';
    const c0 = porId[p.cliente_id] || {};
    return { cliente_id: p.cliente_id, razon_social: c0.razon_social || p.cliente_id, rut: rutBonito_(c0.rut), habilitado: v_(p.habilitado),
      contactos: cs.length, activos: cs.filter((c) => c.estado === 'ACTIVO').length, invitados: cs.filter((c) => c.estado === 'INVITADO').length,
      bloqueados: cs.filter((c) => c.estado === 'BLOQUEADO').length, trabajadores: trab.filter((t) => t.cliente_id === p.cliente_id && t.estado !== 'FINIQUITADO').length,
      ultimo_ingreso: ult, encargados: encargados_(db, p) };
  }).sort((a, b) => String(a.razon_social).localeCompare(String(b.razon_social), 'es'));
  const equipos = {};
  AREAS_PORTAL.forEach((a) => {
    const eq = Servicios.equipoDepto_(db, a);
    const f = eq.length ? DirectorioPersonas.fichas(db, eq.map((m) => m.email)) : {};
    equipos[a] = eq.map((m) => ({ email: m.email, nombre: (f[m.email] || {}).nombre || m.email, cargo: (f[m.email] || {}).cargo || '', rol: m.rol }));
  });
  const out = {
    clientes, equipos, areas: AREAS_PORTAL.map((a) => ({ clave: a, nombre: (Servicios.departamento_(a) || {}).nombre || a })),
    catalogo_clientes: cat.filter((c) => v_(c.activo) || c.activo === '').map((c) => ({ cliente_id: c.cliente_id, razon_social: c.razon_social, rut: rutBonito_(c.rut) }))
      .sort((a, b) => String(a.razon_social).localeCompare(String(b.razon_social), 'es')),
    puede_otorgar: !!contexto.super_admin, url_portal: URL_PORTAL
  };
  if (contexto.super_admin) {
    out.permisos = leer_(db, 'PORTAL_PERMISOS').filter((p) => v_(p.activo)).map((p) => ({ permiso_id: p.permiso_id, usuario_email: p.usuario_email, otorgado_por: p.otorgado_por, fecha: p.fecha }));
    out.personal = leer_(db, 'CUENTAS_PORTAL').filter((c) => v_(c.activo)).map((c) => ({ email: normalizarEmail_((json_(c.emails, null) || String(c.emails || '').split(/[,;]/))[0]), nombre: c.nombre }))
      .filter((p) => p.email).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  }
  return out;
}

function admCliente(db, data, contexto) {
  if (!puedeAdministrar_(db, contexto)) return negar_();
  const clienteId = txt_(data.cliente_id, 80);
  const cat = clienteCat_(db, clienteId);
  if (!cat) return errorValidacion('cliente_id', 'Ese cliente no existe en la ficha de clientes.');
  const p = perfilCliente_(db, clienteId) || {};
  const nombres = {};
  leer_(db, 'PORTAL_CONTACTOS').filter((c) => c.cliente_id === clienteId).forEach((c) => { nombres[c.contacto_id] = c.nombre; });
  return {
    cliente: { cliente_id: clienteId, razon_social: cat.razon_social, rut: rutBonito_(cat.rut), contacto_ficha: cat.contacto, correo_ficha: cat.correo, telefono_ficha: cat.telefono, direccion_ficha: cat.direccion },
    perfil: { habilitado: v_(p.habilitado), correo: p.correo || '', telefono: p.telefono || '', direccion: p.direccion || '', representante: p.representante || '',
      servicios: json_(p.servicios, []) || [], encargados: json_(p.encargados, {}) || {}, observaciones: p.observaciones || '', existe: !!p.cliente_id },
    obras: leer_(db, 'PORTAL_OBRAS').filter((o) => o.cliente_id === clienteId),
    contactos: leer_(db, 'PORTAL_CONTACTOS').filter((c) => c.cliente_id === clienteId).map(contactoPublico_),
    trabajadores: leer_(db, 'PORTAL_TRABAJADORES').filter((t) => t.cliente_id === clienteId).map(trabajadorPublico_),
    registro: leer_(db, 'PORTAL_REGISTRO').filter((r) => r.cliente_id === clienteId).slice(-200).reverse()
      .map((r) => Object.assign({}, r, { contacto_nombre: nombres[r.contacto_id] || '' }))
  };
}

function admGuardarCliente(db, data, contexto) {
  if (!puedeAdministrar_(db, contexto)) return negar_();
  const clienteId = txt_(data.cliente_id, 80);
  if (!clienteCat_(db, clienteId)) return errorValidacion('cliente_id', 'Ese cliente no existe en la ficha de clientes.');
  const servicios = (Array.isArray(data.servicios) ? data.servicios : []).filter((a) => AREAS_PORTAL.indexOf(a) !== -1);
  const encargados = {};
  const e = data.encargados || {};
  for (const a of AREAS_PORTAL) {
    const correo = normalizarEmail_(e[a]);
    if (!correo) continue;
    if (!Servicios.equipoDepto_(db, a).some((m) => m.email === correo)) {
      return errorValidacion('encargados', 'La persona elegida para ' + ((Servicios.departamento_(a) || {}).nombre || a) + ' no está en el equipo de esa área.');
    }
    encargados[a] = correo;
  }
  const correo = txt_(data.correo, 120);
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return errorValidacion('correo', 'Ese correo no es válido.');
  const fila = { habilitado: data.habilitado !== false, correo, telefono: txt_(data.telefono, 30), direccion: txt_(data.direccion, 150),
    representante: txt_(data.representante, 120), servicios: JSON.stringify(servicios), encargados: JSON.stringify(encargados),
    observaciones: txt_(data.observaciones, 500), actualizado_por: actorStaff_(contexto), fecha_actualizacion: ahora_() };
  const actual = perfilCliente_(db, clienteId);
  if (actual) actualizarFilaPorId_(db, 'PORTAL_CLIENTES', 'cliente_id', clienteId, fila);
  else agregarFila_(db, 'PORTAL_CLIENTES', Object.assign({ cliente_id: clienteId, creado_por: actorStaff_(contexto), fecha_creacion: ahora_() }, fila));
  registrar_(db, { cliente_id: clienteId, actor: actorStaff_(contexto), accion: actual ? 'CLIENTE_EDITADO' : 'CLIENTE_HABILITADO', detalle: fila.habilitado ? 'Portal habilitado' : 'Portal deshabilitado' });
  return admCliente(db, { cliente_id: clienteId }, contexto);
}

function admGuardarObra(db, data, contexto) {
  if (!puedeAdministrar_(db, contexto)) return negar_();
  const clienteId = txt_(data.cliente_id, 80);
  if (!perfilCliente_(db, clienteId)) return errorValidacion('cliente_id', 'Primero habilita el portal para este cliente.');
  const r = guardarObra_(db, clienteId, data, actorStaff_(contexto));
  if (r._validationError) return r;
  registrar_(db, { cliente_id: clienteId, actor: actorStaff_(contexto), accion: 'OBRA', detalle: r.nombre });
  return admCliente(db, { cliente_id: clienteId }, contexto);
}

function admGuardarTrabajador(db, data, contexto) {
  if (!puedeAdministrar_(db, contexto)) return negar_();
  const clienteId = txt_(data.cliente_id, 80);
  if (!perfilCliente_(db, clienteId)) return errorValidacion('cliente_id', 'Primero habilita el portal para este cliente.');
  const r = guardarTrabajador_(db, clienteId, data, actorStaff_(contexto));
  if (r._validationError) return r;
  registrar_(db, { cliente_id: clienteId, actor: actorStaff_(contexto), accion: data.trabajador_id ? 'TRABAJADOR_EDITADO' : 'TRABAJADOR_NUEVO', detalle: r.nombre });
  return admCliente(db, { cliente_id: clienteId }, contexto);
}

/**
 * Invita (o vuelve a invitar) a una persona del cliente. Devuelve el enlace de
 * un solo uso y el mensaje listo para WhatsApp (wa.me, sin costo). Volver a
 * invitar borra la clave y cierra sus sesiones: así se recupera una clave
 * olvidada.
 */
function admInvitar(db, data, contexto) {
  if (!puedeAdministrar_(db, contexto)) return negar_();
  const clienteId = txt_(data.cliente_id, 80);
  const perfil = perfilCliente_(db, clienteId);
  if (!perfil || !v_(perfil.habilitado)) return errorValidacion('cliente_id', 'Primero habilita el portal para este cliente.');
  const todos = leer_(db, 'PORTAL_CONTACTOS');
  let c = data.contacto_id ? todos.find((x) => x.contacto_id === data.contacto_id && x.cliente_id === clienteId) : null;
  if (data.contacto_id && !c) return errorValidacion('contacto_id', 'Esa persona no existe.');
  const nombre = c && !data.nombre ? c.nombre : txt_(data.nombre, 120);
  const rut = c && !data.rut ? c.rut : rutNorm_(data.rut);
  if (!nombre) return errorValidacion('nombre', 'Escribe el nombre de la persona.');
  if (!rutValido_(rut)) return errorValidacion('rut', 'Ese RUT no es válido. Revísalo.');
  if (todos.some((x) => x.rut === rut && (!c || x.contacto_id !== c.contacto_id))) return errorValidacion('rut', 'Ese RUT ya tiene acceso al portal (en este u otro cliente).');
  const telefono = c && data.telefono === undefined ? c.telefono : txt_(data.telefono, 30);
  const correo = c && data.correo === undefined ? c.correo : txt_(data.correo, 120);
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return errorValidacion('correo', 'Ese correo no es válido.');
  const rol = data.rol === 'COLABORADOR' ? 'COLABORADOR' : (data.rol === 'ADMIN' ? 'ADMIN' : (c ? c.rol : 'ADMIN'));
  const codigo = crypto.randomBytes(24).toString('base64url');
  const fila = { nombre, rut, telefono, correo, cargo: c && data.cargo === undefined ? c.cargo : txt_(data.cargo, 80), rol,
    estado: 'INVITADO', pin_hash: '', pin_salt: '', invitacion_hash: PH.hashToken(codigo),
    invitacion_expira: new Date(Date.now() + HORAS_INVITACION * 3600 * 1000).toISOString(), fallos: 0, pausa_hasta: '',
    actualizado_por: actorStaff_(contexto), fecha_actualizacion: ahora_() };
  if (c) { actualizarFilaPorId_(db, 'PORTAL_CONTACTOS', 'contacto_id', c.contacto_id, fila); revocarSesiones_(db, c.contacto_id); }
  else { c = Object.assign({ contacto_id: crypto.randomUUID(), cliente_id: clienteId, ultimo_ingreso: '', creado_por: actorStaff_(contexto), fecha_creacion: ahora_() }, fila); agregarFila_(db, 'PORTAL_CONTACTOS', c); }
  registrar_(db, { cliente_id: clienteId, contacto_id: c.contacto_id, actor: actorStaff_(contexto), accion: data.contacto_id ? 'INVITACION_NUEVA' : 'INVITACION', detalle: nombre + ' (' + rutBonito_(rut) + ')' });
  const cat = clienteCat_(db, clienteId) || {};
  const enlace = URL_PORTAL + '#invitacion=' + codigo;
  const mensaje = 'Hola ' + nombre.split(' ')[0] + ', te damos acceso al portal de clientes de HomePymes (SIGSO) para ' + (cat.razon_social || 'tu empresa') +
    '. Ahí pides tus trámites, nos mandas documentos y ves en qué va todo.\n\nEntra con este enlace y elige tu clave de 6 números (sirve por 48 horas):\n' + enlace +
    '\n\nDespués entras con tu RUT y esa clave.';
  const tel = telefonoWa_(telefono);
  return { contacto: contactoPublico_(contacto_(db, c.contacto_id)), enlace, mensaje,
    whatsapp: 'https://wa.me/' + tel + '?text=' + encodeURIComponent(mensaje), con_telefono: !!tel, vence: fila.invitacion_expira };
}

function admContacto(db, data, contexto) {
  if (!puedeAdministrar_(db, contexto)) return negar_();
  const c = contacto_(db, txt_(data.contacto_id, 80));
  if (!c) return errorValidacion('contacto_id', 'Esa persona no existe.');
  const op = data.operacion, actor = actorStaff_(contexto);
  if (op === 'bloquear') { actualizarFilaPorId_(db, 'PORTAL_CONTACTOS', 'contacto_id', c.contacto_id, { estado: 'BLOQUEADO', actualizado_por: actor, fecha_actualizacion: ahora_() }); revocarSesiones_(db, c.contacto_id); }
  else if (op === 'desbloquear') {
    actualizarFilaPorId_(db, 'PORTAL_CONTACTOS', 'contacto_id', c.contacto_id, { estado: c.pin_hash ? 'ACTIVO' : 'INVITADO', fallos: 0, pausa_hasta: '', actualizado_por: actor, fecha_actualizacion: ahora_() });
  } else if (op === 'cerrar_sesiones') revocarSesiones_(db, c.contacto_id);
  else if (op === 'rol') actualizarFilaPorId_(db, 'PORTAL_CONTACTOS', 'contacto_id', c.contacto_id, { rol: data.rol === 'COLABORADOR' ? 'COLABORADOR' : 'ADMIN', actualizado_por: actor, fecha_actualizacion: ahora_() });
  else return errorValidacion('operacion', 'Operación desconocida.');
  registrar_(db, { cliente_id: c.cliente_id, contacto_id: c.contacto_id, actor, accion: 'CONTACTO_' + String(op).toUpperCase(), detalle: c.nombre + (op === 'rol' ? ' → ' + data.rol : '') });
  return admCliente(db, { cliente_id: c.cliente_id }, contexto);
}

function admPermisos(db, data, contexto) {
  if (!contexto || !contexto.super_admin) return errorForbidden('Solo el super administrador decide quién más administra el portal.');
  const email = normalizarEmail_(data.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errorValidacion('email', 'Elige a una persona con correo.');
  const actuales = leer_(db, 'PORTAL_PERMISOS').filter((p) => v_(p.activo) && normalizarEmail_(p.usuario_email) === email);
  if (data.operacion === 'otorgar') {
    if (!actuales.length) agregarFila_(db, 'PORTAL_PERMISOS', { permiso_id: crypto.randomUUID(), usuario_email: email, permiso: 'ADMINISTRAR', otorgado_por: actorStaff_(contexto), fecha: ahora_(), activo: true });
  } else if (data.operacion === 'revocar') {
    actuales.forEach((p) => actualizarFilaPorId_(db, 'PORTAL_PERMISOS', 'permiso_id', p.permiso_id, { activo: false }));
  } else return errorValidacion('operacion', 'Operación desconocida.');
  registrar_(db, { actor: actorStaff_(contexto), accion: data.operacion === 'otorgar' ? 'PERMISO_OTORGADO' : 'PERMISO_REVOCADO', detalle: email });
  return admEstado(db, {}, contexto);
}

/** El portal en la sesión del personal: solo dice si la persona lo administra (para el menú). */
function tieneAcceso(db, contexto) { try { return puedeAdministrar_(db, contexto); } catch (e) { return false; } }

module.exports = {
  ACCIONES_CLIENTE, ejecutarCliente, resolverCliente_,
  admEstado, admCliente, admGuardarCliente, admGuardarObra, admGuardarTrabajador, admInvitar, admContacto, admPermisos, tieneAcceso,
  rutNorm_, rutValido_, rutBonito_, pinDebil_, URL_PORTAL
};
