#!/bin/bash
set -e

ENZO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ENZO_DIR"

echo "[update] Starting Enzo update..."

echo "[update] Pulling latest changes..."
git pull --ff-only origin main

echo "[update] Installing dependencies..."
pnpm install

echo "[update] Building packages..."
pnpm build

echo "[update] Restarting Enzo..."
./enzo stop 2>/dev/null || true
sleep 2
./enzo start

echo "[update] Done!"