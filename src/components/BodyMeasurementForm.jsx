import { useState } from 'react'
import { Flash, FormControl, IconButton, TextInput, Textarea } from '@primer/react'
import { InfoIcon } from '@primer/octicons-react'
import { validateBodyMeasurement } from '../utils/validators'
import { useFormState } from '../hooks/useFormState'
import { businessDayKey } from '../utils/businessDate'
import { FormShell } from './FormShell'

function todayString() {
  return businessDayKey()
}

const GENERAL_FIELDS = [
  ['heightCm', 'Altura', 'cm', '178'],
  ['weightKg', 'Peso', 'kg', '78,5'],
  ['bodyFatPercent', 'Gordura corporal', '%', '18'],
]
const CIRCUMFERENCE_FIELDS = [
  ['abdomenCm', 'Abdômen'],
  ['waistCm', 'Cintura'],
  ['hipCm', 'Quadril'],
  ['chestCm', 'Tórax'],
  ['armCm', 'Braço'],
  ['thighCm', 'Coxa'],
  ['calfCm', 'Panturrilha'],
]
const COMPOSITION_FIELDS = [
  ['leanMassKg', 'Massa magra'],
  ['fatMassKg', 'Massa gorda'],
]

function NumericField({ field, label, unit, example, values, setField, errors }) {
  return (
    <FormControl>
      <FormControl.Label>
        {label} ({unit})
      </FormControl.Label>
      <TextInput
        type="number"
        inputMode="decimal"
        value={values[field]}
        onChange={(event) => setField(field, event.target.value)}
        placeholder={`Ex.: ${example || '85'}`}
        block
      />
      {errors[field] && (
        <FormControl.Validation variant="error">{errors[field]}</FormControl.Validation>
      )}
    </FormControl>
  )
}

export function BodyMeasurementForm({ initialHeightCm, onSubmit, onCancel }) {
  const initialValues = Object.fromEntries(
    [...GENERAL_FIELDS, ...CIRCUMFERENCE_FIELDS, ...COMPOSITION_FIELDS].map(([field]) => [
      field,
      field === 'heightCm' && initialHeightCm != null ? String(initialHeightCm) : '',
    ])
  )
  const { values, setField, errors, submitting, handleSubmit } = useFormState({
    initialValues: { date: todayString(), ...initialValues, note: '' },
    validate: validateBodyMeasurement,
    onSubmit,
  })
  const [infoOpen, setInfoOpen] = useState(false)

  return (
    <FormShell onSubmit={handleSubmit} onCancel={onCancel} submitting={submitting}>
      <FormControl>
        <FormControl.Label>Data</FormControl.Label>
        <TextInput
          type="date"
          value={values.date}
          onChange={(event) => setField('date', event.target.value)}
          max={todayString()}
          block
        />
        {errors.date && (
          <FormControl.Validation variant="error">{errors.date}</FormControl.Validation>
        )}
      </FormControl>

      <fieldset className="measurement-fieldset">
        <legend>Dados gerais</legend>
        <span className="measurement-fieldset-caption">Preencha somente o que mediu.</span>
        <div className="measurement-form-grid">
          {GENERAL_FIELDS.map(([field, label, unit, example]) => (
            <NumericField
              key={field}
              {...{ field, label, unit, example, values, setField, errors }}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="measurement-fieldset">
        <legend>Circunferências</legend>
        <span className="measurement-fieldset-caption">Todas em centímetros.</span>
        <div className="measurement-form-grid">
          {CIRCUMFERENCE_FIELDS.map(([field, label]) => (
            <NumericField key={field} {...{ field, label, unit: 'cm', values, setField, errors }} />
          ))}
        </div>
      </fieldset>

      <fieldset className="measurement-fieldset">
        <legend>
          Composição
          <IconButton
            icon={InfoIcon}
            variant="invisible"
            size="small"
            aria-label="Sobre composição corporal"
            aria-expanded={infoOpen}
            onClick={() => setInfoOpen((open) => !open)}
          />
        </legend>
        {infoOpen && (
          <Flash variant="default" sx={{ mb: 2, fontSize: 0 }}>
            Valores de composição variam conforme método e protocolo. Se deixar as massas em branco,
            peso e gordura permitem estimativas.
          </Flash>
        )}
        <div className="measurement-form-grid">
          {COMPOSITION_FIELDS.map(([field, label]) => (
            <NumericField key={field} {...{ field, label, unit: 'kg', values, setField, errors }} />
          ))}
        </div>
      </fieldset>

      <FormControl>
        <FormControl.Label>
          Observação <span className="profile-optional">(opcional)</span>
        </FormControl.Label>
        <Textarea
          value={values.note}
          onChange={(event) => setField('note', event.target.value)}
          rows={2}
          maxLength={300}
          block
        />
        {errors.note && (
          <FormControl.Validation variant="error">{errors.note}</FormControl.Validation>
        )}
      </FormControl>
    </FormShell>
  )
}
