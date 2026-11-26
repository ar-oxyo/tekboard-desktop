---
version: 1
slug: "src-app-app-tsx"
primary_target: "src/app/App.tsx"
related_targets: []
---

# TekBoard app shell (all screens)

Scope: the whole desktop app (Tauri webview), Operate mode. Audience, job and constraints: PRODUCT.md.
Chosen: "Riso, encres sur papier" (assigned by the roll, confirmed by the user 2026-11-25). Signature design id stays `aurora`, in light and dark; Flat/Neon/Cozy/Terminal are legacy, kept rendering, not polished.

## Direction contract
THESIS: TekBoard is a student print shop's working sheet, not a mission-control dashboard: two print inks on warm stock, where ink means state. It refuses the grey-panel-plus-violet-accent dashboard and its card grid.
OWN-WORLD: Light = uncoated warm stock (#f2eee5) with near-black ink; dark = black stock (#16151a) with the same inks lifted. Riso Blue carries action, selection and focus; Fluorescent Orange carries urgency and "now"; where they meet, multiply overprint shows the combined state. Hairlines and spacing group content, few boxes. Narrow Archivo for page titles and big numbers, Inter for the UI, JetBrains Mono for codes and times.
STORY: The student opens the app and reads, in seconds, what is due, what is late or failing (orange), what they are working on (blue), and acts from the same row.
FIRST VIEWPORT: Sidebar on a tinted stock panel (core, school, lab, connect groups, pinned projects); page bar with a narrow-type title, date and one ink-black primary action; Today shows hand-ins ranked by deadline with the time in a left mono column, the day's sessions, logtime and Inbox to the right, capture field at the bottom.
FORM: Grounded list position 7 of 7 (riso zine). seed:116d9f0ef924e796. Raises: connectors only at 0/45/90 degrees; urgency as a fixed three-step dot size; each ink used only a few times per screen; row actions appear on hover/focus only; hierarchy by type scale and weight, not boxes. Signature interaction: overprint, selection (blue) multiplied with urgency (orange). Motion grammar: ink lands, a 120-180ms fade or settle, never decorative loops.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
