import { useState } from 'react'
import { Box, Button, Flash, Heading, IconButton, Text } from '@primer/react'
import { InfoIcon } from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { useBodyMeasurements } from '../hooks/useBodyMeasurements'
import { useToast } from '../hooks/useToast'
import { saveBodyCheckIn } from '../services/bodyMeasurementsService'
import { calculateAge } from '../utils/age'
import {
  classifyBMI,
  getBmiReferenceRange,
  getBmiReferenceWeightRange,
  getBmiScalePosition,
  getBmiWeightGap,
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
  const [bmiInfoOpen, setBmiInfoOpen] = useState(false)

  const composition = getLatestBodyComposition(measurements, profile?.heightCm)
  const trend = getWeightTrend(measurements)
  const series = getBodyMetricSeries(measurements, metric, BODY_PERIODS[period])
  const metricChange = getBodyMetricChange(series)
  const metricConfig = BODY_METRICS[metric]

  const age = profile?.dataNascimento ? calculateAge(profile.dataNascimento) : null
  const bmiClassification = classifyBMI(composition.bmi, age)
  const bmiScalePosition = getBmiScalePosition(composition.bmi)
  const bmiReferenceRange = getBmiReferenceRange(age)
  const bmiReferenceWeightRange = getBmiReferenceWeightRange(profile?.heightCm, age)
  const bmiWeightGap = getBmiWeightGap(composition.weightKg, profile?.heightCm, age)

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
              <IndicatorCard label="Tendência · 7 dias" value={formatWeightTrend(trend)} />
            )}
            {composition.bodyFatPercent != null && (
              <IndicatorCard label="Gordura corporal" value={`${composition.bodyFatPercent}%`} />
            )}
            {composition.bmi != null && (
              <div className="indicator-card">
                <div className="indicator-label">
                  <span>IMC · referência</span>
                  <IconButton
                    icon={InfoIcon}
                    variant="invisible"
                    size="small"
                    aria-label="Sobre o IMC"
                    aria-expanded={bmiInfoOpen}
                    className="bmi-info-toggle"
                    onClick={() => setBmiInfoOpen((open) => !open)}
                  />
                </div>
                <div className="indicator-value">
                  {composition.bmi.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
                </div>
                {bmiClassification && (
                  <span className={`bmi-badge bmi-badge-${bmiClassification.tone}`}>
                    {bmiClassification.label}
                  </span>
                )}
                {bmiScalePosition != null && bmiClassification && bmiClassification.tone !== 'neutral' && (
                  <div className="bmi-scale" aria-hidden="true">
                    <span className="bmi-scale-marker" style={{ left: `${bmiScalePosition}%` }} />
                  </div>
                )}
              </div>
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
          {composition.bmi != null && bmiInfoOpen && (
            <Flash variant="default" className="bmi-info-flash" sx={{ mb: 3, fontSize: 1 }}>
              {bmiClassification?.tone === 'neutral' && <p>{bmiClassification.message}</p>}
              {!bmiClassification && (
                <p>Adicione sua data de nascimento no perfil para ver a classificação do IMC.</p>
              )}
              {bmiReferenceRange && (
                <p>
                  Faixa de IMC adequada para sua idade: {bmiReferenceRange.min.toLocaleString('pt-BR')} a{' '}
                  {bmiReferenceRange.max.toLocaleString('pt-BR')}
                  {bmiReferenceWeightRange &&
                    ` (aproximadamente ${bmiReferenceWeightRange.minKg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg a ${bmiReferenceWeightRange.maxKg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg na sua altura)`}
                  .
                </p>
              )}
              {bmiWeightGap && (
                <p>
                  {bmiWeightGap.status === 'dentro' &&
                    'Seu peso já está dentro da faixa de referência — nenhuma perda de peso é indicada por esse indicador.'}
                  {bmiWeightGap.status === 'acima' &&
                    `Estimativa: faltam cerca de ${bmiWeightGap.diffKg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg para alcançar o limite superior da faixa de referência.`}
                  {bmiWeightGap.status === 'abaixo' &&
                    `Seu peso está cerca de ${bmiWeightGap.diffKg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg abaixo da faixa de referência. Isso não é uma recomendação de ganho de peso.`}
                </p>
              )}
              <p>
                IMC é uma estimativa matemática (peso ÷ altura²) e não mede diretamente gordura corporal ou
                massa muscular. É apenas uma referência de triagem, não uma recomendação clínica
                personalizada — valores de composição corporal variam conforme método e protocolo.
              </p>
            </Flash>
          )}

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
