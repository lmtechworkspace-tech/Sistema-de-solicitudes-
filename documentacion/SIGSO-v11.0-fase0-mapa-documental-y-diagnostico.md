# Fase 0 — Mapa documental del SGC y diagnóstico del módulo Calidad

> Auditoría del repositorio y del módulo Calidad existente contra el material real
> del SGC, previa a cualquier cambio de código.
>
> Fecha: 2026-08-21 · Base: commit `a99a9e2` · Organización: Asesorías Integrales
> AyS SpA (nombre de fantasía HomePymes SpA), RUT 78.194.394-0
>
> Informe presentado como artifact:
> https://claude.ai/code/artifact/53141c32-850f-4092-8a75-d9f97dc0bd19

---

## 1. Punto de partida: el módulo ya existe

Medido, no estimado:

| | |
|---|---|
| Hojas `SGC_*` en la planilla | 22 |
| Backend del módulo | 6.902 líneas (9 archivos `.gs`) |
| Frontend | `calidad.js`, 5.366 líneas |
| Tests propios del SGC | 239 (de 1.051 totales) |
| Secciones de la interfaz | 11, en 5 grupos |

Fases entregadas: 1, 1b, 2a, 2b, 3a, 3b, Tanda A, 4, 5a, 5b, 6a, 6b, Accesos SGC,
Centro de Control de Accesos, y el rediseño visual en dos tramos.

**Este análisis no propone rehacer nada.** Propone completar la mitad de la norma
que quedó fuera: los capítulos 4 y 6 (contexto, partes interesadas, riesgos,
procesos, recursos), que son justamente los que ya están redactados y aprobados
en documentos.

---

## 2. Inventario: 33 archivos adjuntos = 24 documentos únicos

Deduplicado por hash MD5, no por nombre.

### 2.1 Dos falsas alarmas descartadas

- `DOC-04_Matriz_de_partes_interesadas_v02 (3)` y `(4)` son binarios distintos
  (`6d9252b3` vs `faf77c91`) pero su **texto extraído es idéntico**. La diferencia
  está en metadatos de Word.
- Lo mismo con `PRO-04 v01-Proveedores.docx` con y sin espacio en el nombre
  (`94efb547` vs `49439da8`).

No son versiones en conflicto. Verificarlo antes de reportarlo evitó dos
"contradicciones" inexistentes.

### 2.2 Qué cambió respecto del lote analizado el 2026-08-15

Archivos con contenido genuinamente nuevo o modificado:

- `FO-PRO-01-01 v02 Listado de control de documentos` — **versión nueva**
- `FO-PRO-02 - 01_Descriptor_de_cargo_v01.xlsx` — modificado (17 cargos con
  responsabilidades y habilidades)
- `FO-PRO-02-02 Inducciones.xlsx` — modificado
- `FO-PRO-02 - 04 Monitoreo del personal.xlsx` — modificado
- `FO-PRO-04-01_Listado_Proveedores.docx` y `FO-PRO-04-02_Evaluacion_Proveedores.docx`
- `FO-PRO-05-01_Revision_por_la_Direccion` — dos variantes con distinto contenido
- `DOC-10 Contabilidad` — tres variantes distintas

### 2.3 Destino de cada documento

| Documento | ISO | Contenido | Destino |
|---|---|---|---|
| `DOC-01` Manual | 4–10 | Alcance, exclusiones, RUT | Archivo + alcance estructurado |
| `DOC-02` FODA | 4.1 | 7F · 6O · 7D · 4A = 24 factores | **Estructurar** |
| `DOC-03` Mapa de procesos v02 | 4.4 | 13 procesos en 3 categorías | **Estructurar** |
| `DOC-04` Partes interesadas v02 | 4.2 | 4 partes × 6 columnas | **Estructurar** |
| `DOC-07` Objetivos | 6.2 | 6 objetivos | Ya cargado (F6a) |
| `DOC-08` Riesgos v02 | 6.1 | 11 riesgos + 5 oportunidades + escala | **Estructurar** |
| `DOC-10…13` Servicios | 8.1/8.5/8.6/8.7 | 40 procesos con pasos | **Estructurar** |
| `FO-PRO-01-01` v02 | 7.5 | 37 internos + **6 externos** | Parcial: faltan los externos |
| `FO-PRO-02-01` Descriptores | 7.2 | 17 cargos | Ya cargado (F2a) |
| `PRO-01…07` | varios | Reglas ya implementadas | Archivo |
| Formularios `FO-*` en blanco | varios | Plantillas ya capturadas como registro | Archivo |

---

## 3. Cobertura ISO medida ejecutando `MatrizCobertura.gs`

De las 28 cláusulas del catálogo: **17 con evaluador, 11 sin**.

Sin evaluador: `4.1` `4.2` `5.1` `6.1` `6.3` `7.1` `8.1` `8.2` `8.3` `8.5` `8.6`

### 3.1 Dos defectos concretos en la matriz

**(a) La nota de `8.3` contradice al manual.** Dice que «si la organización no
diseña productos, esta cláusula puede no aplicar». Pero `DOC-01 §8.3` declara que
8.3 **sí** aplica y se cubre con `DOC-10…13`. Las **únicas** exclusiones
declaradas por la organización son `7.1.5.2` (trazabilidad de las mediciones) y
`8.5.1 f)`. La nota le sugiere al auditor algo que el manual desmiente.

**(b) `5.1` no tiene evaluador *ni* nota.** Es la única de las 28 que cae al texto
genérico por defecto (`'Sin evidencia estructurada en el sistema todavía.'`), sin
explicar por qué, mientras las otras diez sí tienen su nota en
`NOTA_FALTANTE_POR_DEFECTO_ISO`.

### 3.2 Vacío estructural: no hay dónde declarar una exclusión

El manual excluye dos **sub**-cláusulas (`7.1.5.2`, `8.5.1 f`), pero
`CLAUSULAS_ISO9001` trabaja al nivel de cláusula (`7.1`, `8.5`). Hoy no existe
forma de registrar una exclusión ni su justificación — que es exactamente lo que
exige `4.3` y lo primero que un auditor busca.

---

## 4. Los seis vacíos, con su fuente

### 4.1 Contexto / FODA (`4.1`)
`DOC-02`: 24 factores. **Siete de los once riesgos del `DOC-08` son literalmente
las debilidades y amenazas del FODA.** Existe una cadena real
debilidad → riesgo → acción → responsable que hoy solo vive en la cabeza de quien
redactó ambos documentos.

### 4.2 Partes interesadas (`4.2`)
`DOC-04 v02`: 4 partes (clientes, alta dirección, colaboradores, proveedores de
plataforma) con 6 columnas: necesidades, impacto, nivel de influencia, expectativa,
cómo afecta al SGC.

**Decisión propuesta:** la especificación del usuario pide 14 campos; el documento
real tiene 6. Estructurar los 6 que existen y dejar el resto como campos
opcionales vacíos. Un campo vacío es honesto; uno inventado es un hallazgo.

### 4.3 Riesgos y oportunidades (`6.1`)

El documento más rico del lote. Modelo de valoración **completo y numérico**:

- Probabilidad: Baja `0,1` · Media `0,5` · Alta `1,0`
- Impacto: Insignificante `1` · Bajo `5` · Moderado `10` · Alto `25` · Crítico `50`
- Magnitud = P × I, con bandas: Insignificante `<0,5` · Bajo `0,5–2,5` ·
  Moderado `2,5–10` · Alto `10–25` · Crítico `25–50`
- **Doble pasada**: valoración inherente y revaloración tras controles.

**Dos filas mal etiquetadas en el propio documento** (encontradas al recalcular):

| Fila | P | I | Magnitud | Banda que corresponde | Rótulo en el documento |
|---|---|---|---|---|---|
| Riesgo: normativas de ciberseguridad | 0,1 | 10 | 1 | Bajo | **Moderado** |
| Oportunidad: externalización en pymes | 1,0 | 25 | 25 | Crítico | **Alto** |

Se corrigen solas si la banda se **calcula** en vez de escribirse.

**Advertencia de diseño:** en las oportunidades una magnitud alta es *buena* y la
revaloración debe **subir**, no bajar. Un motor que pinte de rojo lo alto
mostraría al revés la mitad de la matriz.

### 4.4 Procesos (`4.4` · `8.1` · `8.5` · `8.6`)

**Distinción que vale semanas y que el análisis de agosto tenía mezclada bajo
"Fase 7":**

| | Volumen | Costo |
|---|---|---|
| **Definición del proceso** — 13 del mapa + 40 de servicio, cada uno con pasos (responsable, input, actividades, evidencias, output) | acotado y estable | bajo |
| **Registro de ejecución** — cliente × proceso × período | ≈7.200 filas/año con 50 clientes | alto, es el riesgo de escala |

Recomendación: **separarlas**. La definición desbloquea `4.4` con fichas de
proceso reales y es barata.

Conteo real de procesos de servicio: `DOC-10` 17 + `DOC-11` 14 + `DOC-12` 8 +
`DOC-13` 1 = **40** (el análisis de agosto decía 41).

### 4.5 Documentos externos (`7.5.3.2`)
Segunda hoja del listado maestro: ISO 9001, ISO 19011, DS 44, Ley 16.744, DS 594,
Código del Trabajo. El repositorio actual no distingue origen interno/externo.

### 4.6 Motor de indicadores (`9.1.1`)
`SGC_OBJETIVOS` existe pero está atado a los 6 objetivos de `DOC-07`. Un indicador
de proceso no tiene dónde vivir. Es una generalización, no un módulo nuevo.

---

## 5. Contradicciones

### 5.1 Resuelta por el propio material

**La razón social ya no es una contradicción.** El análisis del 2026-08-15 marcó
que unos documentos decían "Asesorías Integrales AyS SpA" y otros "HomePymes SpA".
`DOC-01 §4.1` lo aclara textualmente: *"Asesorías integrales AyS SpA, con nombre
de fantasía Homepymes SpA, con RUT 78.194.394-0"*. Es **una sola empresa**. El
certificado se emite a la razón social; el sistema debería mostrar ambos nombres.

### 5.2 Abiertas — REQUIEREN VALIDACIÓN DEL USUARIO

| Punto | Evidencia |
|---|---|
| **Versión del mapa de procesos** | El archivo se llama `v02`, su pie dice "Versión: 01, vigencia Junio 2026" y el `<title>` del HTML dice `v01` |
| **Correo de quejas** | `PRO-07` y la especificación web: `homepymes89@gmail.com`; el flujograma: `soporte@rld.cl`; el sistema implementado: `homepymes.control@gmail.com` |
| **Alcance: 4 áreas o 5** | `DOC-01` lista RRHH, Contabilidad, Prevención y Marketing. `DOC-03` agrega Administración y Facturación como procesos de apoyo |
| **`PRO-10` y `FO-PRO-10-01`** | Declarados en el listado maestro v02, nunca entregados. Si el listado declara un documento inexistente, es NC de `7.5` |
| **Fase 2 de quejas** | El flujograma fija septiembre 2026 para pasar del formulario de contratación al contrato formal con cláusula 9. Hay 7 puntos de migración sin dueño |

Las tres primeras deben cerrarse **antes de la carga inicial de datos**: corregirlas
después significa reescribir registros que ya tendrán historial.

---

## 6. Arquitectura

### 6.1 Lo que NO se toca

Calidad es una capa sobre SIGSO, no un sistema paralelo:

- Acciones correctivas y acuerdos de dirección son **Actividades** (motor v7.0)
- La distribución documental va sobre **Novedades** (acuse de recibo = `7.5.3`)
- Los roles del SGC viven en `SGC_ROLES`, sin tocar los roles globales de auth

Excepción deliberada: `SGC_PERSONAS` no reutiliza `USUARIOS` porque 6 de 13
personas del alcance son externas y no tienen cuenta. Es un padrón distinto para
una población distinta, no duplicación del maestro.

### 6.2 Estructuras nuevas propuestas

| Hoja | Origen | Filas iniciales | Desbloquea |
|---|---|---|---|
| `SGC_CONTEXTO` | `DOC-02` | 24 | `4.1` |
| `SGC_PARTES_INTERESADAS` | `DOC-04` | 4 | `4.2` |
| `SGC_RIESGOS` | `DOC-08` | 16 | `6.1` |
| `SGC_PROCESOS` | `DOC-03` | 13 | `4.4` |
| `SGC_PROCESO_PASOS` | `DOC-10…13` | 40 procesos | `8.1` `8.5` `8.6` |
| `SGC_ALCANCE` | `DOC-01` | 1 + exclusiones | `4.3` |
| campo `origen` en `SGC_DOCUMENTOS` | listado maestro | 6 externos | `7.5.3.2` |

Siete estructuras, cinco con menos de 30 filas. Nada aquí justifica rediseñar la
arquitectura.

### 6.3 Restricciones duras (verificadas)

- **Triggers 20/20.** Toda alerta nueva cuelga del pase diario de las 09:00, que
  ya corre con presupuesto de 5 min y rotación (`ejecutarAvisosDelPase_`).
- **6 min por ejecución GAS.** Ningún cálculo de la matriz puede recorrer la
  planilla entera sin paginar.
- **Despliegue manual del backend.** Cada fase = un paquete cerrado y verificable.

### 6.4 Riesgos técnicos

1. **La navegación se satura.** 11 secciones en 5 grupos hoy; sumar 6 entidades
   sueltas rompe el rediseño recién cerrado. Deben entrar agrupadas bajo un
   cluster **Planificación**.
2. **Un módulo de riesgos invita a duplicar acciones.** Cada riesgo del `DOC-08`
   trae acciones con responsable y fecha: son **Actividades**, igual que las
   correcciones y los acuerdos. Un tercer sistema de tareas sería el peor error
   posible de esta etapa.
3. **El motor de indicadores toca código que funciona.** Generalizar
   `SGC_OBJETIVOS` arriesga la F6a. Va tarde y con pruebas de regresión.

---

## 7. Plan

| Fase | Contenido | Hojas | Desbloquea |
|---|---|---|---|
| **F0** | Este diagnóstico | — | — |
| **F1** | Alcance y exclusiones + corrección de los 2 defectos de la matriz | 1 | `4.3` |
| **F2** | Contexto (FODA) y partes interesadas | 2 | `4.1` `4.2` |
| **F3** | Riesgos y oportunidades con valoración calculada | 1 | `6.1` |
| **F4** | Procesos — definición (13 + 40) | 2 | `4.4`, prepara `8.x` |
| **F5** | Documentos externos + reorganización de navegación | 0 | `7.5.3.2` |
| **F6** | Indicadores de proceso (generaliza el motor de objetivos) | 0–1 | `9.1.1` |
| **F7** | Tablero del SGC y experiencia de auditor | 0 | consume todo |
| **F8** | Evidencia de servicios (cliente × proceso × período) | 2 | `8.1` `8.5` |

Orden por dependencia real, no por número de capítulo: primero lo que ya tiene
datos aprobados esperando, después lo que exige decisiones del usuario, al final
lo que tiene riesgo de escala.

### 7.1 Sobre ISO 9001:2026

Hoy `CLAUSULAS_ISO9001` es una constante del código y `Auditorias.gs` ya la
referencia. Convertirlo en *norma → versión → cláusula* es correcto, pero **es una
refactorización de algo que funciona**, y hacerla antes de que exista la edición
2026 significa diseñar contra un texto que nadie ha leído.

Camino propuesto: que las cláusulas lleven **versión de norma desde la F1**, de
modo que agregar la edición 2026 sea cargar filas y no reescribir el módulo. La
matriz de transición se construye cuando el texto esté publicado.

---

## 8. Utilidades de extracción (para las fases siguientes)

Sin Python ni pandoc en el equipo. Las 24 fuentes quedaron extraídas a texto con
utilidades propias en el scratchpad:

- `docx2txt.js` — `unzip -p` + limpieza de `word/document.xml`, con tablas
- `xlsx2txt.js` — `unzip -p` + `sharedStrings.xml` + celdas por hoja
- `pdf2txt.js` — inflate de streams + operadores `Tj`/`TJ`
- `drawio2txt.js` — **nuevo**: extrae los `value=` de un export `.drawio.html`
  (así se obtuvo el mapa de procesos v02, que el extractor de PDF no pudo leer)

**Trampa:** los nombres de archivo con tildes (`Revisión`, `acción`) no llegan
bien a `unzip` desde bash en Windows — hay que copiarlos a un nombre ASCII antes.
