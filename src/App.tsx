import { useCallback, useEffect, useState } from 'react'
import { redo, subscribeToHistory, undo, type HistoryState } from './db/client.ts'
import { loadLiveOob, type Loaded } from './oob/load.ts'
import { CLAN_MCGREGGOR } from './nations/clan-mcgreggor.ts'
import { OobTree } from './components/OobTree.tsx'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ready'; data: Loaded }

const count = (value: number) => value.toLocaleString('en-US')

function Totals({ data }: { data: Loaded }) {
  const men = data.tree.roots.reduce((sum, r) => sum + r.total.men, 0)
  const weapons = data.tree.roots.reduce((sum, r) => sum + r.total.weapons, 0)
  const units = data.tree.roots.reduce((sum, r) => sum + r.total.unitCount, 0)
  const upkeep = data.tree.roots.reduce(
    (sum, r) => sum + r.total.upkeepPerTurn,
    0,
  )

  const items = [
    ['Men', count(men)],
    ['Guns', count(weapons)],
    ['Units', count(units)],
    ['Upkeep / turn', (Math.round(upkeep * 100) / 100).toString()],
  ]

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-slate-200 bg-white p-3">
          <dt className="text-xs uppercase tracking-wide text-slate-500">
            {label}
          </dt>
          <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function App() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [history, setHistory] = useState<HistoryState>({
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
  })

  const load = useCallback(async () => {
    try {
      const data = await loadLiveOob(CLAN_MCGREGGOR)
      setState(data ? { status: 'ready', data } : { status: 'empty' })
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => subscribeToHistory(setHistory), [])

  const step = async (action: () => Promise<void>) => {
    await action()
    await load()
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3">
          <h1 className="text-lg font-semibold">SW Helper</h1>
          {state.status === 'ready' && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
              Live · {state.data.design.name}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => void step(undo)}
              disabled={!history.canUndo}
              title={history.undoLabel ? `Undo: ${history.undoLabel}` : 'Nothing to undo'}
              className="rounded border border-slate-300 px-2.5 py-1 text-sm transition enabled:hover:bg-slate-100 disabled:opacity-40"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={() => void step(redo)}
              disabled={!history.canRedo}
              title={history.redoLabel ? `Redo: ${history.redoLabel}` : 'Nothing to redo'}
              className="rounded border border-slate-300 px-2.5 py-1 text-sm transition enabled:hover:bg-slate-100 disabled:opacity-40"
            >
              Redo
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 p-4">
        {state.status === 'loading' && (
          <p className="text-slate-500">Opening database…</p>
        )}

        {state.status === 'error' && (
          <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {state.message}
          </p>
        )}

        {state.status === 'empty' && (
          <p className="text-slate-500">
            No live order of battle. Undo may have removed it — press Redo to
            bring it back.
          </p>
        )}

        {state.status === 'ready' && (
          <>
            <Totals data={state.data} />

            {state.data.problems.length > 0 && (
              <ul className="space-y-1 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {state.data.problems.map((problem, index) => (
                  <li key={index}>{problem.message}</li>
                ))}
              </ul>
            )}

            <OobTree tree={state.data.tree} echelons={state.data.echelons} />
          </>
        )}
      </main>
    </div>
  )
}

export default App
