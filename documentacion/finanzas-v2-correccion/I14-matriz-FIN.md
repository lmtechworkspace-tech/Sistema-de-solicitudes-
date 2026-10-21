# I14 · Matriz FIN-01–FIN-48, verificada contra el código (21-10-2026)

## Cómo se verificó

Ninguna fila copia el «Hecho» de la entrega anterior. Cada fila nombra:

- el **archivo real** que la implementa;
- una **prueba** que la ejerce, citada por su título exacto;
- la **evidencia** en el navegador, cuando aplica.

El script `verificar-matriz-fin.js` (en la carpeta de trabajo de la sesión) comprobó tres cosas:

- que cada archivo citado existe;
- que cada prueba citada existe con ese título en `backend/test/`;
- que el módulo está conectado a una acción del router o a la página `plataforma.html`.

**Resultado de la comprobación:** ver el final del documento.

## Estados

- **Implementado y probado:** función completa, persistente y con evidencia en local.
- **Pendiente de fuente o entorno:** el código existe, pero una parte no se pudo validar.
- **Decisión pendiente:** falta una regla de negocio.
- **No implementado:** queda trabajo.

## Matriz

| FIN | Tema | Estado | Archivo real | Prueba (título) | Evidencia |
|---|---|---|---|---|---|
| 01 | Inventario real antes de modificar | Implementado y probado | `documentacion/finanzas-v2-correccion/I00-preparacion.md` | — (inventario y línea base 1805/1805) | I00 |
| 02 | Paridad funcional obligatoria | Implementado y probado (límite: sin lector Santander) | `backend/logica/finanzasCargas.js` | «T37/T42 · SIGECO: se reconoce, entra a staging con todas las hojas y se publica hoja a hoja sin duplicar» | I13: 18 hojas SIGECO reales con destino |
| 03 | Catálogos e identidades | Implementado y probado | `backend/logica/finanzasCatalogos.js` | «catálogos: alias resuelven a la empresa canónica, desactivar no borra la historia» | i07-* |
| 04 | Clientes, servicios y documentos | Implementado y probado | `backend/logica/finanzasClientes.js` | «T41 · varios servicios (mensual y único) con su vigencia; una nota de venta los relaciona; terminar uno no borra su historia» | i08-ficha-*.png |
| 05 | Separar operación, banco y aplicaciones | Implementado y probado | `backend/logica/finanzasHechos.js` | «QA-R01 · registro primero: el pendiente del banco no suma y, tras vincular, es una sola operación» | i01-*.png |
| 06 | Identidad y reintentos | Implementado y probado | `backend/logica/finanzasBase.js` | «idempotencia: la misma clave con el mismo contenido devuelve lo mismo; con otro, conflicto» | i12-no-guardado.png |
| 07 | Dinero, fechas y bases | Implementado y probado | `backend/logica/finanzasBase.js` | «T06 · fechas civiles validadas contra el calendario (febrero, fin de mes, serie de Excel)» | — |
| 08 | Consistencia y edición concurrente | Implementado y probado | `backend/logica/finanzasOperaciones.js` | «I11.2 · actualizar sin la versión vista no pisa (antes se aceptaba); con versión vieja, conflicto» | i12-conflicto.png |
| 09 | Tabla operativa | Implementado y probado | `frontend/js/finanzas-registro-v2.js` | «I05.2 · el orden se aplica al conjunto completo, no a la página» | i05-registro.png, manual `registro` |
| 10 | Formulario guiado equivalente | Implementado y probado | `frontend/js/finanzas-registro-v2.js` | «borrador: se guarda incompleto, dice qué le falta y no cuenta; confirmar exige todo» | i05-guiado.png |
| 11 | Pegado e importación masiva | Implementado y probado (I14: corrección de la celda dentro de SIGSO) | `backend/logica/finanzasOperaciones.js` | «T33 · pegado desde Excel: error por fila, cliente por RUT/nombre, token del contenido y sin duplicar al repetir» | manual `pegado`; `verificar-pegado.js` |
| 12 | Borradores, recurrencias y reutilización | Implementado y probado | `backend/logica/finanzasOperaciones.js` | «I05.5 · plantillas: vista previa por instancia, reconoce lo generado y muestra diferencias sin sobrescribir» | i05-plantillas.png |
| 13 | Gestión completa de fondos | Implementado y probado | `backend/logica/finanzasFondos.js` | «T07 · gestión con una recepción, tres pagos con destino y el período de la obligación; queda el remanente» | i06-*.png; I13 real (ARMA, VYE, ELOHIM) |
| 14 | Aperturas | Implementado y probado | `backend/logica/finanzasFondos.js` | «I06.3 · aperturas en lote: vista previa, incidentes, totales por empresa, cero conocido y corrección por versión» | i06-lote.png |
| 15 | Saldo y disponibilidad | Implementado y probado | `backend/logica/finanzasReportes.js` | «I03.2 · sin saldo inicial del cliente: la disponibilidad propia no es determinable y nadie dice «alcanza»» | i03-*.png |
| 16 | Distribuciones sin duplicación | Implementado y probado | `backend/logica/finanzasOperaciones.js` | «T13 · recepción mixta de $619.000: $119.000 propios y $500.000 del cliente, cada parte en su circuito una vez» | — |
| 17 | Centro de cargas | Implementado y probado | `frontend/js/finanzas-cargas-v2.js` | «I07.5 · cuadro de control: cantidades e importes por hoja, con motivos agrupados» | i07-centro.png, manual `cargas` |
| 18 | Fuentes y duplicados | Implementado y probado (real) | `backend/logica/finanzasCargas.js` | «T04 · BANCOS: hojas ocultas incluidas; la historia de Santander repetida en otro libro no se vuelve a cargar; grupos UNITARIO» | I13 real T01/T02/T04 |
| 19 | Conciliación explícita | Implementado y probado | `backend/logica/finanzasConciliacion.js` | «QA-R05 · varios contra varios con asignación explícita; un error revierte todo el grupo» | i02-*.png, manual `conciliacion` |
| 20 | Reglas, alias y pagadores | Implementado y probado (real) | `backend/logica/finanzasReglas.js` | «T40 · editar una regla: vista previa del impacto; desactivarla cambia lo pendiente y no toca lo confirmado» | i07-regla*.png; I13 T10 real |
| 21 | Documentos y ciclo comercial | Implementado y probado | `backend/logica/finanzasCobranza.js` | «I04.2 · bandeja por factura: identidad emisor+tipo+folio, totales confirmados y lo sugerido aparte» | i04-*.png |
| 22 | Aplicación explícita | Implementado y probado | `backend/logica/finanzasCobranza.js` | «I04.3 · varios cobros a varias facturas en un grupo atómico; respuesta con los saldos del servidor; idempotente» | i04-aplicar.png, manual `aplicar` |
| 23 | Créditos y correcciones | Implementado y probado | `backend/logica/finanzasCobranza.js` | «I04.4 · desaplicar: motivo y versión; la factura recupera saldo y el cobro vuelve a estar disponible» | — |
| 24 | Pagadores y cobros por terceros | Implementado y probado | `backend/logica/finanzasCobranza.js` | «I04.4 · terceros: pagador, beneficiario, emisor y vigencia a la vista; fuera de vigencia o anulada, no» | i04-tercero.png |
| 25 | Gastos compartidos | Implementado y probado | `backend/logica/finanzasPlanificacion.js` | «T20 · gasto compartido: un pago en el banco, partes por empresa sin crear pesos; el grupo lo cuenta una vez» | i10-gastos.png |
| 26 | Traspasos y préstamos | Implementado y probado | `backend/logica/finanzasPlanificacion.js` | «I10.2 · préstamo sin desembolso: planificado, no deuda reconocida ni «ficticio»; con evidencia se reconoce; una devolución no supera lo desembolsado» | i10-prestamos.png |
| 27 | Proyectos y dimensiones | Implementado y probado | `backend/logica/finanzasPlanificacion.js` | «T22 · proyecto: 0 % se queda en 0 %; cambiar el porcentaje cierra la vigencia anterior; real ≠ previsto» | i10-proyectos.png |
| 28 | Presupuesto | Implementado y probado | `backend/logica/finanzasPresupuesto.js` | «I10.1 · presupuesto heredado: se compara por compatibilidad, sin aprobador ni fecha inventados, y queda en la historia como HEREDADO» | i10-presupuesto.png |
| 29 | Provisiones sin caja | Implementado y probado | `backend/logica/finanzasPlanificacion.js` | «T21 · una provisión no cambia el banco ni se vuelve un pago realizado» | i10-provisiones.png |
| 30 | Obligaciones y proyección | Implementado y probado | `backend/logica/finanzasPlanificacion.js` | «I03.5 · proyección: parte de la disponibilidad, cubre el resto del mes del corte, reemplaza estimación por compromiso y no dice «alcanza» si es parcial» | i10-proyeccion.png |
| 31 | Navegación por tareas | Implementado y probado | `frontend/js/finanzas-v2.js` | «I08.6 · pendientes desde su origen, sin copias, con orden explicable y visibles para quien consulta» | i08-*.png, manual `mapa` |
| 32 | Sistema visual | Implementado y probado (sin auditoría formal de accesibilidad) | `frontend/css/v2/finanzas-v2.css` | — (medición en el navegador, I08) | i08-oscuro-*.png, i08-390-*.png |
| 33 | Estados y ayudas | Implementado y probado | `frontend/manuales/finanzas.js` | — (manual con 14 capturas y 75 señales, I14) | i14-manual.png |
| 34 | Un contrato común para reportes | Implementado y probado | `backend/logica/finanzasReportes.js` | «I09.1 · cada métrica trae su ficha: fuentes, exclusiones, fecha, moneda y calidad requerida» | i09-como-se-calculo.png |
| 35 | Comparaciones correctas | Implementado y probado | `backend/logica/finanzasReportes.js` | «I03.4 · mes en curso: se compara el mismo tramo del mes anterior (día con tope) y no se califica con datos provisorios» | — |
| 36 | Lectura automática que explique | Implementado y probado | `backend/logica/finanzasReportes.js` | «I09.4 · comentarios: la falta de datos se dice una vez y primero, con importes del momento; acciones solo con contenido; hasta 4 principales» | i09-lectura.png |
| 37 | Calidad, cobertura y estado | Implementado y probado | `backend/logica/finanzasReportes.js` | «T30 · cobertura incompleta y mes en curso: no se presenta como completo; meses de caja por determinar sin aperturas» | manual `resumen` |
| 38 | Portafolio de reportes | Implementado y probado | `frontend/js/finanzas-informes-v2.js` | «I09.2 · cascada que cuadra con el flujo, cuentas con apertura/entradas/salidas/cierre y empresas que suman el grupo» | i09-portafolio.png |
| 39 | PDF de gerencia | Implementado y probado | `backend/logica/finanzasReportes.js` | «T35/FIN-39 · el PDF se arma en el servidor desde el contrato; con datos cambiados pide recargar» | i14-informe-DEMO.pdf |
| 40 | Excel/CSV | Implementado y probado | `backend/logica/finanzasExportar.js` | «T35 · exportar: CSV con fórmulas neutralizadas y negativos numéricos; XLSX real; misma revisión que la pantalla» | i14-*-DEMO.xlsx/.csv |
| 41 | Revisión, aprobación y cierre reproducible | Implementado y probado (decisión: la política estricta está apagada) | `backend/logica/finanzasCierre.js` | «I11.4/I11.5 · excepción con evidencia y limitación, visible en el informe; quitarla no la borra; cierre, reapertura y nuevo cierre con versiones» | i11-cierre.png, manual `cierre` |
| 42 | Permisos coherentes | Implementado y probado (no implementado: alcance por empresa) | `backend/logica/finanzasBase.js` | «I11.1 · matriz por API: con solo lectura, toda escritura pide capacidad y nada cambia; las lecturas responden» | I11 matriz |
| 43 | Protección y recuperación | Implementado y probado | `backend/logica/finanzasBoveda.js` | «I12.2 · al cerrar la última sesión, el servidor olvida las cifras descifradas» | QA-R22 (I13), `huella-boveda.js` |
| 44 | Rendimiento con crecimiento | Implementado y probado (límite: carga masiva 231 s) | `backend/logica/finanzasCobranza.js` | «I12.2 · el catálogo no se rearma por escrituras ajenas a él; la cartera y el informe memorizados ven lo nuevo» | i12-medicion-*.json |
| 45 | Procedimiento | Implementado y probado | `documentacion/finanzas-v2-correccion/TABLERO.md` | — | — |
| 46 | Evidencia antes de declarar terminado | Implementado y probado | `documentacion/finanzas-v2-correccion/I13-aceptacion.md` | — | evidencia/ |
| 47 | Preparar el paso a producción | Implementado: plan preparado y **no ejecutado** | `documentacion/finanzas-v2-correccion/I14-plan-publicacion.md` | — | — |
| 48 | Entrega técnica y continuidad | Implementado (este paquete) | `documentacion/finanzas-v2-correccion/I14-entrega.md` | — | — |

## Resultado de la comprobación automática

Ejecutado el 2026-10-21: 48 filas · 46 archivos existen · 41 conectados (router o página) · 41 pruebas encontradas con su título exacto · **0 fallas**.

Las pruebas citadas pasan dentro de `npm test` (ver la cifra en I14-entrega.md).
