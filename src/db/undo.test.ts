import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_STATEMENTS } from './schema.ts'
import {
  beginAction,
  finishAction,
  historyState,
  installUndo,
  redo,
  undo,
  type Exec,
} from './undo.ts'

type Harness = {
  exec: Exec
  act: (label: string, body: () => void) => void
  undo: () => string | null
  redo: () => string | null
}

function open(): Harness {
  const db = new DatabaseSync(':memory:')
  const exec: Exec = (sql, params = []) => {
    const statement = db.prepare(sql)
    return statement.all(...(params as never[])) as Record<string, unknown>[]
  }
  for (const statement of SCHEMA_STATEMENTS) db.exec(statement)
  installUndo(exec)

  // Every one of these mirrors the worker, which runs each request inside a
  // transaction. That matters beyond atomicity: deferred foreign keys only
  // apply within a transaction, and undo depends on them.
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

  return {
    exec,
    act: (label, body) =>
      inTransaction(() => {
        const before = beginAction(exec)
        body()
        finishAction(exec, before, label)
      }),
    undo: () => inTransaction(() => undo(exec)),
    redo: () => inTransaction(() => redo(exec)),
  }
}

const seedCatalog = (exec: Exec) =>
  exec(
    `INSERT INTO unit_types (name, type, men, weapons) VALUES ('Clan Levies', 'infantry', 1000, 0)`,
  )

const countOf = (exec: Exec, table: string) =>
  Number(exec(`SELECT count(*) AS n FROM ${table}`)[0].n)

test('arms triggers on user tables but not on its own bookkeeping', () => {
  const { exec } = open()
  const triggers = exec(
    `SELECT name FROM sqlite_master WHERE type = 'trigger'`,
  ).map((r) => String(r.name))

  assert.ok(triggers.includes('undo_oob_units_insert'))
  assert.ok(triggers.includes('undo_oob_formations_update'))
  assert.ok(triggers.includes('undo_unit_types_delete'))
  assert.ok(!triggers.some((t) => t.includes('undo_log')))
  assert.ok(!triggers.some((t) => t.includes('undo_actions')))
})

test('undoes and redoes an insert', () => {
  const { exec, act, undo, redo } = open()
  act('Add unit type', () => seedCatalog(exec))
  assert.equal(countOf(exec, 'unit_types'), 1)

  assert.equal(undo(), 'Add unit type')
  assert.equal(countOf(exec, 'unit_types'), 0)

  assert.equal(redo(), 'Add unit type')
  assert.equal(countOf(exec, 'unit_types'), 1)
})

test('undoes an update back to the previous values', () => {
  const { exec, act, undo, redo } = open()
  act('Add', () => seedCatalog(exec))
  act('Rename tier', () =>
    exec(`UPDATE echelons SET name = 'Armeekorps' WHERE symbol = 'XXX'`),
  )

  const nameOf = () =>
    String(exec(`SELECT name FROM echelons WHERE symbol = 'XXX'`)[0].name)
  assert.equal(nameOf(), 'Armeekorps')

  undo()
  assert.equal(nameOf(), 'Corps')

  redo()
  assert.equal(nameOf(), 'Armeekorps')
})

test('undoes a delete, restoring the row', () => {
  const { exec, act, undo } = open()
  act('Add', () => seedCatalog(exec))
  act('Remove', () => exec(`DELETE FROM unit_types WHERE name = 'Clan Levies'`))
  assert.equal(countOf(exec, 'unit_types'), 0)

  undo()
  const restored = exec('SELECT * FROM unit_types')[0]
  assert.equal(restored.name, 'Clan Levies')
  assert.equal(restored.men, 1000)
})

test('a cascading delete is undone in full, not just the parent row', () => {
  const { exec, act, undo } = open()
  act('Seed', () => {
    seedCatalog(exec)
    exec(`INSERT INTO oob_designs (id, name, is_live) VALUES (1, 'Live', 1)`)
    exec(
      `INSERT INTO oob_formations (id, design_id, parent_id, echelon, name)
       VALUES (1, 1, NULL, 'XXXX', 'Army'), (2, 1, 1, 'XX', 'Division')`,
    )
    exec(
      `INSERT INTO oob_units (id, formation_id, unit_type, designation, men)
       VALUES (1, 2, 'Clan Levies', 'I/I Levy Battalion', 1000)`,
    )
  })

  // Deleting the design cascades to formations and then to units. Without
  // recursive triggers SQLite would skip the child delete triggers and undo
  // would restore an empty design.
  act('Delete design', () => exec('DELETE FROM oob_designs WHERE id = 1'))
  assert.equal(countOf(exec, 'oob_designs'), 0)
  assert.equal(countOf(exec, 'oob_formations'), 0)
  assert.equal(countOf(exec, 'oob_units'), 0)

  undo()
  assert.equal(countOf(exec, 'oob_designs'), 1)
  assert.equal(countOf(exec, 'oob_formations'), 2)
  assert.equal(countOf(exec, 'oob_units'), 1)

  const formation = exec('SELECT * FROM oob_formations WHERE id = 2')[0]
  assert.equal(formation.parent_id, 1)
  assert.equal(formation.name, 'Division')
})

test('many statements in one action undo as a single step', () => {
  const { exec, act, undo } = open()
  act('Import roster', () => {
    seedCatalog(exec)
    exec(`INSERT INTO oob_designs (id, name) VALUES (1, 'Imported')`)
    for (let i = 1; i <= 20; i++) {
      exec(
        `INSERT INTO oob_formations (id, design_id, echelon, name) VALUES (?, 1, 'XX', ?)`,
        [i, `Division ${i}`],
      )
    }
  })
  assert.equal(countOf(exec, 'oob_formations'), 20)

  assert.equal(undo(), 'Import roster')
  assert.equal(countOf(exec, 'oob_formations'), 0)
  assert.equal(countOf(exec, 'oob_designs'), 0)
  assert.equal(historyState(exec).canUndo, false)
})

test('undoes several actions in order, then redoes them in order', () => {
  const { exec, act, undo, redo } = open()
  act('First', () =>
    exec(`INSERT INTO oob_designs (id, name) VALUES (1, 'One')`),
  )
  act('Second', () =>
    exec(`INSERT INTO oob_designs (id, name) VALUES (2, 'Two')`),
  )
  act('Third', () =>
    exec(`INSERT INTO oob_designs (id, name) VALUES (3, 'Three')`),
  )

  assert.equal(undo(), 'Third')
  assert.equal(undo(), 'Second')
  assert.equal(countOf(exec, 'oob_designs'), 1)

  assert.equal(redo(), 'Second')
  assert.equal(redo(), 'Third')
  assert.equal(countOf(exec, 'oob_designs'), 3)
  assert.equal(historyState(exec).canRedo, false)
})

test('a new action discards the redo stack', () => {
  const { exec, act, undo } = open()
  act('First', () => exec(`INSERT INTO oob_designs (id, name) VALUES (1, 'One')`))
  act('Second', () => exec(`INSERT INTO oob_designs (id, name) VALUES (2, 'Two')`))

  undo()
  assert.equal(historyState(exec).canRedo, true)

  act('Different', () =>
    exec(`INSERT INTO oob_designs (id, name) VALUES (3, 'Three')`),
  )
  assert.equal(historyState(exec).canRedo, false)
  assert.equal(historyState(exec).undoLabel, 'Different')
})

test('reads do not enter the history', () => {
  const { exec, act } = open()
  act('Look at designs', () => exec('SELECT * FROM oob_designs'))
  assert.equal(historyState(exec).canUndo, false)
  assert.equal(countOf(exec, 'undo_actions'), 0)
})

test('undo and redo report nothing to do on empty stacks', () => {
  const harness = open()
  const { exec } = harness
  assert.equal(harness.undo(), null)
  assert.equal(harness.redo(), null)
  assert.deepEqual(historyState(exec), {
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
  })
})

test('history lives in the database, so it survives a reopen', () => {
  const { exec, act, undo } = open()
  act('Add design', () => exec(`INSERT INTO oob_designs (id, name) VALUES (1, 'One')`))

  // Reopening re-arms triggers over the existing log rather than clearing it.
  installUndo(exec)
  assert.equal(historyState(exec).undoLabel, 'Add design')
  assert.equal(undo(), 'Add design')
  assert.equal(countOf(exec, 'oob_designs'), 0)
})

test('text values with quotes survive a round trip', () => {
  const { exec, act, undo } = open()
  const awkward = "Clan O'Malley's \"Own\" — 1st"
  act('Add', () =>
    exec(`INSERT INTO oob_designs (id, name, note) VALUES (1, ?, '')`, [awkward]),
  )
  act('Rename', () => exec(`UPDATE oob_designs SET name = 'Plain' WHERE id = 1`))

  undo()
  assert.equal(exec('SELECT name FROM oob_designs')[0].name, awkward)
})
