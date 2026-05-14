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
            --check) CHECK_ONLY=true; shift ;;
            --dir) INSTALL_DIR="$2"; shift 2 ;;
            --model) MODEL="$2"; shift 2 ;;
            --provider) PROVIDER="$2"; shift 2 ;;
            --api-key) API_KEY="$2"; shift 2 ;;
            --update) UPDATE_ONLY=true; shift ;;
            --service) INSTALL_SERVICE=true; shift ;;
            --quiet) QUIET_MODE=true; shift ;;
            -h|--help) show_usage; exit 0 ;;
            *) echo "Opcion desconocida: $1"; show_usage; exit 1 ;;
        esac
    done
}

log() { [[ "${QUIET_MODE}" == "true" ]] && return; echo -e "$1"; }
log_step() { log "[$1/$2] $3"; }

has_command() { command -v "$1" >/dev/null 2>&1; }
node_version() { node --version 2>/dev/null | tr -d 'v' || echo "0"; }
pnpm_version() { pnpm --version 2>/dev/null | head -1 || echo "0"; }

detect_os() {
    OS_TYPE=""; OS_VERSION=""; ARCH=""
    case "$(uname -s)" in
        Linux*)
            OS_TYPE="linux"
            if [[ -f /etc/os-release ]]; then . /etc/os-release; OS_VERSION="${ID}${VERSION_ID:-}"; elif [[ -f /etc/debian_version ]]; then OS_VERSION="debian"; else OS_VERSION="unknown"; fi
            ;;
        Darwin*) OS_TYPE="macos"; OS_VERSION=$(sw_vers -productVersion 2>/dev/null || uname -r) ;;
        *) OS_TYPE="unsupported" ;;
    esac
    case "$(uname -m)" in x86_64) ARCH="x64" ;; arm64|aarch64) ARCH="arm64" ;; *) ARCH="unknown" ;; esac

    if [[ "${OS_TYPE}" == "unsupported" ]]; then log "✗ SO no soportado: $(uname -s)"; exit 1; fi
    if [[ "${OS_TYPE}" == "macos" ]]; then
        local major; major=$(echo "${OS_VERSION}" | cut -d. -f1)
        if [[ "${major}" -lt 13 ]]; then log "✗ macOS 13+ requerido. Version actual: ${OS_VERSION}"; exit 1; fi
    fi
}

check_dependencies() {
    log_step 1 6 "Verificando requisitos del sistema..."
    local missing_deps=false

    if ! has_command node; then
        log "✗ Node.js no encontrado."
        missing_deps=true
    else
        local node_ver; node_ver=$(node_version)
        local major; major=$(echo "${node_ver}" | cut -d. -f1)
        if [[ "${major}" -lt 22 ]]; then
            log "✗ Node.js 22+ requerido (tu version: v${node_ver})"
            missing_deps=true
        else
            log "✓ Node.js detectado (v${node_ver})"
        fi
    fi

    if ! has_command pnpm; then
        log "✗ pnpm no encontrado."
        missing_deps=true
    else
        log "✓ pnpm detectado (v$(pnpm_version))"
    fi

    if has_command git; then log "✓ Git detectado"; else log "○ Git no detectado (opcional)"; fi

    if [[ "${missing_deps}" == "true" ]]; then
        log ""
        log "Para instalar Node.js 22:"
        log "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash"
        log "  nvm install 22 && nvm use 22"
        log ""
        log "Luego reinicia este script."
        return 1
    fi
    return 0
}

install_node_if_needed() {
    if has_command node; then return 0; fi
    log ""; log "✗ Node.js no encontrado. Instalando..."

    if has_command brew && [[ "$(uname -s)" == "Darwin" ]]; then
        log "  Usando Homebrew..."; brew install nvm 2>/dev/null || true
        export NVM_DIR="${HOME}/.nvm"
        if [[ -f "${NVM_DIR}/nvm.sh" ]]; then . "${NVM_DIR}/nvm.sh"; nvm install 20 && nvm use 20; fi
    fi

    if ! has_command node; then
        log "  Instalando nvm manualmente..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash > /dev/null 2>&1
        export NVM_DIR="${HOME}/.nvm"
        (source "${NVM_DIR}/nvm.sh" 2>/dev/null || true; nvm install 20 2>/dev/null || true)
    fi

    if has_command node; then log "✓ Node.js $(node_version) instalado"; else log "✗ Error: No se pudo instalar Node.js"; return 1; fi
}

ollama_model_exists() {
    local model=$1
    has_command ollama && ollama list 2>/dev/null | grep -q "^${model}\s"
}

ollama_check_and_install() {
    if has_command ollama; then
        log "✓ Ollama ya instalado"
        return 0
    fi

    log ""
    log "○ Ollama no encontrado."
    log ""
    log "Ollama puede estar en otro equipo o servidor."
    log ""
    printf "Ingresa la URL de Ollama remoto (ej: http://192.168.1.100:11434)"
    printf "\nO presiona Enter para instalar Ollama localmente: "
    read -r OLLAMA_URL

    if [[ -n "${OLLAMA_URL}" ]]; then
        log ""
        log "  Configurando Ollama remoto: ${OLLAMA_URL}"
        export OLLAMA_BASE_URL="${OLLAMA_URL}"
        return 0
    fi

    log ""
    log "  Instalando Ollama..."

    if [[ "$(uname -s)" == "Darwin" ]] && has_command brew; then
        brew install ollama 2>/dev/null || true
    elif [[ "$(uname -s)" == "Linux" ]]; then
        curl -fsSL https://ollama.ai/install.sh | sh
    fi

    if has_command ollama; then
        if [[ "$(uname -s)" == "Darwin" ]] && ! pgrep -x ollama > /dev/null 2>&1; then
            log "  Iniciando Ollama..."; ollama serve > /dev/null 2>&1 & sleep 2
        elif [[ "$(uname -s)" == "Linux" ]]; then
            log "  Iniciando Ollama..."; ollama serve > /dev/null 2>&1 & sleep 2
        fi
        log "✓ Ollama instalado"
    else
        log "✗ Error: No se pudo instalar Ollama"
        return 1
    fi
}

    if ! ollama_model_exists "${MODEL}"; then
        log ""; log "○ Modelo ${MODEL} no encontrado. Descargando..."
        if [[ -t 1 ]]; then echo "  (Esto puede tomar varios minutos segun tu conexion)"; fi
        if ollama run "${MODEL}" "test" > /dev/null 2>&1; then
            log "✓ Modelo ${MODEL} disponible"
        else
            ollama pull "${MODEL}" 2>&1 | while IFS= read -r line; do
                [[ -t 1 ]] && [[ "$line" =~ ([0-9.]+)% ]] && printf "\r  Descargando... %s" "$line" || true
            done
            [[ -t 1 ]] && echo ""
            ollama_model_exists "${MODEL}" && log "✓ Modelo ${MODEL} descargado" || log "✗ Error: No se pudo descargar el modelo"
        fi
    else
        log "✓ Modelo ${MODEL} ya disponible"
    fi
}

clone_repo() {
    log_step 2 6 "Clonando repositorio..."
    [[ -z "${INSTALL_DIR}" ]] && INSTALL_DIR="${HOME}/enzo"

    if [[ -d "${INSTALL_DIR}/.git" ]]; then
        log "✓ Repositorio ya existe en ${INSTALL_DIR}"
        if [[ "${UPDATE_ONLY}" == "true" ]]; then
            log "  Ejecutando git pull..."; cd "${INSTALL_DIR}" && git pull --ff-only origin main 2>/dev/null || git pull origin main
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

    export PNPM_ENABLE_PRE_POST_SCRIPTS=true

    cat >> .npmrc <<'NPMRC'
enable-pre-post-scripts=true
onlyBuiltDependencies[]=esbuild
NPMRC

    if ! grep -q 'onlyBuiltDependencies' package.json 2>/dev/null; then
        log "  Configurando package.json..."
        node -e "
const fs=require('fs');
let d=JSON.parse(fs.readFileSync('package.json','utf8'));
if(typeof d.pnpm === 'string') d.pnpm={onlyBuiltDependencies:['esbuild']};
else if(!d.pnpm) d.pnpm={onlyBuiltDependencies:['esbuild']};
fs.writeFileSync('package.json',JSON.stringify(d,null,2)+'\n');
" 2>/dev/null || true
    fi

    pnpm install 2>&1
    pnpm approve-builds --all 2>&1 || true
    log "✓ Dependencias instaladas"
}

detect_locale() {
    local locale="es-CL" tz="America/Santiago"
    if command -v locale > /dev/null 2>&1; then
        local detected_lang; detected_lang=$(locale 2>/dev/null | grep LANG | cut -d= -f2 | cut -d_ -f1 || echo "")
        [[ -n "${detected_lang}" ]] && locale="${detected_lang}-CL"
    fi
    [[ -f /etc/timezone ]] && tz=$(cat /etc/timezone 2>/dev/null || echo "America/Santiago")
    echo "${locale}|${tz}"
}

configure_enzo() {
    log_step 5 6 "Configurando Enzo..."
    mkdir -p "${ENZO_DIR}"

    if [[ "${PROVIDER}" == "anthropic" ]] && [[ -n "${API_KEY}" ]]; then
        cat > "${CONFIG_PATH}" <<'EOF'
{
  "primaryModel": "claude-haiku-4-5",
  "primaryProvider": "anthropic",
  "fallbackModels": [],
  "providers": { "anthropic": { "name": "Anthropic", "enabled": true, "hasApiKey": true, "apiKeyEncrypted": "PLACEHOLDER" } },
  "system": { "ollamaBaseUrl": "http://localhost:11434", "anthropicModel": "claude-haiku-4-5", "port": "3001", "uiPort": "5173", "dbPath": "ENZO_DB", "enzoWorkspacePath": "ENZO_WS", "enzoSkillsPath": "ENZO_SK", "enzoDebug": false, "enzoSkillsFallbackRelevanceThreshold": 0.12, "mcpAutoConnect": false, "defaultUserLanguage": "es", "tz": "America/Santiago" },
  "assistantProfile": { "name": "Enzo", "persona": "Intelligent personal assistant", "tone": "Friendly, direct and helpful" },
  "userProfile": { "locale": "es-CL", "timezone": "America/Santiago" }
}
EOF
        sed -i.bak "s|PLACEHOLDER|${API_KEY}|g; s|ENZO_DB|${HOME}/.enzo/enzo.db|g; s|ENZO_WS|${HOME}/.enzo/workspace|g; s|ENZO_SK|${HOME}/.enzo/skills|g" "${CONFIG_PATH}" && rm -f "${CONFIG_PATH}.bak"
    else
        local detected=$(detect_locale); local locale=$(echo "${detected}" | cut -d'|' -f1); local tz=$(echo "${detected}" | cut -d'|' -f2)
        cat > "${CONFIG_PATH}" <<EOF
{
  "primaryModel": "${MODEL}",
  "primaryProvider": "ollama",
  "fallbackModels": [],
  "providers": { "ollama": { "name": "Ollama", "enabled": true, "hasApiKey": false } },
  "system": { "ollamaBaseUrl": "http://localhost:11434", "anthropicModel": "claude-haiku-4-5", "port": "3001", "uiPort": "5173", "dbPath": "${HOME}/.enzo/enzo.db", "enzoWorkspacePath": "${HOME}/.enzo/workspace", "enzoSkillsPath": "${HOME}/.enzo/skills", "enzoDebug": false, "enzoSkillsFallbackRelevanceThreshold": 0.12, "mcpAutoConnect": true, "defaultUserLanguage": "es", "tz": "${tz}" },
  "assistantProfile": { "name": "Enzo", "persona": "Intelligent personal assistant", "tone": "Friendly, direct and helpful" },
  "userProfile": { "locale": "${locale}", "timezone": "${tz}" }
}
EOF
    fi

    local mcp_dir="${ENZO_DIR}/mcp-servers"; mkdir -p "${mcp_dir}"
    cat > "${mcp_dir}/filesystem.json" <<EOF
{
  "id": "filesystem", "name": "Filesystem", "description": "Access to local filesystem", "transport": "stdio",
  "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "${HOME}"],
  "enabled": true, "createdAt": $(date +%s), "updatedAt": $(date +%s)
}
EOF
    cat > "${mcp_dir}/duckduckgo.json" <<EOF
{
  "id": "duckduckgo", "name": "DuckDuckGo Search", "description": "Web search via DuckDuckGo", "transport": "stdio",
  "command": "npx", "args": ["-y", "duckduckgo-mcp"],
  "enabled": true, "createdAt": $(date +%s), "updatedAt": $(date +%s)
}
EOF
    log "✓ Configuracion generada en ${CONFIG_PATH}"
}

verify_installation() {
    log_step 6 6 "Verificando instalacion..."
    curl -sf --max-time 3 http://localhost:3001/api/config > /dev/null 2>&1 && log "✓ API responde en http://localhost:3001" || log "○ API no disponible aun"
    ollama_model_exists "${MODEL}" && log "✓ Modelo ${MODEL} disponible" || log "○ Modelo no responde aun"
    log "✓ Verificacion completada"
}

main() {
    parse_args "$@"
    log "🚀 Instalando Enzo..."; log ""

    detect_os

    if [[ "${CHECK_ONLY}" == "true" ]]; then
        log "Modo verificacion - solo checando dependencias"; log ""
        if check_dependencies; then log ""; log "✅ Todos los requisitos estan satisfechos."; exit 0
        else log ""; log "✗ Faltan requisitos."; exit 1; fi
    fi

    if [[ "${UPDATE_ONLY}" == "true" ]]; then
        INSTALL_DIR="${HOME}/enzo"
        if [[ ! -d "${INSTALL_DIR}" ]]; then log "✗ No se encontro instalacion en ${INSTALL_DIR}"; exit 1; fi
        cd "${INSTALL_DIR}"; git pull --ff-only origin main 2>/dev/null || git pull origin main
        pnpm install --frozen-lockfile; pnpm build
        log ""; log "✅ Enzo actualizado."; log ""; log "Para iniciar: cd ${INSTALL_DIR} && pnpm dev"; exit 0
    fi

    check_dependencies || exit 1
    clone_repo
    install_dependencies
    [[ "${PROVIDER}" != "anthropic" ]] || [[ -z "${API_KEY}" ]] && ollama_check_and_install
    configure_enzo
    verify_installation

    if [[ "${INSTALL_SERVICE}" == "true" ]] && [[ -f "${INSTALL_DIR}/scripts/install-systemd-user.sh" ]]; then
        log ""; log "  Instalando servicio del sistema..."; bash "${INSTALL_DIR}/scripts/install-systemd-user.sh" 2>/dev/null || true
    fi

    log ""; log "✅ ¡Enzo instalado correctamente!"; log ""; log "Para iniciar Enzo:"; log "  cd ${INSTALL_DIR} && pnpm dev"; log ""; log "Accede a la interfaz en: http://localhost:5173"
}

main "$@"