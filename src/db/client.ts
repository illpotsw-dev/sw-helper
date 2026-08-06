import type { Request, Response } from './protocol'

let worker: Worker | null = null
let nextId = 0
const pending = new Map<
  number,
  { resolve: (rows: Record<string, unknown>[]) => void; reject: (err: Error) => void }
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

export function query(
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    const request: Request = { id, sql, params }
    getWorker().postMessage(request)
  })
}
