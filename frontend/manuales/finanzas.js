/**
 * Manual de Finanzas (la bóveda) — v3 «banco primero» (21-10-2026): anotar cada movimiento como en la planilla
 * BANCOS, la cartola que se une con lo anotado, El mes paso a paso, subir archivos, grupos de fondos,
 * enseñar nombres, clientes del mes,
 * cobranza, flujo por mes, cierre, errores y seguridad.
 * Capturas de la empresa de demostración (clientes, personas y montos ficticios).
 */
(function () {
  'use strict';

  SigsoManual.registrar({
    id: 'finanzas', titulo: 'Finanzas: el libro del banco, los fondos de los clientes, la cobranza y el cierre del mes',
    para: 'Quienes llevan las finanzas del grupo (y la gerencia, en modo lectura)',
    resumen: ['Finanzas funciona como la planilla BANCOS: cada movimiento se **anota** con su fecha, nombre, plan de cuenta, OBS y monto, apenas pasa. Cuando llega la **cartola**, SIGSO une sola cada fila anotada con su movimiento del banco y muestra lo que el banco trae y nadie anotó. Los totales, el saldo del mes y los grupos de fondos se calculan solos, y lo que se enseña una vez se recuerda.'],
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
              { n: 3, t: '**Lo que toca ahora**, con su botón.' }, { n: 4, t: 'Los pasos del mes, en orden: anotar los movimientos, subir la cartola, el detalle del banco, Excel BANCOS (solo meses llenados en la planilla), completar lo que quedó por revisar, ventas del SII y cerrar.' }],
            consejo: ['Si aparece **N nombre(s) de la planilla por enseñar**, ábrelo: ahí se dice una sola vez de quién es cada nombre corto (ver el capítulo «Enseña los nombres cortos»).'] }
        ] },
      { id: 'subir', titulo: 'Sube la cartola, el detalle o el Excel BANCOS', ruta: '#/finanzas',
        intro: ['Todo se sube en un solo lugar: **Configuración → Subir archivos** (o el botón [[Subir cartola o planilla]] del libro). SIGSO reconoce qué archivo es.'],
        pasos: [
          { titulo: 'El centro de cargas', img: 'cargas',
            texto: [['**Cartola del banco** (Excel, no PDF): revisa que los saldos cuadren y toca [[Importar]]. Cada fila que ya anotaste se **une sola** con su movimiento (mismo monto, hasta 3 días de diferencia) y pasa a ✓; lo que el banco trae y nadie anotó queda **falta anotar**. Subirla dos veces no duplica nada.', '**Mis Movimientos** del BCI: completa el nombre de quien transfirió de verdad.',
              '**Excel BANCOS** (solo los meses que se llenaron en la planilla): elige la cuenta de la hoja y toca [[Llevar AAAA-MM]] por cada mes. Cada fila se une a su movimiento de la cartola, se clasifica como dice la columna OBS y se arman sus grupos (las fórmulas de UNITARIO). Si ese mes no tiene cartola, las filas quedan **esperando cartola** hasta que llegue.']],
            marcas: [{ n: 1, t: 'Aquí se suelta cualquier archivo.' }, { n: 2, t: 'Qué se puede subir y dónde queda.' }],
            ojo: ['Al llevar un mes, SIGSO avisa las filas de la planilla que **el banco no trae ese mes** (por ejemplo, un pago anotado el 31 que el banco registró el 1 del mes siguiente). No se inventan: se revisan.'] }
        ] },
      { id: 'libro', titulo: 'El libro del banco', ruta: '#/finanzas',
        intro: ['Es la planilla BANCOS dentro de SIGSO: cada fila es un movimiento de la cuenta, con las mismas columnas (fecha, nombre, plan de cuenta, OBS, monto, saldo y detalle del banco) y lo que SIGSO entiende de ella.'],
        pasos: [
          { titulo: 'El libro del mes', img: 'libro',
            marcas: [{ n: 1, t: '**Cómo va el mes**: cuántas filas están en el banco ✓, cuántas esperan la cartola, cuántas trae el banco sin anotar y cuántas quedaron por revisar. Tocar una filtra la tabla.' },
              { n: 2, t: '**Anotar movimiento**: la fila nueva, como en la planilla (ver el capítulo siguiente).' },
              { n: 3, t: '**Cuadre del mes**: saldo inicial + entró − salió = saldo final, contra lo que dice la cartola. Lo que espera la cartola no entra al cuadre hasta que el banco lo traiga.' },
              { n: 4, t: 'Los totales por categoría, como el resumen de arriba de la planilla (ABONO, gastos, fondos de clientes…).' },
              { n: 5, t: 'Qué mostrar: falta anotar, esperando cartola, por revisar, honorarios, gastos, fondos o traspasos.' },
              { n: 6, t: 'Una fila: fecha, nombre, plan de cuenta, OBS, monto, el saldo acumulado del mes (la columna SALDO), lo que dice el banco y **qué es**.' },
              { n: 7, t: 'En el banco: ✓ (está en la cartola), **esperando** (anotada, falta la cartola) o [[Anotar]] (el banco la trae y nadie la anotó).' }],
            texto: ['Las filas con borde naranjo están **por revisar** o **falta anotar**.'] }
        ] },
      { id: 'anotar', titulo: 'Anota cada movimiento (día a día)', ruta: '#/finanzas',
        intro: ['Esto reemplaza llenar la planilla BANCOS. Se anota apenas pasa algo en la cuenta (llegó una transferencia, se pagó un Previred, un sueldo…), sin esperar la cartola. Con el nombre y la OBS, SIGSO sabe qué es, igual que la planilla.'],
        pasos: [
          { titulo: 'Anotar una fila', img: 'libro-anotar',
            texto: [['En el **Libro del banco**, completa la fila de arriba: fecha ((1)), nombre ((2)), plan de cuenta si corresponde ((3)), OBS ((4)), monto ((5)) y, si quieres, lo que dice el banco ((6)).', 'Toca [[Anotar]] ((7)) o presiona **Enter**. La fila queda lista para la siguiente, con la misma fecha.']],
            marcas: [{ n: 1, t: 'La fecha del movimiento.' }, { n: 2, t: 'El **nombre** como en la planilla: el cliente («ANDES MONTAJES»), «ARRIENDO», «SUELDO»… Al escribir, SIGSO sugiere los que ya conoce.' },
              { n: 3, t: 'El **plan de cuenta** (ARRIENDO, ANTICIPO SUELDO, CONVENIO…): opcional, ayuda a saber qué gasto u obligación es.' },
              { n: 4, t: 'La **OBS**: ABONO (honorario si entra, gasto si sale), ABONO RENTA, IMPOSICIONES, IVA, SALDO o PENDIENTE (plata del cliente).' },
              { n: 5, t: 'El **monto**: positivo si entró, **negativo si salió** (como la columna TOTAL).' }, { n: 6, t: 'Lo que dice el banco (opcional).' }, { n: 7, t: '[[Anotar]].' },
              { n: 8, t: 'Mientras escribes, SIGSO dice si entra o sale, de quién es el nombre y qué significa la OBS.' }],
            consejo: ['Si el nombre es nuevo, la fila queda **por revisar**: ábrela, di de qué cliente es y SIGSO lo recordará para siempre.'] },
          { titulo: 'Pegar varias filas desde Excel', img: 'libro-pegar',
            texto: [['Toca [[Pegar desde Excel]] arriba del libro.', 'Copia las filas de la planilla BANCOS (desde TOTAL hasta DETALLE BANCO) y pégalas ((1)). También sirve en el orden de esta pantalla: fecha, nombre, plan, OBS, monto, detalle.', 'Revisa la vista previa ((2)): las filas sin fecha o sin monto (como los totales) se saltan solas.', 'Toca [[Anotar filas]] ((3)).']],
            marcas: [{ n: 1, t: 'Aquí se pega (Ctrl+V).' }, { n: 2, t: 'Cuántas filas entran, cuánto suman y cuáles se saltan.' }, { n: 3, t: '[[Anotar filas]].' }],
            ojo: ['Los grupos de la columna UNITARIO no viajan al pegar (solo los valores): se forman después en el libro. Para traer un mes completo con sus grupos, sube el Excel en **Subir archivos**.'] }
        ] },
      { id: 'cartola', titulo: 'Cuando llega la cartola', ruta: '#/finanzas',
        intro: ['La cartola es la verdad. Al subirla, cada fila anotada se une con su movimiento del banco y pasa a ✓. Lo que no se pueda unir queda a la vista para revisarlo.'],
        pasos: [
          { titulo: 'Lo que el banco trae y nadie anotó', img: 'libro-falta',
            texto: [['Toca **Falta anotar** ((1)): son movimientos de la cartola sin anotación ((2)), por ejemplo un «pago cuentas vía internet» que el banco no explica.', 'Toca [[Anotar]] ((3)) y complétala como cualquier fila (el monto y la fecha ya vienen del banco).']],
            marcas: [{ n: 1, t: 'El filtro **Falta anotar**.' }, { n: 2, t: 'La fila del banco sin anotar.' }, { n: 3, t: '[[Anotar]].' }],
            ojo: ['Si una fila anotada sigue **esperando** después de subir la cartola, revisa su fecha o su monto: puede que el banco la haya registrado otro día, o que se anotara con un error.'] },
          { titulo: 'Corregir o completar una fila', img: 'libro-panel',
            texto: [['Toca la fila (o Enter con el teclado).', 'Arriba ves si está en el banco y quién la anotó ((1)).', 'Corrige el nombre, el plan, la OBS, el detalle o la nota ((2)); si todavía espera la cartola, también la fecha y el monto. Toca [[Guardar]] ((5)).', 'Si el nombre es nuevo, di **de qué cliente es** ((3)): SIGSO lo recuerda y clasifica todas las filas del mes con ese nombre.']],
            marcas: [{ n: 1, t: 'Banco: ✓, esperando o sin anotar; y quién la anotó.' }, { n: 2, t: 'Lo anotado, como en la planilla.' }, { n: 3, t: '¿De qué cliente es este nombre?' }, { n: 4, t: '**Decirlo a mano**: para casos especiales (traspaso, préstamo, repartir en partes…).' }, { n: 5, t: '[[Guardar]] y [[Borrar fila]].' }],
            consejo: ['Borrar una fila que ya está en el banco solo borra lo anotado: el movimiento queda «falta anotar».'] }
        ] },
      { id: 'grupos', titulo: 'Forma los grupos de fondos (lo que hacía UNITARIO)', ruta: '#/finanzas',
        intro: ['Cuando un cliente manda plata para sus imposiciones o su IVA y después se paga por él, esas filas forman un **grupo**: lo que entró menos lo que se pagó es el **remanente**. Es lo mismo que la fórmula de la columna UNITARIO de la planilla.'],
        pasos: [
          { titulo: 'Formar un grupo', img: 'libro-grupo',
            texto: [['En el libro, marca las filas del grupo con su casilla (lo que el cliente mandó y lo que se pagó).', 'Arriba de la tabla aparece cuánto suman: eso es lo que sobra (o falta).', 'Toca [[Formar grupo de fondos]], elige el cliente ((1)), la obligación ((2)) y su período ((3)).', 'Di qué pasa con lo que sobra ((4)), como la OBS de la fila que cerraba el grupo en la planilla, y toca [[Guardar grupo]] ((5)).']],
            marcas: [{ n: 1, t: 'El cliente.' }, { n: 2, t: 'La obligación: imposiciones, IVA, convenio, renta…' }, { n: 3, t: 'El mes de la obligación (normalmente, el anterior al pago).' },
              { n: 4, t: 'Lo que sobra: **Pendiente** (el grupo sigue abierto), **ABONO** o **ABONO RENTA** (se cobra como honorario) o **SALDO** (queda a favor del cliente).' }, { n: 5, t: '[[Guardar grupo]].' }],
            consejo: ['Si el cliente manda más plata después, marca la fila nueva y elige **Sumar a** su grupo. Para sacar una fila de un grupo, ábrela y toca [[Sacar del grupo]].', 'Los grupos del Excel BANCOS se arman solos al llevar el mes.'] },
          { titulo: 'Los fondos de cada cliente', img: 'fondos',
            marcas: [{ n: 1, t: 'Saldos iniciales, aprobaciones y nueva gestión.' }, { n: 2, t: 'Quién puede aprobar un saldo inicial.' }, { n: 3, t: 'Clientes sin saldo inicial aprobado: su saldo es **parcial**.' }, { n: 4, t: 'A favor, en negativo, sin saldo inicial.' }, { n: 5, t: 'Un cliente: su ficha con cada grupo y su remanente.' }],
            ojo: ['Una diferencia, aunque sea de $1, **se conserva**: no se ajusta sola. El remanente se decide por escrito: mantenerlo, devolverlo o cobrarlo como honorario con respaldo.'] }
        ] },
      { id: 'nombres', titulo: 'Enseña los nombres cortos', ruta: '#/finanzas',
        intro: ['En la planilla cada fila tiene un nombre corto («ARMA HIERRO», «VYE», «JB»…). SIGSO reconoce solo la mayoría; los que no conoce aparecen en **El mes** como **nombres por enseñar**, y también se enseñan desde la fila misma («¿De qué cliente es…?»).'],
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
      { p: '¿Dónde quedó el «Registro diario»?', r: ['Ahora se anota directo en el **libro del banco**, en la fila **Anotar movimiento** de arriba, como en la planilla BANCOS. Al subir la cartola, cada fila anotada se une con su movimiento del banco. Lo que no pasa por el banco (efectivo, compensaciones) aparece en «Fuera del banco».'] },
      { p: '¿Hay que seguir llenando el Excel BANCOS?', r: ['No. Desde que se empieza a anotar en SIGSO, el Excel ya no hace falta. El Excel solo se sube para los meses que ya estaban llenados en la planilla (por ejemplo, septiembre y la primera mitad de octubre). No subas el Excel de un mes que ya anotaste en SIGSO: quedarían filas repetidas.'] },
      { p: '¿Por qué una fila de la planilla no aparece en el libro?', r: ['Porque el banco no la trae ese mes (por ejemplo, la registró al día siguiente, en el mes que viene). Al llevar el mes, SIGSO la lista como «no está en el banco».'] },
      { p: '¿Qué pasa si llevo el mismo mes dos veces?', r: ['Nada: lo ya unido y clasificado no se toca y los grupos no se duplican.'] },
      { p: 'Un cliente pagó desde la cuenta de otra persona.', r: ['Clasifica la fila con el cliente correcto y deja marcado **Recordar**: la próxima vez SIGSO lo propone.'] },
      { p: '¿Por qué el saldo de fondos de un cliente dice «parcial»?', r: ['Falta su saldo inicial aprobado: puede haber mandado plata antes de la primera cartola. Cárgalo en **Fondos de clientes → Cargar saldos iniciales**.'] }
    ]
  });
})();
