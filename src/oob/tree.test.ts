import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allNodes, buildTree, flatten } from './tree.ts'
import type { Formation, Unit, UnitType } from './types.ts'
import { mcgreggor, round } from './fixture.test-helper.ts'

const { formations, units, unitTypes } = mcgreggor()
const tree = buildTree(formations, units, unitTypes)

const byName = (name: string) => {
  const node = allNodes(tree).find((n) => n.formation.name === name)
  assert.ok(node, `no formation named ${name}`)
  return node
}

test('parses the roster', () => {
  assert.equal(formations.length, 15)
  assert.equal(units.length, 58)
  assert.equal(unitTypes.length, 11)
})

test('field army and garrison are separate roots', () => {
  assert.deepEqual(
    tree.roots.map((r) => r.formation.name),
    ['McGreggor Army', 'Portree Garrison'],
  )
  assert.deepEqual(tree.unreachable, [])
})

test('rolls strength up to the army', () => {
  const army = byName('McGreggor Army')
  assert.equal(army.total.men, 28080)
  assert.equal(army.total.weapons, 506)
  assert.equal(army.total.unitCount, 54)
})

test('rolls strength up to the garrison', () => {
  const garrison = byName('Portree Garrison')
  assert.equal(garrison.total.men, 3400)
  assert.equal(garrison.total.weapons, 19)
})

test('divisions roll up their brigades', () => {
  assert.equal(byName('I. Infantry Division — The Stone Line').total.men, 6755)
  assert.equal(byName('II. Infantry Division — Rising Mist').total.men, 6920)
  assert.equal(byName("Cavalry Division — Woden's Avengers").total.men, 3495)
  assert.equal(byName('Mountain Force — The Blood Tithe').total.men, 3710)
  assert.equal(byName('Flannery Division').total.men, 5540)
})

test('separates a formation own strength from its subtree', () => {
  // The Army Reserve hangs directly off the Army: 3 Clan Guard battalions
  // and 6 medium batteries, with every other unit under a division.
  const army = byName('McGreggor Army')
  assert.equal(army.own.men, 1660)
  assert.equal(army.own.weapons, 120)
  assert.equal(army.own.unitCount, 9)
  assert.ok(army.total.men > army.own.men)
})

test('a total equals own plus every child total', () => {
  for (const node of allNodes(tree)) {
    const expected = node.children.reduce(
      (sum, child) => sum + child.total.men,
      node.own.men,
    )
    assert.equal(node.total.men, expected, node.formation.name)
  }
})

test('rolls up upkeep from the catalog', () => {
  const army = byName('McGreggor Army')
  // 45 levy/highlander/cavalry/guard battalions plus 9 batteries.
  assert.equal(round(army.total.upkeepPerTurn), 68.5)
  assert.ok(byName('Portree Garrison').total.upkeepPerTurn > 0)
})

test('flatten emits units under their own formation', () => {
  const rows = flatten(tree)
  assert.equal(rows.length, formations.length + units.length)

  const armyIndex = rows.findIndex(
    (r) => r.kind === 'formation' && r.node.formation.name === 'McGreggor Army',
  )
  assert.equal(rows[armyIndex].depth, 0)

  const firstBrigade = rows.findIndex(
    (r) => r.kind === 'formation' && r.node.formation.name === '1st Infantry Brigade',
  )
  // Army (0) → division (1) → brigade (2), and its units one deeper still.
  assert.equal(rows[firstBrigade].depth, 2)
  assert.equal(rows[firstBrigade + 1].kind, 'unit')
  assert.equal(rows[firstBrigade + 1].depth, 3)
})

const formation = (id: number, parentId: number | null): Formation => ({
  id,
  designId: 1,
  parentId,
  echelon: 'XX',
  name: `F${id}`,
  sortOrder: id,
})

test('survives a cycle instead of recursing forever', () => {
  // Two formations pointing at each other, reachable from neither root.
  const cyclic = buildTree([formation(1, 2), formation(2, 1)], [], [])
  assert.deepEqual(cyclic.roots, [])
  assert.deepEqual(
    cyclic.unreachable.map((f) => f.id),
    [1, 2],
  )
})

test('shows a formation whose parent is missing rather than hiding it', () => {
  const orphaned = buildTree([formation(1, 99)], [], [])
  assert.equal(orphaned.roots.length, 1)
  assert.equal(orphaned.roots[0].formation.id, 1)
})

test('an unresolved unit type contributes no upkeep', () => {
  const unit: Unit = {
    id: 1,
    formationId: 1,
    unitType: 'Not In Catalog',
    designation: 'I Bn',
    men: 500,
    weapons: 0,
    equipment: '',
    sortOrder: 0,
  }
  const type: UnitType = {
    name: 'Clan Levies',
    category: 'infantry',
    description: '',
    recruitCost: 20,
    upkeepPerTurn: 0.5,
    buildTimeTurns: 1,
    men: 1000,
    weapons: 0,
  }
  const built = buildTree([formation(1, null)], [unit], [type])
  assert.equal(built.roots[0].total.men, 500)
  assert.equal(built.roots[0].total.upkeepPerTurn, 0)
})
