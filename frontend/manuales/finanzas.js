/**
 * Manual de Finanzas (la bóveda) — v3 «banco primero» (21-10-2026): el libro del banco
 * como la planilla BANCOS, El mes paso a paso, subir archivos (cartola, detalle, Excel
 * BANCOS), clasificar y formar grupos de fondos, enseñar nombres, clientes del mes,
 * cobranza, flujo por mes, cierre, errores y seguridad.
 * Capturas de la empresa de demostración (clientes, personas y montos ficticios).
 */
(function () {
  'use strict';

  SigsoManual.registrar({
    id: 'finanzas', titulo: 'Finanzas: el libro del banco, los fondos de los clientes, la cobranza y el cierre del mes',
    para: 'Quienes llevan las finanzas del grupo (y la gerencia, en modo lectura)',
    resumen: ['Finanzas funciona como la planilla BANCOS: una fila por cada movimiento de la cuenta del banco, con de quién es, qué es (honorario, gasto, plata de un cliente para sus obligaciones…) y su grupo de fondos. La diferencia es que la cartola entra sola, los totales se calculan solos y lo que se enseña una vez se recuerda.'],
    antes: ['Finanzas solo lo ven las personas de una **lista fija** que vive en el servidor. Si no está en tu barra lateral, no tienes acceso.',
      'Para abrirla necesitas **Google Authenticator** en tu teléfono, activado la primera vez con tu contraseña de SIGSO.',
      'Las palabras son las de la planilla: **ABONO** es honorario (plata de la empresa); **IVA**, **IMPOSICIONES** y **convenios** son plata del cliente que se paga por él; un **grupo** junta lo que el cliente mandó con lo que se pagó, y lo que sobra es el **remanente**.',
      'Para practicar con datos inventados, toca **Ver ejemplo**, al lado de «Manual de uso».'],
    capitulos: [
      { id: 'abrir', titulo: 'Abre la bóveda', ruta: '#/finanzas',
        intro: ['Finanzas tiene su propio candado, aparte de tu sesión de SIGSO. Se cierra sola tras 15 minutos sin uso; el reloj de arriba a la derecha dice cuánto queda.'],
        pasos: [
          { titulo: 'El código de 6 dígitos', img: 'candado',
            texto: [['Abre **Finanzas** en la barra lateral.', 'En Google Authenticator, busca **SIGSO Finanzas**.', 'Escribe los 6 dígitos ((1)) y toca [[Abrir bóveda]] ((2)).']],
            marcas: [{ n: 1, t: 'Los 6 dígitos: cambian cada 30 segundos.' }, { n: 2, t: '[[Abrir bóveda]].' }],
            ojo: ['Cada código sirve **una sola vez**. Tras 5 códigos incorrectos, la bóveda se bloquea 15 minutos para tu cuenta.'] }
        ] },
      { id: 'mapa', titulo: 'Las cinco partes de Finanzas', ruta: '#/finanzas',
        pasos: [
          { titulo: 'La columna de Finanzas', img: 'mapa',
            marcas: [{ n: 1, t: '**El mes**: qué toca ahora, el banco del mes y lo que falta para cerrarlo. Empieza aquí.' },
              { n: 2, t: '**Libro del banco**: la planilla BANCOS de SIGSO. Aquí se trabaja casi todo.' },
              { n: 3, t: '**Clientes**: los clientes con movimiento en el mes, sus fondos y sus facturas.' },
              { n: 4, t: '**Informes**: el flujo mes a mes (como las hojas FLUJO), el informe del mes en PDF, el presupuesto y la exportación a Excel.' },
              { n: 5, t: '**Configuración**: subir archivos, cierre de meses, cuentas, catálogos, nombres, seguridad y bitácora.' },
              { n: 6, t: '[[Manual de uso]] y [[Ver ejemplo]].' }] }
        ] },
      { id: 'mes', titulo: 'El mes, paso a paso', ruta: '#/finanzas',
        intro: ['La portada de quien opera. Dice cómo está el banco del mes, qué toca ahora y qué falta para dejarlo cerrado. Nada se marca a mano: cada paso queda listo cuando SIGSO ve que está hecho.'],
        pasos: [
          { titulo: 'Qué toca ahora', img: 'mes',
            marcas: [{ n: 1, t: 'El mes con que trabajas.' }, { n: 2, t: '**El banco este mes**: lo que entró y salió, el saldo final, honorarios, gastos, fondos de clientes y cuántas filas faltan revisar.' },
              { n: 3, t: '**Lo que toca ahora**, con su botón.' }, { n: 4, t: 'Los pasos del mes, en orden: cartola, detalle del banco, Excel BANCOS (opcional), revisar el libro, ventas del SII y cerrar.' }],
            consejo: ['Si aparece **N nombre(s) de la planilla por enseñar**, ábrelo: ahí se dice una sola vez de quién es cada nombre corto (ver el capítulo «Enseña los nombres cortos»).'] }
        ] },
      { id: 'subir', titulo: 'Sube la cartola, el detalle o el Excel BANCOS', ruta: '#/finanzas',
        intro: ['Todo se sube en un solo lugar: **Configuración → Subir archivos** (o el botón [[Subir cartola o planilla]] del libro). SIGSO reconoce qué archivo es.'],
        pasos: [
          { titulo: 'El centro de cargas', img: 'cargas',
            texto: [['**Cartola del banco** (Excel, no PDF): revisa que los saldos cuadren y toca [[Importar]]. Subirla dos veces no duplica nada.', '**Mis Movimientos** del BCI: completa el nombre de quien transfirió de verdad.',
              '**Excel BANCOS**: elige la cuenta de la hoja y toca [[Llevar AAAA-MM]] por cada mes. Cada fila se une a su movimiento de la cartola, se clasifica como dice la columna OBS y se arman sus grupos (las fórmulas de UNITARIO). Si ese mes no tiene cartola, las filas entran marcadas **sin cartola** (no verificadas) hasta que llegue.']],
            marcas: [{ n: 1, t: 'Aquí se suelta cualquier archivo.' }, { n: 2, t: 'Qué se puede subir y dónde queda.' }],
            ojo: ['Al llevar un mes, SIGSO avisa las filas de la planilla que **el banco no trae ese mes** (por ejemplo, un pago anotado el 31 que el banco registró el 1 del mes siguiente). No se inventan: se revisan.'] }
        ] },
      { id: 'libro', titulo: 'Trabaja en el libro del banco', ruta: '#/finanzas',
        intro: ['Es la planilla BANCOS dentro de SIGSO: cada fila es un movimiento de la cuenta, con su categoría y su saldo acumulado del mes.'],
        pasos: [
          { titulo: 'El libro del mes', img: 'libro',
            marcas: [{ n: 1, t: 'Mes, cuenta y búsqueda (nombre, cliente o monto).' },
              { n: 2, t: '**Cuadre del mes**: saldo inicial + entró − salió = saldo final, y lo que dice la cartola. Si dice **Cuadra con la cartola**, no falta ni sobra nada.' },
              { n: 3, t: 'Los totales por categoría, como el resumen de arriba de la planilla. Tocar uno filtra la tabla.' },
              { n: 4, t: 'Qué mostrar: por revisar, honorarios, gastos, fondos de clientes, traspasos o lo que llegó sin cartola.' },
              { n: 5, t: 'Una fila: fecha, quién y lo que dice el banco, la categoría, el cliente o concepto y el grupo.' },
              { n: 6, t: 'El saldo acumulado del mes (la columna SALDO de la planilla).' }],
            texto: ['Las filas con borde naranjo están **por revisar**: debajo dice lo que anotaron en la planilla, si había algo.'] },
          { titulo: 'Clasifica una fila', img: 'libro-panel',
            texto: [['Toca la fila (o Enter con el teclado).', 'Mira lo que dice el banco, la planilla y la propuesta de SIGSO ((1)).', 'Elige **qué es** ((2)) y completa la cuenta u obligación y el cliente ((3)).', 'Toca [[Guardar]] ((4)).']],
            marcas: [{ n: 1, t: 'Lo que se sabe del movimiento.' }, { n: 2, t: 'Qué es: ingreso de la empresa, fondo del cliente recibido, pago por cuenta del cliente, gasto, traspaso o préstamo.' }, { n: 3, t: 'Cuenta u obligación y cliente.' }, { n: 4, t: '[[Guardar]].' }],
            consejo: ['Con **Recordar** marcado, SIGSO aprende que ese nombre es de ese cliente y la próxima vez lo propone solo.'] }
        ] },
      { id: 'grupos', titulo: 'Forma los grupos de fondos (lo que hacía UNITARIO)', ruta: '#/finanzas',
        intro: ['Cuando un cliente manda plata para sus imposiciones o su IVA y después se paga por él, esas filas forman un **grupo**: lo que entró menos lo que se pagó es el **remanente**. Es lo mismo que la fórmula de la columna UNITARIO de la planilla.'],
        pasos: [
          { titulo: 'Formar un grupo', img: 'libro-grupo',
            texto: [['En el libro, marca las filas del grupo con su casilla (lo que el cliente mandó y lo que se pagó).', 'Abajo aparece cuánto suman: eso será el remanente.', 'Toca [[Formar grupo de fondos]], elige el cliente ((1)), la obligación ((2)) y su período ((3)), y toca [[Formar el grupo]] ((4)).']],
            marcas: [{ n: 1, t: 'El cliente.' }, { n: 2, t: 'La obligación: imposiciones, IVA, convenio, renta…' }, { n: 3, t: 'El mes de la obligación (normalmente, el anterior al pago).' }, { n: 4, t: '[[Formar el grupo]].' }],
            consejo: ['Los grupos del Excel BANCOS se arman solos al llevar el mes. Lo que sobra de un grupo cerrado con OBS «ABONO» queda cobrado como honorario, igual que en la planilla.'] },
          { titulo: 'Los fondos de cada cliente', img: 'fondos',
            marcas: [{ n: 1, t: 'Saldos iniciales, aprobaciones y nueva gestión.' }, { n: 2, t: 'Quién puede aprobar un saldo inicial.' }, { n: 3, t: 'Clientes sin saldo inicial aprobado: su saldo es **parcial**.' }, { n: 4, t: 'A favor, en negativo, sin saldo inicial.' }, { n: 5, t: 'Un cliente: su ficha con cada grupo y su remanente.' }],
            ojo: ['Una diferencia, aunque sea de $1, **se conserva**: no se ajusta sola. El remanente se decide por escrito: mantenerlo, devolverlo o cobrarlo como honorario con respaldo.'] }
        ] },
      { id: 'nombres', titulo: 'Enseña los nombres cortos', ruta: '#/finanzas',
        intro: ['En la planilla cada fila tiene un nombre corto («ARMA HIERRO», «VYE», «JB»…). SIGSO reconoce solo la mayoría; los que no conoce aparecen en **El mes** como **nombres por enseñar**.'],
        pasos: [
          { titulo: 'Decir de quién es cada nombre', texto: [['En **El mes**, abre **N nombre(s) de la planilla por enseñar**.', 'Para cada nombre: elige si es **un cliente** (y cuál), **una empresa del grupo**, **un gasto de la empresa** o **nadie**. Al lado ves cuántas filas tiene y quién pagó según el banco.', 'Toca [[Guardar y clasificar esas filas]]: SIGSO clasifica solas todas las filas con esos nombres, sin volver a subir el Excel.']],
            consejo: ['Si SIGSO propone un cliente por parecido, revísalo antes de guardar: un nombre corto puede parecerse a otro cliente.'] }
        ] },
      { id: 'clientes', titulo: 'Los clientes del mes', ruta: '#/finanzas',
        pasos: [
          { titulo: 'Con movimiento en el mes', img: 'clientes-mes',
            marcas: [{ n: 1, t: '**Con movimiento en el mes** o **Todos los clientes** (el catálogo completo).' }, { n: 2, t: 'El mes.' },
              { n: 3, t: 'Un cliente: honorarios del mes, lo que mandó para sus obligaciones, lo que se pagó por él, el saldo de sus fondos y lo que debe en facturas. Tócalo para abrir su ficha.' }, { n: 4, t: 'Los totales.' }] }
        ] },
      { id: 'cobranza', titulo: 'Aplica los cobros a sus facturas', ruta: '#/finanzas',
        intro: ['**Clientes → Facturas y cobranza** muestra lo que falta cobrar, factura por factura. Un cobro recibido no paga una factura hasta que una persona lo **aplica**.'],
        pasos: [
          { titulo: 'La bandeja de cobranza', img: 'cobranza',
            marcas: [{ n: 1, t: 'Emisor, cliente, vencimiento y búsqueda.' }, { n: 2, t: 'Facturado, saldo, vencido, cobros sin aplicar y lo propuesto (aparte).' }, { n: 3, t: 'Abiertas, vencidas, pagadas…' },
              { n: 4, t: 'Una factura con su saldo y estado.' }, { n: 5, t: '[[Aplicar cobro]] a las marcadas.' }, { n: 6, t: '[[Ver]]: aplicaciones, desaplicar con motivo, vencimiento.' }, { n: 7, t: '[[Relaciones de terceros]]: quién paga por quién.' }] },
          { titulo: 'Aplicar un pago (también uno parcial)', img: 'aplicar',
            texto: [['En la factura, toca [[Aplicar]].', 'Marca el cobro ((2)) y reparte el importe ((4)): si es menos que el saldo, la factura queda en **Pago parcial**.', 'Toca [[Confirmar aplicación]] ((5)).']],
            marcas: [{ n: 1, t: 'Las facturas y lo que falta.' }, { n: 2, t: 'Los cobros que se pueden usar.' }, { n: 3, t: 'Fecha de la aplicación.' }, { n: 4, t: 'Cuánto va a cada factura.' }, { n: 5, t: '[[Confirmar aplicación]].' }] }
        ] },
      { id: 'informes', titulo: 'El flujo por mes y el informe', ruta: '#/finanzas',
        pasos: [
          { titulo: 'Flujo por mes (como las hojas FLUJO)', img: 'flujo',
            marcas: [{ n: 1, t: 'Hasta qué mes.' }, { n: 2, t: 'Cuántos meses mirar.' }, { n: 3, t: 'Cada sección: ingresos, gastos, fondos de clientes, traspasos.' },
              { n: 4, t: '**Resultado propio**: ingresos menos gastos de la empresa (sin la plata de los clientes).' }, { n: 5, t: 'Si cada mes está verificado contra la cartola, sin cartola o con filas por revisar.' }] },
          { titulo: 'El informe del mes y el PDF', img: 'resumen',
            marcas: [{ n: 1, t: '[[Exportar]] y [[Descargar PDF]].' }, { n: 2, t: 'Mes, alcance, base y comparación.' }, { n: 3, t: 'Si los datos son provisorios y por qué.' }, { n: 4, t: 'Flujo del mes.' }, { n: 5, t: 'Liquidez: banco, fondos de clientes y disponibilidad propia.' }, { n: 6, t: 'Lo que conviene revisar.' }] }
        ] },
      { id: 'cierre', titulo: 'Cierra el mes', ruta: '#/finanzas',
        intro: ['Un mes cerrado queda **fijo**. Se puede reabrir con motivo; la versión anterior se conserva.'],
        pasos: [
          { titulo: 'La revisión del período', img: 'cierre',
            marcas: [{ n: 1, t: 'La política de cierre.' }, { n: 2, t: 'Los meses y su estado.' }, { n: 3, t: 'El siguiente paso.' }, { n: 4, t: 'Lo que bloquea el cierre.' }, { n: 5, t: 'Lo que está listo.' }, { n: 6, t: 'Aceptar una excepción con motivo.' }, { n: 7, t: 'Cerrar.' }] }
        ] },
      { id: 'errores', titulo: 'Cuando algo falla', ruta: '#/finanzas',
        pasos: [
          { titulo: 'Qué hacer', texto: [[
            '**No cuadra con la cartola**: falta o sobra un movimiento. Revisa que estén todas las cartolas del mes (del 1 al último día) y sube la que falte.',
            '**Sin cartola**: esas filas vienen de la planilla; cuando subas la cartola de ese mes se verifican.',
            '**«No se pudo cargar» con [[Reintentar]]**: la pantalla no recibió los datos. Toca [[Reintentar]].',
            '**«Otra persona cambió este movimiento»**: alguien guardó antes que tú. Vuelve a abrirlo y guarda de nuevo.',
            '**Un botón apagado**: tu acceso no incluye esa acción. Pídelo a la administración.']] }
        ] },
      { id: 'seguridad', titulo: 'Seguridad y bitácora', ruta: '#/finanzas',
        pasos: [
          { titulo: 'Buenas prácticas', texto: [['Cierra la bóveda con el candado al dejar el computador.', 'No compartas tu código ni tu teléfono.', 'En **Configuración → Bitácora** queda todo lo que se hizo; si ves un ingreso que no reconoces, avisa de inmediato.']] }
        ] }
    ],
    preguntas: [
      { p: '¿Dónde quedó el «Registro diario»?', r: ['Ahora se trabaja directo en el **libro del banco**, como en la planilla BANCOS: cada movimiento de la cartola es una fila. Lo que no pasa por el banco (efectivo, compensaciones) aparece en «Fuera del banco».'] },
      { p: '¿Por qué una fila de la planilla no aparece en el libro?', r: ['Porque el banco no la trae ese mes (por ejemplo, la registró al día siguiente, en el mes que viene). Al llevar el mes, SIGSO la lista como «no está en el banco».'] },
      { p: '¿Qué pasa si llevo el mismo mes dos veces?', r: ['Nada: lo ya unido y clasificado no se toca y los grupos no se duplican.'] },
      { p: 'Un cliente pagó desde la cuenta de otra persona.', r: ['Clasifica la fila con el cliente correcto y deja marcado **Recordar**: la próxima vez SIGSO lo propone.'] },
      { p: '¿Por qué el saldo de fondos de un cliente dice «parcial»?', r: ['Falta su saldo inicial aprobado: puede haber mandado plata antes de la primera cartola. Cárgalo en **Fondos de clientes → Cargar saldos iniciales**.'] }
    ]
  });
})();
