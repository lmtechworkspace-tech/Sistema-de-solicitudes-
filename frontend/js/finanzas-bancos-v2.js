/**
 * finanzas-bancos-v2.js — Finanzas, Etapa 2: bancos y cartolas (2026-10-06;
 * backend/logica/finanzasBancos.js). Lo monta finanzas-v2.js dentro de la
 * bóveda abierta, con dos vistas:
 *
 *  - Bancos: las cuentas con su saldo, subir cartolas (Excel del BCI; se
 *    revisan antes de guardar), aprender de la planilla SIGECO y la cuenta
 *    corriente de fondos de cada cliente.
 *  - Movimientos: el mes en una grilla. Cada fila trae la sugerencia del
 *    sistema; se confirma de a una o en lote, y lo que se corrige se aprende.
 */
(function () {
  'use strict';

  var U = UIv2;
  var x_ = null;                 // contexto que entrega finanzas-v2.js
  var cat_ = null;               // tipos, empresas, clientes
  var mov_ = { periodo: '', filtro: 'pendientes', datos: null, sel: {} };
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
        U.card({ titulo: 'Aprender del Excel BANCOS', icono: 'bombilla', sub: 'lo que Bárbara y Lisseth anotaban a mano', cuerpo:
          '<p class="fin2-ayuda">Sube el Excel «BANCOS» del mes. Primero se enseña una sola vez quién es cada nombre corto que usan («OSSES» = Constructora Osses Muñoz). Después cada fila queda como sugerencia en su movimiento y el sistema aprende <b>quién paga por quién</b>.</p>' +
          '<label class="sx2-boton sx2-boton--primario" style="margin-top:10px;cursor:pointer"><input type="file" accept=".xlsx" class="js-finb-excel" hidden>' + U.ico('subir', 16) + 'Elegir el Excel BANCOS</label>' }) +
        U.card({ titulo: 'Aprender de la planilla SIGECO', icono: 'documento', cuerpo:
          '<p class="fin2-ayuda">Sube la planilla de Google Sheets descargada como Excel. Lo que Bárbara y Lisseth ya clasificaron a mano en la hoja CUENTA BANCARIA queda como sugerencia en los movimientos de la cartola (no se confirma solo).</p>' +
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
  // Movimientos
  // =====================================================================================
  function verMovimientos(x) {
    x_ = x; enlazar();
    var t = x.turno();
    x.pagina(x.cab('Movimientos') + U.esqueleto('tabla', 10));
    Promise.all([x.api('finanzasMovimientos', { periodo: mov_.periodo }), catalogo()]).then(function (rs) {
      if (!x.vigente(t)) return;
      var r = rs[0];
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) x.pagina(x.cab('Movimientos') + U.card({ cuerpo: U.vacio({ icono: 'alerta', titulo: 'No se pudo cargar', texto: r.message || '' }) })); return; }
      mov_.datos = r.data; mov_.periodo = r.data.periodo; mov_.sel = {};
      pintarMovimientos();
    });
  }
  function visibles() {
    var l = (mov_.datos && mov_.datos.movimientos) || [];
    if (mov_.filtro === 'pendientes') return l.filter(function (m) { return m.estado !== 'CONFIRMADO'; });
    if (mov_.filtro === 'confirmados') return l.filter(function (m) { return m.estado === 'CONFIRMADO'; });
    return l;
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
    var pend = d.movimientos.filter(function (m) { return m.estado !== 'CONFIRMADO'; });
    var seguras = pend.filter(function (m) { return m.sugerencia && m.sugerencia.certeza === 'alta'; }).length;
    var avance = s.total ? Math.round(s.confirmados / s.total * 100) : 0;
    x_.pagina(x_.cab('Movimientos') +
      '<div class="fin2-barra-mes sx2-entra">' + selectorMes() +
        U.segmento([{ id: 'pendientes', texto: 'Por revisar · ' + s.pendientes }, { id: 'confirmados', texto: 'Confirmados · ' + s.confirmados }, { id: 'todos', texto: 'Todos' }], mov_.filtro, 'js-finm-filtro') +
        '<span class="fin2-avance" title="Confirmados del mes"><span style="width:' + avance + '%"></span></span><span class="fin2-ayuda">' + avance + ' % revisado</span>' +
      '</div>' +
      '<div class="fin2-tiras">' +
        tira('Ingresos de la empresa', s.INGRESO, 'ok') + tira('Gastos de la empresa', s.EGRESO, 'critico') +
        tira('Fondos de clientes recibidos', s.FONDO_RECIBIDO, 'info') + tira('Pagado por cuenta de clientes', s.FONDO_PAGADO, 'info') +
        tira('Traspasos y préstamos', s.TRASPASO_ENTRA + s.TRASPASO_SALE + s.PRESTAMO_ENTRA + s.PRESTAMO_SALE, 'neutro') + tira('Por revisar', s.pendiente_monto, 'alerta') +
      '</div>' +
      '<div class="fin2-lote sx2-entra">' +
        U.boton({ texto: 'Confirmar las seguras (' + seguras + ')', icono: 'check', variante: 'primario', clase: 'js-finm-seguras', deshabilitado: !seguras }) +
        U.boton({ texto: 'Marcar las que tienen propuesta completa', icono: 'lista', clase: 'js-finm-marcar' }) +
        U.boton({ texto: 'Confirmar marcadas', icono: 'check', clase: 'js-finm-conf-sel', deshabilitado: true }) +
        '<span class="fin2-ayuda js-finm-nsel"></span>' +
      '</div>' +
      U.card({ sinRelleno: true, cuerpo: '<div class="fin2-tabla-envoltura"><table class="fin2-tabla fin2-movs"><thead><tr>' +
        '<th class="fin2-chk"><input type="checkbox" class="js-finm-todos" aria-label="Marcar todos"></th><th>Fecha</th><th>Lo que dice el banco</th><th class="fin2-der">Monto</th><th>Qué es</th><th>Cuenta / cliente</th><th>Nota</th><th></th>' +
        '</tr></thead><tbody>' + (visibles().map(fila).join('') || '<tr><td colspan="8">' + U.vacio({ icono: 'check', titulo: 'Nada en esta vista', texto: mov_.filtro === 'pendientes' ? 'El mes está completamente revisado.' : '' }) + '</td></tr>') +
        '</tbody></table></div>' }) +
      '<datalist id="finm-clientes">' + cat_.clientes.map(function (c) { return '<option value="' + txt(c.nombre) + '">' + txt(c.rut) + '</option>'; }).join('') + '</datalist>');
    actualizarSel();
  }
  function tira(t, v, tono) { return '<div class="fin2-tira sx2-tono-' + tono + '"><span>' + txt(t) + '</span><b>' + plata(v) + '</b></div>'; }

  function opciones(lista, actual, vacio) {
    return (vacio ? '<option value="">' + txt(vacio) + '</option>' : '') + lista.map(function (o) {
      var id = typeof o === 'string' ? o : o.id, nom = typeof o === 'string' ? o : o.nombre;
      return '<option value="' + txt(id) + '"' + (id === actual ? ' selected' : '') + '>' + txt(nom) + '</option>';
    }).join('');
  }
  // Etapa A: lo que agrega el detalle del banco y el Excel BANCOS bajo la glosa.
  function pistas(m) {
    var h = '';
    if (m.detalle && m.detalle.descripcion) h += '<span class="fin2-pista">' + U.ico('lupa', 12) + txt(m.detalle.descripcion) + '</span>';
    if (m.planilla && (m.planilla.alias || m.planilla.obs)) h += '<span class="fin2-pista">' + U.ico('documento', 12) + 'Excel: ' + txt([m.planilla.alias, m.planilla.obs, m.planilla.plan].filter(Boolean).join(' · ')) + '</span>';
    var op = m.estado !== 'CONFIRMADO' && m.sugerencia && m.sugerencia.opciones;
    if (op && op.length) h += '<span class="fin2-opciones">Ha pagado por: ' + op.map(function (o) {
      return '<button type="button" class="fin2-chip js-finm-opc" data-cliente="' + txt(o.cliente) + '">' + txt(o.cliente) + (o.veces > 1 ? ' ×' + o.veces : '') + '</button>';
    }).join('') + '</span>';
    return h;
  }
  function fila(m) {
    var c = m.estado === 'CONFIRMADO' && m.clasif ? m.clasif : (m.sugerencia || {});
    if (c.partes) return filaDividida(m, c);
    var sentido = m.abono > 0 ? 'abono' : 'cargo';
    var tipos = cat_.tipos.filter(function (t) { return !t.sentido || t.sentido === sentido; });
    var cert = m.estado === 'CONFIRMADO' ? 'ok' : ({ alta: 'alta', media: 'media', baja: 'baja' }[(m.sugerencia || {}).certeza] || 'baja');
    return '<tr class="fin2-mov fin2-mov--' + cert + '" data-id="' + txt(m.id) + '">' +
      '<td class="fin2-chk"><input type="checkbox" class="js-finm-chk"' + (mov_.sel[m.id] ? ' checked' : '') + (m.estado === 'CONFIRMADO' ? ' disabled' : '') + ' aria-label="Marcar"></td>' +
      '<td class="fin2-num">' + txt(fechaCorta(m.fecha)) + '</td>' +
      '<td><span class="fin2-glosa">' + txt(m.glosa) + '</span><span class="fin2-motivo">' + (m.estado === 'CONFIRMADO' ? 'Confirmado por ' + txt(m.actualizado_por) : txt((m.sugerencia || {}).motivo || '')) + '</span>' + pistas(m) + '</td>' +
      '<td class="fin2-num fin2-der ' + (m.abono ? 'fin2-pos' : '') + '">' + (m.abono ? '+' : '−') + plata(m.abono || m.cargo) + '</td>' +
      '<td><select class="fin2-input fin2-input--sm js-finm-tipo">' + opciones(tipos, c.tipo, '¿Qué es?') + '</select></td>' +
      '<td class="js-finm-det">' + detalle(c) + '</td>' +
      '<td><input class="fin2-input fin2-input--sm js-finm-nota" value="' + txt(c.nota || '') + '" placeholder="Opcional" maxlength="300"></td>' +
      '<td class="fin2-acc">' + U.boton({ soloIcono: true, icono: 'check', sm: true, variante: m.estado === 'CONFIRMADO' ? 'fantasma' : 'secundario', titulo: m.estado === 'CONFIRMADO' ? 'Guardar cambio' : 'Confirmar', clase: 'js-finm-ok' }) +
        U.boton({ soloIcono: true, icono: 'derivar', sm: true, variante: 'fantasma', titulo: 'Dividir entre varios clientes o conceptos', clase: 'js-finm-dividir' }) + '</td>' +
    '</tr>';
  }
  function filaDividida(m, c) {
    return '<tr class="fin2-mov fin2-mov--ok" data-id="' + txt(m.id) + '" data-dividido="1">' +
      '<td class="fin2-chk"><input type="checkbox" class="js-finm-chk" disabled aria-label="Marcar"></td>' +
      '<td class="fin2-num">' + txt(fechaCorta(m.fecha)) + '</td>' +
      '<td><span class="fin2-glosa">' + txt(m.glosa) + '</span><span class="fin2-motivo">Confirmado por ' + txt(m.actualizado_por) + '</span>' + pistas(m) + '</td>' +
      '<td class="fin2-num fin2-der ' + (m.abono ? 'fin2-pos' : '') + '">' + (m.abono ? '+' : '−') + plata(m.abono || m.cargo) + '</td>' +
      '<td>' + U.badge('Dividido en ' + c.partes.length, 'info') + '</td>' +
      '<td colspan="2"><ul class="fin2-partes-lista">' + c.partes.map(function (p) {
        var t = tipo(p.tipo);
        return '<li><b>' + plata(p.monto) + '</b> ' + txt((t ? t.nombre : p.tipo) + (p.cliente ? ' · ' + p.cliente : '') + (p.cuenta ? ' · ' + p.cuenta : '') + (p.empresa ? ' · ' + p.empresa : '')) + '</li>';
      }).join('') + '</ul></td>' +
      '<td class="fin2-acc">' + U.boton({ soloIcono: true, icono: 'editar', sm: true, variante: 'fantasma', titulo: 'Cambiar la división', clase: 'js-finm-dividir' }) + '</td></tr>';
  }

  // --- Dividir: una transferencia que paga a varios clientes o mezcla conceptos --------
  function movDe(id) { return ((mov_.datos && mov_.datos.movimientos) || []).filter(function (m) { return m.id === id; })[0]; }
  function parte(p, sentido) {
    var tipos = cat_.tipos.filter(function (t) { return !t.sentido || t.sentido === sentido; });
    return '<div class="fin2-parte js-finm-parte">' +
      '<input class="fin2-input fin2-input--sm fin2-der js-finm-pmonto" inputmode="numeric" placeholder="Monto" value="' + (p.monto ? Math.round(p.monto).toLocaleString('es-CL') : '') + '">' +
      '<select class="fin2-input fin2-input--sm js-finm-ptipo">' + opciones(tipos, p.tipo || '', '¿Qué es?') + '</select>' +
      '<span class="fin2-parte__det js-finm-pdet">' + detalle(p, true) + '</span>' +
      U.boton({ soloIcono: true, icono: 'equis', sm: true, variante: 'fantasma', titulo: 'Quitar esta parte', clase: 'js-finm-pquitar' }) + '</div>';
  }
  function abrirDividir(tr) {
    var sig = tr.nextElementSibling;
    if (sig && sig.classList.contains('fin2-dividir')) { sig.remove(); return; }
    var m = movDe(tr.dataset.id); if (!m) return;
    var sentido = m.abono > 0 ? 'abono' : 'cargo';
    var base = m.clasif && m.clasif.partes ? m.clasif.partes : null;
    if (!base) { var f = leerFila(tr); base = [{ monto: 0, tipo: f.tipo, cuenta: f.cuenta, cliente: (tr.querySelector('.js-finm-cliente') || {}).value || '', empresa: f.empresa }, { monto: 0, tipo: f.tipo }]; }
    var nueva = document.createElement('tr');
    nueva.className = 'fin2-dividir'; nueva.dataset.id = m.id; nueva.dataset.total = String(m.abono || m.cargo); nueva.dataset.sentido = sentido;
    nueva.innerHTML = '<td colspan="8"><div class="fin2-dividir__caja">' +
      '<p class="fin2-ayuda"><b>Dividir ' + plata(m.abono || m.cargo) + '</b> — por ejemplo, una transferencia que paga a dos clientes, o que trae honorario y fondo para imposiciones. Las partes tienen que sumar exacto.</p>' +
      '<div class="js-finm-partes">' + base.map(function (p) { return parte(p, sentido); }).join('') + '</div>' +
      '<div class="fin2-acciones" style="align-items:center">' + U.boton({ texto: 'Agregar parte', icono: 'mas', sm: true, clase: 'js-finm-pmas' }) +
        '<span class="fin2-ayuda js-finm-pfalta"></span>' +
        U.boton({ texto: 'Cancelar', sm: true, clase: 'js-finm-pcancelar' }) +
        U.boton({ texto: 'Guardar división', icono: 'check', sm: true, variante: 'primario', clase: 'js-finm-pok' }) + '</div></div></td>';
    tr.parentNode.insertBefore(nueva, tr.nextSibling);
    faltaDividir(nueva);
  }
  function montoDe(v) { return Number(String(v || '').replace(/[^0-9]/g, '')) || 0; }
  function faltaDividir(caja) {
    var total = Number(caja.dataset.total), suma = 0;
    caja.querySelectorAll('.js-finm-pmonto').forEach(function (i) { suma += montoDe(i.value); });
    var el = caja.querySelector('.js-finm-pfalta'), dif = total - suma;
    el.innerHTML = dif === 0 ? '<span class="fin2-pos">✓ Suma exacta</span>' : dif > 0 ? 'Falta asignar <b>' + plata(dif) + '</b>' : '<span class="fin2-neg">Te pasaste por ' + plata(-dif) + '</span>';
    caja.querySelector('.js-finm-pok').disabled = dif !== 0;
  }
  function guardarDividir(caja) {
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
    if (malo) { aviso(malo); return; }
    var tr = caja.previousElementSibling;
    var nota = tr && tr.querySelector('.js-finm-nota') ? tr.querySelector('.js-finm-nota').value.trim() : '';
    guardar([{ id: caja.dataset.id, partes: partes, nota: nota }]);
  }
  function detalle(c, enParte) {
    var t = tipo(c.tipo);
    if (!t) return '<span class="fin2-ayuda">Primero elige qué es</span>';
    var h = '';
    if (t.cuentas.length) h += '<select class="fin2-input fin2-input--sm js-finm-cuenta">' + opciones(t.cuentas, c.cuenta, t.cliente ? 'Concepto' : 'Cuenta') + '</select>';
    if (t.cliente || t.id === 'INGRESO') h += '<input class="fin2-input fin2-input--sm js-finm-cliente" list="finm-clientes" value="' + txt(c.cliente || '') + '" placeholder="' + (t.cliente ? 'Cliente' : 'Cliente (opcional)') + '">';
    if (t.empresa) h += '<select class="fin2-input fin2-input--sm js-finm-empresa">' + opciones(cat_.empresas, c.empresa, 'Empresa') + '</select>';
    // Etapa 5: un gasto se puede repartir en partes iguales entre empresas del grupo.
    if (t.id === 'EGRESO' && cat_.repartos && !enParte) {
      var actual = (c.reparto || []).slice().sort().join('|');
      var elegido = (cat_.repartos.filter(function (r) { return r.empresas.slice().sort().join('|') === actual; })[0] || {}).id || '';
      h += '<select class="fin2-input fin2-input--sm js-finm-reparto" title="Gasto compartido entre empresas">' +
        '<option value="">No se reparte</option>' + cat_.repartos.map(function (r) { return '<option value="' + txt(r.id) + '"' + (r.id === elegido ? ' selected' : '') + '>' + txt(r.nombre) + '</option>'; }).join('') + '</select>';
    }
    return h || '<span class="fin2-ayuda">—</span>';
  }
  function leerFila(tr) {
    var q = function (s) { var e = tr.querySelector(s); return e ? e.value.trim() : ''; };
    var nombre = q('.js-finm-cliente');
    var cli = nombre ? cat_.clientes.filter(function (c) { return c.nombre === nombre; })[0] : null;
    var rep = q('.js-finm-reparto');
    var preset = rep && cat_.repartos ? cat_.repartos.filter(function (r) { return r.id === rep; })[0] : null;
    return { id: tr.dataset.id, tipo: q('.js-finm-tipo'), cuenta: q('.js-finm-cuenta'), cliente_id: cli ? cli.id : '', empresa: q('.js-finm-empresa'), reparto: preset ? preset.empresas : [], nota: q('.js-finm-nota'), _clienteEscrito: nombre && !cli };
  }
  function guardar(items) {
    var malos = items.filter(function (i) { return i._clienteEscrito; });
    if (malos.length) { aviso('Hay un cliente escrito que no está en la lista de SIGSO. Elígelo de la lista.'); return Promise.resolve(); }
    return x_.api('finanzasClasificar', { items: items }).then(function (r) {
      if (!r || !r.ok) { if (r && !r.boveda_cerrada) aviso((r && r.message) || 'No se pudo guardar.'); return; }
      var e = r.data.errores || [];
      e.forEach(function (er) { var tr = document.querySelector('.fin2-mov[data-id="' + er.id + '"]'); if (tr) { tr.classList.add('fin2-mov--error'); tr.title = er.mensaje; } });
      aviso(r.data.hechos + ' guardado(s)' + (r.data.reglas ? ' · el sistema aprendió ' + r.data.reglas + ' glosa(s)' : '') + (e.length ? ' · ' + e.length + ' con error: ' + e[0].mensaje : ''));
      if (r.data.hechos) recargar();
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

  // =====================================================================================
  // Eventos (una sola vez, sobre la raíz del módulo)
  // =====================================================================================
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
      else if (e.classList.contains('js-finm-tipo')) {
        var tr = e.closest('tr'); var actual = leerFila(tr);
        tr.querySelector('.js-finm-det').innerHTML = detalle({ tipo: e.value, cuenta: actual.cuenta, cliente: tr.querySelector('.js-finm-cliente') ? tr.querySelector('.js-finm-cliente').value : '', empresa: actual.empresa });
      } else if (e.classList.contains('js-finm-ptipo')) {
        var dp = e.closest('.js-finm-parte');
        dp.querySelector('.js-finm-pdet').innerHTML = detalle({ tipo: e.value, cliente: (dp.querySelector('.js-finm-cliente') || {}).value || '' }, true);
      } else if (e.classList.contains('js-finm-chk')) { mov_.sel[e.closest('tr').dataset.id] = e.checked; actualizarSel(); }
      else if (e.classList.contains('js-finm-todos')) {
        document.querySelectorAll('.js-finm-chk:not(:disabled)').forEach(function (c) { c.checked = e.checked; mov_.sel[c.closest('tr').dataset.id] = e.checked; });
        actualizarSel();
      }
    });
    raiz.addEventListener('input', function (ev) {
      if (ev.target.classList.contains('js-finm-pmonto')) faltaDividir(ev.target.closest('.fin2-dividir'));
    });
    raiz.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target.closest && ev.target.closest('.fin2-mov') && !ev.target.closest('[data-dividido]') && ev.target.tagName !== 'BUTTON') {
        ev.preventDefault(); guardar([leerFila(ev.target.closest('.fin2-mov'))]);
      }
    });
    raiz.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      if (b.classList.contains('js-finb-importar')) { b.disabled = true; importar(); }
      else if (b.classList.contains('js-finb-excel-si')) { guardarExcel(b); }
      else if (b.classList.contains('js-finb-det-si')) { var dp_ = detallePendiente_; detallePendiente_ = null; if (dp_) subirDetalle(dp_, (document.querySelector('.js-finb-det-cuenta') || {}).value); }
      else if (b.classList.contains('js-finb-det-no')) { detallePendiente_ = null; document.getElementById('finb-nombres').innerHTML = ''; }
      else if (b.classList.contains('js-finb-excel-no')) { excel_ = null; pintarNombres(); }
      else if (b.classList.contains('js-finb-descartar')) { revisiones_ = []; pintarRevisiones(); }
      else if (b.classList.contains('js-finb-ir-mov')) { mov_.filtro = 'pendientes'; x_.ir('movimientos'); }
      else if (b.classList.contains('js-finb-ir-bancos')) { x_.ir('bancos'); }
      else if (b.classList.contains('js-finm-filtro') && b.dataset.id) { mov_.filtro = b.dataset.id; mov_.sel = {}; pintarMovimientos(); }
      else if (b.classList.contains('js-finm-ok')) { guardar([leerFila(b.closest('tr'))]); }
      else if (b.classList.contains('js-finm-dividir')) { abrirDividir(b.closest('tr')); }
      else if (b.classList.contains('js-finm-opc')) {
        var trc = b.closest('tr'), inp = trc.querySelector('.js-finm-cliente');
        if (inp) { inp.value = b.dataset.cliente; inp.focus(); } else aviso('Primero elige qué es el movimiento.');
      }
      else if (b.classList.contains('js-finm-pmas')) {
        var cj = b.closest('.fin2-dividir');
        cj.querySelector('.js-finm-partes').insertAdjacentHTML('beforeend', parte({}, cj.dataset.sentido)); faltaDividir(cj);
      }
      else if (b.classList.contains('js-finm-pquitar')) { var cq = b.closest('.fin2-dividir'); b.closest('.js-finm-parte').remove(); faltaDividir(cq); }
      else if (b.classList.contains('js-finm-pcancelar')) { b.closest('.fin2-dividir').remove(); }
      else if (b.classList.contains('js-finm-pok')) { guardarDividir(b.closest('.fin2-dividir')); }
      else if (b.classList.contains('js-finm-seguras')) {
        b.disabled = true;
        x_.api('finanzasConfirmarSugeridas', { periodo: mov_.periodo }).then(function (r) {
          if (r && r.ok) { aviso(r.data.hechos + ' movimiento(s) confirmados.'); recargar(); }
        });
      } else if (b.classList.contains('js-finm-marcar')) {
        document.querySelectorAll('.fin2-mov').forEach(function (tr) {
          var f = leerFila(tr), t = tipo(f.tipo), chk = tr.querySelector('.js-finm-chk');
          if (!chk || chk.disabled || !t) return;
          var ok = (!t.cuentas.length || f.cuenta) && (!t.cliente || f.cliente_id) && (!t.empresa || f.empresa);
          if (ok) { chk.checked = true; mov_.sel[tr.dataset.id] = true; }
        });
        actualizarSel();
      } else if (b.classList.contains('js-finm-conf-sel')) {
        var items = [];
        document.querySelectorAll('.fin2-mov').forEach(function (tr) { if (mov_.sel[tr.dataset.id]) items.push(leerFila(tr)); });
        if (items.length) { b.disabled = true; guardar(items); }
      }
    });
  }

  window.SigsoFinanzasBancos = { verBancos: verBancos, verMovimientos: verMovimientos };
})();
