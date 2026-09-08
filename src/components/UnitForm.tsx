import { useState } from 'react'
import { Dialog, DialogActions, Field } from './Dialog.tsx'
import { buttonStyles, inputStyles } from './styles.ts'
import { isGunCounted, type Unit, type UnitType } from '../oob/types.ts'

export type UnitValues = {
  unitType: string
  designation: string
  men: number
  weapons: number
  equipment: string
}

export function UnitForm({
  unitTypes,
  formationName,
  existing,
  onSubmit,
  onClose,
}: {
  unitTypes: readonly UnitType[]
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
  const [equipment, setEquipment] = useState(existing?.equipment ?? '')

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
  const valid =
    designation.trim() !== '' &&
    unitType !== '' &&
    strength !== '' &&
    Number.isFinite(parsed)

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
            equipment: equipment.trim(),
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

        <Field label="Equipment">
          <input
            className={inputStyles}
            value={equipment}
            onChange={(event) => setEquipment(event.target.value)}
            placeholder="Warden Rifle (.45 Caliber)"
          />
        </Field>

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
