/**
 * jefatura-v2.js — "Mi equipo" (SIGSO v2, Módulo 4B; análisis y decisiones
 * en documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 * Mi departamento centrado en las PERSONAS (decisión del dueño): una tarjeta
 * por persona del equipo con todo su trabajo — tareas de proyecto y
 * personales, horas registradas en la semana y sus solicitudes — y las
 * acciones de siempre (pedir actualización, reasignar). Backend getMiEquipo.
 *
 * Es el primer ítem de "Mi departamento" con la v2; tablero de solicitudes,
 * por persona, actividades del equipo y reportes siguen en jefatura.js.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var CLAVE_PREF = 'sigso_jefatura_v2';
  var MAX_TAREAS = 4;
  var datos_ = null, turno_ = 0, expandidos_ = {};

  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  function r1(v) { return Math.round(v * 10) / 10; }

  // --- Montaje ----------------------------------------------------------------------
  function seccion() { return document.getElementById('modulo-bandeja'); }
  function contenedor() {
    var s = seccion();
    if (!s) return null;
    var c = document.getElementById('jefatura-v2');
    if (!c) {
      c = document.createElement('div');
      c.id = 'jefatura-v2';
      c.className = 'sx2';
      s.appendChild(c);
    }
    s.classList.add('jefatura-v2-activa');
    return c;
  }
  function desmontar() {
    var s = seccion();
    if (s) s.classList.remove('jefatura-v2-activa');
    var c = document.getElementById('jefatura-v2');
    if (c) c.remove();
  }

  function cargar(silencioso) {
    var c = contenedor();
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !datos_) c.innerHTML = '<div class="sx2-pagina">' + cabecera(null) + U.esqueleto('kpis', 5) + U.esqueleto('tarjetas', 2) + '</div>';
    Promise.all([api('getMiEquipo', {}), PY.cargarMiPerfil()]).then(function (r) {
      if (t !== turno_) return;
      if (!r[0] || !r[0].ok) {
        c.innerHTML = '<div class="sx2-pagina">' + cabecera(null) + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar tu equipo',
          texto: (r[0] && r[0].message) || 'Inténtalo de nuevo.', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-je2-recargar' }) }) }) + '</div>';
        return;
      }
      datos_ = r[0].data;
      pintar(!!silencioso);
      var correos = datos_.personas.map(function (p) { return p.email; });
      Promise.all([window.SigsoDirectorio ? SigsoDirectorio.resolver(correos) : Promise.resolve(), U.precargarFotos(correos)])
        .then(function () { if (t === turno_) pintar(true); });
    });
  }

  // --- Pintado ------------------------------------------------------------------------
  function cabecera(d) {
    var n = d ? d.personas.length : 0;
    return '<header class="sx2-cabecera sx2-entra">' +
      '<div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Mi departamento</span><h1>Mi equipo</h1>' +
        '<span class="sx2-tenue" style="font-size:.875rem">' + (d ? (n === 1 ? '1 persona' : n + ' personas') + ' · todo su trabajo: tareas, horas y solicitudes.' : 'Cargando…') + '</span></div>' +
      '<div class="sx2-cabecera__acciones">' + U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-je2-recargar' }) + '</div>' +
    '</header>';
  }

  function kpis(r) {
    return '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, icono: 'tareas', tono: 'primario', etiqueta: 'Tareas abiertas', valor: r.tareas_abiertas, unidad: 'del equipo' }) +
      U.kpi({ i: 1, icono: 'alerta', tono: r.tareas_atrasadas ? 'critico' : 'neutro', etiqueta: 'Atrasadas', valor: r.tareas_atrasadas, unidad: 'pasaron su fecha' }) +
      U.kpi({ i: 2, icono: 'calendario', tono: r.por_confirmar ? 'info' : 'neutro', etiqueta: 'Por confirmar', valor: r.por_confirmar, unidad: 'fechas propuestas sin aceptar' }) +
      U.kpi({ i: 3, icono: 'candado', tono: r.bloqueadas ? 'hito' : 'neutro', etiqueta: 'Bloqueadas', valor: r.bloqueadas, unidad: 'esperan algo' }) +
      U.kpi({ i: 4, icono: 'reloj', tono: 'ok', etiqueta: 'Horas registradas', valor: r.horas_7d, sufijo: ' h', unidad: 'últimos 7 días' }) +
    '</div>';
  }

  function barrasHoras(h) {
    var max = Math.max.apply(null, h.por_dia.map(function (d) { return d.horas; }).concat([8]));
    return '<div class="je2-horas" title="Horas registradas por día (últimos 7 días)">' + h.por_dia.map(function (d) {
      var dia = ['D', 'L', 'M', 'X', 'J', 'V', 'S'][new Date(d.dia + 'T12:00:00').getDay()];
      return '<span class="je2-horas__dia' + (d.hoy ? ' je2-horas__dia--hoy' : '') + '"><i style="height:' + Math.max(d.horas ? 6 : 2, Math.round(d.horas / max * 100)) + '%"' + (d.horas ? '' : ' class="je2-horas__cero"') + '></i><b>' + dia + '</b></span>';
    }).join('') + '</div>';
  }

  function filaTarea(a) {
    var tono = PY.tonoTarea(a);
    var fecha = a.fecha_compromiso || a.fecha_propuesta;
    return '<li class="je2-tarea sx2-tono-' + tono + '">' +
      '<span class="sx2-py-punto"></span>' +
      '<span class="sx2-apilado" style="gap:3px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(a.titulo) + '</strong>' +
        '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' +
          (a.personal
            ? '<span class="sx2-py-ref sx2-py-ref--personal">' + U.ico('persona', 12) + '<span class="sx2-cortar">' + U.esc(a.proyecto_texto || 'Personal') + '</span></span>'
            : '<span class="sx2-py-ref" style="cursor:default">' + U.ico('carpeta', 12) + '<span class="sx2-cortar">' + U.esc(a.proyecto_nombre || 'Proyecto') + '</span></span>') +
          U.badge(a.por_confirmar ? 'Fecha por confirmar' : (a.semaforo_etiqueta || a.estado), a.por_confirmar ? 'info' : tono) +
          (fecha ? '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(PY.fecha(fecha)) + '</span>' : '') +
          (a.dias_sin_movimiento > 7 ? '<span class="sx2-tenue" style="font-size:.75rem">' + a.dias_sin_movimiento + ' d sin movimiento</span>' : '') +
        '</span>' +
        (a.bloqueo_motivo ? '<span class="sx2-py-mt-bloqueo">' + U.ico('candado', 12) + U.esc(a.bloqueo_motivo) + '</span>' : '') +
      '</span>' +
      '<span class="sx2-flex" style="gap:4px;flex:none">' +
        U.boton({ soloIcono: true, icono: 'comentario', sm: true, variante: 'fantasma', titulo: 'Pedir actualización', clase: 'js-je2-pedir', datos: { id: a.actividad_id } }) +
        U.boton({ soloIcono: true, icono: 'derivar', sm: true, variante: 'fantasma', titulo: 'Reasignar', clase: 'js-je2-reasignar', datos: { id: a.actividad_id } }) +
      '</span>' +
    '</li>';
  }

  function tarjetaPersona(p, i) {
    var per = PY.persona(p.email, p.nombre);
    if (p.sin_actividad) {
      return '<section class="sx2-card je2-persona je2-persona--vacia sx2-entra" style="--i:' + (i + 2) + '">' +
        '<div class="je2-persona__cab">' + U.persona(per, 'lg') + (p.tiene_cuenta ? '' : U.badge('Sin cuenta en SIGSO', 'neutro', true)) + '</div>' +
        '<p class="sx2-tenue" style="margin:0;font-size:.8125rem">Sin tareas, solicitudes ni registros en SIGSO. Si trabaja en algo, pídele que lo anote en Mi trabajo' +
          (p.tiene_cuenta ? '' : ' (primero necesita una cuenta)') + '.</p></section>';
    }
    var t = p.tareas, h = p.horas, s = p.solicitudes;
    var abierta = !!expandidos_[p.email];
    var lista = abierta ? t.lista : t.lista.slice(0, MAX_TAREAS);
    var delta = r1(h.ultimos_7d - h.previos_7d);
    var partesSol = [];
    if (s.a_cargo) partesSol.push(s.a_cargo + (s.a_cargo === 1 ? ' ítem a su cargo' : ' ítems a su cargo') + (s.a_cargo_fuera_sla ? ' (' + s.a_cargo_fuera_sla + ' fuera de plazo)' : ''));
    if (s.pedidas_abiertas) partesSol.push('pidió ' + s.pedidas_abiertas + (s.pedidas_abiertas === 1 ? ' ítem abierto' : ' ítems abiertos'));
    if (s.por_validar) partesSol.push(s.por_validar + ' por validar');
    return '<section class="sx2-card je2-persona sx2-entra" style="--i:' + (i + 2) + '">' +
      '<div class="je2-persona__cab">' + U.persona(per, 'lg') +
        '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap;justify-content:flex-end">' +
          U.badge(t.abiertas + (t.abiertas === 1 ? ' abierta' : ' abiertas'), 'primario', true) +
          (t.atrasadas ? U.badge(t.atrasadas + (t.atrasadas === 1 ? ' atrasada' : ' atrasadas'), 'critico', true) : '') +
          (t.por_confirmar ? U.badge(t.por_confirmar + ' por confirmar', 'info', true) : '') +
          (t.terminadas_7d ? U.badge(t.terminadas_7d + ' terminada' + (t.terminadas_7d === 1 ? '' : 's') + ' esta semana', 'ok', true) : '') +
        '</span></div>' +
      '<div class="je2-persona__semana">' + barrasHoras(h) +
        '<span class="sx2-apilado" style="gap:2px"><strong class="je2-horas__total">' + r1(h.ultimos_7d) + ' h</strong>' +
          '<span class="sx2-tenue" style="font-size:.75rem">' + (h.ultimos_7d || h.previos_7d
            ? (delta === 0 ? 'igual que la semana anterior' : (delta > 0 ? '+' : '') + delta + ' h vs. semana anterior')
            : 'sin horas registradas en 2 semanas') + '</span>' +
          (h.ultima_actividad ? '<span class="sx2-tenue" style="font-size:.75rem">Último registro ' + U.esc(PY.haceTiempo(h.ultima_actividad)) + '</span>' : '') +
        '</span></div>' +
      (partesSol.length ? '<p class="je2-sol">' + U.ico('bandeja', 13) + U.esc(partesSol.join(' · ')) + '</p>' : '') +
      (lista.length ? '<ul class="je2-tareas">' + lista.map(filaTarea).join('') + '</ul>' : '<p class="sx2-tenue" style="margin:0;font-size:.8125rem">Sin tareas abiertas.</p>') +
      (t.lista.length > MAX_TAREAS ? '<button type="button" class="sx2-enlace js-je2-mas" data-email="' + U.esc(p.email) + '">' +
        (abierta ? 'Ver menos' : 'Ver las ' + t.lista.length + ' tareas') + U.ico(abierta ? 'arriba' : 'abajo', 14) + '</button>' : '') +
    '</section>';
  }

  function pintar(silencioso) {
    var c = contenedor();
    if (!c || !datos_) return;
    var y = window.scrollY, d = datos_;
    var cuerpo;
    if (!d.personas.length) {
      cuerpo = U.card({ i: 1, cuerpo: U.vacio({ icono: 'equipo', titulo: 'Aún no tienes equipo configurado',
        texto: 'Mi departamento muestra el trabajo de las personas a tu cargo. Pide a Administración que configure tu jefatura.' }) });
    } else {
      var avisos = [];
      if (d.resumen.sin_registro_7d) avisos.push(d.resumen.sin_registro_7d + (d.resumen.sin_registro_7d === 1 ? ' persona tiene tareas abiertas y no registró horas' : ' personas tienen tareas abiertas y no registraron horas') + ' en los últimos 7 días.');
      var vacias = d.personas.filter(function (p) { return p.sin_actividad; }).length;
      if (vacias) avisos.push(vacias + (vacias === 1 ? ' persona no tiene' : ' personas no tienen') + ' ninguna actividad en SIGSO.');
      cuerpo = kpis(d.resumen) +
        (avisos.length ? '<div class="je2-aviso sx2-entra" style="--i:1">' + U.ico('info', 16) + '<span>' + U.esc(avisos.join(' ')) + '</span></div>' : '') +
        '<div class="je2-personas">' + d.personas.map(tarjetaPersona).join('') + '</div>';
    }
    c.innerHTML = '<div class="sx2-pagina">' + cabecera(d) + cuerpo + '</div>';
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    U.animar(c);
  }

  // --- Acciones -----------------------------------------------------------------------
  function pedirActualizacion(id) {
    PY.formulario({
      titulo: 'Pedir una actualización',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Le llega un correo de inmediato.</span>',
      campos: PY.campo('Nota (opcional)', '<textarea class="sx2-input" name="nota" maxlength="1000" placeholder="¿Cómo vas con esto?"></textarea>'),
      boton: 'Enviar', ocupado: 'Enviando…',
      enviar: function (x) { return api('pedirActualizacionActividad', { actividad_id: id, nota: x.nota || '' }); },
      aviso: 'Se le avisó por correo.',
      listo: function () {}
    });
  }
  function reasignar(id) {
    var opciones = datos_.personas.map(function (p) { return p.email; }).concat([PY.miEmail()]);
    PY.formulario({
      titulo: 'Reasignar tarea',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Queda pendiente de que la nueva persona la confirme.</span>',
      campos: PY.campo('Nuevo responsable', '<select class="sx2-select" name="responsable_nuevo">' + opciones.map(function (e) {
          return '<option value="' + U.esc(e) + '">' + U.esc(PY.persona(e).nombre + (e === PY.miEmail() ? ' (yo)' : '')) + '</option>';
        }).join('') + '</select>') +
        PY.campo('Motivo', '<textarea class="sx2-input" name="motivo" maxlength="500" placeholder="Queda en la bitácora de la tarea"></textarea>'),
      boton: 'Reasignar', ocupado: 'Reasignando…',
      preparar: function (x) { return x.motivo ? x : 'Indica el motivo de la reasignación.'; },
      enviar: function (x) { return api('reasignarActividad', { actividad_id: id, responsable_nuevo: x.responsable_nuevo, motivo: x.motivo }); },
      aviso: 'Reasignada: queda pendiente de que la confirme.',
      listo: function () { cargar(true); }
    });
  }

  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('jefatura-v2');
    if (!raiz || !raiz.contains(ev.target)) return;
    var t = ev.target, b;
    if (t.closest('.js-je2-recargar')) { cargar(!!datos_); return; }
    if (!datos_) return;
    if ((b = t.closest('.js-je2-pedir'))) { pedirActualizacion(b.getAttribute('data-id')); return; }
    if ((b = t.closest('.js-je2-reasignar'))) { reasignar(b.getAttribute('data-id')); return; }
    if ((b = t.closest('.js-je2-mas'))) { var e = b.getAttribute('data-email'); expandidos_[e] = !expandidos_[e]; pintar(true); }
  });

  function activo() { try { return localStorage.getItem(CLAVE_PREF) !== '0'; } catch (e) { return true; } }
  function usarVersion(v2) {
    try { localStorage.setItem(CLAVE_PREF, v2 ? '1' : '0'); } catch (e) { /* sin storage: no se recuerda */ }
    document.dispatchEvent(new CustomEvent('sigso:v2-version', { detail: { modulo: 'jefatura', v2: !!v2 } }));
  }

  window.SigsoJefaturaV2 = {
    mostrar: function () { cargar(!!datos_ && !!document.getElementById('jefatura-v2')); },
    cargar: function () { if (window.SigsoJefatura) SigsoJefatura.irAItem('resumen'); },
    refrescar: function () { cargar(true); },
    activo: activo, usarVersion: usarVersion, desmontar: desmontar
  };
  if (window.SigsoJefatura && SigsoJefatura.registrarArbol) SigsoJefatura.registrarArbol();
})();
