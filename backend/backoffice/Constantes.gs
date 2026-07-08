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
  ARCHIVOS: 'ARCHIVOS',
  // v2.1 (Fase A, documentacion/SIGSO-v2.1-plazos-y-control.md §5):
  // "resbalones" de fecha comprometida (linea base para el Panel de
  // Gerencia, Fase C). Mismo patron que HISTORIAL_PRIORIDAD (RN-007).
  HISTORIAL_COMPROMISO: 'HISTORIAL_COMPROMISO'
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
    'resumen_whatsapp', 'fecha_creacion', 'creado_por',
    // Fase 9 (hallazgo de datos reales, RLD "Hoja de ruta"): correo
    // adicional a copiar en las notificaciones de esta solicitud, ademas
    // de solicitante_email. Agregado al final para no romper el orden de
    // columnas ya desplegado (backend/test/schema-consistency.test.js).
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
    // Fase 9: el ejemplo real (RLD "Hoja de ruta") trae hasta 4 URLs por
    // solicitud (modulo, modal de validacion, modal de informacion,
    // documento generado) -- url_modulo sigue siendo la principal, esta
    // guarda las demas como JSON string (array de {titulo, url}), mismo
    // patron que url_pdf_historial.
    'urls_adicionales',
    // Fase 10 (rediseno UX): tipo y modulo por item, ver nota identica en
    // backend/intake/Constantes.gs.
    'tipo', 'tipo_nombre', 'modulo', 'modulo_nombre',
    'frecuencia', 'personas_afectadas',
    'imagen_descripciones',
    // v2.1 (Fase A): ver la nota identica en backend/intake/Constantes.gs.
    'fecha_propuesta', 'fecha_comprometida', 'fecha_terminada', 'comprometida_por'
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
  // es_urgente (v2.0, Sprint 2, P2): aditiva al final -- ciertos tipos son
  // urgentes por naturaleza (frenan dinero/operacion), independiente del
  // impacto que declare el solicitante ("todos van a poner alta porque todo
  // es urgente" -- se necesita un corte objetivo, no auto-declarado).
  // derivarPrioridad_ (backend/intake/Solicitudes.gs) lo combina con el
  // impacto: si el tipo es urgente (o la solicitud es de cliente, ya
  // urgente por RN-005), la prioridad nunca baja de P2 aunque el impacto
  // declarado sea menor.
  CAT_TIPOS: ['tipo_id', 'nombre', 'prioridad_default', 'activo', 'es_urgente'],
  LOG_SISTEMA: ['log_id', 'timestamp', 'contexto', 'mensaje', 'ref'],
  LOG_NOTIFICACIONES: [
    'log_id', 'timestamp', 'solicitud_id', 'canal',
    'destinatario', 'evento', 'resultado', 'reintentos',
    // Fase 10.2: ver la nota identica en backend/intake/Constantes.gs.
    'asunto', 'cuerpo'
  ],
  HISTORIAL_PRIORIDAD: [
    'historial_id', 'subsolicitud_id', 'solicitud_id',
    'prioridad_anterior', 'prioridad_nueva', 'justificacion',
    'usuario', 'timestamp'
  ],
  ARCHIVOS: [
    'archivo_id', 'solicitud_id', 'subsolicitud_id',
    'nombre_original', 'url', 'tipo_mime', 'tamano_bytes', 'fecha_subida'
  ],
  // v2.1 (Fase A): ver la nota identica en backend/intake/Constantes.gs.
  HISTORIAL_COMPROMISO: [
    'historial_id', 'subsolicitud_id', 'solicitud_id',
    'fecha_anterior', 'fecha_nueva', 'motivo', 'usuario', 'timestamp'
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

// Fase 10.1 (post-produccion, feedback real de uso): el modelo original de
// "transiciones validas por estado" (un grafo de pasos permitidos, uno por
// rol) resulto demasiado rigido -- en la practica una sola persona (Leo)
// gestiona todo el ciclo de vida y necesita poder fijar CUALQUIER estado en
// cualquier momento para reflejar la realidad (ej. saltar directo de Nueva a
// Cerrada sin pasar por los intermedios), no solo "el siguiente paso logico".
//
// Se reemplaza el grafo por un modelo simple: cualquier rol de Backoffice
// puede mover una subsolicitud a cualquiera de los 11 estados (excepto al
// mismo en el que ya esta). El unico control que se conserva es pedir un
// comentario (queda en HISTORIAL_ESTADOS) para los movimientos "sensibles"
// -- ver comentarioObligatorioParaCambio_ en Solicitudes.gs -- de forma que
// quede un rastro de POR QUE se rechazo/cancelo/cerro directo/reabrio, sin
// bloquear a Leo con un flujo formal que no calza con como trabaja.
// (ESTADOS_CERRADOS, ya definido arriba, es el conjunto S09/S10/S11 que se
// usa como "cierre" tanto aqui como en el calculo de estado_derivado, §8.2.)
