import { canReparent } from './validate.ts'
import type { Echelon, Formation, Unit } from './types.ts'

export type DragSubject =
  | { kind: 'formation'; id: number }
  | { kind: 'units'; ids: readonly number[] }

/** Where in a row the pointer is: nest inside it, or sit either side of it. */
export type DropZone = 'before' | 'inside' | 'after'

export type DropRef =
  | { kind: 'formation'; id: number }
  | { kind: 'unit'; id: number }

/** Stable identity for a row, for comparing the drop target during a drag. */
export const refKey = (ref: DropRef) => `${ref.kind}:${ref.id}`

export type DropPlan =
  | {
      kind: 'formation'
      formationId: number
      newParentId: number | null
      /** Every sibling under the new parent, in their resulting order. */
      orderedSiblingIds: number[]
      destination: string
    }
  | {
      kind: 'units'
      unitIds: number[]
      targetFormationId: number
      orderedUnitIds: number[]
      destination: string
    }
  | { kind: 'rejected'; reason: string }

export type DropContext = {
  formations: readonly Formation[]
  units: readonly Unit[]
  echelons: readonly Echelon[]
}

const byOrder = <T extends { sortOrder: number; id: number }>(items: T[]) =>
  items.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)

const childrenOf = (formations: readonly Formation[], parentId: number | null) =>
  byOrder(formations.filter((f) => f.parentId === parentId))

const unitsOf = (units: readonly Unit[], formationId: number) =>
  byOrder(units.filter((u) => u.formationId === formationId))

/** Inserts `id` into `ids` at `index`, having removed it from wherever it was. */
function placed(ids: number[], id: number, index: number): number[] {
  const without = ids.filter((existing) => existing !== id)
  const at = Math.max(0, Math.min(index, without.length))
  return [...without.slice(0, at), id, ...without.slice(at)]
}

/**
 * Works out what a drop means, and whether it is allowed, without touching the
 * database. Every rule the "Move to…" picker enforces applies here too, so the
 * two paths cannot disagree about what makes a valid tree.
 */
export function planDrop(
  subject: DragSubject,
  ref: DropRef,
  zone: DropZone,
  context: DropContext,
): DropPlan {
  const { formations, units, echelons } = context
  const formationById = new Map(formations.map((f) => [f.id, f]))
  const unitById = new Map(units.map((u) => [u.id, u]))

  // Resolve the row that was dropped on into a formation plus, when the row was
  // a unit, the position within it.
  let anchorFormation: Formation | undefined
  let unitAnchor: Unit | undefined
  if (ref.kind === 'formation') {
    anchorFormation = formationById.get(ref.id)
  } else {
    unitAnchor = unitById.get(ref.id)
    anchorFormation = unitAnchor
      ? formationById.get(unitAnchor.formationId)
      : undefined
  }
  if (!anchorFormation) return { kind: 'rejected', reason: 'Unknown drop target.' }

  if (subject.kind === 'units') {
    const ids = [...subject.ids]
    if (unitAnchor && ids.includes(unitAnchor.id)) {
      return { kind: 'rejected', reason: 'Already here.' }
    }

    const target = anchorFormation
    const existing = unitsOf(units, target.id)
      .map((u) => u.id)
      .filter((id) => !ids.includes(id))

    // Dropping on a unit places the selection beside it; dropping anywhere on a
    // formation row appends to that formation.
    let index = existing.length
    if (unitAnchor && unitAnchor.formationId === target.id) {
      const at = existing.indexOf(unitAnchor.id)
      if (at !== -1) index = zone === 'before' ? at : at + 1
    }

    return {
      kind: 'units',
      unitIds: ids,
      targetFormationId: target.id,
      orderedUnitIds: [
        ...existing.slice(0, index),
        ...ids,
        ...existing.slice(index),
      ],
      destination: target.name,
    }
  }

  const moving = formationById.get(subject.id)
  if (!moving) return { kind: 'rejected', reason: 'Unknown formation.' }
  if (moving.id === anchorFormation.id && zone === 'inside') {
    return { kind: 'rejected', reason: 'A formation cannot report to itself.' }
  }

  // A drop on a unit row, or into the middle of a formation row, nests. Either
  // edge of a formation row places the formation beside it under the same
  // parent.
  const nesting = zone === 'inside' || ref.kind === 'unit'

  if (nesting) {
    const verdict = canReparent(moving, anchorFormation, formations, echelons)
    if (!verdict.ok) return { kind: 'rejected', reason: verdict.reason }

    const siblings = childrenOf(formations, anchorFormation.id)
      .map((f) => f.id)
      .filter((id) => id !== moving.id)
    return {
      kind: 'formation',
      formationId: moving.id,
      newParentId: anchorFormation.id,
      orderedSiblingIds: [...siblings, moving.id],
      destination: anchorFormation.name,
    }
  }

  const newParentId = anchorFormation.parentId
  const newParent = newParentId === null ? null : formationById.get(newParentId)
  const verdict = canReparent(moving, newParent ?? null, formations, echelons)
  if (!verdict.ok) return { kind: 'rejected', reason: verdict.reason }

  const siblings = childrenOf(formations, newParentId).map((f) => f.id)
  const anchorIndex = siblings
    .filter((id) => id !== moving.id)
    .indexOf(anchorFormation.id)

  return {
    kind: 'formation',
    formationId: moving.id,
    newParentId,
    orderedSiblingIds: placed(
      siblings,
      moving.id,
      zone === 'before' ? anchorIndex : anchorIndex + 1,
    ),
    destination: newParent ? newParent.name : 'the top of the tree',
  }
}
