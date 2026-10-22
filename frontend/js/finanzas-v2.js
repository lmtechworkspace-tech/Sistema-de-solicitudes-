/**
 * finanzas-v2.js — marco del módulo Finanzas (la bóveda). Etapa 1 del
 * 2026-10-06; navegación por tareas de la versión 2 del 2026-10-20 (FIN-31,
 * FIN-32, FIN-33, FIN-42; backend/logica/finanzasBoveda.js).
 *
 * Solo lo ven las cuentas de la lista fija del servidor (la sesión trae
 * `cuenta.finanzas === true`). Pantallas propias:
 *  - Registrar el autenticador (primera vez): contraseña de SIGSO → código
 *    QR / clave para Google Authenticator → primer código.
 *  - Bóveda cerrada: 6 dígitos del autenticador.
 *  - Seguridad y bitácora.
 *
 * Navegación (v2): seis áreas de trabajo (Trabajo diario, Clientes, Bancos,
 * Planificación, Informes, Cierre) y Configuración, cada una con sus
 * subvistas. Cada vista vive en su archivo (finanzas-*-v2.js) y recibe un
 * contexto común: api, pagina, cab, turno/vigente, ir, el catálogo único
 * (empresas, conceptos, clientes, capacidades…), `puede(capacidad)` y el
 * contexto de trabajo compartido (empresa, período, cuenta) que se recuerda
 * en la pestaña — nunca montos ni clientes en el navegador — y se borra al
 * cerrar la bóveda.
 *
 * Los botones que piden una capacidad llevan data-cap="…": si la persona no
 * la tiene, se ocultan (el servidor igual lo rechaza: ocultar no basta).
 */
(function () {
  'use strict';

  var U = UIv2;
  var LLAVE_TOKEN = 'sigso_fin_boveda';
  var LLAVE_EQUIPO = 'sigso_fin_equipo';
  var LLAVE_CONTEXTO = 'sigso_fin_contexto';
  var QR_SRC = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  var QR_SRI = 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k';
  var raiz_ = null, vista_ = 'planilla', turno_ = 0, reloj_ = null, ultimoUso_ = 0, inactividadMin_ = 15;
  var cat_ = null, catP_ = null, observador_ = null;

  // ---- Áreas y subvistas (FIN-31) ----------------------------------------------------------
  // v3 «banco primero» (21-10-2026): cinco áreas. El libro del banco es la tabla principal (como el Excel BANCOS);
  // el registro paralelo, la conciliación aparte, Pendientes y Planificación se retiraron (sus rutas llevan a su reemplazo).
  // v4 (22-10-2026): la planilla del banco al centro, como el Excel BANCOS, y los tres reportes que el equipo usa
  // (FLUJO, saldo por cliente y cobranza). Lo demás queda en «Más». El mes, el libro y los fondos se reemplazaron.
  var AREAS = [
    { id: 'planilla', texto: 'Planilla', icono: 'tabla', vistas: [['planilla', 'Planilla del banco']] },
    { id: 'informe', texto: 'Informes', icono: 'dona', vistas: [['informe', 'Informes']] },
    { id: 'flujo', texto: 'FLUJO', icono: 'grafico', vistas: [['flujo', 'FLUJO']] },
    { id: 'saldos', texto: 'Saldo por cliente', icono: 'equipo', vistas: [['saldos', 'Saldo por cliente']] },
    { id: 'cobros', texto: 'Cobranza', icono: 'recibo', vistas: [['cobros', 'Cobranza']] },
    { id: 'mas', texto: 'Más', icono: 'ajustes', vistas: [['cargas', 'Subir archivos'], ['cierre', 'Cierre de meses'], ['clientes', 'Fichas de clientes'], ['cobranza', 'Aplicar pagos a facturas'],
      ['tablero', 'Informe del mes (PDF)'], ['presupuesto', 'Presupuesto'], ['exportar', 'Exportar'], ['bancos', 'Cuentas del banco'], ['catalogos', 'Catálogos'], ['reglas', 'Nombres y reglas'], ['inicio', 'Seguridad'], ['bitacora', 'Bitácora']] }
  ];
  var RETIRADAS = { mes: 'planilla', libro: 'planilla', registro: 'planilla', movimientos: 'planilla', conciliacion: 'planilla', pendientes: 'planilla', fondos: 'saldos',
    gastos: 'flujo', prestamos: 'flujo', proyectos: 'flujo', provisiones: 'flujo', proyeccion: 'flujo', migracion: 'cargas' };
  function vistaValida(v) { return AREAS.some(function (a) { return a.vistas.some(function (x) { return x[0] === v; }); }); }
  function nombreVista(v) { for (var i = 0; i < AREAS.length; i++) for (var j = 0; j < AREAS[i].vistas.length; j++) if (AREAS[i].vistas[j][0] === v) return AREAS[i].vistas[j][1]; return ''; }
  /**
   * I08.2 · La navegación del módulo vive en la segunda columna de SIGSO (la misma
   * de los demás módulos): un bloque por área y sus pantallas. Arriba ya no se
   * repite el menú. Cada pantalla abre la misma implementación venga de donde venga.
   */
  function registrarArbol() {
    if (!window.SigsoNav) return;
    SigsoNav.registrar('finanzas', { nombre: 'Finanzas', submodulos: AREAS.map(function (a) {
      return { id: a.id, nombre: a.texto, icono: a.icono, plano: a.vistas.length === 1 ? true : undefined, items: a.vistas.map(function (v) { return { id: v[0], nombre: v[1] }; }) };
    }) });
  }
  registrarArbol();
  // La última pantalla válida (solo su nombre: nada sensible) para volver a ella al abrir la bóveda.
  var LLAVE_VISTA = 'sigso_fin_vista';
  var vistaPedida_ = '';
  function recordarVista(v) { try { sessionStorage.setItem(LLAVE_VISTA, v); } catch (e) { /* sin storage */ } }
  function vistaRecordada() { try { var v = sessionStorage.getItem(LLAVE_VISTA) || ''; return vistaValida(v) ? v : ''; } catch (e) { return ''; } }
  function publicar() {
    recordarVista(vista_);
    if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(vista_);
  }
  function areaDe(vista) { for (var i = 0; i < AREAS.length; i++) for (var j = 0; j < AREAS[i].vistas.length; j++) if (AREAS[i].vistas[j][0] === vista) return AREAS[i]; return AREAS[0]; }
  var TITULOS_ = {
    inicio: ['Seguridad de la bóveda', 'Quién tiene acceso, las capas de protección y los últimos ingresos.'],
    mes: ['El mes, paso a paso', 'Qué toca ahora y qué falta para dejar listo el mes, con sus fechas.'],
    // I08.1: sin bajada repetida en la pantalla más usada (la explicación vive en el manual): las filas suben.
    registro: ['Registro diario', ''],
    planilla: ['Planilla del banco', 'Se llena como el Excel BANCOS. El resumen, el FLUJO, los saldos por cliente y la cobranza salen solos.'],
    saldos: ['Saldo por cliente', 'Cuánta dinero de cada cliente hay en la cuenta, sus honorarios y lo que debe en facturas.'],
    cobros: ['Cobranza', 'Las facturas, lo pagado según la planilla y lo que falta cobrar.'],
    informe: ['Informes', 'Lo que dicen los datos de la planilla: el mes en una frase, sus cifras clave explicadas, lo crítico y la verificación con la cartola. O compara un período de meses.'],
    flujo: ['FLUJO', 'Ingresos y egresos por plan de cuenta, mes a mes, como las hojas FLUJO de SIGECO.'],
    libro: ['Libro del banco', 'La planilla BANCOS dentro de SIGSO: se anota cada movimiento y, al subir la cartola, SIGSO lo comprueba con el banco.'],
    pendientes: ['Pendientes', 'Lo que falta resolver en todo Finanzas; cada fila abre dónde se resuelve.'],
    tablero: ['Resumen financiero', 'El mes en 30 segundos, con su comparación, su calidad y lo que conviene revisar.'],
    exportar: ['Exportar', 'Descarga los datos en Excel o CSV, con su corte y su estado.'],
    bitacora: ['Bitácora de accesos', 'Todo lo que se hace en la bóveda, en orden y encadenado.'],
    bancos: ['Cuentas bancarias', 'Saldos, cartolas cargadas y el dinero de clientes en cada cuenta.'],
    cargas: ['Centro de cargas', 'Sube una cartola, el detalle del banco, el Excel BANCOS o la planilla SIGECO: el sistema reconoce qué es.'],
    movimientos: ['Movimientos del banco', 'Revisa lo que el sistema propone; lo que corriges, lo aprende.'],
    conciliacion: ['Conciliación', 'Une lo registrado con lo que dice el banco, sin contar dos veces.'],
    clientes: ['Clientes', 'Ficha comercial, servicios, documentos, cobranza y fondos de cada cliente.'],
    fondos: ['Fondos de clientes', 'El dinero que los clientes mandan para sus obligaciones: por cliente y por gestión.'],
    cobranza: ['Cobranza', 'Lo que falta cobrar y desde hace cuánto; cada abono se aplica a sus facturas.'],
    presupuesto: ['Presupuesto', 'Lo presupuestado y aprobado contra lo real, en la misma base.'],
    gastos: ['Gastos compartidos', 'Un pago repartido entre empresas del grupo, sin crear pesos.'],
    prestamos: ['Préstamos entre empresas', 'Desembolsos, devoluciones y saldo, contando cada préstamo una vez.'],
    proyectos: ['Proyectos', 'Inversión prevista y real, ingresos atribuidos y recuperación.'],
    provisiones: ['Provisiones', 'Vacaciones y años de servicio: se registran sin mover caja.'],
    proyeccion: ['Compromisos y proyección', 'Lo que viene: confirmado, recurrente y estimado, con sus supuestos.'],
    cierre: ['Revisión del período', 'El mes elegido: qué bloquea el cierre, el siguiente paso y sus versiones.'],
    catalogos: ['Catálogos', 'Empresas, conceptos, medios, canales, vendedores y parámetros, sin listas repetidas.'],
    reglas: ['Reglas aprendidas', 'Lo que el sistema aprendió de glosas, pagadores y nombres cortos, con su impacto.'],
    migracion: ['Planillas anteriores', 'Lo que se cargó de SIGECO y del Excel BANCOS, fila por fila y dónde quedó.']
  };
  var NOMBRES_ACCION = {
    ENTRAR: ['Abrió la bóveda', 'ok'], SALIR: ['Cerró la bóveda', 'neutro'], VER_BITACORA: ['Revisó la bitácora', 'info'],
    CODIGO_INCORRECTO: ['Código incorrecto', 'alerta'], AUTENTICADOR_PREPARADO: ['Generó la clave del autenticador', 'info'],
    AUTENTICADOR_ACTIVADO: ['Activó su autenticador', 'ok'], AUTENTICADOR_CLAVE_INCORRECTA: ['Contraseña incorrecta al registrar', 'alerta'],
    AUTENTICADOR_REINICIADO: ['Autenticador reiniciado en el servidor', 'alerta'],
    VER_TABLERO: ['Vio el resumen', 'info'], DESCARGAR_INFORME: ['Descargó el informe en PDF', 'alerta'],
    VER_MOVIMIENTOS: ['Vio los movimientos', 'info'], CUENTA_NUEVA: ['Agregó una cuenta bancaria', 'info'],
    IMPORTAR_CARTOLA: ['Subió una cartola', 'ok'], CLASIFICAR: ['Clasificó movimientos', 'ok'], APRENDER_PLANILLA: ['Aprendió de la planilla SIGECO', 'ok'],
    VER_COBRANZA: ['Vio la cobranza', 'info'], VER_FICHA_CLIENTE: ['Vio la cobranza de un cliente', 'info'], VER_CLIENTE: ['Vio la ficha de un cliente', 'info'],
    IMPORTAR_VENTAS_SII: ['Subió ventas del SII', 'ok'], IMPORTAR_FACTURAS_PLANILLA: ['Trajo facturas de la planilla', 'ok'],
    FACTURA_ANULADA: ['Anuló una factura', 'alerta'], FACTURA_INCOBRABLE: ['Marcó una factura incobrable', 'alerta'], FACTURA_VIGENTE: ['Reactivó una factura', 'info'], FACTURA_EDITAR: ['Editó una factura', 'info'],
    VER_PRESUPUESTO: ['Vio el presupuesto', 'info'], GUARDAR_PRESUPUESTO: ['Guardó un borrador del presupuesto', 'ok'], APROBAR_PRESUPUESTO: ['Aprobó el presupuesto', 'ok'],
    VER_CIERRE: ['Vio el cierre', 'info'], CERRAR_MES: ['Cerró un mes', 'ok'], REABRIR_MES: ['Reabrió un mes', 'alerta'], CIERRE_A_REVISION: ['Envió un mes a revisión', 'info'],
    CIERRE_OBSERVADO: ['Devolvió un mes con observaciones', 'alerta'], CIERRE_OBSERVACION_RESUELTA: ['Resolvió una observación', 'ok'], CIERRE_EXCEPCION: ['Registró una excepción de cierre', 'alerta'],
    PARALELO_PLANILLA: ['Comparó con la planilla SIGECO', 'info'], RETIRO_PASO: ['Marcó un paso del retiro', 'info'],
    IMPORTAR_DETALLE: ['Subió el detalle del banco', 'ok'], GUARDAR_NOMBRES: ['Enseñó nombres del Excel BANCOS', 'ok'],
    APRENDER_EXCEL_BANCOS: ['Aprendió del Excel BANCOS', 'ok'], OPERACION_CONFIRMAR: ['Confirmó una operación', 'ok'], OPERACION_CORREGIR: ['Corrigió una operación', 'info'], OPERACION_ANULAR: ['Anuló una operación', 'alerta'],
    OPERACIONES_CONFIRMAR: ['Confirmó operaciones en lote', 'ok'], OPERACIONES_ANULAR: ['Anuló operaciones en lote', 'alerta'], OPERACIONES_DESCARTAR: ['Descartó borradores', 'info'], OPERACIONES_CAMBIAR: ['Cambió operaciones en lote', 'info'],
    PEGADO_PUBLICAR: ['Publicó filas pegadas', 'ok'], PLANTILLAS_GENERAR: ['Generó borradores desde plantillas', 'info'], VER_OPERACIONES: ['Vio el registro', 'info'],
    CONCILIAR: ['Concilió con el banco', 'ok'], DESCONCILIAR: ['Deshizo una conciliación', 'alerta'], VER_CONCILIACION: ['Vio la conciliación', 'info'],
    GESTION_NUEVA: ['Creó una gestión de fondos', 'ok'], GESTION_EDITAR: ['Editó una gestión de fondos', 'info'], GESTION_ASIGNAR: ['Asignó fondos a una gestión', 'ok'], GESTION_REMANENTE: ['Decidió un remanente', 'info'],
    APERTURA_PROPUESTA: ['Propuso un saldo inicial', 'info'], APERTURA_APROBADA: ['Aprobó un saldo inicial', 'ok'], APERTURA_ANULADA: ['Anuló un saldo inicial', 'alerta'], FONDOS_REASIGNAR: ['Reasignó fondos', 'info'],
    APLICAR_ABONO: ['Aplicó un abono a facturas', 'ok'], DESAPLICAR_ABONO: ['Desaplicó un abono', 'alerta'], APLICAR_SUGERIDAS: ['Aceptó aplicaciones sugeridas', 'ok'], RELACION_COBRO: ['Autorizó un cobro por terceros', 'alerta'],
    EXPORTAR_MOVIMIENTOS: ['Exportó movimientos', 'alerta'], EXPORTAR_OPERACIONES: ['Exportó operaciones', 'alerta'], EXPORTAR_CARTERA: ['Exportó la cartera', 'alerta'], EXPORTAR_FONDOS: ['Exportó fondos', 'alerta'],
    EXPORTAR_APLICACIONES: ['Exportó aplicaciones', 'alerta'], EXPORTAR_PRESUPUESTO: ['Exportó el presupuesto', 'alerta'], EXPORTAR_INFORME: ['Exportó el informe', 'alerta'],
    CARGA_LIBRO: ['Cargó una planilla anterior', 'info'], MIGRAR_HOJA: ['Publicó una hoja de la planilla', 'ok'], REGLA_EDITAR: ['Editó una regla', 'info'], REGLA_DESACTIVAR: ['Desactivó una regla', 'alerta'],
    PAGADOR_EDITAR: ['Editó un pagador', 'info'], ALIAS_EDITAR: ['Editó un nombre corto', 'info'], CATALOGO_NUEVO: ['Agregó a un catálogo', 'info'], CATALOGO_EDITAR: ['Editó un catálogo', 'info']
  };

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function token() { try { return sessionStorage.getItem(LLAVE_TOKEN) || ''; } catch (e) { return ''; } }
  function guardarToken(t) { try { if (t) sessionStorage.setItem(LLAVE_TOKEN, t); else sessionStorage.removeItem(LLAVE_TOKEN); } catch (e) { /* sin storage */ } }
  function equipo() {
    try {
      var e = localStorage.getItem(LLAVE_EQUIPO);
      if (!e) { e = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^\w-]/g, ''); localStorage.setItem(LLAVE_EQUIPO, e); }
      return e;
    } catch (err) { return 'sin-almacenamiento'; }
  }
  // Contexto de trabajo compartido entre vistas (FIN-09/33): solo empresa, período, cuenta y filtros. Sin montos.
  function contexto(cambios) {
    var c = {};
    try { c = JSON.parse(sessionStorage.getItem(LLAVE_CONTEXTO) || '{}') || {}; } catch (e) { c = {}; }
    if (cambios) {
      Object.keys(cambios).forEach(function (k) { if (cambios[k] === undefined || cambios[k] === null || cambios[k] === '') delete c[k]; else c[k] = cambios[k]; });
      try { sessionStorage.setItem(LLAVE_CONTEXTO, JSON.stringify(c)); } catch (e) { /* sin storage */ }
    }
    return c;
  }
  function limpiarSesion() {
    guardarToken(''); cat_ = null; catP_ = null;
    try { sessionStorage.removeItem(LLAVE_CONTEXTO); } catch (e) { /* nada */ }
    var d = document.querySelector('.sx2-drawer'); if (d && d.parentNode) d.parentNode.removeChild(d);
    document.body.classList.remove('sx2-con-drawer');
  }
  function api(accion, datos) {
    var d = Object.assign({ equipo: equipo(), boveda_token: token() }, datos || {});
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, d).then(function (r) {
      if (r && r.boveda_cerrada) { limpiarSesion(); detenerReloj(); pintarCerrada('La bóveda se cerró por seguridad. Ingresa tu código de nuevo.'); }
      else if (r && r.ok) ultimoUso_ = Date.now();
      return r;
    }).catch(function (e) {
      // I08: un corte de red llega del navegador en inglés («Failed to fetch»): se dice en palabras de la oficina.
      var m = (e && e.message) || '';
      return { ok: false, message: (!m || /fetch|network|load failed/i.test(m)) ? 'No hay conexión con el servidor. Revisa tu internet y vuelve a abrir la pantalla.' : m };
    });
  }
  /** Catálogo único (empresas, conceptos, clientes, capacidades…): una vez por sesión de bóveda. */
  function catalogo(forzar) {
    if (cat_ && !forzar) return Promise.resolve(cat_);
    if (catP_ && !forzar) return catP_;
    catP_ = api('finanzasCatalogo').then(function (r) { catP_ = null; if (r && r.ok) { cat_ = r.data; aplicarCapacidades(raiz_); } return cat_; });
    return catP_;
  }
  function puede(cap) { return !!(cat_ && (cat_.capacidades || []).indexOf(cap) !== -1); }
  /** Oculta lo que la persona no puede hacer (data-cap). El servidor lo rechaza igual. */
  function aplicarCapacidades(el) {
    if (!el || !cat_) return;
    Array.prototype.forEach.call(el.querySelectorAll('[data-cap]'), function (n) {
      var ok = String(n.getAttribute('data-cap')).split('|').some(function (c) { return puede(c); });
      if (!ok) { n.hidden = true; n.setAttribute('aria-hidden', 'true'); }
    });
  }
  function fechaHora(iso) {
    if (!iso) return '';
    return new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  }
  function pagina(html) {
    if (!raiz_) return;
    raiz_.innerHTML = '<div class="sx2 sx2-pagina fin2">' + html + '</div>';
    aplicarCapacidades(raiz_);
  }
  function cab(titulo, sub, acciones, migas) {
    var volver = contexto().volver_a;
    var enlaceVolver = volver && volver !== vista_ && vistaValida(volver) ? '<button type="button" class="sx2-enlace fin2-volver js-fin-volver" data-v="' + txt(volver) + '">← Volver a ' + txt(nombreVista(volver)) + '</button>' : '';
    return '<header class="sx2-cabecera sx2-entra"><div class="sx2-cabecera__txt"><span class="sx2-cabecera__migas">Finanzas' + (migas ? ' › ' + txt(migas) : '') + '</span>' + enlaceVolver + '<h1>' + txt(titulo) + '</h1>' +
      (sub ? '<p>' + txt(sub) + '</p>' : '') + '</div><div class="sx2-cabecera__acciones">' + (acciones || '') + '</div></header>';
  }
  function aviso(msg, tipo) {
    // Componentes.aviso conoce exito | error | info: «alerta» se muestra como info.
    if (window.Componentes && Componentes.aviso) { Componentes.aviso({ texto: msg, tipo: tipo === 'exito' || tipo === 'error' ? tipo : 'info' }); return; }
    var el = document.getElementById('fin2-toast');
    if (!el) { el = document.createElement('div'); el.id = 'fin2-toast'; el.className = 'fin2-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('fin2-toast--on');
    clearTimeout(el._t); el._t = setTimeout(function () { el.classList.remove('fin2-toast--on'); }, 4500);
  }

  // --- Carga ---------------------------------------------------------------------------------
  function cargar() {
    raiz_ = document.getElementById('modulo-finanzas');
    if (!raiz_) return;
    enlazar();
    registrarArbol();
    var pedida = (window.SigsoShell && SigsoShell.tomarItemDeRuta) ? SigsoShell.tomarItemDeRuta() : '';
    if (vistaValida(pedida)) { vista_ = pedida; vistaPedida_ = pedida; }
    else if (!vistaPedida_ && vistaRecordada()) { vista_ = vistaRecordada(); vistaPedida_ = vista_; }
    var t = ++turno_;
    pagina(U.esqueleto('tarjetas', 3));
    api('finanzasEstado').then(function (r) {
      if (t !== turno_) return;
      if (!r || !r.ok) { pagina(U.card({ cuerpo: U.vacio({ icono: 'candado', titulo: 'No se pudo abrir Finanzas', texto: (r && r.message) || 'Inténtalo de nuevo.' }) })); return; }
      var e = r.data;
      inactividadMin_ = e.inactividad_min || 15;
      if (!e.llave_configurada) return pintarSinLlave();
      if (!e.autenticador_activo) return pintarRegistro();
      if (!e.sesion_activa) { limpiarSesion(); return pintarCerrada(''); }
      abrir();
    });
  }
  function refrescar() { if (token()) abrir(); else cargar(); }

  function pintarSinLlave() {
    pagina(cab('Bóveda en preparación') + U.card({ cuerpo: U.vacio({ icono: 'llave', titulo: 'Falta la llave de la bóveda en el servidor',
      texto: 'Los datos de Finanzas se guardan cifrados con una llave que solo existe en el servidor. Cuando se configure, aquí podrás registrar tu autenticador.' }) }));
  }

  // --- Candado (6 dígitos) --------------------------------------------------------------------
  function casillas(id) {
    var h = '<div class="fin2-digitos" id="' + id + '" role="group" aria-label="Código de 6 dígitos">';
    for (var i = 0; i < 6; i++) h += '<input class="fin2-digito" inputmode="numeric" autocomplete="one-time-code" aria-label="Dígito ' + (i + 1) + '" data-i="' + i + '">';
    return h + '</div>';
  }
  function leerCasillas(id) { return Array.prototype.map.call(document.querySelectorAll('#' + id + ' .fin2-digito'), function (i) { return i.value; }).join(''); }
  function limpiarCasillas(id) { var c = document.querySelectorAll('#' + id + ' .fin2-digito'); Array.prototype.forEach.call(c, function (i) { i.value = ''; }); if (c[0]) c[0].focus(); }

  function pintarCerrada(aviso_) {
    // I12.4: antes de ocultar todo, cada módulo rescata lo no guardado (en memoria) y olvida las cifras cargadas.
    try { document.dispatchEvent(new CustomEvent('sigso-fin-cerrada')); } catch (e) { /* sin eventos */ }
    cat_ = null; catP_ = null;
    pagina(
      '<div class="fin2-candado">' +
        '<div class="fin2-candado__aura" aria-hidden="true"></div>' +
        '<div class="fin2-candado__caja sx2-entra">' +
          '<span class="fin2-candado__ico">' + U.ico('candado', 30) + '</span>' +
          '<h1>Bóveda de Finanzas</h1>' +
          '<p class="fin2-candado__txt">Escribe el código de 6 dígitos que muestra Google Authenticator en tu teléfono.</p>' +
          (aviso_ ? '<p class="fin2-aviso">' + txt(aviso_) + '</p>' : '') +
          '<form class="js-fin-entrar">' + casillas('fin-cod') +
            '<p class="fin2-error" id="fin-err" role="alert"></p>' +
            U.boton({ texto: 'Abrir bóveda', icono: 'llave', variante: 'primario', tipo: 'submit', clase: 'fin2-ancho' }) +
          '</form>' +
          '<p class="fin2-pie">' + U.ico('escudo', 14) + ' Solo las personas autorizadas tienen acceso. Cada ingreso queda registrado.</p>' +
        '</div>' +
      '</div>');
    setTimeout(function () { var p = document.querySelector('#fin-cod .fin2-digito'); if (p) p.focus(); }, 60);
  }

  // --- Registro del autenticador -----------------------------------------------------------
  function pintarRegistro() {
    pagina(cab('Activa tu acceso a la bóveda', 'Una sola vez. Necesitas tu teléfono con Google Authenticator instalado.') +
      '<ol class="fin2-pasos">' +
        '<li class="fin2-paso fin2-paso--activo"><span>1</span>Confirma tu contraseña</li>' +
        '<li class="fin2-paso"><span>2</span>Escanea el código</li>' +
        '<li class="fin2-paso"><span>3</span>Escribe el primer código</li>' +
      '</ol>' +
      U.card({ clase: 'fin2-registro', cuerpo:
        '<form class="js-fin-clave fin2-form">' +
          '<label class="fin2-label" for="fin-pass">Tu contraseña de SIGSO</label>' +
          '<input id="fin-pass" type="password" class="fin2-input" autocomplete="current-password" required>' +
          '<p class="fin2-ayuda">Se pide de nuevo para que nadie con tu sesión abierta pueda registrar su propio teléfono.</p>' +
          '<p class="fin2-error" id="fin-err" role="alert"></p>' +
          U.boton({ texto: 'Continuar', icono: 'derecha', variante: 'primario', tipo: 'submit' }) +
        '</form>' }));
    setTimeout(function () { var p = document.getElementById('fin-pass'); if (p) p.focus(); }, 60);
  }
  function pintarQr(datos) {
    pagina(cab('Activa tu acceso a la bóveda', 'Una sola vez. Necesitas tu teléfono con Google Authenticator instalado.') +
      '<ol class="fin2-pasos">' +
        '<li class="fin2-paso fin2-paso--hecho"><span>✓</span>Confirma tu contraseña</li>' +
        '<li class="fin2-paso fin2-paso--activo"><span>2</span>Escanea el código</li>' +
        '<li class="fin2-paso fin2-paso--activo"><span>3</span>Escribe el primer código</li>' +
      '</ol>' +
      U.card({ clase: 'fin2-registro', cuerpo:
        '<div class="fin2-qr-fila">' +
          '<div class="fin2-qr" id="fin-qr" aria-label="Código QR para Google Authenticator">' + U.ico('candado', 28) + '</div>' +
          '<div class="fin2-qr-pasos">' +
            '<p><b>En Google Authenticator:</b> toca <b>+</b> → <b>Escanear un código QR</b> y apunta a este código.</p>' +
            '<p class="fin2-ayuda">¿No puedes escanear? Elige <b>Ingresar una clave de configuración</b>, nombre «SIGSO Finanzas», y escribe:</p>' +
            '<code class="fin2-clave">' + txt(datos.clave) + '</code>' +
            '<p class="fin2-ayuda">No compartas esta clave ni le saques captura: quien la tenga puede generar tus códigos.</p>' +
          '</div>' +
        '</div>' +
        '<form class="js-fin-activar fin2-form fin2-form--sep">' +
          '<label class="fin2-label">Código de 6 dígitos que muestra la app</label>' + casillas('fin-cod') +
          '<p class="fin2-error" id="fin-err" role="alert"></p>' +
          U.boton({ texto: 'Activar y abrir la bóveda', icono: 'check', variante: 'primario', tipo: 'submit' }) +
        '</form>' }));
    dibujarQr(datos.uri);
  }
  function cargarLibQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    return new Promise(function (ok, mal) {
      var s = document.createElement('script');
      s.src = QR_SRC; s.integrity = QR_SRI; s.crossOrigin = 'anonymous';
      s.onload = function () { window.qrcode ? ok(window.qrcode) : mal(); };
      s.onerror = mal;
      document.head.appendChild(s);
    });
  }
  function dibujarQr(uri) {
    cargarLibQr().then(function (qrcode) {
      var q = qrcode(0, 'M'); q.addData(uri); q.make();
      var el = document.getElementById('fin-qr');
      if (el) el.innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    }).catch(function () {
      var el = document.getElementById('fin-qr');
      if (el) el.innerHTML = '<p class="fin2-ayuda">No se pudo dibujar el código QR. Usa la clave de configuración de la derecha.</p>';
    });
  }

  // --- Bóveda abierta: enrutador de vistas ---------------------------------------------------
  var MODULOS = {
    planilla: function () { return window.SigsoFinanzasHoja && SigsoFinanzasHoja.ver; },
    informe: function () { return window.SigsoFinanzasInforme && SigsoFinanzasInforme.ver; },
    flujo: function () { return window.SigsoFinanzasHoja && SigsoFinanzasHoja.verFlujo; },
    saldos: function () { return window.SigsoFinanzasHoja && SigsoFinanzasHoja.verSaldos; },
    cobros: function () { return window.SigsoFinanzasHoja && SigsoFinanzasHoja.verCobros; },
    registro: function () { return window.SigsoFinanzasRegistro && SigsoFinanzasRegistro.ver; },
    tablero: function () { return window.SigsoFinanzasInformes && SigsoFinanzasInformes.ver; },
    exportar: function () { return window.SigsoFinanzasInformes && SigsoFinanzasInformes.verExportar; },
    bancos: function () { return window.SigsoFinanzasBancos && SigsoFinanzasBancos.verBancos; },
    cargas: function () { return window.SigsoFinanzasCargas && SigsoFinanzasCargas.ver; },
    movimientos: function () { return window.SigsoFinanzasBancos && SigsoFinanzasBancos.verMovimientos; },
    clientes: function () { return window.SigsoFinanzasClientes && SigsoFinanzasClientes.ver; },
    fondos: function () { return window.SigsoFinanzasFondos && SigsoFinanzasFondos.ver; },
    cobranza: function () { return window.SigsoFinanzasCobranza && SigsoFinanzasCobranza.ver; },
    presupuesto: function () { return window.SigsoFinanzasPresupuesto && SigsoFinanzasPresupuesto.ver; },
    cierre: function () { return window.SigsoFinanzasCierre && SigsoFinanzasCierre.ver; },
    catalogos: function () { return window.SigsoFinanzasConfig && SigsoFinanzasConfig.verCatalogos; },
    reglas: function () { return window.SigsoFinanzasConfig && SigsoFinanzasConfig.verReglas; },
    migracion: function () { return window.SigsoFinanzasCargas && SigsoFinanzasCargas.verMigracion; }
  };
  function abrir() {
    ultimoUso_ = Date.now();
    iniciarReloj();
    catalogo();
    // I05.5: se llegó desde una obligación de Control interno → al Registro, con el pago precompletado.
    if (contexto().fuente_ci && vista_ !== 'registro') vista_ = 'registro';
    // v3: una pantalla retirada (enlace viejo o vista recordada) abre la que la reemplaza.
    else if (RETIRADAS[vista_]) vista_ = RETIRADAS[vista_];
    if (vista_ === 'bitacora') return verBitacora();
    publicar();
    var m = MODULOS[vista_] && MODULOS[vista_]();
    if (m) return m(ctxVista());
    vista_ = 'inicio';
    var t = ++turno_;
    pagina(cabAbierta('inicio') + U.esqueleto('kpis', 4));
    Promise.all([api('finanzasResumen'), catalogo()]).then(function (rs) {
      var r = rs[0];
      if (t !== turno_ || !r) return;
      if (!r.ok) { if (!r.boveda_cerrada) pagina(cabAbierta('inicio') + U.card({ cuerpo: U.vacio({ accion: '<button type="button" class="sx2-boton sx2-boton--secundario sx2-boton--sm js-fin-reintentar">Reintentar</button>', icono: 'alerta', titulo: 'No se pudo cargar', texto: r.message || '' }) })); return; }
      pintarResumen(r.data);
    });
  }
  // Lo que cada vista recibe para pintarse dentro de la bóveda.
  function ctxVista() {
    var t = ++turno_;
    return {
      // T32 (I13): una vista que ya no está a la vista no pinta (p. ej. una recarga lenta tras irse a otra pantalla).
      api: api, pagina: function (html) { if (t === turno_) pagina(html); }, cab: cabAbierta, raiz: function () { return raiz_; },
      turno: function () { return t; }, vigente: function (n) { return n === turno_; },
      ir: function (v, cambios) { if (cambios) contexto(cambios); vista_ = v; abrir(); },
      credenciales: function () { return { boveda_token: token(), equipo: equipo() }; },
      catalogo: catalogo, puede: puede, contexto: contexto, aviso: aviso, aplicarCapacidades: function (el) { aplicarCapacidades(el || raiz_); }
    };
  }
  // Compatibilidad: las vistas anteriores llamaban cab('Bancos'), cab('Tablero'), etc.
  var COMPAT_ = { 'El mes': 'planilla', Tablero: 'tablero', Bancos: 'bancos', Movimientos: 'movimientos', Cobranza: 'cobranza', Presupuesto: 'presupuesto', Cierre: 'cierre', Resumen: 'inicio', 'Bitácora': 'bitacora' };
  function cabAbierta(seccion, extra) {
    var id = COMPAT_[seccion] || seccion;
    var tt = TITULOS_[id] || TITULOS_.inicio;
    var area = areaDe(vista_);
    // I08.2: sin menú arriba (vive en la columna izquierda). La bóveda abierta (tiempo y cierre seguro) va junto a las acciones.
    var boveda = '<span class="fin2-boveda" role="group" aria-label="Bóveda abierta"><span class="fin2-abierta" title="La bóveda se cierra sola si no la usas">' + U.ico('reloj', 14) + '<span id="fin-reloj">' + inactividadMin_ + ':00</span></span>' +
      U.boton({ soloIcono: true, icono: 'candado', sm: true, variante: 'fantasma', clase: 'js-fin-salir', titulo: 'Cerrar la bóveda' }) + '</span>';
    return cab(tt[0], tt[1], (extra || '') + boveda, area.texto);
  }
  function capa(ok, titulo, texto) {
    return '<li class="fin2-capa' + (ok ? ' fin2-capa--ok' : ' fin2-capa--pend') + '"><span class="fin2-capa__ico">' + U.ico(ok ? 'check' : 'reloj', 14) + '</span>' +
      '<div><b>' + txt(titulo) + '</b><span>' + txt(texto) + '</span></div></li>';
  }
  function pintarResumen(d) {
    var activos = d.autenticadores_activos || 0, total = d.personas_con_acceso || 0;
    var ingresos = (d.ultimos_ingresos || []).map(function (i) {
      return '<li><span class="fin2-ing__quien">' + txt(i.nombre) + '</span><span class="fin2-ing__cuando">' + txt(fechaHora(i.ts)) + '</span></li>';
    }).join('');
    pagina(cabAbierta('inicio') +
      '<div class="fin2-hero sx2-entra">' +
        '<div><p class="fin2-hero__k">Hola, ' + txt(String(d.nombre || '').split(' ')[0]) + '</p>' +
        '<h2>La bóveda está cerrada para el resto de SIGSO.</h2>' +
        '<p>Aquí ves quién tiene acceso, cómo se protege y quién entró. El trabajo del mes está en <b>Trabajo diario</b>; las cifras, en <b>Informes</b>.</p></div>' +
        '<span class="fin2-hero__ico" aria-hidden="true">' + U.ico('escudo', 44) + '</span>' +
      '</div>' +
      '<div class="sx2-fila-kpis">' +
        U.kpi({ etiqueta: 'Personas con acceso', valor: total, icono: 'equipo', i: 0 }) +
        U.kpi({ etiqueta: 'Autenticadores activos', valor: activos + ' de ' + total, icono: 'llave', tono: activos < total ? 'alerta' : 'ok', i: 1 }) +
        U.kpi({ etiqueta: 'Bitácora', valor: d.cadena && d.cadena.ok ? 'Íntegra' : 'Alterada', icono: 'escudo', tono: d.cadena && d.cadena.ok ? 'ok' : 'critico', i: 2 }) +
        U.kpi({ etiqueta: 'Registros en la bitácora', valor: d.cadena ? d.cadena.filas : 0, icono: 'lista', i: 3 }) +
      '</div>' +
      '<div class="fin2-grid">' +
        U.card({ titulo: 'Capas de seguridad', icono: 'escudo', i: 1, cuerpo: '<ul class="fin2-capas">' +
          capa(true, 'Lista fija de personas', 'Vive en el servidor. Nadie puede darse acceso desde una pantalla.') +
          capa(true, 'Invisible para el resto', 'Quien no está en la lista no ve el módulo y el servidor responde «no existe».') +
          capa(true, 'Segundo factor', 'Código de Google Authenticator para abrir; un código no sirve dos veces.') +
          capa(true, 'Base propia y cifrada', 'Archivo aparte de SIGSO, cifrado con AES-256. Sin la llave del servidor no se lee.') +
          capa(true, 'Permisos por tarea', 'Consultar, registrar, conciliar, aplicar, cerrar o exportar se dan por separado.') +
          capa(true, 'Se cierra sola', inactividadMin_ + ' minutos sin uso, o al cerrar la pestaña.') +
          capa(activos >= total && total > 0, 'Todos con autenticador', activos >= total ? (total === 1 ? 'La única persona de la lista ya lo activó.' : 'Las ' + total + ' personas ya lo activaron.') : (total - activos === 1 ? 'Falta 1 persona por activar el suyo.' : 'Faltan ' + (total - activos) + ' personas por activar el suyo.')) +
        '</ul>' }) +
        U.card({ titulo: 'Últimos ingresos', icono: 'reloj', i: 2, accion: { texto: 'Ver bitácora', clase: 'js-fin-ir-bitacora' }, cuerpo:
          (ingresos ? '<ul class="fin2-ing">' + ingresos + '</ul>' : U.vacio({ icono: 'reloj', texto: 'Aún no hay ingresos.' })) }) +
        U.card({ titulo: 'Tu acceso', icono: 'llave', i: 3, cuerpo: '<ul class="fin2-capas">' + Object.keys((cat_ && cat_.capacidades_nombres) || {}).map(function (k) {
          return capa(puede(k), cat_.capacidades_nombres[k], puede(k) ? 'Permitido' : 'No incluido en tu acceso');
        }).join('') + '</ul>' }) +
      '</div>');
    if (U.animar) U.animar(raiz_);
  }

  function verBitacora() {
    vista_ = 'bitacora';
    publicar();
    var t = ++turno_;
    pagina(cabAbierta('bitacora') + U.esqueleto('tabla', 8));
    api('finanzasBitacora', { limite: 300 }).then(function (r) {
      if (t !== turno_ || !r || !r.ok) return;
      var c = r.data.cadena;
      var filas = r.data.filas.map(function (f) {
        var a = NOMBRES_ACCION[f.accion] || [f.accion, 'neutro'];
        return '<tr><td class="fin2-num">' + txt(fechaHora(f.ts)) + '</td><td>' + txt(f.nombre || '—') + '</td><td>' + U.badge(a[0], a[1]) +
          (f.detalle ? ' <span class="fin2-det">' + txt(f.detalle) + '</span>' : '') + '</td><td class="fin2-mono">' + txt(f.ip) + '</td><td class="fin2-mono" title="' + txt(f.equipo) + '">' + txt(String(f.equipo || '').slice(0, 8)) + '</td></tr>';
      }).join('');
      pagina(cabAbierta('bitacora') +
        '<div class="fin2-cadena ' + (c.ok ? 'fin2-cadena--ok' : 'fin2-cadena--mal') + ' sx2-entra">' + U.ico(c.ok ? 'escudo' : 'alerta', 18) +
          (c.ok ? '<span><b>Bitácora íntegra.</b> Las ' + c.filas + ' entradas están encadenadas: si alguien editara o borrara una, se notaría aquí.</span>'
                : '<span><b>Atención: la bitácora fue alterada</b> desde la entrada ' + c.rota_en + '. Avisa al administrador.</span>') + '</div>' +
        U.card({ sinRelleno: true, cuerpo: '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>IP</th><th>Equipo</th></tr></thead><tbody>' +
          (filas || '<tr><td colspan="5">Sin registros.</td></tr>') + '</tbody></table></div>' }));
    });
  }

  // --- Reloj de inactividad -----------------------------------------------------------------
  function iniciarReloj() {
    detenerReloj();
    reloj_ = setInterval(function () {
      var resta = inactividadMin_ * 60000 - (Date.now() - ultimoUso_);
      var el = document.getElementById('fin-reloj');
      if (resta <= 0) { detenerReloj(); limpiarSesion(); pintarCerrada('La bóveda se cerró por inactividad.'); return; }
      if (el) {
        var m = Math.floor(resta / 60000), s = Math.floor((resta % 60000) / 1000);
        el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
        el.parentNode.classList.toggle('fin2-abierta--pronto', resta < 120000);
      }
    }, 1000);
  }
  function detenerReloj() { if (reloj_) { clearInterval(reloj_); reloj_ = null; } }

  // --- Eventos ----------------------------------------------------------------------------------
  function error(msg) { var e = document.getElementById('fin-err'); if (e) e.textContent = msg || ''; }
  function ocupado(form, si) { var b = form.querySelector('button[type=submit]'); if (b) b.disabled = !!si; }

  function enlazar() {
    if (!raiz_ || raiz_.dataset.finEnlazado) return;
    raiz_.dataset.finEnlazado = '1';
    // Lo que se pinta por partes (paneles, listas) también respeta las capacidades.
    if (window.MutationObserver) { observador_ = new MutationObserver(function () { aplicarCapacidades(raiz_); }); observador_.observe(raiz_, { childList: true, subtree: true }); }
    raiz_.addEventListener('submit', function (ev) {
      var f = ev.target;
      if (f.classList.contains('js-fin-clave')) {
        ev.preventDefault(); ocupado(f, true); error('');
        api('finanzasPrepararAutenticador', { password: document.getElementById('fin-pass').value }).then(function (r) {
          ocupado(f, false);
          if (!r || !r.ok) return error((r && r.message) || 'No se pudo continuar.');
          pintarQr(r.data);
        });
      } else if (f.classList.contains('js-fin-activar') || f.classList.contains('js-fin-entrar')) {
        ev.preventDefault();
        var codigo = leerCasillas('fin-cod');
        if (codigo.length !== 6) return error('Escribe los 6 dígitos.');
        ocupado(f, true); error('');
        var activar = f.classList.contains('js-fin-activar');
        api(activar ? 'finanzasActivarAutenticador' : 'finanzasEntrar', { codigo: codigo }).then(function (r) {
          ocupado(f, false);
          if (!r || !r.ok) { error((r && r.message) || 'No se pudo abrir.'); limpiarCasillas('fin-cod'); var caja = document.querySelector('.fin2-digitos'); if (caja) { caja.classList.remove('fin2-sacude'); void caja.offsetWidth; caja.classList.add('fin2-sacude'); } return; }
          guardarToken(r.data.boveda_token);
          inactividadMin_ = r.data.inactividad_min || inactividadMin_;
          // I08.2: la pantalla pedida o la última válida; si no hay, la útil para la tarea (operación → Registro; consulta → Resumen).
          vista_ = vistaPedida_ || (r.data.solo_lectura ? 'tablero' : 'registro');
          vistaPedida_ = '';
          var c = document.querySelector('.fin2-candado__caja');
          if (c) { c.classList.add('fin2-abre'); setTimeout(abrir, 420); } else abrir();
        });
      }
    });
    raiz_.addEventListener('input', function (ev) {
      var i = ev.target;
      if (!i.classList.contains('fin2-digito')) return;
      var v = i.value.replace(/\D/g, '');
      if (v.length > 1) { // pegó el código (o escribió rápido): se reparte desde esta casilla
        var todas = i.parentNode.querySelectorAll('.fin2-digito');
        var desde = v.length >= 6 ? 0 : Number(i.dataset.i) || 0;
        v.slice(0, 6 - desde).split('').forEach(function (d, k) { if (todas[desde + k]) todas[desde + k].value = d; });
        var ult = todas[Math.min(desde + v.length, 6) - 1]; if (ult) ult.focus();
      } else {
        i.value = v;
        if (v && i.nextElementSibling) i.nextElementSibling.focus();
      }
      if (leerCasillas(i.parentNode.id).length === 6) { var form = i.closest('form'); if (form && form.requestSubmit) form.requestSubmit(); }
    });
    raiz_.addEventListener('keydown', function (ev) {
      var i = ev.target;
      if (i.classList && i.classList.contains('fin2-digito') && ev.key === 'Backspace' && !i.value && i.previousElementSibling) i.previousElementSibling.focus();
      // Flechas en la barra de áreas y subvistas (tablist).
      if (i.classList && (i.classList.contains('js-fin-area') || i.classList.contains('js-fin-vista')) && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) {
        var hermanos = Array.prototype.slice.call(i.parentNode.querySelectorAll('button'));
        var k = hermanos.indexOf(i) + (ev.key === 'ArrowRight' ? 1 : -1);
        if (hermanos[k]) { ev.preventDefault(); hermanos[k].focus(); }
      }
    });
    raiz_.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      if (b.classList.contains('js-fin-salir')) {
        api('finanzasSalir').then(function () { limpiarSesion(); detenerReloj(); pintarCerrada('Cerraste la bóveda.'); });
      } else if (b.classList.contains('js-fin-reintentar')) {
        // I12.4: una carga que falló se reintenta en la misma pantalla y con el mismo contexto.
        if (vista_ === 'bitacora') verBitacora(); else abrir();
      } else if (b.classList.contains('js-fin-volver')) {
        // Vuelve al origen con su filtro (Pendientes recuerda la fila siguiente).
        contexto({ volver_a: '' }); vista_ = b.dataset.v; abrir();
      } else if (b.classList.contains('js-fin-ir-bitacora')) {
        verBitacora();
      } else if (b.classList.contains('js-fin-area') && b.dataset.id) {
        var area = AREAS.filter(function (a) { return a.id === b.dataset.id; })[0];
        if (area) { vista_ = area.vistas[0][0]; if (vista_ === 'cobranza' && window.SigsoFinanzasCobranza) SigsoFinanzasCobranza.reiniciar(); abrir(); }
      } else if (b.classList.contains('js-fin-vista') && b.dataset.id) {
        vista_ = b.dataset.id;
        if (vista_ === 'cobranza' && window.SigsoFinanzasCobranza) SigsoFinanzasCobranza.reiniciar();
        if (vista_ === 'bitacora') verBitacora(); else abrir();
      }
    });
  }

  function irAItem(id) {
    if (!vistaValida(id)) return false;
    contexto({ volver_a: '' });
    vista_ = id;
    if (vista_ === 'cobranza' && window.SigsoFinanzasCobranza) SigsoFinanzasCobranza.reiniciar();
    if (token()) { if (vista_ === 'bitacora') verBitacora(); else abrir(); }
    else { vistaPedida_ = id; cargar(); }
    return true;
  }
  window.SigsoFinanzas = { cargar: cargar, refrescar: refrescar, irAItem: irAItem, ir: function (v) { vista_ = v; abrir(); } };
})();
