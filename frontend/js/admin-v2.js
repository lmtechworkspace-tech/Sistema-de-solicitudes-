/**
 * admin-v2.js — Administración v2 (SIGSO v2, Módulo 7; análisis y
 * decisiones en documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 * 7A "Salud de la configuración": revisa junto lo que las 15 pantallas de
 * Administración miran por separado (cuentas, jefaturas, pausas, directorio
 * legado, datos) y, para los casos simples, ofrece un arreglo que se
 * confirma antes de aplicarse (decisión del dueño). Backend getSaludConfig /
 * arreglarSaludConfig. Las demás pantallas siguen en admin.js.
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;
  var CLAVE_PREF = 'sigso_admin_v2';
  var PANTALLA = {
    CUENTAS_PORTAL: 'Cuentas plataforma', USUARIOS: 'Usuarios (legado)', JEFATURAS: 'Jefaturas',
    PAUSAS: 'Pausas activas', AREA: 'Áreas / responsables'
  };
  var SEV = { critico: ['Crítico', 'critico', 'alerta'], alerta: ['Revisar', 'alerta', 'info'], info: ['Aviso', 'info', 'info'] };
  var datos_ = null, turno_ = 0;

  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }

  // --- Montaje ----------------------------------------------------------------------
  function seccion() { return document.getElementById('modulo-administracion'); }
  function contenedor() {
    var s = seccion();
    if (!s) return null;
    var c = document.getElementById('admin-v2');
    if (!c) {
      c = document.createElement('div');
      c.id = 'admin-v2';
      c.className = 'sx2';
      s.appendChild(c);
    }
    s.classList.add('admin-v2-activa');
    return c;
  }
  function desmontar() {
    var s = seccion();
    if (s) s.classList.remove('admin-v2-activa');
    var c = document.getElementById('admin-v2');
    if (c) c.remove();
  }

  // --- Salud de la configuración ---------------------------------------------------------
  function cargarSalud(silencioso) {
    var c = contenedor();
    if (!c) return;
    var t = ++turno_;
    if (!silencioso || !datos_) c.innerHTML = '<div class="sx2-pagina">' + cabecera() + U.esqueleto('kpis', 4) + U.esqueleto('tabla', 6) + '</div>';
    api('getSaludConfig', {}).then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) {
        c.innerHTML = '<div class="sx2-pagina">' + cabecera() + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo revisar la configuración',
          texto: (r && r.message) || 'Inténtalo de nuevo.', accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-ad2-recargar' }) }) }) + '</div>';
        return;
      }
      datos_ = r.data;
      pintar(!!silencioso);
    });
  }
  function cabecera() {
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Administración</span><h1>Salud de la configuración</h1>' +
      '<span class="sx2-tenue" style="font-size:.875rem">Revisa que cuentas, equipos, listas y datos calcen entre sí.</span></div>' +
      '<div class="sx2-cabecera__acciones">' + U.boton({ texto: 'Volver a revisar', icono: 'tendencia', clase: 'js-ad2-recargar' }) + '</div></header>';
  }
  function tarjetaCheck(ch, i) {
    var s = SEV[ch.severidad] || SEV.info;
    return '<section class="sx2-card ad2-check sx2-tono-' + s[1] + ' sx2-entra" style="--i:' + Math.min(i + 2, 12) + '">' +
      '<div class="ad2-check__cab">' +
        '<span class="ad2-check__ico">' + U.ico(ch.severidad === 'critico' ? 'alerta' : (ch.severidad === 'alerta' ? 'info' : 'check'), 18) + '</span>' +
        '<span class="sx2-apilado" style="gap:4px;flex:1;min-width:0">' +
          '<span class="sx2-flex" style="gap:8px;flex-wrap:wrap"><strong>' + U.esc(ch.titulo) + '</strong>' + U.badge(s[0], s[1], true) + U.badge(ch.casos.length + (ch.casos.length === 1 ? ' caso' : ' casos'), 'neutro', true) + '</span>' +
          '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(ch.explicacion) + '</span>' +
        '</span>' +
        (ch.ir && PANTALLA[ch.ir] ? U.boton({ texto: 'Ir a ' + PANTALLA[ch.ir], icono: 'derecha', sm: true, variante: 'fantasma', clase: 'js-ad2-ir', datos: { ir: ch.ir } }) : '') +
      '</div>' +
      '<ul class="ad2-casos">' + ch.casos.map(function (k, j) {
        return '<li><span class="sx2-cortar" title="' + U.esc(k.texto) + '">' + U.esc(k.texto) + '</span>' +
          '<span class="ad2-casos__acc">' +
            (k.solicitud_id && window.SigsoBandejaV2 ? U.boton({ texto: 'Abrir solicitud', icono: 'bandeja', sm: true, clase: 'js-ad2-sol', datos: { sol: k.solicitud_id } }) : '') +
            (k.arreglos || []).map(function (a, n) {
              return U.boton({ texto: a.texto, icono: a.tipo === 'resetear_clave' ? 'llave' : (a.tipo === 'quitar_modulo' ? 'equis' : 'check'), sm: true,
                variante: n === 0 ? 'primario' : 'secundario', clase: 'js-ad2-arreglar', datos: { check: ch.id, caso: j, arreglo: n } });
            }).join('') +
          '</span></li>';
      }).join('') + '</ul></section>';
  }
  function pintar(silencioso) {
    var c = contenedor();
    if (!c || !datos_) return;
    var d = datos_, r = d.resumen, y = window.scrollY;
    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, icono: 'alerta', tono: r.criticos ? 'critico' : 'ok', etiqueta: 'Críticos', valor: r.criticos, unidad: 'afectan a alguien hoy' }) +
      U.kpi({ i: 1, icono: 'info', tono: r.problemas ? 'alerta' : 'ok', etiqueta: 'Por revisar', valor: r.problemas, unidad: 'casos en total' }) +
      U.kpi({ i: 2, icono: 'rayo', tono: r.con_arreglo ? 'primario' : 'neutro', etiqueta: 'Arreglo en un clic', valor: r.con_arreglo, unidad: 'se corrigen desde aquí' }) +
      U.kpi({ i: 3, icono: 'persona', tono: 'neutro', etiqueta: 'Cuentas activas', valor: r.cuentas_activas, unidad: 'en la plataforma' }) +
    '</div>';
    var cuerpo;
    if (!d.checks.length) {
      cuerpo = U.card({ i: 2, cuerpo: U.vacio({ icono: 'check', titulo: 'Todo calza', texto: 'No encontramos problemas en cuentas, equipos, listas ni datos.' }) });
    } else {
      var grupos = [], porGrupo = {};
      d.checks.forEach(function (ch) {
        if (!porGrupo[ch.grupo]) { porGrupo[ch.grupo] = []; grupos.push(ch.grupo); }
        porGrupo[ch.grupo].push(ch);
      });
      var i = 0;
      cuerpo = grupos.map(function (g) {
        return '<h2 class="ad2-grupo">' + U.esc(g) + '</h2>' + porGrupo[g].map(function (ch) { return tarjetaCheck(ch, i++); }).join('');
      }).join('');
    }
    c.innerHTML = '<div class="sx2-pagina">' + cabecera() + kpis + cuerpo + '</div>';
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    U.animar(c);
  }

  function mostrarClave(r) {
    var d = U.drawer({ titulo: 'Clave temporal generada', subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Entrégala a la persona por un canal privado. Al entrar, SIGSO le pedirá cambiarla.</span>',
      cuerpo: '<dl class="sx2-dato"><dt>Usuario</dt><dd><strong>' + U.esc(r.usuario || '') + '</strong></dd><dt>Clave temporal</dt><dd><code class="ad2-clave">' + U.esc(r.password_temporal) + '</code></dd></dl>' +
        '<p class="sx2-tenue" style="margin:0;font-size:.8125rem">No la volverás a ver: cópiala ahora.</p>',
      pie: U.boton({ texto: 'Copiar clave', icono: 'copiar', variante: 'primario', clase: 'js-ad2-copiar' }) + U.boton({ texto: 'Listo', clase: 'js-sx2-drawer-cerrar' }) });
    d.el.querySelector('.js-ad2-copiar').addEventListener('click', function () {
      try { navigator.clipboard.writeText(r.password_temporal).then(function () { PY.aviso('Clave copiada.', 'exito'); }); } catch (e) { PY.aviso('Cópiala a mano.', 'error'); }
    });
  }
  function arreglar(b) {
    var ch = datos_.checks.filter(function (x) { return x.id === b.getAttribute('data-check'); })[0];
    var caso = ch && ch.casos[Number(b.getAttribute('data-caso'))];
    var a = caso && caso.arreglos[Number(b.getAttribute('data-arreglo'))];
    if (!a) return;
    U.confirmar({ titulo: a.texto + '?', texto: a.confirmar, boton: a.texto, peligro: a.tipo === 'quitar_modulo' || a.tipo === 'resetear_clave' }).then(function (si) {
      if (!si) return;
      b.disabled = true;
      api('arreglarSaludConfig', { tipo: a.tipo, params: a.params }).then(function (r) {
        if (!r || !r.ok) { b.disabled = false; PY.aviso((r && r.message) || 'No se pudo aplicar.', 'error'); return; }
        if (r.data && r.data.password_temporal) mostrarClave(r.data);
        else PY.aviso('Listo: arreglado.', 'exito');
        cargarSalud(true);
      });
    });
  }

  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('admin-v2');
    if (!raiz || !raiz.contains(ev.target)) return;
    var t = ev.target, b;
    if (t.closest('.js-ad2-recargar')) { cargarSalud(!!datos_); return; }
    if (!datos_) return;
    if ((b = t.closest('.js-ad2-arreglar'))) { arreglar(b); return; }
    if ((b = t.closest('.js-ad2-ir'))) { if (window.SigsoAdmin) SigsoAdmin.irAItem(b.getAttribute('data-ir')); return; }
    if ((b = t.closest('.js-ad2-sol')) && window.SigsoBandejaV2) SigsoBandejaV2.abrirSolicitud(b.getAttribute('data-sol'));
  });

  function activo() { try { return localStorage.getItem(CLAVE_PREF) !== '0'; } catch (e) { return true; } }
  function usarVersion(v2) {
    try { localStorage.setItem(CLAVE_PREF, v2 ? '1' : '0'); } catch (e) { /* sin storage: no se recuerda */ }
    document.dispatchEvent(new CustomEvent('sigso:v2-version', { detail: { modulo: 'administracion', v2: !!v2 } }));
  }

  window.SigsoAdminV2 = {
    mostrarSalud: function () { cargarSalud(!!datos_ && !!document.getElementById('admin-v2')); },
    cargar: function () { if (window.SigsoAdmin) SigsoAdmin.irAItem('SALUD'); },
    refrescar: function () { cargarSalud(true); },
    activo: activo, usarVersion: usarVersion, desmontar: desmontar
  };
  if (window.SigsoAdmin && SigsoAdmin.registrarArbol) SigsoAdmin.registrarArbol();
})();
