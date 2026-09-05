/**
 * Code.gs — App Gestion (Backoffice)
 *
 * Se publica con "Ejecutar como: usuario que accede" y acceso "Cualquier
 * cuenta de Google" o "Dominio" segun el Workspace real (§2.1, §3.1).
 * Google ya bloquea a quien no pertenece al dominio/no tiene cuenta antes
 * de llegar aqui; igual se valida la identidad de forma defensiva porque
 * no existe token de sesion propio que revisar.
 *
 * Mismo contrato de transporte que Intake: POST + text/plain + JSON;
 * ninguna llamada agrega headers custom ni usa application/json (§4.1).
 * Esto sigue valiendo para llamadas externas (p.ej. otra integracion), pero
 * `app.html`/`admin.html` (Fase 8, ver notas de despliegue) ya NO llaman
 * por fetch: los navegadores bloquean cada vez mas agresivo las cookies de
 * terceros necesarias para autenticar un fetch cross-origin contra un Web
 * App no anonimo, asi que esas paginas ahora las sirve este mismo proyecto
 * via HtmlService (mismo origen) y llaman a `ejecutarAccionBackoffice`
 * mediante `google.script.run` (sin red, sin cookies, sin CORS).
 *
 * Fase 0: transporte, router y resolucion de identidad. Fase 2: resolucion
 * de rol (USUARIOS) y maquina de estados/prioridad. Fase 5: getDashboardData,
 * getSolicitudDetalle y agregarComentario. Fase 6: guardarCatalogo y
 * gestionarUsuario (administracion) ya llaman logica real -- todas las
 * acciones del router (§4.2) estan conectadas desde esta fase.
 */

var BACKOFFICE_ACTIONS = {
  ping: handlePing_,
  getDashboardData: handleGetDashboardData_,
  // v5.2 (Fase B, §3.4): pauta de trabajo por lote (PDF) de un desarrollador.
  getPautaTrabajo: handleGetPautaTrabajo_,
  // v5.2 (mejora OT): genera la Orden de Trabajo en PDF del lado del servidor
  // (con imagenes embebidas y enlaces reales) y la devuelve en base64.
  descargarOrdenTrabajo: handleDescargarOrdenTrabajo_,
  getPanelGerencia: handleGetPanelGerencia_,
  // v5.2 (§4.2): envio manual del reporte ejecutivo, solo ADM.
  enviarReporteGerenciaAhora: handleEnviarReporteGerenciaAhora_,
  // v4.2: panel de Jefatura (solo lectura, acotado al equipo).
  getPanelJefatura: handleGetPanelJefatura_,
  getSolicitudDetalle: handleGetSolicitudDetalle_,
  actualizarEstado: handleActualizarEstado_,
  actualizarPrioridad: handleActualizarPrioridad_,
  editarContenidoSubsolicitud: handleEditarContenidoSubsolicitud_,
  comprometerFecha: handleComprometerFecha_,
  derivarSolicitud: handleDerivarSolicitud_,
  agregarComentario: handleAgregarComentario_,
  guardarCatalogo: handleGuardarCatalogo_,
  listarCatalogo: handleListarCatalogo_,
  gestionarUsuario: handleGestionarUsuario_,
  // v3.3: cuentas de la plataforma (CuentasPortal.gs, solo ADM).
  listarCuentasPortal: handleListarCuentasPortal_,
  gestionarCuentaPortal: handleGestionarCuentaPortal_,
  listarUsuarios: handleListarUsuarios_,
  listarLogs: handleListarLogs_,
  // v4.2: relaciones jefe->subordinado (Jefatura.gs, solo ADM las edita).
  listarJefaturas: handleListarJefaturas_,
  gestionarJefatura: handleGestionarJefatura_,
  // v6.0 (modulo Pausas Activas, Fase P0): configuracion administrable por ADM
  // -- parametros por empresa, coordinadoras (titulares/reemplazos) y roster.
  listarPausasConfig: handleListarPausasConfig_,
  guardarPausasConfig: handleGuardarPausasConfig_,
  listarPausasCoordinadores: handleListarPausasCoordinadores_,
  gestionarPausasCoordinador: handleGestionarPausasCoordinador_,
  listarPausasTrabajadores: handleListarPausasTrabajadores_,
  gestionarPausasTrabajador: handleGestionarPausasTrabajador_,
  // v6.0 (mejora): siembra/asignacion masiva -- evita cargar el roster y el
  // modulo cuenta por cuenta.
  sembrarRosterPausas: handleSembrarRosterPausas_,
  asignarModuloPausasRoster: handleAsignarModuloPausasRoster_,
  // v6.0 Fase P1: programacion + maquina de estados de las pausas.
  listarPausasProgramadas: handleListarPausasProgramadas_,
  programarPausasDelDia: handleProgramarPausasDelDia_,
  gestionarPausaProgramada: handleGestionarPausaProgramada_,
  // v6.0 Fase P2: registro del trabajador (modulo 'pausas').
  getPausaHoyTrabajador: handleGetPausaHoyTrabajador_,
  registrarAsistenciaPausa: handleRegistrarAsistenciaPausa_,
  // v6.0 Fase P3: operacion y reportes del coordinador (modulo 'pausas_coordinacion').
  getPanelCoordinadorPausas: handleGetPanelCoordinadorPausas_,
  gestionarPausaCoordinador: handleGestionarPausaCoordinador_,
  // v7.2 (Bloque A, mejora A1 "pasar lista grupal").
  registrarAsistenciaGrupalPausas: handleRegistrarAsistenciaGrupalPausas_,
  getReporteCumplimientoPausas: handleGetReporteCumplimientoPausas_,
  // v-next: boton "Descargar PDF" del reporte de cumplimiento del coordinador.
  descargarReporteCumplimientoPausasPdf: handleDescargarReporteCumplimientoPausasPdf_,
  // v6.0 (mejora #7): roster + historial por trabajador.
  listarRosterCoordinadorPausas: handleListarRosterCoordinadorPausas_,
  getHistorialTrabajadorPausas: handleGetHistorialTrabajadorPausas_,
  // v6.0 Fase P5: reporte de pausas para el Panel de Gerencia (modulo 'gerencia').
  getReporteGerenciaPausas: handleGetReporteGerenciaPausas_,
  // v-next: boton "Descargar PDF" del reporte de pausas de Gerencia.
  descargarReporteGerenciaPausasPdf: handleDescargarReporteGerenciaPausasPdf_,
  // v6.4 (foto de perfil): gestionar la foto PROPIA. Ninguna de estas
  // acciones recibe un identificador de usuario -- Perfiles.gs deriva la
  // identidad del contexto ya autenticado.
  getMiPerfil: handleGetMiPerfil_,
  guardarFotoPerfil: handleGuardarFotoPerfil_,
  eliminarFotoPerfil: handleEliminarFotoPerfil_,
  getFotosPerfil: handleGetFotosPerfil_,
  // v6.5 (modulo Novedades): igual que las de perfil, sin gate de modulo --
  // disponible a cualquier identidad autenticada (Google o portal).
  listarAreasPublicablesNovedad: handleListarAreasPublicablesNovedad_,
  getFeedNovedades: handleGetFeedNovedades_,
  getDetalleNovedad: handleGetDetalleNovedad_,
  publicarNovedad: handlePublicarNovedad_,
  despublicarNovedad: handleDespublicarNovedad_,
  marcarLeidaNovedad: handleMarcarLeidaNovedad_,
  descargarAdjuntoNovedad: handleDescargarAdjuntoNovedad_,
  // v6.5 Fase 2 (seguimiento de lectura): solo autor/ADM, gate propio dentro
  // de Novedades.getLectores -- sin gate de modulo, igual que el resto.
  getLectoresNovedad: handleGetLectoresNovedad_,
  // v6.6 Fase 4 (gobierno): circuito de aprobacion. Sin gate de modulo --
  // Novedades.gs valida en cada funcion quien puede aprobar/devolver/
  // rechazar/reenviar (jefatura del autor via JEFATURAS, o ADM).
  getHistorialNovedad: handleGetHistorialNovedad_,
  aprobarNovedad: handleAprobarNovedad_,
  devolverNovedad: handleDevolverNovedad_,
  rechazarNovedad: handleRechazarNovedad_,
  reenviarNovedad: handleReenviarNovedad_,
  listarPendientesAprobacionNovedad: handleListarPendientesAprobacionNovedad_,
  misPendientesNovedad: handleMisPendientesNovedad_,
  // v6.8 (Fase 6, cumplimiento): panel de "quien falta y hace cuanto vence" --
  // solo ADM (Novedades.getPanelCumplimiento ya lo valida en el servidor).
  getPanelCumplimientoNovedad: handleGetPanelCumplimientoNovedad_,
  // v7.0 (Fase 1, modulo de Gestion Operacional): CRUD de actividades y
  // maquina de estados. Sin gate de modulo todavia -- el modulo 'mi_trabajo'
  // del shell (F2) es el que decide quien puede llegar aqui desde el
  // portal; el aislamiento real (quien ve/edita que) ya lo impone
  // Actividades.gs por su cuenta (RN-707/708/709), igual que Novedades.
  listarActividades: handleListarActividades_,
  getDetalleActividad: handleGetDetalleActividad_,
  crearActividad: handleCrearActividad_,
  confirmarActividad: handleConfirmarActividad_,
  checkinActividad: handleCheckinActividad_,
  validarActividad: handleValidarActividad_,
  cancelarActividad: handleCancelarActividad_,
  reprogramarActividad: handleReprogramarActividad_,
  // v7.0 (Fase 3, "Actividades del equipo"): el supervisor deja de tener
  // que preguntar. panelEquipoActividades es listar() + desglose por
  // persona; reasignar/pedirActualizacion son acciones de gestion sobre
  // el equipo, no del check-in exclusivo del responsable (RN-702).
  panelEquipoActividades: handlePanelEquipoActividades_,
  reasignarActividad: handleReasignarActividad_,
  pedirActualizacionActividad: handlePedirActualizacionActividad_,
  // v7.0 (Fase 5, "Gerencia y reportes"): pestaña de Actividades en el Panel
  // de Gerencia -- KPIs/mapa de calor/criticas, los 3 motores de reporte en
  // PDF, y la Acta de reunión.
  getPanelGerenciaActividades: handleGetPanelGerenciaActividades_,
  generarReporteActividades: handleGenerarReporteActividades_,
  descargarReporteActividadesPdf: handleDescargarReporteActividadesPdf_,
  descargarActaReunionPdf: handleDescargarActaReunionPdf_,
  // v7.1 (notificaciones vivas): polling del cliente + marcar leida. Sin
  // gate de modulo a proposito, mismo criterio que ping/getMiPerfil -- la
  // identidad ya resuelta por el contexto (Google o portal_token) es la
  // unica proteccion real; toda sesion valida tiene notificaciones propias.
  sincronizarNotificacionesApp: handleSincronizarNotificacionesApp_,
  marcarNotificacionAppLeida: handleMarcarNotificacionAppLeida_,
  marcarTodasNotificacionesAppLeidas: handleMarcarTodasNotificacionesAppLeidas_,
  // v7.3 (Nivel 0): reportar el permiso es de cualquier sesion valida (como
  // ping); listar es solo Admin (gate 'administracion' mas abajo).
  reportarPermisoNotificacionesSO: handleReportarPermisoNotificacionesSO_,
  listarPermisosNotificacionesSO: handleListarPermisosNotificacionesSO_,
  // H-04: que version del backend esta pegada y si la planilla esta al dia.
  getEstadoSistema: handleGetEstadoSistema_,
  // v7.5 (canales de alerta): que categorias mandan correo -- ambas ADM-only.
  listarCanalesAlerta: handleListarCanalesAlerta_,
  guardarCanalAlerta: handleGuardarCanalAlerta_,
  // v7.5 Fase 2 (enviar alerta): megafono manual del Admin -- ambas ADM-only.
  getDirectorioAlerta: handleGetDirectorioAlerta_,
  enviarAlertaManual: handleEnviarAlertaManual_,
  // v9.0 (Modulo de Proyectos, MVP Fase 1): portafolio + sala de trabajo.
  // Las tareas de un proyecto son ACTIVIDADES (Proyectos.crearTarea /
  // listarTareas son wrappers finos sobre Actividades.gs) -- el resto del
  // ciclo de vida de la tarea sigue usando las acciones de Actividades ya
  // conectadas arriba (checkinActividad, reasignarActividad, etc.).
  listarProyectos: handleListarProyectos_,
  // v10 (Fase B, "Mi trabajo en proyectos"): tareas + entregables propios de
  // TODOS mis proyectos, en una sola llamada.
  listarMisTareasProyectos: handleListarMisTareasProyectos_,
  // v10 (Fase G3, "vista transversal por recurso"): la bitácora de esas
  // mismas tareas, para "Mi dedicación" (la Carta de Dedicación cruzando
  // todos mis proyectos).
  listarMiBitacoraProyectos: handleListarMiBitacoraProyectos_,
  // v10 (Fase C, "vista calendario"): fechas comprometidas de tareas, hitos
  // y entregables de todos los proyectos visibles, en una sola llamada.
  listarCalendarioProyectos: handleListarCalendarioProyectos_,
  // v10 (Fase C, "plantillas de proyecto"): guardar la estructura de hitos
  // de un proyecto como plantilla, y listarlas para el selector al crear.
  guardarProyectoComoPlantilla: handleGuardarProyectoComoPlantilla_,
  listarPlantillasProyecto: handleListarPlantillasProyecto_,
  // v10 (Fase D, "reporte PDF del proyecto"): mismo circulo que puede VER
  // el proyecto (es un export de solo lectura, no una accion de gestion).
  descargarReporteProyecto: handleDescargarReporteProyecto_,
  descargarLibroProyecto: handleDescargarLibroProyecto_,
  getInicio: handleGetInicio_,
  // v10 (Fase D, "resumen diario"): marca "vi la Sala" a ahora -- el
  // frontend la llama al abrir la pestaña Sala de un proyecto.
  marcarSalaVisitadaProyecto: handleMarcarSalaVisitadaProyecto_,
  // v10 (Fase D, "adjuntos por proyecto"): subir/bajar archivos de la
  // carpeta Drive del proyecto.
  subirAdjuntoProyecto: handleSubirAdjuntoProyecto_,
  descargarAdjuntoProyecto: handleDescargarAdjuntoProyecto_,
  // v13 (Fase 4, "centro documental"): repositorio versionado, distinto del
  // adjunto suelto de la Sala (arriba).
  gestionarDocumentoProyecto: handleGestionarDocumentoProyecto_,
  subirVersionDocumentoProyecto: handleSubirVersionDocumentoProyecto_,
  marcarVersionVigenteProyecto: handleMarcarVersionVigenteProyecto_,
  listarVersionesDocumentoProyecto: handleListarVersionesDocumentoProyecto_,
  descargarVersionDocumentoProyecto: handleDescargarVersionDocumentoProyecto_,
  descargarDocumentoProyecto: handleDescargarDocumentoProyecto_,
  // v13 (Fase 5, "reuniones formales" + "registro de decisiones").
  gestionarReunionProyecto: handleGestionarReunionProyecto_,
  agregarAcuerdoReunionProyecto: handleAgregarAcuerdoReunionProyecto_,
  eliminarAcuerdoReunionProyecto: handleEliminarAcuerdoReunionProyecto_,
  convertirAcuerdoEnTareaProyecto: handleConvertirAcuerdoEnTareaProyecto_,
  listarReunionesProyecto: handleListarReunionesProyecto_,
  gestionarDecisionProyecto: handleGestionarDecisionProyecto_,
  listarDecisionesProyecto: handleListarDecisionesProyecto_,
  getDetalleProyecto: handleGetDetalleProyecto_,
  // v10 (auditoría G): detalle + tareas + sala en UN solo viaje (antes 3).
  getDetalleCompletoProyecto: handleGetDetalleCompletoProyecto_,
  crearProyecto: handleCrearProyecto_,
  actualizarProyecto: handleActualizarProyecto_,
  gestionarIntegranteProyecto: handleGestionarIntegranteProyecto_,
  gestionarHitoProyecto: handleGestionarHitoProyecto_,
  crearTareaProyecto: handleCrearTareaProyecto_,
  editarTareaProyecto: handleEditarTareaProyecto_,
  listarTareasProyecto: handleListarTareasProyecto_,
  // v10 (Fase E, "Carta de Dedicación"): bitácora de check-ins de todas las
  // tareas del proyecto, para la grilla día x tarea del Cronograma.
  listarBitacoraProyecto: handleListarBitacoraProyecto_,
  // v11 (Reingeniería Cronograma, P0): guarda/edita el registro del día de
  // una tarea (la celda diaria de la Carta Gantt como unidad editable).
  guardarRegistroDiaProyecto: handleGuardarRegistroDiaProyecto_,
  eliminarRegistroDiaProyecto: handleEliminarRegistroDiaProyecto_,
  // v10 (Fase G3, "los números de rendimiento"): unidades/día, horas/
  // unidad y cumplimiento de entregas, derivados de la misma bitácora.
  // v11 (P1): ahora también trae Plan/Esperado/Real por tarea y la baseline
  // vigente (ver Proyectos.obtenerRendimiento).
  obtenerRendimientoProyecto: handleObtenerRendimientoProyecto_,
  // v11 (P1, "congelar línea base" y "reprogramar con motivo").
  congelarBaselineProyecto: handleCongelarBaselineProyecto_,
  reprogramarTareaProyecto: handleReprogramarTareaProyecto_,
  // v11 (P3, "analítica avanzada" y "workload cruzado multi-proyecto").
  obtenerAnaliticaProyecto: handleObtenerAnaliticaProyecto_,
  obtenerWorkloadPortafolioProyectos: handleObtenerWorkloadPortafolioProyectos_,
  listarSalaProyecto: handleListarSalaProyecto_,
  publicarEnSalaProyecto: handlePublicarEnSalaProyecto_,
  convertirEventoEnTareaProyecto: handleConvertirEventoEnTareaProyecto_,
  // v9.4 (Fase 2/3 de la propuesta): entregables (aprobar/observar), riesgos
  // y resumen ejecutivo del portafolio (KPIs + carga por persona).
  gestionarEntregableProyecto: handleGestionarEntregableProyecto_,
  revisarEntregableProyecto: handleRevisarEntregableProyecto_,
  gestionarRiesgoProyecto: handleGestionarRiesgoProyecto_,
  getResumenPortafolioProyectos: handleGetResumenPortafolioProyectos_,
  // v10.0 (Modulo SGC ISO 9001, Fase 1): repositorio documental controlado.
  // Ver documentacion/SIGSO-v10.0-propuesta-modulo-sgc-iso9001.md.
  listarDocumentosSgc: handleListarDocumentosSgc_,
  getDocumentoSgc: handleGetDocumentoSgc_,
  crearDocumentoSgc: handleCrearDocumentoSgc_,
  nuevaVersionDocumentoSgc: handleNuevaVersionDocumentoSgc_,
  actualizarDocumentoSgc: handleActualizarDocumentoSgc_,
  descargarDocumentoSgc: handleDescargarDocumentoSgc_,
  listarRolesSgc: handleListarRolesSgc_,
  gestionarRolSgc: handleGestionarRolSgc_,
  // v10.0 "Accesos SGC": panel admin-only de "quien ve que".
  listarAccesosSgc: handleListarAccesosSgc_,
  previsualizarAccesoSgc: handlePrevisualizarAccesoSgc_,
  // v10.0 "Centro de Control de Accesos": matriz de distribucion y
  // documentos confidenciales -- ambas admin-only, mismo poder que Accesos.
  getMatrizDistribucionSgc: handleGetMatrizDistribucionSgc_,
  getDocumentosConfidencialesSgc: handleGetDocumentosConfidencialesSgc_,
  // v10.0 Fase 1b: acuse de recibo (evidencia de ISO §7.5.3).
  acusarDocumentoSgc: handleAcusarDocumentoSgc_,
  getCumplimientoDocumentoSgc: handleGetCumplimientoDocumentoSgc_,
  // v10.0 Fase 2a (PRO-02): ficha del trabajador.
  listarPersonasSgc: handleListarPersonasSgc_,
  getFichaPersonaSgc: handleGetFichaPersonaSgc_,
  guardarPersonaSgc: handleGuardarPersonaSgc_,
  desvincularPersonaSgc: handleDesvincularPersonaSgc_,
  // v14.0: sacar de la vista a alguien que nunca debió estar en el alcance
  // del SGC (no es una salida real de la empresa -- eso sigue siendo
  // desvincularPersonaSgc).
  quitarPersonaAlcanceSgc: handleQuitarPersonaAlcanceSgc_,
  guardarDescriptorSgc: handleGuardarDescriptorSgc_,
  // v14.0: corregir el descriptor vigente sin versionar, y bajar su archivo.
  actualizarDescriptorSgc: handleActualizarDescriptorSgc_,
  descargarDescriptorSgc: handleDescargarDescriptorSgc_,
  guardarDocumentoPersonaSgc: handleGuardarDocumentoPersonaSgc_,
  descargarDocumentoPersonaSgc: handleDescargarDocumentoPersonaSgc_,
  registrarInduccionSgc: handleRegistrarInduccionSgc_,
  // v10.0 Fase 2b: competencias y capacitaciones.
  registrarEvaluacionSgc: handleRegistrarEvaluacionSgc_,
  listarCapacitacionesSgc: handleListarCapacitacionesSgc_,
  guardarCapacitacionSgc: handleGuardarCapacitacionSgc_,
  registrarRealizacionCapacitacionSgc: handleRegistrarRealizacionCapacitacionSgc_,
  registrarEficaciaCapacitacionSgc: handleRegistrarEficaciaCapacitacionSgc_,
  // v10.0 Fase 3a (PRO-06): no conformidades y acciones correctivas.
  listarNcSgc: handleListarNcSgc_,
  getDetalleNcSgc: handleGetDetalleNcSgc_,
  crearNcSgc: handleCrearNcSgc_,
  registrarCorreccionNcSgc: handleRegistrarCorreccionNcSgc_,
  registrarCausaNcSgc: handleRegistrarCausaNcSgc_,
  registrarAccionNcSgc: handleRegistrarAccionNcSgc_,
  cerrarEtapaNcSgc: handleCerrarEtapaNcSgc_,
  verificarEficaciaNcSgc: handleVerificarEficaciaNcSgc_,
  anularNcSgc: handleAnularNcSgc_,
  // v10.0 Fase 3b (PRO-03): auditoria interna.
  listarAuditoriasSgc: handleListarAuditoriasSgc_,
  getDetalleAuditoriaSgc: handleGetDetalleAuditoriaSgc_,
  programarAuditoriaSgc: handleProgramarAuditoriaSgc_,
  planificarAuditoriaSgc: handlePlanificarAuditoriaSgc_,
  registrarHallazgoSgc: handleRegistrarHallazgoSgc_,
  eliminarHallazgoSgc: handleEliminarHallazgoSgc_,
  cerrarEjecucionAuditoriaSgc: handleCerrarEjecucionAuditoriaSgc_,
  emitirInformeAuditoriaSgc: handleEmitirInformeAuditoriaSgc_,
  convertirHallazgoEnNcSgc: handleConvertirHallazgoEnNcSgc_,
  cerrarAuditoriaSgc: handleCerrarAuditoriaSgc_,
  anularAuditoriaSgc: handleAnularAuditoriaSgc_,
  // v10.0 Fase 4 (PRO-07): quejas, felicitaciones y consultas. La Parte 1
  // (crearQuejaSgc) vive en el Intake, sin cuenta; esto es lo que se
  // gestiona con sesion.
  listarQuejasSgc: handleListarQuejasSgc_,
  getDetalleQuejaSgc: handleGetDetalleQuejaSgc_,
  registrarRecepcionQuejaSgc: handleRegistrarRecepcionQuejaSgc_,
  registrarInvestigacionQuejaSgc: handleRegistrarInvestigacionQuejaSgc_,
  registrarResultadoQuejaSgc: handleRegistrarResultadoQuejaSgc_,
  registrarResolucionQuejaSgc: handleRegistrarResolucionQuejaSgc_,
  convertirQuejaEnNcSgc: handleConvertirQuejaEnNcSgc_,
  registrarNotificacionQuejaSgc: handleRegistrarNotificacionQuejaSgc_,
  registrarSeguimientoQuejaSgc: handleRegistrarSeguimientoQuejaSgc_,
  anularQuejaSgc: handleAnularQuejaSgc_,

  // v10.0 Fase 5a (PRO-04): proveedores externos.
  listarProveedoresSgc: handleListarProveedoresSgc_,
  getDetalleProveedorSgc: handleGetDetalleProveedorSgc_,
  guardarProveedorSgc: handleGuardarProveedorSgc_,
  evaluarProveedorSgc: handleEvaluarProveedorSgc_,
  desactivarProveedorSgc: handleDesactivarProveedorSgc_,

  // v10.0 Fase 5b (PRO-05): revision por la direccion.
  listarRevisionesSgc: handleListarRevisionesSgc_,
  getDetalleRevisionSgc: handleGetDetalleRevisionSgc_,
  getResumenRevisionSgc: handleGetResumenRevisionSgc_,
  programarRevisionSgc: handleProgramarRevisionSgc_,
  convocarRevisionSgc: handleConvocarRevisionSgc_,
  registrarActaRevisionSgc: handleRegistrarActaRevisionSgc_,
  registrarAcuerdoRevisionSgc: handleRegistrarAcuerdoRevisionSgc_,
  cerrarRevisionSgc: handleCerrarRevisionSgc_,
  anularRevisionSgc: handleAnularRevisionSgc_,

  // v10.0 Fase 6a (DOC-07): tablero de objetivos de calidad.
  listarObjetivosSgc: handleListarObjetivosSgc_,
  getDetalleObjetivoSgc: handleGetDetalleObjetivoSgc_,
  sembrarAnioObjetivosSgc: handleSembrarAnioObjetivosSgc_,
  guardarObjetivoSgc: handleGuardarObjetivoSgc_,
  sugerirLecturaObjetivoSgc: handleSugerirLecturaObjetivoSgc_,
  registrarLecturaObjetivoSgc: handleRegistrarLecturaObjetivoSgc_,
  anularLecturaObjetivoSgc: handleAnularLecturaObjetivoSgc_,

  // v10.0 Fase 6b: matriz de cobertura ISO + "modo auditoria".
  listarMatrizCoberturaSgc: handleListarMatrizCoberturaSgc_,
  getDetalleClausulaCoberturaSgc: handleGetDetalleClausulaCoberturaSgc_,
  descargarEvidenciaClausulaSgc: handleDescargarEvidenciaClausulaSgc_,
  // v11.0 Fase 1 (§4.3): alcance del SGC y exclusiones.
  obtenerAlcanceSgc: handleObtenerAlcanceSgc_,
  guardarAlcanceSgc: handleGuardarAlcanceSgc_,
  nuevaVersionAlcanceSgc: handleNuevaVersionAlcanceSgc_,
  guardarExclusionSgc: handleGuardarExclusionSgc_,
  anularExclusionSgc: handleAnularExclusionSgc_,

  // v11.0 Fase 2 (§4.1 y §4.2): contexto de la organizacion y partes interesadas.
  obtenerContextoSgc: handleObtenerContextoSgc_,
  sembrarFodaSgc: handleSembrarFodaSgc_,
  guardarFactorContextoSgc: handleGuardarFactorContextoSgc_,
  anularFactorContextoSgc: handleAnularFactorContextoSgc_,
  registrarRevisionContextoSgc: handleRegistrarRevisionContextoSgc_,
  sembrarPartesSgc: handleSembrarPartesSgc_,
  guardarParteInteresadaSgc: handleGuardarParteInteresadaSgc_,
  anularParteInteresadaSgc: handleAnularParteInteresadaSgc_,

  // v11.0 Fase 3 (§6.1): riesgos y oportunidades.
  listarRiesgosSgc: handleListarRiesgosSgc_,
  sembrarRiesgosSgc: handleSembrarRiesgosSgc_,
  guardarRiesgoSgc: handleGuardarRiesgoSgc_,
  asignarAccionRiesgoSgc: handleAsignarAccionRiesgoSgc_,
  registrarRevisionRiesgosSgc: handleRegistrarRevisionRiesgosSgc_,
  anularRiesgoSgc: handleAnularRiesgoSgc_,

  // v11.0 Fase 4 (§4.4): procesos del SGC.
  listarProcesosSgc: handleListarProcesosSgc_,
  getDetalleProcesoSgc: handleGetDetalleProcesoSgc_,
  sembrarMapaProcesosSgc: handleSembrarMapaProcesosSgc_,
  guardarProcesoSgc: handleGuardarProcesoSgc_,
  anularProcesoSgc: handleAnularProcesoSgc_,
  registrarRevisionProcesosSgc: handleRegistrarRevisionProcesosSgc_,

  // v11.0 Fase 5 (§7.5.3.2): listado de documentos de origen externo.
  sembrarDocumentosExternosSgc: handleSembrarDocumentosExternosSgc_,

  // v11.0 Fase 6 (§9.1.1): indicadores de proceso.
  listarIndicadoresSgc: handleListarIndicadoresSgc_,
  guardarIndicadorSgc: handleGuardarIndicadorSgc_,
  anularIndicadorSgc: handleAnularIndicadorSgc_,
  registrarLecturaIndicadorSgc: handleRegistrarLecturaIndicadorSgc_,
  anularLecturaIndicadorSgc: handleAnularLecturaIndicadorSgc_,

  // v11.0 Fase 7: tablero del SGC.
  resumenTableroSgc: handleResumenTableroSgc_,

  // v11.0 Fase 8 (§8.1/8.5/8.6/8.7): evidencia de servicios prestados.
  listarPrestacionesSgc: handleListarPrestacionesSgc_,
  registrarPrestacionSgc: handleRegistrarPrestacionSgc_,
  liberarPrestacionSgc: handleLiberarPrestacionSgc_,
  marcarNoConformePrestacionSgc: handleMarcarNoConformePrestacionSgc_,
  abrirNcPrestacionSgc: handleAbrirNcPrestacionSgc_,
  anularPrestacionSgc: handleAnularPrestacionSgc_
};

// ?page=app / ?page=admin sirve la UI real (Fase 8); sin ese parametro se
// mantiene el health-check JSON de siempre (usado por monitoreo/tests).
var PAGINAS_HTML = { app: 'App', admin: 'Admin' };

// v3.3 P3 (SIGSO-v3.3-propuesta-plataforma-modular.md §2.3): que modulo de
// la plataforma exige cada accion. Solo aplica a contextos de PORTAL (token):
// el camino Google (Session) mantiene su autorizacion por rol de siempre.
// Esta es la mitad backend de "el shell esconde botones": esconder no
// protege nada -- aqui se rechaza aunque manipulen el navegador.
var MODULO_POR_ACCION = {
  getDashboardData: 'bandeja',
  getPautaTrabajo: 'bandeja',
  descargarOrdenTrabajo: 'bandeja',
  // Ver el detalle es de lectura y Gerencia ya lo necesita desde su propio
  // panel (Solicitudes.getDetalle ya le devuelve una version de solo lectura
  // -- sin transiciones ni responsables -- para el rol GERENCIA). Por eso
  // acepta CUALQUIERA de los dos modulos, a diferencia del resto de acciones
  // de bandeja, que siguen exigiendo 'bandeja' exclusivamente.
  // v4.2: Jefatura tambien necesita el detalle de solo lectura desde su
  // propio panel, igual que Gerencia (getDetalle ya valida por su cuenta
  // que la solicitud pertenezca al equipo del jefe, ver Solicitudes.gs).
  getSolicitudDetalle: ['bandeja', 'gerencia', 'jefatura'],
  actualizarEstado: 'bandeja',
  actualizarPrioridad: 'bandeja',
  editarContenidoSubsolicitud: 'bandeja',
  comprometerFecha: 'bandeja',
  derivarSolicitud: 'bandeja',
  agregarComentario: 'bandeja',
  getPanelGerencia: 'gerencia',
  // v5.2 (§4.2): el boton vive en el panel de Gerencia, pero Notificaciones.
  // enviarReporteEjecutivoAhora ya rechaza a cualquiera que no sea ADM --
  // esto solo exige el modulo (mismo criterio que el resto de "gerencia").
  enviarReporteGerenciaAhora: 'gerencia',
  getPanelJefatura: 'jefatura',
  guardarCatalogo: 'administracion',
  listarCatalogo: 'administracion',
  listarPermisosNotificacionesSO: 'administracion',
  getEstadoSistema: 'administracion',
  listarCanalesAlerta: 'administracion',
  guardarCanalAlerta: 'administracion',
  getDirectorioAlerta: 'administracion',
  enviarAlertaManual: 'administracion',
  gestionarUsuario: 'administracion',
  listarUsuarios: 'administracion',
  listarLogs: 'administracion',
  listarCuentasPortal: 'administracion',
  gestionarCuentaPortal: 'administracion',
  listarJefaturas: 'administracion',
  gestionarJefatura: 'administracion',
  // v6.0 (Fase P0): la config de pausas se administra desde Administracion.
  listarPausasConfig: 'administracion',
  guardarPausasConfig: 'administracion',
  listarPausasCoordinadores: 'administracion',
  gestionarPausasCoordinador: 'administracion',
  listarPausasTrabajadores: 'administracion',
  gestionarPausasTrabajador: 'administracion',
  sembrarRosterPausas: 'administracion',
  asignarModuloPausasRoster: 'administracion',
  listarPausasProgramadas: 'administracion',
  programarPausasDelDia: 'administracion',
  gestionarPausaProgramada: 'administracion',
  // v6.0 Fase P2: el trabajador registra su participacion desde el modulo
  // 'pausas' (cualquier cuenta con ese modulo, tipicamente via enlace magico).
  getPausaHoyTrabajador: 'pausas',
  registrarAsistenciaPausa: 'pausas',
  // v6.0 Fase P3: la coordinadora opera y ve reportes desde su modulo.
  getPanelCoordinadorPausas: 'pausas_coordinacion',
  gestionarPausaCoordinador: 'pausas_coordinacion',
  registrarAsistenciaGrupalPausas: 'pausas_coordinacion',
  getReporteCumplimientoPausas: 'pausas_coordinacion',
  descargarReporteCumplimientoPausasPdf: 'pausas_coordinacion',
  // v6.0 (mejora #7): roster + historial por trabajador (misma pestana de reportes).
  listarRosterCoordinadorPausas: 'pausas_coordinacion',
  getHistorialTrabajadorPausas: 'pausas_coordinacion',
  // v6.0 Fase P5: la pestana de pausas vive en el Panel de Gerencia.
  getReporteGerenciaPausas: 'gerencia',
  descargarReporteGerenciaPausasPdf: 'gerencia',
  // v7.0 (Fase 2): "Mi trabajo" -- el colaborador ve y actualiza SUS
  // propias actividades.
  // v7.0 (Fase 3): "Actividades del equipo" vive dentro de 'jefatura' --
  // listar/detalle/cancelar/reprogramar aceptan CUALQUIERA de los dos
  // modulos (igual patron que getSolicitudDetalle), porque tanto "Mi
  // trabajo" como la vista del supervisor llaman las mismas acciones. El
  // check-in (RN-702, exclusivo del responsable) y crear/confirmar quedan
  // SOLO en 'mi_trabajo' -- no son acciones de gestion de equipo.
  listarActividades: ['mi_trabajo', 'jefatura'],
  getDetalleActividad: ['mi_trabajo', 'jefatura'],
  crearActividad: 'mi_trabajo',
  confirmarActividad: 'mi_trabajo',
  // v10 Proyectos (Fase A, "check-in inline"): una tarea de proyecto es una
  // ACTIVIDADES normal (Proyectos.gs no reimplementa nada), asi que el mismo
  // check-in de "Mi trabajo" tiene que poder llamarse tambien desde una
  // cuenta que solo tiene el modulo 'proyectos' (no necesariamente
  // 'mi_trabajo'). El limite real de seguridad sigue siendo el de siempre --
  // Actividades.checkin exige ser el responsable de ESA actividad (RN-702) --
  // esto solo amplia QUIEN puede intentarlo, no relaja esa validacion.
  checkinActividad: ['mi_trabajo', 'proyectos'],
  cancelarActividad: ['mi_trabajo', 'jefatura'],
  reprogramarActividad: ['mi_trabajo', 'jefatura'],
  // validarActividad queda sin gate a proposito (ver comentario general de
  // esta tabla mas abajo, mismo criterio que la foto de perfil): hoy solo
  // lo usa una supervision desde Google, sin necesidad de exigir modulo.
  panelEquipoActividades: 'jefatura',
  reasignarActividad: 'jefatura',
  getPanelGerenciaActividades: 'gerencia',
  generarReporteActividades: 'gerencia',
  descargarReporteActividadesPdf: 'gerencia',
  descargarActaReunionPdf: 'gerencia',
  pedirActualizacionActividad: 'jefatura',
  // v9.0 (Modulo de Proyectos): el modulo 'proyectos' es el gate GRUESO;
  // la membresia en PROYECTO_INTEGRANTES (Proyectos.gs) es el gate FINO
  // (quien ve/edita que proyecto). getDetalleProyecto/listarTareasProyecto/
  // listarSalaProyecto tambien aceptan 'gerencia' -- mismo patron que
  // getSolicitudDetalle: Gerencia necesita poder abrir el detalle de
  // cualquier proyecto desde su propio panel, de solo lectura (Proyectos.gs
  // ya lo permite: puedeVerProyecto_ acepta rol GERENCIA).
  listarProyectos: ['proyectos', 'gerencia'],
  listarMisTareasProyectos: 'proyectos',
  listarMiBitacoraProyectos: 'proyectos',
  // v10 (Fase C): mismo criterio que listarProyectos -- vista de portafolio,
  // Gerencia tambien debe poder verla.
  listarCalendarioProyectos: ['proyectos', 'gerencia'],
  // v10 (Fase C): mismo gate que crearProyecto -- son parte del mismo flujo.
  guardarProyectoComoPlantilla: 'proyectos',
  listarPlantillasProyecto: 'proyectos',
  descargarReporteProyecto: ['proyectos', 'gerencia'],
  descargarLibroProyecto: ['proyectos', 'gerencia'],
  marcarSalaVisitadaProyecto: ['proyectos', 'gerencia'],
  subirAdjuntoProyecto: 'proyectos',
  descargarAdjuntoProyecto: ['proyectos', 'gerencia'],
  gestionarDocumentoProyecto: 'proyectos',
  subirVersionDocumentoProyecto: 'proyectos',
  marcarVersionVigenteProyecto: 'proyectos',
  listarVersionesDocumentoProyecto: ['proyectos', 'gerencia'],
  descargarVersionDocumentoProyecto: ['proyectos', 'gerencia'],
  descargarDocumentoProyecto: ['proyectos', 'gerencia'],
  gestionarReunionProyecto: 'proyectos',
  agregarAcuerdoReunionProyecto: 'proyectos',
  eliminarAcuerdoReunionProyecto: 'proyectos',
  convertirAcuerdoEnTareaProyecto: 'proyectos',
  listarReunionesProyecto: ['proyectos', 'gerencia'],
  gestionarDecisionProyecto: 'proyectos',
  listarDecisionesProyecto: ['proyectos', 'gerencia'],
  getDetalleProyecto: ['proyectos', 'gerencia'],
  getDetalleCompletoProyecto: ['proyectos', 'gerencia'],
  crearProyecto: 'proyectos',
  actualizarProyecto: 'proyectos',
  gestionarIntegranteProyecto: 'proyectos',
  gestionarHitoProyecto: 'proyectos',
  crearTareaProyecto: 'proyectos',
  editarTareaProyecto: 'proyectos',
  listarTareasProyecto: ['proyectos', 'gerencia'],
  listarBitacoraProyecto: ['proyectos', 'gerencia'],
  guardarRegistroDiaProyecto: 'proyectos',
  eliminarRegistroDiaProyecto: 'proyectos',
  obtenerRendimientoProyecto: ['proyectos', 'gerencia'],
  congelarBaselineProyecto: 'proyectos',
  reprogramarTareaProyecto: 'proyectos',
  obtenerAnaliticaProyecto: ['proyectos', 'gerencia'],
  obtenerWorkloadPortafolioProyectos: ['proyectos', 'gerencia'],
  listarSalaProyecto: ['proyectos', 'gerencia'],
  publicarEnSalaProyecto: 'proyectos',
  convertirEventoEnTareaProyecto: 'proyectos',
  // v9.4: entregables/riesgos son gestion dentro del proyecto -- mismo gate
  // que crearTareaProyecto (el gate fino, LIDER vs resto, lo aplica
  // Proyectos.gs). getResumenPortafolioProyectos acepta 'gerencia' tambien
  // (mismo patron que listarProyectos: es una vista transversal de solo
  // lectura, y Gerencia ya la necesita para su propio panel).
  gestionarEntregableProyecto: 'proyectos',
  revisarEntregableProyecto: 'proyectos',
  gestionarRiesgoProyecto: 'proyectos',
  getResumenPortafolioProyectos: ['proyectos', 'gerencia'],
  // v10.0 (Modulo SGC ISO 9001): el modulo 'calidad' es el gate GRUESO; el
  // rol dentro del SGC (SGC_ROLES, ver Calidad.gs) es el gate FINO -- que
  // ademas decide QUE documentos ve cada persona, no solo si entra.
  // Las de lectura aceptan tambien 'gerencia', mismo patron que
  // listarProyectos: Gerencia necesita ver el estado del SGC desde su
  // panel, de solo lectura (Calidad.gs ya lo permite en veTodoSgc_).
  listarDocumentosSgc: ['calidad', 'gerencia'],
  getDocumentoSgc: ['calidad', 'gerencia'],
  descargarDocumentoSgc: ['calidad', 'gerencia'],
  crearDocumentoSgc: 'calidad',
  nuevaVersionDocumentoSgc: 'calidad',
  actualizarDocumentoSgc: 'calidad',
  listarRolesSgc: 'calidad',
  gestionarRolSgc: 'calidad',
  listarAccesosSgc: 'calidad',
  previsualizarAccesoSgc: 'calidad',
  getMatrizDistribucionSgc: 'calidad',
  getDocumentosConfidencialesSgc: 'calidad',
  // v10.0 Fase 1b: confirmar la lectura es del personal (mismo gate de
  // lectura); ver quien falta es gestion (Calidad.gs lo acota a ENCARGADO_SGC/ADM).
  acusarDocumentoSgc: ['calidad', 'gerencia'],
  getCumplimientoDocumentoSgc: 'calidad',
  // v10.0 Fase 2a: el gate fino (QUE ficha ve cada quien -- el personal
  // operativo solo la suya) lo aplica Personas.gs, no esta tabla.
  listarPersonasSgc: ['calidad', 'gerencia'],
  getFichaPersonaSgc: ['calidad', 'gerencia'],
  descargarDocumentoPersonaSgc: ['calidad', 'gerencia'],
  descargarDescriptorSgc: ['calidad', 'gerencia'],
  guardarPersonaSgc: 'calidad',
  desvincularPersonaSgc: 'calidad',
  quitarPersonaAlcanceSgc: 'calidad',
  guardarDescriptorSgc: 'calidad',
  actualizarDescriptorSgc: 'calidad',
  guardarDocumentoPersonaSgc: 'calidad',
  registrarInduccionSgc: 'calidad',
  // v10.0 Fase 2b: el programa de capacitacion es de lectura general dentro
  // del SGC (todos deben poder ver a que se los convoco); registrar y
  // evaluar lo acota Personas.gs al Encargado SGC / jefatura.
  listarCapacitacionesSgc: ['calidad', 'gerencia'],
  registrarEvaluacionSgc: 'calidad',
  guardarCapacitacionSgc: 'calidad',
  registrarRealizacionCapacitacionSgc: 'calidad',
  registrarEficaciaCapacitacionSgc: 'calidad',
  // v10.0 Fase 3a: quien ve QUE no conformidad lo acota NoConformidades.gs
  // (quien gobierna el SGC ve todas; el resto, solo las suyas).
  listarNcSgc: ['calidad', 'gerencia'],
  getDetalleNcSgc: ['calidad', 'gerencia'],
  crearNcSgc: 'calidad',
  registrarCorreccionNcSgc: 'calidad',
  registrarCausaNcSgc: 'calidad',
  registrarAccionNcSgc: 'calidad',
  cerrarEtapaNcSgc: 'calidad',
  verificarEficaciaNcSgc: 'calidad',
  anularNcSgc: 'calidad',
  // v10.0 Fase 3b: igual criterio -- quien ve QUE auditoria lo acota
  // Auditorias.gs (auditor, auditados y area, ademas de quien gobierna).
  listarAuditoriasSgc: ['calidad', 'gerencia'],
  getDetalleAuditoriaSgc: ['calidad', 'gerencia'],
  programarAuditoriaSgc: 'calidad',
  planificarAuditoriaSgc: 'calidad',
  registrarHallazgoSgc: 'calidad',
  eliminarHallazgoSgc: 'calidad',
  cerrarEjecucionAuditoriaSgc: 'calidad',
  emitirInformeAuditoriaSgc: 'calidad',
  convertirHallazgoEnNcSgc: 'calidad',
  cerrarAuditoriaSgc: 'calidad',
  anularAuditoriaSgc: 'calidad',
  // v10.0 Fase 4: igual criterio -- Quejas.gs acota por su cuenta quien ve
  // que queja (gobierna ve todas; el investigador asignado, la suya).
  listarQuejasSgc: ['calidad', 'gerencia'],
  getDetalleQuejaSgc: ['calidad', 'gerencia'],
  registrarRecepcionQuejaSgc: 'calidad',
  registrarInvestigacionQuejaSgc: 'calidad',
  registrarResultadoQuejaSgc: 'calidad',
  registrarResolucionQuejaSgc: 'calidad',
  convertirQuejaEnNcSgc: 'calidad',
  registrarNotificacionQuejaSgc: 'calidad',
  registrarSeguimientoQuejaSgc: 'calidad',
  anularQuejaSgc: 'calidad',

  // v10.0 Fase 5a: el listado de proveedores tambien lo consulta Gerencia
  // (el desempeño de los proveedores externos es una entrada obligatoria de
  // la revision por la direccion, §9.3.2).
  listarProveedoresSgc: ['calidad', 'gerencia'],
  getDetalleProveedorSgc: ['calidad', 'gerencia'],
  guardarProveedorSgc: 'calidad',
  evaluarProveedorSgc: 'calidad',
  desactivarProveedorSgc: 'calidad',

  // v10.0 Fase 5b: la revision por la direccion la EJECUTA la Direccion
  // (PRO-05 §4), asi que Gerencia tiene que poder leerla aunque no gestione
  // el SGC. Registrarla y cerrarla sigue siendo del Encargado SGC, que es
  // quien "verifica, organiza y coordina" segun el mismo punto.
  listarRevisionesSgc: ['calidad', 'gerencia'],
  getDetalleRevisionSgc: ['calidad', 'gerencia'],
  getResumenRevisionSgc: ['calidad', 'gerencia'],
  programarRevisionSgc: 'calidad',
  convocarRevisionSgc: 'calidad',
  registrarActaRevisionSgc: 'calidad',
  registrarAcuerdoRevisionSgc: 'calidad',
  cerrarRevisionSgc: 'calidad',
  anularRevisionSgc: 'calidad',

  // v10.0 Fase 6a (DOC-07): objetivos de calidad. Gerencia consulta el
  // tablero sin poder tocarlo -- el grado de logro de los objetivos es
  // entrada de la revision por la direccion (§9.3.2 e), asi que tiene que
  // poder verlo, pero medir es responsabilidad del Encargado SGC.
  listarObjetivosSgc: ['calidad', 'gerencia'],
  getDetalleObjetivoSgc: ['calidad', 'gerencia'],
  sembrarAnioObjetivosSgc: 'calidad',
  guardarObjetivoSgc: 'calidad',
  sugerirLecturaObjetivoSgc: 'calidad',
  registrarLecturaObjetivoSgc: 'calidad',
  anularLecturaObjetivoSgc: 'calidad',

  // v10.0 Fase 6b: matriz de cobertura ISO + "modo auditoria". Es de solo
  // lectura del lado del gate coarse -- el fino (auditor externo incluido)
  // lo resuelve veTodoSgc_ adentro del modulo, mismo criterio que el resto
  // del SGC.
  listarMatrizCoberturaSgc: ['calidad', 'gerencia'],
  getDetalleClausulaCoberturaSgc: ['calidad', 'gerencia'],
  descargarEvidenciaClausulaSgc: ['calidad', 'gerencia'],

  // v11.0 Fase 1: el alcance se LEE con solo entrar a Calidad -- §4.3 pide
  // que este disponible, y es lo mas publico que tiene un SGC. Declararlo y
  // excluir clausulas es del Encargado, y eso lo resuelve gobiernaSgc_
  // adentro del modulo.
  obtenerAlcanceSgc: ['calidad', 'gerencia'],
  guardarAlcanceSgc: 'calidad',
  nuevaVersionAlcanceSgc: 'calidad',
  guardarExclusionSgc: 'calidad',
  anularExclusionSgc: 'calidad',

  // v11.0 Fase 2: el contexto se LEE con solo entrar a Calidad -- conocer
  // en que entorno opera la organizacion es parte de la toma de conciencia
  // (§7.3), no informacion reservada. Editarlo es del Encargado.
  obtenerContextoSgc: ['calidad', 'gerencia'],
  sembrarFodaSgc: 'calidad',
  guardarFactorContextoSgc: 'calidad',
  anularFactorContextoSgc: 'calidad',
  registrarRevisionContextoSgc: 'calidad',
  sembrarPartesSgc: 'calidad',
  guardarParteInteresadaSgc: 'calidad',
  anularParteInteresadaSgc: 'calidad',

  // v11.0 Fase 3: la matriz de riesgos la LEE quien tiene lectura amplia
  // del SGC (el gate fino lo resuelve veTodoSgc_ dentro del modulo);
  // editarla es del Encargado.
  listarRiesgosSgc: ['calidad', 'gerencia'],
  sembrarRiesgosSgc: 'calidad',
  guardarRiesgoSgc: 'calidad',
  asignarAccionRiesgoSgc: 'calidad',
  registrarRevisionRiesgosSgc: 'calidad',
  anularRiesgoSgc: 'calidad',

  // v11.0 Fase 4: el mapa de procesos lo LEE cualquiera que entre a
  // Calidad -- saber como opera la organizacion es toma de conciencia
  // (§7.3). Editarlo es del Encargado.
  listarProcesosSgc: ['calidad', 'gerencia'],
  getDetalleProcesoSgc: ['calidad', 'gerencia'],
  sembrarMapaProcesosSgc: 'calidad',
  guardarProcesoSgc: 'calidad',
  anularProcesoSgc: 'calidad',
  registrarRevisionProcesosSgc: 'calidad',
  sembrarDocumentosExternosSgc: 'calidad',

  // v11.0 Fase 6: el tablero de indicadores lo LEE quien tiene lectura
  // amplia del SGC; definir y medir es del Encargado.
  listarIndicadoresSgc: ['calidad', 'gerencia'],
  guardarIndicadorSgc: 'calidad',
  anularIndicadorSgc: 'calidad',
  registrarLecturaIndicadorSgc: 'calidad',
  anularLecturaIndicadorSgc: 'calidad',
  resumenTableroSgc: ['calidad', 'gerencia'],

  // v11.0 Fase 8: el registro de servicios lo LEE quien supervisa el SGC;
  // registrar y liberar es del Encargado.
  listarPrestacionesSgc: ['calidad', 'gerencia'],
  registrarPrestacionSgc: 'calidad',
  liberarPrestacionSgc: 'calidad',
  marcarNoConformePrestacionSgc: 'calidad',
  abrirNcPrestacionSgc: 'calidad',
  anularPrestacionSgc: 'calidad'
  // ping: sin modulo -- cualquier sesion valida.
  //
  // v6.4 (foto de perfil): getMiPerfil / guardarFotoPerfil /
  // eliminarFotoPerfil / getFotosPerfil tampoco llevan gate de modulo, a
  // proposito. Gestionar la foto PROPIA no pertenece a ningun modulo: toda
  // cuenta autenticada tiene perfil, igual que toda cuenta puede cerrar
  // sesion. La proteccion no es el modulo sino que la identidad se deriva
  // del contexto (Perfiles.gs), nunca de un parametro del navegador.
  //
  // v6.5 (modulo Novedades): mismo criterio -- leer el feed y dar acuse es
  // de cualquier identidad autenticada, sin gate de modulo. Publicar SI se
  // protege, pero por CAT_AREAS.responsable_email/rol ADM dentro de
  // Novedades.gs, no por el modulo del portal.
};

function doGet(e) {
  var pagina = e && e.parameter && e.parameter.page;
  var archivo = PAGINAS_HTML[pagina];
  if (archivo) {
    return HtmlService.createHtmlOutputFromFile(archivo)
      .setTitle('SIGSO - ' + (pagina === 'admin' ? 'Administracion' : 'Backoffice'))
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return jsonResponse_({ ok: true, data: { servicio: 'SIGSO Backoffice', estado: 'activo' } });
}

function doPost(e) {
  try {
    // v3.3 P3: el body se parsea ANTES de resolver identidad, porque el
    // token de la plataforma viaja en el body (portal_token). El contrato de
    // transporte no cambia (POST text/plain, sin headers custom, §4.1).
    var body = parseRequestBody_(e);
    var handler = BACKOFFICE_ACTIONS[body.action];
    if (!handler) {
      return jsonResponse_({
        ok: false,
        error: 'validation',
        message: 'Accion desconocida: ' + body.action,
        fields: ['action']
      });
    }

    var resuelto = resolverIdentidadYRol_(body.data && body.data.portal_token, body.action);
    if (resuelto.error) {
      return jsonResponse_(resuelto.error);
    }
    return handler(body.data || {}, resuelto.contexto);
  } catch (err) {
    var ref = logError_(err, 'Backoffice.doPost');
    // Backoffice es solo-staff: se incluye el motivo real para que el error
    // se vea en pantalla y no haya que entrar a los logs para diagnosticar.
    return jsonResponse_({ ok: false, error: 'internal', ref: ref, message: 'Error interno: ' + mensajeError_(err) });
  }
}

// Motivo corto y legible de una excepcion, para mostrarlo en pantalla.
function mensajeError_(err) {
  return String(err && err.message ? err.message : err).slice(0, 300);
}

// Puente para app.html/admin.html servidos via HtmlService (Fase 8):
// mismo router y misma resolucion de identidad/rol que doPost, pero
// invocado por google.script.run (sin red) en vez de un POST. Devuelve el
// objeto plano (no un ContentService) porque google.script.run serializa
// el valor de retorno directamente.
function ejecutarAccionBackoffice(action, data) {
  try {
    var resuelto = resolverIdentidadYRol_();
    if (resuelto.error) {
      return resuelto.error;
    }

    var handler = BACKOFFICE_ACTIONS[action];
    if (!handler) {
      return { ok: false, error: 'validation', message: 'Accion desconocida: ' + action, fields: ['action'] };
    }
    var salida = handler(data || {}, resuelto.contexto);
    return JSON.parse(salida.getContent());
  } catch (err) {
    var ref = logError_(err, 'Backoffice.ejecutarAccionBackoffice:' + action);
    return { ok: false, error: 'internal', ref: ref, message: 'Error interno: ' + mensajeError_(err) };
  }
}

// v6.9 (rendimiento): cada minuto de gracia entre escrituras de
// ultimo_acceso. Antes se escribia en la hoja en CADA request -- incluso en
// las de solo lectura -- y una escritura en Sheets es de lo mas lento que
// hay en Apps Script. Con esto se escribe como maximo 1 vez cada 10 min por
// identidad.
//
// No afecta a RN-029: Auth.suspenderInactivos compara ultimo_acceso contra
// un umbral en DIAS, asi que un desfase de minutos es irrelevante. Si el
// CacheService no estuviera disponible, se escribe igual (el fallback es el
// comportamiento anterior, nunca perder el registro).
var MINUTOS_GRACIA_ULTIMO_ACCESO = 10;

function registrarUltimoAccesoThrottled_(claveIdentidad, escribir) {
  var clave = 'ultimo_acceso::' + claveIdentidad;
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get(clave)) return; // ya se registro hace poco
    escribir();
    cache.put(clave, '1', MINUTOS_GRACIA_ULTIMO_ACCESO * 60);
  } catch (err) {
    escribir();
  }
}

// Compartido por doPost y ejecutarAccionBackoffice: resuelve email+rol o
// devuelve el objeto de error listo para responder (evita repetir la
// misma validacion en los dos puntos de entrada).
//
// v3.3 P3: dos caminos de identidad. Si viene un token de la plataforma, la
// identidad sale de CUENTAS_PORTAL/SESIONES_PORTAL y SOLO de ahi -- un token
// invalido NUNCA cae al camino de Session (si lo hiciera, en la
// implementacion "ejecutar como yo / cualquiera" un token vencido podria
// heredar la identidad equivocada). Sin token, el camino Google de siempre.
function resolverIdentidadYRol_(portalToken, action) {
  if (portalToken) {
    return resolverContextoPortal_(portalToken, action);
  }
  var email = getIdentidadActiva_();
  if (!email) {
    return { error: { ok: false, error: 'forbidden', message: 'No fue posible resolver la identidad del dominio.' } };
  }
  var rol = obtenerRolUsuario_(email);
  if (!rol) {
    return {
      error: {
        ok: false,
        error: 'forbidden',
        message: 'El usuario ' + email + ' no esta registrado o esta inactivo en SIGSO.'
      }
    };
  }
  // RN-029: Auth.suspenderInactivos() (Fase 7) decide en base a este campo;
  // sin registrarlo aqui, todos los usuarios activos se verian "inactivos".
  registrarUltimoAccesoThrottled_('u:' + email, function () {
    actualizarFilaPorId_(SHEETS.USUARIOS, 'email', email, { ultimo_acceso: new Date().toISOString() });
  });
  return { contexto: { email: email, rol: rol } };
}

// v3.3 P3: identidad desde una sesion de la plataforma. La hoja es la
// verdad: token vigente + cuenta activa + modulo requerido por la accion.
function resolverContextoPortal_(token, action) {
  var forbidden = {
    error: { ok: false, error: 'forbidden', message: 'Sesion invalida o expirada. Ingresa de nuevo a la plataforma.' }
  };

  var sesion = leerFilasSeguro_(SHEETS.SESIONES_PORTAL).filter(function (s) {
    return s.token === token;
  })[0];
  if (!sesion || new Date(sesion.expira).getTime() <= Date.now()) {
    return forbidden;
  }

  var cuenta = leerFilasSeguro_(SHEETS.CUENTAS_PORTAL).filter(function (c) {
    var activa = c.activo === true || c.activo === 'TRUE' || c.activo === 1;
    return c.cuenta_id === sesion.cuenta_id && activa;
  })[0];
  if (!cuenta) {
    return forbidden;
  }

  var modulos = parsearListaPortal_(cuenta.modulos);
  var requerido = MODULO_POR_ACCION[action];
  if (requerido) {
    // La mayoria de las acciones piden UN modulo (string); getSolicitudDetalle
    // acepta una lista (basta con tener alguno de los dos).
    var requeridos = Array.isArray(requerido) ? requerido : [requerido];
    var tieneAlguno = requeridos.some(function (m) { return modulos.indexOf(m) !== -1; });
    if (!tieneAlguno) {
      return {
        error: { ok: false, error: 'forbidden', message: 'Tu cuenta no tiene acceso a este modulo (' + requeridos.join(' o ') + ').' }
      };
    }
  }

  var emails = parsearListaPortal_(cuenta.emails);
  // El PRIMER correo de la cuenta es el "correo de trabajo": es el que se
  // compara con desarrollador_asignado (bandeja propia del DEV) y el que
  // queda en historiales como autor. Documentado en la seccion de cuentas
  // del admin.
  //
  // Normalizacion de rol: los checks del Backoffice conocen ANA/DEV/ADM/
  // GERENCIA. Una cuenta SOLICITANTE a la que el Admin le dio "bandeja" se
  // trata como DEV (el rol mas restringido con escritura: solo su propio
  // trabajo) -- sin esto pasaria los checks pensados para ANA/ADM.
  var rol = cuenta.rol === 'SOLICITANTE' ? 'DEV' : cuenta.rol;

  registrarUltimoAccesoThrottled_('c:' + cuenta.cuenta_id, function () {
    actualizarFilaPorId_(SHEETS.CUENTAS_PORTAL, 'cuenta_id', cuenta.cuenta_id, {
      ultimo_acceso: new Date().toISOString()
    });
  });

  // v6.4 (foto de perfil): se agrega cuenta_id al contexto. NO cambia la
  // logica de autenticacion -- el dato ya se resolvio arriba desde la hoja;
  // solo se propaga para que Perfiles.gs pueda identificar la fila de
  // PERFILES de esta cuenta sin volver a leer CUENTAS_PORTAL, y sobre todo
  // sin aceptar ningun identificador enviado por el navegador.
  return {
    contexto: {
      email: emails[0] || '', rol: rol, modulos: modulos, via_portal: true,
      cuenta_id: cuenta.cuenta_id
    }
  };
}

function leerFilasSeguro_(hoja) {
  try {
    return leerFilas_(hoja);
  } catch (err) {
    return []; // instalacion sin las hojas del portal
  }
}

// parsearListaPortal_ vive en CuentasPortal.gs (mismo scope del proyecto).

function getIdentidadActiva_() {
  var email = Session.getActiveUser().getEmail();
  return email || null;
}

// §3.1: la autorizacion es por rol, leido de USUARIOS (email -> rol activo).
// Devuelve null si el email no esta registrado o esta inactivo (RN-029).
function obtenerRolUsuario_(email) {
  var filas = leerFilas_(SHEETS.USUARIOS);
  for (var i = 0; i < filas.length; i++) {
    var esActivo = filas[i].activo === true || filas[i].activo === 'TRUE' || filas[i].activo === 1;
    if (filas[i].email === email && esActivo) {
      return filas[i].rol;
    }
  }
  return null;
}

// v7.1 (notificaciones vivas): ver la nota junto a la entrada en
// BACKOFFICE_ACTIONS -- sin gate de modulo.
function handleSincronizarNotificacionesApp_(data, contexto) {
  return responderResultado_(sincronizarNotificacionesApp_(contexto));
}

function handleMarcarNotificacionAppLeida_(data, contexto) {
  return responderResultado_(marcarNotificacionAppLeida_(contexto, data && data.notif_id));
}

function handleMarcarTodasNotificacionesAppLeidas_(data, contexto) {
  return responderResultado_(marcarTodasNotificacionesAppLeidas_(contexto));
}

function handleReportarPermisoNotificacionesSO_(data, contexto) {
  return responderResultado_(reportarPermisoNotificacionesSO_(contexto, data && data.permiso));
}

function handleListarPermisosNotificacionesSO_(data, contexto) {
  return responderResultado_(listarPermisosNotificacionesSO_(contexto));
}

// H-04: estado de lo desplegado. Version del codigo que corre en ESTE
// proyecto + si la planilla tiene todas las hojas y columnas que el codigo
// espera. Es de Administracion porque quien despliega es el Admin: avisarle
// al resto de algo que no puede arreglar solo seria ruido.
function handleGetEstadoSistema_(data, contexto) {
  if (contexto.rol !== 'ADM') {
    return responderResultado_({ _forbidden: true, message: 'Solo Admin puede ver el estado del sistema.' });
  }
  return responderResultado_({
    version_backend: VERSION_SIGSO,
    esquema: diagnosticarEsquema_()
  });
}

function handleListarCanalesAlerta_(data, contexto) {
  return responderResultado_(listarCanalesAlerta_(contexto));
}

function handleGuardarCanalAlerta_(data, contexto) {
  return responderResultado_(guardarCanalAlerta_(contexto, data && data.clave, data && data.activo));
}

function handleGetDirectorioAlerta_(data, contexto) {
  return responderResultado_(getDirectorioAlerta_(contexto));
}

function handleEnviarAlertaManual_(data, contexto) {
  return responderResultado_(enviarAlertaManual_(contexto, data));
}

function handlePing_(data, contexto) {
  return jsonResponse_({
    ok: true,
    data: {
      pong: true,
      version: VERSION_SIGSO,
      ts: new Date().toISOString(),
      tz: getConfig_().timezone,
      usuario: contexto.email,
      rol: contexto.rol
    }
  });
}

function handleActualizarEstado_(data, contexto) {
  var resultado = Solicitudes.actualizarEstado(data, contexto);
  return responderResultado_(resultado);
}

function handleActualizarPrioridad_(data, contexto) {
  var resultado = Solicitudes.actualizarPrioridad(data, contexto);
  return responderResultado_(resultado);
}

function handleEditarContenidoSubsolicitud_(data, contexto) {
  return responderResultado_(Solicitudes.editarContenidoSubsolicitud(data, contexto));
}

function handleComprometerFecha_(data, contexto) {
  var resultado = Solicitudes.comprometerFecha(data, contexto);
  return responderResultado_(resultado);
}

// v3.1 (§2.2): la reasignacion era alcanzable de forma lateral desde
// actualizarPrioridad; aqui pasa a ser una accion propia, con registro y
// aviso. Ese camino viejo se mantiene por compatibilidad.
function handleDerivarSolicitud_(data, contexto) {
  return responderResultado_(Solicitudes.derivarSolicitud(data, contexto));
}

function handleGetDashboardData_(data, contexto) {
  return jsonResponse_({ ok: true, data: Dashboard.getData(data, contexto) });
}

// v2.1 (Fase C): Panel de Control de Gerencia (documentacion/SIGSO-v2.1-
// plazos-y-control.md §7). Solo lectura, como el resto del Dashboard --
// cualquier rol autenticado puede pedirlo (la UI solo lo ofrece a GERENCIA).
function handleGetPanelGerencia_(data, contexto) {
  return jsonResponse_({ ok: true, data: Gerencia.getPanel(data, contexto) });
}

function handleEnviarReporteGerenciaAhora_(data, contexto) {
  return responderResultado_(Notificaciones.enviarReporteEjecutivoAhora(data, contexto));
}

function handleGetPanelJefatura_(data, contexto) {
  return jsonResponse_({ ok: true, data: Jefatura.getPanel(data, contexto) });
}

function handleGetPautaTrabajo_(data, contexto) {
  return responderResultado_(Dashboard.getPautaDesarrollador(data, contexto));
}

function handleDescargarOrdenTrabajo_(data, contexto) {
  return responderResultado_(OrdenTrabajo.descargar(data, contexto));
}

function handleGetSolicitudDetalle_(data, contexto) {
  return responderResultado_(Solicitudes.getDetalle(data.solicitud_id, contexto));
}

function handleAgregarComentario_(data, contexto) {
  return responderResultado_(Comentarios.agregarComentario(data, contexto));
}

function handleGuardarCatalogo_(data, contexto) {
  return responderResultado_(Catalogos.guardar(data, contexto));
}

function handleGestionarUsuario_(data, contexto) {
  return responderResultado_(Auth.gestionarUsuario(data, contexto));
}

function handleListarCuentasPortal_(data, contexto) {
  return responderResultado_(CuentasPortal.listar(data, contexto));
}

function handleGestionarCuentaPortal_(data, contexto) {
  return responderResultado_(CuentasPortal.gestionar(data, contexto));
}

function handleListarCatalogo_(data, contexto) {
  return responderResultado_(Catalogos.listar(data, contexto));
}

function handleListarUsuarios_(data, contexto) {
  return responderResultado_(Auth.listarUsuarios(data, contexto));
}

function handleListarLogs_(data, contexto) {
  return responderResultado_(Notificaciones.listarLogs(data, contexto));
}

function handleListarJefaturas_(data, contexto) {
  return responderResultado_(Jefatura.listar(data, contexto));
}

function handleGestionarJefatura_(data, contexto) {
  return responderResultado_(Jefatura.gestionar(data, contexto));
}

// v7.0 (Fase 1): modulo de Gestion Operacional (Actividades.gs).
function handleListarActividades_(data, contexto) {
  return responderResultado_(Actividades.listar(data, contexto));
}

function handleGetDetalleActividad_(data, contexto) {
  return responderResultado_(Actividades.obtenerDetalle(data, contexto));
}

function handleCrearActividad_(data, contexto) {
  return responderResultado_(Actividades.crear(data, contexto));
}

function handleConfirmarActividad_(data, contexto) {
  return responderResultado_(Actividades.confirmar(data, contexto));
}

function handleCheckinActividad_(data, contexto) {
  return responderResultado_(Actividades.checkin(data, contexto));
}

function handleValidarActividad_(data, contexto) {
  return responderResultado_(Actividades.validar(data, contexto));
}

function handleCancelarActividad_(data, contexto) {
  return responderResultado_(Actividades.cancelar(data, contexto));
}

function handleReprogramarActividad_(data, contexto) {
  return responderResultado_(Actividades.reprogramar(data, contexto));
}

// v7.0 (Fase 3): "Actividades del equipo" (Mi departamento).
function handlePanelEquipoActividades_(data, contexto) {
  return responderResultado_(Actividades.panelEquipo(data, contexto));
}

function handleReasignarActividad_(data, contexto) {
  return responderResultado_(Actividades.reasignar(data, contexto));
}

function handlePedirActualizacionActividad_(data, contexto) {
  return responderResultado_(Actividades.pedirActualizacion(data, contexto));
}

// v7.0 (Fase 5): pestaña de Actividades en el Panel de Gerencia.
function handleGetPanelGerenciaActividades_(data, contexto) {
  return jsonResponse_({ ok: true, data: Actividades.getPanelGerencia(data, contexto) });
}

function handleGenerarReporteActividades_(data, contexto) {
  return responderResultado_(Actividades.generarReporte(data, contexto));
}

function handleDescargarReporteActividadesPdf_(data, contexto) {
  return responderResultado_(ReporteActividades.descargarReporte(data, contexto));
}

function handleDescargarActaReunionPdf_(data, contexto) {
  return responderResultado_(ReporteActividades.descargarActa(data, contexto));
}

// v9.0 (Modulo de Proyectos, MVP Fase 1): ver documentacion/
// SIGSO-v9.0-propuesta-modulo-gestion-proyectos.md. crearTareaProyecto/
// listarTareasProyecto son wrappers finos sobre Actividades.gs -- el resto
// del ciclo de vida de la tarea (check-in, bloqueo, reasignar...) usa las
// acciones de Actividades ya conectadas mas arriba.
function handleListarProyectos_(data, contexto) {
  return responderResultado_(Proyectos.listar(data, contexto));
}

function handleListarMisTareasProyectos_(data, contexto) {
  return responderResultado_(Proyectos.listarMisTareas(data, contexto));
}

function handleListarMiBitacoraProyectos_(data, contexto) {
  return responderResultado_(Proyectos.listarMiBitacora(data, contexto));
}

function handleListarCalendarioProyectos_(data, contexto) {
  return responderResultado_(Proyectos.listarCalendario(data, contexto));
}

function handleGuardarProyectoComoPlantilla_(data, contexto) {
  return responderResultado_(Proyectos.guardarComoPlantilla(data, contexto));
}

function handleListarPlantillasProyecto_(data, contexto) {
  return responderResultado_(Proyectos.listarPlantillas(data, contexto));
}

// v10 (Fase D): a diferencia del resto de acciones de Proyectos, esta
// devuelve { pdf_base64, filename } directo (mismo contrato que
// OrdenTrabajo.descargar) -- el frontend decodifica y descarga, no hay
// "data.ok" que envolver distinto.
function handleDescargarReporteProyecto_(data, contexto) {
  return responderResultado_(Proyectos.descargarReporte(data, contexto));
}

// R-01: el mismo proyecto, pero como hoja de calculo.
function handleDescargarLibroProyecto_(data, contexto) {
  return responderResultado_(Proyectos.descargarLibro(data, contexto));
}

// M-02: la pantalla de Inicio en una sola llamada.
//
// NO lleva entrada en MODULO_POR_ACCION a proposito: no pertenece a ningun
// modulo, la pide cualquiera con sesion. Los permisos NO se relajan -- cada
// bloque de adentro delega en la misma funcion que atendia su accion suelta,
// con su propio control intacto.
function handleGetInicio_(data, contexto) {
  return responderResultado_(Inicio.getResumen(data, contexto));
}

function handleMarcarSalaVisitadaProyecto_(data, contexto) {
  return responderResultado_(Proyectos.marcarSalaVisitada(data, contexto));
}

function handleSubirAdjuntoProyecto_(data, contexto) {
  return responderResultado_(Proyectos.subirAdjunto(data, contexto));
}

function handleDescargarAdjuntoProyecto_(data, contexto) {
  return responderResultado_(Proyectos.descargarAdjunto(data, contexto));
}

function handleGestionarDocumentoProyecto_(data, contexto) {
  return responderResultado_(Proyectos.gestionarDocumento(data, contexto));
}

function handleSubirVersionDocumentoProyecto_(data, contexto) {
  return responderResultado_(Proyectos.subirVersionDocumento(data, contexto));
}

function handleMarcarVersionVigenteProyecto_(data, contexto) {
  return responderResultado_(Proyectos.marcarVersionVigente(data, contexto));
}

function handleListarVersionesDocumentoProyecto_(data, contexto) {
  return responderResultado_(Proyectos.listarVersionesDocumento(data, contexto));
}

function handleDescargarVersionDocumentoProyecto_(data, contexto) {
  return responderResultado_(Proyectos.descargarVersionDocumento(data, contexto));
}

function handleDescargarDocumentoProyecto_(data, contexto) {
  return responderResultado_(Proyectos.descargarDocumento(data, contexto));
}

function handleGestionarReunionProyecto_(data, contexto) {
  return responderResultado_(Proyectos.gestionarReunion(data, contexto));
}

function handleAgregarAcuerdoReunionProyecto_(data, contexto) {
  return responderResultado_(Proyectos.agregarAcuerdoReunion(data, contexto));
}

function handleEliminarAcuerdoReunionProyecto_(data, contexto) {
  return responderResultado_(Proyectos.eliminarAcuerdoReunion(data, contexto));
}

function handleConvertirAcuerdoEnTareaProyecto_(data, contexto) {
  return responderResultado_(Proyectos.convertirAcuerdoEnTarea(data, contexto));
}

function handleListarReunionesProyecto_(data, contexto) {
  return responderResultado_(Proyectos.listarReuniones(data, contexto));
}

function handleGestionarDecisionProyecto_(data, contexto) {
  return responderResultado_(Proyectos.gestionarDecision(data, contexto));
}

function handleListarDecisionesProyecto_(data, contexto) {
  return responderResultado_(Proyectos.listarDecisiones(data, contexto));
}

function handleGetDetalleProyecto_(data, contexto) {
  return responderResultado_(Proyectos.getDetalle(data, contexto));
}

function handleGetDetalleCompletoProyecto_(data, contexto) {
  return responderResultado_(Proyectos.getDetalleCompleto(data, contexto));
}

function handleCrearProyecto_(data, contexto) {
  return responderResultado_(Proyectos.crear(data, contexto));
}

function handleActualizarProyecto_(data, contexto) {
  return responderResultado_(Proyectos.actualizar(data, contexto));
}

function handleGestionarIntegranteProyecto_(data, contexto) {
  return responderResultado_(Proyectos.gestionarIntegrante(data, contexto));
}

function handleGestionarHitoProyecto_(data, contexto) {
  return responderResultado_(Proyectos.gestionarHito(data, contexto));
}

function handleCrearTareaProyecto_(data, contexto) {
  return responderResultado_(Proyectos.crearTarea(data, contexto));
}

function handleEditarTareaProyecto_(data, contexto) {
  return responderResultado_(Proyectos.editarTarea(data, contexto));
}

function handleListarTareasProyecto_(data, contexto) {
  return responderResultado_(Proyectos.listarTareas(data, contexto));
}

function handleListarBitacoraProyecto_(data, contexto) {
  return responderResultado_(Proyectos.listarBitacora(data, contexto));
}

function handleObtenerRendimientoProyecto_(data, contexto) {
  return responderResultado_(Proyectos.obtenerRendimiento(data, contexto));
}

function handleGuardarRegistroDiaProyecto_(data, contexto) {
  return responderResultado_(Proyectos.guardarRegistroDia(data, contexto));
}

function handleEliminarRegistroDiaProyecto_(data, contexto) {
  return responderResultado_(Proyectos.eliminarRegistroDia(data, contexto));
}

function handleCongelarBaselineProyecto_(data, contexto) {
  return responderResultado_(Proyectos.congelarBaseline(data, contexto));
}

function handleReprogramarTareaProyecto_(data, contexto) {
  return responderResultado_(Proyectos.reprogramarTarea(data, contexto));
}

function handleObtenerAnaliticaProyecto_(data, contexto) {
  return responderResultado_(Proyectos.obtenerAnalitica(data, contexto));
}

function handleObtenerWorkloadPortafolioProyectos_(data, contexto) {
  return responderResultado_(Proyectos.obtenerWorkloadPortafolio(data, contexto));
}

function handleListarSalaProyecto_(data, contexto) {
  return responderResultado_(Proyectos.listarSala(data, contexto));
}

function handlePublicarEnSalaProyecto_(data, contexto) {
  return responderResultado_(Proyectos.publicarEnSala(data, contexto));
}

function handleConvertirEventoEnTareaProyecto_(data, contexto) {
  return responderResultado_(Proyectos.convertirEventoEnTarea(data, contexto));
}

function handleGestionarEntregableProyecto_(data, contexto) {
  return responderResultado_(Proyectos.gestionarEntregable(data, contexto));
}

function handleRevisarEntregableProyecto_(data, contexto) {
  return responderResultado_(Proyectos.revisarEntregable(data, contexto));
}

function handleGestionarRiesgoProyecto_(data, contexto) {
  return responderResultado_(Proyectos.gestionarRiesgo(data, contexto));
}

function handleGetResumenPortafolioProyectos_(data, contexto) {
  return responderResultado_(Proyectos.getResumenPortafolio(contexto));
}

// v10.0 (Modulo SGC ISO 9001, Fase 1): ver documentacion/
// SIGSO-v10.0-propuesta-modulo-sgc-iso9001.md. Calidad.gs resuelve por su
// cuenta QUE documentos ve cada quien (SGC_ROLES + visibilidad), por eso
// aca no hay logica de permisos: solo el gate de modulo de la tabla.
function handleListarDocumentosSgc_(data, contexto) {
  return responderResultado_(Calidad.listarDocumentos(data, contexto));
}

function handleGetDocumentoSgc_(data, contexto) {
  return responderResultado_(Calidad.getDocumento(data, contexto));
}

function handleCrearDocumentoSgc_(data, contexto) {
  return responderResultado_(Calidad.crearDocumento(data, contexto));
}

function handleNuevaVersionDocumentoSgc_(data, contexto) {
  return responderResultado_(Calidad.nuevaVersion(data, contexto));
}

function handleActualizarDocumentoSgc_(data, contexto) {
  return responderResultado_(Calidad.actualizarDocumento(data, contexto));
}

function handleDescargarDocumentoSgc_(data, contexto) {
  return responderResultado_(Calidad.descargarDocumento(data, contexto));
}

function handleListarRolesSgc_(data, contexto) {
  return responderResultado_(Calidad.listarRoles(data, contexto));
}

function handleGestionarRolSgc_(data, contexto) {
  return responderResultado_(Calidad.gestionarRol(data, contexto));
}

function handleListarAccesosSgc_(data, contexto) {
  return responderResultado_(Calidad.listarAccesos(data, contexto));
}

function handlePrevisualizarAccesoSgc_(data, contexto) {
  return responderResultado_(Calidad.previsualizarAcceso(data, contexto));
}

function handleGetMatrizDistribucionSgc_(data, contexto) {
  return responderResultado_(Calidad.getMatrizDistribucion(data, contexto));
}

function handleGetDocumentosConfidencialesSgc_(data, contexto) {
  return responderResultado_(Calidad.getDocumentosConfidenciales(data, contexto));
}

function handleAcusarDocumentoSgc_(data, contexto) {
  return responderResultado_(Calidad.acusarDocumento(data, contexto));
}

function handleGetCumplimientoDocumentoSgc_(data, contexto) {
  return responderResultado_(Calidad.getCumplimiento(data, contexto));
}

// v10.0 Fase 2a (PRO-02): Personas.gs resuelve por su cuenta QUE ficha ve
// cada quien (el personal operativo, solo la suya), por eso aca no hay
// logica de permisos.
function handleListarPersonasSgc_(data, contexto) {
  return responderResultado_(Personas.listar(data, contexto));
}

function handleGetFichaPersonaSgc_(data, contexto) {
  return responderResultado_(Personas.getFicha(data, contexto));
}

function handleGuardarPersonaSgc_(data, contexto) {
  return responderResultado_(Personas.guardarPersona(data, contexto));
}

function handleDesvincularPersonaSgc_(data, contexto) {
  return responderResultado_(Personas.desvincular(data, contexto));
}

function handleQuitarPersonaAlcanceSgc_(data, contexto) {
  return responderResultado_(Personas.quitarDelAlcance(data, contexto));
}

function handleGuardarDescriptorSgc_(data, contexto) {
  return responderResultado_(Personas.guardarDescriptor(data, contexto));
}

function handleActualizarDescriptorSgc_(data, contexto) {
  return responderResultado_(Personas.actualizarDescriptor(data, contexto));
}

function handleDescargarDescriptorSgc_(data, contexto) {
  return responderResultado_(Personas.descargarDescriptor(data, contexto));
}

function handleGuardarDocumentoPersonaSgc_(data, contexto) {
  return responderResultado_(Personas.guardarDocumento(data, contexto));
}

function handleDescargarDocumentoPersonaSgc_(data, contexto) {
  return responderResultado_(Personas.descargarDocumento(data, contexto));
}

function handleRegistrarInduccionSgc_(data, contexto) {
  return responderResultado_(Personas.registrarInduccion(data, contexto));
}

function handleRegistrarEvaluacionSgc_(data, contexto) {
  return responderResultado_(Personas.registrarEvaluacion(data, contexto));
}

function handleListarCapacitacionesSgc_(data, contexto) {
  return responderResultado_(Personas.listarCapacitaciones(data, contexto));
}

function handleGuardarCapacitacionSgc_(data, contexto) {
  return responderResultado_(Personas.guardarCapacitacion(data, contexto));
}

function handleRegistrarRealizacionCapacitacionSgc_(data, contexto) {
  return responderResultado_(Personas.registrarRealizacion(data, contexto));
}

function handleRegistrarEficaciaCapacitacionSgc_(data, contexto) {
  return responderResultado_(Personas.registrarEficaciaAsistente(data, contexto));
}

// v10.0 Fase 3a (PRO-06): el motor de mejora. NoConformidades.gs acota por
// su cuenta quien ve que, por eso aca no hay logica de permisos.
function handleListarNcSgc_(data, contexto) {
  return responderResultado_(NoConformidades.listar(data, contexto));
}

function handleGetDetalleNcSgc_(data, contexto) {
  return responderResultado_(NoConformidades.getDetalle(data, contexto));
}

function handleCrearNcSgc_(data, contexto) {
  return responderResultado_(NoConformidades.crear(data, contexto));
}

function handleRegistrarCorreccionNcSgc_(data, contexto) {
  return responderResultado_(NoConformidades.registrarCorreccion(data, contexto));
}

function handleRegistrarCausaNcSgc_(data, contexto) {
  return responderResultado_(NoConformidades.registrarCausa(data, contexto));
}

function handleRegistrarAccionNcSgc_(data, contexto) {
  return responderResultado_(NoConformidades.registrarAccion(data, contexto));
}

function handleCerrarEtapaNcSgc_(data, contexto) {
  return responderResultado_(NoConformidades.cerrarEtapa(data, contexto));
}

function handleVerificarEficaciaNcSgc_(data, contexto) {
  return responderResultado_(NoConformidades.verificarEficacia(data, contexto));
}

function handleAnularNcSgc_(data, contexto) {
  return responderResultado_(NoConformidades.anular(data, contexto));
}

// v10.0 Fase 3b (PRO-03): auditoria interna. Igual que arriba, Auditorias.gs
// acota por su cuenta quien ve y quien puede que cosa.
function handleListarAuditoriasSgc_(data, contexto) {
  return responderResultado_(Auditorias.listar(data, contexto));
}

function handleGetDetalleAuditoriaSgc_(data, contexto) {
  return responderResultado_(Auditorias.getDetalle(data, contexto));
}

function handleProgramarAuditoriaSgc_(data, contexto) {
  return responderResultado_(Auditorias.programar(data, contexto));
}

function handlePlanificarAuditoriaSgc_(data, contexto) {
  return responderResultado_(Auditorias.planificar(data, contexto));
}

function handleRegistrarHallazgoSgc_(data, contexto) {
  return responderResultado_(Auditorias.registrarHallazgo(data, contexto));
}

function handleEliminarHallazgoSgc_(data, contexto) {
  return responderResultado_(Auditorias.eliminarHallazgo(data, contexto));
}

function handleCerrarEjecucionAuditoriaSgc_(data, contexto) {
  return responderResultado_(Auditorias.cerrarEjecucion(data, contexto));
}

function handleEmitirInformeAuditoriaSgc_(data, contexto) {
  return responderResultado_(Auditorias.emitirInforme(data, contexto));
}

function handleConvertirHallazgoEnNcSgc_(data, contexto) {
  return responderResultado_(Auditorias.convertirHallazgoEnNc(data, contexto));
}

function handleCerrarAuditoriaSgc_(data, contexto) {
  return responderResultado_(Auditorias.cerrar(data, contexto));
}

function handleAnularAuditoriaSgc_(data, contexto) {
  return responderResultado_(Auditorias.anular(data, contexto));
}

// v10.0 Fase 4 (PRO-07): quejas. Igual que arriba, Quejas.gs acota por su
// cuenta quien ve y quien puede que cosa.
function handleListarQuejasSgc_(data, contexto) {
  return responderResultado_(Quejas.listar(data, contexto));
}

function handleGetDetalleQuejaSgc_(data, contexto) {
  return responderResultado_(Quejas.getDetalle(data, contexto));
}

function handleRegistrarRecepcionQuejaSgc_(data, contexto) {
  return responderResultado_(Quejas.registrarRecepcion(data, contexto));
}

function handleRegistrarInvestigacionQuejaSgc_(data, contexto) {
  return responderResultado_(Quejas.registrarInvestigacion(data, contexto));
}

function handleRegistrarResultadoQuejaSgc_(data, contexto) {
  return responderResultado_(Quejas.registrarResultado(data, contexto));
}

function handleRegistrarResolucionQuejaSgc_(data, contexto) {
  return responderResultado_(Quejas.registrarResolucion(data, contexto));
}

function handleConvertirQuejaEnNcSgc_(data, contexto) {
  return responderResultado_(Quejas.convertirEnNc(data, contexto));
}

function handleRegistrarNotificacionQuejaSgc_(data, contexto) {
  return responderResultado_(Quejas.registrarNotificacion(data, contexto));
}

function handleRegistrarSeguimientoQuejaSgc_(data, contexto) {
  return responderResultado_(Quejas.registrarSeguimiento(data, contexto));
}

function handleAnularQuejaSgc_(data, contexto) {
  return responderResultado_(Quejas.anular(data, contexto));
}

// v10.0 Fase 5a (PRO-04): proveedores externos.
function handleListarProveedoresSgc_(data, contexto) {
  return responderResultado_(Proveedores.listar(data, contexto));
}

function handleGetDetalleProveedorSgc_(data, contexto) {
  return responderResultado_(Proveedores.getDetalle(data, contexto));
}

function handleGuardarProveedorSgc_(data, contexto) {
  return responderResultado_(Proveedores.guardar(data, contexto));
}

function handleEvaluarProveedorSgc_(data, contexto) {
  return responderResultado_(Proveedores.evaluar(data, contexto));
}

function handleDesactivarProveedorSgc_(data, contexto) {
  return responderResultado_(Proveedores.desactivar(data, contexto));
}

// v10.0 Fase 5b (PRO-05): revision por la direccion.
function handleListarRevisionesSgc_(data, contexto) {
  return responderResultado_(RevisionDireccion.listar(data, contexto));
}

function handleGetDetalleRevisionSgc_(data, contexto) {
  return responderResultado_(RevisionDireccion.getDetalle(data, contexto));
}

function handleGetResumenRevisionSgc_(data, contexto) {
  return responderResultado_(RevisionDireccion.getResumenAutomatico(data, contexto));
}

function handleProgramarRevisionSgc_(data, contexto) {
  return responderResultado_(RevisionDireccion.programar(data, contexto));
}

function handleConvocarRevisionSgc_(data, contexto) {
  return responderResultado_(RevisionDireccion.convocar(data, contexto));
}

function handleRegistrarActaRevisionSgc_(data, contexto) {
  return responderResultado_(RevisionDireccion.registrarActa(data, contexto));
}

function handleRegistrarAcuerdoRevisionSgc_(data, contexto) {
  return responderResultado_(RevisionDireccion.registrarAcuerdo(data, contexto));
}

function handleCerrarRevisionSgc_(data, contexto) {
  return responderResultado_(RevisionDireccion.cerrar(data, contexto));
}

function handleAnularRevisionSgc_(data, contexto) {
  return responderResultado_(RevisionDireccion.anular(data, contexto));
}

// v10.0 Fase 6a (DOC-07): tablero de objetivos de calidad.
function handleListarObjetivosSgc_(data, contexto) {
  return responderResultado_(Objetivos.listar(data, contexto));
}

function handleGetDetalleObjetivoSgc_(data, contexto) {
  return responderResultado_(Objetivos.getDetalle(data, contexto));
}

function handleSembrarAnioObjetivosSgc_(data, contexto) {
  return responderResultado_(Objetivos.sembrarAnio(data, contexto));
}

function handleGuardarObjetivoSgc_(data, contexto) {
  return responderResultado_(Objetivos.guardar(data, contexto));
}

function handleSugerirLecturaObjetivoSgc_(data, contexto) {
  return responderResultado_(Objetivos.sugerirLectura(data, contexto));
}

function handleRegistrarLecturaObjetivoSgc_(data, contexto) {
  return responderResultado_(Objetivos.registrarLectura(data, contexto));
}

function handleAnularLecturaObjetivoSgc_(data, contexto) {
  return responderResultado_(Objetivos.anularLectura(data, contexto));
}

// v10.0 Fase 6b: matriz de cobertura ISO + "modo auditoria".
function handleListarMatrizCoberturaSgc_(data, contexto) {
  return responderResultado_(MatrizCobertura.listar(data, contexto));
}

function handleGetDetalleClausulaCoberturaSgc_(data, contexto) {
  return responderResultado_(MatrizCobertura.getDetalle(data, contexto));
}

function handleDescargarEvidenciaClausulaSgc_(data, contexto) {
  return responderResultado_(MatrizCobertura.descargarEvidencia(data, contexto));
}

// v11.0 Fase 1 (§4.3): alcance del SGC y exclusiones.
function handleObtenerAlcanceSgc_(data, contexto) {
  return responderResultado_(Alcance.obtener(data, contexto));
}

function handleGuardarAlcanceSgc_(data, contexto) {
  return responderResultado_(Alcance.guardar(data, contexto));
}

function handleNuevaVersionAlcanceSgc_(data, contexto) {
  return responderResultado_(Alcance.nuevaVersion(data, contexto));
}

function handleGuardarExclusionSgc_(data, contexto) {
  return responderResultado_(Alcance.guardarExclusion(data, contexto));
}

function handleAnularExclusionSgc_(data, contexto) {
  return responderResultado_(Alcance.anularExclusion(data, contexto));
}

// v11.0 Fase 2 (§4.1 y §4.2): contexto de la organizacion y partes interesadas.
function handleObtenerContextoSgc_(data, contexto) {
  return responderResultado_(Contexto.obtener(data, contexto));
}

function handleSembrarFodaSgc_(data, contexto) {
  return responderResultado_(Contexto.sembrarFoda(data, contexto));
}

function handleGuardarFactorContextoSgc_(data, contexto) {
  return responderResultado_(Contexto.guardarFactor(data, contexto));
}

function handleAnularFactorContextoSgc_(data, contexto) {
  return responderResultado_(Contexto.anularFactor(data, contexto));
}

function handleRegistrarRevisionContextoSgc_(data, contexto) {
  return responderResultado_(Contexto.registrarRevision(data, contexto));
}

function handleSembrarPartesSgc_(data, contexto) {
  return responderResultado_(Contexto.sembrarPartes(data, contexto));
}

function handleGuardarParteInteresadaSgc_(data, contexto) {
  return responderResultado_(Contexto.guardarParte(data, contexto));
}

function handleAnularParteInteresadaSgc_(data, contexto) {
  return responderResultado_(Contexto.anularParte(data, contexto));
}

// v11.0 Fase 3 (§6.1): riesgos y oportunidades.
function handleListarRiesgosSgc_(data, contexto) {
  return responderResultado_(Riesgos.listar(data, contexto));
}

function handleSembrarRiesgosSgc_(data, contexto) {
  return responderResultado_(Riesgos.sembrarDesdeDoc08(data, contexto));
}

function handleGuardarRiesgoSgc_(data, contexto) {
  return responderResultado_(Riesgos.guardar(data, contexto));
}

function handleAsignarAccionRiesgoSgc_(data, contexto) {
  return responderResultado_(Riesgos.asignarAccion(data, contexto));
}

function handleRegistrarRevisionRiesgosSgc_(data, contexto) {
  return responderResultado_(Riesgos.registrarRevision(data, contexto));
}

function handleAnularRiesgoSgc_(data, contexto) {
  return responderResultado_(Riesgos.anular(data, contexto));
}

// v11.0 Fase 4 (§4.4): procesos del SGC.
function handleListarProcesosSgc_(data, contexto) {
  return responderResultado_(Procesos.listar(data, contexto));
}

function handleGetDetalleProcesoSgc_(data, contexto) {
  return responderResultado_(Procesos.getDetalle(data, contexto));
}

function handleSembrarMapaProcesosSgc_(data, contexto) {
  return responderResultado_(Procesos.sembrarMapa(data, contexto));
}

function handleGuardarProcesoSgc_(data, contexto) {
  return responderResultado_(Procesos.guardar(data, contexto));
}

function handleAnularProcesoSgc_(data, contexto) {
  return responderResultado_(Procesos.anular(data, contexto));
}

function handleRegistrarRevisionProcesosSgc_(data, contexto) {
  return responderResultado_(Procesos.registrarRevision(data, contexto));
}

// v11.0 Fase 5 (§7.5.3.2): listado de documentos de origen externo.
function handleSembrarDocumentosExternosSgc_(data, contexto) {
  return responderResultado_(Calidad.sembrarDocumentosExternos(data, contexto));
}

// v11.0 Fase 6 (§9.1.1): indicadores de proceso.
function handleListarIndicadoresSgc_(data, contexto) {
  return responderResultado_(Indicadores.listar(data, contexto));
}

function handleGuardarIndicadorSgc_(data, contexto) {
  return responderResultado_(Indicadores.guardar(data, contexto));
}

function handleAnularIndicadorSgc_(data, contexto) {
  return responderResultado_(Indicadores.anular(data, contexto));
}

function handleRegistrarLecturaIndicadorSgc_(data, contexto) {
  return responderResultado_(Indicadores.registrarLectura(data, contexto));
}

function handleAnularLecturaIndicadorSgc_(data, contexto) {
  return responderResultado_(Indicadores.anularLectura(data, contexto));
}

// v11.0 Fase 7: tablero del SGC.
function handleResumenTableroSgc_(data, contexto) {
  return responderResultado_(Tablero.resumen(data, contexto));
}

// v11.0 Fase 8: evidencia de servicios prestados.
function handleListarPrestacionesSgc_(data, contexto) {
  return responderResultado_(Prestaciones.listar(data, contexto));
}

function handleRegistrarPrestacionSgc_(data, contexto) {
  return responderResultado_(Prestaciones.registrar(data, contexto));
}

function handleLiberarPrestacionSgc_(data, contexto) {
  return responderResultado_(Prestaciones.liberar(data, contexto));
}

function handleMarcarNoConformePrestacionSgc_(data, contexto) {
  return responderResultado_(Prestaciones.marcarNoConforme(data, contexto));
}

function handleAbrirNcPrestacionSgc_(data, contexto) {
  return responderResultado_(Prestaciones.abrirNoConformidad(data, contexto));
}

function handleAnularPrestacionSgc_(data, contexto) {
  return responderResultado_(Prestaciones.anular(data, contexto));
}

// v6.0 (modulo Pausas Activas, Fase P0): CRUD de configuracion (ADM).
function handleListarPausasConfig_(data, contexto) {
  return responderResultado_(Pausas.listarConfig(data, contexto));
}

function handleGuardarPausasConfig_(data, contexto) {
  return responderResultado_(Pausas.guardarConfig(data, contexto));
}

function handleListarPausasCoordinadores_(data, contexto) {
  return responderResultado_(Pausas.listarCoordinadores(data, contexto));
}

function handleGestionarPausasCoordinador_(data, contexto) {
  return responderResultado_(Pausas.gestionarCoordinador(data, contexto));
}

function handleListarPausasTrabajadores_(data, contexto) {
  return responderResultado_(Pausas.listarTrabajadores(data, contexto));
}

function handleGestionarPausasTrabajador_(data, contexto) {
  return responderResultado_(Pausas.gestionarTrabajador(data, contexto));
}

// v6.0 (mejora): siembra/asignacion masiva del roster.
function handleSembrarRosterPausas_(data, contexto) {
  return responderResultado_(Pausas.sembrarRosterDesdeCuentas(data, contexto));
}

function handleAsignarModuloPausasRoster_(data, contexto) {
  return responderResultado_(Pausas.asignarModuloPausasRoster(data, contexto));
}

// v6.0 Fase P1: programacion + estados de las pausas.
function handleListarPausasProgramadas_(data, contexto) {
  return responderResultado_(Pausas.listarProgramadas(data, contexto));
}

function handleProgramarPausasDelDia_(data, contexto) {
  return responderResultado_(Pausas.programarDelDiaAdmin(data, contexto));
}

function handleGestionarPausaProgramada_(data, contexto) {
  return responderResultado_(Pausas.gestionarPausaProgramada(data, contexto));
}

// v6.0 Fase P2: registro del trabajador.
function handleGetPausaHoyTrabajador_(data, contexto) {
  return responderResultado_(Pausas.getPausaHoyTrabajador(data, contexto));
}

function handleRegistrarAsistenciaPausa_(data, contexto) {
  return responderResultado_(Pausas.registrarAsistencia(data, contexto));
}

// v6.0 Fase P3: coordinador.
function handleGetPanelCoordinadorPausas_(data, contexto) {
  return responderResultado_(Pausas.getPanelCoordinador(data, contexto));
}

function handleGestionarPausaCoordinador_(data, contexto) {
  return responderResultado_(Pausas.gestionarPausaCoordinador(data, contexto));
}

function handleRegistrarAsistenciaGrupalPausas_(data, contexto) {
  return responderResultado_(Pausas.registrarAsistenciaGrupal(data, contexto));
}

function handleGetReporteCumplimientoPausas_(data, contexto) {
  return responderResultado_(Pausas.getReporteCumplimiento(data, contexto));
}

function handleDescargarReporteCumplimientoPausasPdf_(data, contexto) {
  return responderResultado_(Pausas.descargarReporteCumplimientoPdf(data, contexto));
}

// v6.0 (mejora #7): roster + historial por trabajador (racha de participacion).
function handleListarRosterCoordinadorPausas_(data, contexto) {
  return responderResultado_(Pausas.listarRosterCoordinador(data, contexto));
}

function handleGetHistorialTrabajadorPausas_(data, contexto) {
  return responderResultado_(Pausas.getHistorialTrabajador(data, contexto));
}

// v6.0 Fase P5: reporte de pausas para el Panel de Gerencia.
function handleGetReporteGerenciaPausas_(data, contexto) {
  return responderResultado_(Pausas.getReporteGerencia(data, contexto));
}

function handleDescargarReporteGerenciaPausasPdf_(data, contexto) {
  return responderResultado_(Pausas.descargarReporteGerenciaPdf(data, contexto));
}

// v6.4 (foto de perfil). Notese que `data` NO aporta identidad en ninguna de
// las tres primeras: Perfiles.gs la saca de `contexto`. Si alguien agrega
// aqui un data.usuario_id o similar, rompe el modelo de seguridad entero.
function handleGetMiPerfil_(data, contexto) {
  return responderResultado_(Perfiles.getMiPerfil(data, contexto));
}

function handleGuardarFotoPerfil_(data, contexto) {
  return responderResultado_(Perfiles.guardarFoto(data, contexto));
}

function handleEliminarFotoPerfil_(data, contexto) {
  return responderResultado_(Perfiles.eliminarFoto(data, contexto));
}

function handleGetFotosPerfil_(data, contexto) {
  return responderResultado_(Perfiles.getFotosDe(data, contexto));
}

// v6.5 (modulo Novedades).
function handleListarAreasPublicablesNovedad_(data, contexto) {
  return responderResultado_(Novedades.listarAreasPublicables(data, contexto));
}

function handleGetFeedNovedades_(data, contexto) {
  return responderResultado_(Novedades.getFeed(data, contexto));
}

function handleGetDetalleNovedad_(data, contexto) {
  return responderResultado_(Novedades.getDetalle(data, contexto));
}

function handlePublicarNovedad_(data, contexto) {
  return responderResultado_(Novedades.publicar(data, contexto));
}

function handleDespublicarNovedad_(data, contexto) {
  return responderResultado_(Novedades.despublicar(data, contexto));
}

function handleMarcarLeidaNovedad_(data, contexto) {
  return responderResultado_(Novedades.marcarLeida(data, contexto));
}

function handleDescargarAdjuntoNovedad_(data, contexto) {
  return responderResultado_(Novedades.descargarAdjunto(data, contexto));
}

function handleGetLectoresNovedad_(data, contexto) {
  return responderResultado_(Novedades.getLectores(data, contexto));
}

function handleGetHistorialNovedad_(data, contexto) {
  return responderResultado_(Novedades.getHistorial(data, contexto));
}

function handleAprobarNovedad_(data, contexto) {
  return responderResultado_(Novedades.aprobar(data, contexto));
}

function handleDevolverNovedad_(data, contexto) {
  return responderResultado_(Novedades.devolver(data, contexto));
}

function handleRechazarNovedad_(data, contexto) {
  return responderResultado_(Novedades.rechazar(data, contexto));
}

function handleReenviarNovedad_(data, contexto) {
  return responderResultado_(Novedades.reenviar(data, contexto));
}

function handleListarPendientesAprobacionNovedad_(data, contexto) {
  return responderResultado_(Novedades.listarPendientesAprobacion(data, contexto));
}

function handleMisPendientesNovedad_(data, contexto) {
  return responderResultado_(Novedades.misPendientes(data, contexto));
}

function handleGetPanelCumplimientoNovedad_(data, contexto) {
  return responderResultado_(Novedades.getPanelCumplimiento(data, contexto));
}

function responderResultado_(resultado) {
  if (resultado && resultado._validationError) {
    return jsonResponse_({
      ok: false,
      error: 'validation',
      message: resultado.message,
      fields: resultado.fields
    });
  }
  if (resultado && resultado._forbidden) {
    return jsonResponse_({ ok: false, error: 'forbidden', message: resultado.message });
  }
  return jsonResponse_({ ok: true, data: resultado });
}

function handleNotImplemented_() {
  return jsonResponse_({ ok: false, error: 'internal', ref: 'NOT_IMPLEMENTED_FASE0' });
}

function parseRequestBody_(e) {
  if (!e || !e.postData || typeof e.postData.contents !== 'string') {
    throw new Error('Cuerpo de request vacio o invalido');
  }
  var body = JSON.parse(e.postData.contents);
  if (!body || typeof body.action !== 'string') {
    throw new Error('Falta el campo "action" en el body');
  }
  return body;
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function logError_(err, contexto) {
  var ref = Utilities.getUuid();
  Logger.log('[' + ref + '] ' + contexto + ': ' + (err && err.stack ? err.stack : err));
  return ref;
}
