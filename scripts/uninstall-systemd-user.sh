#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${1:-enzo}"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
SERVICE_PATH="${SYSTEMD_USER_DIR}/${SERVICE_NAME}.service"

systemctl --user disable --now "${SERVICE_NAME}" >/dev/null 2>&1 || true

rm -f "${SERVICE_PATH}"
systemctl --user daemon-reload

echo
echo "Uninstalled user service: ${SERVICE_NAME}"
echo "Removed: ${SERVICE_PATH}"
