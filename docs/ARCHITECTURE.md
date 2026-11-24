# Architecture

## Stack

- **Tauri 2** shell, **Rust** backend, **React + TypeScript** UI (Vite, Tailwind 4).
- **SQLite** (`rusqlite`, bundled) for preferences and per-repository metadata.
- **git CLI** for every git operation, **gh CLI** for GitHub. No libgit2, no HTTP client, no token handling.

Why Tauri rather than Electron: ~70 MB of RAM instead of ~250, a few-MB package,
and a backend whose surface is an explicit list of commands. The cost is WebKitGTK:
blur is expensive there, so glass is limited to overlays and can be switched off.

## Backend modules (`src-tauri/src/`)

| Module | Responsibility | I/O |
| --- | --- | --- |
| `epitech` | Parse repository names (`G-CPE-110-LYN-1-1-name-27`) and remote URLs | none |
| `git` | Run git with an argument array; parse `status --porcelain=v2` | git |
| `scanner` | Find repositories under the roots, read their state in parallel | read-only |
| `github` | `gh auth status`, `gh api user/repos` | gh, network |
| `launcher` | Rank remote repositories; clone into a folder | git, network |
| `templates` | Library, `{{VAR}}` rendering, dry-run plan, apply with backups | app data + project |
| `analytics` | Aggregates `git log` (per day, hour, project, author) and counts lines by language | read-only |
| `cozy` | Cozy Fox: `companion` block of widgets.json (with backups) and whitelisted one-shot commands | two files |
| `subjects` | PDF library: name matching, SHA-256 duplicates, copy on import | app data |
| `workspace` | Start the IDE / terminal / file manager, run the build command; no shell | spawn |
| `doctor` | Presence and version of the tools | read-only |
| `settings`, `db` | Preferences, favorites, activity log | SQLite |
| `commands` | The only functions the UI can call; validates every path | — |

Everything except `commands` and `lib` is free of Tauri types and unit-tested on
temporary directories.

## Trust boundary

The webview has two permissions: Tauri core and the native *open folder* dialog.
It has no shell, filesystem or HTTP capability. Each command resolves the paths
it receives and refuses anything outside the configured projects folders (or the
template library). User-configured commands (IDE, terminal) are split on
whitespace and executed directly, with the project path as a single argument.

## Launcher confidence score

`launcher::rank` scores each remote repository that is not cloned locally:

| Signal | Points |
| --- | --- |
| Name follows the Epitech pattern | +35 (+5 if the city matches local repositories) |
| Owner already hosts local school repositories | +25 |
| Created ≤ 3 days / ≤ 14 days / ≤ 30 days ago / older | +25 / +15 / +5 / −15 |
| Not cloned yet | +10 |
| Archived / fork | −40 / −10 |

≥ 70 is shown as *likely*, 40–69 as *possible*, below as *uncertain*. The reasons
are always displayed: the score orders candidates, it does not decide for you.
School organisations are learnt from the local clones, never hard-coded.

## Template application

1. `plan` renders every file in memory and classifies it: `add`, `identical`,
   `conflict`, `blocked`. It writes nothing.
2. `apply` writes the selected entries. `add` uses `create_new` (a file that
   appeared in between is left alone). `conflict` is written only when explicitly
   listed, after copying the previous version to the backups folder.
3. Rendered paths must stay inside the project (no `..`, no absolute path, no
   `.git`, no symlinked parent leading outside).

## Developer workspace modules

| Module | Role |
| --- | --- |
| `cparse.rs` | tree-sitter C parsing: functions, prototypes, references, types. Syntax only: macros are not expanded. |
| `library.rs` | Source libraries, catalog, dependency closure and cycles, install/update/remove plan and apply, header filtering, minimal Makefile edits, drop-zone import. Install records live in SQLite (`lib_installs`), never in the project. |
| `jobs.rs` | Long tasks on their own thread: steps, streamed log, cancel (whole process group), time limits, one job per (kind, repository). Finished jobs are stored in `runs`. |
| `testing.rs` | Test detection (Makefile rules, CTest, scripts) and Criterion/CTest/gcovr output parsing. |
| `testrepo.rs` | Clean-clone test: snapshot or remote, local-only file detection, optional `docker run --network none`. Environments live in the app cache folder. |
| `checker.rs` | Banana: `banana-check-repo` and epiclang's plugin. |
| `claude.rs` | Headless Claude Code with an explicit tool list (never `Bash`), deny rules for secrets, write access scoped to given folders. |
| `moulinette.rs` | Pre-check report (measured / AI opinion / not checked) and test generation. |
| `packager.rs` | Zip export with default exclusions and secret detection by name and content. |
| `readme.rs` | Factual README draft; writing requires the hash of the README that was shown. |

Commands are split in `commands.rs` (core), `commands_lib.rs` (library) and `commands_dev.rs` (jobs, checks, packaging, README). Configured commands are split on whitespace and run without a shell; shell syntax is refused (`jobs::argv_of`).

SQLite migration v3 adds `libraries`, `lib_meta`, `lib_presets`, `lib_installs` and `runs`.

## MY Epitech

Read from the public front-end code and unauthenticated probes only:

- `my.epitech.eu` is a single-page app; its API is `https://my.epitech.eu/api` (NestJS-style JSON errors, `401 You are not authenticated`).
- Sign-in uses MSAL in the browser (Azure AD tenant of Epitech), then `POST /api/auth/token` exchanges the Microsoft token for an access/refresh pair kept in `localStorage`; requests carry `Authorization: Bearer …`, renewed through `POST /api/auth/refresh`.
- Personal API tokens exist (`/api/auth/api_token`) but the site's own text says creating one is reserved to administrators. A per-user calendar token exists (`/api/calendar_token`).
- Student data sits behind routes such as `/dashboard/overview`, `/dashboard/activities/upcoming`, `/units/…`, `/events/…`, `/students/:login`, `/test-results/:id`. Their response shapes are unknown without a signed-in session.
- The legacy intranet still answers `?format=json` with a 403 that points at Office 365 sign-in.

`myepitech.rs` / `commands_my.rs`: a second window (`my-epitech`) loads the real site with its own `data_directory` (`<data>/my-session`). It gets **no** Tauri capability, so the remote page cannot call any command. An initialization script finds the site's access token in its `localStorage` and hands it over through `document.title` (`on_document_title_changed`); the token stays in memory. `my_sync` then does GET requests from Rust (`ureq`) on the routes listed in `myepitech::ROUTES`, 500 ms apart, and stores raw bodies in `my_cache` plus a line in `my_sync_log`. The calendar-token route is excluded because its answer is a credential. Response shapes are not interpreted yet.

## Added in 0.3

| Module | Role |
|---|---|
| `deadlines.rs` | One model for hand-in dates: local day, exact instant when known, state (`upcoming`, `today`, `overdue`, `unknown`). Dates are typed or reported, never derived. |
| `projects.rs` | Ties repositories to the MY Epitech cache: link, classification (`epitech` / `personal` and why), progress, automatic report of MY Epitech dates (typed dates win), the dashboard's deadline board. |
| `toolenv.rs` | Program lookup that does not depend on the desktop session's `PATH`: Settings override, process `PATH`, per-user folders, login shell `PATH` (asked once, bounded in time). Children get the completed `PATH`; the process environment is never modified. |
| `runner.rs` | Binary detection (Makefile `NAME`, executable at the root) and launch in a terminal through a fixed wrapper script: program and arguments are positional parameters, never pasted into a command line. |
| `prompts.rs` | Prompt templates with declared variables, single-pass substitution, validation, presets stored in the database (`prompts` table, active one in `settings`). |
| `mydata.rs` | Typed views over `my_cache` for the Agenda and Academic analytics; each lists what could not be read. |

Database migration v5 adds `status`, `deadline_at`, `deadline_source`, `kind_override`, `my_project_id`, `run_bin`, `run_args` to `repo_meta`, and the `prompts` and `cmd_history` tables. `archived` is kept in sync with `status = done`.

**Commands typed by the user** (quick command bar, binary arguments) go through `jobs::split_command`: quotes group words, and anything only a shell understands (`|`, `&&`, `;`, redirections, `$VAR`, backticks) is refused unless quoted. They are reachable only through IPC from the main window, on an explicit action; no deep link and no synced or repository content can feed them.

**MY Epitech background work** (`commands_my::start_background`): optional hidden reopening of the stored session at startup, and a sync every N minutes while a valid token is in memory. A failed sync is logged and not retried before the next interval; a refused session stops it and is reported.

## Added in 0.5 — the assistant (Tika, renamed Artix)

| Module | Role |
|---|---|
| `ai/runner.rs` | The one way Claude Code runs: `--restricted` (no user/project settings, hooks or plugins), `--strict-mcp-config`, `--permission-mode dontAsk --permission-prompts none`, `--output-format stream-json`. Built-in tools are Read/Glob/Grep, plus Edit limited to given globs; Bash is never given. |
| `ai/stream.rs` | Reads stream-json (init, text deltas, tool calls and results, final result) into job activity entries. |
| `ai/sandbox.rs` | Agent commands run in bubblewrap: read-only system, tmpfs home (only PATH folders under home bound read-only), working copy writable, no network, own PID/IPC/UTS namespaces, user runtime folder / D-Bus / Docker socket hidden, CPU and file-size limits, wall-clock kill. No unsandboxed fallback. (Claude Code's own sandbox fails on Ubuntu 24.04's AppArmor user-namespace restriction, hence this.) |
| `ai/ipc.rs`, `ai/mcp.rs` | `tekboard mcp --socket …` is the MCP server Claude Code starts; it relays `tools/list` / `tools/call` over a 0600 Unix socket to the running app with a per-run token, revoked when the run ends. |
| `ai/tools.rs` | Tool registry with a risk level each: read, reversible (journaled in `ai_actions` with its undo), approval (a proposal in `ai_proposals`). `propose_schedule` is checked by `schedule.rs` and returned to Tika when it breaks the rhythm. |
| `ai/agent_tools.rs` | `exec` (sandboxed command in the job's working copy) and the moulinette's reporting tools (`phase`, `plan_check`, `check_result`, `finish_report`). |
| `ai/memory.rs` | Durable memory with FTS5 search, near-duplicate detection, secret refusal, expiry of next steps, archiving of finished projects, bounded context lines. |
| `ai/chat.rs` | Conversations: Claude Code session continued with `--session-id`/`--resume`; each turn starts with a small context card (screen, day, hand-ins, session, memories, user decisions since the last turn). |
| `ai/insights.rs` | Rule-based suggestions with stable keys, withdrawn when their cause disappears. |
| `ai/workcopy.rs`, `ai/agents.rs` | Working copy of a project (work in progress included, ignored files and secrets excluded); Tika's moulinette and test generation; generated files come back as a diff applied with backups. |
| `ai/subject.rs` | Subject digest via `--json-schema`, once per subject version. |
| `schedule.rs` | Planning engine: rhythm, busy time, free slots with breaks, day load, plan validation, automatic planning and reorganisation. |
| `focus.rs` | Work sessions kept by the backend with a 30 s clock (planned end, grace, sleep detection, 4 h ceiling, close at last seen on start-up). |
| `notify.rs` | `data-changed` (domains) and `job-progress` events; the window maps domains to queries in `src/lib/sync.ts`. |

Migrations v7 (assistant tables, FTS5) and v8 (`focus_sessions`, `plan_events.dedupe_key`, `work_log.event_id`) are additive.

## Added after 0.5

| Piece | Role |
|---|---|
| `commands_my::my_sync_auto` | The one **Sync** button: token in memory, else the stored session reopened hidden (12 s), else the MY Epitech window shown for sign-in (5 min); syncs as soon as a token arrives, retries once after a refused token. The window is closed only if this sync opened it; a hidden window found at the start is hidden again. Progress goes out as `my-sync-progress`. Artix's `sync_my_epitech` uses the same flow. |
| `subjects::associate` | Subject ↔ repository links: by MY Epitech project id first (also when the repository moves), else one repository with the exact same name (module agreeing when the file name carries one); anything less certain is a suggestion the user accepts or refuses (`subject_rejects`). A link set by hand (`link_source = manual`) is never changed; links made before this version are kept. |
| `projects::mark_duplicates` | Copies of a project (same remote, or same name and last commit): the folder named like its remote, else the oldest, is kept; the others carry `duplicate_of`. MY Epitech matching prefers the original. |
| `repo_meta.visibility` | `hidden` (out of every list, of planning, of Artix and of MY Epitech matching) or `archived` (out of everyday lists). Folders are never touched. `settings.epitech_only` (default on) drops personal projects from `load_repos`; the window applies the same rule in `useRepos`. |
| `logtime.rs` | Weekly log time (Monday → Sunday, local) from `/students/logtime`, against 30 h. Missing days after the last one reported are said, never counted as zero. |
| `planner` categories | `plan_categories`: the five kinds are base categories (renamed, recoloured, never deleted); user categories colour and label entries, `plan_events.category`. `plan_projects.calendar_hidden` stops drawing a project's school items (free time still counts them). |
| `propose_breakdown` | A breakdown is a proposal of tasks only. The card offers *Accept* (tasks) or *Accept and plan* (tasks, then `suggest_plan` for that project, itself a proposal). |
| `src/lib/i18n.ts` | French text is the key, `src/locales/en.ts` its English (seeded from the v0.4 English interface). The language lives in the settings; changing it reloads the window. Artix answers in the interface language. |

Migration v9 is additive (`visibility`, `calendar_hidden`, `plan_categories`, `plan_events.category`, `subjects.my_project_id / link_source / main`, `subject_rejects`).

## Roadmap

1. ~~Foundations, Project Launcher, Templates~~
2. ~~Project sheets (notes, deadlines, build), subjects library~~
3. ~~Git actions (no destructive operation), analytics from local `git log`, Cozy Fox panel~~
4. Integrated terminal (xterm.js + PTY), calendar import, Epitech connector (manual first)
5. Automations, command library, notes search, AppImage, release pipeline

## Distribution, updates and data (0.6)

- **Packages**: `.deb` (Ubuntu/Debian, recommended) and AppImage, both signed with the updater key. `.github/workflows/release.yml` runs on a `vX.Y.Z` tag: checks versions and changelog (`scripts/release.mjs check`), tests, builds on Ubuntu 22.04, writes `latest.json` (one entry per format: `linux-x86_64-deb`, `linux-x86_64-appimage`), `SHA256SUMS`, a provenance attestation, and creates a **draft** release.
- **Updates** (`updates.rs`, `tauri-plugin-updater`): the endpoint is `releases/latest/download/latest.json`, so only a published release is seen. The format comes from the bundle type patched into the binary: AppImage → replaced in place; .deb → `dpkg -i` through pkexec (or zenity/kdialog), else the verified .deb is saved to Downloads; built by hand → check only. `TEKBOARD_UPDATE_URL` points the check at a test server; the signature is still verified against the built-in key.
- **Data** (`datamgmt.rs`, Settings → Données): backup = zip of `manifest.json`, a `VACUUM INTO` snapshot, `templates/`, `subjects/`, `libraries/` (never `my-session/` nor the cache). Restore checks the manifest (newer schema refused), extracts with `enclosed_name`, runs `integrity_check`, migrates, moves library paths to this computer, saves the current data to `backups/before-import-*.zip`, then swaps the shared connection. Full reset erases only inside the data and cache folders (checked by name) and keeps any projects folder inside them.
- **Start** (`lib.rs::start`): an unreadable database is renamed `tekboard.db.corrupt-<date>`; a database from a newer version is left alone and the user told; damaged settings keep the fields that still read (`settings::repair`); an unwritable data folder shows a native dialog. Data and cache folders are `0700`.
- **First run**: `index.html` draws the launch screen before any script, removed when settings are read (`lib/splash.ts`). `features/onboarding/OnboardingFlow.tsx` replaces the app while `onboarded` is false; the step is saved in `settings.onboardingStep`.
