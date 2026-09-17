'use strict';

/**
 * schema.js — equivalente Node del Instalador de Apps Script (backend/setup):
 * declara las tablas y las crea si faltan, sin tocar las que ya existen.
 *
 * Mismos nombres de columna que COLUMNAS en backend/backoffice/Constantes.gs
 * -- se van agregando aqui a medida que se porta cada modulo de logica,
 * empezando por Catalogos.
 */

const { asegurarTabla_ } = require('./sqliteRepo');

const COLUMNAS = {
  CAT_EMPRESAS: ['empresa_id', 'nombre', 'logo', 'activo'],
  CAT_PLATAFORMAS: ['plataforma_id', 'nombre', 'empresa_id', 'url_base', 'activo'],
  CAT_MODULOS: ['modulo_id', 'nombre', 'plataforma_id', 'modulo_padre_id', 'activo'],
  CAT_TIPOS: ['tipo_id', 'nombre', 'prioridad_default', 'activo', 'es_urgente'],
  CAT_AREAS: ['area_id', 'nombre', 'responsable_email', 'activo'],
  CONFIG_NOTIFICACIONES: ['notif_id', 'evento', 'rol_destinatario', 'emails_extra', 'activo'],
  // v3.3 (§2.4): cuentas e identidad de la plataforma (Portal.gs/
  // CuentasPortal.gs). hash_password nunca guarda la clave en claro --
  // ver backend/logica/passwordHash.js sobre el cambio de algoritmo.
  CUENTAS_PORTAL: [
    'cuenta_id', 'usuario', 'nombre', 'cargo',
    'hash_password', 'salt', 'emails', 'rol', 'modulos',
    'empresa_id', 'activo', 'debe_cambiar_password',
    'ultimo_acceso', 'creado_por'
  ],
  SESIONES_PORTAL: ['token', 'cuenta_id', 'expira', 'creada'],

  // Nucleo del helpdesk (backend/intake/Solicitudes.gs: crearSolicitud).
  SOLICITUDES: [
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
    'cc', 'rut_cliente', 'codigo_cliente', 'atencion_directa', 'proyecto_id'
  ],
  SUBSOLICITUDES: [
    'subsolicitud_id', 'solicitud_id', 'numero_item', 'titulo', 'descripcion',
    'contexto', 'resultado_esperado',
    'impacto', 'prioridad', 'estado',
    'url_modulo', 'usuario_prueba', 'ref_credencial', 'centro_costos',
    'url_video', 'observaciones',
    'sla_objetivo_horas', 'estimacion_horas', 'horas_reales', 'fecha_creacion',
    'desarrollador_asignado', 'urls_adicionales',
    'tipo', 'tipo_nombre', 'modulo', 'modulo_nombre',
    'frecuencia', 'personas_afectadas', 'imagen_descripciones',
    'fecha_propuesta', 'fecha_comprometida', 'fecha_terminada', 'comprometida_por',
    'area', 'area_nombre',
    'atencion_resuelto_por', 'atencion_fecha_resolucion', 'atencion_detalle'
  ],
  HISTORIAL_ESTADOS: [
    'historial_id', 'solicitud_id', 'subsolicitud_id',
    'estado_anterior', 'estado_nuevo', 'usuario', 'comentario', 'timestamp'
  ],
  COUNTERS: ['empresa_id', 'anio', 'ultimo_numero'],
  CONFIG_SLA: ['prioridad', 'sla_horas'],
  LOG_NOTIFICACIONES: [
    'log_id', 'timestamp', 'solicitud_id', 'canal',
    'destinatario', 'evento', 'resultado', 'reintentos', 'asunto', 'cuerpo'
  ],
  // P7: dedup diario de alertas de patron (Dashboard.calcularAlertasPatron_)
  // -- distinta de LOG_NOTIFICACIONES porque el aviso no es "una solicitud",
  // es una marca operativa (contexto/ref), mismo criterio que el .gs.
  LOG_SISTEMA: ['log_id', 'timestamp', 'contexto', 'mensaje', 'ref'],
  // Backoffice de Solicitudes (actualizarPrioridad/comprometerFecha/derivarSolicitud).
  HISTORIAL_PRIORIDAD: [
    'historial_id', 'subsolicitud_id', 'solicitud_id',
    'prioridad_anterior', 'prioridad_nueva', 'justificacion', 'usuario', 'timestamp'
  ],
  HISTORIAL_COMPROMISO: [
    'historial_id', 'subsolicitud_id', 'solicitud_id',
    'fecha_anterior', 'fecha_nueva', 'motivo', 'usuario', 'timestamp'
  ],
  HISTORIAL_ASIGNACION: [
    'historial_id', 'subsolicitud_id', 'solicitud_id',
    'responsable_anterior', 'responsable_nuevo', 'motivo', 'usuario', 'timestamp'
  ],
  CONFIG_FERIADOS: ['fecha', 'nombre', 'anio'],
  ARCHIVOS: [
    'archivo_id', 'solicitud_id', 'subsolicitud_id',
    'nombre_original', 'url', 'tipo_mime', 'tamano_bytes', 'fecha_subida'
  ],
  USUARIOS: [
    'usuario_id', 'nombre', 'email', 'empresa_id', 'rol',
    'activo', 'ultimo_acceso', 'creado_por'
  ],
  JEFATURAS: ['jefatura_id', 'jefe_email', 'subordinado_email', 'activo'],
  COMENTARIOS: ['comentario_id', 'solicitud_id', 'subsolicitud_id', 'usuario', 'texto', 'es_interno', 'timestamp'],

  // Modulo Novedades (v6.5-v6.9). Mismas columnas que en
  // backend/backoffice/Constantes.gs. El area de una novedad es ETIQUETA, no
  // audiencia (ver Novedades.gs); la audiencia real vive en audiencia_tipo +
  // NOVEDADES_AUDIENCIA. El adjunto (archivo_id/nombre/mime) queda para
  // cuando exista almacenamiento de archivos (R2) -- por ahora no se acepta.
  NOVEDADES: [
    'novedad_id', 'tipo', 'titulo', 'resumen', 'cuerpo',
    'area_id', 'area_nombre', 'autor_email', 'autor_nombre',
    'requiere_acuse', 'fecha_vigencia',
    'archivo_id', 'archivo_nombre', 'archivo_mime',
    'estado', 'fecha_creacion', 'aprobador_email', 'aprobador_nombre',
    'fecha_aprobacion', 'motivo_devolucion',
    'audiencia_tipo', 'fecha_limite_acuse', 'fecha_publicacion', 'activa'
  ],
  NOVEDADES_LECTURAS: ['lectura_id', 'novedad_id', 'usuario_email', 'leido_en'],
  NOVEDADES_HISTORIAL: ['historial_id', 'novedad_id', 'evento', 'autor_email', 'autor_nombre', 'comentario', 'timestamp'],
  NOVEDADES_AUDIENCIA: ['audiencia_id', 'novedad_id', 'destinatario_email'],

  // Notificaciones "vivas" (v7.1): espejo en pantalla de lo que ya se manda
  // por correo. Solo el lado de ENCOLADO se porta con Novedades (para no
  // romper su publicacion); el lado de lectura/marcar-leida es su propio
  // modulo, pendiente.
  NOTIFICACIONES_APP: [
    'notif_id', 'destinatario_email', 'tipo', 'titulo', 'mensaje',
    'modulo_id', 'texto_accion', 'leida', 'creada_en', 'expira_en'
  ],

  // Modulo Pausas activas (v6.0). Mismas columnas que en
  // backend/backoffice/Constantes.gs.
  PAUSAS_CONFIG: [
    'empresa_id', 'hora_habitual', 'dias_semana', 'duracion_min',
    'min_anticipacion', 'umbral_verde', 'umbral_amarillo', 'activo'
  ],
  PAUSAS_COORDINADORES: ['coord_id', 'empresa_id', 'nombre', 'email', 'tipo', 'activo'],
  PAUSAS_TRABAJADORES: [
    'trabajador_id', 'empresa_id', 'nombre', 'email', 'area', 'cargo',
    'activo', 'fecha_ingreso'
  ],
  PAUSAS_PROGRAMADAS: [
    'pausa_id', 'empresa_id', 'fecha', 'hora_programada', 'hora_inicio_real',
    'hora_fin', 'coordinador_email', 'estado', 'duracion_min', 'observaciones',
    'ultima_llamada_enviada', 'aviso_coordinador_enviado', 'evidencia_url',
    'escalada_admin_enviada'
  ],
  PAUSAS_ASISTENCIA: [
    'registro_id', 'pausa_id', 'trabajador_id', 'email', 'fecha_hora_registro',
    'estado', 'motivo', 'comentario', 'confirmacion', 'origen', 'animo'
  ],
  PAUSAS_LOG: ['log_id', 'timestamp', 'pausa_id', 'usuario', 'accion', 'detalle'],

  // Modulo Actividades / Gestion Operacional (v7.0). Mismas columnas que en
  // backend/backoffice/Constantes.gs. Las columnas de proyecto (proyecto_id/
  // hito_id/depende_de/tarea_padre_id) y de SGC (sgc_origen_*) son aditivas:
  // una actividad suelta de "Mi trabajo" las deja vacias y se comporta igual.
  ACTIVIDADES: [
    'actividad_id', 'titulo', 'descripcion', 'origen', 'solicitud_id',
    'responsable_email', 'responsable_nombre', 'supervisor_email',
    'area_id', 'cliente_id', 'proyecto', 'prioridad', 'estado', 'tamano',
    'fecha_propuesta', 'fecha_compromiso', 'confirmada_en', 'requiere_validacion',
    'recurrencia', 'recurrencia_origen_id', 'fecha_inicio_plan', 'fecha_terminada',
    'confianza', 'avance_pct', 'bloqueo_motivo', 'bloqueo_responsable_email',
    'bloqueo_desde', 'ultima_actualizacion', 'reprogramaciones',
    'fecha_creacion', 'creado_por', 'activa',
    'proyecto_id', 'hito_id', 'depende_de',
    'sgc_origen_tipo', 'sgc_origen_id',
    'meta_cantidad', 'meta_unidad', 'colaboradores_emails', 'tarea_padre_id'
  ],
  ACTIVIDADES_BITACORA: [
    'bitacora_id', 'actividad_id', 'tipo', 'autor_email', 'autor_nombre',
    'nota', 'avance_pct', 'confianza', 'datos', 'timestamp'
  ],

  // Modulo Proyectos (v9.0+). Mismas columnas que en backend/backoffice/
  // Constantes.gs. Las TAREAS de un proyecto no son una entidad nueva -- son
  // ACTIVIDADES (ver proyecto_id/hito_id/depende_de/tarea_padre_id ahi
  // arriba); estas tablas son la capa contenedora + sala de trabajo encima.
  PROYECTOS: [
    'proyecto_id', 'codigo', 'nombre', 'descripcion', 'objetivo',
    'resultado_esperado', 'lider_email', 'area_id', 'cliente_id',
    'categoria', 'prioridad', 'estado',
    'fecha_inicio', 'fecha_objetivo', 'fecha_cierre_real',
    'salud_override', 'salud_override_motivo',
    'ultima_actualizacion', 'creado_por', 'fecha_creacion', 'activa',
    'solicitud_origen_id'
  ],
  // rol_proyecto: LIDER | INTEGRANTE | COLABORADOR | OBSERVADOR -- la
  // membresia es el gate FINO del modulo (mismo patron que JEFATURAS).
  PROYECTO_INTEGRANTES: [
    'integrante_id', 'proyecto_id', 'usuario_email', 'usuario_nombre',
    'rol_proyecto', 'responsabilidad', 'activo', 'agregado_por', 'fecha_creacion',
    'ultima_visita_sala'
  ],
  PROYECTO_HITOS: [
    'hito_id', 'proyecto_id', 'nombre', 'descripcion', 'fecha_objetivo',
    'estado', 'orden', 'fecha_creacion'
  ],
  // La sala: feed append-only tipado (ACTUALIZACION/COMENTARIO/DECISION/
  // REUNION/BLOQUEO/SOLICITUD_LIDER/CAMBIO_ESTADO).
  PROYECTO_EVENTOS: [
    'evento_id', 'proyecto_id', 'tipo', 'autor_email', 'autor_nombre',
    'titulo', 'cuerpo', 'ref_tipo', 'ref_id', 'menciones', 'timestamp'
  ],
  PROYECTO_ENTREGABLES: [
    'entregable_id', 'proyecto_id', 'hito_id', 'nombre', 'descripcion',
    'responsable_email', 'fecha_comprometida', 'estado', 'url_evidencia',
    'fecha_entrega_real', 'revisado_por', 'resultado_revision',
    'observaciones', 'fecha_creacion'
  ],
  // nivel se DERIVA de probabilidad x impacto (calcularNivelRiesgo_), nunca
  // se pide a mano.
  PROYECTO_RIESGOS: [
    'riesgo_id', 'proyecto_id', 'descripcion', 'probabilidad', 'impacto',
    'nivel', 'responsable_email', 'mitigacion', 'estado', 'fecha_creacion'
  ],
  PROYECTO_PLANTILLAS: [
    'plantilla_id', 'nombre', 'descripcion', 'creado_por', 'fecha_creacion', 'activa'
  ],
  PROYECTO_PLANTILLA_HITOS: [
    'plantilla_hito_id', 'plantilla_id', 'nombre', 'descripcion', 'orden'
  ],
  // v13 Fase 4 (centro documental) -- pendiente de portar (bloqueado por R2,
  // igual criterio que subirArchivo de Solicitudes/adjuntos de Novedades).
  // Se declara la tabla ahora (no destructivo agregarla despues tampoco)
  // para que el esquema quede completo de una vez.
  PROYECTO_DOCUMENTOS: [
    'documento_id', 'proyecto_id', 'nombre', 'categoria', 'descripcion',
    'ref_tipo', 'ref_id',
    'version_vigente', 'archivo_id', 'archivo_nombre', 'archivo_mime', 'tamano_bytes',
    'creado_por', 'fecha_creacion', 'activo'
  ],
  PROYECTO_DOC_VERSIONES: [
    'version_id', 'documento_id', 'version', 'comentario',
    'archivo_id', 'archivo_nombre', 'archivo_mime', 'tamano_bytes',
    'subido_por', 'fecha', 'vigente'
  ],
  PROYECTO_REUNIONES: [
    'reunion_id', 'proyecto_id', 'titulo', 'fecha', 'participantes',
    'objetivo', 'minuta', 'creado_por', 'fecha_creacion'
  ],
  PROYECTO_REUNION_ACUERDOS: [
    'acuerdo_id', 'reunion_id', 'texto', 'ref_tipo', 'ref_id', 'orden'
  ],
  PROYECTO_DECISIONES: [
    'decision_id', 'proyecto_id', 'descripcion', 'contexto', 'impacto',
    'responsable_email', 'fecha_decision', 'creado_por', 'fecha_creacion', 'activo'
  ],

  // Modulo SGC ISO 9001 (v10.0+). El monstruo de la migracion: ~123 acciones
  // sobre 32 hojas, portado por fases (mismo orden que Calidad.gs/Code.gs).
  // Incremento 1 (Fase 1 + Fase 1b): repositorio documental controlado +
  // roles/accesos del SGC. Mismas columnas que backend/backoffice/Constantes.gs.
  SGC_DOCUMENTOS: [
    'documento_id', 'codigo', 'nombre', 'descripcion', 'tipo', 'area_id',
    'version_vigente', 'estado', 'visibilidad',
    'fecha_vigencia', 'proxima_revision',
    'elaborado_por', 'revisado_por', 'aprobado_por',
    'archivo_id', 'archivo_nombre', 'archivo_mime',
    'creado_por', 'fecha_creacion', 'activa',
    'requiere_acuse', 'fecha_limite_acuse',
    'clausulas_iso', 'emisor', 'clase_externa', 'enlaces'
  ],
  SGC_DOC_VERSIONES: [
    'version_id', 'documento_id', 'version', 'cambios',
    'archivo_id', 'archivo_nombre', 'archivo_mime',
    'subido_por', 'fecha', 'vigente'
  ],
  SGC_DOC_DESTINATARIOS: ['destinatario_id', 'documento_id', 'usuario_email'],
  // rol_sgc: ENCARGADO_SGC | DIRECCION | GERENCIA_ADM | JEFATURA_AREA |
  // ENC_ADMIN | OPERATIVO | AUDITOR_EXTERNO. Gate FINO del modulo, vive
  // DENTRO del SGC -- nunca toca los roles globales de SIGSO.
  SGC_ROLES: [
    'rol_id', 'usuario_email', 'rol_sgc', 'area_id',
    'vigencia_hasta', 'activo', 'fecha_creacion'
  ],
  SGC_DOC_ACUSES: ['acuse_id', 'documento_id', 'version', 'usuario_email', 'acusado_en'],

  // SGC Fase 2a/2b (PRO-02): la ficha del trabajador. NO se toca USUARIOS
  // (autenticacion, la usa todo SIGSO) -- vive en su propia hoja, enlazada
  // por correo, mismo criterio que SGC_ROLES.
  SGC_PERSONAS: [
    'persona_id', 'usuario_email', 'nombre', 'rut', 'cargo', 'tipo',
    'area_id', 'jefatura_email', 'subrogante_email',
    'fecha_ingreso', 'estado', 'fecha_desvinculacion',
    'creado_por', 'fecha_creacion', 'activa'
  ],
  // Descriptor de cargo (FO-PRO-02-01), versionado -- cada actualizacion
  // crea una fila nueva y la anterior queda vigente=false.
  SGC_DESCRIPTORES: [
    'descriptor_id', 'persona_id', 'version', 'objetivo', 'funciones',
    'responsabilidades', 'habilidades',
    'items_responsabilidades', 'items_habilidades',
    'nivel_educacional', 'formacion_tecnica', 'experiencia',
    'archivo_id', 'archivo_nombre', 'archivo_mime',
    'vigente', 'creado_por', 'fecha'
  ],
  // Carpeta digital de la persona (CV, titulo, contrato, certificados...).
  SGC_PERSONA_DOCUMENTOS: [
    'doc_id', 'persona_id', 'tipo', 'nombre',
    'archivo_id', 'archivo_nombre', 'archivo_mime',
    'subido_por', 'fecha', 'activa'
  ],
  // Registro de induccion (FO-PRO-02-02): los 5 items del SGC, una fila por
  // item y persona.
  SGC_INDUCCIONES: [
    'induccion_id', 'persona_id', 'item', 'fecha', 'relator_email',
    'estado', 'observaciones'
  ],
  // Monitoreo de competencias (FO-PRO-02-04, Fase 2b).
  SGC_EVALUACIONES: [
    'evaluacion_id', 'persona_id', 'descriptor_id', 'fecha', 'evaluador_email',
    'respuestas_responsabilidades', 'respuestas_habilidades',
    'promedio_responsabilidades', 'promedio_habilidades',
    'requiere_capacitacion', 'observaciones', 'recomendado_por',
    'proxima_evaluacion'
  ],
  // Programa anual (FO-PRO-02-03) + registro de lo realizado (FO-PRO-02-05)
  // en UNA sola hoja: nace PROGRAMADA y pasa a REALIZADA.
  SGC_CAPACITACIONES: [
    'capacitacion_id', 'nombre', 'descripcion', 'horas',
    'fecha_programada', 'fecha_realizada', 'relator', 'estado',
    'creado_por', 'fecha_creacion', 'activa'
  ],
  SGC_CAPACITACION_ASISTENTES: [
    'asistencia_id', 'capacitacion_id', 'persona_id', 'asistio', 'fecha',
    'eficacia_fecha', 'eficacia_resultado', 'eficacia_observaciones'
  ]
};

function asegurarEsquema(db) {
  Object.keys(COLUMNAS).forEach((hoja) => asegurarTabla_(db, hoja, COLUMNAS[hoja]));
}

module.exports = { COLUMNAS, asegurarEsquema };
