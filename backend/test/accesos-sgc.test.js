'use strict';

// v10.0 "Accesos SGC" — el panel admin-only de "quién ve qué" + el
// endurecimiento de los permisos antes de activar el módulo al personal.
//
// Lo que protegen estos tests, por orden de importancia:
//  1. Repartir accesos es EXCLUSIVO del administrador. Ni siquiera un
//     ENCARGADO_SGC (que gestiona todo el contenido) puede asignar roles.
//  2. Un operativo con área X ve solo los documentos generales + los de su
//     área, nunca los de otra área ni los de selección ajena.
//  3. Las secciones de gobierno (proveedores, revisión, objetivos, cobertura,
//     capacitaciones) no están al alcance del operativo.
//  4. La previsualización dice la verdad: lo que reporta = lo que la persona
//     realmente vería.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function loadConSchema() {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'raiz' }
  });
  seedSheet(ctx, 'SGC_DOCUMENTOS', ctx.COLUMNAS.SGC_DOCUMENTOS);
  seedSheet(ctx, 'SGC_DOC_VERSIONES', ctx.COLUMNAS.SGC_DOC_VERSIONES);
  seedSheet(ctx, 'SGC_DOC_DESTINATARIOS', ctx.COLUMNAS.SGC_DOC_DESTINATARIOS);
  seedSheet(ctx, 'SGC_DOC_ACUSES', ctx.COLUMNAS.SGC_DOC_ACUSES);
  seedSheet(ctx, 'SGC_ROLES', ctx.COLUMNAS.SGC_ROLES);
  seedSheet(ctx, 'SGC_PERSONAS', ctx.COLUMNAS.SGC_PERSONAS);
  seedSheet(ctx, 'SGC_NC', ctx.COLUMNAS.SGC_NC);
  seedSheet(ctx, 'SGC_AUDITORIAS', ctx.COLUMNAS.SGC_AUDITORIAS);
  seedSheet(ctx, 'SGC_CAPACITACIONES', ctx.COLUMNAS.SGC_CAPACITACIONES);
  seedSheet(ctx, 'SGC_CAPACITACION_ASISTENTES', ctx.COLUMNAS.SGC_CAPACITACION_ASISTENTES);
  seedSheet(ctx, 'CAT_AREAS', ctx.COLUMNAS.CAT_AREAS);
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS);
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL);
  seedSheet(ctx, 'JEFATURAS', ctx.COLUMNAS.JEFATURAS);
  seedSheet(ctx, 'LOG_SISTEMA', ctx.COLUMNAS.LOG_SISTEMA);
  seedSheet(ctx, 'LOG_NOTIFICACIONES', ctx.COLUMNAS.LOG_NOTIFICACIONES);
  seedSheet(ctx, 'NOTIFICACIONES_APP', ctx.COLUMNAS.NOTIFICACIONES_APP);
  seedSheet(ctx, 'CONFIG_NOTIFICACIONES', ctx.COLUMNAS.CONFIG_NOTIFICACIONES);

  ctx.agregarFila_(ctx.SHEETS.CAT_AREAS, { area_id: 'PREVENCION', nombre: 'Prevención', activo: true });
  ctx.agregarFila_(ctx.SHEETS.CAT_AREAS, { area_id: 'ADMIN', nombre: 'Administración', activo: true });
  ctx.agregarFila_(ctx.SHEETS.CUENTAS_PORTAL, { cuenta_id: 'CTA-1', usuario: 'ana', nombre: 'Ana Torres', emails: JSON.stringify(['ana@homepymes.cl']), activo: true });
  ctx.agregarFila_(ctx.SHEETS.CUENTAS_PORTAL, { cuenta_id: 'CTA-2', usuario: 'bruno', nombre: 'Bruno Díaz', emails: JSON.stringify(['bruno@homepymes.cl']), activo: true });
  return ctx;
}

const CTX_ADMIN = { email: 'admin@homepymes.cl', nombre: 'Admin', rol: 'ADM' };
const CTX_ENCARGADO = { email: 'sgc@homepymes.cl', nombre: 'Encargado SGC', rol: 'DEV' };
const CTX_ANA = { email: 'ana@homepymes.cl', nombre: 'Ana', rol: '' };

function sembrarEncargado(ctx) {
  ctx.Calidad.gestionarRol({ usuario_email: 'sgc@homepymes.cl', rol_sgc: 'ENCARGADO_SGC' }, CTX_ADMIN);
}

// --- repartir accesos es exclusivo del administrador -------------------------

test('Accesos: asignar un rol es admin-only -- ni siquiera el Encargado SGC puede', () => {
  const ctx = loadConSchema();
  sembrarEncargado(ctx);

  // El Encargado SGC gestiona el contenido, pero NO reparte accesos.
  const intento = toPlain(ctx.Calidad.gestionarRol(
    { usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO' }, CTX_ENCARGADO));
  assert.equal(intento._forbidden, true);

  // El admin sí.
  const ok = toPlain(ctx.Calidad.gestionarRol(
    { usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADMIN));
  assert.ok(ok.rol_id, 'el admin sí puede asignar');
});

test('Accesos: el panel (listarAccesos) es admin-only y cruza cuentas con su rol', () => {
  const ctx = loadConSchema();
  sembrarEncargado(ctx);
  ctx.Calidad.gestionarRol({ usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADMIN);

  assert.equal(toPlain(ctx.Calidad.listarAccesos({}, CTX_ENCARGADO))._forbidden, true);
  assert.equal(toPlain(ctx.Calidad.listarAccesos({}, CTX_ANA))._forbidden, true);

  const panel = toPlain(ctx.Calidad.listarAccesos({}, CTX_ADMIN));
  // Las dos cuentas del portal aparecen.
  const ana = panel.cuentas.filter(function (c) { return c.email === 'ana@homepymes.cl'; })[0];
  assert.equal(ana.rol_sgc, 'OPERATIVO');
  assert.equal(ana.area_id, 'PREVENCION');
  const bruno = panel.cuentas.filter(function (c) { return c.email === 'bruno@homepymes.cl'; })[0];
  assert.equal(bruno.rol_sgc, '', 'Bruno no tiene rol todavía');
  // Trae el catálogo de áreas y de roles (auto-explicativo).
  assert.ok(panel.areas.length >= 2);
  assert.ok(panel.roles.some(function (r) { return r.clave === 'ENCARGADO_SGC' && /reparte/.test(r.descripcion) === false || r.clave === 'ENCARGADO_SGC'; }));
});

// --- confidencialidad por documento ------------------------------------------

test('Accesos: un operativo de un área ve los generales + los de su área, no los de otra', () => {
  const ctx = loadConSchema();
  sembrarEncargado(ctx);
  ctx.Calidad.gestionarRol({ usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADMIN);

  ctx.Calidad.crearDocumento({ codigo: 'DOC-GEN', nombre: 'Manual general', tipo: 'DOC', visibilidad: 'TODOS' }, CTX_ENCARGADO);
  ctx.Calidad.crearDocumento({ codigo: 'PRO-PREV', nombre: 'Procedimiento de prevención', tipo: 'PRO', visibilidad: 'AREA', area_id: 'PREVENCION' }, CTX_ENCARGADO);
  ctx.Calidad.crearDocumento({ codigo: 'PRO-ADM', nombre: 'Procedimiento admin', tipo: 'PRO', visibilidad: 'AREA', area_id: 'ADMIN' }, CTX_ENCARGADO);

  const previa = toPlain(ctx.Calidad.previsualizarAcceso({ email: 'ana@homepymes.cl' }, CTX_ADMIN));
  const codigos = previa.documentos.map(function (d) { return d.codigo; }).sort();
  assert.deepEqual(codigos, ['DOC-GEN', 'PRO-PREV'], 've el general y el de su área, no el de Administración');
  assert.equal(previa.personas_scope, 'solo su propia ficha');
});

test('Accesos: previsualizar refleja que el operativo NO alcanza las secciones de gobierno', () => {
  const ctx = loadConSchema();
  sembrarEncargado(ctx);
  ctx.Calidad.gestionarRol({ usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADMIN);

  const previa = toPlain(ctx.Calidad.previsualizarAcceso({ email: 'ana@homepymes.cl' }, CTX_ADMIN));
  const s = previa.secciones;
  assert.equal(s.documentos, true);
  assert.equal(s.personas, true);
  ['proveedores', 'revision', 'objetivos', 'cobertura', 'capacitaciones', 'accesos'].forEach(function (k) {
    assert.equal(s[k], false, 'el operativo no alcanza ' + k);
  });
});

// --- el mapa de secciones que llega al frontend ------------------------------

test('Accesos: listarDocumentos entrega secciones_visibles acotado para el operativo y con accesos solo para el admin', () => {
  const ctx = loadConSchema();
  sembrarEncargado(ctx);
  ctx.Calidad.gestionarRol({ usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADMIN);

  const opera = toPlain(ctx.Calidad.listarDocumentos({}, CTX_ANA)).secciones_visibles;
  assert.equal(opera.accesos, false);
  assert.equal(opera.proveedores, false);
  assert.equal(opera.capacitaciones, false);

  const admin = toPlain(ctx.Calidad.listarDocumentos({}, CTX_ADMIN)).secciones_visibles;
  assert.equal(admin.accesos, true);
  assert.equal(admin.proveedores, true);
});

// --- la fuga de capacitaciones queda cerrada ---------------------------------

test('Accesos: un operativo ya no puede listar el programa de capacitaciones', () => {
  const ctx = loadConSchema();
  sembrarEncargado(ctx);
  ctx.Calidad.gestionarRol({ usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADMIN);

  const bloqueado = toPlain(ctx.Personas.listarCapacitaciones({}, CTX_ANA));
  assert.equal(bloqueado._forbidden, true);

  // El Encargado SGC sí (es gestión).
  const ok = toPlain(ctx.Personas.listarCapacitaciones({}, CTX_ENCARGADO));
  assert.ok(ok.capacitaciones, 'la gestión sí ve el programa');
});

// --- quitar acceso ------------------------------------------------------------

test('Accesos: quitar un rol lo desactiva y la persona vuelve a ver solo lo general', () => {
  const ctx = loadConSchema();
  sembrarEncargado(ctx);
  const asignado = toPlain(ctx.Calidad.gestionarRol(
    { usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADMIN));

  ctx.Calidad.crearDocumento({ codigo: 'PRO-PREV', nombre: 'Proc prevención', tipo: 'PRO', visibilidad: 'AREA', area_id: 'PREVENCION' }, CTX_ENCARGADO);

  // Con rol+área ve el de su área.
  let previa = toPlain(ctx.Calidad.previsualizarAcceso({ email: 'ana@homepymes.cl' }, CTX_ADMIN));
  assert.ok(previa.documentos.some(function (d) { return d.codigo === 'PRO-PREV'; }));

  // Se le quita el acceso.
  const quitado = toPlain(ctx.Calidad.gestionarRol({ accion: 'quitar', rol_id: asignado.rol_id }, CTX_ADMIN));
  assert.ok(quitado === true || quitado.actualizado !== false);

  // Ya no ve el documento de área (sin rol → sin área).
  previa = toPlain(ctx.Calidad.previsualizarAcceso({ email: 'ana@homepymes.cl' }, CTX_ADMIN));
  assert.equal(previa.documentos.some(function (d) { return d.codigo === 'PRO-PREV'; }), false);
  assert.equal(previa.rol_sgc, '');
});

// --- v10.0 "Centro de Control de Accesos" ------------------------------------
// Matriz de distribución, confidenciales, y la previsualización enriquecida
// (confidencial/confirmado por documento, rol de sistema real).

test('Centro de Control: getMatrizDistribucion y getDocumentosConfidenciales son admin-only', () => {
  const ctx = loadConSchema();
  sembrarEncargado(ctx);
  assert.equal(toPlain(ctx.Calidad.getMatrizDistribucion({}, CTX_ENCARGADO))._forbidden, true);
  assert.equal(toPlain(ctx.Calidad.getDocumentosConfidenciales({}, CTX_ENCARGADO))._forbidden, true);
  assert.equal(toPlain(ctx.Calidad.getMatrizDistribucion({}, CTX_ANA))._forbidden, true);
});

test('Centro de Control: la matriz marca confirmado/pendiente/no-corresponde correctamente', () => {
  const ctx = loadConSchema();
  sembrarEncargado(ctx);
  ctx.Calidad.gestionarRol({ usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADMIN);
  ctx.Calidad.crearDocumento({ codigo: 'DOC-GEN', nombre: 'Manual general', tipo: 'DOC', visibilidad: 'TODOS' }, CTX_ENCARGADO);
  ctx.Calidad.crearDocumento({ codigo: 'PRO-ADM', nombre: 'Procedimiento admin', tipo: 'PRO', visibilidad: 'AREA', area_id: 'ADMIN' }, CTX_ENCARGADO);

  // Ana confirma el general.
  ctx.Calidad.acusarDocumento({ documento_id: ctx.leerFilas_(ctx.SHEETS.SGC_DOCUMENTOS).filter(function (d) { return d.codigo === 'DOC-GEN'; })[0].documento_id }, CTX_ANA);

  const matriz = toPlain(ctx.Calidad.getMatrizDistribucion({}, CTX_ADMIN));
  const cols = matriz.documentos.map(function (d) { return d.codigo; });
  const iGen = cols.indexOf('DOC-GEN');
  const iAdm = cols.indexOf('PRO-ADM');
  const filaAna = matriz.personas.filter(function (p) { return p.email === 'ana@homepymes.cl'; })[0];
  assert.equal(filaAna.celdas[iGen].estado, 'confirmado', 've el general y ya confirmó');
  assert.equal(filaAna.celdas[iAdm].estado, 'no', 'no le corresponde (es de otra área)');

  const filaBruno = matriz.personas.filter(function (p) { return p.email === 'bruno@homepymes.cl'; })[0];
  assert.equal(filaBruno.celdas[iGen].estado, 'pendiente', 've el general pero no ha confirmado');
});

test('Centro de Control: confidenciales lista exactamente quién está en cada documento SELECCION', () => {
  const ctx = loadConSchema();
  sembrarEncargado(ctx);
  ctx.Calidad.crearDocumento({
    codigo: 'FO-CONF', nombre: 'Formulario confidencial', tipo: 'FO', visibilidad: 'SELECCION',
    destinatarios: ['ana@homepymes.cl']
  }, CTX_ENCARGADO);
  ctx.Calidad.crearDocumento({ codigo: 'DOC-GEN', nombre: 'Manual general', tipo: 'DOC', visibilidad: 'TODOS' }, CTX_ENCARGADO);

  const conf = toPlain(ctx.Calidad.getDocumentosConfidenciales({}, CTX_ADMIN));
  assert.equal(conf.length, 1, 'solo el documento SELECCION aparece, no el general');
  assert.equal(conf[0].codigo, 'FO-CONF');
  assert.deepEqual(conf[0].destinatarios.map(function (d) { return d.email; }), ['ana@homepymes.cl']);
});

test('Centro de Control: la previsualización marca confidencial/confirmado por documento y cuenta pendientes', () => {
  const ctx = loadConSchema();
  sembrarEncargado(ctx);
  ctx.Calidad.gestionarRol({ usuario_email: 'ana@homepymes.cl', rol_sgc: 'OPERATIVO', area_id: 'PREVENCION' }, CTX_ADMIN);
  ctx.Calidad.crearDocumento({
    codigo: 'FO-CONF', nombre: 'Formulario confidencial', tipo: 'FO', visibilidad: 'SELECCION',
    destinatarios: ['ana@homepymes.cl']
  }, CTX_ENCARGADO);
  ctx.Calidad.crearDocumento({ codigo: 'DOC-GEN', nombre: 'Manual general', tipo: 'DOC', visibilidad: 'TODOS' }, CTX_ENCARGADO);

  var previa = toPlain(ctx.Calidad.previsualizarAcceso({ email: 'ana@homepymes.cl' }, CTX_ADMIN));
  var conf = previa.documentos.filter(function (d) { return d.codigo === 'FO-CONF'; })[0];
  var gen = previa.documentos.filter(function (d) { return d.codigo === 'DOC-GEN'; })[0];
  assert.equal(conf.confidencial, true);
  assert.equal(gen.confidencial, false);
  assert.equal(conf.confirmado, false);
  assert.equal(previa.pendientes_acuse, 2, 'ninguno de los dos documentos con acuse exigido está confirmado');

  ctx.Calidad.acusarDocumento({ documento_id: ctx.leerFilas_(ctx.SHEETS.SGC_DOCUMENTOS).filter(function (d) { return d.codigo === 'FO-CONF'; })[0].documento_id }, CTX_ANA);
  previa = toPlain(ctx.Calidad.previsualizarAcceso({ email: 'ana@homepymes.cl' }, CTX_ADMIN));
  conf = previa.documentos.filter(function (d) { return d.codigo === 'FO-CONF'; })[0];
  assert.equal(conf.confirmado, true);
  assert.equal(previa.pendientes_acuse, 1);
});

test('Centro de Control: avisa cuando la cuenta además es ADM/GERENCIA de SIGSO (ve todo igual)', () => {
  const ctx = loadConSchema();
  sembrarEncargado(ctx);
  ctx.agregarFila_(ctx.SHEETS.USUARIOS, { email: 'gerente@homepymes.cl', nombre: 'Gerente', rol: 'GERENCIA', activo: true });

  var previaOperativa = toPlain(ctx.Calidad.previsualizarAcceso({ email: 'ana@homepymes.cl' }, CTX_ADMIN));
  assert.equal(previaOperativa.acceso_amplio_sistema, false);

  var previaGerencia = toPlain(ctx.Calidad.previsualizarAcceso({ email: 'gerente@homepymes.cl' }, CTX_ADMIN));
  assert.equal(previaGerencia.rol_sistema, 'GERENCIA');
  assert.equal(previaGerencia.acceso_amplio_sistema, true);
});
