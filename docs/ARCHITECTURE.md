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

## Roadmap

1. ~~Foundations, Project Launcher, Templates~~
2. ~~Project sheets (notes, deadlines, build), subjects library~~
3. ~~Git actions (no destructive operation), analytics from local `git log`, Cozy Fox panel~~
4. Integrated terminal (xterm.js + PTY), calendar import, Epitech connector (manual first)
5. Automations, command library, notes search, AppImage, release pipeline
