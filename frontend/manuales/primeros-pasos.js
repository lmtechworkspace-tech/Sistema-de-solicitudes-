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
        { titulo: 'Tus atajos y lo pendiente', img: 'panel-inicio',
          texto: ['En Inicio, el panel de la barra lateral muestra:'],
          marcas: [{ n: 1, t: '**Mis atajos**: tus pantallas de todos los días (las agregas con la estrella).' }, { n: 2, t: '**Lo pendiente**: cada módulo con algo esperando, con su número.' }, { n: 3, t: '**Recientes**: lo último que abriste.' }],
          consejo: ['Con **Alt + 1** a **Alt + 8** vas directo a tus atajos desde cualquier parte.'] }
      ] },
    { id: 'barra', titulo: 'La barra lateral', ruta: '#/home',
      intro: ['La barra de la izquierda es el mapa de SIGSO: a la izquierda tus módulos; al lado, el menú del módulo abierto.'],
      pasos: [
        { titulo: 'Conoce la barra', img: 'barra',
          texto: ['Cada módulo tiene su **nombre**, su **ícono** y su **color**, agrupados (Mi espacio, Solicitudes, Áreas, Gestión). Solo ves los módulos que te corresponden.'],
          marcas: [{ n: 1, t: '[[Nueva solicitud]]: pedir algo a cualquier área.' }, { n: 2, t: 'Tus módulos, por grupo.' }, { n: 3, t: 'El número de un módulo: rojo, hay atrasos; ámbar, es para hoy; gris, por revisar.' },
            { n: 4, t: 'La portada del módulo abierto: nombre, para qué sirve y su **Manual de uso**.' }, { n: 5, t: 'El menú del módulo, por secciones.' }, { n: 6, t: 'Tus avisos (la campana).' }, { n: 7, t: 'Tu cuenta: perfil, modo oscuro, manuales y salir.' }] },
        { titulo: 'Angosta la barra si necesitas espacio', img: 'angosta',
          texto: ['Toca el botón de angostar en la portada (o la tecla **[**). Queda solo la columna de módulos, con sus nombres; al tocar un módulo, su menú se abre flotando. Vuelve a tocarlo (o **[**) para abrirla.'],
          marcas: [{ n: 1, t: 'La barra angosta: los módulos siguen con su nombre.' }, { n: 2, t: 'Mostrar el menú otra vez.' }] },
        { titulo: 'En el celular', img: 'celular',
          texto: ['En el celular, la barra se abre con el botón de menú arriba a la izquierda ((1)). Abajo tienes a mano Inicio, Mi trabajo, Buscar y Menú ((2)).'],
          marcas: [{ n: 1, t: 'Abrir la barra.' }, { n: 2, t: 'Los atajos de abajo.' }] }
      ] },
    { id: 'buscar', titulo: 'Busca y salta a cualquier parte', ruta: '#/home',
      intro: ['El buscador encuentra pantallas, solicitudes por su número y más, sin navegar por los menús.'],
      pasos: [
        { titulo: 'Usa el buscador', img: 'buscar',
          texto: [[ 'Toca **Buscar en SIGSO** en la barra, o presiona **Ctrl + K** (Cmd + K en Mac) desde cualquier parte.', 'Escribe lo que buscas, por ejemplo `iva` ((1)).', 'Elige un resultado con el mouse o con las flechas y **Enter** ((2)).' ]],
          marcas: [{ n: 1, t: 'Lo que escribiste.' }, { n: 2, t: 'Los resultados: pantallas y solicitudes.' }] }
      ] },
    { id: 'avisos', titulo: 'Tus avisos', ruta: '#/home',
      intro: ['La campana avisa lo que requiere tu atención: asignaciones, novedades por leer, cambios en tus solicitudes y recordatorios.'],
      pasos: [
        { titulo: 'Revisa la campana', img: 'avisos',
          texto: ['Toca la campana ((1)) abajo en la barra. Cada aviso te lleva a donde está lo que hay que hacer.'],
          marcas: [{ n: 1, t: 'La campana, con cuántos avisos nuevos tienes.' }, { n: 2, t: 'Tus avisos.' }] }
      ] },
    { id: 'cuenta', titulo: 'Tu cuenta', ruta: '#/home',
      intro: ['Toca tu foto (o tus iniciales) abajo en la barra.'],
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
          texto: ['Toca [[Manual de uso]] en la portada del módulo (o presiona **F1**). En el manual puedes buscar, ampliar las capturas, ir directo a la pantalla que explica y imprimirlo o guardarlo en PDF. Todos los manuales están en tu cuenta › **Manuales de uso**.'],
          marcas: [{ n: 1, t: 'El botón Manual de uso.' }] }
      ] }
  ],
  preguntas: [
    { p: 'No veo un módulo que necesito.', r: ['Cada persona ve solo los módulos de su trabajo. Pide al administrador que te dé acceso.'] },
    { p: '¿Qué significan los números de colores?', r: ['Cuánto te espera en ese módulo: **rojo**, hay algo atrasado; **ámbar**, es para hoy; **gris**, por revisar. Al pie del menú está la leyenda.'] },
    { p: 'La pantalla se ve rara o desactualizada.', r: ['Presiona **Ctrl + F5** para recargar la página con la última versión de SIGSO.'] }
  ]
});
