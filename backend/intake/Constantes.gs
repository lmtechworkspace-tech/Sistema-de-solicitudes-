/**
 * Constantes.gs — nombres de hojas, columnas y enums (§6, §7.2, §8.1).
 *
 * Fuente de verdad legible por humanos: database/schema.md. Este archivo y
 * backend/setup/Instalador.gs se mantienen sincronizados manualmente (son
 * proyectos Apps Script separados, ver nota de duplicacion en
 * backend/intake/Config.gs); backend/test/schema-consistency.test.js falla
 * si alguno de los dos se desalinea del otro.
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
  // Campos ampliados en la reconciliacion con SIGSO v1.0 (RF-001/002, doc
  // 9 "Entidad SOLICITUD"): solicitante_cargo, datos de cliente
  // (mandante/obra/telefono/urgencia) y observaciones generales no estaban
  // en el v1.1 refinado porque ese documento solo detalla los cambios
  // respecto de v1.0, no repite el modelo completo. Ver
  // documentacion/fases/RECONCILIACION-v1.0.md.
  SOLICITUDES: [
    // empresa_nombre/plataforma_nombre/modulo_nombre/tipo_nombre son
    // desnormalizacion deliberada (§13.2 v1.0, confirmada como "decision
    // correcta" en v1.1 §6): quien abra la planilla directamente no
    // necesita cruzar con los catalogos para leer los datos.
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
  // contexto/resultado_esperado/url_modulo/usuario_prueba/centro_costos/
  // url_video/observaciones/estimacion_horas/horas_reales y numero_item
  // vienen de la Entidad SUBSOLICITUD de v1.0 (doc 9). urgencia_cliente se
  // quito de aqui: v1.0 la modela una sola vez por solicitud (RF-002), no
  // por subsolicitud (se guarda en SOLICITUDES).
  SUBSOLICITUDES: [
    'subsolicitud_id', 'solicitud_id', 'numero_item', 'titulo', 'descripcion',
    'contexto', 'resultado_esperado',
    'impacto', 'prioridad', 'estado',
    'url_modulo', 'usuario_prueba', 'ref_credencial', 'centro_costos',
    'url_video', 'observaciones',
    'sla_objetivo_horas', 'estimacion_horas', 'horas_reales', 'fecha_creacion',
    // Asignacion por item (§13.3 v1.0): las subsolicitudes pueden
    // trabajarse en paralelo por distintos desarrolladores (§7.3),
    // ademas de (no en vez de) desarrollador_asignado a nivel SOLICITUD.
    'desarrollador_asignado',
    // Fase 9: el ejemplo real (RLD "Hoja de ruta") trae hasta 4 URLs por
    // solicitud (modulo, modal de validacion, modal de informacion,
    // documento generado) -- url_modulo sigue siendo la principal, esta
    // guarda las demas como JSON string (array de {titulo, url}), mismo
    // patron que url_pdf_historial.
    'urls_adicionales',
    // Fase 10 (rediseno UX, auditoria de producto): tipo y modulo pasan de
    // ser una pregunta unica a nivel SOLICITUDES a una pregunta por item --
    // una solicitud real mezcla Error+Mejora+Nuevo modulo, cada uno en un
    // modulo distinto (confirmado con datos reales de Camila Pena/Lisseth
    // Vilchez). SOLICITUDES.tipo/modulo se mantienen (no se borran columnas)
    // pero pasan a derivarse del primer item en crearSolicitud, no de un
    // campo global del formulario.
    'tipo', 'tipo_nombre', 'modulo', 'modulo_nombre',
    // Reemplaza a "estimacion_horas" en el formulario publico (el
    // solicitante no puede estimar esfuerzo de desarrollo, pero si sabe
    // cuanto pasa y a cuantos afecta). estimacion_horas se mantiene para que
    // Leo la complete despues desde el Backoffice.
    'frecuencia', 'personas_afectadas',
    // Caption por imagen sin tocar ARCHIVOS: JSON string, array de strings
    // (indice i = descripcion de la i-esima imagen subida para este item,
    // ver nota en Solicitudes.gs -- el archivo_id no existe todavia al
    // guardar la subsolicitud).
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
  // Columnas reales de "Entidades Adicionales" (§9 v1.0): se habian
  // inventado unas distintas (tipo_evento/canal/plantilla) porque esta
  // hoja todavia no tenia logica conectada; corregido al releer v1.0
  // completo (ver RECONCILIACION-v1.0.md).
  CONFIG_NOTIFICACIONES: ['notif_id', 'evento', 'rol_destinatario', 'emails_extra', 'activo'],
  // 'logo' y 'url_base' vienen de RF-006/RF-007 (v1.0, doc 3): campos
  // reales del catalogo administrable, no cosmeticos (el logo se usa en el
  // encabezado del documento generado, §11.1/§14.2; url_base es el link
  // directo a la plataforma). Ver RECONCILIACION-v1.0.md.
  CAT_EMPRESAS: ['empresa_id', 'nombre', 'logo', 'activo'],
  CAT_PLATAFORMAS: ['plataforma_id', 'nombre', 'empresa_id', 'url_base', 'activo'],
  // modulo_padre_id (post-Fase 8): jerarquia real de hasta 4 niveles
  // (modulo principal > submodulo > item > sub-item) encontrada en el mapa de
  // procesos real de HomePymes/GDE/Intranet. Vacio si es un modulo raiz.
  // El selector "Modulo" del formulario publico arma la cascada con esto;
  // el modulo_id que se guarda en SOLICITUDES es siempre el del nivel mas
  // profundo elegido, sin importar la profundidad real del arbol.
  CAT_MODULOS: ['modulo_id', 'nombre', 'plataforma_id', 'modulo_padre_id', 'activo'],
  // 7 tipos reales de RF-009 (doc 3 de v1.0): prioridad_default es solo
  // informativa/UX (mostrar una sugerencia en el formulario); la Fase 2
  // corrigio explicitamente que la prioridad automatica se derive por
  // impacto (RN-006, §7.2 de v1.1), no por tipo -- ver
  // documentacion/fases/RECONCILIACION-v1.0.md.
  CAT_TIPOS: ['tipo_id', 'nombre', 'prioridad_default', 'activo'],
  LOG_SISTEMA: ['log_id', 'timestamp', 'contexto', 'mensaje', 'ref'],
  LOG_NOTIFICACIONES: [
    'log_id', 'timestamp', 'solicitud_id', 'canal',
    'destinatario', 'evento', 'resultado', 'reintentos',
    // Fase 10.2 (optimizacion, "el cambio de estado tarda mucho"): el correo
    // de cambio de estado se encola en vez de enviarse en el momento (asi
    // el usuario no espera el envio); procesarColaCorreo (Backoffice,
    // trigger cada 5 min) necesita el asunto/cuerpo reales guardados aqui
    // para no mandar un mensaje generico al procesar la cola.
    'asunto', 'cuerpo'
  ],
  // Agregada en Fase 2: RN-007 exige que cada cambio de prioridad quede en
  // historial, y ninguna hoja de §6 tiene esa forma (HISTORIAL_ESTADOS es
  // especificamente de estados, RN-014). Intake no la usa pero declara sus
  // columnas igual que el resto del esquema, por consistencia entre los
  // tres proyectos Apps Script (ver database/schema.md).
  HISTORIAL_PRIORIDAD: [
    'historial_id', 'subsolicitud_id', 'solicitud_id',
    'prioridad_anterior', 'prioridad_nueva', 'justificacion',
    'usuario', 'timestamp'
  ],
  // Agregada en Fase 4 (§5.3, C-06): metadata de cada archivo subido
  // por-archivo. El blob en si vive en Drive; aqui solo el puntero.
  ARCHIVOS: [
    'archivo_id', 'solicitud_id', 'subsolicitud_id',
    'nombre_original', 'url', 'tipo_mime', 'tamano_bytes', 'fecha_subida'
  ]
};

// S01-S11 completos desde la Fase 1 aunque solo S01 se use aqui: la maquina
// de estados (Fase 2, §8) los reutiliza y asi evita redefinirlos.
var ESTADOS = {
  S01: 'S01', S02: 'S02', S03: 'S03', S04: 'S04', S05: 'S05',
  S06: 'S06', S07: 'S07', S08: 'S08', S09: 'S09', S10: 'S10', S11: 'S11'
};

var ESTADOS_CERRADOS = [ESTADOS.S09, ESTADOS.S10, ESTADOS.S11];

// Duplicado de backend/backoffice/Constantes.gs (RN-201, Sprint 1 v2.0):
// Solicitudes.validarCierre necesita recalcular el estado derivado del padre
// igual que Solicitudes.gs de Backoffice.
var ORDEN_ESTADOS = [
  ESTADOS.S01, ESTADOS.S02, ESTADOS.S03, ESTADOS.S04, ESTADOS.S05,
  ESTADOS.S06, ESTADOS.S07, ESTADOS.S08, ESTADOS.S09
];
var ESTADOS_EXCLUIDOS_DERIVACION = [ESTADOS.S10, ESTADOS.S11];

var ORDEN_PRIORIDAD = ['P1', 'P2', 'P3', 'P4', 'P5'];

// Etiquetas y emojis de RF-010/RF-015 (doc 3 y 3.5 de v1.0), para el
// resumen de WhatsApp y cualquier UI que muestre la prioridad legible.
var PRIORIDAD_ETIQUETA = {
  P1: 'Critica', P2: 'Alta', P3: 'Media', P4: 'Baja', P5: 'Planificada'
};
var PRIORIDAD_EMOJI = {
  P1: '🔴', P2: '🟠', P3: '🟡', P4: '🟢', P5: '🔵'
};

// RN-006: el impacto -no el origen ni la urgencia del cliente- determina la
// prioridad automatica. La tabla se aplica igual para cualquier tipo de
// solicitud (Error, Requerimiento, Consulta): el texto de RN-006 corrige
// especificamente el caso "Error de cliente", pero la escala de impacto que
// describe no tiene motivo para variar segun el tipo.
var MAPA_IMPACTO_PRIORIDAD = {
  SISTEMA_CAIDO: 'P1',
  PERDIDA_DATOS: 'P1',
  BLOQUEO_OPERATIVO: 'P1',
  DEGRADACION_IMPORTANTE: 'P2',
  PARCIAL_CON_WORKAROUND: 'P3',
  PLANIFICADO: 'P5'
};

// Sin impacto explicito la especificacion no define un default (supuesto
// documentado en documentacion/fases/FASE-01-modelo-datos-nucleo.md).
var PRIORIDAD_POR_DEFECTO = 'P4';
