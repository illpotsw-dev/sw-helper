export type Statement = {
  sql: string
  params?: unknown[]
}

export type Request =
  | { id: number; kind: 'query'; sql: string; params?: unknown[] }
  | { id: number; kind: 'transaction'; statements: Statement[] }

// `rows` carries one result set per statement executed, so a transaction can
// read values back from any step — a new row id, say — not just the last.
// A plain query returns a single-element array.
export type Response =
  | { id: number; ok: true; rows: Record<string, unknown>[][] }
  | { id: number; ok: false; error: string }
