import sqlite3InitModule, {
  type BindingSpec,
  type Database,
} from '@sqlite.org/sqlite-wasm'
import { SCHEMA_STATEMENTS } from './schema'
import type { Request, Response } from './protocol'

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

// createSyncAccessHandle is only exposed inside a Worker in Chromium, so the
// SAHPool VFS must be installed and driven from here, not the main thread.
const ctx = self as unknown as {
  postMessage: (data: Response) => void
  onmessage: ((event: MessageEvent<Request>) => void) | null
}

ctx.onmessage = async (event) => {
  const { id, sql, params } = event.data
  try {
    const db = await getDb()
    const rows = db.exec({
      sql,
      bind: params as BindingSpec | undefined,
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as Record<string, unknown>[]
    ctx.postMessage({ id, ok: true, rows })
  } catch (err) {
    ctx.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
