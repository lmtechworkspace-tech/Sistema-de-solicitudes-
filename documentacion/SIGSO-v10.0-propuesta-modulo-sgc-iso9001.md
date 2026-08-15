# SIGSO v10.0 — Propuesta: Módulo SGC ISO 9001:2015

> **Estado:** propuesta para aprobación. **No se ha escrito código de implementación.**
> Documento de auditoría técnica + arquitectura, mismo formato que las propuestas
> previas (v7.0 Gestión Operacional, v9.0 Proyectos).
>
> **Fuente:** `Especificacion_Modulo_ISO9001_SIGSO_HomePymes.docx` (Depto. de Gestión
> y Control, agosto 2026, v1.0) — 10 submódulos, 13 personas en alcance del SGC.
>
> **Contexto de negocio:** la empresa está en proceso de implementación y posterior
> **certificación ISO 9001:2015**. Eso cambia el criterio de priorización: no se
> construye por número de módulo, se construye por *lo que la auditoría de
> certificación revisa primero* (ver §K).

---

## 0. Resumen ejecutivo — veredicto y las dos decisiones que lo cambian todo

**¿Es factible?** Sí, y bastante más de lo que la especificación asume. Tras revisar
el código real de SIGSO (no la documentación: el código), **entre el 50% y 60% de la
maquinería que este módulo necesita ya está construida, probada y en producción.**

Pero hay **tres restricciones duras** que la especificación no podía conocer y que
deben decidirse ANTES de escribir código (§C). Y hay dos decisiones de arquitectura
que determinan si esto se convierte en un SGC que la gente usa, o en diez planillas
con otra cara.

### Decisión central nº1 — Las acciones correctivas SON ACTIVIDADES

Igual que en v9.0 se decidió que *"las tareas de un proyecto no son una entidad
nueva, son ACTIVIDADES"*:

> **Las correcciones, las acciones correctivas (PRO-06), los acuerdos de la revisión
> por la dirección (PRO-05) y las tareas de auditoría (PRO-03) NO son entidades
> nuevas: son `ACTIVIDADES`**, el motor de Gestión Operacional que existe desde v7.0,
> etiquetadas con su origen SGC.

Todas comparten la misma forma: alguien responsable, un plazo, un avance, un posible
bloqueo, y alguien que debe rendir cuenta. Reutilizar `ACTIVIDADES` entrega gratis:
check-in de un clic, semáforo de urgencia, alertas de vencimiento, reasignación,
historial de avance, y — lo más importante para que el SGC **se use** —

**la acción correctiva le aparece al responsable en "Mi trabajo", junto a todo lo
demás que ya hace.** No tiene que entrar a "el módulo ISO" ni aprender un flujo
nuevo. Esa es la diferencia entre un SGC vivo y uno que se abandona a los tres meses.

### Decisión central nº2 — La distribución documental se monta sobre Novedades

Hallazgo de la revisión de código: el módulo **Novedades** (v6.5–v6.8) ya implementa,
en producción y con tests, el ciclo de vida documental que exige PRO-01:

| Lo que exige PRO-01 | Lo que Novedades ya hace hoy |
|---|---|
| Elaboración → Revisión → Aprobación → Distribución | Carril CONTROLADO: `EN_REVISION → DEVUELTA / RECHAZADA → PUBLICADA` |
| Registro de quién ejecutó cada acción y cuándo | `NOVEDADES_HISTORIAL`: una fila por transición, con autor y motivo |
| El aprobador no puede ser el autor | Ya validado (*"evaluada contra el APROBADOR, no el autor"*) |
| Distribución a los usuarios con acceso | `audiencia_tipo` + `NOVEDADES_DESTINATARIOS` (audiencia dirigida) |
| **Evidencia de que la gente recibió el documento** | `NOVEDADES_LECTURAS` + botón **"Enterado"** + `fecha_limite_acuse` + recordatorios |

Ese último punto es oro puro: ISO 9001 §7.5.3 exige demostrar que la información
documentada *"está disponible y es idónea para su uso"* — y el auditor lo pregunta
como *"¿cómo prueba que su personal conoce la política de calidad vigente?"*.
**SIGSO ya sabe responder eso, con fecha y nombre.**

> **Propuesta:** el documento controlado vive en su propia tabla (`SGC_DOCUMENTOS` —
> un documento no es una noticia: tiene código, versión, vigencia indefinida y
> obsolescencia). Pero **cuando se aprueba, publica automáticamente una Novedad con
> acuse obligatorio.** El documento se gobierna en el módulo Calidad; su distribución
> viaja por el canal que las 13 personas ya usan a diario. Cero hábitos nuevos.

Esto respeta el principio que ya guía a SIGSO: *reutilizar la **tabla** cuando la
entidad es la misma; reutilizar el **patrón** cuando solo la forma es la misma.*

---

## A. Qué ya existe en SIGSO (verificado en código, no en documentación)

| Necesidad del módulo ISO | Qué existe hoy en SIGSO | Cobertura |
|---|---|---|
| Ciclo elaborar→revisar→aprobar→publicar | `Novedades.gs` carril CONTROLADO + `NOVEDADES_HISTORIAL` | **~80%** |
| Acuse de recepción de documentos (§7.5.3) | `NOVEDADES_LECTURAS`, `requiere_acuse`, `fecha_limite_acuse`, "Enterado", recordatorios | **100%** |
| Audiencia dirigida (quién debe leer qué) | `NOVEDADES_DESTINATARIOS` + `audiencia_tipo` | **100%** |
| Acciones correctivas con responsable/plazo/seguimiento | `ACTIVIDADES` (motor v7.0: check-in, semáforo, bloqueo, alertas, "Mi trabajo") | **100%** (reuso directo) |
| Personas, cargos y jerarquía | `USUARIOS` + `JEFATURAS` (jefe→subordinado) + `Perfiles.gs` (avatares) | **~90%** |
| **Personal externo sin cuenta Google** (6 de 13 son EXT) | `CUENTAS_PORTAL` (usuario, hash+salt, rol, `modulos`, `cargo`) | **100%** |
| Recepción pública de quejas | Intake público (`index.html`) + consulta de estado (`estado.html`) | **~90%** |
| Correlativo por empresa/año | `COUNTERS` (`empresa_id`, `anio`, `ultimo_numero`) | **100%** |
| Notificación viva + correo, con canales configurables | `encolarNotificacionApp_`, `enviarCorreo_`, `CONFIG_NOTIFICACIONES` | **100%** |
| **Plazos en días hábiles con feriados** | `Utils.horasHabilesEntre` + `CONFIG_FERIADOS` | **100%** ⭐ |
| Archivos a Drive | `ARCHIVOS` + `DriveRepo.gs` | ~70% (hoy acotada a `solicitud_id`) |
| Exportar formulario/informe a PDF | HTML→PDF (`OrdenTrabajo.gs`, `ReporteActividades.gs`, `Pausas.gs`) | **100%** |
| Log de auditoría (quién hizo qué) | `LOG_SISTEMA` | **100%** |
| Dashboard con KPIs, semáforo y mapa de calor | `Gerencia.gs` (patrón completo, cacheado) | **~90%** |
| Máquina de estados con transiciones válidas | `TRANSICIONES_VALIDAS` (Solicitudes) — patrón replicable | patrón |

⭐ **`Utils.horasHabilesEntre` merece mención aparte.** Casi todos los plazos del SGC
son en **días hábiles** (NC: 10 hábiles para corrección, 20 para AC, 60 para eficacia;
auditoría: informe en 10 hábiles, 5 de anticipación). SIGSO ya calcula días hábiles
descontando fin de semana, feriados chilenos configurables e incluso pausas. Esto solo
suele ser una fuente enorme de errores en implementaciones de SGC.

### Lo que hay que construir (nuevo)

1. Versionado documental + obsolescencia + **listado maestro** (FO-PRO-01-01)
2. Ficha del trabajador: descriptor de cargo, inducción, evaluación de competencias, capacitaciones
3. Auditoría interna: programa anual, plan, lista de verificación por cláusula, informe
4. Proveedores: ficha + evaluación de 6 criterios con calificación automática
5. Revisión por la dirección: 13 entradas de §9.3.2 + acuerdos
6. No conformidades: registro + **5 por qué** guiado + verificación de eficacia
7. Quejas: entidad propia + flujo (reutilizando patrones de Solicitudes)
8. Evidencia de servicios: matriz cliente × proceso × período *(ver riesgo §C2)*
9. **Matriz de cobertura ISO** *(mejora propuesta, no está en la especificación — §L1)*

---

## B. Los tres riesgos que hay que decidir ANTES de escribir código

### C1. Presupuesto de triggers agotado — **verificado en el código**

La especificación §13 pide ~14 notificaciones automáticas con horarios distintos
("30 días antes", "al día 8", "al día 25", "al día 55"…). **No pueden tener triggers
propios.**

Google Apps Script limita a **20 triggers de tiempo por script**, y `Triggers.gs`
crea 17, con esta nota textual en el código:

> *"Apps Script limita a 20 triggers de tiempo por script (cuenta estándar) y ya
> estaban los 20 usados. En vez de eso, se cuelga de `recordarValidacionPendiente`
> (09:00 diario): mismo horario, sin gastar un slot nuevo."*

**Solución (patrón ya probado dos veces en SIGSO):** un único **motor de vencimientos
del SGC** que se cuelga del trigger diario de las 09:00 y, en una sola pasada, evalúa
todos los vencimientos (documentos a 12 meses, evaluaciones, NC, auditorías,
proveedores, revisión por la dirección, quejas).

**Y esto resulta ser mejor producto, no solo una limitación técnica:** en vez de 14
correos sueltos, cada persona recibe **un solo correo diario agrupado** con todo lo
suyo. Es la regla de oro que SIGSO ya aplica en Novedades y Actividades — y es lo que
evita que el personal empiece a filtrar los correos del SGC a los dos meses.

### C2. Escala del Módulo 8 (Evidencia de servicios) — **el riesgo nº1 del proyecto**

El módulo pide registrar cada servicio prestado a cada cliente, con 4 carpetas de
evidencia, sobre **41 procesos**.

Aritmética rápida: 50 clientes × 12 períodos × 3 procesos promedio ≈ **1.800
servicios/año ≈ 7.200 registros de evidencia/año**, más los archivos en Drive. Google
Sheets soporta el volumen, pero las lecturas se degradan y Apps Script corta a los
**6 minutos por ejecución**. Sumado a que **Drive gratuito son 15 GB compartidos con
Gmail**, esto puede volverse el cuello de botella de todo el sistema.

**Recomendación:**
- **No pre-generar** filas de cliente × proceso × período. Crear el registro cuando el servicio efectivamente se presta.
- Evaluar **planilla separada** solo para esta hoja (Sheets independiente, referenciado por ID).
- **Archivar períodos cerrados** (patrón `activa=false` que SIGSO ya usa).
- **Construirlo al final** (Fase 7), cuando se conozcan los volúmenes reales.

> **Dato que necesito de ustedes:** ¿cuántos clientes activos y cuántos servicios/mes
> aproximadamente? Es lo que define la estrategia de este módulo.

### C3. "Firma digital" — hay que ser honesto con lo que sí y lo que no

La especificación §15.3 pide *"firma digital o espacio para firma manuscrita"*.

**No existe firma digital criptográfica a costo $0** dentro de esta arquitectura.
Prometerla sería un problema justo el día de la auditoría. Lo que **sí** es viable, y
es válido como evidencia ISO:

- **Acuse electrónico con sello de tiempo**: usuario autenticado + fecha/hora + registro en `LOG_SISTEMA`. Es lo que ya hace el "Enterado" de Novedades, y es evidencia suficiente de comunicación y de toma de conocimiento.
- **Exportación a PDF con bloque de firma** para lo que requiera firma manuscrita por norma interna o cultura (inducción FO-PRO-02-02, capacitación FO-PRO-02-05).

### Riesgos menores, pero a tener presentes

- **Log de accesos:** la especificación pide registrar *"quién accedió, editó o descargó cada documento"*. Loguear **cada lectura** haría explotar `LOG_SISTEMA`. Propuesta: registrar **escrituras, aprobaciones y descargas** (que es lo que el auditor pregunta), no cada visualización.
- **Conflicto de interés:** "el auditor no audita su propio trabajo" y "el investigador no puede estar involucrado en el origen de la queja" son reglas que exigen datos de área/cargo para poder validarse automáticamente. Viables con `USUARIOS` + `JEFATURAS`.

---

## D. Cómo se adecúa a SIGSO (arquitectura)

### Un módulo, roles internos — mismo patrón que Proyectos

- **Un módulo nuevo `calidad`** en `MODULOS_SHELL` (sidebar), registrado en `MODULO_POR_ACCION` como gate **grueso**.
- **Gate fino:** hoja `SGC_ROLES` (`email`, `rol_sgc`, `area_id`, `vigencia_hasta`, `activo`) — exactamente el patrón de `PROYECTO_INTEGRANTES`.
- **No se inventan roles globales nuevos.** Los roles de SIGSO (`ADM`, `GERENCIA`, `JEFATURA`, `DEV`…) no se tocan. El rol SGC es *dentro del módulo*, igual que el rol de proyecto es dentro del proyecto. Esto evita una migración de permisos con riesgo sobre módulos en producción.

**Roles SGC:** `ENCARGADO_SGC` · `DIRECCION` · `GERENCIA_ADM` · `JEFATURA_AREA` ·
`ENC_ADMIN` · `OPERATIVO` · `AUDITOR_EXTERNO`

### Identidad: los 6 externos y el auditor

- Los **6 externos** (Enc. Administración, analistas, prevencionistas) no tienen cuenta Google → entran por **`CUENTAS_PORTAL`** (usuario/contraseña propia del portal), con el módulo `calidad` habilitado. Esta maquinaria ya existe y está en producción.
- El **auditor externo** obtiene una cuenta de portal con `rol_sgc = AUDITOR_EXTERNO` y **`vigencia_hasta`**: acceso de solo lectura que **expira solo** al terminar la auditoría. Sin trabajo manual de "acordarse de desactivarlo".

### Entidades nuevas (mínimas)

```
SGC_DOCUMENTOS        código, nombre, tipo (DOC/PRO/INS/FO), version_vigente,
                      area_id, estado, fecha_vigencia, proxima_revision,
                      elaborado_por, revisado_por, aprobado_por, es_externo
SGC_DOC_VERSIONES     historial completo: versión, cambios, archivo, quién y cuándo
SGC_DOC_ACUSES        quién acusó recibo de qué versión (o se reusa NOVEDADES_LECTURAS)
SGC_PERSONAS          extiende USUARIOS: tipo INT/EXT, subrogante, fecha_ingreso, estado
SGC_DESCRIPTORES      descriptor de cargo versionado (FO-PRO-02-01)
SGC_INDUCCIONES       5 ítems SGC por persona (FO-PRO-02-02)
SGC_EVALUACIONES      competencias cada 12 meses, 8 ítems escala 1-4 (FO-PRO-02-04)
SGC_CAPACITACIONES    curso, horas, relator, participantes, eficacia a 60 días
SGC_AUDITORIAS        programa + plan + informe (PRO-03)
SGC_AUD_HALLAZGOS     hallazgo → NC (vínculo directo)
SGC_NC                no conformidad + 5 por qué + eficacia (PRO-06)
SGC_QUEJAS            queja/felicitación/consulta + flujo (PRO-07)
SGC_PROVEEDORES       ficha + evaluación 6 criterios (PRO-04)
SGC_REVISIONES        revisión por la dirección + 13 entradas + acuerdos (PRO-05)
SGC_EVIDENCIAS        evidencia de servicios (Fase 7, ver §C2)
SGC_INDICADORES       lecturas mensuales de los 6 objetivos (DOC-07)
```

**Deltas a entidades existentes (aditivos, sin migración destructiva):**
`ACTIVIDADES` += `sgc_origen_tipo`, `sgc_origen_id` — para que una acción correctiva
sepa de qué NC/auditoría/revisión nació, y aparezca en "Mi trabajo" como una tarea más.

### Las conexiones son el producto (no los 10 módulos sueltos)

Un SGC no es diez formularios; es la **cadena de trazabilidad**. Eso es exactamente
lo que el auditor sigue:

```
Auditoría interna ──hallazgo──► NO CONFORMIDAD ──5 por qué──► CORRECCIÓN (= Actividad)
        ▲                             │                              │
        │                             │                        ACCIÓN CORRECTIVA (= Actividad)
        │                             │                              │
   cierra hallazgo ◄──eficacia 60d────┴──────────────────────────────┘
                                      ▲
QUEJA de cliente ─────────────────────┤
Revisión por la dirección ────acuerdo─┘ (= Actividad)

DOCUMENTO aprobado ──publica──► NOVEDAD con acuse ──► evidencia de §7.5.3
CAPACITACIONES ──horas/año──► Indicador 4     QUEJAS ──%──► Indicador 2
```

---

## E. Distribución por rol — qué ve cada persona

**Principio de diseño (el más importante de esta propuesta):**

> **La mayoría del personal NO debería entrar nunca al módulo Calidad.** Sus
> obligaciones ISO les llegan a donde ya trabajan: la acción correctiva a **"Mi
> trabajo"**, el documento nuevo a **"Novedades"** con su botón "Enterado", el
> vencimiento por la **campana de notificaciones**. Solo el Encargado SGC vive dentro
> del módulo.

Un SGC que exige que 13 personas aprendan un sistema nuevo se abandona. Uno que les
llega a su bandeja de siempre, se cumple.

| Rol | Qué ve y hace | Dónde lo ve |
|---|---|---|
| **Encargado SGC**<br>*(superadministrador)* | Todo: crea/edita/controla documentos, gestiona auditorías, registra NC, recibe quejas, monitorea indicadores. Pantalla de inicio: **"Requiere mi atención"** (NC vencidas, documentos por revisar, acuses pendientes, auditorías próximas). | Módulo Calidad completo |
| **Director** | Dashboard de los 6 objetivos; **aprueba** documentos maestros (DOC) y descriptores; ejecuta la revisión por la dirección; alertas críticas (proveedor ≤5.0, queja >25 días). Lectura en todo lo demás. | Dashboard + bandeja de aprobación |
| **Gerente Adm. y Finanzas** | **Aprueba** procedimientos (PRO) y evaluaciones de proveedores; supervisa su personal (Contabilidad/RRHH/Administración); participa en la revisión por la dirección. | Calidad (parcial) + su equipo |
| **Enc. Administración** | **Revisa** documentos antes de aprobación (es el revisor del flujo PRO-01). Bandeja: "documentos esperando mi revisión". | Bandeja de revisión |
| **Jefatura de área** | **Solo su gente:** evaluaciones de competencia pendientes de su equipo, horas de capacitación de sus personas, evidencia de servicios de su área. | Su equipo (acotado por `JEFATURAS`) |
| **Personal operativo**<br>*(6 personas)* | **Únicamente:** mi ficha (mi descriptor, mi inducción, mis capacitaciones, mi última evaluación), documentos que debo acusar, y mis acciones correctivas. Nada más. | **"Mi trabajo" + "Novedades"** — casi nunca entra a Calidad |
| **Auditor externo** | Solo lectura de todo, **con expiración automática**. Más el "modo auditoría" por cláusula (§L2). | Vista de auditoría temporal |

---

## F. Mejoras que propongo (como arquitecto/PM)

Cada una con problema → cómo → impacto → fase.

1. **Matriz de cobertura ISO 9001** *(no está en la especificación — es la de mayor valor)*
   *Problema:* están en proceso de certificación y hoy nadie puede responder con datos
   *"¿estamos listos para la auditoría?"*.
   *Cómo:* una matriz cláusula ISO (4 a 10) → dónde vive su evidencia en el sistema →
   estado (completo / parcial / faltante).
   *Impacto:* convierte el módulo en un **tablero de preparación para la certificación**,
   no solo en un archivador. Responde la pregunta que de verdad les importa este año.
   *Fase 6.*

2. **"Modo auditoría"**
   *Problema:* durante la auditoría, buscar evidencia dispersa cuesta horas y da mala imagen.
   *Cómo:* un botón que arma el paquete de evidencia de una cláusula (documentos vigentes
   + registros + fechas + responsables) y lo exporta a PDF.
   *Impacto:* el auditor pide "muéstreme 7.2 competencia" → un clic. *Fase 6.*

3. **Acciones correctivas = Actividades** (decisión central nº1). *Impacto:* cero motor de
   tareas paralelo; el responsable las ve en "Mi trabajo". *Fase 3.*

4. **Distribución documental = Novedad automática con acuse** (decisión central nº2).
   *Impacto:* evidencia de §7.5.3 sin construir nada nuevo. *Fase 1.*

5. **Un solo correo diario agrupado** en vez de 14 alertas sueltas. *Impacto:* el personal
   no filtra los correos del SGC. *Transversal.*

6. **Alertas escalonadas con dueño real.** *Problema:* la especificación avisa al
   responsable "al día 8" — si esa persona no actúa, la alerta muere ahí.
   *Cómo:* día 8 → responsable + Enc. SGC; día 12 → + Director. *Impacto:* ninguna NC se
   pierde en silencio. *Fase 3.*

7. **Encuesta de satisfacción como formulario público.** *Problema:* el indicador 1 depende
   de encuestas "cargadas en el sistema" — o sea, carga manual que nadie sostiene.
   *Cómo:* formulario público (la infraestructura de intake anónimo **ya existe**) → el
   indicador se calcula solo. *Fase 4.*

8. **Indicador 3 (cumplimiento de plazos) alimentado por evidencia de servicios**, no por
   carga manual. *Fase 7.*

9. **No pre-cargar los 41 procesos × clientes** (ver §C2). *Fase 7.*

10. **Personal desvinculado:** la especificación lo pide bien (no eliminar). SIGSO **nunca
    borra filas** — usa `activo=false`. Ya alineado, sin trabajo extra.

---

## G. Roadmap por fases — ordenado por valor de certificación

> El orden **no** sigue la numeración de los módulos de la especificación. Sigue: (a) qué
> revisa más duro la auditoría de certificación, (b) qué desbloquea a los demás, (c) el
> riesgo al final.

| Fase | Contenido | Por qué en este orden |
|---|---|---|
| **F1 — Núcleo documental**<br>*(Módulo 1 + parte del 10)* | `SGC_DOCUMENTOS` + versiones + obsolescencia + listado maestro + alerta a 12 meses + distribución con acuse vía Novedades | **Todo lo demás referencia documentos.** Sin esto no hay SGC. Y es lo primero que pide el auditor. |
| **F2 — Personas y competencias**<br>*(Módulo 2)* | Ficha, descriptor versionado, inducción, evaluación 12 meses, capacitaciones + horas/año | Extiende `USUARIOS`/`JEFATURAS` que ya existen. Alimenta el **Indicador 4**. |
| **F3 — Motor de mejora**<br>*(Módulos 6 + 3)* | NC/AC (**reutilizando `ACTIVIDADES`**) + auditoría interna que las origina | Es el **corazón del ciclo de mejora**: lo que el auditor revisa con más profundidad (§10.2). |
| **F4 — Voz del cliente**<br>*(Módulo 7)* | Quejas con recepción pública (reutiliza intake) + encuesta de satisfacción | Alimenta **Indicadores 1 y 2**. Reutiliza mucho: es casi el flujo que SIGSO ya hace. |
| **F5 — Gobierno**<br>*(Módulos 4 + 5)* | Proveedores + revisión por la dirección | La revisión **se pre-llena con los datos de F1–F4** — por eso va después, no antes. |
| **F6 — Visión ejecutiva**<br>*(Módulo 9 + mejoras 1 y 2)* | Dashboard de los 6 objetivos + **Matriz de cobertura ISO** + "Modo auditoría" | Cuando ya hay datos reales que mostrar. |
| **F7 — Evidencia de servicios**<br>*(Módulo 8)* | Matriz cliente × proceso × período | **Al final**, con volúmenes reales medidos y la estrategia de escala decidida (§C2). |

**El Módulo 10 (Comunicación) no es una fase:** es transversal, se implementa dentro de
cada una (cada fase agrega sus vencimientos al motor único de las 09:00).

### Dimensionamiento honesto

Como referencia comparable: el **módulo Proyectos completo** (contenedor, sala, tareas,
hitos, entregables, riesgos, dashboard) tomó 5 fases de trabajo. **El módulo SGC es
aproximadamente el doble** — son 10 submódulos con reglas de negocio propias — pero
apoyado en ~55% de maquinería ya construida y probada (780 tests verdes hoy).

**Sugerencia de estrategia según su fecha de auditoría:** si la certificación es en ≤4
meses, **F1 + F3 son obligatorias** (documentos + NC/acciones correctivas: es lo que
constituye "sistema de gestión" a ojos del auditor); F2 y F5 son muy recomendables; F4,
F6 y F7 pueden ir después de la certificación sin poner en riesgo el resultado.

---

## H. Preguntas que necesito responder antes de la Fase 1

1. **¿Fecha objetivo de la auditoría de certificación?** → define el orden y el recorte de fases.
2. **¿Cuántos clientes activos y cuántos servicios al mes?** → define la estrategia del Módulo 8 (§C2), el mayor riesgo técnico.
3. **¿Los 6 externos ya tienen cuenta de portal en SIGSO,** o hay que crearlas?
4. **¿Cuánto espacio libre hay en el Drive** de la cuenta que usa SIGSO? (15 GB compartidos con Gmail).
5. **¿La carpeta compartida actual se mantiene en paralelo** durante la transición, o se migra todo de una vez? (Recomiendo paralelo durante F1, con el sistema como fuente de verdad).
6. **¿Los 21 documentos ya aprobados** (DOC-01…13, PRO-01…07, PRO-10) se cargan con su historial de versiones, o parten todos en v01 vigente?

---

## I. Principios respetados

1. **No duplicar** — acciones correctivas = `ACTIVIDADES`; distribución = Novedades; identidad = `CUENTAS_PORTAL`; PDF, notificaciones, días hábiles y auditoría = reuso directo.
2. **No romper lo que está en producción** — todo aditivo; no se tocan los roles globales ni los módulos existentes; 780 tests deben seguir verdes.
3. **Respetar las restricciones reales** — cero triggers nuevos (20/20), 6 min por ejecución, cuota de Drive.
4. **Simplicidad para el trabajador** — el 70% del personal no entra al módulo: recibe lo suyo en "Mi trabajo" y "Novedades".
5. **Trazabilidad** — nunca se borra una fila; historial por entidad + `LOG_SISTEMA`.
6. **Honestidad técnica** — se dice explícitamente qué no es viable a costo $0 (firma criptográfica) y qué se ofrece en su lugar.
7. **Sin sobre-ingeniería** — el Módulo 8 se difiere hasta conocer volúmenes reales, en vez de construir a ciegas la parte más pesada.

---

## Recomendación

**Aprobar el arranque por la Fase 1 (Núcleo documental)** con las dos decisiones
centrales del §0, y responder las 6 preguntas del §H — en particular la fecha de
auditoría y el volumen de servicios, que son las que pueden cambiar el plan.

Es la ruta que entrega, primero, aquello sobre lo que se apoya todo el resto del SGC y
que la auditoría revisa antes que nada; apoyándose en un motor ya probado en
producción; sin romper nada; y sin gastar el presupuesto de triggers.

**A la espera de aprobación antes de escribir código de implementación.**
