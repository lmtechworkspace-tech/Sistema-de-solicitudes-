'use strict';

/**
 * novedades.js — puerto de backend/backoffice/Novedades.gs (v6.5-v6.9).
 *
 * Modulo Novedades: leyes, dictamenes, avisos, capacitaciones, logros y
 * novedades comerciales, con dos carriles (LIBRE se publica directo;
 * CONTROLADO pasa por aprobacion de la jefatura del autor), audiencia
 * dirigida (TODOS/MI_EQUIPO/SELECCION) y acuse de lectura.
 *
 * Diferencias deliberadas con el .gs, documentadas:
 *  - Sin memoizacion global (_indiceAudiencia_/_audienciaMemo_ del .gs): en
 *    Apps Script esas variables se reinician por ejecucion; en un server Node
 *    persistirian entre requests y quedarian viejas. Se lee fresco cada vez
 *    (SQLite local es barato) -- mismo criterio que no portar CacheService.
 *  - El ADJUNTO PDF (publicar con contenido_base64, descargarAdjunto) usa
 *    almacenamiento.js (Cloudflare R2, activo desde 2026-09-18): mismas
 *    reglas que el .gs (solo PDF por firma binaria %PDF, 10 MB maximo), el
 *    "Drive privado" del original se reemplaza por un objeto privado en R2
 *    bajo la clave `novedades/<novedad_id>/<nombre_archivo>`.
 *  - Correos: se usa Notificaciones.enviarCorreoModulo (mismo transporte/dedup/
 *    cola que el resto). El HTML branded lo genera el transporte a partir del
 *    texto plano, en vez de portar el HTML hecho a mano de cada correo.
 *  - La notificacion "viva" en pantalla (NOTIFICACIONES_APP) usa
 *    NotificacionesApp.encolarLote (solo el encolado esta portado).
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { errorValidacion, errorForbidden } = require('./errores');
const { obtenerEquipoJefe_, jefeDeSubordinado_ } = require('./jefatura');
const { parsearListaPortal } = require('./portal');
const Notificaciones = require('./notificaciones');
const NotificacionesApp = require('./notificacionesApp');
const Almacenamiento = require('./almacenamiento');

// Mismos limites que el .gs: 10 MB, y solo PDF -- validado por FIRMA
// BINARIA (%PDF), no por la extension del nombre de archivo (un .pdf
// renombrado desde un .png no pasa).
const MAX_ADJUNTO_BYTES = 10 * 1024 * 1024;
const FIRMA_PDF = Buffer.from('%PDF');
function esPdf_(buffer) {
  return buffer.length >= FIRMA_PDF.length && buffer.subarray(0, FIRMA_PDF.length).equals(FIRMA_PDF);
}

const TIPOS = {
  LEY: { etiqueta: 'Ley / Normativa', color: 'critico', carril: 'CONTROLADO' },
  DICTAMEN: { etiqueta: 'Dictamen', color: 'alerta', carril: 'CONTROLADO' },
  PROCEDIMIENTO: { etiqueta: 'Procedimiento interno', color: 'info', carril: 'CONTROLADO' },
  AVISO: { etiqueta: 'Aviso', color: 'info', carril: 'LIBRE' },
  CAPACITACION: { etiqueta: 'Capacitación', color: 'ok', carril: 'CONTROLADO' },
  LOGRO: { etiqueta: 'Logro / Reconocimiento', color: 'ok', carril: 'LIBRE' },
  COMERCIAL: { etiqueta: 'Comercial / Cliente', color: 'alerta', carril: 'CONTROLADO' }
};

const ESTADOS = { EN_REVISION: 'EN_REVISION', DEVUELTA: 'DEVUELTA', RECHAZADA: 'RECHAZADA', PUBLICADA: 'PUBLICADA' };
const MOTIVO_MIN_CARACTERES = 10;
const TIPOS_EXIGEN_PLAZO = { LEY: true, DICTAMEN: true };

function normalizarEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function esVerdadero_(v) {
  return v === true || v === 'TRUE' || v === 1;
}

function leerSeguro_(db, hoja) {
  try { return leerFilas_(db, hoja, COLUMNAS[hoja]); } catch (err) { return []; }
}

// --- lecturas base ---------------------------------------------------------
function filasNovedades_(db) { return leerSeguro_(db, 'NOVEDADES'); }
function filasLecturas_(db) { return leerSeguro_(db, 'NOVEDADES_LECTURAS'); }

function filasHistorial_(db, novedadId) {
  return leerSeguro_(db, 'NOVEDADES_HISTORIAL')
    .filter((h) => h.novedad_id === novedadId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function registrarHistorial_(db, novedadId, evento, contexto, comentario) {
  agregarFila_(db, 'NOVEDADES_HISTORIAL', {
    historial_id: crypto.randomUUID(),
    novedad_id: novedadId,
    evento: evento,
    autor_email: contexto.email,
    autor_nombre: contexto.email,
    comentario: comentario || '',
    timestamp: new Date().toISOString()
  });
}

// novedad_id -> [correos normalizados]. Sin memo global (ver cabecera).
function indiceAudiencia_(db) {
  const indice = {};
  leerSeguro_(db, 'NOVEDADES_AUDIENCIA').forEach((a) => {
    if (!indice[a.novedad_id]) indice[a.novedad_id] = [];
    indice[a.novedad_id].push(normalizarEmail_(a.destinatario_email));
  });
  return indice;
}

function filasAudiencia_(db, novedadId) {
  return indiceAudiencia_(db)[novedadId] || [];
}

function guardarDestinatarios_(db, novedadId, destinatarios) {
  destinatarios.forEach((email) => {
    agregarFila_(db, 'NOVEDADES_AUDIENCIA', {
      audiencia_id: crypto.randomUUID(),
      novedad_id: novedadId,
      destinatario_email: email
    });
  });
}

function audienciaOwner_(novedad) {
  return normalizarEmail_(novedad.aprobador_email) || normalizarEmail_(novedad.autor_email);
}

// Lista de correos objetivo, o null si es "todos".
function resolverAudiencia_(db, novedad) {
  const tipo = novedad.audiencia_tipo || 'TODOS';
  if (tipo === 'MI_EQUIPO') {
    const owner = audienciaOwner_(novedad);
    const equipo = obtenerEquipoJefe_(db, owner).map(normalizarEmail_);
    if (equipo.indexOf(owner) === -1) equipo.push(owner);
    return equipo;
  }
  if (tipo === 'SELECCION') {
    return filasAudiencia_(db, novedad.novedad_id);
  }
  return null; // TODOS
}

function personaEnAudiencia_(db, novedad, email) {
  const destinatarios = resolverAudiencia_(db, novedad);
  if (destinatarios === null) return true;
  return destinatarios.indexOf(normalizarEmail_(email)) !== -1;
}

// Visibilidad en feed/detalle: ADM ve todo, el autor y quien aprobo ven la
// suya, el resto solo si esta dentro de la audiencia declarada.
function enAudiencia_(db, novedad, contexto) {
  const correo = normalizarEmail_(contexto.email);
  if (contexto.rol === 'ADM') return true;
  if (normalizarEmail_(novedad.autor_email) === correo) return true;
  if (novedad.aprobador_email && normalizarEmail_(novedad.aprobador_email) === correo) return true;
  return personaEnAudiencia_(db, novedad, correo);
}

function audienciaResumen_(db, novedad) {
  const tipo = novedad.audiencia_tipo || 'TODOS';
  if (tipo !== 'SELECCION') return { tipo: tipo, destinatarios: [] };
  const ids = {};
  filasAudiencia_(db, novedad.novedad_id).forEach((email) => { ids[normalizarEmail_(email)] = true; });
  const personas = audienciaNovedades_(db).filter((p) => ids[p.email]);
  return { tipo: tipo, destinatarios: personas };
}

function validarAudienciaEntrante_(db, data, contexto) {
  if (!data.audiencia_tipo) {
    return { tipo: 'TODOS', destinatarios: [] };
  }
  const tipo = data.audiencia_tipo;
  if (['TODOS', 'MI_EQUIPO', 'SELECCION'].indexOf(tipo) === -1) {
    return { error: errorValidacion('audiencia_tipo', 'Audiencia invalida.') };
  }
  const tieneEquipo = obtenerEquipoJefe_(db, contexto.email).length > 0;
  const puedeAmplio = contexto.rol === 'ADM' || tieneEquipo;
  if (tipo === 'TODOS' && !puedeAmplio) {
    return { error: errorForbidden('Solo tu jefatura o un Administrador puede enviar a todos.') };
  }
  if (tipo === 'MI_EQUIPO' && !tieneEquipo) {
    return { error: errorForbidden('No tienes un equipo asignado en Jefaturas.') };
  }
  let destinatarios = [];
  if (tipo === 'SELECCION') {
    destinatarios = (Array.isArray(data.destinatarios) ? data.destinatarios : [])
      .map(normalizarEmail_)
      .filter((email, i, todos) => email && todos.indexOf(email) === i);
    if (!destinatarios.length) {
      return { error: errorValidacion('destinatarios', 'Selecciona al menos una persona.') };
    }
    const validos = {};
    audienciaNovedades_(db).forEach((p) => { validos[p.email] = true; });
    const invalido = destinatarios.filter((email) => !validos[email])[0];
    if (invalido) {
      return { error: errorValidacion('destinatarios', 'Uno de los destinatarios no tiene credenciales activas en SIGSO.') };
    }
  }
  return { tipo: tipo, destinatarios: destinatarios };
}

// SIGSO v2, Módulo 6A: el directorio junta USUARIOS (del Backoffice viejo)
// y CUENTAS_PORTAL, pero hoy solo se entra con cuenta del portal. Quien no
// tiene cuenta activa NO puede acusar nunca; quien tiene cuenta y jamás
// entró, tampoco en la práctica. Se marcan para que el cumplimiento no los
// cuente como incumplimiento y el recordatorio no les escriba.
function estadoCuentas_(db) {
  const m = {};
  leerSeguro_(db, 'CUENTAS_PORTAL').forEach((c) => {
    if (!esVerdadero_(c.activo)) return;
    parsearListaPortal(c.emails).forEach((raw) => {
      const email = normalizarEmail_(raw);
      if (email) m[email] = { nunca_entro: !c.ultimo_acceso };
    });
  });
  return m;
}

// La audiencia REAL: interseccion entre lo declarado y quien tiene
// credenciales activas hoy.
function personasAudiencia_(db, novedad) {
  const cuentas = estadoCuentas_(db);
  const marcar = (p) => Object.assign({}, p, { sin_cuenta: !cuentas[p.email], nunca_entro: !!(cuentas[p.email] && cuentas[p.email].nunca_entro) });
  const todos = audienciaNovedades_(db).map(marcar);
  const destinatarios = resolverAudiencia_(db, novedad);
  if (destinatarios === null) return todos;
  const set = {};
  destinatarios.forEach((email) => { set[email] = true; });
  return todos.filter((p) => set[p.email]);
}

function validarFechaLimiteEntrante_(data, tipo, requiereAcuse) {
  const fecha = data.fecha_limite_acuse ? String(data.fecha_limite_acuse).trim() : '';
  const sinAcuse = requiereAcuse === false;

  if (sinAcuse && TIPOS_EXIGEN_PLAZO[tipo]) {
    return { error: errorValidacion('requiere_acuse',
      'Ley y Dictamen exigen acuse de lectura: son los que llevan un plazo legal que hay que poder demostrar.') };
  }
  if (fecha && sinAcuse) {
    return { error: errorValidacion('fecha_limite_acuse',
      'Esta novedad no exige acuse, asi que no puede llevar una fecha limite para darlo. Marca "Exigir acuse" o quita la fecha.') };
  }
  if (!fecha) {
    if (TIPOS_EXIGEN_PLAZO[tipo]) {
      return { error: errorValidacion('fecha_limite_acuse', 'Este tipo exige una fecha límite para dar el acuse.') };
    }
    return { fecha: '' };
  }
  // Estricto AAAA-MM-DD (mismo criterio que pausas.js/proyectos.js para
  // fechas-sin-hora): antes se aceptaba cualquier string que new Date()
  // supiera parsear, incluida una fecha con hora/zona -- diasParaVencer_
  // concatena 'T00:00:00' a mano asumiendo este formato exacto, asi que
  // un valor distinto producia NaN dias-para-vencer y el item caia
  // silenciosamente en "al dia" aunque estuviera vencido. El input real
  // del frontend (<input type="date">) siempre manda este formato.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return { error: errorValidacion('fecha_limite_acuse', 'Fecha límite inválida: usa el formato AAAA-MM-DD.') };
  }
  const d = new Date(fecha + 'T00:00:00');
  if (isNaN(d.getTime())) {
    return { error: errorValidacion('fecha_limite_acuse', 'Fecha límite inválida.') };
  }
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  if (d < hoy) {
    return { error: errorValidacion('fecha_limite_acuse', 'La fecha límite no puede ser anterior a hoy.') };
  }
  return { fecha: fecha };
}

// SIGSO v2 (Módulo 6A): la fecha límite se guarda como "AAAA-MM-DD" o como
// ISO con hora ("2026-08-15T00:00:00.000Z"). Antes se le concatenaba otra
// "T00:00:00" -> fecha inválida -> null: el plazo NUNCA se calculaba y el
// panel de cumplimiento mostraba como "al día" avisos ya vencidos. Se compara
// por día calendario de Chile.
function diasParaVencer_(fechaLimite) {
  const clave = String(fechaLimite || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clave)) return null;
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
  const aUtc = (k) => Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));
  return Math.round((aUtc(clave) - aUtc(hoy)) / 86400000);
}

function areasPublicables_(db, contexto) {
  const areas = leerSeguro_(db, 'CAT_AREAS').filter((a) => esVerdadero_(a.activo));
  if (contexto.rol === 'ADM') return areas;
  const correo = normalizarEmail_(contexto.email);
  return areas.filter((a) => normalizarEmail_(a.responsable_email) === correo);
}

function puedePublicarEnArea_(db, contexto, areaId) {
  if (contexto.rol === 'ADM') return true;
  if (!areaId) return false;
  return areasPublicables_(db, contexto).some((a) => a.area_id === areaId);
}

function esAutorONoAutor_(novedad, contexto) {
  return contexto.rol === 'ADM' || normalizarEmail_(novedad.autor_email) === normalizarEmail_(contexto.email);
}

function puedeAprobar_(db, contexto, autorEmail) {
  if (contexto.rol === 'ADM') return true;
  const jefe = jefeDeSubordinado_(db, autorEmail);
  return !!jefe && normalizarEmail_(jefe) === normalizarEmail_(contexto.email);
}

function puedeVerDetalle_(db, novedad, contexto) {
  // `activa` tambien tiene que estar prendida: despublicar (linea ~670)
  // solo apaga `activa`, nunca toca `estado` -- sin este chequeo,
  // getDetalle/marcarLeida/descargarAdjunto seguian funcionando para la
  // audiencia original despues de "retirar" una novedad, aunque el feed
  // y el panel de cumplimiento ya la ocultaran.
  if (novedad.estado === ESTADOS.PUBLICADA && esVerdadero_(novedad.activa)) return enAudiencia_(db, novedad, contexto);
  return esAutorONoAutor_(novedad, contexto) || puedeAprobar_(db, contexto, novedad.autor_email);
}

function nombreArea_(db, areaId) {
  if (!areaId) return '';
  const area = leerSeguro_(db, 'CAT_AREAS').find((a) => a.area_id === areaId);
  return area ? area.nombre : areaId;
}

function buscarNovedad_(db, novedadId) {
  return filasNovedades_(db).find((n) => n.novedad_id === novedadId) || null;
}

// Directorio: union de USUARIOS activos + correos de CUENTAS_PORTAL activas.
function audienciaNovedades_(db) {
  const vistos = {};
  const lista = [];
  leerSeguro_(db, 'USUARIOS').forEach((u) => {
    const email = normalizarEmail_(u.email);
    if (esVerdadero_(u.activo) && email && !vistos[email]) {
      vistos[email] = true;
      lista.push({ email: email, nombre: u.nombre || email });
    }
  });
  leerSeguro_(db, 'CUENTAS_PORTAL').forEach((c) => {
    if (!esVerdadero_(c.activo)) return;
    parsearListaPortal(c.emails).forEach((raw) => {
      const email = normalizarEmail_(raw);
      if (email && !vistos[email]) {
        vistos[email] = true;
        lista.push({ email: email, nombre: c.nombre || email });
      }
    });
  });
  return lista;
}

function destinatariosRevision_(db, autorEmail) {
  const jefe = jefeDeSubordinado_(db, autorEmail);
  if (jefe) return [normalizarEmail_(jefe)];
  return leerSeguro_(db, 'USUARIOS')
    .filter((u) => esVerdadero_(u.activo) && u.rol === 'ADM')
    .map((u) => normalizarEmail_(u.email));
}

function resumenNovedad_(n) {
  const tipoInfo = TIPOS[n.tipo] || { etiqueta: n.tipo, color: 'info' };
  return {
    novedad_id: n.novedad_id, tipo: n.tipo, tipo_etiqueta: tipoInfo.etiqueta, tipo_color: tipoInfo.color,
    titulo: n.titulo, resumen: n.resumen, area_nombre: n.area_nombre,
    autor_email: n.autor_email, autor_nombre: n.autor_nombre, estado: n.estado,
    motivo_devolucion: n.motivo_devolucion || '', fecha_creacion: n.fecha_creacion,
    audiencia_tipo: n.audiencia_tipo || '', fuente_url: n.fuente_url || ''
  };
}

// --- notificaciones (correo + aviso vivo) ---------------------------------
async function notificarNuevaRevision_(db, novedad) {
  const tipoInfo = TIPOS[novedad.tipo] || { etiqueta: novedad.tipo };
  const asunto = 'SIGSO - Novedad por aprobar: ' + novedad.titulo;
  const cuerpo = tipoInfo.etiqueta + ' de ' + novedad.autor_nombre + ': ' + novedad.titulo +
    '\n\n' + novedad.resumen + '\n\nEntra a SIGSO > Novedades > Por aprobar para revisarla.';
  const evento = 'NOVEDAD_EN_REVISION:' + crypto.randomUUID();
  for (const email of destinatariosRevision_(db, novedad.autor_email)) {
    await Notificaciones.enviarCorreoModulo(db, { solicitudId: novedad.novedad_id, destinatario: email, evento, asunto, cuerpo });
  }
}

async function notificarDecisionAutor_(db, novedad, evento, asunto, motivo) {
  const cuerpo = novedad.titulo + '\n\n' + (motivo ? 'Motivo: ' + motivo + '\n\n' : '') +
    'Entra a SIGSO > Novedades > Mis envíos para revisarla.';
  await Notificaciones.enviarCorreoModulo(db, { solicitudId: novedad.novedad_id, destinatario: novedad.autor_email, evento, asunto, cuerpo });
}

async function notificarPublicacionLey_(db, novedad) {
  const autor = normalizarEmail_(novedad.autor_email);
  const asunto = 'SIGSO - Nueva novedad: ' + novedad.titulo;
  const cuerpo = TIPOS.LEY.etiqueta + ': ' + novedad.titulo + '\n\n' + novedad.resumen +
    '\n\nEntra a SIGSO > Novedades para verla completa y confirmar "Enterado".';
  for (const persona of audienciaNovedades_(db)) {
    if (persona.email === autor) continue;
    if (!personaEnAudiencia_(db, novedad, persona.email)) continue;
    await Notificaciones.enviarCorreoModulo(db, { solicitudId: novedad.novedad_id, destinatario: persona.email, evento: 'NOVEDAD_PUBLICADA', asunto, cuerpo });
  }
}

async function notificarPublicacionLibre_(db, novedad) {
  const tipoInfo = TIPOS[novedad.tipo] || { etiqueta: novedad.tipo, color: 'info' };
  const autor = normalizarEmail_(novedad.autor_email);
  const asunto = 'SIGSO - Nueva novedad: ' + novedad.titulo;
  const cuerpo = tipoInfo.etiqueta + ': ' + novedad.titulo + '\n\n' + novedad.resumen +
    '\n\nEntra a SIGSO > Novedades para verla completa.';
  const destinatarios = audienciaNovedades_(db)
    .filter((persona) => persona.email !== autor && personaEnAudiencia_(db, novedad, persona.email))
    .map((persona) => persona.email);
  for (const email of destinatarios) {
    await Notificaciones.enviarCorreoModulo(db, { solicitudId: novedad.novedad_id, destinatario: email, evento: 'NOVEDAD_PUBLICADA', asunto, cuerpo });
  }
  NotificacionesApp.encolarLote(db, destinatarios.map((email) => ({
    destinatario: email, tipo: 'NOVEDAD_PUBLICADA',
    titulo: tipoInfo.etiqueta + ': ' + novedad.titulo,
    mensaje: novedad.resumen, modulo_id: 'novedades', texto_accion: 'Ver novedad', vidaHoras: 48
  })));
}

// --- acciones de lectura ---------------------------------------------------
function listarAreasPublicables(db, data, contexto) {
  const equipoEmails = obtenerEquipoJefe_(db, contexto.email).map(normalizarEmail_);
  const equipoSet = {};
  equipoEmails.forEach((e) => { equipoSet[e] = true; });
  const cuentas = estadoCuentas_(db);
  const directorio = audienciaNovedades_(db).map((p) => Object.assign({}, p, {
    sin_cuenta: !cuentas[p.email], nunca_entro: !!(cuentas[p.email] && cuentas[p.email].nunca_entro)
  }));
  return {
    areas: areasPublicables_(db, contexto).map((a) => ({ area_id: a.area_id, nombre: a.nombre })),
    puede_general: contexto.rol === 'ADM',
    tipos: Object.keys(TIPOS).map((t) => ({ tipo: t, etiqueta: TIPOS[t].etiqueta, color: TIPOS[t].color, carril: TIPOS[t].carril })),
    directorio: directorio,
    equipo: directorio.filter((p) => equipoSet[p.email]),
    puede_equipo: equipoEmails.length > 0,
    puede_todos: contexto.rol === 'ADM' || equipoEmails.length > 0
  };
}

function getFeed(db, data, contexto) {
  const correo = normalizarEmail_(contexto.email);
  const leidasPorMi = {};
  filasLecturas_(db).forEach((l) => {
    if (normalizarEmail_(l.usuario_email) === correo) leidasPorMi[l.novedad_id] = l.leido_en;
  });

  const filtroTipo = data && data.tipo;
  const filtroArea = data && data.area_id;

  const recientes = filasNovedades_(db)
    .filter((n) => esVerdadero_(n.activa))
    .filter((n) => !filtroTipo || n.tipo === filtroTipo)
    .filter((n) => !filtroArea || n.area_id === filtroArea)
    .filter((n) => enAudiencia_(db, n, contexto))
    .map((n) => {
      const tipoInfo = TIPOS[n.tipo] || { etiqueta: n.tipo, color: 'info' };
      return {
        novedad_id: n.novedad_id, tipo: n.tipo, tipo_etiqueta: tipoInfo.etiqueta, tipo_color: tipoInfo.color,
        titulo: n.titulo, resumen: n.resumen, area_id: n.area_id, area_nombre: n.area_nombre,
        autor_email: n.autor_email, autor_nombre: n.autor_nombre,
        requiere_acuse: esVerdadero_(n.requiere_acuse), fecha_vigencia: n.fecha_vigencia || '',
        tiene_adjunto: !!n.archivo_id, fecha_publicacion: n.fecha_publicacion,
        leida: !!leidasPorMi[n.novedad_id], puede_gestionar: esAutorONoAutor_(n, contexto),
        audiencia_tipo: n.audiencia_tipo || 'TODOS', fecha_limite_acuse: n.fecha_limite_acuse || '',
        dias_para_vencer: n.fecha_limite_acuse ? diasParaVencer_(n.fecha_limite_acuse) : null
      };
    })
    .sort((a, b) => new Date(b.fecha_publicacion) - new Date(a.fecha_publicacion));

  const pendientes = recientes.filter((n) => n.requiere_acuse && !n.leida).length;
  return { recientes: recientes, resumen: { pendientes: pendientes, total: recientes.length } };
}

function getDetalle(db, data, contexto) {
  if (!data || !data.novedad_id) return errorValidacion('novedad_id', 'Falta indicar la novedad.');
  const n = buscarNovedad_(db, data.novedad_id);
  if (!n) return errorValidacion('novedad_id', 'No existe esa novedad.');
  if (!puedeVerDetalle_(db, n, contexto)) {
    return errorForbidden('Esta novedad todavía no está publicada.');
  }
  const correo = normalizarEmail_(contexto.email);
  const leida = filasLecturas_(db).some((l) => l.novedad_id === n.novedad_id && normalizarEmail_(l.usuario_email) === correo);
  const tipoInfo = TIPOS[n.tipo] || { etiqueta: n.tipo, color: 'info' };
  return {
    novedad_id: n.novedad_id, tipo: n.tipo, tipo_etiqueta: tipoInfo.etiqueta, tipo_color: tipoInfo.color,
    carril: tipoInfo.carril, titulo: n.titulo, resumen: n.resumen, cuerpo: n.cuerpo,
    area_id: n.area_id, area_nombre: n.area_nombre, autor_email: n.autor_email, autor_nombre: n.autor_nombre,
    requiere_acuse: esVerdadero_(n.requiere_acuse), fecha_vigencia: n.fecha_vigencia || '',
    tiene_adjunto: !!n.archivo_id, archivo_nombre: n.archivo_nombre || '',
    estado: n.estado || ESTADOS.PUBLICADA, motivo_devolucion: n.motivo_devolucion || '',
    fecha_creacion: n.fecha_creacion || n.fecha_publicacion, fecha_publicacion: n.fecha_publicacion,
    leida: leida, puede_gestionar: esAutorONoAutor_(n, contexto),
    puede_aprobar: puedeAprobar_(db, contexto, n.autor_email),
    es_autor: normalizarEmail_(n.autor_email) === correo,
    audiencia: audienciaResumen_(db, n),
    fecha_limite_acuse: n.fecha_limite_acuse || '',
    dias_para_vencer: n.fecha_limite_acuse ? diasParaVencer_(n.fecha_limite_acuse) : null,
    fuente_url: n.fuente_url || ''
  };
}

function getHistorial(db, data, contexto) {
  if (!data || !data.novedad_id) return errorValidacion('novedad_id', 'Falta indicar la novedad.');
  const n = buscarNovedad_(db, data.novedad_id);
  if (!n) return errorValidacion('novedad_id', 'No existe esa novedad.');
  if (!puedeVerDetalle_(db, n, contexto)) {
    return errorForbidden('Esta novedad todavía no está publicada.');
  }
  return { eventos: filasHistorial_(db, n.novedad_id) };
}

// --- publicacion / flujo editorial ----------------------------------------
function validarFuente_(valor, tipo) {
  const url = String(valor || '').trim();
  if (url && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) {
    return { error: errorValidacion('fuente_url', 'La fuente debe ser un enlace que empiece con http:// o https://.') };
  }
  if (!url && TIPOS_EXIGEN_PLAZO[tipo]) {
    return { error: errorValidacion('fuente_url', 'Ley y Dictamen necesitan el enlace a la fuente oficial (p. ej. bcn.cl o diariooficial.interior.gob.cl).') };
  }
  return { url: url };
}
async function publicar(db, data, contexto) {
  data = data || {};
  if (!TIPOS[data.tipo]) return errorValidacion('tipo', 'Tipo de novedad invalido.');
  if (!data.titulo || !String(data.titulo).trim()) return errorValidacion('titulo', 'Falta el titulo.');
  if (!data.resumen || !String(data.resumen).trim()) return errorValidacion('resumen', 'Falta el resumen.');
  const areaId = data.area_id || '';
  if (!puedePublicarEnArea_(db, contexto, areaId)) {
    return errorForbidden(areaId
      ? 'No eres responsable de esa area: no puedes publicar en ella.'
      : 'Solo un Administrador puede publicar sin area (general).');
  }

  const carril = TIPOS[data.tipo].carril;
  const esLibre = carril === 'LIBRE';

  if (TIPOS_EXIGEN_PLAZO[data.tipo] && data.requiere_acuse === false) {
    return errorValidacion('requiere_acuse',
      'Ley y Dictamen exigen acuse de lectura: son los que llevan un plazo legal que hay que poder demostrar.');
  }

  // SIGSO v2 (Módulo 6B): Ley y Dictamen llevan el enlace a su fuente oficial.
  // Ninguna Ley llegó a publicarse: se devolvían pidiendo "el link de donde
  // sacaste esto" y el formulario no tenía dónde ponerlo.
  const fuente = validarFuente_(data.fuente_url, data.tipo);
  if (fuente.error) return fuente.error;

  let audiencia = { tipo: 'TODOS', destinatarios: [] };
  let fechaLimite = { fecha: '' };
  if (esLibre) {
    const validacionAudiencia = validarAudienciaEntrante_(db, data, contexto);
    if (validacionAudiencia.error) return validacionAudiencia.error;
    audiencia = validacionAudiencia;
    const validacionFecha = validarFechaLimiteEntrante_(data, data.tipo, data.requiere_acuse !== false);
    if (validacionFecha.error) return validacionFecha.error;
    fechaLimite = validacionFecha;
  }

  const novedadId = crypto.randomUUID();
  let archivo = { archivo_id: '', archivo_nombre: '', archivo_mime: '' };
  if (data.contenido_base64) {
    if (!data.nombre_archivo) return errorValidacion('nombre_archivo', 'Falta el nombre del archivo adjunto.');
    let bytes;
    try {
      bytes = Buffer.from(data.contenido_base64, 'base64');
    } catch (err) {
      return errorValidacion('contenido_base64', 'El adjunto no es base64 valido.');
    }
    if (bytes.length > MAX_ADJUNTO_BYTES) {
      return errorValidacion('contenido_base64',
        'El adjunto supera el tamano maximo (' + Math.round(MAX_ADJUNTO_BYTES / (1024 * 1024)) + ' MB).');
    }
    if (!esPdf_(bytes)) return errorValidacion('contenido_base64', 'El adjunto debe ser un PDF.');

    const clave = 'novedades/' + novedadId + '/' + data.nombre_archivo;
    const subida = await Almacenamiento.subirArchivo_(clave, data.contenido_base64, 'application/pdf');
    if (!subida.ok) return errorValidacion('contenido_base64', subida.message);
    archivo = { archivo_id: clave, archivo_nombre: data.nombre_archivo, archivo_mime: 'application/pdf' };
  }

  const ahora = new Date().toISOString();
  const novedad = {
    novedad_id: novedadId,
    tipo: data.tipo, titulo: String(data.titulo).trim(), resumen: String(data.resumen).trim(),
    cuerpo: data.cuerpo || '', area_id: areaId, area_nombre: nombreArea_(db, areaId),
    autor_email: contexto.email, autor_nombre: data.autor_nombre || contexto.email,
    requiere_acuse: data.requiere_acuse === false ? false : true,
    fecha_vigencia: data.fecha_vigencia || '',
    archivo_id: archivo.archivo_id, archivo_nombre: archivo.archivo_nombre, archivo_mime: archivo.archivo_mime,
    estado: esLibre ? ESTADOS.PUBLICADA : ESTADOS.EN_REVISION,
    fecha_creacion: ahora, aprobador_email: '', aprobador_nombre: '', fecha_aprobacion: '', motivo_devolucion: '',
    audiencia_tipo: esLibre ? audiencia.tipo : '',
    fecha_limite_acuse: esLibre ? fechaLimite.fecha : '',
    fecha_publicacion: esLibre ? ahora : '',
    activa: esLibre,
    fuente_url: fuente.url
  };

  agregarFila_(db, 'NOVEDADES', novedad);
  if (esLibre && audiencia.tipo === 'SELECCION') {
    guardarDestinatarios_(db, novedad.novedad_id, audiencia.destinatarios);
  }

  if (esLibre) {
    await notificarPublicacionLibre_(db, novedad);
    return { novedad_id: novedad.novedad_id, estado: novedad.estado };
  }

  registrarHistorial_(db, novedad.novedad_id, 'ENVIADA_REVISION', contexto, '');
  await notificarNuevaRevision_(db, novedad);
  return { novedad_id: novedad.novedad_id, estado: novedad.estado };
}

async function aprobar(db, data, contexto) {
  if (!data || !data.novedad_id) return errorValidacion('novedad_id', 'Falta indicar la novedad.');
  const n = buscarNovedad_(db, data.novedad_id);
  if (!n) return errorValidacion('novedad_id', 'No existe esa novedad.');
  if (n.estado !== ESTADOS.EN_REVISION) return errorValidacion('novedad_id', 'Esta novedad no está esperando aprobación.');
  if (!puedeAprobar_(db, contexto, n.autor_email)) {
    return errorForbidden('Solo la jefatura de quien la redactó, o un Administrador, puede aprobarla.');
  }
  const validacionAudiencia = validarAudienciaEntrante_(db, data || {}, contexto);
  if (validacionAudiencia.error) return validacionAudiencia.error;
  const exigeAcuse = esVerdadero_(n.requiere_acuse);
  const validacionFecha = validarFechaLimiteEntrante_(data || {}, n.tipo, exigeAcuse);
  if (validacionFecha.error) return validacionFecha.error;

  const ahora = new Date().toISOString();
  const cambios = {
    estado: ESTADOS.PUBLICADA, activa: true, fecha_publicacion: ahora,
    aprobador_email: contexto.email, aprobador_nombre: data.aprobador_nombre || contexto.email,
    fecha_aprobacion: ahora, audiencia_tipo: validacionAudiencia.tipo, fecha_limite_acuse: validacionFecha.fecha
  };
  actualizarFilaPorId_(db, 'NOVEDADES', 'novedad_id', n.novedad_id, cambios);
  if (validacionAudiencia.tipo === 'SELECCION') {
    guardarDestinatarios_(db, n.novedad_id, validacionAudiencia.destinatarios);
  }
  registrarHistorial_(db, n.novedad_id, 'APROBADA', contexto, data.comentario || '');

  if (n.tipo === 'LEY') {
    await notificarPublicacionLey_(db, Object.assign({}, n, cambios));
  }
  return { estado: ESTADOS.PUBLICADA };
}

async function devolver(db, data, contexto) {
  if (!data || !data.novedad_id) return errorValidacion('novedad_id', 'Falta indicar la novedad.');
  const motivo = String((data && data.motivo) || '').trim();
  if (motivo.length < MOTIVO_MIN_CARACTERES) {
    return errorValidacion('motivo', 'El motivo debe tener al menos ' + MOTIVO_MIN_CARACTERES + ' caracteres.');
  }
  const n = buscarNovedad_(db, data.novedad_id);
  if (!n) return errorValidacion('novedad_id', 'No existe esa novedad.');
  if (n.estado !== ESTADOS.EN_REVISION) return errorValidacion('novedad_id', 'Esta novedad no está esperando aprobación.');
  if (!puedeAprobar_(db, contexto, n.autor_email)) {
    return errorForbidden('Solo la jefatura de quien la redactó, o un Administrador, puede devolverla.');
  }
  actualizarFilaPorId_(db, 'NOVEDADES', 'novedad_id', n.novedad_id, { estado: ESTADOS.DEVUELTA, motivo_devolucion: motivo });
  registrarHistorial_(db, n.novedad_id, 'DEVUELTA', contexto, motivo);
  await notificarDecisionAutor_(db, n, 'NOVEDAD_DEVUELTA', 'SIGSO - Tu novedad fue devuelta para corregir: ' + n.titulo, motivo);
  return { estado: ESTADOS.DEVUELTA };
}

async function rechazar(db, data, contexto) {
  if (!data || !data.novedad_id) return errorValidacion('novedad_id', 'Falta indicar la novedad.');
  const motivo = String((data && data.motivo) || '').trim();
  if (motivo.length < MOTIVO_MIN_CARACTERES) {
    return errorValidacion('motivo', 'El motivo debe tener al menos ' + MOTIVO_MIN_CARACTERES + ' caracteres.');
  }
  const n = buscarNovedad_(db, data.novedad_id);
  if (!n) return errorValidacion('novedad_id', 'No existe esa novedad.');
  if (n.estado !== ESTADOS.EN_REVISION) return errorValidacion('novedad_id', 'Esta novedad no está esperando aprobación.');
  if (!puedeAprobar_(db, contexto, n.autor_email)) {
    return errorForbidden('Solo la jefatura de quien la redactó, o un Administrador, puede rechazarla.');
  }
  actualizarFilaPorId_(db, 'NOVEDADES', 'novedad_id', n.novedad_id, { estado: ESTADOS.RECHAZADA, motivo_devolucion: motivo });
  registrarHistorial_(db, n.novedad_id, 'RECHAZADA', contexto, motivo);
  await notificarDecisionAutor_(db, n, 'NOVEDAD_RECHAZADA', 'SIGSO - Tu novedad fue rechazada: ' + n.titulo, motivo);
  return { estado: ESTADOS.RECHAZADA };
}

async function reenviar(db, data, contexto) {
  if (!data || !data.novedad_id) return errorValidacion('novedad_id', 'Falta indicar la novedad.');
  const n = buscarNovedad_(db, data.novedad_id);
  if (!n) return errorValidacion('novedad_id', 'No existe esa novedad.');
  if (normalizarEmail_(n.autor_email) !== normalizarEmail_(contexto.email)) {
    return errorForbidden('Solo quien la redactó puede corregirla y reenviarla.');
  }
  if (n.estado !== ESTADOS.DEVUELTA) return errorValidacion('novedad_id', 'Esta novedad no está devuelta para corrección.');

  const cambios = { estado: ESTADOS.EN_REVISION, motivo_devolucion: '' };
  if (data.titulo && String(data.titulo).trim()) cambios.titulo = String(data.titulo).trim();
  if (data.resumen && String(data.resumen).trim()) cambios.resumen = String(data.resumen).trim();
  if (data.cuerpo !== undefined) cambios.cuerpo = data.cuerpo || '';
  if (data.fecha_vigencia !== undefined) cambios.fecha_vigencia = data.fecha_vigencia || '';
  const fuenteReenvio = validarFuente_(data.fuente_url !== undefined ? data.fuente_url : n.fuente_url, n.tipo);
  if (fuenteReenvio.error) return fuenteReenvio.error;
  cambios.fuente_url = fuenteReenvio.url;

  actualizarFilaPorId_(db, 'NOVEDADES', 'novedad_id', n.novedad_id, cambios);
  registrarHistorial_(db, n.novedad_id, 'ENVIADA_REVISION', contexto, 'Reenviada tras corrección.');
  await notificarNuevaRevision_(db, Object.assign({}, n, cambios));
  return { estado: ESTADOS.EN_REVISION };
}

function listarPendientesAprobacion(db, data, contexto) {
  const enRevision = filasNovedades_(db).filter((n) => n.estado === ESTADOS.EN_REVISION);
  let propias;
  if (contexto.rol === 'ADM') {
    propias = enRevision;
  } else {
    const equipoSet = {};
    obtenerEquipoJefe_(db, contexto.email).forEach((email) => { equipoSet[normalizarEmail_(email)] = true; });
    propias = enRevision.filter((n) => equipoSet[normalizarEmail_(n.autor_email)]);
  }
  return {
    pendientes: propias.map(resumenNovedad_).sort((a, b) => new Date(a.fecha_creacion) - new Date(b.fecha_creacion))
  };
}

function misPendientes(db, data, contexto) {
  const correo = normalizarEmail_(contexto.email);
  const propias = filasNovedades_(db).filter((n) => normalizarEmail_(n.autor_email) === correo && n.estado !== ESTADOS.PUBLICADA);
  return {
    envios: propias.map(resumenNovedad_).sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion))
  };
}

function despublicar(db, data, contexto) {
  if (!data || !data.novedad_id) return errorValidacion('novedad_id', 'Falta indicar la novedad.');
  const n = buscarNovedad_(db, data.novedad_id);
  if (!n) return errorValidacion('novedad_id', 'No existe esa novedad.');
  if (!esAutorONoAutor_(n, contexto)) {
    return errorForbidden('Solo quien la publico o un Administrador puede retirarla.');
  }
  actualizarFilaPorId_(db, 'NOVEDADES', 'novedad_id', n.novedad_id, { activa: false });
  return { activa: false };
}

function marcarLeida(db, data, contexto) {
  if (!data || !data.novedad_id) return errorValidacion('novedad_id', 'Falta indicar la novedad.');
  const novedad = buscarNovedad_(db, data.novedad_id);
  if (!novedad) return errorValidacion('novedad_id', 'No existe esa novedad.');
  if (!puedeVerDetalle_(db, novedad, contexto)) {
    return errorForbidden('No tienes acceso a esta novedad.');
  }
  const correo = normalizarEmail_(contexto.email);
  const yaLeida = filasLecturas_(db).some((l) => l.novedad_id === data.novedad_id && normalizarEmail_(l.usuario_email) === correo);
  if (!yaLeida) {
    agregarFila_(db, 'NOVEDADES_LECTURAS', {
      lectura_id: crypto.randomUUID(), novedad_id: data.novedad_id,
      usuario_email: contexto.email, leido_en: new Date().toISOString()
    });
  }
  return { leida: true };
}

/**
 * Adjunto en base64 para descargar: el original en R2 es privado, así que
 * se sirve por esta acción en vez de exponer una URL pública.
 */
async function descargarAdjunto(db, data, contexto) {
  if (!data || !data.novedad_id) return errorValidacion('novedad_id', 'Falta indicar la novedad.');
  const n = buscarNovedad_(db, data.novedad_id);
  if (!n) return errorValidacion('novedad_id', 'No existe esa novedad.');
  // El adjunto es parte de la novedad: se protege con el MISMO criterio que
  // getDetalle. Sin esto, quien no puede ni abrirla igual podría bajarse el
  // archivo sabiendo el id -- incluida una que todavía está en revisión.
  if (!puedeVerDetalle_(db, n, contexto)) return errorForbidden('No tienes acceso a esta novedad.');
  if (!n.archivo_id) return errorValidacion('novedad_id', 'Esta novedad no tiene adjunto.');

  const descarga = await Almacenamiento.descargarArchivo_(n.archivo_id);
  if (!descarga.ok) return errorValidacion('novedad_id', descarga.message);
  return {
    contenido_base64: descarga.contenido_base64,
    nombre_archivo: n.archivo_nombre || '',
    mime: n.archivo_mime || 'application/pdf'
  };
}

function getLectores(db, data, contexto) {
  if (!data || !data.novedad_id) return errorValidacion('novedad_id', 'Falta indicar la novedad.');
  const n = buscarNovedad_(db, data.novedad_id);
  if (!n) return errorValidacion('novedad_id', 'No existe esa novedad.');
  if (!esAutorONoAutor_(n, contexto)) {
    return errorForbidden('Solo quien publico la novedad o un Administrador puede ver quien la leyo.');
  }
  const leidoPorEmail = {};
  filasLecturas_(db).forEach((l) => {
    if (l.novedad_id === n.novedad_id) leidoPorEmail[normalizarEmail_(l.usuario_email)] = l.leido_en;
  });
  const leyeron = [];
  const pendientes = [];
  personasAudiencia_(db, n).forEach((persona) => {
    if (leidoPorEmail[persona.email]) {
      leyeron.push({ email: persona.email, nombre: persona.nombre, leido_en: leidoPorEmail[persona.email] });
    } else {
      pendientes.push({ email: persona.email, nombre: persona.nombre, sin_cuenta: persona.sin_cuenta, nunca_entro: persona.nunca_entro });
    }
  });
  leyeron.sort((a, b) => new Date(a.leido_en) - new Date(b.leido_en));
  pendientes.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  return {
    leyeron: leyeron, pendientes: pendientes, total_audiencia: leyeron.length + pendientes.length,
    // Módulo 6A: de los pendientes, cuántos no pueden acusar (sin cuenta activa).
    pendientes_sin_cuenta: pendientes.filter((p) => p.sin_cuenta).length
  };
}

function getPanelCumplimiento(db, data, contexto) {
  if (contexto.rol !== 'ADM') {
    return errorForbidden('Solo un Administrador puede ver el panel de cumplimiento.');
  }
  const conPlazo = filasNovedades_(db).filter((n) => esVerdadero_(n.activa) && esVerdadero_(n.requiere_acuse) && n.fecha_limite_acuse);
  const leidoPor = {};
  filasLecturas_(db).forEach((l) => {
    if (!leidoPor[l.novedad_id]) leidoPor[l.novedad_id] = {};
    leidoPor[l.novedad_id][normalizarEmail_(l.usuario_email)] = true;
  });
  const items = conPlazo.map((n) => {
    const tipoInfo = TIPOS[n.tipo] || { etiqueta: n.tipo, color: 'info' };
    // Módulo 6A: quien no tiene cuenta activa no puede acusar -- se informa
    // aparte y no cuenta como incumplimiento.
    const todaLaAudiencia = personasAudiencia_(db, n);
    const sinCuenta = todaLaAudiencia.filter((p) => p.sin_cuenta && !(leidoPor[n.novedad_id] && leidoPor[n.novedad_id][p.email])).length;
    const audiencia = todaLaAudiencia.filter((p) => !p.sin_cuenta || (leidoPor[n.novedad_id] && leidoPor[n.novedad_id][p.email]));
    const confirmados = audiencia.filter((p) => leidoPor[n.novedad_id] && leidoPor[n.novedad_id][p.email]).length;
    const pendientes = audiencia.length - confirmados;
    const dias = diasParaVencer_(n.fecha_limite_acuse);
    const estado = pendientes === 0 ? 'CUMPLIDA' : (dias < 0 ? 'VENCIDA' : (dias <= 2 ? 'POR_VENCER' : 'AL_DIA'));
    return {
      novedad_id: n.novedad_id, tipo: n.tipo, tipo_etiqueta: tipoInfo.etiqueta, tipo_color: tipoInfo.color,
      titulo: n.titulo, fecha_limite_acuse: n.fecha_limite_acuse, dias_para_vencer: dias,
      estado_cumplimiento: estado, total_audiencia: audiencia.length, confirmados: confirmados, pendientes: pendientes,
      sin_cuenta: sinCuenta
    };
  }).sort((a, b) => a.dias_para_vencer - b.dias_para_vencer);
  return { items: items };
}

// Recordatorio diario (equivalente del trigger del .gs). UN correo por
// persona con TODAS sus pendientes; dedup por dia via el evento.
async function recordatorioPendientes(db) {
  const activasConAcuse = filasNovedades_(db).filter((n) => esVerdadero_(n.activa) && esVerdadero_(n.requiere_acuse));
  if (!activasConAcuse.length) return { enviados: 0 };

  const leidoPor = {};
  filasLecturas_(db).forEach((l) => {
    if (!leidoPor[l.novedad_id]) leidoPor[l.novedad_id] = {};
    leidoPor[l.novedad_id][normalizarEmail_(l.usuario_email)] = true;
  });

  const hoy = new Date().toISOString().slice(0, 10);
  const audienciaPorNovedad = {};
  activasConAcuse.forEach((n) => {
    const destinatarios = resolverAudiencia_(db, n);
    if (destinatarios === null) { audienciaPorNovedad[n.novedad_id] = null; return; }
    const set = {};
    destinatarios.forEach((email) => { set[email] = true; });
    audienciaPorNovedad[n.novedad_id] = set;
  });

  const plazoTexto_ = (n) => {
    if (!n.fecha_limite_acuse) return '';
    const dias = diasParaVencer_(n.fecha_limite_acuse);
    return dias < 0 ? ' (VENCIDO hace ' + (-dias) + ' día(s))' : ' (vence en ' + dias + ' día(s))';
  };

  let enviados = 0;
  // Módulo 6A: sin cuenta activa no puede entrar a acusar -- no se le escribe.
  const cuentas = estadoCuentas_(db);
  for (const persona of audienciaNovedades_(db).filter((p) => cuentas[p.email])) {
    const pendientes = activasConAcuse.filter((n) => {
      const set = audienciaPorNovedad[n.novedad_id];
      return normalizarEmail_(n.autor_email) !== persona.email &&
        (set === null || set[persona.email]) &&
        !(leidoPor[n.novedad_id] && leidoPor[n.novedad_id][persona.email]);
    });
    if (!pendientes.length) continue;
    const asunto = 'SIGSO - Tienes ' + pendientes.length + ' novedad(es) pendiente(s) de confirmar';
    const cuerpo = 'Tienes ' + pendientes.length + ' novedad(es) publicadas en SIGSO que aun no confirmas como leidas:\n' +
      pendientes.map((n) => '- ' + n.titulo + plazoTexto_(n)).join('\n') +
      '\n\nEntra a SIGSO > Novedades para revisarlas y marcar "Enterado".';
    const resultado = await Notificaciones.enviarCorreoModulo(db, {
      solicitudId: 'NOVEDADES_DIGEST', destinatario: persona.email,
      evento: 'NOVEDAD_RECORDATORIO:' + hoy, asunto, cuerpo, ventanaMinutos: 24 * 60
    });
    if (resultado.enviado) enviados++;
  }
  return { enviados: enviados };
}

module.exports = {
  listarAreasPublicables, getFeed, getDetalle, getHistorial,
  publicar, aprobar, devolver, rechazar, reenviar,
  listarPendientesAprobacion, misPendientes, despublicar, marcarLeida,
  descargarAdjunto, getLectores, getPanelCumplimiento, recordatorioPendientes
};
