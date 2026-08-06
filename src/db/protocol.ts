export type Request = {
  id: number
  sql: string
  params?: unknown[]
}

export type Response =
  | { id: number; ok: true; rows: Record<string, unknown>[] }
  | { id: number; ok: false; error: string }
