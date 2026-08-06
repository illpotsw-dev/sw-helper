# Feature Spec — Equipment Stockpile

Parent doc: [mvp.md](mvp.md), Section 5 (Key Features → MVP).

## 1. Overview
The Equipment Stockpile is a persistent, structured inventory of reserve equipment/materiel not currently assigned to a unit or ship. Players add/remove/adjust stockpile quantities as their reserves change, and the app formats the current inventory into Discord-ready text on demand. Stockpile upkeep (if any) feeds into the Turn Budget's upkeep total — see [mvp-budget.md](mvp-budget.md).

## 2. Data Model
Per stockpile entry, at minimum:
- Equipment type/name (e.g. "Spare Muskets")
- Quantity
- Upkeep cost per turn (if reserve equipment carries upkeep, as opposed to only assigned/in-use equipment)

*Open: does stockpiled (unassigned) equipment carry its own upkeep cost, or is upkeep only charged once equipment is assigned to a unit/ship (in which case it would already be covered by the Order of Battle/Navy upkeep rather than counted again here)?*

## 3. Export Format
*To be defined.* This section will specify the exact Discord markdown structure the app must produce for the stockpile report — headers, ordering/grouping, table vs. list layout — matching the format the player already uses in-game.

## 4. Example Output
*To be filled in once the format above is defined.*

## 5. Open Questions
- Is the stockpile a flat list of equipment types, or organized into categories (e.g. weapons, armor, siege equipment, naval supplies)?
