import { armingGap, classForCategory, isError, isGunCounted } from './types.ts'
import type {
  Echelon,
  Formation,
  Holding,
  Problem,
  StockEntry,
  Unit,
  UnitType,
  Weapon,
} from './types.ts'

const count = (value: number) => value.toLocaleString('en-US')

export type ValidateInput = {
  formations: readonly Formation[]
  units: readonly Unit[]
  unitTypes: readonly UnitType[]
  echelons: readonly Echelon[]
  /** The weapon catalog. Omitted where a caller has no arming to check. */
  weapons?: readonly Weapon[]
  /** What is in the pile, checked for negative quantities. */
  stock?: readonly StockEntry[]
  /**
   * Every holding as stored, which is how a unit carrying two is caught: the
   * Unit type carries only the first, since the app allows only one.
   */
  holdings?: readonly Holding[]
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
        severity: 'error',
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
        severity: 'error',
        message: `"${formation.name}" uses echelon ${formation.echelon}, which is not a known tier.`,
        formationId: formation.id,
      })
    }

    if (formation.parentId === null) continue

    const parent = byId.get(formation.parentId)
    if (!parent) {
      problems.push({
        rule: 'unknown-parent',
        severity: 'error',
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
        severity: 'error',
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
          severity: 'error',
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
        severity: 'error',
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
        severity: 'error',
        message: `"${unit.designation}" has unit type "${unit.unitType}", which is not in the catalog.`,
        unitId: unit.id,
      })
    }

    const hasMen = unit.men !== 0
    const hasWeapons = unit.weapons !== 0
    if (hasMen && hasWeapons) {
      problems.push({
        rule: 'strength-exclusive',
        severity: 'error',
        message: `"${unit.designation}" records both men and guns; a unit carries one or the other.`,
        unitId: unit.id,
      })
    } else if (!hasMen && !hasWeapons) {
      // Not an error: a unit wiped out in battle, or one sketched in a design
      // before it is raised, sits at zero and keeps its designation,
      // equipment and place in the tree. See mvp-battle-losses.md §2.1.
      problems.push({
        rule: 'paper-unit',
        severity: 'notice',
        message: `"${unit.designation}" is a paper unit: on the books with nobody in it.`,
        unitId: unit.id,
      })
    } else if (type) {
      const shouldUseGuns = isGunCounted(type.category)
      if (shouldUseGuns && hasMen) {
        problems.push({
          rule: 'strength-wrong-measure',
          severity: 'error',
          message: `"${unit.designation}" is a ${type.category} unit, which is counted in guns, but records men.`,
          unitId: unit.id,
        })
      } else if (!shouldUseGuns && hasWeapons) {
        problems.push({
          rule: 'strength-wrong-measure',
          severity: 'error',
          message: `"${unit.designation}" is a ${type.category} unit, which is counted in men, but records guns.`,
          unitId: unit.id,
        })
      }
    }
  }

  problems.push(...armingProblems(input))
  return problems
}

/**
 * The arming rules of mvp-stockpile.md §8, over whatever a unit is carrying.
 *
 * Under-arming is a notice rather than an error on purpose: it is the normal
 * state of a nation between a battle and a re-arm, and making it an error would
 * mean the Order of Battle stops validating every time reinforcements arrive.
 */
function armingProblems(input: ValidateInput): Problem[] {
  const { units, unitTypes, weapons, stock, holdings } = input
  const problems: Problem[] = []

  for (const entry of stock ?? []) {
    if (entry.quantity < 0) {
      problems.push({
        rule: 'negative-stock',
        severity: 'error',
        message: `The stockpile holds ${entry.quantity} of "${entry.weapon}"; a quantity cannot be negative.`,
      })
    }
  }

  // A unit takes one pattern for now. The storage shape allows a second so
  // that mixed arming is a later UI change, so a file carrying one is rejected
  // here rather than silently truncated.
  const holdingCount = new Map<number, number>()
  for (const holding of holdings ?? []) {
    holdingCount.set(holding.unitId, (holdingCount.get(holding.unitId) ?? 0) + 1)
  }

  const typeByName = new Map(unitTypes.map((t) => [t.name, t]))
  const weaponByName = weapons ? new Map(weapons.map((w) => [w.name, w])) : null

  for (const unit of units) {
    if ((holdingCount.get(unit.id) ?? 0) > 1) {
      problems.push({
        rule: 'multiple-holdings',
        severity: 'error',
        message: `"${unit.designation}" carries more than one weapon; a unit takes one pattern.`,
        unitId: unit.id,
      })
    }

    const strength = unit.men || unit.weapons

    if (unit.weapon === '') {
      // A paper unit is already reported as such; saying it is also unarmed
      // adds nothing.
      if (strength > 0) {
        problems.push({
          rule: 'unarmed',
          severity: 'notice',
          message: `"${unit.designation}" is unarmed: ${count(strength)} carrying nothing.`,
          unitId: unit.id,
        })
      }
      continue
    }

    if (weaponByName && !weaponByName.has(unit.weapon)) {
      // Exact match only, exactly as for unit_type. See mvp-stockpile.md §2.1.
      problems.push({
        rule: 'unknown-weapon',
        severity: 'error',
        message: `"${unit.designation}" is armed with "${unit.weapon}", which is not in the weapon catalog.`,
        unitId: unit.id,
      })
    }

    const weapon = weaponByName?.get(unit.weapon)
    const type = typeByName.get(unit.unitType)
    if (weapon && type) {
      const wanted = classForCategory(type.category)
      if (weapon.class !== wanted) {
        problems.push({
          rule: 'weapon-wrong-class',
          severity: 'error',
          message:
            wanted === 'gun'
              ? `"${unit.designation}" is counted in guns but is armed with "${unit.weapon}", a small arm.`
              : `"${unit.designation}" is counted in men but is armed with "${unit.weapon}", a gun.`,
          unitId: unit.id,
        })
      }
    }

    if (unit.weaponCount > strength) {
      // A spare weapon is by definition stockpile, so a unit holding spares is
      // holding stockpile in the wrong place.
      problems.push({
        rule: 'over-armed',
        severity: 'error',
        message: `"${unit.designation}" holds ${count(unit.weaponCount)} weapons for ${count(strength)}; the spares belong in the stockpile.`,
        unitId: unit.id,
      })
      continue
    }

    const gap = armingGap(unit)
    if (gap > 0) {
      problems.push({
        rule: 'under-armed',
        severity: 'notice',
        message: `"${unit.designation}" is under-armed by ${count(gap)}.`,
        unitId: unit.id,
      })
    }
  }

  return problems
}

/** Only the problems that make a design invalid, leaving notices aside. */
export const errorsOnly = (problems: readonly Problem[]): Problem[] =>
  problems.filter(isError)

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
