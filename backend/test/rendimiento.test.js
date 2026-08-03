'use strict';

/**
 * v6.9: techo de OPERACIONES DE HOJA por accion.
 *
 * En Apps Script cada getRange().getValues() / appendRow / setValues es un
 * round-trip real (~50-200 ms). El sistema se puso lento porque varias
 * funciones leian la misma hoja dentro de un bucle: el panel de
 * cumplimiento llegaba a ~344 operaciones por request y el recordatorio
 * diario a ~331, creciendo con el volumen de datos.
 *
 * Estos tests fijan un techo y, sobre todo, verifican que el costo NO crece
 * con la cantidad de novedades/personas. Un N+1 nuevo hace fallar el test
 * en vez de descubrirse en produccion.
 *
 * Los numeros son techos holgados (no exactos) para no romperse por un
 * cambio menor legitimo; lo que protegen es el ORDEN DE MAGNITUD.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet } = require('./helpers/gasSandbox');

// Cuenta lecturas y escrituras reales sobre el mock de Sheets.
function contarOperaciones(ctx) {
  const conteo = { lecturas: 0, escrituras: 0 };
  const ss = ctx.SpreadsheetApp.openById('fake-sheet-id');
  const getSheetByNameOriginal = ss.getSheetByName.bind(ss);
  ss.getSheetByName = function (nombre) {
    const hoja = getSheetByNameOriginal(nombre);
    if (!hoja || hoja.__contada) return hoja;
    const getRangeOriginal = hoja.getRange.bind(hoja);
    hoja.getRange = function () {
      const rango = getRangeOriginal.apply(null, arguments);
      const getValuesOriginal = rango.getValues.bind(rango);
      rango.getValues = function () { conteo.lecturas++; return getValuesOriginal(); };
      if (rango.setValues) {
        const setValuesOriginal = rango.setValues.bind(rango);
        rango.setValues = function (v) { conteo.escrituras++; return setValuesOriginal(v); };
      }
      return rango;
    };
    const appendRowOriginal = hoja.appendRow.bind(hoja);
    hoja.appendRow = function (f) { conteo.escrituras++; return appendRowOriginal(f); };
    hoja.__contada = true;
    return hoja;
  };
  ctx._spreadsheetMemo_ = null; // que el repo tome el envoltorio
  return conteo;
}

const total = (c) => c.lecturas + c.escrituras;

// Escenario realista: N novedades (mitad dirigidas a personas puntuales,
// mitad a todos) y M personas con credenciales.
function montar({ novedades, personas, conPlazo }) {
  const ctx = loadBackofficeProject({
    scriptProperties: { SIGSO_SHEET_ID: 'fake-sheet-id', SIGSO_DRIVE_ROOT_FOLDER_ID: 'root' }
  });
  seedSheet(ctx, 'CAT_AREAS', ctx.COLUMNAS.CAT_AREAS, [['GEN', 'General', 'autor@rld.cl', true]]);
  ['NOVEDADES', 'NOVEDADES_LECTURAS', 'NOVEDADES_HISTORIAL', 'NOVEDADES_AUDIENCIA',
    'LOG_NOTIFICACIONES', 'CUENTAS_PORTAL'].forEach((hoja) => {
    seedSheet(ctx, hoja, ctx.COLUMNAS[hoja]);
  });
  seedSheet(ctx, 'JEFATURAS', ctx.COLUMNAS.JEFATURAS, [['J1', 'jefe@rld.cl', 'autor@rld.cl', true]]);

  const usuarios = [
    ['UA', 'Autor', 'autor@rld.cl', 'HP', 'ANA', true, '', 's'],
    ['UADM', 'Adm', 'adm@rld.cl', 'HP', 'ADM', true, '', 's']
  ];
  for (let i = 0; i < personas; i++) {
    usuarios.push([`U${i}`, `Persona ${i}`, `p${i}@homepymes.cl`, 'HP', 'DEV', true, '', 's']);
  }
  seedSheet(ctx, 'USUARIOS', ctx.COLUMNAS.USUARIOS, usuarios);

  const limite = new Date();
  limite.setDate(limite.getDate() + 5);
  for (let i = 0; i < novedades; i++) {
    const dirigida = i % 2 === 0;
    ctx.Novedades.publicar({
      tipo: 'AVISO', titulo: `Aviso ${i}`, resumen: 'R', area_id: 'GEN',
      audiencia_tipo: dirigida ? 'SELECCION' : undefined,
      destinatarios: dirigida ? [`p${i % personas}@homepymes.cl`] : undefined,
      fecha_limite_acuse: conPlazo ? limite.toISOString().slice(0, 10) : undefined
    }, { email: 'autor@rld.cl', rol: 'ANA' });
  }
  return ctx;
}

test('getFeed no relee hojas por cada novedad (sin N+1)', () => {
  const ctx = montar({ novedades: 30, personas: 20 });
  const conteo = contarOperaciones(ctx);
  ctx.Novedades.getFeed({}, { email: 'p1@homepymes.cl', rol: 'DEV' });
  assert.ok(total(conteo) <= 6,
    `getFeed hizo ${total(conteo)} operaciones de hoja con 30 novedades (esperado <= 6)`);
});

test('getPanelCumplimiento no crece con la cantidad de novedades', () => {
  const chico = montar({ novedades: 10, personas: 20, conPlazo: true });
  const cChico = contarOperaciones(chico);
  chico.Novedades.getPanelCumplimiento({}, { email: 'adm@rld.cl', rol: 'ADM' });

  const grande = montar({ novedades: 40, personas: 20, conPlazo: true });
  const cGrande = contarOperaciones(grande);
  grande.Novedades.getPanelCumplimiento({}, { email: 'adm@rld.cl', rol: 'ADM' });

  assert.ok(total(cGrande) <= 8,
    `getPanelCumplimiento hizo ${total(cGrande)} operaciones con 40 novedades (esperado <= 8)`);
  // Lo importante: 4x mas datos NO debe significar 4x mas round-trips.
  assert.equal(total(cGrande), total(cChico),
    `el costo cambio al cuadruplicar los datos (${total(cChico)} -> ${total(cGrande)}): hay un N+1`);
});

test('recordatorioPendientes no escala con personas x novedades', () => {
  const ctx = montar({ novedades: 20, personas: 30, conPlazo: true });
  const conteo = contarOperaciones(ctx);
  ctx.Novedades.recordatorioPendientes();
  // Las escrituras crecen con los correos enviados (LOG_NOTIFICACIONES), lo
  // que es esperable; lo que NO debe crecer son las LECTURAS.
  assert.ok(conteo.lecturas <= 10,
    `recordatorioPendientes hizo ${conteo.lecturas} lecturas de hoja (esperado <= 10)`);
});

test('el cache de lectura no sirve datos viejos despues de escribir', () => {
  const ctx = montar({ novedades: 2, personas: 5 });
  const antes = ctx.Novedades.getFeed({}, { email: 'adm@rld.cl', rol: 'ADM' }).recientes.length;

  ctx.Novedades.publicar({
    tipo: 'AVISO', titulo: 'Recien publicada', resumen: 'R', area_id: 'GEN'
  }, { email: 'autor@rld.cl', rol: 'ANA' });

  const despues = ctx.Novedades.getFeed({}, { email: 'adm@rld.cl', rol: 'ADM' }).recientes.length;
  assert.equal(despues, antes + 1, 'el feed no reflejo la novedad recien creada (cache viejo)');
});

test('el cache de lectura refleja una actualizacion en la misma ejecucion', () => {
  const ctx = montar({ novedades: 1, personas: 5 });
  const id = ctx.leerFilas_('NOVEDADES')[0].novedad_id;

  ctx.Novedades.despublicar({ novedad_id: id }, { email: 'adm@rld.cl', rol: 'ADM' });

  const fila = ctx.leerFilas_('NOVEDADES').filter((n) => n.novedad_id === id)[0];
  assert.equal(fila.activa, false, 'la lectura posterior devolvio el valor previo a la escritura');
});
