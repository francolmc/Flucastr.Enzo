#!/usr/bin/env bash
set -euo pipefail

ENZO_DIR="${HOME}/.enzo"
CONFIG_PATH="${ENZO_DIR}/config.json"

detect_locale() {
    local locale="es-CL"
    local tz="America/Santiago"

    if [[ -f /etc/locale.gen ]] || [[ -f /etc/default/locale ]]; then
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

setup_config_ollama() {
    local model=$1
    local detected=$(detect_locale)
    local locale=$(echo "${detected}" | cut -d'|' -f1)
    local tz=$(echo "${detected}" | cut -d'|' -f2)

    mkdir -p "${ENZO_DIR}"

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

    mkdir -p "${ENZO_DIR}"

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