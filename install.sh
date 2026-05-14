#!/usr/bin/env bash
set -euo pipefail

VERSION="0.1.0"
ENZO_REPO="francolmc/Flucastr.Enzo"
ENZO_BRANCH="main"
ENZO_DEFAULT_MODEL="qwen2.5:7b"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR=""
MODEL="${ENZO_DEFAULT_MODEL}"
PROVIDER=""
API_KEY=""
INSTALL_SERVICE=false
QUIET_MODE=false
CHECK_ONLY=false
UPDATE_ONLY=false

ENZO_DIR="${HOME}/.enzo"
CONFIG_PATH="${ENZO_DIR}/config.json"

show_usage() {
    cat <<EOF
Instalador de Enzo - Tu asistente de IA personal

Uso: install.sh [OPCIONES]

Opciones:
  --check              Solo verificar requisitos, no instalar
  --dir <ruta>         Directorio de instalacion (default: ~/enzo)
  --model <modelo>     Modelo a usar (default: qwen2.5:7b)
  --provider <prov>    Provider: ollama o anthropic
  --api-key <key>      API key para Anthropic
  --update             Actualizar instalacion existente
  --service            Instalar servicio del sistema (LaunchAgent/systemd)
  --quiet              Modo silencioso
  -h, --help           Mostrar esta ayuda

Ejemplos:
  install.sh                    # Instalacion completa
  install.sh --check            # Solo verificar requisitos
  install.sh --model llama3.2   # Con modelo especifico
  install.sh --update           # Actualizar instalacion
EOF
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --check)
                CHECK_ONLY=true
                shift
                ;;
            --dir)
                INSTALL_DIR="$2"
                shift 2
                ;;
            --model)
                MODEL="$2"
                shift 2
                ;;
            --provider)
                PROVIDER="$2"
                shift 2
                ;;
            --api-key)
                API_KEY="$2"
                shift 2
                ;;
            --update)
                UPDATE_ONLY=true
                shift
                ;;
            --service)
                INSTALL_SERVICE=true
                shift
                ;;
            --quiet)
                QUIET_MODE=true
                shift
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

log() {
    if [[ "${QUIET_MODE}" == "true" ]]; then
        return
    fi
    echo -e "$1"
}

log_step() {
    local num=$1
    local total=$2
    local msg=$3
    log "[${num}/${total}] ${msg}"
}

detect_os() {
    source "${SCRIPT_DIR}/detect-os.sh"
    detect
}

check_dependencies() {
    log_step 1 6 "Verificando requisitos del sistema..."

    source "${SCRIPT_DIR}/check-deps.sh"

    local missing_deps=false

    if ! has_command node; then
        log "✗ Node.js no encontrado."
        missing_deps=true
    else
        local node_version
        node_version=$(node_version)
        log "✓ Node.js detectado (v${node_version})"
    fi

    if ! has_command pnpm; then
        log "✗ pnpm no encontrado."
        missing_deps=true
    else
        local pnpm_version
        pnpm_version=$(pnpm_version)
        log "✓ pnpm detectado (v${pnpm_version})"
    fi

    if has_command git; then
        log "✓ Git detectado"
    else
        log "○ Git no detectado (opcional para instalacion)"
    fi

    if [[ "${missing_deps}" == "true" ]]; then
        log ""
        log "Para instalar Node.js, ejecuta:"
        log "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash"
        log "  nvm install 20 && nvm use 20"
        log ""
        log "Luego reinicia este script."
        return 1
    fi

    return 0
}

install_node_if_needed() {
    if ! has_command node; then
        log ""
        log "✗ Node.js no encontrado. Instalando..."
        source "${SCRIPT_DIR}/install-node.sh"
        install_node
    fi
}

install_ollama() {
    source "${SCRIPT_DIR}/install-ollama.sh"

    if ! has_command ollama; then
        log ""
        log "○ Ollama no encontrado. Instalando..."
        install_ollama_cli
    else
        log "✓ Ollama ya instalado"
    fi

    if ! ollama_model_exists "${MODEL}"; then
        log ""
        log "○ Modelo ${MODEL} no encontrado. Descargando..."
        download_model "${MODEL}"
    else
        log "✓ Modelo ${MODEL} ya disponible"
    fi
}

clone_repo() {
    log_step 2 6 "Clonando repositorio..."

    if [[ -z "${INSTALL_DIR}" ]]; then
        INSTALL_DIR="${HOME}/enzo"
    fi

    if [[ -d "${INSTALL_DIR}/.git" ]]; then
        log "✓ Repositorio ya existe en ${INSTALL_DIR}"
        if [[ "${UPDATE_ONLY}" == "true" ]]; then
            log "  Ejecutando git pull..."
            cd "${INSTALL_DIR}"
            git pull --ff-only origin main 2>/dev/null || git pull origin main
        fi
    else
        log "  Clonando ${ENZO_REPO}..."
        git clone --depth 1 -b "${ENZO_BRANCH}" "https://github.com/${ENZO_REPO}.git" "${INSTALL_DIR}"
    fi

    log "✓ Repositorio preparado en ${INSTALL_DIR}"
}

install_dependencies() {
    log_step 3 6 "Instalando dependencias..."

    cd "${INSTALL_DIR}"
    pnpm install --frozen-lockfile
    log "✓ Dependencias instaladas"
}

configure_enzo() {
    log_step 5 6 "Configurando Enzo..."

    source "${SCRIPT_DIR}/setup-config.sh"

    mkdir -p "${ENZO_DIR}"

    if [[ "${PROVIDER}" == "anthropic" ]] && [[ -n "${API_KEY}" ]]; then
        setup_config_anthropic "${API_KEY}"
    else
        setup_config_ollama "${MODEL}"
    fi

    setup_mcp_servers

    log "✓ Configuracion generada en ${CONFIG_PATH}"
}

verify_installation() {
    log_step 6 6 "Verificando instalacion..."

    source "${SCRIPT_DIR}/verify.sh"

    cd "${INSTALL_DIR}"

    if verify_api; then
        log "✓ API responde en http://localhost:3001"
    else
        log "○ API no disponible aun (esto es normal si no se ha iniciado)"
    fi

    if verify_model "${MODEL}"; then
        log "✓ Modelo ${MODEL} responde"
    else
        log "○ Modelo no responde aun"
    fi

    log "✓ Verificacion completada"
}

install_service() {
    if [[ "${INSTALL_SERVICE}" == "true" ]]; then
        log ""
        log "  Instalando servicio del sistema..."
        if [[ "${OS_TYPE}" == "macos" ]]; then
            bash "${INSTALL_DIR}/scripts/install-systemd-user.sh" 2>/dev/null || true
        else
            bash "${INSTALL_DIR}/scripts/install-systemd-user.sh" 2>/dev/null || true
        fi
    fi
}

main() {
    parse_args "$@"

    log "🚀 Instalando Enzo..."
    log ""

    detect_os

    if [[ "${CHECK_ONLY}" == "true" ]]; then
        log "Modo verificacion - solo checando dependencias"
        log ""
        if check_dependencies; then
            log ""
            log "✅ Todos los requisitos estan satisfechos."
            exit 0
        else
            log ""
            log "✗ Faltan requisitos. Verifica las instrucciones arriba."
            exit 1
        fi
    fi

    if [[ "${UPDATE_ONLY}" == "true" ]]; then
        log "Modo actualizacion"
        INSTALL_DIR="${HOME}/enzo"
        if [[ ! -d "${INSTALL_DIR}" ]]; then
            log "✗ No se encontro instalacion en ${INSTALL_DIR}"
            log "  Ejecuta install.sh sin --update para instalar."
            exit 1
        fi

        cd "${INSTALL_DIR}"
        log "  Ejecutando git pull..."
        git pull --ff-only origin main 2>/dev/null || git pull origin main

        log "  Instalando dependencias..."
        pnpm install --frozen-lockfile

        log "  Compilando..."
        pnpm build

        log ""
        log "✅ Enzo actualizado."
        log ""
        log "Para iniciar: cd ${INSTALL_DIR} && pnpm dev"
        exit 0
    fi

    check_dependencies || exit 1

    clone_repo

    install_dependencies

    if [[ "${PROVIDER}" != "anthropic" ]] || [[ -z "${API_KEY}" ]]; then
        install_ollama
    fi

    configure_enzo

    verify_installation

    install_service

    log ""
    log "✅ ¡Enzo instalado correctamente!"
    log ""
    log "Para iniciar Enzo:"
    log "  cd ${INSTALL_DIR} && pnpm dev"
    log ""
    log "Accede a la interfaz en: http://localhost:5173"
}

main "$@"