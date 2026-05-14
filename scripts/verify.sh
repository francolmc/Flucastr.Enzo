#!/usr/bin/env bash
set -euo pipefail

verify_api() {
    local api_url="http://localhost:3001/api/config"
    local max_attempts=5
    local attempt=1

    while [[ ${attempt} -le ${max_attempts} ]]; do
        if curl -sf --max-time 3 "${api_url}" > /dev/null 2>&1; then
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 1
    done

    return 1
}

verify_model() {
    local model=$1

    if ! command -v ollama >/dev/null 2>&1; then
        return 1
    fi

    local response
    response=$(curl -sf --max-time 10 http://localhost:11434/api/generate -d "{
      \"model\": \"${model}\",
      \"prompt\": \"Hello\",
      \"stream\": false
    }" 2>/dev/null || echo "")

    if [[ -n "${response}" ]]; then
        return 0
    fi

    return 1
}

verify_install_dir() {
    local install_dir=$1

    if [[ ! -d "${install_dir}" ]]; then
        return 1
    fi

    if [[ ! -f "${install_dir}/package.json" ]]; then
        return 1
    fi

    return 0
}