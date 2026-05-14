#!/usr/bin/env bash
set -eo pipefail

VERSION="0.1.0"
ENZO_REPO="francolmc/Flucastr.Enzo"
ENZO_BRANCH="main"
ENZO_DEFAULT_MODEL="qwen2.5:7b"

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
IS_REMOTE=false

if [[ -n "${BASH_SOURCE[0]:-}" ]] && [[ -f "${BASH_SOURCE[0]}" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
else
    SCRIPT_DIR="$(pwd)"
    SCRIPT_NAME="install.sh"
    if [[ ! -f "${SCRIPT_DIR}/${SCRIPT_NAME}" ]]; then
        IS_REMOTE=true
    fi
fi

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

has_command() {
    command -v "$1" >/dev/null 2>&1
}

node_version() {
    node --version 2>/dev/null | tr -d 'v' || echo "0"
}

pnpm_version() {
    pnpm --version 2>/dev/null | head -1 || echo "0"
}

detect_os() {
    OS_TYPE=""
    OS_VERSION=""
    ARCH=""

    case "$(uname -s)" in
        Linux*)
            OS_TYPE="linux"
            if [[ -f /etc/os-release ]]; then
                . /etc/os-release
                OS_VERSION="${ID}${VERSION_ID:-}"
            elif [[ -f /etc/debian_version ]]; then
                OS_VERSION="debian"
            else
                OS_VERSION="unknown"
            fi
            ;;
        Darwin*)
            OS_TYPE="macos"
            OS_VERSION=$(sw_vers -productVersion 2>/dev/null || uname -r)
            ;;
        *)
            OS_TYPE="unsupported"
            ;;
    esac

    case "$(uname -m)" in
        x86_64) ARCH="x64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *) ARCH="unknown" ;;
    esac

    if [[ "${OS_TYPE}" == "unsupported" ]]; then
        log "✗ Sistema operativo no soportado: $(uname -s)"
        log "  Soportados: macOS 13+, Ubuntu 22.04+, Debian 11+"
        exit 1
    fi

    if [[ "${OS_TYPE}" == "macos" ]]; then
        local major
        major=$(echo "${OS_VERSION}" | cut -d. -f1)
        if [[ "${major}" -lt 13 ]]; then
            log "✗ macOS 13+ requerido. Version actual: ${OS_VERSION}"
            exit 1
        fi
    fi
}

check_dependencies() {
    log_step 1 6 "Verificando requisitos del sistema..."

    local missing_deps=false

    if ! has_command node; then
        log "✗ Node.js no encontrado."
        missing_deps=true
    else
        log "✓ Node.js detectado (v$(node_version))"
    fi

    if ! has_command pnpm; then
        log "✗ pnpm no encontrado."
        missing_deps=true
    else
        log "✓ pnpm detectado (v$(pnpm_version))"
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

        local install_dir="${HOME}/.nvm"
        local node_version="20"

        if [[ -d "${install_dir}" ]]; then
            export NVM_DIR="${install_dir}"
            export PATH="${NVM_DIR}/versions/node/v${node_version}/bin:${PATH}"
            if has_command node; then
                return 0
            fi
        fi

        log "  Instalando Node.js ${node_version} via nvm..."

        if has_command brew && [[ "$(uname -s)" == "Darwin" ]]; then
            log "  Usando Homebrew..."
            brew install nvm 2>/dev/null || true
            export NVM_DIR="${HOME}/.nvm"
            if [[ -f "${NVM_DIR}/nvm.sh" ]]; then
                . "${NVM_DIR}/nvm.sh"
                nvm install "${node_version}" && nvm use "${node_version}"
            fi
        fi

        if ! has_command node; then
            log "  Instalando nvm manualmente..."
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
            export NVM_DIR="${HOME}/.nvm"
            . "${NVM_DIR}/nvm.sh" 2>/dev/null || source "${NVM_DIR}/nvm.sh" 2>/dev/null || true
            nvm install "${node_version}" 2>/dev/null || true
            nvm use "${node_version}" 2>/dev/null || true
        fi

        if has_command node; then
            log "✓ Node.js $(node_version) instalado"
        else
            log "✗ Error: No se pudo instalar Node.js"
            return 1
        fi
    fi
}

install_ollama() {
    if ! has_command ollama; then
        log ""
        log "○ Ollama no encontrado. Instalando..."

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
                    log "  Iniciando Ollama..."
                    ollama serve > /dev/null 2>&1 &
                    sleep 2
                fi
            fi
            log "✓ Ollama instalado"
        fi
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

ollama_model_exists() {
    local model=$1
    if ! has_command ollama; then
        return 1
    fi
    ollama list 2>/dev/null | grep -q "^${model}\s"
}

download_model() {
    local model=$1

    if [[ -t 1 ]]; then
        echo "  (Esto puede tomar varios minutos segun tu conexion)"
    fi

    if ollama run "${model}" "Hello" > /dev/null 2>&1; then
        echo "✓ Modelo ${model} disponible"
        return 0
    fi

    ollama pull "${model}" 2>&1 | while IFS= read -r line; do
        if [[ -t 1 ]]; then
            if [[ "$line" =~ ([0-9.]+)(GB|MB)/([0-9.]+)(GB|MB) ]] || [[ "$line" =~ ([0-9.]+)% ]]; then
                printf "\r  Descargando... %s" "$line"
            elif [[ "$line" == *"done"* ]]; then
                printf "\r  Descargando... 100%%\n"
            fi
        fi
    done

    if [[ -t 1 ]]; then
        echo ""
    fi

    if ollama_model_exists "${model}"; then
        log "✓ Modelo ${MODEL} descargado"
        return 0
    fi

    log "✗ Error: No se pudo descargar el modelo ${model}"
    return 1
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

detect_locale() {
    local locale="es-CL"
    local tz="America/Santiago"

    if command -v locale > /dev/null 2>&1; then
        local detected_lang
        detected_lang=$(locale 2>/dev/null | grep LANG | cut -d= -f2 | cut -d_ -f1 || echo "")
        if [[ -n "${detected_lang}" ]]; then
            locale="${detected_lang}-CL"
        fi
    fi

    if [[ -f /etc/timezone ]]; then
        tz=$(cat /etc/timezone 2>/dev/null || echo "America/Santiago")
    elif [[ -L /etc/localtime ]]; then
        local tz_link
        tz_link=$(readlink -f /etc/localtime 2>/dev/null || echo "")
        if [[ "${tz_link}" == *"/usr/share/zoneinfo/"* ]]; then
            tz=$(echo "${tz_link}" | sed 's|.*/zoneinfo/||')
        fi
    fi

    echo "${locale}|${tz}"
}

configure_enzo() {
    log_step 5 6 "Configurando Enzo..."

    mkdir -p "${ENZO_DIR}"

    if [[ "${PROVIDER}" == "anthropic" ]] && [[ -n "${API_KEY}" ]]; then
        setup_config_anthropic "${API_KEY}"
    else
        setup_config_ollama "${MODEL}"
    fi

    setup_mcp_servers

    log "✓ Configuracion generada en ${CONFIG_PATH}"
}

setup_config_ollama() {
    local model=$1
    local detected=$(detect_locale)
    local locale=$(echo "${detected}" | cut -d'|' -f1)
    local tz=$(echo "${detected}" | cut -d'|' -f2)

    cat > "${CONFIG_PATH}" <<EOF
{
  "primaryModel": "${model}",
  "primaryProvider": "ollama",
  "fallbackModels": [],
  "providers": {
    "ollama": {
      "name": "Ollama",
      "enabled": true,
      "hasApiKey": false
    }
  },
  "system": {
    "ollamaBaseUrl": "http://localhost:11434",
    "anthropicModel": "claude-haiku-4-5",
    "port": "3001",
    "uiPort": "5173",
    "dbPath": "${HOME}/.enzo/enzo.db",
    "enzoWorkspacePath": "${HOME}/.enzo/workspace",
    "enzoSkillsPath": "${HOME}/.enzo/skills",
    "enzoDebug": false,
    "enzoSkillsFallbackRelevanceThreshold": 0.12,
    "mcpAutoConnect": true,
    "defaultUserLanguage": "es",
    "tz": "${tz}"
  },
  "assistantProfile": {
    "name": "Enzo",
    "persona": "Intelligent personal assistant",
    "tone": "Friendly, direct and helpful"
  },
  "userProfile": {
    "locale": "${locale}",
    "timezone": "${tz}"
  }
}
EOF
}

setup_config_anthropic() {
    local api_key=$1

    cat > "${CONFIG_PATH}" <<EOF
{
  "primaryModel": "claude-haiku-4-5",
  "primaryProvider": "anthropic",
  "fallbackModels": [],
  "providers": {
    "anthropic": {
      "name": "Anthropic",
      "enabled": true,
      "hasApiKey": true,
      "apiKeyEncrypted": "${api_key}"
    }
  },
  "system": {
    "ollamaBaseUrl": "http://localhost:11434",
    "anthropicModel": "claude-haiku-4-5",
    "port": "3001",
    "uiPort": "5173",
    "dbPath": "${HOME}/.enzo/enzo.db",
    "enzoWorkspacePath": "${HOME}/.enzo/workspace",
    "enzoSkillsPath": "${HOME}/.enzo/skills",
    "enzoDebug": false,
    "enzoSkillsFallbackRelevanceThreshold": 0.12,
    "mcpAutoConnect": false,
    "defaultUserLanguage": "es",
    "tz": "America/Santiago"
  },
  "assistantProfile": {
    "name": "Enzo",
    "persona": "Intelligent personal assistant",
    "tone": "Friendly, direct and helpful"
  },
  "userProfile": {
    "locale": "es-CL",
    "timezone": "America/Santiago"
  }
}
EOF
}

setup_mcp_servers() {
    local mcp_config_dir="${ENZO_DIR}/mcp-servers"
    mkdir -p "${mcp_config_dir}"

    cat > "${mcp_config_dir}/filesystem.json" <<EOF
{
  "id": "filesystem",
  "name": "Filesystem",
  "description": "Access to local filesystem",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "${HOME}"],
  "enabled": true,
  "createdAt": $(date +%s),
  "updatedAt": $(date +%s)
}
EOF

    cat > "${mcp_config_dir}/duckduckgo.json" <<EOF
{
  "id": "duckduckgo",
  "name": "DuckDuckGo Search",
  "description": "Web search via DuckDuckGo",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "duckduckgo-mcp"],
  "enabled": true,
  "createdAt": $(date +%s),
  "updatedAt": $(date +%s)
}
EOF
}

verify_installation() {
    log_step 6 6 "Verificando instalacion..."

    if curl -sf --max-time 3 http://localhost:3001/api/config > /dev/null 2>&1; then
        log "✓ API responde en http://localhost:3001"
    else
        log "○ API no disponible aun (esto es normal si no se ha iniciado)"
    fi

    if ollama_model_exists "${MODEL}"; then
        log "✓ Modelo ${MODEL} responde"
    else
        log "○ Modelo no responde aun"
    fi

    log "✓ Verificacion completada"
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

    if [[ "${INSTALL_SERVICE}" == "true" ]]; then
        log ""
        log "  Instalando servicio del sistema..."
        if [[ -f "${INSTALL_DIR}/scripts/install-systemd-user.sh" ]]; then
            bash "${INSTALL_DIR}/scripts/install-systemd-user.sh" 2>/dev/null || true
        fi
    fi

    log ""
    log "✅ ¡Enzo instalado correctamente!"
    log ""
    log "Para iniciar Enzo:"
    log "  cd ${INSTALL_DIR} && pnpm dev"
    log ""
    log "Accede a la interfaz en: http://localhost:5173"
}

main "$@"