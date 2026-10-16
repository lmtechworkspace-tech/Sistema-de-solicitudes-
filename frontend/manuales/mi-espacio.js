/**
 * Manuales de «Mi espacio»: Mi trabajo, Novedades y Pausas activas.
 * Capturas de la empresa de demostración (datos ficticios).
 */
(function () {
  'use strict';

  SigsoManual.registrar({
    id: 'mi-trabajo', titulo: 'Mi trabajo: tus tareas y tus horas',
    para: 'Todas las personas de la empresa',
    resumen: ['Cómo llevar tus compromisos en SIGSO: ver por dónde empezar, cambiar el estado de una tarea con un botón, contar cómo va paso a paso, confirmar las que te asignan y registrar tus horas.'],
    antes: ['Lo que anotas aquí lo ve tu jefatura en **Mi departamento**: es la forma de mostrar en qué estás sin tener que reportarlo aparte.',
      'En los ejemplos trabaja Sofía Lagos (persona de demostración).'],
    capitulos: [
      { id: 'ver', titulo: 'Lee tu día', ruta: '#/mi_trabajo',
        intro: ['Mi trabajo ordena tus tareas por lo que necesita atención primero. Lo de más adelante queda plegado al final para que no distraiga.'],
        pasos: [
          { titulo: 'La pantalla de Mi trabajo', img: 'inicio',
            texto: ['Abre **Mi trabajo** en la barra.'],
            marcas: [{ n: 1, t: 'Mis tareas, Mis horas, No planificado y [[Nueva tarea]].' }, { n: 2, t: 'Los totales: para hoy (atrasadas y las que vencen hoy), esta semana, bloqueadas y por confirmar. Toca uno para ver solo eso; otro toque lo quita.' },
              { n: 3, t: '**Tu próximo paso**: la tarea que conviene mover primero, con su botón.' }, { n: 4, t: '**Para hoy**: lo atrasado y lo que vence hoy. Debajo vienen **Esta semana** y, plegado, **Más adelante y sin fecha**.' }, { n: 5, t: '[[Nueva tarea]].' }] },
          { titulo: 'Cómo se lee una tarea', texto: ['Cada tarea dice su **estado** en palabras (Por empezar, En curso, Bloqueada, En revisión) y el **plazo** con el color del punto: rojo si está atrasada, naranjo si vence pronto, azul si va a tiempo. A la derecha, cuándo vence y cuánto avance lleva.'] }
        ] },
      { id: 'estado', titulo: 'Cambia el estado con un botón', ruta: '#/mi_trabajo',
        intro: ['No hace falta abrir nada para lo más común: cada tarea trae el botón de su siguiente paso.'],
        pasos: [
          { titulo: 'El botón de cada tarea', img: 'fila',
            texto: [[ '[[Empezar]] cuando la tomas: pasa a **En curso**.', '[[Terminar]] cuando la terminas: SIGSO te pregunta si es así y la cierra (o la manda a revisión, si la pide).', '[[Destrabar]] cuando una tarea bloqueada puede seguir.' ],
              'El menú ((2)) tiene lo demás: **Contar cómo va**, **Me bloqueé**, **Solo anotar horas** y **Ver detalle**.'],
            marcas: [{ n: 1, t: 'El botón del siguiente paso (Empezar, Terminar o Destrabar).' }, { n: 2, t: 'Más opciones.' }, { n: 3, t: 'El proyecto: te lleva a tus tareas en ese proyecto.' }],
            consejo: ['Si te bloqueas, avísalo apenas pase con **Me bloqueé**: tu jefatura o el líder del proyecto lo ve y puede ayudarte a destrabarlo.'] }
        ] },
      { id: 'tareas', titulo: 'Crea y actualiza tus tareas', ruta: '#/mi_trabajo',
        intro: ['Una tarea es un compromiso con fecha. Actualizarla toma un clic y deja el historial que ve tu jefatura.'],
        pasos: [
          { titulo: 'Crea una tarea', img: 'nueva',
            texto: [[ 'Toca [[Nueva tarea]].', 'Escribe **Qué** vas a hacer ((1)) y para cuándo (**Vence**) ((2)).', 'Elige el **Tamaño** ((3)): chica (~2 h), mediana (~1 día), grande (~3 días) o muy grande.', 'Si es de un proyecto, elígelo ((4)); si se repite cada semana o cada mes, indícalo ((5)).', 'Toca [[Crear tarea]] ((6)).' ]],
            marcas: [{ n: 1, t: 'Qué vas a hacer.' }, { n: 2, t: 'Para cuándo.' }, { n: 3, t: 'Tamaño.' }, { n: 4, t: 'Proyecto (si corresponde).' }, { n: 5, t: 'Si se repite: al terminarla se crea sola la siguiente.' }, { n: 6, t: 'Crear la tarea.' }] },
          { titulo: 'Cuenta cómo va, paso a paso', img: 'actualizar',
            texto: ['En el menú de la tarea toca **Contar cómo va** (o, dentro de la tarea, [[Actualizar tarea]]). Son tres pasos cortos:',
              [ '**1. ¿Qué pasó?** ((1)): Avancé, La terminé, Me bloqueé (o Me destrabé) o Solo anotar horas. Si la revisaste y sigue igual, toca **Sin cambios por ahora**.', '**2. Lo que esa respuesta pide** ((2)): cuánto lleva si avanzaste, o qué te impide seguir si te bloqueaste. Si no hace falta nada, este paso no aparece.', '**3. Horas y nota** ((3)), opcionales: el día, las horas que le dedicaste y una nota.' ],
              'El botón de abajo ((4)) dice lo que va a hacer (**Guardar avance**, **Marcar terminada**, **Avisar bloqueo**…).'],
            marcas: [{ n: 1, t: '¿Qué pasó con la tarea?' }, { n: 2, t: 'Lo que pide tu respuesta (aquí, cuánto lleva).' }, { n: 3, t: 'Día, horas y nota (opcional).' }, { n: 4, t: 'Guardar.' }],
            consejo: ['Una actualización corta al final del día basta. Así tu jefatura sabe en qué estás sin preguntarte.'] },
          { titulo: 'Las tareas de un proyecto', texto: ['Si la tarea es de un proyecto, toca el nombre del proyecto en la tarea: se abre ese proyecto en **Trabajo**, mostrando solo tus tareas. Para volver, toca **‹ Mi trabajo** arriba, junto al nombre del proyecto. El manual de **Proyectos** explica lo que puedes hacer ahí.'] },
          { titulo: 'Confirma las tareas que te asignan', texto: ['Cuando tu jefatura te asigna una tarea, aparece en **Esperan que confirmes la fecha** con la fecha propuesta. Toca [[Confirmar]] si te sirve, o [[Otra fecha]] para proponer otra.'] },
          { titulo: 'Anota lo que surgió sin planificar', img: 'no-planificado',
            texto: ['Si algo te tomó tiempo y no estaba planificado (una urgencia de un cliente, por ejemplo), toca [[No planificado]], escribe qué fue, la fecha y el tamaño, y toca [[Anotar]]. Queda en tu registro y en el de tu jefatura.'],
            marcas: [{ n: 1, t: 'Qué surgió.' }, { n: 2, t: 'Anotar.' }] }
        ] },
      { id: 'horas', titulo: 'Revisa tus horas', ruta: '#/mi_trabajo',
        intro: ['**Mis horas** muestra cuánto registraste cada día y en qué frente.'],
        pasos: [
          { titulo: 'Mis horas', img: 'horas',
            texto: ['Toca **Mis horas**. Arriba, los totales de 7 y 14 días; abajo, tu dedicación día por día. Toca un día para ver o corregir lo que anotaste.'],
            marcas: [{ n: 1, t: 'Los totales.' }, { n: 2, t: 'Tu dedicación día a día: toca un día para corregir.' }],
            ojo: ['Si un día pasa de 9 horas, SIGSO lo marca: revisa si anotaste dos veces lo mismo.'] }
        ] }
    ]
  });

  SigsoManual.registrar({
    id: 'novedades', titulo: 'Novedades: leyes, avisos y procedimientos',
    para: 'Todas las personas de la empresa',
    resumen: ['Dónde leer las novedades de la empresa y de cada área, y cómo confirmar la lectura de las que lo piden (leyes, procedimientos, capacitaciones).'],
    antes: ['Algunas novedades piden **confirmar la lectura**, a veces con un plazo: así la empresa puede demostrar que todos se enteraron.'],
    capitulos: [
      { id: 'leer', titulo: 'Lee y confirma', ruta: '#/novedades',
        intro: ['Arriba está lo que te falta confirmar; abajo, todas las novedades.'],
        pasos: [
          { titulo: 'La pantalla de Novedades', img: 'inicio',
            texto: ['Abre **Novedades** en la barra (el número dice cuántas te faltan).'],
            marcas: [{ n: 1, t: 'Por confirmar, con plazo vencido y publicadas para ti.' }, { n: 2, t: '**Te falta confirmar**: las que esperan tu lectura.' }, { n: 3, t: 'Filtra por tipo: ley, procedimiento, aviso, capacitación, logro…' }, { n: 4, t: 'Una novedad: tipo, título, resumen, quién la publicó y su plazo.' }] },
          { titulo: 'Confirma que la leíste', img: 'leer',
            texto: ['Toca [[Leer y confirmar]]. Lee la novedad completa (y su adjunto o fuente, si tiene) y toca [[Confirmo que la leí]] ((1)). Queda registrado con tu nombre y la hora.'],
            marcas: [{ n: 1, t: 'Confirmar la lectura.' }],
            ojo: ['Las leyes y dictámenes llevan un plazo legal: confírmalas antes de que venza.'] },
          { titulo: 'Quién publica', texto: ['Publican la gerencia y las jefaturas o responsables de cada área. Las leyes, dictámenes, procedimientos y capacitaciones pasan por una aprobación antes de llegar a todos; los avisos y reconocimientos salen directo.'] }
        ] }
    ]
  });

  SigsoManual.registrar({
    id: 'pausas', titulo: 'Pausas activas: registra tu participación',
    para: 'Todas las personas en la lista de pausas',
    resumen: ['Cómo registrar en segundos si participaste en la pausa activa del día y revisar tu historial.'],
    capitulos: [
      { id: 'hoy', titulo: 'Registra la pausa de hoy', ruta: '#/pausas',
        intro: ['Cada día hábil hay una pausa activa a la hora habitual. Te llega un aviso unos minutos antes, y la tarjeta **Pausa activa de hoy** aparece también en tu **Inicio**: puedes registrarla desde ahí sin entrar al módulo.'],
        pasos: [
          { titulo: 'La pantalla de Pausas activas', img: 'inicio',
            texto: ['En **Inicio**, abre la tarjeta **Lo tuyo** del menú y toca **Pausas activas**.'],
            marcas: [{ n: 1, t: 'La pausa de hoy: la hora y cuánto dura.' }, { n: 2, t: '[[Declaro que participé]].' }, { n: 3, t: '[[No pude]] (con el motivo).' }, { n: 4, t: 'Tu historial de los últimos 60 días: participación, racha y días sin registrar.' }] },
          { titulo: 'Si participaste', img: 'participe',
            texto: ['Toca [[Declaro que participé]]. Se abre la declaración ya marcada ((1)); si quieres, cuenta cómo te sientes hoy, y toca [[Guardar]] ((2)). Listo.'],
            marcas: [{ n: 1, t: 'La declaración y cómo te sientes (opcional). Si marcas «Mal» o «Muy mal», la coordinación de pausas lo verá para acercarse a conversar.' }, { n: 2, t: 'Guardar.' }] },
          { titulo: 'Si no pudiste', texto: ['Toca [[No pude]] y escribe el motivo (por ejemplo, una reunión con un cliente). También queda registrado: no es lo mismo que no registrar nada.'] }
        ] }
    ]
  });
})();
