import type { Rollup, Tree, TreeNode } from '../oob/tree.ts'
import { refKey } from '../oob/dnd.ts'
import type { DragSubject, DropRef, DropZone } from '../oob/dnd.ts'
import { armingGap, isError } from '../oob/types.ts'
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

/** The sibling order with one entry shifted, or null at either end. */
function reordered(
  ids: readonly number[],
  index: number,
  delta: number,
): number[] | null {
  const target = index + delta
  if (target < 0 || target >= ids.length) return null
  const next = [...ids]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export type DndBindings = {
  dragging: DragSubject | null
  /** Ref-backed, so it is accurate even before a re-render has committed. */
  isDragging: () => boolean
  /** The row currently under the pointer, and whether dropping there is legal. */
  over: { key: string; zone: DropZone; ok: boolean } | null
  onDragStart: (subject: DragSubject) => void
  onDragOver: (ref: DropRef, zone: DropZone) => void
  onDrop: () => void
  onDragEnd: () => void
}

/**
 * Splits a row vertically. The middle of a formation row nests inside it; the
 * edges place the dragged row either side of it. Unit rows have no inside, so
 * they split in half.
 */
function zoneFor(event: React.DragEvent, allowInside: boolean): DropZone {
  const rect = event.currentTarget.getBoundingClientRect()
  const position = (event.clientY - rect.top) / (rect.height || 1)
  if (!allowInside) return position < 0.5 ? 'before' : 'after'
  if (position < 0.25) return 'before'
  if (position > 0.75) return 'after'
  return 'inside'
}

// Written out in full rather than interpolated: Tailwind generates CSS only for
// class names it can find literally in the source.
const DROP_STYLES = {
  'inside-ok': 'ring-2 ring-inset ring-sky-400 bg-sky-50',
  'inside-no': 'ring-2 ring-inset ring-red-400 bg-red-50',
  'before-ok': 'border-t-2 border-sky-500',
  'before-no': 'border-t-2 border-red-500',
  'after-ok': 'border-b-2 border-sky-500',
  'after-no': 'border-b-2 border-red-500',
}

function dropClasses(dnd: DndBindings, ref: DropRef): string {
  if (!dnd.over || dnd.over.key !== refKey(ref)) return ''
  const key = `${dnd.over.zone}-${dnd.over.ok ? 'ok' : 'no'}`
  return DROP_STYLES[key as keyof typeof DROP_STYLES] ?? ''
}

function dragProps(
  dnd: DndBindings,
  subject: DragSubject,
  ref: DropRef,
  allowInside: boolean,
) {
  return {
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      // Firefox refuses to start a drag unless something is on the transfer.
      event.dataTransfer.setData('text/plain', refKey(ref))
      event.dataTransfer.effectAllowed = 'move'
      dnd.onDragStart(subject)
    },
    onDragOver: (event: React.DragEvent) => {
      if (!dnd.isDragging()) return
      // Without preventDefault the browser treats the row as un-droppable.
      event.preventDefault()
      const zone = zoneFor(event, allowInside)
      event.dataTransfer.dropEffect =
        dnd.over && dnd.over.key === refKey(ref) && !dnd.over.ok ? 'none' : 'move'
      dnd.onDragOver(ref, zone)
    },
    onDrop: (event: React.DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      dnd.onDrop()
    },
    onDragEnd: () => dnd.onDragEnd(),
  }
}

export type TreeActions = {
  onAddFormation: (parent: Formation) => void
  onEditFormation: (formation: Formation) => void
  onDeleteFormation: (node: TreeNode) => void
  onMoveFormation: (formation: Formation) => void
  onAddUnit: (formation: Formation) => void
  onEditUnit: (unit: Unit) => void
  onDeleteUnit: (unit: Unit) => void
  onMoveUnit: (unit: Unit) => void
  onReorderFormations: (orderedIds: number[], label: string) => void
  onReorderUnits: (orderedIds: number[], label: string) => void
  /** A click on a unit's checkbox. `extend` is a shift-click. */
  onSelectUnit: (unitId: number, extend: boolean) => void
}

// Hidden until the row is hovered or focused on pointer devices, always shown
// where there is no hover to rely on.
// ml-auto keeps the group right-aligned whether it shares the row or, on a
// narrow screen, wraps onto a line of its own.
const actionGroup =
  'ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100'

// The row wraps rather than letting seven buttons crush the name to nothing:
// below roughly 480px the actions drop to their own line. The name keeps a
// floor so it stays readable instead of truncating to a couple of characters.
const rowLayout = 'group flex flex-wrap items-center gap-x-2 gap-y-1 pr-2'
const nameCell = 'min-w-[7rem] flex-1 truncate'

const actionButton =
  'rounded px-1.5 py-0.5 text-xs text-slate-500 enabled:hover:bg-slate-200 enabled:hover:text-slate-900 disabled:opacity-30'

function Reorder({
  siblingIds,
  index,
  onReorder,
  label,
}: {
  siblingIds: readonly number[]
  index: number
  onReorder: (orderedIds: number[], label: string) => void
  label: string
}) {
  if (siblingIds.length < 2) return null
  const move = (delta: number) => {
    const next = reordered(siblingIds, index, delta)
    if (next) onReorder(next, label)
  }
  return (
    <>
      <button
        type="button"
        className={actionButton}
        title="Move up"
        disabled={index === 0}
        onClick={() => move(-1)}
      >
        ↑
      </button>
      <button
        type="button"
        className={actionButton}
        title="Move down"
        disabled={index === siblingIds.length - 1}
        onClick={() => move(1)}
      >
        ↓
      </button>
    </>
  )
}

function Problems({ problems }: { problems: Problem[] }) {
  if (!problems.length) return null
  return (
    <ul className="pb-1 pl-6 text-xs">
      {problems.map((problem, index) => (
        <li
          key={index}
          className={isError(problem) ? 'text-red-700' : 'text-slate-500'}
        >
          {problem.message}
        </li>
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
  siblingIds,
  index,
  selected,
  selecting,
  dnd,
  dragSubject,
}: {
  unit: Unit
  depth: number
  actions: TreeActions
  problems: Problem[]
  siblingIds: readonly number[]
  index: number
  selected: boolean
  selecting: boolean
  dnd: DndBindings
  dragSubject: DragSubject
}) {
  const ref: DropRef = { kind: 'unit', id: unit.id }
  return (
    <li className="border-l border-slate-200">
      <div
        {...dragProps(dnd, dragSubject, ref, false)}
        className={`${rowLayout} py-1 text-sm hover:bg-slate-50 ${selected ? 'bg-sky-50' : ''} ${dropClasses(dnd, ref)}`}
        style={{ paddingLeft: indent(depth) }}
      >
        <input
          type="checkbox"
          checked={selected}
          // The handler is on click rather than change because only a mouse
          // event carries the shift key. readOnly is what stops React warning
          // about a checked box with no onChange; the click drives the state.
          readOnly
          onClick={(event) => actions.onSelectUnit(unit.id, event.shiftKey)}
          // Shift-clicking would otherwise drag a text selection across every
          // row in between. Cancelling mousedown stops that but not the click,
          // so the box still ticks.
          onMouseDown={(event) => {
            if (event.shiftKey) event.preventDefault()
          }}
          title="Shift-click to select a range"
          aria-label={`Select ${unit.designation}`}
          // Kept out of the way until a selection is under way, then shown on
          // every row so the set being acted on is obvious.
          className={`shrink-0 ${selecting ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100'}`}
        />
        <span className={`${nameCell} text-slate-700`}>
          {unit.designation}
          {unit.weapon ? (
            <span className="text-slate-400"> · {unit.weapon}</span>
          ) : (
            // Not a failing: a nation short of rifles runs battalions that
            // carry none, and four of McGreggor's do.
            (unit.men > 0 || unit.weapons > 0) && (
              <span className="text-amber-700"> · unarmed</span>
            )
          )}
        </span>
        {unit.weapon && armingGap(unit) > 0 && (
          <span
            title={`Holds ${unit.weaponCount.toLocaleString('en-US')} of the ${(unit.men || unit.weapons).toLocaleString('en-US')} it could`}
            className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700"
          >
            −{armingGap(unit).toLocaleString('en-US')}
          </span>
        )}
        {unit.men === 0 && unit.weapons === 0 ? (
          <span
            title="On the books with nobody in it"
            className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500"
          >
            paper
          </span>
        ) : (
          <span className="shrink-0 tabular-nums text-slate-500">
            {strength(unit)}
          </span>
        )}
        <span className={actionGroup}>
          <Reorder
            siblingIds={siblingIds}
            index={index}
            onReorder={actions.onReorderUnits}
            label={`Reorder units under ${unit.designation}`}
          />
          <button
            type="button"
            className={actionButton}
            title="Move to another formation"
            onClick={() => actions.onMoveUnit(unit)}
          >
            Move
          </button>
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
  siblingIds,
  index,
  selectedUnitIds,
  selecting,
  dnd,
}: {
  node: TreeNode
  depth: number
  echelons: readonly Echelon[]
  collapsed: ReadonlySet<number>
  onToggle: (id: number) => void
  actions: TreeActions
  problemsFor: (key: { formationId?: number; unitId?: number }) => Problem[]
  siblingIds: readonly number[]
  index: number
  selectedUnitIds: ReadonlySet<number>
  selecting: boolean
  dnd: DndBindings
}) {
  const isCollapsed = collapsed.has(node.formation.id)
  const childCount = node.children.length + node.units.length
  const unitIds = node.units.map((u) => u.id)
  const childIds = node.children.map((c) => c.formation.id)
  const ref: DropRef = { kind: 'formation', id: node.formation.id }

  return (
    <li className="border-l border-slate-200 first:border-l-0">
      <div
        {...dragProps(dnd, { kind: 'formation', id: node.formation.id }, ref, true)}
        className={`${rowLayout} py-1.5 hover:bg-slate-50 ${dropClasses(dnd, ref)}`}
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
        <span className={`${nameCell} font-medium text-slate-900`}>
          {node.formation.name}
        </span>
        <span className="shrink-0 tabular-nums text-sm text-slate-600">
          {strength(node.total)}
        </span>
        <span className={actionGroup}>
          <Reorder
            siblingIds={siblingIds}
            index={index}
            onReorder={actions.onReorderFormations}
            label={`Reorder ${node.formation.name} among its siblings`}
          />
          <button
            type="button"
            className={actionButton}
            title="Move this formation, and everything under it, elsewhere"
            onClick={() => actions.onMoveFormation(node.formation)}
          >
            Move
          </button>
          <button
            type="button"
            className={actionButton}
            title="Add a formation under this one"
            onClick={() => actions.onAddFormation(node.formation)}
          >
            +Sub
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
          {node.units.map((unit, unitIndex) => (
            <UnitRow
              key={unit.id}
              unit={unit}
              depth={depth + 1}
              actions={actions}
              problems={problemsFor({ unitId: unit.id })}
              siblingIds={unitIds}
              index={unitIndex}
              selected={selectedUnitIds.has(unit.id)}
              selecting={selecting}
              dnd={dnd}
              dragSubject={
                selectedUnitIds.has(unit.id) && selectedUnitIds.size > 1
                  ? { kind: 'units', ids: [...selectedUnitIds] }
                  : { kind: 'units', ids: [unit.id] }
              }
            />
          ))}
          {node.children.map((child, childIndex) => (
            <FormationNode
              key={child.formation.id}
              node={child}
              depth={depth + 1}
              echelons={echelons}
              collapsed={collapsed}
              onToggle={onToggle}
              actions={actions}
              problemsFor={problemsFor}
              siblingIds={childIds}
              index={childIndex}
              selectedUnitIds={selectedUnitIds}
              selecting={selecting}
              dnd={dnd}
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
  selectedUnitIds,
  collapsed,
  onToggleCollapsed,
  dnd,
}: {
  tree: Tree
  echelons: readonly Echelon[]
  problems: readonly Problem[]
  actions: TreeActions
  selectedUnitIds: ReadonlySet<number>
  /**
   * Which formations are folded shut. Owned by the designer, because what
   * is on screen is what the selection shortcuts act on.
   */
  collapsed: ReadonlySet<number>
  onToggleCollapsed: (formationId: number) => void
  dnd: DndBindings
}) {
  const problemsFor = (key: { formationId?: number; unitId?: number }) =>
    problems.filter((problem) =>
      key.formationId !== undefined
        ? problem.formationId === key.formationId
        : problem.unitId === key.unitId,
    )

  const rootIds = tree.roots.map((r) => r.formation.id)
  const selecting = selectedUnitIds.size > 0

  return (
    <div className="space-y-6">
      {tree.roots.map((root, index) => (
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
              onToggle={onToggleCollapsed}
              actions={actions}
              problemsFor={problemsFor}
              siblingIds={rootIds}
              index={index}
              selectedUnitIds={selectedUnitIds}
              selecting={selecting}
              dnd={dnd}
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
