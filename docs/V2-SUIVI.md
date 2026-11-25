# Suivi Experience V2 (temporaire, fondu dans CHANGELOG à la fin)

Branche `feature/tekboard-experience-v2`, worktree `.claude/worktrees/experience-v2`, empilée sur `redesign/tekboard-ui`. Plan complet : `~/.claude/plans/pasted-content-id-391f-missio-humble-thompson-*.md`.

Notes de travail :
- Serena reste attaché au dossier principal (redesign) : lecture seule, toutes les modifications se font dans le worktree.
- Compilation Rust : `CARGO_TARGET_DIR=../../../../src-tauri/target` (cible partagée).
- Captures : `npx vite --port 1420` + script Playwright du scratchpad (WebKit `~/.cache/ms-playwright/webkit-2388`).

## Fait
- Lot 1 · Skill Tree : molette captée (listener natif non passif), zoom au curseur, pan trackpad, clavier, « Tout afficher », disposition en couloirs sans croisement, liens projets à la demande. Pas de mini-carte (« Tout afficher » suffit).

## Reste
- Lot 1 : Arena, My Week + Artix, Calendrier, TekLive, persona et UI d'Artix.
- Lot 2 : crédits, moulinette, Criterion, Playground.
- Lot 3 : widgets, accent, icône, Whiteboard.
- Lot 4 : TekSpace, Spotify (MPRIS + OAuth), avatars, modération.
- Lot 5 : Stats, synchro MY, fraîcheur, mini-audit, fusion et 1.0.0.

## Blocages
- (aucun)
