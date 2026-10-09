'use strict';

/**
 * Portal de clientes, etapa 2 (2026-10-07): el contratista pide, conversa,
 * descarga y confirma. Todo acotado a su empresa.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { ejecutarAccion } = require('../server/router');
const Sesiones = require('../logica/sesiones');

delete process.env.RESEND_API_KEY;

const SUPER = 'luis@ctrly.cl', VANESSA = 'vanessa@homepymes.cl', LISSETH = 'lisseth@homepymes.cl';
const RUT_PEDRO = '12.345.678-5', RUT_ANA = '11.111.111-1';

function dbPortal() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((hoja) => sembrarTabla_(db, hoja, COLUMNAS[hoja], []));
  sembrarTabla_(db, 'CONFIG_SLA', COLUMNAS.CONFIG_SLA, [['P1', 2], ['P2', 24], ['P3', 72], ['P4', 120], ['P5', '']]);
  sembrarTabla_(db, 'CAT_EMPRESAS', COLUMNAS.CAT_EMPRESAS, [['HP', 'HomePymes', '', true, '']]);
  const vacio = (hoja) => Object.fromEntries(COLUMNAS[hoja].map((c) => [c, '']));
  [['Luis', SUPER, 'ADM', true], ['Vanessa Sepúlveda', VANESSA, 'SOLICITANTE', false], ['Lisseth Vilchez', LISSETH, 'SOLICITANTE', false]]
    .forEach(([n, e, r, sa]) => agregarFila_(db, 'CUENTAS_PORTAL', Object.assign(vacio('CUENTAS_PORTAL'), {
      cuenta_id: 'c-' + e, usuario: e.split('@')[0], nombre: n, emails: JSON.stringify([e]), rol: r, activo: true, empresa_id: 'HP', super_admin: sa })));
  [[VANESSA, 'REGISTRA'], [LISSETH, 'JEFATURA']].forEach(([e, r], i) => agregarFila_(db, 'CI_MIEMBROS', { miembro_id: 'm' + i, depto: 'RRHH', usuario_email: e, rol: r, activa: true }));
  [['CLI-1', 'Constructora Cerro Alto SpA', '76.543.210-K'], ['CLI-2', 'Constructora Vecina SpA', '77.777.777-7']]
    .forEach(([id, n, rut]) => agregarFila_(db, 'CAT_CLIENTES', Object.assign(vacio('CAT_CLIENTES'), { cliente_id: id, razon_social: n, rut, activo: true })));
  return db;
}
async function staff(db, email, action, data) {
  return ejecutarAccion(db, action, Object.assign({ portal_token: Sesiones.crearSesion(db, 'c-' + email) }, data || {}), { ip: '10.0.0.1' });
}
async function cliente(db, action, data) { return ejecutarAccion(db, action, data || {}, { ip: '200.1.1.1' }); }
function filas(db, hoja) { return leerFilas_(db, hoja, COLUMNAS[hoja]); }
async function activado(db, clienteId, rut, nombre) {
  let r = await staff(db, SUPER, 'portalAdmGuardarCliente', { cliente_id: clienteId, habilitado: true, servicios: ['RRHH'], encargados: { RRHH: VANESSA } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await staff(db, SUPER, 'portalAdmInvitar', { cliente_id: clienteId, nombre, rut, telefono: '9 5555 0099' });
  r = await cliente(db, 'clienteActivar', { invitacion: r.body.data.enlace.split('#invitacion=')[1], pin: '482915', pin2: '482915' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data.cliente_token;
}

test('contrato para dos personas: un ítem por persona, directo a su encargada, y quedan en «Mis trabajadores»', async () => {
  const db = dbPortal();
  const tok = await activado(db, 'CLI-1', RUT_PEDRO, 'Pedro Sáez');
  const obra = (await cliente(db, 'clienteGuardarObra', { cliente_token: tok, nombre: 'Los Robles', comuna: 'Puente Alto' })).body.data;
  const cat = (await cliente(db, 'clienteCatalogo', { cliente_token: tok })).body.data;
  assert.deepEqual(cat.areas.map((a) => a.clave), ['RRHH'], 'solo lo contratado');
  assert.equal(cat.areas[0].encargado, 'Vanessa Sepúlveda');
  assert.ok(cat.areas[0].servicios.some((s) => s.id === 'contrato'));
  assert.ok(cat.documentos.some((d) => d.id === 'doc_licencia') && !cat.documentos.some((d) => d.id === 'doc_comprobante'), 'documentos de lo contratado');
  const antes = filas(db, 'LOG_NOTIFICACIONES').length;
  let r = await cliente(db, 'clienteCrearPedido', { cliente_token: tok, plantilla_id: 'contrato', obra_id: obra.obra_id,
    personas: [{ nombre: 'Juan Pérez', rut: '12.345.678-5', cargo: 'Maestro', fecha_inicio: '14-10' }, { nombre: 'Ana Rojas', cargo: 'Ayudante' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const solId = r.body.data.solicitud_id;
  assert.equal(r.body.data.items, 2);
  assert.equal(r.body.data.recibe, 'Vanessa Sepúlveda');
  const sol = filas(db, 'SOLICITUDES').find((s) => s.solicitud_id === solId);
  assert.equal(sol.cliente_id, 'CLI-1');
  assert.equal(sol.origen, 'PORTAL');
  assert.equal(sol.empresa_cliente, 'Constructora Cerro Alto SpA');
  assert.equal(sol.cliente_obra, 'Los Robles');
  const subs = filas(db, 'SUBSOLICITUDES').filter((s) => s.solicitud_id === solId);
  assert.deepEqual(subs.map((s) => s.titulo), ['Contrato de trabajo · Juan Pérez', 'Contrato de trabajo · Ana Rojas']);
  assert.ok(subs.every((s) => s.depto === 'RRHH' && s.desarrollador_asignado === VANESSA), 'directo a la encargada');
  assert.match(subs[0].descripcion, /RUT: 12\.345\.678-5/);
  assert.ok(subs.every((s) => s.trabajador_id));
  const ts = (await cliente(db, 'clienteTrabajadores', { cliente_token: tok })).body.data.trabajadores;
  assert.deepEqual(ts.map((t) => t.nombre + ':' + t.estado).sort(), ['Ana Rojas:TRAMITE', 'Juan Pérez:TRAMITE']);
  // Sin correo: ningún envío a @portal.invalid (no dispara el aviso de «correo caído»).
  assert.ok(!filas(db, 'LOG_NOTIFICACIONES').slice(antes).some((n) => /portal\.invalid$/.test(n.destinatario)));
  r = await cliente(db, 'clientePedidos', { cliente_token: tok });
  assert.equal(r.body.data.pedidos.length, 1);
  assert.equal(r.body.data.pedidos[0].estado, 'ENVIADO');
  assert.equal(r.body.data.pedidos[0].titulo, 'Contrato de trabajo (2)');
  r = await cliente(db, 'clientePedido', { cliente_token: tok, solicitud_id: solId });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.subsolicitudes.length, 2);
  assert.equal(r.body.data.url_pdf, undefined);
  assert.ok(filas(db, 'PORTAL_REGISTRO').some((x) => x.accion === 'PEDIDO' && x.detalle.indexOf(solId) === 0));
});

test('finiquito de un trabajador propio; con un trabajador ajeno o un servicio no contratado, no', async () => {
  const db = dbPortal();
  const tok1 = await activado(db, 'CLI-1', RUT_PEDRO, 'Pedro Sáez');
  const tok2 = await activado(db, 'CLI-2', RUT_ANA, 'Ana Vecina');
  const juan = (await cliente(db, 'clienteGuardarTrabajador', { cliente_token: tok1, nombre: 'Juan Pérez', cargo: 'Maestro' })).body.data.trabajador_id;
  let r = await cliente(db, 'clienteCrearPedido', { cliente_token: tok2, plantilla_id: 'finiquito', trabajadores: [juan], motivo: 'Renuncia' });
  assert.equal(r.status, 400, 'no puede pedir el finiquito de un trabajador de otra empresa');
  r = await cliente(db, 'clienteCrearPedido', { cliente_token: tok1, plantilla_id: 'factura', datos: { a: 'X', monto: '1' } });
  assert.equal(r.status, 400, 'Contabilidad no está contratada');
  r = await cliente(db, 'clienteCrearPedido', { cliente_token: tok1, plantilla_id: 'finiquito', trabajadores: [juan], motivo: 'Término de obra', datos: { termino: '31-10' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const sub = filas(db, 'SUBSOLICITUDES').find((s) => s.solicitud_id === r.body.data.solicitud_id);
  assert.equal(sub.titulo, 'Finiquito · Juan Pérez');
  assert.match(sub.descripcion, /Motivo: Término de obra/);
  assert.match(sub.descripcion, /Último día de trabajo: 31-10/);
  assert.equal(sub.trabajador_id, juan);
});

test('el pedido de otra empresa no se ve, no se conversa, no se confirma y sus archivos no se bajan', async () => {
  const db = dbPortal();
  const tok1 = await activado(db, 'CLI-1', RUT_PEDRO, 'Pedro Sáez');
  const tok2 = await activado(db, 'CLI-2', RUT_ANA, 'Ana Vecina');
  const solId = (await cliente(db, 'clienteCrearPedido', { cliente_token: tok1, plantilla_id: 'f30', datos: { mes: 'septiembre', para: 'Inmobiliaria' } })).body.data.solicitud_id;
  const ARCH = '11111111-1111-1111-1111-111111111111';
  agregarFila_(db, 'ARCHIVOS', { archivo_id: ARCH, solicitud_id: solId, subsolicitud_id: solId + '-01', nombre_original: 'F30.pdf', url: 'https://api/v1/archivo/x?k=abc', tipo_mime: 'application/pdf' });
  assert.equal((await cliente(db, 'clientePedidos', { cliente_token: tok2 })).body.data.pedidos.length, 0);
  assert.equal((await cliente(db, 'clientePedido', { cliente_token: tok2, solicitud_id: solId })).status, 400);
  assert.equal((await cliente(db, 'clienteMensaje', { cliente_token: tok2, solicitud_id: solId, texto: 'hola' })).status, 400);
  assert.equal((await cliente(db, 'clienteConfirmar', { cliente_token: tok2, solicitud_id: solId, subsolicitud_id: solId + '-01' })).status, 400);
  assert.equal((await cliente(db, 'clienteArchivo', { cliente_token: tok2, archivo_id: ARCH })).status, 400);
  assert.equal((await cliente(db, 'clienteSubirArchivo', { cliente_token: tok2, solicitud_id: solId, nombre_archivo: 'x.jpg', contenido_base64: 'aGVsbG8=' })).status, 400);
  // El dueño sí conversa; el mensaje queda en su ítem.
  const r = await cliente(db, 'clienteMensaje', { cliente_token: tok1, solicitud_id: solId, subsolicitud_id: solId + '-01', texto: 'Lo necesito para el viernes' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(filas(db, 'COMENTARIOS').find((x) => x.solicitud_id === solId).subsolicitud_id, solId + '-01');
  const v = (await cliente(db, 'clientePedido', { cliente_token: tok1, solicitud_id: solId })).body.data;
  assert.ok(v.mensajes.some((x) => /viernes/.test(x.texto)));
  assert.equal(v.subsolicitudes[0].archivos[0].nombre, 'F30.pdf');
  assert.equal(v.subsolicitudes[0].archivos[0].url, undefined, 'el enlace con llave no viaja al contratista');
});

test('resuelto por el equipo, el contratista confirma desde el portal y queda registrado', async () => {
  const db = dbPortal();
  const BO = require('../logica/solicitudesBackoffice');
  const tok = await activado(db, 'CLI-1', RUT_PEDRO, 'Pedro Sáez');
  const solId = (await cliente(db, 'clienteCrearPedido', { cliente_token: tok, plantilla_id: 'f30', datos: { mes: 'septiembre' } })).body.data.solicitud_id;
  const res = await BO.actualizarEstado(db, { subsolicitud_id: solId + '-01', estado_nuevo: 'S08', comentario: 'Listo', comentario_al_solicitante: true }, { email: VANESSA, rol: 'DEV', rol_origen: 'SOLICITANTE' });
  assert.ok(!res._validationError && !res._forbidden, JSON.stringify(res));
  let p = (await cliente(db, 'clientePedidos', { cliente_token: tok })).body.data.pedidos[0];
  assert.equal(p.estado, 'TU');
  assert.equal(p.por_confirmar, 1);
  const r = await cliente(db, 'clienteConfirmar', { cliente_token: tok, solicitud_id: solId, subsolicitud_id: solId + '-01', accion: 'confirmar' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  p = (await cliente(db, 'clientePedidos', { cliente_token: tok })).body.data.pedidos[0];
  assert.equal(p.estado, 'LISTO');
  assert.ok(filas(db, 'PORTAL_REGISTRO').some((x) => x.accion === 'CONFIRMACION'));
});

test('la Bandeja sabe que el pedido viene del portal; entrega documentos solo quien atiende el ítem', async () => {
  const db = dbPortal();
  const tok = await activado(db, 'CLI-1', RUT_PEDRO, 'Pedro Sáez');
  const obra = (await cliente(db, 'clienteGuardarObra', { cliente_token: tok, nombre: 'Los Robles' })).body.data;
  const solId = (await cliente(db, 'clienteCrearPedido', { cliente_token: tok, plantilla_id: 'f30', obra_id: obra.obra_id, datos: { mes: 'septiembre' } })).body.data.solicitud_id;
  let r = await staff(db, VANESSA, 'getColaSolicitudes', {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const it = r.body.data.items.find((x) => x.solicitud_id === solId);
  assert.equal(it.origen, 'PORTAL');
  assert.equal(it.empresa_cliente, 'Constructora Cerro Alto SpA');
  assert.equal(it.cliente_obra, 'Los Robles');
  // Lisseth (JEFATURA de RR. HH.) puede; una cuenta sin el ítem, no; el almacenamiento no está en pruebas.
  const doc = { subsolicitud_id: solId + '-01', nombre_archivo: 'F30.pdf', contenido_base64: Buffer.from('%PDF-1.4 prueba').toString('base64') };
  r = await staff(db, VANESSA, 'subirArchivoEquipo', doc);
  assert.notEqual(r.status, 403, 'la encargada pasa el permiso: ' + JSON.stringify(r.body));
  r = await staff(db, LISSETH, 'subirArchivoEquipo', doc);
  assert.notEqual(r.status, 403, 'la jefatura del área también');
  const vacio = (hoja) => Object.fromEntries(COLUMNAS[hoja].map((c) => [c, '']));
  agregarFila_(db, 'CUENTAS_PORTAL', Object.assign(vacio('CUENTAS_PORTAL'), { cuenta_id: 'c-otro@homepymes.cl', usuario: 'otro', nombre: 'Otro', emails: JSON.stringify(['otro@homepymes.cl']), rol: 'SOLICITANTE', activo: true }));
  r = await staff(db, 'otro@homepymes.cl', 'subirArchivoEquipo', doc);
  assert.equal(r.status, 403, 'quien no atiende el ítem no entrega');
});

// 2026-10-08: el tope del formulario público (5 fotos por ítem, contando también lo
// que entrega el equipo) trababa la conversación del portal a la 6.ª foto.
test('archivos del portal: cada lado tiene su cupo, la miniatura no llena el registro y el formulario público sigue con su tope', async () => {
  const Almacen = require('../logica/almacenamiento');
  const guardado = {}, orig = { s: Almacen.subirArchivo_, d: Almacen.descargarArchivo_ };
  Almacen.subirArchivo_ = async (clave, b64) => { guardado[clave] = b64; return { ok: true, clave }; };
  Almacen.descargarArchivo_ = async (clave) => (guardado[clave] ? { ok: true, contenido_base64: guardado[clave], content_type: 'image/jpeg' } : { ok: false });
  try {
    const db = dbPortal();
    const tok = await activado(db, 'CLI-1', RUT_PEDRO, 'Pedro Sáez');
    const solId = (await cliente(db, 'clienteCrearPedido', { cliente_token: tok, plantilla_id: 'liquidaciones', datos: { mes: 'octubre' } })).body.data.solicitud_id;
    const jpg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4]).toString('base64');
    // El equipo entrega 5 fotos: no le quitan cupo al contratista.
    for (let i = 0; i < 5; i++) {
      const r = await staff(db, VANESSA, 'subirArchivoEquipo', { subsolicitud_id: solId + '-01', nombre_archivo: 'e' + i + '.jpg', contenido_base64: jpg, avisar: false });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    for (let i = 0; i < 8; i++) {
      const r = await cliente(db, 'clienteSubirArchivo', { cliente_token: tok, solicitud_id: solId, nombre_archivo: 'hoja' + i + '.jpg', contenido_base64: jpg });
      assert.equal(r.status, 200, 'foto ' + (i + 1) + ': ' + JSON.stringify(r.body));
    }
    // Desde el formulario público, aunque mande `conversacion`, rige el tope de siempre (5 por ítem).
    const sol = filas(db, 'SOLICITUDES').find((s) => s.solicitud_id === solId);
    const pub = await ejecutarAccion(db, 'subirArchivo', { solicitud_id: solId, subsolicitud_id: solId + '-01', nombre_archivo: 'x.jpg', contenido_base64: jpg, email: sol.solicitante_email, conversacion: true, pase_acceso: require('../logica/solicitudesPublico').crearPaseAcceso_(sol.solicitante_email, solId) }, { ip: '1.1.1.1' });
    assert.equal(pub.status, 400);
    assert.match(pub.body.message, /máximo de 5/);
    // Miniatura: se baja sin registrar; abrirla en grande sí queda.
    const arch = filas(db, 'ARCHIVOS').find((a) => a.solicitud_id === solId && !a.subido_por);
    const antes = filas(db, 'PORTAL_REGISTRO').filter((x) => x.accion === 'DESCARGA').length;
    const m = await cliente(db, 'clienteArchivo', { cliente_token: tok, archivo_id: arch.archivo_id, miniatura: true });
    assert.equal(m.status, 200); assert.equal(m.body.data.contenido_base64, jpg);
    assert.equal(filas(db, 'PORTAL_REGISTRO').filter((x) => x.accion === 'DESCARGA').length, antes);
    assert.equal((await cliente(db, 'clienteArchivo', { cliente_token: tok, archivo_id: arch.archivo_id, solo_registro: true })).status, 200);
    assert.equal(filas(db, 'PORTAL_REGISTRO').filter((x) => x.accion === 'DESCARGA').length, antes + 1);
  } finally { Almacen.subirArchivo_ = orig.s; Almacen.descargarArchivo_ = orig.d; }
});

test('auditoría Codex E1-3: reintentar el mismo envío no duplica el pedido (intento_id)', async () => {
  const db = dbPortal();
  const tok = await activado(db, 'CLI-1', RUT_PEDRO, 'Pedro Sáez');
  const pedido = { cliente_token: tok, plantilla_id: 'f30', datos: { mes: 'septiembre' }, intento_id: 'int-abc-1' };
  const nSol = () => filas(db, 'SOLICITUDES').length;
  const r1 = await cliente(db, 'clienteCrearPedido', pedido);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const r2 = await cliente(db, 'clienteCrearPedido', pedido);
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.equal(r2.body.data.solicitud_id, r1.body.data.solicitud_id, 'mismo intento → misma solicitud');
  assert.equal(r2.body.data.repetido, true);
  assert.equal(nSol(), 1);
  // Dos envíos simultáneos del mismo intento: una sola solicitud.
  const dobles = Object.assign({}, pedido, { intento_id: 'int-abc-2' });
  const [a, b] = await Promise.all([cliente(db, 'clienteCrearPedido', dobles), cliente(db, 'clienteCrearPedido', dobles)]);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(a.body.data.solicitud_id, b.body.data.solicitud_id);
  assert.equal(nSol(), 2);
  // Mismo intento con otro contenido: se rechaza (no se reutiliza en silencio).
  const r3 = await cliente(db, 'clienteCrearPedido', Object.assign({}, pedido, { datos: { mes: 'octubre' } }));
  assert.notEqual(r3.status, 200);
  assert.equal(nSol(), 2);
  // Sin intento_id (clientes antiguos) se comporta como siempre.
  const r4 = await cliente(db, 'clienteCrearPedido', { cliente_token: tok, plantilla_id: 'f30', datos: { mes: 'septiembre' } });
  assert.equal(r4.status, 200);
  assert.equal(nSol(), 3);
});

test('revisión Codex T1-3: si un aviso falla tras guardar, el reintento del mismo intento no duplica y el pedido queda del cliente', async () => {
  const db = dbPortal();
  const tok = await activado(db, 'CLI-1', RUT_PEDRO, 'Pedro Sáez');
  const Notif = require('../logica/notificaciones');
  const original = Notif.enviarAcuseRecibo;
  Notif.enviarAcuseRecibo = async () => { throw new Error('aviso caído (prueba)'); };
  const pedido = { cliente_token: tok, plantilla_id: 'contrato', personas: [{ nombre: 'Juan Pérez', cargo: 'Maestro' }], intento_id: 'int-falla-1' };
  try {
    // El servidor HTTP convierte la excepción en un 500; aquí se mira directo.
    const r1 = await cliente(db, 'clienteCrearPedido', pedido).catch((e) => ({ status: 500, error: e }));
    assert.notEqual(r1.status, 200, 'el primer envío falló');
  } finally { Notif.enviarAcuseRecibo = original; }
  const sols = filas(db, 'SOLICITUDES');
  assert.equal(sols.length, 1);
  assert.equal(sols[0].cliente_id, 'CLI-1', 'el vínculo quedó guardado con la solicitud');
  assert.ok(sols[0].intento_portal, 'y la marca del intento');
  assert.equal(filas(db, 'PORTAL_TRABAJADORES').filter((t) => t.cliente_id === 'CLI-1').length, 1, 'el trabajador también');
  const r2 = await cliente(db, 'clienteCrearPedido', pedido);
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.equal(r2.body.data.repetido, true);
  assert.equal(r2.body.data.solicitud_id, sols[0].solicitud_id);
  assert.equal(filas(db, 'SOLICITUDES').length, 1, 'sin duplicado');
});

test('revisión Codex T1 (2.ª ronda): si falla guardar un trabajador, no queda nada a medias y el reintento crea un pedido completo', async () => {
  for (const enCual of [1, 2]) {
    const db = dbPortal();
    const tok = await activado(db, 'CLI-1', RUT_PEDRO, 'Pedro Sáez');
    const antesTrab = filas(db, 'PORTAL_TRABAJADORES').length;
    // Falla la inserción del trabajador número `enCual` (simula un error de SQLite).
    db.exec('CREATE TABLE prueba_cuenta (n INTEGER)'); db.exec('INSERT INTO prueba_cuenta VALUES (0)');
    db.exec('CREATE TRIGGER prueba_falla BEFORE INSERT ON "PORTAL_TRABAJADORES" BEGIN ' +
      'UPDATE prueba_cuenta SET n = n + 1; SELECT CASE WHEN (SELECT n FROM prueba_cuenta) >= ' + enCual + " THEN RAISE(ABORT, 'falla de prueba') END; END");
    const pedido = { cliente_token: tok, plantilla_id: 'contrato', intento_id: 'int-trab-' + enCual,
      personas: [{ nombre: 'Juan Pérez', cargo: 'Maestro' }, { nombre: 'Ana Rojas', cargo: 'Ayudante' }] };
    const r1 = await cliente(db, 'clienteCrearPedido', pedido).catch((e) => ({ status: 500, error: e }));
    assert.notEqual(r1.status, 200, 'falló al guardar el trabajador ' + enCual);
    assert.equal(filas(db, 'SOLICITUDES').length, 0, 'sin solicitud marcada');
    assert.equal(filas(db, 'SUBSOLICITUDES').length, 0, 'sin ítems huérfanos');
    assert.equal(filas(db, 'PORTAL_TRABAJADORES').length, antesTrab, 'sin trabajadores parciales');
    db.exec('DROP TRIGGER prueba_falla');
    const r2 = await cliente(db, 'clienteCrearPedido', pedido);
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.notEqual(r2.body.data.repetido, true, 'es el primer pedido que de verdad quedó guardado');
    assert.equal(filas(db, 'SOLICITUDES').length, 1);
    const subs = filas(db, 'SUBSOLICITUDES');
    assert.equal(subs.length, 2);
    assert.ok(subs.every((x) => x.trabajador_id), 'cada ítem con su trabajador');
    assert.equal(filas(db, 'PORTAL_TRABAJADORES').length, antesTrab + 2);
  }
});
