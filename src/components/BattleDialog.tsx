import { useMemo, useState } from 'react'
import { Dialog, DialogActions, Field } from './Dialog.tsx'
import { UnitPicker } from './UnitPicker.tsx'
import { buttonStyles, inputStyles } from './styles.ts'
import { flatten, unitIdsUnder } from '../oob/tree.ts'
import type { Tree } from '../oob/tree.ts'
import {
  allocate,
  JITTER_PRESETS,
  measureOfType,
  subtotal,
  WEIGHT_PRESETS,
  type Allocation,
  type Direction,
  type Measure,
  type RowSteering,
  type Steering,
} from '../oob/losses.ts'
import type { Unit, UnitType } from '../oob/types.ts'

export type StrengthChange = { unitId: number; men: number; weapons: number }

const count = (value: number) => value.toLocaleString('en-US')

/** A fresh seed. Only Reroll calls this — see the note on `seed` below. */
const newSeed = () => Math.floor(Math.random() * 0x7fffffff)

const digits = (value: string) => value.replace(/[^0-9]/g, '')

/**
 * Weapons lost with the men. A unit's holding is clamped to its new strength
 * and the difference is destroyed rather than returned to the stockpile — see
 * mvp-stockpile.md §2.3. A unit already under-armed loses none, since its
 * holding is below the new strength already.
 */
const destroyed = (unit: Unit, after: number | undefined): number =>
  after === undefined ? 0 : Math.max(0, unit.weaponCount - after)

const WORDS = {
  losses: {
    verb: 'lost',
    action: 'Losses',
    title: 'Battle losses',
    gone: 'destroyed',
    blurb: 'The narrative decides how many were lost; this decides where they fell.',
  },
  reinforcements: {
    verb: 'received',
    action: 'Reinforcements',
    title: 'Reinforcements',
    gone: 'at establishment',
    blurb: 'No unit is filled past its establishment, and one already at strength is skipped.',
  },
} as const

// ---------------------------------------------------------------------------

function StepHeader({ step, onGo }: { step: number; onGo: (to: number) => void }) {
  const labels = ['Who fought', 'The total', 'Preview']
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

function WeightPicker({
  value,
  onChange,
}: {
  value: number | undefined
  onChange: (multiplier: number | undefined) => void
}) {
  return (
    <select
      aria-label="Weight"
      className="rounded border border-slate-300 px-1 py-0.5 text-xs"
      value={value ?? 1}
      onChange={(event) => {
        const next = Number(event.target.value)
        onChange(next === 1 ? undefined : next)
      }}
    >
      {WEIGHT_PRESETS.map((preset) => (
        <option key={preset.label} value={preset.value}>
          {preset.label} ×{preset.value}
        </option>
      ))}
    </select>
  )
}

function LockBox({
  measure,
  showMeasure,
  value,
  onChange,
}: {
  measure: Measure
  showMeasure: boolean
  value: number | undefined
  onChange: (locked: number | undefined) => void
}) {
  return (
    <label className="flex shrink-0 items-center gap-1">
      {showMeasure && (
        <span className="text-[0.6rem] uppercase text-slate-400">{measure}</span>
      )}
      <input
        aria-label={`Lock ${measure}`}
        title="Fix this row's figure exactly"
        inputMode="numeric"
        placeholder="lock"
        className="w-16 rounded border border-slate-300 px-1 py-0.5 text-right text-xs tabular-nums"
        value={value ?? ''}
        onChange={(event) => {
          const text = digits(event.target.value)
          onChange(text === '' ? undefined : Number(text))
        }}
      />
    </label>
  )
}

// ---------------------------------------------------------------------------

export function BattleDialog({
  tree,
  unitTypes,
  onApply,
  onClose,
}: {
  tree: Tree
  unitTypes: readonly UnitType[]
  onApply: (changes: StrengthChange[], label: string) => void
  onClose: () => void
}) {
  const [step, setStep] = useState(1)
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const [direction, setDirection] = useState<Direction>('losses')
  const [menText, setMenText] = useState('')
  const [gunText, setGunText] = useState('')
  const [jitter, setJitter] = useState(0.35)
  const [name, setName] = useState('')
  const [formationSteering, setFormationSteering] = useState<
    ReadonlyMap<number, RowSteering>
  >(new Map())
  const [unitSteering, setUnitSteering] = useState<ReadonlyMap<number, RowSteering>>(
    new Map(),
  )
  // The seed lives in state and is advanced only by Reroll. Deriving it during
  // render — or keying it on anything a weight tap changes — would reshuffle
  // the whole column every time an unrelated row is adjusted, which reads as a
  // bug and destroys trust in the numbers.
  const [seed, setSeed] = useState(newSeed)

  const rows = useMemo(() => flatten(tree), [tree])
  const measureOfUnit = useMemo(() => {
    const typeOf = new Map(unitTypes.map((t) => [t.name, t]))
    const map = new Map<number, Measure>()
    for (const row of rows) {
      if (row.kind !== 'unit') continue
      const type = typeOf.get(row.unit.unitType)
      if (type) map.set(row.unit.id, measureOfType(type))
    }
    return map
  }, [rows, unitTypes])

  const unitById = useMemo(() => {
    const map = new Map<number, Unit>()
    for (const row of rows) if (row.kind === 'unit') map.set(row.unit.id, row.unit)
    return map
  }, [rows])

  const selectedUnits = useMemo(
    () => [...selected].map((id) => unitById.get(id)).filter((u): u is Unit => !!u),
    [selected, unitById],
  )

  const selectionTotals = useMemo(() => {
    let men = 0
    let guns = 0
    for (const unit of selectedUnits) {
      men += unit.men
      guns += unit.weapons
    }
    return { men, guns, units: selectedUnits.length }
  }, [selectedUnits])

  const steering: Steering = useMemo(
    () => ({ formations: formationSteering, units: unitSteering }),
    [formationSteering, unitSteering],
  )

  const totals = useMemo(
    () => ({ men: Number(menText || 0), guns: Number(gunText || 0) }),
    [menText, gunText],
  )

  const allocation: Allocation = useMemo(
    () =>
      allocate({
        tree,
        unitTypes,
        selectedUnitIds: selected,
        direction,
        totals,
        steering,
        jitter,
        seed,
      }),
    [tree, unitTypes, selected, direction, totals, steering, jitter, seed],
  )

  const setRow = (
    kind: 'formation' | 'unit',
    id: number,
    change: Partial<RowSteering>,
  ) => {
    const update = (current: ReadonlyMap<number, RowSteering>) => {
      const next = new Map(current)
      const merged = { ...next.get(id), ...change }
      // Dropping emptied keys keeps the map to rows the player actually set,
      // which is what makes "is anything steered?" a size check.
      for (const key of Object.keys(merged) as (keyof RowSteering)[]) {
        if (merged[key] === undefined) delete merged[key]
      }
      if (Object.keys(merged).length === 0) next.delete(id)
      else next.set(id, merged)
      return next
    }
    if (kind === 'formation') setFormationSteering(update)
    else setUnitSteering(update)
  }

  const changes: StrengthChange[] = [...allocation.byUnit.values()].map((row) =>
    row.measure === 'men'
      ? { unitId: row.unitId, men: row.after, weapons: 0 }
      : { unitId: row.unitId, men: 0, weapons: row.after },
  )

  const words = WORDS[direction]
  const label = name.trim()
    ? `${words.action} — ${name.trim()}`
    : `${words.action} across ${selectionTotals.units} units`

  const shortfalls = allocation.reports.filter((r) => r.unassigned > 0)

  return (
    <Dialog
      title={words.title}
      description={words.blurb}
      onClose={onClose}
      wide
    >
      <StepHeader step={step} onGo={setStep} />

      {step === 1 && (
        <>
          <UnitPicker tree={tree} selected={selected} onChange={setSelected} />

          <p className="mt-2 text-sm text-slate-600 tabular-nums">
            {count(selectionTotals.units)} units selected ·{' '}
            {count(selectionTotals.men)} men · {count(selectionTotals.guns)} guns
          </p>

          <DialogActions>
            <button type="button" className={buttonStyles.quiet} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={buttonStyles.primary}
              disabled={selectionTotals.units === 0}
              onClick={() => setStep(2)}
            >
              Next
            </button>
          </DialogActions>
        </>
      )}

      {step === 2 && (
        <>
          <div className="flex gap-2">
            {(['losses', 'reinforcements'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDirection(option)}
                className={`flex-1 rounded border px-3 py-1.5 text-sm capitalize transition ${
                  direction === option
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 hover:bg-slate-100'
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          <Field
            label={`Men ${words.verb}`}
            hint={
              selectionTotals.men > 0 && totals.men > 0
                ? `${((totals.men / selectionTotals.men) * 100).toFixed(1)}% of the ${count(selectionTotals.men)} men selected`
                : `${count(selectionTotals.men)} men are selected.`
            }
          >
            <input
              className={inputStyles}
              inputMode="numeric"
              autoFocus
              value={menText}
              onChange={(event) => setMenText(digits(event.target.value))}
              placeholder="6700"
            />
          </Field>

          <Field
            label={`Guns ${words.verb}`}
            hint={
              selectionTotals.guns > 0 && totals.guns > 0
                ? `${((totals.guns / selectionTotals.guns) * 100).toFixed(1)}% of the ${count(selectionTotals.guns)} guns selected`
                : `${count(selectionTotals.guns)} guns are selected.`
            }
          >
            <input
              className={inputStyles}
              inputMode="numeric"
              value={gunText}
              onChange={(event) => setGunText(digits(event.target.value))}
              placeholder="11"
            />
          </Field>

          <Field
            label="Jitter"
            hint="Perturbs who bleeds, never how much was lost — the column still sums to the total."
          >
            <div className="mt-1 flex flex-wrap gap-2">
              {JITTER_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setJitter(preset.sigma)}
                  className={`rounded border px-2.5 py-1 text-sm transition ${
                    jitter === preset.sigma
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                className={`${buttonStyles.quiet} ml-auto`}
                onClick={() => setSeed(newSeed())}
              >
                Reroll
              </button>
            </div>
          </Field>

          <Field label="Name (optional)" hint="Carried into the undo label only.">
            <input
              className={inputStyles}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Battle of Portree"
            />
          </Field>

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
              disabled={totals.men === 0 && totals.guns === 0}
              onClick={() => setStep(3)}
            >
              Preview
            </button>
          </DialogActions>
        </>
      )}

      {step === 3 && (
        <>
          {allocation.notes.map((note) => (
            <p
              key={note}
              className="mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900"
            >
              {note}
            </p>
          ))}

          {shortfalls.map((shortfall) => (
            <p
              key={shortfall.measure}
              className="mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900"
            >
              {count(shortfall.requested)} requested ·{' '}
              {count(shortfall.allocatable)} allocatable ·{' '}
              {count(shortfall.unassigned)} unassigned — the selected force is{' '}
              {words.gone}.
            </p>
          ))}

          <div className="max-h-[45vh] overflow-y-auto rounded border border-slate-200">
            {rows.map((row) => {
              if (row.kind === 'formation') {
                const ids = unitIdsUnder(row.node)
                if (!ids.some((id) => selected.has(id))) return null
                const measures: Measure[] = (['men', 'guns'] as const).filter(
                  (measure) =>
                    ids.some(
                      (id) =>
                        selected.has(id) && measureOfUnit.get(id) === measure,
                    ),
                )
                const current = formationSteering.get(row.node.formation.id)
                return (
                  <div
                    key={`f${row.node.formation.id}`}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-100 bg-slate-50/60 py-1 pr-2 text-sm"
                    style={{ paddingLeft: `${0.5 + Math.min(row.depth, 5) * 0.85}rem` }}
                  >
                    <span className="min-w-[7rem] flex-1 truncate font-medium">
                      {row.node.formation.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-600">
                      {measures
                        .map(
                          (measure) =>
                            `${count(subtotal(row.node, allocation, measure))} ${measure}`,
                        )
                        .join(' · ') || '—'}
                    </span>
                    <WeightPicker
                      value={current?.multiplier}
                      onChange={(multiplier) =>
                        setRow('formation', row.node.formation.id, { multiplier })
                      }
                    />
                    {measures.map((measure) => (
                      <LockBox
                        key={measure}
                        measure={measure}
                        showMeasure={measures.length > 1}
                        value={
                          measure === 'men' ? current?.lockMen : current?.lockGuns
                        }
                        onChange={(locked) =>
                          setRow('formation', row.node.formation.id, {
                            [measure === 'men' ? 'lockMen' : 'lockGuns']: locked,
                          })
                        }
                      />
                    ))}
                  </div>
                )
              }

              if (!selected.has(row.unit.id)) return null
              const measure = measureOfUnit.get(row.unit.id)
              if (!measure) return null
              const result = allocation.byUnit.get(row.unit.id)
              const current = unitSteering.get(row.unit.id)
              const before = measure === 'men' ? row.unit.men : row.unit.weapons
              // A paper unit being reinforced has no strength to be a share of,
              // and "(0%)" beside "+4" reads as a bug rather than as undefined.
              const share =
                result && before > 0
                  ? ` (${((result.amount / before) * 100).toFixed(0)}%)`
                  : ''

              return (
                <div
                  key={`u${row.unit.id}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-100 py-1 pr-2 text-sm last:border-b-0"
                  style={{ paddingLeft: `${0.5 + Math.min(row.depth, 5) * 0.85}rem` }}
                >
                  <span className="min-w-[7rem] flex-1 truncate text-slate-700">
                    {row.unit.designation}
                    {result?.wipedOut && (
                      <span className="ml-1 rounded bg-red-100 px-1 py-0.5 text-[0.6rem] font-medium text-red-700">
                        wiped out
                      </span>
                    )}
                    {destroyed(row.unit, result?.after) > 0 && (
                      <span
                        title={`${row.unit.weapon}: lost with the men, and not recovered`}
                        className="ml-1 rounded bg-amber-50 px-1 py-0.5 text-[0.6rem] font-medium text-amber-700"
                      >
                        −{count(destroyed(row.unit, result?.after))} weapons
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-500">
                    {count(before)} → {count(result?.after ?? before)}
                  </span>
                  <span
                    className={`w-24 shrink-0 text-right tabular-nums ${
                      result ? 'text-slate-900' : 'text-slate-300'
                    }`}
                  >
                    {result
                      ? `${direction === 'losses' ? '−' : '+'}${count(result.amount)}${share}`
                      : '—'}
                  </span>
                  <WeightPicker
                    value={current?.multiplier}
                    onChange={(multiplier) =>
                      setRow('unit', row.unit.id, { multiplier })
                    }
                  />
                  <LockBox
                    measure={measure}
                    showMeasure={false}
                    value={measure === 'men' ? current?.lockMen : current?.lockGuns}
                    onChange={(locked) =>
                      setRow('unit', row.unit.id, {
                        [measure === 'men' ? 'lockMen' : 'lockGuns']: locked,
                      })
                    }
                  />
                </div>
              )
            })}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm tabular-nums text-slate-600">
            {allocation.reports
              .filter((r) => r.requested > 0)
              .map((r) => (
                <span key={r.measure}>
                  {count(r.allocated)} of {count(r.requested)} {r.measure}{' '}
                  {words.verb}
                </span>
              ))}
            <button
              type="button"
              className={`${buttonStyles.quiet} ml-auto`}
              onClick={() => setSeed(newSeed())}
            >
              Reroll
            </button>
          </div>

          <DialogActions>
            <button
              type="button"
              className={buttonStyles.quiet}
              onClick={() => setStep(2)}
            >
              Back
            </button>
            <button
              type="button"
              className={buttonStyles.primary}
              disabled={changes.length === 0}
              onClick={() => onApply(changes, label)}
            >
              Apply to {changes.length} unit{changes.length === 1 ? '' : 's'}
            </button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
