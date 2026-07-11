/**
 * Catalogos.gs — Catalogos.getAll() (§4.2, dato no sensible, acceso anonimo).
 * Solo devuelve entradas activas: los catalogos inactivos son un detalle de
 * administracion (Fase 6) que el formulario publico no necesita ver.
 */

var Catalogos = {
  getAll: function () {
    return {
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
