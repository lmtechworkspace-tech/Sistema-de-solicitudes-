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
 * NO se porta el "mejor esfuerzo" de mandar el archivo a la papelera de
 * Drive: ese paso depende de DriveApp, y este stack todavia no tiene un
 * backend de archivos real (R2 en Cloudflare sigue pendiente, ver
 * sigso-ecosistema-nuevo.md). Cuando exista, este es el lugar donde
 * agregarlo -- hoy borrar la fila es el comportamiento honesto: es
 * exactamente lo unico que hace que el adjunto deje de aparecer en la app,
 * que era el efecto que importaba incluso en el .gs (el borrado en Drive
 * era "mejor esfuerzo", nunca bloqueaba la operacion).
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
 * en getDetalle (COMENTARIOS). No cambia el estado -- es el equipo quien
 * decide, al leer la respuesta, mover el item de "esperando informacion" al
 * siguiente paso.
 */
async function responderConsulta(db, data) {
  data = data || {};
  if (!data.solicitud_id || !data.email || !data.texto || String(data.texto).trim() === '') {
    return errorValidacion_('texto', 'Debes indicar la solicitud, tu correo y una respuesta.');
  }

  const solicitud = buscarSolicitudPorId_(db, data.solicitud_id);
  if (!solicitud) return errorValidacion_('solicitud_id', 'No existe una solicitud con ese numero.');

  const coincide = compararEmail_(data.email, solicitud.solicitante_email) ||
    (!!solicitud.es_cliente && compararEmail_(data.email, solicitud.correo_cliente));
  if (!coincide) {
    return { _forbidden: true, message: 'El correo no coincide con el registrado para esta solicitud.' };
  }

  agregarFila_(db, 'COMENTARIOS', {
    comentario_id: crypto.randomUUID(), solicitud_id: data.solicitud_id, subsolicitud_id: data.subsolicitud_id || '',
    usuario: data.email, texto: data.texto, es_interno: false, timestamp: new Date().toISOString()
  });

  // P5: cierra el ciclo "pedir informacion / responder" -- avisa al
  // responsable real del item (no siempre al buzon por defecto).
  await Notificaciones.notificarRespuestaSolicitante(
    db, solicitud, data.subsolicitud_id || '', data.texto,
    resolverDestinatariosRespuesta_(db, solicitud, data.subsolicitud_id)
  );

  return { ok: true };
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
  estadoPublico, solicitarCodigoAcceso, misSolicitudes,
  editarSubsolicitud, eliminarArchivo, responderConsulta, validarCierre
};
