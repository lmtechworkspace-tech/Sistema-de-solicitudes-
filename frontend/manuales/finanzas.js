/**
 * Manual de Finanzas (la bóveda): abrirla, el mes paso a paso, cartolas y detalle
 * del banco, el Excel BANCOS, revisar movimientos (pagadores de terceros, dividir,
 * avisos), tablero, cobranza, presupuesto, cierre, seguridad y bitácora.
 * Capturas de la empresa de demostración (clientes, personas y montos ficticios).
 */
(function () {
  'use strict';

  SigsoManual.registrar({
    id: 'finanzas', titulo: 'Finanzas: la bóveda de la caja, la cobranza y los resultados',
    para: 'Quienes llevan las finanzas del grupo (y la gerencia, en modo lectura)',
    resumen: ['Cómo abrir la bóveda, dejar listo cada mes paso a paso (subir la cartola y el detalle del banco, revisar los movimientos y cerrarlo) y leer el tablero, la cobranza y el presupuesto. Reemplaza a la planilla SIGECO: lo que antes se anotaba a mano, aquí sale de la cartola del banco.'],
    antes: ['Finanzas solo lo ven las personas de una **lista fija** que vive en el servidor: nadie puede darse acceso desde una pantalla. Si no está en tu barra lateral, no tienes acceso.',
      'Para abrirla necesitas **Google Authenticator** en tu teléfono, activado la primera vez con tu contraseña de SIGSO.',
      'La gerencia entra en **solo lectura**: ve y descarga todo, pero no puede subir ni cambiar nada.',
      'En los ejemplos trabaja Camila Rojas, con clientes, personas y montos inventados (empresa de demostración).',
      'Para ver un mes completo de trabajo con datos de demostración, toca **Ver ejemplo**, al lado de «Manual de uso».'],
    capitulos: [
      { id: 'abrir', titulo: 'Abre la bóveda', ruta: '#/finanzas',
        intro: ['Finanzas tiene su propio candado, aparte de tu sesión de SIGSO. Se cierra sola tras 15 minutos sin uso o al cerrar la pestaña.'],
        pasos: [
          { titulo: 'El código de 6 dígitos', img: 'candado',
            texto: [['Abre **Finanzas** en la barra lateral.', 'Abre Google Authenticator en tu teléfono y busca **SIGSO Finanzas**.', 'Escribe los 6 dígitos ((1)) (o pégalos) y toca [[Abrir bóveda]] ((2)).']],
            marcas: [{ n: 1, t: 'Los 6 dígitos del autenticador: cambian cada 30 segundos.' }, { n: 2, t: '[[Abrir bóveda]].' }],
            ojo: ['Cada código sirve **una sola vez**. Tras 5 códigos incorrectos, la bóveda se bloquea 15 minutos para tu cuenta.'],
            error: ['«El código no es correcto»: espera el siguiente código (el círculo del autenticador debe partir de nuevo) y revisa que la hora de tu teléfono esté en automático.'],
            consejo: ['La primera vez, la pantalla te pide tu contraseña de SIGSO y muestra un código QR para registrar la cuenta en Authenticator.'] }
        ] },
      { id: 'el-mes', titulo: 'El mes, paso a paso', ruta: '#/finanzas',
        intro: ['Es la portada de quien opera. Dice qué toca ahora y qué falta para dejar listo el mes, con su fecha. **Nada se marca a mano**: cada paso queda listo solo cuando el sistema ve que está hecho.'],
        pasos: [
          { titulo: 'Qué toca ahora', img: 'el-mes',
            marcas: [{ n: 1, t: 'Las pestañas de la bóveda: El mes, Tablero, Bancos, Movimientos, Cobranza, Presupuesto, Cierre, Seguridad y Bitácora.' },
              { n: 2, t: 'El mes con que se está trabajando. El sistema elige el último mes abierto; puedes cambiarlo.' },
              { n: 3, t: 'Cuántos pasos están listos.' },
              { n: 4, t: '**Lo que toca ahora**: el paso pendiente, por qué importa y un botón para ir a hacerlo.' },
              { n: 5, t: 'El camino completo del mes. Lo listo queda en verde; el paso de ahora, destacado.' },
              { n: 6, t: 'La fecha límite y cuánto queda (en rojo si está atrasado).' },
              { n: 7, t: '**Fechas que vienen**: las nuestras (cartolas, cierre) y las de los clientes (Previred, IVA).' },
              { n: 8, t: 'Cómo se trabaja cada mes, en tres líneas.' }] },
          { titulo: 'Los 6 pasos y sus fechas', texto: [[
            '**Subir las cartolas del banco** (hasta el día 3): el Excel de la cartola de cada cuenta, del 1 al último día del mes.',
            '**Agregar el detalle del banco** (día 3): el Excel «Mis Movimientos». Dice quién transfirió de verdad.',
            '**Excel BANCOS** (opcional): solo mientras se siga llenando a mano; lo anotado queda como propuesta.',
            '**Revisar los movimientos** (día 5): confirmar qué es cada uno.',
            '**Subir las ventas del SII** (día 5): el Registro de Ventas del mes, para la cobranza.',
            '**Cerrar el mes** (día 5): queda fijo; el tablero y los informes ya no cambian.']],
            consejo: ['Si quedó algo abierto de un mes anterior (por ejemplo, un movimiento del borde de una cartola), aparece un aviso arriba con un enlace a ese mes.'] }
        ] },
      { id: 'bancos', titulo: 'Sube la cartola y el detalle del banco', ruta: '#/finanzas',
        intro: ['Todo parte de la cartola del banco: es la fuente de verdad. El sistema la lee, revisa que el saldo cuadre y no duplica nada si se sube dos veces.'],
        pasos: [
          { titulo: 'La pantalla Bancos', img: 'bancos',
            marcas: [{ n: 1, t: 'Cuántos movimientos faltan por revisar, con un atajo a Movimientos.' }, { n: 2, t: 'Cada cuenta con su saldo y la fecha de su último movimiento.' },
              { n: 3, t: '**Subir cartolas**: el Excel del BCI, una o varias a la vez.' }, { n: 4, t: '**Agregar el detalle del banco**: el Excel «Mis Movimientos».' },
              { n: 5, t: '**Plata de clientes en custodia**: lo que cada cliente mandó para sus imposiciones o IVA, lo que se pagó por él y lo que queda.' },
              { n: 6, t: '**Aprender del Excel BANCOS** (el capítulo siguiente).' }] },
          { titulo: 'Revisa la cartola antes de importarla', img: 'cartola-revision',
            texto: [['En el banco, descarga la cartola en **Excel** (no en PDF).', 'En **Bancos**, toca **Subir cartolas** y elige el archivo (o varios).', 'Revisa la tarjeta: que diga **El saldo cuadra** ((1)) y que los totales coincidan con el banco ((2)).', 'Toca [[Importar]] ((5)).']],
            marcas: [{ n: 1, t: 'La cuenta, las fechas que cubre y si el saldo cuadra movimiento a movimiento.' }, { n: 2, t: 'Saldo anterior, lo que entró, lo que salió y el saldo final.' },
              { n: 3, t: 'Cuánto reconoce el sistema: verde = seguro, naranjo = con propuesta, gris = sin pista.' }, { n: 4, t: 'Movimientos nuevos y los que ya estaban (esos no se duplican).' }, { n: 5, t: '[[Importar]].' }],
            ojo: ['Si dice **No cuadra**, no la importes: la cartola está incompleta o fue modificada. Descárgala de nuevo desde el banco.'] },
          { titulo: 'Agrega el detalle del banco («Mis Movimientos»)',
            texto: ['La cartola trae nombres cortados («TRANSFER DE INVERSIONES») y «PAGO CUENTAS VIA INTERNET» para todo. El Excel **Mis Movimientos** del BCI dice el nombre completo de quien transfirió y si el pago fue a Previred, al SII o a la Tesorería.',
              ['En el portal del BCI, entra a **Mis Movimientos**, elige el mes y descarga en Excel.', 'En **Bancos**, toca **Agregar el detalle del banco** y elige el archivo.', 'Un aviso dice cuántos movimientos tienen ahora el nombre completo.']],
            consejo: ['Es normal que falten algunos: «Mis Movimientos» no trae los traspasos a otros bancos. El detalle nunca crea movimientos; solo completa los de la cartola.'] }
        ] },
      { id: 'excel', titulo: 'Aprende del Excel BANCOS (mientras se siga llenando)', ruta: '#/finanzas',
        intro: ['Si ese mes también se llenó el Excel BANCOS a mano, súbelo: lo que se anotó queda como **propuesta** en cada movimiento (nunca se confirma solo) y el sistema aprende **quién paga por quién**.'],
        pasos: [
          { titulo: 'Paso 1: enseña los nombres cortos', img: 'nombres',
            texto: [['En **Bancos**, toca [[Elegir el Excel BANCOS]] y elige el archivo.', 'Para cada nombre corto que se usa en el Excel, di **qué es** ((4)): un cliente, una empresa del grupo, un gasto de la empresa o nada.', 'Elige **cuál** (el cliente, la empresa o la cuenta del gasto).', 'Revisa la cuenta del banco de esa hoja ((5)) y toca [[Paso 2 · Guardar y aprender del Excel]] ((6)).']],
            marcas: [{ n: 1, t: 'Cuántos nombres no tienen propuesta.' }, { n: 2, t: 'Un nombre ya enseñado: los meses siguientes se reconoce solo.' },
              { n: 3, t: 'Un nombre que **falta**: dice cuántas filas tiene y quién pagó según el banco.' }, { n: 4, t: '¿Qué es?' }, { n: 5, t: 'La cuenta del banco de esa hoja.' }, { n: 6, t: 'Guardar y aprender.' }],
            consejo: ['Se hace **una sola vez** por nombre. Si dejas uno sin enseñar, sus filas no se aprenden, pero el resto sí.'] }
        ] },
      { id: 'movimientos', titulo: 'Revisa los movimientos', ruta: '#/finanzas',
        intro: ['Cada movimiento del banco hay que decir **qué es**: ingreso de la empresa, plata de un cliente para sus imposiciones o IVA, un pago por cuenta de un cliente, un gasto, un traspaso o un préstamo entre empresas. El sistema propone; tú confirmas. Lo que corriges, lo aprende.'],
        pasos: [
          { titulo: 'La lista del mes', img: 'movimientos',
            marcas: [{ n: 1, t: 'El mes y cuántos faltan.' }, { n: 2, t: 'Busca por nombre, cliente o monto.' }, { n: 3, t: 'Los totales del mes por tipo, y lo que falta revisar.' },
              { n: 4, t: 'Qué mostrar: **Por revisar**, **Con propuesta**, **Sin pista**, **Confirmados** o **Todos**.' }, { n: 5, t: 'Confirmar en lote (siguiente paso).' },
              { n: 6, t: 'Un movimiento: lo que dice el banco, el nombre completo del detalle y lo que se anotó en el Excel.' },
              { n: 7, t: 'Qué es: **Segura**, **Propuesta**, **Falta decir qué es** o **Confirmado**.' }, { n: 8, t: '✓ acepta la propuesta en un clic.' }],
            texto: ['El color a la izquierda de cada fila: verde = seguro, naranjo = propuesta, rojo = falta decir qué es.'],
            consejo: ['Con el teclado: ↑ y ↓ para moverte por la lista, Enter para abrir un movimiento.'] },
          { titulo: 'Clasifica en el panel', img: 'panel',
            texto: [['Toca un movimiento: se abre el panel con todo lo que se sabe.', 'Lee la **propuesta del sistema** y por qué la hace ((3)).', 'Elige **qué es** ((4)) y completa lo que pide ((5)): la cuenta, el cliente o la empresa.', 'Toca [[Guardar y siguiente]] ((7)): guarda y abre el que sigue.']],
            marcas: [{ n: 1, t: 'El monto, la fecha y la cuenta.' }, { n: 2, t: 'Lo que dice el banco, el detalle y el Excel.' }, { n: 3, t: 'La propuesta del sistema y su motivo.' },
              { n: 4, t: 'Los tipos, con una línea de ayuda cada uno.' }, { n: 5, t: 'Cuenta, cliente o empresa, según el tipo.' }, { n: 6, t: 'Dividir la transferencia.' },
              { n: 7, t: 'Anterior y siguiente, [[Guardar]] y [[Guardar y siguiente]].' }],
            ojo: ['**Ingreso de la empresa** es plata que la empresa ganó. Si un cliente manda plata para pagar **sus** imposiciones o IVA, es **Fondo de cliente recibido**: no es ingreso y no se puede gastar.'] },
          { titulo: 'Divide una transferencia', img: 'dividir',
            texto: ['A veces una sola transferencia trae dos cosas: el honorario y la plata para las imposiciones, o el pago de dos clientes.',
              ['En el panel, toca **Esta transferencia es de varios clientes o conceptos: dividirla**.', 'Para cada parte, escribe el monto y elige qué es, la cuenta y el cliente ((1)) ((2)).', 'Agrega más partes si hace falta ((4)).', 'Cuando diga **Suma exacta** ((3)), toca [[Guardar y siguiente]] ((5)).']],
            marcas: [{ n: 1, t: 'Primera parte: honorario del cliente.' }, { n: 2, t: 'Segunda parte: plata para sus imposiciones.' }, { n: 3, t: 'Lo que falta asignar, o «Suma exacta».' }, { n: 4, t: '[[Agregar parte]].' }, { n: 5, t: 'Guardar.' }],
            consejo: ['El tablero, la cobranza y la plata en custodia ven cada parte por separado.'] },
          { titulo: 'Clientes que pagan desde otra cuenta', img: 'opciones',
            texto: ['Muchos clientes pagan desde la cuenta de otra persona o de otra empresa. Por eso el nombre del banco **no** decide de qué cliente es: el sistema lo pregunta y aprende.',
              ['Si quien pagó ya pagó antes por **un** cliente, lo propone.', 'Si pagó por **varios**, muestra **Ha pagado por** con sus clientes ((2)): toca el que corresponde.', 'Si nunca había pagado, el movimiento queda «sin pista»: elige el cliente y el sistema lo recordará.']],
            marcas: [{ n: 1, t: 'Quién transfirió de verdad (del detalle del banco).' }, { n: 2, t: 'Los clientes por los que ha pagado, y cuántas veces.' }, { n: 3, t: 'El motivo: nunca elige solo cuando hay más de uno.' }, { n: 4, t: 'Elige qué es.' }] },
          { titulo: 'Los avisos antes de guardar', img: 'aviso',
            texto: ['Mientras llenas, el sistema revisa lo elegido contra lo que ya sabe. Si algo no calza, lo dice **antes** de guardar:',
              ['Quien pagó **nunca** ha pagado por ese cliente.', 'En el Excel BANCOS se anotó otra cosa.', 'El banco dice Previred, SII o Tesorería y se marca como otra cosa.', 'Un pago por cuenta de un cliente deja su plata en custodia **en negativo**.', 'El mismo cliente ya tiene un pago igual ese mes (¿pago doble?).'],
              'Con un aviso, el primer [[Guardar]] solo lo destaca y el botón cambia a [[Guardar igual]]. Si está bien así, vuelve a tocarlo.'],
            marcas: [{ n: 1, t: 'Los avisos: con ⚠ lo que probablemente está mal; con ⓘ lo que conviene saber.' }, { n: 2, t: 'La propuesta del sistema.' }, { n: 3, t: '[[Guardar igual]].' }, { n: 4, t: '[[Guardar igual y seguir]].' }] },
          { titulo: 'Confirma en lote', img: 'lote',
            texto: [['**Confirmar las seguras**: las que el sistema reconoce con certeza (comisiones del banco, reglas aprendidas).', '**Marcar las con propuesta** y luego **Confirmar marcadas**: confirma de una vez las que tienen la propuesta completa.']],
            marcas: [{ n: 1, t: 'Lo que queda por revisar.' }, { n: 2, t: 'Un movimiento que **no** se confirmó porque tiene un aviso: queda marcado.' }, { n: 3, t: '«Revisar el aviso»: ábrelo para verlo.' }],
            consejo: ['En lote solo se confirma lo que no tiene avisos. Lo demás queda marcado para que lo mires de a uno.'] }
        ] },
      { id: 'tablero', titulo: 'El tablero del mes', ruta: '#/finanzas',
        intro: ['El mes en 30 segundos: resultado, caja, cobranza y la plata de los clientes. Mientras queden movimientos por revisar, las cifras dicen **provisorio**.'],
        pasos: [
          { titulo: 'Lo que muestra', img: 'tablero',
            marcas: [{ n: 1, t: 'El mes y [[Informe del mes (PDF)]].' }, { n: 2, t: 'El informe y si es provisorio.' },
              { n: 3, t: 'Resultado, ingresos, gastos, caja y plata de clientes, contra el mes anterior.' },
              { n: 4, t: '**Lectura del mes**: lo que conviene mirar primero, en frases.' }, { n: 5, t: 'Ingresos y gastos mes a mes, con lo presupuestado.' },
              { n: 6, t: 'Del ingreso al resultado: en qué se fue cada peso.' }, { n: 7, t: 'Lo que hay que pagar el mes que viene y si la caja alcanza.' },
              { n: 8, t: 'La plata de clientes en custodia y quién quedó en negativo.' }],
            ojo: ['La plata de clientes en custodia **no** es de la empresa: el resultado y la caja libre no la cuentan.'],
            consejo: ['El PDF lleva una marca de agua con tu nombre y la fecha: si se reenvía, se sabe de dónde salió.'] }
        ] },
      { id: 'cobranza', titulo: 'La cobranza', ruta: '#/finanzas',
        intro: ['Lo que falta cobrar y desde hace cuánto. Las facturas vienen del SII y los pagos del banco se cruzan solos con ellas, de la más antigua a la más nueva.'],
        pasos: [
          { titulo: 'La pantalla Cobranza', img: 'cobranza',
            marcas: [{ n: 1, t: 'Por cobrar, vencido, más de 60 días, pagado sin factura y cobrado este mes.' }, { n: 2, t: 'Lo que conviene mirar.' },
              { n: 3, t: 'Desde hace cuánto se debe, por tramos.' }, { n: 4, t: '[[Subir ventas del SII]]: el Registro de Ventas en CSV. Las facturas no se digitan.' },
              { n: 5, t: 'Filtra y busca clientes.' }, { n: 6, t: 'Un cliente: facturas abiertas, deuda, días y último pago. Tócalo para ver su ficha.' }],
            texto: ['Para bajar las ventas del SII: en el SII, **Registro de Compras y Ventas → Ventas → Descargar detalles**.'],
            consejo: ['La plata que un cliente manda para sus imposiciones **no** paga facturas: solo los ingresos de la empresa se cruzan con la cobranza.'] }
        ] },
      { id: 'presupuesto', titulo: 'El presupuesto', ruta: '#/finanzas',
        intro: ['Lo presupuestado contra lo real, por cuenta, del mes y del año.'],
        pasos: [
          { titulo: 'Compara', img: 'presupuesto',
            marcas: [{ n: 1, t: '**Comparar** o **Editar**, el año y la empresa.' }, { n: 2, t: 'El mes.' }, { n: 3, t: 'Ingresos, gastos y resultado contra lo presupuestado.' },
              { n: 4, t: 'Cada cuenta: presupuesto, real, diferencia y ejecución; a la derecha, el año acumulado.' }],
            texto: ['En **Editar** se escribe el presupuesto de cada cuenta, mes a mes, por empresa.'],
            consejo: ['Ingresos sobre lo presupuestado es bueno (verde); gastos sobre lo presupuestado es malo (rojo).'] }
        ] },
      { id: 'cierre', titulo: 'Cierra el mes', ruta: '#/finanzas',
        intro: ['Un mes cerrado queda **fijo**: no se puede reclasificar ni recibir movimientos nuevos, y sus cifras ya no cambian. Se puede reabrir dando el motivo (queda en la bitácora).'],
        pasos: [
          { titulo: 'La pantalla Cierre', img: 'cierre',
            marcas: [{ n: 1, t: 'Si ya se puede dejar la planilla SIGECO.' }, { n: 2, t: 'Un mes abierto: lo que falta para cerrarlo.' },
              { n: 3, t: 'Un mes cerrado: quién lo cerró, cuándo, el resultado y la caja; [[Reabrir]] con motivo.' },
              { n: 4, t: '**Paralelo con la planilla SIGECO**: compara lo anotado a mano con lo que dice el banco.' },
              { n: 5, t: 'Lo que se verifica solo antes de archivar la planilla.' }, { n: 6, t: 'Los pasos en Google Sheets que se marcan a mano al retirar la planilla.' }],
            texto: [['Cuando el mes tenga todo en verde, toca [[Cerrar el mes]].', 'Si después hay que corregir algo, toca [[Reabrir]] y escribe el motivo.']] }
        ] },
      { id: 'seguridad', titulo: 'Seguridad y bitácora', ruta: '#/finanzas',
        intro: ['Quién tiene acceso, cómo se protege la información y todo lo que se hace en la bóveda.'],
        pasos: [
          { titulo: 'Seguridad', img: 'seguridad',
            marcas: [{ n: 1, t: 'Para qué sirve esta pantalla.' }, { n: 2, t: 'Personas con acceso, autenticadores activos y el estado de la bitácora.' },
              { n: 3, t: 'Las capas de seguridad.' }, { n: 4, t: 'Los últimos ingresos.' }, { n: 5, t: 'Buenas prácticas.' }] },
          { titulo: 'La bitácora', img: 'bitacora',
            marcas: [{ n: 1, t: 'Si la bitácora está íntegra: las entradas están encadenadas y si alguien borrara una, se notaría.' }, { n: 2, t: 'Cada acción: cuándo, quién, qué y el detalle.' }, { n: 3, t: 'Desde qué IP y qué equipo.' }],
            ojo: ['Si ves un ingreso que no reconoces, avisa de inmediato a la administración del sistema.'] }
        ] }
    ],
    preguntas: [
      { p: 'No veo Finanzas en mi barra lateral.', r: ['Solo lo ven las personas de la lista fija de la bóveda. Pide acceso a la gerencia: se agrega en el servidor, no desde una pantalla.'] },
      { p: 'Cambié o perdí mi teléfono, ¿cómo entro?', r: ['Avisa a la administración del sistema: reinicia tu autenticador y la próxima vez SIGSO te pide registrarlo de nuevo con tu contraseña.'] },
      { p: 'La cartola dice «No cuadra».', r: ['El saldo no sigue movimiento a movimiento: la cartola está incompleta o fue editada. Descárgala de nuevo desde el banco, en Excel, sin abrirla ni guardarla antes.'] },
      { p: '¿Qué pasa si subo la misma cartola dos veces?', r: ['Nada: los movimientos que ya estaban se reconocen y no se duplican. La revisión dice cuántos «ya estaban».'] },
      { p: 'Un cliente pagó desde la cuenta de otra persona.', r: ['Elige el cliente correcto en el panel. El sistema anota que esa persona paga por ese cliente y la próxima vez lo propone.'] },
      { p: 'Una transferencia trae el honorario y la plata de las imposiciones juntos.', r: ['Usa **Dividir** en el panel: una parte como **Ingreso de la empresa** y otra como **Fondo de cliente recibido** (Imposiciones). Tienen que sumar exacto.'] },
      { p: '¿Por qué un movimiento no se confirmó en lote?', r: ['Tenía un aviso (por ejemplo, un posible pago doble). Quedó marcado «Revisar el aviso»: ábrelo, revisa y usa [[Guardar igual]] si está bien.'] },
      { p: 'Me equivoqué en un movimiento ya confirmado.', r: ['Ábrelo (filtro **Confirmados**), corrígelo y guarda. Si el mes ya está cerrado, primero hay que reabrirlo en **Cierre**, con el motivo.'] },
      { p: '¿Por qué el tablero dice «provisorio»?', r: ['Porque quedan movimientos por revisar en ese mes: el resultado puede cambiar. Cuando todo esté confirmado, deja de decirlo.'] }
    ]
  });
})();
