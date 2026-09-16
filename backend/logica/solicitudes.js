'use strict';

/**
 * solicitudes.js — puerto de Solicitudes.crearSolicitud (backend/intake/
 * Solicitudes.gs), orden de operaciones identico:
 *  1. Validar campos obligatorios y reglas de negocio (RN-001-005).
 *  2. Deduplicacion por hash (RF-F06).
 *  3. Derivar prioridad automatica por impacto (RN-006).
 *  4. Generar solicitud_id (correlativo.js).
 *  5. Escribir SOLICITUDES + SUBSOLICITUDES + HISTORIAL_ESTADOS.
 *  6. Encolar notificaciones (acuse + aviso al responsable).
 *  7. Generar resumen WhatsApp.
 *  8. Devolver { solicitud_id, resumen_whatsapp, estado }.
 *
 * Solo crearSolicitud por ahora -- el resto de Solicitudes.gs (estadoPublico,
 * misSolicitudes, validarCierre, editarSubsolicitud...) y todo el modulo de
 * Backoffice (actualizarEstado, derivarSolicitud, bandeja...) quedan para
 * proximos turnos de porteo, mismo criterio de alcance que Catalogos y Auth.
 */

const crypto = require('node:crypto');
const { agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const {
  ESTADOS, ESTADOS_CERRADOS, ORDEN_PRIORIDAD, PRIORIDAD_ETIQUETA, PRIORIDAD_EMOJI,
  MAPA_IMPACTO_PRIORIDAD, PRIORIDAD_POR_DEFECTO, EMAIL_DESARROLLO
} = require('./constantesSolicitudes');
const Correlativo = require('./correlativo');
const Notificaciones = require('./notificaciones');

function errorValidacion_(campo, mensaje) {
  return { _validationError: true, message: mensaje, fields: [{ campo: campo, mensaje: mensaje }] };
}

function esEmailValido_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// v2.1 (Fase A): la hora importa cuando la solicitud puede resolverse en
// horas/minutos -- cliente (siempre) o cualquier item con impacto que
// deriva P1.
function requiereFechaHoraPropuesta_(data) {
  if (data.es_cliente) return true;
  if (!Array.isArray(data.subsolicitudes)) return false;
  return data.subsolicitudes.some((item) => !!item && MAPA_IMPACTO_PRIORIDAD[item.impacto] === 'P1');
}

function validarSolicitud_(data) {
  const errores = [];
  const requerido_ = (campo, valor) => {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      errores.push({ campo: campo, mensaje: 'Campo obligatorio: ' + campo });
    }
  };

  // v3.0 (Fase 5): una solicitud puede estar asociada a una plataforma
  // (flujo de siempre) o no (pedido administrativo, ruteado solo por area).
  const asociadaPlataforma = data.asociada_plataforma !== false;

  requerido_('empresa_id', data.empresa_id);
  if (asociadaPlataforma) requerido_('plataforma', data.plataforma);

  requerido_('solicitante_nombre', data.solicitante_nombre);
  requerido_('solicitante_cargo', data.solicitante_cargo);
  requerido_('solicitante_email', data.solicitante_email);
  if (data.solicitante_email && !esEmailValido_(data.solicitante_email)) {
    errores.push({ campo: 'solicitante_email', mensaje: 'Formato de correo invalido' });
  }

  if (!Array.isArray(data.subsolicitudes) || data.subsolicitudes.length < 1) {
    errores.push({ campo: 'subsolicitudes', mensaje: 'Debe incluir al menos una subsolicitud (RN-004)' });
  } else {
    data.subsolicitudes.forEach((item, idx) => {
      if (!item || !item.titulo || String(item.titulo).trim() === '') {
        errores.push({ campo: 'subsolicitudes[' + idx + '].titulo', mensaje: 'Titulo obligatorio (RN-004)' });
      }
      if (!item || !item.descripcion || String(item.descripcion).trim() === '') {
        errores.push({ campo: 'subsolicitudes[' + idx + '].descripcion', mensaje: 'Descripcion obligatoria (RN-004)' });
      }
      if (!item || !item.tipo || String(item.tipo).trim() === '') {
        errores.push({ campo: 'subsolicitudes[' + idx + '].tipo', mensaje: 'Tipo obligatorio (RN-002)' });
      }
      if (asociadaPlataforma && (!item || !item.modulo || String(item.modulo).trim() === '')) {
        errores.push({ campo: 'subsolicitudes[' + idx + '].modulo', mensaje: 'Modulo obligatorio (RN-002)' });
      }
    });
  }

  if (data.cc && !esEmailValido_(data.cc)) {
    errores.push({ campo: 'cc', mensaje: 'Formato de correo invalido' });
  }

  if (requiereFechaHoraPropuesta_(data) && !normalizarAtencionDirecta_(data.atencion_directa)) {
    if (!data.fecha_propuesta || String(data.fecha_propuesta).trim() === '') {
      errores.push({
        campo: 'fecha_propuesta',
        mensaje: 'Indica para cuando necesitas esto resuelto (fecha y hora): es una solicitud de cliente o de impacto critico.'
      });
    } else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(data.fecha_propuesta))) {
      errores.push({ campo: 'fecha_propuesta', mensaje: 'Para esta solicitud tambien debes indicar la hora en que la necesitas.' });
    }
  } else if (data.fecha_propuesta && isNaN(new Date(data.fecha_propuesta).getTime())) {
    errores.push({ campo: 'fecha_propuesta', mensaje: 'Formato de fecha invalido' });
  }

  if (data.es_cliente) {
    requerido_('empresa_cliente', data.empresa_cliente);
    requerido_('contacto_cliente', data.contacto_cliente);
    requerido_('correo_cliente', data.correo_cliente);
    if (data.correo_cliente && !esEmailValido_(data.correo_cliente)) {
      errores.push({ campo: 'correo_cliente', mensaje: 'Formato de correo invalido (RN-005)' });
    }
  }

  return errores;
}

// v3.1: normaliza el bloque de atencion directa. null si no viene/viene
// desactivado -- asi el resto de crearSolicitud solo pregunta "hay o no".
function normalizarAtencionDirecta_(bruto) {
  if (!bruto || bruto === true) {
    return bruto === true ? { resuelto_por: '', fecha_resolucion: '', detalle: '' } : null;
  }
  if (bruto.activo === false) return null;
  return {
    resuelto_por: String(bruto.resuelto_por || '').trim(),
    fecha_resolucion: String(bruto.fecha_resolucion || '').trim(),
    detalle: String(bruto.detalle || '').trim()
  };
}

// Los tres campos son obligatorios a proposito: son el registro.
function validarAtencionDirecta_(atencion) {
  if (!atencion.resuelto_por) return errorValidacion_('atencion_resuelto_por', 'Indica quien resolvio la solicitud.');
  if (!atencion.fecha_resolucion) return errorValidacion_('atencion_fecha_resolucion', 'Indica cuando se resolvio.');
  const fecha = new Date(atencion.fecha_resolucion);
  if (isNaN(fecha.getTime())) return errorValidacion_('atencion_fecha_resolucion', 'La fecha de resolucion no es valida.');
  if (fecha.getTime() > Date.now()) return errorValidacion_('atencion_fecha_resolucion', 'La fecha de resolucion no puede ser futura.');
  if (atencion.detalle.length < 10) return errorValidacion_('atencion_detalle', 'Cuenta que se hizo (al menos 10 caracteres).');
  return null;
}

function resolverNombreCatalogo_(db, nombreHoja, idCampo, valorId) {
  let filas;
  try { filas = leerFilas_(db, nombreHoja, COLUMNAS[nombreHoja]); } catch (err) { return ''; }
  const fila = filas.find((f) => f[idCampo] === valorId);
  return (fila && fila.nombre) || '';
}

function resolverResponsable_(db, areaId) {
  if (!areaId) return EMAIL_DESARROLLO;
  let filas;
  try { filas = leerFilas_(db, 'CAT_AREAS', COLUMNAS.CAT_AREAS); } catch (err) { return EMAIL_DESARROLLO; }
  const area = filas.find((f) => f.area_id === areaId);
  if (area) {
    const activo = area.activo === true || area.activo === 'TRUE' || area.activo === 1;
    if (activo && area.responsable_email) return area.responsable_email;
  }
  return EMAIL_DESARROLLO;
}

function calcularHashDuplicado_(data) {
  const primerItem = data.subsolicitudes[0] || {};
  const base = [
    data.empresa_id, data.plataforma, primerItem.modulo || '',
    String(data.solicitante_email || '').toLowerCase(),
    String(primerItem.descripcion || '').trim().toLowerCase()
  ].join('|');
  return crypto.createHash('md5').update(base, 'utf8').digest('hex');
}

function buscarDuplicadoAbierto_(db, dedupHash) {
  return leerFilas_(db, 'SOLICITUDES', COLUMNAS.SOLICITUDES)
    .find((f) => f.dedup_hash === dedupHash && ESTADOS_CERRADOS.indexOf(f.estado_derivado) === -1) || null;
}

// RN-006 + P2: un tipo urgente por naturaleza (o solicitud de cliente) pone
// un piso de P2, sin diluir un impacto realmente critico (P1 sigue ganando).
function derivarPrioridad_(impacto, esUrgente) {
  const base = MAPA_IMPACTO_PRIORIDAD[impacto] || PRIORIDAD_POR_DEFECTO;
  if (esUrgente && ORDEN_PRIORIDAD.indexOf(base) > ORDEN_PRIORIDAD.indexOf('P2')) return 'P2';
  return base;
}

function tipoEsUrgente_(db, tipoId) {
  let filas;
  try { filas = leerFilas_(db, 'CAT_TIPOS', COLUMNAS.CAT_TIPOS); } catch (err) { return false; }
  const tipo = filas.find((f) => f.tipo_id === tipoId);
  return !!(tipo && (tipo.es_urgente === true || tipo.es_urgente === 'TRUE' || tipo.es_urgente === 1));
}

function prioridadMasCritica_(listaPrioridades) {
  return listaPrioridades.reduce(
    (masCritica, actual) => (ORDEN_PRIORIDAD.indexOf(actual) < ORDEN_PRIORIDAD.indexOf(masCritica) ? actual : masCritica),
    'P5'
  );
}

function obtenerSlaHoras_(db, prioridad) {
  const fila = leerFilas_(db, 'CONFIG_SLA', COLUMNAS.CONFIG_SLA).find((f) => f.prioridad === prioridad);
  if (!fila) return '';
  return fila.sla_horas === '' ? '' : Number(fila.sla_horas);
}

// P12: switch global CONFIG_NOTIFICACIONES.AVISO_LEO. Sin el registro
// (instalacion vieja) se asume activo=true -- retrocompatible.
function avisoDesarrolloActivo_(db) {
  let filas;
  try { filas = leerFilas_(db, 'CONFIG_NOTIFICACIONES', COLUMNAS.CONFIG_NOTIFICACIONES); } catch (err) { return true; }
  const registro = filas.find((f) => f.notif_id === 'AVISO_LEO');
  if (!registro) return true;
  return registro.activo === true || registro.activo === 'TRUE' || registro.activo === 1;
}

// Formato exacto de RF-015. Con mas de un item se indica la cantidad en vez
// de listarlos (RF-F07); el detalle completo va en el correo.
function generarResumenWhatsapp_(solicitudId, data, prioridad) {
  const primerItem = data.subsolicitudes[0] || {};
  const resumen = data.subsolicitudes.length === 1
    ? String(primerItem.descripcion || '').slice(0, 150)
    : data.subsolicitudes.length + ' items — ver detalle en correo';

  const lineas = [
    '📋 SOLICITUD N° ' + solicitudId,
    (PRIORIDAD_EMOJI[prioridad] || '') + ' PRIORIDAD: ' + (PRIORIDAD_ETIQUETA[prioridad] || prioridad),
    '🏢 Empresa: ' + data.empresa_id
  ];
  if (data.plataforma) {
    lineas.push('💻 Sistema: ' + data.plataforma);
    lineas.push('📦 Modulo: ' + (primerItem.modulo || ''));
  }
  lineas.push('👤 Solicitante: ' + data.solicitante_nombre);
  lineas.push('📝 Resumen: ' + resumen);
  lineas.push('📧 Revisar correo para detalle completo.');
  return lineas.join('\n');
}

function crearSolicitud(db, data) {
  const errores = validarSolicitud_(data);
  if (errores.length > 0) {
    return { _validationError: true, message: 'La solicitud tiene datos invalidos o incompletos.', fields: errores };
  }

  const dedupHash = calcularHashDuplicado_(data);
  const duplicado = buscarDuplicadoAbierto_(db, dedupHash);

  // v3.1: "atencion directa" -- la solicitud se resolvio por telefono ANTES
  // de existir en el sistema. Nace Cerrada (S09), sin recorrer el flujo.
  const atencion = normalizarAtencionDirecta_(data.atencion_directa);
  if (atencion) {
    const errorAtencion = validarAtencionDirecta_(atencion);
    if (errorAtencion) return errorAtencion;
  }
  const estadoInicial = atencion ? ESTADOS.S09 : ESTADOS.S01;

  const solicitudId = Correlativo.generarId(db, data.empresa_id);
  const timestamp = new Date().toISOString();

  const subsolicitudesGuardadas = data.subsolicitudes.map((item, idx) => {
    const esUrgentePorTipo = !!data.es_cliente || tipoEsUrgente_(db, item.tipo);
    const prioridad = derivarPrioridad_(item.impacto, esUrgentePorTipo);
    const slaHoras = obtenerSlaHoras_(db, prioridad);
    const subId = solicitudId + '-' + ('0' + (idx + 1)).slice(-2);
    const areaId = item.area || data.area || '';
    const responsable = resolverResponsable_(db, areaId);

    agregarFila_(db, 'SUBSOLICITUDES', {
      subsolicitud_id: subId, solicitud_id: solicitudId, numero_item: idx + 1,
      titulo: item.titulo, descripcion: item.descripcion,
      contexto: item.contexto || '', resultado_esperado: item.resultado_esperado || '',
      impacto: item.impacto || '', prioridad: prioridad, estado: estadoInicial,
      url_modulo: item.url_modulo || '', usuario_prueba: item.usuario_prueba || '',
      ref_credencial: item.ref_credencial || '', centro_costos: item.centro_costos || '',
      url_video: item.url_video || '', observaciones: item.observaciones || '',
      sla_objetivo_horas: slaHoras, estimacion_horas: item.estimacion_horas || '', horas_reales: '',
      fecha_creacion: timestamp, urls_adicionales: JSON.stringify(item.urls_adicionales || []),
      tipo: item.tipo || '', tipo_nombre: resolverNombreCatalogo_(db, 'CAT_TIPOS', 'tipo_id', item.tipo),
      modulo: item.modulo || '', modulo_nombre: resolverNombreCatalogo_(db, 'CAT_MODULOS', 'modulo_id', item.modulo),
      frecuencia: item.frecuencia || '', personas_afectadas: item.personas_afectadas || '',
      imagen_descripciones: JSON.stringify(item.imagen_descripciones || []),
      fecha_propuesta: data.fecha_propuesta || '', fecha_comprometida: '', fecha_terminada: '', comprometida_por: '',
      desarrollador_asignado: responsable, area: areaId,
      area_nombre: resolverNombreCatalogo_(db, 'CAT_AREAS', 'area_id', areaId),
      atencion_resuelto_por: atencion ? atencion.resuelto_por : '',
      atencion_fecha_resolucion: atencion ? atencion.fecha_resolucion : '',
      atencion_detalle: atencion ? atencion.detalle : ''
    });

    return { subsolicitud_id: subId, prioridad: prioridad, responsable: responsable };
  });

  const primerItem = data.subsolicitudes[0] || {};
  const prioridadDerivada = prioridadMasCritica_(subsolicitudesGuardadas.map((s) => s.prioridad));
  const estimacionTotalHoras = data.subsolicitudes.reduce((acc, item) => acc + (Number(item.estimacion_horas) || 0), 0);
  const resumenWhatsapp = generarResumenWhatsapp_(solicitudId, data, prioridadDerivada);

  agregarFila_(db, 'SOLICITUDES', {
    solicitud_id: solicitudId, empresa_id: data.empresa_id,
    empresa_nombre: resolverNombreCatalogo_(db, 'CAT_EMPRESAS', 'empresa_id', data.empresa_id),
    plataforma: data.plataforma, plataforma_nombre: resolverNombreCatalogo_(db, 'CAT_PLATAFORMAS', 'plataforma_id', data.plataforma),
    modulo: primerItem.modulo || '', modulo_nombre: resolverNombreCatalogo_(db, 'CAT_MODULOS', 'modulo_id', primerItem.modulo),
    tipo: primerItem.tipo || '', tipo_nombre: resolverNombreCatalogo_(db, 'CAT_TIPOS', 'tipo_id', primerItem.tipo),
    solicitante_nombre: data.solicitante_nombre, solicitante_cargo: data.solicitante_cargo,
    solicitante_email: data.solicitante_email, es_cliente: !!data.es_cliente,
    empresa_cliente: data.empresa_cliente || '', cliente_mandante: data.cliente_mandante || '',
    cliente_obra: data.cliente_obra || '', contacto_cliente: data.contacto_cliente || '',
    correo_cliente: data.correo_cliente || '', telefono_cliente: data.telefono_cliente || '',
    urgencia_cliente: data.urgencia_cliente || '', estado_derivado: estadoInicial,
    prioridad_derivada: prioridadDerivada, orden_atencion: '',
    doc_estado: '', doc_reintentos: 0, url_doc: '', url_pdf: '', version_documento: 0, url_pdf_historial: '',
    dedup_hash: dedupHash, estimacion_total_horas: estimacionTotalHoras, horas_reales: '',
    observaciones_generales: data.observaciones_generales || '', resumen_whatsapp: resumenWhatsapp,
    fecha_creacion: timestamp, creado_por: data.solicitante_email, cc: data.cc || '',
    rut_cliente: data.rut_cliente || '', codigo_cliente: data.codigo_cliente || '',
    atencion_directa: !!atencion
  });

  // UNA sola entrada de historial, honesta -- en atencion directa NO se
  // fabrica la cadena S01->...->S09 (nunca ocurrio).
  agregarFila_(db, 'HISTORIAL_ESTADOS', {
    historial_id: crypto.randomUUID(), solicitud_id: solicitudId, subsolicitud_id: '',
    estado_anterior: '', estado_nuevo: estadoInicial,
    usuario: atencion ? data.solicitante_email : 'sistema',
    comentario: atencion
      ? 'Atencion directa: resuelto por ' + atencion.resuelto_por + ' el ' +
        String(atencion.fecha_resolucion).replace('T', ' ') + '. ' + atencion.detalle
      : 'Solicitud creada por el formulario publico.',
    timestamp: timestamp
  });

  Notificaciones.enviarAcuseRecibo(db, {
    solicitud_id: solicitudId, solicitante_nombre: data.solicitante_nombre,
    solicitante_email: data.solicitante_email, empresa_id: data.empresa_id,
    prioridad: prioridadDerivada, total_items: data.subsolicitudes.length,
    resumen_whatsapp: resumenWhatsapp, cc: data.cc || '', atencion_directa: !!atencion
  });

  // v3.0: se avisa al RESPONSABLE ruteado de cada item, no a un buzon fijo.
  // Dos items del mismo responsable -> un solo aviso.
  if (avisoDesarrolloActivo_(db)) {
    const responsablesAvisados = {};
    subsolicitudesGuardadas.forEach((s) => {
      if (!s.responsable || responsablesAvisados[s.responsable]) return;
      responsablesAvisados[s.responsable] = true;
      if (atencion) {
        Notificaciones.avisarAtencionDirectaRegistrada(db, {
          solicitud_id: solicitudId, total_items: data.subsolicitudes.length, solicitante_nombre: data.solicitante_nombre
        }, atencion, s.responsable);
        return;
      }
      const motivoAviso = data.es_cliente ? 'solicitud de cliente' : (prioridadDerivada === 'P1' ? 'prioridad critica P1' : 'nueva solicitud');
      Notificaciones.enviarAvisoDesarrollo(db, {
        solicitud_id: solicitudId, prioridad: prioridadDerivada, resumen_whatsapp: resumenWhatsapp
      }, motivoAviso, s.responsable);
    });
  }

  const respuesta = { solicitud_id: solicitudId, resumen_whatsapp: resumenWhatsapp, estado: estadoInicial, atencion_directa: !!atencion };
  if (duplicado) {
    // RF-F06: se avisa, no se bloquea la creacion.
    respuesta.posible_duplicado = { solicitud_id: duplicado.solicitud_id };
  }
  return respuesta;
}

module.exports = { crearSolicitud, derivarPrioridad_, generarResumenWhatsapp_ };
