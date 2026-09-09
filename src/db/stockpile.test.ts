import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { SCHEMA_STATEMENTS } from './schema.ts'
import {
  catalogStatements,
  creditStock,
  debitStock,
  designStatements,
  insertUnit,
  insertUnitType,
  rearmUnitStatements,
  applyMovementStatements,
} from './statements.ts'
import {
  beginAction,
  finishAction,
  installUndo,
  redo,
  undo,
  type Exec,
} from './undo.ts'
import { mcgreggor } from '../oob/fixture.test-helper.ts'
import type { Statement } from './protocol.ts'

/**
 * The app's own statements against the app's own schema, so the ledger's
 * constraints are real here: the weapons foreign key and the non-negative
 * stock CHECK apply exactly as they do in a browser.
 */
function open() {
  const db = new DatabaseSync(':memory:')
  const exec: Exec = (sql, params = []) =>
    db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[]

  for (const statement of SCHEMA_STATEMENTS) db.exec(statement)
  installUndo(exec)

  const run = (statements: Statement[], label: string) => {
    db.exec('BEGIN')
    try {
      const before = beginAction(exec)
      for (const s of statements) exec(s.sql, s.params)
      finishAction(exec, before, label)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  const stockOf = (weapon: string) =>
    Number(
      exec('SELECT quantity FROM weapon_stock WHERE weapon = ?', [weapon])[0]
        ?.quantity ?? -1,
    )

  const holdingOf = (unitId: number) => {
    const row = exec('SELECT * FROM oob_unit_weapons WHERE unit_id = ?', [
      unitId,
    ])[0]
    return row
      ? { weapon: String(row.weapon), quantity: Number(row.quantity) }
      : { weapon: '', quantity: 0 }
  }

  /**
   * The ledger, per weapon class. Issued counts the live design only —
   * holdings on a saved design are intentions, not property, or duplicating a
   * design would double the nation's arsenal on paper.
   */
  const ledger = (weaponClass: 'small_arm' | 'gun') => {
    const one = (sql: string) => Number(exec(sql, [weaponClass])[0]?.n ?? 0)
    const stock = one(
      `SELECT COALESCE(SUM(s.quantity), 0) AS n FROM weapon_stock s
       JOIN weapons w ON w.name = s.weapon WHERE w.class = ?`,
    )
    const issued = one(
      `SELECT COALESCE(SUM(h.quantity), 0) AS n FROM oob_unit_weapons h
       JOIN weapons w ON w.name = h.weapon
       JOIN oob_units u ON u.id = h.unit_id
       JOIN oob_formations f ON f.id = u.formation_id
       JOIN oob_designs d ON d.id = f.design_id
       WHERE w.class = ? AND d.is_live = 1`,
    )
    return { stock, issued, owned: stock + issued }
  }

  return { db, exec, run, stockOf, holdingOf, ledger }
}

const roster = mcgreggor()

const LEXINGTON = 'Lexington Pattern Rifle (.30-06 Lexington Smokeless)'

const seedCatalog = () => catalogStatements(roster.weapons, roster.stock)

/** The catalog, the pile and the whole live order of battle. */
const seedNation = () => [
  ...roster.unitTypes.map(insertUnitType),
  ...seedCatalog(),
  ...designStatements(1, 1, 1, {
    name: 'Order of Battle',
    isLive: true,
    formations: roster.formations,
    units: roster.units,
  }),
]

test("Clan McGreggor's catalog and pile satisfy every database constraint", () => {
  const { run, exec } = open()
  run(seedCatalog(), 'Load Clan McGreggor')

  assert.equal(Number(exec('SELECT count(*) AS n FROM weapons')[0].n), 13)

  // A row per catalog weapon, not per stockpile entry: a movement is then
  // always an UPDATE and never has to decide whether the row exists.
  assert.equal(Number(exec('SELECT count(*) AS n FROM weapon_stock')[0].n), 13)
  assert.equal(
    Number(exec('SELECT count(*) AS n FROM weapon_stock WHERE quantity > 0')[0].n),
    8,
  )
})

test('a pattern the stockpile does not name is stocked at zero', () => {
  const { run, stockOf } = open()
  run(seedCatalog(), 'Load Clan McGreggor')

  // All 870 Lexingtons the clan owns are in the Sharpshooters' hands.
  assert.equal(
    stockOf('Lexington Pattern Rifle (.30-06 Lexington Smokeless)'),
    0,
  )
  assert.equal(stockOf('Warden Rifle (.45 Caliber)'), 615)
})

test('stock cannot be driven below zero', () => {
  const { run, stockOf } = open()
  run(seedCatalog(), 'Load Clan McGreggor')

  assert.throws(
    () =>
      run(
        [
          {
            sql: 'UPDATE weapon_stock SET quantity = quantity - ? WHERE weapon = ?',
            params: [616, 'Warden Rifle (.45 Caliber)'],
          },
        ],
        'Issue more Wardens than exist',
      ),
    /CHECK constraint failed/,
  )

  // Rolled back whole rather than clamped: an operation that would break an
  // invariant commits nothing at all.
  assert.equal(stockOf('Warden Rifle (.45 Caliber)'), 615)
})

test('the pile cannot hold a weapon the catalog does not have', () => {
  const { run } = open()
  run(seedCatalog(), 'Load Clan McGreggor')

  assert.throws(
    () =>
      run(
        [
          {
            sql: 'INSERT INTO weapon_stock (weapon, quantity) VALUES (?, ?)',
            params: ['Warden Rifle (.45)', 40],
          },
        ],
        'Stock a weapon that does not exist',
      ),
    /FOREIGN KEY constraint failed/,
  )
})

test('a movement over the two tables is one undo entry', () => {
  const { run, exec, stockOf } = open()
  run(seedCatalog(), 'Load Clan McGreggor')

  // Two rows touched, one transaction: the shape every movement takes.
  run(
    [
      {
        sql: 'UPDATE weapon_stock SET quantity = quantity + ? WHERE weapon = ?',
        params: [340, 'Barclay Hornets (7x57mm)'],
      },
      {
        sql: 'UPDATE weapon_stock SET quantity = quantity - ? WHERE weapon = ?',
        params: [340, 'Warden Rifle (.45 Caliber)'],
      },
    ],
    'Re-arm 1st Infantry Brigade',
  )
  assert.equal(stockOf('Barclay Hornets (7x57mm)'), 680)
  assert.equal(stockOf('Warden Rifle (.45 Caliber)'), 275)

  assert.equal(undo(exec), 'Re-arm 1st Infantry Brigade')
  assert.equal(stockOf('Barclay Hornets (7x57mm)'), 340)
  assert.equal(stockOf('Warden Rifle (.45 Caliber)'), 615)

  redo(exec)
  assert.equal(stockOf('Barclay Hornets (7x57mm)'), 680)
  assert.equal(stockOf('Warden Rifle (.45 Caliber)'), 275)
})

test("the seeded nation's ledger closes", () => {
  const { run, ledger } = open()
  run(seedNation(), 'Load Clan McGreggor')

  // The figures mvp-stockpile.md §7 quotes: what is issued plus what is spare
  // is what the clan owns, and nothing is in neither place or both.
  const smallArms = ledger('small_arm')
  assert.deepEqual(smallArms, { stock: 1100, issued: 27985, owned: 29085 })

  const guns = ledger('gun')
  assert.deepEqual(guns, { stock: 24, issued: 525, owned: 549 })
})

test('the four unarmed battalions hold nothing at all', () => {
  const { run, exec } = open()
  run(seedNation(), 'Load Clan McGreggor')

  const unarmed = exec(
    `SELECT u.designation FROM oob_units u
     LEFT JOIN oob_unit_weapons h ON h.unit_id = u.id
     WHERE h.unit_id IS NULL`,
  ).map((row) => String(row.designation))

  // No holding row rather than a holding of a weapon named "Unarmed": the
  // absence of a weapon is not a weapon.
  assert.deepEqual(unarmed, [
    'I Mounted Borders Battalion',
    'II Mounted Borders Battalion',
    'III Mounted Borders Battalion',
    'IV Mounted Borders Battalion',
  ])
})

test('a fully armed unit holds exactly its strength', () => {
  const { run, exec } = open()
  run(seedNation(), 'Load Clan McGreggor')

  // An omitted weapon_count means fully armed, which is what 54 of the 58
  // units want. Nothing in the roster is under-armed.
  const mismatched = exec(
    `SELECT u.designation FROM oob_units u
     JOIN oob_unit_weapons h ON h.unit_id = u.id
     WHERE h.quantity <> u.men + u.weapons`,
  )
  assert.deepEqual(mismatched, [])
})

test('raising an armed unit draws its weapons out of the pile', () => {
  const { run, stockOf, ledger } = open()
  run(seedNation(), 'Load Clan McGreggor')
  const before = ledger('small_arm')

  run(
    [
      ...insertUnit({
        id: 999,
        formationId: 1,
        unitType: 'Clan Levies',
        designation: 'V Levy Battalion',
        men: 600,
        weapons: 0,
        weapon: 'Warden Rifle (.45 Caliber)',
        weaponCount: 600,
        sortOrder: 99,
      }),
      debitStock('Warden Rifle (.45 Caliber)', 600),
    ],
    'Add V Levy Battalion',
  )

  assert.equal(stockOf('Warden Rifle (.45 Caliber)'), 15)
  // Weapons moved, none were created: raising a unit is not a way to conjure
  // rifles by typing.
  assert.equal(ledger('small_arm').owned, before.owned)
  assert.equal(ledger('small_arm').issued, before.issued + 600)
})

test('a unit cannot be armed out of a pile that has not got them', () => {
  const { run, ledger } = open()
  run(seedNation(), 'Load Clan McGreggor')
  const before = ledger('small_arm')

  assert.throws(
    () =>
      run(
        [
          ...insertUnit({
            id: 999,
            formationId: 1,
            unitType: 'Clan Levies',
            designation: 'V Levy Battalion',
            men: 1000,
            weapons: 0,
            weapon: 'Warden Rifle (.45 Caliber)',
            weaponCount: 1000,
            sortOrder: 99,
          }),
          debitStock('Warden Rifle (.45 Caliber)', 1000),
        ],
        'Add V Levy Battalion',
      ),
    /CHECK constraint failed/,
  )

  // Nothing at all: not the unit, not the holding, not the overdraw.
  assert.deepEqual(ledger('small_arm'), before)
})

test('striking a unit off puts its weapons back in the pile', () => {
  const { run, exec, stockOf, ledger } = open()
  run(seedNation(), 'Load Clan McGreggor')
  const before = ledger('small_arm')

  // I/I Levy Battalion, 1,000 men on 1,000 Wardens.
  const [row] = exec(
    `SELECT u.id AS id, h.weapon AS weapon, h.quantity AS quantity
     FROM oob_units u JOIN oob_unit_weapons h ON h.unit_id = u.id
     WHERE u.designation = 'I/I Levy Battalion'`,
  )

  run(
    [
      creditStock(String(row.weapon), Number(row.quantity)),
      { sql: 'DELETE FROM oob_units WHERE id = ?', params: [Number(row.id)] },
    ],
    'Delete I/I Levy Battalion',
  )

  // Disbanding a battalion is not the same as losing one: only a disposal or a
  // combat loss takes a weapon out of the nation's possession.
  assert.equal(stockOf('Warden Rifle (.45 Caliber)'), 1615)
  assert.equal(ledger('small_arm').owned, before.owned)
  assert.equal(ledger('small_arm').issued, before.issued - 1000)
})

test('re-arming moves weapons between hands and pile without creating any', () => {
  const { run, exec, holdingOf, stockOf, ledger } = open()
  run(seedNation(), 'Load Clan McGreggor')
  const before = ledger('small_arm')

  // I Clan Guard Elite Battalion: 660 men on Barclays, re-armed onto Wardens.
  // Only 615 are spare, so it comes away under-armed by 60 — a legal state,
  // and the normal one for a nation this short of rifles.
  const unitId = Number(
    exec(
      `SELECT id FROM oob_units WHERE designation = 'I Clan Guard Elite Battalion'`,
    )[0]?.id ?? 0,
  )
  assert.ok(unitId)

  run(
    rearmUnitStatements({
      unitId,
      from: { weapon: 'Barclay Hornets (7x57mm)', quantity: 660 },
      to: { weapon: 'Warden Rifle (.45 Caliber)', quantity: 600 },
      movesStock: true,
    }),
    'Re-arm I Clan Guard Elite Battalion',
  )

  assert.deepEqual(holdingOf(unitId), {
    weapon: 'Warden Rifle (.45 Caliber)',
    quantity: 600,
  })
  assert.equal(stockOf('Barclay Hornets (7x57mm)'), 340 + 660)
  assert.equal(stockOf('Warden Rifle (.45 Caliber)'), 615 - 600)
  assert.equal(ledger('small_arm').owned, before.owned)
})

test('returns are credited before draws, or the pile goes briefly negative', () => {
  const { run, exec, stockOf } = open()
  run(seedNation(), 'Load Clan McGreggor')

  // Re-arming a battalion with the pattern it already carries is a no-op on
  // paper, but only if its 660 Barclays go back before its 660 come out: the
  // pile holds 340, and SQLite checks the non-negative constraint per
  // statement rather than at COMMIT. Drawing first fails outright.
  const unitId = Number(
    exec(
      `SELECT id FROM oob_units WHERE designation = 'I Clan Guard Elite Battalion'`,
    )[0].id,
  )
  run(
    rearmUnitStatements({
      unitId,
      from: { weapon: 'Barclay Hornets (7x57mm)', quantity: 660 },
      to: { weapon: 'Barclay Hornets (7x57mm)', quantity: 660 },
      movesStock: true,
    }),
    'Re-arm onto the same pattern',
  )

  assert.equal(stockOf('Barclay Hornets (7x57mm)'), 340)
})

test('a saved design arms on paper and draws nothing', () => {
  const { run, ledger } = open()
  run(seedNation(), 'Load Clan McGreggor')
  const before = ledger('small_arm')

  run(
    rearmUnitStatements({
      unitId: 1,
      from: { weapon: 'Warden Rifle (.45 Caliber)', quantity: 1000 },
      to: { weapon: 'Barclay Hornets (7x57mm)', quantity: 1000 },
      movesStock: false,
    }),
    'Re-arm on a design',
  )

  // The holding changed and the pile did not, which is the whole difference
  // between an intention and a movement.
  assert.equal(ledger('small_arm').stock, before.stock)
})

test('a bulk re-arm is one transaction and one undo entry', () => {
  const { run, exec, stockOf, ledger } = open()
  run(seedNation(), 'Load Clan McGreggor')
  const before = ledger('small_arm')

  const highlanders = exec(
    `SELECT u.id AS id, u.men AS men FROM oob_units u
     WHERE u.designation LIKE '% Highlander Battalion'
     ORDER BY u.sort_order`,
  ).map((row) => ({ id: Number(row.id), men: Number(row.men) }))
  assert.equal(highlanders.length, 3)

  // The worked example, with the raid's 2,000 Lexingtons already acquired.
  run(
    [creditStock(LEXINGTON, 2000)],
    'Captured 2,000 Lexington Pattern Rifle',
  )

  const takes = [975, 945, 80]
  run(
    applyMovementStatements(
      highlanders.map((unit, index) => ({
        unitId: unit.id,
        from: { weapon: 'Barclay Hornets (7x57mm)', quantity: unit.men },
        to: { weapon: LEXINGTON, quantity: takes[index] },
      })),
      true,
    ),
    'Re-arm Mountain Force',
  )

  assert.equal(stockOf(LEXINGTON), 0)
  assert.equal(stockOf('Barclay Hornets (7x57mm)'), 340 + 2840)
  // The acquisition added 2,000; the re-arm added nothing.
  assert.equal(ledger('small_arm').owned, before.owned + 2000)

  // One entry for the whole thing, and the pile and every unit come back
  // together.
  assert.equal(undo(exec), 'Re-arm Mountain Force')
  assert.equal(stockOf(LEXINGTON), 2000)
  assert.equal(stockOf('Barclay Hornets (7x57mm)'), 340)
  assert.equal(
    Number(
      exec('SELECT quantity FROM oob_unit_weapons WHERE unit_id = ?', [
        highlanders[2].id,
      ])[0].quantity,
    ),
    920,
  )

  redo(exec)
  assert.equal(stockOf(LEXINGTON), 0)
})

test('a movement that would overdraw the pile commits nothing at all', () => {
  const { run, exec, stockOf } = open()
  run(seedNation(), 'Load Clan McGreggor')

  const borders = exec(
    `SELECT id FROM oob_units WHERE designation LIKE '% Mounted Borders Battalion'
     ORDER BY sort_order`,
  ).map((row) => Number(row.id))

  // 770 + 910 = 1,680 Wardens out of a pile holding 615.
  assert.throws(
    () =>
      run(
        applyMovementStatements(
          [
            {
              unitId: borders[0],
              from: { weapon: '', quantity: 0 },
              to: { weapon: 'Warden Rifle (.45 Caliber)', quantity: 770 },
            },
            {
              unitId: borders[1],
              from: { weapon: '', quantity: 0 },
              to: { weapon: 'Warden Rifle (.45 Caliber)', quantity: 910 },
            },
          ],
          true,
        ),
        'Arm the Mounted Borders',
      ),
    /CHECK constraint failed/,
  )

  assert.equal(stockOf('Warden Rifle (.45 Caliber)'), 615)
  assert.equal(
    Number(
      exec('SELECT count(*) AS n FROM oob_unit_weapons WHERE unit_id IN (?, ?)', [
        borders[0],
        borders[1],
      ])[0].n,
    ),
    0,
  )
})

test('acquiring a pattern the nation has never held creates and stocks it at once', () => {
  const { run, exec, stockOf } = open()
  run(seedNation(), 'Load Clan McGreggor')

  // A capture is often the first time a nation has seen a weapon at all, so
  // the catalog entry and the quantity land in one transaction.
  run(
    [
      ...catalogStatements(
        [
          {
            name: 'Rossenheim Carbine (.68 Caliber)',
            class: 'small_arm',
            origin: 'Rossenheim',
            description: '',
          },
        ],
        [],
      ),
      creditStock('Rossenheim Carbine (.68 Caliber)', 320),
    ],
    'Captured 320 Rossenheim Carbine (.68 Caliber)',
  )

  assert.equal(stockOf('Rossenheim Carbine (.68 Caliber)'), 320)
  assert.equal(Number(exec('SELECT count(*) AS n FROM weapons')[0].n), 14)

  // One entry, so undoing the capture takes the pattern with it rather than
  // leaving an orphan in the catalog.
  assert.equal(undo(exec), 'Captured 320 Rossenheim Carbine (.68 Caliber)')
  assert.equal(Number(exec('SELECT count(*) AS n FROM weapons')[0].n), 13)
  assert.equal(Number(exec('SELECT count(*) AS n FROM weapon_stock')[0].n), 13)
})

test('disposing of more than is spare is refused', () => {
  const { run, stockOf } = open()
  run(seedNation(), 'Load Clan McGreggor')

  // 615 Wardens are in store; the other 20,215 are in someone's hands and are
  // not the nation's to sell out of the pile.
  assert.throws(
    () =>
      run(
        [debitStock('Warden Rifle (.45 Caliber)', 700)],
        'Sold 700 Warden Rifle (.45 Caliber)',
      ),
    /CHECK constraint failed/,
  )
  assert.equal(stockOf('Warden Rifle (.45 Caliber)'), 615)
})

test('acquiring and disposing are the only movements that change what is owned', () => {
  const { run, ledger } = open()
  run(seedNation(), 'Load Clan McGreggor')
  const before = ledger('small_arm')

  run([creditStock('Warden Rifle (.45 Caliber)', 500)], 'Bought 500 Wardens')
  assert.equal(ledger('small_arm').owned, before.owned + 500)

  run([debitStock('Warden Rifle (.45 Caliber)', 200)], 'Sold 200 Wardens')
  assert.equal(ledger('small_arm').owned, before.owned + 300)
})
