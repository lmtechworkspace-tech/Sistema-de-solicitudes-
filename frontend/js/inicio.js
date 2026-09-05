/**
 * inicio.js — el Inicio de la plataforma (v14.0).
 *
 * El Inicio venia del SIGSO de dos modulos: TODO lo que mostraba salia de
 * solicitudes (4 KPIs de la bandeja + las ultimas 5 solicitudes), y ademas
 * ambas cosas estaban condicionadas a tener el modulo 'bandeja'. Con doce
 * modulos en la plataforma eso dejaba dos agujeros grandes:
 *   - quien NO tiene bandeja (la mayoria del personal) veia un Inicio vacio;
 *   - lo que si tiene trabajo pendiente de verdad (compromisos de "Mi
 *     trabajo", documentos del SGC por confirmar, novedades con acuse)
 *     no aparecia por ningun lado -- habia que entrar modulo por modulo
 *     para descubrirlo.
 *
 * Este Inicio responde, en orden: que necesita de mi HOY, que es lo mio,
 * como va el panorama de mi rol, y como voy yo. Los "accesos rapidos"
 * desaparecen: desde la v13 el arbol de modulos vive en el sidebar y esas
 * once tarjetas solo repetian el menu.
 *
 * Composicion en el FRONTEND a proposito (no un endpoint nuevo): cada
 * bloque se arma con datos que su modulo ya expone hoy, se pide solo si la
 * cuenta tiene ese modulo, y cada fuente falla por su cuenta sin tumbar el
 * resto. Asi esto se publica solo por GitHub Pages, sin pegar nada en Apps
 * Script (plataforma.html no se embebe en App.html).
 */
var SigsoInicio = (function () {
  'use strict';

  // ctx lo inyecta plataforma.js: es el dueno de la sesion y de la
  // navegacion, este modulo no los conoce por su cuenta.
  var ctx_ = null;

  // Pendientes acumulados de todas las fuentes. Se re-pinta cada vez que
  // llega una (progresivo): el bloque no espera a la fuente mas lenta.
  var pendientes_ = [];
  var fuentesVivas_ = 0;
  var fuentesListas_ = 0;
  var generacion_ = 0;
  function vigente_(g) { return g === generacion_; }

  // Urgencia. Numero mas bajo = mas arriba en la lista.
  var PRIO_ATRASADO = 10;
  var PRIO_HOY = 20;
  var PRIO_CONFIRMAR = 30;
  var PRIO_BLOQUEO = 40;

  function el_(id) { return document.getElementById(id); }
  function esc_(v) { return Componentes.escaparHtml(String(v === null || v === undefined ? '' : v)); }
  function tiene_(modulo) { return (ctx_.modulos || []).indexOf(modulo) !== -1; }
  function apiBack_(accion, datos) {
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos || {});
  }

  // --- API publica -----------------------------------------------------------

  function render(ctx) {
    ctx_ = ctx;
    // Generación de render: al reentrar al Inicio se incrementa, y toda
    // respuesta en vuelo del render anterior se descarta al llegar. Sin
    // esto, navegar fuera y volver rápido duplicaría pendientes y paneles
    // con datos de la visita previa.
    generacion_++;
    pendientes_ = [];
    fuentesVivas_ = 0;
    fuentesListas_ = 0;
    // Estado acumulado de los bloques: sin esto, volver al Inicio duplicaria
    // paneles y arrastraria la pausa de la visita anterior.
    panelesPintados_ = {};
    pausaHtml_ = '';
    semanaHtml_ = '';

    pintarCabecera_();
    ['estado-home', 'atencion-home', 'trabajo-home', 'panel-home', 'semana-home'].forEach(function (id) {
      var nodo = el_(id);
      if (nodo) nodo.innerHTML = '';
    });
    var reciente = el_('reciente-home');
    if (reciente) { reciente.innerHTML = ''; reciente.className = 'sigso-oculto'; }

    cargarFuentes_();
  }

  // --- cabecera --------------------------------------------------------------

  function saludoSegunHora_() {
    var hora = new Date().getHours();
    if (hora < 12) return 'Buenos días';
    if (hora < 20) return 'Buenas tardes';
    return 'Buenas noches';
  }

  function pintarCabecera_() {
    var cuenta = ctx_.cuenta || {};
    var nombrePila = String(cuenta.nombre || '').split(' ')[0];
    var saludo = el_('saludo-home');
    if (saludo) saludo.textContent = saludoSegunHora_() + ', ' + nombrePila;

    // El cargo va junto a la fecha: ubica a la persona en su rol sin gastar
    // una linea propia (y es lo que vuelve el saludo algo mas humano que
    // un "Hola" a secas).
    var fecha = el_('fecha-home');
    if (fecha) {
      var texto = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
      texto = texto.charAt(0).toUpperCase() + texto.slice(1);
      fecha.textContent = cuenta.cargo ? (cuenta.cargo + ' · ' + texto) : texto;
    }
  }

  // La linea de estado responde de entrada la pregunta con la que uno abre
  // el sistema: "¿hay algo que necesite de mi?". Confirmar que estas al dia
  // vale tanto como avisarte que no -- por eso tambien se pinta en verde
  // cuando no hay nada, en vez de dejar el hueco vacio.
  function pintarEstado_() {
    var nodo = el_('estado-home');
    if (!nodo) return;
    var todasListas = fuentesListas_ >= fuentesVivas_;
    if (!todasListas && !pendientes_.length) { nodo.innerHTML = ''; return; }

    if (!pendientes_.length) {
      nodo.innerHTML = '<div class="inicio-estado inicio-estado--ok">' +
        Iconos.svg('check', { tam: 17 }) +
        '<span>Todo al día — nada pendiente de tu parte.</span></div>';
      return;
    }
    // "Urgente" = atrasado o vence hoy/manana. No se dice "para hoy": algo
    // atrasado hace dos dias no es de hoy, y prometer eso seria mentirle a
    // la persona en la primera linea que lee.
    var urgentes = pendientes_.filter(function (p) { return p.prio <= PRIO_HOY; }).length;
    var detalle = urgentes
      ? (urgentes === 1 ? '1 es urgente' : urgentes + ' son urgentes')
      : '';
    nodo.innerHTML = '<div class="inicio-estado inicio-estado--accion">' +
      Iconos.svg('alerta', { tam: 17 }) +
      '<span>Tienes <strong>' + pendientes_.length + '</strong> ' +
      (pendientes_.length === 1 ? 'cosa' : 'cosas') + ' que ' +
      (pendientes_.length === 1 ? 'requiere' : 'requieren') + ' tu atención' +
      (detalle ? ' · ' + esc_(detalle) : '') + '.</span></div>';
  }

  // --- bloque "Requiere tu atencion" ----------------------------------------

  function agregarPendiente_(p) {
    pendientes_.push(p);
    pintarAtencion_();
    pintarEstado_();
  }

  function fuenteLista_() {
    fuentesListas_++;
    pintarEstado_();
    pintarAtencion_();
  }

  function pintarAtencion_() {
    var nodo = el_('atencion-home');
    if (!nodo) return;
    if (!pendientes_.length) { nodo.innerHTML = ''; return; }

    var orden = pendientes_.slice().sort(function (a, b) { return a.prio - b.prio; });
    nodo.innerHTML =
      '<section class="inicio-bloque inicio-bloque--atencion">' +
        '<h2 class="inicio-bloque__titulo">' + Iconos.svg('rayo', { tam: 16 }) + ' Requiere tu atención</h2>' +
        '<div class="inicio-lista">' +
        orden.map(function (p, i) {
          return '<div class="inicio-item inicio-item--' + esc_(p.tono || 'normal') + '">' +
            '<span class="inicio-item__origen">' + esc_(p.origen) + '</span>' +
            '<span class="inicio-item__texto">' + p.texto + '</span>' +
            '<button type="button" class="sigso-boton sigso-boton--sutil inicio-item__cta" data-idx="' + i + '">' +
              esc_(p.cta || 'Abrir') + '</button>' +
          '</div>';
        }).join('') +
        '</div>' +
      '</section>';

    nodo.querySelectorAll('.inicio-item__cta').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = orden[Number(btn.getAttribute('data-idx'))];
        if (p && p.modulo) ctx_.irAModulo(p.modulo, p.item || null);
      });
    });
  }

  // --- carga de fuentes ------------------------------------------------------

  function cargarFuentes_() {
    // M-02: UNA llamada para todo lo que vive en el Backoffice.
    //
    // Antes cada bloque pedia lo suyo: hasta siete viajes en paralelo. En
    // local no se nota (435 ms); en Apps Script, a 300 ms - 2 s por viaje, la
    // primera pantalla que ve todo el mundo tardaba segundos en asentarse.
    //
    // La lista de bloques la manda el cliente porque el servidor no siempre
    // sabe que modulos tiene la persona: contexto.modulos solo existe si la
    // identidad viene del portal, y quien entra por el enlace de Google se
    // quedaria con un Inicio vacio. No relaja permisos: cada bloque del
    // backend delega en la misma funcion que atendia su accion suelta.
    var quiere = [];
    if (tiene_('mi_trabajo')) quiere.push('mi_trabajo');
    if (tiene_('calidad')) quiere.push('calidad');
    if (tiene_('bandeja')) quiere.push('bandeja');
    if (tiene_('jefatura')) quiere.push('jefatura');
    if (tiene_('pausas')) quiere.push('pausas');

    // Una promesa por bloque, todas resueltas desde la MISMA respuesta: asi
    // cada cargador recibe lo que ya recibia y ningun pintor cambia. Si la
    // llamada entera falla, cada bloque recibe {ok:false} y se salta lo suyo,
    // igual que cuando fallaba su peticion propia.
    var enVuelo = apiBack_('getInicio', { bloques: quiere })
      .then(function (r) { return (r && r.ok && r.data && r.data.bloques) || {}; })
      .catch(function () { return {}; });
    function bloque_(nombre) {
      return enVuelo.then(function (bloques) { return bloques[nombre] || { ok: false }; });
    }

    // Cada fuente se declara viva ANTES de pedir, para que pintarEstado_ sepa
    // cuando ya estan todas y no cante "todo al dia" antes de tiempo.
    if (tiene_('mi_trabajo')) { fuentesVivas_++; cargarMiTrabajo_(bloque_('mi_trabajo')); }
    if (tiene_('calidad')) { fuentesVivas_++; cargarCalidad_(bloque_('calidad')); }
    // Mis solicitudes se queda aparte: vive en el proyecto INTAKE, y traerla
    // obligaria a duplicar aqui como se resuelven los correos de una cuenta
    // desde su token -- la duplicacion que ya hizo divergir otras reglas.
    if (tiene_('mis_solicitudes')) { fuentesVivas_++; cargarMisSolicitudes_(); }
    if (tiene_('bandeja')) { fuentesVivas_++; cargarBandeja_(bloque_('bandeja')); }
    if (tiene_('jefatura')) { fuentesVivas_++; cargarJefatura_(bloque_('jefatura')); }
    if (tiene_('pausas')) { fuentesVivas_++; cargarPausa_(bloque_('pausas')); }
    // Novedades es modulo core (no se asigna por cuenta) y usa su feed
    // compartido, el mismo que alimenta el badge del sidebar.
    fuentesVivas_++; cargarNovedades_();

    pintarEstado_();
  }

  // Envuelve la promesa de una fuente con el guard de generación: si al
  // llegar la respuesta ya se reentró al Inicio, se descarta (ni pinta ni
  // cuenta como fuente lista de este render). Centraliza el patrón para que
  // ningún cargador olvide el guard.
  function conGuarda_(promesa, alLlegar) {
    var g = generacion_;
    return promesa
      .then(function (r) { if (vigente_(g)) alLlegar(r); })
      .catch(function () { /* la fuente simplemente no aporta a este render */ })
      .then(function () { if (vigente_(g)) fuenteLista_(); });
  }

  // Mi trabajo: la unica fuente que alimenta DOS bloques (atencion + "Mi
  // trabajo hoy") con una sola consulta.
  function cargarMiTrabajo_(promesa) {
    conGuarda_(promesa,
      function (r) {
        if (!r || !r.ok) return;
        var items = Array.isArray(r.data) ? r.data : (r.data.items || []);

        items.forEach(function (a) {
          if (a.semaforo === 'atrasada') {
            agregarPendiente_({
              prio: PRIO_ATRASADO, tono: 'critico', origen: 'Mi trabajo', modulo: 'mi_trabajo',
              texto: esc_(a.titulo) + ' <strong>— atrasado</strong>', cta: 'Abrir'
            });
          } else if (a.semaforo === 'riesgo') {
            agregarPendiente_({
              prio: PRIO_HOY, tono: 'alerta', origen: 'Mi trabajo', modulo: 'mi_trabajo',
              texto: esc_(a.titulo) + ' <strong>— ' + esc_(a.semaforo_etiqueta || 'vence pronto') + '</strong>', cta: 'Abrir'
            });
          } else if (a.semaforo === 'pendiente') {
            agregarPendiente_({
              prio: PRIO_CONFIRMAR, tono: 'normal', origen: 'Mi trabajo', modulo: 'mi_trabajo',
              texto: esc_(a.titulo) + ' — confirma la fecha propuesta', cta: 'Confirmar'
            });
          } else if (a.semaforo === 'bloqueada') {
            agregarPendiente_({
              prio: PRIO_BLOQUEO, tono: 'alerta', origen: 'Mi trabajo', modulo: 'mi_trabajo',
              texto: esc_(a.titulo) + ' — bloqueado', cta: 'Abrir'
            });
          }
        });

        pintarMiTrabajo_(items);
        pintarSemana_(items);
      });
  }

  function cargarCalidad_(promesa) {
    conGuarda_(promesa, function (r) {
      if (!r || !r.ok) return;
      var n = r.data.pendientes_de_acuse || 0;
      if (!n) return;
      agregarPendiente_({
        prio: PRIO_CONFIRMAR, tono: 'alerta', origen: 'Calidad', modulo: 'calidad',
        texto: '<strong>' + n + '</strong> documento(s) del SGC esperan tu confirmación de lectura',
        cta: 'Confirmar'
      });
    });
  }

  function cargarMisSolicitudes_() {
    conGuarda_(llamarApi(window.SIGSO_CONFIG.INTAKE_URL, 'misSolicitudes', { token: ctx_.token }),
      function (r) {
        if (!r || !r.ok) return;
        var resumen = r.data.resumen || {};
        if (ctx_.pintarBadge) ctx_.pintarBadge('mis_solicitudes', resumen.pendientes_validar);
        if (resumen.pendientes_validar > 0) {
          agregarPendiente_({
            prio: PRIO_CONFIRMAR, tono: 'normal', origen: 'Solicitudes', modulo: 'mis_solicitudes',
            texto: '<strong>' + resumen.pendientes_validar + '</strong> ítem(s) esperan tu validación',
            cta: 'Revisar'
          });
        }
      });
  }

  function cargarNovedades_() {
    if (!window.SigsoNovedades || !SigsoNovedades.resumenPendientes) { fuenteLista_(); return; }
    // NO viaja en getInicio a proposito: feedSinFiltro_ memoiza esta
    // peticion con TTL y el badge del sidebar la pide igual al arrancar.
    // Meterla en el bloque haria que el servidor calculara el feed dos
    // veces. Aqui se reusa la que ya se iba a hacer.
    conGuarda_(SigsoNovedades.resumenPendientes(), function (res) {
      if (!res || !res.pendientes) return;
      var destacada = res.destacada;
      agregarPendiente_({
        prio: PRIO_CONFIRMAR, tono: 'normal', origen: 'Novedades', modulo: 'novedades',
        texto: destacada
          ? esc_(destacada.titulo) + ' — requiere acuse'
          : '<strong>' + res.pendientes + '</strong> novedad(es) sin leer',
        cta: 'Leer'
      });
    });
  }

  // --- bloque "Mi trabajo hoy" ----------------------------------------------

  var SEMAFORO_ETIQUETA_TONO = {
    atrasada: 'critico', riesgo: 'alerta', bloqueada: 'alerta',
    pendiente: 'normal', 'al-dia': 'ok', revision: 'normal'
  };

  function pintarMiTrabajo_(items) {
    var nodo = el_('trabajo-home');
    if (!nodo) return;
    var abiertos = items.filter(function (a) {
      return ['atrasada', 'riesgo', 'bloqueada', 'pendiente', 'al-dia'].indexOf(a.semaforo) !== -1;
    }).sort(function (a, b) {
      // OJO: `orden[x] || 9` mandaria 'atrasada' (0) al final, porque 0 es
      // falsy -- justo lo mas urgente al fondo. Por eso el chequeo explicito.
      var orden = { atrasada: 0, riesgo: 1, bloqueada: 2, pendiente: 3, 'al-dia': 4 };
      function peso(s) { return orden[s] === undefined ? 9 : orden[s]; }
      return peso(a.semaforo) - peso(b.semaforo);
    });
    if (!abiertos.length) { nodo.innerHTML = ''; return; }

    var visibles = abiertos.slice(0, 5);
    nodo.innerHTML =
      '<section class="inicio-bloque">' +
        '<h2 class="inicio-bloque__titulo">' + Iconos.svg('check', { tam: 16 }) + ' Mi trabajo hoy' +
          (abiertos.length > visibles.length
            ? '<span class="inicio-bloque__extra">' + abiertos.length + ' en total</span>' : '') +
        '</h2>' +
        '<div class="inicio-lista">' +
        visibles.map(function (a) {
          return '<div class="inicio-item inicio-item--' + esc_(SEMAFORO_ETIQUETA_TONO[a.semaforo] || 'normal') + '">' +
            '<span class="inicio-item__texto">' + esc_(a.titulo) +
              ' <span class="inicio-chip inicio-chip--' + esc_(SEMAFORO_ETIQUETA_TONO[a.semaforo] || 'normal') + '">' +
              esc_(a.semaforo_etiqueta || '') + '</span></span>' +
            // Accion de un clic desde el Inicio: es lo que "Mi trabajo"
            // pide a diario y obligaba a navegar hasta el modulo. Para una
            // actividad con fecha propuesta sin confirmar, lo que
            // corresponde NO es un check-in sino aceptar la fecha.
            (a.semaforo === 'pendiente'
              ? '<button type="button" class="sigso-boton sigso-boton--sutil js-inicio-confirmar" ' +
                  'data-id="' + esc_(a.actividad_id) + '">Confirmar</button>'
              : '<button type="button" class="sigso-boton sigso-boton--sutil js-inicio-checkin" ' +
                  'data-id="' + esc_(a.actividad_id) + '">Sin cambios</button>') +
          '</div>';
        }).join('') +
        '</div>' +
        '<button type="button" class="sigso-boton sigso-boton--sutil inicio-bloque__ir" data-ir="mi_trabajo">Ver todo mi trabajo</button>' +
      '</section>';

    // 'sin_cambio' en singular: es el valor que espera Actividades.checkin
    // (§4.4 -- respuesta legitima y no penalizada).
    accionRapida_(nodo, '.js-inicio-checkin', 'checkinActividad', 'sin_cambio', 'Sin cambios');
    accionRapida_(nodo, '.js-inicio-confirmar', 'confirmarActividad', null, 'Confirmar');
    var ir = nodo.querySelector('[data-ir]');
    if (ir) ir.addEventListener('click', function () { ctx_.irAModulo('mi_trabajo'); });
  }

  // --- bloque "Tu panel" (KPIs segun el rol) --------------------------------
  //
  // Los KPIs dejan de ser los mismos para todos: cada panel se agrega solo
  // si la cuenta tiene ese modulo. Una persona sin bandeja ya no ve un
  // hueco donde antes habia cuatro tarjetas de solicitudes que no le
  // hablaban a ella.

  // Boton de accion directa del Inicio: deshabilita, llama, y deja el
  // resultado a la vista sin recargar todo el bloque (recargar haria
  // "saltar" la lista bajo el cursor justo despues de hacer clic).
  function accionRapida_(nodo, selector, accion, tipo, textoOriginal) {
    nodo.querySelectorAll(selector).forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        btn.textContent = 'Guardando...';
        var datos = { actividad_id: btn.getAttribute('data-id') };
        if (tipo) datos.tipo = tipo;
        apiBack_(accion, datos)
          .then(function (r) {
            if (r && r.ok) {
              btn.textContent = '✓ Listo';
              return;
            }
            btn.disabled = false;
            btn.textContent = textoOriginal;
            Componentes.aviso({ texto: (r && r.message) || 'No se pudo registrar.', tipo: 'error' });
          })
          .catch(function () {
            btn.disabled = false;
            btn.textContent = textoOriginal;
            Componentes.aviso({ texto: 'No se pudo conectar.', tipo: 'error' });
          });
      });
    });
  }

  var panelesPintados_ = {};

  function pintarPanel_(clave, titulo, html, moduloIr) {
    var nodo = el_('panel-home');
    if (!nodo) return;
    panelesPintados_[clave] = { titulo: titulo, html: html, modulo: moduloIr };
    nodo.innerHTML = Object.keys(panelesPintados_).map(function (k) {
      var p = panelesPintados_[k];
      return '<section class="inicio-bloque">' +
        '<h2 class="inicio-bloque__titulo">' + Iconos.svg('grafico', { tam: 16 }) + ' ' + esc_(p.titulo) + '</h2>' +
        p.html +
        '</section>';
    }).join('');
    nodo.querySelectorAll('[data-ir-panel]').forEach(function (b) {
      b.addEventListener('click', function () { ctx_.irAModulo(b.getAttribute('data-ir-panel')); });
    });
  }

  function cargarBandeja_(promesa) {
    if (!ctx_.backofficeDisponible || !ctx_.backofficeDisponible()) { fuenteLista_(); return; }
    conGuarda_(promesa, function (r) {
      if (!r || !r.ok) return;
      var res = r.data.resumen || {};
      if (ctx_.pintarBadge) ctx_.pintarBadge('bandeja', res.sla_vencido);
      pintarPanel_('bandeja', 'Bandeja de trabajo',
        '<div class="sigso-kpis inicio-kpis" data-ir-panel="bandeja">' +
          Componentes.kpi({ valor: res.total_abiertas, etiqueta: 'Abiertas', titulo: 'Solicitudes que aún no están cerradas, rechazadas ni canceladas.' }) +
          Componentes.kpi({ valor: res.criticas_activas, etiqueta: 'Críticas activas', alerta: true, titulo: 'Solicitudes abiertas de prioridad P1.' }) +
          Componentes.kpi({ valor: res.sla_vencido, etiqueta: 'Fuera de plazo', alerta: true, titulo: 'Ítems que ya pasaron su tiempo objetivo de respuesta.' }) +
          Componentes.kpi({ valor: res.del_dia, etiqueta: 'Ingresadas hoy', titulo: 'Solicitudes creadas hoy.' }) +
        '</div>', 'bandeja');
      pintarReciente_(r.data.recientes || []);
      if (ctx_.onRecientes) ctx_.onRecientes(r.data.recientes || []);
    });
  }

  function cargarJefatura_(promesa) {
    conGuarda_(promesa, function (r) {
        if (!r || !r.ok) return;
        var res = (r.data && r.data.resumen) || {};
        pintarPanel_('jefatura', 'Mi departamento',
          '<div class="sigso-kpis inicio-kpis" data-ir-panel="jefatura">' +
            Componentes.kpi({ valor: res.requieren_accion || 0, etiqueta: 'Requieren acción', alerta: true, titulo: 'Ítems de tu equipo esperando una decisión tuya.' }) +
            Componentes.kpi({ valor: res.en_riesgo || 0, etiqueta: 'En riesgo o vencidas', alerta: true, titulo: 'Ítems de tu equipo en riesgo o fuera de plazo.' }) +
            Componentes.kpi({ valor: res.nuevas || 0, etiqueta: 'Nuevas hoy', titulo: 'Ítems que entraron hoy a tu equipo.' }) +
            Componentes.kpi({ valor: res.cerradas || 0, etiqueta: 'Cerradas hoy', titulo: 'Ítems que tu equipo cerró hoy.' }) +
          '</div>', 'jefatura');

        if (res.requieren_accion > 0) {
          agregarPendiente_({
            prio: PRIO_CONFIRMAR, tono: 'normal', origen: 'Mi equipo', modulo: 'jefatura',
            texto: '<strong>' + res.requieren_accion + '</strong> ítem(s) de tu equipo requieren una decisión tuya',
            cta: 'Revisar'
          });
        }
      });
  }

  // --- bloque "Tu semana" (bienestar + avance propio) -----------------------
  //
  // El apartado humano del Inicio. Dos cosas concretas y ambas reales: la
  // pausa activa del dia (que ya existe como modulo y se resuelve en un
  // clic) y el propio avance de la semana. Es progreso personal, no
  // vigilancia: no compara con nadie ni sale de la pantalla de la persona.

  var pausaHtml_ = '';
  var semanaHtml_ = '';

  function pintarSemanaBloque_() {
    var nodo = el_('semana-home');
    if (!nodo) return;
    if (!pausaHtml_ && !semanaHtml_) { nodo.innerHTML = ''; return; }
    nodo.innerHTML =
      '<section class="inicio-bloque inicio-bloque--semana">' +
        '<h2 class="inicio-bloque__titulo">' + Iconos.svg('reloj', { tam: 16 }) + ' Tu semana</h2>' +
        pausaHtml_ + semanaHtml_ +
      '</section>';
    var btn = nodo.querySelector('[data-ir-pausa]');
    if (btn) btn.addEventListener('click', function () { ctx_.irAModulo('pausas'); });
  }

  function cargarPausa_(promesa) {
    conGuarda_(promesa, function (r) {
      if (!r || !r.ok) return;
      var d = r.data || {};
      if (!d.pausa || !d.registrable) return;
      pausaHtml_ =
        '<div class="inicio-pausa">' +
          '<span>' + Iconos.svg('actividad', { tam: 15 }) + ' La pausa activa de hoy está disponible' +
            (d.pausa.hora_programada ? ' (' + esc_(d.pausa.hora_programada) + ')' : '') + '.</span>' +
          '<button type="button" class="sigso-boton sigso-boton--sutil" data-ir-pausa="1">Participar</button>' +
        '</div>';
      pintarSemanaBloque_();
    });
  }

  function pintarSemana_(items) {
    // "Cerradas esta semana" se cuenta sobre fecha_terminada real; si una
    // actividad no la trae, no se cuenta (mejor un numero fiable que uno
    // inflado con supuestos).
    var desde = new Date();
    desde.setDate(desde.getDate() - 7);
    var cerradas = items.filter(function (a) {
      if (a.estado !== 'TERMINADA' || !a.fecha_terminada) return false;
      var f = new Date(a.fecha_terminada);
      return !isNaN(f.getTime()) && f >= desde;
    }).length;
    var alDia = items.filter(function (a) { return a.semaforo === 'al-dia'; }).length;
    if (!cerradas && !alDia) { semanaHtml_ = ''; pintarSemanaBloque_(); return; }

    // Dos hechos distintos, dos frases: lo cerrado SI es de los ultimos 7
    // dias; "al dia" es estado de ahora, no de la semana. Mezclarlos en una
    // sola frase daba un texto que decia algo que no era cierto.
    var partes = [];
    if (cerradas) {
      partes.push('En los últimos 7 días cerraste <strong>' + cerradas + '</strong> compromiso' + (cerradas === 1 ? '' : 's') + '.');
    }
    if (alDia) {
      partes.push('Tienes <strong>' + alDia + '</strong> compromiso' + (alDia === 1 ? '' : 's') + ' al día.');
    }
    semanaHtml_ = '<p class="inicio-semana__texto">' + partes.join(' ') + '</p>';
    pintarSemanaBloque_();
  }

  // --- actividad reciente (se conserva, al final) ---------------------------

  var ETIQUETA_ESTADO = {
    S01: 'Ingresada', S02: 'En revisión', S03: 'En desarrollo', S04: 'En prueba',
    S05: 'Lista para validar', S06: 'Pausada', S07: 'Bloqueada', S08: 'Rechazada',
    S09: 'Terminada', S10: 'Validada', S11: 'Cancelada'
  };

  function pintarReciente_(recientes) {
    var cont = el_('reciente-home');
    if (!cont || !recientes.length) return;
    cont.className = 'plataforma-reciente';
    cont.innerHTML =
      '<h2 class="inicio-bloque__titulo">' + Iconos.svg('lista', { tam: 16 }) + ' Actividad reciente</h2>' +
      '<div class="sigso-card plataforma-reciente__lista">' +
      recientes.slice(0, 5).map(function (s) {
        return '<button type="button" class="plataforma-reciente__fila" data-ir-solicitud="' + esc_(s.solicitud_id) + '">' +
          '<span class="sigso-id">' + esc_(s.solicitud_id) + '</span>' +
          '<span class="plataforma-reciente__meta">' + esc_(s.empresa_id) + ' &middot; ' + esc_(s.modulo || '—') + '</span>' +
          '<span class="sigso-badge sigso-badge--' + esc_(s.prioridad_derivada) + '">' + esc_(s.prioridad_derivada) + '</span>' +
          '<span class="plataforma-reciente__estado">' + esc_(ETIQUETA_ESTADO[s.estado_derivado] || s.estado_derivado) + '</span>' +
          '</button>';
      }).join('') +
      '</div>';
    cont.querySelectorAll('[data-ir-solicitud]').forEach(function (fila) {
      fila.addEventListener('click', function () { ctx_.irAModulo('bandeja'); });
    });
  }

  return { render: render };
})();
