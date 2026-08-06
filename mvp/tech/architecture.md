# Technical Architecture — MVP

Parent doc: [mvp.md](../product/mvp.md), Section 8 (Tech Stack).

## 1. Overview
A static, client-only web app. No backend, no accounts — all state lives in the player's browser. The app's only jobs are: hold each tracker's data, render it as Discord-formatted markdown, and parse a pasted YAML template on first run.

## 2. Stack
- **Frontend:** React + Vite, static export (deployable to any static host — no server).
- **Styling:** Tailwind CSS.
- **Persistence:** SQLite compiled to WASM (`sqlite-wasm` or `wa-sqlite`), backed by OPFS for durable in-browser storage. No localStorage/IndexedDB as primary store, no server-side DB.
- **Starting data format:** YAML — self-documenting templates, either pasted by the player or shipped as repo files for pre-defined nations.

## 3. High-Level Structure
```
Browser
├── UI (React)
│   ├── Tracker editors: Army OOB, Navy, Stockpile, Budget, Nation Profile
│   ├── Import screen (paste YAML template)
│   └── Live Preview + Copy-to-Clipboard (per tracker's Discord markdown)
├── Formatters (pure functions: tracker data → Discord markdown string)
├── YAML import parser (pasted text → tracker rows)
└── SQLite (WASM + OPFS)
    └── tables: nation_profile, army_units, navy_ships, stockpile_items, budget_entries
```
No network calls at runtime beyond loading the static app itself.

## 4. Data Model (MVP)
One SQLite DB per browser, single nation:
- **nation_profile** — name, history/politics/goals text (flavor only, not numeric).
- **army_units** — unit type/name, strength/count, upkeep per turn.
- **navy_ships** — class/model, count, upkeep per ship.
- **stockpile_items** — item type, quantity.
- **budget_entries** — per-turn income/expense line items (source or description, amount); upkeep and net are computed, not stored as input.

Exact export formats per tracker are defined in their own feature specs (e.g. [mvp-army-oob.md](../product/mvp-army-oob.md), [mvp-budget.md](../product/mvp-budget.md)).

## 5. Key Flows → Architecture
- **First-time setup:** player pastes filled-in YAML → parser validates/maps it to the table rows above → written to SQLite → dashboard reads from SQLite.
- **Edit a tracker:** UI writes directly to the relevant table; no intermediate draft state needed since there's no server round-trip.
- **Generate a report:** UI reads current tracker rows → formatter produces Discord markdown → shown in Live Preview → Copy-to-Clipboard.
- **Turn Budget:** formatter/query sums upkeep across army_units + navy_ships + stockpile_items at render time rather than storing a duplicated upkeep total.

## 6. Constraints & Risks
- OPFS support varies on mobile browsers — must be verified on target devices (app is mobile-friendly per requirements).
- No export/import of the SQLite data itself for MVP — clearing browser storage or switching devices loses data (accepted MVP limitation, see mvp.md Section 7).
- Single nation per browser profile for MVP; no multi-nation switching.
