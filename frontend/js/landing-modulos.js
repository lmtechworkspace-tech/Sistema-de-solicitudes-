/**
 * landing-modulos.js — el acto "el sistema completo" de la landing.
 *
 * QUE HACE
 * Convierte la lista de los doce modulos (que ya viene escrita en el HTML)
 * en un explorador: al elegir uno, la pantalla de la derecha dibuja una
 * MINIATURA de lo que ese modulo hace de verdad.
 *
 * POR QUE LA LISTA VIVE EN EL HTML Y NO AQUI
 * Misma regla que el resto de esta pagina: sin JavaScript no se esconde
 * nada. Los doce modulos con su descripcion son contenido, y el contenido
 * tiene que estar en el documento. Este archivo solo MEJORA lo que ya se
 * lee. Si falla la red y no carga, la seccion sigue diciendo lo mismo.
 *
 * LAS MINIATURAS SON DIAGRAMAS, NO CAPTURAS
 * Una captura de pantalla envejece con cada cambio de la interfaz, pesa, y
 * en telefono se ve como una mancha. Estos diagramas usan los mismos
 * estados, nombres y formas que el producto, y caben en cualquier ancho.
 *
 * LOS DATOS SON DE EJEMPLO, Y SE NOTA
 * Ninguna cifra de aqui sale de la planilla real: es una pagina publica.
 * Son ejemplos con la FORMA de los datos verdaderos (ids correlativos,
 * estados que existen, clausulas ISO que estan en el modulo), para que lo
 * que se muestra sea honesto sin exponer nada.
 */
(function () {
  'use strict';

  var seccion = document.querySelector('[data-consola]');
  if (!seccion) return;

  var pantalla = seccion.querySelector('[data-pantalla]');
  var crudos = [].slice.call(seccion.querySelectorAll('[data-modulo]'));
  if (!pantalla || crudos.length === 0) return;

  // En el HTML los modulos son <div>: sin JavaScript no puede haber botones,
  // porque un boton que no hace nada al pulsarlo es peor que no tenerlo (el
  // lector de pantalla lo anuncia como control y no lo es). Aqui, ya con JS
  // corriendo, se convierten en botones de verdad con semantica de pestanas.
  var lista = seccion.querySelector('.l-consola__indice');
  lista.setAttribute('role', 'tablist');
  lista.setAttribute('aria-label', 'Módulos de SIGSO');
  lista.setAttribute('aria-orientation', 'vertical');
  pantalla.setAttribute('role', 'tabpanel');

  var items = crudos.map(function (div, i) {
    var boton = document.createElement('button');
    boton.type = 'button';
    boton.className = div.className;
    boton.setAttribute('data-modulo', div.getAttribute('data-modulo'));
    boton.setAttribute('role', 'tab');
    boton.setAttribute('aria-controls', 'consola-panel');
    boton.id = 'consola-tab-' + i;
    boton.innerHTML = div.innerHTML;
    // El <ul>/<li> es la estructura correcta del documento SIN JS, pero
    // dentro de un tablist se interpone entre la lista y sus pestanas. Se
    // neutraliza para que el lector de pantalla vea las pestanas como hijas
    // directas, sin tocar el marcado de partida.
    if (div.parentNode.tagName === 'LI') div.parentNode.setAttribute('role', 'presentation');
    div.parentNode.replaceChild(boton, div);
    return boton;
  });

  [].forEach.call(seccion.querySelectorAll('.l-modulos'), function (ul) {
    ul.setAttribute('role', 'presentation');
  });

  pantalla.id = 'consola-panel';

  var quietud = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  var prefiereQuietud = !!(quietud && quietud.matches);

  // --- Miniaturas --------------------------------------------------------
  // Cada entrada: la frase que explica el modulo y el diagrama que lo
  // muestra. El orden de las claves es el mismo del HTML.

  function fila(id, texto, tono, chip) {
    return '<div class="l-fila">' +
      (id ? '<span class="l-fila__id">' + id + '</span>' : '') +
      '<span class="l-fila__texto">' + texto + '</span>' +
      '<span class="l-chip" data-tono="' + tono + '">' + chip + '</span>' +
      '</div>';
  }

  function kpi(valor, nombre, tono) {
    return '<div class="l-kpi" data-tono="' + (tono || 'neutro') + '">' +
      '<span class="l-kpi__valor">' + valor + '</span>' +
      '<span class="l-kpi__nombre">' + nombre + '</span>' +
      '</div>';
  }

  function barra(pct, tono) {
    return '<span class="l-barra"><i class="l-barra__relleno" data-tono="' +
      (tono || 'accion') + '" style="--p:' + pct + '%"></i></span>';
  }

  function nota(texto) {
    return '<p class="l-mini__nota">' + texto + '</p>';
  }

  var VISTAS = {
    nueva_solicitud: {
      frase: 'Un formulario en <strong>tres pasos</strong> que no pide dos veces lo mismo. Quien pide no necesita saber quien lo va a hacer.',
      html:
        '<div class="l-pasos">' +
        '<span class="l-paso" data-hecho="si"><i class="l-paso__linea"></i>1 · Contexto</span>' +
        '<span class="l-paso" data-hecho="si"><i class="l-paso__linea"></i>2 · Qué necesitas</span>' +
        '<span class="l-paso"><i class="l-paso__linea"></i>3 · Revisar y enviar</span>' +
        '</div>' +
        '<div class="l-mini">' +
        fila('', 'Empresa · HomePymes', 'neutro', 'listo') +
        fila('', 'Ítem 01 · Migrar el catálogo', 'neutro', 'listo') +
        fila('', 'Ítem 02 · Ajustar el folio', 'curso', 'escribiendo') +
        '</div>' +
        nota('Una solicitud puede llevar varios ítems desde el minuto uno: se piden juntos y se siguen por separado.')
    },

    mis_solicitudes: {
      frase: 'Todo lo tuyo en un solo lugar, <strong>de todos tus correos</strong>. Sin buscar el número en la bandeja de entrada.',
      html:
        '<div class="l-kpis">' +
        kpi('7', 'abiertas', 'neutro') +
        kpi('2', 'esperan algo tuyo', 'espera') +
        kpi('1', 'con fecha vencida', 'riesgo') +
        '</div>' +
        '<div class="l-mini">' +
        fila('SOL-2026-HP-0042', 'Migración del módulo de facturación', 'curso', 'En desarrollo') +
        fila('SOL-2026-HP-0039', 'Acceso al portal de proveedores', 'espera', 'Terminada') +
        fila('SOL-2026-HP-0031', 'Cambio de folio en boletas', 'ok', 'Cerrada') +
        '</div>' +
        nota('El bloque de arriba responde la única pregunta que se hace de verdad: ¿hay algo esperándome a mí?')
    },

    bandeja: {
      frase: 'El trabajo del equipo con sus <strong>estados, fechas y derivaciones</strong>. Mover un ítem a otra persona deja registro de por qué.',
      html:
        '<div class="l-mini">' +
        fila('0042-01', 'Migrar el catálogo · Ana', 'ok', 'Cerrada') +
        fila('0042-02', 'Ajustar el folio · Juan', 'curso', 'En desarrollo') +
        fila('0042-03', 'Validar con el cliente · derivado →', 'espera', 'Terminada') +
        '</div>' +
        nota('Cada ítem lleva su propio responsable y su propio plazo. El estado de la solicitud completa se recalcula solo.')
    },

    gerencia: {
      frase: 'El <strong>semáforo de cumplimiento</strong> sobre horas hábiles, no sobre días de calendario. Un fin de semana no cuenta como atraso.',
      html:
        '<div class="l-kpis">' +
        kpi('82%', 'en plazo', 'ok') +
        kpi('11%', 'en riesgo', 'espera') +
        kpi('7%', 'vencidas', 'riesgo') +
        '</div>' +
        '<div class="l-mini">' +
        '<div class="l-fila"><span class="l-fila__texto">En plazo</span></div>' +
        barra(82, 'ok') +
        '<div class="l-fila"><span class="l-fila__texto">Fuera de plazo</span></div>' +
        barra(18, 'riesgo') +
        '</div>' +
        nota('La línea base se guarda: se puede comparar contra el compromiso original, no contra el que quedó al final.')
    },

    jefatura: {
      frase: 'Lo mismo que ve gerencia, pero <strong>acotado a tu equipo</strong> — y contado por el responsable real de cada ítem.',
      html:
        '<div class="l-mini">' +
        fila('', 'Ana Pérez', 'ok', '4 al día') +
        fila('', 'Juan Soto', 'espera', '2 esperando validar') +
        fila('', 'Marta Ruiz', 'riesgo', '1 en riesgo') +
        '</div>' +
        nota('Si el número de la banda no cuadra con la suma de la tabla, hay un defecto. Es una comprobación que el módulo se hace a sí mismo.')
    },

    administracion: {
      frase: 'Catálogos, cuentas y configuración. <strong>Cada cuenta ve solo sus módulos</strong>, y el backend lo exige en cada llamada.',
      html:
        '<div class="l-mini">' +
        fila('', 'Áreas · 12 activas', 'ok', 'activo') +
        fila('', 'Cuentas del portal · 34', 'ok', 'activo') +
        fila('', 'Tipos de solicitud · 9', 'neutro', 'editando') +
        '</div>' +
        nota('El control de acceso no vive en la pantalla: quien no tiene el módulo no obtiene el dato aunque lo pida a mano.')
    },

    pausas: {
      frase: 'La pausa activa del día, con un <strong>check-in de un clic</strong> y una pregunta opcional de cómo estás.',
      html:
        '<div class="l-mini">' +
        fila('', 'Pausa activa de hoy · 09:30 · 10 min', 'curso', 'ahora') +
        '</div>' +
        '<div class="l-animos">' +
        '<span class="l-animo">🙂<span>Bien</span></span>' +
        '<span class="l-animo" data-elegido="si">😐<span>Normal</span></span>' +
        '<span class="l-animo">😕<span>Cansado</span></span>' +
        '</div>' +
        nota('El ánimo se mira por área y nunca por persona: sirve para cuidar a un equipo, no para calificar a nadie.')
    },

    pausas_coordinacion: {
      frase: 'Quien coordina abre la pausa, la cierra y ve el <strong>cumplimiento por área</strong> sin pedirle el dato a nadie.',
      html:
        '<div class="l-kpis">' +
        kpi('86%', 'participación', 'ok') +
        kpi('4', 'áreas al día', 'neutro') +
        kpi('1', 'sin registrar', 'espera') +
        '</div>' +
        '<div class="l-mini">' +
        '<div class="l-fila"><span class="l-fila__texto">Bodega</span></div>' + barra(92, 'ok') +
        '<div class="l-fila"><span class="l-fila__texto">Ventas</span></div>' + barra(64) +
        '</div>' +
        nota('Si la pausa se mueve de hora, el aviso de la hora nueva sale igual. La racha es del equipo, nunca de una persona.')
    },

    novedades: {
      frase: 'Leyes, dictámenes y avisos por área, con <strong>acuse de lectura</strong> cuando el contenido lo exige.',
      html:
        '<div class="l-mini">' +
        '<div class="l-fila"><span class="l-chip" data-tono="riesgo">Ley</span>' +
        '<span class="l-fila__texto">Actualización de jornada laboral</span>' +
        '<span class="l-chip" data-tono="espera">acuse</span></div>' +
        '</div>' +
        '<div class="l-mini">' +
        '<div class="l-fila"><span class="l-fila__texto">Leyeron 12 de 16</span></div>' +
        barra(75, 'ok') +
        '</div>' +
        nota('El acuse es evidencia ante un auditor. Por eso no se puede acusar recibo de algo que todavía no está publicado.')
    },

    mi_trabajo: {
      frase: 'Tus compromisos del día con <strong>check-in de un clic</strong>: avanzo, terminé, o necesito mover la fecha.',
      html:
        '<div class="l-mini">' +
        fila('', 'Revisar el informe de cobertura', 'ok', '✓ listo') +
        fila('', 'Cerrar la inducción de septiembre', 'curso', 'avanzo') +
        fila('', 'Preparar la auditoría interna', 'espera', 'mover fecha') +
        '</div>' +
        nota('Mover la fecha exige un motivo, y la fecha anterior no se borra. Es la misma regla del resto del sistema.')
    },

    proyectos: {
      frase: 'Portafolio, equipo y sala de trabajo. Calcula la <strong>ruta crítica</strong>: qué tarea, si se atrasa, atrasa el proyecto entero.',
      html:
        '<div class="l-gantt">' +
        '<div class="l-gantt__fila"><span class="l-gantt__nombre">Levantamiento</span>' +
        '<span class="l-gantt__pista"><i class="l-gantt__barra" data-critica="si" style="--desde:0%;--ancho:28%"></i></span></div>' +
        '<div class="l-gantt__fila"><span class="l-gantt__nombre">Migración</span>' +
        '<span class="l-gantt__pista"><i class="l-gantt__barra" data-critica="si" style="--desde:28%;--ancho:40%"></i></span></div>' +
        '<div class="l-gantt__fila"><span class="l-gantt__nombre">Capacitación</span>' +
        '<span class="l-gantt__pista"><i class="l-gantt__barra" style="--desde:30%;--ancho:22%"></i></span></div>' +
        '<div class="l-gantt__fila"><span class="l-gantt__nombre">Marcha blanca</span>' +
        '<span class="l-gantt__pista"><i class="l-gantt__barra" data-critica="si" style="--desde:68%;--ancho:26%"></i></span></div>' +
        '</div>' +
        nota('En azul, la ruta crítica. Lo ya terminado o cancelado no entra en el cálculo: lo que está cerrado no puede atrasar nada.')
    },

    calidad: {
      frase: 'El sistema de gestión de calidad completo: documentos, procesos, personas, no conformidades y auditorías, <strong>cláusula por cláusula</strong>.',
      html:
        '<div class="l-clausulas">' +
        '<span class="l-clausula" data-cob="total">4.1</span>' +
        '<span class="l-clausula" data-cob="total">4.2</span>' +
        '<span class="l-clausula" data-cob="total">5.2</span>' +
        '<span class="l-clausula" data-cob="parcial">6.1</span>' +
        '<span class="l-clausula" data-cob="total">7.2</span>' +
        '<span class="l-clausula" data-cob="parcial">8.2</span>' +
        '<span class="l-clausula" data-cob="total">9.1</span>' +
        '<span class="l-clausula" data-cob="total">9.2</span>' +
        '<span class="l-clausula" data-cob="parcial">10.2</span>' +
        '</div>' +
        nota('Verde es evidencia que existe; ámbar es un procedimiento que describe cómo se hace, pero todavía no prueba que se haga.')
    }
  };

  // --- Pintado -----------------------------------------------------------

  var vistaActual = null;

  function pintar(id) {
    var def = VISTAS[id];
    var boton = items.filter(function (b) { return b.getAttribute('data-modulo') === id; })[0];
    if (!def || !boton) return;

    items.forEach(function (b) {
      var activo = b === boton;
      b.setAttribute('aria-selected', activo ? 'true' : 'false');
      b.tabIndex = activo ? 0 : -1;
    });

    seccion.querySelector('[data-pantalla-nombre]').textContent =
      boton.querySelector('.l-modulo__nombre').textContent;
    pantalla.setAttribute('aria-labelledby', boton.id);

    var vista = document.createElement('div');
    vista.className = 'l-pantalla__vista l-pantalla__vista--entra';
    vista.innerHTML = '<p class="l-pantalla__frase">' + def.frase + '</p>' + def.html;

    if (vistaActual && vistaActual.parentNode) vistaActual.parentNode.removeChild(vistaActual);
    pantalla.appendChild(vista);
    vistaActual = vista;

    // Quitar la clase en el frame siguiente es lo que dispara la transicion;
    // hacerlo en el mismo frame no anima nada (el navegador nunca llega a
    // pintar el estado inicial).
    if (prefiereQuietud) {
      vista.classList.remove('l-pantalla__vista--entra');
    } else {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { vista.classList.remove('l-pantalla__vista--entra'); });
      });
    }
  }

  // --- Reproduccion automatica ------------------------------------------
  // Avanza sola mientras nadie la toque y la seccion este a la vista. El
  // anillo dice cuanto falta: un cambio que se anuncia no sobresalta.

  var MS_POR_MODULO = 5200;
  var indice = 0;
  var timer = null;
  var intervenida = false;
  var visible = false;
  var anillo = seccion.querySelector('[data-anillo]');
  var LARGO = 37.7;

  function pintarAnillo(p) {
    if (anillo) anillo.style.strokeDashoffset = String(LARGO * (1 - p));
  }

  function arrancar() {
    if (timer || intervenida || prefiereQuietud || !visible) return;
    var desde = Date.now();
    timer = setInterval(function () {
      var p = (Date.now() - desde) / MS_POR_MODULO;
      if (p >= 1) {
        desde = Date.now();
        indice = (indice + 1) % items.length;
        pintar(items[indice].getAttribute('data-modulo'));
        p = 0;
      }
      pintarAnillo(p);
    }, 60);
  }

  function detener(porIntervencion) {
    if (porIntervencion) intervenida = true;
    if (timer) { clearInterval(timer); timer = null; }
    pintarAnillo(0);
    if (intervenida && anillo) anillo.style.display = 'none';
  }

  // --- Interaccion -------------------------------------------------------

  function elegir(boton, mover) {
    indice = items.indexOf(boton);
    pintar(boton.getAttribute('data-modulo'));
    if (mover) boton.focus();
  }

  // En una columna (telefono) la pantalla queda DEBAJO de los doce items:
  // se toca un modulo y no se ve que pase nada, porque lo que cambio esta
  // fuera de pantalla. En dos columnas no hace falta -- la pantalla ya se ve.
  var dosColumnas = window.matchMedia && window.matchMedia('(min-width: 900px)');

  function acercarPantalla() {
    if (dosColumnas && dosColumnas.matches) return;
    var marco = seccion.querySelector('[data-pantalla-marco]');
    if (!marco || !marco.scrollIntoView) return;
    marco.scrollIntoView({
      block: 'nearest',
      behavior: prefiereQuietud ? 'auto' : 'smooth'
    });
  }

  items.forEach(function (boton) {
    boton.addEventListener('click', function () {
      detener(true);
      elegir(boton, false);
      acercarPantalla();
    });

    // Con el puntero encima se previsualiza, pero NO se fija: al salir no se
    // vuelve atras porque volver seria mas desconcertante que quedarse.
    boton.addEventListener('mouseenter', function () {
      if (prefiereQuietud) return;
      detener(true);
      elegir(boton, false);
    });

    boton.addEventListener('keydown', function (ev) {
      var salto = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[ev.key];
      if (salto) {
        ev.preventDefault();
        detener(true);
        var i = (items.indexOf(boton) + salto + items.length) % items.length;
        elegir(items[i], true);
      } else if (ev.key === 'Home' || ev.key === 'End') {
        ev.preventDefault();
        detener(true);
        elegir(items[ev.key === 'Home' ? 0 : items.length - 1], true);
      }
    });
  });

  // La reproduccion automatica solo corre con LA PANTALLA a la vista, no la
  // seccion entera: en telefono la seccion mide varias pantallas y observarla
  // a ella dejaria el carrusel girando mientras se lee el indice, con la
  // pantalla fuera de cuadro. Animar lo que nadie mira gasta bateria y no
  // comunica nada.
  if (window.IntersectionObserver) {
    new IntersectionObserver(function (entradas) {
      visible = entradas[0].isIntersecting;
      if (visible) arrancar(); else detener(false);
    }, { threshold: 0.4 }).observe(seccion.querySelector('[data-pantalla-marco]'));
  } else {
    visible = true;
    arrancar();
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) detener(false); else arrancar();
  });

  // Estado inicial.
  document.documentElement.classList.add('l-js');
  pintar(items[0].getAttribute('data-modulo'));
})();
