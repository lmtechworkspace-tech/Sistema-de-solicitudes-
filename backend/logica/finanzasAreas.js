'use strict';

/**
 * finanzasAreas.js — Qué apartados de Finanzas ve cada persona (Finanzas v5.9, 02-11-2026; segunda revisión con gerencia).
 *
 * Gerencia pidió que «a nivel de usuario, uno tenga acceso a unas partes y no a otras»: por ejemplo, que alguien revise
 * solo la planilla del banco y otra persona vea solo el FLUJO y los proyectos. Las capacidades (finanzasBase) dicen QUÉ
 * puede hacer cada persona (registrar, aplicar, cerrar…); las áreas dicen DÓNDE puede entrar.
 *
 * Igual que la lista de acceso, se configura SOLO en el servidor (nadie se da acceso desde una pantalla):
 *   SIGSO_FINANZAS_AREAS="<cuenta_id>:PLANILLA|COBRANZA;<cuenta_id>:FLUJO|INFORMES"
 * Quien no aparece ahí ve todo (como hasta hoy). El ajuste no da acceso a nadie que no esté en SIGSO_FINANZAS_ACCESO.
 *
 * Se aplica en el servidor (router.js, antes de cada acción de Finanzas) y la pantalla solo esconde lo que no se puede abrir.
 */

const AREAS = {
  PLANILLA: 'Planilla del banco, cargas de archivos y cierre de meses',
  INFORMES: 'Informes, informe del mes en PDF y exportaciones',
  FLUJO: 'FLUJO, proyectado vs real, proyectos, préstamos y aportes, presupuesto',
  SALDOS: 'Saldo por cliente (cuenta corriente de cada cliente)',
  COBRANZA: 'Cobranza, deudas anteriores, todos los clientes y fichas de clientes',
  AJUSTES: 'Cuentas del banco, catálogos, nombres y reglas'
};

// Lo que cualquiera de la lista necesita para entrar y ver su propio acceso.
const SIEMPRE = new Set(['finanzasEstado', 'finanzasPrepararAutenticador', 'finanzasActivarAutenticador', 'finanzasEntrar', 'finanzasSalir',
  'finanzasCatalogo', 'finanzasResumen', 'finanzasBitacora', 'finanzasDondeQuedo', 'finanzasMejoras']);

const POR_AREA = {
  PLANILLA: ['finanzasHoja', 'finanzasHojaGuardar', 'finanzasHojaBorrar', 'finanzasHojaGrupo', 'finanzasHojaMoverMes', 'finanzasHojaRevision',
    'finanzasRevisarCartola', 'finanzasImportarCartola', 'finanzasImportarDocBanco', 'finanzasAceptarSugerenciasDoc', 'finanzasGuardarCuentaPaso',
    'finanzasMovimientos', 'finanzasClasificar', 'finanzasConfirmarSugeridas', 'finanzasAprenderPlanilla', 'finanzasResumenBancos', 'finanzasImportarDetalle',
    'finanzasRevisarExcelBancos', 'finanzasGuardarNombres', 'finanzasAprenderExcelBancos', 'finanzasRevisarPegado', 'finanzasPublicarPegado',
    'finanzasLibro', 'finanzasLlevarMesBancos', 'finanzasLibroAgrupar', 'finanzasLibroSacarDeGrupo', 'finanzasRegistroAnotar', 'finanzasRegistroCorregir',
    'finanzasRegistroBorrar', 'finanzasLibroReaplicar', 'finanzasLibroNombres', 'finanzasCargarLibro', 'finanzasFuentes', 'finanzasFuente',
    'finanzasPublicarHoja', 'finanzasCorregirFilaCarga', 'finanzasCierre', 'finanzasCerrarMes', 'finanzasReabrirMes', 'finanzasEnviarRevision',
    'finanzasObservarCierre', 'finanzasResolverObservacion', 'finanzasExcepcionCierre', 'finanzasVersionCierre', 'finanzasRevisarAntes', 'finanzasElMes',
    'finanzasConciliacion', 'finanzasCandidatos', 'finanzasConciliar', 'finanzasDesconciliar', 'finanzasMarcarDistintas', 'finanzasExplicarRemanente',
    'finanzasCandidatas', 'finanzasGestionDeCandidata', 'finanzasCuadroControl', 'finanzasParalelo', 'finanzasPasoRetiro',
    'finanzasRobotBciGeneral', 'finanzasRobotBciIniciar', 'finanzasRobotBciEstado', 'finanzasRobotBciUltimo', 'finanzasRobotBciArchivo'],
  INFORMES: ['finanzasInforme', 'finanzasInformePdf', 'finanzasReporte', 'finanzasReporteDetalle', 'finanzasExportar', 'finanzasDescargarRespaldo'],
  FLUJO: ['finanzasHojaFlujo', 'finanzasLibroFlujo', 'finanzasFinanciamiento', 'finanzasGuardarMetaProyecto', 'finanzasPresupuesto', 'finanzasGuardarPresupuesto',
    'finanzasAprobarPresupuesto', 'finanzasPrestamos', 'finanzasGuardarPrestamo', 'finanzasVincularPrestamo', 'finanzasPrestamosSocios', 'finanzasGuardarPrestamista',
    'finanzasProyectos', 'finanzasGuardarProyecto', 'finanzasProvisiones', 'finanzasGuardarProvision', 'finanzasCompromisos', 'finanzasGuardarCompromiso',
    'finanzasProyeccion', 'finanzasGastosCompartidos', 'finanzasGuardarGastoCompartido', 'finanzasVincularGasto', 'finanzasPrevisualizarReparto'],
  SALDOS: ['finanzasHojaClientes', 'finanzasLibroClientes', 'finanzasFondos', 'finanzasFichaFondos', 'finanzasGuardarGestion', 'finanzasEstadoGestion',
    'finanzasAsignarGestion', 'finanzasGuardarApertura', 'finanzasDecidirApertura', 'finanzasReasignar', 'finanzasAnularReasignacion', 'finanzasDecidirRemanente',
    'finanzasGestionDesdePieza', 'finanzasRevisarAperturas', 'finanzasProponerAperturas', 'finanzasCorregirApertura', 'finanzasConvertirRemanente'],
  COBRANZA: ['finanzasHojaCobranza', 'finanzasCobranza', 'finanzasDeudas', 'finanzasGuardarDeuda', 'finanzasBorrarDeuda', 'finanzasImportarDeudas',
    'finanzasPanoramaClientes', 'finanzasFacturas', 'finanzasRevisarVentas', 'finanzasImportarVentas', 'finanzasImportarFacturasPlanilla', 'finanzasFichaCliente',
    'finanzasEstadoFactura', 'finanzasEditarFactura', 'finanzasAplicar', 'finanzasDesaplicar', 'finanzasAceptarSugeridasCobro', 'finanzasGuardarRelacionCobro',
    'finanzasRelacionesCobro', 'finanzasCobrosElegibles', 'finanzasAnularRelacionCobro', 'finanzasPendientes', 'finanzasClientes', 'finanzasCliente',
    'finanzasGuardarFicha', 'finanzasGuardarServicio', 'finanzasGuardarDocumento', 'finanzasSubirAdjunto', 'finanzasDescargarAdjunto', 'finanzasGuardarAsignacion']
};
const AREA_DE = new Map();
Object.keys(POR_AREA).forEach((a) => POR_AREA[a].forEach((acc) => AREA_DE.set(acc, a)));

/** Área de una acción de Finanzas (lo no listado es configuración: AJUSTES). */
function areaDe_(accion) { return SIEMPRE.has(accion) ? null : AREA_DE.get(accion) || 'AJUSTES'; }

/** Áreas de una persona, o null si no tiene ajuste (ve todo). */
function areasDe_(contexto) {
  const id = String((contexto && contexto.cuenta_id) || '').toLowerCase();
  if (!id) return null;
  for (const linea of String(process.env.SIGSO_FINANZAS_AREAS || '').split(';').map((s) => s.trim()).filter(Boolean)) {
    const i = linea.indexOf(':');
    if (i < 0 || linea.slice(0, i).trim().toLowerCase() !== id) continue;
    return linea.slice(i + 1).split('|').map((a) => a.trim().toUpperCase()).filter((a) => AREAS[a]);
  }
  return null;
}
function areasVisibles_(contexto) { return areasDe_(contexto) || Object.keys(AREAS); }

/**
 * null si la persona puede usar la acción; si no, un error para la pantalla. Solo se llama para acciones de Finanzas y
 * después de saber que la persona está en la lista (a quien no está, la bóveda le responde «no existe»).
 */
function exigirArea_(accion, contexto) {
  const area = areaDe_(accion);
  if (!area) return null;
  const mias = areasDe_(contexto);
  if (!mias || mias.indexOf(area) !== -1) return null;
  return { _forbidden: true, codigo: 'AREA', message: 'Tu acceso a Finanzas no incluye este apartado (' + AREAS[area].split(',')[0].toLowerCase() + ').' };
}

module.exports = { AREAS, areaDe_, areasDe_, areasVisibles_, exigirArea_ };
