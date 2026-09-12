import { useState } from 'react'
import { FormControl, TextInput, Textarea, IconButton, Flash } from '@primer/react'
import { InfoIcon } from '@primer/octicons-react'
import { validateBodyMeasurement } from '../utils/validators'
import { useFormState } from '../hooks/useFormState'
import { FormShell } from './FormShell'

function todayString() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`
}

const BIOIMPEDANCE_INFO =
  'Normalmente vem de uma balança de bioimpedância (as residenciais já dão uma estimativa razoável) ou de uma avaliação com profissional de educação física ou nutricionista — algumas clínicas também oferecem isso. Sem acesso a nenhum dos dois, é melhor deixar em branco do que chutar: são estimativas, não medidas exatas.'

function InfoToggle({ open, onToggle, label }) {
  return (
    <IconButton
      icon={InfoIcon}
      variant="invisible"
      size="small"
      aria-label={label}
      aria-expanded={open}
      onClick={onToggle}
    />
  )
}

// Todos os campos são opcionais — o usuário pode preencher só o que sabe. Sem
// balança/avaliação, %gordura e massa magra ficam em branco; o botão ⓘ ao lado explica
// como conseguir essas duas.
export function BodyMeasurementForm({ initialHeightCm, onSubmit, onCancel }) {
  const { values, setField, errors, submitting, handleSubmit } = useFormState({
    initialValues: {
      date: todayString(),
      heightCm: initialHeightCm != null ? String(initialHeightCm) : '',
      weightKg: '',
      bodyFatPercent: '',
      waistCm: '',
      hipCm: '',
      leanMassKg: '',
      note: '',
    },
    validate: validateBodyMeasurement,
    onSubmit,
  })
  const [infoOpen, setInfoOpen] = useState(null)

  return (
    <FormShell onSubmit={handleSubmit} onCancel={onCancel} submitting={submitting}>
      <FormControl>
        <FormControl.Label>Data</FormControl.Label>
        <TextInput
          type="date"
          value={values.date}
          onChange={(e) => setField('date', e.target.value)}
          max={todayString()}
          block
        />
      </FormControl>

      <FormControl>
        <FormControl.Label>Altura (cm)</FormControl.Label>
        <TextInput
          type="number"
          inputMode="decimal"
          value={values.heightCm}
          onChange={(e) => setField('heightCm', e.target.value)}
          placeholder="Ex.: 178"
          block
        />
        {errors.heightCm && (
          <FormControl.Validation variant="error">{errors.heightCm}</FormControl.Validation>
        )}
      </FormControl>

      <FormControl>
        <FormControl.Label>Peso (kg)</FormControl.Label>
        <TextInput
          type="number"
          inputMode="decimal"
          value={values.weightKg}
          onChange={(e) => setField('weightKg', e.target.value)}
          placeholder="Ex.: 78,5"
          block
        />
        {errors.weightKg && (
          <FormControl.Validation variant="error">{errors.weightKg}</FormControl.Validation>
        )}
      </FormControl>

      <FormControl>
        <FormControl.Label sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          % de gordura corporal
          <InfoToggle
            open={infoOpen === 'bodyFat'}
            onToggle={() => setInfoOpen((v) => (v === 'bodyFat' ? null : 'bodyFat'))}
            label="Como medir % de gordura corporal"
          />
        </FormControl.Label>
        {infoOpen === 'bodyFat' && (
          <Flash variant="default" sx={{ mb: 2, fontSize: 0 }}>
            {BIOIMPEDANCE_INFO}
          </Flash>
        )}
        <TextInput
          type="number"
          inputMode="decimal"
          value={values.bodyFatPercent}
          onChange={(e) => setField('bodyFatPercent', e.target.value)}
          placeholder="Ex.: 18"
          block
        />
        {errors.bodyFatPercent && (
          <FormControl.Validation variant="error">{errors.bodyFatPercent}</FormControl.Validation>
        )}
      </FormControl>

      <FormControl>
        <FormControl.Label>Cintura (cm)</FormControl.Label>
        <TextInput
          type="number"
          inputMode="decimal"
          value={values.waistCm}
          onChange={(e) => setField('waistCm', e.target.value)}
          placeholder="Ex.: 85"
          block
        />
        {errors.waistCm && (
          <FormControl.Validation variant="error">{errors.waistCm}</FormControl.Validation>
        )}
      </FormControl>

      <FormControl>
        <FormControl.Label>Quadril (cm)</FormControl.Label>
        <TextInput
          type="number"
          inputMode="decimal"
          value={values.hipCm}
          onChange={(e) => setField('hipCm', e.target.value)}
          placeholder="Ex.: 100"
          block
        />
        {errors.hipCm && (
          <FormControl.Validation variant="error">{errors.hipCm}</FormControl.Validation>
        )}
      </FormControl>

      <FormControl>
        <FormControl.Label sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          Massa magra (kg)
          <InfoToggle
            open={infoOpen === 'leanMass'}
            onToggle={() => setInfoOpen((v) => (v === 'leanMass' ? null : 'leanMass'))}
            label="Como medir massa magra"
          />
        </FormControl.Label>
        {infoOpen === 'leanMass' && (
          <Flash variant="default" sx={{ mb: 2, fontSize: 0 }}>
            {BIOIMPEDANCE_INFO}
          </Flash>
        )}
        <TextInput
          type="number"
          inputMode="decimal"
          value={values.leanMassKg}
          onChange={(e) => setField('leanMassKg', e.target.value)}
          placeholder="Deixe em branco para estimar a partir do peso e % de gordura"
          block
        />
        <FormControl.Caption>
          Se vazio e você informou peso + % de gordura acima, calculamos uma estimativa.
        </FormControl.Caption>
        {errors.leanMassKg && (
          <FormControl.Validation variant="error">{errors.leanMassKg}</FormControl.Validation>
        )}
      </FormControl>

      <FormControl>
        <FormControl.Label>
          Observação <span className="profile-optional">(opcional)</span>
        </FormControl.Label>
        <Textarea
          value={values.note}
          onChange={(e) => setField('note', e.target.value)}
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
