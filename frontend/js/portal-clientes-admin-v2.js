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
    PERMISO_OTORGADO: ['Permiso otorgado', 'ok'], PERMISO_REVOCADO: ['Permiso quitado', 'alerta']
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
    var ops = [{ id: 'clientes', texto: 'Clientes', icono: 'empresa' }];
    if (d_.puede_otorgar) ops.push({ id: 'permisos', texto: 'Quién administra', icono: 'escudoCheck' });
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Administración · Portal de clientes</span>' +
      '<h1>Portal de clientes</h1><p>Los contratistas de HomePymes piden, mandan documentos y siguen sus trámites desde el teléfono. Aquí decides quién entra, quién los atiende y ves cada ingreso.</p></div>' +
      '<div class="sx2-cabecera__acciones">' + (ops.length > 1 ? U.segmento(ops, vista_, 'js-pc-vista') : '') +
      U.boton({ texto: 'Habilitar un cliente', icono: 'nueva', variante: 'primario', clase: 'js-pc-habilitar' }) + '</div></header>';
  }
  function pintar() {
    if (!raiz_ || !d_) return;
    if (vista_ === 'permisos' && !d_.puede_otorgar) vista_ = 'clientes';
    raiz_.innerHTML = '<div class="sx2 sx2-pagina pc2 pc2-modulo">' + cabecera() + (vista_ === 'permisos' ? vistaPermisos() : vistaClientes()) + '</div>';
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
      '<div class="pc2-barra"><label class="sx2-buscar">' + U.ico('lupa', 16) + '<input class="sx2-input js-pc-buscar" type="search" placeholder="Buscar por nombre o RUT" value="' + txt(filtro_) + '"></label></div>' +
      '<ul class="pc2-lista">' + lista.map(function (c) {
        var rrhh = (c.encargados || []).filter(function (e) { return e.area === 'RRHH'; })[0];
        return '<li><button type="button" class="pc2-fila js-pc-cliente" data-id="' + txt(c.cliente_id) + '">' +
          '<span class="pc2-fila__ico">' + U.ico('empresa', 18) + '</span>' +
          '<span class="pc2-fila__txt"><b>' + txt(c.razon_social) + '</b><small>' + txt(c.rut) + (rrhh ? ' · RR. HH.: ' + txt(rrhh.nombre) : ' · sin encargada de RR. HH.') + '</small></span>' +
          '<span class="pc2-fila__dato"><span><b>' + c.activos + '</b> ' + (c.activos === 1 ? 'activa' : 'activas') + (c.invitados ? ' · ' + c.invitados + (c.invitados === 1 ? ' invitada' : ' invitadas') : '') + '</span><small>' + c.trabajadores + (c.trabajadores === 1 ? ' trabajador' : ' trabajadores') + '</small></span>' +
          '<span class="pc2-fila__dato">Último ingreso<small>' + txt(hace(c.ultimo_ingreso)) + '</small></span>' +
          U.badge(c.habilitado ? 'Habilitado' : 'Deshabilitado', c.habilitado ? 'ok' : 'neutro') +
          U.ico('derecha', 16) + '</button></li>';
      }).join('') + (lista.length ? '' : '<li class="pc2-nada">Nada con «' + txt(filtro_) + '».</li>') + '</ul>' });
  }

  function vistaPermisos() {
    var ps = d_.permisos || [];
    var nombre = {}; (d_.personal || []).forEach(function (p) { nombre[p.email] = p.nombre; });
    return U.card({ titulo: 'Quién administra el portal', icono: 'escudoCheck', cuerpo:
      '<p class="sx2-tenue" style="margin:0 0 12px">Tú (super administrador) siempre. Aquí decides quién más puede habilitar clientes, invitar personas y ver el registro.</p>' +
      '<ul class="pc2-lista">' + (ps.length ? ps.map(function (p) {
        return '<li class="pc2-fila pc2-fila--fija"><span class="pc2-fila__ico">' + U.ico('persona', 18) + '</span><span class="pc2-fila__txt"><b>' + txt(nombre[p.usuario_email] || p.usuario_email) + '</b><small>' + txt(p.usuario_email) + ' · desde ' + txt(fecha(p.fecha)) + '</small></span>' +
          U.boton({ texto: 'Quitar', sm: true, variante: 'fantasma', clase: 'js-pc-quitar-permiso', datos: { email: p.usuario_email } }) + '</li>';
      }).join('') : '<li class="pc2-nada">Por ahora solo tú.</li>') + '</ul>' +
      '<form class="pc2-otorgar js-pc-otorgar" novalidate><select class="sx2-select" name="email" aria-label="Persona"><option value="">Elige a una persona…</option>' +
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
    return (conSelector ? U.campo('Cliente', '<input class="sx2-input" name="buscar_cliente" list="pc-dl-clientes" placeholder="Escribe el nombre o RUT" autocomplete="off">' +
        '<datalist id="pc-dl-clientes">' + (d_.catalogo_clientes || []).filter(function (c) { return !yaTienen[c.cliente_id]; }).map(function (c) { return '<option value="' + txt(c.razon_social + ' · ' + c.rut) + '"></option>'; }).join('') + '</datalist>', 'Sale de la ficha de clientes de SIGSO (' + (d_.catalogo_clientes || []).length + ').') : '') +
      '<label class="pc2-check"><input type="checkbox" name="habilitado"' + (perfil.habilitado !== false ? ' checked' : '') + '> Portal habilitado (si lo apagas, nadie de esta empresa puede entrar)</label>' +
      '<fieldset class="pc2-fs"><legend>Qué tiene contratado</legend>' + (d_.areas || []).map(function (a) {
        return '<label class="pc2-check"><input type="checkbox" name="srv_' + a.clave + '"' + ((perfil.servicios || []).indexOf(a.clave) !== -1 ? ' checked' : '') + '> ' + txt(a.nombre) + '</label>';
      }).join('') + '</fieldset>' +
      '<fieldset class="pc2-fs"><legend>Quién lo atiende en cada área</legend>' + (d_.areas || []).map(function (a) {
        return U.campo(a.nombre, '<select class="sx2-select" name="enc_' + a.clave + '">' + opcionesEncargado(a.clave, sugerida(a.clave)) + '</select>');
      }).join('') + '<p class="sx2-campo__ayuda">Lo que pida el contratista le llega directo a esta persona. Si queda «a la cola del área», lo reparte la jefatura.</p></fieldset>' +
      '<div class="pc2-dos">' + U.campo('Correo de la empresa', '<input class="sx2-input" name="correo" type="email" value="' + txt(perfil.correo || '') + '">') +
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
  function habilitar() {
    U.formulario({ titulo: 'Habilitar un cliente', subtitulo: 'El contratista podrá entrar al portal', ancho: true, boton: 'Habilitar', campos: camposCliente(null, true),
      preparar: function (datos, form) {
        var t = (datos.buscar_cliente || '').toLowerCase();
        var c = (d_.catalogo_clientes || []).filter(function (x) { return (x.razon_social + ' · ' + x.rut).toLowerCase() === t; })[0] ||
          (d_.catalogo_clientes || []).filter(function (x) { return t && (x.razon_social + ' ' + x.rut).toLowerCase().indexOf(t) !== -1; })[0];
        if (!c) return 'Elige el cliente de la lista (escribe su nombre o RUT).';
        return Object.assign({ cliente_id: c.cliente_id }, datosCliente(datos, form));
      },
      enviar: function (x) { return api('portalAdmGuardarCliente', x); },
      aviso: 'Cliente habilitado. Ahora invita a su administrador.',
      listo: function (r) { traer().then(function () { pintar(); abrirCliente(r.data.cliente.cliente_id, 'personas'); }); } });
  }

  // --- Ficha del cliente ------------------------------------------------------------------------
  var fichaId_ = '', fichaTab_ = 'datos', ficha_ = null, drawer_ = null;
  function abrirCliente(id, tab, despues) {
    fichaId_ = id; fichaTab_ = tab || 'personas';
    drawer_ = U.drawer({ titulo: 'Cliente', subtitulo: '', cuerpo: U.esqueleto('tabla', 6), pie: ' ' });
    drawer_.el.classList.add('sx2-drawer--ancho', 'pc2-drawer');
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
    drawer_.cuerpo('<p class="pc2-sub">' + txt(f.cliente.rut) + ' · ' + U.badge(f.perfil.habilitado ? 'Portal habilitado' : 'Portal deshabilitado', f.perfil.habilitado ? 'ok' : 'neutro') + '</p>' +
      '<div class="sx2-tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" class="sx2-tabs__op js-pc-tab" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === fichaTab_) + '">' + txt(t[1]) + '</button>'; }).join('') + '</div>' + cuerpo);
  }
  function fichaPersonas() {
    var f = ficha_;
    return '<div class="pc2-acciones">' + U.boton({ texto: 'Invitar a una persona', icono: 'nueva', variante: 'primario', clase: 'js-pc-invitar' }) + '</div>' +
      '<div class="js-pc-invitacion"></div>' +
      (f.contactos.length ? '<ul class="pc2-lista">' + f.contactos.map(function (c) {
        var e = ESTADO_CONTACTO[c.estado] || [c.estado, 'neutro'];
        return '<li class="pc2-persona"><div class="pc2-persona__cab"><span class="pc2-fila__txt"><b>' + txt(c.nombre) + '</b><small>' + txt(c.rut) + (c.cargo ? ' · ' + txt(c.cargo) : '') + (c.telefono ? ' · ' + txt(c.telefono) : '') + '</small></span>' +
          U.badge(c.rol === 'ADMIN' ? 'Administra la cuenta' : 'Colaborador', 'neutro', true) + U.badge(e[0], e[1]) + '</div>' +
          '<p class="pc2-sub">' + (c.estado === 'INVITADO' ? (c.invitacion_vigente ? 'Invitación vigente: aún no elige su clave.' : 'La invitación venció: mándale una nueva.') : 'Último ingreso: ' + txt(c.ultimo_ingreso ? fecha(c.ultimo_ingreso, true) : 'nunca')) + '</p>' +
          '<div class="pc2-acciones">' +
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
      '<p class="sx2-campo__error js-pc-error" hidden></p><div class="pc2-acciones">' + U.boton({ texto: 'Guardar', icono: 'check', variante: 'primario', tipo: 'submit' }) + '</div></form>' +
      '<p class="pc2-sub">En la ficha de clientes de SIGSO: ' + txt([ficha_.cliente.contacto_ficha, ficha_.cliente.correo_ficha, ficha_.cliente.telefono_ficha].filter(Boolean).join(' · ') || 'sin contacto') + '</p>';
  }
  function fichaObras() {
    var obras = ficha_.obras || [];
    return '<form class="pc2-linea js-pc-form-obra" novalidate>' + U.campo('Nueva obra', '<input class="sx2-input" name="nombre" placeholder="Ej: Los Robles">') +
      U.campo('Comuna', '<input class="sx2-input" name="comuna">') + U.boton({ texto: 'Agregar', icono: 'nueva', tipo: 'submit' }) + '</form>' +
      (obras.length ? '<ul class="pc2-lista">' + obras.map(function (o) {
        var activa = !(o.activa === false || o.activa === 'false');
        return '<li class="pc2-fila pc2-fila--fija"><span class="pc2-fila__ico">' + U.ico('empresa', 18) + '</span><span class="pc2-fila__txt"><b>' + txt(o.nombre) + '</b><small>' + txt([o.comuna, o.direccion].filter(Boolean).join(' · ')) + '</small></span>' +
          U.badge(activa ? 'Activa' : 'Cerrada', activa ? 'ok' : 'neutro') + U.boton({ texto: activa ? 'Cerrar' : 'Reabrir', sm: true, variante: 'fantasma', clase: 'js-pc-obra-activa', datos: { id: o.obra_id, nombre: o.nombre, activa: activa ? '0' : '1' } }) + '</li>';
      }).join('') + '</ul>' : '<p class="pc2-sub">Sin obras. El contratista también puede agregarlas desde su portal.</p>');
  }
  function fichaTrabajadores() {
    var ts = ficha_.trabajadores || [], obras = {}; (ficha_.obras || []).forEach(function (o) { obras[o.obra_id] = o.nombre; });
    return (ts.length ? '<div class="pc2-tabla-caja"><table class="pc2-tabla"><thead><tr><th>Nombre</th><th>RUT</th><th>Cargo</th><th>Obra</th><th>Desde</th><th>Estado</th></tr></thead><tbody>' + ts.map(function (t) {
        var e = ESTADO_TRAB[t.estado] || [t.estado, 'neutro'];
        return '<tr><td><b>' + txt(t.nombre) + '</b></td><td>' + txt(t.rut) + '</td><td>' + txt(t.cargo) + '</td><td>' + txt(obras[t.obra_id] || '') + '</td><td>' + txt(t.fecha_inicio) + '</td><td>' + U.badge(e[0], e[1]) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : U.vacio({ icono: 'equipo', titulo: 'Sin trabajadores', texto: 'Se agregan solos cuando el contratista pide un contrato, o él los registra en «Trabajadores».' })) +
      '<p class="pc2-sub">Son datos personales: solo los ven el contratista y el personal con permiso.</p>';
  }
  function fichaRegistro() {
    var rs = ficha_.registro || [];
    if (!rs.length) return U.vacio({ icono: 'lista', titulo: 'Sin movimientos', texto: 'Cada ingreso y cada acción queda aquí, con fecha y equipo. Nadie lo puede borrar.' });
    return '<ul class="pc2-registro">' + rs.map(function (x) {
      var a = ACCIONES[x.accion] || [x.accion, 'neutro'];
      var quien = x.actor === 'contacto' ? (x.contacto_nombre || 'Contratista') : x.actor;
      return '<li><span class="pc2-registro__cuando">' + txt(fecha(x.timestamp, true)) + '</span>' + U.badge(a[0], a[1]) +
        '<span class="pc2-registro__txt"><b>' + txt(quien) + '</b>' + (x.detalle ? ' · ' + txt(x.detalle) : '') + (x.dispositivo ? ' · ' + txt(x.dispositivo) : '') + (x.ip ? ' · <span class="sx2-tenue">' + txt(x.ip) + '</span>' : '') + '</span></li>';
    }).join('') + '</ul><p class="pc2-sub">Se muestran los últimos 200 movimientos.</p>';
  }

  // --- Invitar -----------------------------------------------------------------------------------
  function mostrarInvitacion(data) {
    var caja = drawer_ && drawer_.el.querySelector('.js-pc-invitacion');
    if (!caja) return;
    caja.innerHTML = '<div class="pc2-invitacion"><h3>' + U.ico('check', 18) + ' Invitación lista para ' + txt(data.contacto.nombre) + '</h3>' +
      '<p>Mándale este mensaje por WhatsApp. El enlace sirve una sola vez y vence el ' + txt(fecha(data.vence, true)) + '.</p>' +
      '<pre class="pc2-mensaje">' + txt(data.mensaje) + '</pre>' +
      '<div class="pc2-acciones">' + (data.con_telefono ? '<a class="sx2-boton sx2-boton--primario" href="' + txt(data.whatsapp) + '" target="_blank" rel="noopener">' + U.ico('comentario', 16) + 'Abrir WhatsApp con el mensaje</a>' : '<span class="sx2-tenue">Sin teléfono válido: copia el mensaje y mándalo tú.</span>') +
        U.boton({ texto: 'Copiar mensaje', icono: 'copiar', clase: 'js-pc-copiar' }) + '</div></div>';
    caja.querySelector('.js-pc-copiar').addEventListener('click', function () {
      var t = data.mensaje;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { aviso('Mensaje copiado.', 'exito'); }, function () {
        var r = document.createRange(); r.selectNodeContents(caja.querySelector('.pc2-mensaje')); var s = getSelection(); s.removeAllRanges(); s.addRange(r); aviso('Selecciónalo y cópialo.');
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
      if ((b = t.closest('.js-pc-vista'))) { vista_ = b.getAttribute('data-id'); pintar(); return; }
      if (t.closest('.js-pc-habilitar')) { habilitar(); return; }
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
    document.addEventListener('input', function (ev) {
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
