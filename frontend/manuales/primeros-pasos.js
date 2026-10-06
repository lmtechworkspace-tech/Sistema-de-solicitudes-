/**
 * Manual «Primeros pasos»: entrar, Inicio, la barra lateral, buscar, avisos,
 * tu cuenta y los manuales. Capturas de la empresa de demostración.
 */
SigsoManual.registrar({
  id: 'primeros-pasos', titulo: 'Primeros pasos en SIGSO',
  para: 'Todas las personas, sobre todo si es tu primera vez',
  resumen: ['Lo básico para moverte en SIGSO: entrar, leer tu Inicio, usar la barra lateral, buscar cualquier cosa, revisar tus avisos y ajustar tu cuenta. Con esto ya puedes abrir el manual de cada módulo.'],
  antes: ['Necesitas tu **usuario** y tu **contraseña**: te los da el administrador. La primera vez SIGSO te pide cambiar la contraseña temporal por una tuya.',
    'En los ejemplos trabaja Tomás Fuentes, analista de Contabilidad (persona de demostración).'],
  capitulos: [
    { id: 'entrar', titulo: 'Entra a SIGSO',
      intro: ['Abre la dirección de SIGSO que te dio el administrador (guárdala en tus favoritos).'],
      pasos: [
        { titulo: 'Ingresa con tu usuario', img: 'ingresar',
          texto: [[ 'Escribe tu **Usuario** ((1)) y tu **Contraseña** ((2)).', 'Toca [[Ingresar]] ((3)).' ]],
          marcas: [{ n: 1, t: 'Tu usuario.' }, { n: 2, t: 'Tu contraseña.' }, { n: 3, t: 'Ingresar.' }, { n: 4, t: '¿Olvidaste tu contraseña? Te llega un enlace al correo para elegir una nueva.' }],
          consejo: ['Si no tienes cuenta, pídela al administrador. Para pedir algo sin cuenta existe «ingresar una solicitud sin cuenta», abajo en la misma pantalla.'] },
        { titulo: 'Si olvidaste tu contraseña', texto: ['Toca **¿Olvidaste tu contraseña?**, escribe tu usuario o correo y toca [[Enviar enlace]]. Abre el correo y sigue el enlace (sirve una sola vez y vence a los 45 minutos) para elegir una contraseña nueva de al menos 8 caracteres.'] }
      ] },
    { id: 'inicio', titulo: 'Tu Inicio: lo que te espera hoy', ruta: '#/home',
      intro: ['Al entrar llegas a **Inicio**: junta lo que requiere tu atención de todos tus módulos.'],
      pasos: [
        { titulo: 'Lee tu Inicio', img: 'inicio',
          texto: ['Inicio cambia según tus módulos. De arriba abajo:'],
          marcas: [{ n: 1, t: 'Tu saludo y cuántas cosas requieren tu atención.' }, { n: 2, t: 'Tus números del día: tareas abiertas, atrasadas, las que vencen en 7 días…' },
            { n: 3, t: '**Requiere tu atención**: lo que espera algo de ti (validar una solicitud, leer una novedad…), con su botón.' }, { n: 4, t: 'Tu semana y tu día: horas registradas y lo que viene.' }] },
        { titulo: 'Lo tuyo, tus atajos y lo pendiente', img: 'panel-inicio',
          texto: ['En Inicio, el menú de la barra se ordena en **tarjetas**. Al entrar están cerradas: toca una para abrirla (se abre de a una).'],
          marcas: [{ n: 1, t: '**Lo tuyo**: **Mis solicitudes** y **Pausas activas**.' }, { n: 2, t: '**Mis atajos**: tus pantallas de todos los días (las agregas con la estrella junto al nombre del área).' },
            { n: 3, t: '**Lo pendiente**: cada módulo con algo esperando, con su número y qué es (atrasado, para hoy).' }, { n: 4, t: '**Recientes**: lo último que abriste en este computador.' }],
          consejo: ['Con **Alt + 1** a **Alt + 8** vas directo a tus atajos desde cualquier parte.'] }
      ] },
    { id: 'barra', titulo: 'La barra lateral', ruta: '#/home',
      intro: ['La barra de la izquierda es el mapa de SIGSO: una columna de íconos con tus áreas y, al lado, el menú del área que tienes abierta.'],
      pasos: [
        { titulo: 'Conoce la barra', img: 'barra',
          texto: ['La columna de la izquierda tiene un ícono por área, agrupados en **Mi espacio**, **Áreas** y **Sistema**. Solo ves lo que te corresponde. Al lado está el menú del área abierta.'],
          marcas: [{ n: 1, t: '[[Nueva solicitud]]: el botón azul con el **+**, para pedir algo a cualquier área.' }, { n: 2, t: 'Tus áreas, por grupo. La abierta queda en azul.' },
            { n: 3, t: 'Un punto de color: hay algo esperando. Rojo, atrasado; ámbar, para hoy; gris, por revisar.' },
            { n: 4, t: 'El área abierta: su nombre, para qué sirve, cuánto espera y su **Manual de uso**.' }, { n: 5, t: 'Buscar en el menú del área (**Ctrl K** busca en todo SIGSO).' },
            { n: 6, t: 'El menú del área, en tarjetas.' }, { n: 7, t: 'Tus avisos (la campana).' }, { n: 8, t: 'Tu cuenta: perfil, modo oscuro, manuales y salir.' }] },
        { titulo: 'Pasa el mouse para ver los nombres', img: 'riel',
          texto: ['Pasa el mouse sobre la columna de íconos (o entra con la tecla **Tab**): se despliega encima del menú con el **nombre completo** de cada área y su número ((1)). Al sacar el mouse, o con **Esc**, vuelve a ser solo íconos.'],
          marcas: [{ n: 1, t: 'Los nombres completos, por grupo.' }, { n: 2, t: 'Cuánto espera: rojo, atrasado; ámbar, para hoy; gris, por revisar.' }, { n: 3, t: 'Ocultar (o mostrar) el menú del área.' }] },
        { titulo: 'El menú se abre de a una tarjeta',
          texto: ['Cada **tarjeta** es una parte del área (Agenda, Trabajo, Reportes…). Al entrar están cerradas: toca una para ver sus secciones y se cierra la que estaba abierta. Si una sección tiene más pantallas, se abre su **bandeja**, un poco más adentro.',
            'La pantalla donde estás queda en **azul**, y su tarjeta marcada aunque esté cerrada. Si llegas por un enlace, el menú se abre solo hasta esa pantalla.'] },
        { titulo: 'Oculta el menú si necesitas espacio', img: 'angosta',
          texto: ['Toca el botón de ocultar junto al nombre del área (o presiona **Ctrl + B**). Queda solo la columna de íconos; al tocar un área, su menú vuelve a aparecer. **Ctrl + B** también lo muestra otra vez, y SIGSO recuerda cómo lo dejaste.'],
          marcas: [{ n: 1, t: 'Solo la columna de íconos.' }, { n: 2, t: 'Mostrar el menú otra vez.' }],
          consejo: ['En una pantalla mediana (un notebook pequeño, por ejemplo) el menú parte oculto y se abre encima de la página al tocar un área; se cierra al elegir una pantalla o al hacer clic fuera.'] },
        { titulo: 'En el celular', img: 'celular',
          texto: ['En el celular, la barra se abre con el botón de menú arriba a la izquierda ((1)) y muestra tus áreas con su nombre. Al tocar una se abre su menú, con **← Áreas** para volver. Abajo tienes a mano Inicio, Mi trabajo, Buscar y Menú ((2)).'],
          marcas: [{ n: 1, t: 'Abrir la barra.' }, { n: 2, t: 'Los atajos de abajo.' }] }
      ] },
    { id: 'buscar', titulo: 'Busca y salta a cualquier parte', ruta: '#/home',
      intro: ['El buscador encuentra pantallas, solicitudes por su número y más, sin navegar por los menús.'],
      pasos: [
        { titulo: 'Usa el buscador', img: 'buscar',
          texto: [[ 'Toca **Ctrl K** en el buscador de arriba del menú, o presiona **Ctrl + K** (Cmd + K en Mac) desde cualquier parte.', 'Escribe lo que buscas, por ejemplo `iva` ((1)).', 'Elige un resultado con el mouse o con las flechas y **Enter** ((2)).' ],
            'Si en cambio escribes en el buscador del menú, se filtra solo el menú del área donde estás (sin importar tildes ni mayúsculas).'],
          marcas: [{ n: 1, t: 'Lo que escribiste.' }, { n: 2, t: 'Los resultados: pantallas y solicitudes.' }] }
      ] },
    { id: 'avisos', titulo: 'Tus avisos', ruta: '#/home',
      intro: ['La campana avisa lo que requiere tu atención: asignaciones, novedades por leer, cambios en tus solicitudes y recordatorios.'],
      pasos: [
        { titulo: 'Revisa la campana', img: 'avisos',
          texto: ['Toca la campana ((1)) abajo en la columna de íconos. Cada aviso te lleva a donde está lo que hay que hacer.'],
          marcas: [{ n: 1, t: 'La campana, con cuántos avisos nuevos tienes.' }, { n: 2, t: 'Tus avisos.' }] }
      ] },
    { id: 'cuenta', titulo: 'Tu cuenta', ruta: '#/home',
      intro: ['Toca tu foto (o tus iniciales) abajo en la columna de íconos.'],
      pasos: [
        { titulo: 'El menú de tu cuenta', img: 'cuenta',
          texto: ['Desde aquí:'],
          marcas: [{ n: 1, t: 'Tus correos.' }, { n: 2, t: '**Mi perfil**: tu foto y tus datos.' }, { n: 3, t: '**Modo oscuro** (o claro).' }, { n: 4, t: '**Manuales de uso**: todos los manuales de tus módulos.' }, { n: 5, t: '**Atajos de teclado**.' }, { n: 6, t: '**Cerrar sesión** (hazlo si el computador es compartido).' }] },
        { titulo: 'Pon tu foto', texto: ['En **Mi perfil**, sube una foto tuya: así tus compañeros te reconocen en las tareas, solicitudes y proyectos.'] }
      ] },
    { id: 'manuales', titulo: 'Los manuales de cada módulo', ruta: '#/home',
      intro: ['Cada módulo tiene su manual paso a paso, como este.'],
      pasos: [
        { titulo: 'Abre el manual del módulo donde estás', img: 'manual',
          texto: ['Toca [[Manual de uso]] bajo el nombre del área (o presiona **F1**). En el manual puedes buscar, ampliar las capturas, ir directo a la pantalla que explica y imprimirlo o guardarlo en PDF. Todos los manuales están en tu cuenta › **Manuales de uso**.'],
          marcas: [{ n: 1, t: 'El botón Manual de uso.' }] }
      ] }
  ],
  preguntas: [
    { p: 'No veo un módulo que necesito.', r: ['Cada persona ve solo los módulos de su trabajo. Pide al administrador que te dé acceso.'] },
    { p: '¿Qué significan los números de colores?', r: ['Cuánto te espera en ese módulo: **rojo**, hay algo atrasado; **ámbar**, es para hoy; **gris**, por revisar. Pasa el mouse por la columna de íconos para ver el número; en el área abierta también aparece escrito (por ejemplo «7 para hoy»).'] },
    { p: '¿Dónde quedaron Mis solicitudes y Pausas activas?', r: ['En **Inicio**: abre la tarjeta **Lo tuyo** del menú.'] },
    { p: 'La pantalla se ve rara o desactualizada.', r: ['Presiona **Ctrl + F5** para recargar la página con la última versión de SIGSO.'] }
  ]
});
