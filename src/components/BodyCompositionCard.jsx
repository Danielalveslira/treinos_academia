import { useState } from 'react'
import { Box, Button, Heading, Text } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { useBodyMeasurements } from '../hooks/useBodyMeasurements'
import { useToast } from '../hooks/useToast'
import { saveBodyCheckIn } from '../services/bodyMeasurementsService'
import {
  getBodyMetricChange,
  getBodyMetricSeries,
  getLatestBodyComposition,
  getWeightTrend,
} from '../utils/bodyComposition'
import { BodyMeasurementForm } from './BodyMeasurementForm'
import { ErrorState } from './ErrorState'
import { ToastFlash } from './ToastFlash'
import { IndicatorCard } from './IndicatorCard'
import { BodyMetricChart } from './BodyMetricChart'

const EMPTY_LABEL = 'Adicione essa medida'
const BODY_METRICS = {
  weightKg: { label: 'Peso', unit: 'kg' },
  bodyFatPercent: { label: 'Gordura', unit: '%' },
  leanMassKg: { label: 'Massa magra', unit: 'kg' },
  fatMassKg: { label: 'Massa gorda', unit: 'kg' },
  abdomenCm: { label: 'Abdômen', unit: 'cm' },
  waistCm: { label: 'Cintura', unit: 'cm' },
  hipCm: { label: 'Quadril', unit: 'cm' },
  chestCm: { label: 'Tórax', unit: 'cm' },
  armCm: { label: 'Braço', unit: 'cm' },
  thighCm: { label: 'Coxa', unit: 'cm' },
  calfCm: { label: 'Panturrilha', unit: 'cm' },
}
const BODY_PERIODS = { month: 30, quarter: 90, year: 365 }
const CIRCUMFERENCES = [
  ['abdomenCm', 'Abdômen'],
  ['waistCm', 'Cintura'],
  ['hipCm', 'Quadril'],
  ['chestCm', 'Tórax'],
  ['armCm', 'Braço'],
  ['thighCm', 'Coxa'],
  ['calfCm', 'Panturrilha'],
]

function formatWeightTrend(trend) {
  if (trend.average == null) return EMPTY_LABEL
  const base = `${trend.average.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`
  if (trend.percentChange == null) return base
  const sign = trend.percentChange >= 0 ? '+' : ''
  return `${base} (${sign}${trend.percentChange.toFixed(1)}%)`
}

export function BodyCompositionCard() {
  const { user, profile } = useAuth()
  const { measurements, truncated, loading, error, refresh } = useBodyMeasurements()
  const { toasts, showToast } = useToast()
  const [formOpen, setFormOpen] = useState(false)
  const [metric, setMetric] = useState('weightKg')
  const [period, setPeriod] = useState('quarter')

  const composition = getLatestBodyComposition(measurements, profile?.heightCm)
  const trend = getWeightTrend(measurements)
  const series = getBodyMetricSeries(measurements, metric, BODY_PERIODS[period])
  const metricChange = getBodyMetricChange(series)
  const metricConfig = BODY_METRICS[metric]

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
          {truncated && (
            <Text sx={{ display: 'block', color: 'attention.fg', fontSize: 1, mb: 3 }}>
              Exibindo as 500 medições mais recentes. O início do período anual pode estar
              incompleto.
            </Text>
          )}
          <Box className="stats-grid body-stats-grid">
            {composition.weightKg != null && (
              <IndicatorCard
                label="Peso atual"
                value={`${composition.weightKg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`}
              />
            )}
            {trend.average != null && (
              <IndicatorCard label="Tendência do peso · 7 dias" value={formatWeightTrend(trend)} />
            )}
            {composition.bodyFatPercent != null && (
              <IndicatorCard label="Gordura corporal" value={`${composition.bodyFatPercent}%`} />
            )}
            {composition.bmi != null && (
              <IndicatorCard
                label="IMC · referência"
                value={composition.bmi.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
              />
            )}
            {composition.leanMassKg != null && (
              <IndicatorCard
                label={`Massa magra · ${composition.leanMassSource === 'manual' ? 'informada' : 'estimada'}`}
                value={`${composition.leanMassKg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`}
              />
            )}
            {composition.fatMassKg != null && (
              <IndicatorCard
                label={`Massa gorda · ${composition.fatMassSource === 'manual' ? 'informada' : 'estimada'}`}
                value={`${composition.fatMassKg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`}
              />
            )}
            {composition.waistHeightRatio != null && (
              <IndicatorCard
                label="Relação cintura/altura"
                value={composition.waistHeightRatio.toFixed(2)}
              />
            )}
            {composition.whr != null && (
              <IndicatorCard label="Relação cintura/quadril" value={composition.whr.toFixed(2)} />
            )}
          </Box>
          <Text as="p" sx={{ color: 'fg.muted', fontSize: 1 }}>
            IMC é apenas uma referência. Valores de composição corporal variam conforme método e protocolo.
          </Text>

          <div className="body-subsection-heading">
            <span className="eyebrow">MEDIDAS CORPORAIS</span>
            <Heading as="h3">Medidas atuais e tendência</Heading>
          </div>
          <Box className="stats-grid body-measurements-grid">
            {CIRCUMFERENCES.map(([field, label]) =>
              composition[field] != null ? (
                <IndicatorCard
                  key={field}
                  label={label}
                  value={`${composition[field].toLocaleString('pt-BR', { maximumFractionDigits: 1 })} cm`}
                />
              ) : null
            )}
          </Box>
          <div className="body-chart-controls">
            <div className="metric-tabs" role="tablist" aria-label="Medida corporal">
              {Object.entries(BODY_METRICS).map(([key, item]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={metric === key}
                  className={metric === key ? 'is-active' : ''}
                  onClick={() => setMetric(key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="metric-tabs" role="tablist" aria-label="Período da medida">
              {[
                ['month', 'Mês'],
                ['quarter', 'Trimestre'],
                ['year', 'Ano'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={period === key}
                  className={period === key ? 'is-active' : ''}
                  onClick={() => setPeriod(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {series.length > 0 ? (
            <>
              <Text as="p" sx={{ color: 'fg.muted', fontSize: 1 }}>
                Atual: {metricChange.current.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}{' '}
                {metricConfig.unit}
                {metricChange.change != null &&
                  ` · Variação: ${metricChange.change > 0 ? '+' : ''}${metricChange.change.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${metricConfig.unit}`}
                {' · '}
                {metricChange.trend}
              </Text>
              <BodyMetricChart data={series} unit={metricConfig.unit} />
            </>
          ) : (
            <Text sx={{ color: 'fg.muted', fontSize: 1 }}>
              Sem dados para esta medida no período.
            </Text>
          )}
        </>
      )}
    </section>
  )
}
