#!/usr/bin/env bash
set -euo pipefail

has_command() {
    command -v "$1" >/dev/null 2>&1
}

node_version() {
    node --version 2>/dev/null | tr -d 'v'
}

pnpm_version() {
    pnpm --version 2>/dev/null | head -1
}

git_version() {
    git --version 2>/dev/null | grep -oP '\d+\.\d+' | head -1
}

require_node() {
    if ! has_command node; then
        return 1
    fi
    local ver
    ver=$(node_version)
    local major
    major=$(echo "${ver}" | cut -d. -f1)
    if [[ "${major}" -lt 20 ]]; then
        echo "✗ Node.js 20+ requerido. Version actual: ${ver}"
        return 1
    fi
    return 0
}

require_pnpm() {
    has_command pnpm
}

require_git() {
    has_command git
}