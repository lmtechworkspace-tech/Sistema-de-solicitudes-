/**
 * landing.js — coreografia del hero de la landing de SIGSO.
 * Concepto: "La promesa que no se borra".
 *
 * SIN LIBRERIAS, Y ES UNA DECISION, NO UN ATAJO.
 * El prompt sugeria GSAP + ScrollTrigger + Lenis. Para el hero no hacen
 * falta: aqui hay una entrada escalonada (CSS puro) y UN desplazamiento
 * coreografiado (esto). Cargar ~70 KB de motor de animacion para mover un
 * elemento seria justo el antipatron que el propio encargo pide evitar
 * ("sin cargar 5 MB de librerias si no hace falta").
 *
 * GSAP y ScrollTrigger entran en el siguiente tramo, con la narrativa de
 * scroll, donde SI se ganan el peso: sincronizar varias lineas de tiempo
 * contra la posicion del scroll a mano es donde se pierde el control.
 *
 * QUE HACE. Al cargar, la fecha vigente nace ENCIMA de la original y se
 * separa de ella, dejando la huella atras. Es la tesis de la pagina contada
 * en un gesto de dos segundos, antes de leer una sola linea.
 *
 * REGLAS QUE SE RESPETAN AQUI:
 *  · Solo transform y opacity -> nada obliga al navegador a recalcular
 *    posiciones en cada cuadro.
 *  · prefers-reduced-motion -> se dibuja el estado FINAL de una vez. No se
 *    pierde informacion, solo el gesto.
 *  · Sin JavaScript -> la pagina se ve entera y quieta: el estado inicial
 *    (invisible) lo pone esta clase, no el CSS.
 */
(function () {
  'use strict';

  // Posiciones sobre el eje, en % de su ancho. La huella queda antes que la
  // vigente: el desvio se lee de izquierda a derecha, como el tiempo.
  var POS_HUELLA = 34;
  var POS_VIVA = 68;

  var raiz = document.documentElement;
  var huella = document.getElementById('huella');
  var viva = document.getElementById('viva');
  var desvio = document.getElementById('desvio');

  // Se marca que hay JS ANTES de pintar, para que el estado inicial de la
  // entrada no llegue a verse como un salto.
  raiz.classList.add('l-anim');

  var quietos = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function colocar(el, pct) {
    if (el) el.style.transform = 'translateX(' + pct + '%)';
  }

  /** El tramo de desvio: se estira con scaleX desde la huella hasta la vigente. */
  function tenderDesvio(hasta) {
    if (!desvio) return;
    var ancho = hasta - POS_HUELLA;
    desvio.style.left = POS_HUELLA + '%';
    desvio.style.width = (ancho > 0 ? ancho : 0) + '%';
    desvio.style.transform = 'scaleX(1)';
  }

  if (!huella || !viva) return;

  // El eje se posiciona en % del contenedor; el translateX de cada marca es
  // en % de SU PROPIO ancho, que es 0. Por eso la posicion va en `left` (una
  // sola vez, al montar) y el movimiento en transform (cada cuadro).
  huella.style.left = POS_HUELLA + '%';
  viva.style.left = POS_HUELLA + '%';

  if (quietos) {
    // Estado final, sin gesto. La pagina dice exactamente lo mismo.
    viva.style.left = POS_VIVA + '%';
    tenderDesvio(POS_VIVA);
    raiz.classList.add('l-lista');
    return;
  }

  // La entrada escalonada la resuelve el CSS; aqui solo se dispara.
  //
  // setTimeout y NO requestAnimationFrame: rAF no dispara mientras la pagina
  // no se esta pintando (pestaña en segundo plano). Con rAF, abrir la landing
  // en una pestaña de fondo y volver despues dejaba el hero INVISIBLE para
  // siempre -- el estado inicial de la entrada se queda puesto y nadie lo
  // quita. Lo mismo le paso al menu de la plataforma y esta escrito en
  // plataforma.js; aqui se habria repetido el error.
  //
  // Un timeout corre igual en segundo plano y agrupa lo mismo.
  setTimeout(function () { raiz.classList.add('l-lista'); }, 0);

  // El desplazamiento va DESPUES de que el bloque haya entrado: si compiten,
  // no se lee ninguno de los dos. 1100 ms es lo que tarda la entrada
  // escalonada en asentarse (320 ms de retardo + 700 de transicion).
  var desplazar = function () {
    viva.style.transition = 'transform 900ms cubic-bezier(0.16, 1, 0.3, 1)';
    colocar(viva, 0);
    // translateX en % de un elemento de ancho 0 no sirve: se anima `left`
    // via una variable propia. Para no tocar layout se usa translate en px
    // calculados sobre el ancho real del eje.
    var eje = document.getElementById('eje');
    var ancho = eje ? eje.getBoundingClientRect().width : 0;
    var salto = ancho * (POS_VIVA - POS_HUELLA) / 100;
    viva.style.transform = 'translateX(' + salto + 'px)';

    if (desvio) {
      desvio.style.left = POS_HUELLA + '%';
      desvio.style.width = (POS_VIVA - POS_HUELLA) + '%';
      desvio.style.transform = 'scaleX(0)';
      // Mismo motivo que arriba: con rAF, en segundo plano el desvio se
      // quedaba en scaleX(0) -- es decir, invisible -- de forma permanente.
      setTimeout(function () {
        desvio.style.transition = 'transform 900ms cubic-bezier(0.16, 1, 0.3, 1)';
        desvio.style.transform = 'scaleX(1)';
      }, 20);
    }
  };
  setTimeout(desplazar, 1100);

  // Si cambia el ancho del eje (girar el telefono, redimensionar), el salto
  // en px deja de valer. Se recalcula sin animacion: reanimarlo en cada
  // redimensionado seria ruido.
  var reajustar = function () {
    var eje = document.getElementById('eje');
    if (!eje) return;
    var ancho = eje.getBoundingClientRect().width;
    var previa = viva.style.transition;
    viva.style.transition = 'none';
    viva.style.transform = 'translateX(' + (ancho * (POS_VIVA - POS_HUELLA) / 100) + 'px)';
    // Se devuelve la transicion en el cuadro siguiente para que el proximo
    // cambio real sí se anime.
    setTimeout(function () { viva.style.transition = previa; }, 0);
  };
  var temporizador = null;
  window.addEventListener('resize', function () {
    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(reajustar, 150);
  });
})();
