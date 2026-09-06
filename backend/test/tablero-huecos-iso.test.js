'use strict';

/**
 * Seis cosas que la norma pide y el tablero no decía.
 *
 * El libro de carga trae una hoja REVISAR con 19 puntos por decidir o
 * completar. Al correr el tablero contra los DATOS REALES de esa carga,
 * resultó que el sistema solo avisaba de DOS (procesos sin responsable,
 * proveedores sin evaluar). Los otros diecisiete viven en una pestaña de un
 * archivo que nadie vuelve a abrir — y un auditor sí los va a mirar.
 *
 * MEDIDO sobre la carga real, y coincide con lo que dice esa hoja:
 *
 *     indicadores definidos              0
 *     riesgos sin reducción efectiva     3 de 11   (R7, R8, R10)
 *     inducciones sin cerrar            80 de 80
 *     personas sin descriptor            2 de 16
 *     procesos del mapa sin objetivo    14 de 14
 *     partes sin seguimiento             4 de 4
 *
 * Lo que se prueba aquí es que cada aviso cuenta lo que dice contar. Un aviso
 * que cuenta de más es peor que no tenerlo: se aprende a ignorarlo.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

const ADM = { email: 'adm@x.cl', nombre: 'Ada', rol: 'ADM' };

function ctxBase() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'x', SIGSO_DRIVE_ROOT_FOLDER_ID: 'y' } });
  Object.keys(ctx.COLUMNAS).forEach((h) => { try { seedSheet(ctx, h, ctx.COLUMNAS[h]); } catch (e) {} });
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, [
    ['U1', 'Ada Admin', 'adm@x.cl', 'HP', 'ADM', true, '', 'sistema']
  ]);
  return ctx;
}

function fila(ctx, hoja, valores) {
  return ctx.COLUMNAS[hoja].map((c) => (valores[c] === undefined ? '' : valores[c]));
}

const aviso = (ctx, titulo) => toPlain(ctx.Tablero.resumen({}, ADM)).alertas
  .filter((a) => a.titulo === titulo)[0];

test('cero indicadores se avisa; el aviso de "sin medir" no lo cubría', () => {
  // El aviso viejo cuenta indicadores SIN MEDIR: con cero indicadores da cero
  // y no dice nada. Era un punto ciego -- y no tener ninguno es peor que
  // tenerlos sin medir.
  const ctx = ctxBase();
  const sinNinguno = aviso(ctx, 'No hay ningún indicador definido');
  assert.ok(sinNinguno, 'sin indicadores tiene que avisar');
  assert.equal(sinNinguno.severidad, 'CRITICA', '§9.1.1 sin cumplir en absoluto');

  // El tablero cachea su cuerpo. seedSheet escribe directo en el mock, sin
  // pasar por SheetsRepo, asi que no dispara la invalidacion que si hace una
  // escritura de verdad. Se invalida a mano.
  seedSheet(ctx, 'SGC_INDICADORES', ctx.COLUMNAS.SGC_INDICADORES, [
    fila(ctx, 'SGC_INDICADORES', { indicador_id: 'I1', nombre: 'Uno', activa: true })
  ]);
  ctx.invalidarTableroSgc_();
  assert.equal(aviso(ctx, 'No hay ningún indicador definido'), undefined,
    'con uno definido, el aviso desaparece');
});

test('un riesgo revalorado IGUAL que antes dice que los controles no sirven', () => {
  // El aviso que ya existía busca riesgos SIN revalorar. Este está revalorado
  // -- con el mismo número. Para el aviso viejo está resuelto; en realidad
  // dice, en sus propios términos, que la medida no cambia nada.
  const ctx = ctxBase();
  seedSheet(ctx, 'SGC_RIESGOS', ctx.COLUMNAS.SGC_RIESGOS, [
    fila(ctx, 'SGC_RIESGOS', {
      riesgo_id: 'X1', codigo: 'R7', clase: 'RIESGO', probabilidad: 0.5, impacto: 10,
      probabilidad_residual: 0.5, impacto_residual: 10, estado: 'ABIERTO', activa: true
    }),
    fila(ctx, 'SGC_RIESGOS', {
      riesgo_id: 'X2', codigo: 'R1', clase: 'RIESGO', probabilidad: 0.5, impacto: 10,
      probabilidad_residual: 0.1, impacto_residual: 10, estado: 'ABIERTO', activa: true
    })
  ]);

  const a = aviso(ctx, 'Riesgos cuyos controles no reducen nada');
  assert.ok(a, 'tiene que avisar');
  assert.equal(a.total, 1, 'solo el que NO se movió: el otro sí bajó la probabilidad');
});

test('un riesgo sin revalorar NO cuenta como "sin reducción"', () => {
  // Son dos problemas distintos y cada uno tiene su aviso. Mezclarlos haría
  // que arreglar uno pareciera arreglar el otro.
  const ctx = ctxBase();
  seedSheet(ctx, 'SGC_RIESGOS', ctx.COLUMNAS.SGC_RIESGOS, [
    fila(ctx, 'SGC_RIESGOS', {
      riesgo_id: 'X1', codigo: 'R9', clase: 'RIESGO', probabilidad: 0.5, impacto: 10,
      probabilidad_residual: '', impacto_residual: '', estado: 'ABIERTO', activa: true
    })
  ]);
  const a = aviso(ctx, 'Riesgos cuyos controles no reducen nada');
  assert.equal(a, undefined, 'sin valoración residual no se puede decir que no redujo: falta revalorar');
});

test('una oportunidad no se cuenta como riesgo sin reducción', () => {
  // Una oportunidad no se "reduce": se busca que crezca. Contarla sería pedir
  // que se arregle algo que no está roto.
  const ctx = ctxBase();
  seedSheet(ctx, 'SGC_RIESGOS', ctx.COLUMNAS.SGC_RIESGOS, [
    fila(ctx, 'SGC_RIESGOS', {
      riesgo_id: 'O1', codigo: 'O1', clase: 'OPORTUNIDAD', probabilidad: 0.5, impacto: 10,
      probabilidad_residual: 0.5, impacto_residual: 10, estado: 'ABIERTO', activa: true
    })
  ]);
  assert.equal(aviso(ctx, 'Riesgos cuyos controles no reducen nada'), undefined);
});

test('una persona sin descriptor vigente se avisa (§7.2)', () => {
  const ctx = ctxBase();
  seedSheet(ctx, 'SGC_PERSONAS', ctx.COLUMNAS.SGC_PERSONAS, [
    fila(ctx, 'SGC_PERSONAS', { persona_id: 'P1', nombre: 'Con', estado: 'ACTIVO', activa: true }),
    fila(ctx, 'SGC_PERSONAS', { persona_id: 'P2', nombre: 'Sin', estado: 'ACTIVO', activa: true })
  ]);
  seedSheet(ctx, 'SGC_DESCRIPTORES', ctx.COLUMNAS.SGC_DESCRIPTORES, [
    fila(ctx, 'SGC_DESCRIPTORES', { descriptor_id: 'D1', persona_id: 'P1', vigente: true })
  ]);

  const a = aviso(ctx, 'Personas sin descriptor de cargo');
  assert.equal(a.total, 1, 'solo la que no tiene');
});

test('un descriptor NO vigente no cuenta como descriptor', () => {
  // La vigencia se marca con `vigente`, no con `activa` como el resto de las
  // hojas del SGC. Confundir las dos columnas hace que la persona parezca
  // cubierta cuando su descriptor está archivado.
  const ctx = ctxBase();
  seedSheet(ctx, 'SGC_PERSONAS', ctx.COLUMNAS.SGC_PERSONAS, [
    fila(ctx, 'SGC_PERSONAS', { persona_id: 'P1', nombre: 'Uno', estado: 'ACTIVO', activa: true })
  ]);
  seedSheet(ctx, 'SGC_DESCRIPTORES', ctx.COLUMNAS.SGC_DESCRIPTORES, [
    fila(ctx, 'SGC_DESCRIPTORES', { descriptor_id: 'D1', persona_id: 'P1', vigente: false })
  ]);
  assert.equal(aviso(ctx, 'Personas sin descriptor de cargo').total, 1);
});

test('las inducciones abiertas se cuentan; las completadas no (§7.3)', () => {
  const ctx = ctxBase();
  seedSheet(ctx, 'SGC_INDUCCIONES', ctx.COLUMNAS.SGC_INDUCCIONES, [
    fila(ctx, 'SGC_INDUCCIONES', { induccion_id: 'I1', estado: 'PENDIENTE' }),
    fila(ctx, 'SGC_INDUCCIONES', { induccion_id: 'I2', estado: 'PENDIENTE' }),
    fila(ctx, 'SGC_INDUCCIONES', { induccion_id: 'I3', estado: 'COMPLETADA' })
  ]);
  assert.equal(aviso(ctx, 'Inducciones sin cerrar').total, 2);
});

test('los procesos del mapa sin objetivo se avisan, los de servicio no', () => {
  // El objetivo se le pide al proceso del MAPA (§4.4.1). Un paso de servicio
  // no lleva objetivo propio, y contarlo inflaría el aviso hasta volverlo
  // inútil: en la carga real hay 14 del mapa y 40 de servicio.
  const ctx = ctxBase();
  seedSheet(ctx, 'SGC_PROCESOS', ctx.COLUMNAS.SGC_PROCESOS, [
    fila(ctx, 'SGC_PROCESOS', { proceso_id: 'M1', nivel: 'MAPA', objetivo: '', responsable_email: 'a@x.cl', activa: true }),
    fila(ctx, 'SGC_PROCESOS', { proceso_id: 'M2', nivel: 'MAPA', objetivo: 'Tiene', responsable_email: 'a@x.cl', activa: true }),
    fila(ctx, 'SGC_PROCESOS', { proceso_id: 'S1', nivel: 'SERVICIO', objetivo: '', activa: true })
  ]);
  assert.equal(aviso(ctx, 'Procesos sin objetivo declarado').total, 1);
});

test('una parte interesada sin método o sin frecuencia se avisa (§4.2)', () => {
  const ctx = ctxBase();
  seedSheet(ctx, 'SGC_PARTES_INTERESADAS', ctx.COLUMNAS.SGC_PARTES_INTERESADAS, [
    fila(ctx, 'SGC_PARTES_INTERESADAS', { parte_id: 'A', metodo_seguimiento: 'Encuesta', frecuencia_seguimiento: 'Anual', activa: true }),
    fila(ctx, 'SGC_PARTES_INTERESADAS', { parte_id: 'B', metodo_seguimiento: 'Encuesta', frecuencia_seguimiento: '', activa: true }),
    fila(ctx, 'SGC_PARTES_INTERESADAS', { parte_id: 'C', metodo_seguimiento: '', frecuencia_seguimiento: 'Anual', activa: true })
  ]);
  assert.equal(aviso(ctx, 'Partes interesadas sin seguimiento definido').total, 2,
    'falta el método O la frecuencia_seguimiento: con una de las dos no hay seguimiento que mostrar');
});

test('sin datos, ninguno de los avisos nuevos cuenta de más', () => {
  // Un tablero recién instalado no puede llenarse de avisos con total 0: la
  // función `alerta` los descarta, y eso es lo que mantiene la lista legible.
  const ctx = ctxBase();
  const titulos = toPlain(ctx.Tablero.resumen({}, ADM)).alertas.map((a) => a.titulo);
  ['Riesgos cuyos controles no reducen nada', 'Personas sin descriptor de cargo',
    'Inducciones sin cerrar', 'Procesos sin objetivo declarado',
    'Partes interesadas sin seguimiento definido'].forEach((t) => {
    assert.equal(titulos.indexOf(t), -1, t + ' no debería aparecer sin datos');
  });
});
