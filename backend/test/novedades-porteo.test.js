'use strict';

/**
 * Prueba de portabilidad: los escenarios de backend/test/novedades.test.js,
 * corridos contra backend/logica/novedades.js (Node + SQLite).
 *
 * Adaptaciones documentadas respecto del .gs:
 *  - Los 6 tests de ADJUNTO (subir PDF, rechazar no-PDF, rechazar >10MB,
 *    descargar) se consolidan: el adjunto esta bloqueado hasta que exista
 *    almacenamiento de archivos (R2). Se prueba que publicar con adjunto y
 *    descargarAdjunto devuelven el error R2-bloqueado, y que los guardias de
 *    seguridad de descargarAdjunto (no filtrar a quien no puede ver la
 *    novedad) SIGUEN corriendo antes de ese mensaje.
 *  - Los correos se verifican via el mock de Resend (destinatarios/texto), no
 *    via GmailApp._enviados.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_, actualizarFilaPorId_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const Novedades = require('../logica/novedades');
const Resend = require('../logica/resend');

function dbBase() {
  const db = abrirDb_();
  ['CAT_AREAS', 'NOVEDADES', 'NOVEDADES_LECTURAS', 'NOVEDADES_HISTORIAL', 'NOVEDADES_AUDIENCIA',
    'USUARIOS', 'CUENTAS_PORTAL', 'JEFATURAS', 'LOG_NOTIFICACIONES', 'NOTIFICACIONES_APP']
    .forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  return db;
}

function seedArea(db, overrides) {
  const base = Object.assign(
    { area_id: 'RRHH', nombre: 'Recursos Humanos', responsable_email: 'vanessa@rld.cl', activo: true },
    overrides
  );
  agregarFila_(db, 'CAT_AREAS', base);
  return base;
}

// Directorio: juan (USUARIOS activo) + leo (CUENTAS_PORTAL activa). inactivo y
// suspendido quedan fuera por no estar activos.
function seedAudiencia(db) {
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U1', nombre: 'Juan Perez', email: 'juan@homepymes.cl', empresa_id: 'HP', rol: 'DEV', activo: true, ultimo_acceso: '', creado_por: 'seed' });
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U2', nombre: 'Ex Empleado', email: 'inactivo@homepymes.cl', empresa_id: 'HP', rol: 'DEV', activo: false, ultimo_acceso: '', creado_por: 'seed' });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'CTA-1', usuario: 'leo', nombre: 'Leo Estay', cargo: 'Desarrollador', hash_password: 'h', salt: 's', emails: JSON.stringify(['leo@rld.cl']), rol: 'DEV', modulos: JSON.stringify(['bandeja']), empresa_id: 'RLD', activo: true, debe_cambiar_password: false, ultimo_acceso: '', creado_por: 'seed' });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'CTA-2', usuario: 'exportal', nombre: 'Cuenta Suspendida', cargo: 'Ex', hash_password: 'h', salt: 's', emails: JSON.stringify(['suspendido@rld.cl']), rol: 'DEV', modulos: JSON.stringify(['bandeja']), empresa_id: 'RLD', activo: false, debe_cambiar_password: false, ultimo_acceso: '', creado_por: 'seed' });
}

function seedJefatura(db) {
  agregarFila_(db, 'JEFATURAS', { jefatura_id: 'JEF-1', jefe_email: 'jefa@rld.cl', subordinado_email: 'vanessa@rld.cl', activo: true });
}

function ctxResponsable(email) { return { email: email || 'vanessa@rld.cl', rol: 'ANA' }; }
function ctxAdm(email) { return { email: email || 'adm@rld.cl', rol: 'ADM' }; }
function ctxCualquiera(email) { return { email: email || 'juan@homepymes.cl', rol: 'DEV' }; }
function ctxJefa(email) { return { email: email || 'jefa@rld.cl', rol: 'JEFATURA' }; }

function fechaLimiteValida_(diasDesdeHoy) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (diasDesdeHoy || 10));
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function publicarBase_(overrides) {
  return Object.assign({
    tipo: 'AVISO', titulo: 'Recordatorio de horario de verano',
    resumen: 'A partir del lunes el horario de salida cambia a las 17:00.', area_id: 'RRHH'
  }, overrides);
}

function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }

// --- correos: mock de Resend, con RESEND_API_KEY fijada ---------------------
function conMock(t) {
  process.env.RESEND_API_KEY = 're_test_key';
  const mock = t.mock.method(Resend, 'enviarCorreoResend_', async () => ({ id: 'x' }));
  t.after(() => { delete process.env.RESEND_API_KEY; });
  return mock;
}
function destinatarios(mock) { return mock.mock.calls.map((c) => c.arguments[0].to[0]); }

// --- 1-6: publicar, permisos por area --------------------------------------

test('1. el responsable de un area puede publicar en SU area', async (t) => {
  const mock = conMock(t);
  const db = dbBase(); seedArea(db);
  const res = await Novedades.publicar(db, publicarBase_(), ctxResponsable());
  assert.ok(res.novedad_id);
  const fila = filas(db, 'NOVEDADES')[0];
  assert.equal(fila.area_id, 'RRHH');
  assert.equal(fila.area_nombre, 'Recursos Humanos');
  assert.equal(fila.autor_email, 'vanessa@rld.cl');
});

test('2. SEGURIDAD: no puede publicar en un area de la que NO es responsable', async (t) => {
  conMock(t);
  const db = dbBase();
  seedArea(db, { area_id: 'RRHH', responsable_email: 'vanessa@rld.cl' });
  seedArea(db, { area_id: 'CONTABILIDAD', responsable_email: 'barbara@rld.cl' });
  const res = await Novedades.publicar(db, publicarBase_({ area_id: 'CONTABILIDAD' }), ctxResponsable('vanessa@rld.cl'));
  assert.equal(res._forbidden, true);
  assert.equal(filas(db, 'NOVEDADES').length, 0);
});

test('2b. SEGURIDAD: "general" (sin area) es exclusivo de ADM', async (t) => {
  conMock(t);
  const db = dbBase(); seedArea(db);
  const res = await Novedades.publicar(db, publicarBase_({ area_id: '' }), ctxResponsable());
  assert.equal(res._forbidden, true);
  const admOk = await Novedades.publicar(db, publicarBase_({ area_id: '' }), ctxAdm());
  assert.ok(admOk.novedad_id);
});

test('3. ADM puede publicar en cualquier area', async (t) => {
  conMock(t);
  const db = dbBase();
  seedArea(db, { area_id: 'RRHH', responsable_email: 'vanessa@rld.cl' });
  const res = await Novedades.publicar(db, publicarBase_({ area_id: 'RRHH' }), ctxAdm());
  assert.ok(res.novedad_id);
});

test('4. alguien que no es responsable de NINGUNA area no puede publicar', async (t) => {
  conMock(t);
  const db = dbBase(); seedArea(db);
  const res = await Novedades.publicar(db, publicarBase_(), ctxCualquiera());
  assert.equal(res._forbidden, true);
});

test('5. campos obligatorios: tipo, titulo y resumen', async (t) => {
  conMock(t);
  const db = dbBase(); seedArea(db);
  assert.equal((await Novedades.publicar(db, publicarBase_({ tipo: 'NO_EXISTE' }), ctxResponsable()))._validationError, true);
  assert.equal((await Novedades.publicar(db, publicarBase_({ titulo: '' }), ctxResponsable()))._validationError, true);
  assert.equal((await Novedades.publicar(db, publicarBase_({ resumen: '  ' }), ctxResponsable()))._validationError, true);
});

test('6. requiere_acuse por defecto es true', async (t) => {
  conMock(t);
  const db = dbBase(); seedArea(db);
  await Novedades.publicar(db, publicarBase_(), ctxResponsable());
  assert.equal(filas(db, 'NOVEDADES')[0].requiere_acuse, true);
});

// --- 7-9: adjunto (R2-bloqueado, adaptado) ----------------------------------

test('7-9. publicar con adjunto queda bloqueado hasta configurar almacenamiento (R2), sin crear la fila', async (t) => {
  conMock(t);
  const db = dbBase(); seedArea(db);
  const res = await Novedades.publicar(db, publicarBase_({ contenido_base64: 'JVBERi0x', nombre_archivo: 'ley.pdf' }), ctxResponsable());
  assert.equal(res._validationError, true);
  assert.match(res.message, /adjuntos/i);
  assert.equal(filas(db, 'NOVEDADES').length, 0, 'no queda una fila a medias');
});

// --- 10-13: feed, area como etiqueta ----------------------------------------

test('10. el feed es visible para CUALQUIER identidad autenticada', async (t) => {
  conMock(t);
  const db = dbBase(); seedArea(db);
  await Novedades.publicar(db, publicarBase_(), ctxResponsable());
  const feed = Novedades.getFeed(db, {}, ctxCualquiera());
  assert.equal(feed.recientes.length, 1);
  assert.equal(feed.recientes[0].area_nombre, 'Recursos Humanos');
});

test('11. el feed no trae novedades despublicadas', async (t) => {
  conMock(t);
  const db = dbBase(); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_(), ctxResponsable());
  Novedades.despublicar(db, { novedad_id: pub.novedad_id }, ctxResponsable());
  assert.equal(Novedades.getFeed(db, {}, ctxCualquiera()).recientes.length, 0);
});

test('12. filtrar el feed por tipo y por area', async (t) => {
  conMock(t);
  const db = dbBase();
  seedArea(db, { area_id: 'RRHH' });
  seedArea(db, { area_id: 'PREVENCION', responsable_email: 'camila@rld.cl' });
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY', area_id: 'RRHH' }), ctxResponsable());
  await Novedades.aprobar(db, { novedad_id: pub.novedad_id, fecha_limite_acuse: fechaLimiteValida_() }, ctxAdm());
  await Novedades.publicar(db, publicarBase_({ tipo: 'AVISO', titulo: 'Charla de prevencion', area_id: 'PREVENCION' }), ctxResponsable('camila@rld.cl'));

  const porTipo = Novedades.getFeed(db, { tipo: 'LEY' }, ctxCualquiera());
  assert.equal(porTipo.recientes.length, 1);
  assert.equal(porTipo.recientes[0].tipo, 'LEY');
  const porArea = Novedades.getFeed(db, { area_id: 'PREVENCION' }, ctxCualquiera());
  assert.equal(porArea.recientes.length, 1);
  assert.equal(porArea.recientes[0].area_id, 'PREVENCION');
});

test('13. getFeed NO trae el cuerpo; getDetalle si', async (t) => {
  conMock(t);
  const db = dbBase(); seedArea(db);
  await Novedades.publicar(db, publicarBase_({ cuerpo: 'Texto largo con el detalle completo.' }), ctxResponsable());
  const id = filas(db, 'NOVEDADES')[0].novedad_id;
  assert.equal(Novedades.getFeed(db, {}, ctxCualquiera()).recientes[0].cuerpo, undefined);
  assert.equal(Novedades.getDetalle(db, { novedad_id: id }, ctxCualquiera()).cuerpo, 'Texto largo con el detalle completo.');
});

// --- 14-17: acuse de lectura ------------------------------------------------

test('14. marcarLeida registra el acuse y el feed refleja leida:true', async (t) => {
  conMock(t);
  const db = dbBase(); seedArea(db);
  await Novedades.publicar(db, publicarBase_(), ctxResponsable());
  const id = filas(db, 'NOVEDADES')[0].novedad_id;
  assert.equal(Novedades.getFeed(db, {}, ctxCualquiera()).recientes[0].leida, false);
  Novedades.marcarLeida(db, { novedad_id: id }, ctxCualquiera());
  assert.equal(Novedades.getFeed(db, {}, ctxCualquiera()).recientes[0].leida, true);
});

test('15. marcarLeida es idempotente', async (t) => {
  conMock(t);
  const db = dbBase(); seedArea(db);
  await Novedades.publicar(db, publicarBase_(), ctxResponsable());
  const id = filas(db, 'NOVEDADES')[0].novedad_id;
  Novedades.marcarLeida(db, { novedad_id: id }, ctxCualquiera());
  Novedades.marcarLeida(db, { novedad_id: id }, ctxCualquiera());
  Novedades.marcarLeida(db, { novedad_id: id }, ctxCualquiera());
  assert.equal(filas(db, 'NOVEDADES_LECTURAS').length, 1);
});

test('16. SEGURIDAD: el acuse de cada quien es independiente', async (t) => {
  conMock(t);
  const db = dbBase(); seedArea(db);
  await Novedades.publicar(db, publicarBase_(), ctxResponsable());
  const id = filas(db, 'NOVEDADES')[0].novedad_id;
  Novedades.marcarLeida(db, { novedad_id: id }, ctxCualquiera('juan@homepymes.cl'));
  assert.equal(Novedades.getFeed(db, {}, ctxCualquiera('juan@homepymes.cl')).recientes[0].leida, true);
  assert.equal(Novedades.getFeed(db, {}, ctxCualquiera('otra@homepymes.cl')).recientes[0].leida, false);
});

test('17. resumen.pendientes cuenta solo lo que exige acuse y no esta leido', async (t) => {
  conMock(t);
  const db = dbBase(); seedArea(db);
  await Novedades.publicar(db, publicarBase_({ titulo: 'Requiere acuse' }), ctxResponsable());
  await Novedades.publicar(db, publicarBase_({ titulo: 'No requiere acuse', requiere_acuse: false }), ctxResponsable());
  const feed = Novedades.getFeed(db, {}, ctxCualquiera());
  assert.equal(feed.resumen.pendientes, 1);
  assert.equal(feed.resumen.total, 2);
  const idConAcuse = feed.recientes.find((n) => n.titulo === 'Requiere acuse').novedad_id;
  Novedades.marcarLeida(db, { novedad_id: idConAcuse }, ctxCualquiera());
  assert.equal(Novedades.getFeed(db, {}, ctxCualquiera()).resumen.pendientes, 0);
});

// --- 18-20: despublicar, descargarAdjunto (R2), listarAreasPublicables ------

test('18. despublicar: solo el autor o ADM', async (t) => {
  conMock(t);
  const db = dbBase(); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_(), ctxResponsable());
  assert.equal(Novedades.despublicar(db, { novedad_id: pub.novedad_id }, ctxCualquiera())._forbidden, true);
  assert.equal(Novedades.despublicar(db, { novedad_id: pub.novedad_id }, ctxAdm()).activa, false);
});

test('19. descargarAdjunto: guardia de acceso SIGUE corriendo antes del bloqueo R2 (no filtra)', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedArea(db);
  // Novedad con audiencia acotada a Juan, con archivo_id sembrado directo
  // (publicar no acepta adjuntos todavia). Leo no esta en la audiencia.
  agregarFila_(db, 'NOVEDADES', {
    novedad_id: 'N1', tipo: 'AVISO', titulo: 'Con adjunto', resumen: 'r', cuerpo: '',
    area_id: 'RRHH', area_nombre: 'Recursos Humanos', autor_email: 'vanessa@rld.cl', autor_nombre: 'vanessa@rld.cl',
    requiere_acuse: true, fecha_vigencia: '', archivo_id: 'FILE-1', archivo_nombre: 'ley.pdf', archivo_mime: 'application/pdf',
    estado: 'PUBLICADA', fecha_creacion: new Date().toISOString(), aprobador_email: '', aprobador_nombre: '',
    fecha_aprobacion: '', motivo_devolucion: '', audiencia_tipo: 'SELECCION', fecha_limite_acuse: '',
    fecha_publicacion: new Date().toISOString(), activa: true
  });
  agregarFila_(db, 'NOVEDADES_AUDIENCIA', { audiencia_id: 'A1', novedad_id: 'N1', destinatario_email: 'juan@homepymes.cl' });

  const ajeno = Novedades.descargarAdjunto(db, { novedad_id: 'N1' }, ctxCualquiera('leo@rld.cl'));
  assert.equal(ajeno._forbidden, true, 'quien no está en la audiencia no pasa el guardia');
  assert.equal(ajeno.contenido_base64, undefined);
  // El destinatario legitimo pasa el guardia, pero cae en el bloqueo R2 (no hay backend de archivos).
  const propio = Novedades.descargarAdjunto(db, { novedad_id: 'N1' }, ctxCualquiera('juan@homepymes.cl'));
  assert.equal(propio._validationError, true);
  assert.match(propio.message, /adjuntos/i);
});

test('20. listarAreasPublicables: ADM ve todas, el responsable solo la suya', async (t) => {
  conMock(t);
  const db = dbBase();
  seedArea(db, { area_id: 'RRHH', responsable_email: 'vanessa@rld.cl' });
  seedArea(db, { area_id: 'PREVENCION', responsable_email: 'camila@rld.cl' });
  const paraVanessa = Novedades.listarAreasPublicables(db, {}, ctxResponsable('vanessa@rld.cl'));
  assert.deepEqual(paraVanessa.areas.map((a) => a.area_id), ['RRHH']);
  assert.equal(paraVanessa.puede_general, false);
  const paraAdm = Novedades.listarAreasPublicables(db, {}, ctxAdm());
  assert.equal(paraAdm.areas.length, 2);
  assert.equal(paraAdm.puede_general, true);
  assert.equal(paraAdm.tipos.length, 7);
});

// --- 21-27: seguimiento de lectura + aviso ----------------------------------

test('21. getLectores: SEGURIDAD -- solo el autor o ADM', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'AVISO' }), ctxResponsable());
  assert.equal(Novedades.getLectores(db, { novedad_id: pub.novedad_id }, ctxCualquiera())._forbidden, true);
  assert.ok(Novedades.getLectores(db, { novedad_id: pub.novedad_id }, ctxAdm()).leyeron);
  assert.ok(Novedades.getLectores(db, { novedad_id: pub.novedad_id }, ctxResponsable()).pendientes);
});

test('22. getLectores separa quien dio el acuse de quien falta, contra la audiencia', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'AVISO' }), ctxResponsable());
  Novedades.marcarLeida(db, { novedad_id: pub.novedad_id }, ctxCualquiera('juan@homepymes.cl'));
  const res = Novedades.getLectores(db, { novedad_id: pub.novedad_id }, ctxAdm());
  assert.equal(res.total_audiencia, 2);
  assert.deepEqual(res.leyeron.map((l) => l.email), ['juan@homepymes.cl']);
  assert.deepEqual(res.pendientes.map((p) => p.email), ['leo@rld.cl']);
});

test('23. aprobar LEY envia correo inmediato a la audiencia (menos al autor)', async (t) => {
  const mock = conMock(t);
  const db = dbBase(); seedAudiencia(db);
  seedArea(db, { responsable_email: 'juan@homepymes.cl' });
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY' }), ctxResponsable('juan@homepymes.cl'));
  // publicar (enviar a revision) manda el aviso a la jefatura del autor; juan
  // no tiene jefatura -> cae a ADM. No hay ADM en USUARIOS aqui, asi que 0.
  mock.mock.resetCalls();
  await Novedades.aprobar(db, { novedad_id: pub.novedad_id, fecha_limite_acuse: fechaLimiteValida_() }, ctxAdm());
  assert.deepEqual(destinatarios(mock).sort(), ['leo@rld.cl']);
});

test('24. publicar LIBRE avisa de inmediato a la audiencia', async (t) => {
  const mock = conMock(t);
  const db = dbBase(); seedAudiencia(db); seedArea(db);
  await Novedades.publicar(db, publicarBase_({ tipo: 'AVISO' }), ctxResponsable());
  assert.deepEqual(destinatarios(mock).sort(), ['juan@homepymes.cl', 'leo@rld.cl']);
});

test('24b. publicar LIBRE tambien encola la notificacion en vivo', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedArea(db);
  await Novedades.publicar(db, publicarBase_({ tipo: 'AVISO', titulo: 'Aviso de prueba en vivo' }), ctxResponsable());
  const apps = filas(db, 'NOTIFICACIONES_APP');
  assert.equal(apps.length, 2);
  assert.deepEqual(apps.map((f) => f.destinatario_email).sort(), ['juan@homepymes.cl', 'leo@rld.cl']);
  assert.equal(apps[0].modulo_id, 'novedades');
  assert.ok(apps[0].titulo.indexOf('Aviso de prueba en vivo') !== -1);
});

test('24c. publicar LIBRE no rompe si NOTIFICACIONES_APP no existe', async (t) => {
  const mock = conMock(t);
  const db = abrirDb_();
  ['CAT_AREAS', 'NOVEDADES', 'NOVEDADES_LECTURAS', 'NOVEDADES_HISTORIAL', 'NOVEDADES_AUDIENCIA',
    'USUARIOS', 'CUENTAS_PORTAL', 'LOG_NOTIFICACIONES'].forEach((h) => sembrarTabla_(db, h, COLUMNAS[h], []));
  seedAudiencia(db); seedArea(db);
  const res = await Novedades.publicar(db, publicarBase_({ tipo: 'AVISO' }), ctxResponsable());
  assert.ok(res.novedad_id);
  assert.equal(destinatarios(mock).length, 2);
});

test('25. recordatorioPendientes: un solo correo por persona con TODAS sus pendientes', async (t) => {
  const mock = conMock(t);
  const db = dbBase(); seedAudiencia(db); seedArea(db);
  await Novedades.publicar(db, publicarBase_({ tipo: 'AVISO', titulo: 'Aviso 1' }), ctxResponsable());
  await Novedades.publicar(db, publicarBase_({ tipo: 'LOGRO', titulo: 'Aviso 2' }), ctxResponsable());
  const res = await Novedades.recordatorioPendientes(db);
  assert.equal(res.enviados, 2);
  const paraJuan = mock.mock.calls.map((c) => c.arguments[0]).filter((p) => p.to[0] === 'juan@homepymes.cl').pop();
  assert.ok(paraJuan.text.indexOf('Aviso 1') !== -1);
  assert.ok(paraJuan.text.indexOf('Aviso 2') !== -1);
});

test('26. recordatorioPendientes no reenvia el mismo dia (dedup por evento+dia)', async (t) => {
  const mock = conMock(t);
  const db = dbBase(); seedAudiencia(db); seedArea(db);
  await Novedades.publicar(db, publicarBase_({ tipo: 'AVISO' }), ctxResponsable());
  await Novedades.recordatorioPendientes(db);
  assert.equal(mock.mock.callCount(), 4);
  await Novedades.recordatorioPendientes(db);
  assert.equal(mock.mock.callCount(), 4);
});

test('27. recordatorioPendientes no molesta a quien no tiene nada pendiente', async (t) => {
  const mock = conMock(t);
  const db = dbBase(); seedAudiencia(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'AVISO' }), ctxResponsable());
  Novedades.marcarLeida(db, { novedad_id: pub.novedad_id }, ctxCualquiera('juan@homepymes.cl'));
  Novedades.marcarLeida(db, { novedad_id: pub.novedad_id }, ctxCualquiera('leo@rld.cl'));
  const res = await Novedades.recordatorioPendientes(db);
  assert.equal(res.enviados, 0);
  assert.equal(mock.mock.callCount(), 2);
});

// --- 28-41: gobierno (aprobacion por jefatura) ------------------------------

test('28. publicar CONTROLADO queda EN_REVISION, no en el feed, y notifica a la jefatura', async (t) => {
  const mock = conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY' }), ctxResponsable());
  assert.equal(pub.estado, 'EN_REVISION');
  const fila = filas(db, 'NOVEDADES')[0];
  assert.equal(fila.estado, 'EN_REVISION');
  assert.equal(fila.activa, false);
  assert.equal(Novedades.getFeed(db, {}, ctxCualquiera()).recientes.length, 0);
  assert.equal(destinatarios(mock).filter((d) => d === 'jefa@rld.cl').length, 1);
});

test('29. publicar LIBRE sigue publicando de inmediato', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'AVISO' }), ctxResponsable());
  assert.equal(pub.estado, 'PUBLICADA');
  assert.equal(filas(db, 'NOVEDADES_HISTORIAL').length, 0);
  assert.equal(Novedades.getFeed(db, {}, ctxCualquiera()).recientes.length, 1);
});

test('30. getDetalle: una novedad EN_REVISION no es visible para cualquiera', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY' }), ctxResponsable());
  assert.equal(Novedades.getDetalle(db, { novedad_id: pub.novedad_id }, ctxCualquiera())._forbidden, true);
  assert.equal(Novedades.getDetalle(db, { novedad_id: pub.novedad_id }, ctxResponsable()).estado, 'EN_REVISION');
  const paraJefa = Novedades.getDetalle(db, { novedad_id: pub.novedad_id }, ctxJefa());
  assert.equal(paraJefa.estado, 'EN_REVISION');
  assert.equal(paraJefa.puede_aprobar, true);
  assert.equal(Novedades.getDetalle(db, { novedad_id: pub.novedad_id }, ctxAdm()).estado, 'EN_REVISION');
});

test('31. aprobar: solo la jefatura del autor o ADM', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY' }), ctxResponsable());
  assert.equal((await Novedades.aprobar(db, { novedad_id: pub.novedad_id }, ctxCualquiera()))._forbidden, true);
  assert.equal((await Novedades.aprobar(db, { novedad_id: pub.novedad_id }, ctxResponsable()))._forbidden, true);
  const ok = await Novedades.aprobar(db, { novedad_id: pub.novedad_id, fecha_limite_acuse: fechaLimiteValida_() }, ctxJefa());
  assert.equal(ok.estado, 'PUBLICADA');
  const fila = filas(db, 'NOVEDADES')[0];
  assert.equal(fila.activa, true);
  assert.equal(fila.aprobador_email, 'jefa@rld.cl');
  assert.ok(fila.fecha_publicacion);
  assert.equal(Novedades.getFeed(db, {}, ctxCualquiera()).recientes.length, 1);
});

test('32. aprobar rechaza si no esta EN_REVISION', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY' }), ctxResponsable());
  await Novedades.aprobar(db, { novedad_id: pub.novedad_id, fecha_limite_acuse: fechaLimiteValida_() }, ctxJefa());
  const segunda = await Novedades.aprobar(db, { novedad_id: pub.novedad_id, fecha_limite_acuse: fechaLimiteValida_() }, ctxJefa());
  assert.equal(segunda._validationError, true);
});

test('33. devolver: exige motivo >= 10 caracteres', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY' }), ctxResponsable());
  assert.equal((await Novedades.devolver(db, { novedad_id: pub.novedad_id }, ctxJefa()))._validationError, true);
  assert.equal((await Novedades.devolver(db, { novedad_id: pub.novedad_id, motivo: 'no' }, ctxJefa()))._validationError, true);
});

test('34. devolver: pasa a DEVUELTA, guarda el motivo y avisa al autor', async (t) => {
  const mock = conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY' }), ctxResponsable());
  const res = await Novedades.devolver(db, { novedad_id: pub.novedad_id, motivo: 'Falta citar el numero de la ley.' }, ctxJefa());
  assert.equal(res.estado, 'DEVUELTA');
  const fila = filas(db, 'NOVEDADES')[0];
  assert.equal(fila.estado, 'DEVUELTA');
  assert.equal(fila.motivo_devolucion, 'Falta citar el numero de la ley.');
  const aviso = mock.mock.calls.map((c) => c.arguments[0]).find((p) => p.to[0] === 'vanessa@rld.cl');
  assert.ok(aviso);
  assert.ok(aviso.text.indexOf('Falta citar el numero de la ley.') !== -1);
});

test('35. rechazar: terminal, no vuelve al autor', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY' }), ctxResponsable());
  const res = await Novedades.rechazar(db, { novedad_id: pub.novedad_id, motivo: 'No corresponde publicar esto como ley.' }, ctxJefa());
  assert.equal(res.estado, 'RECHAZADA');
  assert.equal((await Novedades.reenviar(db, { novedad_id: pub.novedad_id }, ctxResponsable()))._validationError, true);
});

test('36. reenviar: el autor corrige una DEVUELTA, vuelve a EN_REVISION y re-notifica', async (t) => {
  const mock = conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY' }), ctxResponsable());
  await Novedades.devolver(db, { novedad_id: pub.novedad_id, motivo: 'Falta la fecha de vigencia.' }, ctxJefa());
  mock.mock.resetCalls();
  const res = await Novedades.reenviar(db, { novedad_id: pub.novedad_id, titulo: 'Nueva ley (v2)' }, ctxResponsable());
  assert.equal(res.estado, 'EN_REVISION');
  const fila = filas(db, 'NOVEDADES')[0];
  assert.equal(fila.titulo, 'Nueva ley (v2)');
  assert.equal(fila.motivo_devolucion, '');
  assert.equal(destinatarios(mock).filter((d) => d === 'jefa@rld.cl').length, 1);
});

test('37. reenviar: ni la jefatura ni ADM pueden hacerlo en nombre del autor', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY' }), ctxResponsable());
  await Novedades.devolver(db, { novedad_id: pub.novedad_id, motivo: 'Falta la fecha de vigencia.' }, ctxJefa());
  assert.equal((await Novedades.reenviar(db, { novedad_id: pub.novedad_id }, ctxJefa()))._forbidden, true);
  assert.equal((await Novedades.reenviar(db, { novedad_id: pub.novedad_id }, ctxAdm()))._forbidden, true);
});

test('38. listarPendientesAprobacion: la jefatura ve solo su equipo; ADM ve todas', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db);
  seedArea(db, { area_id: 'RRHH', responsable_email: 'vanessa@rld.cl' });
  seedArea(db, { area_id: 'CONTABILIDAD', responsable_email: 'francisca@rld.cl' });
  const pub1 = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY', titulo: 'Ley de Vanessa' }), ctxResponsable());
  await Novedades.publicar(db, publicarBase_({ tipo: 'DICTAMEN', titulo: 'Dictamen de Francisca', area_id: 'CONTABILIDAD' }), ctxResponsable('francisca@rld.cl'));
  assert.deepEqual(Novedades.listarPendientesAprobacion(db, {}, ctxJefa()).pendientes.map((p) => p.novedad_id), [pub1.novedad_id]);
  assert.equal(Novedades.listarPendientesAprobacion(db, {}, ctxAdm()).pendientes.length, 2);
  assert.equal(Novedades.listarPendientesAprobacion(db, {}, ctxCualquiera()).pendientes.length, 0);
});

test('39. misPendientes: el autor ve sus no-publicadas, no las publicadas', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const enRevision = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY', titulo: 'En revision' }), ctxResponsable());
  const devuelta = await Novedades.publicar(db, publicarBase_({ tipo: 'DICTAMEN', titulo: 'Devuelta' }), ctxResponsable());
  await Novedades.devolver(db, { novedad_id: devuelta.novedad_id, motivo: 'Falta un detalle importante.' }, ctxJefa());
  const publicada = await Novedades.publicar(db, publicarBase_({ tipo: 'AVISO', titulo: 'Ya publicada' }), ctxResponsable());
  const ids = Novedades.misPendientes(db, {}, ctxResponsable()).envios.map((e) => e.novedad_id);
  assert.ok(ids.includes(enRevision.novedad_id));
  assert.ok(ids.includes(devuelta.novedad_id));
  assert.ok(!ids.includes(publicada.novedad_id));
});

test('40. getHistorial registra las transiciones en orden y respeta la visibilidad', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY' }), ctxResponsable());
  assert.equal(Novedades.getHistorial(db, { novedad_id: pub.novedad_id }, ctxCualquiera())._forbidden, true);
  await Novedades.devolver(db, { novedad_id: pub.novedad_id, motivo: 'Falta la fecha de vigencia.' }, ctxJefa());
  await Novedades.reenviar(db, { novedad_id: pub.novedad_id }, ctxResponsable());
  await Novedades.aprobar(db, { novedad_id: pub.novedad_id, fecha_limite_acuse: fechaLimiteValida_() }, ctxJefa());
  const eventos = Novedades.getHistorial(db, { novedad_id: pub.novedad_id }, ctxCualquiera()).eventos.map((e) => e.evento);
  assert.deepEqual(eventos, ['ENVIADA_REVISION', 'DEVUELTA', 'ENVIADA_REVISION', 'APROBADA']);
});

test('41. sin jefatura configurada, el aviso de revision cae a ADM', async (t) => {
  const mock = conMock(t);
  const db = dbBase(); seedAudiencia(db); seedArea(db);
  agregarFila_(db, 'USUARIOS', { usuario_id: 'U9', nombre: 'Admin General', email: 'adm@rld.cl', empresa_id: 'RLD', rol: 'ADM', activo: true, ultimo_acceso: '', creado_por: 'seed' });
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY' }), ctxResponsable());
  assert.equal(pub.estado, 'EN_REVISION');
  assert.equal(destinatarios(mock).filter((d) => d === 'adm@rld.cl').length, 1);
});

// --- 42-50: audiencia dirigida ----------------------------------------------

test('42. publicar LIBRE con SELECCION: solo el destinatario elegido (y el autor) la ven', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ audiencia_tipo: 'SELECCION', destinatarios: ['leo@rld.cl'] }), ctxResponsable());
  assert.equal(pub.estado, 'PUBLICADA');
  assert.equal(Novedades.getFeed(db, {}, { email: 'leo@rld.cl', rol: 'DEV' }).recientes.length, 1);
  assert.equal(Novedades.getFeed(db, {}, ctxCualquiera()).recientes.length, 0);
  assert.equal(Novedades.getFeed(db, {}, ctxResponsable()).recientes.length, 1);
  assert.equal(Novedades.getDetalle(db, { novedad_id: pub.novedad_id }, ctxCualquiera())._forbidden, true);
});

test('43. audiencia TODOS explicita: reservada a jefatura/ADM', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  assert.equal((await Novedades.publicar(db, publicarBase_({ audiencia_tipo: 'TODOS' }), ctxResponsable()))._forbidden, true);
  const ok = await Novedades.publicar(db, publicarBase_({ audiencia_tipo: 'TODOS', area_id: '' }), ctxAdm());
  assert.equal(ok.estado, 'PUBLICADA');
  assert.equal(Novedades.getFeed(db, {}, ctxCualquiera()).recientes.length, 1);
});

test('44. audiencia MI_EQUIPO: solo jefatura/ADM con equipo, visible solo al equipo', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  assert.equal((await Novedades.publicar(db, publicarBase_({ audiencia_tipo: 'MI_EQUIPO' }), ctxResponsable()))._forbidden, true);
  seedArea(db, { area_id: 'GENERAL', responsable_email: 'jefa@rld.cl' });
  const pub = await Novedades.publicar(db, publicarBase_({ audiencia_tipo: 'MI_EQUIPO', area_id: 'GENERAL' }), ctxJefa());
  assert.equal(pub.estado, 'PUBLICADA');
  assert.equal(Novedades.getFeed(db, {}, ctxResponsable()).recientes.length, 1);
  assert.equal(Novedades.getFeed(db, {}, ctxCualquiera()).recientes.length, 0);
});

test('45. SELECCION exige al menos un destinatario', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  assert.equal((await Novedades.publicar(db, publicarBase_({ audiencia_tipo: 'SELECCION', destinatarios: [] }), ctxResponsable()))._validationError, true);
});

test('46. SELECCION rechaza un destinatario sin credenciales activas', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  assert.equal((await Novedades.publicar(db, publicarBase_({ audiencia_tipo: 'SELECCION', destinatarios: ['nadie@fuera.cl'] }), ctxResponsable()))._validationError, true);
});

test('47. aprobar: la audiencia la elige quien aprueba (SELECCION), no el autor', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY' }), ctxResponsable());
  const aprobado = await Novedades.aprobar(db, { novedad_id: pub.novedad_id, audiencia_tipo: 'SELECCION', destinatarios: ['leo@rld.cl'], fecha_limite_acuse: fechaLimiteValida_() }, ctxJefa());
  assert.equal(aprobado.estado, 'PUBLICADA');
  assert.equal(Novedades.getFeed(db, {}, { email: 'leo@rld.cl', rol: 'DEV' }).recientes.length, 1);
  assert.equal(Novedades.getFeed(db, {}, ctxCualquiera()).recientes.length, 0);
  assert.equal(Novedades.getDetalle(db, { novedad_id: pub.novedad_id }, ctxResponsable())._forbidden, undefined);
  assert.equal(Novedades.getDetalle(db, { novedad_id: pub.novedad_id }, ctxJefa())._forbidden, undefined);
  assert.equal(Novedades.getDetalle(db, { novedad_id: pub.novedad_id }, ctxAdm())._forbidden, undefined);
});

test('48. getLectores: con SELECCION, la audiencia se acota a los destinatarios', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ audiencia_tipo: 'SELECCION', destinatarios: ['leo@rld.cl'] }), ctxResponsable());
  const lectores = Novedades.getLectores(db, { novedad_id: pub.novedad_id }, ctxResponsable());
  assert.equal(lectores.total_audiencia, 1);
  assert.deepEqual(lectores.pendientes.map((p) => p.email), ['leo@rld.cl']);
});

test('49. recordatorioPendientes no molesta a quien esta fuera de la audiencia dirigida', async (t) => {
  const mock = conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  await Novedades.publicar(db, publicarBase_({ titulo: 'Solo para Leo', audiencia_tipo: 'SELECCION', destinatarios: ['leo@rld.cl'] }), ctxResponsable());
  const res = await Novedades.recordatorioPendientes(db);
  assert.equal(res.enviados, 1);
  const dst = destinatarios(mock);
  assert.ok(dst.includes('leo@rld.cl'));
  assert.ok(!dst.includes('juan@homepymes.cl'));
});

test('50. listarAreasPublicables expone directorio/equipo/puede_todos/puede_equipo', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const paraResp = Novedades.listarAreasPublicables(db, {}, ctxResponsable());
  assert.equal(paraResp.puede_todos, false);
  assert.equal(paraResp.puede_equipo, false);
  assert.equal(paraResp.equipo.length, 0);
  assert.ok(paraResp.directorio.some((p) => p.email === 'leo@rld.cl'));
  const paraJefa = Novedades.listarAreasPublicables(db, {}, ctxJefa());
  assert.equal(paraJefa.puede_todos, true);
  assert.equal(paraJefa.puede_equipo, true);
  assert.equal(paraJefa.equipo.length, 0);
  assert.equal(Novedades.listarAreasPublicables(db, {}, ctxAdm()).puede_todos, true);
});

// --- 51-58: cumplimiento (fecha limite) -------------------------------------

test('51. aprobar Ley/Dictamen SIN fecha limite: error', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'DICTAMEN' }), ctxResponsable());
  assert.equal((await Novedades.aprobar(db, { novedad_id: pub.novedad_id }, ctxJefa()))._validationError, true);
});

test('52. aprobar Ley/Dictamen con fecha en el pasado: error', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY' }), ctxResponsable());
  const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
  assert.equal((await Novedades.aprobar(db, { novedad_id: pub.novedad_id, fecha_limite_acuse: ayer.toISOString().slice(0, 10) }, ctxJefa()))._validationError, true);
});

test('53. aprobar Procedimiento sin fecha limite: opcional, se aprueba igual', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'PROCEDIMIENTO' }), ctxResponsable());
  const res = await Novedades.aprobar(db, { novedad_id: pub.novedad_id }, ctxJefa());
  assert.equal(res.estado, 'PUBLICADA');
  assert.equal(filas(db, 'NOVEDADES')[0].fecha_limite_acuse, '');
});

test('54. publicar LIBRE: fecha limite opcional, se valida si se manda', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
  assert.equal((await Novedades.publicar(db, publicarBase_({ fecha_limite_acuse: ayer.toISOString().slice(0, 10) }), ctxResponsable()))._validationError, true);
  const ok = await Novedades.publicar(db, publicarBase_({ fecha_limite_acuse: fechaLimiteValida_() }), ctxResponsable());
  assert.equal(ok.estado, 'PUBLICADA');
  assert.equal(filas(db, 'NOVEDADES')[0].fecha_limite_acuse, fechaLimiteValida_());
});

test('55. getDetalle expone fecha_limite_acuse y dias_para_vencer', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY' }), ctxResponsable());
  await Novedades.aprobar(db, { novedad_id: pub.novedad_id, fecha_limite_acuse: fechaLimiteValida_(5) }, ctxJefa());
  const detalle = Novedades.getDetalle(db, { novedad_id: pub.novedad_id }, ctxAdm());
  assert.equal(detalle.fecha_limite_acuse, fechaLimiteValida_(5));
  assert.equal(detalle.dias_para_vencer, 5);
});

test('56. getPanelCumplimiento: solo ADM', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  assert.equal(Novedades.getPanelCumplimiento(db, {}, ctxJefa())._forbidden, true);
  assert.equal(Novedades.getPanelCumplimiento(db, {}, ctxCualquiera())._forbidden, true);
  assert.ok(Array.isArray(Novedades.getPanelCumplimiento(db, {}, ctxAdm()).items));
});

test('57. getPanelCumplimiento: semaforo y conteos', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const vencida = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY', titulo: 'Vencida' }), ctxResponsable());
  await Novedades.aprobar(db, { novedad_id: vencida.novedad_id, fecha_limite_acuse: fechaLimiteValida_(1) }, ctxJefa());
  const pasado = new Date(); pasado.setDate(pasado.getDate() - 3);
  actualizarFilaPorId_(db, 'NOVEDADES', 'novedad_id', vencida.novedad_id, { fecha_limite_acuse: pasado.toISOString().slice(0, 10) });

  const cumplida = await Novedades.publicar(db, publicarBase_({ tipo: 'DICTAMEN', titulo: 'Cumplida' }), ctxResponsable());
  await Novedades.aprobar(db, { novedad_id: cumplida.novedad_id, fecha_limite_acuse: fechaLimiteValida_(10) }, ctxJefa());
  Novedades.marcarLeida(db, { novedad_id: cumplida.novedad_id }, ctxCualquiera());
  Novedades.marcarLeida(db, { novedad_id: cumplida.novedad_id }, { email: 'leo@rld.cl', rol: 'DEV' });

  const panel = Novedades.getPanelCumplimiento(db, {}, ctxAdm());
  const porTitulo = {};
  panel.items.forEach((i) => { porTitulo[i.titulo] = i; });
  assert.equal(porTitulo['Vencida'].estado_cumplimiento, 'VENCIDA');
  assert.ok(porTitulo['Vencida'].pendientes > 0);
  assert.equal(porTitulo['Cumplida'].estado_cumplimiento, 'CUMPLIDA');
  assert.equal(porTitulo['Cumplida'].pendientes, 0);
  assert.equal(porTitulo['Cumplida'].confirmados, porTitulo['Cumplida'].total_audiencia);
});

test('58. getPanelCumplimiento no incluye sin-plazo ni inactivas', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const sinPlazo = await Novedades.publicar(db, publicarBase_({ tipo: 'PROCEDIMIENTO', titulo: 'Sin plazo' }), ctxResponsable());
  await Novedades.aprobar(db, { novedad_id: sinPlazo.novedad_id }, ctxJefa());
  const retirada = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY', titulo: 'Retirada' }), ctxResponsable());
  await Novedades.aprobar(db, { novedad_id: retirada.novedad_id, fecha_limite_acuse: fechaLimiteValida_() }, ctxJefa());
  Novedades.despublicar(db, { novedad_id: retirada.novedad_id }, ctxAdm());
  const titulos = Novedades.getPanelCumplimiento(db, {}, ctxAdm()).items.map((i) => i.titulo);
  assert.ok(!titulos.includes('Sin plazo'));
  assert.ok(!titulos.includes('Retirada'));
});

// --- 59-64: guardias de acuse y contradiccion acuse/plazo -------------------

test('59. marcarLeida: no se puede acusar recibo de lo que no se puede leer', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY' }), ctxResponsable());
  const r = Novedades.marcarLeida(db, { novedad_id: pub.novedad_id }, ctxCualquiera());
  assert.equal(r._forbidden, true);
  assert.equal(filas(db, 'NOVEDADES_LECTURAS').length, 0);
});

test('60. marcarLeida sigue funcionando en el caso normal', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_(), ctxResponsable());
  const r = Novedades.marcarLeida(db, { novedad_id: pub.novedad_id }, ctxCualquiera());
  assert.equal(r.leida, true);
  assert.equal(filas(db, 'NOVEDADES_LECTURAS').length, 1);
});

test('61. un plazo para dar acuse exige que haya acuse', async (t) => {
  conMock(t);
  const db = dbBase(); seedArea(db);
  const r = await Novedades.publicar(db, publicarBase_({ requiere_acuse: false, fecha_limite_acuse: fechaLimiteValida_() }), ctxResponsable());
  assert.equal(r._validationError, true);
  assert.equal(filas(db, 'NOVEDADES').length, 0);
});

test('62. sin acuse y sin plazo se publica igual', async (t) => {
  conMock(t);
  const db = dbBase(); seedArea(db);
  const r = await Novedades.publicar(db, publicarBase_({ requiere_acuse: false }), ctxResponsable());
  assert.equal(r._validationError, undefined);
  const fila = filas(db, 'NOVEDADES')[0];
  assert.equal(fila.requiere_acuse, false);
  assert.equal(fila.fecha_limite_acuse, '');
});

test('63. Ley y Dictamen no se pueden publicar sin acuse', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const r = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY', requiere_acuse: false }), ctxResponsable());
  assert.equal(r._validationError, true);
  assert.ok(/acuse/i.test(JSON.stringify(r.fields || r.message || '')));
});

test('64. una fila vieja contradictoria se puede rechazar', async (t) => {
  conMock(t);
  const db = dbBase(); seedAudiencia(db); seedJefatura(db); seedArea(db);
  const pub = await Novedades.publicar(db, publicarBase_({ tipo: 'LEY' }), ctxResponsable());
  actualizarFilaPorId_(db, 'NOVEDADES', 'novedad_id', pub.novedad_id, { requiere_acuse: false });
  const alAprobar = await Novedades.aprobar(db, { novedad_id: pub.novedad_id, fecha_limite_acuse: fechaLimiteValida_() }, ctxJefa());
  assert.equal(alAprobar._validationError, true);
  const alRechazar = await Novedades.rechazar(db, { novedad_id: pub.novedad_id, motivo: 'Se rehace con el acuse marcado.' }, ctxJefa());
  assert.equal(alRechazar.estado, 'RECHAZADA');
});
