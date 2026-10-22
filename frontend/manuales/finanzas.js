/**
 * Manual de Finanzas (la bóveda) — v4 «la planilla del banco» (22-10-2026): se llena como el Excel BANCOS
 * (fecha, nombre, OBS, plan de cuenta, monto, grupo, N° factura), la cartola que comprueba lo anotado, los
 * grupos de fondos por letra, pegar desde Excel, y los tres reportes: FLUJO, saldo por cliente y cobranza.
 * Capturas de la empresa de demostración (clientes, personas y montos ficticios).
 */
(function () {
  'use strict';

  SigsoManual.registrar({
    id: 'finanzas', titulo: 'Finanzas: la planilla del banco, el FLUJO, los saldos por cliente y la cobranza',
    para: 'Quienes llevan las finanzas del grupo (y la gerencia, en modo lectura)',
    resumen: ['Finanzas es la planilla BANCOS dentro de SIGSO: una hoja por mes donde cada movimiento se anota con su **fecha, nombre, OBS, plan de cuenta y monto**, escribiendo celda por celda como en Excel. Arriba se calcula solo el resumen (ABONO, ABONO RENTA, SALDO, PENDIENTE, TOTAL). Al subir la **cartola**, cada fila se comprueba con el banco. Y de la misma hoja salen el **FLUJO**, el **saldo por cliente** y la **cobranza**: no hay otras hojas que llenar.'],
    antes: ['Finanzas solo lo ven las personas de una **lista fija** que vive en el servidor. Si no está en tu barra lateral, no tienes acceso.',
      'Para abrirla necesitas **Google Authenticator** en tu teléfono, activado la primera vez con tu contraseña de SIGSO.',
      'Las palabras son las de la planilla: **ABONO** es dinero de la empresa (honorario si entra, gasto si sale); **IVA**, **IMPOSICIONES**, **SALDO** y **PENDIENTE** son dinero del cliente; un **grupo** junta lo que el cliente mandó con lo que se pagó por él.',
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
      { id: 'mapa', titulo: 'Las partes de Finanzas', ruta: '#/finanzas',
        pasos: [
          { titulo: 'La columna de Finanzas', img: 'mapa',
            marcas: [{ n: 1, t: '**Planilla**: la hoja del banco. Aquí se trabaja todos los días.' },
              { n: 2, t: '**FLUJO**: ingresos y egresos por plan de cuenta, mes a mes, como las hojas FLUJO de SIGECO.' },
              { n: 3, t: '**Saldo por cliente**: cuánta dinero de cada cliente hay en la cuenta y lo que debe.' },
              { n: 4, t: '**Cobranza**: las facturas, lo pagado y lo que falta cobrar.' },
              { n: 5, t: '**Más**: subir archivos, cierre de meses, informe en PDF, presupuesto, exportar, catálogos, seguridad y bitácora.' },
              { n: 6, t: '[[Manual de uso]] y [[Ver ejemplo]].' }] }
        ] },
      { id: 'planilla', titulo: 'La planilla del mes', ruta: '#/finanzas',
        intro: ['Es la misma hoja del Excel BANCOS, con una pestaña por mes. Las filas se escriben con el teclado y se guardan solas.'],
        pasos: [
          { titulo: 'Lo que hay en la pantalla', img: 'planilla',
            marcas: [{ n: 1, t: 'Las **pestañas de los meses**, como las hojas del Excel, y los atajos de la OBS.' },
              { n: 2, t: '**Resumen del mes**, como arriba en el Excel: ABONO (lo que entró menos los gastos), ABONO RENTA, SALDO, PENDIENTE y el TOTAL, que es el neto del banco.' },
              { n: 3, t: '**Banco · cartola**: saldo inicial y final según la cartola, y si cuadra con lo anotado.' },
              { n: 4, t: 'La hoja: fecha, nombre, OBS, plan de cuenta, monto, grupo, N° de factura y lo que dice el banco. A la derecha, el saldo acumulado (la columna SALDO), qué es la fila y si está en el banco.' },
              { n: 5, t: 'La **fila nueva**: aquí se escribe lo siguiente.' },
              { n: 6, t: 'La ayuda de la fila elegida: dice qué le falta.' }] },
          { titulo: 'Cómo se ve la planilla',
            texto: [['Cada fila tiene una **franja de color** a la izquierda: verde honorario, rojo gasto, violeta fondos de clientes y naranjo lo que falta completar.', 'Las filas se agrupan **por día**, con cuántos movimientos hubo y el neto del día. Al bajar, el encabezado de la tabla queda fijo y arriba aparece una **barra compacta** con ABONO, ABONO RENTA, TOTAL y el paso que toca.', 'Cada **grupo tiene su color**, el mismo en la fila y en el panel «Grupos de fondos».', 'Junto a la búsqueda: **Solo lo pendiente** atenúa lo que está bien; **Letra grande** agranda la letra y las filas; **Panel** muestra u oculta el panel del banco y los grupos para que la tabla use todo el ancho. SIGSO recuerda lo que elijas en este computador.', 'Al lograr un paso del camino hay una pequeña celebración; al cerrar el mes, **Portada del mes** abre una hoja con el resultado, el cuadre y quién lo revisó y cerró, lista para imprimir o guardar en PDF.']] },
          { titulo: 'El recorrido y el celular',
            texto: [['La primera vez que alguien abre la planilla, un **recorrido** de 8 pasos marca cada parte y explica para qué sirve. Se puede repetir con **Ver recorrido**, al lado de la guía del camino.', 'En el **celular** la planilla se ve como tarjetas (nombre, monto, OBS, qué es y si está en el banco), para revisar el mes en cualquier lugar. Para anotar conviene el computador.']] },
          { titulo: 'El camino del mes y las ayudas',
            texto: [['Arriba de la planilla está el **Camino del mes**: los 6 pasos para dejar listo un mes (subir la cartola, anotar lo del banco, completar los datos, decidir los grupos, cuadrar con el banco y cerrar). El paso que toca va marcado y debajo dice qué hacer. Toca un paso para ir directo a lo que falta.', 'Cada columna tiene un **?**: tócalo y explica qué va ahí, cómo se escribe y un ejemplo.', 'En **Qué es**, lo que falta sale en naranjo («Gasto · falta el plan», «Falta la OBS»). Tócalo y SIGSO te lleva a la celda que hay que llenar. Si reconoce el plan, lo propone: **Enter** lo acepta.', 'Al poner un plan de cuenta, si hay otras filas parecidas sin plan (mismo detalle del banco y día, o mismo nombre), abajo aparece **Poner «…» en N parecidas**: copia el plan a todas de una vez.', 'El **monto** se ve como en un estado de cuenta: **+ verde** entró, **− rojo** salió. Al tocar una fila con **grupo**, se marcan las demás filas del mismo grupo. La letra del grupo es solo un nombre (A…Z, después AA, AB…).']] },
          { titulo: 'Escribir una fila', img: 'planilla-escribir',
            texto: [['Haz clic en la fila nueva ((1)) y escribe el **día** (por ejemplo 24) o la fecha (24-10).', 'Pasa a la celda siguiente con **Tab** y escribe el **nombre** ((2)): el cliente, «ARRIENDO», «SUELDO»… Al escribir aparecen los que SIGSO ya conoce.', 'En la **OBS** ((3)) basta una letra: **A** = ABONO, **R** = ABONO RENTA, **I** = IVA, **M** = IMPOSICIONES, **S** = SALDO, **P** = PENDIENTE.', 'Si es un gasto, escribe el **plan de cuenta** ((4)): Arriendo Mensual, Sueldos, Cuentas Básicas…', 'Escribe el **monto** ((5)): positivo si entró, **negativo si salió** (como la columna TOTAL). Al presionar **Enter** (o al bajar a otra fila) se guarda, sin recargar la pantalla, y la fila nueva siguiente queda lista.']],
            marcas: [{ n: 1, t: 'La fila nueva.' }, { n: 2, t: 'Nombre.' }, { n: 3, t: 'OBS (una letra basta).' }, { n: 4, t: 'Plan de cuenta.' }, { n: 5, t: 'Monto: + entra / − sale.' }, { n: 6, t: 'Grupo y N° de factura (ver más abajo).' }],
            consejo: ['Para corregir cualquier celda: haz clic en ella y escribe encima, o presiona **Enter** para editar lo que tiene. **Supr** borra la celda; en la fecha o el monto, pregunta si quieres borrar la fila.', 'Las teclas son las de Excel: **Enter** guarda y baja, **Tab** pasa a la derecha, las flechas mueven la celda elegida y **Ctrl+D** copia la celda de arriba.',
              'Al escribir el nombre, la OBS, el plan o el grupo aparece una lista: elige con las flechas y **Enter**. Si el nombre ya se usó antes, la OBS y el plan se completan como la última vez. Sin fecha, la fila usa la del día que se anotó antes (se ve en gris).', 'Para anotar otro mes (aunque todavía no tenga movimientos), toca **+ Mes** junto a las pestañas y elige el mes.'] },
          { titulo: 'Pegar varias filas desde el Excel', img: 'planilla-pegar',
            texto: [['En el Excel, copia las filas (desde la columna TOTAL hasta DETALLE BANCO).', 'En la planilla, presiona **Ctrl+V** (o toca [[Pegar desde Excel]] y pégalas en el cuadro ((1))).', 'SIGSO dice cuántas filas son y cuánto suman: confirma y quedan anotadas.']],
            marcas: [{ n: 1, t: 'Aquí se pegan.' }, { n: 2, t: '[[Revisar y anotar]].' }],
            ojo: ['No pegues un mes que ya está anotado: quedarían filas repetidas.'] }
        ] },
      { id: 'modelo', titulo: 'El mes modelo: cómo se llena bien un mes', ruta: '#/finanzas',
        intro: ['Septiembre 2026 es el mes de referencia: con la planilla bien llenada y las dos cartolas del mes, **las 196 filas coincidieron con el banco** y el resumen de SIGSO dio exactamente el del Excel (TOTAL, ABONO, ABONO RENTA, SALDO y PENDIENTE). Así se logra lo mismo cada mes.'],
        pasos: [
          { titulo: 'Las cartolas: el mes completo, sin huecos',
            texto: [['Sube la cartola **en Excel** de todo el mes (del 1 al último día). Si el banco la entrega en partes (por ejemplo, del 31-08 al 16-09 y del 16-09 al 30-09), sube todas: el día que se repite en dos cartolas **no se duplica**.', 'Al revisar la cartola, SIGSO comprueba que la cadena de saldos no se corte. Los avisos («el resumen viene en blanco», «los movimientos no suman lo que dice el resumen del banco») no impiden importar: los saldos se toman de la lista de movimientos, que es lo que se verifica fila a fila.', 'La «Cartola histórica» del BCI trae los cargos con signo menos y el saldo diario contado desde cero: SIGSO lo corrige solo (el saldo real parte del saldo disponible al cierre).']],
            consejo: ['Lo ideal es la **cartola mensual oficial** (01 al 30/31): trae el saldo anterior y el resumen del banco, y no hay que inferir nada.'] },
          { titulo: 'La planilla: una fila por movimiento del banco',
            texto: [['**Fecha**: el día en que pasó (la de «Mis Movimientos»). Si el banco la contabiliza el día hábil siguiente, igual se une: se aceptan 3 días hábiles de diferencia.', '**Monto**: el mismo del banco, con signo (lo que sale, negativo). Un monto mal digitado aparece en Informes como «posible monto mal digitado».', '**Nombre**: siempre escrito igual para el mismo cliente (no «ARMANDO LAEL» un día y «CONST ARMANDO Y LAEL» otro). El autocompletar ofrece los nombres ya usados.', '**OBS** en **todas** las filas: ABONO / ABONO RENTA (de la empresa), IVA / IMPOSICIONES (dinero del cliente), SALDO o PENDIENTE. Una fila sin OBS queda «por completar».', '**Plan de cuenta** en todos los egresos ABONO (sueldos, arriendo, comisiones, caja chica, traspasos…): sin él, el gasto aparece como «Sin plan de cuenta» en el FLUJO y en Informes.', '**Grupo**: el dinero que manda un cliente y lo que se paga por él lleva la misma letra; lo que sobra se decide (ABONO o SALDO).', '**N° factura** en el abono que paga una factura: así la cobranza sabe que está pagada.']] },
          { titulo: 'Cómo saber que el mes quedó bien',
            texto: [['En la planilla: **En el banco** igual a **Todas**, **Por completar** en 0 y arriba «Cuadra con la cartola».', 'En **Informes** del mes: **Verificado 100 %** y el resultado igual al ABONO + ABONO RENTA del resumen del Excel.', 'Recién entonces conviene **cerrar el mes** (Más → Cierre).']],
            ojo: ['Si en el mes anterior no se cargaron los fondos de los clientes, el informe sale **provisorio**: los saldos por cliente parten en el primer mes cargado.'] }
        ] },
      { id: 'informes', titulo: 'Informes: lo que dicen los datos', ruta: '#/finanzas',
        intro: ['**Informes** convierte la planilla en información. Se arma solo con lo anotado (con las mismas reglas de la planilla): el **resultado** es el ABONO + ABONO RENTA del resumen, así que se puede comparar con el Excel.'],
        pasos: [
          { titulo: 'Un mes',
            texto: [['Arriba, una frase con lo esencial: cuánto se ganó, cuánto se gastó, cuánto quedó y cuánta dinero del banco es de la empresa.', 'Las tarjetas muestran las cifras clave con su comparación con el mes anterior y la tendencia de los últimos meses. Toca cualquiera (o su **?**) para ver **qué es, cómo se calcula con los números reales y las filas de la planilla que la componen**.', '**Lo que dicen los datos**: comentarios automáticos, lo crítico primero (clientes que deben fondos, facturas vencidas, gastos inusuales, pérdida del mes…). Cada uno tiene **¿Cómo se llegó a esto?**.', 'Más abajo: cómo se movió el dinero del banco (del saldo inicial al final), la **verificación con la cartola** (lo que coincide, lo anotado que el banco no trae, lo del banco sin anotar y los posibles montos mal digitados), gastos por plan, honorarios por cliente, fondos de clientes y cobranza.']],
            consejo: ['Si arriba dice **Informe provisorio**, la lista explica qué falta (cartola, filas sin anotar o sin verificar). Las cifras pueden cambiar hasta completarlo.'] },
          { titulo: 'Comparar períodos',
            texto: [['Toca **Comparar períodos** y elige desde y hasta (o «Últimos 3, 6 o 12» / «Este año»).', 'Se ven los totales y promedios del período, el gráfico mes a mes (barras de honorarios y gastos; el punto es el resultado), la tabla comparativa con el mejor y el peor mes, el mapa de gastos por plan, los clientes que más aportan y la evolución de la caja.', 'Los meses sin honorarios ni gastos anotados se dejan fuera de promedios y tendencias, y se avisa cuáles son.']] },
          { titulo: 'Imprimir o guardar en PDF',
            texto: [['Toca **Imprimir o guardar PDF**: sale solo el informe, con los «¿cómo se llegó?» abiertos. En el diálogo de impresión elige «Guardar como PDF».']] }
        ] },
      { id: 'cartola', titulo: 'Cuando llega la cartola', ruta: '#/finanzas',
        intro: ['La cartola es la verdad. Se sube en **Más → Subir archivos** (o con [[Subir cartola]] arriba de la planilla). Cada fila anotada se une sola con su movimiento del banco (mismo monto, hasta 3 días hábiles de diferencia: el fin de semana no cuenta) y pasa a **✓ banco**.'],
        pasos: [
          { titulo: 'Lo que el banco trae y nadie anotó', img: 'planilla-falta',
            texto: [['Las filas **naranjas** ((1)) están en la cartola y nadie las anotó (por ejemplo, un «pago cuentas vía internet» que el banco no explica). La fecha y el monto ya vienen del banco.', 'Escribe **quién es** ((2)) y la **OBS** ((3)), como cualquier fila.', 'Cuando no queda nada en naranjo ni «esperando», arriba dice **Cuadra con la cartola**.']],
            marcas: [{ n: 1, t: 'Fila del banco sin anotar.' }, { n: 2, t: 'Quién es.' }, { n: 3, t: 'OBS.' }, { n: 4, t: 'En el banco: ✓, esperando o falta anotar.' }],
            ojo: ['Si una fila anotada sigue **esperando** después de subir la cartola, revisa su fecha o su monto: el banco puede haberla registrado otro día, o se anotó con un error.'] },
          { titulo: 'Fecha del banco y fecha de la planilla', img: 'planilla-falta',
            texto: [['El BCI pone en la cartola la **fecha contable** (el día hábil siguiente): lo pagado el 30 de junio puede salir el 1 de julio. La planilla va por la **fecha en que pasó**, y SIGSO también: cada fila va en el mes de su fecha de la planilla o de «Mis Movimientos», y al lado se ve «banco 01-07».', 'Si quedan filas del banco sin anotar en los primeros días del mes y sin fecha de transacción, el cuadro **Banco · cartola** ofrece [[Pasarlos a junio]] (el mes anterior). También se puede mover una sola fila con los botones **← mes** / **mes →** del pie de la planilla, y devolverla con **Volver a su mes**.', 'El mismo cuadro revisa la cartola: que esté completa (saldo inicial + movimientos = saldo final) y que la cadena de saldos no se corte (un corte avisa de un movimiento repetido o que falta).']] }
        ] },
      { id: 'grupos', titulo: 'Los grupos de fondos (lo que hacía UNITARIO)', ruta: '#/finanzas',
        intro: ['Cuando un cliente manda dinero para sus imposiciones o su IVA y después se paga por él, esas filas son un **grupo**. En vez de una fórmula, se pone **la misma letra** en la columna Grupo.'],
        pasos: [
          { titulo: 'Formar un grupo y decidir lo que sobra', img: 'planilla-grupos',
            texto: [['Escribe la misma letra (por ejemplo **A**) en la columna **Grupo** de lo que el cliente mandó y de lo que se pagó por él.', 'Abajo de la hoja aparece el grupo ((1)) con lo que entró, lo que salió y **lo que sobra** ((2)).', 'Elige qué pasa con lo que sobra ((3)), como la OBS de la fila que cerraba el grupo en el Excel: **PENDIENTE** (sigue abierto), **ABONO** o **ABONO RENTA** (se cobra como honorario) o **SALDO** (queda a favor del cliente).']],
            marcas: [{ n: 1, t: 'El grupo y su cliente.' }, { n: 2, t: 'Entró, salió y lo que sobra.' }, { n: 3, t: 'Qué pasa con lo que sobra.' }],
            consejo: ['Las letras son de cada mes: el grupo A de septiembre no tiene que ver con el A de octubre.', 'Los grupos que vinieron del Excel BANCOS ya tienen su letra. Si un grupo tiene filas de otro mes, lo dice y muestra lo que el Excel calculaba.'] }
        ] },
      { id: 'flujo', titulo: 'El FLUJO', ruta: '#/finanzas',
        pasos: [
          { titulo: 'Ingresos y egresos por plan de cuenta', img: 'flujo',
            marcas: [{ n: 1, t: 'Hasta qué mes, cuántos meses y de qué empresa (o todo el grupo).' },
              { n: 2, t: 'Ingresos y egresos por plan de cuenta, como en SIGECO.' }, { n: 3, t: '**Margen del mes**: ingresos menos egresos de la empresa.' }, { n: 4, t: 'El dinero de los clientes va aparte, para no inflar ingresos ni gastos.' }],
            consejo: ['Un gasto anotado sin plan de cuenta cae en **Otros Egresos**: escribe el plan en la planilla para que caiga donde corresponde.', 'Si hay filas sin completar (sin OBS o del banco sin anotar), arriba aparece un aviso: esas filas todavía no entran al FLUJO.'] }
        ] },
      { id: 'saldos', titulo: 'El saldo por cliente', ruta: '#/finanzas',
        pasos: [
          { titulo: 'Cuánta dinero de cada cliente hay', img: 'saldos',
            marcas: [{ n: 1, t: 'Hasta qué mes (el saldo se acumula desde el primer mes con datos).' }, { n: 2, t: 'Los totales: dinero de clientes en la cuenta, honorarios del mes, facturas por cobrar y clientes en negativo.' },
              { n: 3, t: 'Cada cliente: honorarios, fondos recibidos, lo pagado por él, lo que sobró y se cobró, su **saldo de fondos** y lo que debe en facturas.' }],
            ojo: ['Un saldo **negativo** es dinero que se pagó por el cliente sin que la haya mandado: hay que pedírsela.', '**Sin ficha**: el nombre de la planilla no está enlazado a un cliente de SIGSO. Se enseña en **Más → Nombres y reglas**.'] }
        ] },
      { id: 'cobranza', titulo: 'La cobranza', ruta: '#/finanzas',
        pasos: [
          { titulo: 'Facturas pagadas y por cobrar', img: 'cobros',
            marcas: [{ n: 1, t: 'Facturado, pagado, por cobrar y vencido.' }, { n: 2, t: 'Ver solo lo por cobrar, o todas.' }, { n: 3, t: 'Cada factura con su saldo y estado.' }],
            texto: [['Las facturas entran con el Registro de Ventas del SII (o la hoja FACTURAS de SIGECO), en **Más → Subir archivos**.', 'Una factura queda **pagada** cuando, en la planilla, la fila del abono lleva su número en la columna **N° factura**. No hay otra hoja de pagos.', 'Si una transferencia paga varias facturas, anota todos los números: «1052-1053» o «1052 y 1053». Se pagan en ese orden, hasta lo que falta de cada una. El número es de la empresa de la cuenta donde entró el dinero.']] }
        ] },
      { id: 'subir', titulo: 'Subir archivos', ruta: '#/finanzas',
        pasos: [
          { titulo: 'El centro de cargas', img: 'cargas',
            texto: [['**Cartola del banco** (Excel, no PDF): revisa que los saldos cuadren y toca [[Importar]]. Subirla dos veces no duplica nada.', '**Mis Movimientos** del BCI: completa el nombre de quien transfirió de verdad.',
              '**Excel BANCOS** (solo los meses que se llenaron en el Excel): elige la cuenta y toca [[Llevar AAAA-MM]] por cada mes. Las filas llegan a la planilla con su OBS y sus grupos.', '**Ventas del SII** o la planilla **SIGECO**: facturas y clientes.']],
            marcas: [{ n: 1, t: 'Aquí se suelta cualquier archivo.' }, { n: 2, t: 'Qué se puede subir y dónde queda.' }] }
        ] },
      { id: 'cierre', titulo: 'Cierra el mes', ruta: '#/finanzas',
        intro: ['Desde la planilla (último paso del camino, **Revisa y cierra**, o el enlace **Revisar el mes**) o en **Más → Cierre de meses**. Un mes cerrado queda **fijo**: la planilla se ve, pero no se edita. Se puede reabrir con motivo; la versión anterior se conserva.'],
        pasos: [
          { titulo: 'Revisar el mes desde la planilla',
            texto: [['**Revisar el mes** muestra los 5 pasos de la planilla (cartola completa, todo anotado, datos completos, grupos decididos y cuadre con el banco). Cada paso pendiente tiene **Ir a corregir**, que te lleva a las filas.', '**Un mismo cliente escrito de varias formas**: SIGSO junta los nombres que parecen el mismo cliente («ARMANDO LAEL» y «CONST ARMANDO Y LAEL»). Elige cómo queda y toca **Dejar todo con el nombre elegido**: se cambia en todas sus filas del mes.', '**Para mirar**: montos que parecen mal digitados, grupos con filas de otro mes y filas pasadas de mes a mano. No impiden cerrar, pero conviene revisarlos.']] },
          { titulo: 'Quién anota, quién revisa',
            texto: [['Quien anota la planilla toca **Enviar a revisión** (con una nota, si quiere). Quien revisa recibe un aviso en la **campana** de SIGSO y ve en la planilla «En revisión».', 'Quien revisa puede **Cerrar el mes** o **Devolver con observaciones**. Si lo devuelve, quien lo envió recibe un aviso y ve las observaciones arriba de la planilla; al corregirlas toca **Corregido**.', 'Los avisos de la campana no llevan montos: solo dicen que hay un mes por revisar o por corregir.']],
            consejo: ['En Configuración se puede exigir que todo mes pase por revisión y que lo cierre otra persona que la que lo envió.'] },
          { titulo: 'La revisión del período', img: 'cierre',
            marcas: [{ n: 1, t: 'La política de cierre.' }, { n: 2, t: 'Los meses y su estado.' }, { n: 3, t: 'El siguiente paso.' }, { n: 4, t: 'Lo que bloquea el cierre.' }, { n: 5, t: 'Lo que está listo.' }, { n: 6, t: 'Aceptar una excepción con motivo.' }, { n: 7, t: 'Cerrar.' }] }
        ] },
      { id: 'errores', titulo: 'Cuando algo falla', ruta: '#/finanzas',
        pasos: [
          { titulo: 'Qué hacer', texto: [[
            '**«No entiendo el monto»**: escribe solo números, con punto de miles si quieres (450.000) y el signo menos si salió (-450.000).',
            '**«La OBS es una de estas»**: usa una letra (A, R, I, M, S, P) o la palabra completa.',
            '**«Otra persona cambió esta fila»**: alguien guardó antes que tú. La hoja se recarga sola; vuelve a escribir.',
            '**No cuadra con la cartola**: completa las filas naranjas y revisa las que siguen «esperando». Fíjate también en que estén todas las cartolas del mes.',
            '**Una celda no deja escribir**: la fecha, el monto y el detalle de una fila que ya está en el banco vienen de la cartola; o el mes está cerrado; o tu acceso es de lectura.']] }
        ] },
      { id: 'seguridad', titulo: 'Seguridad y bitácora', ruta: '#/finanzas',
        pasos: [
          { titulo: 'Buenas prácticas', texto: [['Cierra la bóveda con el candado al dejar el computador.', 'No compartas tu código ni tu teléfono.', 'En **Más → Bitácora** queda todo lo que se hizo; si ves un ingreso que no reconoces, avisa de inmediato.']] }
        ] }
    ],
    preguntas: [
      { p: '¿Hay que seguir llenando el Excel BANCOS o la planilla SIGECO?', r: ['No. La planilla de SIGSO reemplaza a las dos: se llena igual que el Excel BANCOS, y de ella salen el FLUJO, los saldos por cliente y la cobranza que antes se armaban en SIGECO. El Excel solo se sube para los meses que ya estaban llenados ahí.'] },
      { p: '¿Por qué el ABONO de arriba es menor que lo que entró?', r: ['Porque, como en el Excel, ABONO es neto: lo que entró menos los gastos anotados con OBS ABONO. Debajo dice cuánto entró y cuánto fueron los gastos.'] },
      { p: '¿Qué es «De otros meses» en el resumen?', r: ['Filas de grupos que empezaron o terminan en otro mes (por ejemplo, el cliente mandó el dinero en junio y se pagó en julio). Para esos grupos vale lo que el Excel calculaba que sobró; lo demás se muestra aparte para que el TOTAL siga cuadrando con el banco.'] },
      { p: '¿Dónde quedaron «El mes» y el «Libro del banco»?', r: ['Se reemplazaron por la planilla: todo lo que mostraban (cuadre con la cartola, lo que falta anotar, el resumen) está ahora en la misma hoja.'] },
      { p: 'Un cliente pagó desde la cuenta de otra persona.', r: ['En la planilla escribe el nombre del cliente, no el de quien transfirió. Lo que dice el banco queda a la derecha, en «Detalle banco».'] }
    ]
  });
})();
