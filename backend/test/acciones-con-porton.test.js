'use strict';

/**
 * Ninguna acción nueva se queda sin control de módulo por descuido.
 *
 * `MODULO_POR_ACCION` es **permisivo por omisión**: una acción ausente de esa
 * tabla no tiene control de módulo. Es una decisión razonable —hay acciones
 * que no pertenecen a ningún módulo— pero convierte el olvido en la forma más
 * fácil de abrir una puerta sin darse cuenta.
 *
 * Y pasó: `getInicio` se quedó fuera, y con una cuenta sin el módulo
 * `bandeja` se podían leer los datos de la bandeja pidiéndolos como bloque.
 * La acción suelta los negaba; el bloque no.
 *
 * Este test no exige que TODA acción tenga módulo: exige que las que no lo
 * tienen estén en la lista de abajo, con el motivo escrito. Añadir una acción
 * sin gate deja de ser un descuido silencioso y pasa a ser una decisión que
 * alguien tuvo que justificar por escrito.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackofficeProject } = require('./helpers/gasSandbox');

/**
 * Acciones SIN control de módulo, y por qué cada una puede estarlo.
 *
 * Revisadas una por una el 2026-09-06 leyendo lo que hace cada método, no
 * suponiéndolo. La regla para entrar aquí: la acción tiene que decidir el
 * permiso POR SU CUENTA, sin depender del router.
 */
const SIN_MODULO_A_PROPOSITO = {
  // No devuelve datos: solo confirma que el backend responde y su versión.
  ping: 'no expone ningún dato',

  // Perfil propio: la identidad sale de `contexto`, nunca de un
  // identificador enviado por el navegador (identidadDe_).
  getMiPerfil: 'perfil propio, identidad del contexto',
  guardarFotoPerfil: 'perfil propio, identidad del contexto',
  eliminarFotoPerfil: 'perfil propio, identidad del contexto',
  getFotosPerfil: 'avatares, visibles para todos por diseño',

  // Notificaciones propias: filtradas por contexto.email, y marcar una ajena
  // como leída devuelve {actualizado:false} sin tocar nada.
  sincronizarNotificacionesApp: 'notificaciones propias, filtradas por contexto.email',
  marcarNotificacionAppLeida: 'comprueba que la notificación sea del que llama',
  marcarTodasNotificacionesAppLeidas: 'notificaciones propias',
  reportarPermisoNotificacionesSO: 'registra el permiso del navegador de quien llama',

  // Novedades tiene su propia lógica de audiencia y de aprobación, más
  // estricta que un módulo: publicar mira el área, aprobar mira quién es el
  // autor, ver los lectores es del autor o del Administrador.
  listarAreasPublicablesNovedad: 'Novedades: audiencia propia',
  getFeedNovedades: 'Novedades: audiencia propia',
  getDetalleNovedad: 'Novedades: audiencia propia (puedeVerDetalle_)',
  publicarNovedad: 'Novedades: puedePublicarEnArea_',
  despublicarNovedad: 'Novedades: solo el autor o ADM',
  marcarLeidaNovedad: 'Novedades: acuse propio',
  descargarAdjuntoNovedad: 'Novedades: puedeVerDetalle_ (corregido en H-01)',
  getLectoresNovedad: 'Novedades: solo el autor o ADM',
  getHistorialNovedad: 'Novedades: audiencia propia',
  aprobarNovedad: 'Novedades: puedeAprobar_',
  devolverNovedad: 'Novedades: puedeAprobar_',
  rechazarNovedad: 'Novedades: puedeAprobar_',
  reenviarNovedad: 'Novedades: solo quien la redactó',
  listarPendientesAprobacionNovedad: 'Novedades: lo pendiente de cada rol',
  misPendientesNovedad: 'Novedades: lo propio',
  getPanelCumplimientoNovedad: 'Novedades: solo ADM',

  // Escritura, pero comprueba el dueño: solo el supervisor de esa actividad.
  validarActividad: 'Actividades: puedeSupervisar_',

  // No pide UN módulo sino uno distinto por bloque, así que no cabe en la
  // tabla. Comprueba bloque a bloque LEYENDO esa misma tabla
  // (cuentaTieneElModuloDelBloque_ en Inicio.gs), y hay pruebas propias en
  // inicio-modulos.test.js.
  getInicio: 'un módulo distinto por bloque; se comprueba dentro, con la misma tabla'
};

function contexto() {
  return loadBackofficeProject({ scriptProperties: { SIGSO_SHEET_ID: 'x', SIGSO_DRIVE_ROOT_FOLDER_ID: 'y' } });
}

test('toda acción sin control de módulo está justificada por escrito', () => {
  const ctx = contexto();
  const acciones = Object.keys(ctx.BACKOFFICE_ACTIONS);
  const sinGate = acciones.filter((a) => !ctx.MODULO_POR_ACCION[a]);
  const noJustificadas = sinGate.filter((a) => !SIN_MODULO_A_PROPOSITO[a]);

  assert.deepEqual(noJustificadas, [],
    'Estas acciones no tienen control de módulo y tampoco están en la lista de ' +
    'excepciones. MODULO_POR_ACCION es permisivo por omisión: sin gate, ' +
    'cualquier cuenta de la plataforma puede llamarlas. O se les pone módulo, ' +
    'o se agregan a SIN_MODULO_A_PROPOSITO explicando qué las protege.');
});

test('la lista de excepciones no acumula acciones que ya no existen', () => {
  // Una excepción que sobrevive a su acción es ruido que hace menos creíble
  // al resto de la lista: mañana nadie sabe cuáles siguen vigentes.
  const ctx = contexto();
  const fantasmas = Object.keys(SIN_MODULO_A_PROPOSITO)
    .filter((a) => !ctx.BACKOFFICE_ACTIONS[a]);

  assert.deepEqual(fantasmas, [],
    'estas excepciones ya no corresponden a ninguna acción del router');
});

test('una excepción de la lista no puede tener módulo a la vez', () => {
  // Si a una acción de la lista se le pone gate, la excepción sobra y hay que
  // quitarla: dejarla sugiere que sigue sin protección cuando ya la tiene.
  const ctx = contexto();
  const conAmbos = Object.keys(SIN_MODULO_A_PROPOSITO)
    .filter((a) => ctx.MODULO_POR_ACCION[a]);

  assert.deepEqual(conAmbos, [],
    'ya tienen control de módulo: sobran en la lista de excepciones');
});

test('la inmensa mayoría de las acciones SÍ tiene control de módulo', () => {
  // Guarda de fondo contra el otro extremo: que alguien "resuelva" un fallo
  // agregando acciones a la lista de excepciones en vez de darles su módulo.
  const ctx = contexto();
  const acciones = Object.keys(ctx.BACKOFFICE_ACTIONS);
  const sinGate = acciones.filter((a) => !ctx.MODULO_POR_ACCION[a]);

  assert.ok(sinGate.length <= 30,
    'hay ' + sinGate.length + ' acciones sin control de módulo sobre ' + acciones.length +
    '. Eran 27 al revisarlas una por una; si el número sube mucho, la excepción ' +
    'está dejando de ser excepción.');
});
