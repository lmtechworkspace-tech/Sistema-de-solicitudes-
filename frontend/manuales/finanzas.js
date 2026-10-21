/**
 * Manual de Finanzas (la bóveda) — guía para operadoras, corrección v2 (I14):
 * abrir la bóveda, ubicarse, registrar, reutilizar, pegar desde Excel, subir el
 * banco, conciliar, aplicar cobros a facturas, asignar fondos de clientes,
 * resolver pendientes y errores, leer el informe y cerrar el mes.
 * Capturas de la empresa de demostración (clientes, personas y montos ficticios).
 */
(function () {
  'use strict';

  SigsoManual.registrar({
    id: 'finanzas', titulo: 'Finanzas: el registro diario, el banco, la cobranza, los fondos de clientes y el cierre',
    para: 'Quienes llevan las finanzas del grupo (y la gerencia, en modo lectura)',
    resumen: ['Cómo registrar lo que entra y sale, unirlo con el banco sin contarlo dos veces, aplicar los cobros a sus facturas, llevar la plata que los clientes mandan para sus obligaciones y cerrar el mes. Reemplaza a la planilla SIGECO y al Excel BANCOS: lo que antes se copiaba de un lado a otro, aquí se escribe una vez.'],
    antes: ['Finanzas solo lo ven las personas de una **lista fija** que vive en el servidor: nadie puede darse acceso desde una pantalla. Si no está en tu barra lateral, no tienes acceso.',
      'Para abrirla necesitas **Google Authenticator** en tu teléfono, activado la primera vez con tu contraseña de SIGSO.',
      'Lo que cada persona puede hacer (registrar, conciliar, aplicar, cerrar…) lo define la administración. Si un botón aparece apagado, tu acceso no lo incluye. La gerencia entra en **solo lectura**.',
      'Tres palabras que se repiten: **borrador** (guardado, pero todavía no cuenta en las cifras), **confirmada** (cuenta) y **conciliada** (confirmada y unida a su movimiento del banco).',
      'Para practicar con datos inventados, toca **Ver ejemplo**, al lado de «Manual de uso».'],
    capitulos: [
      { id: 'abrir', titulo: 'Abre la bóveda', ruta: '#/finanzas',
        intro: ['Finanzas tiene su propio candado, aparte de tu sesión de SIGSO. Se cierra sola tras 15 minutos sin uso; el reloj de arriba a la derecha dice cuánto queda.'],
        pasos: [
          { titulo: 'El código de 6 dígitos', img: 'candado',
            texto: [['Abre **Finanzas** en la barra lateral.', 'En Google Authenticator, busca **SIGSO Finanzas**.', 'Escribe los 6 dígitos ((1)) y toca [[Abrir bóveda]] ((2)).']],
            marcas: [{ n: 1, t: 'Los 6 dígitos: cambian cada 30 segundos.' }, { n: 2, t: '[[Abrir bóveda]].' }],
            ojo: ['Cada código sirve **una sola vez**. Tras 5 códigos incorrectos, la bóveda se bloquea 15 minutos para tu cuenta.'],
            consejo: ['Al cerrar la bóveda, la pantalla borra las cifras que mostraba. Si tenías una fila a medio escribir, al volver a abrir SIGSO te la ofrece para guardarla.'] }
        ] },
      { id: 'mapa', titulo: 'Ubícate: dónde está cada cosa', ruta: '#/finanzas',
        intro: ['Las pantallas de Finanzas están en la columna izquierda, agrupadas por lo que haces: **Trabajo diario**, **Clientes**, **Bancos**, **Planificación**, **Informes**, **Cierre** y **Configuración**.'],
        pasos: [
          { titulo: 'La columna de Finanzas', img: 'mapa',
            marcas: [{ n: 1, t: 'Finanzas: el módulo abierto.' }, { n: 2, t: 'Las áreas y sus pantallas. La que estás viendo queda destacada.' },
              { n: 3, t: '**Pendientes**: todo lo que falta resolver, en una sola lista. Empieza el día aquí.' }, { n: 4, t: '[[Manual de uso]] y [[Ver ejemplo]].' },
              { n: 5, t: 'El tiempo que queda antes de que la bóveda se cierre sola, y el candado para cerrarla tú.' }],
            texto: [['**Trabajo diario**: Registro (lo que entra y sale), Pendientes y Seguimiento del mes.', '**Clientes**: la ficha de cada cliente, sus **Fondos** (la plata que manda para sus obligaciones) y la **Cobranza** de sus facturas.',
              '**Bancos**: las cuentas, la **Conciliación**, los **Movimientos** de la cartola y el **Centro de cargas**.', '**Informes**: el resumen del mes, el PDF y la exportación a Excel.', '**Cierre**: la revisión del período y su cierre.']],
            consejo: ['Cuando una pantalla te lleva a otra (por ejemplo, desde Pendientes), arriba aparece **← Volver a …** para regresar a donde estabas.'] }
        ] },
      { id: 'registrar', titulo: 'Registra lo que entra y sale', ruta: '#/finanzas',
        intro: ['El **Registro diario** es la pantalla de todos los días: una fila por pago o cobro. Puedes registrar antes de que llegue la cartola; después, el banco se une a la fila (conciliación) y no se cuenta dos veces.'],
        pasos: [
          { titulo: 'El registro del mes', img: 'registro',
            marcas: [{ n: 1, t: '[[Pegar desde Excel]], [[Plantillas]] y [[Formulario guiado]] (paso a paso, para quien recién empieza).' },
              { n: 2, t: 'Empresa, cuenta, mes y búsqueda.' }, { n: 3, t: 'Totales del mes: **solo lo confirmado** suma en entradas y salidas; los borradores van aparte.' },
              { n: 4, t: 'Filtros: borradores, datos por completar, falta el banco, confirmadas, anuladas.' }, { n: 5, t: '[[Nueva fila]].' },
              { n: 6, t: 'Una fila confirmada. Al tocarla se abre su panel con todo el detalle.' }, { n: 7, t: 'Lo que le falta a un borrador para poder confirmarse.' }],
            texto: [['Toca [[Nueva fila]] ((5)) y escribe: fecha, quién paga o recibe, el cliente (por nombre o RUT), qué es (**naturaleza**), el concepto y el monto en Entrada o Salida.', 'Con **Tab** pasas a la celda siguiente; con **Enter** guardas y bajas.', 'Al salir de la fila se guarda sola como **borrador**. Cuando tiene todo, se confirma.']],
            ojo: ['**Ingreso de la empresa** es plata que la empresa ganó. Si un cliente manda plata para pagar **sus** imposiciones o su IVA, es **Fondo del cliente recibido**: no es ingreso y no se puede gastar.'],
            consejo: ['Si la fila dice **No guardado**, lo escrito sigue ahí: revisa tu conexión y vuelve a salir de la fila para reintentar. No se duplica.'] },
          { titulo: 'El panel de una operación', img: 'panel',
            texto: [['Toca una fila para abrir su panel.', 'Revisa **la operación** ((2)) y **cómo se reparte** ((3)).', 'Si un pago es de varios clientes o conceptos, toca [[Dividir importe]] ((4)): las partes deben sumar exacto el total.', 'Lee los avisos ((5)) y toca [[Guardar]] ((6)).']],
            marcas: [{ n: 1, t: 'Fecha y estado: borrador, confirmada, falta el banco o conciliada.' }, { n: 2, t: 'Empresa, cuenta, medio, fecha, monto y quién pagó o recibió (puede ser distinto del cliente).' },
              { n: 3, t: 'Naturaleza, concepto, cliente y proyecto de cada parte.' }, { n: 4, t: '[[Dividir importe]].' }, { n: 5, t: 'Avisos: por ejemplo, que el cobro no calza con ninguna factura pendiente.' },
              { n: 6, t: '[[Anular]] (con motivo), [[Guardar como plantilla]] y [[Guardar]].' }],
            consejo: ['Una operación confirmada no se borra: se **anula con motivo** y deja de contar. Un borrador nunca confirmado sí se puede descartar.'] }
        ] },
      { id: 'reutilizar', titulo: 'No escribas dos veces: reutiliza', ruta: '#/finanzas',
        intro: ['Casi todo lo que se paga cada mes ya está escrito en algún lado. Antes de escribir, busca de dónde copiarlo.'],
        pasos: [
          { titulo: 'Cuatro formas de reutilizar', texto: [[
            '**Duplicar** (Ctrl+D en una fila): crea un borrador con lo mismo (quién, concepto, cliente), sin la referencia ni el vínculo con el banco. Cambia la fecha y el monto.',
            '**Plantillas**: guarda una operación como plantilla (desde su panel) y genera los borradores del mes de una vez. La vista previa muestra qué se crea y qué ya existe; nunca sobrescribe.',
            '**Pagar una obligación de Control interno**: en la fila de IVA o imposiciones de Control interno, el enlace **Registrar el pago en Finanzas** abre el registro con los datos ya puestos. Un segundo pago parcial se puede registrar; repetir el mismo no lo duplica.',
            '**Desde el banco**: si el movimiento ya está en la cartola, clasifícalo en **Movimientos** en vez de escribirlo de nuevo.']],
            consejo: ['Si registras algo que el banco ya trae, SIGSO lo marca como **posible duplicado** y no lo suma dos veces hasta que decidas si es el mismo pago o son dos distintos.'] }
        ] },
      { id: 'pegar', titulo: 'Pega filas desde Excel', ruta: '#/finanzas',
        intro: ['Si tienes varias filas en una planilla, cópialas y pégalas: SIGSO revisa cada fila antes de publicar nada.'],
        pasos: [
          { titulo: 'Pegar, revisar y corregir', img: 'pegado',
            texto: [['En el Registro, toca [[Pegar desde Excel]].', 'Pega las filas ((1)) y elige la empresa ((2)). Si la primera fila trae los títulos, márcalo.', 'Revisa qué trae cada columna y toca [[Revisar]].', 'En la revisión ((3)), cada fila dice si está lista, si se parece a una ya registrada o qué error tiene. **Corrige la celda marcada en rojo ahí mismo**: la revisión se renueva sola.', 'Toca [[Publicar como borrador]] o [[Publicar y confirmar]] ((4)).']],
            marcas: [{ n: 1, t: 'Lo que pegaste.' }, { n: 2, t: 'La empresa (y la cuenta, si corresponde).' }, { n: 3, t: 'La revisión fila por fila, con su resultado.' }, { n: 4, t: 'Publicar.' }],
            ojo: ['Un cliente se reconoce por su **RUT** o su nombre exacto. Si un nombre calza con dos clientes, SIGSO no elige por parecido: escribe el RUT.'],
            consejo: ['Volver a pegar las mismas filas no las duplica: salen como **repetidas**.'] }
        ] },
      { id: 'banco', titulo: 'Sube el banco y revisa sus movimientos', ruta: '#/finanzas',
        intro: ['La cartola del banco es la fuente de verdad. Se sube en el **Centro de cargas**: SIGSO reconoce qué archivo es, revisa que el saldo cuadre y no duplica nada si se sube dos veces.'],
        pasos: [
          { titulo: 'El centro de cargas', img: 'cargas',
            texto: [['Descarga la cartola del banco en **Excel** (no en PDF).', 'Arrástrala a la zona ((1)) o tócala para elegir el archivo.', 'Revisa la tarjeta: cuenta, fechas, cuántos movimientos son nuevos y si **los saldos cuadran**. Toca [[Importar]].']],
            marcas: [{ n: 1, t: 'Aquí se suelta cualquier archivo.' }, { n: 2, t: 'Qué se puede subir, cómo lo reconoce y dónde queda.' }],
            ojo: ['Si dice **los saldos NO cuadran**, no la importes: está incompleta o fue editada. Descárgala de nuevo.'],
            consejo: ['Aquí también entran el detalle «Mis Movimientos» (el nombre completo de quien transfirió), el Excel BANCOS y la planilla SIGECO. Nada se publica sin que lo revises.'] },
          { titulo: 'Los movimientos del mes', img: 'movimientos',
            texto: [['Cada movimiento dice **qué es** o qué propone SIGSO ((6)).', 'Si la propuesta está bien, tócale ✓ ((7)). Si no, abre el movimiento y elige qué es.', 'Lo que es seguro se confirma en lote ((4)).']],
            marcas: [{ n: 1, t: 'El mes y cuánto va revisado.' }, { n: 2, t: 'Los totales por tipo, y lo que falta revisar.' }, { n: 3, t: 'Por revisar, con propuesta, sin pista, confirmados o todos.' },
              { n: 4, t: 'Confirmar en lote.' }, { n: 5, t: 'Un movimiento del banco.' }, { n: 6, t: 'Qué es, o la propuesta.' }, { n: 7, t: '✓ acepta la propuesta.' }],
            consejo: ['Muchos clientes pagan desde la cuenta de otra persona: el nombre del banco no decide de qué cliente es. SIGSO pregunta y aprende; si alguien pagó por varios clientes, muestra las opciones y nunca elige solo.'] }
        ] },
      { id: 'conciliar', titulo: 'Concilia: une el registro con el banco', ruta: '#/finanzas',
        intro: ['Conciliar es decir «esta fila del registro es este movimiento del banco». Así el dinero se cuenta **una sola vez** y la fila deja de decir «Falta el banco».'],
        pasos: [
          { titulo: 'La conciliación', img: 'conciliacion',
            texto: [['Arriba, las **sugeridas** ((3)): pares con monto exacto. Revisa el par y toca [[Conciliar]] ((4)).', 'Si el banco llegó días después, amplía la búsqueda ((2)).', 'Para lo que no se sugiere, marca a la izquierda el movimiento del banco ((5)) y a la derecha su operación ((6)), y toca [[Vincular lo marcado]] ((7)).']],
            marcas: [{ n: 1, t: '[[Revisar y aceptar sugeridas]]: ves cada par antes de aceptarlo.' }, { n: 2, t: 'Mes y ventana de días.' }, { n: 3, t: 'Un par sugerido y por qué.' }, { n: 4, t: '[[Conciliar]].' },
              { n: 5, t: 'Banco por vincular.' }, { n: 6, t: 'Registro sin banco.' }, { n: 7, t: 'Lo marcado a cada lado y [[Vincular lo marcado]].' }],
            ojo: ['Si los montos no son iguales (por ejemplo, el banco cobró una comisión), SIGSO pide **explicar la diferencia**; nunca redondea solo. Si el banco trae menos que lo registrado, el resto queda esperando su movimiento.'],
            consejo: ['La fecha del registro manda: un pago del 30 de septiembre que el banco muestra el 2 de octubre sigue siendo de septiembre.'] }
        ] },
      { id: 'cobranza', titulo: 'Aplica los cobros a sus facturas', ruta: '#/finanzas',
        intro: ['La **Cobranza** muestra lo que falta cobrar, factura por factura. Un cobro recibido **no** paga una factura hasta que una persona lo **aplica**. SIGSO puede proponer el reparto (de la factura más antigua a la más nueva), pero la propuesta no rebaja la deuda.'],
        pasos: [
          { titulo: 'La bandeja de cobranza', img: 'cobranza',
            marcas: [{ n: 1, t: 'Emisor, cliente, vencimiento y búsqueda por folio, RUT o nombre.' }, { n: 2, t: 'Facturado, saldo confirmado, vencido, cobros sin aplicar y lo propuesto (aparte).' },
              { n: 3, t: 'Abiertas, vencidas, con propuesta, pagadas, incobrables o todas.' }, { n: 4, t: 'Una factura: emisor y folio, cliente, vencimiento, total, lo aplicado y el saldo.' },
              { n: 5, t: '[[Aplicar cobro]] a las facturas marcadas.' }, { n: 6, t: '[[Ver]]: aplicaciones, desaplicar con motivo, vencimiento, anular o incobrable.' }, { n: 7, t: '[[Relaciones de terceros]]: quién paga por quién.' }],
            texto: ['Las facturas llegan desde el **Registro de Ventas del SII** (en el SII: Registro de Compras y Ventas → Ventas → Descargar detalles), que se sube en el Centro de cargas.'] },
          { titulo: 'Aplicar un pago (también uno parcial)', img: 'aplicar',
            texto: [['En la factura, toca [[Aplicar]] (o marca varias y toca [[Aplicar cobro]]).', 'Marca el o los cobros ((2)).', 'Reparte los importes en la tabla ((4)): puedes aplicar **menos** que el saldo; la factura queda en **Pago parcial** con lo que falta.', 'Toca [[Confirmar aplicación]] ((5)). El servidor vuelve a revisar todo y responde con los saldos finales.']],
            marcas: [{ n: 1, t: 'Las facturas y lo que falta pagar.' }, { n: 2, t: 'Los cobros que se pueden usar.' }, { n: 3, t: 'La fecha de la aplicación (la del cobro no cambia).' }, { n: 4, t: 'Cuánto de cada cobro va a cada factura, y lo que queda.' }, { n: 5, t: '[[Confirmar aplicación]].' }],
            ojo: ['Un cliente solo paga facturas de otro cliente (o de otra empresa) con una **relación de terceros** vigente, con quién la autorizó y su respaldo. La plata que un cliente manda para sus imposiciones **no** paga facturas.'],
            consejo: ['Si te equivocaste, abre la factura con [[Ver]] y **desaplica** con motivo: la factura recupera su saldo y el cobro vuelve a quedar disponible.'] }
        ] },
      { id: 'fondos', titulo: 'Asigna los fondos de los clientes', ruta: '#/finanzas',
        intro: ['Cuando un cliente manda plata para pagar **sus** obligaciones (imposiciones, IVA…), esa plata no es de la empresa. Se lleva por **gestión**: una obligación de un período (por ejemplo, imposiciones de septiembre), con lo que llegó, lo que se pagó por destino y lo que queda.'],
        pasos: [
          { titulo: 'Fondos de clientes', img: 'fondos',
            marcas: [{ n: 1, t: '[[Cargar saldos iniciales]], [[Por aprobar]] y [[Nueva gestión]].' }, { n: 2, t: 'Quién puede aprobar un saldo inicial.' },
              { n: 3, t: 'Aviso: sin saldo inicial aprobado, el saldo del cliente es **parcial**.' }, { n: 4, t: 'A favor, en negativo, sin saldo inicial, con gestiones abiertas.' }, { n: 5, t: 'Un cliente: tócalo para ver su ficha y sus gestiones.' }],
            texto: [['Toca [[Nueva gestión]]: cliente, obligación, **período de la obligación** y sus destinos (por ejemplo, Obra A, B y C).', 'Registra la plata recibida como **Fondo del cliente recibido** y elige la gestión.', 'Registra cada pago como **Pago por cuenta del cliente**, con su gestión y su destino.', 'La gestión muestra lo que queda (el **remanente**). Decide qué hacer con él por escrito: mantenerlo para el mes siguiente, devolverlo o, con respaldo, cobrarlo como honorario.']],
            ojo: ['Una diferencia, aunque sea de $1, **se conserva**: no se ajusta sola. Si falta un saldo inicial, cárgalo (Cargar saldos iniciales) y que lo apruebe quien corresponda.'] }
        ] },
      { id: 'pendientes', titulo: 'Resuelve los pendientes y los errores', ruta: '#/finanzas',
        intro: ['**Pendientes** junta en una lista todo lo que falta, venga de donde venga: movimientos sin clasificar, posibles duplicados, datos por completar, operaciones sin banco, cobros sin aplicar, fondos sin gestión, saldos iniciales por aprobar y gastos compartidos sin vincular.'],
        pasos: [
          { titulo: 'La lista de pendientes', img: 'pendientes',
            texto: [['Filtra por tipo si quieres ((1)).', 'Lee el motivo ((3)): dice qué falta y si **impide cerrar el mes** ((4)).', 'Toca el botón de la fila ((5)): te lleva a donde se resuelve. Al terminar, vuelves con **← Volver**.']],
            marcas: [{ n: 1, t: 'Los tipos y cuántos hay.' }, { n: 2, t: 'El orden: primero lo que impide cerrar, después lo más antiguo y el monto mayor.' }, { n: 3, t: 'Un pendiente y su motivo.' }, { n: 4, t: 'Si impide cerrar el mes.' }, { n: 5, t: 'Ir a resolverlo.' }] },
          { titulo: 'Cuando algo falla', texto: [[
            '**«No guardado»** en una fila: no hubo conexión. Lo escrito sigue ahí; vuelve a salir de la fila para reintentar. Si el servidor alcanzó a guardarlo, el reintento no lo duplica.',
            '**«No se pudo cargar» con [[Reintentar]]**: la pantalla no recibió los datos. Toca [[Reintentar]]; nunca se muestra una lista vacía como si no hubiera nada.',
            '**«Otra persona cambió esta fila»**: alguien guardó antes que tú. SIGSO carga lo último y tu cambio queda en un aviso arriba, para aplicarlo sobre lo nuevo ([[Guardarlos ahora]]) o descartarlo.',
            '**La bóveda se cerró** con algo a medio escribir: al volver a abrirla, el Registro ofrece **N cambio(s) sin guardar** para guardarlos o descartarlos.',
            '**Un botón apagado**: tu acceso no incluye esa acción. Pídelo a la administración.']] }
        ] },
      { id: 'informes', titulo: 'Lee el informe del mes', ruta: '#/finanzas',
        intro: ['El **Resumen financiero** dice cómo va el mes, con qué datos y qué conviene revisar. Mientras falten datos, lo dice primero y no califica las comparaciones.'],
        pasos: [
          { titulo: 'El resumen financiero', img: 'resumen',
            marcas: [{ n: 1, t: '[[Exportar]] a Excel y [[Descargar PDF]] (con los mismos datos de la pantalla).' }, { n: 2, t: 'Mes, alcance, base (caja o documentos) y con qué se compara.' },
              { n: 3, t: 'La calidad de los datos: si son provisorios y por qué, con un enlace a cada cosa por resolver.' }, { n: 4, t: '**Flujo del mes**: cobros, pagos y flujo propios (sin la plata de clientes).' },
              { n: 5, t: '**Liquidez**: saldo del banco, fondos de clientes y disponibilidad propia (si se puede determinar).' }, { n: 6, t: '**Lectura del mes**: lo que cambia la interpretación, en frases, con su acción.' }],
            ojo: ['El saldo del banco incluye la plata de los clientes. La **disponibilidad propia** la descuenta; si falta un saldo inicial de clientes, dice «no determinable» en vez de inventar una cifra.'],
            consejo: ['Si los datos cambian mientras descargas el PDF, SIGSO te pide recargar: el PDF siempre corresponde a lo que estás viendo.'] }
        ] },
      { id: 'cierre', titulo: 'Revisa y cierra el mes', ruta: '#/finanzas',
        intro: ['Un mes cerrado queda **fijo**: no recibe movimientos nuevos ni cambios, y su informe queda guardado como versión. Se puede reabrir con motivo; el cierre anterior se conserva.'],
        pasos: [
          { titulo: 'La revisión del período', img: 'cierre',
            texto: [['Elige el mes ((2)).', 'Lee el **siguiente paso** ((3)) y resuelve lo que **bloquea el cierre** ((4)): cada bloqueo te lleva a donde se resuelve.', 'Si algo no se puede resolver (por ejemplo, falta un saldo inicial), una persona autorizada puede **aceptar la excepción** ((6)) con su motivo y su evidencia: queda en la bitácora y en el informe.', 'Cuando no quede nada, toca [[Cerrar]] ((7)).']],
            marcas: [{ n: 1, t: 'La política de cierre de la empresa (por ejemplo, si exige revisión de otra persona).' }, { n: 2, t: 'Los meses y su estado.' }, { n: 3, t: 'El siguiente paso y a quién le toca.' },
              { n: 4, t: 'Lo que bloquea el cierre.' }, { n: 5, t: 'Lo que ya está listo.' }, { n: 6, t: 'Aceptar una excepción permitida.' }, { n: 7, t: 'Cerrar (o lo que falta para cerrar).' }],
            ojo: ['Una excepción no cambia la calidad de los datos: el informe sigue diciendo qué faltaba.'] }
        ] },
      { id: 'seguridad', titulo: 'Seguridad y bitácora', ruta: '#/finanzas',
        intro: ['En **Configuración → Seguridad** se ve quién tiene acceso y los últimos ingresos; en **Bitácora**, todo lo que se hizo en la bóveda, encadenado: si alguien borrara una entrada, se notaría.'],
        pasos: [
          { titulo: 'Buenas prácticas', texto: [['Cierra la bóveda con el candado al dejar el computador.', 'No compartas tu código ni tu teléfono.', 'Si ves un ingreso que no reconoces, avisa de inmediato a la administración del sistema.', 'Los informes y exportaciones quedan registrados con tu nombre: no los reenvíes fuera de la empresa.']] }
        ] }
    ],
    preguntas: [
      { p: 'No veo Finanzas en mi barra lateral.', r: ['Solo lo ven las personas de la lista fija de la bóveda. Pide acceso a la gerencia: se agrega en el servidor, no desde una pantalla.'] },
      { p: 'Cambié o perdí mi teléfono, ¿cómo entro?', r: ['Avisa a la administración del sistema: reinicia tu autenticador y la próxima vez SIGSO te pide registrarlo de nuevo con tu contraseña.'] },
      { p: '¿Por qué un borrador no suma en los totales?', r: ['Porque todavía no está confirmado: los totales del mes cuentan solo lo confirmado. Los borradores se ven aparte, con lo que les falta.'] },
      { p: 'Registré un pago y después llegó en la cartola. ¿Se cuenta dos veces?', r: ['No: SIGSO lo marca como posible duplicado hasta que lo concilies (es el mismo) o digas que son dos pagos distintos.'] },
      { p: 'Dos pagos iguales del mismo cliente el mismo día, ¿y si de verdad son dos?', r: ['Indícalo con **Son distintas**. Se conservan los dos y esa decisión no se pierde aunque se vuelva a subir la cartola.'] },
      { p: 'Un cliente pagó solo una parte de su factura.', r: ['Aplica el monto recibido a la factura: queda en **Pago parcial** con el saldo que falta. Cuando pague el resto, aplícalo igual.'] },
      { p: 'Un cliente pagó desde la cuenta de otra persona.', r: ['Elige el cliente correcto. SIGSO anota que esa persona paga por ese cliente y la próxima vez lo propone. Para que pague facturas de otro cliente hace falta una relación de terceros autorizada.'] },
      { p: 'Una transferencia trae el honorario y la plata de las imposiciones juntos.', r: ['Usa **Dividir importe**: una parte como Ingreso de la empresa y otra como Fondo del cliente recibido. Tienen que sumar exacto.'] },
      { p: 'Me equivoqué en una operación confirmada.', r: ['Ábrela, corrígela y guarda; si no corresponde, anúlala con motivo. Si el mes ya está cerrado, primero hay que reabrirlo en **Cierre**, con el motivo.'] },
      { p: '¿Por qué el informe dice «provisorio»?', r: ['Porque faltan datos (movimientos sin revisar, operaciones sin banco o saldos iniciales). La cinta de arriba dice cuáles, con un enlace a cada uno.'] }
    ]
  });
})();
