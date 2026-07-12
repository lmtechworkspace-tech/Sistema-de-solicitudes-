/**
 * Catalogos.gs — Catalogos.getAll() (§4.2, dato no sensible, acceso anonimo).
 * Solo devuelve entradas activas: los catalogos inactivos son un detalle de
 * administracion (Fase 6) que el formulario publico no necesita ver.
 */

// v3.0 (optimizacion): los catalogos cambian rara vez pero se leen en CADA
// carga del formulario (5 hojas completas). Se cachean 5 minutos en
// CacheService -- mismo patron/TTL que Dashboard.getData (C-13). La
// consecuencia aceptada es que un cambio de catalogo desde Administracion
// puede tardar hasta 5 minutos en verse en el formulario publico.
var CATALOGOS_CACHE_TTL_SEGUNDOS = 300;

var Catalogos = {
  getAll: function () {
    var cache = CacheService.getScriptCache();
    var cacheado = cache.get('catalogos_publicos');
    if (cacheado) {
      return JSON.parse(cacheado);
    }
    var datos = {
      empresas: filtrarActivos_(leerFilas_(SHEETS.CAT_EMPRESAS)),
      plataformas: filtrarActivos_(leerFilas_(SHEETS.CAT_PLATAFORMAS)),
      modulos: filtrarActivos_(leerFilas_(SHEETS.CAT_MODULOS)),
      tipos: filtrarActivos_(leerFilas_(SHEETS.CAT_TIPOS)),
      // v3.0 (Fase 1): el formulario elige por AREA. Se proyecta a solo
      // {area_id, nombre} -- el responsable_email NUNCA viaja al navegador
      // publico (se resuelve del lado del servidor en crearSolicitud). Si la
      // hoja no existe aun (instalacion previa a v3.0), se devuelve vacio y
      // el formulario simplemente no muestra el selector de area.
      areas: proyectarAreasPublicas_()
    };
    // CacheService limita cada valor a ~100 KB: si el catalogo creciera mas
    // que eso, se sirve sin cachear en vez de romper (mismo criterio que
    // Gerencia.getPanel).
    try {
      cache.put('catalogos_publicos', JSON.stringify(datos), CATALOGOS_CACHE_TTL_SEGUNDOS);
    } catch (err) {
      // demasiado grande para el cache: se sirve directo.
    }
    return datos;
  }
};

function proyectarAreasPublicas_() {
  var filas;
  try {
    filas = leerFilas_(SHEETS.CAT_AREAS);
  } catch (err) {
    return [];
  }
  return filtrarActivos_(filas).map(function (a) {
    return { area_id: a.area_id, nombre: a.nombre };
  });
}

function filtrarActivos_(filas) {
  return filas.filter(function (fila) {
    return fila.activo === true || fila.activo === 'TRUE' || fila.activo === 1;
  });
}
