import { useState } from 'react'
import { OobTree, type TreeActions } from './OobTree.tsx'
import { FormationForm } from './FormationForm.tsx'
import { UnitForm, type UnitValues } from './UnitForm.tsx'
import { DeleteFormationPrompt } from './DeleteFormationPrompt.tsx'
import { buttonStyles } from './styles.ts'
import {
  addFormation,
  addUnit,
  deleteFormation,
  deleteUnit,
  updateFormation,
  updateUnit,
} from '../db/oob.ts'
import type { DeleteMode } from '../db/statements.ts'
import type { Loaded } from '../oob/load.ts'
import type { TreeNode } from '../oob/tree.ts'
import type { EchelonSymbol, Formation, Unit } from '../oob/types.ts'

type Editing =
  | { kind: 'add-formation'; parent: Formation | null }
  | { kind: 'edit-formation'; formation: Formation }
  | { kind: 'delete-formation'; node: TreeNode }
  | { kind: 'add-unit'; formation: Formation }
  | { kind: 'edit-unit'; unit: Unit }
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
      />

      <button
        type="button"
        className={buttonStyles.quiet}
        onClick={() => setEditing({ kind: 'add-formation', parent: null })}
      >
        Add independent formation
      </button>

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
    </>
  )
}
