/**
 * Which units are ticked, and where a shift-click ranges from.
 *
 * `anchor` remembers both the last row clicked without shift and the selection
 * as it stood right after that click. Re-deriving each range from that base is
 * what lets a range shrink: shift-clicking back towards the anchor drops the
 * rows you moved past instead of leaving them stuck on.
 */
export type Selection = {
  ids: ReadonlySet<number>
  anchor: { id: number; base: ReadonlySet<number> } | null
}

export const emptySelection = (): Selection => ({ ids: new Set(), anchor: null })

/** The slice of `ids` between the two endpoints, inclusive, either direction. */
function between(
  ids: readonly number[],
  from: number,
  to: number,
): number[] {
  const start = ids.indexOf(from)
  const end = ids.indexOf(to)
  // An endpoint that is not on screen — the anchor's formation was collapsed
  // after it was set, say — has no range to speak of.
  if (start === -1 || end === -1) return []
  return ids.slice(Math.min(start, end), Math.max(start, end) + 1)
}

/**
 * A click on a unit's checkbox. `extend` is a shift-click, which selects every
 * visible unit from the anchor to this one and leaves the anchor where it is,
 * so a second shift-click re-ranges from the same place.
 */
export function selectUnit(
  current: Selection,
  unitId: number,
  extend: boolean,
  visibleUnitIds: readonly number[],
): Selection {
  if (extend && current.anchor) {
    const range = between(visibleUnitIds, current.anchor.id, unitId)
    // With no usable range — a stale anchor — the shift is ignored and the
    // click falls through to a plain toggle rather than doing nothing at all.
    if (range.length) {
      return {
        ids: new Set([...current.anchor.base, ...range]),
        anchor: current.anchor,
      }
    }
  }

  const ids = new Set(current.ids)
  if (!ids.delete(unitId)) ids.add(unitId)
  return { ids, anchor: { id: unitId, base: ids } }
}

/**
 * Everything on screen, ticked. No anchor: a range from the top of a whole-tree
 * selection would only ever shrink it, so the next shift-click is left to
 * behave as an ordinary click and set its own anchor.
 */
export const selectAll = (visibleUnitIds: readonly number[]): Selection => ({
  ids: new Set(visibleUnitIds),
  anchor: null,
})
