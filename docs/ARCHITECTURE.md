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

## AI providers, Doctor and Skill Tree (0.7)

**Providers.** Every AI request still goes through `ai::runner::run`, which asks `ai::provider::route` where it goes:
- Claude Code keeps its isolated `claude -p` path.
- OpenRouter and Ollama share `ai::openai`. It is one OpenAI-compatible client: blocking `ureq`, SSE read line by line inside the job.
- The calls run in `ai::toolloop`. It produces the same `stream::Event`s and `runner::Answer` as Claude Code, so callers did not change.
- TekBoard's own tools are reached in-process through `ipc::local`. It uses the same grant and rules as the MCP socket.
- Project reading for those providers is done by `ai::fstools`. It provides `Read`/`Glob`/`Grep`, confined to the project, with the same `DENY_READ` rules and capped output.
- Requests that edit files or run commands (`Tools::ReadEdit`, agent tools) are refused for non-Claude providers with `ai_needs_claude`. `provider::require(feature)` gives the same answer before a job starts.
- OpenRouter: free = prompt, completion and request prices all 0. The model is checked against the model list (cached 6 h) before every request. No `models` fallback list is ever sent, and `allowPaid` is only set by the user after a confirmation.
- API keys live in `secrets.json` (0600), never in the settings blob sent to the window. They are scrubbed from error messages and reports (`secrets::scrub`).
- Settings saved before 0.7 have no provider. `provider::migrate` (at start, detection outside the DB lock) sets Claude Code when it answers, none otherwise.

**Doctor** (`doctor::diagnosis`). One `Check` per dependency, with:
- a status (`ok`, `warn`, `error`, `unconfigured`);
- what it affects;
- a command to type;
- an optional action: `fix:<id>` (backend), `open:<settings tab>` or `my-connect`.

Fixes are limited to:
- folder and key permissions;
- `VACUUM INTO` a backup, then `REINDEX; VACUUM`;
- removing a vanished root, confirmed first, written as is because `settings::save` refuses missing folders.

`doctor::anonymize` masks the following:
- home, user, roots, git identity and GitHub login;
- e-mails, JWTs and API keys;
- lines `packager::secret_in` still flags.

**Skill Tree** (`skilltree`). Built from `my_cache` only, so it works offline:
- branches = `competencyBlocks` (+ `unassignedBlockIds`);
- units = `blocks` and `nextSemesterBlocks`;
- skills = learning outcomes;
- projects = `graph/me` project nodes, joined by `entityId` and linked through the graph's `project_skill` links;
- graph statuses override the ones computed from validation counts.

The unit's domain is the only deduction, from its projects' unit codes, and is flagged `domainEstimated`. Filtering and the radial layout are in `src/lib/skilltree.ts` (pure, tested); drawing is plain SVG with pan/zoom (`features/skilltree`).

**Repository discovery** (`settings::find_repos`):
- A real repository is a `.git` folder with `HEAD`, or a `gitdir:` file. Submodules are skipped (`git::repo_kind`).
- The walk continues two levels inside a repository to find independent ones.
- Links are followed once (canonical-path set).
- `MAX_DEPTH` is 8.

## Lab, Connect and whiteboards (0.8)

**Shared plumbing.**
- `jobs::Job::run_opts` runs a command with stdin from a file, separate stdout/stderr and an adaptive poll (durations are not rounded to the poll period). `run`/`run_lines` are thin wrappers.
- `ai::sandbox::wrap_argv(work, argv, envs, Limits)` builds a bubblewrap command line: no network, read-only system, `--clearenv`, work dir as the only writable bind. Memory and process limits use a `systemd-run --user --scope` cgroup (`MemoryMax`, `TasksMax`) when available, `ulimit` otherwise. There is never an unsandboxed fallback.
- `cdiag` parses gcc/clang/linker diagnostics and ASan/LSan/UBSan/Valgrind reports into `Diagnostic` / `MemIssue` (file, line, stack frames in the user's code).
- `components/CodeEditor.tsx` is the shared CodeMirror 6 editor (C grammar, lint marks, light completion); `components/charts` holds the hand-made SVG charts.

**Playground** (`playground.rs`, `commands_lab.rs`, `features/playground`). Drafts are rows of `playground_drafts` (files as JSON). A run is a `playground` job: `compile` then `run` steps in a copy under the cache dir, inside the sandbox, with time, memory, output and process limits. The job summary keeps the files, so any past run can be restored. Library import reuses `library.rs` (dependency closure); export writes a new folder (Makefile, .gitignore) and refuses an existing one.

**Arena** (`arena/`). A benchmark (`arena_benchmarks`) is variants × scenarios × sizes.
- Each variant is an isolated copy: the working tree via `ai::workcopy`, a revision via `git archive` (the worktree and `.git` are never touched).
- `measure.rs` compiles a tiny fork/`wait4` helper in the sandbox: wall and CPU time in µs and max RSS, N repeats after a warm-up, median and MAD, outliers flagged.
- With Valgrind: Callgrind instruction counts per size and per function (`--auto=no`), Massif peak, Memcheck allocation count. A missing tool is a skipped step, never an estimate.
- `fit.rs`: least squares over 1, log n, n, n log n, n², n³, 2ⁿ; the best fit is reported only with enough sizes and a clear margin, otherwise "undetermined".
- `heuristics.rs` reads the code with tree-sitter and reports hypotheses, kept apart from measurements.
- `ai.rs`: Artix streams generator files as `=== FILE … === END` blocks (each shown when complete, nothing runs before the user accepts); the final report prompt receives only the measured JSON and the heuristics.

**Connect** (`connect/`, off by default, `Config` stored under the `connect` settings key).
- Identity: a self-signed Ed25519 certificate (`rcgen`), key 0600; the device id is the SHA-256 fingerprint.
- Transport: WebSocket over mutual TLS 1.3 (`rustls` with `ring`); there is no certificate authority: the handshake signatures are verified for real (each side proves it holds its key), then the fingerprint is pinned and a known contact must come back with the same one. First contact shows the same 6-digit code on both sides (derived from both fingerprints) before the user accepts.
- Discovery: `mdns-sd`, service `_tekboard._tcp.local.`, only while enabled and not invisible. No scanning; manual fallback is an invitation code `tb1:<ip>:<port>:<fp>` or an address. It listens on the chosen LAN interface only; no UPnP, no firewall change, no relay.
- Messages: JSON text (256 KiB max) and binary frames `[u32 BE len][json][payload]`, per-peer frame rate limit, unpaired peers may only send a pairing request. Modules register a handler per message prefix (`Service::on`); `space.*`, `board.*` and `connect.gone` are forwarded to the window as `connect-session` and dispatched by `lib/sessionBus.ts`.
- `netdiag` explains client isolation / VLANs in plain words instead of trying to get around them.

**TekShare** (`connect/share.rs`, `connect/inbox.rs`). An offer is a zip with a `tekshare.json` manifest (type, title, preview, size, SHA-256). Sending runs `packager::secret_in` and the exclusion list, refuses whole school repositories and warns on school projects. Receiving: quarantine in the cache, size and hash check, extraction without absolute paths, `..`, links, exec bits or zip bombs. Typed destinations import into the library, templates, prompts, Playground, Arena, boards, a project (patch: `git apply --check` first) or Downloads. Nothing is executed.

**TekLive** (`teklive/`). `relay.rs` is a Rust port of the p2p-live-share WebSocket relay (`/<room>/<peer>`, JSON text, binary frames with a u32 LE metadata length, `__update_peers__`), bound to the LAN address, accepting only the room opened from this machine and, optionally, contacts' addresses. The "TekBoard Bridge" VS Code extension is generated as a `.vsix` by Rust and installed after confirmation. It reads a single-use request file in `$XDG_RUNTIME_DIR` (0600), sets `p2p-live-share.servers` through `workspace.getConfiguration().update` and runs `p2p-live-share.host`. TekBoard sees the room on its relay and builds the real `p2p-live-share://ws.<room>.<host:port>/` link; guests join with `code --folder-uri`. The extension has no per-participant permissions; the UI says so.

**TekSpace** (`features/space`). Pure TypeScript: `SpaceHost` is host-authoritative behind an abstract transport (Connect today, a headless host later), `protocol.ts` checks every client message, the engine draws a static map once and redraws on change only (≤30 fps, stopped when hidden). Tables carry goals, a shared focus timer (host timestamps), Web Audio ambiences, a validated Spotify Jam link, pins and the table's board.

**Whiteboards** (`boards.rs`, `commands_boards.rs`, `features/whiteboard`).
- Storage: a `boards` row (name, project, text index for search, thumbnail, position) and `data/boards/<id>.json`; images in `data/boards/<id>/files/` (PNG/JPEG/WebP/GIF/SVG data URLs, 4 MB each); embeddable/iframe elements refused. `board_versions` keeps a snapshot every 5 minutes of work, 30 per board. Nothing is written into a project unless exported (`docs/boards/<name>.tekboard-board`, never overwritten).
- Exports: PNG/SVG by Excalidraw; PDF is a JPEG rendered by the window wrapped in a one-page PDF written by `boards::pdf_from_jpeg` (no crate); `.tekboard-board` is versioned JSON validated on import (`.excalidraw` files are accepted too). Save-dialog paths must be absolute, in the home folder, with an export extension.
- Editor: Excalidraw 0.18 (MIT), lazy-loaded with the editor chunk. Fonts are served by TekBoard (`vite.config.ts`, `/excalidraw/fonts`, Xiaolai left out); `assetPath.ts` sets `EXCALIDRAW_ASSET_PATH` and, since WebKitGTK does not always fire `document.fonts` `loadingdone`, loads the faces and dispatches the event itself. The CSP gains `blob:` images, `blob:` workers and `connect-src 'self'` only.
- `lib/boards.ts` (pure, tested) builds the programming shapes as Excalidraw skeletons with bound arrows, summarises a board for Artix and parses Artix answers (Mermaid block, `[{anchor, note}]` annotations).
- Collaboration (`collab.ts`, tested with a fake transport): the board's owner hosts; guests `board.join`, get `board.welcome` and the scene in chunks under the Connect limit (counted in UTF-8 bytes); then only elements whose version changed travel (`board.ops`), merged with `reconcileElements` and applied with `CaptureUpdateAction.NEVER` so undo stays per person. Images are fetched by id on demand. Cursors ≤20 Hz, edit/view rights enforced by the host (writes from viewers are refused), presentation = followers receive the presenter's scroll/zoom. A guest that gets no answer is told after 10 s and can reconnect. A TekSpace table's board lets people seated at that table join without an invitation.
- Artix (`board_ai` job): a Mermaid diagram (converted with `@excalidraw/mermaid-to-excalidraw`) or annotations. The result is inserted as a selected preview marked `customData.tekPreview`: not saved, not sent to others, removed on cancel, and kept as one undo step.

## Brain Dump (0.9)

- **One store.** Captures are rows of `tasks` (`kind` `idea` in the inbox, then `task`, `note` or `snippet`); a conversion changes the row, nothing is copied. Migration `v-brain` adds `pinned`, `archived_at`, `tags`, `ctype`, `updated_at` and an external-content FTS5 table `tasks_fts` (title, notes, tags; `unicode61 remove_diacritics 2`) kept by triggers. `planner::state` only returns `task`/`idea` rows that are not archived, so the planning, Today and Artix never see notes or snippets; `planner::save_task` never writes the Brain Dump columns (pin, tags, archive survive an edit from the planning).
- **Local rules** (`brain.rs`): title, `#tags` (outside code, not preprocessor lines) and type are found at save time, without a model. The project a capture names is suggested in the window (`lib/brain.ts`, from the names the user sees). Artix (`brain_artix`) is a job started only on a click; its answer is a set of suggestions the inbox shows, never applied by itself.
- **Images** are files of `<data>/captures/<id>.<ext>` (checked magic bytes, written atomically), referenced as `capture:<id>` and shown as `data:` URLs (the CSP allows nothing else). Unused ones are swept at start, a day later, so that deleting a capture can be undone.
- **Windows.** The main window starts hidden and `desktop::first_window` shows it, or only the floating `capture` window for `tekboard capture`. `tauri-plugin-single-instance` hands a second launch's arguments to the running app (`startup-args`). The capture window is created on first use, hidden after use and destroyed after ten idle minutes; `main.tsx` loads only `CaptureApp` there. Every Brain Dump write emits `data-changed` (`brain`, `plan`) so both windows stay current.
- **Global shortcut and tray** (`desktop.rs`): the shortcut is registered under X11 only (Wayland gives no application global keys; the settings show the command to bind instead). The tray icon is offered only when the AppIndicator library is present, since it is loaded when the icon is built.

## Riso design and 1.0

- **Design.** `DESIGN.md` is the authority (Riso tokens, components, do's and don'ts), with `.impeccable/design.json`. The accent can be personal: `lib/color.ts` derives `--color-accent`, `-strong`, `-soft` and `-on-accent` from one hex, lifting or lowering lightness until it reads at 4.5:1 on the surface in both modes; `main.tsx` applies it before the first paint. Each ambiance has its own window and tray icon (`src-tauri/icons/themes/`, generated by `scripts/theme-icons.mjs`; `desktop::apply_theme_icon`). The launcher icon stays the packaged one, and Wayland may ignore window icons.
- **Today as widgets** (`features/overview/layout.ts`, pure): `{version: 2, items: [{id, w, h}]}` in an auto-placed grid. A v1 layout (order + hidden) migrates keeping both; the default is the former page; a new widget goes to the catalogue, never into a custom layout.
- **Work day past midnight** (`schedule.rs`, `lib/plan.ts`): `day_end` may exceed 1440 minutes (up to start + 23 h). The night part belongs to the work day that started it (`work_day_of`), so caps, breaks and load are counted on that day; the calendar keeps civil-day columns. Existing rhythms are unchanged.
- **Credits simulator** (`lib/credits.ts`, `credits.rs`): a built-in scale (PGE1 2026: units, modules, maximum credits, minimum per unit, 60 required) taken from the structure of the school's sheet, never its personal values. Credits belong to modules; MY units are matched by code or title. Official, pending and simulated stay three separate sums; scenarios are rows of `credit_scenarios`.
- **TekBoard moulinette** (`mouli/`): one read-only AI call turns the subject (and the signatures read by tree-sitter) into a JSON test plan with the subject's reference for each expectation, and a list of what the subject leaves unspecified. Criterion files get the Epitech header and `Test(suite, fn_behavior_expected)`; `criterion.rs` refuses libc calls, calls outside the project or Criterion, and an expectation computed by the tested function. Runs happen in the sandbox on a work copy; Criterion's JSON is parsed; program errors are kept apart from moulinette errors. Suites are saved per repository (`mouli_suites`) and replay without AI. Results only, never a fix.
- **Measures** (`bench.rs`): the Arena's `wait4` helper runs inside the sandbox, so timings exclude bubblewrap's start. Fast programs are repeated (10 to 30 runs, ~1.5 s budget); median, minimum and spread; a difference under the noise is called not significant. The Playground caches objects (`cache_dir/playground-objs`, key = content + flags) to tell full from incremental builds, times `make` apart, and compares versions A/B with a line diff.
- **Arena profiling** is bounded: the largest valid size and a middle one, within a total budget, program output to `/dev/null`, `callgrind_annotate` in the sandbox, progress published at each pass. `jobs::split_lines` reads output linearly.
- **MY freshness** (`myview::freshness`): the oldest of the main answers (fixed routes), so one fresh answer cannot hide a stale one. Past a day the sidebar turns orange and one sync is suggested per session; Artix's context says how old the data is, and `my_academic` reads it.
- **TekSpace 1.0** (`features/space/`): the host relays an ephemeral table chat (50 lines), reactions (rate-limited) and one shared "now playing" per table; every public text passes `lib/moderation.ts` on the host as well as in the window. Music comes from MPRIS (`busctl --user`, no dependency) or the Spotify Web API (PKCE on `127.0.0.1:43821`, the user's own Client ID, read-only scopes, refresh token in `secrets.json`), read every 10 s only while sharing and visible. Covers become `data:` URLs (only `i.scdn.co` or a small local image file of the home folder). Avatars are 24 ready-made looks of the sprite engine, stored in the Connect profile like a hand-made one.
- **Moderation** (`src/lib/moderation.json`, read by `lib/moderation.ts` and `moderation.rs` through `include_str!`): folding (accents, leetspeak, spaced letters, runs of three or more letters), whole-word or word-sequence matches with exceptions — no substrings (the Scunthorpe problem). Ordinary swearing passes; slurs, threats and targeted harassment do not. Nothing leaves the machine.
- **TekLive**: port 8765 when free (else a free one, said in the UI), the network interface can be chosen, and a relay that fails to start is torn down. The `ws://` address is copied at start.

## Productivity, light mode and HUB (1.2)

**Look and start-up.** `public/boot.js` (classic script, allowed as `'self'`) applies the saved design, mode, animation and light-mode choices before the first paint; the splash logo takes the design's icon colours through CSS variables. `look.rs` reads the design, mode and interface size (`ui_prefs.uiScale`, one of `look::ZOOMS`) and `desktop::prepare_main` gives the hidden window its ground colour, webview zoom and icon before it is shown. `app_set_zoom` applies a new size to every window; the zoom is the webview's own, so hit areas and menu positions stay right.

**Settings and developer mode.** Tabs live in `features/settings/tabs.ts` (`resolveTab` maps the former ids). Seven taps on the version (`lib/devmode.ts`) set the `devMode` pref; pages marked `dev: true` in `app/sections.ts` (Cozy Fox) and the Developer tab only exist then. The Developer tab reads what TekBoard already measures (versions, data sizes, MY/Connect/AI state, runs and their logs, MY sync history, the anonymised Doctor report). It grants nothing and shows no secret.

**Light mode.** One pref (`lite`), mirrored on `html[data-lite]` and in `useLiteStore` (`components/lite.tsx`, no dependency so the primitives can read it). Shared primitives adapt by themselves (`PageHeader` drops its context line, `Field` moves its hint into a tooltip, `MenuMore` groups secondary items under "Plus"); screens use `Hint`, `Detail` and `More` rather than scattered conditions. Nothing is removed and the sidebar does not change.

**Hand-in states.** `deadlines::project_state_in` / `due(…, closes)`: school work is `closed` once its final date has passed (an extension comes back as a later MY date); a personal date stays `overdue` for 14 days, then `closed`. Closed never means handed in. The board and the planning leave closed work out; `phaseOf` and `groupRepos` give the Projects list its groups.

**Bulk planning.** `ai::tools::suggest_tasks` places chosen tasks with the same engine as the plans of the day (`schedule::Need.task_id`); `planner::apply` returns `undo` actions; `patch_tasks` / `restore_tasks` edit tasks together and put them back.

**AER account.** `myaer.rs` + the AER part of `commands_my.rs`: its own window (`my-epitech-aer`), browser folder (`my-session-aer`, never exported), token in memory (`AppState.my_aer`), cache (`my_cache_aer`) and history (`my_aer_log`). Only the account and its registered sessions are read. `mydata::agenda` merges them according to `plan.sources` (also read by Artix through `world()`): same id, or same title at the same instants, is one session marked `both`.

**Whiteboard contract.** `board_contract.rs` defines what Artix may answer (graph, sequence, annotations), parses and checks it (unknown values, dangling ids, limits, anchors absent from the board) and, when it breaks the contract, asks again with the exact list of errors (`MAX_REPAIRS`). The window only receives a checked document and draws it itself (`lib/boardSpec.ts`: layered layout, lifelines). No Mermaid, no code, nothing run.

**Projet HUB.** `hub.rs` / `commands_hub.rs` / `features/hub`. A project needs a name only; optional texts are an allow-list (`FIELDS`). Items (`hub_items`): milestones, links, kept files (`data/hub/<id>/`, carried by backups), journal, decisions, members. Tasks and sessions are planning entries keyed `hub:<id>`; `facts` counts milestones, tasks, logged and planned time. Sharing goes through Connect (`hub.*`, handled in `features/hub/collab.ts`): the owner's device is the reference, checks each device's role (`hub_member_role`) before answering or applying, and sends a snapshot without local paths or fingerprints; a member keeps a copy (`origin = <owner fp>#<id>`) and only imports what it asked for. Credits are the student's own estimate ranges, never presented as official.

**TekSpace.** Any seated person may share a Spotify Jam when the table has none (`jamBy`); only them or the table's owner change it. Joining opens the Jam's link in Spotify (no API joins one). New presence status `break`; older clients show it as available.

Code Time Machine was abandoned before reaching the repository; nothing of it ships.
