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

  window.SigsoDirectorio = {
    juntarCorreos: juntarCorreos,
    resolver: resolver,
    persona: persona,
    etiqueta: etiqueta,
    html: html
  };
})();
