/**
 * Índice de los manuales de uso (manual-v2.js). Liviano: solo dice qué manual
 * corresponde a cada módulo; el texto y las capturas se bajan al abrirlo.
 * `version` cambia cuando se actualizan textos o capturas (evita la caché).
 */
SigsoManual.indice([
  { id: 'primeros-pasos', archivo: 'primeros-pasos', grupo: 'Para empezar', todos: true, titulo: 'Primeros pasos en SIGSO', icono: 'inicio', color: 'var(--mod-nueva)', modulos: ['home'],
    resumen: 'Entrar, tu Inicio, la barra lateral (íconos y menú en tarjetas), buscar, avisos y tu cuenta.' },
  { id: 'nueva-solicitud', archivo: 'solicitudes', grupo: 'Solicitudes', titulo: 'Nueva solicitud', icono: 'nueva', color: 'var(--mod-nueva)', modulos: ['nueva_solicitud'],
    resumen: 'Pedir un servicio a cualquier área o reportar un error o mejora de un sistema.' },
  { id: 'mis-solicitudes', archivo: 'solicitudes', grupo: 'Solicitudes', titulo: 'Mis solicitudes', icono: 'lista', color: 'var(--mod-mis)', modulos: ['mis_solicitudes'],
    resumen: 'Seguir lo que pediste, responder al equipo y confirmar lo resuelto.' },
  { id: 'bandeja', archivo: 'solicitudes', grupo: 'Solicitudes', titulo: 'Bandeja de trabajo', icono: 'bandeja', color: 'var(--mod-bandeja)', modulos: ['bandeja'],
    resumen: 'Atender solicitudes: tomar pedidos de la cola, conversar, comprometer fecha y resolver.' },
  { id: 'mi-trabajo', archivo: 'mi-espacio', grupo: 'Mi espacio', titulo: 'Mi trabajo', icono: 'tareas', color: 'var(--mod-mi-trabajo)', modulos: ['mi_trabajo'],
    resumen: 'Tus tareas, actualizarlas con un clic y registrar tus horas.' },
  { id: 'novedades', archivo: 'mi-espacio', grupo: 'Mi espacio', titulo: 'Novedades', icono: 'periodico', color: 'var(--mod-novedades)', modulos: ['novedades'],
    resumen: 'Leer y confirmar leyes, procedimientos, avisos y capacitaciones.' },
  { id: 'pausas', archivo: 'mi-espacio', grupo: 'Mi espacio', titulo: 'Pausas activas', icono: 'actividad', color: 'var(--mod-pausas)', modulos: ['pausas'],
    resumen: 'Registrar en segundos tu participación en la pausa del día.' },
  { id: 'area-contabilidad', archivo: 'areas', grupo: 'Áreas', titulo: 'Contabilidad', icono: 'dinero', color: 'var(--mod-contab)', modulos: ['dep_contabilidad'],
    resumen: 'Recordatorios a clientes, agenda, matrices (IVA, facturación, convenios), TGR, SII y reporte mensual.' },
  { id: 'area-rrhh', archivo: 'areas', grupo: 'Áreas', titulo: 'Recursos Humanos', icono: 'gafete', color: 'var(--mod-rrhh)', modulos: ['dep_rrhh'],
    resumen: 'Recordatorios de remuneraciones e imposiciones, matrices, informes de impuesto único y plataformas.' },
  { id: 'area-prevencion', archivo: 'areas', grupo: 'Áreas', titulo: 'Prevención de riesgos', icono: 'casco', color: 'var(--mod-prev)', modulos: ['dep_prevencion'],
    resumen: 'Recordatorios y fechas del área, agenda, reporte mensual y equipo.' },
  { id: 'area-marketing', archivo: 'areas', grupo: 'Áreas', titulo: 'Marketing corporativo', icono: 'megafono', color: 'var(--mod-mkt)', modulos: ['dep_marketing'],
    resumen: 'Fechas del área, agenda, reporte mensual y equipo.' },
  { id: 'area-cobranzas', archivo: 'areas', grupo: 'Áreas', titulo: 'Facturación y Cobranzas', icono: 'recibo', color: 'var(--mod-fact)', modulos: ['dep_cobranzas'],
    resumen: 'Recordatorios de cobro, agenda, matriz de cobranza y el informe de plataformas de RR.HH.' },
  { id: 'area-administracion', archivo: 'administracion', grupo: 'Áreas', titulo: 'Administración', icono: 'maletin', color: 'var(--mod-admarea)', modulos: ['dep_administracion'],
    resumen: 'Recibir los reportes de las áreas y armar el informe de gestión para la gerencia.' },
  { id: 'hompy', archivo: 'hompy', grupo: 'Áreas', titulo: 'Hompy, la mascota', icono: 'hompy', color: 'var(--mod-hompy)', modulos: ['hompy'],
    resumen: 'Calendario, reporte de salida a terreno con su dinero, Estudio TikTok, marcas colaboradoras y reporte del mes.' }
], '2026-10-07e');
