# Catálogo de Accesos de SIGSO

> Referencia viva (no un registro cronológico como el handoff de
> migración): qué sistemas deciden "esta cuenta sí puede, esta no" en
> SIGSO, con la misma forma de descripción para cada uno. Se actualiza
> cuando cambie alguno de estos sistemas, no solo cuando se termine una
> fase.
>
> Origen: documento de propuesta ["Arquitectura de
> Accesos"](https://claude.ai/artifact/V4PVAqB14Feaw5skUD8MEQ)
> (2026-09-19) y las 4 decisiones tomadas ese mismo día — ver
> `HANDOFF-MIGRACION-NODE.md` §13 para el registro de cómo se implementó
> cada incremento.

## 1. Los niveles del modelo

```
Nivel 0 — Plataforma (Superadmin)     aún no existe un rol propio; hoy
                                        lo cumple cualquier ADM, cruzando
                                        organizaciones sin querer
Nivel 1 — Organización                 ORGANIZACIONES + organizacion_id
                                        en CUENTAS_PORTAL/CAT_EMPRESAS
                                        (§2). Invisible hoy: una sola fila.
Nivel 2 — Rol general + módulos        CUENTAS_PORTAL.rol / .modulos (§3)
Nivel 3 — Membresía fina por dominio   los 4 sistemas de §4
```

**Nivel 3 nunca depende de Nivel 2**: un sistema de membresía fina
(Pausas, SGC, Proyectos, Jefatura) decide por su cuenta, sin mirar
`rol`/`modulos` de la cuenta — son gates independientes, no una jerarquía
donde uno deriva del otro. Ver la nota de cada uno en §4.

## 2. Organización (Nivel 1)

| | |
|---|---|
| Tabla | `ORGANIZACIONES` |
| Columna en otras tablas | `organizacion_id` en `CUENTAS_PORTAL`, `CAT_EMPRESAS` |
| Qué controla | El límite real entre distintos clientes que compren SIGSO |
| Quién administra | Nadie todavía — solo existe una fila (`org-homepymes-ays`), creada automáticamente |
| Enforcement real | **NO** — decisión 1 del documento de arquitectura, en pausa hasta que exista un cliente real |
| Código | `backend/db/schema.js` (`asegurarOrganizacionPorDefecto_`) |

`USUARIOS` (identidad legada de Google) no tiene `organizacion_id` a
propósito — ya está decidido retirarla (handoff §8.4).

## 3. Rol general y módulos (Nivel 2)

| | |
|---|---|
| Tabla | `CUENTAS_PORTAL` |
| Columnas | `rol` (un valor), `modulos` (lista JSON) |
| Valores de `rol` | `SOLICITANTE, ANA, DEV, GERENCIA, JEFATURA, ADM` — `COORDINADOR` retirado 2026-09-19 (nunca fue un permiso real, ver §4.1) |
| Valores de `modulos` | `nueva_solicitud, mis_solicitudes, bandeja, gerencia, jefatura, administracion, pausas, pausas_coordinacion, mi_trabajo, proyectos, calidad` (`MODULOS_VALIDOS`, `backend/logica/cuentasPortal.js`) |
| Quién administra | Cualquier `ADM` (global, sin distinción de organización — Nivel 1 no se aplica todavía) |
| Qué hace `rol` en la práctica | Es la plantilla que prellena `modulos` AL CREAR la cuenta (`MODULOS_POR_ROL`) — después son independientes, editables por separado |
| Enforcement real | `rol` **SÍ** se comprueba en cada acción (`contexto.rol === 'ADM'`, etc., repetido módulo por módulo). `modulos` **NO** — es decorativo, solo decide qué pinta el menú lateral (`plataforma.js`). Ver `router.js:19-24`. |
| Código | `backend/logica/cuentasPortal.js`, `backend/logica/portal.js` |
| Se edita en | Administración → Accesos → Cuentas plataforma |

## 4. Los 4 sistemas de membresía fina (Nivel 3)

Misma forma para los cuatro. Ninguno se fusiona con los demás — cada uno
modela algo real y distinto (ver la razón en cada tabla) — pero los
cuatro comparten esta estructura para que se puedan comparar de un
vistazo.

### 4.1 Pausas activas

| | |
|---|---|
| Tablas | `PAUSAS_COORDINADORES` (quién coordina), `PAUSAS_TRABAJADORES` (quién participa) |
| Qué controla | Quién puede coordinar o participar en la pausa activa de UNA empresa (`empresa_id`) |
| Valores propios | `PAUSAS_COORDINADORES.tipo`: `titular` / `reemplazo` |
| Clave de membresía | `email` + `empresa_id` (no `cuenta_id` — tolera que alguien coordine sin tener cuenta de portal) |
| Por qué es su propia tabla, no un rol | Es un roster FÍSICO real (quién trabaja dónde), no solo un permiso abstracto |
| Quién administra | `ADM` (global) |
| Enforcement real | **SÍ, es el gate real** — `empresasQueCoordina_()` en `pausas.js` mira ÚNICAMENTE este roster, nunca `rol`/`modulos` |
| Nota histórica | El rol `COORDINADOR` (retirado 2026-09-19) pre-llenaba `modulos` con `pausas`/`pausas_coordinacion`, pero como `modulos` es decorativo (§3), nunca protegió nada — el gate real siempre fue este roster |
| Código | `backend/logica/pausas.js` |
| Se edita en | Administración → Operación → Pausas activas |

### 4.2 Calidad / SGC (ISO 9001)

| | |
|---|---|
| Tabla | `SGC_ROLES` |
| Qué controla | Qué puede ver o gestionar dentro del sistema de gestión de calidad |
| Valores propios | `rol_sgc`: `ENCARGADO_SGC, DIRECCION, GERENCIA_ADM, JEFATURA_AREA, ENC_ADMIN, OPERATIVO, AUDITOR_EXTERNO` |
| Clave de membresía | `usuario_email`, con `area_id` opcional y `vigencia_hasta` opcional (el único de los 4 con expiración — para auditores externos) |
| Sin fila = | `OPERATIVO` (el más restringido, no el más permisivo) |
| Por qué es su propio vocabulario, no los roles generales | Son distinciones de dominio ISO 9001 reales (quién audita, quién dirige, quién es del área) — forzarlas al vocabulario de `rol` general perdería la vigencia expirable del auditor externo, entre otras cosas. Decisión 3 del documento de arquitectura: se mantienen separadas a propósito |
| Quién administra | `esAdminSgc_()` = `rol === 'ADM'` estricto — ni un `ENCARGADO_SGC` puede asignar roles de SGC |
| Enforcement real | **SÍ** — es el único gate fino real del módulo Calidad hoy (el gate grueso, módulo `calidad` vía `modulos`, es decorativo, §3) |
| Código | `backend/logica/calidadSgc.js` |
| Se edita en | Módulo Calidad → su propia pantalla de "Accesos" (NO está en Administración — ver nota abajo) |

### 4.3 Proyectos

| | |
|---|---|
| Tabla | `PROYECTO_INTEGRANTES` |
| Qué controla | Qué puede hacer una cuenta en UN proyecto específico |
| Valores propios | `rol_proyecto`: `LIDER, INTEGRANTE, COLABORADOR, OBSERVADOR` |
| Clave de membresía | `usuario_email` + `proyecto_id` |
| Por qué es su propia tabla | Membresía por proyecto es un concepto real de gestión de proyectos, no una preferencia de acceso general |
| Quién administra | El `LIDER` del proyecto (o `ADM`) — `GERENCIA` ve todo pero NO administra (de solo lectura a propósito) |
| Enforcement real | **SÍ** — `rolEnProyecto_()`/`puedeVerProyecto_()`/`puedeGestionarProyecto_()`, centralizados y reusados incluso por Actividades (el mejor diseñado de los 4, sirve de modelo) |
| Código | `backend/logica/proyectos.js` |
| Se edita en | Cada proyecto → su propia pantalla "Integrantes" (NO está en Administración) |

### 4.4 Jefatura

| | |
|---|---|
| Tabla | `JEFATURAS` |
| Qué controla | Qué equipo (subordinados) ve un jefe en Solicitudes |
| Valores propios | Ninguno — lista plana `jefe_email → subordinado_email`, sin jerarquía recursiva |
| Clave de membresía | `jefe_email` + `subordinado_email` |
| Por qué es su propia tabla | Relación jefe↔equipo real, independiente de si el jefe tiene rol `JEFATURA` o cualquier otro |
| Quién administra | `ADM` (global) |
| Enforcement real | **SÍ** — `esDelEquipoJefatura_()`/`esDelEquipoJefaturaSolicitud_()` restringen `SolicitudesBO.getDetalle` a lo que el equipo del jefe cubre |
| Código | `backend/logica/jefatura.js` |
| Se edita en | Administración → Organización → Jefaturas |

## 5. Lo que NO es un permiso real todavía

- **`CUENTAS_PORTAL.modulos`** — decorativo, solo decide el menú lateral. Cerrarlo (`MODULO_POR_ACCION` real) es trabajo pendiente, documentado en `router.js:19-24` desde el día uno de la migración a Node.
- **`organizacion_id`** — existe en el esquema (§2) pero ninguna consulta filtra por él todavía. Decisión 1 del documento de arquitectura: en pausa hasta que haya un cliente real.

Ninguno de los dos es un descuido: son huecos conocidos, documentados, y
con una razón explícita para seguir abiertos (ver la sección "Decisiones"
del documento de arquitectura). Si algún día alguno de los dos se cierra,
esta tabla debe actualizarse en el mismo commit.

## 6. Dónde se edita cada cosa, de un vistazo

| Sistema | Pantalla |
|---|---|
| Cuentas y rol general | Administración → Accesos → Cuentas plataforma |
| Pausas (coordinadores/roster) | Administración → Operación → Pausas activas |
| Jefaturas | Administración → Organización → Jefaturas |
| Roles de Calidad/SGC | Dentro del módulo Calidad, no en Administración |
| Integrantes de Proyectos | Dentro de cada proyecto, no en Administración |

Las dos últimas filas son, en la práctica, la parte más real de la queja
original ("los accesos están dispersos") — no porque estén mal hechas,
sino porque viven fuera del panel de Administración, en la pantalla de
su propio módulo. No se movieron a Administración en este incremento
(cambiaría cómo cada módulo ya organiza su propia navegación); queda
anotado aquí para que quien lo revise sepa que es una decisión pendiente,
no un olvido.
