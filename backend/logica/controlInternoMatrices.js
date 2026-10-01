'use strict';

/**
 * controlInternoMatrices.js — las matrices de Contabilidad y RR.HH. que hoy
 * viven en planillas del Drive, declaradas como CONFIGURACIÓN de un solo
 * motor (controlInterno.js). Agregar o cambiar una matriz es editar este
 * archivo, no escribir una pantalla nueva.
 *
 * Origen: análisis de las planillas reales (2026-09-30 / 10-01): Facturación
 * mensual, Informe y pago de IVA, Contabilización mensual, Convenios y
 * postergaciones, Acuse de recibo y Situación de anotaciones/notificaciones
 * (Contabilidad); "Control de matrices" de 43 hojas (RR.HH.).
 *
 * Lo que la planilla resolvía a mano y aquí lo resuelve la estructura:
 *  - "una hoja por mes"      -> cada registro lleva su período (2026-M09);
 *  - columnas repetidas      -> campo `items` (Convenios 1..9 = una lista);
 *  - 25 subtareas con quién  -> campo `checklist` (Contabilización);
 *  - hojas RLE aparte        -> "Carga en la DT" dentro de Contratos/Anexos/
 *                               Finiquitos;
 *  - F30 y F30-1 aparte      -> una matriz de Certificados con el tipo;
 *  - estados escritos a mano -> listas cerradas.
 *
 * Tipos de campo: texto, texto_largo, numero, monto, fecha, hora, lista,
 * si_no, persona (correo), rut, enlace, items (filas repetibles con
 * `subcampos`) y checklist (`grupos` de ítems con estado OK / Pendiente /
 * No aplica, y quién/cuándo por grupo).
 *
 * `tabla: true` = la columna se ve (y se edita) en la grilla del mes; el
 * resto se edita en el panel del registro.
 */

const DEPARTAMENTOS = [
  { clave: 'CONTABILIDAD', nombre: 'Contabilidad', area: 'CONTABILIDAD' },
  { clave: 'RRHH', nombre: 'Recursos Humanos', area: 'RRHH' }
];

const SI_NO = ['Sí', 'No'];
const SI_NO_NA = ['Sí', 'No', 'No aplica'];
const PLATAFORMAS_RRHH = ['Intranet', 'Gestión digital', 'HomePymes', 'Plataforma externa', 'FacilRemu'];
const CAUSALES = [
  '159-1 Mutuo acuerdo', '159-2 Renuncia del trabajador', '159-3 Muerte del trabajador',
  '159-4 Vencimiento del plazo', '159-5 Conclusión del trabajo o servicio', '159-6 Caso fortuito o fuerza mayor',
  '160 Conductas indebidas', '161 Necesidades de la empresa', 'Otra'
];

// Campos repetidos en RR.HH.
const TRABAJADOR = [
  { clave: 'trabajador', etiqueta: 'Trabajador', tipo: 'texto', tabla: true },
  { clave: 'trabajador_rut', etiqueta: 'RUT trabajador', tipo: 'rut' }
];
const RECEPCION = { clave: 'fecha_recepcion', etiqueta: 'Recepción del requerimiento', tipo: 'fecha', tabla: true };
const ENVIO_CLIENTE = { clave: 'fecha_envio', etiqueta: 'Envío al cliente', tipo: 'fecha', tabla: true };
const CARGA_DT = [
  { clave: 'carga_dt', etiqueta: 'Cargado en la DT (RLE)', tipo: 'lista', opciones: SI_NO_NA },
  { clave: 'fecha_carga_dt', etiqueta: 'Fecha de carga en la DT', tipo: 'fecha' }
];
const DIGITALIZACION = [
  { clave: 'digitalizado', etiqueta: 'Digitalizado (Intranet / HPD)', tipo: 'lista', opciones: SI_NO_NA, tabla: true }
];

// Estados de un trámite con plazo (la mayoría de RR.HH. y la facturación).
const ESTADOS_TRAMITE = [
  { clave: 'PENDIENTE', etiqueta: 'Pendiente', tono: 'alerta' },
  { clave: 'EN_PROCESO', etiqueta: 'En proceso', tono: 'info' },
  { clave: 'ENVIADO', etiqueta: 'Enviado al cliente', tono: 'ok', final: true },
  { clave: 'ANULADO', etiqueta: 'Anulado', tono: 'neutro', final: true }
];

const MATRICES = [
  // ================================ CONTABILIDAD ================================
  {
    clave: 'FACTURACION', depto: 'CONTABILIDAD', nombre: 'Facturación', servicio: 'SRV-CON-01',
    descripcion: 'Documentos emitidos por cliente: un registro por documento (factura, nota de crédito, guía).',
    periodica: true, unaPorCliente: false, fechaPrincipal: 'fecha_realizacion',
    tiempos: ['fecha_recepcion', 'fecha_envio'],
    estados: [
      { clave: 'PENDIENTE', etiqueta: 'Pendiente', tono: 'alerta' },
      { clave: 'EMITIDA', etiqueta: 'Emitida', tono: 'info' },
      { clave: 'ENVIADA', etiqueta: 'Enviada', tono: 'ok', final: true },
      { clave: 'ANULADA', etiqueta: 'Anulada', tono: 'neutro', final: true }
    ],
    campos: [
      { clave: 'fecha_recepcion', etiqueta: 'Recepción de la información', tipo: 'fecha', tabla: true },
      { clave: 'cotizacion', etiqueta: 'Cotización / referencia', tipo: 'texto', tabla: true,
        ayuda: 'N° de cotización u orden que origina el cobro: la auditoría pidió poder rastrearla.' },
      { clave: 'tipo_documento', etiqueta: 'Tipo de documento', tipo: 'lista', opciones: ['Factura electrónica', 'Nota de crédito', 'Nota de débito', 'Guía de despacho', 'Boleta'], tabla: true },
      { clave: 'folio', etiqueta: 'Folio', tipo: 'texto', tabla: true },
      { clave: 'fecha_realizacion', etiqueta: 'Fecha de emisión', tipo: 'fecha', tabla: true },
      { clave: 'monto_neto', etiqueta: 'Monto neto', tipo: 'monto' },
      { clave: 'monto_total', etiqueta: 'Monto total', tipo: 'monto', tabla: true },
      { clave: 'empresa_mandante', etiqueta: 'Empresa mandante', tipo: 'texto' },
      { clave: 'rut_mandante', etiqueta: 'RUT mandante', tipo: 'rut' },
      { clave: 'obra', etiqueta: 'Obra', tipo: 'texto' },
      { clave: 'eepp', etiqueta: 'EEPP', tipo: 'texto' },
      { clave: 'contrato', etiqueta: 'N° de contrato', tipo: 'texto' },
      { clave: 'fecha_envio', etiqueta: 'Fecha de envío', tipo: 'fecha', tabla: true },
      { clave: 'cesion', etiqueta: 'Cesión de factura', tipo: 'lista', opciones: SI_NO_NA },
      { clave: 'factoring', etiqueta: 'Factoring', tipo: 'texto' },
      { clave: 'correo_factoring', etiqueta: 'Correo factoring', tipo: 'texto' },
      { clave: 'xml', etiqueta: 'XML', tipo: 'texto' },
      { clave: 'correo_destinatario', etiqueta: 'Correo destinatario', tipo: 'texto' }
    ]
  },
  {
    clave: 'IVA', depto: 'CONTABILIDAD', nombre: 'Informe y pago de IVA', servicio: 'SRV-CON-05',
    descripcion: 'Ciclo mensual por cliente: pre-IVA, carta, recordatorios, postergación, pago y envío del F29.',
    periodica: true, unaPorCliente: true, fechaPrincipal: 'fecha_declaracion', copiar: ['clasificacion', 'contacto', 'rrhh'],
    estados: [
      { clave: 'PENDIENTE', etiqueta: 'Pendiente', tono: 'alerta' },
      { clave: 'PRE_IVA', etiqueta: 'Pre-IVA enviado', tono: 'info' },
      { clave: 'DECLARADO', etiqueta: 'Declarado', tono: 'info' },
      { clave: 'POSTERGADO', etiqueta: 'Postergado', tono: 'alerta' },
      { clave: 'PAGADO', etiqueta: 'Pagado', tono: 'ok' },
      { clave: 'CERRADO', etiqueta: 'F29 enviado', tono: 'ok', final: true }
    ],
    campos: [
      { clave: 'clasificacion', etiqueta: 'Clasificación', tipo: 'lista', opciones: ['HP', 'HC', 'RLD', 'GDE'] },
      { clave: 'contacto', etiqueta: 'Contacto', tipo: 'lista', opciones: ['WhatsApp', 'Correo', 'Paga el cliente', 'Se pide al cliente'] },
      { clave: 'rrhh', etiqueta: 'Tiene RR.HH.', tipo: 'lista', opciones: ['Sí', 'No', 'Sí, externo'] },
      { clave: 'monto_pre_iva', etiqueta: 'Monto pre-IVA', tipo: 'monto', tabla: true },
      { clave: 'fecha_pre_iva', etiqueta: 'Fecha pre-IVA', tipo: 'fecha' },
      { clave: 'monto_pago', etiqueta: 'Monto a pagar', tipo: 'monto', tabla: true },
      { clave: 'tasa_ppm', etiqueta: 'Tasa PPM', tipo: 'numero' },
      { clave: 'monto_ppm', etiqueta: 'Monto PPM', tipo: 'monto' },
      { clave: 'retencion_honorarios', etiqueta: 'Retención honorarios', tipo: 'monto' },
      { clave: 'impuesto_unico', etiqueta: 'Impuesto único', tipo: 'monto' },
      { clave: 'fecha_carta', etiqueta: 'Envío de la carta', tipo: 'fecha', tabla: true },
      { clave: 'fecha_declaracion', etiqueta: 'Fecha de declaración', tipo: 'fecha', tabla: true },
      { clave: 'recordatorio_correo', etiqueta: 'Recordatorio por correo', tipo: 'fecha' },
      { clave: 'recordatorio_llamada', etiqueta: 'Recordatorio por llamada', tipo: 'fecha' },
      { clave: 'posterga', etiqueta: 'Posterga', tipo: 'lista', opciones: SI_NO },
      { clave: 'fecha_postergacion', etiqueta: 'Fecha de postergación', tipo: 'fecha' },
      { clave: 'vence_postergacion', etiqueta: 'Vence la postergación', tipo: 'fecha' },
      { clave: 'quien_paga', etiqueta: 'Quién paga', tipo: 'lista', opciones: ['Cliente', 'HomePymes'] },
      { clave: 'fecha_pago', etiqueta: 'Fecha de pago', tipo: 'fecha', tabla: true },
      { clave: 'f29_enviado', etiqueta: 'F29 enviado', tipo: 'lista', opciones: SI_NO, tabla: true },
      { clave: 'fecha_envio_f29', etiqueta: 'Fecha envío F29', tipo: 'fecha' }
    ]
  },
  {
    clave: 'CONTABILIZACION', depto: 'CONTABILIDAD', nombre: 'Contabilización mensual', servicio: 'SRV-CON-09',
    descripcion: 'Por cliente y mes: centralizaciones, contabilizaciones y pagos, con quién y cuándo en cada bloque.',
    periodica: true, unaPorCliente: true, fechaPrincipal: '', copiar: ['carta_poder'],
    estados: [
      { clave: 'PENDIENTE', etiqueta: 'Pendiente', tono: 'alerta' },
      { clave: 'EN_PROCESO', etiqueta: 'En proceso', tono: 'info' },
      { clave: 'FINALIZADO', etiqueta: 'Finalizado', tono: 'ok', final: true }
    ],
    campos: [
      { clave: 'carta_poder', etiqueta: 'Carta poder', tipo: 'lista', opciones: ['Sí', 'No', 'Sí, externo'] },
      { clave: 'fecha_apertura', etiqueta: 'Revisión o apertura', tipo: 'fecha' },
      { clave: 'asiento_apertura', etiqueta: 'Asiento de apertura', tipo: 'lista', opciones: ['OK', 'Pendiente', 'No aplica'] },
      {
        clave: 'tareas', etiqueta: 'Tareas del mes', tipo: 'checklist', tabla: true,
        grupos: [
          { clave: 'centralizaciones', nombre: 'Centralizaciones', items: ['Compras', 'Banco', 'Mantención de vehículos', 'Combustible', 'Ventas', 'Honorarios'] },
          { clave: 'contabilizaciones', nombre: 'Contabilizaciones', items: ['Libro de remuneraciones', 'F29', 'PPM', 'Finiquitos'] },
          { clave: 'pagos', nombre: 'Pagos', items: ['Arriendo', 'Sueldos', 'Imposiciones', 'Compras', 'Ventas', 'Honorarios', 'Convenio', 'Pago F29', 'Pago / devolución renta', 'Rectificación renta', 'Beneficio Mipymes cuota 1', 'Beneficio Mipymes cuota 2'] }
        ]
      }
    ]
  },
  {
    clave: 'CONVENIOS', depto: 'CONTABILIDAD', nombre: 'Convenios y postergaciones', servicio: 'SRV-CON-07',
    descripcion: 'Convenios de pago con la TGR por cliente: cuotas pagadas, vencidas y término. Se revisa cada mes.',
    periodica: true, unaPorCliente: true, fechaPrincipal: '',
    // Los convenios siguen vivos de un mes a otro: al abrir el mes se copian.
    copiar: ['convenios', 'de_que_deuda'], estadoCalculado: 'convenios',
    estados: [
      { clave: 'SIN_CONVENIO', etiqueta: 'Sin convenio', tono: 'neutro' },
      { clave: 'AL_DIA', etiqueta: 'Al día', tono: 'ok', final: true },
      { clave: 'CON_VENCIDAS', etiqueta: 'Con cuotas vencidas', tono: 'critico' }
    ],
    campos: [
      {
        clave: 'convenios', etiqueta: 'Convenios', tipo: 'items', tabla: true,
        subcampos: [
          { clave: 'tipo', etiqueta: 'Tipo', tipo: 'lista', opciones: ['IVA', 'Renta', 'IVA y Renta', 'Otro'] },
          { clave: 'folio', etiqueta: 'Folio', tipo: 'texto' },
          { clave: 'fecha', etiqueta: 'Fecha del convenio', tipo: 'fecha' },
          { clave: 'pie', etiqueta: 'Pie', tipo: 'monto' },
          { clave: 'deuda', etiqueta: 'Monto total deuda', tipo: 'monto' },
          { clave: 'cuotas_pagadas', etiqueta: 'Cuotas pagadas', tipo: 'numero' },
          { clave: 'cuotas_vencidas', etiqueta: 'Cuotas vencidas', tipo: 'numero' },
          { clave: 'termino', etiqueta: 'Término', tipo: 'fecha' }
        ]
      },
      { clave: 'de_que_deuda', etiqueta: 'De qué es la deuda', tipo: 'texto' }
    ]
  },
  {
    clave: 'ACUSE', depto: 'CONTABILIDAD', nombre: 'Acuse de recibo', servicio: '',
    descripcion: 'Acuse de recibo mensual de documentos tributarios por cliente.',
    periodica: true, unaPorCliente: true, fechaPrincipal: 'fecha_realizacion',
    estados: [
      { clave: 'PENDIENTE', etiqueta: 'Pendiente', tono: 'alerta' },
      { clave: 'OK', etiqueta: 'OK', tono: 'ok', final: true },
      { clave: 'NO_APLICA', etiqueta: 'No aplica', tono: 'neutro', final: true }
    ],
    campos: [
      { clave: 'fecha_realizacion', etiqueta: 'Fecha de realización', tipo: 'fecha', tabla: true },
      { clave: 'hora_acuse', etiqueta: 'Hora del acuse', tipo: 'hora', tabla: true },
      { clave: 'monto_iva', etiqueta: 'Monto IVA', tipo: 'monto', tabla: true },
      { clave: 'cantidad_documentos', etiqueta: 'Cantidad de documentos', tipo: 'numero', tabla: true },
      { clave: 'monto_iva_nc', etiqueta: 'Monto IVA notas de crédito', tipo: 'monto' },
      { clave: 'cantidad_nc', etiqueta: 'Cantidad de notas de crédito', tipo: 'numero' }
    ]
  },
  {
    clave: 'ANOTACIONES', depto: 'CONTABILIDAD', nombre: 'Anotaciones y notificaciones', servicio: '',
    descripcion: 'Notificaciones y anotaciones del SII, rectificaciones, subsanaciones de domicilio y cartas poder, por cliente.',
    periodica: false, unaPorCliente: false, fechaPrincipal: 'fecha_notificacion',
    estados: [
      { clave: 'PENDIENTE', etiqueta: 'Pendiente', tono: 'alerta' },
      { clave: 'EN_GESTION', etiqueta: 'En gestión', tono: 'info' },
      { clave: 'RESUELTA', etiqueta: 'Resuelta', tono: 'ok', final: true }
    ],
    campos: [
      { clave: 'tipo', etiqueta: 'Tipo', tipo: 'lista', tabla: true,
        opciones: ['Notificación', 'Anotación', 'Giro', 'Rectificación', 'Subsanación de domicilio', 'Carta poder', 'IVA postergado sin convenio', 'Otro'] },
      { clave: 'fecha_notificacion', etiqueta: 'Fecha', tipo: 'fecha', tabla: true },
      { clave: 'anio_tributario', etiqueta: 'Año / período', tipo: 'texto', tabla: true },
      { clave: 'detalle', etiqueta: 'Detalle', tipo: 'texto_largo', tabla: true },
      { clave: 'gestion', etiqueta: 'Gestión realizada', tipo: 'texto_largo' },
      { clave: 'fecha_gestion', etiqueta: 'Fecha de la gestión', tipo: 'fecha' }
    ]
  },

  // =================================== RR.HH. ===================================
  {
    clave: 'REMUNERACIONES', depto: 'RRHH', nombre: 'Remuneraciones', servicio: 'SRV-RHH-01',
    descripcion: 'Proceso mensual por empresa y obra: liquidaciones, imposiciones e instituciones.',
    periodica: true, unaPorCliente: false, fechaPrincipal: 'fecha_envio_liquidacion', copiar: ['obra'],
    tiempos: ['fecha_recepcion', 'fecha_envio_liquidacion'],
    estados: [
      { clave: 'PENDIENTE', etiqueta: 'Pendiente', tono: 'alerta' },
      { clave: 'EN_REVISION', etiqueta: 'En revisión', tono: 'info' },
      { clave: 'PENDIENTE_ENVIO', etiqueta: 'Pendiente de envío', tono: 'alerta' },
      { clave: 'ENVIADO', etiqueta: 'Enviado', tono: 'ok', final: true }
    ],
    campos: [
      { clave: 'obra', etiqueta: 'Obra', tipo: 'texto', tabla: true },
      { clave: 'fecha_recepcion', etiqueta: 'Recepción de la información', tipo: 'fecha', tabla: true },
      { clave: 'trabajadores', etiqueta: 'Cantidad de trabajadores', tipo: 'numero', tabla: true },
      { clave: 'fecha_derivacion', etiqueta: 'Fecha de derivación', tipo: 'fecha' },
      { clave: 'fecha_envio_liquidacion', etiqueta: 'Envío de liquidaciones', tipo: 'fecha', tabla: true },
      DIGITALIZACION[0],
      { clave: 'prestamo_solidario', etiqueta: '3 % préstamo solidario', tipo: 'monto' },
      { clave: 'iusc', etiqueta: 'IUSC', tipo: 'monto' },
      { clave: 'monto_fonasa', etiqueta: 'Fonasa', tipo: 'monto' },
      { clave: 'monto_seguro_social', etiqueta: '1 % seguro social', tipo: 'monto' },
      { clave: 'monto_isapre', etiqueta: 'Isapre', tipo: 'monto' },
      { clave: 'monto_afp', etiqueta: 'AFP', tipo: 'monto' },
      { clave: 'monto_mutual', etiqueta: 'Mutual / ACHS / ISL', tipo: 'monto' },
      { clave: 'cargas_familiares', etiqueta: 'Cargas familiares', tipo: 'monto' },
      { clave: 'caja', etiqueta: 'Caja de compensación', tipo: 'monto' },
      { clave: 'valor_imposiciones', etiqueta: 'Valor imposiciones', tipo: 'monto', tabla: true },
      { clave: 'fecha_declaracion', etiqueta: 'Fecha de declaración', tipo: 'fecha' },
      { clave: 'fecha_envio_imposiciones', etiqueta: 'Envío de planillas', tipo: 'fecha' },
      { clave: 'intereses', etiqueta: 'Intereses', tipo: 'monto' },
      { clave: 'fecha_pago_imposiciones', etiqueta: 'Pago de imposiciones', tipo: 'fecha' }
    ]
  },
  {
    clave: 'CONTRATOS', depto: 'RRHH', nombre: 'Contratos', servicio: 'SRV-RHH-02',
    descripcion: 'Contratos de trabajo por requerimiento, con su carga en la DT (antes hoja RLE aparte).',
    periodica: false, unaPorCliente: false, fechaPrincipal: 'fecha_recepcion', tiempos: ['fecha_recepcion', 'fecha_envio'],
    estados: ESTADOS_TRAMITE,
    campos: [RECEPCION].concat(TRABAJADOR, [
      { clave: 'tipo_contrato', etiqueta: 'Tipo de contrato', tipo: 'lista', tabla: true,
        opciones: ['Plazo fijo', 'Plazo indefinido', 'Por obra o faena', 'Contrato en blanco sin obra', 'Contrato en blanco con obra'] },
      { clave: 'vencimiento', etiqueta: 'Vencimiento del contrato', tipo: 'fecha' },
      { clave: 'cantidad', etiqueta: 'Cantidad de contratos', tipo: 'numero' },
      { clave: 'plataforma', etiqueta: 'Plataforma', tipo: 'lista', opciones: PLATAFORMAS_RRHH },
      ENVIO_CLIENTE
    ], CARGA_DT)
  },
  {
    clave: 'ANEXOS', depto: 'RRHH', nombre: 'Anexos', servicio: 'SRV-RHH-03',
    descripcion: 'Anexos de contrato: actualización en FacilRemu, envío, firma, digitalización y carga en la DT.',
    periodica: false, unaPorCliente: false, fechaPrincipal: 'fecha_recepcion', tiempos: ['fecha_recepcion', 'fecha_envio'],
    estados: ESTADOS_TRAMITE,
    campos: [RECEPCION].concat(TRABAJADOR, [
      { clave: 'tipo_anexo', etiqueta: 'Tipo de anexo', tipo: 'lista', tabla: true,
        opciones: ['Segundo anexo a plazo fijo', 'Cambio de horario', 'Aumento del sueldo mínimo', 'Cambio de cargo', 'Traslado', 'Pacto de horas extra', 'Otro'] },
      { clave: 'cantidad', etiqueta: 'Cantidad de anexos', tipo: 'numero' },
      { clave: 'plataforma', etiqueta: 'Plataforma', tipo: 'lista', opciones: PLATAFORMAS_RRHH },
      { clave: 'fecha_facilremu', etiqueta: 'Actualización en FacilRemu', tipo: 'fecha' },
      ENVIO_CLIENTE,
      { clave: 'fecha_firmado', etiqueta: 'Llegada del documento firmado', tipo: 'fecha' },
      { clave: 'fecha_digitalizacion', etiqueta: 'Digitalización en HPD', tipo: 'fecha' }
    ], CARGA_DT)
  },
  {
    clave: 'FINIQUITOS', depto: 'RRHH', nombre: 'Finiquitos', servicio: 'SRV-RHH-04',
    descripcion: 'Finiquitos por requerimiento, con la validación del cálculo y la carga en la DT.',
    periodica: false, unaPorCliente: false, fechaPrincipal: 'fecha_recepcion', tiempos: ['fecha_recepcion', 'fecha_envio'],
    estados: ESTADOS_TRAMITE,
    campos: [RECEPCION].concat(TRABAJADOR, [
      { clave: 'causal', etiqueta: 'Causal', tipo: 'lista', opciones: CAUSALES, tabla: true },
      { clave: 'cantidad', etiqueta: 'N° de trabajadores', tipo: 'numero' },
      { clave: 'retroactivo', etiqueta: 'Movimiento de personal retroactivo', tipo: 'lista', opciones: SI_NO },
      { clave: 'calculo_validado_por', etiqueta: 'Cálculo validado por', tipo: 'persona',
        ayuda: 'Quién revisó el cálculo del finiquito antes de enviarlo (observación de la auditoría del 30-09).' },
      { clave: 'fecha_validacion', etiqueta: 'Fecha de validación', tipo: 'fecha' },
      ENVIO_CLIENTE
    ], CARGA_DT)
  },
  {
    clave: 'FINIQUITO_ELECTRONICO', depto: 'RRHH', nombre: 'Finiquito electrónico', servicio: 'SRV-RHH-05',
    descripcion: 'Solicitudes de finiquito electrónico en la DT: aceptación, monto y pago.',
    periodica: false, unaPorCliente: false, fechaPrincipal: 'fecha_solicitud',
    estados: [
      { clave: 'PENDIENTE', etiqueta: 'Pendiente', tono: 'alerta' },
      { clave: 'ENVIADO', etiqueta: 'Comprobante enviado', tono: 'info' },
      { clave: 'ACEPTADO', etiqueta: 'Aceptado', tono: 'info' },
      { clave: 'PAGADO', etiqueta: 'Pagado al trabajador', tono: 'ok', final: true },
      { clave: 'RECHAZADO', etiqueta: 'Rechazado', tono: 'critico', final: true }
    ],
    campos: [
      { clave: 'fecha_solicitud', etiqueta: 'Fecha de solicitud', tipo: 'fecha', tabla: true }
    ].concat(TRABAJADOR, [
      { clave: 'fecha_inicio', etiqueta: 'Inicio de la relación laboral', tipo: 'fecha' },
      { clave: 'fecha_termino', etiqueta: 'Término', tipo: 'fecha' },
      { clave: 'causal', etiqueta: 'Causal', tipo: 'lista', opciones: CAUSALES },
      { clave: 'monto', etiqueta: 'Monto', tipo: 'monto', tabla: true },
      { clave: 'intereses', etiqueta: 'Intereses', tipo: 'monto' },
      { clave: 'fecha_envio', etiqueta: 'Envío del comprobante', tipo: 'fecha' },
      { clave: 'fecha_aceptacion', etiqueta: 'Aceptación del finiquito', tipo: 'fecha', tabla: true },
      { clave: 'fecha_pago', etiqueta: 'Pago al trabajador', tipo: 'fecha', tabla: true }
    ])
  },
  {
    clave: 'LICENCIAS', depto: 'RRHH', nombre: 'Licencias médicas', servicio: 'SRV-RHH-14',
    descripcion: 'Tramitación de licencias. Datos de salud: los ve solo quien tiene acceso a RR.HH.',
    periodica: false, unaPorCliente: false, fechaPrincipal: 'fecha_tramite',
    estados: [
      { clave: 'PENDIENTE', etiqueta: 'Pendiente', tono: 'alerta' },
      { clave: 'TRAMITADA', etiqueta: 'Tramitada', tono: 'ok', final: true },
      { clave: 'FUERA_PLAZO', etiqueta: 'Fuera de plazo', tono: 'critico', final: true }
    ],
    campos: [
      { clave: 'obra', etiqueta: 'Obra', tipo: 'texto' }
    ].concat(TRABAJADOR, [
      { clave: 'fecha_tramite', etiqueta: 'Fecha del trámite', tipo: 'fecha', tabla: true },
      { clave: 'fecha_inicio', etiqueta: 'Inicio', tipo: 'fecha', tabla: true },
      { clave: 'dias', etiqueta: 'Días', tipo: 'numero', tabla: true },
      { clave: 'tipo_licencia', etiqueta: 'Tipo de licencia', tipo: 'lista', opciones: ['Enfermedad común', 'Maternal / parental', 'Accidente o enfermedad laboral', 'Otra'] },
      { clave: 'institucion', etiqueta: 'Institución', tipo: 'lista', opciones: ['Fonasa', 'Isapre', 'Mutual', 'ACHS', 'ISL', 'CCAF'] },
      ENVIO_CLIENTE,
      DIGITALIZACION[0]
    ])
  },
  {
    clave: 'CERTIFICADOS', depto: 'RRHH', nombre: 'Certificados F30 y F30-1', servicio: 'SRV-RHH-06',
    descripcion: 'Certificados de antecedentes laborales (F30) y de cumplimiento (F30-1) por obra y período.',
    periodica: false, unaPorCliente: false, fechaPrincipal: 'fecha_recepcion', tiempos: ['fecha_recepcion', 'fecha_envio'],
    estados: ESTADOS_TRAMITE,
    campos: [
      RECEPCION,
      { clave: 'tipo_certificado', etiqueta: 'Certificado', tipo: 'lista', opciones: ['F30', 'F30-1'], tabla: true },
      { clave: 'obra', etiqueta: 'Obra', tipo: 'texto', tabla: true },
      { clave: 'periodo_certificado', etiqueta: 'Período del certificado', tipo: 'texto' },
      { clave: 'tipo_solicitud', etiqueta: 'Tipo de solicitud', tipo: 'texto' },
      ENVIO_CLIENTE,
      { clave: 'digitalizado_intranet', etiqueta: 'Digitalizado en Intranet', tipo: 'lista', opciones: SI_NO_NA },
      { clave: 'digitalizado_hpd', etiqueta: 'Digitalizado en HPD / GDE', tipo: 'lista', opciones: SI_NO_NA, tabla: true },
      { clave: 'mora', etiqueta: 'Mora o deuda (meses)', tipo: 'texto' }
    ]
  },
  {
    clave: 'CONSTANCIAS', depto: 'RRHH', nombre: 'Constancias laborales', servicio: 'SRV-RHH-09',
    descripcion: 'Constancias laborales solicitadas por el cliente.',
    periodica: false, unaPorCliente: false, fechaPrincipal: 'fecha_recepcion', tiempos: ['fecha_recepcion', 'fecha_envio'],
    estados: ESTADOS_TRAMITE,
    campos: [RECEPCION].concat(TRABAJADOR, [
      { clave: 'tipo_constancia', etiqueta: 'Tipo de constancia', tipo: 'texto', tabla: true },
      { clave: 'comentario_cliente', etiqueta: 'Comentario del cliente', tipo: 'texto_largo' },
      ENVIO_CLIENTE,
      DIGITALIZACION[0]
    ])
  },
  {
    clave: 'CARTAS_AVISO', depto: 'RRHH', nombre: 'Cartas de aviso', servicio: 'SRV-RHH-13',
    descripcion: 'Cartas de aviso de término: realización, comprobante y envío.',
    periodica: false, unaPorCliente: false, fechaPrincipal: 'fecha_recepcion', tiempos: ['fecha_recepcion', 'fecha_envio'],
    estados: ESTADOS_TRAMITE,
    campos: [RECEPCION].concat(TRABAJADOR, [
      { clave: 'tipo_carta', etiqueta: 'Tipo de carta', tipo: 'texto', tabla: true },
      { clave: 'cantidad', etiqueta: 'Cantidad', tipo: 'numero' },
      { clave: 'fecha_realizacion', etiqueta: 'Fecha de realización', tipo: 'fecha' },
      { clave: 'comprobante', etiqueta: 'Tipo de comprobante', tipo: 'lista', opciones: ['Comprobante DT', 'Carta certificada', 'Entrega personal', 'Otro'] },
      ENVIO_CLIENTE,
      DIGITALIZACION[0]
    ])
  },
  {
    clave: 'LRE', depto: 'RRHH', nombre: 'Libro de remuneraciones (LRE)', servicio: 'SRV-RHH-01',
    descripcion: 'Declaración mensual del LRE en la DT por empresa.',
    periodica: true, unaPorCliente: true, fechaPrincipal: 'fecha_registro',
    estados: [
      { clave: 'PENDIENTE', etiqueta: 'Pendiente', tono: 'alerta' },
      { clave: 'DECLARADO', etiqueta: 'Declarado con éxito', tono: 'ok', final: true },
      { clave: 'SIN_MOVIMIENTO', etiqueta: 'Sin movimiento', tono: 'neutro', final: true },
      { clave: 'NO_DECLARADO', etiqueta: 'No declarado', tono: 'critico' }
    ],
    campos: [
      { clave: 'fecha_registro', etiqueta: 'Fecha de registro', tipo: 'fecha', tabla: true },
      { clave: 'trabajadores', etiqueta: 'Trabajadores', tipo: 'numero', tabla: true },
      { clave: 'finiquitos', etiqueta: 'Finiquitos', tipo: 'numero' },
      { clave: 'monto_imponible', etiqueta: 'Monto imponible', tipo: 'monto', tabla: true },
      { clave: 'monto_no_imponible', etiqueta: 'Monto no imponible', tipo: 'monto' },
      { clave: 'aporte_patronal', etiqueta: 'Aporte patronal', tipo: 'monto' },
      { clave: 'digitalizado', etiqueta: 'Comprobante digitalizado', tipo: 'lista', opciones: SI_NO_NA, tabla: true }
    ]
  },
  {
    clave: 'PLATAFORMAS', depto: 'RRHH', nombre: 'Plataformas externas', servicio: 'SRV-RHH-11',
    descripcion: 'Carga de documentación en plataformas de mandantes. Las claves NO se guardan aquí.',
    periodica: true, unaPorCliente: false, fechaPrincipal: 'fecha_subida', copiar: ['plataforma', 'empresa_principal', 'obras'],
    estados: [
      { clave: 'PENDIENTE', etiqueta: 'Pendiente', tono: 'alerta' },
      { clave: 'CARGADO', etiqueta: 'Cargado', tono: 'info' },
      { clave: 'APROBADO', etiqueta: 'Aprobado', tono: 'ok', final: true },
      { clave: 'RECHAZADO', etiqueta: 'Rechazado', tono: 'critico' }
    ],
    campos: [
      { clave: 'plataforma', etiqueta: 'Plataforma', tipo: 'texto', tabla: true },
      { clave: 'empresa_principal', etiqueta: 'Empresa principal', tipo: 'texto', tabla: true },
      { clave: 'obras', etiqueta: 'Obras', tipo: 'texto' },
      { clave: 'fecha_subida', etiqueta: 'Fecha de subida', tipo: 'fecha', tabla: true },
      { clave: 'dias_revision', etiqueta: 'Días de revisión', tipo: 'numero' },
      { clave: 'trabajadores_cobro', etiqueta: 'Trabajadores con documentos subidos (cobro)', tipo: 'numero', tabla: true },
      { clave: 'trabajadores_mes', etiqueta: 'Trabajadores en el mes', tipo: 'numero' },
      { clave: 'finiquitados_mes', etiqueta: 'Finiquitados en el mes', tipo: 'numero' },
      { clave: 'f43', etiqueta: 'Formulario F43', tipo: 'lista', opciones: SI_NO_NA }
    ]
  },
  {
    clave: 'MORAS', depto: 'RRHH', nombre: 'Moras e imposiciones impagas', servicio: 'SRV-RHH-12',
    descripcion: 'Subsanación de moras presuntas y deudas por no pago (DNP).',
    periodica: false, unaPorCliente: false, fechaPrincipal: 'fecha_gestion',
    estados: [
      { clave: 'PENDIENTE', etiqueta: 'Pendiente', tono: 'alerta' },
      { clave: 'EN_GESTION', etiqueta: 'En gestión', tono: 'info' },
      { clave: 'SUBSANADA', etiqueta: 'Subsanada', tono: 'ok', final: true }
    ],
    campos: [
      { clave: 'tipo', etiqueta: 'Tipo', tipo: 'lista', opciones: ['Mora presunta', 'Deuda por no pago (DNP)', 'DNP y mora presunta'], tabla: true },
      { clave: 'institucion', etiqueta: 'Institución', tipo: 'texto', tabla: true },
      { clave: 'periodo_deuda', etiqueta: 'Períodos adeudados', tipo: 'texto', tabla: true },
      { clave: 'fecha_gestion', etiqueta: 'Fecha de la gestión', tipo: 'fecha', tabla: true },
      { clave: 'documento_subido', etiqueta: 'Documento subido a la Intranet', tipo: 'lista', opciones: SI_NO }
    ]
  }
];

function matriz_(clave) {
  return MATRICES.find((m) => m.clave === clave) || null;
}

module.exports = { DEPARTAMENTOS, MATRICES, matriz_ };
