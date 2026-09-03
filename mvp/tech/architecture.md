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
    └── tables: nation_profile, echelons, unit_types,
                oob_designs, oob_formations, oob_units,
                navy_ships, stockpile_items, budget_entries
```
No network calls at runtime beyond loading the static app itself.

## 4. Data Model (MVP)
One SQLite DB per browser, single nation:
- **nation_profile** — name, history/politics/goals text (flavor only, not numeric).
- **echelons** — the eight NATO tiers. Symbol and level are fixed; the name is renameable per nation. Seeded with defaults on first open.
- **unit_types** — the nation's unit catalog, mirroring `land-units.yml`. Keyed by name, because units reference their type by name.
- **oob_designs** — the live OOB plus any saved designs. A partial unique index enforces that exactly one row is live.
- **oob_formations** — the formation tree: design, parent (NULL for an independent top-level formation), echelon, name, sort order.
- **oob_units** — raised units: formation, unit type, designation, current men/weapons, equipment, sort order.
- **navy_ships** — class/model, count, upkeep per ship. Still flat; navy hierarchy is unresolved in [mvp-navy-oob.md](../product/mvp-navy-oob.md).
- **stockpile_items** — item type, quantity.
- **budget_entries** — per-turn income/expense line items (source or description, amount); upkeep and net are computed, not stored as input.

`PRAGMA foreign_keys = ON` is issued on every connection — SQLite ignores foreign keys otherwise, and the OOB import's strictness depends on them. The database enforces what it can: a unit's `unit_type` must resolve to a catalog row exactly (import fails otherwise), a formation's echelon must be a known symbol, a unit carries men or guns but never both and never neither, and a catalog entry cannot be deleted while units still reference it. Two rules stay in application code because a `CHECK` cannot read another row: that a formation's echelon sits strictly below its parent's, and that a unit's men/guns choice matches its type's.

Schema statements run as `CREATE TABLE IF NOT EXISTS` on every open, with no migration versioning — changing a table's shape does not migrate an existing browser database. Acceptable while the app is pre-release and carries no real data; a migration story is needed before it does.

Exact export formats per tracker are defined in their own feature specs (e.g. [mvp-army-oob.md](../product/mvp-army-oob.md), [mvp-budget.md](../product/mvp-budget.md)). The OOB editing surface is specified in [mvp-oob-designer.md](../product/mvp-oob-designer.md).

## 5. Key Flows → Architecture
- **First-time setup:** player pastes filled-in YAML → parser validates/maps it to the table rows above → written to SQLite → dashboard reads from SQLite.
- **Edit a tracker:** UI writes directly to the relevant table; no intermediate draft state needed since there's no server round-trip.
- **Generate a report:** UI reads current tracker rows → formatter produces Discord markdown → shown in Live Preview → Copy-to-Clipboard.
- **Turn Budget:** formatter/query sums upkeep at render time rather than storing a duplicated total — army upkeep from the *live* design's oob_units joined to unit_types, plus navy_ships and stockpile_items. Saved (non-live) designs are excluded; they are planning artifacts and cost the nation nothing.

## 6. Constraints & Risks
- OPFS support varies on mobile browsers — must be verified on target devices (app is mobile-friendly per requirements).
- No export/import of the SQLite data itself for MVP — clearing browser storage or switching devices loses data (accepted MVP limitation, see mvp.md Section 7).
- Single nation per browser profile for MVP; no multi-nation switching.
