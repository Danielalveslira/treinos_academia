import { useRef, useState } from 'react'
import { Flash } from '@primer/react'
import { CommentIcon } from '@primer/octicons-react'
import { useAuth } from '../../hooks/useAuth'
import { setGreetingVoice } from '../../services/greetingPreferencesService'

const VOICE_OPTIONS = [
  {
    value: 'auto',
    label: 'Automático',
    description: 'Usa o que você informou no cadastro; sem essa informação, texto neutro.',
  },
  { value: 'masculino', label: 'Masculino', description: 'Ex.: “Bem-vindo, campeão!”' },
  { value: 'feminino', label: 'Feminino', description: 'Ex.: “Bem-vinda, campeã!”' },
  { value: 'neutro', label: 'Neutro', description: 'Sem marcação de gênero.' },
]

// Preferência só do TEXTO do cabeçalho da Home: não altera cadastro, permissões nem dados de saúde.
// Salva ao escolher (uma RPC, só na troca) e reflete na Home sem recarregar.
export function GreetingVoiceSettings() {
  const { user, profile, offlineLocal, patchProfile } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const saving = useRef(false)
  const current = profile?.greetingVoice ?? 'auto'

  async function choose(value) {
    if (saving.current || value === current || !user) return
    saving.current = true
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const stored = await setGreetingVoice(value)
      patchProfile?.(user.uid, { greetingVoice: stored })
      setSaved(true)
    } catch {
      setError('Não foi possível salvar agora. Tente novamente.')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return (
    <section className="profile-card" aria-labelledby="greeting-voice-heading">
      <header className="profile-card-heading">
        <span className="profile-section-icon">
          <CommentIcon size={20} />
        </span>
        <div>
          <h2 id="greeting-voice-heading">Como prefere as mensagens?</h2>
          <p>Muda só o jeito de falar com você na tela inicial.</p>
        </div>
      </header>
      <div className="profile-form">
        {saved && (
          <Flash variant="success" role="status">
            Preferência salva.
          </Flash>
        )}
        {error && (
          <Flash variant="danger" role="alert">
            {error}
          </Flash>
        )}
        {offlineLocal && (
          <Flash variant="warning">Conecte-se à internet para alterar esta preferência.</Flash>
        )}
        <fieldset className="usage-profile-field" disabled={busy || offlineLocal || !profile}>
          <legend>Estilo das mensagens</legend>
          {VOICE_OPTIONS.map((option) => (
            <label key={option.value} className="usage-profile-option">
              <input
                type="radio"
                name="greetingVoice"
                value={option.value}
                checked={current === option.value}
                onChange={() => choose(option.value)}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    </section>
  )
}
