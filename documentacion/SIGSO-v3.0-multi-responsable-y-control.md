# SIGSO v3.0 — Multi-responsable, bandejas propias y control de Gerencia

> Especificación funcional. Estado: **propuesta cerrada, lista para desarrollo por fases.**
> Extiende v2.0/v2.1 de forma aditiva (mismo patrón de sprints: columnas/hojas nuevas al
> final, nada se reordena ni se borra). Escrita como equipo: Product Owner + Business
> Analyst + Software Architect + UX Designer.

---

## 0. Resumen ejecutivo

Hasta v2.1 SIGSO estaba construido alrededor de **una sola persona**: cada solicitud avisa
a un correo fijo (`lestay@rld.cl`, Leo) y el Backoffice es un único dashboard. La empresa
quedó conforme y ahora quiere **abarcar a más gente**: distintas personas reciben distintas
solicitudes, cada una con su **propia bandeja**, mientras Gerencia controla a todos con un
reporte claro y descargable.

Esto es un salto de versión. Toda la v3.0 se apoya en **una base común**: un **catálogo de
áreas/responsables** parametrizable, un **ruteo** de la solicitud al responsable correcto, y
una **capa de robustez de conexión** que elimina el error "se perdió la conexión con Apps
Script".

**Decisiones de diseño cerradas con el cliente:**
1. **Arranque:** primero esta especificación, luego código por fases desplegables.
2. **Acceso al Backoffice:** **login de Google + filtro "asignadas a mí"** (no códigos
   sueltos). Cada responsable entra con su cuenta y ve solo lo suyo; ADM/Gerencia eligen
   de quién ver. Más seguro y ya medio construido (`vistaDev` en `Dashboard.gs`).
3. **"Mis solicitudes" (Consultar Estado):** verificación por **correo + código de un solo
   uso enviado a ese correo**, antes de listar todas las solicitudes de esa persona.

---

## 1. Actores y perfiles (actualizado)

| Perfil | Rol interno | Superficie | Novedad v3.0 |
|---|---|---|---|
| **Solicitante** | (público, sin login; identidad por correo) | Formulario + Consultar Estado | Elige **a qué área/responsable** va su solicitud. Puede ver **todas** sus solicitudes en una lista tras verificar su correo. |
| **Responsable / Desarrollador** (Leo, Luis, …) | `DEV` (o `ANA`) | Backoffice (`app.html`) | Entra con su cuenta Google y ve **su propia bandeja** (solo las solicitudes ruteadas a él). |
| **Administrador** | `ADM` | Administración (`admin.html`) | Administra el **catálogo de áreas/responsables**. Puede ver la bandeja de cualquiera. |
| **Gerencia / Jefaturas** | `GERENCIA` | Panel de Control | Nuevo **Tablero de seguimiento** (reemplaza la carta Gantt), con doble semáforo y descarga a PDF. |

> El "responsable" es un `USUARIO` activo con rol de Backoffice. No se crea un tipo de
> persona nuevo: se reutiliza la hoja `USUARIOS` y el login por identidad Google que ya
> resuelve el rol (Fase 6/§17). El ruteo solo decide **a quién se le asigna** cada ítem.

---

## 2. Base común (habilita todo lo demás)

### 2.1 Catálogo de áreas → responsable (nuevo, público-seguro)

El formulario público **no puede leer `USUARIOS`** (expondría correos y roles internos). Por
eso el ruteo se hace con un catálogo intermedio, seguro de mostrar:

**Nueva hoja `CAT_AREAS`**: `area_id`, `nombre`, `responsable_email`, `activo`.

- El formulario lista las **áreas activas** por su `nombre` (ej. "Plataformas / sistemas",
  "Contabilidad", "RRHH"…). El solicitante elige **por área/tipo de necesidad, no por
  nombre de persona** — no tiene por qué saber quién es "Luis".
- Al crear la solicitud, el backend resuelve `area → responsable_email` **del lado del
  servidor**: ese correo nunca viaja al navegador público.
- Un área especial **"No estoy seguro"** (o dejar el área vacía) rutea a una **bandeja de
  triage** (un `responsable_email` por defecto, configurable) que un ADM reparte después.

### 2.2 Ruteo de la solicitud

- Se rutea **por ítem** (coherente con tipo/módulo/prioridad, que ya son por ítem), con un
  **área por defecto a nivel solicitud** para no cargar el formulario rápido: si el
  solicitante no cambia el área por ítem, todos heredan la de la solicitud.
- El responsable resuelto se escribe en `SUBSOLICITUDES.desarrollador_asignado` **desde el
  intake** (hoy ese campo queda vacío hasta que alguien asigna a mano en el Backoffice).
  Así el filtro "asignadas a mí" del Backoffice ya funciona sin lógica nueva.
- El **aviso por correo** deja de ir al `EMAIL_DESARROLLO` hardcodeado: va al
  `responsable_email` del área elegida (o a la bandeja de triage). El switch global
  `AVISO_LEO` (P12) se generaliza a "avisar al responsable ruteado".

### 2.3 Robustez de conexión (arregla "se perdió la conexión con Apps Script")

Diagnóstico (tres causas combinadas, confirmadas en el código):
1. **Sin reintento:** una llamada `google.script.run` que falla (timeout/sesión) muestra el
   error seco y no reintenta.
2. **El Panel de Gerencia (`getPanelGerencia`) relee TODAS las hojas en cada llamada sin
   caché** (a diferencia del Dashboard, que sí cachea con TTL 5 min). Al crecer las filas,
   esa llamada se vuelve pesada y falla más.
3. La sesión de HtmlService del Backoffice puede expirar tras inactividad.

Mitigación:
- Capa de **reintentos con backoff + reconexión** en `frontend/js/api.js` (camino
  `google.script.run`): reintenta 2–3 veces con espera creciente; si igual falla, muestra un
  aviso amable **"Reconectando… [Reintentar]"** en vez del error crudo.
- **Cachear `getPanelGerencia`** con el mismo patrón que `Dashboard.getData` (CacheService,
  clave por rol+filtros, TTL corto).
- **Aligerar payloads**: las llamadas de lista devuelven solo los campos que la vista usa;
  el detalle completo se pide al hacer drill-down.

---

## 3. Nueva Solicitud — elegir destinatario

- Nuevo campo **"¿A qué área va dirigida?"** (select poblado desde `CAT_AREAS`), a nivel
  solicitud, con opción de ajustarlo **por ítem** en modo Completo.
- Opción **"No estoy seguro"** → bandeja de triage.
- El resto del formulario (dos velocidades, tipo/módulo por ítem, fecha propuesta de v2.1)
  no cambia.
- **Modelo de datos**: `SUBSOLICITUDES` agrega `area`, `area_nombre` (aditivas al final).
  `desarrollador_asignado` se llena en el intake con el responsable resuelto.

---

## 4. Consultar Estado — "Mis solicitudes"

Se **mantiene** la consulta actual por número + correo (RN-201, validar/cerrar). Se **agrega**
una vista "Mis solicitudes":

- **Verificación**: el solicitante ingresa su correo → recibe un **código de un solo uso**
  por correo (válido unos minutos) → lo ingresa → ve su lista. El código vive en
  `CacheService` (efímero, se auto-expira) — **sin hoja nueva**.
- **Lista filtrable**: todas sus solicitudes, con **chips de estado** y **semáforo**,
  filtrable por **estado** y **fecha**, con **buscador** y un **resumen arriba**
  (ej. "Tenés 3 pendientes de validar, 1 en desarrollo").
- **Drill-down**: clic en una solicitud → su detalle (ítems, estado, fecha comprometida,
  historial), desde donde puede **validar/cerrar** los ítems Terminada (reusa el flujo v2.0).
- **Semáforo del solicitante presente acá también**: cada ítem Terminada sin validar muestra
  "Llevas N días sin revisar esto" — la responsabilidad se le hace visible a él mismo, no
  solo a Gerencia.
- **Interfaz**: layout tipo bandeja (lista a la izquierda / detalle a la derecha o
  acordeón en móvil), navegación clara y completa.

---

## 5. Backoffice — bandeja por responsable

- **Selector de bandeja al entrar** (`Auth.resolverBandeja`):
  - Un responsable individual (`DEV`/`ANA`) entra **directo a su bandeja** (auto-filtro por
    `desarrollador_asignado === su correo`, que ya existe como `vistaDev`).
  - `ADM`/`GERENCIA` ven un **selector "¿Qué bandeja querés ver?"** (todas, o la de una
    persona puntual) antes/encima del dashboard.
- **Refuerzo de acceso**: solo `USUARIOS` activos entran (ya es así); cada responsable ve
  **solo lo suyo**. No hay códigos sueltos: la identidad la da Google y el rol la hoja
  `USUARIOS`. Queda claro quién hizo cada acción (auditoría por email, ya registrada).
- **Modelo de datos**: sin columnas nuevas. Se apoya en `desarrollador_asignado` (por ítem)
  que ahora viene lleno desde el intake (§2.2). Opcional: una columna `area` en `USUARIOS`
  para agrupar bandejas por área en el selector.

---

## 6. Panel de Gerencia — rediseño

### 6.1 Tablero de seguimiento (reemplaza la carta Gantt)

La carta Gantt no se entendió. Se reemplaza por una **tabla de seguimiento** — el formato
que el gerente pidió, legible sin interpretar barras:

| Solicitud | Solicitante | Responsable | Estado | Prioridad | Días abierta | Días con el desarrollador | **Días esperando al solicitante** | Fecha comprometida | Semáforo |

- **Ordenable y agrupable** por solicitante, responsable, estado, empresa, período.
- **Filtros** arriba (los mismos criterios).
- Cada fila lleva su **semáforo de cumplimiento** (v2.1 Fase B) como color/etiqueta.
- Clic en una fila → drill-down al detalle (con el historial de compromiso, v2.1 Fase C).
- La carta Gantt se retira de la vista principal (se puede dejar como pestaña secundaria
  "línea de tiempo" para quien la quiera, pero **el tablero es la vista por defecto**).

### 6.2 Doble semáforo bien separado (desarrollador vs solicitante)

Hoy el semáforo del **solicitante** (días sin validar) existe pero está poco visible. En v3.0
se hace omnipresente:
- **Columna propia** "Días esperando al solicitante" en el tablero.
- **KPI propio** en la banda superior: "Solicitantes en mora" (ítems Terminada sin validar +
  promedio de días) — separado del "% cumplimiento del desarrollador".
- **Su propio corte de semáforo** para el solicitante: 🟢 recién entregado / 🟡 lleva algunos
  días / 🔴 cerca del cierre automático (5 días hábiles) — análogo al del desarrollador pero
  midiendo su reloj (v2.1 Fase B ya separa los dos relojes; acá se les da igual peso visual).

### 6.3 Descarga a PDF

- **Reporte imprimible** del tablero tal como se ve (con filtros aplicados, fecha del
  reporte y los KPIs arriba), pensado para llevar a reunión. Implementación inicial:
  **vista con estilo de impresión + "Descargar/Imprimir PDF"** del navegador (sin archivo en
  servidor, cero dependencias). Se puede evolucionar a PDF generado en servidor (Docs→PDF)
  más adelante si se necesita archivarlo automáticamente.

---

## 7. Modelo de datos (aditivo)

Nada se reordena ni se borra. Resumen de lo nuevo:

**Nueva hoja `CAT_AREAS`** (pública-listable): `area_id`, `nombre`, `responsable_email`,
`activo`.

**`SUBSOLICITUDES`** — columnas nuevas al final: `area`, `area_nombre`.
(`desarrollador_asignado` ya existe; ahora se llena desde el intake con el responsable
resuelto.)

**`USUARIOS`** — opcional: `area` (para agrupar bandejas en el selector de ADM/Gerencia).

**Sin hoja nueva** para: los códigos de un solo uso de "Mis solicitudes" (CacheService
efímero) ni para el tablero/semáforos/PDF de Gerencia (todo derivado, como en v2.1).

**Consistencia**: las tres copias del esquema (`backend/intake/Constantes.gs`,
`backend/backoffice/Constantes.gs`, `backend/setup/Instalador.gs`) se mantienen en sync;
`backend/test/schema-consistency.test.js` lo verifica.

---

## 8. Accesos y permisos (resumen)

| Acción | Quién | Cómo se autentica |
|---|---|---|
| Crear solicitud / elegir área | Solicitante (público) | Sin login; identidad por correo |
| Ver "mis solicitudes" | Solicitante | Correo + código de un solo uso al correo |
| Ver su bandeja | Responsable (`DEV`/`ANA`) | Login Google → rol en `USUARIOS`; auto-filtro por asignación |
| Ver cualquier bandeja | `ADM` / `GERENCIA` | Login Google → selector de bandeja |
| Administrar `CAT_AREAS` | `ADM` | Login Google |
| Tablero + PDF de Gerencia | `GERENCIA` (y `ADM`) | Login Google |

---

## 9. Plan de implementación por fases (sin código aún)

- **Fase 1 — Base multi-responsable + robustez.**
  `CAT_AREAS` (hoja + CRUD en Administración) · selector de área en el formulario · ruteo
  del aviso al responsable (reemplaza el hardcode de Leo) + escritura de
  `desarrollador_asignado` desde el intake · capa de reintentos/reconexión en `api.js` +
  caché de `getPanelGerencia`.
- **Fase 2 — Backoffice multi-bandeja.**
  Selector de bandeja al entrar · auto-scope del responsable individual · ADM/Gerencia
  eligen bandeja · refuerzo de acceso.
- **Fase 3 — Consultar Estado "Mis solicitudes".**
  Verificación por código al correo · listado filtrable por estado/fecha con buscador y
  resumen · drill-down + validar/cerrar · semáforo del solicitante visible.
- **Fase 4 — Panel de Gerencia rediseñado.**
  Tablero de seguimiento (reemplaza Gantt) · doble semáforo (desarrollador + solicitante) en
  columnas y KPIs · descarga a PDF.

Cada fase se despliega sola y no rompe lo existente (patrón aditivo de v2.0/v2.1). Fase 1 es
la base de la que dependen las demás; conviene ir en ese orden.

---

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El formulario expone correos internos | El público lista `CAT_AREAS` (áreas), nunca `USUARIOS`; el correo del responsable se resuelve en el servidor. |
| El solicitante no sabe a qué área mandar | Opción "No estoy seguro" → bandeja de triage que un ADM reparte. |
| Cualquiera lista las solicitudes de otro por su correo | Verificación por código de un solo uso enviado a ese correo. |
| El error de conexión persiste al crecer los datos | Reintentos + caché del Panel de Gerencia + payloads livianos. |
| Gantt ilegible | Se reemplaza por tabla ordenable/filtrable; la Gantt queda opcional, no principal. |
| El solicitante en mora no se controla | Semáforo del solicitante como columna + KPI + corte propio en todo el Panel. |
| Sobre-construir | Se reutiliza identidad Google + `desarrollador_asignado` + los dos relojes de v2.1; el grueso es catálogo + ruteo + una tabla, no módulos nuevos. |

---

## 11. Coherencia con v2.0 / v2.1 — veredicto del arquitecto

La v3.0 **no toca la máquina de estados** (S01–S11) ni el modelo de cierre por el solicitante
(RN-201) ni los "dos relojes" (v2.1). Reutiliza `desarrollador_asignado` (que ya existe por
ítem), la identidad Google que ya resuelve el rol, el motor de horas hábiles y el semáforo de
cumplimiento. Lo verdaderamente nuevo es: un catálogo (`CAT_AREAS`), el ruteo del aviso, un
selector de bandeja, una verificación por código efímero, y una tabla de Gerencia que
reemplaza la Gantt. Respeta el principio rector ("simple pero extremadamente útil"): no agrega
módulos que engorden el menú, sino que abre a más gente lo que ya funciona para una sola.
