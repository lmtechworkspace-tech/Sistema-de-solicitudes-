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
