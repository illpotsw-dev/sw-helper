/**
 * SQL builders for OOB writes. Kept apart from the repository so they carry no
 * dependency on the worker client, which lets tests run the same statements the
 * app issues against a plain SQLite database.
 */
import type { Statement } from './protocol.ts'
import type {
  Formation,
  StockEntry,
  Unit,
  UnitType,
  Weapon,
} from '../oob/types.ts'

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

export const insertWeapon = (weapon: Weapon): Statement => ({
  sql: `INSERT INTO weapons (name, class, origin, description)
    VALUES (?, ?, ?, ?)`,
  params: [weapon.name, weapon.class, weapon.origin, weapon.description],
})

/**
 * Opens a pattern's place in the pile. Every catalog weapon gets a row, at
 * zero when none are spare, so a movement is always an UPDATE and never has to
 * decide whether the row it is drawing from exists.
 */
export const insertStock = (entry: StockEntry): Statement => ({
  sql: 'INSERT INTO weapon_stock (weapon, quantity) VALUES (?, ?)',
  params: [entry.weapon, entry.quantity],
})

/** Weapons coming back into the pile. */
export const creditStock = (weapon: string, quantity: number): Statement => ({
  sql: 'UPDATE weapon_stock SET quantity = quantity + ? WHERE weapon = ?',
  params: [Math.trunc(quantity), weapon],
})

/**
 * Weapons leaving the pile. The non-negative CHECK on weapon_stock makes an
 * overdraw fail the whole transaction rather than clamp, which is why every
 * caller credits its returns before reaching here.
 */
export const debitStock = (weapon: string, quantity: number): Statement => ({
  sql: 'UPDATE weapon_stock SET quantity = quantity - ? WHERE weapon = ?',
  params: [Math.trunc(quantity), weapon],
})

export type Holding = { weapon: string; quantity: number }

/**
 * One unit's half of a movement: what it hands back, what it takes up, and the
 * two sides of the pile that go with them.
 *
 * Returns are written before draws, always. SQLite evaluates the non-negative
 * CHECK per statement rather than at COMMIT, so a battalion handing in 975
 * Barclays to take 975 Lexingtons out of a pile holding 900 must credit first
 * or fail on a shortfall it does not have.
 *
 * `movesStock` is false on a saved design, where a holding is an intention
 * rather than property: the ledger counts the live Order of Battle only, or
 * duplicating a design would double the nation's arsenal on paper.
 */
export function rearmUnitStatements(input: {
  unitId: number
  from: Holding
  to: Holding
  movesStock: boolean
}): Statement[] {
  const { unitId, from, to, movesStock } = input
  const returns =
    movesStock && from.weapon !== '' && from.quantity > 0
      ? [creditStock(from.weapon, from.quantity)]
      : []
  const draws =
    movesStock && to.weapon !== '' && to.quantity > 0
      ? [debitStock(to.weapon, to.quantity)]
      : []

  return [
    ...returns,
    ...setHoldingStatements(unitId, to.weapon, to.quantity),
    ...draws,
  ]
}

/** Rows for a whole catalog and the pile that goes with it. */
export function catalogStatements(
  weapons: readonly Weapon[],
  stock: readonly StockEntry[],
): Statement[] {
  const quantityOf = new Map(stock.map((entry) => [entry.weapon, entry.quantity]))
  return [
    ...weapons.map(insertWeapon),
    ...weapons.map((weapon) =>
      insertStock({
        weapon: weapon.name,
        quantity: quantityOf.get(weapon.name) ?? 0,
      }),
    ),
  ]
}

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

/**
 * A unit and what it carries. Two tables, so two statements — an unarmed unit
 * gets no holding row at all rather than a row of nothing, which is what makes
 * "unarmed" and "holds zero rifles" the same statement.
 */
export const insertUnit = (unit: Unit): Statement[] => [
  {
    sql: `INSERT INTO oob_units
    (id, formation_id, unit_type, designation, men, weapons, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [
      unit.id,
      unit.formationId,
      unit.unitType,
      unit.designation,
      unit.men,
      unit.weapons,
      unit.sortOrder,
    ],
  },
  ...setHoldingStatements(unit.id, unit.weapon, unit.weaponCount),
]

/**
 * Writes a unit's holding, replacing whatever it had. Deleting first covers
 * the re-arm case — a unit takes one pattern, so a new weapon displaces the
 * old rather than joining it — and leaves a unit assigned no weapon with no
 * row, which is what makes "unarmed" and "holds nothing" the same statement.
 *
 * A weapon with a count of zero still gets a row. A battalion wiped out in
 * battle keeps the assignment without the rifles — it still reads as a Warden
 * Rifle battalion — so that when replacements arrive the app already knows
 * what to ask the stockpile for (mvp-stockpile.md §2.3).
 *
 * This moves no stock on its own. The pile is the other half of the ledger,
 * credited and debited by the caller in the same transaction.
 */
export const setHoldingStatements = (
  unitId: number,
  weapon: string,
  quantity: number,
): Statement[] => {
  const statements: Statement[] = [
    { sql: 'DELETE FROM oob_unit_weapons WHERE unit_id = ?', params: [unitId] },
  ]
  if (weapon !== '') {
    statements.push({
      sql: `INSERT INTO oob_unit_weapons (unit_id, weapon, quantity)
        VALUES (?, ?, ?)`,
      params: [unitId, weapon, Math.max(0, Math.trunc(quantity))],
    })
  }
  return statements
}

/**
 * Reparents a formation. Its subtree comes along for free — children reference
 * it by id, so nothing below it needs touching.
 */
export const moveFormationStatements = (input: {
  formationId: number
  newParentId: number | null
  sortOrder: number
}): Statement[] => [
  {
    sql: 'UPDATE oob_formations SET parent_id = ?, sort_order = ? WHERE id = ?',
    params: [input.newParentId, input.sortOrder, input.formationId],
  },
]

/** Reattaches units to another formation, keeping the order they were listed in. */
export const moveUnitsStatements = (input: {
  unitIds: readonly number[]
  targetFormationId: number
  startSortOrder: number
}): Statement[] =>
  input.unitIds.map((id, index) => ({
    sql: 'UPDATE oob_units SET formation_id = ?, sort_order = ? WHERE id = ?',
    params: [input.targetFormationId, input.startSortOrder + index, id],
  }))

// Rewriting every sibling's position from its index is steadier than swapping
// pairs: gaps and duplicate sort_order values heal themselves on the next
// reorder rather than accumulating.
export const resequenceFormationStatements = (
  orderedIds: readonly number[],
): Statement[] =>
  orderedIds.map((id, index) => ({
    sql: 'UPDATE oob_formations SET sort_order = ? WHERE id = ?',
    params: [index, id],
  }))

export const resequenceUnitStatements = (
  orderedIds: readonly number[],
): Statement[] =>
  orderedIds.map((id, index) => ({
    sql: 'UPDATE oob_units SET sort_order = ? WHERE id = ?',
    params: [index, id],
  }))

/**
 * Reparents a formation and fixes the resulting sibling order in one go. A drag
 * usually does both at once — dropping between two rows changes who the parent
 * is and where in the list it lands.
 */
export const reparentAndOrderStatements = (input: {
  formationId: number
  newParentId: number | null
  orderedSiblingIds: readonly number[]
}): Statement[] => [
  {
    sql: 'UPDATE oob_formations SET parent_id = ? WHERE id = ?',
    params: [input.newParentId, input.formationId],
  },
  ...resequenceFormationStatements(input.orderedSiblingIds),
]

export const moveUnitsAndOrderStatements = (input: {
  unitIds: readonly number[]
  targetFormationId: number
  orderedUnitIds: readonly number[]
}): Statement[] => [
  ...input.unitIds.map((id) => ({
    sql: 'UPDATE oob_units SET formation_id = ? WHERE id = ?',
    params: [input.targetFormationId, id],
  })),
  ...resequenceUnitStatements(input.orderedUnitIds),
]

/**
 * Writes a battle's outcome onto the units that fought. One UPDATE per
 * changed unit, run in a single transaction, so the whole battle lands as one
 * undo entry and a partial write is impossible.
 *
 * Nothing is deleted: a unit taken to zero stays in the tree as a paper unit,
 * keeping its designation, equipment and place. Removing it is a separate and
 * separately-undoable decision, not one the calculator makes on the player's
 * behalf.
 */
export const applyStrengthStatements = (
  changes: readonly { unitId: number; men: number; weapons: number }[],
): Statement[] =>
  changes.map((change) => ({
    sql: 'UPDATE oob_units SET men = ?, weapons = ? WHERE id = ?',
    params: [change.men, change.weapons, change.unitId],
  }))

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
    ...units.flatMap(insertUnit),
  ]
}
