'use strict';

/**
 * Hompy, la mascota (2026-10-06): el acceso solo con el módulo `hompy`, los
 * tipos de evento propuestos y editables, el calendario y el reporte de salida
 * a terreno (borrador, cierre con lo mínimo, reapertura y su PDF).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { abrirDb_, sembrarTabla_, agregarFila_, leerFilas_ } = require('../db/sqliteRepo');
const { COLUMNAS } = require('../db/schema');
const H = require('../logica/hompy');
const CuentasPortal = require('../logica/cuentasPortal');

const BARBARA = { email: 'barbara@homepymes.cl', rol: 'DEV', modulos: ['hompy'] };
const ADM_SIN = { email: 'admin@homepymes.cl', rol: 'ADM', modulos: ['administracion'] };
const OTRA = { email: 'otra@homepymes.cl', rol: 'DEV', modulos: ['bandeja'] };

function crear() {
  const db = abrirDb_();
  Object.keys(COLUMNAS).forEach((h) => { try { sembrarTabla_(db, h, COLUMNAS[h], []); } catch (e) { /* */ } });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'c1', usuario: 'barbara', nombre: 'Bárbara Álvarez', emails: JSON.stringify(['barbara@homepymes.cl']), activo: true });
  agregarFila_(db, 'CUENTAS_PORTAL', { cuenta_id: 'c2', usuario: 'lisseth', nombre: 'Lisseth Soto', emails: JSON.stringify(['lisseth@homepymes.cl']), activo: true });
  return db;
}
const rechazado = (r) => r && r._forbidden === true;
const invalido = (r) => r && r._validationError === true;
function hoy() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
function mover(f, n) { return new Date(new Date(f + 'T12:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10); }

test('acceso: solo con el módulo hompy (ni un ADM sin él)', () => {
  const db = crear();
  assert.ok(rechazado(H.datos(db, {}, OTRA)));
  assert.ok(rechazado(H.datos(db, {}, ADM_SIN)), 'el ADM sin el módulo no entra');
  assert.ok(rechazado(H.guardarEvento(db, { titulo: 'x' }, OTRA)));
  assert.ok(rechazado(H.guardarSalida(db, {}, null)));
  const d = H.datos(db, {}, BARBARA);
  assert.equal(d.tipos.length, 5, 'parte con los 5 tipos propuestos');
  assert.ok(d.tipos.every((t) => t.origen === 'PROPUESTA' && t.activo));
  assert.deepEqual(d.personas, ['Bárbara Álvarez', 'Lisseth Soto']);
  assert.ok(CuentasPortal.MODULOS_VALIDOS.includes('hompy'), 'se puede asignar desde Administración');
  assert.ok(!CuentasPortal.MODULOS_POR_ROL.ADM.includes('hompy'), 'no viene por defecto en ningún rol');
});

test('tipos de evento: renombrar, validar y no quedar sin ninguno activo', () => {
  const db = crear();
  const [t1] = H.datos(db, {}, BARBARA).tipos;
  const r = H.guardarTipo(db, { tipo_id: t1.tipo_id, nombre: 'Feria de seguridad', color: 'violeta', icono: 'casco' }, BARBARA);
  assert.equal(r.tipo.nombre, 'Feria de seguridad');
  assert.equal(r.tipo.origen, 'EDITADA');
  assert.equal(r.tipo.color, 'violeta');
  assert.equal(H.guardarTipo(db, { tipo_id: t1.tipo_id, nombre: 'X', color: 'fucsia', icono: 'inventado' }, BARBARA).tipo.color, 'gris', 'color fuera de la lista');
  const otro = H.datos(db, {}, BARBARA).tipos[1];
  assert.ok(invalido(H.guardarTipo(db, { tipo_id: otro.tipo_id, nombre: 'x' }, BARBARA)), 'nombre repetido');
  assert.ok(invalido(H.guardarTipo(db, { nombre: '' }, BARBARA)));
  // Apagar todos menos uno: el último no se puede apagar.
  const tipos = H.datos(db, {}, BARBARA).tipos;
  tipos.slice(1).forEach((t) => H.guardarTipo(db, { tipo_id: t.tipo_id, nombre: t.nombre, color: t.color, icono: t.icono, activo: false }, BARBARA));
  assert.ok(invalido(H.guardarTipo(db, { tipo_id: tipos[0].tipo_id, nombre: tipos[0].nombre, activo: false }, BARBARA)));
  // Hasta 8.
  for (let i = 0; i < 3; i++) assert.ok(H.guardarTipo(db, { nombre: 'Nuevo ' + i }, BARBARA).tipo);
  assert.ok(invalido(H.guardarTipo(db, { nombre: 'Noveno' }, BARBARA)));
});

test('actividades: alta con validaciones, estados y cancelación con motivo', () => {
  const db = crear();
  const tipo = H.datos(db, {}, BARBARA).tipos[0].tipo_id;
  assert.ok(invalido(H.guardarEvento(db, { tipo_id: tipo, fecha: hoy() }, BARBARA)), 'sin título');
  assert.ok(invalido(H.guardarEvento(db, { tipo_id: tipo, titulo: 'Feria', fecha: '2026-02-30' }, BARBARA)), 'fecha inválida');
  assert.ok(invalido(H.guardarEvento(db, { tipo_id: 'nope', titulo: 'Feria', fecha: hoy() }, BARBARA)));
  assert.ok(invalido(H.guardarEvento(db, { tipo_id: tipo, titulo: 'Feria', fecha: hoy(), hora_inicio: '12:00', hora_fin: '11:00' }, BARBARA)));
  const futuro = H.guardarEvento(db, { tipo_id: tipo, titulo: 'Feria BCI', fecha: mover(hoy(), 5), hora_inicio: '10:00', hora_fin: '13:00', lugar: 'Mall', participantes: ['Bárbara Álvarez', 'bárbara álvarez', 'Lisseth Soto'] }, BARBARA).evento;
  assert.equal(futuro.estado, 'PLANIFICADO');
  assert.deepEqual(futuro.participantes, ['Bárbara Álvarez', 'Lisseth Soto'], 'sin duplicados');
  assert.equal(H.cambiarEstadoEvento(db, { evento_id: futuro.evento_id, estado: 'CONFIRMADO' }, BARBARA).evento.estado, 'CONFIRMADO');
  assert.ok(invalido(H.cambiarEstadoEvento(db, { evento_id: futuro.evento_id, estado: 'REALIZADO' }, BARBARA)), 'no se realiza antes de su fecha');
  assert.ok(invalido(H.cambiarEstadoEvento(db, { evento_id: futuro.evento_id, estado: 'CANCELADO' }, BARBARA)), 'cancelar pide motivo');
  const c = H.cambiarEstadoEvento(db, { evento_id: futuro.evento_id, estado: 'CANCELADO', motivo: 'Lluvia' }, BARBARA).evento;
  assert.equal(c.motivo_cancelacion, 'Lluvia');
  assert.ok(invalido(H.guardarSalida(db, { evento_id: futuro.evento_id, datos: {} }, BARBARA)), 'una cancelada no lleva reporte');
  // Editar mantiene el id; eliminar la saca del calendario.
  const ed = H.guardarEvento(db, { evento_id: futuro.evento_id, tipo_id: tipo, titulo: 'Feria BCI (editada)', fecha: mover(hoy(), 6) }, BARBARA).evento;
  assert.equal(ed.titulo, 'Feria BCI (editada)');
  H.eliminarEvento(db, { evento_id: futuro.evento_id }, BARBARA);
  assert.equal(H.datos(db, {}, BARBARA).eventos.length, 0);
});

test('reporte de salida: borrador, cierre con lo mínimo, reapertura y limpieza de datos', () => {
  const db = crear();
  const tipo = H.datos(db, {}, BARBARA).tipos[0].tipo_id;
  const futuro = H.guardarEvento(db, { tipo_id: tipo, titulo: 'Mañana', fecha: mover(hoy(), 1) }, BARBARA).evento;
  assert.ok(invalido(H.guardarSalida(db, { evento_id: futuro.evento_id, datos: {} }, BARBARA)), 'antes de la fecha no hay reporte');

  const ev = H.guardarEvento(db, { tipo_id: tipo, titulo: 'Activación BCI', fecha: mover(hoy(), -2), lugar: 'Sucursal Centro' }, BARBARA).evento;
  // Borrador con datos sucios: se guardan solo los campos conocidos y con su tipo.
  const b = H.guardarSalida(db, { evento_id: ev.evento_id, datos: { hora_inicio: '10:00', hora_fin: '25:00', publico: '1.200', calificacion: 9, material: ['Pendón', 'Cohete'], enlace_fotos: 'javascript:alert(1)', inventado: 'x', apoyo: 'Ana, Ana; Luis' } }, BARBARA);
  assert.equal(b.salida.estado, 'BORRADOR');
  assert.equal(b.evento.estado, 'REALIZADO', 'llenar el reporte marca la salida como realizada');
  const d = b.salida.datos;
  assert.equal(d.hora_fin, '', 'hora inválida se descarta');
  assert.equal(d.publico, 1200, '"1.200" es mil doscientos');
  assert.equal(d.calificacion, 5, 'la nota se acota a 5');
  assert.deepEqual(d.material, ['Pendón']);
  assert.equal(d.enlace_fotos, '');
  assert.deepEqual(d.apoyo, ['Ana', 'Luis']);
  assert.equal(d.inventado, undefined);

  // Cerrar sin lo mínimo: dice qué falta, campo por campo.
  const f = H.guardarSalida(db, { evento_id: ev.evento_id, datos: { hora_inicio: '10:00' }, cerrar: true }, BARBARA);
  assert.ok(invalido(f));
  assert.deepEqual(f.fields.map((x) => x.campo).sort(), ['calificacion', 'estado_traje', 'hora_fin', 'publico', 'traje']);
  assert.match(f.message, /Para cerrar el reporte falta/);

  const completo = { hora_salida: '08:30', hora_inicio: '10:00', hora_fin: '12:15', traje: 'Lisseth Soto', publico: 0, estado_traje: 'LIMPIEZA', calificacion: 4, minutos_traje: 55, pausas: 2, hidratacion: true, bien: 'Mucha gente' };
  const ok = H.guardarSalida(db, { evento_id: ev.evento_id, datos: completo, cerrar: true }, BARBARA);
  assert.equal(ok.salida.estado, 'CERRADO');
  assert.equal(ok.salida.cerrado_por, BARBARA.email);
  assert.equal(ok.salida.datos.publico, 0, 'cero personas es un dato válido');
  assert.ok(invalido(H.guardarSalida(db, { evento_id: ev.evento_id, datos: completo }, BARBARA)), 'cerrado no se edita');
  assert.ok(invalido(H.eliminarEvento(db, { evento_id: ev.evento_id }, BARBARA)), 'con reporte cerrado no se elimina');
  assert.ok(invalido(H.cambiarEstadoEvento(db, { evento_id: ev.evento_id, estado: 'CANCELADO', motivo: 'x' }, BARBARA)));
  assert.equal(H.reabrirSalida(db, { evento_id: ev.evento_id }, BARBARA).salida.estado, 'BORRADOR');
  assert.equal(leerFilas_(db, 'HOMPY_SALIDAS', COLUMNAS.HOMPY_SALIDAS).length, 1, 'una sola fila por actividad');
});

test('PDF: el cuerpo trae la portada, el traje, la evaluación y los gastos', () => {
  const U = { esc: (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), ico: () => '<svg></svg>' };
  const html = H.cuerpoPdf_(
    { evento_id: 'HE-1', titulo: 'Activación <BCI>', fecha: '2026-10-03', lugar: 'Sucursal', comuna: 'Santiago', direccion: '' },
    { nombre: 'Evento con marca', color: 'azul', icono: 'megafono' },
    { estado: 'CERRADO', cerrado_por: 'barbara@homepymes.cl', fecha_cierre: '2026-10-04T15:00:00.000Z',
      datos: { hora_inicio: '10:00', hora_fin: '12:15', traje: 'Lisseth', publico: 1200, estado_traje: 'LIMPIEZA', calificacion: 4, minutos_traje: 55, gasto_transporte: 5000, gasto_colacion: 3500, bien: 'Mucha gente' } },
    { 'barbara@homepymes.cl': 'Bárbara Álvarez' }, U);
  assert.match(html, /Activación &lt;BCI&gt;/, 'escapa el título');
  assert.match(html, /sábado 3 de octubre de 2026/);
  assert.match(html, /2 h 15 min/);
  assert.match(html, /1\.200/);
  assert.match(html, /Necesita limpieza/);
  assert.match(html, /\$8\.500/, 'total de gastos');
  assert.match(html, /Reporte cerrado por Bárbara Álvarez/);
  assert.equal((html.match(/class="on"/g) || []).length, 8, '4 estrellas, en la portada y en la evaluación');
});

test('Estudio TikTok: la idea avanza de a una etapa, con lo mínimo de cada una', () => {
  const db = crear();
  assert.ok(rechazado(H.guardarIdea(db, { titulo: 'x' }, OTRA)));
  assert.ok(invalido(H.guardarIdea(db, { titulo: '  ' }, BARBARA)));
  let idea = H.guardarIdea(db, { titulo: 'Hompy explica el casco' }, BARBARA).idea;
  assert.equal(idea.etapa, 'IDEA');
  assert.deepEqual(idea.dialogo.personajes, ['Hompy'], 'Hompy siempre está en el reparto');
  // Sin gancho no pasa a Diálogo; tampoco se salta etapas.
  let r = H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'DIALOGO' }, BARBARA);
  assert.ok(invalido(r)); assert.equal(r.fields[0].campo, 'gancho');
  assert.ok(invalido(H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'GUION' }, BARBARA)), 'no se salta etapas');
  H.guardarIdea(db, { idea_id: idea.idea_id, idea: { gancho: '¿Sabías que el casco tiene fecha de vencimiento?', objetivo: 'EDUCAR', duracion: 45, hashtags: 'seguridad, #prevencion, #' } }, BARBARA);
  idea = H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'DIALOGO' }, BARBARA).idea;
  assert.equal(idea.etapa, 'DIALOGO');
  assert.equal(idea.idea.duracion, 30, 'duración fuera de la lista vuelve a 30');
  assert.deepEqual(idea.idea.hashtags, ['#seguridad', '#prevencion']);
  assert.ok(invalido(H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'GUION' }, BARBARA)), 'sin diálogo no hay guión');
  idea = H.guardarIdea(db, { idea_id: idea.idea_id, dialogo: { personajes: ['Hompy', 'Trabajador'], lineas: [
    { personaje: 'Trabajador', texto: 'Mi casco está perfecto.' }, { personaje: 'Hompy', tipo: 'accion', texto: 'Niega con la cabeza' },
    { personaje: 'Voz en off', texto: 'Los cascos vencen.' }, { personaje: 'Hompy', texto: '' }] } }, BARBARA).idea;
  assert.equal(idea.dialogo.lineas.length, 3, 'las líneas vacías no se guardan');
  assert.equal(idea.dialogo.lineas[1].tipo, 'accion');
  assert.ok(idea.dialogo.personajes.includes('Voz en off'), 'un personaje nuevo entra al reparto');
  idea = H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'GUION' }, BARBARA).idea;
  H.guardarIdea(db, { idea_id: idea.idea_id, guion: { escenas: [{ plano: 'Inventado', accion: 'Trabajador posa', segundos: 0 }] } }, BARBARA);
  r = H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'PRODUCCION' }, BARBARA);
  assert.ok(invalido(r)); assert.equal(r.fields[0].campo, 'segundos');
  idea = H.guardarIdea(db, { idea_id: idea.idea_id, guion: { escenas: [{ plano: 'Inventado', accion: 'Trabajador posa', segundos: 4 }, { accion: '', pantalla: '' }] } }, BARBARA).idea;
  assert.equal(idea.guion.escenas.length, 1); assert.equal(idea.guion.escenas[0].plano, 'Medio');
  idea = H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'PRODUCCION' }, BARBARA).idea;
  // Producción: el enlace al calendario no se puede inventar desde el navegador.
  idea = H.guardarIdea(db, { idea_id: idea.idea_id, produccion: { checklist: { grabado: true }, evento_id: 'HE-falso' } }, BARBARA).idea;
  assert.equal(idea.produccion.evento_id, '');
  r = H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'PUBLICADO' }, BARBARA);
  assert.ok(invalido(r)); assert.deepEqual(r.fields.map((f) => f.campo), ['aprobado']);
  H.guardarIdea(db, { idea_id: idea.idea_id, produccion: { checklist: { grabado: true, aprobado: true } } }, BARBARA);
  assert.ok(invalido(H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'PUBLICADO' }, BARBARA)), 'publicar pide el enlace');
  idea = H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'PUBLICADO', url: 'https://www.tiktok.com/@homepymes/video/1' }, BARBARA).idea;
  assert.equal(idea.etapa, 'PUBLICADO'); assert.equal(idea.publicacion.fecha, hoy());
  idea = H.guardarIdea(db, { idea_id: idea.idea_id, publicacion: Object.assign({}, idea.publicacion, { h24: { vistas: '1.500', me_gusta: 120 } }) }, BARBARA).idea;
  assert.equal(idea.publicacion.h24.vistas, 1500);
  assert.ok(invalido(H.eliminarIdea(db, { idea_id: idea.idea_id }, BARBARA)), 'publicado no se elimina');
  assert.ok(invalido(H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'DESCARTADA', motivo: 'x' }, BARBARA)));
  // Hacia atrás, libre.
  assert.equal(H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'GUION' }, BARBARA).idea.etapa, 'GUION');
});

test('Estudio TikTok: descartar con motivo, votar y agendar la grabación en el calendario', () => {
  const db = crear();
  const idea = H.guardarIdea(db, { titulo: 'Baile del chaleco', idea: { gancho: 'Hompy baila' } }, BARBARA).idea;
  assert.ok(invalido(H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'DESCARTADA' }, BARBARA)), 'descartar pide motivo');
  assert.equal(H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'DESCARTADA', motivo: 'Ya lo hizo otra marca' }, BARBARA).idea.motivo_descarte, 'Ya lo hizo otra marca');
  assert.ok(invalido(H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'GUION' }, BARBARA)), 'descartada vuelve primero a Idea');
  assert.equal(H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'IDEA' }, BARBARA).idea.motivo_descarte, '');
  const LIS = { email: 'Lisseth@homepymes.cl', rol: 'DEV', modulos: ['hompy'] };
  H.votarIdea(db, { idea_id: idea.idea_id }, BARBARA);
  assert.deepEqual(H.votarIdea(db, { idea_id: idea.idea_id }, LIS).idea.votos, ['barbara@homepymes.cl', 'lisseth@homepymes.cl']);
  assert.deepEqual(H.votarIdea(db, { idea_id: idea.idea_id }, BARBARA).idea.votos, ['lisseth@homepymes.cl'], 'votar de nuevo quita el voto');

  assert.ok(invalido(H.agendarGrabacion(db, { idea_id: idea.idea_id, fecha: '' }, BARBARA)));
  const f = mover(hoy(), 3);
  let r = H.agendarGrabacion(db, { idea_id: idea.idea_id, fecha: f, hora: '15:00', lugar: 'Oficina' }, BARBARA);
  assert.equal(r.evento.titulo, 'Grabación TikTok: Baile del chaleco');
  assert.equal(r.evento.idea_id, idea.idea_id);
  assert.equal(r.idea.produccion.evento_id, r.evento.evento_id);
  const tipos = H.datos(db, {}, BARBARA).tipos;
  assert.equal(tipos.find((t) => t.tipo_id === r.evento.tipo_id).nombre, 'Grabación de contenido', 'elige el tipo de grabación');
  // Re-agendar mueve el mismo evento, no crea otro.
  r = H.agendarGrabacion(db, { idea_id: idea.idea_id, fecha: mover(hoy(), 4), hora: '10:00' }, BARBARA);
  assert.equal(H.datos(db, {}, BARBARA).eventos.length, 1);
  assert.equal(r.evento.fecha, mover(hoy(), 4));
  assert.equal(H.datos(db, {}, BARBARA).ideas.length, 1);
  H.eliminarIdea(db, { idea_id: idea.idea_id }, BARBARA);
  assert.equal(H.datos(db, {}, BARBARA).ideas.length, 0);
});

test('Marcas: alta, validaciones, marca en actividades e ideas, y no se borra con historial', () => {
  const db = crear();
  assert.ok(rechazado(H.guardarMarca(db, { nombre: 'BCI' }, OTRA)));
  assert.ok(invalido(H.guardarMarca(db, { nombre: '' }, BARBARA)));
  assert.ok(invalido(H.guardarMarca(db, { nombre: 'X', contacto_correo: 'no-es-correo' }, BARBARA)));
  const bci = H.guardarMarca(db, { nombre: 'BCI', rubro: 'Banca', color: 'azul', estado: 'ACTIVA', contacto_nombre: 'Ana', contacto_correo: 'ana@bci.cl', sitio: 'javascript:x' }, BARBARA).marca;
  assert.equal(bci.sitio, '', 'solo enlaces http(s)');
  assert.ok(invalido(H.guardarMarca(db, { nombre: 'bci' }, BARBARA)), 'sin duplicados');
  const otra = H.guardarMarca(db, { nombre: 'Ferretería Norte', color: 'fucsia', estado: 'RARO' }, BARBARA).marca;
  assert.equal(otra.color, 'azul'); assert.equal(otra.estado, 'ACTIVA');
  const tipo = H.datos(db, {}, BARBARA).tipos[1].tipo_id;
  assert.ok(invalido(H.guardarEvento(db, { tipo_id: tipo, titulo: 'x', fecha: hoy(), marca_id: 'HM-falsa' }, BARBARA)));
  const ev = H.guardarEvento(db, { tipo_id: tipo, titulo: 'Activación BCI', fecha: hoy(), marca_id: bci.marca_id }, BARBARA).evento;
  assert.equal(ev.marca_id, bci.marca_id);
  const idea = H.guardarIdea(db, { titulo: 'Video con BCI' }, BARBARA).idea;
  assert.equal(H.guardarIdea(db, { idea_id: idea.idea_id, marca_id: bci.marca_id }, BARBARA).idea.marca_id, bci.marca_id);
  assert.ok(invalido(H.guardarIdea(db, { idea_id: idea.idea_id, marca_id: 'HM-x' }, BARBARA)));
  assert.ok(invalido(H.eliminarMarca(db, { marca_id: bci.marca_id }, BARBARA)), 'con actividades no se elimina');
  assert.ok(H.eliminarMarca(db, { marca_id: otra.marca_id }, BARBARA).eliminado);
  assert.deepEqual(H.datos(db, {}, BARBARA).marcas.map((m) => m.nombre), ['BCI']);
});

test('Colaboraciones: lo entregado y lo recibido, fechas y enlaces solo a lo que existe', () => {
  const db = crear();
  const bci = H.guardarMarca(db, { nombre: 'BCI' }, BARBARA).marca;
  const tipo = H.datos(db, {}, BARBARA).tipos[0].tipo_id;
  const ev = H.guardarEvento(db, { tipo_id: tipo, titulo: 'Activación', fecha: hoy(), marca_id: bci.marca_id }, BARBARA).evento;
  assert.ok(invalido(H.guardarColaboracion(db, { titulo: 'x', fecha_inicio: hoy() }, BARBARA)), 'pide marca');
  assert.ok(invalido(H.guardarColaboracion(db, { marca_id: bci.marca_id, titulo: 'x', fecha_inicio: hoy(), fecha_fin: mover(hoy(), -1) }, BARBARA)));
  const c = H.guardarColaboracion(db, { marca_id: bci.marca_id, titulo: 'Activación en sucursales', tipo: 'EVENTO', estado: 'ACORDADA', fecha_inicio: hoy(),
    entregamos: 'Hompy en 3 sucursales', recibimos: 'Merch y difusión', valor: '350.000', calificacion: 9, evento_ids: [ev.evento_id, 'HE-falso'], idea_ids: ['HI-falsa'] }, BARBARA).colaboracion;
  assert.equal(c.valor, 350000);
  assert.equal(c.calificacion, 5);
  assert.deepEqual(c.evento_ids, [ev.evento_id]);
  assert.deepEqual(c.idea_ids, []);
  const ed = H.guardarColaboracion(db, Object.assign({}, c, { estado: 'REALIZADA', resultado: 'Muy buena', valor: '' }), BARBARA).colaboracion;
  assert.equal(ed.estado, 'REALIZADA'); assert.equal(ed.valor, null);
  H.eliminarColaboracion(db, { colab_id: c.colab_id }, BARBARA);
  assert.equal(H.datos(db, {}, BARBARA).colaboraciones.length, 0);
});

test('Reporte mensual: cifras del mes, comparación con el anterior, pendientes, videos y PDF', () => {
  const db = crear();
  const tipos = H.datos(db, {}, BARBARA).tipos;
  const bci = H.guardarMarca(db, { nombre: 'BCI' }, BARBARA).marca;
  const mes = hoy().slice(0, 7);
  const dia = (d) => mes + '-' + String(d).padStart(2, '0');
  const ev1 = H.guardarEvento(db, { tipo_id: tipos[0].tipo_id, titulo: 'Feria', fecha: dia(1), marca_id: bci.marca_id }, BARBARA).evento;
  H.guardarSalida(db, { evento_id: ev1.evento_id, cerrar: true, datos: { hora_inicio: '10:00', hora_fin: '12:30', traje: 'Lisseth', publico: 200, estado_traje: 'LIMPIEZA', calificacion: 4, minutos_traje: 60, gasto_transporte: 5000 } }, BARBARA);
  H.guardarEvento(db, { tipo_id: tipos[1].tipo_id, titulo: 'Sin reporte', fecha: dia(1) }, BARBARA);
  const canc = H.guardarEvento(db, { tipo_id: tipos[1].tipo_id, titulo: 'Cancelada', fecha: dia(1) }, BARBARA).evento;
  H.cambiarEstadoEvento(db, { evento_id: canc.evento_id, estado: 'CANCELADO', motivo: 'Lluvia' }, BARBARA);
  // Un video publicado este mes, con métricas.
  let idea = H.guardarIdea(db, { titulo: 'Casco', idea: { gancho: '¿Sabías?' } }, BARBARA).idea;
  idea = H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'DIALOGO' }, BARBARA).idea;
  H.guardarIdea(db, { idea_id: idea.idea_id, dialogo: { lineas: [{ texto: 'Hola' }] } }, BARBARA);
  H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'GUION' }, BARBARA);
  H.guardarIdea(db, { idea_id: idea.idea_id, guion: { escenas: [{ accion: 'x', segundos: 5 }] } }, BARBARA);
  H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'PRODUCCION' }, BARBARA);
  H.guardarIdea(db, { idea_id: idea.idea_id, produccion: { checklist: { grabado: true, aprobado: true } } }, BARBARA);
  idea = H.moverIdea(db, { idea_id: idea.idea_id, etapa: 'PUBLICADO', url: 'https://www.tiktok.com/@h/video/1' }, BARBARA).idea;
  H.guardarIdea(db, { idea_id: idea.idea_id, publicacion: Object.assign({}, idea.publicacion, { h24: { vistas: 1000, me_gusta: 80, comentarios: 10, compartidos: 5, guardados: 5 } }) }, BARBARA);
  H.guardarColaboracion(db, { marca_id: bci.marca_id, titulo: 'Activación', tipo: 'EVENTO', estado: 'EN_CURSO', fecha_inicio: dia(1), valor: 100000 }, BARBARA);

  assert.ok(rechazado(H.reporteMensual(db, { periodo: mes }, OTRA)));
  const r = H.reporteMensual(db, { periodo: mes }, BARBARA);
  assert.equal(r.kpis.actividades.actual, 2, 'sin la cancelada');
  assert.equal(r.kpis.canceladas, 1);
  assert.equal(r.kpis.salidas.actual, 1);
  assert.equal(r.kpis.publico.actual, 200);
  assert.equal(r.kpis.horas.actual, 2.5);
  assert.equal(r.kpis.minutos_traje, 60);
  assert.equal(r.kpis.gastos, 5000);
  assert.equal(r.kpis.videos.actual, 1);
  assert.equal(r.kpis.vistas.actual, 1000);
  assert.equal(r.kpis.interaccion, 10);
  assert.equal(r.kpis.colaboraciones, 1);
  assert.equal(r.kpis.actividades.anterior, 0);
  assert.deepEqual(r.pendientes.map((p) => p.titulo), ['Sin reporte']);
  assert.equal(r.salidas[0].marca, 'BCI');
  assert.equal(r.traje.estado, 'LIMPIEZA');
  assert.equal(H.reporteMensual(db, { periodo: 'cualquier-cosa' }, BARBARA).periodo, mes, 'período inválido = el mes actual');

  const U = { esc: (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), ico: () => '<svg></svg>' };
  const html = H.cuerpoPdfMensual_(r, U);
  assert.match(html, /Hompy en /);
  assert.match(html, /Feria/);
  assert.match(html, /Sin reporte cerrado: Sin reporte/);
  assert.match(html, /10,0 %/);
  assert.match(html, /\$100\.000/);
  assert.match(html, /Necesita limpieza/);
});

test('Dinero: presupuesto, lista de gastos, reembolsos (aun cerrado), aporte y los gastos antiguos', () => {
  const db = crear();
  const tipos = H.datos(db, {}, BARBARA).tipos;
  const bci = H.guardarMarca(db, { nombre: 'BCI' }, BARBARA).marca;
  const ev = H.guardarEvento(db, { tipo_id: tipos[0].tipo_id, titulo: 'Feria', fecha: mover(hoy(), -1), presupuesto: '30.000', presupuesto_nota: 'Uber y colación', marca_id: bci.marca_id }, BARBARA).evento;
  assert.equal(ev.presupuesto, 30000);
  assert.equal(ev.presupuesto_nota, 'Uber y colación');
  const base = { hora_inicio: '10:00', hora_fin: '12:00', traje: 'Lisseth', publico: 50, estado_traje: 'BUENO', calificacion: 4 };
  const gastos = [
    { categoria: 'TRANSPORTE', detalle: 'Uber ida y vuelta', monto: '18.500', pago: 'PERSONA', persona: '', documento: '', enlace: 'nada' },
    { categoria: 'INVENTADA', detalle: 'Bebidas', monto: 6000, pago: 'EMPRESA', persona: 'X', devuelto: true },
    { categoria: 'MATERIAL', detalle: 'vacío', monto: 0 }
  ];
  // Un gasto que pagó una persona necesita su nombre para cerrar.
  const sin = H.guardarSalida(db, { evento_id: ev.evento_id, cerrar: true, datos: Object.assign({}, base, { gastos }) }, BARBARA);
  assert.ok(invalido(sin));
  assert.deepEqual(sin.fields.map((f) => f.campo), ['gasto_0']);
  gastos[0].persona = 'Lisseth';
  const r = H.guardarSalida(db, { evento_id: ev.evento_id, cerrar: true, datos: Object.assign({}, base, { gastos, aporte: '50.000', aporte_detalle: 'Transferencia de BCI' }) }, BARBARA);
  const d = r.salida.datos;
  assert.equal(d.gastos.length, 2, 'la línea en $0 no se guarda');
  assert.equal(d.gastos[0].monto, 18500);
  assert.equal(d.gastos[0].enlace, '', 'solo enlaces http(s)');
  assert.equal(d.gastos[1].categoria, 'OTRO');
  assert.equal(d.gastos[1].persona, '', 'la empresa no lleva persona');
  assert.equal(d.gastos[1].devuelto, false, 'lo que pagó la empresa no se «devuelve»');
  assert.equal(d.aporte, 50000);
  assert.equal(H.totalGastos_(d), 24500);
  // Reembolso marcado con el reporte cerrado.
  assert.ok(invalido(H.marcarReembolso(db, { evento_id: ev.evento_id, indice: 1, devuelto: true }, BARBARA)), 'la empresa no lleva reembolso');
  assert.ok(invalido(H.marcarReembolso(db, { evento_id: ev.evento_id, indice: 9, devuelto: true }, BARBARA)));
  assert.ok(rechazado(H.marcarReembolso(db, { evento_id: ev.evento_id, indice: 0, devuelto: true }, OTRA)));
  const m = H.marcarReembolso(db, { evento_id: ev.evento_id, indice: 0, devuelto: true }, BARBARA).salida;
  assert.equal(m.estado, 'CERRADO', 'sigue cerrado');
  assert.equal(m.datos.gastos[0].devuelto, true);
  assert.equal(m.datos.gastos[0].devuelto_por, BARBARA.email);
  assert.equal(m.datos.gastos[0].fecha_devolucion, hoy());
  // Un reporte antiguo con los 4 montos fijos se lee como líneas.
  assert.deepEqual(H.gastosDe_({ gasto_transporte: 5000, gasto_colacion: 3500, gasto_otros: 0 }).map((g) => [g.categoria, g.monto, g.pago]), [['TRANSPORTE', 5000, 'EMPRESA'], ['COLACION', 3500, 'EMPRESA']]);
});

test('Dinero en el reporte mensual: gastado, presupuesto, en qué se fue, sobre presupuesto, reembolsos y aportes', () => {
  const db = crear();
  const tipos = H.datos(db, {}, BARBARA).tipos;
  const bci = H.guardarMarca(db, { nombre: 'BCI' }, BARBARA).marca;
  const mes = hoy().slice(0, 7), dia = (n) => mes + '-' + String(n).padStart(2, '0');
  const cerrar = (ev, extra) => H.guardarSalida(db, { evento_id: ev.evento_id, cerrar: true, datos: Object.assign({ hora_inicio: '10:00', hora_fin: '11:00', traje: 'L', publico: 100, estado_traje: 'BUENO', calificacion: 5 }, extra) }, BARBARA);
  const a = H.guardarEvento(db, { tipo_id: tipos[0].tipo_id, titulo: 'Feria BCI', fecha: dia(1), presupuesto: 20000, marca_id: bci.marca_id }, BARBARA).evento;
  cerrar(a, { gastos: [{ categoria: 'TRANSPORTE', monto: 15000, pago: 'PERSONA', persona: 'Lisseth', detalle: 'Uber' }, { categoria: 'MATERIAL', monto: 10000 }], aporte: 40000, aporte_detalle: 'BCI' });
  const b = H.guardarEvento(db, { tipo_id: tipos[1].tipo_id, titulo: 'Charla', fecha: dia(1), presupuesto: 5000 }, BARBARA).evento;
  cerrar(b, { gastos: [{ categoria: 'COLACION', monto: 3000 }] });
  H.guardarEvento(db, { tipo_id: tipos[1].tipo_id, titulo: 'Futura con presupuesto', fecha: dia(1), presupuesto: 7000 }, BARBARA);
  const dn = H.reporteMensual(db, { periodo: mes }, BARBARA).dinero;
  assert.equal(dn.gastado.actual, 28000);
  assert.equal(dn.gastado.anterior, 0);
  assert.equal(dn.presupuestado, 32000, 'todo lo presupuestado del mes');
  assert.equal(dn.presupuesto_cerradas, 25000);
  assert.equal(dn.costo_por_persona, 140, '28.000 ÷ 200 personas');
  assert.deepEqual(dn.por_categoria.map((c) => [c.nombre, c.monto]), [['Transporte', 15000], ['Material y regalos', 10000], ['Colación', 3000]]);
  assert.deepEqual(dn.por_marca, [{ nombre: 'BCI', monto: 25000 }]);
  assert.deepEqual(dn.sobre_presupuesto.map((x) => [x.titulo, x.gastado, x.presupuesto]), [['Feria BCI', 25000, 20000]]);
  assert.equal(dn.reembolsos.total, 15000);
  assert.equal(dn.reembolsos.lista[0].persona, 'Lisseth');
  assert.equal(dn.aportes, 40000);
  assert.equal(dn.neto, 12000);
  const U = { esc: (t) => String(t == null ? '' : t), ico: () => '' };
  const html = H.cuerpoPdfMensual_(H.reporteMensual(db, { periodo: mes }, BARBARA), U);
  assert.match(html, /Dinero del mes/);
  assert.match(html, /Reembolsos por devolver/);
  assert.match(html, /Sobre el presupuesto: Feria BCI/);
});

test('preparación de la salida: parte vacía, se guarda entera y no en canceladas', () => {
  const db = crear();
  const tipo = H.datos(db, {}, BARBARA).tipos[0].tipo_id;
  const ev = H.guardarEvento(db, { tipo_id: tipo, titulo: 'Feria', fecha: mover(hoy(), 2) }, BARBARA).evento;
  assert.equal(ev.preparacion, null, 'sin tocar: el front usa la lista base');
  assert.ok(H.datos(db, {}, BARBARA).catalogos.preparacion.length >= 5);
  assert.ok(rechazado(H.guardarPreparacion(db, { evento_id: ev.evento_id, items: [{ t: 'x' }] }, OTRA)));
  assert.ok(invalido(H.guardarPreparacion(db, { evento_id: ev.evento_id, items: [] }, BARBARA)), 'al menos una cosa');
  const r = H.guardarPreparacion(db, { evento_id: ev.evento_id, items: [{ t: 'Traje limpio', hecho: true }, { t: '  ', hecho: true }, { t: 'Agua', hecho: false }] }, BARBARA);
  assert.deepEqual(r.evento.preparacion.items, [{ t: 'Traje limpio', hecho: true }, { t: 'Agua', hecho: false }]);
  assert.equal(r.evento.preparacion.actualizado_por, BARBARA.email);
  H.cambiarEstadoEvento(db, { evento_id: ev.evento_id, estado: 'CANCELADO', motivo: 'Lluvia' }, BARBARA);
  assert.ok(invalido(H.guardarPreparacion(db, { evento_id: ev.evento_id, items: [{ t: 'Agua' }] }, BARBARA)));
});

test('traje: el estado vigente es lo último entre lo anotado y los reportes cerrados', () => {
  const db = crear();
  assert.equal(H.datos(db, {}, BARBARA).traje.estado, 'BUENO', 'sin historia: en buen estado');
  assert.ok(rechazado(H.registrarTraje(db, { estado: 'BUENO' }, OTRA)));
  assert.ok(invalido(H.registrarTraje(db, { estado: 'ROTO' }, BARBARA)));
  assert.ok(invalido(H.registrarTraje(db, { estado: 'REPARACION' }, BARBARA)), 'reparación pide una nota');
  let t = H.registrarTraje(db, { estado: 'REPARACION', nota: 'Costura del guante' }, BARBARA).traje;
  assert.equal(t.estado, 'REPARACION'); assert.equal(t.fuente, 'MANUAL');
  // Un reporte cerrado después manda.
  const tipo = H.datos(db, {}, BARBARA).tipos[0].tipo_id;
  const ev = H.guardarEvento(db, { tipo_id: tipo, titulo: 'Salida', fecha: hoy() }, BARBARA).evento;
  H.guardarSalida(db, { evento_id: ev.evento_id, cerrar: true, datos: { hora_inicio: '10:00', hora_fin: '11:00', traje: 'Lisseth', publico: 10, estado_traje: 'LIMPIEZA', calificacion: 4, nota_traje: 'Barro' } }, BARBARA);
  t = H.datos(db, {}, BARBARA).traje;
  assert.equal(t.estado, 'LIMPIEZA'); assert.equal(t.fuente, 'SALIDA'); assert.equal(t.titulo, 'Salida');
  assert.equal(t.historial.length, 2);
  t = H.registrarTraje(db, { estado: 'BUENO', nota: '' }, BARBARA).traje;
  assert.equal(t.estado, 'BUENO', 'marcarlo limpio después del reporte lo deja bueno');
});
