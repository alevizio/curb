#!/bin/sh
# Regenerate og.png (1200x630 social card) from og/template-home.html via headless Chrome;
# `sh og/render.sh boston` makes og-boston.png (the Boston preview's card) from og/template-boston.html.
cd "$(dirname "$0")/.." || exit 1
if [ "$1" = boston ]; then OUT=og-boston.png; SRC=og/template-boston.html; else OUT=og.png; SRC=og/template-home.html; fi
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --hide-scrollbars \
  --window-size=1200,630 --force-device-scale-factor=1 --virtual-time-budget=8000 \
  --screenshot="$PWD/$OUT" "file://$PWD/$SRC"
sips -g pixelWidth -g pixelHeight "$OUT"
