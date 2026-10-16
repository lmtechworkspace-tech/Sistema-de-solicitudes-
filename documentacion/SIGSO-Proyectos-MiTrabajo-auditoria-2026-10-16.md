# Auditoría Proyectos + Mi trabajo — 16-10-2026

**Origen:** a los usuarios les cuesta gestionar en Proyectos y Mi trabajo, se
pierden al cambiar el estado de una tarea ("muchos botones") y hay un caso
concreto bloqueante: en *Estandarización Dpto. Comercial y e-Contratistas v2*
las tareas a nombre de una persona las ejecuta otra (Valentina), que **no
puede cambiarles el estado**.

**Alcance revisado (código, no datos de prod):**
`frontend/js/proyectos-v2/{mitrabajo,panel-tarea,trabajo,nucleo,proyecto-acciones}.js`,
`backend/logica/proyectos.js` (`actualizarTarea`, `editarTarea`, `listarMisTareas`,
permisos) y `backend/logica/actividades.js` (`checkin`, `reasignar`, `confirmar`).

---

## 1. Causa raíz del caso Valentina

| Qué pasa | Dónde |
|---|---|
| Cambiar estado/avance exige ser **responsable o colaborador de la TAREA** (`trabajaLaActividad_`). Ser integrante/colaborador del **PROYECTO** no basta. | `proyectos.js:2165`, `actividades.js:453` |
| Ni siquiera el **líder** puede cambiar el estado de una tarea ajena: solo puede registrar horas. | `proyectos.js:2165` (`accion && !trabaja`) |
| En la v2 **no existe ningún campo para agregar colaboradores a una tarea** (ni al crear ni al editar). El backend lo soporta (`colaboradores_emails`), la pantalla no. Por eso Valentina no puede quedar como colaboradora de esas tareas. | `panel-tarea.js` `formEditar`, `trabajo.js` `abrirNuevaTarea` |
| Reasignar existe solo **de a una tarea** (Editar → Responsable) y **reinicia la tarea**: estado a "No iniciada", borra el avance, el bloqueo y la confirmación, y la nueva persona debe **volver a confirmar la fecha**. Para un traspaso dentro del equipo es demasiado castigo, así que nadie lo hace. | `proyectos.js:1238-1249` |
| Solo pueden reasignar el líder o quien trabaja la tarea; un integrante que la ejecuta "de hecho" no puede tomarla. | `proyectos.js:1178` |

**Conclusión:** el sistema asume "quien está a nombre = quien la hace" y no
ofrece una salida barata cuando eso no se cumple.

## 2. Errores encontrados (bugs)

| # | Error | Efecto | Archivo |
|---|---|---|---|
| B1 | `listarMisTareas` no devuelve `fecha_terminada` | La sección "Terminadas esta semana" de Mi trabajo **nunca aparece** | `proyectos.js:772-787` / `mitrabajo.js:223` |
| B2 | Los filtros de Trabajo (hito, persona, texto, estado) son globales y **no se reinician al cambiar de proyecto** | Al abrir otro proyecto puede salir "Ninguna tarea coincide" con un hito que ni existe en ese proyecto | `trabajo.js:15`, `nucleo.js:326` |
| B3 | Tareas "En revisión" (`requiere_validacion`): **no hay ningún botón en la v2** para aprobarlas o devolverlas (`validarActividad` solo existe en el backend) | Una tarea así queda trabada para siempre | `actividades.js:503`, sin uso en frontend |
| B4 | El líder no puede cerrar ni cambiar el estado de una tarea de alguien que ya no está | Tareas huérfanas abiertas para siempre o reasignación forzada que reinicia todo | `proyectos.js:2165` |

## 3. Problemas de uso (por qué "se pierden")

### Mi trabajo
1. **Demasiadas cosas a la vez:** hasta 6 KPI, interruptor Mis tareas/Mis horas,
   2 botones de creación, chips por proyecto, 5 grupos, solicitudes, carga y
   entregables en la misma pantalla.
2. **Cambiar el estado toma 3 pasos y un formulario largo:** Actualizar → elegir
   entre 6 chips (Avancé, Sin cambios, Me bloqueé, Me destrabé, La terminé, Solo
   registrar horas) → deslizador, día, horas, nota → Guardar. La acción más
   común ("la terminé" / "la empecé") no tiene botón directo en la fila.
3. **El chip preseleccionado es "Solo registrar horas"**: si la persona pulsa
   Guardar sin elegir nada recibe un error.
4. **Abrir una tarea de proyecto es lento**: carga el proyecto entero por detrás
   (2 llamadas pesadas) solo para mostrar un panel.
5. **Tres vocabularios de estado mezclados:** estado de flujo (No iniciada / En
   curso / Bloqueada / Terminada), semáforo (Al día / En riesgo / Atrasada) y
   plazo de Trabajo (En plazo / En riesgo / Atrasadas). Una tarjeta "Atrasada"
   aparece en la columna "En curso" del Kanban, y eso confunde.
6. "Confirmar fecha" se suma a cada reasignación (punto 1) y llena el grupo
   "Esperan que confirmes".

### Proyecto (sección Trabajo)
7. **La tabla abre con todas las tareas del proyecto y 10 columnas**; quien
   solo ejecuta no tiene un "Solo las mías" a mano.
8. **El Kanban es solo de lectura**: se ve como un tablero pero no se puede
   arrastrar para cambiar el estado (es lo primero que la gente intenta).
9. **No hay selección múltiple**: no se puede reasignar, reprogramar ni cerrar
   varias tareas juntas.
10. El panel de tarea pone 4 bloques de análisis (Fechas plan/real, Avance,
    Desviación, Datos) **antes** de la acción, que queda abajo, en el pie.

### Relación entre los dos módulos
11. Desde Mi trabajo el chip del proyecto abre el **Resumen** del proyecto, no
    "mis tareas en ese proyecto": la persona tiene que volver a buscarlas.
12. Dentro del proyecto no hay un camino de vuelta a Mi trabajo ni un aviso de
    "tienes N tareas aquí".

## 4. Propuesta (por etapas, de a una)

**Principio:** simple para quien ejecuta, completo para quien lidera. Un clic
para lo frecuente; el detalle sigue ahí, pero no estorba.

### Etapa 1 — Destrabar (permisos, reasignación, bugs) · lo urgente
- **Reasignación masiva** en el proyecto: seleccionar varias tareas (o "todas
  las de esta persona" desde Equipo) → "Pasar a…" → persona, con motivo
  opcional. Una acción de backend en lote, en una transacción, con traza.
- **Traspaso sin castigo:** al reasignar dentro del proyecto se **conservan**
  estado, avance y fecha comprometida (según decisión del dueño; hoy reinicia).
- **Colaboradores de tarea** visibles y editables en Nueva tarea y Editar.
- **Quién puede cambiar el estado** (según decisión del dueño): ampliarlo al
  líder y/o a los integrantes activos del proyecto, siempre con traza de
  quién lo hizo.
- Corregir B1, B2, B3 (botones Aprobar / Devolver) y B4.

### Etapa 2 — Mi trabajo simple ("paso a paso")
- Fila con **botón de estado directo** según el momento: *Empezar* → *Terminar*;
  menú ⋯ con Bloqueada, Reprogramar, Registrar horas.
- Panel "Actualizar" en **pasos cortos**: 1) ¿qué pasó? (3-4 botones grandes),
  2) solo lo que esa respuesta necesita (avance, motivo), 3) horas y nota
  opcionales. Sin chip preseleccionado.
- Pantalla con foco: arriba "Para hoy" (atrasadas + vencen hoy), luego "Esta
  semana", lo demás plegado. KPI reducidos a 3-4.
- Un solo vocabulario: **Estado** (qué hago) en texto y **Plazo** (a tiempo /
  atrasada) como color o punto. Nunca dos palabras iguales con sentidos distintos.
- Abrir tarea rápido: el panel pide solo esa tarea, no el proyecto entero.

### Etapa 3 — Proyecto más fácil de recorrer
- En Trabajo, chip **"Mis tareas"** (por defecto para quien no es líder).
- **Kanban con arrastrar** para cambiar estado (pide motivo si es bloqueo).
- **Selección múltiple** en tabla: reasignar, reprogramar, cambiar estado.
- Tabla compacta por defecto (Tarea, Responsable, Estado, Vence, Avance) y
  "Ver columnas de control" para plan/real/desviación.
- En el panel de tarea, **la acción arriba** y el análisis plegado.

### Etapa 4 — Puente Mi trabajo ↔ Proyectos
- El chip del proyecto en Mi trabajo abre **Trabajo filtrado a mis tareas**.
- En la cabecera del proyecto: "Tienes N tareas aquí" y "← Mi trabajo".
- Mismo panel, mismas palabras y mismos botones en los dos lados.
- Actualizar manuales (Proyectos y Mi trabajo) con el nuevo flujo.

## 5. Decisiones del dueño (16-10-2026, todas las recomendadas)
1. **Cambiar estado:** el equipo del proyecto (líder, integrantes y
   colaboradores activos; no observadores). La bitácora registra quién fue.
2. **Reasignar = traspaso:** se conservan estado, avance, fecha y confirmación.
3. **Quién reasigna:** el líder (cualquier tarea) y el propio responsable (las suyas).
4. **Orden:** 1 → 2 → 3 → 4.

## 6. Etapa 1 — hecha (sin commit)
- Backend: `esEquipoProyecto_` + `actualizarTarea`/`guardarRegistroDia` abren
  al equipo; `checkin(…, { autorizado })`; `editarTarea` conserva al reasignar
  y exige líder o responsable; nueva acción `reasignarTareasProyecto`
  (`Proyectos.reasignarTareas`, lote en transacción, aviso a quien recibe);
  `validar` acepta al líder del proyecto; `listarMisTareas` trae `fecha_terminada`.
- Frontend: panel de tarea con aviso "a nombre de…", campo **Colaboran**,
  responsable sin observadores, botones **Aprobar / Devolver**; Trabajo con
  casillas + barra **"Pasar a…"**; filtros que se reinician al cambiar de
  proyecto; colaboradores al crear tarea.
- Tests: `proyectos-reasignar-tareas.test.js` (8) + 2 ajustados; suite 1756/1756.
- Probado en base DEMO local: colaboradora cierra tarea ajena; responsable
  pasa 3 tareas en lote; colaborador agregado desde Editar; "Terminadas esta
  semana" aparece.

## 7. Etapa 2 — hecha (sin commit)
- **Panel "Actualizar tarea" en pasos:** 1) ¿qué pasó? con botones grandes
  (Avancé, La terminé, Me bloqueé/Me destrabé, Solo anotar horas) y un enlace
  "Sin cambios por ahora"; 2) solo lo que pide esa respuesta (avance o motivo);
  3) horas y nota opcionales. El botón Guardar se activa al elegir y dice lo que
  hará ("Marcar terminada", "Avisar bloqueo"…). Sin opción preseleccionada.
- **Fila de Mi trabajo con un botón de estado directo:** Empezar → Terminar
  (pide confirmar) → Destrabar; menú ⋯ con Contar cómo va, Me bloqueé (abre el
  panel con esa respuesta elegida), Solo anotar horas y Ver detalle.
- **Foco:** tarjeta "Tu próximo paso"; grupo "Para hoy" (atrasadas + vencen
  hoy); "Más adelante y sin fecha" plegado; 4 indicadores (Para hoy, Esta
  semana, Bloqueadas, Por confirmar/Solicitudes); "No planificado" en segundo plano.
- **Un vocabulario:** la fila muestra el ESTADO en texto (Por empezar, En curso,
  Bloqueada, En revisión) y el PLAZO en el color del punto y en "Vence hoy /
  Venció hace…".
- **Más rápido:** abrir otra tarea del mismo proyecto reutiliza lo cargado
  por 45 s (se olvida al guardar o recargar Mi trabajo).
- Corrección: a quien solo colabora ya no se le pide "Confirmar fecha" (el
  backend solo deja confirmar al responsable).
- Probado en base DEMO local (escritorio y celular 375 px).
