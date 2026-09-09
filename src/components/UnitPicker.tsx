import { flatten, unitIdsUnder } from '../oob/tree.ts'
import type { Tree, TreeNode } from '../oob/tree.ts'
import type { Unit } from '../oob/types.ts'

const count = (value: number) => value.toLocaleString('en-US')

const indent = (depth: number) => `${0.5 + Math.min(depth, 5) * 0.85}rem`

const rowStyles =
  'flex items-center gap-2 py-1 pr-2 text-sm hover:bg-slate-50'

/**
 * The formation tree with a checkbox on every row, checking a formation
 * checking everything under it.
 *
 * Its own component rather than an extension of OobTree: that tree carries a
 * unit-only selection for bulk moves which means something different, and
 * entangling the two would make both harder to reason about. Shared between
 * the battle and re-arm dialogs, which pose the same question — who is this
 * about? — and want the same answer to look the same.
 */
export function UnitPicker({
  tree,
  selected,
  onChange,
  /** The right-hand column on a unit row. Strength, by default. */
  detail,
  /** Rows that cannot be chosen, and why — a weapon their measure cannot take. */
  ineligible,
}: {
  tree: Tree
  selected: ReadonlySet<number>
  onChange: (next: ReadonlySet<number>) => void
  detail?: (unit: Unit) => string
  ineligible?: (unit: Unit) => string | null
}) {
  const rows = flatten(tree)

  const blocked = new Set<number>()
  if (ineligible) {
    for (const row of rows) {
      if (row.kind === 'unit' && ineligible(row.unit) !== null) {
        blocked.add(row.unit.id)
      }
    }
  }

  const toggleUnit = (id: number) => {
    const next = new Set(selected)
    if (!next.delete(id)) next.add(id)
    onChange(next)
  }

  const toggleFormation = (node: TreeNode) => {
    const ids = unitIdsUnder(node).filter((id) => !blocked.has(id))
    const next = new Set(selected)
    const all = ids.length > 0 && ids.every((id) => next.has(id))
    for (const id of ids) {
      if (all) next.delete(id)
      else next.add(id)
    }
    onChange(next)
  }

  const strength = (unit: Unit) =>
    unit.men
      ? `${count(unit.men)} men`
      : unit.weapons
        ? `${count(unit.weapons)} guns`
        : 'paper'

  return (
    <div className="max-h-[45vh] overflow-y-auto rounded border border-slate-200">
      {rows.map((row) => {
        if (row.kind === 'formation') {
          // A formation's tally counts only what could be chosen, so a brigade
          // of batteries does not read as 0/5 while a small arm is selected.
          const ids = unitIdsUnder(row.node).filter((id) => !blocked.has(id))
          const chosen = ids.filter((id) => selected.has(id)).length
          return (
            <label
              key={`f${row.node.formation.id}`}
              className={rowStyles}
              style={{ paddingLeft: indent(row.depth) }}
            >
              <input
                type="checkbox"
                className="shrink-0"
                checked={ids.length > 0 && chosen === ids.length}
                ref={(box) => {
                  if (box) box.indeterminate = chosen > 0 && chosen < ids.length
                }}
                disabled={ids.length === 0}
                onChange={() => toggleFormation(row.node)}
              />
              <span className="shrink-0 rounded border border-slate-300 bg-slate-50 px-1 py-0.5 font-mono text-[0.6rem] leading-none text-slate-600">
                {row.node.formation.echelon}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {row.node.formation.name}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-slate-500">
                {chosen}/{ids.length}
              </span>
            </label>
          )
        }

        const reason = ineligible?.(row.unit) ?? null
        return (
          <label
            key={`u${row.unit.id}`}
            title={reason ?? undefined}
            className={`${rowStyles} ${reason ? 'opacity-40' : ''}`}
            style={{ paddingLeft: indent(row.depth) }}
          >
            <input
              type="checkbox"
              className="shrink-0"
              checked={selected.has(row.unit.id)}
              disabled={reason !== null}
              onChange={() => toggleUnit(row.unit.id)}
            />
            <span className="min-w-0 flex-1 truncate text-slate-700">
              {row.unit.designation}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-slate-500">
              {reason ?? detail?.(row.unit) ?? strength(row.unit)}
            </span>
          </label>
        )
      })}
    </div>
  )
}
