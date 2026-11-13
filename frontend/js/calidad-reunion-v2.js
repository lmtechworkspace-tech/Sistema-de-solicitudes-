/**
 * calidad-reunion-v2.js — Calidad › «Reunión semanal» (Plan de control y
 * certificación, P5; backend reunionCoordinacion.js).
 *
 * Se usa EN la reunión de los lunes, proyectada o en el computador de quien
 * la conduce:
 *  - arriba, el avance: cuántos atrasos ya tienen su causa y cómo se cubre;
 *  - la asistencia, tocando a cada participante;
 *  - los atrasos uno por uno: por qué no se cumplió (lista de causas), cómo se
 *    cubre, nueva fecha y otro responsable si cambia. Se guarda solo al
 *    cambiar cada campo;
 *  - lo que vence esta semana y las tareas dormidas, para mirar;
 *  - los acuerdos, que quedan como tareas con responsable y fecha;
 *  - «Cerrar y enviar acta» (no deja cerrar con atrasos sin explicar);
 *  - «Por qué no se cumple»: las causas de las últimas 8 reuniones.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  function C() { return window.SigsoCalidadV2.util; }
  function api(a, d) {
    return C().api(a, d).then(function (r) {
      if (r && r.ok && r.data && r.data._validationError) return { ok: false, message: r.data.message };
      return r;
    });
  }
  var esc = function (s) { return U.esc(s); };
  var VISTA = 'reunion';
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var st_ = { lista: null, datos: null, reunion: '', turno: 0, guardando: 0 };

  function fecha(d) { return d ? Number(d.slice(8, 10)) + ' ' + MESES[Number(d.slice(5, 7)) - 1] : '—'; }
  function hoyClave() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()); }
  function puede() { return !!(st_.datos && st_.datos.puede_gestionar); }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : b); }
  function completo(i) { return !!i.causa && !!(i.como_se_cubre || i.nueva_fecha); }
  function aExplicar(i) { return i.tipo === 'ATRASO' || i.tipo === 'COMPROMISO'; }

  function cabecera(acciones) {
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Calidad · Control de gestión</span>' +
      '<h1>Reunión semanal</h1><span class="sx2-tenue" style="font-size:.875rem">Lunes 9:00, 30 minutos: cada atraso con su causa y cómo se cubre, y acuerdos con responsable y fecha.</span></div>' +
      '<div class="sx2-cabecera__acciones">' + (acciones || '') + U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-rc2-recargar' }) + '</div></header>';
  }
  function pagina(html, silencioso) {
    var c = C().contenedor(VISTA);
    if (!c) return;
    var y = window.scrollY;
    c.innerHTML = '<div class="sx2-pagina rc2">' + html + '</div>';
    if (silencioso) { c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; }); window.scrollTo(0, y); }
    U.animar(c);
  }

  function cargar(silencioso) {
    var t = ++st_.turno;
    if (!C().contenedor(VISTA)) return;
    if (!silencioso || !st_.datos) pagina(cabecera() + U.esqueleto('kpis', 4) + U.esqueleto('tabla', 6));
    Promise.all([api('listarReunionesCoordinacion', {}), api('getReunionCoordinacion', st_.reunion ? { reunion_id: st_.reunion } : {})]).then(function (r) {
      if (t !== st_.turno || !C().ocupa(VISTA)) return;
      if (!r[0] || !r[0].ok) { pagina(cabecera() + U.card({ cuerpo: U.vacio({ icono: 'candado', titulo: 'No se pudo abrir', texto: (r[0] && r[0].message) || 'Inténtalo de nuevo.' }) })); return; }
      st_.lista = r[0].data;
      st_.datos = r[1] && r[1].ok ? r[1].data : null;
      if (st_.datos && st_.datos.reunion) st_.reunion = st_.datos.reunion.reunion_id;
      pintar(!!silencioso);
    });
  }

  // --- piezas -------------------------------------------------------------------------
  function causas(est) {
    if (!est || !est.total) return U.card({ titulo: 'Por qué no se cumple', icono: 'grafico', i: 9, cuerpo: '<p class="sx2-tenue rc2-nada">Cuando se cierren reuniones con atrasos explicados, aquí aparecen las causas más repetidas: la base para decidir recursos.</p>' });
    var max = est.causas[0].n;
    return U.card({ titulo: 'Por qué no se cumple', icono: 'grafico', i: 9, sub: 'últimas ' + plural(est.reuniones, 'reunión', 'reuniones') + ' · ' + plural(est.total, 'atraso', 'atrasos'),
      cuerpo: '<ul class="rc2-causas">' + est.causas.map(function (c) {
        return '<li><span class="rc2-causas__n">' + esc(c.nombre) + '</span>' + U.barra(c.n * 100 / max, c.clave === 'FALTA_PERSONAL' || c.clave === 'SOBRECARGA' ? 'alerta' : 'primario') +
          '<strong>' + c.n + ' <small>(' + String(c.pct).replace('.', ',') + ' %)</small></strong></li>';
      }).join('') + '</ul>' });
  }

  function selectCausa(i) {
    return '<select class="sx2-select js-rc2-campo" data-campo="causa" data-id="' + esc(i.item_id) + '" aria-label="Por qué no se cumplió"' + (puede() ? '' : ' disabled') + '>' +
      '<option value="">Elegir…</option>' + st_.datos.causas.map(function (c) { return '<option value="' + c.clave + '"' + (i.causa === c.clave ? ' selected' : '') + '>' + esc(c.nombre) + '</option>'; }).join('') + '</select>';
  }
  function selectPersona(i) {
    return '<select class="sx2-select js-rc2-campo" data-campo="nuevo_responsable" data-id="' + esc(i.item_id) + '" aria-label="Otro responsable"' + (puede() ? '' : ' disabled') + '>' +
      '<option value="">Mismo responsable</option>' + (st_.datos.personas || []).map(function (p) { return '<option value="' + esc(p.email) + '"' + (i.nuevo_responsable === p.email ? ' selected' : '') + '>' + esc(p.nombre) + '</option>'; }).join('') + '</select>';
  }
  function filaAtraso(i, k) {
    var listo = completo(i);
    var etiqueta = i.tipo === 'COMPROMISO' ? U.badge('Compromiso no cumplido', 'critico') : U.badge(i.origen === 'NC' ? 'No conformidad' : (i.origen === 'AGENDA' ? 'Agenda del área' : 'Tarea'), 'alerta');
    var cuerpo = puede()
      ? '<div class="rc2-atraso__campos">' +
          '<label class="rc2-fecha"><span>Por qué no se cumplió</span>' + selectCausa(i) + '</label>' +
          '<label class="rc2-fecha"><span>Cómo se cubre</span><input class="sx2-input js-rc2-campo" data-campo="como_se_cubre" data-id="' + esc(i.item_id) + '" value="' + esc(i.como_se_cubre || '') + '" placeholder="Qué se hace y quién"></label>' +
          '<label class="rc2-fecha"><span>Nueva fecha</span><input class="sx2-input js-rc2-campo" type="date" data-campo="nueva_fecha" data-id="' + esc(i.item_id) + '" value="' + esc(i.nueva_fecha || '') + '"></label>' +
          '<label class="rc2-fecha"><span>Otro responsable</span>' + selectPersona(i) + '</label></div>'
      : '<p class="rc2-atraso__lectura"><strong>Por qué:</strong> ' + esc(((st_.datos.causas.filter(function (c) { return c.clave === i.causa; })[0]) || {}).nombre || '—') +
          ' · <strong>Cómo se cubre:</strong> ' + esc(i.como_se_cubre || '—') + (i.nueva_fecha ? ' · nueva fecha ' + esc(fecha(i.nueva_fecha)) : '') + '</p>';
    return '<li class="rc2-atraso sx2-tono-' + (listo ? 'ok' : (i.tipo === 'COMPROMISO' ? 'critico' : 'alerta')) + '" id="rc2-' + esc(i.item_id) + '">' +
      '<span class="rc2-atraso__n">' + (listo ? U.ico('check', 14) : (k + 1)) + '</span>' +
      '<div class="rc2-atraso__cuerpo"><div class="rc2-atraso__cab">' + etiqueta + '<strong>' + esc(i.titulo) + '</strong></div>' +
        '<span class="rc2-atraso__meta">' + esc(i.responsable_nombre || 'Sin responsable') + ' · venció el ' + esc(fecha(i.meta)) + ' (hace ' + plural(Number(i.dias) || 0, 'día', 'días') + ')</span>' +
        (i.detalle ? '<span class="rc2-atraso__det">' + esc(i.detalle) + '</span>' : '') + cuerpo + '</div></li>';
  }
  function listaCorta(items, vacio) {
    if (!items.length) return '<p class="sx2-tenue rc2-nada">' + esc(vacio) + '</p>';
    return '<ul class="rc2-corta">' + items.map(function (i) {
      return '<li><span class="rc2-corta__t">' + esc(i.titulo) + '</span><span class="rc2-corta__q">' + esc(i.responsable_nombre || '') + '</span><span class="rc2-corta__f">' +
        (i.tipo === 'SEMANA' ? esc(fecha(i.meta)) : plural(Number(i.dias) || 0, 'día', 'días')) + '</span></li>';
    }).join('') + '</ul>';
  }

  function pintar(silencioso) {
    var L = st_.lista, d = st_.datos;
    var abierta = (L.reuniones || []).some(function (r) { return r.estado === 'ABIERTA'; });
    var sel = L.reuniones.length > 1 ? '<select class="sx2-select js-rc2-reunion" aria-label="Reunión">' + L.reuniones.map(function (r) {
      return '<option value="' + esc(r.reunion_id) + '"' + (d && d.reunion && r.reunion_id === d.reunion.reunion_id ? ' selected' : '') + '>' + esc(fecha(r.fecha) + ' · ' + r.correlativo + (r.estado === 'ABIERTA' ? ' (abierta)' : '')) + '</option>';
    }).join('') + '</select>' : '';
    var acciones = sel + (L.puede_gestionar && !abierta ? U.boton({ texto: 'Abrir la reunión de hoy', icono: 'nueva', variante: 'primario', clase: 'js-rc2-abrir' }) : '');
    if (!d || !d.reunion) {
      pagina(cabecera(acciones) + U.card({ i: 1, cuerpo: U.vacio({ icono: 'equipo', titulo: 'Todavía no hay reuniones',
        texto: 'Al abrir la reunión, SIGSO arma la agenda sola: los atrasos (contra la fecha original), lo que vence esta semana, las tareas dormidas, las no conformidades vencidas y los compromisos de la reunión anterior que no se cumplieron.',
        accion: L.puede_gestionar ? U.boton({ texto: 'Abrir la reunión de hoy', icono: 'nueva', variante: 'primario', clase: 'js-rc2-abrir' }) : '' }) }) + causas(L.estadistica), silencioso);
      return;
    }
    var r = d.reunion;
    var atrasos = d.items.filter(aExplicar);
    var hechos = atrasos.filter(completo).length;
    var semana = d.items.filter(function (i) { return i.tipo === 'SEMANA'; });
    var dormidas = d.items.filter(function (i) { return i.tipo === 'DORMIDA'; });
    var compromisos = atrasos.filter(function (i) { return i.tipo === 'COMPROMISO'; }).length;
    var pct = atrasos.length ? Math.round(hechos * 100 / atrasos.length) : 100;
    var cerrada = r.estado === 'CERRADA';
    var banner = '<section class="sx2-card rc2-banner sx2-entra sx2-tono-' + (cerrada ? 'ok' : (pct === 100 ? 'ok' : 'primario')) + '" style="--i:1">' +
      '<div class="rc2-banner__txt"><span class="rc2-eti">' + esc(r.correlativo) + ' · ' + (cerrada ? 'cerrada · acta enviada' : 'en curso') + '</span><h2>' + esc(r.titulo) + '</h2>' +
        '<div class="rc2-nums">' +
          '<span><strong>' + atrasos.length + '</strong> atrasos</span>' + (compromisos ? '<span class="rc2-nums--mal"><strong>' + compromisos + '</strong> compromisos no cumplidos</span>' : '') +
          '<span><strong>' + semana.length + '</strong> vencen esta semana</span><span><strong>' + dormidas.length + '</strong> dormidas</span><span><strong>' + d.acuerdos.length + '</strong> acuerdos</span></div></div>' +
      '<div class="rc2-avance"><span class="rc2-eti">Atrasos explicados</span><strong>' + hechos + ' / ' + atrasos.length + '</strong>' + U.barra(pct, pct === 100 ? 'ok' : 'primario', true) +
        (puede() ? U.boton({ texto: 'Cerrar y enviar acta', icono: 'correo', variante: 'primario', clase: 'js-rc2-cerrar' }) : '') + '</div></section>';
    var asist = '<section class="sx2-card rc2-asist sx2-entra" style="--i:2"><div class="sx2-card__cab"><h2 class="sx2-card__titulo">' + U.ico('equipo', 18) + 'Asistencia <span class="sx2-card__sub">' +
      (puede() ? 'toca a quien está presente' : '') + '</span></h2></div><div class="rc2-chips">' + r.participantes.map(function (p) {
        return '<button type="button" class="rc2-persona' + (p.asistio ? ' rc2-persona--si' : '') + (puede() ? ' js-rc2-asiste' : '') + '" data-email="' + esc(p.email) + '" aria-pressed="' + (p.asistio ? 'true' : 'false') + '"' + (puede() ? '' : ' disabled') + '>' +
          U.avatar({ nombre: p.nombre, email: p.email }, 'sm') + '<span>' + esc(p.nombre) + '</span>' + (p.asistio ? U.ico('check', 13) : '') + '</button>';
      }).join('') + (puede() ? '<select class="sx2-select js-rc2-sumar" aria-label="Agregar participante"><option value="">+ Agregar participante</option>' + (d.personas || []).filter(function (p) {
        return !r.participantes.some(function (x) { return x.email === p.email; });
      }).map(function (p) { return '<option value="' + esc(p.email) + '">' + esc(p.nombre) + '</option>'; }).join('') + '</select>' : '') + '</div></section>';
    var lista = '<section class="sx2-card rc2-lista sx2-entra" style="--i:3"><div class="sx2-card__cab"><h2 class="sx2-card__titulo">' + U.ico('alerta', 18) + 'Atrasos: por qué y cómo se cubre <span class="sx2-card__sub">' +
      (puede() ? 'se guarda solo al cambiar cada campo' : '') + '</span></h2></div>' +
      (atrasos.length ? '<ol class="rc2-atrasos">' + atrasos.map(filaAtraso).join('') + '</ol>' : '<p class="rc2-ok">' + U.ico('check', 16) + 'No hay atrasos esta semana.</p>') + '</section>';
    var mirar = '<div class="rc2-dos">' +
      U.card({ titulo: 'Vence esta semana', icono: 'calendario', i: 4, cuerpo: listaCorta(semana, 'Nada vence esta semana.') }) +
      U.card({ titulo: 'Tareas dormidas', icono: 'reloj', i: 5, sub: 'sin movimiento en 14 días', cuerpo: listaCorta(dormidas, 'Ninguna tarea dormida.') }) + '</div>';
    var acuerdos = '<section class="sx2-card rc2-acuerdos sx2-entra" style="--i:6"><div class="sx2-card__cab"><h2 class="sx2-card__titulo">' + U.ico('check', 18) + 'Acuerdos <span class="sx2-card__sub">quedan como tareas en Mi trabajo</span></h2></div>' +
      (d.acuerdos.length ? '<ul class="rc2-corta">' + d.acuerdos.map(function (a) {
        return '<li><span class="rc2-corta__t">' + esc(a.texto) + '</span><span class="rc2-corta__q">' + esc(a.responsable_nombre) + '</span><span class="rc2-corta__f">' + esc(fecha(a.fecha_compromiso)) + '</span></li>';
      }).join('') + '</ul>' : '<p class="sx2-tenue rc2-nada">Sin acuerdos todavía.</p>') +
      (puede() ? '<form class="rc2-nuevo js-rc2-acuerdo"><input class="sx2-input" name="texto" placeholder="Nuevo acuerdo (qué se hará)" required>' +
        '<select class="sx2-select" name="responsable_email" required><option value="">Responsable…</option>' + (d.personas || []).map(function (p) { return '<option value="' + esc(p.email) + '">' + esc(p.nombre) + '</option>'; }).join('') + '</select>' +
        '<input class="sx2-input" type="date" name="fecha_compromiso" required min="' + hoyClave() + '">' + U.boton({ texto: 'Agregar', icono: 'nueva', tipo: 'submit' }) + '</form>' : '') + '</section>';
    var minuta = puede() ? U.card({ titulo: 'Notas de la reunión', icono: 'comentario', i: 7, cuerpo: '<textarea class="sx2-input js-rc2-minuta" rows="3" placeholder="Lo que no cabe en los atrasos ni en los acuerdos (va al acta)">' + esc(r.minuta || '') + '</textarea>' })
      : (r.minuta ? U.card({ titulo: 'Notas de la reunión', icono: 'comentario', i: 7, cuerpo: '<p>' + esc(r.minuta) + '</p>' }) : '');
    pagina(cabecera(acciones) + banner + asist + lista + mirar + acuerdos + minuta + causas(L.estadistica), silencioso);
  }

  // --- acciones ---------------------------------------------------------------------------
  function guardarCampo(el) {
    var id = el.getAttribute('data-id'), campo = el.getAttribute('data-campo');
    var datos = { item_id: id };
    datos[campo] = el.value;
    st_.guardando++;
    api('guardarItemReunionCoordinacion', datos).then(function (r) {
      st_.guardando--;
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo guardar.', 'error'); return; }
      var it = st_.datos.items.filter(function (x) { return x.item_id === id; })[0];
      if (it) it[campo] = el.value;
      // Repinta solo el avance y el estado del punto (sin perder el foco del que escribe).
      var li = document.getElementById('rc2-' + id);
      if (li && it) {
        li.classList.remove('sx2-tono-ok', 'sx2-tono-alerta', 'sx2-tono-critico');
        li.classList.add('sx2-tono-' + (completo(it) ? 'ok' : (it.tipo === 'COMPROMISO' ? 'critico' : 'alerta')));
        var n = li.querySelector('.rc2-atraso__n');
        var k = Array.prototype.indexOf.call(li.parentNode.children, li);
        if (n) n.innerHTML = completo(it) ? U.ico('check', 14) : String(k + 1);
      }
      var atrasos = st_.datos.items.filter(aExplicar), hechos = atrasos.filter(completo).length;
      var av = document.querySelector('#calidad-v2 .rc2-avance strong');
      if (av) av.textContent = hechos + ' / ' + atrasos.length;
      var bar = document.querySelector('#calidad-v2 .rc2-avance .sx2-barra__relleno');
      if (bar) bar.style.width = (atrasos.length ? Math.round(hechos * 100 / atrasos.length) : 100) + '%';
    });
  }
  function guardarAsistencia(lista) {
    return api('guardarAsistenciaReunionCoordinacion', { reunion_id: st_.datos.reunion.reunion_id, participantes: lista }).then(function (r) {
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo guardar la asistencia.', 'error'); return; }
      st_.datos.reunion.participantes = r.data.participantes;
      pintar(true);
    });
  }

  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el.closest || !el.closest('#calidad-v2[data-vista="' + VISTA + '"]')) return;
    if (el.classList.contains('js-rc2-campo')) { guardarCampo(el); return; }
    if (el.classList.contains('js-rc2-reunion')) { st_.reunion = el.value; cargar(false); return; }
    if (el.classList.contains('js-rc2-sumar') && el.value) {
      var p = (st_.datos.personas || []).filter(function (x) { return x.email === el.value; })[0];
      guardarAsistencia(st_.datos.reunion.participantes.concat([{ email: el.value, nombre: p ? p.nombre : el.value, asistio: true }]));
    }
  });
  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    if (!f.classList || !f.classList.contains('js-rc2-acuerdo')) return;
    ev.preventDefault();
    var b = f.querySelector('button[type=submit]');
    b.disabled = true;
    api('agregarAcuerdoReunionCoordinacion', { reunion_id: st_.datos.reunion.reunion_id, texto: f.texto.value, responsable_email: f.responsable_email.value, fecha_compromiso: f.fecha_compromiso.value }).then(function (r) {
      b.disabled = false;
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo agregar el acuerdo.', 'error'); return; }
      PY.aviso('Acuerdo agregado: ya está en Mi trabajo del responsable.', 'exito');
      cargar(true);
    });
  });
  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('calidad-v2');
    if (!raiz || raiz.getAttribute('data-vista') !== VISTA || !raiz.contains(ev.target)) return;
    var t = ev.target, b;
    if (t.closest('.js-rc2-recargar')) { cargar(true); return; }
    if ((b = t.closest('.js-rc2-abrir'))) {
      b.disabled = true;
      api('crearReunionCoordinacion', {}).then(function (r) {
        b.disabled = false;
        if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo abrir la reunión.', 'error'); return; }
        st_.reunion = r.data.reunion.reunion_id; cargar(false);
      });
      return;
    }
    if ((b = t.closest('.js-rc2-asiste'))) {
      var email = b.getAttribute('data-email');
      guardarAsistencia(st_.datos.reunion.participantes.map(function (p) { return { email: p.email, nombre: p.nombre, asistio: p.email === email ? !p.asistio : p.asistio }; }));
      return;
    }
    if ((b = t.closest('.js-rc2-cerrar'))) {
      var espera = st_.guardando ? new Promise(function (ok) { setTimeout(ok, 700); }) : Promise.resolve();
      espera.then(function () {
        return U.confirmar({ titulo: 'Cerrar la reunión', texto: 'El acta se enviará por correo a los participantes y a gerencia, y la reunión ya no se podrá modificar.', boton: 'Cerrar y enviar' });
      }).then(function (si) {
        if (!si) return;
        var m = raiz.querySelector('.js-rc2-minuta');
        b.disabled = true;
        api('cerrarReunionCoordinacion', { reunion_id: st_.datos.reunion.reunion_id, minuta: m ? m.value : '' }).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) {
            PY.aviso((r && r.message) || 'No se pudo cerrar.', 'error');
            var falta = st_.datos.items.filter(function (i) { return aExplicar(i) && !completo(i); })[0];
            var li = falta && document.getElementById('rc2-' + falta.item_id);
            if (li) li.scrollIntoView({ block: 'center', behavior: 'smooth' });
            return;
          }
          PY.aviso('Reunión cerrada. Acta enviada.', 'exito');
          cargar(true);
        });
      });
    }
  });

  window.SigsoCalidadReunionV2 = {
    mostrar: function () { cargar(!!st_.datos && C().ocupa(VISTA)); },
    vistas: [VISTA]
  };
})();
