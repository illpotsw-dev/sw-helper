import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_STATEMENTS } from './schema.ts'
import { catalogStatements } from './statements.ts'
import {
  beginAction,
  finishAction,
  installUndo,
  redo,
  undo,
  type Exec,
} from './undo.ts'
import { mcgreggor } from '../oob/fixture.test-helper.ts'
import type { Statement } from './protocol.ts'

/**
 * The app's own statements against the app's own schema, so the ledger's
 * constraints are real here: the weapons foreign key and the non-negative
 * stock CHECK apply exactly as they do in a browser.
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

  const stockOf = (weapon: string) =>
    Number(
      exec('SELECT quantity FROM weapon_stock WHERE weapon = ?', [weapon])[0]
        ?.quantity ?? -1,
    )

  return { db, exec, run, stockOf }
}

const roster = mcgreggor()

const seedCatalog = () => catalogStatements(roster.weapons, roster.stock)

test("Clan McGreggor's catalog and pile satisfy every database constraint", () => {
  const { run, exec } = open()
  run(seedCatalog(), 'Load Clan McGreggor')

  assert.equal(Number(exec('SELECT count(*) AS n FROM weapons')[0].n), 13)

  // A row per catalog weapon, not per stockpile entry: a movement is then
  // always an UPDATE and never has to decide whether the row exists.
  assert.equal(Number(exec('SELECT count(*) AS n FROM weapon_stock')[0].n), 13)
  assert.equal(
    Number(exec('SELECT count(*) AS n FROM weapon_stock WHERE quantity > 0')[0].n),
    8,
  )
})

test('a pattern the stockpile does not name is stocked at zero', () => {
  const { run, stockOf } = open()
  run(seedCatalog(), 'Load Clan McGreggor')

  // All 870 Lexingtons the clan owns are in the Sharpshooters' hands.
  assert.equal(
    stockOf('Lexington Pattern Rifle (.30-06 Lexington Smokeless)'),
    0,
  )
  assert.equal(stockOf('Warden Rifle (.45 Caliber)'), 615)
})

test('stock cannot be driven below zero', () => {
  const { run, stockOf } = open()
  run(seedCatalog(), 'Load Clan McGreggor')

  assert.throws(
    () =>
      run(
        [
          {
            sql: 'UPDATE weapon_stock SET quantity = quantity - ? WHERE weapon = ?',
            params: [616, 'Warden Rifle (.45 Caliber)'],
          },
        ],
        'Issue more Wardens than exist',
      ),
    /CHECK constraint failed/,
  )

  // Rolled back whole rather than clamped: an operation that would break an
  // invariant commits nothing at all.
  assert.equal(stockOf('Warden Rifle (.45 Caliber)'), 615)
})

test('the pile cannot hold a weapon the catalog does not have', () => {
  const { run } = open()
  run(seedCatalog(), 'Load Clan McGreggor')

  assert.throws(
    () =>
      run(
        [
          {
            sql: 'INSERT INTO weapon_stock (weapon, quantity) VALUES (?, ?)',
            params: ['Warden Rifle (.45)', 40],
          },
        ],
        'Stock a weapon that does not exist',
      ),
    /FOREIGN KEY constraint failed/,
  )
})

test('a movement over the two tables is one undo entry', () => {
  const { run, exec, stockOf } = open()
  run(seedCatalog(), 'Load Clan McGreggor')

  // Two rows touched, one transaction: the shape every movement takes.
  run(
    [
      {
        sql: 'UPDATE weapon_stock SET quantity = quantity + ? WHERE weapon = ?',
        params: [340, 'Barclay Hornets (7x57mm)'],
      },
      {
        sql: 'UPDATE weapon_stock SET quantity = quantity - ? WHERE weapon = ?',
        params: [340, 'Warden Rifle (.45 Caliber)'],
      },
    ],
    'Re-arm 1st Infantry Brigade',
  )
  assert.equal(stockOf('Barclay Hornets (7x57mm)'), 680)
  assert.equal(stockOf('Warden Rifle (.45 Caliber)'), 275)

  assert.equal(undo(exec), 'Re-arm 1st Infantry Brigade')
  assert.equal(stockOf('Barclay Hornets (7x57mm)'), 340)
  assert.equal(stockOf('Warden Rifle (.45 Caliber)'), 615)

  redo(exec)
  assert.equal(stockOf('Barclay Hornets (7x57mm)'), 680)
  assert.equal(stockOf('Warden Rifle (.45 Caliber)'), 275)
})
