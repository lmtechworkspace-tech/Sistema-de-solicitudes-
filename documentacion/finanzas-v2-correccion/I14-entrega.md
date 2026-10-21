# I14 · Entrega de la versión candidata de Finanzas v2 (sin publicar) — 21-10-2026

## En una frase

**La corrección local está terminada, con límites declarados.** La versión candidata pasa sus pruebas sobre una copia
limpia de `main` y el plan de publicación está listo para revisión.

**Lo que NO se hizo:** commit, push, despliegue ni nada en producción.

**No está «lista para producción»** mientras sigan pendientes:
- la sesión con las operadoras (T44);
- las decisiones de §6.

## 1. Estado por categoría

| Estado | Qué incluye |
|---|---|
| **Implementado y probado** | Identidad y doble conteo (I01). Conciliación, fechas y correcciones (I02). Disponibilidad, calidad, comparación y proyección (I03). Cobranza completa (I04). Registro y reutilización (I05). Fondos, aperturas y remanentes (I06). Cargas, migración y reglas (I07), con fuentes reales. Navegación y sistema visual (I08). Informes, PDF y exportaciones (I09). Planificación (I10). Permisos, concurrencia, revisión y cierre (I11). Rendimiento y recuperación (I12). Aceptación QA-R y T (I13). Guía para operadoras dentro de SIGSO (I14). |
| **Implementado, pendiente de fuente o entorno** | Lector de cartola **Santander**: falta una cartola real; hoy sus movimientos entran como borradores desde el Excel BANCOS. **Volumen grande en pantalla** (QA-R24): medido en el servidor, no con miles de filas en el navegador. **Migración real a producción:** ensayada con las fuentes reales en una bóveda temporal, no sobre la copia de producción. |
| **Decisión de negocio pendiente** | **Alcance por empresa** (QA-R19, T26). **Política de cierre estricta**: dos personas y revisión obligatoria, hoy apagadas. **Quién aprueba** los saldos iniciales y las excepciones. |
| **No implementado** | Alcance por empresa o cuenta. Depende de la decisión anterior. |
| **Validación humana pendiente** | Sesión con operadoras (T44): guion y base listos. |

## 2. Entregables (I14.1)

| N.º | Entregable | Dónde |
|---|---|---|
| 1 | Cambios locales y revisables, separados de los ajenos | Árbol de trabajo. Paquete de Finanzas solamente, armado con índice temporal y probado sobre `af41a43` limpio: **1870/1870** ([plan §9](I14-plan-publicacion.md)). Árbol local completo: **1872/1872**. |
| 2 | Migraciones aditivas y reejecutables | [Plan §3](I14-plan-publicacion.md): 20 tablas, columnas e índices nuevos, y triggers de revisión. Sin `DROP` ni borrado de datos reales. |
| 3 | Resumen de decisiones de datos | §3 de este documento. |
| 4 | Matriz FIN-01–48 verificada contra el código | [I14-matriz-FIN.md](I14-matriz-FIN.md): 48 filas, 0 fallas en la comprobación automática. |
| 5 | Matrices QA-R01–R26 y T01–T45 | [I13-aceptacion.md](I13-aceptacion.md). |
| 6 | Capturas y recorridos | `evidencia/` (115 archivos, de i01 a i14), por paquete en cada `Ixx-*.md`. |
| 7 | PDF y exportaciones de prueba, generados por la app con datos ficticios | `evidencia/i14-informe-DEMO.pdf` y `i14-*-DEMO.xlsx/.csv` (informe, operaciones, movimientos, cartera y fondos). Ver §4. |
| 8 | Guía para operadoras dentro de SIGSO | `frontend/manuales/finanzas.js`: 13 capítulos, 14 capturas nuevas y 75 señales. Comprobada en el navegador (`evidencia/i14-manual.png`). |
| 9 | Informe de migración local y rendimiento | §5 de este documento. |
| 10 | Decisiones y bloqueos, con su responsable | §6 de este documento. |
| 11 | Plan de paso a producción y reversión, sin ejecutar | [I14-plan-publicacion.md](I14-plan-publicacion.md). |

## Cambios hechos en I14

**Guía para operadoras.** El manual describía la navegación anterior (pestañas). Se **reescribió** según lo que
pide I14.1 n.º 8:

- cómo registrar, reutilizar, pegar, subir el banco, conciliar, aplicar, asignar fondos, resolver pendientes y
  errores, leer el informe y cerrar;
- las capturas salen de la empresa de demostración y sus señales se calcularon desde la pantalla real.

**Pegado.** Hasta ahora la revisión decía «corrígelas en Excel». Ahora **la celda con error se corrige dentro de
SIGSO** y la revisión se renueva sola: verificado en el navegador, de «1 de 2 listas» a «2 de 2». Así se cumple
QA-R15 en la pantalla y no solo en el servidor.

**Registro.** Lo que le falta a un borrador se resume en 2 líneas. El texto completo queda en el título y en el
panel. Antes ocupaba 5 líneas por fila.

**Herramientas en el repositorio** (`backend/herramientas/finanzas-demo/`):
- arman las bases de demostración y de piloto, el ensayo del piloto, el servidor local, el código TOTP, la huella de
  la bóveda y la aceptación con fuentes reales;
- una protección común (`guardia.js`) se niega a trabajar si:
  - `NODE_ENV=production`;
  - la ruta es de servidor o está dentro del repositorio;
  - la carpeta no se llama «demo», «piloto» o «ensayo»;
  - la base tiene más de 5 cuentas.
- Las 4 negativas se probaron.
- No hay claves de demostración fijas: se generan al azar en cada base.
- El despliegue no sincroniza esta carpeta al servidor.

**`.gitignore`** ahora excluye:
- `documentacion/finanzas-documento/datos-iniciales/`, con las cartolas, BANCOS y SIGECO **reales**;
- el `.zip` CONFIDENCIAL;
- las salidas `.json` de las herramientas.

**Incidente detectado y corregido:**
- **Qué pasó:** una corrida intermedia de la herramienta de fuentes reales dejó un `.json` con montos reales
  **dentro de la carpeta de herramientas** del repositorio.
- **Corrección:** se borró, la herramienta ya no escribe archivos (solo imprime totales) y la carpeta ignora `*.json`.
- **Alcance:** nunca llegó al índice real ni a un commit.

## 3. Decisiones de datos (resumen)

| Tema | Regla vigente | Dónde se detalla |
|---|---|---|
| Identidad económica | Un pago cuenta **una vez**. Si una operación confirmada sin banco coincide con un movimiento ya clasificado (empresa, sentido, monto exacto, ±10 días), es un **posible duplicado**: cuenta el banco y la operación queda aparte hasta que una persona decida. | I01 |
| Ambigüedad | Mientras no se decida, el total no se certifica (calidad PROVISORIA) y el monto en duda se muestra al lado. «Son distintas» queda en la historia y no se revierte al reimportar. | I01 |
| Corte y fechas | Manda la fecha efectiva del registro. El banco posterior no cambia el mes. Un mes cerrado no se altera en silencio. | I02 (QA-R06) |
| Estados | **Borrador** (no cuenta) → **confirmada** (cuenta) → **conciliada** (unida al banco). Una confirmada se anula con motivo; un borrador nunca confirmado se descarta. | I05 |
| Aplicaciones | Un cobro no paga una factura hasta que una persona lo aplica. El FIFO es solo una sugerencia. Desaplicar exige motivo y versión. Un tercero paga solo con una relación vigente y autorizada. | I04 |
| Calidad | Por métrica: cobertura de cartolas, pendientes, saldos iniciales y mes en curso. Con datos provisorios, las comparaciones no se califican. | I03, I09 |
| Disponibilidad propia | Saldo del banco menos los fondos de clientes, **solo** si todos los clientes tienen saldo inicial aprobado. Si no, «No determinable». El déficit de un cliente no libera la plata de otro. | I03, I06 |
| Fondos de clientes | Por gestión (obligación y período), con destinos. La diferencia se conserva (ELOHIM −$1). El remanente se decide por escrito. | I06, I13 |

## 4. Equivalencia de las salidas (datos ficticios)

**Informe de octubre** (base DEMO; contrato v2; revisión `f2da1c54-16`; calidad PROVISORIA):

- **Sin cambios en los datos:** el PDF se generó (170 KB).
- **Con una revisión vieja:** pedir el PDF devuelve `CONFLICTO_VERSION`; no se genera un PDF de otros datos.
- **CSV del informe:**
  - trae la misma revisión;
  - trae las mismas cifras de la pantalla: cobros $976.000, pagos $525.000, saldo bancario $3.084.000;
  - las tres se encontraron en el archivo.

**Exportaciones:**

| Archivo | Filas |
|---|---|
| informe (xlsx y csv) | 26 |
| operaciones | 6 |
| movimientos | 5 |
| cartera | 5 |
| fondos | 2 |

## 5. Migración local y rendimiento

**Migración con fuentes reales** (I13; bóveda temporal; solo totales):

| Caso | Resultado |
|---|---|
| 3 cartolas BCI de julio | 246 movimientos; apertura, abonos, cargos y cierre **exactos**. Reimportar da 0 nuevas. |
| Detalle «Mis Movimientos» | Empareja 217 de 218 sin crear movimientos. |
| Excel BANCOS de julio y agosto | Hojas ocultas incluidas, Santander repetido reconocido, 24 operaciones antes y después de repetir. Las filas de plantilla se cuentan y no se cargan (1.452 en BCI). |
| SIGECO | 18 hojas, todas con destino. Volver a publicar no duplica. |
| ARMA HIERRO, VYE, ELOHIM | De la planilla a la gestión: $101.739, $0 y −$1, con **diferencia 0**. |

En I13 se hallaron 5 errores con estas fuentes y se corrigieron.

**Rendimiento** (I12; volumen ×10, 14.400 movimientos):

| Operación | Antes | Después |
|---|---|---|
| Informe | 11,8 s | 0,62 s |
| Cobranza | 10 s | 0,01 s |
| Pendientes | 11,8 s | 0,22 s |
| Exportar | 10,6 s | 0,08 s |

**Límite:** la carga masiva sigue tardando 231 s. Es puntual y se puede hacer por lotes.

## 6. Decisiones y bloqueos (con responsable)

| # | Qué falta | Tipo | Responsable | Qué afecta |
|---|---|---|---|---|
| 1 | Sesión de piloto con las operadoras (T44): 6 tareas, guion y base listos | Validación humana | Dueño: agenda la sesión | Aceptación por operadoras y medición de ahorro |
| 2 | ¿Restringir Finanzas por empresa o por cuenta? | Decisión de negocio | Dueño y gerencia | QA-R19 y T26. Hoy toda persona con acceso ve el grupo |
| 3 | Política de cierre: ¿revisión de otra persona y dos personas para cerrar? | Decisión de negocio | Gerencia | Hoy cierra una sola persona (queda registrado) |
| 4 | Quién aprueba saldos iniciales y excepciones (capacidades por persona) | Decisión y configuración | Dueño: define `SIGSO_FINANZAS_CAPACIDADES` | Sin eso, todas las personas de la lista pueden aprobar |
| 5 | Cartola Santander real en Excel | Fuente | Finanzas: la descarga del banco | Lector Santander y conciliación de esas cuentas |
| 6 | Ensayo de migración sobre una **copia de producción** antes de cargar SIGECO y BANCOS reales | Entorno | Dueño: autoriza la copia en el VPS | Activar el reemplazo de las planillas |
| 7 | Medir el navegador con volumen grande (QA-R24) | Prueba técnica | Técnico, en un paso siguiente | Riesgo de lentitud en pantalla, no medido |
| 8 | Decidir y autorizar commit y publicación | Decisión | Dueño | Todo lo anterior queda local hasta entonces |

## 7. Archivos del paquete de Finanzas

**`backend/logica/`:**
- nuevos: `finanzasBase`, `Hechos`, `Catalogos`, `Operaciones`, `Conciliacion`, `Fondos`, `Clientes`,
  `Planificacion`, `Cargas`, `Reglas`, `Reportes`, `Exportar` y `Pendientes`;
- modificados: `finanzasAvisos`, `Bancos`, `Boveda`, `Cierre`, `Cobranza`, `Pagadores`, `Presupuesto` y `Tablero`.

**`backend/server/router.js`:** solo las líneas de Finanzas.

**`backend/test/`:**
- `_finanzasPrueba.js`;
- 16 archivos `finanzas-v2-*`;
- 4 pruebas de Finanzas actualizadas.

**`backend/herramientas/finanzas-demo/`:** 9 archivos.

**Frontend:**
- vistas `frontend/js/finanzas-*-v2.js`; se retira `finanzas-tablero-v2.js`;
- `finanzas-v2.js`, `lector-xlsx.js` (fórmulas como evidencia), `plataforma.js`, `barra-lateral.js` y
  `control-interno-v2.js` (enlace para pagar una obligación);
- `frontend/css/v2/finanzas-v2.css` y `barra-v2.css`;
- `frontend/plataforma.html`.

**Manual:** `frontend/manuales/finanzas.js`, `indice.js` e `img/finanzas/*`.

**Otros:** `.gitignore` y `documentacion/finanzas-v2-correccion/`.
