/**
 * Moving weapons between the stockpile and the units that carry them. See
 * mvp-stockpile.md §5.
 *
 * Pure, like tree.ts and losses.ts and for the same reason: this is the part
 * that has to balance exactly, and a ledger is far easier to trust when it can
 * be checked without a database or a browser in the way.
 *
 * Issue, withdraw and re-arm are one operation with a side left empty —
 * issuing is a re-arm with nothing to hand back, withdrawing is one with
 * nothing to draw — so there is one planner rather than three.
 */
import { flatten } from './tree.ts'
import type { Tree } from './tree.ts'
import { classForCategory } from './types.ts'
import type {
  Arming,
  StockEntry,
  Unit,
  UnitType,
  Weapon,
  WeaponClass,
} from './types.ts'

const count = (value: number) => value.toLocaleString('en-US')

export type UnitMovement = {
  unitId: number
  designation: string
  /** The unit's men, or its guns — the ceiling on what it may hold. */
  strength: number
  /** What it hands back. An empty weapon means it was carrying nothing. */
  from: Arming
  /** What it takes up. An empty weapon means it is being withdrawn. */
  to: Arming
  /** How far short of fully armed it is left. */
  gap: number
}

/**
 * What to do when the pile cannot arm everyone selected. Nothing commits until
 * the player has chosen, because both answers are honest and picking one
 * silently is how a partial re-arm gets mistaken for a complete one.
 */
export type Shortfall = 'refuse' | 'as-far-as-it-goes'

export type PlanInput = {
  tree: Tree
  unitTypes: readonly UnitType[]
  weapons: readonly Weapon[]
  stock: readonly StockEntry[]
  /** The units to serve. Nothing outside it is touched. */
  selectedUnitIds: ReadonlySet<number>
  /** The pattern to issue. Empty withdraws: hand back and take nothing. */
  weapon: string
  onShortfall: Shortfall
}

export type Plan = {
  weapon: string
  /** Only the units that actually change, in tree order. */
  rows: UnitMovement[]
  /** Weapons it would take to arm every eligible unit fully. */
  needed: number
  /** The pile, plus what the selection hands back of the same pattern. */
  available: number
  /** needed − available, floored at zero. */
  short: number
  /** The pile afterwards, for every pattern this plan touches. */
  stockAfter: Map<string, number>
  /** Anything the player should see about the selection itself. */
  notes: string[]
  /** True when the plan is short and the player has not said what to do. */
  blocked: boolean
}

export const stockMap = (stock: readonly StockEntry[]): Map<string, number> =>
  new Map(stock.map((entry) => [entry.weapon, entry.quantity]))

/** A unit's strength in whichever measure it is counted in. */
export const strengthOf = (unit: Unit): number => unit.men || unit.weapons

/**
 * Works out who ends up carrying what, and what the pile is left with.
 *
 * Units are served in the order their rows appear, so the same selection
 * against the same pile always produces the same result and the preview is
 * exactly what commits.
 */
export function planMovement(input: PlanInput): Plan {
  const { tree, unitTypes, weapons, stock, selectedUnitIds, weapon } = input

  const typeByName = new Map(unitTypes.map((t) => [t.name, t]))
  const target = weapons.find((w) => w.name === weapon)
  const notes: string[] = []

  if (weapon !== '' && !target) {
    return {
      weapon,
      rows: [],
      needed: 0,
      available: 0,
      short: 0,
      stockAfter: new Map(),
      notes: [`"${weapon}" is not in the weapon catalog.`],
      blocked: true,
    }
  }

  // Only units the weapon can go to. A brigade holds batteries and battalions
  // alike and they cannot take the same pattern, so the wrong class is left
  // out of the plan rather than reported per row.
  const eligible: Unit[] = []
  let wrongClass = 0
  for (const row of flatten(tree)) {
    if (row.kind !== 'unit') continue
    if (!selectedUnitIds.has(row.unit.id)) continue

    const type = typeByName.get(row.unit.unitType)
    // An unresolved type has no measure, so there is no telling what it may
    // carry. validate() reports it on its own row.
    if (!type) continue

    if (target && classForCategory(type.category) !== target.class) {
      wrongClass += 1
      continue
    }
    eligible.push(row.unit)
  }

  if (wrongClass > 0) {
    notes.push(
      target?.class === 'gun'
        ? `${count(wrongClass)} man-counted ${wrongClass === 1 ? 'unit is' : 'units are'} left out: a gun cannot be issued to them.`
        : `${count(wrongClass)} gun-counted ${wrongClass === 1 ? 'unit is' : 'units are'} left out: a small arm cannot be issued to them.`,
    )
  }

  // Everything comes back before anything goes out, so re-arming a unit with
  // the pattern it already carries is a no-op rather than a shortfall.
  const returned = new Map<string, number>()
  for (const unit of eligible) {
    if (unit.weapon === '' || unit.weaponCount <= 0) continue
    returned.set(unit.weapon, (returned.get(unit.weapon) ?? 0) + unit.weaponCount)
  }

  const inStock = stockMap(stock)
  const needed = eligible.reduce((sum, unit) => sum + strengthOf(unit), 0)
  const available =
    weapon === ''
      ? 0
      : (inStock.get(weapon) ?? 0) + (returned.get(weapon) ?? 0)
  const short = weapon === '' ? 0 : Math.max(0, needed - available)

  const blocked = short > 0 && input.onShortfall === 'refuse'

  const rows: UnitMovement[] = []
  let pool = available
  // A blocked plan moves nothing at all: an operation that would break an
  // invariant, or that the player has not agreed to, commits nothing.
  for (const unit of blocked ? [] : eligible) {
    const strength = strengthOf(unit)
    // Served in tree order until the pile is empty.
    const take = Math.min(strength, pool)
    pool -= take

    const from: Arming = { weapon: unit.weapon, quantity: unit.weaponCount }
    const to: Arming =
      weapon === '' ? { weapon: '', quantity: 0 } : { weapon, quantity: take }

    // A unit past the point the pile ran dry keeps the pattern it had rather
    // than being stripped of it on the way to being armed with nothing.
    if (take === 0 && weapon !== '' && from.weapon !== weapon) continue
    if (from.weapon === to.weapon && from.quantity === to.quantity) continue

    rows.push({
      unitId: unit.id,
      designation: unit.designation,
      strength,
      from,
      to,
      gap: Math.max(0, strength - to.quantity),
    })
  }

  const stockAfter = new Map<string, number>()
  const touch = (name: string, delta: number) => {
    if (name === '') return
    const current = stockAfter.get(name) ?? inStock.get(name) ?? 0
    stockAfter.set(name, current + delta)
  }
  for (const row of rows) {
    touch(row.from.weapon, row.from.quantity)
    touch(row.to.weapon, -row.to.quantity)
  }

  if (weapon !== '' && eligible.length === 0) {
    notes.push('No unit in the selection can carry this weapon.')
  }

  return {
    weapon,
    rows,
    needed,
    available,
    short,
    stockAfter,
    notes,
    blocked,
  }
}

/**
 * The pile plus everything issued across the live Order of Battle: what the
 * nation owns rather than what it has spare. Unchanged by every issue,
 * withdraw and re-arm — that invariance is the point of the whole feature.
 */
export function owned(
  units: readonly Unit[],
  stock: readonly StockEntry[],
): Map<string, number> {
  const totals = stockMap(stock)
  for (const unit of units) {
    if (unit.weapon === '') continue
    totals.set(unit.weapon, (totals.get(unit.weapon) ?? 0) + unit.weaponCount)
  }
  return totals
}

/** Totals per weapon class, for the report's owned line and the tree's header. */
export function totalsByClass(
  amounts: ReadonlyMap<string, number>,
  weapons: readonly Weapon[],
): Record<WeaponClass, number> {
  const classOf = new Map(weapons.map((w) => [w.name, w.class]))
  const totals: Record<WeaponClass, number> = { small_arm: 0, gun: 0 }
  for (const [name, quantity] of amounts) {
    const weaponClass = classOf.get(name)
    if (weaponClass) totals[weaponClass] += quantity
  }
  return totals
}
