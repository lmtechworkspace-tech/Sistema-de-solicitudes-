# I06 · Fondos, aperturas y remanentes — probado (20-10-2026)

## Lo que ya había y se conserva

Gestión por cliente, empresa, obligación y período, con solicitado, apertura, recibido, pagado, devuelto,
reintegros y reasignaciones. Saldo de la gestión = apertura aprobada + recepciones + reintegros − pagos −
devoluciones ± reasignaciones. Lo que no tiene gestión se ve aparte y suma al total del cliente. La
custodia suma por separado los saldos a favor y los déficit.

## Qué se agregó

### Ficha por obligación (I06.1/I06.2)

- **Filtros de la ficha:** todas, por ejecutar, con déficit, remanente sin decidir y sin asignar (con
  conteos que calcula el servidor).
- **Saldo inicial conocido, propuesto o desconocido**, dicho con esas palabras. Un **$0 aprobado** es un
  cero conocido: no se le pide al cliente nuevo una historia que no existe.
- **Sugerencias para lo sin asignar:** gestiones abiertas que calzan por obligación (requisito), período
  y empresa, con el motivo.
- **«Crear gestión con este movimiento»** (`finanzasGestionDesdePieza`): toma cliente, empresa,
  obligación, período y destino del movimiento y lo asigna. No cambia montos ni la evidencia bancaria.
  El total del cliente no cambia: no desaparece plata ni se cuenta dos veces.

### Saldos iniciales en lote (I06.3)

- `finanzasRevisarAperturas`: pegar o subir una tabla con cliente (RUT o nombre), empresa, gestión
  opcional, fecha de corte, monto, moneda y fuente. Valida identidad, fecha, moneda (solo CLP), fuente,
  filas repetidas y **aperturas ya aprobadas o propuestas que se solapen**. Muestra filas aceptadas,
  incidentes y totales por empresa.
- `finanzasProponerAperturas`: propone solo las aceptadas, con el mismo token del contenido revisado (si
  cambió, se revisa de nuevo). Es idempotente.
- «Por aprobar (n)»: aprueba las marcadas; el servidor aplica la política a cada una.
- **Corregir una aprobada** (`finanzasCorregirApertura`): crea una **versión nueva propuesta**. La
  anterior sigue vigente hasta aprobar la nueva y entonces pasa a «Reemplazada» (queda en la historia,
  atenuada). No se sobrescribe en silencio.

### Política de aprobación (I06.4)

- Parámetro del catálogo `aperturas_dos_personas` (Configuración › Parámetros): **1** = quien propone no
  puede aprobar; **0** = una misma persona puede, queda registrado («propuesta y aprobada por la misma
  persona») y la pantalla dice que **no es un control de dos personas**. El valor por defecto es 0: no se
  impone una cadena basada en nombres de una reunión. El dueño decide.
- Quiénes pueden aprobar se calcula con la capacidad real `APERTURA` de las cuentas con acceso a la
  bóveda, y se muestra en Fondos.

### Remanentes (I06.4)

- Decidir (mantener, devolver, reasignar u honorario) es una **intención**: la ficha dice «Decidida: falta
  registrarla» hasta que exista el registro correspondiente (devolución, reasignación o conversión).
  Entonces dice «Ejecutada».
- **Convertir en honorario** (`finanzasConvertirRemanente`): requiere la decisión HONORARIO con respaldo.
  Crea dos operaciones de **compensación**, enlazadas entre sí y con la gestión:
  - la salida de los fondos del cliente;
  - el cobro propio, que queda aplicable a su factura en Cobranza.

  No hay un abono bancario ficticio ni dinero nuevo en la caja. Es idempotente.
- La reasignación entre clientes distintos sigue **bloqueada**, con un mensaje explícito: requiere un
  procedimiento y respaldo que aún no están definidos, y nunca sirve para tapar el déficit de otro.

## Casos de aceptación (I06.5)

| Caso | Resultado | Prueba |
|---|---|---|
| ARMA HIERRO: $2.100.000 − $1.258.430 − $386.260 − $353.571 | remanente $101.739, destinos y período | T07 y I06.4 |
| VYE: $5.000.000 + $2.074.824 − $7.074.824 | saldo $0 | **nuevo** I06.5 |
| ELOHIM: $5.000.000 + $5.000.000 + $1.302.013 − $11.302.014 | −$1, se conservan las dos recepciones | T08/T09 |
| +$100.000 y −$50.000 | custodia $100.000; déficit −$50.000 aparte | T12 |
| Recepción mixta $619.000 ($119.000 propios + $500.000 del cliente) | cada parte una vez en su circuito | T13 |

Los casos originales con sus fuentes reales no se verificaron aquí: no están en esta copia local y son
datos de producción. Los sintéticos reproducen la misma aritmética.

## Pruebas

- Nuevo `backend/test/finanzas-v2-fondos-i06.test.js` (4 casos).
- `npm test` → **1840/1840**.

## Recorrido en el navegador (base DEMO)

1. `i06-fondos.png`: política visible, «Cargar saldos iniciales» y «Por aprobar».
2. `i06-lote.png`: 2 aceptadas (una de ellas un $0 conocido) y 2 incidentes (repetida y cliente
   desconocido); total HomePymes $120.000.
3. `i06-por-aprobar.png`: se aprobaron. Quedan 0 clientes sin saldo inicial y 0 pendientes.
4. `i06-ficha.png`: Constructora Norte con saldo inicial conocido, filtros, gestión con el remanente
   «Ejecutada» y saldo $0.
5. `i06-sin-gestion.png`: lo sin asignar con «Asignar a Imposiciones 2026-08» y «Crear gestión con este
   movimiento».
6. Con «Asignar» y «Crear gestión» el total se mantuvo en $2.200.000. El remanente de $1.350.000 se
   convirtió en honorario: la gestión quedó en $0, «Ejecutada» (`i06-remanente.png` es el antes).

## Límites conocidos

- Para la política «dos personas» hay que poner el parámetro en 1. Con una sola cuenta con permiso
  APERTURA, las aperturas quedarían sin poder aprobarse: hay que asignar ese permiso antes.
- Los comprobantes adjuntos por gestión no están en este paquete. Los documentos adjuntos viven en la
  ficha comercial del cliente; se revisará en I08/I13 si hace falta llevarlos a la gestión.
