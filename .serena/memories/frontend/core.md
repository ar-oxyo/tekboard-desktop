# Frontend (`src/`)

- `main.tsx` : point d'entrée ; charge `CaptureApp` seul dans la fenêtre `capture`, sinon `app/App.tsx`.
- `app/App.tsx` : routeur par état (`useUi().page`, pas de router), pages lourdes en `lazy`, onboarding (`features/onboarding`) tant que `settings.onboarded` est faux. `app/sections.ts` : navigation en sections (today, projects, planning, school, stats, lab, connect, resources, settings) → pages. `app/Sidebar.tsx`.
- `lib/api.ts` : TOUS les appels backend (`api.<méthode>`) + types miroirs du Rust ; son `invoke` appelle `afterCommand` → invalidation automatique.
- `lib/sync.ts` : bus de données. `COMMAND_DOMAINS` (commande → domaines), `DOMAIN_KEYS` (domaine → préfixes de clés Query), écoute `data-changed` du backend.
- `lib/hooks.ts` : `keys` + hooks Query partagés (`useSettings`, `useRepos`, `useBoard`, `usePref`, `useProjectActions`…). `lib/store.ts` : état UI zustand (`useUi` : page, toasts, demandes de lancement), type `Page`/`PAGES`.
- `lib/*.ts` purs et testés : `plan` (créneaux/charge), `brain`, `boards`, `skilltree`, `charts`, `arena`, `playground`, `connect`, `share`, `repos`, `jobs`, `ai`, `format`, `i18n`, `sessionBus` (messages Connect `space.*`/`board.*` vers les features).
- `features/` : une page ou un panneau par dossier (overview, projects + fiche `ProjectSheet`, planning, myepitech, testing, library, git, analytics, subjects, templates, prompts, settings, artix = panneau assistant, brain = Brain Dump, playground, arena, whiteboard, connect, space = TekSpace pixel art en TS pur, palette, launcher, tools, cozy, skilltree, onboarding).
- Conventions UI, i18n, thèmes : `mem:conventions`.
