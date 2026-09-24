# SIGSO v2 — hoja de ruta módulo por módulo

Fecha: 2026-09-24. Proyectos v2 fue el piloto (F0–F8, predeterminado desde
`8fe1d83`). Ahora el mismo cambio —visual **y** de estructura/operatividad—
se lleva al resto de SIGSO, **de a un módulo**, nunca todo de golpe.

## Cómo se trabaja cada módulo (mismo método que Proyectos)

1. **Análisis** (este documento): qué hay, cómo se usa de verdad (datos del
   sandbox = copia de producción), qué confunde, qué se cambia en lo visual,
   en la estructura y en la operatividad.
2. **Decisiones** con el dueño antes de escribir código.
3. **Implementación por fases**, con la versión nueva **en paralelo**: la
   anterior no se toca y cada persona puede "Volver a la versión clásica".
4. **Verificación** en el sandbox con datos reales, claro/oscuro y móvil.
5. **Publicación** como versión predeterminada del módulo.
6. **Retiro** de la versión anterior después de un ciclo sin problemas.

Base común ya construida en Proyectos y reutilizable: `css/v2/*` (tokens,
layout a pantalla completa, componentes, movimiento), `js/ui-v2.js`
(KPI, tarjetas, drawer, diálogo, avatares con foto…), formulario en drawer,
acción confirmada, panel único de tarea.

## Uso real por módulo (22 cuentas)

| Módulo | Cuentas con acceso | Datos | Tamaño del código |
|---|---|---|---|
| Nueva solicitud / Mis solicitudes / Bandeja | 22 / 22 / 20 | 42 solicitudes, 57 sub-solicitudes, 168 cambios de estado | formulario 1.554 · estado 1.054 · dashboard 1.406 + detalle 1.101 |
| Calidad (SGC) | 13 | 198 documentos, 54 procesos, 100 inducciones… | 9.872 |
| Proyectos | 19 | **hecho (v2)** | — |
| Mi trabajo | 16 | **7 compromisos** (+90 tareas de proyecto que ya se ven en Proyectos) | 333 |
| Pausas activas / Coordinación | 12 / 5 | 197 asistencias, 42 pausas | 205 / 556 |
| Mi departamento (jefatura) | 7 | usa actividades + solicitudes del equipo | 638 |
| Panel de gerencia | 6 | KPIs de todo | 1.666 |
| Novedades | todas (core) | 7 novedades | 1.201 |
| Administración | 2 | catálogos, cuentas | 2.044 |
| Inicio | todas | resume los demás | 570 |

## Orden propuesto

| # | Módulo | Por qué en este lugar |
|---|---|---|
| 1 | **Mi trabajo** | Chico, casi todo reutiliza Proyectos v2 y arregla un problema real (hay dos "Mi trabajo"). Deja listo el mecanismo de versión nueva por módulo. |
| 2 | **Inicio** | Lo ve todo el mundo al entrar; resume los demás módulos. |
| 3 | **Solicitudes** (Nueva · Mis solicitudes · Bandeja + detalle) | El corazón del negocio y el más usado. Se hace en sub-fases. |
| 4 | **Mi departamento + Panel de gerencia** | Tableros: se benefician de gráficos y KPIs v2; comparten datos. |
| 5 | **Pausas activas + Coordinación** | Uso diario, flujo corto. |
| 6 | **Novedades** | Flujo simple de lectura/publicación. |
| 7 | **Administración** | Pocas cuentas, mucho formulario. |
| 8 | **Calidad (SGC)** | El más grande y la empresa está en certificación ISO: al final y en sub-fases. |
| 9 | **Marco del shell** (sidebar, cabecera, perfil) | Cuando la mayoría ya sea v2, se unifica el marco. |

---

## Módulo 1 — Mi trabajo: análisis

### Qué hace hoy
Lista mis actividades con semáforo, check-in de un clic (Avancé / Sin
cambios / Estoy bloqueado / Listo, con horas y nota opcionales), confirmar o
contraproponer la fecha de una tarea asignada, crear "Nueva actividad" o
"Registrar algo no planificado" (título, vence, tamaño S–XL, proyecto en
texto libre).

### Lo que muestran los datos
- 16 cuentas lo tienen, pero solo existen **7 compromisos** fuera de
  proyectos, **todos "No iniciada"**, nunca actualizados.
- 5 de esos 7 son el mismo "Migración de clientes a HomePymes Digital",
  escrito a mano en el campo *Proyecto* por 4 personas distintas: se usó
  como proyecto improvisado.

### Problemas encontrados
1. **Hay dos "Mi trabajo"** sobre los mismos datos: el módulo y Proyectos →
   Mi trabajo. `listarActividades` trae también las tareas de proyecto, con
   otra pantalla y otro flujo de actualización.
2. **Vuelve la doble puerta**: el módulo registra horas por el check-in
   viejo, mientras Proyectos v2 las registra en el registro del día
   (`actualizarTareaProyecto`). Las mismas horas pueden cargarse por dos
   caminos.
3. **ADM y Gerencia ven el trabajo de todos** en su "Mi trabajo" personal
   (el alcance de `listar` es "todas" para esos roles). Inicio ya lo evita
   filtrando por responsable; el módulo no.
4. **Proyecto en texto libre**: invita a duplicar proyectos a mano en vez
   de usar Proyectos.
5. **Recurrencia sin pantalla**: el backend sabe repetir compromisos
   semanal/mensualmente, pero no hay dónde elegirlo.
6. **Brecha en Proyectos v2**: "Confirmar fecha / Proponer otra" (tareas
   asignadas con fecha por confirmar) existe aquí y no en el Mi trabajo v2 de
   Proyectos.
7. El semáforo se calcula distinto en el navegador (UTC) que en el backend.

### Propuesta
- **Un solo "Mi trabajo" para todo SIGSO** (el módulo), en v2: la vista que
  ya existe en Proyectos v2 ("Mis tareas" por urgencia + "Mis horas"),
  ampliada con los compromisos personales. Proyectos → Mi trabajo lleva al
  mismo lugar.
- **Siempre personal**: solo lo mío (responsable o colaborador), también para
  ADM/Gerencia. La vista de equipo vive en Mi departamento / Gerencia.
- **Una sola acción para actualizar** (el panel único de tarea) también para
  compromisos sin proyecto → el backend generaliza `actualizarTarea` a
  actividades sin proyecto (horas solo en el registro del día).
- **Confirmar fecha / Proponer otra** en la fila y en el panel.
- **Nueva tarea** con proyecto real opcional (selector de mis proyectos) en
  vez de texto libre; "No planificado" en un clic; **repetir** semanal/mensual.
- Semáforo único: el del backend.
- Inicio sigue funcionando igual (misma fuente de datos).

### Decisiones del dueño (2026-09-24)
Orden aprobado · un solo Mi trabajo para todo SIGSO · selector de
proyectos reales (los 7 compromisos existentes se conservan, su texto queda
como etiqueta) · siempre personal, también para ADM/Gerencia.

### Fases — ESTADO: HECHO
- **M1.1** Backend: `actualizarTarea` / registro del día aceptan
  compromisos sin proyecto (permisos del módulo Actividades: quien la
  trabaja o quien la supervisa); `listarMisTareas` / `listarMiBitacora` con
  `incluir_personales` (solo lo mío). 4 tests nuevos.
- **M1.2** Vista v2 unificada en el módulo (`SigsoMiTrabajoV2`): tareas de
  proyectos + compromisos personales, confirmar fecha / proponer otra, nueva
  tarea (con proyecto real opcional, tamaño y repetición), "No planificado",
  terminadas de la semana, "Mis horas" con "Personales". El panel único
  sirve para compromisos (Actualizar, Reprogramar, Cancelar). Interruptor de
  versión generalizado en el shell (`MODULOS_V2` en `plataforma.js`).
- **M1.3** Proyectos → Mi trabajo lleva al módulo (si la cuenta lo tiene;
  si no, se ve dentro de Proyectos). Predeterminado para todos; la versión
  clásica queda un ciclo con "Volver a la versión clásica".

### Hallazgo al probar
Había tareas de proyecto asignadas **esperando confirmación de fecha** que
ninguna pantalla de Proyectos permitía confirmar (una sola persona tenía 5).
Ahora aparecen como KPI "Por confirmar" con los botones Confirmar / Otra
fecha.

---

## Módulo 2 — Inicio: análisis

### Qué hace hoy
Saludo + cargo + fecha; línea de estado ("Tienes N cosas…" / "Todo al día");
"Requiere tu atención" (una fila por pendiente de Mi trabajo, Calidad,
Solicitudes, Mi equipo, Novedades); "Mi trabajo hoy" (5 compromisos con
"Sin cambios"/"Confirmar" de un clic); KPIs de Bandeja y de Mi departamento;
"Tu semana" (pausa del día + cerradas en 7 días); actividad reciente de
solicitudes. Un viaje al backend (`getInicio`) + Mis solicitudes + Novedades.

### Lo que muestran los datos (sandbox, 22 cuentas)
- La persona con más carga (44 tareas) ve **12 filas sueltas** en
  "Requiere tu atención" y luego "Mi trabajo hoy" **repite las mismas
  tareas atrasadas**: la página mide ~1.900 px.
- **Luis Mendoza lidera 16 proyectos** y el Inicio no dice nada de ellos:
  Proyectos (19 cuentas) no aparece en el Inicio.
- **2 cuentas tienen tareas asignadas pero no el módulo Mi trabajo** (una
  de Gerencia no tiene ni Proyectos): sus tareas no se ven en ninguna parte.

### Problemas encontrados
1. **Falso "Todo al día"**: si la consulta falla (red, sesión), el Inicio
   igual dice "Todo al día — nada pendiente de tu parte". Reproducido.
2. **Ruido y duplicación**: una fila por tarea + las mismas tareas otra vez
   en "Mi trabajo hoy".
3. **"Abrir" no abre nada concreto**: lleva a la portada del módulo, no a la
   tarea; "Confirmar" en la lista de atención navega en vez de confirmar.
4. **Cuenta distinto que Mi trabajo**: usa solo lo que soy responsable (44)
   y Mi trabajo cuenta también lo que colaboro (49).
5. **Sin Proyectos** (ni salud de lo que lidero ni entregables).
6. **Tareas invisibles** para quien no tiene el módulo Mi trabajo.
7. Diseño antiguo, angosto; saludo con la hora del navegador (no Chile).

### Propuesta
- Inicio v2 a pantalla completa: cabecera con foto, estado honesto (si una
  fuente falla, se dice cuál: "No pudimos revisar Calidad").
- **"Requiere tu atención" agrupado por origen** con sus conteos
  (ej. Mi trabajo: 9 atrasadas · 6 por confirmar) y las 3 más urgentes con
  **acción directa** (abrir la tarea en el panel, confirmar ahí mismo).
- **"Mi día"** (reemplaza "Mi trabajo hoy"): las próximas tareas, sin repetir
  las que ya están en atención, con "Actualizar" en el panel único.
- **"Mis proyectos"**: salud de los que lidero o integro (críticos primero).
- Paneles por rol (Bandeja, Mi departamento) con KPIs v2 clicables.
- "Tu semana": pausa del día + horas registradas + tareas cerradas.
- Misma fuente que Mi trabajo (`listarMisTareas` con personales, vía
  `getInicio`), así los números coinciden.

### Decisiones del dueño (2026-09-24)
Atención agrupada + 3 más urgentes · bloque "Mis proyectos" · mostrar las
tareas en Inicio aunque la cuenta no tenga el módulo Mi trabajo · el
panorama de Gerencia se diseña con el módulo 4.

### ESTADO: HECHO
- Backend: `getInicio` suma los bloques `mis_tareas`, `mi_bitacora` y
  `proyectos` (misma fuente que Mi trabajo). Test nuevo.
- `js/inicio-v2.js` + `css/v2/inicio-v2.css`: cabecera con foto y estado
  honesto (con "Reintentar"), KPIs personales, atención agrupada con acción
  directa (Actualizar en el panel, Confirmar ahí mismo; si hay fechas por
  confirmar, una ocupa el tercer lugar), Tu semana (pausa + horas de 7 días
  + cerradas), Mi día (sin repetir lo de atención), Mis proyectos (críticos
  primero, abre el proyecto), paneles de Bandeja y Mi departamento,
  actividad reciente.
- Shell: `home` entra a `MODULOS_V2`; el Inicio ahora **se recarga al
  volver a él** (antes mostraba los números del login).

### Hallazgos al implementar
- El Inicio **no se recargaba al volver** desde otro módulo: tras confirmar
  una fecha en Mi trabajo, el Inicio seguía pidiéndola (también en la
  clásica). Corregido en el shell para ambas versiones.
- Una fuente lenta no debe frenar la pantalla: v2 pinta con lo principal
  (getInicio) y completa Mis solicitudes y Novedades después; mientras
  revisa, el estado dice "Revisando…" y nunca "Todo al día". (Corrección:
  al implementarlo se dijo que Mis solicitudes seguía en Apps Script; es
  falso,  ya corre en Node.)
- Una fecha **por confirmar** no cuenta como atrasada (aún no es un
  compromiso): Inicio y Mi trabajo usan ahora el mismo criterio y muestran
  los mismos números.

---

## Módulo 3 — Solicitudes: análisis

Tres pantallas sobre los mismos datos: **Nueva solicitud** (formulario de 3
pasos, `formulario.js`), **Mis solicitudes** (`estado.js`, con KPIs,
pestañas, corrección e historial ya rediseñados en sep-2026) y la
**Bandeja** del equipo (`dashboard.js` + `detalle.js`). Ojo: `formulario.js`
y `estado.js` también sirven las páginas **públicas** para clientes
(`index.html`, `estado.html`). Todo corre ya en Node.

### Lo que muestran los datos (sandbox)
- **37 de 57 ítems abiertos; 28 nunca salieron de "Nueva"** (S01), la
  mayoría con 64–77 días. **36 de 37 fuera de SLA**, 33 sin fecha
  comprometida. Solo 10 ítems se terminaron alguna vez.
- 41 de 57 ítems quedaron en **P4** (prioridad por defecto, SLA 5 días).
- **39 ítems asignados a una sola persona** — que tiene **0 tareas en Mi
  trabajo**: su trabajo vive solo en la Bandeja.
- 41 de 42 solicitudes se crearon desde la plataforma; 1 desde el
  formulario público. Una solicitud tiene 0 ítems (dato anómalo).

### Problemas encontrados
1. **KPI "Sin asignar" falso**: dice 24, pero 23 de esas solicitudes tienen
   todos sus ítems asignados (se asigna por ítem y el KPI lee un campo de la
   solicitud que nadie actualiza). Real: 1 (ver hallazgos de 3A). La fila
   además ofrece "Asignar".
2. **La cola no se trabaja**: la Bandeja es una lista larga (42 filas,
   ~3.400 px) donde triar un ítem (recibir, asignar, priorizar, fechar)
   exige entrar al detalle; no hay una vista para ponerse al día con lo
   atrasado.
3. **La unidad de trabajo es el ítem, la lista muestra solicitudes**: el
   estado de la solicitud es el de su ítem menos avanzado (regla §8.2), así
   que "Nueva" puede esconder un ítem "Esperando información".
4. **Lo asignado no llega a Mi trabajo** (ni al Inicio de quien lo trabaja).
5. Diseño antiguo en Bandeja y detalle (página aparte, no panel).

### Propuesta (en sub-fases, empezando por la Bandeja)
- **3A Bandeja v2 + detalle en panel lateral**: cola por **ítem** (agrupable
  por solicitud), KPIs correctos y clicables, acciones en la fila
  (recibir, asignar, prioridad, fecha comprometida) y en lote, vista
  **"Ponerse al día"** (lo más viejo / fuera de SLA primero), detalle en
  panel con pestañas (Ficha · Ítems · Actividad) y las acciones de siempre.
- **3B Mi trabajo e Inicio**: los ítems asignados a mí aparecen junto a mis
  tareas (con su propio botón de acción, que abre el detalle).
- **3C Mis solicitudes v2** y **3D Nueva solicitud v2** dentro de la
  plataforma; las páginas públicas para clientes no se tocan en este
  módulo.

### Decisiones del dueño (2026-09-24)
- Empezar por **Bandeja + detalle** (3A).
- La unidad de la cola es **el ítem, agrupable por solicitud**.
- Los ítems asignados **sí** aparecen en Mi trabajo e Inicio (3B).
- Las páginas públicas (`index.html`, `estado.html`) **no se tocan** en este
  módulo; 3C y 3D son solo dentro de la plataforma.

### 3A Bandeja v2 — ESTADO: HECHO
- Backend: `getColaSolicitudes` (`Dashboard.getCola`): ítems con su
  responsable (propio o heredado de la solicitud), SLA, días sin movimiento,
  fecha comprometida y KPIs contados **sobre ítems**. Mismo alcance por rol
  que la clásica (ADM todo o "bandeja de" una persona; el resto lo suyo; DEV
  además los huérfanos en trabajo; Gerencia/Jefatura solo lectura).
- KPI clásico "Sin asignar" corregido (se asigna por ítem) y la fila clásica
  muestra al responsable de los ítems cuando la cabecera está vacía.
- Frontend: `js/bandeja-v2.js` + `css/v2/bandeja-v2.css`, montado en
  `#bandeja-v2` dentro de `#modulo-bandeja` (`MODULOS_V2.bandeja`; se
  desmonta al ir a Gerencia/Jefatura, que comparten la sección y siguen
  clásicas hasta el Módulo 4).
  - 6 KPIs clicables (Abiertos · Por revisar · Fuera de plazo · Sin fecha ·
    Sin asignar · Por validar), búsqueda, empresa, prioridad, 5 órdenes,
    agrupar por solicitud, ver cerrados, CSV, Pauta PDF (ADM con persona).
  - **"Ponerse al día"**: aparece si hay 3+ ítems sin triar de más de 2
    semanas; filtra "Por revisar" del más antiguo al más nuevo.
  - "Recibir" en un clic en la fila; **lote**: recibir, asignar (con motivo),
    prioridad (justificación ≥ 20), fecha comprometida (motivo si ya tenía),
    estado (comentario cuando corresponde). Ítem por ítem contra el backend;
    al final dice cuántos quedaron y cuáles no y por qué.
  - Detalle en panel lateral ancho: Ítems (acciones por ítem: estado con las
    transiciones que permite el backend, fecha, prioridad, asignar,
    corregir contenido) · Ficha · Actividad (historiales unificados +
    comentario/nota interna) · Archivos; pie con Orden de trabajo y
    Convertir en proyecto.
  - Análisis: abiertos por estado, antigüedad, carga por responsable,
    prioridad (Chart.js).

### Hallazgos al implementar 3A
- **El "Sin asignar" real sí era 1**: `SOL-2026-GDE-0005` tiene como
  responsable el texto de plantilla **`[CORREO_LEO]`** (no es un correo: no
  le llega a nadie) y sus 4 ítems no tienen responsable propio. El backend
  ahora trata un responsable que no es correo como "sin asignar".
- Esa misma solicitud es una **fila reconstruida a mano con columnas
  corridas**: `fecha_creacion` vacía (la fecha quedó en
  `observaciones_generales`, la nota en `estimacion_total_horas`), y el
  solicitante tiene `[CORREO_LUIS]` / `[CARGO_LUIS]` → **Luis Mendoza no
  recibe ningún aviso de su solicitud**. Corregir en producción (pendiente
  de autorización del dueño; no se tocó).

### 3B Solicitudes a tu cargo en Mi trabajo e Inicio — ESTADO: HECHO
- Backend: `getColaSolicitudes { solo_mios: true }` (cualquier rol) devuelve
  solo los ítems **abiertos** asignados a quien pregunta (propios o
  heredados de la solicitud), sin huérfanos ni lista de responsables.
  `getInicio` suma el bloque `mis_items` (no depende del módulo Bandeja).
- Una sola fila para ambos lados (`SigsoBandejaV2.filaMia`, mismo formato
  que una tarea): N° de solicitud e ítem, estado, "Fuera de plazo", P1/P2,
  "El solicitante respondió", fecha comprometida y días sin movimiento;
  botón **Recibir** si es nuevo, si no **Abrir** (el mismo panel lateral de
  la Bandeja). Orden: respondió → fuera de plazo → por recibir → prioridad →
  antigüedad.
- **Mi trabajo**: KPI "Solicitudes" (filtra), tarjeta "Solicitudes a tu
  cargo" (6 primeras + "Ver las N", enlace a la Bandeja) y la cuenta en el
  resumen de la cabecera.
- **Inicio**: grupo "Solicitudes a tu cargo" en *Requiere tu atención* (top
  3; cuenta como pendiente lo fuera de plazo, por recibir, con respuesta
  nueva o sin fecha comprometida; "urgente" = fuera de plazo) y KPI propio.
  Quien no tiene tareas pero sí solicitudes ve KPIs de sus solicitudes.
- Un cambio hecho desde el panel o una fila emite `sigso:solicitudes-cambio`
  y Bandeja, Mi trabajo e Inicio se refrescan solos.
- Fila de 6 KPIs generalizada: `.sx2-fila-kpis--6` (layout-v2.css).

### 3C Mis solicitudes v2 (solo plataforma) — ESTADO: HECHO
Datos (sandbox): 42 solicitudes de 11 solicitantes (7 con cuenta de
plataforma, 4 solo por la página pública); la validación sí se usa (18
ítems confirmados, 6 reabiertos); solo 6 de 42 solicitudes tienen más de un
ítem. Problema principal de la clásica: **la lista no decía de qué trataba
cada solicitud** (solo N°, empresa y fecha) y lo que esperaba una acción del
solicitante quedaba escondido dentro de cada detalle.
- Backend: `misSolicitudes` suma `titulo`, `items` (título, estado, fecha
  comprometida) e `items_esperan_respuesta`; `resumen.esperan_respuesta`.
- Frontend: `js/mis-solicitudes-v2.js` + `css/v2/mis-solicitudes-v2.css`
  (`MODULOS_V2.mis_solicitudes`; estado.html y el formulario público siguen
  con estado.js).
  - KPIs clicables: Abiertas · Te toca a ti · Cerradas · Todas.
  - **"Te toca a ti"**: cada ítem terminado por validar o con una pregunta
    del equipo, con su botón (Validar / Responder).
  - Lista con título, "+N ítems más", reparto de estados por ítem y la
    próxima entrega comprometida.
  - Detalle en panel lateral: hitos, aviso de acción pendiente, posición en
    la cola de tu empresa, pestañas Ítems · Historial · Archivos; acciones:
    responder, confirmar y cerrar, reabrir (con motivo), corregir (con
    resumen antes → después centrado en lo que cambió, quitar adjuntos y
    agregar imágenes) y "ya se resolvió por fuera".
- Un cambio emite `sigso:solicitudes-cambio` (el Inicio se refresca).
- Nota de prueba: `subirArchivo` sigue en Apps Script (Drive); no se probó
  en el sandbox para no escribir en producción — es la misma llamada que ya
  usa la clásica.

### 3D Nueva solicitud v2 (solo plataforma) — ESTADO: HECHO
Datos (sandbox, 57 ítems): el **impacto se informó en 6 de 57** (el modo
Rápido no lo pedía), así que la prioridad cayó al valor por defecto **P4 en
40 de 57** y el SLA no distinguía lo urgente. 43 de 57 ítems traen adjuntos
y 53 de 57 fecha propuesta: esas partes del formulario sí se usan.

Decisiones del dueño (2026-09-24):
- **Piel v2 sobre la lógica actual** (no reescritura): formulario.js sigue
  siendo el mismo; `js/nueva-solicitud-v2.js` solo pone/quita `sx2 ns2` en
  la sección y `css/v2/nueva-solicitud-v2.css` le da el diseño v2 (stepper
  en pastillas, tarjeta centrada de 920 px, campos, chips, acordeón,
  dropzone, tabla de revisión). `MODULOS_V2.nueva_solicitud`.
- **Gravedad en un toque, obligatoria dentro de la plataforma** (en v2 y
  en la clásica, porque es un dato): "No puedo trabajar" (BLOQUEO_OPERATIVO
  → P1) · "Me afecta mucho" (DEGRADACION_IMPORTANTE → P2) · "Tengo cómo
  seguir" (PARCIAL_CON_WORKAROUND → P3) · "Puede esperar" (PLANIFICADO →
  P5). Son valores de impacto que ya existían: el backend no cambia
  (MAPA_IMPACTO_PRIORIDAD). En el modo Completo reemplaza al select de
  impacto; la revisión muestra la columna "Cuánto afecta".
- El formulario público (index.html) **no cambia** (se detecta por la
  ausencia de `#vista-shell`).

---

## Módulo 4 — Mi departamento + Panel de gerencia: análisis

### Qué hacen hoy
- **Mi departamento** (`jefatura.js`, 638 líneas): Tablero · Por persona ·
  Actividades del equipo · Centro de reportes · Carga. El tablero y los KPIs
  salen de `getPanelJefatura`, que mira **solo solicitudes** (ítems que el
  equipo pidió o resuelve). Las tareas van aparte, en "Actividades del equipo"
  (`panelEquipoActividades`), con pedir actualización y reasignar.
- **Panel de gerencia** (`gerencia.js`, 1.666 líneas): Seguimiento (tablero,
  línea de tiempo) · Operación (Actividades, Pausas activas) · Reportes
  (centro, tendencia y ciclo, recurrencia, carga). Tres fuentes separadas
  (`getPanelGerencia`, `getPanelGerenciaActividades`,
  `getReporteGerenciaPausas`) y ninguna pantalla que junte todo.

### Lo que muestran los datos (sandbox)
- **Equipos**: 8 jefaturas configuradas, **todas de 1 persona**; 1 inactiva.
  En 3 equipos la persona **no tiene ninguna actividad** en SIGSO
  (prevencion3, operaciones, rrhhhomepymes): el jefe ve un panel vacío.
- `personal@homepymes.cl` es jefe de un equipo pero **ninguna cuenta con ese
  correo tiene el módulo** Mi departamento: la jefatura existe y nadie la ve.
- **El trabajo real del equipo son tareas de proyecto**: 92 de 100
  actividades son tareas de proyecto. El tablero de Mi departamento las
  ignora: el equipo de Luis Mendoza (13 tareas) aparece con **0** en el
  tablero.
- **Inconsistencia de alcance**: para un jefe que además es ADM, "Actividades
  del equipo" muestra **a toda la empresa** (80 actividades, 10 personas), no
  a su equipo.
- **Gerencia — el titular engaña**: "Atrasadas activas: **4**", pero 36 de 57
  ítems **no tienen fecha comprometida** (no cuentan) y en la Bandeja 33 de 37
  abiertos están **fuera de SLA**. El 40 % de "cumplimiento" se calcula sobre
  un subconjunto chico.
- Actividades: 20 % cumplidas a tiempo; carga concentrada (Valentina 54
  actividades, la siguiente persona 20). Pausas: 45 % de cumplimiento en 30
  días.
- **Proyectos no están en Gerencia**: 2 de las 3 cuentas GERENCIA no tienen
  el módulo Proyectos → no ven el portafolio, que es donde está el trabajo.
- `soporte@rld.cl` está en **dos cuentas** (Lu Soporte — GERENCIA y Angelo
  Tapia — DEV).
- Rendimiento: `getPanelGerencia` 213 ms / 77 KB (bien, tras M-01/M-03).

### Decisiones del dueño (2026-09-24)
- **Mi departamento centrado en las personas**: una tarjeta por persona con
  todo su trabajo (tareas de proyecto y personales, horas de la semana,
  solicitudes); acciones pedir actualización / reasignar / abrir.
- **Gerencia: resumen ejecutivo único** que junta solicitudes, proyectos
  (solo lectura, aunque la cuenta no tenga el módulo Proyectos), tareas y
  pausas; las vistas actuales quedan como detalle.
- **Atraso con ambas medidas**: "Fuera de plazo (SLA)" como titular +
  "atrasadas vs. fecha comprometida" + "sin fecha comprometida", explicadas.
- Orden: **4A Gerencia**, después **4B Mi departamento**.

### 4A Resumen ejecutivo de Gerencia — ESTADO: HECHO
- Backend: `getResumenGerencia` (`logica/resumenGerencia.js`), solo para rol
  ADM/GERENCIA o módulo `gerencia`. Bloques independientes (uno que falla no
  tumba el resto), cada uno delega en la función de su vista de detalle:
  solicitudes (`Dashboard.getCola` + `Gerencia.getPanel`: SLA, compromiso,
  sin fecha, sin triar, flujo 30 días, abiertos > 60 días, P1 abiertos),
  proyectos (`Proyectos.listar` con alcance Gerencia: salud, estado, avance,
  sin tareas, los que necesitan atención), tareas (`Actividades`: abiertas,
  atrasadas, por confirmar, % a tiempo, importantes atrasadas), personas
  (tareas + ítems abiertos por responsable) y pausas.
- Frontend: `js/gerencia-v2.js` + `css/v2/gerencia-v2.css`. "Resumen
  ejecutivo" es el primer ítem de Panel de gerencia con la v2 (y la entrada
  por defecto); tablero, línea de tiempo, actividades, pausas y reportes
  siguen siendo gerencia.js. `MODULOS_V2.gerencia`.
  - "Requiere tu atención": frases con destino (P1 abiertos, abiertos > 60
    días, proyectos críticos, proyectos que no salen de Planificación,
    tareas importantes atrasadas, concentración de carga ≥ 40 %).
  - Un crítico abre el panel de la Bandeja (solo lectura para GERENCIA); un
    proyecto abre el portafolio si la cuenta tiene el módulo.
- Números de hoy (sandbox): 32 de 36 fuera de SLA vs. 4 atrasadas contra
  compromiso y 30 sin fecha; 4 ingresaron y 1 se cerró en 30 días; 15 de 16
  proyectos en Planificación (11 sin tareas); Valentina concentra el 43 %.
