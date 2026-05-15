#!/bin/bash
set -euo pipefail

ENZO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="/tmp/enzo-update.log"
PROGRESS_FILE="/tmp/enzo-update-progress"
SENTINEL="/tmp/enzo-update-requested"

cd "$ENZO_DIR"

log() {
  echo "[update] $1" | tee -a "$LOG_FILE"
  echo "$1" > "$PROGRESS_FILE"
}

log "Iniciando actualización desde $ENZO_DIR"

log "STEP:1:4:Verificando cambios en GitHub..."
git fetch origin main 2>&1 | tee -a "$LOG_FILE"

log "STEP:2:4:Descargando cambios..."
git pull origin main 2>&1 | tee -a "$LOG_FILE"

log "STEP:3:4:Instalando dependencias..."
pnpm install --frozen-lockfile 2>&1 | tee -a "$LOG_FILE"

log "STEP:4:4:Compilando..."
pnpm -F @enzo/core build 2>&1 | tee -a "$LOG_FILE"

log "DONE:Actualización completada"

rm -f "$SENTINEL"