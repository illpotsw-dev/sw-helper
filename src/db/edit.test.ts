import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_STATEMENTS } from './schema.ts'
import {
  canPromote,
  catalogStatements,
  deleteFormationStatements,
  designStatements,
  insertUnitType,
} from './statements.ts'
import {
  beginAction,
  clearHistory,
  installUndo,
  undo,
  type Exec,
} from './undo.ts'
import { finishAction } from './undo.ts'
import type { Statement } from './protocol.ts'
import type { Formation, Unit, UnitType, Weapon } from '../oob/types.ts'

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
]

const arsenal: Weapon[] = [
  {
    name: 'Warden Rifle',
    class: 'small_arm',
    origin: 'Clan McGreggor',
    description: '',
  },
]

// Army (1) ─ Division (2) ─ Brigade (3)
//   Division also holds a unit directly, as "division troops".
const formations: Formation[] = [
  { id: 1, designId: 1, parentId: null, echelon: 'XXXX', name: 'Army', sortOrder: 0 },
  { id: 2, designId: 1, parentId: 1, echelon: 'XX', name: 'Division', sortOrder: 0 },
  { id: 3, designId: 1, parentId: 2, echelon: 'X', name: 'Brigade', sortOrder: 0 },
]
const units: Unit[] = [
  {
    id: 1,
    formationId: 3,
    unitType: 'Clan Levies',
    designation: 'I/I Levy Battalion',
    men: 1000,
    weapons: 0,
    weapon: 'Warden Rifle',
    weaponCount: 1000,
    sortOrder: 0,
  },
  {
    id: 2,
    formationId: 2,
    unitType: 'Clan Levies',
    designation: 'Division Troops',
    men: 500,
    weapons: 0,
    weapon: 'Warden Rifle',
    weaponCount: 500,
    sortOrder: 1,
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
      ...catalogStatements(arsenal, [{ weapon: 'Warden Rifle', quantity: 400 }]),
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

  const ids = (table: string, where: string, params: unknown[] = []) =>
    exec(`SELECT id FROM ${table} WHERE ${where}`, params).map((r) => Number(r.id))

  return { db, exec, run, ids }
}

test('deleting a subtree takes the formations and units below it', () => {
  const { exec, run } = open()
  run(
    deleteFormationStatements({
      formationId: 2,
      parentId: 1,
      mode: 'subtree',
      childFormationIds: [3],
      attachedUnitIds: [2],
    }),
    'Delete Division and everything under it',
  )

  assert.deepEqual(
    exec('SELECT id FROM oob_formations ORDER BY id').map((r) => Number(r.id)),
    [1],
  )
  assert.equal(Number(exec('SELECT count(*) AS n FROM oob_units')[0].n), 0)
})

test('promoting moves children and attached units up to the parent', () => {
  const { exec, run } = open()
  run(
    deleteFormationStatements({
      formationId: 2,
      parentId: 1,
      mode: 'promote',
      childFormationIds: [3],
      attachedUnitIds: [2],
    }),
    'Delete Division',
  )

  // The brigade survives, now reporting to the army.
  assert.equal(
    Number(exec('SELECT parent_id FROM oob_formations WHERE id = 3')[0].parent_id),
    1,
  )
  // Its own unit is untouched; the division's unit moved to the army.
  assert.equal(
    Number(exec('SELECT formation_id FROM oob_units WHERE id = 1')[0].formation_id),
    3,
  )
  assert.equal(
    Number(exec('SELECT formation_id FROM oob_units WHERE id = 2')[0].formation_id),
    1,
  )
  assert.equal(Number(exec('SELECT count(*) AS n FROM oob_units')[0].n), 2)
})

test('promoting out of a root formation is refused rather than dropping units', () => {
  // The army has no parent, so its units have nowhere to go. Deleting the
  // subtree is the only honest option, and canPromote says so.
  assert.equal(canPromote(null, 1), false)
  assert.equal(canPromote(null, 0), true)
  assert.equal(canPromote(1, 3), true)

  assert.throws(
    () =>
      deleteFormationStatements({
        formationId: 1,
        parentId: null,
        mode: 'promote',
        childFormationIds: [2],
        attachedUnitIds: [9],
      }),
    /nowhere to report/,
  )
})

test('promoting a root with no units of its own makes its children roots', () => {
  const { exec, run } = open()
  run(
    deleteFormationStatements({
      formationId: 1,
      parentId: null,
      mode: 'promote',
      childFormationIds: [2],
      attachedUnitIds: [],
    }),
    'Delete Army',
  )
  assert.equal(exec('SELECT parent_id FROM oob_formations WHERE id = 2')[0].parent_id, null)
})

test('a delete is undoable, subtree and all', () => {
  const { exec, run, db } = open()
  run(
    deleteFormationStatements({
      formationId: 2,
      parentId: 1,
      mode: 'subtree',
      childFormationIds: [3],
      attachedUnitIds: [2],
    }),
    'Delete Division and everything under it',
  )
  assert.equal(Number(exec('SELECT count(*) AS n FROM oob_formations')[0].n), 1)

  db.exec('BEGIN')
  const label = undo(exec)
  db.exec('COMMIT')

  assert.equal(label, 'Delete Division and everything under it')
  assert.equal(Number(exec('SELECT count(*) AS n FROM oob_formations')[0].n), 3)
  assert.equal(Number(exec('SELECT count(*) AS n FROM oob_units')[0].n), 2)
  assert.equal(
    Number(exec('SELECT parent_id FROM oob_formations WHERE id = 3')[0].parent_id),
    2,
  )
})

test('a promote is undoable, putting the children back where they were', () => {
  const { exec, run, db } = open()
  run(
    deleteFormationStatements({
      formationId: 2,
      parentId: 1,
      mode: 'promote',
      childFormationIds: [3],
      attachedUnitIds: [2],
    }),
    'Delete Division',
  )

  db.exec('BEGIN')
  undo(exec)
  db.exec('COMMIT')

  assert.equal(
    Number(exec('SELECT parent_id FROM oob_formations WHERE id = 3')[0].parent_id),
    2,
  )
  assert.equal(
    Number(exec('SELECT formation_id FROM oob_units WHERE id = 2')[0].formation_id),
    2,
  )
})

test('a unit cannot record both men and guns', () => {
  const { exec } = open()
  assert.throws(
    () => exec('UPDATE oob_units SET weapons = 12 WHERE id = 1'),
    /CHECK/i,
  )
  assert.throws(
    () => exec('UPDATE oob_units SET men = -5 WHERE id = 1'),
    /CHECK/i,
  )
})

test('a wiped-out unit is stored at zero rather than deleted', () => {
  const { exec } = open()
  exec('UPDATE oob_units SET men = 0 WHERE id = 1')
  const [row] = exec('SELECT men, designation FROM oob_units WHERE id = 1')
  assert.equal(Number(row.men), 0)
  assert.ok(row.designation)
})

test('a unit cannot be edited onto a type outside the catalog', () => {
  const { exec } = open()
  assert.throws(
    () => exec(`UPDATE oob_units SET unit_type = 'Nope' WHERE id = 1`),
    /FOREIGN KEY/i,
  )
})
