/**
 * calidad.js — modulo "Calidad" / SGC ISO 9001 (v10.0, Fase 1).
 * documentacion/SIGSO-v10.0-propuesta-modulo-sgc-iso9001.md.
 *
 * Compartido por las dos vias de acceso (plataforma.js con token y app.js
 * con login Google), mismo patron que proyectos.js/novedades.js.
 *
 * REGLA QUE ATRAVIESA TODO ESTE ARCHIVO: aca NUNCA se decide que documento
 * puede ver una persona. El backend (Calidad.gs) ya devuelve la lista
 * filtrada segun el rol SGC y la visibilidad de cada documento, y vuelve a
 * validar en cada descarga. Esconder un boton no protege nada -- y en este
 * modulo el control de acceso no es una preferencia de producto, es un
 * requisito de la norma.
 */
(function () {
  window.SigsoCalidad = {
    cargar: function () {
      // v11.0 Fase 7: se entra por el tablero. Quien no pueda verlo cae a
      // Documentos solo -- lo resuelve cargarTablero_ con la respuesta del
      // backend, no adivinando el rol desde aca.
      //
      // v12.1: salvo que la URL pida otra seccion (#/calidad/riesgos). Eso NO
      // es una autorizacion: la navegacion se pinta con seccionesVisibles_ y
      // el backend valida cada accion. Una seccion que no le toque devuelve
      // su propio 'sin acceso', igual que si la pidiera por cualquier via.
      registrarArbolSgc_();
      var pedida = (window.SigsoShell && SigsoShell.tomarItemDeRuta)
        ? SigsoShell.tomarItemDeRuta() : '';
      var p = pedida && window.SigsoNav ? SigsoNav.partes(pedida) : null;
      // v15.0: 'tablero' es el nombre viejo de la portada; sigue aceptándose
      // para no romper enlaces guardados, pero la sección se llama 'inicio'.
      seccionActiva_ = (p && p.seccion) || 'inicio';
      if (seccionActiva_ === 'tablero') seccionActiva_ = 'inicio';
      filtroTipo_ = (p && p.seccion === 'documentos') ? (p.argumento || '') : '';
      // v13.0: el argumento de 'reportes' abre ese reporte directo. Estaba
      // solo en irASeccion_, asi que entrar por URL a un reporte dejaba el
      // arbol marcandolo pero el contenido mostraba el catalogo.
      reporteAbierto_ = (p && p.seccion === 'reportes') ? (p.argumento || null) : null;
      documentoActivoId_ = null;
      personaActivaId_ = null;
      render_();
    },
    // Respeta donde esta el usuario: el auto-refresco de fondo no debe
    // sacarlo del documento o la ficha que esta mirando (misma leccion que
    // proyectos.js aprendio en v9.0b).
    refrescar: render_,
    // v13.0: el arbol del sidebar llama aca cuando eligen una seccion.
    irAItem: function (itemId) {
      var p = window.SigsoNav ? SigsoNav.partes(itemId) : { seccion: itemId, argumento: '' };
      irASeccion_(p.seccion === 'tablero' ? 'inicio' : p.seccion, p.argumento);
    }
  };

  // v13.0: la arquitectura se REGISTRA para que el sidebar la dibuje. El
  // predicado de permisos va aca dentro: el arbol no decide nada, obedece.
  // v15.0: el árbol se adapta a lo que la persona realmente ve.
  //
  // Dos reglas, ambas para que nadie tenga que abrir una carpeta y descubrir
  // que adentro hay una sola cosa:
  //   1. Un submódulo con UN solo ítem visible se dibuja como enlace directo,
  //      con el nombre del ítem (no el del grupo).
  //   2. Para quien no supervisa el SGC, "Personal" es literalmente UNA ficha
  //      -- la suya --, así que se llama "Mi ficha".
  function arquitecturaSgc_() {
    var propia = !superviseSgc_();
    return ARQUITECTURA_SGC.map(function (sub) {
      var visibles = sub.items.filter(function (it) {
        var llave = it.permiso || (window.SigsoNav ? SigsoNav.partes(it.id).seccion : it.id);
        return puedeVerSeccion_(llave);
      });
      if (sub.id === 'personas' && propia) {
        return { id: 'personas', nombre: 'Mi ficha', icono: sub.icono, plano: true,
          items: [{ id: 'personas', nombre: 'Mi ficha', permiso: 'personas' }] };
      }
      if (visibles.length === 1 && !sub.plano) {
        var uno = visibles[0];
        return { id: sub.id, nombre: uno.nombre, icono: sub.icono, plano: true,
          items: [{ id: uno.id, nombre: uno.nombre, permiso: uno.permiso }] };
      }
      return sub;
    });
  }

  function registrarArbolSgc_() {
    if (!window.SigsoNav) return;
    SigsoNav.registrar('calidad', {
      nombre: 'Calidad',
      submodulos: arquitecturaSgc_(),
      visible: puedeVerSeccion_
    });
  }

  function render_() {
    if (seccionActiva_ === 'personas') {
      if (personaActivaId_) abrirPersona_(personaActivaId_); else cargarPersonas_();
    } else if (seccionActiva_ === 'capacitaciones') {
      cargarCapacitaciones_();
    } else if (seccionActiva_ === 'nc') {
      if (ncActivaId_) abrirNc_(ncActivaId_); else cargarNc_();
    } else if (seccionActiva_ === 'auditorias') {
      if (auditoriaActivaId_) abrirAuditoria_(auditoriaActivaId_); else cargarAuditorias_();
    } else if (seccionActiva_ === 'quejas') {
      if (quejaActivaId_) abrirQueja_(quejaActivaId_); else cargarQuejas_();
    } else if (seccionActiva_ === 'proveedores') {
      if (proveedorActivoId_) abrirProveedor_(proveedorActivoId_); else cargarProveedores_();
    } else if (seccionActiva_ === 'revision') {
      if (revisionActivaId_) abrirRevision_(revisionActivaId_); else cargarRevisiones_();
    } else if (seccionActiva_ === 'objetivos') {
      if (objetivoActivoId_) abrirObjetivo_(objetivoActivoId_); else cargarObjetivos_();
    } else if (seccionActiva_ === 'servicios') {
      cargarPrestaciones_();
    } else if (seccionActiva_ === 'inicio' || seccionActiva_ === 'tablero') {
      cargarInicio_();
    } else if (seccionActiva_ === 'indicadores') {
      cargarIndicadores_();
    } else if (seccionActiva_ === 'procesos') {
      if (procesoActivoId_) abrirProceso_(procesoActivoId_); else cargarProcesos_();
    } else if (seccionActiva_ === 'riesgos') {
      cargarRiesgos_();
    } else if (seccionActiva_ === 'contexto') {
      cargarContexto_();
    } else if (seccionActiva_ === 'alcance') {
      cargarAlcance_();
    } else if (seccionActiva_ === 'cobertura') {
      cargarCobertura_();
    } else if (seccionActiva_ === 'reportes') {
      cargarReportes_();
    } else if (seccionActiva_ === 'accesos') {
      cargarAccesos_();
    } else {
      if (documentoActivoId_) abrirDocumento_(documentoActivoId_); else cargarListado_();
    }
  }

  // ==========================================================================
  // v12.0 — Arquitectura del módulo: Submódulo -> Ítem (navegacion.js).
  //
  // Sustituye a GRUPOS_SECCIONES_SGC, que ya declaraba 7 grupos con 16
  // secciones pero se aplanaba en UNA barra horizontal con scroll lateral.
  // La jerarquía ya existía en los datos; lo que faltaba era dibujarla.
  //
  // DE DÓNDE SALE ESTE AGRUPAMIENTO
  // No es una invención: cada ítem es una sección que YA EXISTE, y el
  // submódulo que la contiene es el capítulo de la norma que la sustenta
  // (los mismos que usa saludPorCapitulo_ en Tablero.gs para agrupar las 28
  // cláusulas). Los `permiso` apuntan a las llaves de seccionesVisiblesSgc_
  // del backend, que sigue siendo quien decide.
  //
  // Los ítems "documentos:PRO", "documentos:FO"... NO son pantallas nuevas:
  // son la MISMA sección de documentos con filtroTipo_ ya puesto. El filtro
  // existe desde la v10.0; acá sólo se le da entrada por navegación.
  //
  // v15.0 — REARQUITECTURA POR TAREA (no por capítulo de la norma).
  //
  // Hasta la v14 el árbol era el índice de la ISO 9001: "Sistema de Gestión"
  // (capítulo 4) primero, luego "Planificación" (6), "Documentación" (7.5),
  // "Operación" (8), "Control y mejora" (9-10). Eso obliga a la persona a
  // saber cómo está construido un SGC para encontrar su trabajo: lo más
  // estructural quedaba arriba y lo más usado (documentos) al medio.
  //
  // El orden ahora sale de lo que la gente viene a hacer, y de cuán seguido:
  //   1. Inicio      — qué pasa y qué tengo que hacer
  //   2. Documentos  — lo que más se busca (una pantalla, no cinco entradas)
  //   3. Personas    — fichas, competencias
  //   4. Seguimiento — lo que hay que trabajar hasta cerrarlo
  //   5. Medición    — cómo vamos
  //   6. El sistema  — la estructura del SGC (consulta, no tarea diaria)
  //   7. Operación   — registros operativos
  //   8. Administración
  //
  // Los permisos NO cambian: el mismo `permiso` de siempre por ítem, y el
  // árbol se poda solo. Un operativo ve Inicio + Documentos + su ficha + la
  // parte consultable del sistema, sin tocar una línea de autorización.
  var ARQUITECTURA_SGC = [
    // 'inicio' es un id NUEVO y visible para todos; adentro decide qué
    // pintar según el rol (ver cargarInicio_). El id 'tablero' se conserva
    // como sinónimo para no romper enlaces guardados.
    { id: 'inicio', nombre: 'Inicio', icono: 'estado', plano: true, items: [
      { id: 'inicio', nombre: 'Inicio', permiso: 'inicio' }
    ] },

    // Lo más buscado del módulo. Antes eran CINCO entradas de sidebar para
    // UNA sola pantalla con el filtro puesto; ahora es una, y los tipos son
    // fichas dentro de la pantalla (las rutas 'documentos:PRO' siguen vivas,
    // así que los enlaces guardados y las migas no se rompen).
    { id: 'documentos', nombre: 'Documentos', icono: 'documento', plano: true, items: [
      { id: 'documentos', nombre: 'Documentos', permiso: 'documentos' }
    ] },

    // §7.2 / §7.3: competencia y toma de conciencia. Para un operativo esto
    // es sólo su propia ficha, y así se llama en su caso (ver nombreItemSgc_).
    { id: 'personas', nombre: 'Personas', icono: 'persona', items: [
      { id: 'personas', nombre: 'Personal', permiso: 'personas' },
      { id: 'capacitaciones', nombre: 'Capacitaciones' }
    ] },

    // Lo que hay que trabajar hasta cerrarlo. Antes se llamaba "Control y
    // mejora" (§9-10) y mezclaba indicadores (medir) con no conformidades
    // (resolver): son dos trabajos distintos, ahora separados.
    { id: 'seguimiento', nombre: 'Seguimiento y mejora', icono: 'alerta',
      descripcion: 'Lo que hay que resolver', items: [
      { id: 'nc', nombre: 'No conformidades' },                // §10.2
      { id: 'quejas', nombre: 'Quejas' },                      // §9.1.2
      { id: 'auditorias', nombre: 'Auditorías internas' },     // §9.2
      { id: 'revision', nombre: 'Revisión por la dirección' }  // §9.3
    ] },

    // Cómo vamos: medir y mirar. Objetivos vive acá (y no en "Planificación")
    // porque en el día a día se consulta junto a los indicadores que lo miden.
    { id: 'medicion', nombre: 'Medición', icono: 'grafico',
      descripcion: 'Cómo vamos', items: [
      { id: 'indicadores', nombre: 'Indicadores' },            // §9.1.1
      { id: 'objetivos', nombre: 'Objetivos de calidad' }      // §6.2
    ] },

    // La estructura del SGC: se consulta, no es tarea diaria. Por eso baja
    // del primer lugar (donde estaba como "Sistema de Gestión") a acá.
    { id: 'sistema', nombre: 'El sistema', icono: 'escudo',
      descripcion: 'Cómo está definido el SGC', items: [
      { id: 'alcance', nombre: 'Alcance' },                    // §4.3
      { id: 'contexto', nombre: 'Contexto y partes interesadas' }, // §4.1 / §4.2
      { id: 'procesos', nombre: 'Mapa de procesos' },          // §4.4
      { id: 'riesgos', nombre: 'Riesgos y oportunidades' },    // §6.1
      { id: 'cobertura', nombre: 'Cobertura ISO' }             // transversal 4-10
    ] },

    // Capítulo 8: operación.
    { id: 'operacion', nombre: 'Operación', icono: 'caja', items: [
      { id: 'servicios', nombre: 'Servicios prestados' },      // §8.1 / §8.5 / §8.6
      { id: 'proveedores', nombre: 'Proveedores' }             // §8.4
    ] },

    // v15.0: UNA entrada, no seis. Los cinco reportes con nombre propio ya
    // están listados dentro del Centro de reportes -- con su descripción y su
    // estado -- así que repetirlos en el sidebar era ocupar cinco filas para
    // duplicar una pantalla que ya explica mejor lo mismo. Las rutas
    // 'reportes:cump-general' siguen funcionando para enlaces guardados.
    { id: 'reportes', nombre: 'Reportes', icono: 'grafico', plano: true, items: [
      { id: 'reportes', nombre: 'Reportes', permiso: 'cobertura' }
    ] },

    { id: 'administracion', nombre: 'Administración', icono: 'llave', items: [
      { id: 'accesos', nombre: 'Accesos' }
    ] }
  ];

  // Nombre legible de cada ítem, para migas de pan y títulos. Se deriva de la
  // arquitectura para que no haya dos listas que mantener sincronizadas.
  var NOMBRE_ITEM_SGC = (function () {
    var mapa = {};
    ARQUITECTURA_SGC.forEach(function (sub) {
      sub.items.forEach(function (it) { mapa[it.id] = it.nombre; });
    });
    // v15.0: los tipos de documento dejaron de ser entradas del sidebar
    // (son fichas dentro de la pantalla), pero sus rutas siguen existiendo:
    // sin esto una miga de '#/calidad/documentos:PRO' se quedaría sin nombre.
    mapa['documentos:PRO'] = 'Procedimientos';
    mapa['documentos:INS'] = 'Instructivos';
    mapa['documentos:FO'] = 'Formularios';
    mapa['documentos:EXTERNO'] = 'Documentos externos';
    mapa['documentos:DOC'] = 'Documentos maestros';
    mapa['tablero'] = 'Inicio';
    return mapa;
  })();


  // --- Navegación del módulo (v12.0) ---------------------------------------
  // Antes acá vivía barraSecciones_(): una barra HORIZONTAL con las 16
  // secciones. Ahora la navegación es vertical y persistente (SigsoNav), y lo
  // que se inyecta en cada vista son las MIGAS DE PAN. Se conservan los dos
  // nombres de función porque los llaman 51 sitios de este archivo: cambiar
  // qué devuelven es un solo punto de cambio, tocar 51 no lo es.

  // ¿Puede la persona abrir esta sección? Única fuente: el mapa que manda el
  // backend. Si aún no llegó, se muestra todo menos Accesos -- el backend
  // vuelve a validar en cada acción, esconder un botón no protege nada.
  function puedeVerSeccion_(llave) {
    if (llave === 'documentos' || llave === 'personas') return true;
    // v15.0: Inicio es de TODOS. Antes la portada era 'tablero' y el backend
    // la reserva a quien supervisa (seccionesVisiblesSgc_.tablero = veTodo),
    // así que el personal operativo entraba al módulo sin ninguna pantalla de
    // orientación: caía directo en la lista de documentos. Ahora 'inicio'
    // existe para todos y ADENTRO decide qué mostrar: el resumen de gobierno
    // para quien supervisa, y "lo tuyo" para el resto. No se relaja ningún
    // permiso -- resumenTableroSgc se sigue pidiendo sólo si .tablero es true.
    if (llave === 'inicio') return true;
    if (!seccionesVisibles_) return llave !== 'accesos';
    return seccionesVisibles_[llave] === true;
  }

  // ¿Esta persona tiene la vista de gobierno del SGC (salud, alertas, hitos)?
  // Es la misma llave que decide el endpoint del tablero.
  function superviseSgc_() { return !!(seccionesVisibles_ && seccionesVisibles_.tablero === true); }

  // Contenedor del panel de contenido. Crea el layout de dos columnas la
  // primera vez y devuelve SIEMPRE el panel derecho, para que las 27 vistas
  // que antes escribían sobre #calidad-contenido no pisen la navegación.
  function panelSgc_() {
    var raiz = document.getElementById('calidad-contenido');
    if (!raiz) return null;
    var panel = raiz.querySelector('.sigso-modulo-layout__panel');
    if (!panel) {
      raiz.innerHTML =
        // v13.0: sin <nav> interno -- la navegacion vive en el sidebar.
        '<div class="sigso-modulo-layout">' +
          '<div class="sigso-modulo-layout__panel"></div>' +
        '</div>';
      panel = raiz.querySelector('.sigso-modulo-layout__panel');
    }
    // Se repinta en cada vista: es lo que mantiene marcado el item activo y
    // lo que hace aparecer las secciones nuevas cuando llega seccionesVisibles_.
    pintarNavSgc_();
    return panel;
  }

  // v13.0: la navegacion ya no se pinta ACA -- vive en el sidebar. Esta
  // funcion queda como el punto donde el modulo avisa que su arbol cambio
  // (llego seccionesVisibles_ del backend, o se movio la seccion activa).
  // La llaman los ~57 sitios que antes repintaban la barra interna.
  function pintarNavSgc_() {
    registrarArbolSgc_();
    if (window.SigsoShell && SigsoShell.refrescarArbol) SigsoShell.refrescarArbol();
  }

  // El id del ítem activo incluye el filtro cuando la sección lo usa, para
  // que "Procedimientos" quede marcado y no "Lista maestra".
  // Qué ítem del ÁRBOL queda marcado. Desde la v15.0 los tipos de documento
  // no son ítems del árbol (son filtros), así que 'documentos:PRO' marca
  // igual "Documentos": si devolviera el id con tipo, no se marcaría nada.
  function itemActivo_() {
    return seccionActiva_;
  }

  // Qué se escribe en la URL. Acá sí viaja el tipo, para que un enlace a
  // "#/calidad/documentos:PRO" siga abriendo los procedimientos filtrados.
  function rutaActiva_() {
    if (seccionActiva_ === 'documentos' && filtroTipo_) return 'documentos:' + filtroTipo_;
    if (seccionActiva_ === 'reportes' && reporteAbierto_) return 'reportes:' + reporteAbierto_;
    return itemActivo_();
  }

  function irASeccion_(seccion, argumento) {
    seccionActiva_ = seccion;
    // Los ítems por tipo de documento son la misma pantalla con el filtro ya
    // puesto. Elegir "Lista maestra" lo limpia.
    if (seccion === 'documentos') filtroTipo_ = argumento || '';
    // v13.0: 'reportes:cump-general' abre ese reporte directo desde el arbol;
    // 'reportes' a secas vuelve al catalogo.
    if (seccion === 'reportes') { reporteAbierto_ = argumento || null; filtrosReporte_ = {}; }
    documentoActivoId_ = null;
    personaActivaId_ = null;
    ncActivaId_ = null;
    auditoriaActivaId_ = null;
    quejaActivaId_ = null;
    proveedorActivoId_ = null;
    revisionActivaId_ = null;
    objetivoActivoId_ = null;
    procesoActivoId_ = null;
    // La URL sigue a la navegacion: asi el enlace se puede compartir y el
    // boton atras vuelve a la seccion anterior en vez de salir del modulo.
    if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(rutaActiva_());
    render_();
  }

  // Lo que se inyecta arriba de cada vista: migas de pan. Reemplaza a la
  // barra de pestañas en los 51 sitios que la pedían.
  function barraSecciones_(detalle) {
    if (!window.SigsoNav) return '';
    // v15.0: el tipo de documento ya no es un ítem del árbol, es un filtro
    // dentro de la pantalla. Por eso se muestra como último tramo de la miga
    // ("Calidad / Documentos / Procedimientos") en vez de marcar una entrada
    // de sidebar que ya no existe.
    var extra = detalle || '';
    if (!extra && seccionActiva_ === 'documentos' && filtroTipo_) {
      extra = TIPO_ETIQUETA_PLURAL[filtroTipo_] || TIPO_ETIQUETA[filtroTipo_] || '';
    }
    return SigsoNav.migas({
      modulo: 'calidad',
      moduloNombre: 'Calidad',
      submodulos: arquitecturaSgc_(),
      activo: itemActivo_(),
      detalle: extra
    });
  }

  // Se conserva por compatibilidad con los sitios que la llamaban tras pintar.
  // La navegación ya no vive dentro del contenido, así que sólo se asegura de
  // que el árbol lateral refleje dónde estamos.
  function wireSecciones_() {
    pintarNavSgc_();
  }

  function urlBackoffice_() {
    return (window.SIGSO_CONFIG || {}).BACKOFFICE_URL;
  }
  // v14.1/v14.2/v14.3: caché del último listado pintado por sección. Cargar
  // un listado (al entrar a la sección desde el menú, al volver de un detalle,
  // o en el auto-refresco de fondo) dejaba el panel del medio en blanco con
  // "Cargando..." y repetía el viaje completo al servidor -- aunque nada
  // hubiera cambiado. Eso es lo que se sentía como que "se recarga la página".
  // La caché se vacía SOLA tras cualquier acción que escriba (ver api_), así
  // que nunca puede mostrar datos desactualizados: si editaste algo, la
  // próxima carga trae el listado fresco.
  var cacheListadoSgc_ = {};

  function api_(accion, datos) {
    return llamarApi(urlBackoffice_(), accion, datos || {}).then(function (respuesta) {
      // Cualquier acción que no sea de lectura pudo cambiar un listado: se
      // invalida toda la caché para que la próxima carga traiga lo
      // actualizado. Las lecturas empiezan por listar/get/descargar/
      // buscar/exportar; todo lo demás (guardar, registrar, actualizar,
      // desvincular, quitar, cerrar, programar...) escribe.
      if (respuesta && respuesta.ok && !/^(listar|get|descargar|buscar|export)/i.test(accion)) {
        cacheListadoSgc_ = {};
      }
      return respuesta;
    });
  }

  // v14.3: motor común de "stale-while-revalidate" para los listados. Si hay
  // algo cacheado, se pinta AL INSTANTE (sin panel en blanco) y de todas
  // formas se revalida en segundo plano; cuando la respuesta llega se repinta
  // -- pero SOLO si el usuario sigue en esa misma pantalla (sigo()), para que
  // una respuesta que llega tarde nunca pise un detalle o una sección a la
  // que ya navegó. Sin caché, se comporta como siempre: spinner y a esperar.
  //   opts.clave    clave en cacheListadoSgc_
  //   opts.accion   acción del backend (lectura)
  //   opts.datos    payload
  //   opts.spinner  texto del "Cargando..." cuando no hay caché
  //   opts.sigo()   ¿seguimos en esta pantalla? (sección activa y sin detalle)
  //   opts.aplicar(cont, data)  fija el estado propio de la sección + pinta
  //   opts.error(cont, msg)     pinta el error (cada sección arma el suyo)
  function cargarListadoSgc_(opts) {
    var cont = panelSgc_();
    if (!cont) return;
    var enCache = cacheListadoSgc_[opts.clave];
    if (enCache) opts.aplicar(cont, enCache);
    else cont.innerHTML = Componentes.cargando(opts.spinner);
    api_(opts.accion, opts.datos || {}).then(function (respuesta) {
      if (!opts.sigo()) return;
      if (!respuesta || !respuesta.ok) {
        if (!enCache) opts.error(cont, (respuesta && respuesta.message) || null);
        return;
      }
      opts.aplicar(cont, respuesta.data);
    }).catch(function () {
      if (!enCache && opts.sigo()) opts.error(cont, null);
    });
  }

  var TIPO_ETIQUETA = {
    DOC: 'Documento maestro', PRO: 'Procedimiento', INS: 'Instructivo',
    FO: 'Formulario', EXTERNO: 'Documento externo'
  };
  // v15.0: en las fichas de filtro se lee "Procedimientos", no "Procedimiento":
  // ahí se está eligiendo un grupo, no describiendo una pieza.
  var TIPO_ETIQUETA_PLURAL = {
    DOC: 'Documentos maestros', PRO: 'Procedimientos', INS: 'Instructivos',
    FO: 'Formularios', EXTERNO: 'Normas y leyes'
  };
  // v10.0 Fase 2 (cont.): icono por tipo, para la tarjeta del listado.
  var TIPO_ICONO_SGC = {
    DOC: 'documento', PRO: 'estado', INS: 'lista', FO: 'etiqueta', EXTERNO: 'empresa'
  };
  var VISIBILIDAD_ETIQUETA = {
    TODOS: 'Todo el personal', AREA: 'Solo su área', SELECCION: 'Personas específicas'
  };
  var ROL_SGC_ETIQUETA = {
    ENCARGADO_SGC: 'Encargado SGC', DIRECCION: 'Dirección', GERENCIA_ADM: 'Gerencia Adm.',
    JEFATURA_AREA: 'Jefatura de área', ENC_ADMIN: 'Enc. Administración',
    OPERATIVO: 'Personal operativo', AUDITOR_EXTERNO: 'Auditor externo'
  };
  var TIPOS = ['DOC', 'PRO', 'INS', 'FO', 'EXTERNO'];

  var seccionActiva_ = 'inicio';
  // v10.0 "Accesos SGC": mapa de secciones que la persona puede abrir. Llega
  // del backend en listarDocumentos; hasta entonces null (barraSecciones_ lo
  // maneja). Controla que pestanas se muestran.
  var seccionesVisibles_ = null;
  var documentoActivoId_ = null;
  var personaActivaId_ = null;
  var ncActivaId_ = null;
  var auditoriaActivaId_ = null;
  var quejaActivaId_ = null;
  var proveedorActivoId_ = null;
  var revisionActivaId_ = null;
  var objetivoActivoId_ = null;
  var pestanaFicha_ = 'datos';
  var puedeGestionar_ = false;
  var filtroTipo_ = '';
  var filtroEstado_ = '';
  var filtroBusqueda_ = '';
  // v15.0: "sólo los que debo confirmar". Es la tarea real del personal
  // operativo, y hasta ahora obligaba a cazar insignias en una lista
  // alfabética. Se filtra en el cliente porque el dato (debo_acusar) ya
  // viene en cada documento del listado: no hace falta pedir nada nuevo.
  var filtroPendientes_ = false;
  // ¿La ficha abierta es la única que esta persona puede ver? Entonces no
  // hay listado al que volver y el botón "← Personal" no se dibuja.
  var fichaSinListado_ = false;

  // --- listado maestro (FO-PRO-01-01) --------------------------------------

  function cargarListado_() {
    documentoActivoId_ = null;
    var filtros = {};
    if (filtroTipo_) filtros.tipo = filtroTipo_;
    if (filtroEstado_) filtros.estado = filtroEstado_;
    if (filtroBusqueda_) filtros.busqueda = filtroBusqueda_;
    cargarListadoSgc_({
      clave: 'documentos', accion: 'listarDocumentosSgc', datos: filtros,
      spinner: 'Cargando documentos...',
      sigo: function () { return seccionActiva_ === 'documentos' && !documentoActivoId_; },
      aplicar: function (cont, data) {
        puedeGestionar_ = data.puede_gestionar === true;
        if (data.secciones_visibles) seccionesVisibles_ = data.secciones_visibles;
        cacheListadoSgc_.documentos = data;
        pintarListado_(cont, data);
      },
      error: function (cont, msg) {
        cont.innerHTML = Componentes.alerta(msg || 'No se pudo conectar para cargar los documentos.', 'error');
      }
    });
  }

  function pintarListado_(cont, data) {
    var docs = data.documentos || [];
    // v15.0: "sólo por confirmar" se aplica acá (el dato ya viene por
    // documento). Es un filtro más, y como tal se refleja en "Limpiar".
    if (filtroPendientes_) docs = docs.filter(function (x) { return x.debo_acusar; });
    var hayFiltros = !!(filtroTipo_ || filtroEstado_ || filtroBusqueda_ || filtroPendientes_);


    // v10.0 Fase 2 (rediseno visual): tablero de 3 KPIs sobre lo que esta
    // persona puede ver -- no varia con los filtros de la lista de abajo
    // (viene de "resumen", calculado en el backend ANTES de aplicarlos).
    // v15.0: la tarea pendiente deja de ser un aviso decorativo y pasa a ser
    // un FILTRO con un botón. Antes decía "tienes 9 por confirmar" y dejaba a
    // la persona cazando insignias entre 21 filas ordenadas por código.
    var r = data.resumen || {};
    var kpis = '';
    if (data.pendientes_de_acuse) {
      kpis = '<div class="sgc-tarea-barra' + (filtroPendientes_ ? ' sgc-tarea-barra--activa' : '') + '">' +
        '<div class="sgc-tarea-barra__texto">' +
          '<b>' + data.pendientes_de_acuse + ' documento(s) esperan tu confirmación.</b> ' +
          'Ábrelos y marca «Enterado».' +
        '</div>' +
        Componentes.boton({
          texto: filtroPendientes_ ? 'Ver todos los documentos' : 'Ver sólo esos',
          variante: 'secundario', clase: 'js-sgc-solo-pendientes'
        }) +
      '</div>';
    }

    // v15.0: los tipos pasan del <select> (jerga ISO escondida en un menú) a
    // fichas visibles. Responde de un vistazo "¿dónde están los
    // procedimientos?", que era una de las preguntas que nadie podía contestar.
    var fichas = [{ valor: '', texto: 'Todos' }].concat(TIPOS.map(function (t) {
      return { valor: t, texto: TIPO_ETIQUETA_PLURAL[t] || TIPO_ETIQUETA[t] };
    })).map(function (f) {
      var activo = (filtroTipo_ || '') === f.valor;
      // aria-pressed (no aria-current): son filtros que se activan y
      // desactivan, no la página en la que estás.
      return '<button type="button" class="sgc-chip' + (activo ? ' sgc-chip--activo' : '') +
        ' js-sgc-chip-tipo" data-tipo="' + f.valor + '" aria-pressed="' + (activo ? 'true' : 'false') + '">' +
        Componentes.escaparHtml(f.texto) + '</button>';
    }).join('');

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Los documentos del SGC que te corresponden' +
        (data.rol_sgc ? ' según tu rol (<b>' + Componentes.escaparHtml(ROL_SGC_ETIQUETA[data.rol_sgc] || data.rol_sgc) + '</b>)' : '') +
        '.</p>' +
      (puedeGestionar_ ? Componentes.boton({ texto: '+ Cargar documento', clase: 'js-sgc-nuevo' }) : '') +
      // v11.0 Fase 5: el listado de documentos externos (§7.5.3.2) se ofrece
      // mientras no haya ninguno identificado. Despues estorba.
      (puedeGestionar_ && !(data.documentos || []).some(function (x) { return x.tipo === 'EXTERNO'; })
        ? Componentes.boton({ texto: 'Cargar normas y leyes aplicables', variante: 'secundario', clase: 'js-sgc-externos' })
        : '') +
      '</div>' + kpis +
      '<div class="sgc-chips" role="group" aria-label="Filtrar por tipo de documento">' + fichas + '</div>' +
      '<div class="sgc-filtros">' +
        Componentes.campoTexto({ id: 'sgc-f-busqueda', label: false, valor: filtroBusqueda_, placeholder: 'Buscar: nombre, código o palabra clave...' }) +
        (puedeGestionar_
          ? Componentes.campoSelect({
              id: 'sgc-f-estado', label: false, valor: filtroEstado_, placeholder: 'Vigentes y obsoletos',
              opciones: [{ valor: 'VIGENTE', texto: 'Solo vigentes' }, { valor: 'OBSOLETO', texto: 'Solo obsoletos' }]
            })
          : '') +
        (hayFiltros ? Componentes.boton({ texto: 'Limpiar filtros', variante: 'sutil', clase: 'js-sgc-limpiar', tipo: 'button' }) : '') +
      '</div>';

    function wire() {
      wireSecciones_(cont);
      var externos = cont.querySelector('.js-sgc-externos');
      if (externos) {
        externos.addEventListener('click', function () {
          Componentes.confirmar({
            titulo: '¿Cargar el listado de documentos externos?',
            mensaje: 'Son las 6 normas, decretos y leyes del FO-PRO-01-01: ISO 9001, ISO 19011, ' +
              'DS 44, Ley 16.744, DS 594 y el Código del Trabajo. Se registran como referencia, ' +
              'sin archivo adjunto y sin acuse.',
            confirmar: 'Cargarlos'
          }).then(function (ok) {
            if (!ok) return;
            api_('sembrarDocumentosExternosSgc', {}).then(function (resp) {
              var d = (resp && resp.data) || {};
              Componentes.aviso({
                texto: d.message || 'Documentos externos cargados.',
                tipo: (resp && resp.ok && d.ok !== false) ? 'exito' : 'error'
              });
              if (resp && resp.ok) cargarListado_();
            });
          });
        });
      }
      var nuevo = cont.querySelector('.js-sgc-nuevo');
      if (nuevo) nuevo.addEventListener('click', abrirFormularioNuevo_);

      var busqueda = cont.querySelector('#sgc-f-busqueda');
      if (busqueda) {
        busqueda.addEventListener('change', function () { filtroBusqueda_ = this.value; cargarListado_(); });
        busqueda.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); filtroBusqueda_ = this.value; cargarListado_(); }
        });
      }
      cont.querySelectorAll('.js-sgc-chip-tipo').forEach(function (b) {
        b.addEventListener('click', function () {
          filtroTipo_ = b.getAttribute('data-tipo') || '';
          // El tipo se refleja en la ruta (documentos:PRO), que es como se
          // compartía antes desde el sidebar: los enlaces siguen sirviendo.
          if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(rutaActiva_());
          cargarListado_();
        });
      });
      var soloPend = cont.querySelector('.js-sgc-solo-pendientes');
      if (soloPend) soloPend.addEventListener('click', function () {
        filtroPendientes_ = !filtroPendientes_;
        cargarListado_();
      });
      var estado = cont.querySelector('#sgc-f-estado');
      if (estado) estado.addEventListener('change', function () { filtroEstado_ = this.value; cargarListado_(); });
      var limpiar = cont.querySelector('.js-sgc-limpiar');
      if (limpiar) limpiar.addEventListener('click', function () {
        filtroTipo_ = ''; filtroEstado_ = ''; filtroBusqueda_ = ''; filtroPendientes_ = false;
        cargarListado_();
      });
      cont.querySelectorAll('.js-sgc-abrir').forEach(function (btn) {
        btn.addEventListener('click', function () { abrirDocumento_(btn.getAttribute('data-id')); });
      });
    }

    if (docs.length === 0) {
      var vacio;
      if (filtroPendientes_) {
        // No es "no hay resultados": es una buena noticia. Decirlo importa.
        vacio = { texto: 'No te queda ningún documento por confirmar.',
          detalle: 'Usa «Ver todos los documentos» para volver al listado completo.' };
      } else if (hayFiltros) {
        vacio = { texto: 'Ningún documento coincide con lo que buscas.',
          detalle: 'Prueba con otra palabra, o usa «Limpiar filtros» para ver todos.' };
      } else {
        vacio = { texto: 'Todavía no hay documentos disponibles para ti.',
          detalle: puedeGestionar_ ? 'Carga el primero para empezar.' : 'El Encargado SGC los irá publicando.' };
      }
      cont.innerHTML = cabecera + Componentes.vacio(vacio);
      wire();
      return;
    }

    // v15.0: lo que la persona TIENE QUE HACER va arriba. Antes la lista salía
    // ordenada por código (DOC-01, FO-..., INS-..., PRO-...), que es el orden
    // del archivador, no el de la tarea: los 9 pendientes quedaban repartidos
    // entre 21 filas y había que cazarlos por la insignia.
    docs = docs.slice().sort(function (a, b) {
      if (!!a.debo_acusar !== !!b.debo_acusar) return a.debo_acusar ? -1 : 1;
      return String(a.codigo || '').localeCompare(String(b.codigo || ''));
    });

    var filas = docs.map(function (d) {
      var obsoleto = d.estado === 'OBSOLETO';
      // v10.0 Fase 2 (cont.): icono a la izquierda por tipo de documento --
      // antes la unica pista del tipo era texto chico en la fila de meta;
      // ahora se escanea la lista por forma/color antes de leer nada.
      return '<button type="button" class="sgc-doc sgc-doc--con-icono js-sgc-abrir' + (obsoleto ? ' sgc-doc--obsoleto' : '') + '" data-id="' + d.documento_id + '">' +
        '<span class="sgc-doc__icono">' + Iconos.svg(TIPO_ICONO_SGC[d.tipo] || 'documento', { tam: 17 }) + '</span>' +
        '<span class="sgc-doc__cuerpo">' +
          '<span class="sgc-doc__top">' +
            '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(d.codigo) + '</span>' +
            '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(d.nombre) + '</span>' +
            // v15.0: un documento EXTERNO (una ley, una norma) no tiene
            // versión propia -- la organización no la controla. Antes se
            // pintaba igual la insignia y quedaba una "v" suelta sin número.
            (String(d.version_vigente || '').trim()
              ? Componentes.badge('v' === String(d.version_vigente).charAt(0)
                  ? d.version_vigente : ('v' + d.version_vigente), 'neutro')
              : '') +
            (obsoleto ? Componentes.badge('Obsoleto', 'critico') : '') +
            (d.debo_acusar ? Componentes.badge('Debes confirmar', 'alerta') : '') +
            (d.revision_vencida && !obsoleto ? Componentes.badge('Revisión vencida', 'alerta') : '') +
          '</span>' +
          '<span class="sgc-doc__meta">' +
            '<span>' + Componentes.escaparHtml(TIPO_ETIQUETA[d.tipo] || d.tipo) + '</span>' +
            (d.fecha_vigencia ? '<span>Vigente desde ' + fechaCorta_(d.fecha_vigencia) + '</span>' : '') +
            // v15.0: la fecha de próxima revisión es un control de GESTIÓN
            // (a quién le toca revisar el documento y cuándo). A quien sólo
            // consulta le aparecía como "Revisar 24/08/2027", que se lee como
            // una instrucción dirigida a él. Se muestra sólo a quien gestiona.
            (puedeGestionar_ && d.proxima_revision
              ? '<span>Revisar ' + fechaCorta_(d.proxima_revision) + '</span>' : '') +
            (puedeGestionar_ ? '<span>' + Componentes.escaparHtml(VISIBILIDAD_ETIQUETA[d.visibilidad] || d.visibilidad) + '</span>' : '') +
          '</span>' +
        '</span>' +
      '</button>';
    }).join('');

    cont.innerHTML = cabecera + '<div class="sgc-lista">' + filas + '</div>';
    wire();
  }

  // --- detalle del documento ------------------------------------------------

  function abrirDocumento_(id) {
    documentoActivoId_ = id;
    var cont = panelSgc_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando documento...');
    api_('getDocumentoSgc', { documento_id: id }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo abrir el documento.', 'error');
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarDetalle_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar para abrir el documento.', 'error');
    });
  }

  function pintarDetalle_(cont, data) {
    var d = data.documento;
    var obsoleto = d.estado === 'OBSOLETO';

    var acciones = '<div class="sgc-acciones">' +
      (d.archivo_id ? Componentes.boton({ texto: 'Descargar', icono: 'descargar', clase: 'js-sgc-descargar' }) : '') +
      (puedeGestionar_ ? Componentes.boton({ texto: 'Nueva versión', variante: 'secundario', clase: 'js-sgc-version' }) : '') +
      (puedeGestionar_ ? Componentes.boton({ texto: 'Editar', variante: 'secundario', clase: 'js-sgc-editar' }) : '') +
      (puedeGestionar_ ? Componentes.boton({ texto: 'Ver quién confirmó', variante: 'secundario', clase: 'js-sgc-cumplimiento' }) : '') +
      (puedeGestionar_ && !obsoleto ? Componentes.boton({ texto: 'Marcar obsoleto', variante: 'peligro', clase: 'js-sgc-obsoleto' }) : '') +
      (puedeGestionar_ && obsoleto ? Componentes.boton({ texto: 'Volver a vigente', variante: 'secundario', clase: 'js-sgc-vigente' }) : '') +
      '</div>';

    // v10.0 Fase 1b: la confirmacion de lectura. Se muestra arriba, antes de
    // la ficha, porque es lo unico que esta persona TIENE que hacer aca.
    var bloqueAcuse = '';
    if (data.debo_acusar) {
      var plazo = d.fecha_limite_acuse
        ? ' Plazo: ' + fechaCorta_(d.fecha_limite_acuse) + '.'
        : '';
      bloqueAcuse = '<div class="sgc-acuse sgc-acuse--pendiente">' +
        '<p><b>Debes confirmar que conoces este documento.</b>' + Componentes.escaparHtml(plazo) +
          ' Descárgalo, léelo y marca "Enterado".</p>' +
        Componentes.boton({ texto: '✓ Enterado', clase: 'js-sgc-acusar' }) +
      '</div>';
    } else if (data.mi_acuse) {
      bloqueAcuse = '<div class="sgc-acuse sgc-acuse--hecho">' +
        '<p>✓ Confirmaste este documento (versión ' + Componentes.escaparHtml(d.version_vigente) +
          ') el ' + fechaCorta_(data.mi_acuse) + '.</p>' +
      '</div>';
    }

    var ficha = '<dl class="sgc-ficha">' +
      campoFicha_('Tipo', TIPO_ETIQUETA[d.tipo] || d.tipo) +
      campoFicha_('Versión vigente', d.version_vigente) +
      campoFicha_('Vigente desde', fechaCorta_(d.fecha_vigencia)) +
      // v15.0: control de gestión, no dato de lectura (ver la fila del listado).
      (puedeGestionar_ ? campoFicha_('Próxima revisión', fechaCorta_(d.proxima_revision)) : '') +
      (d.area_id ? campoFicha_('Área', d.area_id) : '') +
      (puedeGestionar_ ? campoFicha_('Visibilidad', VISIBILIDAD_ETIQUETA[d.visibilidad] || d.visibilidad) : '') +
      (d.elaborado_por ? campoFicha_('Elaborado por', d.elaborado_por) : '') +
      (d.revisado_por ? campoFicha_('Revisado por', d.revisado_por) : '') +
      (d.aprobado_por ? campoFicha_('Aprobado por', d.aprobado_por) : '') +
      '</dl>';

    // v10.0 Fase 6b: que clausulas ISO sustenta este documento como
    // evidencia (matriz de cobertura). Se etiqueta aca, en la ficha, porque
    // es donde el Encargado SGC ya esta mirando el documento -- no un paso
    // aparte que nadie recuerda hacer.
    var clausulasTexto = (d.clausulas_iso || []).map(function (c) {
      var cat = (data.catalogo_clausulas || []).filter(function (x) { return x.codigo === c; })[0];
      return cat ? cat.codigo + ' — ' + cat.titulo : c;
    });
    // v15.0: este bloque es trabajo del Encargado (etiquetar evidencia para la
    // matriz de cobertura). A quien sólo consulta le aparecía un "No está
    // etiquetado con ninguna cláusula" con instrucciones para etiquetarlo --
    // una tarea que no puede hacer, sobre un concepto de la norma que no
    // necesita conocer. Si no gestiona y el documento no tiene etiquetas, el
    // bloque no existe; si las tiene, se muestran como referencia sin pedir nada.
    var bloqueClausulas = '';
    if (puedeGestionar_ || clausulasTexto.length) {
      bloqueClausulas = '<h3 class="sgc-sub">Cláusulas ISO que sustenta</h3>' +
        (clausulasTexto.length
          ? '<ul class="sgc-porques">' + clausulasTexto.map(function (t) { return '<li>' + Componentes.escaparHtml(t) + '</li>'; }).join('') + '</ul>'
          : Componentes.vacio({ texto: 'No está etiquetado con ninguna cláusula.', detalle: 'Si este documento es evidencia de una cláusula (por ejemplo, la política de calidad), etiquétalo para que aparezca en la Matriz de cobertura ISO.' })) +
        (puedeGestionar_ ? Componentes.boton({ texto: 'Etiquetar cláusulas', variante: 'sutil', clase: 'js-sgc-doc-clausulas' }) : '');
    }

    var versiones = (data.versiones || []).length
      ? '<h3 class="sgc-sub">Historial de versiones</h3>' +
        '<div class="sgc-lista">' + (data.versiones || []).map(function (v) {
          var esVigente = v.vigente === true || v.vigente === 'TRUE';
          return '<div class="sgc-version">' +
            '<div class="sgc-doc__top">' +
              '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(v.version) + '</span>' +
              (esVigente ? Componentes.badge('Vigente', 'ok') : Componentes.badge('Archivada', 'neutro')) +
              '<span class="sigso-ayuda">' + fechaCorta_(v.fecha) + '</span>' +
            '</div>' +
            (v.cambios ? '<p class="sigso-ayuda">' + Componentes.escaparHtml(v.cambios) + '</p>' : '') +
            (puedeGestionar_ && !esVigente && v.archivo_id
              ? Componentes.boton({ texto: 'Descargar esta versión', variante: 'sutil', clase: 'js-sgc-descargar-version', idx: v.version_id })
              : '') +
          '</div>';
        }).join('') + '</div>'
      : '';

    cont.innerHTML =
      '<div class="sgc-detalle-cab">' +
        Componentes.boton({ texto: '← Documentos', variante: 'sutil', clase: 'js-sgc-volver' }) +
        '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(d.codigo) + '</span>' +
        '<h1>' + Componentes.escaparHtml(d.nombre) + '</h1>' +
        (obsoleto ? Componentes.badge('Obsoleto', 'critico') : '') +
      '</div>' +
      (obsoleto
        ? Componentes.alerta('Este documento está fuera de circulación. Se conserva solo para trazabilidad; no debe usarse.', 'aviso')
        : '') +
      '<div class="sgc-cuerpo">' +
        bloqueAcuse +
        (d.descripcion ? '<p>' + Componentes.escaparHtml(d.descripcion) + '</p>' : '') +
        ficha +
        (d.archivo_nombre ? '<p class="sigso-ayuda">Archivo: ' + Componentes.escaparHtml(d.archivo_nombre) + '</p>' : '') +
        acciones +
        '<div class="js-sgc-cumplimiento-panel"></div>' +
        bloqueClausulas +
        versiones +
      '</div>';

    cont.querySelector('.js-sgc-volver').addEventListener('click', cargarListado_);

    var btnDescargar = cont.querySelector('.js-sgc-descargar');
    if (btnDescargar) btnDescargar.addEventListener('click', function () { descargar_(d.documento_id, null); });

    cont.querySelectorAll('.js-sgc-descargar-version').forEach(function (btn) {
      btn.addEventListener('click', function () { descargar_(d.documento_id, btn.getAttribute('data-idx')); });
    });

    var btnVersion = cont.querySelector('.js-sgc-version');
    if (btnVersion) btnVersion.addEventListener('click', function () { abrirFormularioVersion_(d); });

    var btnEditar = cont.querySelector('.js-sgc-editar');
    if (btnEditar) btnEditar.addEventListener('click', function () { abrirFormularioEditar_(d, data.destinatarios || []); });

    var btnClausulas = cont.querySelector('.js-sgc-doc-clausulas');
    if (btnClausulas) btnClausulas.addEventListener('click', function () { abrirFormularioClausulasDoc_(d, data.catalogo_clausulas || []); });

    var btnObsoleto = cont.querySelector('.js-sgc-obsoleto');
    if (btnObsoleto) btnObsoleto.addEventListener('click', function () {
      Componentes.confirmar({
        titulo: 'Marcar como obsoleto',
        mensaje: 'El documento saldrá de circulación y el personal dejará de verlo. No se elimina: queda archivado para trazabilidad.'
      }).then(function (ok) {
        if (!ok) return;
        cambiarEstado_(d.documento_id, 'OBSOLETO');
      });
    });

    var btnVigente = cont.querySelector('.js-sgc-vigente');
    if (btnVigente) btnVigente.addEventListener('click', function () { cambiarEstado_(d.documento_id, 'VIGENTE'); });

    var btnAcusar = cont.querySelector('.js-sgc-acusar');
    if (btnAcusar) btnAcusar.addEventListener('click', function () {
      btnAcusar.disabled = true;
      api_('acusarDocumentoSgc', { documento_id: d.documento_id }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          btnAcusar.disabled = false;
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo confirmar.', tipo: 'error' });
          return;
        }
        Componentes.aviso({ texto: 'Confirmado. Queda registrado con tu nombre y la fecha.', tipo: 'exito' });
        abrirDocumento_(d.documento_id);
      });
    });

    var btnCumplimiento = cont.querySelector('.js-sgc-cumplimiento');
    if (btnCumplimiento) btnCumplimiento.addEventListener('click', function () {
      var panel = cont.querySelector('.js-sgc-cumplimiento-panel');
      panel.innerHTML = Componentes.cargando('Cargando...');
      api_('getCumplimientoDocumentoSgc', { documento_id: d.documento_id }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          panel.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar.', 'error');
          return;
        }
        pintarCumplimiento_(panel, respuesta.data);
      }).catch(function () {
        panel.innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
      });
    });
  }

  // Quién confirmó y quién falta, de la VERSIÓN VIGENTE. Es lo que el
  // Encargado SGC le muestra al auditor cuando pregunta cómo prueba que su
  // personal conoce el documento.
  function pintarCumplimiento_(panel, c) {
    if (!c.requiere_acuse) {
      panel.innerHTML = '<p class="sigso-ayuda">Este documento no exige confirmación de lectura.</p>';
      return;
    }
    var total = c.confirmados.length + c.pendientes.length;
    panel.innerHTML =
      '<h3 class="sgc-sub">Confirmación de lectura — versión ' + Componentes.escaparHtml(c.version) + '</h3>' +
      '<p class="sigso-ayuda">' + c.confirmados.length + ' de ' + total + ' persona(s) han confirmado' +
        (c.fecha_limite_acuse ? ' · plazo ' + fechaCorta_(c.fecha_limite_acuse) : '') + '.</p>' +
      '<div class="sgc-lista">' +
        (c.pendientes.length
          ? '<div class="sgc-version"><div class="sgc-doc__top">' +
              Componentes.badge('Falta confirmar (' + c.pendientes.length + ')', 'alerta') +
            '</div><p class="sigso-ayuda">' +
              c.pendientes.map(function (e) { return Componentes.escaparHtml(e); }).join(', ') +
            '</p></div>'
          : '') +
        (c.confirmados.length
          ? '<div class="sgc-version"><div class="sgc-doc__top">' +
              Componentes.badge('Confirmado (' + c.confirmados.length + ')', 'ok') +
            '</div>' +
            c.confirmados.map(function (x) {
              return '<p class="sigso-ayuda">' + Componentes.escaparHtml(x.usuario_email) +
                ' — ' + fechaCorta_(x.acusado_en) + '</p>';
            }).join('') +
            '</div>'
          : '') +
      '</div>';
  }

  function campoFicha_(etiqueta, valor) {
    if (valor === undefined || valor === null || valor === '') return '';
    return '<div class="sgc-ficha__campo"><dt>' + Componentes.escaparHtml(etiqueta) + '</dt>' +
      '<dd>' + Componentes.escaparHtml(String(valor)) + '</dd></div>';
  }

  function cambiarEstado_(documentoId, estado) {
    api_('actualizarDocumentoSgc', { documento_id: documentoId, estado: estado }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo actualizar el documento.', tipo: 'error' });
        return;
      }
      abrirDocumento_(documentoId);
    });
  }

  function descargar_(documentoId, versionId) {
    var datos = { documento_id: documentoId };
    if (versionId) datos.version_id = versionId;
    api_('descargarDocumentoSgc', datos).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo descargar el documento.', tipo: 'error' });
        return;
      }
      descargarBase64Sgc_(respuesta.data.contenido_base64, respuesta.data.nombre_archivo, respuesta.data.mime);
    });
  }

  // --- formularios -----------------------------------------------------------

  function camposComunes_(d) {
    d = d || {};
    return Componentes.campoTexto({ id: 'sgc-codigo', label: 'Código', valor: d.codigo, requerido: true, placeholder: 'Ej: DOC-01, PRO-07, FO-PRO-02-01' }) +
      Componentes.campoTexto({ id: 'sgc-nombre', label: 'Nombre', valor: d.nombre, requerido: true, placeholder: 'Ej: Manual de Calidad' }) +
      Componentes.campoTextarea({ id: 'sgc-descripcion', label: 'Descripción (opcional)', valor: d.descripcion }) +
      '<div class="sgc-form-fila">' +
        Componentes.campoSelect({
          id: 'sgc-tipo', label: 'Tipo', valor: d.tipo || 'DOC', placeholder: false,
          opciones: TIPOS.map(function (t) { return { valor: t, texto: TIPO_ETIQUETA[t] }; })
        }) +
        Componentes.campoTexto({ id: 'sgc-area', label: 'Área (opcional)', valor: d.area_id, placeholder: 'Ej: PREVENCION' }) +
      '</div>' +
      Componentes.campoSelect({
        id: 'sgc-visibilidad', label: '¿Quién puede verlo?', valor: d.visibilidad || 'TODOS', placeholder: false,
        opciones: Object.keys(VISIBILIDAD_ETIQUETA).map(function (v) { return { valor: v, texto: VISIBILIDAD_ETIQUETA[v] }; })
      }) +
      Componentes.campoTextarea({
        id: 'sgc-destinatarios', label: 'Correos autorizados (uno por línea)',
        ayuda: 'Solo se usa si elegiste "Personas específicas".'
      }) +
      '<div class="sgc-form-fila">' +
        Componentes.campoTexto({ id: 'sgc-elaborado', label: 'Elaborado por', valor: d.elaborado_por }) +
        Componentes.campoTexto({ id: 'sgc-revisado', label: 'Revisado por', valor: d.revisado_por }) +
        Componentes.campoTexto({ id: 'sgc-aprobado', label: 'Aprobado por', valor: d.aprobado_por }) +
      '</div>' +
      // v10.0 Fase 1b: por defecto SÍ exige confirmación -- es lo que
      // convierte "lo publiqué" en evidencia de que la gente lo conoce.
      '<label class="sigso-campo-check"><input type="checkbox" id="sgc-requiere-acuse"' +
        (d.documento_id && d.requiere_acuse === false ? '' : ' checked') +
        '> Exigir confirmación de lectura ("Enterado")</label>' +
      Componentes.campoTexto({
        id: 'sgc-limite-acuse', label: 'Plazo para confirmar (opcional)', tipo: 'date',
        valor: fechaISO_(d.fecha_limite_acuse)
      });
  }

  function leerAcuse_() {
    var chk = document.getElementById('sgc-requiere-acuse');
    var limite = document.getElementById('sgc-limite-acuse');
    return {
      requiere_acuse: chk ? chk.checked : true,
      fecha_limite_acuse: limite ? limite.value : ''
    };
  }

  function leerDestinatarios_() {
    var el = document.getElementById('sgc-destinatarios');
    if (!el) return [];
    return el.value.split(/[\n,;]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function abrirFormularioNuevo_() {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Cargar documento del SGC</h3>' +
        '<p class="sigso-ayuda">Sube el archivo que ya tienes (PDF, Word o Excel) y registra su control documental.</p>' +
        '<form id="form-sgc-nuevo">' +
          camposComunes_(null) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-version', label: 'Versión', valor: 'v01', requerido: true }) +
            Componentes.campoTexto({ id: 'sgc-vigencia', label: 'Vigente desde', tipo: 'date', requerido: true }) +
          '</div>' +
          '<div class="sgc-form-fila" id="sgc-campos-externo">' +
            Componentes.campoTexto({ id: 'sgc-emisor', label: 'Emisor (solo documentos externos)',
              valor: '', placeholder: 'Ej: ISO, Ministerio del Trabajo' }) +
            Componentes.campoTexto({ id: 'sgc-clase-externa', label: 'Clase (solo documentos externos)',
              valor: '', placeholder: 'Ej: Norma, Decreto, Ley, Código' }) +
          '</div>' +
          '<div class="sigso-campo">' +
            '<label for="sgc-archivo">Archivo (PDF, Word o Excel · máx. 10 MB)</label>' +
            '<input type="file" id="sgc-archivo" accept=".pdf,.doc,.docx,.xls,.xlsx">' +
            '<p class="sigso-ayuda">Obligatorio salvo para un documento externo: nadie sube el texto de una ley al repositorio.</p>' +
          '</div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Cargar documento', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    // v11.0 Fase 5: en un documento EXTERNO no aplican ni la version ni la
    // fecha de vigencia -- una ley no tiene "v01", y su edicion ya viaja en
    // el codigo (ISO 9001:2015). Dejarlos obligatorios obligaria a inventar
    // datos para poder guardar.
    function ajustarCamposPorTipo_() {
      var externo = document.getElementById('sgc-tipo').value === 'EXTERNO';
      [['sgc-version', !externo], ['sgc-vigencia', !externo]].forEach(function (par) {
        var el = document.getElementById(par[0]);
        if (el) el.required = par[1];
      });
      var caja = document.getElementById('sgc-campos-externo');
      if (caja) caja.style.display = externo ? '' : 'none';
    }
    document.getElementById('sgc-tipo').addEventListener('change', ajustarCamposPorTipo_);
    ajustarCamposPorTipo_();

    document.getElementById('form-sgc-nuevo').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var archivo = document.getElementById('sgc-archivo').files[0];
      var esExterno = document.getElementById('sgc-tipo').value === 'EXTERNO';
      // De un documento externo la organizacion no controla la version:
      // lo identifica y controla su distribucion (§7.5.3.2). Casi nunca
      // hay un archivo que subir.
      if (!archivo && !esExterno) {
        Componentes.aviso({ texto: 'Selecciona el archivo del documento.', tipo: 'error' });
        return;
      }
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true; boton.textContent = 'Subiendo...';

      var lectura = archivo ? leerArchivoBase64Sgc_(archivo) : Promise.resolve('');
      lectura.then(function (base64) {
        var acuse = leerAcuse_();
        return api_('crearDocumentoSgc', {
          codigo: document.getElementById('sgc-codigo').value,
          nombre: document.getElementById('sgc-nombre').value,
          descripcion: document.getElementById('sgc-descripcion').value,
          tipo: document.getElementById('sgc-tipo').value,
          area_id: document.getElementById('sgc-area').value,
          visibilidad: document.getElementById('sgc-visibilidad').value,
          destinatarios: leerDestinatarios_(),
          version_vigente: document.getElementById('sgc-version').value,
          fecha_vigencia: document.getElementById('sgc-vigencia').value,
          elaborado_por: document.getElementById('sgc-elaborado').value,
          revisado_por: document.getElementById('sgc-revisado').value,
          aprobado_por: document.getElementById('sgc-aprobado').value,
          requiere_acuse: acuse.requiere_acuse,
          fecha_limite_acuse: acuse.fecha_limite_acuse,
          emisor: document.getElementById('sgc-emisor').value,
          clase_externa: document.getElementById('sgc-clase-externa').value,
          nombre_archivo: archivo ? archivo.name : '',
          contenido_base64: base64
        });
      }).then(function (respuesta) {
        boton.disabled = false; boton.textContent = 'Cargar documento';
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo cargar el documento.', tipo: 'error' });
          return;
        }
        cerrar();
        cargarListado_();
      }).catch(function (err) {
        boton.disabled = false; boton.textContent = 'Cargar documento';
        Componentes.aviso({ texto: mensajeErrorSubidaSgc_(err), tipo: 'error' });
      });
    });
  }

  function abrirFormularioVersion_(d) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Nueva versión de ' + Componentes.escaparHtml(d.codigo) + '</h3>' +
        '<p class="sigso-ayuda">La versión ' + Componentes.escaparHtml(d.version_vigente) +
          ' quedará archivada (no se elimina) y esta pasará a ser la vigente.</p>' +
        '<form id="form-sgc-version">' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-v-version', label: 'Nueva versión', requerido: true, placeholder: 'Ej: v02' }) +
            Componentes.campoTexto({ id: 'sgc-v-vigencia', label: 'Vigente desde', tipo: 'date', requerido: true }) +
          '</div>' +
          Componentes.campoTextarea({ id: 'sgc-v-cambios', label: 'Descripción del cambio', requerido: true, placeholder: '¿Qué cambió respecto de la versión anterior?' }) +
          '<div class="sigso-campo">' +
            '<label for="sgc-v-archivo">Archivo de la nueva versión</label>' +
            '<input type="file" id="sgc-v-archivo" accept=".pdf,.doc,.docx,.xls,.xlsx" required>' +
          '</div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Subir versión', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-sgc-version').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var archivo = document.getElementById('sgc-v-archivo').files[0];
      if (!archivo) return;
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true; boton.textContent = 'Subiendo...';

      var lectura = archivo ? leerArchivoBase64Sgc_(archivo) : Promise.resolve('');
      lectura.then(function (base64) {
        return api_('nuevaVersionDocumentoSgc', {
          documento_id: d.documento_id,
          version: document.getElementById('sgc-v-version').value,
          fecha_vigencia: document.getElementById('sgc-v-vigencia').value,
          cambios: document.getElementById('sgc-v-cambios').value,
          emisor: document.getElementById('sgc-emisor').value,
          clase_externa: document.getElementById('sgc-clase-externa').value,
          nombre_archivo: archivo ? archivo.name : '',
          contenido_base64: base64
        });
      }).then(function (respuesta) {
        boton.disabled = false; boton.textContent = 'Subir versión';
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo subir la nueva versión.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirDocumento_(d.documento_id);
      }).catch(function (err) {
        boton.disabled = false; boton.textContent = 'Subir versión';
        Componentes.aviso({ texto: mensajeErrorSubidaSgc_(err), tipo: 'error' });
      });
    });
  }

  function abrirFormularioEditar_(d, destinatarios) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Editar ' + Componentes.escaparHtml(d.codigo) + '</h3>' +
        '<form id="form-sgc-editar">' +
          camposComunes_(d) +
          Componentes.campoTexto({ id: 'sgc-vigencia-ed', label: 'Vigente desde', tipo: 'date', valor: fechaISO_(d.fecha_vigencia) }) +
          // Un documento puede existir sin archivo (asi entra la carga
          // inicial del listado maestro): aca es donde se le adjunta, sin
          // tener que inventar una version nueva.
          '<div class="sigso-campo">' +
            '<label for="sgc-archivo-ed">' +
              (d.archivo_id ? 'Reemplazar el archivo (opcional)' : 'Adjuntar el archivo') +
            '</label>' +
            '<input type="file" id="sgc-archivo-ed" accept=".pdf,.doc,.docx,.xls,.xlsx">' +
            '<p class="sigso-ayuda">' +
              (d.archivo_id
                ? 'Actual: ' + Componentes.escaparHtml(d.archivo_nombre || 'sin nombre') +
                  '. Déjalo vacío para no cambiarlo. Si alguien ya confirmó esta versión, usa "Nueva versión".'
                : 'Este documento todavía no tiene archivo: sin él, el personal no puede consultarlo. ' +
                  'PDF, Word o Excel · máx. 10 MB.') +
            '</p>' +
          '</div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    // El codigo identifica al documento en el listado maestro: cambiarlo
    // despues de creado confunde la trazabilidad, asi que se muestra pero
    // no se edita.
    document.getElementById('sgc-codigo').readOnly = true;
    document.getElementById('sgc-destinatarios').value = (destinatarios || []).join('\n');

    document.getElementById('form-sgc-editar').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var acuseEd = leerAcuse_();
      var archivoEd = document.getElementById('sgc-archivo-ed').files[0];
      var boton = fondo.querySelector('button[type="submit"]');
      var etiqueta = boton ? boton.textContent : '';
      if (boton && archivoEd) { boton.disabled = true; boton.textContent = 'Subiendo...'; }

      // Sin archivo nuevo no se toca el que ya esta: el backend solo lo
      // reemplaza si le llega contenido_base64.
      var leerlo = archivoEd ? leerArchivoBase64Sgc_(archivoEd) : Promise.resolve(null);

      leerlo.then(function (base64) {
        var datos = {
          documento_id: d.documento_id,
          nombre: document.getElementById('sgc-nombre').value,
          descripcion: document.getElementById('sgc-descripcion').value,
          tipo: document.getElementById('sgc-tipo').value,
          area_id: document.getElementById('sgc-area').value,
          visibilidad: document.getElementById('sgc-visibilidad').value,
          destinatarios: leerDestinatarios_(),
          fecha_vigencia: document.getElementById('sgc-vigencia-ed').value,
          elaborado_por: document.getElementById('sgc-elaborado').value,
          revisado_por: document.getElementById('sgc-revisado').value,
          aprobado_por: document.getElementById('sgc-aprobado').value,
          requiere_acuse: acuseEd.requiere_acuse,
          fecha_limite_acuse: acuseEd.fecha_limite_acuse
        };
        if (base64) {
          datos.nombre_archivo = archivoEd.name;
          datos.contenido_base64 = base64;
        }
        return api_('actualizarDocumentoSgc', datos);
      }).then(function (respuesta) {
        if (boton) { boton.disabled = false; boton.textContent = etiqueta; }
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        if (archivoEd) Componentes.aviso({ texto: 'Documento actualizado con su archivo.', tipo: 'exito' });
        abrirDocumento_(d.documento_id);
      }).catch(function (err) {
        if (boton) { boton.disabled = false; boton.textContent = etiqueta; }
        Componentes.aviso({ texto: mensajeErrorSubidaSgc_(err), tipo: 'error' });
      });
    });
  }

  // v10.0 Fase 6b: etiquetar con que clausulas ISO este documento es
  // evidencia (matriz de cobertura). Aparte de "Editar" porque es una
  // decision distinta: no cambia el documento, solo dice donde encaja en la
  // norma.
  function abrirFormularioClausulasDoc_(d, catalogo) {
    var seleccionadas = {};
    (d.clausulas_iso || []).forEach(function (c) { seleccionadas[c] = true; });

    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Cláusulas ISO que sustenta ' + Componentes.escaparHtml(d.codigo) + '</h3>' +
        '<p class="sigso-ayuda">Marca las cláusulas para las que este documento es evidencia (por ejemplo, la política de calidad para 5.2). ' +
          'Solo aparecen en la Matriz de cobertura ISO los documentos etiquetados aquí — el sistema no lo adivina por el nombre.</p>' +
        '<form id="form-sgc-doc-clausulas">' +
          '<fieldset class="sgc-clausulas"><legend>Cláusulas de la norma</legend>' +
            catalogo.map(function (c) {
              return '<label class="sigso-campo-check">' +
                '<input type="checkbox" value="' + Componentes.escaparHtml(c.codigo) + '"' +
                  (seleccionadas[c.codigo] ? ' checked' : '') + '> ' +
                Componentes.escaparHtml(c.codigo) + ' — ' + Componentes.escaparHtml(c.titulo) +
              '</label>';
            }).join('') +
          '</fieldset>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-sgc-doc-clausulas').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var elegidas = Array.prototype.slice.call(fondo.querySelectorAll('input[type="checkbox"]:checked'))
        .map(function (chk) { return chk.value; });
      api_('actualizarDocumentoSgc', { documento_id: d.documento_id, clausulas_iso: elegidas }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirDocumento_(d.documento_id);
      });
    });
  }

  // ==========================================================================
  // PERSONAS (Fase 2a, PRO-02) — la ficha del trabajador
  //
  // Recordatorio de diseño: el backend ya decide QUÉ fichas ve cada quien
  // (el personal operativo, solo la suya). Acá nunca se filtra por permiso.
  // ==========================================================================

  var TIPO_PERSONA_ETIQUETA = { INT: 'Interno', EXT: 'Externo' };
  var TIPO_DOC_PERSONA_ETIQUETA = {
    CV: 'CV', TITULO: 'Título / diploma', ISO9001: 'Curso ISO 9001',
    CONTRATO: 'Contrato o anexo', CERTIFICADO: 'Certificado de capacitación', OTRO: 'Otro'
  };

  var filtroPersonasArea_ = '';
  var incluirDesvinculados_ = false;
  var incluirFueraAlcance_ = false;

  function cargarPersonas_() {
    personaActivaId_ = null;
    var filtros = {};
    if (filtroPersonasArea_) filtros.area_id = filtroPersonasArea_;
    if (incluirDesvinculados_) filtros.incluir_desvinculados = true;
    if (incluirFueraAlcance_) filtros.incluir_fuera_alcance = true;
    cargarListadoSgc_({
      clave: 'personas', accion: 'listarPersonasSgc', datos: filtros,
      spinner: 'Cargando personal...',
      sigo: function () { return seccionActiva_ === 'personas' && !personaActivaId_; },
      aplicar: function (cont, data) {
        puedeGestionar_ = data.puede_gestionar === true;
        cacheListadoSgc_.personas = data;
        pintarPersonas_(cont, data);
      },
      error: function (cont, msg) {
        cont.innerHTML = Componentes.alerta(msg || 'No se pudo conectar para cargar el personal.', 'error');
      }
    });
  }

  function pintarPersonas_(cont, data) {
    var personas = data.personas || [];

    // El personal operativo solo se ve a sí mismo: mostrarle un "listado"
    // de una fila es ruido. Se entra directo a su ficha.
    if (!puedeGestionar_ && personas.length === 1) {
      // v15.0: y en ese caso NO hay listado al que volver. Antes se dibujaba
      // igual el botón "← Personal": al pulsarlo se recargaba el listado de
      // una fila, que volvía a redirigir a esta misma ficha. Un control
      // visible que no lleva a ninguna parte -- se oculta.
      fichaSinListado_ = true;
      personaActivaId_ = personas[0].persona_id;
      abrirPersona_(personas[0].persona_id);
      return;
    }
    fichaSinListado_ = false;

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Personal en alcance del SGC: su ficha, descriptor de cargo, documentos e inducción.</p>' +
      (puedeGestionar_ ? Componentes.boton({ texto: '+ Nueva persona', clase: 'js-sgc-nueva-persona' }) : '') +
      '</div>' +
      (puedeGestionar_
        ? '<div class="sgc-filtros">' +
            Componentes.campoTexto({ id: 'sgc-p-area', label: false, valor: filtroPersonasArea_, placeholder: 'Filtrar por área...' }) +
            '<label class="sigso-campo-check"><input type="checkbox" id="sgc-p-desv"' +
              (incluirDesvinculados_ ? ' checked' : '') + '> Incluir desvinculados</label>' +
            '<label class="sigso-campo-check"><input type="checkbox" id="sgc-p-fuera"' +
              (incluirFueraAlcance_ ? ' checked' : '') + '> Incluir fuera de alcance</label>' +
          '</div>'
        : '');

    function wire() {
      wireSecciones_(cont);
      var nueva = cont.querySelector('.js-sgc-nueva-persona');
      if (nueva) nueva.addEventListener('click', function () { abrirFormularioPersona_(null); });
      var area = cont.querySelector('#sgc-p-area');
      if (area) {
        area.addEventListener('change', function () { filtroPersonasArea_ = this.value; cargarPersonas_(); });
        area.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); filtroPersonasArea_ = this.value; cargarPersonas_(); }
        });
      }
      var desv = cont.querySelector('#sgc-p-desv');
      if (desv) desv.addEventListener('change', function () { incluirDesvinculados_ = this.checked; cargarPersonas_(); });
      var fuera = cont.querySelector('#sgc-p-fuera');
      if (fuera) fuera.addEventListener('change', function () { incluirFueraAlcance_ = this.checked; cargarPersonas_(); });
      cont.querySelectorAll('.js-sgc-abrir-persona').forEach(function (btn) {
        btn.addEventListener('click', function () { abrirPersona_(btn.getAttribute('data-id')); });
      });
      // Fuera de alcance no tiene ficha que abrir (quedó inactiva a
      // proposito -- ver quitarDelAlcance); el unico camino de vuelta es
      // reincluirla desde aca mismo.
      cont.querySelectorAll('.js-sgc-reincluir-alcance').forEach(function (btn) {
        btn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var id = btn.getAttribute('data-id');
          var nombre = btn.getAttribute('data-nombre');
          Componentes.confirmar({
            titulo: 'Reincluir en el alcance del SGC',
            mensaje: nombre + ' volverá a aparecer como personal vigente del SGC.'
          }).then(function (ok) {
            if (!ok) return;
            api_('quitarPersonaAlcanceSgc', { persona_id: id, reactivar: true }).then(function (r) {
              if (!r || !r.ok) {
                Componentes.aviso({ texto: (r && r.message) || 'No se pudo reincluir.', tipo: 'error' });
                return;
              }
              cargarPersonas_();
            });
          });
        });
      });
    }

    if (personas.length === 0) {
      cont.innerHTML = cabecera + Componentes.vacio({
        texto: 'Todavía no hay personal registrado.',
        detalle: puedeGestionar_ ? 'Agrega a las personas en alcance del SGC.' : ''
      });
      wire();
      return;
    }

    var filas = personas.map(function (p) {
      var baja = p.estado === 'DESVINCULADO';
      var induccionCompleta = p.induccion_total > 0 && p.induccion_completadas >= p.induccion_total;
      // Fuera de alcance no tiene ficha que abrir (quedó inactiva a
      // proposito): es una etiqueta, no un boton, y su unica accion es
      // reincluir. El resto de las tarjetas sigue igual que siempre.
      if (p.fuera_de_alcance) {
        return '<div class="sgc-doc sgc-doc--obsoleto">' +
          '<div class="sgc-doc__top">' +
            '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(p.nombre) + '</span>' +
            Componentes.badge(TIPO_PERSONA_ETIQUETA[p.tipo] || p.tipo, 'neutro') +
            Componentes.badge('Fuera de alcance', 'critico') +
          '</div>' +
          '<div class="sgc-doc__meta">' +
            (p.cargo ? '<span>' + Componentes.escaparHtml(p.cargo) + '</span>' : '') +
            (p.area_id ? '<span>' + Componentes.escaparHtml(p.area_id) + '</span>' : '') +
          '</div>' +
          '<div class="sgc-acciones">' +
            '<button type="button" class="sigso-boton sigso-boton--sutil js-sgc-reincluir-alcance" ' +
              'data-id="' + Componentes.escaparHtml(p.persona_id) + '" data-nombre="' + Componentes.escaparHtml(p.nombre) + '">' +
              'Reincluir en el SGC</button>' +
          '</div>' +
        '</div>';
      }
      return '<button type="button" class="sgc-doc js-sgc-abrir-persona' + (baja ? ' sgc-doc--obsoleto' : '') +
        '" data-id="' + p.persona_id + '">' +
        '<div class="sgc-doc__top">' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(p.nombre) + '</span>' +
          Componentes.badge(TIPO_PERSONA_ETIQUETA[p.tipo] || p.tipo, 'neutro') +
          (baja ? Componentes.badge('Desvinculado', 'critico') : '') +
          (!baja && !p.tiene_descriptor ? Componentes.badge('Sin descriptor', 'alerta') : '') +
          (!baja && !induccionCompleta ? Componentes.badge('Inducción pendiente', 'alerta') : '') +
        '</div>' +
        // v14.0: el correo visible en cada tarjeta -- con dos cargos bajo
        // la misma cuenta (ej. Camila interna/externa), es lo que confirma
        // de un vistazo que ambas fichas comparten cuenta.
        (p.usuario_email ? '<div class="sigso-ayuda">' + Componentes.escaparHtml(p.usuario_email) + '</div>' : '') +
        '<div class="sgc-doc__meta">' +
          (p.cargo ? '<span>' + Componentes.escaparHtml(p.cargo) + '</span>' : '') +
          (p.area_id ? '<span>' + Componentes.escaparHtml(p.area_id) + '</span>' : '') +
          (p.fecha_ingreso ? '<span>Ingreso ' + fechaCorta_(p.fecha_ingreso) + '</span>' : '') +
          '<span>Inducción ' + p.induccion_completadas + '/' + p.induccion_total + '</span>' +
        '</div>' +
      '</button>';
    }).join('');

    cont.innerHTML = cabecera + '<div class="sgc-lista">' + filas + '</div>';
    wire();
  }

  // --- ficha de la persona ---------------------------------------------------

  function abrirPersona_(id) {
    personaActivaId_ = id;
    var cont = panelSgc_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando ficha...');
    api_('getFichaPersonaSgc', { persona_id: id }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo abrir la ficha.', 'error');
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarFicha_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar para abrir la ficha.', 'error');
    });
  }

  function pintarFicha_(cont, data) {
    var p = data.persona;
    var baja = p.estado === 'DESVINCULADO';
    var PESTANAS = [
      { id: 'datos', texto: 'Datos' },
      { id: 'descriptor', texto: 'Descriptor de cargo' },
      { id: 'documentos', texto: 'Documentos' },
      { id: 'induccion', texto: 'Inducción' },
      { id: 'competencias', texto: 'Competencias' }
    ];
    var tabs = PESTANAS.map(function (t) {
      return '<button type="button" class="sigso-tab js-sgc-ficha-tab' +
        (t.id === pestanaFicha_ ? ' sigso-tab--activo' : '') + '" data-tab="' + t.id + '">' + t.texto + '</button>';
    }).join('');

    var cuerpo = '';
    if (pestanaFicha_ === 'datos') cuerpo = pintarDatosPersona_(data);
    else if (pestanaFicha_ === 'descriptor') cuerpo = pintarDescriptor_(data);
    else if (pestanaFicha_ === 'documentos') cuerpo = pintarDocsPersona_(data);
    else if (pestanaFicha_ === 'induccion') cuerpo = pintarInduccion_(data);
    else if (pestanaFicha_ === 'competencias') cuerpo = pintarCompetencias_(data);

    cont.innerHTML =
      '<div class="sgc-detalle-cab">' +
        (fichaSinListado_
          ? ''
          : Componentes.boton({ texto: '← Personal', variante: 'sutil', clase: 'js-sgc-volver-personas' })) +
        '<h1>' + Componentes.escaparHtml(p.nombre) + '</h1>' +
        Componentes.badge(TIPO_PERSONA_ETIQUETA[p.tipo] || p.tipo, 'neutro') +
        (baja ? Componentes.badge('Desvinculado', 'critico') : '') +
      '</div>' +
      // v14.0: cargo como subtitulo justo bajo el nombre -- una persona
      // puede tener mas de una ficha bajo el mismo correo (dos cargos), y
      // sin esto dos fichas de "Camila Peña" se ven identicas hasta que se
      // lee el detalle de "Datos". El cargo es el diferenciador principal.
      (p.cargo ? '<p class="sgc-detalle-subtitulo">' + Componentes.escaparHtml(p.cargo) + '</p>' : '') +
      (baja
        ? Componentes.alerta('Esta persona ya no está vigente. Su ficha se conserva como historial del SGC.', 'aviso')
        : '') +
      '<div class="sigso-tabs">' + tabs + '</div>' +
      '<div class="sgc-cuerpo">' + cuerpo + '</div>';

    var volverPersonas = cont.querySelector('.js-sgc-volver-personas');
    if (volverPersonas) volverPersonas.addEventListener('click', cargarPersonas_);
    cont.querySelectorAll('.js-sgc-ficha-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        pestanaFicha_ = btn.getAttribute('data-tab');
        pintarFicha_(cont, data);
      });
    });
    wireFicha_(cont, data);
  }

  function pintarDatosPersona_(data) {
    var p = data.persona;
    var acciones = puedeGestionar_
      ? '<div class="sgc-acciones">' +
          Componentes.boton({ texto: 'Editar datos', variante: 'secundario', clase: 'js-sgc-editar-persona' }) +
          (p.estado === 'DESVINCULADO'
            ? Componentes.boton({ texto: 'Reactivar', variante: 'secundario', clase: 'js-sgc-reactivar' })
            : Componentes.boton({ texto: 'Desvincular', variante: 'peligro', clase: 'js-sgc-desvincular' })) +
          // v14.0: quitar del alcance es DISTINTO de desvincular -- es para
          // corregir a alguien que nunca debió estar aquí (ej. una carga
          // masiva con personal de mas), no una salida real de la empresa.
          Componentes.boton({ texto: 'Quitar del alcance del SGC', variante: 'sutil', clase: 'js-sgc-quitar-alcance' }) +
        '</div>'
      : '';
    return '<dl class="sgc-ficha">' +
      campoFicha_('Correo', p.usuario_email) +
      campoFicha_('RUT', p.rut) +
      campoFicha_('Cargo', p.cargo) +
      campoFicha_('Tipo', TIPO_PERSONA_ETIQUETA[p.tipo] || p.tipo) +
      campoFicha_('Área', p.area_id) +
      campoFicha_('Jefatura directa', p.jefatura_email) +
      campoFicha_('Subrogante', p.subrogante_email) +
      campoFicha_('Fecha de ingreso', p.fecha_ingreso ? fechaCorta_(p.fecha_ingreso) : '') +
      (p.estado === 'DESVINCULADO' ? campoFicha_('Desvinculación', fechaCorta_(p.fecha_desvinculacion)) : '') +
    '</dl>' + acciones;
  }

  function pintarDescriptor_(data) {
    var d = data.descriptor_vigente;
    var acciones = puedeGestionar_
      ? '<div class="sgc-acciones">' +
          (d ? Componentes.boton({ texto: 'Editar', variante: 'sutil', clase: 'js-sgc-descriptor-editar' }) : '') +
          Componentes.boton({ texto: d ? 'Nueva versión del descriptor' : '+ Crear descriptor', variante: d ? 'sutil' : undefined, clase: 'js-sgc-descriptor' }) +
          (d && d.archivo_id ? Componentes.boton({ texto: 'Descargar archivo', icono: 'descargar', variante: 'sutil', clase: 'js-sgc-descriptor-bajar' }) : '') +
        '</div>'
      : '';
    if (!d) {
      return Componentes.vacio({
        texto: 'Esta persona todavía no tiene descriptor de cargo.',
        detalle: 'El descriptor (FO-PRO-02-01) define qué se espera del cargo: es la base para evaluar competencia.'
      }) + acciones;
    }
    var historial = (data.descriptores || []).length > 1
      ? '<h3 class="sgc-sub">Versiones anteriores</h3><div class="sgc-lista">' +
        (data.descriptores || []).filter(function (x) { return !(x.vigente === true || x.vigente === 'TRUE'); })
          .map(function (x) {
            return '<div class="sgc-version"><div class="sgc-doc__top">' +
              '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(x.version) + '</span>' +
              Componentes.badge('Archivada', 'neutro') +
              '<span class="sigso-ayuda">' + fechaCorta_(x.fecha) + '</span>' +
            '</div></div>';
          }).join('') + '</div>'
      : '';
    return '<div class="sgc-doc__top" style="margin-bottom:.8rem">' +
        '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(d.version) + '</span>' +
        Componentes.badge('Vigente', 'ok') +
        '<span class="sigso-ayuda">' + fechaCorta_(d.fecha) + '</span>' +
      '</div>' +
      '<dl class="sgc-ficha">' +
        campoFicha_('Objetivo del cargo', d.objetivo) +
        campoFicha_('Funciones', d.funciones) +
        campoFicha_('Responsabilidades', d.responsabilidades) +
        campoFicha_('Habilidades requeridas', d.habilidades) +
        campoFicha_('Nivel educacional', d.nivel_educacional) +
        campoFicha_('Formación técnica', d.formacion_tecnica) +
        campoFicha_('Experiencia requerida', d.experiencia) +
      '</dl>' +
      itemsDescriptorHtml_('Se califican en la evaluación (responsabilidades)', d.items_responsabilidades) +
      itemsDescriptorHtml_('Se califican en la evaluación (habilidades)', d.items_habilidades) +
      acciones + historial;
  }

  function itemsDescriptorHtml_(titulo, items) {
    if (!items || !items.length) return '';
    return '<h3 class="sgc-sub">' + Componentes.escaparHtml(titulo) + '</h3>' +
      '<ol class="sgc-porques">' + items.map(function (i) {
        return '<li>' + Componentes.escaparHtml(i) + '</li>';
      }).join('') + '</ol>';
  }

  function pintarDocsPersona_(data) {
    var docs = data.documentos || [];
    var acciones = puedeGestionar_
      ? '<div class="sgc-cabecera">' + Componentes.boton({ texto: '+ Cargar documento', clase: 'js-sgc-doc-persona' }) + '</div>'
      : '';
    if (docs.length === 0) {
      return acciones + Componentes.vacio({ texto: 'Sin documentos cargados.', detalle: 'CV, título, contrato, certificados.' });
    }
    return acciones + '<div class="sgc-lista">' + docs.map(function (x) {
      return '<div class="sgc-version">' +
        '<div class="sgc-doc__top">' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(x.nombre || x.archivo_nombre) + '</span>' +
          Componentes.badge(TIPO_DOC_PERSONA_ETIQUETA[x.tipo] || x.tipo, 'neutro') +
          '<span class="sigso-ayuda">' + fechaCorta_(x.fecha) + '</span>' +
        '</div>' +
        '<div class="sgc-acciones">' +
          Componentes.boton({ texto: 'Descargar', icono: 'descargar', variante: 'sutil', clase: 'js-sgc-bajar-doc', idx: x.doc_id }) +
          (puedeGestionar_ ? Componentes.boton({ texto: 'Quitar', variante: 'sutil', clase: 'js-sgc-quitar-doc', idx: x.doc_id }) : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function pintarInduccion_(data) {
    var items = data.induccion || [];
    var completadas = items.filter(function (i) { return i.estado === 'COMPLETADA'; }).length;
    if (items.length === 0) return Componentes.vacio({ texto: 'Sin registro de inducción.' });
    return '<p class="sigso-ayuda">Inducción al SGC (FO-PRO-02-02): ' + completadas + ' de ' + items.length + ' completadas.</p>' +
      '<div class="sgc-lista">' + items.map(function (i) {
        var hecha = i.estado === 'COMPLETADA';
        return '<div class="sgc-version">' +
          '<div class="sgc-doc__top">' +
            '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(i.item) + '</span>' +
            (hecha ? Componentes.badge('Completada', 'ok') : Componentes.badge('Pendiente', 'alerta')) +
            (hecha && i.fecha ? '<span class="sigso-ayuda">' + fechaCorta_(i.fecha) + '</span>' : '') +
          '</div>' +
          (hecha && i.relator_email ? '<p class="sigso-ayuda">Relator: ' + Componentes.escaparHtml(i.relator_email) + '</p>' : '') +
          (data.puede_gestionar_induccion && !hecha
            ? Componentes.boton({ texto: '✓ Marcar completada', variante: 'sutil', clase: 'js-sgc-induccion', idx: i.induccion_id })
            : '') +
        '</div>';
      }).join('') + '</div>';
  }

  // --- competencias (Fase 2b) -------------------------------------------------

  function pintarCompetencias_(data) {
    var ultima = data.ultima_evaluacion;
    var acciones = data.puede_evaluar
      ? '<div class="sgc-acciones">' +
          Componentes.boton({ texto: ultima ? 'Nueva evaluación' : '+ Registrar evaluación', clase: 'js-sgc-evaluar' }) +
        '</div>'
      : '';

    // Horas de formación del año: es el Objetivo de Calidad N°4, y a la
    // persona le sirve verlo aunque no pueda evaluarse a sí misma.
    var cumple = data.horas_formacion_anio >= data.meta_horas_formacion;
    var horas = '<div class="sgc-acuse ' + (cumple ? 'sgc-acuse--hecho' : 'sgc-acuse--pendiente') + '">' +
      '<p><b>Formación este año: ' + data.horas_formacion_anio + ' de ' + data.meta_horas_formacion + ' horas.</b> ' +
      (cumple ? 'Cumple la meta anual.' : 'Bajo la meta del Objetivo de Calidad N°4.') + '</p>' +
    '</div>';

    if (!ultima) {
      return horas + Componentes.vacio({
        texto: 'Esta persona todavía no tiene evaluación de competencias.',
        detalle: 'La evaluación (FO-PRO-02-04) se hace cada 12 meses y la registra la jefatura directa.'
      }) + acciones;
    }

    var vencida = data.evaluacion_vencida;
    var historial = (data.evaluaciones || []).map(function (e) {
      var bajo = e.requiere_capacitacion === true || e.requiere_capacitacion === 'TRUE';
      return '<div class="sgc-version">' +
        '<div class="sgc-doc__top">' +
          '<span class="sgc-doc__codigo">Resp. ' + e.promedio_responsabilidades + ' · Hab. ' + e.promedio_habilidades + '</span>' +
          (bajo ? Componentes.badge('Requiere capacitación', 'alerta') : Componentes.badge('Conforme', 'ok')) +
          '<span class="sigso-ayuda">' + fechaCorta_(e.fecha) + '</span>' +
        '</div>' +
        '<p class="sigso-ayuda">Evaluó: ' + Componentes.escaparHtml(e.evaluador_email) +
          (e.proxima_evaluacion ? ' · próxima ' + fechaCorta_(e.proxima_evaluacion) : '') + '</p>' +
        (e.observaciones ? '<p>' + Componentes.escaparHtml(e.observaciones) + '</p>' : '') +
        (e.recomendado_por ? '<p class="sigso-ayuda">Recomienda capacitación: ' + Componentes.escaparHtml(e.recomendado_por) + '</p>' : '') +
      '</div>';
    }).join('');

    return horas +
      (vencida ? Componentes.alerta('La evaluación de competencias está vencida (se hace cada 12 meses).', 'aviso') : '') +
      acciones +
      '<h3 class="sgc-sub">Historial de evaluaciones</h3>' +
      '<div class="sgc-lista">' + historial + '</div>';
  }

  // v10.0 Tanda A: los items salen del descriptor VIGENTE de la persona
  // (FO-PRO-02-04 "segun descriptor de cargo"), no de una lista fija. Se
  // califican DOS bloques por separado -- responsabilidades y habilidades
  // -- cada uno con su propio promedio, como el formulario real.
  function abrirFormularioEvaluacion_(p, itemsResp, itemsHab, escala) {
    if (!itemsResp.length || !itemsHab.length) {
      Componentes.aviso({
        texto: 'Esta persona no tiene un descriptor de cargo con responsabilidades y habilidades cargadas como lista.',
        detalle: 'Completa esa parte del descriptor antes de evaluar.', tipo: 'error'
      });
      return;
    }
    var opciones = (escala || []).map(function (e) {
      return { valor: String(e.valor), texto: e.valor + ' — ' + e.texto };
    });
    function bloque(titulo, subtitulo, items, prefijo) {
      return '<h4 class="sgc-sub">' + Componentes.escaparHtml(titulo) + '</h4>' +
        '<p class="sigso-ayuda">' + Componentes.escaparHtml(subtitulo) + '</p>' +
        items.map(function (texto, i) {
          return Componentes.campoSelect({
            id: 'sgc-ev-' + prefijo + '-' + i, label: texto, valor: '3', placeholder: false, opciones: opciones
          });
        }).join('');
    }

    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Evaluación de competencias — ' + Componentes.escaparHtml(p.nombre) + '</h3>' +
        '<p class="sigso-ayuda">El promedio de cada bloque y la necesidad de capacitación los calcula el sistema.</p>' +
        '<form id="form-sgc-evaluacion">' +
          bloque('2.- Principales responsabilidades', 'Según el descriptor de cargo vigente.', itemsResp, 'r') +
          bloque('3.- Responsabilidades secundarias / habilidades', '', itemsHab, 'h') +
          Componentes.campoTextarea({ id: 'sgc-ev-obs', label: 'Observaciones' }) +
          Componentes.campoTexto({
            id: 'sgc-ev-recomendado', label: '¿Quién recomienda capacitación, si aplica? (opcional)'
          }) +
          Componentes.campoTexto({ id: 'sgc-ev-fecha', label: 'Fecha de la evaluación', tipo: 'date' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar evaluación', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-sgc-evaluacion').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var datos = {
        persona_id: p.persona_id,
        observaciones: document.getElementById('sgc-ev-obs').value,
        recomendado_por: document.getElementById('sgc-ev-recomendado').value,
        respuestas_responsabilidades: itemsResp.map(function (_, i) {
          return Number(document.getElementById('sgc-ev-r-' + i).value);
        }),
        respuestas_habilidades: itemsHab.map(function (_, i) {
          return Number(document.getElementById('sgc-ev-h-' + i).value);
        })
      };
      var fecha = document.getElementById('sgc-ev-fecha').value;
      if (fecha) datos.fecha = fecha;
      api_('registrarEvaluacionSgc', datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar la evaluación.', tipo: 'error' });
          return;
        }
        cerrar();
        if (respuesta.data.requiere_capacitacion) {
          Componentes.aviso({
            texto: 'Guardada. Promedios ' + respuesta.data.promedio_responsabilidades + ' / ' +
              respuesta.data.promedio_habilidades + ': se detectó necesidad de capacitación.',
            tipo: 'info'
          });
        }
        abrirPersona_(p.persona_id);
      });
    });
  }

  // --- capacitaciones (Fase 2b) -----------------------------------------------

  function cargarCapacitaciones_() {
    var cont = panelSgc_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando capacitaciones...');
    api_('listarCapacitacionesSgc', {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar el programa.', 'error');
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarCapacitaciones_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar para cargar las capacitaciones.', 'error');
    });
  }

  function pintarCapacitaciones_(cont, data) {
    var caps = data.capacitaciones || [];
    var bajoMeta = (data.horas_por_persona || []).filter(function (h) { return !h.cumple_meta; });

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Programa anual de capacitación y horas de formación por persona (Objetivo de Calidad N°4).</p>' +
      (puedeGestionar_ ? Componentes.boton({ texto: '+ Programar capacitación', clase: 'js-sgc-nueva-cap' }) : '') +
      '</div>';

    // Horas por persona: lo que de verdad importa del indicador es quién
    // está por debajo, así que eso va primero y con nombre.
    var panelHoras = (data.horas_por_persona || []).length
      ? '<h3 class="sgc-sub">Horas de formación ' + data.anio + '</h3>' +
        (bajoMeta.length
          ? Componentes.alerta(bajoMeta.length + ' persona(s) bajo la meta de 5 horas al año.', 'aviso')
          : Componentes.alerta('Todo el personal cumple la meta de 5 horas al año.', 'ok')) +
        '<div class="sgc-lista">' + (data.horas_por_persona || []).map(function (h) {
          return '<div class="sgc-version"><div class="sgc-doc__top">' +
            '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(h.nombre) + '</span>' +
            (h.cumple_meta ? Componentes.badge(h.horas + ' hrs', 'ok') : Componentes.badge(h.horas + ' hrs', 'alerta')) +
          '</div></div>';
        }).join('') + '</div>'
      : '';

    function wire() {
      wireSecciones_(cont);
      var nueva = cont.querySelector('.js-sgc-nueva-cap');
      if (nueva) nueva.addEventListener('click', function () { abrirFormularioCapacitacion_(null); });
      cont.querySelectorAll('.js-sgc-realizar').forEach(function (btn) {
        btn.addEventListener('click', function () {
          abrirFormularioRealizacion_(btn.getAttribute('data-idx'));
        });
      });
      cont.querySelectorAll('.js-sgc-eficacia').forEach(function (btn) {
        btn.addEventListener('click', function () {
          abrirFormularioEficacia_(
            btn.getAttribute('data-capacitacion'), btn.getAttribute('data-persona'), btn.getAttribute('data-nombre')
          );
        });
      });
    }

    if (caps.length === 0) {
      cont.innerHTML = cabecera + Componentes.vacio({
        texto: 'Todavía no hay capacitaciones registradas.',
        detalle: puedeGestionar_ ? 'Programa la primera del año.' : ''
      }) + panelHoras;
      wire();
      return;
    }

    var lista = caps.map(function (c) {
      var realizada = c.estado === 'REALIZADA';
      var asistieron = (c.asistentes || []).filter(function (a) { return a.asistio; });
      // v10.0 Tanda A: la eficacia (FO-PRO-02-05 §2) es POR PARTICIPANTE --
      // el mismo curso le puede servir a una persona y no a otra, asi que
      // cada asistente tiene su propio badge y su propio boton.
      var filasAsistentes = realizada && asistieron.length
        ? '<div class="sgc-lista sgc-lista--anidada">' + asistieron.map(function (a) {
            return '<div class="sgc-doc__top">' +
              '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(a.nombre) + '</span>' +
              (a.eficacia_resultado
                ? Componentes.badge(a.eficacia_resultado === 'EFICAZ' ? 'Eficaz' : 'No eficaz',
                    a.eficacia_resultado === 'EFICAZ' ? 'ok' : 'critico')
                : (a.eficacia_pendiente ? Componentes.badge('Eficacia pendiente', 'alerta') : Componentes.badge('Aún no toca (60 días)', 'neutro'))) +
              (puedeGestionar_ && !a.eficacia_resultado
                ? Componentes.boton({
                    texto: 'Evaluar', variante: 'sutil', clase: 'js-sgc-eficacia'
                  }).replace('<button ', '<button data-capacitacion="' + c.capacitacion_id +
                    '" data-persona="' + a.persona_id + '" data-nombre="' + Componentes.escaparHtml(a.nombre) + '" ')
                : '') +
            '</div>';
          }).join('') + '</div>'
        : '';
      return '<div class="sgc-version">' +
        '<div class="sgc-doc__top">' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(c.nombre) + '</span>' +
          Componentes.badge(realizada ? 'Realizada' : 'Programada', realizada ? 'ok' : 'neutro') +
          Componentes.badge(c.horas + ' hrs', 'neutro') +
          (c.eficacia_pendiente ? Componentes.badge('Eficacia pendiente', 'alerta') : '') +
        '</div>' +
        '<div class="sgc-doc__meta">' +
          (c.relator ? '<span>Relator: ' + Componentes.escaparHtml(c.relator) + '</span>' : '') +
          (realizada
            ? '<span>Realizada ' + fechaCorta_(c.fecha_realizada) + '</span>'
            : (c.fecha_programada ? '<span>Programada ' + fechaCorta_(c.fecha_programada) + '</span>' : '')) +
          (realizada ? '<span>' + c.total_asistieron + ' asistente(s)</span>' : '') +
        '</div>' +
        (c.descripcion ? '<p class="sigso-ayuda">' + Componentes.escaparHtml(c.descripcion) + '</p>' : '') +
        filasAsistentes +
        (puedeGestionar_ && !realizada
          ? '<div class="sgc-acciones">' +
              Componentes.boton({ texto: 'Registrar realización', variante: 'sutil', clase: 'js-sgc-realizar', idx: c.capacitacion_id }) +
            '</div>'
          : '') +
      '</div>';
    }).join('');

    cont.innerHTML = cabecera + '<div class="sgc-lista">' + lista + '</div>' + panelHoras;
    wire();
  }

  function abrirFormularioCapacitacion_() {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Programar capacitación</h3>' +
        '<form id="form-sgc-cap">' +
          Componentes.campoTexto({ id: 'sgc-c-nombre', label: 'Nombre del curso', requerido: true }) +
          Componentes.campoTextarea({ id: 'sgc-c-descripcion', label: 'Descripción' }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-c-horas', label: 'Horas', tipo: 'number', valor: '4', requerido: true }) +
            Componentes.campoTexto({ id: 'sgc-c-fecha', label: 'Fecha programada', tipo: 'date' }) +
          '</div>' +
          Componentes.campoTexto({ id: 'sgc-c-relator', label: 'Relator' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Programar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-sgc-cap').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('guardarCapacitacionSgc', {
        nombre: document.getElementById('sgc-c-nombre').value,
        descripcion: document.getElementById('sgc-c-descripcion').value,
        horas: Number(document.getElementById('sgc-c-horas').value),
        fecha_programada: document.getElementById('sgc-c-fecha').value,
        relator: document.getElementById('sgc-c-relator').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo programar.', tipo: 'error' });
          return;
        }
        cerrar();
        cargarCapacitaciones_();
      });
    });
  }

  // Registrar realización: se elige quién asistió de la lista de personal.
  function abrirFormularioRealizacion_(capacitacionId) {
    api_('listarPersonasSgc', {}).then(function (r) {
      var personas = (r && r.ok) ? (r.data.personas || []) : [];
      var fondo = document.createElement('div');
      fondo.className = 'sigso-modal-fondo';
      fondo.innerHTML =
        '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
          '<h3 class="sigso-modal__titulo">Registrar realización</h3>' +
          '<p class="sigso-ayuda">Marca quiénes asistieron. Las horas del año solo se suman a quienes asistieron.</p>' +
          '<form id="form-sgc-realizacion">' +
            Componentes.campoTexto({ id: 'sgc-r-fecha', label: 'Fecha de realización', tipo: 'date', requerido: true }) +
            Componentes.campoTexto({ id: 'sgc-r-relator', label: 'Relator' }) +
            '<div class="sigso-campo"><label>Asistentes</label>' +
              (personas.length
                ? personas.map(function (p) {
                    return '<label class="sigso-campo-check"><input type="checkbox" class="js-sgc-asistente" value="' +
                      p.persona_id + '"> ' + Componentes.escaparHtml(p.nombre) + '</label>';
                  }).join('')
                : '<p class="sigso-ayuda">No hay personal registrado todavía.</p>') +
            '</div>' +
            '<div class="sigso-modal__acciones">' +
              Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
              Componentes.boton({ texto: 'Registrar', tipo: 'submit' }) +
            '</div>' +
          '</form>' +
        '</div>';
      var cerrar = montarModal_(fondo);
      document.getElementById('form-sgc-realizacion').addEventListener('submit', function (evento) {
        evento.preventDefault();
        var asistentes = Array.prototype.slice.call(fondo.querySelectorAll('.js-sgc-asistente:checked'))
          .map(function (el) { return el.value; });
        api_('registrarRealizacionCapacitacionSgc', {
          capacitacion_id: capacitacionId,
          fecha_realizada: document.getElementById('sgc-r-fecha').value,
          relator: document.getElementById('sgc-r-relator').value,
          asistentes: asistentes
        }).then(function (respuesta) {
          if (!respuesta || !respuesta.ok) {
            Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo registrar.', tipo: 'error' });
            return;
          }
          cerrar();
          cargarCapacitaciones_();
        });
      });
    });
  }

  // v10.0 Tanda A: la eficacia es POR PARTICIPANTE (FO-PRO-02-05 §2) -- el
  // mismo curso puede servirle a una persona y no a otra.
  function abrirFormularioEficacia_(capacitacionId, personaId, nombre) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Evaluar eficacia — ' + Componentes.escaparHtml(nombre || '') + '</h3>' +
        '<p class="sigso-ayuda">A los 60 días de realizada: ¿le sirvió a esta persona?</p>' +
        '<form id="form-sgc-eficacia">' +
          Componentes.campoSelect({
            id: 'sgc-ef-resultado', label: 'Resultado', valor: 'EFICAZ', placeholder: false,
            opciones: [{ valor: 'EFICAZ', texto: 'Eficaz' }, { valor: 'NO_EFICAZ', texto: 'No eficaz' }]
          }) +
          Componentes.campoTextarea({
            id: 'sgc-ef-obs', label: 'Observaciones',
            ayuda: 'Obligatorio si no fue eficaz: es lo que justifica la siguiente acción.'
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-sgc-eficacia').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('registrarEficaciaCapacitacionSgc', {
        capacitacion_id: capacitacionId,
        persona_id: personaId,
        resultado: document.getElementById('sgc-ef-resultado').value,
        observaciones: document.getElementById('sgc-ef-obs').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        cargarCapacitaciones_();
      });
    });
  }

  function wireFicha_(cont, data) {
    var p = data.persona;

    var evaluar = cont.querySelector('.js-sgc-evaluar');
    if (evaluar) evaluar.addEventListener('click', function () {
      abrirFormularioEvaluacion_(p, data.items_responsabilidades, data.items_habilidades, data.escala_evaluacion);
    });

    var editar = cont.querySelector('.js-sgc-editar-persona');
    if (editar) editar.addEventListener('click', function () { abrirFormularioPersona_(p); });

    var desvincular = cont.querySelector('.js-sgc-desvincular');
    if (desvincular) desvincular.addEventListener('click', function () {
      Componentes.confirmar({
        titulo: 'Desvincular a ' + p.nombre,
        mensaje: 'Dejará de aparecer en el personal vigente. Su ficha e historial se conservan como evidencia del SGC.'
      }).then(function (ok) {
        if (!ok) return;
        api_('desvincularPersonaSgc', { persona_id: p.persona_id }).then(function (r) {
          if (!r || !r.ok) {
            Componentes.aviso({ texto: (r && r.message) || 'No se pudo desvincular.', tipo: 'error' });
            return;
          }
          abrirPersona_(p.persona_id);
        });
      });
    });

    var reactivar = cont.querySelector('.js-sgc-reactivar');
    if (reactivar) reactivar.addEventListener('click', function () {
      api_('desvincularPersonaSgc', { persona_id: p.persona_id, reactivar: true }).then(function () {
        abrirPersona_(p.persona_id);
      });
    });

    var quitarAlcance = cont.querySelector('.js-sgc-quitar-alcance');
    if (quitarAlcance) quitarAlcance.addEventListener('click', function () {
      Componentes.confirmar({
        titulo: 'Quitar del alcance del SGC',
        mensaje: 'Para cuando ' + p.nombre + ' nunca debió estar aquí (por ejemplo, una carga de personal por error) — ' +
          'NO es lo mismo que desvincular a alguien que sí trabajó en la empresa. ' +
          'Deja de aparecer en el listado, pero se puede volver a incluir desde "Incluir fuera de alcance".'
      }).then(function (ok) {
        if (!ok) return;
        api_('quitarPersonaAlcanceSgc', { persona_id: p.persona_id }).then(function (r) {
          if (!r || !r.ok) {
            Componentes.aviso({ texto: (r && r.message) || 'No se pudo quitar del alcance.', tipo: 'error' });
            return;
          }
          Componentes.aviso({ texto: p.nombre + ' se quitó del alcance del SGC.', tipo: 'exito' });
          cargarPersonas_();
        });
      });
    });

    var descriptor = cont.querySelector('.js-sgc-descriptor');
    if (descriptor) descriptor.addEventListener('click', function () {
      abrirFormularioDescriptor_(p, data.descriptor_vigente, false);
    });
    var descriptorEditar = cont.querySelector('.js-sgc-descriptor-editar');
    if (descriptorEditar) descriptorEditar.addEventListener('click', function () {
      abrirFormularioDescriptor_(p, data.descriptor_vigente, true);
    });
    var descriptorBajar = cont.querySelector('.js-sgc-descriptor-bajar');
    if (descriptorBajar) descriptorBajar.addEventListener('click', function () {
      api_('descargarDescriptorSgc', { persona_id: p.persona_id, descriptor_id: data.descriptor_vigente.descriptor_id })
        .then(function (r) {
          if (!r || !r.ok) {
            Componentes.aviso({ texto: (r && r.message) || 'No se pudo descargar.', tipo: 'error' });
            return;
          }
          descargarBase64Sgc_(r.data.contenido_base64, r.data.nombre_archivo, r.data.mime);
        });
    });

    var docPersona = cont.querySelector('.js-sgc-doc-persona');
    if (docPersona) docPersona.addEventListener('click', function () { abrirFormularioDocPersona_(p); });

    cont.querySelectorAll('.js-sgc-bajar-doc').forEach(function (btn) {
      btn.addEventListener('click', function () {
        api_('descargarDocumentoPersonaSgc', {
          persona_id: p.persona_id, doc_id: btn.getAttribute('data-idx')
        }).then(function (r) {
          if (!r || !r.ok) {
            Componentes.aviso({ texto: (r && r.message) || 'No se pudo descargar.', tipo: 'error' });
            return;
          }
          descargarBase64Sgc_(r.data.contenido_base64, r.data.nombre_archivo, r.data.mime);
        });
      });
    });

    cont.querySelectorAll('.js-sgc-quitar-doc').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Componentes.confirmar({ titulo: 'Quitar documento', mensaje: '¿Confirmas quitarlo de la ficha?' }).then(function (ok) {
          if (!ok) return;
          api_('guardarDocumentoPersonaSgc', {
            persona_id: p.persona_id, accion: 'eliminar', doc_id: btn.getAttribute('data-idx')
          }).then(function () { abrirPersona_(p.persona_id); });
        });
      });
    });

    cont.querySelectorAll('.js-sgc-induccion').forEach(function (btn) {
      btn.addEventListener('click', function () {
        api_('registrarInduccionSgc', {
          persona_id: p.persona_id, induccion_id: btn.getAttribute('data-idx'), estado: 'COMPLETADA'
        }).then(function (r) {
          if (!r || !r.ok) {
            Componentes.aviso({ texto: (r && r.message) || 'No se pudo registrar.', tipo: 'error' });
            return;
          }
          abrirPersona_(p.persona_id);
        });
      });
    });
  }

  // --- formularios de personas -----------------------------------------------

  function abrirFormularioPersona_(p) {
    var esNueva = !p;
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">' + (esNueva ? 'Nueva persona' : 'Editar datos') + '</h3>' +
        '<form id="form-sgc-persona">' +
          Componentes.campoTexto({ id: 'sgc-pe-nombre', label: 'Nombre completo', valor: p && p.nombre, requerido: true }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-pe-email', label: 'Correo', tipo: 'email', valor: p && p.usuario_email, requerido: true }) +
            Componentes.campoTexto({ id: 'sgc-pe-rut', label: 'RUT', valor: p && p.rut }) +
          '</div>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-pe-cargo', label: 'Cargo según organigrama', valor: p && p.cargo }) +
            Componentes.campoSelect({
              id: 'sgc-pe-tipo', label: 'Tipo', valor: (p && p.tipo) || 'INT', placeholder: false,
              opciones: [{ valor: 'INT', texto: 'Interno' }, { valor: 'EXT', texto: 'Externo' }]
            }) +
          '</div>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-pe-area', label: 'Área', valor: p && p.area_id, placeholder: 'Ej: PREVENCION' }) +
            Componentes.campoTexto({ id: 'sgc-pe-ingreso', label: 'Fecha de ingreso', tipo: 'date', valor: fechaISO_(p && p.fecha_ingreso) }) +
          '</div>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-pe-jefatura', label: 'Jefatura directa (correo)', tipo: 'email', valor: p && p.jefatura_email }) +
            Componentes.campoTexto({ id: 'sgc-pe-subrogante', label: 'Subrogante (correo)', tipo: 'email', valor: p && p.subrogante_email }) +
          '</div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: esNueva ? 'Crear ficha' : 'Guardar', tipo: 'submit', clase: 'js-sgc-guardar-persona' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    // El correo enlaza la ficha con su cuenta y con todo su historial:
    // cambiarlo despues partiria el registro en dos. Pero eso SOLO aplica
    // si ya hay un correo enlazado -- una ficha que entro sin correo (ej.
    // por la carga inicial masiva del SGC) tiene que poder completarlo, o
    // quedaba bloqueada para siempre sin forma de arreglarla.
    if (!esNueva && p && p.usuario_email) document.getElementById('sgc-pe-email').readOnly = true;

    var textoOriginalPersona_ = esNueva ? 'Crear ficha' : 'Guardar';
    document.getElementById('form-sgc-persona').addEventListener('submit', function (evento) {
      evento.preventDefault();
      // v14.0 (bug real: doble clic creaba dos fichas idénticas -- este
      // formulario era el único de Calidad que no se deshabilitaba al
      // enviar). El backend además lo blinda con LockService, pero esto
      // evita el problema desde el origen: el segundo clic ni siquiera sale.
      var boton = fondo.querySelector('.js-sgc-guardar-persona');
      if (boton) { boton.disabled = true; boton.textContent = esNueva ? 'Creando...' : 'Guardando...'; }
      var datos = {
        nombre: document.getElementById('sgc-pe-nombre').value,
        usuario_email: document.getElementById('sgc-pe-email').value,
        rut: document.getElementById('sgc-pe-rut').value,
        cargo: document.getElementById('sgc-pe-cargo').value,
        tipo: document.getElementById('sgc-pe-tipo').value,
        area_id: document.getElementById('sgc-pe-area').value,
        fecha_ingreso: document.getElementById('sgc-pe-ingreso').value,
        jefatura_email: document.getElementById('sgc-pe-jefatura').value,
        subrogante_email: document.getElementById('sgc-pe-subrogante').value
      };
      if (p) datos.persona_id = p.persona_id;
      api_('guardarPersonaSgc', datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          if (boton) { boton.disabled = false; boton.textContent = textoOriginalPersona_; }
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        if (p) abrirPersona_(p.persona_id); else cargarPersonas_();
      }).catch(function (err) {
        if (boton) { boton.disabled = false; boton.textContent = textoOriginalPersona_; }
        Componentes.aviso({ texto: mensajeErrorSubidaSgc_(err), tipo: 'error' });
      });
    });
  }

  // v14.0: tres modos posibles --
  //   crear   (vigente ausente): version en blanco, todo vacío.
  //   version (vigente presente, editar=false): "Nueva versión" -- el texto
  //     arranca en blanco (se redacta de nuevo), salvo los items evaluables,
  //     que SI se heredan como base. Va a guardarDescriptorSgc (archiva la
  //     version anterior y crea una fila nueva).
  //   editar  (vigente presente, editar=true): corrige la MISMA version en
  //     el lugar -- todo se prellena desde `vigente`, la version queda de
  //     solo lectura, y va a actualizarDescriptorSgc (sin versionar).
  function abrirFormularioDescriptor_(p, vigente, editar) {
    var modoEditar = !!(editar && vigente);
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">' +
          (modoEditar ? 'Editar descriptor de cargo — ' : 'Descriptor de cargo — ') +
          Componentes.escaparHtml(p.nombre) + '</h3>' +
        (vigente && !modoEditar
          ? '<p class="sigso-ayuda">La versión ' + Componentes.escaparHtml(vigente.version) +
            ' quedará archivada (no se elimina) y esta pasará a ser la vigente.</p>'
          : '') +
        (modoEditar
          ? '<p class="sigso-ayuda">Corrige la versión ' + Componentes.escaparHtml(vigente.version) +
            ' vigente sin crear una nueva. Para un cambio real de contenido, usa "Nueva versión del descriptor".</p>'
          : '') +
        '<form id="form-sgc-descriptor">' +
          Componentes.campoTexto({
            id: 'sgc-de-version', label: 'Versión', requerido: true,
            valor: modoEditar ? vigente.version : (vigente ? '' : 'v01'), placeholder: 'Ej: v01'
          }) +
          Componentes.campoTextarea({ id: 'sgc-de-objetivo', label: 'Objetivo general del cargo', requerido: true, valor: modoEditar ? vigente.objetivo : '' }) +
          Componentes.campoTextarea({ id: 'sgc-de-funciones', label: 'Funciones', valor: modoEditar ? vigente.funciones : '' }) +
          Componentes.campoTextarea({ id: 'sgc-de-responsabilidades', label: 'Responsabilidades (texto, tal como está en el documento)', valor: modoEditar ? vigente.responsabilidades : '' }) +
          Componentes.campoTextarea({ id: 'sgc-de-habilidades', label: 'Habilidades requeridas (texto, tal como está en el documento)', valor: modoEditar ? vigente.habilidades : '' }) +
          Componentes.campoTextarea({
            id: 'sgc-de-items-resp', label: 'Responsabilidades a evaluar (una por línea)',
            valor: (vigente && vigente.items_responsabilidades ? vigente.items_responsabilidades.join('\n') : ''),
            ayuda: 'La evaluación de competencias (FO-PRO-02-04) califica cada una por separado.'
          }) +
          Componentes.campoTextarea({
            id: 'sgc-de-items-hab', label: 'Habilidades a evaluar (una por línea)',
            valor: (vigente && vigente.items_habilidades ? vigente.items_habilidades.join('\n') : '')
          }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-de-nivel', label: 'Nivel educacional', valor: modoEditar ? vigente.nivel_educacional : '' }) +
            Componentes.campoTexto({ id: 'sgc-de-formacion', label: 'Formación técnica', valor: modoEditar ? vigente.formacion_tecnica : '' }) +
          '</div>' +
          Componentes.campoTextarea({ id: 'sgc-de-experiencia', label: 'Experiencia laboral requerida', valor: modoEditar ? vigente.experiencia : '' }) +
          '<div class="sigso-campo">' +
            '<label for="sgc-de-archivo">' +
              (modoEditar && vigente.archivo_id ? 'Reemplazar el archivo (opcional)' : 'Archivo del descriptor (opcional)') +
            '</label>' +
            '<input type="file" id="sgc-de-archivo" accept=".pdf,.doc,.docx,.xls,.xlsx">' +
            (modoEditar && vigente.archivo_id
              ? '<p class="sigso-ayuda">Actual: ' + Componentes.escaparHtml(vigente.archivo_nombre || 'sin nombre') + '. Déjalo vacío para no cambiarlo.</p>'
              : '') +
          '</div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: modoEditar ? 'Guardar cambios' : 'Guardar descriptor', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    // La version identifica cuál era el descriptor vigente cuando se evaluó
    // a la persona (FO-PRO-02-04 la referencia); corregir texto no puede
    // cambiar silenciosamente ese número -- para eso está "Nueva versión".
    if (modoEditar) document.getElementById('sgc-de-version').readOnly = true;

    var textoOriginal = modoEditar ? 'Guardar cambios' : 'Guardar descriptor';
    document.getElementById('form-sgc-descriptor').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true; boton.textContent = 'Guardando...';
      var archivo = document.getElementById('sgc-de-archivo').files[0];

      function enviar(base64, nombreArchivo) {
        var datos = {
          persona_id: p.persona_id,
          version: document.getElementById('sgc-de-version').value,
          objetivo: document.getElementById('sgc-de-objetivo').value,
          funciones: document.getElementById('sgc-de-funciones').value,
          responsabilidades: document.getElementById('sgc-de-responsabilidades').value,
          habilidades: document.getElementById('sgc-de-habilidades').value,
          items_responsabilidades: lineasNoVacias_(document.getElementById('sgc-de-items-resp').value),
          items_habilidades: lineasNoVacias_(document.getElementById('sgc-de-items-hab').value),
          nivel_educacional: document.getElementById('sgc-de-nivel').value,
          formacion_tecnica: document.getElementById('sgc-de-formacion').value,
          experiencia: document.getElementById('sgc-de-experiencia').value
        };
        if (base64) { datos.contenido_base64 = base64; datos.nombre_archivo = nombreArchivo; }
        if (modoEditar) {
          datos.descriptor_id = vigente.descriptor_id;
          return api_('actualizarDescriptorSgc', datos);
        }
        return api_('guardarDescriptorSgc', datos);
      }

      var promesa = archivo
        ? leerArchivoBase64Sgc_(archivo).then(function (b64) { return enviar(b64, archivo.name); })
        : enviar(null, null);

      promesa.then(function (respuesta) {
        boton.disabled = false; boton.textContent = textoOriginal;
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar el descriptor.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirPersona_(p.persona_id);
      }).catch(function (err) {
        boton.disabled = false; boton.textContent = textoOriginal;
        Componentes.aviso({ texto: mensajeErrorSubidaSgc_(err), tipo: 'error' });
      });
    });
  }

  function abrirFormularioDocPersona_(p) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Cargar documento — ' + Componentes.escaparHtml(p.nombre) + '</h3>' +
        '<form id="form-sgc-doc-persona">' +
          Componentes.campoSelect({
            id: 'sgc-dp-tipo', label: 'Tipo de documento', valor: 'CV', placeholder: false,
            opciones: Object.keys(TIPO_DOC_PERSONA_ETIQUETA).map(function (t) {
              return { valor: t, texto: TIPO_DOC_PERSONA_ETIQUETA[t] };
            })
          }) +
          Componentes.campoTexto({ id: 'sgc-dp-nombre', label: 'Nombre (opcional)' }) +
          '<div class="sigso-campo">' +
            '<label for="sgc-dp-archivo">Archivo (PDF, Word o Excel · máx. 10 MB)</label>' +
            '<input type="file" id="sgc-dp-archivo" accept=".pdf,.doc,.docx,.xls,.xlsx" required>' +
          '</div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Cargar', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-sgc-doc-persona').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var archivo = document.getElementById('sgc-dp-archivo').files[0];
      if (!archivo) return;
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true; boton.textContent = 'Subiendo...';

      var lectura = archivo ? leerArchivoBase64Sgc_(archivo) : Promise.resolve('');
      lectura.then(function (base64) {
        return api_('guardarDocumentoPersonaSgc', {
          persona_id: p.persona_id,
          tipo: document.getElementById('sgc-dp-tipo').value,
          nombre: document.getElementById('sgc-dp-nombre').value || archivo.name,
          nombre_archivo: archivo ? archivo.name : '',
          contenido_base64: base64
        });
      }).then(function (respuesta) {
        boton.disabled = false; boton.textContent = 'Cargar';
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo cargar el documento.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirPersona_(p.persona_id);
      }).catch(function (err) {
        boton.disabled = false; boton.textContent = 'Cargar';
        Componentes.aviso({ texto: mensajeErrorSubidaSgc_(err), tipo: 'error' });
      });
    });
  }

  // ==========================================================================
  // NO CONFORMIDADES (Fase 3a, PRO-06) — el motor de mejora
  //
  // La corrección y la acción correctiva NO se gestionan acá: son
  // ACTIVIDADES que el responsable ve en "Mi trabajo". Esta pantalla es
  // donde el Encargado SGC gobierna el ciclo, y muestra el estado real de
  // esas actividades sin duplicarlo.
  // ==========================================================================

  // Vocabulario alineado con el FO-PRO-06-01 real (marca con X entre
  // Auditoría / Revisión por la dirección / Reclamo / Otro). Se mantiene el
  // desglose interno/externo de auditoría porque distinguirlas es util y no
  // contradice el formulario -- ambas caen bajo "Auditoría".
  var FUENTE_NC_ETIQUETA = {
    AUDITORIA_INTERNA: 'Auditoría interna', AUDITORIA_EXTERNA: 'Auditoría externa',
    QUEJA: 'Queja / reclamo', REVISION_DIRECCION: 'Revisión por la dirección',
    PROCESO: 'Detectada en el proceso', OTRO: 'Otra'
  };
  var ESTADO_NC_ETIQUETA = {
    ABIERTA: 'Abierta', EN_CORRECCION: 'En corrección', EN_ACCION: 'En acción correctiva',
    EN_VERIFICACION: 'Verificando eficacia', CERRADA: 'Cerrada', ANULADA: 'Anulada'
  };

  // La tarea vinculada llega con el estado crudo de ACTIVIDADES; acá se
  // muestra en el idioma del resto del módulo.
  var ESTADO_TAREA_ETIQUETA = {
    NO_INICIADA: 'Sin empezar', EN_CURSO: 'En curso', BLOQUEADA: 'Bloqueada',
    EN_REVISION: 'En revisión', TERMINADA: 'Terminada', CANCELADA: 'Cancelada'
  };

  var filtroNcAbiertas_ = false;

  function cargarNc_() {
    ncActivaId_ = null;
    cargarListadoSgc_({
      clave: 'nc', accion: 'listarNcSgc', datos: filtroNcAbiertas_ ? { abiertas: true } : {},
      spinner: 'Cargando no conformidades...',
      sigo: function () { return seccionActiva_ === 'nc' && !ncActivaId_; },
      aplicar: function (cont, data) {
        puedeGestionar_ = data.puede_gestionar === true;
        cacheListadoSgc_.nc = data;
        pintarNc_(cont, data);
      },
      error: function (cont, msg) {
        cont.innerHTML = Componentes.alerta(msg || 'No se pudo conectar para cargar las no conformidades.', 'error');
      }
    });
  }

  function pintarNc_(cont, data) {
    var lista = data.no_conformidades || [];
    var ind = data.indicadores || {};

    var kpis = '<div class="sgc-kpis">' + [
      Componentes.kpi({ etiqueta: 'Abiertas', valor: ind.abiertas || 0 }),
      Componentes.kpi({ etiqueta: 'Con plazo vencido', valor: ind.vencidas || 0 }),
      Componentes.kpi({ etiqueta: 'Cerradas', valor: ind.cerradas || 0 }),
      Componentes.kpi({
        etiqueta: 'Días promedio',
        valor: ind.dias_promedio_resolucion === null || ind.dias_promedio_resolucion === undefined
          ? '—' : ind.dias_promedio_resolucion
      }),
      Componentes.kpi({
        etiqueta: '% eficacia',
        valor: ind.pct_eficacia_positiva === null || ind.pct_eficacia_positiva === undefined
          ? '—' : ind.pct_eficacia_positiva + '%'
      })
    ].join('') + '</div>';

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Ciclo de mejora: corregir, entender por qué pasó, evitar que se repita y verificar que funcionó.</p>' +
      (puedeGestionar_ ? Componentes.boton({ texto: '+ Registrar no conformidad', clase: 'js-sgc-nueva-nc' }) : '') +
      '</div>' + kpis +
      '<div class="sgc-filtros">' +
        '<label class="sigso-campo-check"><input type="checkbox" id="sgc-nc-abiertas"' +
          (filtroNcAbiertas_ ? ' checked' : '') + '> Ver solo las abiertas</label>' +
      '</div>';

    function wire() {
      wireSecciones_(cont);
      var nueva = cont.querySelector('.js-sgc-nueva-nc');
      if (nueva) nueva.addEventListener('click', abrirFormularioNc_);
      var chk = cont.querySelector('#sgc-nc-abiertas');
      if (chk) chk.addEventListener('change', function () { filtroNcAbiertas_ = this.checked; cargarNc_(); });
      cont.querySelectorAll('.js-sgc-abrir-nc').forEach(function (btn) {
        btn.addEventListener('click', function () { abrirNc_(btn.getAttribute('data-id')); });
      });
    }

    if (lista.length === 0) {
      cont.innerHTML = cabecera + Componentes.vacio({
        texto: filtroNcAbiertas_ ? 'No hay no conformidades abiertas.' : 'Todavía no hay no conformidades registradas.',
        detalle: 'Se registran desde una auditoría, una queja, la revisión por la dirección o el día a día.'
      });
      wire();
      return;
    }

    var filas = lista.map(function (nc) {
      var cerrada = nc.estado === 'CERRADA' || nc.estado === 'ANULADA';
      return '<button type="button" class="sgc-doc js-sgc-abrir-nc' +
        (nc.vencida ? ' sgc-nc--vencida' : (cerrada ? ' sgc-doc--obsoleto' : '')) +
        '" data-id="' + nc.nc_id + '">' +
        '<div class="sgc-doc__top">' +
          '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(nc.correlativo) + '</span>' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(String(nc.descripcion).slice(0, 110)) + '</span>' +
          Componentes.badge(ESTADO_NC_ETIQUETA[nc.estado] || nc.estado, cerrada ? 'neutro' : 'info') +
          (nc.vencida ? Componentes.badge('Vencida', 'critico') : '') +
          (nc.ciclo > 1 ? Componentes.badge('Ciclo ' + nc.ciclo, 'alerta') : '') +
        '</div>' +
        '<div class="sgc-doc__meta">' +
          '<span>' + Componentes.escaparHtml(FUENTE_NC_ETIQUETA[nc.fuente] || nc.fuente) + '</span>' +
          (nc.referencia_normativa ? '<span>' + Componentes.escaparHtml(nc.referencia_normativa) + '</span>' : '') +
          (nc.area_id ? '<span>' + Componentes.escaparHtml(nc.area_id) + '</span>' : '') +
          '<span>' + Componentes.escaparHtml(nc.responsable_email) + '</span>' +
          '<span>Detectada ' + fechaCorta_(nc.fecha_deteccion) + '</span>' +
          (nc.etapa_actual
            ? '<span>' + Componentes.escaparHtml(nc.etapa_actual) +
              (nc.dias_para_plazo !== null
                ? (nc.dias_para_plazo < 0
                    ? ' · vencida hace ' + (-nc.dias_para_plazo) + ' d'
                    : ' · ' + nc.dias_para_plazo + ' d')
                : '') + '</span>'
            : '') +
        '</div>' +
      '</button>';
    }).join('');

    cont.innerHTML = cabecera + '<div class="sgc-lista">' + filas + '</div>';
    wire();
  }

  // --- ficha de la NC: el ciclo completo, en orden --------------------------

  function abrirNc_(id) {
    ncActivaId_ = id;
    var cont = panelSgc_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando no conformidad...');
    api_('getDetalleNcSgc', { nc_id: id }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo abrir.', 'error');
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarFichaNc_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
    });
  }

  // Una etapa del ciclo. El orden importa y se muestra: no se puede definir
  // la acción correctiva antes de entender la causa.
  function etapaNc_(numero, titulo, hecho, cuerpo, acciones) {
    return '<div class="sgc-etapa' + (hecho ? ' sgc-etapa--hecha' : '') + '">' +
      '<div class="sgc-etapa__num">' + (hecho ? '✓' : numero) + '</div>' +
      '<div class="sgc-etapa__cuerpo">' +
        '<h3>' + Componentes.escaparHtml(titulo) + '</h3>' +
        cuerpo +
        (acciones || '') +
      '</div>' +
    '</div>';
  }

  function tareaVinculadaHtml_(tarea, etiqueta) {
    if (!tarea) return '';
    return '<div class="sgc-tarea-vinculada">' +
      '<p class="sigso-ayuda">' + Componentes.escaparHtml(etiqueta) + ' — asignada a <b>' +
        Componentes.escaparHtml(tarea.responsable_email) + '</b> en <b>Mi trabajo</b>' +
        (tarea.fecha_compromiso ? ', vence ' + fechaCorta_(tarea.fecha_compromiso) : '') + '</p>' +
      '<div class="sgc-doc__top">' +
        '<span class="sigso-badge sigso-mt-badge--' + tarea.semaforo + '">' +
          Componentes.escaparHtml(tarea.semaforo_etiqueta) + '</span>' +
        Componentes.badge(ESTADO_TAREA_ETIQUETA[tarea.estado] || tarea.estado,
          tarea.terminada ? 'ok' : 'neutro') +
        (tarea.avance_pct !== '' && tarea.avance_pct !== undefined && tarea.avance_pct !== null
          ? '<span class="sigso-ayuda">' + tarea.avance_pct + '% de avance</span>' : '') +
      '</div>' +
    '</div>';
  }

  function pintarFichaNc_(cont, data) {
    var nc = data.nc;
    var r = data.resumen;
    var puede = puedeGestionar_;
    var cerrada = nc.estado === 'CERRADA' || nc.estado === 'ANULADA';

    // 1) Corrección
    var e1 = etapaNc_(1, 'Corrección inmediata',
      !!nc.correccion_fecha_cierre,
      (nc.correccion_descripcion
        ? '<p>' + Componentes.escaparHtml(nc.correccion_descripcion) + '</p>' +
          tareaVinculadaHtml_(data.correccion_actividad, 'Corrección') +
          (nc.correccion_fecha_cierre
            ? '<p class="sigso-ayuda">Cerrada el ' + fechaCorta_(nc.correccion_fecha_cierre) + '.</p>' : '')
        : '<p class="sigso-ayuda">Qué se hace ahora para contener el problema. Plazo: ' +
          fechaCorta_(nc.correccion_plazo) + ' (10 días hábiles).</p>'),
      puede && !cerrada
        ? '<div class="sgc-acciones">' +
            (!nc.correccion_actividad_id
              ? Componentes.boton({ texto: 'Definir corrección', clase: 'js-nc-correccion' })
              : (!nc.correccion_fecha_cierre
                  ? Componentes.boton({ texto: '✓ Marcar corrección cerrada', variante: 'secundario', clase: 'js-nc-cerrar-correccion' })
                  : '')) +
          '</div>'
        : '');

    // 2) Causa raíz (5 por qué)
    var porques = [];
    for (var i = 1; i <= 5; i++) {
      if (nc['porque_' + i]) porques.push('<li>' + Componentes.escaparHtml(nc['porque_' + i]) + '</li>');
    }
    var e2 = etapaNc_(2, 'Análisis de causa (5 por qué)',
      r.tiene_causa,
      (r.tiene_causa
        ? (porques.length ? '<ol class="sgc-porques">' + porques.join('') + '</ol>' : '') +
          '<p><b>Causa raíz:</b> ' + Componentes.escaparHtml(nc.causa_raiz) + '</p>'
        : '<p class="sigso-ayuda">Por qué ocurrió realmente. Sin esto, la acción correctiva ataca el síntoma.</p>'),
      puede && !cerrada
        ? '<div class="sgc-acciones">' +
            Componentes.boton({
              texto: r.tiene_causa ? 'Editar análisis' : 'Registrar análisis',
              variante: r.tiene_causa ? 'secundario' : 'primario', clase: 'js-nc-causa'
            }) +
          '</div>'
        : '');

    // 3) Acción correctiva
    var e3 = etapaNc_(3, 'Acción correctiva',
      !!nc.accion_fecha_cierre,
      (nc.accion_descripcion
        ? '<p>' + Componentes.escaparHtml(nc.accion_descripcion) + '</p>' +
          tareaVinculadaHtml_(data.accion_actividad, 'Acción correctiva') +
          (nc.accion_fecha_cierre
            ? '<p class="sigso-ayuda">Implementada el ' + fechaCorta_(nc.accion_fecha_cierre) + '.</p>' : '')
        : '<p class="sigso-ayuda">Qué se cambia para que no vuelva a pasar. Plazo: 20 días hábiles desde la corrección.</p>'),
      puede && !cerrada && r.tiene_causa
        ? '<div class="sgc-acciones">' +
            (!nc.accion_actividad_id
              ? Componentes.boton({ texto: 'Definir acción correctiva', clase: 'js-nc-accion' })
              : (!nc.accion_fecha_cierre
                  ? Componentes.boton({ texto: '✓ Marcar acción implementada', variante: 'secundario', clase: 'js-nc-cerrar-accion' })
                  : '')) +
          '</div>'
        : '');

    // 4) Eficacia
    var e4 = etapaNc_(4, 'Verificación de eficacia',
      nc.eficacia_resultado === 'EFICAZ',
      (nc.eficacia_resultado
        ? '<p>' + (nc.eficacia_resultado === 'EFICAZ'
            ? Componentes.badge('Eficaz', 'ok') : Componentes.badge('No eficaz', 'critico')) +
          ' ' + Componentes.escaparHtml(nc.eficacia_observaciones || '') + '</p>' +
          // Tras un "no eficaz" la NC vuelve a la etapa 3: sin esta linea el
          // resultado del ciclo anterior se leeria como el estado de ahora.
          (r.ciclo > 1 && nc.estado !== 'CERRADA'
            ? '<p class="sigso-ayuda">Resultado del ciclo ' + (r.ciclo - 1) +
              '. La verificación se repetirá con la acción correctiva nueva.</p>'
            : '')
        : '<p class="sigso-ayuda">¿Funcionó? Se verifica 60 días hábiles después de implementarla' +
          (nc.eficacia_plazo ? ', desde el ' + fechaCorta_(nc.eficacia_plazo) : '') + '.</p>'),
      puede && nc.estado === 'EN_VERIFICACION'
        ? '<div class="sgc-acciones">' +
            Componentes.boton({ texto: 'Verificar eficacia', clase: 'js-nc-eficacia' }) +
          '</div>'
        : '');

    cont.innerHTML =
      '<div class="sgc-detalle-cab">' +
        Componentes.boton({ texto: '← No conformidades', variante: 'sutil', clase: 'js-nc-volver' }) +
        '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(nc.correlativo) + '</span>' +
        '<h1>' + Componentes.escaparHtml(String(nc.descripcion).slice(0, 90)) + '</h1>' +
        Componentes.badge(ESTADO_NC_ETIQUETA[nc.estado] || nc.estado, cerrada ? 'neutro' : 'info') +
        (r.vencida ? Componentes.badge('Plazo vencido', 'critico') : '') +
      '</div>' +
      (r.ciclo > 1
        ? Componentes.alerta('Esta es la vuelta ' + r.ciclo + ' del ciclo: la acción correctiva anterior no fue eficaz.', 'aviso')
        : '') +
      '<div class="sgc-cuerpo">' +
        '<dl class="sgc-ficha">' +
          campoFicha_('Fuente', FUENTE_NC_ETIQUETA[nc.fuente] || nc.fuente) +
          campoFicha_('Referencia normativa', nc.referencia_normativa) +
          campoFicha_('Área', nc.area_id) +
          campoFicha_('Responsable', nc.responsable_email) +
          campoFicha_('Detectada', fechaCorta_(nc.fecha_deteccion)) +
          campoFicha_('Detectada por', nc.detectada_por) +
          (nc.fecha_cierre
            ? campoFicha_(nc.estado === 'ANULADA' ? 'Anulada' : 'Cerrada', fechaCorta_(nc.fecha_cierre))
            : '') +
        '</dl>' +
        '<p>' + Componentes.escaparHtml(nc.descripcion) + '</p>' +
        '<div class="sgc-etapas">' + e1 + e2 + e3 + e4 + '</div>' +
        (puede && !cerrada
          ? '<div class="sgc-acciones">' +
              Componentes.boton({ texto: 'Anular', variante: 'peligro', clase: 'js-nc-anular' }) +
            '</div>'
          : '') +
      '</div>';

    cont.querySelector('.js-nc-volver').addEventListener('click', cargarNc_);
    wireFichaNc_(cont, nc);
  }

  function wireFichaNc_(cont, nc) {
    function accion_(selector, fn) {
      var b = cont.querySelector(selector);
      if (b) b.addEventListener('click', fn);
    }
    function enviar_(accion, datos, exito) {
      api_(accion, datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        if (exito) Componentes.aviso({ texto: exito, tipo: 'exito' });
        abrirNc_(nc.nc_id);
      });
    }

    accion_('.js-nc-correccion', function () { abrirFormularioAccionNc_(nc, 'CORRECCION'); });
    accion_('.js-nc-accion', function () { abrirFormularioAccionNc_(nc, 'ACCION'); });
    accion_('.js-nc-causa', function () { abrirFormularioCausaNc_(nc); });
    accion_('.js-nc-eficacia', function () { abrirFormularioEficaciaNc_(nc); });

    accion_('.js-nc-cerrar-correccion', function () {
      Componentes.confirmar({
        titulo: 'Cerrar la corrección',
        mensaje: '¿Confirmas que la corrección ya se realizó? Después viene el análisis de causa.'
      }).then(function (ok) {
        if (ok) enviar_('cerrarEtapaNcSgc', { nc_id: nc.nc_id, etapa: 'CORRECCION' });
      });
    });
    accion_('.js-nc-cerrar-accion', function () {
      Componentes.confirmar({
        titulo: 'Marcar acción implementada',
        mensaje: 'Arranca el plazo de 60 días hábiles para verificar si funcionó.'
      }).then(function (ok) {
        if (ok) enviar_('cerrarEtapaNcSgc', { nc_id: nc.nc_id, etapa: 'ACCION' });
      });
    });
    accion_('.js-nc-anular', function () {
      Componentes.prompt({
        titulo: 'Anular no conformidad',
        mensaje: '¿Por qué se anula? Queda registrado (la no conformidad no se borra).'
      }).then(function (motivo) {
        if (motivo && String(motivo).trim()) enviar_('anularNcSgc', { nc_id: nc.nc_id, motivo: motivo });
      });
    });
  }

  // --- formularios de NC -----------------------------------------------------

  function abrirFormularioNc_() {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Registrar no conformidad</h3>' +
        '<form id="form-nc">' +
          Componentes.campoTextarea({ id: 'nc-descripcion', label: 'Qué pasó', requerido: true,
            placeholder: 'Describe la desviación detectada, con hechos concretos.' }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoSelect({
              id: 'nc-fuente', label: '¿De dónde salió?', valor: 'PROCESO', placeholder: false,
              opciones: Object.keys(FUENTE_NC_ETIQUETA).map(function (f) {
                return { valor: f, texto: FUENTE_NC_ETIQUETA[f] };
              })
            }) +
            Componentes.campoTexto({ id: 'nc-area', label: 'Área', placeholder: 'Ej: RRHH' }) +
          '</div>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'nc-responsable', label: 'Responsable', tipo: 'email', requerido: true,
              placeholder: 'A quién se le asigna resolverla' }) +
            Componentes.campoTexto({ id: 'nc-fecha', label: 'Fecha de detección', tipo: 'date' }) +
          '</div>' +
          Componentes.campoTexto({
            id: 'nc-referencia', label: 'Referencia normativa (opcional)',
            placeholder: 'Ej: 7.5, si ya sabes qué cláusula se incumplió'
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Registrar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-nc').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('crearNcSgc', {
        descripcion: document.getElementById('nc-descripcion').value,
        fuente: document.getElementById('nc-fuente').value,
        area_id: document.getElementById('nc-area').value,
        responsable_email: document.getElementById('nc-responsable').value,
        fecha_deteccion: document.getElementById('nc-fecha').value,
        referencia_normativa: document.getElementById('nc-referencia').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo registrar.', tipo: 'error' });
          return;
        }
        cerrar();
        cargarNc_();
      });
    });
  }

  // Corrección y acción correctiva comparten formulario: ambas crean una
  // ACTIVIDAD para el responsable, solo cambia el texto.
  function abrirFormularioAccionNc_(nc, tipo) {
    var esCorreccion = tipo === 'CORRECCION';
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">' + (esCorreccion ? 'Definir corrección' : 'Definir acción correctiva') + '</h3>' +
        '<p class="sigso-ayuda">' +
          (esCorreccion
            ? 'Qué se hace ahora para contener el problema.'
            : 'Qué se cambia para que la causa raíz no vuelva a producirlo.') +
          ' Se creará como una tarea en <b>Mi trabajo</b> del responsable.</p>' +
        '<form id="form-nc-accion">' +
          Componentes.campoTextarea({ id: 'nca-descripcion', label: 'Descripción', requerido: true }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'nca-responsable', label: 'Responsable', tipo: 'email',
              valor: nc.responsable_email }) +
            Componentes.campoTexto({ id: 'nca-fecha', label: 'Fecha comprometida', tipo: 'date',
              valor: fechaISO_(esCorreccion ? nc.correccion_plazo : '') }) +
          '</div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Crear y asignar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-nc-accion').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var datos = {
        nc_id: nc.nc_id,
        descripcion: document.getElementById('nca-descripcion').value,
        responsable_email: document.getElementById('nca-responsable').value
      };
      var fecha = document.getElementById('nca-fecha').value;
      if (fecha) datos.fecha_compromiso = fecha;
      api_(esCorreccion ? 'registrarCorreccionNcSgc' : 'registrarAccionNcSgc', datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo crear.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: 'Creada y asignada. Le aparece en "Mi trabajo".', tipo: 'exito' });
        abrirNc_(nc.nc_id);
      });
    });
  }

  function abrirFormularioCausaNc_(nc) {
    var campos = '';
    for (var i = 1; i <= 5; i++) {
      campos += Componentes.campoTexto({
        id: 'ncc-porque-' + i, label: '¿Por qué? (' + i + ')', valor: nc['porque_' + i],
        requerido: i === 1,
        placeholder: i === 1 ? '¿Por qué ocurrió?' : '¿Y por qué pasó eso?'
      });
    }
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Análisis de causa — 5 por qué</h3>' +
        '<p class="sigso-ayuda">Encadena los porqués hasta llegar a algo que puedas cambiar. ' +
          'No siempre hacen falta los cinco.</p>' +
        '<form id="form-nc-causa">' +
          campos +
          Componentes.campoTextarea({ id: 'ncc-causa', label: 'Causa raíz', valor: nc.causa_raiz, requerido: true,
            placeholder: 'La causa real, la que hay que atacar.' }) +
          Componentes.campoTexto({
            id: 'ncc-referencia', label: 'Referencia normativa', valor: nc.referencia_normativa,
            placeholder: 'Ej: 7.5 — a veces solo queda clara después del análisis.'
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar análisis', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-nc-causa').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var datos = {
        nc_id: nc.nc_id, causa_raiz: document.getElementById('ncc-causa').value,
        referencia_normativa: document.getElementById('ncc-referencia').value
      };
      for (var j = 1; j <= 5; j++) datos['porque_' + j] = document.getElementById('ncc-porque-' + j).value;
      api_('registrarCausaNcSgc', datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirNc_(nc.nc_id);
      });
    });
  }

  function abrirFormularioEficaciaNc_(nc) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Verificar eficacia</h3>' +
        '<p class="sigso-ayuda">¿La acción correctiva evitó que el problema se repitiera?</p>' +
        '<form id="form-nc-eficacia">' +
          Componentes.campoSelect({
            id: 'nce-resultado', label: 'Resultado', valor: 'EFICAZ', placeholder: false,
            opciones: [
              { valor: 'EFICAZ', texto: 'Eficaz — se cierra la no conformidad' },
              { valor: 'NO_EFICAZ', texto: 'No eficaz — se reabre con un ciclo nuevo' }
            ]
          }) +
          Componentes.campoTextarea({ id: 'nce-obs', label: 'Cómo lo verificaste', requerido: true,
            placeholder: 'Qué revisaste y qué encontraste. Es la evidencia de que se comprobó.' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-nc-eficacia').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var resultado = document.getElementById('nce-resultado').value;
      api_('verificarEficaciaNcSgc', {
        nc_id: nc.nc_id, resultado: resultado,
        observaciones: document.getElementById('nce-obs').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({
          texto: resultado === 'EFICAZ' ? 'No conformidad cerrada.' : 'Reabierta: hay que replantear la acción correctiva.',
          tipo: resultado === 'EFICAZ' ? 'exito' : 'info'
        });
        abrirNc_(nc.nc_id);
      });
    });
  }

  // ==========================================================================
  // AUDITORÍAS INTERNAS (Fase 3b, PRO-03) — cómo la empresa se encuentra
  // sus propios problemas.
  //
  // La pantalla sigue el ciclo del procedimiento: el programa anual arriba,
  // y dentro de cada auditoría el plan, la lista de verificación por
  // cláusula y el informe. El hallazgo de no conformidad se convierte en NC
  // con un botón: ahí es donde esta sección se conecta con la anterior.
  // ==========================================================================

  var ESTADO_AUD_ETIQUETA = {
    PROGRAMADA: 'Programada', PLANIFICADA: 'Planificada', EJECUTADA: 'Ejecutada',
    INFORMADA: 'Informada', CERRADA: 'Cerrada', ANULADA: 'Anulada'
  };
  var RESULTADO_HALLAZGO_ETIQUETA = {
    CONFORME: 'Conforme', OBSERVACION: 'Observación',
    NO_CONFORMIDAD: 'No conformidad', OPORTUNIDAD: 'Oportunidad de mejora'
  };
  var RESULTADO_HALLAZGO_TONO = {
    CONFORME: 'ok', OBSERVACION: 'alerta', NO_CONFORMIDAD: 'critico', OPORTUNIDAD: 'info'
  };

  var filtroAnioAud_ = '';
  var clausulasCatalogo_ = [];
  // v10.0 Tanda A: las 132 preguntas reales del FO-PRO-03-04, por clausula.
  // Solo viaja en el detalle (getDetalleAuditoriaSgc), no en el listado.
  var preguntasCatalogo_ = {};

  function cargarAuditorias_() {
    auditoriaActivaId_ = null;
    cargarListadoSgc_({
      clave: 'auditorias', accion: 'listarAuditoriasSgc', datos: filtroAnioAud_ ? { anio: filtroAnioAud_ } : {},
      spinner: 'Cargando el programa de auditorías...',
      sigo: function () { return seccionActiva_ === 'auditorias' && !auditoriaActivaId_; },
      aplicar: function (cont, data) {
        puedeGestionar_ = data.puede_gestionar === true;
        // La norma la define el backend (Auditorias.gs, CLAUSULAS_ISO9001):
        // la pantalla nunca guarda su propia copia.
        clausulasCatalogo_ = data.clausulas_catalogo || [];
        cacheListadoSgc_.auditorias = data;
        pintarAuditorias_(cont, data);
      },
      error: function (cont, msg) {
        cont.innerHTML = Componentes.alerta(msg || 'No se pudo conectar para cargar las auditorías.', 'error');
      }
    });
  }

  function pintarAuditorias_(cont, data) {
    var lista = data.auditorias || [];
    var ind = data.indicadores || {};

    var kpis = '<div class="sgc-kpis">' + [
      Componentes.kpi({ etiqueta: 'Programadas ' + new Date().getFullYear(), valor: ind.programadas || 0 }),
      Componentes.kpi({ etiqueta: 'Ejecutadas', valor: ind.ejecutadas || 0 }),
      Componentes.kpi({
        etiqueta: '% del programa',
        valor: ind.pct_cumplimiento === null || ind.pct_cumplimiento === undefined
          ? '—' : ind.pct_cumplimiento + '%'
      }),
      Componentes.kpi({ etiqueta: 'Informes atrasados', valor: ind.informes_vencidos || 0 }),
      Componentes.kpi({ etiqueta: 'NC por levantar', valor: ind.nc_pendientes || 0 }),
      Componentes.kpi({ etiqueta: 'Procesos sin auditar', valor: ind.procesos_sin_auditar || 0 })
    ].join('') + '</div>';

    var opciones = (data.anios || []).map(function (a) {
      return '<option value="' + a + '"' + (String(a) === String(filtroAnioAud_) ? ' selected' : '') + '>' + a + '</option>';
    }).join('');

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">El programa anual: qué proceso se audita, cuándo y quién lo audita. ' +
      'Nadie audita su propia área.</p>' +
      (puedeGestionar_ ? Componentes.boton({ texto: '+ Programar auditoría', clase: 'js-sgc-nueva-aud' }) : '') +
      '</div>' + kpis +
      '<div class="sgc-filtros">' +
        '<label class="sigso-campo"><span class="sigso-campo__label">Año</span>' +
        '<select id="sgc-aud-anio"><option value="">Todos</option>' + opciones + '</select></label>' +
      '</div>';

    function wire() {
      wireSecciones_(cont);
      var nueva = cont.querySelector('.js-sgc-nueva-aud');
      if (nueva) nueva.addEventListener('click', abrirFormularioAuditoria_);
      var sel = cont.querySelector('#sgc-aud-anio');
      if (sel) sel.addEventListener('change', function () { filtroAnioAud_ = this.value; cargarAuditorias_(); });
      cont.querySelectorAll('.js-sgc-abrir-aud').forEach(function (btn) {
        btn.addEventListener('click', function () { abrirAuditoria_(btn.getAttribute('data-id')); });
      });
    }

    if (lista.length === 0) {
      cont.innerHTML = cabecera + Componentes.vacio({
        texto: 'Todavía no hay auditorías en el programa.',
        detalle: 'El §9.2 de la norma pide auditar todos los procesos dentro del período.'
      });
      wire();
      return;
    }

    var filas = lista.map(function (a) {
      var cerrada = a.estado === 'CERRADA' || a.estado === 'ANULADA';
      return '<button type="button" class="sgc-doc js-sgc-abrir-aud' +
        (a.informe_vencido ? ' sgc-nc--vencida' : (cerrada ? ' sgc-doc--obsoleto' : '')) +
        '" data-id="' + a.auditoria_id + '">' +
        '<div class="sgc-doc__top">' +
          '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(a.correlativo) + '</span>' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(a.proceso) + '</span>' +
          Componentes.badge(ESTADO_AUD_ETIQUETA[a.estado] || a.estado, cerrada ? 'neutro' : 'info') +
          (a.informe_vencido ? Componentes.badge('Informe atrasado', 'critico') : '') +
          (a.nc_pendientes ? Componentes.badge(a.nc_pendientes + ' NC por levantar', 'alerta') : '') +
        '</div>' +
        '<div class="sgc-doc__meta">' +
          (a.area_id ? '<span>' + Componentes.escaparHtml(a.area_id) + '</span>' : '') +
          '<span>Auditor: ' + Componentes.escaparHtml(a.auditor_email) + '</span>' +
          '<span>' + (a.fecha_ejecucion
            ? 'Realizada ' + fechaCorta_(a.fecha_ejecucion)
            : 'Programada ' + fechaCorta_(a.fecha_programada)) + '</span>' +
          (a.verificaciones
            ? '<span>' + a.verificaciones + ' cláusula(s) verificada(s)</span>'
            : '<span>' + a.clausulas.length + ' cláusula(s) en alcance</span>') +
          (a.no_conformidades ? '<span>' + a.no_conformidades + ' no conformidad(es)</span>' : '') +
        '</div>' +
      '</button>';
    }).join('');

    cont.innerHTML = cabecera + '<div class="sgc-lista">' + filas + '</div>';
    wire();
  }

  // --- ficha de la auditoría --------------------------------------------------

  function abrirAuditoria_(id) {
    auditoriaActivaId_ = id;
    var cont = panelSgc_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando auditoría...');
    api_('getDetalleAuditoriaSgc', { auditoria_id: id }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo abrir.', 'error');
        return;
      }
      clausulasCatalogo_ = respuesta.data.clausulas_catalogo || [];
      preguntasCatalogo_ = respuesta.data.preguntas_catalogo || {};
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarFichaAuditoria_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
    });
  }

  function pintarFichaAuditoria_(cont, data) {
    var aud = data.auditoria;
    var r = data.resumen;
    var audita = data.puede_auditar === true;
    var gestiona = data.puede_gestionar === true;
    var cerrada = aud.estado === 'CERRADA' || aud.estado === 'ANULADA';
    var enCurso = aud.estado === 'PLANIFICADA' || aud.estado === 'EJECUTADA';

    // 1) Plan
    var planificada = aud.estado !== 'PROGRAMADA';
    var ant = r.anticipacion_plan;
    var e1 = etapaNc_(1, 'Plan de auditoría', planificada,
      (planificada
        ? '<dl class="sgc-ficha">' +
            campoFicha_('Objetivo', aud.objetivo) +
            campoFicha_('Alcance', aud.alcance) +
            campoFicha_('Criterios', aud.criterios) +
            campoFicha_('Se realiza', fechaCorta_(aud.fecha_ejecucion)) +
            campoFicha_('Auditados', (data.auditados || []).join(', ')) +
          '</dl>' +
          (ant
            ? '<p class="sigso-ayuda">Plan comunicado con ' + ant.dias_naturales + ' día(s) de anticipación' +
              (ant.suficiente ? '.' : ' — PRO-03 pide 5 días hábiles.') + '</p>'
            : '')
        : '<p class="sigso-ayuda">Objetivo, alcance, criterios y a quiénes se audita. Al guardarlo se les avisa.</p>'),
      audita && ['PROGRAMADA', 'PLANIFICADA'].indexOf(aud.estado) !== -1
        ? '<div class="sgc-acciones">' +
            Componentes.boton({
              texto: planificada ? 'Editar plan' : 'Definir plan',
              variante: planificada ? 'secundario' : 'primario', clase: 'js-aud-plan'
            }) +
          '</div>'
        : '');

    // 2) Lista de verificación
    var e2 = etapaNc_(2, 'Lista de verificación', r.verificaciones > 0,
      (r.verificaciones
        ? '<div class="sgc-conteos">' +
            Componentes.badge(r.conformes + ' conforme(s)', 'ok') +
            (r.observaciones ? Componentes.badge(r.observaciones + ' observación(es)', 'alerta') : '') +
            (r.no_conformidades ? Componentes.badge(r.no_conformidades + ' no conformidad(es)', 'critico') : '') +
            (r.oportunidades ? Componentes.badge(r.oportunidades + ' oportunidad(es)', 'info') : '') +
          '</div>' + tablaHallazgos_(data, audita, gestiona)
        : '<p class="sigso-ayuda">Cláusula por cláusula: qué se revisó, con qué evidencia y qué se encontró. ' +
          'Una cláusula conforme también se registra: es la evidencia de que se revisó.</p>'),
      audita && enCurso
        ? '<div class="sgc-acciones">' +
            Componentes.boton({ texto: '+ Verificar cláusula', clase: 'js-aud-hallazgo' }) +
            (aud.estado === 'PLANIFICADA' && r.verificaciones
              ? Componentes.boton({ texto: '✓ Terminar la auditoría', variante: 'secundario', clase: 'js-aud-ejecutada' })
              : '') +
          '</div>'
        : '');

    // 3) Informe
    var entrevistados = (aud.personas_entrevistadas || []);
    var resumenNc = data.informe_resumen_nc || [];
    var e3 = etapaNc_(3, 'Informe', !!aud.informe_fecha,
      (aud.informe_fecha
        ? '<p>' + Componentes.escaparHtml(aud.informe_conclusion) + '</p>' +
          '<p class="sigso-ayuda">Emitido el ' + fechaCorta_(aud.informe_fecha) + '.</p>' +
          (entrevistados.length
            ? '<p class="sigso-ayuda"><b>Personas entrevistadas:</b> ' +
              entrevistados.map(Componentes.escaparHtml).join(' · ') + '</p>'
            : '') +
          (resumenNc.length
            ? '<h4 class="sgc-sub">Resumen de no conformidades</h4>' +
              '<div class="sgc-hallazgos">' + resumenNc.map(function (n) {
                return '<div class="sgc-hallazgo sgc-hallazgo--no_conformidad">' +
                  '<div class="sgc-doc__top">' +
                    '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(n.nc_correlativo) + '</span>' +
                    '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(n.punto_normativo) + '</span>' +
                  '</div>' +
                  '<p>' + Componentes.escaparHtml(n.no_conformidad) + '</p>' +
                  (n.evidencia_objetiva ? '<p class="sigso-ayuda">Evidencia: ' + Componentes.escaparHtml(n.evidencia_objetiva) + '</p>' : '') +
                '</div>';
              }).join('') + '</div>'
            : '')
        : '<p class="sigso-ayuda">La conclusión de la auditoría. PRO-03 da 10 días hábiles desde que se realiza' +
          (aud.informe_plazo ? ', vence el ' + fechaCorta_(aud.informe_plazo) : '') + '.</p>'),
      audita && aud.estado === 'EJECUTADA'
        ? '<div class="sgc-acciones">' +
            Componentes.boton({ texto: 'Emitir informe', clase: 'js-aud-informe' }) +
          '</div>'
        : '');

    // 4) Cierre
    var e4 = etapaNc_(4, 'Cierre', aud.estado === 'CERRADA',
      (aud.estado === 'CERRADA'
        ? '<p class="sigso-ayuda">Cerrada el ' + fechaCorta_(aud.fecha_cierre) + '.</p>'
        : (r.nc_pendientes
            ? Componentes.alerta((r.nc_pendientes === 1
                ? 'Falta 1 no conformidad por levantar. '
                : 'Faltan ' + r.nc_pendientes + ' no conformidades por levantar. ') +
              'Una auditoría no se cierra dejando hallazgos sin canalizar.', 'aviso')
            : '<p class="sigso-ayuda">Se cierra cuando cada hallazgo de no conformidad ya tiene su NC.</p>')),
      gestiona && aud.estado === 'INFORMADA' && !r.nc_pendientes
        ? '<div class="sgc-acciones">' +
            Componentes.boton({ texto: 'Cerrar auditoría', clase: 'js-aud-cerrar' }) +
          '</div>'
        : '');

    cont.innerHTML =
      '<div class="sgc-detalle-cab">' +
        Componentes.boton({ texto: '← Auditorías', variante: 'sutil', clase: 'js-aud-volver' }) +
        '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(aud.correlativo) + '</span>' +
        '<h1>' + Componentes.escaparHtml(aud.proceso) + '</h1>' +
        Componentes.badge(ESTADO_AUD_ETIQUETA[aud.estado] || aud.estado, cerrada ? 'neutro' : 'info') +
        (r.informe_vencido ? Componentes.badge('Informe atrasado', 'critico') : '') +
      '</div>' +
      '<div class="sgc-cuerpo">' +
        '<dl class="sgc-ficha">' +
          campoFicha_('Área', aud.area_id) +
          campoFicha_('Auditor', aud.auditor_email) +
          campoFicha_('Equipo auditor', (aud.coauditores || []).join(', ')) +
          campoFicha_('Programada', fechaCorta_(aud.fecha_programada)) +
          campoFicha_('Cláusulas en alcance', (data.clausulas_alcance || []).join(' · ')) +
        '</dl>' +
        '<div class="sgc-etapas">' + e1 + e2 + e3 + e4 + '</div>' +
        (gestiona && !cerrada
          ? '<div class="sgc-acciones">' +
              Componentes.boton({ texto: 'Anular', variante: 'peligro', clase: 'js-aud-anular' }) +
            '</div>'
          : '') +
      '</div>';

    cont.querySelector('.js-aud-volver').addEventListener('click', cargarAuditorias_);
    wireFichaAuditoria_(cont, aud, data);
  }

  // La lista de verificación. Cada fila lleva su resultado y, si es una no
  // conformidad, el botón que la convierte en NC (o el enlace a la que ya
  // existe): ése es el eslabón que hace que la auditoría sirva de algo.
  function tablaHallazgos_(data, audita, gestiona) {
    var editable = ['PLANIFICADA', 'EJECUTADA'].indexOf(data.auditoria.estado) !== -1;
    return '<div class="sgc-hallazgos">' + (data.hallazgos || []).map(function (h) {
      return '<div class="sgc-hallazgo sgc-hallazgo--' + h.resultado.toLowerCase() + '">' +
        '<div class="sgc-doc__top">' +
          '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(h.clausula) + '</span>' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(h.clausula_titulo) + '</span>' +
          Componentes.badge(RESULTADO_HALLAZGO_ETIQUETA[h.resultado] || h.resultado,
            RESULTADO_HALLAZGO_TONO[h.resultado] || 'neutro') +
        '</div>' +
        '<p>' + Componentes.escaparHtml(h.aspecto_verificado) + '</p>' +
        (h.evidencia ? '<p class="sigso-ayuda">Evidencia: ' + Componentes.escaparHtml(h.evidencia) + '</p>' : '') +
        (h.descripcion ? '<p>' + Componentes.escaparHtml(h.descripcion) + '</p>' : '') +
        (h.nc_correlativo
          ? '<p class="sigso-ayuda">→ ' + Componentes.escaparHtml(h.nc_correlativo) + ' (' +
            Componentes.escaparHtml(ESTADO_NC_ETIQUETA[h.nc_estado] || h.nc_estado) + ')</p>'
          : '') +
        '<div class="sgc-acciones">' +
          (gestiona && !h.nc_id && ['NO_CONFORMIDAD', 'OBSERVACION'].indexOf(h.resultado) !== -1
            ? Componentes.boton({
                texto: 'Levantar no conformidad', clase: 'js-aud-a-nc',
                variante: h.resultado === 'NO_CONFORMIDAD' ? 'primario' : 'secundario'
              }).replace('<button ', '<button data-hallazgo="' + h.hallazgo_id + '" ')
            : '') +
          (audita && editable && !h.nc_id
            ? Componentes.boton({ texto: 'Editar', variante: 'sutil', clase: 'js-aud-editar-h' })
                .replace('<button ', '<button data-hallazgo="' + h.hallazgo_id + '" ') +
              Componentes.boton({ texto: 'Quitar', variante: 'sutil', clase: 'js-aud-quitar-h' })
                .replace('<button ', '<button data-hallazgo="' + h.hallazgo_id + '" ')
            : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function wireFichaAuditoria_(cont, aud, data) {
    function accion_(selector, fn) {
      var b = cont.querySelector(selector);
      if (b) b.addEventListener('click', fn);
    }
    function enviar_(accion, datos, exito) {
      api_(accion, datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        if (exito) Componentes.aviso({ texto: exito, tipo: 'exito' });
        abrirAuditoria_(aud.auditoria_id);
      });
    }

    accion_('.js-aud-plan', function () { abrirFormularioPlanAud_(aud, data); });
    accion_('.js-aud-hallazgo', function () { abrirFormularioHallazgo_(aud, data, null); });
    accion_('.js-aud-informe', function () { abrirFormularioInformeAud_(aud); });

    accion_('.js-aud-ejecutada', function () {
      Componentes.confirmar({
        titulo: 'Terminar la auditoría',
        mensaje: 'Después de esto la lista de verificación sigue editable, pero arranca el plazo de 10 días hábiles para el informe.'
      }).then(function (ok) {
        if (ok) enviar_('cerrarEjecucionAuditoriaSgc', { auditoria_id: aud.auditoria_id });
      });
    });
    accion_('.js-aud-cerrar', function () {
      Componentes.confirmar({
        titulo: 'Cerrar la auditoría',
        mensaje: 'Todos los hallazgos ya están canalizados. La auditoría queda como evidencia cerrada.'
      }).then(function (ok) {
        if (ok) enviar_('cerrarAuditoriaSgc', { auditoria_id: aud.auditoria_id }, 'Auditoría cerrada.');
      });
    });
    accion_('.js-aud-anular', function () {
      Componentes.prompt({
        titulo: 'Anular auditoría',
        mensaje: '¿Por qué se anula? Queda registrado (la auditoría no se borra).'
      }).then(function (motivo) {
        if (motivo && String(motivo).trim()) {
          enviar_('anularAuditoriaSgc', { auditoria_id: aud.auditoria_id, motivo: motivo });
        }
      });
    });

    cont.querySelectorAll('.js-aud-a-nc').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Componentes.confirmar({
          titulo: 'Levantar no conformidad',
          mensaje: 'Se crea la no conformidad con este hallazgo como origen, y de ahí sale la acción correctiva.'
        }).then(function (ok) {
          if (ok) {
            enviar_('convertirHallazgoEnNcSgc', { hallazgo_id: btn.getAttribute('data-hallazgo') },
              'No conformidad creada desde el hallazgo.');
          }
        });
      });
    });
    cont.querySelectorAll('.js-aud-editar-h').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-hallazgo');
        var h = (data.hallazgos || []).filter(function (x) { return x.hallazgo_id === id; })[0];
        abrirFormularioHallazgo_(aud, data, h);
      });
    });
    cont.querySelectorAll('.js-aud-quitar-h').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Componentes.confirmar({
          titulo: 'Quitar de la lista',
          mensaje: 'Se saca de la lista de verificación. Queda en el registro del sistema.',
          peligro: true
        }).then(function (ok) {
          if (ok) enviar_('eliminarHallazgoSgc', { hallazgo_id: btn.getAttribute('data-hallazgo') });
        });
      });
    });
  }

  // --- formularios de auditoría -----------------------------------------------

  function selectorClausulas_(seleccionadas) {
    var marcadas = seleccionadas || [];
    return '<fieldset class="sgc-clausulas"><legend>Cláusulas de la norma a auditar</legend>' +
      clausulasCatalogo_.map(function (c) {
        return '<label class="sigso-campo-check"><input type="checkbox" class="js-aud-clausula" value="' +
          c.codigo + '"' + (marcadas.indexOf(c.codigo) !== -1 ? ' checked' : '') + '> <b>' +
          Componentes.escaparHtml(c.codigo) + '</b> ' + Componentes.escaparHtml(c.titulo) + '</label>';
      }).join('') + '</fieldset>';
  }

  function clausulasMarcadas_() {
    return Array.prototype.slice.call(document.querySelectorAll('.js-aud-clausula:checked'))
      .map(function (c) { return c.value; });
  }

  function abrirFormularioAuditoria_() {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Programar auditoría interna</h3>' +
        '<form id="form-aud">' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'aud-proceso', label: 'Proceso a auditar', requerido: true,
              placeholder: 'Ej: Gestión de personas' }) +
            Componentes.campoTexto({ id: 'aud-area', label: 'Área', placeholder: 'Ej: RRHH' }) +
          '</div>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'aud-auditor', label: 'Auditor', tipo: 'email', requerido: true,
              placeholder: 'De otra área: nadie audita su propio trabajo' }) +
            Componentes.campoTexto({ id: 'aud-fecha', label: 'Fecha planeada', tipo: 'date', requerido: true }) +
          '</div>' +
          selectorClausulas_([]) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Programar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-aud').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var clausulas = clausulasMarcadas_();
      if (!clausulas.length) {
        Componentes.aviso({ texto: 'Elige al menos una cláusula a auditar.', tipo: 'error' });
        return;
      }
      api_('programarAuditoriaSgc', {
        proceso: document.getElementById('aud-proceso').value,
        area_id: document.getElementById('aud-area').value,
        auditor_email: document.getElementById('aud-auditor').value,
        fecha_programada: document.getElementById('aud-fecha').value,
        clausulas: clausulas
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo programar.', tipo: 'error' });
          return;
        }
        cerrar();
        cargarAuditorias_();
      });
    });
  }

  function abrirFormularioPlanAud_(aud, data) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Plan de auditoría</h3>' +
        '<p class="sigso-ayuda">Al guardarlo se le avisa a las personas auditadas. ' +
        'PRO-03 pide comunicarlo con 5 días hábiles de anticipación.</p>' +
        '<form id="form-aud-plan">' +
          Componentes.campoTextarea({ id: 'audp-objetivo', label: 'Objetivo', valor: aud.objetivo, requerido: true,
            placeholder: '¿Qué se quiere comprobar con esta auditoría?' }) +
          Componentes.campoTextarea({ id: 'audp-alcance', label: 'Alcance', valor: aud.alcance, requerido: true,
            placeholder: 'Qué queda dentro y qué no: período, sedes, registros.' }) +
          Componentes.campoTexto({ id: 'audp-criterios', label: 'Criterios', valor: aud.criterios,
            placeholder: 'Ej: ISO 9001:2015, PRO-02' }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'audp-auditados', label: 'Auditados (correos separados por coma)',
              valor: (data.auditados || []).join(', ') }) +
            Componentes.campoTexto({ id: 'audp-fecha', label: 'Fecha de realización', tipo: 'date',
              valor: fechaISO_(aud.fecha_ejecucion), requerido: true }) +
          '</div>' +
          Componentes.campoTexto({
            id: 'audp-coauditores', label: 'Resto del equipo auditor (correos separados por coma, opcional)',
            valor: (data.auditoria && data.auditoria.coauditores || []).join(', '),
            placeholder: 'El auditor líder ya está definido; aquí va el resto del equipo.'
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar y comunicar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-aud-plan').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var auditados = document.getElementById('audp-auditados').value
        .split(',').map(function (e) { return e.trim(); }).filter(Boolean);
      var coauditores = document.getElementById('audp-coauditores').value
        .split(',').map(function (e) { return e.trim(); }).filter(Boolean);
      api_('planificarAuditoriaSgc', {
        auditoria_id: aud.auditoria_id,
        objetivo: document.getElementById('audp-objetivo').value,
        alcance: document.getElementById('audp-alcance').value,
        criterios: document.getElementById('audp-criterios').value,
        auditados: auditados,
        coauditores: coauditores,
        fecha_ejecucion: document.getElementById('audp-fecha').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar el plan.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: 'Plan guardado y comunicado a los auditados.', tipo: 'exito' });
        abrirAuditoria_(aud.auditoria_id);
      });
    });
  }

  function abrirFormularioHallazgo_(aud, data, hallazgo) {
    var enAlcance = data.clausulas_alcance || [];
    // Se ofrecen primero las cláusulas del alcance, pero no se limita a
    // ellas: una auditoría puede encontrar algo fuera de lo planeado, y eso
    // no se puede perder.
    var opciones = clausulasCatalogo_.map(function (c) {
      return {
        valor: c.codigo,
        texto: c.codigo + ' — ' + c.titulo + (enAlcance.indexOf(c.codigo) === -1 ? ' (fuera del alcance)' : '')
      };
    });
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">' + (hallazgo ? 'Editar verificación' : 'Verificar cláusula') + '</h3>' +
        '<form id="form-aud-h">' +
          '<div class="sgc-form-fila">' +
            Componentes.campoSelect({ id: 'audh-clausula', label: 'Cláusula', placeholder: false,
              valor: hallazgo ? hallazgo.clausula : (enAlcance[0] || ''), opciones: opciones }) +
            Componentes.campoSelect({ id: 'audh-resultado', label: 'Resultado', placeholder: false,
              valor: hallazgo ? hallazgo.resultado : 'CONFORME',
              opciones: Object.keys(RESULTADO_HALLAZGO_ETIQUETA).map(function (k) {
                return { valor: k, texto: RESULTADO_HALLAZGO_ETIQUETA[k] };
              }) }) +
          '</div>' +
          '<div class="sigso-campo" id="audh-preguntas-cont"></div>' +
          Componentes.campoTextarea({ id: 'audh-aspecto', label: 'Qué se verificó', requerido: true,
            valor: hallazgo ? hallazgo.aspecto_verificado : '',
            placeholder: 'Ej: evaluaciones de competencia del personal del área.' }) +
          Componentes.campoTextarea({ id: 'audh-evidencia', label: 'Evidencia revisada',
            valor: hallazgo ? hallazgo.evidencia : '',
            placeholder: 'Qué documentos o registros se miraron, y cuántos.' }) +
          Componentes.campoTextarea({ id: 'audh-descripcion', label: 'Hallazgo',
            valor: hallazgo ? hallazgo.descripcion : '',
            placeholder: 'Obligatorio si no es conforme: es lo que después se convierte en no conformidad.' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    // Al elegir la cláusula, se ofrecen las preguntas reales del FO-PRO-03-04
    // como sugerencia -- elegir una copia su texto al campo "Qué se
    // verificó" (editable después). Si la cláusula no tiene preguntas en el
    // catálogo (ej. 4.4), el selector simplemente no aparece.
    function repoblarPreguntas_() {
      var clausula = document.getElementById('audh-clausula').value;
      var preguntas = preguntasCatalogo_[clausula] || [];
      var elCont = document.getElementById('audh-preguntas-cont');
      if (!preguntas.length) { elCont.innerHTML = ''; return; }
      elCont.innerHTML = Componentes.campoSelect({
        id: 'audh-pregunta', label: 'Elegir de la lista de verificación (opcional)',
        opciones: preguntas.map(function (p) { return { valor: p, texto: p.length > 90 ? p.slice(0, 90) + '…' : p }; })
      });
      document.getElementById('audh-pregunta').addEventListener('change', function () {
        if (this.value) document.getElementById('audh-aspecto').value = this.value;
      });
    }
    document.getElementById('audh-clausula').addEventListener('change', repoblarPreguntas_);
    repoblarPreguntas_();

    document.getElementById('form-aud-h').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var datos = {
        auditoria_id: aud.auditoria_id,
        clausula: document.getElementById('audh-clausula').value,
        resultado: document.getElementById('audh-resultado').value,
        aspecto_verificado: document.getElementById('audh-aspecto').value,
        evidencia: document.getElementById('audh-evidencia').value,
        descripcion: document.getElementById('audh-descripcion').value
      };
      if (hallazgo) datos.hallazgo_id = hallazgo.hallazgo_id;
      api_('registrarHallazgoSgc', datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirAuditoria_(aud.auditoria_id);
      });
    });
  }

  function abrirFormularioInformeAud_(aud) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Informe de auditoría</h3>' +
        '<p class="sigso-ayuda">La conclusión sobre el proceso auditado. Al emitirlo se avisa a los auditados ' +
        'y al Encargado SGC, y la lista de verificación queda cerrada.</p>' +
        '<form id="form-aud-inf">' +
          Componentes.campoTextarea({ id: 'audi-conclusion', label: 'Conclusión', requerido: true,
            placeholder: '¿El proceso cumple los requisitos? ¿Qué es lo más relevante que se encontró?' }) +
          Componentes.campoTextarea({
            id: 'audi-entrevistados', label: 'Personas entrevistadas (una por línea: "Nombre - Cargo")',
            placeholder: 'Lisseth Vilchez - Encargada de Administración'
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Emitir informe', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-aud-inf').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('emitirInformeAuditoriaSgc', {
        auditoria_id: aud.auditoria_id,
        conclusion: document.getElementById('audi-conclusion').value,
        personas_entrevistadas: lineasNoVacias_(document.getElementById('audi-entrevistados').value)
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo emitir.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: 'Informe emitido.', tipo: 'exito' });
        abrirAuditoria_(aud.auditoria_id);
      });
    });
  }

  // ==========================================================================
  // QUEJAS, FELICITACIONES Y CONSULTAS (Fase 4, PRO-07) — la Parte 1 la
  // llena el cliente sin cuenta desde frontend/quejas.html; esta sección
  // gestiona las Partes 2 a 5: registro interno, investigación (con la
  // misma imparcialidad que la auditoría interna), resolución, notificación
  // y seguimiento.
  // ==========================================================================

  var TIPO_QUEJA_ETIQUETA = { QUEJA: 'Queja', RECLAMACION: 'Reclamación', FELICITACION: 'Felicitación', CONSULTA: 'Consulta' };
  var TIPO_QUEJA_TONO = { QUEJA: 'critico', RECLAMACION: 'critico', FELICITACION: 'ok', CONSULTA: 'info' };
  var ESTADO_QUEJA_ETIQUETA = {
    RECIBIDA: 'Recibida', NO_PROCEDE: 'No procede', EN_INVESTIGACION: 'En investigación',
    NO_VALIDA: 'No válida', EN_RESOLUCION: 'En resolución', RESUELTA: 'Resuelta',
    NOTIFICADA: 'Notificada', CERRADA: 'Cerrada', REABIERTA: 'Reabierta', ANULADA: 'Anulada'
  };
  var AREA_QUEJA_ETIQUETA = {
    RRHH: 'RRHH', CONTABILIDAD: 'Contabilidad', PREVENCION: 'Prevención de Riesgos',
    MARKETING: 'Marketing', ADMINISTRACION: 'Administración', OTRO: 'Otro'
  };

  var filtroQuejasAbiertas_ = false;

  function cargarQuejas_() {
    quejaActivaId_ = null;
    cargarListadoSgc_({
      clave: 'quejas', accion: 'listarQuejasSgc', datos: filtroQuejasAbiertas_ ? { abiertas: true } : {},
      spinner: 'Cargando quejas...',
      sigo: function () { return seccionActiva_ === 'quejas' && !quejaActivaId_; },
      aplicar: function (cont, data) {
        puedeGestionar_ = data.puede_gestionar === true;
        cacheListadoSgc_.quejas = data;
        pintarQuejas_(cont, data);
      },
      error: function (cont, msg) {
        cont.innerHTML = Componentes.alerta(msg || 'No se pudo conectar para cargar las quejas.', 'error');
      }
    });
  }

  function pintarQuejas_(cont, data) {
    var lista = data.quejas || [];
    var ind = data.indicadores || {};

    var kpis = '<div class="sgc-kpis">' + [
      Componentes.kpi({ etiqueta: 'Este año', valor: ind.total_anio || 0 }),
      Componentes.kpi({ etiqueta: 'Quejas/reclamos', valor: ind.quejas_anio || 0 }),
      Componentes.kpi({ etiqueta: 'Felicitaciones', valor: ind.felicitaciones_anio || 0 }),
      Componentes.kpi({ etiqueta: 'Consultas', valor: ind.consultas_anio || 0 }),
      Componentes.kpi({ etiqueta: 'Abiertas', valor: ind.abiertas || 0 }),
      Componentes.kpi({ etiqueta: 'Con plazo vencido', valor: ind.vencidas || 0 })
    ].join('') + '</div>';

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Formulario público en <code>quejas.html</code>. El plazo de respuesta ' +
      'es de 30 días corridos desde que se valida la queja.</p>' +
      '</div>' + kpis +
      '<div class="sgc-filtros">' +
        '<label class="sigso-campo-check"><input type="checkbox" id="sgc-q-abiertas"' +
          (filtroQuejasAbiertas_ ? ' checked' : '') + '> Ver solo las abiertas</label>' +
      '</div>';

    function wire() {
      wireSecciones_(cont);
      var chk = cont.querySelector('#sgc-q-abiertas');
      if (chk) chk.addEventListener('change', function () { filtroQuejasAbiertas_ = this.checked; cargarQuejas_(); });
      cont.querySelectorAll('.js-sgc-abrir-queja').forEach(function (btn) {
        btn.addEventListener('click', function () { abrirQueja_(btn.getAttribute('data-id')); });
      });
    }

    if (lista.length === 0) {
      cont.innerHTML = cabecera + Componentes.vacio({
        texto: filtroQuejasAbiertas_ ? 'No hay quejas abiertas.' : 'Todavía no hay quejas, felicitaciones ni consultas registradas.',
        detalle: 'Llegan solas desde el formulario público del sitio.'
      });
      wire();
      return;
    }

    var filas = lista.map(function (q) {
      var cerrada = ['CERRADA', 'NO_PROCEDE', 'NO_VALIDA', 'ANULADA'].indexOf(q.estado) !== -1;
      return '<button type="button" class="sgc-doc js-sgc-abrir-queja' +
        (q.vencida ? ' sgc-nc--vencida' : (cerrada ? ' sgc-doc--obsoleto' : '')) +
        '" data-id="' + q.queja_id + '">' +
        '<div class="sgc-doc__top">' +
          '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(q.correlativo) + '</span>' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(q.nombre_completo) +
            (q.empresa ? ' (' + Componentes.escaparHtml(q.empresa) + ')' : '') + '</span>' +
          Componentes.badge(TIPO_QUEJA_ETIQUETA[q.tipo] || q.tipo, TIPO_QUEJA_TONO[q.tipo] || 'neutro') +
          Componentes.badge(ESTADO_QUEJA_ETIQUETA[q.estado] || q.estado, cerrada ? 'neutro' : 'info') +
          (q.vencida ? Componentes.badge('Vencida', 'critico') : '') +
          (q.tiene_nc ? Componentes.badge('Con NC', 'alerta') : '') +
        '</div>' +
        '<div class="sgc-doc__meta">' +
          '<span>' + Componentes.escaparHtml(AREA_QUEJA_ETIQUETA[q.area] || q.area) + '</span>' +
          '<span>Recibida ' + fechaCorta_(q.fecha_envio) + '</span>' +
          (q.investigador_email ? '<span>Investiga: ' + Componentes.escaparHtml(q.investigador_email) + '</span>' : '') +
          (q.etapa_actual
            ? '<span>' + Componentes.escaparHtml(q.etapa_actual) +
              (q.dias_para_plazo !== null
                ? (q.dias_para_plazo < 0 ? ' · vencida hace ' + (-q.dias_para_plazo) + ' d' : ' · ' + q.dias_para_plazo + ' d')
                : '') + '</span>'
            : '') +
        '</div>' +
        '<p class="sigso-ayuda">' + Componentes.escaparHtml(String(q.descripcion).slice(0, 140)) + '</p>' +
      '</button>';
    }).join('');

    cont.innerHTML = cabecera + '<div class="sgc-lista">' + filas + '</div>';
    wire();
  }

  // --- ficha de la queja: las cinco partes del FO-PRO-07-01 -------------------

  function abrirQueja_(id) {
    quejaActivaId_ = id;
    var cont = panelSgc_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando queja...');
    api_('getDetalleQuejaSgc', { queja_id: id }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo abrir.', 'error');
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarFichaQueja_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
    });
  }

  function pintarFichaQueja_(cont, data) {
    var q = data.queja;
    var puede = data.puede_gestionar === true;
    var puedeInvestigar = data.puede_investigar === true;
    var cerrada = ['CERRADA', 'NO_PROCEDE', 'NO_VALIDA', 'ANULADA'].indexOf(q.estado) !== -1;

    // 1) Recepción
    var e1 = etapaNc_(1, 'Recepción', !!q.fecha_recepcion,
      (q.fecha_recepcion
        ? '<p>' + (q.procede === true || q.procede === 'TRUE'
            ? Componentes.badge('Procede', 'ok')
            : Componentes.badge('No procede', 'critico') + ' — ' + Componentes.escaparHtml(q.motivo_no_procede)) + '</p>' +
          '<p class="sigso-ayuda">Registrada el ' + fechaCorta_(q.fecha_recepcion) + ' por ' + Componentes.escaparHtml(q.registrado_por) + '.</p>'
        : '<p class="sigso-ayuda">¿El servicio está vigente (o dentro de los 30 días post-término) y no suspendido por falta de pago?</p>'),
      puede && q.estado === 'RECIBIDA'
        ? '<div class="sgc-acciones">' + Componentes.boton({ texto: 'Registrar recepción', clase: 'js-q-recepcion' }) + '</div>'
        : '');

    // 2) Investigación
    var e2 = etapaNc_(2, 'Investigación',
      q.estado !== 'RECIBIDA' && q.estado !== 'NO_PROCEDE' && !!q.resultado_investigacion,
      (q.estado === 'RECIBIDA' || q.estado === 'NO_PROCEDE'
        ? '<p class="sigso-ayuda">Quién investiga no puede ser del área que originó la queja (PRO-07 §6.2).</p>'
        : (q.investigador_email
            ? '<p class="sigso-ayuda">Investiga: <b>' + Componentes.escaparHtml(q.investigador_email) + '</b></p>' +
              (q.resultado_investigacion
                ? '<p>' + Componentes.escaparHtml(q.resultado_investigacion) + '</p>' +
                  '<p>' + (q.valida === true || q.valida === 'TRUE' ? Componentes.badge('Válida', 'ok') : Componentes.badge('No válida', 'critico')) + '</p>'
                : '<p class="sigso-ayuda">Investigación en curso.</p>')
            : '<p class="sigso-ayuda">Falta asignar quién investiga.</p>')),
      puede && q.estado === 'EN_INVESTIGACION' && !q.investigador_email
        ? '<div class="sgc-acciones">' + Componentes.boton({ texto: 'Asignar investigador', clase: 'js-q-investigador' }) + '</div>'
        : (puedeInvestigar && q.estado === 'EN_INVESTIGACION' && q.investigador_email && !q.resultado_investigacion
            ? '<div class="sgc-acciones">' + Componentes.boton({ texto: 'Registrar resultado', clase: 'js-q-resultado' }) + '</div>'
            : ''));

    // 3) Resolución
    var e3 = etapaNc_(3, 'Resolución', !!q.fecha_resolucion,
      (q.accion_implementada && q.estado !== 'NO_VALIDA'
        ? '<p>' + Componentes.escaparHtml(q.accion_implementada) + '</p>' +
          (q.fecha_resolucion ? '<p class="sigso-ayuda">Resuelta el ' + fechaCorta_(q.fecha_resolucion) + '.</p>' : '') +
          (data.nc_correlativo
            ? '<p class="sigso-ayuda">→ ' + Componentes.escaparHtml(data.nc_correlativo) + ' (' +
              Componentes.escaparHtml(ESTADO_NC_ETIQUETA[data.nc_estado] || data.nc_estado) + ')</p>'
            : '')
        : '<p class="sigso-ayuda">Qué se hizo para resolverlo. Plazo: 30 días corridos desde que se validó' +
          (q.resolucion_plazo ? ', vence el ' + fechaCorta_(q.resolucion_plazo) : '') + '.</p>'),
      puede && q.estado === 'EN_RESOLUCION'
        ? '<div class="sgc-acciones">' + Componentes.boton({ texto: 'Registrar resolución', clase: 'js-q-resolucion' }) + '</div>'
        : (puede && q.estado === 'RESUELTA' && !q.nc_id
            ? '<div class="sgc-acciones">' + Componentes.boton({ texto: 'Levantar no conformidad', variante: 'secundario', clase: 'js-q-a-nc' }) + '</div>'
            : ''));

    // 4) Notificación
    var e4 = etapaNc_(4, 'Notificación al cliente', !!q.fecha_notificacion,
      (q.fecha_notificacion
        ? '<p class="sigso-ayuda">Notificada el ' + fechaCorta_(q.fecha_notificacion) +
          '. Revisó: ' + Componentes.escaparHtml(q.revisado_por) + '.</p>'
        : '<p class="sigso-ayuda">Se le envía al cliente la respuesta final. La decisión la revisa alguien no involucrado en el origen.</p>'),
      puede && q.estado === 'RESUELTA'
        ? '<div class="sgc-acciones">' + Componentes.boton({ texto: 'Notificar al cliente', clase: 'js-q-notificar' }) + '</div>'
        : '');

    // 5) Seguimiento
    var e5 = etapaNc_(5, 'Seguimiento', !!q.fecha_seguimiento,
      (q.fecha_seguimiento
        ? '<p>' + (q.cliente_conforme === true || q.cliente_conforme === 'TRUE'
            ? Componentes.badge('Cliente conforme', 'ok') : Componentes.badge('No conforme — reabierta', 'critico')) + '</p>'
        : '<p class="sigso-ayuda">30 días corridos después de la respuesta: ¿el cliente quedó conforme?' +
          (q.seguimiento_plazo ? ' Vence el ' + fechaCorta_(q.seguimiento_plazo) + '.' : '') + '</p>'),
      puede && (q.estado === 'NOTIFICADA' || q.estado === 'REABIERTA')
        ? '<div class="sgc-acciones">' + Componentes.boton({ texto: 'Registrar seguimiento', clase: 'js-q-seguimiento' }) + '</div>'
        : '');

    cont.innerHTML =
      '<div class="sgc-detalle-cab">' +
        Componentes.boton({ texto: '← Quejas', variante: 'sutil', clase: 'js-q-volver' }) +
        '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(q.correlativo) + '</span>' +
        '<h1>' + Componentes.escaparHtml(q.nombre_completo) + '</h1>' +
        Componentes.badge(TIPO_QUEJA_ETIQUETA[q.tipo] || q.tipo, TIPO_QUEJA_TONO[q.tipo] || 'neutro') +
        Componentes.badge(ESTADO_QUEJA_ETIQUETA[q.estado] || q.estado, cerrada ? 'neutro' : 'info') +
        (data.resumen && data.resumen.vencida ? Componentes.badge('Plazo vencido', 'critico') : '') +
      '</div>' +
      '<div class="sgc-cuerpo">' +
        '<dl class="sgc-ficha">' +
          campoFicha_('Empresa', q.empresa) +
          campoFicha_('RUT', q.rut) +
          campoFicha_('Correo', q.email) +
          campoFicha_('Teléfono', q.telefono) +
          campoFicha_('Área', AREA_QUEJA_ETIQUETA[q.area] || q.area) +
          campoFicha_('Canal', q.canal) +
          campoFicha_('Recibida', fechaCorta_(q.fecha_envio)) +
        '</dl>' +
        '<p>' + Componentes.escaparHtml(q.descripcion) + '</p>' +
        '<div class="sgc-etapas">' + e1 + e2 + e3 + e4 + e5 + '</div>' +
        (puede && !cerrada
          ? '<div class="sgc-acciones">' + Componentes.boton({ texto: 'Anular', variante: 'peligro', clase: 'js-q-anular' }) + '</div>'
          : '') +
      '</div>';

    cont.querySelector('.js-q-volver').addEventListener('click', cargarQuejas_);
    wireFichaQueja_(cont, q, data);
  }

  function wireFichaQueja_(cont, q, data) {
    function accion_(selector, fn) {
      var b = cont.querySelector(selector);
      if (b) b.addEventListener('click', fn);
    }
    function enviar_(accion, datos, exito) {
      api_(accion, datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        if (exito) Componentes.aviso({ texto: exito, tipo: 'exito' });
        abrirQueja_(q.queja_id);
      });
    }

    accion_('.js-q-recepcion', function () { abrirFormularioRecepcionQueja_(q); });
    accion_('.js-q-investigador', function () { abrirFormularioInvestigadorQueja_(q); });
    accion_('.js-q-resultado', function () { abrirFormularioResultadoQueja_(q); });
    accion_('.js-q-resolucion', function () { abrirFormularioResolucionQueja_(q); });
    accion_('.js-q-notificar', function () { abrirFormularioNotificacionQueja_(q); });
    accion_('.js-q-seguimiento', function () { abrirFormularioSeguimientoQueja_(q); });

    accion_('.js-q-a-nc', function () {
      Componentes.confirmar({
        titulo: 'Levantar no conformidad',
        mensaje: 'Se crea la no conformidad con esta queja como origen, y de ahí sale la acción correctiva.'
      }).then(function (ok) {
        if (ok) {
          enviar_('convertirQuejaEnNcSgc', { queja_id: q.queja_id, responsable_email: q.investigador_email },
            'No conformidad creada desde la queja.');
        }
      });
    });
    accion_('.js-q-anular', function () {
      Componentes.prompt({
        titulo: 'Anular queja', mensaje: '¿Por qué se anula? Queda registrado (la queja no se borra).'
      }).then(function (motivo) {
        if (motivo && String(motivo).trim()) enviar_('anularQuejaSgc', { queja_id: q.queja_id, motivo: motivo });
      });
    });
  }

  // --- formularios de queja -----------------------------------------------------

  function abrirFormularioRecepcionQueja_(q) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Registrar recepción</h3>' +
        '<p class="sigso-ayuda">¿El servicio está vigente (o dentro de los 30 días post-término) y no suspendido por falta de pago?</p>' +
        '<form id="form-q-recepcion">' +
          Componentes.campoSelect({
            id: 'qr-procede', label: 'Procede', valor: 'SI', placeholder: false,
            opciones: [{ valor: 'SI', texto: 'Sí, procede' }, { valor: 'NO', texto: 'No procede' }]
          }) +
          Componentes.campoTextarea({ id: 'qr-motivo', label: 'Motivo (si no procede)' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-q-recepcion').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('registrarRecepcionQuejaSgc', {
        queja_id: q.queja_id,
        procede: document.getElementById('qr-procede').value === 'SI',
        motivo_no_procede: document.getElementById('qr-motivo').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirQueja_(q.queja_id);
      });
    });
  }

  function abrirFormularioInvestigadorQueja_(q) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Asignar investigador</h3>' +
        '<p class="sigso-ayuda">No puede ser de la misma área que originó la queja (' +
          Componentes.escaparHtml(AREA_QUEJA_ETIQUETA[q.area] || q.area) + ').</p>' +
        '<form id="form-q-investigador">' +
          Componentes.campoTexto({ id: 'qi-email', label: 'Investigador', tipo: 'email', requerido: true }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Asignar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-q-investigador').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('registrarInvestigacionQuejaSgc', {
        queja_id: q.queja_id, investigador_email: document.getElementById('qi-email').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo asignar.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirQueja_(q.queja_id);
      });
    });
  }

  function abrirFormularioResultadoQueja_(q) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Resultado de la investigación</h3>' +
        '<form id="form-q-resultado">' +
          Componentes.campoTextarea({ id: 'qres-resultado', label: 'Qué se encontró', requerido: true }) +
          Componentes.campoSelect({
            id: 'qres-valida', label: '¿La queja es válida?', valor: 'SI', placeholder: false,
            opciones: [{ valor: 'SI', texto: 'Sí, es válida' }, { valor: 'NO', texto: 'No es válida' }]
          }) +
          Componentes.campoTextarea({
            id: 'qres-justificacion', label: 'Justificación (si no es válida)',
            ayuda: 'Se adjunta a la respuesta que recibe el cliente.'
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-q-resultado').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('registrarResultadoQuejaSgc', {
        queja_id: q.queja_id,
        resultado_investigacion: document.getElementById('qres-resultado').value,
        valida: document.getElementById('qres-valida').value === 'SI',
        justificacion: document.getElementById('qres-justificacion').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirQueja_(q.queja_id);
      });
    });
  }

  function abrirFormularioResolucionQueja_(q) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Registrar resolución</h3>' +
        '<form id="form-q-resolucion">' +
          Componentes.campoTextarea({ id: 'qsol-accion', label: 'Acción o corrección implementada', requerido: true }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-q-resolucion').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('registrarResolucionQuejaSgc', {
        queja_id: q.queja_id, accion_implementada: document.getElementById('qsol-accion').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirQueja_(q.queja_id);
      });
    });
  }

  function abrirFormularioNotificacionQueja_(q) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Notificar al cliente</h3>' +
        '<p class="sigso-ayuda">Se envía por correo la respuesta final con la acción implementada.</p>' +
        '<form id="form-q-notificar">' +
          Componentes.campoTexto({
            id: 'qn-revisado', label: 'Revisado y aprobado por', tipo: 'email', requerido: true,
            placeholder: 'Persona no involucrada en el origen del mensaje'
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Notificar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-q-notificar').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('registrarNotificacionQuejaSgc', {
        queja_id: q.queja_id, revisado_por: document.getElementById('qn-revisado').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo notificar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: 'Cliente notificado.', tipo: 'exito' });
        abrirQueja_(q.queja_id);
      });
    });
  }

  function abrirFormularioSeguimientoQueja_(q) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Registrar seguimiento</h3>' +
        '<p class="sigso-ayuda">30 días corridos después de la respuesta: ¿el cliente quedó conforme?</p>' +
        '<form id="form-q-seguimiento">' +
          Componentes.campoSelect({
            id: 'qseg-conforme', label: 'Resultado', valor: 'SI', placeholder: false,
            opciones: [
              { valor: 'SI', texto: 'Sí, conforme — se cierra la queja' },
              { valor: 'NO', texto: 'No conforme — reabrir el caso' }
            ]
          }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);
    document.getElementById('form-q-seguimiento').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var conforme = document.getElementById('qseg-conforme').value === 'SI';
      api_('registrarSeguimientoQuejaSgc', {
        queja_id: q.queja_id, cliente_conforme: conforme
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: conforme ? 'Queja cerrada.' : 'Reabierta: hay que retomar la resolución.', tipo: conforme ? 'exito' : 'info' });
        abrirQueja_(q.queja_id);
      });
    });
  }

  // --- Proveedores (PRO-04) ---------------------------------------------------
  // El listado maestro (FO-PRO-04-01) no se edita a mano en la parte del
  // resultado: el estado y la nota los escribe la evaluacion (FO-PRO-04-02).
  // Por eso aca no hay ningun control para "marcar aprobado".

  var ESTADO_PROVEEDOR_ETIQUETA = {
    APROBADO: 'Aprobado', REPROBADO: 'Reprobado', SIN_EVALUAR: 'Sin evaluar'
  };
  var ESTADO_PROVEEDOR_TONO = {
    APROBADO: 'ok', REPROBADO: 'critico', SIN_EVALUAR: 'neutro'
  };
  var filtroProveedoresPendientes_ = false;

  function cargarProveedores_() {
    proveedorActivoId_ = null;
    cargarListadoSgc_({
      clave: 'proveedores', accion: 'listarProveedoresSgc', datos: {},
      spinner: 'Cargando proveedores...',
      sigo: function () { return seccionActiva_ === 'proveedores' && !proveedorActivoId_; },
      aplicar: function (cont, data) {
        puedeGestionar_ = data.puede_gestionar === true;
        cacheListadoSgc_.proveedores = data;
        pintarProveedores_(cont, data);
      },
      error: function (cont, msg) {
        cont.innerHTML = barraSecciones_() +
          Componentes.alerta(msg || 'No se pudo cargar el listado de proveedores.', 'error');
        wireSecciones_(cont);
      }
    });
  }

  function pintarProveedores_(cont, data) {
    var lista = data.proveedores || [];
    var ind = data.indicadores || {};

    var kpis = '<div class="sgc-kpis">' + [
      Componentes.kpi({ etiqueta: 'Proveedores', valor: ind.total || 0 }),
      Componentes.kpi({ etiqueta: 'Aprobados', valor: ind.aprobados || 0 }),
      Componentes.kpi({ etiqueta: 'Reprobados', valor: ind.reprobados || 0 }),
      Componentes.kpi({ etiqueta: 'Sin evaluar', valor: ind.sin_evaluar || 0 }),
      Componentes.kpi({ etiqueta: 'Por evaluar', valor: ind.por_evaluar || 0 })
    ].join('') + '</div>';

    var avisoUnicos = ind.unicos_reprobados
      ? Componentes.alerta(ind.unicos_reprobados + ' proveedor(es) único(s) están reprobados. ' +
          'No corresponde reemplazarlos: hay que pedirles una reunión para exigir mejoras (PRO-04 §6.2).', 'advertencia')
      : '';

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Listado de proveedores aprobados (FO-PRO-04-01). ' +
      'La evaluación es anual y el proveedor reprueba con promedio menor o igual a ' +
      (data.corte_aprobacion || 5) + '.</p>' +
      (puedeGestionar_
        ? Componentes.boton({ texto: '+ Nuevo proveedor', clase: 'js-sgc-nuevo-prov' })
        : '') +
      '</div>' + kpis + avisoUnicos +
      '<div class="sgc-filtros">' +
        '<label class="sigso-campo-check"><input type="checkbox" id="sgc-prov-pend"' +
          (filtroProveedoresPendientes_ ? ' checked' : '') + '> Ver solo los que faltan evaluar</label>' +
      '</div>';

    function wire() {
      wireSecciones_(cont);
      var chk = cont.querySelector('#sgc-prov-pend');
      if (chk) chk.addEventListener('change', function () {
        filtroProveedoresPendientes_ = this.checked;
        cargarProveedores_();
      });
      var nuevo = cont.querySelector('.js-sgc-nuevo-prov');
      if (nuevo) nuevo.addEventListener('click', function () { abrirFormularioProveedor_(null, data); });
      cont.querySelectorAll('.js-sgc-abrir-prov').forEach(function (btn) {
        btn.addEventListener('click', function () { abrirProveedor_(btn.getAttribute('data-id')); });
      });
    }

    var visibles = filtroProveedoresPendientes_
      ? lista.filter(function (p) { return p.evaluacion_vencida; })
      : lista;

    if (!visibles.length) {
      cont.innerHTML = cabecera + Componentes.vacio({
        texto: lista.length ? 'Ningún proveedor pendiente de evaluar.' : 'Todavía no hay proveedores en el listado.',
        detalle: lista.length
          ? 'Desmarca el filtro para ver todo el listado.'
          : 'El listado maestro (FO-PRO-04-01) registra a quién se le compra y si está aprobado.'
      });
      wire();
      return;
    }

    cont.innerHTML = cabecera + '<div class="sgc-lista">' + visibles.map(function (p) {
      var badges = Componentes.badge(ESTADO_PROVEEDOR_ETIQUETA[p.estado] || p.estado,
        ESTADO_PROVEEDOR_TONO[p.estado] || 'neutro');
      if (p.es_unico) badges += Componentes.badge('Único', 'info');
      if (p.evaluacion_vencida) badges += Componentes.badge('Por evaluar', 'alerta');

      return '<button type="button" class="sgc-doc js-sgc-abrir-prov" data-id="' +
        Componentes.escaparHtml(p.proveedor_id) + '">' +
        '<div class="sgc-doc__linea">' +
          '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(p.nombre) + '</span>' +
          badges +
        '</div>' +
        '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(p.producto_servicio || '') + '</span>' +
        '<div class="sgc-doc__meta">' +
          (p.rut ? '<span>' + Componentes.escaparHtml(p.rut) + '</span>' : '') +
          (p.ultima_evaluacion_promedio !== null && p.ultima_evaluacion_promedio !== undefined
            ? '<span>Última nota: ' + p.ultima_evaluacion_promedio +
              (p.ultima_evaluacion_resultado ? ' (' + Componentes.escaparHtml(p.ultima_evaluacion_resultado) + ')' : '') + '</span>'
            : '<span>Nunca evaluado</span>') +
          (p.proxima_evaluacion ? '<span>Próxima: ' + fechaCorta_(p.proxima_evaluacion) + '</span>' : '') +
        '</div>' +
        '</button>';
    }).join('') + '</div>';
    wire();
  }

  function abrirProveedor_(id) {
    proveedorActivoId_ = id;
    var cont = panelSgc_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando proveedor...');
    api_('getDetalleProveedorSgc', { proveedor_id: id }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo abrir el proveedor.', 'error');
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarFichaProveedor_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
    });
  }

  function pintarFichaProveedor_(cont, data) {
    var p = data.proveedor;
    var evaluaciones = data.evaluaciones || [];

    var badges = Componentes.badge(ESTADO_PROVEEDOR_ETIQUETA[p.estado] || p.estado,
      ESTADO_PROVEEDOR_TONO[p.estado] || 'neutro');
    if (p.es_unico) badges += Componentes.badge('Proveedor único', 'info');

    // Lo que hay que HACER con un reprobado depende de si es unico. Se dice
    // aca, en la ficha, porque es donde se toma la decision.
    var avisoReprobado = '';
    if (p.estado === 'REPROBADO') {
      avisoReprobado = Componentes.alerta(p.es_unico
        ? 'Reprobado, pero es proveedor único: PRO-04 §6.2 no permite desecharlo. Corresponde ' +
          'enviarle un correo pidiendo una reunión para exigir mejoras.'
        : 'Reprobado: según PRO-04 §6.2 corresponde dejar de comprarle y buscar un reemplazo.',
        p.es_unico ? 'advertencia' : 'error');
    }

    var historial = evaluaciones.length
      ? '<h3 class="sgc-subtitulo">Evaluaciones (FO-PRO-04-02)</h3>' +
        evaluaciones.map(function (e) {
          return '<div class="sgc-version">' +
            '<div class="sgc-version__cab">' +
              '<strong>' + e.promedio + '</strong> ' +
              Componentes.badge(e.resultado, e.aprobado ? 'ok' : 'critico') +
              '<span class="sgc-version__fecha">' + fechaCorta_(e.fecha) + '</span>' +
            '</div>' +
            '<ul class="sgc-items">' + e.calificaciones.map(function (c) {
              return '<li><span>' + Componentes.escaparHtml(c.etiqueta) + '</span> <strong>' + c.valor + '</strong></li>';
            }).join('') + '</ul>' +
            (e.orden_compra ? '<p class="sigso-ayuda">Orden de compra: ' + Componentes.escaparHtml(e.orden_compra) + '</p>' : '') +
            (e.observaciones ? '<p>' + Componentes.escaparHtml(e.observaciones) + '</p>' : '') +
            '<p class="sigso-ayuda">Evaluó ' + Componentes.escaparHtml(e.evaluador_email || '') +
              (e.proxima_evaluacion ? ' · próxima: ' + fechaCorta_(e.proxima_evaluacion) : '') + '</p>' +
          '</div>';
        }).join('')
      : Componentes.vacio({
          texto: 'Todavía no se ha evaluado.',
          detalle: 'PRO-04 §6.2 pide evaluarlo cada 12 meses. Sin evaluación no puede quedar aprobado.'
        });

    cont.innerHTML =
      '<button type="button" class="sigso-boton sigso-boton--sutil js-sgc-volver-prov">← Proveedores</button>' +
      '<div class="sgc-ficha">' +
        '<div class="sgc-ficha__cab">' +
          '<h2>' + Componentes.escaparHtml(p.nombre) + '</h2>' + badges +
        '</div>' +
        avisoReprobado +
        '<div class="sgc-ficha__datos">' +
          campoFicha_('Producto o servicio', p.producto_servicio) +
          campoFicha_('RUT', p.rut) +
          campoFicha_('Contacto', p.nombre_contacto) +
          campoFicha_('Correo', p.email) +
          campoFicha_('Teléfono', p.telefono) +
          campoFicha_('Dirección', p.direccion) +
          campoFicha_('Última evaluación', p.ultima_evaluacion_fecha ? fechaCorta_(p.ultima_evaluacion_fecha) : '—') +
          campoFicha_('Próxima evaluación', p.proxima_evaluacion ? fechaCorta_(p.proxima_evaluacion) : '—') +
        '</div>' +
        (puedeGestionar_
          ? '<div class="sgc-ficha__acciones">' +
              Componentes.boton({ texto: 'Evaluar', clase: 'js-sgc-evaluar-prov' }) +
              Componentes.boton({ texto: 'Editar datos', variante: 'secundario', clase: 'js-sgc-editar-prov' }) +
              Componentes.boton({ texto: 'Dar de baja', variante: 'peligro', clase: 'js-sgc-baja-prov' }) +
            '</div>'
          : '') +
        historial +
      '</div>';

    var volver = cont.querySelector('.js-sgc-volver-prov');
    if (volver) volver.addEventListener('click', cargarProveedores_);
    var evaluar = cont.querySelector('.js-sgc-evaluar-prov');
    if (evaluar) evaluar.addEventListener('click', function () { abrirFormularioEvaluarProveedor_(p, data); });
    var editar = cont.querySelector('.js-sgc-editar-prov');
    if (editar) editar.addEventListener('click', function () { abrirFormularioProveedor_(p, data); });
    var baja = cont.querySelector('.js-sgc-baja-prov');
    if (baja) baja.addEventListener('click', function () { abrirFormularioBajaProveedor_(p); });
  }

  function abrirFormularioProveedor_(p, data) {
    var esNuevo = !p;
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">' + (esNuevo ? 'Nuevo proveedor' : 'Editar proveedor') + '</h3>' +
        '<form id="form-sgc-prov">' +
          Componentes.campoTexto({ id: 'prov-nombre', label: 'Nombre o razón social', requerido: true, valor: esNuevo ? '' : p.nombre }) +
          Componentes.campoTexto({ id: 'prov-producto', label: 'Producto o servicio que provee', requerido: true, valor: esNuevo ? '' : p.producto_servicio }) +
          Componentes.campoTexto({ id: 'prov-rut', label: 'RUT', valor: esNuevo ? '' : p.rut }) +
          Componentes.campoTexto({ id: 'prov-contacto', label: 'Nombre de contacto', valor: esNuevo ? '' : p.nombre_contacto }) +
          Componentes.campoTexto({ id: 'prov-email', label: 'Correo', tipo: 'email', valor: esNuevo ? '' : p.email }) +
          Componentes.campoTexto({ id: 'prov-telefono', label: 'Teléfono', valor: esNuevo ? '' : p.telefono }) +
          Componentes.campoTexto({ id: 'prov-direccion', label: 'Dirección', valor: esNuevo ? '' : p.direccion }) +
          '<label class="sigso-campo-check"><input type="checkbox" id="prov-unico"' +
            (!esNuevo && p.es_unico ? ' checked' : '') + '> Es proveedor único</label>' +
          '<p class="sigso-ayuda">Márcalo si no hay con quién reemplazarlo. Cambia qué se hace si ' +
          'reprueba: en vez de dejar de comprarle, se le pide una reunión de mejora (PRO-04 §6.2).</p>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-sgc-prov').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var datos = {
        nombre: document.getElementById('prov-nombre').value,
        producto_servicio: document.getElementById('prov-producto').value,
        rut: document.getElementById('prov-rut').value,
        nombre_contacto: document.getElementById('prov-contacto').value,
        email: document.getElementById('prov-email').value,
        telefono: document.getElementById('prov-telefono').value,
        direccion: document.getElementById('prov-direccion').value,
        es_unico: document.getElementById('prov-unico').checked
      };
      if (!esNuevo) datos.proveedor_id = p.proveedor_id;

      api_('guardarProveedorSgc', datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        if (esNuevo) { proveedorActivoId_ = null; cargarProveedores_(); }
        else abrirProveedor_(p.proveedor_id);
      });
    });
  }

  function abrirFormularioEvaluarProveedor_(p, data) {
    var criterios = data.criterios || [];
    var escala = data.escala || [];
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Evaluar a ' + Componentes.escaparHtml(p.nombre) + '</h3>' +
        '<p class="sigso-ayuda">Califica cada ítem de 1 a 10 (FO-PRO-04-02). ' +
          escala.map(function (e) { return e.etiqueta + ': ' + e.desde + ' a ' + e.hasta; }).join(' · ') +
        '</p>' +
        '<form id="form-sgc-prov-eval">' +
          Componentes.campoTexto({ id: 'peval-oc', label: 'Orden de compra N° (opcional)' }) +
          criterios.map(function (c) {
            return Componentes.campoTexto({
              id: 'peval-' + c.campo, label: c.etiqueta, tipo: 'number', requerido: true
            });
          }).join('') +
          Componentes.campoTextarea({ id: 'peval-obs', label: 'Observaciones' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar evaluación', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    // La escala es 1 a 10: acotar el input evita el error antes de enviarlo.
    criterios.forEach(function (c) {
      var input = document.getElementById('peval-' + c.campo);
      if (input) { input.min = 1; input.max = 10; input.step = 1; }
    });

    document.getElementById('form-sgc-prov-eval').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var datos = {
        proveedor_id: p.proveedor_id,
        orden_compra: document.getElementById('peval-oc').value,
        observaciones: document.getElementById('peval-obs').value
      };
      criterios.forEach(function (c) {
        datos[c.campo] = Number(document.getElementById('peval-' + c.campo).value);
      });

      api_('evaluarProveedorSgc', datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar la evaluación.', tipo: 'error' });
          return;
        }
        cerrar();
        var r = respuesta.data || {};
        var ev = r.evaluacion || {};
        // El resultado se dice de inmediato, con la consecuencia: es el
        // momento en que hay que decidir qué hacer con el proveedor.
        if (r.consecuencia === 'REUNION_MEJORA') {
          Componentes.aviso({
            texto: 'Promedio ' + ev.promedio + ': reprobado. Es proveedor único, corresponde pedirle una reunión de mejora.',
            tipo: 'info'
          });
        } else if (r.consecuencia === 'DESECHAR') {
          Componentes.aviso({
            texto: 'Promedio ' + ev.promedio + ': reprobado. Corresponde dejar de comprarle (PRO-04 §6.2).',
            tipo: 'error'
          });
        } else {
          Componentes.aviso({ texto: 'Promedio ' + ev.promedio + ' (' + ev.resultado + '): aprobado.', tipo: 'exito' });
        }
        abrirProveedor_(p.proveedor_id);
      });
    });
  }

  function abrirFormularioBajaProveedor_(p) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Dar de baja a ' + Componentes.escaparHtml(p.nombre) + '</h3>' +
        '<p class="sigso-ayuda">Sale del listado, pero sus evaluaciones se conservan: son la evidencia ' +
        'de que el control de proveedores se aplicaba.</p>' +
        '<form id="form-sgc-prov-baja">' +
          Componentes.campoTextarea({ id: 'pbaja-motivo', label: 'Motivo', requerido: true }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Dar de baja', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-sgc-prov-baja').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('desactivarProveedorSgc', {
        proveedor_id: p.proveedor_id,
        motivo: document.getElementById('pbaja-motivo').value
      }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo dar de baja.', tipo: 'error' });
          return;
        }
        cerrar();
        proveedorActivoId_ = null;
        cargarProveedores_();
      });
    });
  }

  // --- Revisión por la dirección (PRO-05) -------------------------------------
  // El acta tiene 13 temas obligatorios. Cinco los responde el sistema con
  // sus propios datos: el botón "Traer datos del sistema" los rellena y
  // quedan editables. El dato lo pone SIGSO, la conclusión la escribe quien
  // preside — si el sistema opinara, el registro dejaría de ser evidencia de
  // que la Dirección revisó.

  var ESTADO_REVISION_ETIQUETA = {
    PROGRAMADA: 'Programada', CONVOCADA: 'Convocada', REALIZADA: 'Realizada',
    CERRADA: 'Cerrada', ANULADA: 'Anulada'
  };
  var ESTADO_REVISION_TONO = {
    PROGRAMADA: 'neutro', CONVOCADA: 'info', REALIZADA: 'alerta',
    CERRADA: 'ok', ANULADA: 'neutro'
  };

  function cargarRevisiones_() {
    revisionActivaId_ = null;
    cargarListadoSgc_({
      clave: 'revision', accion: 'listarRevisionesSgc', datos: {},
      spinner: 'Cargando revisiones...',
      sigo: function () { return seccionActiva_ === 'revision' && !revisionActivaId_; },
      aplicar: function (cont, data) {
        puedeGestionar_ = data.puede_gestionar === true;
        cacheListadoSgc_.revision = data;
        pintarRevisiones_(cont, data);
      },
      error: function (cont, msg) {
        cont.innerHTML = barraSecciones_() +
          Componentes.alerta(msg || 'No se pudo conectar.', 'error');
        wireSecciones_(cont);
      }
    });
  }

  function pintarRevisiones_(cont, data) {
    var lista = data.revisiones || [];
    var vig = data.vigencia || {};

    var avisoVigencia = vig.vencida
      ? Componentes.alerta(vig.ultima_fecha
          ? 'La última revisión fue el ' + fechaCorta_(vig.ultima_fecha) + '. PRO-05 pide una al menos cada ' +
            (data.meses_frecuencia || 12) + ' meses.'
          : 'Todavía no se ha registrado ninguna revisión por la dirección. La norma (§9.3) la exige.', 'error')
      : (vig.proxima
          ? '<p class="sigso-ayuda">Última revisión: ' + fechaCorta_(vig.ultima_fecha) +
            '. La próxima corresponde antes del ' + fechaCorta_(vig.proxima) + '.</p>'
          : '');

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Informe de revisión por la dirección (FO-PRO-05-01). Se convoca con ' +
      (data.dias_convocatoria || 10) + ' días hábiles de anticipación y se registra el acta con los ' +
      '13 temas que exige la norma.</p>' +
      (puedeGestionar_ ? Componentes.boton({ texto: '+ Programar revisión', clase: 'js-sgc-nueva-rev' }) : '') +
      '</div>' + avisoVigencia;

    function wire() {
      wireSecciones_(cont);
      var nueva = cont.querySelector('.js-sgc-nueva-rev');
      if (nueva) nueva.addEventListener('click', function () { abrirFormularioProgramarRevision_(); });
      cont.querySelectorAll('.js-sgc-abrir-rev').forEach(function (btn) {
        btn.addEventListener('click', function () { abrirRevision_(btn.getAttribute('data-id')); });
      });
    }

    if (!lista.length) {
      cont.innerHTML = cabecera + Componentes.vacio({
        texto: 'Todavía no hay revisiones registradas.',
        detalle: 'La revisión por la dirección es anual y la ejecuta la Dirección (PRO-05 §4).'
      });
      wire();
      return;
    }

    cont.innerHTML = cabecera + '<div class="sgc-lista">' + lista.map(function (r) {
      var badges = Componentes.badge(ESTADO_REVISION_ETIQUETA[r.estado] || r.estado,
        ESTADO_REVISION_TONO[r.estado] || 'neutro');
      if (r.convocatoria_atrasada) badges += Componentes.badge('Falta convocar', 'critico');

      return '<button type="button" class="sgc-doc js-sgc-abrir-rev" data-id="' +
        Componentes.escaparHtml(r.revision_id) + '">' +
        '<div class="sgc-doc__linea">' +
          '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(r.correlativo) + '</span>' + badges +
        '</div>' +
        '<div class="sgc-doc__meta">' +
          '<span>Reunión: ' + fechaCorta_(r.fecha_reunion || r.fecha_programada) + '</span>' +
          '<span>' + r.entradas_completas + '/' + r.total_entradas + ' temas</span>' +
          '<span>' + r.total_acuerdos + ' acuerdo(s)</span>' +
        '</div>' +
        '</button>';
    }).join('') + '</div>';
    wire();
  }

  function abrirRevision_(id) {
    revisionActivaId_ = id;
    var cont = panelSgc_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando revisión...');
    api_('getDetalleRevisionSgc', { revision_id: id }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo abrir.', 'error');
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarFichaRevision_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
    });
  }

  function pintarFichaRevision_(cont, data) {
    var r = data.revision;
    var entradas = data.entradas || [];
    var acuerdos = data.acuerdos || [];
    var cerrada = r.estado === 'CERRADA';

    var badges = Componentes.badge(ESTADO_REVISION_ETIQUETA[r.estado] || r.estado,
      ESTADO_REVISION_TONO[r.estado] || 'neutro');
    if (r.convocatoria_atrasada) badges += Componentes.badge('Falta convocar', 'critico');

    var asistentes = (r.asistentes || []).length
      ? '<ul class="sgc-items">' + r.asistentes.map(function (a) {
          return '<li><span>' + Componentes.escaparHtml(a.nombre) + '</span> <strong>' +
            Componentes.escaparHtml(a.cargo || '') + '</strong></li>';
        }).join('') + '</ul>'
      : '<p class="sigso-ayuda">Todavía no se registraron asistentes.</p>';

    var temas = '<h3 class="sgc-subtitulo">Información a tratar (§9.3.2)</h3>' +
      '<div class="sgc-lista">' + entradas.map(function (e) {
        return '<div class="sgc-version">' +
          '<div class="sgc-version__cab">' +
            '<strong>' + e.numero + '. ' + Componentes.escaparHtml(e.titulo) + '</strong>' +
            (e.auto ? Componentes.badge('Lo trae el sistema', 'info') : '') +
          '</div>' +
          (e.observaciones
            ? '<p>' + Componentes.escaparHtml(e.observaciones) + '</p>'
            : '<p class="sigso-ayuda">' +
                (e.pendiente_fase
                  ? 'Sin completar. Se podrá traer automáticamente cuando exista: ' +
                    Componentes.escaparHtml(e.pendiente_fase) + '.'
                  : 'Sin completar.') +
              '</p>') +
        '</div>';
      }).join('') + '</div>';

    var listaAcuerdos = '<h3 class="sgc-subtitulo">Acuerdos tomados (§9.3.3)</h3>' +
      (acuerdos.length
        ? '<div class="sgc-lista">' + acuerdos.map(function (a) {
            var t = a.tarea;
            return '<div class="sgc-version">' +
              '<div class="sgc-version__cab">' +
                '<strong>' + Componentes.escaparHtml(a.tipo_etiqueta) + '</strong>' +
                (t ? Componentes.badge(t.terminada ? 'Cumplido' : 'En curso', t.terminada ? 'ok' : 'alerta') : '') +
              '</div>' +
              '<p>' + Componentes.escaparHtml(a.observaciones) + '</p>' +
              '<p class="sigso-ayuda">Responsable: ' + Componentes.escaparHtml(a.responsable_email) +
                ' · Plazo: ' + fechaCorta_(a.plazo) +
                (t ? ' · Aparece en "Mi trabajo" de esa persona' : '') + '</p>' +
            '</div>';
          }).join('') + '</div>'
        : Componentes.vacio({
            texto: 'Todavía no hay acuerdos.',
            detalle: '§9.3.3 exige que la revisión produzca decisiones: sin acuerdos no se puede cerrar.'
          }));

    cont.innerHTML =
      '<button type="button" class="sigso-boton sigso-boton--sutil js-sgc-volver-rev">← Revisiones</button>' +
      '<div class="sgc-ficha">' +
        '<div class="sgc-ficha__cab">' +
          '<h2>' + Componentes.escaparHtml(r.correlativo) + '</h2>' + badges +
        '</div>' +
        '<div class="sgc-ficha__datos">' +
          campoFicha_('Fecha programada', fechaCorta_(r.fecha_programada)) +
          campoFicha_('Convocar antes de', r.aviso_plazo ? fechaCorta_(r.aviso_plazo) : '—') +
          campoFicha_('Convocada el', r.fecha_convocatoria ? fechaCorta_(r.fecha_convocatoria) : '—') +
          campoFicha_('Reunión realizada', r.fecha_reunion ? fechaCorta_(r.fecha_reunion) : '—') +
          campoFicha_('Director', r.director_email) +
          campoFicha_('Responsable de calidad', r.responsable_calidad_email) +
        '</div>' +
        '<h3 class="sgc-subtitulo">Asistentes</h3>' + asistentes +
        (puedeGestionar_ && !cerrada
          ? '<div class="sgc-ficha__acciones">' +
              (r.estado === 'PROGRAMADA'
                ? Componentes.boton({ texto: 'Convocar', clase: 'js-sgc-convocar-rev' }) : '') +
              Componentes.boton({ texto: 'Registrar acta', variante: 'secundario', clase: 'js-sgc-acta-rev' }) +
              (r.estado === 'REALIZADA'
                ? Componentes.boton({ texto: '+ Acuerdo', variante: 'secundario', clase: 'js-sgc-acuerdo-rev' }) : '') +
              (r.estado === 'REALIZADA'
                ? Componentes.boton({ texto: 'Cerrar revisión', clase: 'js-sgc-cerrar-rev' }) : '') +
              Componentes.boton({ texto: 'Anular', variante: 'peligro', clase: 'js-sgc-anular-rev' }) +
            '</div>'
          : '') +
        temas +
        (r.conclusiones
          ? '<h3 class="sgc-subtitulo">Conclusiones</h3><p>' + Componentes.escaparHtml(r.conclusiones) + '</p>'
          : '') +
        listaAcuerdos +
        (r.anexos ? '<h3 class="sgc-subtitulo">Anexos</h3><p>' + Componentes.escaparHtml(r.anexos) + '</p>' : '') +
      '</div>';

    function accion_(sel, fn) {
      var b = cont.querySelector(sel);
      if (b) b.addEventListener('click', fn);
    }
    accion_('.js-sgc-volver-rev', cargarRevisiones_);
    accion_('.js-sgc-convocar-rev', function () { abrirFormularioConvocarRevision_(r); });
    accion_('.js-sgc-acta-rev', function () { abrirFormularioActaRevision_(r, data); });
    accion_('.js-sgc-acuerdo-rev', function () { abrirFormularioAcuerdoRevision_(r, data); });
    accion_('.js-sgc-cerrar-rev', function () {
      Componentes.confirmar({
        titulo: 'Cerrar la revisión',
        mensaje: 'Queda como registro definitivo del año. ¿Confirmas?'
      }).then(function (ok) {
        if (!ok) return;
        api_('cerrarRevisionSgc', { revision_id: r.revision_id }).then(function (resp) {
          if (!resp || !resp.ok) {
            Componentes.aviso({ texto: (resp && resp.message) || 'No se pudo cerrar.', tipo: 'error' });
            return;
          }
          abrirRevision_(r.revision_id);
        });
      });
    });
    accion_('.js-sgc-anular-rev', function () {
      Componentes.prompt({
        titulo: 'Anular revisión',
        mensaje: '¿Por qué se anula? Queda registrado (no se borra).'
      }).then(function (motivo) {
        if (!motivo || !String(motivo).trim()) return;
        api_('anularRevisionSgc', { revision_id: r.revision_id, motivo: motivo }).then(function (resp) {
          if (!resp || !resp.ok) {
            Componentes.aviso({ texto: (resp && resp.message) || 'No se pudo anular.', tipo: 'error' });
            return;
          }
          revisionActivaId_ = null;
          cargarRevisiones_();
        });
      });
    });
  }

  function abrirFormularioProgramarRevision_() {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Programar revisión por la dirección</h3>' +
        '<p class="sigso-ayuda">La frecuencia mínima es anual. El sistema calcula solo hasta cuándo ' +
        'hay plazo para convocar (10 días hábiles antes).</p>' +
        '<form id="form-sgc-rev">' +
          Componentes.campoTexto({ id: 'rev-fecha', label: 'Fecha de la reunión', tipo: 'date', requerido: true }) +
          Componentes.campoTexto({ id: 'rev-director', label: 'Correo del Director', tipo: 'email' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Programar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-sgc-rev').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('programarRevisionSgc', {
        fecha_programada: document.getElementById('rev-fecha').value,
        director_email: document.getElementById('rev-director').value
      }).then(function (resp) {
        if (!resp || !resp.ok) {
          Componentes.aviso({ texto: (resp && resp.message) || 'No se pudo programar.', tipo: 'error' });
          return;
        }
        cerrar();
        cargarRevisiones_();
      });
    });
  }

  function abrirFormularioConvocarRevision_(r) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Convocar a la revisión ' + Componentes.escaparHtml(r.correlativo) + '</h3>' +
        '<p class="sigso-ayuda">Se envía por correo la agenda con los 13 temas que exige la norma.</p>' +
        '<form id="form-sgc-rev-conv">' +
          Componentes.campoTextarea({ id: 'revc-asistentes', label: 'Asistentes (uno por línea: Nombre - Cargo)', requerido: true }) +
          Componentes.campoTextarea({ id: 'revc-correos', label: 'Correos a convocar (uno por línea)', requerido: true }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Enviar convocatoria', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-sgc-rev-conv').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('convocarRevisionSgc', {
        revision_id: r.revision_id,
        asistentes: document.getElementById('revc-asistentes').value,
        correos: document.getElementById('revc-correos').value.split('\n')
          .map(function (x) { return x.trim(); }).filter(Boolean)
      }).then(function (resp) {
        if (!resp || !resp.ok) {
          Componentes.aviso({ texto: (resp && resp.message) || 'No se pudo convocar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: 'Convocatoria enviada.', tipo: 'exito' });
        abrirRevision_(r.revision_id);
      });
    });
  }

  function abrirFormularioActaRevision_(r, data) {
    var entradas = data.entradas || [];
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Acta de la revisión ' + Componentes.escaparHtml(r.correlativo) + '</h3>' +
        '<p class="sigso-ayuda">Los 13 temas son obligatorios (§9.3.2). Dejar uno en blanco es un ' +
        'hallazgo de auditoría.</p>' +
        Componentes.boton({ texto: '⤓ Traer datos del sistema', variante: 'secundario', clase: 'js-sgc-rev-auto', tipo: 'button' }) +
        '<form id="form-sgc-rev-acta">' +
          Componentes.campoTexto({ id: 'reva-fecha', label: 'Fecha en que se realizó', tipo: 'date',
            requerido: true, valor: fechaISO_(r.fecha_reunion || r.fecha_programada) }) +
          Componentes.campoTextarea({ id: 'reva-asistentes', label: 'Asistentes (Nombre - Cargo, uno por línea)',
            requerido: true, valor: (r.asistentes || []).map(function (a) {
              return a.nombre + (a.cargo ? ' - ' + a.cargo : '');
            }).join('\n') }) +
          entradas.map(function (e) {
            return Componentes.campoTextarea({
              id: 'reva-e' + e.numero,
              label: e.numero + '. ' + e.titulo + (e.auto ? '  (lo trae el sistema)' : ''),
              valor: e.observaciones || ''
            });
          }).join('') +
          Componentes.campoTextarea({ id: 'reva-concl',
            label: 'Conclusiones (¿el SGC es adecuado y eficaz? ¿hay recursos?)',
            valor: r.conclusiones || '' }) +
          Componentes.campoTextarea({ id: 'reva-anexos', label: 'Anexos asociados', valor: r.anexos || '' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar acta', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    // El resumen se pide al backend y rellena SOLO los campos que estén
    // vacíos: si alguien ya escribió su propia observación, no se pisa.
    var btnAuto = fondo.querySelector('.js-sgc-rev-auto');
    if (btnAuto) btnAuto.addEventListener('click', function () {
      btnAuto.disabled = true;
      api_('getResumenRevisionSgc', { revision_id: r.revision_id }).then(function (resp) {
        btnAuto.disabled = false;
        if (!resp || !resp.ok) {
          Componentes.aviso({ texto: (resp && resp.message) || 'No se pudo traer el resumen.', tipo: 'error' });
          return;
        }
        var resumen = resp.data.resumen || {};
        var puestos = 0;
        Object.keys(resumen).forEach(function (num) {
          var campo = document.getElementById('reva-e' + num);
          if (campo && !campo.value.trim()) { campo.value = resumen[num]; puestos++; }
        });
        Componentes.aviso({
          texto: puestos
            ? 'Se completaron ' + puestos + ' tema(s) con los datos del sistema. Revísalos y ajústalos.'
            : 'Los temas que trae el sistema ya estaban escritos: no se pisó nada.',
          tipo: 'exito'
        });
      }).catch(function () {
        btnAuto.disabled = false;
        Componentes.aviso({ texto: 'No se pudo traer el resumen.', tipo: 'error' });
      });
    });

    document.getElementById('form-sgc-rev-acta').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var obs = {};
      entradas.forEach(function (e) {
        obs[e.numero] = document.getElementById('reva-e' + e.numero).value;
      });
      api_('registrarActaRevisionSgc', {
        revision_id: r.revision_id,
        fecha_reunion: document.getElementById('reva-fecha').value,
        asistentes: document.getElementById('reva-asistentes').value,
        entradas: obs,
        conclusiones: document.getElementById('reva-concl').value,
        anexos: document.getElementById('reva-anexos').value
      }).then(function (resp) {
        if (!resp || !resp.ok) {
          Componentes.aviso({ texto: (resp && resp.message) || 'No se pudo guardar el acta.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirRevision_(r.revision_id);
      });
    });
  }

  function abrirFormularioAcuerdoRevision_(r, data) {
    var tipos = data.catalogo_acuerdos || [];
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Nuevo acuerdo</h3>' +
        '<p class="sigso-ayuda">El acuerdo se convierte en una tarea real: le aparece al responsable ' +
        'en "Mi trabajo", con su plazo.</p>' +
        '<form id="form-sgc-rev-acu">' +
          Componentes.campoSelect({
            id: 'reva-tipo', label: 'Acuerdo relacionado con', placeholder: false,
            opciones: tipos.map(function (t) { return { valor: t.tipo, texto: t.etiqueta }; })
          }) +
          Componentes.campoTextarea({ id: 'reva-obs', label: 'Observaciones', requerido: true }) +
          Componentes.campoTexto({ id: 'reva-resp', label: 'Responsable de la actividad', tipo: 'email', requerido: true }) +
          Componentes.campoTexto({ id: 'reva-plazo', label: 'Plazo establecido', tipo: 'date', requerido: true }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar acuerdo', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-sgc-rev-acu').addEventListener('submit', function (evento) {
      evento.preventDefault();
      api_('registrarAcuerdoRevisionSgc', {
        revision_id: r.revision_id,
        tipo: document.getElementById('reva-tipo').value,
        observaciones: document.getElementById('reva-obs').value,
        responsable_email: document.getElementById('reva-resp').value,
        plazo: document.getElementById('reva-plazo').value
      }).then(function (resp) {
        if (!resp || !resp.ok) {
          Componentes.aviso({ texto: (resp && resp.message) || 'No se pudo guardar el acuerdo.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: 'Acuerdo registrado: ya aparece en "Mi trabajo" del responsable.', tipo: 'exito' });
        abrirRevision_(r.revision_id);
      });
    });
  }

  // --- Objetivos de calidad (DOC-07) ------------------------------------------
  // El tablero de los seis objetivos. Lo distintivo frente a las otras
  // secciones: aca el sistema NO decide si un objetivo se cumple mirando la
  // pantalla -- el veredicto viene calculado del backend y la pantalla solo
  // lo muestra. Y de los seis, hoy solo uno se puede medir solo; los demas
  // los registra la persona responsable, con la ayuda que el sistema pueda
  // dar en cada caso.

  var UNIDAD_SUFIJO = { PORCENTAJE: '%', HORAS: ' h', NUMERO: '' };
  var FUENTE_ETIQUETA = {
    AUTO: 'Lo calcula el sistema',
    ASISTIDA: 'El sistema aporta parte',
    MANUAL: 'Registro manual'
  };
  var FUENTE_TONO = { AUTO: 'ok', ASISTIDA: 'info', MANUAL: 'neutro' };
  var anioObjetivos_ = null;

  function formatearValor_(valor, unidad) {
    if (valor === null || valor === undefined || valor === '') return '—';
    return valor + (UNIDAD_SUFIJO[unidad] !== undefined ? UNIDAD_SUFIJO[unidad] : '');
  }

  function cargarObjetivos_() {
    objetivoActivoId_ = null;
    cargarListadoSgc_({
      clave: 'objetivos', accion: 'listarObjetivosSgc', datos: anioObjetivos_ ? { anio: anioObjetivos_ } : {},
      spinner: 'Cargando objetivos de calidad...',
      sigo: function () { return seccionActiva_ === 'objetivos' && !objetivoActivoId_; },
      aplicar: function (cont, data) {
        puedeGestionar_ = data.puede_gestionar === true;
        anioObjetivos_ = data.anio;
        cacheListadoSgc_.objetivos = data;
        pintarObjetivos_(cont, data);
      },
      error: function (cont, msg) {
        cont.innerHTML = barraSecciones_() +
          Componentes.alerta(msg || 'No se pudo cargar el tablero de objetivos.', 'error');
        wireSecciones_(cont);
      }
    });
  }

  function pintarObjetivos_(cont, data) {
    var lista = data.objetivos || [];
    var ind = data.indicadores || {};
    var anios = data.anios_disponibles || [];
    if (anios.indexOf(data.anio) === -1) anios = [data.anio].concat(anios);

    var selectorAnio = '<select id="sgc-obj-anio" class="sigso-select">' +
      anios.map(function (a) {
        return '<option value="' + a + '"' + (a === data.anio ? ' selected' : '') + '>' + a + '</option>';
      }).join('') + '</select>';

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Objetivos de calidad (DOC-07). Cada uno se mide en su ' +
      'frecuencia y se compara solo contra su meta.</p>' +
      selectorAnio +
      '</div>';

    function wire() {
      wireSecciones_(cont);
      var sel = cont.querySelector('#sgc-obj-anio');
      if (sel) sel.addEventListener('change', function () {
        anioObjetivos_ = Number(this.value);
        cargarObjetivos_();
      });
      var abrirAnio = cont.querySelector('.js-sgc-abrir-anio');
      if (abrirAnio) abrirAnio.addEventListener('click', function () { confirmarAbrirAnio_(data.anio); });
      cont.querySelectorAll('.js-sgc-abrir-obj').forEach(function (btn) {
        btn.addEventListener('click', function () { abrirObjetivo_(btn.getAttribute('data-id')); });
      });
    }

    if (!data.sembrado) {
      cont.innerHTML = cabecera + Componentes.vacio({
        texto: 'El año ' + data.anio + ' todavía no tiene objetivos cargados.',
        detalle: puedeGestionar_
          ? 'Al abrirlo se cargan los seis objetivos de DOC-07 con su indicador, meta, frecuencia y responsable. Después puedes ajustarlos.'
          : 'El Encargado SGC tiene que abrir el año antes de poder medir.'
      }) + (puedeGestionar_
        ? '<div class="sgc-cabecera">' +
            Componentes.boton({ texto: 'Abrir año ' + data.anio, clase: 'js-sgc-abrir-anio' }) +
          '</div>'
        : '');
      wire();
      return;
    }

    var kpis = '<div class="sgc-kpis">' + [
      Componentes.kpi({ etiqueta: 'Objetivos', valor: ind.total || 0 }),
      Componentes.kpi({ etiqueta: 'Cumplen', valor: ind.cumplen || 0 }),
      Componentes.kpi({ etiqueta: 'No cumplen', valor: ind.no_cumplen || 0 }),
      Componentes.kpi({ etiqueta: 'Sin medir', valor: ind.sin_medir || 0 }),
      Componentes.kpi({ etiqueta: 'Lecturas pendientes', valor: ind.lecturas_pendientes || 0 })
    ].join('') + '</div>';

    // "No cumple" y "nadie lo midio" son hallazgos distintos y se avisan
    // por separado: el primero pide accion sobre el proceso, el segundo
    // sobre el seguimiento (§9.1.1).
    var avisos = '';
    if (ind.lecturas_pendientes) {
      avisos += Componentes.alerta(ind.lecturas_pendientes + ' período(s) ya cerrados siguen sin medir. ' +
        'No medir un objetivo es no evaluar el desempeño (§9.1.1).', 'advertencia');
    }
    if (ind.no_cumplen) {
      avisos += Componentes.alerta(ind.no_cumplen + ' objetivo(s) no alcanzan su meta. ' +
        'Es entrada obligatoria de la revisión por la dirección (§9.3.2 e).', 'advertencia');
    }

    cont.innerHTML = cabecera + kpis + avisos + '<div class="sgc-lista">' + lista.map(function (o) {
      var badges = '';
      if (o.ultima_lectura) {
        badges += Componentes.badge(o.ultima_lectura.cumple ? 'Cumple' : 'No cumple',
          o.ultima_lectura.cumple ? 'ok' : 'critico');
      } else {
        badges += Componentes.badge('Sin medir', 'neutro');
      }
      badges += Componentes.badge(FUENTE_ETIQUETA[o.fuente] || o.fuente, FUENTE_TONO[o.fuente] || 'neutro');
      if (o.lecturas_pendientes) badges += Componentes.badge(o.lecturas_pendientes + ' por medir', 'alerta');

      return '<button type="button" class="sgc-doc js-sgc-abrir-obj" data-id="' +
        Componentes.escaparHtml(o.objetivo_id) + '">' +
        '<div class="sgc-doc__linea">' +
          '<span class="sgc-doc__codigo">' + o.numero + '. ' + Componentes.escaparHtml(o.objetivo_general) + '</span>' +
          badges +
        '</div>' +
        '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(o.indicador) + '</span>' +
        '<div class="sgc-doc__meta">' +
          '<span>Meta: ' + Componentes.escaparHtml(o.meta_texto || '') + '</span>' +
          '<span>' + Componentes.escaparHtml(o.frecuencia_texto || o.frecuencia) + '</span>' +
          (o.ultima_lectura
            ? '<span>Última: ' + formatearValor_(o.ultima_lectura.valor, o.unidad) +
              ' (' + Componentes.escaparHtml(o.ultima_lectura.periodo_etiqueta) + ')</span>'
            : '<span>Nunca medido</span>') +
        '</div>' +
        '</button>';
    }).join('') + '</div>';
    wire();
  }

  function confirmarAbrirAnio_(anio) {
    Componentes.confirmar({
      titulo: 'Abrir el año ' + anio,
      mensaje: 'Se cargarán los seis objetivos de DOC-07 con su indicador, meta, frecuencia y ' +
        'responsable. Si el año anterior ya existe, se copian desde ahí para conservar los ajustes que hayas hecho.',
      confirmar: 'Abrir año'
    }).then(function (ok) {
      if (!ok) return;
      api_('sembrarAnioObjetivosSgc', { anio: anio }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo abrir el año.', tipo: 'error' });
          return;
        }
        Componentes.aviso({ texto: 'Año ' + anio + ' abierto con ' + respuesta.data.creados + ' objetivos.', tipo: 'exito' });
        cargarObjetivos_();
      });
    });
  }

  function abrirObjetivo_(id) {
    objetivoActivoId_ = id;
    var cont = panelSgc_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando objetivo...');
    api_('getDetalleObjetivoSgc', { objetivo_id: id }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = barraSecciones_() +
          Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar el objetivo.', 'error');
        wireSecciones_(cont);
        return;
      }
      puedeGestionar_ = respuesta.data.puede_gestionar === true;
      pintarFichaObjetivo_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = barraSecciones_() + Componentes.alerta('No se pudo conectar.', 'error');
      wireSecciones_(cont);
    });
  }

  function pintarFichaObjetivo_(cont, data) {
    var o = data.objetivo;
    var lecturas = data.lecturas || [];
    var periodos = data.periodos || [];
    var medidos = {};
    lecturas.forEach(function (l) { medidos[l.periodo] = l; });

    var acciones = puedeGestionar_
      ? Componentes.boton({ texto: 'Registrar medición', clase: 'js-sgc-obj-medir' }) +
        Componentes.boton({ texto: 'Editar objetivo', variante: 'sutil', clase: 'js-sgc-obj-editar' })
      : '';

    // La tabla de periodos muestra TODOS los del año, medidos o no: el hueco
    // es justamente lo que hay que ver.
    var filas = periodos.map(function (p) {
      var l = medidos[p.clave];
      var estado;
      if (l) {
        estado = Componentes.badge(l.cumple ? 'Cumple' : 'No cumple', l.cumple ? 'ok' : 'critico');
      } else if (p.cerrado) {
        estado = Componentes.badge('Sin medir', 'alerta');
      } else {
        estado = Componentes.badge('En curso', 'neutro');
      }
      return '<tr>' +
        '<td>' + Componentes.escaparHtml(p.etiqueta) + '</td>' +
        '<td>' + (l ? formatearValor_(l.valor, o.unidad) : '—') + '</td>' +
        '<td>' + (l && l.numerador !== null && l.denominador !== null
          ? l.numerador + ' / ' + l.denominador : '') + '</td>' +
        '<td>' + estado + '</td>' +
        '<td>' + Componentes.escaparHtml((l && l.observaciones) || '') + '</td>' +
        '<td>' + (l && puedeGestionar_
          ? '<button type="button" class="sigso-boton sigso-boton--sutil js-sgc-obj-anular" data-id="' +
            Componentes.escaparHtml(l.lectura_id) + '">Anular</button>'
          : '') + '</td>' +
        '</tr>';
    }).join('');

    var badgeFuente = Componentes.badge(FUENTE_ETIQUETA[o.fuente] || o.fuente, FUENTE_TONO[o.fuente] || 'neutro');

    cont.innerHTML =
      '<button type="button" class="sigso-boton sigso-boton--sutil js-sgc-volver-obj">← Objetivos</button>' +
      '<div class="sgc-ficha">' +
        '<div class="sgc-ficha__cab">' +
          '<h2>' + o.numero + '. ' + Componentes.escaparHtml(o.objetivo_general) + '</h2>' + badgeFuente +
        '</div>' +
        '<p class="sigso-ayuda">' + Componentes.escaparHtml(o.objetivo_especifico || '') + '</p>' +
        '<div class="sgc-ficha__datos">' +
          campoFicha_('Indicador', o.indicador) +
          campoFicha_('Meta', o.meta_texto) +
          campoFicha_('Frecuencia', o.frecuencia_texto || o.frecuencia) +
          campoFicha_('Responsable', o.responsable_texto) +
          campoFicha_('Acciones para lograrlo', o.acciones) +
        '</div>' +
        (acciones ? '<div class="sgc-ficha__acciones">' + acciones + '</div>' : '') +
        '<h3 class="sgc-subtitulo">Mediciones de ' + o.anio + '</h3>' +
        '<table class="sigso-tabla">' +
          '<thead><tr><th>Período</th><th>Valor</th><th>Detalle</th><th>Estado</th><th>Observaciones</th><th></th></tr></thead>' +
          '<tbody>' + filas + '</tbody>' +
        '</table>' +
      '</div>';

    cont.querySelector('.js-sgc-volver-obj').addEventListener('click', cargarObjetivos_);
    var medir = cont.querySelector('.js-sgc-obj-medir');
    if (medir) medir.addEventListener('click', function () { abrirFormularioMedicion_(o, data); });
    var editar = cont.querySelector('.js-sgc-obj-editar');
    if (editar) editar.addEventListener('click', function () { abrirFormularioObjetivo_(o, data); });
    cont.querySelectorAll('.js-sgc-obj-anular').forEach(function (btn) {
      btn.addEventListener('click', function () { anularLectura_(btn.getAttribute('data-id'), o); });
    });
  }

  function anularLectura_(lecturaId, o) {
    Componentes.prompt({
      titulo: 'Anular medición',
      mensaje: 'La medición deja de contar en el tablero, pero queda registrada con el motivo. Indica por qué.',
      placeholder: 'Motivo de la anulación',
      confirmar: 'Anular'
    }).then(function (motivo) {
      if (!motivo) return;
      api_('anularLecturaObjetivoSgc', { lectura_id: lecturaId, motivo: motivo }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo anular.', tipo: 'error' });
          return;
        }
        abrirObjetivo_(o.objetivo_id);
      });
    });
  }

  function abrirFormularioMedicion_(o, data) {
    var periodos = data.periodos || [];
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Medir: ' + Componentes.escaparHtml(o.objetivo_general) + '</h3>' +
        '<p class="sigso-ayuda">' + Componentes.escaparHtml(o.indicador) +
          '<br>Meta: <strong>' + Componentes.escaparHtml(o.meta_texto || '') + '</strong></p>' +
        '<form id="form-sgc-obj-medir">' +
          '<label class="sigso-campo"><span class="sigso-campo__label">Período</span>' +
            '<select id="obj-periodo" class="sigso-select">' +
              periodos.map(function (p) {
                return '<option value="' + p.clave + '"' + (p.cerrado ? '' : ' data-encurso="1"') + '>' +
                  Componentes.escaparHtml(p.etiqueta) + (p.cerrado ? '' : ' (en curso)') + '</option>';
              }).join('') +
            '</select>' +
          '</label>' +
          '<div id="obj-sugerencia"></div>' +
          Componentes.campoTexto({ id: 'obj-numerador', label: 'Numerador (opcional)', tipo: 'number' }) +
          Componentes.campoTexto({ id: 'obj-denominador', label: 'Denominador (opcional)', tipo: 'number' }) +
          Componentes.campoTexto({
            id: 'obj-valor',
            label: 'Valor medido' + (UNIDAD_SUFIJO[o.unidad] ? ' (' + UNIDAD_SUFIJO[o.unidad].trim() + ')' : ''),
            tipo: 'number', requerido: true
          }) +
          Componentes.campoTextarea({ id: 'obj-obs', label: 'Observaciones (opcional)' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Traer datos del sistema', variante: 'sutil', clase: 'js-sgc-obj-sugerir', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar medición', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    // Si el numerador y el denominador estan, el porcentaje se calcula solo:
    // que la persona haga esa division a mano es justo donde se cuelan los
    // errores que despues nadie puede auditar.
    function recalcular() {
      if (o.unidad !== 'PORCENTAJE') return;
      var n = parseFloat(document.getElementById('obj-numerador').value);
      var d = parseFloat(document.getElementById('obj-denominador').value);
      if (isFinite(n) && isFinite(d) && d > 0) {
        document.getElementById('obj-valor').value = Math.round((n / d) * 1000) / 10;
      }
    }
    document.getElementById('obj-numerador').addEventListener('input', recalcular);
    document.getElementById('obj-denominador').addEventListener('input', recalcular);

    var origenValor = 'MANUAL';
    fondo.querySelector('.js-sgc-obj-sugerir').addEventListener('click', function () {
      var periodo = document.getElementById('obj-periodo').value;
      var caja = document.getElementById('obj-sugerencia');
      caja.innerHTML = Componentes.cargando('Consultando...');
      api_('sugerirLecturaObjetivoSgc', { objetivo_id: o.objetivo_id, periodo: periodo }).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          caja.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo consultar.', 'error');
          return;
        }
        var s = respuesta.data;
        caja.innerHTML = Componentes.alerta(s.nota, s.completo ? 'info' : 'advertencia');
        if (s.numerador !== '' && s.numerador !== null && s.numerador !== undefined) {
          document.getElementById('obj-numerador').value = s.numerador;
        }
        if (s.denominador !== '' && s.denominador !== null && s.denominador !== undefined) {
          document.getElementById('obj-denominador').value = s.denominador;
        }
        if (s.valor !== null && s.valor !== undefined) {
          document.getElementById('obj-valor').value = s.valor;
          origenValor = s.fuente === 'AUTO' ? 'AUTO' : 'MANUAL';
        }
      });
    });

    document.getElementById('form-sgc-obj-medir').addEventListener('submit', function (evento) {
      evento.preventDefault();
      // Se leen TODOS los valores del formulario ANTES de cerrar el modal:
      // cerrar() saca el <form> del DOM y cualquier lectura posterior
      // reventaria en silencio (bug real de la Fase 4).
      var datos = {
        objetivo_id: o.objetivo_id,
        periodo: document.getElementById('obj-periodo').value,
        valor: document.getElementById('obj-valor').value,
        numerador: document.getElementById('obj-numerador').value,
        denominador: document.getElementById('obj-denominador').value,
        observaciones: document.getElementById('obj-obs').value,
        origen: origenValor
      };
      api_('registrarLecturaObjetivoSgc', datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar la medición.', tipo: 'error' });
          return;
        }
        var cumple = respuesta.data.cumple;
        cerrar();
        Componentes.aviso({
          texto: cumple ? 'Medición registrada: alcanza la meta.' : 'Medición registrada: NO alcanza la meta.',
          tipo: cumple ? 'exito' : 'info'
        });
        abrirObjetivo_(o.objetivo_id);
      });
    });
  }

  function abrirFormularioObjetivo_(o, data) {
    var cat = (data.catalogos || {});
    var frecuencias = cat.frecuencias || [];
    var operadores = cat.operadores || [];
    var unidades = cat.unidades || [];

    function opciones(lista, seleccionado) {
      return lista.map(function (x) {
        return '<option value="' + x.clave + '"' + (x.clave === seleccionado ? ' selected' : '') + '>' +
          Componentes.escaparHtml(x.etiqueta) + '</option>';
      }).join('');
    }

    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Editar objetivo ' + o.numero + '</h3>' +
        '<p class="sigso-ayuda">Estos son los datos de DOC-07. Ajustarlos aquí no cambia el ' +
          'documento: actualiza el documento y deja el tablero igual.</p>' +
        '<form id="form-sgc-obj">' +
          Componentes.campoTexto({ id: 'obje-general', label: 'Objetivo general', valor: o.objetivo_general, requerido: true }) +
          Componentes.campoTextarea({ id: 'obje-especifico', label: 'Objetivo específico', valor: o.objetivo_especifico }) +
          Componentes.campoTextarea({ id: 'obje-indicador', label: 'Indicador', valor: o.indicador, requerido: true }) +
          Componentes.campoTexto({ id: 'obje-meta-texto', label: 'Meta (como la escribe DOC-07)', valor: o.meta_texto }) +
          '<div class="sgc-ficha__datos">' +
            '<label class="sigso-campo"><span class="sigso-campo__label">Comparación</span>' +
              '<select id="obje-operador" class="sigso-select">' + opciones(operadores, o.meta_operador) + '</select></label>' +
            Componentes.campoTexto({ id: 'obje-meta-valor', label: 'Valor de la meta', tipo: 'number', valor: o.meta_valor, requerido: true }) +
            '<label class="sigso-campo"><span class="sigso-campo__label">Unidad</span>' +
              '<select id="obje-unidad" class="sigso-select">' + opciones(unidades, o.unidad) + '</select></label>' +
          '</div>' +
          '<label class="sigso-campo"><span class="sigso-campo__label">Frecuencia de seguimiento</span>' +
            '<select id="obje-frecuencia" class="sigso-select">' + opciones(frecuencias, o.frecuencia) + '</select></label>' +
          Componentes.campoTexto({ id: 'obje-frecuencia-texto', label: 'Frecuencia (texto de DOC-07)', valor: o.frecuencia_texto }) +
          Componentes.campoTextarea({ id: 'obje-acciones', label: 'Acciones para lograrlo', valor: o.acciones }) +
          Componentes.campoTexto({ id: 'obje-responsable', label: 'Responsable', valor: o.responsable_texto }) +
          Componentes.campoTexto({ id: 'obje-responsable-email', label: 'Correo del responsable (opcional)', tipo: 'email', valor: o.responsable_email }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-sgc-obj').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var datos = {
        objetivo_id: o.objetivo_id,
        objetivo_general: document.getElementById('obje-general').value,
        objetivo_especifico: document.getElementById('obje-especifico').value,
        indicador: document.getElementById('obje-indicador').value,
        meta_texto: document.getElementById('obje-meta-texto').value,
        meta_operador: document.getElementById('obje-operador').value,
        meta_valor: document.getElementById('obje-meta-valor').value,
        unidad: document.getElementById('obje-unidad').value,
        frecuencia: document.getElementById('obje-frecuencia').value,
        frecuencia_texto: document.getElementById('obje-frecuencia-texto').value,
        acciones: document.getElementById('obje-acciones').value,
        responsable_texto: document.getElementById('obje-responsable').value,
        responsable_email: document.getElementById('obje-responsable-email').value
      };
      api_('guardarObjetivoSgc', datos).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        abrirObjetivo_(o.objetivo_id);
      });
    });
  }

  // --- Cobertura ISO (mejora propuesta, no en la especificación original) ----
  // Responde "¿estamos listos para la auditoría?": las 28 cláusulas de la
  // norma, con su estado calculado desde datos reales (no una opinión). El
  // "modo auditoría" es la ficha de cada cláusula: la lista de registros que
  // la sustentan, con boton para bajarla en PDF -- el auditor pide "muéstreme
  // 7.2" y sale en un clic.

  // ==========================================================================
  // v11.0 Fase 8 (§8.1, §8.5, §8.6 y §8.7): servicios prestados.
  //
  // Nada se pre-genera: una fila existe cuando alguien registra que el
  // servicio se prestó. Por eso el listado arranca acotado y pide un filtro
  // en vez de traerse el año entero.
  // ==========================================================================

  var filtrosPrestacion_ = { periodo: '', cliente_id: '', proceso_id: '', estado: '' };

  var ESTADO_PRESTACION_ETIQUETA = {
    PRESTADO: 'Prestado, sin liberar', LIBERADO: 'Liberado', NO_CONFORME: 'Salida no conforme'
  };
  var ESTADO_PRESTACION_TONO = { PRESTADO: 'alerta', LIBERADO: 'ok', NO_CONFORME: 'critico' };

  function cargarPrestaciones_() {
    var cont = panelSgc_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando servicios prestados...');
    api_('listarPrestacionesSgc', filtrosPrestacion_).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = barraSecciones_() +
          Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar el registro.', 'error');
        wireSecciones_(cont);
        return;
      }
      pintarPrestaciones_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = barraSecciones_() + Componentes.alerta('No se pudo conectar.', 'error');
      wireSecciones_(cont);
    });
  }

  function pintarPrestaciones_(cont, data) {
    var puede = !!data.puede_gestionar;
    var r = data.resumen || {};
    var v = data.volumen || {};

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">El registro de lo que efectivamente se le entregó a cada cliente (§8.1 y §8.5), ' +
      'quién autorizó la liberación (§8.6) y qué salió no conforme (§8.7).</p>' +
      '</div>';

    if (!data.procesos.length) {
      cont.innerHTML = cabecera +
        Componentes.alerta('No hay procesos de servicio cargados. Cárgalos primero en Procesos: ' +
          'sin ellos no hay qué registrar.', 'aviso');
      wireSecciones_(cont);
      return;
    }

    var kpis = '<div class="sgc-kpis">' + [
      Componentes.kpi({ etiqueta: 'Prestaciones', valor: r.total || 0 }),
      Componentes.kpi({ etiqueta: 'Liberadas', valor: r.liberado || 0 }),
      Componentes.kpi({ etiqueta: 'Sin liberar', valor: r.prestado || 0, alerta: !!r.prestado,
        titulo: '§8.6 pide que la liberación quede trazada a quien la autoriza.' }),
      Componentes.kpi({ etiqueta: 'No conformes', valor: r.no_conforme || 0, alerta: !!r.no_conforme }),
      Componentes.kpi({ etiqueta: 'Sin evidencia', valor: r.sin_evidencia || 0, alerta: !!r.sin_evidencia })
    ].join('') + '</div>';

    var avisoVolumen = v.aviso ? Componentes.alerta(v.aviso, 'error') : '';

    var opsCliente = [{ valor: '', texto: 'Todos los clientes' }].concat(
      (data.clientes || []).map(function (c) { return { valor: c.cliente_id, texto: c.nombre }; }));
    var opsProceso = [{ valor: '', texto: 'Todos los procesos' }].concat(
      (data.procesos || []).map(function (p) { return { valor: p.proceso_id, texto: p.codigo + ' — ' + p.nombre }; }));
    var opsEstado = [{ valor: '', texto: 'Todos los estados' }].concat(
      (data.estados || []).map(function (e) { return { valor: e, texto: ESTADO_PRESTACION_ETIQUETA[e] || e }; }));

    var filtros = '<div class="sgc-filtros">' +
      Componentes.campoTexto({ id: 'prs-f-periodo', label: false, valor: data.filtros.periodo,
        placeholder: 'Período (2026-M08)' }) +
      Componentes.campoSelect({ id: 'prs-f-cliente', label: false, valor: data.filtros.cliente_id,
        placeholder: false, opciones: opsCliente }) +
      Componentes.campoSelect({ id: 'prs-f-proceso', label: false, valor: data.filtros.proceso_id,
        placeholder: false, opciones: opsProceso }) +
      Componentes.campoSelect({ id: 'prs-f-estado', label: false, valor: data.filtros.estado,
        placeholder: false, opciones: opsEstado }) +
      '</div>';

    var avisoAcotado = data.acotada
      ? Componentes.alerta('Sin filtro se muestran las últimas ' + data.tope + ' prestaciones de ' +
          data.total_filtrado + '. Filtra por período o cliente para ver el resto.', 'aviso')
      : '';

    var lista = '';
    if (!data.prestaciones.length) {
      lista = '<p class="sigso-ayuda">No hay prestaciones registradas con esos filtros.</p>';
    } else {
      lista = '<div class="sgc-lista">' + data.prestaciones.map(function (p) {
        return '<div class="sgc-doc" data-prestacion-id="' + Componentes.escaparHtml(p.prestacion_id) + '">' +
          '<div class="sgc-doc__linea">' +
            '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(p.proceso_codigo + ' → ' + p.cliente_nombre) + '</span>' +
            Componentes.badge(ESTADO_PRESTACION_ETIQUETA[p.estado] || p.estado,
              ESTADO_PRESTACION_TONO[p.estado] || 'neutro') +
            (p.periodo ? Componentes.badge(p.periodo, 'neutro') : '') +
            (p.liberada_por_el_mismo ? Componentes.badge('Liberó quien prestó', 'alerta') : '') +
          '</div>' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(p.proceso_nombre) + '</span>' +
          '<div class="sgc-doc__linea">' +
            '<span class="sgc-doc__meta">Prestado el ' + fechaCorta_(p.fecha_prestacion) +
              ' por ' + Componentes.escaparHtml(p.responsable_email) + '</span>' +
            (p.liberado_por
              ? '<span class="sgc-doc__meta">Liberado el ' + fechaCorta_(p.fecha_liberacion) +
                ' por ' + Componentes.escaparHtml(p.liberado_por) + '</span>'
              : '') +
          '</div>' +
          (p.evidencia
            ? '<span class="sgc-doc__meta">Evidencia: ' + Componentes.escaparHtml(p.evidencia) + '</span>'
            : '<span class="sgc-doc__meta">Sin evidencia registrada</span>') +
          (p.observaciones ? '<span class="sgc-doc__meta">' + Componentes.escaparHtml(p.observaciones) + '</span>' : '') +
          (p.nc_id ? '<span class="sgc-doc__meta">Con no conformidad abierta</span>' : '') +
          (puede ? '<div class="sgc-acciones">' +
            (p.estado === 'PRESTADO'
              ? Componentes.boton({ texto: 'Liberar', clase: 'js-prs-liberar' }) : '') +
            (p.estado !== 'NO_CONFORME'
              ? Componentes.boton({ texto: 'Marcar no conforme', variante: 'secundario', clase: 'js-prs-noconforme' }) : '') +
            (p.estado === 'NO_CONFORME' && !p.nc_id
              ? Componentes.boton({ texto: 'Abrir no conformidad', clase: 'js-prs-nc' }) : '') +
            Componentes.boton({ texto: 'Anular', variante: 'peligro', clase: 'js-prs-anular' }) +
          '</div>' : '') +
        '</div>';
      }).join('') + '</div>';
    }

    var acciones = puede ? '<div class="sgc-acciones">' +
      Componentes.boton({ texto: 'Registrar prestación', clase: 'js-prs-nueva' }) +
      '</div>' : '';

    cont.innerHTML = cabecera + kpis + avisoVolumen + filtros + acciones + avisoAcotado + lista;
    wireSecciones_(cont);

    ['periodo', 'cliente_id', 'proceso_id', 'estado'].forEach(function (campo) {
      var id = 'prs-f-' + (campo === 'cliente_id' ? 'cliente' : (campo === 'proceso_id' ? 'proceso' : campo));
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', function () {
        filtrosPrestacion_[campo] = el.value;
        cargarPrestaciones_();
      });
    });

    if (!puede) return;

    function delBoton_(btn) {
      var id = btn.parentNode.parentNode.getAttribute('data-prestacion-id');
      return buscarPorId_(data.prestaciones, 'prestacion_id', id);
    }
    function enviar_(accion, datos) {
      api_(accion, datos).then(function (resp) {
        var d = (resp && resp.data) || {};
        Componentes.aviso({
          texto: d.message || (resp && resp.message) || 'Listo.',
          tipo: (resp && resp.ok && d.ok !== false) ? 'exito' : 'error'
        });
        if (resp && resp.ok && d.ok !== false) cargarPrestaciones_();
      });
    }

    cont.querySelector('.js-prs-nueva').addEventListener('click', function () {
      abrirFormularioPrestacion_(data);
    });

    cont.querySelectorAll('.js-prs-liberar').forEach(function (b) {
      b.addEventListener('click', function () { abrirLiberacion_(delBoton_(b)); });
    });

    cont.querySelectorAll('.js-prs-noconforme').forEach(function (b) {
      b.addEventListener('click', function () { abrirNoConforme_(delBoton_(b)); });
    });

    cont.querySelectorAll('.js-prs-nc').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = delBoton_(b);
        Componentes.confirmar({
          titulo: '¿Abrir una no conformidad?',
          mensaje: 'Se crea con el mismo ciclo del PRO-06 que ya usan las quejas y los hallazgos de auditoría: ' +
            'corrección, causa raíz, acción correctiva y verificación de eficacia.',
          confirmar: 'Abrirla'
        }).then(function (ok) {
          if (ok) enviar_('abrirNcPrestacionSgc', { prestacion_id: p.prestacion_id, responsable_email: p.responsable_email });
        });
      });
    });

    cont.querySelectorAll('.js-prs-anular').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = delBoton_(b);
        Componentes.confirmar({
          titulo: '¿Anular esta prestación?',
          mensaje: 'Deja de contar como evidencia. Úsalo solo si se registró por error.',
          confirmar: 'Anular', peligro: true
        }).then(function (ok) {
          if (ok) enviar_('anularPrestacionSgc', { prestacion_id: p.prestacion_id });
        });
      });
    });
  }

  function abrirLiberacion_(p) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Liberar el servicio</h3>' +
        '<p class="sigso-ayuda">' + Componentes.escaparHtml(p.proceso_codigo + ' → ' + p.cliente_nombre) + '</p>' +
        '<p class="sigso-ayuda">§8.6 pide trazabilidad a la persona que autoriza la liberación. ' +
        'El DOC-01 dice que la hace la jefatura de cada área.</p>' +
        '<form id="form-prs-liberar">' +
          Componentes.campoTexto({ id: 'prs-lib-quien', label: 'Autoriza (correo)',
            valor: '', requerido: true }) +
          Componentes.campoTexto({ id: 'prs-lib-fecha', label: 'Fecha de liberación', tipo: 'date', valor: '' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Liberar', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-prs-liberar').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true;
      api_('liberarPrestacionSgc', {
        prestacion_id: p.prestacion_id,
        liberado_por: document.getElementById('prs-lib-quien').value,
        fecha_liberacion: document.getElementById('prs-lib-fecha').value
      }).then(function (resp) {
        var d = (resp && resp.data) || {};
        if (!resp || !resp.ok || d.ok === false) {
          boton.disabled = false;
          Componentes.aviso({ texto: d.message || 'No se pudo liberar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: d.message || 'Servicio liberado.', tipo: 'exito' });
        cargarPrestaciones_();
      });
    });
  }

  function abrirNoConforme_(p) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Marcar como salida no conforme</h3>' +
        '<p class="sigso-ayuda">' + Componentes.escaparHtml(p.proceso_codigo + ' → ' + p.cliente_nombre) + '</p>' +
        '<p class="sigso-ayuda">Si estaba liberada, deja de estarlo: §8.7 pide no entregar una salida no conforme ' +
        'hasta corregirla.</p>' +
        '<form id="form-prs-nc">' +
          Componentes.campoTextarea({ id: 'prs-nc-motivo', label: 'En qué no conformó',
            valor: '', requerido: true,
            ayuda: 'Sin esto no hay nada que tratar después.' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Marcar', tipo: 'submit', clase: 'js-sgc-guardar', variante: 'peligro' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-prs-nc').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true;
      api_('marcarNoConformePrestacionSgc', {
        prestacion_id: p.prestacion_id,
        observaciones: document.getElementById('prs-nc-motivo').value
      }).then(function (resp) {
        var d = (resp && resp.data) || {};
        if (!resp || !resp.ok || d.ok === false) {
          boton.disabled = false;
          Componentes.aviso({ texto: d.message || 'No se pudo marcar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: d.message || 'Marcada.', tipo: 'exito' });
        cargarPrestaciones_();
      });
    });
  }

  function abrirFormularioPrestacion_(data) {
    var opsCliente = (data.clientes || []).map(function (c) {
      return { valor: c.cliente_id, texto: c.nombre + (c.rut ? ' (' + c.rut + ')' : '') };
    });
    var opsProceso = (data.procesos || []).map(function (p) {
      return { valor: p.proceso_id, texto: p.codigo + ' — ' + p.nombre };
    });

    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Registrar prestación</h3>' +
        '<p class="sigso-ayuda">Un registro por servicio efectivamente entregado. No se generan por adelantado: ' +
        'lo que no ocurrió no ocupa lugar.</p>' +
        '<form id="form-prs">' +
          Componentes.campoSelect({ id: 'prs-cliente', label: 'Cliente', valor: '',
            requerido: true, placeholder: 'Selecciona el cliente...', opciones: opsCliente }) +
          Componentes.campoSelect({ id: 'prs-proceso', label: 'Proceso de servicio', valor: '',
            requerido: true, placeholder: 'Selecciona el proceso...', opciones: opsProceso }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'prs-periodo', label: 'Período', valor: '',
              ayuda: 'Solo para servicios recurrentes (2026-M08). Déjalo vacío si es puntual.' }) +
            Componentes.campoTexto({ id: 'prs-fecha', label: 'Fecha de prestación', tipo: 'date',
              valor: '', requerido: true }) +
          '</div>' +
          Componentes.campoTexto({ id: 'prs-responsable', label: 'Quién lo prestó (correo)',
            valor: '', requerido: true }) +
          Componentes.campoTextarea({ id: 'prs-evidencia', label: 'Evidencia',
            valor: '', ayuda: 'Folio, número de formulario, enlace al archivo... lo que permita encontrarlo después.' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Registrar', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-prs').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true;
      api_('registrarPrestacionSgc', {
        cliente_id: document.getElementById('prs-cliente').value,
        proceso_id: document.getElementById('prs-proceso').value,
        periodo: document.getElementById('prs-periodo').value,
        fecha_prestacion: document.getElementById('prs-fecha').value,
        responsable_email: document.getElementById('prs-responsable').value,
        evidencia: document.getElementById('prs-evidencia').value
      }).then(function (resp) {
        var d = (resp && resp.data) || {};
        if (!resp || !resp.ok || d.ok === false) {
          boton.disabled = false;
          Componentes.aviso({ texto: d.message || 'No se pudo registrar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: d.message || 'Prestación registrada.', tipo: 'exito' });
        cargarPrestaciones_();
      }).catch(function () {
        boton.disabled = false;
        Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
      });
    });
  }

  // ==========================================================================
  // v11.0 Fase 7: el tablero del SGC.
  //
  // Responde de una mirada las preguntas del Encargado: dónde estamos, qué
  // está vencido, qué viene. Cada alerta sabe a qué sección lleva: una lista
  // de problemas sin el camino para resolverlos es una lista de reproches.
  // ==========================================================================

  var SEV_TONO = { CRITICA: 'critico', ALTA: 'alerta', MEDIA: 'info' };
  var SEV_ETIQUETA = { CRITICA: 'Crítico', ALTA: 'Requiere atención', MEDIA: 'Próximo' };

  // ==========================================================================
  // v15.0 — INICIO ADAPTATIVO
  //
  // Antes esta portada era SÓLO de gobierno: quien no supervisaba el SGC no
  // tenía inicio y el módulo lo dejaba caer en la lista de documentos, sin
  // saludo, sin saber qué tenía pendiente ni por dónde empezar. Era el
  // origen real del "me pierdo": la mayoría de las personas entraba a un
  // archivador ordenado por código ISO.
  //
  // Ahora Inicio existe para todos y tiene dos caras, decididas por el mismo
  // permiso de siempre (secciones_visibles.tablero):
  //   - GOBIERNO  (Encargado / Dirección / Gerencia): qué requiere atención,
  //     qué viene, cómo está el sistema, y recién al final el avance ISO.
  //   - PERSONAL  (operativo y jefatura): qué tengo que hacer, buscar un
  //     documento, accesos rápidos y mi ficha.
  // Ninguna de las dos inventa datos: ambas se arman con endpoints que ya
  // existían (resumenTableroSgc / listarDocumentosSgc + listarPersonasSgc).
  // ==========================================================================

  function cargarInicio_() {
    var cont = panelSgc_();
    if (!cont) return;
    var cache = cacheListadoSgc_.inicio;
    if (cache) pintarInicio_(cont, cache);
    else cont.innerHTML = Componentes.cargando('Preparando tu inicio...');

    // Si ya sabemos que no supervisa, no se pide el resumen de gobierno:
    // devolvería "sin acceso" y sería un viaje perdido en cada entrada.
    if (seccionesVisibles_ && !superviseSgc_()) { cargarInicioPersonal_(cont, !!cache); return; }

    api_('resumenTableroSgc', {}).then(function (respuesta) {
      if (seccionActiva_ !== 'inicio') return;
      if (!respuesta || !respuesta.ok) { cargarInicioPersonal_(cont, !!cache); return; }
      if (respuesta.data.secciones_visibles) seccionesVisibles_ = respuesta.data.secciones_visibles;
      var datos = { modo: 'gobierno', gob: respuesta.data };
      cacheListadoSgc_.inicio = datos;
      pintarInicio_(cont, datos);
    }).catch(function () {
      if (cache || seccionActiva_ !== 'inicio') return;
      cont.innerHTML = barraSecciones_() +
        Componentes.alerta('No se pudo conectar para preparar tu inicio. Revisa tu conexión y vuelve a intentarlo.', 'error');
      wireSecciones_(cont);
    });
  }

  // "Lo tuyo": se arma con los dos listados que esta persona SÍ puede pedir.
  function cargarInicioPersonal_(cont, hayCache) {
    Promise.all([
      api_('listarDocumentosSgc', {}),
      api_('listarPersonasSgc', {}).catch(function () { return null; })
    ]).then(function (res) {
      if (seccionActiva_ !== 'inicio') return;
      var docs = res[0];
      if (!docs || !docs.ok) {
        if (hayCache) return;
        cont.innerHTML = barraSecciones_() +
          Componentes.alerta((docs && docs.message) || 'No se pudo preparar tu inicio.', 'error');
        wireSecciones_(cont);
        return;
      }
      if (docs.data.secciones_visibles) seccionesVisibles_ = docs.data.secciones_visibles;
      var personas = (res[1] && res[1].ok && res[1].data) ? res[1].data : null;
      var datos = { modo: 'personal', docs: docs.data, personas: personas };
      cacheListadoSgc_.inicio = datos;
      pintarInicio_(cont, datos);
    }).catch(function () {
      if (hayCache || seccionActiva_ !== 'inicio') return;
      cont.innerHTML = barraSecciones_() +
        Componentes.alerta('No se pudo conectar para preparar tu inicio.', 'error');
      wireSecciones_(cont);
    });
  }

  function pintarInicio_(cont, datos) {
    if (datos.modo === 'gobierno') pintarTablero_(cont, datos.gob);
    else pintarInicioPersonal_(cont, datos);
  }

  // Cuántos ítems de la lista de tareas se muestran antes de "ver todos".
  var MAX_PENDIENTES_INICIO = 4;

  function pintarInicioPersonal_(cont, datos) {
    var d = datos.docs || {};
    var docs = d.documentos || [];
    var pendientes = docs.filter(function (x) { return x.debo_acusar; });
    var mia = (datos.personas && (datos.personas.personas || [])[0]) || null;
    var nombre = (window.SIGSO_USUARIO && SIGSO_USUARIO.nombre) || (mia && mia.nombre) || '';
    var rol = ROL_SGC_ETIQUETA[d.rol_sgc] || d.rol_sgc || '';

    // --- 1. Lo que hay que hacer -------------------------------------------
    // Va PRIMERO y es lo único con peso visual de nivel 1: es la única
    // acción real que el personal operativo tiene en el módulo.
    var tarea;
    if (pendientes.length) {
      var visibles = pendientes.slice(0, MAX_PENDIENTES_INICIO);
      tarea = '<section class="sgc-ini-tarea">' +
        '<div class="sgc-ini-tarea__cab">' +
          '<h2 class="sgc-ini-tarea__titulo">' +
            (pendientes.length === 1
              ? 'Tienes 1 documento por confirmar'
              : 'Tienes ' + pendientes.length + ' documentos por confirmar') +
          '</h2>' +
          '<p class="sgc-ini-tarea__ayuda">Ábrelo, léelo y marca <b>Enterado</b>. Así queda registro de que lo conoces.</p>' +
        '</div>' +
        '<ul class="sgc-ini-lista" role="list">' + visibles.map(function (x) {
          var vence = x.dias_para_acuse;
          var plazo = (vence === null || vence === undefined) ? ''
            : (vence < 0 ? '<span class="sgc-ini-plazo sgc-ini-plazo--vencido">Plazo vencido</span>'
              : (vence <= 7 ? '<span class="sgc-ini-plazo">Quedan ' + vence + ' día(s)</span>' : ''));
          return '<li class="sgc-ini-fila">' +
            '<div class="sgc-ini-fila__texto">' +
              '<span class="sgc-ini-fila__nombre">' + Componentes.escaparHtml(x.nombre) + '</span>' +
              '<span class="sgc-ini-fila__meta">' +
                Componentes.escaparHtml(TIPO_ETIQUETA[x.tipo] || x.tipo) +
                ' · ' + Componentes.escaparHtml(x.codigo) + plazo +
              '</span>' +
            '</div>' +
            Componentes.boton({ texto: 'Abrir y confirmar', variante: 'secundario',
              clase: 'js-ini-doc', idx: x.documento_id }) +
          '</li>';
        }).join('') + '</ul>' +
        (pendientes.length > visibles.length
          ? '<div class="sgc-ini-tarea__pie">' +
              Componentes.boton({ texto: 'Ver los ' + pendientes.length + ' pendientes',
                variante: 'sutil', clase: 'js-ini-pendientes' }) +
            '</div>'
          : '') +
      '</section>';
    } else {
      tarea = '<section class="sgc-ini-tarea sgc-ini-tarea--ok">' +
        '<h2 class="sgc-ini-tarea__titulo">Estás al día</h2>' +
        '<p class="sgc-ini-tarea__ayuda">No tienes documentos pendientes de confirmar. ' +
          'Si se publica uno nuevo que te corresponda, aparecerá acá.</p>' +
      '</section>';
    }

    // --- 2. Encontrar un documento -----------------------------------------
    var atajos = [
      { tipo: 'PRO', texto: 'Procedimientos' },
      { tipo: 'INS', texto: 'Instructivos' },
      { tipo: 'FO', texto: 'Formularios' },
      { tipo: '', texto: 'Ver todos' }
    ].map(function (a) {
      return '<button type="button" class="sgc-chip js-ini-tipo" data-tipo="' + a.tipo + '">' +
        Componentes.escaparHtml(a.texto) + '</button>';
    }).join('');

    var buscar = '<section class="sgc-ini-bloque">' +
      '<h3 class="sgc-ini-bloque__titulo">¿Qué documento necesitas?</h3>' +
      '<form class="sgc-ini-buscar" id="form-ini-buscar" role="search">' +
        '<label class="sigso-oculto-visual" for="ini-q">Buscar un documento</label>' +
        '<input type="search" id="ini-q" name="q" placeholder="Escribe una palabra: vacaciones, auditoría, reclamo...">' +
        Componentes.boton({ texto: 'Buscar', tipo: 'submit' }) +
      '</form>' +
      '<div class="sgc-ini-chips">' + atajos + '</div>' +
      '<p class="sigso-ayuda">Tienes ' + docs.length + ' documento(s) disponibles.</p>' +
    '</section>';

    // --- 3. Mi ficha (información, no tarea) --------------------------------
    // La inducción se muestra como ESTADO: quien la marca es la jefatura o el
    // Encargado (Personas.registrarInduccion), no la propia persona. Ponerle
    // un botón acá sería prometer una acción que el backend va a rechazar.
    var ficha = '';
    if (mia) {
      var indTotal = mia.induccion_total || 0;
      var indHechas = mia.induccion_completadas || 0;
      ficha = '<section class="sgc-ini-bloque">' +
        '<h3 class="sgc-ini-bloque__titulo">Tu ficha</h3>' +
        '<div class="sgc-ini-ficha">' +
          '<div class="sgc-ini-ficha__datos">' +
            '<span class="sgc-ini-ficha__nombre">' + Componentes.escaparHtml(mia.nombre) + '</span>' +
            '<span class="sgc-ini-ficha__meta">' +
              Componentes.escaparHtml(mia.cargo || 'Sin cargo registrado') +
              (mia.area_id ? ' · ' + Componentes.escaparHtml(mia.area_id) : '') +
            '</span>' +
            (indTotal
              ? '<span class="sgc-ini-ficha__meta">Inducción: ' + indHechas + ' de ' + indTotal +
                (indHechas >= indTotal ? ' — completa' : ' — la registra tu jefatura') + '</span>'
              : '') +
          '</div>' +
          Componentes.boton({ texto: 'Ver mi ficha', variante: 'sutil', clase: 'js-ini-ficha' }) +
        '</div>' +
      '</section>';
    }

    var saludo = '<div class="sgc-ini-cab">' +
      '<h1 class="sgc-ini-cab__titulo">' +
        (nombre ? 'Hola, ' + Componentes.escaparHtml(nombre) : 'Tus documentos y pendientes') + '</h1>' +
      '<p class="sgc-ini-cab__sub">Acá tienes lo tuyo del Sistema de Gestión de Calidad' +
        (rol ? ' · ' + Componentes.escaparHtml(rol) : '') + '.</p>' +
    '</div>';

    cont.innerHTML = barraSecciones_() +
      '<div class="sgc-ini">' + saludo + tarea + buscar + ficha + '</div>';
    wireSecciones_(cont);

    cont.querySelectorAll('.js-ini-doc').forEach(function (b) {
      b.addEventListener('click', function () {
        seccionActiva_ = 'documentos';
        abrirDocumento_(b.getAttribute('data-idx'));
      });
    });
    var verPend = cont.querySelector('.js-ini-pendientes');
    if (verPend) verPend.addEventListener('click', function () {
      filtroPendientes_ = true; filtroTipo_ = ''; filtroBusqueda_ = '';
      irASeccion_('documentos', '');
    });
    cont.querySelectorAll('.js-ini-tipo').forEach(function (b) {
      b.addEventListener('click', function () {
        filtroPendientes_ = false; filtroBusqueda_ = '';
        irASeccion_('documentos', b.getAttribute('data-tipo') || '');
      });
    });
    var formBuscar = cont.querySelector('#form-ini-buscar');
    if (formBuscar) formBuscar.addEventListener('submit', function (ev) {
      ev.preventDefault();
      filtroPendientes_ = false; filtroTipo_ = '';
      filtroBusqueda_ = (cont.querySelector('#ini-q') || {}).value || '';
      irASeccion_('documentos', '');
    });
    var verFicha = cont.querySelector('.js-ini-ficha');
    if (verFicha) verFicha.addEventListener('click', function () { irASeccion_('personas', ''); });
  }

  function pintarTablero_(cont, data) {
    var s = data.salud || {};
    var c = data.conteos || {};

    // v15.0: mismo encabezado que la portada del personal, para que las dos
    // caras de Inicio se sientan la misma pantalla: saludo + una línea de
    // contexto. Acá el contexto es a qué organización pertenece este SGC.
    var cabecera = barraSecciones_() + '<div class="sgc-ini-cab">' +
      '<h1 class="sgc-ini-cab__titulo">Estado del sistema</h1>' +
      '<p class="sgc-ini-cab__sub">' +
        (data.alcance
          ? Componentes.escaparHtml(data.alcance.razon_social) +
            (data.alcance.nombre_fantasia ? ' (' + Componentes.escaparHtml(data.alcance.nombre_fantasia) + ')' : '') +
            ' — ' + Componentes.escaparHtml(data.alcance.norma) +
            ', alcance v' + Componentes.escaparHtml(data.alcance.version) + '.'
          : 'El alcance del SGC todavía no está declarado.') +
      '</p>' +
    '</div>';

    // --- salud -----------------------------------------------------------
    var barras = (s.capitulos || []).map(function (cap) {
      var tono = cap.pct >= 80 ? 'ok' : (cap.pct >= 40 ? 'alerta' : 'critico');
      return '<div class="sgc-cap">' +
        '<div class="sgc-cap__cab">' +
          '<span class="sgc-cap__num">' + Componentes.escaparHtml(cap.numero) + '</span>' +
          '<span class="sgc-cap__titulo">' + Componentes.escaparHtml(cap.titulo) + '</span>' +
          '<span class="sgc-cap__pct">' + cap.pct + '%</span>' +
        '</div>' +
        '<div class="sgc-cap__barra"><span class="sgc-cap__relleno sgc-cap__relleno--' + tono +
          '" style="width:' + cap.pct + '%"></span></div>' +
        '<span class="sgc-cap__detalle">' + cap.completo + ' completas · ' + cap.parcial +
          ' parciales · ' + cap.faltante + ' faltantes' +
          (cap.no_aplica ? ' · ' + cap.no_aplica + ' no aplica' : '') + '</span>' +
      '</div>';
    }).join('');

    // v15.0: el avance ISO baja al final y se pliega.
    //
    // Antes era lo PRIMERO y lo más grande de la portada: un "27%" gigante
    // sobre siete barras por capítulo de la norma. Dos problemas: (a) un
    // número que necesita un párrafo de descargo para no leerse como "vamos
    // 27% certificados" está mal presentado, no mal explicado; y (b) las
    // barras son el índice de la ISO, útil para el Encargado en una revisión,
    // inútil para decidir qué hacer hoy. Ahora se llama por lo que es
    // -- avance interno de implementación -- y se abre sólo si lo buscas.
    var salud = '<details class="sgc-avance">' +
      '<summary class="sgc-avance__cab">' +
        '<span class="sgc-avance__titulo">Avance interno de implementación</span>' +
        '<span class="sgc-avance__cifra">' + (s.pct || 0) + '%</span>' +
        '<span class="sgc-avance__detalle">' + (s.aplicables || 0) + ' requisitos en alcance' +
          (s.no_aplica ? ' · ' + s.no_aplica + ' excluido(s)' : '') + '</span>' +
      '</summary>' +
      '<div class="sgc-avance__cuerpo">' +
        '<p class="sigso-ayuda">Mide cuánta evidencia hay cargada en SIGSO. ' +
          '<b>No es un porcentaje de certificación</b>: quien certifica es la casa ' +
          'certificadora, y lo hace con hallazgos.</p>' +
        '<div class="sgc-salud__capitulos">' + barras + '</div>' +
        (s.aviso ? '<p class="sigso-ayuda">' + Componentes.escaparHtml(s.aviso) + '</p>' : '') +
      '</div>' +
    '</details>';

    // --- lo que requiere atención -------------------------------------------
    // v15.0: pasa a ser lo PRIMERO de la portada (antes iba debajo del bloque
    // de avance ISO). Es lo único accionable de esta pantalla, así que es lo
    // único que merece el peso visual de nivel 1. Las alertas ya vienen del
    // backend con severidad y sección de destino: acá sólo se ordenan de más
    // grave a menos, y se dice hacia dónde lleva cada una.
    var ORDEN_SEV = { CRITICA: 0, ALTA: 1, MEDIA: 2 };
    var listaAlertas = (data.alertas || []).slice().sort(function (a, b) {
      return (ORDEN_SEV[a.severidad] === undefined ? 9 : ORDEN_SEV[a.severidad]) -
             (ORDEN_SEV[b.severidad] === undefined ? 9 : ORDEN_SEV[b.severidad]);
    });
    var alertas = '';
    if (!listaAlertas.length) {
      alertas = '<section class="sgc-ini-tarea sgc-ini-tarea--ok">' +
        '<h2 class="sgc-ini-tarea__titulo">El sistema está al día</h2>' +
        '<p class="sgc-ini-tarea__ayuda">No hay nada vencido ni por vencer. ' +
          'Cuando algo requiera atención aparecerá acá primero.</p>' +
      '</section>';
    } else {
      alertas = '<section class="sgc-atencion">' +
        '<h2 class="sgc-atencion__titulo">Requiere tu atención' +
          '<span class="sgc-atencion__cuenta">' + listaAlertas.length + '</span></h2>' +
        '<ul class="sgc-ini-lista" role="list">' + listaAlertas.map(function (a) {
          var tono = SEV_TONO[a.severidad] || 'neutro';
          return '<li class="sgc-ini-fila sgc-ini-fila--' + tono + '">' +
            '<div class="sgc-ini-fila__texto">' +
              '<span class="sgc-ini-fila__nombre">' +
                Componentes.escaparHtml(a.titulo) +
                Componentes.badge(String(a.total), tono) +
                Componentes.badge(SEV_ETIQUETA[a.severidad] || a.severidad, tono) +
              '</span>' +
              '<span class="sgc-ini-fila__meta">' + Componentes.escaparHtml(a.detalle) + '</span>' +
            '</div>' +
            Componentes.boton({ texto: 'Revisar', variante: 'secundario',
              clase: 'js-tab-ir', idx: a.seccion }) +
          '</li>';
        }).join('') + '</ul>' +
      '</section>';
    }

    // --- hitos -------------------------------------------------------------
    var hitos = '';
    if ((data.hitos || []).length) {
      hitos = '<h4 class="sgc-sub">Próximos hitos</h4>' +
        '<div class="sgc-lista">' + data.hitos.map(function (h) {
          return '<button type="button" class="sgc-doc js-tab-ir" data-seccion="' +
            Componentes.escaparHtml(h.seccion) + '">' +
            '<div class="sgc-doc__linea">' +
              '<span class="sgc-doc__codigo">' + fechaCorta_(h.fecha) + '</span>' +
              '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(h.titulo) + '</span>' +
            '</div>' +
          '</button>';
        }).join('') + '</div>';
    } else {
      hitos = '<h4 class="sgc-sub">Próximos hitos</h4>' +
        '<p class="sigso-ayuda">No hay fechas comprometidas por delante.</p>';
    }

    // --- conteos -----------------------------------------------------------
    // v15.0: "El sistema en números" pasa a ser una tira compacta al final.
    // Son inventario (cuántas cosas hay), no decisiones: informan el tamaño
    // del sistema, no qué hacer hoy. Se quita el "14 + 40" de Procesos, que
    // nadie podía interpretar sin pasar el mouse por encima.
    // Se quitan "NC abiertas" y "Quejas abiertas": ya aparecen arriba, en
    // "Requiere tu atención", donde además llevan a resolverlas. Repetirlas
    // acá como número suelto no agregaba una decisión, agregaba ruido.
    var conteos = '<h3 class="sgc-ini-bloque__titulo">El sistema en números</h3><div class="sgc-kpis">' + [
      Componentes.kpi({ etiqueta: 'Documentos vigentes', valor: c.documentos_vigentes || 0,
        titulo: (c.documentos_externos || 0) + ' de origen externo' }),
      Componentes.kpi({ etiqueta: 'Procesos', valor: (c.procesos_mapa || 0) + (c.procesos_servicio || 0),
        titulo: (c.procesos_mapa || 0) + ' del mapa y ' + (c.procesos_servicio || 0) + ' de servicio' }),
      Componentes.kpi({ etiqueta: 'Riesgos', valor: c.riesgos || 0,
        titulo: (c.riesgos_altos || 0) + ' altos o críticos' }),
      Componentes.kpi({ etiqueta: 'Indicadores', valor: c.indicadores || 0 }),
      Componentes.kpi({ etiqueta: 'Auditorías hechas', valor: c.auditorias_ejecutadas || 0 })
    ].join('') + '</div>';

    // Orden nuevo: qué requiere atención -> qué viene -> cuánto hay -> avance.
    // (Antes: avance ISO -> alertas -> hitos -> números.)
    cont.innerHTML = cabecera + '<div class="sgc-ini">' +
      alertas + hitos + conteos + salud + '</div>';
    wireSecciones_(cont);

    cont.querySelectorAll('.js-tab-ir').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var destino = btn.getAttribute('data-idx') || btn.getAttribute('data-seccion');
        if (!destino) return;
        irASeccion_(destino, '');
      });
    });
  }

  // ==========================================================================
  // v11.0 Fase 6 (§9.1.1): indicadores de proceso.
  //
  // Distinto del tablero de Objetivos: aquellos son los seis del DOC-07,
  // corporativos y anuales. Estos miden un proceso concreto y tienen un
  // escalon intermedio -- cumple / alerta / no cumple -- porque un 88%
  // contra una meta de 90% no es lo mismo que un 40%.
  // ==========================================================================

  var VEREDICTO_ETIQUETA_IND = { CUMPLE: 'Cumple', ALERTA: 'En alerta', NO_CUMPLE: 'No cumple' };
  var VEREDICTO_TONO_IND = { CUMPLE: 'ok', ALERTA: 'alerta', NO_CUMPLE: 'critico' };

  function cargarIndicadores_() {
    var cont = panelSgc_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando indicadores...');
    api_('listarIndicadoresSgc', {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = barraSecciones_() +
          Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar el tablero.', 'error');
        wireSecciones_(cont);
        return;
      }
      pintarIndicadores_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = barraSecciones_() + Componentes.alerta('No se pudo conectar.', 'error');
      wireSecciones_(cont);
    });
  }

  function pintarIndicadores_(cont, data) {
    var puede = !!data.puede_gestionar;
    var r = data.resumen || {};

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Indicadores por proceso (§9.1.1). Los objetivos de calidad del DOC-07 ' +
      'viven en su propia sección: esto mide cómo va cada proceso, con su fórmula y su responsable.</p>' +
      '</div>';

    var kpis = '<div class="sgc-kpis">' + [
      Componentes.kpi({ etiqueta: 'Indicadores', valor: r.total || 0 }),
      Componentes.kpi({ etiqueta: 'Cumplen', valor: r.cumplen || 0 }),
      Componentes.kpi({ etiqueta: 'En alerta', valor: r.alerta || 0, alerta: !!r.alerta,
        titulo: 'Bajo la meta pero dentro de la tolerancia definida.' }),
      Componentes.kpi({ etiqueta: 'No cumplen', valor: r.no_cumplen || 0, alerta: !!r.no_cumplen }),
      Componentes.kpi({ etiqueta: 'Sin medir', valor: r.sin_medir || 0 })
    ].join('') + '</div>';

    // El dato que la organizacion se comprometio a cerrar: la debilidad D1
    // del FODA es "no hay KPIs en todas las areas".
    var avisoProcesos = '';
    if (r.procesos_mapa && r.procesos_sin_indicador) {
      avisoProcesos = Componentes.alerta(
        r.procesos_sin_indicador + ' de los ' + r.procesos_mapa + ' procesos del mapa no tienen ningún ' +
        'indicador. Es la debilidad D1 del FODA ("no se han establecido KPIs en todas las áreas") ' +
        'y la acción del riesgo R1.',
        'aviso');
    }

    var lista = '';
    if (!data.indicadores.length) {
      lista = Componentes.alerta('Todavía no hay indicadores definidos.', 'aviso') +
        (puede ? '<p class="sigso-ayuda">Cada indicador necesita una fórmula: sin ella, dos personas ' +
          'pueden medir lo mismo de forma distinta y el número deja de ser comparable.</p>' : '');
    } else {
      lista = '<div class="sgc-lista">' + data.indicadores.map(function (i) {
        var u = i.ultima_lectura;
        return '<div class="sgc-doc" data-indicador-id="' + Componentes.escaparHtml(i.indicador_id) + '">' +
          '<div class="sgc-doc__linea">' +
            '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(i.codigo + ' — ' + i.nombre) + '</span>' +
            (u ? Componentes.badge(VEREDICTO_ETIQUETA_IND[u.veredicto] || u.veredicto,
                   VEREDICTO_TONO_IND[u.veredicto] || 'neutro')
               : Componentes.badge('Sin medir', 'neutro')) +
            (i.lecturas_pendientes ? Componentes.badge(i.lecturas_pendientes + ' pendiente(s)', 'alerta') : '') +
          '</div>' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(i.formula) + '</span>' +
          '<div class="sgc-doc__linea">' +
            '<span class="sgc-doc__meta">Meta: ' + Componentes.escaparHtml(textoMetaIndicador_(i)) + '</span>' +
            (u ? '<span class="sgc-doc__meta">Última: ' + Componentes.escaparHtml(u.periodo) + ' = ' + u.valor +
                 (i.unidad === 'PORCENTAJE' ? '%' : '') + '</span>' : '') +
          '</div>' +
          (i.proceso ? '<span class="sgc-doc__meta">Proceso: ' + Componentes.escaparHtml(i.proceso) + '</span>' : '') +
          (i.objetivo ? '<span class="sgc-doc__meta">Alimenta: ' + Componentes.escaparHtml(i.objetivo) + '</span>' : '') +
          (i.responsable_email ? '<span class="sgc-doc__meta">Responsable: ' + Componentes.escaparHtml(i.responsable_email) + '</span>' : '') +
          (puede ? '<div class="sgc-acciones">' +
            Componentes.boton({ texto: 'Medir', clase: 'js-ind-medir' }) +
            Componentes.boton({ texto: 'Editar', variante: 'sutil', clase: 'js-ind-editar' }) +
            Componentes.boton({ texto: 'Quitar', variante: 'peligro', clase: 'js-ind-quitar' }) +
          '</div>' : '') +
        '</div>';
      }).join('') + '</div>';
    }

    var acciones = puede ? '<div class="sgc-acciones">' +
      Componentes.boton({ texto: 'Definir indicador', clase: 'js-ind-nuevo' }) +
      '</div>' : '';

    cont.innerHTML = cabecera + kpis + avisoProcesos + acciones + lista;
    wireSecciones_(cont);
    if (!puede) return;

    function delBoton_(btn) {
      var id = btn.parentNode.parentNode.getAttribute('data-indicador-id');
      return buscarPorId_(data.indicadores, 'indicador_id', id);
    }
    function enviar_(accion, datos) {
      api_(accion, datos).then(function (resp) {
        var d = (resp && resp.data) || {};
        Componentes.aviso({
          texto: d.message || (resp && resp.message) || 'Listo.',
          tipo: (resp && resp.ok && d.ok !== false) ? 'exito' : 'error'
        });
        if (resp && resp.ok && d.ok !== false) cargarIndicadores_();
      });
    }

    cont.querySelector('.js-ind-nuevo').addEventListener('click', function () {
      abrirFormularioIndicador_(null, data);
    });
    cont.querySelectorAll('.js-ind-editar').forEach(function (b) {
      b.addEventListener('click', function () { abrirFormularioIndicador_(delBoton_(b), data); });
    });
    cont.querySelectorAll('.js-ind-medir').forEach(function (b) {
      b.addEventListener('click', function () { abrirMedicionIndicador_(delBoton_(b), data.anio); });
    });
    cont.querySelectorAll('.js-ind-quitar').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = delBoton_(b);
        Componentes.confirmar({
          titulo: '¿Quitar ' + i.codigo + '?',
          mensaje: 'Sus mediciones se conservan como historial.',
          confirmar: 'Quitar', peligro: true
        }).then(function (ok) { if (ok) enviar_('anularIndicadorSgc', { indicador_id: i.indicador_id }); });
      });
    });
  }

  function textoMetaIndicador_(i) {
    var op = { MAYOR_IGUAL: '≥', MAYOR: '>', MENOR_IGUAL: '≤', MENOR: '<' }[i.meta_operador] || '';
    var sufijo = i.unidad === 'PORCENTAJE' ? '%' : '';
    return op + ' ' + i.meta_valor + sufijo +
      (i.tolerancia_valor !== null && i.tolerancia_valor !== undefined
        ? '  ·  tolerancia ' + op + ' ' + i.tolerancia_valor + sufijo : '');
  }

  function abrirMedicionIndicador_(i, anio) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Medir ' + Componentes.escaparHtml(i.codigo) + '</h3>' +
        '<p class="sigso-ayuda">' + Componentes.escaparHtml(i.formula) + '</p>' +
        '<p class="sigso-ayuda">Meta: ' + Componentes.escaparHtml(textoMetaIndicador_(i)) + '</p>' +
        '<form id="form-ind-medir">' +
          Componentes.campoTexto({ id: 'ind-periodo', label: 'Período', valor: '', requerido: true,
            ayuda: 'Formato ' + anio + '-M01 (mensual), ' + anio + '-T1, ' + anio + '-S1 o ' + anio + '.' }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'ind-numerador', label: 'Numerador', valor: '',
              ayuda: 'Opcional, pero deja el número auditable.' }) +
            Componentes.campoTexto({ id: 'ind-denominador', label: 'Denominador', valor: '' }) +
          '</div>' +
          Componentes.campoTexto({ id: 'ind-valor', label: 'O el valor directo', valor: '' }) +
          Componentes.campoTextarea({ id: 'ind-obs', label: 'Observaciones', valor: '' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Registrar medición', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-ind-medir').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true;
      api_('registrarLecturaIndicadorSgc', {
        indicador_id: i.indicador_id,
        periodo: document.getElementById('ind-periodo').value,
        numerador: document.getElementById('ind-numerador').value,
        denominador: document.getElementById('ind-denominador').value,
        valor: document.getElementById('ind-valor').value,
        observaciones: document.getElementById('ind-obs').value
      }).then(function (resp) {
        var d = (resp && resp.data) || {};
        if (!resp || !resp.ok || d.ok === false) {
          boton.disabled = false;
          Componentes.aviso({ texto: d.message || 'No se pudo registrar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: d.message || 'Medición registrada.', tipo: 'exito' });
        cargarIndicadores_();
      }).catch(function () {
        boton.disabled = false;
        Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
      });
    });
  }

  function abrirFormularioIndicador_(actual, data) {
    var i = actual || {};
    var cat = data.catalogos || {};
    var opsProceso = [{ valor: '', texto: 'Sin proceso asociado' }].concat(
      (data.procesos || []).map(function (p) {
        return { valor: p.proceso_id, texto: p.codigo + ' — ' + p.nombre };
      }));
    var opsObjetivo = [{ valor: '', texto: 'No alimenta ningún objetivo' }].concat(
      (data.objetivos || []).map(function (o) {
        return { valor: o.objetivo_id, texto: 'OBJ-' + o.numero + ' (' + o.anio + '): ' + String(o.nombre).slice(0, 50) };
      }));

    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">' +
          (actual ? 'Editar ' + Componentes.escaparHtml(i.codigo) : 'Definir indicador') + '</h3>' +
        '<form id="form-ind">' +
          Componentes.campoTexto({ id: 'ind-nombre', label: 'Nombre', valor: i.nombre || '', requerido: true }) +
          Componentes.campoTextarea({ id: 'ind-formula', label: 'Fórmula de cálculo',
            valor: i.formula || '', requerido: true,
            ayuda: 'Sin fórmula, dos personas pueden medir lo mismo de forma distinta.' }) +
          Componentes.campoTextarea({ id: 'ind-descripcion', label: 'Descripción', valor: i.descripcion || '' }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoSelect({ id: 'ind-proceso', label: 'Proceso que mide',
              valor: i.proceso_id || '', placeholder: false, opciones: opsProceso }) +
            Componentes.campoSelect({ id: 'ind-objetivo', label: 'Objetivo de calidad que alimenta',
              valor: i.objetivo_id || '', placeholder: false, opciones: opsObjetivo }) +
          '</div>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoSelect({ id: 'ind-operador', label: 'La meta se cumple si el valor es',
              valor: i.meta_operador || 'MAYOR_IGUAL', placeholder: false,
              opciones: (cat.operadores || []).map(function (o) { return { valor: o.clave, texto: o.etiqueta }; }) }) +
            Componentes.campoTexto({ id: 'ind-meta', label: 'Meta', valor: i.meta_valor === undefined ? '' : i.meta_valor, requerido: true }) +
          '</div>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'ind-tolerancia', label: 'Tolerancia (opcional)',
              valor: (i.tolerancia_valor === null || i.tolerancia_valor === undefined) ? '' : i.tolerancia_valor,
              ayuda: 'Umbral más laxo que la meta. Entre los dos, el indicador queda "en alerta" en vez de rojo.' }) +
            Componentes.campoSelect({ id: 'ind-unidad', label: 'Unidad',
              valor: i.unidad || 'PORCENTAJE', placeholder: false,
              opciones: (cat.unidades || []).map(function (u) { return { valor: u.clave, texto: u.etiqueta }; }) }) +
          '</div>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoSelect({ id: 'ind-frecuencia', label: 'Frecuencia de medición',
              valor: i.frecuencia || 'MENSUAL', placeholder: false,
              opciones: (cat.frecuencias || []).map(function (f) { return { valor: f.clave, texto: f.etiqueta }; }) }) +
            Componentes.campoTexto({ id: 'ind-responsable', label: 'Responsable (correo)', valor: i.responsable_email || '' }) +
          '</div>' +
          Componentes.campoTexto({ id: 'ind-fuente', label: 'Fuente del dato', valor: i.fuente || '',
            ayuda: 'De dónde sale el número: una planilla, el sistema, un informe.' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-ind').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true;
      api_('guardarIndicadorSgc', {
        indicador_id: i.indicador_id || '',
        nombre: document.getElementById('ind-nombre').value,
        formula: document.getElementById('ind-formula').value,
        descripcion: document.getElementById('ind-descripcion').value,
        proceso_id: document.getElementById('ind-proceso').value,
        objetivo_id: document.getElementById('ind-objetivo').value,
        meta_operador: document.getElementById('ind-operador').value,
        meta_valor: document.getElementById('ind-meta').value,
        tolerancia_valor: document.getElementById('ind-tolerancia').value,
        unidad: document.getElementById('ind-unidad').value,
        frecuencia: document.getElementById('ind-frecuencia').value,
        responsable_email: document.getElementById('ind-responsable').value,
        fuente: document.getElementById('ind-fuente').value
      }).then(function (resp) {
        var d = (resp && resp.data) || {};
        if (!resp || !resp.ok || d.ok === false) {
          boton.disabled = false;
          Componentes.aviso({ texto: d.message || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: d.message || 'Indicador guardado.', tipo: 'exito' });
        cargarIndicadores_();
      }).catch(function () {
        boton.disabled = false;
        Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
      });
    });
  }

  // ==========================================================================
  // v11.0 Fase 4 (§4.4): procesos del SGC.
  //
  // Dos niveles: el MAPA (los 14 del DOC-03, agrupados por tipo) y los
  // procesos de SERVICIO que cuelgan de cada uno. La ficha de un proceso
  // muestra sus pasos, sus subprocesos y sus riesgos, que es lo que un
  // diagrama en PDF no puede hacer.
  // ==========================================================================

  var procesoActivoId_ = null;

  function cargarProcesos_() {
    procesoActivoId_ = null;
    cargarListadoSgc_({
      clave: 'procesos', accion: 'listarProcesosSgc', datos: {},
      spinner: 'Cargando mapa de procesos...',
      sigo: function () { return seccionActiva_ === 'procesos' && !procesoActivoId_; },
      aplicar: function (cont, data) {
        cacheListadoSgc_.procesos = data;
        pintarProcesos_(cont, data);
      },
      error: function (cont, msg) {
        cont.innerHTML = barraSecciones_() +
          Componentes.alerta(msg || 'No se pudo conectar.', 'error');
        wireSecciones_(cont);
      }
    });
  }

  var TONO_TIPO_PROCESO = { ESTRATEGICO: 'info', OPERATIVO: 'ok', APOYO: 'neutro' };

  function pintarProcesos_(cont, data) {
    var puede = !!data.puede_gestionar;
    var r = data.resumen || {};

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Los procesos del SGC y cómo se relacionan (§4.4). El mapa define qué procesos hay; ' +
      'los procesos de servicio son el detalle operativo que cuelga de cada uno.</p>' +
      '</div>';

    // Basta con que falte el MAPA: si los servicios se cargaron por
    // planilla primero, igual hay que poder cargar el mapa del que cuelgan.
    if (!data.mapa.length) {
      cont.innerHTML = cabecera +
        Componentes.alerta('El mapa de procesos todavía no está cargado.', 'aviso') +
        (puede
          ? '<h4 class="sgc-sub">Propuesta tomada del DOC-03 v02</h4>' +
            '<p class="sigso-ayuda">Son los ' + ((data.propuesta || {}).mapa || 0) +
            ' procesos del mapa, repartidos en estratégicos, operativos y de apoyo. ' +
            'Los procesos de servicio (DOC-10 a DOC-13) se cargan aparte, por planilla.</p>' +
            '<div class="sgc-acciones">' +
              Componentes.boton({ texto: 'Cargar el mapa del DOC-03', clase: 'js-prc-sembrar' }) +
            '</div>'
          : '<p class="sigso-ayuda">El Encargado del SGC es quien lo carga.</p>');
      wireSecciones_(cont);
      var b = cont.querySelector('.js-prc-sembrar');
      if (b) b.addEventListener('click', function () {
        api_('sembrarMapaProcesosSgc', {}).then(function (resp) {
          var d = (resp && resp.data) || {};
          Componentes.aviso({ texto: d.message || 'Mapa cargado.', tipo: (resp && resp.ok && d.ok !== false) ? 'exito' : 'error' });
          if (resp && resp.ok && d.ok !== false) cargarProcesos_();
        });
      });
      return;
    }

    var avisoRevision = '';
    if (r.ultima_revision) {
      avisoRevision = Componentes.alerta(
        'Última revisión del mapa: ' + fechaCorta_(r.ultima_revision) +
        (r.meses_desde_revision !== null && r.meses_desde_revision !== undefined
          ? ' (hace ' + r.meses_desde_revision + ' meses)' : '') +
        '. La frecuencia definida es cada ' + data.meses_revision + ' meses.',
        r.revision_vencida ? 'error' : 'aviso');
    }

    var kpis = '<div class="sgc-kpis">' + [
      Componentes.kpi({ etiqueta: 'Procesos del mapa', valor: r.total_mapa || 0 }),
      Componentes.kpi({ etiqueta: 'De servicio', valor: r.total_servicios || 0 }),
      Componentes.kpi({ etiqueta: 'Pasos definidos', valor: r.total_pasos || 0 }),
      Componentes.kpi({ etiqueta: 'Sin responsable', valor: r.sin_responsable || 0,
        alerta: !!r.sin_responsable,
        titulo: '§4.4.2 e) pide asignar la responsabilidad y autoridad de cada proceso.' })
    ].join('') + '</div>';

    // El flujo del DOC-03: necesidades -> procesos -> satisfacción.
    var flujo = data.flujo || {};
    var bordes = '<div class="sgc-kpis">' +
      '<div class="sgc-doc"><div class="sgc-doc__linea"><span class="sgc-doc__codigo">' +
        Componentes.escaparHtml((flujo.entrada || {}).titulo || '') + '</span></div>' +
        '<span class="sgc-doc__nombre">' +
        Componentes.escaparHtml(((flujo.entrada || {}).items || []).join(' · ')) + '</span></div>' +
      '<div class="sgc-doc"><div class="sgc-doc__linea"><span class="sgc-doc__codigo">' +
        Componentes.escaparHtml((flujo.salida || {}).titulo || '') + '</span></div>' +
        '<span class="sgc-doc__nombre">' +
        Componentes.escaparHtml(((flujo.salida || {}).items || []).join(' · ')) + '</span></div>' +
      '</div>' +
      '<p class="sigso-ayuda">' + Componentes.escaparHtml(flujo.ciclo || '') + '</p>';

    var porTipo = ['ESTRATEGICO', 'OPERATIVO', 'APOYO'].map(function (tipo) {
      var delTipo = data.mapa.filter(function (p) { return p.tipo === tipo; });
      if (!delTipo.length) return '';
      var etiqueta = { ESTRATEGICO: 'Procesos estratégicos', OPERATIVO: 'Procesos operativos', APOYO: 'Procesos de apoyo' }[tipo];
      return '<h4 class="sgc-sub">' + etiqueta + ' (' + delTipo.length + ')</h4>' +
        '<div class="sgc-lista">' + delTipo.map(function (p) {
          var hijos = data.servicios.filter(function (s) { return s.proceso_padre_id === p.proceso_id; });
          return '<button type="button" class="sgc-doc js-prc-abrir" data-proceso-id="' +
            Componentes.escaparHtml(p.proceso_id) + '">' +
            '<div class="sgc-doc__linea">' +
              '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(p.codigo + ' — ' + p.nombre) + '</span>' +
              Componentes.badge(p.tipo_etiqueta, TONO_TIPO_PROCESO[p.tipo] || 'neutro') +
              (p.responsable_email ? '' : Componentes.badge('Sin responsable', 'alerta')) +
            '</div>' +
            (p.area ? '<span class="sgc-doc__meta">Área: ' + Componentes.escaparHtml(p.area) + '</span>' : '') +
            (p.actividades
              ? '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(String(p.actividades).split('\n').join(' · ')) + '</span>'
              : '') +
            (hijos.length
              ? '<span class="sgc-doc__meta">' + hijos.length + ' proceso(s) de servicio</span>'
              : '') +
          '</button>';
        }).join('') + '</div>';
    }).join('');

    var acciones = puede ? '<div class="sgc-acciones">' +
      Componentes.boton({ texto: 'Agregar proceso', variante: 'secundario', clase: 'js-prc-nuevo' }) +
      Componentes.boton({ texto: 'Registrar revisión del mapa', clase: 'js-prc-revisar' }) +
      '</div>' : '';

    var huerfanos = data.servicios.filter(function (s) {
      return !data.mapa.some(function (p) { return p.proceso_id === s.proceso_padre_id; });
    });
    var avisoHuerfanos = huerfanos.length
      ? Componentes.alerta(huerfanos.length + ' proceso(s) de servicio no cuelgan de ningún proceso del mapa. ' +
          'Revisa que la columna proceso_padre_id de la planilla use el código correcto (PO-03, PO-04...).', 'error')
      : '';

    cont.innerHTML = cabecera + avisoRevision + kpis + bordes + avisoHuerfanos + porTipo + acciones;
    wireSecciones_(cont);

    cont.querySelectorAll('.js-prc-abrir').forEach(function (btn) {
      btn.addEventListener('click', function () {
        procesoActivoId_ = btn.getAttribute('data-proceso-id');
        abrirProceso_(procesoActivoId_);
      });
    });
    if (!puede) return;

    cont.querySelector('.js-prc-nuevo').addEventListener('click', function () {
      abrirFormularioProceso_(null, data);
    });
    cont.querySelector('.js-prc-revisar').addEventListener('click', function () {
      Componentes.confirmar({
        titulo: '¿Registrar la revisión del mapa?',
        mensaje: 'Deja constancia de que hoy se revisaron los procesos, aunque no cambie nada.',
        confirmar: 'Registrar'
      }).then(function (ok) {
        if (!ok) return;
        api_('registrarRevisionProcesosSgc', {}).then(function (resp) {
          var d = (resp && resp.data) || {};
          Componentes.aviso({ texto: d.message || 'Revisión registrada.', tipo: (resp && resp.ok) ? 'exito' : 'error' });
          if (resp && resp.ok) cargarProcesos_();
        });
      });
    });
  }

  function abrirProceso_(procesoId) {
    var cont = panelSgc_();
    cont.innerHTML = Componentes.cargando('Cargando proceso...');
    api_('getDetalleProcesoSgc', { proceso_id: procesoId }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        procesoActivoId_ = null;
        cargarProcesos_();
        return;
      }
      pintarFichaProceso_(cont, respuesta.data);
    });
  }

  function pintarFichaProceso_(cont, data) {
    var p = data.proceso;
    var puede = !!data.puede_gestionar;

    var ficha = '<dl class="sgc-ficha">' + [
      campoFichaSgc_('Código', p.codigo),
      campoFichaSgc_('Tipo', p.tipo_etiqueta),
      campoFichaSgc_('Nivel', p.nivel === 'SERVICIO' ? 'Proceso de servicio' : 'Proceso del mapa'),
      campoFichaSgc_('Área', p.area),
      campoFichaSgc_('Responsable', p.responsable_email),
      campoFichaSgc_('Última revisión', p.fecha_ultima_revision ? fechaCorta_(p.fecha_ultima_revision) : '')
    ].join('') + '</dl>';

    var bloques = [
      ['Objetivo', p.objetivo], ['Alcance', p.alcance],
      ['Entradas', p.entradas], ['Actividades', p.actividades], ['Salidas', p.salidas],
      ['Clientes', p.clientes], ['Proveedores', p.proveedores], ['Recursos', p.recursos],
      ['Documentos', p.documentos]
    ].filter(function (b) { return String(b[1] || '').trim(); })
      .map(function (b) {
        return '<h4 class="sgc-sub">' + b[0] + '</h4><p>' +
          Componentes.escaparHtml(String(b[1]).split('\n').join(' · ')) + '</p>';
      }).join('');

    var pasos = '';
    if (data.pasos.length) {
      pasos = '<h4 class="sgc-sub">Pasos (' + data.pasos.length + ')</h4>' +
        '<div class="sgc-etapas">' + data.pasos.map(function (x) {
          return '<div class="sgc-etapa">' +
            '<div class="sgc-etapa__num">' + x.numero + '</div>' +
            '<div class="sgc-etapa__cuerpo">' +
              '<strong>' + Componentes.escaparHtml(x.nombre || ('Paso ' + x.numero)) + '</strong>' +
              '<dl class="sgc-ficha">' + [
                campoFichaSgc_('Responsable', x.responsable),
                campoFichaSgc_('Input', x.input),
                campoFichaSgc_('Actividades', x.actividades),
                campoFichaSgc_('Evidencias', x.evidencias),
                campoFichaSgc_('Output', x.output)
              ].join('') + '</dl>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>';
    }

    var subprocesos = '';
    if (data.subprocesos.length) {
      subprocesos = '<h4 class="sgc-sub">Procesos de servicio (' + data.subprocesos.length + ')</h4>' +
        '<div class="sgc-lista">' + data.subprocesos.map(function (s) {
          return '<button type="button" class="sgc-doc js-prc-abrir" data-proceso-id="' +
            Componentes.escaparHtml(s.proceso_id) + '">' +
            '<div class="sgc-doc__linea"><span class="sgc-doc__codigo">' +
            Componentes.escaparHtml(s.codigo + ' — ' + s.nombre) + '</span></div>' +
          '</button>';
        }).join('') + '</div>';
    }

    var riesgos = '';
    if (data.riesgos.length) {
      riesgos = '<h4 class="sgc-sub">Riesgos y oportunidades de este proceso (' + data.riesgos.length + ')</h4>' +
        '<div class="sgc-lista">' + data.riesgos.map(function (x) {
          return '<div class="sgc-doc"><div class="sgc-doc__linea">' +
            '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(x.codigo + ' — ' + x.factor) + '</span>' +
            Componentes.badge(x.banda + ' · ' + x.magnitud,
              x.clase === 'OPORTUNIDAD' ? 'ok' : (x.banda === 'Crítico' ? 'critico' : 'alerta')) +
            '</div></div>';
        }).join('') + '</div>';
    }

    cont.innerHTML = barraSecciones_() +
      '<div class="sgc-detalle-cab">' +
        Componentes.boton({ texto: '← Volver al mapa', variante: 'sutil', clase: 'js-prc-volver' }) +
        '<h3>' + Componentes.escaparHtml(p.nombre) + '</h3>' +
      '</div>' +
      ficha + bloques + subprocesos + pasos + riesgos +
      (puede ? '<div class="sgc-acciones">' +
        Componentes.boton({ texto: 'Editar proceso', variante: 'secundario', clase: 'js-prc-editar' }) +
        '</div>' : '');

    wireSecciones_(cont);
    cont.querySelector('.js-prc-volver').addEventListener('click', cargarProcesos_);
    cont.querySelectorAll('.js-prc-abrir').forEach(function (btn) {
      btn.addEventListener('click', function () {
        procesoActivoId_ = btn.getAttribute('data-proceso-id');
        abrirProceso_(procesoActivoId_);
      });
    });
    if (!puede) return;
    cont.querySelector('.js-prc-editar').addEventListener('click', function () {
      api_('listarProcesosSgc', {}).then(function (resp) {
        abrirFormularioProceso_(p, (resp && resp.data) || { mapa: [] });
      });
    });
  }

  function abrirFormularioProceso_(actual, data) {
    var p = actual || {};
    var opsPadre = [{ valor: '', texto: 'Ninguno (proceso del mapa)' }].concat(
      (data.mapa || []).filter(function (m) { return m.proceso_id !== p.proceso_id; })
        .map(function (m) { return { valor: m.proceso_id, texto: m.codigo + ' — ' + m.nombre }; }));

    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">' +
          (actual ? 'Editar ' + Componentes.escaparHtml(p.codigo) : 'Agregar proceso') + '</h3>' +
        '<form id="form-prc">' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'prc-nombre', label: 'Nombre', valor: p.nombre || '', requerido: true }) +
            Componentes.campoTexto({ id: 'prc-codigo', label: 'Código', valor: p.codigo || '',
              ayuda: 'Si lo dejas vacío, el sistema lo asigna.' }) +
          '</div>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoSelect({ id: 'prc-tipo', label: 'Tipo', valor: p.tipo || 'OPERATIVO',
              placeholder: false, requerido: true,
              opciones: [{ valor: 'ESTRATEGICO', texto: 'Estratégico' }, { valor: 'OPERATIVO', texto: 'Operativo' }, { valor: 'APOYO', texto: 'Apoyo' }] }) +
            Componentes.campoSelect({ id: 'prc-nivel', label: 'Nivel', valor: p.nivel || 'MAPA',
              placeholder: false,
              opciones: [{ valor: 'MAPA', texto: 'Proceso del mapa' }, { valor: 'SERVICIO', texto: 'Proceso de servicio' }] }) +
          '</div>' +
          Componentes.campoSelect({ id: 'prc-padre', label: 'Cuelga de', valor: p.proceso_padre_id || '',
            placeholder: false, opciones: opsPadre,
            ayuda: 'Obligatorio para un proceso de servicio; vacío para uno del mapa.' }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'prc-area', label: 'Área', valor: p.area || '' }) +
            Componentes.campoTexto({ id: 'prc-responsable', label: 'Responsable (correo)',
              valor: p.responsable_email || '',
              ayuda: '§4.4.2 e) pide asignar responsabilidad y autoridad.' }) +
          '</div>' +
          Componentes.campoTextarea({ id: 'prc-objetivo', label: 'Objetivo', valor: p.objetivo || '' }) +
          Componentes.campoTextarea({ id: 'prc-alcance', label: 'Alcance', valor: p.alcance || '' }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTextarea({ id: 'prc-entradas', label: 'Entradas', valor: p.entradas || '' }) +
            Componentes.campoTextarea({ id: 'prc-salidas', label: 'Salidas', valor: p.salidas || '' }) +
          '</div>' +
          Componentes.campoTextarea({ id: 'prc-actividades', label: 'Actividades', valor: p.actividades || '' }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'prc-clientes', label: 'Clientes', valor: p.clientes || '' }) +
            Componentes.campoTexto({ id: 'prc-proveedores', label: 'Proveedores', valor: p.proveedores || '' }) +
          '</div>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'prc-recursos', label: 'Recursos', valor: p.recursos || '' }) +
            Componentes.campoTexto({ id: 'prc-documentos', label: 'Documentos', valor: p.documentos || '' }) +
          '</div>' +
          Componentes.campoTextarea({ id: 'prc-observaciones', label: 'Observaciones', valor: p.observaciones || '' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-prc').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true;
      api_('guardarProcesoSgc', {
        proceso_id: p.proceso_id || '',
        nombre: document.getElementById('prc-nombre').value,
        codigo: document.getElementById('prc-codigo').value,
        tipo: document.getElementById('prc-tipo').value,
        nivel: document.getElementById('prc-nivel').value,
        proceso_padre_id: document.getElementById('prc-padre').value,
        area: document.getElementById('prc-area').value,
        responsable_email: document.getElementById('prc-responsable').value,
        objetivo: document.getElementById('prc-objetivo').value,
        alcance: document.getElementById('prc-alcance').value,
        entradas: document.getElementById('prc-entradas').value,
        salidas: document.getElementById('prc-salidas').value,
        actividades: document.getElementById('prc-actividades').value,
        clientes: document.getElementById('prc-clientes').value,
        proveedores: document.getElementById('prc-proveedores').value,
        recursos: document.getElementById('prc-recursos').value,
        documentos: document.getElementById('prc-documentos').value,
        observaciones: document.getElementById('prc-observaciones').value
      }).then(function (resp) {
        var d = (resp && resp.data) || {};
        if (!resp || !resp.ok || d.ok === false) {
          boton.disabled = false;
          Componentes.aviso({ texto: d.message || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: d.message || 'Proceso guardado.', tipo: 'exito' });
        if (procesoActivoId_) abrirProceso_(procesoActivoId_); else cargarProcesos_();
      }).catch(function () {
        boton.disabled = false;
        Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
      });
    });
  }

  // ==========================================================================
  // v11.0 Fase 3 (§6.1): riesgos y oportunidades.
  //
  // Lo que esta pantalla hace y un Excel no: calcula la magnitud y su banda
  // desde probabilidad x impacto, asi que la etiqueta no puede contradecir
  // al numero. En el DOC-08 original 7 de las 32 valoraciones no coinciden
  // con su propia tabla de criterios.
  //
  // Y trata las oportunidades al reves a proposito: ahi una magnitud alta es
  // BUENA y la revaloracion deberia subir.
  // ==========================================================================

  var vistaRiesgos_ = 'riesgos';

  function cargarRiesgos_() {
    var cont = panelSgc_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando matriz de riesgos...');
    api_('listarRiesgosSgc', {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = barraSecciones_() +
          Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar la matriz.', 'error');
        wireSecciones_(cont);
        return;
      }
      pintarRiesgos_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = barraSecciones_() + Componentes.alerta('No se pudo conectar.', 'error');
      wireSecciones_(cont);
    });
  }

  function pintarRiesgos_(cont, data) {
    var puede = !!data.puede_gestionar;
    var r = data.resumen || {};

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Riesgos y oportunidades del SGC (§6.1). La magnitud y su nivel los calcula el sistema ' +
      'desde probabilidad × impacto, así que la etiqueta nunca puede contradecir al número.</p>' +
      '</div>';

    if (!data.riesgos.length && !data.oportunidades.length) {
      cont.innerHTML = cabecera + pintarSinRiesgos_(data, puede);
      wireSecciones_(cont);
      var b = cont.querySelector('.js-rsg-sembrar');
      if (b) b.addEventListener('click', function () {
        api_('sembrarRiesgosSgc', {}).then(function (resp) {
          var d = (resp && resp.data) || {};
          Componentes.aviso({ texto: d.message || 'Matriz cargada.', tipo: (resp && resp.ok && d.ok !== false) ? 'exito' : 'error' });
          if (resp && resp.ok && d.ok !== false) cargarRiesgos_();
        });
      });
      return;
    }

    var subnav = '<div class="sgc-subnav-accesos">' +
      [{ id: 'riesgos', texto: 'Riesgos (' + data.riesgos.length + ')' },
       { id: 'oportunidades', texto: 'Oportunidades (' + data.oportunidades.length + ')' }]
        .map(function (v) {
          return '<button type="button" class="sigso-tab js-rsg-vista' +
            (v.id === vistaRiesgos_ ? ' sigso-tab--activo' : '') + '" data-vista="' + v.id + '">' +
            v.texto + '</button>';
        }).join('') + '</div>';

    var avisoRevision = '';
    if (r.ultima_revision) {
      avisoRevision = Componentes.alerta(
        'Última revisión de la matriz: ' + fechaCorta_(r.ultima_revision) +
        (r.meses_desde_revision !== null && r.meses_desde_revision !== undefined
          ? ' (hace ' + r.meses_desde_revision + ' meses)' : '') +
        '. La frecuencia definida es cada ' + data.meses_revision + ' meses.',
        r.revision_vencida ? 'error' : 'aviso');
    }

    var kpis = '<div class="sgc-kpis">' + [
      Componentes.kpi({ etiqueta: 'Riesgos', valor: r.total_riesgos || 0 }),
      Componentes.kpi({ etiqueta: 'Altos o críticos', valor: r.criticos_o_altos || 0,
        alerta: !!r.criticos_o_altos,
        titulo: 'Riesgos cuya valoración inherente cae en Alto o Crítico.' }),
      Componentes.kpi({ etiqueta: 'Sin revalorar', valor: r.sin_tratar || 0,
        alerta: !!r.sin_tratar,
        titulo: 'Altos o críticos sin valoración residual: una acción escrita sin revalorar no demuestra que el riesgo se abordó.' }),
      Componentes.kpi({ etiqueta: 'Con actividad', valor: r.con_actividad || 0,
        titulo: 'Acciones asignadas a un responsable como actividad de "Mi trabajo".' }),
      Componentes.kpi({ etiqueta: 'Oportunidades', valor: r.total_oportunidades || 0 })
    ].join('') + '</div>';

    var lista = vistaRiesgos_ === 'oportunidades' ? data.oportunidades : data.riesgos;
    var nota = vistaRiesgos_ === 'oportunidades'
      ? '<p class="sigso-ayuda">En una oportunidad, una magnitud <strong>alta es buena</strong>: la revaloración ' +
        'debería subir tras las acciones, no bajar. El sistema lee el semáforo al revés en esta pestaña.</p>'
      : '';

    var filas = '<div class="sgc-lista">' + lista.map(function (x) { return tarjetaRiesgo_(x, puede); }).join('') + '</div>';

    var acciones = puede ? '<div class="sgc-acciones">' +
      Componentes.boton({ texto: 'Agregar registro', variante: 'secundario', clase: 'js-rsg-nuevo' }) +
      Componentes.boton({ texto: 'Registrar revisión de la matriz', clase: 'js-rsg-revisar' }) +
      '</div>' : '';

    cont.innerHTML = cabecera + subnav + avisoRevision + kpis + nota + filas + acciones;
    wireSecciones_(cont);

    cont.querySelectorAll('.js-rsg-vista').forEach(function (btn) {
      btn.addEventListener('click', function () {
        vistaRiesgos_ = btn.getAttribute('data-vista');
        cargarRiesgos_();
      });
    });
    if (puede) wireAccionesRiesgos_(cont, data);
  }

  function pintarSinRiesgos_(data, puede) {
    var p = data.propuesta || {};
    return Componentes.alerta('La matriz de riesgos y oportunidades todavía no está cargada.', 'aviso') +
      (puede
        ? '<h4 class="sgc-sub">Propuesta tomada del DOC-08 v02</h4>' +
          '<p class="sigso-ayuda">Son ' + (p.riesgos || 0) + ' riesgos y ' + (p.oportunidades || 0) +
          ' oportunidades transcritos del documento. Se cargan solo la probabilidad y el impacto: ' +
          'la magnitud y el nivel los calcula el sistema, y por eso se corrigen solas las siete ' +
          'valoraciones que en el documento no coinciden con su propia tabla de criterios.</p>' +
          '<p class="sigso-ayuda">Si ya cargaste el análisis de contexto, cada riesgo queda enlazado ' +
          'al factor del FODA que lo origina.</p>' +
          '<div class="sgc-acciones">' +
            Componentes.boton({ texto: 'Cargar la matriz del DOC-08', clase: 'js-rsg-sembrar' }) +
          '</div>'
        : '<p class="sigso-ayuda">El Encargado del SGC es quien la carga.</p>');
  }

  function valoracionHtml_(v, tono, etiqueta) {
    if (!v) return '<span class="sgc-doc__meta">' + etiqueta + ': sin valorar</span>';
    return '<span class="sgc-doc__meta">' + etiqueta + ': ' +
      Componentes.badge(v.banda + ' · ' + v.magnitud, tono) + '</span>';
  }

  function tarjetaRiesgo_(x, puede) {
    var flecha = '';
    if (x.inherente && x.residual) {
      flecha = x.mejora
        ? Componentes.badge(x.favorable ? 'Mejora' : 'Reduce', 'ok')
        : Componentes.badge('Sin cambio', 'neutro');
    }
    return '<div class="sgc-doc" data-riesgo-id="' + Componentes.escaparHtml(x.riesgo_id) + '">' +
      '<div class="sgc-doc__linea">' +
        '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(x.codigo + ' — ' + x.factor) + '</span>' +
        Componentes.badge(x.origen === 'EXTERNO' ? 'Externo' : 'Interno', 'neutro') +
        flecha +
      '</div>' +
      '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(x.descripcion) + '</span>' +
      '<div class="sgc-doc__linea">' +
        valoracionHtml_(x.inherente, x.tono_inherente, 'Inherente') +
        valoracionHtml_(x.residual, x.tono_residual, 'Tras controles') +
      '</div>' +
      (x.factor_contexto
        ? '<span class="sgc-doc__meta">Factor de contexto: ' + Componentes.escaparHtml(x.factor_contexto) + '</span>'
        : '') +
      (x.accion ? '<span class="sgc-doc__meta">Acción: ' + Componentes.escaparHtml(x.accion) + '</span>' : '') +
      (x.tarea
        ? '<span class="sgc-doc__meta">Actividad asignada a ' + Componentes.escaparHtml(x.tarea.responsable_email) +
          ' — ' + Componentes.escaparHtml(x.tarea.estado) + '</span>'
        : '') +
      (puede ? '<div class="sgc-acciones">' +
        Componentes.boton({ texto: 'Editar', variante: 'sutil', clase: 'js-rsg-editar' }) +
        (x.accion_actividad_id ? ''
          : Componentes.boton({ texto: 'Asignar acción', variante: 'secundario', clase: 'js-rsg-asignar' })) +
        Componentes.boton({ texto: 'Quitar', variante: 'peligro', clase: 'js-rsg-quitar' }) +
      '</div>' : '') +
    '</div>';
  }

  function wireAccionesRiesgos_(cont, data) {
    function enviar_(accion, datos) {
      api_(accion, datos).then(function (resp) {
        var d = (resp && resp.data) || {};
        Componentes.aviso({
          texto: d.message || (resp && resp.message) || 'Listo.',
          tipo: (resp && resp.ok && d.ok !== false) ? 'exito' : 'error'
        });
        if (resp && resp.ok && d.ok !== false) cargarRiesgos_();
      });
    }
    function delBoton_(btn) {
      var id = btn.parentNode.parentNode.getAttribute('data-riesgo-id');
      return [].concat(data.riesgos, data.oportunidades).filter(function (x) {
        return x.riesgo_id === id;
      })[0];
    }

    var nuevo = cont.querySelector('.js-rsg-nuevo');
    if (nuevo) nuevo.addEventListener('click', function () { abrirFormularioRiesgo_(null, data); });

    cont.querySelectorAll('.js-rsg-editar').forEach(function (btn) {
      btn.addEventListener('click', function () { abrirFormularioRiesgo_(delBoton_(btn), data); });
    });

    cont.querySelectorAll('.js-rsg-asignar').forEach(function (btn) {
      btn.addEventListener('click', function () { abrirAsignarAccion_(delBoton_(btn)); });
    });

    cont.querySelectorAll('.js-rsg-quitar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var x = delBoton_(btn);
        Componentes.confirmar({
          titulo: '¿Quitar ' + x.codigo + ' de la matriz?',
          mensaje: 'Deja de contar en la evaluación de 6.1. La actividad asignada, si la hay, no se toca.',
          confirmar: 'Quitar', peligro: true
        }).then(function (ok) { if (ok) enviar_('anularRiesgoSgc', { riesgo_id: x.riesgo_id }); });
      });
    });

    cont.querySelectorAll('.js-rsg-revisar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Componentes.confirmar({
          titulo: '¿Registrar la revisión de la matriz?',
          mensaje: 'Deja constancia de que hoy se revisaron los riesgos y oportunidades, aunque no cambie nada.',
          confirmar: 'Registrar'
        }).then(function (ok) { if (ok) enviar_('registrarRevisionRiesgosSgc', {}); });
      });
    });
  }

  function abrirAsignarAccion_(x) {
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Asignar la acción de ' + Componentes.escaparHtml(x.codigo) + '</h3>' +
        '<p class="sigso-ayuda">' + Componentes.escaparHtml(x.accion) + '</p>' +
        '<p class="sigso-ayuda">Se crea una actividad en "Mi trabajo" del responsable, igual que las ' +
        'correcciones de una no conformidad. No hay un flujo aparte que aprender.</p>' +
        '<form id="form-rsg-asignar">' +
          Componentes.campoTexto({ id: 'rsg-responsable', label: 'Responsable (correo)',
            valor: x.responsable_email || '', requerido: true }) +
          Componentes.campoTexto({ id: 'rsg-fecha', label: 'Fecha comprometida', tipo: 'date',
            valor: '', requerido: true,
            ayuda: x.fecha_implementacion ? 'El DOC-08 dice: ' + x.fecha_implementacion : '' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Crear actividad', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-rsg-asignar').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true;
      api_('asignarAccionRiesgoSgc', {
        riesgo_id: x.riesgo_id,
        responsable_email: document.getElementById('rsg-responsable').value,
        fecha_compromiso: document.getElementById('rsg-fecha').value
      }).then(function (resp) {
        var d = (resp && resp.data) || {};
        if (!resp || !resp.ok || d.ok === false) {
          boton.disabled = false;
          Componentes.aviso({ texto: d.message || 'No se pudo asignar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: d.message || 'Acción asignada.', tipo: 'exito' });
        cargarRiesgos_();
      }).catch(function () {
        boton.disabled = false;
        Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
      });
    });
  }

  function abrirFormularioRiesgo_(actual, data) {
    var x = actual || {};
    var esNuevo = !actual;
    var opsProb = (data.escala_probabilidad || []).map(function (p) {
      return { valor: p.valor, texto: p.etiqueta + ' (' + p.valor + ')' };
    });
    var opsImp = (data.escala_impacto || []).map(function (i) {
      return { valor: i.valor, texto: i.etiqueta + ' (' + i.valor + ')' };
    });
    var opsFactor = [{ valor: '', texto: 'Sin enlazar' }].concat(
      (data.factores_contexto || []).map(function (f) {
        return { valor: f.factor_id, texto: f.codigo + ' — ' + String(f.descripcion).slice(0, 60) };
      }));

    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">' +
          (esNuevo ? 'Agregar riesgo u oportunidad' : 'Editar ' + Componentes.escaparHtml(x.codigo)) + '</h3>' +
        '<form id="form-rsg">' +
          '<div class="sgc-form-fila">' +
            Componentes.campoSelect({ id: 'rsg-clase', label: 'Tipo', valor: x.clase || 'RIESGO',
              placeholder: false, requerido: true,
              opciones: [{ valor: 'RIESGO', texto: 'Riesgo' }, { valor: 'OPORTUNIDAD', texto: 'Oportunidad (alto = bueno)' }] }) +
            Componentes.campoSelect({ id: 'rsg-origen', label: 'Origen', valor: x.origen || 'INTERNO',
              placeholder: false,
              opciones: [{ valor: 'INTERNO', texto: 'Interno' }, { valor: 'EXTERNO', texto: 'Externo' }] }) +
          '</div>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'rsg-relacion', label: 'Relación / actividad',
              valor: x.relacion_actividad || '', ayuda: 'El proceso o área donde ocurre.' }) +
            Componentes.campoTexto({ id: 'rsg-factor', label: 'Factor', valor: x.factor || '',
              requerido: true, ayuda: 'Título corto con el que se identifica.' }) +
          '</div>' +
          Componentes.campoTextarea({ id: 'rsg-descripcion', label: 'Descripción',
            valor: x.descripcion || '', requerido: true }) +
          Componentes.campoTextarea({ id: 'rsg-causa', label: 'Análisis de causa', valor: x.analisis_causa || '' }) +
          Componentes.campoTextarea({ id: 'rsg-procedencia', label: 'Procedencia', valor: x.procedencia || '' }) +
          Componentes.campoSelect({ id: 'rsg-factor-ctx', label: 'Factor del contexto que lo origina',
            valor: x.factor_contexto_id || '', placeholder: false, opciones: opsFactor,
            ayuda: 'Enlaza con el análisis FODA. Deja "sin enlazar" si no corresponde.' }) +
          '<h4 class="sgc-sub">Valoración inherente</h4>' +
          '<p class="sigso-ayuda">La magnitud y el nivel se calculan solos: probabilidad × impacto.</p>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoSelect({ id: 'rsg-prob', label: 'Probabilidad',
              valor: x.probabilidad || 0.5, placeholder: false, requerido: true, opciones: opsProb }) +
            Componentes.campoSelect({ id: 'rsg-imp', label: 'Impacto',
              valor: x.impacto || 10, placeholder: false, requerido: true, opciones: opsImp }) +
          '</div>' +
          '<h4 class="sgc-sub">Tratamiento</h4>' +
          Componentes.campoTextarea({ id: 'rsg-accion', label: 'Acción', valor: x.accion || '' }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'rsg-fecha-impl', label: 'Fecha de implementación',
              valor: x.fecha_implementacion || '',
              ayuda: 'Texto libre: el DOC-08 usa "Agosto 2026", "Continuo", "Post-certificación".' }) +
            Componentes.campoTextarea({ id: 'rsg-control', label: 'Medidas de control', valor: x.medidas_control || '' }) +
          '</div>' +
          '<h4 class="sgc-sub">Revaloración tras los controles</h4>' +
          '<p class="sigso-ayuda">Opcional mientras el riesgo no se haya tratado. Si la completas, ' +
          'tienen que ir las dos: con una sola no se puede calcular la magnitud.</p>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoSelect({ id: 'rsg-prob-res', label: 'Probabilidad residual',
              valor: x.probabilidad_residual || '', opciones: opsProb, placeholder: 'Sin revalorar' }) +
            Componentes.campoSelect({ id: 'rsg-imp-res', label: 'Impacto residual',
              valor: x.impacto_residual || '', opciones: opsImp, placeholder: 'Sin revalorar' }) +
          '</div>' +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-rsg').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true;
      api_('guardarRiesgoSgc', {
        riesgo_id: x.riesgo_id || '',
        clase: document.getElementById('rsg-clase').value,
        origen: document.getElementById('rsg-origen').value,
        relacion_actividad: document.getElementById('rsg-relacion').value,
        factor: document.getElementById('rsg-factor').value,
        descripcion: document.getElementById('rsg-descripcion').value,
        analisis_causa: document.getElementById('rsg-causa').value,
        procedencia: document.getElementById('rsg-procedencia').value,
        factor_contexto_id: document.getElementById('rsg-factor-ctx').value,
        probabilidad: document.getElementById('rsg-prob').value,
        impacto: document.getElementById('rsg-imp').value,
        accion: document.getElementById('rsg-accion').value,
        fecha_implementacion: document.getElementById('rsg-fecha-impl').value,
        medidas_control: document.getElementById('rsg-control').value,
        probabilidad_residual: document.getElementById('rsg-prob-res').value,
        impacto_residual: document.getElementById('rsg-imp-res').value
      }).then(function (resp) {
        var d = (resp && resp.data) || {};
        if (!resp || !resp.ok || d.ok === false) {
          boton.disabled = false;
          Componentes.aviso({ texto: d.message || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: d.message || 'Registro guardado.', tipo: 'exito' });
        cargarRiesgos_();
      }).catch(function () {
        boton.disabled = false;
        Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
      });
    });
  }

  // ==========================================================================
  // v11.0 Fase 2 (§4.1 y §4.2): contexto de la organizacion y partes
  // interesadas. Una sola seccion con dos vistas, para no sumar dos pestañas
  // planas a una barra que ya tiene once.
  // ==========================================================================

  var vistaContexto_ = 'foda';

  function cargarContexto_() {
    var cont = panelSgc_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando contexto de la organización...');
    api_('obtenerContextoSgc', {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = barraSecciones_() +
          Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar el contexto.', 'error');
        wireSecciones_(cont);
        return;
      }
      pintarContexto_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = barraSecciones_() + Componentes.alerta('No se pudo conectar.', 'error');
      wireSecciones_(cont);
    });
  }

  var TONO_FACTOR_SGC = {
    FORTALEZA: 'ok', OPORTUNIDAD: 'info', DEBILIDAD: 'alerta', AMENAZA: 'critico'
  };
  var ETIQUETA_FACTOR_SGC = {
    FORTALEZA: 'Fortaleza', OPORTUNIDAD: 'Oportunidad',
    DEBILIDAD: 'Debilidad', AMENAZA: 'Amenaza'
  };
  // El plural va explícito: sufijar una 's' produce "debilidads".
  var ETIQUETA_FACTOR_PLURAL_SGC = {
    FORTALEZA: 'Fortalezas', OPORTUNIDAD: 'Oportunidades',
    DEBILIDAD: 'Debilidades', AMENAZA: 'Amenazas'
  };

  function pintarContexto_(cont, data) {
    var puede = !!data.puede_gestionar;
    var r = data.resumen || {};

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">El entorno en que opera la organización (§4.1) y quiénes esperan algo de ella (§4.2). ' +
      'La norma no pide solo listarlos: pide revisarlos periódicamente, y aquí se lleva esa cuenta.</p>' +
      '</div>';

    var subnav = '<div class="sgc-subnav-accesos">' +
      [{ id: 'foda', texto: 'Análisis de contexto' }, { id: 'partes', texto: 'Partes interesadas' }]
        .map(function (v) {
          return '<button type="button" class="sigso-tab js-ctx-vista' +
            (v.id === vistaContexto_ ? ' sigso-tab--activo' : '') + '" data-vista="' + v.id + '">' +
            v.texto + '</button>';
        }).join('') + '</div>';

    // El aviso de revisión encabeza las dos vistas: es lo que la norma
    // pregunta y lo único que no se ve mirando la tabla.
    var avisoRevision = '';
    if (r.ultima_revision) {
      var texto = 'Última revisión del contexto: ' + fechaCorta_(r.ultima_revision) +
        (r.meses_desde_revision !== null && r.meses_desde_revision !== undefined
          ? ' (hace ' + r.meses_desde_revision + ' meses)' : '') + '. ' +
        'La frecuencia definida es cada ' + data.meses_revision + ' meses.';
      avisoRevision = Componentes.alerta(texto, r.revision_vencida ? 'error' : 'aviso');
    }

    var cuerpo = vistaContexto_ === 'partes'
      ? vistaPartes_(data, puede)
      : vistaFoda_(data, puede, r);

    cont.innerHTML = cabecera + subnav + avisoRevision + cuerpo;
    wireSecciones_(cont);

    cont.querySelectorAll('.js-ctx-vista').forEach(function (btn) {
      btn.addEventListener('click', function () {
        vistaContexto_ = btn.getAttribute('data-vista');
        cargarContexto_();
      });
    });

    if (!puede) return;
    wireAccionesContexto_(cont, data);
  }

  function vistaFoda_(data, puede, r) {
    if (!data.factores.length) {
      var p = data.propuesta_foda || [];
      var conteo = {};
      p.forEach(function (f) { conteo[f.tipo] = (conteo[f.tipo] || 0) + 1; });
      return Componentes.alerta('El análisis de contexto todavía no está cargado en el sistema.', 'aviso') +
        (puede
          ? '<h4 class="sgc-sub">Propuesta tomada del DOC-02 (Análisis FODA)</h4>' +
            '<p class="sigso-ayuda">Son los ' + p.length + ' factores transcritos del documento aprobado: ' +
            Object.keys(conteo).map(function (t) {
              var etiqueta = conteo[t] > 1 ? ETIQUETA_FACTOR_PLURAL_SGC[t] : ETIQUETA_FACTOR_SGC[t];
              return conteo[t] + ' ' + String(etiqueta || t).toLowerCase();
            }).join(', ') + '. Revísalos antes de cargarlos; después los puedes editar uno a uno.</p>' +
            '<div class="sgc-lista">' + p.slice(0, 4).map(function (f) {
              return '<div class="sgc-doc">' +
                '<div class="sgc-doc__linea">' +
                  '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(String(f.tipo).slice(0, 1) + f.numero) + '</span>' +
                  Componentes.badge(ETIQUETA_FACTOR_SGC[f.tipo] || f.tipo, TONO_FACTOR_SGC[f.tipo] || 'neutro') +
                '</div>' +
                '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(f.descripcion) + '</span>' +
              '</div>';
            }).join('') + '</div>' +
            '<p class="sigso-ayuda">…y ' + (p.length - 4) + ' más.</p>' +
            '<div class="sgc-acciones">' +
              Componentes.boton({ texto: 'Cargar los ' + p.length + ' factores del DOC-02', clase: 'js-ctx-sembrar-foda' }) +
            '</div>'
          : '<p class="sigso-ayuda">El Encargado del SGC es quien lo carga.</p>');
    }

    var kpis = '<div class="sgc-kpis">' + [
      Componentes.kpi({ etiqueta: 'Fortalezas', valor: (r.por_tipo || {}).FORTALEZA || 0 }),
      Componentes.kpi({ etiqueta: 'Oportunidades', valor: (r.por_tipo || {}).OPORTUNIDAD || 0 }),
      Componentes.kpi({ etiqueta: 'Debilidades', valor: (r.por_tipo || {}).DEBILIDAD || 0 }),
      Componentes.kpi({ etiqueta: 'Amenazas', valor: (r.por_tipo || {}).AMENAZA || 0 })
    ].join('') + '</div>';

    var grupos = ['FORTALEZA', 'DEBILIDAD', 'OPORTUNIDAD', 'AMENAZA'].map(function (tipo) {
      var delTipo = data.factores.filter(function (f) { return f.tipo === tipo; });
      if (!delTipo.length) return '';
      return '<h4 class="sgc-sub">' + ETIQUETA_FACTOR_PLURAL_SGC[tipo] + ' ' +
        '<span class="sigso-ayuda">(' + (tipo === 'FORTALEZA' || tipo === 'DEBILIDAD' ? 'internas' : 'externas') + ')</span></h4>' +
        '<div class="sgc-lista">' + delTipo.map(function (f) {
          return '<div class="sgc-doc' + (f.estado === 'SUPERADO' ? ' sgc-doc--obsoleto' : '') +
            '" data-factor-id="' + Componentes.escaparHtml(f.factor_id) + '">' +
            '<div class="sgc-doc__linea">' +
              '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(f.codigo) + '</span>' +
              Componentes.badge(ETIQUETA_FACTOR_SGC[f.tipo] || f.tipo, TONO_FACTOR_SGC[f.tipo] || 'neutro') +
              (f.estado === 'SUPERADO' ? Componentes.badge('Superado', 'neutro') : '') +
            '</div>' +
            '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(f.descripcion) + '</span>' +
            (f.observaciones ? '<span class="sgc-doc__meta">' + Componentes.escaparHtml(f.observaciones) + '</span>' : '') +
            (puede ? '<div class="sgc-acciones">' +
              Componentes.boton({ texto: 'Editar', variante: 'sutil', clase: 'js-ctx-editar-factor' }) +
              Componentes.boton({ texto: 'Quitar', variante: 'peligro', clase: 'js-ctx-quitar-factor' }) +
            '</div>' : '') +
          '</div>';
        }).join('') + '</div>';
    }).join('');

    var acciones = puede ? '<div class="sgc-acciones">' +
      Componentes.boton({ texto: 'Agregar factor', variante: 'secundario', clase: 'js-ctx-nuevo-factor' }) +
      Componentes.boton({ texto: 'Registrar revisión del contexto', clase: 'js-ctx-revisar' }) +
      '</div>' : '';

    return kpis + grupos + acciones;
  }

  function vistaPartes_(data, puede) {
    if (!data.partes.length) {
      var p = data.propuesta_partes || [];
      return Componentes.alerta('Las partes interesadas todavía no están cargadas en el sistema.', 'aviso') +
        (puede
          ? '<h4 class="sgc-sub">Propuesta tomada del DOC-04 v02</h4>' +
            '<p class="sigso-ayuda">Son las ' + p.length + ' partes del documento, con sus seis columnas reales: ' +
            Componentes.escaparHtml(p.map(function (x) { return x.nombre; }).join(' · ')) + '.</p>' +
            '<div class="sgc-acciones">' +
              Componentes.boton({ texto: 'Cargar las ' + p.length + ' partes del DOC-04', clase: 'js-ctx-sembrar-partes' }) +
            '</div>'
          : '<p class="sigso-ayuda">El Encargado del SGC es quien las carga.</p>');
    }

    var lista = '<div class="sgc-lista">' + data.partes.map(function (p) {
      return '<div class="sgc-doc" data-parte-id="' + Componentes.escaparHtml(p.parte_id) + '">' +
        '<div class="sgc-doc__linea">' +
          '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(p.nombre) + '</span>' +
          Componentes.badge('Impacto ' + (p.impacto || '—'), p.impacto === 'Alto' ? 'critico' : 'neutro') +
          Componentes.badge('Influencia ' + (p.influencia || '—'), p.influencia === 'Alto' ? 'alerta' : 'neutro') +
        '</div>' +
        '<dl class="sgc-ficha">' + [
          campoFichaSgc_('Necesidades', p.necesidades),
          campoFichaSgc_('Expectativa', p.expectativa),
          campoFichaSgc_('Cómo afecta al SGC', p.efecto_sgc),
          campoFichaSgc_('Método de seguimiento', p.metodo_seguimiento),
          campoFichaSgc_('Frecuencia', p.frecuencia_seguimiento),
          campoFichaSgc_('Responsable', p.responsable_email)
        ].join('') + '</dl>' +
        (puede ? '<div class="sgc-acciones">' +
          Componentes.boton({ texto: 'Editar', variante: 'sutil', clase: 'js-ctx-editar-parte' }) +
          Componentes.boton({ texto: 'Quitar', variante: 'peligro', clase: 'js-ctx-quitar-parte' }) +
        '</div>' : '') +
      '</div>';
    }).join('') + '</div>';

    var acciones = puede ? '<div class="sgc-acciones">' +
      Componentes.boton({ texto: 'Agregar parte interesada', variante: 'secundario', clase: 'js-ctx-nueva-parte' }) +
      Componentes.boton({ texto: 'Registrar revisión del contexto', clase: 'js-ctx-revisar' }) +
      '</div>' : '';

    return '<p class="sigso-ayuda">Los tres últimos campos van vacíos a propósito: el DOC-04 no los trae. ' +
      'Se pueden completar, pero el sistema no los inventa.</p>' + lista + acciones;
  }

  function wireAccionesContexto_(cont, data) {
    function enviar_(accion, datos, exito) {
      api_(accion, datos).then(function (r) {
        var d = (r && r.data) || {};
        Componentes.aviso({
          texto: d.message || (r && r.message) || exito,
          tipo: (r && r.ok && d.ok !== false) ? 'exito' : 'error'
        });
        if (r && r.ok && d.ok !== false) cargarContexto_();
      });
    }

    var sembrarFoda = cont.querySelector('.js-ctx-sembrar-foda');
    if (sembrarFoda) {
      sembrarFoda.addEventListener('click', function () {
        enviar_('sembrarFodaSgc', {}, 'Contexto cargado.');
      });
    }
    var sembrarPartes = cont.querySelector('.js-ctx-sembrar-partes');
    if (sembrarPartes) {
      sembrarPartes.addEventListener('click', function () {
        enviar_('sembrarPartesSgc', {}, 'Partes cargadas.');
      });
    }
    cont.querySelectorAll('.js-ctx-revisar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Componentes.confirmar({
          titulo: '¿Registrar la revisión del contexto?',
          mensaje: 'Deja constancia de que hoy se revisaron los factores y las partes interesadas, ' +
            'aunque no cambie nada. Eso es lo que la norma pide demostrar.',
          confirmar: 'Registrar'
        }).then(function (ok) {
          if (ok) enviar_('registrarRevisionContextoSgc', {}, 'Revisión registrada.');
        });
      });
    });

    var nuevoFactor = cont.querySelector('.js-ctx-nuevo-factor');
    if (nuevoFactor) nuevoFactor.addEventListener('click', function () { abrirFormularioFactor_(null); });
    cont.querySelectorAll('.js-ctx-editar-factor').forEach(function (btn) {
      btn.addEventListener('click', function () {
        abrirFormularioFactor_(buscarPorId_(data.factores, 'factor_id',
          btn.parentNode.parentNode.getAttribute('data-factor-id')));
      });
    });
    cont.querySelectorAll('.js-ctx-quitar-factor').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var f = buscarPorId_(data.factores, 'factor_id',
          btn.parentNode.parentNode.getAttribute('data-factor-id'));
        Componentes.confirmar({
          titulo: '¿Quitar ' + f.codigo + ' del análisis?',
          mensaje: 'Si el factor dejó de aplicar pero quieres conservarlo, edítalo y márcalo como superado.',
          confirmar: 'Quitar', peligro: true
        }).then(function (ok) {
          if (ok) enviar_('anularFactorContextoSgc', { factor_id: f.factor_id }, 'Factor quitado.');
        });
      });
    });

    var nuevaParte = cont.querySelector('.js-ctx-nueva-parte');
    if (nuevaParte) nuevaParte.addEventListener('click', function () { abrirFormularioParte_(null, data.niveles); });
    cont.querySelectorAll('.js-ctx-editar-parte').forEach(function (btn) {
      btn.addEventListener('click', function () {
        abrirFormularioParte_(buscarPorId_(data.partes, 'parte_id',
          btn.parentNode.parentNode.getAttribute('data-parte-id')), data.niveles);
      });
    });
    cont.querySelectorAll('.js-ctx-quitar-parte').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = buscarPorId_(data.partes, 'parte_id',
          btn.parentNode.parentNode.getAttribute('data-parte-id'));
        Componentes.confirmar({
          titulo: '¿Quitar a ' + p.nombre + '?',
          confirmar: 'Quitar', peligro: true
        }).then(function (ok) {
          if (ok) enviar_('anularParteInteresadaSgc', { parte_id: p.parte_id }, 'Parte quitada.');
        });
      });
    });
  }

  function abrirFormularioFactor_(actual) {
    var f = actual || {};
    var opciones = ['FORTALEZA', 'OPORTUNIDAD', 'DEBILIDAD', 'AMENAZA'].map(function (t) {
      return { valor: t, texto: ETIQUETA_FACTOR_SGC[t] + (t === 'FORTALEZA' || t === 'DEBILIDAD' ? ' (interna)' : ' (externa)') };
    });
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">' + (actual ? 'Editar ' + Componentes.escaparHtml(f.codigo) : 'Agregar factor de contexto') + '</h3>' +
        '<form id="form-ctx-factor">' +
          Componentes.campoSelect({ id: 'ctx-tipo', label: 'Tipo', valor: f.tipo || 'FORTALEZA',
            opciones: opciones, requerido: true }) +
          Componentes.campoTextarea({ id: 'ctx-descripcion', label: 'Descripción del factor',
            valor: f.descripcion || '', requerido: true }) +
          Componentes.campoTextarea({ id: 'ctx-observaciones', label: 'Observaciones', valor: f.observaciones || '' }) +
          (actual
            ? Componentes.campoSelect({ id: 'ctx-estado', label: 'Estado', valor: f.estado || 'VIGENTE',
                opciones: [{ valor: 'VIGENTE', texto: 'Vigente' }, { valor: 'SUPERADO', texto: 'Superado' }] })
            : '') +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-ctx-factor').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true;
      var estadoEl = document.getElementById('ctx-estado');
      api_('guardarFactorContextoSgc', {
        factor_id: f.factor_id || '',
        tipo: document.getElementById('ctx-tipo').value,
        descripcion: document.getElementById('ctx-descripcion').value,
        observaciones: document.getElementById('ctx-observaciones').value,
        estado: estadoEl ? estadoEl.value : 'VIGENTE'
      }).then(function (r) {
        var d = (r && r.data) || {};
        if (!r || !r.ok || d.ok === false) {
          boton.disabled = false;
          Componentes.aviso({ texto: d.message || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: d.message || 'Factor guardado.', tipo: 'exito' });
        cargarContexto_();
      }).catch(function () {
        boton.disabled = false;
        Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
      });
    });
  }

  function abrirFormularioParte_(actual, niveles) {
    var p = actual || {};
    var ops = (niveles || ['Alto', 'Medio', 'Bajo']).map(function (n) { return { valor: n, texto: n }; });
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">' + (actual ? 'Editar parte interesada' : 'Agregar parte interesada') + '</h3>' +
        '<form id="form-ctx-parte">' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'ctx-p-nombre', label: 'Parte interesada', valor: p.nombre || '', requerido: true }) +
            Componentes.campoTexto({ id: 'ctx-p-categoria', label: 'Categoría', valor: p.categoria || '',
              ayuda: 'Interna o externa, por ejemplo.' }) +
          '</div>' +
          Componentes.campoTextarea({ id: 'ctx-p-necesidades', label: 'Necesidades y requisitos',
            valor: p.necesidades || '', requerido: true }) +
          Componentes.campoTextarea({ id: 'ctx-p-expectativa', label: 'Expectativa', valor: p.expectativa || '' }) +
          Componentes.campoTextarea({ id: 'ctx-p-efecto', label: 'Cómo afecta al SGC', valor: p.efecto_sgc || '' }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoSelect({ id: 'ctx-p-impacto', label: 'Impacto', valor: p.impacto || 'Alto', opciones: ops, requerido: true }) +
            Componentes.campoSelect({ id: 'ctx-p-influencia', label: 'Nivel de influencia', valor: p.influencia || 'Alto', opciones: ops, requerido: true }) +
          '</div>' +
          '<h4 class="sgc-sub">Seguimiento (opcional)</h4>' +
          '<p class="sigso-ayuda">El DOC-04 no trae estos campos. Complétalos solo si la organización los definió.</p>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'ctx-p-metodo', label: 'Método de seguimiento', valor: p.metodo_seguimiento || '' }) +
            Componentes.campoTexto({ id: 'ctx-p-frecuencia', label: 'Frecuencia', valor: p.frecuencia_seguimiento || '' }) +
          '</div>' +
          Componentes.campoTexto({ id: 'ctx-p-responsable', label: 'Responsable (correo)', valor: p.responsable_email || '' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-ctx-parte').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true;
      api_('guardarParteInteresadaSgc', {
        parte_id: p.parte_id || '',
        nombre: document.getElementById('ctx-p-nombre').value,
        categoria: document.getElementById('ctx-p-categoria').value,
        necesidades: document.getElementById('ctx-p-necesidades').value,
        expectativa: document.getElementById('ctx-p-expectativa').value,
        efecto_sgc: document.getElementById('ctx-p-efecto').value,
        impacto: document.getElementById('ctx-p-impacto').value,
        influencia: document.getElementById('ctx-p-influencia').value,
        metodo_seguimiento: document.getElementById('ctx-p-metodo').value,
        frecuencia_seguimiento: document.getElementById('ctx-p-frecuencia').value,
        responsable_email: document.getElementById('ctx-p-responsable').value
      }).then(function (r) {
        var d = (r && r.data) || {};
        if (!r || !r.ok || d.ok === false) {
          boton.disabled = false;
          Componentes.aviso({ texto: d.message || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: d.message || 'Parte interesada guardada.', tipo: 'exito' });
        cargarContexto_();
      }).catch(function () {
        boton.disabled = false;
        Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
      });
    });
  }

  // ==========================================================================
  // v11.0 Fase 1 (§4.3): alcance del SGC y exclusiones.
  //
  // Es la pantalla que responde las dos primeras preguntas de una auditoria
  // de certificacion: que cubre el sistema, y que quedo fuera y por que.
  // Antes ambas vivian unicamente dentro del DOC-01, en Word.
  // ==========================================================================

  function cargarAlcance_() {
    var cont = panelSgc_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando alcance del SGC...');
    api_('obtenerAlcanceSgc', {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = barraSecciones_() +
          Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar el alcance.', 'error');
        wireSecciones_(cont);
        return;
      }
      pintarAlcance_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = barraSecciones_() + Componentes.alerta('No se pudo conectar.', 'error');
      wireSecciones_(cont);
    });
  }

  // El objeto se busca en los datos que ya estan en memoria y en el
  // atributo va solo el id. Componentes.escaparHtml (textContent ->
  // innerHTML) NO escapa comillas dobles, asi que un JSON.stringify en un
  // atributo se corta en la primera comilla del primer nombre de campo.
  function buscarPorId_(lista, campo, id) {
    return (lista || []).filter(function (x) { return x[campo] === id; })[0] || null;
  }

  function campoFichaSgc_(etiqueta, valor) {
    return '<div class="sgc-ficha__campo"><dt>' + Componentes.escaparHtml(etiqueta) + '</dt>' +
      '<dd>' + Componentes.escaparHtml(valor == null || valor === '' ? '—' : String(valor)) + '</dd></div>';
  }

  function pintarAlcance_(cont, data) {
    var a = data.alcance;
    var puede = !!data.puede_gestionar;

    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Qué cubre el sistema de gestión de la calidad y qué cláusulas quedaron fuera. ' +
      'La norma (§4.3) pide mantenerlo documentado y disponible, y exige justificar cada exclusión.</p>' +
      '</div>';

    if (!a) {
      cont.innerHTML = cabecera + pintarSinAlcance_(data, puede);
      wireSecciones_(cont);
      var btnDeclarar = cont.querySelector('.js-sgc-declarar-alcance');
      if (btnDeclarar) {
        btnDeclarar.addEventListener('click', function () {
          abrirFormularioAlcance_(null, data.propuesta, false);
        });
      }
      return;
    }

    var ficha = '<dl class="sgc-ficha">' + [
      campoFichaSgc_('Razón social', a.razon_social),
      campoFichaSgc_('Nombre de fantasía', a.nombre_fantasia),
      campoFichaSgc_('RUT', a.rut),
      campoFichaSgc_('Norma', a.norma_codigo + ':' + a.norma_version),
      campoFichaSgc_('Versión del alcance', 'v' + a.version),
      campoFichaSgc_('Vigente desde', a.vigente_desde ? fechaCorta_(a.vigente_desde) : '')
    ].join('') + '</dl>';

    var declaracion = '<h4 class="sgc-sub">Declaración de alcance</h4>' +
      '<p>' + Componentes.escaparHtml(a.declaracion) + '</p>' +
      '<dl class="sgc-ficha">' + [
        campoFichaSgc_('Áreas', a.areas.join(' · ')),
        campoFichaSgc_('Ubicaciones', a.ubicaciones.join(' · '))
      ].join('') + '</dl>';

    var lista = data.exclusiones || [];
    var exclusiones = '<h4 class="sgc-sub">Exclusiones declaradas (' + lista.length + ')</h4>';
    if (!lista.length) {
      exclusiones += '<p class="sigso-ayuda">Ninguna. Todas las cláusulas de la norma se consideran aplicables.</p>';
    } else {
      exclusiones += '<div class="sgc-lista">' + lista.map(function (e) {
        return '<div class="sgc-doc" data-exclusion-id="' + Componentes.escaparHtml(e.exclusion_id) + '">' +
          '<div class="sgc-doc__linea">' +
            '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(e.clausula) +
              (e.titulo ? ' — ' + Componentes.escaparHtml(e.titulo) : '') + '</span>' +
            Componentes.badge(e.total ? 'Cláusula completa' : 'Parcial', e.total ? 'critico' : 'neutro') +
          '</div>' +
          '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(e.justificacion) + '</span>' +
          (puede ? '<div class="sgc-acciones">' +
            Componentes.boton({ texto: 'Editar', variante: 'sutil', clase: 'js-sgc-editar-exclusion' }) +
            Componentes.boton({ texto: 'Retirar', variante: 'peligro', clase: 'js-sgc-retirar-exclusion' }) +
          '</div>' : '') +
        '</div>';
      }).join('') + '</div>';
    }

    var acciones = puede ? '<div class="sgc-acciones">' +
      Componentes.boton({ texto: 'Corregir alcance', variante: 'secundario', clase: 'js-sgc-editar-alcance' }) +
      Componentes.boton({ texto: 'Declarar exclusión', variante: 'secundario', clase: 'js-sgc-nueva-exclusion' }) +
      Componentes.boton({ texto: 'Publicar nueva versión', clase: 'js-sgc-version-alcance' }) +
      '</div>' : '';

    var historial = '';
    if ((data.historial || []).length) {
      historial = '<h4 class="sgc-sub">Versiones anteriores</h4><div class="sgc-lista">' +
        data.historial.map(function (h) {
          return '<div class="sgc-doc sgc-doc--obsoleto">' +
            '<div class="sgc-doc__linea">' +
              '<span class="sgc-doc__codigo">v' + Componentes.escaparHtml(h.version) + '</span>' +
              Componentes.badge('Reemplazada', 'neutro') +
            '</div>' +
            '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(h.declaracion || '') + '</span>' +
            (h.observaciones
              ? '<span class="sgc-doc__meta">Motivo del cambio: ' + Componentes.escaparHtml(h.observaciones) + '</span>'
              : '') +
          '</div>';
        }).join('') + '</div>';
    }

    cont.innerHTML = cabecera + ficha + declaracion + exclusiones + acciones + historial;
    wireSecciones_(cont);
    if (!puede) return;

    cont.querySelector('.js-sgc-editar-alcance').addEventListener('click', function () {
      abrirFormularioAlcance_(a, null, false);
    });
    cont.querySelector('.js-sgc-version-alcance').addEventListener('click', function () {
      abrirFormularioAlcance_(a, null, true);
    });
    cont.querySelector('.js-sgc-nueva-exclusion').addEventListener('click', function () {
      abrirFormularioExclusion_(null, data.clausulas_catalogo || []);
    });
    cont.querySelectorAll('.js-sgc-editar-exclusion').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var caja = btn.parentNode.parentNode;
        abrirFormularioExclusion_(buscarPorId_(data.exclusiones, 'exclusion_id',
          caja.getAttribute('data-exclusion-id')), data.clausulas_catalogo || []);
      });
    });
    cont.querySelectorAll('.js-sgc-retirar-exclusion').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var caja = btn.parentNode.parentNode;
        var ex = buscarPorId_(data.exclusiones, 'exclusion_id', caja.getAttribute('data-exclusion-id'));
        Componentes.confirmar({
          titulo: '¿Retirar la exclusión de ' + ex.clausula + '?',
          mensaje: 'La cláusula vuelve a considerarse aplicable y se evaluará en la matriz de cobertura.',
          confirmar: 'Retirar',
          peligro: true
        }).then(function (ok) {
          if (!ok) return;
          api_('anularExclusionSgc', { exclusion_id: ex.exclusion_id }).then(function (r) {
            Componentes.aviso({
              texto: (r && r.data && r.data.message) || (r && r.message) || 'Exclusión retirada.',
              tipo: (r && r.ok) ? 'exito' : 'error'
            });
            if (r && r.ok) cargarAlcance_();
          });
        });
      });
    });
  }

  // Sin alcance declarado la pantalla no muestra un vacio: muestra la
  // propuesta transcrita del DOC-01 para revisar y confirmar. Nada de eso
  // esta guardado todavia -- el sistema no pone en boca de la organizacion
  // algo que nadie aprobo aca adentro.
  function pintarSinAlcance_(data, puede) {
    var p = data.propuesta || {};
    var aviso = Componentes.alerta('El alcance del SGC todavía no está declarado en el sistema. ' +
      'Es lo primero que pide una auditoría de certificación (§4.3).', 'aviso');

    if (!puede) {
      return aviso + '<p class="sigso-ayuda">El Encargado del SGC es quien lo declara.</p>';
    }

    var prev = '<h4 class="sgc-sub">Propuesta tomada del DOC-01 (Manual de calidad)</h4>' +
      '<p class="sigso-ayuda">Está transcrita del manual, no redactada por el sistema. Revísala antes de confirmar.</p>' +
      '<dl class="sgc-ficha">' + [
        campoFichaSgc_('Razón social', p.razon_social),
        campoFichaSgc_('Nombre de fantasía', p.nombre_fantasia),
        campoFichaSgc_('RUT', p.rut),
        campoFichaSgc_('Áreas', (p.areas || []).join(' · ')),
        campoFichaSgc_('Ubicaciones', (p.ubicaciones || []).join(' · ')),
        campoFichaSgc_('Exclusiones propuestas', String((p.exclusiones || []).length))
      ].join('') + '</dl>' +
      '<p>' + Componentes.escaparHtml(p.declaracion || '') + '</p>';

    var advertencias = (p.advertencias || []).map(function (t) {
      return Componentes.alerta(t, 'aviso');
    }).join('');

    return aviso + prev + advertencias + '<div class="sgc-acciones">' +
      Componentes.boton({ texto: 'Revisar y declarar el alcance', clase: 'js-sgc-declarar-alcance' }) +
      '</div>';
  }

  // Un solo formulario para los tres caminos (declarar, corregir, publicar
  // version nueva). La diferencia es el destino y, en la version nueva, un
  // campo mas: por que cambia -- sin eso la version anterior queda archivada
  // sin explicacion, que es lo que el auditor pregunta.
  function abrirFormularioAlcance_(actual, propuesta, esNuevaVersion) {
    var base = actual || propuesta || {};
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">' +
          (esNuevaVersion ? 'Publicar nueva versión del alcance'
            : (actual ? 'Corregir el alcance' : 'Declarar el alcance del SGC')) + '</h3>' +
        (esNuevaVersion
          ? '<p class="sigso-ayuda">La versión actual se conserva como reemplazada. Las exclusiones se copian a la nueva.</p>'
          : (actual
            ? '<p class="sigso-ayuda">Para corregir un dato de la versión vigente. Si el alcance cambia de verdad, publica una versión nueva.</p>'
            : '<p class="sigso-ayuda">Revisa cada campo antes de guardar: esto es lo que se muestra al auditor.</p>')) +
        '<form id="form-sgc-alcance">' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-alc-razon', label: 'Razón social', valor: base.razon_social || '', requerido: true }) +
            Componentes.campoTexto({ id: 'sgc-alc-fantasia', label: 'Nombre de fantasía', valor: base.nombre_fantasia || '' }) +
          '</div>' +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-alc-rut', label: 'RUT', valor: base.rut || '' }) +
            Componentes.campoTexto({ id: 'sgc-alc-desde', label: 'Vigente desde', tipo: 'date', valor: base.vigente_desde || '' }) +
          '</div>' +
          Componentes.campoTextarea({ id: 'sgc-alc-declaracion', label: 'Declaración de alcance',
            valor: base.declaracion || '', requerido: true,
            ayuda: 'Qué servicios cubre el SGC y para qué tipo de clientes.' }) +
          Componentes.campoTextarea({ id: 'sgc-alc-areas', label: 'Áreas incluidas',
            valor: (base.areas || []).join(String.fromCharCode(10)), requerido: true,
            ayuda: 'Una por línea.' }) +
          Componentes.campoTextarea({ id: 'sgc-alc-ubicaciones', label: 'Ubicaciones',
            valor: (base.ubicaciones || []).join(String.fromCharCode(10)),
            ayuda: 'Una por línea. Las direcciones llevan comas, por eso no sirven como separador.' }) +
          '<div class="sgc-form-fila">' +
            Componentes.campoTexto({ id: 'sgc-alc-norma', label: 'Norma',
              valor: base.norma_codigo || 'ISO 9001', requerido: true }) +
            Componentes.campoTexto({ id: 'sgc-alc-version-norma', label: 'Edición de la norma',
              valor: base.norma_version || '2015', requerido: true }) +
          '</div>' +
          (esNuevaVersion
            ? Componentes.campoTextarea({ id: 'sgc-alc-motivo', label: 'Por qué cambia el alcance',
                valor: '', requerido: true,
                ayuda: 'Queda como trazabilidad junto a la versión que se reemplaza.' })
            : '') +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: esNuevaVersion ? 'Publicar versión' : 'Guardar',
              tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-sgc-alcance').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true;

      var payload = {
        razon_social: document.getElementById('sgc-alc-razon').value,
        nombre_fantasia: document.getElementById('sgc-alc-fantasia').value,
        rut: document.getElementById('sgc-alc-rut').value,
        vigente_desde: document.getElementById('sgc-alc-desde').value,
        declaracion: document.getElementById('sgc-alc-declaracion').value,
        areas: listaDesdeTexto_(document.getElementById('sgc-alc-areas').value),
        ubicaciones: listaDesdeTexto_(document.getElementById('sgc-alc-ubicaciones').value),
        norma_codigo: document.getElementById('sgc-alc-norma').value,
        norma_version: document.getElementById('sgc-alc-version-norma').value
      };
      if (esNuevaVersion) {
        payload.justificacion_cambio = document.getElementById('sgc-alc-motivo').value;
      }

      api_(esNuevaVersion ? 'nuevaVersionAlcanceSgc' : 'guardarAlcanceSgc', payload).then(function (r) {
        var datos = (r && r.data) || {};
        if (!r || !r.ok || datos.ok === false) {
          boton.disabled = false;
          Componentes.aviso({ texto: datos.message || (r && r.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: datos.message || 'Alcance guardado.', tipo: 'exito' });
        // Al declarar el alcance por primera vez, las exclusiones propuestas
        // NO se guardan solas: se ofrecen una por una, para que cada
        // justificacion pase por una decision explicita.
        var pendientes = (!actual && propuesta && propuesta.exclusiones) ? propuesta.exclusiones.slice() : [];
        if (pendientes.length) declararExclusionesPropuestas_(pendientes);
        else cargarAlcance_();
      }).catch(function () {
        boton.disabled = false;
        Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
      });
    });
  }

  function declararExclusionesPropuestas_(pendientes) {
    Componentes.confirmar({
      titulo: 'Declarar también las ' + pendientes.length + ' exclusiones del DOC-01?',
      mensaje: pendientes.map(function (e) { return e.clausula + ' — ' + e.titulo; }).join('\n') +
        '\n\nQuedan registradas con la justificación que trae el manual. Puedes editarlas después.',
      confirmar: 'Declararlas'
    }).then(function (ok) {
      if (!ok) { cargarAlcance_(); return; }
      var i = 0;
      function siguiente() {
        if (i >= pendientes.length) { cargarAlcance_(); return; }
        api_('guardarExclusionSgc', pendientes[i++]).then(siguiente).catch(siguiente);
      }
      siguiente();
    });
  }

  function abrirFormularioExclusion_(actual, catalogo) {
    var a = actual || {};
    var opciones = (catalogo || []).map(function (c) {
      return { valor: c.codigo, texto: c.codigo + ' — ' + c.titulo };
    });
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">' + (actual ? 'Corregir exclusión' : 'Declarar exclusión') + '</h3>' +
        '<p class="sigso-ayuda">Escribe la cláusula con la misma granularidad que el manual. ' +
        'Una sub-cláusula (7.1.5.2) excluye solo esa parte; una cláusula completa (8.3) la saca entera de la evaluación.</p>' +
        '<form id="form-sgc-exclusion">' +
          Componentes.campoTexto({ id: 'sgc-exc-clausula', label: 'Cláusula excluida',
            valor: a.clausula || '', requerido: true, ayuda: 'Por ejemplo 7.1.5.2, 8.5.1 f, u 8.3.' }) +
          Componentes.campoTexto({ id: 'sgc-exc-titulo', label: 'Título de la cláusula', valor: a.titulo || '' }) +
          Componentes.campoTextarea({ id: 'sgc-exc-justificacion', label: 'Justificación',
            valor: a.justificacion || '', requerido: true,
            ayuda: 'Obligatoria: §4.3 exige explicar por qué la cláusula no aplica a la organización.' }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit', clase: 'js-sgc-guardar' }) +
          '</div>' +
        '</form>' +
        '<p class="sigso-ayuda">Cláusulas del catálogo: ' +
          Componentes.escaparHtml(opciones.map(function (o) { return o.valor; }).join(', ')) + '</p>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-sgc-exclusion').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var boton = fondo.querySelector('.js-sgc-guardar');
      boton.disabled = true;
      api_('guardarExclusionSgc', {
        exclusion_id: a.exclusion_id || '',
        clausula: document.getElementById('sgc-exc-clausula').value,
        titulo: document.getElementById('sgc-exc-titulo').value,
        justificacion: document.getElementById('sgc-exc-justificacion').value
      }).then(function (r) {
        var datos = (r && r.data) || {};
        if (!r || !r.ok || datos.ok === false) {
          boton.disabled = false;
          Componentes.aviso({ texto: datos.message || (r && r.message) || 'No se pudo guardar.', tipo: 'error' });
          return;
        }
        cerrar();
        Componentes.aviso({ texto: datos.message || 'Exclusión guardada.', tipo: 'exito' });
        cargarAlcance_();
      }).catch(function () {
        boton.disabled = false;
        Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
      });
    });
  }

  // Se separa por SALTO DE LINEA, no por coma: una direccion como
  // 'Av. Grecia 1938, Ñuñoa' es UNA ubicacion, y con coma se partia en dos.
  function listaDesdeTexto_(texto) {
    return String(texto || '').split(String.fromCharCode(10))
      .map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // v11.0 Fase 1: NO_APLICA es el cuarto estado. Una clausula excluida del
  // alcance con justificacion no es un vacio -- se muestra neutra, no roja.
  var ESTADO_COBERTURA_ETIQUETA = { COMPLETO: 'Completo', PARCIAL: 'Parcial', FALTANTE: 'Faltante', NO_APLICA: 'No aplica' };
  var ESTADO_COBERTURA_TONO = { COMPLETO: 'ok', PARCIAL: 'alerta', FALTANTE: 'critico', NO_APLICA: 'neutro' };

  function cargarCobertura_() {
    var cont = panelSgc_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando matriz de cobertura...');
    api_('listarMatrizCoberturaSgc', {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = barraSecciones_() +
          Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar la matriz de cobertura.', 'error');
        wireSecciones_(cont);
        return;
      }
      pintarCobertura_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = barraSecciones_() + Componentes.alerta('No se pudo conectar.', 'error');
      wireSecciones_(cont);
    });
  }

  function pintarCobertura_(cont, data) {
    var r = data.resumen || {};
    var cabecera = barraSecciones_() + '<div class="sgc-cabecera">' +
      '<p class="sigso-ayuda">Las 28 cláusulas auditables de ISO 9001:2015, con el estado que se puede sustentar hoy con datos del sistema. ' +
      'Responde "¿estamos listos para la auditoría?"</p>' +
      '</div>';

    var kpis = '<div class="sgc-kpis">' + [
      Componentes.kpi({ etiqueta: 'Cláusulas', valor: r.total || 0 }),
      Componentes.kpi({ etiqueta: 'Completo', valor: r.completo || 0 }),
      Componentes.kpi({ etiqueta: 'Parcial', valor: r.parcial || 0 }),
      Componentes.kpi({ etiqueta: 'Faltante', valor: r.faltante || 0 }),
      Componentes.kpi({ etiqueta: 'No aplica', valor: r.no_aplica || 0,
        titulo: 'Cláusulas excluidas del alcance con justificación (§4.3). No cuentan para el porcentaje.' }),
      Componentes.kpi({ etiqueta: 'Listos (estimado)', valor: (r.pct_listo || 0) + '%',
        titulo: 'Sobre ' + (r.aplicables || 0) + ' cláusulas aplicables. Indicador interno de gestión, no un porcentaje oficial de certificación.' })
    ].join('') + '</div>';

    var filas = (data.clausulas || []).map(function (c) {
      return '<button type="button" class="sgc-doc js-sgc-abrir-clausula" data-codigo="' +
        Componentes.escaparHtml(c.codigo) + '">' +
        '<div class="sgc-doc__linea">' +
          '<span class="sgc-doc__codigo">' + Componentes.escaparHtml(c.codigo) + ' — ' + Componentes.escaparHtml(c.titulo) + '</span>' +
          Componentes.badge(ESTADO_COBERTURA_ETIQUETA[c.estado] || c.estado, ESTADO_COBERTURA_TONO[c.estado] || 'neutro') +
        '</div>' +
        '<span class="sgc-doc__nombre">' + Componentes.escaparHtml(c.resumen) +
          (c.exclusiones && c.estado !== 'NO_APLICA'
            ? ' · ' + c.exclusiones + ' exclusión(es) parcial(es) declarada(s)' : '') + '</span>' +
        '</button>';
    }).join('');

    cont.innerHTML = cabecera + kpis + '<div class="sgc-lista">' + filas + '</div>';
    wireSecciones_(cont);
    cont.querySelectorAll('.js-sgc-abrir-clausula').forEach(function (btn) {
      btn.addEventListener('click', function () { abrirDetalleClausula_(btn.getAttribute('data-codigo')); });
    });
  }

  function abrirDetalleClausula_(codigo) {
    api_('getDetalleClausulaCoberturaSgc', { codigo: codigo }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo cargar la cláusula.', tipo: 'error' });
        return;
      }
      pintarDetalleClausula_(respuesta.data);
    });
  }

  function pintarDetalleClausula_(c) {
    var filas = (c.evidencia || []).map(function (e) {
      return '<tr>' +
        '<td>' + Componentes.escaparHtml(e.tipo) + '</td>' +
        '<td>' + Componentes.escaparHtml(e.descripcion || '') + '</td>' +
        '<td>' + (e.fecha ? fechaCorta_(e.fecha) : '—') + '</td>' +
        '<td>' + Componentes.escaparHtml(e.responsable || '—') + '</td>' +
        '</tr>';
    }).join('');

    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">' + Componentes.escaparHtml(c.codigo) + ' — ' + Componentes.escaparHtml(c.titulo) + '</h3>' +
        '<p>' + Componentes.badge(ESTADO_COBERTURA_ETIQUETA[c.estado] || c.estado, ESTADO_COBERTURA_TONO[c.estado] || 'neutro') + '</p>' +
        '<p class="sigso-ayuda">' + Componentes.escaparHtml(c.resumen) + '</p>' +
        (c.nota ? Componentes.alerta(c.nota, 'aviso') : '') +
        (filas
          ? '<table class="sigso-tabla">' +
              '<thead><tr><th>Tipo</th><th>Descripción</th><th>Fecha</th><th>Responsable</th></tr></thead>' +
              '<tbody>' + filas + '</tbody>' +
            '</table>'
          : '') +
        '<div class="sigso-modal__acciones">' +
          Componentes.boton({ texto: 'Cerrar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
          Componentes.boton({ texto: 'Descargar evidencia (PDF)', icono: 'descargar', clase: 'js-sgc-descargar-evidencia', tipo: 'button' }) +
        '</div>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    fondo.querySelector('.js-sgc-descargar-evidencia').addEventListener('click', function (evento) {
      var boton = evento.currentTarget;
      var textoOriginal = boton.textContent;
      boton.disabled = true; boton.textContent = 'Generando...';
      api_('descargarEvidenciaClausulaSgc', { codigo: c.codigo }).then(function (respuesta) {
        boton.disabled = false; boton.textContent = textoOriginal;
        if (!respuesta || !respuesta.ok) {
          Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo generar el PDF.', tipo: 'error' });
          return;
        }
        descargarBase64Pdf_(respuesta.data.pdf_base64, respuesta.data.filename);
      });
    });
  }

  // Mismo patron que descargarOrdenTrabajo_ (detalle.js): base64 -> Blob ->
  // descarga, sin lo cual un binario que llega por llamarApi no se puede bajar.
  function descargarBase64Pdf_(base64, filename) {
    var bytes = atob(base64);
    var buffer = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
    var blob = new Blob([buffer], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'evidencia.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // --- Accesos SGC / Centro de Control (admin-only) ---------------------------
  // El panel de "quién ve qué". Exclusivo del administrador: repartir accesos
  // es el poder más sensible del módulo. El rol define las secciones; la
  // visibilidad del documento define los documentos; los datos personales son
  // siempre solo-propios. Nada de esto se marca casilla-por-casilla.
  //
  // v10.0 "Centro de Control de Accesos": 3 vistas dentro de Accesos --
  // Personas (asignar), Matriz de distribución (quién vio qué) y
  // Confidenciales (quién está en cada lista restringida). "¿Qué ve?" abre
  // la carpeta de acceso completa de una persona (previsualizarAcceso_).

  var vistaAcceso_ = 'personas';

  function cargarAccesos_() {
    var cont = panelSgc_();
    if (!cont) return;
    cont.innerHTML = Componentes.cargando('Cargando accesos...');
    if (vistaAcceso_ === 'matriz') {
      api_('getMatrizDistribucionSgc', {}).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          cont.innerHTML = barraSecciones_() + subNavAccesos_() +
            Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar la matriz.', 'error');
          wireSecciones_(cont); wireSubNavAccesos_(cont);
          return;
        }
        pintarMatriz_(cont, respuesta.data);
      }).catch(function () {
        cont.innerHTML = barraSecciones_() + subNavAccesos_() + Componentes.alerta('No se pudo conectar.', 'error');
        wireSecciones_(cont); wireSubNavAccesos_(cont);
      });
      return;
    }
    if (vistaAcceso_ === 'confidenciales') {
      api_('getDocumentosConfidencialesSgc', {}).then(function (respuesta) {
        if (!respuesta || !respuesta.ok) {
          cont.innerHTML = barraSecciones_() + subNavAccesos_() +
            Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar la lista de confidenciales.', 'error');
          wireSecciones_(cont); wireSubNavAccesos_(cont);
          return;
        }
        pintarConfidenciales_(cont, respuesta.data);
      }).catch(function () {
        cont.innerHTML = barraSecciones_() + subNavAccesos_() + Componentes.alerta('No se pudo conectar.', 'error');
        wireSecciones_(cont); wireSubNavAccesos_(cont);
      });
      return;
    }
    api_('listarAccesosSgc', {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = barraSecciones_() + subNavAccesos_() +
          Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar el panel de accesos.', 'error');
        wireSecciones_(cont); wireSubNavAccesos_(cont);
        return;
      }
      pintarAccesos_(cont, respuesta.data);
    }).catch(function () {
      cont.innerHTML = barraSecciones_() + subNavAccesos_() + Componentes.alerta('No se pudo conectar.', 'error');
      wireSecciones_(cont); wireSubNavAccesos_(cont);
    });
  }

  function subNavAccesos_() {
    var subs = [
      { id: 'personas', texto: 'Personas' },
      { id: 'matriz', texto: 'Matriz de distribución' },
      { id: 'confidenciales', texto: 'Confidenciales' }
    ];
    return '<div class="sigso-tabs sigso-tabs--sub sgc-subnav-accesos">' + subs.map(function (s) {
      return '<button type="button" class="sigso-tab js-acc-vista' +
        (s.id === vistaAcceso_ ? ' sigso-tab--activo' : '') + '" data-vista="' + s.id + '">' + s.texto + '</button>';
    }).join('') + '</div>';
  }

  function wireSubNavAccesos_(cont) {
    cont.querySelectorAll('.js-acc-vista').forEach(function (btn) {
      btn.addEventListener('click', function () {
        vistaAcceso_ = btn.getAttribute('data-vista');
        cargarAccesos_();
      });
    });
  }

  function etiquetaRolAcceso_(clave, roles) {
    if (!clave) return 'Sin rol · solo documentos generales';
    var r = (roles || []).filter(function (x) { return x.clave === clave; })[0];
    return r ? r.etiqueta : clave;
  }

  // v14.0 (rediseño de Accesos): el nivel de acceso de un rol, para colorear
  // la tarjeta. Es lo que el admin quiere ver de un vistazo -- "quién manda,
  // quién solo lee, quién ve lo justo" -- sin leer rol por rol.
  function nivelAccesoRol_(clave) {
    if (clave === 'ENCARGADO_SGC') return 'gobierno';
    if (['DIRECCION', 'GERENCIA_ADM', 'AUDITOR_EXTERNO'].indexOf(clave) !== -1) return 'lectura';
    return 'operativo'; // OPERATIVO, JEFATURA_AREA, ENC_ADMIN o sin rol
  }
  var NIVEL_ACCESO_ETIQUETA = { gobierno: 'Gobierno del SGC', lectura: 'Lectura total', operativo: 'Acceso acotado' };

  function diasHastaAcceso_(iso) {
    if (!iso) return null;
    var f = new Date(iso);
    if (isNaN(f.getTime())) return null;
    var hoy = new Date();
    return Math.round((Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate()) -
      Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) / 86400000);
  }
  // "Por vencer" incluye lo ya vencido: ambos casos piden acción del admin.
  function porVencerAcceso_(c) {
    var d = diasHastaAcceso_(c.vigencia_hasta);
    return d !== null && d <= 30;
  }
  function inicialesAcceso_(nombre) {
    var partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '?';
    return (partes[0].charAt(0) + (partes.length > 1 ? partes[partes.length - 1].charAt(0) : '')).toUpperCase();
  }

  // Estado de la vista Personas de Accesos (filtros de cliente sobre lo ya
  // traído: no se vuelve a pedir al backend al filtrar).
  var filtroAccesoGrupo_ = 'todos';   // todos | con-rol | sin-rol | por-vencer | sin-cuenta
  var filtroAccesoTexto_ = '';

  function pintarAccesos_(cont, data) {
    var cuentas = data.cuentas || [];
    var roles = data.roles || [];
    var enr = data.enrolamiento || {};
    var sinCuenta = (enr.personas_sin_cuenta || []);

    var conRol = cuentas.filter(function (c) { return !!c.rol_sgc; }).length;
    var sinRol = cuentas.length - conRol;
    var porVencer = cuentas.filter(porVencerAcceso_).length;

    var intro = barraSecciones_() + subNavAccesos_() +
      '<p class="sigso-ayuda">Aquí defines qué ve cada persona en Calidad. El <b>rol</b> decide las secciones y el alcance; ' +
      'los documentos confidenciales se restringen documento por documento (al cargarlos o editarlos, o desde la pestaña ' +
      '"Confidenciales"). Este panel es exclusivo del administrador.</p>';

    // Resumen filtrable: los 4 números con los que el admin llega al panel,
    // y cada uno acota la lista de abajo al hacer clic.
    function tarjetaResumen_(grupo, valor, etiqueta, tono) {
      return '<button type="button" class="sgc-acc-kpi' + (tono ? ' sgc-acc-kpi--' + tono : '') +
        (filtroAccesoGrupo_ === grupo ? ' sgc-acc-kpi--activo' : '') + '" data-grupo="' + grupo + '">' +
        '<span class="sgc-acc-kpi__valor">' + valor + '</span>' +
        '<span class="sgc-acc-kpi__etiqueta">' + etiqueta + '</span></button>';
    }
    var resumen = '<div class="sgc-acc-kpis">' +
      tarjetaResumen_('con-rol', conRol, 'Con rol asignado', 'ok') +
      tarjetaResumen_('sin-rol', sinRol, 'Sin rol', 'neutro') +
      tarjetaResumen_('por-vencer', porVencer, 'Por vencer', porVencer ? 'alerta' : 'neutro') +
      tarjetaResumen_('sin-cuenta', sinCuenta.length, 'Sin cuenta', sinCuenta.length ? 'alerta' : 'neutro') +
      '</div>';

    // Leyenda de niveles SIEMPRE visible (antes el "qué ve cada rol" estaba
    // escondido en un <details>); el detalle largo por rol queda plegado.
    var leyenda = '<div class="sgc-acc-leyenda">' +
      '<span><span class="sgc-acc-punto sgc-acc-punto--gobierno"></span>Gobierno del SGC</span>' +
      '<span><span class="sgc-acc-punto sgc-acc-punto--lectura"></span>Lectura total</span>' +
      '<span><span class="sgc-acc-punto sgc-acc-punto--operativo"></span>Acceso acotado</span>' +
      '<details class="sgc-acc-roles-ref"><summary>Qué ve cada rol en detalle</summary><ul class="sgc-items">' +
      roles.map(function (r) {
        return '<li><b>' + Componentes.escaparHtml(r.etiqueta) + ':</b> ' + Componentes.escaparHtml(r.descripcion) + '</li>';
      }).join('') + '</ul></details>' +
      '</div>';

    // Barra de herramientas: buscar + filtro por rol. La lista de tarjetas
    // vive en su propio contenedor para re-pintarse sin perder el foco del
    // buscador ni re-armar toda la pantalla.
    // Roles asignados a un correo sin cuenta activa: residuo a limpiar antes
    // del go-live. Es dato de higiene, va como aviso puntual (no como filtro).
    var avisoResiduo = (enr.roles_sin_cuenta || []).length
      ? Componentes.alerta((enr.roles_sin_cuenta.length) + ' rol(es) asignado(s) a un correo sin cuenta activa (residuo a limpiar): ' +
          enr.roles_sin_cuenta.map(function (r) { return r.email; }).join(', ') + '.', 'info')
      : '';

    var toolbar = '<div class="sgc-acc-toolbar">' +
      '<input type="text" id="sgc-acc-buscar" class="sgc-acc-buscar" placeholder="Buscar por nombre o correo…" value="' + Componentes.escaparHtml(filtroAccesoTexto_) + '">' +
      '<select id="sgc-acc-rol"><option value="">Todos los roles</option>' +
        '<option value="__sin">Sin rol</option>' +
        roles.map(function (r) { return '<option value="' + r.clave + '"' + (filtroAccesoGrupo_ === 'rol:' + r.clave ? ' selected' : '') + '>' + Componentes.escaparHtml(r.etiqueta) + '</option>'; }).join('') +
      '</select>' +
      '</div>';

    cont.innerHTML = intro + resumen + leyenda + avisoResiduo + toolbar + '<div id="sgc-acc-lista"></div>';

    wireSecciones_(cont);
    wireSubNavAccesos_(cont);

    cont.querySelectorAll('.sgc-acc-kpi').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var g = btn.getAttribute('data-grupo');
        filtroAccesoGrupo_ = (filtroAccesoGrupo_ === g) ? 'todos' : g; // segundo clic = quitar filtro
        pintarAccesos_(cont, data);
      });
    });
    var buscar = cont.querySelector('#sgc-acc-buscar');
    if (buscar) buscar.addEventListener('input', function () {
      filtroAccesoTexto_ = this.value;
      pintarListaAccesos_(cont, data);
    });
    var selRol = cont.querySelector('#sgc-acc-rol');
    if (selRol) selRol.addEventListener('change', function () {
      // El desplegable de rol es un filtro fino aparte del grupo: al usarlo
      // se sale del grupo (para no combinar dos filtros que se contradicen).
      filtroAccesoGrupo_ = this.value ? ('rol:' + this.value) : 'todos';
      pintarAccesos_(cont, data);
    });

    pintarListaAccesos_(cont, data);
  }

  function pintarListaAccesos_(cont, data) {
    var lista = cont.querySelector('#sgc-acc-lista');
    if (!lista) return;
    var cuentas = data.cuentas || [];
    var roles = data.roles || [];
    var areas = data.areas || [];
    var enr = data.enrolamiento || {};
    var areaNombre = {};
    areas.forEach(function (a) { areaNombre[a.area_id] = a.nombre; });

    // "Sin cuenta" no son cuentas: son personas del alcance del SGC que aún
    // no tienen con qué entrar. Se muestran como tarjetas apagadas, sin
    // acciones -- lo accionable es crearles la cuenta, fuera de este panel.
    if (filtroAccesoGrupo_ === 'sin-cuenta') {
      var sinCuenta = enr.personas_sin_cuenta || [];
      lista.innerHTML = sinCuenta.length
        ? '<p class="sigso-ayuda">Personas en el alcance del SGC que todavía no tienen cuenta para entrar. Créales una cuenta en Administración para poder asignarles un rol.</p>' +
          '<div class="sgc-acc-grid">' + sinCuenta.map(function (p) {
            return '<div class="sgc-acc-card sgc-acc-card--vacia">' +
              '<span class="sgc-acc-card__avatar">' + Componentes.escaparHtml(inicialesAcceso_(p.nombre)) + '</span>' +
              '<div class="sgc-acc-card__info"><div class="sgc-acc-card__nombre">' + Componentes.escaparHtml(p.nombre) + '</div>' +
              '<div class="sgc-acc-card__email">' + Componentes.escaparHtml(p.email || 'sin correo') + '</div>' +
              '<div class="sgc-acc-card__meta"><span class="sgc-acc-chip sgc-acc-chip--alerta">Sin cuenta para entrar</span></div></div>' +
              '</div>';
          }).join('') + '</div>'
        : Componentes.alerta('Todas las personas del alcance del SGC ya tienen cuenta. ✓', 'exito');
      return;
    }

    var texto = filtroAccesoTexto_.trim().toLowerCase();
    var filtradas = cuentas.filter(function (c) {
      if (filtroAccesoGrupo_ === 'con-rol' && !c.rol_sgc) return false;
      if (filtroAccesoGrupo_ === 'sin-rol' && c.rol_sgc) return false;
      if (filtroAccesoGrupo_ === 'por-vencer' && !porVencerAcceso_(c)) return false;
      if (filtroAccesoGrupo_.indexOf('rol:') === 0) {
        var q = filtroAccesoGrupo_.slice(4);
        if (q === '__sin' ? !!c.rol_sgc : c.rol_sgc !== q) return false;
      }
      if (texto) {
        var enNombre = String(c.nombre || '').toLowerCase().indexOf(texto) !== -1;
        var enEmail = String(c.email || '').toLowerCase().indexOf(texto) !== -1;
        if (!enNombre && !enEmail) return false;
      }
      return true;
    });

    if (!filtradas.length) {
      lista.innerHTML = Componentes.vacio({ texto: 'Ninguna persona coincide con este filtro.' });
      return;
    }

    lista.innerHTML = '<div class="sgc-acc-grid">' + filtradas.map(function (c) {
      var nivel = nivelAccesoRol_(c.rol_sgc);
      var rolTxt = etiquetaRolAcceso_(c.rol_sgc, roles);
      var areaTxt = c.area_id ? (areaNombre[c.area_id] || c.area_id) : '';
      var dias = diasHastaAcceso_(c.vigencia_hasta);
      var vigChip = '';
      if (dias !== null) {
        var vTono = dias < 0 ? 'critico' : (dias <= 30 ? 'alerta' : 'neutro');
        var vTxt = dias < 0 ? ('Venció ' + fechaCorta_(c.vigencia_hasta)) : ('Vence ' + fechaCorta_(c.vigencia_hasta));
        vigChip = '<span class="sgc-acc-chip sgc-acc-chip--' + vTono + '">' + Componentes.escaparHtml(vTxt) + '</span>';
      }
      return '<div class="sgc-acc-card sgc-acc-card--' + nivel + '">' +
        '<span class="sgc-acc-card__avatar sgc-acc-card__avatar--' + nivel + '">' + Componentes.escaparHtml(inicialesAcceso_(c.nombre)) + '</span>' +
        '<div class="sgc-acc-card__info">' +
          '<div class="sgc-acc-card__nombre">' + Componentes.escaparHtml(c.nombre) + '</div>' +
          '<div class="sgc-acc-card__email">' + Componentes.escaparHtml(c.email) + '</div>' +
          '<div class="sgc-acc-card__meta">' +
            '<span class="sgc-acc-chip sgc-acc-chip--' + nivel + '">' + Componentes.escaparHtml(rolTxt) + '</span>' +
            (areaTxt ? '<span class="sgc-acc-chip">' + Componentes.escaparHtml(areaTxt) + '</span>' : '') +
            vigChip +
          '</div>' +
        '</div>' +
        '<div class="sgc-acc-card__acciones">' +
          '<button type="button" class="sigso-boton sigso-boton--secundario js-acc-editar" data-email="' + Componentes.escaparHtml(c.email) + '">' + (c.rol_sgc ? 'Cambiar rol' : 'Asignar rol') + '</button>' +
          '<button type="button" class="sigso-boton sigso-boton--sutil js-acc-previa" data-email="' + Componentes.escaparHtml(c.email) + '">¿Qué ve?</button>' +
          (c.rol_id ? '<button type="button" class="sigso-boton sigso-boton--sutil js-acc-quitar" data-rolid="' + Componentes.escaparHtml(c.rol_id) + '" data-email="' + Componentes.escaparHtml(c.email) + '">Quitar</button>' : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';

    lista.querySelectorAll('.js-acc-editar').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var c = cuentas.filter(function (x) { return x.email === btn.getAttribute('data-email'); })[0];
        abrirFormularioAcceso_(c, data);
      });
    });
    lista.querySelectorAll('.js-acc-previa').forEach(function (btn) {
      btn.addEventListener('click', function () { previsualizarAcceso_(btn.getAttribute('data-email'), data); });
    });
    lista.querySelectorAll('.js-acc-quitar').forEach(function (btn) {
      btn.addEventListener('click', function () { quitarAcceso_(btn.getAttribute('data-rolid'), btn.getAttribute('data-email')); });
    });
  }

  // Matriz de distribución: personas x documentos vigentes, con el estado de
  // cada celda. Responde "¿quién puede ver y quién ya confirmó?" de un
  // vistazo -- evidencia de distribución (ISO §7.5.3) sin armarla a mano.
  var CELDA_MATRIZ_TXT = { confirmado: '✓', pendiente: '○', no: '—', na: '·' };
  var CELDA_MATRIZ_CLASE = { confirmado: 'sgc-celda--ok', pendiente: 'sgc-celda--pendiente', no: 'sgc-celda--no', na: 'sgc-celda--na' };
  var CELDA_MATRIZ_TITULO = {
    confirmado: 'Puede verlo y ya confirmó la lectura', pendiente: 'Puede verlo, aún no confirma',
    no: 'No le corresponde', na: 'Puede verlo (no requiere confirmación)'
  };

  function pintarMatriz_(cont, data) {
    var docs = data.documentos || [];
    var personas = data.personas || [];
    var intro = barraSecciones_() + subNavAccesos_() +
      '<p class="sigso-ayuda">Quién puede ver y quién ya confirmó cada documento vigente. Es la evidencia de distribución para la auditoría (ISO §7.5.3).</p>';

    if (!docs.length || !personas.length) {
      cont.innerHTML = intro + Componentes.alerta('Aún no hay documentos vigentes o personal con cuenta para mostrar en la matriz.', 'info');
      wireSecciones_(cont); wireSubNavAccesos_(cont);
      return;
    }

    var encabezado = '<th>Persona</th>' + docs.map(function (d) {
      return '<th title="' + Componentes.escaparHtml(d.nombre) + '"><span class="sgc-matriz-codigo">' + Componentes.escaparHtml(d.codigo) + '</span></th>';
    }).join('');

    var filas = personas.map(function (p) {
      var celdas = (p.celdas || []).map(function (c) {
        return '<td class="sgc-celda ' + (CELDA_MATRIZ_CLASE[c.estado] || '') + '" title="' + Componentes.escaparHtml(CELDA_MATRIZ_TITULO[c.estado] || '') + '">' +
          (CELDA_MATRIZ_TXT[c.estado] || '') + '</td>';
      }).join('');
      return '<tr><td>' + Componentes.escaparHtml(p.nombre) + '</td>' + celdas + '</tr>';
    }).join('');

    var leyenda = '<div class="sgc-leyenda">' +
      '<span><span class="sgc-celda sgc-celda--ok">✓</span> Confirmó la lectura</span>' +
      '<span><span class="sgc-celda sgc-celda--pendiente">○</span> Puede verlo, falta confirmar</span>' +
      '<span><span class="sgc-celda sgc-celda--na">·</span> Puede verlo (sin confirmación exigida)</span>' +
      '<span><span class="sgc-celda sgc-celda--no">—</span> No le corresponde</span>' +
      '</div>';

    cont.innerHTML = intro +
      '<div class="sgc-matriz-scroll"><table class="sigso-tabla sgc-matriz"><thead><tr>' + encabezado + '</tr></thead><tbody>' + filas + '</tbody></table></div>' +
      leyenda;
    wireSecciones_(cont);
    wireSubNavAccesos_(cont);
  }

  // Confidenciales: cada documento SELECCION y exactamente quién está en su
  // lista -- para revisar de un vistazo que nadie sobra.
  function pintarConfidenciales_(cont, docs) {
    docs = docs || [];
    var intro = barraSecciones_() + subNavAccesos_() +
      '<p class="sigso-ayuda">Documentos de acceso restringido a personas específicas, y quién está en cada lista.</p>';

    if (!docs.length) {
      cont.innerHTML = intro + Componentes.alerta('No hay documentos con visibilidad restringida a personas específicas.', 'info');
      wireSecciones_(cont); wireSubNavAccesos_(cont);
      return;
    }

    var tarjetas = docs.map(function (d) {
      var lista = (d.destinatarios || []).length
        ? '<ul class="sgc-items">' + d.destinatarios.map(function (x) {
            return '<li>' + Componentes.escaparHtml(x.nombre) + ' <span class="sigso-ayuda">(' + Componentes.escaparHtml(x.email) + ')</span></li>';
          }).join('') + '</ul>'
        : '<p class="sigso-ayuda">Sin destinatarios asignados todavía.</p>';
      return '<div class="sgc-card-confidencial">' +
        '<h4 class="sgc-subtitulo"><span class="sgc-matriz-codigo">' + Componentes.escaparHtml(d.codigo) + '</span> ' + Componentes.escaparHtml(d.nombre) +
        (d.estado === 'OBSOLETO' ? ' ' + Componentes.badge('Obsoleto', 'neutro') : '') + '</h4>' +
        '<p class="sigso-ayuda">' + d.destinatarios.length + ' persona(s) con acceso</p>' + lista +
        '</div>';
    }).join('');

    cont.innerHTML = intro + '<div class="sgc-confidenciales-grid">' + tarjetas + '</div>';
    wireSecciones_(cont);
    wireSubNavAccesos_(cont);
  }

  function abrirFormularioAcceso_(cuenta, data) {
    var roles = data.roles || [];
    var areas = data.areas || [];
    var fondo = document.createElement('div');
    fondo.className = 'sigso-modal-fondo';
    fondo.innerHTML =
      '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
        '<h3 class="sigso-modal__titulo">Rol de ' + Componentes.escaparHtml(cuenta.nombre) + '</h3>' +
        '<p class="sigso-ayuda">' + Componentes.escaparHtml(cuenta.email) + '</p>' +
        '<form id="form-acc">' +
          '<label class="sigso-campo"><span class="sigso-campo__label">Rol en el SGC</span>' +
            '<select id="acc-rol" class="sigso-select">' +
              '<option value="">Sin rol (solo documentos generales)</option>' +
              roles.map(function (r) {
                return '<option value="' + r.clave + '"' + (r.clave === cuenta.rol_sgc ? ' selected' : '') + '>' +
                  Componentes.escaparHtml(r.etiqueta) + '</option>';
              }).join('') +
            '</select>' +
          '</label>' +
          '<label class="sigso-campo"><span class="sigso-campo__label">Área (define qué documentos "de área" ve)</span>' +
            '<select id="acc-area" class="sigso-select">' +
              '<option value="">Sin área</option>' +
              areas.map(function (a) {
                return '<option value="' + Componentes.escaparHtml(a.area_id) + '"' + (a.area_id === cuenta.area_id ? ' selected' : '') + '>' +
                  Componentes.escaparHtml(a.nombre) + '</option>';
              }).join('') +
            '</select>' +
          '</label>' +
          Componentes.campoTexto({ id: 'acc-vigencia', label: 'Vence el (solo para auditor externo, opcional)', tipo: 'date', valor: fechaISO_(cuenta.vigencia_hasta) }) +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cancelar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
            Componentes.boton({ texto: 'Guardar', tipo: 'submit' }) +
          '</div>' +
        '</form>' +
      '</div>';
    var cerrar = montarModal_(fondo);

    document.getElementById('form-acc').addEventListener('submit', function (evento) {
      evento.preventDefault();
      var rol = document.getElementById('acc-rol').value;
      if (!rol) {
        // "Sin rol" = quitar el acceso SGC (vuelve a ver solo lo general).
        if (!cuenta.rol_id) { cerrar(); return; }
        api_('gestionarRolSgc', { accion: 'quitar', rol_id: cuenta.rol_id }).then(function (r) {
          if (!r || !r.ok) { Componentes.aviso({ texto: (r && r.message) || 'No se pudo quitar.', tipo: 'error' }); return; }
          cerrar(); cargarAccesos_();
        });
        return;
      }
      api_('gestionarRolSgc', {
        usuario_email: cuenta.email,
        rol_sgc: rol,
        area_id: document.getElementById('acc-area').value,
        vigencia_hasta: document.getElementById('acc-vigencia').value
      }).then(function (r) {
        if (!r || !r.ok) { Componentes.aviso({ texto: (r && r.message) || 'No se pudo guardar.', tipo: 'error' }); return; }
        cerrar(); cargarAccesos_();
      });
    });
  }

  function quitarAcceso_(rolId, email) {
    Componentes.confirmar({
      titulo: 'Quitar acceso',
      mensaje: 'La persona volverá a ver solo los documentos de acceso general. No se borra nada de su ficha.'
    }).then(function (ok) {
      if (!ok) return;
      api_('gestionarRolSgc', { accion: 'quitar', rol_id: rolId }).then(function (r) {
        if (!r || !r.ok) { Componentes.aviso({ texto: (r && r.message) || 'No se pudo quitar.', tipo: 'error' }); return; }
        cargarAccesos_();
      });
    });
  }

  var SECCION_ACCESO_ETIQUETA = {
    documentos: 'Documentos', personas: 'Personas (su ficha)', capacitaciones: 'Capacitaciones',
    nc: 'No conformidades', auditorias: 'Auditorías', quejas: 'Quejas', proveedores: 'Proveedores',
    revision: 'Revisión por la dirección', objetivos: 'Objetivos de calidad', cobertura: 'Cobertura ISO'
  };

  function previsualizarAcceso_(email, data) {
    api_('previsualizarAccesoSgc', { email: email }).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        Componentes.aviso({ texto: (respuesta && respuesta.message) || 'No se pudo previsualizar.', tipo: 'error' });
        return;
      }
      var d = respuesta.data;
      var secc = d.secciones || {};
      var seccionesTxt = Object.keys(SECCION_ACCESO_ETIQUETA)
        .filter(function (k) { return secc[k] === true; })
        .map(function (k) { return SECCION_ACCESO_ETIQUETA[k]; });

      // v10.0 "Centro de Control": si la cuenta ademas tiene un rol de SIGSO
      // que le da lectura total (ADM/GERENCIA), lo de abajo se queda corto
      // -- se avisa aparte en vez de simularlo como si no existiera.
      var avisoAmplio = d.acceso_amplio_sistema
        ? Componentes.alerta('Esta cuenta además es ' + (d.rol_sistema === 'ADM' ? 'Administradora' : 'Gerencia') +
            ' de SIGSO: en la práctica ve TODO el SGC, más allá de lo que muestra esta previsualización.', 'aviso')
        : '';

      var docs = (d.documentos || []).length
        ? '<ul class="sgc-items">' + d.documentos.map(function (x) {
            var estadoAcuse = x.requiere_acuse
              ? (x.confirmado ? Componentes.badge('Confirmado', 'ok') : Componentes.badge('Sin confirmar', 'alerta'))
              : '';
            return '<li>' + Componentes.escaparHtml(x.codigo) + ' — ' + Componentes.escaparHtml(x.nombre) +
              (x.confidencial ? ' ' + Componentes.badge('Confidencial', 'info') : '') + ' ' + estadoAcuse +
              ' <span class="sigso-ayuda">(' + Componentes.escaparHtml(x.visibilidad) + ')</span></li>';
          }).join('') + '</ul>'
        : '<p class="sigso-ayuda">Ningún documento (solo vería lo que se marque como acceso general o se le asigne).</p>';

      var descargas = (d.descargas_recientes || []).length
        ? '<ul class="sgc-items">' + d.descargas_recientes.map(function (l) {
            return '<li>' + fechaCorta_(l.timestamp) + ' — ' + Componentes.escaparHtml(l.detalle) + '</li>';
          }).join('') + '</ul>'
        : '<p class="sigso-ayuda">Sin descargas registradas.</p>';

      var fondo = document.createElement('div');
      fondo.className = 'sigso-modal-fondo';
      fondo.innerHTML =
        '<div class="sigso-modal sigso-modal--ancho" role="dialog" aria-modal="true">' +
          '<h3 class="sigso-modal__titulo">Qué vería ' + Componentes.escaparHtml(email) + '</h3>' +
          avisoAmplio +
          '<dl class="sgc-ficha">' +
            campoFicha_('Rol en el SGC', etiquetaRolAcceso_(d.rol_sgc, (data && data.roles) || [])) +
            campoFicha_('Fichas de personas', d.personas_scope) +
            campoFicha_('Secciones que puede abrir', seccionesTxt.join(' · ')) +
            campoFicha_('Documentos por confirmar', String(d.pendientes_acuse || 0)) +
          '</dl>' +
          '<h4 class="sgc-subtitulo">Documentos que vería (' + (d.total_documentos || 0) + ')</h4>' +
          docs +
          '<h4 class="sgc-subtitulo">Últimas descargas</h4>' +
          descargas +
          '<div class="sigso-modal__acciones">' +
            Componentes.boton({ texto: 'Cerrar', variante: 'sutil', clase: 'js-sgc-cancelar', tipo: 'button' }) +
          '</div>' +
        '</div>';
      montarModal_(fondo);
    });
  }

  // --- utilidades -------------------------------------------------------------

  function montarModal_(fondo) {
    function cerrar() {
      document.removeEventListener('keydown', alTeclado);
      if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
    }
    function alTeclado(ev) { if (ev.key === 'Escape') cerrar(); }
    fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(); });
    document.addEventListener('keydown', alTeclado);
    document.body.appendChild(fondo);
    fondo.querySelector('.js-sgc-cancelar').addEventListener('click', cerrar);
    return cerrar;
  }

  // El dataURL viene como "data:<mime>;base64,<contenido>"; el backend solo
  // necesita la parte base64 (mismo criterio que formulario.js/novedades.js).
  function leerArchivoBase64Sgc_(archivo) {
    return new Promise(function (resolver, rechazar) {
      var lector = new FileReader();
      lector.onload = function () { resolver(String(lector.result).split(',')[1]); };
      lector.onerror = function () { rechazar(new Error('No se pudo leer el archivo.')); };
      lector.readAsDataURL(archivo);
    });
  }

  // Los 4 formularios que suben un archivo (documento nuevo, nueva versión,
  // editar con archivo, documento de persona) atrapaban CUALQUIER falla de
  // leerArchivoBase64Sgc_/api_ con el mismo aviso generico, descartando el
  // motivo real -- justo el que api.js (v14.0) ya distingue (timeout /
  // respuesta no-JSON / lectura de archivo). Aca se recupera ese motivo en
  // vez de taparlo, y solo se cae al generico cuando el error crudo del
  // navegador (Failed to fetch, etc.) no le diria nada util a quien lo lee.
  function mensajeErrorSubidaSgc_(err) {
    var msg = err && err.message ? String(err.message) : '';
    if (msg && !/^(failed to fetch|networkerror|load failed|typeerror)/i.test(msg)) return msg;
    return 'No se pudo leer o subir el archivo. Revisa tu conexión e inténtalo de nuevo.';
  }

  function descargarBase64Sgc_(base64, nombre, mime) {
    var bytes = atob(base64);
    var arr = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    var blob = new Blob([arr], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nombre || 'documento';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function fechaCorta_(iso) {
    if (!iso) return '—';
    var f = new Date(iso);
    if (isNaN(f.getTime())) return '—';
    return ('0' + f.getUTCDate()).slice(-2) + '/' + ('0' + (f.getUTCMonth() + 1)).slice(-2) + '/' + f.getUTCFullYear();
  }

  function fechaISO_(iso) {
    if (!iso) return '';
    var f = new Date(iso);
    if (isNaN(f.getTime())) return '';
    return f.getUTCFullYear() + '-' + ('0' + (f.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + f.getUTCDate()).slice(-2);
  }

  // Un textarea "uno por línea" -> arreglo sin líneas vacías. Se usa para
  // los items del descriptor y para las personas entrevistadas de auditoría.
  function lineasNoVacias_(texto) {
    return String(texto || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // ==========================================================================
  // v12.2 — CENTRO DE REPORTES DEL SGC (sobre el motor de reportes.js)
  //
  // En la v12.0 este catálogo y su renderizado vivían acá enteros. Ahora sólo
  // queda lo que es PROPIO de Calidad: qué reportes hay y cómo se arma cada
  // uno. Los filtros, la exportación y las piezas visuales (tendencia,
  // ranking, comparación) las pone SigsoReportes, y las comparte con los
  // demás módulos.
  //
  // LA REGLA NO CAMBIA: cada reporte declara de qué dato real sale. Si el dato
  // no existe, el reporte aparece marcado y dice qué le falta. Nunca un
  // gráfico con datos inventados: acá lo que se muestra es evidencia frente a
  // un auditor.
  //
  // CORRECCIÓN DE LA v12.0: entonces marqué "tendencias de indicadores" como
  // pendiente por falta de datos. Era un error de auditoría mío:
  // listarIndicadoresSgc YA devuelve, por indicador, todas sus lecturas con
  // período, valor, veredicto y meta. El reporte se construye sin tocar el
  // backend, y acá está.
  var REPORTES_SGC = [
    { grupo: 'Cumplimiento', icono: 'escudo', reportes: [
      { id: 'cump-general', nombre: 'Cumplimiento general', tipo: 'CUMPLIMIENTO', estado: 'LISTO',
        desc: 'Indicador interno de gestión y su desglose por capítulo de la norma.',
        fuente: 'resumenTableroSgc', filtros: [] },
      { id: 'cump-clausula', nombre: 'Por cláusula', tipo: 'DETALLE', estado: 'LISTO',
        desc: 'Las 28 cláusulas del catálogo con su estado y qué evidencia las sustenta.',
        fuente: 'listarMatrizCoberturaSgc', filtros: ['estado'] },
      { id: 'rank-capitulo', nombre: 'Ranking de capítulos', tipo: 'RANKING', estado: 'LISTO',
        desc: 'Qué capítulos de la norma van más avanzados y cuáles quedaron atrás.',
        fuente: 'resumenTableroSgc', filtros: [] },
      { id: 'cump-area', nombre: 'Por área', tipo: 'CUMPLIMIENTO', estado: 'PENDIENTE',
        desc: 'Cumplimiento desagregado por área de la organización.',
        falta: 'Las cláusulas no se atribuyen a un área: la cobertura se mide por evidencia del sistema, no por unidad organizacional.' },
      { id: 'cump-proceso', nombre: 'Por proceso', tipo: 'CUMPLIMIENTO', estado: 'PENDIENTE',
        desc: 'Cumplimiento de cada proceso del mapa (§4.4).',
        falta: 'Requiere enlazar cada cláusula con los procesos que la sustentan. Hoy sólo los indicadores tienen proceso_id.' },
      { id: 'cump-responsable', nombre: 'Por responsable', tipo: 'CUMPLIMIENTO', estado: 'PENDIENTE',
        desc: 'Qué tiene pendiente cada responsable del SGC.',
        falta: 'Los 14 procesos del mapa están sin responsable asignado (ver REVISAR de la carga inicial).' }
    ] },

    { grupo: 'Indicadores y objetivos', icono: 'grafico', reportes: [
      { id: 'ind-tendencia', nombre: 'Tendencia de un indicador', tipo: 'TENDENCIA', estado: 'LISTO',
        desc: 'Cómo evolucionó un indicador período a período, contra su meta.',
        fuente: 'listarIndicadoresSgc', filtros: [] },
      { id: 'ind-objetivos', nombre: 'Objetivos de calidad', tipo: 'ESTADO', estado: 'LISTO',
        desc: 'Meta, mediciones del año y si cumple.',
        fuente: 'listarObjetivosSgc', seccion: 'objetivos' },
      { id: 'ind-proceso', nombre: 'Indicadores de proceso', tipo: 'ESTADO', estado: 'LISTO',
        desc: 'Indicadores §9.1.1 con su última lectura y evaluación.',
        fuente: 'listarIndicadoresSgc', seccion: 'indicadores' }
    ] },

    { grupo: 'Documentación', icono: 'documento', reportes: [
      { id: 'doc-estado', nombre: 'Estado documental', tipo: 'ESTADO', estado: 'LISTO',
        desc: 'Vigentes, de origen externo, próximos a revisión y vencidos.',
        fuente: 'resumenTableroSgc', filtros: [] },
      { id: 'doc-distribucion', nombre: 'Distribución documental', tipo: 'DETALLE', estado: 'LISTO',
        desc: 'Quién debe acusar cada documento controlado y quién ya lo hizo.',
        fuente: 'getMatrizDistribucionSgc', seccion: 'accesos' },
      { id: 'doc-acuses', nombre: 'Cumplimiento de acuses', tipo: 'CUMPLIMIENTO', estado: 'LISTO',
        desc: 'Por documento: cuántos destinatarios confirmaron lectura.',
        fuente: 'getCumplimientoDocumentoSgc', seccion: 'documentos' }
    ] },

    { grupo: 'Auditorías y mejora', icono: 'lupa', reportes: [
      { id: 'aud-estado', nombre: 'Auditorías y hallazgos', tipo: 'ESTADO', estado: 'LISTO',
        desc: 'Programadas, ejecutadas y hallazgos abiertos.',
        fuente: 'listarAuditoriasSgc', seccion: 'auditorias' },
      { id: 'nc-abiertas', nombre: 'No conformidades', tipo: 'ESTADO', estado: 'LISTO',
        desc: 'Abiertas por etapa del PRO-06, con acciones y verificación de eficacia.',
        fuente: 'listarNcSgc', seccion: 'nc' },
      { id: 'quejas-estado', nombre: 'Quejas', tipo: 'ESTADO', estado: 'LISTO',
        desc: 'Recibidas, en investigación y resueltas.',
        fuente: 'listarQuejasSgc', seccion: 'quejas' }
    ] },

    { grupo: 'Riesgos', icono: 'alerta', reportes: [
      { id: 'riesgo-nivel', nombre: 'Riesgos por nivel', tipo: 'ESTADO', estado: 'LISTO',
        desc: 'Magnitud y banda de cada riesgo, antes y después de los controles.',
        fuente: 'listarRiesgosSgc', seccion: 'riesgos' },
      { id: 'riesgo-evolucion', nombre: 'Evolución del riesgo', tipo: 'TENDENCIA', estado: 'PENDIENTE',
        desc: 'Cómo cambió la valoración a lo largo del tiempo.',
        falta: 'SGC_RIESGOS guarda la valoración VIGENTE, no su historia. A diferencia de los indicadores, acá no hay tabla de lecturas: requiere versionar cada revisión de la matriz.' }
    ] },

    { grupo: 'Personas', icono: 'persona', reportes: [
      { id: 'per-competencia', nombre: 'Competencia (§7.2)', tipo: 'CUMPLIMIENTO', estado: 'LISTO',
        desc: 'Quién tiene descriptor vigente y evaluación registrada.',
        fuente: 'listarPersonasSgc', seccion: 'personas' },
      { id: 'per-induccion', nombre: 'Inducciones (§7.3)', tipo: 'CUMPLIMIENTO', estado: 'LISTO',
        desc: 'Avance de los cinco ítems de inducción, persona por persona.',
        fuente: 'listarPersonasSgc', seccion: 'personas' },
      { id: 'per-capacitacion', nombre: 'Capacitación', tipo: 'ESTADO', estado: 'LISTO',
        desc: 'Cursos realizados, asistencia y verificación de eficacia.',
        fuente: 'listarCapacitacionesSgc', seccion: 'capacitaciones' }
    ] },

    { grupo: 'Dirección', icono: 'estado', reportes: [
      { id: 'dir-revision', nombre: 'Revisión por la dirección', tipo: 'ESTADO', estado: 'LISTO',
        desc: 'Las entradas del §9.3 reunidas para el acta.',
        fuente: 'getResumenRevisionSgc', seccion: 'revision' },
      { id: 'dir-proveedores', nombre: 'Proveedores', tipo: 'ESTADO', estado: 'LISTO',
        desc: 'Evaluación y reevaluación de proveedores críticos (§8.4).',
        fuente: 'listarProveedoresSgc', seccion: 'proveedores' }
    ] },

    { grupo: 'Comparaciones', icono: 'lista', reportes: [
      { id: 'comp-periodo', nombre: 'Cobertura: período actual vs anterior', tipo: 'COMPARACION', estado: 'PENDIENTE',
        desc: 'Cómo cambió el cumplimiento respecto del período pasado.',
        falta: 'La cobertura se calcula SIEMPRE contra el presente y no se archiva. Requiere guardar una foto periódica del estado del SGC (una fila por capítulo y mes).' }
    ] }
  ];

  var reporteAbierto_ = null;
  var filtrosReporte_ = {};

  function registrarReportesSgc_() {
    if (!window.SigsoReportes || registrarReportesSgc_.hecho) return;
    SigsoReportes.registrar('calidad', {
      titulo: 'Centro de reportes del SGC',
      nota: 'Cada reporte declara de dónde sale su dato. Los marcados como ' +
        '"Requiere desarrollo" no se muestran vacíos ni con datos de ejemplo: ' +
        'se indica qué información habría que empezar a guardar para construirlos.',
      grupos: REPORTES_SGC
    });
    registrarReportesSgc_.hecho = true;
  }

  function cargarReportes_() {
    var cont = panelSgc_();
    if (!cont) return;
    registrarReportesSgc_();
    if (!window.SigsoReportes) {
      cont.innerHTML = barraSecciones_() +
        Componentes.alerta('El motor de reportes no está disponible.', 'error');
      wireSecciones_(cont);
      return;
    }
    if (reporteAbierto_) { abrirReporteSgc_(cont); return; }

    SigsoReportes.pintarCatalogo({
      contenedor: cont,
      modulo: 'calidad',
      encabezado: barraSecciones_(),
      onAbrir: function (id) { reporteAbierto_ = id; filtrosReporte_ = {}; cargarReportes_(); },
      onIrASeccion: function (seccion) { irASeccion_(seccion, ''); }
    });
    wireSecciones_(cont);
  }

  // --- Los reportes que se arman ACÁ (el resto navega a su sección) ---------
  var ACCION_POR_REPORTE_SGC = {
    'cump-general': 'resumenTableroSgc',
    'rank-capitulo': 'resumenTableroSgc',
    'doc-estado': 'resumenTableroSgc',
    'cump-clausula': 'listarMatrizCoberturaSgc',
    'ind-tendencia': 'listarIndicadoresSgc'
  };

  function abrirReporteSgc_(cont) {
    var r = SigsoReportes.buscarReporte('calidad', reporteAbierto_);
    var accion = ACCION_POR_REPORTE_SGC[reporteAbierto_];
    if (!r || !accion) { reporteAbierto_ = null; cargarReportes_(); return; }

    cont.innerHTML = Componentes.cargando('Armando el reporte...');
    api_(accion, {}).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = barraSecciones_(r.nombre) +
          Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar el reporte.', 'error');
        wireSecciones_(cont);
        return;
      }
      pintarReporteSgc_(cont, r, respuesta.data);
    }).catch(function () {
      cont.innerHTML = barraSecciones_(r.nombre) + Componentes.alerta('No se pudo conectar.', 'error');
      wireSecciones_(cont);
    });
  }

  function pintarReporteSgc_(cont, r, data) {
    var cuerpo = '';
    var opcionesFiltro = {};

    if (r.id === 'cump-general') cuerpo = cuerpoCumplimientoGeneral_(data);
    else if (r.id === 'rank-capitulo') cuerpo = cuerpoRankingCapitulos_(data);
    else if (r.id === 'doc-estado') cuerpo = cuerpoEstadoDocumental_(data);
    else if (r.id === 'cump-clausula') {
      opcionesFiltro.estado = [
        { valor: 'COMPLETO', texto: 'Completo' }, { valor: 'PARCIAL', texto: 'Parcial' },
        { valor: 'FALTANTE', texto: 'Faltante' }, { valor: 'NO_APLICA', texto: 'No aplica' }
      ];
      cuerpo = cuerpoClausulas_(data, filtrosReporte_);
    } else if (r.id === 'ind-tendencia') {
      cuerpo = cuerpoTendenciaIndicador_(data, filtrosReporte_);
    }

    // v15.0: el reporte SÍ va en las migas. En la v13 se quitó porque el
    // sidebar listaba los cinco reportes y el tramo se duplicaba; ahora el
    // árbol tiene una sola entrada ("Reportes"), así que sin este tramo no
    // habría forma de saber en qué reporte estás parado.
    // v13.2: el reporte se arma como DOCUMENTO -- con cabecera identificable,
    // para que al mandarlo a Gerencia se sepa de que es, de que periodo y
    // quien lo emitio sin tener que explicarlo por correo.
    cont.innerHTML = barraSecciones_(r.nombre) +
      SigsoReportes.barraAcciones({}) +
      SigsoReportes.cabeceraDocumento({
        titulo: r.nombre,
        subtitulo: r.desc,
        modulo: 'Calidad — Sistema de Gestión ISO 9001',
        codigo: 'SIGSO-REP-' + String(r.id).toUpperCase(),
        generadoPor: (window.SIGSO_USUARIO && SIGSO_USUARIO.nombre) || '',
        filtros: SigsoReportes.filtrosParaCabecera(r, opcionesFiltro, filtrosReporte_)
      }) +
      SigsoReportes.pintarFiltros(r, opcionesFiltro, filtrosReporte_) +
      cuerpo +
      SigsoReportes.pieDocumento();

    wireSecciones_(cont);
    SigsoReportes.wireAcciones(cont, {
      nombreArchivo: 'sigso-calidad-' + r.id,
      onVolver: function () { reporteAbierto_ = null; filtrosReporte_ = {}; cargarReportes_(); }
    });
    SigsoReportes.alAplicarFiltros(cont, function (valores) {
      filtrosReporte_ = valores;
      // Los filtros de estos reportes se aplican en el cliente sobre datos ya
      // traídos: no se vuelve a pedir al backend por cambiar un select.
      pintarReporteSgc_(cont, r, data);
    });
  }

  // --- Cuerpos ---------------------------------------------------------------
  function cuerpoCumplimientoGeneral_(data) {
    var salud = data.salud || {};
    var c = data.conteos || {};
    return SigsoReportes.kpis([
      { etiqueta: 'Indicador interno', valor: (salud.pct || 0) + '%' },
      { etiqueta: 'Cláusulas aplicables', valor: salud.aplicables || 0 },
      { etiqueta: 'No conformidades abiertas', valor: c.nc_abiertas || 0 },
      { etiqueta: 'Documentos vigentes', valor: c.documentos_vigentes || 0 }
    ]) +
    Componentes.alerta(salud.aviso || '', 'info') +
    '<h3>Por capítulo de la norma</h3>' +
    SigsoReportes.tabla([
      { campo: 'capitulo', titulo: 'Capítulo' },
      { campo: 'aplicables', titulo: 'Aplicables', alinear: 'derecha' },
      { campo: 'completo', titulo: 'Completas', alinear: 'derecha' },
      { campo: 'parcial', titulo: 'Parciales', alinear: 'derecha' },
      { campo: 'pct', titulo: 'Avance', alinear: 'derecha' }
    ], (salud.capitulos || []).map(function (cap) {
      return {
        capitulo: cap.numero + ' ' + cap.titulo,
        aplicables: cap.aplicables, completo: cap.completo,
        parcial: cap.parcial, pct: cap.pct + '%'
      };
    }));
  }

  function cuerpoRankingCapitulos_(data) {
    var caps = ((data.salud || {}).capitulos || []).slice().sort(function (a, b) { return b.pct - a.pct; });
    return SigsoReportes.ranking(caps.map(function (c) {
      return { etiqueta: c.numero + ' ' + c.titulo, valor: c.pct, texto: c.pct + '%' };
    }), { vacio: 'Todavía no hay cláusulas evaluadas.' }) +
    '<h3>Detalle</h3>' +
    SigsoReportes.tabla([
      { campo: 'capitulo', titulo: 'Capítulo' },
      { campo: 'pct', titulo: 'Avance', alinear: 'derecha' },
      { campo: 'faltan', titulo: 'Cláusulas sin completar', alinear: 'derecha' }
    ], caps.map(function (c) {
      return {
        capitulo: c.numero + ' ' + c.titulo,
        pct: c.pct + '%',
        faltan: (c.aplicables || 0) - (c.completo || 0)
      };
    }));
  }

  function cuerpoEstadoDocumental_(data) {
    var c = data.conteos || {};
    var alertasDoc = (data.alertas || []).filter(function (a) {
      return /document/i.test(a.titulo || '');
    });
    return SigsoReportes.kpis([
      { etiqueta: 'Vigentes', valor: c.documentos_vigentes || 0 },
      { etiqueta: 'De origen externo', valor: c.documentos_externos || 0 }
    ]) +
    '<h3>Alertas documentales</h3>' +
    SigsoReportes.tabla([
      { campo: 'titulo', titulo: 'Alerta' },
      { campo: 'severidad', titulo: 'Severidad' },
      { campo: 'total', titulo: 'Cuántos', alinear: 'derecha' }
    ], alertasDoc, { vacio: 'Ningún documento vencido ni próximo a revisión.' });
  }

  function cuerpoClausulas_(data, filtros) {
    var r = data.resumen || {};
    var clausulas = (data.clausulas || []).filter(function (c) {
      return !filtros.estado || c.estado === filtros.estado;
    });
    return SigsoReportes.kpis([
      { etiqueta: 'Aplicables', valor: r.aplicables || 0 },
      { etiqueta: 'Completas', valor: r.completo || 0 },
      { etiqueta: 'Parciales', valor: r.parcial || 0 },
      { etiqueta: 'Faltantes', valor: r.faltante || 0 }
    ]) +
    SigsoReportes.tabla([
      { campo: 'clausula', titulo: 'Cláusula' },
      { campo: 'estado', titulo: 'Estado', html: true },
      { campo: 'resumen', titulo: 'Qué hay hoy' }
    ], clausulas.map(function (c) {
      return {
        clausula: c.codigo + ' ' + c.titulo,
        estado: Componentes.badge(
          ETIQUETA_ESTADO_COBERTURA_REP[c.estado] || c.estado,
          TONO_ESTADO_COBERTURA_REP[c.estado] || 'neutro'),
        resumen: c.resumen || ''
      };
    }), { vacio: 'Ninguna cláusula en ese estado.' });
  }

  // El reporte que la v12.0 daba por imposible. Los datos ya venían en la
  // respuesta: cada indicador trae su lista de lecturas con período y valor.
  function cuerpoTendenciaIndicador_(data, filtros) {
    var indicadores = (data.indicadores || []).filter(function (i) {
      return (i.lecturas || []).length > 0;
    });
    if (!indicadores.length) {
      return Componentes.vacio(
        'Todavía no hay lecturas registradas. Una tendencia necesita al menos ' +
        'dos períodos medidos: registra las mediciones en Control y mejora › Indicadores.');
    }
    var elegido = indicadores.filter(function (i) { return i.indicador_id === filtros.indicador; })[0]
      || indicadores[0];
    var puntos = (elegido.lecturas || []).slice().sort(function (a, b) {
      return String(a.periodo).localeCompare(String(b.periodo));
    }).map(function (l) {
      return { etiqueta: l.periodo, valor: l.valor };
    });

    var selector = '<form class="sigso-rep-filtros" id="rep-filtros">' +
      '<label class="sigso-rep-filtro"><span>Indicador</span><select name="indicador">' +
      indicadores.map(function (i) {
        return '<option value="' + Componentes.escaparHtml(i.indicador_id) + '"' +
          (i.indicador_id === elegido.indicador_id ? ' selected' : '') + '>' +
          Componentes.escaparHtml(i.codigo + ' — ' + i.nombre) + '</option>';
      }).join('') +
      '</select></label>' +
      '<button type="submit" class="sigso-boton sigso-boton--secundario">Ver</button></form>';

    return selector +
      SigsoReportes.kpis([
        { etiqueta: 'Períodos medidos', valor: puntos.length },
        { etiqueta: 'Última lectura', valor: puntos.length ? puntos[puntos.length - 1].valor : '—' },
        { etiqueta: 'Meta', valor: elegido.meta_texto || elegido.meta_valor },
        { etiqueta: 'Pendientes de medir', valor: elegido.lecturas_pendientes || 0 }
      ]) +
      SigsoReportes.tendencia(puntos, {
        meta: elegido.meta_valor,
        titulo: 'Evolución de ' + elegido.codigo
      }) +
      SigsoReportes.tabla([
        { campo: 'periodo', titulo: 'Período' },
        { campo: 'valor', titulo: 'Valor', alinear: 'derecha' },
        { campo: 'veredicto', titulo: 'Resultado' },
        { campo: 'observaciones', titulo: 'Observaciones' }
      ], (elegido.lecturas || []).slice().sort(function (a, b) {
        return String(b.periodo).localeCompare(String(a.periodo));
      }));
  }

  var ETIQUETA_ESTADO_COBERTURA_REP = {
    COMPLETO: 'Completo', PARCIAL: 'Parcial', FALTANTE: 'Faltante', NO_APLICA: 'No aplica'
  };
  var TONO_ESTADO_COBERTURA_REP = {
    COMPLETO: 'ok', PARCIAL: 'alerta', FALTANTE: 'critico', NO_APLICA: 'neutro'
  };


  // v13.1: registro TEMPRANO del arbol. Antes esto pasaba recien al abrir
  // el modulo, asi que el sidebar no le dibujaba el chevron ni lo dejaba
  // desplegar hasta que entrabas una vez.
  if (window.SigsoNav) registrarArbolSgc_();
})();
