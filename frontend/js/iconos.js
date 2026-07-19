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
    documento: '<path d="M14 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V7z"/><path d="M14 2v5h5"/>',

    // Acciones e interfaz
    check: '<path d="M20 6L9 17l-5-5"/>',
    equis: '<path d="M18 6L6 18M6 6l12 12"/>',
    alerta: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
    ojo: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    ojoTachado: '<path d="M9.9 5.2A9.6 9.6 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-2.7 3.7M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.6 9.6 0 004.1-.9"/><path d="M10 10a3 3 0 004 4"/><path d="M2 2l20 20"/>',
    copiar: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
    editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
    basura: '<path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>',
    llave: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M17 6l3 3M14 9l3 3"/>',
    mas: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
    salir: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
    abajo: '<path d="M6 9l6 6 6-6"/>',
    arriba: '<path d="M18 15l-6-6-6 6"/>',
    izquierda: '<path d="M15 18l-6-6 6-6"/>',
    derecha: '<path d="M9 18l6-6-6-6"/>',
    subir: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    descargar: '<path d="M12 5v14M5 12l7 7 7-7"/>',
    filtro: '<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>'
  };

  /**
   * @param {string} nombre clave de TRAZOS
   * @param {{tam?:number, clase?:string, titulo?:string}} [opciones]
   *        titulo: si se pasa, el icono se anuncia a lectores de pantalla;
   *        si no, se marca aria-hidden (es decorativo junto a un texto).
   */
  function svg(nombre, opciones) {
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
