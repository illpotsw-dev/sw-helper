// Pre-defined nations ship as repo files and are bundled into the app, per
// mvp.md section 6 flow 1a. Players without repo access instead paste their
// own YAML, which is the import path in build plan part 8.
import landUnits from '../../mvp/nations/clan-mcgreggor/land-units.yml?raw'
import armyOob from '../../mvp/nations/clan-mcgreggor/army-oob.yml?raw'
import weapons from '../../mvp/nations/clan-mcgreggor/weapons.yml?raw'
import stockpile from '../../mvp/nations/clan-mcgreggor/stockpile.yml?raw'

export type PredefinedNation = {
  name: string
  /** Contents of the nation's land-units.yml. */
  landUnits: string
  /** Contents of the nation's weapons.yml. */
  weapons: string
  /** Contents of the nation's stockpile.yml. */
  stockpile: string
  /** Contents of the nation's army-oob.yml. */
  armyOob: string
}

export const CLAN_MCGREGGOR: PredefinedNation = {
  name: 'Clan McGreggor',
  landUnits,
  weapons,
  stockpile,
  armyOob,
}
