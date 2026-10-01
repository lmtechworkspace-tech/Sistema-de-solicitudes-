// Genera backend/logica/controlInternoColumnas.js desde analisis.json (+ columnas a mano de las hojas especiales).
const fs = require('fs');
const A = JSON.parse(fs.readFileSync(__dirname + '/analisis.json', 'utf8'));

const ESPECIALES = {
  NOTIFICACIONES_SII: [
    { clave: 'empresa', etiqueta: 'EMPRESA', tipo: 'texto', rol: 'cliente', nombres: ['EMPRESA'] },
    { clave: 'tipo', etiqueta: 'TIPO', tipo: 'texto', nombres: ['TIPO'], sugerencias: ['NOTIFICACIÓN', 'ANOTACIÓN'] },
    { clave: 'fecha', etiqueta: 'FECHA', tipo: 'fecha', nombres: ['FECHA'] },
    { clave: 'detalle', etiqueta: 'DETALLE', tipo: 'texto_largo', nombres: ['DETALLE'] },
    { clave: 'realizado_por', etiqueta: 'REALIZADO POR', tipo: 'texto', rol: 'responsable', nombres: ['REALIZADO POR'] },
    { clave: 'ultima_actualizacion', etiqueta: 'ÚLTIMA ACTUALIZACIÓN', tipo: 'fecha', nombres: ['ULTIMA ACTUALIZACION'] }
  ],
  SUBSANACION_DOMICILIO: [
    { clave: 'seccion', etiqueta: 'SECCIÓN', tipo: 'texto', nombres: ['SECCION'] },
    { clave: 'n', etiqueta: 'N°', tipo: 'numero', nombres: ['N'] },
    { clave: 'empresa', etiqueta: 'EMPRESA', tipo: 'texto', rol: 'cliente', nombres: ['EMPRESA'] },
    { clave: 'domicilio', etiqueta: 'DOMICILIO', tipo: 'texto', nombres: ['DOMICILIO'] }
  ].concat([1, 2, 3, 4, 5].flatMap((i) => [
    { clave: 'peticion_' + i + '_fecha', etiqueta: 'FECHA', grupo: 'PETICIÓN ' + i, tipo: 'fecha', nombres: ['PETICION ' + i + ' / FECHA'] },
    { clave: 'peticion_' + i + '_folio', etiqueta: 'FOLIO', grupo: 'PETICIÓN ' + i, tipo: 'texto', nombres: ['PETICION ' + i + ' / FOLIO'] }
  ]))
};

let out = "'use strict';\n\n/**\n * controlInternoColumnas.js — las columnas de cada matriz de Control interno,\n" +
  ' * en el MISMO orden y con los MISMOS nombres que las planillas del Drive.\n *\n' +
  ' * GENERADO el 2026-10-01 leyendo las 7 planillas reales (2022-2026) con\n' +
  ' * controlInternoPlanillas.js; se puede ajustar a mano.\n *\n' +
  ' *  - nombres: cómo se llamó la columna en cada versión de la planilla (para importar);\n' +
  ' *  - antigua: solo existe en planillas viejas (se muestra si el mes tiene datos);\n' +
  ' *  - rol: cliente / rut / responsable = se guarda en el propio registro;\n' +
  ' *  - grupo: encabezado de dos niveles (Contabilización, Subsanación);\n' +
  ' *  - sugerencias: los valores que más se repiten en la planilla (se ofrecen al escribir).\n' +
  ' * Las columnas de usuarios y claves de plataformas NO están: nunca se guardan.\n */\n\nmodule.exports = {\n';
const lineas = [];
for (const m of A) {
  let cols = ESPECIALES[m.clave];
  if (!cols) {
    cols = m.columnas.filter((c) => c.clave).map((c) => {
      const o = { clave: c.clave, etiqueta: c.etiqueta.replace(/\s+/g, ' ').trim(), tipo: c.tipo, nombres: [c.nombre] };
      if (c.rol) o.rol = c.rol;
      if (c.grupo) o.grupo = c.grupo;
      if (!c.actual) o.antigua = true;
      if (c.sugerencias && c.sugerencias.length) o.sugerencias = c.sugerencias;
      return o;
    });
    // Los nombres viejos que el alias unió también se aceptan al importar.
    const alias = (m.lectura && m.lectura.alias) || {};
    Object.keys(alias).forEach((viejo) => { const c = cols.find((x) => x.nombres[0] === alias[viejo]); if (c && c.nombres.indexOf(viejo) === -1) c.nombres.push(viejo); });
  }
  lineas.push('  ' + m.clave + ': [\n' + cols.map((c) => '    ' + JSON.stringify(c)).join(',\n') + '\n  ]');
}
out += lineas.join(',\n') + '\n};\n';
fs.writeFileSync(__dirname + '/../../logica/controlInternoColumnas.js', out);
console.log('ok', (out.length / 1024).toFixed(0) + ' KB', A.length, 'matrices');
