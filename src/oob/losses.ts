/**
 * Spreading a battle's casualties — or a draft of reinforcements — over the
 * units that fought. See mvp-battle-losses.md §4.
 *
 * Pure, like tree.ts and validate.ts and for the same reason: this is the part
 * that has to be exactly right, and arithmetic is far easier to trust when it
 * can be tested without a database or a browser in the way.
 *
 * The app never decides how many were lost — the narrative does that. This
 * decides who took them, under the player's direction.
 */
import { establishmentOf } from './tree.ts'
import type { Tree, TreeNode } from './tree.ts'
import { isGunCounted } from './types.ts'
import type { Unit, UnitType } from './types.ts'

export type Direction = 'losses' | 'reinforcements'
export type Measure = 'men' | 'guns'

export const MEASURES: readonly Measure[] = ['men', 'guns']

/**
 * Men land on multiples of five: a narrative reports casualties in the round,
 * and 1,043 reads as false precision. Guns are allocated in ones — a battery
 * of one gun exists in the seeded roster, and rounding it to five would have
 * it lose five guns it does not have, or nothing at all when it is knocked
 * out. Granularity is a property of the measure, not a setting.
 */
export const GRANULARITY: Record<Measure, number> = { men: 5, guns: 1 }

/**
 * Presets rather than free number entry: mvp.md §7 wants this usable on a
 * phone, where typing 0.5 into forty rows is not a plan.
 */
export const WEIGHT_PRESETS: readonly { label: string; value: number }[] = [
  { label: 'Spared', value: 0 },
  { label: 'Light', value: 0.5 },
  { label: 'Normal', value: 1 },
  { label: 'Heavy', value: 2 },
  { label: 'Severe', value: 4 },
]

export const JITTER_PRESETS: readonly { label: string; sigma: number }[] = [
  { label: 'None', sigma: 0 },
  { label: 'Light', sigma: 0.15 },
  { label: 'Normal', sigma: 0.35 },
  { label: 'Heavy', sigma: 0.6 },
]

/** What the player has set on one row of the preview. */
export type RowSteering = {
  /** ×1 when unset. On a formation it cascades to everything beneath it. */
  multiplier?: number
  /** An exact figure. On a formation it fixes that subtree's total. */
  lockMen?: number
  lockGuns?: number
}

export type Steering = {
  formations: ReadonlyMap<number, RowSteering>
  units: ReadonlyMap<number, RowSteering>
}

export const NO_STEERING: Steering = { formations: new Map(), units: new Map() }

export type AllocationInput = {
  tree: Tree
  unitTypes: readonly UnitType[]
  /** The universe the pools spread over. Nothing outside it is ever touched. */
  selectedUnitIds: ReadonlySet<number>
  direction: Direction
  totals: Record<Measure, number>
  steering: Steering
  /** The jitter's sigma, from JITTER_PRESETS. 0 is perfectly proportional. */
  jitter: number
  seed: number
}

export type UnitAllocation = {
  unitId: number
  measure: Measure
  /** Always non-negative; `direction` says which way it applies. */
  amount: number
  before: number
  after: number
  /** The most this unit could take: its strength, or its room to establishment. */
  capacity: number
  /** Pinned at capacity, and so exempt from the multiple-of-five rule. */
  atCapacity: boolean
  /** A loss that took the unit to zero. It stays in the tree as a paper unit. */
  wipedOut: boolean
}

export type MeasureReport = {
  measure: Measure
  requested: number
  allocated: number
  /** The selection's total capacity, ignoring rows spared at ×0. */
  allocatable: number
  /** Requested but impossible: reported, never quietly dropped. */
  unassigned: number
  eligibleUnits: number
}

export type Allocation = {
  direction: Direction
  byUnit: ReadonlyMap<number, UnitAllocation>
  reports: readonly MeasureReport[]
  /** Anything the player should see about the inputs themselves. */
  notes: readonly string[]
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/**
 * mulberry32: small, fast and well-distributed enough for jitter. Written out
 * rather than pulled in as a dependency, since it is nine lines and the whole
 * point of it is that the sequence never changes under us.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function mix(a: number, b: number): number {
  let h = (a ^ Math.imul(b ^ (b >>> 16), 2246822507)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0
  return h >>> 0
}

/**
 * A unit's draw is keyed on the seed and its id rather than on its position in
 * any list, so adding a unit to the selection does not reshuffle everyone else.
 */
const draw = (seed: number, unitId: number, salt: number): number =>
  mulberry32(mix(mix(seed >>> 0, unitId), salt))()

const JITTER_SALT = 0x9e37
const TIEBREAK_SALT = 0x85eb

// ---------------------------------------------------------------------------
// Gathering the selection
// ---------------------------------------------------------------------------

/** Where a share is drawn from: the whole selection, or a locked subtree. */
const ROOT_SCOPE = ''

type Eligible = {
  unit: Unit
  capacity: number
  /** capacity × own multiplier × every ancestor multiplier. */
  weight: number
}

type Scope = {
  key: string
  parent: string
  /** The exact figure this scope must total, for a locked row. */
  lock: number
  /** Set when the lock is on a single unit, which is honoured exactly. */
  lockedUnitId: number | null
  units: Eligible[]
  children: Scope[]
}

const lockFor = (row: RowSteering | undefined, measure: Measure) =>
  measure === 'men' ? row?.lockMen : row?.lockGuns

/** Which of the two pools a unit of this type draws from. */
export const measureOfType = (type: UnitType): Measure =>
  isGunCounted(type.category) ? 'guns' : 'men'

const currentStrength = (unit: Unit, measure: Measure): number =>
  measure === 'men' ? unit.men : unit.weapons

/**
 * The ceiling on what one unit can take. Losses cannot go past what it has;
 * reinforcements cannot fill it past its type's paper strength. Using this as
 * the base of the weight is what makes the default sensible in both
 * directions — big units bleed more, empty units fill first.
 */
function capacityOf(
  unit: Unit,
  type: UnitType,
  direction: Direction,
  measure: Measure,
): number {
  const current = currentStrength(unit, measure)
  if (direction === 'losses') return current
  return Math.max(0, establishmentOf(type) - current)
}

/**
 * Walks the selection once per measure, collecting eligible units into the
 * scope each one draws from. Only a locked row opens a scope — an unlocked
 * formation contributes nothing but its multiplier, which cascades.
 */
function collect(
  input: AllocationInput,
  measure: Measure,
): { root: Scope; eligible: Eligible[] } {
  const { tree, unitTypes, selectedUnitIds, steering, direction } = input
  const typeOf = new Map(unitTypes.map((t) => [t.name, t]))
  const eligible: Eligible[] = []

  const root: Scope = {
    key: ROOT_SCOPE,
    parent: ROOT_SCOPE,
    lock: 0,
    lockedUnitId: null,
    units: [],
    children: [],
  }

  function walk(node: TreeNode, inherited: number, parentScope: Scope): void {
    const row = steering.formations.get(node.formation.id)
    const multiplier = inherited * (row?.multiplier ?? 1)

    const lock = lockFor(row, measure)
    let scope = parentScope
    if (lock !== undefined) {
      scope = {
        key: `f${node.formation.id}`,
        parent: parentScope.key,
        lock,
        lockedUnitId: null,
        units: [],
        children: [],
      }
      parentScope.children.push(scope)
    }

    for (const unit of node.units) {
      if (!selectedUnitIds.has(unit.id)) continue
      const type = typeOf.get(unit.unitType)
      // An unresolved type has neither an establishment nor a measure, so it
      // cannot be given a share. validate() reports it on its own row.
      if (!type || measureOfType(type) !== measure) continue

      const unitRow = steering.units.get(unit.id)
      const capacity = capacityOf(unit, type, direction, measure)
      const entry: Eligible = {
        unit,
        capacity,
        weight: capacity * multiplier * (unitRow?.multiplier ?? 1),
      }
      eligible.push(entry)

      const unitLock = lockFor(unitRow, measure)
      if (unitLock === undefined) {
        scope.units.push(entry)
        continue
      }
      // A locked unit is its own scope, carved out of whatever contains it.
      const own: Scope = {
        key: `u${unit.id}`,
        parent: scope.key,
        lock: unitLock,
        lockedUnitId: unit.id,
        units: [entry],
        children: [],
      }
      scope.children.push(own)
    }

    for (const child of node.children) walk(child, multiplier, scope)
  }

  for (const rootNode of tree.roots) walk(rootNode, 1, root)
  return { root, eligible }
}

// ---------------------------------------------------------------------------
// The split
// ---------------------------------------------------------------------------

function sum(values: Iterable<number>): number {
  let total = 0
  for (const value of values) total += value
  return total
}

function jitteredWeights(
  entries: readonly Eligible[],
  jitter: number,
  seed: number,
): Map<number, number> {
  const weights = new Map<number, number>()
  for (const entry of entries) {
    // w' = w × (1 + σ(2u − 1)). Perturbing the weights rather than the shares
    // is what keeps the total exact: the shares are normalised afterwards, so
    // jitter changes who bleeds and never how much was lost.
    const u = draw(seed, entry.unit.id, JITTER_SALT)
    weights.set(entry.unit.id, Math.max(0, entry.weight * (1 + jitter * (2 * u - 1))))
  }
  return weights
}

/**
 * Divides a pool into chunks of `granularity` and hands the chunks out by
 * largest fractional part, so the figures sum to the pool exactly rather than
 * to the pool minus rounding dust. Rounding each share independently is what
 * breaks that guarantee, which is why it is not done that way.
 *
 * A pool that is not a whole number of chunks leaves 1..granularity−1 over,
 * and one unit absorbs it — the documented exception in spec §4.
 */
function largestRemainder(
  pool: number,
  entries: readonly Eligible[],
  weights: ReadonlyMap<number, number>,
  granularity: number,
  seed: number,
): Map<number, number> {
  const amounts = new Map<number, number>()
  const totalWeight = sum(entries.map((e) => weights.get(e.unit.id) ?? 0))
  if (totalWeight <= 0 || entries.length === 0) return amounts

  const chunks = Math.floor(pool / granularity)
  const leftover = pool - chunks * granularity

  const rows = entries.map((entry) => {
    const exact = (chunks * (weights.get(entry.unit.id) ?? 0)) / totalWeight
    const base = Math.floor(exact)
    return {
      id: entry.unit.id,
      base,
      fraction: exact - base,
      // Ties break on the seeded PRNG, so the same unit is not always the one
      // that picks up the odd chunk.
      tiebreak: draw(seed, entry.unit.id, TIEBREAK_SALT),
    }
  })

  rows.sort((a, b) => b.fraction - a.fraction || b.tiebreak - a.tiebreak)
  const spare = chunks - sum(rows.map((r) => r.base))
  for (let i = 0; i < spare; i += 1) rows[i % rows.length].base += 1

  for (const row of rows) amounts.set(row.id, row.base * granularity)

  if (leftover > 0) {
    // Onto the largest share, where a few extra men are least conspicuous. If
    // that pushes it past capacity the spill loop below moves it on.
    const largest = rows.reduce((best, row) =>
      row.base > best.base ||
      (row.base === best.base && row.tiebreak > best.tiebreak)
        ? row
        : best,
    )
    amounts.set(largest.id, (amounts.get(largest.id) ?? 0) + leftover)
  }

  return amounts
}

type Spread = {
  amounts: Map<number, number>
  atCapacity: Set<number>
  unassigned: number
}

/**
 * Splits one pool over one set of units, pinning anyone whose share exceeds
 * their capacity and redistributing the excess over whoever is left. It
 * terminates because each round pins at least one unit.
 */
function spread(
  pool: number,
  entries: readonly Eligible[],
  granularity: number,
  jitter: number,
  seed: number,
): Spread {
  const amounts = new Map<number, number>()
  const atCapacity = new Set<number>()
  if (pool <= 0) return { amounts, atCapacity, unassigned: 0 }

  const weights = jitteredWeights(entries, jitter, seed)
  // A unit spared at ×0, or one with no room left, is out of the split
  // entirely rather than being fought over and then given nothing.
  let live = entries.filter(
    (e) => e.capacity > 0 && (weights.get(e.unit.id) ?? 0) > 0,
  )

  let pinnedTotal = 0
  for (;;) {
    const subPool = pool - pinnedTotal
    if (live.length === 0) {
      return { amounts, atCapacity, unassigned: Math.max(0, subPool) }
    }

    const totalCapacity = sum(live.map((e) => e.capacity))
    if (subPool >= totalCapacity) {
      // The pool exceeds what is left to give: everyone ends pinned and the
      // remainder is reported rather than absorbed.
      for (const entry of live) {
        amounts.set(entry.unit.id, entry.capacity)
        atCapacity.add(entry.unit.id)
      }
      return { amounts, atCapacity, unassigned: subPool - totalCapacity }
    }

    const shares = largestRemainder(subPool, live, weights, granularity, seed)
    const over = live.filter((e) => (shares.get(e.unit.id) ?? 0) > e.capacity)
    if (over.length === 0) {
      for (const [id, value] of shares) amounts.set(id, value)
      return { amounts, atCapacity, unassigned: 0 }
    }

    for (const entry of over) {
      // A battalion with 833 men left cannot lose 835, so a pinned unit takes
      // exactly its capacity — the other documented exception to fives.
      amounts.set(entry.unit.id, entry.capacity)
      atCapacity.add(entry.unit.id)
      pinnedTotal += entry.capacity
    }
    const spilled = new Set(over.map((e) => e.unit.id))
    live = live.filter((e) => !spilled.has(e.unit.id))
  }
}

/**
 * Runs a scope and everything locked inside it. Locked amounts leave the pool
 * before anything else is computed; the remainder spreads over the rest.
 */
function runScope(
  scope: Scope,
  pool: number,
  granularity: number,
  jitter: number,
  seed: number,
  into: Map<number, number>,
  atCapacity: Set<number>,
  notes: string[],
): number {
  // A lock on a single unit is honoured to the unit rather than rounded.
  if (scope.lockedUnitId !== null) {
    const entry = scope.units[0]
    const amount = Math.max(0, Math.min(pool, entry.capacity))
    into.set(entry.unit.id, amount)
    if (amount < pool) atCapacity.add(entry.unit.id)
    return pool - amount
  }

  const locked = sum(scope.children.map((child) => child.lock))
  let remainder = pool - locked
  if (remainder < 0) {
    notes.push(
      `Locked figures come to ${locked.toLocaleString('en-US')}, more than the ${pool.toLocaleString('en-US')} available. The locks are honoured; nothing is left for the unlocked rows.`,
    )
    remainder = 0
  }

  let unassigned = 0
  for (const child of scope.children) {
    unassigned += runScope(
      child,
      child.lock,
      granularity,
      jitter,
      seed,
      into,
      atCapacity,
      notes,
    )
  }

  const result = spread(remainder, scope.units, granularity, jitter, seed)
  for (const [id, value] of result.amounts) into.set(id, value)
  for (const id of result.atCapacity) atCapacity.add(id)
  return unassigned + result.unassigned
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Totals, a selection, weights, locks, jitter and a seed in; a per-unit figure
 * out. Identical inputs give an identical result, which is what makes this
 * testable and keeps the preview stable while the player adjusts an unrelated
 * row.
 */
export function allocate(input: AllocationInput): Allocation {
  const byUnit = new Map<number, UnitAllocation>()
  const reports: MeasureReport[] = []
  const notes: string[] = []

  for (const measure of MEASURES) {
    const requested = Math.max(0, Math.floor(input.totals[measure] ?? 0))
    const { root, eligible } = collect(input, measure)

    const allocatable = sum(
      eligible.filter((e) => e.weight > 0).map((e) => e.capacity),
    )

    const amounts = new Map<number, number>()
    const atCapacity = new Set<number>()
    const unassigned =
      requested > 0
        ? runScope(
            root,
            requested,
            GRANULARITY[measure],
            input.jitter,
            input.seed,
            amounts,
            atCapacity,
            notes,
          )
        : 0

    if (requested > 0 && eligible.length === 0) {
      // Reported rather than silently discarded, per spec §3.
      notes.push(
        measure === 'guns'
          ? 'No gun-counted unit is selected, so the gun total has nowhere to go.'
          : 'No men-counted unit is selected, so the men total has nowhere to go.',
      )
    }

    for (const entry of eligible) {
      const amount = amounts.get(entry.unit.id) ?? 0
      if (amount === 0) continue
      const before = currentStrength(entry.unit, measure)
      const after =
        input.direction === 'losses' ? before - amount : before + amount
      byUnit.set(entry.unit.id, {
        unitId: entry.unit.id,
        measure,
        amount,
        before,
        after,
        capacity: entry.capacity,
        atCapacity: atCapacity.has(entry.unit.id),
        wipedOut: input.direction === 'losses' && after === 0,
      })
    }

    reports.push({
      measure,
      requested,
      allocated: sum(amounts.values()),
      allocatable,
      unassigned,
      eligibleUnits: eligible.length,
    })
  }

  return { direction: input.direction, byUnit, reports, notes }
}

/** A formation's subtree total in one measure, for the preview's subtotals. */
export function subtotal(
  node: TreeNode,
  allocation: Allocation,
  measure: Measure,
): number {
  let total = 0
  const walk = (current: TreeNode): void => {
    for (const unit of current.units) {
      const row = allocation.byUnit.get(unit.id)
      if (row && row.measure === measure) total += row.amount
    }
    current.children.forEach(walk)
  }
  walk(node)
  return total
}
