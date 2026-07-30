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
  seedSheet(ctx, 'NOVEDADES_HISTORIAL', ctx.COLUMNAS.NOVEDADES_HISTORIAL);
  return ctx;
}

// Fase 2 (seguimiento de lectura + aviso): la "audiencia" sale de USUARIOS
// (login Google) + CUENTAS_PORTAL (portal), asi que estos tests siembran
// ambas hojas ademas de las de cargar().
function cargarConAudiencia() {
  const ctx = cargar();
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Juan Perez', 'juan@homepymes.cl', 'HP', 'DEV', true, '', 'seed'],
    ['U2', 'Ex Empleado', 'inactivo@homepymes.cl', 'HP', 'DEV', false, '', 'seed']
  ]);
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL, [
    ['CTA-1', 'leo', 'Leo Estay', 'Desarrollador', 'hash', 'sal',
      JSON.stringify(['leo@rld.cl']), 'DEV', JSON.stringify(['bandeja']),
      'RLD', true, false, '', 'seed'],
    ['CTA-2', 'exportal', 'Cuenta Suspendida', 'Ex', 'hash', 'sal',
      JSON.stringify(['suspendido@rld.cl']), 'DEV', JSON.stringify(['bandeja']),
      'RLD', false, false, '', 'seed']
  ]);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
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

// v6.6 (Fase 4): tipo por defecto es AVISO (carril LIBRE, se publica de
// inmediato) para que los tests de permisos/adjunto/feed/acuse -- que no
// tratan sobre el circuito de aprobacion -- no se vean afectados por el.
// Los tests que SI prueban el carril CONTROLADO (Ley, etc.) fijan su propio
// tipo explicitamente.
function publicarBase_(overrides) {
  return Object.assign({
    tipo: 'AVISO', titulo: 'Recordatorio de horario de verano',
    resumen: 'A partir del lunes el horario de salida cambia a las 17:00.', area_id: 'RRHH'
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
  // LEY es carril CONTROLADO (Fase 4): se aprueba antes de aparecer en el
  // feed -- el test sigue probando el filtro, no el circuito de aprobacion.
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'LEY', area_id: 'RRHH' }), ctxResponsable()));
  ctx.Novedades.aprobar({ novedad_id: pub.novedad_id }, ctxAdm());
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

// --- 21-26: Fase 2 (seguimiento de lectura + aviso) -------------------------

test('21. getLectores: SEGURIDAD -- solo el autor o ADM pueden verlo', () => {
  const ctx = cargarConAudiencia();
  seedArea(ctx);
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'AVISO' }), ctxResponsable()));

  const otro = toPlain(ctx.Novedades.getLectores({ novedad_id: pub.novedad_id }, ctxCualquiera()));
  assert.equal(otro._forbidden, true);

  const admOk = toPlain(ctx.Novedades.getLectores({ novedad_id: pub.novedad_id }, ctxAdm()));
  assert.ok(admOk.leyeron);

  const autorOk = toPlain(ctx.Novedades.getLectores({ novedad_id: pub.novedad_id }, ctxResponsable()));
  assert.ok(autorOk.pendientes);
});

test('22. getLectores separa quien ya dio el acuse de quien falta, contra la audiencia completa', () => {
  const ctx = cargarConAudiencia();
  seedArea(ctx);
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'AVISO' }), ctxResponsable()));
  ctx.Novedades.marcarLeida({ novedad_id: pub.novedad_id }, ctxCualquiera('juan@homepymes.cl'));

  const res = toPlain(ctx.Novedades.getLectores({ novedad_id: pub.novedad_id }, ctxAdm()));
  // Audiencia: juan@homepymes.cl (USUARIOS activo) + leo@rld.cl (CUENTAS_PORTAL activa).
  // inactivo@homepymes.cl y suspendido@rld.cl quedan fuera por no estar activos.
  assert.equal(res.total_audiencia, 2);
  assert.deepEqual(res.leyeron.map((l) => l.email), ['juan@homepymes.cl']);
  assert.deepEqual(res.pendientes.map((p) => p.email), ['leo@rld.cl']);
});

test('23. aprobar una novedad tipo LEY envia correo inmediato a la audiencia (menos al autor)', () => {
  // v6.6: LEY es carril CONTROLADO -- el correo inmediato ya no sale al
  // publicar (eso ahora solo la manda a revision), sino al aprobar.
  const ctx = cargarConAudiencia();
  seedArea(ctx, { responsable_email: 'juan@homepymes.cl' });
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'LEY' }), ctxResponsable('juan@homepymes.cl')));
  assert.equal(ctx.GmailApp._enviados.length, 0, 'publicar (enviar a revision) no manda el correo de LEY todavia');

  ctx.Novedades.aprobar({ novedad_id: pub.novedad_id }, ctxAdm());

  const destinatarios = ctx.GmailApp._enviados.map((e) => e.destinatario);
  assert.deepEqual(destinatarios.sort(), ['leo@rld.cl']);
});

test('24. publicar un tipo distinto de LEY NO envia correo inmediato', () => {
  const ctx = cargarConAudiencia();
  seedArea(ctx);
  ctx.Novedades.publicar(publicarBase_({ tipo: 'AVISO' }), ctxResponsable());
  assert.equal(ctx.GmailApp._enviados.length, 0);
});

test('25. recordatorioPendientes: un solo correo por persona con TODAS sus pendientes', () => {
  const ctx = cargarConAudiencia();
  seedArea(ctx);
  ctx.Novedades.publicar(publicarBase_({ tipo: 'AVISO', titulo: 'Aviso 1' }), ctxResponsable());
  ctx.Novedades.publicar(publicarBase_({ tipo: 'LOGRO', titulo: 'Aviso 2' }), ctxResponsable());

  const res = toPlain(ctx.Novedades.recordatorioPendientes());
  assert.equal(res.enviados, 2); // juan@homepymes.cl y leo@rld.cl, cada uno un correo

  const paraJuan = ctx.GmailApp._enviados.find((e) => e.destinatario === 'juan@homepymes.cl');
  assert.ok(paraJuan.cuerpo.indexOf('Aviso 1') !== -1);
  assert.ok(paraJuan.cuerpo.indexOf('Aviso 2') !== -1);
});

test('26. recordatorioPendientes no reenvia el mismo dia (dedup por evento+dia, mismo patron que detectarPatrones)', () => {
  const ctx = cargarConAudiencia();
  seedArea(ctx);
  ctx.Novedades.publicar(publicarBase_({ tipo: 'AVISO' }), ctxResponsable());

  ctx.Novedades.recordatorioPendientes();
  assert.equal(ctx.GmailApp._enviados.length, 2);

  // Correrlo de nuevo el mismo dia no debe duplicar.
  ctx.Novedades.recordatorioPendientes();
  assert.equal(ctx.GmailApp._enviados.length, 2);
});

test('27. recordatorioPendientes no molesta a quien no tiene nada pendiente', () => {
  const ctx = cargarConAudiencia();
  seedArea(ctx);
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'AVISO' }), ctxResponsable()));
  ctx.Novedades.marcarLeida({ novedad_id: pub.novedad_id }, ctxCualquiera('juan@homepymes.cl'));
  ctx.Novedades.marcarLeida({ novedad_id: pub.novedad_id }, ctxCualquiera('leo@rld.cl'));

  const res = toPlain(ctx.Novedades.recordatorioPendientes());
  assert.equal(res.enviados, 0);
  assert.equal(ctx.GmailApp._enviados.length, 0);
});

// --- 28-41: Fase 4 (gobierno de la informacion -- aprobacion por jefatura) -

// jefa@rld.cl es jefatura de vanessa@rld.cl (autora por defecto de
// publicarBase_/ctxResponsable, responsable del area RRHH) -- misma hoja
// JEFATURAS que usa "Mi Departamento", ninguna configuracion nueva.
function cargarConJefatura() {
  const ctx = cargarConAudiencia();
  seedSheet(ctx, 'JEFATURAS', ctx.COLUMNAS.JEFATURAS, [
    ['JEF-1', 'jefa@rld.cl', 'vanessa@rld.cl', true]
  ]);
  return ctx;
}
function ctxJefa(email) {
  return { email: email || 'jefa@rld.cl', rol: 'JEFATURA' };
}

test('28. publicar un tipo CONTROLADO (Ley) queda EN_REVISION, no en el feed, y notifica a la jefatura del autor', () => {
  const ctx = cargarConJefatura();
  seedArea(ctx);
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'LEY' }), ctxResponsable()));
  assert.equal(pub.estado, 'EN_REVISION');

  const fila = ctx.leerFilas_('NOVEDADES')[0];
  assert.equal(fila.estado, 'EN_REVISION');
  assert.equal(fila.activa, false, 'no debe activarse hasta que se aprueba');

  const feed = toPlain(ctx.Novedades.getFeed({}, ctxCualquiera()));
  assert.equal(feed.recientes.length, 0, 'no aparece en el feed publico mientras esta en revision');

  const avisos = ctx.GmailApp._enviados.filter((e) => e.destinatario === 'jefa@rld.cl');
  assert.equal(avisos.length, 1);
});

test('29. publicar un tipo LIBRE (Aviso) sigue publicando de inmediato, sin pasar por revision', () => {
  const ctx = cargarConJefatura();
  seedArea(ctx);
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'AVISO' }), ctxResponsable()));
  assert.equal(pub.estado, 'PUBLICADA');
  assert.equal(ctx.leerFilas_('NOVEDADES_HISTORIAL').length, 0, 'sin revision, no hay transiciones que registrar');

  const feed = toPlain(ctx.Novedades.getFeed({}, ctxCualquiera()));
  assert.equal(feed.recientes.length, 1);
});

test('30. getDetalle: SEGURIDAD -- una novedad EN_REVISION no es visible para cualquiera', () => {
  const ctx = cargarConJefatura();
  seedArea(ctx);
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'LEY' }), ctxResponsable()));

  const paraOtro = toPlain(ctx.Novedades.getDetalle({ novedad_id: pub.novedad_id }, ctxCualquiera()));
  assert.equal(paraOtro._forbidden, true);

  const paraAutor = toPlain(ctx.Novedades.getDetalle({ novedad_id: pub.novedad_id }, ctxResponsable()));
  assert.equal(paraAutor.estado, 'EN_REVISION');

  const paraJefa = toPlain(ctx.Novedades.getDetalle({ novedad_id: pub.novedad_id }, ctxJefa()));
  assert.equal(paraJefa.estado, 'EN_REVISION');
  assert.equal(paraJefa.puede_aprobar, true);

  const paraAdm = toPlain(ctx.Novedades.getDetalle({ novedad_id: pub.novedad_id }, ctxAdm()));
  assert.equal(paraAdm.estado, 'EN_REVISION');
});

test('31. aprobar: SEGURIDAD -- solo la jefatura del autor o ADM', () => {
  const ctx = cargarConJefatura();
  seedArea(ctx);
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'LEY' }), ctxResponsable()));

  const otro = toPlain(ctx.Novedades.aprobar({ novedad_id: pub.novedad_id }, ctxCualquiera()));
  assert.equal(otro._forbidden, true);
  // Ni siquiera el propio autor puede autoaprobarse.
  const propio = toPlain(ctx.Novedades.aprobar({ novedad_id: pub.novedad_id }, ctxResponsable()));
  assert.equal(propio._forbidden, true);

  const ok = toPlain(ctx.Novedades.aprobar({ novedad_id: pub.novedad_id }, ctxJefa()));
  assert.equal(ok.estado, 'PUBLICADA');

  const fila = ctx.leerFilas_('NOVEDADES')[0];
  assert.equal(fila.activa, true);
  assert.equal(fila.aprobador_email, 'jefa@rld.cl');
  assert.ok(fila.fecha_publicacion);

  const feed = toPlain(ctx.Novedades.getFeed({}, ctxCualquiera()));
  assert.equal(feed.recientes.length, 1);
});

test('32. aprobar rechaza si la novedad no esta EN_REVISION (ya aprobada, por ejemplo)', () => {
  const ctx = cargarConJefatura();
  seedArea(ctx);
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'LEY' }), ctxResponsable()));
  ctx.Novedades.aprobar({ novedad_id: pub.novedad_id }, ctxJefa());

  const segundaVez = toPlain(ctx.Novedades.aprobar({ novedad_id: pub.novedad_id }, ctxJefa()));
  assert.equal(segundaVez._validationError, true);
});

test('33. devolver: exige un motivo de al menos 10 caracteres', () => {
  const ctx = cargarConJefatura();
  seedArea(ctx);
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'LEY' }), ctxResponsable()));

  const sinMotivo = toPlain(ctx.Novedades.devolver({ novedad_id: pub.novedad_id }, ctxJefa()));
  assert.equal(sinMotivo._validationError, true);

  const corto = toPlain(ctx.Novedades.devolver({ novedad_id: pub.novedad_id, motivo: 'no' }, ctxJefa()));
  assert.equal(corto._validationError, true);
});

test('34. devolver: pasa a DEVUELTA, guarda el motivo y avisa al autor', () => {
  const ctx = cargarConJefatura();
  seedArea(ctx);
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'LEY' }), ctxResponsable()));

  const res = toPlain(ctx.Novedades.devolver(
    { novedad_id: pub.novedad_id, motivo: 'Falta citar el numero de la ley.' }, ctxJefa()
  ));
  assert.equal(res.estado, 'DEVUELTA');

  const fila = ctx.leerFilas_('NOVEDADES')[0];
  assert.equal(fila.estado, 'DEVUELTA');
  assert.equal(fila.motivo_devolucion, 'Falta citar el numero de la ley.');

  const avisoAutor = ctx.GmailApp._enviados.find((e) => e.destinatario === 'vanessa@rld.cl');
  assert.ok(avisoAutor);
  assert.ok(avisoAutor.cuerpo.indexOf('Falta citar el numero de la ley.') !== -1);
});

test('35. rechazar: pasa a RECHAZADA (terminal), no vuelve al autor', () => {
  const ctx = cargarConJefatura();
  seedArea(ctx);
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'LEY' }), ctxResponsable()));

  const res = toPlain(ctx.Novedades.rechazar(
    { novedad_id: pub.novedad_id, motivo: 'No corresponde publicar esto como ley.' }, ctxJefa()
  ));
  assert.equal(res.estado, 'RECHAZADA');

  // No se puede reenviar una rechazada (reenviar solo aplica a DEVUELTA).
  const reintento = toPlain(ctx.Novedades.reenviar({ novedad_id: pub.novedad_id }, ctxResponsable()));
  assert.equal(reintento._validationError, true);
});

test('36. reenviar: el autor corrige una DEVUELTA, vuelve a EN_REVISION y se re-notifica a la jefatura', () => {
  const ctx = cargarConJefatura();
  seedArea(ctx);
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'LEY' }), ctxResponsable()));
  ctx.Novedades.devolver({ novedad_id: pub.novedad_id, motivo: 'Falta la fecha de vigencia.' }, ctxJefa());
  ctx.GmailApp._enviados.length = 0; // limpio para medir solo el reenvio

  const res = toPlain(ctx.Novedades.reenviar(
    { novedad_id: pub.novedad_id, titulo: 'Nueva ley de subcontratación (v2)' }, ctxResponsable()
  ));
  assert.equal(res.estado, 'EN_REVISION');

  const fila = ctx.leerFilas_('NOVEDADES')[0];
  assert.equal(fila.titulo, 'Nueva ley de subcontratación (v2)');
  assert.equal(fila.motivo_devolucion, '', 'el motivo de la devolucion anterior se limpia al reenviar');

  const avisos = ctx.GmailApp._enviados.filter((e) => e.destinatario === 'jefa@rld.cl');
  assert.equal(avisos.length, 1, 'la jefatura vuelve a recibir el aviso de revision');
});

test('37. reenviar: SEGURIDAD -- ni la jefatura ni ADM pueden reenviar en nombre del autor', () => {
  const ctx = cargarConJefatura();
  seedArea(ctx);
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'LEY' }), ctxResponsable()));
  ctx.Novedades.devolver({ novedad_id: pub.novedad_id, motivo: 'Falta la fecha de vigencia.' }, ctxJefa());

  const porJefa = toPlain(ctx.Novedades.reenviar({ novedad_id: pub.novedad_id }, ctxJefa()));
  assert.equal(porJefa._forbidden, true);

  const porAdm = toPlain(ctx.Novedades.reenviar({ novedad_id: pub.novedad_id }, ctxAdm()));
  assert.equal(porAdm._forbidden, true);
});

test('38. listarPendientesAprobacion: la jefatura ve solo las de su equipo; ADM ve todas', () => {
  const ctx = cargarConJefatura();
  seedArea(ctx, { area_id: 'RRHH', responsable_email: 'vanessa@rld.cl' });
  seedArea(ctx, { area_id: 'CONTABILIDAD', responsable_email: 'francisca@rld.cl' });
  const pub1 = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'LEY', titulo: 'Ley de Vanessa' }), ctxResponsable()));
  ctx.Novedades.publicar(
    publicarBase_({ tipo: 'DICTAMEN', titulo: 'Dictamen de Francisca', area_id: 'CONTABILIDAD' }),
    ctxResponsable('francisca@rld.cl')
  );

  const paraJefa = toPlain(ctx.Novedades.listarPendientesAprobacion({}, ctxJefa()));
  assert.deepEqual(paraJefa.pendientes.map((p) => p.novedad_id), [pub1.novedad_id]);

  const paraAdm = toPlain(ctx.Novedades.listarPendientesAprobacion({}, ctxAdm()));
  assert.equal(paraAdm.pendientes.length, 2);

  const paraCualquiera = toPlain(ctx.Novedades.listarPendientesAprobacion({}, ctxCualquiera()));
  assert.equal(paraCualquiera.pendientes.length, 0, 'quien no es jefatura de nadie no ve pendientes ajenas');
});

test('39. misPendientes: el autor ve sus EN_REVISION/DEVUELTA/RECHAZADA, no las ya publicadas', () => {
  const ctx = cargarConJefatura();
  seedArea(ctx);
  const enRevision = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'LEY', titulo: 'En revision' }), ctxResponsable()));
  const devuelta = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'DICTAMEN', titulo: 'Devuelta' }), ctxResponsable()));
  ctx.Novedades.devolver({ novedad_id: devuelta.novedad_id, motivo: 'Falta un detalle importante.' }, ctxJefa());
  const publicada = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'AVISO', titulo: 'Ya publicada' }), ctxResponsable()));

  const mios = toPlain(ctx.Novedades.misPendientes({}, ctxResponsable()));
  const ids = mios.envios.map((e) => e.novedad_id);
  assert.ok(ids.includes(enRevision.novedad_id));
  assert.ok(ids.includes(devuelta.novedad_id));
  assert.ok(!ids.includes(publicada.novedad_id));
});

test('40. getHistorial registra las transiciones en orden y respeta la visibilidad de getDetalle', () => {
  const ctx = cargarConJefatura();
  seedArea(ctx);
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'LEY' }), ctxResponsable()));

  // Mientras sigue en el circuito de aprobacion (no publicada todavia), un
  // tercero cualquiera no puede ver el historial -- mismo criterio que
  // getDetalle.
  const paraOtro = toPlain(ctx.Novedades.getHistorial({ novedad_id: pub.novedad_id }, ctxCualquiera()));
  assert.equal(paraOtro._forbidden, true);

  ctx.Novedades.devolver({ novedad_id: pub.novedad_id, motivo: 'Falta la fecha de vigencia.' }, ctxJefa());
  ctx.Novedades.reenviar({ novedad_id: pub.novedad_id }, ctxResponsable());
  ctx.Novedades.aprobar({ novedad_id: pub.novedad_id }, ctxJefa());

  // Ya publicada: es publica, incluido el historial, para cualquier
  // identidad autenticada -- igual que getDetalle.
  const paraOtroDespues = toPlain(ctx.Novedades.getHistorial({ novedad_id: pub.novedad_id }, ctxCualquiera()));
  assert.deepEqual(paraOtroDespues.eventos.map((e) => e.evento), [
    'ENVIADA_REVISION', 'DEVUELTA', 'ENVIADA_REVISION', 'APROBADA'
  ]);
});

test('41. sin jefatura configurada para el autor, el aviso de revision cae a ADM (no se pierde)', () => {
  const ctx = cargarConAudiencia(); // sin seedear JEFATURAS
  seedArea(ctx);
  agregar(ctx, 'USUARIOS', { usuario_id: 'U9', nombre: 'Admin General', email: 'adm@rld.cl', empresa_id: 'RLD', rol: 'ADM', activo: true, creado_por: 'seed' });
  const pub = toPlain(ctx.Novedades.publicar(publicarBase_({ tipo: 'LEY' }), ctxResponsable()));
  assert.equal(pub.estado, 'EN_REVISION');

  const avisos = ctx.GmailApp._enviados.filter((e) => e.destinatario === 'adm@rld.cl');
  assert.equal(avisos.length, 1);
});
