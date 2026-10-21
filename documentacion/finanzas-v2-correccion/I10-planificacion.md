# I10 · Planificación y funciones heredadas — probado, con límites declarados (20-10-2026)

## Errores encontrados y corregidos (con prueba)

1. **Aprobación inventada en el presupuesto heredado.** Un presupuesto anterior a las versiones se copiaba a la
   historia como «APROBADO», con quien lo cargó como aprobador y la fecha de carga como fecha de aprobación.
   Ahora queda como versión **HEREDADA**:
   - sin aprobador ni fecha de aprobación;
   - con quién la cargó, cuándo y su procedencia («cargado antes de que existieran versiones y aprobación: no
     hay aprobación registrada»; si vino de un archivo, se nombra).

   Se sigue comparando por compatibilidad, y la pantalla lo dice: «Se compara contra: HomePymes v1
   **Heredada**, sin aprobación registrada; la cargó …».
2. **El 0 % de cobranza en la proyección se volvía 100 %.** Si llegaba como texto «0»,
   `Number('0') || …` lo descartaba. Ahora 0 % es 0 % (verificado en la demo: cobranza esperada $0); solo sin
   dato se usa 100 %.
3. **La foto del cierre salía de otro cálculo** (`finanzasTablero.calcular_`, el tablero anterior). Ahora sale
   del mismo contrato del informe (`reporte_`): «resultado» es el flujo propio, y la foto guarda además la
   calidad, la revisión y la disponibilidad. Los meses ya cerrados conservan la foto que se guardó en su
   momento; la versión reproducible de cada cierre siempre salió del informe.
4. **«Revisar movimientos» en Revisión del período abría Pendientes** (enlace heredado de antes de I08). Ahora
   abre Bancos › Movimientos en el mes revisado.

## I10.1 · Presupuesto

- Se conservan borrador, aprobación y versiones.
- Al editar se muestra la última versión (el borrador si existe).
- La comparación identifica la versión: quién la aprobó y cuándo, o «heredada» con su procedencia.
- Los valores uniformes importados siguen exigiendo confirmar su revisión antes de aprobar
  (`requiere_validacion`).
- **Cobertura del año:** el acumulado suma solo los meses con cartolas, en presupuesto y en real por igual.
  En la demo dice «El acumulado compara **3 de 10 meses** (agosto–octubre)», y el título de la columna y la
  cifra del año lo repiten («3 meses con datos»). Antes sumaba enero–octubre y solo advertía.

## I10.2 · Gastos compartidos y préstamos

**Gastos compartidos.** Se conserva lo que ya había: reparto por partes iguales, porcentaje o monto fijo, con
total exacto y criterio de redondeo visible; vínculo al pago real (el grupo cuenta una vez y cada empresa su
parte); historial de versiones.

**Nuevo:** un gasto sin vincular a su pago, o con la columna PAZ sin decidir, aparece en **Pendientes** («Gasto
compartido por resolver») y abre Gastos compartidos.

**Préstamos.** Se distingue:

| Concepto | Qué es |
|---|---|
| Planificado | lo que dice la ficha |
| Desembolsado | movimientos vinculados como desembolso; las dos piernas del banco cuentan una vez |
| Devuelto | movimientos vinculados como devolución |
| Saldo reconocido | desembolsado − devuelto |

**Evidencia:** cada movimiento vinculado se lista con su fuente (Banco o Registro), su rol y su empresa. Una
fila sin banco puede estar respaldada por una operación registrada.

**Estado real:** Sin desembolso, Desembolsado, Devuelto en parte o Devuelto. Un préstamo **sin desembolso
vinculado no se da por ficticio**: no es deuda reconocida, pero se muestra aparte en tres lugares:
- la tarjeta «Planificado sin desembolso vinculado»;
- el informe (`prestamos_sin_desembolso`);
- el comentario «Entre empresas».

«Lo que se deben las empresas» (informe) usa la deuda reconocida.

**Devoluciones validadas:** una devolución que supera lo que queda por devolver se rechaza. La segunda pierna de
una misma devolución no cuenta dos veces.

**Pantalla:** el estado va bajo las empresas y las acciones son más cortas. La tabla cabe en 1440 y 1366 (la
tabla mide lo mismo que su espacio); a 768 se desplaza dentro de su contenedor y la página no se desborda.

**En la demo:** el préstamo HomePymes → GDE de $1.000.000 no tiene desembolso vinculado. En I09 aparecía como
«GDE le debe $1.000.000»; ahora es «planificado sin desembolso». Es un cambio de cifra deliberado: sin
evidencia no se reconoce deuda.

## I10.3 · Proyectos y provisiones

- Proyectos se reutilizan por ID (SIGSO y planilla, sin duplicar).
- Se verificó que **0 % es 0 %** en las asignaciones de clientes (ya estaba) y se corrigió en la proyección.
- Recuperación: sin inversión real no se calcula («sin base»; ya estaba).
- Provisiones: método obligatorio, fuente, período, estado y aprobador; ahora también **responsable** (quién la
  registró) en la tabla. No mueven caja y no se calculan solas.

## I10.4 · Paridad y retirada de duplicaciones

**Tablero anterior retirado.** Había dos piezas: la pantalla `finanzas-tablero-v2.js` y la ruta
`finanzasTablero`.

- **Por qué se pudo retirar:** la pantalla ya no tenía ruta en la navegación; «Resumen» es el informe desde I08.
  Sus cifras divergían del contrato del informe. Su PDF y sus filtros (mes y empresa) los cubre el informe, que
  además tiene base y comparación. El permiso `VER_TABLERO` lo sigue usando el informe.
- **Qué se hizo:** se quitó el script de `plataforma.html` y se borró el archivo de la copia de trabajo, sin
  preparar nada para commit; su contenido sigue en git y en el respaldo de I00. Se quitó la ruta: la demo
  responde «Acción desconocida».
- **Qué queda:** el módulo de backend `finanzasTablero.js`, porque `deudasEntreEmpresas_` lo usa el informe; su
  función `tablero` solo la usan pruebas antiguas.

**Funciones heredadas tras los cambios** (todas en verde en `npm test`):

| Función | Cubierta por |
|---|---|
| Cuentas y cartolas | `finanzas-bancos` |
| Ventas SII | `finanzas-cobranza`, `finanzas-v2-cobranza-i04` |
| Detalle del banco y pagadores | `finanzas-pagadores` |
| División de transferencias | `finanzas-bancos`, `finanzas-v2-registro` |
| Alias | `finanzas-pagadores`, `finanzas-v2-cargas-i07` |
| Avisos | `finanzas-avisos` |
| Bitácora | `finanzas-boveda` |
| Préstamos con dos piernas | T19 |
| Cierre | `finanzas-cierre` |
| Enlaces heredados | revisados a mano; se corrigió el de Revisión del período |

**Planillas:** no se retira ninguna planilla. Su retiro sigue con sus condiciones en Revisión del período
(migración validada, paralelo igual y aceptación). Nada de esto toca producción.

## Pruebas

- Nueva: `backend/test/finanzas-v2-planificacion-i10.test.js`, con 6 casos:
  - presupuesto heredado;
  - cobertura del acumulado;
  - préstamo por evidencia con devolución validada;
  - 0 % de cobranza;
  - foto del cierre igual al informe;
  - gasto compartido en Pendientes.
- `npm test` → **1859/1859**.

## Evidencia (`evidencia/i10-*.png`)

| Tema | Archivos |
|---|---|
| Presupuesto | `presupuesto` (cobertura 3 de 10 meses, versión identificada, selectores en una fila) |
| Préstamos | `prestamos`, `1440-prestamos`, `1366-prestamos`, `768-prestamos` |
| Resto de Planificación | `gastos`, `proyectos`, `provisiones`, `proyeccion` |

## Límites conocidos

- **Consola de SIGSO:** al cargar la plataforma aparecen dos 403 de `reportarPermisoNotificacionesSO`. Ocurre
  antes de iniciar sesión, en el marco de SIGSO y no en Finanzas, y no se tocó.
- **Revisión del presupuesto heredado:** la definición queda pendiente; por ahora se compara por
  compatibilidad, marcado como tal.
- **Provisiones:** no se calculan solas. Falta el método de negocio y no se inventan reglas laborales ni
  tributarias.
- **Gastos compartidos de la demo:** la demo no los tiene en octubre, así que la pantalla aparece vacía. El caso
  con PAZ está cubierto por prueba.
