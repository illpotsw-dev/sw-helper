# Feature Spec — Order of Battle (Army)

Parent doc: [mvp.md](mvp.md), Section 5 (Key Features → MVP).

## 1. Overview
The Army Order of Battle is a persistent, structured roster of a nation's land units. Players add/remove/resize units as their army changes, and the app formats the current roster into Discord-ready text on demand. Unit upkeep values are entered by the player per the game's fixed ruleset (the app does not encode that ruleset) and feed into the Turn Budget's upkeep total — see [mvp-budget.md](mvp-budget.md).

## 2. Data Model
Per unit, at minimum:
- Unit type/name (e.g. "Peasant Levy Battalion")
- Strength / count
- Upkeep cost per turn

*Open: any additional fields needed per unit (e.g. quality/veterancy, equipment assigned, commander, current location — see the Campaign Map open question in mvp.md)?*

## 3. Export Format
*To be defined.* This section will specify the exact Discord markdown structure the app must produce — headers, ordering/grouping, table vs. list layout — matching the format the player already uses in-game.

## 4. Example Output
*To be filled in once the format above is defined.*

## 5. Open Questions
- Is the Order of Battle a flat list of units, or organized into sub-categories/hierarchy (e.g. army > divisions > regiments)? If hierarchical, does the export need to show subtotal upkeep per grouping level?
