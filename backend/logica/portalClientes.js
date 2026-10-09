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

// ================================================================ E2: pedir y conversar
// Qué puede pedir y qué se le pregunta. Las preguntas salen de la columna
// «Input» de los DOC-10..13 de la ISO (lo que cada servicio necesita del
// cliente). `busca` liga la plantilla con el servicio del catálogo del área
// (SOL_SERVICIOS) para heredar su plazo y prioridad; si el área no lo tiene,
// el pedido entra como «Otro pedido» con el nombre de la plantilla.
// tipo: nuevos (una ficha por trabajador nuevo) | elegir (de «Mis
// trabajadores») | campos | libre. Un campo: [clave, etiqueta, ejemplo].
const PLANTILLAS = {
  RRHH: [
    { id: 'contrato', nombre: 'Contrato de trabajo', ayuda: 'Para trabajadores que entran a la obra.', tipo: 'nuevos', plazo_dias: 2, busca: /contrat|ingreso/i,
      campos: [['nombre', 'Nombre completo', 'Ej: Juan Pérez Soto'], ['rut', 'RUT', 'Ej: 12.345.678-5'], ['cargo', 'Cargo', 'Ej: Maestro albañil'], ['fecha_inicio', 'Desde cuándo trabaja', 'Ej: 14-10'], ['sueldo', 'Sueldo líquido', 'Ej: 650.000'], ['afp', 'AFP (si no sabes, déjalo en blanco)', 'Ej: Modelo'], ['salud', 'Salud', 'Ej: Fonasa']],
      foto: 'Saca una foto al carnet por los dos lados' },
    { id: 'finiquito', nombre: 'Finiquito', ayuda: 'Cuando un trabajador deja la obra.', tipo: 'elegir', plazo_dias: 3, busca: /finiquit|desvincul/i,
      campos: [['termino', 'Último día de trabajo', 'Ej: 31-10']], motivo: ['Término de obra', 'Renuncia', 'Despido', 'No sé'], foto: 'Si tiene carta de renuncia, sácale una foto' },
    { id: 'liquidaciones', nombre: 'Liquidaciones del mes', ayuda: 'Las de todos tus trabajadores.', tipo: 'campos', plazo_dias: 3, busca: /liquidac|remunerac/i, repetir: true,
      campos: [['mes', 'Mes', 'Ej: octubre'], ['cambios', '¿Hubo cambios? (horas extra, bonos, faltas, ingresos o salidas)', 'Ej: Juan 10 horas extra; Ana faltó el lunes']], foto: 'Foto del libro de asistencia (si tienes)' },
    { id: 'f30', nombre: 'Certificado F30', ayuda: 'Para mostrar que estás al día con tus trabajadores.', tipo: 'campos', plazo_dias: 2, busca: /f\s*-?\s*30/i,
      campos: [['mes', 'Mes del certificado', 'Ej: septiembre'], ['para', '¿Para quién es?', 'Ej: Inmobiliaria Los Robles']] },
    { id: 'anexo', nombre: 'Anexo de contrato', ayuda: 'Cambio de sueldo, obra, cargo u horario.', tipo: 'elegir', plazo_dias: 2, busca: /anexo/i,
      campos: [['cambio', '¿Qué cambia y desde cuándo?', 'Ej: pasa a la obra Vista Cordillera desde el 20-10']] },
    { id: 'carta', nombre: 'Carta de aviso', ayuda: 'Aviso de término de contrato.', tipo: 'elegir', plazo_dias: 2, busca: /carta/i,
      campos: [['termino', 'Fecha de término', 'Ej: 31-10'], ['causal', 'Motivo', 'Ej: término de la obra']] },
    { id: 'constancia', nombre: 'Constancia laboral', ayuda: 'Para dejar registro de una falta o un hecho.', tipo: 'elegir', plazo_dias: 2, busca: /constancia/i,
      campos: [['razon', '¿Qué pasó?', 'Ej: no se presentó el lunes 13']] }
  ],
  CONTABILIDAD: [
    { id: 'factura', nombre: 'Emitir factura', ayuda: 'Te la hacemos y te la mandamos.', tipo: 'campos', plazo_dias: 1, busca: /factur/i,
      campos: [['a', '¿A quién le facturas?', 'Ej: Inmobiliaria Los Robles'], ['monto', 'Monto (con IVA)', 'Ej: 2.380.000'], ['detalle', '¿Por qué trabajo?', 'Ej: estado de pago 3, obra Los Robles']], foto: 'Foto del estado de pago u orden de compra' },
    { id: 'nota_credito', nombre: 'Anular o corregir una factura', ayuda: 'Nota de crédito.', tipo: 'campos', plazo_dias: 1, busca: /nota.*cr[eé]dito/i,
      campos: [['folio', 'Número de la factura', 'Ej: 1452'], ['motivo', '¿Qué pasó?', 'Ej: el monto estaba mal']] },
    { id: 'deuda', nombre: 'Certificado de deuda (TGR)', ayuda: 'Para licitaciones o bancos.', tipo: 'campos', plazo_dias: 1, busca: /deuda|tgr/i, campos: [['para', '¿Para qué lo necesitas?', 'Ej: licitación']] },
    { id: 'carta_iva', nombre: 'Carta del IVA', ayuda: 'Cuánto pagas de IVA este mes.', tipo: 'campos', plazo_dias: 2, busca: /iva/i, campos: [['mes', 'Mes', 'Ej: septiembre']] },
    { id: 'factoring', nombre: 'Factoring', ayuda: 'Adelantar el pago de una factura.', tipo: 'campos', plazo_dias: 2, busca: /factoring|cesi[oó]n/i,
      campos: [['folio', 'Número de la factura', 'Ej: 1452'], ['empresa', '¿Con qué factoring?', 'Ej: el mismo de la vez pasada']] }
  ],
  PREVENCION: [
    { id: 'charla', nombre: 'Charla de inducción', ayuda: 'Para trabajadores nuevos en obra.', tipo: 'campos', obra: true, plazo_dias: 3, busca: /charla|inducci/i,
      campos: [['cuantos', '¿Cuántos trabajadores?', 'Ej: 6'], ['fecha', '¿Qué día te acomoda?', 'Ej: jueves en la mañana']] },
    { id: 'accidente', nombre: 'Avisar un accidente', ayuda: 'Te ayudamos con la denuncia y la investigación.', tipo: 'elegir', obra: true, plazo_dias: 1, busca: /accident/i,
      campos: [['que', '¿Qué pasó?', 'Ej: se cayó de la escalera y se golpeó el brazo']], foto: 'Fotos del lugar y de la lesión (si se puede)' },
    { id: 'reglamento', nombre: 'Reglamento interno', ayuda: 'El reglamento de orden, higiene y seguridad.', tipo: 'campos', plazo_dias: 5, busca: /reglamento/i, campos: [['cuantos', '¿Cuántos trabajadores tienes?', 'Ej: 14']] },
    { id: 'procedimiento', nombre: 'Procedimiento de trabajo seguro', ayuda: 'Para una tarea con riesgo.', tipo: 'campos', obra: true, plazo_dias: 5, busca: /procedimiento|pts/i,
      campos: [['tarea', '¿Qué tarea?', 'Ej: trabajo en altura']], foto: 'Foto del lugar de trabajo (si puedes)' },
    { id: 'visita', nombre: 'Visita a obra', ayuda: 'Revisión de seguridad en terreno.', tipo: 'campos', obra: true, plazo_dias: 5, busca: /visita|terreno/i, campos: [['fecha', '¿Qué día?', 'Ej: martes']] }
  ]
};
// «Mandar un documento»: lo que hoy llega por WhatsApp o correo, sin pedir nada nuevo.
const DOCUMENTOS = [
  { id: 'doc_asistencia', depto: 'RRHH', nombre: 'Asistencia del mes', ayuda: 'Para hacer las liquidaciones.', tipo: 'campos', plazo_dias: 3, campos: [['mes', 'Mes', 'Ej: octubre']], foto: 'Foto del libro o planilla de asistencia', foto_obligatoria: true },
  { id: 'doc_licencia', depto: 'RRHH', nombre: 'Licencia médica', ayuda: 'De uno de tus trabajadores.', tipo: 'elegir', uno: true, plazo_dias: 2, campos: [], foto: 'Foto de la licencia', foto_obligatoria: true },
  { id: 'doc_comprobante', depto: 'CONTABILIDAD', nombre: 'Comprobante de pago', ayuda: 'Si pagaste una factura o alguien pagó por ti.', tipo: 'campos', plazo_dias: 1,
    campos: [['monto', 'Monto pagado', 'Ej: 1.190.000'], ['quien', '¿Quién hizo la transferencia?', 'Ej: yo / Constructora Kraken']], foto: 'Foto o captura del comprobante', foto_obligatoria: true },
  { id: 'doc_oc', depto: 'CONTABILIDAD', nombre: 'Orden de compra o estado de pago', ayuda: 'Para que te hagamos la factura.', tipo: 'campos', plazo_dias: 1, campos: [['a', '¿De qué empresa?', 'Ej: Inmobiliaria Los Robles']], foto: 'Foto o PDF del documento', foto_obligatoria: true },
  { id: 'doc_otro', depto: 'RRHH', nombre: 'Otro documento', ayuda: 'Cualquier otra cosa que nos tengas que mandar.', tipo: 'libre', plazo_dias: 2, campos: [], foto: 'Foto o archivo', foto_obligatoria: true }
];
const EMPRESA_PORTAL = process.env.PORTAL_EMPRESA_ID || 'HP';

function serviciosContratados_(db, clienteId) {
  const s = json_((perfilCliente_(db, clienteId) || {}).servicios, []) || [];
  return s.length ? s : ['RRHH'];
}
function servicioDelArea_(db, depto, plantilla) {
  if (!plantilla.busca) return null;
  let filas = [];
  try { filas = leer_(db, 'SOL_SERVICIOS'); } catch (e) { return null; }
  return filas.find((s) => s.depto === depto && v_(s.activa) && plantilla.busca.test(String(s.nombre || ''))) || null;
}
function plantillaPublica_(db, depto, p) {
  const srv = servicioDelArea_(db, depto, p);
  return { id: p.id, depto, nombre: p.nombre, ayuda: p.ayuda, tipo: p.tipo, uno: !!p.uno, obra: !!p.obra, repetir: !!p.repetir,
    campos: p.campos.map((c) => ({ clave: c[0], etiqueta: c[1], ejemplo: c[2] })), motivo: p.motivo || null,
    foto: p.foto || '', foto_obligatoria: !!p.foto_obligatoria, plazo_dias: srv && Number(srv.plazo_dias) > 0 ? Number(srv.plazo_dias) : p.plazo_dias };
}
function encargadoDe_(db, clienteId, depto) {
  const e = json_((perfilCliente_(db, clienteId) || {}).encargados, {}) || {};
  const correo = normalizarEmail_(e[depto]);
  return correo && Servicios.equipoDepto_(db, depto).some((m) => m.email === correo) ? correo : '';
}

function catalogo(db, data, ctx) {
  const areas = serviciosContratados_(db, ctx.cliente_id).filter((a) => PLANTILLAS[a]);
  const enc = encargados_(db, perfilCliente_(db, ctx.cliente_id));
  return {
    areas: areas.map((a) => ({ clave: a, nombre: (Servicios.departamento_(a) || {}).nombre || a,
      encargado: (enc.find((e) => e.area === a) || {}).nombre || '', servicios: PLANTILLAS[a].map((p) => plantillaPublica_(db, a, p)) })),
    documentos: DOCUMENTOS.filter((d) => areas.indexOf(d.depto) !== -1).map((d) => Object.assign(plantillaPublica_(db, d.depto, d), { documento: true }))
  };
}

function lineas_(pares) { return pares.filter((p) => p[1] !== undefined && String(p[1]).trim() !== '').map((p) => p[0] + ': ' + String(p[1]).trim()).join('\n'); }

// D-005 (E1-3): el mismo intento de pedido (intento_id que genera el teléfono y repite en
// los reintentos) devuelve SIEMPRE la misma solicitud. En curso: el segundo espera al
// primero (mapa en memoria). Terminado: se busca en SOLICITUDES.intento_portal. Mismo
// intento con otro contenido: se rechaza.
const intentosEnCurso_ = new Map();
async function crearPedido(db, data, ctx, meta) {
  const intento = String((data && data.intento_id) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (!intento) return crearPedidoReal_(db, data, ctx, meta);
  const copia = Object.assign({}, data); delete copia.intento_id; delete copia.cliente_token;
  const huella = require('node:crypto').createHash('sha256').update(JSON.stringify(copia)).digest('hex').slice(0, 24);
  const clave = ctx.cliente_id + '|' + ctx.contacto_id + '|' + intento;
  const previa = leer_(db, 'SOLICITUDES').find((x) => x.cliente_id === ctx.cliente_id && String(x.intento_portal || '').startsWith(clave + '|'));
  if (previa) {
    if (String(previa.intento_portal).slice(clave.length + 1) !== huella) return errorValidacion('intento_id', 'Ese pedido ya se envió con otros datos. Vuelve a empezar el pedido.');
    const items = leer_(db, 'SUBSOLICITUDES').filter((x) => x.solicitud_id === previa.solicitud_id);
    return { solicitud_id: previa.solicitud_id, items: items.length, primer_item: previa.solicitud_id + '-01', repetido: true };
  }
  if (intentosEnCurso_.has(clave)) {
    const enCurso = intentosEnCurso_.get(clave);
    if (enCurso.huella !== huella) return errorValidacion('intento_id', 'Ese pedido ya se está enviando con otros datos.');
    return enCurso.promesa;
  }
  const promesa = crearPedidoReal_(db, data, ctx, meta, clave + '|' + huella);
  intentosEnCurso_.set(clave, { huella, promesa });
  try { return await promesa; } finally { intentosEnCurso_.delete(clave); }
}
async function crearPedidoReal_(db, data, ctx, meta, intentoPortal) {
  const Solicitudes = require('./solicitudes');
  const esDoc = String(data.plantilla_id || '').indexOf('doc_') === 0;
  let depto = '', p = null;
  if (esDoc) { p = DOCUMENTOS.find((d) => d.id === data.plantilla_id); depto = p ? p.depto : ''; }
  else if (data.plantilla_id === 'otra') { depto = String(data.depto || 'RRHH').toUpperCase(); p = { id: 'otra', nombre: 'Otra cosa', tipo: 'libre', campos: [], plazo_dias: 2 }; }
  else Object.keys(PLANTILLAS).some((a) => { const x = PLANTILLAS[a].find((y) => y.id === data.plantilla_id); if (x) { p = x; depto = a; } return !!x; });
  if (!p) return errorValidacion('plantilla_id', 'Elige qué necesitas.');
  if (serviciosContratados_(db, ctx.cliente_id).indexOf(depto) === -1 || !Servicios.departamento_(depto)) return errorValidacion('plantilla_id', 'Ese servicio no está en lo que tienes contratado.');

  const c = contacto_(db, ctx.contacto_id);
  const cat = clienteCat_(db, ctx.cliente_id) || {};
  const perfil = perfilCliente_(db, ctx.cliente_id) || {};
  const datos = data.datos && typeof data.datos === 'object' ? data.datos : {};
  const obra = data.obra_id ? obras_(db, ctx.cliente_id).find((o) => o.obra_id === data.obra_id) : null;
  if (data.obra_id && !obra) return errorValidacion('obra_id', 'Esa obra no es tuya.');
  const misTrab = leer_(db, 'PORTAL_TRABAJADORES').filter((t) => t.cliente_id === ctx.cliente_id);
  const extra = p.campos.filter((k) => p.tipo !== 'nuevos').map((k) => [k[1], datos[k[0]]]);
  if (p.motivo && data.motivo) extra.push(['Motivo', txt_(data.motivo, 60)]);
  if (obra) extra.push(['Obra', obra.nombre + (obra.comuna ? ' (' + obra.comuna + ')' : '')]);
  const srv = esDoc || p.id === 'otra' ? null : servicioDelArea_(db, depto, p);
  const destinatario = encargadoDe_(db, ctx.cliente_id, depto);
  const items = [];
  const nuevos = [];

  if (p.tipo === 'nuevos') {
    const personas = (Array.isArray(data.personas) ? data.personas : []).filter((x) => x && txt_(x.nombre));
    if (!personas.length) return errorValidacion('personas', 'Agrega al menos una persona con su nombre.');
    if (personas.length > 20) return errorValidacion('personas', 'Hasta 20 personas por pedido.');
    for (const x of personas) {
      if (x.rut && !rutValido_(x.rut)) return errorValidacion('personas', 'El RUT de ' + txt_(x.nombre, 60) + ' no es válido. Revísalo.');
    }
    personas.forEach((x) => {
      const obraNombre = obra ? obra.nombre : '';
      items.push({ titulo: p.nombre + ' · ' + txt_(x.nombre, 80),
        descripcion: lineas_(p.campos.map((k) => [k[1], k[0] === 'rut' && x.rut ? rutBonito_(x.rut) : x[k[0]]]).concat([['Obra', obraNombre]])) || p.nombre,
        persona: x });
    });
  } else if (p.tipo === 'elegir') {
    const ids = (Array.isArray(data.trabajadores) ? data.trabajadores : []).filter(Boolean);
    const elegidos = ids.map((id) => misTrab.find((t) => t.trabajador_id === id)).filter(Boolean);
    if (!elegidos.length || elegidos.length !== ids.length) return errorValidacion('trabajadores', p.uno ? 'Elige al trabajador.' : 'Elige al menos un trabajador.');
    if (p.uno && elegidos.length > 1) return errorValidacion('trabajadores', 'Elige un solo trabajador.');
    elegidos.forEach((t) => items.push({ titulo: p.nombre + ' · ' + t.nombre, trabajador_id: t.trabajador_id,
      descripcion: lineas_([['Trabajador', t.nombre], ['RUT', rutBonito_(t.rut)], ['Cargo', t.cargo]].concat(extra)) || p.nombre }));
  } else if (p.tipo === 'campos') {
    const desc = lineas_(extra);
    if (!desc && !txt_(data.texto)) return errorValidacion('datos', 'Completa al menos un dato.');
    const mes = txt_(datos.mes, 30);
    items.push({ titulo: p.nombre + (mes ? ' · ' + mes : ''), descripcion: desc || txt_(data.texto, 2000) });
  } else {
    const texto = txt_(data.texto, 4000);
    if (!texto && !data.con_archivos) return errorValidacion('texto', 'Cuéntanos qué necesitas (o adjunta un archivo).');
    items.push({ titulo: p.nombre + (texto ? ' · ' + texto.slice(0, 60) : ''), descripcion: texto || 'Envío de documentos desde el portal.' });
  }
  if (txt_(data.texto) && p.tipo !== 'libre' && p.tipo !== 'campos') items.forEach((it) => { it.descripcion += '\nNota: ' + txt_(data.texto, 1000); });

  // Los trabajadores nuevos quedan en «Mis trabajadores» con el contrato en trámite.
  const vincularTrabajadores_ = (solicitudId) => {
    for (let i = 0; i < items.length; i++) {
      const subId = solicitudId + '-' + ('0' + (i + 1)).slice(-2);
      let trabId = items[i].trabajador_id || '';
      if (items[i].persona) {
        const x = items[i].persona;
        const t = guardarTrabajador_(db, ctx.cliente_id, { nombre: x.nombre, rut: x.rut, cargo: x.cargo, obra_id: obra ? obra.obra_id : '', fecha_inicio: x.fecha_inicio,
          sueldo: x.sueldo, afp: x.afp, salud: x.salud, estado: 'TRAMITE' }, 'contacto:' + ctx.contacto_id);
        if (t && t.trabajador_id) { trabId = t.trabajador_id; nuevos.push(t.nombre); }
      }
      if (trabId) actualizarFilaPorId_(db, 'SUBSOLICITUDES', 'subsolicitud_id', subId, { trabajador_id: trabId });
    }
  };
  const r = await Solicitudes.crearSolicitud(db, {
    empresa_id: EMPRESA_PORTAL, asociada_plataforma: false,
    solicitante_nombre: c.nombre, solicitante_cargo: c.cargo || 'Contratista',
    solicitante_email: c.correo || ('c-' + c.contacto_id + '@portal.invalid'),
    empresa_cliente: cat.razon_social || '', rut_cliente: cat.rut || '', cliente_obra: obra ? obra.nombre : '',
    contacto_cliente: c.nombre, telefono_cliente: c.telefono || perfil.telefono || '',
    observaciones_generales: 'Pedido desde el portal de clientes.',
    subsolicitudes: items.map((it) => ({ titulo: it.titulo.slice(0, 200), descripcion: it.descripcion, depto, servicio_id: srv ? srv.servicio_id : '', destinatario }))
  }, {
    // Revisión Codex Tanda 1 (hallazgo 3): vínculo con el cliente, marca del intento y
    // trabajadores se guardan junto con la solicitud, antes de esperar los avisos.
    filaSolicitud: { cliente_id: ctx.cliente_id, origen: 'PORTAL', contacto_id: ctx.contacto_id, intento_portal: intentoPortal || '' },
    alPersistir: (solicitudId) => vincularTrabajadores_(solicitudId)
  });
  if (!r || !r.solicitud_id) return r;
  registrar_(db, { cliente_id: ctx.cliente_id, contacto_id: ctx.contacto_id, actor: 'contacto', accion: esDoc ? 'DOCUMENTO' : 'PEDIDO',
    detalle: r.solicitud_id + ' · ' + p.nombre + (items.length > 1 ? ' (' + items.length + ')' : ''), ip: (meta && meta.ip) || '' });
  const fichaEnc = destinatario ? (DirectorioPersonas.fichas(db, [destinatario])[destinatario] || {}) : {};
  return { solicitud_id: r.solicitud_id, items: items.length, primer_item: r.solicitud_id + '-01', recibe: fichaEnc.nombre || ((Servicios.departamento_(depto) || {}).nombre || depto),
    plazo_dias: srv && Number(srv.plazo_dias) > 0 ? Number(srv.plazo_dias) : p.plazo_dias, trabajadores_nuevos: nuevos };
}

// Lo que ve el contratista de un ítem: cuatro palabras, no los 11 estados.
function estadoCliente_(e) {
  if (e === 'S01') return 'ENVIADO';
  if (e === 'S06' || e === 'S08') return 'TU';
  if (e === 'S09') return 'LISTO';
  if (e === 'S10' || e === 'S11') return 'CERRADO';
  return 'CURSO';
}
const ORDEN_EST = { TU: 0, ENVIADO: 1, CURSO: 2, LISTO: 3, CERRADO: 4 };
function solicitudDelCliente_(db, ctx, solicitudId) {
  const s = leer_(db, 'SOLICITUDES').find((x) => x.solicitud_id === solicitudId);
  return s && s.cliente_id === ctx.cliente_id ? s : null;
}

function pedidos(db, data, ctx) {
  const sols = leer_(db, 'SOLICITUDES').filter((s) => s.cliente_id === ctx.cliente_id);
  const ids = {}; sols.forEach((s) => { ids[s.solicitud_id] = true; });
  const subs = leer_(db, 'SUBSOLICITUDES').filter((s) => ids[s.solicitud_id]);
  const coms = leer_(db, 'COMENTARIOS').filter((m) => ids[m.solicitud_id] && !(m.es_interno === true || m.es_interno === 'TRUE'));
  const arch = leer_(db, 'ARCHIVOS').filter((a) => ids[a.solicitud_id]);
  return { pedidos: sols.map((s) => {
    const its = subs.filter((x) => x.solicitud_id === s.solicitud_id).sort((a, b) => a.numero_item - b.numero_item);
    const est = its.map((x) => estadoCliente_(x.estado));
    const estado = est.slice().sort((a, b) => ORDEN_EST[a] - ORDEN_EST[b])[0] || 'ENVIADO';
    const ms = coms.filter((m) => m.solicitud_id === s.solicitud_id).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const ult = ms[ms.length - 1];
    const suyo = ult && normalizarEmail_(ult.usuario) === normalizarEmail_(s.solicitante_email);
    const fechas = its.filter((x) => x.fecha_comprometida && ['S09', 'S10', 'S11'].indexOf(x.estado) === -1).map((x) => String(x.fecha_comprometida).slice(0, 10)).sort();
    const nombreBase = String((its[0] || {}).titulo || '').split(' · ')[0];
    return {
      solicitud_id: s.solicitud_id, titulo: its.length > 1 ? nombreBase + ' (' + its.length + ')' : ((its[0] || {}).titulo || ''),
      area: (its[0] || {}).depto || '', area_nombre: (its[0] || {}).depto_nombre || '', estado, items: its.length,
      listos: est.filter((e) => e === 'LISTO').length, por_confirmar: its.filter((x) => x.estado === 'S08').length, preguntas: its.filter((x) => x.estado === 'S06').length,
      fecha_creacion: s.fecha_creacion, para_el: fechas[0] || '', archivos: arch.filter((a) => a.solicitud_id === s.solicitud_id).length,
      ultimo_mensaje: ult ? { de_ti: !!suyo, timestamp: ult.timestamp } : null, documento: /^(Asistencia|Licencia|Comprobante|Orden de compra|Otro documento)/.test(nombreBase)
    };
  }).sort((a, b) => ORDEN_EST[a.estado] - ORDEN_EST[b.estado] || String(b.fecha_creacion).localeCompare(String(a.fecha_creacion))) };
}

function pedido(db, data, ctx) {
  const s = solicitudDelCliente_(db, ctx, txt_(data.solicitud_id, 60));
  if (!s) return errorValidacion('solicitud_id', 'Ese pedido no existe.');
  const SP = require('./solicitudesPublico');
  const v = SP.estadoPublico(db, s.solicitud_id, s.solicitante_email);
  if (v && (v._forbidden || v._validationError)) return v;
  // Los archivos se bajan con la sesión (clienteArchivo), nunca con el enlace con llave.
  // De cada uno se dice si lo entregó el equipo (y quién) o lo mandó el contratista.
  const subidoPor = {};
  leer_(db, 'ARCHIVOS').filter((a) => a.solicitud_id === s.solicitud_id).forEach((a) => { subidoPor[a.archivo_id] = String(a.subido_por || ''); });
  const correosEquipo = Object.keys(subidoPor).map((k) => subidoPor[k]).filter((x) => x.indexOf('equipo:') === 0).map((x) => x.slice(7));
  const fichas = correosEquipo.length ? DirectorioPersonas.fichas(db, correosEquipo) : {};
  v.subsolicitudes.forEach((it) => {
    it.estado_cliente = estadoCliente_(it.estado);
    it.archivos = (it.archivos || []).map((a) => {
      const sp = subidoPor[a.archivo_id] || '';
      const correo = sp.indexOf('equipo:') === 0 ? sp.slice(7) : '';
      return { archivo_id: a.archivo_id, nombre: a.nombre_original, tipo_mime: a.tipo_mime, tamano_bytes: a.tamano_bytes, fecha: a.fecha_subida,
        del_equipo: !!correo, quien: correo ? ((fichas[correo] || {}).nombre || 'El equipo') : '' };
    });
  });
  delete v.url_pdf;
  delete v.posicion_cola;
  return v;
}

async function mensaje(db, data, ctx, meta) {
  const s = solicitudDelCliente_(db, ctx, txt_(data.solicitud_id, 60));
  if (!s) return errorValidacion('solicitud_id', 'Ese pedido no existe.');
  const texto = txt_(data.texto, 4000);
  if (!texto) return errorValidacion('texto', 'Escribe tu mensaje.');
  const sub = data.subsolicitud_id ? leer_(db, 'SUBSOLICITUDES').find((x) => x.subsolicitud_id === data.subsolicitud_id && x.solicitud_id === s.solicitud_id) : null;
  if (data.subsolicitud_id && !sub) return errorValidacion('subsolicitud_id', 'Ese ítem no es de este pedido.');
  const SP = require('./solicitudesPublico');
  const r = await SP.enviarMensajeSolicitud(db, { solicitud_id: s.solicitud_id, subsolicitud_id: sub ? sub.subsolicitud_id : '', email: s.solicitante_email, texto });
  if (r && !r._validationError && !r._forbidden) registrar_(db, { cliente_id: ctx.cliente_id, contacto_id: ctx.contacto_id, actor: 'contacto', accion: 'MENSAJE', detalle: s.solicitud_id, ip: (meta && meta.ip) || '' });
  return r;
}

async function subirArchivo(db, data, ctx, meta) {
  const s = solicitudDelCliente_(db, ctx, txt_(data.solicitud_id, 60));
  if (!s) return errorValidacion('solicitud_id', 'Ese pedido no existe.');
  const sub = data.subsolicitud_id ? leer_(db, 'SUBSOLICITUDES').find((x) => x.subsolicitud_id === data.subsolicitud_id && x.solicitud_id === s.solicitud_id) : null;
  if (data.subsolicitud_id && !sub) return errorValidacion('subsolicitud_id', 'Ese ítem no es de este pedido.');
  const A = require('./archivosSolicitud');
  const r = await A.subirArchivo(db, { solicitud_id: s.solicitud_id, subsolicitud_id: sub ? sub.subsolicitud_id : (s.solicitud_id + '-01'),
    nombre_archivo: txt_(data.nombre_archivo, 150), contenido_base64: data.contenido_base64, email: s.solicitante_email }, { conversacion: true });
  if (r && r.archivo_id) {
    registrar_(db, { cliente_id: ctx.cliente_id, contacto_id: ctx.contacto_id, actor: 'contacto', accion: 'ARCHIVO', detalle: s.solicitud_id + ' · ' + txt_(data.nombre_archivo, 80), ip: (meta && meta.ip) || '' });
    return { archivo_id: r.archivo_id, tipo_mime: r.tipo_mime, tamano_bytes: r.tamano_bytes };
  }
  return r;
}

async function confirmar(db, data, ctx, meta) {
  const s = solicitudDelCliente_(db, ctx, txt_(data.solicitud_id, 60));
  if (!s) return errorValidacion('solicitud_id', 'Ese pedido no existe.');
  const accion = data.accion === 'reabrir' ? 'reabrir' : 'confirmar';
  const SP = require('./solicitudesPublico');
  const r = await SP.validarCierre(db, { solicitud_id: s.solicitud_id, subsolicitud_id: txt_(data.subsolicitud_id, 80), email: s.solicitante_email, accion, comentario: txt_(data.comentario, 2000), atencion_directa: null });
  if (r && !r._validationError && !r._forbidden) registrar_(db, { cliente_id: ctx.cliente_id, contacto_id: ctx.contacto_id, actor: 'contacto', accion: accion === 'confirmar' ? 'CONFIRMACION' : 'REAPERTURA', detalle: txt_(data.subsolicitud_id, 80), ip: (meta && meta.ip) || '' });
  return r;
}

async function archivo(db, data, ctx, meta) {
  const a = leer_(db, 'ARCHIVOS').find((x) => x.archivo_id === txt_(data.archivo_id, 60));
  if (!a || !solicitudDelCliente_(db, ctx, a.solicitud_id)) return errorValidacion('archivo_id', 'Ese archivo no existe.');
  // Abrió en grande algo que ya tenía en miniatura: solo queda la evidencia, sin bajarlo de nuevo.
  if (data.solo_registro) {
    registrar_(db, { cliente_id: ctx.cliente_id, contacto_id: ctx.contacto_id, actor: 'contacto', accion: 'DESCARGA', detalle: a.solicitud_id + ' · ' + a.nombre_original, ip: (meta && meta.ip) || '' });
    return { ok: true };
  }
  const A = require('./archivosSolicitud');
  const llave = (String(a.url || '').match(/[?&]k=([^&]+)/) || [])[1] || '';
  const f = await A.servirArchivo(db, a.archivo_id, llave);
  if (!f) return errorValidacion('archivo_id', 'No se pudo abrir el archivo.');
  // La miniatura que se pinta sola en la conversación no es «abrir»: no llena el registro.
  if (!data.miniatura) registrar_(db, { cliente_id: ctx.cliente_id, contacto_id: ctx.contacto_id, actor: 'contacto', accion: 'DESCARGA', detalle: a.solicitud_id + ' · ' + f.nombre, ip: (meta && meta.ip) || '' });
  return { nombre: f.nombre, tipo_mime: f.mime, contenido_base64: f.buffer.toString('base64') };
}

// «Mis documentos» (2026-10-08): todo lo que el equipo le ha entregado (y lo que
// él mandó), de todos sus pedidos, con el pedido, el área y el trabajador. Así
// no busca el contrato de Juan pedido por pedido. Sin contenido: se abre con
// clienteArchivo como siempre.
function documentos(db, data, ctx) {
  const sols = leer_(db, 'SOLICITUDES').filter((s) => s.cliente_id === ctx.cliente_id);
  const ids = {}; sols.forEach((s) => { ids[s.solicitud_id] = s; });
  const subs = {}; leer_(db, 'SUBSOLICITUDES').forEach((x) => { if (ids[x.solicitud_id]) subs[x.subsolicitud_id] = x; });
  const trab = {}; leer_(db, 'PORTAL_TRABAJADORES').forEach((t) => { if (t.cliente_id === ctx.cliente_id) trab[t.trabajador_id] = t; });
  const archs = leer_(db, 'ARCHIVOS').filter((a) => ids[a.solicitud_id]);
  const correos = archs.map((a) => String(a.subido_por || '')).filter((x) => x.indexOf('equipo:') === 0).map((x) => x.slice(7));
  const fichas = correos.length ? DirectorioPersonas.fichas(db, Array.from(new Set(correos))) : {};
  return { documentos: archs.map((a) => {
    const it = subs[a.subsolicitud_id] || {};
    const correo = String(a.subido_por || '').indexOf('equipo:') === 0 ? String(a.subido_por).slice(7) : '';
    const t = trab[it.trabajador_id];
    return { archivo_id: a.archivo_id, nombre: a.nombre_original, tipo_mime: a.tipo_mime, tamano_bytes: a.tamano_bytes, fecha: a.fecha_subida,
      solicitud_id: a.solicitud_id, pedido: it.titulo || '', area: it.depto || '', trabajador_id: t ? t.trabajador_id : '', trabajador: t ? t.nombre : '',
      del_equipo: !!correo, quien: correo ? ((fichas[correo] || {}).nombre || 'El equipo') : '' };
  }).sort((x, y) => String(y.fecha).localeCompare(String(x.fecha))) };
}

const Push = require('./portalPush');
function pushSuscribir(db, data, ctx, meta) {
  const r = Push.suscribir(db, data, ctx);
  if (r && r.ok) registrar_(db, { cliente_id: ctx.cliente_id, contacto_id: ctx.contacto_id, actor: 'contacto', accion: 'AVISOS_ACTIVADOS', detalle: txt_(data.dispositivo, 80), ip: (meta && meta.ip) || '' });
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
  clienteGuardarObra: { fn: guardarObra },
  clienteCatalogo: { fn: catalogo },
  clienteCrearPedido: { fn: crearPedido },
  clientePedidos: { fn: pedidos },
  clientePedido: { fn: pedido },
  clienteMensaje: { fn: mensaje },
  clienteSubirArchivo: { fn: subirArchivo },
  clienteConfirmar: { fn: confirmar },
  clienteArchivo: { fn: archivo },
  clienteDocumentos: { fn: documentos },
  clientePushClave: { fn: (db) => Push.clave(db) },
  clientePushSuscribir: { fn: pushSuscribir },
  clientePushQuitar: { fn: (db, data, ctx) => Push.quitar(db, data, ctx) },
  clientePushProbar: { fn: (db, data, ctx) => Push.probar(db, data, ctx) }
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
    catalogo_clientes: cat.filter((c) => v_(c.activo) || c.activo === '').map((c) => ({ cliente_id: c.cliente_id, razon_social: c.razon_social, rut: rutBonito_(c.rut),
        correo: c.correo || '', telefono: c.telefono || '', direccion: c.direccion || '', representante: c.representante_legal || '' }))
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
    contactos: (() => { const av = Push.resumenCliente(db, clienteId).por_contacto;
      return leer_(db, 'PORTAL_CONTACTOS').filter((c) => c.cliente_id === clienteId).map((c) => Object.assign(contactoPublico_(c), { telefonos_con_avisos: av[c.contacto_id] || 0 })); })(),
    trabajadores: leer_(db, 'PORTAL_TRABAJADORES').filter((t) => t.cliente_id === clienteId).map(trabajadorPublico_),
    registro: leer_(db, 'PORTAL_REGISTRO').filter((r) => r.cliente_id === clienteId).slice(-200).reverse()
      .map((r) => Object.assign({}, r, { contacto_nombre: nombres[r.contacto_id] || '' }))
  };
}

// ---------------------------------------------------------------- base de contratistas
// 2026-10-08: la ficha de clientes de SIGSO (CAT_CLIENTES) se edita desde aquí, y
// un contratista que no estaba se crea aquí mismo. Es UNA sola base: Control
// interno, prestaciones SGC y Finanzas la leen, así que el cliente nuevo queda
// disponible en todo SIGSO. Nunca se borra (otras tablas apuntan a cliente_id):
// se da de baja con `activo`. Cada cambio queda en PORTAL_REGISTRO.
const CAMPOS_FICHA = {
  razon_social: ['Razón social', 150], rut: ['RUT', 15], codigo_cliente: ['Código', 30], contacto: ['Contacto', 120],
  correo: ['Correo', 120], telefono: ['Teléfono', 30], representante_legal: ['Representante legal', 120], direccion: ['Dirección', 150]
};
function fichaPublica_(c, perfiles) {
  const p = perfiles ? perfiles[c.cliente_id] : null;
  return { cliente_id: c.cliente_id, razon_social: c.razon_social || '', rut: c.rut ? rutBonito_(c.rut) : '', codigo_cliente: c.codigo_cliente || '', contacto: c.contacto || '',
    correo: c.correo || '', telefono: c.telefono || '', representante_legal: c.representante_legal || '', direccion: c.direccion || '',
    activo: v_(c.activo) || c.activo === '' || c.activo == null, portal: p ? (v_(p.habilitado) ? 'HABILITADO' : 'DESHABILITADO') : '' };
}
/** Revisa un campo de la ficha; devuelve [valor limpio] o un error de validación. */
function validarCampoFicha_(db, campo, valor, clienteId) {
  const def = CAMPOS_FICHA[campo];
  let v = txt_(valor, def[1]);
  if (campo === 'razon_social' && !v) return errorValidacion(campo, 'La razón social no puede quedar vacía.');
  if (campo === 'rut') {
    if (!rutValido_(v)) return errorValidacion(campo, 'Ese RUT no es válido. Revísalo.');
    const otro = leer_(db, 'CAT_CLIENTES').find((c) => c.cliente_id !== clienteId && rutNorm_(c.rut) === rutNorm_(v));
    if (otro) return errorValidacion(campo, 'Ese RUT ya está en la base: ' + (otro.razon_social || otro.cliente_id) + '.');
    v = rutBonito_(v);
  }
  if (campo === 'correo' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return errorValidacion(campo, 'Ese correo no es válido.');
  return [v];
}
function nuevoClienteId_(db, rut) {
  const ids = {}; leer_(db, 'CAT_CLIENTES').forEach((c) => { ids[c.cliente_id] = true; });
  const base = 'CLI-' + rutNorm_(rut).slice(0, -1);
  let id = base, n = 2;
  while (ids[id]) id = base + '-' + (n++);
  return id;
}
/** Crea la ficha en la base de clientes. Devuelve la fila o un error de validación. */
function crearFicha_(db, datos, contexto) {
  const fila = { estado: 'ACTIVO', bloqueo: '', activo: true };
  for (const campo of Object.keys(CAMPOS_FICHA)) {
    const r = validarCampoFicha_(db, campo, datos[campo], '');
    if (r._validationError) return r;
    fila[campo] = r[0];
  }
  fila.cliente_id = nuevoClienteId_(db, fila.rut);
  agregarFila_(db, 'CAT_CLIENTES', fila);
  registrar_(db, { cliente_id: fila.cliente_id, actor: actorStaff_(contexto), accion: 'BASE_NUEVO', detalle: fila.razon_social + ' · ' + fila.rut });
  return fila;
}

function admBase(db, data, contexto) {
  if (!puedeAdministrar_(db, contexto)) return negar_();
  const perfiles = {}; leer_(db, 'PORTAL_CLIENTES').forEach((p) => { perfiles[p.cliente_id] = p; });
  const contratistas = leer_(db, 'CAT_CLIENTES').map((c) => fichaPublica_(c, perfiles))
    .sort((a, b) => String(a.razon_social).localeCompare(String(b.razon_social), 'es'));
  return { contratistas, campos: Object.keys(CAMPOS_FICHA).map((k) => ({ clave: k, nombre: CAMPOS_FICHA[k][0] })) };
}

/**
 * Crea (sin cliente_id) o corrige (con cliente_id + cambios {campo: valor}) una
 * ficha de la base. `cambios.activo` da de baja o reactiva.
 */
function admGuardarFicha(db, data, contexto) {
  if (!puedeAdministrar_(db, contexto)) return negar_();
  const perfiles = {}; leer_(db, 'PORTAL_CLIENTES').forEach((p) => { perfiles[p.cliente_id] = p; });
  if (!data.cliente_id) {
    const r = crearFicha_(db, data.datos || {}, contexto);
    if (r._validationError) return r;
    return { contratista: fichaPublica_(r, perfiles), creado: true };
  }
  const clienteId = txt_(data.cliente_id, 80);
  const actual = clienteCat_(db, clienteId);
  if (!actual) return errorValidacion('cliente_id', 'Ese contratista no existe en la base.');
  const cambios = data.cambios || {};
  const fila = {}, detalle = [];
  for (const campo of Object.keys(cambios)) {
    if (campo === 'activo') {
      const activo = cambios.activo === true || cambios.activo === 'true';
      if (!activo && perfiles[clienteId] && v_(perfiles[clienteId].habilitado)) return errorValidacion('activo', 'Tiene el portal habilitado: deshabilítalo primero en su ficha.');
      fila.activo = activo; detalle.push(activo ? 'reactivado' : 'dado de baja');
      continue;
    }
    if (!CAMPOS_FICHA[campo]) return errorValidacion(campo, 'Ese dato no se puede editar aquí.');
    const r = validarCampoFicha_(db, campo, cambios[campo], clienteId);
    if (r._validationError) return r;
    if (String(actual[campo] || '') === r[0]) continue;
    fila[campo] = r[0];
    detalle.push(CAMPOS_FICHA[campo][0] + ': «' + String(actual[campo] || '').slice(0, 60) + '» → «' + r[0].slice(0, 60) + '»');
  }
  if (Object.keys(fila).length) {
    actualizarFilaPorId_(db, 'CAT_CLIENTES', 'cliente_id', clienteId, fila);
    registrar_(db, { cliente_id: clienteId, actor: actorStaff_(contexto), accion: 'BASE_EDITADA', detalle: detalle.join(' · ').slice(0, 500) });
  }
  return { contratista: fichaPublica_(clienteCat_(db, clienteId), perfiles), cambiados: Object.keys(fila) };
}

function admGuardarCliente(db, data, contexto) {
  if (!puedeAdministrar_(db, contexto)) return negar_();
  const esNuevo = !data.cliente_id && !!data.nuevo;
  if (!esNuevo && !clienteCat_(db, txt_(data.cliente_id, 80))) return errorValidacion('cliente_id', 'Ese cliente no existe en la ficha de clientes.');
  if (esNuevo) {
    // Se revisa antes de crear nada: un error no deja una ficha a medias.
    for (const campo of ['razon_social', 'rut']) {
      const r = validarCampoFicha_(db, campo, data.nuevo[campo], '');
      if (r._validationError) return r;
    }
  }
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
  let clienteId = txt_(data.cliente_id, 80);
  // Contratista que no estaba en la base: se crea su ficha con los mismos datos de contacto.
  if (esNuevo) {
    const n = data.nuevo;
    const r = crearFicha_(db, { razon_social: n.razon_social, rut: n.rut, codigo_cliente: n.codigo_cliente, contacto: n.contacto,
      correo, telefono: data.telefono, direccion: data.direccion, representante_legal: data.representante }, contexto);
    if (r._validationError) return r;
    clienteId = r.cliente_id;
  }
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
  admEstado, admCliente, admGuardarCliente, admBase, admGuardarFicha, admGuardarObra, admGuardarTrabajador, admInvitar, admContacto, admPermisos, tieneAcceso,
  rutNorm_, rutValido_, rutBonito_, pinDebil_, URL_PORTAL
};
