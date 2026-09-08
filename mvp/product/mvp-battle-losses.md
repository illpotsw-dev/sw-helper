# Feature Spec — Battle Losses

Parent doc: [mvp.md](mvp.md), Section 5 (Key Features → MVP).
Data model: [mvp-army-oob.md](mvp-army-oob.md) · Editing surface: [mvp-oob-designer.md](mvp-oob-designer.md).

## 1. Overview
Battles and campaigns are fought narratively in Discord; the app takes no part in resolving them. What comes back afterwards is a total — "6,700 men across I. and II. Divisions, and eleven guns" — and the player has to turn that number into a roster. Done by hand across dozens of units it is the most tedious thing between turns, and it is arithmetic over data the app already holds.

The tool takes a total, the formations that fought, and a few steering controls, then writes the resulting strengths back to the order of battle as **one undoable step**. Run in the other direction it distributes reinforcements.

It does not decide how many casualties were taken — the narrative does that. It decides **who** took them, under the player's direction, and does the arithmetic exactly.

## 2. Two Model Changes This Depends On
Both are changes to the OOB model rather than parts of this tool, and both are prerequisites.

### 2.1 A unit may sit at zero strength
`oob_units` currently carries `CHECK ((men = 0) <> (weapons = 0))` — exactly one measure non-zero — so a unit cannot be stored empty. That makes a wiped-out battalion unrepresentable, and the tool would have to delete it, silently losing its designation, equipment, and place in the tree.

The constraint relaxes to *never both* (`men = 0 OR weapons = 0`). Zero in both is legal and means a **paper unit**: a unit that exists on the books with nobody in it. Nothing becomes ambiguous, because the measure was never carried by which column is filled — it comes from the unit's `unit_type` ([mvp-army-oob.md](mvp-army-oob.md) §2), which is why the unit form already shows one strength box labelled from the chosen type rather than two.

Paper units earn their place beyond casualties: a design ([mvp-oob-designer.md](mvp-oob-designer.md) §2) can sketch the formations a player means to raise before any of them exist, and a shattered battalion can sit at zero awaiting replacements instead of vanishing.

[mvp-oob-designer.md](mvp-oob-designer.md) §6's rule "no unit with zero total strength" is **withdrawn**. A zero-strength unit is surfaced as a notice on its row, not an error, and does not block promote-to-live. Recording *both* men and guns stays an error.

### 2.2 Upkeep scales with strength
Upkeep is currently flat per unit instance: a battalion at 140 of 1,000 men costs the same as a full one. With zero-strength units legal that becomes untenable — a planning design full of paper battalions would bill the treasury for an army that does not exist.

Upkeep becomes `type.upkeepPerTurn × currentStrength ÷ typeEstablishment`, where establishment is the type's own `men` or `weapons`. Both numbers are already in hand wherever upkeep is computed, and the type's `CHECK` guarantees the establishment is non-zero, so there is no divide-by-zero case.

The ratio is **not** capped at 1. Eight of Clan McGreggor's units are over establishment — the machine gun batteries field 50 guns against a 48-gun type — and clamping would under-report what they cost.

Effect on the seeded roster: McGreggor Army upkeep falls from 68.5 to 65.3 per turn, Portree Garrison from 10.9 to 6.01. 36 of 58 units are below establishment, so this is not a rounding-level change; it flows straight into the Turn Budget ([mvp-budget.md](mvp-budget.md)).

## 3. What the Player Supplies
Four things, in the order the flow asks for them.

**A selection** — which formations fought. Selecting a formation selects everything under it; individual units can be added or removed on top. The selection is the universe the losses spread over: nothing outside it is ever touched.

**Totals** — men and guns are **separate pools**, entered separately, because a unit is measured in one or the other and never both. Guns are the artillery and support-weapon batteries; men are everything else. Entering a gun total with no gun-counted unit selected is reported, not silently discarded.

**Weights** — the discretion. Every row in the selection carries a multiplier, default ×1, settable on formations as well as units. A formation's multiplier cascades to everything beneath it, multiplying with its children's, so "the first battalion of first division took the worst of it" is two taps rather than per-unit arithmetic. ×0 spares a unit that was present but unengaged. Presets rather than free number entry, because [mvp.md](mvp.md) §7 wants this usable on a phone: **Spared ×0 · Light ×0.5 · Normal ×1 · Heavy ×2 · Severe ×4**.

**Locks** — an exact figure, typed on any row. On a unit it fixes that unit's loss; on a formation it fixes that formation's *subtree total*, carving out a sub-pool that spreads by weight within it. Locking is what turns "6,700 across both divisions" into "4,000 of it to the first" without abandoning automatic distribution for the rest. Locked amounts leave the pool before anything else is computed.

## 4. Allocation
The core is a pure function: totals, selection, weights, locks, jitter and a seed in; a per-unit figure out. No React, no database — the same shape as `src/oob/tree.ts`, and testable under `node --test` for the same reason.

**Capacity.** Every eligible unit has a ceiling: its current strength when taking losses, its remaining room to establishment when taking reinforcements. Nothing is allocated past it.

**Weight.** A unit's share weight is `capacity × ownMultiplier × every ancestor multiplier`. Using capacity as the base is what makes the default sensible in both directions — big units bleed more, empty units fill first.

**Jitter.** Perfectly proportional maths produces exactly the neat hundreds the player is trying to avoid. Each weight is perturbed by a seeded pseudo-random factor before the split is computed: `w' = w × (1 + σ(2u − 1))`, with `u` drawn from a deterministic PRNG keyed on the seed and the unit id. Because the perturbation happens on the weights and the shares are normalised afterwards, **the total is preserved exactly** — jitter changes who bleeds, never how much was lost. Intensity is a preset: **None · Light (σ 0.15) · Normal (σ 0.35) · Heavy (σ 0.6)**. A **Reroll** button advances the seed, so a distribution the player dislikes is one tap from another that still sums correctly.

**Rounding.** Shares are real numbers; strengths are integers, and a casualty figure of 1,043 reads as false precision for something a narrative reported in the round. **Men round to the nearest 5.** The pool is divided into chunks of five and the chunks handed out by largest fractional part, so the figures sum to the entered total exactly rather than to the total minus rounding dust. Ties break on the seeded PRNG, so the same unit is not always the one that picks up the odd chunk.

Two documented exceptions keep the total exact rather than letting granularity erode it: a unit pinned at its capacity takes exactly that capacity, because a battalion with 833 men left cannot lose 835; and if the entered total is not itself a multiple of five, one unit absorbs the leftover 1–4. Everything else lands on a multiple of five.

This also keeps the roster tidy indefinitely. All 37 of Clan McGreggor's men-counted units are already multiples of five, so losses in fives leave them that way.

**Guns do not round.** They are allocated exactly, in ones. Gun counts are small and irregular — McGreggor's batteries field 1, 6, 8, 12, 18, 20, 40, 44, 48 and 50 guns — so rounding to five would let a one-gun unit lose five guns it does not have, or lose nothing at all when it is knocked out. Granularity is a property of the measure, not a setting.

**Spillover.** Any unit whose share exceeds its capacity is pinned there and removed from the pool, and the excess is redistributed over whoever is left. Repeat until nothing is over capacity. It terminates because each round pins at least one unit.

**Shortfall.** When the pool exceeds the selection's total capacity, every unit ends pinned and a remainder is left over. It is reported, never silently dropped: *"6,700 requested · 5,912 allocatable · 788 unassigned — the selected force is destroyed."* The player widens the selection or accepts the figure.

**Determinism.** Identical inputs and seed give an identical result, which is what makes the whole thing testable and keeps the preview stable while the player adjusts an unrelated row.

## 5. Reinforcements
The same engine with the sign flipped and a different ceiling: capacity is `establishment − current strength` rather than current strength, so a battalion cannot be filled past its paper strength and a unit already at establishment is skipped rather than fought over. Weights, locks, jitter, rounding and spillover are unchanged.

This is where zero-strength units pay for themselves. A battalion reduced to nothing keeps its designation, its equipment and its brigade, and comes back as itself when replacements arrive — rather than being deleted and retyped as a stranger.

## 6. The Flow
A stepped dialog over the tree, built on the existing `Dialog` shell. Steps rather than one wide table, because the preview is a per-unit grid and [mvp.md](mvp.md) §7 requires this to work on a phone.

1. **Who fought** — the formation tree with checkboxes, running totals for the selection (men, guns, units) as it changes.
2. **What it cost** — direction toggle (losses / reinforcements), the two totals, jitter preset, reroll. The share of the selected force each total represents is shown as it is typed, so a slipped digit is visible before the preview.
3. **Preview and adjust** — every affected row, `before → after`, the delta, and the percentage of its strength. Weight presets and a lock box on each row; formation rows show their subtree subtotal and take a weight or lock of their own. Wiped-out units are flagged. Any shortfall banner sits here.
4. **Apply** — writes, closes, one entry on the undo stack.

An optional free-text name ("Battle of Portree") is carried only into the undo label, so history reads `Undo: Losses — Battle of Portree` rather than `Undo: Edit unit`.

Worked example, against the seeded roster — I. Infantry Division holds 6,755 men, II. Infantry Division 6,920, 13,675 between them. Select both, enter 6,700 men, set `I/I Levy Battalion` to Heavy, leave everything else at Normal, jitter Normal. The battalion takes several hundred more than its neighbours — around 785 against their ~350 — the remainder spreads unevenly across the other men-counted units, every figure lands on a multiple of five without landing on a neat hundred, and the column sums to 6,700.

Severe on the same battalion is the more violent case, and shows the spill rule rather than the rounding one: ×4 against a 13,675-man selection puts its share past the 1,000 men it has, so it pins at capacity, is destroyed, and stays in the tree as a paper unit. The 6,700 still sums exactly across everyone else.

## 7. Applying
One transaction, so a partial write is impossible and the whole battle is one undo entry — the same guarantee a paste-import gets ([architecture.md](../tech/architecture.md) §5).

Nothing is deleted. Units that reach zero stay in the tree as paper units, per §2.1; a player who wants a destroyed battalion gone deletes it explicitly afterwards, which is a separate and separately-undoable decision rather than something the calculator makes on their behalf.

**No battle record is kept.** The tool changes unit strengths and stops there: no `battles` table, no history view, no casualty report. What happened lives in the undo stack for as long as the stack holds it, and in Discord permanently. Recording battles is a real feature with a table, a history surface and an export format of its own — see §9.

## 8. Guarantees
The properties the allocation core is tested against:

- allocated figures sum to the entered total **exactly**, whenever capacity allows;
- every men figure is a multiple of five, except a unit pinned at its capacity and the single unit absorbing a sub-five leftover;
- gun figures are exact, never rounded, however small the unit;
- no unit falls below zero, and none rises above its type's establishment on reinforcement;
- with jitter off and every multiplier at ×1, the split is proportional to capacity;
- raising a row's multiplier never decreases its share;
- locked amounts are honoured to the unit, and the remainder spreads over everything unlocked;
- the same seed reproduces the same split; a different seed changes the split but not the total;
- a shortfall is reported with its exact size rather than absorbed;
- a pool with no eligible unit in the selection is reported rather than silently zeroed.

## 9. Out of Scope
- **Battle history** — see §7. If it lands later it wants a `battles` table, a per-unit loss record, and a Discord casualty report, and that report format is blocked behind the same unanswered question as [mvp-army-oob.md](mvp-army-oob.md) §5.
- **Deciding casualties** — the app never rolls or computes how many were lost, only where they fell.
- **Navy** — army only, as everywhere else in the MVP.
- **Prisoners, wounded, stragglers** — a loss is a loss; the app does not model recovery.
- **Equipment loss** — a unit's `equipment` string is untouched, even when the unit is wiped out.

## 10. Open Questions
- Should losses be applicable to a saved design, or only to the live OOB? Designs are inert planning artifacts, which argues for live-only, but "what if this division had fought" is a plausible use.
- Is a percentage entry wanted alongside absolute totals ("II. Division took 30%"), or does the weight-and-lock pair already cover it?
- Should the jitter preset be a per-nation preference rather than a choice made every time?
- Should the rounding step for men be adjustable — 10 for a great battle, 1 for a skirmish — or is a fixed five right at every scale?
- Does a unit at zero strength need a distinct visual treatment from one merely under strength — a "cadre" badge on the row — or is the number enough?
