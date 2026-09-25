/**
 * admin-vistas-v2.js — Administración 100 % v2 (SIGSO v2, R7 del retiro de
 * la versión clásica; ver documentacion/SIGSO-v2-hoja-de-ruta.md).
 *
 * "Salud de la configuración" y "Cuentas plataforma" viven en admin-v2.js;
 * aquí está el resto, en el mismo contenedor #admin-v2:
 *  - Catálogos (Empresas, Plataformas, Áreas, Módulos, Tipos,
 *    Notificaciones) y Usuarios (legado): lista con búsqueda y estado, alta
 *    y edición en panel lateral, con listas en vez de códigos a mano.
 *  - Jefaturas agrupadas por jefe; Pausas activas (configuración,
 *    coordinadoras, trabajadores, programadas); Alertas en vivo; Canales de
 *    alerta; Enviar alerta; Centro de reportes (motor v2); registro de envíos;
 *    Panel de datos (solo super admin).
 * Mismos endpoints que admin.js. Define window.SigsoAdmin: la plataforma ya
 * no carga admin.js (queda para admin.html/app.html).
 */
(function () {
  'use strict';

  var PY = window.PYv2;
  var U = UIv2;

  // --- Árbol ---------------------------------------------------------------------------
  var ARQUITECTURA = [
    { id: 'salud', nombre: 'Salud', icono: 'escudo', items: [{ id: 'SALUD', nombre: 'Salud de la configuración' }] },
    { id: 'organizacion', nombre: 'Organización', icono: 'empresa', items: [
      { id: 'EMPRESA', nombre: 'Empresas' }, { id: 'PLATAFORMA', nombre: 'Plataformas' },
      { id: 'AREA', nombre: 'Áreas / responsables' }, { id: 'JEFATURAS', nombre: 'Jefaturas' }
    ] },
    { id: 'catalogos', nombre: 'Catálogos', icono: 'lista', items: [
      { id: 'MODULO', nombre: 'Módulos' }, { id: 'TIPO', nombre: 'Tipos de solicitud' }
    ] },
    { id: 'accesos', nombre: 'Accesos', icono: 'llave', items: [
      { id: 'CUENTAS_PORTAL', nombre: 'Cuentas plataforma' }, { id: 'USUARIOS', nombre: 'Usuarios (legado)' }
    ] },
    { id: 'comunicaciones', nombre: 'Comunicaciones', icono: 'campana', items: [
      { id: 'NOTIFICACION', nombre: 'Notificaciones' }, { id: 'NOTIF_PERMISOS', nombre: 'Alertas en vivo' },
      { id: 'CANALES_ALERTA', nombre: 'Canales de alerta' }, { id: 'ENVIAR_ALERTA', nombre: 'Enviar alerta' }
    ] },
    { id: 'operacion', nombre: 'Operación', icono: 'reloj', items: [{ id: 'PAUSAS', nombre: 'Pausas activas' }] },
    { id: 'reportes', nombre: 'Reportes', icono: 'grafico', plano: true, descripcion: 'Entregabilidad, salud del sistema y accesos', items: [
      { id: 'REPORTES', nombre: 'Centro de reportes' }
    ] }
  ];
  // El gate real del panel de datos vive en el servidor; esto solo decide si se pinta.
  var GRUPO_SUPER_ADMIN = { id: 'super_admin', nombre: 'Datos (avanzado)', icono: 'llave', items: [{ id: 'PANEL_SUPER_ADMIN', nombre: 'Panel de datos' }] };
  var OCULTAS = { LOGS: ['Registro de envíos', 'reportes'] };
  function esSuperAdmin() { return !!(window.SIGSO_USUARIO && window.SIGSO_USUARIO.super_admin === true); }
  function arquitectura() { return esSuperAdmin() ? ARQUITECTURA.concat([GRUPO_SUPER_ADMIN]) : ARQUITECTURA; }
  function itemDe(id) {
    var r = null;
    arquitectura().forEach(function (g) { g.items.forEach(function (it) { if (it.id === id) r = { grupo: g.nombre, nombre: it.nombre }; }); });
    if (!r && OCULTAS[id]) r = { grupo: 'Reportes', nombre: OCULTAS[id][0] };
    return r;
  }
  function registrarArbol() {
    if (!window.SigsoNav) return;
    SigsoNav.registrar('administracion', { nombre: 'Administración', submodulos: arquitectura() });
    if (window.SigsoShell && SigsoShell.refrescarArbol) SigsoShell.refrescarArbol();
  }

  // --- Utilidades ------------------------------------------------------------------------
  var vista_ = '', turno_ = 0;
  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {}).catch(function (e) {
      return { ok: false, message: (e && e.message) || 'No se pudo conectar.' };
    });
  }
  function activo(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1'; }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function coincide(texto, q) {
    var ws = norm(q).split(/\s+/).filter(Boolean), h = norm(texto);
    return ws.every(function (w) { return h.indexOf(w) !== -1; });
  }
  function fecha(v) { return v ? PY.fecha(v, true) : '—'; }
  function codigo(v) { return '<code class="av2-cod">' + U.esc(v || '—') + '</code>'; }
  function estado(v, si, no) { return activo(v) ? U.badge(si || 'Activo', 'ok') : U.badge(no || 'Inactivo', 'neutro'); }
  function persona(email, nombre) {
    if (!email && !nombre) return '<span class="sx2-tenue">—</span>';
    var p = PY.persona(email || nombre, nombre);
    return '<span class="sx2-flex" style="gap:8px;align-items:center;min-width:0">' + U.avatar(p, 'xs') +
      '<span class="sx2-apilado" style="gap:1px;min-width:0"><span class="sx2-cortar">' + U.esc(p.nombre) + '</span>' +
      (email && p.nombre !== email ? '<small class="sx2-tenue sx2-cortar">' + U.esc(email) + '</small>' : '') + '</span></span>';
  }
  function resolverCorreos(correos, t, repintar) {
    correos = correos.filter(Boolean);
    if (!correos.length) return;
    Promise.all([window.SigsoDirectorio ? SigsoDirectorio.resolver(correos) : Promise.resolve(), U.precargarFotos(correos)])
      .then(function () { if (t === turno_) repintar(); });
  }

  function contenedor() {
    var s = document.getElementById('modulo-administracion');
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
  function cabecera(titulo, sub, acciones) {
    var it = itemDe(vista_) || { grupo: '' };
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Administración' + (it.grupo ? ' · ' + U.esc(it.grupo) : '') + '</span>' +
      '<h1>' + U.esc(titulo) + '</h1>' + (sub ? '<span class="sx2-tenue" style="font-size:.875rem">' + sub + '</span>' : '') + '</div>' +
      '<div class="sx2-cabecera__acciones">' + (acciones || '') + U.boton({ soloIcono: true, icono: 'tendencia', titulo: 'Actualizar', clase: 'js-av2-recargar' }) + '</div></header>';
  }
  function pagina(html, silencioso) {
    var c = contenedor();
    if (!c) return null;
    var y = window.scrollY;
    var foco = document.activeElement && document.activeElement.classList.contains('js-av2-q');
    c.innerHTML = '<div class="sx2-pagina">' + html + '</div>';
    if (silencioso) {
      c.querySelectorAll('.sx2-entra').forEach(function (el) { el.style.animation = 'none'; });
      window.scrollTo(0, y);
    }
    if (foco) { var q = c.querySelector('.js-av2-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    U.animar(c);
    return c;
  }
  function cargando(titulo, sub, tipo) { pagina(cabecera(titulo, sub) + U.esqueleto(tipo || 'tabla', 6)); }
  function error(titulo, r) {
    pagina(cabecera(titulo) + U.card({ i: 1, cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: (r && r.message) || 'Inténtalo de nuevo.',
      accion: U.boton({ texto: 'Reintentar', icono: 'tendencia', clase: 'js-av2-recargar' }) }) }));
  }
  function buscador(valor, placeholder) {
    return '<label class="sx2-buscar">' + U.ico('lupa', 16) + '<input class="sx2-input js-av2-q" type="search" placeholder="' + U.esc(placeholder || 'Buscar…') + '" value="' + U.esc(valor || '') + '"></label>';
  }
  function chipsEstado(lista, actual) {
    var act = lista.filter(function (r) { return activo(r.activo); }).length;
    return U.chip({ texto: 'Activos', n: act, activo: actual === 'activos', clase: 'js-av2-est', datos: { est: 'activos' } }) +
      U.chip({ texto: 'Inactivos', n: lista.length - act, activo: actual === 'inactivos', clase: 'js-av2-est', datos: { est: 'inactivos' } }) +
      U.chip({ texto: 'Todos', n: lista.length, activo: actual === 'todos', clase: 'js-av2-est', datos: { est: 'todos' } });
  }
  function porEstado(lista, est) {
    if (est === 'activos') return lista.filter(function (r) { return activo(r.activo); });
    if (est === 'inactivos') return lista.filter(function (r) { return !activo(r.activo); });
    return lista;
  }
  function checkbox(nombre, texto, marcado) {
    return '<label class="nv2-check"><input type="checkbox" name="' + nombre + '" value="1"' + (marcado ? ' checked' : '') + '> ' + U.esc(texto) + '</label>';
  }
  function select(nombre, opciones, valor, vacio) {
    return '<select class="sx2-select" name="' + nombre + '">' + (vacio !== undefined ? '<option value="">' + U.esc(vacio) + '</option>' : '') +
      opciones.map(function (o) { return '<option value="' + U.esc(o.v) + '"' + (String(o.v) === String(valor || '') ? ' selected' : '') + '>' + U.esc(o.t) + '</option>'; }).join('') + '</select>';
  }
  function input(nombre, valor, extra) { return '<input class="sx2-input" name="' + nombre + '" value="' + U.esc(valor === undefined || valor === null ? '' : valor) + '"' + (extra || '') + '>'; }

  // --- Datos compartidos --------------------------------------------------------------------
  var cache_ = {};
  function catalogo(tipo, forzar) {
    if (cache_[tipo] && !forzar) return Promise.resolve(cache_[tipo]);
    return api('listarCatalogo', { tipo: tipo }).then(function (r) {
      if (!r || !r.ok) return Promise.reject(r || { message: 'No se pudo cargar.' });
      cache_[tipo] = Array.isArray(r.data) ? r.data : [];
      return cache_[tipo];
    });
  }
  function opcionesDe(tipo, id) {
    return (cache_[tipo] || []).filter(function (x) { return activo(x.activo); })
      .map(function (x) { return { v: x[id], t: x.nombre ? x.nombre + ' (' + x[id] + ')' : x[id] }; })
      .sort(function (a, b) { return a.t.localeCompare(b.t, 'es'); });
  }
  function nombreDe(tipo, id, valor) {
    var x = (cache_[tipo] || []).filter(function (r) { return String(r[id]) === String(valor); })[0];
    return x ? (x.nombre || valor) : (valor || '');
  }
  var ROLES_LEGADO = [{ v: 'ANA', t: 'Gestor/Analista' }, { v: 'DEV', t: 'Gestor técnico' }, { v: 'GERENCIA', t: 'Gerencia' }, { v: 'ADM', t: 'Administrador' }];
  var ROLES_PORTAL = [{ v: 'SOLICITANTE', t: 'Solicitante' }, { v: 'ANA', t: 'Gestor/Analista' }, { v: 'DEV', t: 'Desarrollador' }, { v: 'GERENCIA', t: 'Gerencia' }, { v: 'JEFATURA', t: 'Jefatura' }, { v: 'ADM', t: 'Administrador' }];
  function rolTxt(r, lista) { var x = (lista || ROLES_PORTAL).filter(function (k) { return k.v === r; })[0]; return x ? x.t : (r || '—'); }

  // =========================================================================================
  // Catálogos + Usuarios (legado)
  // =========================================================================================
  var CAT = {
    EMPRESA: {
      id: 'empresa_id', titulo: 'Empresas', nuevo: 'Nueva empresa', deps: [],
      sub: 'Las empresas del grupo. Cada solicitud, persona y pausa pertenece a una.',
      buscar: function (r) { return [r.empresa_id, r.nombre].join(' '); },
      cols: [
        ['Código', function (r) { return codigo(r.empresa_id); }],
        ['Empresa', function (r) { return '<span class="sx2-flex" style="gap:8px;align-items:center">' + (r.logo ? '<img class="av2-logo" src="' + U.esc(r.logo) + '" alt="">' : '<span class="av2-logo av2-logo--ini">' + U.esc(String(r.nombre || r.empresa_id || '?').charAt(0)) + '</span>') + '<strong>' + U.esc(r.nombre || '') + '</strong></span>'; }],
        ['Plataformas', function (r) { var n = (cache_.PLATAFORMA || []).filter(function (p) { return p.empresa_id === r.empresa_id && activo(p.activo); }).length; return '<span class="sx2-num">' + n + '</span>'; }, true],
        ['Estado', function (r) { return estado(r.activo, 'Activa', 'Inactiva'); }]
      ],
      campos: function (r) {
        return U.campo('Nombre', input('nombre', r.nombre, ' required maxlength="80"')) +
          U.campo('Logo (URL de la imagen)', input('logo', r.logo, ' type="url" placeholder="https://…"'), 'Opcional. Se muestra en documentos y en la lista.') +
          checkbox('activo', 'Activa', r.empresa_id ? activo(r.activo) : true);
      },
      extraDeps: ['PLATAFORMA'],
      ayudaCodigo: 'Corto y sin espacios (HP, RLD…). No se puede cambiar después.'
    },
    PLATAFORMA: {
      id: 'plataforma_id', titulo: 'Plataformas', nuevo: 'Nueva plataforma', deps: ['EMPRESA'],
      sub: 'Los sistemas sobre los que se piden cambios. Cada una pertenece a una empresa.',
      buscar: function (r) { return [r.plataforma_id, r.nombre, r.empresa_id, nombreDe('EMPRESA', 'empresa_id', r.empresa_id)].join(' '); },
      cols: [
        ['Código', function (r) { return codigo(r.plataforma_id); }],
        ['Plataforma', function (r) { return '<strong>' + U.esc(r.nombre || '') + '</strong>'; }],
        ['Empresa', function (r) { return U.esc(nombreDe('EMPRESA', 'empresa_id', r.empresa_id) || '—'); }],
        ['Módulos', function (r) { var n = (cache_.MODULO || []).filter(function (m) { return m.plataforma_id === r.plataforma_id && activo(m.activo); }).length; return '<span class="sx2-num">' + n + '</span>'; }, true],
        ['URL base', function (r) { return r.url_base ? '<a class="sx2-enlace" href="' + U.esc(r.url_base) + '" target="_blank" rel="noopener">' + U.esc(String(r.url_base).replace(/^https?:\/\//, '')) + '</a>' : '<span class="sx2-tenue">—</span>'; }],
        ['Estado', function (r) { return estado(r.activo, 'Activa', 'Inactiva'); }]
      ],
      campos: function (r) {
        return U.campo('Nombre', input('nombre', r.nombre, ' required maxlength="80"')) +
          U.campo('Empresa', select('empresa_id', opcionesDe('EMPRESA', 'empresa_id'), r.empresa_id, 'Elige la empresa')) +
          U.campo('URL base', input('url_base', r.url_base, ' type="url" placeholder="https://…"'), 'Opcional.') +
          checkbox('activo', 'Activa', r.plataforma_id ? activo(r.activo) : true);
      },
      validar: function (x) { return x.empresa_id ? '' : 'Elige la empresa.'; },
      extraDeps: ['MODULO'],
      ayudaCodigo: 'Ej.: RLD_GI. No se puede cambiar después.'
    },
    AREA: {
      id: 'area_id', titulo: 'Áreas / responsables', nuevo: 'Nueva área', deps: [],
      sub: 'Las áreas que el solicitante elige en el formulario, y quién recibe sus solicitudes.',
      buscar: function (r) { return [r.area_id, r.nombre, r.responsable_email, PY.persona(r.responsable_email).nombre].join(' '); },
      correos: function (l) { return l.map(function (r) { return r.responsable_email; }); },
      cols: [
        ['Código', function (r) { return codigo(r.area_id); }],
        ['Área (lo ve el solicitante)', function (r) { return '<strong>' + U.esc(r.nombre || '') + '</strong>'; }],
        ['Responsable', function (r) { return persona(r.responsable_email); }],
        ['Estado', function (r) { return estado(r.activo, 'Activa', 'Inactiva'); }]
      ],
      campos: function (r) {
        return U.campo('Nombre del área', input('nombre', r.nombre, ' required maxlength="80"'), 'Es lo que ve el solicitante al elegir a quién va su solicitud.') +
          U.campo('Correo del responsable', input('responsable_email', r.responsable_email, ' type="email" list="av2-correos" required'), 'Recibe las solicitudes de esta área.') +
          checkbox('activo', 'Activa', r.area_id ? activo(r.activo) : true);
      },
      validar: function (x) { return /^[^\s@]+@[^\s@]+$/.test(x.responsable_email || '') ? '' : 'Indica un correo válido para el responsable.'; },
      conCorreos: true,
      ayudaCodigo: 'Ej.: AREA_018. No se puede cambiar después.'
    },
    MODULO: {
      id: 'modulo_id', titulo: 'Módulos', nuevo: 'Nuevo módulo', deps: ['PLATAFORMA'],
      sub: 'Las partes de cada plataforma, con su jerarquía. El solicitante elige aquí dónde está el problema.',
      buscar: function (r) { return [r.modulo_id, r.nombre, nombreDe('MODULO', 'modulo_id', r.modulo_padre_id)].join(' '); },
      filtroPlataforma: true,
      cols: [
        ['Código', function (r) { return codigo(r.modulo_id); }],
        ['Módulo', function (r) { return '<span class="av2-mod">' + (r.modulo_padre_id ? '<span class="av2-hijo">' + U.ico('derecha', 12) + '</span>' : '') + '<strong>' + U.esc(r.nombre || '') + '</strong></span>'; }],
        ['Depende de', function (r) { return r.modulo_padre_id ? U.esc(nombreDe('MODULO', 'modulo_id', r.modulo_padre_id)) : '<span class="sx2-tenue">— (principal)</span>'; }],
        ['Plataforma', function (r) { return U.esc(nombreDe('PLATAFORMA', 'plataforma_id', r.plataforma_id) || '—'); }],
        ['Estado', function (r) { return estado(r.activo); }]
      ],
      campos: function (r) {
        var plat = r.plataforma_id || cat_.plataforma || '';
        return U.campo('Nombre', input('nombre', r.nombre, ' required maxlength="80"')) +
          U.campo('Plataforma', select('plataforma_id', opcionesDe('PLATAFORMA', 'plataforma_id'), plat, 'Elige la plataforma')) +
          U.campo('Depende de (opcional)', '<select class="sx2-select" name="modulo_padre_id">' + opcionesPadre(plat, r.modulo_padre_id, r.modulo_id) + '</select>', 'Déjalo en "principal" si es un módulo de primer nivel.') +
          checkbox('activo', 'Activo', r.modulo_id ? activo(r.activo) : true);
      },
      alMontar: function (form, r) {
        var sp = form.querySelector('[name=plataforma_id]'), sm = form.querySelector('[name=modulo_padre_id]');
        sp.addEventListener('change', function () { sm.innerHTML = opcionesPadre(sp.value, '', r.modulo_id); });
      },
      validar: function (x) { return x.plataforma_id ? '' : 'Elige la plataforma.'; },
      ayudaCodigo: 'Ej.: RLD_GI_INGRESO. No se puede cambiar después.'
    },
    TIPO: {
      id: 'tipo_id', titulo: 'Tipos de solicitud', nuevo: 'Nuevo tipo', deps: [],
      sub: 'Qué clase de pedido es (error, mejora…). "Urgente por naturaleza" sube la prioridad real.',
      buscar: function (r) { return [r.tipo_id, r.nombre].join(' '); },
      cols: [
        ['Código', function (r) { return codigo(r.tipo_id); }],
        ['Tipo', function (r) { return '<strong>' + U.esc(r.nombre || '') + '</strong>'; }],
        ['Prioridad sugerida', function (r) { return r.prioridad_default ? U.badge(r.prioridad_default, r.prioridad_default === 'P1' ? 'critico' : (r.prioridad_default === 'P2' ? 'alerta' : 'info'), true) : '<span class="sx2-tenue">—</span>'; }],
        ['Urgente por naturaleza', function (r) { return activo(r.es_urgente) ? U.badge('Sí', 'critico') : '<span class="sx2-tenue">No</span>'; }],
        ['Estado', function (r) { return estado(r.activo); }]
      ],
      campos: function (r) {
        return U.campo('Nombre', input('nombre', r.nombre, ' required maxlength="80"')) +
          U.campo('Prioridad sugerida', select('prioridad_default', [{ v: 'P1', t: 'P1 — crítica' }, { v: 'P2', t: 'P2 — alta' }, { v: 'P3', t: 'P3 — media' }, { v: 'P4', t: 'P4 — baja' }], r.prioridad_default, 'Sin sugerencia'), 'Informativa: la prioridad real la define quien atiende.') +
          checkbox('es_urgente', 'Urgente por naturaleza (afecta la prioridad real)', activo(r.es_urgente)) +
          checkbox('activo', 'Activo', r.tipo_id ? activo(r.activo) : true);
      },
      ayudaCodigo: 'Corto: ERR, MEJ… No se puede cambiar después.'
    },
    NOTIFICACION: {
      id: 'notif_id', titulo: 'Notificaciones', nuevo: 'Nueva regla', deps: [],
      sub: 'Interruptores y destinatarios extra de los avisos automáticos. Los canales de correo se manejan en "Canales de alerta".',
      buscar: function (r) { return [r.notif_id, r.evento, r.rol_destinatario, r.emails_extra].join(' '); },
      cols: [
        ['Código', function (r) { return codigo(r.notif_id); }],
        ['Evento', function (r) { return U.esc(r.evento || '') + (String(r.notif_id).indexOf('CANAL_CORREO_') === 0 ? '<br><small class="sx2-tenue">Se cambia en Canales de alerta</small>' : ''); }],
        ['Rol destinatario', function (r) { return r.rol_destinatario ? U.esc(rolTxt(r.rol_destinatario)) : '<span class="sx2-tenue">—</span>'; }],
        ['Correos extra', function (r) { return r.emails_extra ? U.esc(r.emails_extra) : '<span class="sx2-tenue">—</span>'; }],
        ['Estado', function (r) { return estado(r.activo, 'Encendida', 'Apagada'); }]
      ],
      campos: function (r) {
        return U.campo('Evento', input('evento', r.evento, ' required maxlength="120"'), 'Ej.: AVISO_DESARROLLO.') +
          U.campo('Rol destinatario (opcional)', select('rol_destinatario', ROLES_PORTAL, r.rol_destinatario, 'Ninguno')) +
          U.campo('Correos extra (opcional)', input('emails_extra', r.emails_extra), 'Separados por coma.') +
          checkbox('activo', 'Encendida', r.notif_id ? activo(r.activo) : true);
      },
      soloLectura: function (r) { return String(r.notif_id).indexOf('CANAL_CORREO_') === 0 ? 'CANALES_ALERTA' : ''; },
      ayudaCodigo: 'Ej.: AVISO_LEO. No se puede cambiar después.'
    },
    USUARIOS: {
      id: 'email', titulo: 'Usuarios (legado)', nuevo: 'Nuevo usuario', deps: ['EMPRESA'], legado: true,
      sub: 'Identidad del acceso antiguo con Google. Para dar de alta a alguien, usa "Cuentas plataforma".',
      buscar: function (r) { return [r.nombre, r.email, r.empresa_id, r.rol].join(' '); },
      correos: function (l) { return l.map(function (r) { return r.email; }); },
      cols: [
        ['Persona', function (r) { return persona(r.email, r.nombre); }],
        ['Empresa', function (r) { return U.esc(nombreDe('EMPRESA', 'empresa_id', r.empresa_id) || '—'); }],
        ['Rol', function (r) { return U.badge(rolTxt(r.rol, ROLES_LEGADO), r.rol === 'ADM' ? 'critico' : 'neutro', true); }],
        ['Último acceso', function (r) { return r.ultimo_acceso ? U.esc(fecha(r.ultimo_acceso)) : '<span class="sx2-tenue">Nunca</span>'; }],
        ['Estado', function (r) { return estado(r.activo); }]
      ],
      campos: function (r) {
        return U.campo('Nombre', input('nombre', r.nombre, ' required maxlength="80"')) +
          U.campo('Empresa', select('empresa_id', opcionesDe('EMPRESA', 'empresa_id'), r.empresa_id, 'Elige la empresa')) +
          U.campo('Rol', select('rol', ROLES_LEGADO, r.rol || 'ANA')) +
          checkbox('activo', 'Activo', r.email ? activo(r.activo) : true);
      },
      ayudaCodigo: 'El correo de Google con que entra. No se puede cambiar después.',
      guardar: function (reg) { return api('gestionarUsuario', reg); },
      listar: function () { return api('listarUsuarios', {}); }
    }
  };
  var cat_ = { tipo: '', filas: null, q: '', est: 'activos', plataforma: '' };
  var LIMITE = 300;

  function opcionesPadre(plat, valor, propio) {
    var l = (cache_.MODULO || []).filter(function (m) { return m.plataforma_id === plat && !m.modulo_padre_id && m.modulo_id !== propio; })
      .sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre), 'es'); });
    return '<option value="">— Principal (sin padre)</option>' + l.map(function (m) {
      return '<option value="' + U.esc(m.modulo_id) + '"' + (m.modulo_id === valor ? ' selected' : '') + '>' + U.esc(m.nombre) + (activo(m.activo) ? '' : ' (inactivo)') + '</option>';
    }).join('');
  }

  function cargarCatalogo(tipo, silencioso) {
    var def = CAT[tipo];
    if (cat_.tipo !== tipo) cat_ = { tipo: tipo, filas: null, q: '', est: 'activos', plataforma: '' };
    var t = ++turno_;
    if (!silencioso || !cat_.filas) cargando(def.titulo, U.esc(def.sub));
    var deps = def.deps.concat(def.extraDeps || []);
    var pedidos = deps.map(function (d) { return catalogo(d, !!silencioso).catch(function () { return []; }); });
    pedidos.unshift(def.listar ? def.listar() : catalogo(tipo, true).then(function (l) { return { ok: true, data: l }; }, function (r) { return r; }));
    if (def.conCorreos) pedidos.push(correosConocidos());
    Promise.all(pedidos).then(function (rs) {
      if (t !== turno_ || vista_ !== tipo) return;
      var r = rs[0];
      if (!r || !r.ok) { error(def.titulo, r); return; }
      cat_.filas = Array.isArray(r.data) ? r.data : [];
      if (tipo === 'MODULO' && !cat_.plataforma) {
        var conteo = {};
        cat_.filas.forEach(function (m) { conteo[m.plataforma_id] = (conteo[m.plataforma_id] || 0) + 1; });
        cat_.plataforma = Object.keys(conteo).sort(function (a, b) { return conteo[b] - conteo[a]; })[0] || '';
      }
      pintarCatalogo(!!silencioso);
      if (def.correos) resolverCorreos(def.correos(cat_.filas), t, function () { pintarCatalogo(true); });
    });
  }
  function pintarCatalogo(silencioso) {
    var def = CAT[cat_.tipo];
    if (!def || vista_ !== cat_.tipo || !cat_.filas) return;
    var base = cat_.filas;
    if (def.filtroPlataforma && cat_.plataforma) base = base.filter(function (r) { return r.plataforma_id === cat_.plataforma; });
    var lista = porEstado(base, cat_.est).filter(function (r) { return !cat_.q || coincide(def.buscar(r), cat_.q); });
    if (def.filtroPlataforma) {
      // Hijo debajo de su padre.
      var hijos = {};
      lista.forEach(function (m) { if (m.modulo_padre_id) (hijos[m.modulo_padre_id] = hijos[m.modulo_padre_id] || []).push(m); });
      var ids = {};
      lista.forEach(function (m) { ids[m.modulo_id] = true; });
      var orden = [];
      lista.filter(function (m) { return !m.modulo_padre_id || !ids[m.modulo_padre_id]; })
        .sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre), 'es'); })
        .forEach(function (m) { orden.push(m); (hijos[m.modulo_id] || []).sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre), 'es'); }).forEach(function (h) { orden.push(h); }); });
      lista = orden;
    } else {
      lista = lista.slice().sort(function (a, b) { return String(a.nombre || a[def.id]).localeCompare(String(b.nombre || b[def.id]), 'es'); });
    }
    var visibles = lista.slice(0, LIMITE);
    var filtroPlat = def.filtroPlataforma
      ? '<select class="sx2-select js-av2-plat" aria-label="Plataforma"><option value="">Todas las plataformas</option>' + opcionesDe('PLATAFORMA', 'plataforma_id').map(function (o) {
          var n = cat_.filas.filter(function (m) { return m.plataforma_id === o.v; }).length;
          return '<option value="' + U.esc(o.v) + '"' + (o.v === cat_.plataforma ? ' selected' : '') + '>' + U.esc(o.t) + ' · ' + n + '</option>';
        }).join('') + '</select>' : '';
    var aviso = def.legado ? '<div class="av2-aviso sx2-tono-info sx2-entra">' + U.ico('info', 16) + '<span>Esta lista es del <b>acceso antiguo con Google</b> (app.html). Deja de usarse cuando ese acceso se apague; las personas nuevas se crean en ' +
      '<button type="button" class="sx2-enlace js-av2-ir" data-ir="CUENTAS_PORTAL">Cuentas plataforma' + U.ico('derecha', 12) + '</button>.</span></div>' : '';
    pagina(cabecera(def.titulo, U.esc(def.sub), U.boton({ texto: def.nuevo, icono: 'nueva', variante: 'primario', clase: 'js-av2-nuevo' })) + aviso +
      '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:1"><div class="sx2-barra-filtros">' + buscador(cat_.q, 'Buscar por código o nombre…') + filtroPlat + chipsEstado(base, cat_.est) + '</div></div>' +
      U.card({ sinRelleno: true, i: 2, cuerpo: visibles.length
        ? '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr>' + def.cols.map(function (c) { return '<th' + (c[2] ? ' class="sx2-num"' : '') + '>' + U.esc(c[0]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          visibles.map(function (r) {
            return '<tr class="sx2-fila--clic js-av2-fila' + (activo(r.activo) ? '' : ' av2-fila--off') + '" data-id="' + U.esc(r[def.id]) + '" tabindex="0">' +
              def.cols.map(function (c) { return '<td' + (c[2] ? ' class="sx2-num"' : '') + '>' + c[1](r) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table></div>' +
          (lista.length > LIMITE ? '<p class="av2-mas">Mostrando ' + LIMITE + ' de ' + lista.length + '. Busca o filtra para ver el resto.</p>' : '')
        : U.vacio({ icono: 'lupa', titulo: base.length ? 'Nada con este filtro' : 'Todavía no hay registros', texto: base.length ? 'Cambia la búsqueda o el estado.' : 'Crea el primero con "' + def.nuevo + '".' }) }), silencioso);
  }
  var correos_ = null;
  function correosConocidos() {
    if (correos_) return Promise.resolve(correos_);
    return api('listarCuentasPortal', {}).then(function (r) {
      var l = [];
      if (r && r.ok) (r.data.cuentas || []).forEach(function (c) { (c.emails || []).forEach(function (e) { l.push({ email: e, nombre: c.nombre || c.usuario }); }); });
      correos_ = l.sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre), 'es'); });
      return correos_;
    });
  }
  function datalistCorreos() {
    return '<datalist id="av2-correos">' + (correos_ || []).map(function (p) { return '<option value="' + U.esc(p.email) + '">' + U.esc(p.nombre) + '</option>'; }).join('') + '</datalist>';
  }
  function abrirRegistro(id) {
    var def = CAT[cat_.tipo];
    var r = id ? (cat_.filas || []).filter(function (x) { return String(x[def.id]) === String(id); })[0] : null;
    if (id && !r) return;
    var ir = r && def.soloLectura ? def.soloLectura(r) : '';
    if (ir) {
      U.confirmar({ titulo: 'Se cambia en otra pantalla', texto: 'Esta regla es un canal de correo: se enciende o apaga en "Canales de alerta", donde se explica qué deja de llegar.', boton: 'Ir a Canales de alerta' })
        .then(function (si) { if (si) irA(ir); });
      return;
    }
    var nuevo = !r;
    r = r || {};
    U.formulario({
      titulo: nuevo ? def.nuevo : (r.nombre || r[def.id]),
      subtitulo: nuevo ? '' : '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(def.titulo) + ' · ' + U.esc(r[def.id]) + '</span>',
      boton: nuevo ? 'Crear' : 'Guardar cambios',
      campos: U.campo(def.id === 'email' ? 'Correo' : 'Código', input(def.id, r[def.id], nuevo ? ' required maxlength="80"' + (def.id === 'email' ? ' type="email"' : '') : ' readonly'), def.ayudaCodigo) +
        def.campos(r) + (def.conCorreos ? datalistCorreos() : ''),
      alMontar: function (form) { if (def.alMontar) def.alMontar(form, r); },
      preparar: function (x, form) {
        var reg = {};
        Object.keys(x).forEach(function (k) { reg[k] = x[k]; });
        form.querySelectorAll('input[type=checkbox][name]').forEach(function (cb) { reg[cb.name] = cb.checked; });
        if (!reg[def.id]) return 'Indica el ' + (def.id === 'email' ? 'correo' : 'código') + '.';
        if (nuevo && def.id !== 'email' && /\s/.test(reg[def.id])) return 'El código no puede tener espacios.';
        if (nuevo && (cat_.filas || []).some(function (f) { return String(f[def.id]).toLowerCase() === String(reg[def.id]).toLowerCase(); })) return 'Ya existe un registro con ese ' + (def.id === 'email' ? 'correo' : 'código') + '.';
        if ('nombre' in reg && !reg.nombre) return 'Indica el nombre.';
        var m = def.validar ? def.validar(reg) : '';
        return m || reg;
      },
      enviar: function (reg) { return def.guardar ? def.guardar(reg) : api('guardarCatalogo', { tipo: cat_.tipo, registro: reg }); },
      aviso: nuevo ? 'Creado.' : 'Cambios guardados.',
      listo: function () { cache_[cat_.tipo] = null; cargarCatalogo(cat_.tipo, true); }
    });
  }

  // =========================================================================================
  // Jefaturas
  // =========================================================================================
  var jef_ = null, jefQ_ = '';
  function cargarJefaturas(silencioso) {
    var t = ++turno_;
    if (!silencioso || !jef_) cargando('Jefaturas', '', 'tarjetas');
    Promise.all([api('listarJefaturas', {}), correosConocidos()]).then(function (rs) {
      if (t !== turno_ || vista_ !== 'JEFATURAS') return;
      if (!rs[0] || !rs[0].ok) { error('Jefaturas', rs[0]); return; }
      jef_ = rs[0].data || [];
      pintarJefaturas(!!silencioso);
      var correos = [];
      jef_.forEach(function (j) { correos.push(j.jefe_email, j.subordinado_email); });
      resolverCorreos(correos, t, function () { pintarJefaturas(true); });
    });
  }
  function pintarJefaturas(silencioso) {
    if (vista_ !== 'JEFATURAS' || !jef_) return;
    var grupos = {}, jefes = [];
    jef_.forEach(function (j) {
      if (jefQ_ && !coincide([j.jefe_email, j.subordinado_email, PY.persona(j.jefe_email).nombre, PY.persona(j.subordinado_email).nombre].join(' '), jefQ_)) return;
      if (!grupos[j.jefe_email]) { grupos[j.jefe_email] = []; jefes.push(j.jefe_email); }
      grupos[j.jefe_email].push(j);
    });
    jefes.sort(function (a, b) { return PY.persona(a).nombre.localeCompare(PY.persona(b).nombre, 'es'); });
    var activas = jef_.filter(function (j) { return activo(j.activo); }).length;
    var subs = {};
    jef_.forEach(function (j) { if (activo(j.activo)) subs[j.subordinado_email] = (subs[j.subordinado_email] || 0) + 1; });
    var varios = Object.keys(subs).filter(function (k) { return subs[k] > 1; }).length;
    var cuerpo = jefes.length ? '<div class="av2-jefes">' + jefes.map(function (e, i) {
      var l = grupos[e].sort(function (a, b) { return PY.persona(a.subordinado_email).nombre.localeCompare(PY.persona(b.subordinado_email).nombre, 'es'); });
      var p = PY.persona(e);
      return '<section class="sx2-card av2-jefe sx2-entra" style="--i:' + Math.min(i + 3, 12) + '"><div class="av2-jefe__cab">' + U.avatar(p, 'sm') +
          '<span class="sx2-apilado" style="gap:2px;min-width:0;flex:1"><strong class="sx2-cortar">' + U.esc(p.nombre) + '</strong><small class="sx2-tenue sx2-cortar">' + U.esc(e) + '</small></span>' +
          U.badge(l.filter(function (j) { return activo(j.activo); }).length + ' a cargo', 'primario', true) + '</div>' +
        '<ul class="av2-subs">' + l.map(function (j) {
          var on = activo(j.activo);
          return '<li class="' + (on ? '' : 'av2-fila--off') + '">' + persona(j.subordinado_email) +
            '<span class="av2-subs__acc">' + (on ? '' : U.badge('Inactiva', 'neutro')) +
              U.boton({ texto: on ? 'Desactivar' : 'Activar', sm: true, variante: 'fantasma', clase: 'js-av2-jef-act', datos: { id: j.jefatura_id, activo: on ? '0' : '1' } }) +
              U.boton({ soloIcono: true, icono: 'basura', sm: true, variante: 'fantasma', titulo: 'Eliminar', clase: 'js-av2-jef-del', datos: { id: j.jefatura_id } }) + '</span></li>';
        }).join('') + '</ul></section>';
    }).join('') + '</div>' : U.card({ i: 3, cuerpo: U.vacio({ icono: 'equipo', titulo: jef_.length ? 'Nada con esta búsqueda' : 'Aún no hay jefaturas', texto: jef_.length ? '' : 'Agrega la primera con "Nueva jefatura".' }) });
    pagina(cabecera('Jefaturas', 'Quién supervisa a quién. Cada jefatura ve en "Mi departamento" solo lo de las personas a su cargo; una persona puede tener más de un jefe.',
        U.boton({ texto: 'Nueva jefatura', icono: 'nueva', variante: 'primario', clase: 'js-av2-jef-nueva' })) +
      '<div class="sx2-fila-kpis">' +
        U.kpi({ i: 0, etiqueta: 'Jefaturas', valor: Object.keys(jef_.reduce(function (m, j) { if (activo(j.activo)) m[j.jefe_email] = 1; return m; }, {})).length, icono: 'persona', tono: 'primario' }) +
        U.kpi({ i: 1, etiqueta: 'Relaciones activas', valor: activas, icono: 'equipo', tono: 'ok' }) +
        U.kpi({ i: 2, etiqueta: 'Con más de un jefe', valor: varios, icono: 'capas', tono: varios ? 'info' : 'neutro' }) +
      '</div>' +
      '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:2"><div class="sx2-barra-filtros">' + buscador(jefQ_, 'Buscar jefe o persona…') + '</div></div>' + cuerpo, silencioso);
  }
  function nuevaJefatura() {
    U.formulario({
      titulo: 'Nueva jefatura', boton: 'Agregar',
      campos: U.campo('Correo del jefe', input('jefe_email', '', ' type="email" list="av2-correos" required')) +
        U.campo('Correo de la persona a cargo', input('subordinado_email', '', ' type="email" list="av2-correos" required'), 'Escribe o elige de la lista: salen de las cuentas de la plataforma.') + datalistCorreos(),
      preparar: function (x) {
        var re = /^[^\s@]+@[^\s@]+$/;
        if (!re.test(x.jefe_email || '') || !re.test(x.subordinado_email || '')) return 'Indica los dos correos.';
        if (x.jefe_email.toLowerCase() === x.subordinado_email.toLowerCase()) return 'Una persona no puede ser su propia jefatura.';
        return x;
      },
      enviar: function (x) { return api('gestionarJefatura', { operacion: 'crear', jefe_email: x.jefe_email, subordinado_email: x.subordinado_email }); },
      aviso: 'Jefatura agregada.',
      listo: function () { cargarJefaturas(true); }
    });
  }

  // =========================================================================================
  // Pausas activas
  // =========================================================================================
  var pau_ = { sub: 'config', datos: {}, q: '', est: 'pendientes' };
  var DIAS = [[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [7, 'Dom']];
  var SUBS_PAUSAS = [{ id: 'config', texto: 'Configuración', icono: 'ajustes' }, { id: 'coordinadores', texto: 'Coordinadoras', icono: 'persona' },
    { id: 'roster', texto: 'Trabajadores', icono: 'equipo' }, { id: 'programadas', texto: 'Programadas', icono: 'calendario' }];
  var API_PAUSAS = { config: 'listarPausasConfig', coordinadores: 'listarPausasCoordinadores', roster: 'listarPausasTrabajadores', programadas: 'listarPausasProgramadas' };
  var TONO_PAUSA = { Programada: 'info', Recordatorio_enviado: 'info', En_curso: 'alerta', Realizada: 'ok', Cerrada: 'ok', Suspendida: 'neutro', No_realizada: 'critico', Cancelada: 'neutro' };
  var TERMINALES = ['Cerrada', 'No_realizada', 'Cancelada', 'Realizada'];
  function claveFecha(v) { var m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : String(v || ''); }
  function cargarPausas(silencioso) {
    var t = ++turno_, sub = pau_.sub;
    if (!silencioso || !pau_.datos[sub]) cargando('Pausas activas', '', 'tabla');
    Promise.all([api(API_PAUSAS[sub], {}), catalogo('EMPRESA').catch(function () { return []; })]).then(function (rs) {
      if (t !== turno_ || vista_ !== 'PAUSAS' || sub !== pau_.sub) return;
      if (!rs[0] || !rs[0].ok) { error('Pausas activas', rs[0]); return; }
      pau_.datos[sub] = rs[0].data || [];
      pintarPausas(!!silencioso);
      if (sub === 'coordinadores' || sub === 'roster') resolverCorreos(pau_.datos[sub].map(function (x) { return x.email; }), t, function () { pintarPausas(true); });
    });
  }
  function empresaTxt(id) { return nombreDe('EMPRESA', 'empresa_id', id) || id || '—'; }
  function accionesFila(prefijo, id, on) {
    return '<span class="av2-subs__acc">' + U.boton({ texto: on ? 'Desactivar' : 'Activar', sm: true, variante: 'fantasma', clase: 'js-av2-pau-act', datos: { tipo: prefijo, id: id, activo: on ? '0' : '1' } }) +
      U.boton({ soloIcono: true, icono: 'basura', sm: true, variante: 'fantasma', titulo: 'Eliminar', clase: 'js-av2-pau-del', datos: { tipo: prefijo, id: id } }) + '</span>';
  }
  function pintarPausas(silencioso) {
    if (vista_ !== 'PAUSAS') return;
    var d = pau_.datos[pau_.sub];
    if (!d) return;
    var acciones = '', cuerpo = '';
    if (pau_.sub === 'config') {
      acciones = U.boton({ texto: 'QR de registro', icono: 'rejilla', variante: 'fantasma', clase: 'js-av2-qr' }) + U.boton({ texto: 'Configurar empresa', icono: 'nueva', variante: 'primario', clase: 'js-av2-pau-cfg' });
      cuerpo = d.length ? '<div class="av2-cfgs">' + d.map(function (c, i) {
        var dias = String(c.dias_semana || '').split(',').map(function (x) { return Number(x); });
        return '<section class="sx2-card av2-cfg sx2-entra' + (activo(c.activo) ? '' : ' av2-fila--off') + '" style="--i:' + (i + 3) + '"><div class="av2-jefe__cab">' +
            '<span class="av2-logo av2-logo--ini">' + U.esc(String(empresaTxt(c.empresa_id)).charAt(0)) + '</span><strong style="flex:1">' + U.esc(empresaTxt(c.empresa_id)) + '</strong>' + estado(c.activo, 'Activa', 'Pausada') +
            U.boton({ texto: 'Editar', icono: 'editar', sm: true, variante: 'fantasma', clase: 'js-av2-pau-cfg', datos: { emp: c.empresa_id } }) + '</div>' +
          '<div class="av2-cfg__hora"><span class="av2-cfg__h">' + U.esc(c.hora_habitual || '—') + '</span><span class="sx2-tenue">' + U.esc(String(c.duracion_min || '—')) + ' min · recordatorio ' + U.esc(String(c.min_anticipacion || 0)) + ' min antes</span></div>' +
          '<div class="av2-dias">' + DIAS.map(function (x) { return '<span class="' + (dias.indexOf(x[0]) !== -1 ? 'av2-dia--on' : '') + '">' + x[1] + '</span>'; }).join('') + '</div>' +
          '<p class="sx2-tenue" style="margin:0;font-size:.8125rem">Semáforo de participación: verde desde ' + U.esc(String(c.umbral_verde || '—')) + ' %, amarillo desde ' + U.esc(String(c.umbral_amarillo || '—')) + ' %.</p></section>';
      }).join('') + '</div>' : U.card({ i: 3, cuerpo: U.vacio({ icono: 'reloj', titulo: 'Aún no hay empresas configuradas', texto: 'Empieza con "Configurar empresa".' }) });
    } else if (pau_.sub === 'coordinadores') {
      acciones = U.boton({ texto: 'Nueva coordinadora', icono: 'nueva', variante: 'primario', clase: 'js-av2-pau-coord' });
      cuerpo = U.card({ sinRelleno: true, i: 3, cuerpo: d.length ? '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Persona</th><th>Tipo</th><th>Empresa</th><th>Estado</th><th></th></tr></thead><tbody>' +
        d.slice().sort(function (a, b) { return (a.tipo === 'reemplazo') - (b.tipo === 'reemplazo') || String(a.nombre).localeCompare(String(b.nombre), 'es'); }).map(function (c) {
          return '<tr class="' + (activo(c.activo) ? '' : 'av2-fila--off') + '"><td>' + persona(c.email, c.nombre) + '</td><td>' + U.badge(c.tipo === 'reemplazo' ? 'Reemplazo' : 'Titular', c.tipo === 'reemplazo' ? 'info' : 'primario', true) + '</td>' +
            '<td>' + U.esc(empresaTxt(c.empresa_id)) + '</td><td>' + estado(c.activo) + '</td><td class="sx2-num">' + accionesFila('coord', c.coord_id, activo(c.activo)) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'persona', titulo: 'Aún no hay coordinadoras', texto: 'Las titulares llevan la pausa; los reemplazos cubren cuando ninguna titular puede.' }) }) +
        '<p class="sx2-tenue" style="margin:0;font-size:.8125rem">Las titulares llevan la pausa de su empresa; los reemplazos cubren cuando ninguna titular puede.</p>';
    } else if (pau_.sub === 'roster') {
      acciones = U.boton({ texto: 'Sembrar desde cuentas', icono: 'equipo', variante: 'fantasma', clase: 'js-av2-pau-sembrar' }) +
        U.boton({ texto: 'Dar módulo a todos', icono: 'llave', variante: 'fantasma', clase: 'js-av2-pau-modulo' }) +
        U.boton({ texto: 'Nuevo trabajador', icono: 'nueva', variante: 'primario', clase: 'js-av2-pau-trab' });
      var lr = porEstado(d, pau_.est === 'pendientes' ? 'activos' : pau_.est).filter(function (x) { return !pau_.q || coincide([x.nombre, x.email, x.area, x.cargo].join(' '), pau_.q); })
        .sort(function (a, b) { return String(a.area || '').localeCompare(String(b.area || ''), 'es') || String(a.nombre).localeCompare(String(b.nombre), 'es'); });
      cuerpo = '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:3"><div class="sx2-barra-filtros">' + buscador(pau_.q, 'Buscar por nombre, correo, área o cargo…') + chipsEstado(d, pau_.est === 'pendientes' ? 'activos' : pau_.est) + '</div></div>' +
        U.card({ sinRelleno: true, i: 4, cuerpo: lr.length ? '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Persona</th><th>Área</th><th>Cargo</th><th>Empresa</th><th>Estado</th><th></th></tr></thead><tbody>' +
          lr.map(function (x) {
            return '<tr class="' + (activo(x.activo) ? '' : 'av2-fila--off') + '"><td>' + persona(x.email, x.nombre) + '</td><td>' + U.esc(x.area || '—') + '</td><td>' + U.esc(x.cargo || '—') + '</td>' +
              '<td>' + U.esc(empresaTxt(x.empresa_id)) + '</td><td>' + estado(x.activo) + '</td><td class="sx2-num">' + accionesFila('trab', x.trabajador_id, activo(x.activo)) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'equipo', titulo: d.length ? 'Nada con este filtro' : 'Aún no hay trabajadores en el roster', texto: d.length ? '' : 'Usa "Sembrar desde cuentas" o agrega uno.' }) }) +
        '<p class="sx2-tenue" style="margin:0;font-size:.8125rem">"Sembrar desde cuentas" carga el roster de una empresa con las cuentas que ya existen (no crea cuentas). "Dar módulo a todos" da acceso a "Pausas activas" a cada trabajador del roster que tenga cuenta.</p>';
    } else {
      acciones = U.boton({ texto: 'Programar hoy', icono: 'calendario', variante: 'fantasma', clase: 'js-av2-pau-hoy' }) + U.boton({ texto: 'Pausa manual', icono: 'nueva', variante: 'primario', clase: 'js-av2-pau-manual' });
      var pend = d.filter(function (p) { return TERMINALES.indexOf(p.estado) === -1; });
      var lp = (pau_.est === 'pendientes' ? pend : d).slice().sort(function (a, b) {
        var fa = claveFecha(a.fecha) + ' ' + (a.hora_programada || ''), fb = claveFecha(b.fecha) + ' ' + (b.hora_programada || '');
        return pau_.est === 'pendientes' ? fa.localeCompare(fb) : fb.localeCompare(fa);
      });
      cuerpo = '<div class="dc2-chips sx2-entra">' + U.chip({ texto: 'Pendientes', n: pend.length, activo: pau_.est === 'pendientes', clase: 'js-av2-est', datos: { est: 'pendientes' } }) +
          U.chip({ texto: 'Todas', n: d.length, activo: pau_.est !== 'pendientes', clase: 'js-av2-est', datos: { est: 'todos' } }) + '</div>' +
        U.card({ sinRelleno: true, i: 3, cuerpo: lp.length ? '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Fecha</th><th>Hora</th><th>Empresa</th><th class="sx2-num">Duración</th><th>Estado</th><th></th></tr></thead><tbody>' +
          lp.slice(0, 200).map(function (p) {
            var term = TERMINALES.indexOf(p.estado) !== -1;
            return '<tr><td>' + U.esc(PY.fecha(claveFecha(p.fecha), true)) + '</td><td><strong>' + U.esc(p.hora_programada || '—') + '</strong></td><td>' + U.esc(empresaTxt(p.empresa_id)) + '</td>' +
              '<td class="sx2-num">' + U.esc(String(p.duracion_min || '—')) + ' min</td><td>' + U.badge(String(p.estado || '').replace(/_/g, ' '), TONO_PAUSA[p.estado] || 'neutro') + '</td>' +
              '<td class="sx2-num">' + (term ? '' : '<span class="av2-subs__acc">' + U.boton({ texto: 'Reprogramar', sm: true, variante: 'fantasma', clase: 'js-av2-pau-repro', datos: { id: p.pausa_id, fecha: claveFecha(p.fecha), hora: p.hora_programada || '' } }) +
                U.boton({ texto: 'Cancelar', sm: true, variante: 'texto-peligro', clase: 'js-av2-pau-cancel', datos: { id: p.pausa_id } }) + '</span>') + '</td></tr>';
          }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'calendario', titulo: pau_.est === 'pendientes' ? 'No hay pausas pendientes' : 'Aún no hay pausas programadas', texto: 'El sistema crea la del día cada mañana según la configuración; aquí puedes crear una puntual.' }) });
    }
    pagina(cabecera('Pausas activas', 'Configuración del programa. Es independiente de las solicitudes: cambiar horas, días o coordinadoras no afecta el resto de SIGSO.', acciones) +
      '<div class="av2-subnav sx2-entra" style="--i:1">' + U.segmento(SUBS_PAUSAS, pau_.sub, 'js-av2-pau-sub') + '</div>' + cuerpo, silencioso);
  }
  function opcionesEmpresas() { return opcionesDe('EMPRESA', 'empresa_id'); }
  function formConfigPausas(empresaId) {
    var r = (pau_.datos.config || []).filter(function (c) { return c.empresa_id === empresaId; })[0] || {};
    var dias = String(r.dias_semana || '1,2,3,4,5').split(',').map(function (x) { return Number(x); });
    U.formulario({
      titulo: r.empresa_id ? 'Pausas de ' + empresaTxt(r.empresa_id) : 'Configurar empresa', boton: 'Guardar',
      campos: U.campo('Empresa', r.empresa_id ? input('empresa_id', r.empresa_id, ' readonly') : select('empresa_id', opcionesEmpresas(), '', 'Elige la empresa')) +
        '<div class="sx2-form__fila">' + U.campo('Hora habitual', input('hora_habitual', r.hora_habitual || '', ' type="time" required')) +
          U.campo('Duración (min)', input('duracion_min', r.duracion_min || 10, ' type="number" min="1" max="120" required')) + '</div>' +
        '<div class="sx2-campo"><span class="sx2-campo__et">Días</span><div class="av2-dias av2-dias--form">' + DIAS.map(function (x) {
          return '<label><input type="checkbox" name="dia_' + x[0] + '"' + (dias.indexOf(x[0]) !== -1 ? ' checked' : '') + '><span>' + x[1] + '</span></label>';
        }).join('') + '</div></div>' +
        U.campo('Recordatorio (minutos antes)', input('min_anticipacion', r.min_anticipacion || 5, ' type="number" min="0" max="120"')) +
        '<div class="sx2-form__fila">' + U.campo('Verde desde (% participación)', input('umbral_verde', r.umbral_verde || 80, ' type="number" min="0" max="100"')) +
          U.campo('Amarillo desde (%)', input('umbral_amarillo', r.umbral_amarillo || 50, ' type="number" min="0" max="100"')) + '</div>' +
        checkbox('activo', 'Activa (se programa sola cada día)', r.empresa_id ? activo(r.activo) : true),
      preparar: function (x, form) {
        if (!x.empresa_id) return 'Elige la empresa.';
        var dd = DIAS.filter(function (d) { return form.querySelector('[name=dia_' + d[0] + ']').checked; }).map(function (d) { return d[0]; });
        if (!dd.length) return 'Marca al menos un día.';
        if (!/^\d{2}:\d{2}$/.test(x.hora_habitual || '')) return 'Indica la hora (HH:mm).';
        if (Number(x.umbral_amarillo) > Number(x.umbral_verde)) return 'El umbral amarillo no puede ser mayor que el verde.';
        return { empresa_id: x.empresa_id, hora_habitual: x.hora_habitual, dias_semana: dd.join(','), duracion_min: x.duracion_min, min_anticipacion: x.min_anticipacion,
          umbral_verde: x.umbral_verde, umbral_amarillo: x.umbral_amarillo, activo: form.querySelector('[name=activo]').checked };
      },
      enviar: function (x) { return api('guardarPausasConfig', x); },
      aviso: 'Configuración guardada.',
      listo: function () { cargarPausas(true); }
    });
  }
  function qrPausas() {
    var sitio = (window.SIGSO_CONFIG && window.SIGSO_CONFIG.SITIO_PUBLICO) || location.href.replace(/[^/]*([?#].*)?$/, '');
    var url = sitio + (sitio && sitio.slice(-1) !== '/' ? '/' : '') + 'plataforma.html?modulo=pausas';
    var img = 'https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=' + encodeURIComponent(url);
    var d = U.drawer({ titulo: 'QR de registro de pausas',
      cuerpo: '<p class="sx2-tenue" style="margin:0;font-size:.875rem">Imprímelo y pégalo donde se hace la pausa. Cada persona lo escanea, entra con su cuenta y llega directo al registro. No lleva clave: es seguro dejarlo a la vista.</p>' +
        '<div class="av2-qr"><img src="' + U.esc(img) + '" alt="QR de registro de pausas" width="260" height="260"></div><p class="av2-url">' + U.esc(url) + '</p>',
      pie: U.boton({ texto: 'Copiar enlace', icono: 'copiar', clase: 'js-av2-copiar' }) + U.boton({ texto: 'Listo', variante: 'primario', clase: 'js-sx2-drawer-cerrar' }) });
    d.el.querySelector('.js-av2-copiar').addEventListener('click', function () {
      try { navigator.clipboard.writeText(url).then(function () { PY.aviso('Enlace copiado.', 'exito'); }, function () { PY.aviso('Cópialo a mano.', 'error'); }); } catch (e) { PY.aviso('Cópialo a mano.', 'error'); }
    });
  }
  function formPersonaPausas(tipo) {
    var coord = tipo === 'coord';
    U.formulario({
      titulo: coord ? 'Nueva coordinadora' : 'Nuevo trabajador', boton: 'Agregar',
      campos: U.campo('Empresa', select('empresa_id', opcionesEmpresas(), (opcionesEmpresas()[0] || {}).v)) +
        U.campo('Nombre', input('nombre', '', ' required maxlength="80"')) +
        U.campo('Correo', input('email', '', ' type="email" list="av2-correos" required')) +
        (coord ? U.campo('Tipo', select('tipo', [{ v: 'titular', t: 'Titular' }, { v: 'reemplazo', t: 'Reemplazo' }], 'titular'))
          : '<div class="sx2-form__fila">' + U.campo('Área', input('area', '', ' maxlength="80"')) + U.campo('Cargo', input('cargo', '', ' maxlength="80"')) + '</div>') + datalistCorreos(),
      alMontar: function (form) {
        var em = form.querySelector('[name=email]'), no = form.querySelector('[name=nombre]');
        em.addEventListener('change', function () { var p = (correos_ || []).filter(function (x) { return x.email === em.value.trim(); })[0]; if (p && !no.value) no.value = p.nombre; });
      },
      preparar: function (x) {
        if (!x.empresa_id) return 'Elige la empresa.';
        if (!x.nombre) return 'Indica el nombre.';
        if (!/^[^\s@]+@[^\s@]+$/.test(x.email || '')) return 'Indica un correo válido.';
        x.operacion = 'crear';
        return x;
      },
      enviar: function (x) { return api(coord ? 'gestionarPausasCoordinador' : 'gestionarPausasTrabajador', x); },
      aviso: coord ? 'Coordinadora agregada.' : 'Trabajador agregado.',
      listo: function () { cargarPausas(true); }
    });
  }
  function formMasivo(titulo, boton, texto, accion, aviso) {
    U.formulario({
      titulo: titulo, boton: boton, subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(texto) + '</span>',
      campos: U.campo('Empresa', select('empresa_id', opcionesEmpresas(), '', 'Elige la empresa')),
      preparar: function (x) { return x.empresa_id ? x : 'Elige la empresa.'; },
      enviar: function (x) { return api(accion, { empresa_id: x.empresa_id }); },
      aviso: aviso, listo: function () { cargarPausas(true); }
    });
  }
  function formPausa(pausaId, f, h) {
    var nueva = !pausaId;
    U.formulario({
      titulo: nueva ? 'Pausa manual' : 'Reprogramar pausa', boton: nueva ? 'Crear' : 'Reprogramar',
      campos: (nueva ? U.campo('Empresa', select('empresa_id', opcionesEmpresas(), (opcionesEmpresas()[0] || {}).v)) : '') +
        '<div class="sx2-form__fila">' + U.campo(nueva ? 'Fecha' : 'Nueva fecha', input('fecha', f || PY.hoyClave(), ' type="date" required')) +
          U.campo(nueva ? 'Hora' : 'Nueva hora', input('hora_programada', h || '', ' type="time" required')) + '</div>' +
        (nueva ? U.campo('Duración (min)', input('duracion_min', 10, ' type="number" min="1" max="120"')) : ''),
      preparar: function (x) {
        if (nueva && !x.empresa_id) return 'Elige la empresa.';
        if (!x.fecha || !x.hora_programada) return 'Indica fecha y hora.';
        x.operacion = nueva ? 'crear_manual' : 'reprogramar';
        if (!nueva) x.pausa_id = pausaId;
        return x;
      },
      enviar: function (x) { return api('gestionarPausaProgramada', x); },
      aviso: nueva ? 'Pausa creada.' : 'Pausa reprogramada.',
      listo: function () { cargarPausas(true); }
    });
  }
  function accionPausas(b, eliminar) {
    var tipo = b.getAttribute('data-tipo'), id = b.getAttribute('data-id');
    var accion = tipo === 'coord' ? 'gestionarPausasCoordinador' : 'gestionarPausasTrabajador';
    var datos = {};
    datos[tipo === 'coord' ? 'coord_id' : 'trabajador_id'] = id;
    var hacer = function () {
      b.disabled = true;
      api(accion, datos).then(function (r) {
        b.disabled = false;
        if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo aplicar.', 'error'); return; }
        PY.aviso(eliminar ? 'Eliminado.' : 'Listo.', 'exito');
        cargarPausas(true);
      });
    };
    if (eliminar) {
      datos.operacion = 'eliminar';
      U.confirmar({ titulo: tipo === 'coord' ? '¿Eliminar la coordinadora?' : '¿Eliminar del roster?', texto: 'Se elimina de forma permanente. Si solo dejó de participar, mejor desactívala: así se conserva su historial.', boton: 'Eliminar', peligro: true })
        .then(function (si) { if (si) hacer(); });
    } else {
      datos.operacion = 'activar';
      datos.activo = b.getAttribute('data-activo') === '1';
      hacer();
    }
  }

  // =========================================================================================
  // Alertas en vivo · Canales · Enviar alerta
  // =========================================================================================
  var PERMISO = { granted: ['Activas', 'ok'], default: ['Pendiente', 'alerta'], denied: ['Bloqueadas', 'critico'], sin_datos: ['Sin datos', 'neutro'] };
  var perm_ = null, permF_ = '', permQ_ = '';
  function cargarPermisos(silencioso) {
    var t = ++turno_;
    if (!silencioso || !perm_) cargando('Alertas en vivo', '', 'tabla');
    api('listarPermisosNotificacionesSO', {}).then(function (r) {
      if (t !== turno_ || vista_ !== 'NOTIF_PERMISOS') return;
      if (!r || !r.ok) { error('Alertas en vivo', r); return; }
      perm_ = r.data.personas || [];
      pintarPermisos(!!silencioso);
      resolverCorreos(perm_.map(function (p) { return p.email; }), t, function () { pintarPermisos(true); });
    });
  }
  function pintarPermisos(silencioso) {
    if (vista_ !== 'NOTIF_PERMISOS' || !perm_) return;
    var n = function (k) { return perm_.filter(function (p) { return p.permiso === k; }).length; };
    var lista = perm_.filter(function (p) { return (!permF_ || p.permiso === permF_) && (!permQ_ || coincide([p.nombre, p.email, p.origen].join(' '), permQ_)); });
    pagina(cabecera('Alertas en vivo', 'Quién tiene activadas las alertas del navegador. Si están bloqueadas, esa persona solo se entera por correo o al abrir la campana.') +
      '<div class="sx2-fila-kpis">' +
        U.kpi({ i: 0, etiqueta: 'Activas', valor: n('granted'), icono: 'check', tono: 'ok', filtro: 'granted', activo: permF_ === 'granted' }) +
        U.kpi({ i: 1, etiqueta: 'Pendientes', valor: n('default'), icono: 'reloj', tono: n('default') ? 'alerta' : 'neutro', filtro: 'default', activo: permF_ === 'default', titulo: 'SIGSO todavía no les pidió permiso, o lo cerraron sin responder.' }) +
        U.kpi({ i: 2, etiqueta: 'Bloqueadas', valor: n('denied'), icono: 'alerta', tono: n('denied') ? 'critico' : 'neutro', filtro: 'denied', activo: permF_ === 'denied', titulo: 'Se reactivan desde el candado de la barra de direcciones del navegador.' }) +
        U.kpi({ i: 3, etiqueta: 'Sin datos', valor: n('sin_datos'), icono: 'info', tono: 'neutro', filtro: 'sin_datos', activo: permF_ === 'sin_datos', titulo: 'Aún no abren SIGSO desde que existe esta medición.' }) +
      '</div>' +
      '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:4"><div class="sx2-barra-filtros">' + buscador(permQ_, 'Buscar persona…') + '</div></div>' +
      U.card({ sinRelleno: true, i: 5, cuerpo: lista.length ? '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Persona</th><th>Origen</th><th>Estado</th><th>Actualizado</th></tr></thead><tbody>' +
        lista.map(function (p) {
          var e = PERMISO[p.permiso] || [p.permiso, 'neutro'];
          return '<tr><td>' + persona(p.email, p.nombre) + '</td><td class="sx2-tenue">' + U.esc(p.origen || '') + '</td><td>' + U.badge(e[0], e[1]) + '</td><td>' + U.esc(p.actualizado_en ? fecha(p.actualizado_en) : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'campana', titulo: 'Nadie con este filtro', texto: '' }) }), silencioso);
  }

  var canales_ = null;
  function cargarCanales(silencioso) {
    var t = ++turno_;
    if (!silencioso || !canales_) cargando('Canales de alerta', '', 'tarjetas');
    api('listarCanalesAlerta', {}).then(function (r) {
      if (t !== turno_ || vista_ !== 'CANALES_ALERTA') return;
      if (!r || !r.ok) { error('Canales de alerta', r); return; }
      canales_ = r.data.canales || [];
      pintarCanales(!!silencioso);
    });
  }
  function pintarCanales(silencioso) {
    if (vista_ !== 'CANALES_ALERTA' || !canales_) return;
    pagina(cabecera('Canales de alerta', 'Qué alertas salen también por correo. Las que llegan "en vivo" (campana y aviso en pantalla) son seguras de apagar; las de solo correo, si las apagas, no llegan por ningún medio.') +
      '<div class="av2-canales">' + canales_.map(function (c, i) {
        var riesgo = !c.tiene_en_vivo && c.correo_activo;
        return '<section class="sx2-card av2-canal sx2-entra' + (riesgo ? ' sx2-tono-alerta av2-canal--riesgo' : '') + '" style="--i:' + (i + 1) + '">' +
          '<span class="sx2-apilado" style="gap:4px;flex:1;min-width:0"><span class="sx2-flex" style="gap:8px;flex-wrap:wrap;align-items:center"><strong>' + U.esc(c.nombre) + '</strong>' +
            (c.tiene_en_vivo ? U.badge('En vivo', 'ok', true) + U.badge('Correo', 'info', true) : U.badge('Solo correo', 'alerta', true)) + '</span>' +
            '<span class="sx2-tenue" style="font-size:.8125rem">' + U.esc(c.descripcion || '') + '</span>' +
            (riesgo ? '<span class="av2-riesgo">' + U.ico('alerta', 14) + 'Hoy solo existe por correo: si la apagas, nadie se enterará.</span>' : '') + '</span>' +
          '<label class="av2-switch" title="Enviar por correo"><input type="checkbox" class="js-av2-canal" data-clave="' + U.esc(c.clave) + '"' + (c.correo_activo ? ' checked' : '') + '><span></span><small>Correo</small></label></section>';
      }).join('') + '</div>', silencioso);
  }
  function cambiarCanal(el) {
    var c = canales_.filter(function (x) { return x.clave === el.getAttribute('data-clave'); })[0];
    var aplicar = function () {
      el.disabled = true;
      api('guardarCanalAlerta', { clave: c.clave, activo: el.checked }).then(function (r) {
        el.disabled = false;
        if (!r || !r.ok) { el.checked = !el.checked; PY.aviso((r && r.message) || 'No se pudo guardar.', 'error'); return; }
        c.correo_activo = el.checked;
        PY.aviso(el.checked ? 'El correo de "' + c.nombre + '" quedó encendido.' : 'El correo de "' + c.nombre + '" quedó apagado.', 'exito');
        pintarCanales(true);
      });
    };
    if (!el.checked && !c.tiene_en_vivo) {
      U.confirmar({ titulo: '¿Apagar "' + c.nombre + '"?', texto: 'Esta alerta solo existe por correo: si la apagas, nadie se enterará de estos avisos.', boton: 'Apagar igual', peligro: true })
        .then(function (si) { if (si) aplicar(); else el.checked = true; });
      return;
    }
    aplicar();
  }

  var dir_ = null, alerta_ = { aud: 'TODOS', sel: {}, q: '' };
  function cargarEnviar(silencioso) {
    var t = ++turno_;
    if (!silencioso || !dir_) cargando('Enviar alerta', '', 'tarjetas');
    api('getDirectorioAlerta', {}).then(function (r) {
      if (t !== turno_ || vista_ !== 'ENVIAR_ALERTA') return;
      if (!r || !r.ok) { error('Enviar alerta', r); return; }
      dir_ = r.data;
      pintarEnviar(!!silencioso);
      resolverCorreos((dir_.personas || []).map(function (p) { return p.email; }), t, function () { if (!document.querySelector('#admin-v2 .js-av2-alerta [name=titulo]:focus, #admin-v2 .js-av2-alerta textarea:focus')) pintarEnviar(true, true); });
    });
  }
  function listaPersonasAlerta() {
    var l = (dir_.personas || []).filter(function (p) { return !alerta_.q || coincide([p.nombre, p.email, p.empresa_id].join(' '), alerta_.q); });
    return l.map(function (p) {
      var per = PY.persona(p.email, p.nombre);
      return '<label class="nv2-persona"><input type="checkbox" class="js-av2-dest" value="' + U.esc(p.email) + '"' + (alerta_.sel[p.email] ? ' checked' : '') + '>' + U.avatar(per, 'xs') +
        '<span class="sx2-apilado" style="gap:0;min-width:0"><span class="sx2-cortar">' + U.esc(per.nombre) + '</span><small class="sx2-tenue sx2-cortar">' + U.esc(p.email + (p.empresa_id ? ' · ' + p.empresa_id : '')) + '</small></span></label>';
    }).join('') || '<p class="sx2-tenue" style="margin:8px 0;font-size:.8125rem">Nadie con esa búsqueda.</p>';
  }
  function pintarEnviar(silencioso, conservar) {
    if (vista_ !== 'ENVIAR_ALERTA' || !dir_) return;
    var previo = {};
    if (conservar) {
      var f0 = document.querySelector('#admin-v2 .js-av2-alerta');
      if (f0) new FormData(f0).forEach(function (v, k) { previo[k] = v; });
    }
    var nSel = Object.keys(alerta_.sel).filter(function (k) { return alerta_.sel[k]; }).length;
    pagina(cabecera('Enviar alerta', 'Un aviso directo a quien elijas, ahora. La alerta en vivo llega a quien tenga SIGSO abierto; el correo alcanza también a quien no.') +
      '<div class="sx2-grid sx2-grid--estira"><div class="sx2-col-7">' +
      U.card({ titulo: 'Mensaje', icono: 'campana', i: 1, cuerpo: '<form class="sx2-form js-av2-alerta" novalidate>' +
        U.campo('Título', input('titulo', previo.titulo || '', ' maxlength="120" required placeholder="Ej.: Corte programado de luz"')) +
        U.campo('Mensaje', '<textarea class="sx2-input" name="mensaje" rows="5" maxlength="2000" required>' + U.esc(previo.mensaje || '') + '</textarea>') +
        '<div class="sx2-campo"><span class="sx2-campo__et">Canales</span><div class="sx2-flex" style="gap:16px;flex-wrap:wrap">' +
          checkbox('por_en_vivo', 'Alerta en vivo', conservar ? previo.por_en_vivo === '1' : true) + checkbox('por_correo', 'Correo', conservar ? previo.por_correo === '1' : true) + '</div></div>' +
        '<p class="sx2-campo__error js-av2-alerta-error" hidden></p>' +
        '<div class="sx2-flex" style="justify-content:flex-end">' + U.boton({ texto: 'Enviar alerta', icono: 'campana', variante: 'primario', clase: 'js-av2-alerta-enviar', tipo: 'submit' }) + '</div></form>' }) +
      '</div><div class="sx2-col-5">' +
      U.card({ titulo: 'A quién', icono: 'equipo', i: 2, cuerpo: U.segmento([{ id: 'TODOS', texto: 'Todo el personal' }, { id: 'EMPRESA', texto: 'Por empresa' }, { id: 'SELECCION', texto: 'Personas' }], alerta_.aud, 'js-av2-aud') +
        (alerta_.aud === 'TODOS' ? '<p class="sx2-tenue" style="margin:12px 0 0;font-size:.8125rem">Llega a las ' + (dir_.personas || []).length + ' personas activas del directorio.</p>' : '') +
        (alerta_.aud === 'EMPRESA' ? '<div style="margin-top:12px">' + U.campo('Empresa', '<select class="sx2-select js-av2-alerta-emp">' + (dir_.empresas || []).map(function (e) {
            var n = (dir_.personas || []).filter(function (p) { return p.empresa_id === e; }).length;
            return '<option value="' + U.esc(e) + '"' + (e === alerta_.emp ? ' selected' : '') + '>' + U.esc(empresaTxt(e)) + ' · ' + n + ' personas</option>';
          }).join('') + '</select>') + '</div>' : '') +
        (alerta_.aud === 'SELECCION' ? '<div style="margin-top:12px" class="sx2-apilado">' + buscador(alerta_.q, 'Buscar persona…') +
          '<span class="sx2-tenue" style="font-size:.75rem">' + nSel + (nSel === 1 ? ' persona elegida' : ' personas elegidas') + '</span><div class="nv2-personas av2-dest">' + listaPersonasAlerta() + '</div></div>' : '') }) +
      '</div></div>', silencioso);
  }
  function enviarAlerta(form) {
    var x = {};
    new FormData(form).forEach(function (v, k) { x[k] = String(v).trim(); });
    var err = form.querySelector('.js-av2-alerta-error');
    var falla = function (m) { err.textContent = m; err.hidden = false; };
    err.hidden = true;
    if ((x.titulo || '').length < 3) return falla('Escribe un título (mínimo 3 caracteres).');
    if ((x.mensaje || '').length < 3) return falla('Escribe el mensaje.');
    if (!x.por_en_vivo && !x.por_correo) return falla('Elige al menos un canal.');
    var dest = Object.keys(alerta_.sel).filter(function (k) { return alerta_.sel[k]; });
    var emp = alerta_.aud === 'EMPRESA' ? (alerta_.emp || (dir_.empresas || [])[0] || '') : '';
    if (alerta_.aud === 'SELECCION' && !dest.length) return falla('Elige al menos una persona.');
    var n = alerta_.aud === 'TODOS' ? (dir_.personas || []).length : (alerta_.aud === 'EMPRESA' ? (dir_.personas || []).filter(function (p) { return p.empresa_id === emp; }).length : dest.length);
    U.confirmar({ titulo: '¿Enviar la alerta ahora?', texto: '"' + x.titulo + '" llegará a ' + n + (n === 1 ? ' persona' : ' personas') + (x.por_correo ? ', también por correo.' : ', solo en vivo.'), boton: 'Enviar' }).then(function (si) {
      if (!si) return;
      var b = form.querySelector('.js-av2-alerta-enviar');
      b.disabled = true;
      api('enviarAlertaManual', { titulo: x.titulo, mensaje: x.mensaje, audiencia_tipo: alerta_.aud, empresa_id: emp, destinatarios: dest, por_en_vivo: !!x.por_en_vivo, por_correo: !!x.por_correo }).then(function (r) {
        b.disabled = false;
        if (!r || !r.ok) { falla((r && r.message) || 'No se pudo enviar.'); return; }
        PY.aviso('Alerta enviada a ' + r.data.destinatarios + ' persona(s): ' + r.data.en_vivo + ' en vivo, ' + r.data.correo + ' por correo.', 'exito');
        alerta_ = { aud: 'TODOS', sel: {}, q: '' };
        pintarEnviar(true);
      });
    });
  }

  // =========================================================================================
  // Registro de envíos (LOGS) y Centro de reportes
  // =========================================================================================
  var logs_ = null, logF_ = '', logQ_ = '';
  function okEnvio(res) { return res === 'OK' || res === 'ENVIADO'; }
  function tonoEnvio(res) { return okEnvio(res) ? 'ok' : (res === 'PENDIENTE_REINTENTO' || res === 'ENVIANDO' ? 'alerta' : (/OMITIDO|DEDUP|APAGADO/i.test(res || '') ? 'neutro' : 'critico')); }
  function cargarLogs(silencioso) {
    var t = ++turno_;
    if (!silencioso || !logs_) cargando('Registro de envíos', '', 'tabla');
    api('listarLogs', { limite: 500 }).then(function (r) {
      if (t !== turno_ || vista_ !== 'LOGS') return;
      if (!r || !r.ok) { error('Registro de envíos', r); return; }
      logs_ = Array.isArray(r.data) ? r.data : [];
      pintarLogs(!!silencioso);
    });
  }
  function pintarLogs(silencioso) {
    if (vista_ !== 'LOGS' || !logs_) return;
    var res = {};
    logs_.forEach(function (l) { var k = l.resultado || '(sin resultado)'; res[k] = (res[k] || 0) + 1; });
    var lista = logs_.filter(function (l) { return (!logF_ || (l.resultado || '(sin resultado)') === logF_) && (!logQ_ || coincide([l.solicitud_id, l.evento, l.destinatario, l.resultado].join(' '), logQ_)); });
    pagina(cabecera('Registro de envíos', 'Los últimos 500 correos automáticos, tal como los registra el sistema.', U.boton({ texto: 'Volver a reportes', icono: 'izquierda', variante: 'fantasma', clase: 'js-av2-ir', datos: { ir: 'REPORTES' } })) +
      '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:1"><div class="sx2-barra-filtros">' + buscador(logQ_, 'Buscar por solicitud, evento o destinatario…') +
        U.chip({ texto: 'Todos', n: logs_.length, activo: !logF_, clase: 'js-av2-logf', datos: { f: '' } }) +
        Object.keys(res).sort(function (a, b) { return res[b] - res[a]; }).map(function (k) { return U.chip({ texto: k.replace(/_/g, ' '), n: res[k], tono: tonoEnvio(k), activo: logF_ === k, clase: 'js-av2-logf', datos: { f: k } }); }).join('') + '</div></div>' +
      U.card({ sinRelleno: true, i: 2, cuerpo: lista.length ? '<div class="sx2-tabla-wrap"><table class="sx2-tabla"><thead><tr><th>Fecha</th><th>Solicitud</th><th>Evento</th><th>Destinatario</th><th>Resultado</th><th class="sx2-num">Reintentos</th></tr></thead><tbody>' +
        lista.slice(0, 300).map(function (l) {
          var d = l.timestamp ? new Date(l.timestamp) : null;
          return '<tr><td style="white-space:nowrap">' + U.esc(d && !isNaN(d) ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Santiago' }).format(d) : (l.timestamp || '—')) + '</td>' +
            '<td>' + (/^SOL-/.test(l.solicitud_id || '') ? '<button type="button" class="sx2-enlace js-av2-sol" data-sol="' + U.esc(l.solicitud_id) + '">' + U.esc(l.solicitud_id) + '</button>' : '<span class="sx2-tenue">' + U.esc(l.solicitud_id || '—') + '</span>') + '</td>' +
            '<td class="av2-evento" title="' + U.esc(l.evento || '') + '">' + U.esc(String(l.evento || '').split(':')[0]) + '</td><td>' + U.esc(l.destinatario || '') + '</td>' +
            '<td>' + U.badge(String(l.resultado || '—').replace(/_/g, ' '), tonoEnvio(l.resultado)) + '</td><td class="sx2-num">' + U.esc(String(l.reintentos || 0)) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'correo', titulo: 'Nada con este filtro', texto: '' }) }), silencioso);
  }

  var REPORTES = [
    { grupo: 'Notificaciones', icono: 'campana', reportes: [
      { id: 'notif-entregabilidad', nombre: 'Entregabilidad', tipo: 'CUMPLIMIENTO', estado: 'LISTO', desc: 'Cuántas notificaciones salieron bien, cuántas fallaron y cuántas siguen reintentando.', fuente: 'listarLogs', filtros: [] },
      { id: 'notif-evento', nombre: 'Fallas por evento', tipo: 'RANKING', estado: 'LISTO', desc: 'Qué eventos concentran los problemas de envío.', fuente: 'listarLogs', filtros: [] },
      { id: 'notif-detalle', nombre: 'Registro de envíos', tipo: 'DETALLE', estado: 'LISTO', desc: 'El historial de envíos, con búsqueda y filtro por resultado.', fuente: 'listarLogs', seccion: 'LOGS' }
    ] },
    { grupo: 'Salud del sistema', icono: 'escudo', reportes: [
      { id: 'sis-esquema', nombre: 'Estado del esquema', tipo: 'ESTADO', estado: 'LISTO', desc: 'Versión del backend y si falta alguna tabla o columna que el sistema espera.', fuente: 'getEstadoSistema', filtros: [] }
    ] },
    { grupo: 'Accesos', icono: 'llave', reportes: [
      { id: 'acc-modulos', nombre: 'Cuentas por módulo', tipo: 'RANKING', estado: 'LISTO', desc: 'Cuántas cuentas activas tienen habilitado cada módulo.', fuente: 'listarCuentasPortal', filtros: [] },
      { id: 'acc-inactivas', nombre: 'Cuentas sin uso', tipo: 'ESTADO', estado: 'LISTO', desc: 'Cuentas activas que nunca entraron o que llevan más de 30 días sin entrar.', fuente: 'listarCuentasPortal', filtros: [] }
    ] }
  ];
  var ACCION_REPORTE = { 'notif-entregabilidad': 'listarLogs', 'notif-evento': 'listarLogs', 'sis-esquema': 'getEstadoSistema', 'acc-modulos': 'listarCuentasPortal', 'acc-inactivas': 'listarCuentasPortal' };
  var MODULO_TXT = { nueva_solicitud: 'Nueva solicitud', mis_solicitudes: 'Mis solicitudes', bandeja: 'Bandeja de trabajo', mi_trabajo: 'Mi trabajo', proyectos: 'Proyectos',
    gerencia: 'Panel de gerencia', jefatura: 'Mi departamento', administracion: 'Administración', pausas: 'Pausas activas', pausas_coordinacion: 'Coordinación de pausas', calidad: 'Calidad (SGC)', novedades: 'Novedades' };
  var repAbierto_ = null;
  function registrarReportes() {
    if (!window.SigsoReportes || registrarReportes.hecho) return;
    SigsoReportes.registrar('administracion', { titulo: 'Reportes de Administración', nota: 'Todos salen de datos que el sistema ya guarda.', grupos: REPORTES });
    registrarReportes.hecho = true;
  }
  function cargarReportes() {
    registrarReportes();
    ++turno_;
    var c = pagina(cabecera('Centro de reportes', 'Entregabilidad de los avisos, salud del sistema y accesos.') + '<div class="sx2-card sx2-entra av2-rep" style="--i:1"></div>');
    if (!c) return;
    var cont = c.querySelector('.av2-rep');
    if (!repAbierto_) {
      SigsoReportes.pintarCatalogo({ contenedor: cont, modulo: 'administracion', onAbrir: function (id) { repAbierto_ = id; cargarReportes(); }, onIrASeccion: function (s) { irA(s); } });
      return;
    }
    var r = SigsoReportes.buscarReporte('administracion', repAbierto_);
    var accion = ACCION_REPORTE[repAbierto_];
    if (!r || !accion) { repAbierto_ = null; cargarReportes(); return; }
    cont.innerHTML = U.esqueleto('tabla', 5);
    var t = turno_;
    api(accion, accion === 'listarLogs' ? { limite: 500 } : {}).then(function (resp) {
      if (t !== turno_ || vista_ !== 'REPORTES') return;
      if (!resp || !resp.ok) { cont.innerHTML = U.vacio({ icono: 'alerta', titulo: 'No se pudo armar el reporte', texto: (resp && resp.message) || '' }); return; }
      var cuerpo = '';
      if (r.id === 'notif-entregabilidad') cuerpo = cuerpoEntregabilidad(resp.data);
      else if (r.id === 'notif-evento') cuerpo = cuerpoFallas(resp.data);
      else if (r.id === 'sis-esquema') cuerpo = cuerpoEsquema(resp.data);
      else if (r.id === 'acc-modulos') cuerpo = cuerpoModulos(resp.data);
      else if (r.id === 'acc-inactivas') cuerpo = cuerpoSinUso(resp.data);
      cont.innerHTML = SigsoReportes.barraAcciones({}) +
        SigsoReportes.cabeceraDocumento({ titulo: r.nombre, subtitulo: r.desc, modulo: 'Administración', codigo: 'SIGSO-REP-ADM-' + String(r.id).toUpperCase(), generadoPor: PY.miNombre() || '', filtros: [] }) +
        cuerpo + SigsoReportes.pieDocumento();
      SigsoReportes.wireAcciones(cont, { nombreArchivo: 'sigso-admin-' + r.id, onVolver: function () { repAbierto_ = null; cargarReportes(); } });
      U.animar(cont);
    });
  }
  function vacioRep(t) { return '<div class="rp2-vacio">' + U.vacio({ icono: 'grafico', titulo: '', texto: t }) + '</div>'; }
  function cuerpoEntregabilidad(logs) {
    logs = Array.isArray(logs) ? logs : [];
    if (!logs.length) return vacioRep('Todavía no hay envíos registrados.');
    var por = {};
    logs.forEach(function (l) { var k = l.resultado || '(sin resultado)'; por[k] = (por[k] || 0) + 1; });
    var ok = logs.filter(function (l) { return okEnvio(l.resultado); }).length, rein = por.PENDIENTE_REINTENTO || 0;
    return SigsoReportes.kpis([{ etiqueta: 'Envíos registrados', valor: logs.length }, { etiqueta: 'Entregados', valor: ok }, { etiqueta: 'Reintentando', valor: rein, alerta: rein > 0 }, { etiqueta: 'Tasa de entrega', valor: Math.round(ok / logs.length * 100) + '%' }]) +
      SigsoReportes.tabla([{ campo: 'resultado', titulo: 'Resultado' }, { campo: 'total', titulo: 'Envíos', alinear: 'derecha' }, { campo: 'pct', titulo: 'Del total', alinear: 'derecha' }],
        Object.keys(por).sort(function (a, b) { return por[b] - por[a]; }).map(function (k) { return { resultado: k.replace(/_/g, ' '), total: por[k], pct: Math.round(por[k] / logs.length * 100) + '%' }; }));
  }
  function cuerpoFallas(logs) {
    var f = (Array.isArray(logs) ? logs : []).filter(function (l) { return l.resultado && !okEnvio(l.resultado); });
    if (!f.length) return vacioRep('Ningún envío con problemas en los últimos registros.');
    var por = {};
    f.forEach(function (l) { var k = String(l.evento || '(sin evento)').split(':')[0]; por[k] = (por[k] || 0) + 1; });
    return SigsoReportes.ranking(Object.keys(por).sort(function (a, b) { return por[b] - por[a]; }).map(function (k) { return { etiqueta: k, valor: por[k], tono: 'critico' }; })) +
      '<h3 class="rp2-sub">Detalle</h3>' + SigsoReportes.tabla([{ campo: 'fecha', titulo: 'Fecha' }, { campo: 'evento', titulo: 'Evento' }, { campo: 'destinatario', titulo: 'Destinatario' }, { campo: 'resultado', titulo: 'Resultado' }, { campo: 'reintentos', titulo: 'Reintentos', alinear: 'derecha' }],
        f.slice(0, 100).map(function (l) { return { fecha: fecha(l.timestamp), evento: String(l.evento || '').split(':')[0], destinatario: l.destinatario, resultado: String(l.resultado).replace(/_/g, ' '), reintentos: l.reintentos || 0 }; }));
  }
  function cuerpoEsquema(data) {
    var e = (data && data.esquema) || {}, probs = [];
    Object.keys(e).forEach(function (k) { if (Array.isArray(e[k])) e[k].forEach(function (it) { probs.push({ tipo: k.replace(/_/g, ' '), detalle: typeof it === 'string' ? it : JSON.stringify(it) }); }); });
    return SigsoReportes.kpis([{ etiqueta: 'Versión del backend', valor: (data && data.version_backend) || '—' }, { etiqueta: 'Problemas de esquema', valor: probs.length, alerta: probs.length > 0 }]) +
      (probs.length ? SigsoReportes.tabla([{ campo: 'tipo', titulo: 'Tipo' }, { campo: 'detalle', titulo: 'Detalle' }], probs) : vacioRep('Están todas las tablas y columnas que el sistema espera.'));
  }
  function cuentasDe(data) { return ((data && data.cuentas) || (Array.isArray(data) ? data : [])).filter(function (c) { return c.activo !== false; }); }
  function cuerpoModulos(data) {
    var cs = cuentasDe(data);
    if (!cs.length) return vacioRep('No hay cuentas activas.');
    var por = {};
    cs.forEach(function (c) {
      var m = c.modulos;
      if (typeof m === 'string') { try { m = JSON.parse(m); } catch (err) { m = []; } }
      (m || []).forEach(function (x) { por[x] = (por[x] || 0) + 1; });
    });
    return SigsoReportes.kpis([{ etiqueta: 'Cuentas activas', valor: cs.length }, { etiqueta: 'Módulos en uso', valor: Object.keys(por).length }]) +
      SigsoReportes.ranking(Object.keys(por).sort(function (a, b) { return por[b] - por[a]; }).map(function (m) { return { etiqueta: MODULO_TXT[m] || m, valor: por[m], texto: por[m] + ' de ' + cs.length }; }), { vacio: 'Ninguna cuenta tiene módulos asignados.' });
  }
  function cuerpoSinUso(data) {
    var cs = cuentasDe(data);
    var dias = function (c) { return c.ultimo_acceso ? Math.floor((Date.now() - new Date(c.ultimo_acceso).getTime()) / 86400000) : null; };
    var nunca = cs.filter(function (c) { return dias(c) === null; }), viejas = cs.filter(function (c) { var d = dias(c); return d !== null && d > 30; });
    var filas = nunca.concat(viejas.sort(function (a, b) { return dias(b) - dias(a); })).map(function (c) {
      var d = dias(c);
      return { nombre: c.nombre || c.usuario, usuario: c.usuario, rol: rolTxt(c.rol), ultimo: d === null ? 'Nunca entró' : fecha(c.ultimo_acceso), dias: d === null ? '—' : d, temporal: c.debe_cambiar_password ? 'Sí' : 'No' };
    });
    return SigsoReportes.kpis([{ etiqueta: 'Cuentas activas', valor: cs.length }, { etiqueta: 'Nunca entraron', valor: nunca.length, alerta: nunca.length > 0 }, { etiqueta: 'Más de 30 días sin entrar', valor: viejas.length, alerta: viejas.length > 0 }]) +
      (filas.length ? SigsoReportes.tabla([{ campo: 'nombre', titulo: 'Persona' }, { campo: 'usuario', titulo: 'Usuario' }, { campo: 'rol', titulo: 'Rol' }, { campo: 'ultimo', titulo: 'Último acceso' },
        { campo: 'dias', titulo: 'Días sin entrar', alinear: 'derecha' }, { campo: 'temporal', titulo: 'Clave temporal' }], filas) : vacioRep('Todas las cuentas activas entraron en los últimos 30 días.'));
  }

  // =========================================================================================
  // Panel de datos (super admin)
  // =========================================================================================
  var sa_ = { tablas: null, tabla: '', columnas: [], filas: null, q: '' };
  function valorTexto(v) { return typeof v === 'string' ? v : JSON.stringify(v === undefined ? '' : v); }
  function valorDesde(t) { try { return JSON.parse(t); } catch (e) { return t; } }
  function cargarSuper(silencioso) {
    var t = ++turno_;
    if (sa_.tabla) {
      if (!silencioso || !sa_.filas) cargando(sa_.tabla, '', 'tabla');
      api('superAdminListarFilas', { tabla: sa_.tabla }).then(function (r) {
        if (t !== turno_ || vista_ !== 'PANEL_SUPER_ADMIN') return;
        if (!r || !r.ok) { error(sa_.tabla, r); return; }
        sa_.columnas = r.data.columnas || [];
        sa_.filas = r.data.filas || [];
        pintarSuper(!!silencioso);
      });
      return;
    }
    if (!silencioso || !sa_.tablas) cargando('Panel de datos', '', 'tarjetas');
    api('superAdminListarTablas', {}).then(function (r) {
      if (t !== turno_ || vista_ !== 'PANEL_SUPER_ADMIN') return;
      if (!r || !r.ok) { error('Panel de datos', r); return; }
      sa_.tablas = r.data.tablas || [];
      pintarSuper(!!silencioso);
    });
  }
  function avisoSuper() {
    return '<div class="av2-aviso sx2-tono-critico sx2-entra">' + U.ico('alerta', 16) + '<span>Este panel edita la base de datos <b>directo</b>, sin ninguna validación de SIGSO. Cada cambio y cada eliminación quedan registrados. Úsalo solo para corregir errores puntuales.</span></div>';
  }
  function pintarSuper(silencioso) {
    if (vista_ !== 'PANEL_SUPER_ADMIN') return;
    if (!sa_.tabla) {
      var l = (sa_.tablas || []).filter(function (x) { return !sa_.q || coincide(x.nombre, sa_.q); });
      pagina(cabecera('Panel de datos', 'Todas las tablas de SIGSO. Elige una para ver y corregir sus filas.') + avisoSuper() +
        '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:1"><div class="sx2-barra-filtros">' + buscador(sa_.q, 'Buscar tabla…') + '</div></div>' +
        '<div class="av2-tablas sx2-entra" style="--i:2">' + l.map(function (x) {
          return '<button type="button" class="av2-tabla js-av2-sa-tabla" data-tabla="' + U.esc(x.nombre) + '"><code>' + U.esc(x.nombre) + '</code><span class="sx2-tenue">' + x.filas + (x.filas === 1 ? ' fila' : ' filas') + '</span></button>';
        }).join('') + '</div>', silencioso);
      return;
    }
    var cols = sa_.columnas, filas = sa_.filas || [];
    var vis = filas.map(function (f, i) { return { f: f, i: i }; }).filter(function (x) { return !sa_.q || coincide(cols.map(function (c) { return valorTexto(x.f[c]); }).join(' '), sa_.q); });
    pagina(cabecera(sa_.tabla, filas.length + (filas.length === 1 ? ' fila' : ' filas') + ' · la primera columna identifica la fila.',
        U.boton({ texto: 'Tablas', icono: 'izquierda', variante: 'fantasma', clase: 'js-av2-sa-volver' }) + U.boton({ texto: 'Nueva fila', icono: 'nueva', variante: 'primario', clase: 'js-av2-sa-nueva' })) + avisoSuper() +
      '<div class="sx2-card sx2-py-herramientas sx2-entra" style="--i:1"><div class="sx2-barra-filtros">' + buscador(sa_.q, 'Buscar en las filas…') + '</div></div>' +
      U.card({ sinRelleno: true, i: 2, cuerpo: vis.length ? '<div class="sx2-tabla-wrap av2-sa-wrap"><table class="sx2-tabla av2-sa"><thead><tr>' + cols.map(function (c) { return '<th>' + U.esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        vis.slice(0, 300).map(function (x) {
          return '<tr class="sx2-fila--clic js-av2-sa-fila" data-i="' + x.i + '" tabindex="0">' + cols.map(function (c) { var t = valorTexto(x.f[c]); return '<td title="' + U.esc(t.slice(0, 300)) + '">' + U.esc(t.length > 60 ? t.slice(0, 60) + '…' : t) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' + (vis.length > 300 ? '<p class="av2-mas">Mostrando 300 de ' + vis.length + '. Busca para acotar.</p>' : '')
        : U.vacio({ icono: 'lupa', titulo: filas.length ? 'Nada con esta búsqueda' : 'La tabla está vacía', texto: '' }) }), silencioso);
  }
  function filaSuper(i) {
    var cols = sa_.columnas, reg = i === null ? null : sa_.filas[i], nueva = !reg;
    var d = U.drawer({ titulo: (nueva ? 'Nueva fila — ' : 'Editar fila — ') + sa_.tabla,
      subtitulo: '<span class="sx2-tenue" style="font-size:.8125rem">Texto plano o JSON (número, true/false, ["a","b"]…).</span>',
      cuerpo: '<form class="sx2-form js-av2-sa-form" novalidate>' + cols.map(function (c) {
        return U.campo(c, '<textarea class="sx2-input av2-sa-campo" rows="' + (c === cols[0] ? 1 : 2) + '" data-col="' + U.esc(c) + '">' + U.esc(nueva ? '' : valorTexto(reg[c])) + '</textarea>');
      }).join('') + '<p class="sx2-campo__error js-av2-sa-err" hidden></p></form>',
      pie: (nueva ? '' : U.boton({ texto: 'Eliminar fila', icono: 'basura', variante: 'texto-peligro', clase: 'js-av2-sa-del' })) + '<span style="flex:1"></span>' +
        U.boton({ texto: 'Cancelar', clase: 'js-sx2-drawer-cerrar' }) + U.boton({ texto: nueva ? 'Crear fila' : 'Guardar cambios', icono: 'check', variante: 'primario', clase: 'js-av2-sa-ok' }) });
    d.el.classList.add('sx2-drawer--ancho');
    var err = function (m) { var e = d.el.querySelector('.js-av2-sa-err'); e.textContent = m; e.hidden = false; };
    var hecho = function (r, aviso) {
      if (!r || !r.ok) { err((r && r.message) || 'No se pudo aplicar.'); return; }
      d.cerrar(); PY.aviso(aviso, 'exito'); cargarSuper(true);
    };
    d.el.querySelector('.js-av2-sa-ok').addEventListener('click', function (ev) {
      var b = ev.currentTarget, vals = {};
      d.el.querySelectorAll('[data-col]').forEach(function (ta) { vals[ta.getAttribute('data-col')] = valorDesde(ta.value); });
      b.disabled = true;
      (nueva ? api('superAdminAgregarFila', { tabla: sa_.tabla, fila: vals })
        : api('superAdminActualizarFila', { tabla: sa_.tabla, id_campo: cols[0], id_valor: reg[cols[0]], cambios: vals }))
        .then(function (r) { b.disabled = false; hecho(r, nueva ? 'Fila creada.' : 'Cambios guardados.'); });
    });
    var del = d.el.querySelector('.js-av2-sa-del');
    if (del) del.addEventListener('click', function () {
      var idv = String(reg[cols[0]]);
      var s = U.drawer({ titulo: 'Eliminar fila de ' + sa_.tabla,
        cuerpo: '<p class="sx2-tenue" style="margin:0;font-size:.875rem">Se borra sin ninguna validación y no se puede deshacer. Para confirmar, escribe el valor de <b>' + U.esc(cols[0]) + '</b>:</p><p><code class="av2-cod">' + U.esc(idv) + '</code></p>' +
          U.campo('Confirmación', '<input class="sx2-input js-av2-sa-conf" autocomplete="off">') + '<p class="sx2-campo__error js-av2-sa-conferr" hidden></p>',
        pie: U.boton({ texto: 'Cancelar', clase: 'js-sx2-drawer-cerrar' }) + U.boton({ texto: 'Eliminar', icono: 'basura', variante: 'peligro', clase: 'js-av2-sa-confok' }) });
      s.el.querySelector('.js-av2-sa-confok').addEventListener('click', function () {
        if (s.el.querySelector('.js-av2-sa-conf').value !== idv) { var e = s.el.querySelector('.js-av2-sa-conferr'); e.textContent = 'Escribe exactamente el valor mostrado.'; e.hidden = false; return; }
        api('superAdminEliminarFila', { tabla: sa_.tabla, id_campo: cols[0], id_valor: reg[cols[0]] }).then(function (r) {
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo eliminar.', 'error'); return; }
          s.cerrar(); PY.aviso('Fila eliminada.', 'exito'); cargarSuper(true);
        });
      });
    });
  }

  // =========================================================================================
  // Navegación y eventos
  // =========================================================================================
  function irA(id) {
    if (!itemDe(id)) id = 'SALUD';
    vista_ = id;
    if (id !== 'REPORTES') repAbierto_ = null;
    registrarArbol();
    if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(id);
    if (id === 'SALUD') { if (window.SigsoAdminV2) SigsoAdminV2.mostrarSalud(); return; }
    if (id === 'CUENTAS_PORTAL') { if (window.SigsoAdminV2) SigsoAdminV2.mostrarCuentas(); return; }
    ++turno_;
    recargar(false);
  }
  function recargar(silencioso) {
    var v = vista_;
    if (CAT[v]) cargarCatalogo(v, silencioso);
    else if (v === 'JEFATURAS') cargarJefaturas(silencioso);
    else if (v === 'PAUSAS') cargarPausas(silencioso);
    else if (v === 'NOTIF_PERMISOS') cargarPermisos(silencioso);
    else if (v === 'CANALES_ALERTA') cargarCanales(silencioso);
    else if (v === 'ENVIAR_ALERTA') cargarEnviar(silencioso);
    else if (v === 'LOGS') cargarLogs(silencioso);
    else if (v === 'REPORTES') cargarReportes();
    else if (v === 'PANEL_SUPER_ADMIN') cargarSuper(silencioso);
  }
  function repintar() {
    var v = vista_;
    if (CAT[v]) pintarCatalogo(true);
    else if (v === 'JEFATURAS') pintarJefaturas(true);
    else if (v === 'PAUSAS') pintarPausas(true);
    else if (v === 'NOTIF_PERMISOS') pintarPermisos(true);
    else if (v === 'LOGS') pintarLogs(true);
    else if (v === 'PANEL_SUPER_ADMIN') pintarSuper(true);
  }
  function propia() { return vista_ && vista_ !== 'SALUD' && vista_ !== 'CUENTAS_PORTAL'; }

  document.addEventListener('click', function (ev) {
    var raiz = document.getElementById('admin-v2');
    if (!raiz || !raiz.contains(ev.target) || !propia()) return;
    var t = ev.target, b;
    if (t.closest('.js-av2-recargar')) { cache_ = {}; correos_ = null; recargar(true); return; }
    if ((b = t.closest('.js-av2-ir'))) { irA(b.getAttribute('data-ir')); return; }
    if ((b = t.closest('.js-av2-sol'))) { if (window.SigsoBandejaV2) SigsoBandejaV2.abrirSolicitud(b.getAttribute('data-sol')); return; }
    if ((b = t.closest('.js-av2-est'))) {
      var est = b.getAttribute('data-est');
      if (CAT[vista_]) cat_.est = est; else pau_.est = est;
      repintar();
      return;
    }
    // Catálogos
    if (CAT[vista_]) {
      if (t.closest('.js-av2-nuevo')) { abrirRegistro(null); return; }
      if ((b = t.closest('.js-av2-fila'))) { abrirRegistro(b.getAttribute('data-id')); return; }
    }
    // Jefaturas
    if (t.closest('.js-av2-jef-nueva')) { nuevaJefatura(); return; }
    if ((b = t.closest('.js-av2-jef-act'))) {
      b.disabled = true;
      api('gestionarJefatura', { operacion: 'activar', jefatura_id: b.getAttribute('data-id'), activo: b.getAttribute('data-activo') === '1' }).then(function (r) {
        b.disabled = false;
        if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo aplicar.', 'error'); return; }
        cargarJefaturas(true);
      });
      return;
    }
    if ((b = t.closest('.js-av2-jef-del'))) {
      var jid = b.getAttribute('data-id');
      U.confirmar({ titulo: '¿Eliminar esta jefatura?', texto: 'Esa persona deja de aparecer en "Mi departamento" de su jefe. Si es temporal, mejor desactívala.', boton: 'Eliminar', peligro: true }).then(function (si) {
        if (!si) return;
        api('gestionarJefatura', { operacion: 'eliminar', jefatura_id: jid }).then(function (r) {
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo eliminar.', 'error'); return; }
          PY.aviso('Jefatura eliminada.', 'exito');
          cargarJefaturas(true);
        });
      });
      return;
    }
    // Pausas
    if ((b = t.closest('.js-av2-pau-sub'))) { pau_.sub = b.getAttribute('data-id'); pau_.q = ''; pau_.est = 'pendientes'; cargarPausas(false); return; }
    if ((b = t.closest('.js-av2-pau-cfg'))) { formConfigPausas(b.getAttribute('data-emp') || ''); return; }
    if (t.closest('.js-av2-qr')) { qrPausas(); return; }
    if (t.closest('.js-av2-pau-coord')) { correosConocidos().then(function () { formPersonaPausas('coord'); }); return; }
    if (t.closest('.js-av2-pau-trab')) { correosConocidos().then(function () { formPersonaPausas('trab'); }); return; }
    if (t.closest('.js-av2-pau-sembrar')) { formMasivo('Sembrar roster desde cuentas', 'Sembrar', 'Agrega al roster a las personas con cuenta en esa empresa. No crea cuentas nuevas.', 'sembrarRosterPausas', function (r) { return r.data.creados + ' trabajador(es) nuevo(s) en el roster.'; }); return; }
    if (t.closest('.js-av2-pau-modulo')) {
      formMasivo('Dar "Pausas activas" a todo el roster', 'Asignar', 'Agrega el módulo a la cuenta de cada trabajador del roster que ya tenga cuenta.', 'asignarModuloPausasRoster', function (r) {
        return r.data.cuentas_actualizadas + ' cuenta(s) actualizada(s).' + (r.data.sin_cuenta && r.data.sin_cuenta.length ? ' ' + r.data.sin_cuenta.length + ' del roster no tienen cuenta todavía.' : '');
      });
      return;
    }
    if ((b = t.closest('.js-av2-pau-act'))) { accionPausas(b, false); return; }
    if ((b = t.closest('.js-av2-pau-del'))) { accionPausas(b, true); return; }
    if ((b = t.closest('.js-av2-pau-hoy'))) {
      b.disabled = true;
      api('programarPausasDelDia', {}).then(function (r) {
        b.disabled = false;
        if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo programar.', 'error'); return; }
        PY.aviso('Se programaron las pausas de hoy que correspondían.', 'exito');
        cargarPausas(true);
      });
      return;
    }
    if (t.closest('.js-av2-pau-manual')) { formPausa(null); return; }
    if ((b = t.closest('.js-av2-pau-repro'))) { formPausa(b.getAttribute('data-id'), b.getAttribute('data-fecha'), b.getAttribute('data-hora')); return; }
    if ((b = t.closest('.js-av2-pau-cancel'))) {
      var pid = b.getAttribute('data-id');
      U.confirmar({ titulo: '¿Cancelar esta pausa?', texto: 'Queda como Cancelada y no cuenta para el cumplimiento.', boton: 'Cancelar pausa', peligro: true }).then(function (si) {
        if (!si) return;
        api('gestionarPausaProgramada', { operacion: 'cancelar', pausa_id: pid }).then(function (r) {
          if (!r || !r.ok) { PY.aviso((r && r.message) || 'No se pudo cancelar.', 'error'); return; }
          PY.aviso('Pausa cancelada.', 'exito');
          cargarPausas(true);
        });
      });
      return;
    }
    // Alertas en vivo
    if (vista_ === 'NOTIF_PERMISOS' && (b = t.closest('.sx2-kpi--clic'))) { var f = b.getAttribute('data-filtro'); permF_ = permF_ === f ? '' : f; pintarPermisos(true); return; }
    // Enviar alerta
    if ((b = t.closest('.js-av2-aud'))) { alerta_.aud = b.getAttribute('data-id'); pintarEnviar(true, true); return; }
    if ((b = t.closest('.js-av2-alerta-enviar'))) { ev.preventDefault(); enviarAlerta(b.closest('form')); return; }
    // Registro de envíos
    if ((b = t.closest('.js-av2-logf'))) { logF_ = b.getAttribute('data-f') || ''; pintarLogs(true); return; }
    // Panel de datos
    if ((b = t.closest('.js-av2-sa-tabla'))) { sa_.tabla = b.getAttribute('data-tabla'); sa_.filas = null; sa_.q = ''; cargarSuper(false); return; }
    if (t.closest('.js-av2-sa-volver')) { sa_.tabla = ''; sa_.q = ''; cargarSuper(!!sa_.tablas); return; }
    if (t.closest('.js-av2-sa-nueva')) { filaSuper(null); return; }
    if ((b = t.closest('.js-av2-sa-fila'))) filaSuper(Number(b.getAttribute('data-i')));
  });
  document.addEventListener('submit', function (ev) {
    if (ev.target.classList && ev.target.classList.contains('js-av2-alerta')) { ev.preventDefault(); enviarAlerta(ev.target); }
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el.closest || !el.closest('#admin-v2') || !propia()) return;
    if (el.classList.contains('js-av2-plat')) { cat_.plataforma = el.value; pintarCatalogo(true); return; }
    if (el.classList.contains('js-av2-canal')) { cambiarCanal(el); return; }
    if (el.classList.contains('js-av2-alerta-emp')) { alerta_.emp = el.value; return; }
    if (el.classList.contains('js-av2-dest')) { alerta_.sel[el.value] = el.checked; var s = document.querySelector('#admin-v2 .av2-dest'); if (s && s.previousElementSibling) s.previousElementSibling.textContent = Object.keys(alerta_.sel).filter(function (k) { return alerta_.sel[k]; }).length + ' elegida(s)'; }
  });
  var tq_ = null;
  document.addEventListener('input', function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains('js-av2-q') || !propia()) return;
    var v = ev.target.value;
    clearTimeout(tq_);
    tq_ = setTimeout(function () {
      if (CAT[vista_]) cat_.q = v;
      else if (vista_ === 'JEFATURAS') jefQ_ = v;
      else if (vista_ === 'PAUSAS') pau_.q = v;
      else if (vista_ === 'NOTIF_PERMISOS') permQ_ = v;
      else if (vista_ === 'LOGS') logQ_ = v;
      else if (vista_ === 'PANEL_SUPER_ADMIN') sa_.q = v;
      else if (vista_ === 'ENVIAR_ALERTA') {
        alerta_.q = v;
        var cont = document.querySelector('#admin-v2 .av2-dest');
        if (cont) cont.innerHTML = listaPersonasAlerta();
        return;
      }
      repintar();
    }, 180);
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('#admin-v2 tr.js-av2-fila, #admin-v2 tr.js-av2-sa-fila')) { ev.preventDefault(); ev.target.click(); }
  });

  window.SigsoAdmin = {
    abrir: function () {
      var pedida = (window.SigsoShell && SigsoShell.tomarItemDeRuta) ? SigsoShell.tomarItemDeRuta() : '';
      irA(itemDe(pedida) ? pedida : (vista_ || 'SALUD'));
    },
    irAItem: irA,
    registrarArbol: registrarArbol,
    // admin-v2.js (Salud y Cuentas) pregunta si sigue siendo la vista activa antes de pintar.
    vista: function () { return vista_; }
  };
  registrarArbol();
})();
