# Commandes

Depuis la racine du dépôt :
- `npm run app:dev` : appli avec rechargement à chaud (Vite sur le port 1420 + build Rust debug).
- `npm test` : vitest. `npm run typecheck` : tsc. `npm run build` : tsc + vite build.
- `npm run test:rust` : `cargo test` dans `src-tauri` via `scripts/tauri.sh` (filtre : `npm run test:rust -- <motif>`).
- `./scripts/tauri.sh cargo <args>` : n'importe quelle commande cargo avec le bon PATH (ex. `cargo check`, `cargo run --example doctor_check`).
- `npm run app:build` : build release + bundles. Binaire seul : `./scripts/tauri.sh build --no-bundle`.
- `npm run release:check` : versions concordantes + section CHANGELOG.
- `shellcheck install.sh scripts/install.sh scripts/tests/install_test.sh && scripts/tests/install_test.sh` : si l'installateur change.

Pièges Linux/shell de cette machine :
- `ls` est un alias eza : utiliser `command ls` ou `find` dans les scripts.
- Ne pas imposer `make -j` / builds parallèles agressifs ; préfixer les builds longs par `nice`.
- Binaire release lançable avec liens profonds pour vérifier un écran : `src-tauri/target/release/tekboard --page <page>` (`--sheet <dépôt>`, `--theme <thème>`, `--run <action>`). Données isolées : `XDG_DATA_HOME=<dossier temporaire>`.
- Arrêter une instance de dev : tuer par PID (filtrer `pgrep -x tekboard` via `/proc/PID/exe`), jamais `pkill -x tekboard` (tue l'appli installée).
