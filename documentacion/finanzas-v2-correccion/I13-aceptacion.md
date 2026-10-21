# I13 · Aceptación: pruebas concretas y piloto de uso (21-10-2026)

## En resumen

**Pruebas locales con fuentes reales:**
- T01, T02, T04, T07–T10, T37/T42, QA-R16 y QA-R17 se ejecutaron con las fuentes reales en una bóveda temporal. Pasan.
- Esas fuentes destaparon **5 errores**. Los 5 se corrigieron, cada uno con su prueba de regresión.

**Piloto con operadoras:** está **preparado y sin realizar**. Por eso T44 y la «aceptación por operadoras» quedan
**pendientes**.

**Lo que queda pendiente** está al final, con su impacto.

## Entorno

| | |
|---|---|
| Revisión | `af41a43` + cambios locales sin commit (ver I14) |
| Equipo y Node | AMD Ryzen 9 270, 16 GB, Node v24.16.0 |
| Pruebas | `npm test` → **1872/1872** (4 nuevas en I13) |
| Navegador | Chrome sin ventana (puppeteer-core) sobre la base DEMO, y frontend local apuntando a `127.0.0.1:3099` |

**Fuentes reales** (`documentacion/finanzas-documento/datos-iniciales/`):
- las 3 cartolas BCI de julio;
- el detalle «Mis Movimientos»;
- Excel BANCOS de julio y de agosto;
- SIGECO del 07-10 y su copia anterior.

**Cómo se usaron las fuentes reales:**
- Se cargaron en una **bóveda temporal** dentro de la carpeta temporal del sistema, que se borra al terminar.
- Solo se imprimieron totales, conteos y los tres casos de fondos que la orden nombra.
- Ninguna fila, glosa ni dato bancario original entra en este documento ni en el repositorio.

**Fixtures sintéticos:** los fixtures de las pruebas automáticas y las bases DEMO y de PILOTO son
**ficticios**, y así se identifican.

## Errores encontrados en I13 y corregidos

| # | Hallazgo (cómo se vio) | Corrección | Prueba que lo reproduce |
|---|---|---|---|
| 1 | **Volver a publicar** la hoja BCI del Excel BANCOS real lanzaba una excepción (`rango_` nulo): solo quedaban filas sin fecha y el servidor respondía con error. | `aprenderExcelBancos` responde «nada que aprender» si no hay filas con fecha. `publicar` no hace nada si la hoja no tiene filas pendientes. | `I13 · BANCOS real: filas de plantilla…` |
| 2 | Esa segunda publicación **vaciaba los grupos candidatos UNITARIO** del libro (ARMA HIERRO y los demás desaparecían). | Los grupos se arman con **toda** la hoja. Publicar un subconjunto o volver a publicar no los borra. | la misma prueba |
| 3 | El Excel BANCOS real arrastra **filas de plantilla** que solo tienen correlativo y saldo calculado: 1.452 en BCI y 648 en las dos hojas Santander. Se cargaban como datos: BCI decía 1.677 «publicadas» y Santander 655 «incidencias: sin fecha». El cuadro de control quedaba ilegible. | Una fila con datos solo en columnas calculadas (`AB`, `.`, `SALDO`) no se carga como fila, pero **se cuenta**: el cuadro dice «+ N de plantilla (sin datos)». Quedan BCI 225 filas y Santander 22 + 9. | la misma prueba |
| 4 | **ELOHIM real:** dos recepciones de $5.000.000 y un tercer abono igual de otro cliente a la misma distancia. Al crear la gestión desde la planilla se tomaba el abono equivocado: el saldo daba −$5.000.001 en vez de −$1, con una fila «por revisar». | Entre movimientos del mismo monto y distancia, primero el que ya está confirmado como fondo de **ese** cliente. | `QA-R17 · ELOHIM: dos recepciones iguales…` (falla sin el arreglo) |
| 5 | **T32, en el navegador:** una recarga lenta del Registro, por ejemplo al ordenar, **repintaba el Registro encima de Cobranza** si la persona ya se había ido. | El marco de Finanzas no deja pintar a una vista que ya no está a la vista. Registro y Movimientos solo pintan la última recarga. | `carrera-i13.js`: antes «Registro diario» sobre Cobranza; después «Cobranza» |

**Pruebas nuevas, además de las anteriores:**
- `QA-R16 · publicación interrumpida a mitad de hoja`: un corte simulado a mitad de la hoja. Al reintentar, 3 filas
  dan 3 borradores, sin duplicar, y un tercer intento no hace nada.
- `T41 · varios servicios (mensual y único)…`: cubre lo que T41 pedía y no estaba probado.

## Resultados con fuentes reales

Bóveda temporal, solo totales. El script de la prueba está en la carpeta de trabajo y no se versiona.

| Caso | Esperado (orden) | Obtenido |
|---|---|---|
| T01 · 3 cartolas BCI de julio | 246 movimientos; apertura $15.215.134; abonos $108.062.267; cargos $120.353.289; cierre $2.924.112 | **Igual en las cinco cifras.** 124 + 114 + 8 movimientos, los tres archivos cuadran y encadenan. En la bóveda hay 246 movimientos con los mismos abonos y cargos. |
| T02 · el mismo archivo y una exportación solapada | No duplica; conserva procedencia | Reimportar las 3 cartolas: **0 nuevas**, siguen 246. El detalle «Mis Movimientos» empareja 217 de 218 filas, aporta 121 pagadores y no crea movimientos. Repetirlo da el mismo resultado. |
| T04 · BANCOS julio y agosto, con hojas ocultas | Reconoce equivalencia; conserva 224 filas BCI y Santander sin repetir historia | BCI de julio: 225 filas (224 con fecha y monto, más una con solo texto). Las hojas Santander ocultas se incluyen. En el libro de agosto, Santander se reconoce **repetido**: 22 de 22 y 9 de 9. Las filas BCI de agosto son de agosto (no hay historia repetida). Publicar todo y repetir deja **24 operaciones** antes y después: sin doble conteo. El mismo archivo otra vez se rechaza como repetido. |
| QA-R16 · publicar, repetir e interrumpir | Controles por hoja, sin doble conteo ni grupos a medias | Cuadro por hoja con estados, importes y motivos. Repetir solo reintenta lo pendiente. La interrupción se cubre con la prueba sintética de arriba. |
| QA-R17 / T07 · ARMA HIERRO | $2.100.000 − $1.258.430 − $386.260 − $353.571 = **$101.739** | Grupo UNITARIO de julio: la suma del sistema da $101.739, igual a la planilla. **Gestión creada desde la planilla: saldo $101.739, diferencia 0**, con 4 de 4 movimientos asignados. Los tres pagos quedan como tres pagos separados. En la planilla real, la columna PLAN DE CUENTA solo nombra un destino para los tres: no hay tres nombres de destino que conservar. |
| QA-R17 / T08 · VYE | $5.000.000 + $2.074.824 − $7.074.824 = **$0** | Dos recepciones y un pago. Gestión: saldo **$0**, diferencia 0, 3 de 3 asignados. |
| QA-R17 / T09 · ELOHIM | $5.000.000 + $5.000.000 + $1.302.013 − $11.302.014 = **−$1** | Gestión: saldo **−$1**, diferencia 0, 4 de 4 asignados, sin ajuste silencioso. Antes de corregir el error #4 daba −$5.000.001. |
| T10 · pagador KRAKEN | Puede ser KRAKEN, ELOHIM o WWL; no una regla global | 8 movimientos del pagador. La planilla los atribuye a 4 clientes: ELOHIM, KRAKEN, WWL y ARMA HIERRO. Cada movimiento conserva el suyo (4 clientes distintos). El pagador aprende **4 clientes**. Un pago nuevo de ese pagador queda con certeza **baja** y **4 opciones**, sin cliente elegido. No se crea ninguna regla global. |
| T37 / T42 · SIGECO del 07-10 | Todas las hojas con destino; sin duplicar; MEJORAS con destino o incidencia | **Destinos y estados:** las 18 hojas tienen destino. Las de FLUJO y RESUMEN quedan como consulta. 261 clientes: 256 publicados y 5 con observación (monto de servicio ilegible). PRESUPUESTO: 34 «valores uniformes, revisar» y 4 con tipo no reconocido. MEJORAS: 6 filas, 4 con funcionalidad y 2 «sin funcionalidad todavía». **Incidencias explicadas:** PAGOS y HISTORIAL ABONOS quedan como incidencia hasta clasificar los abonos del banco; MOVIMIENTOS empareja 74 de 167 con el banco. **Sin duplicar:** volver a publicar solo reintenta lo pendiente y las operaciones no cambian (24 → 24). La copia anterior del 06-10 se reconoce como otro archivo, pero 16 hojas marcan sus filas como repetidas. |

**Catálogo sembrado para la prueba:**
- Para publicar CLIENTES, se sembró el catálogo de SIGSO con los RUT de la propia hoja, porque el catálogo de
  producción no se exporta.
- Para T10, los nombres cortos se enseñaron contra un catálogo de prueba que usa esos mismos nombres.
- Ambas cosas se declaran: en producción, el catálogo real decide.

## Matriz QA-R01–QA-R26

**Estados:**
- `aprobado`: ejecutado y pasa.
- `aprobado (real)`: además, con la fuente real.
- `parcial`: falta una parte, que se indica.
- `pendiente`: no se pudo ejecutar, con su causa.

| ID | Estado | Cómo se acreditó (servicio, API o navegador) |
|---|---|---|
| QA-R01 | aprobado | Prueba `QA-R01 · registro primero…` y `Demo · Andes $357.000…`. Navegador: `i01-informe.png` y `i01-registro.png`. |
| QA-R02 | aprobado | Prueba `QA-R02 · banco primero…`. Navegador: `i01-panel.png`. |
| QA-R03 | aprobado | Prueba `QA-R03 · dos cobros distintos iguales…`. |
| QA-R04 | aprobado | Prueba `QA-R04 · aplicar…, conciliarlo y deshacer`; también `Deshacer con dependencias…`. |
| QA-R05 | aprobado | Pruebas `QA-R05 · vínculo parcial` y `QA-R05 · varios contra varios…; un error revierte todo el grupo`. Navegador: `i02-*.png`. |
| QA-R06 | aprobado | Prueba `QA-R06 · operación del 31-07 y banco del 03-08…`. El ensayo del piloto (tarea 6) también: la operación del 30-09 sigue en septiembre. |
| QA-R07 | aprobado | Prueba `I03.2 · sin saldo inicial del cliente…`. Navegador: `i03-disponibilidad.png`. |
| QA-R08 | aprobado | Pruebas `I03.3 · con saldo inicial aprobado…`, T12 y T13: los fondos de clientes no suben la disponibilidad propia. |
| QA-R09 | aprobado | Prueba `I03.5 · proyección: … reemplaza estimación por compromiso…`. |
| QA-R10 | aprobado | Prueba `I03.4 · mes en curso…`; también T29. |
| QA-R11 | aprobado | Pruebas T31 e `I09.4 · comentarios…`: lo pendiente deja el mes provisorio y no se celebra. |
| QA-R12 | aprobado | `listar` separa confirmados de borradores. Navegador: entradas confirmadas $1.276.000 y salidas $25.000; borradores +$476.000 / −$89.000 aparte (`i05-registro.png`). |
| QA-R13 | aprobado | **Navegador:** pago parcial, varias facturas, nota de crédito, tercero y desaplicación (`i04-*.png`). **Pruebas:** `I04.3` e `I04.4`. **Permisos:** I11. |
| QA-R14 | aprobado | Prueba `I05.5 · obligaciones de Control interno: … pagos parciales y sin repetir el evento`. |
| QA-R15 | aprobado | Pruebas T33 e `I07.2 · corregir una fila en SIGSO…`. Navegador: `i07-corregir.png`. Ensayo del piloto, tarea 5. |
| QA-R16 | aprobado (real) | Ver la tabla real; se corrigieron los errores 1–3. Interrupción: prueba `QA-R16 · publicación interrumpida…`. |
| QA-R17 | aprobado (real) | $101.739, $0 y −$1 desde la planilla real, de grupo a gestión con diferencia 0. Se corrigió el error 4. |
| QA-R18 | aprobado | **Pruebas:** T18 e `I11.2 · actualizar sin la versión vista no pisa…`. **Navegador:** el conflicto conserva lo escrito (`i12-conflicto.png`). |
| QA-R19 | **parcial** | Capacidades: matriz por API de 123 acciones (I11) y sin filtración por caché (I12). **Alcance por empresa o cuenta: no implementado.** Hoy una persona con acceso ve todas las empresas del grupo. |
| QA-R20 | aprobado | Pruebas `I11.3` e `I11.4/I11.5`: excepción con evidencia que no cambia la calidad y versiones anteriores intactas. Navegador: `i11-cierre.png`. |
| QA-R21 | aprobado | Pruebas `I12.2`: transacción revertida (falla sin el arreglo), otra conexión, olvido al cerrar. |
| QA-R22 | aprobado | **Repetido hoy** sobre la base DEMO actual, que ya incluye la revisión de datos, los cierres v2 y los permisos. Respaldo con `VACUUM INTO` y restauración en otra carpeta: 39 tablas FIN, 87/87 registros descifrados, cierre, adjunto (SHA-256) y cadena de bitácora **idénticos**. Con otra llave se descifran 0/87. |
| QA-R23 | aprobado | Navegador (I12): «No guardado» con lo escrito, la misma clave al reintentar, rescate al cerrar la bóveda y bóveda cerrada sin cifras. Hoy se repitió tras el arreglo de T32 y sigue igual. |
| QA-R24 | **parcial** | I08 cubrió 1440, 1366, 1024, 768 y 390 px, claro y oscuro, teclado, movimiento reducido y contraste. **Falta** recorrer la pantalla con volumen grande, por ejemplo miles de filas en el Registro. Los tiempos de I12 son de servidor. |
| QA-R25 | aprobado | Pruebas T35, `T35/FIN-39` e `I09.5`: misma revisión y metadatos del contrato. Si los datos cambian, el PDF pide recargar. |
| QA-R26 | aprobado | I12: S1/S2 antes y después. Por ejemplo, el informe de S2 bajó de 11,8 s a 0,62 s. La carga masiva sigue lenta: 231 s. |

## Matriz T01–T45

Conservadas tal como estaban. Solo cambiaron en I09 las expectativas de T31, por un cambio intencional y
justificado en `I09-informes.md`.

| ID | Estado | Evidencia |
|---|---|---|
| T01 | aprobado (real) | Tabla real. |
| T02 | aprobado (real) | Tabla real. |
| T03 | aprobado | `T03 · dos operaciones legítimas iguales…`. |
| T04 | aprobado (real) | Tabla real y prueba `T04 · BANCOS…`. |
| T05 | aprobado | `QA-R06 …` y `T06 · fechas civiles…` (febrero, fin de mes, serie de Excel). |
| T06 | aprobado | `T06 · montos…`, `T06 · fechas…` e `I07.3 · montos…`. |
| T07 | aprobado (real) | Tabla real y prueba T07. |
| T08 | aprobado (real) | Tabla real (VYE) y `I06.5 · VYE`. |
| T09 | aprobado (real) | Tabla real (ELOHIM) y prueba `QA-R17 · ELOHIM…`. |
| T10 | aprobado (real) | Tabla real; también `un pagador que paga por varios clientes: opciones…`. |
| T11 | aprobado | `T11/T14(fondos) · apertura…`. |
| T12 | aprobado | `T12 · dos clientes (+100.000 y −50.000)…`. |
| T13 | aprobado | `T13 · recepción mixta de $619.000…`. |
| T14 | aprobado | `T14 · aplicar a una factura inexistente…`. |
| T15 | aprobado | `T15 · el mismo folio en dos empresas…`. |
| T16 | aprobado | `T16 · parciales, varias recepciones y nota de crédito…`. |
| T17 | aprobado | `T17 · conciliación todo o nada…` e `I04.3 · … grupo atómico`. |
| T18 | aprobado | `T18 · edición simultánea…` e I11.2; navegador `i12-conflicto.png`. |
| T19 | aprobado | `T19 · préstamo con las dos piernas…` e `I10.2 · préstamo sin desembolso…`. |
| T20 | aprobado | `T20 · reparto determinista…` y `T20 · gasto compartido…`. |
| T21 | aprobado | `T21 · una provisión no cambia el banco…`. |
| T22 | aprobado | `T22 · proyecto: 0 % se queda en 0 %…` e `I10.3`. |
| T23 | aprobado | `T23 · presupuesto…`, `presupuesto en otra base…` e `I10.1`. |
| T24 | aprobado | `T24/T36 · cierre…` (versión reproducible). |
| T25 | aprobado | `T25 · solo lectura…` y la matriz por API de I11.1. |
| T26 | **parcial** | **Hecho:** expiración por inactividad y al salir (pruebas de bóveda); caché por sesión y olvido al cerrar (I12); la vista se limpia al cerrar (I12, navegador). **Falta:** el alcance por empresa o cuenta, que no está implementado (como en QA-R19). |
| T27 | aprobado | Igual que QA-R22. |
| T28 | aprobado | Las dos pruebas `T28 …`. |
| T29 | aprobado | `T29 · comparaciones sin infinitos…`. |
| T30 | aprobado | `T30 · cobertura incompleta…`. |
| T31 | aprobado | `T31 · comentario automático…`. |
| T32 | aprobado (con corrección) | **Antes:** en el navegador, `carrera-i13.js` mostró el error 5. **Después:** 4 de 4 casos correctos: mes lento seguido de otro mes, ordenar lento y salir, Movimientos lento y salir, informe lento seguido de otro mes. |
| T33 | aprobado | `T33 · pegado desde Excel…` y tarea 5 del ensayo. |
| T34 | aprobado | Igual que QA-R23. |
| T35 | aprobado | Las dos pruebas T35 e I09.5. |
| T36 | aprobado | `T24/T36` e `I11.4/I11.5`. |
| T37 | aprobado (real) | Tabla real (SIGECO), `T37/T42` e `I07.2`. |
| T38 | aprobado | Igual que QA-R26. |
| T39 | aprobado | `formato no soportado…`, `detecta una cartola alterada…` y el centro de cargas (I07). |
| T40 | aprobado | `T40 · editar una regla…` e `I07.6`. |
| T41 | aprobado | `T41 · varios servicios (mensual y único)…` (nueva) y `ficha del cliente…`: un documento interno no es una emisión externa. |
| T42 | aprobado (real) | Tabla real: 18 hojas con destino y MEJORAS con funcionalidad o incidencia. |
| T43 | aprobado | I08: capturas y medición a 1440, 1366, 1024, 768 y 390 px, claro y oscuro, teclado y movimiento reducido. |
| T44 | **pendiente** | Sesión con operadoras no realizada. Guion y base listos: [I13-guion-piloto.md](I13-guion-piloto.md). |
| T45 | aprobado | `T45 · efectivo no espera cartola…` y `Efectivo no es posible duplicado…`. |

## I13.3 · Piloto

**Preparado:**
- guion de 6 tareas con su enunciado, punto de partida y resultado esperado;
- hoja de medición;
- base ficticia reproducible, cuyo script se niega a trabajar sobre una base real;
- punto de partida comprobado en el navegador (`i13-piloto-pendientes.png`, `i13-piloto-cobranza.png`).

**Ensayo sobre una copia** (`i13-ensayo-piloto.json`): las 6 tareas se pueden resolver.

| Tarea | Resultado del ensayo |
|---|---|
| 1 | Factura 9101 Pagada. |
| 2 y 3 | Gestión de 2026-09 con remanente $101.739, cada pago en su obra. |
| 4 | Factura 9102 en Pago parcial, saldo $300.000. |
| 5 | Pegado con 2 filas marcadas (fecha y cliente). Corregidas, quedan 6 cargadas; repetir da 6 repetidas. |
| 6 | El par se propone, queda conciliado y sigue en septiembre. |

Pendientes: de 8 a 0.

**Sin realizar:** la sesión con las operadoras. No se envió ninguna invitación. **No hay mediciones humanas ni
comentarios de operadoras**, y no se promete ningún ahorro.

## I13.4 · ¿Se puede llamar terminada la corrección local?

| Condición | Estado |
|---|---|
| Cifras y conclusiones críticas de I01–I03 corregidas y probadas | Sí. QA-R01–R12 aprobadas. |
| Cobranza, registro, fondos, conciliación y carga se completan desde el navegador | Sí: I04–I07, con capturas. La base de piloto lo deja listo para medirlo con personas. |
| Campos y funciones obligatorias de BANCOS/SIGECO no se pierden | Sí, con fuentes reales: las 18 hojas de SIGECO y las hojas ocultas de BANCOS tienen destino; MEJORAS con funcionalidad o incidencia. **Límite:** no hay lector de cartola Santander, porque falta una cartola real. |
| La interfaz cumple I08, sin acciones centrales recortadas | Sí, en los tamaños medidos. **Falta** el volumen grande en pantalla (QA-R24 parcial). |
| Permisos, concurrencia, recuperación y restauración tienen evidencia | Sí, salvo el **alcance por empresa**, que no está implementado (QA-R19 y T26 parciales). |
| Los reportes exportados coinciden con su contrato y revisión | Sí: QA-R25 y T35. |
| Límites de fuentes, decisiones o sesión humana declarados | Sí: ver abajo. |

**Conclusión:** la corrección local está **terminada con límites declarados**.

**No está lista para reemplazar las planillas.** Para eso falta:
- la sesión con operadoras (T44);
- la migración real del alcance que se active, sobre la copia de producción;
- las decisiones de abajo.

## Pendientes, con su impacto

| Pendiente | Tipo | Impacto | Quién lo destraba |
|---|---|---|---|
| Sesión con operadoras (T44) | Validación humana | Sin ella no hay «aceptado por operadoras» ni medición de ahorro. | El dueño agenda la sesión; el guion y la base están listos. |
| Alcance por empresa o cuenta (QA-R19, T26) | No implementado; requiere una decisión | Toda persona con acceso a Finanzas ve todo el grupo. Es aceptable si solo acceden quienes llevan el grupo completo. | Decisión del dueño: ¿hace falta restringir por empresa? |
| Volumen grande en pantalla (QA-R24) | Prueba faltante | Riesgo de lentitud en el navegador con miles de filas, no medido. | Técnico: medir en I14 con S2 en el navegador. |
| Lector de cartola Santander | Falta la fuente | Los movimientos de Santander entran como borradores desde el Excel BANCOS y no se concilian contra una cartola. | Hace falta una cartola Santander real en Excel. |
| Carga masiva lenta (231 s con 14.400 movimientos) | Rendimiento | Es una migración puntual; se puede hacer por lotes. | Técnico, si se migra todo el historial. |
| Política de cierre estricta apagada por defecto; la excepción la puede aprobar quien la pide | Decisión de negocio | Hoy cierra una sola persona. | Decisión del dueño (parámetros `cierre_exige_revision` y `cierre_dos_personas`). |
| Datos reales dentro de la carpeta del repositorio (`documentacion/finanzas-documento/datos-iniciales/`) | **Resuelto en I14** | Excluidos en `.gitignore`, junto con el `.zip` CONFIDENCIAL. | — |
| Capturas del manual de Finanzas | **Hecho en I14** | Manual reescrito con la navegación v2: 13 capítulos y 14 capturas nuevas. | [I14-entrega.md](I14-entrega.md) |

## Archivos tocados en I13

**Código:**
- `backend/logica/finanzasPagadores.js`: aprender sin filas con fecha.
- `backend/logica/finanzasCargas.js`: filas de plantilla, publicar sin filas, grupos con toda la hoja, preferencia
  del movimiento del cliente.
- `frontend/js/finanzas-cargas-v2.js`: plantilla en el cuadro.
- `frontend/js/finanzas-v2.js`: una vista vieja no pinta.
- `frontend/js/finanzas-registro-v2.js` y `frontend/js/finanzas-bancos-v2.js`: recargas vigentes.

**Pruebas:**
- `backend/test/finanzas-v2-reportes.test.js`: 3 nuevas.
- `backend/test/finanzas-v2-fondos-cobranza.test.js`: T41.

**Documentación:**
- este documento, `I13-guion-piloto.md` y `evidencia/i13-*`;
- `.claude/launch.json`: configuración local `api-piloto`, que no se publica.

**Scripts fuera del repositorio**, en la carpeta de trabajo de la sesión: prueba con fuentes reales, restauración,
carrera T32, y preparación y ensayo del piloto. En I14 pasan al repositorio los que no tocan datos reales, con la
protección de ruta.
