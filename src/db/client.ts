import type { Request, Response, Statement } from './protocol.ts'

export type Rows = Record<string, unknown>[]

let worker: Worker | null = null
let nextId = 0
const pending = new Map<
  number,
  { resolve: (rows: Rows[]) => void; reject: (err: Error) => void }
>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent<Response>) => {
      const entry = pending.get(event.data.id)
      if (!entry) return
      pending.delete(event.data.id)
      if (event.data.ok) entry.resolve(event.data.rows)
      else entry.reject(new Error(event.data.error))
    }
  }
  return worker
}

function send(build: (id: number) => Request): Promise<Rows[]> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    getWorker().postMessage(build(id))
  })
}

export async function query(sql: string, params: unknown[] = []): Promise<Rows> {
  const results = await send((id) => ({ id, kind: 'query', sql, params }))
  return results[0] ?? []
}

/**
 * Runs every statement inside a single transaction, resolving with one result
 * set per statement. Rejects — leaving the database untouched — if any of them
 * fails.
 */
export function transaction(statements: Statement[]): Promise<Rows[]> {
  return send((id) => ({ id, kind: 'transaction', statements }))
}
