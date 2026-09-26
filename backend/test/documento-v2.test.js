'use strict';

/**
 * R-3b de la auditoría de reportes: los PDF sin pantalla (Acta, reportes
 * tabulares de Actividades, evidencia por cláusula) se arman en el servidor
 * con los MISMOS archivos del frontend (documentoV2.js). Aquí: que esas
 * piezas cargan y producen HTML/CSS correctos, que cada documento dice lo que
 * debe, y que sin Chromium (o si el v2 falla) se cae a la versión pdfkit.
 * Los que imprimen de verdad se saltan si el equipo no tiene Chromium.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_ } = require('../db/sqliteRepo');
const { asegurarEsquema } = require('../db/schema');
const DocV2 = require('../logica/documentoV2');
const Motor = require('../logica/pdfChromium');
const ReporteAct = require('../logica/reporteActividades');
const Evidencia = require('../logica/evidenciaClausulaSgc');

const hayChromium = Motor.disponible();

test('piezas del frontend cargan en el servidor y escapan el texto', () => {
  const { R, U } = DocV2.piezas();
  assert.equal(typeof R.enUnaLinea, 'function');
  const html = R.enUnaLinea({ estado: 'alerta', frase: 'Hola <b>x</b>', kpis: [{ etiqueta: 'Vencidas', valor: 3, icono: 'alerta', tono: 'critico' }] });
  assert.ok(html.includes('Hola &lt;b&gt;x&lt;/b&gt;'));
  assert.ok(html.includes('sx2-kpi__valor'));
  assert.ok(U.badge('A "b"', 'ok').includes('A &quot;b&quot;'));
});

test('cssPara: trae lo que usa el documento (KPI con su atajo var(), íconos) y nada de la plataforma', () => {
  const { R } = DocV2.piezas();
  const html = '<main class="rp2-documento">' + R.enUnaLinea({ estado: 'ok', frase: 'x', kpis: [{ etiqueta: 'A', valor: 1, icono: 'alerta' }] }) + '</main>';
  const css = DocV2.cssPara(html);
  assert.match(css, /\.sx2-kpi__valor\s*\{[^}]*font:\s*var\(--sx-t-cifra\)/);
  assert.match(css, /\.sigso-ico/);
  assert.ok(!/#gerencia-v2|\.plataforma-sidebar/.test(css), 'no arrastra reglas de la plataforma');
  assert.ok(css.length < 120 * 1024, 'acotado: ' + css.length);
});

test('valoresFinales: barras y arcos con su valor final (en el papel no corre la animación)', () => {
  const h = DocV2.valoresFinales('<span class="sx2-barra__relleno" data-sx-pct="42"></span><circle stroke-dashoffset="100.00" data-sx-arco="58.00"/>');
  assert.ok(h.includes('data-sx-pct="42" style="width:42%"'));
  assert.ok(h.includes('stroke-dashoffset="58.00"'));
});

function acta_() {
  return {
    semana: { desde: '2026-09-21T00:00:00.000Z', hasta: '2026-09-27T23:59:59.999Z' },
    vencidas: [
      { titulo: 'Informe <urgente>', responsable: 'Ana Pérez', responsable_email: 'ana@x.cl', prioridad: 'P1', area: 'RRHH', fecha_compromiso: '2026-09-01' },
      { titulo: 'Otra', responsable: 'ana@x.cl', responsable_email: 'ana@x.cl', prioridad: 'P4', area: '(sin área)', fecha_compromiso: '2026-09-20' }
    ],
    bloqueadas: [{ titulo: 'Trabada', responsable: 'Bruno', responsable_email: 'bruno@x.cl', prioridad: 'P3', area: 'TI', motivo: 'Falta acceso' }],
    reprogramadas_semana: [], vence_semana_entrante: [{ titulo: 'Próxima', responsable: 'Bruno', responsable_email: 'bruno@x.cl', area: 'TI', fecha_compromiso: '2026-09-29' }]
  };
}

test('acta v2: agrupa por persona (nombre o correo, misma persona), cuenta P1/P2 y deja espacio para el acuerdo', () => {
  const { R, U } = DocV2.piezas();
  const html = ReporteAct.cuerpoActaV2_(acta_(), { 'ana@x.cl': 'Ana Pérez' }, R, U, DocV2.fecha_);
  assert.match(html, /2 actividades vencidas \(1 P1\/P2\), 1 bloqueada/);
  // Ana aparece UNA vez en lo que requiere decisión, con sus 2 vencidas.
  const alertas = html.slice(html.indexOf('rp2-alertas'), html.indexOf('Para planificar'));
  assert.equal((alertas.match(/Ana Pérez/g) || []).length, 1);
  assert.match(alertas, /2 vencidas/);
  assert.match(html, /Falta acceso/);
  assert.ok(html.includes('Informe &lt;urgente&gt;'));
  assert.ok((html.match(/rp2-escribir/g) || []).length >= 6, 'acuerdo y nueva fecha por punto, más asistentes');
  assert.ok(!html.includes('(sin área)'));
});

test('acta v2: semana sin nada → estado "Sin actividad", sin inventar alertas', () => {
  const { R, U } = DocV2.piezas();
  const html = ReporteAct.cuerpoActaV2_({ vencidas: [], bloqueadas: [], reprogramadas_semana: [], vence_semana_entrante: [] }, {}, R, U, DocV2.fecha_);
  assert.match(html, /Sin actividad/);
  assert.match(html, /reunión corta/);
});

test('evidencia v2: lo que falta como alerta y registros ordenados por tipo', () => {
  const { R, U } = DocV2.piezas();
  const html = Evidencia.cuerpoEvidenciaV2_({
    codigo: '7.5', titulo: 'Información documentada', estado: 'PARCIAL', resumen: '3 documentos.', nota: 'Faltan emisores.',
    evidencia: [{ tipo: 'Externo', descripcion: 'B', fecha: '2027-01-01' }, { tipo: 'Documento', descripcion: 'A', fecha: '2026-01-01', responsable: 'ana@x.cl' }],
    exclusiones: []
  }, { 'ana@x.cl': 'Ana Pérez' }, R, U, DocV2.fecha_);
  assert.match(html, /Para cerrar la cláusula 7\.5/);
  assert.match(html, /Faltan emisores/);
  assert.ok(html.indexOf('>A<') < html.indexOf('>B<'), 'por tipo, no por fecha');
  assert.match(html, /Ana Pérez/);
});

function dbActividades_() {
  const db = abrirDb_(':memory:');
  asegurarEsquema(db);
  return db;
}

test('si el diseño v2 falla, el Acta sale igual con pdfkit (nunca se queda sin PDF)', async () => {
  const orig = { disponible: DocV2.disponible, aPdf: DocV2.aPdf };
  DocV2.disponible = () => true;
  DocV2.aPdf = async () => { throw new Error('Chromium roto'); };
  const errorOriginal = console.error;
  console.error = () => {};
  try {
    const r = await ReporteAct.descargarActa(dbActividades_(), {}, { email: 'adm@x.cl', rol: 'ADM' });
    assert.equal(Buffer.from(r.pdf_base64, 'base64').slice(0, 5).toString(), '%PDF-');
    assert.match(r.filename, /^SIGSO-acta-reunion-/, 'versión pdfkit');
  } finally { Object.assign(DocV2, orig); console.error = errorOriginal; }
});

test('Acta real con Chromium: PDF v2', { skip: !hayChromium && 'sin Chromium en este equipo' }, async () => {
  try {
    const r = await ReporteAct.descargarActa(dbActividades_(), {}, { email: 'adm@x.cl', rol: 'ADM' });
    assert.equal(Buffer.from(r.pdf_base64, 'base64').slice(0, 5).toString(), '%PDF-');
    assert.match(r.filename, /^sigso-acta-reunion-\d{4}-\d{2}-\d{2}\.pdf$/);
  } finally { await Motor.cerrar(); }
});

test('el despliegue lleva al VPS cada pieza del frontend que usa documentoV2 (y la vigila)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wf = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'deploy-backend.yml'), 'utf8');
  const fuente = fs.readFileSync(path.join(__dirname, '..', 'logica', 'documentoV2.js'), 'utf8');
  const scripts = (fuente.match(/const SCRIPTS = \[([^\]]*)\]/) || [])[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1));
  scripts.concat(['plataforma.html']).forEach((r) => {
    assert.ok(wf.split(/\s+/).includes('frontend/' + r), 'se sincroniza ' + r);
    assert.ok(wf.includes('- "frontend/' + r + '"'), 'dispara el despliegue: ' + r);
  });
  assert.ok(wf.includes('frontend/css/ ') && wf.includes('- "frontend/css/**"'));
});
