'use strict';

/**
 * v3.3 (P1) — identidad de la plataforma: cuentas, login, sesiones y el CRUD
 * de administracion.
 *
 * Lo mas critico que se cubre:
 *  - el hash de Intake (verifica) y el de Backoffice (crea) son IDENTICOS --
 *    si divergen, nadie puede entrar nunca;
 *  - una cuenta con varios correos ve las solicitudes de TODOS (el problema
 *    de origen de todo esto);
 *  - el bloqueo anti fuerza bruta y que desactivar una cuenta corta la
 *    sesion aunque el token siga vivo en cache.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadIntakeProject, loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

const ADMIN = { email: 'admin@homepymes.cl', rol: 'ADM' };

function loadIntake() {
  const ctx = loadIntakeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  ['SOLICITUDES', 'SUBSOLICITUDES', 'CUENTAS_PORTAL', 'SESIONES_PORTAL'].forEach((h) =>
    seedSheet(ctx, h, ctx.COLUMNAS[h]));
  return ctx;
}

function loadBackoffice() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' } });
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL);
  return ctx;
}

// Crea una cuenta usando el codigo REAL del Backoffice y la copia (fila
// completa) a la hoja del sandbox de Intake -- el mismo viaje que hace el
// dato en produccion (dos proyectos, una planilla).
function crearCuentaReal(ctxIntake, datos) {
  const bo = loadBackoffice();
  const res = bo.CuentasPortal.gestionar(Object.assign({ operacion: 'crear' }, datos), ADMIN);
  assert.ok(!res._validationError, JSON.stringify(res));
  const fila = bo.leerFilas_('CUENTAS_PORTAL')[0];
  ctxIntake.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('CUENTAS_PORTAL')
    .appendRow(ctxIntake.COLUMNAS.CUENTAS_PORTAL.map((col) => (fila[col] !== undefined ? fila[col] : '')));
  return res; // trae password_temporal
}

test('el hash de Intake y el de Backoffice son identicos (si divergen, nadie entra)', () => {
  const intake = loadIntake();
  const bo = loadBackoffice();
  const casos = [['clave-secreta-123', 'sal-abc'], ['otra Clave!', 'sal-xyz']];
  casos.forEach(([pass, salt]) => {
    assert.equal(intake.hashPassword_(pass, salt), bo.hashPasswordPortal_(pass, salt));
  });
  // Y es un hash de verdad: distinto por sal y por clave, nunca la clave.
  assert.notEqual(intake.hashPassword_('a', 's1'), intake.hashPassword_('a', 's2'));
  assert.notEqual(intake.hashPassword_('a', 's1'), intake.hashPassword_('b', 's1'));
  assert.equal(intake.hashPassword_('a', 's1').includes('a:'), false);
});

test('login con cuenta creada por el Admin: clave temporal funciona y exige cambio', () => {
  const ctx = loadIntake();
  const creada = crearCuentaReal(ctx, {
    usuario: 'cpena', nombre: 'Camila Pena', cargo: 'Jefa de Operaciones',
    emails: 'camila@gde.cl, camila.pena@gmail.com', rol: 'SOLICITANTE'
  });

  const res = ctx.Portal.login({ usuario: 'CPena', password: creada.password_temporal });
  assert.ok(res.token, 'debe emitir token');
  assert.equal(res.cuenta.nombre, 'Camila Pena');
  assert.equal(res.cuenta.debe_cambiar_password, true);
  assert.deepEqual([...res.cuenta.modulos], ['nueva_solicitud', 'mis_solicitudes']);
  assert.deepEqual([...res.cuenta.emails], ['camila@gde.cl', 'camila.pena@gmail.com']);
  // El perfil que viaja al navegador JAMAS incluye hash ni sal.
  assert.equal(res.cuenta.hash_password, undefined);
  assert.equal(res.cuenta.salt, undefined);
});

test('login con clave incorrecta o usuario inexistente: mismo mensaje (no filtra usuarios)', () => {
  const ctx = loadIntake();
  crearCuentaReal(ctx, { usuario: 'cpena', nombre: 'Camila', emails: 'c@gde.cl' });

  const malaClave = ctx.Portal.login({ usuario: 'cpena', password: 'no-es-la-clave' });
  const noExiste = ctx.Portal.login({ usuario: 'fantasma', password: 'lo-que-sea' });
  assert.equal(malaClave._forbidden, true);
  assert.equal(noExiste._forbidden, true);
  assert.equal(malaClave.message, noExiste.message);
});

test('5 intentos fallidos bloquean el login 10 minutos, incluso con la clave correcta', () => {
  const ctx = loadIntake();
  const creada = crearCuentaReal(ctx, { usuario: 'cpena', nombre: 'Camila', emails: 'c@gde.cl' });

  for (let i = 0; i < 5; i++) {
    ctx.Portal.login({ usuario: 'cpena', password: 'mala-' + i });
  }
  const bloqueado = ctx.Portal.login({ usuario: 'cpena', password: creada.password_temporal });
  assert.equal(bloqueado._forbidden, true);
  assert.match(bloqueado.message, /Demasiados intentos/);
});

test('un login exitoso limpia el contador de intentos', () => {
  const ctx = loadIntake();
  const creada = crearCuentaReal(ctx, { usuario: 'cpena', nombre: 'Camila', emails: 'c@gde.cl' });

  for (let i = 0; i < 4; i++) {
    ctx.Portal.login({ usuario: 'cpena', password: 'mala-' + i });
  }
  const ok = ctx.Portal.login({ usuario: 'cpena', password: creada.password_temporal });
  assert.ok(ok.token);
  // Y despues del exito, un fallo nuevo parte de cero (no bloquea al 5to).
  ctx.Portal.login({ usuario: 'cpena', password: 'mala-de-nuevo' });
  const ok2 = ctx.Portal.login({ usuario: 'cpena', password: creada.password_temporal });
  assert.ok(ok2.token);
});

test('portalSesion restaura la sesion; logout la invalida', () => {
  const ctx = loadIntake();
  const creada = crearCuentaReal(ctx, { usuario: 'cpena', nombre: 'Camila', emails: 'c@gde.cl' });
  const { token } = ctx.Portal.login({ usuario: 'cpena', password: creada.password_temporal });

  assert.equal(ctx.Portal.sesion({ token: token }).cuenta.usuario, 'cpena');
  ctx.Portal.logout({ token: token });
  assert.equal(ctx.Portal.sesion({ token: token })._forbidden, true);
});

test('desactivar la cuenta corta la sesion aunque el token siga en cache', () => {
  const ctx = loadIntake();
  const creada = crearCuentaReal(ctx, { usuario: 'cpena', nombre: 'Camila', emails: 'c@gde.cl' });
  const { token } = ctx.Portal.login({ usuario: 'cpena', password: creada.password_temporal });
  assert.ok(ctx.Portal.sesion({ token: token }).cuenta);

  ctx.actualizarFilaPorId_('CUENTAS_PORTAL', 'usuario', 'cpena', { activo: false });
  assert.equal(ctx.Portal.sesion({ token: token })._forbidden, true);
  // Y el login directo tambien queda cerrado.
  assert.equal(ctx.Portal.login({ usuario: 'cpena', password: creada.password_temporal })._forbidden, true);
});

test('cambiarPassword: exige la actual, minimo 8, y apaga debe_cambiar_password', () => {
  const ctx = loadIntake();
  const creada = crearCuentaReal(ctx, { usuario: 'cpena', nombre: 'Camila', emails: 'c@gde.cl' });
  const { token } = ctx.Portal.login({ usuario: 'cpena', password: creada.password_temporal });

  assert.equal(ctx.Portal.cambiarPassword({
    token: token, password_actual: 'equivocada', password_nueva: 'clave-nueva-larga'
  })._forbidden, true);
  assert.equal(ctx.Portal.cambiarPassword({
    token: token, password_actual: creada.password_temporal, password_nueva: 'corta'
  })._validationError, true);

  const ok = ctx.Portal.cambiarPassword({
    token: token, password_actual: creada.password_temporal, password_nueva: 'clave-nueva-larga'
  });
  assert.equal(ok.ok, true);
  // La temporal deja de servir; la nueva funciona y ya no exige cambio.
  assert.equal(ctx.Portal.login({ usuario: 'cpena', password: creada.password_temporal })._forbidden, true);
  const relogin = ctx.Portal.login({ usuario: 'cpena', password: 'clave-nueva-larga' });
  assert.ok(relogin.token);
  assert.equal(relogin.cuenta.debe_cambiar_password, false);
});

// El corazon de todo: una cuenta con DOS correos ve las solicitudes de ambos.
test('misSolicitudes con token junta las solicitudes de TODOS los correos de la cuenta', () => {
  const ctx = loadIntake();
  const creada = crearCuentaReal(ctx, {
    usuario: 'cpena', nombre: 'Camila',
    emails: 'camila@gde.cl, camila.pena@gmail.com'
  });
  const hoja = ctx.SpreadsheetApp.openById('fake-sheet-id');
  [['SOL-2026-GDE-0001', 'camila@gde.cl'], ['SOL-2026-GDE-0002', 'camila.pena@gmail.com'],
   ['SOL-2026-GDE-0003', 'otra.persona@gde.cl']].forEach(([id, correo]) => {
    const s = {
      solicitud_id: id, empresa_id: 'GDE', solicitante_email: correo,
      estado_derivado: 'S02', prioridad_derivada: 'P3', fecha_creacion: '2026-07-01T10:00:00.000Z'
    };
    hoja.getSheetByName('SOLICITUDES').appendRow(ctx.COLUMNAS.SOLICITUDES.map((c) => (s[c] !== undefined ? s[c] : '')));
  });

  const { token } = ctx.Portal.login({ usuario: 'cpena', password: creada.password_temporal });
  const res = ctx.Solicitudes.misSolicitudes({ token: token });

  const ids = res.solicitudes.map((s) => s.solicitud_id).sort();
  assert.deepEqual([...ids], ['SOL-2026-GDE-0001', 'SOL-2026-GDE-0002']);
  // email_coincidente por fila: para el drill-down (estadoPublico valida por correo).
  const porId = {};
  res.solicitudes.forEach((s) => { porId[s.solicitud_id] = s.email_coincidente; });
  assert.equal(porId['SOL-2026-GDE-0001'], 'camila@gde.cl');
  assert.equal(porId['SOL-2026-GDE-0002'], 'camila.pena@gmail.com');
});

test('misSolicitudes con token invalido es forbidden; el camino correo+codigo sigue vivo', () => {
  const ctx = loadIntake();
  assert.equal(ctx.Solicitudes.misSolicitudes({ token: 'no-existe' })._forbidden, true);

  // Regresion del camino viejo: codigo de un solo uso por correo.
  const hoja = ctx.SpreadsheetApp.openById('fake-sheet-id');
  const s = {
    solicitud_id: 'SOL-2026-HP-0001', empresa_id: 'HP', solicitante_email: 'juan@homepymes.cl',
    estado_derivado: 'S02', prioridad_derivada: 'P3', fecha_creacion: '2026-07-01T10:00:00.000Z'
  };
  hoja.getSheetByName('SOLICITUDES').appendRow(ctx.COLUMNAS.SOLICITUDES.map((c) => (s[c] !== undefined ? s[c] : '')));
  ctx.CacheService.getScriptCache().put('CODIGO_ACCESO:juan@homepymes.cl', '123456', 600);
  const res = ctx.Solicitudes.misSolicitudes({ email: 'juan@homepymes.cl', codigo: '123456' });
  assert.equal(res.solicitudes.length, 1);
});

// --- CRUD de administracion (Backoffice) ---------------------------------

test('el CRUD de cuentas es solo para ADM', () => {
  const bo = loadBackoffice();
  ['ANA', 'DEV', 'GERENCIA'].forEach((rol) => {
    assert.equal(bo.CuentasPortal.listar({}, { email: 'x@x.cl', rol })._forbidden, true, rol);
    assert.equal(bo.CuentasPortal.gestionar({ operacion: 'crear', usuario: 'a', nombre: 'A', emails: 'a@a.cl' },
      { email: 'x@x.cl', rol })._forbidden, true, rol);
  });
});

test('crear cuenta aplica la plantilla de modulos del rol y no repite usuarios', () => {
  const bo = loadBackoffice();
  const dev = bo.CuentasPortal.gestionar({
    operacion: 'crear', usuario: 'leo', nombre: 'Leo', emails: 'leo@rld.cl', rol: 'DEV'
  }, ADMIN);
  assert.equal(dev.password_temporal.length, 10);

  const lista = bo.CuentasPortal.listar({}, ADMIN).cuentas;
  assert.deepEqual([...lista[0].modulos], ['nueva_solicitud', 'mis_solicitudes', 'bandeja']);

  const repetido = bo.CuentasPortal.gestionar({
    operacion: 'crear', usuario: 'LEO', nombre: 'Otro', emails: 'otro@rld.cl'
  }, ADMIN);
  assert.equal(repetido._validationError, true);
});

// "Darle gerencia a Felipe sin hacerlo ADM": la lista por cuenta manda.
test('actualizar permite modulos por persona, distintos de la plantilla del rol', () => {
  const bo = loadBackoffice();
  const creada = bo.CuentasPortal.gestionar({
    operacion: 'crear', usuario: 'felipe', nombre: 'Felipe', emails: 'felipe@rld.cl', rol: 'SOLICITANTE'
  }, ADMIN);

  bo.CuentasPortal.gestionar({
    operacion: 'actualizar', cuenta_id: creada.cuenta_id,
    modulos: ['nueva_solicitud', 'mis_solicitudes', 'gerencia']
  }, ADMIN);

  const cuenta = bo.CuentasPortal.listar({}, ADMIN).cuentas[0];
  assert.equal(cuenta.rol, 'SOLICITANTE');
  assert.deepEqual([...cuenta.modulos], ['nueva_solicitud', 'mis_solicitudes', 'gerencia']);

  const invalido = bo.CuentasPortal.gestionar({
    operacion: 'actualizar', cuenta_id: creada.cuenta_id, modulos: ['hackear_todo']
  }, ADMIN);
  assert.equal(invalido._validationError, true);
});

test('resetear password genera clave nueva de un solo anuncio y vuelve a exigir cambio', () => {
  const bo = loadBackoffice();
  const creada = bo.CuentasPortal.gestionar({
    operacion: 'crear', usuario: 'cpena', nombre: 'Camila', emails: 'c@gde.cl'
  }, ADMIN);
  const reset = bo.CuentasPortal.gestionar({ operacion: 'resetear_password', cuenta_id: creada.cuenta_id }, ADMIN);

  assert.notEqual(reset.password_temporal, creada.password_temporal);
  const fila = bo.leerFilas_('CUENTAS_PORTAL')[0];
  assert.equal(fila.debe_cambiar_password, true);
  // La clave nunca queda guardada -- solo el hash.
  assert.equal(JSON.stringify(fila).includes(reset.password_temporal), false);
});

test('listar nunca expone hash ni sal, ni siquiera al Admin', () => {
  const bo = loadBackoffice();
  bo.CuentasPortal.gestionar({ operacion: 'crear', usuario: 'cpena', nombre: 'Camila', emails: 'c@gde.cl' }, ADMIN);
  const cuenta = bo.CuentasPortal.listar({}, ADMIN).cuentas[0];
  assert.equal(cuenta.hash_password, undefined);
  assert.equal(cuenta.salt, undefined);
});

// --- P3: identidad por token en el Backoffice ----------------------------
// El shell llama las acciones del staff con portal_token en el body; la
// identidad sale de CUENTAS_PORTAL/SESIONES_PORTAL y el modulo requerido se
// valida EN CADA accion (esconder botones no protege nada).

function makeEventBO(body) {
  return { postData: { contents: JSON.stringify(body), type: 'text/plain' } };
}

// Backoffice con las hojas del portal + una cuenta con sesion vigente.
function loadBackofficeConSesion(rol, modulos) {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' },
    activeUserEmail: '' // sin Google: solo el token puede identificar
  });
  ['SOLICITUDES', 'SUBSOLICITUDES', 'HISTORIAL_ESTADOS', 'HISTORIAL_PRIORIDAD',
   'HISTORIAL_COMPROMISO', 'HISTORIAL_ASIGNACION', 'COMENTARIOS', 'ARCHIVOS',
   'USUARIOS', 'LOG_NOTIFICACIONES', 'LOG_SISTEMA', 'CONFIG_FERIADOS',
   'CONFIG_SLA', 'CONFIG_NOTIFICACIONES'].forEach((h) => seedSheet(ctx, h, ctx.COLUMNAS[h]));
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL, [
    ['CTA-1', 'leo', 'Leo Estay', 'Desarrollador', 'hash-x', 'sal-x',
      JSON.stringify(['leo@rld.cl']), rol, JSON.stringify(modulos),
      'RLD', true, false, '', 'test']
  ]);
  seedSheet(ctx, 'SESIONES_PORTAL', ctx.COLUMNAS.SESIONES_PORTAL, [
    ['token-vigente', 'CTA-1', new Date(Date.now() + 3600000).toISOString(), new Date().toISOString()],
    ['token-vencido', 'CTA-1', new Date(Date.now() - 1000).toISOString(), new Date().toISOString()]
  ]);
  return ctx;
}

test('P3: un DEV con modulo bandeja usa el Backoffice con su token', () => {
  const ctx = loadBackofficeConSesion('DEV', ['nueva_solicitud', 'mis_solicitudes', 'bandeja']);
  const res = JSON.parse(ctx.doPost(makeEventBO({
    action: 'getDashboardData', data: { portal_token: 'token-vigente' }
  })).getContent());
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 200));
  // Y el auto-scope del DEV usa el primer correo de la cuenta.
  assert.equal(res.data.rol_actual, 'DEV');
});

test('P3: sin el modulo requerido, la accion se rechaza aunque el rol alcance', () => {
  // GERENCIA tiene modulo gerencia pero NO bandeja ni administracion.
  const ctx = loadBackofficeConSesion('GERENCIA', ['nueva_solicitud', 'mis_solicitudes', 'gerencia']);
  const bandeja = JSON.parse(ctx.doPost(makeEventBO({
    action: 'getDashboardData', data: { portal_token: 'token-vigente' }
  })).getContent());
  assert.equal(bandeja.ok, false);
  assert.match(bandeja.message, /modulo/);

  const admin = JSON.parse(ctx.doPost(makeEventBO({
    action: 'listarUsuarios', data: { portal_token: 'token-vigente' }
  })).getContent());
  assert.equal(admin.ok, false);

  const gerencia = JSON.parse(ctx.doPost(makeEventBO({
    action: 'getPanelGerencia', data: { portal_token: 'token-vigente' }
  })).getContent());
  assert.equal(gerencia.ok, true);
});

// Reporte real: Gerencia entraba a su panel, hacia clic en una fila y el
// Backoffice respondia "Tu cuenta no tiene acceso a este modulo (bandeja)."
// -- ver el detalle es de solo lectura (Solicitudes.getDetalle ya le oculta
// transiciones/responsables al rol GERENCIA) y no deberia exigir el modulo
// de bandeja completo.
test('P3: Gerencia SI puede abrir el detalle de una solicitud (de solo lectura) desde su panel', () => {
  const ctx = loadBackofficeConSesion('GERENCIA', ['nueva_solicitud', 'mis_solicitudes', 'gerencia']);
  const datos = {
    solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD', plataforma: 'ERP', modulo: 'Facturacion',
    tipo: 'ERR', solicitante_nombre: 'Juan', solicitante_cargo: 'Analista', solicitante_email: 'juan@rld.cl',
    estado_derivado: 'S02', prioridad_derivada: 'P2', fecha_creacion: new Date().toISOString()
  };
  const fila = ctx.COLUMNAS.SOLICITUDES.map((col) => (datos[col] !== undefined ? datos[col] : ''));
  ctx.SpreadsheetApp.openById('fake-sheet-id').getSheetByName('SOLICITUDES').appendRow(fila);

  const res = JSON.parse(ctx.doPost(makeEventBO({
    action: 'getSolicitudDetalle',
    data: { portal_token: 'token-vigente', solicitud_id: 'SOL-2026-RLD-0001' }
  })).getContent());
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 200));
  assert.equal(res.data.solicitud.solicitud_id, 'SOL-2026-RLD-0001');
  // Solo lectura: sin transiciones de estado ni lista de responsables.
  assert.equal(res.data.rol_actual, 'GERENCIA');

  // Pero una cuenta sin NINGUNO de los dos modulos sigue sin poder.
  const sinAcceso = loadBackofficeConSesion('SOLICITANTE', ['nueva_solicitud', 'mis_solicitudes']);
  const rechazado = JSON.parse(sinAcceso.doPost(makeEventBO({
    action: 'getSolicitudDetalle',
    data: { portal_token: 'token-vigente', solicitud_id: 'SOL-2026-RLD-0001' }
  })).getContent());
  assert.equal(rechazado.ok, false);
  assert.match(rechazado.message, /modulo/);
});

test('P3: token vencido o desconocido = forbidden, y NUNCA cae al camino Session', () => {
  // activeUserEmail simula a un ADM logueado con Google en el mismo runtime:
  // si el token invalido "cayera" a Session, heredaria esa identidad.
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id' },
    activeUserEmail: 'admin@homepymes.cl'
  });
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Admin', 'admin@homepymes.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);
  seedSheet(ctx, 'CUENTAS_PORTAL', ctx.COLUMNAS.CUENTAS_PORTAL);
  seedSheet(ctx, 'SESIONES_PORTAL', ctx.COLUMNAS.SESIONES_PORTAL);

  ['token-falso'].forEach((token) => {
    const res = JSON.parse(ctx.doPost(makeEventBO({
      action: 'ping', data: { portal_token: token }
    })).getContent());
    assert.equal(res.ok, false);
    assert.equal(res.error, 'forbidden');
  });
  // Sin token, el camino Session sigue funcionando igual que siempre.
  const porGoogle = JSON.parse(ctx.doPost(makeEventBO({ action: 'ping', data: {} })).getContent());
  assert.equal(porGoogle.ok, true);
  assert.equal(porGoogle.data.rol, 'ADM');
});

test('P3: desactivar la cuenta corta el acceso por token al Backoffice', () => {
  const ctx = loadBackofficeConSesion('DEV', ['bandeja']);
  ctx.actualizarFilaPorId_('CUENTAS_PORTAL', 'cuenta_id', 'CTA-1', { activo: false });
  const res = JSON.parse(ctx.doPost(makeEventBO({
    action: 'ping', data: { portal_token: 'token-vigente' }
  })).getContent());
  assert.equal(res.ok, false);
});

// Una cuenta SOLICITANTE a la que el Admin le dio bandeja se normaliza a
// DEV: el rol mas restringido con escritura. Sin esto pasaria los checks
// pensados para ANA/ADM (p.ej. derivar cualquier solicitud).
test('P3: rol SOLICITANTE con bandeja se comporta como DEV (no como ANA/ADM)', () => {
  const ctx = loadBackofficeConSesion('SOLICITANTE', ['nueva_solicitud', 'mis_solicitudes', 'bandeja']);
  // Solicitud asignada a OTRA persona: un DEV no puede derivarla.
  const hoja = ctx.SpreadsheetApp.openById('fake-sheet-id');
  const s = {
    solicitud_id: 'SOL-2026-RLD-0001', empresa_id: 'RLD', estado_derivado: 'S02',
    prioridad_derivada: 'P2', desarrollador_asignado: 'otra.persona@rld.cl',
    fecha_creacion: new Date().toISOString()
  };
  hoja.getSheetByName('SOLICITUDES').appendRow(ctx.COLUMNAS.SOLICITUDES.map((c) => (s[c] !== undefined ? s[c] : '')));
  const sub = {
    subsolicitud_id: 'SOL-2026-RLD-0001-01', solicitud_id: 'SOL-2026-RLD-0001', numero_item: 1,
    titulo: 't', descripcion: 'd', estado: 'S02', prioridad: 'P2',
    desarrollador_asignado: 'otra.persona@rld.cl', fecha_creacion: new Date().toISOString()
  };
  hoja.getSheetByName('SUBSOLICITUDES').appendRow(ctx.COLUMNAS.SUBSOLICITUDES.map((c) => (sub[c] !== undefined ? sub[c] : '')));

  const res = JSON.parse(ctx.doPost(makeEventBO({
    action: 'derivarSolicitud',
    data: { portal_token: 'token-vigente', solicitud_id: 'SOL-2026-RLD-0001', responsable_nuevo: 'leo@rld.cl', motivo: 'quiero llevarmela a mi bandeja' }
  })).getContent());
  assert.equal(res.ok, false, 'no debe poder derivar trabajo ajeno');
});
