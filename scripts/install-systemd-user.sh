#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="${1:-enzo}"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
SERVICE_PATH="${SYSTEMD_USER_DIR}/${SERVICE_NAME}.service"
WRAPPER_PATH="${REPO_ROOT}/scripts/run-enzo-systemd.sh"
FNM_BIN_DEFAULT="${HOME}/.local/share/fnm/fnm"
PNPM_HOME_DEFAULT="${HOME}/.local/share/pnpm"
NODE_BIN="$(command -v node || true)"
FNM_BIN="$(command -v fnm || true)"
PNPM_HOME_VALUE="${PNPM_HOME:-}"

if [[ -z "${PNPM_HOME_VALUE}" ]]; then
  if [[ -d "${PNPM_HOME_DEFAULT}" ]]; then
    PNPM_HOME_VALUE="${PNPM_HOME_DEFAULT}"
  elif command -v pnpm >/dev/null 2>&1; then
    PNPM_HOME_VALUE="$(dirname "$(command -v pnpm)")"
  fi
fi

if [[ -z "${FNM_BIN}" && -x "${FNM_BIN_DEFAULT}" ]]; then
  FNM_BIN="${FNM_BIN_DEFAULT}"
fi

mkdir -p "${SYSTEMD_USER_DIR}"

cat > "${WRAPPER_PATH}" <<EOF
#!/usr/bin/env bash
set -euo pipefail

cd ${REPO_ROOT}
EOF

if [[ -n "${FNM_BIN}" ]]; then
  cat >> "${WRAPPER_PATH}" <<EOF
eval "\$(${FNM_BIN} env --shell bash)"
EOF
fi

if [[ -n "${PNPM_HOME_VALUE}" ]]; then
  cat >> "${WRAPPER_PATH}" <<EOF
export PNPM_HOME="${PNPM_HOME_VALUE}"
export PATH="\${PNPM_HOME}:\${PATH}"
EOF
fi

if [[ -n "${NODE_BIN}" ]]; then
  cat >> "${WRAPPER_PATH}" <<EOF
exec ${NODE_BIN} ${REPO_ROOT}/packages/cli/dist/index.js start
EOF
else
  cat >> "${WRAPPER_PATH}" <<EOF
exec node ${REPO_ROOT}/packages/cli/dist/index.js start
EOF
fi

chmod +x "${WRAPPER_PATH}"

cat > "${SERVICE_PATH}" <<EOF
[Unit]
Description=Enzo stack
After=network.target

[Service]
Type=simple
WorkingDirectory=${REPO_ROOT}
Environment=HOME=${HOME}
Environment=USER=${USER}
Environment="ENZO_UPDATE_RESTART_CMD=systemctl --user restart ${SERVICE_NAME}"
ExecStart=${WRAPPER_PATH}
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
echo "Wrapper: ${WRAPPER_PATH}"
echo
echo "Useful commands:"
echo "  systemctl --user status ${SERVICE_NAME}"
echo "  journalctl --user -u ${SERVICE_NAME} -f"
echo
echo "If this machine should keep Enzo alive without login:"
echo "  sudo loginctl enable-linger ${USER}"
