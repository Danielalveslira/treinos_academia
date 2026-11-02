import { useRef, useState } from 'react'
import { Box, Flash, FormControl, Text, TextInput } from '@primer/react'
import { CheckIcon } from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { setDefaultRestSeconds } from '../services/usersService'
import { restSaveErrorText } from '../utils/restPreference'
import {
  configuredRestSeconds,
  formatRestDuration,
  MAX_REST_SECONDS,
  REST_PRESETS,
  resolveRestSeconds,
} from '../utils/restTimer'

const CUSTOM = 'custom'

// "Descanso padrão entre séries": salva sozinho ao escolher (uma RPC por troca, sincronizada com a conta e
// refletida nos outros aparelhos pelo canal do perfil). Vale para exercícios das fichas sem tempo próprio e
// só para as PRÓXIMAS contagens — um descanso já em andamento não muda.
export function RestPreferenceSettings() {
  const { user, profile, offlineLocal, patchProfile } = useAuth()
  const stored = configuredRestSeconds(profile?.defaultRestSeconds)
  const effective = resolveRestSeconds(null, stored)
  const [pending, setPending] = useState(null)
  const [customOpen, setCustomOpen] = useState(() => !REST_PRESETS.includes(effective))
  const [draft, setDraft] = useState(() => String(effective))
  const [status, setStatus] = useState('idle')
  const [errorText, setErrorText] = useState('')
  const saving = useRef(false)
  const shown = pending ?? effective
  const custom = customOpen || !REST_PRESETS.includes(shown)
  const busy = pending !== null

  async function save(value) {
    if (saving.current || !user || !profile) return
    const seconds = configuredRestSeconds(value)
    if (seconds === null) {
      setStatus('invalid')
      return
    }
    if (seconds === stored) {
      // Nada a gravar (ex.: blur logo depois do Enter): mantém o feedback atual, só limpa um erro de valor.
      setStatus((current) => (current === 'invalid' ? 'idle' : current))
      return
    }
    saving.current = true
    setPending(seconds)
    setStatus('saving')
    try {
      const saved = await setDefaultRestSeconds(seconds)
      patchProfile?.(user.uid, { defaultRestSeconds: saved })
      setDraft(String(saved))
      setStatus('saved')
    } catch (error) {
      // A seleção volta para o valor salvo (pending some); nada fica "meio salvo". A causa real vai para o
      // console (código PostgREST/Postgres) e a mensagem não promete o que uma nova tentativa não resolve.
      console.error('[RestPreference] save:', error)
      setErrorText(restSaveErrorText(error))
      setStatus('error')
    } finally {
      saving.current = false
      setPending(null)
    }
  }

  function choose(value) {
    setStatus('idle')
    if (value === CUSTOM) {
      setCustomOpen(true)
      setDraft(String(shown))
      return
    }
    setCustomOpen(false)
    save(value)
  }

  const options = [
    ...REST_PRESETS.map((seconds) => ({
      value: seconds,
      label: formatRestDuration(seconds),
      checked: !custom && shown === seconds,
    })),
    { value: CUSTOM, label: 'Personalizado', checked: custom },
  ]
  const note =
    status === 'saving'
      ? 'Salvando…'
      : status === 'saved'
        ? `Salvo: ${formatRestDuration(effective)}.`
        : 'Vale para exercícios sem tempo próprio na ficha.'

  return (
    <div className="rest-preference">
      {offlineLocal && (
        <Flash variant="warning">Conecte-se à internet para alterar esta preferência.</Flash>
      )}
      <fieldset
        className="rest-preference-field"
        disabled={busy || offlineLocal || !profile}
        aria-describedby="rest-preference-note"
      >
        <legend className="sr-only">Descanso padrão entre séries</legend>
        <Box
          className="rest-preference-options"
          // Colunas definidas pela largura da PRÓPRIA seção (container query em app.css), não da janela:
          // 2 colunas no celular, 4 + Personalizado na linha de baixo, ou 5 iguais quando todas cabem.
          sx={{ display: 'grid', gap: 2 }}
        >
          {options.map((option) => (
            <label
              key={option.value}
              className={`rest-preference-option${option.value === CUSTOM ? ' is-custom' : ''}`}
            >
              <input
                className="rest-preference-input"
                type="radio"
                name="defaultRestSeconds"
                value={option.value}
                checked={option.checked}
                onChange={() => choose(option.value)}
              />
              {option.checked && <CheckIcon size={14} aria-hidden="true" />}
              <span>{option.label}</span>
            </label>
          ))}
        </Box>
      </fieldset>
      {custom && (
        <FormControl disabled={busy || offlineLocal || !profile}>
          <FormControl.Label>Segundos (0 a {MAX_REST_SECONDS})</FormControl.Label>
          <TextInput
            className="rest-preference-seconds"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_REST_SECONDS}
            step={1}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              setStatus('idle')
            }}
            onBlur={() => save(draft)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                save(draft)
              }
            }}
          />
          <FormControl.Caption>0 desativa o descanso. Salva ao sair do campo.</FormControl.Caption>
        </FormControl>
      )}
      {status === 'error' || status === 'invalid' ? (
        <Text
          as="p"
          id="rest-preference-note"
          className="rest-preference-note is-error"
          role="alert"
        >
          {status === 'invalid'
            ? `Informe um número inteiro de 0 a ${MAX_REST_SECONDS} segundos.`
            : errorText}
        </Text>
      ) : (
        <Text as="p" id="rest-preference-note" className="rest-preference-note" role="status">
          {note}
        </Text>
      )}
    </div>
  )
}
