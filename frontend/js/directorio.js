/**
 * directorio.js — Fase 2 del Directorio de Personas (2026-09-22), la CAPA DE
 * VISUALIZACIÓN: dado un correo (la llave con la que hoy vive casi todo en
 * SIGSO), resuelve "Nombre — Cargo" para pintarlo en vez del correo crudo.
 * Ver la nota completa en backend/logica/directorioPersonas.js.
 *
 * Mismo patrón que ya usa el resto del sistema para datos que llegan async
 * (ej. proyectos.js#cargarDatosCronograma_): se pinta YA con lo que haya en
 * caché (o el correo crudo si no hay nada), se pide en segundo plano lo que
 * falte, y se repinta una sola vez cuando llega. Nunca bloquea un render.
 *
 * Debe cargar después de api.js/components.js y antes de cualquier módulo
 * que lo use (dashboard.js, gerencia.js, proyectos.js, calidad.js...).
 */
(function () {
  var cache_ = {}; // correo_normalizado -> persona formateada (ver directorioPersonas.js#formatear_)

  function normalizarEmail_(email) {
    return String(email || '').trim().toLowerCase();
  }

  function urlBackoffice_() {
    return (window.SIGSO_CONFIG || {}).BACKOFFICE_URL;
  }

  // Junta correos de varias fuentes (arrays, o valores sueltos) en una lista
  // plana sin vacíos ni duplicados -- para no tener que armar el array a mano
  // en cada pantalla que junta responsable/colaboradores/jefatura/etc.
  function juntarCorreos() {
    var vistos = {};
    var lista = [];
    Array.prototype.forEach.call(arguments, function (valor) {
      var items = Array.isArray(valor) ? valor : [valor];
      items.forEach(function (e) {
        var norm = normalizarEmail_(e);
        if (norm && !vistos[norm]) { vistos[norm] = true; lista.push(norm); }
      });
    });
    return lista;
  }

  // Pide al backend los correos que todavía no están en caché. Devuelve una
  // promesa que resuelve SIEMPRE (nunca rechaza -- degradación elegante: si
  // falla, el llamador simplemente sigue mostrando el correo crudo).
  function resolver(emails) {
    var faltantes = (emails || []).map(normalizarEmail_).filter(function (e) {
      return e && !cache_[e];
    });
    if (!faltantes.length) return Promise.resolve(cache_);
    return llamarApi(urlBackoffice_(), 'resolverDirectorioPersonas', { emails: faltantes })
      .then(function (respuesta) {
        var personas = (respuesta && respuesta.ok && respuesta.data && respuesta.data.personas) || {};
        Object.keys(personas).forEach(function (correo) { cache_[correo] = personas[correo]; });
        return cache_;
      })
      .catch(function () { return cache_; });
  }

  // Búsqueda sincrónica en caché -- null si todavía no se resolvió (o nunca
  // se pidió). Pensada para usar DESPUÉS de resolver(), o junto a un repintado
  // condicionado a que la promesa ya haya llegado.
  function persona(email) {
    return cache_[normalizarEmail_(email)] || null;
  }

  // "Nombre — Cargo" si ya se resolvió, o el correo crudo como respaldo (así
  // un llamador puede usarla de inmediato sin esperar la red).
  function etiqueta(email) {
    var p = persona(email);
    return p ? p.etiqueta : (email || '');
  }

  // Igual que etiqueta(), pero como HTML ya escapado, con el correo como
  // tooltip para quien lo necesite (auditoría, soporte).
  function html(email, opts) {
    var texto = Componentes.escaparHtml(etiqueta(email));
    var claseExtra = (opts && opts.clase) ? ' ' + opts.clase : '';
    return '<span class="sigso-directorio-nombre' + claseExtra + '" title="' + Componentes.escaparHtml(email || '') + '">' + texto + '</span>';
  }

  // --- Fase 3 (2026-09-30): el SELECTOR de personas --------------------------
  // Donde antes había que escribir un correo a mano, ahora se busca a la
  // persona por nombre, RUT o cargo. Basta marcar el campo con `data-persona`:
  // se mejora solo al aparecer en la página (MutationObserver), así que ningún
  // formulario cambia su forma de leer los datos.
  //
  // Por dentro se sigue guardando el CORREO (la llave de todo SIGSO; pasar a
  // persona_id es la Fase 4, en pausa): el input original queda oculto con su
  // mismo name y value, y delante aparece el buscador. Quien no está en el
  // directorio (un externo, una cuenta recién creada) se puede escribir con su
  // correo completo, como siempre.
  var secuencia_ = 0;
  var AVISO_ELEGIR = 'Elige a la persona de la lista o escribe su correo completo.';

  function esCorreo_(t) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(t || '').trim()); }
  function esc_(t) { return Componentes.escaparHtml(String(t == null ? '' : t)); }

  // Busca en el servidor (acotado a tu organización y a personas activas).
  // Solo sirven las que tienen correo: es lo que se guarda.
  function buscar(texto) {
    return llamarApi(urlBackoffice_(), 'buscarDirectorioPersonas', { texto: texto })
      .then(function (r) {
        var lista = (r && r.ok && r.data && r.data.personas) || [];
        lista.forEach(function (p) { (p.emails || []).forEach(function (e) { cache_[normalizarEmail_(e)] = p; }); });
        return lista.filter(function (p) { return (p.emails || []).length; });
      })
      .catch(function () { return []; });
  }

  function mejorarCampo(original) {
    if (original.__sigsoPersona || !original.parentNode) return;
    original.__sigsoPersona = true;
    var idLista = 'sigso-persona-' + (++secuencia_);

    var caja = document.createElement('div');
    caja.className = 'sigso-persona';
    var visible = document.createElement('input');
    visible.type = 'text';
    visible.className = original.className || 'sx2-input';
    visible.setAttribute('autocomplete', 'off');
    visible.setAttribute('role', 'combobox');
    visible.setAttribute('aria-autocomplete', 'list');
    visible.setAttribute('aria-expanded', 'false');
    visible.setAttribute('aria-controls', idLista);
    visible.placeholder = 'Busca por nombre, RUT o cargo';
    // La indicación que traía el campo ("De otra área…") no se pierde.
    if (original.placeholder && !/@/.test(original.placeholder)) visible.title = original.placeholder;
    if (original.id) { visible.id = original.id; original.removeAttribute('id'); }
    if (original.required) visible.required = true;
    if (original.disabled) visible.disabled = true;
    var lista = document.createElement('ul');
    lista.id = idLista;
    lista.className = 'sigso-persona__lista';
    lista.setAttribute('role', 'listbox');
    lista.hidden = true;

    original.parentNode.insertBefore(caja, original);
    caja.appendChild(visible);
    caja.appendChild(lista);
    caja.appendChild(original);
    original.removeAttribute('list');
    original.required = false;
    original.type = 'hidden';

    var opciones = [], activa = -1, pedido = 0, espera = null;

    function validar() {
      visible.setCustomValidity(visible.value.trim() && !original.value ? AVISO_ELEGIR : '');
    }
    function mostrarGuardado() {
      var email = original.value;
      if (!email) { visible.value = ''; visible.removeAttribute('data-correo'); return; }
      var p = persona(email);
      visible.value = p ? p.etiqueta : email;
      visible.setAttribute('data-correo', email);
    }
    function cerrar() {
      lista.hidden = true;
      visible.setAttribute('aria-expanded', 'false');
      visible.removeAttribute('aria-activedescendant');
      activa = -1;
    }
    function marcar(i) {
      activa = i;
      Array.prototype.forEach.call(lista.children, function (li, k) { li.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
      var li = lista.children[i];
      if (li && li.id) { visible.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
    }
    function pintar(texto) {
      if (!opciones.length) {
        lista.innerHTML = '<li class="sigso-persona__vacio">' + (esCorreo_(texto)
          ? 'No está en el directorio: se usará el correo tal como lo escribiste.'
          : 'Nadie coincide. Si no está en el directorio, escribe su correo completo.') + '</li>';
      } else {
        lista.innerHTML = opciones.map(function (p, i) {
          var meta = [p.emails[0], p.rut, p.tiene_cuenta ? '' : 'sin cuenta en SIGSO'].filter(Boolean).join(' · ');
          return '<li class="sigso-persona__op" role="option" id="' + idLista + '-' + i + '" data-i="' + i + '" aria-selected="false">' +
            '<span class="sigso-persona__nombre">' + esc_(p.nombre) + (p.cargo ? ' <span class="sigso-persona__cargo">— ' + esc_(p.cargo) + '</span>' : '') + '</span>' +
            '<span class="sigso-persona__meta">' + esc_(meta) + '</span></li>';
        }).join('');
      }
      lista.hidden = false;
      visible.setAttribute('aria-expanded', 'true');
      activa = -1;
    }
    function elegir(p) {
      original.value = p.emails[0];
      mostrarGuardado();
      validar();
      cerrar();
      original.dispatchEvent(new Event('change', { bubbles: true }));
    }

    visible.addEventListener('input', function () {
      var texto = visible.value.trim();
      visible.removeAttribute('data-correo');
      // Un correo completo vale tal cual (personas fuera del directorio).
      original.value = esCorreo_(texto) ? texto.toLowerCase() : '';
      validar();
      clearTimeout(espera);
      if (texto.length < 2) { cerrar(); return; }
      var n = ++pedido;
      espera = setTimeout(function () {
        buscar(texto).then(function (lista_) {
          if (n !== pedido || document.activeElement !== visible) return; // llegó tarde
          opciones = lista_.slice(0, 8);
          pintar(texto);
        });
      }, 200);
    });
    visible.addEventListener('keydown', function (ev) {
      if (lista.hidden || !opciones.length) { if (ev.key === 'Escape' && !lista.hidden) cerrar(); return; }
      if (ev.key === 'ArrowDown') { ev.preventDefault(); marcar((activa + 1) % opciones.length); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); marcar((activa - 1 + opciones.length) % opciones.length); }
      else if (ev.key === 'Enter') { ev.preventDefault(); elegir(opciones[activa >= 0 ? activa : 0]); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cerrar(); }
    });
    // mousedown (no click): elegir antes de que el blur cierre la lista.
    lista.addEventListener('mousedown', function (ev) {
      var li = ev.target.closest('.sigso-persona__op');
      ev.preventDefault();
      if (li) elegir(opciones[Number(li.getAttribute('data-i'))]);
    });
    visible.addEventListener('blur', function () { clearTimeout(espera); pedido++; cerrar(); validar(); });

    // Lo que ya estaba guardado se muestra con nombre y cargo.
    if (original.value) {
      mostrarGuardado();
      resolver([original.value]).then(function () { if (document.activeElement !== visible && original.value) mostrarGuardado(); });
    }
  }

  function mejorarDentro(raiz) {
    if (!raiz || raiz.nodeType !== 1) return;
    if (raiz.matches && raiz.matches('input[data-persona]')) mejorarCampo(raiz);
    if (raiz.querySelectorAll) Array.prototype.forEach.call(raiz.querySelectorAll('input[data-persona]'), mejorarCampo);
  }
  function vigilar() {
    mejorarDentro(document.body);
    if (typeof MutationObserver === 'undefined') return;
    new MutationObserver(function (cambios) {
      cambios.forEach(function (c) { Array.prototype.forEach.call(c.addedNodes, mejorarDentro); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (typeof document !== 'undefined' && document.body) vigilar();
  else if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', vigilar);

  window.SigsoDirectorio = {
    juntarCorreos: juntarCorreos,
    resolver: resolver,
    persona: persona,
    etiqueta: etiqueta,
    html: html,
    buscar: buscar,
    mejorarCampo: mejorarCampo
  };
})();
