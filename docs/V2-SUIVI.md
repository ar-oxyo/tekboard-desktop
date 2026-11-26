# Suivi Experience V2 (temporaire, fondu dans CHANGELOG à la fin)

Branche `feature/tekboard-experience-v2`, worktree `.claude/worktrees/experience-v2` (exclu localement via `.git/info/exclude`), empilée sur `redesign/tekboard-ui`. Plan : `~/.claude/plans/pasted-content-id-391f-missio-humble-thompson-*.md`.

Notes de travail :
- Serena reste attaché au dossier principal (redesign) : lecture seule. Toutes les modifications se font dans le worktree, avec les outils de fichiers.
- Compilation Rust : `CARGO_TARGET_DIR=../../../../src-tauri/target` (cible partagée).
- Captures : `npx vite --port 1420` puis le script Playwright du scratchpad (WebKit `~/.cache/ms-playwright/webkit-2388`, via `executablePath`). Fixtures ajoutées : `?proposal=1` (proposition dans Artix), `?night=1` (horaires 09:00 → 02:00), Skill Tree.
- Les heredocs et le Python en ligne sont refusés par la garde du worktree : écrire les scripts avec Write.
- Commits sans ligne co-auteur (mémoire utilisateur).

## Fait (Lot 1)
- Skill Tree : molette captée, zoom au curseur, trackpad, clavier, « Tout afficher », couloirs sans croisement. Pas de mini-carte.
- Arena : profilage borné et visible, `pump` linéaire, `callgrind_annotate` dans le bac à sable, hypothèses projet et bibliothèques dédoublonnées, générateurs d'Artix testés avant d'être proposés.
- My Week + Artix : conversation par semaine, proposition attachée par un message, remplacement des propositions en attente, demande consommée une fois, carte de proposition compacte, panneau épuré.
- Persona d'Artix : style court, langue, 24 h, disponibilité ≠ obligation.
- Planning : champ 24 h (`components/TimeField.tsx`), journée après minuit (Rust + TS), bandes hors horaires en creux.

- TekLive : adresse ws:// copiée et affichée, port 8765 avec repli, choix du réseau, relais refermé si le démarrage échoue.
- Lot 2 · Crédits : onglet École → Crédits, barème PGE1 2026 (structure de l'xlsx), scénarios (table credit_scenarios).
- Lot 2 · Moulinette TekBoard : `src-tauri/src/mouli/` (plan IA sur sujet + signatures, Criterion contrôlé par tree-sitter, exécution isolée), vue principale de Tests (table mouli_suites). Test de bout en bout réel avec Criterion (/usr/local).

- Lot 2 · Playground : mesures répétées (outil de l'Arena, dans le bac à sable), cache d'objets (complète / incrémentale), make chronométré, comparaison A/B (`bench.rs`, verdict prudent).
- Lot 3 : miniatures de tableaux sur anthracite ; couleur d'accent (`lib/color.ts`) ; icône par ambiance (`scripts/theme-icons.mjs`, `desktop::apply_theme_icon`) ; Aujourd'hui en widgets (`overview/layout.ts`, `WidgetGrid.tsx`).
- Lot 4 : modération (`src/lib/moderation.json`, lue par TS et Rust, vérifiée sur l'hôte TekSpace) ; 24 avatars prédéfinis (`space/avatars.tsx`, profil Connect + TekSpace) ; panneau de table (discussion, réactions, Focus / Musique / Tableau, table favorite, focus et musique affichés sur la carte) ; musique (`music.rs` : MPRIS, OAuth PKCE Spotify, `cargo run --example music_check`).

## Reste
- Lot 5 : Stats, synchro MY, fraîcheur, mini-audit (noté : champ date natif en MM/JJ/AAAA dans WebKit), fusion locale et version 1.0.0.

## À vérifier dans la vraie appli (pas encore fait)
- Arena sur un programme lent (ligne « Callgrind n=… · X s sur Y s », annulation) : validé en test Rust de bout en bout seulement.
- Résultats Arena (sections Hypothèses / Bibliothèques) : non rendus à l'écran faute de fixture de run.
- Spotify OAuth : impossible de bout en bout sans Client ID (testé : PKCE, analyse des réponses). MPRIS lu en vrai (Firefox) ; Spotify de bureau non lancé ici.

## Blocages
- (aucun)
