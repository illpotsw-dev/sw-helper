import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canReparent, validate } from './validate.ts'
import { DEFAULT_ECHELONS } from './types.ts'
import type { Formation, Unit, UnitType } from './types.ts'
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

const unit = (over: Partial<Unit> = {}): Unit => ({
  id: 1,
  formationId: 1,
  unitType: 'Clan Levies',
  designation: 'I/I Levy Battalion',
  men: 1000,
  weapons: 0,
  equipment: 'Warden Rifle',
  sortOrder: 0,
  ...over,
})

const rules = (input: Parameters<typeof validate>[0]) =>
  validate(input).map((p) => p.rule)

test("Clan McGreggor's roster is valid", () => {
  const { formations, units, unitTypes: catalog } = mcgreggor()
  assert.deepEqual(
    validate({ formations, units, unitTypes: catalog, echelons }),
    [],
  )
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

test('flags a unit with no strength', () => {
  const problems = rules({
    formations: [formation()],
    units: [unit({ men: 0, weapons: 0 })],
    unitTypes,
    echelons,
  })
  assert.deepEqual(problems, ['strength-exclusive'])
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
