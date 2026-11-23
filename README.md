# TekBoard

> Less friction. More code.

A desktop command center for Epitech students on Linux. Clone and initialise a
school project in two clicks, see the state of every repository at a glance,
keep a library of project templates.

Local-first: no account, no server, no telemetry.

## What works today (v0.1)

| Area | What it does |
| --- | --- |
| **Overview** | Project to resume, repositories that need attention, next repository to start, recent activity |
| **Project Launcher** | Lists GitHub repositories not cloned yet (through `gh`), ranks them with an explained confidence score, clones, previews and applies a template, stages the new files, opens IDE + terminal |
| **Projects** | Every repository under your projects folders: branch, uncommitted changes, ahead/behind, search and filters, favorites |
| **Project sheet** | Per project: deadline (entered by hand), Markdown notes, build command with captured output, "done" flag |
| **Subjects** | Library of PDF subjects: import from Downloads with a suggested project, duplicate detection by content, one-click open |
| **Deadlines** | Upcoming and late projects on the Overview |
| **Git** | Changes, diff, stage/unstage, commit, branches, fetch, pull (fast-forward only), push (confirmed, never forced), history |
| **Analytics** | From local git history: commits per day/month/hour, per project (you vs others), languages, streaks |
| **Cozy Fox** | Settings and commands of the Cozy Glass desktop companion, when it is installed; `widgets.json` is backed up before each change |
| **Templates** | Library of skeletons with `{{VARIABLES}}`, file preview, import any folder, partial application, conflict detection |
| **Command palette** | `Ctrl+K` — navigate, open any workspace, start a project |
| **Settings** | Projects folders, IDE/terminal commands, environment check, five designs (Aurora, Flat, Neon, Cozy, Terminal) |

Not there yet: integrated terminal, Epitech intranet/calendar import, automations,
command library, AppImage. See `docs/ARCHITECTURE.md`.

### Safety rules the app follows

- Pushes only from the Git screen, after a confirmation listing the commits; never forced. Commits only when you press **Commit**.
- Offers no destructive git operation: no reset, no branch deletion, no force push — in the UI or in the backend.
- Never overwrites a file unless you tick it; the previous version is backed up first.
- Never deletes a repository.
- Nothing inside a template is executed.
- The UI cannot run arbitrary commands: it can only call the backend commands listed in `src-tauri/src/commands.rs`.
- No token or password is stored. GitHub access is delegated to `gh`, SSH to your agent.

## Developer workspace (v0.2)

- **Library** — register any folder of `.c`/`.h` files as a source library (several are allowed). TekBoard parses it with tree-sitter, lists every function with its signature, folder, tags and dependencies (`detected`, `assumed` when a function is defined in several files, `declared` by hand), and installs into a project only the files you tick, plus what they need. Headers are generated with the prototypes of installed functions only; an existing Makefile gets the smallest possible edit, shown as a diff. Files you edited in a project are never replaced or deleted without an explicit confirmation, and every replaced file is saved and can be restored. Drop `.c`/`.h` files, folders or archives on the Library screen to add them to a library.
- **Testing** — one screen, one live report, one history:
  - **Unit tests**: runs what the repository declares (`make tests_run`, CTest, a saved command) and reads Criterion/CTest/gcovr output. Repository scripts need an explicit acknowledgement.
  - **TestRepo**: clones the repository into a fresh folder and builds it there. *Remote clone* tests what is published; *Local Git snapshot* tests a local commit. A failed remote clone is never replaced by a local copy. Files your build mentions that exist only on your machine are called out. Optional container run (Docker, no network) with an image you already have.
  - **Banana**: the installed `banana-check-repo` plus epiclang's Banana plugin on every tracked `.c`/`.h`.
  - **Claude Moulinette**: build, structure, Banana, tests, Valgrind, and optionally Claude's reading of the subject. Each line says whether it was measured, is an AI opinion, or was not checked. It is not Epitech's Moulinette and gives no grade.
  - **Generate tests with Claude**: Claude Code runs headless with no shell, read access to the project minus secret-looking files, and write access to `tests/` only. The command and instructions are shown before anything starts.
- **MY Epitech** — you sign in on the real site in a window of its own (Microsoft sign-in and MFA untouched). TekBoard keeps the site's access token in memory only, and on demand reads a fixed list of read-only routes of your own account, half a second apart, into a local cache with a sync history. The raw answers are shown as they are; mapping them to deadlines and projects is not done yet. “Erase session” deletes the stored browser session.
- **Package for AI** — a zip (source only, full project, or a context pack with `PROJECT_CONTEXT.md`, `FILE_TREE.txt`, `manifest.json`). Secret-looking files, by name or by content, never go in. Nothing is sent anywhere.
- **Generate README** — a draft built from facts in the repository (TODO comments where a fact is missing), optionally enriched by Claude Code, editable, diffed against the current file, written only on validation.

Command line: `tekboard --page testing --repo <path> --run banana|tests|testrepo|testrepo-remote|moulinette`, `--tool package|readme`, `--pick <files>` (Library), `--report <id>`.

## Reliability and daily use (v0.3)

- **Deadlines you can trust.** A hand-in date is either typed by you or reported by MY Epitech — never derived. Dates from MY Epitech reach the matching repository by themselves, with their hour; a date you typed is kept and the difference is shown. The dashboard lists what is late, what is coming (projects not cloned yet included) and school projects whose date is unknown.
- **Status: To do / In progress / Done**, changed in one click from any list or sheet, in both directions. Until you choose, the status follows the facts (handed in according to MY Epitech, touched recently).
- **Projects:** sort by smart order, deadline, date added, recent activity, name, status or module; “Epitech only” and module filters. A repository counts as school work because of a MY Epitech match, its remote organisation, a folder you declared, or its name — and you can correct it. Sort and filters are remembered.
- **Open on GitHub** (address built from the real remote, SSH or HTTPS, opened in Firefox) and **Launch Binary** (the program the Makefile names, or the one you set, started in a terminal that stays open and shows the exit code).
- **Quick command bar** in Testing: `make`, `make re`, `make clean`, `make fclean` or your own command, run in the repository without a shell, with live log, exit code, Stop and history. `clear` only empties the log shown.
- **Claude Code is found like your terminal finds it.** A desktop application does not get the `PATH` your shell builds in `~/.zshrc`; TekBoard also looks in per-user install folders and asks your login shell. Settings → Tools shows the executable, its version and state, lets you pick it by hand and run a real test prompt.
- **Prompt manager:** read and personalise every instruction given to Claude Code, with variables, presets, the default at hand and a resolved preview. A prompt is only text: what Claude Code may read or write is fixed per task and it never gets a shell.
- **MY Epitech, connected to the rest:** Agenda (hand-ins, sessions, holidays), Academic analytics (credits, units and learning outcomes, skills, log time, automated tests), modules as filters, launcher that prefers the projects the school lists, optional periodic sync. What the site does not give is reported as unavailable.
- **Interface:** one drop-down component in the five designs (keyboard, search for long lists), secondary actions in menus, foldable sections, Settings in tabs.

## Tika, ton environnement de travail (v0.5)

TekBoard est maintenant organisé autour de **Tika**, une assistante intégrée (panneau à droite, `Ctrl+J`) qui voit tes projets, ton planning, tes sessions, tes tests et sa mémoire, et qui **agit réellement** par des outils contrôlés.

- **Tika** : conversation en français, contexte de l'écran ouvert, actions visibles en direct, cartes « Appliquer / Refuser » pour tout changement important, bouton « Annuler » sur ce qu'elle a fait. Elle ne dit jamais qu'une chose est faite sans qu'un outil l'ait confirmé.
- **Mémoire** : préférences, décisions, difficultés, prochaines étapes et rapports gardés d'une conversation à l'autre (recherche plein texte, jamais de secret), consultables et modifiables (« Ce que je sais »). Chaque message ne reçoit qu'une petite carte de contexte ; le reste est lu à la demande.
- **Suggestions** : rendu proche sans session, projet qui n'avance plus, journée trop chargée, sessions manquées, rendu sans tests, nouveau sujet — calculées sans IA, avec des actions directes, au plus un rappel toutes les 30 minutes.
- **Planning réaliste** : un moteur unique (Rust) garde des pauses avant et après chaque bloc, une pause longue après plusieurs blocs, le déjeuner, du temps libre chaque jour, une marge et un bloc « Tests et rendu » avant chaque rendu, et un plafond quotidien qui compte l'école. Rythmes Tranquille, Équilibré, Intensif ou Sur mesure. Les plans de Tika sont vérifiés par ce moteur avant de t'être montrés. Le calendrier se met à jour seul.
- **Sessions de travail** : gérées par le backend, elles ne restent jamais ouvertes par accident (fermeture à l'heure prévue si personne ne répond, pause pendant la veille, 4 h maximum) ; sessions mixtes (« 25 min projet puis 10 min autre chose »).
- **Moulinette de Tika** : un agent évaluateur lit le sujet et le code, décide de ses tests, compile, teste les arguments et les cas limites, passe valgrind, creuse ce qui casse et rend un rapport par gravité avec commandes de reproduction et corrections. Il travaille sur une copie de ton projet et chaque commande tourne dans **bubblewrap** (pas de réseau, dossier personnel masqué). Tu suis chaque vérification en direct. C'est une simulation, pas la moulinette officielle.
- **Tests générés** : même bac à sable ; Tika écrit, compile et lance des tests Criterion, puis te montre un diff que tu appliques (avec sauvegarde) ou non.
- **Sujets** : lus une fois par version (résumé structuré : exigences, binaire, fonctions autorisées, fonctionnalités estimées, idées de tests), réutilisés partout ; analyse automatique optionnelle après une synchronisation MY Epitech.
- **Navigation** : sept entrées (Aujourd'hui, Projets, Planning, École, Stats, Modèles, Réglages) avec onglets ; palette `Ctrl+K` qui envoie tout texte libre à Tika. Les listes ne sont plus jamais grisées sans explication ; bibliothèques statiques ou dynamiques (`.so`).

Prérequis en plus : `bubblewrap` (`sudo apt install bubblewrap`) pour la moulinette et la génération de tests ; Claude Code installé et connecté. Les modèles, la durée et le budget des agents se règlent dans Réglages → Tika (IA).

## Install

On Ubuntu or Debian, from a clone of this repository:

```sh
git clone git@github.com:ar-oxyo/tekboard-desktop.git
cd tekboard-desktop
./scripts/install.sh
```

The script checks what is missing, asks before each `sudo` step, builds the app and installs the `.deb`. A ready-made `.deb` is also attached to each [release](https://github.com/ar-oxyo/tekboard-desktop/releases): `sudo apt install ./TekBoard_<version>_amd64.deb`.

On first start, TekBoard asks which folders hold your repositories. Nothing personal is stored in this repository: every path and preference lives in your own data folder.

## Requirements

Ubuntu 24.04+ (or any distribution with WebKitGTK 4.1), `git`. Optional: `gh` (GitHub CLI) to list remote repositories.

Build dependencies:

```sh
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
  libayatana-appindicator3-dev libssl-dev pkg-config build-essential
```

plus Node.js 20+ and a Rust toolchain (<https://rustup.rs>).

## Develop

```sh
npm install
npm run app:dev      # desktop app with hot reload
npm test             # frontend unit tests
npm run test:rust    # backend tests
npm run app:build    # .deb and AppImage in src-tauri/target/release/bundle/
```

`tekboard --page <overview|projects|git|subjects|templates|analytics|cozy|settings>`
opens the app on a given screen; `--sheet <repository path>` opens a project sheet.

`scripts/tauri.sh` adds `~/.cargo/bin` to `PATH` when rustup was installed without touching the shell profile.

## Where data lives

| What | Where |
| --- | --- |
| Settings, favorites, activity (SQLite) | `~/.local/share/dev.tekboard.app/tekboard.db` |
| Template library | `~/.local/share/dev.tekboard.app/templates/` |
| Subjects (PDF copies) | `~/.local/share/dev.tekboard.app/subjects/` |
| Backups of replaced files | `~/.local/share/dev.tekboard.app/backups/` |

Uninstalling the app leaves this folder untouched; delete it to reset TekBoard.

## License

Not chosen yet.
