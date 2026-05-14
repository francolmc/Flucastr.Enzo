#!/usr/bin/env bash
set -euo pipefail

install_node() {
    local install_dir="${HOME}/.nvm"
    local node_version="20"

    if [[ -d "${install_dir}" ]]; then
        export NVM_DIR="${install_dir}"
        export PATH="${NVM_DIR}/versions/node/v${node_version}/bin:${PATH}"
        if has_command node; then
            return 0
        fi
    fi

    echo "  Instalando Node.js ${node_version} via nvm..."

    local nvm_installed=false

    if has_command brew && [[ "$(uname -s)" == "Darwin" ]]; then
        echo "  Usando Homebrew..."
        if has_command nvm 2>/dev/null; then
            nvm install "${node_version}" && nvm use "${node_version}"
            nvm_installed=true
        else
            brew install nvm 2>/dev/null || true
            export NVM_DIR="${HOME}/.nvm"
            if [[ -f "${NVM_DIR}/nvm.sh" ]]; then
                . "${NVM_DIR}/nvm.sh"
                nvm install "${node_version}" && nvm use "${node_version}"
                nvm_installed=true
            fi
        fi
    fi

    if [[ "${nvm_installed}" == "false" ]]; then
        echo "  Instalando nvm manualmente..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash

        export NVM_DIR="${HOME}/.nvm"
        . "${NVM_DIR}/nvm.sh"

        nvm install "${node_version}"
        nvm use "${node_version}"
    fi

    if ! has_command node; then
        echo "✗ Error: No se pudo instalar Node.js"
        return 1
    fi

    echo "✓ Node.js $(node --version) instalado"
    return 0
}

has_command() {
    command -v "$1" >/dev/null 2>&1
}

node_version() {
    node --version 2>/dev/null | tr -d 'v'
}

install_node