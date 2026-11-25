---
name: TekBoard
description: Riso — two print inks on warm stock, a working sheet for Epitech students
colors:
  riso-blue: "#006bab"
  riso-blue-dark-stock: "#4aa3e3"
  fluo-orange: "#ff6c2f"
  fluo-orange-dark-stock: "#ff7a45"
  paper: "#f3efe6"
  paper-panel: "#ebe6da"
  paper-surface: "#f9f7f1"
  paper-line: "#ddd6c7"
  ink: "#1d1b19"
  ink-muted: "#58534b"
  ink-faint: "#6b655a"
  black-stock: "#181715"
  black-stock-panel: "#121110"
  black-stock-surface: "#201f1c"
  black-stock-line: "#2e2c28"
  paper-ink: "#efeae0"
  ok-light: "#0f7044"
  warn-light: "#a8450b"
  danger-light: "#b92a37"
  teal-chart: "#00838a"
typography:
  display:
    fontFamily: "Archivo Variable, Inter Variable, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: "34px"
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 78"
  headline:
    fontFamily: "Archivo Variable, Inter Variable, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: "28px"
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 78"
  title:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: "19px"
  body:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "19px"
    fontFeature: "'cv11', 'ss01', 'tnum'"
  label:
    fontFamily: "Inter Variable, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  mono:
    fontFamily: "JetBrains Mono Variable, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
rounded:
  sm: "4px"
  btn: "6px"
  card: "12px"
  full: "9999px"
spacing:
  row: "28px"
  row-roomy: "36px"
  section-gap: "36px"
  column-gap: "48px"
  page-x: "40px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.btn}"
    height: "32px"
    padding: "0 12px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.btn}"
    height: "32px"
  nav-item-active:
    backgroundColor: "rgb(0 107 171 / 0.12)"
    textColor: "{colors.ink}"
    rounded: "{rounded.btn}"
    height: "28px"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "5px"
    typography: "{typography.label}"
---

# Design System: TekBoard

## Overview

**Creative north star: the student print shop's working sheet.** TekBoard is set like a sheet printed in two Riso passes on uncoated stock: black ink for words and structure, **Riso blue** for what you can act on (selection, focus, links, progress, the active place), **fluorescent orange** for what is pressing (a hand-in close, "now", something late). Where the two inks meet, they overprint. The interface is quiet by default; ink appears only where it means something, so a glance tells you what is due and what is yours to act on.

It is an Operate surface: a desktop tool opened every morning beside VS Code and a terminal, used for hours, often under deadline. Density is high but calm: 13px body, 28–36px rows, hairlines and spacing instead of boxes. It refuses the grey-panel-plus-violet SaaS dashboard, card grids, gradient text, glows and glass.

The signature design ("Riso", id `aurora`) exists in **light** (warm paper) and **dark** (black stock), plus "system". Four legacy designs (Flat, Neon, Cozy, Terminal) still render through the same tokens, dark only; they are not extended and may be removed.

## Colors

Tokens live in `src/styles/index.css`: `@theme` holds the dark values, `:root[data-mode="light"]` the paper values. Components only ever use the semantic names (`bg`, `panel`, `surface`, `raised`, `hover`, `line`, `line-strong`, `fg`, `muted`, `faint`, `accent`, `accent-strong`, `accent-soft`, `accent-2`, `ok`, `warn`, `danger`, `info`, `ink`, `well`, `chart-2`).

### Primary
- **Riso Blue** (#006bab on paper, #4aa3e3 on black stock; `accent`, text-safe `accent-strong`): action and selection. The active sidebar place, the selected row, focus rings, links, progress fill, the caret. A row you hover takes a film of blue (`accent-soft`).

### Secondary
- **Fluorescent Orange** (#ff6c2f / #ff7a45; `accent-2`): urgency and "now". A hand-in within two days, the current-time line in Planning, a pinned project due soon, hand-in flags. As text use `warn` (#a8450b on paper), never the raw fluorescent.

### Neutral
- **Warm Paper** (#f3efe6) / **Black Stock** (#181715): the page ground (`bg`).
- **Panel stock** (#ebe6da / #121110): sidebar and tinted side areas (`panel`).
- **Sheet** (#f9f7f1 / #201f1c): inputs, the few real containers (`surface`); menus and dialogs sit one step up (`raised`).
- **Ink** (#1d1b19 / paper-ink #efeae0): text (`fg`); `muted` #58534b, `faint` #6b655a (≥4.5:1 on paper).
- **Hairline** (#ddd6c7 / #2e2c28; `line`) separates rows and sections; `line-strong` for borders that must hold.
- **ink/N**: translucent tints that flip with the mode (white on black stock, near-black on paper). Use `bg-ink/5`, never `bg-white/5`.
- **well**: sunken areas for code, logs and editors.

### Status
`ok` (green), `warn` (orange-brown), `danger` (red), `info` (= blue). Status is a dot plus words, never a filled pill.

### Data
Your work is blue (`accent`), other people's is teal (`chart-2`). Heatmaps step blue ink from 30% to 100%. Planning entries use Riso inks (blue, green, sunflower, aqua, red, pink, teal, purple); orange is kept for hand-ins.

### Named Rules
**The Two Inks Rule.** Blue means "you can act / this is selected", orange means "this is pressing". Never use either as decoration, and never invent a third accent.
**The Overprint Rule.** When an urgent mark sits under a hovered or selected row, the inks overprint (`.ink-urgent` uses `mix-blend-mode: var(--overprint)`: multiply on paper, screen on black stock).

## Typography

- **Display** (Archivo, wdth 78, 700, 28px/34px): the one big name on a screen (Today's "now", a project's title). Tracking -0.015em.
- **Headline** (Archivo, wdth 78, 700, 22px/28px): page titles in the page bar.
- **Title** (Inter 600, 13px): section headings (`Section`), card titles.
- **Body** (Inter 400, 13px/19px): everything else. Tabular figures on.
- **Label** (Inter 400, 12px, `faint`): metadata, column headers, group names. Sentence case, never uppercase or tracked.
- **Mono** (JetBrains Mono, 11–12px): times, dates, module codes (`G-CPE-110`), paths, hashes, counts. Mono is for data, not for looking technical.

The scale is `text-3xs` 10 · `2xs` 11 · `xs` 12 · `sm` 13 · `base` 14 · `md` 15 · `lg` 18 · `xl` 22 · `2xl` 28 · `3xl` 34. Never write `text-[13px]`.

**The Narrow Voice Rule.** Only page titles and the single most important figure or name use Archivo. Hierarchy otherwise comes from weight and tone, not size jumps.

## Layout

- App shell: sidebar 224px (52px icon rail, Ctrl+B), content centred at max 1360px with 40px side padding (56px when the content area passes 96rem), 32px top. Content never runs to the window edges.
- **Page bar**: one row with the title (or the section and its tabs, in Projects and Settings), a one-line context in `faint`, and actions on the right. Never a second band of tabs or a subtitle paragraph.
- Sections are separated by 36px; columns by 48px. Lists are rows on hairlines, 28–44px tall, with a column header in `label` style when they have columns.
- Layout responds to the **content width** (container queries on `<main>`), not the window, so opening Artix reflows the page. **Today** (V6b layout): date and greeting with a "Nouveau" menu, the "now" hero (status, big title, progress, one ink action, IDE and terminal), four indicator tiles (logtime, credits, work planned today, next hand-in), then the day's timeline (320px) beside project cards with tabs (under way, not cloned yet, to commit). Hand-ins, workload, quick actions and activity live in the fold below. Below 56rem of content width, everything stacks.
- Text measure stays under ~75ch in prose areas.

## Elevation & Depth

Flat by default. Depth comes from tone (paper → panel → sheet → raised) and hairlines. Only floating layers cast a shadow: `--shadow-pop` (`0 1px 2px rgb(29 27 25 / .08), 0 14px 36px -12px rgb(29 27 25 / .28)` on paper, darker on black stock) for menus, dialogs, the palette, toasts and tooltips. Glass blur exists only as an opt-in setting for overlays (legacy, off by default).

**The No Ghost Card Rule.** A surface has either a hairline or a shadow, not both, and never a coloured glow.

## Shapes

Radii are small and practical: 4px (marks, chips), 6px (`--btn-radius`: buttons, inputs, rows, nav items), 12px (`--radius-card`: cards, tiles, dialogs), 14px for the Today hero, full circles only for status dots and avatars. Hand-in dates sit in a 4px ink block when urgent. No pills for labels; no side stripes on boxes (calendar events keep their conventional colour edge).

## Components

All shared primitives are in `src/components/ui.tsx` unless noted. Reuse them before writing new markup.

### Buttons (`Button`, `IconButton`)
- **Primary:** a block of ink (`--btn-bg: fg`, text in `bg`), 32px (28px `sm`). One per screen, for the screen's main action.
- **Secondary:** transparent with a `line-strong` hairline. **Ghost:** text only, `ink/5` on hover. **Danger:** red tint.
- **Disabled:** 50% opacity, and always a `disabledReason`, shown as a tooltip. Never a grey button without a reason.

### Page bar (`PageHeader`)
Title + context + actions on one row. In a tabbed section it portals its context and actions into the bar App renders (`PageBarSlot`).

### Sections and rows (`Section`, `.ink-row`)
`Section` is a heading over a hairline, no box. Clickable rows use `.ink-row` (blue film on hover and focus). Row actions appear on hover or focus only.

### Cards (`Card`, `CardTitle`)
Only where a container means something: a settings group, a draggable block, a selectable tile, a chart. Never nested; never a card per list item.

### Inputs (`Input`, `Field`, `Select`)
Sheet background, 6px radius, hairline that turns blue on focus plus a 3px `accent-soft` ring (no global outline on top). Labels in `label` style above, hints below.

### Feedback
- `Notice`: an inline tinted line with an icon and an optional action: what is going on, and the way out.
- `ErrorNote`: the error, selectable, with the fix when known.
- `EmptyState`: icon, a short title, one sentence, one action.
- `Meter`: a 6px bar for a share (tests passed, hours done).
- Toasts (`Toaster`): bottom right, raised, an action button when there is something to do next.
- Tooltips (`Tooltips`, mounted once): every `title` attribute becomes a tooltip printed in reverse (paper text on ink). On focus only while navigating with the keyboard.

### Navigation (`app/Sidebar.tsx`)
Core places (Today, Projects, Planning, Inbox with count), pinned projects (favourites, dot size = hand-in urgency), then School, Lab and Connect as collapsible groups, and Artix, Templates, Settings and a single health line at the foot. Active place: blue film + blue icon. Shortcuts: Ctrl+1…9 sections, Ctrl+K palette, Ctrl+B rail, Alt+←/→ history, Ctrl+/ shortcut sheet.

### Motion
120ms (`--dur-fast`) for hovers, 180ms (`--dur-base`) for entrances, `--ease` = `cubic-bezier(0.22, 1, 0.36, 1)`. Pages rise 4px; menus scale from their trigger; mode and design changes cross-fade colours for 200ms. Nothing loops except a spinner or a state that is live (Artix thinking, a skill in progress). Everything stops under `prefers-reduced-motion`.

## Do's and Don'ts

- **Do** use semantic tokens and `ink/N`; **don't** write hex colours, `white/N`, `black/N` or `text-[Npx]` in components (charts and the pixel-art TekSpace are the only exceptions).
- **Do** say what is happening and how to fix it (a disabled reason, an error with its way out); **don't** leave a silent grey control.
- **Do** keep one ink-black primary action per screen; **don't** colour buttons blue or orange.
- **Do** separate with spacing and hairlines; **don't** wrap every block in a card or nest cards.
- **Do** write French first through `t("…")` with its English in `src/locales/en.ts`; **don't** hard-code English in the UI.
- **Do** check every screen in light and dark (`src/dev` mock, `?mode=light`); **don't** design for one mode only.
- **Don't** add gradient text, glows, glass, kickers/eyebrows above headings, uppercase tracked labels, or decorative loops.
