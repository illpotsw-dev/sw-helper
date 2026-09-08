/**
 * Serialising a design back to army-oob.yml. See mvp-oob-designer.md §8.
 *
 * Pure, like tree.ts and validate.ts, and the exact inverse of parseOob in
 * yaml.ts: what comes out of here has to go back in unchanged, so the two are
 * tested as a pair rather than separately.
 *
 * Written by hand rather than through the yaml package's stringify because the
 * output is something a player reads, diffs against the repo files, and pastes
 * into Discord threads — the blank lines between entries and the comment naming
 * each formation are the point, and a generic serialiser gives neither.
 */
import { allNodes } from './tree.ts'
import type { Tree } from './tree.ts'
import type { Design, Formation, Unit } from './types.ts'

/** Plain scalars YAML reads back as the string that was written. */
const SAFE_PLAIN = /^[A-Za-z0-9][^\n\r\t:#]*$/
/** Plain but read back as something other than a string, so quoted anyway. */
const NOT_A_STRING = /^(?:[-+]?\d+(?:\.\d+)?|true|false|null|yes|no|on|off|~)$/i

/**
 * A scalar as YAML, quoted only when it has to be. JSON's escaping is a subset
 * of YAML's double-quoted form, so it covers the cases the plain test rejects.
 */
function scalar(value: string): string {
  if (!SAFE_PLAIN.test(value)) return JSON.stringify(value)
  if (NOT_A_STRING.test(value)) return JSON.stringify(value)
  // A plain scalar cannot end in whitespace: the parser trims it.
  if (value !== value.trimEnd()) return JSON.stringify(value)
  return value
}

const integer = (value: number): string =>
  Number.isFinite(value) ? String(Math.trunc(value)) : '0'

/** Comments cannot carry a newline, and a name is free text. */
const comment = (text: string): string => text.replace(/\s+/g, ' ').trim()

function slug(name: string): string {
  const stripped = name
    .normalize('NFKD')
    // NFKD splits an accented letter into letter + mark; drop the marks.
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return stripped || 'formation'
}

/**
 * The file keys formations by a readable string; the database keys them by
 * number. Derived from the name so the export reads like a hand-written
 * roster, then made unique — two brigades are often called the same thing
 * under different divisions.
 */
export function formationKeys(
  formations: readonly Formation[],
): Map<number, string> {
  const keys = new Map<number, string>()
  const taken = new Set<string>()
  for (const formation of formations) {
    const base = slug(formation.name)
    let key = base
    for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`
    taken.add(key)
    keys.set(formation.id, key)
  }
  return keys
}

const inOrder = <T extends { sortOrder: number; id: number }>(items: T[]): T[] =>
  items.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)

/**
 * Roster order: depth-first through the tree, so a parent is written above the
 * children reporting to it. Formations the tree could not reach — only a cycle
 * does that — are appended rather than dropped, keeping their parent links, so
 * a broken design exports as the broken design it is instead of quietly
 * losing formations.
 */
function orderedFormations(
  tree: Tree,
  formations: readonly Formation[],
): Formation[] {
  const ordered = allNodes(tree).map((node) => node.formation)
  const seen = new Set(ordered.map((f) => f.id))
  return [...ordered, ...inOrder(formations.filter((f) => !seen.has(f.id)))]
}

export type ExportInput = {
  tree: Tree
  formations: readonly Formation[]
  units: readonly Unit[]
  /** Named in the header comment. Omitted for a bare tree, as in tests. */
  design?: Pick<Design, 'name' | 'note'>
}

/** A design as army-oob.yml text, ready for the clipboard. */
export function exportOobYaml({
  tree,
  formations,
  units,
  design,
}: ExportInput): string {
  const keys = formationKeys(formations)
  const ordered = orderedFormations(tree, formations)

  const attached = new Map<number, Unit[]>()
  for (const unit of units) {
    const list = attached.get(unit.formationId)
    if (list) list.push(unit)
    else attached.set(unit.formationId, [unit])
  }

  const lines: string[] = []
  if (design) {
    lines.push(`# ${comment(design.name)}`, '#')
    for (const line of design.note.split(/\r?\n/)) {
      if (comment(line)) lines.push(`# ${comment(line)}`)
    }
    lines.push('#')
  }
  lines.push(
    '# Exported by SW Helper in mvp/nations/template/army-oob.yml format.',
    '# unit_type values must match this nation\'s land-units.yml exactly.',
    '',
  )

  lines.push(ordered.length ? 'formations:' : 'formations: []')
  for (const formation of ordered) {
    const parent = formation.parentId
    const parentKey = parent === null ? null : (keys.get(parent) ?? null)
    lines.push(
      `  - id: ${scalar(keys.get(formation.id) ?? '')}`,
      `    parent_id: ${parentKey === null ? 'null' : scalar(parentKey)}`,
      `    echelon: ${scalar(formation.echelon)}`,
      `    name: ${scalar(formation.name)}`,
      '',
    )
  }

  // Units follow the formation order above rather than their own ids, so the
  // file reads top-down like the tree on screen.
  const written = ordered.flatMap((formation) => {
    const own = inOrder(attached.get(formation.id) ?? [])
    return own.map((unit) => ({ formation, unit }))
  })

  lines.push(written.length ? 'units:' : 'units: []')
  let currentFormation: number | null = null
  for (const { formation, unit } of written) {
    if (formation.id !== currentFormation) {
      currentFormation = formation.id
      lines.push(`  # --- ${comment(formation.name)} ---`)
    }
    lines.push(
      `  - formation_id: ${scalar(keys.get(formation.id) ?? '')}`,
      `    name: ${scalar(unit.designation)}`,
      `    unit_type: ${scalar(unit.unitType)}`,
      `    men: ${integer(unit.men)}`,
      `    weapons: ${integer(unit.weapons)}`,
      // Always quoted: equipment is a free-text calibre or model number, the
      // field most likely to start with a digit or carry punctuation.
      `    equipment: ${JSON.stringify(unit.equipment)}`,
      '',
    )
  }

  return `${lines.join('\n').trimEnd()}\n`
}
