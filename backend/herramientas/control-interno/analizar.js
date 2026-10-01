// Analiza las planillas reales y propone las columnas de cada matriz.
const fs = require('fs');
const P = require('../../logica/controlInternoPlanillas.js');
const SPECS = require('./specs.js');
const libros = [0, 1, 2, 3, 4, 5, 6].map((i) => JSON.parse(fs.readFileSync(__dirname + '/cache/' + i + '.json', 'utf8')));

const ROL_CLIENTE = new Set(['EMPRESA', 'EMPRESAS', 'LISTADO EMPRESAS', 'NOMBRE EMPRESA', 'ACUSE DE RECIBO', 'CLIENTES']);
const ROL_RESP = /^(QUIEN REALIZA|NOMBRE QUIEN REALIZA|RESPONSABLE|QUIEN LO CONTACTA|QUIEN VERIFICA|QUIEN REVIZA|QUIEN REALIZA CARGA DE (RLE|LRE))$/;

function slug(clave) {
  return P.n_(clave).toLowerCase()
    .replace(/\b(de|del|la|las|el|los|en|a|al|y|o|que|se|por|para|con)\b/g, ' ')
    .replace(/\s+/g, '_').replace(/^_|_$/g, '').slice(0, 48).replace(/_$/, '');
}
function filasNoVacias(filas, desde) {
  const out = [];
  for (let i = desde; i < filas.length; i++) {
    const f = filas[i] || [];
    if (f.some((v) => P.vacio_(v) !== '')) out.push({ i, f });
  }
  return out;
}
function hojasDe(spec) {
  const libro = libros[spec.libro];
  const nombres = libro.hojas.map((h) => h.hoja);
  if (spec.hojas === 'MES') {
    const per = P.periodosDeHojas_(nombres);
    return libro.hojas.filter((h) => per[h.hoja] || /^CONVENIOS$/.test(P.n_(h.hoja))).map((h) => ({ h, periodo: per[h.hoja] || '' }))
      .concat((spec.extras || []).map((x) => ({ h: libro.hojas.find((y) => y.hoja === x), periodo: 'POR_FILA' })).filter((x) => x.h));
  }
  return (spec.hojas || []).map((x) => ({ h: libro.hojas.find((y) => y.hoja === x), periodo: '' })).filter((x) => x.h);
}

const salida = [];
for (const spec of SPECS) {
  if (spec.especial) { salida.push(Object.assign({}, spec, { columnas: [], hojasLeidas: [] })); continue; }
  const semillas = new Set((spec.semillas || []).map(P.n_));
  const cols = new Map(); // clave -> info
  const orden = [];
  const hojasLeidas = [];
  for (const { h, periodo } of hojasDe(spec)) {
    let iEnc, defs;
    if (spec.sinEncabezado) {
      iEnc = -1;
      defs = Object.keys(spec.sinEncabezado).map((c) => ({ col: Number(c), clave: spec.sinEncabezado[c], etiqueta: spec.sinEncabezado[c], grupo: '' }));
    } else {
      iEnc = spec.depto === 'RRHH' ? P.filaEncabezadoPorTexto_(h.filas) : P.filaEncabezado_(h.filas, semillas, 2);
      if (iEnc === -1) { hojasLeidas.push({ hoja: h.hoja, periodo, omitida: 'sin encabezado' }); continue; }
      defs = P.columnasDeEncabezado_(h.filas[iEnc], spec.dosNiveles ? h.filas[iEnc - 1] : null, spec.lectura).filter((d) => d.clave !== spec.periodoPorFila);
    }
    // Columna de cliente sin nombre (Facturación 2023: la B vacía).
    if (!defs.some((d) => ROL_CLIENTE.has(d.clave))) {
      const fEnc = h.filas[iEnc] || [];
      for (let j = 0; j < 4; j++) if (P.vacio_(fEnc[j]) === '' && filasNoVacias(h.filas, iEnc + 1).slice(0, 20).filter((x) => P.vacio_(x.f[j]) !== '').length > 5) { defs.unshift({ col: j, clave: 'EMPRESA', etiqueta: 'EMPRESA', grupo: '' }); break; }
    }
    const datos = filasNoVacias(h.filas, iEnc + 1);
    hojasLeidas.push({ hoja: h.hoja, periodo, filaEnc: iEnc + 1, filas: datos.length, columnas: defs.length });
    // orden: las claves nuevas se insertan después de la anterior conocida
    let prev = null;
    defs.forEach((d) => {
      if (!cols.has(d.clave)) {
        cols.set(d.clave, { clave: d.clave, etiqueta: d.etiqueta, grupo: d.grupo, valores: [], hojas: 0, primeraHoja: h.hoja });
        const at = prev === null ? 0 : orden.indexOf(prev) + 1;
        orden.splice(at, 0, d.clave);
      }
      const c = cols.get(d.clave);
      c.hojas++;
      datos.forEach((x) => { const v = P.vacio_(x.f[d.col]); if (v !== '') c.valores.push(v); });
      prev = d.clave;
    });
  }
  const primera = hojasLeidas.find((x) => !x.omitida);
  const columnas = orden.map((k) => {
    const c = cols.get(k);
    const vals = c.valores;
    const nv = vals.length || 1;
    const fechas = vals.filter((v) => /^\d{5}(\.\d+)?$/.test(v) && Number(v) > 30000 && Number(v) < 60000 || /^\d{4}-\d{2}-\d{2}/.test(v)).length;
    const nums = vals.filter((v) => P.numero_(v) !== '').length;
    const horas = vals.filter((v) => /^0\.\d+$/.test(v) || /^\d{1,2}:\d{2}/.test(v)).length;
    const largo = vals.reduce((s, v) => s + v.length, 0) / nv;
    let tipo = 'texto';
    const e = k;
    if (/\bHORA\b/.test(e) && horas / nv > 0.5) tipo = 'hora';
    else if (fechas / nv >= 0.6 || (/FECHA|RECEPCION|ENVIO|VENCIMIENTO|DIGITALIZACION|ACTUALIZACION|INICIO|TERMINO|F PAGO|CARGA/.test(e) && fechas / nv >= 0.3)) tipo = 'fecha';
    else if (nums / nv >= 0.6 && /MONTO|VALOR|PIE|DEUDA|TOTAL|IUSC|IMPUESTO|RETENCION|PPM|INTERES|SUELDO|GRATIFICACION|COLACION|MOVILIZACION|DESGASTE|IMPONIBLE|APORTE|AFP|ISAPRE|FONASA|MUTUAL|ACHS|ISL|CAJA|CARGAS|SEGURO|PRESTAMO|3%|MULTA|PAGAR|PAGO|HABITAT|CAPITAL|CUPRUM|PROVIDA|MODELO|PLAN VITAL|BANMEDICA|COLMENA|CONSALUD|CRUZ BLANCA|MASVIDA|MAS VIDA|VIDA TRES|IPS|AFC/.test(e)) tipo = 'monto';
    else if (nums / nv >= 0.7 && vals.length) tipo = 'numero';
    else if (largo > 70) tipo = 'texto_largo';
    // Sugerencias: textos cortos que se repiten.
    let sugerencias;
    if (tipo === 'texto') {
      const cuenta = {};
      vals.forEach((v) => { const t = v.trim().toUpperCase(); if (t.length <= 40) cuenta[t] = (cuenta[t] || 0) + 1; });
      const distintos = Object.keys(cuenta).filter((t) => cuenta[t] >= 2).sort((a, b) => cuenta[b] - cuenta[a]);
      if (distintos.length && distintos.length <= 25 && vals.length >= 5) sugerencias = distintos.slice(0, 25);
    }
    let rol;
    if (ROL_CLIENTE.has(e) && !spec.sinCliente) rol = 'cliente';
    else if (e === 'RUT' && spec.depto === 'CONTABILIDAD') rol = 'rut';
    else if (ROL_RESP.test(e) && !cols.get(k).rolVisto) rol = 'responsable';
    const clave = P.esColumnaDeClave_(e) ? null : slug(k);
    return {
      clave, nombre: k, etiqueta: c.etiqueta, grupo: c.grupo || '', tipo, rol, sugerencias,
      actual: primera ? c.primeraHoja === primera.hoja || cols.get(k).hojas > 0 && hojasLeidas[0].hoja === c.primeraHoja : true,
      hojas: c.hojas, con_datos: vals.length, excluida: clave === null ? 'clave/usuario' : undefined
    };
  });
  // Solo el primer "QUIÉN REALIZA" es el responsable del registro.
  let visto = false;
  columnas.forEach((c) => { if (c.rol === 'responsable') { if (visto) delete c.rol; visto = true; } });
  // claves únicas
  const usadas = {};
  columnas.forEach((c) => { if (!c.clave) return; if (usadas[c.clave]) { usadas[c.clave]++; c.clave += '_' + usadas[c.clave]; } else usadas[c.clave] = 1; });
  salida.push(Object.assign({}, spec, { columnas, hojasLeidas, filasTotal: hojasLeidas.reduce((s, x) => s + (x.filas || 0), 0) }));
}
fs.writeFileSync(__dirname + '/analisis.json', JSON.stringify(salida, null, 1));
for (const m of salida) {
  console.log('\n## ' + m.clave + ' (' + m.depto + ') filas=' + (m.filasTotal || 0) + ' hojas=' + m.hojasLeidas.length + (m.hojasLeidas.filter((x) => x.omitida).length ? ' OMITIDAS=' + m.hojasLeidas.filter((x) => x.omitida).map((x) => x.hoja).join(',') : ''));
  console.log('   ' + m.columnas.map((c) => (c.excluida ? '✗' : '') + c.nombre + ':' + c.tipo + (c.rol ? '[' + c.rol + ']' : '') + (c.actual ? '' : '(antigua)') + (c.sugerencias ? '{' + c.sugerencias.length + '}' : '')).join(' | '));
}
