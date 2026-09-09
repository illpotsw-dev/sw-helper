import { useState } from 'react'
import { Dialog, DialogActions, Field } from './Dialog.tsx'
import { buttonStyles, inputStyles } from './styles.ts'
import {
  isGunCounted,
  type StockEntry,
  type Unit,
  type UnitType,
  type Weapon,
  type WeaponClass,
} from '../oob/types.ts'

export type UnitValues = {
  unitType: string
  designation: string
  men: number
  weapons: number
  weapon: string
  weaponCount: number
}

const count = (value: number) => value.toLocaleString('en-US')

export function UnitForm({
  unitTypes,
  weapons: catalog,
  stock,
  movesStock,
  formationName,
  existing,
  onSubmit,
  onClose,
}: {
  unitTypes: readonly UnitType[]
  weapons: readonly Weapon[]
  stock: readonly StockEntry[]
  /**
   * True on the live Order of Battle, where arming a unit really draws on the
   * pile. On a saved design a holding is an intention, so the picker offers
   * the whole catalog and nothing is limited by what is in store.
   */
  movesStock: boolean
  formationName: string
  existing?: Unit
  onSubmit: (values: UnitValues) => void
  onClose: () => void
}) {
  // Deliberately blank when adding rather than defaulting to the first type.
  // The chosen type decides whether the strength box means men or guns, so a
  // silent default lets someone type 900 for a levy battalion and record 900
  // guns. Making the choice explicit removes that whole class of mistake.
  const [unitType, setUnitType] = useState(existing?.unitType ?? '')
  const [designation, setDesignation] = useState(existing?.designation ?? '')
  const [weapon, setWeapon] = useState(existing?.weapon ?? '')

  const type = unitTypes.find((t) => t.name === unitType)
  const guns = type ? isGunCounted(type.category) : false

  // A unit is measured in men or in guns, never both. Choosing the measure
  // from the type rather than offering two boxes makes the invalid
  // combinations — both filled, or neither — impossible to enter.
  const [strength, setStrength] = useState(
    String(existing ? existing.men || existing.weapons : ''),
  )

  const parsed = Number(strength)
  // Zero is allowed — a wiped-out battalion, or one sketched in a design
  // before it is raised, sits on the books at nothing. An empty box is not:
  // that is an unanswered question rather than an answer of none.
  const strengthGiven = strength !== '' && Number.isFinite(parsed)

  // Small arms to man-counted units, guns to gun-counted ones. Issuing
  // 18-pounders to a levy battalion is an error, not a judgement call, so the
  // wrong class is simply not offered.
  const wanted: WeaponClass = guns ? 'gun' : 'small_arm'
  const offered = catalog.filter((w) => w.class === wanted)

  const stockOf = new Map(stock.map((entry) => [entry.weapon, entry.quantity]))
  /**
   * What this unit could hold of a pattern: the pile, plus whatever it is
   * already carrying of it, since editing a unit hands its holding back before
   * drawing the new one. On a design nothing is drawn, so nothing limits it.
   */
  const availableOf = (name: string): number => {
    if (!movesStock) return Number.MAX_SAFE_INTEGER
    const held = existing?.weapon === name ? existing.weaponCount : 0
    return (stockOf.get(name) ?? 0) + held
  }

  const available = weapon === '' ? 0 : availableOf(weapon)
  // A unit never holds more weapons than it has men or guns: a spare weapon is
  // by definition stockpile, so a unit carrying spares is holding stockpile in
  // the wrong place.
  const ceiling = Math.min(strengthGiven ? parsed : 0, available)

  const [held, setHeld] = useState(
    existing?.weapon ? String(existing.weaponCount) : '',
  )
  // Blank means fully armed, which is what the great majority of units are and
  // what an omitted weapon_count means in the file.
  const heldValue = held === '' ? ceiling : Math.min(Number(held), ceiling)
  const shortfall = (strengthGiven ? parsed : 0) - heldValue

  const chooseWeapon = (name: string) => {
    setWeapon(name)
    // A pattern chosen fresh arms the unit as far as it goes, rather than
    // making the player retype a number the app already knows.
    setHeld('')
  }

  const valid =
    designation.trim() !== '' &&
    unitType !== '' &&
    strengthGiven &&
    (weapon === '' || Number.isFinite(heldValue))

  return (
    <Dialog
      title={existing ? `Edit ${existing.designation}` : 'Add unit'}
      description={existing ? undefined : `Attached to ${formationName}.`}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!valid) return
          onSubmit({
            unitType,
            designation: designation.trim(),
            men: guns ? 0 : parsed,
            weapons: guns ? parsed : 0,
            weapon,
            weaponCount: weapon === '' ? 0 : heldValue,
          })
        }}
      >
        <Field label="Designation">
          <input
            className={inputStyles}
            value={designation}
            autoFocus
            onChange={(event) => setDesignation(event.target.value)}
            placeholder="II/I Levy Battalion"
          />
        </Field>

        <Field
          label="Unit type"
          hint={
            type
              ? `${type.category.replace(/_/g, ' ')} · ${type.upkeepPerTurn} upkeep per turn`
              : 'No unit types defined for this nation yet.'
          }
        >
          <select
            className={inputStyles}
            value={unitType}
            onChange={(event) => setUnitType(event.target.value)}
          >
            <option value="" disabled>
              Choose a unit type…
            </option>
            {unitTypes.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={type ? (guns ? 'Guns' : 'Men') : 'Strength'}
          hint={
            !type
              ? 'Choose a unit type first — it decides whether this counts men or guns.'
              : parsed === 0 && strength !== ''
                ? 'A paper unit: on the books with nobody in it.'
                : guns
                  ? 'Batteries are counted in guns and carry no headcount.'
                  : undefined
          }
        >
          <input
            className={inputStyles}
            value={strength}
            inputMode="numeric"
            disabled={!type}
            onChange={(event) =>
              setStrength(event.target.value.replace(/[^0-9]/g, ''))
            }
            placeholder={type ? (guns ? '20' : '1000') : ''}
          />
        </Field>

        <Field
          label="Weapon"
          hint={
            !type
              ? 'Choose a unit type first — it decides whether this takes small arms or guns.'
              : offered.length === 0
                ? `The catalog has no ${guns ? 'guns' : 'small arms'} to issue.`
                : movesStock
                  ? 'Only what is in the stockpile can be issued. Arming a unit draws on the pile.'
                  : undefined
          }
        >
          <select
            className={inputStyles}
            value={weapon}
            disabled={!type}
            onChange={(event) => chooseWeapon(event.target.value)}
          >
            <option value="">Unarmed</option>
            {offered.map((w) => {
              const spare = availableOf(w.name)
              return (
                // A pattern with none in stock is shown but not selectable, so
                // the player can see the arsenal has none rather than wonder
                // where it went.
                <option key={w.name} value={w.name} disabled={spare <= 0}>
                  {w.name}
                  {movesStock ? ` — ${count(spare)} available` : ''}
                </option>
              )
            })}
          </select>
        </Field>

        {weapon !== '' && (
          <Field
            label="Held"
            hint={
              shortfall > 0
                ? `Under-armed by ${count(shortfall)}. Legal, and flagged on the unit's row.`
                : 'Blank means fully armed: one weapon per man or per gun.'
            }
          >
            <input
              className={inputStyles}
              value={held}
              inputMode="numeric"
              onChange={(event) =>
                setHeld(event.target.value.replace(/[^0-9]/g, ''))
              }
              placeholder={String(ceiling)}
            />
          </Field>
        )}

        <DialogActions>
          <button type="button" className={buttonStyles.quiet} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={buttonStyles.primary} disabled={!valid}>
            {existing ? 'Save' : 'Add'}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
