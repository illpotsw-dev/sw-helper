import type { Formation, Unit, UnitType } from './types.ts'

export type Rollup = {
  men: number
  weapons: number
  upkeepPerTurn: number
  unitCount: number
}

export type TreeNode = {
  formation: Formation
  /** Units attached directly to this formation, in roster order. */
  units: Unit[]
  children: TreeNode[]
  /** This formation's own attached units only. */
  own: Rollup
  /** Own plus every descendant. */
  total: Rollup
}

export type Tree = {
  roots: TreeNode[]
  /**
   * Formations unreachable from any root, which only happens when parent
   * links form a cycle. Kept rather than dropped so a broken design stays
   * visible and fixable instead of silently losing formations.
   */
  unreachable: Formation[]
}

const emptyRollup = (): Rollup => ({
  men: 0,
  weapons: 0,
  upkeepPerTurn: 0,
  unitCount: 0,
})

function add(into: Rollup, from: Rollup): void {
  into.men += from.men
  into.weapons += from.weapons
  into.upkeepPerTurn += from.upkeepPerTurn
  into.unitCount += from.unitCount
}

function inOrder<T extends { sortOrder: number; id: number }>(
  items: T[] | undefined,
): T[] {
  return (items ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
}

export function buildTree(
  formations: readonly Formation[],
  units: readonly Unit[],
  unitTypes: readonly UnitType[],
): Tree {
  const upkeepOf = new Map(unitTypes.map((t) => [t.name, t.upkeepPerTurn]))
  const known = new Set(formations.map((f) => f.id))

  const childrenOf = new Map<number, Formation[]>()
  const rootFormations: Formation[] = []
  for (const formation of formations) {
    // A formation whose parent link dangles is shown at top level rather
    // than hidden; validate() reports the broken link separately.
    if (formation.parentId === null || !known.has(formation.parentId)) {
      rootFormations.push(formation)
      continue
    }
    const siblings = childrenOf.get(formation.parentId)
    if (siblings) siblings.push(formation)
    else childrenOf.set(formation.parentId, [formation])
  }

  const unitsOf = new Map<number, Unit[]>()
  for (const unit of units) {
    const attached = unitsOf.get(unit.formationId)
    if (attached) attached.push(unit)
    else unitsOf.set(unit.formationId, [unit])
  }

  const visited = new Set<number>()

  function build(formation: Formation): TreeNode {
    visited.add(formation.id)

    const attached = inOrder(unitsOf.get(formation.id))
    const own = emptyRollup()
    for (const unit of attached) {
      own.men += unit.men
      own.weapons += unit.weapons
      // An unresolved unit type contributes no upkeep. validate() reports
      // it; rolling up a guessed cost would be worse than rolling up none.
      own.upkeepPerTurn += upkeepOf.get(unit.unitType) ?? 0
      own.unitCount += 1
    }

    const children = inOrder(childrenOf.get(formation.id))
      // Without this guard a cycle recurses forever. Anything skipped here
      // surfaces in `unreachable`.
      .filter((child) => !visited.has(child.id))
      .map(build)

    const total = { ...own }
    for (const child of children) add(total, child.total)

    return { formation, units: attached, children, own, total }
  }

  const roots = inOrder(rootFormations).map(build)

  return {
    roots,
    unreachable: formations.filter((f) => !visited.has(f.id)),
  }
}

export type FlatRow =
  | { kind: 'formation'; depth: number; node: TreeNode }
  | { kind: 'unit'; depth: number; unit: Unit; formation: Formation }

/**
 * Depth-annotated rows for rendering: each formation, then its own units,
 * then its child formations.
 */
export function flatten(tree: Tree): FlatRow[] {
  const rows: FlatRow[] = []

  function walk(node: TreeNode, depth: number): void {
    rows.push({ kind: 'formation', depth, node })
    for (const unit of node.units) {
      rows.push({ kind: 'unit', depth: depth + 1, unit, formation: node.formation })
    }
    for (const child of node.children) walk(child, depth + 1)
  }

  for (const root of tree.roots) walk(root, 0)
  return rows
}

/** Every formation in the tree, roots first, parents before children. */
export function allNodes(tree: Tree): TreeNode[] {
  const nodes: TreeNode[] = []
  const walk = (node: TreeNode): void => {
    nodes.push(node)
    node.children.forEach(walk)
  }
  tree.roots.forEach(walk)
  return nodes
}
