/**
 * inicio-v2.js — Inicio v2 (SIGSO v2, módulo 2; análisis y decisiones en
 * documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 * Responde, en orden: ¿qué necesita de mí? (agrupado por origen, con las 3
 * cosas más urgentes y acción directa), ¿cómo voy? (KPIs personales y mi
 * semana), ¿qué me toca en los próximos días? (Mi día), ¿cómo están mis
 * proyectos? y el panel de mi rol (Bandeja, Mi departamento).
 *
 * Reglas que corrigen la versión clásica:
 *  - Honestidad: si una fuente falla, se dice cuál ("No pudimos revisar
 *    Calidad"); "Todo al día" solo cuando todas respondieron.
 *  - Misma fuente que Mi trabajo (bloque mis_tareas de getInicio), así los
 *    números coinciden; y se ven aunque la cuenta no tenga el módulo.
 *  - Una tarea se abre en el panel único (actualizar, confirmar), no en la
 *    portada del módulo; lo que ya está en "Requiere tu atención" no se
 *    repite en "Mi día".
 *
 * Se monta en #inicio-v2 (dentro de #modulo-home); la versión clásica
 * (inicio.js) queda un ciclo como respaldo con "Volver a la versión clásica".
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var CLAVE_PREF = 'sigso_inicio_v2';
  var ctx_ = null;
  var datos_ = null;     // última respuesta, para repintar sin volver a pedir
  var generacion_ = 0;
  var TOP = 3;

  var ORIGEN = {
    mi_trabajo: { titulo: 'Mi trabajo', icono: 'tareas', tono: 'primario' },
    calidad: { titulo: 'Calidad', icono: 'escudoCheck', tono: 'ok' },
    solicitudes: { titulo: 'Mis solicitudes', icono: 'lista', tono: 'info' },
    a_cargo: { titulo: 'Solicitudes a tu cargo', icono: 'bandeja', tono: 'hito' },
    equipo: { titulo: 'Mi equipo', icono: 'equipo', tono: 'hito' },
    novedades: { titulo: 'Novedades', icono: 'campana', tono: 'alerta' }
  };

  function tiene(m) { return (ctx_.modulos || []).indexOf(m) !== -1; }
  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  function clave(v) {
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function diffDias(k, hoy) {
    if (!k) return null;
    var a = k.split('-').map(Number), b = hoy.split('-').map(Number);
    return Math.round((Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000);
  }
  function abierta(a) { return a.estado !== 'TERMINADA' && a.estado !== 'CANCELADA'; }
  function horaChile() {
    try { return Number(new Intl.DateTimeFormat('es-CL', { hour: 'numeric', hour12: false, timeZone: 'America/Santiago' }).format(new Date())); }
    catch (e) { return new Date().getHours(); }
  }
  function fechaLarga() {
    var t = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(new Date());
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // --- Montaje ------------------------------------------------------------------
  function contenedor() {
    var home = document.getElementById('modulo-home');
    if (!home) return null;
    var c = document.getElementById('inicio-v2');
    if (!c) {
      c = document.createElement('div');
      c.id = 'inicio-v2';
      c.className = 'sx2';
      home.appendChild(c);
    }
    home.classList.add('inicio-v2-activo');
    return c;
  }
  function desmontar() {
    var home = document.getElementById('modulo-home');
    if (home) home.classList.remove('inicio-v2-activo');
    var c = document.getElementById('inicio-v2');
    if (c) c.remove();
    datos_ = null;
  }

  // --- Carga ---------------------------------------------------------------------
  // Todo lo del Backoffice en UN viaje (getInicio); Mis solicitudes (INTAKE)
  // y Novedades (feed memoizado del badge) aparte, como en la clásica.
  function render(ctx) {
    ctx_ = ctx;
    var g = ++generacion_;
    var c = contenedor();
    if (!c) return;
    if (!datos_) c.innerHTML = '<div class="sx2-pagina">' + cabecera(null) + U.esqueleto('kpis', 5) + U.esqueleto('tarjetas', 3) + '</div>';

    // mis_items (Módulo 3B): ítems de solicitudes asignados a mí, siempre.
    var bloques = ['mis_tareas', 'mi_bitacora', 'mis_items'];
    if (tiene('proyectos')) bloques.push('proyectos');
    if (tiene('calidad')) bloques.push('calidad');
    var bandejaOk = tiene('bandeja') && (!ctx_.backofficeDisponible || ctx_.backofficeDisponible());
    if (bandejaOk) bloques.push('bandeja');
    if (tiene('jefatura')) bloques.push('jefatura');
    if (tiene('pausas')) bloques.push('pausas');

    // Se pinta apenas llega lo principal (getInicio); Mis solicitudes y
    // Novedades (llamadas aparte) completan después: ninguna fuente sola frena
    // la pantalla. Mientras falte alguna, el
    // estado dice qué se está revisando y nunca "Todo al día".
    var parcial = { base: null, solicitudes: undefined, novedades: undefined };
    var esperaSolicitudes = tiene('mis_solicitudes');
    var esperaNovedades = !!(window.SigsoNovedades && SigsoNovedades.resumenPendientes);
    function aplicar(silencioso) {
      if (g !== generacion_ || !parcial.base) return;
      var d = parcial.base;
      d.cargando = [];
      if (esperaSolicitudes) {
        if (parcial.solicitudes === undefined) d.cargando.push('Mis solicitudes');
        else if (parcial.solicitudes && parcial.solicitudes.ok) {
          d.solicitudes = parcial.solicitudes.data || {};
          if (ctx_.pintarBadge) ctx_.pintarBadge('mis_solicitudes', (d.solicitudes.resumen || {}).pendientes_validar);
        } else if (d.fallas.indexOf('Mis solicitudes') === -1) d.fallas.push('Mis solicitudes');
      }
      if (esperaNovedades) {
        if (parcial.novedades === undefined) d.cargando.push('Novedades');
        else if (parcial.novedades && parcial.novedades.ok) d.novedades = parcial.novedades.data || {};
        else if (d.fallas.indexOf('Novedades') === -1) d.fallas.push('Novedades');
      }
      datos_ = d;
      pintar(silencioso);
    }

    Promise.all([api('getInicio', { bloques: bloques }), PY.cargarMiPerfil()]).then(function (r) {
      if (g !== generacion_) return;
      var b = (r[0] && r[0].ok && r[0].data && r[0].data.bloques) || null;
      var bloque = function (n) { return b ? (b[n] || { ok: false }) : { ok: false }; };
      var d = {
        fallas: [], cargando: [],
        tareas: [], bitacora: [], misItems: [], proyectos: null, calidad: null, bandeja: null, jefatura: null, pausa: null,
        solicitudes: null, novedades: null
      };
      var mt = bloque('mis_tareas');
      if (mt.ok) d.tareas = mt.data.tareas || []; else d.fallas.push('Mi trabajo');
      var mi = bloque('mis_items');
      if (mi.ok) d.misItems = (mi.data && mi.data.items) || []; else d.fallas.push('Solicitudes a tu cargo');
      var bi = bloque('mi_bitacora');
      if (bi.ok) d.bitacora = bi.data || [];
      if (tiene('proyectos')) { var p = bloque('proyectos'); if (p.ok) d.proyectos = p.data || []; else d.fallas.push('Proyectos'); }
      if (tiene('calidad')) { var q = bloque('calidad'); if (q.ok) d.calidad = q.data || {}; else d.fallas.push('Calidad'); }
      if (bandejaOk) { var bj = bloque('bandeja'); if (bj.ok) d.bandeja = bj.data || {}; else d.fallas.push('Bandeja'); }
      if (tiene('jefatura')) { var j = bloque('jefatura'); if (j.ok) d.jefatura = j.data || {}; else d.fallas.push('Mi departamento'); }
      if (tiene('pausas')) { var pa = bloque('pausas'); if (pa.ok) d.pausa = pa.data || {}; }
      if (d.bandeja) {
        if (ctx_.pintarBadge) ctx_.pintarBadge('bandeja', (d.bandeja.resumen || {}).sla_vencido);
        if (ctx_.onRecientes) ctx_.onRecientes(d.bandeja.recientes || []);
      }
      parcial.base = d;
      aplicar(!!datos_);
      // Nombres y fotos (Directorio + Perfil) sin bloquear el primer pintado.
      var correos = [PY.miEmail()];
      Promise.all([
        window.SigsoDirectorio ? SigsoDirectorio.resolver(correos) : Promise.resolve(),
        U.precargarFotos(correos)
      ]).then(function () { aplicar(true); });
    });
    if (esperaSolicitudes) {
      llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'misSolicitudes', { token: ctx_.token })
        .catch(function () { return { ok: false }; })
        .then(function (r) { parcial.solicitudes = r || { ok: false }; aplicar(true); });
    }
    if (esperaNovedades) {
      SigsoNovedades.resumenPendientes()
        .then(function (x) { return { ok: true, data: x }; }, function () { return { ok: false }; })
        .then(function (r) { parcial.novedades = r; aplicar(true); });
    }
  }

  // --- Cálculos ------------------------------------------------------------------
  function resumenTareas(d, hoy) {
    var ab = d.tareas.filter(abierta);
    var r = { abiertas: ab, atrasadas: [], pronto: [], confirmar: [], bloqueadas: [], proximas: [], semana: 0 };
    ab.forEach(function (a) {
      var dd = diffDias(clave(a.fecha_compromiso || a.fecha_propuesta), hoy);
      a._dd = dd;
      // Mismo criterio que Mi trabajo "Esta semana": no atrasada, no por confirmar, vence en ≤ 7 días.
      var atrasada = a.semaforo === 'atrasada' || (dd !== null && dd < 0);
      if (!PY.porConfirmar(a) && !atrasada && dd !== null && dd <= 7) r.semana++;
      if (PY.porConfirmar(a)) r.confirmar.push(a);
      else if (a.semaforo === 'atrasada' || (dd !== null && dd < 0)) r.atrasadas.push(a);
      else if (a.semaforo === 'riesgo') r.pronto.push(a);
      else if (a.estado === 'BLOQUEADA') r.bloqueadas.push(a);
      else if (dd !== null && dd <= 7) r.proximas.push(a);
    });
    r.atrasadas.sort(function (a, b) { return (a._dd || 0) - (b._dd || 0); });
    r.proximas.sort(function (a, b) { return a._dd - b._dd; });
    return r;
  }
  function horasPorDia(d, hoy) {
    var h = PY.calcularHoras({ tareas: d.tareas, bitacora: d.bitacora }, hoy);
    return h.dias.map(function (x) {
      return Object.keys(h.porProy).reduce(function (s, k) { return s + (h.porProy[k].porDia[x] || 0); }, 0);
    });
  }
  function cerradasSemana(d, hoy) {
    return d.tareas.filter(function (a) {
      if (a.estado !== 'TERMINADA' || !a.fecha_terminada) return false;
      var dd = diffDias(clave(a.fecha_terminada), hoy);
      return dd !== null && dd >= -7;
    }).length;
  }

  // Grupos de "Requiere tu atención", cada uno con su resumen y acción.
  function grupos(d, t) {
    var gs = [];
    var partes = [];
    if (t.atrasadas.length) partes.push(t.atrasadas.length + (t.atrasadas.length === 1 ? ' atrasada' : ' atrasadas'));
    if (t.pronto.length) partes.push(t.pronto.length + ' vence' + (t.pronto.length === 1 ? '' : 'n') + ' hoy o mañana');
    if (t.confirmar.length) partes.push(t.confirmar.length + ' por confirmar fecha');
    if (t.bloqueadas.length) partes.push(t.bloqueadas.length + (t.bloqueadas.length === 1 ? ' bloqueada' : ' bloqueadas'));
    if (partes.length) {
      var top = t.atrasadas.concat(t.pronto, t.confirmar, t.bloqueadas).slice(0, TOP);
      // Confirmar una fecha se resuelve en un clic: si hay por confirmar y no
      // alcanzaron a entrar, el último lugar es para una de ellas.
      if (t.confirmar.length && top.indexOf(t.confirmar[0]) === -1 && top.length === TOP) top[TOP - 1] = t.confirmar[0];
      gs.push({ id: 'mi_trabajo', resumen: partes.join(' · '), urgentes: t.atrasadas.length + t.pronto.length,
        total: t.atrasadas.length + t.pronto.length + t.confirmar.length + t.bloqueadas.length, top: top, ir: 'mi_trabajo', cta: 'Ver todo' });
    }
    var B = window.SigsoBandejaV2;
    if (B && d.misItems.length) {
      var r = B.resumenMios(d.misItems);
      if (r.atencion) {
        var ps = [];
        if (r.fuera) ps.push(r.fuera + ' fuera de plazo');
        if (r.recibir) ps.push(r.recibir + ' por recibir');
        if (r.respondieron) ps.push(r.respondieron + (r.respondieron === 1 ? ' con respuesta nueva' : ' con respuestas nuevas'));
        if (r.sinFecha) ps.push(r.sinFecha + ' sin fecha comprometida');
        gs.push({ id: 'a_cargo', resumen: ps.join(' · '), urgentes: r.fuera, total: r.atencion,
          items: B.ordenarMios(d.misItems).slice(0, TOP), ir: tiene('bandeja') ? 'bandeja' : 'mi_trabajo', cta: 'Ver todo' });
      }
    }
    var acuse = d.calidad ? (d.calidad.pendientes_de_acuse || 0) : 0;
    if (acuse) gs.push({ id: 'calidad', resumen: acuse + (acuse === 1 ? ' documento del SGC espera' : ' documentos del SGC esperan') + ' tu confirmación de lectura', total: acuse, ir: 'calidad', cta: 'Revisar' });
    var validar = d.solicitudes ? ((d.solicitudes.resumen || {}).pendientes_validar || 0) : 0;
    if (validar) gs.push({ id: 'solicitudes', resumen: validar + (validar === 1 ? ' ítem espera' : ' ítems esperan') + ' tu validación', total: validar, ir: 'mis_solicitudes', cta: 'Validar' });
    var decidir = d.jefatura ? ((d.jefatura.resumen || {}).requieren_accion || 0) : 0;
    if (decidir) gs.push({ id: 'equipo', resumen: decidir + (decidir === 1 ? ' ítem de tu equipo requiere' : ' ítems de tu equipo requieren') + ' una decisión tuya', total: decidir, ir: 'jefatura', cta: 'Revisar' });
    var nov = d.novedades;
    if (nov && nov.pendientes) {
      gs.push({ id: 'novedades', resumen: nov.destacada ? '"' + nov.destacada.titulo + '" requiere tu acuse' + (nov.pendientes > 1 ? ' · ' + nov.pendientes + ' sin leer' : '') : nov.pendientes + (nov.pendientes === 1 ? ' novedad sin leer' : ' novedades sin leer'),
        total: nov.pendientes, ir: 'novedades', cta: 'Ver todas',
        // Módulo 6A: leer y confirmar desde aquí (panel de novedades-v2.js).
        filas: window.SigsoNovedadesV2 && nov.lista ? SigsoNovedadesV2.filasInicio(nov.lista.slice(0, TOP)) : '' });
    }
    return gs;
  }

  // --- Pintado --------------------------------------------------------------------
  function cabecera(estadoHtml) {
    var cuenta = (ctx_ && ctx_.cuenta) || {};
    // El perfil del servidor manda sobre la cuenta en caché del navegador.
    var yo = PY.persona(PY.miEmail(), PY.miNombre() || cuenta.nombre);
    var h = horaChile();
    var saludo = h < 12 ? 'Buenos días' : (h < 20 ? 'Buenas tardes' : 'Buenas noches');
    var pila = String(PY.miNombre() || cuenta.nombre || yo.nombre || '').split(' ')[0];
    return '<header class="sx2-cabecera sx2-entra">' +
      '<div class="sx2-flex" style="gap:16px;align-items:center;min-width:0">' + U.avatar(yo, 'xl') +
        '<div class="sx2-cabecera__txt"><h1 id="saludo-home-v2">' + saludo + (pila && pila.indexOf('@') === -1 ? ', ' + U.esc(pila) : '') + '</h1>' +
          '<span class="sx2-tenue" style="font-size:.875rem">' + U.esc((cuenta.cargo ? cuenta.cargo + ' · ' : '') + fechaLarga()) + '</span></div>' +
      '</div>' +
      (estadoHtml ? '<div class="sx2-cabecera__acciones">' + estadoHtml + '</div>' : '') +
    '</header>';
  }

  function estado(d, gs) {
    var total = gs.reduce(function (s, g) { return s + g.total; }, 0);
    var urgentes = gs.reduce(function (s, g) { return s + (g.urgentes || 0); }, 0);
    if (d.fallas.length) {
      return '<span class="inicio2-estado sx2-tono-alerta">' + U.ico('alerta', 16) + '<span>No pudimos revisar: ' + U.esc(d.fallas.join(', ')) +
        (total ? ' · ' + total + ' pendiente' + (total === 1 ? '' : 's') + ' en lo demás' : '') + '</span>' +
        U.boton({ texto: 'Reintentar', sm: true, variante: 'fantasma', clase: 'js-in2-reintentar' }) + '</span>';
    }
    if (d.cargando && d.cargando.length && !total) {
      return '<span class="inicio2-estado sx2-tono-neutro">' + U.ico('reloj', 16) + '<span>Revisando ' + U.esc(d.cargando.join(' y ')) + '…</span></span>';
    }
    if (!total) return '<span class="inicio2-estado sx2-tono-ok">' + U.ico('check', 16) + '<span>Todo al día · nada pendiente de tu parte</span></span>';
    return '<span class="inicio2-estado sx2-tono-' + (urgentes ? 'critico' : 'primario') + '">' + U.ico(urgentes ? 'alerta' : 'info', 16) +
      '<span><strong>' + total + '</strong> ' + (total === 1 ? 'cosa requiere' : 'cosas requieren') + ' tu atención' +
      (urgentes ? ' · ' + urgentes + (urgentes === 1 ? ' urgente' : ' urgentes') : '') + '</span></span>';
  }

  function chipOrigenTarea(a) {
    return a.personal
      ? '<span class="sx2-py-ref sx2-py-ref--personal">' + U.ico('persona', 12) + '<span class="sx2-cortar">' + U.esc(a.proyecto_texto || 'Personal') + '</span></span>'
      : '<span class="sx2-py-ref" style="cursor:default">' + U.ico('carpeta', 12) + '<span class="sx2-cortar">' + U.esc(a.proyecto_nombre) + '</span></span>';
  }
  function cuando(a) {
    if (PY.porConfirmar(a)) return 'Te proponen el ' + PY.fecha(a.fecha_propuesta);
    var dd = a._dd;
    if (dd === null || dd === undefined) return 'Sin fecha';
    if (dd < 0) return 'Venció hace ' + (-dd) + (dd === -1 ? ' día' : ' días');
    if (dd === 0) return 'Vence hoy';
    if (dd === 1) return 'Vence mañana';
    return 'En ' + dd + ' días';
  }
  function filaTarea(a, i) {
    var confirmar = PY.porConfirmar(a);
    return '<li class="sx2-py-mt-fila sx2-tono-' + PY.tonoTarea(a) + ' sx2-entra" style="--i:' + Math.min(i + 2, 12) + '" data-in2-tarea="' + U.esc(a.actividad_id) + '" tabindex="0">' +
      '<span class="sx2-py-punto"></span>' +
      '<span class="sx2-apilado" style="gap:4px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(a.titulo) + '</strong>' +
        '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + chipOrigenTarea(a) + U.badge(a.semaforo_etiqueta || a.estado, PY.tonoTarea(a)) + '</span></span>' +
      '<span class="sx2-py-mt-cuando' + (a._dd !== null && a._dd < 0 && !confirmar ? ' sx2-delta--mal' : '') + '">' + U.esc(cuando(a)) + '</span>' +
      (confirmar
        ? U.boton({ texto: 'Confirmar', icono: 'check', sm: true, variante: 'primario', clase: 'js-in2-confirmar', datos: { id: a.actividad_id } })
        : U.boton({ texto: 'Actualizar', icono: 'tendencia', sm: true, variante: 'primario', clase: 'js-in2-actualizar', datos: { id: a.actividad_id } })) +
    '</li>';
  }

  function tarjetaAtencion(d, gs) {
    if (!gs.length) {
      return U.card({ titulo: 'Requiere tu atención', icono: 'rayo', i: 2, cuerpo: d.fallas.length
        ? U.vacio({ icono: 'alerta', titulo: 'Revisamos lo que pudimos', texto: 'En lo que respondió no hay nada pendiente. Falta revisar: ' + d.fallas.join(', ') + '.' })
        : U.vacio({ icono: 'check', titulo: 'Todo al día', texto: 'No hay nada esperando por ti. Buen momento para avanzar en lo que viene.' }) });
    }
    return U.card({ titulo: 'Requiere tu atención', icono: 'rayo', i: 2, cuerpo: '<div class="inicio2-grupos">' + gs.map(function (g) {
      var o = ORIGEN[g.id];
      return '<div class="inicio2-grupo">' +
        '<div class="inicio2-grupo__cab">' +
          '<span class="inicio2-grupo__ico sx2-tono-' + o.tono + '">' + U.ico(o.icono, 18) + '</span>' +
          '<span class="sx2-apilado" style="gap:2px;min-width:0;flex:1"><strong>' + U.esc(o.titulo) + '</strong>' +
            '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(g.resumen) + '</span></span>' +
          (g.ir !== 'mi_trabajo' || puedeIrAMiTrabajo() ? U.boton({ texto: g.cta, sm: true, clase: 'js-in2-ir', datos: { ir: g.ir } }) : '') +
        '</div>' +
        (g.top && g.top.length ? '<ul class="sx2-py-mt-lista inicio2-grupo__top">' + g.top.map(filaTarea).join('') + '</ul>' : '') +
        (g.items && g.items.length ? '<ul class="sx2-py-mt-lista inicio2-grupo__top">' + g.items.map(window.SigsoBandejaV2.filaMia).join('') + '</ul>' : '') +
        (g.filas ? '<ul class="sx2-py-mt-lista inicio2-grupo__top">' + g.filas + '</ul>' : '') +
      '</div>';
    }).join('') + '</div>' });
  }

  function puedeIrAMiTrabajo() {
    return (window.SigsoShell && (SigsoShell.tieneModulo('mi_trabajo') || SigsoShell.tieneModulo('proyectos')));
  }
  function irAMiTrabajo() {
    if (SigsoShell.tieneModulo('mi_trabajo')) { ctx_.irAModulo('mi_trabajo'); return; }
    ctx_.irAModulo('proyectos');
    if (window.SigsoProyectosV2 && SigsoProyectosV2.activo()) SigsoProyectosV2.irAItem('mi-trabajo');
  }

  function tarjetaMiDia(t) {
    if (!t.abiertas.length) return '';
    var lista = t.proximas.slice(0, 5);
    return U.card({ titulo: 'Mi día', icono: 'calendario', sub: 'lo que viene en 7 días', i: 4,
      accion: puedeIrAMiTrabajo() ? { texto: 'Todo mi trabajo (' + t.abiertas.length + ')', clase: 'js-in2-ir', datos: { ir: 'mi_trabajo' } } : null,
      cuerpo: lista.length ? '<ul class="sx2-py-mt-lista">' + lista.map(filaTarea).join('') + '</ul>'
        : U.vacio({ icono: 'check', texto: 'Nada más vence esta semana' + (t.atrasadas.length || t.confirmar.length ? ' aparte de lo que está en atención.' : '.') }) });
  }

  function tarjetaSemana(d, hoy) {
    var porDia = horasPorDia(d, hoy).slice(-7);
    var total = porDia.reduce(function (s, v) { return s + v; }, 0);
    var max = Math.max.apply(null, porDia.concat([1]));
    var letras = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    var cerradas = cerradasSemana(d, hoy);
    // Módulo 5B: la pausa de hoy tiene su propia tarjeta (tarjetaPausa); aquí
    // solo queda el aviso si la versión nueva de Pausas no está cargada.
    var p = d.pausa;
    var pausa = (!window.SigsoPausasV2 && p && p.pausa && p.registrable)
      ? '<div class="sx2-py-aviso sx2-tono-ok">' + U.ico('actividad', 16) + '<span style="flex:1">La pausa activa de hoy está disponible' + (p.pausa.hora_programada ? ' (' + U.esc(p.pausa.hora_programada) + ')' : '') + '.</span>' +
          U.boton({ texto: 'Participar', sm: true, variante: 'primario', clase: 'js-in2-ir', datos: { ir: 'pausas' } }) + '</div>'
      : '';
    if (!d.tareas.length && !pausa) return '';
    var barras = '<div class="inicio2-barras" role="img" aria-label="Horas registradas en los últimos 7 días">' + porDia.map(function (v, i) {
      var dia = new Date(Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)) - 1, Number(hoy.slice(8, 10)) - 6 + i));
      return '<span class="inicio2-barra' + (i === 6 ? ' inicio2-barra--hoy' : '') + '" title="' + (Math.round(v * 10) / 10) + ' h">' +
        '<i style="height:' + Math.max(v ? 6 : 2, Math.round(v / max * 100)) + '%"></i><b>' + letras[dia.getUTCDay()] + '</b></span>';
    }).join('') + '</div>';
    return U.card({ titulo: 'Tu semana', icono: 'reloj', i: 3, cuerpo: pausa +
      (d.tareas.length ? '<div class="inicio2-semana">' +
        '<div><span class="sx2-tenue" style="font-size:.75rem">Horas registradas (7 días)</span><strong class="inicio2-grande">' + (Math.round(total * 10) / 10) + ' h</strong></div>' +
        '<div><span class="sx2-tenue" style="font-size:.75rem">Tareas cerradas</span><strong class="inicio2-grande">' + cerradas + '</strong></div>' +
      '</div>' + barras : '') });
  }

  var ORDEN_SALUD = { critico: 0, riesgo: 1, normal: 2 };
  function tarjetaProyectos(d) {
    if (!d.proyectos) return '';
    var yo = PY.miEmail();
    var mios = d.proyectos.filter(function (p) {
      if (p.estado === 'CERRADO' || p.estado === 'CANCELADO') return false;
      if (String(p.lider_email || '').toLowerCase() === yo) return true;
      return (p.integrantes || []).some(function (i) { return String(i.email || '').toLowerCase() === yo; });
    }).sort(function (a, b) { return (ORDEN_SALUD[a.salud] - ORDEN_SALUD[b.salud]) || String(a.nombre).localeCompare(String(b.nombre), 'es'); });
    if (!mios.length) return '';
    var criticos = mios.filter(function (p) { return p.salud === 'critico'; }).length;
    return U.card({ titulo: 'Mis proyectos', icono: 'capas', sub: mios.length + (criticos ? ' · ' + criticos + ' crítico' + (criticos === 1 ? '' : 's') : ''), i: 5,
      accion: { texto: 'Portafolio', clase: 'js-in2-ir', datos: { ir: 'proyectos' } },
      cuerpo: '<ul class="inicio2-proyectos">' + mios.slice(0, 6).map(function (p) {
        var tono = PY.TONO_SALUD[p.salud] || 'neutro';
        var lider = String(p.lider_email || '').toLowerCase() === yo;
        return '<li><button type="button" class="inicio2-proyecto" data-in2-proyecto="' + U.esc(p.proyecto_id) + '">' +
          U.anillo(Number(p.avance_pct) || 0, { tam: 40, grosor: 5, tono: tono }) +
          '<span class="sx2-apilado" style="gap:3px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(p.nombre) + '</strong>' +
            '<span class="sx2-flex" style="gap:6px">' + U.badge(PY.ETIQUETA_SALUD[p.salud] || p.salud, tono) + (lider ? U.badge('Líder', 'hito', true) : '') + '</span></span>' +
          U.ico('derecha', 16) + '</button></li>';
      }).join('') + '</ul>' +
      (mios.length > 6 ? '<p class="sx2-tenue" style="font-size:.8125rem;margin:10px 0 0">y ' + (mios.length - 6) + ' más en el portafolio.</p>' : '') });
  }

  function panelesRol(d) {
    var html = [];
    if (d.bandeja) {
      var r = d.bandeja.resumen || {};
      html.push('<div class="sx2-col-6 sx2-col--apila">' + U.card({ titulo: 'Bandeja de trabajo', icono: 'bandeja', i: 6, accion: { texto: 'Abrir', clase: 'js-in2-ir', datos: { ir: 'bandeja' } },
        cuerpo: '<div class="inicio2-mini">' +
          mini('Abiertas', r.total_abiertas, 'primario') + mini('Críticas', r.criticas_activas, r.criticas_activas ? 'critico' : 'neutro') +
          mini('Fuera de plazo', r.sla_vencido, r.sla_vencido ? 'critico' : 'neutro') + mini('Ingresadas hoy', r.del_dia, 'info') + '</div>' }) + '</div>');
    }
    if (d.jefatura) {
      var j = d.jefatura.resumen || {};
      html.push('<div class="sx2-col-6 sx2-col--apila">' + U.card({ titulo: 'Mi departamento', icono: 'equipo', i: 6, accion: { texto: 'Abrir', clase: 'js-in2-ir', datos: { ir: 'jefatura' } },
        cuerpo: '<div class="inicio2-mini">' +
          mini('Requieren acción', j.requieren_accion, j.requieren_accion ? 'alerta' : 'neutro') + mini('En riesgo o vencidas', j.en_riesgo, j.en_riesgo ? 'critico' : 'neutro') +
          mini('Nuevas hoy', j.nuevas, 'info') + mini('Cerradas hoy', j.cerradas, 'ok') + '</div>' }) + '</div>');
    }
    return html.join('');
  }
  function mini(etiqueta, valor, tono) {
    return '<span class="inicio2-mini__item sx2-tono-' + tono + '"><b>' + (valor || 0) + '</b><small>' + U.esc(etiqueta) + '</small></span>';
  }

  function recientes(d) {
    var lista = (d.bandeja && d.bandeja.recientes) || [];
    if (!lista.length) return '';
    return '<div class="sx2-col-12">' + U.card({ titulo: 'Actividad reciente en la bandeja', icono: 'lista', i: 7, sinRelleno: true,
      cuerpo: '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Solicitud</th><th>Empresa · módulo</th><th>Prioridad</th><th>Estado</th></tr></thead><tbody>' +
        lista.slice(0, 5).map(function (s) {
          var tp = s.prioridad_derivada === 'P1' ? 'critico' : (s.prioridad_derivada === 'P2' ? 'alerta' : 'neutro');
          return '<tr class="sx2-fila--clic js-in2-ir" data-ir="bandeja"><td><strong>' + U.esc(s.solicitud_id) + '</strong></td><td class="sx2-tenue">' + U.esc(s.empresa_id) + ' · ' + U.esc(s.modulo || '—') + '</td>' +
            '<td>' + U.badge(s.prioridad_derivada || '—', tp, true) + '</td><td>' + U.esc(window.formatearEstadoSigso ? formatearEstadoSigso(s.estado_derivado) : s.estado_derivado) + '</td></tr>';
        }).join('') + '</tbody></table></div>' }) + '</div>';
  }

  function pintar(silencioso) {
    var c = contenedor();
    if (!c || !datos_) return;
    var d = datos_, hoy = PY.hoyClave();
    var t = resumenTareas(d, hoy);
    var gs = grupos(d, t);
    var y = window.scrollY;
    var semanaPrev = horasPorDia(d, hoy);
    var h7 = semanaPrev.slice(-7).reduce(function (s, v) { return s + v; }, 0);
    var hAnt = semanaPrev.slice(0, 7).reduce(function (s, v) { return s + v; }, 0);

    var nItems = d.misItems.length, rItems = nItems && window.SigsoBandejaV2 ? SigsoBandejaV2.resumenMios(d.misItems) : null;
    var kpiItems = rItems ? U.kpi({ i: 5, icono: 'bandeja', tono: rItems.fuera ? 'critico' : 'hito', etiqueta: 'Solicitudes a tu cargo', valor: nItems,
      unidad: rItems.fuera ? rItems.fuera + ' fuera de plazo' : 'ítems abiertos', filtro: tiene('bandeja') ? 'bandeja' : (puedeIrAMiTrabajo() ? 'mi_trabajo' : null) }) : '';
    var kpis = d.tareas.length ? '<div class="sx2-fila-kpis' + (kpiItems ? ' sx2-fila-kpis--6' : '') + '">' +
      U.kpi({ i: 0, icono: 'tareas', tono: 'primario', etiqueta: 'Mis tareas abiertas', valor: t.abiertas.length, unidad: 'en todo SIGSO', filtro: puedeIrAMiTrabajo() ? 'mi_trabajo' : null }) +
      U.kpi({ i: 1, icono: 'alerta', tono: t.atrasadas.length ? 'critico' : 'neutro', etiqueta: 'Atrasadas', valor: t.atrasadas.length, unidad: 'atender primero' }) +
      U.kpi({ i: 2, icono: 'calendario', tono: 'alerta', etiqueta: 'Vencen en 7 días', valor: t.semana, unidad: 'incluye hoy y mañana' }) +
      U.kpi({ i: 3, icono: 'check', tono: t.confirmar.length ? 'info' : 'neutro', etiqueta: 'Por confirmar', valor: t.confirmar.length, unidad: 'fechas propuestas' }) +
      U.kpi({ i: 4, icono: 'reloj', tono: 'ok', etiqueta: 'Horas esta semana', valor: Math.round(h7 * 10) / 10, sufijo: ' h',
        tendencia: hAnt ? { texto: (h7 >= hAnt ? '+' : '') + (Math.round((h7 - hAnt) * 10) / 10) + ' h vs anterior', tono: h7 >= hAnt ? 'ok' : 'alerta', icono: h7 >= hAnt ? 'tendencia' : 'tendenciaBaja' } : null }) +
      kpiItems +
    '</div>' : (kpiItems ? '<div class="sx2-fila-kpis">' + kpiItems +
      U.kpi({ i: 1, icono: 'alerta', tono: rItems.fuera ? 'critico' : 'neutro', etiqueta: 'Fuera de plazo', valor: rItems.fuera, unidad: 'pasaron su SLA' }) +
      U.kpi({ i: 2, icono: 'calendario', tono: rItems.sinFecha ? 'alerta' : 'neutro', etiqueta: 'Sin fecha comprometida', valor: rItems.sinFecha, unidad: 'nadie se comprometió' }) +
      U.kpi({ i: 3, icono: 'check', tono: rItems.recibir ? 'info' : 'neutro', etiqueta: 'Por recibir', valor: rItems.recibir, unidad: 'nuevos para ti' }) +
    '</div>' : '');

    var semana = tarjetaSemana(d, hoy), miDia = tarjetaMiDia(t), proyectos = tarjetaProyectos(d);
    // Módulo 5B: declarar la pausa de hoy en un toque, arriba de todo.
    var tarjetaPausa = window.SigsoPausasV2 ? SigsoPausasV2.bloqueInicio(d.pausa) : '';
    if (tarjetaPausa) tarjetaPausa = '<section class="sx2-card inicio2-pausa sx2-entra" style="--i:1">' + tarjetaPausa + '</section>';
    c.innerHTML = '<div class="sx2-pagina">' + cabecera(estado(d, gs)) + tarjetaPausa + kpis +
      '<div class="sx2-grid sx2-grid--estira">' +
        '<div class="' + (semana ? 'sx2-col-8' : 'sx2-col-12') + '">' + tarjetaAtencion(d, gs) + '</div>' +
        (semana ? '<div class="sx2-col-4 sx2-col--apila">' + semana + '</div>' : '') +
        (miDia ? '<div class="' + (proyectos ? 'sx2-col-8' : 'sx2-col-12') + '">' + miDia + '</div>' : '') +
        (proyectos ? '<div class="' + (miDia ? 'sx2-col-4 sx2-col--apila' : 'sx2-col-12') + '">' + proyectos + '</div>' : '') +
        panelesRol(d) + recientes(d) +
      '</div>' +
    '</div>';
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    U.animar(c);
  }

  // --- Acciones ----------------------------------------------------------------------
  function tarea(id) { return datos_.tareas.filter(function (a) { return a.actividad_id === id; })[0]; }
  function recargar() { if (ctx_) render(ctx_); }
  function abrirTarea(a, opts) {
    if (!a) return;
    opts = Object.assign({ alGuardar: recargar }, opts || {});
    if (a.personal) PY.abrirTareaPersonal(a.actividad_id, Object.assign({ base: a }, opts));
    else PY.abrirTareaDeProyecto(a.proyecto_id, a.actividad_id, opts);
  }
  function abrirProyecto(id) {
    ctx_.irAModulo('proyectos');
    if (window.SigsoProyectosV2 && SigsoProyectosV2.activo()) PY.abrirProyecto(id);
  }

  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('inicio-v2');
    if (!raiz || !raiz.contains(ev.target)) return;
    var t = ev.target, b;
    if (t.closest('.js-in2-reintentar')) { recargar(); return; }
    if ((b = t.closest('.js-in2-confirmar'))) {
      ev.stopPropagation();
      b.disabled = true;
      api('confirmarActividad', { actividad_id: b.getAttribute('data-id') }).then(function (r) {
        if (!r || !r.ok) { b.disabled = false; PY.aviso((r && r.message) || 'No se pudo confirmar.', 'error'); return; }
        PY.aviso('Fecha confirmada.', 'exito');
        recargar();
      });
      return;
    }
    if ((b = t.closest('.js-in2-actualizar'))) { ev.stopPropagation(); abrirTarea(tarea(b.getAttribute('data-id')), { actualizar: true }); return; }
    if ((b = t.closest('[data-in2-tarea]'))) { abrirTarea(tarea(b.getAttribute('data-in2-tarea'))); return; }
    if ((b = t.closest('[data-in2-proyecto]'))) { abrirProyecto(b.getAttribute('data-in2-proyecto')); return; }
    if ((b = t.closest('.sx2-kpi[data-filtro="mi_trabajo"]'))) { irAMiTrabajo(); return; }
    if ((b = t.closest('.sx2-kpi[data-filtro="bandeja"]'))) { ctx_.irAModulo('bandeja'); return; }
    if ((b = t.closest('.js-in2-ir'))) {
      var ir = b.getAttribute('data-ir');
      if (ir === 'mi_trabajo') irAMiTrabajo(); else ctx_.irAModulo(ir);
    }
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('#inicio-v2 [data-in2-tarea]')) { ev.preventDefault(); ev.target.click(); }
  });

  // Módulo 3B: un cambio en una solicitud (panel lateral o fila) repinta el Inicio.
  document.addEventListener('sigso:novedad-leida', function () {
    var c = document.getElementById('inicio-v2');
    if (c && c.offsetParent !== null) recargar();
  });
  document.addEventListener('sigso:pausa-cambio', function () {
    var c = document.getElementById('inicio-v2');
    if (c && c.offsetParent !== null) recargar();
  });
  document.addEventListener('sigso:solicitudes-cambio', function () {
    var c = document.getElementById('inicio-v2');
    if (c && c.offsetParent !== null) recargar();
  });

  function activo() { try { return localStorage.getItem(CLAVE_PREF) !== '0'; } catch (e) { return true; } }
  function usarVersion(v2) {
    try { localStorage.setItem(CLAVE_PREF, v2 ? '1' : '0'); } catch (e) { /* sin storage: no se recuerda */ }
    document.dispatchEvent(new CustomEvent('sigso:v2-version', { detail: { modulo: 'home', v2: !!v2 } }));
  }

  window.SigsoInicioV2 = { render: render, activo: activo, usarVersion: usarVersion, desmontar: desmontar };
})();
