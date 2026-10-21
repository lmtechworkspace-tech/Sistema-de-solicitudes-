# I04 · Cobranza completa desde la interfaz — probado (20-10-2026)

## Qué había

La vista de Cobranza era la de la Etapa 3: listaba clientes y decía que los pagos «se cruzarán solos». Los
servicios `finanzasAplicar`, `finanzasDesaplicar`, `finanzasAceptarSugeridasCobro`, `finanzasEditarFactura`
y `finanzasGuardarRelacionCobro` existían, pero ninguna pantalla los usaba.

## Qué hay ahora

### Bandeja por factura (I04.2): `finanzasFacturas`

- Identidad = **emisor + tipo + folio**: la F 9001 de HomePymes y la F 9001 de GDE son dos documentos.
- Filtros: emisor, cliente, «vence hasta», búsqueda por folio, RUT o nombre, y estado (abiertas,
  vencidas, con propuesta, pagadas, incobrables, todas).
- Indicadores: facturado, **saldo confirmado**, vencido, cobros propios sin aplicar y lo **propuesto por
  SIGSO** (aparte: no reduce la deuda).
- Estado: «Pagada» solo con saldo confirmado cero. «Pago parcial» si hay algo confirmado. «Aplicación
  sugerida» si solo lo cubre una propuesta (antes decía «Pagada (sugerido)»).
- Las notas de crédito aparecen como documento, con la factura que rebajan.
- La propuesta FIFO ahora respeta el emisor: antes proponía cobros de HomePymes para facturas de GDE
  (**error encontrado y corregido**; prueba agregada).

### Aplicar (I04.3): `finanzasCobrosElegibles` + `finanzasAplicar` con `grupos`

1. Se marcan una o varias facturas y se abre «Aplicar cobro». Muestra emisor, cliente, saldo y corte.
2. Cobros elegibles: fecha, medio, cuenta, origen, monto, aplicado y disponible. Los fondos de clientes
   nunca aparecen. Un cobro de otro cliente o emisor aparece solo con una relación vigente, y se explica
   cuál.
3. Tabla cobro × factura con una propuesta editable, el saldo resultante y lo que queda sin aplicar.
4. El servidor valida disponibilidad, versión de cada factura, identidad, permisos, mes cerrado y
   compatibilidad. Todo el grupo se confirma o no se aplica nada.
5. Es idempotente: la misma clave devuelve el mismo resultado; la misma clave con otro contenido devuelve
   `IDEMPOTENCIA`.
6. La respuesta trae los saldos de las facturas y la disponibilidad de los cobros según el servidor. La
   pantalla no resta por su cuenta.
7. No cambia la fecha del cobro, no toca el banco y no suma ingresos.

### Factura, desaplicar, vencimiento, terceros y créditos (I04.4)

- **Panel de factura:** aplicaciones (con cobro, cuenta, fecha y autor), vencimiento, anular, incobrable,
  reactivar y «Abrir cliente».
- **Desaplicar:** exige motivo y versión, y respeta el mes cerrado. Responde con el saldo que recupera la
  factura y lo que vuelve a quedar disponible. El cobro y su evidencia se conservan.
- **Vencimiento:** fecha acordada, condición comercial (días desde la emisión) o plazo por defecto, siempre
  con su procedencia («por defecto» no es un acuerdo). El historial guarda antes, después y respaldo.
  Exige versión.
- **Terceros:** cada relación registra pagador, beneficiario, emisor (alcance), vigencia, quién autoriza y
  respaldo. Se puede terminar. Fuera de vigencia o de alcance no habilita nada.
- **Nota de crédito:** rebaja su factura una sola vez, también al reimportar. La referencia se corrige
  desde el panel.
- **Reemplazo desde el SII:** si el total nuevo es menor que lo ya aplicado, no se sobrescribe. La factura
  queda marcada «Revisar: el SII trae otro total» hasta resolver.

### Documentos y ayudas (I04.5)

- Ficha del cliente: cada documento (nota de venta, contrato…) puede relacionar facturas. Es opcional:
  relacionarlas no emite ni paga nada.
- Se eliminó la promesa «se cruzarán solos». La pantalla y el manual explican la diferencia entre cobro
  recibido, aplicación propuesta y factura pagada.

## Pruebas

- Nuevo `backend/test/finanzas-v2-cobranza-i04.test.js` (7 casos).
- Ajustes justificados en pruebas previas: el nombre «Aplicación sugerida» y desaplicar con versión.
- `node --test backend/test/finanzas*.test.js` → **122/122**. `npm test` → **1832/1832**.

## Recorrido en el navegador (base DEMO, datos ficticios)

Se completó todo desde la interfaz y se verificó al recargar:

| Paso | Resultado |
|---|---|
| F 9001 ($500.000) y F 9002 ($300.000, NC $50.000) con un cobro de $619.000 | 9001 «Pagada»; 9002 «Pago parcial», saldo $12.000 |
| Desaplicar en la F 9002 con motivo | saldo $250.000; el cobro recupera lo disponible |
| Vencimiento de la F 9003 a 45 días con respaldo | vence 30-10-26, origen «condición» |
| F 9003 de Eléctrica pagada por Transportes del Sur (relación vigente) | «Pagada»; la aplicación muestra el cobro de CL-5 |
| La F 9001 de GDE | sigue «Vencida»: FIFO no le propone cobros de HomePymes |

Capturas en `evidencia/`:

- `i04-bandeja.png`, `i04-todas.png`
- `i04-aplicar.png`, `i04-tercero.png`
- `i04-factura.png`, `i04-factura-tercero.png`
- `i04-relaciones.png`

## Límites conocidos

- En 1440 px, la columna de estado y las acciones requieren desplazamiento horizontal porque el panel del
  módulo ocupa ~320 px. Se resuelve en I08 (navegación en una columna de 220–248 px).
- La captura del manual de Cobranza es anterior. El texto ya está actualizado; la imagen se rehace después
  de I08.
- Anular o reactivar una factura acepta `expected_version`, pero todavía no la exige. Eso queda para I11.
