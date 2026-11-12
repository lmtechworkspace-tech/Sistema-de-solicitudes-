# Asistente SIGSO (IA)

Noviembre 2026. Un asistente con inteligencia artificial (Claude, de Anthropic) dentro de SIGSO: se le pregunta en lenguaje natural y responde con los datos reales del sistema, explica cómo hacer las cosas y lee documentos.

## Qué hace

- **Preguntas sobre los datos**: "¿se declararon todos los IVA de octubre?", "¿cuántos clientes sin movimiento hay?", "¿qué solicitudes están vencidas y quién las tiene?", "¿cómo va el proyecto X?", "¿qué NC siguen abiertas?". Consulta SIGSO **con la sesión de quien pregunta**: ve lo mismo que esa persona en pantalla, ni más ni menos.
- **Cómo se hace algo**: busca en los manuales de uso (los mismos de F1) y explica los pasos.
- **Documentos**: se adjuntan PDF, Word, Excel, PowerPoint, imágenes o texto (botón del clip, arrastrar o pegar una captura) y se pregunta sobre ellos ("¿qué dice el reglamento interno sobre la jornada?"). También abre los documentos del SGC, de proyectos y los adjuntos de novedades que la persona puede descargar.
- **Normativa general** (SII, Dirección del Trabajo, Previred, ISO 9001…): búsqueda web citando la fuente.
- **Voz** (gratis, del navegador; mejor en Chrome o Edge): micrófono para dictar, botón para que lea las respuestas en voz alta y modo **Conversar por voz** (escucha, responde hablando y vuelve a escuchar).

Es de **solo lectura**: no crea, cambia ni borra nada. Credenciales y la bóveda de Finanzas quedan fuera de su alcance.

## Dónde está

Botón flotante **«Pregúntale a SIGSO»** abajo a la derecha, en todas las pantallas (atajo `Ctrl + .`). Se abre un panel lateral; el botón de agrandar lo deja ancho.

## Quién lo ve

- ADM y super admin, siempre.
- Cualquier cuenta a la que Administración del sistema le marque el módulo **«Asistente SIGSO (IA)»**.
- Todas las cuentas, si se configura `SIGSO_ASISTENTE_TODOS=si`.

## Cómo se activa (una vez, en el servidor)

1. Crear una clave en https://console.anthropic.com (Settings › API Keys) y cargar saldo (Billing).
2. En el VPS, agregar al archivo de variables del servicio (el mismo `EnvironmentFile=` de systemd donde están las otras, p. ej. `/etc/sigso/finanzas.env`):

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

3. `sudo systemctl restart sigso-api`.

Sin la clave, el botón aparece pero responde "todavía no está configurado".

Variables opcionales:

| Variable | Por defecto | Para qué |
|---|---|---|
| `SIGSO_ASISTENTE_MODELO` | `claude-haiku-5-5` | etapa de pruebas: ~US$0,003 por pregunta. `claude-sonnet-5-5` (más fino) u `claude-opus-5-5` (el mejor, ~10-40 veces más caro) |
| `SIGSO_ASISTENTE_ESFUERZO` | `medium` | `low` más rápido y barato, `high` más prolijo |
| `SIGSO_ASISTENTE_TOPE_DIA` | `60` | preguntas por persona al día |
| `SIGSO_ASISTENTE_TODOS` | (vacío) | `si` = todas las cuentas |
| `SIGSO_ASISTENTE_WEB` | (activa) | `no` apaga la búsqueda web |

## Costo

Se paga por uso a Anthropic (saldo prepagado, sin mensualidad). Por defecto usa Claude Haiku 5.5: del orden de **US$0,003 por pregunta** (con US$5 alcanza para más de mil). Con Claude Opus 5.5 una pregunta típica (2-4 consultas a SIGSO) cuesta del orden de **US$0,03 a US$0,15**; con documentos largos, más. El prompt fijo queda en caché, así que preguntas seguidas salen más baratas. Cada pregunta queda registrada (solo tokens y costo, **nunca el texto**) en la tabla `ASISTENTE_USO`; la acción `asistenteUso` da el total del mes por persona.

## Cómo está hecho

- `backend/logica/asistente.js`: el ciclo con Claude (respuesta en vivo, herramientas, tope diario, consumo).
- `backend/logica/asistenteConocimiento.js`: lo que sabe de SIGSO y la **lista blanca** de consultas de solo lectura. Para que el asistente pueda leer algo nuevo, se agrega la acción ahí.
- `backend/logica/textoDeArchivo.js`: texto de Word, Excel y PowerPoint.
- `POST /v1/asistente` (`backend/server/app.js`): la respuesta llega en vivo (event-stream).
- `frontend/js/asistente-v2.js` + `frontend/css/v2/asistente-v2.css`: el botón y el panel.
- Seguridad: cada consulta corre con la sesión de la persona (las acciones ya validan sus permisos) y, como segunda barrera, dentro de un SAVEPOINT que siempre se deshace. Las tablas crudas solo las explora Administración, sin tablas de sesiones ni columnas de contraseñas o tokens.
- La conversación vive en el navegador de cada persona; el servidor no la guarda. Los adjuntos quedan en memoria del servidor unas horas.
- Pruebas: `backend/test/asistente.test.js` (con un Claude simulado: los tests nunca llaman a la API).

## Para GDE

La misma pieza sirve en GDE cambiando dos cosas: el texto de `asistenteConocimiento.js` (qué es GDE y su catálogo de consultas) y el puente a sus acciones. El panel del navegador se reutiliza tal cual.
