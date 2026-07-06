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
      tipos: filtrarActivos_(leerFilas_(SHEETS.CAT_TIPOS))
    };
  }
};

function filtrarActivos_(filas) {
  return filas.filter(function (fila) {
    return fila.activo === true || fila.activo === 'TRUE' || fila.activo === 1;
  });
}
