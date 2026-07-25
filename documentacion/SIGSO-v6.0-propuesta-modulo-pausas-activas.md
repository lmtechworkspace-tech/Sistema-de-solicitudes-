# SIGSO v6.0 — Propuesta: módulo de Control de Pausas Activas

> Análisis de factibilidad y diseño para incorporar el control de **pausas activas**
> como un **módulo nuevo dentro de SIGSO**, reutilizando lo que el sistema ya tiene
> (personal, credenciales, roles, alertas, dashboards, enlaces mágicos, correos HTML,
> generación de PDF). **No incluye código** — es la propuesta para decidir qué construir
> y en qué orden, sin tocar lo que ya funciona.

---

## 0. La decisión de fondo (antes de todo lo demás)

El documento que subiste está escrito como un encargo **desde cero**: pide comparar
GitHub Pages vs. Apps Script Web App, diseñar un login, un sistema de roles, un dashboard,
un motor de correos, triggers, etc. Todo eso **ya existe y funciona en SIGSO**. Por lo
tanto, la pregunta correcta no es *"¿qué arquitectura gratuita elijo?"* sino:

> **¿Construyo un sistema aparte, o lo monto como un módulo más de SIGSO?**

**Recomendación tajante: montarlo como un módulo de SIGSO.** Construir un sistema paralelo
significaría reinventar (y luego mantener por separado) el login, los roles, las cuentas,
los correos, los triggers, el multi-empresa, el panel de gerencia y el deploy — todo lo que
SIGSO ya tiene probado con 409 tests. El módulo de pausas se apoya en esa base y sólo
agrega **lo específico de pausas** (programación, registro de participación, validación del
coordinador, reportes de cumplimiento). Menos código, menos riesgo, una sola cosa que
mantener, y experiencia unificada (los mismos usuarios entran al mismo sistema).

Esto también responde, de una, casi todas las preguntas de arquitectura del documento:
la arquitectura ya está elegida y en producción (§2 de esta propuesta).

**Regla de oro (tu requisito explícito): no afectar el sistema principal.** Todo es
**aditivo** — hojas nuevas, un módulo nuevo, roles nuevos. No se toca ninguna hoja ni flujo
existente. Mismo criterio con el que se agregaron Jefatura (v4.2), clientes, áreas, etc.

---

## 1. Diagnóstico del problema (tal como lo planteas)

Las pausas activas arrancaron bien y se fueron cayendo por **falta de control, seguimiento
y trazabilidad**. Hoy no se puede responder con datos: si se hizo, a qué hora, quién
coordinó, quiénes participaron, quiénes no y por qué, ni el % de cumplimiento. Es
exactamente el mismo problema que SIGSO ya resuelve para las solicitudes (¿se atendió?,
¿cuándo?, ¿quién?, ¿cumplió el plazo?) — sólo que aplicado a una **actividad recurrente
programada** en vez de a un ticket.

La buena noticia: SIGSO ya tiene el 70% de las piezas. Lo que falta es el modelo de datos
de pausas y las pantallas de registro/coordinación/reporte.

---

## 2. Arquitectura: por qué SIGSO ya es la respuesta

El documento pide comparar A (Apps Script Web App), B (GitHub Pages + Apps Script + Sheets)
y C (otra). **SIGSO ya es la opción B, en producción**, y es la más robusta de las tres:

| Criterio | Apps Script Web App solo (A) | **SIGSO: GH Pages + Apps Script + Sheets (B, actual)** |
|---|---|---|
| Costo | $0 | **$0** |
| Frontend | Servido por Apps Script (lento, límites de HtmlService) | **GitHub Pages: estático, rápido, cacheado** |
| Cookies de terceros | Rompen el fetch autenticado (bloqueo de navegadores) | **Resuelto: token propio del portal, sin cookies de Google** |
| Control de acceso | Hay que construirlo | **Ya existe: cuentas del portal + roles + enlaces mágicos** |
| Correos | Hay que construir el motor | **Ya existe: plantilla HTML branded + cola + dedup** |
| Multi-empresa | Hay que construirlo | **Ya existe (HP / RLD por `empresa_id`)** |
| Mantenimiento | Otro sistema aparte | **Uno solo** |

**No conviene GitHub Pages "extra" ni un Apps Script Web App aparte.** El módulo de pausas
usa el mismo frontend (GitHub Pages), el mismo Backoffice (Apps Script), la misma planilla
(hojas nuevas) y el mismo login. Cero arquitectura nueva.

**Diagrama (lógico):**

```
  Trabajador / Coordinador / Gerencia / Admin
        │  (mismo login del portal + enlace mágico)
        ▼
  plataforma.html (GitHub Pages, shell con sidebar)
        │  módulos: ... + "Pausas activas" + "Coordinación de pausas"
        ▼  (llamarApi, token del portal)
  Backoffice (Apps Script)  ── router Code.gs → Pausas.gs (NUEVO)
        │                                    Notificaciones.gs (reusa)
        │                                    Triggers.gs (reusa)
        ▼
  Google Sheets: hojas PAUSAS_* (NUEVAS) + reusa USUARIOS/CUENTAS_PORTAL
```

---

## 3. Análisis crítico punto por punto (factibilidad)

Tabla de factibilidad de cada requisito del documento, con la decisión recomendada. "Reusa"
= ya existe en SIGSO; "Nuevo" = hay que construirlo; "No hacer" = descartado con
justificación (tú pediste explícitamente que critique la idea, §19 del documento).

| # | Requisito del documento | Factibilidad | Qué reusa / decisión |
|---|---|---|---|
| Config empresa/logo | Configuración general | Alta | **Reusa** CAT_EMPRESAS + logo por empresa (ya existe) |
| Lista de trabajadores (Sheets, no hardcode) | Roster de trabajadores | Alta | **Nuevo** `PAUSAS_TRABAJADORES` (admin-editable), pre-poblable desde CUENTAS_PORTAL/USUARIOS. Ver §4 (nota de identidad) |
| Coordinadores autorizados (Amarilla, Camila + reemplazo) | Editable por admin | Alta | **Nuevo, editable** vía el CRUD genérico de config (como CONFIG_NOTIFICACIONES). Ver §6 |
| Horario / días / duración habitual | Editable por admin | Alta | **Nuevo, editable** `PAUSAS_CONFIG`. Ver §6 |
| Programación de pausas + estados | Estados de la actividad | Alta | **Nuevo** `PAUSAS_PROGRAMADAS` con máquina de estados (análoga a la de solicitudes) |
| Programación automática L–V | Trigger diario | Alta | **Reusa** `configurarTriggers`; genera la pausa del día si toca |
| Recordatorio 10–15 min antes | Correo automático | **Media** (ver límite) | **Reusa** Notificaciones (HTML) + trigger. **Límite Apps Script:** los triggers de tiempo NO se disparan "a la hora exacta", corren en ventanas (~cada 5–15 min). Se resuelve con un trigger cada 5 min que revisa "¿hay pausa que empieza en los próximos 15 min y no avisada?". Factible, con precisión de ±5 min |
| Aviso al coordinador si no inició | Correo | Alta | **Reusa** Notificaciones + trigger |
| Alerta al admin si no se realizó | Correo | Alta | **Reusa** Notificaciones + trigger |
| Resúmenes diario / semanal / mensual | Correo programado | Alta | **Reusa** el motor de reportes programados (semanal/mensual ya existe) |
| Registro del trabajador (participé / no pude) | Pantalla simple | Alta | **Nuevo** módulo "Pausas activas" (mobile-first). Ver §5 |
| Justificación de inasistencia | Formulario | Alta | **Nuevo** `PAUSAS_ASISTENCIA` con motivo + comentario |
| Identificación del trabajador | Seguridad | Alta | **Reusa** cuentas del portal + **enlaces mágicos** (ya existen). Ver §4 — recomiendo esto sobre "selección de nombre" |
| Confirmación de participación | Valor probatorio | Alta | **Checkbox de declaración** + identidad autenticada + timestamp. **NO firma dibujada** (ver §4) |
| Validación del coordinador | Interfaz especial | Alta | **Nuevo** módulo "Coordinación de pausas" (rol coordinador). Ver §7 |
| Dashboard de cumplimiento | KPIs + semáforo | Alta | **Reusa** el patrón del Panel de Gerencia (`Gerencia.getPanel` + tabs). Ver §9 |
| Reporte para Gerencia | Panel + PDF/correo | Alta | **Reusa** Panel de Gerencia (una pestaña nueva) + reporte ejecutivo. Tu requisito explícito |
| Reporte para las prevencionistas | Su propio apartado | Alta | **Nuevo** dentro del módulo de coordinación (Amarilla/Camila ven sus reportes) |
| Roles y permisos | ADM/COORD/TRABAJADOR/VISUALIZADOR | Alta | **Reusa** el sistema de roles/módulos. Ver §8 |
| Logs de auditoría | Trazabilidad | Alta | **Reusa** `LOG_NOTIFICACIONES`/patrón de historial + `PAUSAS_LOG` |
| **Firma manuscrita digital** | — | — | **NO HACER** — sobra. Ver §4 |
| **QR** | — | — | **Opcional/después** — el enlace mágico ya cumple lo mismo. Un QR puede sólo *codificar* ese enlace más adelante |
| **Google Forms** | — | — | **NO** para el flujo central — rompe trazabilidad, roles y marca. SIGSO ya tiene formularios propios |
| **GitHub Pages "extra"** | — | — | **NO** — ya se usa; el módulo va encima |

**Conclusión de factibilidad:** todo es factible en $0 sobre SIGSO. El único punto con
matiz técnico real es la **precisión del recordatorio** (Apps Script no dispara al minuto
exacto): se resuelve con una ventana de ±5 min, que es más que suficiente para "avisar 15
min antes".

---

## 4. Identidad y confirmación (crítica a tus opciones, como pediste)

El documento lista 5 formas de identificar al trabajador y 4 de confirmar. Analizadas:

**Identificación — recomendación: cuenta del portal + enlace mágico.**
- ❌ *Selección de nombre desde un listado*: inseguro — cualquiera marca por cualquiera. No
  hay trazabilidad real. Descartado como mecanismo principal.
- ❌ *Código personal tecleado*: fricción y se comparte fácil.
- ✅ **Cuenta del portal** (los que ya la tienen) **+ enlace mágico** (v5.2 Fase C, ya
  construido): el trabajador entra con su identidad real, sin fricción, desde el correo o
  WhatsApp. **Esta es tu ventaja concreta**: ya tienen credenciales, y el enlace mágico
  hace el registro en <15 seg sin pedir clave. Cada registro queda atado a la persona
  autenticada → trazabilidad de verdad. Evita que uno registre por otro.
- ⚙️ *QR*: útil si algún día se quiere registro presencial junto al lugar de la pausa. Puede
  agregarse después y simplemente contener el enlace mágico. No es prioridad.

**Confirmación — recomendación: checkbox de declaración (no firma dibujada).**
- ✅ **Checkbox** "Declaro que participé en la pausa activa del [fecha/hora]" + la identidad
  autenticada + timestamp del servidor. Ese trío (quién + cuándo + declaración) **es el
  valor probatorio interno**. Es lo que usan los sistemas de charlas de seguridad.
- ❌ **Firma manuscrita dibujada**: sobra. No agrega valor probatorio real por sobre la
  identidad autenticada + timestamp, y sí agrega complejidad (canvas, almacenamiento de
  imágenes, móvil). **No hacer.**
- ⚙️ *OTP por correo*: innecesario si ya entró autenticado; sería doble validación redundante.

---

## 5. Flujo del trabajador (mobile-first, <15 seg)

1. Le llega el correo/WhatsApp de recordatorio con un botón (enlace mágico a su cuenta).
2. Toca el botón → entra directo al módulo **"Pausas activas"** (sin clave).
3. Ve la pausa de hoy y dos botones grandes:
   - **✅ Participé** → checkbox de declaración → Guardar. Listo.
   - **✋ No pude participar** → aparece el formulario de justificación (motivo de una lista
     + comentario) → Guardar.
4. Confirmación en pantalla. Todo el registro (identidad, fecha, hora, IP/agente si
   aplica, estado, motivo) queda en `PAUSAS_ASISTENCIA`.

Reusa el shell, los componentes (botones, toasts, formularios) y el login. Cero fricción.

---

## 6. Configuración editable por el admin (tu requisito clave)

Todo lo "de gobierno" es editable por ti como ADM, sin tocar código, con el **mismo CRUD
genérico** que ya administra empresas/áreas/notificaciones (`CATALOGOS_CONFIG` + admin.js):

- **Coordinadores (prevencionistas):** `PAUSAS_COORDINADORES` — Amarilla y Camila como
  titulares, más **uno o varios de reemplazo**. Marcable quién es titular/reemplazo y
  activo/inactivo. Si ninguna titular puede, el reemplazo queda habilitado para coordinar.
  **Editable desde Administración.**
- **Horario / días / duración:** `PAUSAS_CONFIG` (por empresa) — hora habitual, días de la
  semana (L–V configurable), duración estimada, minutos de anticipación del recordatorio,
  umbral de cumplimiento (los cortes 90%/70% del semáforo). **Todo editable.**
- **Roster de trabajadores:** `PAUSAS_TRABAJADORES` — nombre, correo, área, cargo, activo.
  Pre-poblable desde las cuentas/usuarios existentes, pero es su propia lista (ver nota).

> **Nota honesta sobre "ya tenemos al personal":** es cierto que SIGSO ya tiene cuentas y
> credenciales, y eso es una ventaja real para el **login**. Pero el padrón de SIGSO hoy
> son el equipo que atiende solicitudes + solicitantes, no necesariamente **todos** los
> trabajadores con su área/cargo para pausas. Por eso el roster de pausas es su propio
> catálogo (con área/cargo, que pausas necesita para "participación por área"), que se
> **siembra** desde lo existente y luego se mantiene aparte. Así reutilizas las credenciales
> sin ensuciar el modelo de usuarios del sistema principal.

---

## 7. Flujo del coordinador (Amarilla / Camila / reemplazo)

Módulo **"Coordinación de pausas"** (rol coordinador). En <1 min:

1. Ve la pausa programada del día.
2. **Iniciar pausa** → registra hora real de inicio (estado → *En curso*).
3. Ve en vivo: participantes, pendientes, justificaciones.
4. **Finalizar** → declara "La pausa activa programada fue realizada" (checkbox) → estado
   *Realizada/Cerrada*. Puede dejar observaciones.
5. Si no se hace: **marcar No realizada** con motivo (falta de disponibilidad, emergencia,
   reunión, ausencia del coordinador, problema técnico, otro).
6. **Su propio apartado de reportes**: Amarilla y Camila ven el cumplimiento, participación
   por área/trabajador y el histórico — sin pasar por Gerencia. (Tu requisito explícito.)

---

## 8. Roles y permisos (reusa el sistema de SIGSO)

Se agrega a `MODULOS_VALIDOS` dos módulos: `pausas` (registro del trabajador) y
`pausas_coordinacion` (coordinador + reportes). Roles:

| Rol | Qué puede en pausas |
|---|---|
| **TRABAJADOR** (cualquiera con cuenta/enlace) | Registrar SU participación/justificación. Nada más. Módulo `pausas` |
| **COORDINADOR** (prevencionista: Amarilla, Camila, reemplazo) | Iniciar/cerrar/marcar no realizada + ver participantes + **reportes de pausas**. Módulos `pausas` + `pausas_coordinacion` |
| **GERENCIA** | Ve el **reporte de cumplimiento** de pausas (pestaña en su panel). Solo lectura |
| **ADM** (tú) | Configura todo (coordinadores, horas, días, roster), ve todo, corrige |

El backend valida por rol **en cada acción** (mismo blindaje que hoy: esconder un botón no
es seguridad; el servidor rechaza igual). Cada trabajador sólo puede registrar lo suyo;
sólo el coordinador cierra; sólo el admin edita config.

---

## 9. Dashboard y reportes

**Dónde vive:** el dashboard de cumplimiento reusa el **patrón del Panel de Gerencia**
(`Gerencia.getPanel` calcula, `gerencia.js` con tabs y semáforo dibuja). Se agrega:
- Una **pestaña "Pausas" en el Panel de Gerencia** (para el gerente — tu requisito).
- El **apartado de reportes en el módulo de coordinación** (para Amarilla/Camila).

**KPIs (con semáforo 🟢≥90% / 🟡 70–89% / 🔴<70%):**
- Pausas programadas / realizadas / no realizadas del periodo, **% de cumplimiento**.
- Total de participaciones, **% de participación**, total de justificaciones.
- Principales motivos de inasistencia. Participación por **área** y por **trabajador**.
- **Tendencia** semanal y mensual.

**Reportes automáticos (reusa el motor de reportes programados):**
- **Diario** (a coordinador/admin): qué pasó con la pausa del día.
- **Semanal / mensual** (a Gerencia + prevencionistas): cumplimiento, participación,
  motivos, pausas no realizadas — como el reporte ejecutivo actual, en **correo HTML** y
  opción de **PDF** (reusa el generador de PDF del servidor de la OT).

Con esto se responde tu pregunta de los 6 meses: *"¿durante los últimos 6 meses la empresa
realmente hizo sus pausas?"* → sí, con datos históricos verificables en `PAUSAS_*`.

---

## 10. Modelo de datos (hojas nuevas, aditivas)

Todas nuevas — no se toca ninguna hoja existente. IDs correlativos como el resto del
sistema. Relaciones por `id_pausa` / `id_trabajador` / `empresa_id`.

- **`PAUSAS_CONFIG`** (por empresa): `empresa_id, hora_habitual, dias_semana, duracion_min,
  min_anticipacion_recordatorio, umbral_verde, umbral_amarillo, activo`.
- **`PAUSAS_COORDINADORES`**: `coord_id, empresa_id, nombre, email, tipo(titular|reemplazo),
  activo`.
- **`PAUSAS_TRABAJADORES`**: `trabajador_id, empresa_id, nombre, email, area, cargo, activo,
  fecha_ingreso` (se siembra desde CUENTAS_PORTAL/USUARIOS).
- **`PAUSAS_PROGRAMADAS`**: `pausa_id, empresa_id, fecha, hora_programada, hora_inicio_real,
  hora_fin, coordinador_email, estado, duracion_min, observaciones` + contadores
  desnormalizados opcionales (total_trabajadores/participantes/justificados/sin_registro)
  o calculados al vuelo. Estados: *Programada, Recordatorio_enviado, En_curso, Realizada,
  Cerrada, Suspendida, No_realizada, Cancelada*.
- **`PAUSAS_ASISTENCIA`**: `registro_id, pausa_id, trabajador_id, email, fecha_hora_registro,
  estado(participo|no_participo), motivo, comentario, confirmacion(true), origen`.
- **`PAUSAS_LOG`**: auditoría (quién hizo qué y cuándo) — reusa el patrón de LOG del sistema.

Justificaciones y validaciones del coordinador se guardan en `PAUSAS_ASISTENCIA` y
`PAUSAS_PROGRAMADAS` respectivamente (no hace falta multiplicar hojas; el documento propone
10 hojas pero varias se pueden fusionar sin perder trazabilidad — menos hojas = menos
mantenimiento). El "dashboard" y los "reportes" NO son hojas: se calculan (como en SIGSO
hoy), no se persisten.

Registrar las hojas nuevas en las **3 copias del esquema** (Intake/Backoffice/Setup) y en
`Instalador.gs`, con el test de consistencia que ya valida que no diverjan.

---

## 11. Alertas y triggers (estrategia eficiente, sin spamear)

Reusa `Notificaciones` (correo HTML branded + cola + dedup) y `configurarTriggers`. Triggers
propuestos y su factibilidad en Apps Script:

| Trigger | Cadencia | Factible | Nota |
|---|---|---|---|
| Generar pausa del día | Diario temprano | ✅ | Si hoy es día hábil configurado, crea la `PAUSAS_PROGRAMADAS` en *Programada* |
| Recordatorio a trabajadores | Cada 5 min (ventana) | ✅ (±5 min) | Avisa a los que faltan cuando la pausa empieza en ≤ `min_anticipacion`. Marca *Recordatorio_enviado* para no repetir |
| Aviso al coordinador si no inició | Cada 5–10 min | ✅ | A la hora + margen, si sigue *Programada* |
| Alerta al admin si no se realizó | Fin del día | ✅ | Si quedó sin *Realizada/Cerrada* |
| Resumen diario | Fin del día | ✅ | A coordinador/admin |
| Reporte semanal / mensual | Lunes / día 1 | ✅ | A Gerencia + prevencionistas (reusa el motor actual) |

**Estrategia anti-spam (tu preocupación):** dedup por evento+persona+día (ya existe), un
solo correo de recordatorio por pausa por persona, y los resúmenes agregados en vez de N
correos sueltos. **Límite real de Gmail/Apps Script:** ~100 correos/día en cuenta gratuita
(1500 en Workspace). Para un recordatorio diario a, digamos, 40–80 trabajadores, entra
holgado; si el padrón creciera mucho, se prioriza el resumen y el recordatorio grupal. Se
documenta el límite.

---

## 12. Seguridad y trazabilidad

- Acceso por **identidad autenticada** (cuenta/enlace mágico), no por URL oculta.
- El backend **valida el rol en cada acción** (un trabajador no puede cerrar una pausa ni
  ver los datos de otros; sólo el coordinador cierra; sólo el admin edita config).
- **Anti-doble-registro:** un trabajador tiene un único registro por pausa (clave
  pausa+trabajador); reintentar actualiza, no duplica.
- **Anti-registro-fuera-de-hora:** el registro sólo se acepta para la pausa vigente / dentro
  de una ventana (config).
- **Auditoría** completa en `PAUSAS_LOG` + timestamps del servidor.

---

## 13. Riesgos y limitaciones (honestos)

1. **Precisión del recordatorio:** Apps Script dispara en ventanas, no al minuto → ±5 min.
   Aceptable para "15 min antes".
2. **Padrón de trabajadores:** hay que cargar/mantener el roster de pausas (se siembra desde
   lo existente, pero es trabajo inicial del admin). Es la parte "manual" de arranque.
3. **Límite de correos** de la cuenta (§11) — dimensionar según nº de trabajadores.
4. **Participación honesta:** el sistema registra la declaración autenticada; que la persona
   efectivamente haya hecho los ejercicios es autodeclarado (como toda charla de seguridad).
   La validación del coordinador es el contrapeso.

---

## 14. Plan de implementación por fases (aditivo, sin romper nada)

| Fase | Qué | Entrega valor | Reutiliza |
|---|---|---|---|
| **P0** | Esquema (hojas `PAUSAS_*` en las 3 copias) + `PAUSAS_CONFIG`/`PAUSAS_COORDINADORES`/`PAUSAS_TRABAJADORES` + CRUD admin | El admin ya configura coordinadores/horas/días/roster | Constantes, Instalador, Catálogos CRUD, admin.js |
| **P1** | Programación de pausas + trigger que crea la del día + máquina de estados | Las pausas quedan programadas y trazadas | Triggers, patrón de estados |
| **P2** | Módulo del **trabajador** (registro participé/no pude + justificación) con enlace mágico | Registro real en <15 seg, atado a identidad | Shell, login, enlaces mágicos, componentes |
| **P3** | Módulo del **coordinador** (iniciar/cerrar/no realizada + participantes) + su apartado de reportes | Amarilla/Camila operan y ven reportes | Shell, roles |
| **P4** | **Alertas**: recordatorio, aviso al coordinador, alerta al admin, resúmenes | Full alertas, sin spam | Notificaciones (HTML), Triggers |
| **P5** | **Dashboard de cumplimiento** + pestaña en Panel de **Gerencia** + reportes semanal/mensual (correo + PDF) | Gerencia ve el reporte; histórico verificable | Gerencia.getPanel, reportes programados, generador PDF |

**Recomendación:** arrancar por **P0** (deja la configuración en tus manos: coordinadores
editables, horas/días ajustables) porque desbloquea todo lo demás y es puro esquema +
CRUD reusado, sin riesgo. Cada fase es independiente y desplegable por separado.

---

## 15. Lo que esta propuesta deliberadamente NO hace

- **No construye un sistema aparte.** Es un módulo de SIGSO — una sola cosa que mantener.
- **No toca el sistema principal.** Todo aditivo: hojas, módulos y roles nuevos.
- **No usa firma dibujada, ni Google Forms para el flujo central, ni GitHub Pages "extra",
  ni un login nuevo.** Reusa lo que ya funciona.
- **No multiplica hojas innecesariamente** (fusiona justificaciones/validaciones donde no
  hacen falta hojas separadas).

---

## 16. Decisiones que necesito de ti

1. **¿Confirmas montarlo como módulo de SIGSO** (recomendado) en vez de un sistema aparte?
2. **Identidad/confirmación:** ¿ok con **enlace mágico + checkbox** (sin firma dibujada)?
3. **Coordinadores:** ¿Amarilla y Camila como titulares y "reemplazo" como rol editable que
   tú activas cuando haga falta? ¿Uno o varios reemplazos?
4. **Cadencia:** ¿pausa L–V a una hora fija configurable, recordatorio 15 min antes? ¿O
   varía por empresa (HP/RLD)?
5. **Roster:** ¿parto sembrando el padrón desde las cuentas del portal existentes, y tú lo
   completas con área/cargo? ¿O me pasas una lista de trabajadores?
6. **¿Arrancamos por la Fase P0** (configuración: coordinadores/horas/días/roster editables)?
