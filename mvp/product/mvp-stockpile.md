# Feature Spec — Weapons Stockpile

Parent doc: [mvp.md](mvp.md), Section 5 (Key Features → MVP).
Data model: [mvp-army-oob.md](mvp-army-oob.md) · Editing surface: [mvp-oob-designer.md](mvp-oob-designer.md) · Interacts with: [mvp-battle-losses.md](mvp-battle-losses.md).

## 1. Overview
The stockpile is every weapon the nation owns that nobody is currently carrying. Rifles bought from a neighbour, guns taken off a beaten enemy, the old pattern rifle a battalion handed in when it was re-armed — all of it sits in one pile of unlimited capacity until it is issued back out.

That definition is the whole design: **a weapon is either in a unit's hands or in the stockpile, and never in neither or both.** The stockpile and the Order of Battle are two halves of one ledger, so the interesting operations are not "edit a quantity" but *movements* — issue, withdraw, re-arm — each of which debits one side and credits the other in a single undoable step.

This narrows the feature from what [mvp.md](mvp.md) originally called the Equipment Stockpile. It holds weapons only, because weapons are the only materiel the Order of Battle models: a unit is armed with something, so a weapon leaving the pile has somewhere to go. Ammunition, uniforms, remounts and rations have no counterpart in the OOB, and a stockpile of them would be a list of numbers with nothing to reconcile against — see §11.

## 2. Three Model Changes This Depends On
All three are changes to the OOB model rather than parts of this tool, and all three are prerequisites. Together they are what make the ledger closeable.

### 2.1 Weapons become a catalog, not a free text string
`oob_units.equipment` is free text today. Clan McGreggor's roster carries fourteen distinct strings across 58 units — `"Warden Rifle (.45 Caliber)"` on 26 of them, `"Rossenheim Siege Gun"` on exactly one, and `"Unarmed"` on four, which is a fourteenth string standing in for the absence of a weapon rather than a weapon. Free text cannot close a ledger: `Warden Rifle (.45 Caliber)` and `Warden Rifle (.45)` are two arsenals, and a typo mints weapons out of nothing.

Weapons become a catalog table keyed by name, the same shape and the same strictness as `unit_types`:

- **name** — the primary key, matched exactly. No normalization, no case-folding, no fuzzy matching, for the same reason `unit_type` isn't fuzzy-matched ([mvp-oob-designer.md](mvp-oob-designer.md) §6).
- **class** — `small_arm` or `gun`. This mirrors the men/guns split already in the model: a man-counted unit carries small arms, a gun-counted unit is equipped with guns. Issuing 18-pounders to a levy battalion is an error, not a judgement call.
- **origin** — the nation that made it, free text, player-supplied. Nothing in the app depends on it; it exists because a campaign accumulates weapons from everywhere and the report reads better grouped by where they came from.
- **description** — a note. Optional.

The catalog lives in a new per-nation file, `weapons.yml`, standing to the stockpile exactly as [`land-units.yml`](../nations/template/land-units.yml) stands to the Order of Battle: one file defines the types, another records what is actually held.

### 2.2 A unit's arming becomes a holding with a quantity
`equipment` is replaced by a **holding**: which weapon the unit carries, and how many of them. The quantity is not decorative — it is the number of physical weapons that left the stockpile, and it is what the ledger balances against.

One holding per unit for now. The storage is an `oob_unit_weapons` table with a row per holding rather than a column on `oob_units`, so that mixed arming — six hundred Warden and four hundred Lexington in the same battalion — is a UI change later rather than a schema migration. Schema migration is explicitly unsolved (`CREATE TABLE IF NOT EXISTS` with no versioning), which is precisely why the extensible shape goes in now and the one-row-per-unit limit is enforced in the app.

The governing invariant:

> **A unit never holds more weapons than it has men (or guns).**

This falls straight out of §1. Spare weapons are by definition stockpile, so a unit carrying spares is a unit holding stockpile in the wrong place. Everything below — what losses do, what reinforcements do, what "under-armed" means — is a consequence of this one line rather than a separate rule.

A unit may hold *fewer*. `holding < strength` is under-armed and legal; `holding = 0` is unarmed, which four of McGreggor's Mounted Borders battalions already are — 3,495 men between them.

### 2.3 Losses destroy weapons
[mvp-battle-losses.md](mvp-battle-losses.md) §9 currently puts equipment loss out of scope: the equipment string is untouched even when a unit is wiped out. With a quantity attached that position becomes untenable — a battalion at zero men holding a thousand rifles violates §2.2 and, worse, hides a thousand rifles from a player who would otherwise re-issue them.

**Weapons are lost with the men.** When a unit's strength falls, its holding is clamped to the new strength and the difference is destroyed — it does not return to the stockpile. This needs no new control in the Battle Losses flow and no new decision from the player: the clamp is the invariant enforcing itself, and it happens inside the same transaction that writes the strengths, so it is part of the same single undo step.

A wiped-out unit keeps the *assignment* at quantity zero — it still reads as a Warden Rifle battalion with no rifles — so that when replacements arrive the app already knows what to ask the stockpile for. The rifles themselves are gone.

Reinforcements are the mirror and deliberately do **not** balance: a battalion filled from 200 to 1,000 men holds the same 200 rifles it did before and is now under-armed by 800. Arming it is a separate, deliberate act against a stockpile that may not have 800 rifles in it. Reinforcement is never blocked for want of weapons — men and rifles arrive by different roads.

## 3. The Stockpile
Per weapon in the catalog, one quantity: how many are in the pile. That is the entire table.

- **Unlimited capacity.** No storage limit, no facility to build, no overflow.
- **No upkeep.** Stockpiled weapons cost nothing per turn; upkeep is charged on units through the Order of Battle and charging it again here would be double-counting. The stockpile therefore contributes **nothing** to the Turn Budget, which amends [mvp-budget.md](mvp-budget.md) §2's "sum of Order of Battle + Navy + Equipment Stockpile upkeep".
- **No history.** No acquisition log, no per-transaction record — the same position [mvp-battle-losses.md](mvp-battle-losses.md) §7 takes for battles. What happened lives in the undo stack while the stack holds it, and in Discord permanently. A ledger with dates and provenance is a real feature with a table and a report of its own; see §11.

Quantity is stored; *owned* is derived, never stored:

```
owned(w) = stock(w) + Σ holdings(w) across the live Order of Battle
```

## 4. Conservation
There are three places a weapon can be — **stock**, **issued**, and **outside the nation** — and exactly six movements between them. Every operation in the feature is one of these; nothing else writes a quantity.

| Movement | From → To | Where it happens |
|---|---|---|
| **Issue** | stock → unit | Stockpile or unit row |
| **Withdraw** | unit → stock | Stockpile or unit row |
| **Re-arm** | unit → stock → unit | Re-arm dialog (§5) |
| **Acquire** | outside → stock | Purchase, capture, gift (§6) |
| **Dispose** | stock → outside | Sold, scrapped, given away (§6) |
| **Combat loss** | unit → outside | Battle Losses, automatically (§2.3) |

The rules the app enforces, always, with no preference to turn them off:

- **Stock never goes negative.** You cannot issue a rifle you do not have. A shortfall is shown with its exact size before anything is committed.
- **A holding never exceeds its unit's strength** (§2.2).
- **Class must match the measure.** Small arms to man-counted units, guns to gun-counted units.
- **Nothing crosses the boundary implicitly.** Weapons enter or leave the nation's possession only through an explicit acquire, dispose, or combat loss. No other operation changes `owned`.

Issue, withdraw and re-arm are pure movements: they change where weapons are, never how many exist. Each is a single transaction and a single undo entry, labelled with what it did — `Undo: Re-arm 1st Infantry Brigade` rather than `Undo: Edit unit`.

### Designs
The ledger counts the **live** Order of Battle only. Holdings on a saved design ([mvp-oob-designer.md](mvp-oob-designer.md) §2) are *intentions*, not property — otherwise duplicating a design would double the nation's arsenal on paper.

Promote-to-live reconciles in one shot. Because promotion does not change what the nation owns, the check is simply whether the incoming design can be armed out of what it has:

```
for every weapon w:  owned(w) − Σ holdings(w) in the design  ≥  0
```

The promote dialog shows the resulting stockpile alongside the upkeep delta it already shows, and promotion is **blocked**, with the exact per-weapon shortfall, if the design arms troops the nation cannot arm. This slots into the existing rule that errors block promotion and notices do not.

## 5. Re-arming
This is the feature. Everything else is bookkeeping around it.

A player who has just captured four hundred Lexington rifles wants them in the hands of the Highlander battalions and the old Barclays back in the pile — one action, correct arithmetic, one undo entry. Doing it as four separate edits across two screens is exactly the hand-tallying the app exists to remove.

**The dialog.** Selection first, weapon second, preview third — the same shape as Battle Losses, and steps rather than one wide table for the same reason ([mvp.md](mvp.md) §7 wants this usable on a phone).

1. **Who** — the formation tree with checkboxes, selecting a formation selecting everything under it. Gun-counted and man-counted units are separable in one gesture, since a brigade contains both and they cannot take the same weapon.
2. **What** — the weapon to issue, picked from the stockpile. The list shows only what is in stock, only in the right class, with the quantity available on each row. A weapon with none in stock is visible but not selectable, so the player can see the arsenal has none rather than wondering where it went.
3. **Preview** — one row per unit: `Barclay Hornets 975 → Lexington Pattern Rifle 975`, the running draw on the stockpile, and what the pile is left with. Units are served in tree order, so the result is deterministic and the preview is exactly what commits.
4. **Apply** — one transaction, one undo entry.

**Shortfall.** Re-arming three battalions needing 2,840 rifles from a stock of 2,000 is the normal case, not the exception. The dialog reports it in place — *"2,840 needed · 2,000 available · 840 short"* — and offers the two honest resolutions rather than picking one silently:

- **Arm as far as it goes** — units served in tree order until the pile is empty. The last unit served is left under-armed; units past it keep what they had. Under-armed is a legal state (§2.2), so this needs no special case.
- **Narrow the selection** — go back a step and pick fewer units.

Nothing commits until one is chosen. The old weapons return to the stockpile as part of the same movement, so the Barclays the player just displaced are available to re-arm someone else immediately.

**Issue** and **withdraw** are the same machinery with one side left empty: issuing to an unarmed unit is a re-arm with nothing to return, withdrawing is a re-arm with nothing to draw. They appear as their own actions on a unit row, so the four unarmed Mounted Borders battalions can be armed without pretending to re-arm them.

## 6. Acquisition and Disposal
The two movements that cross the nation's boundary, and the only ones the app has no way to derive. Both are a single form: weapon, quantity, and a short free-text reason that becomes the undo label — *"Undo: Captured 320 Lexington Pattern Rifle"*.

Acquisition covers purchase, capture and gift; disposal covers sale, scrapping and giving weapons away. The app does not distinguish between them beyond the label, because nothing downstream depends on the distinction and inventing a taxonomy the game does not have would be guessing.

A capture is often the first time a nation has seen a weapon at all, so the weapon picker offers **create a new weapon** inline — name, class, origin — rather than sending the player to a separate catalog screen mid-flow. This is the one place the weapon catalog is deliberately more permissive than the unit catalog: a unit type is a considered decision made at setup, while a captured rifle is an event that happens mid-turn, and demanding a catalog trip first would be the app getting in the way. Import stays strict either way (§7).

## 7. Files, Import and Export
Two files, mirroring the existing catalog/instance split:

- `weapons.yml` — the catalog: name, class, origin, description. Stands to the stockpile as `land-units.yml` stands to the OOB.
- `stockpile.yml` — quantities in the pile, one entry per weapon, referencing `weapons.yml` by name exactly.

`army-oob.yml`'s `equipment:` field becomes `weapon:` and `weapon_count:`, resolved against `weapons.yml` by exact name. An OOB naming a weapon the catalog does not have **fails the whole import** and reports every unresolved name at once, exactly as an unresolved `unit_type` does today ([mvp-oob-designer.md](mvp-oob-designer.md) §7). `weapon_count:` may be omitted, meaning "fully armed" — the unit's current strength — which is what 54 of McGreggor's 58 units want, and keeps the common case out of the file.

Seeding a pre-defined nation derives most of its opening position from files it already has: the thirteen weapon strings in McGreggor's roster become the thirteen catalog entries of [`weapons.yml`](../nations/clan-mcgreggor/weapons.yml), `"Unarmed"` becomes no holding at all rather than a fourteenth entry, and every other unit gets a holding at its current strength — 27,985 small arms and 525 guns issued, with four Mounted Borders battalions unarmed.

What is *in the pile* cannot be derived, because nothing in the roster records it, so [`stockpile.yml`](../nations/clan-mcgreggor/stockpile.yml) declares it directly. McGreggor's figures there are placeholders in the same sense as the PLACEHOLDER COSTS in `land-units.yml`, but they are constrained rather than arbitrary: a unit takes one pattern, so any small arm held in 770 or more would arm the smallest of those four unarmed battalions, and a clan that could arm its cavalry presumably would have. Every small-arm figure is therefore under 770. The opening pile is 1,100 small arms and 24 guns, against 3,495 men with nothing to carry — short on purpose, which is what makes the re-arm flow the first thing a player reaches for.

**Export.** The stockpile report is a flat grouped list, so it is *not* blocked on the nested-tree question that holds up [mvp-army-oob.md](mvp-army-oob.md) §5. Grouped by class, then by origin, then by name — origins alphabetically with unattributed last, names alphabetically within an origin. Quantities are what is in the pile, with owned totals at the bottom so the report answers "what have we got" as well as "what is spare":

```markdown
## Weapons Stockpile — Clan McGreggor

### Small Arms
**Barclay**
- Barclay Hornets (7x57mm) — **340**

**Clan McGreggor**
- Warden Rifle (.45 Caliber) — **615**

**Rossenheim**
- Einzelgänger (.68 Caliber) — **145**

### Guns
**Clan McGreggor**
- 18-Pounder Pattern M Field Gun — **4**
- Cyclone Repeating Gun (.50 Caliber) — **6**
- Glenforge 6-Pounder Smoothbore Cannon — **11**
- Vanguard Light Field Gun (12-Pounder) — **2**

**Rossenheim**
- Rossenheim Machine Gun (11mm) — **1**

**In stockpile:** 1,100 small arms · 24 guns
**Total owned:** 29,085 small arms · 549 guns
```

Weapons at zero are omitted rather than listed as zero. A wholly empty stockpile exports the header and a single line saying so, rather than an empty document that reads as a bug.

Per [mvp.md](mvp.md) §5 this is the app's own fixed format, not one the admin mandates.

## 8. Validation
Added to the rules checked continuously while editing and enforced at import and promote-to-live ([mvp-oob-designer.md](mvp-oob-designer.md) §6):

**Errors** — block import and promote-to-live:
- a unit's weapon is not in the catalog;
- weapon class does not match the unit's measure (a gun issued to a man-counted unit, or the reverse);
- a holding exceeds its unit's strength;
- a stockpile quantity is negative;
- more than one holding on a unit (the MVP limit from §2.2 — a file carrying two is rejected rather than silently truncated).

**Notices** — surfaced on the row, block nothing:
- **under-armed** — `holding < strength`, shown with the gap: *"under-armed by 800"*;
- **unarmed** — `holding = 0` with strength above zero, which four of McGreggor's battalions are today, and which is a perfectly legal way to run a nation short of rifles.

Under-arming is a notice and not an error on purpose. It is the normal state of a nation between a battle and a re-arm, and making it an error would mean the OOB stops validating every time reinforcements arrive.

## 9. Guarantees
The properties the ledger is tested against:

- `stock(w) + Σ holdings(w) across live` is unchanged by every issue, withdraw and re-arm, for every weapon, always;
- it changes by exactly the entered amount on an acquire or dispose, and by exactly the casualties on a combat loss;
- no stock quantity is ever negative, at any point, including mid-operation;
- no holding ever exceeds its unit's strength, including immediately after losses are applied;
- a re-arm shortfall is reported with its exact size and never silently partial;
- a bulk re-arm serves units in tree order, so the same selection against the same stock always produces the same result;
- losses clamp holdings inside the same transaction that writes strengths, so no intermediate state violates §2.2 and the whole battle stays one undo entry;
- reinforcements never draw on the stockpile and are never blocked by it;
- promote-to-live is blocked with a per-weapon shortfall when the design cannot be armed out of what the nation owns;
- an operation that would break any invariant commits nothing at all.

## 10. Worked Example
Against the seeded roster. Mountain Force fields three Highlander battalions — 975, 945 and 920 men — carrying `Barclay Hornets (7x57mm)`, 2,840 rifles between them. A raid nets 2,000 `Lexington Pattern Rifle`, entered as an acquisition.

Re-arm the three: 2,840 needed, 2,000 available, 840 short. The player takes *arm as far as it goes*. In tree order the first battalion draws 975 and the second 945; the third draws the remaining 80 and stands at 80 of 920 — under-armed by 840, flagged on its row. All 2,840 Barclays land back in the pile, where they immediately become the obvious thing to re-arm that third battalion with. Stock afterwards: 0 Lexington, 2,840 Barclay. Owned is unchanged throughout. One undo entry.

That battalion then fights and loses 400 men. Strength falls to 520; its holding of 80 Lexingtons is already below that, so nothing is clamped and nothing is destroyed. Had it been fully armed at 920, it would have lost 400 rifles along with the men, and they would not have come back.

## 11. Out of Scope
- **Non-weapon materiel** — ammunition, uniforms, remounts, rations, siege stores. Nothing in the OOB models them, so there is no ledger to close, and a flat quantity list has no interop to justify itself. See §12.
- **Acquisition history** — no dates, no provenance, no per-transaction record. §3.
- **Weapon costs** — the catalog carries no purchase price. Buying rifles is an expense line the player enters in the Turn Budget like any other.
- **Weapon statistics** — no range, rate of fire, or combat effect. The app does not resolve battles ([mvp-battle-losses.md](mvp-battle-losses.md)), so a weapon's only mechanical property is how many of it there are.
- **Mixed arming within a unit** — one holding per unit for MVP. The storage shape supports it (§2.2); the UI and the validation limit do not yet.
- **Navy** — army only, as everywhere else in the MVP. A ship's armament is part of its class, not a stockpile item.
- **Recovering weapons from the field** — casualties' weapons are destroyed, never salvaged (§2.3). Weapons taken from an *enemy* are an acquisition the player enters by hand.

## 12. Open Questions
- Does stockpiling non-weapon materiel matter to the game at all — is the player currently reporting ammunition or supply to the admin, or is the stockpile genuinely a weapons rack?
- Is a weapon ever *partly* issued in a way one holding cannot express — a battalion in transition carrying two patterns at once? That is the trigger for lifting the one-holding limit, and it is worth knowing whether it is a matter of turns or of months.
- Should a nation be able to mark a weapon **obsolete**, so the picker stops offering three thousand handed-in muskets that will never be issued again?
- Do captured weapons carry a penalty in the game's ruleset — ammunition incompatibility, unfamiliarity — that the app should surface on the unit row, or is a captured rifle simply a rifle?
- Should disposal offer a "sold for" amount that posts an income line to the Turn Budget, or does the player enter both halves themselves?
