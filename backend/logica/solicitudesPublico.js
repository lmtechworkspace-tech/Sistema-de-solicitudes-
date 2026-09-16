'use strict';

/**
 * solicitudesPublico.js — puerto de la parte de backend/intake/Solicitudes.gs
 * que consulta el sistema SIN cuenta de staff: estadoPublico (accion
 * "consultarEstado") y "Mis solicitudes" (solicitarCodigoAcceso + misSolicitudes).
 *
 * Alcance de este turno, documentado, no fingido: el resto de las acciones
 * publicas del mismo .gs (editarSubsolicitud, eliminarArchivo,
 * responderConsulta, validarCierre) comparten los mismos helpers
 * (compararEmail_, buscarSolicitudPorId_) pero quedan para un proximo turno.
 *
 * demasiadosIntentosEstado_/solicitarCodigoAcceso usaban CacheService en el
 * .gs (efimero, sin hoja nueva) -- aqui el equivalente es cacheEfimero.js
 * (Map en memoria del proceso), mismo criterio ya usado por sesiones.js para
 * el freno de fuerza bruta del login.
 */

const { leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { ESTADOS, ESTADOS_CERRADOS, ORDEN_PRIORIDAD } = require('./constantesSolicitudes');
const { buscarSolicitudPorId_, fechaHoraCelda_ } = require('./solicitudesBackoffice');
const Cumplimiento = require('./cumplimiento');
const Notificaciones = require('./notificaciones');
const Sesiones = require('./sesiones');
const Portal = require('./portal');
const Cache = require('./cacheEfimero');

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
      const esSolicitante = compararEmail_(h.usuario, email) ||
        compararEmail_(h.usuario, solicitud.solicitante_email) ||
        (!!solicitud.es_cliente && compararEmail_(h.usuario, solicitud.correo_cliente));
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

  const subsolicitudes = leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES)
    .filter((s) => s.solicitud_id === solicitudId)
    .map((s) => ({
      subsolicitud_id: s.subsolicitud_id,
      numero_item: s.numero_item,
      titulo: s.titulo,
      estado: s.estado,
      prioridad: s.prioridad,
      tipo_nombre: s.tipo_nombre || '',
      modulo_nombre: s.modulo_nombre || '',
      area_nombre: s.area_nombre || '',
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
    historial: historialPublico_(db, solicitudId, solicitud, email)
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
  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  Cache.put('CODIGO_ACCESO:' + email, codigo, 600);
  await Notificaciones.enviarCodigoAcceso(db, data.email, codigo);
  return { ok: true };
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
    const email = String(data.email).trim().toLowerCase();
    const clave = 'CODIGO_ACCESO:' + email;
    const codigoValido = Cache.get(clave);
    if (!codigoValido || codigoValido !== String(data.codigo).trim()) {
      return { _forbidden: true, message: 'Código inválido o expirado. Solicita uno nuevo.' };
    }
    Cache.remove(clave); // un solo uso
    emails = [data.email];
  }

  const todasLasSubsolicitudes = leerFilas_(db, 'SUBSOLICITUDES', COLUMNAS.SUBSOLICITUDES);
  const solicitudes = leerFilas_(db, 'SOLICITUDES', COLUMNAS.SOLICITUDES).filter((s) =>
    emails.some((correo) => compararEmail_(correo, s.solicitante_email) ||
      (!!s.es_cliente && compararEmail_(correo, s.correo_cliente)))
  );

  const resumen = { total: solicitudes.length, abiertas: 0, pendientes_validar: 0, en_desarrollo: 0 };

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

    return {
      solicitud_id: s.solicitud_id,
      empresa_nombre: s.empresa_nombre || '',
      estado_derivado: s.estado_derivado,
      prioridad_derivada: s.prioridad_derivada,
      fecha_creacion: s.fecha_creacion,
      total_items: items.length,
      items_pendientes_validar: pendientesValidar,
      dias_esperando_max: diasEsperandoMax,
      // v3.3: con cuenta multi-correo, el drill-down (estadoPublico) sigue
      // validando por correo -- se indica CUAL correo de la cuenta coincide
      // con esta solicitud para que el frontend lo use en esa llamada.
      email_coincidente: emails.filter((correo) => compararEmail_(correo, s.solicitante_email) ||
        (!!s.es_cliente && compararEmail_(correo, s.correo_cliente)))[0] || ''
    };
  }).sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));

  return { resumen: resumen, solicitudes: lista };
}

module.exports = { estadoPublico, solicitarCodigoAcceso, misSolicitudes };
