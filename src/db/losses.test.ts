import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_STATEMENTS } from './schema.ts'
import {
  applyStrengthStatements,
  catalogStatements,
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
import type { Formation, Unit, UnitType, Weapon } from '../oob/types.ts'

const arsenal: Weapon[] = [
  {
    name: 'Warden Rifle',
    class: 'small_arm',
    origin: 'Clan McGreggor',
    description: '',
  },
]

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
  weapon: 'Warden Rifle',
  weaponCount: men,
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
    weapon: '',
    weaponCount: 0,
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
      ...catalogStatements(arsenal, []),
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
  assert.equal(Number(row.formation_id), 2)

  // It keeps the weapon assignment, so when replacements arrive the app
  // already knows what to ask the stockpile for.
  const [holding] = exec('SELECT * FROM oob_unit_weapons WHERE unit_id = 1')
  assert.equal(holding.weapon, 'Warden Rifle')
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

// --- Weapons go with the men, mvp-stockpile.md §2.3 ----------------------

const holdingOf = (exec: Exec, unitId: number) => {
  const row = exec('SELECT * FROM oob_unit_weapons WHERE unit_id = ?', [unitId])[0]
  return row
    ? { weapon: String(row.weapon), quantity: Number(row.quantity) }
    : null
}

test('a fully armed battalion loses its rifles with its men', () => {
  const { exec, run } = open()
  // Unit 2 is fully armed at 800 and comes out of the battle at 600.
  run(battle, 'Losses — Battle of Portree')

  assert.deepEqual(holdingOf(exec, 2), {
    weapon: 'Warden Rifle',
    quantity: 600,
  })
})

test('a wiped-out battalion keeps the assignment and none of the weapons', () => {
  const { exec, run } = open()
  run(battle, 'Losses — Battle of Portree')

  // It still reads as a Warden Rifle battalion, so when replacements arrive
  // the app already knows what to ask the stockpile for. The rifles are gone.
  assert.deepEqual(holdingOf(exec, 1), {
    weapon: 'Warden Rifle',
    quantity: 0,
  })
})

test('the weapons are destroyed, not returned to the stockpile', () => {
  const { exec, run } = open()
  const before = Number(
    exec(`SELECT quantity AS n FROM weapon_stock WHERE weapon = 'Warden Rifle'`)[0]
      .n,
  )
  run(battle, 'Losses — Battle of Portree')

  // Casualties' weapons are never salvaged. Weapons taken from an enemy are an
  // acquisition the player enters by hand.
  assert.equal(
    Number(
      exec(`SELECT quantity AS n FROM weapon_stock WHERE weapon = 'Warden Rifle'`)[0]
        .n,
    ),
    before,
  )
})

test('an under-armed battalion loses no weapons it did not have', () => {
  const { exec, run } = open()
  // 1,000 men on 80 rifles, then 400 casualties. Its holding is already below
  // the new strength, so nothing is clamped and nothing is destroyed.
  run(
    [
      {
        sql: 'UPDATE oob_unit_weapons SET quantity = 80 WHERE unit_id = 1',
      },
    ],
    'Under-arm the battalion',
  )
  run(applyStrengthStatements([{ unitId: 1, men: 600, weapons: 0 }]), 'Losses')

  assert.equal(holdingOf(exec, 1)?.quantity, 80)
})

test('reinforcements bring men and no rifles', () => {
  const { exec, run } = open()
  run(applyStrengthStatements([{ unitId: 2, men: 0, weapons: 0 }]), 'Losses')
  assert.equal(holdingOf(exec, 2)?.quantity, 0)

  run(
    applyStrengthStatements([{ unitId: 2, men: 1000, weapons: 0 }]),
    'Reinforcements',
  )
  // Filled to 1,000 and holding nothing: under-armed by 1,000, which arming is
  // a separate and deliberate draw on the stockpile.
  assert.equal(Number(exec('SELECT men FROM oob_units WHERE id = 2')[0].men), 1000)
  assert.equal(holdingOf(exec, 2)?.quantity, 0)
})

test('the clamp is inside the battle, so it is one undo entry', () => {
  const { exec, run, step } = open()
  run(battle, 'Losses — Battle of Portree')

  step('undo')
  assert.equal(holdingOf(exec, 1)?.quantity, 1000)
  assert.equal(holdingOf(exec, 2)?.quantity, 800)

  step('redo')
  assert.equal(holdingOf(exec, 1)?.quantity, 0)
  assert.equal(holdingOf(exec, 2)?.quantity, 600)
})
