'use strict';

/**
 * xlsxZip.js — escritor de ZIP mínimo, sin dependencias nuevas, equivalente
 * a Utilities.zip (Apps Script) que usa ExcelGantt.gs para armar el .xlsx.
 * Mismo criterio "dependencias mínimas" que aws4fetch/pdfkit/scrypt en este
 * proyecto: Node 22+ ya trae zlib.crc32 y zlib.deflateRawSync, así que un
 * ZIP (DEFLATE, sin cifrado, sin streaming) se arma con ~80 líneas propias
 * en vez de sumar una librería.
 */

const zlib = require('zlib');

function fechaDos_(fecha) {
  const d = fecha || new Date();
  const dosTime = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const dosDate = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { dosTime, dosDate };
}

// entradas: [{ nombre, contenido: string|Buffer }, ...]. Devuelve un Buffer .zip.
function construirZip_(entradas) {
  const { dosTime, dosDate } = fechaDos_(new Date());
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  entradas.forEach((entrada) => {
    const nombreBuf = Buffer.from(entrada.nombre, 'utf8');
    const contenidoBuf = Buffer.isBuffer(entrada.contenido) ? entrada.contenido : Buffer.from(entrada.contenido, 'utf8');
    const comprimido = zlib.deflateRawSync(contenidoBuf);
    const crc = zlib.crc32(contenidoBuf) >>> 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(comprimido.length, 18);
    localHeader.writeUInt32LE(contenidoBuf.length, 22);
    localHeader.writeUInt16LE(nombreBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localChunks.push(localHeader, nombreBuf, comprimido);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(comprimido.length, 20);
    centralHeader.writeUInt32LE(contenidoBuf.length, 24);
    centralHeader.writeUInt16LE(nombreBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralChunks.push(centralHeader, nombreBuf);

    offset += localHeader.length + nombreBuf.length + comprimido.length;
  });

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralChunks);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entradas.length, 8);
  end.writeUInt16LE(entradas.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralBuf, end]);
}

// Lee un ZIP construido por construirZip_ (recorre encabezados locales en
// orden; no depende del directorio central). Solo para tests/depuración.
function leerZip_(buf) {
  const entradas = [];
  let pos = 0;
  while (pos < buf.length) {
    const firma = buf.readUInt32LE(pos);
    if (firma !== 0x04034b50) break;
    const metodo = buf.readUInt16LE(pos + 8);
    const compLen = buf.readUInt32LE(pos + 18);
    const sinComprimirLen = buf.readUInt32LE(pos + 22);
    const nombreLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);
    const nombreInicio = pos + 30;
    const nombre = buf.slice(nombreInicio, nombreInicio + nombreLen).toString('utf8');
    const dataInicio = nombreInicio + nombreLen + extraLen;
    const dataComprimida = buf.slice(dataInicio, dataInicio + compLen);
    const contenido = metodo === 8 ? zlib.inflateRawSync(dataComprimida) : dataComprimida;
    if (contenido.length !== sinComprimirLen) throw new Error('leerZip_: tamaño inconsistente en ' + nombre);
    entradas.push({ nombre, contenido });
    pos = dataInicio + compLen;
  }
  return entradas;
}

module.exports = { construirZip_, leerZip_ };
