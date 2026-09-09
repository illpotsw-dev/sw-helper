import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  owned,
  planMovement,
  reconcileDesign,
  stockMap,
  totalsByClass,
} from './arm.ts'
import type { Plan, PlanInput } from './arm.ts'
import { buildTree } from './tree.ts'
import { mcgreggor } from './fixture.test-helper.ts'
import type { StockEntry, Unit } from './types.ts'

const roster = mcgreggor()
const tree = buildTree(roster.formations, roster.units, roster.unitTypes)

const byName = (designation: string): Unit => {
  const unit = roster.units.find((u) => u.designation === designation)
  assert.ok(unit, `no unit called ${designation}`)
  return unit
}

const idsOf = (...designations: string[]) =>
  new Set(designations.map((name) => byName(name).id))

const plan = (over: Partial<PlanInput> = {}): Plan =>
  planMovement({
    tree,
    unitTypes: roster.unitTypes,
    weapons: roster.weapons,
    stock: roster.stock,
    selectedUnitIds: new Set(),
    weapon: '',
    onShortfall: 'refuse',
    ...over,
  })

/**
 * The ledger, before and after. `stock + issued` is what the nation owns, and
 * no movement may change it — that invariance is the whole point of the
 * feature, so every case below checks it.
 */
function ownedAfter(result: Plan, stock: readonly StockEntry[]): Map<string, number> {
  const after = new Map(stockMap(stock))
  for (const [weapon, quantity] of result.stockAfter) after.set(weapon, quantity)

  const holdings = new Map(
    roster.units.map((unit) => [unit.id, { weapon: unit.weapon, quantity: unit.weaponCount }]),
  )
  for (const row of result.rows) holdings.set(row.unitId, row.to)

  const totals = new Map(after)
  for (const holding of holdings.values()) {
    if (holding.weapon === '') continue
    totals.set(holding.weapon, (totals.get(holding.weapon) ?? 0) + holding.quantity)
  }
  return totals
}

const ownedBefore = () => owned(roster.units, roster.stock)

const assertConserved = (result: Plan) => {
  assert.deepEqual(
    [...ownedAfter(result, roster.stock)].sort(),
    [...ownedBefore()].sort(),
    'the movement created or destroyed weapons',
  )
}

// --- The worked example, mvp-stockpile.md §10 ----------------------------

const HIGHLANDERS = idsOf(
  'I Highlander Battalion',
  'II Highlander Battalion',
  'III Highlander Battalion',
)

const LEXINGTON = 'Lexington Pattern Rifle (.30-06 Lexington Smokeless)'

/** The pile after a raid nets 2,000 Lexingtons, entered as an acquisition. */
const afterRaid: StockEntry[] = [
  ...roster.stock,
  { weapon: LEXINGTON, quantity: 2000 },
]

test('the shortfall is reported with its exact size', () => {
  const result = plan({
    selectedUnitIds: HIGHLANDERS,
    weapon: LEXINGTON,
    stock: afterRaid,
  })

  // 975 + 945 + 920 against 2,000 in store.
  assert.equal(result.needed, 2840)
  assert.equal(result.available, 2000)
  assert.equal(result.short, 840)
})

test('a shortfall commits nothing until the player has chosen', () => {
  const result = plan({
    selectedUnitIds: HIGHLANDERS,
    weapon: LEXINGTON,
    stock: afterRaid,
    onShortfall: 'refuse',
  })

  assert.equal(result.blocked, true)
  assert.deepEqual(result.rows, [])
  assert.equal(result.stockAfter.size, 0)
})

test('arming as far as it goes serves units in tree order', () => {
  const result = plan({
    selectedUnitIds: HIGHLANDERS,
    weapon: LEXINGTON,
    stock: afterRaid,
    onShortfall: 'as-far-as-it-goes',
  })

  assert.equal(result.blocked, false)
  assert.deepEqual(
    result.rows.map((row) => [row.designation, row.to.quantity, row.gap]),
    [
      ['I Highlander Battalion', 975, 0],
      ['II Highlander Battalion', 945, 0],
      // The third draws what is left and stands at 80 of 920.
      ['III Highlander Battalion', 80, 840],
    ],
  )

  // Every Barclay the three were carrying is back in the pile, where it
  // immediately becomes the obvious thing to re-arm the third with.
  assert.equal(result.stockAfter.get('Barclay Hornets (7x57mm)'), 340 + 2840)
  assert.equal(result.stockAfter.get(LEXINGTON), 0)
})

test('the worked example changes where weapons are, never how many exist', () => {
  const result = plan({
    selectedUnitIds: HIGHLANDERS,
    weapon: LEXINGTON,
    stock: afterRaid,
    onShortfall: 'as-far-as-it-goes',
  })

  const before = owned(roster.units, afterRaid)
  const after = ownedAfter(result, afterRaid)
  assert.equal(after.get(LEXINGTON), before.get(LEXINGTON))
  assert.equal(
    after.get('Barclay Hornets (7x57mm)'),
    before.get('Barclay Hornets (7x57mm)'),
  )
})

// --- Issue, withdraw, and the pile ---------------------------------------

test('issuing to an unarmed battalion is a re-arm with nothing to hand back', () => {
  // I Mounted Borders, 770 men, against 615 Wardens in store.
  const result = plan({
    selectedUnitIds: idsOf('I Mounted Borders Battalion'),
    weapon: 'Warden Rifle (.45 Caliber)',
    onShortfall: 'as-far-as-it-goes',
  })

  assert.equal(result.needed, 770)
  assert.equal(result.available, 615)
  assert.equal(result.short, 155)
  assert.deepEqual(result.rows[0].from, { weapon: '', quantity: 0 })
  assert.deepEqual(result.rows[0].to, {
    weapon: 'Warden Rifle (.45 Caliber)',
    quantity: 615,
  })
  assert.equal(result.rows[0].gap, 155)
  assert.equal(result.stockAfter.get('Warden Rifle (.45 Caliber)'), 0)
  assertConserved(result)
})

test('withdrawing is a re-arm with nothing to draw', () => {
  const result = plan({
    selectedUnitIds: idsOf('I/I Levy Battalion'),
    weapon: '',
  })

  assert.deepEqual(result.rows[0].to, { weapon: '', quantity: 0 })
  assert.equal(result.rows[0].gap, 1000)
  assert.equal(result.short, 0)
  assert.equal(result.stockAfter.get('Warden Rifle (.45 Caliber)'), 615 + 1000)
  assertConserved(result)
})

test('re-arming a unit with what it already carries is a no-op', () => {
  const result = plan({
    selectedUnitIds: idsOf('I/I Levy Battalion'),
    weapon: 'Warden Rifle (.45 Caliber)',
  })

  // Its 1,000 come back before its 1,000 go out, so there is no shortfall to
  // report against a pile that holds only 615.
  assert.equal(result.short, 0)
  assert.deepEqual(result.rows, [])
})

test('a pattern with none in store arms nobody, and says so exactly', () => {
  const result = plan({
    selectedUnitIds: idsOf('I Mounted Borders Battalion'),
    weapon: LEXINGTON,
    onShortfall: 'as-far-as-it-goes',
  })

  // All 870 Lexingtons are in the Sharpshooters' hands and none are spare.
  assert.equal(result.available, 0)
  assert.equal(result.short, 770)
  assert.deepEqual(result.rows, [])
})

// --- Class, selection and reporting --------------------------------------

test('a gun cannot be issued to men, and the units are left out with a note', () => {
  const result = plan({
    selectedUnitIds: idsOf(
      'I/I Levy Battalion',
      '1st Light Artillery Battery',
    ),
    weapon: 'Vanguard Light Field Gun (12-Pounder)',
    onShortfall: 'as-far-as-it-goes',
  })

  // Only the battery is eligible; the levy battalion is not reported as an
  // error, it is simply not part of a plan to issue field guns.
  assert.equal(result.needed, 20)
  assert.match(result.notes[0], /1 man-counted unit is left out/)
  assert.deepEqual(
    result.rows.map((row) => row.designation),
    [],
  )
})

test('a selection with nothing that can carry the weapon says so', () => {
  const result = plan({
    selectedUnitIds: idsOf('I/I Levy Battalion'),
    weapon: '18-Pounder Pattern M Field Gun',
    onShortfall: 'as-far-as-it-goes',
  })

  assert.equal(result.needed, 0)
  assert.ok(result.notes.some((note) => /No unit in the selection/.test(note)))
  assert.deepEqual(result.rows, [])
})

test('a weapon outside the catalog plans nothing at all', () => {
  const result = plan({
    selectedUnitIds: idsOf('I/I Levy Battalion'),
    weapon: 'Warden Rifle (.45)',
  })

  assert.equal(result.blocked, true)
  assert.deepEqual(result.rows, [])
  assert.match(result.notes[0], /not in the weapon catalog/)
})

test('units outside the selection are never touched', () => {
  const result = plan({
    selectedUnitIds: idsOf('I Mounted Borders Battalion'),
    weapon: 'Warden Rifle (.45 Caliber)',
    onShortfall: 'as-far-as-it-goes',
  })

  assert.deepEqual(
    result.rows.map((row) => row.designation),
    ['I Mounted Borders Battalion'],
  )
})

test('the same selection against the same pile always plans the same', () => {
  const once = plan({
    selectedUnitIds: HIGHLANDERS,
    weapon: LEXINGTON,
    stock: afterRaid,
    onShortfall: 'as-far-as-it-goes',
  })
  const twice = plan({
    selectedUnitIds: HIGHLANDERS,
    weapon: LEXINGTON,
    stock: afterRaid,
    onShortfall: 'as-far-as-it-goes',
  })
  assert.deepEqual(once.rows, twice.rows)
})

// --- The ledger ----------------------------------------------------------

test("the seeded nation's owned totals are the ones the report quotes", () => {
  const totals = totalsByClass(ownedBefore(), roster.weapons)
  assert.deepEqual(totals, { small_arm: 29085, gun: 549 })

  const spare = totalsByClass(stockMap(roster.stock), roster.weapons)
  assert.deepEqual(spare, { small_arm: 1100, gun: 24 })
})

test('every movement in this suite conserves the ledger', () => {
  const cases: Partial<PlanInput>[] = [
    { selectedUnitIds: HIGHLANDERS, weapon: 'Warden Rifle (.45 Caliber)' },
    { selectedUnitIds: HIGHLANDERS, weapon: '' },
    {
      selectedUnitIds: idsOf('I Mounted Borders Battalion'),
      weapon: 'Barclay Hornets (7x57mm)',
    },
    {
      selectedUnitIds: idsOf('1st Machine Gun Battery'),
      weapon: 'Cyclone Repeating Gun (.50 Caliber)',
    },
    {
      selectedUnitIds: idsOf('1st Machine Gun Battery'),
      weapon: 'Glenforge 6-Pounder Smoothbore Cannon',
    },
  ]

  for (const over of cases) {
    assertConserved(plan({ ...over, onShortfall: 'as-far-as-it-goes' }))
  }
})

test('no plan ever leaves a weapon in store at less than nothing', () => {
  for (const weapon of roster.weapons) {
    const result = plan({
      selectedUnitIds: new Set(roster.units.map((u) => u.id)),
      weapon: weapon.name,
      onShortfall: 'as-far-as-it-goes',
    })
    for (const [name, quantity] of result.stockAfter) {
      assert.ok(quantity >= 0, `${weapon.name} left ${name} at ${quantity}`)
    }
  }
})

test('no plan ever leaves a unit holding more than it has men', () => {
  const strengthOf = new Map(
    roster.units.map((u) => [u.id, u.men || u.weapons]),
  )
  for (const weapon of roster.weapons) {
    const result = plan({
      selectedUnitIds: new Set(roster.units.map((u) => u.id)),
      weapon: weapon.name,
      onShortfall: 'as-far-as-it-goes',
    })
    for (const row of result.rows) {
      assert.ok(row.to.quantity <= (strengthOf.get(row.unitId) ?? 0))
    }
  }
})

// --- Promote-to-live reconciliation, §4 ----------------------------------

const armedLike = (source: Unit, weapon: string, quantity: number): Unit => ({
  ...source,
  weapon,
  weaponCount: quantity,
})

test('a design the nation can arm has no shortfall', () => {
  // The live roster promoted back over itself: it is armed out of exactly what
  // it already holds, so nothing is short.
  assert.deepEqual(
    reconcileDesign({
      liveUnits: roster.units,
      stock: roster.stock,
      designUnits: roster.units,
    }),
    [],
  )
})

test('a design that arms troops the nation cannot arm is blocked, per weapon', () => {
  // Arm the four unarmed Mounted Borders battalions with Wardens on paper:
  // 3,495 rifles on top of the 20,215 already issued, against 20,830 owned.
  // The 615 spare cover part of it and the rest is short.
  const designUnits = roster.units.map((unit) =>
    unit.designation.endsWith('Mounted Borders Battalion')
      ? armedLike(unit, 'Warden Rifle (.45 Caliber)', unit.men)
      : unit,
  )

  assert.deepEqual(
    reconcileDesign({
      liveUnits: roster.units,
      stock: roster.stock,
      designUnits,
    }),
    [
      {
        weapon: 'Warden Rifle (.45 Caliber)',
        owned: 20830,
        needed: 23710,
        short: 2880,
      },
    ],
  )
})

test('the pile counts towards a design, since promotion draws on it', () => {
  // 615 Wardens are spare, so a design arming one extra battalion with 615 is
  // exactly affordable and 616 is not.
  const extra = (quantity: number) => [
    ...roster.units,
    armedLike(
      byName('I Mounted Borders Battalion'),
      'Warden Rifle (.45 Caliber)',
      quantity,
    ),
  ]

  assert.deepEqual(
    reconcileDesign({
      liveUnits: roster.units,
      stock: roster.stock,
      designUnits: extra(615),
    }),
    [],
  )
  assert.equal(
    reconcileDesign({
      liveUnits: roster.units,
      stock: roster.stock,
      designUnits: extra(616),
    })[0].short,
    1,
  )
})

test('duplicating a design does not double the arsenal on paper', () => {
  // The bug the live-only rule exists to forbid: if the design's own holdings
  // counted as owned, this would reconcile against twice what the clan has.
  const duplicate = [...roster.units, ...roster.units]

  const shortfalls = reconcileDesign({
    liveUnits: roster.units,
    stock: roster.stock,
    designUnits: duplicate,
  })

  assert.ok(shortfalls.length > 0, 'a design twice the size cannot be armed')
  assert.equal(
    shortfalls.find((s) => s.weapon === 'Warden Rifle (.45 Caliber)')?.short,
    20215 * 2 - 20830,
  )
})

test('a design that unarms troops frees weapons rather than needing them', () => {
  const disarmed = roster.units.map((unit) =>
    armedLike(unit, '', 0),
  )
  assert.deepEqual(
    reconcileDesign({
      liveUnits: roster.units,
      stock: roster.stock,
      designUnits: disarmed,
    }),
    [],
  )
})
