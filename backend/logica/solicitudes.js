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
const Servicios = require('./serviciosSolicitud');
const DirectorioPersonas = require('./directorioPersonas');

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
      // Etapa 2: un pedido a un departamento se clasifica por su servicio, no
      // por tipo/módulo de plataforma.
      const aDepto = !!(item && item.depto);
      if (aDepto && !Servicios.departamento_(item.depto)) {
        errores.push({ campo: 'subsolicitudes[' + idx + '].depto', mensaje: 'Departamento desconocido' });
      }
      if (!aDepto && (!item || !item.tipo || String(item.tipo).trim() === '')) {
        errores.push({ campo: 'subsolicitudes[' + idx + '].tipo', mensaje: 'Tipo obligatorio (RN-002)' });
      }
      if (asociadaPlataforma && !aDepto && (!item || !item.modulo || String(item.modulo).trim() === '')) {
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
    data.empresa_id, data.plataforma, primerItem.modulo || primerItem.servicio_id || primerItem.depto || '',
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

// Para la pantalla de "Listo": a quién le llegó, por persona (nombre, cargo,
// empresa). Asignado → esa persona; cola de un departamento → todo su equipo;
// departamento sin equipo → Administración. Sin correos: solo lo que se pinta.
function destinatariosDe_(db, items) {
  const personas = [], vistos = {};
  const sumar = (p, extra) => {
    const clave = p.email || p.nombre;
    if (vistos[clave]) return;
    vistos[clave] = true;
    personas.push(Object.assign({ nombre: p.nombre, cargo: p.cargo || '', empresa: p.empresa || '' }, extra || {}));
  };
  items.forEach((s) => {
    if (s.responsable) {
      const f = DirectorioPersonas.fichas(db, [s.responsable])[s.responsable.toLowerCase()];
      if (f) sumar(f, { directo: true });
      return;
    }
    if (!s.depto) return;
    const equipo = Servicios.personasDepto_(db, s.depto);
    if (!equipo.length) sumar({ nombre: 'Administración del sistema', cargo: 'mientras ' + ((Servicios.departamento_(s.depto) || {}).nombre || s.depto) + ' no tenga equipo' });
    equipo.forEach((p) => sumar(p, { jefatura: p.rol === 'JEFATURA' }));
  });
  return personas;
}

async function crearSolicitud(db, data, opciones) {
  const errores = validarSolicitud_(data);
  // Etapa 4: un servicio puede exigir el cliente (p. ej. "Certificado F30").
  (Array.isArray(data.subsolicitudes) ? data.subsolicitudes : []).forEach((item, idx) => {
    const s = item && item.depto && item.servicio_id ? Servicios.servicioPorId_(db, item.servicio_id) : null;
    if (s && s.pide_cliente === 'si' && !String(data.empresa_cliente || '').trim()) {
      errores.push({ campo: 'subsolicitudes[' + idx + '].cliente', mensaje: 'Este pedido necesita el cliente: indícalo.' });
    }
    // 2026-10-06: se puede pedir a una persona en particular del departamento,
    // pero solo a alguien de su equipo (los que trabajan su cola).
    const destinatario = String((item && item.destinatario) || '').trim().toLowerCase();
    if (destinatario && item.depto && !Servicios.equipoDepto_(db, String(item.depto).toUpperCase()).some((m) => m.email === destinatario)) {
      errores.push({ campo: 'subsolicitudes[' + idx + '].destinatario', mensaje: 'Esa persona no está en el equipo del departamento.' });
    }
  });
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

  // Revisión Codex Tanda 1, 2.ª ronda: correlativo, ítems, solicitud, historial y lo que
  // pide quien llama (alPersistir) se guardan TODO o NADA, antes de cualquier aviso. Con
  // SAVEPOINT sirve igual si quien llama ya abrió una transacción.
  const persistir_ = () => {
    const solicitudId = Correlativo.generarId(db, data.empresa_id);
    const timestamp = new Date().toISOString();

    const subsolicitudesGuardadas = data.subsolicitudes.map((item, idx) => {
      const subId = solicitudId + '-' + ('0' + (idx + 1)).slice(-2);
      const depto = item.depto ? Servicios.departamento_(item.depto) : null;
      let prioridad, slaHoras, responsable, areaId, servicio = null;
      if (depto) {
        // Etapa 2: llega a la COLA del departamento, sin asignar -- la jefatura
        // reparte o alguien del equipo lo toma. La prioridad y el plazo los
        // fija el servicio (urgente = al menos P2 y el plazo de P2 si es menor).
        const c = Servicios.condicionesDelServicio_(db, item.servicio_id, !!item.urgente || !!data.es_cliente, (p) => obtenerSlaHoras_(db, p));
        servicio = c.servicio && c.servicio.depto === depto.clave ? c.servicio : null;
        prioridad = c.prioridad;
        slaHoras = c.sla;
        // Pedido a una persona en particular: queda a su nombre desde el inicio
        // (ya validado arriba que es del equipo). Si no, a la cola sin asignar.
        responsable = String(item.destinatario || '').trim().toLowerCase();
        areaId = '';
      } else {
        const esUrgentePorTipo = !!data.es_cliente || tipoEsUrgente_(db, item.tipo);
        prioridad = derivarPrioridad_(item.impacto, esUrgentePorTipo);
        slaHoras = obtenerSlaHoras_(db, prioridad);
        areaId = item.area || data.area || '';
        responsable = resolverResponsable_(db, areaId);
      }

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
        area_nombre: depto ? depto.nombre : resolverNombreCatalogo_(db, 'CAT_AREAS', 'area_id', areaId),
        depto: depto ? depto.clave : '', depto_nombre: depto ? depto.nombre : '',
        servicio_id: servicio ? servicio.servicio_id : '', servicio_nombre: servicio ? servicio.nombre : (depto ? 'Otro pedido' : ''),
        atencion_resuelto_por: atencion ? atencion.resuelto_por : '',
        atencion_fecha_resolucion: atencion ? atencion.fecha_resolucion : '',
        atencion_detalle: atencion ? atencion.detalle : ''
      });

      return { subsolicitud_id: subId, prioridad: prioridad, responsable: responsable, depto: depto ? depto.clave : '', titulo: item.titulo };
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
      atencion_directa: !!atencion,
      // Fase H item 3 (Camino B, 2026-09-23): opcional -- cuando la solicitud
      // nace DENTRO de un proyecto (ej. un RDI creado desde Proyectos), este
      // es el único lugar donde se guarda ese vínculo. No confundir con el
      // uso histórico de esta misma columna en proyectos.js (una solicitud
      // que se CONVIRTIÓ en proyecto): ambos casos conviven en la misma
      // columna porque nunca se consultan sin filtrar también por `tipo`.
      proyecto_id: data.proyecto_id || '',
      // D-005 revisión Tanda 1: columnas extra de quien llama (p. ej. el portal: cliente,
      // contacto e intento) en la MISMA inserción, no después de esperar avisos.
      ...((opciones && opciones.filaSolicitud) || {})
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

    // Lo que quien llama debe dejar guardado ANTES de los avisos (síncrono): si un aviso
    // falla o el proceso se corta, el pedido ya quedó completo y reconocible.
    if (opciones && typeof opciones.alPersistir === 'function') opciones.alPersistir(solicitudId);
    return { solicitudId, timestamp, subsolicitudesGuardadas, primerItem, prioridadDerivada, estimacionTotalHoras, resumenWhatsapp };
  };
  db.exec('SAVEPOINT crear_solicitud');
  let guardado;
  try { guardado = persistir_(); db.exec('RELEASE crear_solicitud'); } catch (err) { db.exec('ROLLBACK TO crear_solicitud'); db.exec('RELEASE crear_solicitud'); throw err; }
  const { solicitudId, timestamp, subsolicitudesGuardadas, primerItem, prioridadDerivada, estimacionTotalHoras, resumenWhatsapp } = guardado;

  await Notificaciones.enviarAcuseRecibo(db, {
    solicitud_id: solicitudId, solicitante_nombre: data.solicitante_nombre,
    solicitante_email: data.solicitante_email, empresa_id: data.empresa_id,
    prioridad: prioridadDerivada, total_items: data.subsolicitudes.length,
    resumen_whatsapp: resumenWhatsapp, cc: data.cc || '', atencion_directa: !!atencion
  });

  // Etapa 2: lo que va a un departamento se avisa a su equipo. 2026-10-06:
  // correo y campana a TODOS los que trabajan el área (no solo la jefatura);
  // si va a una persona en particular, a ella (y la jefatura queda al tanto).
  const porDepto = {};
  subsolicitudesGuardadas.filter((s) => s.depto).forEach((s) => { (porDepto[s.depto] = porDepto[s.depto] || []).push(s); });
  for (const clave of Object.keys(porDepto)) {
    if (atencion) continue;
    try {
      await Notificaciones.avisarPedidoDepartamento(db, {
        solicitud_id: solicitudId, solicitante_nombre: data.solicitante_nombre, prioridad: prioridadDerivada, es_cliente: !!data.es_cliente
      }, Servicios.departamento_(clave), porDepto[clave], Servicios.equipoDepto_(db, clave));
    } catch (err) { console.error('error avisando al departamento:', err); }
  }

  // v3.0: se avisa al RESPONSABLE ruteado de cada item, no a un buzon fijo.
  // Dos items del mismo responsable -> un solo aviso.
  if (avisoDesarrolloActivo_(db)) {
    const responsablesAvisados = {};
    for (const s of subsolicitudesGuardadas) {
      // Lo de un departamento ya se avisó arriba (también si va a una persona).
      if (s.depto || !s.responsable || responsablesAvisados[s.responsable]) continue;
      responsablesAvisados[s.responsable] = true;
      if (atencion) {
        await Notificaciones.avisarAtencionDirectaRegistrada(db, {
          solicitud_id: solicitudId, total_items: data.subsolicitudes.length, solicitante_nombre: data.solicitante_nombre
        }, atencion, s.responsable);
        continue;
      }
      const motivoAviso = data.es_cliente ? 'solicitud de cliente' : (prioridadDerivada === 'P1' ? 'prioridad critica P1' : 'nueva solicitud');
      await Notificaciones.enviarAvisoDesarrollo(db, {
        solicitud_id: solicitudId, prioridad: prioridadDerivada, resumen_whatsapp: resumenWhatsapp
      }, motivoAviso, s.responsable);
    }
  }

  const respuesta = {
    solicitud_id: solicitudId, resumen_whatsapp: resumenWhatsapp, estado: estadoInicial, atencion_directa: !!atencion,
    destinatarios: destinatariosDe_(db, subsolicitudesGuardadas)
  };
  if (duplicado) {
    // RF-F06: se avisa, no se bloquea la creacion.
    respuesta.posible_duplicado = { solicitud_id: duplicado.solicitud_id };
  }
  return respuesta;
}

module.exports = {
  crearSolicitud, derivarPrioridad_, generarResumenWhatsapp_,
  normalizarAtencionDirecta_, validarAtencionDirecta_
};
