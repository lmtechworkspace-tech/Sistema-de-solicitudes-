#!/usr/bin/env bash
# asegurar-chromium.sh — deja listo el motor de PDF (R-3 de la auditoría de
# reportes) en el servidor: las librerías del sistema que Chromium necesita y
# chrome-headless-shell en la versión EXACTA que espera puppeteer-core.
#
# Idempotente: si ya está todo, termina en un segundo sin tocar nada. Lo corre
# el despliegue (.github/workflows/deploy-backend.yml) después de sincronizar
# node_modules, así que un servidor nuevo queda igual al actual sin pasos a
# mano, y subir puppeteer-core trae su Chromium sin que nadie se acuerde.
#
# Dónde queda: /opt/sigso/chrome/actual, enlace al binario de la versión vigente
# (las versiones descargadas viven en /opt/sigso/chrome/versiones).
# logica/pdfChromium.js lo busca ahí; SIGSO_CHROME_PATH lo puede reemplazar.
set -euo pipefail

APP=/opt/sigso
DESTINO="$APP/chrome"
VERSIONES="$DESTINO/versiones"
ENLACE="$DESTINO/actual"

# 1. Librerías del sistema (nombres de Ubuntu 24.04+, con el sufijo t64).
PAQUETES=(libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libxkbcommon0 libxcomposite1
  libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 fontconfig fonts-dejavu-core
  unzip) # unzip: el instalador lo necesita para descomprimir (sin él falla sin avisar claro)
FALTAN=()
for p in "${PAQUETES[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || FALTAN+=("$p"); done
if [ ${#FALTAN[@]} -gt 0 ]; then
  echo "Instalando librerías: ${FALTAN[*]}"
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${FALTAN[@]}"
fi

# 2. La versión que espera el puppeteer-core desplegado.
VERSION=$(cd "$APP" && node -e "process.stdout.write(require('puppeteer-core').PUPPETEER_REVISIONS['chrome-headless-shell'])")
if [ -x "$ENLACE" ] && "$ENLACE" --version 2>/dev/null | grep -q "$VERSION"; then
  echo "Motor de PDF listo: chrome-headless-shell $VERSION"
  exit 0
fi

# 3. Descarga con el instalador oficial que ya viene en node_modules (sin npx
#    ni paquetes de internet fuera de la descarga del propio navegador).
echo "Instalando chrome-headless-shell $VERSION…"
mkdir -p "$VERSIONES"
# Restos de intentos fallidos: una carpeta donde va el enlace, o la del primer
# diseño (/opt/sigso/chrome/chrome-headless-shell, que chocaba con el instalador).
for resto in "$ENLACE" "$DESTINO/chrome-headless-shell"; do
  if [ -d "$resto" ] && [ ! -L "$resto" ]; then rm -rf "$resto"; fi
done
SALIDA=$(cd "$APP" && node node_modules/@puppeteer/browsers/lib/main-cli.js install "chrome-headless-shell@$VERSION" --path "$VERSIONES")
BINARIO=$(echo "$SALIDA" | tail -n 1 | awk '{print $2}')
if [ ! -x "$BINARIO" ]; then echo "No se encontró el binario instalado: $SALIDA" >&2; exit 1; fi
ln -sfn "$BINARIO" "$ENLACE"

# 4. Verificación: ninguna librería faltante y responde su versión.
if ldd "$BINARIO" | grep -q "not found"; then
  echo "Faltan librerías para Chromium:" >&2
  ldd "$BINARIO" | grep "not found" >&2
  exit 1
fi
"$ENLACE" --version
