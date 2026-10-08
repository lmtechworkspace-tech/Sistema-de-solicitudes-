'use strict';

/**
 * solicitudesPublico.js — puerto completo de la parte de
 * backend/intake/Solicitudes.gs que actua SIN cuenta de staff: estadoPublico
 * (accion "consultarEstado"), "Mis solicitudes" (solicitarCodigoAcceso +
 * misSolicitudes), editarSubsolicitud, eliminarArchivo, responderConsulta y
 * validarCierre (confirmar / reabrir / cerrar_directo).
 *
 * demasiadosIntentosEstado_/solicitarCodigoAcceso usaban CacheService en el
 * .gs (efimero, sin hoja nueva) -- aqui el equivalente es cacheEfimero.js
 * (Map en memoria del proceso), mismo criterio ya usado por sesiones.js para
 * el freno de fuerza bruta del login.
 *
 * eliminarArchivo NO porta el "mejor esfuerzo" de mandar el archivo a la
 * papelera de Drive (DriveApp) -- este stack todavia no tiene backend de
 * archivos real (R2 en Cloudflare, pendiente). Documentado en la funcion.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_, actualizarFilaPorId_, eliminarFilasPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { ESTADOS, ESTADOS_CERRADOS, ORDEN_PRIORIDAD } = require('./constantesSolicitudes');
const SolicitudesBO = require('./solicitudesBackoffice');
const { buscarSolicitudPorId_, buscarSubsolicitud_, fechaHoraCelda_ } = SolicitudesBO;
const { normalizarAtencionDirecta_, validarAtencionDirecta_ } = require('./solicitudes');
const Cumplimiento = require('./cumplimiento');
const Notificaciones = require('./notificaciones');
const Sesiones = require('./sesiones');
const Portal = require('./portal');
const Cache = require('./cacheEfimero');
// Código de acceso a «Mis solicitudes»: intentos por código y códigos por correo cada 10 min.
const INTENTOS_CODIGO_MAX = 5;
const ENVIOS_CODIGO_MAX = 3;
const VENTANA_CODIGO_MS = 10 * 60 * 1000;
const ArchivosSolicitud = require('./archivosSolicitud');
const DirectorioPersonal = require('./directorioPersonal');
const CierreAutomatico = require('./cierreAutomaticoSolicitudes');
const Servicios = require('./serviciosSolicitud');

function errorValidacion_(campo, mensaje) {
  return { _validationError: true, message: mensaje, fields: [{ campo: campo, mensaje: mensaje }] };
}

function compararEmail_(a, b) {
  return !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

// --- Fase 4: endurecimiento del acceso publico por numero + correo -------
//
// El acceso a "Consultar estado" se prueba con (numero de solicitud, correo).
// Los numeros son correlativos, asi que lo unico que protege de verdad es el
// correo -- sin frenos se podia probar de a muchos. Dos medidas, ninguna de
// las cuales le agrega un paso a quien SI es el dueño:
//   1) Respuesta identica para "no existe" y "no es tu solicitud" (antienumeracion).
//   2) Tope de intentos FALLIDOS por correo en una ventana de tiempo.
const MENSAJE_ESTADO_SIN_ACCESO = 'No encontramos una solicitud con ese número asociada a ese correo. Revisa ambos datos.';
const LIMITE_INTENTOS_ESTADO = 10;
const VENTANA_INTENTOS_ESTADO_SEG = 900; // 15 minutos

function claveIntentosEstado_(email) {
  return 'INTENTOS_ESTADO:' + String(email || '').trim().toLowerCase();
}

function demasiadosIntentosEstado_(email) {
  const n = Number(Cache.get(claveIntentosEstado_(email)) || 0);
  return n >= LIMITE_INTENTOS_ESTADO;
}

function registrarIntentoFallidoEstado_(email) {
  const clave = claveIntentosEstado_(email);
  const n = Number(Cache.get(clave) || 0) + 1;
  Cache.put(clave, String(n), VENTANA_INTENTOS_ESTADO_SEG);
  return n;
}

function limpiarIntentosEstado_(email) {
  Cache.remove(claveIntentosEstado_(email));
}

// P2: cuenta cuantas solicitudes ABIERTAS de la MISMA empresa estan
// "adelante" en la cola -- prioridad mas critica, o misma prioridad pero
// creada antes. No cruza empresas (la cola es la de tu propio equipo).
function calcularPosicionCola_(db, solicitud) {
  const indiceMiPrioridad = ORDEN_PRIORIDAD.indexOf(solicitud.prioridad_derivada);
  const miFecha = new Date(solicitud.fecha_creacion).getTime();
  return leerFilas_(db, 'SOLICITUDES', COLUMNAS.SOLICITUDES).filter((otra) => {
    if (otra.solicitud_id === solicitud.solicitud_id) return false;
    if (otra.empresa_id !== solicitud.empresa_id) return false;
    if (ESTADOS_CERRADOS.indexOf(otra.estado_derivado) !== -1) return false;
    const indiceOtra = ORDEN_PRIORIDAD.indexOf(otra.prioridad_derivada);
    if (indiceOtra < indiceMiPrioridad) return true;
    return indiceOtra === indiceMiPrioridad && new Date(otra.fecha_creacion).getTime() < miFecha;
  }).length;
}

// Ultimo comentario con el que el equipo entro a S06 para este item (el mas
// reciente, por si volvio a pedir informacion mas de una vez).
function obtenerUltimaPreguntaEsperandoInfo_(db, subsolicitudId) {
  const eventos = leerFilas_(db, 'HISTORIAL_ESTADOS', COLUMNAS.HISTORIAL_ESTADOS)
    .filter((h) => h.subsolicitud_id === subsolicitudId && h.estado_nuevo === ESTADOS.S06);
  if (eventos.length === 0) return '';
  const masReciente = eventos.reduce((a, b) => (new Date(b.timestamp) > new Date(a.timestamp) ? b : a));
  return masReciente.comentario || '';
}

/**
 * Fase 4 (rediseño, pestaña "Historial"): la linea de tiempo publica de una
 * solicitud a partir de HISTORIAL_ESTADOS -- lectura adicional, no se agrega
 * ninguna escritura nueva. Dos cosas se filtran a proposito porque .usuario
 * y .comentario los escribe tambien el STAFF y pueden traer un correo
 * interno o un motivo de rechazo pensado para uso interno:
 *  - el AUTOR nunca viaja como correo: se reduce a 'tu', 'sistema' o 'equipo'.
 *  - el COMENTARIO solo se expone cuando el autor es el propio solicitante.
 */
function historialPublico_(db, solicitudId, solicitud, email) {
  let eventos;
  try {
    eventos = leerFilas_(db, 'HISTORIAL_ESTADOS', COLUMNAS.HISTORIAL_ESTADOS).filter((h) => h.solicitud_id === solicitudId);
  } catch (err) { return []; }

  return eventos
    .map((h) => {
      // Comparar SOLO contra `email` (quien esta mirando ahora mismo, ya
      // validado por estadoPublico contra solicitante_email/correo_cliente
      // antes de llegar aca) -- no contra los campos guardados en la
      // solicitud. Comparar contra `solicitud.solicitante_email` directo
      // era el bug: si un EMPLEADO interno escribio un evento y el cliente
      // externo (es_cliente, entra por correo_cliente) mira el historial,
      // `h.usuario === solicitud.solicitante_email` daba true igual --
      // exponiendole al cliente un comentario interno etiquetado como "tu".
      const esSolicitante = compararEmail_(h.usuario, email);
      const actor = h.usuario === 'sistema' ? 'sistema' : (esSolicitante ? 'tu' : 'equipo');
      return {
        subsolicitud_id: h.subsolicitud_id || '',
        estado_anterior: h.estado_anterior || '',
        estado_nuevo: h.estado_nuevo,
        actor: actor,
        comentario: actor === 'tu' ? String(h.comentario || '') : '',
        timestamp: h.timestamp
      };
    })
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

// 2026-10-05 (auditoría, etapa 1): los mensajes que el equipo escribe SIN
// marcar "nota interna" son para el solicitante. Se muestran los del equipo
// desde que la Bandeja v2 rotula explícitamente "Nota interna (el solicitante
// no la ve)" (25-09-2026); los anteriores, escritos con la pantalla clásica,
// no se exponen. Los del propio solicitante (sus respuestas) siempre.
const MENSAJES_EQUIPO_DESDE = '2026-09-25T00:00:00-03:00';
function esInterno_(v) { return v === true || v === 'TRUE' || v === 1 || v === 'true'; }
function nombresEquipo_(db) {
  const n = {};
  try { DirectorioPersonal.directorioPersonalActivo_(db).forEach((p) => { n[String(p.email).toLowerCase()] = p.nombre; }); } catch (err) { /* sin directorio */ }
  return n;
}
function mensajesPublicos_(db, solicitudId, email, nombres) {
  let filas;
  try { filas = leerFilas_(db, 'COMENTARIOS', COLUMNAS.COMENTARIOS).filter((c) => c.solicitud_id === solicitudId && !esInterno_(c.es_interno)); } catch (err) { return []; }
  const desde = new Date(MENSAJES_EQUIPO_DESDE).getTime();
  return filas
    .map((c) => {
      const mio = compararEmail_(c.usuario, email);
      if (!mio && new Date(c.timestamp).getTime() < desde) return null;
      return {
        subsolicitud_id: c.subsolicitud_id || '', autor: mio ? 'tu' : 'equipo',
        // Nunca el correo del equipo: su nombre, o "El equipo".
        nombre: mio ? '' : (nombres[String(c.usuario || '').toLowerCase()] || 'El equipo'),
        texto: String(c.texto || ''), timestamp: c.timestamp
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}
function responsableValido_(v) {
  const t = String(v || '').trim();
  return /^[^\s@[\]]+@[^\s@]+\.[^\s@]+$/.test(t) ? t.toLowerCase() : '';
}

function estadoPublico(db, solicitudId, email) {
  if (!solicitudId || !email) {
    return errorValidacion_('solicitud_id', 'Debes indicar el numero de solicitud y el correo.');
  }

  if (demasiadosIntentosEstado_(email)) {
    return { _forbidden: true, message: MENSAJE_ESTADO_SIN_ACCESO };
  }

  const solicitud = buscarSolicitudPorId_(db, solicitudId);
  const coincide = !!solicitud && (
    compararEmail_(email, solicitud.solicitante_email) ||
    (!!solicitud.es_cliente && compararEmail_(email, solicitud.correo_cliente))
  );

  // "no existe" y "el correo no coincide" responden EXACTAMENTE lo mismo --
  // otro mensaje seria un oraculo (confirmaria que el numero existe).
  if (!coincide) {
    registrarIntentoFallidoEstado_(email);
    return { _forbidden: true, message: MENSAJE_ESTADO_SIN_ACCESO };
  }
  limpiarIntentosEstado_(email);

  // Fase 1: adjuntos que el solicitante mismo subio. Tolerante a que la
  // tabla ARCHIVOS no exista todavia (instalacion vieja o banco de pruebas
  // sin sembrar): sin adjuntos, no rompe el detalle.
  let archivosPorSub = {};
  try {
    leerFilas_(db, 'ARCHIVOS', COLUMNAS.ARCHIVOS)
      .filter((a) => a.solicitud_id === solicitudId && a.subsolicitud_id)
      .forEach((a) => {
        (archivosPorSub[a.subsolicitud_id] = archivosPorSub[a.subsolicitud_id] || []).push({
          archivo_id: a.archivo_id,
          nombre_original: a.nombre_original,
          url: a.url,
          tipo_mime: a.tipo_mime,
          tamano_bytes: a.tamano_bytes,
          fecha_subida: a.fecha_subida
        });
      });
  } catch (err) { archivosPorSub = {}; }

  const nombres = nombresEquipo_(db);
  const subsolicitudes = leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES)
    .filter((s) => s.solicitud_id === solicitudId)
    .map((s) => ({
      // Quién lo atiende (nombre; nunca el correo) y, si está terminado, cuándo
      // se cierra solo si no lo confirma (cierreAutomaticoSolicitudes.js).
      responsable_nombre: nombres[responsableValido_(s.desarrollador_asignado) || responsableValido_(solicitud.desarrollador_asignado)] || '',
      cierre_automatico_el: s.estado === ESTADOS.S08 ? CierreAutomatico.fechaCierreEstimada(db, s) : '',
      subsolicitud_id: s.subsolicitud_id,
      numero_item: s.numero_item,
      titulo: s.titulo,
      estado: s.estado,
      prioridad: s.prioridad,
      tipo_nombre: s.tipo_nombre || '',
      modulo_nombre: s.modulo_nombre || '',
      area_nombre: s.area_nombre || '',
      depto_nombre: s.depto_nombre || '', servicio_nombre: s.servicio_nombre || '',
      descripcion: s.descripcion || '',
      resultado_esperado: s.resultado_esperado || '',
      contexto: s.contexto || '',
      fecha_propuesta: fechaHoraCelda_(s.fecha_propuesta),
      fecha_comprometida: fechaHoraCelda_(s.fecha_comprometida),
      pregunta_pendiente: s.estado === ESTADOS.S06 ? obtenerUltimaPreguntaEsperandoInfo_(db, s.subsolicitud_id) : '',
      archivos: archivosPorSub[s.subsolicitud_id] || [],
      cumplimiento: Cumplimiento.clasificar(s)
    }));

  return {
    solicitud_id: solicitud.solicitud_id,
    estado_derivado: solicitud.estado_derivado,
    prioridad_derivada: solicitud.prioridad_derivada,
    fecha_creacion: solicitud.fecha_creacion,
    doc_estado: solicitud.doc_estado,
    url_pdf: solicitud.url_pdf,
    // P2: "cuantas hay antes que yo" en la cola de su propia empresa, sin
    // exponer el contenido de las demas (privacidad).
    posicion_cola: ESTADOS_CERRADOS.indexOf(solicitud.estado_derivado) === -1
      ? calcularPosicionCola_(db, solicitud)
      : null,
    subsolicitudes: subsolicitudes,
    historial: historialPublico_(db, solicitudId, solicitud, email),
    mensajes: mensajesPublicos_(db, solicitudId, email, nombres)
  };
}

// v3.0 (Fase 3, §4): primer paso de "Mis solicitudes" -- pide un codigo de
// un solo uso al correo indicado. Siempre responde ok (no revela si ese
// correo tiene o no solicitudes registradas). El codigo vive en cacheEfimero
// (efimero, sin tabla nueva) 10 minutos.
async function solicitarCodigoAcceso(db, data) {
  if (!data || !data.email) {
    return errorValidacion_('email', 'Debes indicar tu correo.');
  }
  const email = String(data.email).trim().toLowerCase();
  // Auditoría Codex 2026-10-08 (hallazgo 4): hasta ENVIOS_CODIGO_MAX códigos por
  // correo cada 10 minutos, para que pedir otro no reinicie los intentos sin fin.
  // Igual responde ok: no revela nada del correo.
  // Ventana deslizante (2.ª ronda de Codex): se guarda la hora de cada envío y
  // solo cuentan los de los últimos 10 minutos.
  // 2.ª ronda de Codex (D-003): los pedidos del MISMO correo van en fila (uno termina
  // de enviar antes de que el siguiente genere su código), y cada intento solo deshace
  // lo suyo: así un envío que falla nunca borra el código ni el cupo de otro que salió.
  const previo = colaCodigos_.get(email) || Promise.resolve();
  const turno = previo.catch(() => null).then(() => enviarCodigoEnFila_(db, data, email));
  colaCodigos_.set(email, turno);
  try { return await turno; } finally { if (colaCodigos_.get(email) === turno) colaCodigos_.delete(email); }
}

const colaCodigos_ = new Map(); // correo -> promesa del último pedido en curso
function enviosVigentes_(claveEnvios) {
  let lista = [];
  try { lista = JSON.parse(Cache.get(claveEnvios) || '[]'); } catch (e) { lista = []; }
  const ahora = Date.now();
  return (Array.isArray(lista) ? lista : [])
    .map((x) => (typeof x === 'object' && x ? x : { t: Number(x), id: '' }))
    .filter((x) => ahora - Number(x.t) < VENTANA_CODIGO_MS);
}
async function enviarCodigoEnFila_(db, data, email) {
  const claveEnvios = 'CODIGO_ACCESO_ENVIOS:' + email;
  const claveCodigo = 'CODIGO_ACCESO:' + email;
  // Ventana deslizante: se guarda la hora de cada envío (con un id por intento) y solo
  // cuentan los de los últimos 10 minutos.
  const envios = enviosVigentes_(claveEnvios);
  if (envios.length >= ENVIOS_CODIGO_MAX) return { ok: true };
  const intento = { t: Date.now(), id: crypto.randomBytes(8).toString('hex') };
  envios.push(intento);
  Cache.put(claveEnvios, JSON.stringify(envios), VENTANA_CODIGO_MS / 1000);
  // crypto.randomInt: Math.random no sirve para códigos de seguridad.
  const codigo = String(crypto.randomInt(100000, 1000000));
  // Se recuerda el código anterior (y cuándo vence) por si este envío falla.
  const claveVence = 'CODIGO_ACCESO_VENCE:' + email;
  const anterior = Cache.get(claveCodigo);
  const venceAnterior = Number(Cache.get(claveVence) || 0);
  Cache.put(claveCodigo, codigo, 600);
  Cache.put(claveVence, String(Date.now() + 600 * 1000), 600);
  Cache.remove('CODIGO_ACCESO_FALLOS:' + email);
  const envio = await Notificaciones.enviarCodigoAcceso(db, data.email, codigo);
  // Revisión Codex 2026-10-08 (D-002, hallazgo 4): con D-002 el código es la llave de
  // acceso; si el correo no sale, se dice (sin revelar si hay solicitudes), el código
  // no queda vigente y ese intento no gasta cupo. Solo se deshace LO DE ESTE INTENTO,
  // leyendo el estado actual (no una copia de antes del envío).
  if (envio && envio.enviado === false && (envio.motivo === 'canal_desactivado' || envio.motivo === 'error_envio')) {
    if (Cache.get(claveCodigo) === codigo) {
      // El código de un envío anterior que SÍ salió vuelve a valer, con su vencimiento.
      const resta = venceAnterior - Date.now();
      if (anterior && resta > 0) { Cache.put(claveCodigo, anterior, resta / 1000); Cache.put(claveVence, String(venceAnterior), resta / 1000); }
      else { Cache.remove(claveCodigo); Cache.remove(claveVence); }
    }
    const restantes = enviosVigentes_(claveEnvios).filter((x) => x.id !== intento.id);
    if (restantes.length) Cache.put(claveEnvios, JSON.stringify(restantes), VENTANA_CODIGO_MS / 1000); else Cache.remove(claveEnvios);
    return errorValidacion_('email', 'No pudimos enviar el código en este momento. Intenta de nuevo en unos minutos.');
  }
  return { ok: true };
}

// Valida el código de un solo uso de ese correo (con el límite de fallos del
// hallazgo 4). true = correcto (y ya no sirve otra vez).
function validarCodigo_(emailCrudo, codigoCrudo) {
  const email = String(emailCrudo || '').trim().toLowerCase();
  const clave = 'CODIGO_ACCESO:' + email;
  const codigoValido = Cache.get(clave);
  if (!codigoValido || codigoValido !== String(codigoCrudo || '').trim()) {
    // Auditoría Codex 2026-10-08 (hallazgo 4): tras INTENTOS_CODIGO_MAX fallos el
    // código deja de servir, aunque después se escriba bien.
    if (codigoValido) {
      const claveFallos = 'CODIGO_ACCESO_FALLOS:' + email;
      const fallos = Number(Cache.get(claveFallos) || 0) + 1;
      if (fallos >= INTENTOS_CODIGO_MAX) { Cache.remove(clave); Cache.remove(claveFallos); }
      else Cache.put(claveFallos, String(fallos), 600);
    }
    return false;
  }
  Cache.remove(clave); // un solo uso
  Cache.remove('CODIGO_ACCESO_FALLOS:' + email);
  return true;
}

// --- Opción B del hallazgo 1 (auditoría Codex 2026-10-08) ---------------------------------
// Ver o tocar una solicitud desde las páginas públicas exige PROBAR el correo:
// con la sesión de la plataforma (correos de la cuenta) o con un «pase de acceso»
// que se entrega al verificar el código enviado a ese correo. El pase vive en
// memoria del servidor PASE_HORAS horas (un reinicio pide el código otra vez).
const PASE_HORAS = 8;
// solicitudId (opcional): el pase sirve SOLO para esa solicitud. Es el que recibe
// quien acaba de crear una solicitud sin cuenta, para subir sus adjuntos: no
// prueba el correo, así que no puede abrir otras solicitudes de ese correo.
// Revisión Codex 2026-10-08 (D-002, hallazgo 1): dos tipos de pase.
//  - 'codigo': probó el correo con el código → todas las acciones de ese correo.
//  - 'creacion': lo recibe quien acaba de crear la solicitud SIN probar el correo →
//    SOLO subir los adjuntos de esa solicitud (ACCIONES_PASE_CREACION).
const ACCIONES_PASE_CREACION = ['subirArchivo'];
function crearPaseAcceso_(emailCrudo, solicitudId, tipo) {
  const pase = crypto.randomBytes(24).toString('base64url');
  const t = tipo === 'creacion' ? 'creacion' : 'codigo';
  Cache.put('PASE_ACCESO:' + pase, JSON.stringify({ e: String(emailCrudo || '').trim().toLowerCase(), s: solicitudId || '', t: t }), PASE_HORAS * 3600);
  return pase;
}
/** Correos que esta llamada PROBÓ ser suyos (sesión de la plataforma o pase), para esa acción. */
function correosVerificados_(db, data, accion) {
  const out = [];
  if (data && data.portal_token) {
    const cuenta = Sesiones.resolverCuentaPorToken(db, data.portal_token);
    if (cuenta) Portal.parsearListaPortal(cuenta.emails).forEach((e) => out.push(String(e).trim().toLowerCase()));
  }
  // El navegador manda todos los pases que tiene (uno o varios).
  const pases = data && data.pase_acceso ? (Array.isArray(data.pase_acceso) ? data.pase_acceso : [data.pase_acceso]) : [];
  pases.slice(0, 20).forEach((p) => {
    let v = null;
    try { v = JSON.parse(Cache.get('PASE_ACCESO:' + String(p)) || 'null'); } catch (e) { v = null; }
    if (!v || !v.e) return;
    if (v.s && v.s !== String((data && data.solicitud_id) || '')) return;
    if (v.t === 'creacion' && ACCIONES_PASE_CREACION.indexOf(accion) === -1) return;
    out.push(v.e);
  });
  return out;
}
/** El correo con que se pide ver o tocar la solicitud, ¿está probado? */
function correoVerificado_(db, data, accion) {
  const email = String((data && data.email) || '').trim().toLowerCase();
  return !!email && correosVerificados_(db, data, accion).indexOf(email) !== -1;
}
/** Verifica el código y entrega el pase (para la consulta por número). */
function verificarCodigoAcceso(db, data) {
  if (!data || !data.email || !data.codigo) return errorValidacion_('codigo', 'Debes indicar tu correo y el código recibido.');
  if (!validarCodigo_(data.email, data.codigo)) return { _forbidden: true, message: 'Código inválido o expirado. Solicita uno nuevo.' };
  return { pase_acceso: crearPaseAcceso_(data.email), horas: PASE_HORAS };
}

// v3.0 (Fase 3, §4): segundo paso -- valida el codigo de un solo uso (o una
// sesion de plataforma con `token`) y devuelve TODAS las solicitudes de ese
// correo/cuenta (como solicitante_email o correo_cliente, mismo criterio de
// coincidencia que estadoPublico), con un resumen y el semaforo del
// solicitante por solicitud. El detalle completo de cada una se pide aparte
// via estadoPublico (drill-down).
function misSolicitudes(db, data) {
  data = data || {};
  let emails;
  let pase = '';

  // v3.3 (plataforma): con sesion de la plataforma, la identidad es la
  // CUENTA, y una cuenta puede tener VARIOS correos -- se juntan las
  // solicitudes de todos. Reusa la misma resolucion de token que ya usa el
  // Backoffice (Sesiones.resolverCuentaPorToken), nunca una copia propia.
  if (data.token) {
    const cuenta = Sesiones.resolverCuentaPorToken(db, data.token);
    if (!cuenta) {
      return { _forbidden: true, message: 'Sesion invalida o expirada. Ingresa de nuevo.' };
    }
    emails = Portal.parsearListaPortal(cuenta.emails);
    if (emails.length === 0) {
      return errorValidacion_('emails', 'Tu cuenta no tiene correos asociados; pide al administrador que los agregue.');
    }
  } else {
    // Camino previo (correo + codigo de un solo uso): se mantiene intacto
    // como respaldo mientras dura la transicion a la plataforma.
    if (!data.email || !data.codigo) {
      return errorValidacion_('codigo', 'Debes indicar tu correo y el codigo recibido.');
    }
    if (!validarCodigo_(data.email, data.codigo)) {
      return { _forbidden: true, message: 'Código inválido o expirado. Solicita uno nuevo.' };
    }
    pase = crearPaseAcceso_(data.email);
    emails = [data.email];
  }

  const todasLasSubsolicitudes = leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES);
  const solicitudes = leerFilas_(db, 'SOLICITUDES', COLUMNAS.SOLICITUDES).filter((s) =>
    emails.some((correo) => compararEmail_(correo, s.solicitante_email) ||
      (!!s.es_cliente && compararEmail_(correo, s.correo_cliente)))
  );

  const resumen = { total: solicitudes.length, abiertas: 0, pendientes_validar: 0, en_desarrollo: 0, esperan_respuesta: 0 };

  const lista = solicitudes.map((s) => {
    const items = todasLasSubsolicitudes.filter((i) => i.solicitud_id === s.solicitud_id);
    const abierta = ESTADOS_CERRADOS.indexOf(s.estado_derivado) === -1;
    if (abierta) resumen.abiertas++;
    if (s.estado_derivado === ESTADOS.S05) resumen.en_desarrollo++;

    let diasEsperandoMax = null;
    let pendientesValidar = 0;
    items.forEach((item) => {
      if (item.estado === ESTADOS.S08) {
        pendientesValidar++;
        const cumplimiento = Cumplimiento.clasificar(item);
        if (cumplimiento.dias_esperando !== null && (diasEsperandoMax === null || cumplimiento.dias_esperando > diasEsperandoMax)) {
          diasEsperandoMax = cumplimiento.dias_esperando;
        }
      }
    });
    resumen.pendientes_validar += pendientesValidar;
    const esperanRespuesta = items.filter((item) => item.estado === ESTADOS.S06).length;
    resumen.esperan_respuesta += esperanRespuesta;
    const ordenados = items.slice().sort((a, b) => Number(a.numero_item) - Number(b.numero_item));

    return {
      solicitud_id: s.solicitud_id,
      empresa_nombre: s.empresa_nombre || '',
      estado_derivado: s.estado_derivado,
      prioridad_derivada: s.prioridad_derivada,
      fecha_creacion: s.fecha_creacion,
      total_items: items.length,
      items_pendientes_validar: pendientesValidar,
      dias_esperando_max: diasEsperandoMax,
      // SIGSO v2 (módulo 3C): la lista muestra DE QUÉ trata cada solicitud y
      // cómo va cada ítem, sin abrirla. Solo datos que el solicitante ya ve
      // en su detalle (título, estado, fecha comprometida).
      titulo: ordenados.length ? ordenados[0].titulo : '',
      items_esperan_respuesta: esperanRespuesta,
      items: ordenados.map((item) => ({
        subsolicitud_id: item.subsolicitud_id,
        numero_item: item.numero_item,
        titulo: item.titulo,
        estado: item.estado,
        fecha_comprometida: fechaHoraCelda_(item.fecha_comprometida)
      })),
      // v3.3: con cuenta multi-correo, el drill-down (estadoPublico) sigue
      // validando por correo -- se indica CUAL correo de la cuenta coincide
      // con esta solicitud para que el frontend lo use en esa llamada.
      email_coincidente: emails.filter((correo) => compararEmail_(correo, s.solicitante_email) ||
        (!!s.es_cliente && compararEmail_(correo, s.correo_cliente)))[0] || ''
    };
  }).sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));

  // Opción B (auditoría Codex 2026-10-08): con el código verificado, el pase de
  // acceso para abrir y responder estas solicitudes sin volver a pedir código.
  return pase ? { resumen: resumen, solicitudes: lista, pase_acceso: pase } : { resumen: resumen, solicitudes: lista };
}

const EDITABLES_SOLICITANTE = [ESTADOS.S01, ESTADOS.S02, ESTADOS.S03, ESTADOS.S04];

/**
 * Fase 1 ("editar solicitud"): el solicitante corrige un item que llenó con
 * un error -- titulo, descripcion, contexto, resultado esperado. Solo
 * MIENTRAS el item no haya entrado a desarrollo (S01..S04). Cada edicion
 * deja una traza (comentario interno con el antes->despues), visible para
 * el staff -- no se pisa el dato en silencio. Mismo control de correo que
 * estadoPublico.
 */
function editarSubsolicitud(db, data) {
  data = data || {};
  if (!data.solicitud_id || !data.subsolicitud_id || !data.email) {
    return errorValidacion_('solicitud_id', 'Faltan datos para editar el ítem.');
  }
  const solicitud = buscarSolicitudPorId_(db, data.solicitud_id);
  if (!solicitud) return errorValidacion_('solicitud_id', 'No existe una solicitud con ese numero.');

  const coincide = compararEmail_(data.email, solicitud.solicitante_email) ||
    (!!solicitud.es_cliente && compararEmail_(data.email, solicitud.correo_cliente));
  if (!coincide) {
    return { _forbidden: true, message: 'El correo no coincide con el registrado para esta solicitud.' };
  }

  const sub = buscarSubsolicitud_(db, data.subsolicitud_id);
  if (!sub || sub.solicitud_id !== data.solicitud_id) {
    return errorValidacion_('subsolicitud_id', 'No se encontró el ítem en esta solicitud.');
  }
  if (EDITABLES_SOLICITANTE.indexOf(sub.estado) === -1) {
    return errorValidacion_('estado',
      'Este ítem ya está en desarrollo o cerrado, no se puede editar. Escríbele al equipo si necesitas un cambio.');
  }

  const titulo = String(data.titulo || '').trim();
  const descripcion = String(data.descripcion || '').trim();
  if (titulo.length < 3) return errorValidacion_('titulo', 'El título es muy corto.');
  if (descripcion.length < 5) return errorValidacion_('descripcion', 'Cuéntanos un poco más en la descripción.');
  const contexto = String(data.contexto || '').trim();
  const resultado = String(data.resultado_esperado || '').trim();

  // Traza legible del antes->despues (solo de lo que efectivamente cambio).
  const cambios = [];
  if (titulo !== String(sub.titulo || '')) cambios.push('Título: "' + String(sub.titulo || '') + '" → "' + titulo + '"');
  if (descripcion !== String(sub.descripcion || '')) cambios.push('Descripción actualizada');
  if (contexto !== String(sub.contexto || '')) cambios.push('Contexto actualizado');
  if (resultado !== String(sub.resultado_esperado || '')) cambios.push('Resultado esperado actualizado');

  if (!cambios.length) return { ok: true, cambios: 0 };

  actualizarFilaPorId_(db, 'SUBSOLICITUDES', 'subsolicitud_id', data.subsolicitud_id, {
    titulo: titulo, descripcion: descripcion, contexto: contexto, resultado_esperado: resultado
  });

  agregarFila_(db, 'COMENTARIOS', {
    comentario_id: crypto.randomUUID(), solicitud_id: data.solicitud_id, subsolicitud_id: data.subsolicitud_id,
    usuario: data.email, texto: 'El solicitante corrigió el ítem. ' + cambios.join('. ') + '.',
    es_interno: true, timestamp: new Date().toISOString()
  });

  return { ok: true, cambios: cambios.length };
}

/**
 * Fase 1 ("editar solicitud", cierre): quitar un adjunto que se subio por
 * error. Mismas reglas que editarSubsolicitud (correo del solicitante +
 * item todavia editable). Borra la fila de ARCHIVOS -- que es lo que hace
 * que desaparezca de la app.
 *
 * Desde el apagado de Apps Script (2026-09-27) los adjuntos nuevos viven en
 * R2 (archivosSolicitud.js) y su objeto se borra tambien, como "mejor
 * esfuerzo" -- igual que la papelera de Drive en el .gs, nunca bloquea. Los
 * adjuntos antiguos siguen en Drive: para esos, borrar la fila es lo que hace
 * que dejen de aparecer en la app.
 */
function eliminarArchivo(db, data) {
  data = data || {};
  if (!data.solicitud_id || !data.archivo_id || !data.email) {
    return errorValidacion_('archivo_id', 'Faltan datos para quitar el adjunto.');
  }
  const solicitud = buscarSolicitudPorId_(db, data.solicitud_id);
  if (!solicitud) return errorValidacion_('solicitud_id', 'No existe una solicitud con ese numero.');

  const coincide = compararEmail_(data.email, solicitud.solicitante_email) ||
    (!!solicitud.es_cliente && compararEmail_(data.email, solicitud.correo_cliente));
  if (!coincide) {
    return { _forbidden: true, message: 'El correo no coincide con el registrado para esta solicitud.' };
  }

  const archivo = leerFilas_(db, 'ARCHIVOS', COLUMNAS.ARCHIVOS)
    .find((a) => a.archivo_id === data.archivo_id && a.solicitud_id === data.solicitud_id);
  if (!archivo) return errorValidacion_('archivo_id', 'No se encontró ese adjunto en esta solicitud.');

  // El adjunto se puede quitar mientras SU item siga siendo editable.
  if (archivo.subsolicitud_id) {
    const sub = buscarSubsolicitud_(db, archivo.subsolicitud_id);
    if (sub && EDITABLES_SOLICITANTE.indexOf(sub.estado) === -1) {
      return errorValidacion_('estado', 'Ese ítem ya está en desarrollo o cerrado, no se pueden quitar sus adjuntos.');
    }
  }

  eliminarFilasPorId_(db, 'ARCHIVOS', 'archivo_id', data.archivo_id);
  // Mejor esfuerzo, como la papelera de Drive en el .gs: si el objeto de R2
  // no se puede borrar, el adjunto igual deja de existir para la app (y su
  // enlace deja de servir, porque la llave vivía en la fila borrada).
  ArchivosSolicitud.eliminarDelAlmacen(archivo).catch(() => {});

  agregarFila_(db, 'COMENTARIOS', {
    comentario_id: crypto.randomUUID(), solicitud_id: data.solicitud_id, subsolicitud_id: archivo.subsolicitud_id || '',
    usuario: data.email, texto: 'El solicitante quitó el adjunto "' + String(archivo.nombre_original || '') + '".',
    es_interno: true, timestamp: new Date().toISOString()
  });

  return { ok: true, archivo_id: data.archivo_id };
}

// Fase 2.1: a quien avisar cuando el solicitante responde. Si la respuesta
// es sobre un item puntual, va solo a su responsable; si es general (sin
// subsolicitud_id), va a todos los responsables DISTINTOS de la solicitud.
function resolverDestinatariosRespuesta_(db, solicitud, subsolicitudId) {
  if (subsolicitudId) {
    const item = buscarSubsolicitud_(db, subsolicitudId);
    const responsable = (item && item.desarrollador_asignado) || solicitud.desarrollador_asignado;
    return responsable ? [responsable] : [];
  }
  const hermanas = leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES).filter((s) => s.solicitud_id === solicitud.solicitud_id);
  const vistos = {};
  const distintos = [];
  hermanas.forEach((s) => {
    if (s.desarrollador_asignado && !vistos[s.desarrollador_asignado]) {
      vistos[s.desarrollador_asignado] = true;
      distintos.push(s.desarrollador_asignado);
    }
  });
  if (distintos.length === 0 && solicitud.desarrollador_asignado) {
    distintos.push(solicitud.desarrollador_asignado);
  }
  return distintos;
}

/**
 * Respuesta del solicitante a un pedido de informacion (Fase 10.1): se
 * agrega como comentario publico (es_interno=false), visible para el staff
 * en getDetalle (COMENTARIOS). Etapa 3 (2026-10-05): "En curso ⇄ Esperando
 * respuesta" -- al responder, el ítem vuelve solo a En curso (S06 → S05); el
 * equipo ya no tiene que moverlo a mano para saber que le contestaron.
 */
async function responderConsulta(db, data) {
  return mensajeDelSolicitante_(db, data, true);
}

/**
 * Etapa 3: el solicitante escribe en la conversación de su solicitud cuando
 * quiera (no solo para responder una pregunta). Si algún ítem esperaba su
 * respuesta, vuelve a En curso. Avisa al equipo (campana).
 */
async function enviarMensajeSolicitud(db, data) {
  return mensajeDelSolicitante_(db, data, false);
}

async function mensajeDelSolicitante_(db, data, esRespuesta) {
  data = data || {};
  if (!data.solicitud_id || !data.email || !data.texto || String(data.texto).trim() === '') {
    return errorValidacion_('texto', 'Debes indicar la solicitud, tu correo y un mensaje.');
  }
  if (String(data.texto).length > 4000) return errorValidacion_('texto', 'El mensaje es demasiado largo (máximo 4.000 caracteres).');

  const solicitud = buscarSolicitudPorId_(db, data.solicitud_id);
  if (!solicitud) return errorValidacion_('solicitud_id', 'No existe una solicitud con ese numero.');

  const coincide = compararEmail_(data.email, solicitud.solicitante_email) ||
    (!!solicitud.es_cliente && compararEmail_(data.email, solicitud.correo_cliente));
  if (!coincide) {
    return { _forbidden: true, message: 'El correo no coincide con el registrado para esta solicitud.' };
  }

  const items = leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES).filter((s) => s.solicitud_id === data.solicitud_id);
  if (!esRespuesta && items.length && items.every((s) => ESTADOS_CERRADOS.indexOf(s.estado) !== -1)) {
    return errorValidacion_('solicitud_id', 'Esta solicitud ya está cerrada. Si necesitas algo más, crea una nueva.');
  }

  agregarFila_(db, 'COMENTARIOS', {
    comentario_id: crypto.randomUUID(), solicitud_id: data.solicitud_id, subsolicitud_id: data.subsolicitud_id || '',
    usuario: data.email, texto: data.texto, es_interno: false, timestamp: new Date().toISOString()
  });

  // Lo que esperaba su respuesta vuelve a En curso (el ítem puntual, o todos
  // los que esperaban si el mensaje es general).
  const esperando = items.filter((s) => s.estado === ESTADOS.S06 && (!data.subsolicitud_id || s.subsolicitud_id === data.subsolicitud_id));
  esperando.forEach((s) => {
    SolicitudesBO.actualizarEstado(db, { subsolicitud_id: s.subsolicitud_id, estado_nuevo: ESTADOS.S05, comentario: 'Respondió el solicitante.' },
      { email: String(data.email).trim().toLowerCase(), rol: 'SISTEMA' }, { sistemaAutomatico: true });
  });

  // P5: cierra el ciclo "pedir informacion / responder" -- avisa al
  // responsable real del item (no siempre al buzon por defecto). Sin
  // responsable (pedido de un departamento aún sin tomar), a su equipo.
  let destinatarios = resolverDestinatariosRespuesta_(db, solicitud, data.subsolicitud_id);
  if (!destinatarios.length) {
    const deptos = Array.from(new Set(items.map((s) => s.depto).filter(Boolean)));
    destinatarios = [].concat.apply([], deptos.map((d) => Servicios.equipoDepto_(db, d).map((m) => m.email)));
  }
  try { Notificaciones.avisarMensajeAlEquipo(db, solicitud, data.texto, destinatarios); } catch (err) { /* el aviso nunca frena el mensaje */ }
  if (esRespuesta || esperando.length) {
    await Notificaciones.notificarRespuestaSolicitante(db, solicitud, data.subsolicitud_id || '', data.texto, destinatarios);
  }

  return { ok: true, retomados: esperando.map((s) => s.subsolicitud_id) };
}

/**
 * Validacion/cierre por el solicitante (RN-201, RF-206/207): revierte el
 * cierre libre del gestor -- "Cerrada" (S09) solo la fija el solicitante
 * desde Consultar Estado (o el cierre automatico por inactividad, no
 * portado todavia), nunca el gestor directamente (salvo consulta tecnica).
 *
 * accion = 'confirmar' (queda Cerrada) | 'reabrir' (vuelve a En desarrollo,
 * con comentario obligatorio) | 'cerrar_directo' (una solicitud que SI
 * existe, en cualquier estado abierto, resuelta por telefono -- mismo
 * registro que una atencion directa al ingreso).
 */
async function validarCierre(db, data) {
  data = data || {};
  if (!data.solicitud_id || !data.subsolicitud_id || !data.email || !data.accion) {
    return errorValidacion_('accion', 'Debes indicar la solicitud, el item, tu correo y la accion.');
  }
  const ACCIONES = ['confirmar', 'reabrir', 'cerrar_directo'];
  if (ACCIONES.indexOf(data.accion) === -1) {
    return errorValidacion_('accion', 'Accion invalida: ' + data.accion);
  }

  const solicitud = buscarSolicitudPorId_(db, data.solicitud_id);
  if (!solicitud) return errorValidacion_('solicitud_id', 'No existe una solicitud con ese numero.');

  const coincide = compararEmail_(data.email, solicitud.solicitante_email) ||
    (!!solicitud.es_cliente && compararEmail_(data.email, solicitud.correo_cliente));
  if (!coincide) {
    return { _forbidden: true, message: 'El correo no coincide con el registrado para esta solicitud.' };
  }

  const subsolicitud = buscarSubsolicitud_(db, data.subsolicitud_id);
  if (!subsolicitud || subsolicitud.solicitud_id !== data.solicitud_id) {
    return errorValidacion_('subsolicitud_id', 'Item no encontrado en esta solicitud.');
  }

  const esCierreDirecto = data.accion === 'cerrar_directo';
  // confirmar/reabrir siguen exigiendo S08 (son la validacion de una
  // entrega). cerrar_directo aplica a cualquier item ABIERTO: el punto es
  // justamente no tener que recorrer el flujo.
  if (esCierreDirecto) {
    if (ESTADOS_CERRADOS.indexOf(subsolicitud.estado) !== -1) {
      return errorValidacion_('subsolicitud_id', 'Este item ya esta cerrado.');
    }
  } else if (subsolicitud.estado !== ESTADOS.S08) {
    return errorValidacion_('subsolicitud_id', 'Este item no esta pendiente de validacion (debe estar Terminada).');
  }
  if (data.accion === 'reabrir' && (!data.comentario || String(data.comentario).trim() === '')) {
    return errorValidacion_('comentario', 'Cuentanos que falta antes de reabrir el item.');
  }

  let atencionCierre = null;
  if (esCierreDirecto) {
    atencionCierre = normalizarAtencionDirecta_(data.atencion_directa || true);
    const errorCierre = validarAtencionDirecta_(atencionCierre);
    if (errorCierre) return errorCierre;
  }

  const estadoAnterior = subsolicitud.estado;
  const estadoNuevo = data.accion === 'reabrir' ? ESTADOS.S05 : ESTADOS.S09;
  let comentario;
  if (esCierreDirecto) {
    comentario = 'Atencion directa: resuelto por ' + atencionCierre.resuelto_por +
      ' el ' + String(atencionCierre.fecha_resolucion).replace('T', ' ') + '. ' + atencionCierre.detalle;
  } else if (data.accion === 'confirmar') {
    comentario = 'Cierre confirmado por el solicitante.';
  } else {
    comentario = 'Reabierto por el solicitante: ' + data.comentario;
  }
  const timestamp = new Date().toISOString();

  const cambiosItem = { estado: estadoNuevo };
  if (esCierreDirecto) {
    cambiosItem.atencion_resuelto_por = atencionCierre.resuelto_por;
    cambiosItem.atencion_fecha_resolucion = atencionCierre.fecha_resolucion;
    cambiosItem.atencion_detalle = atencionCierre.detalle;
  }
  actualizarFilaPorId_(db, 'SUBSOLICITUDES', 'subsolicitud_id', data.subsolicitud_id, cambiosItem);
  agregarFila_(db, 'HISTORIAL_ESTADOS', {
    historial_id: crypto.randomUUID(), solicitud_id: data.solicitud_id, subsolicitud_id: data.subsolicitud_id,
    estado_anterior: estadoAnterior, estado_nuevo: estadoNuevo, usuario: data.email, comentario: comentario, timestamp: timestamp
  });

  // v3.1: un cierre directo NO marca la solicitud como atencion_directa --
  // esa marca excluye de los KPIs a lo que nace y muere en el mismo
  // instante; esta solicitud vivio un tiempo real y medible en el sistema,
  // aunque el desenlace haya sido por telefono. Reusa el mismo recalculo
  // que ya usa el Backoffice (nunca duplicado).
  const estadoDerivado = SolicitudesBO.recalcularEstadoDerivado_(db, data.solicitud_id);

  await Notificaciones.notificarValidacionSolicitante(
    db, solicitud, subsolicitud, data.accion,
    subsolicitud.desarrollador_asignado || solicitud.desarrollador_asignado
  );

  return {
    subsolicitud_id: data.subsolicitud_id, solicitud_id: data.solicitud_id,
    estado_anterior: estadoAnterior, estado_nuevo: estadoNuevo, estado_derivado_padre: estadoDerivado
  };
}

module.exports = {
  estadoPublico, solicitarCodigoAcceso, misSolicitudes, verificarCodigoAcceso, correoVerificado_, correosVerificados_, crearPaseAcceso_,
  editarSubsolicitud, eliminarArchivo, responderConsulta, enviarMensajeSolicitud, validarCierre
};
