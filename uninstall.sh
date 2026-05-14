#!/usr/bin/env bash
set -euo pipefail

ENZO_DIR="${HOME}/.enzo"
INSTALL_DIR="${HOME}/enzo"

show_usage() {
    cat <<EOF
Desinstalador de Enzo

Uso: uninstall.sh [OPCIONES]

Opciones:
  --dir <ruta>      Directorio de instalacion (default: ~/enzo)
  -h, --help        Mostrar esta ayuda

El script preguntara antes de eliminar datos.
EOF
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --dir)
                INSTALL_DIR="$2"
                shift 2
                ;;
            -h|--help)
                show_usage
                exit 0
                ;;
            *)
                echo "Opcion desconocida: $1"
                show_usage
                exit 1
                ;;
        esac
    done
}

stop_services() {
    echo ""
    echo "Deteniendo servicios..."

    if command -v pnpm >/dev/null 2>&1 && [[ -f "${INSTALL_DIR}/package.json" ]]; then
        (cd "${INSTALL_DIR}" && pnpm dev --stop 2>/dev/null || true)
    fi

    if pgrep -x "enzo" > /dev/null 2>&1; then
        pkill -x "enzo" 2>/dev/null || true
    fi

    echo "✓ Servicios detenidos"
}

remove_installation() {
    echo ""
    echo "Eliminando directorio de instalacion..."

    if [[ -d "${INSTALL_DIR}" ]]; then
        rm -rf "${INSTALL_DIR}"
        echo "✓ Directorio ${INSTALL_DIR} eliminado"
    else
        echo "○ Directorio ${INSTALL_DIR} no existe"
    fi
}

remove_data() {
    echo ""
    if [[ -d "${ENZO_DIR}" ]]; then
        rm -rf "${ENZO_DIR}"
        echo "✓ Datos eliminados de ${ENZO_DIR}"
    else
        echo "○ Directorio ${ENZO_DIR} no existe"
    fi
}

main() {
    parse_args "$@"

    echo "Desinstalando Enzo..."
    echo ""

    stop_services

    echo ""
    echo "¿Eliminar datos y configuracion en ${ENZO_DIR}? [s/N]: "
    read -r response

    if [[ "${response}" =~ ^[sS]$ ]]; then
        remove_data
    else
        echo "  Datos conservados en ${ENZO_DIR}"
    fi

    remove_installation

    echo ""
    echo "✅ Enzo desinstalado."
    echo ""
    echo "El modelo de Ollama no fue eliminado."
    echo "Para eliminar el modelo: ollama rm qwen2.5:7b"
}

main "$@"