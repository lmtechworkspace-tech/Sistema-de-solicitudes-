/**
 * coordinacion-v2.js — Coordinación de pausas: "Hoy" v2 (SIGSO v2, Módulo
 * 5A; análisis y decisiones en documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 * Qué cambia respecto de la vista clásica:
 *  - La pausa de hoy dice si va tarde ("debió empezar hace 12 min") y quién
 *    la inició; si la coordinación no llega, desde la hora + tolerancia
 *    cualquiera de la lista puede iniciarla (decisión del dueño).
 *  - "Últimos días": una franja con cada pausa (realizada / no realizada,
 *    participación, atraso) — una caída como la de septiembre se ve de una.
 *  - "Quién inicia": muestra la dependencia de una sola persona.
 *  - "Ánimo": quién marcó Mal o Muy mal en 14 días, para acercarse (solo
 *    aquí, sin correos).
 * Mismos endpoints para operar (gestionarPausaCoordinador,
 * registrarAsistenciaGrupalPausas, descargarEvidenciaPausa). Historial por
 * trabajador y Cumplimiento siguen en coordinacion.js.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var MOTIVOS = ['En terreno / fuera de la oficina', 'En reunión', 'Atendiendo un cliente', 'Licencia / permiso', 'Problema de salud', 'No me enteré a tiempo', 'Otro'];
  var ANIMO = ['Muy mal', 'Mal', 'Regular', 'Bien', 'Muy bien'];
  var ETIQUETA = { Programada: 'Programada', Recordatorio_enviado: 'Programada', En_curso: 'En curso', Realizada: 'Realizada', Cerrada: 'Realizada', No_realizada: 'No realizada', Suspendida: 'Suspendida', Cancelada: 'Cancelada' };
  var TONO = { Programada: 'info', Recordatorio_enviado: 'info', En_curso: 'primario', Realizada: 'ok', Cerrada: 'ok', No_realizada: 'critico', Suspendida: 'neutro', Cancelada: 'neutro' };
  var datos_ = null, turno_ = 0;

  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  function minutosAhora() {
    var t = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).split(':');
    return Number(t[0]) * 60 + Number(t[1]);
  }
  function aMin(hhmm) { var m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
  function horaDe(iso) { return iso ? new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : ''; }
  function diaCorto(clave) {
    var d = new Date(clave + 'T12:00:00');
    return ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][d.getDay()] + ' ' + clave.slice(8, 10) + '/' + clave.slice(5, 7);
  }

  // #coordinacion-v2 lo comparten Hoy (aquí) e Historial/Cumplimiento
  // (coordinacion-vistas-v2.js): una respuesta tardía de Hoy no pinta encima.
  function esHoy() { return !window.SigsoCoordinacion || !SigsoCoordinacion.vista || SigsoCoordinacion.vista() === 'hoy'; }

  // --- Montaje ----------------------------------------------------------------------
  function seccion() { return document.getElementById('modulo-pausas_coordinacion'); }
  function contenedor() {
    var s = seccion();
    if (!s) return null;
    var c = document.getElementById('coordinacion-v2');
    if (!c) {
      c = document.createElement('div');
      c.id = 'coordinacion-v2';
      c.className = 'sx2';
      s.appendChild(c);
    }
    s.classList.add('coord-v2-activa');
    return c;
  }
  function desmontar() {
    var s = seccion();
    if (s) s.classList.remove('coord-v2-activa');
    var c = document.getElementById('coordinacion-v2');
    if (c) c.remove();
  }

  function cargar(silencioso) {
    var c = contenedor();
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !datos_) c.innerHTML = '<div class="sx2-pagina">' + cabecera(null) + U.esqueleto('tarjetas', 3) + '</div>';
    Promise.all([api('getPanelCoordinadorPausas', {}), PY.cargarMiPerfil()]).then(function (r) {
      if (t !== turno_ || !esHoy()) return;
      if (!r[0] || !r[0].ok) {
        c.innerHTML = '<div class="sx2-pagina">' + cabecera(null) + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar la coordinación',
          texto: (r[0] && r[0].message) || 'Inténtalo de nuevo.', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-co2-recargar' }) }) }) + '</div>';
        return;
      }
      datos_ = r[0].data;
      pintar(!!silencioso);
    });
  }

  // --- Pintado ------------------------------------------------------------------------
  function cabecera(d) {
    var p = d && d.pausas && d.pausas[0];
    return '<header class="sx2-cabecera sx2-entra">' +
      '<div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Coordinación de pausas</span><h1>Pausa de hoy</h1>' +
        '<span class="sx2-tenue" style="font-size:.875rem">' + (p ? U.esc(p.empresa_id + ' · ' + (p.hora_programada || '—') + ' · ' + (p.duracion_min || '—') + ' min') : 'Opera la pausa del día y mira cómo viene el programa.') + '</span></div>' +
      '<div class="sx2-cabecera__acciones">' + U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-co2-recargar' }) + '</div>' +
    '</header>';
  }

  function momento(p) {
    var ahora = minutosAhora(), prog = aMin(p.hora_programada);
    if (p.estado === 'Programada' || p.estado === 'Recordatorio_enviado') {
      if (prog === null) return { txt: 'Programada', tono: 'info' };
      if (ahora < prog) return { txt: 'Empieza a las ' + p.hora_programada + ' (en ' + (prog - ahora) + ' min)', tono: 'info' };
      return { txt: 'Debió empezar hace ' + (ahora - prog) + ' min', tono: ahora - prog > 5 ? 'critico' : 'alerta' };
    }
    if (p.estado === 'En_curso') return { txt: 'En curso desde las ' + horaDe(p.hora_inicio_real) + (p.iniciada_por ? ' · la inició ' + PY.persona(p.iniciada_por).nombre : ''), tono: 'primario' };
    if (p.estado === 'Realizada' || p.estado === 'Cerrada') return { txt: 'Realizada ' + horaDe(p.hora_inicio_real) + (p.hora_fin ? '–' + horaDe(p.hora_fin) : ''), tono: 'ok' };
    if (p.estado === 'No_realizada') return { txt: 'No realizada' + (p.observaciones ? ': ' + p.observaciones : ''), tono: 'critico' };
    return { txt: ETIQUETA[p.estado] || p.estado, tono: 'neutro' };
  }

  function lista(titulo, gente, tono, conMotivo) {
    return '<div class="co2-lista sx2-tono-' + tono + '"><h3>' + U.esc(titulo) + ' <span>' + gente.length + '</span></h3>' +
      (gente.length ? '<ul>' + gente.map(function (g) {
        var per = PY.persona(g.email, g.nombre);
        return '<li>' + U.avatar(per, 'xs') + '<span class="sx2-cortar">' + U.esc(per.nombre) + '</span>' + (conMotivo && g.motivo ? '<small class="sx2-tenue sx2-cortar">' + U.esc(g.motivo) + '</small>' : '') + '</li>';
      }).join('') + '</ul>' : '<p class="sx2-tenue">Nadie.</p>') + '</div>';
  }

  function tarjetaHoy(p, i) {
    var part = p.participacion || {};
    var m = momento(p);
    var abierta = ['Programada', 'Recordatorio_enviado', 'En_curso'].indexOf(p.estado) !== -1;
    var acciones = '';
    if (p.estado === 'Programada' || p.estado === 'Recordatorio_enviado') {
      acciones = U.boton({ texto: 'Iniciar pausa', icono: 'rayo', variante: 'primario', clase: 'js-co2-iniciar', datos: { id: p.pausa_id } }) +
        U.boton({ texto: 'No se realizó', icono: 'equis', variante: 'texto-peligro', clase: 'js-co2-no', datos: { id: p.pausa_id } });
    } else if (p.estado === 'En_curso') {
      acciones = U.boton({ texto: 'Finalizar', icono: 'check', variante: 'primario', clase: 'js-co2-finalizar', datos: { id: p.pausa_id } }) +
        U.boton({ texto: 'No se realizó', icono: 'equis', variante: 'texto-peligro', clase: 'js-co2-no', datos: { id: p.pausa_id } });
    }
    if (abierta && part.n_pendientes) acciones += U.boton({ texto: 'Pasar lista (' + part.n_pendientes + ')', icono: 'lista', clase: 'js-co2-lista', datos: { id: p.pausa_id } });
    if (p.evidencia_url) acciones += U.boton({ texto: 'Ver evidencia', icono: 'imagen', variante: 'fantasma', clase: 'js-co2-evidencia', datos: { id: p.pausa_id } });
    return '<section class="sx2-card co2-hoy sx2-entra" style="--i:' + (i + 1) + '">' +
      '<div class="co2-hoy__cab">' +
        U.anillo(part.pct_participacion || 0, { tam: 84, grosor: 9, tono: (part.pct_participacion || 0) >= 80 ? 'ok' : ((part.pct_participacion || 0) >= 50 ? 'alerta' : 'primario'), texto: part.pct_participacion === null || part.pct_participacion === undefined ? '—' : Math.round(part.pct_participacion) + '%' }) +
        '<span class="sx2-apilado" style="gap:6px;min-width:0;flex:1">' +
          '<span class="sx2-flex" style="gap:8px;flex-wrap:wrap">' + U.badge(ETIQUETA[p.estado] || p.estado, TONO[p.estado] || 'neutro') + (datos_.empresas && datos_.empresas.length > 1 ? U.badge(p.empresa_id, 'neutro', true) : '') + '</span>' +
          '<strong class="co2-momento sx2-tono-' + m.tono + '">' + U.esc(m.txt) + '</strong>' +
          '<span class="sx2-tenue" style="font-size:.8125rem">' + (part.n_participaron || 0) + ' de ' + (part.total_roster || 0) + ' participaron · ' + (part.n_justificaron || 0) + ' justificaron · ' + (part.n_pendientes || 0) + ' pendientes</span>' +
        '</span></div>' +
      (acciones ? '<div class="co2-acciones">' + acciones + '</div>' : '') +
      '<div class="co2-listas">' + lista('Participaron', part.participaron || [], 'ok') + lista('Justificaron', part.justificaron || [], 'alerta', true) + lista('Pendientes', part.pendientes || [], 'neutro') + '</div>' +
      '<div class="co2-evidencia" id="co2-ev-' + U.esc(p.pausa_id) + '"></div>' +
    '</section>';
  }

  function tarjetaUltimos(ds) {
    if (!ds || !ds.length) return '';
    var hechas = ds.filter(function (d) { return d.estado === 'Realizada' || d.estado === 'Cerrada'; });
    var tarde = hechas.filter(function (d) { return d.minutos_tarde !== null && d.minutos_tarde >= 10; }).length;
    var prom = hechas.length ? Math.round(hechas.reduce(function (s, d) { return s + (d.pct_participacion || 0); }, 0) / hechas.length) : null;
    // Racha de no realizadas al final: la señal de que el programa se cayó.
    var caidas = 0;
    for (var i = ds.length - 1; i >= 0 && ds[i].estado === 'No_realizada'; i--) caidas++;
    return U.card({ titulo: 'Últimas ' + ds.length + ' pausas', icono: 'calendario', i: 3, cuerpo:
      (caidas >= 2 ? '<p class="co2-alerta sx2-tono-critico">' + U.ico('alerta', 15) + 'Las últimas ' + caidas + ' pausas no se realizaron.</p>' : '') +
      '<div class="co2-dias">' + ds.map(function (d) {
        var tono = TONO[d.estado] || 'neutro';
        var tip = diaCorto(d.fecha) + ' · ' + (ETIQUETA[d.estado] || d.estado) + (d.pct_participacion !== null ? ' · ' + d.pct_participacion + '% participación' : '') +
          (d.minutos_tarde !== null ? ' · empezó ' + (d.minutos_tarde > 0 ? d.minutos_tarde + ' min tarde' : 'a tiempo') : '') + (d.iniciada_por_nombre ? ' · la inició ' + d.iniciada_por_nombre : '');
        return '<span class="co2-dia sx2-tono-' + tono + '" title="' + U.esc(tip) + '"><i style="height:' + (d.estado === 'No_realizada' ? 100 : Math.max(8, d.pct_participacion || 0)) + '%"></i><b>' + U.esc(d.fecha.slice(8, 10)) + '</b></span>';
      }).join('') + '</div>' +
      '<p class="sx2-tenue" style="margin:8px 0 0;font-size:.8125rem">' + hechas.length + ' de ' + ds.length + ' realizadas' +
        (prom !== null ? ' · participación promedio ' + prom + ' %' : '') + (tarde ? ' · ' + tarde + ' empezaron 10+ min tarde' : '') + '. La altura es la participación; en rojo, las no realizadas.</p>' });
  }

  function tarjetaQuien(q, tol) {
    if (!q || !q.length) return '';
    var total = q.reduce(function (s, x) { return s + x.cantidad; }, 0);
    var top = q[0];
    var depende = total >= 5 && top.cantidad / total >= 0.7;
    return U.card({ titulo: 'Quién inicia las pausas', icono: 'persona', sub: 'últimos 60 días', i: 4, cuerpo:
      '<ul class="co2-quien">' + q.map(function (x) {
        var per = PY.persona(x.email, x.nombre);
        return '<li>' + (x.email ? U.avatar(per, 'xs') : '') + '<span class="sx2-cortar">' + U.esc(per.nombre) + '</span>' +
          '<span class="co2-quien__barra"><i style="width:' + Math.round(x.cantidad * 100 / total) + '%"></i></span><b>' + x.cantidad + '</b></li>';
      }).join('') + '</ul>' +
      (depende ? '<p class="co2-nota">' + U.ico('info', 14) + '<span>' + U.esc(PY.persona(top.email, top.nombre).nombre) + ' inició ' + Math.round(top.cantidad * 100 / total) + ' % de las pausas. Ahora, si la coordinación no llega, cualquiera de la lista puede iniciarla ' + tol + ' minutos después de la hora.</span></p>' : '') });
  }

  function tarjetaAnimo(a) {
    var cuerpo = !a || !a.length
      ? U.vacio({ icono: 'check', texto: 'Nadie marcó "Mal" o "Muy mal" en los últimos 14 días.' })
      : '<ul class="co2-animo">' + a.map(function (x) {
          var per = PY.persona(x.email, x.nombre);
          return '<li>' + U.avatar(per, 'sm') + '<span class="sx2-apilado" style="gap:2px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(per.nombre) + '</strong>' +
            '<span class="sx2-tenue" style="font-size:.75rem">' + x.bajos + ' de ' + x.respuestas + (x.respuestas === 1 ? ' respuesta' : ' respuestas') + ' en Mal o Muy mal · última: ' + U.esc(ANIMO[x.ultimo.valor - 1] + ' (' + diaCorto(x.ultimo.fecha) + ')') + '</span></span>' +
            '<span class="co2-animo__puntos">' + x.valores.map(function (v) {
              return '<i class="sx2-tono-' + (v.valor <= 2 ? 'critico' : (v.valor === 3 ? 'alerta' : 'ok')) + '" title="' + U.esc(diaCorto(v.fecha) + ': ' + ANIMO[v.valor - 1]) + '"></i>';
            }).join('') + '</span></li>';
        }).join('') + '</ul>';
    return U.card({ titulo: 'Ánimo: para acercarse', icono: 'persona', sub: 'últimos 14 días', i: 5, cuerpo: cuerpo +
      '<p class="sx2-tenue" style="margin:8px 0 0;font-size:.75rem">Solo lo ve la coordinación. Es una señal para conversar, no una evaluación.</p>' });
  }

  function pintar(silencioso) {
    if (!esHoy()) return;
    var c = contenedor();
    if (!c || !datos_) return;
    var d = datos_, y = window.scrollY;
    var cuerpo;
    if (d.sin_empresa) {
      cuerpo = U.card({ i: 1, cuerpo: U.vacio({ icono: 'persona', titulo: 'No coordinas ninguna empresa', texto: 'Pide al administrador que te registre como coordinador(a) de pausas.' }) });
    } else {
      cuerpo = (d.pausas && d.pausas.length ? d.pausas.map(tarjetaHoy).join('')
          : U.card({ i: 1, cuerpo: U.vacio({ icono: 'calendario', titulo: 'Sin pausa hoy', texto: 'No hay una pausa programada para hoy en tu(s) empresa(s).' }) })) +
        '<div class="sx2-grid sx2-grid--estira">' +
          '<div class="sx2-col-12">' + tarjetaUltimos(d.ultimos_dias) + '</div>' +
          '<div class="sx2-col-6 sx2-col--apila">' + tarjetaQuien(d.quien_inicia, d.tolerancia_inicio_min || 5) + '</div>' +
          '<div class="sx2-col-6 sx2-col--apila">' + tarjetaAnimo(d.animo_alertas) + '</div>' +
        '</div>';
    }
    c.innerHTML = '<div class="sx2-pagina">' + cabecera(d) + cuerpo + '</div>';
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    U.animar(c);
  }

  // --- Acciones -----------------------------------------------------------------------
  function pausa(id) { return (datos_.pausas || []).filter(function (p) { return p.pausa_id === id; })[0]; }
  function operar(payload, aviso) {
    return api('gestionarPausaCoordinador', payload).then(function (r) {
      if (r && r.ok) { PY.aviso(aviso, 'exito'); cargar(true); }
      return r;
    });
  }
  function leerBase64(file) {
    return new Promise(function (ok, mal) {
      var l = new FileReader();
      l.onload = function () { ok(String(l.result).split(',')[1] || ''); };
      l.onerror = mal;
      l.readAsDataURL(file);
    });
  }
  function finalizar(id) {
    PY.formulario({
      titulo: 'Finalizar la pausa', boton: 'Finalizar', ocupado: 'Guardando…',
      campos: PY.campo('Observaciones (opcional)', '<textarea class="sx2-input" name="observaciones" maxlength="1000" placeholder="Qué se hizo, algo a destacar"></textarea>') +
        PY.campo('Foto de evidencia (opcional)', '<input class="sx2-input" type="file" name="foto" accept="image/png,image/jpeg,image/gif">', 'JPG, PNG o GIF, hasta 5 MB.'),
      preparar: function (x, form) {
        var f = form.querySelector('[name=foto]').files[0];
        var base = { pausa_id: id, operacion: 'finalizar', observaciones: x.observaciones || '' };
        if (!f) return base;
        if (f.size > 5 * 1024 * 1024) return 'La foto supera 5 MB.';
        return leerBase64(f).then(function (b64) { return Object.assign(base, { evidencia_nombre: f.name, evidencia_base64: b64 }); });
      },
      enviar: function (datos) { return api('gestionarPausaCoordinador', datos); },
      aviso: 'Pausa finalizada.', listo: function () { cargar(true); }
    });
  }
  function noRealizada(id) {
    PY.formulario({
      titulo: 'Marcar como no realizada', boton: 'Guardar', ocupado: 'Guardando…',
      campos: PY.campo('¿Por qué no se realizó?', '<textarea class="sx2-input" name="motivo" maxlength="500" placeholder="Queda en el registro del programa"></textarea>'),
      preparar: function (x) { return x.motivo ? { pausa_id: id, operacion: 'no_realizada', motivo: x.motivo } : 'Indica el motivo.'; },
      enviar: function (datos) { return api('gestionarPausaCoordinador', datos); },
      aviso: 'Registrada como no realizada.', listo: function () { cargar(true); }
    });
  }
  function pasarLista(id) {
    var p = pausa(id);
    var pend = (p && p.participacion && p.participacion.pendientes) || [];
    if (!pend.length) return;
    PY.formulario({
      titulo: 'Pasar lista', boton: 'Guardar', ocupado: 'Guardando…',
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Marca a quienes participaron o no pudieron. Lo que no toques queda pendiente.</span>',
      campos: '<ul class="co2-pasar">' + pend.map(function (t) {
        var per = PY.persona(t.email, t.nombre);
        return '<li>' + U.persona(per, 'sm') +
          '<select class="sx2-select" name="t_' + U.esc(t.trabajador_id) + '"><option value="">Sin marcar</option><option value="participo">Participó</option>' +
          MOTIVOS.map(function (m) { return '<option value="no:' + U.esc(m) + '">No pudo · ' + U.esc(m) + '</option>'; }).join('') + '</select></li>';
      }).join('') + '</ul>',
      preparar: function (x) {
        var registros = [];
        Object.keys(x).forEach(function (k) {
          if (k.indexOf('t_') !== 0 || !x[k]) return;
          var v = x[k];
          registros.push(v === 'participo' ? { trabajador_id: k.slice(2), estado: 'participo' } : { trabajador_id: k.slice(2), estado: 'no_participo', motivo: v.slice(3) });
        });
        return registros.length ? { pausa_id: id, registros: registros } : 'Marca al menos a una persona.';
      },
      enviar: function (datos) { return api('registrarAsistenciaGrupalPausas', datos); },
      aviso: 'Lista guardada.', listo: function () { cargar(true); }
    });
  }
  function verEvidencia(id, b) {
    var destino = document.getElementById('co2-ev-' + id);
    b.disabled = true;
    api('descargarEvidenciaPausa', { pausa_id: id }).then(function (r) {
      b.disabled = false;
      if (!destino) return;
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo cargar la evidencia.', 'error'); return; }
      destino.innerHTML = '<img src="data:' + U.esc(r.data.mime) + ';base64,' + r.data.contenido_base64 + '" alt="Evidencia de la pausa">';
    });
  }

  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('coordinacion-v2');
    if (!raiz || !raiz.contains(ev.target) || !esHoy()) return;
    var t = ev.target, b;
    if (t.closest('.js-co2-recargar')) { cargar(!!datos_); return; }
    if (!datos_) return;
    if ((b = t.closest('.js-co2-iniciar'))) { b.disabled = true; operar({ pausa_id: b.getAttribute('data-id'), operacion: 'iniciar' }, 'Pausa iniciada.').then(function (r) { if (!r || !r.ok) { b.disabled = false; PY.aviso((r && r.message) || 'No se pudo iniciar.', 'error'); } }); return; }
    if ((b = t.closest('.js-co2-finalizar'))) { finalizar(b.getAttribute('data-id')); return; }
    if ((b = t.closest('.js-co2-no'))) { noRealizada(b.getAttribute('data-id')); return; }
    if ((b = t.closest('.js-co2-lista'))) { pasarLista(b.getAttribute('data-id')); return; }
    if ((b = t.closest('.js-co2-evidencia'))) verEvidencia(b.getAttribute('data-id'), b);
  });

  // 2026-09-25: la versión clásica se retiró; la v2 es la única.
  function activo() { return true; }
  function usarVersion() { /* sin versión clásica */ }

  window.SigsoCoordinacionV2 = {
    mostrar: function () { cargar(!!datos_ && !!document.getElementById('coordinacion-v2')); },
    cargar: function () { if (window.SigsoCoordinacion) SigsoCoordinacion.irAItem('hoy'); },
    refrescar: function () { cargar(true); },
    activo: activo, usarVersion: usarVersion, desmontar: desmontar
  };
})();
