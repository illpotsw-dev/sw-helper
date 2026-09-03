import { readFileSync } from 'node:fs'
import { parseOob, parseUnitTypes } from './yaml.ts'
import type { Formation, Unit, UnitType } from './types.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

export type Fixture = {
  formations: Formation[]
  units: Unit[]
  unitTypes: UnitType[]
}

/** Clan McGreggor's real roster, straight from the repo YAML. */
export function mcgreggor(): Fixture {
  const { unitTypes } = parseUnitTypes(
    read('../../mvp/nations/clan-mcgreggor/land-units.yml'),
  )
  const { formations, units } = parseOob(
    read('../../mvp/nations/clan-mcgreggor/army-oob.yml'),
  )
  return { formations, units, unitTypes }
}

/** Rounds away float drift from summing values like 0.1 and 0.25. */
export const round = (value: number): number => Math.round(value * 100) / 100
