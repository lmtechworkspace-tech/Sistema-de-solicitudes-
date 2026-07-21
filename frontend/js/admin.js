/**
 * admin.js — panel de administracion (§12.6, CU-006/CU-007). Catalogos:
 * crear/editar/desactivar (nunca eliminar, RF-F03). Usuarios: crear/editar/
 * activar/desactivar (RN-029/030/031).
 */
(function () {
  var CATALOGOS_UI = {
    EMPRESA: {
      titulo: 'Empresas',
      campos: [
        { nombre: 'empresa_id', label: 'Código', soloAlCrear: true },
        { nombre: 'nombre', label: 'Nombre' },
        { nombre: 'logo', label: 'Logo (URL)' },
        { nombre: 'activo', label: 'Activo', tipo: 'checkbox' }
      ]
    },
    PLATAFORMA: {
      titulo: 'Plataformas',
      campos: [
        { nombre: 'plataforma_id', label: 'Código', soloAlCrear: true },
        { nombre: 'nombre', label: 'Nombre' },
        { nombre: 'empresa_id', label: 'Empresa (código)' },
        { nombre: 'url_base', label: 'URL base' },
        { nombre: 'activo', label: 'Activo', tipo: 'checkbox' }
      ]
    },
    MODULO: {
      titulo: 'Módulos',
      campos: [
        { nombre: 'modulo_id', label: 'Código', soloAlCrear: true },
        { nombre: 'nombre', label: 'Nombre' },
        { nombre: 'plataforma_id', label: 'Plataforma (código)' },
        // Jerarquia real de hasta 4 niveles (modulo principal > submodulo >
        // item, post-Fase 8): vacio si este modulo es raiz de su plataforma.
        { nombre: 'modulo_padre_id', label: 'Módulo padre (código, opcional)' },
        { nombre: 'activo', label: 'Activo', tipo: 'checkbox' }
      ]
    },
    TIPO: {
      titulo: 'Tipos de solicitud',
      campos: [
        { nombre: 'tipo_id', label: 'Código', soloAlCrear: true },
        { nombre: 'nombre', label: 'Nombre' },
        { nombre: 'prioridad_default', label: 'Prioridad sugerida (informativa)' },
        // P2 (v2.0, Sprint 2): a diferencia de prioridad_default (solo
        // informativa), este SI afecta la prioridad real -- derivarPrioridad_
        // (backend/intake/Solicitudes.gs) no deja que un tipo urgente quede
        // por debajo de P2, sin importar el impacto que declare el solicitante.
        { nombre: 'es_urgente', label: 'Urgente por naturaleza (afecta la prioridad real)', tipo: 'checkbox' },
        { nombre: 'activo', label: 'Activo', tipo: 'checkbox' }
      ]
    },
    // v3.0 (Fase 1, multi-responsable): areas -> responsable. El formulario
    // publico elige por AREA (por nombre); aqui se define a que correo se le
    // rutea cada area. El responsable_email nunca se muestra al publico.
    AREA: {
      titulo: 'Áreas / responsables',
      campos: [
        { nombre: 'area_id', label: 'Código', soloAlCrear: true },
        { nombre: 'nombre', label: 'Nombre del área (lo ve el solicitante)' },
        { nombre: 'responsable_email', label: 'Correo del responsable (recibe las solicitudes)' },
        { nombre: 'activo', label: 'Activo', tipo: 'checkbox' }
      ]
    },
    // P12 (v2.0, Sprint 3): CONFIG_NOTIFICACIONES estaba infrautilizada --
    // ahora "AVISO_LEO" es el switch global de "avisar automaticamente al
    // equipo de desarrollo" (cliente/P1/opt-in). Desactivarlo hace que
    // NINGUNA solicitud le avise a Leo por correo, sin tocar codigo
    // (resuelve C2: "Felipe dijo que no le enviara ni un correo todavia").
    NOTIFICACION: {
      titulo: 'Notificaciones',
      campos: [
        { nombre: 'notif_id', label: 'Código', soloAlCrear: true },
        { nombre: 'evento', label: 'Evento' },
        { nombre: 'rol_destinatario', label: 'Rol destinatario (opcional)' },
        { nombre: 'emails_extra', label: 'Correos extra (opcional)' },
        { nombre: 'activo', label: 'Activo', tipo: 'checkbox' }
      ]
    }
  };

  var USUARIOS_UI = {
    titulo: 'Usuarios',
    campos: [
      { nombre: 'email', label: 'Email', soloAlCrear: true },
      { nombre: 'nombre', label: 'Nombre' },
      { nombre: 'empresa_id', label: 'Empresa (código)' },
      // §12.1 (v2.0, Sprint 1): renombre de roles a nivel de etiqueta -- el
      // codigo interno (ANA/DEV/ADM en USUARIOS.rol y en todos los checks de
      // permisos, RN-007/008/009) NO cambia (evita reescribir cada
      // comparacion de rol en el backend por un cambio cosmetico). Solo se
      // aclara aqui, para quien administra usuarios, que ANA y DEV son las
      // dos variantes de "Gestor" (RN-201: el que gestiona, no el que cierra).
      { nombre: 'rol', label: 'Rol: ANA = Gestor/Analista, DEV = Gestor técnico, ADM = Administrador' },
      { nombre: 'activo', label: 'Activo', tipo: 'checkbox' }
    ]
  };

  // v3.3 P4: este script tambien se carga en plataforma.html. Alli el menu
  // se cablea igual, pero el primer click (que dispara la primera llamada a
  // la API) queda DIFERIDO hasta que plataforma.js abre el modulo con una
  // sesion valida -- si se disparara al cargar la pagina, pediria catalogos
  // antes del login. En admin.html (standalone, identidad Google) el
  // comportamiento de siempre no cambia.
  window.SigsoAdmin = {
    abrir: function () {
      var primero = document.querySelector('.sigso-admin-menu__item');
      if (primero) primero.click();
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof renderHeaderSigso === 'function') {
      renderHeaderSigso('admin');
    }
    document.querySelectorAll('.sigso-admin-menu__item').forEach(function (boton) {
      boton.addEventListener('click', function () {
        document.querySelectorAll('.sigso-admin-menu__item').forEach(function (b) {
          b.classList.remove('sigso-admin-menu__item--activo');
        });
        boton.classList.add('sigso-admin-menu__item--activo');
        cerrarDrawerAdmin_();
        var tipo = boton.getAttribute('data-tipo');
        if (tipo === 'USUARIOS') {
          renderUsuarios_();
        } else if (tipo === 'CUENTAS_PORTAL') {
          renderCuentasPortal_();
        } else if (tipo === 'LOGS') {
          renderLogs_();
        } else if (tipo === 'JEFATURAS') {
          renderJefaturas_();
        } else {
          renderCatalogo_(tipo);
        }
      });
    });
    // #vista-shell solo existe en plataforma.html: ahi el arranque lo hace
    // SigsoAdmin.abrir() al entrar al modulo.
    if (!document.getElementById('vista-shell')) {
      document.querySelector('.sigso-admin-menu__item').click();
    }
    wireDrawerAdmin_();
  });

  // v5.0 F3b (§5.6): drawer lateral compartido por todos los formularios de
  // Administracion -- "Nuevo" o una fila lo abren con el formulario de la
  // seccion activa; cerrar (boton/telon/Escape) no manda nada, solo oculta.
  function wireDrawerAdmin_() {
    var drawer = document.getElementById('drawer-admin');
    var telon = document.getElementById('drawer-admin-telon');
    var btnCerrar = document.getElementById('btn-cerrar-drawer-admin');
    if (!drawer || !telon || !btnCerrar) return;
    document.getElementById('ico-cerrar-drawer-admin').innerHTML = Iconos.svg('equis', { tam: 16 });
    btnCerrar.addEventListener('click', cerrarDrawerAdmin_);
    telon.addEventListener('click', cerrarDrawerAdmin_);
    document.addEventListener('keydown', function (evento) {
      if (evento.key === 'Escape' && !drawer.classList.contains('sigso-oculto')) {
        cerrarDrawerAdmin_();
      }
    });
  }

  function abrirDrawerAdmin_(titulo, formularioHtml, wireForm) {
    document.getElementById('drawer-admin-titulo').textContent = titulo;
    document.getElementById('drawer-admin-cuerpo').innerHTML = formularioHtml;
    document.getElementById('drawer-admin').classList.remove('sigso-oculto');
    document.getElementById('drawer-admin-telon').classList.remove('sigso-oculto');
    if (wireForm) wireForm();
    var primerCampo = document.querySelector('#drawer-admin-cuerpo [data-campo]');
    if (primerCampo) primerCampo.focus();
  }

  function cerrarDrawerAdmin_() {
    document.getElementById('drawer-admin').classList.add('sigso-oculto');
    document.getElementById('drawer-admin-telon').classList.add('sigso-oculto');
    document.getElementById('drawer-admin-cuerpo').innerHTML = '';
  }

  // Si google.script.run rechaza (o el fetch falla), la promesa se rechaza y
  // sin .catch la vista quedaba EN BLANCO (sintoma "no carga"). Este handler
  // muestra el error real en vez de dejar el panel vacio.
  function mostrarErrorAdmin_(err) {
    var mensaje = (err && err.message) ? err.message : 'No se pudo contactar el servidor. Revisa tu sesion/permiso e intenta de nuevo.';
    document.getElementById('admin-contenido').innerHTML = Componentes.alerta(mensaje, 'error');
  }

  // v5.0 F3b (§5.6): cabecera comun -- titulo + "Nuevo" (unica accion
  // primaria de la seccion). Se repite igual en catalogos/usuarios.
  function cabeceraAdmin_(titulo) {
    return '<div class="sigso-admin-cab"><h2>' + Componentes.escaparHtml(titulo) + '</h2>' +
      '<button type="button" class="sigso-boton sigso-admin-cab__boton" id="btn-nuevo-admin">' +
      Iconos.svg('nueva', { tam: 16 }) + ' Nuevo</button></div>';
  }

  function renderCatalogo_(tipo) {
    var config = CATALOGOS_UI[tipo];
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'listarCatalogo', { tipo: tipo }).then(function (respuesta) {
      var contenedor = document.getElementById('admin-contenido');
      if (!respuesta.ok) {
        contenedor.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cargar.', 'error');
        return;
      }
      contenedor.innerHTML =
        cabeceraAdmin_(config.titulo) +
        Componentes.tarjeta(renderTabla_(config.campos, respuesta.data));

      var wireForm = function () {
        document.getElementById('form-admin').addEventListener('submit', function (evento) {
          evento.preventDefault();
          guardarCatalogo_(tipo, config.campos);
        });
      };
      document.getElementById('btn-nuevo-admin').addEventListener('click', function () {
        abrirDrawerAdmin_(config.titulo, renderFormulario_(config.campos), wireForm);
      });
      document.querySelectorAll('[data-editar]').forEach(function (fila) {
        fila.addEventListener('click', function () {
          var registro = JSON.parse(fila.getAttribute('data-editar'));
          abrirDrawerAdmin_(config.titulo, renderFormulario_(config.campos), function () {
            wireForm();
            precargarFormulario_(config.campos, registro);
          });
        });
      });
    }).catch(mostrarErrorAdmin_);
  }

  function renderUsuarios_() {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'listarUsuarios', {}).then(function (respuesta) {
      var contenedor = document.getElementById('admin-contenido');
      if (!respuesta.ok) {
        contenedor.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cargar.', 'error');
        return;
      }
      contenedor.innerHTML =
        cabeceraAdmin_(USUARIOS_UI.titulo) +
        Componentes.tarjeta(renderTabla_(USUARIOS_UI.campos, respuesta.data));

      var wireForm = function () {
        document.getElementById('form-admin').addEventListener('submit', function (evento) {
          evento.preventDefault();
          guardarUsuario_(USUARIOS_UI.campos);
        });
      };
      document.getElementById('btn-nuevo-admin').addEventListener('click', function () {
        abrirDrawerAdmin_(USUARIOS_UI.titulo, renderFormulario_(USUARIOS_UI.campos), wireForm);
      });
      document.querySelectorAll('[data-editar]').forEach(function (fila) {
        fila.addEventListener('click', function () {
          var registro = JSON.parse(fila.getAttribute('data-editar'));
          abrirDrawerAdmin_(USUARIOS_UI.titulo, renderFormulario_(USUARIOS_UI.campos), function () {
            wireForm();
            precargarFormulario_(USUARIOS_UI.campos, registro);
          });
        });
      });
    }).catch(mostrarErrorAdmin_);
  }

  // v3.3 (plataforma): cuentas del portal. A diferencia de USUARIOS (staff
  // por correo Google), aqui la identidad es usuario+contrasena y una cuenta
  // puede tener VARIOS correos. La clave temporal se muestra UNA sola vez al
  // crear/resetear -- no queda guardada en ninguna parte (solo su hash).
  var ROLES_PORTAL = [
    { valor: 'SOLICITANTE', texto: 'Solicitante' },
    { valor: 'ANA', texto: 'Gestor/Analista' },
    { valor: 'DEV', texto: 'Desarrollador' },
    { valor: 'GERENCIA', texto: 'Gerencia' },
    // v4.2: "Gerencia acotado" al equipo del jefe (ver pestaña "Jefaturas").
    { valor: 'JEFATURA', texto: 'Jefatura' },
    { valor: 'ADM', texto: 'Administrador' }
  ];
  var MODULOS_PORTAL = [
    { valor: 'nueva_solicitud', texto: 'Nueva solicitud' },
    { valor: 'mis_solicitudes', texto: 'Mis solicitudes' },
    { valor: 'bandeja', texto: 'Bandeja de trabajo' },
    { valor: 'gerencia', texto: 'Panel de gerencia' },
    { valor: 'jefatura', texto: 'Mi departamento (Jefatura)' },
    { valor: 'administracion', texto: 'Administración' }
  ];

  function formularioCuentaPortal_() {
    return '<form id="form-cuenta-portal">' +
      '<div class="sigso-admin-form">' +
      Componentes.campoTexto({ dataCampo: 'usuario', label: 'Usuario (para el login, ej. cpena)' }) +
      Componentes.campoTexto({ dataCampo: 'nombre', label: 'Nombre completo' }) +
      Componentes.campoTexto({ dataCampo: 'cargo', label: 'Cargo (autocompleta el formulario)' }) +
      Componentes.campoTexto({ dataCampo: 'emails', label: 'Correos asociados (separados por coma)' }) +
      Componentes.campoSelect({ dataCampo: 'rol', label: 'Rol', placeholder: false, valor: 'SOLICITANTE', opciones: ROLES_PORTAL }) +
      Componentes.campoTexto({ dataCampo: 'empresa_id', label: 'Empresa (código, opcional)' }) +
      '</div>' +
      '<div class="sigso-campo"><label>Módulos (vacío = según rol)</label>' +
      renderChipsModulos_([]) +
      '</div>' +
      Componentes.boton({ tipo: 'submit', texto: 'Guardar cuenta' }) +
      '<div id="resultado-admin"></div>' +
      '</form>';
  }

  function renderCuentasPortal_() {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'listarCuentasPortal', {}).then(function (respuesta) {
      var contenedor = document.getElementById('admin-contenido');
      if (!respuesta.ok) {
        contenedor.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cargar.', 'error');
        return;
      }
      var cuentas = respuesta.data.cuentas || [];
      contenedor.innerHTML =
        cabeceraAdmin_('Cuentas de la plataforma') +
        '<p class="sigso-ayuda">La identidad del portal: cada cuenta es una persona; sus correos son una lista ' +
        '(separados por coma) y el portal le muestra las solicitudes de todos ellos. Los módulos definen qué ve al entrar.</p>' +
        Componentes.tarjeta(renderTablaCuentas_(cuentas));

      var wireForm = function () {
        document.getElementById('form-cuenta-portal').addEventListener('submit', function (evento) {
          evento.preventDefault();
          guardarCuentaPortal_();
        });
        wireChipsModulos_();
      };
      document.getElementById('btn-nuevo-admin').addEventListener('click', function () {
        cuentaEnEdicion_ = null;
        abrirDrawerAdmin_('Nueva cuenta', formularioCuentaPortal_(), wireForm);
      });
      document.querySelectorAll('[data-cuenta]').forEach(function (fila) {
        fila.addEventListener('click', function (e) {
          if (e.target.closest('button')) return; // los botones de accion mandan
          var cuenta = JSON.parse(fila.getAttribute('data-cuenta'));
          abrirDrawerAdmin_('Editar cuenta', formularioCuentaPortal_(), function () {
            wireForm();
            precargarCuenta_(cuenta);
          });
        });
      });
      document.querySelectorAll('[data-accion-cuenta]').forEach(function (boton) {
        boton.addEventListener('click', function () {
          accionCuenta_(boton.getAttribute('data-accion-cuenta'), boton.getAttribute('data-id'), boton.getAttribute('data-activo') === 'true', boton.getAttribute('data-usuario'));
        });
      });
    }).catch(mostrarErrorAdmin_);
  }

  // v4.0 Frente 5: chips de multi-seleccion en vez del campo de texto libre
  // "modulos separados por coma" -- un clic marca/desmarca, sin que el
  // Admin tenga que recordar de memoria los 5 nombres validos.
  function renderChipsModulos_(seleccionados) {
    return '<div class="sigso-chips sigso-chips-modulos">' + MODULOS_PORTAL.map(function (m) {
      var activo = seleccionados.indexOf(m.valor) !== -1 ? ' sigso-chip--activo' : '';
      return '<button type="button" class="sigso-chip' + activo + '" data-chip-modulo="' + m.valor + '">' + m.texto + '</button>';
    }).join('') + '</div>';
  }

  function wireChipsModulos_() {
    document.querySelectorAll('[data-chip-modulo]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        chip.classList.toggle('sigso-chip--activo');
      });
    });
  }

  function modulosSeleccionados_() {
    return [].slice.call(document.querySelectorAll('[data-chip-modulo].sigso-chip--activo'))
      .map(function (chip) { return chip.getAttribute('data-chip-modulo'); });
  }

  // v4.0 Frente 5: avatar de iniciales + "Nunca entró" cuando ultimo_acceso
  // esta vacio -- antes esa columna directamente no existia, asi que no
  // habia forma de saber si una cuenta creada hace un mes se llego a usar.
  function inicialesCuenta_(nombre) {
    var partes = String(nombre || '').trim().split(/\s+/);
    return ((partes[0] || '')[0] || '') + ((partes[1] || '')[0] || '');
  }

  function renderTablaCuentas_(cuentas) {
    if (cuentas.length === 0) {
      return Componentes.vacio({
        icono: 'persona',
        texto: 'Aún no hay cuentas de plataforma.',
        detalle: 'Crea la primera con "Nuevo": el sistema genera una clave temporal que le entregas a la persona.'
      });
    }
    var filas = cuentas.map(function (c) {
      var ultimoAcceso = c.ultimo_acceso
        ? Componentes.escaparHtml(String(c.ultimo_acceso).replace('T', ' ').slice(0, 16))
        : '<span class="sigso-cuenta-nunca-entro">Nunca entró</span>';
      return '<tr data-cuenta=\'' + JSON.stringify(c).replace(/'/g, '&#39;') + '\'>' +
        '<td><div class="sigso-cuenta-fila">' +
        '<span class="sigso-cuenta-fila__avatar">' + Componentes.escaparHtml(inicialesCuenta_(c.nombre).toUpperCase()) + '</span>' +
        '<div><div>' + Componentes.escaparHtml(c.usuario) + '</div>' +
        '<div class="sigso-ayuda">' + Componentes.escaparHtml(c.nombre) + '</div></div>' +
        '</div></td>' +
        '<td>' + Componentes.escaparHtml((c.emails || []).join(', ')) + '</td>' +
        '<td>' + Componentes.escaparHtml(c.rol) + '</td>' +
        '<td>' + Componentes.escaparHtml((c.modulos || []).join(', ')) + '</td>' +
        '<td>' + Componentes.badge(c.activo ? 'Sí' : 'No', c.activo ? 'P4' : 'P1') + '</td>' +
        '<td>' + ultimoAcceso + '</td>' +
        '<td>' +
        '<button type="button" class="sigso-boton--secundario" data-accion-cuenta="resetear" data-id="' + c.cuenta_id + '">Resetear clave</button> ' +
        '<button type="button" class="sigso-boton--secundario" data-accion-cuenta="asignar_password" data-id="' + c.cuenta_id + '" data-usuario="' + Componentes.escaparHtml(c.usuario) + '">Asignar clave</button> ' +
        '<button type="button" class="sigso-boton--secundario" data-accion-cuenta="renombrar" data-id="' + c.cuenta_id + '" data-usuario="' + Componentes.escaparHtml(c.usuario) + '">Renombrar</button> ' +
        '<button type="button" class="sigso-boton--secundario" data-accion-cuenta="activar" data-id="' + c.cuenta_id + '" data-activo="' + !c.activo + '">' + (c.activo ? 'Desactivar' : 'Activar') + '</button> ' +
        '<button type="button" class="sigso-boton--peligro" data-accion-cuenta="eliminar" data-id="' + c.cuenta_id + '" data-usuario="' + Componentes.escaparHtml(c.usuario) + '">Eliminar</button>' +
        '</td></tr>';
    }).join('');
    return '<table class="sigso-tabla"><thead><tr>' +
      '<th>Cuenta</th><th>Correos</th><th>Rol</th><th>Módulos</th><th>Activa</th><th>Último acceso</th><th>Acciones</th>' +
      '</tr></thead><tbody>' + filas + '</tbody></table>';
  }

  var cuentaEnEdicion_ = null;

  function precargarCuenta_(cuenta) {
    cuentaEnEdicion_ = cuenta.cuenta_id;
    var campos = {
      usuario: cuenta.usuario, nombre: cuenta.nombre, cargo: cuenta.cargo,
      emails: (cuenta.emails || []).join(', '), rol: cuenta.rol,
      empresa_id: cuenta.empresa_id
    };
    Object.keys(campos).forEach(function (nombre) {
      var input = document.querySelector('#form-cuenta-portal [data-campo="' + nombre + '"]');
      if (input) input.value = campos[nombre] || '';
    });
    // El usuario se cambia con el boton "Renombrar" de la tabla (valida
    // formato/unicidad en el backend), no desde este formulario.
    document.querySelector('#form-cuenta-portal [data-campo="usuario"]').disabled = true;
    document.querySelector('.sigso-chips-modulos').outerHTML = renderChipsModulos_(cuenta.modulos || []);
    wireChipsModulos_();
  }

  function guardarCuentaPortal_() {
    var leer = function (nombre) {
      return document.querySelector('#form-cuenta-portal [data-campo="' + nombre + '"]').value.trim();
    };
    var datos = {
      operacion: cuentaEnEdicion_ ? 'actualizar' : 'crear',
      nombre: leer('nombre'), cargo: leer('cargo'), emails: leer('emails'),
      rol: leer('rol') || 'SOLICITANTE', empresa_id: leer('empresa_id')
    };
    if (cuentaEnEdicion_) {
      datos.cuenta_id = cuentaEnEdicion_;
    } else {
      datos.usuario = leer('usuario');
    }
    var modulos = modulosSeleccionados_();
    if (modulos.length) {
      datos.modulos = modulos;
    }

    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'gestionarCuentaPortal', datos).then(function (respuesta) {
      if (!respuesta.ok) {
        document.getElementById('resultado-admin').innerHTML = Componentes.alerta(respuesta.message || 'Error al guardar.', 'error');
        return;
      }
      cuentaEnEdicion_ = null;
      cerrarDrawerAdmin_();
      if (respuesta.data.password_temporal) {
        // Aviso propio y SIN auto-cierre: es la unica vez que la clave existe
        // fuera del hash. Trae boton "Copiar" porque antes habia que
        // seleccionarla a mano dentro de un alert del navegador.
        Componentes.aviso({
          tipo: 'exito',
          texto: 'Cuenta "' + respuesta.data.usuario + '" lista.',
          detalle: 'Clave temporal: entregala por WhatsApp o en persona. No queda guardada en ninguna parte.',
          copiar: respuesta.data.password_temporal
        });
      }
      renderCuentasPortal_();
    });
  }

  function accionCuenta_(accion, cuentaId, activar, usuarioActual) {
    if (accion === 'renombrar') {
      Componentes.prompt({
        titulo: 'Renombrar usuario',
        mensaje: 'Usuario actual: ' + usuarioActual + '. Se usa para el login (no afecta el nombre ni los correos).',
        valorInicial: usuarioActual,
        confirmar: 'Renombrar',
        validar: function (valor) {
          if (!/^[a-z0-9._-]{3,30}$/i.test(valor)) return '3-30 caracteres: letras, números, punto o guión.';
          return null;
        }
      }).then(function (nuevoUsuario) {
        if (nuevoUsuario === null || nuevoUsuario === usuarioActual) return;
        aplicarAccionCuenta_({ operacion: 'renombrar', cuenta_id: cuentaId, usuario: nuevoUsuario });
      });
      return;
    }
    if (accion === 'asignar_password') {
      Componentes.prompt({
        titulo: 'Asignar clave a "' + usuarioActual + '"',
        mensaje: 'La persona podrá entrar de inmediato con esta clave (igual se le pedirá confirmarla al ingresar).',
        placeholder: 'Mínimo 8 caracteres',
        confirmar: 'Asignar',
        validar: function (valor) {
          if (valor.length < 8) return 'La clave debe tener al menos 8 caracteres.';
          return null;
        }
      }).then(function (password) {
        if (password === null) return;
        aplicarAccionCuenta_({ operacion: 'asignar_password', cuenta_id: cuentaId, password: password });
      });
      return;
    }
    if (accion === 'eliminar') {
      Componentes.confirmar({
        titulo: 'Eliminar cuenta "' + usuarioActual + '"',
        mensaje: 'Se borra por completo (no solo se desactiva) y se cierra cualquier sesión activa. Esta acción no se puede deshacer.',
        confirmar: 'Eliminar',
        peligro: true
      }).then(function (confirmado) {
        if (!confirmado) return;
        aplicarAccionCuenta_({ operacion: 'eliminar', cuenta_id: cuentaId });
      });
      return;
    }
    var datos = accion === 'resetear'
      ? { operacion: 'resetear_password', cuenta_id: cuentaId }
      : { operacion: 'activar', cuenta_id: cuentaId, activo: activar };
    aplicarAccionCuenta_(datos);
  }

  function aplicarAccionCuenta_(datos) {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'gestionarCuentaPortal', datos).then(function (respuesta) {
      if (!respuesta.ok) {
        Componentes.aviso({ tipo: 'error', texto: respuesta.message || 'No se pudo aplicar.' });
        return;
      }
      if (respuesta.data.password_temporal) {
        Componentes.aviso({
          tipo: 'exito',
          texto: 'Clave temporal nueva para "' + respuesta.data.usuario + '".',
          detalle: 'No queda guardada: copiala ahora y entregasela a la persona.',
          copiar: respuesta.data.password_temporal
        });
      } else if (respuesta.data.password) {
        Componentes.aviso({
          tipo: 'exito',
          texto: 'Clave asignada a "' + respuesta.data.usuario + '".',
          detalle: 'No queda guardada: copiala ahora y entregasela a la persona.',
          copiar: respuesta.data.password
        });
      } else if (respuesta.data.eliminada) {
        Componentes.aviso({ tipo: 'exito', texto: 'Cuenta "' + respuesta.data.usuario + '" eliminada.' });
      } else if (respuesta.data.usuario) {
        Componentes.aviso({ tipo: 'exito', texto: 'Cuenta renombrada a "' + respuesta.data.usuario + '".' });
      }
      renderCuentasPortal_();
    });
  }

  // v4.2 (documentacion/SIGSO-v4.2-propuestas-modulo-jefatura.md §1):
  // relacion jefe -> persona a cargo, por correo -- es lo unico que falta
  // para que el rol JEFATURA sepa a quien acotarse. No hay un catalogo de
  // personas para elegir (las personas a cargo pueden ser solicitantes que
  // nunca tuvieron cuenta): se escribe el correo a mano, igual que
  // "Correo del responsable" en Áreas.
  function renderJefaturas_() {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'listarJefaturas', {}).then(function (respuesta) {
      var contenedor = document.getElementById('admin-contenido');
      if (!respuesta.ok) {
        contenedor.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cargar.', 'error');
        return;
      }
      var relaciones = respuesta.data || [];
      contenedor.innerHTML =
        cabeceraAdmin_('Jefaturas') +
        '<p class="sigso-ayuda">Quién supervisa a quién. La jefatura ve, en "Mi Departamento", ' +
        'solo lo asociado a las personas a cargo (como solicitantes o como responsables) -- nunca el resto del sistema. ' +
        'Una persona puede tener más de un jefe.</p>' +
        Componentes.tarjeta(renderTablaJefaturas_(relaciones));

      document.getElementById('btn-nuevo-admin').addEventListener('click', function () {
        var formulario = '<form id="form-jefatura">' +
          '<div class="sigso-admin-form">' +
          Componentes.campoTexto({ dataCampo: 'jefe_email', label: 'Correo del jefe' }) +
          Componentes.campoTexto({ dataCampo: 'subordinado_email', label: 'Correo de la persona a cargo' }) +
          '</div>' +
          Componentes.boton({ tipo: 'submit', texto: 'Agregar' }) +
          '<div id="resultado-admin"></div>' +
          '</form>';
        abrirDrawerAdmin_('Nueva jefatura', formulario, function () {
          document.getElementById('form-jefatura').addEventListener('submit', function (evento) {
            evento.preventDefault();
            guardarJefatura_();
          });
        });
      });
      document.querySelectorAll('[data-accion-jefatura]').forEach(function (boton) {
        boton.addEventListener('click', function () {
          var accion = boton.getAttribute('data-accion-jefatura');
          var id = boton.getAttribute('data-id');
          if (accion === 'eliminar') {
            Componentes.confirmar({
              titulo: 'Eliminar jefatura',
              mensaje: 'Esta persona dejará de aparecer en "Mi Departamento" de ese jefe. Esta acción no se puede deshacer.',
              confirmar: 'Eliminar',
              peligro: true
            }).then(function (confirmado) {
              if (!confirmado) return;
              aplicarAccionJefatura_({ operacion: 'eliminar', jefatura_id: id });
            });
          } else {
            aplicarAccionJefatura_({ operacion: 'activar', jefatura_id: id, activo: boton.getAttribute('data-activo') === 'true' });
          }
        });
      });
    }).catch(mostrarErrorAdmin_);
  }

  function renderTablaJefaturas_(relaciones) {
    if (relaciones.length === 0) {
      return Componentes.vacio({
        icono: 'persona',
        texto: 'Aún no hay jefaturas registradas.',
        detalle: 'Agrega la primera con "Nuevo".'
      });
    }
    var filas = relaciones.map(function (j) {
      var activo = j.activo === true || j.activo === 'TRUE';
      return '<tr>' +
        '<td>' + Componentes.escaparHtml(j.jefe_email) + '</td>' +
        '<td>' + Componentes.escaparHtml(j.subordinado_email) + '</td>' +
        '<td>' + Componentes.badge(activo ? 'Sí' : 'No', activo ? 'P4' : 'P1') + '</td>' +
        '<td>' +
        '<button type="button" class="sigso-boton--secundario" data-accion-jefatura="activar" data-id="' + j.jefatura_id + '" data-activo="' + !activo + '">' + (activo ? 'Desactivar' : 'Activar') + '</button> ' +
        '<button type="button" class="sigso-boton--peligro" data-accion-jefatura="eliminar" data-id="' + j.jefatura_id + '">Eliminar</button>' +
        '</td></tr>';
    }).join('');
    return '<table class="sigso-tabla"><thead><tr><th>Jefe</th><th>Persona a cargo</th><th>Activa</th><th>Acciones</th></tr></thead><tbody>' + filas + '</tbody></table>';
  }

  function guardarJefatura_() {
    var leer = function (nombre) {
      return document.querySelector('#form-jefatura [data-campo="' + nombre + '"]').value.trim();
    };
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'gestionarJefatura', {
      operacion: 'crear', jefe_email: leer('jefe_email'), subordinado_email: leer('subordinado_email')
    }).then(function (respuesta) {
      if (!respuesta.ok) {
        document.getElementById('resultado-admin').innerHTML = Componentes.alerta(respuesta.message || 'Error al guardar.', 'error');
        return;
      }
      cerrarDrawerAdmin_();
      renderJefaturas_();
    });
  }

  function aplicarAccionJefatura_(datos) {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'gestionarJefatura', datos).then(function (respuesta) {
      if (!respuesta.ok) {
        Componentes.aviso({ tipo: 'error', texto: respuesta.message || 'No se pudo aplicar.' });
        return;
      }
      renderJefaturas_();
    });
  }

  var LOGS_UI = {
    titulo: 'Automatizaciones — logs de notificaciones',
    campos: [
      { nombre: 'timestamp', label: 'Fecha' },
      { nombre: 'solicitud_id', label: 'Solicitud' },
      { nombre: 'evento', label: 'Evento' },
      { nombre: 'destinatario', label: 'Destinatario' },
      { nombre: 'resultado', label: 'Resultado' },
      { nombre: 'reintentos', label: 'Reintentos' }
    ]
  };

  // RF-019 (§12.6 v1.0): vista de logs de automatizaciones. Solo lectura
  // (a diferencia de catalogos/usuarios, no tiene formulario de edicion).
  function renderLogs_() {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'listarLogs', {}).then(function (respuesta) {
      var contenedor = document.getElementById('admin-contenido');
      if (!respuesta.ok) {
        contenedor.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cargar.', 'error');
        return;
      }
      contenedor.innerHTML = '<h2>' + LOGS_UI.titulo + '</h2>' + Componentes.tarjeta(renderTabla_(LOGS_UI.campos, respuesta.data));
    }).catch(mostrarErrorAdmin_);
  }

  function renderFormulario_(campos) {
    return '<form id="form-admin" class="sigso-card">' +
      '<div class="sigso-admin-form">' +
      campos.map(function (campo) {
        if (campo.tipo === 'checkbox') {
          return '<label class="sigso-toggle"><input type="checkbox" data-campo="' + campo.nombre + '" checked> ' + Componentes.escaparHtml(campo.label) + '</label>';
        }
        return Componentes.campoTexto({ dataCampo: campo.nombre, label: campo.label });
      }).join('') +
      '</div>' +
      Componentes.boton({ tipo: 'submit', texto: 'Guardar' }) +
      '<div id="resultado-admin"></div>' +
      '</form>';
  }

  function renderTabla_(campos, filas) {
    var encabezados = campos.map(function (c) { return '<th>' + c.label + '</th>'; }).join('');
    var cuerpo = filas.map(function (fila) {
      var celdas = campos.map(function (c) {
        // "activo" como badge (Si/No) en vez de TRUE/FALSE en crudo -- mas
        // facil de escanear en una tabla larga (Fase 10, rediseno UX).
        if (c.tipo === 'checkbox') {
          var esActivo = fila[c.nombre] === true || fila[c.nombre] === 'TRUE';
          return '<td>' + Componentes.badge(esActivo ? 'Sí' : 'No', esActivo ? 'P4' : 'P1') + '</td>';
        }
        return '<td>' + Componentes.escaparHtml(String(fila[c.nombre])) + '</td>';
      }).join('');
      return '<tr data-editar=\'' + JSON.stringify(fila).replace(/'/g, '&#39;') + '\'>' + celdas + '</tr>';
    }).join('');
    return '<table class="sigso-tabla"><thead><tr>' + encabezados + '</tr></thead><tbody>' + cuerpo + '</tbody></table>';
  }

  function precargarFormulario_(campos, registro) {
    campos.forEach(function (campo) {
      var input = document.querySelector('[data-campo="' + campo.nombre + '"]');
      if (!input) return;
      if (campo.tipo === 'checkbox') {
        input.checked = registro[campo.nombre] === true || registro[campo.nombre] === 'TRUE';
      } else {
        input.value = registro[campo.nombre] || '';
        if (campo.soloAlCrear) input.disabled = true;
      }
    });
  }

  function leerFormulario_(campos) {
    var registro = {};
    campos.forEach(function (campo) {
      var input = document.querySelector('[data-campo="' + campo.nombre + '"]');
      registro[campo.nombre] = campo.tipo === 'checkbox' ? input.checked : input.value;
    });
    return registro;
  }

  function guardarCatalogo_(tipo, campos) {
    var registro = leerFormulario_(campos);
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'guardarCatalogo', { tipo: tipo, registro: registro }).then(function (respuesta) {
      if (respuesta.ok) {
        cerrarDrawerAdmin_();
        renderCatalogo_(tipo);
        return;
      }
      document.getElementById('resultado-admin').innerHTML = Componentes.alerta(respuesta.message || 'Error al guardar.', 'error');
    });
  }

  function guardarUsuario_(campos) {
    var registro = leerFormulario_(campos);
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'gestionarUsuario', registro).then(function (respuesta) {
      if (respuesta.ok) {
        cerrarDrawerAdmin_();
        renderUsuarios_();
        return;
      }
      document.getElementById('resultado-admin').innerHTML = Componentes.alerta(respuesta.message || 'Error al guardar.', 'error');
    });
  }

})();
