/**
 * Índice de los manuales de uso (manual-v2.js). Liviano: solo dice qué manual
 * corresponde a cada módulo; el texto y las capturas se bajan al abrirlo.
 * `version` cambia cuando se actualizan textos o capturas (evita la caché).
 */
SigsoManual.indice([
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
    resumen: 'Recibir los reportes de las áreas y armar el informe de gestión para la gerencia.' }
], '2026-10-06b');
