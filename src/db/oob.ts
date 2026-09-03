import { query, transaction } from './client.ts'
import type { Statement } from './protocol.ts'
import type {
  Design,
  Echelon,
  EchelonSymbol,
  Formation,
  Unit,
  UnitCategory,
  UnitType,
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

const toUnit = (row: Row): Unit => ({
  id: num(row.id),
  formationId: num(row.formation_id),
  unitType: str(row.unit_type),
  designation: str(row.designation),
  men: num(row.men),
  weapons: num(row.weapons),
  equipment: str(row.equipment),
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
  await query('UPDATE echelons SET name = ? WHERE symbol = ?', [name, symbol])
}

export async function listUnitTypes(): Promise<UnitType[]> {
  const rows = await query('SELECT * FROM unit_types ORDER BY name')
  return rows.map(toUnitType)
}

/** Replaces the whole catalog. Fails if a unit still references a type being removed. */
export async function replaceUnitTypes(types: readonly UnitType[]): Promise<void> {
  await transaction([
    { sql: 'DELETE FROM unit_types' },
    ...types.map((type) => ({
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
    })),
  ])
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

export async function loadDesign(
  designId: number,
): Promise<{ formations: Formation[]; units: Unit[] }> {
  const [formationRows, unitRows] = await transaction([
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
  ])
  return {
    formations: formationRows.map(toFormation),
    units: unitRows.map(toUnit),
  }
}

async function nextId(table: 'oob_designs' | 'oob_formations' | 'oob_units') {
  const rows = await query(`SELECT COALESCE(MAX(id), 0) AS max_id FROM ${table}`)
  return num(rows[0]?.max_id) + 1
}

const insertFormation = (formation: Formation): Statement => ({
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

const insertUnit = (unit: Unit): Statement => ({
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

export type NewDesign = {
  name: string
  note?: string
  isLive?: boolean
  formations: readonly Formation[]
  units: readonly Unit[]
}

/**
 * Writes a design and its whole tree in one transaction, so a failure part
 * way through leaves nothing behind.
 *
 * Ids on the incoming formations and units are treated as file-local and
 * rewritten to avoid colliding with rows already stored. Reading the current
 * maximums first is safe because the OPFS pool admits a single connection.
 */
export async function createDesign(design: NewDesign): Promise<number> {
  const [designId, formationBase, unitBase] = await Promise.all([
    nextId('oob_designs'),
    nextId('oob_formations'),
    nextId('oob_units'),
  ])

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

  await transaction([
    {
      sql: 'INSERT INTO oob_designs (id, name, note, is_live) VALUES (?, ?, ?, ?)',
      params: [designId, design.name, design.note ?? '', design.isLive ? 1 : 0],
    },
    ...formations.map(insertFormation),
    ...units.map(insertUnit),
  ])

  return designId
}

export async function deleteDesign(designId: number): Promise<void> {
  // Formations and units go with it via ON DELETE CASCADE.
  await query('DELETE FROM oob_designs WHERE id = ?', [designId])
}

export async function renameDesign(
  designId: number,
  name: string,
  note: string,
): Promise<void> {
  await query('UPDATE oob_designs SET name = ?, note = ? WHERE id = ?', [
    name,
    note,
    designId,
  ])
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
  ])
}
