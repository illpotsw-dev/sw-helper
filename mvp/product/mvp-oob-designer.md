# Feature Spec — OOB Designer

Parent doc: [mvp.md](mvp.md), Section 5 (Key Features → MVP).
Data model and file format: [mvp-army-oob.md](mvp-army-oob.md).

## 1. Overview
The OOB Designer is the interactive surface for building and rearranging a formation tree. It serves two jobs that share one editor:

- **Maintaining the live OOB** — the roster that feeds the Turn Budget's upkeep and the Discord export.
- **Designing a "dream" OOB** — sketching a reorganization or a force you'd like to raise, without disturbing the roster you report each turn.

Army only for MVP. Whether fleets get the same treatment is still open in [mvp-navy-oob.md](mvp-navy-oob.md); nothing here forecloses it, since the tree model isn't army-specific.

## 2. Designs and the Live OOB
Exactly one OOB is **live** at a time. Any number of **designs** sit alongside it — each a named, independently editable copy of a formation tree and its units. Designs are inert: they never contribute upkeep to the Budget and are never exported to Discord as the nation's OOB.

Operations:
- **New design** — blank, or duplicated from the live OOB (the common start: "what if I reorganized this?").
- **Duplicate / rename / delete** a design.
- **Promote to live** — replaces the live OOB with the design. Destructive, so it confirms first, and the outgoing live OOB is automatically saved as a design named e.g. "Previous OOB — 1442-03" so a promote is never a one-way door.

A design records why it exists (free-text note) — "post-war reorganization", "if we win Portree" — since a player may keep several and needs to tell them apart.

## 3. Editing
The editor presents the tree with formations as nodes and units as leaves, each row showing its designation, echelon symbol, and rolled-up strength.

**Formations** — add (name + echelon + parent), rename, change echelon, delete. Deleting a formation that has children prompts for which of two things to do: promote the children up to the deleted formation's parent, or delete the subtree entirely. Never silently orphan.

**Units** — add (designation + type from the nation's `land-units.yml` + strength + equipment), edit inline, delete. Because strength and equipment live on the instance ([mvp-army-oob.md](mvp-army-oob.md) §2), editing a unit never touches the catalog and never affects its sibling units.

A unit can attach to a formation at any tier, not just the bottom one — the Army Reserve batteries hanging directly off Clan McGreggor's Army (XXXX) are the reference case.

## 4. Reorganizing
The distinguishing operation. Moving a formation carries its entire subtree with it.

- **Move** a formation to a new parent, or a unit to a new formation.
- **Bulk move** — select several units and reassign them in one action. Reorganizing is mostly this: shuffling batteries and battalions between brigades.
- **Reorder** siblings, since export order is roster order and players care about it.
- **Detach to root** — make a formation independent (`parent_id: null`), for garrisons and detached commands split off from the field army.

Two interaction paths, both always available: drag-and-drop, and an explicit "Move to…" picker. The picker is the primary path rather than a fallback — [mvp.md](mvp.md) §7 requires mobile-friendliness, and dragging a node across a deep tree on a phone is unusable.

The picker only offers **valid** destinations, greying out the rest with the reason. This makes invalid trees unreachable rather than detectable: a Brigade can't be dropped under a Battalion because the target never becomes droppable. Same rule for drag-and-drop.

**Redesignation after a move is not automatic.** Moving `II/I Levy Battalion` under the 3rd Brigade leaves its name untouched even though the naming convention now implies `II/III`. The app offers a rename suggestion; it does not rewrite a player's designations for them.

## 5. Cost Feedback
Every formation row shows its rolled-up men, guns, and upkeep per turn, computed recursively (see [mvp-army-oob.md](mvp-army-oob.md) §2).

For designs specifically, the editor shows the **delta against the live OOB** — this is the point of designing a dream OOB:
- change in upkeep per turn, the recurring cost of adopting the design;
- total recruit cost of the units the design adds, the one-off cost to get there;
- longest build time among added units, as a rough "turns to realize".

Upkeep and recruit costs come from the nation's catalog, so a design referencing types with placeholder costs reports figures that are only as good as that catalog. Units whose type carries an unreviewed placeholder cost are marked in the rollup so the total isn't read as authoritative.

## 6. Validation
Checked continuously while editing and enforced at import and promote-to-live:

- formation ids unique; every `parent_id` resolves; no cycles;
- a formation's echelon strictly below its parent's (`echelons.yml` `level` ordering);
- every unit's `unit_type` matches a catalog entry exactly — no normalization, no case-folding, no fuzzy matching;
- men/guns exclusivity — artillery and support_weapons carry guns and 0 men, all other types the reverse;
- no unit with zero total strength.

Multiple roots are legal, not an error — Clan McGreggor's field army and Portree garrison are separate trees.

Violations are surfaced inline on the offending row while editing. A design is allowed to sit in a broken state (you're mid-reorganization); **promote to live is blocked** until it validates.

## 7. Import
Accepts pasted `army-oob.yml` text conforming to [the template](../nations/template/army-oob.yml). Paste-based, not file upload, per [mvp.md](mvp.md) §7.

**Unit types are a prerequisite, not part of the OOB import.** A player defines their nation's catalog first (`land-units.yml`), and only then imports an OOB against it. Every `unit_type` in the pasted OOB must match a catalog entry **exactly** — any that doesn't fails the whole import. Nothing is auto-created, nothing is fuzzy-matched into place, and no partial import is committed.

This is a strict rule by choice. A mismatch is nearly always a typo or AI drift rather than a genuinely missing type — the Clan McGreggor roster said `Clan Guard Elite Battalion` where the catalog said `Clan's Guard` — and quietly resolving it would either bury the typo or invent a catalog entry with fabricated costs that then flow into the Budget.

Flow: parse → validate → **preview the tree** → choose target → commit. The preview matters; a player pasting an AI-generated roster needs to see what they're about to get before it lands.

Import targets a **new design** by default rather than the live OOB, so a bad paste can't destroy the roster being reported each turn. Overwriting the live OOB is available but confirms.

Failures list every problem at once rather than stopping at the first, so a player fixes their YAML in one pass instead of discovering errors one at a time. Unresolved `unit_type` values are reported with their nearest catalog match as advisory text ("`Clan Guard Elite Battalion` — no such unit type; closest is `Clan's Guard`"). The suggestion is diagnostic only: the player corrects the source and re-pastes, and the app never rewrites it for them. If the catalog is empty, the import fails with a message pointing at the define-your-unit-types step rather than a list of every unresolved name.

## 8. Export
- **YAML** — the current tree in `army-oob.yml` format, copied to clipboard. Round-trips: exported YAML re-imports unchanged. Works on designs too, so a player can share a proposed OOB with an ally ([mvp.md](mvp.md) §3 notes OOB sharing between allies is a real use).
- **Discord markdown** — the formatted report, per [mvp-army-oob.md](mvp-army-oob.md) §5. Format still to be defined there.

## 9. Stored Schema
The flat `army_units` table that predated the hierarchical model has been replaced by `echelons`, `unit_types`, `oob_designs`, `oob_formations`, and `oob_units` — see [architecture.md](../tech/architecture.md) §4 for the table-by-table description and `src/db/schema.ts` for the definitions.

Most of this spec's validation rules (§6) are enforced by the database rather than only in application code: the exact `unit_type` match of §7 is a foreign key, the single live OOB of §2 is a partial unique index, and men/guns exclusivity is a `CHECK`. Two rules remain in application code because a `CHECK` cannot read another row — that a formation's echelon sits strictly below its parent's, and that a unit's men/guns choice matches the one its type uses.

## 10. Open Questions
- Can a design be diffed against the live OOB structurally (which formations moved, which units were added), or is the cost delta in §5 enough?
- Should promote-to-live be all-or-nothing, or can a player promote one branch of a design (e.g. adopt the reorganized II. Division, leave the rest)?
- Is there a cap on saved designs? Unbounded designs in OPFS storage is fine numerically but clutters the switcher.
- Does the designer need to represent units that are ordered but not yet built (build time in progress), or is that the Budget's concern?
