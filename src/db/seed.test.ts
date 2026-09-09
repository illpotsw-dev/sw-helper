import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_STATEMENTS } from './schema.ts'
import {
  catalogStatements,
  designStatements,
  insertUnitType,
} from './statements.ts'
import {
  beginAction,
  clearHistory,
  finishAction,
  historyState,
  installUndo,
  redo,
  undo,
  type Exec,
} from './undo.ts'
import { buildTree } from '../oob/tree.ts'
import { errorsOnly, validate } from '../oob/validate.ts'
import { DEFAULT_ECHELONS } from '../oob/types.ts'
import type { Unit } from '../oob/types.ts'
import { mcgreggor } from '../oob/fixture.test-helper.ts'
import type { Statement } from './protocol.ts'

/**
 * Runs the same statements the app issues, against the same schema, so the
 * constraints are real: the unit_type foreign key, the men-or-guns CHECK, and
 * the single-live-design index all apply here exactly as they do in a browser.
 */
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

  const inTransaction = <T,>(body: () => T): T => {
    db.exec('BEGIN')
    try {
      const result = body()
      db.exec('COMMIT')
      return result
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  return { db, exec, run, inTransaction }
}

const roster = mcgreggor()

/** Units as the domain sees them, with each one's holding joined back on. */
function readUnits(exec: Exec): Unit[] {
  const holdings = new Map(
    exec('SELECT * FROM oob_unit_weapons').map((row) => [
      Number(row.unit_id),
      { weapon: String(row.weapon), quantity: Number(row.quantity) },
    ]),
  )
  return exec('SELECT * FROM oob_units ORDER BY sort_order, id').map((row) => ({
    id: Number(row.id),
    formationId: Number(row.formation_id),
    unitType: String(row.unit_type),
    designation: String(row.designation),
    men: Number(row.men),
    weapons: Number(row.weapons),
    weapon: holdings.get(Number(row.id))?.weapon ?? '',
    weaponCount: holdings.get(Number(row.id))?.quantity ?? 0,
    sortOrder: Number(row.sort_order),
  }))
}

const seedStatements = (): Statement[] => [
  ...roster.unitTypes.map(insertUnitType),
  ...catalogStatements(roster.weapons, roster.stock),
  ...designStatements(1, 1, 1, {
    name: 'Order of Battle',
    isLive: true,
    formations: roster.formations,
    units: roster.units,
  }),
]

test("Clan McGreggor's roster satisfies every database constraint", () => {
  const { run, exec } = open()
  run(seedStatements(), 'Load Clan McGreggor')

  assert.equal(Number(exec('SELECT count(*) AS n FROM unit_types')[0].n), 11)
  assert.equal(Number(exec('SELECT count(*) AS n FROM oob_formations')[0].n), 15)
  assert.equal(Number(exec('SELECT count(*) AS n FROM oob_units')[0].n), 58)
})

test('the roster survives a round trip through SQLite unchanged', () => {
  const { run, exec } = open()
  run(seedStatements(), 'Load Clan McGreggor')

  const formations = exec(
    'SELECT * FROM oob_formations ORDER BY sort_order, id',
  ).map((row) => ({
    id: Number(row.id),
    designId: Number(row.design_id),
    parentId: row.parent_id == null ? null : Number(row.parent_id),
    echelon: String(row.echelon) as (typeof DEFAULT_ECHELONS)[number]['symbol'],
    name: String(row.name),
    sortOrder: Number(row.sort_order),
  }))
  const units = readUnits(exec)

  const tree = buildTree(formations, units, roster.unitTypes)
  assert.deepEqual(
    tree.roots.map((r) => r.formation.name),
    ['McGreggor Army', 'Portree Garrison'],
  )
  assert.equal(tree.roots[0].total.men, 28080)
  assert.equal(tree.roots[0].total.weapons, 506)
  assert.equal(tree.roots[1].total.men, 3400)
  assert.deepEqual(
    errorsOnly(
      validate({
        formations,
        units,
        unitTypes: roster.unitTypes,
        echelons: DEFAULT_ECHELONS,
        weapons: roster.weapons,
        stock: roster.stock,
      }),
    ),
    [],
  )
})

test('a unit naming a type outside the catalog is refused', () => {
  const { run } = open()
  const statements = seedStatements()
  const lastUnit = statements.findLast((s) => s.sql.includes('INSERT INTO oob_units'))
  assert.ok(lastUnit)
  // The drift the exact-match rule exists to catch.
  lastUnit.params = [...(lastUnit.params ?? [])]
  lastUnit.params[2] = 'Clan Guard Elite Battalion'

  assert.throws(() => run(statements, 'Load'), /FOREIGN KEY/i)
})

test('a unit naming a weapon outside the catalog is refused the same way', () => {
  const { run } = open()
  const statements = seedStatements()
  const holding = statements.findLast((s) =>
    s.sql.includes('INSERT INTO oob_unit_weapons'),
  )
  assert.ok(holding)
  // "Warden Rifle (.45)" and "Warden Rifle (.45 Caliber)" are two arsenals,
  // not a typo the app forgives.
  holding.params = [...(holding.params ?? [])]
  holding.params[1] = 'Warden Rifle (.45)'

  assert.throws(() => run(statements, 'Load'), /FOREIGN KEY/i)
})

test('a failure part way through leaves nothing behind', () => {
  const { run, exec } = open()
  const statements = [
    ...seedStatements(),
    { sql: 'INSERT INTO oob_units (id, formation_id, unit_type) VALUES (1, 1, 1)' },
  ]

  assert.throws(() => run(statements, 'Load Clan McGreggor'))
  assert.equal(Number(exec('SELECT count(*) AS n FROM unit_types')[0].n), 0)
  assert.equal(Number(exec('SELECT count(*) AS n FROM oob_formations')[0].n), 0)
  assert.equal(Number(exec('SELECT count(*) AS n FROM undo_actions')[0].n), 0)
})

test('clearing history after seeding leaves nothing to undo', () => {
  const { run, exec, inTransaction } = open()
  run(seedStatements(), 'Load Clan McGreggor')
  inTransaction(() => clearHistory(exec))

  // Without this the seed sits on the undo stack, and undoing it empties the
  // database — whereupon the app finds no nation, seeds again, and that fresh
  // action discards the redo. Undo becomes a no-op that costs you the redo.
  assert.deepEqual(historyState(exec), {
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
  })
  assert.equal(inTransaction(() => undo(exec)), null)
  assert.equal(Number(exec('SELECT count(*) AS n FROM oob_units')[0].n), 58)

  // Changes made afterwards are still undoable, back to the seeded baseline.
  run(
    [{ sql: `UPDATE oob_designs SET name = 'Renamed' WHERE id = 1` }],
    'Rename design',
  )
  assert.equal(inTransaction(() => undo(exec)), 'Rename design')
  assert.equal(
    String(exec('SELECT name FROM oob_designs WHERE id = 1')[0].name),
    'Order of Battle',
  )
})

test('seeding is one undo step, and undoing it clears the nation', () => {
  const { run, exec, inTransaction } = open()
  run(seedStatements(), 'Load Clan McGreggor')

  assert.equal(
    Number(exec(`SELECT count(*) AS n FROM undo_actions WHERE stack = 'undo'`)[0].n),
    1,
  )

  // Both catalogs, the pile, the tree and every holding — written across
  // seven tables and reversed in a single step.
  assert.equal(inTransaction(() => undo(exec)), 'Load Clan McGreggor')
  assert.equal(Number(exec('SELECT count(*) AS n FROM oob_designs')[0].n), 0)
  assert.equal(Number(exec('SELECT count(*) AS n FROM oob_formations')[0].n), 0)
  assert.equal(Number(exec('SELECT count(*) AS n FROM oob_units')[0].n), 0)
  assert.equal(Number(exec('SELECT count(*) AS n FROM oob_unit_weapons')[0].n), 0)
  assert.equal(Number(exec('SELECT count(*) AS n FROM unit_types')[0].n), 0)
  assert.equal(Number(exec('SELECT count(*) AS n FROM weapons')[0].n), 0)
  assert.equal(Number(exec('SELECT count(*) AS n FROM weapon_stock')[0].n), 0)

  assert.equal(inTransaction(() => redo(exec)), 'Load Clan McGreggor')
  assert.equal(Number(exec('SELECT count(*) AS n FROM oob_units')[0].n), 58)
  assert.equal(Number(exec('SELECT count(*) AS n FROM unit_types')[0].n), 11)

  const restored = buildTree(
    exec('SELECT * FROM oob_formations ORDER BY sort_order, id').map((row) => ({
      id: Number(row.id),
      designId: Number(row.design_id),
      parentId: row.parent_id == null ? null : Number(row.parent_id),
      echelon: String(row.echelon) as 'XX',
      name: String(row.name),
      sortOrder: Number(row.sort_order),
    })),
    readUnits(exec),
    roster.unitTypes,
  )
  assert.equal(restored.roots[0].total.men, 28080)
})
