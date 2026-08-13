#!/usr/bin/env bash
# Rompe el build si aparecen valores crudos fuera de la fuente de tokens:
# el design system solo es real si nadie puede saltárselo en silencio.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
check() {
  local pattern="$1" msg="$2"
  local hits
  hits=$(grep -rnE "$pattern" src \
    --include='*.vue' --include='*.ts' --include='*.css' \
    --exclude-dir=tokens --exclude-dir=__tests__ \
    | grep -v 'src/styles/tokens.css' || true)
  if [ -n "$hits" ]; then
    echo "✗ $msg:" >&2
    echo "$hits" >&2
    fail=1
  fi
}

check '#[0-9a-fA-F]{3,8}\b' "hex crudo (usa tokens)"
check 'cubic-bezier\(' "easing crudo (usa var(--rg-ease-*))"
check '\[[0-9.]+(px|rem|em)\]' "valor arbitrario de Tailwind (usa la escala)"

exit $fail
