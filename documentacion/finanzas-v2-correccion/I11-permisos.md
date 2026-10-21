# I11 · Permisos, concurrencia, revisión y cierre — probado, con límites declarados (21-10-2026)

## Errores encontrados y corregidos (con prueba)

1. **Actualizar sin versión podía pisar el trabajo de otra persona.** Las funciones de versión de cuatro módulos
   (registro, fondos, clientes, planificación) y ocho comparaciones más aceptaban que no se enviara la versión.
   Ahora, actualizar un registro existente sin la versión vista responde `VERSION_REQUERIDA` y no cambia nada.
   Esto vale para:
   - operaciones y acciones en lote;
   - fichas, servicios y documentos de clientes;
   - gestiones, aperturas y remanentes;
   - préstamos, gastos, provisiones, compromisos y proyectos;
   - estado de factura;
   - presupuesto (guardar y aprobar);
   - reglas;
   - catálogos y parámetros;
   - reclasificar un movimiento ya confirmado.
2. **Catálogos y parámetros no tenían versión:** el último en guardar pisaba al anterior. Se agregó la columna
   (migración aditiva), el listado la devuelve y la pantalla la envía.
3. **Editar un proyecto de la planilla nunca enviaba la versión**, y el listado ni la devolvía. Corregido.
4. **Bancos (clasificar) y Presupuesto (guardar) no enviaban la versión desde la pantalla.** Corregido.
5. **Un parámetro nuevo nunca llegaba a una base ya existente.** La siembra solo actuaba con el catálogo vacío.
   Afectaba también a `aperturas_dos_personas` de I06, que en producción no aparecería. Ahora los parámetros que
   falten se agregan (`INSERT OR IGNORE`, nunca pisa un valor editado).
6. **«Reglas» se caía** («no such table: FIN_PAGADORES») si todavía no había pagadores. Corregido; lo encontró la
   sonda de permisos.
7. **Enviar a revisión dejaba «vencida» su propia revisión.** El estado del cierre contaba como dato financiero en
   la revisión de datos. Las tablas `FIN_CIERRES` y `FIN_CIERRE_VERSIONES` ya no cuentan (son flujo de trabajo);
   `FIN_AJUSTES` sí, porque guarda las excepciones.

## I11.1 · Capacidades efectivas

**Política vigente (verificada en el código).** Solo entra quien está en la lista fija del servidor
(`SIGSO_FINANZAS_ACCESO`), con su autenticador.
- Por defecto, cada persona de la lista tiene las 15 capacidades.
- Quien está en `SIGSO_FINANZAS_SOLO_LECTURA` solo tiene CONSULTAR y EXPORTAR.
- `SIGSO_FINANZAS_CAPACIDADES` afina por persona, pero no da acceso a nadie fuera de la lista ni escritura a quien
  es de solo lectura.

Es intencional: lo describen el código y el documento de FIN-48. No se amplió nada.

**Alcance.** Todas las personas autorizadas ven el grupo completo. No hay alcance por empresa ni por cuenta. Se
documenta así; implementarlo sería una decisión nueva del dueño. CONSULTAR no se exige en las lecturas, porque
estar en la lista ya implica ver.

**Matriz probada por API** (`finanzas-v2-permisos-i11.test.js`). Se llaman las **123 acciones** de Finanzas del
router, sin contar las 5 de acceso, con una cuenta de solo lectura:
- 52 lecturas responden;
- las 71 escrituras devuelven «permiso»;
- **ninguna cambia la base** (se mide con la revisión de datos).

Si mañana se agrega una escritura sin capacidad, la prueba falla. También se prueba una cuenta fina
(CONSULTAR|REGISTRAR): no puede cerrar, aplicar, configurar, editar reglas, aprobar presupuesto ni exportar.

No se encontró ningún camino antiguo que eludiera el control: las 14 acciones con la capacidad dentro del cuerpo
(`conBoveda` + `exigir_`) también devuelven «permiso». No se asignaron ni revocaron roles reales.

**Escrituras y la capacidad que exigen** (generado del código):

| Acción (finanzas…) | Capacidad | Módulo |
|---|---|---|
| DecidirApertura | APERTURA (aprobar) / FONDOS (anular) | Fondos |
| AceptarSugeridasCobro, AnularRelacionCobro, Aplicar, Desaplicar, EditarFactura, EstadoFactura, GuardarRelacionCobro | APLICAR | Cobranza |
| CerrarMes, ExcepcionCierre, ObservarCierre, Paralelo, PasoRetiro, ReabrirMes | CIERRE | Cierre |
| GuardarAsignacion, GuardarDocumento, GuardarFicha, GuardarServicio, SubirAdjunto | CLIENTES | Clientes |
| Conciliar, Desconciliar, ExplicarRemanente, MarcarDistintas | CONCILIAR | Conciliación |
| GuardarCatalogo | CONFIGURAR | Catálogos |
| Clasificar, ConfirmarSugeridas | CONFIRMAR | Bancos |
| EnviarRevision, ResolverObservacion | CONFIRMAR | Cierre |
| AnularReasignacion, AsignarGestion, ConvertirRemanente, CorregirApertura, DecidirRemanente, EstadoGestion, GestionDesdePieza, GuardarApertura, GuardarGestion, ProponerAperturas, Reasignar, RevisarAperturas | FONDOS | Fondos |
| GestionDeCandidata | FONDOS | Cargas |
| CargarLibro, CorregirFilaCarga, PublicarHoja | MIGRAR | Cargas |
| GuardarCompromiso, GuardarGastoCompartido, GuardarPrestamo, GuardarProvision, GuardarProyecto, VincularGasto, VincularPrestamo | PLANIFICAR | Planificación |
| AprobarPresupuesto, GuardarPresupuesto | PRESUPUESTO | Presupuesto |
| AprenderPlanilla, ImportarCartola | REGISTRAR | Bancos |
| AprenderExcelBancos, ImportarDetalle | REGISTRAR | Pagadores |
| DuplicarOperacion, GenerarPlantillas, GuardarOperacion, GuardarPerfil, RevisarPegado | REGISTRAR | Operaciones |
| ImportarFacturasPlanilla, ImportarVentas | REGISTRAR | Cobranza |
| AccionOperaciones, PublicarPegado | REGISTRAR + CONFIRMAR (confirmar o anular) | Operaciones |
| CrearRegla, GuardarAliasRegla, GuardarPagador, GuardarRegla | REGLAS | Reglas |
| GuardarNombres | REGLAS | Pagadores |

Las 52 lecturas (resumen, listados, detalles, vistas previas, informe, PDF y exportación) exigen estar en la
lista de la bóveda. El PDF y la exportación exigen además EXPORTAR, que solo lectura tiene.

## I11.2 · Concurrencia e idempotencia

**Actualizaciones que reemplazan datos:** versión obligatoria. Sin ella, `VERSION_REQUERIDA`; con una vieja,
`CONFLICTO_VERSION`; en ambos casos, nada cambia. Esto se reprodujo por prueba (antes se aceptaba).

**Operaciones que AGREGAN** (conciliar, aplicar). No reemplazan nada. Las protege un mecanismo equivalente
comprobable: los importes disponibles (saldo de la factura, disponible del cobro, del movimiento y de la
operación) se verifican en la misma transacción, así que no se puede sobregirar ni aplicar dos veces. La versión,
si viene, se compara. «Aceptar sugeridas» además exige el resumen (`digest`) de lo que se vio.

**Primera clasificación de un movimiento pendiente:** la protege su estado. Si otra persona lo confirmó entretanto,
ya no está pendiente y se exige la versión.

**Lotes:** cada operación es su grupo, y la respuesta dice cuáles se hicieron y cuáles no (T18).

**Idempotencia:**
- misma clave y mismo contenido devuelve el mismo resultado;
- misma clave con otro contenido devuelve `IDEMPOTENCIA` (prueba);
- las plantillas usan una clave por instancia (I05).

**Caminos internos:** la publicación de la planilla declara la versión que lee dentro de su transacción (fichas)
o se identifica como carga interna (presupuesto).

## I11.3 · Revisión y aprobación

Estados: Abierto (preparación) → En revisión → Devuelto con observaciones → Cerrado (= aprobado por quien tiene
CIERRE). Que se cierre con excepciones se muestra aparte.
- Resolver una observación no la borra.
- Reabrir pide motivo y conserva las versiones anteriores.

**Capacidades:**
- CONFIRMAR: preparar, enviar a revisión y resolver observaciones.
- CIERRE: observar, aceptar excepciones, cerrar y reabrir.

No hay nombres de personas en el código.

**Política configurable** (Configuración › Catálogos › Parámetros, visible en Revisión del período):

| Parámetro | Valor | Efecto |
|---|---|---|
| `cierre_exige_revision` | 1 | solo se cierra un mes enviado a revisión y sin cambios de datos desde entonces |
| `cierre_dos_personas` | 1 | quien lo envió a revisión no puede cerrarlo |

Por defecto ambos valen 0, como hasta hoy. Verificado en la demo, cambiándolos desde la pantalla y volviendo
a 0.

Antes de habilitar el cierre se comprueba:
- cobertura de cartolas;
- cuadre;
- todo revisado;
- saldos iniciales;
- posibles duplicados (identidades);
- avisos de operaciones sin banco y ventas;
- observaciones abiertas;
- la política anterior.

## I11.4 · Excepciones

Solo dos tipos: una **cuenta fuera de alcance** o **saldos iniciales pendientes**. Cualquier otro tipo se rechaza.
No se exceptúan invariantes: sobregirar, duplicar un hecho, romper una suma o una identidad ambigua.

Cada excepción guarda:
- tipo y alcance;
- motivo y **evidencia**;
- solicitante y **aprobador**;
- fecha;
- la **limitación que deja**. Por ejemplo: «la disponibilidad propia sigue no determinable; la excepción solo
  permite cerrar».

Se ve en:
- Revisión del período;
- el informe (contrato `excepciones`);
- el PDF («Excepciones aceptadas»).

**Quitar una excepción no la borra:** queda en la historia, con quién y por qué. Se probó que aceptar la falta de
saldos iniciales **no** vuelve determinable la disponibilidad propia.

## I11.5 · Snapshot y reapertura

Cada versión del cierre guarda:
- el informe del grupo y de cada empresa;
- catálogos y parámetros;
- versión de reglas y revisión de datos;
- además, la **aprobación**: quién preparó y cuándo (revisión), las observaciones, las excepciones tal como
  estaban, la política, quién cerró y si la revisión estaba vencida.

**Probado:** cerrar → reabrir con motivo → cerrar de nuevo. Quedan v1 y v2, y la v1 conserva sus excepciones.

**Política de cambios** (documentada):
- Un alias o nombre corto es descriptivo y no cambia cifras ni versiones cerradas.
- Una reclasificación económica en un mes cerrado exige reabrirlo con motivo.
- Volver a cerrar crea una versión nueva y no reemplaza la anterior.

## Pruebas

**Nueva:** `backend/test/finanzas-v2-permisos-i11.test.js`, con 5 casos:
- matriz por API de 123 acciones;
- capacidades finas;
- versión obligatoria e idempotencia;
- política de cierre;
- excepciones y ciclo cierre–reapertura–cierre.

Las salidas tempranas de esas pruebas se quitaron: el ciclo de cierre se ejecuta de verdad.

**Ajustadas para enviar la versión que una pantalla tendría a la vista**, con el ayudante `versionDe`:
- 12 pruebas anteriores;
- `T40`, solo en la vista previa de una regla, que no exige versión porque no guarda nada.

`npm test` → **1864/1864**.

## Evidencia

| Archivo | Muestra |
|---|---|
| `evidencia/i11-cierre.png` | la política de cierre visible |
| `evidencia/i11-parametros.png` | los dos parámetros nuevos en Configuración, editados con versión |

En la demo, editar una operación sin versión responde `VERSION_REQUERIDA`.

## Límites conocidos

- **Alcance por empresa o cuenta:** no existe; todos los autorizados ven el grupo. Es una decisión del dueño.
- **Solicitante y aprobador de una excepción:** son la misma persona, porque quien la registra tiene CIERRE. No hay
  un flujo de dos pasos.
- **La política de cierre exigente no está activada** en la demo ni por defecto. Activarla es decisión del dueño.
- **Producción:** los parámetros nuevos y la columna de versión de catálogos se crean solos al primer uso (aditivo);
  no se tocó.
