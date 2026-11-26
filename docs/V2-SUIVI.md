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

## Reste
- Lot 2 : Playground (mesures précises, compilation incrémentale, mode comparaison A/B).
- Lot 3 : widgets (corriger au passage le bouton imbriqué dans un bouton de « Premiers pas », Dashboard.tsx), accent, icône, Whiteboard.
- Lot 4 : TekSpace, Spotify (MPRIS + OAuth), avatars, modération.
- Lot 5 : Stats, synchro MY, fraîcheur, mini-audit (noté : champ date natif en MM/JJ/AAAA dans WebKit), fusion locale et version 1.0.0.

## À vérifier dans la vraie appli (pas encore fait)
- Arena sur un programme lent (ligne « Callgrind n=… · X s sur Y s », annulation) : validé en test Rust de bout en bout seulement.
- Résultats Arena (sections Hypothèses / Bibliothèques) : non rendus à l'écran faute de fixture de run.

## Blocages
- (aucun)
