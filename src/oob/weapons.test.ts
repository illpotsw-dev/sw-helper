import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStockpile, parseWeapons } from './yaml.ts'
import { errorsOnly } from './validate.ts'
import { mcgreggor } from './fixture.test-helper.ts'

test("reads Clan McGreggor's weapon catalog", () => {
  const { weapons } = mcgreggor()

  assert.equal(weapons.length, 13)

  const warden = weapons.find((w) => w.name === 'Warden Rifle (.45 Caliber)')
  assert.ok(warden)
  assert.equal(warden.class, 'small_arm')
  assert.equal(warden.origin, 'Clan McGreggor')

  const siege = weapons.find((w) => w.name === 'Rossenheim Siege Gun')
  assert.ok(siege)
  assert.equal(siege.class, 'gun')
  assert.equal(siege.origin, 'Rossenheim')
})

test("reads Clan McGreggor's opening stockpile", () => {
  const { weapons, stock } = mcgreggor()

  // Eight patterns are named; the other five have none spare, which the file
  // states by omitting them rather than by listing a zero.
  assert.equal(stock.length, 8)

  const classOf = new Map(weapons.map((w) => [w.name, w.class]))
  const total = (weaponClass: string) =>
    stock
      .filter((entry) => classOf.get(entry.weapon) === weaponClass)
      .reduce((sum, entry) => sum + entry.quantity, 0)

  // The figures spec §7 quotes: short on purpose, which is what makes the
  // re-arm flow the first thing a player reaches for.
  assert.equal(total('small_arm'), 1100)
  assert.equal(total('gun'), 24)
})

test('every small arm in the pile is short of arming the smallest unarmed battalion', () => {
  // The constraint stockpile.yml documents: 770 men is the smallest of the
  // four unarmed Mounted Borders battalions, and a clan with the rifles to arm
  // its cavalry presumably would have.
  const { weapons, stock } = mcgreggor()
  const classOf = new Map(weapons.map((w) => [w.name, w.class]))

  for (const entry of stock) {
    if (classOf.get(entry.weapon) !== 'small_arm') continue
    assert.ok(
      entry.quantity < 770,
      `${entry.weapon} at ${entry.quantity} would arm a battalion that the roster records as unarmed`,
    )
  }
})

test("Clan McGreggor's files parse without an error between them", () => {
  const { weapons } = parseWeapons(WEAPONS)
  const catalog = parseStockpile(STOCKPILE, weapons)
  assert.deepEqual(errorsOnly(catalog.problems), [])
})

const WEAPONS = `
weapons:
  - name: Warden Rifle (.45 Caliber)
    class: small_arm
    origin: Clan McGreggor
  - name: Cyclone Repeating Gun (.50 Caliber)
    class: gun
    origin: Clan McGreggor
`

const STOCKPILE = `
stockpile:
  - weapon: Warden Rifle (.45 Caliber)
    quantity: 615
`

test('a stockpile naming a weapon the catalog lacks is an error, not a new weapon', () => {
  const { weapons } = parseWeapons(WEAPONS)
  const { stock, problems } = parseStockpile(
    `
stockpile:
  - weapon: Warden Rifle (.45)
    quantity: 40
`,
    weapons,
  )

  assert.deepEqual(stock, [])
  assert.equal(problems.length, 1)
  assert.equal(problems[0].rule, 'unknown-stock-weapon')
  assert.match(problems[0].message, /Warden Rifle \(\.45\)/)
})

test('a weapon name is matched exactly, with no case-folding or trimming', () => {
  const { weapons } = parseWeapons(WEAPONS)
  const { problems } = parseStockpile(
    `
stockpile:
  - weapon: warden rifle (.45 caliber)
    quantity: 1
  - weapon: "Warden Rifle (.45 Caliber) "
    quantity: 1
`,
    weapons,
  )

  assert.equal(errorsOnly(problems).length, 2)
})

test('the catalog rejects a duplicate pattern rather than merging it', () => {
  const { weapons, problems } = parseWeapons(`
weapons:
  - name: Warden Rifle (.45 Caliber)
    class: small_arm
  - name: Warden Rifle (.45 Caliber)
    class: gun
`)

  assert.equal(weapons.length, 1)
  assert.equal(weapons[0].class, 'small_arm')
  assert.equal(problems[0].rule, 'duplicate-weapon')
})

test('the pile rejects a duplicate entry and a negative quantity', () => {
  const { weapons } = parseWeapons(WEAPONS)
  const { stock, problems } = parseStockpile(
    `
stockpile:
  - weapon: Warden Rifle (.45 Caliber)
    quantity: 615
  - weapon: Warden Rifle (.45 Caliber)
    quantity: 40
  - weapon: Cyclone Repeating Gun (.50 Caliber)
    quantity: -1
`,
    weapons,
  )

  assert.deepEqual(stock, [{ weapon: 'Warden Rifle (.45 Caliber)', quantity: 615 }])
  assert.deepEqual(
    problems.map((p) => p.rule),
    ['duplicate-stock-weapon', 'negative-stock'],
  )
})

test('an entry with no weapon named is reported rather than skipped silently', () => {
  const { weapons } = parseWeapons(WEAPONS)
  const { problems } = parseStockpile(
    `
stockpile:
  - quantity: 12
`,
    weapons,
  )

  assert.equal(problems[0].rule, 'stock-missing-weapon')
})

test('an absent stockpile file leaves the whole catalog at zero', () => {
  const { weapons } = parseWeapons(WEAPONS)
  const { stock, problems } = parseStockpile('', weapons)

  assert.deepEqual(stock, [])
  assert.deepEqual(problems, [])
})
