import type { Request, Response, Statement } from './protocol.ts'
import type { HistoryState } from './undo.ts'

export type { HistoryState }
export type Rows = Record<string, unknown>[]

let worker: Worker | null = null
let nextId = 0
const pending = new Map<
  number,
  { resolve: (rows: Rows[]) => void; reject: (err: Error) => void }
>()

let history: HistoryState = {
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
}
const listeners = new Set<(state: HistoryState) => void>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent<Response>) => {
      const entry = pending.get(event.data.id)
      if (!entry) return
      pending.delete(event.data.id)
      if (event.data.ok) {
        history = event.data.history
        for (const listener of listeners) listener(history)
        entry.resolve(event.data.rows)
      } else {
        entry.reject(new Error(event.data.error))
      }
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

/**
 * `label` names the resulting undo entry. Reads never enter the history, so
 * it is only worth passing on statements that change something.
 */
export async function query(
  sql: string,
  params: unknown[] = [],
  label?: string,
): Promise<Rows> {
  const results = await send((id) => ({ id, kind: 'query', sql, params, label }))
  return results[0] ?? []
}

/**
 * Runs every statement inside a single transaction, resolving with one result
 * set per statement. Rejects — leaving the database untouched — if any of them
 * fails, and lands in the undo history as one entry rather than many.
 */
export function transaction(
  statements: Statement[],
  label?: string,
): Promise<Rows[]> {
  return send((id) => ({ id, kind: 'transaction', statements, label }))
}

/** Reverses the most recent change, whichever feature made it. */
export async function undo(): Promise<void> {
  await send((id) => ({ id, kind: 'undo' }))
}

export async function redo(): Promise<void> {
  await send((id) => ({ id, kind: 'redo' }))
}

/** Last known undo/redo availability. Updated after every request. */
export const historyState = (): HistoryState => history

/** Fires on every change to undo/redo availability, and once immediately. */
export function subscribeToHistory(
  listener: (state: HistoryState) => void,
): () => void {
  listeners.add(listener)
  listener(history)
  void send((id) => ({ id, kind: 'history' }))
  return () => listeners.delete(listener)
}
