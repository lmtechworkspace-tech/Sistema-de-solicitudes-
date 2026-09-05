'use strict';

/**
 * R-01: el proyecto exportado a hoja de cálculo.
 *
 * Se prueba `armarLibroProyecto_`, que es PURA (arma las filas y no toca Drive
 * ni la red). Es donde puede haber errores de verdad: una columna que cambió
 * de nombre, un dato mal mapeado, un id crudo escapándose a una celda.
 *
 * La producción del .xlsx queda deliberadamente fuera: la hace el exportador
 * de Google a partir de una hoja temporal, y aquí no hay forma de abrir el
 * binario para comprobar que salió bien. Testear un mock de eso daría
 * confianza falsa; lo que sí se puede afirmar es que los DATOS que se le
 * entregan son los correctos.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject, seedSheet, toPlain } = require('./helpers/gasSandbox');

function ctxConSchema() {
  const ctx = loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'fake', SIGSO_DRIVE_ROOT_FOLDER_ID: 'fake' } });
  Object.keys(ctx.COLUMNAS).forEach((h) => { try { seedSheet(ctx, h, ctx.COLUMNAS[h]); } catch (e) { /* hoja de otro proyecto */ } });
  return ctx;
}

const ADM = { email: 'adm@x.cl', nombre: 'Admin', rol: 'ADM' };

function armarEscenario(ctx) {
  const p = toPlain(ctx.Proyectos.crear({
    nombre: 'Migración ERP', lider_email: 'leo@rld.cl',
    fecha_inicio: '2026-01-15', fecha_objetivo: '2026-11-30'
  }, ADM));
  const hito = toPlain(ctx.Proyectos.gestionarHito({
    proyecto_id: p.proyecto_id, accion: 'crear', nombre: 'Puesta en marcha', fecha_objetivo: '2026-06-30'
  }, ADM));
  const t1 = toPlain(ctx.Proyectos.crearTarea({
    proyecto_id: p.proyecto_id, titulo: 'Levantar requerimientos',
    responsable_email: 'leo@rld.cl', tamano: 'M', fecha_compromiso: '2026-03-15', hito_id: hito.hito_id
  }, ADM));
  const t2 = toPlain(ctx.Proyectos.crearTarea({
    proyecto_id: p.proyecto_id, titulo: 'Migrar datos',
    responsable_email: 'leo@rld.cl', tamano: 'L', fecha_compromiso: '2026-05-20'
  }, ADM));
  ctx.Proyectos.editarTarea({ proyecto_id: p.proyecto_id, actividad_id: t2.actividad_id, depende_de: t1.actividad_id }, ADM);
  ctx.Proyectos.gestionarRiesgo({
    proyecto_id: p.proyecto_id, accion: 'crear', descripcion: 'El proveedor no entrega a tiempo',
    probabilidad: 'ALTA', impacto: 'ALTA', mitigacion: 'Contrato con multa'
  }, ADM);
  return { p, hito, t1, t2 };
}

function hojaLlamada(hojas, nombre) {
  return hojas.filter((h) => h.nombre === nombre)[0];
}

test('el libro trae una hoja por bloque del proyecto', () => {
  const ctx = ctxConSchema();
  const { p } = armarEscenario(ctx);
  const detalle = toPlain(ctx.Proyectos.getDetalle({ proyecto_id: p.proyecto_id }, ADM));
  const tareas = toPlain(ctx.Proyectos.listarTareas({ proyecto_id: p.proyecto_id }, ADM));
  const hojas = toPlain(ctx.armarLibroProyecto_(detalle, tareas, []));

  assert.deepEqual(
    hojas.map((h) => h.nombre),
    ['Resumen', 'Tareas', 'Hitos', 'Riesgos', 'Entregables', 'Equipo', 'Bitácora']
  );
  // Toda hoja arranca con su encabezado, incluso si no tiene datos: un archivo
  // con una pestaña vacía sin títulos no se entiende.
  hojas.forEach((h) => {
    assert.ok(h.filas.length >= 1, 'la hoja ' + h.nombre + ' no trae ni encabezado');
    assert.ok(h.filas[0].every((c) => String(c).length), 'encabezado incompleto en ' + h.nombre);
  });
});

test('las tareas salen con el TÍTULO de su hito y de su dependencia, no con ids', () => {
  const ctx = ctxConSchema();
  const { p } = armarEscenario(ctx);
  const detalle = toPlain(ctx.Proyectos.getDetalle({ proyecto_id: p.proyecto_id }, ADM));
  const tareas = toPlain(ctx.Proyectos.listarTareas({ proyecto_id: p.proyecto_id }, ADM));
  const hojas = toPlain(ctx.armarLibroProyecto_(detalle, tareas, []));

  const hoja = hojaLlamada(hojas, 'Tareas');
  const cab = hoja.filas[0];
  const iHito = cab.indexOf('Hito');
  const iDep = cab.indexOf('Depende de');
  const filas = hoja.filas.slice(1);

  const levantar = filas.filter((f) => f[0] === 'Levantar requerimientos')[0];
  const migrar = filas.filter((f) => f[0] === 'Migrar datos')[0];
  assert.ok(levantar && migrar, 'faltan tareas en la hoja');

  assert.equal(levantar[iHito], 'Puesta en marcha', 'debe verse el nombre del hito');
  assert.equal(migrar[iDep], 'Levantar requerimientos',
    'la dependencia debe salir por su título: un id crudo no le dice nada a quien abre el archivo');

  // Y ningún id se cuela como valor de celda.
  filas.forEach((f) => f.forEach((c) => {
    assert.doesNotMatch(String(c), /^test-uuid-/, 'se filtró un id a una celda: ' + c);
  }));
});

test('el resumen usa la misma cifra de salud que la pantalla (puntos en contra)', () => {
  const ctx = ctxConSchema();
  const { p } = armarEscenario(ctx);
  const detalle = toPlain(ctx.Proyectos.getDetalle({ proyecto_id: p.proyecto_id }, ADM));
  const hojas = toPlain(ctx.armarLibroProyecto_(detalle, [], []));

  const resumen = hojaLlamada(hojas, 'Resumen');
  const claves = resumen.filas.map((f) => f[0]);
  assert.ok(claves.indexOf('Puntos en contra') !== -1,
    'debe traer la penalización, la misma cifra que muestra el pill desde P-02');
  assert.equal(claves.indexOf('Score'), -1, 'no debe reaparecer la nota sobre 100 que P-02 quitó');
  assert.ok(claves.indexOf('Proyecto') !== -1 && claves.indexOf('Emitido') !== -1);
});

test('un proyecto vacío produce un libro con todas las hojas y solo encabezados', () => {
  const ctx = ctxConSchema();
  const p = toPlain(ctx.Proyectos.crear({
    nombre: 'Recién creado', lider_email: 'leo@rld.cl',
    fecha_inicio: '2026-01-01', fecha_objetivo: '2026-12-01'
  }, ADM));
  const detalle = toPlain(ctx.Proyectos.getDetalle({ proyecto_id: p.proyecto_id }, ADM));
  const hojas = toPlain(ctx.armarLibroProyecto_(detalle, [], []));

  assert.equal(hojas.length, 7);
  assert.equal(hojaLlamada(hojas, 'Tareas').filas.length, 1, 'solo el encabezado');
  assert.equal(hojaLlamada(hojas, 'Riesgos').filas.length, 1);
  // El resumen SÍ tiene contenido: la ficha del proyecto existe aunque no
  // haya nada dentro todavía.
  assert.ok(hojaLlamada(hojas, 'Resumen').filas.length > 5);
});

test('todas las filas de una hoja tienen el ancho de su encabezado', () => {
  // Si una fila trae más o menos celdas que el encabezado, la exportación
  // escribe columnas corridas y el archivo miente sin avisar.
  const ctx = ctxConSchema();
  const { p } = armarEscenario(ctx);
  const detalle = toPlain(ctx.Proyectos.getDetalle({ proyecto_id: p.proyecto_id }, ADM));
  const tareas = toPlain(ctx.Proyectos.listarTareas({ proyecto_id: p.proyecto_id }, ADM));
  const hojas = toPlain(ctx.armarLibroProyecto_(detalle, tareas, []));

  hojas.forEach((h) => {
    const ancho = h.filas[0].length;
    h.filas.forEach((fila, i) => {
      assert.equal(fila.length, ancho,
        'la hoja "' + h.nombre + '" tiene la fila ' + i + ' con ' + fila.length + ' celdas y su encabezado con ' + ancho);
    });
  });
});

/**
 * generarXlsxProyecto_ crea una hoja de cálculo TEMPORAL en el Drive de quien
 * descarga y la exporta. El archivo tiene que desaparecer siempre: si no, cada
 * descarga fallida deja basura en el Drive de una persona que ni se entera.
 *
 * No se prueba el .xlsx en sí -- lo produce el exportador de Google y aquí no
 * hay forma de abrir el binario. Se prueba la parte que SÍ es nuestra: que las
 * hojas se armen con su nombre y que el temporal se limpie pase lo que pase.
 */
function conStubsDeDrive(ctx, opciones) {
  const estado = { creadas: [], escrituras: [], borrados: [], respuesta: opciones.respuesta };
  // Se CONSERVA el SpreadsheetApp original y solo se le agrega create/flush:
  // reemplazarlo entero dejaba las lecturas de hoja dependiendo de que el
  // cache de ejecucion estuviera caliente, y un test que pasa por suerte no
  // prueba nada.
  ctx.SpreadsheetApp = Object.assign({}, ctx.SpreadsheetApp, {
    flush() {},
    create(nombre) {
      estado.creadas.push(nombre);
      const hojas = [];
      const nuevaHoja = () => {
        const h = {
          _nombre: '', _valores: null,
          setName(n) { h._nombre = n; return h; },
          getRange(f, c, nf, nc) {
            return {
              setValues(v) { estado.escrituras.push({ hoja: h._nombre, filas: v.length, cols: nc }); return this; },
              setFontWeight() { return this; }
            };
          },
          setFrozenRows() { return h; }
        };
        hojas.push(h);
        return h;
      };
      nuevaHoja();   // la que Google crea por defecto
      return {
        getId: () => 'temp-id-1',
        getSheets: () => hojas,
        insertSheet: nuevaHoja
      };
    },
  });
  ctx.UrlFetchApp = {
    fetch() {
      if (opciones.lanzar) throw new Error('red caida');
      return {
        getResponseCode: () => estado.respuesta,
        getBlob: () => ({ getBytes: () => [80, 75, 3, 4] })   // firma PK de un zip
      };
    }
  };
  ctx.ScriptApp = { getOAuthToken: () => 'token-falso' };
  ctx.DriveApp = Object.assign({}, ctx.DriveApp, {
    getFileById(id) { return { setTrashed(v) { estado.borrados.push({ id, v }); } }; }
  });
  return estado;
}

test('el libro se arma con una hoja por bloque y el temporal se borra', () => {
  const ctx = ctxConSchema();
  const { p } = armarEscenario(ctx);
  const estado = conStubsDeDrive(ctx, { respuesta: 200 });

  const r = toPlain(ctx.Proyectos.descargarLibro({ proyecto_id: p.proyecto_id }, ADM));

  assert.ok(r.xlsx_base64, 'debe devolver el archivo en base64');
  assert.match(r.filename, /\.xlsx$/);
  assert.equal(estado.creadas.length, 1, 'una sola hoja temporal');
  assert.equal(estado.escrituras.length, 7, 'una escritura por lote, por hoja');
  assert.deepEqual(
    estado.escrituras.map((e) => e.hoja),
    ['Resumen', 'Tareas', 'Hitos', 'Riesgos', 'Entregables', 'Equipo', 'Bitácora']
  );
  assert.deepEqual(estado.borrados, [{ id: 'temp-id-1', v: true }], 'el temporal debe quedar en la papelera');
});

test('si la exportación devuelve error, el temporal se borra igual', () => {
  const ctx = ctxConSchema();
  const { p } = armarEscenario(ctx);
  const estado = conStubsDeDrive(ctx, { respuesta: 500 });

  const r = toPlain(ctx.Proyectos.descargarLibro({ proyecto_id: p.proyecto_id }, ADM));

  assert.ok(r._validationError, 'debe avisar del fallo, no devolver un archivo vacío');
  assert.deepEqual(estado.borrados, [{ id: 'temp-id-1', v: true }],
    'un export fallido NO puede dejar la hoja temporal en el Drive de la persona');
});

test('si la red se cae a mitad de camino, el temporal se borra igual', () => {
  const ctx = ctxConSchema();
  const { p } = armarEscenario(ctx);
  const estado = conStubsDeDrive(ctx, { respuesta: 200, lanzar: true });

  assert.throws(() => ctx.Proyectos.descargarLibro({ proyecto_id: p.proyecto_id }, ADM));
  assert.deepEqual(estado.borrados, [{ id: 'temp-id-1', v: true }],
    'el finally tiene que correr aunque la excepción suba');
});

test('un ajeno no puede descargar el libro', () => {
  const ctx = ctxConSchema();
  const { p } = armarEscenario(ctx);
  conStubsDeDrive(ctx, { respuesta: 200 });
  const r = toPlain(ctx.Proyectos.descargarLibro({ proyecto_id: p.proyecto_id }, { email: 'ajeno@x.cl', rol: 'DEV' }));
  assert.ok(r._forbidden, 'mismo gate de lectura que el PDF');
});
