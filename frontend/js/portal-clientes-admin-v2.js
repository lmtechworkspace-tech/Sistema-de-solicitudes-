/**
 * portal-clientes-admin-v2.js — Administración del Portal de clientes (2026-10-07;
 * backend/logica/portalClientes.js).
 *
 * La ven el super admin y quien él autorice (la sesión trae
 * `cuenta.portal_clientes === true`; cada acción lo re-verifica). Desde aquí:
 * qué clientes tienen portal y quién los atiende en cada área, invitar a las
 * personas del cliente (enlace de un solo uso, mensaje listo para WhatsApp),
 * bloquear o cerrar sesiones, sus obras y trabajadores, y el registro de
 * ingresos y acciones (evidencia).
 */
(function () {
  'use strict';

  var U = UIv2;
  var ACCIONES = {
    INVITACION: ['Invitación enviada', 'info'], INVITACION_NUEVA: ['Nueva invitación (clave reiniciada)', 'info'], ACTIVACION: ['Eligió su clave', 'ok'],
    INGRESO: ['Entró al portal', 'ok'], INGRESO_FALLIDO: ['Intento fallido', 'alerta'], SALIDA: ['Salió', 'neutro'],
    CLIENTE_HABILITADO: ['Portal habilitado', 'ok'], CLIENTE_EDITADO: ['Datos del cliente', 'info'], OBRA: ['Obra', 'info'],
    TRABAJADOR_NUEVO: ['Trabajador agregado', 'info'], TRABAJADOR_EDITADO: ['Trabajador editado', 'info'],
    CONTACTO_BLOQUEAR: ['Persona bloqueada', 'alerta'], CONTACTO_DESBLOQUEAR: ['Persona desbloqueada', 'ok'], CONTACTO_CERRAR_SESIONES: ['Sesiones cerradas', 'neutro'], CONTACTO_ROL: ['Cambio de rol', 'info'],
    PERMISO_OTORGADO: ['Permiso otorgado', 'ok'], PERMISO_REVOCADO: ['Permiso quitado', 'alerta'],
    BASE_NUEVO: ['Agregado a la base', 'ok'], BASE_EDITADA: ['Base corregida', 'info']
  };
  var ESTADO_CONTACTO = { ACTIVO: ['Activo', 'ok'], INVITADO: ['Invitado', 'info'], BLOQUEADO: ['Bloqueado', 'critico'] };
  var ESTADO_TRAB = { ACTIVO: ['Trabajando', 'ok'], TRAMITE: ['Contrato en trámite', 'alerta'], FINIQUITADO: ['Finiquitado', 'neutro'] };
  var raiz_ = null, d_ = null, vista_ = 'clientes', turno_ = 0, filtro_ = '';

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function aviso(t, tipo) { if (window.Componentes && Componentes.aviso) Componentes.aviso({ texto: t, tipo: tipo || 'info' }); }
  function api(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {}).catch(function (e) { return { ok: false, message: (e && e.message) || 'No se pudo conectar.' }; });
  }
  function fecha(iso, conHora) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return String(iso);
    var f = ('0' + d.getDate()).slice(-2) + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + d.getFullYear();
    return conHora ? f + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) : f;
  }
  function hace(iso) {
    if (!iso) return 'nunca';
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 60) return 'hace ' + Math.max(1, m) + ' min';
    if (m < 1440) return 'hace ' + Math.round(m / 60) + ' h';
    return 'hace ' + Math.round(m / 1440) + ' d';
  }

  function traer() { return api('portalAdmEstado', {}).then(function (r) { d_ = r && r.ok ? r.data : null; if (!d_ && r) d_ = null; return r; }); }
  function cargar() {
    raiz_ = document.getElementById('modulo-portal_clientes');
    if (!raiz_) return;
    enlazar();
    var t = ++turno_;
    raiz_.innerHTML = '<div class="sx2 sx2-pagina pc2">' + U.esqueleto('kpis', 4) + U.esqueleto('tabla', 6) + '</div>';
    traer().then(function (r) {
      if (t !== turno_) return;
      if (!d_) { raiz_.innerHTML = '<div class="sx2 sx2-pagina pc2">' + U.card({ cuerpo: U.vacio({ icono: 'candado', titulo: 'No se pudo abrir el portal de clientes', texto: (r && r.message) || 'Inténtalo de nuevo.' }) }) + '</div>'; return; }
      pintar();
    });
  }
  function cabecera() {
    var ops = [{ id: 'clientes', texto: 'Con portal', icono: 'empresa' }, { id: 'base', texto: 'Base de contratistas', icono: 'tabla' }];
    if (d_.puede_otorgar) ops.push({ id: 'permisos', texto: 'Quién administra', icono: 'escudoCheck' });
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Administración · Portal de clientes</span>' +
      '<h1>Portal de clientes</h1><p>Los contratistas de HomePymes piden, mandan documentos y siguen sus trámites desde el teléfono. Aquí decides quién entra, quién los atiende y ves cada ingreso.</p></div>' +
      '<div class="sx2-cabecera__acciones">' + U.segmento(ops, vista_, 'js-pc-vista') +
      U.boton({ texto: 'Habilitar un cliente', icono: 'nueva', variante: 'primario', clase: 'js-pc-habilitar' }) + '</div></header>';
  }
  function pintar() {
    if (!raiz_ || !d_) return;
    if (vista_ === 'permisos' && !d_.puede_otorgar) vista_ = 'clientes';
    raiz_.innerHTML = '<div class="sx2 sx2-pagina pc2 pcl-modulo">' + cabecera() + (vista_ === 'permisos' ? vistaPermisos() : (vista_ === 'base' ? vistaBase() : vistaClientes())) + '</div>';
    if (vista_ === 'base' && !base_) cargarBase();
    if (U.animar) U.animar(raiz_);
  }

  function vistaClientes() {
    var cs = d_.clientes || [];
    var activos = cs.reduce(function (n, c) { return n + c.activos; }, 0), invitados = cs.reduce(function (n, c) { return n + c.invitados; }, 0), bloqueados = cs.reduce(function (n, c) { return n + c.bloqueados; }, 0);
    var kpis = '<div class="sx2-fila-kpis">' +
      U.kpi({ i: 0, icono: 'empresa', tono: 'primario', etiqueta: 'Clientes con portal', valor: cs.filter(function (c) { return c.habilitado; }).length, unidad: cs.length + ' en total' }) +
      U.kpi({ i: 1, icono: 'equipo', tono: 'ok', etiqueta: 'Personas activas', valor: activos, unidad: 'ya eligieron su clave' }) +
      U.kpi({ i: 2, icono: 'correo', tono: invitados ? 'info' : 'neutro', etiqueta: 'Invitaciones pendientes', valor: invitados, unidad: 'aún no entran' }) +
      U.kpi({ i: 3, icono: 'candado', tono: bloqueados ? 'critico' : 'neutro', etiqueta: 'Bloqueados', valor: bloqueados, unidad: 'por intentos o a mano' }) + '</div>';
    if (!cs.length) {
      return kpis + U.card({ cuerpo: U.vacio({ icono: 'empresa', titulo: 'Aún no hay clientes con portal', texto: 'Toca «Habilitar un cliente», elige la empresa y quién la atiende. Después invitas a su administrador por WhatsApp.',
        accion: U.boton({ texto: 'Habilitar un cliente', icono: 'nueva', variante: 'primario', clase: 'js-pc-habilitar' }) }) });
    }
    var q = filtro_.toLowerCase();
    var lista = cs.filter(function (c) { return !q || (c.razon_social + ' ' + c.rut).toLowerCase().indexOf(q) !== -1; });
    return kpis + U.card({ titulo: 'Clientes', sub: cs.length + '', sinRelleno: true, cuerpo:
      '<div class="pcl-barra"><label class="sx2-buscar">' + U.ico('lupa', 16) + '<input class="sx2-input js-pc-buscar" type="search" placeholder="Buscar por nombre o RUT" value="' + txt(filtro_) + '"></label></div>' +
      '<ul class="pcl-lista">' + lista.map(function (c) {
        var rrhh = (c.encargados || []).filter(function (e) { return e.area === 'RRHH'; })[0];
        return '<li><button type="button" class="pcl-fila js-pc-cliente" data-id="' + txt(c.cliente_id) + '">' +
          '<span class="pcl-fila__ico">' + U.ico('empresa', 18) + '</span>' +
          '<span class="pcl-fila__txt"><b>' + txt(c.razon_social) + '</b><small>' + txt(c.rut) + (rrhh ? ' · RR. HH.: ' + txt(rrhh.nombre) : ' · sin encargada de RR. HH.') + '</small></span>' +
          '<span class="pcl-fila__dato"><span><b>' + c.activos + '</b> ' + (c.activos === 1 ? 'activa' : 'activas') + (c.invitados ? ' · ' + c.invitados + (c.invitados === 1 ? ' invitada' : ' invitadas') : '') + '</span><small>' + c.trabajadores + (c.trabajadores === 1 ? ' trabajador' : ' trabajadores') + '</small></span>' +
          '<span class="pcl-fila__dato">Último ingreso<small>' + txt(hace(c.ultimo_ingreso)) + '</small></span>' +
          U.badge(c.habilitado ? 'Habilitado' : 'Deshabilitado', c.habilitado ? 'ok' : 'neutro') +
          U.ico('derecha', 16) + '</button></li>';
      }).join('') + (lista.length ? '' : '<li class="pcl-nada">Nada con «' + txt(filtro_) + '».</li>') + '</ul>' });
  }

  function vistaPermisos() {
    var ps = d_.permisos || [];
    var nombre = {}; (d_.personal || []).forEach(function (p) { nombre[p.email] = p.nombre; });
    return U.card({ titulo: 'Quién administra el portal', icono: 'escudoCheck', cuerpo:
      '<p class="sx2-tenue" style="margin:0 0 12px">Tú (super administrador) siempre. Aquí decides quién más puede habilitar clientes, invitar personas y ver el registro.</p>' +
      '<ul class="pcl-lista">' + (ps.length ? ps.map(function (p) {
        return '<li class="pcl-fila pcl-fila--fija"><span class="pcl-fila__ico">' + U.ico('persona', 18) + '</span><span class="pcl-fila__txt"><b>' + txt(nombre[p.usuario_email] || p.usuario_email) + '</b><small>' + txt(p.usuario_email) + ' · desde ' + txt(fecha(p.fecha)) + '</small></span>' +
          U.boton({ texto: 'Quitar', sm: true, variante: 'fantasma', clase: 'js-pc-quitar-permiso', datos: { email: p.usuario_email } }) + '</li>';
      }).join('') : '<li class="pcl-nada">Por ahora solo tú.</li>') + '</ul>' +
      '<form class="pcl-otorgar js-pc-otorgar" novalidate><select class="sx2-select" name="email" aria-label="Persona"><option value="">Elige a una persona…</option>' +
        (d_.personal || []).filter(function (p) { return !ps.some(function (x) { return x.usuario_email === p.email; }); }).map(function (p) { return '<option value="' + txt(p.email) + '">' + txt(p.nombre) + ' · ' + txt(p.email) + '</option>'; }).join('') +
      '</select>' + U.boton({ texto: 'Dar permiso', icono: 'check', variante: 'primario', tipo: 'submit' }) + '</form>' });
  }

  // --- Habilitar / datos del cliente ----------------------------------------------------------
  function opcionesEncargado(area, actual) {
    var eq = (d_.equipos || {})[area] || [];
    if (!eq.length) return '<option value="">(el área no tiene equipo cargado)</option>';
    return '<option value="">A la cola del área</option>' + eq.map(function (p) {
      return '<option value="' + txt(p.email) + '"' + (p.email === actual ? ' selected' : '') + '>' + txt(p.nombre) + (p.cargo ? ' · ' + txt(p.cargo) : '') + '</option>';
    }).join('');
  }
  function camposCliente(perfil, conSelector) {
    perfil = perfil || { habilitado: true, servicios: ['RRHH'], encargados: {} };
    var sugerida = function (area) {
      if (perfil.encargados && perfil.encargados[area]) return perfil.encargados[area];
      // Decisión del dueño: en RR. HH. atiende Vanessa en primera instancia.
      if (area === 'RRHH') { var v = ((d_.equipos || {}).RRHH || []).filter(function (p) { return /vanessa/i.test(p.nombre); })[0]; return v ? v.email : ''; }
      return '';
    };
    var yaTienen = {}; (d_.clientes || []).forEach(function (c) { yaTienen[c.cliente_id] = true; });
    // 2026-10-08: el contratista puede no estar en la base de SIGSO: «Es nuevo» lo crea ahí mismo.
    var selector = '<div class="pcl-modo" role="radiogroup" aria-label="¿Está en la base?">' +
        '<label><input type="radio" name="modo" value="base" checked><span>' + U.ico('lupa', 15) + 'Está en la base de SIGSO</span></label>' +
        '<label><input type="radio" name="modo" value="nuevo"><span>' + U.ico('nueva', 15) + 'Es un contratista nuevo</span></label></div>' +
      '<div class="js-pc-modo-base">' + U.campo('Cliente', '<input class="sx2-input" name="buscar_cliente" list="pc-dl-clientes" placeholder="Escribe el nombre o RUT" autocomplete="off">' +
        '<datalist id="pc-dl-clientes">' + (d_.catalogo_clientes || []).filter(function (c) { return !yaTienen[c.cliente_id]; }).map(function (c) { return '<option value="' + txt(c.razon_social + ' · ' + c.rut) + '"></option>'; }).join('') + '</datalist>',
        'Sale de la base de contratistas de SIGSO (' + (d_.catalogo_clientes || []).length + ').') + '<div class="pcl-elegido js-pc-elegido" aria-live="polite"></div></div>' +
      '<div class="js-pc-modo-nuevo pcl-nuevo" hidden><div class="pcl-dos">' +
        U.campo('Razón social', '<input class="sx2-input" name="n_razon_social" maxlength="150" placeholder="Ej: Constructora Los Robles SpA">') +
        U.campo('RUT de la empresa', '<input class="sx2-input" name="n_rut" maxlength="15" placeholder="76.123.456-7">') + '</div><div class="pcl-dos">' +
        U.campo('Código (opcional)', '<input class="sx2-input" name="n_codigo_cliente" maxlength="30" placeholder="Ej: HP-250">') +
        U.campo('Persona de contacto (opcional)', '<input class="sx2-input" name="n_contacto" maxlength="120">') + '</div>' +
        '<p class="sx2-campo__ayuda">Queda en la base de contratistas de SIGSO: también lo verán Control interno, Finanzas y Calidad.</p></div>';
    return (conSelector ? selector : '') +
      '<label class="pcl-check"><input type="checkbox" name="habilitado"' + (perfil.habilitado !== false ? ' checked' : '') + '> Portal habilitado (si lo apagas, nadie de esta empresa puede entrar)</label>' +
      '<fieldset class="pcl-fs"><legend>Qué tiene contratado</legend>' + (d_.areas || []).map(function (a) {
        return '<label class="pcl-check"><input type="checkbox" name="srv_' + a.clave + '"' + ((perfil.servicios || []).indexOf(a.clave) !== -1 ? ' checked' : '') + '> ' + txt(a.nombre) + '</label>';
      }).join('') + '</fieldset>' +
      '<fieldset class="pcl-fs"><legend>Quién lo atiende en cada área</legend>' + (d_.areas || []).map(function (a) {
        return U.campo(a.nombre, '<select class="sx2-select" name="enc_' + a.clave + '">' + opcionesEncargado(a.clave, sugerida(a.clave)) + '</select>');
      }).join('') + '<p class="sx2-campo__ayuda">Lo que pida el contratista le llega directo a esta persona. Si queda «a la cola del área», lo reparte la jefatura.</p></fieldset>' +
      '<div class="pcl-dos">' + U.campo('Correo de la empresa', '<input class="sx2-input" name="correo" type="email" value="' + txt(perfil.correo || '') + '">') +
        U.campo('Teléfono', '<input class="sx2-input" name="telefono" value="' + txt(perfil.telefono || '') + '" placeholder="+56 9 ...">') + '</div>' +
      U.campo('Dirección', '<input class="sx2-input" name="direccion" value="' + txt(perfil.direccion || '') + '">') +
      U.campo('Representante legal', '<input class="sx2-input" name="representante" value="' + txt(perfil.representante || '') + '">') +
      U.campo('Observaciones (solo las ve el personal)', '<textarea class="sx2-input" name="observaciones" maxlength="500">' + txt(perfil.observaciones || '') + '</textarea>');
  }
  function datosCliente(datos, form) {
    var out = { habilitado: form.querySelector('[name=habilitado]').checked, servicios: [], encargados: {},
      correo: datos.correo || '', telefono: datos.telefono || '', direccion: datos.direccion || '', representante: datos.representante || '', observaciones: datos.observaciones || '' };
    (d_.areas || []).forEach(function (a) {
      if (form.querySelector('[name=srv_' + a.clave + ']').checked) out.servicios.push(a.clave);
      if (datos['enc_' + a.clave]) out.encargados[a.clave] = datos['enc_' + a.clave];
    });
    return out;
  }
  // RUT: dígito verificador (módulo 11), igual que el servidor.
  function rutNorm(r) { return String(r || '').replace(/[^0-9kK]/g, '').toUpperCase(); }
  function rutValido(r) {
    var x = rutNorm(r); if (x.length < 2 || x.length > 9 || !/^\d+$/.test(x.slice(0, -1))) return false;
    var cuerpo = x.slice(0, -1), suma = 0, mult = 2;
    for (var i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo[i]) * mult; mult = mult === 7 ? 2 : mult + 1; }
    var resto = 11 - (suma % 11);
    return x.slice(-1) === (resto === 11 ? '0' : (resto === 10 ? 'K' : String(resto)));
  }
  function rutBonito(r) { var x = rutNorm(r); return x.length < 2 ? x : x.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + x.slice(-1); }
  // Exacto: «Razón · RUT» de la lista, la razón social completa o el RUT. Si no, solo cuando un
  // único cliente contiene lo escrito (nunca «el primero que calce»).
  function buscarEnCatalogo(texto, soloExacto) {
    var t = String(texto || '').trim().toLowerCase(), cat = d_.catalogo_clientes || [];
    if (!t) return null;
    var tr = rutNorm(t);
    var exacto = cat.filter(function (x) { return (x.razon_social + ' · ' + x.rut).toLowerCase() === t || String(x.razon_social).toLowerCase() === t; })[0] ||
      (tr.length >= 7 && /^[\d.\-kK\s]+$/.test(t) ? cat.filter(function (x) { return rutNorm(x.rut) === tr; })[0] : null);
    if (exacto || soloExacto) return exacto || null;
    var parecidos = cat.filter(function (x) { return (x.razon_social + ' ' + x.rut).toLowerCase().indexOf(t) !== -1; });
    return parecidos.length === 1 ? parecidos[0] : null;
  }
  function parecidos(texto) {
    var t = String(texto || '').trim().toLowerCase();
    return t ? (d_.catalogo_clientes || []).filter(function (x) { return (x.razon_social + ' ' + x.rut).toLowerCase().indexOf(t) !== -1; }).length : 0;
  }
  function habilitar(preId) {
    var tienePortal = {}; (d_.clientes || []).forEach(function (c) { tienePortal[c.cliente_id] = true; });
    U.formulario({ titulo: 'Habilitar un cliente', subtitulo: 'El contratista podrá entrar al portal', ancho: true, boton: 'Habilitar', campos: camposCliente(null, true),
      alMontar: function (form, d) {
        d.el.classList.add('pcl-drawer');
        var elegido = form.querySelector('.js-pc-elegido'), buscar = form.querySelector('[name=buscar_cliente]');
        var modo = function (m) {
          form.querySelector('[name=modo][value=' + m + ']').checked = true;
          form.querySelector('.js-pc-modo-base').hidden = m !== 'base';
          form.querySelector('.js-pc-modo-nuevo').hidden = m !== 'nuevo';
        };
        // Al elegir uno de la base se traen sus datos de contacto (solo si el campo está vacío).
        var traidos = {};
        var limpiarTraidos = function () {
          Object.keys(traidos).forEach(function (n) { var inp = form.querySelector('[name=' + n + ']'); if (inp && inp.value === traidos[n]) { inp.value = ''; inp.classList.remove('pcl-traido'); } });
          traidos = {};
        };
        var revisar = function () {
          var t = buscar.value.trim(), c = buscarEnCatalogo(t, true);
          limpiarTraidos();
          if (!t) { elegido.innerHTML = ''; return; }
          if (c && tienePortal[c.cliente_id]) {
            elegido.innerHTML = '<span class="pcl-elegido__aviso">' + U.ico('info', 14) + txt(c.razon_social) + ' ya tiene portal.</span>' + U.boton({ texto: 'Abrir su ficha', sm: true, variante: 'fantasma', clase: 'js-pc-cliente', datos: { id: c.cliente_id } });
            return;
          }
          if (c) {
            elegido.innerHTML = '<span class="pcl-elegido__ok">' + U.ico('check', 14) + '<b>' + txt(c.razon_social) + '</b> · ' + txt(c.rut) + '</span>';
            [['correo', 'correo'], ['telefono', 'telefono'], ['direccion', 'direccion'], ['representante', 'representante']].forEach(function (p) {
              var inp = form.querySelector('[name=' + p[0] + ']'); if (inp && !inp.value && c[p[1]]) { inp.value = c[p[1]]; inp.classList.add('pcl-traido'); traidos[p[0]] = c[p[1]]; }
            });
            return;
          }
          var n = parecidos(t);
          if (n) { elegido.innerHTML = '<span class="pcl-elegido__aviso">' + U.ico('lupa', 14) + (n === 1 ? '1 coincide: elígelo de la lista.' : n + ' coinciden: elige uno de la lista.') + '</span>' + U.boton({ texto: 'No está: agregarlo como nuevo', icono: 'nueva', sm: true, variante: 'fantasma', clase: 'js-pc-a-nuevo' }); return; }
          elegido.innerHTML = t.length < 3 ? '' : '<span class="pcl-elegido__aviso">' + U.ico('alerta', 14) + 'No está en la base.</span>' + U.boton({ texto: 'Agregarlo como nuevo', icono: 'nueva', sm: true, clase: 'js-pc-a-nuevo' });
        };
        buscar.addEventListener('input', revisar);
        buscar.addEventListener('change', revisar);
        form.addEventListener('change', function (ev) { if (ev.target.name === 'modo') modo(ev.target.value); });
        form.addEventListener('click', function (ev) {
          if (!ev.target.closest('.js-pc-a-nuevo')) return;
          var t = buscar.value.trim();
          modo('nuevo');
          if (rutNorm(t).length >= 7 && /^[\d.\-kK\s]+$/.test(t)) form.querySelector('[name=n_rut]').value = rutBonito(t); else form.querySelector('[name=n_razon_social]').value = t;
          form.querySelector(rutNorm(t).length >= 7 && /^[\d.\-kK\s]+$/.test(t) ? '[name=n_razon_social]' : '[name=n_rut]').focus();
        });
        form.querySelector('[name=n_rut]').addEventListener('blur', function () { if (this.value.trim()) this.value = rutBonito(this.value); });
        if (preId) {
          var c0 = (d_.catalogo_clientes || []).filter(function (x) { return x.cliente_id === preId; })[0];
          if (c0) { buscar.value = c0.razon_social + ' · ' + c0.rut; revisar(); }
        }
      },
      preparar: function (datos, form) {
        if (datos.modo === 'nuevo') {
          if (!datos.n_razon_social) return 'Escribe la razón social del contratista nuevo.';
          if (!rutValido(datos.n_rut)) return 'El RUT de la empresa no es válido. Revísalo (con su dígito verificador).';
          var ya = (d_.catalogo_clientes || []).filter(function (x) { return rutNorm(x.rut) === rutNorm(datos.n_rut); })[0];
          if (ya) return 'Ese RUT ya está en la base: ' + ya.razon_social + '. Elige «Está en la base de SIGSO» y búscalo.';
          return Object.assign({ nuevo: { razon_social: datos.n_razon_social, rut: datos.n_rut, codigo_cliente: datos.n_codigo_cliente || '', contacto: datos.n_contacto || '' } }, datosCliente(datos, form));
        }
        var c = buscarEnCatalogo(datos.buscar_cliente);
        if (!c) return 'Elige el cliente de la lista, o marca «Es un contratista nuevo».';
        if (tienePortal[c.cliente_id]) return c.razon_social + ' ya tiene portal: ábrelo desde «Con portal».';
        return Object.assign({ cliente_id: c.cliente_id }, datosCliente(datos, form));
      },
      enviar: function (x) { return api('portalAdmGuardarCliente', x); },
      aviso: function (r) { return r.data.cliente.razon_social + ' habilitado. Ahora invita a su administrador.'; },
      listo: function (r) { base_ = null; traer().then(function () { pintar(); abrirCliente(r.data.cliente.cliente_id, 'personas'); }); } });
  }

  // --- Base de contratistas (CAT_CLIENTES, editable) ---------------------------------------------
  // Es la ficha de clientes de TODO SIGSO: se corrige celda a celda (se guarda al salir de
  // la celda), se agrega un contratista nuevo y se da de baja (nunca se borra).
  var base_ = null, baseChip_ = 'todos', baseFiltro_ = '', baseLimite_ = 60, baseCargando_ = false;
  var COLS = [['razon_social', 'Razón social', 220], ['rut', 'RUT', 120], ['codigo_cliente', 'Código', 90], ['contacto', 'Contacto', 150], ['correo', 'Correo', 200],
    ['telefono', 'Teléfono', 130], ['representante_legal', 'Representante legal', 170], ['direccion', 'Dirección', 220]];
  function cargarBase() {
    if (baseCargando_) return; baseCargando_ = true;
    api('portalAdmBase', {}).then(function (r) {
      baseCargando_ = false;
      base_ = r && r.ok ? r.data.contratistas : [];
      if (!(r && r.ok)) aviso((r && r.message) || 'No se pudo abrir la base.', 'error');
      if (vista_ === 'base') pintar();
    });
  }
  function incompleto(c) { return !c.correo || !c.telefono || !c.rut; }
  function filtrarBase() {
    var q = baseFiltro_.trim().toLowerCase(), qr = rutNorm(q);
    return (base_ || []).filter(function (c) {
      if (baseChip_ === 'baja' ? c.activo : !c.activo) return false;
      if (baseChip_ === 'portal' && !c.portal) return false;
      if (baseChip_ === 'sin' && c.portal) return false;
      if (baseChip_ === 'incompletos' && !incompleto(c)) return false;
      if (!q) return true;
      return (c.razon_social + ' ' + c.codigo_cliente + ' ' + c.contacto + ' ' + c.correo).toLowerCase().indexOf(q) !== -1 || (qr.length >= 3 && rutNorm(c.rut).indexOf(qr) !== -1);
    });
  }
  function vistaBase() {
    if (!base_) return U.card({ cuerpo: U.esqueleto('tabla', 8) });
    var act = base_.filter(function (c) { return c.activo; });
    var chips = [['todos', 'Todos', act.length], ['portal', 'Con portal', act.filter(function (c) { return c.portal; }).length], ['sin', 'Sin portal', act.filter(function (c) { return !c.portal; }).length],
      ['incompletos', 'Sin correo o teléfono', act.filter(incompleto).length], ['baja', 'Dados de baja', base_.length - act.length]];
    return U.card({ titulo: 'Base de contratistas', sub: act.length + '', sinRelleno: true, cuerpo:
      '<div class="pcl-base-barra"><label class="sx2-buscar">' + U.ico('lupa', 16) + '<input class="sx2-input js-pc-base-buscar" type="search" placeholder="Buscar por nombre, RUT, código o correo" value="' + txt(baseFiltro_) + '"></label>' +
        '<span class="pcl-base-acc">' + U.boton({ texto: 'Descargar', icono: 'descargar', sm: true, clase: 'js-pc-base-csv', titulo: 'Descargar la base (abre en Excel)' }) +
        U.boton({ texto: 'Contratista nuevo', icono: 'nueva', sm: true, variante: 'primario', clase: 'js-pc-base-nuevo' }) + '</span>' +
        '<div class="pcl-base-chips">' + chips.map(function (c) { return U.chip({ texto: c[1], n: c[2], activo: baseChip_ === c[0], clase: 'js-pc-base-chip', datos: { id: c[0] }, tono: c[0] === 'incompletos' && c[2] ? 'alerta' : '' }); }).join('') + '</div>'  + '</div>' +
      '<p class="pcl-base-ayuda">' + U.ico('editar', 14) + 'Toca una celda y corrígela: se guarda sola al salir (Enter baja a la fila siguiente, Esc deshace). Es la misma ficha de clientes que usan Control interno, Finanzas y Calidad.</p>' +
      '<div class="js-pc-base-tabla">' + tablaBase() + '</div>' });
  }
  function tablaBase() {
    var lista = filtrarBase(), ver = lista.slice(0, baseLimite_);
    if (!lista.length) return '<p class="pcl-nada">' + (baseFiltro_ ? 'Nada con «' + txt(baseFiltro_) + '».' : 'No hay contratistas en este grupo.') + '</p>';
    return '<div class="pcl-base-caja"><table class="pcl-base"><colgroup>' + COLS.map(function (c) { return '<col style="width:' + c[2] + 'px">'; }).join('') + '<col style="width:150px"><col style="width:52px"></colgroup>' +
      '<thead><tr>' + COLS.map(function (c) { return '<th scope="col">' + txt(c[1]) + '</th>'; }).join('') + '<th scope="col">Portal</th><th scope="col"><span class="sx2-oculto-visual">Acciones</span></th></tr></thead><tbody>' +
      ver.map(function (c) {
        return '<tr data-id="' + txt(c.cliente_id) + '"' + (c.activo ? '' : ' class="pcl-base__baja"') + '>' + COLS.map(function (k) {
          return '<td><input class="pcl-celda' + (k[0] === 'rut' ? ' pcl-celda--mono' : '') + '" data-campo="' + k[0] + '" value="' + txt(c[k[0]]) + '" placeholder="' + (k[0] === 'correo' || k[0] === 'telefono' ? 'Falta' : '—') + '" aria-label="' + txt(k[1] + ' de ' + c.razon_social) + '" spellcheck="false"' + (c.activo ? '' : ' readonly') + '></td>';
        }).join('') +
        '<td>' + (c.portal ? U.boton({ texto: c.portal === 'HABILITADO' ? 'Abrir' : 'Deshabilitado', icono: 'derecha', sm: true, variante: 'fantasma', clase: 'js-pc-cliente pcl-base__portal' + (c.portal === 'HABILITADO' ? ' is-on' : ''), datos: { id: c.cliente_id } })
          : (c.activo ? U.boton({ texto: 'Habilitar', icono: 'nueva', sm: true, clase: 'js-pc-habilitar-id', datos: { id: c.cliente_id } }) : '')) + '</td>' +
        '<td>' + U.boton({ soloIcono: true, icono: c.activo ? 'basura' : 'derivar', sm: true, variante: 'fantasma', titulo: c.activo ? 'Dar de baja' : 'Reactivar', clase: 'js-pc-base-activo', datos: { id: c.cliente_id, activo: c.activo ? '0' : '1' } }) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="pcl-base-pie"><span>' + ver.length + ' de ' + lista.length + '</span>' + (lista.length > ver.length ? U.boton({ texto: 'Mostrar ' + Math.min(60, lista.length - ver.length) + ' más', sm: true, clase: 'js-pc-base-mas' }) : '') + '</div>';
  }
  function repintarTablaBase() { var c = raiz_ && raiz_.querySelector('.js-pc-base-tabla'); if (c) c.innerHTML = tablaBase(); }
  function guardarCelda(inp) {
    var tr = inp.closest('tr'), id = tr.getAttribute('data-id'), campo = inp.getAttribute('data-campo');
    var c = (base_ || []).filter(function (x) { return x.cliente_id === id; })[0]; if (!c) return;
    var valor = inp.value.trim();
    if (campo === 'rut' && valor) valor = rutBonito(valor);
    if (valor === String(c[campo] || '')) { inp.value = c[campo] || ''; return; }
    var cambios = {}; cambios[campo] = valor;
    inp.classList.remove('is-ok', 'is-error'); inp.classList.add('is-guardando'); inp.removeAttribute('title');
    api('portalAdmGuardarFicha', { cliente_id: id, cambios: cambios }).then(function (r) {
      inp.classList.remove('is-guardando');
      if (!r || !r.ok) {
        inp.classList.add('is-error'); inp.title = (r && r.message) || 'No se pudo guardar.';
        aviso(c.razon_social + ': ' + ((r && r.message) || 'no se pudo guardar.'), 'error');
        return;
      }
      Object.assign(c, r.data.contratista);
      inp.value = c[campo] || '';
      inp.classList.add('is-ok'); setTimeout(function () { inp.classList.remove('is-ok'); }, 1400);
      // El nombre y el RUT también se usan al habilitar: se refresca el catálogo sin repintar la tabla.
      if (campo === 'razon_social' || campo === 'rut') traer();
    });
  }
  function nuevoEnBase() {
    U.formulario({ titulo: 'Contratista nuevo', subtitulo: 'Se agrega a la base de contratistas de SIGSO', boton: 'Agregar',
      campos: '<div class="pcl-dos">' + U.campo('Razón social', '<input class="sx2-input" name="razon_social" maxlength="150">') + U.campo('RUT', '<input class="sx2-input" name="rut" maxlength="15" placeholder="76.123.456-7">') + '</div>' +
        '<div class="pcl-dos">' + U.campo('Código (opcional)', '<input class="sx2-input" name="codigo_cliente" maxlength="30">') + U.campo('Persona de contacto', '<input class="sx2-input" name="contacto" maxlength="120">') + '</div>' +
        '<div class="pcl-dos">' + U.campo('Correo', '<input class="sx2-input" name="correo" type="email" maxlength="120">') + U.campo('Teléfono', '<input class="sx2-input" name="telefono" maxlength="30" placeholder="+56 9 ...">') + '</div>' +
        U.campo('Representante legal', '<input class="sx2-input" name="representante_legal" maxlength="120">') + U.campo('Dirección', '<input class="sx2-input" name="direccion" maxlength="150">') +
        '<label class="pcl-check"><input type="checkbox" name="y_habilitar" checked> Habilitar también su portal ahora</label>',
      alMontar: function (form, d) { d.el.classList.add('pcl-drawer'); form.querySelector('[name=rut]').addEventListener('blur', function () { if (this.value.trim()) this.value = rutBonito(this.value); }); },
      preparar: function (x, form) {
        if (!x.razon_social) return 'Escribe la razón social.';
        if (!rutValido(x.rut)) return 'El RUT no es válido. Revísalo (con su dígito verificador).';
        var datos = {}; COLS.forEach(function (k) { datos[k[0]] = x[k[0]] || ''; });
        return { datos: datos, y_habilitar: form.querySelector('[name=y_habilitar]').checked };
      },
      enviar: function (x) { return api('portalAdmGuardarFicha', { datos: x.datos }).then(function (r) { if (r) r._habilitar = x.y_habilitar; return r; }); },
      aviso: function (r) { return r.data.contratista.razon_social + ' quedó en la base.'; },
      listo: function (r) {
        var nuevo = r.data.contratista;
        if (base_) base_.push(nuevo);
        baseChip_ = 'todos'; baseFiltro_ = nuevo.razon_social;
        traer().then(function () { pintar(); if (r._habilitar) habilitar(nuevo.cliente_id); });
      } });
  }
  function descargarBase() {
    var lista = filtrarBase();
    var celda = function (v) { v = String(v == null ? '' : v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var filas = [COLS.map(function (k) { return k[1]; }).concat(['Portal', 'Estado'])].concat(lista.map(function (c) {
      return COLS.map(function (k) { return c[k[0]]; }).concat([c.portal === 'HABILITADO' ? 'Habilitado' : (c.portal ? 'Deshabilitado' : 'Sin portal'), c.activo ? 'Activo' : 'Dado de baja']);
    }));
    var blob = new Blob(['﻿' + filas.map(function (f) { return f.map(celda).join(';'); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'base-contratistas-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 30000);
    aviso(lista.length + ' contratistas descargados.', 'exito');
  }

  // --- Ficha del cliente ------------------------------------------------------------------------
  var fichaId_ = '', fichaTab_ = 'datos', ficha_ = null, drawer_ = null;
  function abrirCliente(id, tab, despues) {
    fichaId_ = id; fichaTab_ = tab || 'personas';
    drawer_ = U.drawer({ titulo: 'Cliente', subtitulo: '', cuerpo: U.esqueleto('tabla', 6), pie: ' ' });
    drawer_.el.classList.add('sx2-drawer--ancho', 'pcl-drawer');
    api('portalAdmCliente', { cliente_id: id }).then(function (r) {
      if (!r || !r.ok) { drawer_.cuerpo(U.vacio({ icono: 'alerta', titulo: 'No se pudo abrir', texto: (r && r.message) || '' })); return; }
      ficha_ = r.data; pintarFicha();
      if (despues) despues();
    });
  }
  function recargarFicha(r) {
    if (r && r.ok) { ficha_ = r.data; pintarFicha(); traer().then(function () { if (raiz_ && document.body.contains(raiz_)) pintar(); }); }
    return r;
  }
  function pintarFicha() {
    if (!drawer_ || !ficha_) return;
    var f = ficha_;
    drawer_.el.querySelector('.sx2-drawer__titulo').textContent = f.cliente.razon_social;
    var tabs = [['personas', 'Personas (' + f.contactos.length + ')'], ['datos', 'Datos y encargados'], ['obras', 'Obras (' + f.obras.filter(function (o) { return o.activa !== false && o.activa !== 'false'; }).length + ')'],
      ['trabajadores', 'Trabajadores (' + f.trabajadores.filter(function (t) { return t.estado !== 'FINIQUITADO'; }).length + ')'], ['registro', 'Registro']];
    var cuerpo = fichaTab_ === 'datos' ? fichaDatos() : fichaTab_ === 'obras' ? fichaObras() : fichaTab_ === 'trabajadores' ? fichaTrabajadores() : fichaTab_ === 'registro' ? fichaRegistro() : fichaPersonas();
    drawer_.cuerpo('<p class="pcl-sub">' + txt(f.cliente.rut) + ' · ' + U.badge(f.perfil.habilitado ? 'Portal habilitado' : 'Portal deshabilitado', f.perfil.habilitado ? 'ok' : 'neutro') + '</p>' +
      '<div class="sx2-tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" class="sx2-tabs__op js-pc-tab" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === fichaTab_) + '">' + txt(t[1]) + '</button>'; }).join('') + '</div>' + cuerpo);
  }
  function fichaPersonas() {
    var f = ficha_;
    return '<div class="pcl-acciones">' + U.boton({ texto: 'Invitar a una persona', icono: 'nueva', variante: 'primario', clase: 'js-pc-invitar' }) + '</div>' +
      '<div class="js-pc-invitacion"></div>' +
      (f.contactos.length ? '<ul class="pcl-lista">' + f.contactos.map(function (c) {
        var e = ESTADO_CONTACTO[c.estado] || [c.estado, 'neutro'];
        return '<li class="pcl-persona"><div class="pcl-persona__cab"><span class="pcl-fila__txt"><b>' + txt(c.nombre) + '</b><small>' + txt(c.rut) + (c.cargo ? ' · ' + txt(c.cargo) : '') + (c.telefono ? ' · ' + txt(c.telefono) : '') + '</small></span>' +
          U.badge(c.rol === 'ADMIN' ? 'Administra la cuenta' : 'Colaborador', 'neutro', true) + U.badge(e[0], e[1]) + '</div>' +
          '<p class="pcl-sub">' + (c.estado === 'INVITADO' ? (c.invitacion_vigente ? 'Invitación vigente: aún no elige su clave.' : 'La invitación venció: mándale una nueva.') : 'Último ingreso: ' + txt(c.ultimo_ingreso ? fecha(c.ultimo_ingreso, true) : 'nunca')) + '</p>' +
          '<div class="pcl-acciones">' +
            U.boton({ texto: c.estado === 'ACTIVO' ? 'Nueva clave (reinvitar)' : 'Reenviar invitación', icono: 'correo', sm: true, clase: 'js-pc-reinvitar', datos: { id: c.contacto_id } }) +
            (c.estado === 'BLOQUEADO' ? U.boton({ texto: 'Desbloquear', icono: 'check', sm: true, clase: 'js-pc-op', datos: { id: c.contacto_id, op: 'desbloquear' } })
              : U.boton({ texto: 'Bloquear', icono: 'candado', sm: true, variante: 'fantasma', clase: 'js-pc-op', datos: { id: c.contacto_id, op: 'bloquear' } })) +
            (c.estado === 'ACTIVO' ? U.boton({ texto: 'Cerrar sus sesiones', sm: true, variante: 'fantasma', clase: 'js-pc-op', datos: { id: c.contacto_id, op: 'cerrar_sesiones' } }) : '') +
            U.boton({ texto: c.rol === 'ADMIN' ? 'Pasar a colaborador' : 'Hacer administrador', sm: true, variante: 'fantasma', clase: 'js-pc-op', datos: { id: c.contacto_id, op: 'rol', rol: c.rol === 'ADMIN' ? 'COLABORADOR' : 'ADMIN' } }) +
          '</div></li>';
      }).join('') + '</ul>' : U.vacio({ icono: 'persona', titulo: 'Nadie de esta empresa entra todavía', texto: 'Invita a quien administra la cuenta (en la prueba, la persona de la reunión).' }));
  }
  function fichaDatos() {
    return '<form class="sx2-form js-pc-form-datos" novalidate>' + camposCliente(ficha_.perfil, false) +
      '<p class="sx2-campo__error js-pc-error" hidden></p><div class="pcl-acciones">' + U.boton({ texto: 'Guardar', icono: 'check', variante: 'primario', tipo: 'submit' }) + '</div></form>' +
      '<p class="pcl-sub">En la ficha de clientes de SIGSO: ' + txt([ficha_.cliente.contacto_ficha, ficha_.cliente.correo_ficha, ficha_.cliente.telefono_ficha].filter(Boolean).join(' · ') || 'sin contacto') + '</p>';
  }
  function fichaObras() {
    var obras = ficha_.obras || [];
    return '<form class="pcl-linea js-pc-form-obra" novalidate>' + U.campo('Nueva obra', '<input class="sx2-input" name="nombre" placeholder="Ej: Los Robles">') +
      U.campo('Comuna', '<input class="sx2-input" name="comuna">') + U.boton({ texto: 'Agregar', icono: 'nueva', tipo: 'submit' }) + '</form>' +
      (obras.length ? '<ul class="pcl-lista">' + obras.map(function (o) {
        var activa = !(o.activa === false || o.activa === 'false');
        return '<li class="pcl-fila pcl-fila--fija"><span class="pcl-fila__ico">' + U.ico('empresa', 18) + '</span><span class="pcl-fila__txt"><b>' + txt(o.nombre) + '</b><small>' + txt([o.comuna, o.direccion].filter(Boolean).join(' · ')) + '</small></span>' +
          U.badge(activa ? 'Activa' : 'Cerrada', activa ? 'ok' : 'neutro') + U.boton({ texto: activa ? 'Cerrar' : 'Reabrir', sm: true, variante: 'fantasma', clase: 'js-pc-obra-activa', datos: { id: o.obra_id, nombre: o.nombre, activa: activa ? '0' : '1' } }) + '</li>';
      }).join('') + '</ul>' : '<p class="pcl-sub">Sin obras. El contratista también puede agregarlas desde su portal.</p>');
  }
  function fichaTrabajadores() {
    var ts = ficha_.trabajadores || [], obras = {}; (ficha_.obras || []).forEach(function (o) { obras[o.obra_id] = o.nombre; });
    return (ts.length ? '<div class="pcl-tabla-caja"><table class="pcl-tabla"><thead><tr><th>Nombre</th><th>RUT</th><th>Cargo</th><th>Obra</th><th>Desde</th><th>Estado</th></tr></thead><tbody>' + ts.map(function (t) {
        var e = ESTADO_TRAB[t.estado] || [t.estado, 'neutro'];
        return '<tr><td><b>' + txt(t.nombre) + '</b></td><td>' + txt(t.rut) + '</td><td>' + txt(t.cargo) + '</td><td>' + txt(obras[t.obra_id] || '') + '</td><td>' + txt(t.fecha_inicio) + '</td><td>' + U.badge(e[0], e[1]) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'equipo', titulo: 'Sin trabajadores', texto: 'Se agregan solos cuando el contratista pide un contrato, o él los registra en «Trabajadores».' })) +
      '<p class="pcl-sub">Son datos personales: solo los ven el contratista y el personal con permiso.</p>';
  }
  function fichaRegistro() {
    var rs = ficha_.registro || [];
    if (!rs.length) return U.vacio({ icono: 'lista', titulo: 'Sin movimientos', texto: 'Cada ingreso y cada acción queda aquí, con fecha y equipo. Nadie lo puede borrar.' });
    return '<ul class="pcl-registro">' + rs.map(function (x) {
      var a = ACCIONES[x.accion] || [x.accion, 'neutro'];
      var quien = x.actor === 'contacto' ? (x.contacto_nombre || 'Contratista') : x.actor;
      return '<li><span class="pcl-registro__cuando">' + txt(fecha(x.timestamp, true)) + '</span>' + U.badge(a[0], a[1]) +
        '<span class="pcl-registro__txt"><b>' + txt(quien) + '</b>' + (x.detalle ? ' · ' + txt(x.detalle) : '') + (x.dispositivo ? ' · ' + txt(x.dispositivo) : '') + (x.ip ? ' · <span class="sx2-tenue">' + txt(x.ip) + '</span>' : '') + '</span></li>';
    }).join('') + '</ul><p class="pcl-sub">Se muestran los últimos 200 movimientos.</p>';
  }

  // --- Invitar -----------------------------------------------------------------------------------
  function mostrarInvitacion(data) {
    var caja = drawer_ && drawer_.el.querySelector('.js-pc-invitacion');
    if (!caja) return;
    caja.innerHTML = '<div class="pcl-invitacion"><h3>' + U.ico('check', 18) + ' Invitación lista para ' + txt(data.contacto.nombre) + '</h3>' +
      '<p>Mándale este mensaje por WhatsApp. El enlace sirve una sola vez y vence el ' + txt(fecha(data.vence, true)) + '.</p>' +
      '<pre class="pcl-mensaje">' + txt(data.mensaje) + '</pre>' +
      '<div class="pcl-acciones">' + (data.con_telefono ? '<a class="sx2-boton sx2-boton--primario" href="' + txt(data.whatsapp) + '" target="_blank" rel="noopener">' + U.ico('comentario', 16) + 'Abrir WhatsApp con el mensaje</a>' : '<span class="sx2-tenue">Sin teléfono válido: copia el mensaje y mándalo tú.</span>') +
        U.boton({ texto: 'Copiar mensaje', icono: 'copiar', clase: 'js-pc-copiar' }) + '</div></div>';
    caja.querySelector('.js-pc-copiar').addEventListener('click', function () {
      var t = data.mensaje;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { aviso('Mensaje copiado.', 'exito'); }, function () {
        var r = document.createRange(); r.selectNodeContents(caja.querySelector('.pcl-mensaje')); var s = getSelection(); s.removeAllRanges(); s.addRange(r); aviso('Selecciónalo y cópialo.');
      });
    });
    caja.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function invitar() {
    U.formulario({ titulo: 'Invitar a una persona', subtitulo: ficha_.cliente.razon_social, boton: 'Crear invitación',
      campos: U.campo('Nombre completo', '<input class="sx2-input" name="nombre" maxlength="120">') +
        U.campo('RUT', '<input class="sx2-input" name="rut" placeholder="12.345.678-9">', 'Con este RUT entrará al portal.') +
        U.campo('Teléfono (WhatsApp)', '<input class="sx2-input" name="telefono" placeholder="+56 9 ...">', 'Para mandarle la invitación.') +
        U.campo('Correo (opcional)', '<input class="sx2-input" name="correo" type="email">') +
        U.campo('Cargo (opcional)', '<input class="sx2-input" name="cargo" placeholder="Ej: Dueño, administrativa">') +
        U.campo('Rol', '<select class="sx2-select" name="rol"><option value="ADMIN">Administra la cuenta</option><option value="COLABORADOR">Colaborador</option></select>'),
      preparar: function (x) { if (!x.nombre) return 'Escribe el nombre.'; if (!x.rut) return 'Escribe el RUT.'; return Object.assign({ cliente_id: fichaId_ }, x); },
      enviar: function (x) { return api('portalAdmInvitar', x); },
      // El formulario cerró la ficha (un panel a la vez): se vuelve a abrir con la invitación a la vista.
      listo: function (r) { traer().then(function () { pintar(); }); abrirCliente(fichaId_, 'personas', function () { mostrarInvitacion(r.data); }); } });
  }

  // --- Eventos -----------------------------------------------------------------------------------
  var enlazado_ = false;
  function enlazar() {
    if (enlazado_) return; enlazado_ = true;
    document.addEventListener('click', function (ev) {
      var t = ev.target, b;
      if ((b = t.closest('.js-pc-vista'))) { vista_ = b.getAttribute('data-id'); pintar(); if (vista_ === 'base' && base_) cargarBase(); return; }
      if (t.closest('.js-pc-habilitar')) { habilitar(); return; }
      if ((b = t.closest('.js-pc-habilitar-id'))) { habilitar(b.getAttribute('data-id')); return; }
      if ((b = t.closest('.js-pc-base-chip'))) { baseChip_ = b.getAttribute('data-id'); baseLimite_ = 60; pintar(); return; }
      if (t.closest('.js-pc-base-mas')) { baseLimite_ += 60; repintarTablaBase(); return; }
      if (t.closest('.js-pc-base-nuevo')) { nuevoEnBase(); return; }
      if (t.closest('.js-pc-base-csv')) { descargarBase(); return; }
      if ((b = t.closest('.js-pc-base-activo'))) {
        var idB = b.getAttribute('data-id'), activar = b.getAttribute('data-activo') === '1';
        var cB = (base_ || []).filter(function (x) { return x.cliente_id === idB; })[0];
        var hacerB = function () {
          b.disabled = true;
          api('portalAdmGuardarFicha', { cliente_id: idB, cambios: { activo: activar } }).then(function (r) {
            b.disabled = false;
            if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo.', 'error'); return; }
            Object.assign(cB, r.data.contratista); traer().then(pintar);
            aviso(cB.razon_social + (activar ? ' volvió a la base.' : ' quedó dado de baja.'), 'exito');
          });
        };
        if (activar) hacerB();
        else U.confirmar({ titulo: '¿Dar de baja a ' + (cB ? cB.razon_social : 'este contratista') + '?', texto: 'No se borra: deja de aparecer en las listas de SIGSO y lo puedes reactivar desde «Dados de baja».', boton: 'Dar de baja', peligro: true }).then(function (si) { if (si) hacerB(); });
        return;
      }
      if ((b = t.closest('.js-pc-cliente'))) { abrirCliente(b.getAttribute('data-id')); return; }
      if ((b = t.closest('.js-pc-tab'))) { fichaTab_ = b.getAttribute('data-tab'); pintarFicha(); return; }
      if (t.closest('.js-pc-invitar')) { invitar(); return; }
      if ((b = t.closest('.js-pc-reinvitar'))) {
        b.disabled = true;
        api('portalAdmInvitar', { cliente_id: fichaId_, contacto_id: b.getAttribute('data-id') }).then(function (r) {
          b.disabled = false;
          if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo.', 'error'); return; }
          api('portalAdmCliente', { cliente_id: fichaId_ }).then(function (rr) { recargarFicha(rr); mostrarInvitacion(r.data); });
        });
        return;
      }
      if ((b = t.closest('.js-pc-op'))) {
        var op = b.getAttribute('data-op');
        var hacer = function () {
          b.disabled = true;
          api('portalAdmContacto', { contacto_id: b.getAttribute('data-id'), operacion: op, rol: b.getAttribute('data-rol') || '' }).then(function (r) {
            b.disabled = false;
            if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo.', 'error'); return; }
            recargarFicha(r); aviso('Listo.', 'exito');
          });
        };
        if (op === 'bloquear') U.confirmar({ titulo: '¿Bloquear a esta persona?', texto: 'No podrá entrar al portal hasta que la desbloquees. Se cierran sus sesiones abiertas.', boton: 'Bloquear', peligro: true }).then(function (si) { if (si) hacer(); });
        else hacer();
        return;
      }
      if ((b = t.closest('.js-pc-obra-activa'))) {
        api('portalAdmGuardarObra', { cliente_id: fichaId_, obra_id: b.getAttribute('data-id'), nombre: b.getAttribute('data-nombre'), activa: b.getAttribute('data-activa') === '1' }).then(recargarFicha);
        return;
      }
      if ((b = t.closest('.js-pc-quitar-permiso'))) {
        api('portalAdmPermisos', { operacion: 'revocar', email: b.getAttribute('data-email') }).then(function (r) { if (r && r.ok) { d_ = r.data; pintar(); aviso('Permiso quitado.', 'exito'); } else aviso((r && r.message) || 'No se pudo.', 'error'); });
      }
    });
    // Celdas de la base: se guardan al salir; Enter baja a la fila siguiente; Esc deshace.
    document.addEventListener('change', function (ev) { if (ev.target.classList && ev.target.classList.contains('pcl-celda') && !ev.target.readOnly) guardarCelda(ev.target); });
    document.addEventListener('keydown', function (ev) {
      var inp = ev.target;
      if (!inp.classList || !inp.classList.contains('pcl-celda')) return;
      if (ev.key === 'Enter') {
        ev.preventDefault();
        var tr = inp.closest('tr').nextElementSibling, sig = tr && tr.querySelector('[data-campo="' + inp.getAttribute('data-campo') + '"]');
        if (sig) sig.focus(); else inp.blur();
      } else if (ev.key === 'Escape') {
        var c = (base_ || []).filter(function (x) { return x.cliente_id === inp.closest('tr').getAttribute('data-id'); })[0];
        if (c) inp.value = c[inp.getAttribute('data-campo')] || '';
        inp.classList.remove('is-error'); inp.blur();
      }
    });
    document.addEventListener('focusin', function (ev) { if (ev.target.classList && ev.target.classList.contains('pcl-celda')) { var tr = ev.target.closest('tr'); if (tr) tr.classList.add('is-activa'); if (!ev.target.readOnly) ev.target.select(); } });
    document.addEventListener('focusout', function (ev) { if (ev.target.classList && ev.target.classList.contains('pcl-celda')) { var tr = ev.target.closest('tr'); if (tr) tr.classList.remove('is-activa'); } });
    document.addEventListener('input', function (ev) {
      if (ev.target.classList && ev.target.classList.contains('js-pc-base-buscar')) { baseFiltro_ = ev.target.value; baseLimite_ = 60; repintarTablaBase(); return; }
      if (ev.target.classList && ev.target.classList.contains('js-pc-buscar')) {
        filtro_ = ev.target.value; var pos = ev.target.selectionStart; pintar();
        var i = raiz_.querySelector('.js-pc-buscar'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) { /* tipo search */ } }
      }
    });
    document.addEventListener('submit', function (ev) {
      var f = ev.target;
      if (f.classList.contains('js-pc-form-datos')) {
        ev.preventDefault();
        var datos = {}; new FormData(f).forEach(function (v, k) { if (typeof v === 'string') datos[k] = v.trim(); });
        var err = f.querySelector('.js-pc-error'); err.hidden = true;
        api('portalAdmGuardarCliente', Object.assign({ cliente_id: fichaId_ }, datosCliente(datos, f))).then(function (r) {
          if (!r || !r.ok) { err.textContent = (r && r.message) || 'No se pudo guardar.'; err.hidden = false; return; }
          recargarFicha(r); aviso('Datos guardados.', 'exito');
        });
      } else if (f.classList.contains('js-pc-form-obra')) {
        ev.preventDefault();
        var n = f.nombre.value.trim(); if (!n) return;
        api('portalAdmGuardarObra', { cliente_id: fichaId_, nombre: n, comuna: f.comuna.value.trim() }).then(function (r) { if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo.', 'error'); return; } recargarFicha(r); });
      } else if (f.classList.contains('js-pc-otorgar')) {
        ev.preventDefault();
        var email = f.email.value; if (!email) return;
        api('portalAdmPermisos', { operacion: 'otorgar', email: email }).then(function (r) { if (r && r.ok) { d_ = r.data; pintar(); aviso('Permiso otorgado.', 'exito'); } else aviso((r && r.message) || 'No se pudo.', 'error'); });
      }
    });
  }

  window.SigsoPortalClientesAdmin = { cargar: cargar };
})();
