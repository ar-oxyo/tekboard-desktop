# TekBoard: working rules

Where things are (keep these as the single source; this file doesn't repeat them):
- **Product**: `PRODUCT.md` (audience, positioning, voice, brand commitments).
- **Visual system**: `DESIGN.md` (Riso: tokens, components, do's and don'ts); its machine-readable extension is `.impeccable/design.json`.
- **Architecture and commands**: the Serena memories (`core`, `frontend/core`, `backend/core`, `conventions`, `invariants/safety`, `suggested_commands`, `task_completion`), and `docs/ARCHITECTURE.md` read section by section.

## Tools
- **Serena first** for code: `get_symbols_overview` / `find_symbol` before reading a whole file; edit with Serena's tools. Read the memories above instead of re-exploring the repo, and update the relevant one when the architecture changes.
- **RTK** condenses command output automatically; batch related commands. For a large file, use `Read` with a range (`cat` on a big file is blocked).
- **Impeccable** (`~/.claude/skills/impeccable`) and **unslop** are for UI work only: load them when changing a screen, not for backend tasks. After UI edits, run `~/.claude/skills/impeccable/scripts/impeccable detect --json --changed`.
- No subagent unless a task really needs a parallel search.

## UI rules (details in DESIGN.md)
- Only semantic tokens: `bg-surface`, `text-muted`, `border-line`, `bg-ink/5`, `bg-well`, `text-sm`… Never hex colours, `white/N`, `black/N` or `text-[13px]` in components.
- Reuse `components/ui.tsx` (`Button` with `disabledReason`, `PageHeader`, `Section`, `Notice`, `Meter`, `EmptyState`, `ErrorNote`), `Modal`, `Menu`, `Select`. A `title` attribute is enough for a tooltip.
- Blue ink (`accent`) = action/selection; orange (`accent-2`, text `warn`) = urgency. One ink-black primary button per screen. No card inside a card.
- Every screen must work in light and dark. Layouts follow the content width (`@container` on `<main>`).
- Every UI string goes through `t("French text")`, and its English goes in `src/locales/en.ts`. Tests are "test/tester", never "vérifier".

## Seeing a screen without Tauri
`npx vite --port 1420` serves the UI with the dev-only fake backend in `src/dev/` (never in production builds). URL parameters: `?page=projects&mode=light&theme=aurora&sheet=<path>&open=artix|inbox|palette|shortcuts&stab=design&empty=1&fail=cmd`. For captures, use Playwright WebKit (close to the app's WebKitGTK), installed outside the repository. An object command without a fixture answers "Pas de donnée de démonstration…": add one to `src/dev/fixtures.ts`.

## Definition of done
Follow `task_completion` (typecheck, `npm test`, and build when imports change). For UI changes, add: look at the screen in both modes, run the detector, and check that no English string is left without an `en.ts` entry. Commit in French (`Domaine : ce qui change`), with no co-author line. Never push or release without an explicit request.
