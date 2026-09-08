import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_STATEMENTS } from './schema.ts'
import {
  designStatements,
  insertUnitType,
  moveFormationStatements,
  moveUnitsStatements,
  resequenceFormationStatements,
  resequenceUnitStatements,
} from './statements.ts'
import {
  beginAction,
  clearHistory,
  finishAction,
  installUndo,
  undo,
  type Exec,
} from './undo.ts'
import { buildTree } from '../oob/tree.ts'
import { canReparent } from '../oob/validate.ts'
import { DEFAULT_ECHELONS } from '../oob/types.ts'
import type { Statement } from './protocol.ts'
import type { Formation, Unit, UnitType } from '../oob/types.ts'

const catalog: UnitType[] = [
  {
    name: 'Clan Levies',
    category: 'infantry',
    description: '',
    recruitCost: 20,
    upkeepPerTurn: 0.5,
    buildTimeTurns: 1,
    men: 1000,
    weapons: 0,
  },
  {
    name: 'Field Battery',
    category: 'artillery',
    description: '',
    recruitCost: 40,
    upkeepPerTurn: 2,
    buildTimeTurns: 1,
    men: 0,
    weapons: 20,
  },
]

// 1st Army ─ 1st Division ─ 1st Brigade ─ two battalions
// 2nd Army (empty), plus three batteries held directly by 1st Army.
const formations: Formation[] = [
  { id: 1, designId: 1, parentId: null, echelon: 'XXXX', name: '1st Army', sortOrder: 0 },
  { id: 2, designId: 1, parentId: null, echelon: 'XXXX', name: '2nd Army', sortOrder: 1 },
  { id: 3, designId: 1, parentId: 1, echelon: 'XX', name: '1st Division', sortOrder: 0 },
  { id: 4, designId: 1, parentId: 3, echelon: 'X', name: '1st Brigade', sortOrder: 0 },
  { id: 5, designId: 1, parentId: 3, echelon: 'X', name: '2nd Brigade', sortOrder: 1 },
]

const battalion = (id: number, formationId: number, men: number): Unit => ({
  id,
  formationId,
  unitType: 'Clan Levies',
  designation: `Battalion ${id}`,
  men,
  weapons: 0,
  equipment: '',
  sortOrder: id,
})

const battery = (id: number, formationId: number): Unit => ({
  id,
  formationId,
  unitType: 'Field Battery',
  designation: `Battery ${id}`,
  men: 0,
  weapons: 20,
  equipment: '',
  sortOrder: id,
})

const units: Unit[] = [
  battalion(1, 4, 1000),
  battalion(2, 4, 800),
  battery(3, 1),
  battery(4, 1),
  battery(5, 1),
]

function open() {
  const db = new DatabaseSync(':memory:')
  const exec: Exec = (sql, params = []) =>
    db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[]
  for (const statement of SCHEMA_STATEMENTS) db.exec(statement)
  installUndo(exec)

  const run = (statements: Statement[], label: string) => {
    db.exec('BEGIN')
    try {
      const before = beginAction(exec)
      for (const s of statements) exec(s.sql, s.params)
      finishAction(exec, before, label)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  run(
    [
      ...catalog.map(insertUnitType),
      ...designStatements(1, 1, 1, { name: 'Live', isLive: true, formations, units }),
    ],
    'Seed',
  )
  db.exec('BEGIN')
  clearHistory(exec)
  db.exec('COMMIT')

  const read = () => {
    const f = exec('SELECT * FROM oob_formations ORDER BY sort_order, id').map(
      (r) => ({
        id: Number(r.id),
        designId: Number(r.design_id),
        parentId: r.parent_id == null ? null : Number(r.parent_id),
        echelon: String(r.echelon) as Formation['echelon'],
        name: String(r.name),
        sortOrder: Number(r.sort_order),
      }),
    )
    const u = exec('SELECT * FROM oob_units ORDER BY sort_order, id').map((r) => ({
      id: Number(r.id),
      formationId: Number(r.formation_id),
      unitType: String(r.unit_type),
      designation: String(r.designation),
      men: Number(r.men),
      weapons: Number(r.weapons),
      equipment: String(r.equipment),
      sortOrder: Number(r.sort_order),
    }))
    return { formations: f, units: u, tree: buildTree(f, u, catalog) }
  }

  return { db, exec, run, read }
}

const named = (tree: ReturnType<typeof buildTree>, name: string) => {
  const walk = (nodes: typeof tree.roots): (typeof tree.roots)[number] | undefined => {
    for (const node of nodes) {
      if (node.formation.name === name) return node
      const found = walk(node.children)
      if (found) return found
    }
    return undefined
  }
  const node = walk(tree.roots)
  assert.ok(node, `no formation named ${name}`)
  return node
}

test('a division moves between armies with its brigades and units intact', () => {
  const { run, read } = open()
  const before = read()
  assert.equal(named(before.tree, '1st Division').total.men, 1800)

  run(
    moveFormationStatements({ formationId: 3, newParentId: 2, sortOrder: 0 }),
    'Move 1st Division to 2nd Army',
  )

  const after = read()
  const division = named(after.tree, '1st Division')
  // The subtree came along untouched: nothing below the division was rewritten.
  assert.equal(division.formation.parentId, 2)
  assert.equal(division.children.length, 2)
  assert.equal(division.total.men, 1800)
  assert.equal(named(after.tree, '2nd Army').total.men, 1800)
  assert.equal(named(after.tree, '1st Army').total.men, 0)
  // Battalions still report to the brigade, not to anything that moved.
  assert.equal(
    after.units.filter((u) => u.formationId === 4).length,
    2,
  )
})

test('a brigade cannot be placed under a battalion-tier formation', () => {
  const { read } = open()
  const { formations: current } = read()
  const brigade = current.find((f) => f.name === '1st Brigade')!
  const division = current.find((f) => f.name === '1st Division')!
  const army = current.find((f) => f.name === '2nd Army')!

  assert.equal(canReparent(brigade, army, current, DEFAULT_ECHELONS).ok, true)
  // A brigade under a division is fine; the reverse is not.
  assert.equal(canReparent(division, brigade, current, DEFAULT_ECHELONS).ok, false)

  const battalionTier: Formation = {
    ...brigade,
    id: 99,
    echelon: 'II',
    name: 'A Battalion',
  }
  const result = canReparent(
    brigade,
    battalionTier,
    [...current, battalionTier],
    DEFAULT_ECHELONS,
  )
  assert.equal(result.ok, false)
  assert.match(result.ok === false ? result.reason : '', /X cannot sit under a II/)
})

test('a formation cannot be moved beneath its own descendant', () => {
  const { read } = open()
  const { formations: current } = read()
  const army = current.find((f) => f.name === '1st Army')!
  const brigade = current.find((f) => f.name === '1st Brigade')!
  const result = canReparent(army, brigade, current, DEFAULT_ECHELONS)
  assert.equal(result.ok, false)
})

test('a bulk selection of batteries reassigns in one action', () => {
  const { run, read } = open()
  run(
    moveUnitsStatements({
      unitIds: [3, 4, 5],
      targetFormationId: 5,
      startSortOrder: 0,
    }),
    'Move 3 units to 2nd Brigade',
  )

  const after = read()
  assert.equal(named(after.tree, '2nd Brigade').total.weapons, 60)
  assert.equal(named(after.tree, '1st Army').own.weapons, 0)
  // Listed order is preserved by the assigned sort_order.
  assert.deepEqual(
    after.units.filter((u) => u.formationId === 5).map((u) => u.id),
    [3, 4, 5],
  )
})

test('a bulk move is one undo step', () => {
  const { run, read, db, exec } = open()
  run(
    moveUnitsStatements({
      unitIds: [3, 4, 5],
      targetFormationId: 5,
      startSortOrder: 0,
    }),
    'Move 3 units to 2nd Brigade',
  )
  assert.equal(named(read().tree, '2nd Brigade').total.weapons, 60)

  db.exec('BEGIN')
  const label = undo(exec)
  db.exec('COMMIT')

  assert.equal(label, 'Move 3 units to 2nd Brigade')
  assert.equal(named(read().tree, '1st Army').own.weapons, 60)
  assert.equal(named(read().tree, '2nd Brigade').total.weapons, 0)
})

test('moving a formation is undoable back to its original parent', () => {
  const { run, read, db, exec } = open()
  run(
    moveFormationStatements({ formationId: 3, newParentId: 2, sortOrder: 0 }),
    'Move 1st Division to 2nd Army',
  )

  db.exec('BEGIN')
  undo(exec)
  db.exec('COMMIT')

  const after = read()
  assert.equal(named(after.tree, '1st Division').formation.parentId, 1)
  assert.equal(named(after.tree, '1st Army').total.men, 1800)
})

test('detaching a formation to the top of the tree makes it a root', () => {
  const { run, read } = open()
  run(
    moveFormationStatements({ formationId: 3, newParentId: null, sortOrder: 2 }),
    'Move 1st Division to the top of the tree',
  )

  const after = read()
  assert.deepEqual(
    after.tree.roots.map((r) => r.formation.name),
    ['1st Army', '2nd Army', '1st Division'],
  )
  assert.equal(named(after.tree, '1st Division').total.men, 1800)
})

test('resequencing siblings changes the order they render in', () => {
  const { run, read } = open()
  assert.deepEqual(
    named(read().tree, '1st Division').children.map((c) => c.formation.name),
    ['1st Brigade', '2nd Brigade'],
  )

  run(resequenceFormationStatements([5, 4]), 'Reorder formations')
  assert.deepEqual(
    named(read().tree, '1st Division').children.map((c) => c.formation.name),
    ['2nd Brigade', '1st Brigade'],
  )
})

test('resequencing units changes their order within a formation', () => {
  const { run, read } = open()
  run(resequenceUnitStatements([5, 3, 4]), 'Reorder units')
  assert.deepEqual(
    named(read().tree, '1st Army').units.map((u) => u.id),
    [5, 3, 4],
  )
})
