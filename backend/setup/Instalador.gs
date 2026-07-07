/**
 * Instalador.gs — crea (si no existen) todas las hojas de SIGSO con sus
 * headers, y siembra CONFIG_SLA con las horas por prioridad de §7.2.
 * Idempotente: correrlo de nuevo no duplica hojas ni pisa datos existentes.
 *
 * Se ejecuta UNA VEZ, apuntando (via Script Properties, SIGSO_SHEET_ID) a la
 * planilla ya creada por el Admin (checklist §17.2 de la especificacion).
 *
 * ESQUEMA_HOJAS duplica a proposito el esquema de columnas de
 * backend/intake/Constantes.gs (son proyectos Apps Script separados, ver
 * nota de duplicacion en Config.gs). database/schema.md es la fuente de
 * verdad legible por humanos; backend/test/schema-consistency.test.js
 * falla si esta copia y la de Constantes.gs divergen.
 */

var ESQUEMA_HOJAS = {
  // Ver la nota identica en backend/intake/Constantes.gs sobre la
  // reconciliacion con SIGSO v1.0 (documentacion/fases/RECONCILIACION-v1.0.md).
  SOLICITUDES: [
    // Ver la nota identica en backend/intake/Constantes.gs sobre la
    // desnormalizacion de nombres (§13.2 v1.0 / §6 v1.1).
    'solicitud_id', 'empresa_id', 'empresa_nombre', 'plataforma', 'plataforma_nombre',
    'modulo', 'modulo_nombre', 'tipo', 'tipo_nombre',
    'solicitante_nombre', 'solicitante_cargo', 'solicitante_email',
    'es_cliente', 'empresa_cliente', 'cliente_mandante', 'cliente_obra',
    'contacto_cliente', 'correo_cliente', 'telefono_cliente', 'urgencia_cliente',
    'estado_derivado', 'prioridad_derivada', 'orden_atencion',
    'analista_asignado', 'desarrollador_asignado',
    'doc_estado', 'doc_reintentos', 'url_doc', 'url_pdf',
    'version_documento', 'url_pdf_historial',
    'dedup_hash', 'estimacion_total_horas', 'horas_reales',
    'observaciones_generales',
    'resumen_whatsapp', 'fecha_creacion', 'creado_por',
    // Fase 9 (hallazgo de datos reales, RLD "Hoja de ruta"): correo
    // adicional a copiar en las notificaciones de esta solicitud, ademas
    // de solicitante_email.
    'cc'
  ],
  SUBSOLICITUDES: [
    'subsolicitud_id', 'solicitud_id', 'numero_item', 'titulo', 'descripcion',
    'contexto', 'resultado_esperado',
    'impacto', 'prioridad', 'estado',
    'url_modulo', 'usuario_prueba', 'ref_credencial', 'centro_costos',
    'url_video', 'observaciones',
    'sla_objetivo_horas', 'estimacion_horas', 'horas_reales', 'fecha_creacion',
    'desarrollador_asignado',
    // Fase 9: URLs adicionales (modal de validacion, doc generado, etc.)
    // como JSON string (array de {titulo, url}); url_modulo sigue siendo
    // la principal.
    'urls_adicionales',
    // Fase 10 (rediseno UX): tipo/modulo pasan a pedirse por item, no una
    // sola vez por solicitud (ver nota identica en backend/intake/Constantes.gs).
    'tipo', 'tipo_nombre', 'modulo', 'modulo_nombre',
    'frecuencia', 'personas_afectadas',
    'imagen_descripciones'
  ],
  HISTORIAL_ESTADOS: [
    'historial_id', 'solicitud_id', 'subsolicitud_id',
    'estado_anterior', 'estado_nuevo', 'usuario', 'comentario', 'timestamp'
  ],
  COMENTARIOS: [
    'comentario_id', 'solicitud_id', 'subsolicitud_id',
    'usuario', 'texto', 'es_interno', 'timestamp'
  ],
  USUARIOS: [
    'usuario_id', 'nombre', 'email', 'empresa_id', 'rol',
    'activo', 'ultimo_acceso', 'creado_por'
  ],
  COUNTERS: ['empresa_id', 'anio', 'ultimo_numero'],
  CONFIG_FERIADOS: ['fecha', 'nombre', 'anio'],
  CONFIG_SLA: ['prioridad', 'sla_horas'],
  CONFIG_NOTIFICACIONES: ['notif_id', 'evento', 'rol_destinatario', 'emails_extra', 'activo'],
  // Ver la nota identica en backend/intake/Constantes.gs (RF-006/RF-007 v1.0).
  CAT_EMPRESAS: ['empresa_id', 'nombre', 'logo', 'activo'],
  CAT_PLATAFORMAS: ['plataforma_id', 'nombre', 'empresa_id', 'url_base', 'activo'],
  // Ver la nota identica en backend/intake/Constantes.gs sobre
  // modulo_padre_id (jerarquia de hasta 4 niveles, post-Fase 8).
  CAT_MODULOS: ['modulo_id', 'nombre', 'plataforma_id', 'modulo_padre_id', 'activo'],
  CAT_TIPOS: ['tipo_id', 'nombre', 'prioridad_default', 'activo'],
  LOG_SISTEMA: ['log_id', 'timestamp', 'contexto', 'mensaje', 'ref'],
  LOG_NOTIFICACIONES: [
    'log_id', 'timestamp', 'solicitud_id', 'canal',
    'destinatario', 'evento', 'resultado', 'reintentos',
    // Fase 10.2: ver la nota identica en backend/intake/Constantes.gs.
    'asunto', 'cuerpo'
  ],
  // Agregada en Fase 2 (RN-007): ver la nota identica en
  // backend/intake/Constantes.gs.
  HISTORIAL_PRIORIDAD: [
    'historial_id', 'subsolicitud_id', 'solicitud_id',
    'prioridad_anterior', 'prioridad_nueva', 'justificacion',
    'usuario', 'timestamp'
  ],
  // Agregada en Fase 4 (§5.3, C-06): ver la nota identica en
  // backend/intake/Constantes.gs.
  ARCHIVOS: [
    'archivo_id', 'solicitud_id', 'subsolicitud_id',
    'nombre_original', 'url', 'tipo_mime', 'tamano_bytes', 'fecha_subida'
  ]
};

// SLA por prioridad en horas habiles (§7.2). P5 no tiene SLA.
var SLA_INICIAL = [
  ['P1', 2],
  ['P2', 24],
  ['P3', 72],
  ['P4', 120],
  ['P5', '']
];

// Los 7 tipos de solicitud son un catalogo fijo de la especificacion
// (RF-009, doc 3 de v1.0), a diferencia de empresas/plataformas/modulos
// que son datos propios de la organizacion y se cargan a mano (§17.2). Por
// eso se siembran aqui. prioridad_default es solo informativa: la
// prioridad real se deriva por impacto (RN-006, Fase 2), no por tipo.
var TIPOS_INICIALES = [
  ['ERR', 'Error / Bug', 'P2', true],
  ['MOD', 'Modificacion', 'P3', true],
  ['MEJ', 'Mejora', 'P3', true],
  ['DES', 'Desarrollo', 'P4', true],
  ['NMO', 'Nuevo Modulo', 'P5', true],
  ['MIG', 'Migracion', 'P2', true],
  ['CON', 'Consulta Tecnica', 'P4', true]
];

function instalarHojas() {
  var ss = SpreadsheetApp.openById(getConfig_().sheetId);
  var creadas = [];

  Object.keys(ESQUEMA_HOJAS).forEach(function (nombre) {
    var hoja = ss.getSheetByName(nombre);
    if (!hoja) {
      hoja = ss.insertSheet(nombre);
      hoja.appendRow(ESQUEMA_HOJAS[nombre]);
      creadas.push(nombre);
    }
  });

  sembrarConfigSlaSiVacia_(ss);
  sembrarTiposSiVacia_(ss);

  Logger.log('Hojas creadas en esta corrida: ' + creadas.join(', '));
  return creadas;
}

function sembrarConfigSlaSiVacia_(ss) {
  var hoja = ss.getSheetByName('CONFIG_SLA');
  if (hoja && hoja.getLastRow() < 2) {
    SLA_INICIAL.forEach(function (fila) {
      hoja.appendRow(fila);
    });
  }
}

function sembrarTiposSiVacia_(ss) {
  var hoja = ss.getSheetByName('CAT_TIPOS');
  if (hoja && hoja.getLastRow() < 2) {
    TIPOS_INICIALES.forEach(function (fila) {
      hoja.appendRow(fila);
    });
  }
}
