'use strict';

/**
 * schema.js — equivalente Node del Instalador de Apps Script (backend/setup):
 * declara las tablas y las crea si faltan, sin tocar las que ya existen.
 *
 * Mismos nombres de columna que COLUMNAS en backend/backoffice/Constantes.gs
 * -- se van agregando aqui a medida que se porta cada modulo de logica,
 * empezando por Catalogos.
 */

const crypto = require('node:crypto');
const { asegurarTabla_, asegurarColumnas_, leerFilas_, agregarFila_, actualizarFilaPorId_ } = require('./sqliteRepo');

// Fase "Organización invisible" (documento "Arquitectura de Accesos",
// 2026-09-19, decisiones 1 y 4 del rediseño de accesos): el límite real
// entre distintos clientes que compren SIGSO. Este incremento SOLO prepara
// el terreno -- una tabla nueva + una columna nueva en CUENTAS_PORTAL/
// CAT_EMPRESAS, con UNA fila que agrupa todo lo que ya existe hoy. Cero
// cambio de comportamiento: nada filtra por esto todavía (esa parte,
// "enforcement real de organización", queda deliberadamente en pausa hasta
// que exista un cliente real -- decisión 1 del documento).
const ORGANIZACION_POR_DEFECTO_ID = 'org-homepymes-ays';

const COLUMNAS = {
  // 'organizacion_id' es nuevo (ver nota arriba) -- toda fila existente lo
  // recibe automáticamente vía asegurarOrganizacionPorDefecto_.
  CAT_EMPRESAS: ['empresa_id', 'nombre', 'logo', 'activo', 'organizacion_id'],
  ORGANIZACIONES: ['organizacion_id', 'nombre', 'activo', 'creado_en'],

  // Directorio de Personas (Fase 1, 2026-09-22): el registro CANÓNICO de
  // "quién es cada persona", pensado para vender SIGSO a otras empresas. Hoy
  // una persona no existe como entidad -- está implícita en ~40 columnas
  // `*_email` sueltas, y la misma persona aparece fragmentada en
  // CUENTAS_PORTAL (login), SGC_PERSONAS (una fila POR CARGO, con RUT) y
  // referencias por correo, sin un ID que las una. Esta tabla las unifica.
  //
  // Decisiones (pedido del dueño, 2026-09-21): el RUT es la LLAVE NATURAL de
  // identidad (único, no cambia, no se olvida como un correo); el correo pasa
  // a ser un atributo secundario (útil para login/notificaciones, no la
  // identidad). `organizacion_id` es el límite entre clientes (multi-tenant).
  //
  // FASE 1 A PROPÓSITO NO CAMBIA NADA VISIBLE: esta tabla se siembra sola al
  // arrancar (asegurarDirectorioPersonas_) desde CUENTAS_PORTAL + SGC_PERSONAS
  // y da un servicio de resolución (correo->persona) y búsqueda (por RUT/
  // nombre/cargo). El correo sigue siendo la llave de almacenamiento en las
  // ~40 FKs existentes -- reemplazarlas por persona_id es una fase POSTERIOR,
  // en pausa (misma disciplina que el enforcement multi-tenant).
  //
  //   persona_id      ID interno estable (la identidad real, nunca cambia).
  //                   Distinto del persona_id de SGC_PERSONAS (que es por cargo).
  //   emails          lista JSON: una persona puede tener varios correos.
  //   cargo_principal el cargo que se muestra por defecto (una persona puede
  //                   tener más de uno en SGC; acá va el principal, para pintar
  //                   "Nombre — Cargo").
  //   tiene_cuenta    true si tiene login en CUENTAS_PORTAL (vs. colaborador
  //                   externo que solo se asigna a trabajos, sin cuenta).
  //   origen          de qué fuente se sembró (CUENTAS_PORTAL / SGC_PERSONAS).
  DIRECTORIO_PERSONAS: [
    'persona_id', 'organizacion_id', 'nombre', 'rut', 'emails',
    'cargo_principal', 'empresa_id', 'tiene_cuenta', 'activa',
    'origen', 'creado_en', 'actualizado_en'
  ],
  CAT_PLATAFORMAS: ['plataforma_id', 'nombre', 'empresa_id', 'url_base', 'activo'],
  CAT_MODULOS: ['modulo_id', 'nombre', 'plataforma_id', 'modulo_padre_id', 'activo'],
  CAT_TIPOS: ['tipo_id', 'nombre', 'prioridad_default', 'activo', 'es_urgente'],
  CAT_AREAS: ['area_id', 'nombre', 'responsable_email', 'activo'],
  // Cartera de clientes, existe en SIGSO desde la v1.0. No migrada aún al
  // VPS (ver memoria: 284 filas reales pendientes) -- prestacionesSgc.js
  // (v11 Fase 8) es el primer módulo Node que la consume.
  CAT_CLIENTES: [
    'cliente_id', 'razon_social', 'rut', 'codigo_cliente', 'contacto',
    'correo', 'telefono', 'representante_legal', 'direccion',
    'estado', 'bloqueo', 'activo'
  ],
  CONFIG_NOTIFICACIONES: ['notif_id', 'evento', 'rol_destinatario', 'emails_extra', 'activo'],
  // v7.3 (Nivel 0, puerto Fase 3a): ultimo permiso de notificaciones del
  // navegador que cada persona reporto (granted/denied/default), para que
  // Administracion detecte "a quien nunca le llega la alerta en vivo
  // porque nunca acepto el permiso".
  NOTIF_PERMISOS_SO: ['email', 'permiso', 'actualizado_en'],
  // v3.3 (§2.4): cuentas e identidad de la plataforma (Portal.gs/
  // CuentasPortal.gs). hash_password nunca guarda la clave en claro --
  // ver backend/logica/passwordHash.js sobre el cambio de algoritmo.
  CUENTAS_PORTAL: [
    'cuenta_id', 'usuario', 'nombre', 'cargo',
    'hash_password', 'salt', 'emails', 'rol', 'modulos',
    'empresa_id', 'activo', 'debe_cambiar_password',
    'ultimo_acceso', 'creado_por',
    // organizacion_id: ver la nota "Organización invisible" arriba.
    'organizacion_id',
    // super_admin: bandera aparte de `rol` a propósito (2026-09-21, pedido
    // directo del dueño de la cuenta). NUNCA es un campo que crear/actualizar
    // acepten desde `data` (cuentasPortal.js arma `cambios`/el insert campo
    // por campo, nunca por spread) -- la única forma de encenderla es una
    // escritura directa a la fila, fuera de cualquier acción del API. Así,
    // ningún Admin (ni siquiera otro ADM) puede otorgársela a otra cuenta
    // por accidente ni a propósito vía la UI de gestión de cuentas.
    'super_admin'
  ],
  SESIONES_PORTAL: ['token', 'cuenta_id', 'expira', 'creada'],
  // Fase "Recuperar contraseña" (documento "Arquitectura de Accesos",
  // 2026-09-19, punto 3 del orden acordado): no existía ningún flujo de
  // "olvidé mi contraseña" en SIGSO -- solo reseteo manual por un Admin
  // (cuentasPortal.js). token_hash guarda el SHA-256 del token, nunca el
  // token en claro (ver backend/logica/recuperarPassword.js) -- una lectura
  // de esta tabla no alcanza para usar un enlace de recuperación ajeno.
  RESETS_PASSWORD: ['reset_id', 'cuenta_id', 'token_hash', 'creado_en', 'expira', 'usado'],
  // Foto de perfil (v6.4 originalmente en Apps Script/Sheets, portada a
  // Node+R2 2026-09-22 -- ver perfiles.js). Llave compuesta identidad_tipo+
  // identidad_clave (PORTAL: cuenta_id: GOOGLE: correo normalizado) porque
  // "quién soy" tiene dos poblaciones distintas, igual que en Perfiles.gs
  // (ver identidadDe_ en perfiles.js) -- no hay una sola columna id natural.
  // thumb_base64 viaja INLINE (igual que en Sheets: ~10-14k caracteres, cabe
  // holgado en una celda) para que pintar un avatar nunca dispare una
  // llamada aparte a R2 -- getMiPerfil/getFotosPerfil arman con thumb_mime
  // el mismo data URI ("data:<mime>;base64,...") que ya esperaba el
  // frontend en la era Sheets, directo al <img src>. original_clave/
  // original_mime son SOLO del archivo sin recortar en R2: existen nada
  // más para la validación por firma binaria y una futura revisión manual;
  // ninguna pantalla lo vuelve a pedir.
  PERFILES: [
    'perfil_id', 'identidad_tipo', 'identidad_clave',
    'thumb_base64', 'thumb_mime', 'original_clave', 'original_mime', 'actualizado_en'
  ],

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
    'audiencia_tipo', 'fecha_limite_acuse', 'fecha_publicacion', 'activa',
    // SIGSO v2 (Módulo 6B): enlace a la fuente oficial (obligatorio en Ley y Dictamen).
    'fuente_url'
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
    'escalada_admin_enviada',
    // SIGSO v2 (Módulo 5A): quién la inició -- la coordinación o, si no llegó,
    // una persona de la lista (iniciarPausaParticipante).
    'iniciada_por'
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
    'solicitud_origen_id',
    // Fase H item 2 (Camino B, 2026-09-23, ver documentacion/SIGSO-Proyectos-
    // 2.0-auditoria-y-propuesta.md §13): dimension financiera, opcional --
    // un proyecto sin presupuesto simplemente no muestra la pestaña
    // Financiero con datos.
    'centro_costo', 'presupuesto_monto', 'presupuesto_moneda'
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
  // Fase H (Camino B, 2026-09-22, ver documentacion/SIGSO-Proyectos-2.0-
  // auditoria-y-propuesta.md §13): la curva S de avance FÍSICO -- un punto de
  // control manual por fecha (% proyectado vs % real, independiente del
  // detalle de tareas). Distinto de avance_esperado_pct/avance_pct (que se
  // DERIVAN de las tareas): esto es lo que un líder/gerente DECLARA a mano,
  // igual que la referencia ITO ("Avance Simple"). pct_real es opcional (una
  // fecha futura puede tener solo lo proyectado, sin lo real todavía).
  PROYECTO_CONTROL_AVANCE: [
    'control_id', 'proyecto_id', 'fecha', 'pct_proyectado', 'pct_real',
    'nota', 'registrado_por', 'fecha_creacion'
  ],
  // Fase H item 2 (Camino B, 2026-09-23): estados/hitos de pago -- la
  // dimension financiera que SIGSO nunca tuvo. estado: proyectado |
  // facturado | pagado. monto_real/fecha_real solo tienen sentido cuando
  // estado ya avanzo de "proyectado" (no se fuerza en el backend: un lider
  // puede registrar el monto real antes de marcar el estado).
  PROYECTO_ESTADOS_PAGO: [
    'estado_pago_id', 'proyecto_id', 'nombre', 'fecha_proyectada',
    'monto_proyectado', 'fecha_real', 'monto_real', 'estado', 'orden',
    'registrado_por', 'fecha_creacion'
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
  ],

  // SGC Fase 3a (PRO-06): el motor de mejora. UNA fila = UN formulario
  // FO-PRO-06-01 completo (corrección -> causa -> acción -> eficacia), mismas
  // columnas que Constantes.gs. correccion_actividad_id/accion_actividad_id
  // son la decisión central: son ACTIVIDADES reales (proyecto_id/hito_id NO
  // se usan aquí; solo sgc_origen_tipo/sgc_origen_id en ACTIVIDADES).
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

  // SGC Fase 3b (PRO-03, ISO 9001 §9.2): auditoría interna. La lista de
  // verificación y los hallazgos son la MISMA tabla (SGC_AUD_HALLAZGOS) --
  // una cláusula CONFORME también se guarda, es evidencia de que se revisó.
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

  // SGC Fase 4 (PRO-07): quejas, felicitaciones y consultas. Parte 1 (datos
  // del reclamante) la llena el Intake público (no portado aún); esta fase
  // porta las Partes 2-5 del FO-PRO-07-01, sobre la fila que ya existe.
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

  // SGC Fase 5a (PRO-04, §8.4): proveedores externos. El listado maestro
  // (FO-PRO-04-01) guarda desnormalizada la ultima_* evaluación para poder
  // listar sin recorrer todas las evaluaciones. es_unico distingue al
  // proveedor que no se puede reemplazar (PRO-04 §6.2): reprobado, no se
  // desecha, se le pide una reunión de mejora.
  SGC_PROVEEDORES: [
    'proveedor_id', 'nombre', 'rut', 'producto_servicio',
    'direccion', 'telefono', 'email', 'nombre_contacto',
    'es_unico', 'estado',
    'ultima_evaluacion_fecha', 'ultima_evaluacion_promedio', 'ultima_evaluacion_resultado',
    'proxima_evaluacion',
    'creado_por', 'fecha_creacion', 'activa'
  ],
  // FO-PRO-04-02. Los seis criterios de PRO-04 §6.2 van en columnas fijas
  // (lista cerrada de a) a f)), no en JSON.
  SGC_PROVEEDOR_EVALUACIONES: [
    'evaluacion_id', 'proveedor_id', 'fecha', 'orden_compra',
    'calidad', 'plazo_entrega', 'costos', 'tiempo_respuesta', 'precio', 'postventa',
    'promedio', 'resultado', 'aprobado',
    'observaciones', 'evaluador_email', 'proxima_evaluacion'
  ],

  // SGC Fase 5b (PRO-05, §9.3): revisión por la dirección. Una fila = un
  // FO-PRO-05-01 completo, mismo criterio que SGC_NC/SGC_AUDITORIAS/
  // SGC_QUEJAS. Las 13 entradas de §9.3.2 van como JSON [{item,
  // observaciones}]: son fijas y viven en el código (ENTRADAS_REVISION), no
  // en esta hoja -- la norma las enumera, no las define la organización.
  SGC_REVISIONES: [
    'revision_id', 'correlativo', 'anio',
    'fecha_programada', 'aviso_plazo', 'fecha_convocatoria', 'fecha_reunion',
    'asistentes', 'entradas', 'conclusiones', 'anexos',
    'director_email', 'responsable_calidad_email',
    'estado', 'fecha_cierre', 'cerrada_por',
    'creada_por', 'fecha_creacion', 'activa'
  ],
  // Los acuerdos de la tabla 3 del FO-PRO-05-01. Fila propia (no JSON dentro
  // de la revisión) porque cada uno se convierte en una ACTIVIDAD real y
  // necesita enlazar actividad_id.
  SGC_REVISION_ACUERDOS: [
    'acuerdo_id', 'revision_id', 'tipo', 'observaciones',
    'responsable_email', 'plazo', 'actividad_id',
    'creado_por', 'fecha_creacion', 'activa'
  ],

  // SGC Fase 6a (DOC-07, §6.2): objetivos de calidad. UNA fila = un
  // objetivo EN UN AÑO (clave anio+numero) -- DOC-07 es un documento vivo y
  // la meta/responsable/frecuencia se ajustan de un año a otro; guardar por
  // año conserva contra qué meta se midió cada período. NO es un catálogo
  // en código (a diferencia de las 13 entradas de la revisión o las 28
  // cláusulas ISO, que las define la norma): estos los define la empresa.
  SGC_OBJETIVOS: [
    'objetivo_id', 'anio', 'numero',
    'objetivo_general', 'objetivo_especifico', 'indicador',
    'meta_texto', 'meta_operador', 'meta_valor', 'unidad',
    'acciones', 'frecuencia', 'frecuencia_texto',
    'responsable_texto', 'responsable_email',
    'fuente', 'calculo',
    'creado_por', 'fecha_creacion', 'activa'
  ],
  // Una fila = "en tal período, el indicador dio tanto". `cumple` se
  // PERSISTE (comparado contra la meta vigente al momento de medir, no
  // recalculado si la meta cambia después).
  SGC_INDICADOR_LECTURAS: [
    'lectura_id', 'objetivo_id', 'indicador_id', 'anio', 'periodo',
    'valor', 'numerador', 'denominador',
    'cumple', 'origen', 'detalle', 'observaciones',
    'registrado_por', 'fecha_registro', 'activa'
  ],

  // v11.0 Fase 6 (§9.1.1): indicadores de PROCESO, hoja aparte de
  // SGC_OBJETIVOS (los objetivos se guardan por año; un indicador de
  // proceso vive mientras viva el proceso). Sus lecturas comparten
  // SGC_INDICADOR_LECTURAS vía `indicador_id`, dejando `objetivo_id` vacío
  // para no colarse en el tablero de objetivos.
  SGC_INDICADORES: [
    'indicador_id', 'codigo', 'nombre', 'descripcion',
    'proceso_id', 'objetivo_id', 'area',
    'formula', 'fuente', 'unidad',
    'meta_operador', 'meta_valor', 'meta_texto', 'tolerancia_valor',
    'frecuencia', 'responsable_email',
    'estado', 'observaciones',
    'creado_por', 'fecha_creacion', 'activa'
  ],

  // SGC Fase 6b (matriz de cobertura ISO + "modo auditoría"). La foto
  // semanal (v12.8): UNA fila por semana (clave = el LUNES, no un número de
  // semana ISO, que trae sus propios bordes). Idempotente -- el pase diario
  // corre todos los días pero solo escribe si esa semana todavía no tiene
  // la suya. cap_4..cap_10 son fijos porque los capítulos de la ISO 9001 lo
  // son.
  SGC_COBERTURA_HISTORICO: [
    'cobertura_id', 'periodo', 'fecha',
    'pct_listo', 'aplicables', 'no_aplica', 'completo', 'parcial', 'faltante',
    'cap_4', 'cap_5', 'cap_6', 'cap_7', 'cap_8', 'cap_9', 'cap_10',
    'origen'
  ],

  // v11.0 Fase 1: alcance del SGC y exclusiones (§4.3). Cada versión del
  // alcance es su propia fila (VIGENTE/REEMPLAZADO, nunca se sobreescribe)
  // para poder responder "contra qué alcance regía tal fecha".
  SGC_ALCANCE: [
    'alcance_id', 'version', 'estado',
    'razon_social', 'nombre_fantasia', 'rut',
    'declaracion', 'areas', 'ubicaciones',
    'norma_codigo', 'norma_version',
    'documento_id', 'observaciones',
    'vigente_desde', 'reemplazado_por',
    'creado_por', 'fecha_creacion', 'activa'
  ],
  // Una exclusión por fila (no JSON dentro del alcance): cada una es un
  // registro auditable por sí mismo, y la matriz de cobertura las consulta
  // POR CLAUSULA. clausula_padre se deriva al guardar (granularidad del
  // catálogo de la matriz, ej. '7.1.5.2' -> '7.1').
  SGC_EXCLUSIONES: [
    'exclusion_id', 'alcance_id', 'clausula', 'clausula_padre', 'titulo',
    'justificacion', 'creado_por', 'fecha_creacion', 'activa'
  ],

  // v11.0 Fase 2: contexto de la organización (§4.1). Los 24 factores del
  // DOC-02 "Análisis FODA". origen se deriva del tipo (fortaleza/debilidad
  // son internas, oportunidad/amenaza externas) pero se persiste.
  SGC_CONTEXTO: [
    'factor_id', 'tipo', 'origen', 'numero', 'descripcion',
    'estado', 'observaciones',
    'fecha_identificacion', 'fecha_ultima_revision', 'revisado_por',
    'creado_por', 'fecha_creacion', 'activa'
  ],
  // Partes interesadas (§4.2). Las columnas siguen al DOC-04 v02 y no a
  // una plantilla genérica: son las SEIS que el documento real tiene.
  SGC_PARTES_INTERESADAS: [
    'parte_id', 'nombre', 'categoria',
    'necesidades', 'expectativa', 'efecto_sgc',
    'impacto', 'influencia',
    'metodo_seguimiento', 'frecuencia_seguimiento', 'responsable_email',
    'estado', 'fecha_ultima_revision', 'revisado_por',
    'creado_por', 'fecha_creacion', 'activa'
  ],

  // v11.0 Fase 3: riesgos y oportunidades (§6.1). La magnitud y su banda
  // NO se guardan, se CALCULAN a partir de probabilidad/impacto -- el DOC-08
  // original trae 7 de 32 valoraciones que no coinciden con su propia tabla
  // de criterios, y calculándolas deja de ser posible que discrepen.
  // proceso_id queda listo para cuando se porte Procesos (v11 Fase 4).
  SGC_RIESGOS: [
    'riesgo_id', 'clase', 'codigo',
    'relacion_actividad', 'factor', 'descripcion',
    'analisis_causa', 'procedencia', 'origen', 'factor_contexto_id',
    'probabilidad', 'impacto',
    'accion', 'fecha_implementacion', 'medidas_control',
    'responsable_email', 'accion_actividad_id',
    'probabilidad_residual', 'impacto_residual',
    'estado', 'observaciones', 'proceso_id',
    'fecha_identificacion', 'fecha_ultima_revision', 'revisado_por',
    'creado_por', 'fecha_creacion', 'activa'
  ],

  // v11.0 Fase 4 (§4.4): procesos del SGC. Dos niveles en una sola tabla:
  // MAPA (los 14 del DOC-03, proceso_id = codigo) y SERVICIO (los ~40 de
  // los DOC-10 a DOC-13, colgando via proceso_padre_id).
  SGC_PROCESOS: [
    'proceso_id', 'codigo', 'nombre', 'tipo', 'nivel',
    'proceso_padre_id', 'area',
    'objetivo', 'alcance', 'responsable_email',
    'entradas', 'actividades', 'salidas',
    'clientes', 'proveedores', 'recursos',
    'documentos', 'clausulas_iso',
    'estado', 'observaciones',
    'fecha_ultima_revision', 'revisado_por',
    'creado_por', 'fecha_creacion', 'activa'
  ],

  // Un paso por fila, con las cinco columnas que traen los DOC-10 a DOC-13:
  // responsable, input, actividades, evidencias y output. Se respeta esa
  // estructura tal cual en vez de normalizarla, porque es el formato que la
  // empresa ya aprobó y con el que trabaja cada área.
  SGC_PROCESO_PASOS: [
    'paso_id', 'proceso_id', 'numero', 'nombre',
    'responsable', 'input', 'actividades', 'evidencias', 'output',
    'observaciones', 'creado_por', 'fecha_creacion', 'activa'
  ],

  // v11.0 Fase 8 (§8.1/§8.5/§8.6/§8.7): evidencia de servicios prestados.
  // Una fila = UNA prestación registrada -- nada se pre-genera (con 50
  // clientes x 40 procesos, una matriz completa serían 24.000 filas/año
  // casi todas vacías). `periodo` es opcional: un servicio puntual no
  // tiene uno. `cliente_id` apunta a CAT_CLIENTES, desnormalizando el
  // nombre igual que SOLICITUDES.
  SGC_PRESTACIONES: [
    'prestacion_id',
    'cliente_id', 'cliente_nombre',
    'proceso_id', 'proceso_codigo', 'proceso_nombre',
    'periodo', 'fecha_prestacion', 'responsable_email',
    'estado', 'evidencia',
    'liberado_por', 'fecha_liberacion',
    'nc_id', 'observaciones',
    'creado_por', 'fecha_creacion', 'activa'
  ]
};

// Crea la organización por defecto si todavía no existe ninguna, y le
// asigna organizacion_id a cualquier fila de CUENTAS_PORTAL/CAT_EMPRESAS
// que todavía no lo tenga (columna recién agregada, o cuenta creada antes
// de este incremento). Nunca pisa un organizacion_id ya asignado -- sigue
// siendo seguro de correr en un mundo con más de una organización más
// adelante, porque solo toca filas realmente sin asignar.
//
// USUARIOS (identidad legada de Google) NO recibe organizacion_id a
// propósito: ya está decidido retirarla (Fase 4 de la migración a Node) --
// sumarle capacidad nueva a una tabla que se va a borrar sería trabajo
// perdido.
function asegurarOrganizacionPorDefecto_(db) {
  const organizaciones = leerFilas_(db, 'ORGANIZACIONES', COLUMNAS.ORGANIZACIONES);
  if (!organizaciones.some((o) => o.organizacion_id === ORGANIZACION_POR_DEFECTO_ID)) {
    agregarFila_(db, 'ORGANIZACIONES', {
      organizacion_id: ORGANIZACION_POR_DEFECTO_ID,
      nombre: 'HomePymes / Asesorías Integrales AyS SpA',
      activo: true,
      creado_en: new Date().toISOString()
    });
  }

  [['CUENTAS_PORTAL', 'cuenta_id'], ['CAT_EMPRESAS', 'empresa_id']].forEach(([hoja, idCampo]) => {
    leerFilas_(db, hoja, COLUMNAS[hoja])
      .filter((fila) => !fila.organizacion_id)
      .forEach((fila) => actualizarFilaPorId_(db, hoja, idCampo, fila[idCampo], { organizacion_id: ORGANIZACION_POR_DEFECTO_ID }));
  });
}

// Siembra el Directorio de Personas (ver la nota de la tabla arriba) desde
// las dos fuentes que hoy tienen datos de personas: CUENTAS_PORTAL (login,
// la identidad de acá en adelante) y SGC_PERSONAS (que trae el RUT y el
// cargo real). Idempotente y NO destructiva: solo inserta a quien todavía
// no está representado (por RUT o por alguno de sus correos) y nunca pisa
// una fila ya existente -- así corre segura en cada arranque, y una fila
// enriquecida a mano en una fase futura no se sobrescribe.
//
// Regla de deduplicación (RUT = llave natural, decisión del dueño): dos
// filas con el mismo RUT son la MISMA persona (esto colapsa el caso real de
// una persona con dos cargos en SGC_PERSONAS en UNA sola entrada del
// directorio). Sin RUT, se deduplica por correo normalizado.
//
// USUARIOS (identidad legada de Google) NO se usa como fuente a propósito:
// ya está decidido retirarla; todo el personal real vive en CUENTAS_PORTAL/
// SGC_PERSONAS. Una persona referenciada solo por un correo que no está en
// ninguna de las dos simplemente no se resuelve (el llamador muestra el
// correo crudo) -- degradación elegante, no un error.
function normalizarRutDir_(rut) {
  return String(rut || '').replace(/[.\-\s]/g, '').toUpperCase();
}
function normalizarEmailDir_(email) {
  return String(email || '').trim().toLowerCase();
}
function esVerdaderoDir_(v) { return v === true || v === 'TRUE' || v === 1; }
function parsearListaDir_(valor) {
  if (Array.isArray(valor)) return valor;
  if (!valor) return [];
  try { const l = JSON.parse(valor); return Array.isArray(l) ? l : []; } catch (err) { return []; }
}

function asegurarDirectorioPersonas_(db) {
  const existentes = leerFilas_(db, 'DIRECTORIO_PERSONAS', COLUMNAS.DIRECTORIO_PERSONAS);
  const rutsVistos = new Set();
  const emailsVistos = new Set();
  existentes.forEach((p) => {
    const r = normalizarRutDir_(p.rut);
    if (r) rutsVistos.add(r);
    parsearListaDir_(p.emails).forEach((e) => { const n = normalizarEmailDir_(e); if (n) emailsVistos.add(n); });
  });

  // Índice correo->RUT desde SGC_PERSONAS, para enriquecer las cuentas con su
  // RUT real (CUENTAS_PORTAL no guarda RUT).
  const sgc = leerFilas_(db, 'SGC_PERSONAS', COLUMNAS.SGC_PERSONAS);
  const rutPorEmailSgc = {};
  sgc.forEach((s) => {
    const email = normalizarEmailDir_(s.usuario_email);
    if (email && s.rut && !rutPorEmailSgc[email]) rutPorEmailSgc[email] = s.rut;
  });

  const ahora = new Date().toISOString();
  function insertar_(fila) {
    agregarFila_(db, 'DIRECTORIO_PERSONAS', Object.assign({
      persona_id: crypto.randomUUID(), organizacion_id: ORGANIZACION_POR_DEFECTO_ID,
      nombre: '', rut: '', emails: '[]', cargo_principal: '', empresa_id: '',
      tiene_cuenta: false, activa: true, origen: '', creado_en: ahora, actualizado_en: ahora
    }, fila));
    const r = normalizarRutDir_(fila.rut);
    if (r) rutsVistos.add(r);
    parsearListaDir_(fila.emails).forEach((e) => { const n = normalizarEmailDir_(e); if (n) emailsVistos.add(n); });
  }

  // 1) Cuentas con login: una persona por cuenta (identidad de acá en
  //    adelante). Se enriquece con el RUT de SGC_PERSONAS si alguno de sus
  //    correos hace match. Se siembran activas E inactivas para que los
  //    registros históricos (evaluaciones viejas, etc.) también resuelvan.
  leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL).forEach((c) => {
    const emails = parsearListaDir_(c.emails);
    const normalizados = emails.map(normalizarEmailDir_).filter(Boolean);
    if (!normalizados.length) return;
    if (normalizados.some((e) => emailsVistos.has(e))) return;
    let rut = '';
    for (const e of normalizados) { if (rutPorEmailSgc[e]) { rut = rutPorEmailSgc[e]; break; } }
    if (rut && rutsVistos.has(normalizarRutDir_(rut))) return;
    insertar_({
      organizacion_id: c.organizacion_id || ORGANIZACION_POR_DEFECTO_ID,
      nombre: c.nombre || normalizados[0], rut: rut || '',
      emails: JSON.stringify(emails), cargo_principal: c.cargo || '',
      empresa_id: c.empresa_id || '', tiene_cuenta: true,
      activa: esVerdaderoDir_(c.activo), origen: 'CUENTAS_PORTAL'
    });
  });

  // 2) Personas del SGC SIN cuenta de login (colaboradores externos, etc.):
  //    una por RUT (colapsa el multi-cargo). Si ya se representó por correo
  //    en el paso 1, se omite.
  sgc.forEach((s) => {
    const email = normalizarEmailDir_(s.usuario_email);
    const rut = normalizarRutDir_(s.rut);
    if (email && emailsVistos.has(email)) return;
    if (rut && rutsVistos.has(rut)) return;
    if (!email && !rut) return;
    insertar_({
      nombre: s.nombre || email, rut: s.rut || '',
      emails: email ? JSON.stringify([s.usuario_email]) : '[]',
      cargo_principal: s.cargo || '', empresa_id: '', tiene_cuenta: false,
      activa: esVerdaderoDir_(s.activa), origen: 'SGC_PERSONAS'
    });
  });
}

function asegurarEsquema(db) {
  Object.keys(COLUMNAS).forEach((hoja) => {
    asegurarTabla_(db, hoja, COLUMNAS[hoja]);
    asegurarColumnas_(db, hoja, COLUMNAS[hoja]);
  });
  asegurarOrganizacionPorDefecto_(db);
  asegurarDirectorioPersonas_(db);
}

module.exports = { COLUMNAS, asegurarEsquema, ORGANIZACION_POR_DEFECTO_ID };
