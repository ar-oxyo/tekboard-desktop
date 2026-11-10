#!/usr/bin/env bash
# Runs the Tauri CLI (or cargo) with a rustup toolchain that is not necessarily in PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d "$HOME/.cargo/bin" ] && export PATH="$HOME/.cargo/bin:$PATH"
if [ "${1:-}" = "cargo" ]; then
  shift
  cd src-tauri
  exec cargo "$@"
fi
exec npx tauri "$@"
