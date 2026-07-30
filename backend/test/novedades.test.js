'use strict';

/**
 * v6.5: modulo Novedades (Novedades.gs).
 *
 * Lo que estos tests protegen, por orden de importancia:
 *
 *  1. QUIEN PUEDE PUBLICAR se valida en el SERVIDOR contra
 *     CAT_AREAS.responsable_email, nunca confiando en que area_id manda el
 *     cliente. Un responsable de un area no puede publicar en otra, ni en
 *     "general" (exclusivo de ADM).
 *  2. EL ACUSE se deriva SIEMPRE de contexto.email: no existe ningun
 *     parametro para marcar "leido" a nombre de otra persona.
 *  3. El adjunto se valida por FIRMA BINARIA (solo PDF real, no cualquier
 *     archivo renombrado a .pdf).
 *  4. El area es ETIQUETA, no audiencia: todo publicado aparece en el feed
 *     de cualquier identidad autenticada.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

// PDF minimo real (firma valida) y un PNG (para probar el rechazo por tipo).
const PDF_MINIMO = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>';
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function b64(texto) {
  return Buffer.from(texto, 'binary').toString('base64');
}

function cargar() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'root-folder-id' }
  });
  seedSheet(ctx, 'CAT_AREAS', ctx.COLUMNAS.CAT_AREAS);
  seedSheet(ctx, 'NOVEDADES', ctx.COLUMNAS.NOVEDADES);
  seedSheet(ctx, 'NOVEDADES_LECTURAS', ctx.COLUMNAS.NOVEDADES_LECTURAS);
  return ctx;
}

function agregar(ctx, hoja, obj) {
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName(hoja)
    .appendRow(ctx.COLUMNAS[hoja].map((c) => (obj[c] !== undefined ? obj[c] : '')));
}

function seedArea(ctx, overrides) {
  const base = Object.assign(
    { area_id: 'RRHH', nombre: 'Recursos Humanos', responsable_email: 'vanessa@rld.cl', activo: true },
    overrides
  );
  agregar(ctx, 'CAT_AREAS', base);
  return base;
}

function ctxResponsable(email) {
  return { email: email || 'vanessa@rld.cl', rol: 'ANA' };
}
function ctxAdm(email) {
  return { email: email || 'adm@rld.cl', rol: 'ADM' };
}
function ctxCualquiera(email) {
  return { email: email || 'juan@homepymes.cl', rol: 'DEV' };
}

function publicarBase_(overrides) {
  return Object.assign({
    tipo: 'LEY', titulo: 'Nueva ley de subcontratación',
    resumen: 'Cambia el plazo de finiquito para obras.', area_id: 'RRHH'
  }, overrides);
}

// --- 1-2: publicar, permisos por area -------------------------------------

test('1. el responsable de un area puede publicar en SU area', () => {
  const ctx = cargar();
  seedArea(ctx);
  const res = toPlain(ctx.Novedades.publicar(publicarBase_(), ctxResponsable()));
  assert.ok(res.novedad_id);
  const fila = ctx.leerFilas_('NOVEDADES')[0];
  assert.equal(fila.area_id, 'RRHH');
  assert.equal(fila.area_nombre, 'Recursos Humanos');
  assert.equal(fila.autor_email, 'vanessa@rld.cl');
});

test('2. SEGURIDAD: no puede publicar en un area de la que NO es responsable', () => {
  const ctx = cargar();
  seedArea(ctx, { area_id: 'RRHH', responsable_email: 'vanessa@rld.cl' });
  seedArea(ctx, { area_id: 'CONTABILIDAD', responsable_email: 'barbara@rld.cl' });

  // Vanessa intenta publicar en CONTABILIDAD, que no es la suya.
  const res = toPlain(ctx.Novedades.publicar(
    publicarBase_({ area_id: 'CONTABILIDAD' }), ctxResponsable('vanessa@rld.cl')
  ));
  assert.equal(res._forbidden, true);
  assert.equal(ctx.leerFilas_('NOVEDADES').length, 0);
});

test('2b. SEGURIDAD: "general" (sin area) es exclusivo de ADM', () => {
  const ctx = cargar();
  seedArea(ctx);
  const res = toPlain(ctx.Novedades.publicar(
    publicarBase_({ area_id: '' }), ctxResponsable()
  ));
  assert.equal(res._forbidden, true);

  const admOk = toPlain(ctx.Novedades.publicar(
    publicarBase_({ area_id: '' }), ctxAdm()
  ));
  assert.ok(admOk.novedad_id);
});

test('3. ADM puede publicar en cualquier area', () => {
  const ctx = cargar();
  seedArea(ctx, { area_id: 'RRHH', responsable_email: 'vanessa@rld.cl' });
  const res = toPlain(ctx.Novedades.publicar(publicarBase_({ area_id: 'RRHH' }), ctxAdm()));
  assert.ok(res.novedad_id);
});

test('4. alguien que no es responsable de NINGUNA area no puede publicar', () => {
  const ctx = cargar();
  seedArea(ctx);
  const res = toPlain(ctx.Novedades.publicar(publicarBase_(), ctxCualquiera()));
  assert.equal(res._forbidden, true);
});

test('5. campos obligatorios: tipo, titulo y resumen', () => {
  const ctx = cargar();
  seedArea(ctx);
  assert.equal(toPlain(ctx.Novedades.publicar(
    publicarBase_({ tipo: 'NO_EXISTE' }), ctxResponsable()
  ))._validationError, true);
  assert.equal(toPlain(ctx.Novedades.publicar(
    publicarBase_({ titulo: '' }), ctxResponsable()
  ))._validationError, true);
  assert.equal(toPlain(ctx.Novedades.publicar(
    publicarBase_({ resumen: '  ' }), ctxResponsable()
  ))._validationError, true);
});

test('6. requiere_acuse por defecto es true (obligatorio salvo que se indique lo contrario)', () => {
  const ctx = cargar();
  seedArea(ctx);
  ctx.Novedades.publicar(publicarBase_(), ctxResponsable());
  const fila = ctx.leerFilas_('NOVEDADES')[0];
  assert.equal(fila.requiere_acuse, true);
});

// --- 7-9: adjunto por firma binaria ----------------------------------------

test('7. adjunto PDF valido (firma %PDF) se sube correctamente', () => {
  const ctx = cargar();
  seedArea(ctx);
  const res = toPlain(ctx.Novedades.publicar(publicarBase_({
    contenido_base64: b64(PDF_MINIMO), nombre_archivo: 'ley.pdf'
  }), ctxResponsable()));
  assert.ok(res.novedad_id);
  const fila = ctx.leerFilas_('NOVEDADES')[0];
  assert.ok(fila.archivo_id);
  assert.equal(fila.archivo_nombre, 'ley.pdf');
  assert.equal(fila.archivo_mime, 'application/pdf');
});

test('8. SEGURIDAD: rechaza un adjunto que no es PDF real, aunque se llame .pdf', () => {
  const ctx = cargar();
  seedArea(ctx);
  const res = toPlain(ctx.Novedades.publicar(publicarBase_({
    contenido_base64: PNG_1X1, nombre_archivo: 'no-es-pdf.pdf'
  }), ctxResponsable()));
  assert.equal(res._validationError, true);
  assert.equal(ctx.leerFilas_('NOVEDADES').length, 0);
});

test('9. rechaza un adjunto mayor a 10 MB', () => {
  const ctx = cargar();
  seedArea(ctx);
  const grande = Buffer.concat([Buffer.from(PDF_MINIMO), Buffer.alloc(10 * 1024 * 1024 + 10)]).toString('base64');
  const res = toPlain(ctx.Novedades.publicar(publicarBase_({
    contenido_base64: grande, nombre_archivo: 'grande.pdf'
  }), ctxResponsable()));
  assert.equal(res._validationError, true);
});

// --- 10-13: feed, area como etiqueta no audiencia --------------------------

test('10. el feed es visible para CUALQUIER identidad autenticada, no solo del area', () => {
  const ctx = cargar();
  seedArea(ctx);
  ctx.Novedades.publicar(publicarBase_(), ctxResponsable());

  // Juan no es de RRHH ni tiene relacion con esa area: igual la ve.
  const feed = toPlain(ctx.Novedades.getFeed({}, ctxCualquiera()));
  assert.equal(feed.recientes.length, 1);
  assert.equal(feed.recientes[0].area_nombre, 'Recursos Humanos');
});

test('11. el feed no trae novedades despublicadas (activa=false)', () => {
  const ctx = cargar();
  seedArea(ctx);
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_(), ctxResponsable()));
  ctx.Novedades.despublicar({ novedad_id: pub.novedad_id }, ctxResponsable());

  const feed = toPlain(ctx.Novedades.getFeed({}, ctxCualquiera()));
  assert.equal(feed.recientes.length, 0);
});

test('12. filtrar el feed por tipo y por area', () => {
  const ctx = cargar();
  seedArea(ctx, { area_id: 'RRHH' });
  seedArea(ctx, { area_id: 'PREVENCION', responsable_email: 'camila@rld.cl' });
  ctx.Novedades.publicar(publicarBase_({ tipo: 'LEY', area_id: 'RRHH' }), ctxResponsable());
  ctx.Novedades.publicar(
    publicarBase_({ tipo: 'AVISO', titulo: 'Charla de prevencion', area_id: 'PREVENCION' }),
    ctxResponsable('camila@rld.cl')
  );

  const porTipo = toPlain(ctx.Novedades.getFeed({ tipo: 'LEY' }, ctxCualquiera()));
  assert.equal(porTipo.recientes.length, 1);
  assert.equal(porTipo.recientes[0].tipo, 'LEY');

  const porArea = toPlain(ctx.Novedades.getFeed({ area_id: 'PREVENCION' }, ctxCualquiera()));
  assert.equal(porArea.recientes.length, 1);
  assert.equal(porArea.recientes[0].area_id, 'PREVENCION');
});

test('13. getFeed NO trae el cuerpo (solo resumen); getDetalle si', () => {
  const ctx = cargar();
  seedArea(ctx);
  ctx.Novedades.publicar(publicarBase_({ cuerpo: 'Texto largo con el detalle completo de la ley.' }), ctxResponsable());
  const id = ctx.leerFilas_('NOVEDADES')[0].novedad_id;

  const feed = toPlain(ctx.Novedades.getFeed({}, ctxCualquiera()));
  assert.equal(feed.recientes[0].cuerpo, undefined);

  const detalle = toPlain(ctx.Novedades.getDetalle({ novedad_id: id }, ctxCualquiera()));
  assert.equal(detalle.cuerpo, 'Texto largo con el detalle completo de la ley.');
});

// --- 14-17: acuse de lectura -----------------------------------------------

test('14. marcarLeida registra el acuse y el feed refleja leida:true', () => {
  const ctx = cargar();
  seedArea(ctx);
  ctx.Novedades.publicar(publicarBase_(), ctxResponsable());
  const id = ctx.leerFilas_('NOVEDADES')[0].novedad_id;

  const antes = toPlain(ctx.Novedades.getFeed({}, ctxCualquiera())).recientes[0];
  assert.equal(antes.leida, false);

  ctx.Novedades.marcarLeida({ novedad_id: id }, ctxCualquiera());
  const despues = toPlain(ctx.Novedades.getFeed({}, ctxCualquiera())).recientes[0];
  assert.equal(despues.leida, true);
});

test('15. marcarLeida es idempotente: no duplica filas de lectura', () => {
  const ctx = cargar();
  seedArea(ctx);
  ctx.Novedades.publicar(publicarBase_(), ctxResponsable());
  const id = ctx.leerFilas_('NOVEDADES')[0].novedad_id;

  ctx.Novedades.marcarLeida({ novedad_id: id }, ctxCualquiera());
  ctx.Novedades.marcarLeida({ novedad_id: id }, ctxCualquiera());
  ctx.Novedades.marcarLeida({ novedad_id: id }, ctxCualquiera());

  assert.equal(ctx.leerFilas_('NOVEDADES_LECTURAS').length, 1);
});

test('16. SEGURIDAD: el acuse de cada quien es independiente (no se contamina entre lectores)', () => {
  const ctx = cargar();
  seedArea(ctx);
  ctx.Novedades.publicar(publicarBase_(), ctxResponsable());
  const id = ctx.leerFilas_('NOVEDADES')[0].novedad_id;

  ctx.Novedades.marcarLeida({ novedad_id: id }, ctxCualquiera('juan@homepymes.cl'));

  const paraJuan = toPlain(ctx.Novedades.getFeed({}, ctxCualquiera('juan@homepymes.cl'))).recientes[0];
  const paraOtra = toPlain(ctx.Novedades.getFeed({}, ctxCualquiera('otra@homepymes.cl'))).recientes[0];
  assert.equal(paraJuan.leida, true);
  assert.equal(paraOtra.leida, false, 'que Juan haya leido no debe marcar la novedad como leida para otra persona');
});

test('17. resumen.pendientes cuenta solo lo que exige acuse y no esta leido', () => {
  const ctx = cargar();
  seedArea(ctx);
  ctx.Novedades.publicar(publicarBase_({ titulo: 'Requiere acuse' }), ctxResponsable());
  ctx.Novedades.publicar(publicarBase_({ titulo: 'No requiere acuse', requiere_acuse: false }), ctxResponsable());

  const feed = toPlain(ctx.Novedades.getFeed({}, ctxCualquiera()));
  assert.equal(feed.resumen.pendientes, 1);
  assert.equal(feed.resumen.total, 2);

  const idConAcuse = feed.recientes.find((n) => n.titulo === 'Requiere acuse').novedad_id;
  ctx.Novedades.marcarLeida({ novedad_id: idConAcuse }, ctxCualquiera());
  const feedDespues = toPlain(ctx.Novedades.getFeed({}, ctxCualquiera()));
  assert.equal(feedDespues.resumen.pendientes, 0);
});

// --- 18-20: despublicar, descargar adjunto, listarAreasPublicables --------

test('18. despublicar: solo el autor o ADM; otros quedan fuera', () => {
  const ctx = cargar();
  seedArea(ctx);
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_(), ctxResponsable()));

  const otro = toPlain(ctx.Novedades.despublicar({ novedad_id: pub.novedad_id }, ctxCualquiera()));
  assert.equal(otro._forbidden, true);

  const admOk = toPlain(ctx.Novedades.despublicar({ novedad_id: pub.novedad_id }, ctxAdm()));
  assert.equal(admOk.activa, false);
});

test('19. descargarAdjunto devuelve el contenido base64 del original', () => {
  const ctx = cargar();
  seedArea(ctx);
  ctx.Novedades.publicar(publicarBase_({
    contenido_base64: b64(PDF_MINIMO), nombre_archivo: 'ley.pdf'
  }), ctxResponsable());
  const id = ctx.leerFilas_('NOVEDADES')[0].novedad_id;

  const res = toPlain(ctx.Novedades.descargarAdjunto({ novedad_id: id }, ctxCualquiera()));
  assert.equal(res.nombre_archivo, 'ley.pdf');
  assert.equal(Buffer.from(res.contenido_base64, 'base64').toString('binary'), PDF_MINIMO);
});

test('20. listarAreasPublicables: ADM ve todas, el responsable solo la suya', () => {
  const ctx = cargar();
  seedArea(ctx, { area_id: 'RRHH', responsable_email: 'vanessa@rld.cl' });
  seedArea(ctx, { area_id: 'PREVENCION', responsable_email: 'camila@rld.cl' });

  const paraVanessa = toPlain(ctx.Novedades.listarAreasPublicables({}, ctxResponsable('vanessa@rld.cl')));
  assert.deepEqual(paraVanessa.areas.map((a) => a.area_id), ['RRHH']);
  assert.equal(paraVanessa.puede_general, false);

  const paraAdm = toPlain(ctx.Novedades.listarAreasPublicables({}, ctxAdm()));
  assert.equal(paraAdm.areas.length, 2);
  assert.equal(paraAdm.puede_general, true);
  assert.equal(paraAdm.tipos.length, 7);
});
