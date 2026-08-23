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

  // ==========================================================================
  // v12.1 — Arquitectura del módulo Administración (navegacion.js)
  //
  // Antes: 14 botones planos en una columna, sin agrupar. Ya era vertical (fue
  // el único módulo que nació así), pero una lista de 14 sin jerarquía obliga
  // a leerla entera para encontrar algo.
  //
  // El agrupamiento NO inventa pantallas: los 14 ítems son los mismos 14
  // `data-tipo` que ya existían, con el mismo comportamiento. Lo único que
  // cambia es cómo se ordenan.
  //
  // Los ids son los `data-tipo` de siempre, así que el resto de admin.js
  // (renderCatalogo_, renderUsuarios_, ...) no se entera del cambio.
  var ARQUITECTURA_ADMIN = [
    { id: 'organizacion', nombre: 'Organización', icono: 'empresa', items: [
      { id: 'EMPRESA', nombre: 'Empresas' },
      { id: 'PLATAFORMA', nombre: 'Plataformas' },
      { id: 'AREA', nombre: 'Áreas / responsables' },
      { id: 'JEFATURAS', nombre: 'Jefaturas' }
    ] },
    { id: 'catalogos', nombre: 'Catálogos', icono: 'lista', items: [
      { id: 'MODULO', nombre: 'Módulos' },
      { id: 'TIPO', nombre: 'Tipos de solicitud' }
    ] },
    { id: 'accesos', nombre: 'Accesos', icono: 'llave', items: [
      { id: 'USUARIOS', nombre: 'Usuarios' },
      { id: 'CUENTAS_PORTAL', nombre: 'Cuentas plataforma' }
    ] },
    { id: 'comunicaciones', nombre: 'Comunicaciones', icono: 'campana', items: [
      { id: 'NOTIFICACION', nombre: 'Notificaciones' },
      { id: 'NOTIF_PERMISOS', nombre: 'Alertas en vivo' },
      { id: 'CANALES_ALERTA', nombre: 'Canales de alerta' },
      { id: 'ENVIAR_ALERTA', nombre: 'Enviar alerta' }
    ] },
    { id: 'operacion', nombre: 'Operación', icono: 'reloj', items: [
      { id: 'PAUSAS', nombre: 'Pausas activas' }
    ] },
    // Submódulo transversal. NO se inventa contenido: "Automatizaciones" ya
    // era un reporte (el historial de ejecuciones de los triggers), sólo que
    // estaba suelto entre los catálogos. Aquí queda donde corresponde.
    // v12.2: Reportes deja de ser un atajo a Automatizaciones y pasa a ser
    // el centro de reportes del modulo, sobre el motor compartido.
    { id: 'reportes', nombre: 'Reportes', icono: 'grafico', plano: true,
      descripcion: 'Entregabilidad, salud del sistema y accesos', items: [
      { id: 'REPORTES', nombre: 'Centro de reportes' }
    ] }
  ];

  window.SigsoAdmin = {
    abrir: function () {
      // v12.1: si la URL pedia una seccion (#/administracion/USUARIOS) se abre
      // esa; si no, la primera de la arquitectura. Se valida que exista: una
      // URL escrita a mano no puede inventar una seccion.
      var pedida = (window.SigsoShell && SigsoShell.tomarItemDeRuta)
        ? SigsoShell.tomarItemDeRuta() : '';
      irASeccionAdmin_(existeSeccionAdmin_(pedida) ? pedida : ARQUITECTURA_ADMIN[0].items[0].id);
    },
    // v13.0: el arbol del sidebar entra por aca.
    irAItem: function (itemId) { irASeccionAdmin_(itemId); }
  };

  var seccionAdminActiva_ = '';

  function existeSeccionAdmin_(id) {
    if (!id) return false;
    return ARQUITECTURA_ADMIN.some(function (sub) {
      return sub.items.some(function (it) { return it.id === id; });
    });
  }

  // v13.0: la navegacion vive en el sidebar. Aca solo se registra el arbol
  // y se pide que se repinte.
  function pintarNavAdmin_() {
    if (!window.SigsoNav) return;
    SigsoNav.registrar('administracion', {
      nombre: 'Administración',
      submodulos: ARQUITECTURA_ADMIN
    });
    if (window.SigsoShell && SigsoShell.refrescarArbol) SigsoShell.refrescarArbol();
  }

  function irASeccionAdmin_(tipo) {
    seccionAdminActiva_ = tipo;
    // Salir de Reportes cierra el reporte abierto: volver a entrar debe
    // mostrar el catalogo, no el ultimo reporte que se miro.
    if (tipo !== 'REPORTES') reporteAdminAbierto_ = null;
    pintarNavAdmin_();
    cerrarDrawerAdmin_();
    if (window.SigsoShell && SigsoShell.publicarItem) SigsoShell.publicarItem(tipo);
    if (tipo === 'USUARIOS') renderUsuarios_();
    else if (tipo === 'CUENTAS_PORTAL') renderCuentasPortal_();
    else if (tipo === 'REPORTES') renderReportes_();
    else if (tipo === 'LOGS') renderLogs_();
    else if (tipo === 'JEFATURAS') renderJefaturas_();
    else if (tipo === 'PAUSAS') renderPausas_();
    else if (tipo === 'NOTIF_PERMISOS') renderPermisosNotif_();
    else if (tipo === 'CANALES_ALERTA') renderCanalesAlerta_();
    else if (tipo === 'ENVIAR_ALERTA') renderEnviarAlerta_();
    else renderCatalogo_(tipo);
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof renderHeaderSigso === 'function') {
      renderHeaderSigso('admin');
    }
    // v6.4: identidad + "Mi perfil" en el header, igual que en app.html.
    if (window.SigsoPerfil) {
      SigsoPerfil.montarHeaderUsuario();
    }
    // v12.1: el menu de 14 botones planos lo reemplaza la navegacion vertical
    // agrupada (SigsoNav). El cableado ya no vive aca: lo hace onSeleccion.
    pintarNavAdmin_();
    // #vista-shell solo existe en plataforma.html: ahi el arranque lo hace
    // SigsoAdmin.abrir() al entrar al modulo.
    if (!document.getElementById('vista-shell')) {
      window.SigsoAdmin.abrir();
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
    // v6.0: prevencionista (Amarlla, Camila, reemplazo) -- opera pausas y ve
    // reportes. La plantilla de modulos incluye pausas + pausas_coordinacion.
    { valor: 'COORDINADOR', texto: 'Coordinadora de pausas' },
    { valor: 'ADM', texto: 'Administrador' }
  ];
  var MODULOS_PORTAL = [
    { valor: 'nueva_solicitud', texto: 'Nueva solicitud' },
    { valor: 'mis_solicitudes', texto: 'Mis solicitudes' },
    { valor: 'bandeja', texto: 'Bandeja de trabajo' },
    // v7.0 (Fase 2, Gestion Operacional): "Mi trabajo" -- compromisos con
    // check-in de un clic. Se agrega a la plantilla de TODOS los roles
    // nuevos (CuentasPortal.gs), pero las cuentas ya existentes necesitan
    // que el Admin lo marque aca a mano.
    { valor: 'mi_trabajo', texto: 'Mi trabajo' },
    // v9.0 (Modulo de Proyectos): mismo caso que 'mi_trabajo' -- se agrega
    // a la plantilla de cuentas nuevas, pero las ya existentes necesitan
    // que el Admin lo marque aca a mano.
    { valor: 'proyectos', texto: 'Proyectos' },
    { valor: 'gerencia', texto: 'Panel de gerencia' },
    { valor: 'jefatura', texto: 'Mi departamento (Jefatura)' },
    { valor: 'administracion', texto: 'Administración' },
    // v6.0 (modulo Pausas Activas): 'pausas' = registrar participacion (todo
    // el personal); 'pausas_coordinacion' = operar + reportes (coordinadoras).
    { valor: 'pausas', texto: 'Pausas activas (registro)' },
    { valor: 'pausas_coordinacion', texto: 'Coordinación de pausas' },
    // v10.0 (Modulo SGC ISO 9001): mismo caso que 'mi_trabajo'/'proyectos'
    // -- esta lista es la que dibuja los botones de "Modulos" al editar una
    // cuenta, y es INDEPENDIENTE de MODULOS_SHELL (plataforma.js) y de
    // MODULOS_VALIDOS (CuentasPortal.gs). Si un modulo nuevo no se agrega
    // aca, el Admin no tiene como activarlo y por lo tanto nadie lo ve en
    // el menu, aunque el resto del sistema ya lo soporte.
    { valor: 'calidad', texto: 'Calidad (SGC ISO 9001)' }
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
  //
  // v6.4: inicialesCuenta_ se elimino; el avatar lo pinta ahora
  // Componentes.avatar, que ademas muestra la foto de perfil si la cuenta
  // tiene una. Es la misma funcion que usa el header y los comentarios.

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
        '<span class="sigso-cuenta-fila__avatar">' +
          Componentes.avatar(
            { nombre: c.nombre, foto: window.SigsoPerfil ? SigsoPerfil.fotoDe((c.emails || [])[0]) : '' },
            { tam: 'md' }
          ) + '</span>' +
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
        // v5.2 (Fase C, propuesta de adopcion): enlace sin password -- para
        // la persona reacia (Leo/Gerencia) que no va a loguearse por su
        // cuenta. Entra directo a lo que sus modulos ya permiten ver.
        '<button type="button" class="sigso-boton--secundario" data-accion-cuenta="enlace_magico" data-id="' + c.cuenta_id + '" data-usuario="' + Componentes.escaparHtml(c.usuario) + '">🔗 Enlace mágico</button> ' +
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
    if (accion === 'enlace_magico') {
      aplicarAccionCuenta_({ operacion: 'generar_enlace', cuenta_id: cuentaId });
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
      } else if (respuesta.data.token) {
        // v5.2 (Fase C): entra directo, sin password -- valido 30 dias.
        var sitio = (window.SIGSO_CONFIG && window.SIGSO_CONFIG.SITIO_PUBLICO) || '';
        var url = sitio + 'plataforma.html?token=' + respuesta.data.token;
        Componentes.aviso({
          tipo: 'exito',
          texto: 'Enlace mágico para "' + respuesta.data.usuario + '".',
          detalle: 'Vale por 30 días, sin clave. Mándaselo por WhatsApp o correo.',
          copiar: url
        });
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

  // v6.0 (modulo Pausas Activas, Fase P0): la configuracion administrable por
  // el ADM -- lo que el usuario pidio que fuera editable "sin afectar el
  // sistema principal": parametros por empresa, coordinadoras (Amarlla/Camila
  // titulares + reemplazos) y el roster de trabajadores. Una sola seccion con
  // tres sub-pestanas para no saturar el menu lateral. Todo aditivo: escribe
  // solo en las hojas PAUSAS_*.
  var pausasSubtab = 'config';
  var pausasEmpresas = [];

  function renderPausas_() {
    // Trae las empresas UNA vez (para los selectores de las tres sub-pestanas)
    // y luego pinta la sub-pestana activa sin volver a pedirlas.
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'listarCatalogo', { tipo: 'EMPRESA' }).then(function (respuesta) {
      pausasEmpresas = (respuesta.ok && Array.isArray(respuesta.data))
        ? respuesta.data.filter(function (e) { return e.activo === true || e.activo === 'TRUE'; })
        : [];
      pintarPausas_();
    }).catch(mostrarErrorAdmin_);
  }

  function opcionesEmpresasPausas_() {
    return pausasEmpresas.map(function (e) { return { valor: e.empresa_id, texto: e.nombre || e.empresa_id }; });
  }

  function nombreEmpresaPausas_(empresaId) {
    var e = pausasEmpresas.filter(function (x) { return String(x.empresa_id) === String(empresaId); })[0];
    return e ? (e.nombre || e.empresa_id) : empresaId;
  }

  function pintarPausas_() {
    var SUBTABS = [
      { id: 'config', texto: 'Configuración' },
      { id: 'coordinadores', texto: 'Coordinadoras' },
      { id: 'roster', texto: 'Trabajadores' },
      { id: 'programadas', texto: 'Programadas' }
    ];
    var subnav = '<div class="sigso-tabs" id="pausas-subtabs">' + SUBTABS.map(function (t) {
      var activa = t.id === pausasSubtab ? ' sigso-tabs__boton--activo' : '';
      return '<button type="button" class="sigso-tabs__boton' + activa + '" data-pausas-sub="' + t.id + '">' + t.texto + '</button>';
    }).join('') + '</div>';

    document.getElementById('admin-contenido').innerHTML =
      '<div class="sigso-admin-cab"><h2>Pausas activas</h2></div>' +
      '<p class="sigso-ayuda">Configuración del módulo de pausas activas. Es <strong>independiente</strong> del ' +
      'sistema de solicitudes: cambiar horas, días o coordinadoras no afecta el resto de SIGSO.</p>' +
      subnav + '<div id="pausas-sub-contenido"></div>';

    document.querySelectorAll('[data-pausas-sub]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        pausasSubtab = boton.getAttribute('data-pausas-sub');
        pintarPausas_();
      });
    });

    if (pausasSubtab === 'config') renderPausasConfig_();
    else if (pausasSubtab === 'coordinadores') renderPausasCoordinadores_();
    else if (pausasSubtab === 'roster') renderPausasRoster_();
    else renderPausasProgramadas_();
  }

  // --- sub-pestana: parametros por empresa (upsert) -------------------------
  function renderPausasConfig_() {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'listarPausasConfig', {}).then(function (respuesta) {
      var cont = document.getElementById('pausas-sub-contenido');
      if (!respuesta.ok) {
        cont.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cargar.', 'error');
        return;
      }
      var filas = respuesta.data || [];
      cont.innerHTML =
        '<div class="sigso-admin-cab"><h3>Parámetros por empresa</h3>' +
        '<span>' +
        '<button type="button" class="sigso-boton sigso-boton--secundario" id="btn-qr-pausas">' +
        Iconos.svg('reloj', { tam: 16 }) + ' QR de registro</button> ' +
        '<button type="button" class="sigso-boton sigso-admin-cab__boton" id="btn-nueva-config-pausas">' +
        Iconos.svg('nueva', { tam: 16 }) + ' Nueva / editar</button>' +
        '</span></div>' +
        Componentes.tarjeta(tablaPausasConfig_(filas));

      document.getElementById('btn-nueva-config-pausas').addEventListener('click', function () {
        abrirFormPausasConfig_(null);
      });
      document.getElementById('btn-qr-pausas').addEventListener('click', abrirQrRegistroPausas_);
      document.querySelectorAll('[data-editar-config-pausas]').forEach(function (fila) {
        fila.addEventListener('click', function () {
          abrirFormPausasConfig_(JSON.parse(fila.getAttribute('data-editar-config-pausas')));
        });
      });
    }).catch(mostrarErrorAdmin_);
  }

  function tablaPausasConfig_(filas) {
    if (filas.length === 0) {
      return Componentes.vacio({ icono: 'reloj', texto: 'Aún no hay empresas configuradas.', detalle: 'Agrega la primera con "Nueva / editar".' });
    }
    var cuerpo = filas.map(function (c) {
      var activo = c.activo === true || c.activo === 'TRUE';
      return '<tr data-editar-config-pausas=\'' + JSON.stringify(c).replace(/'/g, '&#39;') + '\'>' +
        '<td>' + Componentes.escaparHtml(nombreEmpresaPausas_(c.empresa_id)) + '</td>' +
        '<td>' + Componentes.escaparHtml(String(c.hora_habitual || '—')) + '</td>' +
        '<td>' + Componentes.escaparHtml(diasLegiblesPausas_(c.dias_semana)) + '</td>' +
        '<td>' + Componentes.escaparHtml(String(c.duracion_min || '—')) + ' min</td>' +
        '<td>' + Componentes.escaparHtml(String(c.umbral_verde || '—')) + '% / ' + Componentes.escaparHtml(String(c.umbral_amarillo || '—')) + '%</td>' +
        '<td>' + Componentes.badge(activo ? 'Sí' : 'No', activo ? 'P4' : 'P1') + '</td>' +
        '</tr>';
    }).join('');
    return '<table class="sigso-tabla"><thead><tr><th>Empresa</th><th>Hora</th><th>Días</th><th>Duración</th><th>Umbral 🟢/🟡</th><th>Activa</th></tr></thead><tbody>' + cuerpo + '</tbody></table>';
  }

  // v6.0 (mejora #9): QR de registro presencial. Apunta SOLO al login de la
  // plataforma (sin token) -- seguro para imprimir y pegar junto al lugar de
  // la pausa: cada trabajador escanea, entra con SU cuenta/clave, y como el
  // enlace trae "?modulo=pausas" llega directo a su modulo sin pasar por
  // Home (ver plataforma.js: moduloObjetivoEnlace_ se lee ANTES del login,
  // no solo en el flujo de enlace magico). Un solo QR sirve para todas las
  // empresas -- no hay nada personal ni con vencimiento en el enlace.
  // La imagen la genera un servicio publico (api.qrserver.com, GET simple,
  // sin API key) -- evita sumar una libreria de terceros solo para esto.
  function abrirQrRegistroPausas_() {
    var sitio = (window.SIGSO_CONFIG && window.SIGSO_CONFIG.SITIO_PUBLICO) || '';
    var separador = sitio && sitio.slice(-1) !== '/' ? '/' : '';
    var url = sitio + separador + 'plataforma.html?modulo=pausas';
    var imgUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=' + encodeURIComponent(url);
    abrirDrawerAdmin_('QR de registro de pausas',
      '<p class="sigso-ayuda">Imprime y pega este QR junto al lugar donde se hace la pausa activa. ' +
      'Cada trabajador lo escanea con su celular, entra con su propia cuenta y llega directo al módulo de registro. ' +
      'No tiene clave ni sesión propia: es seguro dejarlo a la vista.</p>' +
      '<div style="text-align:center;margin:16px 0;">' +
      '<img src="' + Componentes.escaparHtml(imgUrl) + '" alt="QR de registro de pausas" width="260" height="260">' +
      '</div>' +
      '<p class="sigso-ayuda" style="word-break:break-all;">' + Componentes.escaparHtml(url) + '</p>');
  }

  var DIAS_PAUSAS = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 7: 'Dom' };
  function diasLegiblesPausas_(csv) {
    if (!csv) return '—';
    return String(csv).split(',').map(function (d) { return DIAS_PAUSAS[d.trim()] || d; }).join(' ');
  }

  function abrirFormPausasConfig_(registro) {
    registro = registro || {};
    var esEdicion = !!registro.empresa_id;
    var form = '<form id="form-pausas-config"><div class="sigso-admin-form">' +
      Componentes.campoSelect({ dataCampo: 'empresa_id', label: 'Empresa', valor: registro.empresa_id || '', opciones: opcionesEmpresasPausas_() }) +
      Componentes.campoTexto({ dataCampo: 'hora_habitual', label: 'Hora habitual (HH:mm)', valor: registro.hora_habitual || '', placeholder: '09:30' }) +
      Componentes.campoTexto({ dataCampo: 'dias_semana', label: 'Días (1=Lun … 7=Dom, separados por coma)', valor: registro.dias_semana || '', placeholder: '1,2,3,4,5', ayuda: 'Ej: 1,2,3,4,5 para lunes a viernes.' }) +
      Componentes.campoTexto({ dataCampo: 'duracion_min', tipo: 'number', label: 'Duración (minutos)', valor: registro.duracion_min || '' }) +
      Componentes.campoTexto({ dataCampo: 'min_anticipacion', tipo: 'number', label: 'Anticipación del recordatorio (minutos)', valor: registro.min_anticipacion || '' }) +
      Componentes.campoTexto({ dataCampo: 'umbral_verde', tipo: 'number', label: 'Umbral verde (% participación)', valor: registro.umbral_verde || '' }) +
      Componentes.campoTexto({ dataCampo: 'umbral_amarillo', tipo: 'number', label: 'Umbral amarillo (% participación)', valor: registro.umbral_amarillo || '' }) +
      '<label class="sigso-toggle"><input type="checkbox" data-campo="activo"' + (registro.activo === false || registro.activo === 'FALSE' ? '' : ' checked') + '> Activa</label>' +
      '</div>' + Componentes.boton({ tipo: 'submit', texto: 'Guardar' }) + '<div id="resultado-admin"></div></form>';

    abrirDrawerAdmin_(esEdicion ? 'Editar configuración' : 'Configurar empresa', form, function () {
      document.getElementById('form-pausas-config').addEventListener('submit', function (evento) {
        evento.preventDefault();
        guardarPausasConfig_();
      });
    });
  }

  function guardarPausasConfig_() {
    var leer = function (nombre) {
      var el = document.querySelector('#form-pausas-config [data-campo="' + nombre + '"]');
      return el ? el.value.trim() : '';
    };
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'guardarPausasConfig', {
      empresa_id: leer('empresa_id'),
      hora_habitual: leer('hora_habitual'),
      dias_semana: leer('dias_semana'),
      duracion_min: leer('duracion_min'),
      min_anticipacion: leer('min_anticipacion'),
      umbral_verde: leer('umbral_verde'),
      umbral_amarillo: leer('umbral_amarillo'),
      activo: document.querySelector('#form-pausas-config [data-campo="activo"]').checked
    }).then(function (respuesta) {
      if (!respuesta.ok) {
        document.getElementById('resultado-admin').innerHTML = Componentes.alerta(respuesta.message || 'Error al guardar.', 'error');
        return;
      }
      cerrarDrawerAdmin_();
      renderPausasConfig_();
    });
  }

  // --- sub-pestana: coordinadoras (titulares / reemplazos) ------------------
  function renderPausasCoordinadores_() {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'listarPausasCoordinadores', {}).then(function (respuesta) {
      var cont = document.getElementById('pausas-sub-contenido');
      if (!respuesta.ok) {
        cont.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cargar.', 'error');
        return;
      }
      var filas = respuesta.data || [];
      cont.innerHTML =
        '<div class="sigso-admin-cab"><h3>Coordinadoras (prevencionistas)</h3>' +
        '<button type="button" class="sigso-boton sigso-admin-cab__boton" id="btn-nueva-coord-pausas">' +
        Iconos.svg('nueva', { tam: 16 }) + ' Nueva</button></div>' +
        '<p class="sigso-ayuda">Titulares (Amarlla, Camila) y sus reemplazos, por empresa. Los reemplazos cubren cuando ninguna titular puede.</p>' +
        Componentes.tarjeta(tablaPausasCoordinadores_(filas));

      document.getElementById('btn-nueva-coord-pausas').addEventListener('click', abrirFormPausasCoordinador_);
      wireAccionesPausas_('coord', 'gestionarPausasCoordinador', 'coord_id', renderPausasCoordinadores_, 'coordinadora');
    }).catch(mostrarErrorAdmin_);
  }

  function tablaPausasCoordinadores_(filas) {
    if (filas.length === 0) {
      return Componentes.vacio({ icono: 'persona', texto: 'Aún no hay coordinadoras registradas.', detalle: 'Agrega la primera con "Nueva".' });
    }
    var cuerpo = filas.map(function (c) {
      var activo = c.activo === true || c.activo === 'TRUE';
      return '<tr>' +
        '<td>' + Componentes.escaparHtml(c.nombre) + '</td>' +
        '<td>' + Componentes.escaparHtml(c.email) + '</td>' +
        '<td>' + Componentes.badge(c.tipo === 'reemplazo' ? 'Reemplazo' : 'Titular', c.tipo === 'reemplazo' ? 'P3' : 'P1') + '</td>' +
        '<td>' + Componentes.escaparHtml(nombreEmpresaPausas_(c.empresa_id)) + '</td>' +
        '<td>' + Componentes.badge(activo ? 'Sí' : 'No', activo ? 'P4' : 'P1') + '</td>' +
        '<td>' + botonesAccionPausas_('coord', c.coord_id, activo) + '</td>' +
        '</tr>';
    }).join('');
    return '<table class="sigso-tabla"><thead><tr><th>Nombre</th><th>Correo</th><th>Tipo</th><th>Empresa</th><th>Activa</th><th>Acciones</th></tr></thead><tbody>' + cuerpo + '</tbody></table>';
  }

  function abrirFormPausasCoordinador_() {
    var form = '<form id="form-pausas-coord"><div class="sigso-admin-form">' +
      Componentes.campoSelect({ dataCampo: 'empresa_id', label: 'Empresa', opciones: opcionesEmpresasPausas_() }) +
      Componentes.campoTexto({ dataCampo: 'nombre', label: 'Nombre' }) +
      Componentes.campoTexto({ dataCampo: 'email', label: 'Correo' }) +
      Componentes.campoSelect({ dataCampo: 'tipo', label: 'Tipo', valor: 'titular', placeholder: false, opciones: [{ valor: 'titular', texto: 'Titular' }, { valor: 'reemplazo', texto: 'Reemplazo' }] }) +
      '</div>' + Componentes.boton({ tipo: 'submit', texto: 'Agregar' }) + '<div id="resultado-admin"></div></form>';
    abrirDrawerAdmin_('Nueva coordinadora', form, function () {
      document.getElementById('form-pausas-coord').addEventListener('submit', function (evento) {
        evento.preventDefault();
        var leer = function (n) { return document.querySelector('#form-pausas-coord [data-campo="' + n + '"]').value.trim(); };
        guardarGestionPausas_('gestionarPausasCoordinador', {
          operacion: 'crear', empresa_id: leer('empresa_id'), nombre: leer('nombre'), email: leer('email'), tipo: leer('tipo')
        }, renderPausasCoordinadores_);
      });
    });
  }

  // --- sub-pestana: roster de trabajadores ----------------------------------
  function renderPausasRoster_() {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'listarPausasTrabajadores', {}).then(function (respuesta) {
      var cont = document.getElementById('pausas-sub-contenido');
      if (!respuesta.ok) {
        cont.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cargar.', 'error');
        return;
      }
      var filas = respuesta.data || [];
      cont.innerHTML =
        '<div class="sigso-admin-cab"><h3>Roster de trabajadores</h3>' +
        '<span>' +
        '<button type="button" class="sigso-boton sigso-boton--secundario" id="btn-sembrar-roster-pausas">' +
        Iconos.svg('reloj', { tam: 16 }) + ' Sembrar desde cuentas</button> ' +
        '<button type="button" class="sigso-boton sigso-boton--secundario" id="btn-modulo-masivo-pausas">' +
        Iconos.svg('reloj', { tam: 16 }) + ' Dar módulo a todos</button> ' +
        '<button type="button" class="sigso-boton sigso-admin-cab__boton" id="btn-nuevo-trab-pausas">' +
        Iconos.svg('nueva', { tam: 16 }) + ' Nuevo</button>' +
        '</span></div>' +
        '<p class="sigso-ayuda">Quiénes participan de las pausas, con su área y cargo (para los reportes por área). ' +
        '"Sembrar desde cuentas" carga el roster de una empresa desde las cuentas de la plataforma que ya existen ' +
        '(no crea cuentas nuevas). "Dar módulo a todos" agrega el acceso a "Pausas activas" a la cuenta de cada ' +
        'trabajador del roster que ya tenga cuenta.</p>' +
        Componentes.tarjeta(tablaPausasRoster_(filas));

      document.getElementById('btn-nuevo-trab-pausas').addEventListener('click', abrirFormPausasTrabajador_);
      document.getElementById('btn-sembrar-roster-pausas').addEventListener('click', function () {
        abrirFormAccionMasivaPausas_('Sembrar roster desde cuentas', 'Sembrar', function (empresaId) {
          llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'sembrarRosterPausas', { empresa_id: empresaId }).then(function (r) {
            if (!r.ok) { Componentes.aviso({ tipo: 'error', texto: r.message || 'No se pudo sembrar el roster.' }); return; }
            cerrarDrawerAdmin_();
            Componentes.aviso({ tipo: 'exito', texto: r.data.creados + ' trabajador(es) nuevo(s) en el roster.' });
            renderPausasRoster_();
          });
        });
      });
      document.getElementById('btn-modulo-masivo-pausas').addEventListener('click', function () {
        abrirFormAccionMasivaPausas_('Dar módulo "Pausas activas" a todo el roster', 'Asignar', function (empresaId) {
          llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'asignarModuloPausasRoster', { empresa_id: empresaId }).then(function (r) {
            if (!r.ok) { Componentes.aviso({ tipo: 'error', texto: r.message || 'No se pudo asignar el módulo.' }); return; }
            cerrarDrawerAdmin_();
            var extra = (r.data.sin_cuenta && r.data.sin_cuenta.length)
              ? ' ' + r.data.sin_cuenta.length + ' del roster no tienen cuenta todavía (créala primero en "Cuentas plataforma").'
              : '';
            Componentes.aviso({ tipo: 'exito', texto: r.data.cuentas_actualizadas + ' cuenta(s) actualizada(s).' + extra });
          });
        });
      });
      wireAccionesPausas_('trab', 'gestionarPausasTrabajador', 'trabajador_id', renderPausasRoster_, 'trabajador');
    }).catch(mostrarErrorAdmin_);
  }

  // Mini-drawer compartido por las dos acciones masivas del roster: elegir la
  // empresa y confirmar. `onConfirmar(empresaId)` hace la llamada real.
  function abrirFormAccionMasivaPausas_(titulo, textoBoton, onConfirmar) {
    var form = '<form id="form-pausas-masivo"><div class="sigso-admin-form">' +
      Componentes.campoSelect({ dataCampo: 'empresa_id', label: 'Empresa', opciones: opcionesEmpresasPausas_() }) +
      '</div>' + Componentes.boton({ tipo: 'submit', texto: textoBoton }) + '<div id="resultado-admin"></div></form>';
    abrirDrawerAdmin_(titulo, form, function () {
      document.getElementById('form-pausas-masivo').addEventListener('submit', function (evento) {
        evento.preventDefault();
        var empresaId = document.querySelector('#form-pausas-masivo [data-campo="empresa_id"]').value.trim();
        if (!empresaId) {
          document.getElementById('resultado-admin').innerHTML = Componentes.alerta('Elige una empresa.', 'error');
          return;
        }
        onConfirmar(empresaId);
      });
    });
  }

  function tablaPausasRoster_(filas) {
    if (filas.length === 0) {
      return Componentes.vacio({ icono: 'persona', texto: 'Aún no hay trabajadores en el roster.', detalle: 'Agrega el primero con "Nuevo".' });
    }
    var cuerpo = filas.map(function (t) {
      var activo = t.activo === true || t.activo === 'TRUE';
      return '<tr>' +
        '<td>' + Componentes.escaparHtml(t.nombre) + '</td>' +
        '<td>' + Componentes.escaparHtml(t.email) + '</td>' +
        '<td>' + Componentes.escaparHtml(t.area || '—') + '</td>' +
        '<td>' + Componentes.escaparHtml(t.cargo || '—') + '</td>' +
        '<td>' + Componentes.escaparHtml(nombreEmpresaPausas_(t.empresa_id)) + '</td>' +
        '<td>' + Componentes.badge(activo ? 'Sí' : 'No', activo ? 'P4' : 'P1') + '</td>' +
        '<td>' + botonesAccionPausas_('trab', t.trabajador_id, activo) + '</td>' +
        '</tr>';
    }).join('');
    return '<table class="sigso-tabla"><thead><tr><th>Nombre</th><th>Correo</th><th>Área</th><th>Cargo</th><th>Empresa</th><th>Activo</th><th>Acciones</th></tr></thead><tbody>' + cuerpo + '</tbody></table>';
  }

  function abrirFormPausasTrabajador_() {
    var form = '<form id="form-pausas-trab"><div class="sigso-admin-form">' +
      Componentes.campoSelect({ dataCampo: 'empresa_id', label: 'Empresa', opciones: opcionesEmpresasPausas_() }) +
      Componentes.campoTexto({ dataCampo: 'nombre', label: 'Nombre' }) +
      Componentes.campoTexto({ dataCampo: 'email', label: 'Correo' }) +
      Componentes.campoTexto({ dataCampo: 'area', label: 'Área' }) +
      Componentes.campoTexto({ dataCampo: 'cargo', label: 'Cargo' }) +
      '</div>' + Componentes.boton({ tipo: 'submit', texto: 'Agregar' }) + '<div id="resultado-admin"></div></form>';
    abrirDrawerAdmin_('Nuevo trabajador', form, function () {
      document.getElementById('form-pausas-trab').addEventListener('submit', function (evento) {
        evento.preventDefault();
        var leer = function (n) { return document.querySelector('#form-pausas-trab [data-campo="' + n + '"]').value.trim(); };
        guardarGestionPausas_('gestionarPausasTrabajador', {
          operacion: 'crear', empresa_id: leer('empresa_id'), nombre: leer('nombre'), email: leer('email'), area: leer('area'), cargo: leer('cargo')
        }, renderPausasRoster_);
      });
    });
  }

  // --- helpers comunes de coordinadoras/roster (activar/eliminar) -----------
  function botonesAccionPausas_(prefijo, id, activo) {
    return '<button type="button" class="sigso-boton--secundario" data-accion-' + prefijo + '="activar" data-id="' + id + '" data-activo="' + !activo + '">' + (activo ? 'Desactivar' : 'Activar') + '</button> ' +
      '<button type="button" class="sigso-boton--peligro" data-accion-' + prefijo + '="eliminar" data-id="' + id + '">Eliminar</button>';
  }

  function wireAccionesPausas_(prefijo, accionApi, campoId, recargar, etiqueta) {
    document.querySelectorAll('[data-accion-' + prefijo + ']').forEach(function (boton) {
      boton.addEventListener('click', function () {
        var accion = boton.getAttribute('data-accion-' + prefijo);
        var id = boton.getAttribute('data-id');
        var datos = {};
        datos[campoId] = id;
        if (accion === 'eliminar') {
          Componentes.confirmar({
            titulo: 'Eliminar ' + etiqueta,
            mensaje: 'Se eliminará de forma permanente. Esta acción no se puede deshacer.',
            confirmar: 'Eliminar', peligro: true
          }).then(function (confirmado) {
            if (!confirmado) return;
            datos.operacion = 'eliminar';
            guardarGestionPausas_(accionApi, datos, recargar);
          });
        } else {
          datos.operacion = 'activar';
          datos.activo = boton.getAttribute('data-activo') === 'true';
          guardarGestionPausas_(accionApi, datos, recargar);
        }
      });
    });
  }

  function guardarGestionPausas_(accionApi, datos, recargar) {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accionApi, datos).then(function (respuesta) {
      if (!respuesta.ok) {
        var destino = document.getElementById('resultado-admin');
        if (destino) destino.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo aplicar.', 'error');
        else Componentes.aviso({ tipo: 'error', texto: respuesta.message || 'No se pudo aplicar.' });
        return;
      }
      cerrarDrawerAdmin_();
      recargar();
    });
  }

  // --- sub-pestana: pausas programadas (Fase P1) ----------------------------
  var ESTADO_PAUSA_BADGE = {
    Programada: 'P3', Recordatorio_enviado: 'P3', En_curso: 'P2',
    Realizada: 'P4', Cerrada: 'P4', Suspendida: 'P5',
    No_realizada: 'P1', Cancelada: 'P1'
  };
  var ESTADOS_PAUSA_TERMINALES_UI = ['Cerrada', 'No_realizada', 'Cancelada'];

  function renderPausasProgramadas_() {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'listarPausasProgramadas', {}).then(function (respuesta) {
      var cont = document.getElementById('pausas-sub-contenido');
      if (!respuesta.ok) {
        cont.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cargar.', 'error');
        return;
      }
      var filas = respuesta.data || [];
      cont.innerHTML =
        '<div class="sigso-admin-cab"><h3>Pausas programadas</h3>' +
        '<span>' +
        '<button type="button" class="sigso-boton sigso-boton--secundario" id="btn-programar-hoy-pausas">' +
        Iconos.svg('reloj', { tam: 16 }) + ' Programar hoy</button> ' +
        '<button type="button" class="sigso-boton sigso-admin-cab__boton" id="btn-nueva-pausa-manual">' +
        Iconos.svg('nueva', { tam: 16 }) + ' Manual</button>' +
        '</span></div>' +
        '<p class="sigso-ayuda">El sistema crea la pausa del día automáticamente cada mañana según la configuración. ' +
        'Aquí puedes crear una puntual, reprogramarla o cancelarla.</p>' +
        Componentes.tarjeta(tablaPausasProgramadas_(filas));

      document.getElementById('btn-programar-hoy-pausas').addEventListener('click', function () {
        guardarGestionPausas_('programarPausasDelDia', {}, function () {
          Componentes.aviso({ tipo: 'exito', texto: 'Se programaron las pausas de hoy que correspondían.' });
          renderPausasProgramadas_();
        });
      });
      document.getElementById('btn-nueva-pausa-manual').addEventListener('click', abrirFormPausaManual_);

      document.querySelectorAll('[data-accion-pausa]').forEach(function (boton) {
        boton.addEventListener('click', function () {
          var accion = boton.getAttribute('data-accion-pausa');
          var id = boton.getAttribute('data-id');
          if (accion === 'cancelar') {
            Componentes.confirmar({
              titulo: 'Cancelar pausa',
              mensaje: 'La pausa quedará como Cancelada y no se contabilizará. ¿Continuar?',
              confirmar: 'Cancelar pausa', peligro: true
            }).then(function (ok) {
              if (!ok) return;
              guardarGestionPausas_('gestionarPausaProgramada', { operacion: 'cancelar', pausa_id: id }, renderPausasProgramadas_);
            });
          } else {
            abrirFormReprogramarPausa_(id, boton.getAttribute('data-fecha'), boton.getAttribute('data-hora'));
          }
        });
      });
    }).catch(mostrarErrorAdmin_);
  }

  function tablaPausasProgramadas_(filas) {
    if (filas.length === 0) {
      return Componentes.vacio({ icono: 'reloj', texto: 'Aún no hay pausas programadas.', detalle: 'Usa "Programar hoy" o crea una manual.' });
    }
    var cuerpo = filas.map(function (p) {
      var terminal = ESTADOS_PAUSA_TERMINALES_UI.indexOf(p.estado) !== -1;
      var acciones = terminal ? '<span class="sigso-ayuda">—</span>' :
        '<button type="button" class="sigso-boton--secundario" data-accion-pausa="reprogramar" data-id="' + p.pausa_id + '" data-fecha="' + Componentes.escaparHtml(claveFechaUi_(p.fecha)) + '" data-hora="' + Componentes.escaparHtml(String(p.hora_programada || '')) + '">Reprogramar</button> ' +
        '<button type="button" class="sigso-boton--peligro" data-accion-pausa="cancelar" data-id="' + p.pausa_id + '">Cancelar</button>';
      return '<tr>' +
        '<td>' + Componentes.escaparHtml(nombreEmpresaPausas_(p.empresa_id)) + '</td>' +
        '<td>' + Componentes.escaparHtml(claveFechaUi_(p.fecha)) + '</td>' +
        '<td>' + Componentes.escaparHtml(String(p.hora_programada || '—')) + '</td>' +
        '<td>' + Componentes.escaparHtml(String(p.duracion_min || '—')) + ' min</td>' +
        '<td>' + Componentes.badge(String(p.estado).replace(/_/g, ' '), ESTADO_PAUSA_BADGE[p.estado] || 'P3') + '</td>' +
        '<td>' + acciones + '</td>' +
        '</tr>';
    }).join('');
    return '<table class="sigso-tabla"><thead><tr><th>Empresa</th><th>Fecha</th><th>Hora</th><th>Duración</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>' + cuerpo + '</tbody></table>';
  }

  // La fecha puede llegar como ISO con hora (Date serializado) o como
  // AAAA-MM-DD; para la UI basta la parte del día.
  function claveFechaUi_(valor) {
    var m = String(valor || '').match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : String(valor || '');
  }

  function abrirFormPausaManual_() {
    var hoy = new Date().toISOString().slice(0, 10);
    var form = '<form id="form-pausa-manual"><div class="sigso-admin-form">' +
      Componentes.campoSelect({ dataCampo: 'empresa_id', label: 'Empresa', opciones: opcionesEmpresasPausas_() }) +
      Componentes.campoTexto({ dataCampo: 'fecha', tipo: 'date', label: 'Fecha', valor: hoy }) +
      Componentes.campoTexto({ dataCampo: 'hora_programada', label: 'Hora (HH:mm)', placeholder: '09:30' }) +
      Componentes.campoTexto({ dataCampo: 'duracion_min', tipo: 'number', label: 'Duración (minutos)' }) +
      '</div>' + Componentes.boton({ tipo: 'submit', texto: 'Crear' }) + '<div id="resultado-admin"></div></form>';
    abrirDrawerAdmin_('Nueva pausa manual', form, function () {
      document.getElementById('form-pausa-manual').addEventListener('submit', function (evento) {
        evento.preventDefault();
        var leer = function (n) { return document.querySelector('#form-pausa-manual [data-campo="' + n + '"]').value.trim(); };
        guardarGestionPausas_('gestionarPausaProgramada', {
          operacion: 'crear_manual', empresa_id: leer('empresa_id'), fecha: leer('fecha'),
          hora_programada: leer('hora_programada'), duracion_min: leer('duracion_min')
        }, renderPausasProgramadas_);
      });
    });
  }

  function abrirFormReprogramarPausa_(pausaId, fecha, hora) {
    var form = '<form id="form-reprogramar-pausa"><div class="sigso-admin-form">' +
      Componentes.campoTexto({ dataCampo: 'fecha', tipo: 'date', label: 'Nueva fecha', valor: claveFechaUi_(fecha) }) +
      Componentes.campoTexto({ dataCampo: 'hora_programada', label: 'Nueva hora (HH:mm)', valor: hora || '' }) +
      '</div>' + Componentes.boton({ tipo: 'submit', texto: 'Reprogramar' }) + '<div id="resultado-admin"></div></form>';
    abrirDrawerAdmin_('Reprogramar pausa', form, function () {
      document.getElementById('form-reprogramar-pausa').addEventListener('submit', function (evento) {
        evento.preventDefault();
        var leer = function (n) { return document.querySelector('#form-reprogramar-pausa [data-campo="' + n + '"]').value.trim(); };
        guardarGestionPausas_('gestionarPausaProgramada', {
          operacion: 'reprogramar', pausa_id: pausaId, fecha: leer('fecha'), hora_programada: leer('hora_programada')
        }, renderPausasProgramadas_);
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
        contenedor.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cargar.', 'error');
        return;
      }
      contenedor.innerHTML = '<h2>' + LOGS_UI.titulo + '</h2>' + Componentes.tarjeta(renderTabla_(LOGS_UI.campos, respuesta.data));
    }).catch(mostrarErrorAdmin_);
  }

  // v7.3 (Nivel 0): panel de solo lectura -- quien nunca acepto el permiso
  // de notificacion del navegador. Nace del feedback real "a unos les llega
  // la alerta y a otros no": la causa mas probable es que nunca vieron/
  // aceptaron el permiso del SO. Ordenado por el backend (pendientes
  // primero); aca solo se pinta.
  var PERMISO_NOTIF_BADGE = {
    sin_datos: 'P1', denied: 'P1', default: 'P3', granted: 'P4'
  };
  var PERMISO_NOTIF_TEXTO = {
    sin_datos: 'Sin datos (no cargó SIGSO aún)',
    denied: 'Bloqueado', default: 'Pendiente', granted: 'Activo'
  };

  function renderPermisosNotif_() {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'listarPermisosNotificacionesSO', {}).then(function (respuesta) {
      var contenedor = document.getElementById('admin-contenido');
      if (!respuesta.ok) {
        contenedor.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cargar.', 'error');
        return;
      }
      var personas = respuesta.data.personas || [];
      contenedor.innerHTML = '<h2>Alertas en vivo — permiso del navegador</h2>' +
        '<p class="sigso-ayuda">Quién tiene activadas las alertas del sistema operativo en su navegador. Los pendientes aparecen primero.</p>' +
        Componentes.tarjeta(tablaPermisosNotif_(personas));
    }).catch(mostrarErrorAdmin_);
  }

  function tablaPermisosNotif_(personas) {
    if (!personas.length) {
      return Componentes.vacio({ icono: 'campana', texto: 'Sin personal activo para mostrar.' });
    }
    var cuerpo = personas.map(function (p) {
      return '<tr>' +
        '<td>' + Componentes.escaparHtml(p.nombre) + '</td>' +
        '<td>' + Componentes.escaparHtml(p.email) + '</td>' +
        '<td>' + Componentes.escaparHtml(p.origen) + '</td>' +
        '<td>' + Componentes.badge(PERMISO_NOTIF_TEXTO[p.permiso] || p.permiso, PERMISO_NOTIF_BADGE[p.permiso] || 'P3') + '</td>' +
        '<td>' + Componentes.escaparHtml(p.actualizado_en ? String(p.actualizado_en) : '—') + '</td>' +
        '</tr>';
    }).join('');
    return '<table class="sigso-tabla"><thead><tr><th>Nombre</th><th>Email</th><th>Origen</th><th>Estado</th><th>Actualizado</th></tr></thead><tbody>' + cuerpo + '</tbody></table>';
  }

  // v7.5 (canales de alerta): el Admin elige qué categorías se mandan por
  // correo. Las que TAMBIÉN llegan como alerta en vivo (Pausas/Actividades/
  // Novedades) son seguras de apagar; las de solo-correo se advierten. Nace
  // del feedback real: "ya llegan las alertas en SIGSO, para pausas el correo
  // quizá ya no hace falta".
  function renderCanalesAlerta_() {
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'listarCanalesAlerta', {}).then(function (respuesta) {
      var contenedor = document.getElementById('admin-contenido');
      if (!respuesta.ok) {
        contenedor.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cargar.', 'error');
        return;
      }
      var canales = respuesta.data.canales || [];
      contenedor.innerHTML = '<h2>Canales de alerta — correo</h2>' +
        '<p class="sigso-ayuda">Elige qué alertas se envían por correo. Las que además llegan como <strong>alerta en vivo</strong> (campana/aviso en pantalla) son seguras de apagar. Las de solo correo, si las apagas, no llegarán por ningún medio.</p>' +
        canales.map(tarjetaCanalAlerta_).join('');

      contenedor.querySelectorAll('[data-canal]').forEach(function (input) {
        input.addEventListener('change', function () {
          var clave = input.getAttribute('data-canal');
          input.disabled = true;
          llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'guardarCanalAlerta', { clave: clave, activo: input.checked })
            .then(function (r) {
              if (!r.ok) {
                input.checked = !input.checked; input.disabled = false;
                Componentes.aviso({ tipo: 'error', texto: r.message || 'No se pudo guardar.' });
                return;
              }
              Componentes.aviso({ tipo: 'exito', texto: 'Preferencia guardada.' });
              renderCanalesAlerta_(); // re-render: actualiza la advertencia de "solo correo"
            })
            .catch(function () {
              input.checked = !input.checked; input.disabled = false;
              Componentes.aviso({ tipo: 'error', texto: 'No se pudo conectar.' });
            });
        });
      });
    }).catch(mostrarErrorAdmin_);
  }

  function tarjetaCanalAlerta_(c) {
    var badges = c.tiene_en_vivo
      ? Componentes.badge('🔔 En vivo', 'P4') + ' ' + Componentes.badge('✉ Correo', 'P3')
      : Componentes.badge('✉ Solo correo', 'P1');
    var advertencia = (!c.tiene_en_vivo && c.correo_activo)
      ? '<div class="sigso-ayuda" style="color:var(--alerta,#E5484D);margin-top:4px">⚠ Esta alerta hoy solo existe por correo. Si la apagas, nadie se enterará.</div>'
      : '';
    return '<div class="sigso-card" style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:10px">' +
      '<div style="flex:1">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><strong>' + Componentes.escaparHtml(c.nombre) + '</strong> ' + badges + '</div>' +
        '<div class="sigso-ayuda" style="margin-top:2px">' + Componentes.escaparHtml(c.descripcion) + '</div>' +
        advertencia +
      '</div>' +
      '<label class="sigso-toggle" style="white-space:nowrap"><input type="checkbox" data-canal="' + Componentes.escaparHtml(c.clave) + '"' + (c.correo_activo ? ' checked' : '') + '> Correo</label>' +
    '</div>';
  }

  // v7.5 Fase 2 (enviar alerta): megáfono manual del Admin. Elige a quién y
  // por qué canales (en vivo / correo) y sale al instante. Distinto de
  // Novedades. Del feedback real: "poder enviar alertas desde el Admin, en
  // caso que no tengan SIGSO abierto".
  function renderEnviarAlerta_() {
    var contenedor = document.getElementById('admin-contenido');
    contenedor.innerHTML = Componentes.cargando('Cargando...');
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'getDirectorioAlerta', {}).then(function (respuesta) {
      if (!respuesta.ok) {
        contenedor.innerHTML = Componentes.alerta(respuesta.message || 'No se pudo cargar.', 'error');
        return;
      }
      var dir = respuesta.data;
      var opcionesEmpresa = dir.empresas.map(function (e) {
        return '<option value="' + Componentes.escaparHtml(e) + '">' + Componentes.escaparHtml(e) + '</option>';
      }).join('');
      var opcionesPersona = dir.personas.map(function (p) {
        return '<option value="' + Componentes.escaparHtml(p.email) + '">' + Componentes.escaparHtml(p.nombre) + ' (' + Componentes.escaparHtml(p.email) + ')</option>';
      }).join('');

      contenedor.innerHTML =
        '<h2>Enviar alerta</h2>' +
        '<p class="sigso-ayuda">Un aviso directo a quien elijas, ahora. La <strong>alerta en vivo</strong> llega a quien tenga SIGSO abierto; el <strong>correo</strong> alcanza también a quien no lo tenga abierto.</p>' +
        '<form id="form-alerta" class="sigso-card" style="max-width:640px">' +
          Componentes.campoTexto({ dataCampo: 'titulo', label: 'Título' }) +
          Componentes.campoTextarea({ dataCampo: 'mensaje', label: 'Mensaje' }) +
          '<div class="sigso-campo"><label>A quién</label><select data-campo="audiencia">' +
            '<option value="TODOS">Todo el personal</option>' +
            '<option value="EMPRESA">Por empresa</option>' +
            '<option value="SELECCION">Personas específicas</option>' +
          '</select></div>' +
          '<div class="sigso-campo sigso-oculto" id="alerta-campo-empresa"><label>Empresa</label><select data-campo="empresa_id">' + opcionesEmpresa + '</select></div>' +
          '<div class="sigso-campo sigso-oculto" id="alerta-campo-seleccion"><label>Personas (Ctrl/Cmd para varias)</label><select data-campo="destinatarios" multiple size="8">' + opcionesPersona + '</select></div>' +
          '<div class="sigso-campo"><label>Canales</label><div style="display:flex;gap:16px">' +
            '<label class="sigso-toggle"><input type="checkbox" data-campo="por_en_vivo" checked> 🔔 Alerta en vivo</label>' +
            '<label class="sigso-toggle"><input type="checkbox" data-campo="por_correo" checked> ✉ Correo</label>' +
          '</div></div>' +
          Componentes.boton({ tipo: 'submit', texto: 'Enviar alerta' }) +
          '<div id="resultado-alerta"></div>' +
        '</form>';

      var form = document.getElementById('form-alerta');
      var lee = function (n) { return form.querySelector('[data-campo="' + n + '"]'); };
      lee('audiencia').addEventListener('change', function () {
        document.getElementById('alerta-campo-empresa').classList.toggle('sigso-oculto', this.value !== 'EMPRESA');
        document.getElementById('alerta-campo-seleccion').classList.toggle('sigso-oculto', this.value !== 'SELECCION');
      });

      form.addEventListener('submit', function (evento) {
        evento.preventDefault();
        var payload = {
          titulo: lee('titulo').value.trim(),
          mensaje: lee('mensaje').value.trim(),
          audiencia_tipo: lee('audiencia').value,
          empresa_id: lee('empresa_id').value,
          destinatarios: Array.prototype.map.call(lee('destinatarios').selectedOptions, function (o) { return o.value; }),
          por_en_vivo: lee('por_en_vivo').checked,
          por_correo: lee('por_correo').checked
        };
        Componentes.confirmar({ titulo: 'Enviar alerta', mensaje: '¿Enviar esta alerta ahora?', confirmar: 'Enviar' }).then(function (ok) {
          if (!ok) return;
          llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, 'enviarAlertaManual', payload).then(function (r) {
            if (!r.ok) {
              document.getElementById('resultado-alerta').innerHTML = Componentes.alerta(r.message || 'No se pudo enviar.', 'error');
              return;
            }
            Componentes.aviso({ tipo: 'exito', texto: 'Alerta enviada a ' + r.data.destinatarios + ' persona(s) (' + r.data.en_vivo + ' en vivo, ' + r.data.correo + ' correo).' });
            form.reset();
            document.getElementById('alerta-campo-empresa').classList.add('sigso-oculto');
            document.getElementById('alerta-campo-seleccion').classList.add('sigso-oculto');
          }).catch(function () {
            document.getElementById('resultado-alerta').innerHTML = Componentes.alerta('No se pudo conectar.', 'error');
          });
        });
      });
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


  // ==========================================================================
  // v12.2 — Reportes de Administración (sobre SigsoReportes)
  //
  // Segundo módulo que usa el motor. Sirve de prueba de que la base es
  // reutilizable de verdad: acá no se reescribe ni el catálogo, ni los
  // filtros, ni la exportación, ni las piezas visuales.
  //
  // Todos salen de datos que YA existen. "Entregabilidad" y "Por canal" son
  // agregaciones de LOG_NOTIFICACIONES, la misma tabla que alimenta la vista
  // de Automatizaciones: no se pide nada nuevo al backend.
  var REPORTES_ADMIN = [
    { grupo: 'Notificaciones', icono: 'campana', reportes: [
      { id: 'notif-entregabilidad', nombre: 'Entregabilidad', tipo: 'CUMPLIMIENTO', estado: 'LISTO',
        desc: 'Cuántas notificaciones salieron bien, cuántas fallaron y cuántas siguen reintentando.',
        fuente: 'listarLogs', filtros: [] },
      { id: 'notif-evento', nombre: 'Fallas por evento', tipo: 'RANKING', estado: 'LISTO',
        desc: 'Qué eventos concentran los problemas de envío.',
        fuente: 'listarLogs', filtros: [] },
      { id: 'notif-detalle', nombre: 'Automatizaciones (detalle)', tipo: 'DETALLE', estado: 'LISTO',
        desc: 'El historial crudo de envíos, tal como lo registra el sistema.',
        fuente: 'listarLogs', seccion: 'LOGS' }
    ] },
    { grupo: 'Salud del sistema', icono: 'escudo', reportes: [
      { id: 'sis-esquema', nombre: 'Estado del esquema', tipo: 'ESTADO', estado: 'LISTO',
        desc: 'Versión del backend y si alguna hoja o columna de la planilla falta.',
        fuente: 'getEstadoSistema', filtros: [] }
    ] },
    { grupo: 'Accesos', icono: 'llave', reportes: [
      { id: 'acc-modulos', nombre: 'Cuentas por módulo', tipo: 'RANKING', estado: 'LISTO',
        desc: 'Cuántas cuentas de la plataforma tienen habilitado cada módulo.',
        fuente: 'listarCuentasPortal', filtros: [] },
      { id: 'acc-inactivas', nombre: 'Cuentas sin uso', tipo: 'ESTADO', estado: 'PENDIENTE',
        desc: 'Cuentas creadas que nunca iniciaron sesión, o que llevan meses sin entrar.',
        falta: 'SESIONES_PORTAL guarda la sesión vigente, no el último acceso histórico de cada cuenta. Requiere registrar la fecha del último ingreso en CUENTAS_PORTAL.' }
    ] }
  ];

  var reporteAdminAbierto_ = null;

  function registrarReportesAdmin_() {
    if (!window.SigsoReportes || registrarReportesAdmin_.hecho) return;
    SigsoReportes.registrar('administracion', {
      titulo: 'Reportes de Administración',
      nota: 'Todos salen de datos que el sistema ya guarda. Los marcados como ' +
        '"Requiere desarrollo" indican qué información habría que empezar a registrar.',
      grupos: REPORTES_ADMIN
    });
    registrarReportesAdmin_.hecho = true;
  }

  var ACCION_POR_REPORTE_ADMIN = {
    'notif-entregabilidad': 'listarLogs',
    'notif-evento': 'listarLogs',
    'sis-esquema': 'getEstadoSistema',
    'acc-modulos': 'listarCuentasPortal'
  };

  function renderReportes_() {
    var cont = document.getElementById('admin-contenido');
    if (!cont) return;
    registrarReportesAdmin_();
    if (!window.SigsoReportes) {
      cont.innerHTML = Componentes.alerta('El motor de reportes no está disponible.', 'error');
      return;
    }
    if (reporteAdminAbierto_) { abrirReporteAdmin_(cont); return; }
    SigsoReportes.pintarCatalogo({
      contenedor: cont,
      modulo: 'administracion',
      onAbrir: function (id) { reporteAdminAbierto_ = id; renderReportes_(); },
      onIrASeccion: function (seccion) { irASeccionAdmin_(seccion); }
    });
  }

  function abrirReporteAdmin_(cont) {
    var r = SigsoReportes.buscarReporte('administracion', reporteAdminAbierto_);
    var accion = ACCION_POR_REPORTE_ADMIN[reporteAdminAbierto_];
    if (!r || !accion) { reporteAdminAbierto_ = null; renderReportes_(); return; }

    cont.innerHTML = Componentes.cargando('Armando el reporte...');
    var datos = accion === 'listarLogs' ? { limite: 500 } : {};
    llamarApi(window.SIGSO_CONFIG.BACKOFFICE_URL, accion, datos).then(function (respuesta) {
      if (!respuesta || !respuesta.ok) {
        cont.innerHTML = Componentes.alerta((respuesta && respuesta.message) || 'No se pudo cargar el reporte.', 'error');
        return;
      }
      pintarReporteAdmin_(cont, r, respuesta.data);
    }).catch(mostrarErrorAdmin_);
  }

  function pintarReporteAdmin_(cont, r, data) {
    var cuerpo = '';
    if (r.id === 'notif-entregabilidad') cuerpo = cuerpoEntregabilidad_(data);
    else if (r.id === 'notif-evento') cuerpo = cuerpoFallasPorEvento_(data);
    else if (r.id === 'sis-esquema') cuerpo = cuerpoEstadoEsquema_(data);
    else if (r.id === 'acc-modulos') cuerpo = cuerpoCuentasPorModulo_(data);

    cont.innerHTML =
      SigsoReportes.barraAcciones({}) +
      '<h2>' + Componentes.escaparHtml(r.nombre) + '</h2>' +
      '<p class="sigso-ayuda">' + Componentes.escaparHtml(r.desc) + '</p>' +
      cuerpo;

    SigsoReportes.wireAcciones(cont, {
      nombreArchivo: 'sigso-admin-' + r.id,
      onVolver: function () { reporteAdminAbierto_ = null; renderReportes_(); }
    });
  }

  // Un envío se considera OK cuando el sistema no registró error ni dejó el
  // item reintentando. No se inventa una categoría "parcial": el log tiene
  // tres estados y son esos tres los que se muestran.
  function cuerpoEntregabilidad_(logs) {
    var filas = Array.isArray(logs) ? logs : [];
    if (!filas.length) return Componentes.vacio('Todavía no hay envíos registrados.');
    var porResultado = {};
    filas.forEach(function (l) {
      var k = l.resultado || '(sin resultado)';
      porResultado[k] = (porResultado[k] || 0) + 1;
    });
    var ok = porResultado.OK || porResultado.ENVIADO || 0;
    var reintentando = porResultado.PENDIENTE_REINTENTO || 0;
    var pct = filas.length ? Math.round(ok / filas.length * 100) : 0;

    return SigsoReportes.kpis([
      { etiqueta: 'Envíos registrados', valor: filas.length },
      { etiqueta: 'Entregados', valor: ok },
      { etiqueta: 'Reintentando', valor: reintentando, alerta: reintentando > 0 },
      { etiqueta: 'Tasa de entrega', valor: pct + '%' }
    ]) +
    SigsoReportes.tabla([
      { campo: 'resultado', titulo: 'Resultado' },
      { campo: 'total', titulo: 'Envíos', alinear: 'derecha' },
      { campo: 'pct', titulo: 'Del total', alinear: 'derecha' }
    ], Object.keys(porResultado).sort(function (a, b) {
      return porResultado[b] - porResultado[a];
    }).map(function (k) {
      return {
        resultado: k, total: porResultado[k],
        pct: Math.round(porResultado[k] / filas.length * 100) + '%'
      };
    }));
  }

  function cuerpoFallasPorEvento_(logs) {
    var filas = Array.isArray(logs) ? logs : [];
    var fallidos = filas.filter(function (l) {
      return l.resultado && l.resultado !== 'OK' && l.resultado !== 'ENVIADO';
    });
    if (!fallidos.length) {
      return Componentes.vacio('Ningún envío con problemas en los últimos registros. Nada que rankear.');
    }
    var porEvento = {};
    fallidos.forEach(function (l) {
      var k = l.evento || '(sin evento)';
      porEvento[k] = (porEvento[k] || 0) + 1;
    });
    return SigsoReportes.ranking(
      Object.keys(porEvento).sort(function (a, b) { return porEvento[b] - porEvento[a]; })
        .map(function (k) { return { etiqueta: k, valor: porEvento[k] }; })
    ) +
    '<h3>Detalle</h3>' +
    SigsoReportes.tabla([
      { campo: 'timestamp', titulo: 'Fecha' },
      { campo: 'evento', titulo: 'Evento' },
      { campo: 'destinatario', titulo: 'Destinatario' },
      { campo: 'resultado', titulo: 'Resultado' },
      { campo: 'reintentos', titulo: 'Reintentos', alinear: 'derecha' }
    ], fallidos.slice(0, 100));
  }

  function cuerpoEstadoEsquema_(data) {
    var e = (data && data.esquema) || {};
    var problemas = [];
    // diagnosticarEsquema_ devuelve la forma que use el backend; se recorre
    // sin asumir nombres de campo, para no romper si cambia.
    Object.keys(e).forEach(function (k) {
      var v = e[k];
      if (Array.isArray(v) && v.length) {
        v.forEach(function (item) {
          problemas.push({ tipo: k, detalle: typeof item === 'string' ? item : JSON.stringify(item) });
        });
      }
    });
    return SigsoReportes.kpis([
      { etiqueta: 'Versión del backend', valor: (data && data.version_backend) || '—' },
      { etiqueta: 'Problemas de esquema', valor: problemas.length, alerta: problemas.length > 0 }
    ]) +
    (problemas.length
      ? SigsoReportes.tabla(
          [{ campo: 'tipo', titulo: 'Tipo' }, { campo: 'detalle', titulo: 'Detalle' }], problemas)
      : Componentes.vacio('La planilla tiene todas las hojas y columnas que el backend espera.'));
  }

  function cuerpoCuentasPorModulo_(data) {
    var cuentas = (data && data.cuentas) || (Array.isArray(data) ? data : []);
    if (!cuentas.length) return Componentes.vacio('No hay cuentas de plataforma cargadas.');
    var porModulo = {};
    cuentas.forEach(function (c) {
      var mods = c.modulos;
      if (typeof mods === 'string') { try { mods = JSON.parse(mods); } catch (err) { mods = []; } }
      (mods || []).forEach(function (m) { porModulo[m] = (porModulo[m] || 0) + 1; });
    });
    return SigsoReportes.kpis([
      { etiqueta: 'Cuentas', valor: cuentas.length },
      { etiqueta: 'Módulos en uso', valor: Object.keys(porModulo).length }
    ]) +
    SigsoReportes.ranking(
      Object.keys(porModulo).sort(function (a, b) { return porModulo[b] - porModulo[a]; })
        .map(function (m) { return { etiqueta: m, valor: porModulo[m] }; }),
      { vacio: 'Ninguna cuenta tiene módulos asignados.' }
    );
  }

})();
