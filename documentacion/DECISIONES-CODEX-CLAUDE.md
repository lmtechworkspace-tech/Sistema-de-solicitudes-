# SIGSO: decisiones compartidas entre Codex y Claude Code

Este archivo es el contexto común de las dos herramientas. **Codex lo lee al empezar cada auditoría** y **Claude Code lo actualiza** después de cada ronda. Si algo aquí contradice el código, manda el código y se corrige este archivo.

## Roles (decisión del dueño, 2026-10-08)

| Quién | Hace | No hace |
|---|---|---|
| **Codex** (auditor, solo lectura) | Dirige la investigación, propone la arquitectura de cada corrección y revisa lo implementado. Cada hallazgo trae evidencia, corrección y validación. | No edita archivos, no despliega, no contacta producción. |
| **Claude Code** (implementador) | Contrasta cada hallazgo con el código, implementa siguiendo la propuesta de Codex, escribe las pruebas, corre la suite (`TZ=America/Santiago`) y pide la revisión siguiente. Registra aquí lo decidido, lo descartado y por qué. | No hace push ni despliega sin que el dueño lo pida. No cambia credenciales ni el puente (`tools/codex-audit.mjs`). |
| **El dueño** | Decide lo que cambia la experiencia de las personas o el negocio (ej. opción A/B del H1), autoriza commits, push y despliegues. | — |

Cuando Codex y Claude discrepen, Claude documenta su razón aquí y la siguiente revisión de Codex la contrasta; si sigue el desacuerdo, decide el dueño.

## Cómo se trabaja

1. Codex audita un alcance acotado: `node tools/codex-audit.mjs "<alcance>"` → `.auditoria-codex/<fecha>/INFORME-PARA-CLAUDE.md` (fuera de Git).
2. Claude verifica cada hallazgo en el código: **confirmado**, **confirmado con matiz** o **descartado** (con la razón).
3. Claude implementa lo confirmado con pruebas y deja aquí la decisión (sección «Registro»).
4. Codex revisa solo el diff de esas correcciones. Máximo dos rondas por tema; lo que quede, a «Pendiente».
5. Un informe sin hallazgos **no** prueba ausencia de defectos; un informe que dice que no pudo leer el código **no** cuenta como revisión.

## Registro de decisiones

### D-001 · Autenticación y separación entre empresas — 1.ª auditoría (2026-10-08)
Informe real de Codex con 4 hallazgos (commit base `065240a`). Correcciones en commit `5ecca6a` salvo donde se indica.

- **H2 (P1) Una cuenta SOLICITANTE leía detalle y pauta ajenos.** Confirmado con matiz: solo escribía en lo suyo, pero leía todo.
  - Decisión: una cuenta SOLICITANTE solo abre las solicitudes que pidió (con cualquiera de sus correos), donde tiene un ítem asignado o de un departamento suyo; y solo su propia pauta. **El personal de planta (DEV/ANA reales) sigue viendo el trabajo de sus compañeros** (decisión anterior, se mantiene).
  - 2.ª ronda de Codex: `correo_cliente` solo cuenta si `es_cliente` (mismo criterio que `solicitudesPublico.js`). Corregido.
  - Dónde: `solicitudesBackoffice.js` (`solicitudAjenaParaSolicitante_`), `dashboard.js` (`getPautaDesarrollador`), `router.js` (`contexto.emails`).
- **H3 (P1) Cambiar/resetear la contraseña no cerraba las sesiones abiertas.** Confirmado.
  - Decisión: clave puesta por la administración (resetear/asignar) → se cierran **todas** las sesiones de esa cuenta. Cambio voluntario → se cierran **las demás** y sigue la actual. Cambio de clave y cierre van en una sola transacción.
  - Dónde: `sesiones.js` (`revocarOtrasSesiones`), `portal.js`, `cuentasPortal.js`. La 2.ª ronda lo dio por corregido.
- **H4 (P2) Código de «Mis solicitudes» sin límite de intentos y con `Math.random`.** Confirmado.
  - Decisión: `crypto.randomInt`; el código se invalida a los **5 fallos**; máximo **3 códigos por correo en una ventana deslizante de 10 min** (2.ª ronda de Codex: la ventana fija se alargaba con cada pedido → corregido). La respuesta no revela si el correo tiene solicitudes.
  - Pendiente: control por IP (la acción no recibe la IP hoy).
- **H1 (P1) Las acciones públicas de una solicitud solo pedían número + correo.** Confirmado. Ver D-002.

### D-002 · H1: probar el correo antes de ver o tocar una solicitud — opción B (dueño, 2026-10-08)
- **Opción elegida: B** (código al correo). Se descartó la A (enlaces firmados) porque rompe los enlaces ya enviados.
- **Diseño implementado (commit `5b4d829`, revisado por Codex en D-003 y D-004):**
  - `router.js` → `conCorreoVerificado_` envuelve las 7 acciones públicas: `consultarEstado`, `editarSubsolicitud`, `eliminarArchivo`, `responderConsulta`, `enviarMensajeSolicitud`, `validarCierre`, `subirArchivo`. Sin correo probado → 403 con `requiere_codigo: true`.
  - Correo probado = un correo de la **cuenta de la plataforma** (`portal_token`) o un **pase de acceso** (`pase_acceso`).
  - Pase de acceso (`solicitudesPublico.js`): se entrega al verificar el código (`verificarCodigoAcceso`, y `misSolicitudes` con código). Dura **8 h** y vive en la memoria del servidor (un reinicio o despliegue lo borra; se pide el código otra vez).
  - `crearSolicitud` entrega un pase **limitado a esa solicitud** (solo para subir sus adjuntos): como el creador no probó el correo, no puede abrir otras solicitudes de ese correo.
  - Con sesión de la plataforma y sin `email` (adjuntos de «Nueva solicitud»), el servidor usa el correo de la cuenta que corresponde a la solicitud. **Esto corrige un error previo**: esos adjuntos se rechazaban por «correo no coincide».
  - Frontend: `api.js` guarda los pases en `sessionStorage` (solo esa pestaña) y los envía; `estado.js` pide el código en la consulta por número y la repite al verificarlo.
  - Pruebas: `backend/test/auditoria-codex-2026-10-08.test.js` (3 de opción B) + 2 pruebas existentes ajustadas para enviar el pase. Suite 1718/1718. Probado en navegador con una solicitud ficticia.
- **Riesgo a decidir antes de desplegar:** si los correos de SIGSO no salen (Resend, pendiente desde el 18-sep), quien no tiene cuenta no recibe el código y queda sin acceso desde la página pública.

### D-003 · Revisión de Codex de D-002 — 1.ª ronda (2026-10-08, informe real)
Codex: no queda camino para ver o modificar una solicitud ajena con número + correo por las 7 acciones. Arquitectura aceptada: **pases opacos aleatorios, 8 h, en memoria de un solo proceso**, siempre que se purguen; si algún día hay varios procesos o se necesita continuidad tras reiniciar, persistir en SQLite el **hash** del pase, correo, alcance, acciones y vencimiento (nunca el token en claro). 4 hallazgos P2, todos confirmados e implementados (sin commit):

- **H1 · El pase de creación autorizaba más que subir adjuntos** (Codex reprodujo una edición). Decisión: los pases tienen **tipo** — `codigo` (todas las acciones de ese correo) y `creacion` (solo `subirArchivo` de esa solicitud). El router pasa el nombre de la acción al control. Dónde: `solicitudesPublico.js` (`ACCIONES_PASE_CREACION`, `correosVerificados_(db, data, accion)`), `router.js` (`conCorreoVerificado_(accion, fn)`).
- **H2 · Los pases vencidos quedaban para siempre en memoria.** Decisión: `cacheEfimero.js` purga lo vencido al escribir (como mucho cada 60 s) y tiene tope de 20 000 entradas; si se supera aun purgando, salen las más antiguas.
- **H3 · Con `sessionStorage` bloqueado, el pase se perdía.** Decisión: `api.js` guarda los pases primero en memoria de la pestaña y después, si se puede, en `sessionStorage`. Probado en navegador con `sessionStorage` que lanza error.
- **H4 · Un envío fallido del código se mostraba como éxito.** Decisión: si Resend responde `canal_desactivado` o `error_envio`, `solicitarCodigoAcceso` devuelve un error genérico («No pudimos enviar el código…», sin revelar si hay solicitudes), el código no queda vigente y ese intento no gasta cupo. `estado.js` solo confirma el envío con `ok` (consulta por número y «Mis solicitudes»). Probado en navegador.

Pruebas: 13 en `backend/test/auditoria-codex-2026-10-08.test.js`; suite 1721/1721 (`TZ=America/Santiago`).

### D-004 · Revisión de Codex de D-003 — 2.ª y última ronda (2026-10-08, informe real)
Codex: **H1, H2 y H3 quedaron corregidos**. H4 corregía los fallos en serie pero no los **simultáneos**: si dos pedidos de código del mismo correo se cruzaban, el que fallaba podía borrar el código y el cupo del que sí salió (Codex lo reprodujo con promesas controladas). Confirmado e implementado (sin commit):

- Los pedidos de código del **mismo correo van en fila** (`colaCodigos_`): uno termina de enviar antes de que el siguiente genere su código.
- Cada intento tiene un **id**; si falla, solo quita **su** reserva del cupo, leyendo el estado actual (no una copia de antes del envío).
- Si falla un reenvío, **vuelve a valer el código anterior que sí llegó**, con su vencimiento original (`CODIGO_ACCESO_VENCE:`).
- Pruebas nuevas, como pidió Codex: A falla y B sale; A sale y B falla; dos fallos simultáneos; tras éxito + fallo quedan exactamente 2 envíos en la ventana. Y la **prueba automática de H3** que faltaba (carga `api.js` con `sessionStorage` y `localStorage` bloqueados).
- Suite 1725/1725 (`TZ=America/Santiago`); 17 pruebas en el archivo de auditoría.
- Esta corrección de la 2.ª ronda **no** tuvo una tercera revisión de Codex (límite de dos rondas). Si el dueño quiere, se revisa en una auditoría acotada aparte.

### D-005 · Ecosistema de clientes: Portal, Bandeja y visual (pedido del dueño, 2026-10-08)
El dueño pidió auditar el ecosistema de la app para clientes (portal del contratista + módulo Portal de clientes) y la Bandeja de trabajo, resolver problemas y proponer mejoras significativas operativas y visuales (app, animaciones, interacciones). Tres auditorías reales de Codex (informes en `.auditoria-codex/2026-10-08T20-58*`, `T21-01*`, `T21-05*`):

| Informe | Defectos | Mejoras |
|---|---|---|
| E1 · Portal de clientes, operativo y seguridad | 7 | 3 |
| E2 · Bandeja de trabajo, operativo | 9 | 2 |
| E3 · Visual, animaciones e interacciones (con las capturas de `documentacion/claude-design/`) | 9 | 6 |

Plan acordado (Claude implementa; Codex revisa cada tanda):
- **Tanda 1 — defectos P1:** E1-2 sesión del portal con almacenamiento bloqueado; E1-3 pedido duplicado al reintentar (idempotencia); E1-6/E3-1 errores de carga mostrados como vacío; E2-1 escritura con membresía LECTURA o JEFATURA de otro departamento; E2-2 conversación en solicitudes ajenas; E2-3 el plazo (SLA) de la cola no se pausa esperando al solicitante; E2-4 respuesta pendiente por ítem; E3-2 contraste AA de tokens; E3-3 foco atrapado en diálogos.
- **Tanda 2 — defectos P2:** E1-4, E1-5, E1-7, E2-5…E2-9, E3-4…E3-9.
- **Mejoras:** se presentan al dueño priorizadas para que elija (E1-8 membresías en varias empresas y E1-9 permisos ADMIN/COLABORADOR requieren su decisión de negocio).
- **E1-1 (config apuntando a localhost):** descartado como defecto del repositorio — es el `config.js` local de desarrollo, que nunca se sube; se toma la sugerencia de un control en el empaquetado que rechace direcciones locales.
- Cruce: la Bandeja tiene un rediseño visual en curso con Claude Design (brief 2). Las mejoras visuales de E3 se presentan al dueño como insumo para decidir.

### D-006 · Tanda 1 implementada por Claude (2026-10-08, sin commit; espera revisión de Codex)
- **E2-1** `solicitudesBackoffice.vetoFueraDeAlcance_`: membresía LECTURA no escribe (salvo ADM); JEFATURA de cuenta solo escribe en ítems suyos, de su departamento con rol de trabajo o de su equipo; JEFATURA de departamento sí. Se aplica también a `derivarSolicitud` por ítem. D-001 (DEV/ANA cubren a compañeros) se mantiene.
- **E2-2** `comentarios.js`: el ítem debe ser de la solicitud (400); mensaje de ítem → mismo veto; mensaje general → no ajena para SOLICITANTE y al menos un ítem escribible. `es_interno` solo con true/'true'/1.
- **E2-3** `cumplimiento.medir` acepta `pausas`/`historial` (tramos S06 vía `pausasEsperandoSolicitante`, común con el reporte) y detiene el reloj en `fecha_terminada` en S08. Cola, detalle y reporte usan el mismo cálculo.
- **E2-4** `dashboard.respuestaPendienteLectura_` y `escribioSolicitante_` por ítem y solo con comentarios públicos del solicitante.
- **E1-2** portal: el token vive en memoria de la pestaña (se toma del almacenamiento la primera vez); `localStorage`/`sessionStorage` bloqueados o borrados no cortan la sesión abierta.
- **E1-3** idempotencia: el teléfono genera `intento_id` por pedido y lo repite en los reintentos; el servidor guarda `SOLICITUDES.intento_portal` = `cliente|contacto|intento|huella` (sha256 del contenido). Mismo intento y contenido → misma solicitud (`repetido: true`); simultáneos → la misma promesa; mismo intento con otro contenido → 400. Sin `intento_id` funciona como antes.
- **E1-6/E3-1** portal: cada recurso (catálogo, pedidos, trabajadores, documentos) guarda su error; la pantalla muestra «No pudimos cargar…» (`role=alert`) con «Intentar de nuevo», en vez de un vacío.
- **E3-2** `tokens.css`: `--texto-3` #636C7D claro (5,29:1) / #8590A3 oscuro (5,37:1); nuevos `--sobre-primario` y `--sobre-critico` (blanco en claro, #0F172A en oscuro) → `--sx-sobre-*`, aplicados a 25 reglas con texto blanco fijo sobre acento/rojo. La barra lateral (fondo azul marino fijo) no cambia.
- **E3-3** `ui-v2.js` `abrirCapa/cerrarCapa` (exportados): activador recordado, `inert` en los hermanos de la capa superior (salvo `aria-live`/status/alert), Tab y Shift+Tab giran, restauración al activador o a su equivalente (id o primer data-*) o al h1; `confirmar` con `peligro` enfoca Cancelar; confirmación sobre drawer deja el drawer inerte. Portal: `MutationObserver` sobre `#capa` hace lo mismo con `#app` (cubre ayuda, visor y formularios). Ojo: `ui-v2.js` también corre en el servidor (PDF con documentoV2, sin `document`): el escucha de Tab va protegido; lo detectó la suite (documento-v2.test.js).
- **Pruebas:** `backend/test/auditoria-codex-ecosistema.test.js` (E2-1…E2-4), `portal-clientes-pedidos.test.js` (E1-3: repetido, simultáneo, otro contenido, sin intento — detectó y se corrigió un error de separador en la clave). Navegador (Chrome sin ventana, datos ficticios): 14/14 — error de carga y reintento, sesión sin almacenamiento, foco en ayuda/drawer/confirmar, contraste calculado en claro y oscuro.

### D-007 · Revisión de Codex de la Tanda 1 — 1.ª ronda (2026-10-09, informe real `.auditoria-codex/2026-10-09T00-18*`)
Veredicto: CORREGIDOS E1-2, E2-2, E2-3; PARCIALES E1-3, E1-6, E2-1, E2-4, E3-2, E3-3. Seis hallazgos nuevos, los seis confirmados y corregidos por Claude:
1. **ANA con LECTURA cambiaba prioridad y reasignaba** → `actualizarPrioridad` y `asignarResponsables_` pasan por `vetoFueraDeAlcance_` (reasignar toda la solicitud valida CADA ítem antes de escribir; el ítem debe ser de esa solicitud). ANA sin esa membresía conserva su autoridad global (RN-008).
2. **GERENCIA con membresía de trabajo tomaba ítems** → `tomarItem` la veta al inicio, antes de derivar, y revisa el resultado del cambio de estado.
3. **Marca de idempotencia guardada después de los avisos** → `Solicitudes.crearSolicitud(db, data, opciones)`: `filaSolicitud` (cliente, contacto, intento) va en la MISMA inserción y `alPersistir` (trabajadores) corre antes de esperar avisos. Si el acuse falla, el reintento devuelve la misma solicitud. Sin índice único en SQLite: SIGSO corre en un solo proceso y el mapa en memoria cubre la concurrencia.
4. **Documentos sin estado de error** → `cargarDocs` usa `recargar('docs')`; la vista muestra el aviso también con la lista anterior.
5. **En S06 la respuesta del equipo no limpiaba el pendiente** → `respuestaPendienteLectura_` compara el último mensaje público del solicitante con la última respuesta pública del equipo en ese ítem (o general), desde la entrada a S06.
6. **Contraste y foco** → celda de calor nivel 4 con acento pleno (5,67:1 / 6,88:1); el portal anota el activador en el momento (`focusin`/`click` en captura) y no al abrir la capa.
Pruebas: 4 nuevas en backend (T1-1, T1-2, T1-3 con acuse que falla, T1-5) y 2 en navegador (formulario con foco inmediato, documentos con recarga fallida): navegador 16/16.

### D-008 · Revisión de Codex de la Tanda 1 — 2.ª y última ronda (2026-10-09, informe real `.auditoria-codex/2026-10-09T00-42*`)
Veredicto: CORREGIDOS H1, H2, H4, H5 de D-007 y E1-6, E2-1, E2-4, E3-3; PARCIALES H3/E1-3 y H6/E3-2. Dos hallazgos, confirmados y corregidos:
1. **Atomicidad del pedido** → `crearSolicitud` guarda correlativo, ítems, solicitud, historial y `alPersistir` dentro de `SAVEPOINT crear_solicitud` (sirve con o sin transacción exterior); ante cualquier excepción `ROLLBACK TO` y nada queda marcado. Prueba: un trigger hace fallar el 1.er y luego el 2.º trabajador → sin solicitud, ítems ni trabajadores; al reintentar, un pedido completo.
2. **Texto blanco fijo en descendientes** → chips activos (ícono, contador), tarjetas de gravedad (strong/small, sin opacidad) y contadores pasan a `--sx-sobre-primario` o a pastilla de superficie; además 8 círculos de paso sobre `--sx-ok` (blanco daba 3,16:1 en oscuro). `--sx-sobre-*` también en `:root`. Medido en navegador: mínimo 4,94:1 en claro y oscuro.
Cerrada la revisión de la Tanda 1. Queda para la Tanda 2: blanco fijo sobre colores propios de módulo (naranja de Hompy, color de Finanzas, marca de Credenciales), fuera del alcance de esta auditoría.
Tanda 1 subida a main (dueño, 2026-10-09): commit `f4b07ef`.

### D-009 · Tanda 2 implementada por Claude (2026-10-09, sin commit; espera revisión de Codex)
- **E1-1** `.github/workflows/pages.yml`: el despliegue se detiene si `frontend/js/config.js` apunta a localhost/127.0.0.1/0.0.0.0/[::1].
- **E1-4** portal: RUT repetido dentro del pedido → 400 antes de escribir. Regla elegida: un RUT que ya está en «Mis trabajadores» usa SU ficha (vuelve a TRÁMITE si estaba finiquitado; no borra datos que el pedido no trae). Si registrar al trabajador falla, se lanza y el SAVEPOINT deshace todo el pedido.
- **E1-5** `archivosSolicitud.guardarArchivo_`: reservas en memoria (`enCurso_`, un solo proceso) que cuentan para el tope ANTES de esperar al almacenamiento; se liberan en `finally` (la inserción sigue sin await de por medio).
- **E1-7** portal: caché de archivos con tope de 40 MB (se suelta el más antiguo, nunca el abierto en el visor) y `URL.revokeObjectURL`; al salir o vencer la sesión se limpia todo y `ARCH_GEN` descarta respuestas de la sesión anterior.
- **E2-5** `avisarCompromisoFecha`: evento `COMPROMISO_FECHA:<ítem>:<fecha>` (la categoría se reconoce por prefijo): cada ítem y cada nuevo compromiso se avisan; reintentar el mismo se deduplica.
- **E2-6** `dashboard.getCola`: GERENCIA lee toda la cola y la de cada departamento (rol LECTURA forzado: sin Tomar ni Asignar; escritura ya vetada en el servidor).
- **E2-7** `reporteSolicitudes`: por ítem se guardan todas las RESOLUCIONES (entradas a S08/S09) y los tramos resueltos; `estadoAl(corte)` reconstruye el estado de ese día. Abiertos/atrasados usan el estado al corte; resueltos del mes = ítems con una resolución en el mes (la última del mes), medida hasta esa fecha sin esperas ni tramos ya resueltos. Un cambio posterior no altera un mes cerrado. Mismo cálculo para el reporte y el informe mensual (`resumenArea_`).
- **E2-8** `Utils.venceCompromiso_`: un compromiso de día vence a las 18:00 de Chile (fin de jornada); con hora, tal cual. Lo usan `Cumplimiento.clasificar` y la Bandeja (`vencida`). Al resolver sin fecha, el servidor anota el día de Chile (`claveDia_`), no el UTC. Una prueba antigua (solicitudes-camino) esperaba el día UTC: falló a las 22:04 de Santiago y se corrigió.
- **E2-9** Bandeja: el resultado de un lote queda en un panel con cada fallo y su motivo; los fallidos siguen marcados; «Reintentar los N» repite solo esos; las excepciones de red cuentan como fallo; el aviso de avance se retira (tapaba «Reintentar»).
- **E3-4** menú «Más»: al abrir, la lista pasa a `position:fixed` junto al botón (arriba/abajo según espacio, alto máximo con scroll, corrección si un ancestro con transform cambia la referencia); flechas, Escape (cierra solo el menú y vuelve a «Más»), se cierra al desplazar. Hallazgo extra: el aviso «Tu agenda de hoy» (z-index 1150) tapaba el panel → se oculta mientras hay un drawer abierto, como la campana.
- **E3-5** portal: el camino se arma con el estado de cada ítem; S08 = listo por revisar («N de M listos para que los revises»), S06 = «Esperamos tu respuesta»; todo cancelado → «Cerrado».
- **E3-6** Lista: título en hasta 2 líneas (sin `sx2-cortar`), metadatos que bajan de línea, y columnas por `@container` (ancho real de la lista), acción en fila propia bajo 480 px.
- **E3-7** portal: `--pc-tacto: 48px`; secundarios ≥ 48 px, miniaturas de 96 px y la × de quitar foto con área de 48 × 48.
- **E3-8** desplazamientos con `behavior` según «reducir movimiento» (portal `suave()`, Bandeja `U.reducirMovimiento()`).
- **E3-9** Bandeja: una dirección `@portal.invalid` no se muestra ni se enlaza (canal: «App del contratista…» con teléfono); en Actividad quien escribió es el solicitante con su nombre («Escribió (solicitante)») o el equipo («Respondió al solicitante»).
- **Pruebas (D-009):** `backend/test/auditoria-codex-tanda2.test.js` (E1-5, E2-5, E2-6, E2-7, E2-8) y E1-4 en `portal-clientes-pedidos.test.js`.

### D-010 · Revisión de Codex de la Tanda 2 — 1.ª ronda (2026-10-09, informe real `.auditoria-codex/2026-10-09T01-14*`)
Veredicto: CORREGIDOS E1-1, E1-4, E1-5, E2-5, E2-6, E2-9, E3-4…E3-9; PARCIALES E1-7, E2-7, E2-8. Tres hallazgos, confirmados y corregidos:
1. **Tomados y rechazados del reporte cambiaban meses cerrados** → `ts_tomado` y comparación con el corte; rechazados con `estadoAl(corte)`. Además `finDePeriodo_` usa la medianoche real de Chile (`Utils.instanteLocal_`: UTC−4 en invierno), no UTC−3 fijo. Prueba: agosto idéntico tras tomar en septiembre y cancelar en octubre; fin de junio y de noviembre.
2. **La Bandeja vencía en la zona del navegador** → `getCola` entrega `vence_compromiso` (instante ISO calculado con `Utils.venceCompromiso_`) y `vencida()` lo usa; el cálculo local queda solo de respaldo.
3. **Sesión vencida con el visor abierto** → `salirLocal()` centraliza salir/vencer: limpia la caché, vacía y cierra `#capa` (el observador quita `inert` y devuelve el foco) y olvida pedidos, detalle, documentos y trabajadores. `pintarPdf` se detiene y hace `destroy()` del documento si la sesión o el visor cambian a mitad. Prueba en navegador: el pedido del archivo responde «sesión terminó» con el visor abriéndose → sin visor, fondo usable, pide entrar.
Pruebas: backend tanda2 8/8; navegador portal 20/20.

### D-011 · Revisión de Codex de la Tanda 2 — 2.ª y última ronda (2026-10-09, informe real `.auditoria-codex/2026-10-09T01-20*`)
Veredicto: 13 CORREGIDOS (incluido E2-8) y 2 PARCIALES (E1-7, E2-7). Dos hallazgos, confirmados y corregidos:
1. **H1 — responsable y plazo de HOY en meses cerrados** → `HISTORIAL_PRIORIDAD` guarda `sla_anterior_horas`/`sla_nuevo_horas`; `HISTORIAL_ASIGNACION` guarda `detalle_items` (responsable anterior de cada ítem que cambió de manos; vacío = solo la cabecera) y ahora también registra las reasignaciones de `asignarResponsables_`, que antes no dejaban rastro. El reporte usa `plazoAl(ts)` y `asignadoAl(ts)`: cumplimiento con el plazo vigente a la resolución, atraso con el del corte, «por persona» y la lista de atrasados con quien lo tenía y el estado al corte. **Registros antiguos** sin el dato: se usa el valor de hoy y se informa `con_dato_actual` (cuántos resueltos se midieron así), en vez de atribuirlo en silencio. Prueba con las acciones reales: subir a P1 y reasignar en octubre deja agosto «a tiempo» y de la misma persona.
2. **H2 — el PDF ya dibujado no se liberaba** → `pintarPdf` hace `destroy()` del documento SIEMPRE al terminar (bien o con error): los canvas ya tienen las páginas. Prueba en navegador con pdf.js simulado: abrir y cerrar dos veces → 2 abiertos, 2 liberados.
Cerrada la revisión de la Tanda 2 (máximo de dos rondas). Pruebas: backend tanda2 9/9; navegador portal 22/22 y Bandeja 10/10.
Pendientes anotados por Codex fuera de alcance: rendimiento con volumen real (lecturas completas de SOLICITUDES/historiales), medición de memoria en teléfonos, multiproceso. Navegador con datos ficticios: Bandeja 10/10 (lote con 4 fallos y reintento, menú del último ítem, Lista a 390/900 px, identidad del portal) y portal 18/18 (camino S08+S05, tamaños táctiles).

Tanda 2 subida a main (dueño, 2026-10-09): commit `c469b55`.

### D-012 · Mejoras A, B y C elegidas por el dueño (2026-10-09, sin commit; espera revisión de Codex)
De las mejoras de D-005 el dueño eligió A (E3-10), B (E3-11) y C (E3-12). Implementación de Claude:
- **A — Inicio del contratista** (`portal-cliente.js` `inicio()`, `serviciosFilas()`; CSS `.m-inicio`): orden pendiente → «¿Qué necesitas?» (pedir + mandar) → Mis documentos → «Este mes» → avisos/instalar la app al final (siguen siempre en «Mi empresa»). Si hay varios pendientes se muestra el primero y «Ver los N que esperan tu respuesta». Con UNA sola área contratada, sus servicios van como filas de ≥ 72 px directo al formulario (`nuevoPedir(área, servicio)`). 24 px entre bloques; sombra solo en lo pendiente; cabecera más compacta.
- **B — Detalle del pedido** (`pedido()`): tarjeta «Te toca a ti» primero: la pregunta pendiente (S06) con «Responder» (enfoca el mensaje) o lo listo para revisar (S08) con «Sí, quedó bien» / «Algo está mal» / «Ver lo que te mandamos» (salta al ítem). Fechas COMPROMETIDAS en palabras (`paraCuando`: «Para hoy», «Para mañana», «Para el jueves 15», «Era para…»); sin fecha: «Aún no tenemos una fecha» (un plazo normal del servicio no se presenta como promesa). El camino queda debajo con un resumen.
- **C — Bandeja como cola de decisiones** (`bandeja-v2.js`): filtro Todo/Clientes/Internos/Soporte (`origenDe`: Clientes = portal o cliente declarado; Internos = con departamento; Soporte = plataformas) que acota tabla, KPIs y chips por igual (`poblacion()`), recordado por persona. «Plazo» reemplaza a «Antig.» en tablas y tarjetas (`plazoCelda`: «Venció jue 15», «Hoy», «Mañana», «Sin fecha», «Sin asignar», «Espera al cliente», «Por validar» + SLA en palabras; la antigüedad queda en el título). En la tabla de ítems «Plazo» reemplaza a «Compromiso» y ya no se oculta bajo 1500 px. Arriba del detalle, «Próximo paso» (recibir / darle fecha / empezar / resolver, de qué ítem y su fecha) con «Ir», que abre ese ítem en esa acción y enfoca el campo. Fechas rápidas Hoy/Mañana/Sugerida bajo cada fecha de la Bandeja (`data-rapidas`, respetan `min`; un MutationObserver agrupado por cuadro las agrega). Se mantienen número completo, agrupación, KPIs, vistas, lotes y el riel Bloques.
- **Pruebas en navegador** (datos ficticios): portal 25/25 (inicio con una área → filas ≥ 72 px y avisos al final; «Te toca» primero con confirmación; «Aún no tenemos una fecha») y Bandeja 19/19 (cuentas por origen, «Clientes» acota tabla, «Plazo» cabe, «Próximo paso» → «Ir» enfoca la fecha, «Mañana» la llena).
- Cruce: el rediseño de la Bandeja con Claude Design (brief 2) sigue pendiente; estas mejoras usan los componentes actuales.

## Pendiente
- (D-003, de Codex) Recuperar el acceso cuando el pase vence con un formulario de edición/respuesta abierto: hoy solo la consulta pide el código otra vez; las demás acciones muestran el mensaje de error.
- (D-003, de Codex) Ampliar pruebas: caducidad del pase, reinicio, sesión revocada.

- Revisión de Codex de la opción B (D-002): bloqueada por el entorno (ver abajo).
- Control por IP del código de acceso (H4).
- Auditoría por grupos aún no hecha: solicitudes completo, proyectos, calidad, finanzas, portal de contratistas, control interno, notificaciones/documentos, navegación/rendimiento.
- Codex dejó fuera de alcance: aislamiento entre organizaciones (hoy hay una sola), administración de cuentas global para ADM, purga de sesiones vencidas (`purgarExpiradas` sin llamadores), búsquedas de sesión por SQL indexado.

## Notas del entorno (Windows de la oficina)

- Codex CLI nativo (`AppData\Local\Programs\OpenAI\Codex`), versión 0.162.0. Sesión con la cuenta ChatGPT del dueño.
- Los comandos del sandbox parten en `C:\`: cada alcance debe pedir rutas absolutas bajo `C:\Users\luis1\OneDrive\Desktop\SIGSO`.
- «blocked by policy»: se resolvió abriendo `codex` interactivo una vez.
- «helper_unknown_error: setup refresh had errors» (2026-10-08 tarde): la app de escritorio de Codex dejó el sandbox de Windows en `elevated` (`[windows] sandbox` en `~/.codex/config.toml`), y en ese modo la preparación falla al ajustar permisos de su propia carpeta (`node_repl.exe` «en uso»; registro en `%USERPROFILE%\.codex\.sandbox\`). Cerrar la app y su servicio (`codex app-server daemon stop`) **no** bastó.
  - **Solución:** auditar con `CODEX_AUDIT_WINDOWS_SANDBOX=unelevated` (opción agregada al puente: pasa `-c windows.sandbox="unelevated"` solo a la auditoría, sin tocar la configuración global; sigue en solo lectura). Ejemplo: `CODEX_AUDIT_WINDOWS_SANDBOX=unelevated node tools/codex-audit.mjs "<alcance>"`.
