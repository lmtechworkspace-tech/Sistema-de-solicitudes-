// Oficina virtual de HomePymes — distribución real (plano a mano del dueño, 26-11):
//  1 Administración de Plataformas · 2 Jefaturas · 3 Operativo RR.HH. y Contabilidad
//  4 Sala de reuniones · 5 Podcast «Vida de Contratistas» · 6 Baño de hombres
//  7 Prevención · 8 Comedor · 9 Recepción · 10 Almacén · 11 Salida
// Cargos, cuántas personas y si son hombres o mujeres: lo dijo el dueño.
// NOMBRES aún no: cada persona muestra su cargo hasta conectar con SIGSO
// (SGC_PERSONAS + SGC_DESCRIPTORES). Descriptores y comunicaciones: de ejemplo.
window.OFICINA = {
  empresa: 'HomePymes',
  salas: [
    { id: 'recepcion', n: 9, nombre: 'Recepción', color: '#e9a23b',
      que_hace: 'Es lo primero que se ve al entrar por la salida. Aquí está la Gerencia de Facturación y Cobranzas: recibe a clientes y visitas, emite las facturas y sigue los pagos hasta que entran.',
      procesos: ['Atención de visitas', 'Facturación', 'Cobranza'],
      comunica: [
        { con: 'jefaturas', dir: 'sale', que: 'Facturas emitidas y estado de la cobranza', canal: 'SIGSO · Finanzas' },
        { con: 'operativo', dir: 'sale', que: 'Facturas y pagos recibidos para contabilizar', canal: 'SIGSO + carpeta del mes' },
        { con: 'plataformas', dir: 'entra', que: 'Altas y bajas de clientes en las plataformas, para facturar', canal: 'SIGSO · Solicitudes' }
      ] },
    { id: 'reuniones', n: 4, nombre: 'Sala de reuniones', color: '#64748b',
      que_hace: 'Sala con puertas correderas de vidrio, junto a la recepción. Aquí se hacen las reuniones con clientes, la coordinación del equipo y la revisión por la dirección.',
      procesos: ['Reuniones con clientes', 'Coordinación semanal', 'Revisión por la dirección'],
      comunica: [
        { con: 'jefaturas', dir: 'entra', que: 'Convocan y fijan la tabla', canal: 'Reunión presencial' }
      ] },
    { id: 'operativo', n: 3, nombre: 'Operativo RR.HH. y Contabilidad', color: '#0f766e',
      que_hace: 'El día a día de las personas y los números: contratos, remuneraciones, vacaciones y permisos (RR.HH.), y el registro contable de compras, ventas e impuestos (Contabilidad).',
      procesos: ['Contratos y remuneraciones', 'Vacaciones y permisos', 'Registro contable', 'F29 mensual'],
      comunica: [
        { con: 'jefaturas', dir: 'sale', que: 'Liquidaciones y cierre contable para aprobar', canal: 'SIGSO · Agenda de RR.HH. y Contabilidad' },
        { con: 'recepcion', dir: 'entra', que: 'Facturas y pagos recibidos', canal: 'SIGSO + carpeta del mes' },
        { con: 'prevencion', dir: 'sale', que: 'Personas que ingresan, para su inducción', canal: 'WhatsApp + SIGSO' },
        { con: 'almacen', dir: 'sale', que: 'Carpetas y respaldos del mes', canal: 'Carpetas físicas' }
      ] },
    { id: 'jefaturas', n: 2, nombre: 'Jefaturas', color: '#c2410c',
      que_hace: 'Aquí trabajan la Gerencia de Administración y Finanzas y la Encargada de Administración. Aprueban pagos y remuneraciones, revisan la caja y ordenan las prioridades de cada área. Además, apoyan como asistentes de cámara en el podcast.',
      procesos: ['Aprobación de pagos', 'Flujo de caja', 'Prioridades de las áreas', 'Apoyo al podcast'],
      comunica: [
        { con: 'operativo', dir: 'entra', que: 'Liquidaciones y cierre contable para aprobar', canal: 'SIGSO · Agenda de RR.HH. y Contabilidad' },
        { con: 'recepcion', dir: 'entra', que: 'Facturas emitidas y estado de la cobranza', canal: 'SIGSO · Finanzas' },
        { con: 'prevencion', dir: 'entra', que: 'Reporte mensual de seguridad', canal: 'SIGSO · Reporte' },
        { con: 'plataformas', dir: 'sale', que: 'Prioridades de clientes y plataformas', canal: 'Reunión + WhatsApp' },
        { con: 'podcast', dir: 'sale', que: 'Apoyo como asistentes de cámara en las grabaciones', canal: 'En persona' }
      ] },
    { id: 'plataformas', n: 1, nombre: 'Administración de Plataformas', color: '#7c3aed',
      que_hace: 'Administra las plataformas que usan los clientes: crea y da de baja cuentas, carga documentos, revisa que la información esté al día y responde dudas de uso.',
      procesos: ['Altas y bajas de clientes', 'Carga de documentos', 'Soporte a clientes'],
      comunica: [
        { con: 'jefaturas', dir: 'entra', que: 'Prioridades de clientes y plataformas', canal: 'Reunión + WhatsApp' },
        { con: 'recepcion', dir: 'sale', que: 'Altas y bajas de clientes en las plataformas, para facturar', canal: 'SIGSO · Solicitudes' }
      ] },
    { id: 'almacen', n: 10, nombre: 'Almacén', color: '#78716c',
      que_hace: 'Al fondo del pasillo. Guarda insumos de oficina, equipos y las carpetas en papel que hay que conservar.',
      procesos: ['Insumos', 'Archivo en papel'],
      comunica: [ { con: 'operativo', dir: 'entra', que: 'Carpetas y respaldos del mes', canal: 'Carpetas físicas' } ] },
    { id: 'podcast', n: 5, nombre: 'Podcast «Vida de Contratistas»', color: '#db2777',
      que_hace: 'Estudio de grabación del podcast «Vida de Contratistas: historias de los que construyen Chile». El entrevistador y un contratista invitado conversan en la mesa de madera, frente a la pantalla con el logo; las dos jefaturas ayudan como asistentes de cámara. De aquí salen los capítulos y los reels para redes.',
      procesos: ['Grabación de capítulos', 'Reels para redes'],
      comunica: [
        { con: 'jefaturas', dir: 'entra', que: 'Apoyo como asistentes de cámara en las grabaciones', canal: 'En persona' }
      ] },
    { id: 'bano', n: 6, nombre: 'Baño de hombres', color: '#94a3b8', que_hace: 'Servicios higiénicos de hombres.', procesos: [], comunica: [] },
    { id: 'prevencion', n: 7, nombre: 'Prevención de Riesgos', color: '#ea580c',
      que_hace: 'Cuida la seguridad de los trabajadores y contratistas: inducciones, charlas, investigación de accidentes y la documentación con la mutual y la SEREMI.',
      procesos: ['Inducción de seguridad', 'Charlas', 'Investigación de accidentes', 'Mutual / SEREMI'],
      comunica: [
        { con: 'operativo', dir: 'entra', que: 'Personas que ingresan, para su inducción', canal: 'WhatsApp + SIGSO' },
        { con: 'jefaturas', dir: 'sale', que: 'Reporte mensual de seguridad', canal: 'SIGSO · Reporte' }
      ] },
    { id: 'comedor', n: 8, nombre: 'Comedor', color: '#a16207',
      que_hace: 'Espacio común para colaciones y café, junto a la recepción. Desde aquí se entra al baño de mujeres y al espacio de los basureros.', procesos: ['Colación', 'Pausas'], comunica: [] },
    { id: 'banom', n: 8.1, nombre: 'Baño de mujeres', color: '#c084a8', que_hace: 'Servicios higiénicos de mujeres. Se entra desde el comedor.', procesos: [], comunica: [] },
    { id: 'basura', n: 8.2, nombre: 'Basureros', color: '#4d7c0f', que_hace: 'Espacio donde están los basureros y los útiles de aseo, al fondo del comedor.', procesos: [], comunica: [] }
  ],

  // genero: 'f' mujer, 'm' hombre (lo indicó el dueño). tarea = lo que dice su globo.
  personas: [
    { id: 'p9', genero: 'f', nombre: 'Gerenta de Facturación y Cobranzas', cargo: 'Gerenta de Facturación y Cobranzas', sala: 'recepcion', jefatura: null, tarea: 'Emitiendo las facturas del mes',
      descriptor: { objetivo: 'Que todo lo vendido se facture a tiempo y se cobre.',
        funciones: ['Recibir a clientes y visitas', 'Emitir facturas', 'Seguir la cobranza hasta el pago', 'Informar el estado de la cobranza a jefaturas'],
        responsabilidades: ['Facturación al día', 'Cartera vencida bajo control'],
        habilidades: ['Atención al cliente', 'Facturación electrónica', 'Seguimiento'],
        nivel_educacional: 'Por confirmar', experiencia: 'Por confirmar' } },
    { id: 'p2a', genero: 'f', nombre: 'Gerenta de Administración y Finanzas', cargo: 'Gerenta de Administración y Finanzas', sala: 'jefaturas', jefatura: null, tarea: 'Revisando el flujo de caja',
      descriptor: { objetivo: 'Mantener las finanzas y la administración ordenadas para que la empresa opere.',
        funciones: ['Aprobar pagos y remuneraciones', 'Revisar el flujo de caja', 'Fijar prioridades de las áreas', 'Apoyar como asistente de cámara en el podcast'],
        responsabilidades: ['Caja disponible', 'Pagos dentro de plazo'],
        habilidades: ['Finanzas', 'Liderazgo', 'Criterio'],
        nivel_educacional: 'Por confirmar', experiencia: 'Por confirmar' } },
    { id: 'p2b', genero: 'f', nombre: 'Encargada de Administración', cargo: 'Encargada de Administración', sala: 'jefaturas', jefatura: 'p2a', tarea: 'Aprobando las liquidaciones',
      descriptor: { objetivo: 'Coordinar la administración diaria y al equipo operativo.',
        funciones: ['Revisar el trabajo de RR.HH. y Contabilidad', 'Coordinar con prevención y plataformas', 'Apoyar como asistente de cámara en el podcast'],
        responsabilidades: ['Procesos administrativos al día'],
        habilidades: ['Organización', 'Coordinación'],
        nivel_educacional: 'Por confirmar', experiencia: 'Por confirmar' } },
    { id: 'p3a', genero: 'f', nombre: 'Asistente de Contabilidad', cargo: 'Asistente de Contabilidad', sala: 'operativo', jefatura: 'p2b', tarea: 'Cuadrando el F29 del mes',
      descriptor: { objetivo: 'Registrar la contabilidad del mes completa y respaldada.',
        funciones: ['Registrar compras y ventas', 'Preparar el F29', 'Archivar respaldos'],
        responsabilidades: ['Registro contable al día'],
        habilidades: ['Contabilidad', 'Planillas', 'Rigurosidad'],
        nivel_educacional: 'Por confirmar', experiencia: 'Por confirmar' } },
    { id: 'p3b', genero: 'f', nombre: 'Asistente de RR.HH.', cargo: 'Asistente de RR.HH.', sala: 'operativo', jefatura: 'p2b', tarea: 'Calculando remuneraciones',
      descriptor: { objetivo: 'Apoyar la gestión de personas: contratos, remuneraciones y permisos.',
        funciones: ['Preparar contratos y anexos', 'Calcular remuneraciones', 'Registrar vacaciones y permisos'],
        responsabilidades: ['Carpetas del personal completas'],
        habilidades: ['Legislación laboral', 'Orden', 'Confidencialidad'],
        nivel_educacional: 'Por confirmar', experiencia: 'Por confirmar' } },
    { id: 'p3c', genero: 'f', nombre: 'Asistente de RR.HH. (2)', cargo: 'Asistente de RR.HH.', sala: 'operativo', jefatura: 'p2b', tarea: 'Registrando vacaciones',
      descriptor: { objetivo: 'Apoyar la gestión de personas: contratos, remuneraciones y permisos.',
        funciones: ['Preparar contratos y anexos', 'Calcular remuneraciones', 'Registrar vacaciones y permisos'],
        responsabilidades: ['Carpetas del personal completas'],
        habilidades: ['Legislación laboral', 'Orden', 'Confidencialidad'],
        nivel_educacional: 'Por confirmar', experiencia: 'Por confirmar' } },
    { id: 'p1', genero: 'f', nombre: 'Practicante de Plataformas', cargo: 'Practicante · Administración de Plataformas', sala: 'plataformas', jefatura: 'p2b', tarea: 'Creando la cuenta de un cliente',
      descriptor: { objetivo: 'Mantener al día las plataformas que usan los clientes.',
        funciones: ['Crear y dar de baja cuentas', 'Cargar documentos', 'Responder dudas de uso'],
        responsabilidades: ['Plataformas al día'],
        habilidades: ['Herramientas digitales', 'Orden', 'Atención al cliente'],
        nivel_educacional: 'Estudiante en práctica', experiencia: 'Práctica profesional' } },
    { id: 'p5a', genero: 'm', nombre: 'Entrevistador', cargo: 'Entrevistador · Vida de Contratistas', sala: 'podcast', jefatura: null, tarea: 'Grabando el capítulo', audifonos: true,
      descriptor: { objetivo: 'Conducir las conversaciones del podcast con los contratistas.',
        funciones: ['Preparar las preguntas', 'Conducir la entrevista', 'Revisar los cortes para reels'],
        responsabilidades: ['Un capítulo por grabación'],
        habilidades: ['Comunicación', 'Escucha', 'Conocimiento del rubro'],
        nivel_educacional: 'Por confirmar', experiencia: 'Por confirmar' } },
    { id: 'p5b', genero: 'm', nombre: 'Entrevistado', cargo: 'Contratista invitado', sala: 'podcast', jefatura: null, tarea: 'Contando su experiencia', audifonos: true, invitado: true,
      descriptor: { objetivo: 'Invitado del capítulo: cuenta su experiencia como contratista.', funciones: [], responsabilidades: [], habilidades: [], nivel_educacional: '—', experiencia: '—' } },
    { id: 'p7a', genero: 'f', nombre: 'Encargada de Prevención', cargo: 'Encargada de Prevención', sala: 'prevencion', jefatura: 'p2a', tarea: 'Preparando la charla de seguridad',
      descriptor: { objetivo: 'Que nadie se accidente trabajando y que la documentación de seguridad esté al día.',
        funciones: ['Planificar inducciones y charlas', 'Investigar accidentes', 'Gestionar la mutual y la SEREMI', 'Reportar a jefaturas'],
        responsabilidades: ['Tasa de accidentabilidad bajo la meta'],
        habilidades: ['Normativa DS 44', 'Liderazgo en terreno'],
        nivel_educacional: 'Por confirmar', experiencia: 'Por confirmar' } },
    { id: 'p7b', genero: 'f', nombre: 'Prevencionista de Riesgos', cargo: 'Prevencionista de Riesgos', sala: 'prevencion', jefatura: 'p7a', tarea: 'Revisando una inducción',
      descriptor: { objetivo: 'Apoyar la prevención en terreno y en la oficina.',
        funciones: ['Hacer inducciones', 'Dictar charlas', 'Revisar documentación de contratistas'],
        responsabilidades: ['Inducciones al día'],
        habilidades: ['Prevención de riesgos', 'Comunicación'],
        nivel_educacional: 'Por confirmar', experiencia: 'Por confirmar' } }
  ],

  // El recorrido sigue el video: se entra por la salida (11) y se termina en la oficina 1.
  recorrido: ['recepcion', 'reuniones', 'comedor', 'operativo', 'prevencion', 'jefaturas', 'bano', 'podcast', 'almacen', 'plataformas']
};
// Qué departamento de Solicitudes atiende cada oficina (mismo mapa que el servidor;
// TECNICO = Soporte de plataformas). Sirve para «Pedirle algo» y las pizarras.
window.OFICINA.deptos_de_sala = {
  recepcion: ['COBRANZAS'], operativo: ['RRHH', 'CONTABILIDAD'], jefaturas: ['ADMINISTRACION'],
  prevencion: ['PREVENCION'], plataformas: ['TECNICO']
  // podcast: sin departamento por ahora (el dueño lo define después)
};
// Rótulo corto sobre la cabeza (mientras no haya nombres reales).
{
  const corto = { p9: 'Facturación y Cobranzas', p2a: 'Gerenta Adm. y Finanzas', p2b: 'Encargada de Adm.', p3a: 'Asist. Contabilidad', p3b: 'Asist. RR.HH.', p3c: 'Asist. RR.HH.',
    p1: 'Practicante', p5a: 'Entrevistador', p5b: 'Invitado', p7a: 'Encargada Prevención', p7b: 'Prevencionista' };
  for (const p of window.OFICINA.personas) p.corto = corto[p.id];
}
