# SIGSO v2.1 — Compromiso de fechas y Panel de Control de Gerencia

> Especificación funcional. Estado: **propuesta cerrada, lista para desarrollo.**
> No sustituye el flujo v2.0; lo extiende de forma aditiva (mismo patrón de los Sprints 1–4).
> Escrita como equipo: Product Owner + Business Analyst + Software Architect + UX Designer.

---

## 0. Resumen ejecutivo

SIGSO hoy mide un **SLA automático por prioridad** (P1: 2h, P2: 24h…) pero **no existe un
compromiso de fecha explícito y negociado** entre quien pide y quien desarrolla. Esta versión
agrega ese compromiso y un **panel de control para Gerencia** enfocado en plazos y accountability.

La idea original (indicada por el cliente) se valida y se refina con **un concepto central**:
distinguir **dos promesas** (SLA de política vs. fecha comprometida) y **dos relojes de
responsabilidad** (el desarrollador entrega / el solicitante valida). Sin esa distinción, el panel
"mentiría": culparía al desarrollador por solicitudes que ya entregó y que el solicitante no ha
probado — que es justo el caso que motivó este requerimiento.

**Decisiones de diseño cerradas con el cliente:**
1. La **fecha comprometida se fija por ítem** (subsolicitud). El solicitante propone **una sola
   fecha por solicitud**; el desarrollador la desglosa/ajusta por ítem al comprometerse.
2. **Dos relojes separados**: el del desarrollador se detiene al entregar ("Terminada"); el del
   solicitante empieza ahí y se detiene al cerrar. El atraso se atribuye a quien lo tiene detenido.
3. La **fecha propuesta del solicitante es opcional** para solicitudes normales; **obligatoria
   (fecha + hora)** para solicitudes de cliente / P1.

---

## 1. Actores y perfiles (delimitación, requisito del cliente)

| Perfil | Rol interno | Superficie | Qué hace con las fechas |
|---|---|---|---|
| **Solicitante** | (público, sin login; identidad por correo) | Formulario + Consultar Estado | **Propone** fecha (y hora si es cliente/P1). Ve la fecha **comprometida** por el desarrollador. Valida/cierra. |
| **Desarrollador / Gestor** (Leo) | `ANA` / `DEV` | Backoffice (`app.html`) | Ve la propuesta; **confirma o fija** la fecha comprometida por ítem; **re-compromete con motivo**; marca "Terminada". |
| **Administrador** | `ADM` | Administración (`admin.html`) | Sin cambio de flujo. *(Opcional futuro: configurar plazos por defecto por tipo.)* |
| **Gerencia / Jefaturas** | `GERENCIA` | 🆕 **Panel de Control** (nuevo) | Solo lectura. Ve cumplimiento, carta Gantt, semáforos; controla a **ambos** lados; hace drill-down. |

> El rol `GERENCIA` ya existe (Sprint 2) con acceso de solo-lectura al detalle operativo. Este panel
> nuevo pasa a ser **su vista principal**; desde él baja al detalle que ya puede ver.

---

## 2. Concepto central: dos promesas, dos relojes

### 2.1 Dos promesas
| | Qué es | Quién la fija | Para qué sirve |
|---|---|---|---|
| **SLA** (ya existe) | Objetivo automático por prioridad | El sistema | Alerta temprana automática (correo al 80% / vencido). Red de seguridad. |
| **Fecha comprometida** (nuevo) | Promesa concreta del desarrollador para *esta* solicitud | El desarrollador | Promesa humana. **Es lo que mide Gerencia.** |

**Jerarquía (evita el "doble deadline" confuso):** cuando existe fecha comprometida, esa es la
**oficial** para el solicitante y para Gerencia (% de cumplimiento). El SLA queda como alerta
automática de fondo, útil sobre todo mientras aún no hay compromiso fijado (p. ej. un P1 recién
entrado). Para trabajo planificado (Desarrollo, Nuevo Módulo — que hoy no tiene SLA útil, P5),
la fecha comprometida **es** el plazo.

### 2.2 Dos relojes de responsabilidad
- 🧑‍💻 **Reloj del desarrollador**: corre desde que se compromete → **se detiene al marcar
  "Terminada" (S08)**. Mide *"¿entregó a tiempo?"*
- 🙋 **Reloj del solicitante**: empieza cuando el desarrollador entrega (S08) → **se detiene al
  cerrar (S09)**. Mide *"¿el solicitante está probando lo que le entregan?"*

Con esto, un ítem que pasó su fecha comprometida pero **ya está en "Terminada"** NO se cuenta como
atraso del desarrollador: se clasifica como *"esperando validación del solicitante"*. Así se
controla a los dos lados de forma justa (requisito explícito del cliente).

---

## 3. Flujo end-to-end

```
SOLICITANTE                          DESARROLLADOR (Leo)                GERENCIA
1. Crea solicitud
   + "¿para cuándo la
      necesitas?" (propuesta)  ─►    2. Revisa. Al APROBAR (S04):
                                        confirma la propuesta
                                        o fija NUEVA fecha (con motivo)
                                        = COMPROMETIDA, por ítem     ─►  ve el compromiso
   3. aviso "Leo se                                                      y el reloj corriendo
      comprometió para X"      ◄─
                                     4. desarrolla…
                                        (si mueve la fecha:
                                         RE-COMPROMETE con motivo)    ─►  ve el "resbalón"
                                                                         (X → Y, +N días, ×M veces)
   5. aviso "Terminada,        ◄─    6. marca "Terminada" (S08)
      lista para validar"             [reloj de Leo SE DETIENE]      ─►  Leo: ✅ a tiempo / ❌ tarde
   7. prueba y CIERRA (S09)    ─►                                    ─►  Solicitante: ⏱ N días
      o reabre                                                          esperando validación
```

**Reglas del flujo:**
- La fecha del solicitante es **solo una propuesta** (dato de negocio "para cuándo la necesito").
  No es vinculante.
- **La fecha comprometida la fija el desarrollador y es la definitiva.** Se fija/confirma **al
  aprobar (S04)** — se integra al paso que ya existe, **no se agrega un estado nuevo** a la máquina.
- **Re-comprometer exige un motivo** (igual que hoy cambiar la prioridad exige justificación ≥ 20
  caracteres). El motivo es la evidencia que Gerencia necesita.
- **Sin nuevos estados**: solo campos nuevos + una acción "comprometer/ajustar fecha".

---

## 4. Caso especial: solicitud de cliente / P1 (la hora importa)

- El solicitante propone **fecha + hora** (obligatorio en cliente/P1; para el resto, solo fecha
  opcional).
- El desarrollador confirma o ajusta la **hora comprometida** exacta (puede tener horas/minutos).
- En el Panel de Gerencia, los P1/cliente **no van en la carta Gantt de varios días** (ilegible a
  esa escala): van en una **franja separada "Urgentes de hoy"** con escala por horas y cuenta
  regresiva.
- Técnicamente se guarda siempre una fecha-hora completa. Para no-urgentes, la hora se rellena sola
  (fin de jornada, 18:00) y no se pide.

---

## 5. Modelo de datos (aditivo)

Nada se reordena ni se borra; solo columnas al final + una hoja de historial (mismo patrón que
`es_urgente` o `HISTORIAL_PRIORIDAD`).

**`SUBSOLICITUDES`** (por ítem, coherente con toda la arquitectura):
| Columna | Contenido |
|---|---|
| `fecha_propuesta` | Fecha-hora propuesta por el solicitante (a nivel solicitud, replicada como default en cada ítem) |
| `fecha_comprometida` | Fecha-hora definitiva fijada por el desarrollador |
| `fecha_terminada` | Momento en que se marcó "Terminada" (S08) — detiene el reloj del desarrollador |
| `comprometida_por` | Correo de quien se comprometió |

**Nueva hoja `HISTORIAL_COMPROMISO`** (para ver los "resbalones" / línea base):
`historial_id, subsolicitud_id, solicitud_id, fecha_anterior, fecha_nueva, motivo, usuario, timestamp`

- La **fecha comprometida de la solicitud** (rollup) = la más lejana entre sus ítems activos.
- La **fecha original** (línea base) = la primera fila de `HISTORIAL_COMPROMISO` de ese ítem; si no
  hubo re-compromiso, es igual a `fecha_comprometida`.
- Reutilizables sin datos nuevos: el momento de entrada a "Terminada" ya vive en
  `HISTORIAL_ESTADOS`; el tiempo esperando validación ya se calcula para el cierre automático (5
  días hábiles). El motor de **horas hábiles** (feriados/jornada/DST) ya existe y se reutiliza.

---

## 6. Clasificación de cumplimiento (semáforo)

No son estados nuevos de la máquina; se **derivan** de las fechas y los dos relojes:

| | Estado de cumplimiento | Definición |
|---|---|---|
| 🟢 | **En plazo** | Activa, dentro de la fecha comprometida |
| 🟡 | **En riesgo** | Se acerca la fecha comprometida (< 1 día hábil) y aún no está en pruebas/terminada |
| 🔴 | **Atrasada — Desarrollador** | Pasó la fecha comprometida y **aún no se entrega** (< S08) |
| 🔵 | **Esperando validación — Solicitante** | Ya entregada (S08); el solicitante no ha cerrado (+ días esperando) |
| ⚪ | **Sin compromiso** | Aún no revisada/aprobada; no tiene fecha comprometida (control: cola sin comprometer) |
| ✅ / ❌ | **Cerrada a tiempo / con atraso** | Histórico, para las métricas |

Esta taxonomía es el corazón del "dashboard bien clasificado".

---

## 7. Panel de Control de Gerencia (diseño)

Pantalla nueva y dedicada para el perfil `GERENCIA`. Cuatro bloques + drill-down.

### A) Banda de KPIs (de un vistazo)
- **% cumplimiento del desarrollador** (entregadas a tiempo ÷ entregadas)
- **Atrasadas activas** (🔴)
- **Esperando validación** (🔵) + promedio de días
- **Atraso promedio** (días)
- **Sin comprometer** (cola que el desarrollador aún no revisó)

### B) Semáforo / filtros
Tarjetas por categoría (§6) con conteo; filtros por **desarrollador**, empresa, tipo, solicitante,
período.

### C) Carta Gantt / línea de tiempo
- Fila = solicitud (o ítem). Barra horizontal desde el compromiso hasta la fecha comprometida.
  Línea vertical de **"HOY"**. Color = semáforo.
- Si está atrasada, la barra **se extiende en rojo** hasta hoy (el atraso se ve crecer).
- Si hubo re-compromiso, se marca la **fecha original** con una línea tenue → el resbalón es visible.
- Ordenable/filtrable por desarrollador, empresa, tipo, solicitante, período.
- **Técnicamente liviano**: barras posicionadas por CSS o barras flotantes de Chart.js (ya en uso),
  **sin** librería Gantt pesada. Los P1/cliente del día van en franja aparte por horas.

### D) Panel "Control del solicitante"
Lista de lo **entregado y no validado** (S08 pendientes de S09), con días esperando y quién debe
probar. Expone el caso "el desarrollador la terminó pero el solicitante nunca la prueba".

### Drill-down (detalle)
Clic en una solicitud → su **línea de tiempo de fechas**: propuesta → comprometida →
(re-compromisos con motivo) → terminada → cerrada, con cada tramo de atraso evidenciado y atribuido
a quién corresponde (desarrollador vs solicitante).

---

## 8. Notificaciones que armonizan con lo existente

Reutilizan la cola de correo y el patrón de dedup ya construidos:
- Aviso al **solicitante** cuando el desarrollador se compromete a una fecha (sobre todo si difiere
  de la propuesta): maneja expectativas, sin pedir su aprobación (la fecha del desarrollador es la
  final).
- Alerta **"en riesgo"** (🟡) al desarrollador/gerencia antes de vencer la fecha comprometida —
  análoga a la alerta de SLA al 80%.
- Recordatorio al **solicitante** cuando algo lleva días en "Terminada" sin validar (antes de que
  actúe el cierre automático de 5 días hábiles).

---

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Doble deadline confuso (SLA vs comprometida) | Jerarquía clara: la comprometida es la oficial; el SLA queda como alerta de fondo (§2.1). |
| Fricción en el formulario rápido | Fecha propuesta **opcional** y única (no bloquea modo Rápido); si va vacía, el desarrollador la fija al aprobar. |
| El desarrollador empuja fechas para "siempre estar a tiempo" | Línea base + conteo de re-compromisos hace visible el resbalón (§5, §7C). |
| "Gaming" del solicitante (todos ponen "hoy") | Se pregunta *"¿para cuándo la necesitas?"* (dato legítimo), no *"cuándo debería estar lista"*. |
| Gantt pesado en el stack (vanilla JS + Apps Script) | Timeline liviano CSS/Chart.js; urgentes del día en franja por horas. |
| Sobre-construir (viola "simple pero útil") | Se justifica: es el requisito #1 de Gerencia; no agrega estados ni menús interminables. Extiende P6 del roadmap v2.0. |

---

## 10. Plan de implementación por fases (sin código aún)

- **Fase A — Captura del compromiso**: columnas nuevas + `HISTORIAL_COMPROMISO`; campo de fecha en
  el formulario (opcional; obligatorio con hora para cliente/P1); acción "comprometer/ajustar
  fecha" por ítem en el Backoffice, integrada a la aprobación (S04); motivo obligatorio al
  re-comprometer.
- **Fase B — Dos relojes + semáforo**: cálculo derivado de cumplimiento (desarrollador vs
  solicitante) reutilizando el motor de horas hábiles; exponer en el detalle del Backoffice.
- **Fase C — Panel de Gerencia**: KPIs + carta Gantt + panel "control del solicitante" + drill-down.
- **Fase D — Avisos**: compromiso notificado al solicitante; alerta "en riesgo"; recordatorio de
  validación pendiente.

Cada fase es desplegable sola y no rompe lo existente (patrón aditivo de los Sprints 1–4).

---

## 11. Coherencia con el flujo v2.0 — veredicto del arquitecto

La v2.1 **no toca la máquina de estados** (S01–S11) ni el modelo de cierre por el solicitante
(RN-201): lo **complementa**. Agrega una capa de *compromiso y accountability* sobre el ciclo que ya
funciona. Respeta el principio rector del proyecto ("simple pero extremadamente útil"): no hay
módulos nuevos que engorden el menú, solo un dato negociado (la fecha) y una vista de control que
lee ese dato. Es la evolución natural del rol Gerencia (P6) hacia el control de plazos que el
cliente pidió explícitamente.
