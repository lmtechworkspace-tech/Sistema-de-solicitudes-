const fs = require('fs');
const L0 = require('../../../frontend/js/lector-xlsx.js');
const L = L0;
// Carpeta con las 7 planillas: node volcar.js <carpeta>
const D = (process.argv[2] || '.').replace(/\\/g, '/').replace(/\/?$/, '/');
const archivos = ["control de matrices (2).xlsx","MATRIZ ACUSE DE RECIBO_ (1).xlsx","SITUACIÓN CLIENTES ANOTACIONES, NOTIFICACIONES Y SUBSANACIONES 2025 (1).xlsx","MATRIZ CONTABILIZACION MENSUAL_ (2).xlsx","MATRIZ INFORME Y PAGO DE IVA_ (2).xlsx","SITUACIÓN CLIENTES CONVENIOS Y POSTERGACIONES 2025 (2).xlsx","MATRIZ FACTURACION MENSUAL_ (3).xlsx"];
(async () => {
  for (const [i, a] of archivos.entries()) {
    const buf = fs.readFileSync(D + a);
    const t0 = Date.now();
    const hojas = await L.leer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    fs.mkdirSync(__dirname + '/cache', { recursive: true });
    fs.writeFileSync(__dirname + '/cache/' + i + '.json', JSON.stringify({ archivo: a, hojas }));
    console.log(i, a, hojas.length, 'hojas', Date.now() - t0, 'ms');
  }
})().catch(e => { console.error(e); process.exit(1); });
