import { memo, useId, useState } from 'react'
import {
  Box,
  Button,
  Flash,
  FormControl,
  Heading,
  IconButton,
  Text,
  Textarea,
  TextInput,
} from '@primer/react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  TrashIcon,
} from '@primer/octicons-react'
import { prescription, SHEET_LIMITS } from './workoutSheetValidation.js'
const fields = [
  ['target_sets', 'Séries-alvo', 1, SHEET_LIMITS.sets],
  ['reps_min', 'Repetições mínimas', 1, 1000],
  ['reps_max', 'Repetições máximas', 1, 1000],
  ['rest_seconds', 'Descanso (segundos)', 0, 900],
  ['target_duration_minutes', 'Duração (minutos)', 1, SHEET_LIMITS.duration],
  ['target_distance_km', 'Distância (km)', 0.001, SHEET_LIMITS.distance],
]
export const WorkoutSheetItemEditor = memo(function WorkoutSheetItemEditor({
  item,
  index,
  total,
  disabled,
  onPatch,
  onMove,
  onRemove,
}) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const name = item.exercise?.name || 'Exercício indisponível'
  return (
    <Box
      as="li"
      data-sheet-item
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        p: 3,
        minWidth: 0,
        bg: 'canvas.default',
      }}
    >
      <Heading as="h3" sx={{ fontSize: 1, m: 0, overflowWrap: 'anywhere' }}>
        {index + 1}. {name}
      </Heading>
      {prescription(item) && (
        <Text
          as="p"
          sx={{ fontSize: 0, color: 'fg.muted', mt: 1, mb: 2, overflowWrap: 'anywhere' }}
        >
          {prescription(item)}
        </Text>
      )}
      {item.available === false && (
        <Flash variant="warning" sx={{ my: 2 }}>
          Indisponível: substitua antes de iniciar novos treinos.
        </Flash>
      )}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1,
          mt: 2,
        }}
      >
        <Button
          type="button"
          variant="invisible"
          size="small"
          trailingAction={expanded ? ChevronUpIcon : ChevronDownIcon}
          aria-label={`Editar metas de ${name}`}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((value) => !value)}
        >
          Metas opcionais
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <IconButton
            type="button"
            icon={ArrowUpIcon}
            aria-label={`Subir ${name}`}
            variant="invisible"
            disabled={disabled || index === 0}
            sx={{ minWidth: 44, minHeight: 44 }}
            onClick={() => onMove(index, -1)}
          />
          <IconButton
            type="button"
            icon={ArrowDownIcon}
            aria-label={`Descer ${name}`}
            variant="invisible"
            disabled={disabled || index === total - 1}
            sx={{ minWidth: 44, minHeight: 44 }}
            onClick={() => onMove(index, 1)}
          />
          <IconButton
            type="button"
            icon={TrashIcon}
            aria-label={`Remover ${name} da ficha`}
            variant="invisible"
            disabled={disabled}
            sx={{ minWidth: 44, minHeight: 44 }}
            onClick={() => onRemove(item.exercise_id)}
          />
        </Box>
      </Box>
      {expanded && (
        <Box
          id={panelId}
          role="region"
          aria-label={`Metas de ${name}`}
          sx={{
            display: 'grid',
            gridTemplateColumns: ['minmax(0, 1fr)', 'repeat(2, minmax(0, 1fr))'],
            gap: 3,
            pt: 3,
            mt: 2,
            borderTop: '1px solid',
            borderColor: 'border.muted',
          }}
        >
          {fields
            .filter(([key]) =>
              item.exercise?.type === 'cardio'
                ? !['target_sets', 'reps_min', 'reps_max'].includes(key)
                : !key.startsWith('target_d')
            )
            .map(([key, label, min, max]) => (
              <FormControl key={key} disabled={disabled}>
                <FormControl.Label>{label}</FormControl.Label>
                <TextInput
                  type="number"
                  block
                  min={min}
                  max={max}
                  step={key === 'target_distance_km' ? '0.001' : 1}
                  value={item[key] ?? ''}
                  onChange={(event) => onPatch(item.exercise_id, key, event.target.value)}
                />
              </FormControl>
            ))}
          <FormControl disabled={disabled} sx={{ gridColumn: '1 / -1' }}>
            <FormControl.Label>Observação pessoal</FormControl.Label>
            <Textarea
              block
              rows={2}
              resize="vertical"
              maxLength={300}
              value={item.note || ''}
              onChange={(event) => onPatch(item.exercise_id, 'note', event.target.value)}
            />
          </FormControl>
        </Box>
      )}
    </Box>
  )
})
