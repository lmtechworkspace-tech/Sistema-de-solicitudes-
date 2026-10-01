'use strict';

/**
 * controlInternoMatrices.js — las matrices de Contabilidad y RR.HH. como
 * ESPEJO de las planillas del Drive (versión 2026-10-01, pedido del dueño:
 * "toda la información, lo más parecido al Excel"; Contabilidad con las
 * mismas columnas y un mes por hoja; RR.HH. una matriz por hoja, en el orden
 * del libro).
 *
 * Las COLUMNAS de cada matriz están en controlInternoColumnas.js (generadas
 * de las planillas reales). Aquí va lo que la planilla no dice y SIGSO
 * necesita para controlar y reportar:
 *  - tipo: 'mensual' (una hoja por mes: Contabilidad), 'registro' (lista que
 *    crece con cada requerimiento: RR.HH.; el período sale de una fecha) o
 *    'lista' (foto de la situación de cada cliente, sin período);
 *  - situacion(datos): en qué está cada fila (pendiente, en proceso,
 *    terminado...) leyendo SUS columnas, igual que la lee una persona. Es lo
 *    que se libera y lo que cuentan los reportes; nadie lo escribe a mano;
 *  - tiempos: de qué fecha a qué fecha se miden los días de respuesta;
 *  - montos: qué columnas se suman en los reportes;
 *  - copiar: qué columnas pasan al "Abrir el mes" (mensuales por cliente).
 */

const COLUMNAS = require('./controlInternoColumnas');

const DEPARTAMENTOS = [
  { clave: 'CONTABILIDAD', nombre: 'Contabilidad', area: 'CONTABILIDAD' },
  { clave: 'RRHH', nombre: 'Recursos Humanos', area: 'RRHH' }
];

// --- situación de una fila --------------------------------------------------------------
const E = {
  PENDIENTE: { clave: 'PENDIENTE', etiqueta: 'Pendiente', tono: 'alerta' },
  EN_PROCESO: { clave: 'EN_PROCESO', etiqueta: 'En proceso', tono: 'info' },
  TERMINADO: { clave: 'TERMINADO', etiqueta: 'Terminado', tono: 'ok', final: true },
  NO_APLICA: { clave: 'NO_APLICA', etiqueta: 'No aplica', tono: 'neutro', final: true },
  REGISTRADO: { clave: 'REGISTRADO', etiqueta: 'Registrado', tono: 'neutro', final: true }
};
const BASE = [E.PENDIENTE, E.EN_PROCESO, E.TERMINADO, E.NO_APLICA];

function t_(v) { return String(v == null ? '' : v).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }
/** ¿La celda dice que algo se hizo? (una fecha, "SI", "OK", un texto que no es "NO"/"PENDIENTE"). */
function hecho_(v) {
  const s = t_(v);
  if (!s) return false;
  return !/^(NO\b|N A$|NA$|PENDIENTE|SIN\b|FALTA|0$)/.test(s);
}
/** Texto de estado escrito en la planilla -> situación (o '' si no se entiende). */
function porTexto_(v) {
  const s = t_(v);
  if (!s) return '';
  if (/ANULAD|NO APLICA|^N ?A$|NO VA\b/.test(s)) return 'NO_APLICA';
  if (/^NO |^NO$|NO ENVIAD|NO TRAMITAD|NO DECLARAD|NO ACEPTAD|NO POSTULAD|SIN ACUSE|SIN CLAVE|VENCID/.test(s)) return 'PENDIENTE';
  if (/^PENDIENTE|^POR /.test(s)) return 'PENDIENTE';
  if (/PROCESO|REVISION|GESTION|ESPERA|DERIVAD|PENDIENTE DE/.test(s)) return 'EN_PROCESO';
  if (/ENVIAD|TRAMITAD|DECLARAD|^OK\b|^OK$|LISTO|LISTA|FINALIZ|PAGAD|SUBSANAD|ACEPTAD|TERMINAD|REALIZAD|CERRAD|AL DIA|POSTULAD|RESUELT|CARGAD|APROBAD|RATIFICAD|ENTREGAD|COMPLET|^SI\b|^SI$|^S$|GIRADO/.test(s)) return 'TERMINADO';
  return '';
}
/**
 * Regla estándar: 1) el texto de la columna de estado, si dice algo claro;
 * 2) terminado si hay algo en alguna columna de `termina`; 3) en proceso si
 * hay algo en `proceso` (o, con `algo`, en cualquier columna de datos);
 * 4) pendiente.
 */
function regla_(op) {
  const fn = function (d, m) {
    for (const c of op.estado || []) { const r = porTexto_(d[c]); if (r) return r; }
    if ((op.termina || []).some((c) => hecho_(d[c]))) return 'TERMINADO';
    if ((op.proceso || []).some((c) => hecho_(d[c]))) return 'EN_PROCESO';
    if (op.algo) {
      const ign = new Set(op.ignorar || []);
      if (m.columnas.some((c) => !c.rol && !ign.has(c.clave) && hecho_(d[c.clave]))) return 'EN_PROCESO';
    }
    return 'PENDIENTE';
  };
  fn.usa = [].concat(op.estado || [], op.termina || [], op.proceso || [], op.ignorar || []);
  return fn;
}

// --- definiciones ---------------------------------------------------------------------------
const C = 'CONTABILIDAD', R = 'RRHH';
const SC = {
  FAC: 'Facturación', IVA: 'Informe y pago de IVA', CONT: 'Contabilización mensual', CONV: 'Convenios y postergaciones',
  ACU: 'Acuse de recibo', ANO: 'Anotaciones, notificaciones y subsanaciones'
};
const SR = {
  ING: 'Ingreso y término de clientes', CON: 'Contratos, anexos y finiquitos', LIC: 'Licencias, certificados y constancias',
  MEN: 'Proceso mensual', PLA: 'Plataformas, reclamos y procesos anuales', SUB: 'Subsanaciones y otros trámites'
};
const lista = (clave, seccion, nombre, descripcion, extra) => Object.assign({ clave, depto: C, seccion, nombre, descripcion, tipo: 'lista' }, extra || {});
const rh = (clave, seccion, nombre, codigo, hoja, op, extra) => Object.assign({ clave, depto: R, seccion, nombre, codigo, tipo: 'registro', archivo: 'CONTROL DE MATRICES', hojas: [hoja], situacion: regla_(op || { algo: true }) }, extra || {});

const DEFS = [
  // ================================ CONTABILIDAD ================================
  {
    clave: 'FACTURACION', depto: C, seccion: SC.FAC, nombre: 'Facturación mensual', codigo: 'CO-M-3', tipo: 'mensual', unaPorCliente: false,
    descripcion: 'Documentos emitidos por cliente, un registro por documento.', archivo: 'FACTURACION', lectura: { alias: { 'FOLIO FACTURA': 'FOLIO DOCUMENTO' } },
    situacion: regla_({ estado: ['enviada'], termina: ['fecha_envio'], proceso: ['folio_documento', 'fecha_realizacion'] }),
    tiempos: ['recepcion_informacion', 'fecha_envio'], montos: ['monto_neto', 'monto_total']
  },
  {
    clave: 'IVA', depto: C, seccion: SC.IVA, nombre: 'Informe y pago de IVA', codigo: 'CO-M-5', tipo: 'mensual', unaPorCliente: true,
    descripcion: 'Ciclo mensual por cliente: pre-IVA, carta, recordatorios, postergación, pago y envío del F29.', archivo: 'INFORME Y PAGO DE IVA',
    lectura: { alias: { 'PRE IVA': 'MONTO PRE IVA', 'CLASIFICACION INTERNA': 'CLASIFICACION', 'CARTA PODER': 'CARTA PODER ENVIADA' } },
    situacion: regla_({ estado: ['enviado_f29', 'estado_pago'], termina: ['fecha_envio_f_29'], proceso: ['monto_pre_iva', 'fecha_pre_iva', 'fecha_envio_carta', 'fecha_declaracion', 'fecha_pago'] }),
    tiempos: ['fecha_pre_iva', 'fecha_envio_f_29'], montos: ['monto_pago', 'monto_pre_iva', 'monto_ppm', 'retencion_honorario', 'monto_impuesto_unico'],
    copiar: ['clasificacion', 'estatus', 'rrhh', 'quien_paga', 'correo_cliente']
  },
  lista('IVA_CARTAS_PODER', SC.IVA, 'Cartas poder (IVA)', 'Estado de la carta poder de cada cliente para el informe de IVA.', { archivo: 'INFORME Y PAGO DE IVA', hojas: ['CARTA PODER'], sinEncabezado: { 1: 'EMPRESA', 2: 'CARTA PODER', 3: 'ESTADO' } }),
  lista('SITUACION_CLIENTES', SC.IVA, 'Situación de clientes', 'Cartas poder, IVAs pendientes, rectificatorias, domicilio, convenios y anotaciones por cliente.', { archivo: 'INFORME Y PAGO DE IVA', hojas: ['Hoja 10'] }),
  {
    clave: 'CONTABILIZACION', depto: C, seccion: SC.CONT, nombre: 'Contabilización mensual', codigo: 'CO-M-9', tipo: 'mensual', unaPorCliente: true,
    descripcion: 'Por cliente y mes: centralizaciones, contabilizaciones y pagos, con quién y cuándo en cada bloque.', archivo: 'CONTABILIZACION',
    lectura: {
      siempreGrupo: true, gruposValidos: ['CENTRALIZACIONES', 'CONTABILIZACIONES', 'PAGOS'],
      sinGrupo: ['CODIGO', 'EMPRESA', 'RUT', 'CLASIFICACION INTERNA', 'RRHH', 'ESTADO FINAL', 'OBS', 'ASIENTO DE APERTURA', 'FECHA DE REVISION O APERTURA', 'MESES'],
      alias: { 'PAGOS / QUIEN REALIZA > REMUNERACIONES': 'PAGOS / QUIEN REALIZA > SUELDOS', 'PAGOS / FECHA REALIZACION > REMUNERACIONES': 'PAGOS / FECHA REALIZACION > SUELDOS', 'PAGOS / REMUNERACIONES': 'PAGOS / SUELDOS', 'PAGOS / CONVENIOS': 'PAGOS / CONVENIO' }
    },
    dosNiveles: true, hojasExtra: ['SOLO RENTA 2026', 'INSUMINE'], periodoPorFila: 'MESES',
    // ESTADO FINAL existe desde 2025; antes se ve en las tareas: terminado si
    // todas las que se llenaron están en OK / NO APLICA (y hay al menos 8).
    situacion: (d, m) => {
      const r = porTexto_(d.estado_final);
      if (r) return r;
      const items = m.columnas.filter((c) => c.grupo && !/^(QUIEN|FECHA)/.test(c.etiqueta.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))).map((c) => t_(d[c.clave])).filter(Boolean);
      if (!items.length) return 'PENDIENTE';
      const pendiente = items.some((v) => /^(PENDIENTE|NO$|FALTA|POR )/.test(v));
      return !pendiente && items.length >= 8 ? 'TERMINADO' : 'EN_PROCESO';
    },
    copiar: ['codigo', 'clasificacion_interna']
  },
  lista('ARRIENDOS', SC.CONT, 'Arriendos', 'Clientes con arriendo: monto y dónde se registra.', { archivo: 'CONTABILIZACION', hojas: ['ARRIENDOS'] }),
  {
    clave: 'CONVENIOS', depto: C, seccion: SC.CONV, nombre: 'Convenios', codigo: 'CO-M-7', tipo: 'mensual', unaPorCliente: true,
    descripcion: 'Convenios de pago con la TGR por cliente (hasta 9): cuotas pagadas, vencidas y término. Se revisa cada mes.', archivo: 'CONVENIOS',
    lectura: { alias: { 'PIE DE COVENIO 16': 'PIE DE COVENIO 6' } },
    estados: [
      { clave: 'SIN_CONVENIO', etiqueta: 'Sin convenio', tono: 'neutro', final: true },
      { clave: 'AL_DIA', etiqueta: 'Al día', tono: 'ok', final: true },
      { clave: 'CON_VENCIDAS', etiqueta: 'Con cuotas vencidas', tono: 'critico' }
    ],
    situacion: (d) => {
      const n = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      const tiene = /^SI/.test(t_(d.convenios)) || Number(d.cantidad_convenios) > 0 || n.some((i) => hecho_(d['folio_convenio_' + i]));
      if (!tiene) return 'SIN_CONVENIO';
      const vencidas = n.some((i) => Number(d['cuotas_vencidas_convenio_' + i]) > 0 || /VENCID|CAIDO/.test(t_(d['situacion_convenio_' + i])));
      return vencidas ? 'CON_VENCIDAS' : 'AL_DIA';
    },
    montos: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => 'monto_total_deuda_' + i), copiar: '*'
  },
  lista('POSTERGACIONES', SC.CONV, 'Postergaciones', 'Postergaciones de IVA por cliente (períodos 2022-2025).', { archivo: 'CONVENIOS', hojas: ['POSTERGACIONES'] }),
  {
    clave: 'ACUSE', depto: C, seccion: SC.ACU, nombre: 'Acuse de recibo', codigo: 'CO-M-4.3', tipo: 'mensual', unaPorCliente: true,
    descripcion: 'Acuse de recibo mensual de documentos tributarios por cliente.', archivo: 'ACUSE DE RECIBO',
    lectura: { alias: { 'ACUSE DE RECIBO': 'EMPRESA', 'FECHA REALIZACION 1 REVISION': 'FECHA REALIZACION' } },
    situacion: regla_({ estado: ['estado_acuse'], proceso: ['fecha_realizacion', 'hora_acuse', 'monto_iva', 'cantidad_documentos'] }),
    montos: ['monto_iva', 'monto_iva_n_c']
  },
  lista('CARTAS_PODER', SC.ANO, 'Cartas poder', 'Cartas poder firmadas por los clientes.', { archivo: 'ANOTACIONES', hojas: ['CARTA PODER'] }),
  lista('IVAS_PENDIENTES', SC.ANO, 'IVAs pendientes', 'IVAs pendientes de cada cliente.', { archivo: 'ANOTACIONES', hojas: ['IVAS PENDIENTES'] }),
  lista('RECTIFICACIONES', SC.ANO, 'Rectificaciones', 'IVAs por rectificar y su motivo.', { archivo: 'ANOTACIONES', hojas: ['RECTIFICACIONES'] }),
  {
    clave: 'NOTIFICACIONES_SII', depto: C, seccion: SC.ANO, nombre: 'Notificaciones y anotaciones SII', tipo: 'registro',
    descripcion: 'Notificaciones (giros) y anotaciones del SII de cada cliente: las fichas A–W de la planilla.', archivo: 'ANOTACIONES', especial: 'fichas',
    estados: [E.REGISTRADO], situacion: () => 'REGISTRADO', sinLiberacion: true
  },
  lista('SUBSANACION_DOMICILIO', SC.ANO, 'Subsanación de domicilio', 'Empresas que deben demostrar domicilio o actividad: peticiones y folios.', { archivo: 'ANOTACIONES', especial: 'subsanacion' }),
  lista('IVAS_POSTERGADOS', SC.ANO, 'IVAs postergados sin convenio', 'IVAs postergados que no tienen convenio.', { archivo: 'ANOTACIONES', hojas: ['Hoja 21'], sinEncabezado: { 1: 'EMPRESA', 3: 'DETALLE' } }),

  // =================================== RR.HH. ===================================
  rh('INGRESO_CLIENTE_CREACION', SR.ING, 'Ingreso de cliente con creación de empresa', 'RH-M-1.1', 'Ingreso de cliente con creacion', { termina: ['fecha_digitalizacion_hp_incorporacion'], algo: true }, { tiempos: ['fecha_recepcion', 'fecha_digitalizacion_hp_incorporacion'] }),
  rh('INGRESO_CLIENTE_CAMBIO', SR.ING, 'Ingreso de cliente con cambio de administración', 'RH-M-1.2', 'Ingreso cliente con cambio de a', { termina: ['fecha_digitalizacion_hp_incorporacion'], algo: true }, { tiempos: ['fecha_recepcion', 'fecha_digitalizacion_hp_incorporacion'] }),
  rh('CAPACITACION', SR.ING, 'Capacitación HPD o RLD', 'RH-M-1.3', 'Capacitacion HPD O RLD', { termina: ['acuse_capacitacion', 'envio_copias_compromiso_acuse_capacitancion_corr'], algo: true }),
  rh('INGRESO_OBRA', SR.ING, 'Ingreso a obra', 'RH-M-1.4', 'Ingreso a obra', { termina: ['envio_set_contrato_f30'], algo: true }, { tiempos: ['recepcion_requerimiento_documentos_generar', 'envio_set_contrato_f30'] }),
  rh('TERMINO_OBRA', SR.ING, 'Término de obra', 'RH-M-1', ' termino de obra', { termina: ['fecha_termino_obra_contrato'], algo: true }),
  rh('ANEXOS', SR.CON, 'Anexos', 'RH-M-2.2', 'Anexos', { termina: ['envio_doc_cliente'], proceso: ['fecha_actualizacion_facilremu'] }, { tiempos: ['recepcion_requerimiento_documentos_generar', 'envio_doc_cliente'], cantidad: 'cantidad_anexos' }),
  rh('CONTRATOS', SR.CON, 'Contratos', 'RH-M-2.1', 'Contratos', { termina: ['envio_doc_cliente'] }, { tiempos: ['recepcion_requerimiento_documentos_generar', 'envio_doc_cliente'], cantidad: 'cantidad_trabajadores_contratos' }),
  rh('RLE_CONTRATOS', SR.CON, 'RLE contratos', 'RH-M-3', 'RLEContratos', { termina: ['fecha_carga_dt'] }, { cantidad: 'cantidad_contratos_cargado_realmente_dt' }),
  rh('RLE_ANEXOS', SR.CON, 'RLE anexos', 'RH-M-3.5', 'RLEAnexos', { termina: ['fecha_carga_dt'] }),
  rh('FINIQUITOS', SR.CON, 'Finiquitos', 'RH-M-2.7', 'Finiquitos', { termina: ['envio_doc_cliente'] }, { tiempos: ['recepcion_requerimiento', 'envio_doc_cliente'], cantidad: 'n_trabajadores' }),
  rh('RLE_FINIQUITOS', SR.CON, 'RLE finiquitos', 'RH-M-3.6', 'RLEFiniquitos', { termina: ['fecha_carga_finiquito'] }, { cantidad: 'cantidad_finiquitos' }),
  rh('LICENCIAS', SR.LIC, 'Licencias médicas', 'RH-M-2.3', 'Licencias', { estado: ['estado'], termina: ['fecha_envio_cliente'] }, {
    tiempos: ['fecha_tramite', 'fecha_envio_cliente'],
    // El motivo es un dato de salud: solo lo ven quienes están en RR.HH. (decisión del dueño 2026-10-01).
    sensibles: ['motivo']
  }),
  rh('CERTIFICADOS_F301', SR.LIC, 'Certificados F30-1', 'RH-M-2.5', 'CertificadosF301', { termina: ['envio_cliente'] }, { tiempos: ['recepcion_requerimiento_documentos_generar', 'envio_cliente'] }),
  rh('CERTIFICADOS_F30', SR.LIC, 'Certificados F30', 'RH-M-2.4', 'CertificadosF30', { termina: ['envio_cliente'] }, { tiempos: ['recepcion_requerimiento_documentos_generar', 'envio_cliente'] }),
  rh('CONSTANCIAS', SR.LIC, 'Constancias laborales', 'RH-M-2.6', 'ConstanciasLaborales', { termina: ['envio_cliente'] }, { tiempos: ['recepcion_requerimiento_documentos_generar', 'envio_cliente'] }),
  rh('CARTAS_AVISO', SR.LIC, 'Cartas de aviso', 'RH-M-2.8', 'CartasDeAviso', { termina: ['fecha_envio_cliente'], proceso: ['fecha_realiza'] }, { tiempos: ['recepcion_requerimiento_documentos_generar', 'fecha_envio_cliente'], cantidad: 'cantidad' }),
  rh('IUSC', SR.MEN, '3 % e impuesto único de segunda categoría', 'RH-M-3.1', '3%-IUSC', { estado: ['estado'], algo: true, ignorar: ['estado_empresa_1', 'estado_empresa_2', 'mes'] }, { periodoDe: ['mes'], montos: ['monto_iusc', 'monto_3%', 'valor_imposiciones'] }),
  rh('REMUNERACIONES', SR.MEN, 'Remuneraciones', 'RH-M-3.2', 'Remuneraciones', { estado: ['estado_2'], termina: ['fecha_envio_liquidacion'], proceso: ['fecha_derivacion'] }, {
    tiempos: ['fecha_recepcion_informacion', 'fecha_envio_liquidacion'], montos: ['valor_total', 'valor_imposiciones', 'monto_iusc'], cantidad: 'cantidad'
  }),
  rh('LRE', SR.MEN, 'Libro de remuneraciones electrónico (LRE)', 'RH-M-3.3', 'LRE', { estado: ['estado'], termina: ['fecha_registra_lre'] }, { periodoDe: ['fecha_registra_lre'], montos: ['monto_imponible', 'monto_no_imponible', 'aporte_patronal'] }),
  rh('MORAS_PRESUNTAS', SR.MEN, 'Subsanar moras presuntas', 'RH-M-6.2', 'Subsanar moras presuntas', { estado: ['comentario_estado'], termina: ['fecha_envio_comprobante_estudio_juridico', 'fecha_guardado_documento'], proceso: ['fecha_actualizacion'] }, { tiempos: ['recepcion_requerimiento', 'fecha_actualizacion'] }),
  rh('FINIQUITO_ELECTRONICO', SR.MEN, 'Finiquito electrónico (DT)', 'RH-M', 'Finiquito electronico', { estado: ['estado_finiquito'], termina: ['fecha_pago_trabajador', 'fecha_pago'], proceso: ['fecha_envio_cliente_comprobante'] }, { tiempos: ['fecha_solicitud', 'fecha_pago_trabajador'], montos: ['monto', 'intereses'] }),
  rh('PLATAFORMAS', SR.PLA, 'Plataformas externas', 'RH-M', 'Plataformas externas', { termina: ['fecha_subida'] }, { periodoDe: ['fecha_subida', 'mes_documentacion', 'mes_registro'], cantidad: 'cantidad_trabajadores_le_subio_doc_periodo_cobro' }),
  rh('RECLAMOS', SR.PLA, 'Reclamos, demandas y fiscalizaciones', 'RH-M-2.9', 'Reclamos,demandas y fiscalizaci', { estado: ['estado'], algo: true }, { montos: ['monto_multa'] }),
  rh('SENCE', SR.PLA, 'SENCE', 'RH-M-4.2', 'sence', { termina: ['fecha_liquidacion'], algo: true }),
  rh('TERMINO_SERVICIOS', SR.PLA, 'Término de servicios HomePymes', 'RH-M-5.1', 'Termino de servicios homepymes', { termina: ['fecha_envio_claves_cliente'], algo: true }),
  rh('REHACER_LIQUIDACIONES', SR.PLA, 'Rehacer liquidaciones de períodos anteriores', 'RH-M-6', 'Rehacer liquidaciones de period', { termina: ['envio_mail_cliente_observaciones_proceso_errores'], algo: true }, { tiempos: ['recepcion_requerimiento', 'envio_mail_cliente_observaciones_proceso_errores'] }),
  rh('DDJJ_SUELDOS', SR.PLA, 'DDJJ sueldos', 'RH-M-4.1', 'DDJJ sueldos', { estado: ['estado'], algo: true }, { periodoDe: ['ano_declarar', 'desde'] }),
  rh('IMG', SR.PLA, 'Postulación ingreso mínimo garantizado (IMG)', 'RH-M-3.7', 'IMG', { estado: ['estado'], termina: ['fecha_envio_mail_cliente'] }),
  rh('DEVOLUCIONES', SR.SUB, 'Subsanaciones y devoluciones', 'RH-M', 'Devoluciones', { estado: ['estado_tramite'], termina: ['fecha_pago_su_cuenta_personal_empresa'], algo: true }, { tiempos: ['recepcion_requerimiento', 'fecha_tramite'], montos: ['monto_aproximado_devolucion'] }),
  rh('DOC_DEVOLUCIONES', SR.SUB, 'Documentación de devoluciones', 'RH-M', 'documentacion de Devoluciones a', { estado: ['estado', 'estado_documentacion'], algo: true }),
  rh('PAGO_IMPOSICIONES', SR.SUB, 'Pago de imposiciones vencidas', 'RH-M-6.3', 'Pago de imposiciones vencidas', { termina: ['comprobante_pago', 'planillas_pagadas'], algo: true }),
  rh('DNP_DEMANDA', SR.SUB, 'Demandas por DNP', 'RH-M', 'DNP-DEMANDA', { estado: ['estado_poder_judicial'], algo: true }),
  rh('CLAVE_AFC', SR.SUB, 'Clave AFC', 'RH-M', 'CLAVE AFC', { termina: ['clave_guardada_intranet'], algo: true }),
  rh('PERMISOS', SR.SUB, 'Permisos laborales', 'RH-M', 'Permisos laborales', { termina: ['envio_doc_cliente'], algo: true }, { tiempos: ['recepcion_requerimiento_documentos_generar', 'envio_doc_cliente'] }),
  rh('IMPOSICIONES_IMPAGAS', SR.SUB, 'Imposiciones impagas', 'RH-M', 'Imposiciones impagas', { estado: ['estado'], algo: true }, { montos: ['monto_inicial', 'valor_imposiciones_multas_e_intereses'] }),
  rh('INFORMATIVOS', SR.SUB, 'Informativos', 'RH-M', 'Informativos', null, { sinCliente: true, estados: [E.REGISTRADO], situacion: () => 'REGISTRADO', sinLiberacion: true }),
  rh('F43', SR.SUB, 'Formularios F43', 'RH-M', 'formularios F43', { estado: ['estado_f43', 'estado_cotizacion'], termina: ['fecha_resolucion_f43'], algo: true, ignorar: ['estado'] }, { periodoDe: ['fecha_llamada', 'fecha_envio_correo_informacion'] }),
  rh('EMPRESAS_SIN_MOVIMIENTO', SR.SUB, 'Empresas sin movimiento', 'RH-M', 'Empresas sin movimiento', { estado: ['estado_empresa'], termina: ['fecha_subsanacion_respuesta_correo'], algo: true, ignorar: ['estado'] }),
  rh('CONTROL_HPD', SR.SUB, 'Control de HomePymes Digital', 'RH-M', 'Control de Homepymes digital', { termina: ['fecha_revision'], algo: true })
];

// Las listas son una foto por cliente: no tienen proceso que liberar.
const MATRICES = DEFS.map((d) => {
  const m = Object.assign({}, d);
  if (m.tipo === 'lista') {
    if (!m.estados) m.estados = [E.REGISTRADO];
    if (!m.situacion) m.situacion = () => 'REGISTRADO';
    m.sinLiberacion = true;
  }
  if (!m.estados) m.estados = BASE;
  m.columnas = COLUMNAS[m.clave] || [];
  if (!m.columnas.length) throw new Error('Control interno: la matriz ' + m.clave + ' no tiene columnas.');
  // Cada columna nombrada en las reglas tiene que existir (si no, el error es silencioso).
  const claves = new Set(m.columnas.map((c) => c.clave));
  [].concat(m.situacion.usa || [], m.tiempos || [], m.montos || [], Array.isArray(m.copiar) ? m.copiar : [], m.periodoDe || [], m.sensibles || [], m.cantidad ? [m.cantidad] : [])
    .forEach((k) => { if (!claves.has(k)) throw new Error('Control interno: ' + m.clave + ' no tiene la columna ' + k + '.'); });
  m.fechaPrincipal = m.periodoDe ? m.periodoDe[0] : ((m.columnas.find((c) => c.tipo === 'fecha' && !c.antigua) || {}).clave || '');
  return m;
});

function matriz_(clave) {
  return MATRICES.find((m) => m.clave === clave) || null;
}

module.exports = { DEPARTAMENTOS, MATRICES, matriz_, hecho_, porTexto_, ESTADOS: E };
