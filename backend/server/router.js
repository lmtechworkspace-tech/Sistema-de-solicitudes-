'use strict';

/**
 * router.js — equivalente de BACKOFFICE_ACTIONS + responderResultado_ +
 * resolverContextoPortal_ en backend/backoffice/Code.gs: un mapa accion ->
 * funcion de logica, y una traduccion uniforme del resultado a {status,
 * body} HTTP.
 *
 * ARREGLO DE SEGURIDAD respecto de la version anterior de este archivo: ya
 * NO se acepta un `contexto` mandado por el cliente en el cuerpo de la
 * peticion (eso permitia a cualquiera declararse rol:'ADM' y saltarse todos
 * los permisos -- un hueco real, documentado como temporal cuando se agrego
 * la primera version de este router). Ahora, para toda accion protegida, el
 * contexto se resuelve del lado del servidor a partir de `data.portal_token`
 * contra SESIONES_PORTAL/CUENTAS_PORTAL -- exactamente como ya hacia
 * resolverContextoPortal_ en el .gs, mismo campo, mismo nombre (asi el
 * frontend actual, que ya manda portal_token, no necesita cambios cuando se
 * apunte a este servidor).
 *
 * PENDIENTE, documentado y no fingido: el .gs valida ademas, por cada
 * accion, que la cuenta tenga el MODULO requerido (MODULO_POR_ACCION /
 * resolverContextoPortal_) -- una capa de autorizacion mas fina que el rol.
 * Todavia no se porta: no hay suficientes modulos migrados para que valga la
 * pena el mapa completo. Cuando se porten mas, agregar ese mapa aqui mismo.
 */

const Catalogos = require('../logica/catalogos');
const Portal = require('../logica/portal');
const CuentasPortal = require('../logica/cuentasPortal');
const Sesiones = require('../logica/sesiones');
const Solicitudes = require('../logica/solicitudes');
const SolicitudesBO = require('../logica/solicitudesBackoffice');
const SolicitudesPublico = require('../logica/solicitudesPublico');
const Jefatura = require('../logica/jefatura');
const Dashboard = require('../logica/dashboard');
const Gerencia = require('../logica/gerencia');
const Notificaciones = require('../logica/notificaciones');
const Novedades = require('../logica/novedades');
const Pausas = require('../logica/pausas');
const Actividades = require('../logica/actividades');
const Proyectos = require('../logica/proyectos');
const Calidad = require('../logica/calidadSgc');
const Personas = require('../logica/personasSgc');
const NoConformidades = require('../logica/noConformidadesSgc');
const Auditorias = require('../logica/auditoriasSgc');
const Quejas = require('../logica/quejasSgc');
const Proveedores = require('../logica/proveedoresSgc');
const RevisionDireccion = require('../logica/revisionDireccionSgc');
const Objetivos = require('../logica/objetivosSgc');
const MatrizCobertura = require('../logica/matrizCoberturaSgc');
const Alcance = require('../logica/alcanceSgc');
const Contexto = require('../logica/contextoSgc');
const Riesgos = require('../logica/riesgosSgc');
const Procesos = require('../logica/procesosSgc');
const Indicadores = require('../logica/indicadoresSgc');
const Tablero = require('../logica/tableroSgc');
const Prestaciones = require('../logica/prestacionesSgc');
const OrdenTrabajo = require('../logica/ordenTrabajo');
const ReporteActividades = require('../logica/reporteActividades');
const EvidenciaClausulaSgc = require('../logica/evidenciaClausulaSgc');
const ReporteProyecto = require('../logica/reporteProyecto');

// Acciones que NO requieren una sesion ya resuelta: o bien la crean
// (portalLogin), o bien resuelven su propio token internamente y devuelven
// forbidden si no sirve (portalLogout/portalSesion/portalCambiarPassword) --
// mismo contrato que Portal.gs, que las expone como self-service, no como
// acciones gateadas por rol. crearSolicitud tambien es publica a proposito:
// es el formulario de ingreso (backend/intake), que cualquier persona sin
// cuenta puede enviar -- igual que en Apps Script, donde Intake es un
// proyecto separado sin gate de identidad.
const ACCIONES_PUBLICAS = new Set([
  'portalLogin', 'portalLogout', 'portalSesion', 'portalCambiarPassword', 'crearSolicitud',
  'consultarEstado', 'solicitarCodigoAcceso', 'misSolicitudes',
  'editarSubsolicitud', 'eliminarArchivo', 'responderConsulta', 'validarCierre',
  'getCatalogos'
]);

const ACCIONES = {
  portalLogin: (db, data) => Portal.login(db, data),
  portalLogout: (db, data) => Portal.logout(db, data),
  portalSesion: (db, data) => Portal.sesion(db, data),
  portalCambiarPassword: (db, data) => Portal.cambiarPassword(db, data),

  listarCuentasPortal: (db, data, contexto) => CuentasPortal.listar(db, data, contexto),
  gestionarCuentaPortal: (db, data, contexto) => CuentasPortal.gestionar(db, data, contexto),

  guardarCatalogo: (db, data, contexto) => Catalogos.guardar(db, data, contexto),
  listarCatalogo: (db, data, contexto) => Catalogos.listar(db, data, contexto),

  crearSolicitud: (db, data) => Solicitudes.crearSolicitud(db, data),
  getCatalogos: (db) => Catalogos.getCatalogosPublicos(db),

  consultarEstado: (db, data) => SolicitudesPublico.estadoPublico(db, data.solicitud_id, data.email),
  solicitarCodigoAcceso: (db, data) => SolicitudesPublico.solicitarCodigoAcceso(db, data),
  misSolicitudes: (db, data) => SolicitudesPublico.misSolicitudes(db, data),
  editarSubsolicitud: (db, data) => SolicitudesPublico.editarSubsolicitud(db, data),
  eliminarArchivo: (db, data) => SolicitudesPublico.eliminarArchivo(db, data),
  responderConsulta: (db, data) => SolicitudesPublico.responderConsulta(db, data),
  validarCierre: (db, data) => SolicitudesPublico.validarCierre(db, data),

  actualizarEstado: (db, data, contexto) => SolicitudesBO.actualizarEstado(db, data, contexto),
  actualizarPrioridad: (db, data, contexto) => SolicitudesBO.actualizarPrioridad(db, data, contexto),
  comprometerFecha: (db, data, contexto) => SolicitudesBO.comprometerFecha(db, data, contexto),
  derivarSolicitud: (db, data, contexto) => SolicitudesBO.derivarSolicitud(db, data, contexto),
  editarContenidoSubsolicitud: (db, data, contexto) => SolicitudesBO.editarContenidoSubsolicitud(db, data, contexto),
  getSolicitudDetalle: (db, data, contexto) => SolicitudesBO.getDetalle(db, data.solicitud_id, contexto),
  // §8.3 del handoff de migracion: motor de PDF en Node (pdfkit), primer
  // modulo completo (antes stub inline, ver git blame). descargar() es
  // async (genera el PDF con pdfkit) -- ejecutarAccion ya espera con
  // await cualquier accion que devuelva una Promise.
  descargarOrdenTrabajo: (db, data, contexto) => OrdenTrabajo.descargar(db, data, contexto),

  listarJefaturas: (db, data, contexto) => Jefatura.listar(db, data, contexto),
  gestionarJefatura: (db, data, contexto) => Jefatura.gestionar(db, data, contexto),

  getDashboardData: (db, data, contexto) => Dashboard.getData(db, data, contexto),
  getPautaTrabajo: (db, data, contexto) => Dashboard.getPautaDesarrollador(db, data, contexto),

  getPanelGerencia: (db, data, contexto) => Gerencia.getPanel(db, data, contexto),
  getPanelJefatura: (db, data, contexto) => Jefatura.getPanel(db, data, contexto),

  listarLogsNotificaciones: (db, data, contexto) => Notificaciones.listarLogs(db, data, contexto),

  // Modulo Novedades (mismos nombres de accion que BACKOFFICE_ACTIONS en el .gs).
  listarAreasPublicablesNovedad: (db, data, contexto) => Novedades.listarAreasPublicables(db, data, contexto),
  getFeedNovedades: (db, data, contexto) => Novedades.getFeed(db, data, contexto),
  getDetalleNovedad: (db, data, contexto) => Novedades.getDetalle(db, data, contexto),
  getHistorialNovedad: (db, data, contexto) => Novedades.getHistorial(db, data, contexto),
  publicarNovedad: (db, data, contexto) => Novedades.publicar(db, data, contexto),
  aprobarNovedad: (db, data, contexto) => Novedades.aprobar(db, data, contexto),
  devolverNovedad: (db, data, contexto) => Novedades.devolver(db, data, contexto),
  rechazarNovedad: (db, data, contexto) => Novedades.rechazar(db, data, contexto),
  reenviarNovedad: (db, data, contexto) => Novedades.reenviar(db, data, contexto),
  listarPendientesAprobacionNovedad: (db, data, contexto) => Novedades.listarPendientesAprobacion(db, data, contexto),
  misPendientesNovedad: (db, data, contexto) => Novedades.misPendientes(db, data, contexto),
  despublicarNovedad: (db, data, contexto) => Novedades.despublicar(db, data, contexto),
  marcarLeidaNovedad: (db, data, contexto) => Novedades.marcarLeida(db, data, contexto),
  descargarAdjuntoNovedad: (db, data, contexto) => Novedades.descargarAdjunto(db, data, contexto),
  getLectoresNovedad: (db, data, contexto) => Novedades.getLectores(db, data, contexto),
  getPanelCumplimientoNovedad: (db, data, contexto) => Novedades.getPanelCumplimiento(db, data, contexto),

  // Modulo Pausas activas (mismos nombres de accion que BACKOFFICE_ACTIONS).
  listarPausasConfig: (db, data, contexto) => Pausas.listarConfig(db, data, contexto),
  guardarPausasConfig: (db, data, contexto) => Pausas.guardarConfig(db, data, contexto),
  listarPausasCoordinadores: (db, data, contexto) => Pausas.listarCoordinadores(db, data, contexto),
  gestionarPausasCoordinador: (db, data, contexto) => Pausas.gestionarCoordinador(db, data, contexto),
  listarPausasTrabajadores: (db, data, contexto) => Pausas.listarTrabajadores(db, data, contexto),
  gestionarPausasTrabajador: (db, data, contexto) => Pausas.gestionarTrabajador(db, data, contexto),
  sembrarRosterPausas: (db, data, contexto) => Pausas.sembrarRosterDesdeCuentas(db, data, contexto),
  asignarModuloPausasRoster: (db, data, contexto) => Pausas.asignarModuloPausasRoster(db, data, contexto),
  listarPausasProgramadas: (db, data, contexto) => Pausas.listarProgramadas(db, data, contexto),
  programarPausasDelDia: (db, data, contexto) => Pausas.programarDelDiaAdmin(db, data, contexto),
  gestionarPausaProgramada: (db, data, contexto) => Pausas.gestionarPausaProgramada(db, data, contexto),
  getPausaHoyTrabajador: (db, data, contexto) => Pausas.getPausaHoyTrabajador(db, data, contexto),
  registrarAsistenciaPausa: (db, data, contexto) => Pausas.registrarAsistencia(db, data, contexto),
  getPanelCoordinadorPausas: (db, data, contexto) => Pausas.getPanelCoordinador(db, data, contexto),
  gestionarPausaCoordinador: (db, data, contexto) => Pausas.gestionarPausaCoordinador(db, data, contexto),
  registrarAsistenciaGrupalPausas: (db, data, contexto) => Pausas.registrarAsistenciaGrupal(db, data, contexto),
  getReporteCumplimientoPausas: (db, data, contexto) => Pausas.getReporteCumplimiento(db, data, contexto),
  descargarReporteCumplimientoPausasPdf: (db, data, contexto) => Pausas.descargarReporteCumplimientoPdf(db, data, contexto),
  listarRosterCoordinadorPausas: (db, data, contexto) => Pausas.listarRosterCoordinador(db, data, contexto),
  getHistorialTrabajadorPausas: (db, data, contexto) => Pausas.getHistorialTrabajador(db, data, contexto),
  getReporteGerenciaPausas: (db, data, contexto) => Pausas.getReporteGerencia(db, data, contexto),
  descargarReporteGerenciaPausasPdf: (db, data, contexto) => Pausas.descargarReporteGerenciaPdf(db, data, contexto),

  // Modulo Actividades / Gestion Operacional (v7.0). Motor base sobre el que
  // Proyectos.crearTarea/listarTareas son wrappers (Proyectos aun no portado).
  listarActividades: (db, data, contexto) => Actividades.listar(db, data, contexto),
  getDetalleActividad: (db, data, contexto) => Actividades.obtenerDetalle(db, data, contexto),
  crearActividad: (db, data, contexto) => Actividades.crear(db, data, contexto),
  confirmarActividad: (db, data, contexto) => Actividades.confirmar(db, data, contexto),
  checkinActividad: (db, data, contexto) => Actividades.checkin(db, data, contexto),
  validarActividad: (db, data, contexto) => Actividades.validar(db, data, contexto),
  cancelarActividad: (db, data, contexto) => Actividades.cancelar(db, data, contexto),
  reprogramarActividad: (db, data, contexto) => Actividades.reprogramar(db, data, contexto),
  panelEquipoActividades: (db, data, contexto) => Actividades.panelEquipo(db, data, contexto),
  reasignarActividad: (db, data, contexto) => Actividades.reasignar(db, data, contexto),
  pedirActualizacionActividad: (db, data, contexto) => Actividades.pedirActualizacion(db, data, contexto),
  getPanelGerenciaActividades: (db, data, contexto) => Actividades.getPanelGerencia(db, data, contexto),
  generarReporteActividades: (db, data, contexto) => Actividades.generarReporte(db, data, contexto),
  // §8.3 del handoff: motor de PDF (pdfkit) ya activo desde OrdenTrabajo --
  // este es el segundo incremento, reusa el mismo helper (pdfDocumento.js).
  descargarReporteActividadesPdf: (db, data, contexto) => ReporteActividades.descargarReporte(db, data, contexto),
  descargarActaReunionPdf: (db, data, contexto) => ReporteActividades.descargarActa(db, data, contexto),

  // Modulo Proyectos (v9.0+, incremento 1: MVP + Sala + reuniones/decisiones
  // + entregables/riesgos + plantillas + portafolio). Las TAREAS de un
  // proyecto son ACTIVIDADES -- crearTareaProyecto/listarTareasProyecto son
  // wrappers finos sobre Actividades (el resto del ciclo de vida de la tarea
  // sigue usando las acciones de Actividades ya conectadas arriba).
  listarProyectos: (db, data, contexto) => Proyectos.listar(db, data, contexto),
  listarMisTareasProyectos: (db, data, contexto) => Proyectos.listarMisTareas(db, data, contexto),
  listarMiBitacoraProyectos: (db, data, contexto) => Proyectos.listarMiBitacora(db, data, contexto),
  listarCalendarioProyectos: (db, data, contexto) => Proyectos.listarCalendario(db, data, contexto),
  guardarProyectoComoPlantilla: (db, data, contexto) => Proyectos.guardarComoPlantilla(db, data, contexto),
  listarPlantillasProyecto: (db, data, contexto) => Proyectos.listarPlantillas(db, data, contexto),
  marcarSalaVisitadaProyecto: (db, data, contexto) => Proyectos.marcarSalaVisitada(db, data, contexto),
  gestionarReunionProyecto: (db, data, contexto) => Proyectos.gestionarReunion(db, data, contexto),
  agregarAcuerdoReunionProyecto: (db, data, contexto) => Proyectos.agregarAcuerdoReunion(db, data, contexto),
  eliminarAcuerdoReunionProyecto: (db, data, contexto) => Proyectos.eliminarAcuerdoReunion(db, data, contexto),
  convertirAcuerdoEnTareaProyecto: (db, data, contexto) => Proyectos.convertirAcuerdoEnTarea(db, data, contexto),
  listarReunionesProyecto: (db, data, contexto) => Proyectos.listarReuniones(db, data, contexto),
  gestionarDecisionProyecto: (db, data, contexto) => Proyectos.gestionarDecision(db, data, contexto),
  listarDecisionesProyecto: (db, data, contexto) => Proyectos.listarDecisiones(db, data, contexto),
  getDetalleProyecto: (db, data, contexto) => Proyectos.getDetalle(db, data, contexto),
  getDetalleCompletoProyecto: (db, data, contexto) => Proyectos.getDetalleCompleto(db, data, contexto),
  crearProyecto: (db, data, contexto) => Proyectos.crear(db, data, contexto),
  actualizarProyecto: (db, data, contexto) => Proyectos.actualizar(db, data, contexto),
  gestionarIntegranteProyecto: (db, data, contexto) => Proyectos.gestionarIntegrante(db, data, contexto),
  gestionarHitoProyecto: (db, data, contexto) => Proyectos.gestionarHito(db, data, contexto),
  crearTareaProyecto: (db, data, contexto) => Proyectos.crearTarea(db, data, contexto),
  editarTareaProyecto: (db, data, contexto) => Proyectos.editarTarea(db, data, contexto),
  listarTareasProyecto: (db, data, contexto) => Proyectos.listarTareas(db, data, contexto),
  listarBitacoraProyecto: (db, data, contexto) => Proyectos.listarBitacora(db, data, contexto),
  listarSalaProyecto: (db, data, contexto) => Proyectos.listarSala(db, data, contexto),
  publicarEnSalaProyecto: (db, data, contexto) => Proyectos.publicarEnSala(db, data, contexto),
  convertirEventoEnTareaProyecto: (db, data, contexto) => Proyectos.convertirEventoEnTarea(db, data, contexto),
  gestionarEntregableProyecto: (db, data, contexto) => Proyectos.gestionarEntregable(db, data, contexto),
  revisarEntregableProyecto: (db, data, contexto) => Proyectos.revisarEntregable(db, data, contexto),
  gestionarRiesgoProyecto: (db, data, contexto) => Proyectos.gestionarRiesgo(db, data, contexto),
  getResumenPortafolioProyectos: (db, data, contexto) => Proyectos.getResumenPortafolio(db, contexto),

  // Cronograma avanzado (v11 Reingenieria Cronograma): incremento 2.
  guardarRegistroDiaProyecto: (db, data, contexto) => Proyectos.guardarRegistroDia(db, data, contexto),
  eliminarRegistroDiaProyecto: (db, data, contexto) => Proyectos.eliminarRegistroDia(db, data, contexto),
  obtenerRendimientoProyecto: (db, data, contexto) => Proyectos.obtenerRendimiento(db, data, contexto),
  congelarBaselineProyecto: (db, data, contexto) => Proyectos.congelarBaseline(db, data, contexto),
  reprogramarTareaProyecto: (db, data, contexto) => Proyectos.reprogramarTarea(db, data, contexto),
  obtenerAnaliticaProyecto: (db, data, contexto) => Proyectos.obtenerAnalitica(db, data, contexto),
  obtenerWorkloadPortafolioProyectos: (db, data, contexto) => Proyectos.obtenerWorkloadPortafolio(db, data, contexto),

  // Centro documental (v13 Fase 4) + adjuntos de Sala: usan R2 desde
  // 2026-09-18 (almacenamiento.js).
  subirAdjuntoProyecto: (db, data, contexto) => Proyectos.subirAdjunto(db, data, contexto),
  descargarAdjuntoProyecto: (db, data, contexto) => Proyectos.descargarAdjunto(db, data, contexto),
  gestionarDocumentoProyecto: (db, data, contexto) => Proyectos.gestionarDocumento(db, data, contexto),
  subirVersionDocumentoProyecto: (db, data, contexto) => Proyectos.subirVersionDocumento(db, data, contexto),
  marcarVersionVigenteProyecto: (db, data, contexto) => Proyectos.marcarVersionVigente(db, data, contexto),
  listarVersionesDocumentoProyecto: (db, data, contexto) => Proyectos.listarVersionesDocumento(db, data, contexto),
  descargarVersionDocumentoProyecto: (db, data, contexto) => Proyectos.descargarVersionDocumento(db, data, contexto),
  descargarDocumentoProyecto: (db, data, contexto) => Proyectos.descargarDocumentoProyecto(db, data, contexto),
  // §8.3 del handoff: PDF ejecutivo del camino "de un clic" (sin config),
  // motor pdfkit -- ver la cabecera de reporteProyecto.js para lo que
  // queda fuera de alcance a proposito (modo "Configurar informe").
  descargarReporteProyecto: (db, data, contexto) => ReporteProyecto.descargarReporte(db, data, contexto),
  // El libro Excel es un motor distinto (hoja de calculo, no PDF) -- sigue
  // gateado, fuera de alcance de "el motor de PDF" (§8.3).
  descargarLibroProyecto: () => ({ _validationError: true, message: 'La descarga del libro Excel del proyecto aun no esta disponible en el nuevo backend.' }),

  // Modulo SGC ISO 9001 (v10.0+, incremento 1: Fase 1 + Fase 1b -- repositorio
  // documental controlado + roles/accesos del SGC + acuse de recibo). Primer
  // incremento del modulo mas grande de la migracion (~123 acciones / 32
  // hojas), portado por fases igual que el propio Calidad.gs. La subida y
  // descarga de archivos quedan gateadas dentro de la propia logica (R2).
  listarDocumentosSgc: (db, data, contexto) => Calidad.listarDocumentos(db, data, contexto),
  getDocumentoSgc: (db, data, contexto) => Calidad.getDocumento(db, data, contexto),
  sembrarDocumentosExternosSgc: (db, data, contexto) => Calidad.sembrarDocumentosExternos(db, data, contexto),
  crearDocumentoSgc: (db, data, contexto) => Calidad.crearDocumento(db, data, contexto),
  nuevaVersionDocumentoSgc: (db, data, contexto) => Calidad.nuevaVersion(db, data, contexto),
  actualizarDocumentoSgc: (db, data, contexto) => Calidad.actualizarDocumento(db, data, contexto),
  descargarDocumentoSgc: (db, data, contexto) => Calidad.descargarDocumento(db, data, contexto),
  acusarDocumentoSgc: (db, data, contexto) => Calidad.acusarDocumento(db, data, contexto),
  getCumplimientoDocumentoSgc: (db, data, contexto) => Calidad.getCumplimiento(db, data, contexto),
  listarRolesSgc: (db, data, contexto) => Calidad.listarRoles(db, data, contexto),
  gestionarRolSgc: (db, data, contexto) => Calidad.gestionarRol(db, data, contexto),
  listarAccesosSgc: (db, data, contexto) => Calidad.listarAccesos(db, data, contexto),
  previsualizarAccesoSgc: (db, data, contexto) => Calidad.previsualizarAcceso(db, data, contexto),
  getMatrizDistribucionSgc: (db, data, contexto) => Calidad.getMatrizDistribucion(db, data, contexto),
  getDocumentosConfidencialesSgc: (db, data, contexto) => Calidad.getDocumentosConfidenciales(db, data, contexto),

  // SGC ISO 9001 Fase 2a + 2b (PRO-02): la ficha del trabajador -- datos,
  // descriptor de cargo, carpeta digital, induccion y monitoreo de
  // competencias (evaluaciones + capacitaciones). Archivos gateados dentro
  // de la propia logica (R2), mismo criterio que el incremento 1.
  listarPersonasSgc: (db, data, contexto) => Personas.listar(db, data, contexto),
  getFichaPersonaSgc: (db, data, contexto) => Personas.getFicha(db, data, contexto),
  guardarPersonaSgc: (db, data, contexto) => Personas.guardarPersona(db, data, contexto),
  desvincularPersonaSgc: (db, data, contexto) => Personas.desvincular(db, data, contexto),
  quitarPersonaAlcanceSgc: (db, data, contexto) => Personas.quitarDelAlcance(db, data, contexto),
  guardarDescriptorSgc: (db, data, contexto) => Personas.guardarDescriptor(db, data, contexto),
  actualizarDescriptorSgc: (db, data, contexto) => Personas.actualizarDescriptor(db, data, contexto),
  descargarDescriptorSgc: (db, data, contexto) => Personas.descargarDescriptor(db, data, contexto),
  guardarDocumentoPersonaSgc: (db, data, contexto) => Personas.guardarDocumento(db, data, contexto),
  descargarDocumentoPersonaSgc: (db, data, contexto) => Personas.descargarDocumento(db, data, contexto),
  registrarInduccionSgc: (db, data, contexto) => Personas.registrarInduccion(db, data, contexto),
  registrarEvaluacionSgc: (db, data, contexto) => Personas.registrarEvaluacion(db, data, contexto),
  listarCapacitacionesSgc: (db, data, contexto) => Personas.listarCapacitaciones(db, data, contexto),
  guardarCapacitacionSgc: (db, data, contexto) => Personas.guardarCapacitacion(db, data, contexto),
  registrarRealizacionCapacitacionSgc: (db, data, contexto) => Personas.registrarRealizacion(db, data, contexto),
  registrarEficaciaCapacitacionSgc: (db, data, contexto) => Personas.registrarEficaciaAsistente(db, data, contexto),

  // SGC ISO 9001 Fase 3a (PRO-06): no conformidades y acciones correctivas
  // -- el motor de mejora, lo que la auditoria de certificacion revisa con
  // mas profundidad (§10.2). Sin archivos: se corta al frontend en el mismo
  // incremento (ver frontend/js/api.js ACCIONES_PORTADAS_NODE).
  listarNcSgc: (db, data, contexto) => NoConformidades.listar(db, data, contexto),
  getDetalleNcSgc: (db, data, contexto) => NoConformidades.getDetalle(db, data, contexto),
  crearNcSgc: (db, data, contexto) => NoConformidades.crear(db, data, contexto),
  registrarCorreccionNcSgc: (db, data, contexto) => NoConformidades.registrarCorreccion(db, data, contexto),
  registrarCausaNcSgc: (db, data, contexto) => NoConformidades.registrarCausa(db, data, contexto),
  registrarAccionNcSgc: (db, data, contexto) => NoConformidades.registrarAccion(db, data, contexto),
  cerrarEtapaNcSgc: (db, data, contexto) => NoConformidades.cerrarEtapa(db, data, contexto),
  verificarEficaciaNcSgc: (db, data, contexto) => NoConformidades.verificarEficacia(db, data, contexto),
  anularNcSgc: (db, data, contexto) => NoConformidades.anular(db, data, contexto),

  // SGC ISO 9001 Fase 3b (PRO-03, §9.2): auditoría interna -- la otra mitad
  // del motor de mejora. Sin archivos: se corta al frontend en el mismo
  // incremento.
  listarAuditoriasSgc: (db, data, contexto) => Auditorias.listar(db, data, contexto),
  getDetalleAuditoriaSgc: (db, data, contexto) => Auditorias.getDetalle(db, data, contexto),
  programarAuditoriaSgc: (db, data, contexto) => Auditorias.programar(db, data, contexto),
  planificarAuditoriaSgc: (db, data, contexto) => Auditorias.planificar(db, data, contexto),
  registrarHallazgoSgc: (db, data, contexto) => Auditorias.registrarHallazgo(db, data, contexto),
  eliminarHallazgoSgc: (db, data, contexto) => Auditorias.eliminarHallazgo(db, data, contexto),
  cerrarEjecucionAuditoriaSgc: (db, data, contexto) => Auditorias.cerrarEjecucion(db, data, contexto),
  emitirInformeAuditoriaSgc: (db, data, contexto) => Auditorias.emitirInforme(db, data, contexto),
  convertirHallazgoEnNcSgc: (db, data, contexto) => Auditorias.convertirHallazgoEnNc(db, data, contexto),
  cerrarAuditoriaSgc: (db, data, contexto) => Auditorias.cerrar(db, data, contexto),
  anularAuditoriaSgc: (db, data, contexto) => Auditorias.anular(db, data, contexto),

  // SGC ISO 9001 Fase 4 (PRO-07): quejas, felicitaciones y consultas. Solo
  // las Partes 2-5 del FO-PRO-07-01 (gestión interna); la Parte 1 (registro
  // público, Intake) no está portada. Sin archivos: se corta al frontend en
  // el mismo incremento.
  listarQuejasSgc: (db, data, contexto) => Quejas.listar(db, data, contexto),
  getDetalleQuejaSgc: (db, data, contexto) => Quejas.getDetalle(db, data, contexto),
  registrarRecepcionQuejaSgc: (db, data, contexto) => Quejas.registrarRecepcion(db, data, contexto),
  registrarInvestigacionQuejaSgc: (db, data, contexto) => Quejas.registrarInvestigacion(db, data, contexto),
  registrarResultadoQuejaSgc: (db, data, contexto) => Quejas.registrarResultado(db, data, contexto),
  registrarResolucionQuejaSgc: (db, data, contexto) => Quejas.registrarResolucion(db, data, contexto),
  convertirQuejaEnNcSgc: (db, data, contexto) => Quejas.convertirEnNc(db, data, contexto),
  registrarNotificacionQuejaSgc: (db, data, contexto) => Quejas.registrarNotificacion(db, data, contexto),
  registrarSeguimientoQuejaSgc: (db, data, contexto) => Quejas.registrarSeguimiento(db, data, contexto),
  anularQuejaSgc: (db, data, contexto) => Quejas.anular(db, data, contexto),

  // SGC ISO 9001 Fase 5a (PRO-04, §8.4): proveedores externos. Sin archivos:
  // se corta al frontend en el mismo incremento.
  listarProveedoresSgc: (db, data, contexto) => Proveedores.listar(db, data, contexto),
  getDetalleProveedorSgc: (db, data, contexto) => Proveedores.getDetalle(db, data, contexto),
  guardarProveedorSgc: (db, data, contexto) => Proveedores.guardar(db, data, contexto),
  evaluarProveedorSgc: (db, data, contexto) => Proveedores.evaluar(db, data, contexto),
  desactivarProveedorSgc: (db, data, contexto) => Proveedores.desactivar(db, data, contexto),

  // SGC ISO 9001 Fase 5b (PRO-05, §9.3): revisión por la dirección. Sin
  // archivos: se corta al frontend en el mismo incremento. Item 8 del
  // catálogo (objetivos de calidad) queda pendiente hasta portar Fase 6a.
  listarRevisionesSgc: (db, data, contexto) => RevisionDireccion.listar(db, data, contexto),
  getDetalleRevisionSgc: (db, data, contexto) => RevisionDireccion.getDetalle(db, data, contexto),
  programarRevisionSgc: (db, data, contexto) => RevisionDireccion.programar(db, data, contexto),
  convocarRevisionSgc: (db, data, contexto) => RevisionDireccion.convocar(db, data, contexto),
  getResumenRevisionSgc: (db, data, contexto) => RevisionDireccion.getResumenAutomatico(db, data, contexto),
  registrarActaRevisionSgc: (db, data, contexto) => RevisionDireccion.registrarActa(db, data, contexto),
  registrarAcuerdoRevisionSgc: (db, data, contexto) => RevisionDireccion.registrarAcuerdo(db, data, contexto),
  cerrarRevisionSgc: (db, data, contexto) => RevisionDireccion.cerrar(db, data, contexto),
  anularRevisionSgc: (db, data, contexto) => RevisionDireccion.anular(db, data, contexto),

  // SGC ISO 9001 Fase 6a (DOC-07, §6.2): objetivos de calidad. Sin
  // archivos: se corta al frontend en el mismo incremento.
  listarObjetivosSgc: (db, data, contexto) => Objetivos.listar(db, data, contexto),
  getDetalleObjetivoSgc: (db, data, contexto) => Objetivos.getDetalle(db, data, contexto),
  sembrarAnioObjetivosSgc: (db, data, contexto) => Objetivos.sembrarAnio(db, data, contexto),
  guardarObjetivoSgc: (db, data, contexto) => Objetivos.guardar(db, data, contexto),
  sugerirLecturaObjetivoSgc: (db, data, contexto) => Objetivos.sugerirLectura(db, data, contexto),
  registrarLecturaObjetivoSgc: (db, data, contexto) => Objetivos.registrarLectura(db, data, contexto),
  anularLecturaObjetivoSgc: (db, data, contexto) => Objetivos.anularLectura(db, data, contexto),

  // SGC ISO 9001 Fase 6b: matriz de cobertura ISO + "modo auditoría".
  // §8.3 del handoff: el PDF de evidencia ya usa el motor pdfkit -- el mas
  // simple de los 4 incrementos (sin fichas ni items, solo titulo+tabla).
  listarMatrizCoberturaSgc: (db, data, contexto) => MatrizCobertura.listar(db, data, contexto),
  getDetalleClausulaCoberturaSgc: (db, data, contexto) => MatrizCobertura.getDetalle(db, data, contexto),
  listarCoberturaHistoricoSgc: (db, data, contexto) => MatrizCobertura.listarHistorico(db, data, contexto),
  descargarEvidenciaClausulaSgc: (db, data, contexto) => EvidenciaClausulaSgc.descargarEvidencia(db, data, contexto),

  // SGC ISO 9001 v11.0 Fase 1 (§4.3): alcance del SGC y exclusiones. Sin
  // archivos: se corta al frontend en el mismo incremento.
  obtenerAlcanceSgc: (db, data, contexto) => Alcance.obtener(db, data, contexto),
  guardarAlcanceSgc: (db, data, contexto) => Alcance.guardar(db, data, contexto),
  nuevaVersionAlcanceSgc: (db, data, contexto) => Alcance.nuevaVersion(db, data, contexto),
  guardarExclusionSgc: (db, data, contexto) => Alcance.guardarExclusion(db, data, contexto),
  anularExclusionSgc: (db, data, contexto) => Alcance.anularExclusion(db, data, contexto),

  // SGC ISO 9001 v11.0 Fase 2 (§4.1 contexto + §4.2 partes interesadas).
  // Sin archivos: se corta al frontend en el mismo incremento.
  obtenerContextoSgc: (db, data, contexto) => Contexto.obtener(db, data, contexto),
  sembrarFodaSgc: (db, data, contexto) => Contexto.sembrarFoda(db, data, contexto),
  guardarFactorContextoSgc: (db, data, contexto) => Contexto.guardarFactor(db, data, contexto),
  anularFactorContextoSgc: (db, data, contexto) => Contexto.anularFactor(db, data, contexto),
  registrarRevisionContextoSgc: (db, data, contexto) => Contexto.registrarRevision(db, data, contexto),
  sembrarPartesSgc: (db, data, contexto) => Contexto.sembrarPartes(db, data, contexto),
  guardarParteInteresadaSgc: (db, data, contexto) => Contexto.guardarParte(db, data, contexto),
  anularParteInteresadaSgc: (db, data, contexto) => Contexto.anularParte(db, data, contexto),

  // SGC ISO 9001 v11.0 Fase 3 (§6.1 riesgos y oportunidades). Sin
  // archivos: se corta al frontend en el mismo incremento.
  listarRiesgosSgc: (db, data, contexto) => Riesgos.listar(db, data, contexto),
  sembrarRiesgosSgc: (db, data, contexto) => Riesgos.sembrarDesdeDoc08(db, data, contexto),
  guardarRiesgoSgc: (db, data, contexto) => Riesgos.guardar(db, data, contexto),
  asignarAccionRiesgoSgc: (db, data, contexto) => Riesgos.asignarAccion(db, data, contexto),
  registrarRevisionRiesgosSgc: (db, data, contexto) => Riesgos.registrarRevision(db, data, contexto),
  anularRiesgoSgc: (db, data, contexto) => Riesgos.anular(db, data, contexto),

  // v11.0 Fase 4 (§4.4): procesos del SGC.
  listarProcesosSgc: (db, data, contexto) => Procesos.listar(db, data, contexto),
  getDetalleProcesoSgc: (db, data, contexto) => Procesos.getDetalle(db, data, contexto),
  sembrarMapaProcesosSgc: (db, data, contexto) => Procesos.sembrarMapa(db, data, contexto),
  guardarProcesoSgc: (db, data, contexto) => Procesos.guardar(db, data, contexto),
  anularProcesoSgc: (db, data, contexto) => Procesos.anular(db, data, contexto),
  registrarRevisionProcesosSgc: (db, data, contexto) => Procesos.registrarRevision(db, data, contexto),

  // v11.0 Fase 6 (§9.1.1): indicadores de proceso.
  listarIndicadoresSgc: (db, data, contexto) => Indicadores.listar(db, data, contexto),
  guardarIndicadorSgc: (db, data, contexto) => Indicadores.guardar(db, data, contexto),
  anularIndicadorSgc: (db, data, contexto) => Indicadores.anular(db, data, contexto),
  registrarLecturaIndicadorSgc: (db, data, contexto) => Indicadores.registrarLectura(db, data, contexto),
  anularLecturaIndicadorSgc: (db, data, contexto) => Indicadores.anularLectura(db, data, contexto),

  // v11.0 Fase 7: tablero del SGC.
  resumenTableroSgc: (db, data, contexto) => Tablero.resumen(db, data, contexto),

  // v11.0 Fase 8 (§8.1/§8.5/§8.6/§8.7): evidencia de servicios prestados.
  listarPrestacionesSgc: (db, data, contexto) => Prestaciones.listar(db, data, contexto),
  registrarPrestacionSgc: (db, data, contexto) => Prestaciones.registrar(db, data, contexto),
  liberarPrestacionSgc: (db, data, contexto) => Prestaciones.liberar(db, data, contexto),
  marcarNoConformePrestacionSgc: (db, data, contexto) => Prestaciones.marcarNoConforme(db, data, contexto),
  abrirNcPrestacionSgc: (db, data, contexto) => Prestaciones.abrirNoConformidad(db, data, contexto),
  anularPrestacionSgc: (db, data, contexto) => Prestaciones.anular(db, data, contexto)
};

function responderResultado_(resultado) {
  if (resultado && resultado._validationError) {
    return { status: 400, body: { ok: false, error: 'validation', message: resultado.message, fields: resultado.fields } };
  }
  if (resultado && resultado._forbidden) {
    return { status: 403, body: { ok: false, error: 'forbidden', message: resultado.message } };
  }
  return { status: 200, body: { ok: true, data: resultado } };
}

/**
 * Mismo criterio de normalizacion de rol que resolverContextoPortal_: una
 * cuenta SOLICITANTE a la que el Admin le dio "bandeja" se trata como DEV
 * (el rol mas restringido con escritura) en los checks del Backoffice, que
 * solo conocen ANA/DEV/ADM/GERENCIA. `rol_origen` conserva el rol real para
 * quien lo necesite (p.ej. mostrar el rol verdadero en el panel de cuentas).
 */
function resolverContextoPortal_(db, token) {
  const cuenta = Sesiones.resolverCuentaPorToken(db, token);
  if (!cuenta) return null;
  const emails = Portal.parsearListaPortal(cuenta.emails);
  const modulos = Portal.parsearListaPortal(cuenta.modulos);
  return {
    email: emails[0] || '',
    rol: cuenta.rol === 'SOLICITANTE' ? 'DEV' : cuenta.rol,
    rol_origen: cuenta.rol,
    modulos: modulos,
    via_portal: true,
    cuenta_id: cuenta.cuenta_id,
    empresa_id: cuenta.empresa_id
  };
}

// async: la mayoria de las acciones son sincronas (SQLite es sincrono) y
// siguen resolviendo en el mismo tick; `await` sobre un valor no-Promise no
// cambia su comportamiento. Las que si envian correo de verdad ahora (ver
// notificaciones.js) devuelven una Promise, y este await es lo que permite
// que app.js espere el resultado real antes de responder.
async function ejecutarAccion(db, action, data) {
  data = data || {};
  const fn = ACCIONES[action];
  if (!fn) {
    return { status: 404, body: { ok: false, error: 'Acción desconocida: ' + action } };
  }

  if (ACCIONES_PUBLICAS.has(action)) {
    return responderResultado_(await fn(db, data));
  }

  const contexto = resolverContextoPortal_(db, data.portal_token);
  if (!contexto) {
    return { status: 403, body: { ok: false, error: 'forbidden', message: 'Sesión inválida o expirada. Ingresa de nuevo.' } };
  }
  return responderResultado_(await fn(db, data, contexto));
}

module.exports = { ejecutarAccion, ACCIONES, resolverContextoPortal_ };
