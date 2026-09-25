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

### 4B Mi departamento: "Mi equipo" centrado en las personas — ESTADO: HECHO
- Backend: `getMiEquipo` (`logica/miEquipo.js`). Solo el equipo configurado en
  JEFATURAS para quien pregunta (también para un ADM: se corrige que
  "Actividades del equipo" le mostrara a toda la empresa). Por persona:
  - tareas abiertas de proyecto y personales con el semáforo de Mi trabajo,
    ordenadas por lo que hay que mirar primero (atrasadas, bloqueadas, por
    confirmar); terminadas en 7 días; días sin movimiento;
  - horas que registró la persona en los últimos 7 días (y los 7 anteriores),
    con la regla de Mi trabajo (el REGISTRO_DIA manda sobre el check-in);
  - ítems de solicitudes a su cargo (y fuera de plazo) y lo que pidió y
    espera validar; `sin_actividad` y `tiene_cuenta`.
- Frontend: `js/jefatura-v2.js` + `css/v2/jefatura-v2.css`. "Mi equipo hoy"
  es el primer ítem de Mi departamento con la v2 (entrada por defecto);
  tablero de solicitudes, por persona, actividades y reportes siguen en
  jefatura.js. `MODULOS_V2.jefatura`.
  - KPIs del equipo, aviso si alguien con tareas no registró horas o no tiene
    ninguna actividad, y una tarjeta por persona: semana de horas (barras por
    día + comparación), solicitudes, tareas con "Pedir actualización" y
    "Reasignar" (mismos endpoints de siempre).
- Hallazgo al implementar: **casi nadie registra horas** (Ignacio Valdivia:
  2 registros con horas en total). El panel lo dice en vez de mostrar un 0
  silencioso.

---

## Módulo 5 — Pausas activas + Coordinación: análisis

### Qué hacen hoy
- **Pausas activas** (`pausas.js`, 205 líneas): el trabajador ve la pausa de
  hoy y declara "Participé" (con declaración y ánimo 1–5 opcional) o "No pude"
  (con motivo). Nada más: no ve su historial.
- **Coordinación** (`coordinacion.js`, 556 líneas): Hoy (iniciar / finalizar /
  no realizada, participación en vivo, pasar lista) · Historial por
  trabajador · Reportes de cumplimiento. Backend `pausas.js` (1.223 líneas):
  programación diaria automática, recordatorios, aviso al coordinador y
  escalamiento al administrador.

### Lo que muestran los datos (sandbox: 27-jul → 21-sep, 1 empresa, 7 personas)
- **El programa se cayó en septiembre**: 20 pausas realizadas en agosto, 5 en
  septiembre; **10 días hábiles sin pausa** entre el 7 y el 21. Todos esos
  días el sistema mandó recordatorio, aviso al coordinador y **escalamiento al
  administrador**, y las tres coordinadoras entraron a SIGSO esos días. Los
  avisos no bastan.
- **Depende de una sola persona**: 29 de 31 pausas las inició Amarlla; la
  otra titular (Camila) y la reemplazante (Marisol) **nunca iniciaron una**.
- **Se inicia tarde**: la mitad empieza 7+ minutos tarde; varias 16–48 min y
  dos 4 horas después de la hora.
- **Se declara de memoria**: la mitad declara 16+ minutos después de
  iniciada, el 10 % más de 46 min después.
- Participación por persona (sobre 30 realizadas): Vanessa 26, Francisca 24,
  Bárbara 22, Marisol 19, Lisseth 14; Luis Mendoza y Valentina están en la
  lista y casi nunca declaran (2 y 1).
- Motivo más frecuente de no participar: **"En reunión" (10)**, luego "Otro"
  (7) y "Atendiendo un cliente" (6): la hora (12:00) choca con el trabajo.
- **Ánimo**: se contestó en 40 de 153 participaciones y **16 de esas 40 son
  "Muy mal"** (5 personas distintas). Nadie ve ni sigue esa señal hoy.
- Las pausas no realizadas no registran motivo; el 21-sep hay **dos pausas
  programadas el mismo día** (dato duplicado).

### Decisiones del dueño (2026-09-24)
- **Cualquiera puede iniciar la pausa** si la coordinación no llega: desde la
  hora + 5 min, cualquier persona de la lista puede iniciarla; queda
  registrado quién (`iniciada_por`).
- **Ánimo como señal en Coordinación**: con nombre, solo para la
  coordinación, sin correos.
- **Trabajador**: declarar desde el Inicio en un toque + su historial.
- Orden: **5A Coordinación**, después **5B Pausas del trabajador + Inicio**.

### 5A Coordinación de pausas "Hoy" — ESTADO: HECHO
- Backend (`logica/pausas.js`): columna nueva `iniciada_por` en
  PAUSAS_PROGRAMADAS (la coordinación al iniciar y el participante);
  `iniciarPausaParticipante` (solo personas de la lista, solo pasada la
  tolerancia de 5 min, solo si está Programada/Recordatorio enviado);
  `getPausaHoyTrabajador` suma `en_lista`, `puede_iniciar`, `iniciar_desde`;
  `getPanelCoordinador` suma `ultimos_dias` (20 pausas resueltas con
  participación, atraso y quién la inició), `quien_inicia` (60 días) y
  `animo_alertas` (Mal/Muy mal en 14 días, por persona).
- Frontend: `js/coordinacion-v2.js` + `css/v2/coordinacion-v2.css`
  (`MODULOS_V2.pausas_coordinacion`): la pausa de hoy dice si va tarde y quién
  la inició, con iniciar / finalizar (observaciones + foto) / no realizada /
  pasar lista (con motivo por persona) / ver evidencia; franja de las últimas
  20 pausas (avisa si las últimas no se realizaron); "Quién inicia" (avisa la
  dependencia ≥ 70 %); "Ánimo: para acercarse". Historial por trabajador y
  Cumplimiento siguen en coordinacion.js.

### 5B Pausas del trabajador + Inicio — ESTADO: HECHO
- Backend: `getMiHistorialPausas` (60 días; mismo cálculo que "Historial por
  trabajador" de la coordinación, extraído a `calcularHistorialTrabajador_`).
- Frontend: `js/pausas-v2.js` + `css/v2/pausas-v2.css` (`MODULOS_V2.pausas`):
  - la pausa de hoy con su momento (a qué hora, si va tarde, quién la
    inició), **"Iniciar la pausa"** cuando la coordinación no llegó (5A), y
    declarar en un toque: "Declaro que participé" (con ánimo opcional) / "No
    pude" (motivo en un toque); "Cambiar" mientras admite registros;
  - su historial: % de participación, racha actual y máxima, sin registrar y
    las últimas 20 pausas.
  - **Inicio**: la misma tarjeta, compacta, arriba de todo cuando hay algo
    que hacer (declarar o iniciar); desaparece al registrar.
- **Transparencia del ánimo**: tanto la v2 como la pantalla clásica ahora
  dicen que "Mal"/"Muy mal" lo ve la coordinación. Las respuestas anteriores
  se dieron sin ese aviso (la regla vieja RN-708 era solo promedio).

---

## Módulo 6 — Novedades: análisis

### Qué hace hoy
`novedades.js` (1.201 líneas) + backend `novedades.js` (835): Publicadas
(feed con acuse de lectura) · Por aprobar · Mis envíos · Cumplimiento de
lectura. Dos tipos: **LEY** (la redacta cualquiera, pasa por aprobación de su
jefatura) y **AVISO** (publicación directa de jefatura/ADM, con fecha límite
de acuse). Audiencia: todos, mi equipo o personas seleccionadas.

### Lo que muestran los datos (sandbox)
- **Casi no se usa**: 7 novedades en total; la última publicada el 9-sep.
- **Ninguna Ley llegó a publicarse**: 4 redactadas por el equipo (31-jul a
  3-ago); 3 **devueltas** y 1 rechazada. Dos de las tres devoluciones piden
  lo mismo — **"el link de donde sacaste la información"** — y el formulario
  **no tiene un campo de fuente**. Ninguna devuelta se volvió a enviar: el
  autor no tiene dónde ver que se la devolvieron (salvo el correo).
- **Acuse de lectura a medias**: los 3 avisos publicados (todos con acuse
  obligatorio) llegaron al 56 %, 63 % y 50 % de su audiencia. Las mismas
  personas no acusan nunca. **Ya existe un recordatorio diario** (09:00, un
  correo por persona con todo lo pendiente) y aun así no alcanza: el acuse se
  hace entrando al módulo, y el recordatorio también le llega a quien no
  tiene cuenta (no puede cumplir). _Corrección: la primera versión de este
  análisis decía que no había recordatorio; sí lo hay._
- **Audiencias que no pueden cumplir**: se seleccionan personas **sin cuenta
  en SIGSO** o que nunca entraron (p. ej. vcaballero, rrhhhomepymes,
  homepymes89): quedan como "no leyó" para siempre.

### Decisiones del dueño (2026-09-24)
- **Leyes: campo "Fuente" obligatorio + devueltas visibles** (Inicio y Mis
  envíos del autor, con motivo y "Corregir y reenviar").
- **Leer y acusar desde el Inicio + recordatorio**: el recordatorio diario ya
  existía; se ajusta para no escribir a quien no puede acusar.
- **Audiencia**: avisar al publicar quién no tiene cuenta y separarlo del
  cumplimiento.
- Fases: **6A lectura**, **6B publicación**.

### 6A Novedades: lectura — ESTADO: HECHO
- **Bug corregido** (existía antes de v2): `diasParaVencer_` concatenaba
  "T00:00:00" a una fecha que ya venía en ISO con hora → fecha inválida →
  el plazo de acuse **nunca se calculaba**; el panel de Cumplimiento
  mostraba como "al día" avisos vencidos hace semanas y el feed no decía
  "vence en…". Ahora compara por día calendario de Chile.
- Backend: la audiencia marca `sin_cuenta` (no está en una cuenta activa del
  portal — hoy solo se entra con cuenta) y `nunca_entro`; `getLectores`
  separa `pendientes_sin_cuenta`; Cumplimiento no los cuenta como pendientes
  (`sin_cuenta` aparte); el recordatorio diario no les escribe.
- Frontend: `js/novedades-v2.js` + `css/v2/novedades-v2.css`
  (`MODULOS_V2.novedades`): "Publicadas" con lo que te falta confirmar
  arriba (por plazo), filtros por tipo y lista; **panel de lectura** con
  cuerpo, adjunto y "Confirmo que la leí"; el autor ve "Quién la leyó"
  (leyeron / faltan / sin cuenta). El Inicio lista las pendientes y abre el
  mismo panel. Publicar, Por aprobar, Mis envíos y Cumplimiento siguen en
  novedades.js hasta 6B.

### 6B Novedades: publicación — ESTADO: HECHO
- Backend: columna `fuente_url` en NOVEDADES; **Ley y Dictamen exigen el
  enlace a la fuente oficial** (http/https) al publicar y al reenviar;
  `getFeed`/`getDetalle`/Mis envíos la devuelven. El directorio para elegir
  audiencia marca `sin_cuenta` y `nunca_entro`. `getInicio` suma el bloque
  `novedades_devueltas` (lo que me devolvieron para corregir).
- Frontend: los formularios de Publicar y Corregir y reenviar (novedades.js)
  tienen "Fuente oficial (enlace)", obligatoria en Ley/Dictamen; al elegir
  personas se avisa "sin cuenta en SIGSO: no podrá confirmar" / "nunca ha
  entrado". El **Inicio** muestra "Tus publicaciones devueltas" con el motivo;
  el panel de lectura v2 muestra el motivo y "Corregir y reenviar".
- Probado en sandbox: la Ley 21.822 de Amarlla (devuelta el 3-ago pidiendo
  el link) se corrigió con la fuente desde el Inicio y volvió a revisión.

---

## Módulo 7 — Administración: análisis

### Qué hace hoy
`admin.js` (2.044 líneas), solo para ADM (2 cuentas): 15 pantallas en 6
grupos — Organización (empresas, plataformas, áreas, jefaturas), Catálogos
(módulos, tipos), Accesos (cuentas plataforma, usuarios legado),
Comunicaciones (notificaciones, alertas en vivo, canales, enviar alerta),
Operación (pausas) y Reportes; más el Panel de datos del super admin. Cada
pantalla es un CRUD aislado: **nada le dice al administrador qué está mal
configurado**, y la configuración de una cosa depende de otra (una jefatura
necesita que el jefe tenga cuenta Y el módulo; la lista de pausas necesita
cuenta Y módulo…).

### Lo que muestran los datos (sandbox, 20 cuentas activas)
Todo lo que fui encontrando módulo a módulo era, en el fondo, configuración
de Administración que nadie veía:
- **12 de 20 cuentas activas siguen con clave temporal** ("debe cambiar la
  clave"): Lisseth, Francisca, Vanessa, Marisol, Leo, Hernán, Felipe, …
  6 cuentas no entran hace más de 30 días y 2 nunca entraron.
- **Jefaturas mal armadas**: el jefe de una (comercial@grupohb.cl) no tiene
  cuenta activa y su subordinada tampoco; Vanessa (personal@homepymes.cl) es
  jefa pero no tiene el módulo Mi departamento.
- **Pausas**: 4 cuentas tienen el módulo Pausas pero no están en la lista de
  su empresa (Camila, Amarlla, Scarlett, Luis Homepymes) — ven "no estás en
  la lista".
- **Directorio legado**: una persona está activa en USUARIOS (el sistema
  viejo de Google) sin cuenta del portal (Valentina, vcaballero): aparece en
  audiencias y equipos pero no puede entrar.
- **Datos de plantilla** en producción: SOL-2026-GDE-0005 con responsable
  "[CORREO_LEO]" y solicitante "[CORREO_LUIS]".
- _Actualización_: el correo `soporte@rld.cl` ya no está repetido entre
  cuentas **activas** (la de Angelo está desactivada).

### Decisiones del dueño (2026-09-24)
- **Salud + Cuentas v2**: 7A portada "Salud de la configuración"; 7B "Cuentas
  plataforma" rediseñada; el resto de las pantallas queda como está.
- **Arreglo en un clic con confirmación** para los casos simples; los que
  requieren criterio llevan a su pantalla.
- **Claves temporales**: se muestran y se puede generar una nueva desde ahí.

### 7A Salud de la configuración — ESTADO: HECHO
- Backend: `logica/saludConfig.js` — `getSaludConfig` (solo ADM) revisa
  cuentas (clave temporal, sin entrar > 30 días, correo repetido, legado sin
  cuenta), jefaturas (jefe sin cuenta, jefe sin módulo, subordinado sin
  cuenta, módulo sin equipo), pausas (en la lista sin cuenta / sin módulo,
  módulo sin estar en la lista, coordinador sin módulo) y datos (plantillas
  "[CORREO_…]" en solicitudes, áreas sin responsable).
  `arreglarSaludConfig` aplica dar/quitar módulo, agregar a la lista de
  pausas y generar clave temporal **pasando por las mismas funciones de
  Administración** (CuentasPortal.gestionar, Pausas.gestionarTrabajador).
- Frontend: `js/admin-v2.js` + `css/v2/admin-v2.css`
  (`MODULOS_V2.administracion`): "Salud" es el primer ítem de Administración
  con la v2; cada problema con su explicación, "Ir a…" y sus arreglos (con
  confirmación; la clave nueva se muestra una sola vez con "Copiar").
- Sandbox: 22 casos (2 críticos: la jefatura de comercial@grupohb.cl sin
  jefe activo y SOL-2026-GDE-0005 con datos de plantilla); 17 con arreglo.

### 7B Cuentas de la plataforma v2 — ESTADO: HECHO
- Frontend (sin backend nuevo: `listarCuentasPortal` / `gestionarCuentaPortal`
  de siempre + `getSaludConfig` para cruzar problemas): en `admin-v2.js`,
  "Cuentas plataforma" con la v2 activa.
  - KPIs: activas, entraron esta semana, con clave temporal, con problemas
    (según la Salud). Filtros: activas · clave temporal · sin entrar 30+ días
    · con problemas · desactivadas; búsqueda y rol.
  - Cada persona: rol, cuántos módulos, estado de acceso ("entró hace 9
    días", "nunca entró", "clave temporal") y sus problemas.
  - Panel lateral: lo que la Salud detectó de esa cuenta; acceso (usuario,
    estado, último acceso) con generar clave temporal, asignar clave, cambiar
    usuario, activar/desactivar y eliminar (sugiere desactivar); datos
    (nombre, cargo, correos, rol, empresa) y módulos como chips. Crear cuenta
    muestra la clave temporal una sola vez.
- Las demás pantallas de Administración siguen en admin.js.

---

## Módulo 8 — Calidad (SGC ISO 9001): análisis

### Qué hace hoy
El módulo más grande de SIGSO: `calidad.js` 9.872 líneas, ~20 secciones en
7 grupos (Inicio · Documentos · Personas/Capacitaciones · Seguimiento y
mejora: NC, quejas, auditorías, revisión por la dirección · Medición:
indicadores, objetivos · El sistema: alcance, contexto, procesos, riesgos,
cobertura ISO · Operación: servicios, proveedores · Reportes · Accesos).
13 cuentas tienen el módulo.

### Lo que muestran los datos (sandbox)
- **Uso muy desparejo**: Documentos (44 documentos reales, 42 versiones, 48
  acuses) y Personas (20 fichas, 16 evaluaciones, 49 documentos de ficha)
  se usan; **No conformidades, Auditorías, Quejas e Indicadores están en 0**
  (tampoco hay acuerdos de revisión por la dirección).
- **Cobertura ISO hoy: 5 cláusulas completas, 8 parciales y 15 faltantes de
  28.** Faltan, entre otras, 5.1–5.3 (liderazgo, política, roles), 6.2
  objetivos, 7.1, 7.3, 9.1 seguimiento y medición, **9.2 auditoría interna**
  (la del 24-ago se ensayó pero nunca se registró), 10.2 no conformidades.
  El histórico semanal pasó de 34 % (7-sep) a 0–4 % (14 y 21-sep).
- **Acuse de documentos a medias**: la **Política de Calidad** la
  confirmaron 6 de 16 personas; los Organigramas 6/16 (plazo vencido el
  10-sep); "Misión y Visión" 0/16 (plazo vencido el 23-sep).
- **Inducciones: 100 registradas, las 100 "pendientes"** (0 realizadas).
- **154 filas vacías** en SGC_DOCUMENTOS (sin código ni nombre, inactivas):
  basura de la importación desde Excel.
- **Por verificar en producción**: la memoria del proyecto dice que al pasar
  a Node "SGC_* no se migró"; el sandbox tiene los datos por un script de
  migración aparte. Conviene confirmar que producción tenga lo mismo.

### Decisiones del dueño (2026-09-24)
- **Alcance**: Inicio + Documentos + Personas en v2 (8A Inicio "camino a la
  certificación", 8B Documentos, 8C Personas). Las demás secciones siguen
  igual; el Inicio las guía con un "Ir a".
- **Certificación**: guía con el **próximo paso por cláusula** (no solo el %).
- **Acuses**: confirmar documentos **desde el Inicio de SIGSO** (como
  Novedades); el encargado ve quién falta por documento.
- **Inducciones**: se hacen pero no se registran → 8C permite marcarlas
  realizadas por persona y en lote; jefatura/encargado ven las pendientes.

### 8A Inicio de Calidad "Camino a la certificación" — ESTADO: HECHO
- Backend `logica/caminoSgc.js`:
  - `getCaminoCertificacionSgc`: sobre la matriz de cobertura, cada cláusula
    trae su **próximo paso** y la sección que lo resuelve; resumen por
    capítulo (4-10); **cumplimiento de acuse de todos los documentos en un
    viaje** (quién falta, separando a quien no tiene cuenta activa); y
    **sugerencias de etiquetas ISO** por el nombre del documento.
  - Lo ve quien supervisa el SGC (misma llave que el tablero clásico:
    Encargado, ADM, Dirección, Gerencia); etiquetar es solo de quien lo
    gobierna.
  - `efecto_sugerencias`: el efecto REAL de confirmar todas las sugerencias
    (se aplican dentro de una transacción que siempre se revierte). En el
    sandbox: **32 % → 45 %, mejoran 4.3, 5.1, 5.2, 5.3 y 8.2**. Hallazgo que
    lo motivó: ninguno de los 38 documentos vigentes tenía cláusulas
    etiquetadas, así que la cobertura contaba como faltante lo que existe.
  - `aplicarEtiquetasSgc`: suma (no reemplaza) las cláusulas elegidas, vía
    `Calidad.actualizarDocumento` (mismas reglas y permisos).
- **Fix de bug previo** (`calidadSgc.diasHasta_`): restaba instantes UTC; un
  plazo "23-sep" consultado el 24 a las 22:00 de Chile decía "venció hace 2
  días". Ahora cuenta días de calendario de Chile (mismo arreglo que
  Novedades en 6A). Afecta también a los recordatorios y la revisión anual.
- Frontend `js/calidad-v2.js` (+ `css/v2/calidad-v2.css`), cargado con el
  shell (calidad.js es diferido y el Inicio de SIGSO lo necesita):
  - Anillo "listo para certificar", capítulos como filtro, **Próximos pasos**
    (faltantes primero) con "Ir a <sección>", **Sube tu cobertura en un
    clic** (chips por cláusula que se pueden quitar, confirmación) y
    **Confirmaciones de lectura** (barra por documento; panel con quién falta,
    "nunca entró" y sin cuenta).
  - Quien no supervisa ve "lo tuyo": documentos por confirmar y atajos.
  - Panel de lectura y acuse (`SigsoCalidadV2.abrirDocumento`): descargar,
    "Confirmo que lo leí"; el **Inicio de SIGSO** lista los documentos por
    confirmar y abre el mismo panel (evento `sigso:sgc-acuse`).
  - calidad.js: la sección 'inicio' se delega a la v2 si está activa;
    `MODULOS_V2.calidad` para el interruptor.
- Arreglo transversal de `componentes-v2.css`: `.sx2-barra` y su relleno son
  `<span>`; sin `display:block` el ancho del relleno se ignoraba cuando el
  padre no los volvía bloque (barras vacías).

### 8B Documentos — análisis (sandbox, 44 documentos activos)
- **Qué hace hoy** (calidad.js): buscador, segmentos por tipo, filtro
  "solo por confirmar", detalle en página aparte con ver/descargar, acuse,
  nueva versión, editar, etiquetar cláusulas, "quién confirmó" (lista de
  correos), obsoleto/vigente, historial de versiones. Funciona bien para
  CONSULTAR; lo que falta es el CONTROL documental que pide la norma.
- **27 de 44 no tienen archivo controlado**: todos los procedimientos y
  formularios se abren por un enlace a Google Docs **editable**
  (`/edit?usp=sharing`). La norma (7.5.3) pide que la versión vigente esté
  protegida de cambios no intencionados; un enlace editable no lo garantiza.
  PRO-10 y FO-PRO-10-01 no tienen ni archivo ni enlace.
- **43 de 44 sin "Revisado por" ni "Aprobado por"** (7.5.2 exige evidencia
  de revisión y aprobación). Solo uno dice "Rogelio Álvarez".
- **Las 6 normas externas (ISO 9001, ISO 19011, DS 44, Ley 16.744, DS 594,
  Código del Trabajo) están marcadas OBSOLETO** → el personal no las ve.
  Parece un error de la importación: siguen vigentes.
- Solo **9 documentos exigen acuse**, todos con plazo; los acuses se juntan
  en septiembre (47 de 49).
- Todos los documentos tienen visibilidad "Todos" y próxima revisión
  2027: la revisión anual no aprieta todavía.
- Descargas registradas: 8, todas de una cuenta de administración → el
  personal no descarga; si abre, lo hace por el enlace (no queda registro).
- 154 filas vacías en SGC_DOCUMENTOS (basura de importación, inactivas).

#### Decisiones del dueño para 8B (2026-09-24)
- Revisión y aprobación: **completar en lote** (la ficha marca "Falta
  aprobación" mientras tanto).
- Enlaces de Google Docs: **aceptar el enlace, avisar "Sin copia
  controlada" y pedir el PDF** desde el panel; el personal no nota cambios.
- Normas externas obsoletas: **botón "Volver a vigente" en lote** para el
  encargado (no se tocan datos de producción por fuera).
- Diseño: **lista + panel lateral + pestaña "Control documental"**.

### 8B Documentos v2 — ESTADO: HECHO
- Backend:
  - `calidadSgc.alertasControlSgc_` (una sola fuente): `sin_aprobacion`
    (vigente interno sin revisado/aprobado), `sin_copia` (vigente interno
    sin archivo), `externo_fuera` (norma externa obsoleta), `revision`
    (revisión anual vencida o a ≤ 60 días). `listarDocumentosSgc` y
    `getDocumentoSgc` las exponen en `control` solo a quien gobierna.
  - Columna nueva `SGC_DOCUMENTOS.fecha_aprobacion`: se registra al poner
    "Aprobado por" (también desde el formulario clásico).
  - `logica/controlDocumentalSgc.js`: `getControlDocumentalSgc` (grupos,
    totales y los nombres ya usados como firmantes, para sugerirlos) y
    `actualizarDocumentosEnLoteSgc` (solo revisado/aprobado/elaborado/
    fecha/estado; cada cambio pasa por `Calidad.actualizarDocumento`).
- Frontend `js/calidad-documentos-v2.js` (cargado con el shell):
  - Lista con buscador instantáneo (sin tildes), tipos con recuento,
    "por confirmar", estado (gestión) y "con pendientes de control".
  - Panel del documento: acuse, alertas de control con su arreglo en el
    mismo lugar (registrar aprobación, subir PDF, volver a vigente, aviso de
    revisión anual), ver/descargar, enlaces (marca "Editable" al gestor),
    ficha con fecha de aprobación, cláusulas, quién falta por confirmar con
    nombres, historial de versiones. Es el mismo panel que abre el Inicio.
  - Control documental: KPIs + registrar revisión y aprobación en lote
    (marcar/desmarcar), lista sin copia controlada con "Abrir"/"Subir PDF",
    normas externas → "Volver a vigente" en lote, revisión anual.
  - Cargar, editar, nueva versión y cláusulas reutilizan los formularios
    clásicos (`SigsoCalidad.formulario`); al guardar vuelven a la v2.
  - El interruptor clásica/nueva ya no saca de la sección actual.
- Sandbox: 35 documentos aprobados en un lote (quedó 1, el desmarcado) y las
  6 normas externas vueltas a vigente. La subida de PDF no se pudo probar en
  el sandbox (sin almacenamiento R2); el error llega bien a la pantalla.
- Arreglo transversal: `.sx2-flex > .sx2-barra` ocupa el espacio (la barra
  de "Quién la leyó" de Novedades también medía 0).

### 8C Personas — análisis (sandbox, 16 personas activas)
- **Qué hace hoy** (calidad.js): lista de fichas y una ficha con 5 partes
  (datos, descriptor de cargo, carpeta de documentos, inducción,
  competencias); Capacitaciones aparte. La inducción se marca **de a un ítem
  y siempre con fecha de hoy** ("Marcar completada"): no sirve para dejar
  registro de inducciones hechas en el pasado, que es el caso real.
- **Inducción: 100 ítems, los 100 PENDIENTES** (5 ítems × 20 fichas; 80 de
  las 16 activas). Nadie la registró nunca.
- **Evaluaciones: 16, una por persona.** 13 vienen de la importación **sin
  fecha y sin próxima evaluación**; **14 dicen "requiere capacitación" y 12
  de ellas tienen promedio ≥ 3** (la regla del sistema es < 3; p. ej. 3,5/4
  → "requiere"). Con la regla, solo 2 la requieren (2,75).
- Capacitaciones: 2 (1 programada, 1 realizada con 1 asistente) → la meta
  de 5 h/año de formación la cumple casi nadie.
- Descriptores de cargo: todos tienen uno vigente (16 con funciones como
  lista, evaluables). Carpeta: 48 documentos en 12 personas.
- Datos desparejos: áreas con dos nombres (ADMINISTRACION y "Administración
  y Finanzas", PREVENCION y "Dept. Prevención de Riesgos"); la jefatura de
  Rogelio aparece con dos correos (ralvarez@grupohb.cl y
  alvarez.roge@gmail.com); 4 correos con dos fichas (una por cargo, a
  propósito).

#### Decisiones del dueño para 8C (2026-09-24)
- Fecha de las inducciones registradas en lote: **la que se indique, por
  defecto la fecha de ingreso** de cada persona (o una fecha común); nunca
  futura.
- Evaluaciones importadas: **mostrar "requiere capacitación" según la regla
  (promedio < 3) y avisar**; no se tocan los datos.
- Alcance: **lista + panel + "Inducciones" en lote**; descriptor, carpeta y
  evaluación se siguen editando en la ficha completa.
- Registran: **Encargado SGC (todos) y cada jefatura (su equipo)**.

### 8C Personas v2 — ESTADO: HECHO
- Backend `logica/personasPanelSgc.js`:
  - `getPanelPersonasSgc`: sobre `Personas.listar` (mismos permisos), la
    inducción ítem por ítem, la última evaluación con "requiere
    capacitación" calculado por la regla y `difiere_de_regla`, evaluación
    sin fecha/vencida, carpeta, horas de formación del año, si puede
    registrar su inducción y un resumen; también `secciones_visibles` para
    el árbol.
  - `registrarInduccionesEnLoteSgc`: personas × ítems con fecha (no futura,
    guardada a mediodía UTC para que el día no se corra); cada ítem pasa por
    `Personas.registrarInduccion`; crea la fila del ítem si la ficha no la
    tenía.
  - `Personas.registrarInduccion` (uno a uno) ahora también rechaza fechas
    futuras.
- Frontend `js/calidad-personas-v2.js` (cargado con el shell):
  - Lista con KPIs clicables (inducción completa, sin evaluación o sin
    fecha, requiere capacitación, formación ≥ 5 h), aviso de evaluaciones
    importadas que no calzan con la regla, buscador, barra de inducción x/5.
  - Panel de la persona: datos, inducción con casillas + fecha (por defecto
    el ingreso) + "Marcar todos" + "Deshacer" por ítem, competencias, y
    "Abrir ficha completa" (la clásica; "← Personal" vuelve a la v2).
  - Pestaña "Inducciones": matriz personas × 5 ítems (clic en un nombre =
    fila, en un ítem = columna), fecha por ingreso o común, "solo con
    pendientes"; la jefatura ve solo a su equipo.
  - Quien solo se ve a sí mismo sigue entrando directo a su ficha.
- Sandbox: 36 ítems registrados (5 en un panel, 31 en un lote) → 80 → 45
  pendientes; deshacer probado; fecha futura bloqueada; Bárbara (jefatura)
  registra solo a sus 6; Amarlla (operativa) entra a su ficha.

**MÓDULO 8 COMPLETO** (8A `4df9abe`, 8B `fae83d8`, 8C). Siguiente: Módulo 9,
marco del shell.

---

## Módulo 9 — Marco del shell: análisis

### Qué hay hoy
- **Sidebar** (v1, azul marino): marca, colapsar, árbol de módulos, pie con
  versión, modo oscuro y menú de usuario (perfil, cerrar sesión). En celular
  el sidebar es un cajón que se abre desde una barra superior (hamburguesa +
  marca). No hay barra superior en escritorio.
- **Buscar y saltar** (Ctrl+K) y hoja de atajos (?): existen, pero no hay
  ningún botón visible que los abra.
- **Notificaciones**: campana **flotante** abajo a la derecha (52 px) con su
  panel, y un **aviso azul fijo arriba** cuando el navegador bloquea las
  alertas; el aviso vuelve en cada sesión.
- **Interruptor v2** "Volver a la versión clásica": píldora flotante abajo al
  centro, en todos los módulos migrados.

### Lo que muestran los datos (sandbox, 20 cuentas activas)
- **Alertas del navegador: 8 cuentas "bloqueadas", 0 "permitidas"** (las
  otras 12 nunca respondieron). Las alertas del sistema operativo no le
  llegan a nadie; el aviso azul se le muestra a todos en cada sesión.
- **Notificaciones dentro de SIGSO: 52, solo 1 marcada leída.** La campana
  flotante no está funcionando como canal.
- Módulos por cuenta: de 3 a 11 (mediana 7).
- Visual: el aviso azul **tapa el saludo del Inicio** en escritorio y **tapa
  la hamburguesa en celular** (no se puede abrir el menú sin cerrarlo). La
  campana y la píldora flotantes **tapan contenido** abajo a la derecha
  (p. ej. "Todo mi trabajo"). En celular los KPI v2 van de a uno por fila:
  el Inicio ocupa 5 pantallas de tarjetas antes de lo importante.

### Decisiones del dueño (2026-09-25)
- Notificaciones: **campana en el marco** (sidebar y barra superior del
  celular) con panel lateral v2; el permiso del navegador se explica
  **dentro del panel**, sin tapar la pantalla.
- Interruptor clásica/nueva: **al menú de usuario**.
- Celular: **barra inferior con 4 destinos** (Inicio, Mi trabajo, Buscar,
  Menú) y KPIs de a dos.
- Sidebar: **oscuro, afinado al estilo v2**, con botón "Buscar (Ctrl+K)".
- Orden: 9A avisos + interruptor → 9B sidebar, buscar y celular.

### 9A Campana en el marco + interruptor al menú — ESTADO: HECHO
- `notificaciones-vivas.js`: en la plataforma (`modoMarco_`: hay huecos
  `.js-shell-campana` y UIv2) la campana va en el encabezado del sidebar y
  en la barra superior del celular, con contador; el panel es un drawer v2
  (avisos con "Ir"/"Marcar leída", "Marcar todas", sonido) y el permiso del
  navegador se explica arriba del panel (activar si está en "preguntar";
  pasos si está bloqueado). Ya no se crea el aviso azul fijo ni la campana
  flotante. `app.html` (sin huecos) queda como estaba.
- `plataforma.js`: el interruptor es el ítem `#py2-interruptor` del menú de
  usuario ("Usar la versión clásica / nueva de este módulo"), visible solo
  en módulos migrados.
- `css/v2/shell-v2.css` (nuevo) y `.sx2-drawer__pie` con `flex-wrap` (el
  pie de los paneles con 3+ botones se salía del panel).
- Verificado en sandbox: saludo del Inicio ya no queda tapado; en celular
  la hamburguesa es clicable; Valentina ve sus 3 avisos, "Marcar leída" e
  "Ir" funcionan; sidebar colapsado con campana; interruptor en el menú en
  ambos sentidos.

### 9B Sidebar v2, Buscar y celular — ESTADO: HECHO
- Sidebar: sigue oscuro (la marca), con tipografía, espaciado, radios e
  indicador de ítem activo al estilo v2 (`#vista-shell` en shell-v2.css,
  sin tocar app.html).
- Botón **"Buscar · Ctrl K"** bajo la marca: abre la búsqueda (existía solo
  por teclado). En Mac muestra ⌘K. Colapsado queda solo la lupa.
- **Barra inferior en celular** (≤ 900 px): Inicio · Mi trabajo (o
  Solicitudes si la cuenta no tiene Mi trabajo) · Buscar · Menú; marca el
  destino activo; el contenido deja espacio para que no la tape.
- **KPIs de a dos en celular** (≤ 600 px) en todos los módulos v2.

**MÓDULO 9 COMPLETO** (9A `66d86c5`, 9B). Con esto se termina el orden
acordado (módulos 1–9). Pendiente de la hoja de ruta: retirar las
versiones clásicas tras un ciclo.

---

## Plan para retirar las versiones clásicas (propuesta, 2026-09-25)

### Dónde estamos
- Los 9 módulos tienen v2 **predeterminada desde el 24–25 de septiembre**
  (Proyectos también desde el 24, F8). Ningún módulo cumplió todavía "un
  ciclo".
- La clásica sigue viva detrás de "Usar la versión clásica de este módulo"
  (menú de usuario). La preferencia se guarda **solo en el navegador**: hoy
  no sabemos quién la usa ni por qué.
- `app.html` (acceso con Google / Apps Script) carga los módulos clásicos
  `dashboard.js`, `detalle.js`, `gerencia.js`, `jefatura.js`,
  `novedades.js`, `actividades.js`, `proyectos.js` y `calidad.js`. Su
  retiro depende de apagar Apps Script (falta la cuenta de portal de
  Valentina Caballero).
- La v2 **todavía usa** piezas clásicas: formularios de Calidad
  (`SigsoCalidad.formulario/abrirFicha/ver…`), de Novedades
  (`abrirPublicar/abrirReenviar…`), `SigsoDashboard.imprimirPauta`,
  `SigsoProyectos.abrirFormularioDesdeSolicitud` y los `irAItem`/árboles de
  Gerencia, Mi departamento, Coordinación y Administración.

### Tres niveles de "retirar"
1. **Quitar el interruptor** del módulo: la v2 queda como única vista de lo
   migrado. Cambio chico, se revierte con un `git revert`.
2. **Borrar las pantallas clásicas reemplazadas** dentro de archivos que
   siguen vivos (porque tienen secciones no migradas o formularios que la
   v2 reutiliza).
3. **Borrar archivos clásicos enteros** (y su CSS). Bloqueado por
   `app.html` y por las funciones compartidas de arriba.

### Criterio para retirar un módulo
- ≥ 3 semanas como predeterminada;
- nadie usó la clásica en la última semana, o quienes la usaron dijeron qué
  les faltaba y se resolvió;
- sin errores abiertos del módulo v2;
- checklist de paridad (todo lo que hacía la clásica tiene equivalente).

### Fase 0 — medir antes de retirar (≈ 1 día)
- Registrar en el servidor cada cambio de versión (quién, módulo, cuándo) y
  una pregunta opcional al volver a la clásica: "¿Qué te faltó en la nueva?".
- En Administración → Salud: "Quién usa versiones clásicas".
- En la clásica, un aviso: "Esta versión se retira el <fecha>".

### Inventario por módulo
| Módulo | Clásica | Retiro posible | Bloqueo |
|---|---|---|---|
| Inicio | `inicio.js` (570 líneas) | Nivel 3 | ninguno (app.html no lo carga) |
| Pausas (trabajador) | `pausas.js` (208) | Nivel 3 | ninguno |
| Mi trabajo | `actividades.js` (333) | Nivel 1 ahora, 3 después | app.html |
| Mis solicitudes | vista en plataforma de `estado.js` | Nivel 1–2 | `estado.js` se queda (estado.html público) |
| Nueva solicitud | sin piel v2 | Nivel 1 | `formulario.js` se queda (index.html público) |
| Proyectos | `proyectos.js` (8.041) + 476 reglas `.sigso-py-*` | Nivel 1 ahora, 3 después | app.html + 2 funciones usadas por la v2 |
| Bandeja | `dashboard.js` + `detalle.js` (2.512) | Nivel 1–2, 3 después | app.html + `imprimirPauta` |
| Gerencia / Mi depto | portada clásica de `gerencia.js` / `jefatura.js` | Nivel 1–2 | resto de secciones siguen |
| Coordinación | "Hoy" de `coordinacion.js` | Nivel 2 | historial/cumplimiento siguen |
| Novedades | feed de `novedades.js` | Nivel 2 | publicar/aprobar/mis envíos siguen |
| Administración | Cuentas de `admin.js` | Nivel 2 | resto de Administración sigue |
| Calidad | Inicio, lista/detalle de Documentos y lista de Personas de `calidad.js` (9.952) | Nivel 2 | formularios y demás secciones siguen |

### Tandas propuestas (fechas con ciclo de 3 semanas)
- **Tanda 1 — 15 oct**: Inicio, Pausas del trabajador, Mis solicitudes,
  Nueva solicitud, Mi trabajo y Proyectos (niveles 1–3 según la tabla).
- **Tanda 2 — 22 oct**: Bandeja, Gerencia, Mi departamento, Coordinación,
  Novedades, Administración (niveles 1–2).
- **Tanda 3 — 29 oct**: Calidad (nivel 2), después de que el encargado
  cierre las pendientes de datos (aprobaciones, normas, inducciones).
- **Tanda 4 — cuando se apague Apps Script**: nivel 3 de lo bloqueado por
  `app.html`; antes, mover las funciones compartidas a la v2.

### Cómo se retira cada módulo
1. Revisar la medición de la Fase 0 y el checklist de paridad.
2. Avisar al equipo con una Novedad una semana antes.
3. Quitar el interruptor (entrada de `MODULOS_V2`) y la preferencia guardada.
4. Borrar el código del nivel que corresponda, buscando referencias antes.
5. Tests completos + verificación en sandbox (escritorio y celular).
6. Un commit por módulo (se revierte solo ese si algo falla).
7. Mirar 48 h los errores y los comentarios.

### Qué no se toca
`index.html` (formulario público), `estado.html`, `app.html` hasta decidir
Apps Script, y los formularios clásicos que la v2 reutiliza.

---

## Decisión del dueño (2026-09-25): todo v2 y fin de la versión clásica

Tras revisar la plataforma, el dueño pide que **todo** quede con la estética y
la operación v2 y que la versión clásica **desaparezca por completo** (sin
interruptor), con la versión actual 100 % funcional. Reemplaza al "Plan para
retirar las versiones clásicas" de arriba (ya no hay ciclo de respaldo).

### Inventario de apartados que seguían clásicos (plataforma.html)
- **Gerencia** (8): Tablero de seguimiento, Línea de tiempo, Actividades,
  Pausas activas, Centro de reportes, Tendencia y ciclo, Recurrencia, Carga.
- **Mi departamento** (5): Tablero, Por persona, Actividades del equipo,
  Centro de reportes, Carga por módulo y tipo.
- **Coordinación de pausas** (2): Historial por trabajador, Cumplimiento.
- **Novedades** (3 + modales): Por aprobar, Mis envíos, Cumplimiento de
  lectura; Publicar, Reenviar y Aprobar/Devolver.
- **Administración** (14): Empresas, Plataformas, Áreas, Jefaturas, Módulos,
  Tipos, Usuarios (legado), Notificaciones, Alertas en vivo, Canales de
  alerta, Enviar alerta, Pausas activas, Centro de reportes, Panel de datos.
- **Calidad** (17 + formularios): ficha completa de la persona (5
  pestañas), Capacitaciones, No conformidades, Quejas, Auditorías, Revisión
  por la dirección, Indicadores, Objetivos, Alcance, Contexto, Procesos,
  Riesgos, Cobertura ISO, Servicios, Proveedores, Reportes, Accesos; y los
  formularios de Documentos (cargar, editar, nueva versión, cláusulas).
- **Marco**: inicio de sesión y recuperar clave, Mi perfil, buscador
  (Ctrl+K), hoja de atajos y tour.
- Compartido: el motor de reportes (`reportes.js`) y los modales y campos
  de `Componentes` que usan todas las pantallas anteriores.

### Orden de trabajo
- **R1** retirar el interruptor y las pantallas clásicas ya reemplazadas.
- **R2** base visual v2 para todo lo compartido (cabecera de módulo,
  botones, campos, tablas, tarjetas, avisos, pestañas y modales), para que
  ninguna pantalla quede con la estética antigua mientras se rehace.
- **R3–R11** rehacer la operación de cada módulo en v2: Novedades,
  Coordinación, Mi departamento, Gerencia, Administración, Calidad (ficha y
  capacitaciones; seguimiento; medición, sistema y operación; reportes y
  accesos), motor de reportes.
- **R12** marco: inicio de sesión, perfil, buscador, atajos.
- **R13** limpieza del código clásico que quede sin uso.
- `app.html` (acceso con Google / Apps Script) queda fuera: apagarlo exige
  crear la cuenta de portal de Valentina Caballero; se trata aparte.

### R1 Retiro del interruptor — ESTADO: HECHO
- Todos los módulos v2: `activo()` fijo en `true`, `usarVersion()` sin
  efecto; sin preferencia `sigso_*_v2` (el shell borra las que había).
- `plataforma.js`: `MODULOS_V2` solo con la implementación v2; fuera
  `alCambiarVersion_` y los objetos `*_CLASICA_`.
- Fuera del menú de usuario el ítem de versión; Proyectos ya no ofrece
  "Abrir versión clásica".
- `plataforma.html` deja de cargar `inicio.js` y `pausas.js` (clásicos sin uso).

### R2 Base visual v2 para lo compartido — ESTADO: HECHO
- `<body class="sx2">`: los tokens v2 existen en toda la plataforma (también
  en modales).
- `css/v2/puente-v2.css`: cabecera de módulo, tarjetas, avisos, botones,
  campos, tablas (`.sigso-tabla`, `.sigso-tabla-tablero`), pestañas
  (control segmentado), KPIs, badges, modales y avisos flotantes con la
  estética v2. Usa `:where(.sx2)` para no ganarle a los CSS de módulos v2.
- Margen de página para las secciones que aún pintan HTML clásico dentro de
  módulos a ancho total (antes quedaban pegadas al sidebar).

### R3 Novedades 100 % v2 — ESTADO: HECHO
- `novedades-v2.js` es el módulo completo: Publicadas, **Por aprobar**,
  **Mis envíos** y **Cumplimiento de lectura** (KPIs vencidas / por vencer /
  al día / cumplidas y barra de confirmación por novedad).
- Panel lateral único: leer y confirmar, quién la leyó, **aprobar** (fecha
  límite obligatoria en ley/dictamen y a quién llega, con buscador de
  personas), **devolver/rechazar** con motivo, **retirar**, **corregir y
  reenviar**. **Publicar** en panel lateral ancho (el carril controlado
  oculta audiencia y plazo y cambia el botón a "Enviar a revisión").
- `UIv2.formulario`, `UIv2.campo` y `UIv2.leerBase64`: el formulario v2
  genérico (el de Proyectos queda atado al proyecto) que usarán los demás.
- `plataforma.html` ya **no carga `novedades.js`**; la v2 define también
  `window.SigsoNovedades` (cargar, irAItem, actualizarBadge,
  resumenPendientes). `novedades.js` queda solo para `app.html`.
- Sandbox: 4 vistas con datos; aprobada la Ley 21.822 pendiente (validó
  fecha obligatoria); publicado y retirado un aviso de prueba; Inicio y
  contador del sidebar siguen funcionando.
