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

test('proyecto v2: decisión sugerida, alertas en un bloque, real vs plan y nada de "(s)"', () => {
  const { R, U } = DocV2.piezas();
  const ReporteProyecto = require('../logica/reporteProyecto');
  const detalle = {
    proyecto: { nombre: 'Migración', codigo: 'P-1', estado: 'ACTIVO' }, salud: 'critico', salud_penalizacion: 40,
    avance_pct: 30, avance_esperado_pct: 50,
    requiere_atencion: { tareas_vencidas: 2, tareas_criticas_atrasadas: 1, tareas_bloqueadas: 1, hitos_atrasados: 1, riesgos_altos: 1 },
    hitos: [{ nombre: 'H1 <inicio>', fecha_objetivo: '2020-01-01T00:00:00.000Z', estado: 'PENDIENTE', avance_pct: 40 }],
    riesgos: [{ descripcion: 'Proveedor cae', nivel: 'ALTA', estado: 'ABIERTO', responsable_email: 'ana@x.cl', mitigacion: '' }]
  };
  const tareas = [
    { actividad_id: 't1', titulo: 'Crítica', prioridad: 'P1', estado: 'EN_CURSO', semaforo: 'atrasada', fecha_compromiso: '2020-01-05', responsable_email: 'ana@x.cl' },
    { actividad_id: 't2', titulo: 'Trabada', prioridad: 'P3', estado: 'BLOQUEADA', semaforo: 'bloqueada', bloqueo_motivo: 'Sin acceso', responsable_email: 'bruno@x.cl' }
  ];
  const rend = { cumplimiento_tareas: { entregadas: 4, a_tiempo: 3 }, plan_seguimiento: [{ actividad_id: 't1', avance_real_pct: 10, avance_esperado_pct: 80, desviacion_pp: -70, estado_plazo: 'ATRASADA' }] };
  const html = ReporteProyecto.cuerpoProyectoV2_(detalle, tareas, rend, [], { 'ana@x.cl': 'Ana Pérez' }, R, U, DocV2.fecha_);
  assert.match(html, /Decisión sugerida/);
  assert.match(html, /Revisar la mitigación de los riesgos altos abiertos/);
  assert.match(html, /Tareas P1\/P2 atrasadas/);
  assert.match(html, /Sin acceso/);
  assert.match(html, /sin plan de mitigación/);
  assert.match(html, /10% · plan 80%/);
  assert.match(html, /−20 pp vs\. lo planificado/);
  assert.ok(html.includes('H1 &lt;inicio&gt;'));
  assert.ok(!/\(s\)/.test(html), 'plurales escritos, no "(s)"');
  assert.match(html, /Ana Pérez/);
});

test('orden de trabajo v2: marca de SIGSO sin empresa fija, enlaces clicables, nombres y fechas legibles', () => {
  const { U, R } = DocV2.piezas();
  const OT = require('../logica/ordenTrabajo');
  const vista = {
    observacionesGenerales: 'Ojo <con> esto',
    items: [{ indice: 1, total: 1, tipo: 'Error / Bug', titulo: 'Filtro <roto>', prioridad: 'P1', estadoLabel: 'Recibida',
      campos: { descripcion: 'Línea 1\nLínea 2', contexto: '', resultadoEsperado: 'Que filtre' },
      accesos: [['URL principal', { texto: 'https://app.x.cl/a', link: 'https://app.x.cl/a' }], ['Credencial', 'Ver bóveda']],
      detalles: [['Responsable asignado', 'leo@x.cl'], ['Fecha comprometida', '2026-10-15'], ['Observaciones', 'Largo texto']],
      imagenes: [{ nombre: 'captura.png', link: 'https://files.x.cl/c.png' }], documentos: [] }],
    adjuntosGenerales: null
  };
  const html = OT.cuerpoOTV2_(vista, { solicitud: {}, subsolicitudes: [{ estado: 'S02' }] }, { 'leo@x.cl': 'Leonardo' }, U, DocV2.fecha_);
  assert.ok(html.includes('<a href="https://app.x.cl/a">'));
  assert.ok(html.includes('Filtro &lt;roto&gt;') && html.includes('Ojo &lt;con&gt; esto'));
  assert.match(html, /Leonardo/);
  assert.match(html, /15\/10\/2026/);
  assert.match(html, /Referencia de credencial/);
  assert.match(html, /Cómo cerrar esta orden/);
  // Las observaciones van a lo ancho (como campo), no en la grilla de detalles.
  assert.ok(html.indexOf('<h3>Observaciones</h3>') !== -1);
  // La cabecera del documento es de SIGSO, no de una empresa fija.
  const cab = R.cabeceraDocumento({ titulo: 'Orden de trabajo' });
  assert.ok(!/Asesor/i.test(cab));
  assert.match(cab, /Control y Gestión Empresarial/);
});

test('sanitizarHtml: los enlaces http solo sobreviven si el documento lo arma el servidor (opción enlaces)', () => {
  const RP = require('../logica/reportePdf');
  const a = '<a href="https://x.cl">x</a><a href="javascript:alert(1)">y</a>';
  assert.ok(!RP.sanitizarHtml(a).includes('https://x.cl'), 'HTML del cliente: sin enlaces');
  const s = RP.sanitizarHtml(a, { enlaces: true });
  assert.ok(s.includes('href="https://x.cl"'));
  assert.ok(!/javascript:/i.test(s));
});

test('informe configurable v2: solo las secciones elegidas, Gantt en página apaisada con hitos, barras y leyenda', () => {
  const { R, U } = DocV2.piezas();
  const RPy = require('../logica/reporteProyecto');
  const detalle = {
    proyecto: { nombre: 'Migración', codigo: 'P-1', estado: 'ACTIVO', fecha_inicio: '2026-09-01T00:00:00.000Z', lider_email: 'ana@x.cl' },
    salud: 'riesgo', avance_pct: 40, avance_esperado_pct: 50, requiere_atencion: {},
    hitos: [{ hito_id: 'h1', nombre: 'H1 <arranque>', fecha_objetivo: '2026-09-10T00:00:00.000Z', estado: 'PENDIENTE' }], riesgos: []
  };
  const tareas = [{ actividad_id: 't1', titulo: 'Tarea A', estado: 'EN_CURSO', semaforo: 'atrasada', hito_id: 'h1',
    fecha_creacion: '2026-09-01T00:00:00.000Z', fecha_compromiso: '2026-09-12T00:00:00.000Z', responsable_email: 'ana@x.cl' }];
  const config = RPy.normalizarConfig_({ secciones: ['ficha', 'gantt', 'leyenda'] });
  const html = RPy.cuerpoConfiguradoV2_(config, detalle, tareas, {}, [], { 'ana@x.cl': 'Ana Pérez' }, R, U, DocV2.fecha_);
  assert.match(html, /Ficha del proyecto/);
  assert.match(html, /Carta Gantt ejecutiva/);
  assert.ok(!/Riesgos abiertos|Actividad reciente/.test(html), 'solo lo elegido');
  assert.match(html, /class="rp2-apaisada"/);
  // Auditoría 2026-09-29 (etapa 2): el MISMO dibujo de la pantalla (gantt-dibujo.js).
  assert.match(html, /sx2-py-gantt__hito/, 'el rombo del hito');
  assert.match(html, /sx2-py-gantt__barra sx2-tono-critico/, 'la tarea atrasada en rojo');
  assert.match(html, /sx2-py-gantt__fila--grupo/, 'la fila del hito con su barra resumen');
  assert.match(html, /sx2-py-leyenda-gantt/);
  assert.match(html, /class="rp2-gantt-pag"/, 'repartida en páginas con su cabecera');
  assert.ok(html.includes('H1 &lt;arranque&gt;'));
  assert.match(html, /Ana Pérez/);
});
