/**
 * lector-xlsx.js — lee un .xlsx en el NAVEGADOR, sin librerías: el .xlsx es
 * un ZIP con XML adentro. Se descomprime con DecompressionStream
 * ('deflate-raw', nativo en Chrome/Edge/Firefox/Safari actuales) y se sacan
 * las celdas con expresiones regulares (DOMParser choca con TrustedHTML en
 * algunos navegadores y es más lento en hojas grandes).
 *
 * Uso: SigsoLectorXlsx.leer(archivo|ArrayBuffer) -> Promise<[{ hoja, filas }]>
 * `filas` es un arreglo por fila (respetando el número de fila de Excel) de
 * celdas como texto: números y fechas quedan como el valor crudo de Excel
 * (las fechas son el número de serie; el servidor las convierte).
 *
 * También corre en Node 18+ (mismo código) para probarlo con archivos reales.
 */
(function (raiz) {
  'use strict';

  function dec_(s) {
    return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(Number(n)); })
      .replace(/&#x([0-9a-f]+);/gi, function (m, n) { return String.fromCharCode(parseInt(n, 16)); })
      .replace(/&amp;/g, '&');
  }
  function colNum_(ref) {
    var l = ref.replace(/\d+/g, ''), n = 0;
    for (var i = 0; i < l.length; i++) n = n * 26 + (l.charCodeAt(i) - 64);
    return n - 1;
  }

  // --- ZIP: directorio central -> entradas ---------------------------------------------
  function entradas_(buf) {
    var dv = new DataView(buf), u8 = new Uint8Array(buf);
    var fin = -1;
    for (var i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { fin = i; break; }
    }
    if (fin < 0) throw new Error('El archivo no es un .xlsx válido.');
    var total = dv.getUint16(fin + 10, true), p = dv.getUint32(fin + 16, true);
    var mapa = {}, td = new TextDecoder('utf-8');
    for (var k = 0; k < total; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var metodo = dv.getUint16(p + 10, true), comprimido = dv.getUint32(p + 20, true);
      var largoNombre = dv.getUint16(p + 28, true), largoExtra = dv.getUint16(p + 30, true), largoCom = dv.getUint16(p + 32, true);
      var local = dv.getUint32(p + 42, true);
      var nombre = td.decode(u8.subarray(p + 46, p + 46 + largoNombre));
      mapa[nombre] = { metodo: metodo, comprimido: comprimido, local: local };
      p += 46 + largoNombre + largoExtra + largoCom;
    }
    return mapa;
  }
  function inflar_(datos) {
    var ds = new DecompressionStream('deflate-raw');
    var flujo = new Blob([datos]).stream().pipeThrough(ds);
    return new Response(flujo).arrayBuffer();
  }
  function leerEntrada_(buf, mapa, nombre) {
    var e = mapa[nombre];
    if (!e) return Promise.resolve('');
    var dv = new DataView(buf);
    var ini = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
    var datos = new Uint8Array(buf, ini, e.comprimido);
    var p = e.metodo === 0 ? Promise.resolve(datos) : inflar_(datos);
    return p.then(function (b) { return new TextDecoder('utf-8').decode(b); });
  }

  // --- XML de Excel -> filas ---------------------------------------------------------------
  function cadenas_(xml) {
    return (xml.match(/<si>[\s\S]*?<\/si>/g) || []).map(function (si) {
      // Texto con formato: varias <t> dentro de <r>; los <rPh> (fonética) no van.
      var limpio = si.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
      return dec_((limpio.match(/<t[^>]*>[^<]*<\/t>/g) || []).map(function (t) { return t.replace(/<[^>]+>/g, ''); }).join(''));
    });
  }
  /**
   * Color de relleno de cada estilo (índice = atributo s de la celda): 'RRGGBB'
   * si es sólido con color explícito, '' si no. Lo usan las fichas de
   * anotaciones (azul = resuelta).
   */
  function estilos_(xml) {
    if (!xml) return [];
    var fills = [];
    var fillsXml = (xml.match(/<fills[^>]*>([\s\S]*?)<\/fills>/) || [])[1] || '';
    (fillsXml.match(/<fill\/>|<fill>[\s\S]*?<\/fill>/g) || []).forEach(function (f) {
      var rgb = (f.match(/<fgColor [^>]*rgb="([0-9A-Fa-f]{6,8})"/) || [])[1] || '';
      fills.push(/patternType="solid"/.test(f) && rgb ? rgb.slice(-6).toUpperCase() : '');
    });
    var xfs = (xml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || '';
    return (xfs.match(/<xf [^>]*?(\/>|>[\s\S]*?<\/xf>)/g) || []).map(function (x) {
      return fills[Number((x.match(/ fillId="(\d+)"/) || [])[1] || 0)] || '';
    });
  }
  function filas_(xml, ss, est) {
    var filas = [], colores = est ? [] : null;
    var reFila = /<row [^>]*?(\/>|>[\s\S]*?<\/row>)/g, m;
    while ((m = reFila.exec(xml))) {
      var r = m[0];
      var num = Number((r.match(/^<row [^>]*?r="(\d+)"/) || [])[1] || (filas.length + 1));
      var fila = [];
      var celdas = r.match(/<c [^>]*?(\/>|>[\s\S]*?<\/c>)/g) || [];
      for (var i = 0; i < celdas.length; i++) {
        var c = celdas[i];
        var ref = (c.match(/ r="([A-Z]+)\d+"/) || [])[1];
        if (!ref) continue;
        var t = (c.match(/ t="([^"]*)"/) || [])[1];
        var v = (c.match(/<v>([^<]*)<\/v>/) || [])[1];
        var val;
        if (t === 's') val = ss[Number(v)];
        else if (t === 'inlineStr') val = dec_((c.match(/<t[^>]*>([^<]*)<\/t>/) || [])[1] || '');
        else val = v === undefined ? '' : dec_(v);
        if (val !== undefined && val !== '') {
          fila[colNum_(ref)] = String(val);
          if (est) {
            var color = est[Number((c.match(/ s="(\d+)"/) || [])[1] || 0)];
            if (color && color !== 'FFFFFF') (colores[num - 1] = colores[num - 1] || {})[colNum_(ref)] = color;
          }
        }
      }
      filas[num - 1] = fila;
    }
    for (var j = 0; j < filas.length; j++) if (!filas[j]) filas[j] = [];
    return { filas: filas, colores: colores };
  }

  /**
   * @param {File|Blob|ArrayBuffer} fuente
   * @param {{ hojas?: function(nombre):boolean, colores?: function(nombre):boolean }} opciones
   *   filtro de hojas a leer; en las hojas donde `colores` dice true, cada hoja
   *   trae también `colores`: [fila][columna] = 'RRGGBB' (solo celdas con valor y relleno)
   */
  function leer(fuente, opciones) {
    opciones = opciones || {};
    var bufP = fuente instanceof ArrayBuffer ? Promise.resolve(fuente) : fuente.arrayBuffer();
    return bufP.then(function (buf) {
      var mapa = entradas_(buf);
      return Promise.all([
        leerEntrada_(buf, mapa, 'xl/sharedStrings.xml'),
        leerEntrada_(buf, mapa, 'xl/workbook.xml'),
        leerEntrada_(buf, mapa, 'xl/_rels/workbook.xml.rels'),
        opciones.colores ? leerEntrada_(buf, mapa, 'xl/styles.xml') : Promise.resolve('')
      ]).then(function (base) {
        var ss = cadenas_(base[0]), wb = base[1], rels = base[2], est = opciones.colores ? estilos_(base[3]) : null;
        var hojas = [], re = /<sheet [^>]*>/g, m;
        while ((m = re.exec(wb))) {
          var nombre = dec_((m[0].match(/ name="([^"]*)"/) || [])[1] || '');
          var rid = (m[0].match(/ r:id="([^"]*)"/) || [])[1] || '';
          var rel = rels.match(new RegExp('<Relationship [^>]*Id="' + rid + '"[^>]*>')) || [];
          var destino = ((rel[0] || '').match(/Target="([^"]*)"/) || [])[1] || '';
          if (!opciones.hojas || opciones.hojas(nombre)) hojas.push({ nombre: nombre, ruta: destino.replace(/^\/?(xl\/)?/, 'xl/') });
        }
        // De a una: una hoja grande descomprimida pesa decenas de MB en memoria.
        var salida = [];
        return hojas.reduce(function (p, h) {
          return p.then(function () {
            return leerEntrada_(buf, mapa, h.ruta).then(function (xml) {
              var r = filas_(xml, ss, est && opciones.colores(h.nombre) ? est : null);
              var hoja = { hoja: h.nombre, filas: r.filas };
              if (r.colores) hoja.colores = r.colores;
              salida.push(hoja);
            });
          });
        }, Promise.resolve()).then(function () { return salida; });
      });
    });
  }

  var api = { leer: leer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.SigsoLectorXlsx = api;
})(typeof window !== 'undefined' ? window : this);
