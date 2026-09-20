#!/usr/bin/env bash
set -euo pipefail

REPO="Xeven777/share0"
VERSION="${1:-latest}"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

detect_os() {
  local os
  os="$(uname -s)"
  case "$os" in
    Linux*)  echo "linux" ;;
    Darwin*) echo "darwin" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) echo "unsupported"; exit 1 ;;
  esac
}

detect_arch() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) echo "unsupported"; exit 1 ;;
  esac
}

OS="$(detect_os)"
ARCH="$(detect_arch)"

if [ "$OS" = "windows" ]; then
  BINARY="share0-windows-x64.exe"
else
  BINARY="share0-${OS}-${ARCH}"
fi

if [ "$VERSION" = "latest" ]; then
  VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)"
fi

URL="https://github.com/${REPO}/releases/download/${VERSION}/${BINARY}"

echo "Downloading ${BINARY} ${VERSION}..."
mkdir -p "$INSTALL_DIR"
curl -fSL "$URL" -o "${INSTALL_DIR}/share0"
chmod +x "${INSTALL_DIR}/share0"

echo "Installed share0 ${VERSION} to ${INSTALL_DIR}/share0"
share0 --version
