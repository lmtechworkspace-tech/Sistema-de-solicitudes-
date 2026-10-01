// Especificación de cada matriz: de qué libro/hojas sale y cómo se reconoce.
// libro: índice en cache/ (0 RR.HH., 1 Acuse, 2 Anotaciones, 3 Contabilización, 4 IVA, 5 Convenios, 6 Facturación)
module.exports = [
  // ============================== CONTABILIDAD ==============================
  { clave: 'FACTURACION', depto: 'CONTABILIDAD', seccion: 'Facturación', nombre: 'Facturación mensual', codigo: 'CO-M-3', libro: 6, hojas: 'MES', lectura: { alias: { 'FOLIO FACTURA': 'FOLIO DOCUMENTO' } }, semillas: ['EMPRESA', 'RUT', 'FOLIO DOCUMENTO', 'FOLIO FACTURA', 'MONTO NETO', 'QUIEN REALIZA', 'COD', 'CODIGO'] },
  { clave: 'IVA', depto: 'CONTABILIDAD', seccion: 'Informe y pago de IVA', nombre: 'Informe y pago de IVA', libro: 4, hojas: 'MES', lectura: { alias: { 'PRE IVA': 'MONTO PRE IVA', 'CLASIFICACION INTERNA': 'CLASIFICACION', 'CARTA PODER': 'CARTA PODER ENVIADA' } }, semillas: ['EMPRESA', 'RUT', 'MONTO A PAGO', 'TASA PPM', 'QUIEN REALIZA', 'FECHA DECLARACION'] },
  { clave: 'IVA_CARTAS_PODER', depto: 'CONTABILIDAD', seccion: 'Informe y pago de IVA', nombre: 'Cartas poder (IVA)', libro: 4, hojas: ['CARTA PODER'], lista: true, sinEncabezado: { 1: 'EMPRESA', 2: 'CARTA PODER', 3: 'ESTADO' } },
  { clave: 'SITUACION_CLIENTES', depto: 'CONTABILIDAD', seccion: 'Informe y pago de IVA', nombre: 'Situación de clientes', libro: 4, hojas: ['Hoja 10'], lista: true, semillas: ['EMPRESA', 'RUT', 'CARTAS DE PODER ENVIADAS'] },
  { clave: 'CONTABILIZACION', depto: 'CONTABILIDAD', seccion: 'Contabilización mensual', nombre: 'Contabilización mensual', libro: 3, hojas: 'MES', dosNiveles: true, lectura: { siempreGrupo: true, gruposValidos: ['CENTRALIZACIONES', 'CONTABILIZACIONES', 'PAGOS'], sinGrupo: ['CODIGO', 'EMPRESA', 'RUT', 'CLASIFICACION INTERNA', 'RRHH', 'ESTADO FINAL', 'OBS', 'ASIENTO DE APERTURA', 'FECHA DE REVISION O APERTURA', 'MESES'], alias: { 'PAGOS / QUIEN REALIZA > REMUNERACIONES': 'PAGOS / QUIEN REALIZA > SUELDOS', 'PAGOS / FECHA REALIZACION > REMUNERACIONES': 'PAGOS / FECHA REALIZACION > SUELDOS', 'PAGOS / REMUNERACIONES': 'PAGOS / SUELDOS', 'PAGOS / CONVENIOS': 'PAGOS / CONVENIO' } }, periodoPorFila: 'MESES', semillas: ['EMPRESA', 'RUT', 'COMPRAS', 'VENTAS', 'ESTADO FINAL', 'QUIEN REALIZA'], extras: ['SOLO RENTA 2026', 'INSUMINE'] },
  { clave: 'ARRIENDOS', depto: 'CONTABILIDAD', seccion: 'Contabilización mensual', nombre: 'Arriendos', libro: 3, hojas: ['ARRIENDOS'], lista: true, semillas: ['EMPRESA', 'RUT', 'ARRIENDO SI NO'] },
  { clave: 'CONVENIOS', depto: 'CONTABILIDAD', seccion: 'Convenios y postergaciones', nombre: 'Convenios', libro: 5, hojas: 'MES', lectura: { alias: { 'PIE DE COVENIO 16': 'PIE DE COVENIO 6' } }, semillas: ['EMPRESA', 'RUT', 'QUIEN REALIZA', 'CONVENIOS', 'CANTIDAD DE CONVENIOS'] },
  { clave: 'POSTERGACIONES', depto: 'CONTABILIDAD', seccion: 'Convenios y postergaciones', nombre: 'Postergaciones', libro: 5, hojas: ['POSTERGACIONES'], lista: true, semillas: ['EMPRESA', 'RUT', 'POSTERGACION'] },
  { clave: 'ACUSE', depto: 'CONTABILIDAD', seccion: 'Acuse de recibo', nombre: 'Acuse de recibo', libro: 1, hojas: 'MES', lectura: { alias: { 'ACUSE DE RECIBO': 'EMPRESA', 'FECHA REALIZACION 1 REVISION': 'FECHA REALIZACION' } }, semillas: ['EMPRESA', 'ACUSE DE RECIBO', 'RUT', 'HORA DE ACUSE', 'ESTADO ACUSE', 'QUIEN REALIZA'] },
  { clave: 'CARTAS_PODER', depto: 'CONTABILIDAD', seccion: 'Anotaciones, notificaciones y subsanaciones', nombre: 'Cartas poder', libro: 2, hojas: ['CARTA PODER'], lista: true, semillas: ['LISTADO EMPRESAS', 'FECHA CARTA PODER', 'ENTREGA'] },
  { clave: 'IVAS_PENDIENTES', depto: 'CONTABILIDAD', seccion: 'Anotaciones, notificaciones y subsanaciones', nombre: 'IVAs pendientes', libro: 2, hojas: ['IVAS PENDIENTES'], lista: true, semillas: ['EMPRESAS', 'IVAS PENDIENTES 2025'] },
  { clave: 'RECTIFICACIONES', depto: 'CONTABILIDAD', seccion: 'Anotaciones, notificaciones y subsanaciones', nombre: 'Rectificaciones', libro: 2, hojas: ['RECTIFICACIONES'], lista: true, semillas: ['EMPRESA', 'IVAS', 'MOTIVO'] },
  { clave: 'NOTIFICACIONES_SII', depto: 'CONTABILIDAD', seccion: 'Anotaciones, notificaciones y subsanaciones', nombre: 'Notificaciones y anotaciones SII', libro: 2, especial: 'fichas' },
  { clave: 'SUBSANACION_DOMICILIO', depto: 'CONTABILIDAD', seccion: 'Anotaciones, notificaciones y subsanaciones', nombre: 'Subsanación de domicilio', libro: 2, especial: 'subsanacion' },
  { clave: 'IVAS_POSTERGADOS', depto: 'CONTABILIDAD', seccion: 'Anotaciones, notificaciones y subsanaciones', nombre: 'IVAs postergados sin convenio', libro: 2, hojas: ['Hoja 21'], lista: true, sinEncabezado: { 1: 'EMPRESA', 3: 'DETALLE' } }
];

// ================================ RR.HH. ===================================
// En el orden de las hojas del libro "control de matrices", en bloques seguidos.
const R = (hoja, clave, nombre, codigo, seccion, extra) => Object.assign({ clave, depto: 'RRHH', seccion, nombre, codigo, libro: 0, hojas: [hoja], semillas: ['EMPRESA', 'NOMBRE EMPRESA', 'QUIEN REALIZA', 'RUT'] }, extra || {});
const S1 = 'Ingreso y término de clientes', S2 = 'Contratos, anexos y finiquitos', S3 = 'Licencias, certificados y constancias', S4 = 'Proceso mensual', S5 = 'Plataformas, reclamos y procesos anuales', S6 = 'Subsanaciones y otros trámites';
module.exports.push(
  R('Ingreso de cliente con creacion', 'INGRESO_CLIENTE_CREACION', 'Ingreso de cliente con creación de empresa', 'RH-M-1.1', S1),
  R('Ingreso cliente con cambio de a', 'INGRESO_CLIENTE_CAMBIO', 'Ingreso de cliente con cambio de administración', 'RH-M-1.2', S1),
  R('Capacitacion HPD O RLD', 'CAPACITACION', 'Capacitación HPD o RLD', 'RH-M-1.3', S1),
  R('Ingreso a obra', 'INGRESO_OBRA', 'Ingreso a obra', 'RH-M-1.4', S1),
  R(' termino de obra', 'TERMINO_OBRA', 'Término de obra', 'RH-M-1', S1),
  R('Anexos', 'ANEXOS', 'Anexos', 'RH-M-2.2', S2),
  R('Contratos', 'CONTRATOS', 'Contratos', 'RH-M-2.1', S2),
  R('RLEContratos', 'RLE_CONTRATOS', 'RLE contratos', 'RH-M-3', S2),
  R('RLEAnexos', 'RLE_ANEXOS', 'RLE anexos', 'RH-M-3.5', S2),
  R('Finiquitos', 'FINIQUITOS', 'Finiquitos', 'RH-M-2.7', S2),
  R('RLEFiniquitos', 'RLE_FINIQUITOS', 'RLE finiquitos', 'RH-M-3.6', S2),
  R('Licencias', 'LICENCIAS', 'Licencias médicas', 'RH-M-2.3', S3),
  R('CertificadosF301', 'CERTIFICADOS_F301', 'Certificados F30-1', 'RH-M-2.5', S3),
  R('CertificadosF30', 'CERTIFICADOS_F30', 'Certificados F30', 'RH-M-2.4', S3),
  R('ConstanciasLaborales', 'CONSTANCIAS', 'Constancias laborales', 'RH-M-2.6', S3),
  R('CartasDeAviso', 'CARTAS_AVISO', 'Cartas de aviso', 'RH-M-2.8', S3),
  R('3%-IUSC', 'IUSC', '3 % e impuesto único de segunda categoría', 'RH-M-3.1', S4),
  R('Remuneraciones', 'REMUNERACIONES', 'Remuneraciones', 'RH-M-3.2', S4),
  R('LRE', 'LRE', 'Libro de remuneraciones electrónico (LRE)', 'RH-M-3.3', S4),
  R('Subsanar moras presuntas', 'MORAS_PRESUNTAS', 'Subsanar moras presuntas', 'RH-M-6.2', S4),
  R('Finiquito electronico', 'FINIQUITO_ELECTRONICO', 'Finiquito electrónico (DT)', 'RH-M', S4),
  R('Plataformas externas', 'PLATAFORMAS', 'Plataformas externas', 'RH-M', S5),
  R('Reclamos,demandas y fiscalizaci', 'RECLAMOS', 'Reclamos, demandas y fiscalizaciones', 'RH-M-2.9', S5),
  R('sence', 'SENCE', 'SENCE', 'RH-M-4.2', S5),
  R('Termino de servicios homepymes', 'TERMINO_SERVICIOS', 'Término de servicios HomePymes', 'RH-M-5.1', S5),
  R('Rehacer liquidaciones de period', 'REHACER_LIQUIDACIONES', 'Rehacer liquidaciones de períodos anteriores', 'RH-M-6', S5),
  R('DDJJ sueldos', 'DDJJ_SUELDOS', 'DDJJ sueldos', 'RH-M-4.1', S5),
  R('IMG', 'IMG', 'Postulación ingreso mínimo garantizado (IMG)', 'RH-M-3.7', S5),
  R('Devoluciones', 'DEVOLUCIONES', 'Subsanaciones y devoluciones', 'RH-M', S6),
  R('documentacion de Devoluciones a', 'DOC_DEVOLUCIONES', 'Documentación de devoluciones', 'RH-M', S6),
  R('Pago de imposiciones vencidas', 'PAGO_IMPOSICIONES', 'Pago de imposiciones vencidas', 'RH-M-6.3', S6),
  R('DNP-DEMANDA', 'DNP_DEMANDA', 'Demandas por DNP', 'RH-M', S6),
  R('CLAVE AFC', 'CLAVE_AFC', 'Clave AFC', 'RH-M', S6),
  R('Permisos laborales', 'PERMISOS', 'Permisos laborales', 'RH-M', S6),
  R('Imposiciones impagas', 'IMPOSICIONES_IMPAGAS', 'Imposiciones impagas', 'RH-M', S6),
  R('Informativos', 'INFORMATIVOS', 'Informativos', 'RH-M', S6, { sinCliente: true, semillas: ['INFORMATIVOS', 'NOMBRE QUIEN REALIZA', 'FECHA DE REALIZACION'] }),
  R('formularios F43', 'F43', 'Formularios F43', 'RH-M', S6),
  R('Empresas sin movimiento', 'EMPRESAS_SIN_MOVIMIENTO', 'Empresas sin movimiento', 'RH-M', S6),
  R('Control de Homepymes digital', 'CONTROL_HPD', 'Control de HomePymes Digital', 'RH-M', S6)
);
