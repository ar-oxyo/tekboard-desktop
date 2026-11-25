# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Tauri 2 desktop app on Linux x86_64. The UI is a React webview rendered by WebKitGTK 4.1, not a native toolkit.)

## Users

Any Epitech student on Linux, in any year, from the Piscine onward. They open TekBoard every day while working on school projects, often on campus and often under deadline pressure. The job: keep track of their repositories, hand-in dates, weekly logtime and planning, test their work before the school's automated grader does, and capture ideas without breaking focus.

Secondary audience: classmates on the same local network, through the opt-in Connect features (TekShare, TekLive, TekSpace, shared whiteboards).

## Product Purpose

TekBoard puts a student's whole Epitech workload in one local desktop app: projects and their git state, hand-ins, a planning calendar, MY Epitech sync (projects, dates, subjects, results, logtime, Skill Tree), tests (unit tests, Banana coding style, clean-clone test, simulated moulinette), a C Playground, an algorithm Arena, whiteboards, Brain Dump capture with an Inbox, and Artix, an assistant that acts for the student.

Success means a student knows what is due, what state each project is in and what is still left to do, without juggling the intranet, the terminal and their notes.

## Positioning

- **Local-first, with nothing hidden:** no TekBoard account, no server, no telemetry. Connect links two computers on the same LAN directly, never through the Internet, and never works around network isolation.
- **Works on the student's real things:** their actual git repositories (read through the git and gh CLIs, no tokens stored) and their own MY Epitech account (signed in on the real site, password never seen).
- **AI is optional and controlled:** Artix runs on Claude Code, OpenRouter (free models only, never a paid model without explicit consent) or a local Ollama model, or not at all. Everything else works without AI. Agents act only through an explicit tool list, inside a sandbox, and nothing is applied without the student's click.
- **Honest about what it does:** a missing tool never blocks the app. The affected feature is turned off and the app says why and how to fix it (Doctor).

## Operating Context

- Daily use during project work, alongside VS Code, a terminal and the MY Epitech intranet.
- School rituals the product mirrors: Piscine, hand-ins with deadlines, the moulinette (automated grading), the Banana coding style checker, weekly logtime, the Skill Tree.
- Epitech repository naming (`G-CPE-110-LYN-1-1-name-27`), often stored in nested folders (`Epitech/Maths/101pong`).
- Campus Wi-Fi often isolates devices, so Connect may find nobody, and the app must say so plainly.
- Quick capture from anywhere: Ctrl+I in the app, a global shortcut on X11, or `tekboard capture` bound to a system shortcut on Wayland.

## Capabilities and Constraints

- **Stack:** Tauri 2, Rust backend, React + TypeScript (Vite, Tailwind 4), SQLite. The webview has no shell, filesystem or HTTP capability. Every action goes through an explicit backend command that validates paths.
- **Rendering performance:** WebKitGTK makes blur expensive. Glass effects stay limited to overlays and can be switched off.
- **Languages:** French is the primary language, English the second, chosen at first run or in Settings.
- **Terminology:** the Tests feature always says "test" ("tester", "tests"), never "vérifier". Product names stay as they are: Artix, Doctor, Labo, Playground, Arena, Brain Dump, Inbox, Connect, TekShare, TekLive, TekSpace, Skill Tree, Banana, moulinette.
- **Supported systems:** Ubuntu/Debian (.deb) and other x86_64 distributions (AppImage). macOS, Windows and ARM are not supported.
- **Open decision:** the app currently offers five user-selectable designs (default, Flat, Neon, Cozy, Terminal). Whether all five must survive future design work has not been decided.

## Brand Commitments

- **Never looks official.** TekBoard is an independent personal project by Thibault Eininger. It is not produced, validated or endorsed by Epitech. No Epitech logo, colors or institutional tone that could make it pass for a school product. "Epitech", "MY Epitech" and module names belong to their owners.
- **Voice:** French first, informal "tu", short direct sentences that say exactly what the app does and does not do ("Rien n'est jamais exécuté à la réception", "TekBoard ne le modifie pas pour toi"). English is the second language.
- **Name and mark:** "TekBoard" (lowercase "Tekboard" appears in places), logo at `public/tekboard.svg`.

## Evidence on Hand

- Real app screenshots: `docs/screenshots/` (projects, logtime, onboarding, updates, data).
- Feature truth: `README.md`, `CHANGELOG.md` (releases up to 0.9.0), `docs/ARCHITECTURE.md`, `SECURITY.md`.
- License: GPL-3.0.
- No testimonials, user numbers, press or endorsements exist. Future work must not invent any, nor imply any link with Epitech.

## Product Principles

1. **The student stays in control.** Nothing is applied, deleted, sent or paid for without an explicit action from them. Duplicates are flagged, never deleted. AI suggestions wait for a click.
2. **Say plainly what is happening.** Every disabled feature, missing tool or blocked network explains why and gives the fix.
3. **Local and private by default.** Data stays on the machine. Sharing happens only when the student sends something themselves.
4. **Useful without AI.** Artix adds to the app but nothing depends on it.
5. **Fast in the middle of a deadline.** Capture, check and act in seconds, without picking categories or leaving the current task.
