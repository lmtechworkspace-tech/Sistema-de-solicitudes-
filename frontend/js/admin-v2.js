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
  var datos_ = null, turno_ = 0, vista_ = '';

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
    vista_ = '';
    var s = seccion();
    if (s) s.classList.remove('admin-v2-activa');
    var c = document.getElementById('admin-v2');
    if (c) c.remove();
  }

  // --- Salud de la configuración ---------------------------------------------------------
  function cargarSalud(silencioso) {
    vista_ = 'salud';
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
    if (vista_ !== 'salud') return;
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
    if (!datos_ || !raiz.querySelector('.ad2-check, .sx2-vacio')) return;
    if ((b = t.closest('.js-ad2-arreglar'))) { arreglar(b); return; }
    if ((b = t.closest('.js-ad2-ir'))) { if (window.SigsoAdmin) SigsoAdmin.irAItem(b.getAttribute('data-ir')); return; }
    if ((b = t.closest('.js-ad2-sol')) && window.SigsoBandejaV2) SigsoBandejaV2.abrirSolicitud(b.getAttribute('data-sol'));
  });

  // =========================================================================
  // 7B "Cuentas de la plataforma" v2: cada persona con su estado de acceso
  // (clave temporal, último acceso), sus módulos y lo que la Salud detectó
  // sobre ella; edición y acciones en un panel lateral. Mismo backend
  // (listarCuentasPortal / gestionarCuentaPortal) que la pantalla clásica.
  // =========================================================================
  var ROLES = [['SOLICITANTE', 'Solicitante'], ['ANA', 'Gestor/Analista'], ['DEV', 'Desarrollador'], ['GERENCIA', 'Gerencia'], ['JEFATURA', 'Jefatura'], ['ADM', 'Administrador']];
  var MODULOS = [['nueva_solicitud', 'Nueva solicitud'], ['mis_solicitudes', 'Mis solicitudes'], ['bandeja', 'Bandeja de trabajo'], ['mi_trabajo', 'Mi trabajo'],
    ['proyectos', 'Proyectos'], ['gerencia', 'Panel de gerencia'], ['jefatura', 'Mi departamento'], ['administracion', 'Administración'],
    ['pausas', 'Pausas activas'], ['pausas_coordinacion', 'Coordinación de pausas'], ['calidad', 'Calidad (SGC)']];
  var cuentas_ = null, saludPorCuenta_ = {}, fc_ = { estado: 'activas', texto: '', rol: '' }, turnoC_ = 0;
  function rolTxt(r) { var x = ROLES.filter(function (k) { return k[0] === r; })[0]; return x ? x[1] : r; }
  function modTxt(m) { var x = MODULOS.filter(function (k) { return k[0] === m; })[0]; return x ? x[1] : m; }
  function diasDesde(iso) { return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null; }
  function acceso(c) {
    var d = diasDesde(c.ultimo_acceso);
    if (!c.activo) return { txt: 'Desactivada', tono: 'neutro' };
    if (d === null) return { txt: 'Nunca entró', tono: 'alerta' };
    if (d === 0) return { txt: 'Entró hoy', tono: 'ok' };
    if (d <= 7) return { txt: 'Entró hace ' + d + (d === 1 ? ' día' : ' días'), tono: 'ok' };
    if (d <= 30) return { txt: 'Entró hace ' + d + ' días', tono: 'info' };
    return { txt: 'No entra hace ' + d + ' días', tono: 'alerta' };
  }
  var FILTROS_C = [
    ['activas', 'Activas', function (c) { return c.activo; }],
    ['temporal', 'Clave temporal', function (c) { return c.activo && c.debe_cambiar_password; }],
    ['sin_uso', 'Sin entrar 30+ días', function (c) { var d = diasDesde(c.ultimo_acceso); return c.activo && (d === null || d > 30); }],
    ['problemas', 'Con problemas', function (c) { return c.activo && (saludPorCuenta_[c.cuenta_id] || []).length > 0; }],
    ['desactivadas', 'Desactivadas', function (c) { return !c.activo; }]
  ];

  function cargarCuentas(silencioso) {
    vista_ = 'cuentas';
    var c = contenedor();
    if (!c) return;
    var t = ++turnoC_;
    if (!silencioso || !cuentas_) c.innerHTML = '<div class="sx2-pagina">' + cabeceraCuentas() + U.esqueleto('kpis', 4) + U.esqueleto('tabla', 8) + '</div>';
    Promise.all([api('listarCuentasPortal', {}), api('getSaludConfig', {})]).then(function (r) {
      if (t !== turnoC_) return;
      if (!r[0] || !r[0].ok) {
        c.innerHTML = '<div class="sx2-pagina">' + cabeceraCuentas() + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudieron cargar las cuentas', texto: (r[0] && r[0].message) || 'Inténtalo de nuevo.' }) }) + '</div>';
        return;
      }
      cuentas_ = r[0].data.cuentas || [];
      saludPorCuenta_ = {};
      if (r[1] && r[1].ok) {
        r[1].data.checks.forEach(function (ch) {
          ch.casos.forEach(function (k) { if (k.cuenta_id) (saludPorCuenta_[k.cuenta_id] = saludPorCuenta_[k.cuenta_id] || []).push({ titulo: ch.titulo, severidad: ch.severidad, caso: k }); });
        });
      }
      pintarCuentas(!!silencioso);
      var correos = cuentas_.map(function (x) { return (x.emails || [])[0]; }).filter(Boolean);
      U.precargarFotos(correos).then(function () { if (t === turnoC_) pintarCuentas(true); });
    });
  }
  function cabeceraCuentas() {
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Administración · Accesos</span><h1>Cuentas de la plataforma</h1>' +
      '<span class="sx2-tenue" style="font-size:.875rem">Cada cuenta es una persona: sus correos, su rol, qué módulos ve y cómo está su acceso.</span></div>' +
      '<div class="sx2-cabecera__acciones">' + U.boton({ texto: 'Nueva cuenta', icono: 'nueva', variante: 'primario', clase: 'js-ad2-nueva' }) + '</div></header>';
  }
  function filaCuenta(c, i) {
    var a = acceso(c), probs = saludPorCuenta_[c.cuenta_id] || [];
    var per = { email: (c.emails || [])[0] || '', nombre: c.nombre || c.usuario };
    return '<li class="ad2-cuenta' + (c.activo ? '' : ' ad2-cuenta--off') + ' sx2-entra" style="--i:' + Math.min(i + 3, 12) + '" data-ad2-cuenta="' + U.esc(c.cuenta_id) + '" tabindex="0">' +
      U.avatar(per, 'sm') +
      '<span class="sx2-apilado" style="gap:3px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(c.nombre || c.usuario) + '</strong>' +
        '<span class="sx2-tenue sx2-cortar" style="font-size:.75rem">' + U.esc([c.cargo, c.usuario, (c.emails || []).join(', ')].filter(Boolean).join(' · ')) + '</span></span>' +
      '<span class="ad2-cuenta__rol">' + U.badge(rolTxt(c.rol), c.rol === 'ADM' ? 'critico' : (c.rol === 'GERENCIA' ? 'hito' : 'neutro'), true) +
        '<small class="sx2-tenue">' + (c.modulos || []).length + ' módulos</small></span>' +
      '<span class="ad2-cuenta__estado">' + U.badge(a.txt, a.tono) + (c.activo && c.debe_cambiar_password ? U.badge('Clave temporal', 'alerta', true) : '') + '</span>' +
      '<span class="ad2-cuenta__prob">' + (probs.length ? U.badge(probs.length + (probs.length === 1 ? ' problema' : ' problemas'), 'critico', true) : '') + '</span>' +
      U.ico('derecha', 16) + '</li>';
  }
  function pintarCuentas(silencioso) {
    if (vista_ !== 'cuentas') return;
    var c = contenedor();
    if (!c || !cuentas_) return;
    var y = window.scrollY;
    var activas = cuentas_.filter(function (x) { return x.activo; });
    var semana = activas.filter(function (x) { var d = diasDesde(x.ultimo_acceso); return d !== null && d <= 7; }).length;
    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, icono: 'persona', tono: 'primario', etiqueta: 'Activas', valor: activas.length, unidad: 'cuentas', filtro: 'activas', activo: fc_.estado === 'activas' }) +
      U.kpi({ i: 1, icono: 'check', tono: 'ok', etiqueta: 'Entraron esta semana', valor: semana, unidad: 'de ' + activas.length }) +
      U.kpi({ i: 2, icono: 'llave', tono: 'alerta', etiqueta: 'Clave temporal', valor: FILTROS_C[1][2] ? cuentas_.filter(FILTROS_C[1][2]).length : 0, unidad: 'sin cambiar', filtro: 'temporal', activo: fc_.estado === 'temporal' }) +
      U.kpi({ i: 3, icono: 'alerta', tono: 'critico', etiqueta: 'Con problemas', valor: cuentas_.filter(FILTROS_C[3][2]).length, unidad: 'según la Salud', filtro: 'problemas', activo: fc_.estado === 'problemas' }) +
    '</div>';
    var f = FILTROS_C.filter(function (x) { return x[0] === fc_.estado; })[0] || FILTROS_C[0];
    var q = fc_.texto.toLowerCase();
    var lista = cuentas_.filter(f[2]).filter(function (x) {
      if (fc_.rol && x.rol !== fc_.rol) return false;
      return !q || [x.nombre, x.usuario, x.cargo, (x.emails || []).join(' ')].join(' ').toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) { return String(a.nombre || a.usuario).localeCompare(String(b.nombre || b.usuario)); });
    var herramientas = '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:2"><div class="sx2-barra-filtros">' +
      '<label class="sx2-buscar">' + U.ico('lupa', 16) + '<input class="sx2-input js-ad2-buscar" type="search" placeholder="Buscar por nombre, usuario o correo…" value="' + U.esc(fc_.texto) + '"></label>' +
      '<select class="sx2-select js-ad2-rol" aria-label="Rol"><option value="">Todos los roles</option>' + ROLES.map(function (r) { return '<option value="' + r[0] + '"' + (fc_.rol === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select>' +
      FILTROS_C.map(function (x) { return U.chip({ texto: x[1], activo: fc_.estado === x[0], clase: 'js-ad2-estado', datos: { estado: x[0] } }); }).join('') +
    '</div></div>';
    c.innerHTML = '<div class="sx2-pagina">' + cabeceraCuentas() + kpis + herramientas +
      (lista.length ? '<section class="sx2-card sx2-card--sin-relleno sx2-entra" style="--i:3"><ul class="ad2-cuentas">' + lista.map(filaCuenta).join('') + '</ul></section>'
        : U.card({ i: 3, cuerpo: U.vacio({ icono: 'lupa', texto: 'Ninguna cuenta con estos filtros.' }) })) + '</div>';
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    U.animar(c);
  }

  function gestionar(datos) { return api('gestionarCuentaPortal', datos); }
  function abrirCuenta(id) {
    var c = id ? cuentas_.filter(function (x) { return x.cuenta_id === id; })[0] : null;
    var nueva = !c;
    var mods = c ? (c.modulos || []).slice() : [];
    var d = U.drawer({ titulo: nueva ? 'Nueva cuenta' : (c.nombre || c.usuario), cuerpo: '', pie: ' ' });
    d.el.classList.add('bj2-drawer');
    function pintarD() {
      var probs = c ? (saludPorCuenta_[c.cuenta_id] || []) : [];
      var a = c ? acceso(c) : null;
      d.cuerpo(
        (probs.length ? '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">La Salud detectó</h3><ul class="ad2-casos">' + probs.map(function (p) {
          return '<li><span>' + U.badge(p.severidad === 'critico' ? 'Crítico' : 'Revisar', p.severidad === 'critico' ? 'critico' : 'alerta', true) + ' ' + U.esc(p.titulo) + '</span></li>';
        }).join('') + '</ul></section>' : '') +
        (c ? '<section class="sx2-seccion-drawer"><h3 class="sx2-seccion-drawer__titulo">Acceso</h3><dl class="sx2-dato">' +
          '<dt>Usuario</dt><dd><strong>' + U.esc(c.usuario) + '</strong></dd>' +
          '<dt>Estado</dt><dd>' + U.badge(a.txt, a.tono) + (c.debe_cambiar_password ? ' ' + U.badge('Clave temporal sin cambiar', 'alerta', true) : '') + '</dd>' +
          '<dt>Último acceso</dt><dd>' + (c.ultimo_acceso ? U.esc(PY.fecha(c.ultimo_acceso, true)) : 'Nunca') + '</dd></dl>' +
          '<div class="sx2-flex" style="gap:6px;flex-wrap:wrap">' +
            U.boton({ texto: 'Generar clave temporal', icono: 'llave', sm: true, clase: 'js-ad2c-reset' }) +
            U.boton({ texto: 'Asignar clave', icono: 'editar', sm: true, clase: 'js-ad2c-asignar' }) +
            U.boton({ texto: 'Cambiar usuario', icono: 'persona', sm: true, clase: 'js-ad2c-renombrar' }) +
            U.boton({ texto: c.activo ? 'Desactivar' : 'Activar', icono: c.activo ? 'equis' : 'check', sm: true, clase: 'js-ad2c-activar' }) +
            U.boton({ texto: 'Eliminar', icono: 'basura', sm: true, variante: 'texto-peligro', clase: 'js-ad2c-eliminar' }) +
          '</div></section>' : '') +
        '<form class="sx2-form js-ad2c-form" novalidate><h3 class="sx2-seccion-drawer__titulo">Datos</h3>' +
          (nueva ? PY.campo('Usuario (para entrar)', '<input class="sx2-input" name="usuario" placeholder="ej. cpena" maxlength="30">', '3 a 30 caracteres: letras, números, punto o guion.') : '') +
          '<div class="sx2-form__fila">' + PY.campo('Nombre completo', '<input class="sx2-input" name="nombre" value="' + U.esc(c ? c.nombre : '') + '">') +
            PY.campo('Cargo', '<input class="sx2-input" name="cargo" value="' + U.esc(c ? c.cargo || '' : '') + '">') + '</div>' +
          PY.campo('Correos (separados por coma)', '<input class="sx2-input" name="emails" value="' + U.esc(c ? (c.emails || []).join(', ') : '') + '">', 'SIGSO la reconoce por estos correos: solicitudes, tareas y avisos.') +
          '<div class="sx2-form__fila">' + PY.campo('Rol', '<select class="sx2-select" name="rol">' + ROLES.map(function (r) {
              return '<option value="' + r[0] + '"' + ((c ? c.rol : 'DEV') === r[0] ? ' selected' : '') + '>' + r[1] + '</option>';
            }).join('') + '</select>') +
            PY.campo('Empresa (código)', '<input class="sx2-input" name="empresa_id" value="' + U.esc(c ? c.empresa_id || '' : '') + '">') + '</div>' +
          '<div class="sx2-campo"><span class="sx2-campo__et">Módulos que ve</span><div class="sx2-chips">' + MODULOS.map(function (m) {
            return U.chip({ texto: m[1], activo: mods.indexOf(m[0]) !== -1, clase: 'js-ad2c-mod', datos: { mod: m[0] } });
          }).join('') + '</div><small class="sx2-tenue">Novedades lo ven todos. ' + (nueva ? 'Si no eliges ninguno, se usan los del rol.' : '') + '</small></div>' +
          '<p class="sx2-campo__error js-ad2c-error" hidden></p>' +
        '</form>');
      d.el.querySelector('.sx2-drawer__pie').innerHTML = U.boton({ texto: 'Cancelar', clase: 'js-sx2-drawer-cerrar' }) +
        U.boton({ texto: nueva ? 'Crear cuenta' : 'Guardar cambios', icono: 'check', variante: 'primario', clase: 'js-ad2c-guardar' });
    }
    function error(m) { var e = d.el.querySelector('.js-ad2c-error'); e.textContent = m; e.hidden = false; }
    function trasCambio(r, aviso) {
      if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo aplicar.', 'error'); return false; }
      if (r.data && (r.data.password_temporal || r.data.password)) mostrarClave({ usuario: r.data.usuario, password_temporal: r.data.password_temporal || r.data.password });
      else if (aviso) PY.aviso(aviso, 'exito');
      cargarCuentas(true);
      return true;
    }
    function pedir(titulo, etiqueta, tipo, validar, enviar) {
      var sub = U.drawer({ titulo: titulo, cuerpo: '<form class="sx2-form js-ad2c-sub" novalidate>' + PY.campo(etiqueta, '<input class="sx2-input" name="v" type="' + tipo + '" autocomplete="off">') +
        '<p class="sx2-campo__error js-ad2c-suberr" hidden></p></form>', pie: U.boton({ texto: 'Cancelar', clase: 'js-sx2-drawer-cerrar' }) + U.boton({ texto: 'Aplicar', icono: 'check', variante: 'primario', clase: 'js-ad2c-subok' }) });
      var ok = function (ev) {
        if (ev) ev.preventDefault();
        var v = sub.el.querySelector('[name=v]').value.trim(), m = validar(v);
        if (m) { var e = sub.el.querySelector('.js-ad2c-suberr'); e.textContent = m; e.hidden = false; return; }
        sub.cerrar(true);
        enviar(v);
      };
      sub.el.querySelector('form').addEventListener('submit', ok);
      sub.el.querySelector('.js-ad2c-subok').addEventListener('click', ok);
    }
    d.el.addEventListener('click', function (ev) {
      var t = ev.target, b;
      if ((b = t.closest('.js-ad2c-mod'))) {
        var m = b.getAttribute('data-mod'), k = mods.indexOf(m);
        if (k === -1) mods.push(m); else mods.splice(k, 1);
        b.setAttribute('aria-pressed', k === -1 ? 'true' : 'false');
        return;
      }
      if (t.closest('.js-ad2c-guardar')) {
        var form = d.el.querySelector('.js-ad2c-form'), x = {};
        new FormData(form).forEach(function (v, k2) { x[k2] = String(v).trim(); });
        if (!x.nombre) return error('Indica el nombre.');
        if (!x.emails) return error('Indica al menos un correo.');
        var datos = { operacion: nueva ? 'crear' : 'actualizar', nombre: x.nombre, cargo: x.cargo, emails: x.emails, rol: x.rol, empresa_id: x.empresa_id };
        if (nueva) datos.usuario = x.usuario; else datos.cuenta_id = c.cuenta_id;
        if (mods.length) datos.modulos = mods;
        else if (!nueva) return error('Deja al menos un módulo marcado.');
        var bt = t.closest('.js-ad2c-guardar'); bt.disabled = true;
        gestionar(datos).then(function (r) {
          bt.disabled = false;
          if (!r || !r.ok) return error((r && r.message) || 'No se pudo guardar.');
          d.cerrar(true);
          trasCambio(r, nueva ? 'Cuenta creada.' : 'Cambios guardados.');
        });
        return;
      }
      if (!c) return;
      if (t.closest('.js-ad2c-reset')) {
        U.confirmar({ titulo: '¿Generar una clave temporal nueva?', texto: 'La clave actual de ' + (c.nombre || c.usuario) + ' deja de servir. Te mostraremos la nueva para que se la entregues.', boton: 'Generar', peligro: true })
          .then(function (si) { if (si) gestionar({ operacion: 'resetear_password', cuenta_id: c.cuenta_id }).then(function (r) { trasCambio(r); }); });
        return;
      }
      if (t.closest('.js-ad2c-asignar')) {
        pedir('Asignar clave', 'Clave (mínimo 8 caracteres)', 'text', function (v) { return v.length < 8 ? 'Debe tener al menos 8 caracteres.' : ''; },
          function (v) { gestionar({ operacion: 'asignar_password', cuenta_id: c.cuenta_id, password: v }).then(function (r) { trasCambio(r); }); });
        return;
      }
      if (t.closest('.js-ad2c-renombrar')) {
        pedir('Cambiar usuario', 'Nuevo usuario', 'text', function (v) { return /^[a-z0-9._-]{3,30}$/i.test(v) ? '' : '3 a 30 caracteres: letras, números, punto o guion.'; },
          function (v) { gestionar({ operacion: 'renombrar', cuenta_id: c.cuenta_id, usuario: v }).then(function (r) { if (trasCambio(r, 'Usuario cambiado.')) d.cerrar(true); }); });
        return;
      }
      if (t.closest('.js-ad2c-activar')) {
        U.confirmar({ titulo: c.activo ? '¿Desactivar la cuenta?' : '¿Activar la cuenta?', texto: c.activo ? (c.nombre || c.usuario) + ' no podrá entrar. Su historial se conserva.' : (c.nombre || c.usuario) + ' podrá volver a entrar.', boton: c.activo ? 'Desactivar' : 'Activar', peligro: c.activo })
          .then(function (si) { if (si) gestionar({ operacion: 'activar', cuenta_id: c.cuenta_id, activo: !c.activo }).then(function (r) { if (trasCambio(r, 'Listo.')) d.cerrar(true); }); });
        return;
      }
      if (t.closest('.js-ad2c-eliminar')) {
        U.confirmar({ titulo: '¿Eliminar la cuenta?', texto: 'Se borra la cuenta de ' + (c.nombre || c.usuario) + '. Si solo dejó la empresa, mejor desactívala: así se conserva quién hizo qué.', boton: 'Eliminar', peligro: true })
          .then(function (si) { if (si) gestionar({ operacion: 'eliminar', cuenta_id: c.cuenta_id }).then(function (r) { if (trasCambio(r, 'Cuenta eliminada.')) d.cerrar(true); }); });
      }
    });
    pintarD();
  }

  var buscarT_ = null;
  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('admin-v2');
    if (!raiz || !raiz.contains(ev.target) || !cuentas_) return;
    var t = ev.target, b;
    if (t.closest('.js-ad2-nueva')) { abrirCuenta(null); return; }
    if ((b = t.closest('.js-ad2-estado'))) { fc_.estado = b.getAttribute('data-estado'); pintarCuentas(true); return; }
    if ((b = t.closest('#admin-v2 .sx2-kpi[data-filtro]')) && document.querySelector('#admin-v2 .ad2-cuentas, #admin-v2 .js-ad2-buscar')) { fc_.estado = b.getAttribute('data-filtro'); pintarCuentas(true); return; }
    if ((b = t.closest('[data-ad2-cuenta]'))) abrirCuenta(b.getAttribute('data-ad2-cuenta'));
  });
  document.addEventListener('change', function (ev) {
    if (ev.target.classList && ev.target.classList.contains('js-ad2-rol')) { fc_.rol = ev.target.value; pintarCuentas(true); }
  });
  document.addEventListener('input', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-ad2-buscar')) return;
    var v = ev.target.value;
    clearTimeout(buscarT_);
    buscarT_ = setTimeout(function () {
      fc_.texto = v.trim(); pintarCuentas(true);
      var n = document.querySelector('.js-ad2-buscar'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    }, 220);
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('#admin-v2 [data-ad2-cuenta]')) { ev.preventDefault(); ev.target.click(); }
  });

  function activo() { try { return localStorage.getItem(CLAVE_PREF) !== '0'; } catch (e) { return true; } }
  function usarVersion(v2) {
    try { localStorage.setItem(CLAVE_PREF, v2 ? '1' : '0'); } catch (e) { /* sin storage: no se recuerda */ }
    document.dispatchEvent(new CustomEvent('sigso:v2-version', { detail: { modulo: 'administracion', v2: !!v2 } }));
  }

  window.SigsoAdminV2 = {
    mostrarSalud: function () { cargarSalud(!!datos_ && !!document.getElementById('admin-v2')); },
    // 7B: "Cuentas de la plataforma" v2.
    mostrarCuentas: function () { cargarCuentas(!!cuentas_ && !!document.getElementById('admin-v2')); },
    cargar: function () { if (window.SigsoAdmin) SigsoAdmin.irAItem('SALUD'); },
    refrescar: function () { cargarSalud(true); },
    activo: activo, usarVersion: usarVersion, desmontar: desmontar
  };
  if (window.SigsoAdmin && SigsoAdmin.registrarArbol) SigsoAdmin.registrarArbol();
})();
