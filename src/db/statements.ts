/**
 * SQL builders for OOB writes. Kept apart from the repository so they carry no
 * dependency on the worker client, which lets tests run the same statements the
 * app issues against a plain SQLite database.
 */
import type { Statement } from './protocol.ts'
import type { Formation, Unit, UnitType } from '../oob/types.ts'

export const insertUnitType = (type: UnitType): Statement => ({
  sql: `INSERT INTO unit_types
    (name, type, description, recruit_cost, upkeep_per_turn,
     build_time_turns, men, weapons)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  params: [
    type.name,
    type.category,
    type.description,
    type.recruitCost,
    type.upkeepPerTurn,
    type.buildTimeTurns,
    type.men,
    type.weapons,
  ],
})

export const insertFormation = (formation: Formation): Statement => ({
  sql: `INSERT INTO oob_formations
    (id, design_id, parent_id, echelon, name, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)`,
  params: [
    formation.id,
    formation.designId,
    formation.parentId,
    formation.echelon,
    formation.name,
    formation.sortOrder,
  ],
})

export const insertUnit = (unit: Unit): Statement => ({
  sql: `INSERT INTO oob_units
    (id, formation_id, unit_type, designation, men, weapons, equipment, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  params: [
    unit.id,
    unit.formationId,
    unit.unitType,
    unit.designation,
    unit.men,
    unit.weapons,
    unit.equipment,
    unit.sortOrder,
  ],
})

export type DeleteMode = 'promote' | 'subtree'

/**
 * Statements to remove a formation.
 *
 * 'subtree' leans on ON DELETE CASCADE to take everything below it. 'promote'
 * first moves the children and any directly attached units up to the parent,
 * so only the formation itself goes.
 *
 * Promoting is always sound with respect to echelons: the children already sit
 * below the formation, which sits below the parent, so they still sit below the
 * parent afterwards. Units are the exception — a root formation has nowhere to
 * promote them to, which is why canPromote() refuses that case rather than
 * quietly deleting them.
 */
export function deleteFormationStatements(input: {
  formationId: number
  parentId: number | null
  mode: DeleteMode
  childFormationIds: readonly number[]
  attachedUnitIds: readonly number[]
}): Statement[] {
  const { formationId, parentId, mode, childFormationIds, attachedUnitIds } = input

  if (mode === 'subtree') {
    return [
      { sql: 'DELETE FROM oob_formations WHERE id = ?', params: [formationId] },
    ]
  }

  if (attachedUnitIds.length > 0 && parentId === null) {
    throw new Error(
      'Cannot promote units out of a top-level formation: they would have nowhere to report to.',
    )
  }

  return [
    ...childFormationIds.map((id) => ({
      sql: 'UPDATE oob_formations SET parent_id = ? WHERE id = ?',
      params: [parentId, id],
    })),
    ...attachedUnitIds.map((id) => ({
      sql: 'UPDATE oob_units SET formation_id = ? WHERE id = ?',
      params: [parentId, id],
    })),
    { sql: 'DELETE FROM oob_formations WHERE id = ?', params: [formationId] },
  ]
}

/** Whether "promote children" is offerable for a formation. */
export const canPromote = (
  parentId: number | null,
  attachedUnitCount: number,
): boolean => parentId !== null || attachedUnitCount === 0

export type NewDesign = {
  name: string
  note?: string
  isLive?: boolean
  formations: readonly Formation[]
  units: readonly Unit[]
}

/**
 * Statements to write a design and its whole tree.
 *
 * Ids on the incoming rows are treated as file-local and rewritten from the
 * given bases, so a tree parsed out of a YAML file cannot collide with rows
 * already stored.
 */
export function designStatements(
  designId: number,
  formationBase: number,
  unitBase: number,
  design: NewDesign,
): Statement[] {
  const formationId = new Map(
    design.formations.map((f, index) => [f.id, formationBase + index]),
  )

  const formations = design.formations.map((formation, index) => ({
    ...formation,
    id: formationBase + index,
    designId,
    parentId:
      formation.parentId === null
        ? null
        : (formationId.get(formation.parentId) ?? null),
  }))

  const units = design.units.map((unit, index) => ({
    ...unit,
    id: unitBase + index,
    formationId: formationId.get(unit.formationId) ?? unit.formationId,
  }))

  return [
    {
      sql: 'INSERT INTO oob_designs (id, name, note, is_live) VALUES (?, ?, ?, ?)',
      params: [designId, design.name, design.note ?? '', design.isLive ? 1 : 0],
    },
    ...formations.map(insertFormation),
    ...units.map(insertUnit),
  ]
}
