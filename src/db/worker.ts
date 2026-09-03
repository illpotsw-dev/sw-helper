import sqlite3InitModule, {
  type BindingSpec,
  type Database,
} from '@sqlite.org/sqlite-wasm'
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
import type { Request, Response, Statement } from './protocol.ts'

let dbPromise: Promise<Database> | null = null

async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const sqlite3 = await sqlite3InitModule()
      const poolUtil = await sqlite3.installOpfsSAHPoolVfs({ name: 'sw-helper' })
      const db = new poolUtil.OpfsSAHPoolDb('/sw-helper.sqlite3')
      for (const statement of SCHEMA_STATEMENTS) {
        db.exec(statement)
      }
      // Re-armed on every open, so tables added by a later schema change pick
      // up undo without anything else having to know about them. Runs after
      // the schema so seeding the default echelons is not itself undoable.
      installUndo(execOn(db))
      return db
    })()
  }
  return dbPromise
}

const execOn =
  (db: Database): Exec =>
  (sql, params) =>
    db.exec({
      sql,
      bind: params as BindingSpec | undefined,
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as Record<string, unknown>[]

// createSyncAccessHandle is only exposed inside a Worker in Chromium, so the
// SAHPool VFS must be installed and driven from here, not the main thread.
const ctx = self as unknown as {
  postMessage: (data: Response) => void
  onmessage: ((event: MessageEvent<Request>) => void) | null
}

const statementsOf = (request: Request): Statement[] => {
  if (request.kind === 'query') {
    return [{ sql: request.sql, params: request.params }]
  }
  return request.kind === 'transaction' ? request.statements : []
}

ctx.onmessage = async (event) => {
  const request = event.data
  try {
    const db = await getDb()
    const exec = execOn(db)

    // Every request runs in a transaction. Beyond atomicity, this is what
    // makes undo work: deferred foreign keys only apply inside one, and the
    // whole request has to become a single history entry.
    db.exec('BEGIN')
    try {
      let rows: Record<string, unknown>[][] = []

      if (request.kind === 'undo') {
        undo(exec)
      } else if (request.kind === 'redo') {
        redo(exec)
      } else if (request.kind !== 'history') {
        const before = beginAction(exec)
        rows = statementsOf(request).map((statement) =>
          exec(statement.sql, statement.params),
        )
        finishAction(exec, before, request.label ?? 'Change')
      }

      const history = historyState(exec)
      db.exec('COMMIT')
      ctx.postMessage({ id: request.id, ok: true, rows, history })
    } catch (err) {
      // SQLite may have already unwound the transaction itself, in which
      // case ROLLBACK throws — the original error is the one worth keeping.
      try {
        db.exec('ROLLBACK')
      } catch {
        /* no active transaction */
      }
      throw err
    }
  } catch (err) {
    ctx.postMessage({
      id: request.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
