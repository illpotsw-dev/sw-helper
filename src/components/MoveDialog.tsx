import { Dialog, DialogActions } from './Dialog.tsx'
import { buttonStyles } from './styles.ts'
import { canReparent } from '../oob/validate.ts'
import { flatten } from '../oob/tree.ts'
import type { Tree } from '../oob/tree.ts'
import type { Echelon, Formation } from '../oob/types.ts'

export type MoveSubject =
  | { kind: 'formation'; formation: Formation }
  | { kind: 'units'; unitIds: readonly number[]; fromFormationId: number }

export type MoveTarget = { parentId: number | null; name: string }

type Candidate = {
  formation: Formation
  depth: number
  allowed: boolean
  reason?: string
}

export function MoveDialog({
  tree,
  formations,
  echelons,
  subject,
  onMove,
  onClose,
}: {
  tree: Tree
  formations: readonly Formation[]
  echelons: readonly Echelon[]
  subject: MoveSubject
  onMove: (target: MoveTarget) => void
  onClose: () => void
}) {
  const rows = flatten(tree).filter((row) => row.kind === 'formation')

  const candidates: Candidate[] = rows.map((row) => {
    const formation = row.node.formation
    if (subject.kind === 'units') {
      const isCurrent = formation.id === subject.fromFormationId
      return {
        formation,
        depth: row.depth,
        allowed: !isCurrent,
        reason: isCurrent ? 'Already here' : undefined,
      }
    }
    // Every rule that would make the tree invalid is applied here, so an
    // impossible destination is simply not clickable.
    const verdict = canReparent(subject.formation, formation, formations, echelons)
    return {
      formation,
      depth: row.depth,
      allowed: verdict.ok,
      reason: verdict.ok ? undefined : verdict.reason,
    }
  })

  const title =
    subject.kind === 'formation'
      ? `Move ${subject.formation.name}`
      : subject.unitIds.length === 1
        ? 'Move unit'
        : `Move ${subject.unitIds.length} units`

  return (
    <Dialog
      title={title}
      description={
        subject.kind === 'formation'
          ? 'Everything below it moves too. Destinations it cannot sit under are greyed out.'
          : 'Choose the formation these should report to.'
      }
      onClose={onClose}
    >
      <div className="max-h-[50vh] overflow-y-auto rounded border border-slate-200">
        {subject.kind === 'formation' && (
          <button
            type="button"
            className="flex w-full items-center gap-2 border-b border-slate-200 px-2 py-1.5 text-left text-sm hover:bg-slate-100"
            onClick={() => onMove({ parentId: null, name: 'the top of the tree' })}
          >
            <span className="font-medium">Top of the tree</span>
            <span className="text-slate-500">— independent formation</span>
          </button>
        )}

        {candidates.map(({ formation, depth, allowed, reason }) => (
          <button
            key={formation.id}
            type="button"
            disabled={!allowed}
            title={reason}
            className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm enabled:hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45"
            style={{ paddingLeft: `${0.5 + Math.min(depth, 5) * 0.85}rem` }}
            onClick={() =>
              onMove({ parentId: formation.id, name: formation.name })
            }
          >
            <span className="shrink-0 rounded border border-slate-300 bg-slate-50 px-1 py-0.5 font-mono text-[0.6rem] leading-none text-slate-600">
              {formation.echelon}
            </span>
            <span className="min-w-0 flex-1 truncate">{formation.name}</span>
            {reason && (
              <span className="shrink-0 text-xs text-slate-500">{reason}</span>
            )}
          </button>
        ))}
      </div>

      <DialogActions>
        <button type="button" className={buttonStyles.quiet} onClick={onClose}>
          Cancel
        </button>
      </DialogActions>
    </Dialog>
  )
}
