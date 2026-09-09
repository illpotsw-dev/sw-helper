import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportOobYaml, formationKeys } from './export.ts'
import { buildTree, type Tree } from './tree.ts'
import { parseOob } from './yaml.ts'
import { mcgreggor } from './fixture.test-helper.ts'
import type { Formation, Unit } from './types.ts'

const { formations, units, unitTypes } = mcgreggor()
const tree = buildTree(formations, units, unitTypes)

/**
 * Everything a round trip has to preserve. Ids are deliberately absent: the
 * file keys formations by name and the database by number, so the numbers are
 * expected to change while the shape must not.
 */
type Shape = {
  echelon: string
  name: string
  units: string[]
  children: Shape[]
}

const shapeOf = (formations: Formation[], units: Unit[]): Shape[] => {
  const built = buildTree(formations, units, unitTypes)
  const shape = (tree: Tree): Shape[] =>
    tree.roots.map((node) => ({
      echelon: node.formation.echelon,
      name: node.formation.name,
      units: node.units.map(
        (u) =>
          `${u.designation}|${u.unitType}|${u.men}|${u.weapons}|${u.weapon}|${u.weaponCount}`,
      ),
      children: shape({ roots: node.children, unreachable: [] }),
    }))
  return shape(built)
}

const reimport = (text: string) => {
  const parsed = parseOob(text)
  assert.deepEqual(parsed.problems, [], 'the export re-imported with problems')
  return parsed
}

test('exported YAML re-imports to an identical tree', () => {
  const text = exportOobYaml({ tree, formations, units })
  const back = reimport(text)

  assert.equal(back.formations.length, 15)
  assert.equal(back.units.length, 58)
  assert.deepEqual(shapeOf(back.formations, back.units), shapeOf(formations, units))
})

test('exporting the re-import is byte-identical', () => {
  const text = exportOobYaml({ tree, formations, units })
  const back = reimport(text)
  const again = exportOobYaml({
    tree: buildTree(back.formations, back.units, unitTypes),
    formations: back.formations,
    units: back.units,
  })

  assert.equal(again, text)
})

test('keys formations by a readable slug of the name', () => {
  const keys = formationKeys(formations)
  const army = formations.find((f) => f.name === 'McGreggor Army')
  assert.ok(army)
  assert.equal(keys.get(army.id), 'mcgreggor-army')
})

test('gives two formations of the same name distinct keys', () => {
  const same = (id: number, parentId: number | null): Formation => ({
    id,
    designId: 1,
    parentId,
    echelon: parentId === null ? 'XX' : 'X',
    name: '1st Brigade',
    sortOrder: id,
  })
  const keys = formationKeys([same(1, null), same(2, 1), same(3, 1)])
  assert.deepEqual(
    [...keys.values()],
    ['1st-brigade', '1st-brigade-2', '1st-brigade-3'],
  )
})

test('quotes names YAML would otherwise read as something else', () => {
  const awkward: Formation[] = [
    { id: 1, designId: 1, parentId: null, echelon: 'XX', name: 'null', sortOrder: 0 },
    { id: 2, designId: 1, parentId: 1, echelon: 'X', name: '2', sortOrder: 1 },
    { id: 3, designId: 1, parentId: 1, echelon: 'X', name: 'Reserve: the rest', sortOrder: 2 },
    { id: 4, designId: 1, parentId: 1, echelon: 'X', name: '  padded  ', sortOrder: 3 },
    { id: 5, designId: 1, parentId: 1, echelon: 'X', name: '#4 Brigade', sortOrder: 4 },
  ]
  const awkwardUnits: Unit[] = [
    {
      id: 1,
      formationId: 1,
      unitType: 'Clan Levies',
      designation: 'true',
      men: 100,
      weapons: 0,
      weapon: 'Warden Rifle (.45 Caliber)',
      weaponCount: 100,
      sortOrder: 0,
    },
  ]

  const text = exportOobYaml({
    tree: buildTree(awkward, awkwardUnits, unitTypes),
    formations: awkward,
    units: awkwardUnits,
  })
  const back = reimport(text)

  assert.deepEqual(
    back.formations.map((f) => f.name),
    awkward.map((f) => f.name),
  )
  assert.equal(back.units[0]?.designation, 'true')
})

test('keeps a paper unit at zero rather than dropping it', () => {
  const formation: Formation = {
    id: 1,
    designId: 1,
    parentId: null,
    echelon: 'II',
    name: 'Cadre Battalion',
    sortOrder: 0,
  }
  const paper: Unit = {
    id: 1,
    formationId: 1,
    unitType: 'Clan Levies',
    designation: 'I/I Cadre',
    men: 0,
    weapons: 0,
    weapon: '',
    weaponCount: 0,
    sortOrder: 0,
  }
  const back = reimport(
    exportOobYaml({
      tree: buildTree([formation], [paper], unitTypes),
      formations: [formation],
      units: [paper],
    }),
  )

  assert.equal(back.units.length, 1)
  assert.deepEqual(
    { men: back.units[0]?.men, weapons: back.units[0]?.weapons },
    { men: 0, weapons: 0 },
  )
})

test('exports a formation trapped in a cycle rather than losing it', () => {
  // Two formations reporting to each other: unreachable from any root, so
  // buildTree parks them aside. They still belong to the design.
  const cyclic: Formation[] = [
    { id: 1, designId: 1, parentId: 2, echelon: 'XX', name: 'A Division', sortOrder: 0 },
    { id: 2, designId: 1, parentId: 1, echelon: 'X', name: 'B Brigade', sortOrder: 1 },
  ]
  const cyclicTree = buildTree(cyclic, [], unitTypes)
  assert.equal(cyclicTree.roots.length, 0)

  const text = exportOobYaml({ tree: cyclicTree, formations: cyclic, units: [] })
  const back = reimport(text)

  assert.deepEqual(
    back.formations.map((f) => f.name),
    ['A Division', 'B Brigade'],
  )
  assert.equal(buildTree(back.formations, back.units, unitTypes).unreachable.length, 2)
})

test('writes empty lists an empty design can be re-imported from', () => {
  const text = exportOobYaml({
    tree: { roots: [], unreachable: [] },
    formations: [],
    units: [],
  })
  const back = reimport(text)

  assert.deepEqual(back.formations, [])
  assert.deepEqual(back.units, [])
})

test('names the design in the header comment', () => {
  const text = exportOobYaml({
    tree,
    formations,
    units,
    design: { name: 'Order of Battle', note: 'Seeded from the repo files.' },
  })

  assert.match(text, /^# Order of Battle\n/)
  assert.match(text, /# Seeded from the repo files\./)
  // The comments must not disturb the round trip.
  assert.deepEqual(reimport(text).formations.length, 15)
})
