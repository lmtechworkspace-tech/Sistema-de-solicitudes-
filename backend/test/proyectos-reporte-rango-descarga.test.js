'use strict';

/**
 * v15.5 (frontend): el selector de rango de la carta (Semana / 2 semanas /
 * Mes / Todo el proyecto) era puramente cosmético para la pantalla -- el PDF
 * nunca se enteraba de qué ventana tenías elegida, y cada sección del
 * backend calculaba la suya por su cuenta. Un usuario podía tener "Todo el
 * proyecto" elegido en pantalla (mostrando "07/08/2026–30/12/2026") y bajar
 * un PDF cuya Carta Gantt o Ejecución día a día usaran una ventana distinta
 * -- justo la confusión que se reportó.
 *
 * Ahora, con un rango puntual (semana/quincena/mes) SÍ se manda
 * `config.rango` -- el PDF muestra exactamente ese período. Con "todo el
 * proyecto" no se manda rango -- cada sección usa su propio cálculo de
 * rango completo (ya corregido para anclar en el inicio del proyecto donde
 * corresponde).
 *
 * El dibujo de la carta mide el DOM y vive en el navegador (mismo criterio
 * que proyectos-gantt-conectores.test.js / proyectos-gantt-barra-inicio.
 * test.js): no se puede ejercitar completo desde el sandbox, así que esto
 * fija la invariante por fuente + el contrato de la función aislado.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const JS = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend/js/proyectos.js'), 'utf8');

test('existe rangoDescargaActual_ y descargarReporteCronograma_ lo usa', () => {
  assert.match(JS, /function rangoDescargaActual_\(\)/, 'falta la función');
  const i = JS.indexOf('function descargarReporteCronograma_');
  const cuerpo = JS.slice(i, JS.indexOf('\n  }', i));
  assert.match(cuerpo, /var rangoActual = rangoDescargaActual_\(\);/, 'debe llamar a rangoDescargaActual_');
  assert.match(cuerpo, /if \(rangoActual\) config\.rango = rangoActual;/, 'debe mandar config.rango cuando hay un rango puntual');
});

test('el botón de descarga distingue "del período" de "de todo el proyecto"', () => {
  assert.match(JS, /esTodo \? 'Descargar reporte de todo el proyecto \(PDF\)' : 'Descargar reporte del período \(PDF\)'/,
    'el texto del botón debe reflejar qué va a bajar');
});

// --- Contrato de rangoDescargaActual_, ejecutado como función pura ---------
// Reimplementación exacta para probar el contrato sin levantar todo
// proyectos.js (que depende de document/window).

function claveDia_(anio, mes, dia) {
  const p2 = (n) => (n < 10 ? '0' + n : '' + n);
  return anio + '-' + p2(mes + 1) + '-' + p2(dia);
}
const DED_RANGO_DIAS = { semana: 7, quincena: 14, mes: 30 };
function rangoDescargaActual_(dedRango_, dedicacionAncla_) {
  if (dedRango_ === 'todo') return null;
  const n = DED_RANGO_DIAS[dedRango_] || 14;
  const ancla = dedicacionAncla_ || new Date();
  const hasta = new Date(ancla.getFullYear(), ancla.getMonth(), ancla.getDate());
  const desde = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate() - (n - 1));
  return {
    desde: claveDia_(desde.getFullYear(), desde.getMonth(), desde.getDate()),
    hasta: claveDia_(hasta.getFullYear(), hasta.getMonth(), hasta.getDate())
  };
}

test('"todo el proyecto" no manda rango -- cada sección del backend decide su propia ventana completa', () => {
  assert.equal(rangoDescargaActual_('todo', new Date(2026, 8, 7)), null);
});

test('"semana" manda exactamente los 7 días terminados en el ancla', () => {
  const r = rangoDescargaActual_('semana', new Date(2026, 8, 7)); // 07-sep-2026
  assert.deepEqual(r, { desde: '2026-09-01', hasta: '2026-09-07' });
});

test('"mes" manda los 30 días terminados en el ancla', () => {
  const r = rangoDescargaActual_('mes', new Date(2026, 8, 7));
  assert.deepEqual(r, { desde: '2026-08-09', hasta: '2026-09-07' });
});

// --- A1: el reporte por defecto incluye el Resumen ejecutivo ---------------
// El botón "Descargar reporte" arma un set fijo (CRONOGRAMA_REPORTE_SECCIONES_).
// Antes NO incluía 'narrativa', así que el resumen que responde "cómo va / qué
// está mal / qué hacer" solo aparecía entrando a "Configurar informe".

test('A1: el set por defecto del botón "Descargar reporte" incluye la narrativa, de primero', () => {
  const m = JS.match(/CRONOGRAMA_REPORTE_SECCIONES_ = \[([\s\S]*?)\]/);
  assert.ok(m, 'no se encontró CRONOGRAMA_REPORTE_SECCIONES_');
  const set = m[1];
  assert.match(set, /'narrativa'/, 'el resumen ejecutivo debe estar en el set por defecto');
  // Va antes que las tablas de detalle (después de portada).
  assert.ok(set.indexOf("'narrativa'") < set.indexOf("'gantt'"), 'la narrativa va antes de la Carta Gantt');
  assert.ok(set.indexOf("'portada'") < set.indexOf("'narrativa'"), 'la narrativa va tras la portada');
});
