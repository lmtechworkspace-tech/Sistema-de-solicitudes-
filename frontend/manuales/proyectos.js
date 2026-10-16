/**
 * Manual de «Proyectos»: trabajar las tareas de un proyecto en equipo.
 * Capturas de la empresa de demostración (datos ficticios).
 */
(function () {
  'use strict';

  SigsoManual.registrar({
    id: 'proyectos', titulo: 'Proyectos: tus tareas y las del equipo',
    para: 'Quienes participan en un proyecto (líder, integrantes y colaboradores)',
    resumen: ['Cómo encontrar tus tareas dentro de un proyecto, cambiarles el estado (también arrastrando en el tablero), sumar colaboradores y pasar tareas a otra persona del equipo sin perder su avance.'],
    antes: ['Todo el **equipo del proyecto** (líder, integrantes y colaboradores) puede cambiar el estado de cualquier tarea del proyecto: si ejecutas una tarea que está a nombre de otra persona, puedes actualizarla igual. SIGSO registra quién hizo cada cambio.',
      'Quienes figuran como **observadores** solo miran.',
      'En los ejemplos trabaja Sofía Lagos (persona de demostración).'],
    capitulos: [
      { id: 'trabajo', titulo: 'Encuentra tus tareas', ruta: '#/proyectos',
        intro: ['Dentro de un proyecto, la sección **Trabajo** reúne todas sus tareas en tabla, tablero (Kanban) o Carta Gantt.'],
        pasos: [
          { titulo: 'La sección Trabajo', img: 'trabajo',
            texto: ['Abre el proyecto y toca **Trabajo**. Si no lideras el proyecto, entras viendo **solo tus tareas** (las que están a tu nombre o en las que colaboras).'],
            marcas: [{ n: 1, t: '**Tus tareas aquí**: te lleva directo a lo tuyo desde cualquier sección del proyecto.' }, { n: 2, t: '**Mis tareas**: tócalo para ver las de todo el equipo, y otra vez para volver a las tuyas.' },
              { n: 3, t: 'Tabla, Kanban o Gantt.' }, { n: 4, t: '**Columnas de control**: suma prioridad, fechas de plan y reales y la desviación (para quien hace seguimiento).' }, { n: 5, t: 'La tabla: estado en palabras, con el color del plazo, y cuándo vence. "(prop.)" es una fecha propuesta que falta confirmar.' }],
            consejo: ['Si llegaste desde **Mi trabajo**, arriba aparece **‹ Mi trabajo** para volver.'] }
        ] },
      { id: 'tarea', titulo: 'Abre y actualiza una tarea', ruta: '#/proyectos',
        intro: ['Toca una tarea para abrir su panel. Arriba está lo que necesitas para actuar; el análisis queda plegado.'],
        pasos: [
          { titulo: 'El panel de la tarea', img: 'panel',
            texto: ['Verás quién es responsable, el estado con su vencimiento y el avance. **Control del plan** ((2)) despliega las fechas de plan y reales, la desviación y los datos de la tarea.',
              'Toca [[Actualizar tarea]] ((4)) para contar cómo va: son los mismos tres pasos que en **Mi trabajo** (¿qué pasó?, lo que pide esa respuesta y, si quieres, horas y nota).'],
            marcas: [{ n: 1, t: 'Estado y cuándo vence.' }, { n: 2, t: 'Control del plan (plegado).' }, { n: 3, t: '[[Editar]]: título, fechas, responsable y colaboradores.' }, { n: 4, t: '[[Actualizar tarea]].' }],
            ojo: ['Si una tarea pide revisión, al terminarla queda **En revisión** y el líder la aprueba o la devuelve con un comentario ([[Aprobar]] / [[Devolver]]).'] },
          { titulo: 'Suma colaboradores', img: 'editar',
            texto: ['En [[Editar]], marca en **Colaboran** ((2)) a quienes también trabajan la tarea. La verán en su **Mi trabajo** y podrán actualizarla.',
              'El **Responsable** ((1)) solo lo cambian el líder o la propia persona responsable. Cambiarlo conserva el estado, el avance y las fechas.'],
            marcas: [{ n: 1, t: 'Responsable.' }, { n: 2, t: 'Colaboran.' }] }
        ] },
      { id: 'tablero', titulo: 'Mueve tareas en el tablero', ruta: '#/proyectos',
        intro: ['En **Kanban** cada columna es un estado. Arrastra una tarjeta para cambiarlo.'],
        pasos: [
          { titulo: 'Arrastrar para cambiar el estado', img: 'kanban',
            texto: [[ 'A **En curso** ((2)): la empiezas, o la destrabas si estaba bloqueada.', 'A **Bloqueadas** ((3)): se abre la tarea para que cuentes qué te impide seguir.', 'A **Terminadas** (la última columna, a la derecha): SIGSO te pregunta si es así y la cierra.' ],
              '**Por hacer** y **En revisión** se llenan solas: no aceptan tarjetas.'],
            marcas: [{ n: 1, t: 'El recordatorio de cómo se usa.' }, { n: 2, t: 'En curso.' }, { n: 3, t: 'Bloqueadas.' }],
            consejo: ['En el celular no se arrastra: toca la tarjeta y usa [[Actualizar tarea]].'] }
        ] },
      { id: 'pasar', titulo: 'Pasa tareas a otra persona', ruta: '#/proyectos',
        intro: ['Cuando otra persona del equipo se hace cargo de tus tareas (o, si lideras, de las de alguien más), pásaselas de una vez. Conservan su estado, avance y fechas.'],
        pasos: [
          { titulo: 'Marca las tareas', img: 'seleccion',
            texto: ['En **Trabajo**, vista **Tabla**, marca las casillas de las tareas que quieres pasar (la casilla del encabezado marca todas las que se ven). Aparece la barra con cuántas elegiste ((1)); toca [[Pasar a…]] ((2)).'],
            marcas: [{ n: 1, t: 'Cuántas tareas marcaste.' }, { n: 2, t: '[[Pasar a…]].' }],
            ojo: ['Cada persona puede pasar las tareas que tiene a su nombre; el líder puede pasar cualquiera. Las tareas terminadas no se pasan.'] },
          { titulo: 'Elige a quién', img: 'pasar',
            texto: ['Elige la **nueva persona responsable** ((1)), escribe el motivo si quieres ((2)), revisa la lista ((3)) y toca [[Pasar]] ((4)). La persona recibe un aviso y las tareas aparecen en su **Mi trabajo**.'],
            marcas: [{ n: 1, t: 'Nueva persona responsable.' }, { n: 2, t: 'Motivo (opcional, queda en el historial).' }, { n: 3, t: 'Las tareas que se pasan.' }, { n: 4, t: '[[Pasar]].' }],
            consejo: ['Para pasar todo lo de una persona: en **Trabajo** elige a esa persona en "Todas las personas" y marca la casilla del encabezado.'] }
        ] }
    ]
  });
})();
