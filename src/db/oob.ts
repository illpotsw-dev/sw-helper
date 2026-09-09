import { query, transaction } from './client.ts'
import {
  applyMovementStatements,
  applyStrengthStatements,
  catalogStatements,
  creditStock,
  debitStock,
  deleteFormationStatements,
  designStatements,
  insertFormation,
  insertUnit,
  insertUnitType,
  rearmUnitStatements,
  moveFormationStatements,
  moveUnitsAndOrderStatements,
  moveUnitsStatements,
  reparentAndOrderStatements,
  resequenceFormationStatements,
  resequenceUnitStatements,
  type DeleteMode,
  type NewDesign,
} from './statements.ts'
import type { DropPlan } from '../oob/dnd.ts'
export type { NewDesign, DeleteMode }
import type {
  Arming,
  Design,
  Echelon,
  EchelonSymbol,
  Formation,
  Holding,
  StockEntry,
  Unit,
  UnitCategory,
  UnitType,
  Weapon,
  WeaponClass,
} from '../oob/types.ts'

type Row = Record<string, unknown>

const str = (value: unknown): string => (value == null ? '' : String(value))
const num = (value: unknown): number => Number(value ?? 0)

const toEchelon = (row: Row): Echelon => ({
  symbol: str(row.symbol) as EchelonSymbol,
  level: num(row.level),
  name: str(row.name),
})

const toUnitType = (row: Row): UnitType => ({
  name: str(row.name),
  category: str(row.type) as UnitCategory,
  description: str(row.description),
  recruitCost: num(row.recruit_cost),
  upkeepPerTurn: num(row.upkeep_per_turn),
  buildTimeTurns: num(row.build_time_turns),
  men: num(row.men),
  weapons: num(row.weapons),
})

const toWeapon = (row: Row): Weapon => ({
  name: str(row.name),
  class: str(row.class) as WeaponClass,
  origin: str(row.origin),
  description: str(row.description),
})

const toStockEntry = (row: Row): StockEntry => ({
  weapon: str(row.weapon),
  quantity: num(row.quantity),
})

const toDesign = (row: Row): Design => ({
  id: num(row.id),
  name: str(row.name),
  note: str(row.note),
  isLive: num(row.is_live) === 1,
})

const toFormation = (row: Row): Formation => ({
  id: num(row.id),
  designId: num(row.design_id),
  parentId: row.parent_id == null ? null : num(row.parent_id),
  echelon: str(row.echelon) as EchelonSymbol,
  name: str(row.name),
  sortOrder: num(row.sort_order),
})

const toHolding = (row: Row): Holding => ({
  unitId: num(row.unit_id),
  weapon: str(row.weapon),
  quantity: num(row.quantity),
})

const toUnit = (row: Row, holding: Holding | undefined): Unit => ({
  id: num(row.id),
  formationId: num(row.formation_id),
  unitType: str(row.unit_type),
  designation: str(row.designation),
  men: num(row.men),
  weapons: num(row.weapons),
  weapon: holding?.weapon ?? '',
  weaponCount: holding?.quantity ?? 0,
  sortOrder: num(row.sort_order),
})

export async function listEchelons(): Promise<Echelon[]> {
  const rows = await query('SELECT * FROM echelons ORDER BY level DESC')
  return rows.map(toEchelon)
}

export async function renameEchelon(
  symbol: EchelonSymbol,
  name: string,
): Promise<void> {
  await query(
    'UPDATE echelons SET name = ? WHERE symbol = ?',
    [name, symbol],
    `Rename ${symbol} to "${name}"`,
  )
}

export async function listUnitTypes(): Promise<UnitType[]> {
  const rows = await query('SELECT * FROM unit_types ORDER BY name')
  return rows.map(toUnitType)
}

/** Replaces the whole catalog. Fails if a unit still references a type being removed. */
export async function replaceUnitTypes(types: readonly UnitType[]): Promise<void> {
  await transaction(
    [{ sql: 'DELETE FROM unit_types' }, ...types.map(insertUnitType)],
    'Replace unit type catalog',
  )
}

export async function listWeapons(): Promise<Weapon[]> {
  const rows = await query('SELECT * FROM weapons ORDER BY name')
  return rows.map(toWeapon)
}

/**
 * What is in the pile, one row per catalog weapon including the empty ones —
 * a pattern the nation owns none of is still worth showing, so the player can
 * see the arsenal has none rather than wonder where it went.
 */
export async function listStock(): Promise<StockEntry[]> {
  const rows = await query(
    'SELECT weapon, quantity FROM weapon_stock ORDER BY weapon',
  )
  return rows.map(toStockEntry)
}

export async function listDesigns(): Promise<Design[]> {
  const rows = await query(
    'SELECT * FROM oob_designs ORDER BY is_live DESC, name',
  )
  return rows.map(toDesign)
}

export async function getLiveDesign(): Promise<Design | null> {
  const rows = await query('SELECT * FROM oob_designs WHERE is_live = 1')
  return rows.length ? toDesign(rows[0]) : null
}

export async function loadDesign(designId: number): Promise<{
  formations: Formation[]
  units: Unit[]
  /** Every holding as stored, so a unit carrying two can be reported as one. */
  holdings: Holding[]
}> {
  // Holdings come back as their own list rather than as a join onto the units,
  // so a unit that has somehow acquired two of them appears once with its
  // first holding and is reported by validate(), rather than appearing twice
  // in the tree.
  const [formationRows, unitRows, holdingRows] = await transaction([
    {
      sql: 'SELECT * FROM oob_formations WHERE design_id = ? ORDER BY sort_order, id',
      params: [designId],
    },
    {
      sql: `SELECT u.* FROM oob_units u
            JOIN oob_formations f ON f.id = u.formation_id
            WHERE f.design_id = ?
            ORDER BY u.sort_order, u.id`,
      params: [designId],
    },
    {
      sql: `SELECT w.* FROM oob_unit_weapons w
            JOIN oob_units u ON u.id = w.unit_id
            JOIN oob_formations f ON f.id = u.formation_id
            WHERE f.design_id = ?
            ORDER BY w.unit_id, w.weapon`,
      params: [designId],
    },
  ])

  const holdings = holdingRows.map(toHolding)
  const firstHolding = new Map<number, Holding>()
  for (const holding of holdings) {
    if (!firstHolding.has(holding.unitId)) firstHolding.set(holding.unitId, holding)
  }

  return {
    formations: formationRows.map(toFormation),
    units: unitRows.map((row) => toUnit(row, firstHolding.get(num(row.id)))),
    holdings,
  }
}

async function nextId(table: 'oob_designs' | 'oob_formations' | 'oob_units') {
  const rows = await query(`SELECT COALESCE(MAX(id), 0) AS max_id FROM ${table}`)
  return num(rows[0]?.max_id) + 1
}

/**
 * Writes a design and its whole tree in one transaction, so a failure part
 * way through leaves nothing behind.
 *
 * Ids on the incoming formations and units are treated as file-local and
 * rewritten to avoid colliding with rows already stored. Reading the current
 * maximums first is safe because the OPFS pool admits a single connection.
 */
const nextIds = () =>
  Promise.all([
    nextId('oob_designs'),
    nextId('oob_formations'),
    nextId('oob_units'),
  ])

export async function createDesign(design: NewDesign): Promise<number> {
  const [designId, formationBase, unitBase] = await nextIds()
  await transaction(
    designStatements(designId, formationBase, unitBase, design),
    `Create design "${design.name}"`,
  )
  return designId
}

/**
 * Loads a nation's two catalogs, its opening stockpile and its starting order
 * of battle together, as one transaction and one undo entry — a half-seeded
 * nation whose units reference types or weapons that were never written would
 * fail the exact-match rule on every row.
 */
export async function seedNation(input: {
  label: string
  unitTypes: readonly UnitType[]
  weapons: readonly Weapon[]
  stock: readonly StockEntry[]
  design: NewDesign
}): Promise<number> {
  const [designId, formationBase, unitBase] = await nextIds()
  await transaction(
    [
      ...input.unitTypes.map(insertUnitType),
      ...catalogStatements(input.weapons, input.stock),
      ...designStatements(designId, formationBase, unitBase, input.design),
    ],
    input.label,
  )
  return designId
}

/** Next free slot among a formation's siblings, so new rows land at the end. */
async function nextSortOrder(
  designId: number,
  parentId: number | null,
): Promise<number> {
  // `IS` rather than `=` so a NULL parent matches top-level formations.
  const rows = await query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM oob_formations
     WHERE design_id = ? AND parent_id IS ?`,
    [designId, parentId],
  )
  return num(rows[0]?.next)
}

export async function addFormation(input: {
  designId: number
  parentId: number | null
  echelon: EchelonSymbol
  name: string
}): Promise<number> {
  const [id, sortOrder] = await Promise.all([
    nextId('oob_formations'),
    nextSortOrder(input.designId, input.parentId),
  ])
  await transaction(
    [insertFormation({ ...input, id, sortOrder })],
    `Add ${input.name}`,
  )
  return id
}

export async function updateFormation(
  id: number,
  changes: { name: string; echelon: EchelonSymbol },
): Promise<void> {
  await query(
    'UPDATE oob_formations SET name = ?, echelon = ? WHERE id = ?',
    [changes.name, changes.echelon, id],
    `Edit ${changes.name}`,
  )
}

/**
 * What every unit under a formation is carrying, totalled per weapon. Used to
 * put a deleted subtree's weapons back in the pile — disbanding a division
 * does not destroy its rifles, and nothing crosses the nation's boundary
 * without an explicit disposal or a combat loss (mvp-stockpile.md §4).
 */
async function subtreeHoldings(
  formationId: number,
): Promise<{ weapon: string; quantity: number }[]> {
  const rows = await query(
    `WITH RECURSIVE subtree(id) AS (
       SELECT id FROM oob_formations WHERE id = ?
       UNION ALL
       SELECT f.id FROM oob_formations f JOIN subtree s ON f.parent_id = s.id
     )
     SELECT w.weapon AS weapon, SUM(w.quantity) AS quantity
     FROM oob_unit_weapons w
     JOIN oob_units u ON u.id = w.unit_id
     WHERE u.formation_id IN (SELECT id FROM subtree)
     GROUP BY w.weapon
     HAVING SUM(w.quantity) > 0`,
    [formationId],
  )
  return rows.map((row) => ({
    weapon: str(row.weapon),
    quantity: num(row.quantity),
  }))
}

export async function deleteFormation(input: {
  formationId: number
  parentId: number | null
  name: string
  mode: DeleteMode
  childFormationIds: readonly number[]
  attachedUnitIds: readonly number[]
}): Promise<void> {
  // Promoting deletes no unit, so nothing is handed back; only a subtree
  // delete strikes units off, and those units' weapons return to the pile.
  const returns =
    input.mode === 'subtree' && (await formationIsLive(input.formationId))
      ? await subtreeHoldings(input.formationId)
      : []

  await transaction(
    [
      ...returns.map((entry) => creditStock(entry.weapon, entry.quantity)),
      ...deleteFormationStatements(input),
    ],
    input.mode === 'subtree'
      ? `Delete ${input.name} and everything under it`
      : `Delete ${input.name}`,
  )
}

async function nextUnitSortOrder(formationId: number): Promise<number> {
  const rows = await query(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM oob_units
     WHERE formation_id = ?`,
    [formationId],
  )
  return num(rows[0]?.next)
}

/**
 * Whether writes to this formation's design move real weapons. Holdings on a
 * saved design are intentions, not property, and are reconciled against the
 * pile only at promote-to-live — see mvp-stockpile.md §4.
 */
async function formationIsLive(formationId: number): Promise<boolean> {
  const rows = await query(
    `SELECT d.is_live AS is_live FROM oob_formations f
     JOIN oob_designs d ON d.id = f.design_id
     WHERE f.id = ?`,
    [formationId],
  )
  return num(rows[0]?.is_live) === 1
}

/** A unit's formation and current holding, for a movement that displaces it. */
async function unitContext(
  unitId: number,
): Promise<{ isLive: boolean; holding: { weapon: string; quantity: number } }> {
  const [designRows, holdingRows] = await transaction([
    {
      sql: `SELECT d.is_live AS is_live FROM oob_units u
            JOIN oob_formations f ON f.id = u.formation_id
            JOIN oob_designs d ON d.id = f.design_id
            WHERE u.id = ?`,
      params: [unitId],
    },
    {
      sql: `SELECT weapon, quantity FROM oob_unit_weapons
            WHERE unit_id = ? ORDER BY weapon`,
      params: [unitId],
    },
  ])

  const first = holdingRows[0]
  return {
    isLive: num(designRows[0]?.is_live) === 1,
    holding: first
      ? { weapon: str(first.weapon), quantity: num(first.quantity) }
      : { weapon: '', quantity: 0 },
  }
}

/**
 * Raises a unit. On the live Order of Battle an armed one draws its holding
 * from the stockpile in the same transaction, so nothing is conjured by
 * typing: the caller offers only what is in stock, and an overdraw fails the
 * whole write rather than minting rifles.
 */
export async function addUnit(input: {
  formationId: number
  unitType: string
  designation: string
  men: number
  weapons: number
  weapon: string
  weaponCount: number
}): Promise<number> {
  const [id, sortOrder, isLive] = await Promise.all([
    nextId('oob_units'),
    nextUnitSortOrder(input.formationId),
    formationIsLive(input.formationId),
  ])
  await transaction(
    [
      ...insertUnit({ ...input, id, sortOrder }),
      ...(isLive && input.weapon !== '' && input.weaponCount > 0
        ? [debitStock(input.weapon, input.weaponCount)]
        : []),
    ],
    `Add ${input.designation}`,
  )
  return id
}

/**
 * Edits a unit, moving whatever weapons the edit displaces. Re-arming a
 * battalion here is the same movement the re-arm dialog makes: the old pattern
 * goes back to the pile and the new one comes out of it, in one transaction
 * and one undo entry.
 */
export async function updateUnit(
  id: number,
  changes: {
    unitType: string
    designation: string
    men: number
    weapons: number
    weapon: string
    weaponCount: number
  },
): Promise<void> {
  const { isLive, holding } = await unitContext(id)

  await transaction(
    [
      {
        sql: `UPDATE oob_units
              SET unit_type = ?, designation = ?, men = ?, weapons = ?
              WHERE id = ?`,
        params: [
          changes.unitType,
          changes.designation,
          changes.men,
          changes.weapons,
          id,
        ],
      },
      ...rearmUnitStatements({
        unitId: id,
        from: holding,
        to: { weapon: changes.weapon, quantity: changes.weaponCount },
        movesStock: isLive,
      }),
    ],
    `Edit ${changes.designation}`,
  )
}

/**
 * Reparents a formation, subtree and all. The caller is responsible for having
 * checked canReparent — the UI only offers destinations that pass, so an
 * invalid tree is unreachable rather than merely reported.
 */
export async function moveFormation(input: {
  formationId: number
  designId: number
  name: string
  newParentId: number | null
  destination: string
}): Promise<void> {
  const sortOrder = await nextSortOrder(input.designId, input.newParentId)
  await transaction(
    moveFormationStatements({ ...input, sortOrder }),
    `Move ${input.name} to ${input.destination}`,
  )
}

export async function moveUnits(input: {
  unitIds: readonly number[]
  targetFormationId: number
  destination: string
}): Promise<void> {
  const startSortOrder = await nextUnitSortOrder(input.targetFormationId)
  const count = input.unitIds.length
  await transaction(
    moveUnitsStatements({ ...input, startSortOrder }),
    `Move ${count === 1 ? 'unit' : `${count} units`} to ${input.destination}`,
  )
}

/**
 * Carries out a drop worked out by planDrop. Rejected plans never reach here —
 * the tree refuses them while dragging — so this only handles the two kinds
 * that describe real work.
 */
export async function applyDrop(
  plan: Extract<DropPlan, { kind: 'formation' | 'units' }>,
  subjectName: string,
): Promise<void> {
  if (plan.kind === 'formation') {
    await transaction(
      reparentAndOrderStatements(plan),
      `Move ${subjectName} to ${plan.destination}`,
    )
    return
  }
  const count = plan.unitIds.length
  await transaction(
    moveUnitsAndOrderStatements(plan),
    `Move ${count === 1 ? 'unit' : `${count} units`} to ${plan.destination}`,
  )
}

/**
 * Applies a battle's losses or reinforcements. The label carries the optional
 * battle name so history reads "Undo: Losses — Battle of Portree" rather than
 * "Undo: Edit unit".
 */
export async function applyStrengthChanges(input: {
  changes: readonly { unitId: number; men: number; weapons: number }[]
  label: string
}): Promise<void> {
  await transaction(applyStrengthStatements(input.changes), input.label)
}

/**
 * Carries out a movement worked out by planMovement. One transaction, one undo
 * entry, labelled with what it did — "Undo: Re-arm 1st Infantry Brigade"
 * rather than "Undo: Edit unit".
 *
 * A blocked plan never reaches here: the dialog will not commit one, and a
 * plan that would overdraw the pile fails the non-negative CHECK and rolls
 * back whole rather than committing part of itself.
 */
export async function applyMovement(input: {
  rows: readonly { unitId: number; from: Arming; to: Arming }[]
  movesStock: boolean
  label: string
}): Promise<void> {
  if (input.rows.length === 0) return
  await transaction(
    applyMovementStatements(input.rows, input.movesStock),
    input.label,
  )
}

/**
 * A weapon crossing the nation's boundary: bought, captured or given, and the
 * reverse. The only movements the app cannot derive, and the only ones besides
 * a combat loss that change what the nation owns.
 */
export async function adjustStock(input: {
  weapon: string
  /** Positive acquires, negative disposes. */
  delta: number
  label: string
}): Promise<void> {
  await transaction(
    [
      input.delta >= 0
        ? creditStock(input.weapon, input.delta)
        : debitStock(input.weapon, -input.delta),
    ],
    input.label,
  )
}

/**
 * Adds a pattern the nation has never held. A capture is often the first time
 * it has seen one at all, so this exists to be called mid-flow rather than
 * sending the player to a catalog screen — see mvp-stockpile.md §6.
 */
export async function addWeapon(weapon: Weapon, quantity = 0): Promise<void> {
  await transaction(
    catalogStatements([weapon], [{ weapon: weapon.name, quantity }]),
    `Add ${weapon.name} to the weapon catalog`,
  )
}

export async function reorderFormations(
  orderedIds: readonly number[],
  label: string,
): Promise<void> {
  await transaction(resequenceFormationStatements(orderedIds), label)
}

export async function reorderUnits(
  orderedIds: readonly number[],
  label: string,
): Promise<void> {
  await transaction(resequenceUnitStatements(orderedIds), label)
}

/**
 * Strikes a unit off. Its weapons go back to the pile rather than out of the
 * nation's possession — disbanding a battalion is not the same as losing one,
 * and only an explicit disposal or a combat loss destroys a weapon.
 */
export async function deleteUnit(id: number, designation: string): Promise<void> {
  const { isLive, holding } = await unitContext(id)
  await transaction(
    [
      ...(isLive && holding.weapon !== '' && holding.quantity > 0
        ? [creditStock(holding.weapon, holding.quantity)]
        : []),
      // The holding row goes with the unit by ON DELETE CASCADE.
      { sql: 'DELETE FROM oob_units WHERE id = ?', params: [id] },
    ],
    `Delete ${designation}`,
  )
}

/** Whether this browser already holds a nation. */
export async function hasNation(): Promise<boolean> {
  const rows = await query('SELECT count(*) AS n FROM oob_designs')
  return Number(rows[0]?.n ?? 0) > 0
}

export async function deleteDesign(designId: number): Promise<void> {
  // Formations and units go with it via ON DELETE CASCADE.
  await query(
    'DELETE FROM oob_designs WHERE id = ?',
    [designId],
    'Delete design',
  )
}

export async function renameDesign(
  designId: number,
  name: string,
  note: string,
): Promise<void> {
  await query(
    'UPDATE oob_designs SET name = ?, note = ? WHERE id = ?',
    [name, note, designId],
    `Rename design to "${name}"`,
  )
}

/**
 * Makes a design the live one. The single-live-design index forbids two live
 * rows existing at once, so the outgoing design must be stood down inside the
 * same transaction rather than before it.
 */
export async function promoteDesign(designId: number): Promise<void> {
  await transaction([
    { sql: 'UPDATE oob_designs SET is_live = 0 WHERE is_live = 1' },
    { sql: 'UPDATE oob_designs SET is_live = 1 WHERE id = ?', params: [designId] },
  ], 'Promote design to live')
}
