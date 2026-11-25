# Conventions

## Ajouter une commande (chemin complet)
1. Logique dans le module métier Rust (`src-tauri/src/<domaine>.rs`), sans types Tauri, testée sur dossiers temporaires.
2. Wrapper fin dans `commands*.rs` du domaine : `#[tauri::command(async)] pub fn <domaine>_<verbe>(state: State<'_, AppState>, …) -> Result<T>` ; accès DB via `state.conn()` ; horloge via `commands::now()` (secondes Unix).
3. L'enregistrer dans `tauri::generate_handler![…]` de `lib.rs::run`.
4. Front : interface TS (miroir serde, champs camelCase) + méthode dans l'objet `api` de `src/lib/api.ts` (`invoke<T>("nom_snake", { argsCamel })`).
5. Si la commande modifie des données : ajouter `nom: [domaines]` dans `COMMAND_DOMAINS` (`src/lib/sync.ts`) ; si le changement peut venir d'ailleurs (job, autre fenêtre, Artix), appeler aussi `crate::notify::changed(&[domaines])` côté Rust (helper local `changed(r)` dans certains `commands_*.rs`). Nouveau domaine : type `Domain` + `DOMAIN_KEYS`.
6. Lecture côté UI : hook TanStack Query (clés dans `lib/hooks.ts` `keys`), pas d'état serveur dupliqué dans zustand.

## Rust
- Erreurs : `crate::error::{AppError, Result}` ; erreurs métier `AppError::new("code_snake", message)` ; le `code` est sérialisé vers l'UI (`asAppError` côté TS) et sert aux messages.
- Modules plats `src-tauri/src/x.rs` ; sous-dossiers seulement pour gros domaines (`ai/`, `arena/`, `connect/`, `doctor/`, `teklive/`).
- Migrations SQLite : tableau `db::MIGRATIONS` (index = `PRAGMA user_version`), uniquement additives.
- Tâches longues : `jobs.rs` (thread, étapes, journal streamé, annulation par groupe de processus, une tâche par (type, dépôt)), progression émise en `job-progress`.
- Doc-commentaires `///` courts orientés comportement ; noms de tests en phrase (`fn state_follows_the_exact_instant_when_there_is_one`).

## Front
- Une page = `src/features/<domaine>/<Nom>Page.tsx` ; type `Page` + `PAGES` dans `lib/store.ts` ; entrée de navigation dans `app/sections.ts` ; pages lourdes en `lazy()` dans `app/App.tsx`.
- Logique pure extraite dans `src/lib/<x>.ts` (ou `features/<x>/*.ts`) avec `<x>.test.ts` à côté ; les composants restent minces.
- Primitives UI partagées dans `components/ui.tsx` (Button, Card, Dot, Tag, SectionLabel, EmptyState, ErrorNote, PageHeader…), `Modal`, `Menu`, `Select`, `CodeEditor`, `charts/` ; réutiliser avant d'en créer.
- i18n : le texte FRANÇAIS est la clé : `t("Texte en français", { var })` ; anglais dans `src/locales/en.ts` (clé manquante → français affiché). Les termes techniques restent tels quels.
- Thèmes : variables CSS par `:root[data-theme=…]` dans `styles/index.css` ; utiliser les variables, pas de couleurs en dur (sauf palette fixe des graphiques).
- Règles visuelles retenues : pas de pastilles en série, pas de libellés en capitales, un seul bouton d'accent par écran, statuts en point + texte.

## Textes d'interface (voir `PRODUCT.md`)
- Français d'abord, tutoiement, phrases courtes qui disent exactement ce que l'appli fait et ne fait pas.
- Fonction Tests : toujours « test/tester », jamais « vérifier ». Noms de produits inchangés : Artix, Doctor, Labo, Playground, Arena, Brain Dump, Inbox, Connect, TekShare, TekLive, TekSpace, Skill Tree, Banana, moulinette.
- Ne jamais paraître officiel Epitech (logo, couleurs, ton institutionnel) ; jamais de témoignages, chiffres ou partenariats inventés.
- Outil manquant : la fonction est désactivée et l'écran dit pourquoi et comment corriger (Doctor), jamais de blocage.

## Git
- Messages de commit en français, forme « Domaine : ce qui change » (ex. `Brain Dump : capture instantanée, Inbox et recherche`), versions `TekBoard X.Y.Z : …`.
