# Análisis del material real del SGC y ajuste del módulo Calidad

> Auditoría del material entregado (70 archivos: 7 procedimientos, 13 documentos
> maestros, 20 formularios, 4 matrices de servicios, 7 carpetas de personal)
> contra lo construido en SIGSO v10.0 Fases 1 a 3b.
>
> Fecha: 2026-08-15 · Ámbito: HomePymes SpA — SGC ISO 9001:2015

---

## 1. La decisión de fondo: subir, no reconstruir

El material confirma lo que el cliente ya había dicho: **los documentos existen,
están redactados y aprobados**. Reconstruirlos dentro de la plataforma sería
trabajo doble y, peor, crearía **dos versiones de la verdad** — el auditor
preguntaría cuál rige.

La regla que se aplica de aquí en adelante:

| Tipo de contenido | Dónde vive | Por qué |
|---|---|---|
| Documentos maestros (DOC-01..13), procedimientos (PRO-01..07), formularios en blanco | **Archivo subido** al repositorio (Fase 1) | Ya existen, tienen firma y control de versión propio |
| **Registros** que se generan a diario (una NC, una queja, una evaluación, una auditoría) | **Datos en el sistema** | Nacen del día a día, necesitan plazos, alertas y trazabilidad |
| Evidencia de un registro (PDF firmado, captura, correo) | **Adjunto** al registro | El sistema no falsifica firmas; las guarda |

Dicho de otro modo: **el sistema no reemplaza los documentos, reemplaza las
planillas sueltas donde hoy se llevan los registros.** Un FO-PRO-06-01 en Word
por cada no conformidad no tiene alertas de plazo ni sabe quién es el
responsable; el registro en SIGSO sí.

---

## 2. Hallazgos que corrigen lo ya construido

Siete desalineaciones entre lo implementado y los formularios reales. Ordenadas
por gravedad.

### 2.1 CRÍTICO — La evaluación de competencias no tiene 8 ítems fijos

`FO-PRO-02-04 Monitoreo del personal` evalúa:

> **2.- Calificación de principales responsabilidades (según descriptor de cargo)**
> **3.- Calificación de responsabilidades secundarias (según descriptor de cargo)**

Es decir: **los ítems salen del descriptor de cargo de esa persona**, y son
distintos para un Contador que para un Prevencionista. La implementación actual
usa 8 ítems fijos e iguales para todos (`ITEMS_EVALUACION_SGC`).

Un auditor lo detecta de inmediato: el registro no corresponde al formulario
aprobado, y evalúa a la gente contra responsabilidades que no son las suyas.

**Corrección:** el descriptor (`SGC_DESCRIPTORES`, ya existe desde la Fase 2a)
pasa a guardar sus listas de **responsabilidades** y **habilidades**, y la
evaluación las trae de ahí. Dos promedios separados (ítem 2 e ítem 3), como pide
el formulario, no uno solo.

La escala real también es distinta de un "1 a 4" pelado:

| 1 | 2 | 3 | 4 |
|---|---|---|---|
| No cumple | Cumple en algunas ocasiones | Cumple en la mayoría de los casos | Cumple en su totalidad |

Y el formulario cierra con **"5.- Detección de necesidades de capacitación"**,
firmado por quien recomienda — que es justamente lo que enlaza con el programa
de capacitación.

### 2.2 Falta la referencia normativa en la no conformidad

`FO-PRO-06-01` tiene el campo **"Referencia normativa"**, y el informe de
auditoría `FO-PRO-03-02` pide **"Punto normativo"** por cada NC del resumen.
`SGC_NC` no lo guarda.

Sin ese dato no se puede armar el resumen del informe ni responder "¿qué
cláusula se incumplió?", que es la primera pregunta del auditor sobre una NC.

### 2.3 La fuente de la NC no coincide con el formulario

`FO-PRO-06-01` marca con X entre: **Auditoría · Revisión por la dirección ·
Reclamo · Otro**. La implementación tiene seis fuentes con otros nombres. Se
mantiene el desglose (distinguir auditoría interna de externa es útil) pero se
alinean las etiquetas visibles con el formulario.

### 2.4 Falta el plazo de 15 días hábiles tras el informe de auditoría

`PRO-03 §6.5`:

> "el responsable del área auditada tiene un plazo de **15 días hábiles** para
> entregar la redacción de las no conformidades"

La Fase 3b controla el plazo del informe (10 días hábiles) pero no éste. Es el
plazo que hace que los hallazgos se conviertan en NC de verdad.

### 2.5 El informe de auditoría necesita más que una conclusión

`FO-PRO-03-02` exige: correlativo, fecha de informe y de auditoría, objetivo,
alcance, **equipo auditor** (varios, no uno), **personas entrevistadas con
cargo**, conteo por tipo de hallazgo, **resumen de NC con punto normativo y
evidencia objetiva**, oportunidades de mejora, observaciones y conclusiones.

La implementación guarda un solo auditor y un campo de conclusión.

### 2.6 La lista de verificación real tiene 132 preguntas, no 28 cláusulas

`FO-PRO-03-04` es un checklist con **132 preguntas concretas** repartidas en 25
sub-cláusulas (4.1 a 10.3). Ejemplos:

> ¿Dispone la organización de una metodología para el análisis, seguimiento y
> revisión del contexto interno y externo?
> ¿La política es comunicada y entendida dentro de la organización?

La Fase 3b pide al auditor escribir a mano "qué se verificó". Teniendo el
catálogo aprobado, debe **ofrecer las preguntas** y que el auditor sólo responda.
Eso convierte una pantalla de escritura libre en la lista de verificación real
del SGC.

Cada pregunta lleva además **"Documentación relacionada"** y **"Personal
entrevistado"**, que hoy no se capturan.

### 2.7 La eficacia de la capacitación es por participante

`FO-PRO-02-05` tiene, en la tabla de participantes, una columna
**"Eficacia de la capacitación (60 días después) – indicar fecha"** — por
persona. La implementación la guarda a nivel de curso.

---

## 3. Hallazgo mayor: el formulario web de quejas ya lo puede servir SIGSO

`5. Especificacion_Formulario_Web_Quejas.docx` es un encargo a un proveedor web
externo: 9 campos, correo automático al Responsable SGC, confirmación al cliente
y — textual — *"idealmente, cada envío debe quedar registrado en una base de
datos o panel administrable (Google Sheets, panel del CMS o similar)"*.

**Eso es exactamente lo que SIGSO ya hace.** El sistema tiene desde su primera
versión un intake público (formulario sin cuenta → Apps Script → planilla →
correo) que es la misma arquitectura, ya desplegada y funcionando.

Construir el formulario de quejas dentro de SIGSO en vez de encargarlo aparte:

- **elimina el paso manual de transcripción** que hoy PRO-07 §6.1 obliga a hacer
  ("el responsable del SGC transcribirá la información al formulario") — y con
  él, el riesgo de que una queja se pierda entre el correo y la planilla;
- da el **correlativo automático** que el procedimiento exige;
- arranca **el reloj de los 30 días corridos** desde el segundo en que el cliente
  envía, no desde que alguien abre el correo;
- deja la queja **enlazada a la NC y a la tarea** del responsable, sin volver a
  tipear nada.

El sitio web sigue teniendo su sección "Contáctenos": sólo que el botón apunta
al formulario de SIGSO. Es el mismo patrón por el que hoy entran las solicitudes
de servicio.

---

## 4. Inconsistencias en el material (las vería un auditor)

No son problemas del sistema, pero conviene resolverlas antes de la
certificación:

1. **Dos razones sociales.** `PRO-04`, `PRO-07` y varios procedimientos dicen
   *"Asesorías Integrales AyS SpA"*; el resto del material dice *"HomePymes
   SpA"*. El auditor pregunta cuál es la organización certificada.
2. **Dos correos de contacto para quejas.** `PRO-07` y la especificación web
   dicen `homepymes89@gmail.com`; el flujograma dice `soporte@rld.cl`.
3. **`PRO-10 Adquisiciones` y `FO-PRO-10-01` están en el listado maestro**
   (FO-PRO-01-01) pero no se entregaron. O existen y faltó adjuntarlos, o el
   listado declara un documento que no existe — lo segundo es una no conformidad
   de §7.5.
4. **`FO-PRO-03-04` está en Word y en Excel** con contenidos distintos (132 vs.
   otro conteo). Sólo uno puede ser la versión controlada.
5. **El descriptor de cargo tiene texto azul = "información propuesta"**, según
   su propia leyenda. Mientras siga azul, no es un documento aprobado.
6. **`FO-PRO-02-02` (inducción) de Valentina Caballero está sin firmas de
   relator** — las celdas traen números de fila en vez de nombres.

---

## 5. Qué se parametriza con los datos reales

| Dato | Fuente | Uso en el sistema |
|---|---|---|
| 16 cargos con su ocupante | `FO-PRO-02-01` (índice) | Alta de personas y descriptores |
| Responsabilidades y habilidades por cargo | `FO-PRO-02-01` (hojas 01..17) | **Ítems de la evaluación de competencias** |
| 6 objetivos de calidad con indicador, meta, frecuencia y responsable | `DOC-07` | Tablero de objetivos (Fase 6) |
| 5 ítems de inducción SGC | `FO-PRO-02-02` | Ya implementados; se agrega la inducción técnica |
| 25 sub-cláusulas y 132 preguntas | `FO-PRO-03-04` | **Lista de verificación de auditoría** |
| 6 criterios de proveedor, escala 1-10, corte en 5.0 | `PRO-04` + `FO-PRO-04-02` | Evaluación de proveedores (Fase 5) |
| 4 proveedores reales | `FO-PRO-04-01` | Carga inicial |
| 13 entradas + 3 salidas de la revisión por la dirección | `FO-PRO-05-01` | Revisión por la dirección (Fase 5) |
| 4 tipos de mensaje, 6 áreas, 4 canales | `FO-PRO-07-01` | Quejas (Fase 4) |
| Plazos: 30 corridos respuesta, 30 corridos seguimiento | `PRO-07` | Alertas de quejas |
| Plazos: 10 / 20 / 60 hábiles | `PRO-06` | ✅ ya implementados y coinciden |
| Plazos: 5 anticipación / 10 informe / 15 redacción NC / 60 eficacia | `PRO-03` | 5 y 10 ✅; se agregan 15 y 60 |
| 41 procesos de servicio con pasos y evidencias | `DOC-10..13` + matriz | Evidencia de servicios (Fase 7) |
| Tipos de documento del personal | Carpetas ZIP | Contrato, anexo, CV, certificado de título, credencial |

**Cambio de estructura confirmado por el cliente:** Comercial y Marketing pasan a
ser **internos**. Valentina Caballero (Ejecutiva de Ventas) e Ignacio Valdivia
(Encargado de Marketing) son parte de HomePymes, no externos. El material lo
refleja parcialmente — el índice del descriptor todavía lista a Ignacio Valdivia
dos veces, una como interno y otra como externo.

---

## 6. Plan

**Tanda A — Corregir lo desalineado** (lo que un auditor marcaría hoy)
- Evaluación de competencias derivada del descriptor, con sus dos promedios
- `referencia_normativa` en la no conformidad
- Plazo de 15 días hábiles para redactar NC tras el informe
- Informe de auditoría completo según FO-PRO-03-02
- Catálogo de 132 preguntas en la lista de verificación
- Eficacia de capacitación por participante

**Tanda B — Fase 4: quejas, felicitaciones y consultas** (PRO-07)
- Registro interno con las 5 partes del FO-PRO-07-01
- **Formulario público** en el intake, para el sitio web
- Regla de imparcialidad: el investigador no participó en el hecho
- Plazos de 30 días corridos (respuesta y seguimiento)
- Queja → no conformidad con un clic (mismo eslabón que la auditoría)

**Tanda C — Fase 5: proveedores y revisión por la dirección**
- Evaluación anual con los 6 criterios reales y el corte en 5.0
- Revisión por la dirección con sus 13 entradas **prellenadas desde el sistema**
  (los ítems 7, 8, 10, 12 y 13 los puede responder SIGSO solo) y acuerdos que son
  Actividades

**Tanda D — Fase 6: objetivos y cobertura**
- Los 6 objetivos de DOC-07 con su medición
- Matriz de cobertura ISO: cláusula → evidencia → estado

**Tanda E — Fase 7: evidencia de servicios** (los 41 procesos)

---

## 7. Lo que este análisis NO cambia

Las tres decisiones centrales de la arquitectura se confirman con el material:

1. **Las acciones correctivas son Actividades.** `PRO-06 §6.3` habla de
   responsable e implementación con plazo — exactamente una tarea.
2. **Los acuerdos de la revisión por la dirección también.** `FO-PRO-05-01 §3`
   tiene columnas "Responsable actividad" y "Plazo establecido".
3. **El acuse de lectura por versión es la evidencia de §7.5.3.** `PRO-01` lo
   exige y el listado maestro tiene fecha de vigencia y de revisión por
   documento, que es lo que el sistema ya controla.
