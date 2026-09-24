/**
 * proyectos-v2/nucleo.js — núcleo de Proyectos v2 (piloto del sistema visual
 * v2, clase raíz `.sx2`).
 *
 * Convive con proyectos.js (v1) en el MISMO contenedor (#proyectos-contenido):
 * el shell (plataforma.js) decide cuál de los dos pinta según la preferencia
 * del usuario (localStorage 'sigso_proyectos_v2'). v1 no se toca.
 *
 * Arquitectura v2 (ver plan): Portafolio → proyecto con 5 secciones
 * (Resumen · Trabajo · Equipo · Archivos · Seguimiento). Cada sección vive
 * en su propio archivo y se registra en PYv2.secciones[id] con:
 *   pintar(ctx)          -> string HTML
 *   alMontar(raiz, ctx)  -> engancha eventos (opcional)
 * ctx = { detalle, tareas, sala, bitacora, rendimiento, proyecto, U, PY }.
 *
 * Datos: los MISMOS endpoints que v1 (getDetalleCompletoProyecto,
 * listarBitacoraProyecto, obtenerRendimientoProyecto, listarProyectos,
 * getResumenPortafolioProyectos) -- v2 es otra forma de ver y operar lo
 * mismo, no otra fuente de verdad.
 */
(function () {
  'use strict';

  var U = UIv2;
  var CLAVE_PREF = 'sigso_proyectos_v2';

  var SECCIONES = [
    { id: 'resumen', texto: 'Resumen', icono: 'panel' },
    { id: 'trabajo', texto: 'Trabajo', icono: 'tareas' },
    { id: 'equipo', texto: 'Equipo', icono: 'equipo' },
    { id: 'archivos', texto: 'Archivos', icono: 'carpeta' },
    { id: 'seguimiento', texto: 'Seguimiento', icono: 'bandera' }
  ];

  // Semáforo de tarea (backend: Actividades.semaforoActividad_) -> tono v2.
  var TONO_SEMAFORO = {
    terminada: 'ok', 'al-dia': 'info', riesgo: 'alerta', atrasada: 'critico',
    bloqueada: 'hito', pendiente: 'neutro', revision: 'primario', cancelada: 'neutro'
  };
  var TONO_SALUD = { normal: 'ok', riesgo: 'alerta', critico: 'critico' };
  var ETIQUETA_SALUD = { normal: 'Normal', riesgo: 'En riesgo', critico: 'Crítico' };
  var ETIQUETA_ESTADO_PROYECTO = {
    PLANIFICACION: 'Planificación', ACTIVO: 'Activo', EN_PAUSA: 'En pausa',
    EN_REVISION: 'En revisión', CERRADO: 'Cerrado', CANCELADO: 'Cancelado'
  };

  var estado = {
    vista: 'portafolio',      // 'portafolio' | 'proyecto'
    proyectoId: null,
    seccion: 'resumen',
    datos: null,              // { detalle, tareas, sala, bitacora, rendimiento }
    portafolio: null,         // { proyectos, resumen }
    turno: 0                  // descarta respuestas de cargas viejas
  };

  // --- Utilidades compartidas por las secciones ------------------------------
  // Mismo camino que v1 (proyectos.js#api_): llamarApi decide Node o Apps
  // Script por nombre de acción (ACCIONES_PORTADAS_NODE en api.js). Nunca
  // rechaza: una pieza que falla devuelve {ok:false} y no tumba la pantalla.
  function api_(accion, datos) {
    return llamarApi((window.SIGSO_CONFIG || {}).BACKOFFICE_URL, accion, datos || {}).catch(function (err) {
      return { ok: false, message: (err && err.message) || 'No se pudo conectar.' };
    });
  }
  function contenedor() { return document.getElementById('proyectos-contenido'); }

  // Quién soy (para permisos de presentación: "¿trabajo esta tarea?"). El
  // backend sigue siendo la autoridad; esto solo decide qué botones mostrar.
  var miPerfil_ = null, miEmail_ = '';
  function cargarMiPerfil() {
    if (!miPerfil_) {
      miPerfil_ = api_('getMiPerfil', {}).then(function (r) {
        miEmail_ = (r && r.ok && r.data && r.data.email) ? String(r.data.email).trim().toLowerCase() : '';
        return miEmail_;
      });
    }
    return miPerfil_;
  }

  function fecha(valor, conAnio) {
    if (!valor) return '—';
    var d = new Date(valor);
    if (isNaN(d.getTime())) return '—';
    var dd = String(d.getUTCDate()).padStart(2, '0'), mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return dd + '/' + mm + (conAnio ? '/' + d.getUTCFullYear() : '');
  }
  // "Hoy" en la zona del negocio (America/Santiago), AAAA-MM-DD. NUNCA
  // toISOString().slice(0,10): eso es la fecha UTC, que en Chile ya es
  // "mañana" desde las 20-21 h, y el backend (que usa la zona de Chile)
  // lo rechaza como día futuro.
  function hoyClave() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: (window.SIGSO_CONFIG || {}).TIMEZONE || 'America/Santiago' }).format(new Date());
    } catch (e) {
      var d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
  }
  function diasHasta(valor) {
    if (!valor) return null;
    var d = new Date(valor);
    if (isNaN(d.getTime())) return null;
    return Math.round((d.getTime() - Date.now()) / 86400000);
  }
  // { email, nombre, cargo } con el Directorio de Personas si ya resolvió.
  function persona(email, nombreRespaldo) {
    var p = (window.SigsoDirectorio && email) ? SigsoDirectorio.persona(email) : null;
    return { email: email || '', nombre: (p && p.nombre) || nombreRespaldo || email || 'Sin asignar', cargo: (p && p.cargo) || '' };
  }
  function tonoTarea(a) { return TONO_SEMAFORO[a && a.semaforo] || 'neutro'; }

  function descargarBase64(base64, nombre, tipo) {
    var bin = atob(base64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
    var a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function aviso(texto, tipo) { if (window.Componentes && Componentes.aviso) Componentes.aviso({ texto: texto, tipo: tipo || 'info' }); }

  // --- Montaje ------------------------------------------------------------------
  function montarRaiz() {
    var c = contenedor();
    if (!c) return null;
    c.classList.add('sx2');
    var sec = document.getElementById('modulo-proyectos');
    if (sec) sec.classList.add('sigso-py-sin-cabecera-modulo');
    return c;
  }
  function desmontar() {
    var c = contenedor();
    if (c) { c.classList.remove('sx2'); c.innerHTML = ''; }
    var sec = document.getElementById('modulo-proyectos');
    if (sec) sec.classList.remove('sigso-py-sin-cabecera-modulo');
  }

  // --- Portafolio -------------------------------------------------------------
  function cargarPortafolio(silencioso) {
    var c = montarRaiz();
    if (!c) return;
    estado.vista = 'portafolio';
    estado.proyectoId = null;
    estado.datos = null;
    var turno = ++estado.turno;
    if (!silencioso || !estado.portafolio) {
      c.innerHTML = '<div class="sx2-pagina">' + PYv2.cabeceraPortafolio() + U.esqueleto('kpis', 5) + U.esqueleto('tarjetas', 6) + '</div>';
    }
    Promise.all([
      api_('listarProyectos', {}).catch(function () { return null; }),
      api_('getResumenPortafolioProyectos', {}).catch(function () { return null; })
    ]).then(function (r) {
      if (turno !== estado.turno) return;
      if (!r[0] || !r[0].ok) {
        c.innerHTML = '<div class="sx2-pagina">' + U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar el portafolio', texto: (r[0] && r[0].message) || 'Revisa tu conexión e inténtalo de nuevo.' }) + '</div>';
        return;
      }
      estado.portafolio = { proyectos: r[0].data || [], resumen: (r[1] && r[1].ok) ? r[1].data : null };
      pintar();
      resolverPersonasYFotos(juntarCorreosPortafolio(), turno);
    });
  }
  function juntarCorreosPortafolio() {
    var p = estado.portafolio || { proyectos: [] };
    var correos = [];
    p.proyectos.forEach(function (x) {
      correos.push(x.lider_email);
      (x.integrantes || []).forEach(function (i) { correos.push(i.email); });
    });
    ((p.resumen && p.resumen.carga_por_persona) || []).forEach(function (x) { correos.push(x.email); });
    return correos;
  }

  // --- Proyecto -----------------------------------------------------------------
  function abrirProyecto(id, opciones) {
    opciones = opciones || {};
    var c = montarRaiz();
    if (!c) return;
    var mismo = estado.proyectoId === id && estado.datos;
    estado.vista = 'proyecto';
    estado.proyectoId = id;
    if (!mismo) { estado.seccion = opciones.seccion || 'resumen'; estado.datos = null; }
    var turno = ++estado.turno;
    if (!opciones.silencioso || !mismo) {
      c.innerHTML = '<div class="sx2-pagina">' + U.esqueleto('kpis', 6) + U.esqueleto('tarjetas', 3) + '</div>';
      window.scrollTo(0, 0);
    }
    var data = { proyecto_id: id };
    Promise.all([
      api_('getDetalleCompletoProyecto', data),
      api_('listarBitacoraProyecto', data),
      api_('obtenerRendimientoProyecto', data),
      cargarMiPerfil()
    ]).then(function (r) {
      if (turno !== estado.turno) return;
      if (!r[0] || !r[0].ok) {
        c.innerHTML = '<div class="sx2-pagina">' + U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir el proyecto', texto: (r[0] && r[0].message) || 'Inténtalo de nuevo.',
          accion: U.boton({ texto: 'Volver al portafolio', icono: 'izquierda', clase: 'js-py2-portafolio' }) }) + '</div>';
        return;
      }
      estado.datos = {
        detalle: r[0].data.detalle,
        tareas: r[0].data.tareas || [],
        sala: r[0].data.sala || [],
        bitacora: (r[1] && r[1].ok) ? (r[1].data || []) : [],
        rendimiento: (r[2] && r[2].ok) ? r[2].data : null
      };
      pintar();
      resolverPersonasYFotos(juntarCorreosProyecto(), turno);
    });
  }
  function juntarCorreosProyecto() {
    var d = estado.datos;
    if (!d) return [];
    var correos = [d.detalle.proyecto.lider_email];
    (d.detalle.integrantes || []).forEach(function (i) { correos.push(i.usuario_email); });
    d.tareas.forEach(function (a) { correos.push(a.responsable_email); });
    return correos;
  }

  // Nombres/cargos (Directorio) y fotos (Perfil) llegan después del primer
  // pintado: se repinta una vez cuando ambos resolvieron, sin parpadeo de
  // esqueleto (la vista ya está en pantalla con iniciales).
  function resolverPersonasYFotos(correos, turno) {
    var limpios = correos.filter(Boolean);
    Promise.all([
      window.SigsoDirectorio ? SigsoDirectorio.resolver(limpios) : Promise.resolve(),
      U.precargarFotos(limpios)
    ]).then(function () {
      if (turno !== estado.turno) return;
      pintar({ sinAnimacion: true });
    });
  }

  // Recarga los datos del proyecto abierto (tras guardar algo) y repinta.
  function recargarProyecto() {
    if (estado.vista === 'proyecto' && estado.proyectoId) abrirProyecto(estado.proyectoId, { silencioso: true });
  }

  // --- Pintado -------------------------------------------------------------------
  function ctx() {
    var d = estado.datos || {};
    return {
      detalle: d.detalle, proyecto: d.detalle && d.detalle.proyecto, tareas: d.tareas || [], sala: d.sala || [],
      bitacora: d.bitacora || [], rendimiento: d.rendimiento, U: U, PY: PYv2
    };
  }

  function pintar(opts) {
    opts = opts || {};
    var c = montarRaiz();
    if (!c) return;
    var y = window.scrollY;
    if (estado.vista === 'portafolio') {
      if (!estado.portafolio) return;
      c.innerHTML = PYv2.pintarPortafolio(estado.portafolio);
      if (PYv2.alMontarPortafolio) PYv2.alMontarPortafolio(c, estado.portafolio);
    } else {
      if (!estado.datos) return;
      c.innerHTML = pintarProyecto_();
      var sec = PYv2.secciones[estado.seccion];
      var cuerpo = c.querySelector('.js-py2-cuerpo');
      if (sec && sec.alMontar && cuerpo) sec.alMontar(cuerpo, ctx());
    }
    if (opts.sinAnimacion) {
      c.querySelectorAll('.sx2-entra, .sx2-entra-escala').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    } else if (opts.soloCuerpo) {
      // Cambio de sección: la cabecera ya estaba en pantalla, no se re-anima.
      c.querySelectorAll('.sx2-entra, .sx2-entra-escala, [data-sx-arco]').forEach(function (el) {
        if (el.closest('.js-py2-cuerpo')) return;
        el.style.animation = 'none';
        el.style.transition = 'none';
      });
      window.scrollTo(0, y);
    }
    U.animar(c);
  }

  function pintarProyecto_() {
    var d = estado.datos, p = d.detalle.proyecto;
    var c = ctx();
    var sec = PYv2.secciones[estado.seccion];
    var cuerpo = sec ? sec.pintar(c) : seccionPendiente_();
    var avance = d.detalle.avance_pct;
    var contadores = { trabajo: d.tareas.filter(function (a) { return a.estado !== 'TERMINADA' && a.estado !== 'CANCELADA'; }).length, equipo: (d.detalle.integrantes || []).length };

    return '<div class="sx2-pagina">' +
      '<header class="sx2-cabecera sx2-entra">' +
        '<div class="sx2-flex" style="gap:16px;align-items:center;min-width:0">' +
          U.anillo(avance === null || avance === undefined ? 0 : avance, { tam: 64, grosor: 7, tono: TONO_SALUD[d.detalle.salud] || 'primario' }) +
          '<div class="sx2-cabecera__txt">' +
            '<span class="sx2-cabecera__migas"><button type="button" class="js-py2-portafolio">' + U.ico('izquierda', 12) + ' Proyectos</button>' +
              (p.codigo ? U.ico('derecha', 12) + '<span class="sx2-cortar">' + U.esc(p.codigo) + '</span>' : '') + '</span>' +
            '<h1 class="sx2-cortar">' + U.esc(p.nombre) + '</h1>' +
            '<span class="sx2-flex" style="flex-wrap:wrap">' +
              U.badge(ETIQUETA_SALUD[d.detalle.salud] || d.detalle.salud, TONO_SALUD[d.detalle.salud]) +
              U.badge(ETIQUETA_ESTADO_PROYECTO[p.estado] || p.estado, 'neutro', true) +
              '<span class="sx2-tenue" style="font-size:.8125rem">' + U.ico('calendario', 14) + ' ' + fecha(p.fecha_inicio, true) + ' – ' + fecha(p.fecha_objetivo, true) + '</span>' +
            '</span>' +
          '</div>' +
        '</div>' +
        '<div class="sx2-cabecera__acciones">' +
          U.boton({ texto: 'Excel', icono: 'tabla', clase: 'js-py2-excel' }) +
          U.boton({ texto: 'PDF', icono: 'documento', clase: 'js-py2-pdf' }) +
        '</div>' +
      '</header>' +
      '<nav class="sx2-nav" aria-label="Secciones del proyecto">' +
        SECCIONES.map(function (s) {
          var n = contadores[s.id];
          return '<button type="button" class="sx2-nav__item js-py2-seccion" data-id="' + s.id + '"' + (s.id === estado.seccion ? ' aria-current="page"' : '') + '>' +
            U.ico(s.icono, 17) + s.texto + (n ? '<span class="sx2-nav__contador">' + n + '</span>' : '') + '</button>';
        }).join('') +
      '</nav>' +
      '<div class="js-py2-cuerpo sx2-apilado sx2-cambio-seccion">' + cuerpo + '</div>' +
    '</div>';
  }

  function seccionPendiente_() {
    return U.card({ cuerpo: U.vacio({
      icono: 'destello', titulo: 'Esta sección está en construcción',
      texto: 'Mientras tanto puedes hacer esto en la versión clásica del módulo.',
      accion: U.boton({ texto: 'Abrir versión clásica', icono: 'izquierda', clase: 'js-py2-clasica' })
    }) });
  }

  function irSeccion(id) {
    if (!PYv2.seccionExiste(id)) return;
    estado.seccion = id;
    pintar({ soloCuerpo: true });
    var nav = contenedor() && contenedor().querySelector('.sx2-nav');
    if (nav) nav.scrollIntoView({ block: 'nearest', behavior: U.reducirMovimiento() ? 'auto' : 'smooth' });
  }

  function descargar(accion, tipo) {
    if (!estado.proyectoId) return;
    aviso('Generando ' + (tipo === 'pdf' ? 'PDF' : 'Excel') + '…');
    api_(accion, { proyecto_id: estado.proyectoId }).then(function (r) {
      if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo generar el archivo.', 'error'); return; }
      var b64 = r.data.pdf_base64 || r.data.xlsx_base64;
      descargarBase64(b64, r.data.filename || ('Proyecto.' + tipo),
        tipo === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    });
  }

  // --- Eventos globales del contenedor (delegados, se enganchan UNA vez) -------
  var enganchado_ = false;
  function engancharUnaVez() {
    if (enganchado_) return;
    var c = contenedor();
    if (!c) return;
    enganchado_ = true;
    c.addEventListener('click', function (ev) {
      if (!c.classList.contains('sx2')) return; // v1 está pintando: no es nuestro
      var t = ev.target;
      if (t.closest('.js-py2-portafolio')) { cargarPortafolio(); return; }
      var s = t.closest('.js-py2-seccion');
      if (s) { irSeccion(s.getAttribute('data-id')); return; }
      if (t.closest('.js-py2-excel')) { descargar('descargarLibroProyecto', 'xlsx'); return; }
      if (t.closest('.js-py2-pdf')) { descargar('descargarReporteProyecto', 'pdf'); return; }
      if (t.closest('.js-py2-clasica')) { usarVersion(false); return; }
      var abrir = t.closest('[data-py2-proyecto]');
      if (abrir) { abrirProyecto(abrir.getAttribute('data-py2-proyecto')); return; }
    });
    c.addEventListener('keydown', function (ev) {
      if (!c.classList.contains('sx2')) return;
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[data-py2-proyecto]:not(button)')) {
        ev.preventDefault();
        abrirProyecto(ev.target.getAttribute('data-py2-proyecto'));
      }
    });
  }

  // --- Preferencia v1/v2 -------------------------------------------------------
  function activo() { try { return localStorage.getItem(CLAVE_PREF) === '1'; } catch (e) { return false; } }
  function usarVersion(v2) {
    try { localStorage.setItem(CLAVE_PREF, v2 ? '1' : '0'); } catch (e) { /* sin storage: queda en v1 */ }
    document.dispatchEvent(new CustomEvent('sigso:proyectos-version', { detail: { v2: !!v2 } }));
  }

  // --- API pública (misma forma que window.SigsoProyectos de v1) ---------------
  function cargar() { engancharUnaVez(); cargarPortafolio(); }
  function refrescar() {
    engancharUnaVez();
    if (estado.vista === 'proyecto' && estado.proyectoId) abrirProyecto(estado.proyectoId, { silencioso: true });
    else cargarPortafolio(true);
  }
  // Ítems del árbol del sidebar. v2 cubre el portafolio; Mi trabajo,
  // Calendario y Reportes siguen en v1 hasta F8 (el shell sigue en "v2",
  // así que al volver a Portafolio se retoma v2).
  function irAItem(id) {
    engancharUnaVez();
    if (!id || id === 'portafolio') { cargarPortafolio(); return; }
    desmontar();
    estado.vista = 'externa';
    if (window.SigsoProyectos && SigsoProyectos.irAItem) SigsoProyectos.irAItem(id);
  }

  window.PYv2 = window.PYv2 || {};
  var PY = window.PYv2;
  PY.secciones = PY.secciones || {};
  PY.SECCIONES = SECCIONES;
  PY.seccionExiste = function (id) { return SECCIONES.some(function (s) { return s.id === id; }); };
  PY.TONO_SEMAFORO = TONO_SEMAFORO;
  PY.TONO_SALUD = TONO_SALUD;
  PY.ETIQUETA_SALUD = ETIQUETA_SALUD;
  PY.ETIQUETA_ESTADO_PROYECTO = ETIQUETA_ESTADO_PROYECTO;
  PY.fecha = fecha;
  PY.hoyClave = hoyClave;
  PY.diasHasta = diasHasta;
  PY.persona = persona;
  PY.tonoTarea = tonoTarea;
  PY.aviso = aviso;
  PY.api = api_;
  PY.descargarBase64 = descargarBase64;
  PY.miEmail = function () { return miEmail_; };
  PY.estado = function () { return estado; };
  PY.ctx = ctx;
  PY.pintar = pintar;
  PY.irSeccion = irSeccion;
  PY.abrirProyecto = abrirProyecto;
  PY.recargarProyecto = recargarProyecto;
  PY.cargarPortafolio = cargarPortafolio;

  window.SigsoProyectosV2 = {
    cargar: cargar,
    refrescar: refrescar,
    irAItem: irAItem,
    activo: activo,
    usarVersion: usarVersion,
    desmontar: desmontar
  };
})();
