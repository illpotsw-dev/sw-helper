import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportStockpileMarkdown } from './stockpile-report.ts'
import { mcgreggor } from './fixture.test-helper.ts'
import type { StockEntry, Weapon } from './types.ts'

const roster = mcgreggor()

const report = (over: { stock?: StockEntry[]; weapons?: Weapon[] } = {}) =>
  exportStockpileMarkdown({
    nationName: 'Clan McGreggor',
    weapons: over.weapons ?? roster.weapons,
    stock: over.stock ?? roster.stock,
    units: roster.units,
  })

test("the seeded nation exports the document the spec quotes", () => {
  assert.equal(
    report(),
    `## Weapons Stockpile — Clan McGreggor

### Small Arms
**Barclay**
- Barclay Hornets (7x57mm) — **340**

**Clan McGreggor**
- Warden Rifle (.45 Caliber) — **615**

**Rossenheim**
- Einzelgänger (.68 Caliber) — **145**

### Guns
**Clan McGreggor**
- 18-Pounder Pattern M Field Gun — **4**
- Cyclone Repeating Gun (.50 Caliber) — **6**
- Glenforge 6-Pounder Smoothbore Cannon — **11**
- Vanguard Light Field Gun (12-Pounder) — **2**

**Rossenheim**
- Rossenheim Machine Gun (11mm) — **1**

**In stockpile:** 1,100 small arms · 24 guns
**Total owned:** 29,085 small arms · 549 guns
`,
  )
})

test('a weapon at zero is omitted rather than listed as zero', () => {
  const text = report()
  // All 870 Lexingtons are in the Sharpshooters' hands, and none are spare.
  assert.ok(!text.includes('Lexington'))
  assert.ok(!text.includes('— **0**'))
})

test('an unattributed origin sorts last rather than first', () => {
  const text = report({
    weapons: [
      { name: 'Anonymous Musket', class: 'small_arm', origin: '', description: '' },
      { name: 'Zenith Rifle', class: 'small_arm', origin: 'Zenith', description: '' },
      { name: 'Alpha Rifle', class: 'small_arm', origin: 'Alpha', description: '' },
    ],
    stock: [
      { weapon: 'Anonymous Musket', quantity: 5 },
      { weapon: 'Zenith Rifle', quantity: 5 },
      { weapon: 'Alpha Rifle', quantity: 5 },
    ],
  })

  assert.deepEqual(
    text.split('\n').filter((line) => line.startsWith('**') && !line.includes(':')),
    ['**Alpha**', '**Zenith**', '**Unattributed**'],
  )
})

test('an empty pile says so rather than exporting an empty document', () => {
  const text = report({ stock: [] })

  assert.match(text, /The stockpile is empty/)
  assert.match(text, /\*\*In stockpile:\*\* 0 small arms · 0 guns/)
  // Owned is unaffected: everything the clan has is simply in someone's hands.
  assert.match(text, /\*\*Total owned:\*\* 27,985 small arms · 525 guns/)
})

test('a class with nothing spare gets no heading at all', () => {
  const text = report({
    stock: roster.stock.filter((entry) => entry.weapon.includes('Warden')),
  })

  assert.ok(text.includes('### Small Arms'))
  assert.ok(!text.includes('### Guns'))
})
