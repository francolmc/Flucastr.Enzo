#!/usr/bin/env bash
set -euo pipefail

OS_TYPE=""
OS_VERSION=""
ARCH=""

detect() {
    case "$(uname -s)" in
        Linux*)
            OS_TYPE="linux"
            if [[ -f /etc/os-release ]]; then
                . /etc/os-release
                OS_VERSION="${ID}${VERSION_ID:-}"
            elif [[ -f /etc/debian_version ]]; then
                OS_VERSION="debian"
            elif [[ -f /etc/redhat-release ]]; then
                OS_VERSION="rhel"
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
        x86_64)
            ARCH="x64"
            ;;
        arm64|aarch64)
            ARCH="arm64"
            ;;
        *)
            ARCH="unknown"
            ;;
    esac

    if [[ "${OS_TYPE}" == "unsupported" ]]; then
        echo "✗ Sistema operativo no soportado: $(uname -s)"
        echo "  Soportados: macOS 13+, Ubuntu 22.04+, Debian 11+"
        exit 1
    fi

    if [[ "${OS_TYPE}" == "macos" ]]; then
        local major
        major=$(echo "${OS_VERSION}" | cut -d. -f1)
        if [[ "${major}" -lt 13 ]]; then
            echo "✗ macOS 13+ requerido. Version actual: ${OS_VERSION}"
            exit 1
        fi
    fi

    if [[ "${OS_TYPE}" == "linux" ]]; then
        case "${OS_VERSION}" in
            ubuntu*|debian*)
                local ver
                ver=$(echo "${OS_VERSION}" | tr -d '[:alpha:]')
                if [[ -n "${ver}" ]] && [[ "${ver}" -lt 2204 ]] && [[ "${OS_VERSION}" == ubuntu* ]]; then
                    echo "✗ Ubuntu 22.04+ requerido. Version actual: ${OS_VERSION}"
                    exit 1
                fi
                ;;
        esac
    fi
}

is_macos() {
    [[ "${OS_TYPE}" == "macos" ]]
}

is_linux() {
    [[ "${OS_TYPE}" == "linux" ]]
}

get_os() {
    echo "${OS_TYPE}"
}