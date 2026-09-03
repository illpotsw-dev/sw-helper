/**
 * App-wide undo/redo, built on SQLite's documented trigger pattern.
 *
 * Every user table gets INSERT/UPDATE/DELETE triggers that write the SQL to
 * reverse the change into `undo_log`. Nothing a feature does needs to know
 * about undo: if it writes to a table, it is undoable. New tables are picked
 * up automatically, since triggers are generated from the live schema on open.
 *
 * The triggers stay armed while undoing, which is what makes redo work — the
 * inverse of an inverse is the original change, so undoing records exactly
 * what redo needs.
 *
 * Everything here is plain SQL over a synchronous exec, so it runs unchanged
 * against sqlite-wasm in the worker and against node:sqlite in tests.
 */

export type Exec = (sql: string, params?: unknown[]) => Record<string, unknown>[]

/** Actions kept before the oldest is discarded. */
export const HISTORY_LIMIT = 100

export const UNDO_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS undo_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    sql TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS undo_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    first_seq INTEGER NOT NULL,
    last_seq INTEGER NOT NULL,
    stack TEXT NOT NULL CHECK (stack IN ('undo', 'redo'))
  )`,
]

const BOOKKEEPING = new Set(['undo_log', 'undo_actions'])

const q = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`

/**
 * Triggers for one table. Values are captured with SQLite's quote(), which
 * escapes strings and renders NULL and blobs correctly, and rows are addressed
 * by rowid so this works whether or not the table has an integer primary key.
 */
export function triggerStatements(table: string, columns: string[]): string[] {
  const name = q(table)
  const setClause = columns
    .map((c) => `'${q(c)}=' || quote(old.${q(c)})`)
    .join(` || ',' || `)
  const columnList = ['rowid', ...columns].map(q).join(',')
  const valueList = [
    'old.rowid',
    ...columns.map((c) => `quote(old.${q(c)})`),
  ].join(` || ',' || `)

  return [
    `DROP TRIGGER IF EXISTS undo_${table}_insert`,
    `DROP TRIGGER IF EXISTS undo_${table}_update`,
    `DROP TRIGGER IF EXISTS undo_${table}_delete`,

    `CREATE TRIGGER undo_${table}_insert AFTER INSERT ON ${name} BEGIN
      INSERT INTO undo_log (sql)
      VALUES ('DELETE FROM ${name} WHERE rowid=' || new.rowid);
    END`,

    `CREATE TRIGGER undo_${table}_update AFTER UPDATE ON ${name} BEGIN
      INSERT INTO undo_log (sql)
      VALUES ('UPDATE ${name} SET ' || ${setClause} || ' WHERE rowid=' || old.rowid);
    END`,

    `CREATE TRIGGER undo_${table}_delete BEFORE DELETE ON ${name} BEGIN
      INSERT INTO undo_log (sql)
      VALUES ('INSERT INTO ${name} (${columnList}) VALUES(' || ${valueList} || ')');
    END`,
  ]
}

/**
 * Creates the log tables and arms triggers on every user table.
 *
 * Recursive triggers are required, not optional: without them SQLite skips
 * delete triggers on rows removed by ON DELETE CASCADE, so undoing the
 * deletion of a design would restore the design and silently lose every
 * formation and unit under it.
 */
export function installUndo(exec: Exec): void {
  exec('PRAGMA recursive_triggers = ON')
  for (const statement of UNDO_SCHEMA) exec(statement)

  const tables = exec(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  )
    .map((row) => String(row.name))
    .filter((name) => !BOOKKEEPING.has(name))

  for (const table of tables) {
    const columns = exec(`PRAGMA table_info(${q(table)})`).map((row) =>
      String(row.name),
    )
    if (!columns.length) continue
    for (const statement of triggerStatements(table, columns)) exec(statement)
  }
}

const maxSeq = (exec: Exec): number =>
  Number(exec('SELECT COALESCE(MAX(seq), 0) AS seq FROM undo_log')[0]?.seq ?? 0)

/** Call before running statements; pass the result to finishAction. */
export function beginAction(exec: Exec): number {
  return maxSeq(exec)
}

/**
 * Closes off whatever the statements since `before` changed, recording them as
 * one undoable action. Does nothing when nothing was written, so reads never
 * enter the history.
 *
 * Performing a new action discards the redo stack, per normal undo semantics.
 */
export function finishAction(exec: Exec, before: number, label: string): void {
  const after = maxSeq(exec)
  if (after <= before) return

  for (const row of exec(`SELECT first_seq, last_seq FROM undo_actions WHERE stack = 'redo'`)) {
    exec('DELETE FROM undo_log WHERE seq BETWEEN ? AND ?', [
      row.first_seq,
      row.last_seq,
    ])
  }
  exec(`DELETE FROM undo_actions WHERE stack = 'redo'`)

  exec(
    `INSERT INTO undo_actions (label, first_seq, last_seq, stack)
     VALUES (?, ?, ?, 'undo')`,
    [label, before + 1, after],
  )

  const stale = exec(
    `SELECT id, first_seq, last_seq FROM undo_actions
     WHERE stack = 'undo'
     ORDER BY id DESC
     LIMIT -1 OFFSET ?`,
    [HISTORY_LIMIT],
  )
  for (const row of stale) {
    exec('DELETE FROM undo_log WHERE seq BETWEEN ? AND ?', [
      row.first_seq,
      row.last_seq,
    ])
    exec('DELETE FROM undo_actions WHERE id = ?', [row.id])
  }
}

function step(exec: Exec, from: 'undo' | 'redo'): string | null {
  // The undo stack pops newest first. The redo stack pops oldest first, since
  // the most recently undone action has the lowest id of those sitting on it.
  const order = from === 'undo' ? 'DESC' : 'ASC'
  const action = exec(
    `SELECT id, label, first_seq, last_seq FROM undo_actions
     WHERE stack = ?
     ORDER BY id ${order}
     LIMIT 1`,
    [from],
  )[0]
  if (!action) return null

  // Replaying inverses walks through states that break foreign keys even
  // though the end state is sound. Undoing a cascading delete is the clear
  // case: the parent's BEFORE DELETE trigger fires ahead of the cascade, so
  // reverse-order replay reinserts children before their parents. Deferring
  // moves the check to COMMIT, by which point every row is back.
  //
  // This only has effect inside a transaction, which is where undo runs.
  exec('PRAGMA defer_foreign_keys = ON')

  const before = maxSeq(exec)

  // Reverse order: the last change made is the first one undone.
  const statements = exec(
    'SELECT sql FROM undo_log WHERE seq BETWEEN ? AND ? ORDER BY seq DESC',
    [action.first_seq, action.last_seq],
  ).map((row) => String(row.sql))
  for (const sql of statements) exec(sql)

  const after = maxSeq(exec)

  exec('DELETE FROM undo_log WHERE seq BETWEEN ? AND ?', [
    action.first_seq,
    action.last_seq,
  ])
  exec(
    `UPDATE undo_actions SET stack = ?, first_seq = ?, last_seq = ? WHERE id = ?`,
    [from === 'undo' ? 'redo' : 'undo', before + 1, after, action.id],
  )

  return String(action.label)
}

/** Reverses the most recent action, returning its label, or null if there is none. */
export const undo = (exec: Exec): string | null => step(exec, 'undo')

/** Reapplies the most recently undone action, returning its label. */
export const redo = (exec: Exec): string | null => step(exec, 'redo')

export type HistoryState = {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
}

/** What the undo and redo controls should show. */
export function historyState(exec: Exec): HistoryState {
  const next = (stack: 'undo' | 'redo') =>
    exec(
      `SELECT label FROM undo_actions WHERE stack = ?
       ORDER BY id ${stack === 'undo' ? 'DESC' : 'ASC'} LIMIT 1`,
      [stack],
    )[0]

  const undoNext = next('undo')
  const redoNext = next('redo')
  return {
    canUndo: !!undoNext,
    canRedo: !!redoNext,
    undoLabel: undoNext ? String(undoNext.label) : null,
    redoLabel: redoNext ? String(redoNext.label) : null,
  }
}
