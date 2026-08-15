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
  // v6.0 (mejora #7): roster + historial por trabajador.
  listarRosterCoordinadorPausas: handleListarRosterCoordinadorPausas_,
  getHistorialTrabajadorPausas: handleGetHistorialTrabajadorPausas_,
  // v6.0 Fase P5: reporte de pausas para el Panel de Gerencia (modulo 'gerencia').
  getReporteGerenciaPausas: handleGetReporteGerenciaPausas_,
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
  getDetalleProyecto: handleGetDetalleProyecto_,
  crearProyecto: handleCrearProyecto_,
  actualizarProyecto: handleActualizarProyecto_,
  gestionarIntegranteProyecto: handleGestionarIntegranteProyecto_,
  gestionarHitoProyecto: handleGestionarHitoProyecto_,
  crearTareaProyecto: handleCrearTareaProyecto_,
  listarTareasProyecto: handleListarTareasProyecto_,
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
  // v10.0 Fase 1b: acuse de recibo (evidencia de ISO §7.5.3).
  acusarDocumentoSgc: handleAcusarDocumentoSgc_,
  getCumplimientoDocumentoSgc: handleGetCumplimientoDocumentoSgc_,
  // v10.0 Fase 2a (PRO-02): ficha del trabajador.
  listarPersonasSgc: handleListarPersonasSgc_,
  getFichaPersonaSgc: handleGetFichaPersonaSgc_,
  guardarPersonaSgc: handleGuardarPersonaSgc_,
  desvincularPersonaSgc: handleDesvincularPersonaSgc_,
  guardarDescriptorSgc: handleGuardarDescriptorSgc_,
  guardarDocumentoPersonaSgc: handleGuardarDocumentoPersonaSgc_,
  descargarDocumentoPersonaSgc: handleDescargarDocumentoPersonaSgc_,
  registrarInduccionSgc: handleRegistrarInduccionSgc_,
  // v10.0 Fase 2b: competencias y capacitaciones.
  registrarEvaluacionSgc: handleRegistrarEvaluacionSgc_,
  listarCapacitacionesSgc: handleListarCapacitacionesSgc_,
  guardarCapacitacionSgc: handleGuardarCapacitacionSgc_,
  registrarRealizacionCapacitacionSgc: handleRegistrarRealizacionCapacitacionSgc_,
  registrarEficaciaCapacitacionSgc: handleRegistrarEficaciaCapacitacionSgc_
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
  // v6.0 (mejora #7): roster + historial por trabajador (misma pestana de reportes).
  listarRosterCoordinadorPausas: 'pausas_coordinacion',
  getHistorialTrabajadorPausas: 'pausas_coordinacion',
  // v6.0 Fase P5: la pestana de pausas vive en el Panel de Gerencia.
  getReporteGerenciaPausas: 'gerencia',
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
  checkinActividad: 'mi_trabajo',
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
  getDetalleProyecto: ['proyectos', 'gerencia'],
  crearProyecto: 'proyectos',
  actualizarProyecto: 'proyectos',
  gestionarIntegranteProyecto: 'proyectos',
  gestionarHitoProyecto: 'proyectos',
  crearTareaProyecto: 'proyectos',
  listarTareasProyecto: ['proyectos', 'gerencia'],
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
  // v10.0 Fase 1b: confirmar la lectura es del personal (mismo gate de
  // lectura); ver quien falta es gestion (Calidad.gs lo acota a ENCARGADO_SGC/ADM).
  acusarDocumentoSgc: ['calidad', 'gerencia'],
  getCumplimientoDocumentoSgc: 'calidad',
  // v10.0 Fase 2a: el gate fino (QUE ficha ve cada quien -- el personal
  // operativo solo la suya) lo aplica Personas.gs, no esta tabla.
  listarPersonasSgc: ['calidad', 'gerencia'],
  getFichaPersonaSgc: ['calidad', 'gerencia'],
  descargarDocumentoPersonaSgc: ['calidad', 'gerencia'],
  guardarPersonaSgc: 'calidad',
  desvincularPersonaSgc: 'calidad',
  guardarDescriptorSgc: 'calidad',
  guardarDocumentoPersonaSgc: 'calidad',
  registrarInduccionSgc: 'calidad',
  // v10.0 Fase 2b: el programa de capacitacion es de lectura general dentro
  // del SGC (todos deben poder ver a que se los convoco); registrar y
  // evaluar lo acota Personas.gs al Encargado SGC / jefatura.
  listarCapacitacionesSgc: ['calidad', 'gerencia'],
  registrarEvaluacionSgc: 'calidad',
  guardarCapacitacionSgc: 'calidad',
  registrarRealizacionCapacitacionSgc: 'calidad',
  registrarEficaciaCapacitacionSgc: 'calidad'
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

function handleGetDetalleProyecto_(data, contexto) {
  return responderResultado_(Proyectos.getDetalle(data, contexto));
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

function handleListarTareasProyecto_(data, contexto) {
  return responderResultado_(Proyectos.listarTareas(data, contexto));
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

function handleGuardarDescriptorSgc_(data, contexto) {
  return responderResultado_(Personas.guardarDescriptor(data, contexto));
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
  return responderResultado_(Personas.registrarEficacia(data, contexto));
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
