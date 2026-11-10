#!/usr/bin/env bash
# Builds TekBoard from this clone and installs the .deb.
# Nothing is installed without asking: system packages and the final install use sudo and are confirmed first.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ask() { read -r -p "$1 [y/N] " a; [[ "$a" == [yY]* ]]; }

if ! command -v apt-get >/dev/null; then
    echo "This script targets Ubuntu/Debian (apt). On another system, see README.md > Develop."
    exit 1
fi

say "1/4 System packages"
PKGS=(build-essential curl file pkg-config libssl-dev libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev git)
MISSING=()
for p in "${PKGS[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || MISSING+=("$p"); done
if ((${#MISSING[@]})); then
    echo "Missing: ${MISSING[*]}"
    ask "Install them with sudo apt install?" || { echo "Stopped. Install them yourself, then run this script again."; exit 1; }
    sudo apt-get install -y "${MISSING[@]}"
else
    echo "All present."
fi

say "2/4 Node.js and Rust"
if ! command -v npm >/dev/null; then
    echo "Node.js (with npm) is required: https://nodejs.org or 'sudo apt install nodejs npm' (version 20 or later)."
    exit 1
fi
export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v cargo >/dev/null; then
    echo "Rust is not installed. The official installer (https://rustup.rs) puts it in your home folder, without sudo."
    ask "Download and run rustup now?" || { echo "Stopped. Install Rust, then run this script again."; exit 1; }
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/rustup-init.sh
    sh /tmp/rustup-init.sh -y --no-modify-path
    rm -f /tmp/rustup-init.sh
fi
echo "node $(node --version), $(cargo --version)"

say "3/4 Build (a few minutes the first time)"
npm ci
./scripts/tauri.sh build --bundles deb
DEB=$(ls -t src-tauri/target/release/bundle/deb/TekBoard_*_amd64.deb | head -1)
echo "Built: $DEB"

say "4/4 Install"
if ask "Install $DEB with sudo apt install?"; then
    sudo apt-get install -y "./$DEB"
    echo "Done. Start TekBoard from the applications menu, or run: tekboard"
else
    echo "Not installed. Later: sudo apt install ./$DEB"
fi

cat <<'NOTE'

Optional tools TekBoard uses when present (none is required to start):
  gh            GitHub repository list            sudo apt install gh && gh auth login
  epiclang, banana-check-repo                     Epitech's compiler and coding-style checker
  valgrind, docker, pdftotext (poppler-utils)     memory check, container TestRepo, subject reading
  claude        Claude Code, for test and README generation
NOTE
