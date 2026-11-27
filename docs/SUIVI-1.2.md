# Suivi : mise à jour « Productivité & mode allégé » (branche `feature/productivity-hub-update`)

Worktree : `.claude/worktrees/productivity-hub` (base `main` dabfdc0). Pas de merge ni de push.
Vérifier un écran : `npx vite --port 1431`, puis `?dev=1`, `?lite=1`, `?aer=1`, `?space=demo`.
Chaînes anglaises manquantes : `node scripts/missing-en.mjs`. Détail technique : `docs/ARCHITECTURE.md`, section 1.2.

## Terminé
- [x] Lot 1 : réglages réorganisés, mode développeur (7 appuis), taille d'interface native, logo et fond de démarrage selon l'ambiance, Code Time Machine (rien dans le code).
- [x] Lot 2 : compte AER et agendas fusionnés, rendus clos au lieu de « en retard », réglages du planning regroupés, planification groupée avec annulation, contrat Artix ↔ tableau blanc.
- [x] Lot 3 : Projet HUB (données, organisation, ressources, journal, présentation, équipe par Connect, crédits estimés).
- [x] Lot 4 : Jam Spotify en un clic, statut « En pause », cartes d'invitation.
- [x] Lot 5 : mode allégé (socle et écrans principaux, menus réorganisés).
- [x] Lot 6 : animations ciblées, README et guide, captures sombres, documentation et mémoires.

Validation : `npm run typecheck`, `npm test` (165), `npm run test:rust` (381), `npm run build`, `npm run release:check`, détecteur Impeccable (0 problème).

## À décider / limites connues
- `stash@{0}` (« wip: Code Time Machine », module jamais commité) : à supprimer avec ton accord.
- Compte AER : testé avec des données de démonstration, pas avec un vrai compte AER (routes lues : `/auth/verify` et les séances inscrites).
- Partage Projet HUB et invitations : réseau local seulement (Connect, sans serveur) ; pas de lien court ni de lien profond, faute de domaine public.
- Vérifications visuelles faites dans WebKit avec le faux backend ; l'application Tauri complète n'a pas été lancée dans cette session.
- Mode allégé : écrans principaux traités ; Labo (Arena), Stats et Skill Tree gardent leur présentation (surtout des données).
