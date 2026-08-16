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
  SESIONES_PORTAL: ['token', 'cuenta_id', 'expira', 'creada'],
  // v4.2 (§1): ver la nota identica en backend/intake/Constantes.gs. Se
  // crea vacia; el Admin arma las relaciones jefe->subordinado desde
  // Administracion.
  JEFATURAS: ['jefatura_id', 'jefe_email', 'subordinado_email', 'activo'],
  // v6.0 (modulo Pausas Activas): esquema ADITIVO -- ver la nota identica en
  // backend/intake/Constantes.gs. Estas hojas se crean vacias; el Admin arma
  // la config, coordinadoras y el roster desde Administracion.
  PAUSAS_CONFIG: ['empresa_id', 'hora_habitual', 'dias_semana', 'duracion_min', 'min_anticipacion', 'umbral_verde', 'umbral_amarillo', 'activo'],
  PAUSAS_COORDINADORES: ['coord_id', 'empresa_id', 'nombre', 'email', 'tipo', 'activo'],
  PAUSAS_TRABAJADORES: ['trabajador_id', 'empresa_id', 'nombre', 'email', 'area', 'cargo', 'activo', 'fecha_ingreso'],
  // v7.2 (Bloque A, A8): escalada_admin_enviada -- ver la nota identica en
  // backend/backoffice/Constantes.gs.
  PAUSAS_PROGRAMADAS: ['pausa_id', 'empresa_id', 'fecha', 'hora_programada', 'hora_inicio_real', 'hora_fin', 'coordinador_email', 'estado', 'duracion_min', 'observaciones', 'ultima_llamada_enviada', 'aviso_coordinador_enviado', 'evidencia_url', 'escalada_admin_enviada'],
  // v7.2 (Bloque A): 'animo' (bienestar, 1..5) + origen 'pasada_lista' -- ver
  // la nota identica en backend/backoffice/Constantes.gs.
  PAUSAS_ASISTENCIA: ['registro_id', 'pausa_id', 'trabajador_id', 'email', 'fecha_hora_registro', 'estado', 'motivo', 'comentario', 'confirmacion', 'origen', 'animo'],
  PAUSAS_LOG: ['log_id', 'timestamp', 'pausa_id', 'usuario', 'accion', 'detalle'],
  // v6.4 (foto de perfil): hoja ADITIVA, una fila por identidad. Clave
  // compuesta identidad_tipo + identidad_clave porque hay dos poblaciones de
  // identidad que no comparten llave (USUARIOS por email, CUENTAS_PORTAL por
  // cuenta_id). foto_file_id apunta al original privado en Drive; foto_thumb
  // es la miniatura base64 que renderiza la interfaz.
  PERFILES: [
    'perfil_id', 'identidad_tipo', 'identidad_clave',
    'foto_file_id', 'foto_thumb', 'foto_mime', 'actualizado_en'
  ],
  // v6.5 (modulo Novedades). Ver la nota identica en
  // backend/backoffice/Constantes.gs.
  NOVEDADES: [
    'novedad_id', 'tipo', 'titulo', 'resumen', 'cuerpo',
    'area_id', 'area_nombre', 'autor_email', 'autor_nombre',
    'requiere_acuse', 'fecha_vigencia',
    'archivo_id', 'archivo_nombre', 'archivo_mime',
    'estado', 'fecha_creacion', 'aprobador_email', 'aprobador_nombre',
    'fecha_aprobacion', 'motivo_devolucion',
    'audiencia_tipo', 'fecha_limite_acuse',
    'fecha_publicacion', 'activa'
  ],
  NOVEDADES_LECTURAS: ['lectura_id', 'novedad_id', 'usuario_email', 'leido_en'],
  NOVEDADES_HISTORIAL: ['historial_id', 'novedad_id', 'evento', 'autor_email', 'autor_nombre', 'comentario', 'timestamp'],
  NOVEDADES_AUDIENCIA: ['audiencia_id', 'novedad_id', 'destinatario_email'],
  // v7.0 (Fase 1, documentacion/SIGSO-v7.0-propuesta-modulo-gestion-
  // operacional.md §4.2). Esquema ADITIVO, hojas creadas vacias. Ver la
  // nota identica en backend/backoffice/Constantes.gs sobre cada campo.
  ACTIVIDADES: [
    'actividad_id', 'titulo', 'descripcion', 'origen', 'solicitud_id',
    'responsable_email', 'responsable_nombre', 'supervisor_email',
    'area_id', 'cliente_id', 'proyecto', 'prioridad', 'estado', 'tamano',
    'fecha_propuesta', 'fecha_compromiso', 'confirmada_en', 'requiere_validacion',
    'recurrencia', 'recurrencia_origen_id', 'fecha_inicio_plan', 'fecha_terminada',
    'confianza', 'avance_pct', 'bloqueo_motivo', 'bloqueo_responsable_email',
    'bloqueo_desde', 'ultima_actualizacion', 'reprogramaciones',
    'fecha_creacion', 'creado_por', 'activa',
    // v9.0 (Modulo de Proyectos): ver la nota identica en
    // backend/backoffice/Constantes.gs.
    'proyecto_id', 'hito_id',
    // v9.4: ver la nota identica en backend/backoffice/Constantes.gs.
    'depende_de',
    // v10.0 Fase 3a: ver la nota identica en backend/backoffice/Constantes.gs.
    'sgc_origen_tipo', 'sgc_origen_id'
  ],
  ACTIVIDADES_BITACORA: [
    'bitacora_id', 'actividad_id', 'tipo', 'autor_email', 'autor_nombre',
    'nota', 'avance_pct', 'confianza', 'datos', 'timestamp'
  ],
  // v7.1 (notificaciones vivas, documentacion/SIGSO-v7.1-notificaciones-
  // vivas.md): ver la nota identica en backend/backoffice/Constantes.gs.
  NOTIFICACIONES_APP: [
    'notif_id', 'destinatario_email', 'tipo', 'titulo', 'mensaje',
    'modulo_id', 'texto_accion', 'leida', 'creada_en', 'expira_en'
  ],
  // v7.3 (notificaciones vivas, Nivel 0): ver la nota identica en
  // backend/backoffice/Constantes.gs.
  NOTIF_PERMISOS_SO: ['email', 'permiso', 'actualizado_en'],
  // v9.0 (documentacion/SIGSO-v9.0-propuesta-modulo-gestion-proyectos.md):
  // ver la nota identica en backend/backoffice/Constantes.gs sobre cada
  // hoja y cada campo.
  PROYECTOS: [
    'proyecto_id', 'codigo', 'nombre', 'descripcion', 'objetivo',
    'resultado_esperado', 'lider_email', 'area_id', 'cliente_id',
    'categoria', 'prioridad', 'estado',
    'fecha_inicio', 'fecha_objetivo', 'fecha_cierre_real',
    'salud_override', 'salud_override_motivo',
    'ultima_actualizacion', 'creado_por', 'fecha_creacion', 'activa'
  ],
  PROYECTO_INTEGRANTES: [
    'integrante_id', 'proyecto_id', 'usuario_email', 'usuario_nombre',
    'rol_proyecto', 'responsabilidad', 'activo', 'agregado_por', 'fecha_creacion'
  ],
  PROYECTO_HITOS: [
    'hito_id', 'proyecto_id', 'nombre', 'descripcion', 'fecha_objetivo',
    'estado', 'orden', 'fecha_creacion'
  ],
  PROYECTO_EVENTOS: [
    'evento_id', 'proyecto_id', 'tipo', 'autor_email', 'autor_nombre',
    'titulo', 'cuerpo', 'ref_tipo', 'ref_id', 'menciones', 'timestamp'
  ],
  // v9.4: ver la nota identica en backend/backoffice/Constantes.gs.
  PROYECTO_ENTREGABLES: [
    'entregable_id', 'proyecto_id', 'hito_id', 'nombre', 'descripcion',
    'responsable_email', 'fecha_comprometida', 'estado', 'url_evidencia',
    'fecha_entrega_real', 'revisado_por', 'resultado_revision',
    'observaciones', 'fecha_creacion'
  ],
  PROYECTO_RIESGOS: [
    'riesgo_id', 'proyecto_id', 'descripcion', 'probabilidad', 'impacto',
    'nivel', 'responsable_email', 'mitigacion', 'estado', 'fecha_creacion'
  ],
  // v10.0 (Modulo SGC ISO 9001): ver la nota identica en
  // backend/backoffice/Constantes.gs sobre cada hoja y cada campo.
  SGC_DOCUMENTOS: [
    'documento_id', 'codigo', 'nombre', 'descripcion', 'tipo', 'area_id',
    'version_vigente', 'estado', 'visibilidad',
    'fecha_vigencia', 'proxima_revision',
    'elaborado_por', 'revisado_por', 'aprobado_por',
    'archivo_id', 'archivo_nombre', 'archivo_mime',
    'creado_por', 'fecha_creacion', 'activa',
    // v10.0 Fase 1b: ver la nota identica en backend/backoffice/Constantes.gs.
    'requiere_acuse', 'fecha_limite_acuse'
  ],
  SGC_DOC_VERSIONES: [
    'version_id', 'documento_id', 'version', 'cambios',
    'archivo_id', 'archivo_nombre', 'archivo_mime',
    'subido_por', 'fecha', 'vigente'
  ],
  SGC_DOC_DESTINATARIOS: ['destinatario_id', 'documento_id', 'usuario_email'],
  SGC_ROLES: [
    'rol_id', 'usuario_email', 'rol_sgc', 'area_id',
    'vigencia_hasta', 'activo', 'fecha_creacion'
  ],
  // v10.0 Fase 1b: ver la nota identica en backend/backoffice/Constantes.gs.
  SGC_DOC_ACUSES: ['acuse_id', 'documento_id', 'version', 'usuario_email', 'acusado_en'],
  // v10.0 Fase 2a (PRO-02): ver la nota identica en
  // backend/backoffice/Constantes.gs sobre cada hoja y cada campo.
  SGC_PERSONAS: [
    'persona_id', 'usuario_email', 'nombre', 'rut', 'cargo', 'tipo',
    'area_id', 'jefatura_email', 'subrogante_email',
    'fecha_ingreso', 'estado', 'fecha_desvinculacion',
    'creado_por', 'fecha_creacion', 'activa'
  ],
  // v10.0 Tanda A: ver la nota identica en backend/backoffice/Constantes.gs.
  SGC_DESCRIPTORES: [
    'descriptor_id', 'persona_id', 'version', 'objetivo', 'funciones',
    'responsabilidades', 'habilidades',
    'items_responsabilidades', 'items_habilidades',
    'nivel_educacional', 'formacion_tecnica', 'experiencia',
    'archivo_id', 'archivo_nombre', 'archivo_mime',
    'vigente', 'creado_por', 'fecha'
  ],
  SGC_PERSONA_DOCUMENTOS: [
    'doc_id', 'persona_id', 'tipo', 'nombre',
    'archivo_id', 'archivo_nombre', 'archivo_mime',
    'subido_por', 'fecha', 'activa'
  ],
  SGC_INDUCCIONES: [
    'induccion_id', 'persona_id', 'item', 'fecha', 'relator_email',
    'estado', 'observaciones'
  ],
  // v10.0 Fase 2b (PRO-02): ver la nota identica en
  // backend/backoffice/Constantes.gs sobre cada hoja y cada campo.
  // v10.0 Tanda A: ver la nota identica en backend/backoffice/Constantes.gs.
  SGC_EVALUACIONES: [
    'evaluacion_id', 'persona_id', 'descriptor_id', 'fecha', 'evaluador_email',
    'respuestas_responsabilidades', 'respuestas_habilidades',
    'promedio_responsabilidades', 'promedio_habilidades',
    'requiere_capacitacion', 'observaciones', 'recomendado_por',
    'proxima_evaluacion'
  ],
  SGC_CAPACITACIONES: [
    'capacitacion_id', 'nombre', 'descripcion', 'horas',
    'fecha_programada', 'fecha_realizada', 'relator', 'estado',
    'creado_por', 'fecha_creacion', 'activa'
  ],
  SGC_CAPACITACION_ASISTENTES: [
    'asistencia_id', 'capacitacion_id', 'persona_id', 'asistio', 'fecha',
    'eficacia_fecha', 'eficacia_resultado', 'eficacia_observaciones'
  ],
  // v10.0 Fase 3a (PRO-06): ver la nota identica en
  // backend/backoffice/Constantes.gs sobre cada campo.
  SGC_NC: [
    'nc_id', 'correlativo', 'fuente', 'origen_ref', 'referencia_normativa',
    'descripcion',
    'area_id', 'detectada_por', 'fecha_deteccion', 'responsable_email',
    'estado', 'ciclo',
    'correccion_descripcion', 'correccion_actividad_id',
    'correccion_plazo', 'correccion_fecha_cierre',
    'porque_1', 'porque_2', 'porque_3', 'porque_4', 'porque_5', 'causa_raiz',
    'accion_descripcion', 'accion_actividad_id',
    'accion_plazo', 'accion_fecha_cierre',
    'eficacia_plazo', 'eficacia_fecha', 'eficacia_resultado', 'eficacia_observaciones',
    'fecha_cierre', 'cerrada_por', 'fecha_creacion', 'activa'
  ],
  // v10.0 Fase 3b (PRO-03): ver la nota identica en
  // backend/backoffice/Constantes.gs sobre cada campo.
  SGC_AUDITORIAS: [
    'auditoria_id', 'correlativo', 'anio', 'area_id', 'proceso', 'clausulas',
    'auditor_email', 'coauditores', 'auditados', 'objetivo', 'alcance', 'criterios',
    'fecha_programada', 'fecha_plan', 'fecha_ejecucion',
    'estado',
    'informe_plazo', 'informe_fecha', 'informe_conclusion', 'personas_entrevistadas',
    'fecha_cierre', 'cerrada_por', 'creada_por', 'fecha_creacion', 'activa'
  ],
  SGC_AUD_HALLAZGOS: [
    'hallazgo_id', 'auditoria_id', 'clausula', 'aspecto_verificado',
    'evidencia', 'resultado', 'descripcion', 'nc_id',
    'registrado_por', 'fecha_registro', 'activo'
  ],
  // v10.0 Fase 4 (PRO-07): ver la nota identica en
  // backend/backoffice/Constantes.gs sobre cada campo.
  SGC_QUEJAS: [
    'queja_id', 'correlativo',
    'nombre_completo', 'empresa', 'rut', 'email', 'telefono',
    'tipo', 'area', 'descripcion', 'canal', 'fecha_envio',
    'fecha_recepcion', 'procede', 'motivo_no_procede', 'registrado_por',
    'investigador_email', 'resultado_investigacion', 'valida',
    'accion_implementada', 'nc_id', 'resolucion_plazo', 'fecha_resolucion', 'responsable_resolucion',
    'fecha_notificacion', 'revisado_por',
    'seguimiento_plazo', 'fecha_seguimiento', 'cliente_conforme',
    'estado',
    'fecha_cierre', 'cerrada_por', 'fecha_creacion', 'activa'
  ],

  // --- v10.0 Fase 5a: proveedores externos (PRO-04) -------------------------
  // FO-PRO-04-01 "Listado de proveedores aprobados" es el maestro: a quien se
  // le compra que, y si esta aprobado. El "Resultado evaluacion" y el
  // "Estatus" que pide el formulario se guardan desnormalizados (ultima_*)
  // para poder listar sin recorrer todas las evaluaciones -- mismo criterio
  // que el resto del modulo.
  //
  // es_unico: PRO-04 §6.2 distingue al proveedor UNICO. Al resto se le
  // desecha si el promedio cae a 5.0 o menos; al unico no se le puede
  // desechar (no hay con quien reemplazarlo), asi que en su lugar se le pide
  // una reunion para exigir mejoras. Sin este dato el sistema daria una
  // instruccion imposible de cumplir.
  //
  // estado: APROBADO | REPROBADO | SIN_EVALUAR
  SGC_PROVEEDORES: [
    'proveedor_id', 'nombre', 'rut', 'producto_servicio',
    'direccion', 'telefono', 'email', 'nombre_contacto',
    'es_unico', 'estado',
    'ultima_evaluacion_fecha', 'ultima_evaluacion_promedio', 'ultima_evaluacion_resultado',
    'proxima_evaluacion',
    'creado_por', 'fecha_creacion', 'activa'
  ],

  // FO-PRO-04-02 "Evaluacion de proveedores". Los seis criterios van en
  // columnas fijas y no en un JSON: PRO-04 §6.2 los enumera de la a) a la f)
  // como una lista cerrada, a diferencia de la evaluacion de personas, que
  // califica "segun descriptor de cargo" y por eso si necesita ser variable.
  // En columnas quedan ademas legibles para el auditor que abra la planilla.
  //
  // resultado: MALO (1 a 3,9) | REGULAR (4 a 6,5) | BUENO (6,6 a 10) -- la
  // escala cualitativa textual de PRO-04 §6.2.
  // aprobado: promedio > 5.0. Ojo que el corte NUMERICO y la escala
  // cualitativa no coinciden: un 5.0 cae en "Regular" pero igual reprueba,
  // porque el procedimiento dice "inferior o igual a 5.0".
  SGC_PROVEEDOR_EVALUACIONES: [
    'evaluacion_id', 'proveedor_id', 'fecha', 'orden_compra',
    'calidad', 'plazo_entrega', 'costos', 'tiempo_respuesta', 'precio', 'postventa',
    'promedio', 'resultado', 'aprobado',
    'observaciones', 'evaluador_email', 'proxima_evaluacion'
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

/**
 * Deja la planilla al dia con el esquema del codigo: crea las hojas que
 * faltan Y agrega a las que ya existen las columnas nuevas.
 *
 * Lo segundo faltaba, y es la razon de un problema real: cada version que
 * agrega una columna (por ejemplo items_responsabilidades en SGC_DESCRIPTORES)
 * dejaba la hoja existente con el encabezado viejo. Al pegar datos con el
 * formato nuevo, todo quedaba corrido una o dos columnas y el modulo mostraba
 * la ficha vacia -- sin ningun error visible, que es lo peor de todo.
 *
 * Las columnas nuevas se agregan AL FINAL, no en la posicion que tienen en
 * el esquema. Es seguro porque toda la lectura y escritura de la planilla se
 * resuelve POR NOMBRE de encabezado (leerHojaConEncabezados_ /
 * agregarFila_ / actualizarFilaPorId_), nunca por posicion. Agregar al final
 * ademas no mueve ni una celda de los datos que ya estan cargados, que es
 * justo lo que no se puede arriesgar en una planilla en produccion.
 */
function actualizarEsquema() {
  var ss = SpreadsheetApp.openById(getConfig_().sheetId);
  var creadas = [];
  var ampliadas = {};

  Object.keys(ESQUEMA_HOJAS).forEach(function (nombre) {
    var esperadas = ESQUEMA_HOJAS[nombre];
    var hoja = ss.getSheetByName(nombre);

    if (!hoja) {
      hoja = ss.insertSheet(nombre);
      hoja.appendRow(esperadas);
      creadas.push(nombre);
      return;
    }

    var ultimaCol = hoja.getLastColumn();
    var actuales = ultimaCol < 1 ? [] : hoja.getRange(1, 1, 1, ultimaCol).getValues()[0]
      .map(function (h) { return String(h == null ? '' : h).trim(); });

    // Hoja existente pero sin encabezado (se creo a mano y quedo vacia).
    if (!actuales.join('')) {
      hoja.getRange(1, 1, 1, esperadas.length).setValues([esperadas]);
      ampliadas[nombre] = esperadas.slice();
      return;
    }

    var faltan = esperadas.filter(function (col) { return actuales.indexOf(col) === -1; });
    if (!faltan.length) return;

    hoja.getRange(1, actuales.length + 1, 1, faltan.length).setValues([faltan]);
    ampliadas[nombre] = faltan;
  });

  sembrarConfigSlaSiVacia_(ss);
  sembrarTiposSiVacia_(ss);
  sembrarConfigNotificacionesSiVacia_(ss);

  Logger.log('Hojas creadas: ' + (creadas.join(', ') || '(ninguna)'));
  Object.keys(ampliadas).forEach(function (nombre) {
    Logger.log('Columnas agregadas a ' + nombre + ': ' + ampliadas[nombre].join(', '));
  });
  if (!creadas.length && !Object.keys(ampliadas).length) {
    Logger.log('La planilla ya estaba al dia: no hubo cambios.');
  }

  return { creadas: creadas, ampliadas: ampliadas };
}

// Nombre historico. Se mantiene para no romper la costumbre de correr
// "instalarHojas", pero ahora tambien actualiza las columnas.
function instalarHojas() {
  return actualizarEsquema().creadas;
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
