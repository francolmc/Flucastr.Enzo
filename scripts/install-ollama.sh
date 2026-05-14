#!/usr/bin/env bash
set -euo pipefail

install_ollama_cli() {
    echo "  Instalando Ollama..."

    if [[ "$(uname -s)" == "Darwin" ]]; then
        if has_command brew; then
            brew install ollama 2>/dev/null || true
        fi
    fi

    if ! has_command ollama; then
        curl -fsSL https://ollama.ai/install.sh | sh
    fi

    if has_command ollama; then
        if [[ "$(uname -s)" == "Darwin" ]]; then
            if ! pgrep -x ollama > /dev/null 2>&1; then
                echo "  Iniciando Ollama..."
                ollama serve > /dev/null 2>&1 &
                sleep 2
            fi
        fi
        echo "✓ Ollama instalado"
        return 0
    fi

    echo "✗ Error: No se pudo instalar Ollama"
    return 1
}

ollama_model_exists() {
    local model=$1
    if ! has_command ollama; then
        return 1
    fi
    ollama list 2>/dev/null | grep -q "^${model}\s"
}

download_model() {
    local model=$1
    local size=""

    if [[ -t 1 ]]; then
        echo "  (Esto puede tomar varios minutos segun tu conexion)"
    fi

    ollama pull "${model}" 2>&1 | while IFS= read -r line; do
        if [[ -t 1 ]]; then
            if [[ "$line" =~ ([0-9.]+)(GB|MB)/([0-9.]+)(GB|MB) ]]; then
                local current=$(echo "$line" | grep -oP '^\d+(\.\d+)?(?=\s?[GM]B?)')
                local total=$(echo "$line" | grep -oP '(?<=/)\d+(\.\d+)?(?=\s?[GM]B?$)')
                if [[ -n "$current" ]] && [[ -n "$total" ]] && [[ "$total" != "0" ]]; then
                    local percent=$((current * 100 / total))
                    printf "\r  Descargando... %d%%" "${percent}"
                fi
            elif [[ "$line" =~ done ]]; then
                printf "\r  Descargando... 100%%\n"
            fi
        fi
    done

    if [[ -t 1 ]]; then
        echo ""
    fi

    if ollama_model_exists "${model}"; then
        echo "✓ Modelo ${model} descargado"
        return 0
    fi

    echo "✗ Error: No se pudo descargar el modelo ${model}"
    return 1
}

has_command() {
    command -v "$1" >/dev/null 2>&1
}