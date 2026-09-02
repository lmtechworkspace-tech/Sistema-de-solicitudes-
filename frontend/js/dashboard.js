/**
 * dashboard.js — Backoffice: KPIs, graficos y tabla de recientes (§12.4).
 */
(function () {
  var graficos = {};

  window.SigsoDashboard = { cargar: cargarDashboard_, inicializarFiltros: inicializarFiltros_ };

  // --- v6.2 (F2/F4): contexto de la bandeja ------------------------------
  //
  // Un solo mecanismo resuelve los dos casos, porque el estado a preservar es
  // exactamente el mismo:
  //   F2 "volver del detalle" -> restaurar filtros + scroll
  //   F4 "F5 / recarga"       -> restaurar filtros + scroll
  //
  // Vive en dashboard.js (no en app.js ni plataforma.js) a proposito: los DOS
  // hosts comparten este archivo y el mismo contrato SigsoApp, asi que ponerlo
  // aca evita duplicar la logica -- y ninguno de los dos necesita cambios.
  //
  // sessionStorage y no localStorage: el contexto tiene que morir con la
  // pestana. Un filtro "Empresa: HP" que sobrevive al dia siguiente hace que
  // el usuario crea que perdio solicitudes.
  var LLAVE_CONTEXTO = 'sigso_bandeja_contexto';
  // Cinturon adicional: una pestana abierta varios dias tampoco deberia
  // restaurar un contexto viejo (sessionStorage sobrevive mientras la pestana
  // exista, no solo mientras se trabaje).
  var CONTEXTO_VIGENCIA_MS = 8 * 60 * 60 * 1000;

  // Se pone en true al salir al detalle (o al arrancar con contexto guardado):
  // marca que el PROXIMO render de la lista debe recuperar la posicion. Sin
  // esta bandera, "Actualizar" tambien daria un salto de scroll inesperado.
  var restaurarScrollPendiente_ = false;
  // filtro-bandeja se puebla DESPUES (con la respuesta del backend, en
  // renderSelectorBandeja_), asi que su valor guardado se aplica alli.
  var bandejaPendiente_ = null;
  // v6.3: pausa antes de reconsultar al backend por el buscador. Cada consulta
  // recalcula los KPIs sobre varias hojas (y cada termino distinto es una
  // clave de cache nueva), asi que conviene esperar a que el usuario termine
  // de escribir en vez de disparar una por tecla.
  var MS_DEBOUNCE_BUSQUEDA = 700;

  function leerContexto_() {
    try {
      var crudo = window.sessionStorage.getItem(LLAVE_CONTEXTO);
      if (!crudo) return null;
      var ctx = JSON.parse(crudo);
      if (!ctx || !ctx.guardado || Date.now() - ctx.guardado > CONTEXTO_VIGENCIA_MS) {
        window.sessionStorage.removeItem(LLAVE_CONTEXTO);
        return null;
      }
      return ctx;
    } catch (err) {
      // sessionStorage bloqueado (modo privado) o JSON corrupto: la bandeja
      // funciona igual, solo sin memoria de contexto.
      return null;
    }
  }

  function escribirContexto_(cambios) {
    try {
      var ctx = leerContexto_() || {};
      Object.keys(cambios).forEach(function (k) { ctx[k] = cambios[k]; });
      ctx.guardado = Date.now();
      window.sessionStorage.setItem(LLAVE_CONTEXTO, JSON.stringify(ctx));
    } catch (err) { /* sin storage: se pierde el contexto, nada mas */ }
  }

  function limpiarContexto_() {
    try { window.sessionStorage.removeItem(LLAVE_CONTEXTO); } catch (err) { /* sin storage */ }
  }

  // Se llama en cada render de la lista: cualquier cambio de filtro, KPI,
  // busqueda o agrupacion queda guardado sin tener que cablear cada control.
  // NO toca `scroll`: la posicion se guarda en su propio momento (al salir al
  // detalle o al descargar la pagina), porque el scroll durante un render no
  // representa "donde estaba mirando el usuario".
  function guardarFiltrosEnContexto_() {
    escribirContexto_({
      bandeja: valorDe_('filtro-bandeja'),
      empresa: valorDe_('filtro-empresa'),
      estado: valorDe_('filtro-estado'),
      prioridad: valorDe_('filtro-prioridad'),
      agrupar: valorDe_('filtro-agrupar'),
      texto: valorDe_('buscar-recientes'),
      kpi: kpiActivo
    });
  }

  function guardarScrollEnContexto_() {
    escribirContexto_({ scroll: window.scrollY || window.pageYOffset || 0 });
  }

  function valorDe_(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  // Aplica un valor guardado a un <select> SOLO si esa opcion todavia existe.
  // Un estado/empresa que se dio de baja del catalogo dejaria el select en un
  // valor fantasma que filtra a cero sin que el usuario entienda por que.
  function aplicarSelectSiExiste_(id, valor) {
    if (!valor) return;
    var select = document.getElementById(id);
    if (!select) return;
    var existe = Array.prototype.some.call(select.options, function (o) { return o.value === valor; });
    if (existe) select.value = valor;
  }

  function restaurarContextoEnControles_() {
    var ctx = leerContexto_();
    if (!ctx) return;
    aplicarSelectSiExiste_('filtro-empresa', ctx.empresa);
    aplicarSelectSiExiste_('filtro-estado', ctx.estado);
    aplicarSelectSiExiste_('filtro-prioridad', ctx.prioridad);
    aplicarSelectSiExiste_('filtro-agrupar', ctx.agrupar);
    var buscar = document.getElementById('buscar-recientes');
    // v6.3: se restaura y ya. Antes hacia falta suprimir su envio al backend
    // en esta primera carga (el texto viajaba como `solicitante` y vaciaba la
    // bandeja); ahora backend y cliente buscan por lo mismo, asi que
    // restaurar el texto da el mismo resultado por los dos caminos.
    if (buscar && ctx.texto) buscar.value = ctx.texto;
    // El KPI se valida contra los filtros conocidos: un valor viejo que ya no
    // exista dejaria la lista filtrada por algo que ningun chip puede apagar.
    kpiActivo = ctx.kpi && ETIQUETA_KPI[ctx.kpi] ? ctx.kpi : null;
    bandejaPendiente_ = ctx.bandeja || null;
    restaurarScrollPendiente_ = true;
  }

  function restaurarScrollSiCorresponde_() {
    if (!restaurarScrollPendiente_) return;
    restaurarScrollPendiente_ = false;
    var ctx = leerContexto_();
    if (!ctx || !ctx.scroll) return;
    // Doble rAF: el primero deja que el navegador aplique el layout del HTML
    // recien inyectado, el segundo scrollea ya con la altura definitiva (con
    // uno solo la pagina todavia mide menos y el scroll queda corto).
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        window.scrollTo(0, ctx.scroll);
      });
    });
  }

  function inicializarFiltros_() {
    var empresas = ['HP', 'RLD'];
    var selectEmpresa = document.getElementById('filtro-empresa');
    empresas.forEach(function (id) {
      var opcion = document.createElement('option');
      opcion.value = id;
      opcion.textContent = id;
      selectEmpresa.appendChild(opcion);
    });

    var selectEstado = document.getElementById('filtro-estado');
    Object.keys(SIGSO_ESTADOS_LABEL).forEach(function (codigo) {
      var opcion = document.createElement('option');
      opcion.value = codigo;
      opcion.textContent = codigo + ' — ' + SIGSO_ESTADOS_LABEL[codigo];
      selectEstado.appendChild(opcion);
    });

    // Agrupar es solo de presentacion (no dispara una nueva consulta al
    // backend): reordena lo que ya se cargo.
    document.getElementById('filtro-agrupar').addEventListener('change', renderRecientes_);
    // Fase 10.1: busqueda por texto sobre lo ya cargado (recientesActuales),
    // sin golpear el backend en cada tecla -- igual que Agrupar. P6 (Sprint
    // 2): "Actualizar" SI manda este mismo texto como filtro de solicitante
    // al backend (Dashboard.coincideFiltros_), para buscar en TODAS las
    // solicitudes y no solo en las ultimas 50 (Gerencia necesita responder
    // "de que son los tickets de Juan" sin ese limite).
    // v6.3: al escribir se filtra AL INSTANTE sobre lo ya cargado (respuesta
    // inmediata) y, tras una pausa, se vuelve a consultar al backend con el
    // mismo termino.
    //
    // Los dos pasos usan el MISMO predicado (texto_busqueda), asi que nunca se
    // contradicen: la segunda pasada solo puede AGREGAR solicitudes que no
    // estaban en la ventana cargada, jamas quitar una que ya se mostraba.
    //
    // Sin la reconsulta quedaba un desfase real: despues de "Actualizar" con
    // el termino A, el universo cargado seguia acotado por A, y escribir B
    // filtraba dentro de A -- el usuario veia "0 resultados" aunque B si
    // existiera fuera de esa ventana.
    //
    // El debounce es lo que hace esto viable en Apps Script: se consulta una
    // vez por pausa de escritura, no por tecla.
    var temporizadorBusqueda_ = null;
    document.getElementById('buscar-recientes').addEventListener('input', function () {
      renderRecientes_();
      if (temporizadorBusqueda_) clearTimeout(temporizadorBusqueda_);
      temporizadorBusqueda_ = setTimeout(function () {
        // Se conserva la posicion: reconsultar por escribir no deberia mover
        // la pagina bajo los pies del usuario.
        guardarScrollEnContexto_();
        restaurarScrollPendiente_ = true;
        cargarDashboard_();
      }, MS_DEBOUNCE_BUSQUEDA);
    });
    document.getElementById('btn-exportar-csv').addEventListener('click', exportarCSV_);

    // v6.2 (F4): se restauran los filtros ANTES del primer cargar() -- los
    // <option> de empresa/estado ya se poblaron arriba, asi que
    // aplicarSelectSiExiste_ puede validar contra opciones reales.
    restaurarContextoEnControles_();
    // F4: un F5 tambien conserva la posicion. beforeunload es el ultimo punto
    // donde el scroll real todavia se puede leer.
    window.addEventListener('beforeunload', guardarScrollEnContexto_);

    // v5.0 F3 (§5.2): Prioridad/Agrupar quedan detras de "Filtros avanzados"
    // -- la toolbar de una linea no debe pesar tanto como los datos.
    var btnFiltrosAvanzados = document.getElementById('btn-filtros-avanzados');
    var panelFiltrosAvanzados = document.getElementById('filtros-avanzados-bandeja');
    if (btnFiltrosAvanzados && panelFiltrosAvanzados) {
      document.getElementById('ico-filtros-avanzados').innerHTML = Iconos.svg('filtro', { tam: 14 });
      btnFiltrosAvanzados.addEventListener('click', function () {
        var abierto = !panelFiltrosAvanzados.classList.contains('sigso-oculto');
        panelFiltrosAvanzados.classList.toggle('sigso-oculto', abierto);
        btnFiltrosAvanzados.setAttribute('aria-expanded', String(!abierto));
      });
    }

    // UI-5 (§4): tabs Resumen/Analisis -- los graficos (tendencias) no son
    // el trabajo del dia a dia, se sacan de la vista principal.
    document.getElementById('tabs-dashboard').querySelectorAll('[data-tab]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var tab = boton.getAttribute('data-tab');
        document.getElementById('tabs-dashboard').querySelectorAll('[data-tab]').forEach(function (b) {
          b.classList.toggle('sigso-tabs__boton--activo', b === boton);
        });
        document.getElementById('tab-resumen').classList.toggle('sigso-oculto', tab !== 'resumen');
        document.getElementById('tab-analisis').classList.toggle('sigso-oculto', tab !== 'analisis');
      });
    });

    wireDerivarLote_();
    wirePautaLote_();
    wireSesionPlanificacion_();
  }

  // v5.2 (Fase B, §3.4): "pauta de trabajo por lote" -- UNA hoja con TODAS
  // las pendientes del desarrollador elegido en "Ver bandeja de", en vez de
  // una Orden de Trabajo suelta por solicitud (esa sigue en detalle.js).
  // Solo tiene sentido con una persona concreta elegida (mismo gate visual
  // que el bloque de derivar en lote).
  function wirePautaLote_() {
    var boton = document.getElementById('btn-imprimir-pauta');
    if (!boton) return;
    document.getElementById('filtro-bandeja').addEventListener('change', actualizarVisibilidadPauta_);
    boton.addEventListener('click', function () {
      var desarrollador = document.getElementById('filtro-bandeja').value;
      if (!desarrollador) return;
      boton.disabled = true;
      var textoOriginal = boton.textContent;
      boton.textContent = 'Generando…';
      llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'getPautaTrabajo', { desarrollador: desarrollador })
        .then(function (respuesta) {
          if (!respuesta.ok) {
            Componentes.aviso({ texto: respuesta.message || 'No se pudo generar la pauta.', tipo: 'error' });
            return;
          }
          renderPautaImprimir_(respuesta.data);
          document.body.classList.add('sigso-modo-pauta');
          window.print();
        })
        .catch(function () {
          Componentes.aviso({ texto: 'No se pudo conectar con el servidor. Intenta nuevamente.', tipo: 'error' });
        })
        .finally(function () {
          boton.disabled = false;
          boton.textContent = textoOriginal;
        });
    });
    window.addEventListener('afterprint', function () {
      document.body.classList.remove('sigso-modo-pauta');
    });
  }

  function actualizarVisibilidadPauta_() {
    var hayBandeja = !!document.getElementById('filtro-bandeja').value;
    var boton = document.getElementById('btn-imprimir-pauta');
    if (boton) boton.classList.toggle('sigso-oculto', !hayBandeja);
    var botonPlanificacion = document.getElementById('btn-sesion-planificacion');
    if (botonPlanificacion) botonPlanificacion.classList.toggle('sigso-oculto', !hayBandeja);
    // Si se cambia de bandeja con el panel abierto, se cierra: los datos
    // cargados son de la persona anterior.
    if (!hayBandeja) {
      var panel = document.getElementById('panel-sesion-planificacion');
      if (panel) panel.classList.add('sigso-oculto');
    }
  }

  // Mismo patron visual que renderOtImprimir_ (detalle.js): encabezado con
  // marca + un .sigso-ot-item por item + pie de cierre. Aca los items vienen
  // de VARIAS solicitudes (por eso cada tarjeta muestra su solicitud_id).
  function renderPautaImprimir_(pauta) {
    var contenedor = document.getElementById('dash-pauta-imprimir');
    if (!contenedor) return;
    var items = pauta.items || [];

    var itemsHtml = items.map(function (item) {
      var contexto = [];
      if (item.url_modulo) contexto.push('URL: ' + item.url_modulo);
      if (item.usuario_prueba) contexto.push('Usuario de prueba: ' + item.usuario_prueba);
      if (item.ref_credencial) contexto.push('Credencial: ' + item.ref_credencial);
      var contextoHtml = contexto.length
        ? '<p class="sigso-ot-item__contexto">' + Iconos.svg('lupa', { tam: 14 }) + ' ' + Componentes.escaparHtml(contexto.join(' · ')) + '</p>'
        : '';
      var fechaHtml = item.fecha_comprometida
        ? '<span class="sigso-ot-item__fecha">' + Iconos.svg('calendario', { tam: 14 }) + ' Comprometida: ' + Componentes.escaparHtml(String(item.fecha_comprometida).replace('T', ' ').slice(0, 16)) + '</span>'
        : '<span class="sigso-ot-item__fecha">' + Iconos.svg('calendario', { tam: 14 }) + ' Sin fecha comprometida</span>';

      return '<div class="sigso-ot-item">' +
        '<h3>' + Componentes.escaparHtml(item.solicitud_id) + '-' + item.numero_item + ' — ' + Componentes.escaparHtml(item.titulo) + '</h3>' +
        '<p class="sigso-ot-item__meta">' + Componentes.badgePrioridad(item.prioridad) + ' ' + fechaHtml + '</p>' +
        '<p>' + Componentes.escaparHtml(item.descripcion) + '</p>' +
        (item.resultado_esperado ? '<p><strong>Resultado esperado:</strong> ' + Componentes.escaparHtml(item.resultado_esperado) + '</p>' : '') +
        contextoHtml +
        '</div>';
    }).join('') || '<p>Sin pendientes.</p>';

    contenedor.innerHTML = '<div class="sigso-solo-imprimir sigso-ot-imprimir">' +
      '<div class="sigso-encabezado-reporte">' +
      '<svg class="sigso-marca" width="34" height="34" viewBox="0 0 32 32" aria-hidden="true">' +
      '<rect width="32" height="32" rx="8" fill="#14213D"></rect>' +
      '<text x="16" y="23" font-family="Arial, sans-serif" font-weight="700" font-size="20" fill="#fff" text-anchor="middle">S</text>' +
      '</svg>' +
      '<div><h1>Pauta de trabajo — ' + Componentes.escaparHtml(pauta.desarrollador) + '</h1>' +
      '<p>' + items.length + ' pendiente(s) · Generada el ' + Componentes.escaparHtml(new Date().toLocaleString('es-CL')) + '</p>' +
      '</div></div>' +
      itemsHtml +
      '<p class="sigso-ot-pie">' + Iconos.svg('check', { tam: 14 }) + ' Para cerrar cada una: responde "LISTO &lt;N° de solicitud&gt;" por WhatsApp, o márcala Terminada en el sistema si ya tienes acceso.</p>' +
      '</div>';
  }

  // v5.2 (Fase D, §5): "sesion de planificacion" -- lo que hoy es una
  // conversacion informal ("nos juntamos cada 2 dias") pasa a ser fechas
  // comprometidas de verdad, todas de una sentada. Reusa exactamente los
  // mismos datos de la pauta (getPautaTrabajo) y el mismo backend de
  // siempre (Solicitudes.comprometerFecha, ya usado item por item en
  // detalle.js) -- no hay accion de lote en el backend, cada fila se
  // guarda con su propia llamada.
  var itemsPlanificacion_ = [];

  function wireSesionPlanificacion_() {
    var boton = document.getElementById('btn-sesion-planificacion');
    if (!boton) return;
    boton.addEventListener('click', abrirSesionPlanificacion_);
    document.getElementById('btn-cerrar-planificacion').addEventListener('click', function () {
      document.getElementById('panel-sesion-planificacion').classList.add('sigso-oculto');
    });
    document.getElementById('btn-sugerir-fechas').addEventListener('click', sugerirFechas_);
    document.getElementById('btn-guardar-planificacion').addEventListener('click', guardarPlanificacion_);
  }

  function abrirSesionPlanificacion_() {
    document.getElementById('panel-sesion-planificacion').classList.remove('sigso-oculto');
    document.getElementById('resultado-planificacion').textContent = '';
    cargarItemsPlanificacion_();
  }

  // Separado de abrirSesionPlanificacion_ porque guardarPlanificacion_
  // recarga la tabla al terminar (para reflejar las fechas ya guardadas)
  // pero NO debe borrar el mensaje de "guardadas N de M" que se acaba de
  // mostrar -- solo abrir el panel de nuevo tiene sentido limpiarlo.
  function cargarItemsPlanificacion_() {
    var desarrollador = document.getElementById('filtro-bandeja').value;
    if (!desarrollador) return;
    var tabla = document.getElementById('tabla-sesion-planificacion');
    document.getElementById('titulo-sesion-planificacion').textContent = 'Sesión de planificación';
    tabla.innerHTML = Componentes.esqueleto({ filas: 4 });

    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'getPautaTrabajo', { desarrollador: desarrollador })
      .then(function (respuesta) {
        if (!respuesta.ok) {
          tabla.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cargar la pauta.', 'error');
          return;
        }
        itemsPlanificacion_ = respuesta.data.items || [];
        var nombreSelect = document.getElementById('filtro-bandeja');
        var etiqueta = nombreSelect.options[nombreSelect.selectedIndex]
          ? nombreSelect.options[nombreSelect.selectedIndex].textContent
          : desarrollador;
        document.getElementById('titulo-sesion-planificacion').textContent = 'Sesión de planificación — ' + etiqueta;
        renderTablaPlanificacion_();
      })
      .catch(function () {
        tabla.innerHTML = Componentes.alerta('No se pudo conectar con el servidor. Intenta nuevamente.', 'error');
      });
  }

  function renderTablaPlanificacion_() {
    var tabla = document.getElementById('tabla-sesion-planificacion');
    if (itemsPlanificacion_.length === 0) {
      tabla.innerHTML = Componentes.vacio('Sin pendientes para esta persona.');
      return;
    }
    var filas = itemsPlanificacion_.map(function (item, indice) {
      var actual = item.fecha_comprometida
        ? Componentes.escaparHtml(String(item.fecha_comprometida).replace('T', ' ').slice(0, 16))
        : '<span class="sigso-cuenta-nunca-entro">Sin comprometer</span>';
      return '<tr data-indice="' + indice + '">' +
        '<td data-label="Solicitud">' + Componentes.escaparHtml(item.solicitud_id) + '-' + item.numero_item + '</td>' +
        '<td data-label="Título">' + Componentes.escaparHtml(item.titulo) + '</td>' +
        '<td data-label="Prioridad">' + Componentes.badgePrioridad(item.prioridad) + '</td>' +
        '<td data-label="Fecha actual">' + actual + '</td>' +
        '<td data-label="Nueva fecha"><input type="datetime-local" class="sigso-nueva-fecha" data-indice="' + indice + '" value="' +
          Componentes.escaparHtml(String(item.fecha_comprometida || '').slice(0, 16)) + '"></td>' +
        '</tr>';
    }).join('');
    tabla.innerHTML = '<div style="overflow-x:auto"><table class="sigso-tabla">' +
      '<thead><tr><th>Solicitud</th><th>Título</th><th>Prioridad</th><th>Fecha actual</th><th>Nueva fecha</th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table></div>';
  }

  // Solo completa las filas SIN fecha comprometida -- las que ya tienen una
  // no se tocan (moverla es un re-compromiso, con su propio motivo; no algo
  // que una sugerencia automatica deba decidir por la persona).
  function sugerirFechas_() {
    var intervaloDias = Number(document.getElementById('intervalo-sugerencia').value) || 2;
    var siguiente = new Date();
    siguiente.setHours(9, 0, 0, 0);
    if (siguiente <= new Date()) siguiente.setDate(siguiente.getDate() + 1);

    itemsPlanificacion_.forEach(function (item, indice) {
      if (item.fecha_comprometida) return; // ya comprometida: no se toca
      var input = document.querySelector('.sigso-nueva-fecha[data-indice="' + indice + '"]');
      if (!input) return;
      input.value = formatearFechaLocal_(siguiente);
      siguiente = new Date(siguiente.getTime() + intervaloDias * 24 * 3600 * 1000);
    });
  }

  function formatearFechaLocal_(fecha) {
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return fecha.getFullYear() + '-' + pad(fecha.getMonth() + 1) + '-' + pad(fecha.getDate()) +
      'T' + pad(fecha.getHours()) + ':' + pad(fecha.getMinutes());
  }

  // Guarda SOLO las filas cuya "Nueva fecha" cambio respecto a la actual --
  // una a una (Solicitudes.comprometerFecha no tiene version de lote), y
  // reporta cuantas quedaron bien al final. Si una fila ya tenia fecha y se
  // cambia, es un re-compromiso: exige el motivo compartido del panel.
  function guardarPlanificacion_() {
    var motivo = document.getElementById('motivo-replanificacion').value.trim();
    var boton = document.getElementById('btn-guardar-planificacion');
    var resultado = document.getElementById('resultado-planificacion');
    var pendientes = itemsPlanificacion_
      .map(function (item, indice) { return { item: item, indice: indice }; })
      .filter(function (par) {
        var input = document.querySelector('.sigso-nueva-fecha[data-indice="' + par.indice + '"]');
        var valor = input ? input.value : '';
        return valor && valor !== String(par.item.fecha_comprometida || '').slice(0, 16);
      });

    if (pendientes.length === 0) {
      resultado.textContent = 'No hay fechas nuevas para guardar.';
      return;
    }
    var faltaMotivo = pendientes.some(function (par) { return par.item.fecha_comprometida && motivo.length < 20; });
    if (faltaMotivo) {
      resultado.textContent = 'Hay fechas ya comprometidas que estás cambiando: escribe un motivo de al menos 20 caracteres.';
      return;
    }

    boton.disabled = true;
    resultado.textContent = 'Guardando ' + pendientes.length + ' fecha(s)…';

    // Secuencial (no Promise.all): son escrituras contra la misma hoja, y
    // asi el mensaje de error, si lo hay, se puede asociar a una fila
    // puntual en vez de perderse entre varias promesas en paralelo.
    var resultados = [];
    function siguienteEnvio(indiceCola) {
      if (indiceCola >= pendientes.length) {
        boton.disabled = false;
        var ok = resultados.filter(function (r) { return r.ok; }).length;
        var mensaje = ok + ' de ' + pendientes.length + ' fecha(s) guardadas.' +
          (ok < pendientes.length ? ' Revisa los errores en cada fila.' : '');
        if (ok > 0) {
          // Recarga la tabla (para reflejar lo ya guardado) SIN pisar el
          // mensaje de resultado -- cargarItemsPlanificacion_ no lo toca.
          cargarItemsPlanificacion_().then(function () { resultado.textContent = mensaje; });
        } else {
          resultado.textContent = mensaje;
        }
        return;
      }
      var par = pendientes[indiceCola];
      var input = document.querySelector('.sigso-nueva-fecha[data-indice="' + par.indice + '"]');
      llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'comprometerFecha', {
        subsolicitud_id: par.item.subsolicitud_id,
        fecha_comprometida: input.value,
        motivo: par.item.fecha_comprometida ? motivo : undefined
      }).then(function (respuesta) {
        resultados.push({ ok: respuesta.ok });
        if (!respuesta.ok && input) {
          input.title = respuesta.message || 'No se pudo guardar.';
          input.classList.add('sigso-campo-error');
        }
        siguienteEnvio(indiceCola + 1);
      }).catch(function () {
        resultados.push({ ok: false });
        siguienteEnvio(indiceCola + 1);
      });
    }
    siguienteEnvio(0);
  }

  function leerFiltros_() {
    return {
      empresa_id: document.getElementById('filtro-empresa').value,
      estado: document.getElementById('filtro-estado').value,
      prioridad: document.getElementById('filtro-prioridad').value,
      // v6.3: `busqueda` (no `solicitante`). El backend la evalua contra el
      // MISMO texto que el navegador usa para filtrar en vivo
      // (textoBusquedaSolicitud_ en Dashboard.gs), asi que buscar y despues
      // pulsar "Actualizar" devuelve lo mismo.
      //
      // Se dejo de mandar `solicitante` desde la Bandeja: ese filtro sigue
      // existiendo en el backend, pero es el del Panel de Gerencia, donde el
      // campo esta rotulado "Solicitante" y buscar por titulo seria incorrecto.
      busqueda: document.getElementById('buscar-recientes').value.trim(),
      // v3.0 (Fase 2): solo tiene efecto para ADM/GERENCIA (Dashboard.
      // aplicarAmbitoRol_) -- un responsable individual ya esta acotado a
      // su propia bandeja sin importar este valor.
      verBandeja: document.getElementById('filtro-bandeja').value
    };
  }

  function cargarDashboard_() {
    var filtros = leerFiltros_();
    // v5.0 F4 (§6.3): esqueleto en vez del "blank flash" mientras se pide
    // getDashboardData -- ya existia el componente (Componentes.esqueleto),
    // solo faltaba pintarlo antes de la llamada. Los KPI van sueltos (no
    // envueltos en .sigso-esq) para que la grilla de 4 columnas los reparta
    // igual que a los reales, en vez de apilarlos en una sola celda.
    document.getElementById('contenedor-kpis').innerHTML = new Array(4).fill(
      '<div class="sigso-kpi sigso-esq__tarjeta" aria-busy="true">' +
      '<span class="sigso-esq__barra" style="width:40%;height:22px;margin:0 auto 0.5rem"></span>' +
      '<span class="sigso-esq__barra" style="width:65%;height:10px;margin:0 auto"></span></div>'
    ).join('');
    document.getElementById('lista-recientes').innerHTML = Componentes.esqueleto({ filas: 5 });
    return llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'getDashboardData', filtros).then(function (respuesta) {
      if (!respuesta.ok) {
        // Antes un error del backend dejaba el dashboard en blanco sin avisar
        // (parecia "no hay solicitudes"). Ahora se muestra el error para que
        // se distinga un fallo real de una lista vacia legitima.
        document.getElementById('lista-recientes').innerHTML =
          Componentes.alerta((respuesta.message || 'No se pudieron cargar las solicitudes.') +
            ' Reintenta con "Actualizar"; si persiste, avisa a soporte.', 'error');
        return respuesta;
      }
      // v6.1: recientesActuales se asigna ANTES de renderKpis_ porque los
      // contadores de los KPI ahora se calculan sobre esa misma lista (ver
      // renderKpis_) -- si se pintaran antes, contarian sobre la lista previa.
      recientesActuales = respuesta.data.recientes;
      // v13 (Fase 3): se guardan para el asignado rápido de cada fila.
      responsablesActuales_ = respuesta.data.responsables || [];
      rolActual_ = respuesta.data.rol_actual || '';
      totalSolicitudes_ = respuesta.data.total_solicitudes;
      recientesTruncado_ = !!respuesta.data.recientes_truncado;
      renderKpis_();
      renderAlertasPatron_(respuesta.data.alertas_patron || []);
      renderGrafico_('grafico-estado', 'bar', respuesta.data.por_estado);
      renderGrafico_('grafico-prioridad', 'doughnut', respuesta.data.por_prioridad);
      renderGrafico_('grafico-empresa', 'bar', respuesta.data.por_empresa);
      renderRecientes_();
      // v2.1 (Fase C): el Panel de Gerencia es "su vista principal" -- el
      // boton de acceso solo aparece para ese rol (el backend ya no
      // restringe la accion en si, pero no tiene sentido ofrecersela a
      // quien no es Gerencia).
      document.getElementById('btn-ver-gerencia').classList.toggle('sigso-oculto', respuesta.data.rol_actual !== 'GERENCIA');
      // v4.2: mismo criterio para el acceso a "Mi departamento".
      var botonJefatura = document.getElementById('btn-ver-jefatura');
      if (botonJefatura) botonJefatura.classList.toggle('sigso-oculto', respuesta.data.rol_actual !== 'JEFATURA');
      renderSelectorBandeja_(respuesta.data);
      return respuesta;
    });
  }

  // v3.0 (Fase 2, multi-bandeja): un responsable individual (DEV) ya viene
  // auto-acotado del backend -- solo se le avisa.
  // v4.1.1 (hallazgo real: Gerencia veia TODAS las solicitudes en su
  // bandeja): solo ADM recibe la lista de responsables activos
  // (Dashboard.getData) y puede elegir de quien mirar la bandeja, o
  // "Todas" para ver sin acotar. Cualquier otro rol (GERENCIA incluida)
  // queda igual de auto-acotado que DEV -- Gerencia sigue viendo todo
  // desde el Panel de Gerencia, no desde aca.
  function renderSelectorBandeja_(data) {
    var filaSelector = document.getElementById('fila-bandeja');
    var aviso = document.getElementById('aviso-mi-bandeja');
    var select = document.getElementById('filtro-bandeja');

    if (data.rol_actual !== 'ADM') {
      filaSelector.classList.add('sigso-oculto');
      aviso.classList.remove('sigso-oculto');
      return;
    }
    aviso.classList.add('sigso-oculto');

    if (!data.responsables || data.responsables.length === 0) {
      filaSelector.classList.add('sigso-oculto');
      return;
    }
    // Repuebla preservando la seleccion actual (mismo patron que
    // poblarSelect_ en formulario.js) -- evita perder el filtro elegido
    // cada vez que "Actualizar" vuelve a traer datos.
    var actual = select.value;
    select.innerHTML = '<option value="">Todas (sin acotar)</option>' +
      data.responsables.map(function (r) {
        return '<option value="' + r.email + '">' + Componentes.escaparHtml(r.nombre) + '</option>';
      }).join('');
    select.value = actual;

    // v6.2 (F4): este select es el unico que se puebla DESPUES (sus opciones
    // vienen del backend), asi que su valor guardado no se pudo aplicar en
    // inicializarFiltros_ -- se aplica aca, ya con las opciones reales. Si el
    // responsable guardado ya no esta activo, aplicarSelectSiExiste_ lo
    // descarta en vez de dejar la bandeja filtrada por alguien inexistente.
    if (bandejaPendiente_) {
      var pendiente = bandejaPendiente_;
      bandejaPendiente_ = null;
      aplicarSelectSiExiste_('filtro-bandeja', pendiente);
      // Solo se recarga si de verdad quedo aplicado y cambia lo que se ve:
      // este filtro es de backend, la lista actual no lo refleja todavia.
      if (select.value === pendiente && pendiente !== actual) {
        restaurarScrollPendiente_ = true;
        cargarDashboard_();
      }
    }
    filaSelector.classList.remove('sigso-oculto');
    renderDerivarLote_(data);
    actualizarVisibilidadPauta_();
  }

  // v3.1 (§2.6): el traspaso masivo de una bandeja a otra. Solo se ofrece
  // con una bandeja concreta elegida -- "Todas" derivaria trabajo de gente
  // distinta de una sola vez, que nunca es lo que se quiere.
  function renderDerivarLote_(data) {
    var bloque = document.getElementById('bloque-derivar-lote');
    if (!bloque) return;

    var bandeja = document.getElementById('filtro-bandeja').value;
    var puedeDerivar = data.rol_actual === 'ADM' || data.rol_actual === 'ANA';
    var abiertas = solicitudesAbiertasVisibles_();

    if (!bandeja || !puedeDerivar || abiertas.length === 0) {
      bloque.classList.add('sigso-oculto');
      return;
    }

    var select = document.getElementById('lote-responsable');
    var actual = select.value;
    select.innerHTML = '<option value="">Elige responsable…</option>' +
      (data.responsables || [])
        .filter(function (r) { return r.email !== bandeja; })
        .map(function (r) {
          return '<option value="' + r.email + '">' + Componentes.escaparHtml(r.nombre) + '</option>';
        }).join('');
    select.value = actual;

    document.getElementById('resumen-derivar-lote').textContent =
      'Hay ' + abiertas.length + ' solicitud' + (abiertas.length === 1 ? '' : 'es') +
      ' abierta' + (abiertas.length === 1 ? '' : 's') + ' en esta bandeja.';
    bloque.classList.remove('sigso-oculto');
  }

  // Solo las abiertas: derivar una solicitud ya cerrada no le sirve a nadie
  // y ensuciaria el historial del nuevo responsable.
  function solicitudesAbiertasVisibles_() {
    return recientesActuales.filter(function (s) {
      return ESTADOS_CERRADOS_CLIENTE.indexOf(s.estado_derivado) === -1;
    });
  }

  function wireDerivarLote_() {
    var boton = document.getElementById('btn-derivar-lote');
    if (!boton) return;
    boton.addEventListener('click', function () {
      var responsable = document.getElementById('lote-responsable').value;
      var motivo = document.getElementById('lote-motivo').value;
      var salida = document.getElementById('resultado-derivar-lote');
      var abiertas = solicitudesAbiertasVisibles_();

      if (!responsable) { salida.textContent = 'Elige a quién derivar.'; return; }
      if (motivo.trim().length < 10) { salida.textContent = 'El motivo debe tener al menos 10 caracteres.'; return; }
      if (abiertas.length === 0) { salida.textContent = 'No hay solicitudes abiertas que derivar.'; return; }

      // Confirmacion con el conteo explicito: es la accion mas masiva del
      // Backoffice y no hay "deshacer". Por eso va marcada como peligro.
      var texto = document.getElementById('lote-responsable').selectedOptions[0].textContent;
      Componentes.confirmar({
        titulo: 'Derivar ' + abiertas.length + ' solicitudes',
        mensaje: 'Pasaran a ' + texto + '. Esta accion no se puede deshacer.',
        confirmar: 'Derivar ' + abiertas.length,
        peligro: true
      }).then(function (confirmado) {
        if (confirmado) { derivar_(boton, salida, abiertas, responsable, motivo); }
      });
    });
  }

  function derivar_(boton, salida, abiertas, responsable, motivo) {
    boton.disabled = true;
    salida.textContent = 'Derivando…';
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'derivarSolicitud', {
      solicitud_ids: abiertas.map(function (s) { return s.solicitud_id; }),
      responsable_nuevo: responsable,
      motivo: motivo
    }).then(function (respuesta) {
      boton.disabled = false;
      if (!respuesta.ok) {
        salida.textContent = respuesta.message || 'No se pudo derivar.';
        Componentes.aviso({ tipo: 'error', texto: respuesta.message || 'No se pudo derivar.' });
        return;
      }
      salida.textContent = '';
      Componentes.aviso({ tipo: 'exito', texto: respuesta.data.total + ' solicitudes derivadas.' });
      document.getElementById('lote-motivo').value = '';
      cargarDashboard_();
    }).catch(function () {
      boton.disabled = false;
      salida.textContent = 'No se pudo conectar con el servidor. Intenta nuevamente.';
    });
  }

  var recientesActuales = [];
  // v13 (Fase 3, "asignar desde la fila"): quién puede recibir trabajo y con
  // qué rol miro la bandeja. Se guardan al cargar el dashboard para que la
  // fila pueda ofrecer el asignado rápido sin volver a pedir nada.
  // OJO: el backend solo manda `responsables` al rol ADM -- si la lista viene
  // vacía, la acción sencillamente no se ofrece.
  var responsablesActuales_ = [];
  var rolActual_ = '';
  // Motivo por defecto del asignado rápido. El backend exige 10+ caracteres
  // (RN de derivarSolicitud) y la derivación queda en el historial, así que
  // tiene que ser una frase honesta que explique de dónde salió el cambio.
  var MOTIVO_ASIGNADO_RAPIDO_ = 'Asignada desde la bandeja';
  // v6.1: cuantas solicitudes hay en total vs. cuantas caben en la ventana de
  // RECIENTES_LIMITE. Se muestra explicitamente en vez de dejar creer que la
  // bandeja son todas -- con el orden por urgencia, lo que queda fuera es
  // siempre lo menos urgente, pero eso hay que decirlo, no suponerlo.
  var totalSolicitudes_ = 0;
  var recientesTruncado_ = false;
  // UI-5 (§4): KPI accionable -- clic filtra "Solicitudes recientes" abajo
  // sin golpear el backend de nuevo (mismo patron que categoriaActiva en
  // gerencia.js). null = sin filtro de KPI activo.
  var kpiActivo = null;
  var ESTADOS_CERRADOS_CLIENTE = ['S09', 'S10', 'S11'];

  // v6.1: los contadores se calculan sobre recientesActuales, la MISMA lista
  // que se pinta abajo, aplicando el mismo predicado que usa filtrarPorKpi_.
  //
  // Antes venian de resumen.* (calculado en el backend sobre TODAS las
  // solicitudes) mientras la lista estaba capada a RECIENTES_LIMITE: el KPI
  // podia decir 7 y aparecer 4 filas. El backend sigue mandando resumen
  // (Gerencia/reportes lo usan), pero la bandeja es una cola de trabajo y ahi
  // el numero tiene que ser exactamente "cuantas filas voy a ver".
  //
  // Con el nuevo orden por urgencia del backend, lo vencido y lo en riesgo
  // entra siempre en la ventana, asi que el numero coincide con el global
  // salvo en volumenes muy altos -- y para ese caso se avisa abajo cuantas
  // quedaron fuera (renderNotaTruncado_).
  function contarKpi_(filtro) {
    return recientesActuales.filter(function (s) { return cumpleKpi_(s, filtro); }).length;
  }

  function renderKpis_() {
    document.getElementById('contenedor-kpis').innerHTML =
      Componentes.kpi({ valor: contarKpi_('abiertas'), etiqueta: 'Abiertas', titulo: 'Solicitudes que aun no estan cerradas, rechazadas ni canceladas. Clic para filtrar.', filtro: 'abiertas', activo: kpiActivo === 'abiertas' }) +
      Componentes.kpi({ valor: contarKpi_('criticas'), etiqueta: 'Criticas activas', alerta: true, titulo: 'Solicitudes abiertas de prioridad P1 (la mas alta). Clic para filtrar.', filtro: 'criticas', activo: kpiActivo === 'criticas' }) +
      Componentes.kpi({ valor: contarKpi_('fuera_plazo'), etiqueta: 'Fuera de plazo', alerta: true, titulo: 'Ya pasaron su tiempo objetivo de respuesta segun la prioridad (P1: 2h, P2: 24h, P3: 72h, P4: 120h; en horas habiles). Clic para filtrar.', filtro: 'fuera_plazo', activo: kpiActivo === 'fuera_plazo' }) +
      // v6.1 (A-08): el KPI preventivo que faltaba -- hasta v6.0 la bandeja
      // solo sabia de lo YA vencido, o sea que solo avisaba tarde. Mismo
      // umbral (80% del SLA consumido) con el que el trigger nocturno manda
      // alertaSLAProximo, para que pantalla y correo digan lo mismo.
      Componentes.kpi({ valor: contarKpi_('en_riesgo'), etiqueta: 'En riesgo', alerta: contarKpi_('en_riesgo') > 0, titulo: 'Ya consumieron el 80% de su tiempo objetivo de respuesta y todavia no vencen: si se atienden ahora, no se rompe el plazo. Clic para filtrar.', filtro: 'en_riesgo', activo: kpiActivo === 'en_riesgo' }) +
      // Fase 10.2: reemplaza "Ingresadas hoy" (casi siempre 0, no orienta el
      // trabajo) por "Sin asignar" -- un numero que SI dice a quien hay que
      // ponerle nombre antes de que se convierta en un atraso.
      Componentes.kpi({ valor: contarKpi_('sin_asignar'), etiqueta: 'Sin asignar', alerta: contarKpi_('sin_asignar') > 0, titulo: 'Solicitudes abiertas que todavia no tienen un responsable. Clic para filtrar.', filtro: 'sin_asignar', activo: kpiActivo === 'sin_asignar' });

    document.getElementById('contenedor-kpis').querySelectorAll('[data-filtro-kpi]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var filtro = boton.getAttribute('data-filtro-kpi');
        kpiActivo = kpiActivo === filtro ? null : filtro;
        renderKpis_();
        renderRecientes_();
      });
    });
  }

  // Fase 10.2 (rediseno "Bandeja de trabajo"): clasifica cada solicitud por
  // "que necesita de mi", no por fecha de creacion -- asi lo urgente no
  // compite por el mismo lugar que lo ya resuelto, y "Requieren tu accion"
  // deja de ser una tarjeta aparte que duplicaba filas de la lista de abajo.
  // v6.1: se intercala "En riesgo" con peso visual INTERMEDIO entre lo
  // vencido (rojo, atender ya) y lo sano (atender cuando toque). Es el nivel
  // que faltaba: hasta v6.0 una solicitud pasaba de "todo bien" a "atrasada"
  // sin escalon intermedio donde todavia se podia evitar el incumplimiento.
  var GRUPOS_CLASIFICACION = [
    { clave: 'critica', etiqueta: 'Fuera de plazo y críticas', clase: 'critica', tono: 'critico' },
    { clave: 'riesgo', etiqueta: 'En riesgo — atender antes de que venza', clase: 'riesgo', tono: 'riesgo' },
    { clave: 'esperando_mio', etiqueta: 'Esperando algo mío', clase: 'esperando-mio', tono: 'mio' },
    { clave: 'en_curso', etiqueta: 'En curso', clase: 'en-curso', tono: 'info' },
    { clave: 'esperando_solicitante', etiqueta: 'Esperando al solicitante', clase: 'esperando-solicitante', tono: 'neutro' }
  ];

  function clasificar_(s) {
    var abierta = ESTADOS_CERRADOS_CLIENTE.indexOf(s.estado_derivado) === -1;
    if (!abierta) return 'cerrada';
    // v6.1: la situacion del plazo la calcula el backend (Sla.medir, unica
    // fuente de verdad del eje SLA) -- aca solo se lee. El fallback por
    // horas negativas cubre un backend aun no desplegado que no manda
    // situacion_sla todavia.
    var vencida = s.situacion_sla === 'FUERA_DE_PLAZO' ||
      (!s.situacion_sla && s.sla_restante_horas !== null && s.sla_restante_horas !== undefined && s.sla_restante_horas < 0);
    if (vencida || s.prioridad_derivada === 'P1') return 'critica';
    if (s.situacion_sla === 'EN_RIESGO') return 'riesgo';
    if (!s.asignado_a || !s.fecha_comprometida || s.respuesta_pendiente) return 'esperando_mio';
    if (s.estado_derivado === 'S08') return 'esperando_solicitante';
    return 'en_curso';
  }

  // P7 (v2.0, Sprint 3): "el modulo X acumula N reportes de tipo Error esta
  // semana -- posible causa raiz". Solo se muestra si hay algo que superar
  // umbral (no ensucia el dashboard cuando no hay patrones).
  function renderAlertasPatron_(alertas) {
    var contenedor = document.getElementById('contenedor-alertas-patron');
    if (!alertas.length) {
      contenedor.innerHTML = '';
      return;
    }
    contenedor.innerHTML = Componentes.tarjeta(
      '<h3>Alertas de patrón</h3>' +
      alertas.map(function (a) {
        return Componentes.alerta(
          '<strong>' + Componentes.escaparHtml(a.modulo) + '</strong> acumula ' + a.cantidad +
          ' reportes de tipo <strong>' + Componentes.escaparHtml(a.tipo) + '</strong> en los últimos 7 días (' +
          a.solicitantes_distintos + ' solicitantes distintos) — posible causa raíz.',
          'aviso'
        );
      }).join('')
    );
  }

  function renderGrafico_(idCanvas, tipo, datosAgrupados) {
    var ctx = document.getElementById(idCanvas);
    if (graficos[idCanvas]) {
      graficos[idCanvas].destroy();
    }
    graficos[idCanvas] = new Chart(ctx, {
      type: tipo,
      data: {
        labels: datosAgrupados.map(function (d) { return d.clave; }),
        datasets: [{
          data: datosAgrupados.map(function (d) { return d.total; }),
          // v5.0 (F1): paleta categorial del Design System (indigo primero,
          // luego semanticos) -- antes usaba los hex de la marca 2023.
          backgroundColor: ['#2A5FD6', '#2563EB', '#1F7A55', '#CA9A04', '#C2362B', '#D97706', '#8A93A5']
        }]
      },
      options: { plugins: { legend: { display: tipo === 'doughnut' } } }
    });
  }

  // Fase 10 (rediseno UX): Leo debe entender una solicitud en <10s desde la
  // fila, sin entrar al detalle -- cantidad de items, SLA restante y a
  // quien esta asignada (ya vienen enriquecidos desde Dashboard.gs).
  function renderRecientes_() {
    var contenedor = document.getElementById('lista-recientes');
    var campoAgrupar = document.getElementById('filtro-agrupar').value;
    var filtradas = filtrarPorKpi_(filtrarPorTexto_(recientesActuales));

    // v6.1 (Fase 3): los chips se pintan con el resultado YA filtrado, en el
    // mismo punto donde se decide la lista -- asi el contador y las filas no
    // pueden desincronizarse (mismo criterio que los KPI en la Fase 1).
    renderChipsFiltros_(filtradas.length);

    if (!campoAgrupar) {
      // Fase 10.2: "Sin agrupar" ya no es una lista plana por fecha -- pasa a
      // ser la clasificacion por "que necesita de mi" (4 grupos con orden
      // fijo). Las cerradas se sacan de la vista por defecto (compiten por el
      // mismo espacio que lo urgente) y quedan detras de un <details>.
      contenedor.innerHTML = renderAgrupadoPorClasificacion_(filtradas);
    } else {
      contenedor.innerHTML = agruparPara_(filtradas, campoAgrupar).map(function (grupo) {
        return '<h4 class="sigso-grupo__titulo">' + Componentes.escaparHtml(grupo.etiqueta) + ' (' + grupo.filas.length + ')</h4>' +
          grupo.filas.map(renderFilaReciente_).join('');
      }).join('') || Componentes.vacio({
          icono: 'filtro',
          texto: 'Ninguna solicitud coincide con los filtros.',
          detalle: 'Limpia el buscador o vuelve a "Todos los estados" para ver la bandeja completa.'
        });
    }

    // v6.1: la nota de alcance va SIEMPRE que la lista este recortada, no
    // solo cuando hay un KPI activo -- es la unica forma de que el usuario
    // sepa que "5 abiertas" significa "5 de las 50 mas urgentes que cargue",
    // y no "5 en todo el sistema".
    contenedor.insertAdjacentHTML('beforeend', renderNotaAlcance_());

    // v6.2 (F4): cualquier cambio de filtro/KPI/busqueda/agrupacion pasa por
    // aca, asi que guardar el contexto en un solo punto cubre todos los
    // controles sin cablear cada uno por separado.
    guardarFiltrosEnContexto_();
    // v6.2 (F2): la lista ya esta en el DOM; recien ahora tiene sentido
    // devolver el scroll a donde estaba.
    restaurarScrollSiCorresponde_();

    // v13 (Fase 3): el asignado rápido de cada fila, antes del wiring de la
    // fila -- sus handlers cortan la propagación para no abrir el detalle.
    wireAsignarRapido_(contenedor);

    contenedor.querySelectorAll('[data-id]').forEach(function (fila) {
      function abrir_() {
        if (typeof window.SigsoApp === 'undefined') return;
        // v6.2 (F2): se captura la posicion JUSTO antes de salir al detalle, y
        // se marca que al volver hay que recuperarla. El "volver" de ambos
        // hosts (app.js y plataforma.js) llama SigsoDashboard.cargar(), que
        // consume esta bandera -- por eso no hace falta tocar ninguno de los
        // dos: el unico camino de ida al detalle pasa por aca.
        guardarScrollEnContexto_();
        restaurarScrollPendiente_ = true;
        window.SigsoApp.mostrarDetalle(fila.getAttribute('data-id'));
      }
      fila.addEventListener('click', abrir_);
      // v6.1 (revision UX): la fila declara role="button", asi que tiene que
      // responder a Enter y Espacio como un boton real. Espacio ademas
      // scrollea la pagina por defecto -- se previene.
      fila.addEventListener('keydown', function (evento) {
        if (evento.key === 'Enter' || evento.key === ' ' || evento.key === 'Spacebar') {
          evento.preventDefault();
          abrir_();
        }
      });
    });
  }

  function renderNotaAlcance_() {
    if (!recientesTruncado_) return '';
    return '<p class="sigso-nota-alcance">Mostrando las ' + recientesActuales.length +
      ' solicitudes más urgentes de ' + totalSolicitudes_ +
      '. Las que quedan fuera están en plazo; usa los filtros de arriba para acotar la búsqueda.</p>';
  }

  function renderAgrupadoPorClasificacion_(lista) {
    if (lista.length === 0) {
      return Componentes.vacio({
        icono: 'filtro',
        texto: 'Ninguna solicitud coincide con los filtros.',
        detalle: 'Limpia el buscador o vuelve a "Todos los estados" para ver la bandeja completa.'
      });
    }
    // v6.1: los baldes se derivan de GRUPOS_CLASIFICACION (+ 'cerrada', que no
    // es un grupo visible sino el <details> del final). Antes estaban escritos
    // a mano y al agregar el grupo "riesgo" quedo sin balde -> TypeError al
    // hacer push sobre undefined, y la lista entera no se pintaba.
    var porClave = { cerrada: [] };
    GRUPOS_CLASIFICACION.forEach(function (g) { porClave[g.clave] = []; });
    lista.forEach(function (s) {
      var clave = clasificar_(s);
      (porClave[clave] || porClave.cerrada).push(s);
    });

    var html = GRUPOS_CLASIFICACION.map(function (g) {
      var filas = porClave[g.clave];
      if (filas.length === 0) return '';
      return '<h4 class="sigso-grupo__titulo sigso-grupo__titulo--' + g.clase + '">' +
        Componentes.punto(g.tono) + Componentes.escaparHtml(g.etiqueta) + ' (' + filas.length + ')</h4>' +
        filas.map(renderFilaReciente_).join('');
    }).join('');

    // Las cerradas quedan colapsadas: siguen siendo consultables (un clic) sin
    // ocupar el espacio de arriba, que es para lo que todavia necesita algo.
    if (porClave.cerrada.length > 0) {
      html += '<details class="sigso-grupo-cerradas"><summary>' + Componentes.punto('neutro') + 'Cerradas recientes (' + porClave.cerrada.length + ')</summary>' +
        porClave.cerrada.map(renderFilaReciente_).join('') + '</details>';
    }
    return html || Componentes.vacio({
      icono: 'filtro',
      texto: 'Ninguna solicitud coincide con los filtros.',
      detalle: 'Limpia el buscador o vuelve a "Todos los estados" para ver la bandeja completa.'
    });
  }

  // Busqueda client-side sobre lo ya cargado: N de solicitud, solicitante,
  // correo, empresa y modulo (Fase 10.1, pedido explicito: "que sea facil
  // buscar" en Solicitudes recientes).
  function filtrarPorTexto_(lista) {
    var texto = document.getElementById('buscar-recientes').value.trim().toLowerCase();
    if (!texto) return lista;
    return lista.filter(function (s) {
      // v6.3: se compara contra texto_busqueda, la cadena que arma el backend
      // (textoBusquedaSolicitud_) y que el propio backend usa para filtrar.
      // Una sola definicion de "que es buscable": el navegador no la
      // reimplementa, solo la consulta.
      //
      // El fallback por campos sueltos cubre un Backoffice desplegado con una
      // version anterior que todavia no manda texto_busqueda: la busqueda
      // sigue funcionando en cliente mientras se actualiza el despliegue.
      if (s.texto_busqueda) return s.texto_busqueda.indexOf(texto) !== -1;
      return [s.solicitud_id, s.titulo_item, s.solicitante_nombre, s.solicitante_email, s.empresa_id, s.modulo]
        .some(function (campo) { return String(campo || '').toLowerCase().indexOf(texto) !== -1; });
    });
  }

  // UI-5 (§4): aplica el KPI accionable elegido arriba, sobre lo mismo que
  // ya filtro el buscador -- ambos filtros se combinan (AND), no se pisan.
  // v6.1: UN solo predicado por KPI, usado tanto para CONTAR (contarKpi_,
  // arriba) como para FILTRAR (filtrarPorKpi_). Antes el filtro vivia aqui y
  // el contador lo calculaba el backend con su propia formula: dos formulas
  // para el mismo numero es justo lo que hacia que no cuadraran.
  function cumpleKpi_(s, filtro) {
    var abierta = ESTADOS_CERRADOS_CLIENTE.indexOf(s.estado_derivado) === -1;
    if (filtro === 'abiertas') return abierta;
    if (filtro === 'criticas') return abierta && s.prioridad_derivada === 'P1';
    if (filtro === 'fuera_plazo') return situacionSla_(s) === 'FUERA_DE_PLAZO';
    if (filtro === 'en_riesgo') return situacionSla_(s) === 'EN_RIESGO';
    if (filtro === 'sin_asignar') return abierta && !s.asignado_a;
    return true;
  }

  // Situacion del plazo de una fila. El backend ya la manda calculada
  // (Sla.medir); el fallback por horas restantes solo cubre el caso de un
  // Backoffice desplegado con una version anterior, para no dejar la columna
  // en blanco mientras se actualiza.
  function situacionSla_(s) {
    if (s.situacion_sla) return s.situacion_sla;
    if (s.sla_restante_horas === null || s.sla_restante_horas === undefined) return null;
    return s.sla_restante_horas < 0 ? 'FUERA_DE_PLAZO' : 'EN_PLAZO';
  }

  function filtrarPorKpi_(lista) {
    if (!kpiActivo) return lista;
    return lista.filter(function (s) {
      return cumpleKpi_(s, kpiActivo);
    });
  }

  // --- Fase 3: chips de filtros activos ---------------------------------
  //
  // Como se lee un KPI cuando actua de filtro. Se nombra el EJE
  // ("Situacion: En riesgo") y no la etiqueta del KPI a secas, para que el
  // chip se entienda fuera del contexto de la tarjeta que lo activo.
  var ETIQUETA_KPI = {
    // "Solo abiertas" y no "Estado: abiertas": el select de Estado tiene su
    // propio chip ("Estado: En revisión") y dos chips que empiezan igual pero
    // filtran cosas distintas se leen como contradiccion.
    abiertas: 'Solo abiertas',
    criticas: 'Prioridad: P1',
    fuera_plazo: 'Situación: fuera de plazo',
    en_riesgo: 'Situación: en riesgo',
    sin_asignar: 'Responsable: sin asignar'
  };

  // Descripcion declarativa de TODO lo que esta filtrando ahora mismo. Una
  // sola lista alimenta los chips, el boton de limpiar y el contador -- no se
  // reimplementa ningun filtro aca: cada entrada solo sabe COMO SE APAGA el
  // mecanismo que ya existe (el select, el input o kpiActivo).
  //
  // `recarga: true` = el filtro vive en el backend (leerFiltros_ lo manda en
  // getDashboardData), asi que apagarlo exige volver a pedir los datos.
  // `recarga: false` = filtro de cliente sobre lo ya cargado, basta re-render.
  //
  // "Agrupar" NO entra: no filtra nada, solo reordena lo que ya se ve --
  // mostrarlo como filtro activo haria creer que oculta solicitudes.
  function filtrosActivos_() {
    var activos = [];

    function porSelect_(id, etiqueta, formatear) {
      var select = document.getElementById(id);
      if (!select || !select.value) return;
      var texto = formatear
        ? formatear(select.value, select)
        : select.options[select.selectedIndex].textContent.trim();
      activos.push({
        clave: id, etiqueta: etiqueta + ': ' + texto, recarga: true,
        limpiar: function () { select.value = ''; }
      });
    }

    porSelect_('filtro-bandeja', 'Bandeja');
    porSelect_('filtro-empresa', 'Empresa');
    porSelect_('filtro-estado', 'Estado', function (valor) {
      // El <option> dice "S03 — En revisión"; en el chip sobra el codigo.
      return (typeof SIGSO_ESTADOS_LABEL !== 'undefined' && SIGSO_ESTADOS_LABEL[valor]) || valor;
    });
    porSelect_('filtro-prioridad', 'Prioridad');

    if (kpiActivo) {
      activos.push({
        clave: 'kpi', etiqueta: ETIQUETA_KPI[kpiActivo] || kpiActivo, recarga: false,
        limpiar: function () { kpiActivo = null; }
      });
    }

    var buscar = document.getElementById('buscar-recientes');
    if (buscar && buscar.value.trim()) {
      // Este campo hace doble trabajo: filtra en cliente Y viaja como
      // `solicitante` a getDashboardData al pulsar "Actualizar". Se limpia
      // CON recarga siempre, porque si ya se habia enviado, el universo
      // cargado tambien esta acotado por el -- borrar solo el input dejaria
      // una lista recortada sin ningun filtro visible que lo explique.
      activos.push({
        clave: 'texto', etiqueta: 'Búsqueda: "' + buscar.value.trim() + '"', recarga: true,
        limpiar: function () { buscar.value = ''; }
      });
    }

    return activos;
  }

  function renderChipsFiltros_(cantidadVisible) {
    var contenedor = document.getElementById('chips-filtros');
    if (!contenedor) return;
    var activos = filtrosActivos_();
    if (activos.length === 0) {
      contenedor.innerHTML = '';
      return;
    }

    // El contador responde "¿por que veo esto?" junto a los chips que lo
    // explican, en vez de dejar al usuario contar filas a mano.
    var plural = cantidadVisible === 1 ? 'solicitud' : 'solicitudes';
    contenedor.innerHTML =
      '<span class="sigso-chips-filtros__conteo">' + cantidadVisible + ' ' + plural + '</span>' +
      activos.map(function (f, i) {
        // El proposito va en aria-label (no en un span oculto): el texto
        // visible es el valor del filtro, y la "x" es decorativa.
        return '<button type="button" class="sigso-chip-filtro" data-quitar-filtro="' + i + '" ' +
          'aria-label="Quitar filtro ' + Componentes.escaparHtml(f.etiqueta) + '" ' +
          'title="Quitar filtro">' + Componentes.escaparHtml(f.etiqueta) +
          '<span class="sigso-chip-filtro__x" aria-hidden="true">×</span></button>';
      }).join('') +
      '<button type="button" class="sigso-chips-filtros__limpiar" id="btn-limpiar-filtros">Limpiar filtros</button>';

    contenedor.querySelectorAll('[data-quitar-filtro]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var filtro = activos[Number(boton.getAttribute('data-quitar-filtro'))];
        filtro.limpiar();
        if (filtro.recarga) {
          cargarDashboard_();
        } else {
          renderKpis_();
          renderRecientes_();
        }
      });
    });

    var botonLimpiar = document.getElementById('btn-limpiar-filtros');
    if (botonLimpiar) {
      botonLimpiar.addEventListener('click', function () {
        // Se apagan TODOS con su propia funcion de limpieza (nada de
        // reimplementar aca cual era el valor "vacio" de cada control) y se
        // recarga una sola vez, aunque alguno fuera de cliente.
        activos.forEach(function (f) { f.limpiar(); });
        // v6.2 (F4): "Limpiar filtros" es tambien el "restablecer todo" del
        // contexto guardado -- si solo se apagaran los controles, el proximo
        // F5 volveria a traer los filtros que el usuario acaba de quitar.
        limpiarContexto_();
        restaurarScrollPendiente_ = false;
        window.scrollTo(0, 0);
        cargarDashboard_();
      });
    }
  }

  function agruparPara_(lista, campo) {
    var etiquetador = campo === 'estado_derivado' ? formatearEstadoSigso : function (v) { return v; };
    var grupos = {};
    lista.forEach(function (s) {
      var clave = s[campo] || '(sin dato)';
      if (!grupos[clave]) grupos[clave] = [];
      grupos[clave].push(s);
    });
    return Object.keys(grupos).map(function (clave) {
      return { etiqueta: etiquetador(clave), filas: grupos[clave] };
    });
  }

  // v4.0 Frente 4: la fila gana jerarquia (ID + estado grandes, el resto
  // secundario) y una barra de SLA en vez del semaforo de emoji (🔴🟡🟢) --
  // una barra que se llena con la urgencia se escanea mas rapido que un
  // circulo de color o un numero suelto ("Vence en Xh").
  // Umbral (dias corridos) para el chip "sin movimiento" -- una solicitud
  // puede estar "en plazo" y llevar semanas parada sin que ningun otro
  // indicador se ponga en rojo; esta es la señal que faltaba para eso.
  var DIAS_SIN_MOVIMIENTO_UMBRAL = 5;

  function renderFilaReciente_(s) {
    // v6.1: se retira la barra de SLA de la fila. Decia lo MISMO que el chip
    // de situacion ("Fuera de plazo") y que la linea de tiempo relativo
    // ("Venció hace 1 día"): tres elementos con colores para un unico hecho.
    // Queda el chip (el veredicto, con color) + la linea relativa (el cuando,
    // en gris) -- se lee mas rapido y usa color solo donde comunica.
    // P5 (v2.0, Sprint 3): badge visual de "respuesta recibida" -- para que
    // Leo no dependa solo de encontrar el correo entre el resto de avisos.
    var badgeRespuesta = s.respuesta_pendiente ? ' ' + Componentes.badge('Respuesta recibida', 'P2') : '';
    var badgeSinMovimiento = (s.dias_sin_movimiento || 0) >= DIAS_SIN_MOVIMIENTO_UMBRAL
      ? ' <span class="sigso-chip-sin-movimiento" title="Sin cambios de estado hace ' + s.dias_sin_movimiento + ' días">' + Iconos.svg('reloj', { tam: 13 }) + ' ' + s.dias_sin_movimiento + 'd sin mover</span>'
      : '';
    // Fase 10.2: el titulo del item (lo que el solicitante escribio) es lo
    // que dice de que se trata -- el codigo crudo del catalogo (s.modulo,
    // p.ej. "GDE_GDE_PREVENCION_...") no lo dice. Con varios items, se
    // muestra el primero + "(+N)"; el modulo/plataforma queda como dato
    // secundario en la linea de abajo.
    var titulo = s.titulo_item ? Componentes.escaparHtml(s.titulo_item) : Componentes.escaparHtml(s.modulo || '(sin título)');
    if (s.cantidad_items > 1) titulo += ' <span class="sigso-fila-reciente__mas-items">(+' + (s.cantidad_items - 1) + ')</span>';

    // v6.1 (Fase 2): ESTADO (donde va en el flujo) y SITUACION (como va de
    // plazo) son dos chips distintos y pueden convivir -- "Terminada" +
    // "Fuera de plazo" es un caso real que antes no se podia expresar.
    var chipSituacion = Componentes.chipSituacion(situacionSla_(s), s.sla_restante_horas);
    // El tiempo relativo va en su propia linea, en lenguaje humano; la
    // fecha comprometida exacta queda en el title (dato secundario, no
    // compite con el resto de la fila).
    var relativo = Componentes.tiempoRelativoSla(s.sla_restante_horas);
    var plazo = relativo
      ? '<div class="sigso-fila-reciente__plazo"' +
        (s.fecha_comprometida ? ' title="Fecha comprometida: ' + Componentes.escaparHtml(String(s.fecha_comprometida).replace('T', ' ').slice(0, 16)) + '"' : '') +
        '>' + Componentes.escaparHtml(relativo) + '</div>'
      : '';

    // v6.1 (revision UX): la fila abre el detalle, asi que tiene que ser
    // operable con teclado. Era un <div> con onclick: alcanzable solo con
    // mouse -- desde la bandeja no habia NINGUNA forma de abrir una solicitud
    // sin puntero. role+tabindex la exponen como boton y wireFilas_ ata
    // Enter/Espacio. (No se cambia a <button> nativo porque la fila contiene
    // varios elementos y anidar botones dentro de un boton es HTML invalido.)
    return '<div class="sigso-fila-reciente" data-id="' + s.solicitud_id + '"' +
      ' role="button" tabindex="0"' +
      ' aria-label="Abrir ' + s.solicitud_id + ': ' + Componentes.escaparHtml(s.titulo_item || s.modulo || '') + '">' +
      // v6.2 (F1): jerarquia invertida. El TITULO es la primera linea y el
      // elemento dominante; el ID baja a la linea de metadata (sigue en mono
      // para poder cazarlo de un vistazo, pero ya no compite). Se escanea la
      // bandeja leyendo de que se trata cada solicitud, no codigos.
      // La prioridad y los chips acompanan al titulo en la misma linea porque
      // son el otro dato de triage inmediato.
      '<div class="sigso-fila-reciente__principal">' +
      '<span class="sigso-fila-reciente__titulo">' + titulo + '</span>' +
      Componentes.badgePrioridad(s.prioridad_derivada) + ' ' +
      Componentes.badgeEstado(s.estado_derivado) + (chipSituacion ? ' ' + chipSituacion : '') +
      badgeRespuesta + badgeSinMovimiento +
      '</div>' +
      '<div class="sigso-fila-reciente__meta" title="' + Componentes.escaparHtml(s.modulo || '') + '">' +
      '<span class="sigso-id">' + s.solicitud_id + '</span> &middot; ' +
      s.empresa_id + ' &middot; ' + Componentes.escaparHtml(s.plataforma || '') + ' &middot; ' +
      (s.asignado_nombre ? Componentes.escaparHtml(s.asignado_nombre) : 'Sin asignar') +
      bloqueAsignarRapido_(s) +
      '</div>' +
      plazo +
      '</div>';
  }

  // v13 (Fase 3, "asignar desde la fila"): hasta ahora, para asignar a alguien
  // había que ABRIR el detalle, derivar y volver -- por cada solicitud. La
  // fila era puro triage de lectura. Este control hace el movimiento más
  // común (dar dueño a lo que no lo tiene) sin salir de la bandeja.
  //
  // Reusa `derivarSolicitud` tal cual (acepta solicitud_ids), así que no hay
  // backend nuevo. Como la bandeja lista SOLICITUDES y derivar actúa por
  // ítem, aplica a TODOS los ítems de esa solicitud -- exactamente el mismo
  // criterio que el "derivar en lote" que ya existía.
  function bloqueAsignarRapido_(s) {
    if (!responsablesActuales_.length) return '';                       // solo ADM recibe la lista
    if (ESTADOS_CERRADOS_CLIENTE.indexOf(s.estado_derivado) !== -1) return ''; // cerrada: no se deriva
    var id = s.solicitud_id;
    return ' <button type="button" class="sigso-asignar-rapido js-asignar-abrir" data-sol="' + id + '"' +
        ' title="Asignar responsable sin abrir el detalle">' + Iconos.svg('persona', { tam: 13 }) +
        (s.asignado_nombre ? 'Reasignar' : 'Asignar') + '</button>' +
      '<span class="sigso-asignar-panel sigso-oculto" data-panel-asignar="' + id + '">' +
        '<select class="sigso-asignar-select" data-sol="' + id + '" aria-label="Responsable">' +
          '<option value="">Elige responsable…</option>' +
          responsablesActuales_.map(function (r) {
            return '<option value="' + Componentes.escaparHtml(r.email) + '">' + Componentes.escaparHtml(r.nombre) + '</option>';
          }).join('') +
        '</select>' +
        '<button type="button" class="sigso-boton js-asignar-confirmar" data-sol="' + id + '">Asignar</button>' +
        '<button type="button" class="sigso-boton--sutil js-asignar-cancelar" data-sol="' + id + '">Cancelar</button>' +
      '</span>';
  }

  // Cablea el asignado rápido de cada fila. Todo lleva stopPropagation: la
  // fila entera es un boton que abre el detalle, y un clic en el select o en
  // "Asignar" no debe navegar.
  function wireAsignarRapido_(contenedor) {
    function panelDe_(id) { return contenedor.querySelector('[data-panel-asignar="' + id + '"]'); }

    contenedor.querySelectorAll('.js-asignar-abrir').forEach(function (boton) {
      boton.addEventListener('click', function (ev) {
        ev.stopPropagation();
        // Cierra cualquier otro panel abierto: uno a la vez.
        contenedor.querySelectorAll('.sigso-asignar-panel').forEach(function (p) { p.classList.add('sigso-oculto'); });
        var panel = panelDe_(boton.getAttribute('data-sol'));
        if (panel) { panel.classList.remove('sigso-oculto'); panel.querySelector('select').focus(); }
      });
    });

    contenedor.querySelectorAll('.sigso-asignar-panel').forEach(function (panel) {
      panel.addEventListener('click', function (ev) { ev.stopPropagation(); });
      panel.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') { ev.stopPropagation(); panel.classList.add('sigso-oculto'); }
      });
    });

    contenedor.querySelectorAll('.js-asignar-cancelar').forEach(function (boton) {
      boton.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var panel = panelDe_(boton.getAttribute('data-sol'));
        if (panel) panel.classList.add('sigso-oculto');
      });
    });

    contenedor.querySelectorAll('.js-asignar-confirmar').forEach(function (boton) {
      boton.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var id = boton.getAttribute('data-sol');
        var panel = panelDe_(id);
        var select = panel.querySelector('select');
        var responsable = select.value;
        if (!responsable) {
          Componentes.aviso({ tipo: 'error', texto: 'Elige a quién asignar.' });
          return;
        }
        var nombre = select.selectedOptions[0].textContent;
        boton.disabled = true;
        boton.textContent = 'Asignando…';
        llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'derivarSolicitud', {
          solicitud_ids: [id],
          responsable_nuevo: responsable,
          motivo: MOTIVO_ASIGNADO_RAPIDO_
        }).then(function (respuesta) {
          if (!respuesta.ok) {
            boton.disabled = false;
            boton.textContent = 'Asignar';
            Componentes.aviso({ tipo: 'error', texto: respuesta.message || 'No se pudo asignar.' });
            return;
          }
          Componentes.aviso({ tipo: 'exito', texto: id + ' asignada a ' + nombre + '.' });
          cargarDashboard_();
        }).catch(function () {
          boton.disabled = false;
          boton.textContent = 'Asignar';
          Componentes.aviso({ tipo: 'error', texto: 'No se pudo conectar con el servidor.' });
        });
      });
    });
  }

  // P6 (v2.0, Sprint 2): Gerencia necesita responderle a su jefe sin entrar
  // al sistema -- exporta exactamente lo que esta viendo (recientes +
  // filtro de texto ya aplicado), no un volcado completo aparte.
  function exportarCSV_() {
    var filas = filtrarPorTexto_(recientesActuales);
    var encabezado = ['solicitud_id', 'empresa_id', 'plataforma', 'modulo', 'estado_derivado', 'prioridad_derivada', 'solicitante_nombre', 'solicitante_email', 'asignado_a', 'cantidad_items', 'fecha_creacion'];
    var lineas = [encabezado.join(',')].concat(filas.map(function (s) {
      return encabezado.map(function (campo) {
        return '"' + String(s[campo] || '').replace(/"/g, '""') + '"';
      }).join(',');
    }));
    var blob = new Blob([lineas.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(blob);
    enlace.download = 'sigso-solicitudes-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
  }
})();
