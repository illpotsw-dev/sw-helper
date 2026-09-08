import { Dialog, DialogActions } from './Dialog.tsx'
import { buttonStyles } from './styles.ts'
import { canPromote, type DeleteMode } from '../db/statements.ts'
import type { TreeNode } from '../oob/tree.ts'

const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? '' : 's'}`

export function DeleteFormationPrompt({
  node,
  onConfirm,
  onClose,
}: {
  node: TreeNode
  onConfirm: (mode: DeleteMode) => void
  onClose: () => void
}) {
  const { formation, children, units, total } = node
  const isEmpty = children.length === 0 && units.length === 0
  const promotable = canPromote(formation.parentId, units.length)

  if (isEmpty) {
    return (
      <Dialog title={`Delete ${formation.name}?`} onClose={onClose}>
        <p className="text-sm text-slate-600">
          It holds nothing, so nothing else is affected.
        </p>
        <DialogActions>
          <button type="button" className={buttonStyles.quiet} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={buttonStyles.danger}
            onClick={() => onConfirm('subtree')}
          >
            Delete
          </button>
        </DialogActions>
      </Dialog>
    )
  }

  const contents = [
    children.length ? plural(children.length, 'formation') : null,
    units.length ? plural(units.length, 'unit') : null,
  ]
    .filter(Boolean)
    .join(' and ')

  return (
    <Dialog
      title={`Delete ${formation.name}?`}
      description={`It holds ${contents} directly, and ${total.unitCount} units in total.`}
      onClose={onClose}
    >
      <div className="space-y-3 text-sm">
        <div className="rounded border border-slate-200 p-3">
          <p className="font-medium">Keep what it holds</p>
          <p className="mt-0.5 text-slate-600">
            {promotable
              ? 'Everything directly under it moves up to report to ' +
                (formation.parentId === null
                  ? 'the top of the tree'
                  : 'its parent') +
                ' instead.'
              : 'Not possible here: this formation is at the top of the tree, so its units have nowhere to report to.'}
          </p>
          <button
            type="button"
            className={`${buttonStyles.quiet} mt-2`}
            disabled={!promotable}
            onClick={() => onConfirm('promote')}
          >
            Move up and delete
          </button>
        </div>

        <div className="rounded border border-slate-200 p-3">
          <p className="font-medium">Delete everything below it</p>
          <p className="mt-0.5 text-slate-600">
            Removes the formation and all {total.unitCount} units beneath it.
            Undo reverses this in one step.
          </p>
          <button
            type="button"
            className={`${buttonStyles.danger} mt-2`}
            onClick={() => onConfirm('subtree')}
          >
            Delete all
          </button>
        </div>
      </div>

      <DialogActions>
        <button type="button" className={buttonStyles.quiet} onClick={onClose}>
          Cancel
        </button>
      </DialogActions>
    </Dialog>
  )
}
