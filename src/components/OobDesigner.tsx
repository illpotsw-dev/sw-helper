import { useEffect, useMemo, useRef, useState } from 'react'
import { OobTree, type DndBindings, type TreeActions } from './OobTree.tsx'
import { FormationForm } from './FormationForm.tsx'
import { UnitForm, type UnitValues } from './UnitForm.tsx'
import { DeleteFormationPrompt } from './DeleteFormationPrompt.tsx'
import { BattleDialog, type StrengthChange } from './BattleDialog.tsx'
import { ExportDialog } from './ExportDialog.tsx'
import { buttonStyles } from './styles.ts'
import {
  MoveDialog,
  type MoveSubject,
  type MoveTarget,
} from './MoveDialog.tsx'
import {
  addFormation,
  addUnit,
  applyDrop,
  applyStrengthChanges,
  deleteFormation,
  deleteUnit,
  moveFormation,
  moveUnits,
  reorderFormations,
  reorderUnits,
  updateFormation,
  updateUnit,
} from '../db/oob.ts'
import type { DeleteMode } from '../db/statements.ts'
import type { Loaded } from '../oob/load.ts'
import { visibleUnitIds } from '../oob/tree.ts'
import type { TreeNode } from '../oob/tree.ts'
import { planDrop, refKey } from '../oob/dnd.ts'
import { emptySelection, selectAll, selectUnit } from '../oob/selection.ts'
import type { DragSubject, DropPlan, DropZone } from '../oob/dnd.ts'
import type { EchelonSymbol, Formation, Unit } from '../oob/types.ts'

/** Whether a keystroke belongs to a text field rather than to the tree. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLInputElement) {
    return target.type !== 'checkbox' && target.type !== 'radio'
  }
  return target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

type Editing =
  | { kind: 'add-formation'; parent: Formation | null }
  | { kind: 'edit-formation'; formation: Formation }
  | { kind: 'delete-formation'; node: TreeNode }
  | { kind: 'add-unit'; formation: Formation }
  | { kind: 'edit-unit'; unit: Unit }
  | { kind: 'move'; subject: MoveSubject }
  | { kind: 'battle' }
  | { kind: 'export' }
  | null

export function OobDesigner({
  data,
  onChanged,
}: {
  data: Loaded
  onChanged: () => Promise<void>
}) {
  const [editing, setEditing] = useState<Editing>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(emptySelection)
  // Which formations are folded shut lives here rather than in the tree:
  // both the shortcuts below and a shift-click range act on the rows that
  // are actually on screen.
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set())
  const [dragging, setDragging] = useState<DragSubject | null>(null)
  const [over, setOver] = useState<{
    key: string
    zone: DropZone
    ok: boolean
    reason?: string
  } | null>(null)
  // dragover fires continuously, so the plan is kept off React state and only
  // the summary that actually changes the display is stored.
  const planRef = useRef<DropPlan | null>(null)
  // The subject is mirrored in a ref because dragover can arrive before React
  // has committed the state set by dragstart, and a handler reading only state
  // would ignore that first event.
  const draggingRef = useRef<DragSubject | null>(null)

  // Writes go straight to the database; the reload afterwards is what refreshes
  // the tree. A rejected write leaves nothing behind, so showing the message and
  // reloading is enough to recover.
  const apply = async (work: () => Promise<unknown>) => {
    setError(null)
    try {
      await work()
      setEditing(null)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setEditing(null)
    }
  }

  const toggleCollapsed = (formationId: number) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(formationId)) next.add(formationId)
      return next
    })

  // Memoised so the shortcut listener below is not torn down and rebuilt on
  // every render — during a drag that is several a second.
  const visibleUnits = useMemo(
    () => visibleUnitIds(data.tree, collapsed),
    [data.tree, collapsed],
  )

  const actions: TreeActions = {
    onAddFormation: (parent) => setEditing({ kind: 'add-formation', parent }),
    onEditFormation: (formation) =>
      setEditing({ kind: 'edit-formation', formation }),
    onDeleteFormation: (node) => setEditing({ kind: 'delete-formation', node }),
    onAddUnit: (formation) => setEditing({ kind: 'add-unit', formation }),
    onEditUnit: (unit) => setEditing({ kind: 'edit-unit', unit }),
    // No confirmation: a single unit is a small, clearly labelled undo away.
    onDeleteUnit: (unit) =>
      void apply(() => deleteUnit(unit.id, unit.designation)),
    onMoveFormation: (formation) =>
      setEditing({ kind: 'move', subject: { kind: 'formation', formation } }),
    onMoveUnit: (unit) =>
      setEditing({
        kind: 'move',
        subject: {
          kind: 'units',
          unitIds: [unit.id],
          fromFormationId: unit.formationId,
        },
      }),
    onReorderFormations: (orderedIds, label) =>
      void apply(() => reorderFormations(orderedIds, label)),
    onReorderUnits: (orderedIds, label) =>
      void apply(() => reorderUnits(orderedIds, label)),
    onSelectUnit: (unitId, extend) =>
      setSelected((current) => selectUnit(current, unitId, extend, visibleUnits)),
  }

  // Window-level, because selecting is not something you do from inside a
  // focus container: by the time you want the lot, or want rid of it, the
  // keyboard is wherever the last click left it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // An open dialog owns the keyboard, Escape included: that is how it
      // closes.
      if (editing || isTyping(event.target)) return

      if (event.key === 'Escape') {
        setSelected((current) => (current.ids.size ? emptySelection() : current))
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        if (!visibleUnits.length) return
        // Otherwise the browser selects the text of the whole page instead.
        event.preventDefault()
        setSelected(selectAll(visibleUnits))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editing, visibleUnits])

  const endDrag = () => {
    draggingRef.current = null
    setDragging(null)
    setOver(null)
    planRef.current = null
  }

  const dnd: DndBindings = {
    dragging,
    isDragging: () => draggingRef.current !== null,
    over,
    onDragStart: (subject) => {
      draggingRef.current = subject
      setDragging(subject)
      setOver(null)
      planRef.current = null
    },
    onDragOver: (ref, zone) => {
      const subject = draggingRef.current
      if (!subject) return
      const plan = planDrop(subject, ref, zone, {
        formations: data.formations,
        units: data.units,
        echelons: data.echelons,
      })
      planRef.current = plan
      const key = refKey(ref)
      const ok = plan.kind !== 'rejected'
      const reason = plan.kind === 'rejected' ? plan.reason : undefined
      // Skip the state update when nothing visible changed, otherwise every
      // pixel of pointer movement re-renders the whole tree.
      setOver((current) =>
        current &&
        current.key === key &&
        current.zone === zone &&
        current.ok === ok
          ? current
          : { key, zone, ok, reason },
      )
    },
    onDrop: () => {
      const plan = planRef.current
      const subject = draggingRef.current
      endDrag()
      if (!plan || plan.kind === 'rejected' || !subject) return
      const name =
        subject.kind === 'formation'
          ? (data.formations.find((f) => f.id === subject.id)?.name ??
            'formation')
          : 'units'
      void apply(async () => {
        await applyDrop(plan, name)
        setSelected(emptySelection())
      })
    },
    onDragEnd: endDrag,
  }

  const moveTo = (target: MoveTarget) => {
    if (editing?.kind !== 'move') return
    const { subject } = editing
    if (subject.kind === 'formation') {
      void apply(() =>
        moveFormation({
          formationId: subject.formation.id,
          designId: data.design.id,
          name: subject.formation.name,
          newParentId: target.parentId,
          destination: target.name,
        }),
      )
      return
    }
    // Only formations can be detached to the top of the tree; a unit always
    // reports to something, so the picker never offers null for units.
    if (target.parentId === null) return
    void apply(async () => {
      await moveUnits({
        unitIds: subject.unitIds,
        targetFormationId: target.parentId as number,
        destination: target.name,
      })
      setSelected(emptySelection())
    })
  }

  const saveFormation = (values: { name: string; echelon: EchelonSymbol }) => {
    if (editing?.kind === 'edit-formation') {
      void apply(() => updateFormation(editing.formation.id, values))
    } else if (editing?.kind === 'add-formation') {
      void apply(() =>
        addFormation({
          designId: data.design.id,
          parentId: editing.parent?.id ?? null,
          ...values,
        }),
      )
    }
  }

  const saveUnit = (values: UnitValues) => {
    if (editing?.kind === 'edit-unit') {
      void apply(() => updateUnit(editing.unit.id, values))
    } else if (editing?.kind === 'add-unit') {
      void apply(() => addUnit({ formationId: editing.formation.id, ...values }))
    }
  }

  // The whole battle is one transaction and so one undo entry, labelled from
  // the optional battle name: "Undo: Losses — Battle of Portree".
  const applyBattle = (changes: StrengthChange[], label: string) => {
    void apply(() => applyStrengthChanges({ changes, label }))
  }

  const confirmDelete = (mode: DeleteMode) => {
    if (editing?.kind !== 'delete-formation') return
    const { node } = editing
    void apply(() =>
      deleteFormation({
        formationId: node.formation.id,
        parentId: node.formation.parentId,
        name: node.formation.name,
        mode,
        childFormationIds: node.children.map((c) => c.formation.id),
        attachedUnitIds: node.units.map((u) => u.id),
      }),
    )
  }

  return (
    <>
      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <OobTree
        tree={data.tree}
        echelons={data.echelons}
        problems={data.problems}
        actions={actions}
        selectedUnitIds={selected.ids}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        dnd={dnd}
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonStyles.quiet}
          onClick={() => setEditing({ kind: 'add-formation', parent: null })}
        >
          Add independent formation
        </button>
        <button
          type="button"
          className={buttonStyles.quiet}
          onClick={() => setEditing({ kind: 'battle' })}
        >
          Battle losses…
        </button>
        <button
          type="button"
          className={buttonStyles.quiet}
          onClick={() => setEditing({ kind: 'export' })}
        >
          Export YAML…
        </button>
      </div>

      {dragging && over && !over.ok && over.reason && (
        <p className="sticky bottom-3 rounded-lg border border-red-300 bg-red-50/95 p-2 text-sm text-red-800 shadow-lg backdrop-blur">
          {over.reason}
        </p>
      )}

      {selected.ids.size > 0 && (
        <div className="sticky bottom-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-300 bg-white/95 p-3 shadow-lg backdrop-blur">
          <span className="text-sm font-medium">
            {selected.ids.size} unit{selected.ids.size === 1 ? '' : 's'} selected
          </span>
          <span className="text-xs text-slate-500">
            Shift-click for a range · Ctrl+A for all · Esc to clear
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className={buttonStyles.quiet}
              title="Esc"
              onClick={() => setSelected(emptySelection())}
            >
              Clear
            </button>
            <button
              type="button"
              className={buttonStyles.primary}
              onClick={() =>
                setEditing({
                  kind: 'move',
                  subject: {
                    kind: 'units',
                    unitIds: [...selected.ids],
                    // A mixed selection has no single origin, so nothing is
                    // ruled out as "already here".
                    fromFormationId: -1,
                  },
                })
              }
            >
              Move to…
            </button>
          </div>
        </div>
      )}

      {(editing?.kind === 'add-formation' ||
        editing?.kind === 'edit-formation') && (
        <FormationForm
          echelons={data.echelons}
          parent={editing.kind === 'add-formation' ? editing.parent : null}
          existing={
            editing.kind === 'edit-formation' ? editing.formation : undefined
          }
          onSubmit={saveFormation}
          onClose={() => setEditing(null)}
        />
      )}

      {(editing?.kind === 'add-unit' || editing?.kind === 'edit-unit') && (
        <UnitForm
          unitTypes={data.unitTypes}
          formationName={
            editing.kind === 'add-unit' ? editing.formation.name : ''
          }
          existing={editing.kind === 'edit-unit' ? editing.unit : undefined}
          onSubmit={saveUnit}
          onClose={() => setEditing(null)}
        />
      )}

      {editing?.kind === 'delete-formation' && (
        <DeleteFormationPrompt
          node={editing.node}
          onConfirm={confirmDelete}
          onClose={() => setEditing(null)}
        />
      )}

      {editing?.kind === 'battle' && (
        <BattleDialog
          tree={data.tree}
          unitTypes={data.unitTypes}
          onApply={applyBattle}
          onClose={() => setEditing(null)}
        />
      )}

      {editing?.kind === 'export' && (
        <ExportDialog data={data} onClose={() => setEditing(null)} />
      )}

      {editing?.kind === 'move' && (
        <MoveDialog
          tree={data.tree}
          formations={data.formations}
          echelons={data.echelons}
          subject={editing.subject}
          onMove={moveTo}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
