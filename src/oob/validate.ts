import { isGunCounted } from './types.ts'
import type { Echelon, Formation, Problem, Unit, UnitType } from './types.ts'

export type ValidateInput = {
  formations: readonly Formation[]
  units: readonly Unit[]
  unitTypes: readonly UnitType[]
  echelons: readonly Echelon[]
}

/**
 * Every structural rule from mvp-oob-designer.md §6, returned as a list rather
 * than thrown — a design is allowed to sit broken while it is being
 * reorganized, and the editor needs every problem at once, not just the first.
 */
export function validate(input: ValidateInput): Problem[] {
  const { formations, units, unitTypes, echelons } = input
  const problems: Problem[] = []

  const levelOf = new Map(echelons.map((e) => [e.symbol, e.level]))
  const byId = new Map<number, Formation>()
  const typeByName = new Map(unitTypes.map((t) => [t.name, t]))

  for (const formation of formations) {
    if (byId.has(formation.id)) {
      problems.push({
        rule: 'duplicate-formation-id',
        message: `More than one formation uses id ${formation.id}.`,
        formationId: formation.id,
      })
      continue
    }
    byId.set(formation.id, formation)
  }

  for (const formation of formations) {
    if (!levelOf.has(formation.echelon)) {
      problems.push({
        rule: 'unknown-echelon',
        message: `"${formation.name}" uses echelon ${formation.echelon}, which is not a known tier.`,
        formationId: formation.id,
      })
    }

    if (formation.parentId === null) continue

    const parent = byId.get(formation.parentId)
    if (!parent) {
      problems.push({
        rule: 'unknown-parent',
        message: `"${formation.name}" reports to formation ${formation.parentId}, which does not exist.`,
        formationId: formation.id,
      })
      continue
    }

    const level = levelOf.get(formation.echelon)
    const parentLevel = levelOf.get(parent.echelon)
    if (level !== undefined && parentLevel !== undefined && level >= parentLevel) {
      problems.push({
        rule: 'echelon-order',
        message: `"${formation.name}" (${formation.echelon}) must sit below its parent "${parent.name}" (${parent.echelon}).`,
        formationId: formation.id,
      })
    }
  }

  for (const formation of formations) {
    const seen = new Set<number>([formation.id])
    let current = formation.parentId
    while (current !== null) {
      if (seen.has(current)) {
        problems.push({
          rule: 'cycle',
          message: `"${formation.name}" is its own ancestor.`,
          formationId: formation.id,
        })
        break
      }
      seen.add(current)
      current = byId.get(current)?.parentId ?? null
    }
  }

  for (const unit of units) {
    if (!byId.has(unit.formationId)) {
      problems.push({
        rule: 'unknown-formation',
        message: `"${unit.designation}" is attached to formation ${unit.formationId}, which does not exist.`,
        unitId: unit.id,
      })
    }

    const type = typeByName.get(unit.unitType)
    if (!type) {
      // Exact match only — no normalising, case-folding, or fuzzy matching.
      // See mvp-oob-designer.md §7 for why.
      problems.push({
        rule: 'unknown-unit-type',
        message: `"${unit.designation}" has unit type "${unit.unitType}", which is not in the catalog.`,
        unitId: unit.id,
      })
    }

    const hasMen = unit.men !== 0
    const hasWeapons = unit.weapons !== 0
    if (hasMen === hasWeapons) {
      problems.push({
        rule: 'strength-exclusive',
        message: hasMen
          ? `"${unit.designation}" records both men and guns; a unit carries one or the other.`
          : `"${unit.designation}" has no strength recorded.`,
        unitId: unit.id,
      })
    } else if (type) {
      const shouldUseGuns = isGunCounted(type.category)
      if (shouldUseGuns && hasMen) {
        problems.push({
          rule: 'strength-wrong-measure',
          message: `"${unit.designation}" is a ${type.category} unit, which is counted in guns, but records men.`,
          unitId: unit.id,
        })
      } else if (!shouldUseGuns && hasWeapons) {
        problems.push({
          rule: 'strength-wrong-measure',
          message: `"${unit.designation}" is a ${type.category} unit, which is counted in men, but records guns.`,
          unitId: unit.id,
        })
      }
    }
  }

  return problems
}

/** Whether a formation may be moved under a given parent. */
export function canReparent(
  formation: Formation,
  parent: Formation | null,
  formations: readonly Formation[],
  echelons: readonly Echelon[],
): { ok: true } | { ok: false; reason: string } {
  if (parent === null) return { ok: true }
  if (parent.id === formation.id) {
    return { ok: false, reason: 'A formation cannot report to itself.' }
  }

  const byId = new Map(formations.map((f) => [f.id, f]))
  let current: number | null = parent.id
  while (current !== null) {
    if (current === formation.id) {
      return {
        ok: false,
        reason: `"${parent.name}" is already below "${formation.name}".`,
      }
    }
    current = byId.get(current)?.parentId ?? null
  }

  const levelOf = new Map(echelons.map((e) => [e.symbol, e.level]))
  const level = levelOf.get(formation.echelon)
  const parentLevel = levelOf.get(parent.echelon)
  if (level !== undefined && parentLevel !== undefined && level >= parentLevel) {
    return {
      ok: false,
      reason: `A ${formation.echelon} cannot sit under a ${parent.echelon}.`,
    }
  }

  return { ok: true }
}
