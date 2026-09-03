import type { HistoryState } from './undo.ts'

export type Statement = {
  sql: string
  params?: unknown[]
}

/**
 * `label` names the resulting entry in the undo history ("Move 5th Division").
 * It is only recorded if the request actually changes something, so reads
 * never enter the history whether or not they carry one.
 */
export type Request =
  | { id: number; kind: 'query'; sql: string; params?: unknown[]; label?: string }
  | { id: number; kind: 'transaction'; statements: Statement[]; label?: string }
  | { id: number; kind: 'undo' }
  | { id: number; kind: 'redo' }
  | { id: number; kind: 'history' }

// `rows` carries one result set per statement executed, so a transaction can
// read values back from any step — a new row id, say — not just the last.
// A plain query returns a single-element array.
//
// Every successful response reports the current history state, so the undo
// and redo controls stay accurate without having to poll for it.
export type Response =
  | {
      id: number
      ok: true
      rows: Record<string, unknown>[][]
      history: HistoryState
    }
  | { id: number; ok: false; error: string }
