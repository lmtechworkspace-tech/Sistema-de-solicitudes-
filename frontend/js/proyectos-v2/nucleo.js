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
  var miPerfil_ = null, miEmail_ = '', miNombre_ = '';
  function cargarMiPerfil() {
    if (!miPerfil_) {
      miPerfil_ = api_('getMiPerfil', {}).then(function (r) {
        miEmail_ = (r && r.ok && r.data && r.data.email) ? String(r.data.email).trim().toLowerCase() : '';
        miNombre_ = (r && r.ok && r.data && r.data.nombre) ? String(r.data.nombre) : '';
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

  // Quién puede APORTAR al proyecto (documentos, entregables, riesgos,
  // reuniones, decisiones): espejo de puedeAportar_ de v1, que a su vez es la
  // regla del backend (ADM/líder, o cualquier miembro que no sea observador).
  function puedeAportar(detalle) {
    if (!detalle) return false;
    if (detalle.puede_gestionar === true) return true;
    return !!detalle.rol_actual && detalle.rol_actual !== 'OBSERVADOR';
  }

  // Datos que no vienen en el detalle (reuniones, decisiones, avance, pagos,
  // RDI, analítica): se piden la primera vez que una vista los necesita y
  // quedan en estado.datos.extra. undefined = cargando · null = falló.
  function extra(clave, accion, extraer) {
    var d = estado.datos;
    if (!d) return undefined;
    d.extra = d.extra || {};
    d.enVuelo = d.enVuelo || {};
    if (Object.prototype.hasOwnProperty.call(d.extra, clave)) return d.extra[clave];
    if (!d.enVuelo[clave]) {
      d.enVuelo[clave] = true;
      api_(accion, { proyecto_id: estado.proyectoId }).then(function (r) {
        if (estado.datos !== d) return; // se cambió de proyecto o se recargó
        d.enVuelo[clave] = false;
        d.extra[clave] = (r && r.ok) ? (extraer ? extraer(r.data) : r.data) : null;
        if (estado.vista === 'proyecto') pintar({ sinAnimacion: true });
      });
    }
    return undefined;
  }
  function invalidarExtra(clave) {
    var d = estado.datos;
    if (d && d.extra) delete d.extra[clave];
    pintar({ sinAnimacion: true });
  }

  // Formulario en drawer, el patrón de todas las altas/ediciones de v2.
  // o: { titulo, subtitulo, campos (html), boton, accion | enviar(datos),
  //      preparar(datos, form) -> datos | 'mensaje de error' | Promise,
  //      eliminar: { texto, titulo, mensaje, enviar() }, aviso, listo(r), alMontar(form, d) }
  // Por defecto, al guardar bien recarga el proyecto.
  function formulario(o) {
    var d = U.drawer({
      titulo: o.titulo,
      subtitulo: o.subtitulo,
      cuerpo: '<form class="sx2-form js-py2-form" novalidate>' + o.campos +
        '<p class="sx2-campo__error js-py2-form-error" role="alert" hidden></p></form>',
      pie: (o.eliminar ? U.boton({ texto: o.eliminar.texto || 'Eliminar', icono: 'basura', variante: 'texto-peligro', clase: 'js-py2-form-eliminar' }) : '') +
        '<span style="flex:1"></span>' +
        U.boton({ texto: 'Cancelar', clase: 'js-sx2-drawer-cerrar' }) +
        U.boton({ texto: o.boton || 'Guardar', icono: 'check', variante: 'primario', clase: 'js-py2-form-ok' })
    });
    var form = d.el.querySelector('.js-py2-form');
    var err = d.el.querySelector('.js-py2-form-error');
    var ok = d.el.querySelector('.js-py2-form-ok');
    var textoOk = ok.innerHTML;
    function error(m) { err.textContent = m; err.hidden = false; }
    function ocupado(si) { ok.disabled = si; ok.innerHTML = si ? (o.ocupado || 'Guardando…') : textoOk; }
    function terminar(r) {
      ocupado(false);
      if (!r || !r.ok) { error((r && r.message) || 'No se pudo guardar.'); return; }
      d.cerrar();
      if (o.aviso) aviso(o.aviso, 'exito');
      if (o.listo) o.listo(r); else recargarProyecto();
    }
    function enviar(ev) {
      if (ev) ev.preventDefault();
      if (ok.disabled) return;
      err.hidden = true;
      var datos = { proyecto_id: estado.proyectoId };
      new FormData(form).forEach(function (v, k) { if (typeof v === 'string') datos[k] = v.trim(); });
      ocupado(true);
      Promise.resolve(o.preparar ? o.preparar(datos, form) : datos).then(function (listos) {
        if (typeof listos === 'string') { ocupado(false); error(listos); return; }
        return (o.enviar ? o.enviar(listos) : api_(o.accion, listos)).then(terminar);
      }, function (e) { ocupado(false); error((e && e.message) || 'No se pudo preparar el envío.'); });
    }
    form.addEventListener('submit', enviar);
    ok.addEventListener('click', enviar);
    var elim = d.el.querySelector('.js-py2-form-eliminar');
    if (elim) {
      elim.addEventListener('click', function () {
        U.confirmar({ titulo: o.eliminar.titulo || '¿Eliminar?', texto: o.eliminar.mensaje, boton: o.eliminar.texto || 'Eliminar', peligro: true }).then(function (si) {
          if (!si) return;
          elim.disabled = true;
          o.eliminar.enviar().then(function (r) { elim.disabled = false; terminar(r); });
        });
      });
    }
    if (o.alMontar) o.alMontar(form, d);
    var primero = form.querySelector('input:not([type=hidden]):not([type=file]), textarea, select');
    if (primero) primero.focus();
    return d;
  }

  // Confirmar + llamar + avisar + recargar: las acciones de un clic.
  // o: { titulo, texto, boton, peligro, accion, datos, aviso, listo(r) }
  function accionConfirmada(o) {
    return U.confirmar(o).then(function (si) {
      if (!si) return false;
      return api_(o.accion, Object.assign({ proyecto_id: estado.proyectoId }, o.datos || {})).then(function (r) {
        if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo completar la acción.', 'error'); return false; }
        if (o.aviso) aviso(o.aviso, 'exito');
        if (o.listo) o.listo(r); else recargarProyecto();
        return true;
      });
    });
  }

  // Lee un File como base64 (sin el prefijo data:...;base64,).
  function leerBase64(archivo) {
    return new Promise(function (resolver, rechazar) {
      var lector = new FileReader();
      lector.onload = function () { resolver(String(lector.result).slice(String(lector.result).indexOf(',') + 1)); };
      lector.onerror = function () { rechazar(new Error('No se pudo leer el archivo.')); };
      lector.readAsDataURL(archivo);
    });
  }

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

  // --- Vistas de módulo (Mi trabajo, Calendario) ------------------------------
  // Cada una vive en su archivo y se registra en PYv2.vistas[id] con:
  //   cargar() -> Promise(datos) · pintar(datos) -> html · alMontar(raiz, datos)
  //   correos(datos) -> [emails] (opcional, para nombres y fotos)
  function abrirVista(id, opciones) {
    var v = PYv2.vistas[id];
    if (!v) { cargarPortafolio(); return; }
    opciones = opciones || {};
    var c = montarRaiz();
    if (!c) return;
    var misma = estado.vista === id && estado.vistaDatos;
    estado.vista = id;
    estado.proyectoId = null;
    estado.datos = null;
    var turno = ++estado.turno;
    if (!opciones.silencioso || !misma) {
      estado.vistaDatos = null;
      c.innerHTML = '<div class="sx2-pagina">' + U.esqueleto('kpis', 5) + U.esqueleto('tabla', 6) + '</div>';
      window.scrollTo(0, 0);
    }
    Promise.all([v.cargar(), cargarMiPerfil()]).then(function (r) {
      if (turno !== estado.turno) return;
      estado.vistaDatos = r[0];
      pintar(misma && opciones.silencioso ? { sinAnimacion: true } : undefined);
      resolverPersonasYFotos(v.correos ? v.correos(r[0]) : [], turno);
    });
  }
  function recargarVista() {
    if (PYv2.vistas[estado.vista]) abrirVista(estado.vista, { silencioso: true });
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
      // Quien tenga un panel abierto sobre estos datos (la Sala) se refresca.
      document.dispatchEvent(new CustomEvent('py2:datos', { detail: { proyectoId: id } }));
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
    } else if (PYv2.vistas[estado.vista]) {
      if (!estado.vistaDatos) return;
      var v = PYv2.vistas[estado.vista];
      c.innerHTML = '<div class="sx2-pagina">' + v.pintar(estado.vistaDatos) + '</div>';
      if (v.alMontar) v.alMontar(c.firstChild, estado.vistaDatos);
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
    var contadores = {
      trabajo: d.tareas.filter(function (a) { return a.estado !== 'TERMINADA' && a.estado !== 'CANCELADA'; }).length,
      equipo: (d.detalle.integrantes || []).length,
      archivos: (d.detalle.documentos || []).length + (d.detalle.entregables || []).length,
      // Riesgos vivos: lo que en Seguimiento pide atención.
      seguimiento: (d.detalle.riesgos || []).filter(function (r) { return r.estado !== 'CERRADO'; }).length
    };

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
          (PYv2.accionesCabecera ? PYv2.accionesCabecera(c) : '') +
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
      if (PYv2.clicAcciones && PYv2.clicAcciones(t, ev)) return;
      if (t.closest('.js-py2-portafolio')) { cargarPortafolio(); return; }
      var s = t.closest('.js-py2-seccion');
      if (s) { irSeccion(s.getAttribute('data-id')); return; }
      if (t.closest('.js-py2-excel')) { descargar('descargarLibroProyecto', 'xlsx'); return; }
      if (t.closest('.js-py2-pdf')) { descargar('descargarReporteProyecto', 'pdf'); return; }
      if (t.closest('.js-py2-clasica')) { usarVersion(false); return; }
      var abrir = t.closest('[data-py2-proyecto]');
      if (abrir) { abrirProyecto(abrir.getAttribute('data-py2-proyecto'), { seccion: abrir.getAttribute('data-seccion') || undefined }); return; }
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
  // v2 es la versión por defecto (F8): solo quien eligió volver a la clásica
  // ('0') sigue en v1. Sin storage (modo privado), v2.
  function activo() { try { return localStorage.getItem(CLAVE_PREF) !== '0'; } catch (e) { return true; } }
  function usarVersion(v2) {
    try { localStorage.setItem(CLAVE_PREF, v2 ? '1' : '0'); } catch (e) { /* sin storage: no se recuerda */ }
    document.dispatchEvent(new CustomEvent('sigso:proyectos-version', { detail: { v2: !!v2 } }));
  }

  // --- API pública (misma forma que window.SigsoProyectos de v1) ---------------
  // La vista puede venir de la URL (#/proyectos/mi-trabajo): mismo contrato que
  // v1, solo se aceptan los ítems que existen en el árbol del módulo.
  var ITEMS_VALIDOS = { portafolio: true, 'mi-trabajo': true, calendario: true, reportes: true };
  function cargar() {
    engancharUnaVez();
    var pedida = (window.SigsoShell && SigsoShell.tomarItemDeRuta) ? SigsoShell.tomarItemDeRuta() : '';
    if (pedida && ITEMS_VALIDOS[pedida] && pedida !== 'portafolio') { irAItem(pedida); return; }
    cargarPortafolio();
  }
  function refrescar() {
    engancharUnaVez();
    if (estado.vista === 'proyecto' && estado.proyectoId) abrirProyecto(estado.proyectoId, { silencioso: true });
    else if (PYv2.vistas[estado.vista]) recargarVista();
    else cargarPortafolio(true);
  }
  // Ítems del árbol del sidebar. Portafolio, Mi trabajo y Calendario son v2;
  // Reportes usa el motor compartido de SIGSO (SigsoReportes, el mismo de los
  // demás módulos), así que se delega a v1 -- el shell sigue en "v2" y al
  // volver a otro ítem se retoma v2.
  var ITEM_VISTA = { 'mi-trabajo': 'mitrabajo', calendario: 'calendario' };
  function irAItem(id) {
    engancharUnaVez();
    if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(id || 'portafolio');
    if (!id || id === 'portafolio') { cargarPortafolio(); return; }
    if (ITEM_VISTA[id] && PYv2.vistas[ITEM_VISTA[id]]) { abrirVista(ITEM_VISTA[id]); return; }
    desmontar();
    estado.vista = 'externa';
    if (window.SigsoProyectos && SigsoProyectos.irAItem) SigsoProyectos.irAItem(id);
  }

  window.PYv2 = window.PYv2 || {};
  var PY = window.PYv2;
  PY.secciones = PY.secciones || {};
  PY.vistas = PY.vistas || {};
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
  PY.miNombre = function () { return miNombre_; };
  PY.estado = function () { return estado; };
  PY.ctx = ctx;
  PY.pintar = pintar;
  PY.irSeccion = irSeccion;
  PY.abrirProyecto = abrirProyecto;
  PY.recargarProyecto = recargarProyecto;
  PY.abrirVista = abrirVista;
  PY.recargarVista = recargarVista;
  PY.cargarPortafolio = cargarPortafolio;
  PY.cargarMiPerfil = cargarMiPerfil;
  PY.puedeAportar = puedeAportar;
  PY.extra = extra;
  PY.invalidarExtra = invalidarExtra;
  PY.formulario = formulario;
  PY.accionConfirmada = accionConfirmada;
  PY.leerBase64 = leerBase64;

  window.SigsoProyectosV2 = {
    cargar: cargar,
    refrescar: refrescar,
    irAItem: irAItem,
    activo: activo,
    usarVersion: usarVersion,
    desmontar: desmontar
  };
})();
