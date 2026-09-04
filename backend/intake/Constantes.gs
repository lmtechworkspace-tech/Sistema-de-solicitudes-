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
  ARCHIVOS: 'ARCHIVOS',
  // v2.1 (Fase A, compromiso de fechas): ver la nota identica en
  // backend/backoffice/Constantes.gs.
  HISTORIAL_COMPROMISO: 'HISTORIAL_COMPROMISO',
  // v3.0 (Fase 1, multi-responsable): catalogo de areas -> responsable.
  // Ver la nota identica en backend/backoffice/Constantes.gs.
  CAT_AREAS: 'CAT_AREAS',
  // Cartera de clientes de GDE/HomePymes (comparten la misma). El formulario
  // publico la usa para buscar y autocompletar los datos del cliente en vez
  // de escribirlos a mano. Aditiva; si la hoja no existe, getClientes
  // devuelve [] y el formulario cae al modo manual.
  CAT_CLIENTES: 'CAT_CLIENTES',
  // v3.1 (documentacion/SIGSO-v3.1-atencion-directa-y-derivacion.md §2.3):
  // rastro de las derivaciones entre responsables. Mismo patron que
  // HISTORIAL_PRIORIDAD/HISTORIAL_COMPROMISO -- reasignar sin registro
  // hacia imposible saber quien movio el trabajo, cuando y por que. La
  // escribe solo el Backoffice; se declara aqui para que las tres copias
  // del esquema no diverjan (schema-consistency.test.js).
  HISTORIAL_ASIGNACION: 'HISTORIAL_ASIGNACION',
  // v3.3 (documentacion/SIGSO-v3.3-propuesta-plataforma-modular.md §2.4):
  // identidad de la plataforma. La cuenta es la persona; sus correos son un
  // atributo (JSON, puede haber varios) -- eso resuelve el problema de
  // origen: hoy la identidad ES un correo y quien usa dos correos es dos
  // personas para el sistema.
  CUENTAS_PORTAL: 'CUENTAS_PORTAL',
  SESIONES_PORTAL: 'SESIONES_PORTAL',
  // v4.2 (documentacion/SIGSO-v4.2-propuestas-modulo-jefatura.md §1):
  // relacion jefe -> persona a cargo, por correo (no por cuenta): asi
  // funciona aunque el subordinado nunca haya entrado a la plataforma,
  // solo mandado solicitudes. Muchos-a-muchos (una persona puede tener mas
  // de un jefe). La escribe solo el Backoffice (administracion); se
  // declara aqui para que las tres copias del esquema no diverjan
  // (schema-consistency.test.js), mismo criterio que HISTORIAL_ASIGNACION.
  JEFATURAS: 'JEFATURAS',
  // v6.0 (documentacion/SIGSO-v6.0-propuesta-modulo-pausas-activas.md):
  // modulo de Control de Pausas Activas. Todas aditivas -- las escribe solo
  // el Backoffice; se declaran aqui para que las tres copias del esquema no
  // diverjan (schema-consistency.test.js).
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
  // inutiles. La feature vive en el Backoffice (Perfiles.gs); Intake
  // mantiene la copia solo para que el esquema no diverja.
  PERFILES: 'PERFILES',
  // v6.5 (modulo Novedades): vive en el Backoffice (Novedades.gs); Intake
  // mantiene la copia solo para que el esquema no diverja. Ver la nota
  // identica en backend/backoffice/Constantes.gs.
  NOVEDADES: 'NOVEDADES',
  NOVEDADES_LECTURAS: 'NOVEDADES_LECTURAS',
  // v6.6 (Fase 4): vive en el Backoffice; Intake mantiene la copia solo
  // para que el esquema no diverja. Ver la nota identica en
  // backend/backoffice/Constantes.gs.
  NOVEDADES_HISTORIAL: 'NOVEDADES_HISTORIAL',
  // v6.7 (Fase 5): vive en el Backoffice; Intake mantiene la copia solo
  // para que el esquema no diverja. Ver la nota identica en
  // backend/backoffice/Constantes.gs.
  NOVEDADES_AUDIENCIA: 'NOVEDADES_AUDIENCIA',
  // v7.0 (Fase 1): vive en el Backoffice; Intake mantiene la copia solo
  // para que el esquema no diverja. Ver la nota identica en
  // backend/backoffice/Constantes.gs.
  ACTIVIDADES: 'ACTIVIDADES',
  ACTIVIDADES_BITACORA: 'ACTIVIDADES_BITACORA',
  // v7.1 (notificaciones vivas): vive en el Backoffice; Intake mantiene la
  // copia solo para que el esquema no diverja. Ver la nota identica en
  // backend/backoffice/Constantes.gs.
  NOTIFICACIONES_APP: 'NOTIFICACIONES_APP',
  // v7.3 (Nivel 0): vive en el Backoffice; Intake mantiene la copia solo
  // para que el esquema no diverja. Ver la nota identica en
  // backend/backoffice/Constantes.gs.
  NOTIF_PERMISOS_SO: 'NOTIF_PERMISOS_SO',
  // v9.0 (Modulo de Proyectos): vive 100% en el Backoffice (es interno);
  // Intake mantiene la copia solo para que el esquema no diverja. Ver la
  // nota identica en backend/backoffice/Constantes.gs.
  PROYECTOS: 'PROYECTOS',
  PROYECTO_INTEGRANTES: 'PROYECTO_INTEGRANTES',
  PROYECTO_HITOS: 'PROYECTO_HITOS',
  PROYECTO_EVENTOS: 'PROYECTO_EVENTOS',
  // v9.4: idem -- copia solo para que el esquema no diverja.
  PROYECTO_ENTREGABLES: 'PROYECTO_ENTREGABLES',
  PROYECTO_RIESGOS: 'PROYECTO_RIESGOS',
  // v10 (Fase C): idem -- copia solo para que el esquema no diverja. Ver la
  // nota identica en backend/backoffice/Constantes.gs.
  PROYECTO_PLANTILLAS: 'PROYECTO_PLANTILLAS',
  PROYECTO_PLANTILLA_HITOS: 'PROYECTO_PLANTILLA_HITOS',
  // v13 (Fase 4, "centro documental"): vive 100% en el Backoffice; Intake
  // mantiene la copia solo para que el esquema no diverja. Ver la nota
  // idéntica en backend/backoffice/Constantes.gs.
  PROYECTO_DOCUMENTOS: 'PROYECTO_DOCUMENTOS',
  PROYECTO_DOC_VERSIONES: 'PROYECTO_DOC_VERSIONES',
  // v10.0 (Modulo SGC ISO 9001): vive 100% en el Backoffice (es interno);
  // Intake mantiene la copia solo para que el esquema no diverja. Ver la
  // nota identica en backend/backoffice/Constantes.gs.
  SGC_DOCUMENTOS: 'SGC_DOCUMENTOS',
  SGC_DOC_VERSIONES: 'SGC_DOC_VERSIONES',
  SGC_DOC_DESTINATARIOS: 'SGC_DOC_DESTINATARIOS',
  SGC_ROLES: 'SGC_ROLES',
  // v10.0 Fase 1b: idem -- copia solo para que el esquema no diverja.
  SGC_DOC_ACUSES: 'SGC_DOC_ACUSES',
  // v10.0 Fase 2a: idem -- copia solo para que el esquema no diverja.
  SGC_PERSONAS: 'SGC_PERSONAS',
  SGC_DESCRIPTORES: 'SGC_DESCRIPTORES',
  SGC_PERSONA_DOCUMENTOS: 'SGC_PERSONA_DOCUMENTOS',
  SGC_INDUCCIONES: 'SGC_INDUCCIONES',
  // v10.0 Fase 2b: idem -- copia solo para que el esquema no diverja.
  SGC_EVALUACIONES: 'SGC_EVALUACIONES',
  SGC_CAPACITACIONES: 'SGC_CAPACITACIONES',
  SGC_CAPACITACION_ASISTENTES: 'SGC_CAPACITACION_ASISTENTES',
  // v10.0 Fase 3a: idem -- copia solo para que el esquema no diverja.
  SGC_NC: 'SGC_NC',
  // v10.0 Fase 3b: idem -- copia solo para que el esquema no diverja.
  SGC_AUDITORIAS: 'SGC_AUDITORIAS',
  SGC_AUD_HALLAZGOS: 'SGC_AUD_HALLAZGOS',
  // v10.0 Fase 4 (PRO-07): esta SI la escribe el Intake (formulario publico
  // de quejas), no es solo copia de esquema.
  SGC_QUEJAS: 'SGC_QUEJAS',
  SGC_PROVEEDORES: 'SGC_PROVEEDORES',
  SGC_PROVEEDOR_EVALUACIONES: 'SGC_PROVEEDOR_EVALUACIONES',
  SGC_REVISIONES: 'SGC_REVISIONES',
  SGC_REVISION_ACUERDOS: 'SGC_REVISION_ACUERDOS',

  // v10.0 Fase 6a: tablero de objetivos de calidad (DOC-07).
  SGC_OBJETIVOS: 'SGC_OBJETIVOS',
  SGC_INDICADOR_LECTURAS: 'SGC_INDICADOR_LECTURAS',
  SGC_ALCANCE: 'SGC_ALCANCE',
  SGC_EXCLUSIONES: 'SGC_EXCLUSIONES',
  SGC_CONTEXTO: 'SGC_CONTEXTO',
  SGC_PARTES_INTERESADAS: 'SGC_PARTES_INTERESADAS',
  SGC_RIESGOS: 'SGC_RIESGOS',
  SGC_PROCESOS: 'SGC_PROCESOS',
  SGC_PROCESO_PASOS: 'SGC_PROCESO_PASOS',
  SGC_INDICADORES: 'SGC_INDICADORES',
  SGC_PRESTACIONES: 'SGC_PRESTACIONES'
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
    'cc',
    // Trazabilidad del cliente elegido del buscador (CAT_CLIENTES): rut y
    // codigo identifican sin ambiguedad al cliente aunque la razon social se
    // edite. Quedan '' en solicitudes internas o cuando se escribe manual.
    // Aditivas al final (mismo criterio que cc).
    'rut_cliente', 'codigo_cliente',
    // v3.1 (§1.5): marca de "atencion directa" -- la solicitud se registro
    // DESPUES de resolverse (llamada telefonica al desarrollador), no
    // recorrio el flujo. Se necesita como marca separada, y no solo como
    // estado S09, porque estas solicitudes se crean y cierran en el mismo
    // instante: contarlas en el tiempo promedio de resolucion o en el
    // semaforo de cumplimiento distorsionaria los KPIs de Gerencia.
    'atencion_directa',
    // v10 (Fase D): idem -- copia solo para que el esquema no diverja. Ver
    // la nota identica en backend/backoffice/Constantes.gs.
    'proyecto_id'
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
    'imagen_descripciones',
    // v2.1 (Fase A, documentacion/SIGSO-v2.1-plazos-y-control.md §5):
    // "dos promesas, dos relojes". fecha_propuesta la escribe el
    // solicitante en el formulario (misma fecha replicada en cada item,
    // ver crearSolicitud); fecha_comprometida es la que fija el
    // desarrollador (Backoffice, Solicitudes.comprometerFecha) y es la
    // oficial para Gerencia; fecha_terminada se sella sola al llegar a
    // S08 (detiene el reloj del desarrollador); comprometida_por es el
    // correo de quien fijo fecha_comprometida.
    'fecha_propuesta', 'fecha_comprometida', 'fecha_terminada', 'comprometida_por',
    // v3.0 (Fase 1, multi-responsable, documentacion/SIGSO-v3.0-multi-
    // responsable-y-control.md §2-§3): a que area/responsable va dirigido
    // este item. El formulario elige por AREA (CAT_AREAS); crearSolicitud
    // resuelve area -> responsable_email y lo escribe en
    // desarrollador_asignado (arriba), sin exponer el correo al publico.
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
  // Ver la nota identica en backend/backoffice/Constantes.gs (v2.0, Sprint
  // 2, P2): es_urgente agregado al final.
  CAT_TIPOS: ['tipo_id', 'nombre', 'prioridad_default', 'activo', 'es_urgente'],
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
  ],
  // v2.1 (Fase A): linea base de cada re-compromiso, "el resbalon" que el
  // Panel de Gerencia (Fase C) necesita mostrar. Intake no escribe aqui
  // (solo Backoffice lo hace, al comprometer/re-comprometer una fecha) pero
  // declara las columnas igual que el resto del esquema (mismo patron que
  // HISTORIAL_PRIORIDAD).
  HISTORIAL_COMPROMISO: [
    'historial_id', 'subsolicitud_id', 'solicitud_id',
    'fecha_anterior', 'fecha_nueva', 'motivo', 'usuario', 'timestamp'
  ],
  // v3.0 (Fase 1): catalogo publico-seguro de areas -> responsable. El
  // formulario lista las areas activas por nombre (Catalogos.getAll); el
  // responsable_email se resuelve SOLO en el servidor (crearSolicitud), no
  // viaja al navegador. Mismo patron administrable que el resto de CAT_*.
  CAT_AREAS: ['area_id', 'nombre', 'responsable_email', 'activo'],
  // Cartera de clientes GDE/HomePymes. estado (Activo/Inactivo) y bloqueo
  // (Activo/Bloqueado) son informativos -- se muestran como badge en el
  // buscador pero NO filtran; el filtro estandar de catalogo usa 'activo'
  // (TRUE para todos, para no esconder clientes bloqueados que igual pueden
  // tener una solicitud). Datos de contacto comercial, no credenciales.
  CAT_CLIENTES: [
    'cliente_id', 'razon_social', 'rut', 'codigo_cliente', 'contacto',
    'correo', 'telefono', 'representante_legal', 'direccion',
    'estado', 'bloqueo', 'activo'
  ],
  // v3.1 (§2.3): quien tenia el trabajo, quien lo recibe y por que. Si
  // subsolicitud_id viene vacio, la derivacion fue de la solicitud completa.
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
  // v4.2 (§1): jefe_email/subordinado_email por correo -- ver la nota
  // identica en SHEETS.JEFATURAS de este mismo archivo.
  JEFATURAS: ['jefatura_id', 'jefe_email', 'subordinado_email', 'activo'],
  // v6.0 (modulo Pausas Activas): esquema ADITIVO -- estas hojas no afectan
  // el flujo principal de solicitudes. Ver documentacion/SIGSO-v6.0-propuesta-
  // modulo-pausas-activas.md. Deben ser identicas en backoffice/Constantes.gs
  // y en setup/Instalador.gs (ESQUEMA_HOJAS).
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
    'sgc_origen_tipo', 'sgc_origen_id',
    // v10 (Fase G2): ver la nota identica en backend/backoffice/Constantes.gs.
    'meta_cantidad', 'meta_unidad',
    // v10 (multi-asignación): ver la nota identica en backend/backoffice/Constantes.gs.
    'colaboradores_emails',
    // v11 (P2, "subtareas con rollup"): ver la nota identica en backend/backoffice/Constantes.gs.
    'tarea_padre_id'
  ],
  ACTIVIDADES_BITACORA: [
    'bitacora_id', 'actividad_id', 'tipo', 'autor_email', 'autor_nombre',
    'nota', 'avance_pct', 'confianza', 'datos', 'timestamp'
  ],
  // v7.1 (notificaciones vivas): cola de notificaciones "en vivo" -- espejo
  // de enviarCorreo_ (documentacion/SIGSO-v7.1-notificaciones-vivas.md).
  // modulo_id es el id de modulo del shell (plataforma.js/app.js) al que
  // navega el click ("pausas", "mi_trabajo", etc.); expira_en evita que una
  // notificacion vieja reaparezca en el polling despues de mucho tiempo.
  NOTIFICACIONES_APP: [
    'notif_id', 'destinatario_email', 'tipo', 'titulo', 'mensaje',
    'modulo_id', 'texto_accion', 'leida', 'creada_en', 'expira_en'
  ],
  // v7.3 (Nivel 0): ver la nota identica en backend/backoffice/Constantes.gs.
  NOTIF_PERMISOS_SO: ['email', 'permiso', 'actualizado_en'],
  // v9.0 (Modulo de Proyectos): ver la nota identica en
  // backend/backoffice/Constantes.gs.
  PROYECTOS: [
    'proyecto_id', 'codigo', 'nombre', 'descripcion', 'objetivo',
    'resultado_esperado', 'lider_email', 'area_id', 'cliente_id',
    'categoria', 'prioridad', 'estado',
    'fecha_inicio', 'fecha_objetivo', 'fecha_cierre_real',
    'salud_override', 'salud_override_motivo',
    'ultima_actualizacion', 'creado_por', 'fecha_creacion', 'activa',
    // v10 (Fase D): idem -- copia solo para que el esquema no diverja. Ver
    // la nota identica en backend/backoffice/Constantes.gs.
    'solicitud_origen_id'
  ],
  PROYECTO_INTEGRANTES: [
    'integrante_id', 'proyecto_id', 'usuario_email', 'usuario_nombre',
    'rol_proyecto', 'responsabilidad', 'activo', 'agregado_por', 'fecha_creacion',
    // v10 (Fase D): idem -- copia solo para que el esquema no diverja.
    'ultima_visita_sala'
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
  // v10 (Fase C): ver la nota identica en backend/backoffice/Constantes.gs.
  PROYECTO_PLANTILLAS: [
    'plantilla_id', 'nombre', 'descripcion', 'creado_por', 'fecha_creacion', 'activa'
  ],
  PROYECTO_PLANTILLA_HITOS: [
    'plantilla_hito_id', 'plantilla_id', 'nombre', 'descripcion', 'orden'
  ],
  // v13 (Fase 4, "centro documental"): ver la nota idéntica en
  // backend/backoffice/Constantes.gs.
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
    'requiere_acuse', 'fecha_limite_acuse',

    // v10.0 Fase 6b: clausulas ISO 9001 que este documento sustenta como
    // evidencia (JSON de codigos, ej. '["5.2","7.5"]'). Lo etiqueta el
    // Encargado SGC -- SIGSO no adivina que documento es la politica de
    // calidad o el mapa de procesos, eso lo sabe quien conoce sus propios
    // documentos.
    'clausulas_iso',
    // v11.0 Fase 5 (§7.5.3.2): documentos de origen EXTERNO.
    // emisor: quien lo publica (ISO, Ministerio del Trabajo...). La
    //   organizacion no controla su version: solo lo identifica y controla
    //   su distribucion, que es exactamente lo que pide la clausula.
    // clase_externa: Norma / Decreto / Ley / Codigo, tal como los
    //   clasifica la hoja "Externos" del FO-PRO-01-01.
    'emisor', 'clase_externa'
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
  // v10.0 Tanda A: idem -- copia solo para que el esquema no diverja.
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
  // v10.0 Tanda A: idem -- copia solo para que el esquema no diverja.
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
  ],

  // --- v10.0 Fase 5b: revision por la direccion (PRO-05, §9.3) --------------
  // Una fila = un FO-PRO-05-01 completo, igual criterio que SGC_NC,
  // SGC_AUDITORIAS y SGC_QUEJAS: el auditor pide "muestrame la revision del
  // 2026" y tiene que salir entera, sin recomponerla desde cuatro tablas.
  //
  // asistentes: JSON [{nombre, cargo}] -- la tabla 1 del formulario. La
  //   columna "Firma" del papel no se guarda: la evidencia equivalente es
  //   quien quedo registrado y cuando, con trazabilidad de quien lo escribio.
  // entradas: JSON [{item, observaciones}] con los 13 items FIJOS de §9.3.2.
  //   Son fijos y estan en el codigo (ENTRADAS_REVISION), no en esta hoja:
  //   la norma los enumera, no los define la organizacion.
  //
  // aviso_plazo: PRO-05 §6 exige avisar a los asistentes con al menos 10
  //   DIAS HABILES de anticipacion. Se guarda calculado para poder avisar
  //   antes de que sea tarde, no para constatar despues que no se cumplio.
  //
  // estado: PROGRAMADA | CONVOCADA | REALIZADA | CERRADA | ANULADA
  SGC_REVISIONES: [
    'revision_id', 'correlativo', 'anio',
    'fecha_programada', 'aviso_plazo', 'fecha_convocatoria', 'fecha_reunion',
    'asistentes', 'entradas', 'conclusiones', 'anexos',
    'director_email', 'responsable_calidad_email',
    'estado', 'fecha_cierre', 'cerrada_por',
    'creada_por', 'fecha_creacion', 'activa'
  ],

  // Los acuerdos de la tabla 3 del FO-PRO-05-01. Van en su propia hoja y no
  // en un JSON dentro de la revision porque cada uno tiene responsable y
  // plazo, y se convierte en una ACTIVIDAD real (motor v7.0): necesitan
  // fila propia para poder enlazar actividad_id y consultarlos sueltos.
  //
  // tipo: MEJORA | CAMBIO_SGC | RECURSOS -- las tres salidas obligatorias
  // de §9.3.3, en el mismo orden del formulario.
  SGC_REVISION_ACUERDOS: [
    'acuerdo_id', 'revision_id', 'tipo', 'observaciones',
    'responsable_email', 'plazo', 'actividad_id',
    'creado_por', 'fecha_creacion', 'activa'
  ],

  // --- v10.0 Fase 6a: objetivos de calidad (DOC-07, §6.2) -------------------
  // Una fila = un objetivo EN UN AÑO. La clave es (anio, numero): DOC-07 es
  // un documento vivo ("Fecha actualizacion: Junio 2026") y la meta, el
  // responsable y hasta la frecuencia se ajustan de un año a otro. Guardar
  // una fila por año conserva contra que meta se midio cada periodo -- sin
  // eso, subir la meta en 2027 reescribiria la historia de 2026 y el tablero
  // dejaria de ser evidencia.
  //
  // Por eso los objetivos NO son un catalogo en el codigo (a diferencia de
  // las 13 entradas de la revision o las 28 clausulas ISO, que las define la
  // norma y no la organizacion): estos los define la empresa en su DOC-07.
  //
  // meta_operador / meta_valor / unidad: la meta en forma COMPARABLE, para
  //   poder decir "cumple" sin que nadie lo interprete a mano.
  // meta_texto: la meta LITERAL del documento. Se conserva porque es lo que
  //   el auditor lee en DOC-07, y porque varias traen matices que ningun
  //   operador numerico captura ("≥ 90% anual, con calificacion ≥ nota 8").
  //
  // fuente: de donde sale el valor de cada lectura.
  //   AUTO     el sistema lo calcula entero (hoy solo el objetivo 4).
  //   ASISTIDA el sistema aporta parte y la persona completa el resto
  //            (objetivo 2: sabe cuantos reclamos hubo, no cuantos
  //            servicios se prestaron -- eso llega con la Fase 7).
  //   MANUAL   lo entra la persona responsable.
  // calculo: clave del calculo automatico (ver CALCULOS_INDICADOR_SGC).
  //   Vacio en los MANUAL.
  //
  // frecuencia: la normalizada, que es la que dispara el aviso de lectura
  //   pendiente. frecuencia_texto guarda la del documento, que a veces trae
  //   dos ("Mensual / Trimestral") o una aclaracion ("Anual (post-proyecto)").
  SGC_OBJETIVOS: [
    'objetivo_id', 'anio', 'numero',
    'objetivo_general', 'objetivo_especifico', 'indicador',
    'meta_texto', 'meta_operador', 'meta_valor', 'unidad',
    'acciones', 'frecuencia', 'frecuencia_texto',
    'responsable_texto', 'responsable_email',
    'fuente', 'calculo',
    'creado_por', 'fecha_creacion', 'activa'
  ],

  // Las lecturas del periodo. Una fila = "en tal periodo, el indicador dio
  // tanto". periodo es una clave ordenable y comparable: '2026-M03',
  // '2026-T2', '2026-S1', '2026'. La forma la define la frecuencia del
  // objetivo, asi que un objetivo semestral nunca genera claves mensuales.
  //
  // numerador/denominador: se guardan aparte del valor cuando el indicador
  //   es un cociente. Sin ellos, un 1,8% no se puede auditar (¿1,8% de que?)
  //   ni recalcular si mañana cambia el denominador.
  // cumple: derivado de comparar valor contra la meta del objetivo, pero se
  //   PERSISTE: la meta puede cambiar el año que viene y el "cumplio" de
  //   2026 tiene que seguir siendo el que se evaluo en 2026.
  // detalle: JSON opcional con el desglose que sustenta el numero (por
  //   ejemplo, quienes quedaron bajo las 5 horas de formacion).
  SGC_INDICADOR_LECTURAS: [
    'lectura_id', 'objetivo_id', 'indicador_id', 'anio', 'periodo',
    'valor', 'numerador', 'denominador',
    'cumple', 'origen', 'detalle', 'observaciones',
    'registrado_por', 'fecha_registro', 'activa'
  ],

  // --- v11.0 Fase 1: alcance del SGC y exclusiones (§4.3) -----------------
  //
  // §4.3 exige que el alcance del sistema se mantenga como informacion
  // documentada, y que toda clausula que la organizacion no aplique quede
  // declarada CON SU JUSTIFICACION. Hasta ahora eso vivia unicamente dentro
  // del DOC-01 en Word: el sistema no podia responder "cual es el alcance"
  // ni "que se excluyo y por que", que son dos de las primeras preguntas de
  // una auditoria de certificacion.
  //
  // Una fila = una VERSION del alcance. La que rige es la que tiene estado
  // VIGENTE; las anteriores se conservan (mismo criterio que los documentos
  // obsoletos) porque el auditor puede preguntar contra que alcance se
  // certifico el periodo pasado.
  //
  // norma_codigo / norma_version: el alcance declara CONTRA QUE EDICION de la
  //   norma rige. Es lo que permite que manana convivan ISO 9001:2015 y una
  //   edicion posterior sin reescribir el modulo: se agrega el catalogo de
  //   clausulas de la version nueva y un alcance que la declare.
  // areas / ubicaciones: JSON de listas. Son listas cortas y sin vida propia
  //   -- no se consultan por separado ni tienen estado -- asi que no
  //   justifican una hoja aparte.
  // documento_id: el documento que sustenta la declaracion, si esta cargado.
  SGC_ALCANCE: [
    'alcance_id', 'version', 'estado',
    'razon_social', 'nombre_fantasia', 'rut',
    'declaracion', 'areas', 'ubicaciones',
    'norma_codigo', 'norma_version',
    'documento_id', 'observaciones',
    'vigente_desde', 'reemplazado_por',
    'creado_por', 'fecha_creacion', 'activa'
  ],

  // Una exclusion por fila. Van en hoja aparte y no como JSON dentro del
  // alcance por dos razones: cada una es un registro auditable por si mismo
  // (el auditor pide "muestrame tus exclusiones y sus justificaciones"), y
  // la matriz de cobertura las consulta POR CLAUSULA.
  //
  // clausula: se guarda con la granularidad que use el manual, incluida la
  //   SUB-clausula ('7.1.5.2', '8.5.1 f'). Ese era exactamente el vacio: el
  //   catalogo de la matriz trabaja a nivel de clausula (7.1, 8.5) y no
  //   habia donde anotar que se excluyo solo una parte.
  // clausula_padre: se deriva al guardar (los dos primeros segmentos) y es
  //   por donde la matriz encuentra la exclusion.
  SGC_EXCLUSIONES: [
    'exclusion_id', 'alcance_id', 'clausula', 'clausula_padre', 'titulo',
    'justificacion', 'creado_por', 'fecha_creacion', 'activa'
  ],

  // --- v11.0 Fase 2: contexto de la organizacion (§4.1) -------------------
  //
  // El DOC-02 "Analisis FODA" es una tabla de cuatro cuadrantes con 24
  // factores. Se estructura por dos razones que un Word no da: §4.1 exige
  // hacer SEGUIMIENTO Y REVISION de estas cuestiones (no solo listarlas), y
  // siete de los once riesgos del DOC-08 son literalmente debilidades y
  // amenazas de este documento -- la cadena factor -> riesgo -> accion hoy
  // solo existe en la cabeza de quien redacto ambos.
  //
  // tipo: FORTALEZA / OPORTUNIDAD / DEBILIDAD / AMENAZA.
  // origen: INTERNO / EXTERNO. Se deriva del tipo, pero se PERSISTE porque
  //   es el vocabulario de la norma ("cuestiones externas e internas") y es
  //   por donde se agrupa al mostrarlo y al evaluar la clausula.
  // numero: el correlativo dentro de su cuadrante, tal como lo trae el
  //   DOC-02. Permite citar "D3" en un riesgo y que se entienda.
  // estado: VIGENTE / SUPERADO. Un factor puede dejar de aplicar sin que
  //   haya que borrarlo -- el historico es parte de la evidencia de que la
  //   organizacion revisa su contexto.
  SGC_CONTEXTO: [
    'factor_id', 'tipo', 'origen', 'numero', 'descripcion',
    'estado', 'observaciones',
    'fecha_identificacion', 'fecha_ultima_revision', 'revisado_por',
    'creado_por', 'fecha_creacion', 'activa'
  ],

  // --- v11.0 Fase 2: partes interesadas (§4.2) ----------------------------
  //
  // Las columnas siguen al DOC-04 v02 y no a una plantilla generica: parte,
  // necesidades, impacto, nivel de influencia, expectativa y como afecta al
  // SGC. Son las SEIS que el documento real tiene.
  //
  // metodo_seguimiento / frecuencia_seguimiento / responsable_email quedan
  // OPCIONALES y vacios: §4.2 pide hacer seguimiento y revision de la
  // informacion sobre las partes interesadas, asi que tienen donde vivir,
  // pero no se rellenan con algo inventado para que la pantalla se vea
  // completa. Un campo vacio es honesto; uno inventado es un hallazgo.
  SGC_PARTES_INTERESADAS: [
    'parte_id', 'nombre', 'categoria',
    'necesidades', 'expectativa', 'efecto_sgc',
    'impacto', 'influencia',
    'metodo_seguimiento', 'frecuencia_seguimiento', 'responsable_email',
    'estado', 'fecha_ultima_revision', 'revisado_por',
    'creado_por', 'fecha_creacion', 'activa'
  ],

  // --- v11.0 Fase 3: riesgos y oportunidades (§6.1) -----------------------
  //
  // El DOC-08 es el documento mas rico del material y el que mas gana al
  // digitalizarse, porque trae un modelo de valoracion NUMERICO completo:
  // probabilidad x impacto = magnitud, con bandas definidas, y una segunda
  // pasada de revaloracion despues de aplicar los controles.
  //
  // Riesgos y oportunidades comparten hoja con un campo `clase`. Son la misma
  // estructura (§6.1 las trata juntas) y separarlas en dos hojas obligaria a
  // duplicar cada consulta. Lo que SI cambia es el significado: en una
  // oportunidad, una magnitud alta es BUENA y la revaloracion deberia SUBIR.
  //
  // NO se guardan `magnitud` ni la banda: se CALCULAN a partir de
  // probabilidad e impacto. Ese es el punto -- en el documento original 7 de
  // las 32 valoraciones no coinciden con su propia tabla de criterios, y al
  // calcularlas deja de ser posible que discrepen.
  //
  // factor_contexto_id: enlace al factor del FODA que origina el riesgo.
  //   Siete de los once riesgos del DOC-08 son literalmente debilidades y
  //   amenazas del DOC-02; sin este campo esa cadena se pierde.
  // accion_actividad_id: la accion de tratamiento es una ACTIVIDAD del motor
  //   v7.0, igual que las correcciones de una NC y los acuerdos de la
  //   revision por la direccion. No se crea un tercer sistema de tareas.
  // fecha_implementacion: texto libre a proposito. El documento usa "Agosto
  //   2026", "Continuo" y "Post-certificacion"; forzar una fecha exacta
  //   obligaria a inventar un dia que nadie decidio.
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

// --- v11.0 Fase 4: procesos del SGC (§4.4, y base de §8.1/§8.5/§8.6) ----
  //
  // Hay DOS niveles y comparten hoja porque son la misma entidad con distinto
  // grado de detalle:
  //
  //   MAPA     los 14 procesos del DOC-03 "Mapa de procesos v02", repartidos
  //            en estrategicos, operativos y de apoyo. Son la vista que pide
  //            §4.4: que procesos hay y como se relacionan.
  //   SERVICIO los 40 procesos de servicio de los DOC-10 a DOC-13, cada uno
  //            colgando del proceso del mapa al que pertenece
  //            (`proceso_padre_id`). Son el detalle operativo.
  //
  // La distincion importa: el mapa es chico y estable, y cierra §4.4 solo.
  // El detalle operativo es grande (143 pasos) y se carga por planilla, no
  // desde el codigo -- meter 135 KB de texto en un archivo que se pega a
  // mano en Apps Script seria pagar ese costo en cada despliegue.
  //
  // clausulas_iso: mismo campo y mismo criterio que SGC_DOCUMENTOS. El
  //   Encargado etiqueta que clausulas sustenta cada proceso; adivinarlo por
  //   palabras clave seria inventar evidencia.
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
  // empresa ya aprobo y con el que trabaja cada area.
  SGC_PROCESO_PASOS: [
    'paso_id', 'proceso_id', 'numero', 'nombre',
    'responsable', 'input', 'actividades', 'evidencias', 'output',
    'observaciones', 'creado_por', 'fecha_creacion', 'activa'
  ],

// --- v11.0 Fase 6: indicadores de proceso (§9.1.1) ----------------------
  //
  // Los SGC_OBJETIVOS son los seis del DOC-07: corporativos, anuales, y
  // fijados por la Direccion. Un indicador de PROCESO es otra cosa -- mide
  // como va un proceso concreto, lo define su responsable y no se reabre
  // cada enero.
  //
  // Por que en hoja aparte y no generalizando SGC_OBJETIVOS: los objetivos
  // se guardan POR AÑO a proposito (subir una meta en 2027 no puede
  // reescribir contra que se midio 2026). Un indicador de proceso vive
  // mientras el proceso viva. Mezclarlos obligaria a duplicar cada
  // indicador cada año sin motivo.
  //
  // Las LECTURAS si se comparten: `SGC_INDICADOR_LECTURAS` gano un
  // `indicador_id` aditivo, y una lectura pertenece o a un objetivo o a un
  // indicador. Todo lo que ya existia cruza por `objetivo_id`, asi que las
  // filas nuevas son invisibles para el tablero de objetivos.
  //
  // proceso_id: que proceso mide. Es el enlace con la Fase 4 y lo que hace
  //   que la ficha de un proceso pueda mostrar sus indicadores.
  // objetivo_id: opcional. El DOC-03 pide KPIs "alineados a los objetivos de
  //   calidad": cuando el indicador alimenta uno, queda dicho cual.
  // tolerancia_valor: el escalon intermedio. Sin el solo hay cumple / no
  //   cumple, y un 88% contra una meta de 90% se ve igual de rojo que un
  //   40% -- que es justo lo que impide priorizar.
  SGC_INDICADORES: [
    'indicador_id', 'codigo', 'nombre', 'descripcion',
    'proceso_id', 'objetivo_id', 'area',
    'formula', 'fuente', 'unidad',
    'meta_operador', 'meta_valor', 'meta_texto', 'tolerancia_valor',
    'frecuencia', 'responsable_email',
    'estado', 'observaciones',
    'creado_por', 'fecha_creacion', 'activa'
  ],

// --- v11.0 Fase 8: evidencia de servicios prestados (§8.1, §8.5, §8.6,
  // --- §8.7) --------------------------------------------------------------
  //
  // La fase con riesgo de escala, y la razon por la que se dejo para el
  // final. Una fila = UNA prestacion registrada. Las decisiones que la
  // hacen viable:
  //
  // 1. NO se pre-generan filas. Nada de crear cliente x proceso x mes por
  //    adelantado: con 50 clientes y 40 procesos eso serian 24.000 filas al
  //    año de golpe, casi todas vacias. Una fila existe cuando alguien
  //    registra que el servicio se presto.
  //
  // 2. `periodo` es OPCIONAL. Los DOC-10 a 13 distinguen servicios
  //    "Mensual" de "Puntual": un proceso mensual tiene una prestacion por
  //    periodo, uno puntual tiene tantas como veces ocurra. Forzar un
  //    periodo a un servicio puntual obligaria a inventarlo.
  //
  // 3. El cliente NO se duplica: `cliente_id` apunta a CAT_CLIENTES, que ya
  //    existe en SIGSO desde la v1. Se desnormaliza el nombre igual que en
  //    SOLICITUDES, para que el listado no dependa de un cruce.
  //
  // estado: PRESTADO (entregado, aun sin liberar) / LIBERADO (§8.6, con
  //   quien autorizo y cuando) / NO_CONFORME (§8.7, salida no conforme).
  // nc_id: si la salida no conforme derivo en una no conformidad, con el
  //   mismo eslabon que ya usan las quejas y los hallazgos de auditoria.
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
