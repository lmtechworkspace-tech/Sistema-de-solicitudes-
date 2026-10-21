# I13.3 · Guion del piloto con las operadoras

**Estado: preparado, sin realizar.** No se envió ninguna invitación ni mensaje.

- **Aceptación:** sigue pendiente hasta que las operadoras hagan la sesión. El recorrido del desarrollador no cuenta como aceptación.
- **Ensayo previo:** solo comprobó que las seis tareas se pueden resolver y fijó el resultado esperado de cada una
  (`evidencia/i13-ensayo-piloto.json`).

## Objetivo

Medir con las personas que harán el trabajo, en una base de prueba igual para todas:

- el tiempo de cada tarea;
- cuánto se reescribe;
- cuántas pantallas se recorren;
- los errores;
- las ayudas que hacen falta;
- si se recurre a Excel.

**Cuándo comparar con la planilla:** si es viable, las mismas tareas se hacen también en la planilla anterior.

**Sobre el ahorro:** no se promete un porcentaje antes de medirlo. La meta de referencia de las instrucciones
maestras (30 % menos de tiempo en lo frecuente) se contrasta con lo medido, no se presume.

## Preparación técnica (la hace quien facilita)

1. **Armar la base de piloto.** `node preparar-piloto.js` arma una base **ficticia** en una carpeta que se llame
   `piloto`, con 3 usuarios:
   - `piloto1` y `piloto2`, que operan;
   - `lectura`, de solo lectura.
2. **Comprobar la carpeta.** El script se niega si:
   - la carpeta tiene otro nombre;
   - es una ruta de servidor;
   - la base tiene más de 5 cuentas, es decir, parece real.
3. **Levantar la API con esa base.** Usar la configuración `api-piloto` en el puerto 3099 y el frontend local.
4. **Preparar el acceso.** La clave y los secretos del autenticador quedan en `acceso.txt` dentro de esa carpeta,
   **fuera del repositorio**:
   - se cargan en el teléfono de cada operadora;
   - después de la sesión se borran.
5. **Repetir entre sesiones.** Antes de cada operadora se vuelve a correr `preparar-piloto.js`. Así todas parten
   del mismo estado.
6. **Punto de partida comprobado en el navegador** (`evidencia/i13-piloto-pendientes.png`): Pendientes muestra
   **8**:
   - 7 movimientos del banco sin clasificar;
   - el arriendo registrado el 30-09 sin su movimiento del banco.
7. **Dejar el pegado a mano.** El texto de la tarea 5 está en `evidencia/i13-pegado-piloto.txt`. Se deja abierto
   en un bloc de notas para copiarlo.

## Reglas de la sesión

- **Ayudas:** quien facilita no guía. Si la operadora pide ayuda se le da, pero se anota como «ayuda».
- **Tiempo:** corre desde que se lee la tarea hasta que la operadora dice «listo» y el resultado se ve en SIGSO.
- **Campos reescritos:** se cuenta cada dato que la operadora escribe y que ya estaba en otro lugar (en SIGSO, en la
  cartola o en el correo de la tarea).
- **Pantallas:** cada cambio de vista de Finanzas cuenta como una.
- **Errores:** un dato mal guardado que hubo que corregir, o un mensaje de error que la detuvo.
- **Excel u otra herramienta:** se anota si la operadora la abre para resolver la tarea.
- **Comentarios:** se anotan con sus palabras.

## Las seis tareas

En cada tarea, el **enunciado** es el texto que se le lee a la operadora. El **resultado esperado** es lo que
quien facilita comprueba en SIGSO al final.

### Tarea 1 · Cobro mensual

**Enunciado:** «Andes Montajes pagó su servicio de octubre. Déjalo registrado y aplicado a su factura.»

**Datos de partida:**
- un abono del banco de $357.000 el 05-10;
- la factura 9101 de $357.000 (01-10) pendiente.

**Resultado esperado:**
- la factura 9101 queda **Pagada** (saldo $0);
- el movimiento del banco queda conciliado: un solo hecho, no dos.

### Tarea 2 · Recibir fondos para una obligación

**Enunciado:** «Constructora Norte mandó la plata para sus imposiciones de septiembre, que se pagan en tres obras
(A, B y C). Regístrala.»

**Datos de partida:** un abono de $2.100.000 el 07-10.

**Resultado esperado:**
- hay una gestión de Constructora Norte por imposiciones de **2026-09**, con los destinos Obra A, B y C;
- la recepción está asignada a la gestión;
- **no** aparece como ingreso de la empresa.

### Tarea 3 · Pagar por destinos

**Enunciado:** «Se pagaron por Previred las imposiciones de las tres obras de Constructora Norte. Regístralo.»

**Datos de partida:** tres cargos Previred del 13-10: $1.258.430, $386.260 y $353.571.

**Resultado esperado:**
- cada pago está en su obra;
- la gestión queda con un **remanente de $101.739**, que se ve y no se ajusta solo.

### Tarea 4 · Aplicar un pago parcial a una factura

**Enunciado:** «Panadería Sol de Mayo abonó $200.000 de su factura de $500.000.»

**Datos de partida:**
- un abono de $200.000 el 15-10;
- la factura 9102 de $500.000.

**Resultado esperado:**
- la factura 9102 queda en **Pago parcial**, con saldo de $300.000;
- la fecha del abono no cambia.

### Tarea 5 · Corregir un pegado

**Enunciado:** «Pega estas 6 filas que venían en la planilla y déjalas cargadas.»

**Datos de partida:**
- el texto de `i13-pegado-piloto.txt`;
- la fila 3 trae la fecha **31/09/2026**, que no existe;
- en la fila 4, «Constructora Norte» calza con dos clientes.

**Resultado esperado:**
- SIGSO marca las 2 filas con su motivo;
- la operadora las corrige **dentro de SIGSO**: la fecha queda en 30-09, y el cliente se elige por su RUT
  77.123.456-1;
- quedan 6 filas cargadas;
- pegarlas de nuevo **no duplica**: las 6 salen como repetidas.

### Tarea 6 · Conciliar un banco posterior

**Enunciado:** «El arriendo que registraste el 30-09 apareció en el banco el 02-10. Déjalo conciliado.»

**Datos de partida:**
- la operación del 30-09 por $450.000, confirmada y sin banco;
- un cargo del 02-10 por $450.000.

**Resultado esperado:**
- SIGSO propone el par;
- la operación queda **Conciliada**;
- sigue en **septiembre**, porque el banco no le cambia el mes.

**Cierre de la sesión:** al terminar las seis tareas, Pendientes queda en **0**.

## Hoja de registro (una por operadora)

| Tarea | Inicio | Fin | Minutos | Campos reescritos | Pantallas | Errores | Ayudas | ¿Excel u otra herramienta? | Comentario (sus palabras) |
|---|---|---|---|---|---|---|---|---|---|
| 1 Cobro mensual | | | | | | | | | |
| 2 Fondos recibidos | | | | | | | | | |
| 3 Pagos por destino | | | | | | | | | |
| 4 Pago parcial | | | | | | | | | |
| 5 Corregir pegado | | | | | | | | | |
| 6 Banco posterior | | | | | | | | | |

**Referencia anterior.** Si es viable, se mide el tiempo de las mismas seis tareas en la planilla SIGECO/BANCOS:
- se usa una **copia** de la planilla con estas mismas situaciones ficticias;
- quien facilita debe prepararla, porque no se generó aquí;
- si no se hace, el informe lo dice y se compara solo contra el tiempo que las operadoras estiman hoy, declarado
  como estimación.

## Después de la sesión

1. **Registrar los resultados:** pasar las hojas a un resumen por tarea con la mediana de las operadoras, sin
   nombres.
2. **Separar los cambios:**
   - cada comentario que pida un cambio se convierte en un ítem con su causa;
   - se distingue lo que es error, lo que es mejora y lo que es decisión de negocio.
3. **Actualizar la aceptación:** solo entonces T44 y la aceptación por operadoras pasan de «pendiente» al resultado
   real, sea aprobado, aprobado con cambios o no aprobado.
4. **Limpiar:** borrar la carpeta `piloto`, con sus secretos, y quitar los autenticadores de los teléfonos.
