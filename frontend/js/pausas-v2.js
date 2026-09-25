/**
 * pausas-v2.js — Pausas activas del trabajador (SIGSO v2, Módulo 5B;
 * análisis y decisiones en documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 *  - La pausa de hoy: declarar en un toque ("Declaro que participé" / "No
 *    pude"), también desde el Inicio (decisión del dueño).
 *  - Si la coordinación no la inició a la hora + tolerancia, la persona puede
 *    iniciarla (iniciarPausaParticipante, Módulo 5A).
 *  - Su historial: participación, racha y las últimas pausas.
 *  - El ánimo avisa con transparencia que "Mal"/"Muy mal" lo ve la
 *    coordinación (Módulo 5A).
 * Mismo registro de siempre (registrarAsistenciaPausa). Un cambio emite
 * `sigso:pausa-cambio` para que el Inicio y el módulo se repinten.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var MOTIVOS = ['En terreno / fuera de la oficina', 'En reunión', 'Atendiendo un cliente', 'Licencia / permiso', 'Problema de salud', 'No me enteré a tiempo', 'Otro'];
  var ANIMO = [['😞', 'Muy mal'], ['🙁', 'Mal'], ['😐', 'Regular'], ['🙂', 'Bien'], ['😄', 'Muy bien']];
  var datos_ = null, historial_ = null, turno_ = 0;

  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  function aMin(hhmm) { var m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
  function minutosAhora() {
    var t = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).split(':');
    return Number(t[0]) * 60 + Number(t[1]);
  }
  function horaDe(iso) { return iso ? new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : ''; }
  function avisarCambio() { document.dispatchEvent(new CustomEvent('sigso:pausa-cambio')); }

  // --- Estado de la pausa de hoy (compartido con el Inicio) ------------------------------
  // Devuelve { txt, tono } según la hora y el estado.
  function momento(d) {
    var p = d.pausa, ahora = minutosAhora(), prog = aMin(p.hora_programada);
    if (p.estado === 'En_curso') return { txt: 'En curso desde las ' + horaDe(p.hora_inicio_real) + (p.iniciada_por ? ' · la inició ' + PY.persona(p.iniciada_por).nombre : ''), tono: 'primario' };
    if (p.estado === 'Programada' || p.estado === 'Recordatorio_enviado') {
      if (prog !== null && ahora < prog) return { txt: 'A las ' + p.hora_programada + ' · ' + (p.duracion_min || 10) + ' min', tono: 'info' };
      return { txt: 'Era a las ' + p.hora_programada + ' y aún no empieza', tono: 'alerta' };
    }
    if (p.estado === 'Realizada' || p.estado === 'Cerrada') return { txt: 'Se realizó hoy', tono: 'ok' };
    if (p.estado === 'No_realizada') return { txt: 'Hoy no se realizó', tono: 'neutro' };
    return { txt: p.estado, tono: 'neutro' };
  }

  // Bloque de acción de hoy: se usa en el módulo y en el Inicio (compacto).
  function bloqueHoy(d, compacto) {
    if (!d || !d.pausa) return '';
    var m = momento(d), reg = d.mi_registro;
    var iniciar = d.puede_iniciar
      ? '<div class="pa2-iniciar">' + U.ico('rayo', 16) + '<span>La coordinación no la ha iniciado. Puedes iniciarla tú y quedará registrado.</span>' +
          U.boton({ texto: 'Iniciar la pausa', icono: 'rayo', sm: compacto, clase: 'js-pa2-iniciar' }) + '</div>'
      : '';
    var accion;
    if (reg) {
      var si = reg.estado === 'participo';
      accion = '<div class="pa2-hecho sx2-tono-' + (si ? 'ok' : 'alerta') + '">' + U.ico(si ? 'check' : 'info', 16) +
        '<span>' + (si ? 'Registraste que participaste. ¡Gracias!' : 'Registraste que no pudiste' + (reg.motivo ? ' (' + U.esc(reg.motivo) + ')' : '') + '. ¡Gracias por avisar!') + '</span>' +
        (d.registrable ? U.boton({ texto: 'Cambiar', sm: true, variante: 'fantasma', clase: 'js-pa2-cambiar' }) : '') + '</div>';
    } else if (d.registrable) {
      accion = '<div class="pa2-botones">' +
        U.boton({ texto: 'Declaro que participé', icono: 'check', variante: 'primario', sm: compacto, clase: 'js-pa2-participe' }) +
        U.boton({ texto: 'No pude', icono: 'equis', sm: compacto, clase: 'js-pa2-nopude' }) + '</div>';
    } else {
      accion = '<p class="sx2-tenue" style="margin:0;font-size:.8125rem">La pausa de hoy ya no admite registros.</p>';
    }
    return '<div class="pa2-hoy' + (compacto ? ' pa2-hoy--compacto' : '') + '">' +
      '<span class="pa2-hoy__ico sx2-tono-' + m.tono + '">' + U.ico('actividad', compacto ? 18 : 22) + '</span>' +
      '<span class="sx2-apilado" style="gap:8px;flex:1;min-width:0">' +
        '<span class="sx2-apilado" style="gap:2px"><strong>' + (compacto ? 'Pausa activa de hoy' : 'Pausa de hoy') + '</strong><span class="pa2-momento sx2-tono-' + m.tono + '">' + U.esc(m.txt) + '</span></span>' +
        iniciar + accion +
      '</span></div>';
  }

  // --- Acciones (módulo e Inicio) -------------------------------------------------------
  function registrar(payload) {
    return api('registrarAsistenciaPausa', payload).then(function (r) {
      if (r && r.ok) { PY.aviso(payload.estado === 'participo' ? 'Listo: participación registrada.' : 'Listo: quedó registrado.', 'exito'); avisarCambio(); }
      return r;
    });
  }
  function formParticipe() {
    PY.formulario({
      titulo: 'Participé en la pausa', boton: 'Guardar', ocupado: 'Guardando…',
      campos: '<label class="sx2-flex pa2-declaro"><input type="checkbox" name="confirmacion" value="1" checked> Declaro que participé en la pausa activa de hoy.</label>' +
        '<div class="sx2-campo"><span class="sx2-campo__et">¿Cómo te sientes hoy? (opcional)</span>' +
        '<div class="pa2-animo">' + ANIMO.map(function (a, i) {
          return '<label title="' + a[1] + '"><input type="radio" name="animo" value="' + (i + 1) + '"><span>' + a[0] + '</span><small>' + a[1] + '</small></label>';
        }).join('') + '</div>' +
        '<small class="sx2-tenue">Si marcas "Mal" o "Muy mal", la coordinación de pausas lo verá para poder acercarse a conversar.</small></div>',
      preparar: function (x) {
        if (!x.confirmacion) return 'Marca la declaración para registrar tu participación.';
        return { estado: 'participo', confirmacion: true, animo: x.animo ? Number(x.animo) : undefined };
      },
      enviar: registrar, listo: function () {}
    });
  }
  function formNoPude() {
    PY.formulario({
      titulo: 'No pude participar', boton: 'Guardar', ocupado: 'Guardando…',
      campos: '<div class="sx2-campo"><span class="sx2-campo__et">Motivo</span><div class="pa2-motivos">' + MOTIVOS.map(function (m, i) {
          return '<label><input type="radio" name="motivo" value="' + U.esc(m) + '"' + (i === 0 ? '' : '') + '><span>' + U.esc(m) + '</span></label>';
        }).join('') + '</div></div>' +
        PY.campo('Comentario (opcional)', '<textarea class="sx2-input" name="comentario" maxlength="500"></textarea>'),
      preparar: function (x) { return x.motivo ? { estado: 'no_participo', motivo: x.motivo, comentario: x.comentario || '' } : 'Elige un motivo.'; },
      enviar: registrar, listo: function () {}
    });
  }
  function iniciar(b) {
    U.confirmar({ titulo: '¿Iniciar la pausa de hoy?', texto: 'La coordinación no la ha iniciado. Al iniciarla quedará registrado que la iniciaste tú; luego declara tu participación.', boton: 'Iniciar' }).then(function (si) {
      if (!si) return;
      if (b) b.disabled = true;
      api('iniciarPausaParticipante', {}).then(function (r) {
        if (b) b.disabled = false;
        if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo iniciar.', 'error'); return; }
        PY.aviso('Pausa iniciada. ¡A moverse!', 'exito');
        avisarCambio();
      });
    });
  }
  // Un solo manejador para el módulo y el Inicio.
  document.addEventListener('click', function (ev) {
    var t = ev.target, b;
    if (!t.closest || !t.closest('.pa2-hoy')) return;
    if (t.closest('.js-pa2-participe')) { formParticipe(); return; }
    if (t.closest('.js-pa2-nopude')) { formNoPude(); return; }
    if (t.closest('.js-pa2-cambiar')) { formParticipe(); return; }
    if ((b = t.closest('.js-pa2-iniciar'))) iniciar(b);
  });

  // --- Módulo -----------------------------------------------------------------------
  function seccion() { return document.getElementById('modulo-pausas'); }
  function contenedor() {
    var s = seccion();
    if (!s) return null;
    var c = document.getElementById('pausas-v2');
    if (!c) {
      c = document.createElement('div');
      c.id = 'pausas-v2';
      c.className = 'sx2';
      s.appendChild(c);
    }
    s.classList.add('pausas-v2-activa');
    return c;
  }
  function desmontar() {
    var s = seccion();
    if (s) s.classList.remove('pausas-v2-activa');
    var c = document.getElementById('pausas-v2');
    if (c) c.remove();
  }
  function cargar(silencioso) {
    var c = contenedor();
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !datos_) c.innerHTML = '<div class="sx2-pagina">' + cabecera() + U.esqueleto('tarjetas', 2) + '</div>';
    Promise.all([api('getPausaHoyTrabajador', {}), api('getMiHistorialPausas', {}), PY.cargarMiPerfil()]).then(function (r) {
      if (t !== turno_) return;
      if (!r[0] || !r[0].ok) {
        c.innerHTML = '<div class="sx2-pagina">' + cabecera() + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar la pausa de hoy',
          texto: (r[0] && r[0].message) || 'Inténtalo de nuevo.', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-pa2-recargar' }) }) }) + '</div>';
        return;
      }
      datos_ = r[0].data;
      historial_ = r[1] && r[1].ok ? r[1].data : null;
      pintar(!!silencioso);
    });
  }
  function cabecera() {
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Mi espacio</span><h1>Pausas activas</h1>' +
      '<span class="sx2-tenue" style="font-size:.875rem">Unos minutos para moverte. Registrarlo toma segundos.</span></div>' +
      '<div class="sx2-cabecera__acciones">' + U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-pa2-recargar' }) + '</div></header>';
  }
  function tarjetaHistorial(h) {
    if (!h || h.sin_lista) {
      return U.card({ titulo: 'Tu historial', icono: 'calendario', i: 2, cuerpo: U.vacio({ icono: 'persona', texto: 'No estás en la lista de pausas de tu empresa. Si deberías, avísale a la coordinación.' }) });
    }
    var r = h.resumen;
    var ESTADO = { participo: ['Participaste', 'ok'], no_participo: ['No pudiste', 'alerta'], sin_registro: ['Sin registro', 'neutro'], no_aplica: ['No se realizó', 'neutro'] };
    return U.card({ titulo: 'Tu historial', icono: 'calendario', sub: 'últimos 60 días', i: 2, cuerpo:
      '<div class="pa2-cifras">' +
        '<div><b>' + (r.pct_participacion === null ? '—' : Math.round(r.pct_participacion) + ' %') + '</b><span>de participación</span></div>' +
        '<div><b>' + r.racha_actual + '</b><span>' + (r.racha_actual === 1 ? 'pausa seguida' : 'pausas seguidas') + ' (ahora)</span></div>' +
        '<div><b>' + r.racha_maxima + '</b><span>tu mejor racha</span></div>' +
        '<div><b>' + r.sin_registro + '</b><span>sin registrar</span></div>' +
      '</div>' +
      (h.detalle.length ? '<div class="pa2-dias">' + h.detalle.slice(0, 20).reverse().map(function (x) {
        var e = ESTADO[x.mi_estado] || ['', 'neutro'];
        return '<span class="pa2-dia sx2-tono-' + e[1] + (x.mi_estado === 'no_aplica' ? ' pa2-dia--nula' : '') + '" title="' + U.esc(x.fecha + ' · ' + e[0] + (x.motivo ? ' (' + x.motivo + ')' : '')) + '"><i></i><b>' + U.esc(x.fecha.slice(8, 10)) + '</b></span>';
      }).join('') + '</div><div class="pa2-ley"><span class="sx2-tono-ok"><i></i>Participaste</span><span class="sx2-tono-alerta"><i></i>No pudiste</span><span class="sx2-tono-neutro"><i></i>Sin registro</span><span class="pa2-ley--nula"><i></i>No se realizó</span></div>'
        : '<p class="sx2-tenue" style="margin:0">Todavía no hay pausas en tu historial.</p>') });
  }
  function pintar(silencioso) {
    var c = contenedor();
    if (!c || !datos_) return;
    var d = datos_, y = window.scrollY;
    var hoy;
    if (d.sin_empresa) hoy = U.card({ i: 1, cuerpo: U.vacio({ icono: 'alerta', titulo: 'No encontramos tu empresa', texto: 'Avísale al administrador para que te agregue a la lista de pausas.' }) });
    else if (!d.pausa) hoy = U.card({ i: 1, cuerpo: U.vacio({ icono: 'calendario', titulo: 'Hoy no hay pausa programada', texto: 'Cuando la haya, aparecerá aquí y en tu Inicio.' }) });
    else hoy = '<section class="sx2-card sx2-entra" style="--i:1">' + bloqueHoy(d, false) + '</section>';
    c.innerHTML = '<div class="sx2-pagina">' + cabecera() + hoy + tarjetaHistorial(historial_) + '</div>';
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    U.animar(c);
  }
  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('pausas-v2');
    if (raiz && raiz.contains(ev.target) && ev.target.closest('.js-pa2-recargar')) cargar(!!datos_);
  });
  document.addEventListener('sigso:pausa-cambio', function () {
    var c = document.getElementById('pausas-v2');
    if (c && c.offsetParent !== null) cargar(true);
  });

  // 2026-09-25: la versión clásica se retiró; la v2 es la única.
  function activo() { return true; }
  function usarVersion() { /* sin versión clásica */ }

  window.SigsoPausasV2 = {
    cargar: function () { cargar(false); },
    refrescar: function () { cargar(true); },
    // Para el Inicio: el bloque de hoy en versión compacta ('' si no aplica).
    bloqueInicio: function (d) {
      if (!d || !d.pausa || (!d.registrable && !d.puede_iniciar && !d.mi_registro)) return '';
      if (d.mi_registro && !d.puede_iniciar) return '';
      return bloqueHoy(d, true);
    },
    activo: activo, usarVersion: usarVersion, desmontar: desmontar
  };
})();
