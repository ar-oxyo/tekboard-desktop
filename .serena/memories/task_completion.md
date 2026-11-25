# Fin de tâche

Reproduire ce que fait la CI (`.github/workflows/ci.yml`), selon ce qui a été touché :
1. Front modifié : `npm run typecheck` puis `npm test` (et `npm run build` si imports/chunks/vite.config changent).
2. Rust modifié : `npm run test:rust` (inclut la compilation). La CI exige une identité git globale pour les tests git.
3. Version, CHANGELOG ou packaging touchés : `npm run release:check`.
4. Installateur touché : shellcheck + `scripts/tests/install_test.sh`.
5. Nouvelle chaîne d'interface : entrée anglaise ajoutée dans `src/locales/en.ts`.
6. Schéma SQLite modifié : nouvelle migration ajoutée en fin de `db::MIGRATIONS` (jamais éditer une migration existante) + test de migration.
7. Comportement d'architecture nouveau : section correspondante de `docs/ARCHITECTURE.md` et entrée `CHANGELOG.md` mises à jour.

Test réputé instable sous charge : `toolenv::a_real_shell…` (relancer seul avant de conclure).
Ne pas commiter/pousser sans demande explicite ; tout push et toute release demandent l'accord de l'utilisateur.
