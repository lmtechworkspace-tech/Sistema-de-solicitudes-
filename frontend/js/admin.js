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
        } else if (tipo === 'LOGS') {
          renderLogs_();
        } else {
          renderCatalogo_(tipo);
        }
      });
    });
    document.querySelector('.sigso-admin-menu__item').click();
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
