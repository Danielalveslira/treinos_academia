import { useState } from 'react'
import { Box, Button, Heading, Text } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { useBodyMeasurements } from '../hooks/useBodyMeasurements'
import { useToast } from '../hooks/useToast'
import { saveBodyCheckIn } from '../services/bodyMeasurementsService'
import { getLatestBodyComposition, getWeightTrend } from '../utils/bodyComposition'
import { BodyMeasurementForm } from './BodyMeasurementForm'
import { ErrorState } from './ErrorState'
import { ToastFlash } from './ToastFlash'
import { IndicatorCard } from './IndicatorCard'

const EMPTY_LABEL = 'Adicione essa medida'

function formatWeightTrend(trend) {
  if (trend.average == null) return EMPTY_LABEL
  const base = `${trend.average.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`
  if (trend.percentChange == null) return base
  const sign = trend.percentChange >= 0 ? '+' : ''
  return `${base} (${sign}${trend.percentChange.toFixed(1)}%)`
}

export function BodyCompositionCard() {
  const { user, profile } = useAuth()
  const { measurements, loading, error, refresh } = useBodyMeasurements()
  const { toasts, showToast } = useToast()
  const [formOpen, setFormOpen] = useState(false)

  const composition = getLatestBodyComposition(measurements, profile?.heightCm)
  const trend = getWeightTrend(measurements)

  async function handleSubmit(values) {
    try {
      const saved = await saveBodyCheckIn(user.uid, values)
      setFormOpen(false)
      if (saved) {
        showToast('Medidas salvas.')
        refresh()
      }
    } catch (err) {
      console.error('[BodyCompositionCard] save:', err)
      showToast('Não foi possível salvar. Tente novamente.', 'danger')
    }
  }

  return (
    <section className="body-composition-card" aria-labelledby="body-composition-title">
      <ToastFlash toasts={toasts} />
      <div className="section-heading">
        <div>
          <span className="eyebrow">SEU CORPO</span>
          <Heading as="h2" id="body-composition-title">
            Composição corporal
          </Heading>
        </div>
        {!formOpen && (
          <Button size="small" onClick={() => setFormOpen(true)}>
            Atualizar minhas medidas
          </Button>
        )}
      </div>

      {formOpen && (
        <BodyMeasurementForm
          initialHeightCm={profile?.heightCm}
          onSubmit={handleSubmit}
          onCancel={() => setFormOpen(false)}
        />
      )}

      <ErrorState error={error} onRetry={refresh} />

      {!loading && !error && (
        <>
          {measurements.length === 0 && (
            <Text sx={{ display: 'block', color: 'fg.muted', fontSize: 1, mb: 3 }}>
              Nenhuma medida registrada ainda.
            </Text>
          )}
          <Box className="stats-grid body-stats-grid">
            <IndicatorCard
              label="IMC"
              value={composition.bmi != null ? composition.bmi.toFixed(1) : EMPTY_LABEL}
            />
            <IndicatorCard label="Peso (média 7 dias)" value={formatWeightTrend(trend)} />
            <IndicatorCard
              label="% gordura"
              value={composition.bodyFatPercent != null ? `${composition.bodyFatPercent}%` : EMPTY_LABEL}
            />
            <IndicatorCard
              label="RCQ (cintura/quadril)"
              value={composition.whr != null ? composition.whr.toFixed(2) : EMPTY_LABEL}
            />
            <IndicatorCard
              label="Massa magra"
              value={
                composition.leanMassKg != null
                  ? `${composition.leanMassKg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`
                  : EMPTY_LABEL
              }
            />
          </Box>
        </>
      )}
    </section>
  )
}
