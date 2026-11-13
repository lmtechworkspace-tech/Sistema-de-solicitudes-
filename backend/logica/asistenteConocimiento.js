'use strict';

/**
 * asistenteConocimiento.js — lo que el Asistente SIGSO sabe "de memoria"
 * (2026-11-11): cómo está armado SIGSO y el catálogo de consultas que puede
 * hacer con `consultar_sigso`.
 *
 * El catálogo es una LISTA BLANCA de acciones de solo lectura del router. El
 * asistente las corre con la sesión de quien pregunta, así que hereda sus
 * permisos: si la persona no puede ver algo en pantalla, el asistente tampoco.
 * Agregar una acción aquí = el asistente puede leerla. Nunca agregar acciones
 * que modifican datos (asistente.js además las corre dentro de un SAVEPOINT
 * que se deshace, como segunda barrera).
 *
 * Este texto va en el prompt de sistema (fijo, sin fechas ni datos del
 * usuario) para que quede en la caché de la API y cada pregunta salga barata.
 */

// [acción, módulo, qué entrega, parámetros]
const CATALOGO = [
  // --- General -------------------------------------------------------------------------
  ['getInicio', 'General', 'Resumen de la pantalla de Inicio de la persona: sus pendientes, avisos y números del día.', '{}'],
  ['getMiPerfil', 'General', 'Datos de la cuenta de quien pregunta (nombre, rol, módulos).', '{}'],
  ['buscarDirectorioPersonas', 'General', 'Buscar personas de la empresa por nombre, cargo o RUT.', '{ texto }'],
  ['listarDirectorioPersonas', 'General', 'Directorio completo de personas (solo Administración).', '{}'],
  ['getCatalogos', 'General', 'Catálogos: empresas, plataformas, módulos, tipos, áreas.', '{}'],
  ['getClientes', 'General', 'Catálogo de clientes (empresas cliente) con su código y RUT.', '{}'],
  ['getFeedNovedades', 'Novedades', 'Comunicados y novedades publicadas que la persona puede ver.', '{ tipo?, area_id? }'],
  ['getDetalleNovedad', 'Novedades', 'Detalle de una novedad.', '{ novedad_id }'],
  ['misPendientesNovedad', 'Novedades', 'Novedades que la persona tiene pendientes de leer o confirmar.', '{}'],
  ['getPanelCumplimientoNovedad', 'Novedades', 'Quién leyó / confirmó las novedades (cumplimiento).', '{}'],

  // --- Solicitudes ---------------------------------------------------------------------
  ['getDashboardData', 'Solicitudes', 'Tablero de solicitudes según el rol: abiertas, vencidas, por estado y prioridad.', '{}'],
  ['getColaSolicitudes', 'Solicitudes', 'La cola de la Bandeja (solicitudes e ítems por atender).', '{ solo_mios?: boolean, depto? }'],
  ['getSolicitudDetalle', 'Solicitudes', 'Detalle completo de una solicitud (ítems, conversación, historial). Ej. solicitud_id "SOL-2026-GDE-0005".', '{ solicitud_id }'],
  ['reporteSolicitudes', 'Solicitudes', 'Reporte de pedidos por departamento, servicio y persona.', '{ depto?, periodo?: "AAAA-MNN" }'],
  ['catalogoServiciosSolicitud', 'Solicitudes', 'Servicios que cada departamento recibe (con plazo en días hábiles).', '{}'],
  ['getPautaTrabajo', 'Solicitudes', 'Pauta de trabajo de un desarrollador/analista.', '{ desarrollador? }'],

  // --- Gerencia, jefatura, mi equipo ---------------------------------------------------
  ['getPanelGerencia', 'Gerencia', 'Panel de Gerencia: indicadores generales de la empresa.', '{}'],
  ['getResumenGerencia', 'Gerencia', 'Resumen ejecutivo para Gerencia.', '{}'],
  ['getPanelGerenciaActividades', 'Gerencia', 'Actividades/tareas de toda la empresa vistas por Gerencia.', '{}'],
  ['getCumplimientoResponsables', 'Gerencia', 'Índice de cumplimiento por responsable (% del mes): compromisos con fecha, obligaciones del área, SGC y reportabilidad, más tareas sin fecha y dormidas. alcance: yo | equipo | empresa; periodo YYYY-MM; email para una persona.', '{"alcance":"empresa","periodo":"2026-11"}'],
  ['getPreparacionSgc', 'Calidad', '«¿Estamos preparados para certificar?»: recomendación global, veredicto por área con sus brechas, entrevistas, muestras y salud del SGC. Sin informe_id trae la última evaluación.', '{}'],
  ['getMiEquipo', 'Jefatura', 'El equipo de la jefatura: tareas abiertas, atrasadas y horas de cada persona.', '{}'],
  ['getPanelJefatura', 'Jefatura', 'Panel de Mi departamento.', '{}'],

  // --- Mi trabajo / actividades --------------------------------------------------------
  ['listarActividades', 'Mi trabajo', 'Tareas/actividades (por defecto las de quien pregunta).', '{ estado?, responsable_email? }'],
  ['getDetalleActividad', 'Mi trabajo', 'Detalle de una tarea con su bitácora.', '{ actividad_id }'],
  ['panelEquipoActividades', 'Mi trabajo', 'Tareas del equipo (para jefaturas).', '{}'],

  // --- Proyectos -----------------------------------------------------------------------
  ['listarProyectos', 'Proyectos', 'Proyectos que la persona ve, con avance y estado.', '{ estado? }'],
  ['getResumenPortafolioProyectos', 'Proyectos', 'Resumen del portafolio de proyectos.', '{}'],
  ['obtenerWorkloadPortafolioProyectos', 'Proyectos', 'Carga de trabajo de las personas en todos los proyectos.', '{}'],
  ['getDetalleCompletoProyecto', 'Proyectos', 'Todo un proyecto: equipo, hitos, tareas, riesgos, entregables, avance físico y financiero.', '{ proyecto_id }'],
  ['listarTareasProyecto', 'Proyectos', 'Tareas de un proyecto.', '{ proyecto_id }'],
  ['listarMisTareasProyectos', 'Proyectos', 'Mis tareas en todos los proyectos.', '{ incluir_personales?: boolean }'],
  ['listarCalendarioProyectos', 'Proyectos', 'Calendario de hitos y entregas de proyectos.', '{ proyecto_id? }'],
  ['listarReunionesProyecto', 'Proyectos', 'Reuniones y acuerdos de un proyecto.', '{ proyecto_id }'],
  ['listarDecisionesProyecto', 'Proyectos', 'Decisiones registradas de un proyecto.', '{ proyecto_id }'],
  ['listarControlAvanceProyecto', 'Proyectos', 'Control de avance (plan vs real) de un proyecto.', '{ proyecto_id }'],
  ['listarEstadosPagoProyecto', 'Proyectos', 'Estados de pago de un proyecto.', '{ proyecto_id }'],
  ['obtenerRendimientoProyecto', 'Proyectos', 'Rendimiento de un proyecto (desviaciones, atrasos).', '{ proyecto_id }'],
  ['obtenerAnaliticaProyecto', 'Proyectos', 'Analítica de un proyecto.', '{ proyecto_id }'],
  ['listarBitacoraProyecto', 'Proyectos', 'Bitácora de un proyecto.', '{ proyecto_id }'],

  // --- Calidad (SGC ISO 9001) ----------------------------------------------------------
  ['resumenTableroSgc', 'Calidad', 'Tablero del SGC: NC abiertas, auditorías, indicadores, documentos por revisar.', '{}'],
  ['getCaminoCertificacionSgc', 'Calidad', 'Camino a la certificación ISO 9001: qué está listo y qué falta.', '{}'],
  ['getControlDocumentalSgc', 'Calidad', 'Control documental: estado de todos los documentos del SGC.', '{}'],
  ['listarDocumentosSgc', 'Calidad', 'Documentos del SGC (procedimientos, formularios, políticas…).', '{ busqueda?, tipo?, estado? }'],
  ['getDocumentoSgc', 'Calidad', 'Ficha de un documento del SGC (versión, aprobación, archivo).', '{ documento_id }'],
  ['getContenidoDocumentoSgc', 'Calidad', 'TEXTO de un documento vivo del SGC (escrito dentro de SIGSO).', '{ documento_id }'],
  ['getMatrizDistribucionSgc', 'Calidad', 'Quién debe leer/confirmar cada documento.', '{}'],
  ['listarPersonasSgc', 'Calidad', 'Personas del SGC (cargos, inducción, evaluación).', '{ incluir_desvinculados?: boolean }'],
  ['getFichaPersonaSgc', 'Calidad', 'Ficha de una persona del SGC (descriptor de cargo, documentos, capacitaciones).', '{ persona_id }'],
  ['getPanelPersonasSgc', 'Calidad', 'Panel de personas: inducciones y evaluaciones pendientes.', '{}'],
  ['listarCapacitacionesSgc', 'Calidad', 'Capacitaciones del año.', '{ anio? }'],
  ['listarNcSgc', 'Calidad', 'No conformidades.', '{ abiertas?: boolean, estado? }'],
  ['getDetalleNcSgc', 'Calidad', 'Detalle de una no conformidad (causa, acciones, eficacia).', '{ nc_id }'],
  ['listarAuditoriasSgc', 'Calidad', 'Auditorías internas.', '{ anio? }'],
  ['getDetalleAuditoriaSgc', 'Calidad', 'Detalle de una auditoría con sus hallazgos.', '{ auditoria_id }'],
  ['listarQuejasSgc', 'Calidad', 'Quejas de clientes.', '{ abiertas?: boolean }'],
  ['getDetalleQuejaSgc', 'Calidad', 'Detalle de una queja.', '{ queja_id }'],
  ['listarProveedoresSgc', 'Calidad', 'Proveedores y su evaluación.', '{ busqueda? }'],
  ['getDetalleProveedorSgc', 'Calidad', 'Detalle de un proveedor.', '{ proveedor_id }'],
  ['listarRevisionesSgc', 'Calidad', 'Revisiones por la dirección.', '{}'],
  ['getDetalleRevisionSgc', 'Calidad', 'Detalle de una revisión por la dirección.', '{ revision_id }'],
  ['listarObjetivosSgc', 'Calidad', 'Objetivos de calidad del año y sus lecturas.', '{ anio? }'],
  ['getDetalleObjetivoSgc', 'Calidad', 'Detalle de un objetivo.', '{ objetivo_id }'],
  ['listarIndicadoresSgc', 'Calidad', 'Indicadores del SGC y sus lecturas.', '{ anio? }'],
  ['listarMatrizCoberturaSgc', 'Calidad', 'Cobertura de las cláusulas ISO 9001 (qué evidencia hay por cláusula).', '{}'],
  ['getDetalleClausulaCoberturaSgc', 'Calidad', 'Evidencias de una cláusula ISO.', '{ codigo }'],
  ['obtenerAlcanceSgc', 'Calidad', 'Alcance del SGC.', '{}'],
  ['obtenerContextoSgc', 'Calidad', 'Contexto de la organización (FODA, partes interesadas).', '{}'],
  ['listarRiesgosSgc', 'Calidad', 'Riesgos y oportunidades.', '{}'],
  ['listarProcesosSgc', 'Calidad', 'Mapa de procesos.', '{}'],
  ['getDetalleProcesoSgc', 'Calidad', 'Detalle de un proceso (pasos, responsables, registros).', '{ proceso_id }'],
  ['listarPrestacionesSgc', 'Calidad', 'Servicios prestados (liberación del servicio) de un mes.', '{ periodo: "AAAA-MNN", cliente_id?, estado? }'],

  // --- Departamentos (Contabilidad, RR.HH., Prevención, Marketing, Cobranzas, Administración) ---
  ['getControlInterno', 'Departamentos', 'PUNTO DE PARTIDA de los departamentos: qué áreas ve la persona, la definición de cada MATRIZ (clave, nombre, tipo, columnas, estados) y un resumen del mes.', '{ periodo?: "AAAA-MNN", depto? }'],
  ['listarRegistrosCI', 'Departamentos', 'Filas de una matriz con su situación. Mensual: un mes; registro: un año o un mes; lista: todas.', '{ matriz, periodo?: "AAAA-MNN", anio?: "AAAA" }'],
  ['getRegistroCI', 'Departamentos', 'Una fila de matriz con su historial.', '{ registro_id }'],
  ['informeMensualCI', 'Departamentos', 'Informe de proceso mensual de una matriz (avance, atrasos, por responsable).', '{ matriz, periodo: "AAAA-MNN" }'],
  ['panelHistoricoCI', 'Departamentos', 'Evolución mes a mes de una matriz o un área.', '{ desde: "AAAA-MNN", hasta: "AAAA-MNN", matriz?, depto? }'],
  ['buscarClientesCI', 'Departamentos', 'Buscar un cliente en las matrices.', '{ q }'],
  ['fichaClienteCI', 'Departamentos', 'Todo lo de un cliente en todas las matrices.', '{ cliente_id }'],
  ['personasTiemposCI', 'Departamentos', 'Tiempos y carga por persona en un área.', '{ depto, desde: "AAAA-MNN", hasta: "AAAA-MNN", matriz? }'],
  ['listarConveniosTGR', 'Departamentos', 'Convenios de pago con Tesorería (TGR) y sus cuotas.', '{}'],
  ['getConvenioTGR', 'Departamentos', 'Detalle de un convenio TGR.', '{ convenio_id }'],
  ['listarMiembrosCI', 'Departamentos', 'Quién está en cada área (jefatura, registra, lectura).', '{}'],
  ['listarReportesDep', 'Departamentos', 'Reportes mensuales de un área.', '{ depto, anio? }'],
  ['getReporteDep', 'Departamentos', 'Un reporte mensual de área.', '{ reporte_id }'],
  ['panelReportesDep', 'Departamentos', 'Estado de los reportes mensuales de todas las áreas (Administración).', '{ periodo?: "AAAA-MNN" }'],
  ['pendientesReportesDep', 'Departamentos', 'Reportes mensuales pendientes de la persona.', '{}'],
  ['indicadoresDep', 'Departamentos', 'Indicadores automáticos de un área en un mes.', '{ depto, periodo: "AAAA-MNN" }'],
  ['getInformeGestion', 'Departamentos', 'Informe de gestión mensual (cadena de firmas hasta Gerencia).', '{ periodo: "AAAA-MNN" }'],
  ['listarMetasDep', 'Departamentos', 'Metas de un área.', '{ depto }'],
  ['hoyAgenda', 'Departamentos', 'Agenda de HOY de un área: obligaciones que vencen, recordatorios por enviar.', '{ depto, fecha?: "AAAA-MM-DD" }'],
  ['calendarioAgenda', 'Departamentos', 'Calendario mensual de obligaciones de un área.', '{ depto, mes: "AAAA-MNN" }'],
  ['registroAgenda', 'Departamentos', 'Registro de recordatorios enviados de un área.', '{ depto, mes?: "AAAA-MNN", q? }'],
  ['porClienteAgenda', 'Departamentos', 'Agenda de un cliente.', '{ depto, cliente_id }'],
  ['resumenAgenda', 'Departamentos', 'Resumen de la agenda de todas las áreas que ve la persona.', '{}'],
  ['rrhhImpuestoUnico', 'Departamentos', 'Informe de impuesto único (IUSC) y 3 % por cliente en un mes.', '{ periodo: "AAAA-MNN" }'],
  ['rrhhPlataformas', 'Departamentos', 'Informe de plataformas externas (documentación subida) por cliente en un mes.', '{ periodo: "AAAA-MNN" }'],

  // --- Pausas activas ------------------------------------------------------------------
  ['getPausaHoyTrabajador', 'Pausas', 'La pausa activa de hoy de quien pregunta.', '{}'],
  ['getMiHistorialPausas', 'Pausas', 'Historial de pausas de quien pregunta.', '{ desde?: "AAAA-MM-DD", hasta? }'],
  ['getPanelCoordinadorPausas', 'Pausas', 'Panel del coordinador de pausas.', '{}'],
  ['listarPausasProgramadas', 'Pausas', 'Pausas programadas.', '{ empresa_id?, estado? }'],
  ['getReporteCumplimientoPausas', 'Pausas', 'Cumplimiento de pausas por trabajador.', '{ desde: "AAAA-MM-DD", hasta: "AAAA-MM-DD" }'],
  ['getReporteGerenciaPausas', 'Pausas', 'Reporte de pausas para Gerencia.', '{ desde, hasta, empresa_id? }'],

  // --- Hompy ---------------------------------------------------------------------------
  ['hompyDatos', 'Hompy', 'Todo lo de Hompy (la mascota): calendario, salidas, ideas, marcas.', '{}'],
  ['hompyReporteMensual', 'Hompy', 'Reporte mensual de Hompy.', '{ periodo: "AAAA-MNN" }'],

  // --- Administración del sistema ------------------------------------------------------
  ['listarUsuarios', 'Administración', 'Usuarios del sistema.', '{}'],
  ['listarCuentasPortal', 'Administración', 'Cuentas de SIGSO con su rol y módulos.', '{}'],
  ['listarJefaturas', 'Administración', 'Quién es jefatura de quién.', '{}'],
  ['getEstadoSistema', 'Administración', 'Estado técnico del sistema (versión, correo, colas).', '{}'],
  ['getSaludConfig', 'Administración', 'Salud de la configuración (cuentas sin módulo, datos inconsistentes).', '{}'],
  ['listarLogs', 'Administración', 'Registro de notificaciones enviadas.', '{ limite? }']
];

// Archivos que el asistente puede abrir y leer (PDF, Word, Excel, imágenes) con `leer_archivo_sigso`.
const ARCHIVOS = {
  sgc: { accion: 'descargarDocumentoSgc', parametros: '{ documento_id }', que: 'Archivo de un documento del SGC (el PDF/Word cargado).' },
  proyecto: { accion: 'descargarDocumentoProyecto', parametros: '{ proyecto_id, documento_id }', que: 'Documento cargado en un proyecto.' },
  novedad: { accion: 'descargarAdjuntoNovedad', parametros: '{ novedad_id }', que: 'Adjunto de una novedad/comunicado.' }
};

function textoCatalogo_() {
  let modulo = '';
  const lineas = [];
  CATALOGO.forEach(([accion, mod, que, params]) => {
    if (mod !== modulo) { lineas.push('\n### ' + mod); modulo = mod; }
    lineas.push('- `' + accion + '` ' + params + ' — ' + que);
  });
  return lineas.join('\n');
}

const SISTEMA = `Eres el **Asistente SIGSO**, el asistente inteligente de SIGSO (Sistema Integrado de Gestión — "Control y Gestión Empresarial") del grupo de empresas de HomePymes / Grupo HB, en Chile. Respondes preguntas de cualquier persona de la empresa sobre su trabajo, sus datos en SIGSO, cómo usar el sistema y los documentos que te compartan.

# Cómo trabajas
- Respondes SIEMPRE en español de Chile, claro, cercano y directo. Primero la respuesta, después el detalle.
- Para datos reales (cuántos, quién, cuándo, qué falta, estado de algo) SIEMPRE consultas SIGSO con tus herramientas. NUNCA inventes cifras, nombres ni estados. Si no encuentras el dato, dilo y explica dónde buscarlo.
- Ves EXACTAMENTE lo que la persona puede ver: consultas con su sesión y sus permisos. Si una consulta responde "No tienes acceso", explícale que su cuenta no tiene ese permiso y quién podría dárselo (Administración del sistema o la jefatura del área). No intentes rodearlo.
- Eres de SOLO LECTURA: no puedes crear, cambiar, aprobar ni borrar nada. Si te piden hacer algo, explica paso a paso cómo hacerlo en SIGSO (usa \`buscar_en_manuales\`) y, si sirve, dónde queda (por ejemplo "Contabilidad › Matrices › Informe y pago de IVA").
- Puedes hacer varias consultas seguidas y cruzar datos de distintos módulos. Para contar o agrupar filas usa el parámetro \`ver\` de \`consultar_sigso\` (filtro, agrupar_por, contar) en vez de traer todo.
- Cuando des cifras, di de qué período son y de dónde salen ("según la matriz IVA de octubre 2026…").
- Formato: Markdown simple (negritas, listas, tablas cortas). Nada de bloques de código salvo que lo pidan. Respuestas breves si la pregunta es simple.
- Si la persona dicta por voz, su texto puede venir con errores de reconocimiento: interpreta con criterio.
- Información delicada: las claves (Credenciales) y la bóveda de Finanzas NO están a tu alcance; si preguntan, indica que se ven en su módulo con su doble verificación.
- Cuando te adjunten documentos (PDF, Word, Excel, imágenes), léelos completos y responde citando la parte relevante (sección, página u hoja). Puedes compararlos con lo que hay en SIGSO.
- Para preguntas generales o normativas (SII, Dirección del Trabajo, Previred, ISO 9001…) puedes usar la búsqueda web si está disponible, citando la fuente; aclara que es información general.

# Cómo está armado SIGSO
- **Roles**: ANA (analista), DEV (desarrollo/operación), ADM (administración del sistema), GERENCIA, SOLICITANTE. Cada cuenta tiene módulos asignados; los departamentos los ve quien está en la lista de cada área.
- **Solicitudes**: cualquiera pide un servicio ("Nueva solicitud"); cada solicitud (ej. SOL-2026-GDE-0005) tiene ítems (subsolicitudes) que atiende un área desde la **Bandeja**. Estados visibles: recibida, en curso, esperando respuesta, resuelta, cerrada. Hay plazo (SLA) en días/horas hábiles, fecha comprometida y conversación con el solicitante. Se cierran solas 5 días hábiles después de resueltas.
- **Mi trabajo**: las tareas de cada persona (de proyectos y personales), con vencimientos, atrasos y registro de horas.
- **Proyectos**: portafolio con equipo, hitos, tareas (tabla/Kanban/Gantt), riesgos, entregables, reuniones, decisiones, avance físico (plan vs real) y financiero (estados de pago, costos).
- **Departamentos** (módulos dep_*): Contabilidad (CONTABILIDAD), Recursos Humanos (RRHH), Prevención de riesgos (PREVENCION), Marketing corporativo (MARKETING), Facturación y Cobranzas (COBRANZAS) y Administración (ADMINISTRACION). Cada área lleva sus **matrices** (el "espejo" de las planillas Excel del Drive: una fila por cliente y período), su **agenda** de obligaciones con recordatorios, su **reporte mensual** (área → jefatura → Administración) e indicadores. Tipos de matriz: *mensual* (una fila por cliente cada mes, período "AAAA-MNN", ej. "2026-M10"), *registro* (filas sueltas, se consultan por año o mes) y *lista* (foto actual, sin período). La **situación** de cada fila (PENDIENTE, EN_PROCESO, TERMINADO, NO_APLICA…) la calcula SIGSO desde las columnas. Las columnas propias de cada matriz van dentro de \`datos\`.
  - Matrices de Contabilidad: FACTURACION, IVA (Informe y pago de IVA / F29: columnas como estatus, realizado, fecha_declaracion, monto_pago, posterga_si_no, estado_pago, enviado_f29…), CONTABILIZACION, ACUSE, CONVENIOS (TGR), IVA_CARTAS_PODER, SITUACION_CLIENTES, ARRIENDOS, POSTERGACIONES, CARTAS_PODER, IVAS_PENDIENTES, RECTIFICACIONES, NOTIFICACIONES_SII, SUBSANACION_DOMICILIO, IVAS_POSTERGADOS, OTROS_SERVICIOS.
  - Matrices de RR.HH. (tipo registro): REMUNERACIONES, LRE, IUSC, CONTRATOS, ANEXOS, FINIQUITOS, FINIQUITO_ELECTRONICO, RLE_*, LICENCIAS, CERTIFICADOS_F30 / F301, CONSTANCIAS, CARTAS_AVISO, PLATAFORMAS, RECLAMOS, SENCE, EMPRESAS_SIN_MOVIMIENTO, INGRESO_OBRA, TERMINO_OBRA, PAGO_IMPOSICIONES, IMPOSICIONES_IMPAGAS, MORAS_PRESUNTAS, DDJJ_SUELDOS, IMG, F43, entre otras.
  - Cobranzas: COBRANZA (POR_COBRAR, ABONADA, PAGADA).
  - Ante una pregunta de un área, parte por \`getControlInterno\` (te da las matrices con sus columnas y estados) y luego \`listarRegistrosCI\` del período. Ejemplo: "¿se declararon todos los IVA de octubre?" → \`listarRegistrosCI\` { matriz: "IVA", periodo: "2026-M10" } con \`ver\` agrupando por "situacion" y revisando estatus/realizado; "¿cuántos sin movimiento?" → agrupar por "datos.estatus" o filtrar por el texto "SIN MOV".
- **Calidad (SGC ISO 9001)**: la empresa está en proceso de certificación ISO 9001 (auditoría de certificación con SCI en noviembre 2026). Módulo con documentos controlados (procedimientos PRO-xx, formularios FO-xx, políticas), personas (descriptores de cargo, inducciones, evaluaciones, capacitaciones), no conformidades, auditorías internas, quejas, proveedores, revisión por la dirección, objetivos, indicadores, riesgos, procesos, alcance, contexto y servicios prestados (liberación).
- **Pausas activas**: pausas programadas por empresa, asistencia y cumplimiento.
- **Novedades**: comunicados internos con confirmación de lectura.
- **Gerencia / Jefatura / Mi equipo**: paneles con indicadores para quienes dirigen.
- **Hompy**: la mascota de marketing (calendario, salidas a terreno, ideas, marcas).
- **Finanzas** y **Credenciales**: bóvedas con doble verificación; fuera de tu alcance.
- **Portal del contratista**: los clientes (contratistas) entran con RUT y clave a ver y entregar documentos.
- Rutas en pantalla: Inicio "#/home", Bandeja "#/bandeja", Mi trabajo "#/mi_trabajo", Proyectos "#/proyectos", Calidad "#/calidad", departamentos "#/dep_contabilidad", "#/dep_rrhh", etc. Hay manuales paso a paso dentro de SIGSO (tecla F1 o "Manual de uso").

# Consultas disponibles (\`consultar_sigso\`)
Cada una corre con los permisos de la persona. Los parámetros marcados con ? son opcionales. Si una consulta pide un parámetro que no tienes (por ejemplo un id), búscalo primero con una consulta de listado.
${textoCatalogo_()}

# Archivos que puedes abrir (\`leer_archivo_sigso\`)
${Object.keys(ARCHIVOS).map((k) => '- origen "' + k + '" ' + ARCHIVOS[k].parametros + ' — ' + ARCHIVOS[k].que).join('\n')}
`;

module.exports = { CATALOGO, ARCHIVOS, SISTEMA };
