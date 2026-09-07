/**
 * landing-relato.js — la narrativa de scroll de la landing.
 * Concepto: "La promesa que no se borra".
 *
 * AQUI SI ENTRAN LAS LIBRERIAS, y por eso no entraron en el hero.
 * GSAP + ScrollTrigger se ganan su peso cuando hay que sincronizar varias
 * lineas de tiempo contra la posicion del scroll: hacerlo a mano con
 * IntersectionObserver funciona para "aparecer", pero no para encadenar el
 * relevo de los dos relojes ni para saber que acto manda sobre el riel sin
 * que parpadee en los bordes.
 *
 * LENIS SE DESCARTO, Y CONVIENE DEJAR ESCRITO POR QUE.
 * El encargo lo sugeria para el scroll suave. Un scroll con inercia se lleva
 * el control del desplazamiento nativo, y eso toca directamente la barra de
 * accesibilidad que el propio encargo declara no negociable: navegacion por
 * teclado (Espacio, AvPag, Inicio/Fin).
 *
 * Intente comprobarlo y NO PUDE: en el entorno de prueba el teclado no mueve
 * ninguna pagina, ni siquiera una sin Lenis (se verifico contra
 * styleguide.html como control). O sea que la prueba no dice nada, ni a
 * favor ni en contra.
 *
 * Ante un requisito no negociable que no se puede verificar, se elige no
 * arriesgarlo. La pagina pierde la inercia del scroll -- que es un gusto --
 * y gana certeza sobre el teclado, que es un requisito. Se ahorran ademas
 * 13 KB.
 *
 * Volver a ponerlo es una linea en el HTML y otra aqui. Si se hace, hay que
 * probarlo en un navegador de verdad, con el teclado, antes de subirlo.
 *
 * TODO LO QUE SE ANIMA ES transform Y opacity. Nada obliga al navegador a
 * recalcular posiciones mientras el usuario hace scroll.
 */
(function () {
  'use strict';

  var quietos = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hayGsap = typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined';

  // Sin GSAP no se esconde nada: se quita la clase que pone el estado
  // inicial y la pagina queda entera y quieta. Es el mismo criterio que "sin
  // JavaScript" -- degradar mostrando, nunca ocultando.
  if (!hayGsap) {
    mostrarTodoSinAnimar();
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  if (quietos) {
    mostrarTodoSinAnimar();
    marcarRiel();      // el riel SI sigue vivo: informa, no decora
    return;
  }

  animarActos();
  animarRelojes();
  animarDivision();
  animarRastro();
  marcarRiel();

  // --- piezas -------------------------------------------------------------

  function mostrarTodoSinAnimar() {
    var sel = '.l-acto__numero, .l-acto__titulo, .l-acto__texto, .l-acto__nota,' +
      '.l-relojes, .l-division, .l-rastro';
    Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
    Array.prototype.forEach.call(document.querySelectorAll('.l-reloj__relleno'), function (el) {
      el.style.transform = 'scaleX(1)';
    });
  }

  /** Entrada de cada acto: una sola vez, al entrar en pantalla. */
  function animarActos() {
    Array.prototype.forEach.call(document.querySelectorAll('.l-acto'), function (acto) {
      var piezas = acto.querySelectorAll(
        '.l-acto__numero, .l-acto__titulo, .l-acto__texto, .l-relojes, .l-division, .l-rastro, .l-acto__nota'
      );
      gsap.to(piezas, {
        opacity: 1,
        y: 0,
        duration: 0.75,
        ease: 'power3.out',
        stagger: 0.08,
        scrollTrigger: { trigger: acto, start: 'top 72%', once: true }
      });
    });
  }

  /**
   * El relevo: el reloj de quien ejecuta se llena y se PARA; en ese momento
   * arranca el de quien valida. Es la unica animacion de la pagina en la que
   * el orden importa mas que el movimiento: si arrancaran a la vez, el acto
   * diria lo contrario de lo que dice el texto.
   */
  function animarRelojes() {
    var ejecuta = document.querySelector('.l-reloj[data-reloj="ejecuta"] .l-reloj__relleno');
    var valida = document.querySelector('.l-reloj[data-reloj="valida"] .l-reloj__relleno');
    if (!ejecuta || !valida) return;

    var linea = gsap.timeline({
      scrollTrigger: { trigger: '.l-relojes', start: 'top 68%', once: true }
    });
    linea
      .to(ejecuta, { scaleX: 1, duration: 1.5, ease: 'none' })
      .to(valida, { scaleX: 1, duration: 1.5, ease: 'none' }, '>0.25');
  }

  /** Los items caen del padre, uno detras de otro. */
  function animarDivision() {
    var hijos = document.querySelectorAll('.l-division__hijo');
    if (!hijos.length) return;
    gsap.from(hijos, {
      opacity: 0,
      y: -10,
      duration: 0.5,
      ease: 'power2.out',
      stagger: 0.12,
      scrollTrigger: { trigger: '.l-division', start: 'top 70%', once: true }
    });
  }

  /**
   * El rastro. Las huellas aparecen en orden -- primero las viejas -- y la
   * fecha vigente al final. Es el pago del concepto: se ven TODAS a la vez.
   */
  function animarRastro() {
    var marcas = document.querySelectorAll('.l-rastro__huella, .l-rastro__viva');
    if (!marcas.length) return;
    gsap.from(marcas, {
      opacity: 0,
      scaleY: 0,
      transformOrigin: 'top center',
      duration: 0.45,
      ease: 'power2.out',
      stagger: 0.16,
      scrollTrigger: { trigger: '.l-rastro', start: 'top 72%', once: true }
    });
  }

  /**
   * El riel marca el estado del acto que se esta mirando. Se enciende con
   * ScrollTrigger y no con la posicion del scroll a pelo, para que en el
   * borde entre dos actos no parpadee entre uno y otro.
   */
  function marcarRiel() {
    var pasos = document.querySelectorAll('.l-riel__paso');
    if (!pasos.length) return;

    function encender(codigo) {
      Array.prototype.forEach.call(pasos, function (p) {
        p.classList.toggle('l-riel__paso--activo', p.getAttribute('data-paso') === codigo);
      });
    }

    Array.prototype.forEach.call(document.querySelectorAll('.l-acto'), function (acto) {
      var codigo = acto.getAttribute('data-acto');
      ScrollTrigger.create({
        trigger: acto,
        start: 'top 60%',
        end: 'bottom 40%',
        onEnter: function () { encender(codigo); },
        onEnterBack: function () { encender(codigo); }
      });
    });
  }
})();
