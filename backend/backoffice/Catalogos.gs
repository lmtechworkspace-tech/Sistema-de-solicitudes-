/**
 * Catalogos.gs — Catalogos.guardar (CU-006, RF-019, §4.2). CRUD sobre los
 * catalogos administrables (crear si no existe, actualizar si existe;
 * "desactivar" es la misma operacion con activo=false -- los catalogos
 * nunca se eliminan, RF-F03/§9 v1.0).
 *
 * Permisos por tipo de catalogo (Actor Admin/Analista, doc 5 v1.0):
 * Admin administra los 4; Analista solo Modulos y Tipos ("nivel basico").
 */

var CATALOGOS_CONFIG = {
  EMPRESA: { hoja: 'CAT_EMPRESAS', idCampo: 'empresa_id', roles: ['ADM'] },
  PLATAFORMA: { hoja: 'CAT_PLATAFORMAS', idCampo: 'plataforma_id', roles: ['ADM'] },
  MODULO: { hoja: 'CAT_MODULOS', idCampo: 'modulo_id', roles: ['ADM', 'ANA'] },
  TIPO: { hoja: 'CAT_TIPOS', idCampo: 'tipo_id', roles: ['ADM', 'ANA'] },
  // P12 (v2.0, Sprint 3): CONFIG_NOTIFICACIONES via el mismo CRUD generico
  // -- solo Admin, es una decision de gobierno (C2), no de operacion diaria.
  NOTIFICACION: { hoja: 'CONFIG_NOTIFICACIONES', idCampo: 'notif_id', roles: ['ADM'] }
};

var Catalogos = {
  guardar: function (data, contexto) {
    var config = CATALOGOS_CONFIG[data.tipo];
    if (!config) {
      return errorValidacion_('tipo', 'Tipo de catalogo desconocido: ' + data.tipo);
    }
    if (config.roles.indexOf(contexto.rol) === -1) {
      return { _forbidden: true, message: 'El rol ' + contexto.rol + ' no puede administrar el catalogo ' + data.tipo + '.' };
    }
    if (!data.registro || !data.registro[config.idCampo]) {
      return errorValidacion_(config.idCampo, 'Falta el identificador del registro (' + config.idCampo + ').');
    }

    var actualizado = actualizarFilaPorId_(config.hoja, config.idCampo, data.registro[config.idCampo], data.registro);
    if (actualizado) {
      return actualizado;
    }
    agregarFila_(config.hoja, data.registro);
    return data.registro;
  },

  /**
   * Lista TODAS las filas de un catalogo (activas e inactivas) para el
   * panel de administracion (§12.6, CU-006). No es una accion del router
   * de §4.2 (que solo define guardarCatalogo): se agrega porque el panel
   * de administracion necesita ver y editar tambien los registros
   * desactivados, a diferencia de Catalogos.getAll() (Intake), que solo
   * expone activos al formulario publico.
   */
  listar: function (data, contexto) {
    var config = CATALOGOS_CONFIG[data.tipo];
    if (!config) {
      return errorValidacion_('tipo', 'Tipo de catalogo desconocido: ' + data.tipo);
    }
    if (config.roles.indexOf(contexto.rol) === -1) {
      return { _forbidden: true, message: 'El rol ' + contexto.rol + ' no puede ver el catalogo ' + data.tipo + '.' };
    }
    return leerFilas_(config.hoja);
  }
};
