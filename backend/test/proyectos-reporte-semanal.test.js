'use strict';

/**
 * R-02: el estado del portafolio, enviado solo cada semana.
 *
 * Es el mismo patrón que resolvió la reportabilidad en Calidad: si mandar el
 * informe es manual, no ocurre.
 *
 * Lo que se prueba aquí es lo que puede fallar en silencio:
 *
 *   · La COMPUERTA semanal. Cuelga del pase diario (no había slot de trigger
 *     libre), así que corre todos los días y tiene que salirse sola seis de
 *     cada siete. Si la compuerta se rompe, Gerencia recibe el mismo correo
 *     a diario hasta que alguien se queja.
 *
 *   · El REPARTO. Gerencia y ADM reciben el portafolio completo; cada líder,
 *     solo lo suyo. Y quien es las dos cosas recibe UN correo, no dos.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function ctxConUsuarios(usuarios) {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake', SIGSO_DRIVE_ROOT_FOLDER_ID: 'fake' } });
  Object.keys(ctx.COLUMNAS).forEach((h) => { try { seedSheet(ctx, h, ctx.COLUMNAS[h]); } catch (e) { /* otra app */ } });
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, usuarios);
  return ctx;
}

const USUARIOS = [
  ['U1', 'Ger Gerencia', 'gerencia@x.cl', 'HP', 'GERENCIA', true, '', 'sistema'],
  ['U2', 'Ada Admin', 'admin@x.cl', 'HP', 'ADM', true, '', 'sistema'],
  ['U3', 'Leo Lider', 'leo@x.cl', 'HP', 'DEV', true, '', 'sistema'],
  ['U4', 'Ines Lider', 'ines@x.cl', 'HP', 'DEV', true, '', 'sistema']
];

const ADM = { email: 'admin@x.cl', nombre: 'Ada Admin', rol: 'ADM' };

function crearProyecto(ctx, nombre, lider, extra) {
  return toPlain(ctx.Proyectos.crear(Object.assign({
    nombre: nombre, lider_email: lider,
    fecha_inicio: '2026-01-01', fecha_objetivo: '2026-12-31'
  }, extra || {}), ADM));
}

function correosEnviados(ctx) {
  return (ctx.GmailApp._enviados || []).map((e) => ({
    para: e.to || e.destinatario || e[0],
    asunto: e.subject || e.asunto || e[1],
    cuerpo: String(e.body || e.cuerpo || e[2] || '')
  }));
}

test('reparte: Gerencia y ADM ven todo, cada líder solo lo suyo', () => {
  const ctx = ctxConUsuarios(USUARIOS);
  crearProyecto(ctx, 'Proyecto de Leo', 'leo@x.cl');
  crearProyecto(ctx, 'Proyecto de Ines', 'ines@x.cl');

  const r = toPlain(ctx.Notificaciones.enviarReporteSemanalProyectos());
  assert.equal(r.proyectos, 2);

  const correos = correosEnviados(ctx);
  const paraGerencia = correos.filter((c) => c.para === 'gerencia@x.cl');
  const paraLeo = correos.filter((c) => c.para === 'leo@x.cl');
  const paraInes = correos.filter((c) => c.para === 'ines@x.cl');

  assert.equal(paraGerencia.length, 1, 'Gerencia recibe UN correo, no uno por proyecto');
  assert.match(paraGerencia[0].cuerpo, /Proyecto de Leo/);
  assert.match(paraGerencia[0].cuerpo, /Proyecto de Ines/);

  assert.equal(paraLeo.length, 1);
  assert.match(paraLeo[0].cuerpo, /Proyecto de Leo/);
  assert.doesNotMatch(paraLeo[0].cuerpo, /Proyecto de Ines/,
    'un líder no tiene por qué recibir el portafolio de otro');

  assert.equal(paraInes.length, 1);
  assert.doesNotMatch(paraInes[0].cuerpo, /Proyecto de Leo/);
});

test('quien es Gerencia Y líder recibe un solo correo, no dos', () => {
  const ctx = ctxConUsuarios(USUARIOS);
  crearProyecto(ctx, 'Proyecto del gerente', 'gerencia@x.cl');

  toPlain(ctx.Notificaciones.enviarReporteSemanalProyectos());

  const paraGerencia = correosEnviados(ctx).filter((c) => c.para === 'gerencia@x.cl');
  assert.equal(paraGerencia.length, 1,
    'ya lo recibe con el portafolio completo: un segundo correo sería ruido');
});

test('la compuerta semanal: la segunda corrida del mismo día no manda nada', () => {
  const ctx = ctxConUsuarios(USUARIOS);
  crearProyecto(ctx, 'Uno', 'leo@x.cl');

  const primera = toPlain(ctx.Notificaciones.enviarReporteSemanalProyectos());
  assert.ok(primera.enviados > 0, 'la primera sí manda');
  const tras1 = correosEnviados(ctx).length;

  const segunda = toPlain(ctx.Notificaciones.enviarReporteSemanalProyectos());
  assert.ok(segunda.omitido, 'la segunda tiene que salirse sola');
  assert.equal(correosEnviados(ctx).length, tras1,
    'corre a diario colgada del pase: sin compuerta, Gerencia recibiría esto todos los días');
});

test('forzar salta la compuerta (es como se prueba a mano desde el editor)', () => {
  const ctx = ctxConUsuarios(USUARIOS);
  crearProyecto(ctx, 'Uno', 'leo@x.cl');

  toPlain(ctx.Notificaciones.enviarReporteSemanalProyectos());
  const tras1 = correosEnviados(ctx).length;

  const forzada = toPlain(ctx.Notificaciones.enviarReporteSemanalProyectos({ forzar: true }));
  assert.ok(!forzada.omitido, 'forzar tiene que saltarse la compuerta de los siete días');
  assert.ok(forzada.enviados > 0, 'y volver a recorrer los destinatarios');
  // El correo en sí puede no salir dos veces el mismo día: enviarCorreo_
  // deduplica por (evento, día). Son DOS capas distintas y aquí se prueba la
  // de arriba; la de abajo tiene su propio test.
  assert.ok(tras1 >= 0);
});

test('pasada una semana vuelve a enviar', () => {
  const ctx = ctxConUsuarios(USUARIOS);
  crearProyecto(ctx, 'Uno', 'leo@x.cl');
  toPlain(ctx.Notificaciones.enviarReporteSemanalProyectos());
  const tras1 = correosEnviados(ctx).length;

  // Se retrasa la marca ocho días, que es lo que hará el calendario solo.
  const hace8 = new Date(Date.now() - 8 * 86400000).toISOString();
  ctx.PropertiesService.getScriptProperties().setProperty('SIGSO_PROY_REPORTE_SEMANAL', hace8);

  const segunda = toPlain(ctx.Notificaciones.enviarReporteSemanalProyectos());
  assert.ok(!segunda.omitido, 'a los ocho días le toca de nuevo');
  assert.ok(segunda.enviados > 0, 'y vuelve a recorrer los destinatarios');
  assert.ok(tras1 >= 0);
});

test('los proyectos cerrados y cancelados no entran', () => {
  const ctx = ctxConUsuarios(USUARIOS);
  crearProyecto(ctx, 'Vivo', 'leo@x.cl');
  const cerrado = crearProyecto(ctx, 'Terminado hace meses', 'leo@x.cl');
  ctx.Proyectos.actualizar({
    proyecto_id: cerrado.proyecto_id, estado: 'CERRADO', motivo: 'Entregado y aceptado'
  }, ADM);

  const r = toPlain(ctx.Notificaciones.enviarReporteSemanalProyectos());
  assert.equal(r.proyectos, 1, 'solo el activo');
  const cuerpo = correosEnviados(ctx).filter((c) => c.para === 'gerencia@x.cl')[0].cuerpo;
  assert.match(cuerpo, /Vivo/);
  assert.doesNotMatch(cuerpo, /Terminado hace meses/);
});

test('sin proyectos activos no se manda nada, pero la semana queda marcada', () => {
  const ctx = ctxConUsuarios(USUARIOS);
  const r = toPlain(ctx.Notificaciones.enviarReporteSemanalProyectos());
  assert.equal(r.enviados, 0);
  assert.equal(correosEnviados(ctx).length, 0);
  // Si no se marcara, lo intentaría de nuevo mañana y pasado, cada día.
  const marca = ctx.PropertiesService.getScriptProperties().getProperty('SIGSO_PROY_REPORTE_SEMANAL');
  assert.ok(marca, 'la corrida cuenta aunque no haya nada que contar');
});

test('el correo ordena por gravedad y usa la misma cifra que la pantalla', () => {
  const ctx = ctxConUsuarios(USUARIOS);
  const sano = crearProyecto(ctx, 'Proyecto sano', 'leo@x.cl');
  const malo = crearProyecto(ctx, 'Proyecto en problemas', 'leo@x.cl');
  // Una tarea P1 vencida deja al proyecto en crítico (12 pts).
  const t = toPlain(ctx.Proyectos.crearTarea({
    proyecto_id: malo.proyecto_id, titulo: 'Urgente', responsable_email: 'leo@x.cl',
    prioridad: 'P1', fecha_compromiso: '2020-01-01'
  }, ADM));
  ctx.Actividades.confirmar({ actividad_id: t.actividad_id, fecha_compromiso: '2020-01-01' },
    { email: 'leo@x.cl', nombre: 'Leo Lider', rol: 'DEV' });

  toPlain(ctx.Notificaciones.enviarReporteSemanalProyectos());
  const cuerpo = correosEnviados(ctx).filter((c) => c.para === 'gerencia@x.cl')[0].cuerpo;

  assert.ok(cuerpo.indexOf('Proyecto en problemas') < cuerpo.indexOf('Proyecto sano'),
    'lo que está peor va primero: un reporte que obliga a buscar el problema no se lee');
  assert.match(cuerpo, /pts en contra/,
    'la misma cifra que muestra la pantalla desde P-02');
  assert.doesNotMatch(cuerpo, /\/100/, 'no reaparece la nota sobre 100 que P-02 quitó');
  assert.ok(sano.proyecto_id && malo.proyecto_id);
});

test('la deduplicación de correo es una segunda red, independiente de la compuerta', () => {
  // Aunque se fuerce el envío dos veces el mismo día, enviarCorreo_ deduplica
  // por (evento, día): a la persona no le llega dos veces. Es a propósito, y
  // se deja escrito para que nadie lo "arregle" pensando que es un fallo.
  const ctx = ctxConUsuarios(USUARIOS);
  crearProyecto(ctx, 'Uno', 'leo@x.cl');

  toPlain(ctx.Notificaciones.enviarReporteSemanalProyectos({ forzar: true }));
  const tras1 = correosEnviados(ctx).length;
  toPlain(ctx.Notificaciones.enviarReporteSemanalProyectos({ forzar: true }));

  assert.equal(correosEnviados(ctx).length, tras1,
    'dos corridas el mismo día no pueden producir dos correos al mismo destinatario');
});
