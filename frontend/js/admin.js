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
        var tipo = boton.getAttribute('data-tipo');
        if (tipo === 'USUARIOS') {
          renderUsuarios_();
        } else if (tipo === 'CUENTAS_PORTAL') {
          renderCuentasPortal_();
        } else if (tipo === 'LOGS') {
          renderLogs_();
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
  });

  // Si google.script.run rechaza (o el fetch falla), la promesa se rechaza y
  // sin .catch la vista quedaba EN BLANCO (sintoma "no carga"). Este handler
  // muestra el error real en vez de dejar el panel vacio.
  function mostrarErrorAdmin_(err) {
    var mensaje = (err && err.message) ? err.message : 'No se pudo contactar el servidor. Revisa tu sesion/permiso e intenta de nuevo.';
    document.getElementById('admin-contenido').innerHTML = Componentes.alerta(mensaje, 'error');
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
        '<h2>' + config.titulo + '</h2>' +
        renderFormulario_(config.campos) +
        Componentes.tarjeta(renderTabla_(config.campos, respuesta.data));

      document.getElementById('form-admin').addEventListener('submit', function (evento) {
        evento.preventDefault();
        guardarCatalogo_(tipo, config.campos);
      });
      document.querySelectorAll('[data-editar]').forEach(function (fila) {
        fila.addEventListener('click', function () {
          precargarFormulario_(config.campos, JSON.parse(fila.getAttribute('data-editar')));
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
        '<h2>' + USUARIOS_UI.titulo + '</h2>' +
        renderFormulario_(USUARIOS_UI.campos) +
        Componentes.tarjeta(renderTabla_(USUARIOS_UI.campos, respuesta.data));

      document.getElementById('form-admin').addEventListener('submit', function (evento) {
        evento.preventDefault();
        guardarUsuario_(USUARIOS_UI.campos);
      });
      document.querySelectorAll('[data-editar]').forEach(function (fila) {
        fila.addEventListener('click', function () {
          precargarFormulario_(USUARIOS_UI.campos, JSON.parse(fila.getAttribute('data-editar')));
        });
      });
    }).catch(mostrarErrorAdmin_);
  }

  // v3.3 (plataforma): cuentas del portal. A diferencia de USUARIOS (staff
  // por correo Google), aqui la identidad es usuario+contrasena y una cuenta
  // puede tener VARIOS correos. La clave temporal se muestra UNA sola vez al
  // crear/resetear -- no queda guardada en ninguna parte (solo su hash).
  function renderCuentasPortal_() {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'listarCuentasPortal', {}).then(function (respuesta) {
      var contenedor = document.getElementById('admin-contenido');
      if (!respuesta.ok) {
        contenedor.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cargar.', 'error');
        return;
      }
      var cuentas = respuesta.data.cuentas || [];
      contenedor.innerHTML =
        '<h2>Cuentas de la plataforma</h2>' +
        '<p class="sigso-ayuda">La identidad del portal: cada cuenta es una persona; sus correos son una lista ' +
        '(separados por coma) y el portal le muestra las solicitudes de todos ellos. Los módulos definen qué ve al entrar.</p>' +
        '<form id="form-cuenta-portal" class="sigso-card">' +
        '<div class="sigso-admin-form">' +
        Componentes.campoTexto({ dataCampo: 'usuario', label: 'Usuario (para el login, ej. cpena)' }) +
        Componentes.campoTexto({ dataCampo: 'nombre', label: 'Nombre completo' }) +
        Componentes.campoTexto({ dataCampo: 'cargo', label: 'Cargo (autocompleta el formulario)' }) +
        Componentes.campoTexto({ dataCampo: 'emails', label: 'Correos asociados (separados por coma)' }) +
        Componentes.campoTexto({ dataCampo: 'rol', label: 'Rol: SOLICITANTE / ANA / DEV / GERENCIA / ADM' }) +
        Componentes.campoTexto({ dataCampo: 'modulos', label: 'Módulos (coma; vacío = según rol): nueva_solicitud, mis_solicitudes, bandeja, gerencia, administracion' }) +
        Componentes.campoTexto({ dataCampo: 'empresa_id', label: 'Empresa (código, opcional)' }) +
        '</div>' +
        Componentes.boton({ tipo: 'submit', texto: 'Guardar cuenta' }) +
        '<div id="resultado-admin"></div>' +
        '</form>' +
        Componentes.tarjeta(renderTablaCuentas_(cuentas));

      document.getElementById('form-cuenta-portal').addEventListener('submit', function (evento) {
        evento.preventDefault();
        guardarCuentaPortal_();
      });
      document.querySelectorAll('[data-cuenta]').forEach(function (fila) {
        fila.addEventListener('click', function (e) {
          if (e.target.closest('button')) return; // los botones de accion mandan
          precargarCuenta_(JSON.parse(fila.getAttribute('data-cuenta')));
        });
      });
      document.querySelectorAll('[data-accion-cuenta]').forEach(function (boton) {
        boton.addEventListener('click', function () {
          accionCuenta_(boton.getAttribute('data-accion-cuenta'), boton.getAttribute('data-id'), boton.getAttribute('data-activo') === 'true');
        });
      });
    }).catch(mostrarErrorAdmin_);
  }

  function renderTablaCuentas_(cuentas) {
    if (cuentas.length === 0) {
      return Componentes.vacio('Aún no hay cuentas. Crea la primera con el formulario.');
    }
    var filas = cuentas.map(function (c) {
      return '<tr data-cuenta=\'' + JSON.stringify(c).replace(/'/g, '&#39;') + '\'>' +
        '<td>' + Componentes.escaparHtml(c.usuario) + '</td>' +
        '<td>' + Componentes.escaparHtml(c.nombre) + '</td>' +
        '<td>' + Componentes.escaparHtml((c.emails || []).join(', ')) + '</td>' +
        '<td>' + Componentes.escaparHtml(c.rol) + '</td>' +
        '<td>' + Componentes.escaparHtml((c.modulos || []).join(', ')) + '</td>' +
        '<td>' + Componentes.badge(c.activo ? 'Sí' : 'No', c.activo ? 'P4' : 'P1') + '</td>' +
        '<td>' +
        '<button type="button" class="sigso-boton--secundario" data-accion-cuenta="resetear" data-id="' + c.cuenta_id + '">Resetear clave</button> ' +
        '<button type="button" class="sigso-boton--secundario" data-accion-cuenta="activar" data-id="' + c.cuenta_id + '" data-activo="' + !c.activo + '">' + (c.activo ? 'Desactivar' : 'Activar') + '</button>' +
        '</td></tr>';
    }).join('');
    return '<table class="sigso-tabla"><thead><tr>' +
      '<th>Usuario</th><th>Nombre</th><th>Correos</th><th>Rol</th><th>Módulos</th><th>Activa</th><th>Acciones</th>' +
      '</tr></thead><tbody>' + filas + '</tbody></table>';
  }

  var cuentaEnEdicion_ = null;

  function precargarCuenta_(cuenta) {
    cuentaEnEdicion_ = cuenta.cuenta_id;
    var campos = {
      usuario: cuenta.usuario, nombre: cuenta.nombre, cargo: cuenta.cargo,
      emails: (cuenta.emails || []).join(', '), rol: cuenta.rol,
      modulos: (cuenta.modulos || []).join(', '), empresa_id: cuenta.empresa_id
    };
    Object.keys(campos).forEach(function (nombre) {
      var input = document.querySelector('#form-cuenta-portal [data-campo="' + nombre + '"]');
      if (input) input.value = campos[nombre] || '';
    });
    // El usuario identifica la cuenta: no se renombra (crear otra si hace falta).
    document.querySelector('#form-cuenta-portal [data-campo="usuario"]').disabled = true;
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
    var modulos = leer('modulos');
    if (modulos) {
      datos.modulos = modulos.split(',').map(function (m) { return m.trim(); }).filter(Boolean);
    }

    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'gestionarCuentaPortal', datos).then(function (respuesta) {
      if (!respuesta.ok) {
        document.getElementById('resultado-admin').innerHTML = Componentes.alerta(respuesta.message || 'Error al guardar.', 'error');
        return;
      }
      cuentaEnEdicion_ = null;
      if (respuesta.data.password_temporal) {
        // Se muestra con confirm nativo ANTES de recargar la vista: es la
        // unica vez que la clave existe fuera del hash.
        window.alert('Cuenta "' + respuesta.data.usuario + '" lista.\n\nClave temporal (entregala por WhatsApp o en persona; no queda guardada):\n\n' + respuesta.data.password_temporal);
      }
      renderCuentasPortal_();
    });
  }

  function accionCuenta_(accion, cuentaId, activar) {
    var datos = accion === 'resetear'
      ? { operacion: 'resetear_password', cuenta_id: cuentaId }
      : { operacion: 'activar', cuenta_id: cuentaId, activo: activar };
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'gestionarCuentaPortal', datos).then(function (respuesta) {
      if (!respuesta.ok) {
        window.alert(respuesta.message || 'No se pudo aplicar.');
        return;
      }
      if (respuesta.data.password_temporal) {
        window.alert('Clave temporal nueva para "' + respuesta.data.usuario + '" (no queda guardada):\n\n' + respuesta.data.password_temporal);
      }
      renderCuentasPortal_();
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
        renderUsuarios_();
        return;
      }
      document.getElementById('resultado-admin').innerHTML = Componentes.alerta(respuesta.message || 'Error al guardar.', 'error');
    });
  }

})();
