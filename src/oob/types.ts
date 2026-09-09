export const ECHELON_SYMBOLS = [
  'XXXXX',
  'XXXX',
  'XXX',
  'XX',
  'X',
  'III',
  'II',
  'I',
] as const
export type EchelonSymbol = (typeof ECHELON_SYMBOLS)[number]

export const UNIT_CATEGORIES = [
  'infantry',
  'mountain_infantry',
  'elite_infantry',
  'cavalry',
  'light_cavalry',
  'artillery',
  'support_weapons',
] as const
export type UnitCategory = (typeof UNIT_CATEGORIES)[number]

const GUN_COUNTED: ReadonlySet<string> = new Set(['artillery', 'support_weapons'])

/**
 * Artillery and support weapons are measured in guns and carry no headcount;
 * every other category is measured in men. Never both.
 */
export function isGunCounted(category: UnitCategory): boolean {
  return GUN_COUNTED.has(category)
}

export type Echelon = {
  symbol: EchelonSymbol
  /** Higher is larger. A formation must sit strictly below its parent. */
  level: number
  name: string
}

/**
 * The tiers a nation starts with. `schema.ts` seeds these into the database,
 * which is authoritative at runtime since a nation may rename any of them.
 * This copy exists for tests and for parsing files before a database is open.
 */
export const DEFAULT_ECHELONS: readonly Echelon[] = [
  { symbol: 'XXXXX', level: 8, name: 'Theatre' },
  { symbol: 'XXXX', level: 7, name: 'Army' },
  { symbol: 'XXX', level: 6, name: 'Corps' },
  { symbol: 'XX', level: 5, name: 'Division' },
  { symbol: 'X', level: 4, name: 'Brigade' },
  { symbol: 'III', level: 3, name: 'Regiment' },
  { symbol: 'II', level: 2, name: 'Battalion' },
  { symbol: 'I', level: 1, name: 'Company' },
]

export type UnitType = {
  name: string
  category: UnitCategory
  description: string
  recruitCost: number
  upkeepPerTurn: number
  buildTimeTurns: number
  men: number
  weapons: number
}

export const WEAPON_CLASSES = ['small_arm', 'gun'] as const
export type WeaponClass = (typeof WEAPON_CLASSES)[number]

/**
 * One pattern in the nation's weapon catalog, mirroring weapons.yml. Keyed by
 * name and matched exactly — see mvp-stockpile.md §2.1 for why nothing here is
 * normalized, case-folded or fuzzy-matched.
 */
export type Weapon = {
  name: string
  class: WeaponClass
  /** Who made it. Free text; only the stockpile report reads it. */
  origin: string
  description: string
}

/** How many of one pattern are in the pile, carrying nobody. */
export type StockEntry = {
  weapon: string
  quantity: number
}

/**
 * What something is carrying: a pattern and how many of it. Empty means
 * nothing — unarmed on the way in, withdrawn on the way out.
 */
export type Arming = {
  weapon: string
  quantity: number
}

/**
 * One unit's holding of one weapon, as stored. The app allows a unit only one
 * of these for now; a second is an error validate() reports rather than a file
 * the parser rejects, which is why the plural shape is carried this far.
 */
export type Holding = Arming & { unitId: number }

/**
 * The class of weapon a unit of this category can carry. The men/guns split
 * already in the model decides it: a man-counted unit carries small arms, a
 * gun-counted unit is equipped with guns. Issuing 18-pounders to a levy
 * battalion is an error, not a judgement call.
 */
export const classForCategory = (category: UnitCategory): WeaponClass =>
  isGunCounted(category) ? 'gun' : 'small_arm'

export type Design = {
  id: number
  name: string
  note: string
  isLive: boolean
}

export type Formation = {
  id: number
  designId: number
  /** null for an independent formation at the top of the tree. */
  parentId: number | null
  echelon: EchelonSymbol
  name: string
  sortOrder: number
}

export type Unit = {
  id: number
  formationId: number
  /** Must match a UnitType name exactly. */
  unitType: string
  designation: string
  men: number
  weapons: number
  /**
   * The weapon this unit carries, matching a Weapon name exactly. Empty means
   * unarmed, which is a legal way to run a nation short of rifles — four of
   * Clan McGreggor's battalions are.
   *
   * Singular while the UI is: storage holds a row per holding so that mixed
   * arming is a later UI change rather than a migration, and the app enforces
   * the one-holding limit. See mvp-stockpile.md §2.2.
   */
  weapon: string
  /**
   * How many of it the unit actually holds. Never more than its strength — a
   * spare weapon is by definition stockpile — and possibly fewer, which is
   * under-armed and legal.
   */
  weaponCount: number
  sortOrder: number
}

/** What a unit is short of being fully armed, or 0 when it is. */
export const armingGap = (unit: Unit): number =>
  Math.max(0, (unit.men || unit.weapons) - unit.weaponCount)

/**
 * An error is something the design must not be promoted to live with; a
 * notice is worth surfacing on the row but blocks nothing. A paper unit is
 * the reason the distinction exists — see mvp-battle-losses.md §2.1.
 */
export type Severity = 'error' | 'notice'

export type Problem = {
  /** Stable identifier for the rule that failed, for testing and filtering. */
  rule: string
  severity: Severity
  message: string
  formationId?: number
  unitId?: number
}

export const isError = (problem: Problem): boolean =>
  problem.severity === 'error'
