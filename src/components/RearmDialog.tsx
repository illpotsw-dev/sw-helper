import { useMemo, useState } from 'react'
import { Dialog, DialogActions } from './Dialog.tsx'
import { UnitPicker } from './UnitPicker.tsx'
import { buttonStyles } from './styles.ts'
import { planMovement, stockMap, strengthOf } from '../oob/arm.ts'
import type { Movement, Plan, Shortfall, UnitMovement } from '../oob/arm.ts'
import type { Tree } from '../oob/tree.ts'
import { classForCategory } from '../oob/types.ts'
import type { StockEntry, Unit, UnitType, Weapon } from '../oob/types.ts'

const count = (value: number) => value.toLocaleString('en-US')

const WORDS: Record<Movement, { title: string; blurb: string; verb: string }> = {
  rearm: {
    title: 'Re-arm',
    blurb:
      'The old weapons go back to the stockpile and the new ones come out of it, in one step.',
    verb: 'Re-arm',
  },
  issue: {
    title: 'Issue weapons',
    blurb: 'Arming a unit that is carrying nothing. One draw on the stockpile.',
    verb: 'Issue to',
  },
  withdraw: {
    title: 'Withdraw weapons',
    blurb: 'Taking weapons back into the stockpile and leaving the unit unarmed.',
    verb: 'Withdraw from',
  },
}

function StepHeader({
  step,
  labels,
  onGo,
}: {
  step: number
  labels: readonly string[]
  onGo: (to: number) => void
}) {
  return (
    <ol className="mb-3 flex gap-1 text-xs">
      {labels.map((label, index) => {
        const at = index + 1
        return (
          <li key={label} className="flex-1">
            <button
              type="button"
              disabled={at > step}
              onClick={() => onGo(at)}
              className={`w-full rounded px-2 py-1 text-left transition disabled:cursor-not-allowed ${
                at === step
                  ? 'bg-slate-900 font-medium text-white'
                  : at < step
                    ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    : 'bg-slate-50 text-slate-400'
              }`}
            >
              {at}. {label}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function PreviewRow({ row }: { row: UnitMovement }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-slate-100 px-2 py-1.5 text-sm last:border-0">
      <span className="min-w-0 flex-1 truncate">{row.designation}</span>
      <span className="shrink-0 text-xs text-slate-500">
        {row.from.weapon === '' ? (
          <em>unarmed</em>
        ) : (
          `${row.from.weapon} ${count(row.from.quantity)}`
        )}
      </span>
      <span className="shrink-0 text-slate-400">→</span>
      <span className="shrink-0 text-xs font-medium tabular-nums">
        {row.to.weapon === '' ? (
          <em className="font-normal text-slate-500">unarmed</em>
        ) : (
          `${count(row.to.quantity)} of ${count(row.strength)}`
        )}
      </span>
      {row.gap > 0 && row.to.weapon !== '' && (
        <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">
          −{count(row.gap)}
        </span>
      )}
    </div>
  )
}

export function RearmDialog({
  movement,
  tree,
  unitTypes,
  weapons,
  stock,
  movesStock,
  initialSelection,
  onApply,
  onClose,
}: {
  movement: Movement
  tree: Tree
  unitTypes: readonly UnitType[]
  weapons: readonly Weapon[]
  stock: readonly StockEntry[]
  /** False on a saved design, where a holding is an intention, not property. */
  movesStock: boolean
  /** Pre-checked when the dialog is opened from a single unit's row. */
  initialSelection?: ReadonlySet<number>
  onApply: (plan: Plan, label: string) => void
  onClose: () => void
}) {
  const words = WORDS[movement]
  const withdrawing = movement === 'withdraw'

  const [step, setStep] = useState(1)
  const [selected, setSelected] = useState<ReadonlySet<number>>(
    initialSelection ?? new Set(),
  )
  const [weapon, setWeapon] = useState('')
  // Nothing commits until the player has answered the shortfall, so this
  // starts at the answer that commits nothing.
  const [onShortfall, setOnShortfall] = useState<Shortfall>('refuse')

  const typeByName = useMemo(
    () => new Map(unitTypes.map((t) => [t.name, t])),
    [unitTypes],
  )
  const inStock = useMemo(() => stockMap(stock), [stock])

  const target = weapons.find((w) => w.name === weapon)

  const allUnits = useMemo(() => {
    const units: Unit[] = []
    const walk = (nodes: typeof tree.roots): void => {
      for (const node of nodes) {
        units.push(...node.units)
        walk(node.children)
      }
    }
    walk(tree.roots)
    return units
  }, [tree])

  /**
   * What the selection could draw of a pattern: the pile, plus what it hands
   * back of the same pattern, since everything returns before anything goes
   * out. Without the second half, re-arming a battalion with the pattern it
   * already carries would read as a shortfall.
   */
  const availableOf = (name: string): number => {
    let returned = 0
    for (const unit of allUnits) {
      if (selected.has(unit.id) && unit.weapon === name) returned += unit.weaponCount
    }
    return (inStock.get(name) ?? 0) + returned
  }

  // A unit whose measure cannot take the chosen pattern is not an error, it is
  // simply not part of this movement — so the row is unpickable rather than
  // picked and then reported.
  const ineligible = (unit: Unit): string | null => {
    if (!target) return null
    const type = typeByName.get(unit.unitType)
    if (!type) return null
    return classForCategory(type.category) === target.class
      ? null
      : target.class === 'gun'
        ? 'counted in men'
        : 'counted in guns'
  }

  const plan = useMemo(
    () =>
      planMovement({
        tree,
        unitTypes,
        weapons,
        stock,
        selectedUnitIds: selected,
        weapon: withdrawing ? '' : weapon,
        onShortfall,
      }),
    [tree, unitTypes, weapons, stock, selected, weapon, withdrawing, onShortfall],
  )

  const labels = withdrawing ? ['Who', 'Preview'] : ['Who', 'What', 'Preview']
  const lastStep = labels.length
  const chosen = allUnits.filter((unit) => selected.has(unit.id))

  // Named for what moved, not for what was ticked: a selection of six that
  // the pile could only arm one of is "Re-arm I Mounted Borders Battalion",
  // since that is what undoing it would put back.
  const label =
    plan.rows.length === 1
      ? `${words.verb} ${plan.rows[0].designation}`
      : `${words.verb} ${count(plan.rows.length)} units`

  // Only patterns the selection could actually carry, so a levy battalion is
  // never offered an 18-pounder.
  const offered = useMemo(() => {
    const wanted = new Set(
      chosen
        .map((unit) => typeByName.get(unit.unitType))
        .filter((type) => type !== undefined)
        .map((type) => classForCategory(type.category)),
    )
    return weapons.filter((w) => wanted.size === 0 || wanted.has(w.class))
  }, [chosen, typeByName, weapons])

  return (
    <Dialog title={words.title} description={words.blurb} onClose={onClose} wide>
      <StepHeader step={step} labels={labels} onGo={setStep} />

      {step === 1 && (
        <>
          <UnitPicker
            tree={tree}
            selected={selected}
            onChange={setSelected}
            ineligible={weapon === '' ? undefined : ineligible}
            detail={(unit) =>
              unit.weapon === ''
                ? 'unarmed'
                : `${count(unit.weaponCount)} of ${count(strengthOf(unit))}`
            }
          />
          <p className="mt-2 text-sm text-slate-600 tabular-nums">
            {count(chosen.length)} units selected
          </p>
          <DialogActions>
            <button type="button" className={buttonStyles.quiet} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={buttonStyles.primary}
              disabled={chosen.length === 0}
              onClick={() => setStep(2)}
            >
              Next
            </button>
          </DialogActions>
        </>
      )}

      {step === 2 && !withdrawing && (
        <>
          <div className="max-h-[45vh] overflow-y-auto rounded border border-slate-200">
            {offered.map((w) => {
              const spare = movesStock ? availableOf(w.name) : Infinity
              const none = movesStock && spare <= 0
              return (
                <label
                  key={w.name}
                  // A pattern with none in store stays visible: the player can
                  // see the arsenal has none rather than wonder where it went.
                  className={`flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-slate-50 ${none ? 'opacity-40' : ''}`}
                >
                  <input
                    type="radio"
                    name="weapon"
                    className="shrink-0"
                    checked={weapon === w.name}
                    disabled={none}
                    onChange={() => setWeapon(w.name)}
                  />
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  {w.origin && (
                    <span className="shrink-0 text-xs text-slate-400">
                      {w.origin}
                    </span>
                  )}
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">
                    {movesStock ? `${count(inStock.get(w.name) ?? 0)} in store` : ''}
                  </span>
                </label>
              )
            })}
          </div>

          <DialogActions>
            <button
              type="button"
              className={buttonStyles.quiet}
              onClick={() => setStep(1)}
            >
              Back
            </button>
            <button
              type="button"
              className={buttonStyles.primary}
              disabled={weapon === ''}
              onClick={() => setStep(3)}
            >
              Next
            </button>
          </DialogActions>
        </>
      )}

      {step === lastStep && (step === 3 || withdrawing) && (
        <>
          {plan.short > 0 && (
            <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium tabular-nums">
                {count(plan.needed)} needed · {count(plan.available)} available ·{' '}
                {count(plan.short)} short
              </p>
              <p className="mt-1 text-amber-800">
                Re-arming out of a pile that cannot cover it is the normal case,
                not a mistake. Choose how to resolve it — nothing commits until
                you do.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`${buttonStyles.quiet} ${onShortfall === 'as-far-as-it-goes' ? 'bg-white ring-2 ring-amber-500' : ''}`}
                  onClick={() => setOnShortfall('as-far-as-it-goes')}
                >
                  Arm as far as it goes
                </button>
                <button
                  type="button"
                  className={buttonStyles.quiet}
                  onClick={() => {
                    setOnShortfall('refuse')
                    setStep(1)
                  }}
                >
                  Narrow the selection
                </button>
              </div>
            </div>
          )}

          {plan.notes.map((note) => (
            <p key={note} className="mb-2 text-sm text-slate-500">
              {note}
            </p>
          ))}

          <div className="max-h-[40vh] overflow-y-auto rounded border border-slate-200">
            {plan.rows.length === 0 ? (
              <p className="px-2 py-3 text-sm text-slate-500">
                {plan.blocked
                  ? 'Nothing will be moved until the shortfall is resolved.'
                  : 'Nothing to move: the selection already carries this.'}
              </p>
            ) : (
              plan.rows.map((row) => <PreviewRow key={row.unitId} row={row} />)
            )}
          </div>

          {plan.stockAfter.size > 0 && (
            <dl className="mt-3 space-y-0.5 text-sm">
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Stockpile afterwards
              </dt>
              {[...plan.stockAfter].map(([name, quantity]) => (
                <dd key={name} className="flex justify-between tabular-nums">
                  <span className="min-w-0 truncate pr-2 text-slate-600">
                    {name}
                  </span>
                  <span>
                    <span className="text-slate-400">
                      {count(inStock.get(name) ?? 0)} →{' '}
                    </span>
                    {count(quantity)}
                  </span>
                </dd>
              ))}
            </dl>
          )}

          <DialogActions>
            <button
              type="button"
              className={buttonStyles.quiet}
              onClick={() => setStep(withdrawing ? 1 : 2)}
            >
              Back
            </button>
            <button
              type="button"
              className={buttonStyles.primary}
              disabled={plan.blocked || plan.rows.length === 0}
              onClick={() => onApply(plan, label)}
            >
              {words.verb.split(' ')[0]}
            </button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
