import { useState } from 'react'
import type { Rollup, Tree, TreeNode } from '../oob/tree.ts'
import type { Echelon, Formation, Problem, Unit } from '../oob/types.ts'

const count = (value: number) => value.toLocaleString('en-US')

/** A formation's strength, showing only the measures it actually has. */
function strength(rollup: Pick<Rollup, 'men' | 'weapons'>): string {
  const parts: string[] = []
  if (rollup.men) parts.push(`${count(rollup.men)} men`)
  if (rollup.weapons) parts.push(`${count(rollup.weapons)} guns`)
  return parts.join(' · ') || '—'
}

// Indentation stops deepening past this level so a five-deep tree still fits
// on a phone. The left border keeps the nesting legible past that point.
const indent = (depth: number) => `${Math.min(depth, 5) * 0.85}rem`

export type TreeActions = {
  onAddFormation: (parent: Formation) => void
  onEditFormation: (formation: Formation) => void
  onDeleteFormation: (node: TreeNode) => void
  onAddUnit: (formation: Formation) => void
  onEditUnit: (unit: Unit) => void
  onDeleteUnit: (unit: Unit) => void
}

// Hidden until the row is hovered or focused on pointer devices, always shown
// where there is no hover to rely on.
const actionGroup =
  'flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100'

const actionButton =
  'rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-200 hover:text-slate-900'

function Problems({ problems }: { problems: Problem[] }) {
  if (!problems.length) return null
  return (
    <ul className="pb-1 pl-6 text-xs text-red-700">
      {problems.map((problem, index) => (
        <li key={index}>{problem.message}</li>
      ))}
    </ul>
  )
}

function EchelonBadge({
  symbol,
  echelons,
}: {
  symbol: string
  echelons: readonly Echelon[]
}) {
  const tier = echelons.find((e) => e.symbol === symbol)
  return (
    <span
      title={tier?.name ?? symbol}
      className="shrink-0 rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[0.65rem] leading-none tracking-wider text-slate-600"
    >
      {symbol}
    </span>
  )
}

function UnitRow({
  unit,
  depth,
  actions,
  problems,
}: {
  unit: Unit
  depth: number
  actions: TreeActions
  problems: Problem[]
}) {
  return (
    <li className="border-l border-slate-200">
      <div
        className="group flex items-baseline gap-2 py-1 pr-2 text-sm hover:bg-slate-50"
        style={{ paddingLeft: indent(depth) }}
      >
        <span className="min-w-0 flex-1 truncate text-slate-700">
          {unit.designation}
          {unit.equipment && (
            <span className="text-slate-400"> · {unit.equipment}</span>
          )}
        </span>
        <span className="shrink-0 tabular-nums text-slate-500">
          {strength(unit)}
        </span>
        <span className={actionGroup}>
          <button
            type="button"
            className={actionButton}
            title="Edit unit"
            onClick={() => actions.onEditUnit(unit)}
          >
            Edit
          </button>
          <button
            type="button"
            className={actionButton}
            title="Delete unit"
            onClick={() => actions.onDeleteUnit(unit)}
          >
            ✕
          </button>
        </span>
      </div>
      <Problems problems={problems} />
    </li>
  )
}

function FormationNode({
  node,
  depth,
  echelons,
  collapsed,
  onToggle,
  actions,
  problemsFor,
}: {
  node: TreeNode
  depth: number
  echelons: readonly Echelon[]
  collapsed: ReadonlySet<number>
  onToggle: (id: number) => void
  actions: TreeActions
  problemsFor: (key: { formationId?: number; unitId?: number }) => Problem[]
}) {
  const isCollapsed = collapsed.has(node.formation.id)
  const childCount = node.children.length + node.units.length

  return (
    <li className="border-l border-slate-200 first:border-l-0">
      <div
        className="group flex items-center gap-2 py-1.5 pr-2 hover:bg-slate-50"
        style={{ paddingLeft: indent(depth) }}
      >
        <button
          type="button"
          onClick={() => onToggle(node.formation.id)}
          disabled={!childCount}
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
          className="w-4 shrink-0 text-slate-400 transition enabled:hover:text-slate-700 disabled:opacity-0"
        >
          {isCollapsed ? '▸' : '▾'}
        </button>
        <EchelonBadge symbol={node.formation.echelon} echelons={echelons} />
        <span className="min-w-0 flex-1 truncate font-medium text-slate-900">
          {node.formation.name}
        </span>
        <span className="shrink-0 tabular-nums text-sm text-slate-600">
          {strength(node.total)}
        </span>
        <span className={actionGroup}>
          <button
            type="button"
            className={actionButton}
            title="Add a formation under this one"
            onClick={() => actions.onAddFormation(node.formation)}
          >
            +Formation
          </button>
          <button
            type="button"
            className={actionButton}
            title="Attach a unit to this formation"
            onClick={() => actions.onAddUnit(node.formation)}
          >
            +Unit
          </button>
          <button
            type="button"
            className={actionButton}
            title="Edit formation"
            onClick={() => actions.onEditFormation(node.formation)}
          >
            Edit
          </button>
          <button
            type="button"
            className={actionButton}
            title="Delete formation"
            onClick={() => actions.onDeleteFormation(node)}
          >
            ✕
          </button>
        </span>
      </div>
      <Problems problems={problemsFor({ formationId: node.formation.id })} />

      {!isCollapsed && childCount > 0 && (
        <ul>
          {node.units.map((unit) => (
            <UnitRow
              key={unit.id}
              unit={unit}
              depth={depth + 1}
              actions={actions}
              problems={problemsFor({ unitId: unit.id })}
            />
          ))}
          {node.children.map((child) => (
            <FormationNode
              key={child.formation.id}
              node={child}
              depth={depth + 1}
              echelons={echelons}
              collapsed={collapsed}
              onToggle={onToggle}
              actions={actions}
              problemsFor={problemsFor}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function OobTree({
  tree,
  echelons,
  problems,
  actions,
}: {
  tree: Tree
  echelons: readonly Echelon[]
  problems: readonly Problem[]
  actions: TreeActions
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set())

  const toggle = (id: number) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const problemsFor = (key: { formationId?: number; unitId?: number }) =>
    problems.filter((problem) =>
      key.formationId !== undefined
        ? problem.formationId === key.formationId
        : problem.unitId === key.unitId,
    )

  return (
    <div className="space-y-6">
      {tree.roots.map((root) => (
        <section
          key={root.formation.id}
          className="overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          <ul>
            <FormationNode
              node={root}
              depth={0}
              echelons={echelons}
              collapsed={collapsed}
              onToggle={toggle}
              actions={actions}
              problemsFor={problemsFor}
            />
          </ul>
        </section>
      ))}

      {tree.unreachable.length > 0 && (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {tree.unreachable.length} formation
          {tree.unreachable.length === 1 ? '' : 's'} could not be placed in the
          tree, which means their parent links form a loop.
        </p>
      )}
    </div>
  )
}
