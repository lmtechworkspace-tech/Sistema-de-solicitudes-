/**
 * Auth.gs — Auth.gestionarUsuario (RF-019, CU-007, §8.7). Solo Admin.
 * Autorizacion sigue siendo por email verificado por Google (§3.1): esto
 * NO es un login, es la gestion de la fila usuario_id/rol/activo.
 */

var Auth = {
  gestionarUsuario: function (data, contexto) {
    if (contexto.rol !== 'ADM') {
      return { _forbidden: true, message: 'Solo un Administrador puede gestionar usuarios.' };
    }
    if (!data.email) {
      return errorValidacion_('email', 'Falta el email del usuario.');
    }

    var usuarioExistente = buscarUsuarioPorEmail_(data.email);

    // RN-030: no puede quedar una empresa con menos de 2 Administradores
    // activos. Se valida antes de desactivar o de cambiar el rol de un
    // Admin a otro rol.
    var vaAQuedarSinRolAdmin = usuarioExistente && usuarioExistente.rol === 'ADM' &&
      (data.activo === false || (data.rol && data.rol !== 'ADM'));
    if (vaAQuedarSinRolAdmin) {
      var otrosAdminsActivos = leerFilas_(SHEETS.USUARIOS).filter(function (u) {
        return u.empresa_id === usuarioExistente.empresa_id && u.rol === 'ADM' &&
          u.email !== data.email && esActivo_(u);
      });
      if (otrosAdminsActivos.length < 1) {
        return errorValidacion_(
          'rol',
          'No se puede aplicar: quedaria menos de 2 Administradores activos en ' +
            usuarioExistente.empresa_id + ' (RN-030).'
        );
      }
    }

    var cambios = {};
    if (data.nombre !== undefined) cambios.nombre = data.nombre;
    if (data.rol !== undefined) cambios.rol = data.rol;
    if (data.activo !== undefined) cambios.activo = data.activo;
    if (data.empresa_id !== undefined) cambios.empresa_id = data.empresa_id;

    if (usuarioExistente) {
      return actualizarFilaPorId_(SHEETS.USUARIOS, 'email', data.email, cambios);
    }

    // RN-031: un usuario pertenece a una sola empresa (ya lo garantiza el
    // esquema: una fila = un email = un empresa_id).
    if (!data.empresa_id) {
      return errorValidacion_('empresa_id', 'Falta la empresa para crear el usuario.');
    }
    var nuevoUsuario = {
      usuario_id: Utilities.getUuid(),
      nombre: data.nombre || '',
      email: data.email,
      empresa_id: data.empresa_id,
      rol: data.rol || 'ANA',
      activo: data.activo !== undefined ? data.activo : true,
      ultimo_acceso: '',
      creado_por: contexto.email
    };
    agregarFila_(SHEETS.USUARIOS, nuevoUsuario);
    return nuevoUsuario;
  },

  // Lista los usuarios para el panel de administracion (§12.6, CU-007). No
  // es una accion del router de §4.2 (ver la misma nota en
  // Catalogos.listar); solo Admin gestiona usuarios.
  listarUsuarios: function (data, contexto) {
    if (contexto.rol !== 'ADM') {
      return { _forbidden: true, message: 'Solo un Administrador puede ver la lista de usuarios.' };
    }
    return leerFilas_(SHEETS.USUARIOS);
  },

  // A-11 (§13/16.3 v1.0, RN-029): "usuario inactivo (mas de 90 dias sin
  // acceso) es suspendido automaticamente y debe ser reactivado por el
  // Admin". Corre semanalmente (lunes 08:00, Triggers.gs). No suspende
  // usuarios que nunca han accedido (ultimo_acceso vacio): recien creados,
  // les da margen para su primer ingreso en vez de nacer ya sospechosos.
  suspenderInactivos: function () {
    var ahora = new Date().getTime();
    var suspendidos = [];
    leerFilas_(SHEETS.USUARIOS).forEach(function (usuario) {
      if (!esActivo_(usuario) || !usuario.ultimo_acceso) {
        return;
      }
      var diasSinAcceso = (ahora - new Date(usuario.ultimo_acceso).getTime()) / (24 * 60 * 60 * 1000);
      if (diasSinAcceso > DIAS_INACTIVIDAD_SUSPENSION) {
        actualizarFilaPorId_(SHEETS.USUARIOS, 'email', usuario.email, { activo: false });
        suspendidos.push(usuario.email);
      }
    });
    return suspendidos;
  }
};

var DIAS_INACTIVIDAD_SUSPENSION = 90;

function buscarUsuarioPorEmail_(email) {
  var filas = leerFilas_(SHEETS.USUARIOS);
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].email === email) {
      return filas[i];
    }
  }
  return null;
}

function esActivo_(usuario) {
  return usuario.activo === true || usuario.activo === 'TRUE' || usuario.activo === 1;
}
