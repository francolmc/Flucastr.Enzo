#!/bin/bash

ENZO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="/tmp/enzo-api.pid"

cd "$ENZO_DIR"

echo "[start] Iniciando Enzo..."

nohup bash "$ENZO_DIR/scripts/watch-update.sh" > /tmp/enzo-watch.log 2>&1 &
echo "[start] Supervisor iniciado (PID: $!)"

pnpm dev &
echo $! > "$PID_FILE"
echo "[start] Enzo iniciado (PID: $(cat $PID_FILE))"

wait