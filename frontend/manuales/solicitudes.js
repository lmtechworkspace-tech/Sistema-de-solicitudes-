/**
 * Manuales de Solicitudes: pedir (Nueva solicitud), seguir lo pedido (Mis
 * solicitudes) y atender (Bandeja de trabajo). Capturas de la empresa de
 * demostración (datos ficticios).
 */
(function () {
  'use strict';

  SigsoManual.registrar({
    id: 'nueva-solicitud', titulo: 'Nueva solicitud: pide algo a cualquier área',
    para: 'Todas las personas de la empresa',
    resumen: ['Cómo pedir un servicio a un departamento (una factura, un certificado, una liquidación…) o reportar un error o una mejora de un sistema, para que llegue a la persona correcta con todo lo necesario.'],
    antes: ['Todo pedido queda con un número (por ejemplo `SOL-2026-HP-0001`) y lo sigues en **Mis solicitudes**. Te avisamos por correo cuando lo tomen, si necesitan algo de ti y cuando esté listo.',
      'En los ejemplos pide Paula Soto (persona de demostración).'],
    capitulos: [
      { id: 'elegir', titulo: 'Elige qué necesitas', ruta: '#/nueva_solicitud',
        intro: ['La pantalla empieza preguntando **¿Qué necesitas?**: buscas el servicio o eliges el departamento.'],
        pasos: [
          { titulo: 'Abre Nueva solicitud', img: 'inicio',
            texto: ['Toca [[Nueva solicitud]], el botón azul con el **+** arriba en la columna de la izquierda. Se abre la lista de todo lo que puedes pedir, por departamento.'],
            marcas: [{ n: 1, t: 'El buscador: escribe lo que necesitas con tus palabras.' }, { n: 2, t: 'Filtra por departamento.' }, { n: 3, t: 'Un servicio, con su plazo habitual en días hábiles.' },
              { n: 4, t: '**Otro pedido**: si lo que necesitas no está en la lista de ese departamento.' }, { n: 5, t: '**Soporte de plataformas**: errores o mejoras de un sistema (Desarrollo / TI).' }] },
          { titulo: 'Búscalo por su nombre', img: 'buscar',
            texto: ['Escribe en el buscador, por ejemplo `certificado` ((1)). La lista se reduce a lo que coincide, con el departamento de cada servicio ((2)). Toca el que corresponde.'],
            marcas: [{ n: 1, t: 'Lo que escribiste.' }, { n: 2, t: 'Los servicios que coinciden, con su departamento.' }],
            consejo: ['No necesitas saber a qué área le toca: busca por lo que necesitas y SIGSO te dice quién lo atiende.'] }
        ] },
      { id: 'servicio', titulo: 'Pide un servicio a un departamento', ruta: '#/nueva_solicitud',
        intro: ['Al elegir un servicio, el formulario es corto: qué necesitas, el detalle y, si quieres, para cuándo y adjuntos.'],
        pasos: [
          { titulo: 'Completa el pedido', img: 'servicio',
            texto: [[ 'Revisa a quién le pides ((1)). Si te equivocaste, toca [[Elegir otro]].', '**¿Qué necesitas?** ((2)) viene con el nombre del servicio: cámbialo por tu pedido en una línea, por ejemplo `Factura de honorarios de octubre`.', 'En **Detalle** ((3)) agrega lo que pide el servicio (la ayuda gris te lo dice: cliente, monto, glosa…).', 'Si lo necesitas antes del plazo habitual, indica la fecha ((4)). Marca **Es urgente** ((5)) solo si de verdad no puede esperar.', 'Adjunta archivos si hacen falta ((6)) y toca [[Enviar a…]] ((7)).' ]],
            marcas: [{ n: 1, t: 'El departamento y el servicio elegidos, con su plazo habitual.' }, { n: 2, t: 'El pedido en una línea.' }, { n: 3, t: 'El detalle (la ayuda dice qué incluir).' }, { n: 4, t: 'Para cuándo (opcional).' }, { n: 5, t: 'Es urgente (solo si no puede esperar).' }, { n: 6, t: 'Adjuntos: hasta 5 archivos de 10 MB.' }, { n: 7, t: 'Enviar el pedido al departamento.' }] },
          { titulo: 'Si el servicio pide el cliente', img: 'cliente',
            texto: ['Algunos servicios (un certificado, una liquidación, un finiquito) son siempre para un cliente. En esos aparece el campo **Cliente** ((1)): escribe parte del nombre o del RUT y elígelo de la lista.'],
            marcas: [{ n: 1, t: 'El cliente del pedido, desde el catálogo.' }],
            ojo: ['Sin el cliente, SIGSO no deja enviar ese pedido: así el área no tiene que preguntártelo después.'] },
          { titulo: 'Qué pasa cuando lo envías', texto: ['El pedido llega a la **cola del departamento**. Alguien del área lo toma (o la jefatura lo asigna) y te llega un correo. Si necesitan algo, te escriben y lo ves en **Mis solicitudes** como «Te toca a ti». Cuando terminan, te piden que confirmes que quedó resuelto.'] }
        ] },
      { id: 'plataforma', titulo: 'Reporta un error o pide una mejora de un sistema', ruta: '#/nueva_solicitud',
        intro: ['Para problemas o mejoras de un sistema (la intranet, SIGSO u otra plataforma) se usa **Soporte de plataformas**: un formulario en tres pasos para que Desarrollo tenga todo lo que necesita.'],
        pasos: [
          { titulo: 'Paso 1: el contexto', img: 'plataforma-1',
            texto: ['Toca **Soporte de plataformas** en la lista. Arriba ves los tres pasos ((1)).', [ 'Elige el modo ((2)): **Rápido** pide lo justo; **Completo** agrega contexto y más detalle por ítem.', 'Elige la empresa, si es sobre una plataforma y cuál ((3)).', 'Indica a qué área va dirigida; si no sabes, deja «No estoy seguro» y el equipo lo deriva ((4)).', 'Revisa tus datos de contacto ((5)) y toca [[Continuar →]] ((6)).' ]],
            marcas: [{ n: 1, t: 'Los tres pasos: contexto, qué necesitas, revisar y enviar.' }, { n: 2, t: 'Modo rápido o completo.' }, { n: 3, t: 'Empresa y plataforma.' }, { n: 4, t: 'El área que lo atiende.' }, { n: 5, t: 'Tus datos de contacto (vienen de tu cuenta).' }, { n: 6, t: 'Continuar al paso 2.' }] },
          { titulo: 'Paso 2: qué necesitas', img: 'plataforma-2',
            texto: ['Cada cosa que necesitas es un **ítem** ((1) muestra que vas en el paso 2). Completa:',
              [ '**Tipo de trabajo** ((2)): error, mejora, nuevo módulo o consulta.', '**¿Cuánto te afecta?** ((3)): no puedo trabajar, me afecta mucho, tengo cómo seguir o puede esperar. Define la prioridad y el plazo: sé honesto, si todo es urgente nada lo es.', '**Módulo** ((4)) del sistema donde pasa.', '**Título corto** ((5)) y **¿Qué pasa?** ((6)): qué ves, qué esperabas y cómo repetirlo.', 'Si quieres, agrega imágenes (capturas de pantalla) y documentos.' ],
              'Si son varias cosas distintas, toca [[+ Agregar otro item]] ((7)): cada una se atiende por separado. Al terminar, toca [[Revisar y enviar →]] ((8)).'],
            marcas: [{ n: 1, t: 'Vas en el paso 2.' }, { n: 2, t: 'Tipo de trabajo.' }, { n: 3, t: 'Cuánto te afecta (la prioridad).' }, { n: 4, t: 'El módulo del sistema.' }, { n: 5, t: 'Título corto.' }, { n: 6, t: 'Qué pasa.' }, { n: 7, t: 'Agregar otro ítem.' }, { n: 8, t: 'Ir al paso 3.' }],
            consejo: ['Un buen título dice qué y dónde: `No carga el listado de trabajadores de la Obra A` es mejor que `Error en la intranet`. Una captura de pantalla ahorra muchas preguntas.'] },
          { titulo: 'Paso 3: revisa y envía', texto: ['Revisa el resumen y toca [[Enviar]]. Recibirás un correo con el número de la solicitud y podrás seguirla en **Mis solicitudes**.'] }
        ] }
    ],
    preguntas: [
      { p: '¿Puedo corregir un pedido después de enviarlo?', r: ['Sí, mientras nadie lo haya empezado: en **Mis solicitudes**, abre el pedido y toca [[Corregir]].'] },
      { p: '¿Qué significa el plazo habitual?', r: ['Son los días hábiles que el área se da para resolver ese servicio. Si lo necesitas antes, indica la fecha; si es de verdad urgente, márcalo.'] }
    ]
  });

  SigsoManual.registrar({
    id: 'mis-solicitudes', titulo: 'Mis solicitudes: sigue lo que pediste',
    para: 'Todas las personas que piden algo en SIGSO',
    resumen: ['Dónde ver en qué va cada cosa que pediste, responder cuando el equipo te pregunta algo y confirmar que quedó resuelto.'],
    antes: ['En los ejemplos, las solicitudes son de Paula Soto (persona de demostración).'],
    capitulos: [
      { id: 'ver', titulo: 'Mira en qué va todo lo que pediste', ruta: '#/mis_solicitudes',
        intro: ['Arriba está lo que espera de ti; abajo, todas tus solicitudes con su estado.'],
        pasos: [
          { titulo: 'Lee la pantalla', img: 'inicio',
            texto: ['En **Inicio**, abre la tarjeta **Lo tuyo** del menú y toca **Mis solicitudes**.'],
            marcas: [{ n: 1, t: 'Los totales: abiertas, **te toca a ti**, cerradas y todas.' }, { n: 2, t: '**Te toca a ti**: lo que el equipo espera de ti, con el botón para hacerlo ([[Responder]] o [[Validar]]).' },
              { n: 3, t: 'Todas tus solicitudes, con su número, fecha, estado y fecha comprometida.' }, { n: 4, t: '[[Nueva solicitud]] para pedir algo más.' }],
            consejo: ['El número junto a **Mis solicitudes** (en Inicio › Lo tuyo) es lo que te toca a ti.'] },
          { titulo: 'Envía un archivo al equipo cuando quieras',
            texto: ['Abre la solicitud y, en la conversación, usa **Adjuntar archivos** (imágenes, PDF, Word o Excel de hasta 10 MB) y toca [[Enviar]]. El equipo recibe el aviso con los nombres de lo que subiste.'],
            consejo: ['Mejor que un enlace de Drive: el equipo lo abre sin tener que pedirte acceso.'] },
          { titulo: 'Abre una solicitud', img: 'detalle',
            texto: ['Toca una solicitud. Se abre a la derecha con todo su detalle.'],
            marcas: [{ n: 1, t: 'Los pasos: nueva, en curso, resuelta y cerrada; resaltado, dónde va.' }, { n: 2, t: 'Ítems, conversación con el equipo, historial y archivos.' }, { n: 3, t: 'Quién te atiende, de qué área y servicio, y la fecha comprometida.' }, { n: 4, t: '[[Corregir]] (mientras nadie la empiece) y [[Ya se resolvió por fuera]].' }] }
        ] },
      { id: 'responder', titulo: 'Responde cuando el equipo te pregunta', ruta: '#/mis_solicitudes',
        intro: ['Si el equipo necesita algo de ti, la solicitud queda **Esperando tu respuesta**: no avanza hasta que respondas.'],
        pasos: [
          { titulo: 'Responde la pregunta', img: 'responder',
            texto: [[ 'En **Te toca a ti**, toca [[Responder]].', 'Lee la pregunta del equipo ((1)).', 'Escribe tu respuesta ((2)) y toca [[Enviar respuesta]] ((3)). La solicitud vuelve a quien te atiende.' ]],
            marcas: [{ n: 1, t: 'Lo que te preguntó el equipo.' }, { n: 2, t: 'Tu respuesta.' }, { n: 3, t: 'Enviar la respuesta.' }, { n: 4, t: 'Si ya no hace falta, [[Ya se resolvió por fuera]].' }] },
          { titulo: 'Confirma que quedó resuelto', img: 'validar',
            texto: ['Cuando el equipo termina, la solicitud pasa a **Resuelta** y aparece en **Te toca a ti**. Toca [[Validar]] y lee lo que hicieron ((1)):', [ 'Si quedó bien, toca [[Confirmar y cerrar]] ((2)).', 'Si falta algo, toca [[No quedó resuelto]] ((3)) y cuéntale al equipo qué falta: vuelve a quien te atiende.' ]],
            marcas: [{ n: 1, t: 'El equipo lo marcó como resuelto (y hasta cuándo puedes responder).' }, { n: 2, t: 'Confirmar y cerrar.' }, { n: 3, t: 'No quedó resuelto.' }],
            ojo: ['Si no la validas en 5 días hábiles, se cierra sola como resuelta (te avisamos antes por correo).'] }
        ] }
    ]
  });

  SigsoManual.registrar({
    id: 'bandeja', titulo: 'Bandeja de trabajo: atiende las solicitudes',
    para: 'Quienes atienden solicitudes (Desarrollo y los departamentos)',
    resumen: ['Cómo ver lo que tienes que atender, tomar los pedidos de la cola de tu área, conversar con quien pidió, comprometer una fecha y marcar lo resuelto.'],
    antes: ['La Bandeja la ven quienes atienden solicitudes. Si eres de un departamento, tu área tiene su **cola**: los pedidos que llegan a ella.',
      'En los ejemplos atienden Diego Salinas (Desarrollo) y Tomás Fuentes (Contabilidad), personas de demostración.'],
    capitulos: [
      { id: 'ver', titulo: 'Lee tu bandeja', ruta: '#/bandeja',
        intro: ['La Bandeja muestra lo asignado a ti y lo que está en curso sin responsable.'],
        pasos: [
          { titulo: 'La pantalla de la Bandeja', img: 'inicio',
            texto: ['Abre **Bandeja** en la barra.'],
            marcas: [{ n: 1, t: '**Cola** (lo que atiendes) o **Análisis** (los números de la bandeja).' }, { n: 2, t: 'Los filtros rápidos: abiertos, nuevos, fuera de plazo, sin fecha comprometida, sin asignar y por validar. Toca uno para ver solo eso.' },
              { n: 3, t: 'Buscar y filtrar por empresa, prioridad y orden.' }, { n: 4, t: 'Cómo verla: tabla, lista o por estado (tablero).' }, { n: 5, t: 'Cada ítem: plazo, número, pedido, quién pide, responsable, estado y antigüedad.' }] },
          { titulo: 'Una fila por solicitud',
            texto: ['La tabla muestra **una fila por solicitud**, con su número completo y quién pidió. Si la solicitud tiene varios ítems (cosas distintas pedidas juntas), bajo el número dice cuántos son («4 ítems») y la columna **Avance** tiene un tramo por ítem: el color dice en qué paso va cada uno.',
              'Toca la flecha de la izquierda para ver sus ítems (**Ítem 1 de 4**, **Ítem 2 de 4**…), cada uno con su camino. Toca la fila para abrir la solicitud completa.',
              'La columna **Sigue** dice qué falta: [[Recibir]] (con cuántos ítems nuevos), «Dar fecha», «Empezar», «Resolver», «Esperando respuesta» o «Espera confirmación».'] },
          { titulo: 'El camino de cada ítem',
            texto: ['Al abrir una solicitud con varios ítems, aparecen en dos grupos: **Por hacer** (toca uno para desplegarlo; arriba de cada uno dice su estado y lo que sigue) y **Terminados** (atenuados y con un check: ya no necesitan trabajo). Cuando resuelves un ítem, baja solo a Terminados y se abre el siguiente.',
              'Cada ítem recorre cinco pasos, a su ritmo y con su propia fecha: **Recibido → Con fecha → En curso → Resuelto → Confirmado** (por quien pidió). En la ficha del ítem el camino se ve arriba de los botones, y el botón azul es siempre el paso que sigue.',
              [ '[[Recibir y dar fecha]]: lo recibes y dices para cuándo estará. A quien pidió le llega un solo aviso con la fecha. Si nadie lo tenía, queda a tu nombre.',
                'Con varios ítems nuevos en la misma solicitud, [[Recibir los N y dar fecha]] los recibe todos de una vez (una fecha por ítem, un solo aviso).',
                '[[Empezar]], después [[Marcar resuelta]]. Si te falta un dato, [[Pedir información]] deja el ítem en pausa hasta que respondan.' ]],
            consejo: ['Si marcas resuelto un ítem que no habías recibido o que no tenía fecha, SIGSO lo completa solo («recibido y resuelto el mismo día», con fecha de hoy) y lo anota en el historial: el camino nunca queda con huecos.'] },
          { titulo: 'Lo resuelto sale de tu lista',
            texto: ['Cuando marcas un ítem como resuelto, deja de aparecer en tu lista de trabajo (y en **Por estado** ya no hay columna «Resuelta»): ahora le toca a quien pidió confirmar. Si no responde en 5 días hábiles, se cierra solo.',
              'Para ver lo que espera esa confirmación, toca **Por validar** en los filtros de arriba.'] },
          { titulo: 'La cola de tu departamento', img: 'cola',
            texto: ['Si eres de un departamento, arriba aparecen **Mi bandeja** y la **cola de tu área** ((1)), con cuántos pedidos tiene y cuántos están sin asignar.', [ 'Toca la cola del área para ver todos sus pedidos. En los que están sin asignar aparece [[Tomar]]: queda a tu nombre.', 'En un pedido nuevo a tu nombre, toca [[Recibir]] ((2)): quien pidió recibe el aviso de que ya lo tienes.' ]],
            marcas: [{ n: 1, t: 'Tu bandeja y la cola de tu área (con los sin asignar).' }, { n: 2, t: '[[Recibir]]: avisar que ya lo tienes.' }, { n: 3, t: '**Reportes**: cómo le va al área con sus pedidos.' }],
            consejo: ['La jefatura del área puede repartir los pedidos; el resto toma los que estén sin asignar.'] }
        ] },
      { id: 'atender', titulo: 'Atiende un ítem', ruta: '#/bandeja',
        intro: ['Al tocar un ítem se abre su ficha a la derecha, con todo lo necesario para atenderlo sin salir de la Bandeja.'],
        pasos: [
          { titulo: 'La ficha del ítem', img: 'detalle',
            texto: ['Toca el título de un ítem.'],
            marcas: [{ n: 1, t: 'Número, título, estado, prioridad y quién lo pidió.' }, { n: 2, t: '**Seguimiento** (conversación), **Ficha**, **Actividad** (historial y notas internas) y **Archivos**.' },
              { n: 3, t: 'Responsable, fecha comprometida y si está fuera de plazo.' }, { n: 4, t: 'Lo que puedes hacer: [[Marcar resuelta]], [[Pedir información]] y más opciones.' }, { n: 5, t: 'La conversación con quien pidió: lo que escribes le llega por correo.' }] },
          { titulo: 'Conversa con quien pidió', texto: ['En **Seguimiento**, escribe en el cuadro y toca [[Enviar]]: le llega por correo y lo ve en Mis solicitudes. Para algo solo del equipo, usa una **nota interna** en **Actividad**: quien pidió no la ve.'] },
          { titulo: 'Pide información si te falta algo', texto: ['Toca [[Pedir información]] y escribe la pregunta. La solicitud queda **Esperando respuesta** (el plazo se detiene) y vuelve a ti cuando quien pidió responde.'] },
          { titulo: 'Si un enlace de Drive te pide acceso',
            texto: ['Los enlaces del ítem aparecen en **Enlaces**, y los de Drive van marcados. Un enlace de Drive solo se abre si quien pidió lo compartió contigo.',
              'Si te pide acceso, toca [[Pedir el archivo]]: queda escrito en la conversación un mensaje que le pide subir el archivo a SIGSO. Revísalo y toca [[Enviar]].'],
            consejo: ['Quien pidió puede subir archivos en cualquier momento desde **Mis solicitudes**, en la conversación (**Adjuntar archivos**). Además, al pegar un enlace de Drive en una solicitud nueva, SIGSO le recomienda subir el archivo.'] },
          { titulo: 'Marca resuelto', texto: ['Cuando termines, toca [[Marcar resuelta]] y cuenta qué se hizo. Quien pidió lo confirma desde Mis solicitudes; si no lo hace en 5 días hábiles, se cierra solo.'],
            consejo: ['Desde la ficha también puedes generar la **Orden de trabajo** o **Convertir en proyecto** un pedido grande.'] }
        ] },
      { id: 'analisis', titulo: 'Mira los números de la Bandeja', ruta: '#/bandeja',
        intro: ['**Análisis** muestra cómo está la bandeja en gráficos: por estado, antigüedad, responsable y prioridad.'],
        pasos: [
          { titulo: 'Análisis', img: 'analisis',
            texto: ['Toca **Análisis** arriba. Los totales son los mismos filtros de la cola; los gráficos muestran dónde se acumula el trabajo.'],
            marcas: [{ n: 1, t: 'Los totales.' }, { n: 2, t: 'Los gráficos.' }] }
        ] }
    ]
  });
})();
