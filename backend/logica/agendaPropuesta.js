'use strict';

/**
 * agendaPropuesta.js — la PROPUESTA INICIAL de fechas clave y recordatorios
 * de cada departamento (2026-10-04). Sale de los procesos de servicio del SGC
 * (DOC-10 a DOC-13, Calidad › Procesos) y de lo que hoy se hace de verdad
 * según las matrices (la carta pre-IVA sale el día 9 en la mediana, el correo
 * recordatorio el 12, la llamada el 14, la declaración el 16).
 *
 * Se carga una sola vez por obligación (por su `clave`); después la editan
 * las jefaturas o el superusuario en Ajustes, y «Restaurar propuesta» vuelve
 * a esto.
 *
 * Cada obligación:
 *  - tipo: CLIENTE (se le recuerda al cliente) | INTERNO (tarea del equipo).
 *  - fuente: de dónde sale la lista de a quién recordar (agendaDepto.js):
 *      iva_por_pagar · convenio_cuotas · asistencia · previred ·
 *      cobranza_facturas · clientes_contabilidad · manual (fechas que se
 *      agregan a mano en el calendario) · interno (una sola tarea).
 *  - regla: cuándo vence.
 *      { tipo: 'mensual', mes: N, dia: 20 | 'ultimo', habil: true }
 *        → el día 20 del mes N después del período (corrido al hábil si cae
 *          en fin de semana o feriado); 'ultimo' = último día hábil.
 *      { tipo: 'anual', mes: 4, dia: 30, habil: true }
 *      { tipo: 'evento' } → la fecha la trae cada cliente (cuota, factura,
 *          examen agendado).
 *  - escalones: los recordatorios, contados en días hábiles desde la fecha
 *    límite (−5 = cinco días hábiles antes; 0 = el mismo día; 1 = el día
 *    después). canal: WHATSAPP | CORREO | LLAMADA | INTERNO.
 *  - Variables de los mensajes: {contacto} {empresa} {periodo} {monto}
 *    {fecha_limite} {dias} {n_cuota} {n_factura} {pendientes} {trabajador}
 *    {hora} {lugar} {firma}.
 */

const P = (o) => o;

const PROPUESTA = [
  // =============================== CONTABILIDAD ===============================
  P({
    clave: 'IVA_F29', depto: 'CONTABILIDAD', orden: 1, tipo: 'CLIENTE', fuente: 'iva_por_pagar', proceso: 'SRV-CON-05',
    nombre: 'IVA mensual (F29) con monto a pagar',
    descripcion: 'Clientes del mes con IVA a pagar que todavía no depositan. Vence el día 20 del mes siguiente (o el hábil siguiente).',
    regla: { tipo: 'mensual', mes: 1, dia: 20, habil: true },
    escalones: [
      { id: 'R1', nombre: 'Aviso con monto', offset: -5, canal: 'CORREO', a_quien: 'CLIENTE',
        asunto: 'IVA de {periodo} · {empresa} · vence el {fecha_limite}',
        texto: 'Hola {contacto}:\n\nTe informamos que el IVA de {periodo} de {empresa} es de {monto} y vence el {fecha_limite}.\n\nPara dejarlo pagado a tiempo, por favor realiza el depósito y envíanos el comprobante respondiendo este correo o por WhatsApp.\n\nSaludos,\n{firma}\nHomePymes' },
      { id: 'R2', nombre: 'Quedan 2 días', offset: -2, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, te escribimos de HomePymes. El IVA de {periodo} de {empresa} es de {monto} y vence el {fecha_limite} (quedan {dias} días hábiles). Para dejarlo pagado a tiempo, haz el depósito y envíanos el comprobante por este medio. ¡Gracias!' },
      { id: 'R3', nombre: 'Mañana vence', offset: -1, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, te recordamos que mañana {fecha_limite} vence el IVA de {periodo} de {empresa} ({monto}). Si ya depositaste, envíanos el comprobante; si no, hoy es buen día para hacerlo y evitar multas.' },
      { id: 'R4', nombre: 'Último día', offset: 0, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, hoy {fecha_limite} es el último día para pagar el IVA de {periodo} de {empresa} ({monto}) sin multas ni intereses. Si ya depositaste, envíanos el comprobante y lo dejamos pagado hoy.' },
      { id: 'R5', nombre: 'Vencido', offset: 1, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, el plazo del IVA de {periodo} de {empresa} venció el {fecha_limite} y desde hoy se suman multas e intereses. Escríbenos para regularizarlo: podemos pagarlo con recargo o evaluar un convenio con la TGR.' }
    ],
    sin_recordatorio: 'Si el cliente paga tarde y no se le avisó, el atraso queda registrado como interno (de HomePymes).',
    sin_respuesta: 'Desde el día siguiente se suman multas e intereses. Se avisa a la jefatura y se ofrece giro o convenio con la TGR. Queda como atraso del cliente con aviso.'
  }),
  P({
    clave: 'CONVENIO_CUOTA', depto: 'CONTABILIDAD', orden: 2, tipo: 'CLIENTE', fuente: 'convenio_cuotas', proceso: 'SRV-CON-14',
    nombre: 'Cuota de convenio TGR',
    descripcion: 'Cuotas de los convenios con la TGR que vencen y no figuran pagadas (según el seguimiento de convenios).',
    regla: { tipo: 'evento' },
    escalones: [
      { id: 'R1', nombre: 'Cuota por vencer', offset: -3, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, te recordamos que la cuota {n_cuota} del convenio TGR de {empresa} ({monto}) vence el {fecha_limite}. Si no se paga, el convenio puede caducar y la deuda vuelve a cobrarse completa.' },
      { id: 'R2', nombre: 'Vence hoy', offset: 0, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, hoy {fecha_limite} vence la cuota {n_cuota} del convenio TGR de {empresa} ({monto}). Si ya la pagaste, envíanos el comprobante.' },
      { id: 'R3', nombre: 'Cuota vencida', offset: 1, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, la cuota {n_cuota} del convenio TGR de {empresa} ({monto}) quedó impaga el {fecha_limite}. Es importante pagarla pronto: con cuotas impagas el convenio caduca. ¿Te ayudamos a regularizarla?' }
    ],
    sin_recordatorio: 'El convenio puede caducar sin que el cliente lo sepa.',
    sin_respuesta: 'Se avisa a la jefatura. Si se acumulan cuotas impagas, el convenio caduca y la deuda vuelve completa.'
  }),
  P({
    clave: 'REVISION_CONVENIOS', depto: 'CONTABILIDAD', orden: 3, tipo: 'INTERNO', fuente: 'interno', proceso: 'SRV-CON-14',
    nombre: 'Revisión de convenios en la TGR',
    descripcion: 'A mitad de mes: revisar en la TGR las cuotas de todos los convenios (robot, marcador o pegando la página).',
    regla: { tipo: 'mensual', mes: 0, dia: 15, habil: true },
    escalones: [{ id: 'T', nombre: 'Revisar convenios', offset: 0, canal: 'INTERNO', a_quien: 'RESPONSABLE', texto: 'Revisar en la TGR las cuotas de todos los convenios y actualizar el seguimiento.' }],
    sin_recordatorio: 'Las cuotas vencidas no se detectan a tiempo.', sin_respuesta: ''
  }),
  P({
    clave: 'PRE_IVA', depto: 'CONTABILIDAD', orden: 4, tipo: 'INTERNO', fuente: 'interno', proceso: 'SRV-CON-05',
    nombre: 'Cálculo del pre-IVA',
    descripcion: 'Antes del cierre del mes: calcular el pre-IVA de cada cliente para enviar la carta.',
    regla: { tipo: 'mensual', mes: 0, dia: 'ultimo', habil: true },
    escalones: [{ id: 'T', nombre: 'Calcular pre-IVA', offset: -3, canal: 'INTERNO', a_quien: 'RESPONSABLE', texto: 'Calcular el pre-IVA de {periodo} de todos los clientes.' }],
    sin_recordatorio: 'La carta pre-IVA sale tarde y se acorta el plazo del cliente para pagar.', sin_respuesta: ''
  }),
  P({
    clave: 'ACUSE_RECIBO', depto: 'CONTABILIDAD', orden: 5, tipo: 'INTERNO', fuente: 'interno', proceso: 'SRV-CON-15',
    nombre: 'Acuse de recibo de facturas',
    descripcion: 'Revisar en el SII las facturas de compra pendientes de acuse (plazo legal: 8 días desde la recepción).',
    regla: { tipo: 'mensual', mes: 0, dia: 'ultimo', habil: true },
    escalones: [{ id: 'T', nombre: 'Revisar acuses', offset: -2, canal: 'INTERNO', a_quien: 'RESPONSABLE', texto: 'Revisar y dar acuse de recibo a las facturas de compra pendientes de {periodo}.' }],
    sin_recordatorio: 'Las facturas quedan aceptadas sin revisión.', sin_respuesta: ''
  }),
  P({
    clave: 'NOTIFICACIONES_SII', depto: 'CONTABILIDAD', orden: 6, tipo: 'INTERNO', fuente: 'interno', proceso: 'SRV-CON-13',
    nombre: 'Revisión de notificaciones del SII',
    descripcion: 'Revisar las notificaciones y anotaciones vigentes y marcar las resueltas.',
    regla: { tipo: 'mensual', mes: 0, dia: 'ultimo', habil: true },
    escalones: [{ id: 'T', nombre: 'Revisar notificaciones', offset: -1, canal: 'INTERNO', a_quien: 'RESPONSABLE', texto: 'Revisar las notificaciones del SII vigentes y marcar las que se resolvieron.' }],
    sin_recordatorio: 'Giros, bloqueos de timbraje o multas a los clientes sin aviso.', sin_respuesta: ''
  }),
  P({
    clave: 'RENTA_F22', depto: 'CONTABILIDAD', orden: 7, tipo: 'CLIENTE', fuente: 'clientes_contabilidad', proceso: 'SRV-CON-11',
    nombre: 'Declaración de Renta (F22)',
    descripcion: 'Pedir a los clientes los antecedentes para la Renta. Vence el 30 de abril.',
    regla: { tipo: 'anual', mes: 4, dia: 30, habil: true },
    escalones: [
      { id: 'R1', nombre: 'Pedir antecedentes', offset: -22, canal: 'CORREO', a_quien: 'CLIENTE',
        asunto: 'Declaración de Renta · {empresa} · antecedentes',
        texto: 'Hola {contacto}:\n\nEstamos preparando la Declaración de Renta de {empresa}, que vence el {fecha_limite}. Por favor envíanos los antecedentes que te falten (cartolas, facturas pendientes, gastos) a más tardar en dos semanas.\n\nSaludos,\n{firma}\nHomePymes' },
      { id: 'R2', nombre: 'Faltan antecedentes', offset: -10, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, para la Renta de {empresa} (vence el {fecha_limite}) todavía nos faltan antecedentes. ¿Nos los puedes enviar esta semana?' },
      { id: 'R3', nombre: 'Últimos días', offset: -3, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, quedan {dias} días hábiles para presentar la Renta de {empresa}. Sin tus antecedentes no podemos presentarla a tiempo. ¡Escríbenos hoy!' }
    ],
    sin_recordatorio: 'La Renta se presenta fuera de plazo, con multa e intereses.',
    sin_respuesta: 'Se avisa a la jefatura cinco días antes del vencimiento.'
  }),
  P({
    clave: 'DDJJ_ANUALES', depto: 'CONTABILIDAD', orden: 8, tipo: 'INTERNO', fuente: 'interno', proceso: 'SRV-CON-11',
    nombre: 'Declaraciones juradas anuales',
    descripcion: 'Declaraciones juradas de marzo (sueldos, honorarios y otras).',
    regla: { tipo: 'anual', mes: 3, dia: 'ultimo', habil: true },
    escalones: [
      { id: 'T1', nombre: 'Preparar declaraciones', offset: -15, canal: 'INTERNO', a_quien: 'RESPONSABLE', texto: 'Preparar las declaraciones juradas anuales de los clientes.' },
      { id: 'T2', nombre: 'Presentar declaraciones', offset: -5, canal: 'INTERNO', a_quien: 'RESPONSABLE', texto: 'Presentar las declaraciones juradas que falten.' }
    ],
    sin_recordatorio: 'Multas por declaraciones fuera de plazo.', sin_respuesta: ''
  }),

  // =============================== RECURSOS HUMANOS ===============================
  P({
    clave: 'ASISTENCIA', depto: 'RRHH', orden: 1, tipo: 'CLIENTE', fuente: 'asistencia', proceso: 'SRV-RHH-01',
    nombre: 'Asistencia y novedades del mes',
    descripcion: 'Clientes con remuneraciones que todavía no envían la asistencia y las novedades del mes (horas extra, bonos, licencias, ingresos y salidas).',
    regla: { tipo: 'mensual', mes: 0, dia: 'ultimo', habil: true },
    escalones: [
      { id: 'R1', nombre: 'Pedir asistencia', offset: -5, canal: 'CORREO', a_quien: 'CLIENTE',
        asunto: 'Asistencia y novedades de {periodo} · {empresa}',
        texto: 'Hola {contacto}:\n\nEstamos preparando las remuneraciones de {periodo}. ¿Nos envías la asistencia y las novedades del mes (horas extra, bonos, licencias, ingresos y salidas) a más tardar el {fecha_limite}? Así las liquidaciones salen a tiempo.\n\nSaludos,\n{firma}\nHomePymes' },
      { id: 'R2', nombre: 'Hoy es el cierre', offset: 0, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, hoy {fecha_limite} cerramos la asistencia de {periodo}. ¿Nos envías la asistencia y las novedades de {empresa}? Así las liquidaciones salen a tiempo.' },
      { id: 'R3', nombre: 'Llamada', offset: 1, canal: 'LLAMADA', a_quien: 'CLIENTE',
        texto: 'Llamar a {contacto} de {empresa}: falta la asistencia de {periodo}. Preguntar cuándo la envía y si hubo ingresos, salidas o licencias.' },
      { id: 'R4', nombre: 'Liquidaciones en riesgo', offset: 2, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, todavía no recibimos la asistencia de {periodo} de {empresa}. Sin ella, las liquidaciones se atrasan. Si nos autorizas, podemos liquidar con la asistencia del mes anterior.' }
    ],
    sin_recordatorio: 'Las liquidaciones se atrasan y no queda constancia de que se pidió la información.',
    sin_respuesta: 'Se avisa a la jefatura. Con autorización del cliente, se liquida con la asistencia del mes anterior.'
  }),
  P({
    clave: 'PREVIRED', depto: 'RRHH', orden: 2, tipo: 'CLIENTE', fuente: 'previred', proceso: 'SRV-RHH-01',
    nombre: 'Pago de cotizaciones (Previred)',
    descripcion: 'Clientes con cotizaciones del mes por pagar. La declaración vence el día 10 y el pago el 13 (fecha fija).',
    regla: { tipo: 'mensual', mes: 1, dia: 13, habil: false },
    escalones: [
      { id: 'R1', nombre: 'Monto a pagar', offset: -3, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, las cotizaciones de {periodo} de {empresa} suman {monto} y deben pagarse a más tardar el {fecha_limite}. Envíanos el comprobante del depósito para dejarlas pagadas en Previred.' },
      { id: 'R2', nombre: 'Mañana vence', offset: -1, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, mañana {fecha_limite} vence el pago de las cotizaciones de {periodo} de {empresa} ({monto}). ¿Ya hiciste el depósito?' },
      { id: 'R3', nombre: 'Último día', offset: 0, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, hoy es el último día para pagar las cotizaciones de {periodo} de {empresa} ({monto}) sin intereses. Si ya depositaste, envíanos el comprobante.' }
    ],
    sin_recordatorio: 'Cotizaciones impagas sin aviso al cliente.',
    sin_respuesta: 'Desde el día siguiente hay intereses y multas (DNP). Pasa a «Imposiciones impagas» y se avisa a la jefatura.'
  }),
  P({
    clave: 'LRE', depto: 'RRHH', orden: 3, tipo: 'INTERNO', fuente: 'interno', proceso: 'SRV-RHH-01',
    nombre: 'Libro de remuneraciones electrónico (LRE)',
    descripcion: 'Cargar el LRE de todos los clientes en la Dirección del Trabajo. Vence el día 15 del mes siguiente.',
    regla: { tipo: 'mensual', mes: 1, dia: 15, habil: true },
    escalones: [
      { id: 'T1', nombre: 'Cargar LRE', offset: -2, canal: 'INTERNO', a_quien: 'RESPONSABLE', texto: 'Cargar el LRE de {periodo} de todos los clientes (vence el {fecha_limite}).' },
      { id: 'T2', nombre: 'Vence hoy', offset: 0, canal: 'INTERNO', a_quien: 'JEFATURA', texto: 'Hoy vence el LRE de {periodo}: confirmar que esté cargado para todos los clientes.' }
    ],
    sin_recordatorio: 'Multa de la Dirección del Trabajo al cliente.', sin_respuesta: ''
  }),
  P({
    clave: 'RLE', depto: 'RRHH', orden: 4, tipo: 'INTERNO', fuente: 'interno', proceso: 'SRV-RHH-02',
    nombre: 'Registro de contratos y términos (RLE)',
    descripcion: 'Registrar en la DT los contratos (15 días hábiles) y los términos (3 a 10 días hábiles) pendientes.',
    regla: { tipo: 'mensual', mes: 0, dia: 'ultimo', habil: true },
    escalones: [
      { id: 'T1', nombre: 'Revisar RLE', offset: -5, canal: 'INTERNO', a_quien: 'RESPONSABLE', texto: 'Revisar y cargar en la DT los contratos y finiquitos pendientes de registro ({pendientes}).' },
      { id: 'T2', nombre: 'Cierre del mes', offset: 0, canal: 'INTERNO', a_quien: 'JEFATURA', texto: 'Cierre del mes: confirmar que no queden contratos ni finiquitos sin registrar en la DT ({pendientes}).' }
    ],
    sin_recordatorio: 'Multa de la DT al cliente por registro fuera de plazo.', sin_respuesta: ''
  }),
  P({
    clave: 'PACTO_HORAS_EXTRA', depto: 'RRHH', orden: 5, tipo: 'CLIENTE', fuente: 'manual', proceso: 'SRV-RHH-08',
    nombre: 'Vencimiento de pacto de horas extra',
    descripcion: 'Los pactos de horas extra duran 3 meses. Se agregan en el calendario con la fecha de vencimiento de cada trabajador.',
    regla: { tipo: 'evento' },
    escalones: [
      { id: 'R1', nombre: 'Pacto por vencer', offset: -10, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, el pacto de horas extra de {trabajador} en {empresa} vence el {fecha_limite}. ¿Lo renovamos? Sin pacto vigente no se pueden pagar horas extra.' },
      { id: 'R2', nombre: 'Últimos días', offset: -3, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, recordatorio: el pacto de horas extra de {trabajador} vence el {fecha_limite}. Confírmanos si lo renovamos.' }
    ],
    sin_recordatorio: 'Horas extra trabajadas sin pacto vigente.', sin_respuesta: 'Se avisa al cliente que no se pueden pagar horas extra sin renovar el pacto.'
  }),

  // =============================== PREVENCIÓN DE RIESGOS ===============================
  P({
    clave: 'EXAMEN_OCUPACIONAL', depto: 'PREVENCION', orden: 1, tipo: 'CLIENTE', fuente: 'manual', proceso: 'SRV-PRV-03',
    nombre: 'Examen ocupacional agendado',
    descripcion: 'Se agrega en el calendario cada examen agendado (trabajador, hora y lugar); el día anterior sale el recordatorio.',
    regla: { tipo: 'evento' },
    escalones: [
      { id: 'R1', nombre: 'Examen mañana', offset: -1, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, te recordamos que mañana {fecha_limite} a las {hora} {trabajador} tiene su examen ocupacional en {lugar}. Debe llegar 15 minutos antes, con su cédula de identidad.' }
    ],
    sin_recordatorio: 'El trabajador no asiste y hay que reagendar.', sin_respuesta: 'Llamada el mismo día del examen.'
  }),
  P({
    clave: 'COMITE_PARITARIO', depto: 'PREVENCION', orden: 2, tipo: 'INTERNO', fuente: 'interno', proceso: 'SRV-PRV-07',
    nombre: 'Reunión mensual de comités paritarios',
    descripcion: 'Coordinar la reunión mensual de los comités paritarios de los clientes asesorados (DS 44).',
    regla: { tipo: 'mensual', mes: 0, dia: 'ultimo', habil: true },
    escalones: [{ id: 'T', nombre: 'Coordinar reuniones', offset: -5, canal: 'INTERNO', a_quien: 'RESPONSABLE', texto: 'Coordinar y registrar las reuniones del comité paritario de {periodo}.' }],
    sin_recordatorio: 'Incumplimiento ante una fiscalización.', sin_respuesta: ''
  }),
  P({
    clave: 'VISITAS_TERRENO', depto: 'PREVENCION', orden: 3, tipo: 'INTERNO', fuente: 'interno', proceso: 'SRV-PRV-05',
    nombre: 'Programa de visitas a terreno',
    descripcion: 'Programar las visitas a terreno del mes con cada cliente.',
    regla: { tipo: 'mensual', mes: 0, dia: 5, habil: true },
    escalones: [{ id: 'T', nombre: 'Programar visitas', offset: -2, canal: 'INTERNO', a_quien: 'RESPONSABLE', texto: 'Programar las visitas a terreno de {periodo} y avisar a los clientes.' }],
    sin_recordatorio: 'Visitas sin coordinar y clientes sin asesoría en terreno.', sin_respuesta: ''
  }),
  P({
    clave: 'DOCUMENTACION_ANUAL', depto: 'PREVENCION', orden: 4, tipo: 'INTERNO', fuente: 'interno', proceso: 'SRV-PRV-07',
    nombre: 'Revisión anual de documentación (DS 44)',
    descripcion: 'Revisar la matriz de riesgos y el reglamento interno de cada cliente.',
    regla: { tipo: 'anual', mes: 12, dia: 15, habil: true },
    escalones: [
      { id: 'T1', nombre: 'Planificar revisión', offset: -15, canal: 'INTERNO', a_quien: 'RESPONSABLE', texto: 'Planificar la revisión anual de matrices de riesgo y reglamentos internos.' },
      { id: 'T2', nombre: 'Cerrar revisión', offset: -5, canal: 'INTERNO', a_quien: 'RESPONSABLE', texto: 'Cerrar la revisión anual de la documentación de los clientes.' }
    ],
    sin_recordatorio: 'Documentación desactualizada ante una fiscalización.', sin_respuesta: ''
  }),

  // =============================== MARKETING CORPORATIVO ===============================
  P({
    clave: 'PLAN_CONTENIDOS', depto: 'MARKETING', orden: 1, tipo: 'INTERNO', fuente: 'interno', proceso: 'SRV-MKT-01',
    nombre: 'Plan de contenidos del mes siguiente',
    descripcion: 'Dejar listo el calendario de publicaciones del mes siguiente.',
    regla: { tipo: 'mensual', mes: 0, dia: 'ultimo', habil: true },
    escalones: [{ id: 'T', nombre: 'Preparar plan', offset: -5, canal: 'INTERNO', a_quien: 'RESPONSABLE', texto: 'Preparar el plan de contenidos del mes siguiente.' }],
    sin_recordatorio: 'Publicaciones improvisadas o sin frecuencia.', sin_respuesta: ''
  }),
  P({
    clave: 'METRICAS_REDES', depto: 'MARKETING', orden: 2, tipo: 'INTERNO', fuente: 'interno', proceso: 'SRV-MKT-01',
    nombre: 'Métricas de redes del mes',
    descripcion: 'Registrar las métricas del mes (alcance, seguidores, contactos generados) para el reporte.',
    regla: { tipo: 'mensual', mes: 1, dia: 5, habil: true },
    escalones: [{ id: 'T', nombre: 'Registrar métricas', offset: -1, canal: 'INTERNO', a_quien: 'RESPONSABLE', texto: 'Registrar las métricas de redes de {periodo} para el reporte mensual.' }],
    sin_recordatorio: 'El reporte del área queda sin datos.', sin_respuesta: ''
  }),

  // =============================== FACTURACIÓN Y COBRANZAS ===============================
  P({
    clave: 'FACTURA_HONORARIOS', depto: 'COBRANZAS', orden: 1, tipo: 'CLIENTE', fuente: 'cobranza_facturas', proceso: '',
    nombre: 'Factura de honorarios por cobrar',
    descripcion: 'Facturas de HomePymes a sus clientes que no están pagadas (matriz Cobranza de honorarios).',
    regla: { tipo: 'evento' },
    escalones: [
      { id: 'R1', nombre: 'Por vencer', offset: -3, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, te recordamos que la factura N° {n_factura} de HomePymes por {monto} vence el {fecha_limite}. ¡Gracias por tu pago oportuno!' },
      { id: 'R2', nombre: 'Vence hoy', offset: 0, canal: 'CORREO', a_quien: 'CLIENTE',
        asunto: 'Factura N° {n_factura} · vence hoy',
        texto: 'Hola {contacto}:\n\nTe recordamos que hoy {fecha_limite} vence la factura N° {n_factura} de HomePymes por {monto}. Si ya realizaste el pago, por favor envíanos el comprobante.\n\nSaludos,\n{firma}\nHomePymes' },
      { id: 'R3', nombre: 'Vencida 1 semana', offset: 5, canal: 'WHATSAPP', a_quien: 'CLIENTE',
        texto: 'Hola {contacto}, la factura N° {n_factura} por {monto} venció el {fecha_limite}. ¿Nos confirmas la fecha de pago?' },
      { id: 'R4', nombre: 'Llamada de cobranza', offset: 10, canal: 'LLAMADA', a_quien: 'CLIENTE',
        texto: 'Llamar a {contacto} de {empresa}: factura N° {n_factura} por {monto}, vencida desde el {fecha_limite}. Acordar fecha de pago.' }
    ],
    sin_recordatorio: 'Cartera vencida sin gestión.',
    sin_respuesta: 'A los 30 días se avisa a la jefatura; a los 60 se evalúa suspender el servicio.'
  }),
  P({
    clave: 'REVISION_CARTERA', depto: 'COBRANZAS', orden: 2, tipo: 'INTERNO', fuente: 'interno', proceso: '',
    nombre: 'Revisión de cartera',
    descripcion: 'Antes del cierre: revisar la cartera vencida y registrar los pagos recibidos.',
    regla: { tipo: 'mensual', mes: 0, dia: 'ultimo', habil: true },
    escalones: [{ id: 'T', nombre: 'Revisar cartera', offset: -2, canal: 'INTERNO', a_quien: 'RESPONSABLE', texto: 'Registrar los pagos del mes y revisar la cartera vencida de {periodo}.' }],
    sin_recordatorio: 'Pagos sin registrar y cobranza desactualizada.', sin_respuesta: ''
  })
];

const FUENTES = ['iva_por_pagar', 'convenio_cuotas', 'asistencia', 'previred', 'cobranza_facturas', 'clientes_contabilidad', 'manual', 'interno'];
const CANALES = ['WHATSAPP', 'CORREO', 'LLAMADA', 'INTERNO'];

module.exports = { PROPUESTA, FUENTES, CANALES };
