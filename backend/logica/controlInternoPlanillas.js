'use strict';

/**
 * controlInternoPlanillas.js — cómo se LEEN las planillas del Drive de
 * Control interno (2026-10-01, versión "espejo del Excel").
 *
 * Las mismas reglas las usan el importador (controlInternoImportar.js) y el
 * script que generó las columnas de cada matriz a partir de las planillas
 * reales (controlInternoColumnas.js): por eso viven aparte y son puras (sin
 * base de datos).
 *
 * Problemas reales que resuelve (medidos en las 7 planillas, 2022-2026):
 *  - el encabezado cambia de fila (1 a 9) y de forma entre meses: IVA tiene
 *    17 versiones; se reconoce por cuántos nombres conocidos trae la fila;
 *  - columnas repetidas ("QUIÉN REALIZA" / "FECHA REALIZACIÓN" antes de cada
 *    bloque de Contabilización, "CORREO DESTINATARIO" x4): cada una se
 *    identifica por su grupo y por el ítem que sigue;
 *  - hojas sin año ("SEPTIEMBRE", "diciembre ", "CONVENIOS OCTUBRE"): el
 *    año se deduce de la hoja vecina (las hojas van de la más nueva a la más
 *    antigua);
 *  - celdas con claves escritas a mano ("Clave SII: ...") se borran siempre.
 */

const MESES = { ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 };
const RE_MES = /\b(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\b/;

/** Texto de encabezado normalizado: MAYÚSCULAS, sin tildes, sin signos. */
function n_(t) {
  return String(t == null ? '' : t).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9%]+/g, ' ').trim();
}
function vacio_(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return /^(NA|N\/A|#N\/A|-|—|\.|#REF!|#VALUE!|#DIV\/0!)$/i.test(s) ? '' : s;
}

// --- claves escritas en celdas --------------------------------------------------------------
// "Clave SII: 771060aqua", "clave: xxx", "pass: xxx": se reemplaza el valor.
const RE_CLAVE_EN_TEXTO = /\b(clave|contrase(?:ñ|n)a|password|pass)\b(\s*(sii|previred|dt|afc|sence))?\s*[:=]\s*\S+/gi;
function sinClaves_(texto) {
  // replace() con /g siempre parte desde 0 (test() con /g arrastra lastIndex).
  return String(texto == null ? '' : texto).replace(RE_CLAVE_EN_TEXTO, '[clave omitida]');
}
// Columnas que guardan usuarios o claves de plataformas: nunca se leen.
function esColumnaDeClave_(etiquetaNorm) {
  const e = etiquetaNorm;
  if (/\b(GUARDADA|ESTADO CLAVES|SOLICITUD DE CLAVE|RECEPCION DE CLAVE|ENVIO CLAVES)\b/.test(e)) return false;
  return /^(USUARIO|CLAVE)\b/.test(e) || /\bCLAVE (DE )?(PREVIRED|DT|SII|SENCE|AFC)\b/.test(e) || /\b(USUARIO|CLAVE) (PREVIRED|DT)\b/.test(e);
}

// --- período de una hoja ----------------------------------------------------------------------
/** "SEPTIEMBRE 2026", "AGOSTO25", "ENERO 23" -> { mes, anio|0 }; sin mes -> null. */
function mesDeHoja_(nombre) {
  const t = n_(nombre).replace(/([A-Z])(\d)/g, '$1 $2');
  const m = RE_MES.exec(t);
  if (!m) return null;
  const a = /\b(20\d{2}|\d{2})\b/.exec(t.slice(m.index + m[0].length));
  let anio = 0;
  if (a) anio = a[1].length === 2 ? 2000 + Number(a[1]) : Number(a[1]);
  return { mes: MESES[m[1]], anio };
}
/**
 * Período (AAAA-MNN) de cada hoja de un libro mensual, en el orden del libro.
 * Las hojas sin año toman el de la última hoja que SÍ lo dice (el ancla): si
 * su mes es menor que el del ancla, mismo año; si no, el anterior. (Encadenar
 * vecina con vecina falla: al final de algunos libros las hojas viejas van en
 * orden ascendente, SEPTIEMBRE, OCTUBRE, NOVIEMBRE, DICIEMBRE de 2022.)
 */
function periodosDeHojas_(nombres) {
  const res = {};
  let ancla = null;
  nombres.forEach((nombre) => {
    if (/^COPIA DE /.test(n_(nombre))) { res[nombre] = ''; return; }
    const m = mesDeHoja_(nombre);
    if (!m) { res[nombre] = ''; return; }
    let anio = m.anio;
    if (anio) ancla = { mes: m.mes, anio };
    else if (ancla) anio = m.mes < ancla.mes ? ancla.anio : ancla.anio - 1;
    res[nombre] = anio ? anio + '-M' + String(m.mes).padStart(2, '0') : '';
  });
  return res;
}

// --- encabezados -------------------------------------------------------------------------------
/**
 * Fila de encabezado: la que más nombres conocidos trae entre las primeras 15.
 * `conocidos` = Set de etiquetas normalizadas (todas las versiones).
 */
function filaEncabezado_(filas, conocidos, minimo) {
  let mejor = -1, puntos = 0;
  for (let i = 0; i < Math.min(filas.length, 15); i++) {
    const f = filas[i] || [];
    let p = 0;
    f.forEach((v) => { if (conocidos.has(canonico_(n_(v)))) p++; });
    if (p > puntos) { puntos = p; mejor = i; }
  }
  return puntos >= (minimo || 2) ? mejor : -1;
}
/**
 * Para hojas sin nombres conocidos de antemano (RR.HH., una hoja por
 * matriz): la fila con más textos entre las primeras 10. El título de la
 * hoja ("RH-M-2 / SOLICITUDES DE CLIENTES") tiene 2-3; el encabezado, 5+.
 */
function filaEncabezadoPorTexto_(filas) {
  let mejor = -1, puntos = 0;
  for (let i = 0; i < Math.min(filas.length, 10); i++) {
    const p = (filas[i] || []).filter((v) => { const s = vacio_(v); return s && /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(s) && !/^RH-M/i.test(s); }).length;
    if (p > puntos) { puntos = p; mejor = i; }
  }
  return puntos >= 2 ? mejor : -1;
}
/** Nombres equivalentes entre versiones de las planillas. */
const EQUIVALENTES = { COD: 'CODIGO', CANCELDAS: 'CANCELADAS', CONVIO: 'CONVENIO' };
function canonico_(e) {
  return e.split(' ').map((p) => EQUIVALENTES[p] || p).join(' ');
}
const GENERICAS = new Set(['QUIEN REALIZA', 'FECHA REALIZACION']);
/**
 * Identidad de cada columna del encabezado. Las repetidas se distinguen:
 *  - QUIÉN REALIZA / FECHA REALIZACIÓN repetidas -> por el ítem que viene
 *    después ("QUIEN REALIZA > COMPRAS");
 *  - con encabezado de dos niveles -> "GRUPO / ETIQUETA";
 *  - si aún se repite -> "ETIQUETA #2", "#3"...
 * Devuelve [{ col, clave, etiqueta, grupo }] solo de las columnas con nombre.
 */
function columnasDeEncabezado_(filaEnc, filaGrupo, opciones) {
  const op = opciones || {};
  const validos = op.gruposValidos ? new Set(op.gruposValidos.map(n_)) : null;
  const sinGrupo = new Set((op.sinGrupo || []).map(n_));
  // Las celdas que son números o fechas en la fila de encabezado no son columnas.
  const enc = (filaEnc || []).map((v) => { const e = canonico_(n_(v)); return /^[\d ]+$/.test(e) ? '' : e; });
  const crudo = (filaEnc || []).map((v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim());
  const grupos = [];
  let g = '';
  for (let j = 0; j < enc.length; j++) {
    const gv = n_((filaGrupo || [])[j]);
    if (gv && !/^\d+$/.test(gv)) g = !validos || validos.has(gv) ? gv : '';
    grupos.push(filaGrupo && !sinGrupo.has(enc[j]) ? g : '');
  }
  const cuenta = {};
  enc.forEach((e) => { if (e) cuenta[e] = (cuenta[e] || 0) + 1; });
  const usadas = {};
  const out = [];
  for (let j = 0; j < enc.length; j++) {
    const e = enc[j];
    if (!e) continue;
    let clave = e, grupo = grupos[j];
    if (GENERICAS.has(e) && (cuenta[e] > 1 || op.siempreGrupo)) {
      // "QUIÉN REALIZA" va antes de los ítems que firma: es del ítem que sigue.
      let k = j + 1;
      while (k < enc.length && (!enc[k] || GENERICAS.has(enc[k]))) k++;
      clave = e + ' > ' + (enc[k] || 'FIN');
      grupo = k < enc.length ? grupos[k] : grupo;
      if (grupo) clave = grupo + ' / ' + clave;
    } else if (grupo && (cuenta[e] > 1 || op.siempreGrupo)) {
      clave = grupo + ' / ' + e;
    }
    if (op.alias && op.alias[clave]) clave = op.alias[clave];
    if (usadas[clave]) { usadas[clave]++; clave = clave + ' #' + usadas[clave]; } else usadas[clave] = 1;
    out.push({ col: j, clave, etiqueta: crudo[j], grupo });
  }
  return out;
}

// --- valores ---------------------------------------------------------------------------------
function pad_(n) { return String(n).padStart(2, '0'); }
/** Número de serie de Excel o texto con fecha -> AAAA-MM-DD ('' si no es fecha). */
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
  if (m) {
    const anio = m[3].length === 2 ? '20' + m[3] : m[3];
    if (Number(m[2]) > 12 || Number(m[1]) > 31) return '';
    return anio + '-' + pad_(m[2]) + '-' + pad_(m[1]);
  }
  return '';
}
function hora_(v) {
  const s = vacio_(v);
  if (!s) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (m) return pad_(m[1]) + ':' + m[2];
  const n = Number(s);
  if (!isFinite(n) || n < 0 || n >= 1) return '';
  const min = Math.round(n * 1440);
  return pad_(Math.floor(min / 60) % 24) + ':' + pad_(min % 60);
}
/** "1.505.500", "$ 2,791,221", "56596.0" -> número; '' si no es número. */
function numero_(v) {
  let s = vacio_(v).replace(/\$/g, '').replace(/\s/g, '');
  if (!s) return '';
  if (/^-?\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 100) / 100;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
  if (/^-?\d+,\d+$/.test(s)) return Number(s.replace(',', '.'));
  return '';
}
/**
 * Valor de una celda según el tipo de la columna. Lo que no calza con el
 * tipo NO se pierde: queda como texto (así se ve igual que en la planilla).
 */
function valor_(tipo, v) {
  // Aquí NO se borra "NA"/"N/A"/"-": en la planilla dicen algo ("no aplica") y
  // la fila tiene que verse igual. Solo se limpian los errores de fórmula.
  const s = sinClaves_(String(v == null ? '' : v).replace(/\s+/g, ' ').trim().replace(/^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?)$/i, ''));
  if (!s) return '';
  if (tipo === 'fecha') return fecha_(s) || s.slice(0, 120);
  if (tipo === 'hora') return hora_(s) || s.slice(0, 40);
  if (tipo === 'monto' || tipo === 'numero') { const x = numero_(s); return x === '' ? s.slice(0, 120) : x; }
  if (tipo === 'texto_largo') return s.slice(0, 4000);
  return s.slice(0, 600);
}

function nombreNorm_(t) { return n_(t).replace(/\b(SPA|LTDA|LIMITADA|EIRL|E I R L|S A|SA)\b/g, '').replace(/\s+/g, ' ').trim(); }
function rutNorm_(t) { const m = String(t || '').toUpperCase().replace(/\./g, '').replace(/\s+/g, '').match(/(\d{6,9})-?([\dK])\b/); return m ? Number(m[1]) + '-' + m[2] : ''; }

module.exports = {
  n_, vacio_, sinClaves_, esColumnaDeClave_, mesDeHoja_, periodosDeHojas_, filaEncabezado_, filaEncabezadoPorTexto_, columnasDeEncabezado_, canonico_,
  fecha_, hora_, numero_, valor_, nombreNorm_, rutNorm_, MESES
};
