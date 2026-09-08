import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_STATEMENTS } from './schema.ts'
import {
  applyStrengthStatements,
  designStatements,
  insertUnitType,
} from './statements.ts'
import {
  beginAction,
  clearHistory,
  finishAction,
  installUndo,
  redo,
  undo,
  type Exec,
} from './undo.ts'
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
    name: 'Light Artillery Battery',
    category: 'artillery',
    description: '',
    recruitCost: 60,
    upkeepPerTurn: 2,
    buildTimeTurns: 2,
    men: 0,
    weapons: 20,
  },
]

const formations: Formation[] = [
  { id: 1, designId: 1, parentId: null, echelon: 'XXXX', name: 'Army', sortOrder: 0 },
  { id: 2, designId: 1, parentId: 1, echelon: 'XX', name: 'Division', sortOrder: 0 },
]

const levy = (id: number, men: number): Unit => ({
  id,
  formationId: 2,
  unitType: 'Clan Levies',
  designation: `${id}. Levy Battalion`,
  men,
  weapons: 0,
  equipment: 'Warden Rifle',
  sortOrder: id,
})

const units: Unit[] = [
  levy(1, 1000),
  levy(2, 800),
  {
    id: 3,
    formationId: 2,
    unitType: 'Light Artillery Battery',
    designation: '1st Light Artillery Battery',
    men: 0,
    weapons: 20,
    equipment: '',
    sortOrder: 3,
  },
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
      ...designStatements(1, 1, 1, {
        name: 'Live',
        isLive: true,
        formations,
        units,
      }),
    ],
    'Seed',
  )
  db.exec('BEGIN')
  clearHistory(exec)
  db.exec('COMMIT')

  const step = (name: 'undo' | 'redo') => {
    db.exec('BEGIN')
    ;(name === 'undo' ? undo : redo)(exec)
    db.exec('COMMIT')
  }

  const strengths = () =>
    exec('SELECT id, men, weapons FROM oob_units ORDER BY id').map((row) => [
      Number(row.men),
      Number(row.weapons),
    ])

  return { exec, run, step, strengths }
}

// The battle of the fixture: 1,200 men off the two battalions and 6 guns off
// the battery, with the first battalion wiped out entirely.
const battle = applyStrengthStatements([
  { unitId: 1, men: 0, weapons: 0 },
  { unitId: 2, men: 600, weapons: 0 },
  { unitId: 3, men: 0, weapons: 14 },
])

test('a battle writes every affected unit at once', () => {
  const { run, strengths } = open()
  run(battle, 'Losses — Battle of Portree')
  assert.deepEqual(strengths(), [
    [0, 0],
    [600, 0],
    [0, 14],
  ])
})

test('a wiped-out unit stays in the tree as a paper unit', () => {
  const { exec, run } = open()
  run(battle, 'Losses — Battle of Portree')
  const [row] = exec('SELECT * FROM oob_units WHERE id = 1')
  assert.ok(row, 'the battalion should still exist')
  assert.equal(Number(row.men), 0)
  assert.equal(row.designation, '1. Levy Battalion')
  assert.equal(row.equipment, 'Warden Rifle')
  assert.equal(Number(row.formation_id), 2)
})

test('one undo restores every affected unit, and redo reapplies it', () => {
  const { run, step, strengths } = open()
  const before = strengths()

  run(battle, 'Losses — Battle of Portree')
  assert.notDeepEqual(strengths(), before)

  step('undo')
  assert.deepEqual(strengths(), before)

  step('redo')
  assert.deepEqual(strengths(), [
    [0, 0],
    [600, 0],
    [0, 14],
  ])
})

test('the battle name reaches the undo label', () => {
  const { exec, run } = open()
  run(battle, 'Losses — Battle of Portree')
  const [row] = exec(
    `SELECT label FROM undo_actions WHERE stack = 'undo' ORDER BY id DESC LIMIT 1`,
  )
  assert.equal(row.label, 'Losses — Battle of Portree')
})

test('reinforcements go through the same path', () => {
  const { run, strengths } = open()
  run(
    applyStrengthStatements([
      { unitId: 1, men: 1000, weapons: 0 },
      { unitId: 2, men: 1000, weapons: 0 },
    ]),
    'Reinforcements — spring draft',
  )
  assert.deepEqual(strengths(), [
    [1000, 0],
    [1000, 0],
    [0, 20],
  ])
})

test('a write that would record both measures is refused whole', () => {
  const { run, strengths } = open()
  const before = strengths()
  assert.throws(
    () =>
      run(
        applyStrengthStatements([
          { unitId: 2, men: 600, weapons: 0 },
          { unitId: 1, men: 500, weapons: 5 },
        ]),
        'Losses',
      ),
    /CHECK/i,
  )
  // The transaction rolled back, so the first unit's write went with it.
  assert.deepEqual(strengths(), before)
})
