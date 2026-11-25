# TekBoard desktop — carte du projet

Appli de bureau Linux local-first pour étudiants Epitech (dépôts, rendus, planning, logtime, MY Epitech, assistant IA « Artix », Labo, Connect). Tauri 2 : backend Rust `src-tauri/`, UI React/TS `src/`.

## Arborescence
- `src-tauri/src/` : backend (≈60 modules plats + sous-dossiers `ai/`, `arena/`, `connect/`, `doctor/`, `teklive/`). Détails : `mem:backend/core`.
- `src/` : UI. `app/` (App, Sidebar, sections), `features/<domaine>/` (une page par dossier), `lib/` (api, sync, hooks, store, logique pure testée), `components/` (primitives UI partagées), `locales/en.ts`, `styles/index.css` (thèmes). Détails : `mem:frontend/core`.
- `src-tauri/builtin/` : modèles de projet fournis (`c-minimal`, `csfml`). `src-tauri/examples/` : vérifs bout-en-bout lancées à la main (`cargo run --example …`), hors CI.
- `scripts/` : `tauri.sh` (wrapper cargo/tauri), `release.mjs` (contrôle de versions/changelog), `install.sh` + `tests/install_test.sh`. `install.sh` racine = installateur public (curl | bash).
- `.github/workflows/` : `ci.yml` (push main/PR), `release.yml` (tag `vX.Y.Z` → release brouillon signée .deb + AppImage).
- Docs : `docs/ARCHITECTURE.md` = référence détaillée par version (modules, frontière de confiance, MY Epitech, IA/bac à sable, Connect, tableaux blancs, Brain Dump). La lire par section (`grep -n '^## '`) plutôt qu'en entier. `PRODUCT.md` (public, contexte, positionnement, principes produit et marque), `DESIGN.md` (système visuel Riso, jetons, composants ; + `.impeccable/design.json`), `CLAUDE.md` (règles de travail et d'outils), `README.md` (FR, utilisateur), `CHANGELOG.md` (une section par version, exigée par la release).

## Invariants transverses
- Règles de sécurité/confiance non négociables : `mem:invariants/safety`.
- Ajouter une fonctionnalité de bout en bout (commande Rust → api.ts → invalidation) : `mem:conventions`.
- Stack et versions : `mem:tech_stack`. Commandes : `mem:suggested_commands`. Fin de tâche : `mem:task_completion`.
- Version unique dans 3 fichiers : `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (`npm run release:check`).
- Dépôt GitHub privé `ar-oxyo/tekboard-desktop`. Ne jamais confondre avec l'ancien `ar-oxyo/TekBoard` (projet sans rapport).
