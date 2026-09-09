/**
 * The stockpile as Discord markdown. See mvp-stockpile.md §7.
 *
 * Pure, and written by hand rather than through a generic serialiser for the
 * same reason as the YAML export: this is something a player reads and pastes
 * into a thread, so the grouping and the blank lines are the point.
 *
 * Unlike the Order of Battle, this is not blocked on the nested-tree question
 * in mvp-army-oob.md §5: a flat grouped list has no nesting to render.
 */
import { owned, stockMap, totalsByClass } from './arm.ts'
import type { StockEntry, Unit, Weapon, WeaponClass } from './types.ts'

const count = (value: number) => value.toLocaleString('en-US')

const HEADINGS: Record<WeaponClass, string> = {
  small_arm: 'Small Arms',
  gun: 'Guns',
}

const CLASS_ORDER: readonly WeaponClass[] = ['small_arm', 'gun']

/** Origins alphabetically, with anything unattributed last. */
function compareOrigins(a: string, b: string): number {
  if (a === b) return 0
  if (a === '') return 1
  if (b === '') return -1
  return a.localeCompare(b, 'en')
}

const UNATTRIBUTED = 'Unattributed'

export type StockpileReport = {
  nationName: string
  weapons: readonly Weapon[]
  stock: readonly StockEntry[]
  /** The live Order of Battle, for the owned totals at the foot. */
  units: readonly Unit[]
}

export function exportStockpileMarkdown(input: StockpileReport): string {
  const { nationName, weapons, stock, units } = input
  const spare = stockMap(stock)

  const lines: string[] = [`## Weapons Stockpile — ${nationName}`, '']

  // A weapon at zero is omitted rather than listed as zero: "none in stock"
  // and "not listed" are the same statement, and stockpile.yml says it the
  // same way.
  const held = weapons.filter((weapon) => (spare.get(weapon.name) ?? 0) > 0)

  if (held.length === 0) {
    // Not an empty document, which reads as a bug rather than as an answer.
    lines.push('The stockpile is empty: every weapon the nation owns is issued.')
  }

  for (const weaponClass of CLASS_ORDER) {
    const inClass = held.filter((weapon) => weapon.class === weaponClass)
    if (inClass.length === 0) continue

    lines.push(`### ${HEADINGS[weaponClass]}`)

    const origins = [...new Set(inClass.map((weapon) => weapon.origin))].sort(
      compareOrigins,
    )

    for (const origin of origins) {
      lines.push(`**${origin || UNATTRIBUTED}**`)
      const patterns = inClass
        .filter((weapon) => weapon.origin === origin)
        .sort((a, b) => a.name.localeCompare(b.name, 'en'))
      for (const weapon of patterns) {
        lines.push(`- ${weapon.name} — **${count(spare.get(weapon.name) ?? 0)}**`)
      }
      lines.push('')
    }
  }

  // Both figures, so the report answers "what have we got" as well as "what is
  // spare" — the two questions a player brings to it.
  const inPile = totalsByClass(spare, weapons)
  const total = totalsByClass(owned(units, stock), weapons)

  lines.push(
    `**In stockpile:** ${count(inPile.small_arm)} small arms · ${count(inPile.gun)} guns`,
    `**Total owned:** ${count(total.small_arm)} small arms · ${count(total.gun)} guns`,
  )

  return `${lines.join('\n').trimEnd()}\n`
}
