import { useState } from 'react'
import { Dialog, DialogActions, Field } from './Dialog.tsx'
import { buttonStyles, inputStyles } from './styles.ts'
import type { Echelon, EchelonSymbol, Formation } from '../oob/types.ts'

/**
 * Only tiers strictly below the parent's are offered, so an invalid tree is
 * unreachable rather than merely reported. A formation with no parent may sit
 * at any tier.
 */
function allowedTiers(
  echelons: readonly Echelon[],
  parent: Formation | null,
): Echelon[] {
  if (!parent) return [...echelons]
  const parentLevel = echelons.find((e) => e.symbol === parent.echelon)?.level
  if (parentLevel === undefined) return [...echelons]
  return echelons.filter((e) => e.level < parentLevel)
}

export function FormationForm({
  echelons,
  parent,
  existing,
  onSubmit,
  onClose,
}: {
  echelons: readonly Echelon[]
  /** The formation this one will report to, for an add. */
  parent: Formation | null
  /** Present when editing rather than adding. */
  existing?: Formation
  onSubmit: (values: { name: string; echelon: EchelonSymbol }) => void
  onClose: () => void
}) {
  const tiers = allowedTiers(echelons, existing ? null : parent)
  const [name, setName] = useState(existing?.name ?? '')
  const [echelon, setEchelon] = useState<EchelonSymbol>(
    existing?.echelon ?? tiers[tiers.length - 1]?.symbol ?? 'XX',
  )

  const trimmed = name.trim()

  return (
    <Dialog
      title={existing ? `Edit ${existing.name}` : 'Add formation'}
      description={
        existing
          ? undefined
          : parent
            ? `Reports to ${parent.name}.`
            : 'Independent, at the top of the tree.'
      }
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (trimmed) onSubmit({ name: trimmed, echelon })
        }}
      >
        <Field label="Name">
          <input
            className={inputStyles}
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            placeholder="5th Highland Division"
          />
        </Field>

        <Field
          label="Echelon"
          hint={
            parent && !existing
              ? `Tiers at or above ${parent.echelon} are not listed — a formation sits below its parent.`
              : undefined
          }
        >
          <select
            className={inputStyles}
            value={echelon}
            onChange={(event) =>
              setEchelon(event.target.value as EchelonSymbol)
            }
          >
            {tiers.map((tier) => (
              <option key={tier.symbol} value={tier.symbol}>
                {tier.symbol} · {tier.name}
              </option>
            ))}
          </select>
        </Field>

        <DialogActions>
          <button type="button" className={buttonStyles.quiet} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={buttonStyles.primary}
            disabled={!trimmed}
          >
            {existing ? 'Save' : 'Add'}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
