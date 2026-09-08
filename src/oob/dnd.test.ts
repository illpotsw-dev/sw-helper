import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planDrop, type DropContext } from './dnd.ts'
import { DEFAULT_ECHELONS } from './types.ts'
import type { Formation, Unit } from './types.ts'

// 1st Army ─ 1st Division ─ 1st Brigade, 2nd Brigade
//          ─ 2nd Division
// 2nd Army (empty)
const formations: Formation[] = [
  { id: 1, designId: 1, parentId: null, echelon: 'XXXX', name: '1st Army', sortOrder: 0 },
  { id: 2, designId: 1, parentId: null, echelon: 'XXXX', name: '2nd Army', sortOrder: 1 },
  { id: 3, designId: 1, parentId: 1, echelon: 'XX', name: '1st Division', sortOrder: 0 },
  { id: 4, designId: 1, parentId: 1, echelon: 'XX', name: '2nd Division', sortOrder: 1 },
  { id: 5, designId: 1, parentId: 3, echelon: 'X', name: '1st Brigade', sortOrder: 0 },
  { id: 6, designId: 1, parentId: 3, echelon: 'X', name: '2nd Brigade', sortOrder: 1 },
]

const unit = (id: number, formationId: number, sortOrder: number): Unit => ({
  id,
  formationId,
  unitType: 'Clan Levies',
  designation: `Battalion ${id}`,
  men: 500,
  weapons: 0,
  equipment: '',
  sortOrder,
})

const units: Unit[] = [
  unit(10, 5, 0),
  unit(11, 5, 1),
  unit(12, 5, 2),
  unit(20, 6, 0),
]

const context: DropContext = { formations, units, echelons: DEFAULT_ECHELONS }

const plan = (
  subject: Parameters<typeof planDrop>[0],
  ref: Parameters<typeof planDrop>[1],
  zone: Parameters<typeof planDrop>[2],
) => planDrop(subject, ref, zone, context)

test('dropping a formation into another nests it there', () => {
  const result = plan(
    { kind: 'formation', id: 5 },
    { kind: 'formation', id: 4 },
    'inside',
  )
  assert.equal(result.kind, 'formation')
  if (result.kind !== 'formation') return
  assert.equal(result.newParentId, 4)
  assert.deepEqual(result.orderedSiblingIds, [5])
  assert.equal(result.destination, '2nd Division')
})

test('dropping on the edge of a row places it beside that row', () => {
  const before = plan(
    { kind: 'formation', id: 6 },
    { kind: 'formation', id: 5 },
    'before',
  )
  assert.equal(before.kind, 'formation')
  if (before.kind !== 'formation') return
  assert.equal(before.newParentId, 3)
  assert.deepEqual(before.orderedSiblingIds, [6, 5])

  const after = plan(
    { kind: 'formation', id: 5 },
    { kind: 'formation', id: 6 },
    'after',
  )
  assert.equal(after.kind, 'formation')
  if (after.kind !== 'formation') return
  assert.deepEqual(after.orderedSiblingIds, [6, 5])
})

test('dropping beside a root formation keeps it at the top of the tree', () => {
  const result = plan(
    { kind: 'formation', id: 3 },
    { kind: 'formation', id: 2 },
    'after',
  )
  assert.equal(result.kind, 'formation')
  if (result.kind !== 'formation') return
  assert.equal(result.newParentId, null)
  assert.deepEqual(result.orderedSiblingIds, [1, 2, 3])
  assert.equal(result.destination, 'the top of the tree')
})

test('a drop that would invert the echelons is rejected with a reason', () => {
  const result = plan(
    { kind: 'formation', id: 3 },
    { kind: 'formation', id: 5 },
    'inside',
  )
  assert.equal(result.kind, 'rejected')
  if (result.kind !== 'rejected') return
  assert.match(result.reason, /already below/)
})

test('a formation cannot be dropped onto an equal tier', () => {
  const result = plan(
    { kind: 'formation', id: 3 },
    { kind: 'formation', id: 4 },
    'inside',
  )
  assert.equal(result.kind, 'rejected')
  if (result.kind !== 'rejected') return
  assert.match(result.reason, /XX cannot sit under a XX/)
})

test('a formation cannot be dropped into itself', () => {
  const result = plan(
    { kind: 'formation', id: 3 },
    { kind: 'formation', id: 3 },
    'inside',
  )
  assert.equal(result.kind, 'rejected')
})

test('dropping a formation on a unit row nests it in that unit formation', () => {
  const result = plan(
    { kind: 'formation', id: 6 },
    { kind: 'unit', id: 20 },
    'before',
  )
  // Unit 20 belongs to 2nd Brigade (6) — dropping 6 into itself is refused.
  assert.equal(result.kind, 'rejected')

  const ok = plan({ kind: 'formation', id: 5 }, { kind: 'unit', id: 20 }, 'before')
  assert.equal(ok.kind, 'rejected') // X under X
})

test('dropping units on a formation row appends them there', () => {
  const result = plan(
    { kind: 'units', ids: [10, 11] },
    { kind: 'formation', id: 6 },
    'inside',
  )
  assert.equal(result.kind, 'units')
  if (result.kind !== 'units') return
  assert.equal(result.targetFormationId, 6)
  assert.deepEqual(result.orderedUnitIds, [20, 10, 11])
})

test('dropping units beside another unit places them at that position', () => {
  const before = plan({ kind: 'units', ids: [12] }, { kind: 'unit', id: 10 }, 'before')
  assert.equal(before.kind, 'units')
  if (before.kind !== 'units') return
  assert.equal(before.targetFormationId, 5)
  assert.deepEqual(before.orderedUnitIds, [12, 10, 11])

  const after = plan({ kind: 'units', ids: [10] }, { kind: 'unit', id: 12 }, 'after')
  assert.equal(after.kind, 'units')
  if (after.kind !== 'units') return
  assert.deepEqual(after.orderedUnitIds, [11, 12, 10])
})

test('dropping units onto one of themselves is refused', () => {
  const result = plan(
    { kind: 'units', ids: [10, 11] },
    { kind: 'unit', id: 11 },
    'before',
  )
  assert.equal(result.kind, 'rejected')
})

test('a multi-unit drop keeps the selection contiguous and ordered', () => {
  const result = plan(
    { kind: 'units', ids: [10, 12] },
    { kind: 'unit', id: 20 },
    'after',
  )
  assert.equal(result.kind, 'units')
  if (result.kind !== 'units') return
  assert.equal(result.targetFormationId, 6)
  assert.deepEqual(result.orderedUnitIds, [20, 10, 12])
})

test('moving a formation among its siblings does not duplicate it', () => {
  const result = plan(
    { kind: 'formation', id: 5 },
    { kind: 'formation', id: 6 },
    'after',
  )
  assert.equal(result.kind, 'formation')
  if (result.kind !== 'formation') return
  assert.deepEqual(result.orderedSiblingIds, [6, 5])
  assert.equal(new Set(result.orderedSiblingIds).size, 2)
})
