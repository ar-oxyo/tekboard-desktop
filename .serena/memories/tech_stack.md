# Stack technique

- Tauri 2 (plugins : dialog, updater, single-instance, global shortcut, tray). Rust edition 2021, toolchain rustup dans `~/.cargo/bin` (PAS dans le PATH → passer par `scripts/tauri.sh`).
- Backend : `rusqlite` (bundled, FTS5), `ureq` (HTTP bloquant, MY Epitech/OpenRouter/Ollama), tree-sitter C (`cparse`), `rustls`+`ring`, `rcgen`, `mdns-sd` (Connect). Tests : `#[cfg(test)] mod tests` en ligne dans chaque module + `tempfile`.
- Outils externes appelés en sous-processus, jamais en bibliothèque : `git` CLI (pas de libgit2), `gh` CLI (pas de jeton géré), `claude` (Claude Code headless), `bwrap` (bac à sable), `valgrind`, `banana-check-repo`/epiclang, `docker` (optionnel).
- Front : React 19, TypeScript 7 (`tsc --noEmit`), Vite 8, Tailwind 4 (`@tailwindcss/vite`), TanStack Query 5, zustand 5, Radix (dialog/dropdown/popover/select), cmdk (palette), lucide-react, CodeMirror 6, Excalidraw 0.18 (chargé paresseusement).
- Tests front : vitest 5, environnement `node` par défaut (`src/**/*.test.ts(x)`), happy-dom / testing-library pour les rares tests de composants.
- npm (package-lock), Node 22 en CI. Pas d'ESLint, Prettier, rustfmt.toml ni clippy en CI.
- Paquets : `.deb` (recommandé) et AppImage, signés avec la clé updater.
