import sqlite3InitModule, {
  type BindingSpec,
  type Database,
} from '@sqlite.org/sqlite-wasm'
import { SCHEMA_STATEMENTS } from './schema.ts'
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
      return db
    })()
  }
  return dbPromise
}

function run(db: Database, { sql, params }: Statement) {
  return db.exec({
    sql,
    bind: params as BindingSpec | undefined,
    rowMode: 'object',
    returnValue: 'resultRows',
  }) as Record<string, unknown>[]
}

// createSyncAccessHandle is only exposed inside a Worker in Chromium, so the
// SAHPool VFS must be installed and driven from here, not the main thread.
const ctx = self as unknown as {
  postMessage: (data: Response) => void
  onmessage: ((event: MessageEvent<Request>) => void) | null
}

ctx.onmessage = async (event) => {
  const request = event.data
  try {
    const db = await getDb()
    if (request.kind === 'query') {
      ctx.postMessage({ id: request.id, ok: true, rows: [run(db, request)] })
      return
    }
    // Either every statement lands or none does. Imports depend on this:
    // a tree half-written by a failure partway through is worse than no
    // tree at all.
    db.exec('BEGIN')
    try {
      const rows = request.statements.map((statement) => run(db, statement))
      db.exec('COMMIT')
      ctx.postMessage({ id: request.id, ok: true, rows })
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
