# Feature Spec — Turn Budget

Parent doc: [mvp.md](mvp.md), Section 5 (Key Features → MVP).

## 1. Overview
The Turn Budget is the per-turn income/expense/upkeep report a player posts to the admin. Upkeep is pulled automatically from the current Order of Battle ([mvp-army-oob.md](mvp-army-oob.md)), Navy ([mvp-navy-oob.md](mvp-navy-oob.md)), and Equipment Stockpile rather than re-entered; the player only adds this turn's income and expense line items, and the app computes the net.

## 2. Data Model
- Income line items (source, amount)
- Expense line items (description, amount)
- Upkeep total (auto-computed: sum of Order of Battle + Navy + Equipment Stockpile upkeep)
- Net (income − expenses − upkeep)
- Running treasury balance across turns

*Open: does the game track a running treasury balance the app should carry turn to turn, or is each turn's budget self-contained (just this turn's numbers)?*

## 3. Export Format
*To be defined.* This section will specify the exact Discord markdown structure the app must produce for the budget report — headers, line-item layout, table vs. list, how the net/total is presented — matching the format the player already uses in-game.

## 4. Example Output
*To be filled in once the format above is defined.*

## 5. Open Questions
- Does the game have a fixed ruleset for income sources (e.g. tax rate by province/population) that the app should help calculate, or are income line items always manually entered by the player?
