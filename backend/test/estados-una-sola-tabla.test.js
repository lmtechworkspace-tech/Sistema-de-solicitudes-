'use strict';

/**
 * Los nombres de los estados se declaran UNA vez.
 *
 * `SIGSO_ESTADOS_LABEL` (frontend/js/utils.js) es la tabla canónica, y su
 * propio comentario dice que debe coincidir con la especificación (§8.1).
 * La usan components.js, dashboard.js, detalle.js, estado.js y gerencia.js,
 * y el backend repite los mismos textos en los correos (Notificaciones.gs) y
 * en la Orden de Trabajo (OrdenTrabajo.gs).
 *
 * MEDIDO el 2026-09-06: inicio.js tenía su PROPIA tabla, y no coincidía en
 * 10 de los 11 estados. Dos de esas diferencias eran inversiones:
 *
 *     estado   correo / OT / resto      pantalla de Inicio
 *     S08      Terminada                Rechazada
 *     S10      Rechazada                Validada
 *
 * Es decir: una solicitud TERMINADA aparecía como "Rechazada" en la primera
 * pantalla que ve todo el mundo, y una RECHAZADA aparecía como "Validada" --
 * mientras el correo de esa misma solicitud decía lo contrario. En un sistema
 * de gestión de calidad, dos nombres para el mismo estado no es un detalle
 * de estilo: es que el registro y la pantalla se contradicen.
 *
 * Este test no comprueba que las etiquetas sean "correctas" (eso lo dice la
 * especificación). Comprueba que haya UNA sola tabla, que es lo que impide
 * que vuelvan a divergir sin que nadie lo note.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const DIR_JS = path.join(RAIZ, 'frontend/js');

/**
 * Un mapa de estados es un objeto cuyas claves son S01..S11 y cuyos valores
 * son TEXTO PARA LA PERSONA. Se descartan los que mapean a otra cosa (un
 * tono, un índice de paso, un verbo de botón): esos no compiten con la tabla
 * canónica, dicen algo distinto.
 */
function mapasDeEtiquetasEn(fuente) {
  const encontrados = [];
  // Al menos cuatro estados seguidos con valor de texto: suficiente para
  // distinguir una tabla de etiquetas de un caso suelto.
  const re = /(S0\d)\s*:\s*'([^']{3,})'/g;
  let m;
  const pares = [];
  while ((m = re.exec(fuente)) !== null) pares.push({ estado: m[1], texto: m[2], en: m.index });

  // Se agrupan los que están cerca entre sí (misma declaración).
  let grupo = [];
  pares.forEach((p, i) => {
    if (!grupo.length) { grupo = [p]; return; }
    if (p.en - grupo[grupo.length - 1].en < 200) grupo.push(p);
    else { if (grupo.length >= 4) encontrados.push(grupo); grupo = [p]; }
    if (i === pares.length - 1 && grupo.length >= 4) encontrados.push(grupo);
  });
  return encontrados;
}

test('la tabla canónica de estados existe y está donde todos la ven', () => {
  const utils = fs.readFileSync(path.join(DIR_JS, 'utils.js'), 'utf8');
  assert.match(utils, /SIGSO_ESTADOS_LABEL\s*=/, 'utils.js es la fuente única de los nombres de estado');
  assert.match(utils, /function formatearEstadoSigso/, 'y expone el formateador que debe usarse');
});

test('inicio.js usa el formateador canónico, no una tabla propia', () => {
  // Es el archivo donde apareció la divergencia. Se comprueba en concreto
  // porque un test genérico que se relaje dejaría volver justo este caso.
  const inicio = fs.readFileSync(path.join(DIR_JS, 'inicio.js'), 'utf8');
  assert.match(inicio, /formatearEstadoSigso\(/,
    'la actividad reciente de Inicio tiene que formatear con la tabla canónica');
  assert.equal(mapasDeEtiquetasEn(inicio).length, 0,
    'inicio.js volvió a declarar su propia tabla de estados: es exactamente la ' +
    'divergencia que hacía que una solicitud Terminada apareciera como "Rechazada"');
});

/**
 * Mapas que TAMBIÉN van por estado pero no son nombres de estado. No compiten
 * con la tabla canónica porque dicen otra cosa, así que no pueden divergir de
 * ella. Se listan aquí, con su motivo, en vez de afinar la heurística: una
 * excepción escrita se revisa; una heurística lista de más se relaja sola y
 * termina dejando pasar justo el caso que este test existe para atrapar.
 */
const NO_SON_NOMBRES_DE_ESTADO = {
  'components.js': 'mapea el estado a un TONO visual (nueva, curso, espera), no a un texto',
  'detalle.js': 'mapea el estado a la ACCIÓN que lo hace avanzar ("Aprobar", "Cerrar"): son verbos de botón'
};

test('ningún archivo del frontend declara una segunda tabla de estados', () => {
  // La guarda de fondo. `utils.js` es la única que puede tenerla.
  const sospechosos = [];
  fs.readdirSync(DIR_JS)
    .filter((f) => f.endsWith('.js') && f !== 'utils.js' && !NO_SON_NOMBRES_DE_ESTADO[f])
    .forEach((f) => {
      const fuente = fs.readFileSync(path.join(DIR_JS, f), 'utf8');
      mapasDeEtiquetasEn(fuente).forEach((grupo) => {
        sospechosos.push(f + ' → ' + grupo.map((p) => p.estado + ':' + p.texto).join(', '));
      });
    });

  assert.deepEqual(sospechosos, [],
    'Solo utils.js declara los nombres de los estados (SIGSO_ESTADOS_LABEL). ' +
    'Una segunda tabla diverge en silencio: el correo dice una cosa y la ' +
    'pantalla otra, sin que nada falle.');
});
