/**
 * Constantes.gs — App Gestion (Backoffice).
 *
 * SHEETS/COLUMNAS/ESTADOS/prioridad son un duplicado deliberado de
 * backend/intake/Constantes.gs (proyectos Apps Script separados, ver nota
 * en Config.gs); backend/test/schema-consistency.test.js verifica que las
 * tres copias (Intake, Backoffice, Instalador) no diverjan.
 *
 * ORDEN_ESTADOS, ESTADOS_EXCLUIDOS_DERIVACION y TRANSICIONES_VALIDAS son
 * propios de esta fase (maquina de estados, §8) y no existen en Intake
 * porque Intake nunca cambia el estado de una subsolicitud.
 */

var SHEETS = {
  SOLICITUDES: 'SOLICITUDES',
  SUBSOLICITUDES: 'SUBSOLICITUDES',
  HISTORIAL_ESTADOS: 'HISTORIAL_ESTADOS',
  COMENTARIOS: 'COMENTARIOS',
  USUARIOS: 'USUARIOS',
  COUNTERS: 'COUNTERS',
  CONFIG_FERIADOS: 'CONFIG_FERIADOS',
  CONFIG_SLA: 'CONFIG_SLA',
  CONFIG_NOTIFICACIONES: 'CONFIG_NOTIFICACIONES',
  CAT_EMPRESAS: 'CAT_EMPRESAS',
  CAT_PLATAFORMAS: 'CAT_PLATAFORMAS',
  CAT_MODULOS: 'CAT_MODULOS',
  CAT_TIPOS: 'CAT_TIPOS',
  LOG_SISTEMA: 'LOG_SISTEMA',
  LOG_NOTIFICACIONES: 'LOG_NOTIFICACIONES',
  HISTORIAL_PRIORIDAD: 'HISTORIAL_PRIORIDAD',
  ARCHIVOS: 'ARCHIVOS'
};

var COLUMNAS = {
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
    'resumen_whatsapp', 'fecha_creacion', 'creado_por'
  ],
  SUBSOLICITUDES: [
    'subsolicitud_id', 'solicitud_id', 'numero_item', 'titulo', 'descripcion',
    'contexto', 'resultado_esperado',
    'impacto', 'prioridad', 'estado',
    'url_modulo', 'usuario_prueba', 'ref_credencial', 'centro_costos',
    'url_video', 'observaciones',
    'sla_objetivo_horas', 'estimacion_horas', 'horas_reales', 'fecha_creacion',
    'desarrollador_asignado'
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
  CAT_MODULOS: ['modulo_id', 'nombre', 'plataforma_id', 'activo'],
  CAT_TIPOS: ['tipo_id', 'nombre', 'prioridad_default', 'activo'],
  LOG_SISTEMA: ['log_id', 'timestamp', 'contexto', 'mensaje', 'ref'],
  LOG_NOTIFICACIONES: [
    'log_id', 'timestamp', 'solicitud_id', 'canal',
    'destinatario', 'evento', 'resultado', 'reintentos'
  ],
  HISTORIAL_PRIORIDAD: [
    'historial_id', 'subsolicitud_id', 'solicitud_id',
    'prioridad_anterior', 'prioridad_nueva', 'justificacion',
    'usuario', 'timestamp'
  ],
  ARCHIVOS: [
    'archivo_id', 'solicitud_id', 'subsolicitud_id',
    'nombre_original', 'url', 'tipo_mime', 'tamano_bytes', 'fecha_subida'
  ]
};

var ESTADOS = {
  S01: 'S01', S02: 'S02', S03: 'S03', S04: 'S04', S05: 'S05',
  S06: 'S06', S07: 'S07', S08: 'S08', S09: 'S09', S10: 'S10', S11: 'S11'
};

var ESTADOS_CERRADOS = [ESTADOS.S09, ESTADOS.S10, ESTADOS.S11];

var ORDEN_PRIORIDAD = ['P1', 'P2', 'P3', 'P4', 'P5'];

var MAPA_IMPACTO_PRIORIDAD = {
  SISTEMA_CAIDO: 'P1',
  PERDIDA_DATOS: 'P1',
  BLOQUEO_OPERATIVO: 'P1',
  DEGRADACION_IMPORTANTE: 'P2',
  PARCIAL_CON_WORKAROUND: 'P3',
  PLANIFICADO: 'P5'
};

var PRIORIDAD_POR_DEFECTO = 'P4';

// --- Especifico de la maquina de estados (§8, Fase 2) ---------------------

// Progresion "normal" de una subsolicitud, de menos a mas avanzada. S10/S11
// quedan fuera: son exclusiones terminales, no puntos de una progresion.
var ORDEN_ESTADOS = [
  ESTADOS.S01, ESTADOS.S02, ESTADOS.S03, ESTADOS.S04, ESTADOS.S05,
  ESTADOS.S06, ESTADOS.S07, ESTADOS.S08, ESTADOS.S09
];

// §8.2: las subsolicitudes en estos estados se excluyen del calculo del
// estado derivado del padre (no bloquean su avance).
var ESTADOS_EXCLUIDOS_DERIVACION = [ESTADOS.S10, ESTADOS.S11];

// Tabla de transiciones validas por subsolicitud: de-> [{a, roles, comentarioObligatorio}].
// Fuente: flujo operativo §9.1-9.4, RN-012 (excepciones de retroceso),
// RN-013 (inmutabilidad de S09/S10, reapertura solo Admin), RN-016
// (cancelacion aprobada por el Analista desde S03 en adelante).
//
// Nota de alcance (documentada en FASE-02): la cancelacion directa del
// Solicitante en S01/S02 (RN-016) y la confirmacion de cierre S08->S09 por
// el propio Solicitante (§9.3) viajan por la App Publica (magic link), no
// por este endpoint autenticado — llegan con la Fase 3/4. Aqui solo se
// modela lo que un usuario del Backoffice puede accionar.
var TRANSICIONES_VALIDAS = {
  S01: [
    { a: 'S02', roles: ['ANA'] }
  ],
  S02: [
    { a: 'S03', roles: ['ANA'] },
    // RF-F08: consulta tecnica se cierra directo, la respuesta queda como
    // comentario obligatorio en el historial.
    { a: 'S09', roles: ['ANA'], comentarioObligatorio: true }
  ],
  S03: [
    { a: 'S04', roles: ['ANA', 'ADM'] },
    { a: 'S06', roles: ['ANA', 'DEV'] },
    { a: 'S10', roles: ['ANA', 'ADM'], comentarioObligatorio: true },
    { a: 'S11', roles: ['ANA'], comentarioObligatorio: true }
  ],
  S04: [
    { a: 'S05', roles: ['DEV'] },
    { a: 'S11', roles: ['ANA'], comentarioObligatorio: true }
  ],
  S05: [
    { a: 'S06', roles: ['ANA', 'DEV'] },
    { a: 'S07', roles: ['DEV'] },
    { a: 'S11', roles: ['ANA'], comentarioObligatorio: true }
  ],
  S06: [
    { a: 'S03', roles: ['ANA', 'DEV'] },
    { a: 'S05', roles: ['ANA', 'DEV'] }
  ],
  S07: [
    { a: 'S08', roles: ['ANA'] },
    { a: 'S05', roles: ['ANA', 'DEV'], comentarioObligatorio: true },
    { a: 'S11', roles: ['ANA'], comentarioObligatorio: true }
  ],
  S08: [
    // Confirmacion normal es del Solicitante (Fase 3/4); esta via cubre el
    // fallback documentado en §9.3 ("cierre por falta de respuesta").
    { a: 'S09', roles: ['ANA'] },
    { a: 'S05', roles: ['ANA', 'ADM'], comentarioObligatorio: true },
    { a: 'S11', roles: ['ANA'], comentarioObligatorio: true }
  ],
  S09: [
    // RN-012/013: reapertura, solo Admin, con justificacion.
    { a: 'S05', roles: ['ADM'], comentarioObligatorio: true }
  ],
  S10: [
    // RN-013: solo Admin reabre. La especificacion no fija el estado
    // destino explicitamente; se asume que vuelve a revision (documentado
    // como supuesto en FASE-02-maquina-estados.md).
    { a: 'S03', roles: ['ADM'], comentarioObligatorio: true }
  ],
  S11: []
};
