import { useId } from 'react'
import { MAX_LIMIT, type LimitScope } from '../../../courses/types'
import { parseLimit, type LimitDraft } from './limitDraft'

/** "How many times: [2] per [team ▾]", for the witness and investigator limits. */
export function LimitField({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string
  hint: string
  value: LimitDraft
  onChange(next: LimitDraft): void
  disabled?: boolean
}) {
  const id = useId()
  const invalid = parseLimit(value) === null
  return (
    <fieldset className="limit-field" disabled={disabled}>
      <legend>{label}</legend>
      <div className="limit-field-inputs">
        <input
          id={`${id}-max`}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_LIMIT}
          step={1}
          value={value.max}
          onChange={(e) => onChange({ ...value, max: e.target.value })}
          aria-label={`${label}: how many`}
          aria-invalid={invalid}
          aria-describedby={`${id}-hint`}
        />
        <select
          value={value.per}
          onChange={(e) => onChange({ ...value, per: e.target.value as LimitScope })}
          aria-label={`${label}: for each team or each student`}
        >
          <option value="team">per team</option>
          <option value="student">per student</option>
        </select>
      </div>
      <span id={`${id}-hint`} className={invalid ? 'form-error field-hint' : 'muted field-hint'}>
        {invalid ? `Enter a whole number from 1 to ${MAX_LIMIT}.` : hint}
      </span>
    </fieldset>
  )
}
