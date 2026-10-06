/**
 * Manual de Administración (departamento): recibir los reportes mensuales de
 * las áreas y armar el informe de gestión que llega a la gerencia.
 * Capturas de la empresa de demostración (datos ficticios).
 */
SigsoManual.registrar({
  id: 'area-administracion',
  titulo: 'Administración: reportes de las áreas e informe de gestión',
  para: 'La encargada de Administración y quienes revisan el informe de gestión',
  resumen: ['Cada mes las áreas entregan su reporte; Administración los recibe, arma el **informe de gestión** y lo hace avanzar por la cadena hasta que la gerencia decide. Este manual muestra cada paso.'],
  antes: ['Ves este módulo si estás en los **Accesos** de Administración, o si eres parte de la cadena del informe de gestión (Finanzas, Cobranzas, Control o Gerencia).',
    'En los ejemplos, la encargada de Administración es Andrea Núñez (persona de demostración).'],
  capitulos: [
    { id: 'orientarse', titulo: 'Oriéntate en Administración', ruta: '#/dep_administracion/inicio',
      intro: ['El menú de Administración tiene tres pantallas para todos y dos más para el administrador.'],
      pasos: [
        { titulo: 'Abre Administración', img: 'orientarse',
          texto: ['En la barra, bajo **Áreas**, toca **Administración** ((1)). El menú ((2)) tiene:',
            [ '**Informe de gestión**: lo que llega a la gerencia, con su cadena de revisión.', '**Agenda general**: el calendario de todas las áreas juntas.', '**Reportes de las áreas**: el estado del reporte mensual de cada área.', '**Cadena de reportes** y **Accesos** (solo el administrador): quién revisa y quién entra.' ]],
          marcas: [{ n: 1, t: 'Administración en la columna de íconos (pasa el mouse para ver los nombres).' }, { n: 2, t: 'El menú del módulo.' }, { n: 3, t: 'Este manual.' }] }
      ] },
    { id: 'reportes', titulo: 'Recibe los reportes de las áreas', ruta: '#/dep_administracion/areas',
      intro: ['Cada área prepara su reporte del mes, su jefatura lo valida y te llega a ti. Aquí ves en qué va cada una y recibes los que ya están validados.'],
      pasos: [
        { titulo: 'Mira en qué va cada área', img: 'areas',
          texto: ['Entra a **Reportes de las áreas**. Arriba, los totales del mes; abajo, una tarjeta por área.'],
          marcas: [{ n: 1, t: 'El mes que se reporta (el anterior).' }, { n: 2, t: 'Recibidos, por recibir, por validar (la jefatura todavía no lo valida) y sin enviar.' },
            { n: 3, t: 'Una tarjeta por área: su estado, lo más urgente, sus indicadores, quién envió y quién validó.' }, { n: 4, t: 'Los meses anteriores: verde si se recibió.' }, { n: 5, t: '[[Abrir el reporte]].' }],
          consejo: ['Cuando una jefatura valida un reporte, SIGSO te avisa con un mensaje al entrar («Reporte por recibir») y en la campana de avisos.'] },
        { titulo: 'Recibe un reporte validado', img: 'recibir',
          texto: ['En la tarjeta del área que dice **Por recibir**, toca [[Revisar y recibir]]. Revisa sus cifras (quedaron congeladas al enviarlo) y lo que comenta el área.',
            [ 'Si está bien, toca [[Recibir]] ((2)): queda recibido con tu nombre y la hora, y entra al informe de gestión.', 'Si falta algo, toca [[Devolver con observaciones]] ((3)) y escribe qué hay que corregir: vuelve al área.' ]],
          marcas: [{ n: 1, t: 'Los tres pasos del reporte, con quién y cuándo.' }, { n: 2, t: '[[Recibir]] el reporte.' }, { n: 3, t: '[[Devolver con observaciones]] al área.' }, { n: 4, t: 'Descargar el reporte en Excel o PDF.' }] }
      ] },
    { id: 'informe', titulo: 'Arma y envía el informe de gestión', ruta: '#/dep_administracion/inicio',
      intro: ['El informe de gestión junta los reportes de las áreas en un solo documento para la gerencia: primero lo que requiere decisión. Avanza por una cadena de seis pasos, cada uno con su responsable y su plazo.'],
      pasos: [
        { titulo: 'Sigue la cadena de seis pasos', img: 'informe',
          texto: ['Entra a **Informe de gestión**. Arriba está la cadena ((1)):',
            [ '1. El área prepara su reporte.', '2. La jefatura lo valida.', '3. **Administración consolida y envía** (tú).', '4. Finanzas y Cobranzas aprueban.', '5. Control revisa y propone decisiones.', '6. Gerencia decide.' ],
            'Cada paso muestra quién lo tiene, si está a tiempo o **Atrasado**, y su plazo (en días hábiles del mes siguiente).'],
          marcas: [{ n: 1, t: 'La cadena del informe: quién tiene cada paso y su plazo.' }, { n: 2, t: 'El botón de tu paso (aquí, [[Enviar a Finanzas y Cobranzas]]).' }, { n: 3, t: 'Descargar el informe en Excel o PDF.' }] },
        { titulo: 'Lee el informe antes de enviarlo', img: 'informe-doc',
          texto: ['El informe se arma solo con lo que enviaron las áreas. Revisa, de arriba abajo:',
            [ '**Lo más urgente**, en una línea.', '**Las áreas en una mirada**: el estado de cada una (en orden, atención, sin datos).', '**Requiere su decisión**: cada alerta con por qué pasa, su impacto y la decisión sugerida.', '**Decisiones**: lo que se propone a la gerencia.', '**Indicadores clave** de cada área, con su meta.' ],
            'Mientras no lo envías, las cifras están **en vivo**; al enviarlo quedan congeladas.'],
          marcas: [{ n: 1, t: 'Lo más urgente del mes.' }, { n: 2, t: 'Las áreas en una mirada.' }, { n: 3, t: 'Lo que requiere decisión de la gerencia.' }],
          ojo: ['Si una área todavía no te entrega su reporte, el informe lo avisa («Aún no recibes el reporte de…»). Puedes enviarlo igual, pero conviene esperar o pedírselo.'] }
      ] },
    { id: 'agenda', titulo: 'Agenda general de todas las áreas', ruta: '#/dep_administracion/agenda:general',
      intro: ['La agenda general muestra en un solo calendario los vencimientos, recordatorios y fechas de todas las áreas.'],
      pasos: [
        { titulo: 'Revisa el calendario de todas las áreas', img: 'agenda',
          texto: ['Entra a **Agenda general**. Cada fecha lleva el nombre corto del área. Puedes filtrar por área y tocar un día para ver el detalle.'],
          marcas: [{ n: 1, t: 'Filtrar por área.' }, { n: 2, t: 'Los colores de cada tipo de fecha.' }, { n: 3, t: 'Un día con fechas de varias áreas.' }] }
      ] },
    { id: 'admin', titulo: 'Cadena y accesos (solo el administrador)', ruta: '#/dep_administracion/cadena',
      intro: ['El administrador define quién revisa el informe de gestión y quién entra a Administración.'],
      pasos: [
        { titulo: 'Asigna la cadena del informe', img: 'cadena',
          texto: ['En **Cadena de reportes**, cada rol del informe (Gerencia de Administración y Finanzas, Facturación y Cobranzas, Control y Gerencia) tiene su [[Editar]] para elegir a la persona. Abajo están los **plazos** de cada paso, en días hábiles del mes siguiente.'],
          marcas: [{ n: 1, t: 'Cada rol de la cadena con su persona.' }, { n: 2, t: '[[Editar]] para asignarla.' }, { n: 3, t: 'Los plazos de cada paso.' }],
          ojo: ['Mientras un rol esté **sin asignar**, el informe no puede pasar por ese paso.'] },
        { titulo: 'Decide quién entra a Administración', texto: ['En **Accesos**, toca [[Editar]] y agrega a las personas de Administración: **Jefatura** valida, **Registra** trabaja. Quién libera los servicios se define en Calidad › Servicios prestados › Quién libera.'] }
      ] }
  ],
  preguntas: [
    { p: '¿Puedo corregir un reporte que ya recibí?', r: ['No: al recibirlo, sus cifras quedan congeladas para que el informe sea consistente. Si hubo un error, el área puede crear un **reporte extraordinario** del mismo mes con la corrección.'] },
    { p: '¿Qué pasa si un área no envía su reporte a tiempo?', r: ['Su paso aparece **Atrasado** en la cadena y en «Reportes de las áreas» como sin enviar. SIGSO le avisa al área; tú puedes enviar el informe igual, con el aviso de que falta.'] }
  ]
});
