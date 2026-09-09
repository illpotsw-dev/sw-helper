import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canReparent, errorsOnly, validate } from './validate.ts'
import { DEFAULT_ECHELONS } from './types.ts'
import type { Formation, Holding, Unit, UnitType, Weapon } from './types.ts'
import { mcgreggor } from './fixture.test-helper.ts'

const echelons = DEFAULT_ECHELONS

const unitTypes: UnitType[] = [
  {
    name: 'Clan Levies',
    category: 'infantry',
    description: '',
    recruitCost: 20,
    upkeepPerTurn: 0.5,
    buildTimeTurns: 1,
    men: 1000,
    weapons: 0,
  },
  {
    name: 'Light Artillery Battery',
    category: 'artillery',
    description: '',
    recruitCost: 40,
    upkeepPerTurn: 2,
    buildTimeTurns: 1,
    men: 0,
    weapons: 20,
  },
]

const formation = (over: Partial<Formation> = {}): Formation => ({
  id: 1,
  designId: 1,
  parentId: null,
  echelon: 'XX',
  name: 'A Division',
  sortOrder: 0,
  ...over,
})

// Fully armed unless a test says otherwise, so changing a fixture's strength
// does not incidentally make it over- or under-armed and add a problem the
// test was not looking for.
const unit = (over: Partial<Unit> = {}): Unit => {
  const base: Unit = {
    id: 1,
    formationId: 1,
    unitType: 'Clan Levies',
    designation: 'I/I Levy Battalion',
    men: 1000,
    weapons: 0,
    weapon: 'Warden Rifle',
    weaponCount: 1000,
    sortOrder: 0,
    ...over,
  }
  return {
    ...base,
    weaponCount:
      over.weaponCount ?? (base.weapon === '' ? 0 : base.men || base.weapons),
  }
}

const rules = (input: Parameters<typeof validate>[0]) =>
  validate(input).map((p) => p.rule)

test("Clan McGreggor's roster is valid", () => {
  const { formations, units, unitTypes: catalog, weapons, stock } = mcgreggor()
  const problems = validate({
    formations,
    units,
    unitTypes: catalog,
    echelons,
    weapons,
    stock,
  })

  assert.deepEqual(errorsOnly(problems), [])

  // Four Mounted Borders battalions ride without rifles, which is a legal way
  // to run a nation short of them and blocks nothing.
  assert.deepEqual(
    problems.map((p) => p.rule),
    ['unarmed', 'unarmed', 'unarmed', 'unarmed'],
  )
  assert.match(problems[0].message, /770 carrying nothing/)
})

test('accepts multiple roots', () => {
  const problems = validate({
    formations: [
      formation({ id: 1, echelon: 'XXXX' }),
      formation({ id: 2, echelon: 'X', name: 'A Garrison' }),
    ],
    units: [],
    unitTypes,
    echelons,
  })
  assert.deepEqual(problems, [])
})

test('flags a formation not below its parent', () => {
  const problems = rules({
    formations: [
      formation({ id: 1, echelon: 'II', name: 'A Battalion' }),
      formation({ id: 2, parentId: 1, echelon: 'X', name: 'A Brigade' }),
    ],
    units: [],
    unitTypes,
    echelons,
  })
  assert.deepEqual(problems, ['echelon-order'])
})

test('flags equal echelons, not just inverted ones', () => {
  const problems = rules({
    formations: [formation({ id: 1 }), formation({ id: 2, parentId: 1 })],
    units: [],
    unitTypes,
    echelons,
  })
  assert.deepEqual(problems, ['echelon-order'])
})

test('flags a dangling parent', () => {
  const problems = rules({
    formations: [formation({ id: 1, parentId: 99 })],
    units: [],
    unitTypes,
    echelons,
  })
  assert.deepEqual(problems, ['unknown-parent'])
})

test('flags a cycle without hanging', () => {
  const problems = rules({
    formations: [
      formation({ id: 1, parentId: 2, echelon: 'XX' }),
      formation({ id: 2, parentId: 1, echelon: 'X' }),
    ],
    units: [],
    unitTypes,
    echelons,
  })
  assert.ok(problems.includes('cycle'))
})

test('flags an unknown echelon symbol', () => {
  const problems = rules({
    formations: [formation({ echelon: 'XXXXXX' as Formation['echelon'] })],
    units: [],
    unitTypes,
    echelons,
  })
  assert.deepEqual(problems, ['unknown-echelon'])
})

test('requires an exact unit type match', () => {
  const problems = rules({
    formations: [formation()],
    // Real drift from the McGreggor roster: the OOB said this, the catalog
    // said "Clan's Guard".
    units: [unit({ unitType: 'Clan Guard Elite Battalion' })],
    unitTypes,
    echelons,
  })
  assert.deepEqual(problems, ['unknown-unit-type'])
})

test('does not case-fold or trim a unit type', () => {
  for (const name of ['clan levies', 'Clan Levies ', 'ClanLevies']) {
    assert.deepEqual(
      rules({
        formations: [formation()],
        units: [unit({ unitType: name })],
        unitTypes,
        echelons,
      }),
      ['unknown-unit-type'],
      name,
    )
  }
})

test('notes a unit with no strength rather than failing it', () => {
  const input = {
    formations: [formation()],
    units: [unit({ men: 0, weapons: 0 })],
    unitTypes,
    echelons,
  }
  assert.deepEqual(rules(input), ['paper-unit'])
  // A paper unit must not block promote-to-live: it is a notice, not an error.
  assert.deepEqual(errorsOnly(validate(input)), [])
})

test('flags a unit carrying both men and guns', () => {
  const problems = rules({
    formations: [formation()],
    units: [unit({ men: 500, weapons: 20 })],
    unitTypes,
    echelons,
  })
  assert.deepEqual(problems, ['strength-exclusive'])
})

test('flags a battery counted in men', () => {
  const problems = rules({
    formations: [formation()],
    units: [
      unit({ unitType: 'Light Artillery Battery', men: 150, weapons: 0 }),
    ],
    unitTypes,
    echelons,
  })
  assert.deepEqual(problems, ['strength-wrong-measure'])
})

test('flags infantry counted in guns', () => {
  const problems = rules({
    formations: [formation()],
    units: [unit({ men: 0, weapons: 24 })],
    unitTypes,
    echelons,
  })
  assert.deepEqual(problems, ['strength-wrong-measure'])
})

test('flags a unit attached to a formation that does not exist', () => {
  const problems = rules({
    formations: [formation({ id: 1 })],
    units: [unit({ formationId: 99 })],
    unitTypes,
    echelons,
  })
  assert.deepEqual(problems, ['unknown-formation'])
})

test('reports every problem at once, not just the first', () => {
  const problems = rules({
    formations: [formation({ id: 1, parentId: 99 })],
    units: [unit({ unitType: 'Nope', men: 0, weapons: 0 })],
    unitTypes,
    echelons,
  })
  assert.ok(problems.length >= 3, problems.join(', '))
})

const division = formation({ id: 1, echelon: 'XX', name: 'A Division' })
const brigade = formation({ id: 2, parentId: 1, echelon: 'X', name: 'A Brigade' })
const army = formation({ id: 3, echelon: 'XXXX', name: 'An Army' })
const all = [division, brigade, army]

test('a move to root is always allowed', () => {
  assert.deepEqual(canReparent(division, null, all, echelons), { ok: true })
})

test('a division may move under an army', () => {
  assert.deepEqual(canReparent(division, army, all, echelons), { ok: true })
})

test('a division may not move under its own brigade', () => {
  const result = canReparent(division, brigade, all, echelons)
  assert.equal(result.ok, false)
})

test('a formation may not report to itself', () => {
  const result = canReparent(division, division, all, echelons)
  assert.equal(result.ok, false)
})

test('a brigade may not take a division as a child', () => {
  const result = canReparent(army, brigade, all, echelons)
  assert.equal(result.ok, false)
})

// --- Arming, per mvp-stockpile.md §8 -------------------------------------

const arsenal: Weapon[] = [
  {
    name: 'Warden Rifle',
    class: 'small_arm',
    origin: 'Clan McGreggor',
    description: '',
  },
  {
    name: '18-Pounder',
    class: 'gun',
    origin: 'Clan McGreggor',
    description: '',
  },
]

const armed = (over: Partial<Unit> = {}, holdings?: Holding[]) =>
  validate({
    formations: [formation()],
    units: [unit(over)],
    unitTypes,
    echelons,
    weapons: arsenal,
    stock: [{ weapon: 'Warden Rifle', quantity: 615 }],
    holdings,
  }).map((p) => p.rule)

test('a weapon outside the catalog is an error, exactly as a unit type is', () => {
  assert.deepEqual(armed({ weapon: 'Warden Rifle (.45)' }), ['unknown-weapon'])
  assert.deepEqual(armed({ weapon: 'warden rifle' }), ['unknown-weapon'])
})

test('a gun issued to a man-counted unit is an error', () => {
  assert.deepEqual(armed({ weapon: '18-Pounder' }), ['weapon-wrong-class'])
})

test('a small arm issued to a battery is an error', () => {
  assert.deepEqual(
    armed({
      unitType: 'Light Artillery Battery',
      men: 0,
      weapons: 20,
      weapon: 'Warden Rifle',
    }),
    ['weapon-wrong-class'],
  )
})

test('a unit holding more weapons than it has men is an error', () => {
  // The spares belong in the stockpile: a unit carrying them is holding
  // stockpile in the wrong place.
  assert.deepEqual(armed({ men: 600, weaponCount: 1000 }), ['over-armed'])
})

test('a unit holding fewer is a notice carrying the gap', () => {
  const problems = validate({
    formations: [formation()],
    units: [unit({ men: 1000, weaponCount: 200 })],
    unitTypes,
    echelons,
    weapons: arsenal,
  })
  assert.deepEqual(
    problems.map((p) => p.rule),
    ['under-armed'],
  )
  assert.match(problems[0].message, /under-armed by 800/)
  // A notice blocks nothing: this is the normal state of a nation between a
  // battle and a re-arm.
  assert.deepEqual(errorsOnly(problems), [])
})

test('a unit carrying nothing is a notice, not a failing', () => {
  assert.deepEqual(armed({ weapon: '', weaponCount: 0 }), ['unarmed'])
})

test('a paper unit is not also reported as unarmed', () => {
  // It is already reported as a paper unit; saying it carries nothing adds
  // nothing to that.
  assert.deepEqual(armed({ men: 0, weapons: 0, weapon: '', weaponCount: 0 }), [
    'paper-unit',
  ])
})

test('a second holding on one unit is an error, not a silent truncation', () => {
  assert.deepEqual(
    armed({}, [
      { unitId: 1, weapon: 'Warden Rifle', quantity: 600 },
      { unitId: 1, weapon: '18-Pounder', quantity: 400 },
    ]),
    ['multiple-holdings'],
  )
})

test('a negative stock quantity is an error', () => {
  const problems = validate({
    formations: [formation()],
    units: [],
    unitTypes,
    echelons,
    weapons: arsenal,
    stock: [{ weapon: 'Warden Rifle', quantity: -5 }],
  })
  assert.deepEqual(
    problems.map((p) => p.rule),
    ['negative-stock'],
  )
})
