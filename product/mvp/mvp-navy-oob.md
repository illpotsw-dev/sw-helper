# Feature Spec — Navy (Order of Battle)

Parent doc: [mvp.md](mvp.md), Section 5 (Key Features → MVP).

## 1. Overview
The Navy tracker is a persistent, structured roster of a nation's ships. Players add/remove ships as their navy changes, and the app formats the current roster into Discord-ready text on demand. Ship upkeep values are entered by the player per the game's fixed ruleset (e.g. an x-class armored cruiser's cost) and feed into the Turn Budget's upkeep total — see [mvp-budget.md](mvp-budget.md).

## 2. Data Model
Per ship, at minimum:
- Class/model name (e.g. "X-Class Armored Cruiser")
- Count
- Upkeep cost per turn (per ship or per class)

*Open: any additional fields needed per ship (e.g. individual ship names, flagship designation, current location — see the Campaign Map open question in mvp.md)?*

## 3. Export Format
*To be defined.* This section will specify the exact Discord markdown structure the app must produce — headers, ordering/grouping, table vs. list layout — matching the format the player already uses in-game.

## 4. Example Output
*To be filled in once the format above is defined.*

## 5. Open Questions
- Is the Navy a flat list of ships, or organized into sub-categories/hierarchy (e.g. fleets)? If hierarchical, does the export need to show subtotal upkeep per fleet?
