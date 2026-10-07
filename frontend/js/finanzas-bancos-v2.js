/**
 * finanzas-bancos-v2.js — Finanzas, Etapa 2: bancos y cartolas (2026-10-06;
 * backend/logica/finanzasBancos.js). Lo monta finanzas-v2.js dentro de la
 * bóveda abierta, con dos vistas:
 *
 *  - Bancos: las cuentas con su saldo, subir cartolas (Excel del BCI; se
 *    revisan antes de guardar), aprender de la planilla SIGECO y la cuenta
 *    corriente de fondos de cada cliente.
 *  - Movimientos: el mes en una lista a lo ancho (sin barra horizontal). Cada
 *    fila trae la sugerencia; se acepta de a una, en lote, o se abre el panel
 *    lateral para clasificarla (Etapa B). Lo que se corrige se aprende.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null;                 // contexto que entrega finanzas-v2.js
  var cat_ = null;               // tipos, empresas, clientes
  var mov_ = { periodo: '', filtro: 'pendientes', datos: null, sel: {}, avisos: {} };   // avisos: id → texto (Etapa C, lotes)
  var revisiones_ = [];          // cartolas leídas y revisadas, aún sin importar

  function txt(v) { return U.esc(String(v == null ? '' : v)); }
  function plata(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  function mesTexto(p) {
    if (!p) return '';
    var m = p.split('-');
    return new Date(Number(m[0]), Number(m[1]) - 1, 1).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
  }
  function fechaCorta(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '-' + p[1] : iso; }
  function catalogo() {
    if (cat_) return Promise.resolve(cat_);
    return x_.api('finanzasCatalogo').then(function (r) { if (r && r.ok) cat_ = r.data; return cat_; });
  }
  function tipo(id) { return (cat_ && cat_.tipos.filter(function (t) { return t.id === id; })[0]) || null; }
  var avisoT_ = null;
  function aviso(msg) {
    var el = document.getElementById('fin2-toast');
    if (!el) { el = document.createElement('div'); el.id = 'fin2-toast'; el.className = 'fin2-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('fin2-toast--on');
    clearTimeout(avisoT_); avisoT_ = setTimeout(function () { el.classList.remove('fin2-toast--on'); }, 4500);
  }

  // =====================================================================================
  // Bancos
  // =====================================================================================
  function verBancos(x) {
    x_ = x; enlazar();
    var t = x.turno();
    x.pagina(x.cab('Bancos') + U.esqueleto('tarjetas', 3));
    Promise.all([x.api('finanzasResumenBancos'), catalogo()]).then(function (rs) {
      if (!x.vigente(t)) return;
      var r = rs[0];
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('Bancos') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: r.message || '' }) })); return; }
      pintarBancos(r.data);
    });
  }
  var bancos_ = null;
  function pintarBancos(d) {
    bancos_ = d;
    var cuentas = d.cuentas.map(function (c, i) {
      return '<div class="fin2-banco sx2-entra" style="--i:' + i + '"><div class="fin2-banco__cab"><span class="fin2-banco__logo">' + txt(c.banco) + '</span>' +
        '<span class="fin2-banco__num">···' + txt(c.ultimos4) + '</span></div>' +
        '<b class="fin2-banco__emp">' + txt(c.empresa) + '</b>' +
        '<span class="fin2-banco__saldo">' + (c.saldo == null ? '—' : plata(c.saldo)) + '</span>' +
        '<span class="fin2-banco__hasta">Saldo al ' + txt(fechaCorta(c.hasta)) + '</span></div>';
    }).join('');
    var fondos = d.fondos.slice(0, 12).map(function (f) {
      return '<tr><td>' + txt(f.cliente) + '</td><td class="fin2-num">' + plata(f.recibido) + '</td><td class="fin2-num">' + plata(f.pagado) + '</td>' +
        '<td class="fin2-num' + (f.saldo < 0 ? ' fin2-neg' : '') + '"><b>' + (f.saldo < 0 ? '⚠ ' : '') + plata(f.saldo) + '</b></td></tr>';
    }).join('');
    x_.pagina(x_.cab('Bancos') +
      (d.pendientes ? '<div class="fin2-cinta sx2-entra">' + U.ico('alerta', 16) + '<span><b>' + d.pendientes + ' movimiento(s) por revisar.</b> Están cargados pero falta confirmar qué son.</span>' +
        U.boton({ texto: 'Revisar', icono: 'derecha', variante: 'primario', sm: true, clase: 'js-finb-ir-mov' }) + '</div>' : '') +
      '<div class="fin2-bancos">' + cuentas +
        '<label class="fin2-subir sx2-entra">' +
          '<input type="file" accept=".xlsx" multiple class="js-finb-archivo" hidden>' +
          '<span class="fin2-subir__ico">' + U.ico('subir', 22) + '</span>' +
          '<b>Subir cartolas</b><span>Excel del BCI, una o varias. Se revisan antes de guardar.</span>' +
        '</label>' +
        // Etapa A: el detalle «Mis Movimientos» pone nombre completo a cada movimiento.
        '<label class="fin2-subir fin2-subir--2 sx2-entra">' +
          '<input type="file" accept=".xlsx" class="js-finb-detalle" hidden>' +
          '<span class="fin2-subir__ico">' + U.ico('lupa', 22) + '</span>' +
          '<b>Agregar el detalle del banco</b><span>El Excel «Mis Movimientos»: dice quién transfirió y si fue Previred, SII o Tesorería.</span>' +
        '</label>' +
      '</div>' +
      '<div id="finb-revision"></div>' +
      '<div id="finb-nombres"></div>' +
      '<div class="fin2-grid fin2-grid--2">' +
        U.card({ titulo: 'Plata de clientes en custodia', icono: 'equipo', sub: 'lo que mandan para sus imposiciones o IVA', cuerpo:
          (fondos ? '<div class="fin2-tabla-envoltura"><table class="fin2-tabla"><thead><tr><th>Cliente</th><th>Recibido</th><th>Pagado por su cuenta</th><th>Saldo</th></tr></thead><tbody>' + fondos + '</tbody></table></div>' +
            '<p class="fin2-ayuda" style="margin-top:8px">Un saldo negativo es plata que la empresa puso por el cliente: hay que cobrársela.</p>'
            : U.vacio({ icono: 'equipo', texto: 'Aparece cuando se confirmen movimientos como «Fondo de cliente».' })) }) +
        U.card({ titulo: 'Aprender del Excel BANCOS', icono: 'bombilla', sub: 'lo que se anotaba a mano', cuerpo:
          '<p class="fin2-ayuda">Sube el Excel «BANCOS» del mes. Primero se enseña una sola vez quién es cada nombre corto que usan (por ejemplo, «ANDES» = Andes Montajes SpA). Después cada fila queda como sugerencia en su movimiento y el sistema aprende <b>quién paga por quién</b>.</p>' +
          '<label class="sx2-boton sx2-boton--primario" style="margin-top:10px;cursor:pointer"><input type="file" accept=".xlsx" class="js-finb-excel" hidden>' + U.ico('subir', 16) + 'Elegir el Excel BANCOS</label>' }) +
        U.card({ titulo: 'Aprender de la planilla SIGECO', icono: 'documento', cuerpo:
          '<p class="fin2-ayuda">Sube la planilla de Google Sheets descargada como Excel. Lo que ya se clasificó a mano en la hoja CUENTA BANCARIA queda como sugerencia en los movimientos de la cartola (no se confirma solo).</p>' +
          '<label class="sx2-boton sx2-boton--secundario" style="margin-top:10px;cursor:pointer"><input type="file" accept=".xlsx" class="js-finb-planilla" hidden>' + U.ico('subir', 16) + 'Elegir la planilla</label>' +
          '<p class="fin2-ayuda" style="margin-top:8px">Reglas aprendidas hasta hoy: <b>' + d.reglas + '</b></p>' }) +
      '</div>');
    pintarRevisiones();
  }

  // --- Detalle del banco («Mis Movimientos») ---------------------------------------------
  function subirDetalle(archivo, cuentaId) {
    var cuentas = (bancos_ && bancos_.cuentas) || [];
    if (!cuentas.length) { aviso('Primero sube la cartola de esa cuenta: el detalle se pega a sus movimientos.'); return; }
    // El BCI nombra el archivo con la cuenta («…Cuenta_1483…»); si lo renombraron y hay varias cuentas, se pregunta.
    if (!cuentaId && cuentas.length === 1) cuentaId = cuentas[0].id;
    if (!cuentaId && !/Cuenta[_\s-]*\d{4}/i.test(archivo.name)) { preguntarCuentaDetalle(archivo, cuentas); return; }
    SigsoLectorXlsx.leer(archivo).then(function (hojas) {
      return x_.api('finanzasImportarDetalle', { filas: (hojas[0] && hojas[0].filas) || [], nombre_archivo: archivo.name, cuenta: cuentaId || '' }).then(function (r) {
        if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo leer el detalle.'); return; }
        var d = r.data;
        aviso('Detalle de ' + d.cuenta.banco + ' ···' + d.cuenta.ultimos4 + ': ' + d.emparejados + ' de ' + d.filas + ' movimientos tienen ahora el nombre completo' +
          (d.sin_cartola ? ' · ' + d.sin_cartola + ' no están en la cartola (sube la cartola de esas fechas)' : '') + '.');
        verBancos(x_);
      });
    }).catch(function () { aviso('El archivo no es un Excel válido.'); });
  }

  var detallePendiente_ = null;
  function preguntarCuentaDetalle(archivo, cuentas) {
    detallePendiente_ = archivo;
    var cont = document.getElementById('finb-nombres'); if (!cont) return;
    cont.innerHTML = U.card({ titulo: '¿De qué cuenta es este detalle?', icono: 'lupa', sub: archivo.name, cuerpo:
      '<div class="fin2-acciones" style="align-items:center;justify-content:flex-start">' +
        '<select class="fin2-input fin2-input--sm js-finb-det-cuenta">' + cuentas.map(function (c) { return '<option value="' + txt(c.id) + '">' + txt(c.banco + ' ···' + c.ultimos4 + ' · ' + c.empresa) + '</option>'; }).join('') + '</select>' +
        U.boton({ texto: 'Agregar el detalle', icono: 'check', variante: 'primario', sm: true, clase: 'js-finb-det-si' }) +
        U.boton({ texto: 'Cancelar', sm: true, clase: 'js-finb-det-no' }) + '</div>' });
  }

  // --- Excel BANCOS: nombres cortos y aprendizaje -----------------------------------------
  var excel_ = null; // { nombre, filas, nombres[], cuenta }
  var CLASES = [['cliente', 'Cliente'], ['empresa', 'Empresa del grupo'], ['gasto', 'Gasto de la empresa'], ['ignorar', 'No es nada (ignorar)']];
  function subirExcel(archivo) {
    SigsoLectorXlsx.leer(archivo).then(function (hojas) {
      var hoja = hojas.filter(function (h) { return /BCI/i.test(h.hoja); })[0] || hojas[0];
      return x_.api('finanzasRevisarExcelBancos', { filas: hoja.filas }).then(function (r) {
        if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo leer el Excel.'); return; }
        excel_ = { nombre: archivo.name, hoja: hoja.hoja, filas: hoja.filas, datos: r.data };
        pintarNombres();
        var el = document.getElementById('finb-nombres'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }).catch(function () { aviso('El archivo no es un Excel válido.'); });
  }
  function filaNombre(n, i) {
    var dz = n.actual || n.propuesta || {};
    var cuentasEgreso = (tipo('EGRESO') || {}).cuentas || [];
    return '<tr class="js-finb-nombre" data-i="' + i + '">' +
      '<td><b>' + txt(n.alias) + '</b><span class="fin2-motivo">' + n.filas + ' fila(s)' + (n.pagadores.length ? ' · pagó: ' + txt(n.pagadores.join(', ')) : '') + '</span></td>' +
      '<td>' + (n.actual ? U.badge('Ya enseñado', 'ok') : n.propuesta ? U.badge('Propuesta', 'info') : U.badge('Falta', 'alerta')) + '</td>' +
      '<td><select class="fin2-input fin2-input--sm js-finb-clase">' + opciones(CLASES.map(function (c) { return { id: c[0], nombre: c[1] }; }), dz.clase || '', '¿Qué es?') + '</select></td>' +
      '<td class="js-finb-destino">' + destinoCampo(dz, cuentasEgreso) + '</td></tr>';
  }
  function destinoCampo(dz, cuentasEgreso) {
    if (dz.clase === 'cliente') return '<input class="fin2-input fin2-input--sm js-finb-cli" list="finm-clientes" value="' + txt(dz.cliente || '') + '" placeholder="Busca el cliente">';
    if (dz.clase === 'empresa') return '<select class="fin2-input fin2-input--sm js-finb-emp">' + opciones(cat_.empresas, dz.empresa, 'Empresa') + '</select>';
    if (dz.clase === 'gasto') return '<select class="fin2-input fin2-input--sm js-finb-gasto">' + opciones(cuentasEgreso, dz.cuenta, 'Cuenta del gasto') + '</select>';
    return '<span class="fin2-ayuda">—</span>';
  }
  function pintarNombres() {
    var cont = document.getElementById('finb-nombres');
    if (!cont || !excel_) { if (cont) cont.innerHTML = ''; return; }
    var d = excel_.datos, faltan = d.nombres.filter(function (n) { return !n.actual && !n.propuesta; }).length;
    var cuentas = (bancos_ && bancos_.cuentas) || [];
    cont.innerHTML = U.card({ titulo: 'Paso 1 · Enseña los nombres cortos', icono: 'bombilla', sub: excel_.nombre + ' · ' + d.filas + ' filas', cuerpo:
      '<div class="fin2-cinta fin2-cinta--info">' + U.ico('info', 16) + '<span>Para cada nombre que usan en el Excel, di qué es. Se hace <b>una sola vez</b>: los meses siguientes ya se sabe. ' +
        (faltan ? '<b>' + faltan + ' sin propuesta</b>: complétalos o déjalos para después (esas filas no se aprenden).' : 'Todos tienen propuesta: revísalas y guarda.') + '</span></div>' +
      '<div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-nombres"><thead><tr><th>Nombre en el Excel</th><th></th><th>Qué es</th><th>Cuál</th></tr></thead><tbody>' +
        d.nombres.map(filaNombre).join('') + '</tbody></table></div>' +
      '<datalist id="finm-clientes">' + cat_.clientes.map(function (c) { return '<option value="' + txt(c.nombre) + '">' + txt(c.rut) + '</option>'; }).join('') + '</datalist>' +
      '<div class="fin2-acciones" style="align-items:center">' +
        '<label class="fin2-ayuda">Cuenta del banco de esta hoja ' + '<select class="fin2-input fin2-input--sm js-finb-excel-cuenta">' +
          cuentas.map(function (c) { return '<option value="' + txt(c.id) + '">' + txt(c.banco + ' ···' + c.ultimos4 + ' · ' + c.empresa) + '</option>'; }).join('') + '</select></label>' +
        U.boton({ texto: 'Descartar', clase: 'js-finb-excel-no' }) +
        U.boton({ texto: 'Paso 2 · Guardar y aprender del Excel', icono: 'check', variante: 'primario', clase: 'js-finb-excel-si', deshabilitado: !cuentas.length }) + '</div>' +
      (cuentas.length ? '' : '<p class="fin2-error">Primero sube la cartola de esa cuenta.</p>') });
  }
  function leerNombres() {
    var out = [], malos = [];
    document.querySelectorAll('.js-finb-nombre').forEach(function (tr) {
      var n = excel_.datos.nombres[Number(tr.dataset.i)];
      var clase = (tr.querySelector('.js-finb-clase') || {}).value || '';
      if (!clase) return;
      var a = { alias: n.alias, clase: clase };
      if (clase === 'cliente') {
        var nom = (tr.querySelector('.js-finb-cli') || {}).value || '';
        var c = cat_.clientes.filter(function (x) { return x.nombre === nom; })[0];
        if (!c) { malos.push(n.alias); return; }
        a.cliente_id = c.id;
      } else if (clase === 'empresa') { a.empresa = (tr.querySelector('.js-finb-emp') || {}).value; if (!a.empresa) { malos.push(n.alias); return; } }
      else if (clase === 'gasto') { a.cuenta = (tr.querySelector('.js-finb-gasto') || {}).value; if (!a.cuenta) { malos.push(n.alias); return; } }
      out.push(a);
    });
    return { alias: out, malos: malos };
  }
  function guardarExcel(b) {
    var l = leerNombres();
    if (l.malos.length) { aviso('Falta elegir el cliente, empresa o cuenta de: ' + l.malos.slice(0, 4).join(', ') + (l.malos.length > 4 ? '…' : '') + '.'); return; }
    var cuenta = (document.querySelector('.js-finb-excel-cuenta') || {}).value;
    b.disabled = true;
    x_.api('finanzasGuardarNombres', { alias: l.alias }).then(function (r1) {
      if (!r1 || !r1.ok) { b.disabled = false; aviso((r1 && r1.message) || 'No se pudieron guardar los nombres.'); return; }
      if (r1.data.errores && r1.data.errores.length) { b.disabled = false; aviso('Revisa: ' + r1.data.errores.slice(0, 3).join(' · ')); return; }
      return x_.api('finanzasAprenderExcelBancos', { filas: excel_.filas, cuenta: cuenta }).then(function (r) {
        b.disabled = false;
        if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo aprender del Excel.'); return; }
        var d = r.data;
        aviso('Listo: ' + d.emparejadas + ' de ' + d.filas + ' filas encontraron su movimiento, ' + d.con_sugerencia + ' quedaron como sugerencia y ' + d.pagadores_aprendidos + ' pagos enseñaron de qué cliente eran.' +
          (d.nombres_sin_ensenar ? ' ' + d.nombres_sin_ensenar + ' filas quedaron sin aprender (nombres sin enseñar).' : ''));
        excel_ = null; mov_.filtro = 'pendientes'; x_.ir('movimientos');
      });
    });
  }

  // --- Subir y revisar cartolas --------------------------------------------------------
  function leerArchivos(archivos) {
    if (!window.SigsoLectorXlsx) { aviso('No se pudo cargar el lector de Excel.'); return; }
    var lista = Array.prototype.slice.call(archivos || []);
    revisiones_ = lista.map(function (a) { return { nombre: a.name, estado: 'leyendo' }; });
    pintarRevisiones();
    lista.reduce(function (p, a, i) {
      return p.then(function () {
        return SigsoLectorXlsx.leer(a).then(function (hojas) {
          var filas = (hojas[0] && hojas[0].filas) || [];
          revisiones_[i].filas = filas;
          return x_.api('finanzasRevisarCartola', { filas: filas }).then(function (r) {
            if (r && r.ok) { revisiones_[i].estado = 'lista'; revisiones_[i].rev = r.data; revisiones_[i].empresa = r.data.cuenta_conocida ? r.data.cuenta_conocida.empresa : 'HomePymes'; }
            else { revisiones_[i].estado = 'error'; revisiones_[i].error = (r && r.message) || 'No se pudo revisar.'; }
          });
        }).catch(function () { revisiones_[i].estado = 'error'; revisiones_[i].error = 'El archivo no es un Excel válido.'; })
          .then(pintarRevisiones);
      });
    }, Promise.resolve());
  }
  function pintarRevisiones() {
    var cont = document.getElementById('finb-revision');
    if (!cont) return;
    if (!revisiones_.length) { cont.innerHTML = ''; return; }
    var listas = revisiones_.filter(function (r) { return r.estado === 'lista' && r.rev.nuevas > 0 && r.rev.cuadra; });
    cont.innerHTML = U.card({ titulo: 'Cartolas por importar', icono: 'documento', cuerpo:
      '<div class="fin2-revs">' + revisiones_.map(function (r, i) {
        if (r.estado === 'leyendo') return '<div class="fin2-rev">' + U.ico('reloj', 16) + '<b>' + txt(r.nombre) + '</b><span>Leyendo…</span></div>';
        if (r.estado === 'error') return '<div class="fin2-rev fin2-rev--mal">' + U.ico('alerta', 16) + '<b>' + txt(r.nombre) + '</b><span>' + txt(r.error) + '</span></div>';
        if (r.estado === 'importada') return '<div class="fin2-rev fin2-rev--ok">' + U.ico('check', 16) + '<b>' + txt(r.nombre) + '</b><span>Importada: ' + r.resultado.nuevas + ' movimientos nuevos.</span></div>';
        var v = r.rev, c = v.certezas, tot = v.movimientos || 1;
        return '<div class="fin2-rev' + (v.cuadra ? '' : ' fin2-rev--mal') + '">' +
          '<div class="fin2-rev__cab"><b>' + txt(v.banco) + ' ···' + txt(v.ultimos4) + '</b><span>' + txt(fechaCorta(v.desde)) + ' al ' + txt(fechaCorta(v.hasta)) + '</span>' +
            (v.cuadra ? U.badge('El saldo cuadra', 'ok') : U.badge('No cuadra', 'critico')) + '</div>' +
          '<div class="fin2-rev__nums"><span>Saldo anterior <b>' + plata(v.saldo_anterior) + '</b></span><span>Entró <b>' + plata(v.total_abonos) + '</b></span>' +
            '<span>Salió <b>' + plata(v.total_cargos) + '</b></span><span>Saldo final <b>' + plata(v.saldo_final) + '</b></span></div>' +
          '<div class="fin2-rev__cert" title="Cuánto reconocería el sistema">' +
            '<i style="flex:' + c.alta + ';background:var(--sx-ok)"></i><i style="flex:' + c.media + ';background:var(--sx-alerta)"></i><i style="flex:' + c.baja + ';background:var(--sx-borde-fuerte)"></i></div>' +
          '<p class="fin2-ayuda">' + v.movimientos + ' movimientos · <b>' + v.nuevas + ' nuevos</b>' + (v.repetidas ? ' · ' + v.repetidas + ' ya estaban (no se duplican)' : '') +
            ' · el sistema reconoce ' + c.alta + ' seguro(s), ' + c.media + ' con sugerencia y ' + c.baja + ' sin pista.</p>' +
          (v.cuadra ? '' : '<p class="fin2-error">' + txt(v.errores[0] || '') + '</p>') +
          (v.cuenta_conocida ? '<p class="fin2-ayuda">Cuenta de <b>' + txt(v.cuenta_conocida.empresa) + '</b>.</p>'
            : '<label class="fin2-label">Esta cuenta es nueva (titular: ' + txt(v.titular) + '). ¿De qué empresa es?' +
              '<select class="fin2-input js-finb-empresa" data-i="' + i + '">' + cat_.empresas.map(function (e) { return '<option' + (e === r.empresa ? ' selected' : '') + '>' + txt(e) + '</option>'; }).join('') + '</select></label>') +
        '</div>';
      }).join('') + '</div>' +
      '<div class="fin2-acciones">' + U.boton({ texto: 'Descartar', clase: 'js-finb-descartar' }) +
        U.boton({ texto: listas.length ? 'Importar ' + listas.length + ' cartola(s)' : 'Nada nuevo para importar', icono: 'check', variante: 'primario', clase: 'js-finb-importar', deshabilitado: !listas.length }) + '</div>' });
  }
  function importar() {
    var pend = revisiones_.filter(function (r) { return r.estado === 'lista' && r.rev.nuevas > 0 && r.rev.cuadra; });
    var ultimoPeriodo = '';
    pend.reduce(function (p, r) {
      return p.then(function () {
        return x_.api('finanzasImportarCartola', { filas: r.filas, empresa: r.empresa, nombre_archivo: r.nombre }).then(function (res) {
          if (res && res.ok) { r.estado = 'importada'; r.resultado = res.data; ultimoPeriodo = (r.rev.hasta || '').slice(0, 7) || ultimoPeriodo; }
          else { r.estado = 'error'; r.error = (res && res.message) || 'No se pudo importar.'; }
          pintarRevisiones();
        });
      });
    }, Promise.resolve()).then(function () {
      var n = revisiones_.filter(function (r) { return r.estado === 'importada'; }).reduce(function (s, r) { return s + r.resultado.nuevas; }, 0);
      if (n) {
        aviso(n + ' movimientos importados. Ahora a revisarlos.');
        mov_.periodo = ultimoPeriodo; mov_.filtro = 'pendientes';
        revisiones_ = [];
        x_.ir('movimientos');
      }
    });
  }
  function aprender(archivo) {
    SigsoLectorXlsx.leer(archivo, { hojas: function (n) { return /CUENTA BANCARIA/i.test(n); } }).then(function (hojas) {
      if (!hojas.length) { aviso('Ese Excel no tiene la hoja CUENTA BANCARIA.'); return; }
      return x_.api('finanzasAprenderPlanilla', { filas: hojas[0].filas }).then(function (r) {
        if (!r || !r.ok) { aviso((r && r.message) || 'No se pudo leer la planilla.'); return; }
        aviso('Listo: ' + r.data.emparejados + ' movimientos con sugerencia de la planilla y ' + r.data.reglas + ' reglas nuevas.');
        verBancos(x_);
      });
    }).catch(function () { aviso('El archivo no es un Excel válido.'); });
  }

  // =====================================================================================
  // Movimientos — Etapa B (2026-10-07): una lista a lo ancho, sin barra horizontal.
  // Cada fila dice qué es (o qué propone el sistema); al tocarla se abre un panel
  // lateral con todo lo que se sabe del movimiento para clasificarlo con calma.
  // =====================================================================================
  var AYUDA_TIPO = {
    INGRESO: 'Plata que la empresa ganó: honorarios, servicio mensual, renta.',
    EGRESO: 'Lo que la empresa gasta para funcionar: sueldos, arriendo, banco…',
    FONDO_RECIBIDO: 'Plata que un cliente manda para pagar SUS imposiciones, IVA, sueldos…',
    FONDO_PAGADO: 'Pago a Previred, SII, Tesorería o sueldos hecho con la plata de un cliente.',
    TRASPASO: 'Entre dos cuentas de la MISMA empresa.',
    PRESTAMO: 'Con otra empresa del grupo (se lleva la cuenta de lo que se deben).'
  };
  var FILTROS = [['pendientes', 'Por revisar'], ['propuesta', 'Con propuesta'], ['sinpista', 'Sin pista'], ['confirmados', 'Confirmados'], ['todos', 'Todos']];
  var panel_ = null;      // { api, id }

  function verMovimientos(x) {
    x_ = x; enlazar();
    var t = x.turno();
    x.pagina(x.cab('Movimientos') + U.esqueleto('tabla', 10));
    Promise.all([x.api('finanzasMovimientos', { periodo: mov_.periodo }), catalogo()]).then(function (rs) {
      if (!x.vigente(t)) return;
      var r = rs[0];
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('Movimientos') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: r.message || '' }) })); return; }
      mov_.datos = r.data; mov_.periodo = r.data.periodo; mov_.sel = {}; mov_.avisos = {};
      pintarMovimientos();
    });
  }
  function sentidoDe(m) { return m.abono > 0 ? 'abono' : 'cargo'; }
  function completa(c, sentido) {
    var t = tipo(c && c.tipo);
    if (!t) return false;
    if (t.sentido && t.sentido !== sentido) return false;
    return (!t.cuentas.length || t.cuentas.indexOf(c.cuenta) !== -1) && (!t.cliente || c.cliente_id) && (!t.empresa || c.empresa);
  }
  function grupo(m) {
    if (m.estado === 'CONFIRMADO') return 'confirmados';
    return completa(m.sugerencia, sentidoDe(m)) ? 'propuesta' : 'sinpista';
  }
  function busca(m, q) {
    if (!q) return true;
    var s = [m.glosa, m.detalle && m.detalle.descripcion, m.planilla && m.planilla.alias, (m.clasif || m.sugerencia || {}).cliente, (m.clasif || m.sugerencia || {}).cuenta, String(m.abono || m.cargo)].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).every(function (w) { return s.indexOf(w) !== -1 || s.replace(/\./g, '').indexOf(w.replace(/\./g, '')) !== -1; });
  }
  function visibles() {
    var l = (mov_.datos && mov_.datos.movimientos) || [];
    var f = mov_.filtro, q = (mov_.busca || '').trim();
    return l.filter(function (m) {
      if (!busca(m, q)) return false;
      if (f === 'pendientes') return m.estado !== 'CONFIRMADO';
      if (f === 'todos') return true;
      return grupo(m) === f;
    });
  }
  function selectorMes() {
    var ps = (mov_.datos && mov_.datos.periodos) || [];
    return '<select class="fin2-input fin2-input--sm js-finm-mes" aria-label="Mes">' + ps.map(function (p) {
      return '<option value="' + txt(p.periodo) + '"' + (p.periodo === mov_.periodo ? ' selected' : '') + '>' + txt(mesTexto(p.periodo)) + (p.pendientes ? ' · ' + p.pendientes + ' por revisar' : '') + '</option>';
    }).join('') + '</select>';
  }
  function pintarMovimientos() {
    var d = mov_.datos;
    if (!d.movimientos.length && !d.periodos.length) {
      x_.pagina(x_.cab('Movimientos') + U.card({ cuerpo: U.vacio({ icono: 'documento', titulo: 'Todavía no hay cartolas', texto: 'Sube la primera cartola en Bancos.',
        accion: U.boton({ texto: 'Ir a Bancos', icono: 'derecha', variante: 'primario', clase: 'js-finb-ir-bancos' }) }) }));
      return;
    }
    var s = d.resumen;
    var cuenta = { pendientes: 0, propuesta: 0, sinpista: 0, confirmados: 0, todos: d.movimientos.length };
    d.movimientos.forEach(function (m) { var g = grupo(m); cuenta[g]++; if (g !== 'confirmados') cuenta.pendientes++; });
    var seguras = d.movimientos.filter(function (m) { return m.estado !== 'CONFIRMADO' && m.sugerencia && m.sugerencia.certeza === 'alta' && completa(m.sugerencia, sentidoDe(m)); }).length;
    var avance = s.total ? Math.round(s.confirmados / s.total * 100) : 0;
    x_.pagina(x_.cab('Movimientos') +
      '<div class="fin2-barra-mes sx2-entra">' + selectorMes() +
        '<span class="fin2-avance" title="Confirmados del mes"><span style="width:' + avance + '%"></span></span><span class="fin2-ayuda">' + avance + ' % revisado</span>' +
        '<label class="fin2-busca">' + U.ico('lupa', 14) + '<input class="js-finm-busca" type="search" placeholder="Buscar nombre, cliente o monto" value="' + txt(mov_.busca || '') + '" aria-label="Buscar"></label>' +
      '</div>' +
      '<div class="fin2-tiras">' +
        tira('Ingresos de la empresa', s.INGRESO, 'ok') + tira('Gastos de la empresa', s.EGRESO, 'critico') +
        tira('Fondos de clientes recibidos', s.FONDO_RECIBIDO, 'info') + tira('Pagado por cuenta de clientes', s.FONDO_PAGADO, 'info') +
        tira('Traspasos y préstamos', s.TRASPASO_ENTRA + s.TRASPASO_SALE + s.PRESTAMO_ENTRA + s.PRESTAMO_SALE, 'neutro') + tira('Por revisar', s.pendiente_monto, 'alerta') +
      '</div>' +
      '<div class="fin2-filtros sx2-entra" role="group" aria-label="Qué mostrar">' + FILTROS.map(function (f) {
        return U.chip({ texto: f[1], n: cuenta[f[0]], activo: mov_.filtro === f[0], clase: 'js-finm-filtro', datos: { id: f[0] } });
      }).join('') + '</div>' +
      '<div class="fin2-lote sx2-entra">' +
        U.boton({ texto: 'Confirmar las seguras (' + seguras + ')', icono: 'check', variante: 'primario', sm: true, clase: 'js-finm-seguras', deshabilitado: !seguras }) +
        U.boton({ texto: 'Marcar las con propuesta', icono: 'lista', sm: true, clase: 'js-finm-marcar' }) +
        U.boton({ texto: 'Confirmar marcadas', icono: 'check', sm: true, clase: 'js-finm-conf-sel', deshabilitado: true }) +
        '<span class="fin2-ayuda fin2-ayuda--teclas">Toca un movimiento para ver todo y clasificarlo. Teclas: ↑ ↓ para moverte, Enter para abrir.</span>' +
      '</div>' +
      '<div class="fin2-lista sx2-entra js-finm-lista" role="list">' + listaHtml() + '</div>' +
      '<datalist id="finm-clientes">' + cat_.clientes.map(function (c) { return '<option value="' + txt(c.nombre) + '">' + txt(c.rut) + '</option>'; }).join('') + '</datalist>');
    actualizarSel();
  }
  function listaHtml() {
    var l = visibles();
    if (!l.length) return U.vacio({ icono: 'check', titulo: 'Nada en esta vista', texto: mov_.filtro === 'pendientes' && !mov_.busca ? 'El mes está completamente revisado.' : 'Prueba con otro filtro o búsqueda.' });
    return '<div class="fin2-lista__cab" aria-hidden="true"><span><input type="checkbox" class="js-finm-todos" aria-label="Marcar todos"></span><span>Fecha</span><span>Movimiento</span><span class="fin2-der">Monto</span><span>Qué es</span><span></span></div>' +
      l.map(fila).join('');
  }
  function tira(t, v, tono) { return '<div class="fin2-tira sx2-tono-' + tono + '"><span>' + txt(t) + '</span><b>' + plata(v) + '</b></div>'; }

  function opciones(lista, actual, vacio) {
    return (vacio ? '<option value="">' + txt(vacio) + '</option>' : '') + lista.map(function (o) {
      var id = typeof o === 'string' ? o : o.id, nom = typeof o === 'string' ? o : o.nombre;
      return '<option value="' + txt(id) + '"' + (id === actual ? ' selected' : '') + '>' + txt(nom) + '</option>';
    }).join('');
  }
  // Etapa A: lo que agrega el detalle del banco y el Excel BANCOS bajo la glosa.
  function pistas(m, compacto) {
    var h = '';
    if (m.detalle && m.detalle.descripcion) h += '<span class="fin2-pista">' + U.ico('lupa', 12) + '<span>' + txt(m.detalle.descripcion) + '</span></span>';
    if (m.planilla && (m.planilla.alias || m.planilla.obs)) h += '<span class="fin2-pista">' + U.ico('documento', 12) + '<span>Excel: ' + txt([m.planilla.alias, m.planilla.obs, m.planilla.plan].filter(Boolean).join(' · ')) + '</span></span>';
    if (compacto) return h;
    var op = m.estado !== 'CONFIRMADO' && m.sugerencia && m.sugerencia.opciones;
    if (op && op.length) h += '<span class="fin2-opciones">Ha pagado por: ' + op.map(function (o) {
      return '<button type="button" class="fin2-chip js-finm-opc" data-cliente="' + txt(o.cliente) + '">' + txt(o.cliente) + (o.veces > 1 ? ' ×' + o.veces : '') + '</button>';
    }).join('') + '</span>';
    return h;
  }
  function resumenClasif(c) {
    if (!c) return '';
    if (c.partes) return 'Dividido en ' + c.partes.length + ': ' + c.partes.map(function (p) { return plata(p.monto) + ' ' + ((tipo(p.tipo) || {}).nombre || p.tipo) + (p.cliente || p.cuenta ? ' (' + (p.cliente || p.cuenta) + ')' : ''); }).join(' + ');
    var t = tipo(c.tipo);
    if (!t) return '';
    return [t.nombre, c.cuenta, c.cliente, c.empresa, c.reparto && c.reparto.length ? 'repartido entre ' + c.reparto.length : ''].filter(Boolean).join(' · ');
  }
  function fila(m) {
    var g = grupo(m);
    var c = m.estado === 'CONFIRMADO' ? m.clasif : m.sugerencia;
    var cert = m.estado === 'CONFIRMADO' ? 'ok' : ({ alta: 'alta', media: 'media' }[(m.sugerencia || {}).certeza] || 'baja');
    var que = resumenClasif(c);
    var conAviso = m.estado !== 'CONFIRMADO' && mov_.avisos[m.id];
    var estado = m.estado === 'CONFIRMADO' ? '<span class="fin2-que__eti fin2-que__eti--ok">' + U.ico('check', 12) + 'Confirmado</span>'
      : g === 'propuesta' ? '<span class="fin2-que__eti fin2-que__eti--' + cert + '">' + (cert === 'alta' ? 'Segura' : 'Propuesta') + '</span>'
      : '<span class="fin2-que__eti fin2-que__eti--baja">Falta decir qué es</span>';
    if (conAviso) estado = '<span class="fin2-que__eti fin2-que__eti--media">' + U.ico('alerta', 12) + 'Revisar el aviso</span>';
    return '<div class="fin2-mov fin2-mov--' + cert + (panel_ && panel_.id === m.id ? ' fin2-mov--abierto' : '') + (conAviso ? ' fin2-mov--aviso' : '') + '" role="listitem" tabindex="0" data-id="' + txt(m.id) + '"' + (conAviso ? ' title="' + txt(conAviso) + '"' : '') + '>' +
      '<span class="fin2-chk"><input type="checkbox" class="js-finm-chk"' + (mov_.sel[m.id] ? ' checked' : '') + (g !== 'propuesta' ? ' disabled' : '') + ' aria-label="Marcar"></span>' +
      '<span class="fin2-mov__fecha">' + txt(fechaCorta(m.fecha)) + '</span>' +
      '<span class="fin2-mov__txt"><b class="fin2-glosa">' + txt(m.glosa) + '</b>' + pistas(m, true) + '</span>' +
      '<span class="fin2-mov__monto ' + (m.abono ? 'fin2-pos' : '') + '">' + (m.abono ? '+' : '−') + plata(m.abono || m.cargo) + '</span>' +
      '<span class="fin2-que">' + estado + (que ? '<span class="fin2-que__txt">' + txt(que) + '</span>' : '') + '</span>' +
      '<span class="fin2-mov__acc">' + (g === 'propuesta'
        ? U.boton({ soloIcono: true, icono: 'check', sm: true, variante: 'secundario', titulo: 'Aceptar la propuesta', clase: 'js-finm-aceptar' }) : '') +
        U.boton({ soloIcono: true, icono: 'derecha', sm: true, variante: 'fantasma', titulo: 'Abrir', clase: 'js-finm-abrir' }) + '</span>' +
    '</div>';
  }
  function detalle(c, enParte) {
    var t = tipo(c.tipo);
    if (!t) return '<span class="fin2-ayuda">Primero elige qué es</span>';
    var h = '';
    if (t.cuentas.length) h += campoP(t.cliente ? 'Concepto' : 'Cuenta', '<select class="fin2-input fin2-input--sm js-finm-cuenta">' + opciones(t.cuentas, c.cuenta, 'Elige…') + '</select>', enParte);
    if (t.cliente || t.id === 'INGRESO') h += campoP(t.cliente ? 'Cliente' : 'Cliente (opcional)', '<input class="fin2-input fin2-input--sm js-finm-cliente" list="finm-clientes" value="' + txt(c.cliente || '') + '" placeholder="Escribe para buscar">', enParte);
    if (t.empresa) h += campoP('Empresa', '<select class="fin2-input fin2-input--sm js-finm-empresa">' + opciones(cat_.empresas, c.empresa, 'Elige…') + '</select>', enParte);
    // Etapa 5: un gasto se puede repartir en partes iguales entre empresas del grupo.
    if (t.id === 'EGRESO' && cat_.repartos && !enParte) {
      var actual = (c.reparto || []).slice().sort().join('|');
      var elegido = (cat_.repartos.filter(function (r) { return r.empresas.slice().sort().join('|') === actual; })[0] || {}).id || '';
      h += campoP('¿Gasto compartido?', '<select class="fin2-input fin2-input--sm js-finm-reparto">' +
        '<option value="">No se reparte</option>' + cat_.repartos.map(function (r) { return '<option value="' + txt(r.id) + '"' + (r.id === elegido ? ' selected' : '') + '>' + txt(r.nombre) + '</option>'; }).join('') + '</select>', false);
    }
    return h || '<span class="fin2-ayuda">No pide más datos.</span>';
  }
  function campoP(etiqueta, control, enParte) {
    return enParte ? control : '<label class="fin2-campo"><span>' + txt(etiqueta) + '</span>' + control + '</label>';
  }
  function leerFila(el) {
    var q = function (s) { var e = el.querySelector(s); return e ? e.value.trim() : ''; };
    var t = el.querySelector('.js-finm-tipo:checked') || el.querySelector('select.js-finm-tipo');
    var nombre = q('.js-finm-cliente');
    var cli = nombre ? cat_.clientes.filter(function (c) { return c.nombre === nombre; })[0] : null;
    var rep = q('.js-finm-reparto');
    var preset = rep && cat_.repartos ? cat_.repartos.filter(function (r) { return r.id === rep; })[0] : null;
    return { id: el.dataset.id, tipo: t ? t.value : '', cuenta: q('.js-finm-cuenta'), cliente_id: cli ? cli.id : '', empresa: q('.js-finm-empresa'), reparto: preset ? preset.empresas : [], nota: q('.js-finm-nota'), _clienteEscrito: nombre && !cli };
  }
  function desdeSugerencia(m) {
    var s = m.sugerencia || {};
    return { id: m.id, tipo: s.tipo, cuenta: s.cuenta, cliente_id: s.cliente_id, empresa: s.empresa, reparto: s.reparto || [], nota: '' };
  }
  function guardar(items) {
    var malos = items.filter(function (i) { return i._clienteEscrito; });
    if (malos.length) { aviso('Hay un cliente escrito que no está en la lista de SIGSO. Elígelo de la lista.'); return Promise.resolve(null); }
    items = items.map(function (i) { var o = Object.assign({}, i); delete o._clienteEscrito; return o; });
    return x_.api('finanzasClasificar', { items: items }).then(function (r) {
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) aviso((r && r.message) || 'No se pudo guardar.'); return null; }
      var e = r.data.errores || [];
      e.forEach(function (er) { var tr = document.querySelector('.fin2-mov[data-id="' + er.id + '"]'); if (tr) { tr.classList.add('fin2-mov--error'); tr.title = er.mensaje; } });
      aviso(r.data.hechos + ' guardado(s)' + (r.data.reglas ? ' · el sistema aprendió ' + r.data.reglas + ' glosa(s)' : '') + (e.length ? ' · ' + e.length + ' con error: ' + e[0].mensaje : ''));
      if (r.data.hechos) return recargar().then(function () { return r.data; });
      return r.data;
    });
  }
  function recargar() {
    return x_.api('finanzasMovimientos', { periodo: mov_.periodo }).then(function (r) {
      if (r && r.ok) { mov_.datos = r.data; mov_.sel = {}; pintarMovimientos(); }
    });
  }
  function actualizarSel() {
    var n = Object.keys(mov_.sel).filter(function (k) { return mov_.sel[k]; }).length;
    var b = document.querySelector('.js-finm-conf-sel'); if (b) { b.disabled = !n; b.lastChild.textContent = n ? 'Confirmar marcadas (' + n + ')' : 'Confirmar marcadas'; }
  }
  function refrescarLista() {
    var l = document.querySelector('.js-finm-lista'); if (l) l.innerHTML = listaHtml();
    document.querySelectorAll('.js-finm-filtro').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.id === mov_.filtro ? 'true' : 'false'); });
    actualizarSel();
  }

  // --- Panel lateral: todo lo del movimiento y el formulario -----------------------------
  function movDe(id) { return ((mov_.datos && mov_.datos.movimientos) || []).filter(function (m) { return m.id === id; })[0]; }
  function vecino(id, paso) {
    var l = visibles(), i = l.map(function (m) { return m.id; }).indexOf(id);
    return i === -1 ? null : l[i + paso] || null;
  }
  function abrirPanel(id) {
    var m = movDe(id); if (!m) return;
    var c = m.estado === 'CONFIRMADO' && m.clasif ? m.clasif : (m.sugerencia || {});
    var sentido = sentidoDe(m);
    var tipos = cat_.tipos.filter(function (t) { return !t.sentido || t.sentido === sentido; });
    var l = visibles(), pos = l.map(function (x) { return x.id; }).indexOf(id);
    var s = m.sugerencia || {};
    var sug = m.estado === 'CONFIRMADO'
      ? '<div class="fin2-p-caja fin2-p-caja--ok">' + U.ico('check', 16) + '<span>Confirmado por <b>' + txt(m.actualizado_por) + '</b>' + (resumenClasif(m.clasif) ? ': ' + txt(resumenClasif(m.clasif)) : '') + '. Puedes cambiarlo.</span></div>'
      : s.motivo ? '<div class="fin2-p-caja fin2-p-caja--' + ({ alta: 'ok', media: 'info' }[s.certeza] || 'alerta') + '">' + U.ico(s.certeza === 'baja' || !s.certeza ? 'alerta' : 'bombilla', 16) +
        '<span><b>' + (s.certeza === 'alta' ? 'El sistema está seguro' : s.certeza === 'media' ? 'Propuesta del sistema' : 'Ojo') + ':</b> ' + txt(s.motivo) + '</span></div>' : '';
    var cuerpo = '<div class="fin2-p" data-id="' + txt(m.id) + '">' +
      '<div class="fin2-p-monto ' + (m.abono ? 'fin2-pos' : '') + '">' + (m.abono ? '+' : '−') + plata(m.abono || m.cargo) + '<small>' + (m.abono ? 'entró' : 'salió') + ' el ' + txt(fechaCorta(m.fecha)) + ' · ' + txt((m.cuenta || {}).banco + ' ···' + (m.cuenta || {}).ultimos4) + '</small></div>' +
      '<section class="fin2-p-sec"><h3>Lo que dice el banco</h3><p class="fin2-glosa">' + txt(m.glosa) + (m.doc ? ' <span class="fin2-ayuda">· doc. ' + txt(m.doc) + '</span>' : '') + '</p>' + pistas(m) + '</section>' +
      sug +
      '<section class="fin2-p-sec"><h3>¿Qué es?</h3><div class="fin2-tipos" role="radiogroup">' + tipos.map(function (t) {
        return '<label class="fin2-tipo-op"><input type="radio" name="finm-tipo" class="js-finm-tipo" value="' + txt(t.id) + '"' + (t.id === c.tipo ? ' checked' : '') + '>' +
          '<span><b>' + txt(t.nombre) + '</b><small>' + txt(AYUDA_TIPO[t.id] || '') + '</small></span></label>';
      }).join('') + '</div></section>' +
      '<section class="fin2-p-sec js-finm-det">' + (c.partes ? '' : detalle(c)) + '</section>' +
      '<div class="js-finm-avisos" aria-live="polite"></div>' +
      '<label class="fin2-campo"><span>Nota (opcional)</span><input class="fin2-input fin2-input--sm js-finm-nota" value="' + txt(c.nota || '') + '" maxlength="300" placeholder="Ej.: pagó la hija del cliente"></label>' +
      '<div class="js-finm-zona-dividir">' + (c.partes ? cajaDividir(m, c.partes) : '<button type="button" class="fin2-enlace js-finm-dividir">' + U.ico('derivar', 14) + 'Esta transferencia es de varios clientes o conceptos: dividirla</button>') + '</div>' +
    '</div>';
    var pie = '<span class="fin2-ayuda">' + (pos === -1 ? '' : (pos + 1) + ' de ' + l.length) + '</span>' +
      U.boton({ soloIcono: true, icono: 'arriba', sm: true, variante: 'fantasma', titulo: 'Anterior', clase: 'js-finm-p-ant', deshabilitado: pos <= 0 }) +
      U.boton({ soloIcono: true, icono: 'abajo', sm: true, variante: 'fantasma', titulo: 'Siguiente', clase: 'js-finm-p-sig', deshabilitado: pos === -1 || pos >= l.length - 1 }) +
      U.boton({ texto: 'Guardar', icono: 'check', clase: 'js-finm-p-ok' }) +
      U.boton({ texto: 'Guardar y siguiente', icono: 'derecha', variante: 'primario', clase: 'js-finm-p-ok-sig' });
    var previo = panel_;
    panel_ = { id: id };
    panel_.api = U.drawer({ titulo: m.abono ? 'Entrada de plata' : 'Salida de plata', subtitulo: '<span class="fin2-ayuda">' + txt(mesTexto(mov_.periodo)) + '</span>', cuerpo: cuerpo, pie: pie,
      alCerrar: function () { if (panel_ && panel_.id === id && !panel_.cambiando) { panel_ = null; marcarAbierto(); } } });
    void previo;
    panel_.api.el.classList.add('fin2-panel');
    enlazarPanel(panel_.api.el);
    var cajaYa = panel_.api.el.querySelector('.fin2-dividir'); if (cajaYa) faltaDividir(cajaYa);
    revisarPanel(panel_.api.el.querySelector('.fin2-p'));
    marcarAbierto();
    var fila_ = document.querySelector('.fin2-mov[data-id="' + id + '"]'); if (fila_ && fila_.scrollIntoView) fila_.scrollIntoView({ block: 'nearest' });
  }
  function marcarAbierto() {
    document.querySelectorAll('.fin2-mov--abierto').forEach(function (e) { e.classList.remove('fin2-mov--abierto'); });
    if (panel_) { var f = document.querySelector('.fin2-mov[data-id="' + panel_.id + '"]'); if (f) f.classList.add('fin2-mov--abierto'); }
  }
  function cambiarPanel(id) { if (panel_) panel_.cambiando = true; abrirPanel(id); }
  // --- Etapa C: avisos antes de guardar ---------------------------------------------------
  // El panel revisa mientras se llena; al guardar, si hay alertas, la primera vez solo
  // las muestra y cambia el botón a «Guardar igual».
  function itemPanel(el) {
    var caja = el.querySelector('.fin2-dividir');
    if (caja) return itemDividir(caja);
    var it = leerFila(el);
    if (it._clienteEscrito) { aviso('Hay un cliente escrito que no está en la lista de SIGSO. Elígelo de la lista.'); return null; }
    return it;
  }
  function pintarAvisos(el, avisos, insistir) {
    var z = el.querySelector('.js-finm-avisos'); if (!z) return;
    if (!avisos.length) { z.innerHTML = ''; return; }
    var alertas = avisos.filter(function (a) { return a.nivel === 'alerta'; }).length;
    z.innerHTML = '<div class="fin2-avisos' + (insistir ? ' fin2-avisos--insiste' : '') + '">' +
      (insistir ? '<b>Antes de guardar, revisa ' + (alertas === 1 ? 'esto' : 'estos ' + alertas + ' avisos') + '.</b> Si está bien así, presiona «Guardar igual».' : '') +
      '<ul>' + avisos.map(function (a) {
        return '<li class="fin2-aviso fin2-aviso--' + a.nivel + '">' + U.ico(a.nivel === 'alerta' ? 'alerta' : 'info', 14) + '<span>' + txt(a.texto) + '</span></li>';
      }).join('') + '</ul></div>';
  }
  var revisarT_ = null;
  function revisarPanel(el, luego) {
    clearTimeout(revisarT_);
    revisarT_ = setTimeout(function () { revisarAhora(el); }, luego || 0);
  }
  function revisarAhora(el) {
    if (!el || !el.isConnected) return Promise.resolve(null);
    var caja = el.querySelector('.fin2-dividir');
    var it = caja ? itemDividir(caja, true) : leerFila(el);
    if (!it || (!it.tipo && !it.partes)) { pintarAvisos(el, []); return Promise.resolve({ avisos: [], alertas: 0 }); }
    delete it._clienteEscrito;
    var firma = JSON.stringify(it);
    return x_.api('finanzasRevisarAntes', { items: [it] }).then(function (r) {
      if (!r || !r.ok || !el.isConnected) return null;
      var av = (r.data.items[0] || {}).avisos || [];
      // Si cambió lo elegido, el permiso de «Guardar igual» ya no vale.
      if (el.dataset.firma !== firma) { el.dataset.firma = firma; el.dataset.guardarIgual = ''; botonesGuardar(el, false); }
      pintarAvisos(el, av, el.dataset.guardarIgual === '1');
      return { avisos: av, alertas: av.filter(function (a) { return a.nivel === 'alerta'; }).length, firma: firma };
    });
  }
  function botonesGuardar(el, igual) {
    var pie = el.closest('.sx2-drawer__panel'); if (!pie) return;
    var b1 = pie.querySelector('.js-finm-p-ok'), b2 = pie.querySelector('.js-finm-p-ok-sig');
    if (b1) b1.lastChild.textContent = igual ? 'Guardar igual' : 'Guardar';
    if (b2) b2.lastChild.textContent = igual ? 'Guardar igual y seguir' : 'Guardar y siguiente';
  }
  function guardarPanel(el, siguiente) {
    var it = itemPanel(el);
    if (!it) return;
    clearTimeout(revisarT_);
    revisarAhora(el).then(function (rv) {
      if (rv && rv.alertas && el.dataset.guardarIgual !== '1') {
        el.dataset.guardarIgual = '1';
        botonesGuardar(el, true);
        pintarAvisos(el, rv.avisos, true);
        var z = el.querySelector('.js-finm-avisos'); if (z && z.scrollIntoView) z.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
      guardarPanelYa(el, it, siguiente);
    });
  }
  function guardarPanelYa(el, it, siguiente) {
    var id = el.dataset.id;
    var sig = vecino(id, 1);
    var p = guardar([it]);
    p.then(function (res) {
      if (!res || !res.hechos) return;
      if (!siguiente) { if (panel_) { panel_.cambiando = false; panel_.api.cerrar(); } return; }
      // El siguiente de la lista (si el filtro sacó al actual, el que venía después).
      var prox = sig && movDe(sig.id) ? sig.id : (visibles()[0] || {}).id;
      if (prox && prox !== id) cambiarPanel(prox); else if (panel_) { panel_.api.cerrar(); aviso('Listo: no quedan más en esta vista.'); }
    });
  }

  // --- Dividir: una transferencia que paga a varios clientes o mezcla conceptos --------
  function parte(p, sentido) {
    var tipos = cat_.tipos.filter(function (t) { return !t.sentido || t.sentido === sentido; });
    return '<div class="fin2-parte js-finm-parte">' +
      '<input class="fin2-input fin2-input--sm fin2-der js-finm-pmonto" inputmode="numeric" placeholder="Monto" aria-label="Monto de la parte" value="' + (p.monto ? Math.round(p.monto).toLocaleString('es-CL') : '') + '">' +
      '<select class="fin2-input fin2-input--sm js-finm-ptipo" aria-label="Qué es esta parte">' + opciones(tipos, p.tipo || '', '¿Qué es?') + '</select>' +
      '<span class="fin2-parte__det js-finm-pdet">' + detalle(p, true) + '</span>' +
      U.boton({ soloIcono: true, icono: 'equis', sm: true, variante: 'fantasma', titulo: 'Quitar esta parte', clase: 'js-finm-pquitar' }) + '</div>';
  }
  function cajaDividir(m, base) {
    return '<div class="fin2-dividir" data-total="' + (m.abono || m.cargo) + '" data-sentido="' + sentidoDe(m) + '">' +
      '<h3>Dividir ' + plata(m.abono || m.cargo) + '</h3>' +
      '<p class="fin2-ayuda">Por ejemplo, una transferencia que paga a dos clientes, o que trae honorario y plata para imposiciones. Las partes tienen que sumar exacto.</p>' +
      '<div class="js-finm-partes">' + base.map(function (p) { return parte(p, sentidoDe(m)); }).join('') + '</div>' +
      '<div class="fin2-acciones" style="align-items:center;justify-content:space-between">' + U.boton({ texto: 'Agregar parte', icono: 'nueva', sm: true, clase: 'js-finm-pmas' }) +
        '<span class="fin2-ayuda js-finm-pfalta"></span>' + U.boton({ texto: 'No dividir', sm: true, variante: 'fantasma', clase: 'js-finm-pcancelar' }) + '</div></div>';
  }
  function abrirDividir(el) {
    var m = movDe(el.dataset.id); if (!m) return;
    var f = leerFila(el);
    var base = [{ monto: 0, tipo: f.tipo, cuenta: f.cuenta, cliente: (el.querySelector('.js-finm-cliente') || {}).value || '', empresa: f.empresa }, { monto: 0, tipo: f.tipo }];
    el.querySelector('.js-finm-zona-dividir').innerHTML = cajaDividir(m, base);
    el.querySelector('.js-finm-det').hidden = true;
    faltaDividir(el.querySelector('.fin2-dividir'));
  }
  function montoDe(v) { return Number(String(v || '').replace(/[^0-9]/g, '')) || 0; }
  function faltaDividir(caja) {
    var total = Number(caja.dataset.total), suma = 0;
    caja.querySelectorAll('.js-finm-pmonto').forEach(function (i) { suma += montoDe(i.value); });
    var el = caja.querySelector('.js-finm-pfalta'), dif = total - suma;
    el.innerHTML = dif === 0 ? '<span class="fin2-pos">✓ Suma exacta</span>' : dif > 0 ? 'Falta asignar <b>' + plata(dif) + '</b>' : '<span class="fin2-neg">Te pasaste por ' + plata(-dif) + '</span>';
    caja.dataset.cuadra = dif === 0 ? '1' : '';
  }
  function itemDividir(caja, callado) {
    var el = caja.closest('.fin2-p');
    if (!caja.dataset.cuadra) { if (!callado) aviso('Las partes tienen que sumar exacto el monto del movimiento.'); return null; }
    var partes = [], malo = '';
    caja.querySelectorAll('.js-finm-parte').forEach(function (d) {
      var q = function (s) { var e = d.querySelector(s); return e ? e.value.trim() : ''; };
      var nombre = q('.js-finm-cliente');
      var cli = nombre ? cat_.clientes.filter(function (c) { return c.nombre === nombre; })[0] : null;
      if (nombre && !cli) malo = 'El cliente «' + nombre + '» no está en la lista de SIGSO.';
      if (!q('.js-finm-ptipo')) malo = malo || 'Cada parte necesita decir qué es.';
      partes.push({ monto: montoDe(q('.js-finm-pmonto')), tipo: q('.js-finm-ptipo'), cuenta: q('.js-finm-cuenta'), cliente_id: cli ? cli.id : '', empresa: q('.js-finm-empresa') });
    });
    if (partes.length < 2) malo = malo || 'Para dividir se necesitan al menos dos partes.';
    if (malo) { if (!callado) aviso(malo); return null; }
    var nota = el.querySelector('.js-finm-nota') ? el.querySelector('.js-finm-nota').value.trim() : '';
    return { id: el.dataset.id, partes: partes, nota: nota };
  }

  // Lotes (aceptar de a una, marcadas, seguras): lo que tiene alertas NO se confirma solo.
  function confirmarConRevision(items, boton) {
    if (!items.length) return;
    if (boton) boton.disabled = true;
    x_.api('finanzasRevisarAntes', { items: items }).then(function (r) {
      if (!r || !r.ok) { if (boton) boton.disabled = false; if (r && !r.boveda_cerrada) aviso((r && r.message) || 'No se pudo revisar.'); return; }
      var conAlerta = {};
      r.data.items.forEach(function (x) {
        var al = x.avisos.filter(function (a) { return a.nivel === 'alerta'; });
        if (al.length) conAlerta[x.id] = al.map(function (a) { return a.texto; }).join(' · ');
      });
      var limpios = items.filter(function (it) { return !conAlerta[it.id]; });
      var n = Object.keys(conAlerta).length;
      if (items.length === 1 && n) { abrirPanel(items[0].id); aviso('Esta propuesta tiene un aviso: revísalo antes de confirmar.'); return; }
      var hecho = limpios.length ? guardar(limpios) : Promise.resolve(null);
      hecho.then(function () {
        Object.keys(conAlerta).forEach(function (id) { mov_.avisos[id] = conAlerta[id]; });
        if (n) { refrescarLista(); aviso((limpios.length ? limpios.length + ' confirmado(s). ' : '') + n + ' quedaron sin confirmar porque tienen avisos: están marcados «Revisar el aviso».'); }
        if (boton) boton.disabled = false;
      });
    });
  }

  // =====================================================================================
  // Eventos (una sola vez, sobre la raíz del módulo; el panel tiene los suyos)
  // =====================================================================================
  function enlazarPanel(el) {
    el.addEventListener('change', function (ev) {
      var e = ev.target;
      if (e.classList.contains('js-finm-tipo')) {
        var p = e.closest('.fin2-p'), det = p.querySelector('.js-finm-det');
        det.innerHTML = detalle({ tipo: e.value, cuenta: (p.querySelector('.js-finm-cuenta') || {}).value, cliente: (p.querySelector('.js-finm-cliente') || {}).value || '', empresa: (p.querySelector('.js-finm-empresa') || {}).value });
        var foco = det.querySelector('select, input'); if (foco) foco.focus();
      } else if (e.classList.contains('js-finm-ptipo')) {
        var dp = e.closest('.js-finm-parte');
        dp.querySelector('.js-finm-pdet').innerHTML = detalle({ tipo: e.value, cliente: (dp.querySelector('.js-finm-cliente') || {}).value || '' }, true);
      }
    });
    el.addEventListener('input', function (ev) {
      if (ev.target.classList.contains('js-finm-pmonto')) faltaDividir(ev.target.closest('.fin2-dividir'));
      if (!ev.target.classList.contains('js-finm-nota')) revisarPanel(el.querySelector('.fin2-p'), 450);
    });
    el.addEventListener('change', function (ev) {
      if (!ev.target.classList.contains('js-finm-nota')) revisarPanel(el.querySelector('.fin2-p'), 150);
    });
    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target.tagName !== 'BUTTON' && ev.target.tagName !== 'TEXTAREA' && ev.target.closest('.fin2-p')) {
        ev.preventDefault(); guardarPanel(ev.target.closest('.fin2-p'), true);
      }
    });
    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      var p = el.querySelector('.fin2-p');
      if (b.classList.contains('js-finm-p-ok')) guardarPanel(p, false);
      else if (b.classList.contains('js-finm-p-ok-sig')) guardarPanel(p, true);
      else if (b.classList.contains('js-finm-p-sig')) { var s = vecino(p.dataset.id, 1); if (s) cambiarPanel(s.id); }
      else if (b.classList.contains('js-finm-p-ant')) { var a = vecino(p.dataset.id, -1); if (a) cambiarPanel(a.id); }
      else if (b.classList.contains('js-finm-opc')) {
        var inp = p.querySelector('.js-finm-cliente');
        if (inp) { inp.value = b.dataset.cliente; inp.focus(); } else aviso('Primero elige qué es el movimiento.');
      }
      else if (b.classList.contains('js-finm-dividir')) abrirDividir(p);
      else if (b.classList.contains('js-finm-pmas')) {
        var cj = b.closest('.fin2-dividir');
        cj.querySelector('.js-finm-partes').insertAdjacentHTML('beforeend', parte({}, cj.dataset.sentido)); faltaDividir(cj);
      }
      else if (b.classList.contains('js-finm-pquitar')) { var cq = b.closest('.fin2-dividir'); b.closest('.js-finm-parte').remove(); faltaDividir(cq); }
      else if (b.classList.contains('js-finm-pcancelar')) {
        p.querySelector('.js-finm-zona-dividir').innerHTML = '<button type="button" class="fin2-enlace js-finm-dividir">' + U.ico('derivar', 14) + 'Esta transferencia es de varios clientes o conceptos: dividirla</button>';
        var det = p.querySelector('.js-finm-det'); det.hidden = false;
        var t = p.querySelector('.js-finm-tipo:checked'); det.innerHTML = detalle({ tipo: t ? t.value : '' });
      }
    });
  }

  var enlazado_ = false;
  function enlazar() {
    var raiz = x_.raiz();
    if (enlazado_ || !raiz) return;
    enlazado_ = true;
    raiz.addEventListener('change', function (ev) {
      var e = ev.target;
      if (e.classList.contains('js-finb-archivo')) { leerArchivos(e.files); e.value = ''; }
      else if (e.classList.contains('js-finb-detalle')) { if (e.files[0]) subirDetalle(e.files[0]); e.value = ''; }
      else if (e.classList.contains('js-finb-excel')) { if (e.files[0]) subirExcel(e.files[0]); e.value = ''; }
      else if (e.classList.contains('js-finb-clase')) {
        var trn = e.closest('tr'); trn.querySelector('.js-finb-destino').innerHTML = destinoCampo({ clase: e.value }, (tipo('EGRESO') || {}).cuentas || []);
      }
      else if (e.classList.contains('js-finb-planilla')) { if (e.files[0]) aprender(e.files[0]); e.value = ''; }
      else if (e.classList.contains('js-finb-empresa')) { revisiones_[Number(e.dataset.i)].empresa = e.value; }
      else if (e.classList.contains('js-finm-mes')) { mov_.periodo = e.value; verMovimientos(x_); }
      else if (e.classList.contains('js-finm-chk')) { mov_.sel[e.closest('.fin2-mov').dataset.id] = e.checked; actualizarSel(); }
      else if (e.classList.contains('js-finm-todos')) {
        document.querySelectorAll('.js-finm-chk:not(:disabled)').forEach(function (c) { c.checked = e.checked; mov_.sel[c.closest('.fin2-mov').dataset.id] = e.checked; });
        actualizarSel();
      }
    });
    var buscaT = null;
    raiz.addEventListener('input', function (ev) {
      if (ev.target.classList.contains('js-finm-busca')) {
        clearTimeout(buscaT); var v = ev.target.value;
        buscaT = setTimeout(function () { mov_.busca = v; refrescarLista(); }, 150);
      }
    });
    raiz.addEventListener('keydown', function (ev) {
      var f = ev.target.classList && ev.target.classList.contains('fin2-mov') ? ev.target : null;
      if (!f) return;
      if (ev.key === 'Enter') { ev.preventDefault(); abrirPanel(f.dataset.id); }
      else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        var otro = ev.key === 'ArrowDown' ? f.nextElementSibling : f.previousElementSibling;
        if (otro && otro.classList.contains('fin2-mov')) otro.focus();
      }
    });
    raiz.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) {
        // Tocar una fila (fuera del casillero) abre el panel.
        var fm = ev.target.closest('.fin2-mov');
        if (fm && !ev.target.closest('.fin2-chk')) abrirPanel(fm.dataset.id);
        return;
      }
      if (b.classList.contains('js-finb-importar')) { b.disabled = true; importar(); }
      else if (b.classList.contains('js-finb-descartar')) { revisiones_ = []; pintarRevisiones(); }
      else if (b.classList.contains('js-finb-excel-si')) { guardarExcel(b); }
      else if (b.classList.contains('js-finb-det-si')) { var dp_ = detallePendiente_; detallePendiente_ = null; if (dp_) subirDetalle(dp_, (document.querySelector('.js-finb-det-cuenta') || {}).value); }
      else if (b.classList.contains('js-finb-det-no')) { detallePendiente_ = null; document.getElementById('finb-nombres').innerHTML = ''; }
      else if (b.classList.contains('js-finb-excel-no')) { excel_ = null; pintarNombres(); }
      else if (b.classList.contains('js-finb-ir-mov')) { mov_.filtro = 'pendientes'; x_.ir('movimientos'); }
      else if (b.classList.contains('js-finb-ir-bancos')) { x_.ir('bancos'); }
      else if (b.classList.contains('js-finm-filtro') && b.dataset.id) { mov_.filtro = b.dataset.id; mov_.sel = {}; refrescarLista(); }
      else if (b.classList.contains('js-finm-abrir')) { abrirPanel(b.closest('.fin2-mov').dataset.id); }
      else if (b.classList.contains('js-finm-aceptar')) { var m0 = movDe(b.closest('.fin2-mov').dataset.id); if (m0) confirmarConRevision([desdeSugerencia(m0)], b); }
      else if (b.classList.contains('js-finm-seguras')) {
        // Etapa C: también las seguras pasan por los avisos (lo que tiene alerta queda para revisar).
        var seguras = mov_.datos.movimientos.filter(function (m) { return m.estado !== 'CONFIRMADO' && m.sugerencia && m.sugerencia.certeza === 'alta' && completa(m.sugerencia, sentidoDe(m)); })
          .map(function (m) { return Object.assign(desdeSugerencia(m), { recordar: false }); });
        confirmarConRevision(seguras, b);
      } else if (b.classList.contains('js-finm-marcar')) {
        document.querySelectorAll('.fin2-mov .js-finm-chk:not(:disabled)').forEach(function (chk) { chk.checked = true; mov_.sel[chk.closest('.fin2-mov').dataset.id] = true; });
        actualizarSel();
      } else if (b.classList.contains('js-finm-conf-sel')) {
        var items = Object.keys(mov_.sel).filter(function (k) { return mov_.sel[k]; }).map(movDe).filter(Boolean).map(desdeSugerencia);
        confirmarConRevision(items, b);
      }
    });
  }

  window.SigsoFinanzasBancos = { verBancos: verBancos, verMovimientos: verMovimientos, periodo: function (p) { if (p) mov_.periodo = p; mov_.filtro = 'pendientes'; } };
})();
