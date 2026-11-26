# Suivi : mise à jour « Productivité & mode allégé » (branche `feature/productivity-hub-update`)

Worktree : `.claude/worktrees/productivity-hub` (base `main` dabfdc0). Pas de merge ni de push.
Vérifier un écran : `npx vite --port 1431` + Playwright WebKit (`executablePath` webkit-2388), `?dev=1&lite=1`.
Chaînes anglaises manquantes : `node scripts/missing-en.mjs`.

## Décisions de conception
- Code Time Machine n'existe que dans `stash@{0}` (module `src-tauri/src/timemachine/`, jamais commité) : aucune trace dans le code, la doc ou les mémoires. Le stash n'est pas supprimé sans accord.
- Collaboration : pas de serveur central. Connect = P2P LAN (mTLS, empreintes épinglées). Projet HUB et invitations réutilisent Connect, l'appareil du propriétaire fait autorité (permissions vérifiées côté hôte).
- Spotify : un lien Jam ne contient pas le morceau. Morceau en cours lu localement chez l'hôte (MPRIS, `music.rs` existe déjà : `api.musicNow`).
- Mise à l'échelle : zoom natif de la webview (`look.rs`, `app_set_zoom`), appliqué avant d'afficher la fenêtre.
- Mode allégé : pref `lite` (`useLitePref`), `html[data-lite]` posé avant le 1er rendu par `public/boot.js`.
- Mode développeur : pref `devMode`, 7 appuis sur la version (À propos). Pages `dev: true` dans `app/sections.ts` (Cozy Fox).
- Projets : `deadlines::project_state_in` / `due(…, closes)` : école close à la date finale, perso en retard 14 j puis passé.
- Tableau blanc : contrat JSON `board_contract.rs` (Rust valide + répare 2 fois), dessin `lib/boardSpec.ts`.

## Lots
- [x] Lot 1 : mode développeur, réglages réorganisés, échelle, logo adaptatif, Code Time Machine (rien dans le code)
- [x] Lot 2 : comptes Student/AER + fusion des agendas (`myaer.rs`, `plan.sources`), statut des projets, réglages du planning, planification groupée, contrat Artix ↔ Whiteboard
- [x] Lot 3 : Projet HUB (`hub.rs`, `commands_hub.rs`, `features/hub/`, partage `hub.*` par Connect) — reste : chaînes anglaises (en cours)
- [ ] Lot 4 : TekSpace (invitations, Jam, « En pause »)
- [ ] Lot 5 : mode allégé
- [ ] Lot 6 : animations, README, captures, documentation (ARCHITECTURE : tableaux sans Mermaid, look, devmode, planning groupé)

## Bloqué / à confirmer
- Suppression de `stash@{0}` (Code Time Machine).
- Compte AER : pas de compte de test, vérifié avec des données de démonstration seulement.
