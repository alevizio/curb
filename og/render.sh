#!/bin/sh
# Regenerate og.png (1200x630 social card) from og/template.html via headless Chrome.
cd "$(dirname "$0")/.." || exit 1
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --hide-scrollbars \
  --window-size=1200,630 --force-device-scale-factor=1 --virtual-time-budget=8000 \
  --screenshot="$PWD/og.png" "file://$PWD/og/template.html"
sips -g pixelWidth -g pixelHeight og.png
