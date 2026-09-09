import {
  hasNation,
  getNationName,
  listEchelons,
  listStock,
  listUnitTypes,
  listWeapons,
  loadDesign,
  getLiveDesign,
  seedNation,
} from '../db/oob.ts'
import { clearHistory } from '../db/client.ts'
import {
  parseOob,
  parseStockpile,
  parseUnitTypes,
  parseWeapons,
} from './yaml.ts'
import { buildTree, type Tree } from './tree.ts'
import { errorsOnly, validate } from './validate.ts'
import type {
  Design,
  Echelon,
  Formation,
  Problem,
  StockEntry,
  Unit,
  UnitType,
  Weapon,
} from './types.ts'
import type { PredefinedNation } from '../nations/clan-mcgreggor.ts'

export type Loaded = {
  design: Design
  /** The nation itself, which the stockpile report is headed with. */
  nationName: string
  echelons: Echelon[]
  unitTypes: UnitType[]
  weapons: Weapon[]
  /** One entry per catalog weapon, including the ones at zero. */
  stock: StockEntry[]
  tree: Tree
  /** Flat rows alongside the tree, for checks that walk parent links. */
  formations: Formation[]
  units: Unit[]
  problems: Problem[]
}

/**
 * Everything a nation's files say, before any of it is written. Kept apart
 * from seedPredefined so the same parse can be checked, previewed and reported
 * on without a database in the way.
 */
export function parseNation(nation: PredefinedNation) {
  const types = parseUnitTypes(nation.landUnits)
  const catalog = parseWeapons(nation.weapons)
  const pile = parseStockpile(nation.stockpile, catalog.weapons)
  const oob = parseOob(nation.armyOob)

  return {
    unitTypes: types.unitTypes,
    weapons: catalog.weapons,
    stock: pile.stock,
    formations: oob.formations,
    units: oob.units,
    problems: [
      ...types.problems,
      ...catalog.problems,
      ...pile.problems,
      ...oob.problems,
    ],
  }
}

/**
 * Writes a pre-defined nation into an empty database.
 *
 * A file that names a weapon or a unit type its catalog does not have fails
 * the whole seed and reports every unresolved name at once, per
 * mvp-stockpile.md §7 — a nation half-written is worse than one not written,
 * since the missing half is exactly the part nothing else can be checked
 * against.
 */
export async function seedPredefined(nation: PredefinedNation): Promise<void> {
  const { unitTypes, weapons, stock, formations, units, problems } =
    parseNation(nation)

  const errors = errorsOnly(problems)
  if (errors.length > 0) {
    throw new Error(
      [`${nation.name}'s files could not be read:`, ...errors.map((p) => p.message)].join(
        '\n',
      ),
    )
  }

  await seedNation({
    label: `Load ${nation.name}`,
    name: nation.name,
    unitTypes,
    weapons,
    stock,
    design: {
      name: 'Order of Battle',
      note: `Seeded from ${nation.name}'s repo files.`,
      isLive: true,
      formations,
      units,
    },
  })

  // The starting roster is the baseline, not a change the player made. Leaving
  // it on the undo stack is actively harmful: undoing it empties the database,
  // the next load sees no nation and seeds again, and that fresh action wipes
  // the redo stack — so undo silently becomes a no-op that costs you the redo.
  await clearHistory()
}

/**
 * Reads the live design and everything needed to render it. Seeds the given
 * nation first if this browser has no data yet.
 */
export async function loadLiveOob(
  seedWith: PredefinedNation,
): Promise<Loaded | null> {
  if (!(await hasNation())) await seedPredefined(seedWith)

  const design = await getLiveDesign()
  if (!design) return null

  const [nationName, echelons, unitTypes, weapons, stock, contents] = await Promise.all([
    getNationName(),
    listEchelons(),
    listUnitTypes(),
    listWeapons(),
    listStock(),
    loadDesign(design.id),
  ])

  return {
    design,
    nationName,
    echelons,
    unitTypes,
    weapons,
    stock,
    tree: buildTree(contents.formations, contents.units, unitTypes),
    formations: contents.formations,
    units: contents.units,
    problems: validate({ ...contents, unitTypes, echelons, weapons, stock }),
  }
}
