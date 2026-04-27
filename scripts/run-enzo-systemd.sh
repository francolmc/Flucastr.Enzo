#!/usr/bin/env bash
set -euo pipefail

cd /home/franco/Flucastr.Enzo

# fnm -> node
eval "$(/home/franco/.local/share/fnm/fnm env --shell bash)"

# pnpm (ajusta si lo tienes en otra ruta)
export PNPM_HOME="/home/franco/.local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"

exec node /home/franco/Flucastr.Enzo/packages/cli/dist/index.js start
