'use strict';

/**
 * controlInternoImportar.js — carga en Control interno los datos de las
 * planillas del Drive (2026-10-01, pedido del dueño: probar el módulo y ver
 * los reportes con datos reales). Acordado: se importa 2026 completo.
 *
 * El NAVEGADOR lee el .xlsx (frontend/js/lector-xlsx.js) y manda hoja por
 * hoja las filas tal cual; aquí se reconoce qué matriz es (por encabezados o
 * por el nombre de la hoja), se convierte cada fila a un registro con las
 * mismas reglas de la carga a mano (limpiarDatos_) y se guarda.
 *
 *  - Solo ADM. Primero `simular` (no escribe nada) y después importar.
 *  - Idempotente: cada fila lleva `datos._origen` (huella de la fila); volver
 *    a importar el mismo archivo no duplica.
 *  - Clientes: por código de cliente (HP-002-1), por RUT o por nombre; si no
 *    calza, queda con el nombre y "Fuera del catálogo".
 *  - Responsable: el nombre de la planilla ("FRANCISCA") contra las cuentas
 *    de SIGSO; si no hay una sola que calce, queda en observaciones.
 *  - Licencias: NO se importa el motivo (dato de salud): no hace falta para
 *    el control y es lo más sensible de la planilla.
 *  - Las fichas de texto libre por cliente (hojas A–W de Anotaciones) no se
 *    importan: no tienen columnas que se puedan leer sin interpretar.
 */

const crypto = require('node:crypto');
const { leerFilas_, agregarFila_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { matriz_ } = require('./controlInternoMatrices');
const CI = require('./controlInterno');

const MAX_FILAS = 8000;
const MESES = { ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 };

function pad_(n) { return String(n).padStart(2, '0'); }
function n_(t) {
  return String(t == null ? '' : t).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ').trim();
}
function vacio_(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return /^(NA|N\/A|#N\/A|-|—|\.)$/i.test(s) ? '' : s;
}
function fecha_(v) {
  const s = vacio_(v);
  if (!s) return '';
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n < 30000 || n > 60000) return '';
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5).toISOString().slice(0, 10);
  }
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[0].slice(0, 10);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + pad_(m[2]) + '-' + pad_(m[1]);
  return '';
}
function hora_(v) {
  const s = vacio_(v);
  if (!s) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (m) return pad_(m[1]) + ':' + m[2];
  const n = Number(s);
  if (!isFinite(n)) return '';
  const min = Math.round((n - Math.floor(n)) * 1440);
  return pad_(Math.floor(min / 60) % 24) + ':' + pad_(min % 60);
}
function numero_(v) {
  const s = vacio_(v).replace(/\$/g, '').replace(/\s/g, '');
  if (!s) return '';
  let x = Number(s);
  if (!isFinite(x)) x = Number(s.replace(/\./g, '').replace(',', '.'));
  return isFinite(x) ? Math.round(x * 100) / 100 : '';
}
// Columnas de "digitalizado" o "enviado": cualquier marca (SI, una fecha, OK) es Sí.
function siNo_(v, conNoAplica) {
  const s = n_(vacio_(v));
  if (!s) return '';
  if (s === 'NO APLICA' || s === 'N A') return conNoAplica ? 'No aplica' : '';
  if (s === 'NO' || /^NO /.test(s)) return 'No';
  return 'Sí';
}
function opcion_(v, opciones, sinonimos, porDefecto) {
  const s = n_(vacio_(v));
  if (!s) return '';
  const sin = sinonimos || {};
  for (const k of Object.keys(sin)) if (s === k || s.indexOf(k) === 0) return sin[k];
  const o = opciones.find((op) => n_(op) === s) || opciones.find((op) => s.indexOf(n_(op)) === 0 || n_(op).indexOf(s) === 0);
  return o || porDefecto || '';
}
function causal_(v) {
  const s = n_(vacio_(v));
  if (!s) return '';
  const c = /^(159 [1-6]|160|161)\b/.exec(s);
  const OPC = matriz_('FINIQUITOS').campos.find((x) => x.clave === 'causal').opciones;
  if (c) return OPC.find((o) => n_(o).indexOf(c[1]) === 0) || 'Otra';
  if (/RENUNCIA/.test(s)) return OPC[1];
  if (/MUTUO|ACUERDO/.test(s)) return OPC[0];
  if (/VENCIMIENTO|PLAZO/.test(s)) return OPC[3];
  if (/CONCLUSION|OBRA|FAENA/.test(s)) return OPC[4];
  if (/NECESIDAD/.test(s)) return OPC[7];
  return 'Otra';
}
function periodoHoja_(nombre) {
  const m = /\b(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE) ?(\d{4}|\d{2})\b/.exec(n_(nombre).replace(/([A-Z])(\d)/g, '$1 $2'));
  if (!m) return '';
  return (m[2].length === 2 ? '20' + m[2] : m[2]) + '-M' + pad_(MESES[m[1]]);
}

// --- encabezados ----------------------------------------------------------------------
function filaEncabezado_(filas, claves) {
  for (let i = 0; i < Math.min(filas.length, 15); i++) {
    const f = (filas[i] || []).map(n_);
    if (claves.every((k) => f.indexOf(k) !== -1)) return i;
  }
  return -1;
}
// Columna por nombre: primero igual, después "empieza con", después regex.
function columna_(enc, patron, desde) {
  const d = desde || 0;
  if (patron instanceof RegExp) { for (let i = d; i < enc.length; i++) if (patron.test(enc[i] || '')) return i; return -1; }
  const p = n_(patron);
  for (let i = d; i < enc.length; i++) if (enc[i] === p) return i;
  for (let i = d; i < enc.length; i++) if ((enc[i] || '').indexOf(p) === 0) return i;
  return -1;
}
function lector_(fila, enc) {
  const val = (patron, desde) => { const i = columna_(enc, patron, desde); return i === -1 ? '' : fila[i]; };
  return {
    col: (p, d) => columna_(enc, p, d),
    crudo: val,
    t: (p, d) => vacio_(val(p, d)),
    f: (p, d) => fecha_(val(p, d)),
    h: (p, d) => hora_(val(p, d)),
    n: (p, d) => numero_(val(p, d)),
    sn: (p, conNA) => siNo_(val(p), conNA),
    op: (p, opciones, sin, def) => opcion_(val(p), opciones, sin, def),
    i: (i) => vacio_(fila[i])
  };
}
function opcionesDe_(matriz, campo) { return (matriz_(matriz).campos.find((c) => c.clave === campo) || {}).opciones || []; }

// =========================================================================================
// Reconocimiento de cada matriz y conversión de una fila
// =========================================================================================
const PLATAFORMA_SIN = { INTRANET: 'Intranet', 'GESTION DIGITAL': 'Gestión digital', HOMEPYMES: 'HomePymes', 'PLATAFORMA EXTERNA': 'Plataforma externa', FACILREMU: 'FacilRemu' };
const enviado_ = (g, p) => (g.t(p) ? 'ENVIADO' : 'PENDIENTE');

const ESPECIFICACIONES = [
  // ------------------------------- Contabilidad -------------------------------
  {
    matriz: 'FACTURACION', claves: ['EMPRESA', 'FOLIO DOCUMENTO'], periodoDeHoja: true,
    fila: (g) => {
      const datos = {
        fecha_recepcion: g.f('RECEPCION INFORMACION'), fecha_realizacion: g.f('FECHA REALIZACION'),
        tipo_documento: g.op('TIPO DOCUMENTO', opcionesDe_('FACTURACION', 'tipo_documento'), { FE: 'Factura electrónica', FACTURA: 'Factura electrónica', NC: 'Nota de crédito', ND: 'Nota de débito', GUIA: 'Guía de despacho', BOLETA: 'Boleta' }),
        folio: g.t('FOLIO DOCUMENTO'), monto_neto: g.n('MONTO NETO'), monto_total: g.n('MONTO TOTAL'),
        empresa_mandante: g.t('EMPRESA MANDANTE'), rut_mandante: g.t('RUT EMPRESA MANDANTE'), obra: g.t('OBRA'), eepp: g.t('EEPP'),
        contrato: g.t('N CONTRATO'), fecha_envio: g.f('FECHA ENVIO'), cesion: g.sn('CESION DE FACTURA', true),
        factoring: g.t('FACTORING'), correo_factoring: g.t('CORREO FACTORING'), xml: g.t('XML'), correo_destinatario: g.t('CORREO DESTINATARIO')
      };
      const enviada = g.sn('ENVIADA') === 'Sí' || !!datos.fecha_envio;
      return { cliente: g.t('EMPRESA'), rut: g.t('RUT'), responsable: g.t('QUIEN REALIZA'), datos, estado: enviada ? 'ENVIADA' : (datos.folio ? 'EMITIDA' : 'PENDIENTE') };
    }
  },
  {
    matriz: 'IVA', claves: ['EMPRESA', 'MONTO PRE IVA'], periodoDeHoja: true,
    fila: (g) => {
      const datos = {
        clasificacion: g.op('CLASIFICACION', ['HP', 'HC', 'RLD', 'GDE']),
        contacto: g.op('ESTATUS', opcionesDe_('IVA', 'contacto'), { WHATSAPP: 'WhatsApp', 'ENVIAR A WSP': 'WhatsApp', WSP: 'WhatsApp', 'PAGA EL': 'Paga el cliente', 'SE PIDE': 'Se pide al cliente', CORREO: 'Correo' }),
        rrhh: g.op('RRHH', opcionesDe_('IVA', 'rrhh'), { 'SI EXTERNO': 'Sí, externo', SI: 'Sí', NO: 'No' }),
        monto_pre_iva: g.n('MONTO PRE IVA'), fecha_pre_iva: g.f('FECHA PRE IVA'), monto_pago: g.n('MONTO A PAGO'),
        tasa_ppm: g.n('TASA PPM'), monto_ppm: g.n('MONTO PPM'), retencion_honorarios: g.n('RETENCION HONORARIO'), impuesto_unico: g.n('MONTO IMPUESTO UNICO'),
        fecha_carta: g.f('FECHA ENVIO CARTA'), fecha_declaracion: g.f('FECHA DECLARACION'),
        recordatorio_correo: g.f('ENVIO CORREO RECORDATORIO'), recordatorio_llamada: g.f('RECORDATORIO LLAMADA'),
        posterga: g.op('POSTERGA', ['Sí', 'No'], { SI: 'Sí', NO: 'No' }), fecha_postergacion: g.f('FECHA REALIZACION POSTERGACION'),
        vence_postergacion: g.f('FECHA VENCIMIENTO DE LA POSTERGACION'), quien_paga: g.op('QUIEN PAGA', ['Cliente', 'HomePymes'], { CLIENTE: 'Cliente', HOMEPYMES: 'HomePymes', HP: 'HomePymes' }),
        fecha_pago: g.f('FECHA PAGO'), fecha_envio_f29: g.f('FECHA ENVIO F 29'), f29_enviado: g.sn('ENVIADO EL F29')
      };
      const pago = n_(g.t('ESTADO PAGO'));
      let estado = 'PENDIENTE';
      if (datos.f29_enviado === 'Sí' || datos.fecha_envio_f29) estado = 'CERRADO';
      else if (datos.fecha_pago || /PAGAD/.test(pago)) estado = 'PAGADO';
      else if (datos.posterga === 'Sí') estado = 'POSTERGADO';
      else if (datos.fecha_declaracion) estado = 'DECLARADO';
      else if (datos.fecha_pre_iva || datos.monto_pre_iva !== '') estado = 'PRE_IVA';
      return { cliente: g.t('EMPRESA'), rut: g.t('RUT'), responsable: g.t('QUIEN REALIZA') || g.t('REALIZADO POR'), datos, estado, observaciones: g.t('OBS') };
    }
  },
  {
    matriz: 'ACUSE', claves: ['EMPRESA', 'ESTADO ACUSE'], periodoDeHoja: true,
    fila: (g) => {
      const e = n_(g.t('ESTADO ACUSE'));
      return {
        cliente: g.t('EMPRESA'), rut: g.t('RUT'), responsable: g.t('QUIEN REALIZA'),
        datos: { fecha_realizacion: g.f('FECHA REALIZACION'), hora_acuse: g.h('HORA DE ACUSE'), monto_iva: g.n('MONTO IVA'), cantidad_documentos: g.n('CANTIDAD DOCUMENTOS'), monto_iva_nc: g.n('MONTO IVA N C'), cantidad_nc: g.n('CANTIDAD DOCUMENTOS N C') },
        estado: e === 'OK' ? 'OK' : (e === 'NO APLICA' ? 'NO_APLICA' : 'PENDIENTE')
      };
    }
  },
  {
    matriz: 'CONVENIOS', claves: ['EMPRESA', 'FOLIO CONVENIO 1'], periodoDeHoja: true,
    fila: (g) => {
      const convenios = [];
      for (let i = 1; i <= 9; i++) {
        const it = {
          tipo: g.op('TIPO DE CONVENIO ' + i, ['IVA', 'Renta', 'IVA y Renta', 'Otro'], { 'IVA RENTA': 'IVA y Renta', 'IVA Y RENTA': 'IVA y Renta' }, 'Otro'),
          folio: g.t('FOLIO CONVENIO ' + i), fecha: g.f('FECHA QUE SE REALIZO EL CONVENIO ' + i),
          pie: g.n('PIE DE COVENIO ' + i) !== '' ? g.n('PIE DE COVENIO ' + i) : g.n('PIE DE CONVENIO ' + i),
          deuda: g.n('MONTO TOTAL DEUDA ' + i),
          cuotas_pagadas: g.n(new RegExp('^CUOTAS CANCEL[A-Z]* CONVENIO ' + i + '$')),
          cuotas_vencidas: g.n('CUOTAS VENCIDAS CONVENIO ' + i), termino: g.f('TERMINO DE CONVENIO ' + i)
        };
        if (it.folio || it.fecha || it.deuda !== '') convenios.push(it);
        else if (!g.t('TIPO DE CONVENIO ' + i)) continue;
      }
      return { cliente: g.t('EMPRESA'), rut: g.t('RUT'), responsable: g.t('QUIEN REALIZA'), datos: { convenios, de_que_deuda: g.t('DE QUE ES LA DEUDA') } };
    }
  },
  {
    matriz: 'CONTABILIZACION', claves: ['EMPRESA', 'ASIENTO DE APERTURA'], periodoDeHoja: true, dosNiveles: true,
    fila: (g, grupos) => {
      const ITEMS = {
        centralizaciones: { Compras: 'COMPRAS', Banco: 'BANCO', 'Mantención de vehículos': 'MANTENIMIENTO DE VEHICULOS', Combustible: 'COMBUSTIBLE', Ventas: 'VENTAS', Honorarios: 'HONORARIOS' },
        contabilizaciones: { 'Libro de remuneraciones': 'LIBRO REMUNERACIONES', F29: 'F29', PPM: 'PPM', Finiquitos: 'FINIQUITOS' },
        pagos: { Arriendo: 'ARRIENDO', Sueldos: 'SUELDOS', Imposiciones: 'IMPOSICIONES', Compras: 'COMPRAS', Ventas: 'VENTAS', Honorarios: 'HONORARIOS', Convenio: 'CONVENIO', 'Pago F29': 'PAGO F 29', 'Pago / devolución renta': 'PAGO DEVOLUCION RENTA', 'Rectificación renta': 'RECTIFICACION RENTA', 'Beneficio Mipymes cuota 1': 'BENEFICIO MIPYMES CUOTA 1', 'Beneficio Mipymes cuota 2': 'BENEFICIO MIPYMES CUOTA 2' }
      };
      const tareas = {};
      let alguno = false;
      Object.keys(ITEMS).forEach((clave) => {
        const rango = grupos[clave.toUpperCase()] || null;
        const items = {};
        let quien = '', fecha = '';
        if (rango) {
          for (let i = rango[0]; i <= rango[1]; i++) {
            const enc = g.enc[i];
            if (enc === 'QUIEN REALIZA' && !quien) quien = g.i(i);
            if (enc === 'FECHA REALIZACION' && !fecha) fecha = fecha_(g.i(i));
          }
          Object.keys(ITEMS[clave]).forEach((nombre) => {
            let col = -1;
            for (let i = rango[0]; i <= rango[1]; i++) if (g.enc[i] === ITEMS[clave][nombre]) { col = i; break; }
            const v = col === -1 ? '' : n_(g.i(col));
            items[nombre] = v === 'OK' ? 'OK' : (v === 'NO APLICA' ? 'NO_APLICA' : (v === 'PENDIENTE' ? 'PENDIENTE' : ''));
            if (items[nombre]) alguno = true;
          });
        }
        tareas[clave] = { quien_texto: quien, fecha, items };
      });
      const final = n_(g.t('ESTADO FINAL'));
      return {
        cliente: g.t('EMPRESA'), rut: g.t('RUT'), responsable: g.t('QUIEN REALIZA'),
        datos: {
          carta_poder: g.op('CLASIFICACION INTERNA', opcionesDe_('CONTABILIZACION', 'carta_poder'), { 'SI EXTERNO': 'Sí, externo', SI: 'Sí', NO: 'No' }),
          fecha_apertura: g.f('FECHA DE REVISION O APERTURA'), asiento_apertura: g.op('ASIENTO DE APERTURA', ['OK', 'Pendiente', 'No aplica']), tareas
        },
        estado: final === 'FINALIZADO' ? 'FINALIZADO' : (alguno ? 'EN_PROCESO' : 'PENDIENTE'), observaciones: g.t('OBS')
      };
    }
  },
  {
    matriz: 'ANOTACIONES', hoja: 'RECTIFICACIONES', claves: ['EMPRESA', 'MOTIVO'], todosLosAnios: true,
    fila: (g) => ({ cliente: g.t('EMPRESA'), datos: { tipo: 'Rectificación', anio_tributario: g.t('IVAS'), detalle: 'Rectificar IVA de ' + g.t('IVAS').toLowerCase() + ': ' + g.t('MOTIVO') }, estado: 'PENDIENTE' })
  },
  {
    matriz: 'ANOTACIONES', hoja: 'CARTA PODER', claves: ['LISTADO EMPRESAS'], todosLosAnios: true,
    fila: (g) => ({ cliente: g.t('LISTADO EMPRESAS'), datos: { tipo: 'Carta poder', fecha_notificacion: g.f('FECHA CARTA PODER'), detalle: 'Carta poder firmada', gestion: g.t('ENTREGA') ? 'Entrega: ' + g.t('ENTREGA') : '' }, estado: 'RESUELTA' })
  },
  {
    matriz: 'ANOTACIONES', claves: ['CLIENTES', 'CARTAS PODER ENVIADAS'], todosLosAnios: true,
    fila: (g) => {
      const recibida = g.sn('CARTA PODER RECIBIDAS') === 'Sí';
      return { cliente: g.t('CLIENTES'), datos: { tipo: 'Carta poder', detalle: 'Carta poder enviada' + (recibida ? ' y recibida' : '; falta recibirla firmada') }, estado: recibida ? 'RESUELTA' : 'PENDIENTE' };
    }
  },

  // ---------------------------------- RR.HH. ----------------------------------
  {
    matriz: 'REMUNERACIONES', hoja: 'REMUNERACIONES', claves: ['EMPRESA', 'NOMBRE OBRA'], periodoDe: 'fecha_recepcion',
    fila: (g) => {
      const iEst = g.col('ESTADO', g.col('FECHA DE DERIVACION') + 1);
      const e = n_(iEst === -1 ? '' : g.i(iEst));
      const mutual = ['MONTO MUTUAL', 'MONTO ACHS', 'MONTO ISL O IST'].map((p) => g.n(p)).filter((x) => x !== '');
      return {
        cliente: g.t('EMPRESA'), responsable: g.t('NOMBRE QUIEN REALIZA'),
        datos: {
          obra: g.t('NOMBRE OBRA'), fecha_recepcion: g.f('FECHA RECEPCION INFORMACION'), trabajadores: g.n('CANTIDAD'),
          fecha_derivacion: g.f('FECHA DE DERIVACION'), fecha_envio_liquidacion: g.f('FECHA ENVIO LIQUIDACION'),
          digitalizado: g.t('DIGITALIZACION DOCUMENTOS') ? 'Sí' : '',
          prestamo_solidario: g.n('3 PRESTAMO SOLIDARIO'), iusc: g.n('MONTO IUSC'), monto_fonasa: g.n('MONTO FONASA'),
          monto_seguro_social: g.n('1 SEGURO SOCIAL'), monto_isapre: g.n('MONTO ISAPRE'), monto_afp: g.n('MONTO AFP'),
          monto_mutual: mutual.length ? mutual.reduce((a, b) => a + b, 0) : '', cargas_familiares: g.n('CARGAS FAMILIARES'),
          caja: g.n('CAJA LOS HEROES'), valor_imposiciones: g.n('VALOR IMPOSICIONES'), fecha_declaracion: g.f('FECHA DE DECLARACION'),
          fecha_envio_imposiciones: g.f('FECHA ENVIO IMPOSICIONES'), intereses: g.n('VALOR DE INTERESES'), fecha_pago_imposiciones: g.f('F PAGO IMPOSICIONES')
        },
        estado: e === 'ENVIADO' ? 'ENVIADO' : (e === 'EN REVISION' ? 'EN_REVISION' : (/PENDIENTE DE ENVIO/.test(e) ? 'PENDIENTE_ENVIO' : 'PENDIENTE')),
        observaciones: g.t('COMENTARIO')
      };
    }
  },
  {
    matriz: 'CONTRATOS', hoja: 'CONTRATOS', claves: ['EMPRESA'], periodoDe: 'fecha_recepcion',
    fila: (g) => ({
      cliente: g.t('EMPRESA'), responsable: g.t('QUIEN REALIZA'),
      datos: {
        fecha_recepcion: g.f('RECEPCION DEL REQUERIMIENTO'), trabajador: g.t('NOMBRE DE TRABAJADOR'), trabajador_rut: g.t('RUT'),
        tipo_contrato: g.op('TIPO CONTRATO', opcionesDe_('CONTRATOS', 'tipo_contrato'), { 'PLAZO POR OBRA': 'Por obra o faena', 'POR OBRA': 'Por obra o faena', OBRA: 'Por obra o faena' }),
        vencimiento: g.f('VENCIMIENTO DEL CONTRATO'), cantidad: g.n('CANTIDAD DE TRABAJADORES'),
        plataforma: g.op('PLATORMA DE REALIZACION', opcionesDe_('CONTRATOS', 'plataforma'), PLATAFORMA_SIN), fecha_envio: g.f('ENVIO DE LA DOC AL CLIENTE')
      },
      estado: enviado_(g, 'ENVIO DE LA DOC AL CLIENTE'), observaciones: g.t('COMENTARIO')
    })
  },
  {
    matriz: 'ANEXOS', hoja: 'ANEXOS', claves: ['EMPRESA'], periodoDe: 'fecha_recepcion',
    fila: (g) => ({
      cliente: g.t('EMPRESA'), responsable: g.t('QUIEN REALIZA'),
      datos: {
        fecha_recepcion: g.f('RECEPCION DEL REQUERIMIENTO'), trabajador: g.t('NOMBRE'), trabajador_rut: g.t('RUT'),
        tipo_anexo: g.op('TIPO DE ANEXO', opcionesDe_('ANEXOS', 'tipo_anexo'), { 'SEGUNDO ANEXO': 'Segundo anexo a plazo fijo', 'CAMBIO DE HORARIO': 'Cambio de horario', AUMENTO: 'Aumento del sueldo mínimo', 'CAMBIO DE CARGO': 'Cambio de cargo', TRASLADO: 'Traslado', PACTO: 'Pacto de horas extra' }, 'Otro'),
        cantidad: g.n('CANTIDAD ANEXOS'), plataforma: g.op('PLATAFORMA DE REALIZACION', opcionesDe_('ANEXOS', 'plataforma'), PLATAFORMA_SIN),
        fecha_facilremu: g.f('FECHA ACTUALIZACION EN FACILREMU'), fecha_envio: g.f('ENVIO DE LA DOC AL CLIENTE'),
        fecha_firmado: g.f('FECHA DE LLEGADA DE DOCUMENTO FIRMADO'), fecha_digitalizacion: g.f('FECHA DE DIGITALIZACION ANEXO EN HPD')
      },
      estado: enviado_(g, 'ENVIO DE LA DOC AL CLIENTE')
    })
  },
  {
    matriz: 'FINIQUITOS', hoja: 'FINIQUITOS', claves: ['EMPRESA'], periodoDe: 'fecha_recepcion',
    fila: (g) => ({
      cliente: g.t('EMPRESA'), responsable: g.t('QUIEN REALIZA'),
      datos: {
        fecha_recepcion: g.f('RECEPCION DEL REQUERIMIENTO'), trabajador: g.t('NOMBRE'), trabajador_rut: g.t('RUT'), causal: causal_(g.t('CAUSAL DE FINIQUITO')),
        cantidad: g.n('N TRABAJADORES'), retroactivo: g.op('MOVIMIENTO DE PERSONAL RETROACTIVO', ['Sí', 'No'], { SI: 'Sí', NO: 'No' }), fecha_envio: g.f('ENVIO DE LA DOC AL CLIENTE')
      },
      estado: enviado_(g, 'ENVIO DE LA DOC AL CLIENTE'), observaciones: g.t('OBSERVACIONES')
    })
  },
  {
    matriz: 'FINIQUITO_ELECTRONICO', hoja: 'FINIQUITO ELECTRONICO', claves: ['EMPRESA'], periodoDe: 'fecha_solicitud',
    fila: (g) => {
      const datos = {
        fecha_solicitud: g.f('FECHA DE SOLICITUD'), trabajador: g.t('NOMBRE DEL TRABAJADOR'), fecha_inicio: g.f('FECHA DE INICIO'), fecha_termino: g.f('FECHA DE TERMINO'),
        causal: causal_(g.t('CAUSAL')), monto: g.n('MONTO'), intereses: g.n('INTERESES'), fecha_envio: g.f('FECHA DE ENVIO AL CLIENTE'),
        fecha_aceptacion: g.f('FECHA DE ACEPTACION DE FINIQUITO'), fecha_pago: g.f('FECHA DE PAGO AL TRABAJADOR')
      };
      const e = n_(g.t('ESTADO FINIQUITO'));
      let estado = 'PENDIENTE';
      if (datos.fecha_pago) estado = 'PAGADO';
      else if (/NO ACEPTADO|RECHAZ/.test(e)) estado = 'RECHAZADO';
      else if (/ACEPTADO/.test(e) || datos.fecha_aceptacion) estado = 'ACEPTADO';
      else if (datos.fecha_envio) estado = 'ENVIADO';
      return { cliente: g.t('EMPRESA'), responsable: '', datos, estado };
    }
  },
  {
    matriz: 'LICENCIAS', hoja: 'LICENCIAS', claves: ['EMPRESA'], periodoDe: 'fecha_tramite',
    fila: (g) => {
      const e = n_(g.t('ESTADO'));
      return {
        cliente: g.t('EMPRESA'), responsable: g.t('QUIEN REALIZA'),
        // El MOTIVO de la licencia no se importa (dato de salud).
        datos: {
          obra: g.t('OBRA'), trabajador: g.t('NOMBRE PERSONAL'), trabajador_rut: g.t('RUT PERSONAL'), fecha_tramite: g.f('FECHA TRAMITE'),
          fecha_inicio: g.f('FECHA INICIO'), dias: g.n('DIAS LICENCIA'), institucion: g.op('INSTITUCION', opcionesDe_('LICENCIAS', 'institucion'), { CAJA: 'CCAF' }),
          fecha_envio: g.f('FECHA DE ENVIO AL CLIENTE'),
          digitalizado: g.t('LICENCIA DIGITALIZAR EN PLATAFORMA') || g.t('LICENCIA MEDICA DIGITALIZAR EN INTRANET') ? 'Sí' : ''
        },
        estado: /TRAMITAD/.test(e) ? 'TRAMITADA' : (/FUERA/.test(e) ? 'FUERA_PLAZO' : 'PENDIENTE')
      };
    }
  },
  {
    matriz: 'CERTIFICADOS', hoja: 'CERTIFICADOSF301', claves: ['EMPRESA'], periodoDe: 'fecha_recepcion',
    fila: (g) => ({
      cliente: g.t('EMPRESA'), responsable: g.t('QUIEN REALIZA'),
      datos: { tipo_certificado: 'F30-1', fecha_recepcion: g.f('RECEPCION DEL REQUERIMIENTO'), obra: g.t('NOMBRE OBRA'), tipo_solicitud: g.t('TIPO DE SOLICITUD'),
        fecha_envio: g.f('ENVIO AL CLIENTE'), digitalizado_intranet: g.sn('DIGITALIZACION INTRANET', true), digitalizado_hpd: g.sn('DIGITALIZACION HPD', true), periodo_certificado: g.t('PERIODO'), mora: g.t('COMENTARIO') },
      estado: enviado_(g, 'ENVIO AL CLIENTE')
    })
  },
  {
    matriz: 'CERTIFICADOS', hoja: 'CERTIFICADOSF30', claves: ['EMPRESA'], periodoDe: 'fecha_recepcion',
    fila: (g) => ({
      cliente: g.t('EMPRESA'), responsable: g.t('QUIEN REALIZA'),
      datos: { tipo_certificado: 'F30', fecha_recepcion: g.f('RECEPCION DEL REQUERIMIENTO'), tipo_solicitud: g.t('TIPO DE SOLICITUD'),
        fecha_envio: g.f('ENVIO AL CLIENTE'), digitalizado_hpd: g.sn('DIGITALIZACION HPD', true), mora: g.t('COMENTARIOS') },
      estado: enviado_(g, 'ENVIO AL CLIENTE')
    })
  },
  {
    matriz: 'CONSTANCIAS', hoja: 'CONSTANCIASLABORALES', claves: ['EMPRESA'], periodoDe: 'fecha_recepcion',
    fila: (g) => ({
      cliente: g.t('EMPRESA'), responsable: g.t('QUIEN REALIZA'),
      datos: { fecha_recepcion: g.f('RECEPCION DEL REQUERIMIENTO'), tipo_constancia: g.t('TIPO DE CONSTACIA'), comentario_cliente: g.t('COMENTARIO DEL CLIENTE'),
        trabajador: g.t('NOMBRE DEL TRABAJADOR'), trabajador_rut: g.t('RUT DEL TRABAJADOR'), fecha_envio: g.f('ENVIO AL CLIENTE'), digitalizado: g.sn('DIGITALIZACION HPD', true) },
      estado: enviado_(g, 'ENVIO AL CLIENTE')
    })
  },
  {
    matriz: 'CARTAS_AVISO', hoja: 'CARTASDEAVISO', claves: ['EMPRESA'], periodoDe: 'fecha_recepcion',
    fila: (g) => ({
      cliente: g.t('EMPRESA'), responsable: g.t('QUIEN REALIZA'),
      datos: { fecha_recepcion: g.f('RECEPCION DEL REQUERIMIENTO'), cantidad: g.n('CANTIDAD'), fecha_realizacion: g.f('FECHA QUE SE REALIZA'), tipo_carta: g.t('TIPO DE CARTA'),
        comprobante: g.op('TIPO DE COMPROBANTE', opcionesDe_('CARTAS_AVISO', 'comprobante'), { 'COMPROBANTE DT': 'Comprobante DT', DT: 'Comprobante DT', CERTIFICADA: 'Carta certificada', PERSONAL: 'Entrega personal' }, 'Otro'),
        trabajador: g.t('NOMBRE'), trabajador_rut: g.t('RUT'), fecha_envio: g.f('FECHA ENVIO AL CLIENTE'), digitalizado: g.sn('DIGITALIZACION HPD', true) },
      estado: enviado_(g, 'FECHA ENVIO AL CLIENTE')
    })
  },
  {
    matriz: 'LRE', hoja: 'LRE', claves: ['EMPRESA'], periodoDe: 'fecha_registro',
    fila: (g) => {
      const e = n_(g.t('ESTADO'));
      return {
        cliente: g.t('EMPRESA'), responsable: g.t('QUIEN REALIZA CARGA DE LRE'),
        datos: { fecha_registro: g.f('FECHA EN QUE SE REGISTRA LRE'), trabajadores: g.n('CANTIDAD DE TRABAJADORES'), finiquitos: g.n('CANTIDAD DE FINIQUITOS'),
          monto_imponible: g.n('MONTO IMPONIBLE'), monto_no_imponible: g.n('MONTO NO IMPONIBLE'), aporte_patronal: g.n('APORTE PATRONAL'), digitalizado: g.sn('DIGITALIZACION HPD', true) },
        // La columna Estado casi nunca se llena: si hay fecha de registro en la DT, se declaró.
        estado: /SIN MOVIMIENTO/.test(e) ? 'SIN_MOVIMIENTO' : (/NO DECLARADA/.test(e) ? 'NO_DECLARADO' : (/^DECLARADA/.test(e) || g.f('FECHA EN QUE SE REGISTRA LRE') ? 'DECLARADO' : 'PENDIENTE')),
        observaciones: g.t('COMENTARIO')
      };
    }
  },
  {
    matriz: 'PLATAFORMAS', hoja: 'PLATAFORMAS EXTERNAS', claves: ['EMPRESA', 'PLATAFORMA'], periodoDe: 'fecha_subida',
    fila: (g) => {
      // "Estado" en esta hoja es Con/Sin movimiento del cliente, no el de la carga.
      const mov = g.t('ESTADO');
      return {
        cliente: g.t('EMPRESA'), responsable: g.t('QUIEN REALIZA'),
        datos: { plataforma: g.t('PLATAFORMA'), empresa_principal: g.t('EMPRESA PRINCIPAL'), obras: g.t('OBRAS'), fecha_subida: g.f('FECHA DE SUBIDA'),
          dias_revision: g.n('DIAS DE REVISION'), trabajadores_cobro: g.n('CANTIDAD DE TRABAJADORES QUE SE LE SUBIO'), trabajadores_mes: g.n('CANTIDAD TRABAJADORES EN EL MES'),
          finiquitados_mes: g.n('CANTIDAD DE TRABAJADORES FINIQUITADOS'), f43: g.sn('CUENTAN CON FORMULARIO F43', true) },
        estado: g.f('FECHA DE SUBIDA') ? 'CARGADO' : 'PENDIENTE',
        observaciones: [mov ? 'Cliente ' + mov.toLowerCase() : '', g.t('COMENTARIO')].filter(Boolean).join(' · ')
      };
    }
  }
];

/** Qué especificación corresponde a la hoja (o null). */
function reconocer_(hoja, filas) {
  const nombre = n_(hoja);
  for (const e of ESPECIFICACIONES) {
    if (e.hoja && n_(e.hoja) !== nombre) continue;
    const i = filaEncabezado_(filas, e.claves.map(n_));
    if (i !== -1) return { e, iEnc: i };
  }
  return null;
}
// En las de encabezado en dos niveles (Contabilización) el grupo va en la fila
// de arriba y se arrastra hacia la derecha.
function grupos_(filaGrupo, largo) {
  const rangos = {};
  let actual = '', inicio = 0;
  for (let i = 0; i <= largo; i++) {
    const g = i < largo ? n_((filaGrupo || [])[i]) : '__FIN__';
    if (g && g !== actual) {
      if (actual) rangos[actual] = [inicio, i - 1];
      actual = g; inicio = i;
    }
  }
  return rangos;
}

// --- clientes y personas ---------------------------------------------------------------
function nombreNorm_(t) { return n_(t).replace(/\b(SPA|LTDA|LIMITADA|EIRL|E I R L|S A|SA)\b/g, '').replace(/\s+/g, ' ').trim(); }
function rutNorm_(t) { const m = String(t || '').toUpperCase().replace(/\./g, '').match(/(\d{6,9})\s*-\s*([\dK])\b/); return m ? Number(m[1]) + '-' + m[2] : ''; }
function contextoClientes_(db) {
  const porCodigo = {}, porRut = {}, porNombre = {};
  CI.clientes_(db).forEach((c) => {
    if (c.codigo) porCodigo[n_(c.codigo)] = c;
    const r = rutNorm_(c.rut);
    if (r) porRut[r] = c;
    const k = nombreNorm_(c.nombre);
    if (k && !porNombre[k]) porNombre[k] = c;
  });
  return { porCodigo, porRut, porNombre };
}
function resolverCliente_(ctx, texto, rutTexto) {
  const s = String(texto || '').replace(/\s+/g, ' ').trim();
  if (s.length < 2) return null;
  const cod = (s.match(/^([A-Z]{2,3}-\d{2,4}-\d+)/i) || [])[1];
  const rut = rutNorm_(rutTexto) || rutNorm_(s);
  const nombre = s.replace(/^[A-Z]{2,3}-\d{2,4}-\d+\s*/i, '').replace(/\s*\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[\dkK]\s*$/, '').replace(/\s*\d{1,2}\.\d{3}\.?\s*$/, '').trim() || s;
  const c = (cod && ctx.porCodigo[n_(cod)]) || (rut && ctx.porRut[rut]) || ctx.porNombre[nombreNorm_(nombre)];
  if (c) return { cliente_id: c.cliente_id, cliente_nombre: c.nombre, cliente_rut: c.rut };
  return { cliente_id: '', cliente_nombre: nombre.slice(0, 200), cliente_rut: rut };
}
// "FRANCISCA", "Bárbara", "Vanessa Sepulveda" -> el correo de la única cuenta que calza.
function contextoPersonas_(db) {
  let cuentas = [];
  try { cuentas = leerFilas_(db, 'CUENTAS_PORTAL', COLUMNAS.CUENTAS_PORTAL).filter((c) => c.activo === true || c.activo === 'TRUE' || c.activo === 1); } catch (e) { /* */ }
  const lista = cuentas.map((c) => {
    let emails = c.emails;
    if (typeof emails === 'string') { try { emails = JSON.parse(emails); } catch (e) { emails = emails.split(/[,;\s]+/); } }
    return { nombre: n_(c.nombre), email: String((emails || [])[0] || '').toLowerCase() };
  }).filter((c) => c.nombre && c.email);
  const cache = {};
  return function (texto) {
    const s = n_(texto);
    if (!s) return '';
    if (cache[s] !== undefined) return cache[s];
    let c = lista.filter((x) => x.nombre === s);
    if (c.length !== 1) c = lista.filter((x) => x.nombre.indexOf(s) === 0);
    if (c.length !== 1) { const p = s.split(' ')[0]; c = lista.filter((x) => x.nombre.split(' ')[0] === p); }
    cache[s] = c.length === 1 ? c[0].email : '';
    return cache[s];
  };
}

// =========================================================================================
// Acción
// =========================================================================================

/**
 * Importa (o simula) UNA hoja. data: { archivo, hoja, filas: [[celda]], anio, simular }.
 */
function importarHoja(db, data, contexto) {
  if (!contexto || contexto.rol !== 'ADM') return { _forbidden: true, message: 'Solo el administrador importa planillas.' };
  const d = data || {};
  const hoja = String(d.hoja || '').slice(0, 120), archivo = String(d.archivo || '').slice(0, 200);
  // Las hojas arrastran miles de filas vacías con formato: no cuentan.
  const filas = (Array.isArray(d.filas) ? d.filas : []).filter((f) => Array.isArray(f) && f.some((v) => v !== null && v !== undefined && String(v).trim() !== ''));
  if (filas.length > MAX_FILAS) return { ok: false, message: 'La hoja ' + hoja + ' tiene demasiadas filas (' + filas.length + ').' };
  const anio = /^\d{4}$/.test(String(d.anio || '')) ? String(d.anio) : String(new Date().getFullYear());
  const base = { archivo, hoja };

  const rec = reconocer_(hoja, filas);
  if (!rec) return Object.assign(base, { ok: true, omitida: true, motivo: 'No corresponde a una matriz del módulo.' });
  const e = rec.e, m = matriz_(e.matriz);
  let periodoHoja = '';
  if (e.periodoDeHoja) {
    periodoHoja = periodoHoja_(hoja);
    if (!periodoHoja) return Object.assign(base, { ok: true, omitida: true, matriz: m.clave, nombre: m.nombre, motivo: 'La hoja no dice mes y año.' });
    if (periodoHoja.slice(0, 4) !== anio) return Object.assign(base, { ok: true, omitida: true, matriz: m.clave, nombre: m.nombre, motivo: 'Es de ' + periodoHoja.slice(0, 4) + '.' });
  }

  const enc = (filas[rec.iEnc] || []).map(n_);
  const rangos = e.dosNiveles ? grupos_(filas[rec.iEnc - 1], enc.length) : null;
  const clientes = contextoClientes_(db);
  const persona = contextoPersonas_(db);
  const existentes = CI.consultar_(db, 'CI_REGISTROS', { matriz: m.clave, activa: true });
  const origenes = new Set(existentes.map((r) => (r.datos || {})._origen).filter(Boolean));
  const deEstaCarga = new Set();
  const unico = new Set(m.unaPorCliente ? existentes.map((r) => r.periodo + '|' + (r.cliente_id || 'N:' + nombreNorm_(r.cliente_nombre))) : []);

  const res = Object.assign(base, {
    ok: true, matriz: m.clave, nombre: m.nombre, simulado: !!d.simular,
    leidas: 0, nuevas: 0, ya_estaban: 0, duplicadas: 0, repetidas: 0, otro_anio: 0, sin_fecha: 0, sin_datos: 0,
    fuera_catalogo: 0, fuera_catalogo_ejemplos: [], sin_cuenta: [], errores: [], por_periodo: {}
  });
  // Columnas que solo identifican (cliente, RUT, N°, código): una fila que no
  // trae nada más es una lista de clientes pegada abajo, no un registro.
  const identidad = new Set(['EMPRESA', 'RUT', 'N', 'CODIGO', 'COD', 'LISTADO EMPRESAS', 'CLIENTES', 'NOMBRE EMPRESA'].map((k) => enc.indexOf(k)).filter((i) => i !== -1));
  const sinCuenta = new Set(), fueraEj = new Set();
  const nuevos = [];
  const ahora = new Date().toISOString();

  for (let i = rec.iEnc + 1; i < filas.length; i++) {
    const fila = (filas[i] || []).map((v) => (v == null ? '' : String(v)));
    const g = lector_(fila, enc);
    g.enc = enc;
    let x;
    try { x = e.fila(g, rangos); } catch (err) { res.errores.push('Fila ' + (i + 1) + ': ' + err.message); continue; }
    if (!x || !x.cliente) continue;
    if (!fila.some((v, k) => !identidad.has(k) && vacio_(v) !== '')) { res.sin_datos++; continue; }
    res.leidas++;

    const huella = crypto.createHash('sha1').update(m.clave + '|' + hoja + '|' + JSON.stringify(fila)).digest('hex').slice(0, 20);
    // Ya importada antes, o la misma fila copiada dos veces en la planilla.
    if (origenes.has(huella)) { res.ya_estaban++; continue; }
    if (deEstaCarga.has(huella)) { res.duplicadas++; continue; }

    // Responsables (los de la checklist también).
    const responsable = persona(x.responsable);
    const obs = [];
    if (x.responsable && !responsable) { sinCuenta.add(x.responsable); obs.push('Realizado por: ' + x.responsable); }
    if (x.datos && x.datos.tareas) {
      Object.keys(x.datos.tareas).forEach((k) => {
        const t = x.datos.tareas[k];
        t.quien = persona(t.quien_texto);
        if (t.quien_texto && !t.quien) sinCuenta.add(t.quien_texto);
        delete t.quien_texto;
      });
    }
    if (x.observaciones) obs.push(x.observaciones);

    const limpio = CI.limpiarDatos_(m, x.datos || {}, {});
    if (limpio.error) { if (res.errores.length < 20) res.errores.push('Fila ' + (i + 1) + ': ' + limpio.error); continue; }
    const datos = limpio.datos;
    let periodo = periodoHoja;
    if (!periodo) {
      const f = datos[e.periodoDe || m.fechaPrincipal];
      periodo = CI.periodoDeFecha_(f);
      if (!periodo && e.todosLosAnios) periodo = CI.periodoDeFecha_(new Date().toISOString().slice(0, 10));
      if (!periodo) { res.sin_fecha++; continue; }
      if (!e.todosLosAnios && periodo.slice(0, 4) !== anio) { res.otro_anio++; continue; }
    }
    const cli = resolverCliente_(clientes, x.cliente, x.rut);
    if (!cli) continue;
    if (m.unaPorCliente) {
      const k = periodo + '|' + (cli.cliente_id || 'N:' + nombreNorm_(cli.cliente_nombre));
      if (unico.has(k)) { res.repetidas++; continue; }
      unico.add(k);
    }
    if (!cli.cliente_id) { res.fuera_catalogo++; if (fueraEj.size < 8) fueraEj.add(cli.cliente_nombre); }
    datos._origen = huella;
    deEstaCarga.add(huella);
    const estado = CI.estadoCalculado_(m, datos) || (m.estados.some((s) => s.clave === x.estado) ? x.estado : m.estados[0].clave);
    nuevos.push(Object.assign({
      registro_id: CI.uuid_(), depto: m.depto, matriz: m.clave, periodo,
      fecha: m.fechaPrincipal ? String(datos[m.fechaPrincipal] || '') : '', estado, responsable_email: responsable,
      liberado_por: '', fecha_liberacion: '', datos, observaciones: obs.join(' · ').slice(0, 2000),
      creado_por: String(contexto.email || '').toLowerCase(), fecha_creacion: ahora,
      actualizado_por: String(contexto.email || '').toLowerCase(), fecha_actualizacion: ahora, activa: true
    }, cli));
    res.por_periodo[periodo] = (res.por_periodo[periodo] || 0) + 1;
  }
  res.nuevas = nuevos.length;
  res.sin_cuenta = Array.from(sinCuenta).slice(0, 20);
  res.fuera_catalogo_ejemplos = Array.from(fueraEj);

  if (!d.simular && nuevos.length) {
    CI.enTransaccion_(db, () => {
      nuevos.forEach((r) => {
        agregarFila_(db, 'CI_REGISTROS', r);
        CI.historial_(db, r.registro_id, 'IMPORTADO', 'Importado de ' + (archivo || 'planilla') + ' › ' + hoja, contexto);
      });
    });
  }
  return res;
}

module.exports = { importarHoja, reconocer_, periodoHoja_, fecha_, hora_, numero_, resolverCliente_, rutNorm_ };
