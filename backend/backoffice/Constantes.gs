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
  HISTORIAL_COMPROMISO: 'HISTORIAL_COMPROMISO',
  // v3.0 (Fase 1, multi-responsable, documentacion/SIGSO-v3.0-multi-
  // responsable-y-control.md §2): catalogo de areas -> responsable, ruteo
  // de cada solicitud a quien corresponde (ya no todo a Leo).
  CAT_AREAS: 'CAT_AREAS',
  // Cartera de clientes de GDE/HomePymes. Ver la nota identica en
  // backend/intake/Constantes.gs.
  CAT_CLIENTES: 'CAT_CLIENTES',
  // v3.1 (documentacion/SIGSO-v3.1-atencion-directa-y-derivacion.md §2.3):
  // rastro de las derivaciones entre responsables. Mismo patron que
  // HISTORIAL_PRIORIDAD/HISTORIAL_COMPROMISO -- reasignar sin registro
  // hacia imposible saber quien movio el trabajo, cuando y por que.
  HISTORIAL_ASIGNACION: 'HISTORIAL_ASIGNACION',
  // v3.3 (documentacion/SIGSO-v3.3-propuesta-plataforma-modular.md §2.4):
  // identidad de la plataforma. La cuenta es la persona; sus correos son un
  // atributo (JSON, puede haber varios) -- eso resuelve el problema de
  // origen: hoy la identidad ES un correo y quien usa dos correos es dos
  // personas para el sistema.
  CUENTAS_PORTAL: 'CUENTAS_PORTAL',
  SESIONES_PORTAL: 'SESIONES_PORTAL',
  // v4.2 (documentacion/SIGSO-v4.2-propuestas-modulo-jefatura.md §1):
  // relacion jefe -> persona a cargo, por correo. Ver la nota identica en
  // backend/intake/Constantes.gs.
  JEFATURAS: 'JEFATURAS',
  // v6.0 (documentacion/SIGSO-v6.0-propuesta-modulo-pausas-activas.md):
  // modulo de Control de Pausas Activas. Todas las hojas son ADITIVAS -- no
  // tocan nada del sistema principal. Ver la nota identica en
  // backend/intake/Constantes.gs.
  PAUSAS_CONFIG: 'PAUSAS_CONFIG',
  PAUSAS_COORDINADORES: 'PAUSAS_COORDINADORES',
  PAUSAS_TRABAJADORES: 'PAUSAS_TRABAJADORES',
  PAUSAS_PROGRAMADAS: 'PAUSAS_PROGRAMADAS',
  PAUSAS_ASISTENCIA: 'PAUSAS_ASISTENCIA',
  PAUSAS_LOG: 'PAUSAS_LOG',
  // v6.4 (foto de perfil): hoja ADITIVA, una fila por identidad. No se
  // tocan USUARIOS ni CUENTAS_PORTAL a proposito: esas dos hojas las lee
  // resolverIdentidadYRol_ en CADA request, y meterles una miniatura en
  // base64 haria que toda llamada del sistema arrastre cientos de KB
  // inutiles. Ver la nota identica en backend/intake/Constantes.gs.
  PERFILES: 'PERFILES',
  // v6.5 (modulo Novedades): dos hojas ADITIVAS. NOVEDADES es el contenido
  // (leyes, dictamenes, procedimientos, avisos, capacitaciones, logros,
  // comercial); NOVEDADES_LECTURAS es el acuse de lectura, aparte para no
  // ensuciar la fila del contenido con una lectura por lector. Ver la nota
  // identica en backend/intake/Constantes.gs.
  NOVEDADES: 'NOVEDADES',
  NOVEDADES_LECTURAS: 'NOVEDADES_LECTURAS',
  // v6.6 (Fase 4, gobierno de la informacion): el hilo de una novedad
  // controlada -- cada transicion de estado (enviada a revision, devuelta,
  // rechazada, aprobada, reenviada) con quien y por que. Ver la nota
  // identica en backend/intake/Constantes.gs.
  NOVEDADES_HISTORIAL: 'NOVEDADES_HISTORIAL',
  // v6.7 (Fase 5, audiencia dirigida): destinatarios explicitos cuando
  // NOVEDADES.audiencia_tipo = 'SELECCION' -- una fila por persona, mismo
  // patron que NOVEDADES_LECTURAS. Ver la nota identica en
  // backend/intake/Constantes.gs.
  NOVEDADES_AUDIENCIA: 'NOVEDADES_AUDIENCIA',
  // v7.0 (documentacion/SIGSO-v7.0-propuesta-modulo-gestion-operacional.md,
  // Fase 1): modulo de Gestion Operacional -- compromisos de trabajo con
  // check-in ligero (§4.2). ACTIVIDADES es una fila por compromiso;
  // ACTIVIDADES_BITACORA es una fila por evento (una sola tabla de
  // historial a proposito, ver la nota identica en backend/intake/Constantes.gs).
  ACTIVIDADES: 'ACTIVIDADES',
  ACTIVIDADES_BITACORA: 'ACTIVIDADES_BITACORA',
  // v7.1 (notificaciones vivas): cola de notificaciones "en vivo" para el
  // personal -- espejo de lo que ya se manda por correo (enviarCorreo_),
  // pero pensado para un toast/modal en pantalla mientras la persona esta
  // trabajando. Ver la nota identica en backend/intake/Constantes.gs.
  NOTIFICACIONES_APP: 'NOTIFICACIONES_APP',
  // v7.3 (notificaciones vivas, Nivel 0): estado del permiso de notificacion
  // del navegador (Notification.permission) reportado por cada dispositivo/
  // sesion -- para que el Admin vea quien nunca acepto el permiso del SO
  // (causa mas probable de "a unos les llega el aviso y a otros no"). Ver
  // la nota identica en backend/intake/Constantes.gs.
  NOTIF_PERMISOS_SO: 'NOTIF_PERMISOS_SO',
  // v9.0 (documentacion/SIGSO-v9.0-propuesta-modulo-gestion-proyectos.md):
  // modulo de Gestion de Proyectos Internos. Decision central de la
  // propuesta: las TAREAS de un proyecto no son una entidad nueva -- son
  // ACTIVIDADES (extendida con proyecto_id/hito_id mas abajo). Estas 4 hojas
  // son el contenedor + la sala de trabajo que faltaban.
  PROYECTOS: 'PROYECTOS',
  PROYECTO_INTEGRANTES: 'PROYECTO_INTEGRANTES',
  PROYECTO_HITOS: 'PROYECTO_HITOS',
  // La sala del proyecto: feed append-only tipado, mismo patron de bitacora
  // unificada que ACTIVIDADES_BITACORA (una tabla, no HISTORIAL_* x N).
  PROYECTO_EVENTOS: 'PROYECTO_EVENTOS',
  // v9.4 (Fase 2/3 de la propuesta): entregables (aprobar/observar) y
  // riesgos. Mismo patron de siempre -- hoja propia, gate por membresia del
  // proyecto (Proyectos.gs).
  PROYECTO_ENTREGABLES: 'PROYECTO_ENTREGABLES',
  PROYECTO_RIESGOS: 'PROYECTO_RIESGOS',
  // v10.0 (documentacion/SIGSO-v10.0-propuesta-modulo-sgc-iso9001.md):
  // modulo SGC ISO 9001. Fase 1 = repositorio documental controlado: los
  // documentos del SGC ya existen en PDF/Word/Excel; lo que faltaba era
  // subirlos con su metadata de control (codigo, version, vigencia) y que
  // cada persona vea SOLO los que le corresponden.
  SGC_DOCUMENTOS: 'SGC_DOCUMENTOS',
  SGC_DOC_VERSIONES: 'SGC_DOC_VERSIONES',
  SGC_DOC_DESTINATARIOS: 'SGC_DOC_DESTINATARIOS',
  SGC_ROLES: 'SGC_ROLES',
  // v10.0 Fase 1b: acuse de recibo del documento controlado. Es la
  // evidencia que ISO 9001 §7.5.3 exige ("la informacion documentada esta
  // disponible y es idonea"): el auditor lo pregunta como "¿como prueba que
  // su personal conoce la politica vigente?".
  SGC_DOC_ACUSES: 'SGC_DOC_ACUSES',
  // v10.0 Fase 2a (PRO-02, gestion de personal): la ficha del trabajador.
  // NO se toca USUARIOS (que es de autenticacion y la usa todo SIGSO) --
  // estos datos son propios del SGC y ademas 6 de las 13 personas en
  // alcance son externas y ni siquiera estan en USUARIOS.
  SGC_PERSONAS: 'SGC_PERSONAS',
  SGC_DESCRIPTORES: 'SGC_DESCRIPTORES',
  SGC_PERSONA_DOCUMENTOS: 'SGC_PERSONA_DOCUMENTOS',
  SGC_INDUCCIONES: 'SGC_INDUCCIONES',
  // v10.0 Fase 2b (PRO-02): monitoreo de competencias y capacitaciones.
  // Es lo que cierra §7.2 de la norma -- no basta con definir el cargo
  // (descriptor), hay que evaluar periodicamente si la persona lo cumple y
  // formarla cuando no.
  SGC_EVALUACIONES: 'SGC_EVALUACIONES',
  SGC_CAPACITACIONES: 'SGC_CAPACITACIONES',
  SGC_CAPACITACION_ASISTENTES: 'SGC_CAPACITACION_ASISTENTES',
  // v10.0 Fase 3a (PRO-06): no conformidades y acciones correctivas. Es el
  // motor de mejora del SGC y lo que la auditoria de certificacion revisa
  // con mas profundidad (§10.2 de la norma).
  SGC_NC: 'SGC_NC',
  // v10.0 Fase 3b (PRO-03): auditoria interna (§9.2). Es la otra mitad del
  // motor de mejora: el mecanismo por el que la organizacion se encuentra
  // sus propios problemas antes de que se los encuentre el auditor.
  SGC_AUDITORIAS: 'SGC_AUDITORIAS',
  SGC_AUD_HALLAZGOS: 'SGC_AUD_HALLAZGOS',
  // v10.0 Fase 4 (PRO-07): quejas, felicitaciones y consultas. Entra por el
  // Intake (formulario publico, sin cuenta) y se gestiona en el Backoffice.
  SGC_QUEJAS: 'SGC_QUEJAS'
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
  ],
  // v3.0 (Fase 1): ver la nota identica en backend/intake/Constantes.gs.
  CAT_AREAS: ['area_id', 'nombre', 'responsable_email', 'activo'],
  // Cartera de clientes GDE/HomePymes. Ver la nota identica en
  // backend/intake/Constantes.gs.
  CAT_CLIENTES: [
    'cliente_id', 'razon_social', 'rut', 'codigo_cliente', 'contacto',
    'correo', 'telefono', 'representante_legal', 'direccion',
    'estado', 'bloqueo', 'activo'
  ],
  // v3.1 (§2.3): ver la nota identica en backend/intake/Constantes.gs.
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
  // v4.2 (§1): ver la nota identica en backend/intake/Constantes.gs.
  JEFATURAS: ['jefatura_id', 'jefe_email', 'subordinado_email', 'activo'],
  // v6.0 (modulo de Pausas Activas). Ver la nota identica en
  // backend/intake/Constantes.gs. Todas aditivas.
  // Config por empresa: hora/dias/duracion/umbrales del semaforo, editables
  // por el Admin (dias_semana = CSV de 1..5, min_anticipacion del recordatorio).
  PAUSAS_CONFIG: [
    'empresa_id', 'hora_habitual', 'dias_semana', 'duracion_min',
    'min_anticipacion', 'umbral_verde', 'umbral_amarillo', 'activo'
  ],
  // Coordinadores (prevencionistas). tipo = 'titular' | 'reemplazo'.
  PAUSAS_COORDINADORES: ['coord_id', 'empresa_id', 'nombre', 'email', 'tipo', 'activo'],
  // Roster de trabajadores para pausas (se siembra desde CUENTAS_PORTAL/
  // USUARIOS pero es su propia lista, con area/cargo que pausas necesita).
  PAUSAS_TRABAJADORES: [
    'trabajador_id', 'empresa_id', 'nombre', 'email', 'area', 'cargo',
    'activo', 'fecha_ingreso'
  ],
  // Cada pausa programada + su ejecucion. estado: Programada, Recordatorio_enviado,
  // En_curso, Realizada, Cerrada, Suspendida, No_realizada, Cancelada.
  // ultima_llamada_enviada / aviso_coordinador_enviado (mejora v6.0): flags
  // del segundo aviso -- evitan reenviar el "ultima llamada" a los
  // trabajadores o el aviso de inicio a la coordinadora mas de una vez por
  // pausa (ver Pausas.enviarSegundosAvisosPausas).
  // evidencia_url (mejora v6.0 #4): foto/evidencia de la charla que la
  // coordinadora puede adjuntar al finalizar (Drive, mismo patron que los
  // adjuntos de Solicitudes).
  // v7.2 (Bloque A, mejora A8 "resiliencia del coordinador"): escalada_admin_
  // enviada evita reenviar mas de una vez el aviso a Administracion cuando
  // NINGUN coordinador (titular ni reemplazo) inicio la pausa pasado un
  // margen de la hora programada (ver Pausas.escalarPausasSinIniciar).
  PAUSAS_PROGRAMADAS: [
    'pausa_id', 'empresa_id', 'fecha', 'hora_programada', 'hora_inicio_real',
    'hora_fin', 'coordinador_email', 'estado', 'duracion_min', 'observaciones',
    'ultima_llamada_enviada', 'aviso_coordinador_enviado', 'evidencia_url',
    'escalada_admin_enviada'
  ],
  // Registro de participacion por trabajador. estado: participo | no_participo.
  // v7.2 (Bloque A, mejora A6): 'animo' es la micro-encuesta de bienestar
  // OPCIONAL (1..5) que el trabajador puede dejar al registrar su
  // participacion -- nunca se muestra por persona (RN-708), solo agregada
  // (promedio por area/empresa) en los reportes de coordinador/gerencia.
  // 'origen' ya distinguia autoservicio de otros canales; ahora tambien
  // puede valer 'pasada_lista' (A1, el coordinador la registro por el).
  PAUSAS_ASISTENCIA: [
    'registro_id', 'pausa_id', 'trabajador_id', 'email', 'fecha_hora_registro',
    'estado', 'motivo', 'comentario', 'confirmacion', 'origen', 'animo'
  ],
  // Auditoria del modulo de pausas.
  PAUSAS_LOG: ['log_id', 'timestamp', 'pausa_id', 'usuario', 'accion', 'detalle'],
  // v6.4 (foto de perfil). Clave compuesta identidad_tipo + identidad_clave:
  // el sistema tiene DOS poblaciones de identidad que no comparten llave
  // (USUARIOS se busca por email; CUENTAS_PORTAL por cuenta_id), asi que una
  // sola columna "usuario" no alcanzaria.
  //   - foto_file_id: ID del ORIGINAL en Drive (privado, carpeta Perfiles/).
  //     Referencia estable: no es una URL publica que pueda romperse.
  //   - foto_thumb: miniatura cuadrada ~160px como data URI base64. Es lo que
  //     RENDERIZA la interfaz. Existe porque la URL de vista de Drive no se
  //     puede usar en un <img> sin hacer el archivo publico -- y las fotos de
  //     personas no deben quedar accesibles para cualquiera con el enlace.
  PERFILES: [
    'perfil_id', 'identidad_tipo', 'identidad_clave',
    'foto_file_id', 'foto_thumb', 'foto_mime', 'actualizado_en'
  ],
  // v6.5 (modulo Novedades). area_id/area_nombre son ETIQUETA, no audiencia:
  // SIGSO no modela "a que area pertenece cada persona" (CAT_AREAS solo
  // guarda quien es el RESPONSABLE de cada area), asi que no hay forma
  // confiable de calcular "esto te afecta a ti" para un lector cualquiera.
  // Por eso el area sirve para filtrar/mostrar, no para restringir quien ve
  // que -- todo publicado es visible para todo el que entra a la plataforma.
  // requiere_acuse: si exige el boton "Enterado" (ver NOVEDADES_LECTURAS).
  // fecha_vigencia: cuando entra a regir (leyes/normativas); vacia si no aplica.
  // archivo_*: adjunto opcional (hoy solo PDF), original privado en Drive
  // (carpeta SIGSO_Novedades/), descargable via accion dedicada -- igual
  // patron que el original de la foto de perfil.
  // v6.6 (Fase 4): estado agrega el carril de aprobacion. EN_REVISION es lo
  // primero que existe para un tipo CONTROLADO (nunca hay un "borrador"
  // separado -- redactar y enviar a revision es un solo paso, igual que
  // crear una solicitud). fecha_creacion es SIEMPRE al crear (a diferencia
  // de fecha_publicacion, que queda vacia hasta que se aprueba/publica).
  // v6.7 (Fase 5): audiencia_tipo en {TODOS, MI_EQUIPO, SELECCION}. Vacio se
  // trata como TODOS (compatibilidad con novedades publicadas antes de esta
  // fase). Quien la define: el AUTOR al publicar (carril LIBRE) o el
  // APROBADOR al aprobar (carril CONTROLADO) -- ver Novedades.gs.
  // v6.8 (Fase 6, cumplimiento): fecha_limite_acuse -- plazo para confirmar
  // "Enterado". Obligatoria al aprobar Ley/Dictamen (lo unico con vigencia
  // legal que corre), opcional en el resto. Vacia = sin plazo (no entra al
  // panel de cumplimiento). Ver la nota identica en backend/intake/Constantes.gs.
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
  // Acuse de lectura, una fila por (novedad, lector). Aparte de NOVEDADES
  // para no mezclar el contenido (una fila) con N lecturas.
  NOVEDADES_LECTURAS: ['lectura_id', 'novedad_id', 'usuario_email', 'leido_en'],
  // v6.6 (Fase 4): un evento por transicion. evento en
  // {ENVIADA_REVISION, DEVUELTA, RECHAZADA, APROBADA}. autor_email/nombre es
  // quien HIZO la accion (el redactor al reenviar, la jefatura al
  // aprobar/devolver/rechazar) -- no confundir con el autor de la novedad.
  NOVEDADES_HISTORIAL: ['historial_id', 'novedad_id', 'evento', 'autor_email', 'autor_nombre', 'comentario', 'timestamp'],
  // v6.7 (Fase 5): una fila por destinatario elegido a mano (solo cuando
  // audiencia_tipo = 'SELECCION'). MI_EQUIPO no guarda filas aqui -- se
  // resuelve dinamicamente contra JEFATURAS para que quede al dia si el
  // equipo cambia despues de publicada.
  NOVEDADES_AUDIENCIA: ['audiencia_id', 'novedad_id', 'destinatario_email'],
  // v7.0 (Fase 1, §4.2 de la propuesta): ver la nota identica en
  // backend/intake/Constantes.gs sobre cada campo.
  ACTIVIDADES: [
    'actividad_id', 'titulo', 'descripcion', 'origen', 'solicitud_id',
    'responsable_email', 'responsable_nombre', 'supervisor_email',
    'area_id', 'cliente_id', 'proyecto', 'prioridad', 'estado', 'tamano',
    'fecha_propuesta', 'fecha_compromiso', 'confirmada_en', 'requiere_validacion',
    'recurrencia', 'recurrencia_origen_id', 'fecha_inicio_plan', 'fecha_terminada',
    'confianza', 'avance_pct', 'bloqueo_motivo', 'bloqueo_responsable_email',
    'bloqueo_desde', 'ultima_actualizacion', 'reprogramaciones',
    'fecha_creacion', 'creado_por', 'activa',
    // v9.0 (Modulo de Proyectos): aditivas al final, mismo criterio que
    // 'cc' en SOLICITUDES -- no rompe el orden ya desplegado. Una actividad
    // sin proyecto_id sigue siendo una actividad suelta de "Mi trabajo",
    // exactamente igual que antes (cero regresion). proyecto_id/hito_id
    // vinculan la tarea a PROYECTOS/PROYECTO_HITOS; el motor de estados,
    // check-in, bloqueo, etc. no cambia en absoluto.
    'proyecto_id', 'hito_id',
    // v9.4 (Fase 2 de la propuesta): dependencia opcional tarea<->tarea,
    // solo dentro de un mismo proyecto. Es aditiva e informativa -- NO
    // bloquea ni cambia fechas de nada: Proyectos.listarTareas la usa para
    // marcar "potencialmente comprometida" cuando la tarea de la que se
    // depende esta atrasada (bandera derivada, ver §I de la propuesta:
    // "nada mueve fechas ni cierra cosas solo").
    'depende_de',
    // v10.0 Fase 3a (SGC): de que cosa del SGC nacio esta actividad.
    // sgc_origen_tipo: NC_CORRECCION | NC_ACCION (mas adelante tambien
    // acuerdos de revision por la direccion y tareas de auditoria).
    // sgc_origen_id: el id de esa NC.
    // Aditivas: una actividad normal de "Mi trabajo" las deja vacias y se
    // comporta exactamente igual que antes.
    'sgc_origen_tipo', 'sgc_origen_id'
  ],
  ACTIVIDADES_BITACORA: [
    'bitacora_id', 'actividad_id', 'tipo', 'autor_email', 'autor_nombre',
    'nota', 'avance_pct', 'confianza', 'datos', 'timestamp'
  ],
  // v7.1 (notificaciones vivas): ver la nota identica en
  // backend/intake/Constantes.gs sobre cada campo.
  NOTIFICACIONES_APP: [
    'notif_id', 'destinatario_email', 'tipo', 'titulo', 'mensaje',
    'modulo_id', 'texto_accion', 'leida', 'creada_en', 'expira_en'
  ],
  // v7.3 (Nivel 0): permiso: 'granted' | 'denied' | 'default'. Una fila por
  // email (upsert) -- no es historico, es el ULTIMO estado reportado.
  NOTIF_PERMISOS_SO: ['email', 'permiso', 'actualizado_en'],

  // v9.0 (Modulo de Proyectos, MVP Fase 1) ------------------------------
  // estado: PLANIFICACION | ACTIVO | EN_PAUSA | EN_REVISION | CERRADO |
  // CANCELADO (mayusculas, igual criterio que ACTIVIDADES_ESTADOS).
  // salud_override: normalmente vacio -- la salud se CALCULA on-read
  // (Proyectos.gs); solo un ADM/lider puede fijarla a mano de forma
  // excepcional, con motivo registrado en PROYECTO_EVENTOS.
  PROYECTOS: [
    'proyecto_id', 'codigo', 'nombre', 'descripcion', 'objetivo',
    'resultado_esperado', 'lider_email', 'area_id', 'cliente_id',
    'categoria', 'prioridad', 'estado',
    'fecha_inicio', 'fecha_objetivo', 'fecha_cierre_real',
    'salud_override', 'salud_override_motivo',
    'ultima_actualizacion', 'creado_por', 'fecha_creacion', 'activa'
  ],
  // rol_proyecto: LIDER | INTEGRANTE | COLABORADOR | OBSERVADOR (§6 de la
  // propuesta). La membresia es el "gate fino" de todo el modulo -- igual
  // patron que JEFATURAS para Actividades.
  PROYECTO_INTEGRANTES: [
    'integrante_id', 'proyecto_id', 'usuario_email', 'usuario_nombre',
    'rol_proyecto', 'responsabilidad', 'activo', 'agregado_por', 'fecha_creacion'
  ],
  PROYECTO_HITOS: [
    'hito_id', 'proyecto_id', 'nombre', 'descripcion', 'fecha_objetivo',
    'estado', 'orden', 'fecha_creacion'
  ],
  // La sala: feed append-only tipado. tipo: ACTUALIZACION | COMENTARIO |
  // DECISION | REUNION | BLOQUEO | SOLICITUD_LIDER | CAMBIO_ESTADO.
  // ref_tipo/ref_id enlazan el evento a una tarea/hito cuando corresponde
  // (p.ej. "convertir comentario en tarea" guarda ref_tipo='ACTIVIDAD').
  PROYECTO_EVENTOS: [
    'evento_id', 'proyecto_id', 'tipo', 'autor_email', 'autor_nombre',
    'titulo', 'cuerpo', 'ref_tipo', 'ref_id', 'menciones', 'timestamp'
  ],
  // v9.4 (Fase 2 de la propuesta): entregables con flujo aprobar/observar.
  // estado: PENDIENTE | ENTREGADO | EN_REVISION | APROBADO | OBSERVADO.
  // Un entregable OBSERVADO vuelve a PENDIENTE (no hay estado "rechazado"
  // final) para que el responsable pueda reintentar -- mismo espiritu que
  // "devolver con motivo" del resto de SIGSO.
  PROYECTO_ENTREGABLES: [
    'entregable_id', 'proyecto_id', 'hito_id', 'nombre', 'descripcion',
    'responsable_email', 'fecha_comprometida', 'estado', 'url_evidencia',
    'fecha_entrega_real', 'revisado_por', 'resultado_revision',
    'observaciones', 'fecha_creacion'
  ],
  // v9.4 (Fase 3 de la propuesta): registro de riesgos. nivel se deriva de
  // probabilidad x impacto (ALTA/MEDIA/BAJA), lo calcula Proyectos.gs, no
  // se pide a mano -- evita que quede desalineado del cruce real.
  PROYECTO_RIESGOS: [
    'riesgo_id', 'proyecto_id', 'descripcion', 'probabilidad', 'impacto',
    'nivel', 'responsable_email', 'mitigacion', 'estado', 'fecha_creacion'
  ],

  // v10.0 (Modulo SGC ISO 9001, Fase 1) ---------------------------------
  // El documento controlado. El ARCHIVO vigente vive en Drive
  // (archivo_id/nombre/mime, mismo patron que el adjunto de NOVEDADES); el
  // historial completo de archivos anteriores vive en SGC_DOC_VERSIONES.
  //
  // tipo: DOC (maestros) | PRO (procedimientos) | INS (instructivos) |
  //       FO (formularios) | EXTERNO (normas, leyes, decretos).
  // estado: VIGENTE | OBSOLETO. Un documento obsoleto NO se borra --
  //   PRO-01 pide retirarlo de circulacion, pero ISO exige trazabilidad,
  //   asi que se archiva (§4.3 de la propuesta v10.0).
  // visibilidad: TODOS | AREA | SELECCION -- refleja la matriz de
  //   responsabilidades del SGC ("documentos maestros: todo el personal;
  //   procedimientos: personal segun area; formularios: segun formulario").
  //   Mismo criterio que audiencia_tipo en NOVEDADES.
  // proxima_revision: fecha_vigencia + 12 meses (PRO-01 exige revision
  //   periodica anual). Se calcula al guardar, no se pide a mano.
  SGC_DOCUMENTOS: [
    'documento_id', 'codigo', 'nombre', 'descripcion', 'tipo', 'area_id',
    'version_vigente', 'estado', 'visibilidad',
    'fecha_vigencia', 'proxima_revision',
    'elaborado_por', 'revisado_por', 'aprobado_por',
    'archivo_id', 'archivo_nombre', 'archivo_mime',
    'creado_por', 'fecha_creacion', 'activa',
    // v10.0 Fase 1b: aditivas al final (mismo criterio de siempre).
    // requiere_acuse: si el personal debe confirmar que lo conoce.
    // fecha_limite_acuse: plazo para confirmarlo (opcional).
    'requiere_acuse', 'fecha_limite_acuse'
  ],
  // Append-only: una fila por version subida. La vigente tambien queda
  // aqui (vigente=true), asi el historial es completo y auditable sin
  // tener que reconstruirlo desde SGC_DOCUMENTOS.
  SGC_DOC_VERSIONES: [
    'version_id', 'documento_id', 'version', 'cambios',
    'archivo_id', 'archivo_nombre', 'archivo_mime',
    'subido_por', 'fecha', 'vigente'
  ],
  // Solo se usa cuando visibilidad = SELECCION. Una fila por persona,
  // mismo patron que NOVEDADES_DESTINATARIOS.
  SGC_DOC_DESTINATARIOS: ['destinatario_id', 'documento_id', 'usuario_email'],
  // Gate FINO del modulo (el grueso es el modulo 'calidad' en
  // MODULO_POR_ACCION). Mismo patron que PROYECTO_INTEGRANTES: el rol es
  // DENTRO del modulo, no un rol global nuevo -- no se tocan los roles de
  // SIGSO (ADM/GERENCIA/JEFATURA/...).
  // rol_sgc: ENCARGADO_SGC | DIRECCION | GERENCIA_ADM | JEFATURA_AREA |
  //          ENC_ADMIN | OPERATIVO | AUDITOR_EXTERNO.
  // vigencia_hasta: para el AUDITOR_EXTERNO -- acceso temporal que expira
  //   solo, sin depender de acordarse de desactivarlo.
  SGC_ROLES: [
    'rol_id', 'usuario_email', 'rol_sgc', 'area_id',
    'vigencia_hasta', 'activo', 'fecha_creacion'
  ],
  // v10.0 Fase 1b: una fila por persona Y VERSION. Guardar la version es lo
  // que hace que el acuse sea evidencia real: si el Manual pasa a v02, el
  // acuse de la v01 ya no vale y todos deben confirmar la nueva. Sin esa
  // columna, "confirmado" significaria "confirmo algo alguna vez".
  SGC_DOC_ACUSES: ['acuse_id', 'documento_id', 'version', 'usuario_email', 'acusado_en'],

  // v10.0 Fase 2a (PRO-02) ------------------------------------------------
  // La ficha del trabajador dentro del SGC.
  // tipo: INT (interno) | EXT (externo) -- 6 de las 13 personas en alcance
  //   son externas, y para el SGC cuentan igual.
  // estado: ACTIVO | DESVINCULADO. Una persona desvinculada NO se borra
  //   (la especificacion lo pide explicitamente): sus inducciones,
  //   evaluaciones y capacitaciones son historia que el auditor puede
  //   pedir. Se marca con fecha de salida y deja de aparecer por defecto.
  // jefatura_email: puede diferir de JEFATURAS (que es la jerarquia
  //   operativa); si no se indica, se toma de ahi como valor por defecto.
  SGC_PERSONAS: [
    'persona_id', 'usuario_email', 'nombre', 'rut', 'cargo', 'tipo',
    'area_id', 'jefatura_email', 'subrogante_email',
    'fecha_ingreso', 'estado', 'fecha_desvinculacion',
    'creado_por', 'fecha_creacion', 'activa'
  ],
  // Descriptor de cargo (FO-PRO-02-01), versionado: cada actualizacion crea
  // una fila nueva y la anterior queda vigente=false. Mismo criterio que
  // SGC_DOC_VERSIONES -- poder demostrar que descriptor regia y cuando.
  // v10.0 Tanda A (fidelidad con FO-PRO-02-01 real): 'responsabilidades' y
  // 'habilidades' siguen siendo el texto libre del descriptor (para mostrarlo
  // tal como esta en el documento aprobado). 'items_responsabilidades' e
  // 'items_habilidades' son ADEMAS listas discretas (JSON de strings) porque
  // el FO-PRO-02-04 evalua "segun descriptor de cargo": cada responsabilidad
  // y cada habilidad del cargo se califica una por una. Sin esta lista, la
  // evaluacion tendria que inventar items genericos que no corresponden al
  // cargo real de la persona.
  SGC_DESCRIPTORES: [
    'descriptor_id', 'persona_id', 'version', 'objetivo', 'funciones',
    'responsabilidades', 'habilidades',
    'items_responsabilidades', 'items_habilidades',
    'nivel_educacional', 'formacion_tecnica', 'experiencia',
    'archivo_id', 'archivo_nombre', 'archivo_mime',
    'vigente', 'creado_por', 'fecha'
  ],
  // Carpeta digital de la persona (CV, titulo, contrato, certificados...).
  // tipo: CV | TITULO | ISO9001 | CONTRATO | CERTIFICADO | OTRO.
  SGC_PERSONA_DOCUMENTOS: [
    'doc_id', 'persona_id', 'tipo', 'nombre',
    'archivo_id', 'archivo_nombre', 'archivo_mime',
    'subido_por', 'fecha', 'activa'
  ],
  // Registro de induccion (FO-PRO-02-02): los 5 items del SGC, una fila por
  // item y persona. estado: PENDIENTE | COMPLETADA.
  SGC_INDUCCIONES: [
    'induccion_id', 'persona_id', 'item', 'fecha', 'relator_email',
    'estado', 'observaciones'
  ],

  // v10.0 Fase 2b (PRO-02) ------------------------------------------------
  // Monitoreo de competencias (FO-PRO-02-04). v10.0 Tanda A: el formulario
  // real tiene DOS bloques calificados por separado ("2.- Calificacion de
  // principales responsabilidades" y "3.- Calificacion de responsabilidades
  // secundarias/habilidades"), cada uno con su propio promedio (§4.-
  // Resultados). Los items salen del descriptor vigente de la persona, y su
  // cantidad varia por cargo -- por eso los puntajes se guardan como JSON
  // [{item, valor}] en vez de columnas r1..r4/h1..h4 fijas.
  // Escala real (no generica 1-4): 1 No cumple, 2 Cumple en algunas
  // ocasiones, 3 Cumple en la mayoria de los casos, 4 Cumple en su totalidad.
  // requiere_capacitacion se deriva: EFICAZ si CUALQUIERA de los dos
  // promedios cae bajo el umbral (un area debil ya amerita formacion,
  // aunque la otra vaya bien).
  // proxima_evaluacion: fecha + 12 meses (la norma pide seguimiento
  // periodico; la especificacion fija 12 meses).
  SGC_EVALUACIONES: [
    'evaluacion_id', 'persona_id', 'descriptor_id', 'fecha', 'evaluador_email',
    'respuestas_responsabilidades', 'respuestas_habilidades',
    'promedio_responsabilidades', 'promedio_habilidades',
    'requiere_capacitacion', 'observaciones', 'recomendado_por',
    'proxima_evaluacion'
  ],
  // Programa anual (FO-PRO-02-03) y registro de lo realizado
  // (FO-PRO-02-05) en UNA sola hoja: una capacitacion nace PROGRAMADA y
  // pasa a REALIZADA. Separarlas en dos tablas obligaria a copiar la fila
  // y perderia el vinculo entre lo planificado y lo hecho.
  SGC_CAPACITACIONES: [
    'capacitacion_id', 'nombre', 'descripcion', 'horas',
    'fecha_programada', 'fecha_realizada', 'relator', 'estado',
    'creado_por', 'fecha_creacion', 'activa'
  ],
  // Quien participo. asistio permite convocar a varias personas y despues
  // registrar quien fue realmente -- las horas del ano solo cuentan a
  // quienes asistieron.
  // v10.0 Tanda A: la eficacia (FO-PRO-02-05 §2, columna "Eficacia de la
  // capacitacion (60 dias despues)") es POR PARTICIPANTE, no por curso --
  // dos personas en el mismo curso pueden tener resultados distintos. Se
  // movio de SGC_CAPACITACIONES (nivel curso) a esta fila (nivel persona).
  SGC_CAPACITACION_ASISTENTES: [
    'asistencia_id', 'capacitacion_id', 'persona_id', 'asistio', 'fecha',
    'eficacia_fecha', 'eficacia_resultado', 'eficacia_observaciones'
  ],

  // v10.0 Fase 3a (PRO-06) ------------------------------------------------
  // UNA fila = UN formulario FO-PRO-06-01 completo, con sus 4 fases. Se
  // mantiene en una sola tabla a proposito: es como esta el formulario en
  // papel, y partirlo en 4 obligaria a reconstruir el ciclo con joins para
  // responder la pregunta que el auditor hace siempre ("muestreme una NC de
  // punta a punta").
  //
  // fuente: AUDITORIA_INTERNA | AUDITORIA_EXTERNA | QUEJA |
  //         REVISION_DIRECCION | PROCESO | OTRO.
  // origen_ref: id del hallazgo/queja que la origino (Fases 3b y 4), para
  //   la vinculacion bidireccional que pide la especificacion.
  // estado: ABIERTA | EN_CORRECCION | EN_ACCION | EN_VERIFICACION |
  //         CERRADA | ANULADA.
  //
  // correccion_actividad_id / accion_actividad_id: LA DECISION CENTRAL de
  //   esta fase. La correccion y la accion correctiva NO son campos de
  //   texto con una fecha: son ACTIVIDADES reales (motor v7.0), y aca solo
  //   se guarda su id. Asi el responsable las ve en "Mi trabajo" junto a
  //   todo lo demas, con check-in, semaforo y alertas -- sin aprender un
  //   flujo nuevo ni entrar a "el modulo ISO".
  //
  // Los plazos (10 / 20 / 60) son DIAS HABILES, como exige PRO-06.
  // ciclo: si la eficacia sale negativa la NC se reabre y arranca un ciclo
  //   nuevo; el numero permite distinguirlos sin perder el anterior.
  // referencia_normativa: campo del FO-PRO-06-01 real ("1.- Generalidades")
  // y lo que pide el resumen del informe de auditoria (FO-PRO-03-02,
  // columna "Punto normativo"). Cuando la NC nace de un hallazgo de
  // auditoria se autocompleta con la clausula del hallazgo (Auditorias.gs);
  // en una NC manual queda a criterio de quien la crea.
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

  // v10.0 Fase 3b (PRO-03) ------------------------------------------------
  // UNA fila = UNA auditoria, desde que se programa en el plan anual hasta
  // que se emite el informe. Las tres etapas (programa / plan / informe)
  // viven juntas porque son el mismo evento visto en tres momentos: el
  // auditor pregunta "muestreme la auditoria de RRHH de marzo", no
  // "muestreme el programa" y aparte "el informe".
  //
  // estado: PROGRAMADA (esta en el plan anual) | PLANIFICADA (ya tiene
  //   objetivo, alcance y fecha comunicada) | EJECUTADA (se realizo, corre
  //   el plazo del informe) | INFORMADA (informe emitido) | CERRADA |
  //   ANULADA.
  //
  // clausulas: JSON con las clausulas ISO en alcance (ver CLAUSULAS_ISO9001
  //   en Auditorias.gs). Se guarda serializado porque es una lista corta que
  //   solo se lee completa; una tabla puente aqui seria costo sin uso.
  //
  // fecha_plan: cuando se COMUNICO el plan. PRO-03 pide 5 dias habiles de
  //   anticipacion; el sistema no bloquea si son menos (bloquear empujaria
  //   a falsear fechas), pero deja el dato visible para que el auditor
  //   pueda verlo tal como paso.
  //
  // informe_plazo: 10 dias habiles desde la ejecucion, como pide PRO-03.
  //
  // v10.0 Tanda A (fidelidad con FO-PRO-03-01/02 reales):
  //   coauditores: PRO-03 habla de "equipo auditor" (plural). auditor_email
  //     sigue siendo el auditor LIDER (responsable, permisos); coauditores
  //     es el resto del equipo -- JSON de emails, con el mismo control de
  //     conflicto de interes que el lider.
  //   personas_entrevistadas: el informe (FO-PRO-03-02) trae una seccion
  //     "Personas entrevistadas - Cargo". JSON de strings "Nombre - Cargo",
  //     se completa al emitir el informe (es lo que efectivamente paso
  //     durante la ejecucion, no algo planificable de antemano).
  SGC_AUDITORIAS: [
    'auditoria_id', 'correlativo', 'anio', 'area_id', 'proceso', 'clausulas',
    'auditor_email', 'coauditores', 'auditados', 'objetivo', 'alcance', 'criterios',
    'fecha_programada', 'fecha_plan', 'fecha_ejecucion',
    'estado',
    'informe_plazo', 'informe_fecha', 'informe_conclusion', 'personas_entrevistadas',
    'fecha_cierre', 'cerrada_por', 'creada_por', 'fecha_creacion', 'activa'
  ],

  // La lista de verificacion Y los hallazgos son la MISMA tabla: cada fila
  // es "se reviso tal clausula y esto se encontro". Separarlas obligaria a
  // duplicar la clausula y el aspecto revisado en dos lados, y dejaria sin
  // respuesta la pregunta que el auditor si hace: "¿revisaron 7.2? ¿que
  // vieron?" -- una clausula revisada y CONFORME es evidencia, no un vacio.
  //
  // resultado: CONFORME | OBSERVACION | NO_CONFORMIDAD | OPORTUNIDAD.
  // nc_id: se llena cuando el hallazgo se convierte en no conformidad
  //   (§10.2). Es el eslabon de la cadena auditoria -> NC -> actividad.
  SGC_AUD_HALLAZGOS: [
    'hallazgo_id', 'auditoria_id', 'clausula', 'aspecto_verificado',
    'evidencia', 'resultado', 'descripcion', 'nc_id',
    'registrado_por', 'fecha_registro', 'activo'
  ],

  // v10.0 Fase 4 (PRO-07) ---------------------------------------------------
  // UNA fila = UN formulario FO-PRO-07-01 completo, con sus 5 partes. Mismo
  // criterio que SGC_NC y SGC_AUDITORIAS: partirlo en varias tablas
  // obligaria a reconstruir el caso con joins para responder la pregunta
  // que siempre se hace ("muestreme esta queja de punta a punta").
  //
  // PARTE 1 (la llena el reclamante, sin cuenta, desde el Intake):
  //   nombre_completo, empresa, rut, email, telefono, tipo, area,
  //   descripcion, canal, fecha_envio.
  // tipo: QUEJA | RECLAMACION | FELICITACION | CONSULTA.
  // area: RRHH | CONTABILIDAD | PREVENCION | MARKETING | ADMINISTRACION |
  //       OTRO -- mismo desglose que el formulario web real.
  // canal: WEB | CORREO | TELEFONO | ENCUESTA.
  //
  // PARTE 2 (la completa el Responsable SGC al recibirla):
  //   fecha_recepcion, procede, motivo_no_procede, registrado_por.
  // procede: si el reclamo esta dentro del plazo vigente (servicio activo
  //   o hasta 30 dias corridos post-termino, y no suspendido por falta de
  //   pago). Es un juicio del Responsable SGC -- SIGSO no tiene el dato de
  //   si el servicio esta suspendido, asi que no se puede derivar solo.
  //
  // PARTE 3 (investigacion):
  //   investigador_email, resultado_investigacion, valida.
  // El investigador NO puede ser de la misma area que origino el reclamo
  // (mismo principio de imparcialidad que en auditoria interna, §9.2.2,
  // aplicado aca por PRO-07 §6.2: "no hayan participado en las actividades
  // que dieron origen a la queja").
  //
  // PARTE 4 (resolucion, plazo 30 dias CORRIDOS desde que se valida):
  //   accion_implementada, nc_id, fecha_resolucion, responsable_resolucion.
  // nc_id: si la resolucion requirio abrir una no conformidad (Fase 3a),
  //   igual patron que el hallazgo de auditoria -> NC.
  //
  // PARTE 5 (notificacion y seguimiento, 30 dias CORRIDOS post-respuesta):
  //   fecha_notificacion, revisado_por, fecha_seguimiento, cliente_conforme.
  //
  // estado: RECIBIDA | NO_PROCEDE | EN_INVESTIGACION | NO_VALIDA |
  //         EN_RESOLUCION | NOTIFICADA | CERRADA | REABIERTA | ANULADA.
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
