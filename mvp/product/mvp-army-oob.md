# Feature Spec — Order of Battle (Army)

Parent doc: [mvp.md](mvp.md), Section 5 (Key Features → MVP).

## 1. Overview
The Army Order of Battle is a persistent, structured **tree of formations** — not a flat unit list. Players build up a hierarchy (e.g. Theatre → Army → Corps → Division) and attach actual units to it; the app rolls up strength/upkeep at every level and formats the current tree into Discord-ready text on demand. Unit upkeep values are entered by the player per the game's fixed ruleset (the app does not encode that ruleset) and feed into the Turn Budget's upkeep total — see [mvp-budget.md](mvp-budget.md).

## 2. Data Model
Two kinds of node make up the tree:

- **Formation** — an organizational node: a designation/name (e.g. "5th Highland Division"), the NATO echelon tier it sits at (see below), and a parent formation (null for a top-level Theatre). A formation can have child formations, directly attached units, or both — real OOBs often have unattached "corps troops" sitting alongside sub-divisions, so units aren't forced to nest all the way down to Company.
- **Unit instance** — an actual raised unit attached to a formation: its own designation (e.g. "II/I Levy Battalion"), a reference to a unit *type* from the nation's [`land-units.yml`](../nations/template/land-units.yml) catalog (description, recruit cost, upkeep, build time already defined there), its *current* men/weapons strength, and the equipment it is actually armed with. Strength and equipment live on the instance rather than the type because units take losses between turns and because two units of the same type are frequently equipped differently (one battalion re-armed with a newer rifle while its sisters keep the old one).

Rollup: a formation's strength and upkeep = its own attached units + the rollup of every child formation, computed recursively up to the Theatre root. The export shows a subtotal at each level.

*Open: additional per-unit fields (quality/veterancy, commander, current location — see the Campaign Map open question in mvp.md)?*

## 3. Echelon Notation
Every formation sits at one of eight fixed NATO echelon tiers, labeled with the same block-count notation ("XX", "III", etc.) the player already uses in Discord. The tiers themselves are structural and shared by all nations, but each nation can rename them — see [`mvp/nations/template/echelons.yml`](../nations/template/echelons.yml). Defaults:

| Symbol | Default Name |
|---|---|
| XXXXX | Theatre |
| XXXX | Army |
| XXX | Corps |
| XX | Division |
| X | Brigade |
| III | Regiment |
| II | Battalion |
| I | Company |

A nation is free to rename any tier (e.g. Corps → "Armeekorps", Division → "Reinforced Division") without changing its position in the hierarchy.

## 4. Data File Format
The tree persists/imports as YAML — see [`mvp/nations/template/army-oob.yml`](../nations/template/army-oob.yml). It's two flat lists rather than nested YAML: a `formations` list where each entry links to its parent by `id` (deep hand-edited nesting is too easy to indent wrong), and a `units` list where each entry attaches one named unit — type, current strength, equipment — to a `formation_id`. Clan McGreggor's filled-in version is at [`mvp/nations/clan-mcgreggor/army-oob.yml`](../nations/clan-mcgreggor/army-oob.yml). This is the same paste-based import/pre-defined-nation-file split as the other trackers (see mvp.md Section 5, Starting Data Templates).

A nation can have more than one root formation (`parent_id: null`) — Clan McGreggor's field army and its Portree garrison are separate trees, since garrisons are raised and held independently of the field army.

## 5. Export Format
*To be defined.* This is the separate, read-only Discord-formatted report generated from the data above (distinct from the YAML file in Section 4, which is for import/persistence, not posting). Now scoped by the model above: the export must render the formation tree (nesting/indentation from Theatre down to leaf units) with a strength/upkeep subtotal at every formation level and a grand total at the bottom, using Discord markdown the game admin already expects.

## 6. Example Output
*To be filled in once the format above is defined.*

## 7. Open Questions
- Exact Discord layout for a nested tree — Discord markdown has no native indentation/collapsible syntax, so this needs a concrete convention (headers per level? indented list? nested blockquotes?).
- Can a nation add echelon tiers beyond the fixed eight, or is renaming the only customization?
- Does a unit ever get reassigned between formations mid-turn, and should the app version/track that change?
