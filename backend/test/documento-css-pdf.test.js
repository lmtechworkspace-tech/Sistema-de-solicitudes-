'use strict';

/**
 * Los PDF del servidor (documentoV2) reutilizan las hojas de estilo del
 * frontend y toman toda regla cuyas clases aparezcan en el documento. Una
 * regla sin clase propia dentro de @media print (por ejemplo
 * «body > *:not(.mn) { display: none }» del visor de manuales) se colaba y
 * dejaba en blanco todas las órdenes de trabajo e informes (2026-10-06).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const DocV2 = require('../logica/documentoV2');

test('el CSS de un PDF no trae reglas de impresión que oculten el cuerpo', { skip: !DocV2.disponible() && 'sin piezas del frontend' }, () => {
  const html = '<main class="rp2-documento"><header class="rp2-doc sx2-entra"></header><section class="ot2-item"><h2>Ítem</h2></section></main>';
  const css = DocV2.cssPara(html);
  assert.ok(css.length > 1000, 'trae las reglas del documento');
  assert.doesNotMatch(css, /(^|[{},]\s*)body\s*>\s*\*/, 'una regla «body > *» ocultaría el documento al imprimir');
  assert.doesNotMatch(css, /(^|[{},]\s*)(html|body)\s*>\s*\*:not\(/, 'tampoco «html > *:not(…)»');
});
