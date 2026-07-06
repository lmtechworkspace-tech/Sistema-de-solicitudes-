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
        // Jerarquia real de hasta 3 niveles (modulo principal > submodulo >
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
      { nombre: 'rol', label: 'Rol (ANA/DEV/ADM)' },
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

  function renderCatalogo_(tipo) {
    var config = CATALOGOS_UI[tipo];
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'listarCatalogo', { tipo: tipo }).then(function (respuesta) {
      var contenedor = document.getElementById('admin-contenido');
      if (!respuesta.ok) {
        contenedor.innerHTML = '<div class="sigso-resultado-error"><p>' + escaparHtml_(respuesta.message || 'No se pudo cargar.') + '</p></div>';
        return;
      }
      contenedor.innerHTML =
        '<h2>' + config.titulo + '</h2>' +
        renderFormulario_(config.campos) +
        renderTabla_(config.campos, respuesta.data);

      document.getElementById('form-admin').addEventListener('submit', function (evento) {
        evento.preventDefault();
        guardarCatalogo_(tipo, config.campos);
      });
      document.querySelectorAll('[data-editar]').forEach(function (fila) {
        fila.addEventListener('click', function () {
          precargarFormulario_(config.campos, JSON.parse(fila.getAttribute('data-editar')));
        });
      });
    });
  }

  function renderUsuarios_() {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'listarUsuarios', {}).then(function (respuesta) {
      var contenedor = document.getElementById('admin-contenido');
      if (!respuesta.ok) {
        contenedor.innerHTML = '<div class="sigso-resultado-error"><p>' + escaparHtml_(respuesta.message || 'No se pudo cargar.') + '</p></div>';
        return;
      }
      contenedor.innerHTML =
        '<h2>' + USUARIOS_UI.titulo + '</h2>' +
        renderFormulario_(USUARIOS_UI.campos) +
        renderTabla_(USUARIOS_UI.campos, respuesta.data);

      document.getElementById('form-admin').addEventListener('submit', function (evento) {
        evento.preventDefault();
        guardarUsuario_(USUARIOS_UI.campos);
      });
      document.querySelectorAll('[data-editar]').forEach(function (fila) {
        fila.addEventListener('click', function () {
          precargarFormulario_(USUARIOS_UI.campos, JSON.parse(fila.getAttribute('data-editar')));
        });
      });
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
        contenedor.innerHTML = '<div class="sigso-resultado-error"><p>' + escaparHtml_(respuesta.message || 'No se pudo cargar.') + '</p></div>';
        return;
      }
      contenedor.innerHTML = '<h2>' + LOGS_UI.titulo + '</h2>' + renderTabla_(LOGS_UI.campos, respuesta.data);
    });
  }

  function renderFormulario_(campos) {
    return '<form id="form-admin" class="sigso-card">' +
      '<div class="sigso-admin-form">' +
      campos.map(function (campo) {
        if (campo.tipo === 'checkbox') {
          return '<label class="sigso-toggle"><input type="checkbox" data-campo="' + campo.nombre + '" checked> ' + campo.label + '</label>';
        }
        return '<div class="sigso-campo"><label>' + campo.label + '</label><input type="text" data-campo="' + campo.nombre + '"></div>';
      }).join('') +
      '</div>' +
      '<button type="submit" class="sigso-boton">Guardar</button>' +
      '<span id="resultado-admin"></span>' +
      '</form>';
  }

  function renderTabla_(campos, filas) {
    var encabezados = campos.map(function (c) { return '<th>' + c.label + '</th>'; }).join('');
    var cuerpo = filas.map(function (fila) {
      var celdas = campos.map(function (c) { return '<td>' + escaparHtml_(String(fila[c.nombre])) + '</td>'; }).join('');
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
      document.getElementById('resultado-admin').textContent = respuesta.ok ? 'Guardado.' : (respuesta.message || 'Error al guardar.');
      if (respuesta.ok) renderCatalogo_(tipo);
    });
  }

  function guardarUsuario_(campos) {
    var registro = leerFormulario_(campos);
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'gestionarUsuario', registro).then(function (respuesta) {
      document.getElementById('resultado-admin').textContent = respuesta.ok ? 'Guardado.' : (respuesta.message || 'Error al guardar.');
      if (respuesta.ok) renderUsuarios_();
    });
  }

  function escaparHtml_(texto) {
    var div = document.createElement('div');
    div.textContent = texto || '';
    return div.innerHTML;
  }
})();
