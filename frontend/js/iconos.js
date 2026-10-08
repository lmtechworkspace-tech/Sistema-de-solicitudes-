/**
 * iconos.js — set de iconos vectoriales del sistema (v4.0, Frente 1).
 *
 * Reemplaza los emoji que se usaban como iconos (🗂 📊 ⚙️ ...). Un emoji lo
 * dibuja el sistema operativo: cambia de forma, color y tamano entre Windows,
 * Mac y Android, y nunca hereda el color del texto. Estos son trazos SVG que
 * heredan `currentColor` y escalan con la tipografia.
 *
 * Uso:   Iconos.svg('bandeja')                -> string HTML
 *        Iconos.svg('check', { tam: 12 })     -> tamano puntual
 *
 * Estilo: trazo de 1.9, extremos redondeados, caja 24x24 (familia Feather).
 * Para agregar uno nuevo basta con sumar su `d` al mapa TRAZOS.
 */
var Iconos = (function () {
  var TRAZOS = {
    // Navegacion / modulos
    inicio: '<path d="M3 10l9-7 9 7v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    nueva: '<path d="M12 5v14M5 12h14"/>',
    lista: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    bandeja: '<path d="M3 7l2-3h14l2 3v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M3 7h18"/>',
    grafico: '<path d="M3 3v18h18"/><path d="M7 15l3-4 3 2 4-6"/>',
    config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.6 1.6 0 008 19.4a1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H2a2 2 0 110-4h.1A1.6 1.6 0 004.6 8a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V2a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H22a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/>',

    // Estados y eventos del historial
    estado: '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0115-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 01-15 6.7L3 16"/>',
    calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    derivar: '<path d="M4 12h12M12 6l6 6-6 6"/>',
    comentario: '<path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.5 8.5 0 01-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0112 3a8.4 8.4 0 019 8.5z"/>',
    candado: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
    rayo: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',

    // Datos de la solicitud
    lupa: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    etiqueta: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-7.2-7.2a2 2 0 01-.6-1.4V4a2 2 0 012-2h8a2 2 0 011.4.6l6.4 6.4a2 2 0 010 2.8z"/><path d="M7 7h.01"/>',
    caja: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    persona: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    empresa: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4a1 1 0 011-1h6a1 1 0 011 1v3M9 12h.01M15 12h.01M9 16h.01M15 16h.01"/>',
    ubicacion: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1116 0z"/><circle cx="12" cy="10" r="3"/>',
    adjunto: '<path d="M21 12.5l-8.5 8.5a5 5 0 01-7-7L14 5.5a3.5 3.5 0 015 5L9.5 20"/>',
    imagen: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-9 9"/>',
    // v6.4: subir/cambiar la foto de perfil. Distinta de `imagen` (que
    // representa un archivo ya adjunto): esta es la accion de capturar.
    camara: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>',
    // v6.5: modulo Novedades -- campana de "algo nuevo que atender", el
    // icono universal para esta idea (distinto de `alerta`, que es un
    // triangulo de advertencia puntual).
    // Marketing corporativo (2026-10-03): megáfono, mismo trazo que el resto.
    megafono: '<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 11-5.8-1.6"/>',
    campana: '<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>',
    documento: '<path d="M14 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V7z"/><path d="M14 2v5h5"/>',

    // Acciones e interfaz
    check: '<path d="M20 6L9 17l-5-5"/>',
    equis: '<path d="M18 6L6 18M6 6l12 12"/>',
    alerta: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
    corazon: '<path d="M12 20.5s-7.2-4.4-9.2-8.9A5 5 0 0112 6.6a5 5 0 019.2 5c-2 4.5-9.2 8.9-9.2 8.9z"/>', // Hompy: corazón coreano
    ojo: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    ojoTachado: '<path d="M9.9 5.2A9.6 9.6 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-2.7 3.7M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.6 9.6 0 004.1-.9"/><path d="M10 10a3 3 0 004 4"/><path d="M2 2l20 20"/>',
    copiar: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
    editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
    basura: '<path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>',
    // Pantalla completa / salir de pantalla completa (Carta Gantt).
    expandir: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    reducir: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
    llave: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M17 6l3 3M14 9l3 3"/>',
    mas: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
    salir: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
    abajo: '<path d="M6 9l6 6 6-6"/>',
    arriba: '<path d="M18 15l-6-6-6 6"/>',
    izquierda: '<path d="M15 18l-6-6 6-6"/>',
    derecha: '<path d="M9 18l6-6-6-6"/>',
    subir: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    descargar: '<path d="M12 5v14M5 12l7 7 7-7"/>',
    imprimir: '<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><path d="M6 14h12v7H6z"/>',
    filtro: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',

    // v5.0 F2: chrome del shell (sidebar)
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    luna: '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>',
    colapsar: '<path d="M9 3v18"/><path d="M15 9l-3 3 3 3"/><rect x="3" y="3" width="18" height="18" rx="2"/>',

    // v10.0 Fase 2 (rediseno visual del modulo Calidad): objetivos de
    // calidad (una meta -> diana) y cobertura ISO (conformidad -> escudo).
    diana: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    escudo: '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/>',

    // v14.0 "piel nueva": iconos PROPIOS por modulo (antes Gerencia, Mi
    // departamento y Coordinacion compartian 'grafico', y Administracion un
    // engranaje anticuado), mas los glifos que faltaban para reemplazar los
    // emoji de la interfaz por trazos que heredan color y tamano.
    tendencia: '<path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/>',          // Gerencia
    equipo: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.6"/><path d="M18.5 20a5.5 5.5 0 0 0-3-4.9"/>', // Mi departamento
    portapapeles: '<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2.5" width="6" height="4" rx="1"/><path d="m9 13 2 2 4-4"/>', // Coordinacion de pausas
    tareas: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1.4 1.4L6.5 4.2"/><path d="m3 12 1.4 1.4L6.5 10.2"/><path d="m3 18 1.4 1.4L6.5 16.2"/>', // Mi trabajo
    ajustes: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="7" cy="17" r="2.2"/>', // Administracion
    actividad: '<path d="M3 12h4l2 5 4-12 2 7h6"/>',                          // Pausas activas
    capas: '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/>',      // Proyectos
    escudoCheck: '<path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>', // Calidad
    enlace: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>', // Enlace magico
    correo: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>', // Canal correo
    campanaOff: '<path d="M8.7 3.9A6 6 0 0 1 18 8c0 2.6.5 4.4 1.2 5.7"/><path d="M17 17H4s3-2 3-9c0-.5 0-1 .1-1.4"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M2 2l20 20"/>', // Notificaciones silenciadas
    // "Bloqueado / en pausa" -- reemplaza el simbolo ⏸ (que en Windows sale
    // como emoji azul). Barras rellenas para que se lea a tamano chico.
    pausado: '<rect x="7" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.6" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none"/>',

    // v2 (Proyectos v2, sistema visual .sx2): navegación por secciones,
    // modos de vista y gráficos. Mismo trazo/caja que el resto.
    bandera: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>', // Hito
    carpeta: '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>', // Archivos
    kanban: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/>',
    tabla: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 10v10"/>',
    gantt: '<path d="M3 3v18"/><path d="M7 7h8M10 12h9M7 17h6"/>',
    exportar: '<path d="M4 14v5a2 2 0 002 2h12a2 2 0 002-2v-5"/><path d="M12 3v12M7 8l5-5 5 5"/>',
    dinero: '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>', // Costos
    rejilla: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>', // Resumen
    tendenciaBaja: '<path d="M3 7l6 6 4-4 8 8"/><path d="M17 17h4v-4"/>',
    dona: '<path d="M21.2 15.9A10 10 0 118 2.8"/><path d="M22 12A10 10 0 0012 2v10z"/>',
    destello: '<path d="M12 3l1.8 4.9L19 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5 9.7l4.9-1.8z"/><path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z"/>', // "Nueva versión"
    // Barra lateral (2026-10-05): fijar una pantalla.
    estrella: '<path d="M12 2.8l2.8 5.7 6.3.9-4.6 4.4 1.1 6.2L12 17l-5.6 3 1.1-6.2-4.6-4.4 6.3-.9z"/>',
    // Barra lateral, segunda versión (2026-10-05): un ícono propio por módulo, sin repetidos.
    casco: '<path d="M4 16a8 8 0 0116 0"/><path d="M10 8.5V5h4v3.5"/><path d="M2.5 16h19v2.5h-19z"/>',
    recibo: '<path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z"/><path d="M9 7.5h6M9 11h6M9 14.5h4"/>',
    periodico: '<rect x="3" y="4" width="15" height="16" rx="2"/><path d="M18 8h3v10a2 2 0 01-2 2"/><path d="M7 8h7M7 12h7M7 16h4"/>',
    maletin: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"/><path d="M3 13h18"/>',
    gafete: '<rect x="4.5" y="3" width="15" height="18" rx="2"/><circle cx="12" cy="10" r="2.8"/><path d="M8 17.2a4 4 0 018 0"/>',
    medalla: '<circle cx="12" cy="9" r="6"/><path d="M8.6 13.8 7.5 21.5l4.5-2.6 4.5 2.6-1.1-7.7"/>',
    // Manuales de uso (2026-10-06).
    libro: '<path d="M4 4.5A2.5 2.5 0 016.5 2H20v17H6.5A2.5 2.5 0 004 21.5z"/><path d="M4 21.5A2.5 2.5 0 016.5 19H20v3H6.5"/><path d="M8.5 7h7M8.5 10.5h5"/>',
    bombilla: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0012 3z"/>'
  };

  /**
   * @param {string} nombre clave de TRAZOS
   * @param {{tam?:number, clase?:string, titulo?:string}} [opciones]
   *        titulo: si se pasa, el icono se anuncia a lectores de pantalla;
   *        si no, se marca aria-hidden (es decorativo junto a un texto).
   */
  // Hompy (2026-10-06): el ícono del módulo de la mascota es SU CARA, no un
  // trazo. Una <img> (no <svg>): donde el shell arma una máscara con el trazo
  // (encabezado de página), simplemente no encuentra uno y no la pinta.
  function hompy_(opts) {
    var tam = opts.tam || 16;
    return '<img class="sigso-ico sigso-ico--hompy' + (opts.clase ? ' ' + opts.clase : '') + '" src="assets/hompy/hompy-cara.webp"' +
      ' width="' + tam + '" height="' + tam + '" alt="' + (opts.titulo ? String(opts.titulo).replace(/"/g, '&quot;') : '') + '"' +
      (opts.titulo ? '' : ' aria-hidden="true"') + ' decoding="async">';
  }

  function svg(nombre, opciones) {
    if (nombre === 'hompy') return hompy_(opciones || {});
    var trazo = TRAZOS[nombre];
    if (!trazo) {
      return '';
    }
    var opts = opciones || {};
    var tam = opts.tam || 16;
    var accesible = opts.titulo
      ? ' role="img" aria-label="' + String(opts.titulo).replace(/"/g, '&quot;') + '"'
      : ' aria-hidden="true"';

    return '<svg class="sigso-ico' + (opts.clase ? ' ' + opts.clase : '') + '"' +
      ' width="' + tam + '" height="' + tam + '" viewBox="0 0 24 24"' + accesible + '>' +
      trazo + '</svg>';
  }

  return { svg: svg, TRAZOS: TRAZOS };
})();
