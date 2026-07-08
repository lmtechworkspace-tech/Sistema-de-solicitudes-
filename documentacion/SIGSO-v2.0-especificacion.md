# SIGSO v2.0 — Especificación funcional para desarrollo

**Documento:** ESP-SIGSO-2.0
**Estado:** Borrador para revisión del equipo
**Fuente:** Reunión de revisión de estado (audio "Hernan 3.m4a") + estado real del sistema construido (v1.x, Fases 0–10.2)
**Autores (roles simulados):** Product Owner Senior · Business Analyst Senior · Software Architect · UX Designer · Especialista en Sistemas de Gestión de Solicitudes

> **Nota de método.** La reunión fue una conversación informal, con mucho ruido y digresiones. Este documento **no transcribe**: interpreta, consolida y traduce las ideas de negocio a especificaciones accionables. Donde la reunión fue ambigua, se marca **[Supuesto]** y se propone una decisión por defecto que el equipo puede confirmar o corregir. Donde el sistema **ya resolvió** algo, se indica para no re-implementar.

---

## 1. Resumen ejecutivo

SIGSO nació para reemplazar el caos de recibir solicitudes por correo y WhatsApp (donde "Leo" recibe un Word con links, credenciales y capturas) por un flujo estandarizado con trazabilidad, sobre una arquitectura de **costo cero** (GitHub Pages + Google Apps Script + Sheets + Drive). La v1.x ya cubre el ciclo completo: ingreso multi-empresa, subsolicitudes, prioridad por impacto, estados, adjuntos, notificaciones, dashboard, administración de catálogos y el ida-y-vuelta de "pedir información".

La reunión confirmó que **la base es correcta**, pero expuso una tensión estructural que define la v2.0:

> **El sistema optimiza para trazabilidad; el negocio necesita velocidad para las urgencias.**

El gerente lo dijo sin rodeos: *"no intentes controlar mucho si no vas a controlar nada"*, *"el proceso es lento por tener que llenar tanto formulario"*, *"necesito que mis urgencias se atiendan antes que un desarrollo"*. Al mismo tiempo, la organización sí quiere la evidencia. La v2.0 **no elige un lado**: introduce un formulario de dos velocidades, priorización con validación real, y — el cambio más importante de gobierno del proceso — **devuelve el cierre al solicitante**, no al desarrollador.

Las 5 decisiones de mayor impacto para la v2.0:

1. **Formulario de dos velocidades** — un "ingreso rápido" de 20 segundos para urgencias y el formulario completo para desarrollos planificados. (Resuelve la queja central.)
2. **Cierre y validación por el solicitante** — Leo entrega ("en pruebas"); **quien pidió valida y cierra**. *Contradice lo que se implementó en la Fase 10.2 y debe revertirse parcialmente.*
3. **Priorización real** — validación de prioridad (frenar el "todo es urgente"), urgencia derivada del tipo, y **cola visible** ("¿cuántas hay antes que yo?").
4. **Vista de Gerencia con detalle** — no solo KPIs: qué se pidió, qué errores surgieron, y **alertas de patrones** (mismo problema recurrente = bug de código, no caso aislado).
5. **Preparar la salida del "costo cero"** — Google Sheets como base de datos es la decisión que más limita el crecimiento (ya causó la lentitud del cambio de estado). Mantener la capa de repositorio desacoplada para poder migrar sin reescribir la lógica.

El resto del documento desarrolla cada propuesta, los requerimientos, el flujo optimizado, la priorización y el roadmap.

---

## 2. Glosario y actores

| Término | Significado |
|---|---|
| **Solicitante** | Personal interno (Juan, Camila Peña, Lizeth Vilchez, Hernán) que ingresa solicitudes. |
| **Leo** (`lestay@rld.cl`) | Único desarrollador/gestor. Resuelve todo el ciclo. Rol "hace todo". |
| **Gerencia** | Hernán (jefe de área), Felipe, Don Rogelio. Necesitan visibilidad de KPIs **y** detalle. |
| **Empresa** | HomePymes (HP), RLD, GDE. Multi-empresa desde el diseño. |
| **Plataforma / Módulo** | Sistemas de cada empresa (Gestión Integral de RLD, Intranet GDE, etc.), parametrizables. |
| **Solicitud de cliente** | La origina un cliente externo de RLD (obra, mandante). Alta prioridad por defecto. |
| **Solicitud interna** | Mejora/desarrollo pedido por personal propio. |
| **Intranet "azulito"** | Sistema legado que SIGSO debe absorber y retirar. |
| **Hoja de ruta / firma digital / estado de pago** | Trámites de obra cuya detención cuesta dinero → urgencias reales. |

**Roles del sistema (v2.0):** `SOLICITANTE`, `GESTOR` (Leo), `GERENCIA`, `ADMIN`.
*(v1.x usa ANA/DEV/ADM; ver §12.1 — se propone renombrar a un modelo que refleje la operación real.)*

---

## 3. Análisis de propuestas

Se consolidaron las ideas dispersas de la reunión en **12 propuestas**. Cada una sigue la estructura solicitada. Las propuestas están unificadas cuando varias frases apuntaban a lo mismo, y se marca su relación con lo ya construido.

### P1 — Formulario de dos velocidades (ingreso rápido vs. completo)

- **Problema actual:** el formulario público pide mucha información (empresa, plataforma, cascada de módulo de hasta 4 niveles, tipo, impacto, frecuencia, personas afectadas, URLs, credenciales, evidencia con descripción, observaciones). Para una urgencia, es demasiado.
- **Situación observada:** *"el proceso es lento… tener que llenar tanto el formulario"*; *"en vez de que completen este formulario largo, sería como algo más corto que llegue más directo a Leo"*; *"es más rápido estarle hablando que completándole el formulario"*. El gerente advierte que Leo, en la práctica, **no lo va a usar** si es lento — *"hemos tenido un montón de tickets y ninguno le hace caso"*.
- **Riesgos del proceso actual:** adopción nula. Si el formulario es más lento que un WhatsApp, la gente vuelve al WhatsApp y SIGSO se convierte en un repositorio vacío. Se pierde toda la trazabilidad que justifica el proyecto.
- **Objetivo de la mejora:** que ingresar una urgencia tome **≤ 20 segundos** sin sacrificar la trazabilidad de los desarrollos planificados.
- **Propuesta de solución:** un solo formulario con **dos modos**:
  - **Rápido (urgencia):** empresa, plataforma/módulo, título, "¿qué pasa?", y adjuntar captura. 4–5 campos. El resto (credenciales, frecuencia, personas afectadas, centro de costos) queda **opcional y colapsado**; Leo puede pedirlo después con "necesito más información" (P5, ya existe).
  - **Completo (desarrollo/mejora planificada):** el formulario actual íntegro, para dejar la "hoja de ruta" completa.
  - El modo se sugiere automáticamente por el **tipo** elegido (Error/Migración/Cliente → rápido; Desarrollo/Nuevo módulo → completo), pero el usuario puede cambiarlo.
- **Impacto esperado:** adopción real. Es la diferencia entre que el sistema se use o no.
- **Cambios en la interfaz:** toggle "Rápido / Completo" en el paso 1; en modo rápido, ocultar por defecto los campos avanzados con un "＋ Agregar más detalle". Botón de envío accesible sin scrollear.
- **Cambios en la base de datos:** ninguno. Los campos ya son opcionales en el esquema (`SUBSOLICITUDES`). Solo cambia qué se muestra.
- **Cambios en el flujo:** ninguno estructural. Una urgencia entra con menos datos y se enriquece vía P5.
- **Prioridad:** **Alta (Must).** Es el pedido central de la reunión.
- **Dependencias:** P5 (pedir información) para poder completar después lo que se omitió.
- **Posibles riesgos:** que en modo rápido falte info crítica y Leo tenga que preguntar siempre → mitigar con buenos defaults y validación mínima (empresa/módulo/título/qué-pasa obligatorios).
- **Recomendaciones:** medir con datos reales qué campos se llenan y cuáles no antes de agregar más. El propio gerente lo dijo: *"primero hay que usarlo… y después ir puliéndolo"*.

### P2 — Priorización real: validación, urgencia por tipo y cola visible

- **Problema actual:** la prioridad se deriva del "impacto" que elige el solicitante. Pero *"todos van a poner alta porque todo es urgente"*. No hay un filtro que distinga urgencia real de percibida.
- **Situación observada:** *"falta ahí un corte de ver si en verdad es alta o media… muy pocas te van a poner baja porque todo es urgente"*. Leo puede bajar la prioridad (*"le pone P4, no es tan importante, justifica"*). El solicitante quiere saber *"cuántas hay antes que yo"* — su posición en la cola, no el detalle de las demás.
- **Riesgos del proceso actual:** inflación de prioridad → todo es P1 → nada es P1. Leo termina re-priorizando todo a mano. El solicitante no tiene expectativa realista de cuándo lo atienden.
- **Objetivo de la mejora:** una prioridad **confiable** (que refleje impacto real de negocio) y **transparente** (el solicitante sabe dónde está en la fila).
- **Propuesta de solución (tres piezas que se complementan):**
  1. **Urgencia por tipo, no por auto-declaración:** ciertos tipos son urgentes por naturaleza porque **detienen dinero** — hoja de ruta, cambio de fecha, reportabilidad, firma digital, problemas de porcentajes, y **toda solicitud de cliente**. Estos se marcan visualmente ("en rojo" en el menú, como pidió el gerente) y entran con prioridad alta. Las mejoras "de nueva idea" entran como planificadas (baja) por defecto.
  2. **Validación por el gestor:** Leo (o Gerencia) confirma o ajusta la prioridad con justificación (ya existe en v1.x: `actualizarPrioridad` con justificación ≥ 20 caracteres e `HISTORIAL_PRIORIDAD`). Se conserva.
  3. **Cola visible:** en "Consultar Estado", el solicitante ve *"hay N solicitudes de prioridad ≥ a la tuya por delante"*. No ve el contenido de las otras (privacidad, ya es un requisito: *"no me interesa que vean lo que pido yo"*).
- **Impacto esperado:** menos ruido de prioridad, expectativas realistas, Leo trabaja una cola confiable.
- **Cambios en la interfaz:**
  - Formulario: los tipos urgentes marcados en rojo/etiqueta "Urgente".
  - Consultar Estado: línea "posición en cola" por solicitud.
  - Detalle (Leo/Gerencia): la re-priorización ya existe.
- **Cambios en la base de datos:**
  - `CAT_TIPOS`: agregar columna `es_urgente` (booleano) — aditiva. Reemplaza/complementa a `prioridad_default`.
  - No se necesita tabla nueva para la cola: se calcula al vuelo contando abiertas de prioridad ≥ X (ordenadas por prioridad + antigüedad).
- **Cambios en el flujo:** la prioridad inicial pasa a derivarse de `es_urgente` del tipo (+ impacto como afinamiento), no solo del impacto declarado.
- **Prioridad:** **Alta (Must)** para "urgencia por tipo"; **Media (Should)** para "cola visible".
- **Dependencias:** catálogo de tipos parametrizado (ya existe, se extiende).
- **Posibles riesgos:** la posición en cola puede fluctuar (entra alguien más urgente y te retrasa). Comunicarlo como estimación, no promesa.
- **Recomendaciones:** el "orden de atención" (`orden_atencion`, ya existe para desempatar P1) es el mecanismo fino para que Leo/Gerencia decidan entre urgencias iguales. Exponerlo en la cola.

### P3 — Cierre y validación por el solicitante (⚠️ contradice lo implementado)

- **Problema actual:** hoy Leo puede llevar una solicitud directo a "Cerrada". En la práctica histórica (tickets), *"Leo lo dejaba cerrado… decía 'ya está listo' pero no esperaba que lo comprobáramos"*. Se cerraban cosas que no estaban validadas.
- **Situación observada:** regla explícita y repetida: *"el que la pide lo tiene que verificar que esté correcto"*; *"muchas veces Leo lo hace desde base de datos y dice 'revisa'… siempre el que pide tiene que revisar"*. Se propone quitarle a Leo el permiso de cerrar: *"a Leo solamente dejarle 'esperando información' o 'en pruebas'… luego la otra persona vea en consultar estado que está en pruebas, revise, y esa persona cierre la solicitud"*.
- **Riesgos del proceso actual:** cierres falsos, retrabajo, pérdida de confianza. Es exactamente el problema que motivó SIGSO.
- **Objetivo de la mejora:** que "Cerrada" signifique **validado por quien lo pidió**, no "Leo cree que terminó".
- **Propuesta de solución:** dividir el fin del ciclo en dos responsabilidades:
  - **Leo** puede llevar hasta **"En pruebas" / "Terminada"** (entregado, pendiente de validación). No puede fijar "Cerrada".
  - El **solicitante**, desde "Consultar Estado", ve "listo para tu validación" y tiene dos botones: **"Confirmar y cerrar"** o **"No quedó resuelto"** (reabre → vuelve a Leo con comentario obligatorio).
  - **Excepción:** las **consultas técnicas** (RF-F08) sí las puede cerrar Leo directo (no hay nada que el solicitante deba probar). Fallback: si el solicitante no responde en N días hábiles, cierre automático (ya contemplado en el flujo, §9.3 histórico).
- **Impacto esperado:** el cierre recupera su valor. Alinea el sistema con la regla real de negocio.
- **Cambios en la interfaz:**
  - Detalle de Leo: el selector de estado **ya no ofrece "Cerrada"** salvo para consultas técnicas.
  - Consultar Estado: bloque "Validación pendiente" con botones Confirmar / Reabrir.
- **Cambios en la base de datos:** ninguno nuevo. Se necesita un endpoint público `validarCierre` (análogo a `responderConsulta`, ya existe el patrón). El cierre queda en `HISTORIAL_ESTADOS` con `usuario` = correo del solicitante.
- **Cambios en el flujo:** se reintroduce el corte "Terminada → (validación del solicitante) → Cerrada". **Esto revierte parcialmente la Fase 10.2**, donde se abrió el selector a los 11 estados para todos los roles.
- **Prioridad:** **Alta (Must).**
- **Dependencias:** P5 (canal público de respuesta del solicitante, ya construido — se reutiliza su mecánica de verificación por correo).
- **Posibles riesgos:** fricción con la decisión reciente de "Leo hace todo". **Contradicción real — ver §4.** Recomendación: Leo mantiene libertad total *hacia adelante y en retrocesos de trabajo*, pero **el cierre definitivo es del solicitante**. Es un límite, no una restricción de velocidad.
- **Recomendaciones:** conservar el fallback de cierre automático por inactividad para que una solicitud no quede "en pruebas" eternamente si el solicitante no valida.

### P4 — Solicitud de cliente vs. interna (datos, ruteo y prioridad)

- **Problema actual:** las solicitudes de cliente (RLD/Gestión Integral) necesitan datos que las internas no: cliente, mandante, obra, contacto, correo, urgencia reportada. Y son urgentes por defecto.
- **Situación observada:** *"si es una solicitud de cliente… conocer el dato del cliente, del mandante, la obra, el nombre de contacto, correo del cliente… y esto va automáticamente prioritario"*.
- **Riesgos:** tratar una urgencia de cliente (que frena un estado de pago) igual que una mejora interna.
- **Objetivo:** que el origen "cliente" active datos, prioridad y ruteo correctos automáticamente.
- **Propuesta de solución:** **ya implementado en v1.x** (checkbox "¿es solicitud de cliente?", bloque de datos condicional, aviso automático a Leo, RN-005). La v2.0 lo **formaliza y refina**: cliente ⇒ tipo urgente por defecto (enlaza con P2) y ⇒ aviso a Leo siempre (ya está).
- **Impacto esperado:** las urgencias de cliente nunca se pierden en la cola.
- **Cambios en la interfaz:** ninguno mayor (ya existe). Ajuste menor: que al marcar "cliente" se sugiera automáticamente el modo/priorización urgente.
- **Cambios en la base de datos:** ninguno (columnas de cliente ya existen).
- **Cambios en el flujo:** ninguno.
- **Prioridad:** **Ya hecho** — solo pulido (Baja).
- **Dependencias:** P2.
- **Posibles riesgos:** ninguno.
- **Recomendaciones:** validar con RLD si los datos de cliente actuales son suficientes (el gerente lo dejó abierto: *"hay que ver si estos datos son los únicos que necesitan"*).

### P5 — Ciclo "pedir información / responder"

- **Problema actual:** cuando a Leo no le queda clara la solicitud, hoy lo resuelve por WhatsApp, fuera del sistema.
- **Situación observada:** *"si Leo requiere más datos… va a tener un apartadito donde pone 'necesita más datos' y en consultar estado la otra persona lo ve"*.
- **Objetivo:** cerrar el pimponeo dentro del sistema, con trazabilidad.
- **Propuesta de solución:** **ya implementado (Tanda 2 / Fase 10.2):** estado "Esperando información" con comentario obligatorio (= la pregunta), visible en Consultar Estado, con caja de respuesta que queda como comentario público. La v2.0 lo **cierra bien**: notificar por correo al solicitante cuando Leo pide info, y a Leo cuando el solicitante responde (hoy el correo de cambio de estado se encola; la respuesta debería avisar a Leo).
- **Impacto esperado:** menos conversación fuera del sistema, más contexto persistente.
- **Cambios en la interfaz:** ninguno mayor (ya existe).
- **Cambios en la base de datos:** ninguno.
- **Cambios en el flujo:** agregar notificación a Leo al recibir una respuesta del solicitante (hoy no la hay).
- **Prioridad:** **Media (Should)** — completar la notificación faltante.
- **Dependencias:** cola de correo (ya existe).
- **Posibles riesgos:** ninguno.
- **Recomendaciones:** mostrar un badge "respuesta recibida" en el dashboard de Leo para que no dependa solo del correo.

### P6 — Vista de Gerencia con detalle (no solo KPIs)

- **Problema actual:** el sistema asume que a Gerencia solo le interesan KPIs. La reunión muestra que **no**.
- **Situación observada:** *"a gerencia le interesan solo los datos"* (Leo) contra *"yo sí necesito saber qué es lo que se pidió, cuáles son los errores que surgieron, ver más detalles… al igual que Felipe"* (Hernán). Hernán dirige el departamento y su jefe (Felipe) le preguntará *"¿de qué son todos esos tickets que manda Juan?"*.
- **Riesgos:** un gerente ciego a la operación no puede responder por su área ni detectar problemas de fondo.
- **Objetivo:** dar a Gerencia visibilidad de **KPIs + contenido** (qué se pidió, de qué, por quién), en modo lectura.
- **Propuesta de solución:** un **rol `GERENCIA`** con: dashboard completo (KPIs, gráficos, tendencias) **y** acceso de solo-lectura al detalle de cualquier solicitud (descripción, tipo, módulo, solicitante, historial). Sin poder cambiar estados ni prioridades. Filtros por empresa, tipo, solicitante, período.
- **Impacto esperado:** Gerencia autónoma; deja de depender de preguntarle a Leo o a Juan qué pasó.
- **Cambios en la interfaz:** el dashboard y el detalle ya existen; se habilita el detalle en solo-lectura para el rol gerencia y se agrega un filtro "por solicitante".
- **Cambios en la base de datos:** el rol ya es un valor en `USUARIOS.rol`; agregar `GERENCIA` como rol válido. Aditivo.
- **Cambios en el flujo:** ninguno.
- **Prioridad:** **Alta (Must)** — es un requisito explícito y repetido de quien manda.
- **Dependencias:** modelo de roles (§12.1).
- **Posibles riesgos:** confundir "ver todo" con "poder tocar todo". Mantener gerencia estrictamente en lectura.
- **Recomendaciones:** que gerencia pueda **exportar** un listado filtrado (para responderle a Felipe sin entrar al sistema).

### P7 — Detección de patrones / errores recurrentes

- **Problema actual:** el mismo error de fondo se reporta muchas veces por distintos usuarios/empresas, pero como cada quien lo redacta distinto, **nadie ve el patrón**. Se trata cada reporte como caso aislado.
- **Situación observada:** *"veo un error de estado cero con distintos huevones o con el mismo, ¿no hay una alerta de que esto se está repitiendo?… si se repite con distintos en distintas empresas, no es un caso aislado, hay un problema en el código, un problema nuestro que hay que corregir"*.
- **Riesgos:** apagar incendios sin apagar la fuente. Se corrige el síntoma 20 veces en vez de la causa 1 vez.
- **Objetivo:** que el sistema **avise** cuando un mismo tipo+módulo (o palabra clave) se repite por encima de un umbral en una ventana de tiempo.
- **Propuesta de solución:** una regla programada (trigger diario) que agrupa solicitudes **abiertas o recientes** por `(módulo, tipo)` y, si superan un umbral (p. ej. ≥ 3 en 7 días con ≥ 2 solicitantes distintos), genera una **alerta de patrón** para Gerencia/Leo: *"El módulo X acumula N reportes de tipo Error esta semana — posible causa raíz"*. Se apoya en la categorización estructurada (módulo/tipo) en vez del texto libre, que es justo lo que el gerente identificó como el obstáculo.
- **Impacto esperado:** pasar de reactivo a preventivo. Alto valor para Gerencia.
- **Cambios en la interfaz:** una sección "Alertas de patrón" en el dashboard de Gerencia/Leo.
- **Cambios en la base de datos:** ninguna tabla nueva imprescindible (se calcula sobre `SOLICITUDES`+`SUBSOLICITUDES`); opcionalmente `LOG_SISTEMA` para registrar la alerta emitida y no repetirla.
- **Cambios en el flujo:** un trigger de tiempo nuevo (el proyecto ya tiene infraestructura de triggers).
- **Prioridad:** **Media (Should)** — alto valor, pero no bloquea la operación diaria.
- **Dependencias:** que la categorización por módulo/tipo sea disciplinada (P2 la refuerza).
- **Posibles riesgos:** falsos positivos si los módulos están mal parametrizados. Empezar con umbral conservador y ajustar.
- **Recomendaciones:** v2.0 entrega la versión por categoría; una detección por similitud de texto (NLP) es v3.0 y probablemente innecesaria si la categorización es buena.

### P8 — Integración con "Salidas de Terreno" / Hallazgos

- **Problema actual:** Hernán levanta solicitudes de desarrollo **durante** las salidas de terreno y las inspecciones (hallazgos), en un formato separado (fecha, coordinación, objetivo, resumen, solicitudes, acuerdos, fotos). Hoy tendría que **re-tipearlas** en SIGSO.
- **Situación observada:** *"tengo otro ítem que se llama 'solicitudes de desarrollo'… si traspasamos eso que estás haciendo, debiese traspasarlo acá"*; analogía con el módulo de hallazgos de prevención de Camila (*"reportas el hallazgo y completas el mismo formulario, queda registrado"*).
- **Riesgos:** doble digitación, solicitudes que nacen en terreno y nunca llegan a SIGSO.
- **Objetivo:** que una solicitud detectada en terreno se cree en SIGSO **sin re-tipear**, arrastrando su contexto (obra, cliente, salida de origen).
- **Propuesta de solución:** un punto de entrada "Reportar solicitud/hallazgo" **embebible** en el flujo de salida de terreno, que reutiliza el mismo `crearSolicitud` con el contexto pre-llenado (empresa, cliente, obra desde la salida). Enlace bidireccional: la salida guarda el N° de solicitud; la solicitud referencia la salida de origen.
- **Impacto esperado:** captura completa de la demanda; elimina el traspaso manual.
- **Cambios en la interfaz:** botón/formulario "reportar solicitud" dentro del módulo de salidas.
- **Cambios en la base de datos:** columna aditiva `origen` / `ref_externa` en `SOLICITUDES` (de dónde nació: formulario público, salida de terreno, hallazgo).
- **Cambios en el flujo:** ninguno en el ciclo de vida; solo un nuevo origen de creación.
- **Prioridad:** **Baja (Could)** — depende de que el módulo de salidas de terreno exista/se construya. Es integración futura.
- **Dependencias:** módulo de salidas de terreno (fuera del alcance de SIGSO hoy).
- **Posibles riesgos:** acoplar SIGSO a un módulo que aún no está definido. Mantenerlo como **API/contrato** (crearSolicitud ya es un endpoint), no como código acoplado.
- **Recomendaciones:** no construir el módulo de terreno dentro de SIGSO; exponer SIGSO como servicio y que terreno lo consuma. Preserva la separación de responsabilidades.

### P9 — Versionado y control documental (ISO) de los documentos generados

- **Problema actual:** SIGSO ya genera un documento por solicitud aprobada, pero sin metadatos de control documental.
- **Situación observada:** *"le das un código al documento, una versión, la fecha vigente y la página… página 1 de N"*, en el contexto de los formatos ISO que están normalizando.
- **Riesgos:** documentos sin trazabilidad formal; problemas en auditorías ISO.
- **Objetivo:** que cada documento generado tenga código, versión, fecha de vigencia y "página X de Y".
- **Propuesta de solución:** extender la plantilla de generación de documentos con encabezado/pie de control: código (`SOL-AAAA-EMP-NNNN` + versión de documento, que **ya existe** como `version_documento`/`url_pdf_historial`), fecha de vigencia, y numeración de páginas.
- **Impacto esperado:** documentos aptos para gestión documental ISO.
- **Cambios en la interfaz:** ninguno.
- **Cambios en la base de datos:** ninguno (los campos de versión ya existen).
- **Cambios en el flujo:** ajuste en la plantilla de `Documentos.gs`.
- **Prioridad:** **Baja (Could)** — valor para cumplimiento, no para operación.
- **Dependencias:** ninguna.
- **Posibles riesgos:** ninguno.
- **Recomendaciones:** alinear el formato con los demás documentos ISO que la organización está creando, para consistencia.

### P10 — Migración y consolidación desde el intranet "azulito"

- **Problema actual:** conviven SIGSO y un intranet legado que "se fue formando a medida que le enviaban solicitudes a Leo" (crecimiento orgánico sin diseño).
- **Situación observada:** *"revisar el intranet azulito para ver qué funciona y qué no… ver qué módulos usan y pasarlos acá para que solo se llene en este apartado"*.
- **Riesgos:** dos fuentes de verdad, esfuerzo duplicado, el legado nunca muere.
- **Objetivo:** que SIGSO sea la única fuente de verdad de las solicitudes y el intranet legado se retire.
- **Propuesta de solución:** **inventario** de módulos del intranet legado → clasificar (migrar / descartar / ya cubierto) → parametrizar en SIGSO los módulos vivos → plan de apagado.
- **Impacto esperado:** consolidación; fin de la duplicación.
- **Cambios en la interfaz:** ampliar el catálogo de módulos (administración, ya existe).
- **Cambios en la base de datos:** solo datos de catálogo (`CAT_MODULOS`).
- **Cambios en el flujo:** ninguno.
- **Prioridad:** **Media (Should)** — es trabajo de datos/proceso, no de código.
- **Dependencias:** acceso al intranet legado.
- **Posibles riesgos:** ⚠️ **advertencia de arquitectura del propio gerente:** *"el mal que tienen es que van añadiendo y añadiendo cosas en el menú… un menú de 100 cosas en vez de tener todo en una ventana"*. **No repetir ese error en SIGSO.** Ver §11 (escalabilidad).
- **Recomendaciones:** migrar solo lo que se usa. Un módulo sin uso no se migra: se descarta.

### P11 — Gestión de tareas personal (❌ recomendado ELIMINAR/DIFERIR)

- **Problema actual:** se pidió que cada usuario tenga un espacio tipo "libro electrónico" para dejar sus tareas puestas (analogía con Notion/GoodNotes).
- **Situación observada:** *"esto venía siendo como un libro electrónico… estos son míos, es mi perfil"*. Pero **el propio usuario objetivo lo rechaza:** *"yo hago esa tarea para ir a trabajar nada más… tengo GoodNotes pagado hace un año y nunca lo he ocupado… puse Notion, no lo ocupaban ever"*.
- **Análisis del arquitecto:** es **scope creep** clásico. No es parte del dominio "sistema de solicitudes". Compite con herramientas que ya existen (Notion, GoodNotes) y que la propia gente **no usa**. Agrega complejidad de UI, permisos y almacenamiento (crítico con el límite de 15 GB de Drive) sin aportar al flujo core.
- **Decisión:** **ELIMINAR de v2.0.** Contradice el principio rector de la reunión (*"no intentes controlar mucho… no completar tanta información"*) y el del propio proyecto ("simple pero extremadamente útil").
- **Recomendaciones:** si en el futuro se necesita seguimiento de tareas, que sea sobre las **solicitudes existentes** ("mis solicitudes asignadas", que ya existe para Leo), no un cuaderno paralelo.

### P12 — Notificaciones y estrategia de adopción (correo opt-in + resumen WhatsApp)

- **Problema actual:** tensión sobre a quién y cuándo notificar. Felipe pidió *"no enviar correo a Leo todavía"*, pero el sistema lo envía.
- **Situación observada:** *"no le avises a Leo, Felipe me dijo que no le enviara ni un correo todavía"*; y a la vez el resumen tipo WhatsApp existe *"para que igual le peguen a Leo por WhatsApp, porque acostumbrarlo a esto no va a pasar de un día para otro"*.
- **Riesgos:** notificar de más (spam, Felipe molesto) o de menos (urgencias que Leo no ve).
- **Objetivo:** notificaciones **controlables** y una transición realista desde el WhatsApp.
- **Propuesta de solución:** **ya implementado (Tanda 1):** aviso a Leo automático para clientes y P1, opt-in ("avisar a Leo") para internas, + resumen copiable para WhatsApp. La v2.0 agrega un **switch de configuración** (en Administración) para activar/desactivar el aviso automático a Leo globalmente, respetando la instrucción de Felipe sin hardcodear.
- **Impacto esperado:** Gerencia controla la política de notificación sin tocar código.
- **Cambios en la interfaz:** un toggle en Administración → Configuración.
- **Cambios en la base de datos:** usar `CONFIG_NOTIFICACIONES` (tabla ya existente, hoy infrautilizada).
- **Cambios en el flujo:** el ruteo consulta la config en vez de una constante.
- **Prioridad:** **Media (Should).**
- **Dependencias:** ninguna.
- **Posibles riesgos:** ninguno.
- **Recomendaciones:** el resumen WhatsApp es la mejor herramienta de adopción; mantenerlo prominente.

---

## 4. Contradicciones detectadas

| # | Contradicción | Origen | Resolución propuesta |
|---|---|---|---|
| C1 | **"Leo hace todo / puede cerrar"** (implementado Fase 10.2) **vs. "el que pide valida y cierra"** (regla explícita de la reunión). | Decisión de velocidad reciente vs. regla de gobierno del proceso. | **P3.** Leo mantiene libertad de movimiento excepto el **cierre definitivo**, que vuelve al solicitante. Es la contradicción más importante y hay que resolverla antes de v2.0. |
| C2 | **"Avisar a Leo por correo"** (el sistema lo hace) **vs. "Felipe dijo no enviarle correo todavía"**. | Instrucción de un jefe vs. comportamiento del sistema. | **P12.** Hacerlo configurable (on/off) en vez de hardcodeado. |
| C3 | **"Formulario completo con mucha trazabilidad"** (diseño) **vs. "algo corto y rápido"** (gerencia). | Trazabilidad vs. velocidad. | **P1.** Dos velocidades. No se elige un lado. |
| C4 | **"Todo entra como prioridad alta"** (comportamiento) **vs. "casi nada es realmente alta"** (realidad). | Auto-declaración vs. impacto real. | **P2.** Urgencia por tipo + validación del gestor. |
| C5 | **"Gerencia solo quiere KPIs"** (supuesto de Leo) **vs. "necesito ver el detalle de qué se pidió"** (Gerencia). | Supuesto del desarrollador vs. necesidad de quien manda. | **P6.** Rol Gerencia con detalle de solo-lectura. |

---

## 5. Propuestas eliminadas o diferidas (y por qué)

Fiel al principio *"prefiero un sistema simple pero extremadamente útil"*:

- **❌ P11 — Libro electrónico de tareas personal.** Scope creep; los usuarios objetivo ya rechazan herramientas equivalentes. Eliminado.
- **⏸ P8 — Integración con salidas de terreno.** Valiosa pero depende de un módulo externo inexistente. Se difiere a v2.1+ y se resuelve como **contrato/API**, no como código acoplado.
- **⏸ P9 — Control documental ISO.** Valor de cumplimiento, no de operación. Diferible.
- **⚠️ Advertencia transversal:** no convertir SIGSO en el intranet legado que crece agregando módulos al menú sin diseño (C10). Cada módulo nuevo debe justificar su lugar; preferir vistas filtradas sobre menús interminables.

---

## 6. Requerimientos funcionales (RF)

> Nomenclatura: RF-2xx = nuevos de v2.0. Se referencia P# de origen.

| ID | Requerimiento | Origen | Prioridad |
|---|---|---|---|
| RF-201 | El formulario ofrece modo **Rápido** (4–5 campos) y **Completo**, con el modo sugerido según el tipo. | P1 | Must |
| RF-202 | En modo Rápido, los campos avanzados están colapsados y son opcionales. | P1 | Must |
| RF-203 | Los tipos de solicitud marcados `es_urgente` se muestran destacados y fijan prioridad alta inicial. | P2 | Must |
| RF-204 | El gestor puede confirmar/ajustar la prioridad con justificación (existente, se conserva). | P2 | Must |
| RF-205 | En "Consultar Estado", el solicitante ve su **posición en la cola** (N solicitudes de prioridad ≥ por delante). | P2 | Should |
| RF-206 | El gestor **no puede** fijar "Cerrada" (salvo consulta técnica); solo hasta "Terminada/En pruebas". | P3 | Must |
| RF-207 | El solicitante valida desde "Consultar Estado": **Confirmar y cerrar** o **Reabrir** (con comentario). | P3 | Must |
| RF-208 | Cierre automático por inactividad del solicitante tras N días hábiles en "Terminada". | P3 | Should |
| RF-209 | Solicitud de cliente ⇒ datos de cliente obligatorios + prioridad urgente + aviso a Leo (existente, se refina). | P4 | Done/pulido |
| RF-210 | Al responder una solicitud de información, se **notifica a Leo** y aparece un badge "respuesta recibida". | P5 | Should |
| RF-211 | Rol **Gerencia**: dashboard completo + detalle de cualquier solicitud en **solo-lectura** + filtro por solicitante. | P6 | Must |
| RF-212 | Gerencia puede **exportar** un listado filtrado (CSV). | P6 | Should |
| RF-213 | El sistema emite **alertas de patrón** cuando `(módulo, tipo)` supera un umbral con ≥ 2 solicitantes. | P7 | Should |
| RF-214 | Punto de entrada externo "Reportar solicitud" con contexto pre-llenado (vía API `crearSolicitud`). | P8 | Could |
| RF-215 | Los documentos generados incluyen código, versión, fecha de vigencia y "página X de Y". | P9 | Could |
| RF-216 | La política de aviso automático a Leo es **configurable** desde Administración. | P12 | Should |
| RF-217 | El catálogo de módulos permite migrar/parametrizar los módulos del intranet legado. | P10 | Should |

---

## 7. Requerimientos no funcionales (RNF)

| ID | Requerimiento | Detalle |
|---|---|---|
| RNF-01 | **Costo cero** (restricción de negocio). | Mantener GitHub Pages + Apps Script + Sheets + Drive mientras el volumen lo permita. |
| RNF-02 | **Velocidad de ingreso de urgencia ≤ 20 s.** | Métrica de éxito de P1. |
| RNF-03 | **Latencia de acciones del gestor.** | Un cambio de estado debe responder < 2 s percibidos (por eso el correo se encola, Fase 10.2). |
| RNF-04 | **Techo de datos.** | Google Sheets degrada con decenas de miles de filas y muchas lecturas por request. Ver §11. |
| RNF-05 | **Límite de almacenamiento.** | Drive 15 GB (cuenta gratuita). Las imágenes son el mayor consumidor → política de retención/compresión. |
| RNF-06 | **Trazabilidad total.** | Todo cambio de estado, prioridad, comentario y adjunto queda en historial con autor y timestamp. |
| RNF-07 | **Seguridad por rol.** | Solicitante ve solo lo suyo; Gerencia solo lectura; catálogos/usuarios solo Admin. |
| RNF-08 | **Portabilidad de la base de datos.** | La lógica no debe depender de Sheets directamente; toda lectura/escritura pasa por la capa de repositorio (`SheetsRepo`) para poder migrar. |
| RNF-09 | **Multi-empresa aislada.** | HP / RLD / GDE no se filtran entre sí (ya probado E2E). |
| RNF-10 | **Idempotencia y deduplicación de notificaciones.** | Ya implementado (RN-026). |

---

## 8. Casos de uso (resumen)

| CU | Actor | Descripción | Estado |
|---|---|---|---|
| CU-01 | Solicitante | Ingresar urgencia (modo rápido) | Nuevo (P1) |
| CU-02 | Solicitante | Ingresar desarrollo (modo completo) | Existente, refinado |
| CU-03 | Solicitante | Consultar estado y **posición en cola** | Refinado (P2) |
| CU-04 | Solicitante | Responder solicitud de información | Existente |
| CU-05 | Solicitante | **Validar y cerrar** (o reabrir) | Nuevo (P3) |
| CU-06 | Gestor (Leo) | Recibir, priorizar, trabajar, pedir info, entregar (hasta "Terminada") | Refinado (P3 quita el cierre) |
| CU-07 | Gestor (Leo) | Re-priorizar con justificación | Existente |
| CU-08 | Gerencia | Ver KPIs + detalle en solo-lectura + exportar | Nuevo (P6) |
| CU-09 | Gerencia/Gestor | Recibir alerta de patrón recurrente | Nuevo (P7) |
| CU-10 | Admin | Parametrizar empresas/plataformas/módulos/tipos y usuarios | Existente |
| CU-11 | Admin | Configurar política de notificaciones | Nuevo (P12) |
| CU-12 | Sistema (externo) | Crear solicitud desde salida de terreno | Diferido (P8) |

---

## 9. Reglas de negocio (RN v2.0)

Se conservan las RN de v1.x (RN-001..031) salvo las que cambian abajo:

- **RN-201 (Cierre por el solicitante).** Solo el **solicitante** (o cierre automático por inactividad) puede llevar una solicitud a "Cerrada". El gestor llega hasta "Terminada/En pruebas". **Excepción:** consultas técnicas las cierra el gestor. *(Modifica el comportamiento abierto de la Fase 10.2.)*
- **RN-202 (Urgencia por tipo).** Los tipos marcados `es_urgente` y toda solicitud de cliente entran con prioridad alta; el impacto declarado solo la afina.
- **RN-203 (Validación de prioridad).** Una prioridad alta puede ser rebajada por el gestor con justificación (≥ 20 caracteres, ya existe), que queda en historial.
- **RN-204 (Comentario obligatorio en movimientos sensibles).** Rechazar, cancelar, cerrar directo, reabrir y "esperando información" exigen comentario (ya existe, Fase 10.2).
- **RN-205 (Privacidad de la cola).** El solicitante ve cuántas solicitudes tiene por delante, **nunca** su contenido.
- **RN-206 (Alerta de patrón).** ≥ 3 solicitudes `(módulo, tipo)` en 7 días con ≥ 2 solicitantes distintos ⇒ alerta a Gerencia/Gestor.
- **RN-207 (Gerencia solo lectura).** El rol Gerencia nunca modifica estados, prioridades ni catálogos.
- **RN-208 (Notificación configurable).** El aviso automático a Leo se rige por la configuración global, no por código.

---

## 10. Flujo completo del sistema (optimizado)

```
                    ┌─────────────────────────────────────────────┐
                    │  INGRESO (formulario 2 velocidades / API)    │
                    │  · Rápido (urgencia)  · Completo (desarrollo)│
                    └───────────────────┬─────────────────────────┘
                                        │  acuse al solicitante
                                        │  aviso a Leo si (cliente | P1 | opt-in)
                                        ▼
                              [S01 Nueva] ──(auto/gestor)──► [S02 Recibida]
                                        │
                                        ▼
                              [S03 En revisión]  ◄──────────────┐
                          ┌─────────────┼───────────────┐       │
                          ▼             ▼               ▼       │
                 [S06 Esperando    [S04 Aprobada]  [S10 Rechazada]
                  información]          │           (comentario)  │
                     │  ▲               ▼                         │
   solicitante ─────┘  │        [S05 En desarrollo]               │
   responde ───────────┘               │                         │
                                        ▼                         │
                                [S07 En pruebas]                  │
                                        │                         │
                                        ▼                         │
                                [S08 Terminada]  ◄── el gestor NO cierra
                                        │
                        ┌───────────────┴───────────────┐
                        ▼                               ▼
          SOLICITANTE valida:                SOLICITANTE: "no resuelto"
          "Confirmar y cerrar"                     └──► reabre a [S05]
                        │                       (o cierre auto por inactividad)
                        ▼
                  [S09 Cerrada]  ← significa VALIDADO por quien pidió
```

**Etapas que se agregan / cambian respecto de hoy:**
- **Ingreso de dos velocidades** (nueva bifurcación de entrada).
- **Validación por el solicitante** entre "Terminada" y "Cerrada" (etapa de gobierno que hoy Leo se salta).
- **Cierre automático por inactividad** (evita solicitudes zombis en "Terminada").

**Etapas que se conservan** por ser correctas: pedir/responder información (S06), rechazo con motivo (S10), cancelación (S11), reapertura con comentario.

**Etapas innecesarias eliminadas:** ninguna del ciclo core; la simplificación está en la **entrada** (formulario rápido), no en el ciclo de estados, que ya es coherente.

---

## 11. Escalabilidad y decisiones que limitan el crecimiento

Como arquitectos, señalamos explícitamente las decisiones actuales que, de no atenderse, frenan el crecimiento a varios años:

1. **⚠️ Google Sheets como base de datos (la más crítica).**
   - *Síntoma ya observado:* "el cambio de estado tarda mucho" — cada acción hace múltiples lecturas completas de hojas; cada lectura es un viaje a la API de Sheets. Ya se optimizó (Fase 10.2) pero es un parche.
   - *Techo:* Sheets degrada notablemente con decenas de miles de filas y no soporta consultas concurrentes eficientes. A ~2–3 años de uso multi-empresa, las lecturas serán lentas.
   - *Alternativa escalable:* migrar la persistencia a **Firestore** (sigue en el ecosistema Google, tiene capa gratuita generosa, consultas indexadas, concurrencia real). **Habilitante clave:** toda la lógica ya pasa por `SheetsRepo` (capa de repositorio). Si se mantiene esa disciplina (RNF-08), migrar es cambiar **una** capa, no reescribir el sistema. **Recomendación: no migrar aún, pero blindar la abstracción para poder hacerlo sin dolor.**

2. **⚠️ Almacenamiento de imágenes en Drive gratuito (15 GB).**
   - *Techo:* las capturas llenan los 15 GB. A volumen real, se agota en meses.
   - *Alternativa:* política de retención (archivar/comprimir imágenes de solicitudes cerradas hace > X meses) y, si crece, un bucket de objetos de bajo costo. Mantener en `ARCHIVOS` solo el puntero (ya es así) facilita mover el blob.

3. **⚠️ Menús que crecen sin diseño (el error del intranet legado).**
   - El propio gerente lo diagnosticó: *"van añadiendo cosas al menú… 100 cosas en vez de una ventana"*. SIGSO debe resistir esa tentación: **preferir vistas filtradas y búsqueda** (ya se agregó el buscador) sobre menús interminables. Cada módulo nuevo debe justificar su existencia.

4. **Modelo de roles rígido (ANA/DEV/ADM heredado de la spec original).**
   - No refleja la operación real (Solicitante / Gestor único / Gerencia). Se recomienda **renombrar y simplificar** a `SOLICITANTE`, `GESTOR`, `GERENCIA`, `ADMIN` (§12.1). Es un cambio de catálogo + etiquetas, de bajo riesgo, que hace el sistema comprensible para quien lo opera.

5. **Lógica de negocio duplicada entre proyectos Apps Script (Intake/Backoffice/Setup).**
   - Hoy `Constantes.gs`, `SheetsRepo.gs`, etc. están triplicados y sincronizados a mano (con un test que detecta divergencias). Funciona, pero cada cambio de esquema se toca en 3 lugares. A futuro, consolidar en una **librería Apps Script compartida** reduce ese costo. Media prioridad.

---

## 12. Recomendaciones para la versión 2.0

### 12.1 Renombrar el modelo de roles a la operación real
`ANA/DEV/ADM` → `SOLICITANTE / GESTOR / GERENCIA / ADMIN`. Bajo riesgo, alto valor de claridad. El "gestor" concentra lo que hoy hacen ANA+DEV (coherente con "Leo hace todo"), pero **sin el poder de cierre** (RN-201).

### 12.2 Tratar la velocidad como un requisito de producto, no un lujo
La adopción depende de que ingresar una urgencia sea más rápido que un WhatsApp. Es el criterio de éxito #1. Todo lo demás (KPIs, alertas, ISO) es secundario si la gente no ingresa las solicitudes.

### 12.3 El resumen para WhatsApp es la estrategia de transición, no un extra
Mantenerlo prominente. Es el puente entre "todo por WhatsApp" y "todo en SIGSO". La adopción será gradual (*"no va a pasar de un día para otro"*).

### 12.4 Blindar la abstracción de datos antes de crecer
No migrar de Sheets hoy, pero **prohibir** cualquier acceso a Sheets fuera de `SheetsRepo`. Es la póliza de seguro para escalar sin reescribir.

### 12.5 Medir antes de agregar
El gerente lo dijo mejor que nosotros: *"primero hay que usarlo… y desde ahí recién decir 'esto sobra' o 'agreguémosle otro dato'… después ir puliéndolo"*. Instrumentar qué campos se usan y qué acciones se hacen, y dejar que los datos guíen la v2.1.

---

## 13. Priorización de mejoras (MoSCoW)

| Prioridad | Propuestas | Justificación |
|---|---|---|
| **Must (v2.0)** | P1 (2 velocidades) · P3 (cierre por solicitante) · P2 parcial (urgencia por tipo + validación) · P6 (vista Gerencia con detalle) | Resuelven las quejas centrales y la contradicción de gobierno (C1). Sin esto, el sistema no calza con la operación. |
| **Should (v2.0/2.1)** | P2 (cola visible) · P5 (notificación de respuesta) · P7 (alertas de patrón) · P10 (migración legado) · P12 (notificación configurable) | Alto valor, no bloquean la operación diaria. |
| **Could (v2.1+)** | P9 (control documental ISO) · P8 (integración salidas de terreno) | Cumplimiento e integración; dependen de terceros/módulos externos. |
| **Won't (por ahora)** | P11 (libro de tareas personal) | Scope creep; rechazado por los propios usuarios. |

---

## 14. Roadmap sugerido

**Sprint 1 — Gobierno del proceso (lo más urgente)**
- P3: revertir el cierre libre; implementar validación/cierre por el solicitante + cierre automático por inactividad.
- P1: formulario de dos velocidades.
- Renombrar roles (§12.1).

**Sprint 2 — Priorización y visibilidad**
- P2: urgencia por tipo (`es_urgente`), tipos urgentes destacados, cola visible.
- P6: rol Gerencia con detalle en solo-lectura + exportación.

**Sprint 3 — Inteligencia y control**
- P7: alertas de patrón por (módulo, tipo).
- P5: notificación de respuesta a Leo + badge.
- P12: notificación configurable.

**Sprint 4 — Consolidación**
- P10: inventario y migración del intranet legado (datos/catálogos).
- Blindaje de la capa de datos (§12.4) como preparación para escalar.

**Backlog (v2.1+)**
- P9 (ISO), P8 (integración terreno), y la evaluación de migrar Sheets→Firestore según el crecimiento medido.

---

## 15. Coherencia del flujo — veredicto del arquitecto

El flujo **desde crear hasta cerrar-validado** queda **coherente y completo** en la v2.0 con **un único cambio estructural**: devolver el cierre al solicitante (P3/RN-201). El resto del ciclo de estados de v1.x ya es correcto; la optimización real está en la **entrada** (formulario rápido) y en la **gobernanza del cierre**, no en agregar etapas. Se resistió deliberadamente la tentación de añadir módulos y controles ("libro de tareas", menús que crecen), fiel al principio del cliente: **simple, pero extremadamente útil.**

---

*Fin del documento ESP-SIGSO-2.0.*
