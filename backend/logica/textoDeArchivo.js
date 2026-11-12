'use strict';

/**
 * textoDeArchivo.js — saca el TEXTO de un Word (.docx), Excel (.xlsx) o
 * PowerPoint (.pptx) para que el Asistente SIGSO pueda leerlo (2026-11-11).
 *
 * Los PDF e imágenes no pasan por aquí: Claude los lee directo. Estos tres
 * formatos son ZIP con XML adentro; se lee el directorio central del ZIP (así
 * funciona también con los archivos que guarda Word, que usan "data
 * descriptor" y no traen el tamaño en el encabezado local) y se descomprime
 * con zlib, sin dependencias.
 */

const zlib = require('node:zlib');

const TOPE_TEXTO = 400000; // caracteres (~100.000 tokens): más que esto no se manda entero

/** Entradas del ZIP: { nombre -> Buffer } (solo las que pide `quiero`). */
function leerZip(buf, quiero) {
  const salida = {};
  // Fin del directorio central: firma 0x06054b50, buscada desde el final.
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('El archivo no es un ZIP válido (¿está dañado o protegido con clave?).');
  const total = buf.readUInt16LE(fin + 10);
  let pos = buf.readUInt32LE(fin + 16);
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(pos + 10);
    const compLen = buf.readUInt32LE(pos + 20);
    const nombreLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const comentLen = buf.readUInt16LE(pos + 32);
    const local = buf.readUInt32LE(pos + 42);
    const nombre = buf.slice(pos + 46, pos + 46 + nombreLen).toString('utf8');
    pos += 46 + nombreLen + extraLen + comentLen;
    if (!quiero(nombre)) continue;
    const lNombre = buf.readUInt16LE(local + 26);
    const lExtra = buf.readUInt16LE(local + 28);
    const ini = local + 30 + lNombre + lExtra;
    const datos = buf.slice(ini, ini + compLen);
    salida[nombre] = metodo === 8 ? zlib.inflateRawSync(datos) : datos;
  }
  return salida;
}

function decodificar_(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, c) => String.fromCodePoint(Number(c)))
    .replace(/&#x([0-9a-f]+);/gi, (m, c) => String.fromCodePoint(parseInt(c, 16)))
    .replace(/&amp;/g, '&');
}

function textoDocx_(zip) {
  const xml = (zip['word/document.xml'] || Buffer.alloc(0)).toString('utf8');
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<[^>]+>/g, '')
    .split('\n').map((l) => decodificar_(l).replace(/[ \t]+$/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function columna_(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return 0;
  return m[1].split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

function textoXlsx_(zip) {
  const compartidas = [];
  const ss = (zip['xl/sharedStrings.xml'] || Buffer.alloc(0)).toString('utf8');
  (ss.match(/<si>[\s\S]*?<\/si>/g) || []).forEach((si) => {
    const sinFon = si.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    compartidas.push(decodificar_((sinFon.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
  });
  // Nombres de las hojas, en el orden del libro.
  const libro = (zip['xl/workbook.xml'] || Buffer.alloc(0)).toString('utf8');
  const rels = (zip['xl/_rels/workbook.xml.rels'] || Buffer.alloc(0)).toString('utf8');
  const destino = {};
  (rels.match(/<Relationship [^>]*>/g) || []).forEach((r) => {
    const id = /Id="([^"]+)"/.exec(r); const t = /Target="([^"]+)"/.exec(r);
    if (id && t) destino[id[1]] = 'xl/' + t[1].replace(/^\/?xl\//, '').replace(/^\//, '');
  });
  const hojas = (libro.match(/<sheet [^>]*\/>/g) || []).map((h) => ({
    nombre: decodificar_((/name="([^"]*)"/.exec(h) || [])[1] || ''),
    archivo: destino[(/r:id="([^"]+)"/.exec(h) || [])[1]] || ''
  }));
  const partes = [];
  hojas.forEach((h) => {
    const xml = (zip[h.archivo] || Buffer.alloc(0)).toString('utf8');
    const filas = [];
    (xml.match(/<row[^>]*>[\s\S]*?<\/row>|<row[^>]*\/>/g) || []).forEach((row) => {
      const celdas = [];
      (row.match(/<c [^>]*?(\/>|>[\s\S]*?<\/c>)/g) || []).forEach((c) => {
        const ref = (/ r="([A-Z]+\d+)"/.exec(c) || [])[1];
        const tipo = (/ t="([^"]+)"/.exec(c) || [])[1];
        let v = (/<v>([\s\S]*?)<\/v>/.exec(c) || [])[1];
        if (tipo === 's') v = compartidas[Number(v)];
        else if (tipo === 'inlineStr') v = ((c.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join(''));
        if (v == null) return;
        celdas[columna_(ref)] = decodificar_(v).replace(/[\r\n\t]+/g, ' ');
      });
      if (celdas.some((x) => x !== undefined && x !== '')) filas.push(Array.from(celdas, (x) => (x == null ? '' : x)).join('\t'));
    });
    partes.push('### Hoja: ' + h.nombre + ' (' + filas.length + ' filas, columnas separadas por tabulador)\n' + filas.join('\n'));
  });
  return partes.join('\n\n');
}

function textoPptx_(zip) {
  return Object.keys(zip)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]))
    .map((n, i) => {
      const xml = zip[n].toString('utf8');
      const textos = (xml.match(/<a:t>[\s\S]*?<\/a:t>/g) || []).map((t) => decodificar_(t.replace(/<[^>]+>/g, '')));
      return '### Diapositiva ' + (i + 1) + '\n' + textos.join('\n');
    }).join('\n\n');
}

/**
 * Texto de un archivo de Office. `tipo`: 'docx' | 'xlsx' | 'pptx'.
 * Devuelve { texto, recortado }.
 */
function extraer(buf, tipo) {
  let texto;
  if (tipo === 'docx') texto = textoDocx_(leerZip(buf, (n) => n === 'word/document.xml'));
  else if (tipo === 'xlsx') texto = textoXlsx_(leerZip(buf, (n) => /^xl\/(sharedStrings|workbook)\.xml$|^xl\/_rels\/workbook\.xml\.rels$|^xl\/worksheets\/[^/]+\.xml$/.test(n)));
  else if (tipo === 'pptx') texto = textoPptx_(leerZip(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)));
  else throw new Error('Formato no soportado: ' + tipo);
  const recortado = texto.length > TOPE_TEXTO;
  return { texto: recortado ? texto.slice(0, TOPE_TEXTO) : texto, recortado };
}

/** Tipo de Office según nombre o mime ('' si no es uno de los tres). */
function tipoOffice(nombre, mime) {
  const n = String(nombre || '').toLowerCase();
  const m = String(mime || '').toLowerCase();
  if (/\.docx$/.test(n) || m.indexOf('wordprocessingml') !== -1) return 'docx';
  if (/\.xlsx$|\.xlsm$/.test(n) || m.indexOf('spreadsheetml') !== -1) return 'xlsx';
  if (/\.pptx$/.test(n) || m.indexOf('presentationml') !== -1) return 'pptx';
  return '';
}

module.exports = { extraer, tipoOffice, leerZip, TOPE_TEXTO };
