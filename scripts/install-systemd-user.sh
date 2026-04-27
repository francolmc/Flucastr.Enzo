#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="${1:-enzo}"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
SERVICE_PATH="${SYSTEMD_USER_DIR}/${SERVICE_NAME}.service"

mkdir -p "${SYSTEMD_USER_DIR}"

cat > "${SERVICE_PATH}" <<EOF
[Unit]
Description=Enzo stack
After=network.target

[Service]
Type=simple
WorkingDirectory=${REPO_ROOT}
Environment=ENZO_UPDATE_RESTART_CMD=systemctl --user restart ${SERVICE_NAME}
ExecStart=/usr/bin/env bash -lc './enzo start'
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable "${SERVICE_NAME}" >/dev/null
systemctl --user restart "${SERVICE_NAME}"

echo
echo "Installed user service: ${SERVICE_NAME}"
echo "Service file: ${SERVICE_PATH}"
echo
echo "Useful commands:"
echo "  systemctl --user status ${SERVICE_NAME}"
echo "  journalctl --user -u ${SERVICE_NAME} -f"
echo
echo "If this machine should keep Enzo alive without login:"
echo "  sudo loginctl enable-linger ${USER}"
