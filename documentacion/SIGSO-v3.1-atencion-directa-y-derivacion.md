# SIGSO v3.1 — Atención directa y derivación entre responsables

Dos capacidades nuevas, ambas **aditivas** (no reordenan columnas ni cambian flujos
existentes), siguiendo el mismo criterio que `cc`, `urls_adicionales`, `CAT_AREAS` y
`CAT_CLIENTES` en versiones previas.

- **§1 Atención directa** — registrar una solicitud que **ya fue resuelta**, sin recorrer
  el flujo completo de estados.
- **§2 Derivación** — pasar una solicitud (o un ítem) de un responsable a otro, con
  registro y aviso.

Origen: petición de Felipe (jefatura RLD) para bugs/urgencias que se resuelven por
teléfono con el desarrollador, y necesidad operativa de sacar de `control_luis` (buzón de
la fase de pruebas) lo que corresponde a Leo.

---

## §1 — Atención directa ("ya está resuelto")

### 1.1 Problema

Cuando algo urgente se cae, la operación real es: llaman al desarrollador, se arregla en
el momento, y *después* hay que dejar registro. Obligar al flujo
`S01 → S02 → S03 → S04 → S05 → S08 → S09` para algo ya hecho es fricción pura, y el
resultado observado es que **no se registra nada**. El objetivo no es saltarse el control:
es que el registro exista.

> "no es necesario todo el flujo para ese en particular, pero sí importante que quede
> registro"

### 1.2 Alcance (decidido)

- **Todas las empresas** (RLD, GDE, HomePymes). Las jefaturas son quienes usan el sistema.
- **Estado final: S09 Cerrada.**
  Razón: S08 "Terminada" significa *"listo, falta que el solicitante valide"* — dejaría una
  tarea de validación pendiente para la misma persona que acaba de declarar que está
  resuelto. S09 refleja la verdad: no queda nada pendiente.

### 1.3 Dos puntos de entrada

**1A. Al ingresar** (formulario público) — el caso principal: la solicitud nunca existió en
el sistema, se resolvió por fuera y se registra a posteriori.

**1B. Desde "Mis solicitudes"** — caso distinto: la solicitud **ya está** en el sistema, en
un estado intermedio, y se terminó resolviendo por teléfono. Hoy `validarCierre` solo
permite cerrar desde S08; se extiende para permitir cierre directo desde cualquier estado
abierto.

Ambos comparten el mismo registro y la misma marca.

### 1.4 Datos capturados (el registro propiamente tal)

Tres campos **obligatorios** cuando se activa el modo. Sin ellos el registro no sirve, así
que no son opcionales:

| Campo | Por qué |
|---|---|
| `atencion_resuelto_por` | Quién atendió (típicamente Leo). Es el dato que hoy se pierde. |
| `atencion_fecha_resolucion` | Cuándo se resolvió de verdad — puede ser anterior al registro. |
| `atencion_detalle` | Qué se hizo. Es la memoria técnica del incidente. |

### 1.5 Esquema (aditivo)

**`SOLICITUDES`** — 1 columna nueva al final:
- `atencion_directa` — `TRUE` / `''`.

**`SUBSOLICITUDES`** — 3 columnas nuevas al final:
- `atencion_resuelto_por`, `atencion_fecha_resolucion`, `atencion_detalle`.

Van a nivel de ítem porque el detalle de la solución es por ítem, igual que
`fecha_terminada`. La marca `atencion_directa` va a nivel solicitud porque es lo que
filtran Gerencia y el Dashboard.

Registrar en las **3 copias** del esquema (`backend/intake/Constantes.gs`,
`backend/backoffice/Constantes.gs`, `backend/setup/Instalador.gs`) — `schema-consistency.test.js`
valida que no diverjan — y documentar en `database/schema.md`.

### 1.6 Por qué la marca `atencion_directa` no es cosmética

Es **integridad de métricas**. Una solicitud creada y cerrada en el mismo instante:

- tiene tiempo de resolución ≈ 0 → **baja artificialmente** el KPI de tiempo promedio;
- nunca tuvo `fecha_comprometida` → no puede evaluarse en el semáforo de cumplimiento;
- no pasó por revisión ni aprobación → no es comparable con el resto del flujo.

Con la marca, `Gerencia.getPanel` y `Dashboard.getData` las **excluyen del cálculo de SLA y
cumplimiento** y las reportan aparte ("atenciones directas del período"), que además es un
dato de gestión valioso por sí mismo: cuántas urgencias se están resolviendo fuera del
proceso.

En el detalle (Backoffice) se muestra una insignia clara:
**"⚡ Atención directa — registrada después de resolver"**.

### 1.7 Historial: honesto, no fabricado

Se escribe **una sola entrada** en `HISTORIAL_ESTADOS`:

```
estado_anterior: ''
estado_nuevo:    'S09'
comentario:      'Atención directa: resuelto por <quién> el <fecha>. <detalle>'
usuario:         <correo de quien registra>
```

**No se fabrica** la cadena S01→S02→…→S09. Inventar transiciones que nunca ocurrieron
haría inservible el historial como fuente de verdad y contaminaría cualquier análisis
posterior de tiempos por estado.

### 1.8 Notificaciones

Punto crítico y fácil de pasar por alto: hoy `crearSolicitud` avisa al responsable
*"tienes una solicitud nueva"*. Para una atención directa **eso sería incorrecto** — Leo
recibiría un aviso de algo que él mismo acaba de arreglar.

- Al responsable: correo distinto, tipo **acuse** — *"se registró una atención directa que
  resolviste"*, sin llamado a la acción.
- Al solicitante: acuse de registro normal, indicando que queda cerrada.
- **No** se dispara la alerta P1 aunque el tipo sea urgente: no hay nada que atender.

### 1.9 Resguardos

- Los 3 campos son obligatorios (validación en backend, no solo en el formulario).
- La marca es **visible** en Dashboard, detalle y export CSV — no es un atajo silencioso.
- `atencion_fecha_resolucion` no puede ser futura.
- El cierre queda atribuido al correo de quien registra (trazable en `HISTORIAL_ESTADOS`).

### 1.10 Cambios previstos

**Backend Intake**
- `Solicitudes.crearSolicitud` — acepta el bloque `atencion_directa`; si viene, crea
  ítems en S09, `estado_derivado = S09`, escribe la entrada de historial y llama a la
  notificación de acuse en vez de la de asignación.
- `Solicitudes.validarCierre` — nueva acción `cerrar_directo`, permitida desde cualquier
  estado abierto (hoy solo `confirmar`/`reabrir` desde S08), con los mismos campos.
- `Notificaciones.gs` — plantilla de acuse de atención directa.

**Backend Backoffice**
- `Dashboard.gs` / `Gerencia.gs` — excluir `atencion_directa` de SLA y cumplimiento;
  contarlas aparte.
- `Solicitudes.getDetalle` — devolver los campos de atención directa.

**Frontend**
- `index.html` + `formulario.js` — interruptor "Esta solicitud ya fue resuelta" con los 3
  campos condicionales; ajuste del paso de revisión.
- `estado.js` — botón "Ya está resuelto — cerrar" en Mis solicitudes.
- `detalle.js` — insignia de atención directa.

---

## §2 — Derivación entre responsables

### 2.1 Situación actual

`asignarResponsables_()` (backend/backoffice/Solicitudes.gs:478) **ya reasigna**
`desarrollador_asignado`, a nivel de solicitud o de ítem. Pero:

| Falta | Consecuencia |
|---|---|
| UI | Nadie puede usarlo desde la aplicación. |
| Acción propia en el router | Está escondido dentro de `actualizarPrioridad` — semánticamente equivocado y difícil de encontrar. |
| Historial | Una reasignación no deja rastro: no se sabe quién la hizo, cuándo ni por qué. |
| Aviso | El nuevo responsable no se entera; el trabajo se pierde. |

O sea: la mitad mecánica existe; **falta justo lo que la hace confiable**.

### 2.2 Diseño

**Acción propia `derivarSolicitud`** en `BACKOFFICE_ACTIONS`, extraída de
`actualizarPrioridad`. `asignarResponsables_` se conserva como implementación interna
(compatibilidad hacia atrás con quien ya llame por el camino viejo).

**Dos niveles**, coherentes con que los ítems ya pueden trabajarse en paralelo por
distintas personas (§7.3 / §13.3):
- **solicitud completa** → reasigna todos sus ítems;
- **ítem puntual** → reasigna solo ese `subsolicitud_id`.

**Motivo obligatorio** (mínimo 10 caracteres), como en `actualizarPrioridad` (RN-007).

### 2.3 Trazabilidad — hoja `HISTORIAL_ASIGNACION`

Sigue exactamente el patrón de `HISTORIAL_PRIORIDAD` y `HISTORIAL_COMPROMISO`, así que no
inventa convenciones nuevas:

```
historial_id, subsolicitud_id, solicitud_id,
responsable_anterior, responsable_nuevo, motivo, usuario, timestamp
```

Se muestra en la línea de tiempo del detalle, junto a los cambios de estado, prioridad y
compromiso.

### 2.4 Permisos

| Rol | Puede derivar |
|---|---|
| ADM | Cualquier solicitud o ítem |
| ANA | Cualquier solicitud o ítem (es el dueño del flujo) |
| DEV | **Solo lo asignado a sí mismo** (traspasar su propio trabajo) |
| GERENCIA | No (rol de solo lectura) |

Reasignar al **Analista** responsable sigue siendo exclusivo de ADM, como hoy.

### 2.5 Notificaciones

- **Nuevo responsable**: *"Te derivaron la solicitud SOL-…"* con el motivo, quién derivó y
  el enlace al detalle. Sin esto la derivación es invisible.
- **Responsable anterior**: acuse de que salió de su bandeja.
- Respeta el gate global de notificaciones ya existente (`CONFIG_NOTIFICACIONES`).

### 2.6 UI

**Detalle** (`detalle.js`) — control **"Derivar"** en el panel de acciones del ítem, junto a
fecha/estado/prioridad: selector de persona + motivo. La lista de destinatarios sale de
`obtenerResponsablesActivos_()`, **que ya existe** en `Dashboard.gs` y devuelve los DEV/ANA
activos; se expone también en `getDetalle`.

**Dashboard** — **derivación en lote**: con una bandeja filtrada (p. ej. `control_luis`),
botón *"Derivar todas a…"*. Necesario para la migración a Leo: hacerlo de a una para
decenas de solicitudes es inviable. Pide confirmación explícita mostrando **cuántas**
solicitudes se van a mover y a quién, y escribe una entrada de historial **por cada una**
(sin excepción — un lote no es motivo para perder trazabilidad). El aviso al nuevo
responsable se manda **agrupado** (un correo con N solicitudes), no N correos.

### 2.7 Nota de diseño: `area` no se toca

`area` / `area_nombre` registran **de dónde vino** el ruteo original;
`desarrollador_asignado` es **quién lo trabaja ahora**. No se sincronizan: si al derivar se
sobrescribiera el área, se perdería el dato de origen y el ruteo automático de futuras
solicitudes quedaría distorsionado.

### 2.8 Cambios previstos

**Backend Backoffice**
- `Constantes.gs` — `HISTORIAL_ASIGNACION` (hoja + columnas).
- `Solicitudes.gs` — `derivarSolicitud` (individual y en lote), historial, validación de
  permisos por rol.
- `Code.gs` — acción `derivarSolicitud` en el router.
- `Notificaciones.gs` — plantillas de derivación (individual y agrupada).
- `Solicitudes.getDetalle` — incluir `historial_asignacion` y `responsables` disponibles.

**Backend Setup**
- `Instalador.gs` — crear `HISTORIAL_ASIGNACION`.

**Frontend**
- `detalle.js` + CSS — control de derivación y timeline de asignación.
- `dashboard.js` — derivación en lote sobre la bandeja filtrada.

---

## §3 — Compatibilidad y riesgos

- **Todo aditivo**: una instalación sin las columnas ni la hoja nuevas sigue funcionando
  (los campos se leen como `''`; `HISTORIAL_ASIGNACION` ausente se trata como vacío). La
  lectura por nombre de encabezado (`leerHojaConEncabezados_`) hace esto seguro.
- **Riesgo principal — métricas**: si `atencion_directa` no se excluyera de SLA y
  cumplimiento, los KPIs de Gerencia quedarían distorsionados. Es la razón de ser de la
  marca y debe cubrirse con test.
- **Riesgo — derivación en lote**: es la operación más destructiva de las dos. Mitigación:
  confirmación con conteo explícito, historial por solicitud, y sin borrar nada
  (`desarrollador_asignado` se sobrescribe pero queda el anterior en el historial).
- **Notificaciones**: el error más probable es avisar "solicitud nueva" en una atención
  directa. Debe cubrirse con test explícito.

## §4 — Verificación prevista

1. `npm test` — incluye `schema-consistency` (3 copias) y tests nuevos:
   atención directa crea en S09 con 1 sola entrada de historial; los 3 campos son
   obligatorios; `atencion_directa` no cuenta en SLA/cumplimiento; no se manda aviso de
   "solicitud nueva"; derivación escribe historial y respeta permisos por rol; DEV no puede
   derivar lo ajeno; lote escribe N entradas de historial.
2. Verificación en navegador con los dev-servers (`config.js` apuntado a localhost y
   **revertido** al terminar).
3. `npm run build:backoffice-html`.
4. Paquete de despliegue en `_deploy-fase10/`, con el recordatorio de agregar a mano las
   columnas nuevas y la hoja `HISTORIAL_ASIGNACION`, y de hacer
   **Implementar → Administrar implementaciones → Versión nueva → Implementar** en cada
   proyecto (guardar el código NO actualiza la web app).
