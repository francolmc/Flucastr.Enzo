#!/bin/bash

ENZO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SENTINEL="/tmp/enzo-update-requested"
PROGRESS_FILE="/tmp/enzo-update-progress"
LOG_FILE="/tmp/enzo-update.log"
PID_FILE="/tmp/enzo-api.pid"

echo "[watch-update] Supervisor iniciado. Monitoreando actualizaciones..."

while true; do
  if [ -f "$SENTINEL" ]; then
    echo "[watch-update] Actualización solicitada. Iniciando proceso..."

    > "$LOG_FILE"
    echo "STEP:0:4:Preparando actualización..." > "$PROGRESS_FILE"

    bash "$ENZO_DIR/scripts/update.sh"

    UPDATE_EXIT=$?

    if [ $UPDATE_EXIT -eq 0 ]; then
      echo "RESTARTING:Reiniciando Enzo..." > "$PROGRESS_FILE"

      if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        kill "$PID" 2>/dev/null || true
        sleep 2
      fi

      cd "$ENZO_DIR"
      nohup pnpm dev > /tmp/enzo-dev.log 2>&1 &
      echo $! > "$PID_FILE"

      echo "DONE:Enzo actualizado y reiniciado" > "$PROGRESS_FILE"
    else
      echo "ERROR:La actualización falló. Ver /tmp/enzo-update.log" > "$PROGRESS_FILE"
      rm -f "$SENTINEL"
    fi
  fi

  sleep 3
done