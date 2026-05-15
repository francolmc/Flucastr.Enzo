#!/bin/bash
set -e

ENZO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ENZO_DIR"

echo "[update] Starting Enzo update..."
echo "[update] Working directory: $ENZO_DIR"

echo "[update] Fetching latest changes and tags..."
git fetch origin main
git fetch --tags

echo "[update] Checking out latest main..."
git checkout main
git pull origin main

echo "[update] Installing dependencies..."
pnpm install

echo "[update] Building packages..."
pnpm build

echo "[update] Verifying version..."
cat package.json | grep '"version"'

echo "[update] Restarting Enzo..."
./enzo stop 2>/dev/null || true
sleep 2
./enzo start

echo "[update] Done!"