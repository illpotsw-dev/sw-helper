# Product Template — Nation RP Helper

## 1. One-liner
A web app that helps players in a Discord-based fantasy nation-roleplay game generate and format the four recurring, structured reports a nation has to post each turn: its budget, its Order of Battle, its Navy, and its equipment stockpile.

## 2. Problem Statement
The game is played entirely as text in Discord. Every turn, players have to hand-format the same structured reports — a budget (income/expenses/upkeep) as well as maintain the following:
- An Order of Battle for the army
- An Order of Battle for the navy
- An equipment stockpile
This is a slow, inconsistent, and error-prone, process, especially as a nation's holdings grow. There's no single place to keep this data persistent between turns, so units, ships, and stockpile quantities get retyped or copy-pasted from the previous turn's message each time, and upkeep costs have to be re-tallied by hand for the budget.

## 3. Target Users
- **Primary (only):** Players commanding a nation who deliver text information to the admin via Discord. The admin does not use this tool — it sits entirely on the player's side of the conversation, helping them produce clean output to send.

Nation data has no in-app privacy or access control — the app only generates reports; it's entirely up to the player who they share a given report with (the admin, allies for coordinating OOBs, comparing ship designs, etc.), and that sharing happens outside the app via however they paste/send the output.

## 4. Core Value Proposition
Turn "manually re-tally units, ships, stockpile, and upkeep every turn" into "the app already knows your holdings — generate this turn's report in one click," while keeping each player's nation data persistent between turns, so what lands in the admin's Discord channel/DM is consistent, complete, and arithmetically correct every time.

## 5. Key Features

### MVP
The four features below are the actual scope — each is a persistent, structured tracker (stored in the local SQLite DB) with a corresponding Discord-formatted export, not a one-off fill-in-blank form. There's no admin-mandated format today (every player currently formats their reports their own way); for MVP the app defines one fixed export format per report type rather than accommodating the existing "format anarchy."

- **Order of Battle (Army)** — structured roster of land units (type, strength/count, upkeep cost per unit), organized into a formatted Order of Battle ready to post. Units persist turn to turn; the player edits the roster (add/remove/resize units) rather than retyping it. Upkeep cost per unit type is set by the game's fixed ruleset, but the app doesn't encode that ruleset itself — the player is responsible for entering the correct per-unit-type upkeep value (e.g. a peasant levy battalion's cost) whenever a unit is added, whether at setup or later when new units are raised. Units are organized into a hierarchy of formations (Theatre → Army → Corps → Division and down), not a flat list. Data model and export format defined in [mvp-army-oob.md](mvp-army-oob.md); the editor for building and reorganizing that hierarchy, including saved alternate designs, is defined in [mvp-oob-designer.md](mvp-oob-designer.md).
- **Navy** — structured roster of ships (class/model, count, upkeep cost per ship), formatted into a Navy listing. Same persist-and-edit model as the Order of Battle, including player-entered upkeep per ship class (e.g. an x-class armored cruiser). Export format defined in [mvp-navy-oob.md](mvp-navy-oob.md).
- **Equipment Stockpile** — structured inventory of reserve equipment/materiel not currently assigned to a unit (type, quantity), formatted into a stockpile report. Export format defined in [mvp-stockpile.md](mvp-stockpile.md).
- **Turn Budget** — per-turn income and expense line items. Upkeep costs are pulled automatically from the current Order of Battle, Navy, and Equipment Stockpile rather than re-entered, and the app computes the net (income − expenses − upkeep) for a formatted budget report each turn. Export format defined in [mvp-budget.md](mvp-budget.md).
- **Starting Data Templates** — editable template files (YAML) define a new nation's initial values: starting army units and their upkeep, starting ships and their upkeep, starting equipment stockpile, and starting treasury/budget baseline. There are two distinct ways this data gets into the app:
  - **Pre-defined nation templates (repo files):** the developer ships specific, fully-written nation templates in the repository — e.g. the developer's own nation, Clan McGreggor, with its actual starting units/ships and lore pre-filled. These are for known/specific nations, not something a typical player edits directly (players don't have repo access).
  - **Paste-based import (player-facing):** since players can't reach the repo, the app itself displays the blank/example template text (e.g. on a "Get Started" screen) for them to copy, alongside a short companion instruction (e.g. "Ensure you follow the following template format") meant to be handed to an AI assistant together with the template so the AI's output stays in the correct format. The player copies both out, optionally hands them plus whatever they were personally using to track their nation (spreadsheet, doc, old Discord posts) to an AI assistant to fill in, then pastes the filled-in YAML text back into a text box in the app — no file upload. The app parses the pasted text and seeds their nation.
  Templates are written to be readable by both humans and AI assistants — clearly labeled fields, inline comments explaining what each value means/its units, and realistic example entries. Since there's no login/onboarding form or server, this paste-and-parse step is effectively a player's "account creation."
- **Nation Profile** — fixed per nation, separate from the trackers above: history and background, current politics, goals and aspirations, anything that sets the tone and flavor for the nation. Referenced for lore context, not part of the numeric reports.
- **Live Preview** — see the Discord-rendered markdown (bold, headers, tables/dividers) for whichever report you're editing, matching how it will actually look when pasted.
- **Copy-to-Clipboard / Export** — one click to copy the final formatted report for pasting into Discord.
- **Local Save** — the four trackers, nation profile, and turn history persist across sessions in an in-browser SQLite database (no login, no server round-trip). This data lives only in that browser's storage for MVP: clearing browser data or switching devices/browsers loses it, and there's no export/import to move or back it up — accepted as a known MVP limitation.

### Post-MVP / Future
- **Data Export/Import** — let a player export their local SQLite data (or a filled-in template snapshot) and re-import it, to move between devices/browsers or back up against accidental data loss.
- **Selectable Report Formats** — let a player choose between multiple layout options for a given report type (e.g. alternate ways of formatting a Budget or Order of Battle) instead of the single fixed MVP format.
- **Versioned History** — timeline of past states for each tracker (Order of Battle, Navy, Stockpile, Budget) with the ability to undo/roll back changes, not just view history.
- **Discord Webhook Bot Integration** — send the formatted report directly to the admin's channel/DM instead of copy/paste (still player-initiated; no admin-side interface).
- **Campaign Map View** — a campaign map image overlaid with the current location and disposition of the player's units/ships, kept in sync with the Order of Battle and Navy trackers.

## 6. Key User Flows
1. **First-time setup (typical player):** Player opens the app's "Get Started" screen and copies the blank/example starting-data template (readable/commented YAML) shown there → optionally hands it, along with whatever they were personally using to track their nation before (spreadsheet, doc, old Discord posts), to an AI assistant to generate a filled-in version in the correct format → fills in or corrects any remaining values by hand → pastes the final YAML text into the app's import box (no file upload — players don't have repo access) → app parses it and seeds the Order of Battle, Navy, Equipment Stockpile, and Turn Budget baseline in the local SQLite DB → lands on dashboard. No login/account creation step.
1a. **First-time setup (pre-defined nation):** For specific, developer-authored nations (e.g. the developer's own nation, Clan McGreggor), the fully-written template already lives as a file in the repository and can seed the app directly without the copy/paste step.
2. **Post a turn budget:** Open Turn Budget → app pulls current upkeep from Order of Battle/Navy/Equipment Stockpile → player adds this turn's income/expense line items → preview computed report (income, expenses, upkeep, net) → copy/export → paste into Discord.
3. **Update a tracker:** After an in-game event (e.g. a unit is destroyed, a ship is built, stockpile is consumed), player edits the relevant tracker (Order of Battle / Navy / Equipment Stockpile) → change is written to the local SQLite DB and reflected in the next budget's upkeep and any re-exported report.
4. **Re-export a report:** Player can regenerate/copy the current formatted Order of Battle, Navy, or Stockpile listing at any time, not just on the turn it changed (e.g. admin asks for a status update mid-turn).

## 7. Non-Functional Requirements
- No mandatory backend, no login/accounts — fully local-first, static-hostable web app (no infra cost).
- All persistence (nation profiles, drafts, stat history) lives in an in-browser SQLite database (e.g. SQLite compiled to WASM with OPFS-backed storage) — no localStorage/IndexedDB as the primary store.
- Initial/starting values are not entered through a signup flow — they come from a player-edited template that gets imported on first run.
- Import is paste-based (a text box the app parses), not a file upload, since typical players have no access to the app's repository; pre-defined nation templates that do live as repo files (e.g. the developer's own nation) are a separate, developer-only path.
- Starting-data template files must be self-documenting (clear field names, inline comments on meaning/units, example values) so they're legible both to the player editing by hand and to an AI assistant generating a filled-in version from the player's existing personal notes.
- Output must exactly match Discord markdown syntax (headers, bold/italic, blockquotes, code blocks, spoilers) — no WYSIWYG drift.
- Mobile-friendly, since many players draft posts from phones (note: browser SQLite/OPFS support should be verified on target mobile browsers).

## 8. Tech Stack
- **Frontend:** React/Vite or Next.js (static export fine for MVP), Tailwind for styling.
- **State/persistence:** SQLite compiled to WASM (e.g. `sqlite-wasm` / `wa-sqlite`) backed by OPFS for durable in-browser storage; no server-side database.
- **Starting data format:** YAML, to maximize readability. Pre-defined nation templates (e.g. the developer's own nation) are version-controlled files in the repo; general players get the blank template as displayed/copyable text in the app and paste their filled-in version into a text box for the app to parse — no file upload.

## 9. Success Metrics
- Time to produce a turn budget report, given the trackers are already up to date (target: under 1 minute).
- % of active players who maintain their Order of Battle/Navy/Stockpile trackers turn-over-turn rather than re-entering from scratch.
- Reduction in admin-requested corrections/resubmissions due to formatting or upkeep/math errors.
