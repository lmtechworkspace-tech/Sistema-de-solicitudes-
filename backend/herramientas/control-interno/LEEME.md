# Herramientas de Control interno

Cómo se generaron las columnas de cada matriz (`backend/logica/controlInternoColumnas.js`)
a partir de las 7 planillas reales del Drive (2026-10-01). Se usan solo si cambia una
planilla y hay que volver a generar las columnas; no las usa el servidor.

1. `node volcar.js <carpeta-con-las-7-planillas>` — lee los .xlsx con el mismo lector del
   navegador (`frontend/js/lector-xlsx.js`) y los deja en `cache/` (no se versiona).
2. `node analizar.js > analisis.txt` — por matriz: hojas leídas, fila de encabezado, columnas
   en el orden de la planilla más nueva, nombres de versiones viejas, tipo de dato y valores
   frecuentes. `specs.js` dice de qué libro y hojas sale cada matriz.
3. `node generar.js` — escribe `controlInternoColumnas.js`. Después se ajusta a mano lo que
   haga falta y se corre `npm test` (control-interno.test.js valida las 54 matrices).

Las reglas de cada matriz (situación, tiempos, montos, qué se arrastra al abrir el mes) están
en `backend/logica/controlInternoMatrices.js`.
