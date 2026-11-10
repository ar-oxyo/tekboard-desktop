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

## Roadmap

1. ~~Foundations, Project Launcher, Templates~~
2. ~~Project sheets (notes, deadlines, build), subjects library~~
3. ~~Git actions (no destructive operation), analytics from local `git log`, Cozy Fox panel~~
4. Integrated terminal (xterm.js + PTY), calendar import, Epitech connector (manual first)
5. Automations, command library, notes search, AppImage, release pipeline
