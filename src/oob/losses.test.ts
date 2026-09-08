import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allNodes, buildTree, establishmentOf } from './tree.ts'
import type { TreeNode } from './tree.ts'
import {
  allocate,
  NO_STEERING,
  subtotal,
  type AllocationInput,
  type Steering,
} from './losses.ts'
import { mcgreggor } from './fixture.test-helper.ts'
import type { Unit } from './types.ts'

const { formations, units, unitTypes } = mcgreggor()
const tree = buildTree(formations, units, unitTypes)

const node = (name: string): TreeNode => {
  const found = allNodes(tree).find((n) => n.formation.name === name)
  assert.ok(found, `no formation named ${name}`)
  return found
}

const unitsUnder = (name: string): Unit[] => {
  const collected: Unit[] = []
  const walk = (current: TreeNode): void => {
    collected.push(...current.units)
    current.children.forEach(walk)
  }
  walk(node(name))
  return collected
}

const idsUnder = (...names: string[]): Set<number> =>
  new Set(names.flatMap((name) => unitsUnder(name).map((u) => u.id)))

const unitNamed = (designation: string): Unit => {
  const found = units.find((u) => u.designation === designation)
  assert.ok(found, `no unit called ${designation}`)
  return found
}

const typeOf = (unit: Unit) => {
  const found = unitTypes.find((t) => t.name === unit.unitType)
  assert.ok(found, `no type ${unit.unitType}`)
  return found
}

const FIRST_DIVISION = 'I. Infantry Division — The Stone Line'
const SECOND_DIVISION = 'II. Infantry Division — Rising Mist'
const BOTH_DIVISIONS = idsUnder(FIRST_DIVISION, SECOND_DIVISION)

const steering = (partial: Partial<Steering>): Steering => ({
  formations: partial.formations ?? new Map(),
  units: partial.units ?? new Map(),
})

const input = (overrides: Partial<AllocationInput> = {}): AllocationInput => ({
  tree,
  unitTypes,
  selectedUnitIds: BOTH_DIVISIONS,
  direction: 'losses',
  totals: { men: 0, guns: 0 },
  steering: NO_STEERING,
  jitter: 0,
  seed: 1,
  ...overrides,
})

const report = (result: ReturnType<typeof allocate>, measure: 'men' | 'guns') => {
  const found = result.reports.find((r) => r.measure === measure)
  assert.ok(found)
  return found
}

const amounts = (result: ReturnType<typeof allocate>) =>
  [...result.byUnit.values()].map((row) => row.amount)

// --- the spec's worked example -------------------------------------------

test('spreads 6,700 men across both infantry divisions, summing exactly', () => {
  const levy = unitNamed('I/I Levy Battalion')
  const result = allocate(
    input({
      totals: { men: 6700, guns: 0 },
      jitter: 0.35,
      steering: steering({
        units: new Map([[levy.id, { multiplier: 4 }]]),
      }),
    }),
  )

  const men = report(result, 'men')
  assert.equal(men.allocated, 6700)
  assert.equal(men.unassigned, 0)
  assert.deepEqual(result.notes, [])

  // The severely-hit battalion takes more than any of its neighbours. At ×4
  // against a 13,675-man selection its share runs past what it has, so it
  // pins at capacity and is destroyed — the spill rule of spec §4, and why
  // it is the one figure here that is not a multiple of five by accident.
  const battalion = result.byUnit.get(levy.id)
  assert.ok(battalion)
  assert.ok(battalion.atCapacity)
  assert.ok(battalion.wipedOut)
  const others = [...result.byUnit.values()].filter((r) => r.unitId !== levy.id)
  for (const other of others) {
    assert.ok(
      battalion.amount > other.amount,
      `${battalion.amount} should beat ${other.amount}`,
    )
  }

  // Every figure lands on a multiple of five, and the spread is uneven rather
  // than the neat hundreds perfectly proportional maths would produce.
  for (const row of result.byUnit.values()) {
    assert.equal(row.amount % 5, 0, `unit ${row.unitId} took ${row.amount}`)
  }
  assert.ok(others.some((row) => row.amount % 100 !== 0))
})

test('the two divisions between them are the only rows touched', () => {
  const result = allocate(input({ totals: { men: 6700, guns: 0 } }))
  for (const unitId of result.byUnit.keys()) {
    assert.ok(BOTH_DIVISIONS.has(unitId), `unit ${unitId} was outside the selection`)
  }
  assert.equal(
    subtotal(node(FIRST_DIVISION), result, 'men') +
      subtotal(node(SECOND_DIVISION), result, 'men'),
    6700,
  )
})

// --- guarantees, mvp-battle-losses.md §8 ---------------------------------

test('allocated figures sum to the entered total exactly', () => {
  for (const total of [1000, 6700, 12345, 55, 9999]) {
    for (const jitter of [0, 0.15, 0.35, 0.6]) {
      const result = allocate(
        input({ totals: { men: total, guns: 0 }, jitter, seed: total }),
      )
      assert.equal(report(result, 'men').allocated, total, `${total} @ σ${jitter}`)
    }
  }
})

test('men round to fives, bar a capped unit and one sub-five leftover', () => {
  const result = allocate(input({ totals: { men: 6702, guns: 0 }, jitter: 0.35 }))
  const odd = amounts(result).filter((amount) => amount % 5 !== 0)
  assert.deepEqual(odd.length, 1)
  assert.equal(odd[0] % 5, 2)
  assert.equal(report(result, 'men').allocated, 6702)
})

test('guns are allocated exactly, never rounded', () => {
  // The garrison's siege battery fields a single gun; rounding to five would
  // have it lose five it does not have, or nothing at all when knocked out.
  const siege = unitNamed('Portree Garrison Siege Artillery Battery')
  assert.equal(siege.weapons, 1)

  const result = allocate(
    input({
      selectedUnitIds: idsUnder('Portree Garrison'),
      totals: { men: 0, guns: 7 },
      jitter: 0.35,
    }),
  )
  assert.equal(report(result, 'guns').allocated, 7)
  assert.ok(amounts(result).some((amount) => amount % 5 !== 0))
  for (const row of result.byUnit.values()) {
    assert.ok(row.amount <= row.capacity)
  }
})

test('a one-gun battery can be knocked out and no further', () => {
  const siege = unitNamed('Portree Garrison Siege Artillery Battery')
  const result = allocate(
    input({
      selectedUnitIds: new Set([siege.id]),
      totals: { men: 0, guns: 5 },
    }),
  )
  const row = result.byUnit.get(siege.id)
  assert.ok(row)
  assert.equal(row.amount, 1)
  assert.equal(row.after, 0)
  assert.ok(row.wipedOut)
  assert.equal(report(result, 'guns').unassigned, 4)
})

test('no unit falls below zero', () => {
  const result = allocate(input({ totals: { men: 13000, guns: 0 }, jitter: 0.6 }))
  for (const row of result.byUnit.values()) {
    assert.ok(row.after >= 0, `unit ${row.unitId} ended at ${row.after}`)
    assert.ok(row.amount <= row.before)
  }
})

test('with jitter off and every multiplier at ×1 the split is proportional', () => {
  const result = allocate(input({ totals: { men: 6700, guns: 0 }, jitter: 0 }))
  const eligible = [...BOTH_DIVISIONS]
    .map((id) => units.find((u) => u.id === id))
    .filter((u): u is Unit => !!u && u.men > 0)
  const capacity = eligible.reduce((sum, u) => sum + u.men, 0)

  for (const unit of eligible) {
    const row = result.byUnit.get(unit.id)
    assert.ok(row, unit.designation)
    const exact = (6700 * unit.men) / capacity
    // Within one chunk of the proportional share: the rounding step is what
    // separates them, nothing else.
    assert.ok(
      Math.abs(row.amount - exact) < 5,
      `${unit.designation}: ${row.amount} vs ${exact.toFixed(1)}`,
    )
  }
})

test('raising a row multiplier never decreases its share', () => {
  const levy = unitNamed('II/I Levy Battalion')
  let previous = 0
  for (const multiplier of [0.5, 1, 2, 4]) {
    const result = allocate(
      input({
        totals: { men: 6700, guns: 0 },
        steering: steering({ units: new Map([[levy.id, { multiplier }]]) }),
      }),
    )
    const amount = result.byUnit.get(levy.id)?.amount ?? 0
    assert.ok(amount >= previous, `×${multiplier} gave ${amount} after ${previous}`)
    previous = amount
  }
})

test('a formation multiplier cascades to everything beneath it', () => {
  const first = node(FIRST_DIVISION)
  const plain = allocate(input({ totals: { men: 6700, guns: 0 } }))
  const heavy = allocate(
    input({
      totals: { men: 6700, guns: 0 },
      steering: steering({
        formations: new Map([[first.formation.id, { multiplier: 2 }]]),
      }),
    }),
  )
  assert.ok(
    subtotal(first, heavy, 'men') > subtotal(first, plain, 'men'),
    'the division should take more of the same total',
  )
  assert.equal(report(heavy, 'men').allocated, 6700)
})

test('a spared row at ×0 is left alone entirely', () => {
  const levy = unitNamed('I/I Levy Battalion')
  const result = allocate(
    input({
      totals: { men: 6700, guns: 0 },
      steering: steering({ units: new Map([[levy.id, { multiplier: 0 }]]) }),
    }),
  )
  assert.equal(result.byUnit.get(levy.id), undefined)
  assert.equal(report(result, 'men').allocated, 6700)
})

test('a lock on a unit is honoured to the man', () => {
  const levy = unitNamed('I/I Levy Battalion')
  const result = allocate(
    input({
      totals: { men: 6700, guns: 0 },
      jitter: 0.35,
      steering: steering({ units: new Map([[levy.id, { lockMen: 337 }]]) }),
    }),
  )
  assert.equal(result.byUnit.get(levy.id)?.amount, 337)
  assert.equal(report(result, 'men').allocated, 6700)
})

test('a lock on a formation fixes its subtree total', () => {
  const first = node(FIRST_DIVISION)
  const result = allocate(
    input({
      totals: { men: 6700, guns: 0 },
      jitter: 0.35,
      steering: steering({
        formations: new Map([[first.formation.id, { lockMen: 4000 }]]),
      }),
    }),
  )
  assert.equal(subtotal(first, result, 'men'), 4000)
  assert.equal(subtotal(node(SECOND_DIVISION), result, 'men'), 2700)
  assert.equal(report(result, 'men').allocated, 6700)
})

test('the same seed reproduces the same split', () => {
  const build = (seed: number) =>
    allocate(input({ totals: { men: 6700, guns: 0 }, jitter: 0.35, seed }))

  const first = build(7)
  assert.deepEqual([...build(7).byUnit], [...first.byUnit])

  const other = build(8)
  assert.notDeepEqual([...other.byUnit], [...first.byUnit])
  assert.equal(report(other, 'men').allocated, 6700)
})

test('a shortfall is reported with its exact size', () => {
  const capacity = unitsUnder(FIRST_DIVISION).reduce((sum, u) => sum + u.men, 0)
  assert.equal(capacity, 6755)

  const result = allocate(
    input({
      selectedUnitIds: idsUnder(FIRST_DIVISION),
      totals: { men: 7000, guns: 0 },
    }),
  )
  const men = report(result, 'men')
  assert.equal(men.requested, 7000)
  assert.equal(men.allocatable, 6755)
  assert.equal(men.allocated, 6755)
  assert.equal(men.unassigned, 245)
  for (const row of result.byUnit.values()) {
    assert.equal(row.after, 0)
    assert.ok(row.wipedOut)
  }
})

test('a pool with no eligible unit is reported rather than zeroed', () => {
  // A gun total entered against a selection holding nothing counted in guns.
  const result = allocate(
    input({
      selectedUnitIds: new Set([unitNamed('I/I Levy Battalion').id]),
      totals: { men: 0, guns: 40 },
    }),
  )
  assert.equal(report(result, 'guns').eligibleUnits, 0)
  assert.equal(report(result, 'guns').unassigned, 40)
  assert.equal(result.notes.length, 1)
  assert.match(result.notes[0], /gun-counted/)
})

test('men and guns are separate pools over one selection', () => {
  const result = allocate(
    input({
      selectedUnitIds: idsUnder('McGreggor Army'),
      totals: { men: 2000, guns: 30 },
      jitter: 0.35,
    }),
  )
  assert.equal(report(result, 'men').allocated, 2000)
  assert.equal(report(result, 'guns').allocated, 30)
  for (const row of result.byUnit.values()) {
    const unit = units.find((u) => u.id === row.unitId)
    assert.ok(unit)
    assert.equal(row.measure, unit.men > 0 ? 'men' : 'guns')
  }
})

// --- reinforcements, spec §5 ---------------------------------------------

test('reinforcements fill no further than establishment', () => {
  const result = allocate(
    input({
      direction: 'reinforcements',
      selectedUnitIds: idsUnder(FIRST_DIVISION),
      totals: { men: 2000, guns: 0 },
      jitter: 0.35,
    }),
  )
  assert.equal(report(result, 'men').allocated, 2000)
  for (const row of result.byUnit.values()) {
    const unit = units.find((u) => u.id === row.unitId)
    assert.ok(unit)
    assert.ok(row.after <= establishmentOf(typeOf(unit)), unit.designation)
    assert.ok(row.after > row.before)
    assert.ok(!row.wipedOut)
  }
})

test('a unit already at establishment is skipped rather than fought over', () => {
  const full = units.filter(
    (u) => u.men > 0 && u.men >= establishmentOf(typeOf(u)),
  )
  assert.ok(full.length > 0, 'the fixture should hold a unit at or over strength')

  const result = allocate(
    input({
      direction: 'reinforcements',
      selectedUnitIds: idsUnder('McGreggor Army'),
      totals: { men: 2000, guns: 0 },
    }),
  )
  for (const unit of full) {
    assert.equal(result.byUnit.get(unit.id), undefined, unit.designation)
  }
  assert.equal(report(result, 'men').allocated, 2000)
})

test('a paper unit comes back as itself when replacements arrive', () => {
  const levy = unitNamed('I/I Levy Battalion')
  const wiped = units.map((u) => (u.id === levy.id ? { ...u, men: 0 } : u))
  const shattered = buildTree(formations, wiped, unitTypes)

  const result = allocate(
    input({
      tree: shattered,
      direction: 'reinforcements',
      selectedUnitIds: new Set([levy.id]),
      totals: { men: 400, guns: 0 },
    }),
  )
  const row = result.byUnit.get(levy.id)
  assert.ok(row)
  assert.equal(row.before, 0)
  assert.equal(row.after, 400)
  assert.equal(row.capacity, establishmentOf(typeOf(levy)))
})

test('reinforcements beyond the room available are reported', () => {
  const levy = unitNamed('III/I Levy Battalion')
  const room = establishmentOf(typeOf(levy)) - levy.men
  assert.equal(room, 165)
  const result = allocate(
    input({
      direction: 'reinforcements',
      selectedUnitIds: new Set([levy.id]),
      totals: { men: room + 500, guns: 0 },
    }),
  )
  assert.equal(result.byUnit.get(levy.id)?.amount, room)
  assert.equal(report(result, 'men').unassigned, 500)
})
