/**
 * Manuales de «Mi espacio»: Mi trabajo, Novedades y Pausas activas.
 * Capturas de la empresa de demostración (datos ficticios).
 */
(function () {
  'use strict';

  SigsoManual.registrar({
    id: 'mi-trabajo', titulo: 'Mi trabajo: tus tareas y tus horas',
    para: 'Todas las personas de la empresa',
    resumen: ['Cómo llevar tus compromisos en SIGSO: crear tareas, actualizarlas con un clic (avancé, me bloqueé, la terminé), confirmar las que te asignan y registrar tus horas.'],
    antes: ['Lo que anotas aquí lo ve tu jefatura en **Mi departamento**: es la forma de mostrar en qué estás sin tener que reportarlo aparte.',
      'En los ejemplos trabaja Tomás Fuentes (persona de demostración).'],
    capitulos: [
      { id: 'ver', titulo: 'Lee tu día', ruta: '#/mi_trabajo',
        intro: ['Mi trabajo ordena tus tareas por lo que necesita atención primero.'],
        pasos: [
          { titulo: 'La pantalla de Mi trabajo', img: 'inicio',
            texto: ['Abre **Mi trabajo** en la barra.'],
            marcas: [{ n: 1, t: 'Mis tareas, Mis horas y No planificado.' }, { n: 2, t: 'Los totales: abiertas, atrasadas, esta semana, bloqueadas, por confirmar y solicitudes a tu cargo. Toca uno para filtrar.' },
              { n: 3, t: '**Esperan que confirmes la fecha**: tareas que te asignaron.' }, { n: 4, t: 'Tus tareas por grupo (atrasadas, esta semana…), con su estado, fecha y avance.' }, { n: 5, t: '[[Nueva tarea]].' }] }
        ] },
      { id: 'tareas', titulo: 'Crea y actualiza tus tareas', ruta: '#/mi_trabajo',
        intro: ['Una tarea es un compromiso con fecha. Actualizarla toma un clic y deja el historial que ve tu jefatura.'],
        pasos: [
          { titulo: 'Crea una tarea', img: 'nueva',
            texto: [[ 'Toca [[Nueva tarea]].', 'Escribe **Qué** vas a hacer ((1)) y para cuándo (**Vence**) ((2)).', 'Elige el **Tamaño** ((3)): chica (~2 h), mediana (~1 día), grande (~3 días) o muy grande.', 'Si es de un proyecto, elígelo ((4)); si se repite cada semana o cada mes, indícalo ((5)).', 'Toca [[Crear tarea]] ((6)).' ]],
            marcas: [{ n: 1, t: 'Qué vas a hacer.' }, { n: 2, t: 'Para cuándo.' }, { n: 3, t: 'Tamaño.' }, { n: 4, t: 'Proyecto (si corresponde).' }, { n: 5, t: 'Si se repite: al terminarla se crea sola la siguiente.' }, { n: 6, t: 'Crear la tarea.' }] },
          { titulo: 'Actualiza una tarea con un clic', img: 'actualizar',
            texto: ['En la tarea, toca [[Actualizar]] y elige qué pasó ((1)):',
              [ '**Avancé**: indica cuánto llevas (%).', '**Sin cambios**: la tocaste pero no avanzó.', '**Me bloqueé**: escribe qué te detiene; tu jefatura lo ve.', '**La terminé**: queda cerrada (o en revisión, si requiere validación).', '**Solo registrar horas**: anota tiempo sin cambiar el estado.' ],
              'Indica el día y las horas trabajadas ((2)), una nota si sirve ((3)) y toca [[Guardar]] ((4)).'],
            marcas: [{ n: 1, t: 'Qué pasó con la tarea.' }, { n: 2, t: 'Día y horas trabajadas.' }, { n: 3, t: 'Nota (qué hiciste, qué falta).' }, { n: 4, t: 'Guardar.' }],
            consejo: ['Una actualización corta al final del día basta. Así tu jefatura sabe en qué estás sin preguntarte.'] },
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
