import { readFileSync } from 'node:fs'
import {
  parseOob,
  parseStockpile,
  parseUnitTypes,
  parseWeapons,
} from './yaml.ts'
import type {
  Formation,
  StockEntry,
  Unit,
  UnitType,
  Weapon,
} from './types.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

export type Fixture = {
  formations: Formation[]
  units: Unit[]
  unitTypes: UnitType[]
  weapons: Weapon[]
  /** Only the patterns stockpile.yml names; the rest of the catalog is at zero. */
  stock: StockEntry[]
}

/** Clan McGreggor's real roster, straight from the repo YAML. */
export function mcgreggor(): Fixture {
  const { unitTypes } = parseUnitTypes(
    read('../../mvp/nations/clan-mcgreggor/land-units.yml'),
  )
  const { weapons } = parseWeapons(
    read('../../mvp/nations/clan-mcgreggor/weapons.yml'),
  )
  const { stock } = parseStockpile(
    read('../../mvp/nations/clan-mcgreggor/stockpile.yml'),
    weapons,
  )
  const { formations, units } = parseOob(
    read('../../mvp/nations/clan-mcgreggor/army-oob.yml'),
  )
  return { formations, units, unitTypes, weapons, stock }
}

/** Rounds away float drift from summing values like 0.1 and 0.25. */
export const round = (value: number): number => Math.round(value * 100) / 100
