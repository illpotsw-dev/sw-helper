import {
  hasNation,
  listEchelons,
  listUnitTypes,
  loadDesign,
  getLiveDesign,
  seedNation,
} from '../db/oob.ts'
import { parseOob, parseUnitTypes } from './yaml.ts'
import { buildTree, type Tree } from './tree.ts'
import { validate } from './validate.ts'
import type { Design, Echelon, Problem, UnitType } from './types.ts'
import type { PredefinedNation } from '../nations/clan-mcgreggor.ts'

export type Loaded = {
  design: Design
  echelons: Echelon[]
  unitTypes: UnitType[]
  tree: Tree
  problems: Problem[]
}

/** Writes a pre-defined nation into an empty database. */
export async function seedPredefined(nation: PredefinedNation): Promise<void> {
  const { unitTypes } = parseUnitTypes(nation.landUnits)
  const { formations, units } = parseOob(nation.armyOob)

  await seedNation({
    label: `Load ${nation.name}`,
    unitTypes,
    design: {
      name: 'Order of Battle',
      note: `Seeded from ${nation.name}'s repo files.`,
      isLive: true,
      formations,
      units,
    },
  })
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

  const [echelons, unitTypes, contents] = await Promise.all([
    listEchelons(),
    listUnitTypes(),
    loadDesign(design.id),
  ])

  return {
    design,
    echelons,
    unitTypes,
    tree: buildTree(contents.formations, contents.units, unitTypes),
    problems: validate({ ...contents, unitTypes, echelons }),
  }
}
