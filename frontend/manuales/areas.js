/**
 * Manuales de las áreas (departamentos): Contabilidad, Recursos Humanos,
 * Prevención de riesgos, Marketing corporativo y Facturación y Cobranzas.
 * Comparten la forma (Hoy, Agenda, Trabajo, Reportes, Equipo, Ajustes): el
 * texto común se escribe una vez y cada área suma lo suyo. Las capturas son
 * de cada área, con la empresa de demostración (datos ficticios).
 */
(function () {
  'use strict';

  var AREAS = {
    contabilidad: { modulo: 'dep_contabilidad', nombre: 'Contabilidad', corto: 'Contabilidad', registra: 'Tomás Fuentes', jefe: 'Daniela Morales',
      matriz: 'Informe y pago de IVA', matrices: true, reporta: true, whatsappEjemplo: false, interno: false,
      clientes: 'IVA, F29, facturación, contabilización, acuses y convenios' },
    rrhh: { modulo: 'dep_rrhh', nombre: 'Recursos Humanos', corto: 'RR.HH.', registra: 'Ignacio Vera', jefe: 'Camila Rojas',
      matriz: 'Remuneraciones', matrices: true, reporta: true, whatsappEjemplo: true, interno: true,
      clientes: 'remuneraciones, imposiciones, contratos, finiquitos y plataformas' },
    prevencion: { modulo: 'dep_prevencion', nombre: 'Prevención de riesgos', corto: 'Prevención', registra: 'Sofía Lagos', jefe: 'Sofía Lagos',
      matrices: false, reporta: true, soloJefe: true, whatsappEjemplo: true, clientes: 'exámenes, comités paritarios, visitas y capacitaciones' },
    marketing: { modulo: 'dep_marketing', nombre: 'Marketing corporativo', corto: 'Marketing', registra: 'Matías Pino', jefe: 'Matías Pino',
      matrices: false, reporta: true, soloJefe: true, sinClientes: true, clientes: 'publicaciones, campañas y fechas del área' },
    cobranzas: { modulo: 'dep_cobranzas', nombre: 'Facturación y Cobranzas', corto: 'Facturación', registra: 'Andrea Núñez', jefe: 'Andrea Núñez',
      matriz: 'Cobranza', matrices: true, reporta: false, soloJefe: true, whatsappEjemplo: true, clientes: 'el cobro de las facturas de honorarios y el informe de plataformas que envía RR.HH.' }
  };

  var COMUNES = [
    { p: '¿SIGSO le manda los mensajes al cliente por su cuenta?', r: ['No. SIGSO prepara el mensaje (con el nombre, el monto y la fecha) y deja el botón listo, pero lo **envías tú** desde el WhatsApp o el correo del área. Así el cliente siempre recibe el mensaje de una persona conocida y SIGSO no tiene costo de envío.'] },
    { p: 'Registré un envío por error, ¿cómo lo deshago?', r: ['Justo después de registrar aparece abajo un aviso con el botón [[Deshacer]] (dura unos segundos).', 'Si ya pasó, entra a **Agenda › Recordatorios enviados**, busca la fila y toca el ícono de la papelera: solo se pueden deshacer los registros que hiciste tú.'] },
    { p: '¿Por qué un cliente no aparece en Hoy?', r: [['Ya cumplió (se anotó «Ya cumplió» o el dato ya está en la matriz, por ejemplo la fecha de pago).', 'Todavía no le toca: mira **Próximos 14 días** o el **Calendario**.', 'Le falta el dato que origina el recordatorio en la matriz (por ejemplo, el monto a pagar).']] },
    { p: 'El cliente no tiene teléfono o correo, ¿qué hago?', r: ['La fila lo avisa en ámbar («sin teléfono»). Pide al administrador que complete el contacto del cliente en el catálogo de clientes; mientras, puedes copiar el mensaje con [[Ver mensaje › Copiar]] y enviarlo por el medio que tengas.'] },
    { p: '¿Quién puede cambiar las fechas y los textos de los recordatorios?', r: ['La **jefatura del área** (y el administrador), en **Ajustes › Recordatorios y fechas**. Los cambios valen desde ese momento y quedan en el historial de cada obligación.'] }
  ];

  function caps(id, a) {
    var M = a.modulo, out = [];
    // 1. Orientarse --------------------------------------------------------------------------
    out.push({ id: 'orientarse', titulo: 'Entra a ' + a.nombre + ' y oriéntate', ruta: '#/' + M + '/hoy',
      intro: ['Todo lo del área vive en un solo módulo de la barra lateral. En dos minutos sabrás dónde está cada cosa.'],
      pasos: [
        { titulo: 'Abre el área desde la barra', img: 'orientarse',
          texto: ['En la columna de íconos de la izquierda, bajo **Áreas**, toca **' + a.corto + '** ((1)) (si no ves los nombres, pasa el mouse por encima). Al lado se abre el menú del área.',
            'Arriba está el **nombre del área** ((2)), para qué sirve y, si hay algo esperando, cuánto ((3)). Con [[Manual de uso]] ((4)) vuelves a este manual cuando quieras.'],
          marcas: [{ n: 1, t: 'El área en la columna de íconos, marcada en azul.' }, { n: 2, t: 'Dónde estás y para qué sirve.' },
            { n: 3, t: 'Cuánto te espera hoy, escrito: atrasados, para hoy o por revisar.' }, { n: 4, t: 'Este manual (también con la tecla F1).' },
            { n: 5, t: 'El menú del área, en tarjetas.' }, { n: 6, t: 'Buscar en el menú del área.' }] },
        { titulo: 'Abre el menú de a una tarjeta', img: 'menu',
          texto: ['Cada **tarjeta** es una parte del área. Al entrar están cerradas: toca una para ver sus secciones y se cierra la que estaba abierta.',
            [ '**Hoy**: los recordatorios y tareas del día.', '**Agenda**: el calendario, lo que ya se recordó y la historia de cada cliente.' ]
              .concat(a.matrices ? ['**Trabajo**: las matrices del área (las planillas de siempre, con las mismas columnas).' + (M === 'dep_contabilidad' ? ' Adentro, **Convenios TGR** se abre como una bandeja.' : '')] : [])
              .concat(a.reporta ? ['**Reportes**: el reporte mensual que va a Administración y los informes del área.'] : [])
              .concat(['**Equipo** (solo jefatura): qué está haciendo cada persona.', '**Ajustes**: las fechas, los recordatorios y sus mensajes.'])],
          marcas: [{ n: 1, t: '**Hoy**: una tarjeta que lleva directo, con lo que espera.' }, { n: 2, t: 'Una tarjeta abierta: tócala otra vez para cerrarla.' }, { n: 3, t: 'Cuántas secciones tiene.' }, { n: 4, t: 'Sus secciones: toca una para abrirla.' }],
          consejo: ['La tarjeta donde estás queda marcada en azul aunque esté cerrada, así no pierdes de vista dónde estás. Si llegas por un enlace, el menú se abre solo hasta esa pantalla.'] }].concat(M === 'dep_contabilidad' ? [
        { titulo: 'Convenios TGR: la bandeja de adentro', img: 'tgr-menu',
          texto: ['En **Trabajo**, la fila **Convenios TGR** ((1)) no abre una pantalla: abre su **bandeja** ((2)) con **Matriz de convenios**, **Seguimiento de cuotas** y **Recibir desde la TGR**. Toca la que necesitas.'],
          marcas: [{ n: 1, t: 'Convenios TGR: ábrela para ver lo de adentro.' }, { n: 2, t: 'La bandeja: las tres pantallas de los convenios.' }] }] : []).concat([
        { titulo: 'Deja a mano lo que usas todos los días', img: 'estrella',
          texto: ['Abre la pantalla y toca la **estrella** ((1)) junto al nombre del área. Queda en **Mis atajos**, en Inicio, y llegas a ella con **Alt + 1** a **Alt + 8** desde cualquier parte.'],
          marcas: [{ n: 1, t: 'La estrella: agrega la pantalla abierta a tus atajos (amarilla si ya está).' }],
          consejo: ['Tus atajos se guardan en tu cuenta: te siguen aunque entres desde otro computador.'] }
      ]) });

    // 2. Hoy -----------------------------------------------------------------------------------
    var pasosHoy = [
      { titulo: 'Lee la pantalla Hoy de arriba abajo', img: 'hoy',
        texto: ['**Hoy** reúne lo que el área tiene que recordar o hacer en el día, con el mensaje ya escrito (nombre del cliente, monto y fecha).',
          'SIGSO **no envía nada por su cuenta**: tú lo mandas desde el WhatsApp o el correo del área y SIGSO deja el registro de quién, cuándo y por qué medio.'],
        marcas: [{ n: 1, t: 'El próximo vencimiento, con cuenta regresiva en días hábiles. Se pone ámbar con 3 días o menos y rojo el último día.' },
          { n: 2, t: 'Los cuatro contadores. Tócalos para ver solo eso: para hoy, atrasados, sin respuesta o enviados hoy.' },
          { n: 3, t: 'Cada obligación: qué es, de qué mes, cuándo vence y cuántos clientes ya cumplieron.' },
          { n: 4, t: 'Un cliente con su recordatorio del día, listo para enviar.' },
          { n: 5, t: 'Lo que viene en los próximos 14 días.' },
          { n: 6, t: 'Agregar una fecha propia del área (reunión, cierre, visita…).' }] },
      { titulo: 'Entiende cada recordatorio', img: 'hoy-fila',
        texto: ['Cada fila es **un cliente y un recordatorio**. Se lee de izquierda a derecha:'],
        marcas: [{ n: 1, t: 'El cliente y su contacto (teléfono y correo del catálogo de clientes).' },
          { n: 2, t: 'Su estado: **Para hoy**, **Atrasado** (era para un día anterior), **Sin respuesta** (se le recordó y no contestó) o **Respondió**.' },
          { n: 3, t: 'Qué recordatorio toca y por qué medio (correo, WhatsApp, llamada o tarea interna).' },
          { n: 4, t: 'El comienzo del mensaje que se va a enviar.' },
          { n: 5, t: 'El botón para enviarlo: [[Copiar correo]], [[WhatsApp]], [[Registrar llamada]] o [[Hecho]], según el medio.' },
          { n: 6, t: '[[Ver mensaje]]: el texto completo, para leerlo o ajustarlo.' },
          { n: 7, t: '[[Respuesta…]]: lo que contestó el cliente.' }],
        consejo: ['Los recordatorios suben de tono solos: primero un aviso por correo, después WhatsApp, y el último día un mensaje más directo. Tú solo envías el que toca hoy.'] },
      { titulo: 'Envía un recordatorio por correo', img: 'hoy-correo',
        texto: [['Toca [[Copiar correo]]: se copian el asunto y el mensaje.', 'Abre el correo del área, pega el texto y envíalo a la dirección que aparece en la fila.', 'Vuelve a SIGSO: la fila pregunta **«¿Lo enviaste?»** ((1)). Toca [[Sí, registrar]] ((2)).']],
        marcas: [{ n: 1, t: 'SIGSO pregunta si ya lo enviaste, con el correo del cliente.' }, { n: 2, t: 'Confirma: queda registrado quién lo envió, cuándo y por correo.' }, { n: 3, t: 'Si todavía no lo envías, [[Todavía no]] deja la fila como estaba.' }],
        ojo: ['Si no confirmas con [[Sí, registrar]], el recordatorio sigue apareciendo como pendiente y cuenta como no enviado en el reporte del mes.'] }
    ];
    if (a.whatsappEjemplo) pasosHoy.push({ titulo: 'Envía un recordatorio por WhatsApp', img: 'hoy-whatsapp',
      texto: [['Toca [[WhatsApp]] ((1)): se abre WhatsApp (en el celular o en WhatsApp Web) con el número del cliente y el mensaje ya escrito.', 'Envíalo en WhatsApp.', 'SIGSO lo registra solo como enviado por WhatsApp y muestra un aviso abajo ((2)).']],
      marcas: [{ n: 1, t: 'Abre WhatsApp con el mensaje listo para este cliente.' }, { n: 2, t: 'El aviso de registro, con [[Deshacer]] por si el mensaje no salió.' }],
      ojo: ['Si al final no enviaste el mensaje, toca [[Deshacer]] en ese aviso (dura unos segundos), o después deshazlo desde **Agenda › Recordatorios enviados**.'] });
    else pasosHoy.push({ titulo: 'Envía un recordatorio por WhatsApp', texto: ['Cuando el recordatorio del día es por WhatsApp, el botón principal dice [[WhatsApp]]: abre WhatsApp (en el celular o en WhatsApp Web) con el número del cliente y el mensaje escrito. Envíalo y SIGSO lo registra solo, con un aviso abajo que trae [[Deshacer]] por si no salió.', 'También puedes abrir WhatsApp desde [[Ver mensaje]] con el botón [[Abrir WhatsApp]] (paso siguiente).'] });
    pasosHoy.push(
      { titulo: 'Revisa o ajusta el mensaje antes de enviarlo', img: 'hoy-mensaje',
        texto: ['Toca [[Ver mensaje]] en la fila: se abre el mensaje completo a la derecha. Puedes cambiar el texto antes de enviarlo; lo que se registra es el texto final.'],
        marcas: [{ n: 1, t: 'A quién va, sus datos de contacto y qué recordatorio es.' }, { n: 2, t: 'El asunto (solo en los correos).' }, { n: 3, t: 'El mensaje, editable.' },
          { n: 4, t: '[[Copiar]]: copia el texto para pegarlo en el correo o chat.' }, { n: 5, t: '[[Abrir WhatsApp]]: lo abre con este texto y lo registra.' }, { n: 6, t: '[[Registrar como enviado]]: si ya lo mandaste por otro medio.' }] },
      { titulo: 'Anota lo que respondió el cliente', img: 'hoy-respuesta',
        texto: ['En la fila, abre [[Respuesta…]] ((1)) y elige lo que contestó el cliente. SIGSO te deja escribir una nota opcional (por ejemplo, «paga el viernes»).',
          [ '**Confirmó**: dijo que lo hará. Se le sigue recordando en las fechas que vienen.', '**Ya cumplió**: lo hizo. **Cierra** el recordatorio: no se le vuelve a recordar este mes.' + (a.modulo === 'dep_rrhh' ? ' En el pago de imposiciones, además, anota sola la fecha de pago en Remuneraciones.' : ''),
            '**Pidió plazo**: queda anotado para el seguimiento.', '**No contesta**: queda como sin respuesta; si se acumula, avisa a la jefatura.', '**No corresponde**: este mes no aplica a ese cliente. También cierra el recordatorio.' ]],
        marcas: [{ n: 1, t: 'La respuesta del cliente.' }] }
    );
    if (a.interno) pasosHoy.push({ titulo: 'Marca las tareas internas', img: 'hoy-interno',
      texto: ['Algunas filas no son para un cliente sino para el área (por ejemplo, enviar un informe a otra área). Se reconocen porque dicen **Tarea interna** ((1)). Cuando la hagas, toca [[Hecho]] ((2)).'],
      marcas: [{ n: 1, t: 'Tarea interna del área: qué hay que hacer.' }, { n: 2, t: '[[Hecho]] la marca como hecha, con tu nombre y la hora.' }] });
    pasosHoy.push({ titulo: 'Agrega una fecha propia del área', img: 'agregar-fecha',
      texto: ['Para que una fecha importante no dependa de la memoria (una reunión, un cierre, una visita a terreno), toca [[Agregar fecha]] en Hoy o en el Calendario.',
        [ 'Elige **Qué es** ((1)): una fecha del área o un vencimiento con recordatorios al cliente.', 'Escribe el título, el día y, si quieres, la hora y el cliente ((2)).', 'Toca [[Agregar]] ((3)): aparece en el Calendario y, cuando llegue, en Hoy.' ]],
      marcas: [{ n: 1, t: 'Qué tipo de fecha es.' }, { n: 2, t: 'Los datos de la fecha.' }, { n: 3, t: 'Guardar en el calendario.' }] });
    if (a.sinClientes) pasosHoy = [pasosHoy[0], { titulo: 'Marca las tareas internas', texto: ['Las tareas del área (por ejemplo, el plan de contenidos del mes o las métricas de redes) aparecen en Hoy cuando les toca, con la etiqueta **Tarea interna**. Cuando la hagas, toca [[Hecho]]: queda con tu nombre y la hora.'] }, pasosHoy[pasosHoy.length - 1]];
    out.push({ id: 'hoy', titulo: a.sinClientes ? 'Hoy: las tareas y fechas del día' : 'Hoy: los recordatorios del día', ruta: '#/' + M + '/hoy',
      intro: ['Empieza el día aquí. En pocos minutos dejas enviados los recordatorios a los clientes y marcadas las tareas del área.'], pasos: pasosHoy });

    // 3. Agenda ---------------------------------------------------------------------------------
    var agenda = {
      intro: ['La Agenda muestra el mes completo y todo lo que ya se recordó. Sirve para planificar y para responder «¿a este cliente se le avisó?».'],
      pasos: [
        { titulo: 'Mira el mes en el Calendario', img: 'calendario',
          texto: ['En el menú, toca **Agenda › Calendario**. Cada día muestra sus vencimientos y recordatorios, con el color de su tipo.'],
          marcas: [{ n: 1, t: 'Cambia de mes con las flechas.' }, { n: 2, t: 'Qué significa cada color: vencimiento, recordatorio, escalamiento, tarea interna, fecha del área, cita de cliente y feriado.' }, { n: 3, t: 'Un día con cosas: tócalo para ver el detalle.' }, { n: 4, t: '[[Agregar fecha]] para sumar una fecha propia.' }] },
        { titulo: 'Revisa lo que ya se recordó', img: 'enviados',
          texto: ['En **Agenda › Recordatorios enviados** está cada mensaje registrado: a quién, por qué medio, quién lo envió y qué respondió el cliente.'],
          marcas: [{ n: 1, t: 'Filtra por mes, por obligación o busca un cliente.' }, { n: 2, t: 'El resumen del mes: cuántos recordatorios, por qué medio y cuántas respuestas.' }, { n: 3, t: 'Cada registro, con la fecha, el cliente, el medio y quién lo envió. [[Mensaje]] muestra el texto que se mandó.' }, { n: 4, t: '[[Excel]] descarga lo que estás viendo.' }],
          consejo: ['La papelera al final de una fila deshace un registro tuyo (por ejemplo, si lo marcaste por error).'] },
        { titulo: 'Consulta todo lo de un cliente', img: 'por-cliente',
          texto: ['En **Agenda › Por cliente**, elige el cliente y toca [[Ver]]. Aparecen su contacto, lo que tiene pendiente y la historia de recordatorios y respuestas, con fechas.'],
          marcas: [{ n: 1, t: 'Elige el cliente.' }, { n: 2, t: 'Su contacto.' }, { n: 3, t: 'Su historia: qué se le recordó, cuándo, por qué medio y qué respondió.' }],
          consejo: ['Úsalo antes de llamar a un cliente: en segundos sabes qué se le ha dicho y qué contestó.'] }
      ] };
    if (a.sinClientes) agenda.pasos = agenda.pasos.slice(0, 1);
    out.push(Object.assign({ id: 'agenda', titulo: a.sinClientes ? 'Agenda: el calendario del área' : 'Agenda: el calendario y la historia de cada cliente', ruta: '#/' + M + '/agenda:cal' }, agenda));

    // 4. Trabajo (matrices) -------------------------------------------------------------------
    if (a.matrices) out.push({ id: 'trabajo', titulo: 'Trabajo: las matrices del área', ruta: '#/' + M + '/inicio',
      intro: ['Las matrices son las planillas del área dentro de SIGSO, con las mismas columnas. Lo que se anota aquí alimenta la Agenda, los reportes y los indicadores del área.'],
      pasos: [
        { titulo: 'Abre «Todo el trabajo»', img: 'todo-el-trabajo',
          texto: ['En el menú, toca **Trabajo › Todo el trabajo**. Ves todas las matrices del área agrupadas por cómo se trabajan, con lo que falta en el mes.'],
          marcas: [{ n: 1, t: 'El mes que estás viendo (cámbialo con las flechas).' }, { n: 2, t: 'El reporte mensual del área: en qué paso va.' }, { n: 3, t: '**Proceso mensual**: se trabajan todos los meses, cliente por cliente.' }, { n: 4, t: 'Una matriz: cuántas filas tiene el mes, cuántas faltan y una barra de avance. Tócala para abrirla.' }, { n: 5, t: '**Archivo**: matrices que ya no se usan; quedan para consulta.' }],
          consejo: ['Las cinco matrices que más usa el área también están directo en el menú, bajo **Trabajo**.'] },
        { titulo: 'Conoce la pantalla de una matriz', img: 'matriz',
          texto: ['Al abrir una matriz (en el ejemplo, **' + a.matriz + '**) ves la planilla del mes con todas sus columnas.'],
          marcas: [{ n: 1, t: 'El mes y las flechas para cambiarlo.' }, { n: 2, t: '[[Agregar fila]]: un cliente o un requerimiento nuevo.' }, { n: 3, t: 'Los totales del mes: filas, sin terminar, terminadas y por liberar. Por liberar es un filtro: tócalo.' },
            { n: 4, t: 'Buscar y filtrar por situación o responsable.' }, { n: 5, t: 'La planilla. La columna **Situación** la calcula SIGSO con lo que tiene la fila.' }, { n: 6, t: 'Descargar a Excel lo que estás viendo, o ver el informe del mes de esta matriz.' }] },
        { titulo: 'Escribe en una celda', img: 'matriz-editar',
          texto: [['Haz clic en la celda ((1)) y escribe.', 'Presiona **Enter** para guardar y bajar a la fila siguiente, **Tab** para guardar y pasar a la columna siguiente, o **Esc** para cancelar.', 'Las fechas se escriben como `13-10-2026` y los montos sin puntos ni signo: `175000`.']],
          marcas: [{ n: 1, t: 'La celda que estás editando.' }],
          consejo: ['Cada cambio se guarda al momento y queda en el historial de la fila, con tu nombre y la hora: no hay botón «Guardar».'] },
        { titulo: 'Agrega una fila', img: 'matriz-nueva',
          texto: ['Toca [[Agregar fila]]. Se abre el formulario con todas las columnas de la matriz: elige el **cliente** ((1)) desde el catálogo, completa lo que tengas ((2)) y toca [[Agregar]] ((3)).'],
          marcas: [{ n: 1, t: 'El cliente, desde el catálogo (escribe parte del nombre o del RUT).' }, { n: 2, t: 'Las columnas de la matriz, con una ayuda bajo las que la necesitan.' }, { n: 3, t: '[[Agregar]]: guarda la fila nueva.' }],
          ojo: ['Si el cliente no está en el catálogo, pide al administrador que lo agregue: así sus datos (RUT, contacto) son los mismos en todas las áreas.'] },
        { titulo: 'Abre la fila completa y su historial', img: 'matriz-fila',
          texto: ['Toca el **N°** de una fila: se abre completa, columna por columna, con su **historial** de cambios (quién cambió qué y cuándo).'],
          marcas: [{ n: 1, t: 'El cliente y la situación de la fila.' }, { n: 2, t: 'Todas las columnas, para revisar o corregir.' }, { n: 3, t: 'Guardar los cambios.' }] },
        { titulo: 'Marca filas para liberarlas o anularlas', img: 'matriz-marcar',
          texto: ['Marca la casilla al inicio de una o varias filas ((1)). Arriba aparece lo que puedes hacer con ellas ((2)):',
            [ '[[Liberar]]: la persona encargada de revisar da por bueno el trabajo (solo quien libera en el área).', '[[Anular]]: la fila deja de contar en la matriz y en los reportes; queda en el historial quién la anuló.', '[[Desmarcar]]: quita las marcas.' ]],
          marcas: [{ n: 1, t: 'Casilla para marcar la fila.' }, { n: 2, t: 'Lo que puedes hacer con las filas marcadas.' }] }
      ] });

    // 5. Reportes ------------------------------------------------------------------------------
    if (a.reporta || a.matrices) out.push({ id: 'reportes', titulo: a.reporta ? 'Reportes: el reporte mensual y los informes' : 'Reportes: los informes del área', ruta: '#/' + M + (a.reporta ? '/reporte' : '/rep:informe'),
      intro: [a.matrices ? 'Cada mes el área entrega su **reporte mensual**: SIGSO calcula las cifras con lo registrado y el área solo agrega lo que las cifras no dicen. Va de la jefatura a Administración y de ahí al informe de gestión de la gerencia.' : 'Cada mes el área entrega su **reporte mensual**: lo escribe el área, lo valida la jefatura y llega a Administración, que arma el informe de gestión para la gerencia.'],
      pasos: [].concat(!a.reporta ? [] : [
        a.matrices ? { titulo: 'Prepara y envía el reporte mensual', img: 'reporte',
          texto: ['Entra a **Reportes › Reporte mensual**. El mes que se reporta es el anterior (en octubre, el de septiembre).'],
          marcas: [{ n: 1, t: 'Los tres pasos: el área lo prepara, la jefatura lo valida y Administración lo recibe. Cada paso dice quién y en qué va.' }, { n: 2, t: 'Lo más urgente y lo que va bien, en una línea.' },
            { n: 3, t: 'Los indicadores del mes, calculados por SIGSO (con su meta y el estado: en meta, vigilar, crítico).' }, { n: 4, t: '[[Guardar borrador]] y [[Enviar a Administración]] (cuando la jefatura lo valida).' }],
          consejo: ['Las cifras se actualizan solas hasta que se envía. Si algo no cuadra, corrige la matriz y vuelve al reporte: no hay que copiar números a mano.'] }
        : { titulo: 'Escribe y envía el reporte mensual', img: 'reporte',
          texto: ['Entra a **Reporte mensual** (en el menú). El mes que se reporta es el anterior. Como el área no tiene matrices, el reporte lo escribe el área:',
            [ '**Resumen del mes** (obligatorio): qué se hizo, qué cambió y cómo terminó.', '**Actividades realizadas**: una fila por actividad o servicio, con fecha y estado (el cliente es opcional). [[Agregar fila]] suma otra.', '**Dificultades y riesgos**: lo que frenó el trabajo o puede frenarlo.', 'Si la jefatura definió **metas** en Ajustes, aquí se anota su valor del mes.' ],
            'Toca [[Guardar borrador]] cuantas veces quieras; cuando esté listo, [[Enviar a Administración]].'],
          marcas: [{ n: 1, t: 'Los tres pasos: el área lo prepara, la jefatura lo valida y Administración lo recibe.' }, { n: 2, t: '[[Guardar borrador]] y [[Enviar a Administración]].' }, { n: 3, t: 'Resumen del mes (obligatorio).' }, { n: 4, t: 'Actividades realizadas, una por fila.' }, { n: 5, t: '[[Agregar fila]] para otra actividad.' }] }
      ]).concat(!a.reporta || a.soloJefe ? [] : [{ titulo: 'Valida el reporte (jefatura)', img: 'reporte-validar',
          texto: ['Cuando el área envía el reporte, le llega a la jefatura (con un aviso en la campana). Ábrelo en **Reportes › Reporte mensual**, revísalo y elige:',
            [ '[[Validar y entregar a Administración]] ((1)): queda validado con tu nombre y llega a Administración.', '[[Devolver con observaciones]] ((2)): vuelve al área con lo que hay que corregir.' ]],
          marcas: [{ n: 1, t: 'Validar y entregar a Administración.' }, { n: 2, t: 'Devolver al área con observaciones.' }, { n: 3, t: 'Los pasos: quién lo envió y cuándo.' }],
          consejo: ['Si la jefatura envía el reporte ella misma, queda validado de una vez y llega directo a Administración.'] }])
      .concat(a.matrices ? [
        { titulo: 'Saca el informe mensual de una matriz', img: 'informe',
          texto: ['En **Reportes › Informe mensual** eliges una matriz y un mes: SIGSO arma el informe del proceso (el que antes se hacía a mano), listo para descargar en **Excel** o **PDF**.'],
          marcas: [{ n: 1, t: 'Qué matriz y qué mes.' }, { n: 2, t: 'Descargar en Excel, imprimir o descargar en PDF.' }, { n: 3, t: 'El informe: totales, avance, quién hizo qué y lo pendiente.' }] },
        { titulo: 'Revisa la historia y a cada cliente', img: 'ficha',
          texto: ['Tres informes más, en **Reportes**:', [ '**Panel histórico**: cómo vienen los procesos mes a mes desde 2022 (volumen, cierre, montos y tiempos).', '**Ficha por cliente** (en la captura): todo lo de un cliente en las matrices, desde 2022. Toca un cliente para ver su historia.', '**Personas y tiempos**: quién hace qué, cuánto demora y qué quedó sin terminar.' ]],
          marcas: [{ n: 1, t: 'Busca un cliente o elígelo de la lista (con cuántos registros tiene).' }] }
      ] : []) });

    // 6. Equipo (jefatura) -----------------------------------------------------------------------
    out.push({ id: 'equipo', titulo: 'Equipo (solo jefatura)', ruta: '#/' + M + '/equipo:resumen',
      intro: ['La jefatura del área ve en **Equipo** lo que está haciendo cada persona: tareas, horas y solicitudes. Quien no es jefatura no ve esta sección.'],
      pasos: [
        { titulo: 'Mira cómo está tu equipo hoy', img: 'equipo',
          texto: ['Entra a **Equipo › Mi equipo hoy**.', [ '**Mi equipo hoy**: tareas abiertas, atrasadas, por confirmar y bloqueadas, y las horas registradas.', '**Solicitudes del equipo** y **Por persona**: lo que tiene cada uno.', '**Actividades del equipo** y **Reportes del equipo**: el detalle y los informes.' ]],
          marcas: [{ n: 1, t: 'Los totales del equipo.' }, { n: 2, t: 'Cada persona, con lo que tiene (o el aviso si no registra nada en SIGSO).' }] }
      ] });

    // 7. Ajustes ---------------------------------------------------------------------------------
    out.push({ id: 'ajustes', titulo: 'Ajustes: fechas, recordatorios y metas', ruta: '#/' + M + '/ajustes',
      intro: ['Aquí se define **qué vence, cuándo, la escalera de recordatorios y el texto de cada mensaje**. Todos lo ven; lo cambia la jefatura del área (o el administrador).'],
      pasos: [
        { titulo: 'Revisa las obligaciones del área', img: 'ajustes',
          texto: ['Cada tarjeta es una obligación: qué es, cuándo vence y la escalera de recordatorios (cuántos días hábiles antes, por qué medio y con qué mensaje).'],
          marcas: [{ n: 1, t: '[[Nueva obligación]]: un vencimiento nuevo con sus recordatorios.' }, { n: 2, t: 'Las metas del área, que se ven como indicadores en el reporte mensual.' },
            { n: 3, t: 'Una obligación: qué es y cuándo vence este mes.' }, { n: 4, t: 'Su escalera de recordatorios.' }, { n: 5, t: '[[Editar]] y [[Historial de cambios]].' }],
          ojo: ['Los cambios valen desde ese momento y quedan en el historial. Las obligaciones que nadie ha editado se actualizan solas cuando SIGSO mejora la propuesta; las que editaste se respetan.'] }
      ] });
    return out;
  }

  // Lo propio de cada área ------------------------------------------------------------------------
  var EXTRA = {
    prevencion: [{ id: 'prevencion', titulo: 'Lo propio de Prevención de riesgos', ruta: '#/dep_prevencion/agenda:cal',
      intro: ['Los exámenes ocupacionales se agendan como un vencimiento con recordatorio al cliente: SIGSO le avisa el día anterior, con la hora, el trabajador y el lugar.'],
      pasos: [
        { titulo: 'Agenda un examen ocupacional', img: 'examen',
          texto: [['Toca [[Agregar fecha]] (en Hoy o en el Calendario).', 'En **Qué es**, elige **Examen ocupacional (con recordatorios al cliente)** ((1)).', 'Completa el cliente, el día y la hora, el trabajador y el lugar ((2)), y toca [[Agregar]] ((3)).']],
          marcas: [{ n: 1, t: 'El tipo: examen ocupacional, con recordatorio al cliente.' }, { n: 2, t: 'Cliente, fecha, hora, trabajador y lugar.' }, { n: 3, t: 'Agregar: el recordatorio saldrá solo en Hoy el día anterior.' }],
          consejo: ['El día anterior aparece en Hoy con el mensaje listo para el WhatsApp del cliente, con todos los datos del examen.'] }
      ] }],
    cobranzas: [{ id: 'cobranzas', titulo: 'Lo propio de Facturación y Cobranzas', ruta: '#/dep_cobranzas/inf:plataformas',
      intro: ['Los recordatorios de cobro salen de la matriz **Cobranza**: cada factura con su vencimiento. SIGSO avisa 3 días antes, el día del vencimiento, a los 5 días de atraso y, a los 10, pide una llamada.'],
      pasos: [
        { titulo: 'Registra una llamada de cobranza', texto: ['Cuando el recordatorio del día es una **llamada**, el botón dice [[Registrar llamada]]. Llama al cliente y anota cómo fue: [[Se comprometió]], [[Ya cumplió]] o [[No contesta]]. Queda en la historia del cliente.'] },
        { titulo: 'Revisa el informe de plataformas de RR.HH.', img: 'plataformas',
          texto: ['En **Plataformas de RR.HH. (cobro)** está lo que antes llegaba armado por correo desde RR.HH.: por cliente y plataforma, cuántos trabajadores se subieron para el cobro, los trabajadores del mes y los finiquitados.'],
          marcas: [{ n: 1, t: 'El mes.' }, { n: 2, t: 'Los totales: clientes, plataformas y trabajadores para el cobro.' }, { n: 3, t: 'El detalle por cliente y plataforma.' }, { n: 4, t: '[[Excel]] para trabajarlo.' }] }
      ] }],
    contabilidad: [{ id: 'contabilidad', titulo: 'Lo propio de Contabilidad', ruta: '#/dep_contabilidad/conv',
      intro: ['Tres pantallas que solo tiene Contabilidad, bajo **Trabajo**.'],
      pasos: [
        { titulo: 'Seguimiento de cuotas TGR', img: 'tgr',
          texto: ['Muestra los convenios de pago con la Tesorería de cada cliente: cuántas cuotas lleva pagadas, cuáles vencen y cuáles están vencidas. Se alimenta con lo que se trae de la TGR (con el robot de la oficina o con el marcador «Enviar a SIGSO»).'],
          marcas: [{ n: 1, t: 'Los convenios y su estado.' }],
          ojo: ['SIGSO **nunca guarda las claves** de los clientes: la clave se escribe en la página de la TGR cada vez.'] },
        { titulo: 'Recibir desde el SII', img: 'sii',
          texto: ['Trae el **F29** y el **Registro de Compras y Ventas** desde la página del SII: con el marcador «Enviar a SIGSO», subiendo el CSV de «Descargar detalles» o pegando la página. SIGSO muestra contra qué fila se compara, qué cambia, y aplica solo lo que marcas.'],
          marcas: [{ n: 1, t: 'Las tres formas de traer los datos.' }] },
        { titulo: 'Impuesto único de RR.HH.', texto: ['En **Trabajo › Impuesto único de RR.HH.** está el informe que arma SIGSO desde Remuneraciones: el impuesto único de cada cliente para el mes, comparado con lo que Contabilidad anotó en el Informe y pago de IVA (columna **Cruce**: igual, distinto o vacío). Se descarga en Excel.'] }
      ] }],
    rrhh: [{ id: 'rrhh', titulo: 'Lo propio de Recursos Humanos', ruta: '#/dep_rrhh/inf:iusc',
      intro: ['Lo que conviene saber para que los recordatorios y los informes de RR.HH. salgan bien.'],
      pasos: [
        { titulo: 'El mes de la remuneración', texto: ['La información de los sueldos de un mes llega entre el 28 de ese mes y el 5 del siguiente. SIGSO la cuenta así: si la **fecha de recepción** es del **día 20 en adelante**, son los sueldos de ese mes; si es antes del 20, del mes anterior.', 'Por eso es clave anotar siempre la **fecha de recepción de la información** en Remuneraciones: con ella se calculan las liquidaciones del mes, el recordatorio de imposiciones y el indicador «clientes que envían la información a tiempo».'] },
        { titulo: 'Impuesto único para Contabilidad', img: 'iusc',
          texto: ['En **Trabajo › Impuesto único para Contabilidad** SIGSO arma el informe que se envía a Contabilidad (el 5-7 un primer informe y el 13 el definitivo), desde Remuneraciones: obras, trabajadores, impuesto único y liquidaciones enviadas de cada cliente, comparado con lo que Contabilidad tiene en el IVA.'],
          marcas: [{ n: 1, t: 'El mes de los sueldos.' }, { n: 2, t: 'Los totales.' }, { n: 3, t: 'Cada cliente y el cruce con Contabilidad.' }, { n: 4, t: '[[Excel]] para enviarlo.' }],
          ojo: ['El informe es tan bueno como lo anotado: completa el **monto del impuesto único** de cada obra en Remuneraciones (en blanco cuenta como $0).'] },
        { titulo: 'Plataformas para Facturación', texto: ['En **Trabajo › Plataformas para Facturación** está, por cliente y plataforma, cuántos trabajadores se subieron para el cobro, los trabajadores del mes y los finiquitados. Facturación y Cobranzas lo ve en su propio módulo, así que ya no hay que enviarlo armado a mano.'] }
      ] }]
  };

  function construir(clave) {
    var a = AREAS[clave];
    var id = 'area-' + clave;
    var c = caps(id, a);
    if (EXTRA[clave]) c = c.slice(0, 4).concat(EXTRA[clave]).concat(c.slice(4));
    SigsoManual.registrar({
      id: id, titulo: a.nombre, para: (a.soloJefe ? 'Quien trabaja en ' + a.nombre : 'Las personas de ' + a.nombre + ' y su jefatura'),
      resumen: ['Cómo usar el módulo de ' + a.nombre + ' en SIGSO, paso a paso: los recordatorios del día a los clientes, la agenda' + (a.matrices ? ', las matrices del área' : '') + (a.reporta ? ', el reporte mensual' : '') + ' y los ajustes. Pensado para ' + a.clientes + '.'],
      antes: ['Necesitas estar en la lista del área (lo hace el administrador en **Accesos**). Si no ves **' + a.corto + '** en la barra, pídeselo.',
        'En los ejemplos trabaja ' + a.registra + (a.jefe !== a.registra ? ', y la jefatura es ' + a.jefe : '') + ' (personas y clientes de demostración).'],
      capitulos: c, preguntas: COMUNES
    });
  }
  Object.keys(AREAS).forEach(construir);
})();
