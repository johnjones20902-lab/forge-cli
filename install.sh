#!/usr/bin/env bash
# Forge installer — usage:  curl -fsSL https://YOUR-DOMAIN/install | bash
# Or from GitHub: curl -fsSL https://raw.githubusercontent.com/YOUR_USER/forge-cli/main/install.sh | bash
set -euo pipefail

REPO="${FORGE_REPO:-https://github.com/johnjones20902-lab/forge-cli}"
ORANGE='\033[38;5;208m'; GREEN='\033[32m'; RED='\033[31m'; NC='\033[0m'

echo -e "${ORANGE}"
echo "  ╔═╗╔═╗╦═╗╔═╗╔═╗"
echo "  ╠╣ ║ ║╠╦╝║ ╦║╣ "
echo "  ╚  ╚═╝╩╚═╚═╝╚═╝  installer"
echo -e "${NC}"

# 1. Check for Node.js >= 18
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}Node.js is required (v18+). Install it from https://nodejs.org and re-run.${NC}"
  exit 1
fi
NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo -e "${RED}Node.js v18+ required (found v$(node --version)).${NC}"
  exit 1
fi

# 2. Download source
INSTALL_DIR="$HOME/.forge/app"
echo "Installing to $INSTALL_DIR ..."
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

if command -v git >/dev/null 2>&1; then
  git clone --depth 1 "$REPO" "$INSTALL_DIR" >/dev/null 2>&1
else
  curl -fsSL "$REPO/archive/refs/heads/main.tar.gz" | tar -xz -C "$INSTALL_DIR" --strip-components=1
fi

# 3. Install dependencies + link the `forge` command globally
cd "$INSTALL_DIR"
npm install --omit=dev --silent
npm link --silent 2>/dev/null || sudo npm link --silent

echo -e "${GREEN}✔ Forge installed!${NC}"
echo
echo "  Run:  forge"
echo "  (you'll be asked for your Anthropic API key on first launch)"
