import { memo, useEffect, useId, useRef, useState } from 'react'
import {
  Box,
  Button,
  Flash,
  FormControl,
  Heading,
  IconButton,
  SegmentedControl,
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
import { incompatibleTargetFields, prescription, SHEET_LIMITS } from './workoutSheetValidation.js'
import { formatRestDuration, resolveRestSeconds } from '../../utils/restTimer.js'
const fields = [
  ['target_sets', 'Séries-alvo', 1, SHEET_LIMITS.sets],
  ['reps_min', 'Repetições mínimas', 1, 1000],
  ['reps_max', 'Repetições máximas', 1, 1000],
  ['rest_seconds', 'Descanso (segundos)', 0, 900],
  ['target_duration_minutes', 'Duração (minutos)', 1, SHEET_LIMITS.duration],
  ['target_distance_km', 'Distância (km)', 0.001, SHEET_LIMITS.distance],
]
// Descanso de um exercício de força: herda o padrão do usuário (rest_seconds nulo) ou tem tempo próprio
// (qualquer número, inclusive 0 = sem descanso). Vazio no modo específico volta a herdar ao salvar.
function RestField({ item, name, disabled, defaultRestSeconds, invalid, onPatch }) {
  const inputId = useId()
  const usesDefault = item.rest_seconds == null
  const effectiveDefault = resolveRestSeconds(null, defaultRestSeconds)
  const defaultLabel = formatRestDuration(effectiveDefault)
  return (
    <Box sx={{ gridColumn: '1 / -1', display: 'grid', gap: 2 }}>
      <Text as="span" sx={{ fontSize: 1, fontWeight: 'semibold' }}>
        Descanso entre séries
      </Text>
      <SegmentedControl
        aria-label={`Descanso de ${name}`}
        fullWidth
        // Mesma altura do seletor Biblioteca/Catálogo: .workout-sheets button força 44px de toque.
        sx={{ height: 44 }}
        onChange={(selected) => {
          if (selected === 0 && !usesDefault) onPatch(item.exercise_id, 'rest_seconds', null)
          if (selected === 1 && usesDefault)
            onPatch(item.exercise_id, 'rest_seconds', String(effectiveDefault))
        }}
      >
        <SegmentedControl.Button selected={usesDefault} disabled={disabled}>
          Usar meu padrão
        </SegmentedControl.Button>
        <SegmentedControl.Button selected={!usesDefault} disabled={disabled}>
          Tempo específico
        </SegmentedControl.Button>
      </SegmentedControl>
      {usesDefault ? (
        <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', m: 0 }}>
          {`Usando ${defaultLabel}, o padrão definido no seu Perfil.`}
        </Text>
      ) : (
        <FormControl disabled={disabled} id={inputId}>
          <FormControl.Label>Descanso (segundos)</FormControl.Label>
          <TextInput
            type="number"
            inputMode="numeric"
            block
            min={0}
            max={900}
            step={1}
            value={item.rest_seconds ?? ''}
            onChange={(event) => onPatch(item.exercise_id, 'rest_seconds', event.target.value)}
          />
          <FormControl.Caption>
            0 desativa o descanso. Vazio volta para o seu padrão.
          </FormControl.Caption>
          {invalid && (
            <FormControl.Validation variant="error">
              Valor fora do intervalo permitido (0 a 900 segundos).
            </FormControl.Validation>
          )}
        </FormControl>
      )}
    </Box>
  )
}
export const WorkoutSheetItemEditor = memo(function WorkoutSheetItemEditor({
  item,
  index,
  total,
  disabled,
  defaultRestSeconds = null,
  focusField = null,
  onPatch,
  onClearIncompatible,
  onMove,
  onRemove,
}) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const containerRef = useRef(null)
  const name = item.exercise?.name || 'Exercício indisponível'
  const cardio = item.exercise?.type === 'cardio'
  const incompatible = incompatibleTargetFields(item)
  const [confirmClear, setConfirmClear] = useState(false)
  // O cronômetro de descanso só existe entre séries: cardio mantém o campo numérico de antes.
  const summary = prescription(item, cardio ? {} : { defaultRestSeconds })
  // 5.3 (auditoria 2026-11-10): ao salvar com uma meta inválida, abre a seção automaticamente e
  // foca/rola o campo certo -- em duas renderizações (abrir primeiro, só então o campo existe no
  // DOM pra focar), por isso dois efeitos nesta MESMA ficha: o 2º reage à própria mudança de
  // `expanded` desta ficha, nunca corre antes do campo existir.
  useEffect(() => {
    if (focusField) setExpanded(true)
  }, [focusField])
  useEffect(() => {
    if (!focusField || !expanded) return
    const invalid = containerRef.current?.querySelector('[aria-invalid="true"]')
    if (invalid) {
      invalid.focus({ preventScroll: true })
      invalid.scrollIntoView?.({ block: 'center' })
    }
  }, [focusField, expanded])
  return (
    <Box
      as="li"
      ref={containerRef}
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
      {summary && (
        <Text
          as="p"
          sx={{ fontSize: 0, color: 'fg.muted', mt: 1, mb: 2, overflowWrap: 'anywhere' }}
        >
          {summary}
        </Text>
      )}
      {item.available === false && (
        <Flash variant="warning" sx={{ my: 2 }}>
          Indisponível: substitua antes de iniciar novos treinos.
        </Flash>
      )}
      {incompatible.length > 0 && (
        <Flash variant="warning" sx={{ my: 2 }}>
          A categoria deste exercício foi atualizada. Revise suas metas para continuar utilizando
          esta ficha.
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 2 }}>
            {confirmClear ? (
              <>
                <Button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onClearIncompatible(item.exercise_id)
                    setConfirmClear(false)
                  }}
                >
                  Confirmar remoção
                </Button>
                <Button type="button" onClick={() => setConfirmClear(false)}>
                  Cancelar
                </Button>
              </>
            ) : (
              <Button type="button" disabled={disabled} onClick={() => setConfirmClear(true)}>
                Remover metas incompatíveis
              </Button>
            )}
          </Box>
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
              cardio
                ? !['target_sets', 'reps_min', 'reps_max'].includes(key)
                : !key.startsWith('target_d') && key !== 'rest_seconds'
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
                {focusField === key && (
                  <FormControl.Validation variant="error">
                    Valor fora do intervalo permitido.
                  </FormControl.Validation>
                )}
              </FormControl>
            ))}
          {!cardio && (
            <RestField
              item={item}
              name={name}
              disabled={disabled}
              defaultRestSeconds={defaultRestSeconds}
              invalid={focusField === 'rest_seconds'}
              onPatch={onPatch}
            />
          )}
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
            {focusField === 'note' && (
              <FormControl.Validation variant="error">
                A observação deve ter até 300 caracteres.
              </FormControl.Validation>
            )}
          </FormControl>
        </Box>
      )}
    </Box>
  )
})
