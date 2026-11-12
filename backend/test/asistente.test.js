'use strict';

/**
 * Asistente SIGSO (2026-11-11): herramientas, permisos y el ciclo de
 * conversación con un Claude SIMULADO (los tests nunca llaman a la API).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const { construirZip_ } = require('../logica/xlsxZip');
const Sesiones = require('../logica/sesiones');
const Asistente = require('../logica/asistente');
const I = Asistente._interno;

function db_() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'C-ADM', usuario: 'adm', nombre: 'Ana Admin', emails: '["adm@x.cl"]', rol: 'ADM', modulos: '["bandeja"]', activo: true, hash_password: 'SECRETO', salt: 'SAL' });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'C-DEV', usuario: 'dev', nombre: 'Diego Dev', emails: '["dev@x.cl"]', rol: 'DEV', modulos: '["bandeja"]', activo: true });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'C-AS', usuario: 'as', nombre: 'Sara', emails: '["sara@x.cl"]', rol: 'DEV', modulos: '["bandeja","asistente"]', activo: true });
  const ivas = [['Cliente Uno', 'SIN MOVIMIENTO', 'SI'], ['Cliente Dos', 'CON MOVIMIENTO', 'SI'], ['Cliente Tres', 'SIN MOVIMIENTO', ''], ['Cliente Cuatro', 'CON MOVIMIENTO', '']];
  ivas.forEach(([cli, estatus, realizado], i) => agregarFila_(db, 'CI_REGISTROS', {
    registro_id: 'R' + i, depto: 'CONTABILIDAD', matriz: 'IVA', periodo: '2026-M10', cliente_nombre: cli, estado: realizado ? 'TERMINADO' : 'PENDIENTE',
    datos: { empresa: cli, estatus, realizado, n: i + 1 }, activa: true, fecha_creacion: '2026-10-01T00:00:00Z'
  }));
  return db;
}
const ADM = { cuenta_id: 'C-ADM', email: 'adm@x.cl', rol: 'ADM', modulos: ['bandeja'] };
const DEV = { cuenta_id: 'C-DEV', email: 'dev@x.cl', rol: 'DEV', modulos: ['bandeja'] };

test('Quién puede usarlo: ADM, super admin y el módulo `asistente`; el resto no', () => {
  assert.equal(Asistente.puedeUsar(ADM), true);
  assert.equal(Asistente.puedeUsar(DEV), false);
  assert.equal(Asistente.puedeUsar({ rol: 'DEV', modulos: ['asistente'] }), true);
  assert.equal(Asistente.puedeUsar({ rol: 'ANA', modulos: [], super_admin: true }), true);
  const db = db_();
  assert.ok(Asistente.estado(db, {}, DEV)._forbidden);
  const e = Asistente.estado(db, {}, ADM);
  assert.equal(e.usadas_hoy, 0);
  assert.equal(e.explora_tablas, true);
});

test('ver: filtra sin importar tildes ni mayúsculas, agrupa y cuenta', () => {
  const filas = [{ a: 'Sí', d: { x: 1 } }, { a: 'si', d: { x: 2 } }, { a: 'No', d: { x: 3 } }, { a: '', d: { x: 4 } }];
  const r = I.aplicarVer_({ lista: filas, otra: [] }, { filtro: [{ campo: 'a', op: '=', valor: 'SI' }], agrupar_por: 'd.x', contar: true }).datos;
  assert.equal(r.lista, 'lista');
  assert.equal(r.coinciden, 2);
  assert.equal(r.filas, undefined, 'contar: sin filas');
  assert.deepEqual(r.grupos.map((g) => g.valor).sort(), ['1', '2']);
  const v = I.aplicarVer_(filas, { filtro: [{ campo: 'd.x', op: '>=', valor: 3 }], campos: ['d.x'] }).datos;
  assert.deepEqual(v.filas, [{ 'd.x': 3 }, { 'd.x': 4 }]);
  assert.equal(I.aplicarVer_(filas, { filtro: [{ campo: 'a', op: 'vacio' }] }).datos.coinciden, 1);
  assert.ok(I.aplicarVer_({ a: 1 }, { ruta: 'a' }).error);
});

test('compactar: listas largas se recortan y nunca viajan claves, hashes ni base64', () => {
  const t = I.aTexto_({ filas: Array.from({ length: 500 }, (_, i) => ({ i, hash_password: 'x', token: 'y', contenido_base64: 'z' })) });
  assert.ok(t.length <= 30100);
  assert.ok(!/hash_password|"token"|base64/.test(t));
  assert.match(t, /_omitidos/);
});

test('consultar_sigso: una matriz real del departamento, agrupada (¿cuántos sin movimiento?)', async () => {
  const db = db_();
  const r = await I.ejecutarHerramienta_(db, 'consultar_sigso', {
    accion: 'listarRegistrosCI', parametros: { matriz: 'IVA', periodo: '2026-M10' },
    ver: { ruta: 'registros', agrupar_por: 'datos.estatus', contar: true }
  }, ADM);
  assert.ok(!r.error, r.texto);
  const datos = JSON.parse(r.texto);
  assert.equal(datos.total_en_lista, 4);
  const sinMov = datos.grupos.find((g) => g.valor === 'SIN MOVIMIENTO');
  assert.equal(sinMov.cantidad, 2);
});

test('consultar_sigso: hereda los permisos de la persona y rechaza lo que no está en el catálogo', async () => {
  const db = db_();
  const r = await I.ejecutarHerramienta_(db, 'consultar_sigso', { accion: 'listarRegistrosCI', parametros: { matriz: 'IVA', periodo: '2026-M10' } }, DEV);
  assert.equal(r.error, true);
  assert.match(r.texto, /acceso/i);
  const w = await I.ejecutarHerramienta_(db, 'consultar_sigso', { accion: 'guardarRegistroCI', parametros: {} }, ADM);
  assert.equal(w.error, true);
  assert.match(w.texto, /catálogo/);
});

test('Segunda barrera: aunque una acción escriba, lo que hace en su parte síncrona se deshace', async () => {
  const db = db_();
  const antes = leerFilas_(db, 'PREFERENCIAS_CUENTA', COLUMNAS.PREFERENCIAS_CUENTA).length;
  await I.correrAccion_(db, 'guardarFijados', { fijados: ['bandeja', 'proyectos'] }, ADM);
  assert.equal(leerFilas_(db, 'PREFERENCIAS_CUENTA', COLUMNAS.PREFERENCIAS_CUENTA).length, antes, 'nada quedó escrito');
  // La base sigue usable después (el SAVEPOINT se liberó).
  agregarFila_(db, 'PREFERENCIAS_CUENTA', { cuenta_id: 'C-ADM', clave: 'k', valor: 'v' });
  assert.equal(leerFilas_(db, 'PREFERENCIAS_CUENTA', COLUMNAS.PREFERENCIAS_CUENTA).length, antes + 1);
});

test('explorar_tabla: solo Administración, sin tablas de sesiones ni columnas de contraseñas', async () => {
  const db = db_();
  assert.ok(I.herramientas_(ADM).some((t) => t.name === 'explorar_tabla'));
  assert.ok(!I.herramientas_(DEV).some((t) => t.name === 'explorar_tabla'));
  const enumTablas = I.herramientas_(ADM).find((t) => t.name === 'explorar_tabla').input_schema.properties.tabla.enum;
  assert.ok(enumTablas.indexOf('SESIONES_PORTAL') === -1 && enumTablas.indexOf('RESETS_PASSWORD') === -1);
  const r = await I.ejecutarHerramienta_(db, 'explorar_tabla', { tabla: 'CUENTAS_PORTAL', ver: { limite: 10 } }, ADM);
  assert.ok(!/SECRETO|SAL"|hash_password|"salt"/.test(r.texto), r.texto);
  assert.match(r.texto, /Ana Admin/);
  const no = await I.ejecutarHerramienta_(db, 'explorar_tabla', { tabla: 'CUENTAS_PORTAL' }, DEV);
  assert.equal(no.error, true);
});

test('Manuales: encuentra cómo se hace algo', () => {
  const t = I.buscarEnManuales_('cómo comprometer fecha en la bandeja');
  assert.match(t, /Manual «/);
  assert.ok(t.length > 200);
});

test('Documentos: Word, Excel y PowerPoint se leen como texto; PDF e imágenes van directo; .doc antiguo se explica', () => {
  const docx = construirZip_([{ nombre: 'word/document.xml', contenido: Buffer.from('<w:document><w:body><w:p><w:r><w:t>Reglamento interno</w:t></w:r></w:p><w:p><w:r><w:t>Artículo 1: horario 9 a 18 &amp; colación</w:t></w:r></w:p></w:body></w:document>') }]);
  const d = I.bloqueDeArchivo_('reglamento.docx', '', docx.toString('base64'));
  assert.equal(d.bloque.type, 'document');
  assert.match(d.bloque.source.data, /Reglamento interno\nArtículo 1: horario 9 a 18 & colación/);
  const xlsx = construirZip_([
    { nombre: 'xl/workbook.xml', contenido: Buffer.from('<workbook><sheets><sheet name="IVA" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { nombre: 'xl/_rels/workbook.xml.rels', contenido: Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>') },
    { nombre: 'xl/sharedStrings.xml', contenido: Buffer.from('<sst><si><t>Cliente</t></si><si><t>Monto</t></si><si><t>ACME</t></si></sst>') },
    { nombre: 'xl/worksheets/sheet1.xml', contenido: Buffer.from('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>1500</v></c></row></sheetData></worksheet>') }
  ]);
  const x = I.bloqueDeArchivo_('planilla.xlsx', '', xlsx.toString('base64'));
  assert.match(x.bloque.source.data, /### Hoja: IVA/);
  assert.match(x.bloque.source.data, /Cliente\tMonto\nACME\t\t1500/);
  assert.equal(I.bloqueDeArchivo_('a.pdf', 'application/pdf', 'JVBERi0x').bloque.source.media_type, 'application/pdf');
  assert.equal(I.bloqueDeArchivo_('foto.jpg', '', 'AAAA').bloque.type, 'image');
  assert.match(I.bloqueDeArchivo_('viejo.doc', '', 'AAAA').error, /\.docx/);
});

test('Adjuntos: solo los usa quien los subió', () => {
  const db = db_();
  const r = Asistente.adjuntar(db, { nombre: 'nota.txt', mime: 'text/plain', contenido_base64: Buffer.from('hola').toString('base64') }, ADM);
  assert.ok(r.adjunto_id);
  assert.ok(Asistente.adjuntar(db, { nombre: 'x.exe', contenido_base64: 'AAAA' }, ADM)._validationError);
  assert.ok(Asistente.adjuntar(db, { nombre: 'nota.txt', contenido_base64: 'AAAA' }, DEV)._forbidden);
});

// --- el ciclo de conversación con un Claude simulado ---------------------------------

function claudeFalso(respuestas) {
  const llamadas = [];
  return {
    llamadas,
    beta: {
      messages: {
        stream(params) {
          llamadas.push(JSON.parse(JSON.stringify(params)));
          const r = respuestas.shift();
          const oyentes = {};
          return {
            on(ev, fn) { oyentes[ev] = fn; return this; },
            async finalMessage() {
              (r.content || []).forEach((b) => { if (b.type === 'text' && oyentes.text) oyentes.text(b.text); });
              return Object.assign({ usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 } }, r);
            }
          };
        }
      }
    }
  };
}

test('Conversación: consulta SIGSO con la herramienta, responde en vivo y registra el consumo', async () => {
  const db = db_();
  const token = Sesiones.crearSesion(db, 'C-ADM');
  const claude = claudeFalso([
    { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Reviso la matriz de IVA.' }, { type: 'tool_use', id: 'tu1', name: 'consultar_sigso', input: { accion: 'listarRegistrosCI', parametros: { matriz: 'IVA', periodo: '2026-M10' }, ver: { agrupar_por: 'datos.estatus', contar: true } } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hay **2** clientes sin movimiento.' }] }
  ]);
  const eventos = [];
  await Asistente.conversar(db, { portal_token: token, pregunta: '¿Cuántos sin movimientos en octubre?', pantalla: '#/dep_contabilidad', historial: [{ rol: 'usuario', texto: 'hola', contexto: '[ctx viejo]' }, { rol: 'asistente', texto: '¡Hola!' }] }, (e) => eventos.push(e), { cliente: claude });
  const tipos = eventos.map((e) => e.tipo);
  assert.equal(tipos[0], 'contexto');
  assert.ok(tipos.indexOf('estado') !== -1);
  assert.equal(tipos[tipos.length - 1], 'fin');
  const texto = eventos.filter((e) => e.tipo === 'texto').map((e) => e.t).join('');
  assert.match(texto, /Reviso la matriz de IVA\.\n\nHay \*\*2\*\* clientes sin movimiento\./);
  // Historial + pregunta nueva con el contexto (fecha, persona, pantalla) en el mensaje, no en el sistema.
  const primera = claude.llamadas[0];
  assert.equal(primera.messages.length, 3);
  assert.equal(primera.messages[0].content[0].text, '[ctx viejo]\n\nhola');
  assert.match(primera.messages[2].content[0].text, /Pregunta Ana Admin|adm@x\.cl/);
  assert.match(primera.messages[2].content[0].text, /#\/dep_contabilidad/);
  assert.equal(primera.system[0].cache_control.type, 'ephemeral');
  assert.ok(!/adm@x\.cl/.test(primera.system[0].text), 'el sistema no lleva datos de la persona (caché)');
  // La segunda vuelta lleva el resultado real de la herramienta.
  const resultado = claude.llamadas[1].messages[4].content[0];
  assert.equal(resultado.type, 'tool_result');
  assert.match(resultado.content[0].text, /"valor":"SIN MOVIMIENTO","cantidad":2/);
  const usos = leerFilas_(db, 'ASISTENTE_USO', COLUMNAS.ASISTENTE_USO);
  assert.equal(usos.length, 1);
  assert.equal(Number(usos[0].herramientas), 1);
  assert.ok(Number(usos[0].costo_usd) > 0);
  assert.equal(eventos[eventos.length - 1].usadas_hoy, 1);
});

test('Conversación: sin sesión, sin permiso o sin clave de API responde un error claro', async () => {
  const db = db_();
  const ev = [];
  await Asistente.conversar(db, { portal_token: 'no-existe', pregunta: 'x' }, (e) => ev.push(e), { cliente: claudeFalso([]) });
  assert.match(ev[0].mensaje, /Sesión/);
  const tokDev = Sesiones.crearSesion(db, 'C-DEV');
  ev.length = 0;
  await Asistente.conversar(db, { portal_token: tokDev, pregunta: 'x' }, (e) => ev.push(e), { cliente: claudeFalso([]) });
  assert.match(ev[0].mensaje, /no tiene el Asistente/);
  const tokSara = Sesiones.crearSesion(db, 'C-AS');
  const antes = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  ev.length = 0;
  await Asistente.conversar(db, { portal_token: tokSara, pregunta: 'x' }, (e) => ev.push(e));
  assert.match(ev[0].mensaje, /no está configurado/);
  if (antes !== undefined) process.env.ANTHROPIC_API_KEY = antes;
});

test('Tope diario: al llegar al máximo deja de responder', async () => {
  const db = db_();
  const tok = Sesiones.crearSesion(db, 'C-AS');
  const antes = process.env.SIGSO_ASISTENTE_TOPE_DIA;
  process.env.SIGSO_ASISTENTE_TOPE_DIA = '1';
  try {
    await Asistente.conversar(db, { portal_token: tok, pregunta: 'a' }, () => {}, { cliente: claudeFalso([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }]) });
    const ev = [];
    await Asistente.conversar(db, { portal_token: tok, pregunta: 'b' }, (e) => ev.push(e), { cliente: claudeFalso([]) });
    assert.match(ev[0].mensaje, /máximo de 1 preguntas/);
  } finally {
    if (antes === undefined) delete process.env.SIGSO_ASISTENTE_TOPE_DIA; else process.env.SIGSO_ASISTENTE_TOPE_DIA = antes;
  }
});

test('La sesión avisa quién tiene el asistente (solo para pintar el botón)', () => {
  const Portal = require('../logica/portal');
  const db = db_();
  const tokSara = Sesiones.crearSesion(db, 'C-AS');
  const tokDev = Sesiones.crearSesion(db, 'C-DEV');
  const s1 = Portal.sesion(db, { token: tokSara });
  const s2 = Portal.sesion(db, { token: tokDev });
  assert.equal(s1.cuenta.asistente, true);
  assert.equal(s2.cuenta.asistente, undefined);
});

test('Cada consulta del catálogo y cada origen de archivo existe en el router y ninguna es de escritura', () => {
  const { ACCIONES } = require('../server/router');
  const { CATALOGO, ARCHIVOS } = require('../logica/asistenteConocimiento');
  CATALOGO.forEach(([accion]) => {
    assert.equal(typeof ACCIONES[accion], 'function', accion + ' no existe en el router');
    assert.ok(!/^(guardar|crear|actualizar|eliminar|gestionar|registrar|marcar|enviar|aprobar|anular|cerrar|subir|importar|publicar|abrir|tomar|recibir|asignar|sembrar|validar|devolver|avanzar|comentar|cambiar|programar|convocar|evaluar|liberar|desvincular|quitar|reasignar|pedir|reprogramar|congelar|convertir|arreglar|aplicar)/.test(accion), accion + ' parece de escritura');
  });
  Object.keys(ARCHIVOS).forEach((k) => assert.equal(typeof ACCIONES[ARCHIVOS[k].accion], 'function', ARCHIVOS[k].accion));
});
