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

## Módulo 2 — Inicio: pendiente de análisis
