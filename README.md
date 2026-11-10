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
- **Package for AI** — a zip (source only, full project, or a context pack with `PROJECT_CONTEXT.md`, `FILE_TREE.txt`, `manifest.json`). Secret-looking files, by name or by content, never go in. Nothing is sent anywhere.
- **Generate README** — a draft built from facts in the repository (TODO comments where a fact is missing), optionally enriched by Claude Code, editable, diffed against the current file, written only on validation.

Command line: `tekboard --page testing --repo <path> --run banana|tests|testrepo|testrepo-remote|moulinette`, `--tool package|readme`, `--pick <files>` (Library), `--report <id>`.

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
