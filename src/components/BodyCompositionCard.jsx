import { useState } from 'react'
import { Box, Button, Flash, Heading, IconButton, Text } from '@primer/react'
import { InfoIcon } from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { useBodyMeasurements } from '../hooks/useBodyMeasurements'
import { useToast } from '../hooks/useToast'
import { saveBodyCheckIn } from '../services/bodyMeasurementsService'
import { calculateAge } from '../utils/age'
import { buildBmiScale } from '../utils/bmiScale'
import {
  classifyBMI,
  getBmiReferenceRange,
  getBodyMetricChange,
  getBodyMetricSeries,
  getLatestBodyComposition,
  getWeightTrend,
} from '../utils/bodyComposition'
import { BodyMeasurementForm } from './BodyMeasurementForm'
import { HealthConsentSettings } from './HealthConsentSettings'
import { isHealthConsentRequiredError } from '../utils/privacyConsent'
import { ErrorState } from './ErrorState'
import { ToastFlash } from './ToastFlash'
import { IndicatorCard } from './IndicatorCard'
import { BodyMetricChart } from './BodyMetricChart'

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
  if (trend.status === 'empty') return 'Sem dados de peso'
  if (trend.status === 'stale') return 'Sem medições recentes'
  if (trend.status === 'insufficient') return 'Dados insuficientes para comparar'
  const base = `${trend.average.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`
  if (trend.percentChange == null) return base
  const sign = trend.percentChange >= 0 ? '+' : ''
  return `${base} (${trend.changeKg >= 0 ? '+' : ''}${trend.changeKg.toFixed(1)} kg · ${sign}${trend.percentChange.toFixed(1)}%)`
}

const measurementDate = (value) => {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : 'data indisponível'
}

function CardInfoButton({ label, expanded, onClick }) {
  return (
    <IconButton
      icon={InfoIcon}
      variant="invisible"
      size="small"
      aria-label={label}
      aria-expanded={expanded}
      className="body-info-toggle"
      onClick={onClick}
    />
  )
}

export function BodyCompositionCard() {
  const { user, profile, patchProfile } = useAuth()
  const { measurements, truncated, loading, error, refresh, offline, available } =
    useBodyMeasurements()
  const { toasts, showToast } = useToast()
  const [formOpen, setFormOpen] = useState(false)
  const [consentNeeded, setConsentNeeded] = useState(false)
  const [metric, setMetric] = useState('weightKg')
  const [period, setPeriod] = useState('quarter')
  const [trendInfoOpen, setTrendInfoOpen] = useState(false)
  const [bmiInfoOpen, setBmiInfoOpen] = useState(false)

  const composition = getLatestBodyComposition(measurements, profile?.heightCm)
  const trend = getWeightTrend(measurements)
  const series = getBodyMetricSeries(measurements, metric, BODY_PERIODS[period])
  const metricChange = getBodyMetricChange(series)
  const metricConfig = BODY_METRICS[metric]

  const age = profile?.dataNascimento ? calculateAge(profile.dataNascimento) : null
  const bmiClassification = classifyBMI(composition.bmi, age)
  const bmiReferenceRange = getBmiReferenceRange(age)
  const bmiScale = buildBmiScale(composition.bmi, age)

  async function handleSubmit(values) {
    try {
      const saved = await saveBodyCheckIn(user.uid, values)
      if (saved) {
        if (values.heightCm !== '' && Number(values.heightCm) !== Number(profile?.heightCm))
          patchProfile(user.uid, { heightCm: Number(values.heightCm) })
        setFormOpen(false)
        showToast('Medidas salvas.')
        if (
          Object.keys(values).some(
            (key) => key !== 'heightCm' && key !== 'date' && key !== 'note' && values[key] !== ''
          )
        )
          refresh()
      }
    } catch (err) {
      // Medidas corporais exigem o consentimento específico (servidor). O formulário fica
      // aberto com os valores, e a autorização é pedida aqui mesmo, sem perder o que foi digitado.
      if (isHealthConsentRequiredError(err)) {
        setConsentNeeded(true)
        return
      }
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
        {!formOpen && !offline && (
          <Button size="small" onClick={() => setFormOpen(true)}>
            Atualizar minhas medidas
          </Button>
        )}
      </div>

      {formOpen && consentNeeded && (
        <Flash variant="attention" sx={{ mb: 3 }}>
          <HealthConsentSettings
            source="feature_prompt"
            compact
            onChange={(state) => state.granted && setConsentNeeded(false)}
          />
          <Text as="p" sx={{ mt: 2, mb: 0, fontSize: 1 }}>
            Depois de autorizar, salve as medidas novamente.
          </Text>
        </Flash>
      )}
      {formOpen && (
        <BodyMeasurementForm
          initialHeightCm={profile?.heightCm}
          onSubmit={handleSubmit}
          onCancel={() => setFormOpen(false)}
        />
      )}

      <ErrorState error={error} onRetry={refresh} />
      {offline && (
        <Text as="p" sx={{ color: 'fg.muted' }}>
          {available
            ? 'Medições salvas anteriormente; alterações locais podem estar pendentes de sincronização.'
            : 'Medidas indisponíveis sem conexão. Os dados serão carregados ao reconectar.'}
        </Text>
      )}

      {available && !loading && !error && (
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
                label={`Peso · ${measurementDate(composition.dates.weightKg)}`}
                value={`${composition.weightKg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`}
              />
            )}
            <div className="indicator-card">
              <div className="indicator-label">
                <span>Tendência · 7 dias</span>
                <CardInfoButton
                  label="Sobre a tendência de peso"
                  expanded={trendInfoOpen}
                  onClick={() => setTrendInfoOpen((open) => !open)}
                />
              </div>
              <div className="indicator-value">{formatWeightTrend(trend)}</div>
            </div>
            {composition.bodyFatPercent != null && (
              <IndicatorCard
                label={`Gordura corporal · ${measurementDate(composition.dates.bodyFatPercent)}`}
                value={`${composition.bodyFatPercent}%`}
              />
            )}
            {composition.bmi != null && (
              <div className="indicator-card">
                <div className="indicator-label">
                  <span>IMC · peso de {measurementDate(composition.dates.weightKg)}</span>
                  <CardInfoButton
                    label="Sobre o IMC"
                    expanded={bmiInfoOpen}
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
                {bmiScale && (
                  <div
                    className="bmi-scale"
                    role="img"
                    aria-label={`Escala de IMC de ${bmiScale.min} a ${bmiScale.max}. Faixa adequada de ${bmiReferenceRange.min.toLocaleString('pt-BR')} a ${bmiReferenceRange.max.toLocaleString('pt-BR')}. IMC atual ${composition.bmi.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}: ${bmiClassification.label}.`}
                  >
                    {bmiScale.segments.map((segment) => (
                      <span
                        key={segment.key}
                        className={`bmi-scale-segment bmi-scale-${segment.key}`}
                        style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
                        title={segment.label}
                      />
                    ))}
                    <span className="bmi-scale-marker" style={{ left: `${bmiScale.marker}%` }} />
                  </div>
                )}
                {bmiReferenceRange && (
                  <div className="bmi-scale-caption">
                    <span>{bmiScale.min}</span>
                    <span>
                      Adequado: {bmiReferenceRange.min.toLocaleString('pt-BR')}–
                      {bmiReferenceRange.max.toLocaleString('pt-BR')}
                    </span>
                    <span>{bmiScale.max}</span>
                  </div>
                )}
              </div>
            )}
            {composition.leanMassKg != null && (
              <IndicatorCard
                label={`Massa magra · ${composition.leanMassSource === 'manual' ? 'informada' : 'estimada'} · ${measurementDate(composition.dates.leanMassKg)}`}
                value={`${composition.leanMassKg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`}
              />
            )}
            {composition.fatMassKg != null && (
              <IndicatorCard
                label={`Massa gorda · ${composition.fatMassSource === 'manual' ? 'informada' : 'estimada'} · ${measurementDate(composition.dates.fatMassKg)}`}
                value={`${composition.fatMassKg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`}
              />
            )}
            {composition.waistHeightRatio != null && (
              <IndicatorCard
                label={`Relação cintura/altura · cintura de ${measurementDate(composition.dates.waistCm)}`}
                value={composition.waistHeightRatio.toFixed(2)}
              />
            )}
            {composition.whr != null && (
              <IndicatorCard
                label={`Relação cintura/quadril · ${measurementDate(composition.dates.waistCm)}`}
                value={composition.whr.toFixed(2)}
              />
            )}
          </Box>
          {trendInfoOpen && (
            <Flash variant="default" className="body-info-flash" sx={{ mb: 3, fontSize: 1 }}>
              <p>
                A tendência compara a média de pelo menos duas datas nos últimos sete dias com pelo
                menos duas datas nos sete dias anteriores. Mudanças de peso são informativas.
              </p>
            </Flash>
          )}
          {composition.bmi != null && bmiInfoOpen && (
            <Flash variant="default" className="body-info-flash" sx={{ mb: 3, fontSize: 1 }}>
              <p>
                IMC e relação cintura/altura usam a altura atual do perfil; alturas antigas não são
                armazenadas.
              </p>
              {bmiClassification?.tone === 'neutral' && <p>{bmiClassification.message}</p>}
              {!bmiClassification && (
                <p>Adicione sua data de nascimento no perfil para ver a classificação do IMC.</p>
              )}
              {bmiReferenceRange && (
                <p>
                  Faixa de IMC adequada para sua idade:{' '}
                  {bmiReferenceRange.min.toLocaleString('pt-BR')} a{' '}
                  {bmiReferenceRange.max.toLocaleString('pt-BR')}.
                </p>
              )}
              <p>
                IMC é uma estimativa matemática (peso ÷ altura²) e não mede diretamente gordura
                corporal ou massa muscular. É apenas uma referência de triagem, não uma recomendação
                clínica personalizada — valores de composição corporal variam conforme método e
                protocolo.
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
                  label={`${label} · ${measurementDate(composition.dates[field])}`}
                  value={`${composition[field].toLocaleString('pt-BR', { maximumFractionDigits: 1 })} cm`}
                />
              ) : null
            )}
          </Box>
          <div className="body-chart-controls">
            <div className="metric-tabs" role="group" aria-label="Medida corporal">
              {Object.entries(BODY_METRICS).map(([key, item]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={metric === key}
                  className={metric === key ? 'is-active' : ''}
                  onClick={() => setMetric(key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="metric-tabs" role="group" aria-label="Período da medida">
              {[
                ['month', 'Mês'],
                ['quarter', 'Trimestre'],
                ['year', 'Ano'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={period === key}
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
