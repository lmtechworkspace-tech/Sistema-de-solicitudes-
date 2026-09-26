/**
 * novedades-v2.js — módulo Novedades completo en v2 (SIGSO v2: Módulo 6 y
 * R3 del retiro de la versión clásica; ver documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 * Vistas (el árbol del sidebar las elige): Publicadas, Por aprobar, Mis envíos
 * y Cumplimiento de lectura. La lectura, el acuse, la aprobación (con fecha
 * límite y a quién llega), devolver/rechazar con motivo, retirar, publicar y
 * corregir-y-reenviar se hacen en paneles laterales v2.
 *
 * La plataforma ya no carga novedades.js (clásico, solo lo usa app.html):
 * este archivo define también window.SigsoNovedades con la API que usan el
 * shell y el Inicio (cargar, irAItem, actualizarBadge, resumenPendientes…).
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var TONO_TIPO = { LEY: 'critico', DICTAMEN: 'critico', AVISO: 'alerta', LOGRO: 'ok', GENERAL: 'info' };
  var VISTAS = {
    feed: { titulo: 'Novedades', sub: 'Leyes, avisos y novedades de todas las áreas.' },
    aprobar: { titulo: 'Por aprobar', sub: 'Publicaciones de tu equipo que esperan tu revisión antes de salir.' },
    envios: { titulo: 'Mis envíos', sub: 'Lo que enviaste y todavía no se publica: en revisión, devuelto o rechazado.' },
    cumplimiento: { titulo: 'Cumplimiento de lectura', sub: 'Quién confirmó cada novedad con plazo de acuse.' }
  };
  var ESTADO = {
    EN_REVISION: ['En revisión', 'alerta'], DEVUELTA: ['Devuelta para corregir', 'critico'],
    RECHAZADA: ['Rechazada', 'critico'], PUBLICADA: ['Publicada', 'ok']
  };
  var CUMPL = { VENCIDA: ['Vencida', 'critico'], POR_VENCER: ['Por vencer', 'alerta'], AL_DIA: ['Al día', 'info'], CUMPLIDA: ['Cumplida', 'ok'] };

  var vista_ = 'feed', datos_ = {}, turno_ = 0, filtro_ = '';
  var permisos_ = null; // listarAreasPublicablesNovedad: areas, tipos, directorio, equipo, puede_*
  var promesaPermisos_ = null;
  var promesaFeed_ = null, feedEn_ = 0;

  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  function tonoTipo(n) { return TONO_TIPO[n.tipo] || 'info'; }
  function plazo(n) {
    var d = n.dias_para_vencer;
    if (d === null || d === undefined) return { txt: 'Sin plazo', tono: 'neutro' };
    if (d < 0) return { txt: 'Venció hace ' + (-d) + (d === -1 ? ' día' : ' días'), tono: 'critico' };
    if (d === 0) return { txt: 'Vence hoy', tono: 'critico' };
    if (d === 1) return { txt: 'Vence mañana', tono: 'alerta' };
    return { txt: 'Vence en ' + d + ' días', tono: 'info' };
  }
  function autor(n) { return PY.persona(n.autor_email, n.autor_nombre).nombre; }

  // --- Datos compartidos --------------------------------------------------------------
  // El feed se comparte 10 s entre el badge, el Inicio y la vista (una sola request).
  function feed(forzar) {
    if (forzar || !promesaFeed_ || Date.now() - feedEn_ > 10000) {
      feedEn_ = Date.now();
      promesaFeed_ = api('getFeedNovedades', {});
    }
    return promesaFeed_;
  }
  function invalidarFeed() { promesaFeed_ = null; }
  function permisos() {
    if (!promesaPermisos_) {
      promesaPermisos_ = api('listarAreasPublicablesNovedad', {}).then(function (r) {
        permisos_ = r && r.ok ? r.data : { areas: [], tipos: [], directorio: [], equipo: [] };
        registrarArbol();
        return permisos_;
      });
    }
    return promesaPermisos_;
  }
  function puedePublicar() { return !!(permisos_ && ((permisos_.areas || []).length || permisos_.puede_general)); }
  function actualizarBadge() {
    feed().then(function (r) {
      var n = r && r.ok ? (r.data.resumen && r.data.resumen.pendientes) || 0 : 0;
      document.querySelectorAll('[data-badge="novedades"]').forEach(function (b) {
        b.textContent = n > 99 ? '99+' : String(n);
        b.classList.toggle('sigso-oculto', !n);
      });
    });
  }
  function avisarCambio() {
    invalidarFeed();
    actualizarBadge();
    document.dispatchEvent(new CustomEvent('sigso:novedad-leida'));
  }

  // --- Árbol del sidebar ----------------------------------------------------------------
  var ARQUITECTURA = [
    { id: 'publicadas', nombre: 'Publicadas', icono: 'campana', items: [{ id: 'feed', nombre: 'Publicadas' }] },
    { id: 'aprobar', nombre: 'Por aprobar', icono: 'check', items: [{ id: 'aprobar', nombre: 'Por aprobar' }] },
    { id: 'envios', nombre: 'Mis envíos', icono: 'subir', items: [{ id: 'envios', nombre: 'Mis envíos' }] },
    { id: 'reportes', nombre: 'Reportes', icono: 'grafico', plano: true, descripcion: 'Quién leyó qué',
      items: [{ id: 'cumplimiento', nombre: 'Cumplimiento de lectura' }] }
  ];
  function registrarArbol() {
    if (!window.SigsoNav) return;
    SigsoNav.registrar('novedades', {
      nombre: 'Novedades', submodulos: ARQUITECTURA,
      // Cumplimiento solo para quien publica en general (ADM): mismo criterio del backend.
      visible: function (llave) { return llave === 'cumplimiento' ? !!(permisos_ && permisos_.puede_general) : true; }
    });
    if (window.SigsoShell && SigsoShell.refrescarArbol) SigsoShell.refrescarArbol();
  }

  // --- Panel de lectura (módulo e Inicio) ---------------------------------------------------
  function abrir(id) {
    var d = U.drawer({ titulo: 'Novedad', subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Cargando…</span>', cuerpo: U.esqueleto('tabla', 5), pie: ' ' });
    d.el.classList.add('bj2-drawer', 'nv2-drawer');
    var n = null, lect = null, modo = 'leer';

    function cabecera() {
      d.el.querySelector('.sx2-drawer__titulo').textContent = n.titulo;
      var cab = d.el.querySelector('.sx2-drawer__fila-titulo .sx2-apilado');
      cab.querySelectorAll('.sx2-tenue, .bj2-det-sub').forEach(function (e) { e.remove(); });
      var est = n.estado && n.estado !== 'PUBLICADA' ? ESTADO[n.estado] : null;
      cab.insertAdjacentHTML('beforeend', '<span class="bj2-det-sub sx2-flex">' + U.badge(n.tipo_etiqueta || n.tipo, tonoTipo(n)) +
        (est ? U.badge(est[0], est[1]) : '') + (n.area_nombre ? U.badge(n.area_nombre, 'neutro', true) : '') +
        '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(autor(n) + ' · ' + PY.fecha(n.fecha_publicacion || n.fecha_creacion, true)) + '</span></span>');
    }
    function pintar() {
      cabecera();
      if (modo === 'aprobar') { pintarAprobar(); return; }
      if (modo === 'devolver' || modo === 'rechazar') { pintarMotivo(); return; }
      var p = plazo(n);
      var publicada = n.estado === 'PUBLICADA' || !n.estado;
      var audiencia = n.audiencia && n.audiencia.tipo && n.audiencia.tipo !== 'TODOS'
        ? (n.audiencia.tipo === 'MI_EQUIPO' ? 'Dirigida a un equipo específico.' : 'Dirigida a: ' + (n.audiencia.destinatarios || []).map(function (x) { return x.nombre; }).join(', ')) : '';
      var h =
        (n.estado === 'DEVUELTA' && n.motivo_devolucion ? '<div class="nv2-acuse sx2-tono-critico" style="flex-direction:column;align-items:flex-start"><span>' + U.ico('editar', 15) + ' Devuelta para corregir.</span>' +
          '<span style="font-weight:400;color:var(--sx-texto)">Motivo: ' + U.esc(n.motivo_devolucion) + '</span></div>' : '') +
        (n.estado === 'RECHAZADA' && n.motivo_devolucion ? '<p class="nv2-acuse sx2-tono-critico">' + U.ico('alerta', 15) + 'Rechazada: ' + U.esc(n.motivo_devolucion) + '</p>' : '') +
        (n.estado === 'EN_REVISION' ? '<p class="nv2-acuse sx2-tono-alerta">' + U.ico('reloj', 15) + (n.puede_aprobar ? 'Espera tu revisión. Apruébala, devuélvela o recházala.' : 'En revisión de la jefatura.') + '</p>' : '') +
        (publicada && n.requiere_acuse ? '<p class="nv2-acuse sx2-tono-' + (n.leida ? 'ok' : p.tono) + '">' + U.ico(n.leida ? 'check' : 'reloj', 15) +
          (n.leida ? 'Ya confirmaste que la leíste.' : 'Requiere que confirmes la lectura · ' + p.txt + '.') + '</p>' : '') +
        (n.fecha_vigencia ? '<p class="sx2-tenue" style="margin:0;font-size:.8125rem">' + U.ico('calendario', 13) + ' Entra en vigencia el ' + U.esc(PY.fecha(n.fecha_vigencia, true)) + '</p>' : '') +
        (audiencia ? '<p class="sx2-tenue" style="margin:0;font-size:.8125rem">' + U.esc(audiencia) + '</p>' : '') +
        (n.resumen ? '<p class="nv2-resumen">' + U.esc(n.resumen) + '</p>' : '') +
        (n.cuerpo ? '<div class="nv2-cuerpo">' + U.esc(n.cuerpo) + '</div>' : '') +
        (n.fuente_url ? '<p class="nv2-fuente">' + U.ico('enlace', 14) + '<a class="sx2-enlace" href="' + U.esc(n.fuente_url) + '" target="_blank" rel="noopener noreferrer">Fuente oficial</a></p>' : '') +
        (n.tiene_adjunto ? '<button type="button" class="bj2-archivo js-nv2-adjunto" style="width:100%;text-align:left;background:none">' +
          '<span class="bj2-archivo__ico sx2-tono-info">' + U.ico('documento', 18) + '</span>' +
          '<span class="sx2-apilado" style="gap:2px;flex:1;min-width:0"><strong class="sx2-cortar">' + U.esc(n.archivo_nombre || 'Adjunto') + '</strong><span class="sx2-tenue" style="font-size:.75rem">Descargar</span></span>' + U.ico('descargar', 14) + '</button>' : '') +
        (lect ? bloqueLectores(lect) : '');
      d.cuerpo(h);
      var acc = [];
      if (n.estado === 'EN_REVISION' && n.puede_aprobar) {
        acc.push(U.boton({ texto: 'Aprobar', icono: 'check', variante: 'primario', clase: 'js-nv2-modo', datos: { modo: 'aprobar' } }));
        acc.push(U.boton({ texto: 'Devolver', icono: 'editar', clase: 'js-nv2-modo', datos: { modo: 'devolver' } }));
        acc.push(U.boton({ texto: 'Rechazar', variante: 'fantasma', clase: 'js-nv2-modo', datos: { modo: 'rechazar' } }));
      }
      if (n.estado === 'DEVUELTA' && n.es_autor) acc.push(U.boton({ texto: 'Corregir y reenviar', icono: 'editar', variante: 'primario', clase: 'js-nv2-reenviar' }));
      if (publicada && n.requiere_acuse && !n.leida) acc.push(U.boton({ texto: 'Confirmo que la leí', icono: 'check', variante: 'primario', clase: 'js-nv2-confirmar' }));
      if (publicada && n.puede_gestionar) acc.push(U.boton({ texto: 'Retirar', icono: 'basura', variante: 'fantasma', clase: 'js-nv2-retirar' }));
      acc.push(U.boton({ texto: 'Cerrar', clase: 'js-sx2-drawer-cerrar' }));
      d.el.querySelector('.sx2-drawer__pie').innerHTML = acc.join('');
    }

    function bloqueLectores(l) {
      var conCuenta = l.pendientes.filter(function (x) { return !x.sin_cuenta; });
      var sinCuenta = l.pendientes.filter(function (x) { return x.sin_cuenta; });
      var total = l.leyeron.length + conCuenta.length;
      var pct = total ? Math.round(l.leyeron.length * 100 / total) : 0;
      var fila = function (x, extra) {
        var per = PY.persona(x.email, x.nombre);
        return '<li>' + U.avatar(per, 'xs') + '<span class="sx2-cortar">' + U.esc(per.nombre) + '</span>' + (extra || '') + '</li>';
      };
      return '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Quién la leyó</h3>' +
        '<div class="sx2-flex" style="gap:12px;align-items:center">' + U.barra(pct, pct === 100 ? 'ok' : 'primario', true) +
          '<strong style="flex:none">' + l.leyeron.length + ' de ' + total + '</strong></div>' +
        (conCuenta.length ? '<p class="sx2-tenue" style="margin:0;font-size:.75rem">Faltan (' + conCuenta.length + '):</p><ul class="nv2-gente">' + conCuenta.map(function (x) {
          return fila(x, x.nunca_entro ? U.badge('Nunca entró a SIGSO', 'neutro', true) : '');
        }).join('') + '</ul>' : '<p class="sx2-tenue" style="margin:0">Todas las personas con cuenta la confirmaron.</p>') +
        (l.leyeron.length ? '<p class="sx2-tenue" style="margin:8px 0 0;font-size:.75rem">Confirmaron (' + l.leyeron.length + '):</p><ul class="nv2-gente">' + l.leyeron.map(function (x) { return fila(x); }).join('') + '</ul>' : '') +
        (sinCuenta.length ? '<p class="sx2-tenue" style="margin:8px 0 0;font-size:.75rem">Sin cuenta activa en SIGSO: no pueden confirmar y no cuentan como pendientes (' + sinCuenta.length + '):</p>' +
          '<ul class="nv2-gente nv2-gente--sin">' + sinCuenta.map(function (x) { return fila(x); }).join('') + '</ul>' : '') +
      '</section>';
    }

    // Aprobar: fecha límite (obligatoria en Ley y Dictamen) y a quién llega.
    function pintarAprobar() {
      var exige = n.tipo === 'LEY' || n.tipo === 'DICTAMEN';
      d.cuerpo('<form class="sx2-form js-nv2-form-aprobar" novalidate>' +
        '<p class="sx2-tenue" style="margin:0">Al aprobar se publica. Elige hasta cuándo hay que confirmar la lectura y a quién le llega.</p>' +
        U.campo('Fecha límite para confirmar' + (exige ? '' : ' (opcional)'), '<input type="date" class="sx2-input" name="fecha_limite_acuse" min="' + PY.hoyClave() + '"' + (exige ? ' required' : '') + '>',
          exige ? 'Obligatoria en leyes y dictámenes.' : '') +
        selectorAudiencia('SELECCION') +
        '<p class="sx2-campo__error js-nv2-err" hidden></p></form>');
      montarAudiencia(d.el.querySelector('.js-nv2-form-aprobar'));
      d.el.querySelector('.sx2-drawer__pie').innerHTML =
        U.boton({ texto: 'Volver', icono: 'izquierda', clase: 'js-nv2-modo', datos: { modo: 'leer' } }) +
        U.boton({ texto: 'Aprobar y publicar', icono: 'check', variante: 'primario', clase: 'js-nv2-aprobar-ok' });
    }
    function pintarMotivo() {
      var dev = modo === 'devolver';
      d.cuerpo('<form class="sx2-form js-nv2-form-motivo" novalidate>' +
        '<p class="sx2-tenue" style="margin:0">' + (dev ? 'Vuelve a quien la envió para que la corrija y la reenvíe.' : 'No se publicará. Quien la envió verá el motivo.') + '</p>' +
        U.campo(dev ? 'Qué hay que corregir' : 'Por qué se rechaza', '<textarea class="sx2-input" name="motivo" maxlength="500" required placeholder="Mínimo 10 caracteres"></textarea>') +
        '<p class="sx2-campo__error js-nv2-err" hidden></p></form>');
      d.el.querySelector('textarea').focus();
      d.el.querySelector('.sx2-drawer__pie').innerHTML =
        U.boton({ texto: 'Volver', icono: 'izquierda', clase: 'js-nv2-modo', datos: { modo: 'leer' } }) +
        U.boton({ texto: dev ? 'Devolver' : 'Rechazar', icono: dev ? 'editar' : 'equis', variante: 'primario', clase: 'js-nv2-motivo-ok' });
    }
    function error(m) { var e = d.el.querySelector('.js-nv2-err'); if (e) { e.textContent = m; e.hidden = false; } }
    function tras(r, msg) {
      if (!r || !r.ok) { error((r && r.message) || 'No se pudo completar la acción.'); return; }
      PY.aviso(msg, 'exito');
      d.cerrar();
      avisarCambio();
      recargarVista();
    }

    function cargarDetalle() {
      return api('getDetalleNovedad', { novedad_id: id }).then(function (r) {
        if (!r || !r.ok) { d.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || 'Inténtalo de nuevo.' })); return; }
        n = r.data;
        pintar();
        if (window.SigsoDirectorio && n.autor_email) SigsoDirectorio.resolver([n.autor_email]).then(function () { if (d.el.isConnected && modo === 'leer') pintar(); });
        if (n.puede_gestionar && n.requiere_acuse && (n.estado === 'PUBLICADA' || !n.estado)) {
          api('getLectoresNovedad', { novedad_id: id }).then(function (l) { if (l && l.ok && d.el.isConnected) { lect = l.data; if (modo === 'leer') pintar(); } });
        }
      });
    }

    d.el.addEventListener('click', function (ev) {
      var b, t = ev.target;
      if ((b = t.closest('.js-nv2-modo'))) { modo = b.getAttribute('data-modo'); if (modo === 'aprobar') permisos().then(pintar); else pintar(); return; }
      if ((b = t.closest('.js-nv2-confirmar'))) {
        b.disabled = true;
        api('marcarLeidaNovedad', { novedad_id: id }).then(function (r) {
          if (!r || !r.ok) { b.disabled = false; PY.aviso((r && r.message) || 'No se pudo registrar el acuse.', 'error'); return; }
          PY.aviso('Lectura confirmada. ¡Gracias!', 'exito');
          n.leida = true;
          pintar();
          avisarCambio();
          recargarVista();
        });
        return;
      }
      if (t.closest('.js-nv2-reenviar')) { d.cerrar(true); abrirReenviar(n); return; }
      if (t.closest('.js-nv2-retirar')) {
        U.confirmar({ titulo: 'Retirar esta novedad', texto: 'Dejará de verse en Novedades y en el Inicio. No se puede deshacer desde aquí.', boton: 'Retirar', peligro: true }).then(function (si) {
          if (!si) return;
          api('despublicarNovedad', { novedad_id: id }).then(function (r) {
            if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo retirar.', 'error'); return; }
            PY.aviso('Novedad retirada.', 'exito');
            d.cerrar();
            avisarCambio();
            recargarVista();
          });
        });
        return;
      }
      if ((b = t.closest('.js-nv2-aprobar-ok'))) {
        var f = d.el.querySelector('.js-nv2-form-aprobar');
        var fecha = f.querySelector('[name=fecha_limite_acuse]').value;
        if ((n.tipo === 'LEY' || n.tipo === 'DICTAMEN') && !fecha) { error('Indica la fecha límite para confirmar la lectura.'); return; }
        var aud = leerAudiencia(f);
        if (aud.audiencia_tipo === 'SELECCION' && !aud.destinatarios.length) { error('Elige al menos una persona o cambia a quién llega.'); return; }
        b.disabled = true;
        api('aprobarNovedad', Object.assign({ novedad_id: id, fecha_limite_acuse: fecha }, aud)).then(function (r) {
          b.disabled = false;
          tras(r, 'Novedad aprobada y publicada.');
        });
        return;
      }
      if ((b = t.closest('.js-nv2-motivo-ok'))) {
        var motivo = d.el.querySelector('[name=motivo]').value.trim();
        if (motivo.length < 10) { error('El motivo debe tener al menos 10 caracteres.'); return; }
        b.disabled = true;
        var dev = modo === 'devolver';
        api(dev ? 'devolverNovedad' : 'rechazarNovedad', { novedad_id: id, motivo: motivo }).then(function (r) {
          b.disabled = false;
          tras(r, dev ? 'Novedad devuelta a quien la envió.' : 'Novedad rechazada.');
        });
        return;
      }
      if ((b = t.closest('.js-nv2-adjunto'))) {
        b.disabled = true;
        api('descargarAdjuntoNovedad', { novedad_id: id }).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo descargar.', 'error'); return; }
          PY.descargarBase64(r.data.contenido_base64, r.data.nombre_archivo || 'adjunto.pdf', r.data.mime || 'application/pdf');
        });
      }
    });
    cargarDetalle();
    return d;
  }

  // --- A quién llega (publicar y aprobar) -------------------------------------------------
  function selectorAudiencia(porDefecto) {
    var p = permisos_ || {};
    var ops = [];
    if (p.puede_todos) ops.push({ id: 'TODOS', texto: 'Todos' });
    if (p.puede_equipo) ops.push({ id: 'MI_EQUIPO', texto: 'Mi equipo (' + (p.equipo || []).length + ')' });
    ops.push({ id: 'SELECCION', texto: 'Elegir personas' });
    var def = ops.some(function (o) { return o.id === porDefecto; }) ? porDefecto : ops[0].id;
    var gente = (p.directorio || []).map(function (x) {
      return '<label class="nv2-persona"><input type="checkbox" class="js-nv2-dest" value="' + U.esc(x.email) + '">' +
        '<span class="sx2-cortar">' + U.esc(x.nombre) + '</span>' +
        (x.sin_cuenta ? U.badge('Sin cuenta: no podrá confirmar', 'alerta', true) : (x.nunca_entro ? U.badge('Nunca entró', 'neutro', true) : '')) + '</label>';
    }).join('');
    return '<div class="sx2-campo"><span class="sx2-campo__et">¿A quién le llega?</span>' +
      '<input type="hidden" class="js-nv2-aud" value="' + def + '">' +
      '<span>' + U.segmento(ops, def, 'js-nv2-aud-op') + '</span>' +
      '<div class="nv2-personas js-nv2-personas"' + (def === 'SELECCION' ? '' : ' hidden') + '>' +
        (gente ? '<input type="search" class="sx2-input js-nv2-filtro" placeholder="Buscar persona…"><div class="nv2-personas__lista">' + gente + '</div>'
          : '<p class="sx2-tenue" style="margin:0">No hay personas con cuenta activa para elegir.</p>') +
      '</div></div>';
  }
  function montarAudiencia(raiz) {
    raiz.addEventListener('click', function (ev) {
      var b = ev.target.closest('.js-nv2-aud-op');
      if (!b) return;
      var v = b.getAttribute('data-id');
      raiz.querySelector('.js-nv2-aud').value = v;
      raiz.querySelectorAll('.js-nv2-aud-op').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
      raiz.querySelector('.js-nv2-personas').hidden = v !== 'SELECCION';
    });
    raiz.addEventListener('input', function (ev) {
      if (!ev.target.classList.contains('js-nv2-filtro')) return;
      var q = ev.target.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      raiz.querySelectorAll('.nv2-persona').forEach(function (l) {
        l.hidden = !!q && l.textContent.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').indexOf(q) === -1;
      });
    });
  }
  function leerAudiencia(raiz) {
    var tipo = raiz.querySelector('.js-nv2-aud').value;
    return {
      audiencia_tipo: tipo,
      destinatarios: tipo === 'SELECCION' ? Array.prototype.map.call(raiz.querySelectorAll('.js-nv2-dest:checked'), function (c) { return c.value; }) : []
    };
  }

  // --- Publicar y reenviar ---------------------------------------------------------------
  function abrirPublicar() {
    permisos().then(function (p) {
      if (!puedePublicar()) { PY.aviso('No tienes áreas donde publicar.', 'error'); return; }
      var tipos = p.tipos || [];
      var areas = (p.puede_general ? [{ area_id: '', nombre: 'General (todos)' }] : []).concat(p.areas || []);
      U.formulario({
        titulo: 'Publicar novedad', ancho: true, ocupado: 'Enviando…',
        campos:
          '<div class="sx2-form__fila">' +
            U.campo('Tipo', '<select class="sx2-select js-nv2-tipo" name="tipo">' + tipos.map(function (t) {
              return '<option value="' + U.esc(t.tipo) + '" data-carril="' + U.esc(t.carril) + '">' + U.esc(t.etiqueta) + '</option>';
            }).join('') + '</select>') +
            U.campo('Área', '<select class="sx2-select" name="area_id">' + areas.map(function (a) { return '<option value="' + U.esc(a.area_id) + '">' + U.esc(a.nombre) + '</option>'; }).join('') + '</select>') +
          '</div>' +
          '<p class="nv2-acuse sx2-tono-info js-nv2-carril" hidden>' + U.ico('info', 15) + 'Este tipo lo revisa tu jefatura antes de publicarse; ella elige a quién llega y el plazo.</p>' +
          U.campo('Título', '<input class="sx2-input" name="titulo" maxlength="140" required>') +
          U.campo('Resumen', '<textarea class="sx2-input" name="resumen" maxlength="240" rows="2" required placeholder="Una o dos líneas: lo esencial"></textarea>') +
          U.campo('Detalle', '<textarea class="sx2-input" name="cuerpo" rows="6" placeholder="Opcional"></textarea>') +
          '<div class="sx2-form__fila">' +
            U.campo('Fuente oficial', '<input type="url" class="sx2-input js-nv2-fuente" name="fuente_url" placeholder="https://www.bcn.cl/…">', 'De dónde sale la información.') +
            U.campo('Entra en vigencia', '<input type="date" class="sx2-input" name="fecha_vigencia">', 'Opcional.') +
          '</div>' +
          '<label class="nv2-check"><input type="checkbox" name="requiere_acuse" value="1" checked class="js-nv2-acuse"> Pedir que confirmen la lectura</label>' +
          '<div class="sx2-form js-nv2-libre">' +
            U.campo('Fecha límite para confirmar', '<input type="date" class="sx2-input js-nv2-limite" name="fecha_limite_acuse" min="' + PY.hoyClave() + '">', 'Opcional.') +
            selectorAudiencia('SELECCION') +
          '</div>' +
          U.campo('Adjunto PDF', '<input type="file" class="sx2-input" name="archivo_pdf" accept="application/pdf">', 'Opcional.'),
        boton: 'Publicar',
        alMontar: function (form, d) {
          montarAudiencia(form);
          var sel = form.querySelector('.js-nv2-tipo');
          function sync() {
            var op = sel.options[sel.selectedIndex];
            var ctrl = !!op && op.getAttribute('data-carril') === 'CONTROLADO';
            var acuse = form.querySelector('.js-nv2-acuse').checked;
            form.querySelector('.js-nv2-carril').hidden = !ctrl;
            form.querySelector('.js-nv2-libre').hidden = ctrl;
            form.querySelector('.js-nv2-limite').closest('.sx2-campo').hidden = !acuse;
            var exige = sel.value === 'LEY' || sel.value === 'DICTAMEN';
            form.querySelector('.js-nv2-fuente').closest('.sx2-campo').querySelector('.sx2-campo__et').textContent = exige ? 'Fuente oficial (obligatoria)' : 'Fuente oficial';
            d.el.querySelector('.js-sx2-form-ok').lastChild.textContent = ctrl ? 'Enviar a revisión' : 'Publicar';
          }
          sel.addEventListener('change', sync);
          form.querySelector('.js-nv2-acuse').addEventListener('change', sync);
          sync();
        },
        preparar: function (datos, form) {
          var sel = form.querySelector('.js-nv2-tipo');
          var ctrl = sel.options[sel.selectedIndex].getAttribute('data-carril') === 'CONTROLADO';
          var acuse = form.querySelector('.js-nv2-acuse').checked;
          if (!datos.titulo) return 'Escribe un título.';
          if (!datos.resumen) return 'Escribe un resumen.';
          if ((datos.tipo === 'LEY' || datos.tipo === 'DICTAMEN') && !datos.fuente_url) return 'Las leyes y dictámenes necesitan el enlace a la fuente oficial.';
          var out = {
            tipo: datos.tipo, area_id: datos.area_id, titulo: datos.titulo, resumen: datos.resumen, cuerpo: datos.cuerpo,
            fuente_url: datos.fuente_url, fecha_vigencia: datos.fecha_vigencia, requiere_acuse: acuse,
            fecha_limite_acuse: ctrl || !acuse ? '' : datos.fecha_limite_acuse
          };
          if (!ctrl) {
            var aud = leerAudiencia(form);
            if (aud.audiencia_tipo === 'SELECCION' && !aud.destinatarios.length) return 'Elige al menos una persona o cambia a quién le llega.';
            Object.assign(out, aud);
          }
          var archivo = form.querySelector('[name=archivo_pdf]').files[0];
          if (!archivo) return out;
          return U.leerBase64(archivo).then(function (b64) { out.contenido_base64 = b64; out.nombre_archivo = archivo.name; return out; });
        },
        enviar: function (datos) { return api('publicarNovedad', datos); },
        aviso: function (r) { return r.data && r.data.estado === 'EN_REVISION' ? 'Novedad enviada a revisión.' : 'Novedad publicada.'; },
        listo: function () { avisarCambio(); recargarVista(); }
      });
    });
  }
  function abrirReenviar(n) {
    var exige = n.tipo === 'LEY' || n.tipo === 'DICTAMEN';
    U.formulario({
      titulo: 'Corregir y reenviar', ancho: true, ocupado: 'Reenviando…', boton: 'Reenviar a revisión',
      subtitulo: n.motivo_devolucion ? '<span class="sx2-tenue" style="font-size:.8125rem">Motivo: ' + U.esc(n.motivo_devolucion) + '</span>' : '',
      campos:
        U.campo('Título', '<input class="sx2-input" name="titulo" maxlength="140" required value="' + U.esc(n.titulo) + '">') +
        U.campo('Resumen', '<textarea class="sx2-input" name="resumen" maxlength="240" rows="2" required>' + U.esc(n.resumen || '') + '</textarea>') +
        U.campo('Detalle', '<textarea class="sx2-input" name="cuerpo" rows="6">' + U.esc(n.cuerpo || '') + '</textarea>') +
        '<div class="sx2-form__fila">' +
          U.campo('Fuente oficial' + (exige ? ' (obligatoria)' : ''), '<input type="url" class="sx2-input" name="fuente_url" value="' + U.esc(n.fuente_url || '') + '" placeholder="https://www.bcn.cl/…">') +
          U.campo('Entra en vigencia', '<input type="date" class="sx2-input" name="fecha_vigencia" value="' + U.esc(String(n.fecha_vigencia || '').slice(0, 10)) + '">') +
        '</div>',
      preparar: function (datos) {
        if (!datos.titulo || !datos.resumen) return 'El título y el resumen son obligatorios.';
        if (exige && !datos.fuente_url) return 'Las leyes y dictámenes necesitan el enlace a la fuente oficial.';
        datos.novedad_id = n.novedad_id;
        return datos;
      },
      enviar: function (datos) { return api('reenviarNovedad', datos); },
      aviso: 'Novedad reenviada a revisión.',
      listo: function () { avisarCambio(); recargarVista(); }
    });
  }
  // "Corregir" directo desde Mis envíos: el formulario necesita el detalle completo.
  function reenviarPorId(id) {
    api('getDetalleNovedad', { novedad_id: id }).then(function (r) {
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo abrir.', 'error'); return; }
      abrirReenviar(r.data);
    });
  }

  // --- Módulo -----------------------------------------------------------------------------
  function seccion() { return document.getElementById('modulo-novedades'); }
  function contenedor() {
    var s = seccion();
    if (!s) return null;
    var c = document.getElementById('novedades-v2');
    if (!c) {
      c = document.createElement('div');
      c.id = 'novedades-v2';
      c.className = 'sx2';
      s.appendChild(c);
    }
    s.classList.add('novedades-v2-activa');
    return c;
  }
  function desmontar() {
    var s = seccion();
    if (s) s.classList.remove('novedades-v2-activa');
    var c = document.getElementById('novedades-v2');
    if (c) c.remove();
  }

  function cabecera() {
    var v = VISTAS[vista_];
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Mi espacio · Novedades</span><h1>' + U.esc(v.titulo) + '</h1>' +
      '<span class="sx2-tenue" style="font-size:.875rem">' + U.esc(v.sub) + '</span></div>' +
      '<div class="sx2-cabecera__acciones">' + U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-nv2-recargar' }) +
        (vista_ === 'cumplimiento' && datos_.cumplimiento && (datos_.cumplimiento.items || []).length ? U.boton({ texto: 'Descargar PDF', icono: 'descargar', clase: 'js-nv2-pdf' }) : '') +
        (puedePublicar() ? U.boton({ texto: 'Publicar', icono: 'mas', variante: 'primario', clase: 'js-nv2-publicar' }) : '') + '</div></header>';
  }
  var FUENTE = {
    feed: function () { return feed(true); },
    aprobar: function () { return api('listarPendientesAprobacionNovedad', {}); },
    envios: function () { return api('misPendientesNovedad', {}); },
    // Con los lectores de cada novedad aún abierta se sabe QUIÉN debe lecturas vencidas
    // (el panel solo trae conteos). Si una llamada falla, esa novedad queda sin personas.
    cumplimiento: function () {
      return api('getPanelCumplimientoNovedad', {}).then(function (r) {
        if (!r || !r.ok) return r;
        var abiertas = (r.data.items || []).filter(function (x) { return x.estado_cumplimiento !== 'CUMPLIDA' && x.pendientes; }).slice(0, 15);
        return Promise.all(abiertas.map(function (x) { return api('getLectoresNovedad', { novedad_id: x.novedad_id }); })).then(function (ls) {
          abiertas.forEach(function (x, i) { x.lectores = ls[i] && ls[i].ok ? ls[i].data : null; });
          return r;
        });
      });
    }
  };

  function cargar(silencioso) {
    var c = contenedor();
    if (!c) return;
    var t = ++turno_;
    var v = vista_;
    if (!silencioso || !datos_[v]) c.innerHTML = '<div class="sx2-pagina">' + cabecera() + U.esqueleto(v === 'feed' || v === 'cumplimiento' ? 'kpis' : 'tabla', 3) + U.esqueleto('tabla', 5) + '</div>';
    Promise.all([FUENTE[v](), permisos()]).then(function (r) {
      if (t !== turno_ || v !== vista_) return;
      if (!r[0] || !r[0].ok) {
        c.innerHTML = '<div class="sx2-pagina">' + cabecera() + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar',
          texto: (r[0] && r[0].message) || 'Inténtalo de nuevo.', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-nv2-recargar' }) }) }) + '</div>';
        return;
      }
      datos_[v] = r[0].data;
      pintar(!!silencioso);
      var lista = v === 'feed' ? r[0].data.recientes : (v === 'aprobar' ? r[0].data.pendientes : (v === 'envios' ? r[0].data.envios : []));
      var correos = (lista || []).map(function (n) { return n.autor_email; }).filter(Boolean);
      if (window.SigsoDirectorio && correos.length) SigsoDirectorio.resolver(correos).then(function () { if (t === turno_) pintar(true); });
    });
  }
  function recargarVista() {
    var c = document.getElementById('novedades-v2');
    if (c && c.offsetParent !== null) cargar(true);
  }

  function pintar(silencioso) {
    var c = contenedor();
    var d = datos_[vista_];
    if (!c || !d) return;
    var y = window.scrollY;
    var cuerpo = vista_ === 'feed' ? vistaFeed(d) : (vista_ === 'aprobar' ? vistaAprobar(d) : (vista_ === 'envios' ? vistaEnvios(d) : vistaCumplimiento(d)));
    c.innerHTML = '<div class="sx2-pagina">' + cabecera() + cuerpo + '</div>';
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    U.animar(c);
  }

  function fila(n, i) {
    var p = plazo(n);
    var pendiente = n.requiere_acuse && !n.leida;
    return '<li class="nv2-fila' + (pendiente ? ' nv2-fila--pendiente' : '') + ' sx2-tono-' + tonoTipo(n) + ' sx2-entra" style="--i:' + Math.min(i + 3, 12) + '" data-nv2="' + U.esc(n.novedad_id) + '" tabindex="0">' +
      '<span class="sx2-apilado" style="gap:4px;min-width:0;flex:1">' +
        '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + U.badge(n.tipo_etiqueta || n.tipo, tonoTipo(n)) + (n.area_nombre ? U.badge(n.area_nombre, 'neutro', true) : '') +
          (n.tiene_adjunto ? '<span class="sx2-tenue" title="Tiene adjunto">' + U.ico('adjunto', 13) + '</span>' : '') + '</span>' +
        '<strong class="sx2-cortar">' + U.esc(n.titulo) + '</strong>' +
        (n.resumen ? '<span class="nv2-fila__resumen">' + U.esc(n.resumen) + '</span>' : '') +
        '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(autor(n) + ' · ' + PY.haceTiempo(n.fecha_publicacion)) + '</span>' +
      '</span>' +
      '<span class="nv2-fila__estado">' +
        (n.requiere_acuse ? (n.leida ? U.badge('Leída', 'ok') : U.badge(p.txt, p.tono)) : '') +
        (pendiente ? U.boton({ texto: 'Leer y confirmar', icono: 'check', sm: true, variante: 'primario' }) : '') +
      '</span></li>';
  }
  function vistaFeed(d) {
    var todas = d.recientes || [];
    var pend = todas.filter(function (n) { return n.requiere_acuse && !n.leida; })
      .sort(function (a, b) { return (a.dias_para_vencer === null ? 99 : a.dias_para_vencer) - (b.dias_para_vencer === null ? 99 : b.dias_para_vencer); });
    var vencidas = pend.filter(function (n) { return n.dias_para_vencer !== null && n.dias_para_vencer < 0; }).length;
    var tipos = {};
    todas.forEach(function (n) { tipos[n.tipo] = n.tipo_etiqueta || n.tipo; });
    var lista = todas.filter(function (n) { return !filtro_ || n.tipo === filtro_; });
    return '<div class="sx2-fila-kpis">' +
        U.kpi({ i: 0, icono: 'check', tono: pend.length ? 'alerta' : 'ok', etiqueta: 'Por confirmar', valor: pend.length, unidad: pend.length === 1 ? 'espera tu lectura' : 'esperan tu lectura' }) +
        U.kpi({ i: 1, icono: 'alerta', tono: vencidas ? 'critico' : 'neutro', etiqueta: 'Plazo vencido', valor: vencidas, unidad: 'sin confirmar' }) +
        U.kpi({ i: 2, icono: 'campana', tono: 'primario', etiqueta: 'Publicadas', valor: todas.length, unidad: 'para ti' }) +
      '</div>' +
      (pend.length ? '<section class="sx2-card nv2-toca sx2-entra" style="--i:2"><div class="sx2-card__cab"><h2 class="sx2-card__titulo">' +
        '<span class="sx2-py-mt-ico sx2-tono-alerta">' + U.ico('check', 15) + '</span>Te falta confirmar <span class="sx2-card__sub">' + pend.length + '</span></h2></div>' +
        '<ul class="nv2-lista">' + pend.map(fila).join('') + '</ul></section>' : '') +
      (Object.keys(tipos).length > 1 ? '<div class="sx2-chips sx2-entra" style="--i:3">' + U.chip({ texto: 'Todas', activo: !filtro_, clase: 'js-nv2-tipo', datos: { tipo: '' } }) +
        Object.keys(tipos).map(function (t) { return U.chip({ texto: tipos[t], activo: filtro_ === t, clase: 'js-nv2-tipo', datos: { tipo: t } }); }).join('') + '</div>' : '') +
      (lista.length
        ? '<section class="sx2-card sx2-card--sin-relleno sx2-entra" style="--i:4"><ul class="nv2-lista">' + lista.map(fila).join('') + '</ul></section>'
        : U.card({ i: 4, cuerpo: U.vacio({ icono: 'campana', titulo: 'Sin novedades', texto: filtro_ ? 'No hay de este tipo.' : 'Cuando se publique algo para ti, aparecerá aquí.' }) }));
  }
  function filaEstado(n, i, accion) {
    var e = ESTADO[n.estado] || [n.estado, 'neutro'];
    return '<li class="nv2-fila sx2-tono-' + tonoTipo(n) + ' sx2-entra" style="--i:' + Math.min(i + 2, 12) + '" data-nv2="' + U.esc(n.novedad_id) + '" tabindex="0">' +
      '<span class="sx2-apilado" style="gap:4px;min-width:0;flex:1">' +
        '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + U.badge(n.tipo_etiqueta || n.tipo, tonoTipo(n)) + (n.area_nombre ? U.badge(n.area_nombre, 'neutro', true) : '') + '</span>' +
        '<strong class="sx2-cortar">' + U.esc(n.titulo) + '</strong>' +
        (n.resumen ? '<span class="nv2-fila__resumen">' + U.esc(n.resumen) + '</span>' : '') +
        (n.motivo_devolucion ? '<span class="nv2-motivo">Motivo: ' + U.esc(n.motivo_devolucion) + '</span>' : '') +
        '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(autor(n) + ' · enviada ' + PY.haceTiempo(n.fecha_creacion)) + '</span>' +
      '</span>' +
      '<span class="nv2-fila__estado">' + U.badge(e[0], e[1]) + (accion || '') + '</span></li>';
  }
  function vistaAprobar(d) {
    var l = d.pendientes || [];
    return l.length
      ? '<section class="sx2-card sx2-card--sin-relleno sx2-entra" style="--i:1"><ul class="nv2-lista">' + l.map(function (n, i) {
          return filaEstado(n, i, U.boton({ texto: 'Revisar', icono: 'ojo', sm: true, variante: 'primario' }));
        }).join('') + '</ul></section>'
      : U.card({ i: 1, cuerpo: U.vacio({ icono: 'check', titulo: 'Nada por aprobar', texto: 'Cuando alguien de tu equipo envíe una ley, un dictamen u otro tipo que requiera revisión, aparecerá aquí.' }) });
  }
  function vistaEnvios(d) {
    var l = d.envios || [];
    return l.length
      ? '<section class="sx2-card sx2-card--sin-relleno sx2-entra" style="--i:1"><ul class="nv2-lista">' + l.map(function (n, i) {
          return filaEstado(n, i, n.estado === 'DEVUELTA' ? U.boton({ texto: 'Corregir', icono: 'editar', sm: true, variante: 'primario', clase: 'js-nv2-corregir', datos: { id: n.novedad_id } }) : '');
        }).join('') + '</ul></section>'
      : U.card({ i: 1, cuerpo: U.vacio({ icono: 'subir', titulo: 'No tienes envíos en trámite', texto: 'Los avisos y logros se publican de inmediato y no pasan por aquí: búscalos en Publicadas.' }) });
  }
  // Anatomía en 4 niveles (auditoría de reportes, R-2): ¿la gente leyó lo obligatorio?
  function vistaCumplimiento(d) {
    var R = window.SigsoReportes;
    var l = (d.items || []).slice();
    var cuenta = function (e) { return l.filter(function (x) { return x.estado_cumplimiento === e; }).length; };
    var orden = { VENCIDA: 0, POR_VENCER: 1, AL_DIA: 2, CUMPLIDA: 3 };
    l.sort(function (a, b) { return (orden[a.estado_cumplimiento] === undefined ? 9 : orden[a.estado_cumplimiento]) - (orden[b.estado_cumplimiento] === undefined ? 9 : orden[b.estado_cumplimiento]) || a.dias_para_vencer - b.dias_para_vencer; });
    if (!R) return vistaCumplimientoLista(l);
    if (!l.length) return U.card({ i: 1, cuerpo: U.vacio({ icono: 'check', titulo: 'Sin plazos activos', texto: 'Aquí aparecen las novedades que piden confirmar la lectura antes de una fecha.' }) });
    var pedidas = l.reduce(function (s, x) { return s + (x.total_audiencia || 0); }, 0);
    var hechas = l.reduce(function (s, x) { return s + (x.confirmados || 0); }, 0);
    var pct = pedidas ? Math.round(hechas / pedidas * 100) : null;
    var venc = cuenta('VENCIDA'), porVencer = cuenta('POR_VENCER');
    var sinCuenta = l.reduce(function (s, x) { return s + (x.sin_cuenta || 0); }, 0);

    // Quién debe lecturas, a partir de los lectores de cada novedad abierta.
    var personas = {}, conLectores = l.filter(function (x) { return x.lectores; });
    conLectores.forEach(function (x) {
      (x.lectores.pendientes || []).forEach(function (p) {
        var k = String(p.email || p.nombre).toLowerCase();
        var o = personas[k] = personas[k] || { email: p.email, nombre: String(p.nombre || p.email).trim(), venc: 0, prox: 0, masVieja: 0, titulos: [], sinCuenta: p.sin_cuenta, nuncaEntro: p.nunca_entro };
        if (x.estado_cumplimiento === 'VENCIDA') {
          o.venc++; o.masVieja = Math.max(o.masVieja, -x.dias_para_vencer);
          if (o.titulos.length < 2) o.titulos.push('«' + x.titulo + '»');
        } else if (x.estado_cumplimiento === 'POR_VENCER') o.prox++;
      });
    });
    var deudores = Object.keys(personas).map(function (k) { return personas[k]; }).filter(function (o) { return o.venc; });

    // 1 · En una línea
    var estado = venc ? 'critico' : (porVencer ? 'alerta' : 'ok');
    var frase = 'De ' + l.length + (l.length === 1 ? ' novedad' : ' novedades') + ' con plazo de lectura, ' +
      (venc ? venc + (venc === 1 ? ' venció' : ' vencieron') + ' sin que todos confirmaran' : 'ninguna está vencida') +
      (porVencer ? ' y ' + porVencer + ' por vencer' : '') +
      (pct === null ? '' : '; en total se confirmó el ' + pct + ' % de las lecturas pedidas (' + hechas + ' de ' + pedidas + ')') +
      (deudores.length ? '; ' + deudores.length + (deudores.length === 1 ? ' persona debe' : ' personas deben') + ' lecturas vencidas' : '') + '.';
    var linea = R.enUnaLinea({ estado: estado, frase: frase, kpis: [
      { etiqueta: 'Lectura confirmada', valor: pct === null ? '—' : pct, sufijo: pct === null ? '' : '%', icono: 'check', progreso: pct,
        tono: pct === null ? 'neutro' : (pct >= 90 ? 'ok' : (pct >= 70 ? 'alerta' : 'critico')), nota: hechas + ' de ' + pedidas + ' lecturas' },
      { etiqueta: 'Vencidas', valor: venc, icono: 'alerta', tono: venc ? 'critico' : 'ok', nota: 'sin completar' },
      { etiqueta: 'Por vencer', valor: porVencer, icono: 'reloj', tono: porVencer ? 'alerta' : 'ok', nota: cuenta('AL_DIA') + ' al día · ' + cuenta('CUMPLIDA') + ' cumplidas' },
      { etiqueta: 'Personas con atraso', valor: conLectores.length ? deudores.length : '—', icono: 'persona', tono: !conLectores.length ? 'neutro' : (deudores.length ? 'critico' : 'ok'),
        nota: conLectores.length ? 'con alguna lectura vencida' : 'sin acceso al detalle' }
    ] });

    // 2 · Lo que requiere decisión: una fila por persona con lecturas vencidas.
    var alertas = deudores.map(function (o) {
      return { severidad: o.venc >= 2 || o.masVieja > 14 ? 'critico' : 'alerta', cantidad: o.venc, titulo: o.nombre,
        detalle: o.venc + (o.venc === 1 ? ' lectura vencida' : ' lecturas vencidas') + (o.masVieja ? ', la más antigua hace ' + o.masVieja + ' días' : '') +
          (o.prox ? ' · ' + o.prox + ' por vencer' : '') + ' — ' + o.titulos.join(', '),
        dueno: o.sinCuenta ? 'Sin cuenta en SIGSO' : (o.nuncaEntro ? 'Nunca ha entrado' : '') };
    });
    if (sinCuenta) alertas.push({ severidad: 'alerta', cantidad: sinCuenta, titulo: 'Destinatarios sin cuenta en SIGSO', detalle: 'No pueden confirmar la lectura hasta que se les cree la cuenta.', dueno: 'Administración' });
    var decision = R.requiereDecision(alertas, { vacio: conLectores.length ? 'Nadie debe lecturas vencidas.' : 'No hay lecturas vencidas que asignar a personas.' });

    // 3 · Panorama: lectura por novedad (la más baja arriba).
    var panorama = '<h3 class="rp2-sub">Lectura por novedad <span class="sx2-tenue" style="font-weight:500;font-size:.8125rem">(la más baja arriba)</span></h3>' +
      R.ranking(l.slice().sort(function (a, b) { return (a.confirmados / (a.total_audiencia || 1)) - (b.confirmados / (b.total_audiencia || 1)); }).map(function (x) {
        var p = x.total_audiencia ? Math.round(x.confirmados * 100 / x.total_audiencia) : 0;
        return { etiqueta: x.titulo, valor: p, texto: x.confirmados + '/' + x.total_audiencia + ' · ' + p + '%', tono: (CUMPL[x.estado_cumplimiento] || [0, 'neutro'])[1] === 'info' ? 'primario' : (CUMPL[x.estado_cumplimiento] || [0, 'neutro'])[1] };
      }), { max: 100, sinPosicion: true });
    var al100 = l.filter(function (x) { return x.total_audiencia && x.confirmados === x.total_audiencia; });
    panorama += R.loQueVaBien(al100.length ? [al100.length + (al100.length === 1 ? ' novedad ya tiene' : ' novedades ya tienen') + ' la lectura de todos.'] : []);

    // 4 · Detalle: la lista de siempre (se abre cada novedad para ver quién falta).
    return '<div class="sx2-card sx2-entra js-nv2-doc" style="--i:1">' +
      R.nivel('En una línea', linea) +
      R.nivel('Lo que requiere decisión', decision, { nota: alertas.length ? 'por persona · la cifra es cuántas vencidas' : '' }) +
      R.nivel('Panorama', panorama) +
      R.nivel('Detalle · abre una novedad para ver quién falta', vistaCumplimientoLista(l, true), { clase: 'rp2-nivel--detalle', nota: l.length + (l.length === 1 ? ' novedad' : ' novedades') }) +
      '</div>';
  }
  // R-3: el reporte de cumplimiento tal como se ve, impreso con Chromium en el servidor.
  function descargarPdfCumplimiento(b) {
    var doc = document.querySelector('#novedades-v2 .js-nv2-doc');
    if (!doc || !window.SigsoReportes) return;
    SigsoReportes.descargarPdf(doc, { titulo: 'Cumplimiento de lectura', nombreArchivo: 'sigso-cumplimiento-lectura', boton: b,
      cabecera: SigsoReportes.cabeceraDocumento({ titulo: 'Cumplimiento de lectura', subtitulo: '¿La gente leyó lo obligatorio?', modulo: 'Novedades',
        codigo: 'SIGSO-REP-NOV-CUMPLIMIENTO', generadoPor: (PY.miNombre && PY.miNombre()) || '' }) });
  }
  // dentro: la lista va dentro del nivel Detalle del reporte (sin tarjeta propia).
  function vistaCumplimientoLista(l, dentro) {
    var ul = '<ul class="nv2-lista' + (dentro ? ' nv2-lista--rep' : '') + '">';
    return (l.length ? (dentro ? ul : '<section class="sx2-card sx2-card--sin-relleno sx2-entra" style="--i:3">' + ul) + l.map(function (x, i) {
          var e = CUMPL[x.estado_cumplimiento] || [x.estado_cumplimiento, 'neutro'];
          var pct = x.total_audiencia ? Math.round(x.confirmados * 100 / x.total_audiencia) : 0;
          var p = plazo(x);
          return '<li class="nv2-fila sx2-entra" style="--i:' + Math.min(i + 4, 12) + '" data-nv2="' + U.esc(x.novedad_id) + '" tabindex="0">' +
            '<span class="sx2-apilado" style="gap:6px;min-width:0;flex:1">' +
              '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + U.badge(x.tipo_etiqueta || x.tipo, tonoTipo(x)) + U.badge(e[0], e[1]) + '</span>' +
              '<strong class="sx2-cortar">' + U.esc(x.titulo) + '</strong>' +
              '<span class="sx2-flex" style="gap:10px;align-items:center">' + U.barra(pct, pct === 100 ? 'ok' : e[1]) +
                '<span class="sx2-tenue" style="flex:none;font-size:.75rem">' + x.confirmados + ' de ' + x.total_audiencia + ' confirmaron' + (x.sin_cuenta ? ' · ' + x.sin_cuenta + ' sin cuenta' : '') + '</span></span>' +
            '</span>' +
            '<span class="nv2-fila__estado">' + U.badge(p.txt, p.tono) + '</span></li>';
        }).join('') + (dentro ? '</ul>' : '</ul></section>')
        : U.card({ i: 3, cuerpo: U.vacio({ icono: 'check', titulo: 'Sin plazos activos', texto: 'Aquí aparecen las novedades que piden confirmar la lectura antes de una fecha.' }) }));
  }

  // --- Eventos ------------------------------------------------------------------------
  document.addEventListener('click', function (ev) {
    var t = ev.target, b;
    // Filas de novedades pendientes en el Inicio (fuera del módulo).
    if ((b = t.closest && t.closest('[data-nv2-inicio]'))) { abrir(b.getAttribute('data-nv2-inicio')); return; }
    var raiz = document.getElementById('novedades-v2');
    if (!raiz || !raiz.contains(t)) return;
    if (t.closest('.js-nv2-recargar')) { cargar(!!datos_[vista_]); return; }
    if (t.closest('.js-nv2-publicar')) { abrirPublicar(); return; }
    if ((b = t.closest('.js-nv2-pdf'))) { descargarPdfCumplimiento(b); return; }
    if ((b = t.closest('.js-nv2-corregir'))) { reenviarPorId(b.getAttribute('data-id')); return; }
    if ((b = t.closest('.js-nv2-tipo'))) { filtro_ = b.getAttribute('data-tipo') || ''; pintar(true); return; }
    if ((b = t.closest('[data-nv2]'))) abrir(b.getAttribute('data-nv2'));
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('#novedades-v2 [data-nv2], [data-nv2-inicio]')) { ev.preventDefault(); ev.target.click(); }
  });
  document.addEventListener('sigso:novedad-leida', function () {
    var c = document.getElementById('novedades-v2');
    if (c && c.offsetParent !== null && vista_ === 'feed') cargar(true);
  });

  function irA(v) {
    vista_ = VISTAS[v] ? v : 'feed';
    if (vista_ === 'cumplimiento' && permisos_ && !permisos_.puede_general) vista_ = 'feed';
    if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(vista_);
    cargar(!!datos_[vista_] && !!document.getElementById('novedades-v2'));
  }

  function activo() { return true; }
  function usarVersion() { /* sin versión clásica */ }

  window.SigsoNovedadesV2 = {
    mostrar: function (v) { irA(v || vista_); },
    cargar: function () { irA('feed'); },
    refrescar: function () { cargar(true); },
    abrir: abrir,
    // Para el Inicio: filas de novedades por confirmar.
    filasInicio: function (lista) {
      return (lista || []).map(function (n) {
        var p = plazo(n);
        return '<li class="sx2-py-mt-fila sx2-tono-' + p.tono + '" data-nv2-inicio="' + U.esc(n.novedad_id) + '" tabindex="0"><span class="sx2-py-punto"></span>' +
          '<span class="sx2-apilado" style="gap:4px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(n.titulo) + '</strong>' +
          '<span class="sx2-flex" style="gap:6px;flex-wrap:wrap">' + U.badge(n.tipo_etiqueta || n.tipo, tonoTipo(n)) + '<span class="sx2-tenue" style="font-size:.75rem">' + U.esc(autor(n)) + '</span></span></span>' +
          '<span class="sx2-py-mt-cuando' + (p.tono === 'critico' ? ' sx2-delta--mal' : '') + '">' + U.esc(p.txt) + '</span>' +
          U.boton({ texto: 'Leer', icono: 'ojo', sm: true, variante: 'primario' }) + '</li>';
      }).join('');
    },
    activo: activo, usarVersion: usarVersion, desmontar: desmontar
  };

  // API que usan el shell y el Inicio (antes en novedades.js, que ya no se carga aquí).
  window.SigsoNovedades = {
    cargar: function () {
      var pedida = (window.SigsoShell && SigsoShell.tomarItemDeRuta) ? SigsoShell.tomarItemDeRuta() : '';
      irA(pedida || 'feed');
    },
    irAItem: irA,
    actualizarBadge: actualizarBadge,
    invalidarFeed: invalidarFeed,
    puedePublicar: puedePublicar,
    abrirPublicar: abrirPublicar,
    abrirReenviar: abrirReenviar,
    resumenPendientes: function () {
      return feed().then(function (r) {
        if (!r || !r.ok) return { pendientes: 0, destacada: null, lista: [] };
        var lista = (r.data.recientes || []).filter(function (n) { return n.requiere_acuse && !n.leida; });
        return { pendientes: (r.data.resumen && r.data.resumen.pendientes) || 0, destacada: lista[0] || null, lista: lista };
      });
    }
  };

  // El árbol se registra temprano (sin permisos todavía): el sidebar dibuja
  // el chevron desde el arranque; al llegar los permisos se vuelve a registrar.
  registrarArbol();
})();
