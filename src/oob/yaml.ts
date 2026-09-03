import { parse } from 'yaml'
import type {
  EchelonSymbol,
  Formation,
  Problem,
  Unit,
  UnitCategory,
  UnitType,
} from './types.ts'

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

function asRecords(value: unknown, key: string): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return []
  const list = (value as Record<string, unknown>)[key]
  if (!Array.isArray(list)) return []
  return list.filter(
    (entry): entry is Record<string, unknown> =>
      !!entry && typeof entry === 'object',
  )
}

export type ParsedUnitTypes = {
  unitTypes: UnitType[]
  problems: Problem[]
}

export function parseUnitTypes(text: string): ParsedUnitTypes {
  const doc: unknown = parse(text)
  const problems: Problem[] = []
  const unitTypes: UnitType[] = []
  const seen = new Set<string>()

  for (const entry of asRecords(doc, 'land_units')) {
    const name = str(entry.name)
    if (!name) {
      problems.push({
        rule: 'unit-type-missing-name',
        message: 'A land_units entry has no name.',
      })
      continue
    }
    if (seen.has(name)) {
      problems.push({
        rule: 'duplicate-unit-type',
        message: `The catalog defines "${name}" more than once.`,
      })
      continue
    }
    seen.add(name)

    unitTypes.push({
      name,
      // Left unchecked here so validate() reports an unknown category the
      // same way it reports every other problem, rather than throwing.
      category: str(entry.type) as UnitCategory,
      description: str(entry.description),
      recruitCost: num(entry.recruit_cost),
      upkeepPerTurn: num(entry.upkeep_per_turn),
      buildTimeTurns: num(entry.build_time_turns),
      men: num(entry.men),
      weapons: num(entry.weapons),
    })
  }

  return { unitTypes, problems }
}

export type ParsedOob = {
  formations: Formation[]
  units: Unit[]
  /** The YAML's string `id` for each formation, mapped to its assigned number. */
  idByKey: Map<string, number>
  problems: Problem[]
}

/**
 * Maps an army-oob.yml document onto domain rows, assigning numeric ids in
 * file order. Ids are provisional: the repository reassigns them to avoid
 * colliding with rows already in the database.
 */
export function parseOob(text: string, designId = 0): ParsedOob {
  const doc: unknown = parse(text)
  const problems: Problem[] = []
  const idByKey = new Map<string, number>()

  const rawFormations = asRecords(doc, 'formations')
  rawFormations.forEach((entry, index) => {
    const key = str(entry.id)
    if (!key) {
      problems.push({
        rule: 'formation-missing-id',
        message: `Formation at position ${index + 1} has no id.`,
      })
      return
    }
    if (idByKey.has(key)) {
      problems.push({
        rule: 'duplicate-formation-key',
        message: `More than one formation uses the id "${key}".`,
      })
      return
    }
    idByKey.set(key, index + 1)
  })

  const formations: Formation[] = []
  rawFormations.forEach((entry, index) => {
    const key = str(entry.id)
    const id = idByKey.get(key)
    if (id === undefined || id !== index + 1) return

    const parentKey = entry.parent_id
    let parentId: number | null = null
    if (typeof parentKey === 'string' && parentKey !== '') {
      const resolved = idByKey.get(parentKey)
      if (resolved === undefined) {
        // Left at top level so the formation stays visible; the broken link
        // is reported rather than silently swallowed.
        problems.push({
          rule: 'unknown-parent-key',
          message: `"${str(entry.name, key)}" reports to "${parentKey}", which is not a formation in this file.`,
          formationId: id,
        })
      } else {
        parentId = resolved
      }
    }

    formations.push({
      id,
      designId,
      parentId,
      echelon: str(entry.echelon) as EchelonSymbol,
      name: str(entry.name, key),
      sortOrder: index,
    })
  })

  const units: Unit[] = []
  asRecords(doc, 'units').forEach((entry, index) => {
    const formationKey = str(entry.formation_id)
    const formationId = idByKey.get(formationKey)
    if (formationId === undefined) {
      problems.push({
        rule: 'unknown-formation-key',
        message: `"${str(entry.name, 'A unit')}" is attached to "${formationKey}", which is not a formation in this file.`,
      })
      return
    }

    units.push({
      id: index + 1,
      formationId,
      unitType: str(entry.unit_type),
      designation: str(entry.name),
      men: num(entry.men),
      weapons: num(entry.weapons),
      equipment: str(entry.equipment),
      sortOrder: index,
    })
  })

  return { formations, units, idByKey, problems }
}
