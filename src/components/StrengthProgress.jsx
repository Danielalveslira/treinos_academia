import { useEffect, useMemo, useState } from 'react'
import { Box, Heading, Select, Text } from '@primer/react'
import {
  buildStrengthWeeklySeries,
  getStrengthExerciseIds,
  summarizeExerciseStrength,
} from '../utils/progress'
import { IndicatorCard } from './IndicatorCard'
import { StrengthProgressChart } from './StrengthProgressChart'

function kg(value) {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`
}

export function StrengthProgress({ days, exerciseNames }) {
  const exerciseIds = useMemo(() => getStrengthExerciseIds(days), [days])
  const [exerciseId, setExerciseId] = useState('')

  useEffect(() => {
    if (!exerciseIds.includes(exerciseId)) setExerciseId(exerciseIds[0] || '')
  }, [exerciseId, exerciseIds])

  const summary = useMemo(
    () => summarizeExerciseStrength(days, exerciseId),
    [days, exerciseId]
  )
  const series = useMemo(
    () => buildStrengthWeeklySeries(days, exerciseId),
    [days, exerciseId]
  )

  return (
    <section className="progress-section" aria-labelledby="strength-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">FORÇA</span>
          <Heading as="h2" id="strength-title">Evolução por exercício</Heading>
        </div>
        {exerciseIds.length > 0 && (
          <Select
            aria-label="Exercício para análise de força"
            value={exerciseId}
            onChange={(event) => setExerciseId(event.target.value)}
          >
            {exerciseIds.map((id) => (
              <Select.Option key={id} value={id}>{exerciseNames.get(id) || 'Exercício'}</Select.Option>
            ))}
          </Select>
        )}
      </div>

      {!exerciseIds.length ? (
        <Text sx={{ color: 'fg.muted' }}>Sem séries de força neste período.</Text>
      ) : (
        <>
          <Box className="stats-grid strength-stats-grid">
            <IndicatorCard
              label="Carga recente"
              value={summary.recentWeightKg ? `${kg(summary.recentWeightKg)} × ${summary.recentReps} reps` : 'Sem carga registrada'}
            />
            <IndicatorCard
              label="Melhor carga"
              value={summary.bestWeightKg ? `${kg(summary.bestWeightKg)} × ${summary.reps} reps` : 'Sem carga registrada'}
            />
            <IndicatorCard
              label="Melhor série"
              value={summary.bestSetVolumeKg ? kg(summary.bestSetVolumeKg) : 'Sem carga registrada'}
            />
            <IndicatorCard
              label="1RM estimado"
              value={summary.estimated1RMKg ? kg(summary.estimated1RMKg) : 'Sem estimativa válida'}
            />
          </Box>
          <Text as="p" sx={{ color: 'fg.muted', fontSize: 1 }}>
            1RM é uma estimativa pela fórmula de Epley, calculada apenas com séries de 1 a 12 repetições e carga maior que zero.
          </Text>
          {series.some((point) => point.maxWeightKg > 0) ? (
            <StrengthProgressChart data={series} showEstimate={summary.estimated1RMKg > 0} />
          ) : (
            <Text sx={{ color: 'fg.muted' }}>
              Há séries registradas, mas sem carga disponível para calcular evolução.
            </Text>
          )}
        </>
      )}
    </section>
  )
}
