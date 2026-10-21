# Finanzas · corrección v2 — tablero de estado y punto de continuación

Orden de trabajo: `SIGSO-Finanzas_instrucciones-v2-correccion-y-pulido-local.md` (20-10-2026).
Alcance: solo local y copias aisladas. **Nada se publica ni se toca producción.**

Estados: `pendiente` · `en curso` · `probado` · `bloqueado (causa)`.

| Paquete | Estado | Evidencia / nota |
|---|---|---|
| I00 Preparación, respaldo y línea base | probado | [I00-preparacion.md](I00-preparacion.md) |
| I01 Identidad económica y doble conteo | probado | [I01-identidad.md](I01-identidad.md) · 103/103 · evidencia/i01-*.png |
| I02 Conciliación, fechas y correcciones | probado | [I02-conciliacion.md](I02-conciliacion.md) · 110/110 · evidencia/i02-*.png |
| I03 Disponibilidad, calidad, comparación y proyección | probado | [I03-disponibilidad.md](I03-disponibilidad.md) · 115/115 · evidencia/i03-*.png |
| I04 Cobranza completa desde la interfaz | probado | [I04-cobranza.md](I04-cobranza.md) · 122/122 · npm 1832/1832 · evidencia/i04-*.png |
| I05 Registro rápido y reutilización | probado | [I05-registro.md](I05-registro.md) · npm 1836/1836 · evidencia/i05-*.png |
| I06 Fondos, aperturas y remanentes | probado | [I06-fondos.md](I06-fondos.md) · npm 1840/1840 · evidencia/i06-*.png |
| I07 Cargas, migración y reglas | probado | [I07-cargas.md](I07-cargas.md) · npm 1845/1845 · evidencia/i07-*.png |
| I08 Navegación y sistema visual | probado (límites declarados) | [I08-navegacion.md](I08-navegacion.md) · npm 1847/1847 · evidencia/i08-*.png · manual reescrito en I14 |
| I09 Reportes, lectura automática y exportaciones | probado (límites declarados) | [I09-informes.md](I09-informes.md) · npm 1853/1853 · evidencia/i09-* · BUG revisión de datos (PDF siempre «cambiaron») corregido |
| I10 Planificación y funciones heredadas | probado (límites declarados) | [I10-planificacion.md](I10-planificacion.md) · npm 1859/1859 · evidencia/i10-*.png · tablero anterior retirado (pantalla y ruta) |
| I11 Permisos, concurrencia, revisión y cierre | probado (límites declarados) | [I11-permisos.md](I11-permisos.md) · npm 1864/1864 · matriz por API de 123 acciones · versión obligatoria al actualizar |
| I12 Rendimiento, sesión y recuperación de errores | probado (límites declarados) | [I12-rendimiento.md](I12-rendimiento.md) · npm 1868/1868 · S2 (14.400 movs): informe 11,8 s → 0,62 s; cobranza 10 s → 0,01 s · caché con rollback corregida |
| I13 Aceptación (QA-R01–R26, T01–T45) y guion de piloto | probado (límites declarados) · piloto humano PENDIENTE | [I13-aceptacion.md](I13-aceptacion.md) · [I13-guion-piloto.md](I13-guion-piloto.md) · npm 1872/1872 · fuentes reales: T01 exacto, ARMA $101.739 / VYE $0 / ELOHIM −$1 con diferencia 0 · 5 errores hallados y corregidos · parciales: QA-R19/T26 (alcance por empresa), QA-R24 (volumen en pantalla); T44 pendiente |
| I14 Versión candidata y plan de publicación (sin ejecutar) | entregado (sin publicar) | [I14-entrega.md](I14-entrega.md) · [I14-plan-publicacion.md](I14-plan-publicacion.md) · [I14-matriz-FIN.md](I14-matriz-FIN.md) · paquete de Finanzas sobre `af41a43` limpio: npm 1870/1870 (local completo 1872/1872) · manual reescrito (14 capturas) · herramientas demo/piloto con guardia · datos reales excluidos en .gitignore |

## Punto de continuación

- Último paso terminado: I14 (orden v2 completa).
- Siguiente: decisión del dueño (I14-entrega.md §6): piloto con operadoras, alcance por empresa, política de cierre, capacidades, y autorizar commit/publicación según I14-plan-publicacion.md. Nada se publicó.
- Respaldo del trabajo sin commit (328 archivos): fuera del repositorio, en el scratchpad de la sesión `respaldo-trabajo-20261020/`.
- Base de demostración: fuera del repositorio (scratchpad `demo/`). Los scripts se pasan al repositorio con protección en I14.
