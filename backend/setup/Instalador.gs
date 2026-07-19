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
    'cc',
    // Trazabilidad del cliente elegido del buscador (CAT_CLIENTES). Ver la
    // nota identica en backend/intake/Constantes.gs.
    'rut_cliente', 'codigo_cliente',
    // v3.1 (§1.5): marca de "atencion directa" -- la solicitud se registro
    // DESPUES de resolverse (llamada telefonica al desarrollador), no
    // recorrio el flujo. Se necesita como marca separada, y no solo como
    // estado S09, porque estas solicitudes se crean y cierran en el mismo
    // instante: contarlas en el tiempo promedio de resolucion o en el
    // semaforo de cumplimiento distorsionaria los KPIs de Gerencia.
    'atencion_directa'
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
    'imagen_descripciones',
    // v2.1 (Fase A): ver la nota identica en backend/intake/Constantes.gs.
    'fecha_propuesta', 'fecha_comprometida', 'fecha_terminada', 'comprometida_por',
    // v3.0 (Fase 1): ver la nota identica en backend/intake/Constantes.gs.
    'area', 'area_nombre',
    // v3.1 (§1.4): el registro de una atencion directa. Obligatorios
    // cuando atencion_directa es TRUE -- sin ellos el registro no sirve,
    // que es justamente el punto ("no es necesario todo el flujo, pero si
    // importante que quede registro"). atencion_fecha_resolucion puede ser
    // ANTERIOR a fecha_creacion: se resolvio antes de registrarse.
    'atencion_resuelto_por', 'atencion_fecha_resolucion', 'atencion_detalle'
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
  // Ver la nota identica en backend/intake/Constantes.gs (v2.0, Sprint 2,
  // P2): es_urgente agregado al final.
  CAT_TIPOS: ['tipo_id', 'nombre', 'prioridad_default', 'activo', 'es_urgente'],
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
  ],
  // v2.1 (Fase A): ver la nota identica en backend/intake/Constantes.gs.
  HISTORIAL_COMPROMISO: [
    'historial_id', 'subsolicitud_id', 'solicitud_id',
    'fecha_anterior', 'fecha_nueva', 'motivo', 'usuario', 'timestamp'
  ],
  // v3.0 (Fase 1): ver la nota identica en backend/intake/Constantes.gs.
  // Se crea vacia (dato propio de la organizacion, como el resto de CAT_*
  // salvo CAT_TIPOS): el Admin carga las areas desde Administracion. Si
  // esta vacia, crearSolicitud rutea al responsable por defecto (Leo),
  // preservando el comportamiento previo a v3.0.
  CAT_AREAS: ['area_id', 'nombre', 'responsable_email', 'activo'],
  // Cartera de clientes GDE/HomePymes (comparten la misma). Se crea vacia:
  // el Admin pega la lista consolidada de las bases de Contabilidad/RRHH. Si
  // esta vacia, el formulario cae al modo manual de datos de cliente. Ver la
  // nota identica en backend/intake/Constantes.gs.
  CAT_CLIENTES: [
    'cliente_id', 'razon_social', 'rut', 'codigo_cliente', 'contacto',
    'correo', 'telefono', 'representante_legal', 'direccion',
    'estado', 'bloqueo', 'activo'
  ],
  // v3.1 (§2.3): ver la nota identica en backend/intake/Constantes.gs. Se
  // crea vacia; la llena el Backoffice cada vez que alguien deriva.
  HISTORIAL_ASIGNACION: [
    'historial_id', 'subsolicitud_id', 'solicitud_id',
    'responsable_anterior', 'responsable_nuevo', 'motivo',
    'usuario', 'timestamp'
  ],
  // v3.3 (§2.4): cuentas de la plataforma. hash_password NUNCA guarda la
  // contrasena en claro (SHA-256 iterado con sal, ver Portal.gs). modulos
  // es la lista efectiva (JSON) -- el rol es solo la plantilla al crear.
  CUENTAS_PORTAL: [
    'cuenta_id', 'usuario', 'nombre', 'cargo',
    'hash_password', 'salt', 'emails', 'rol', 'modulos',
    'empresa_id', 'activo', 'debe_cambiar_password',
    'ultimo_acceso', 'creado_por'
  ],
  // v3.3 (§2.4): sesiones activas del portal (token que el navegador
  // presenta en cada llamada). Expiran a las 12 horas.
  SESIONES_PORTAL: ['token', 'cuenta_id', 'expira', 'creada']
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
// es_urgente (v2.0, Sprint 2, P2) SI afecta la prioridad real (ver
// derivarPrioridad_, backend/intake/Solicitudes.gs): marca por defecto
// Error/Bug y Migracion como urgentes por naturaleza (paran operacion o
// tocan datos en produccion); el resto queda ajustable desde
// Administracion > Catalogos > Tipos, segun el criterio real de cada
// equipo (la reunion menciono categorias propias como "hoja de ruta" o
// "firma digital" que no mapean 1 a 1 a estos 7 tipos genericos).
var TIPOS_INICIALES = [
  ['ERR', 'Error / Bug', 'P2', true, true],
  ['MOD', 'Modificacion', 'P3', true, false],
  ['MEJ', 'Mejora', 'P3', true, false],
  ['DES', 'Desarrollo', 'P4', true, false],
  ['NMO', 'Nuevo Modulo', 'P5', true, false],
  ['MIG', 'Migracion', 'P2', true, true],
  ['CON', 'Consulta Tecnica', 'P4', true, false]
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
  sembrarConfigNotificacionesSiVacia_(ss);

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

// P12 (v2.0, Sprint 3): CONFIG_NOTIFICACIONES existia desde Fase 1 pero
// "hoy infrautilizada" -- se siembra un unico registro que sirve de switch
// global: "avisar automaticamente al equipo de desarrollo (Leo) cuando entra
// una solicitud de cliente o P1". Activo=true reproduce el comportamiento
// actual (no rompe nada); Gerencia/Admin lo puede desactivar desde
// Administracion > Notificaciones sin tocar codigo (resuelve C2: "Felipe
// dijo que no le enviara ni un correo todavia" vs. el aviso hardcodeado).
var CONFIG_NOTIFICACIONES_INICIAL = [
  ['AVISO_LEO', 'AVISO_DESARROLLO', '', '', true]
];

function sembrarConfigNotificacionesSiVacia_(ss) {
  var hoja = ss.getSheetByName('CONFIG_NOTIFICACIONES');
  if (hoja && hoja.getLastRow() < 2) {
    CONFIG_NOTIFICACIONES_INICIAL.forEach(function (fila) {
      hoja.appendRow(fila);
    });
  }
}
