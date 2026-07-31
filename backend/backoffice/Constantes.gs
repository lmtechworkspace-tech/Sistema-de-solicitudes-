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
  NOVEDADES_AUDIENCIA: 'NOVEDADES_AUDIENCIA'
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
  PAUSAS_PROGRAMADAS: [
    'pausa_id', 'empresa_id', 'fecha', 'hora_programada', 'hora_inicio_real',
    'hora_fin', 'coordinador_email', 'estado', 'duracion_min', 'observaciones',
    'ultima_llamada_enviada', 'aviso_coordinador_enviado', 'evidencia_url'
  ],
  // Registro de participacion por trabajador. estado: participo | no_participo.
  PAUSAS_ASISTENCIA: [
    'registro_id', 'pausa_id', 'trabajador_id', 'email', 'fecha_hora_registro',
    'estado', 'motivo', 'comentario', 'confirmacion', 'origen'
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
  NOVEDADES_AUDIENCIA: ['audiencia_id', 'novedad_id', 'destinatario_email']
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
