# SIGSO: auditoría de Codex y correcciones con Claude Code

Estado: puente preparado; pendiente de instalación, autenticación y una prueba real en el entorno del usuario. No conecta esta conversación de ChatGPT a una sesión existente de Claude ni comparte el historial entre cuentas.

El puente usa `codex exec` en modo solo lectura y devuelve un informe estructurado con evidencia, corrección y validación. Claude Code puede ejecutar ese comando, leer el informe, corregir y solicitar otra revisión dentro de su propia sesión. No añade llamadas al frontend de SIGSO ni carga a sus usuarios.

## Activación en el entorno donde corre Claude Code

1. Incorpora este parche al checkout de SIGSO, sin sobrescribir cambios locales. Si se entrega como archivo `.patch`, usa primero `git apply --check RUTA_AL_PARCHE` y después `git apply RUTA_AL_PARCHE`.
2. Instala Codex CLI allí: `npm install -g @openai/codex`.
3. Ejecuta `codex` e inicia sesión con tu cuenta de ChatGPT. Esta acción requiere al titular de la cuenta. No pegues contraseñas ni tokens en el repositorio o el chat.
4. En la raíz del proyecto, ejecuta `node tools/codex-audit.mjs --check`. Solo comprueba el ejecutable, no certifica el inicio de sesión.
5. Prueba `node tools/codex-audit.mjs "Autenticación y separación de datos entre empresas"`. Una ejecución real que produzca INFORME-PARA-CLAUDE.md confirma la comunicación con Codex.

Windows: el script soporta el instalador npm habitual y ejecutables nativos codex.exe. Si usas WSL o un contenedor, instala e inicia sesión dentro de ese mismo entorno; instalar en Windows no configura WSL automáticamente. En Claude Code web, comprueba que su entorno permite instalar y autenticar el CLI; tener el repositorio conectado no garantiza esos requisitos.

## Instrucción para la sesión de Claude Code

Lee documentacion/CONEXION-CODEX-CLAUDE.md. Comprueba que Codex está instalado y autenticado en este entorno. Ejecuta node tools/codex-audit.mjs con un alcance acotado. Lee el INFORME-PARA-CLAUDE.md de la ejecución que acaba de terminar. Contrasta los hallazgos con el código y corrige los defectos confirmados. Ejecuta las pruebas pertinentes en America/Santiago y vuelve a solicitar auditoría a Codex sobre las correcciones. Máximo dos rondas. Documenta lo resuelto, descartado y pendiente, así como errores de herramientas o autenticación. No hagas push ni despliegues ni modifiques credenciales o el puente. No anuncies éxito por un informe sin hallazgos si quedan módulos por revisar.

Para la auditoría de todo SIGSO, empieza por inventariar módulos y después ejecuta revisiones por grupos: autenticación/multiempresa, solicitudes, proyectos, calidad, finanzas, portal de clientes, control interno, notificaciones/documentos y navegación/rendimiento. El estado visual requiere además observar la aplicación en un entorno de pruebas. Una sola invocación general no prueba cobertura exhaustiva.

## Informes y límites

Los informes locales están en `.auditoria-codex/`, excluidos de Git. Incluyen el commit base y los cambios locales existentes. El script no crea commits, hace push ni despliega. Usa la cuenta y límites del CLI autenticado; no comprueba disponibilidad de cuota ni crea claves de API.

Sin ambas cuentas disponibles en el entorno de ejecución no se puede probar la cooperación real. Las pruebas con ejecutables simulados solo verifican el mecanismo de entrega y manejo de errores.

Fuentes: https://learn.chatgpt.com/docs/non-interactive-mode y https://code.claude.com/docs/en/headless.
