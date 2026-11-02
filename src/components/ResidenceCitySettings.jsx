import { useRef, useState } from 'react'
import { Button, Flash } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { setResidenceMunicipality } from '../services/usersService'
import { CitySelector } from './CitySelector'
import { residenceCitySaveErrorText } from '../utils/registrationErrors'

// "Cidade onde mora" em Meu Perfil. Dado PRIVADO: não aparece no perfil público nem é compartilhado
// com outros usuários (só o próprio usuário lê a coluna -- policy users_select). Contas antigas sem
// cidade não são bloqueadas: o campo só é sugerido aqui. Salvar é explícito (botão), e uma falha
// mantém a cidade salva anteriormente -- o perfil em memória só muda depois da confirmação do servidor.
export function ResidenceCitySettings() {
  const { user, profile, offlineLocal, patchProfile } = useAuth()
  const saved = profile?.residenceMunicipalityCode ?? null
  // undefined = sem edição (mostra a salva); null = campo limpo / texto sem seleção; número = escolha.
  const [draft, setDraft] = useState(undefined)
  const [status, setStatus] = useState('idle')
  const [errorText, setErrorText] = useState('')
  // Recria o seletor ao cancelar/salvar, descartando texto digitado que não virou seleção.
  const [resetKey, setResetKey] = useState(0)
  const saving = useRef(false)
  const value = draft === undefined ? saved : draft
  const dirty = draft !== undefined && draft !== saved
  const busy = status === 'saving'

  async function save() {
    if (saving.current || !user || !profile || !dirty) return
    if (draft == null) {
      setStatus('error')
      setErrorText('Selecione a cidade onde você mora na lista de sugestões.')
      return
    }
    saving.current = true
    setStatus('saving')
    setErrorText('')
    try {
      const code = await setResidenceMunicipality(draft)
      patchProfile?.(user.uid, { residenceMunicipalityCode: code })
      setDraft(undefined)
      setResetKey((n) => n + 1)
      setStatus('saved')
    } catch (error) {
      console.error('[ResidenceCity] save:', error)
      setErrorText(residenceCitySaveErrorText(error))
      setStatus('error')
    } finally {
      saving.current = false
    }
  }

  return (
    <div className="profile-city">
      <p className="profile-setting-help">
        Usada só para personalizar o Evolutus para a sua região. Não aparece no seu perfil público e
        não é compartilhada com outros usuários.
      </p>
      {offlineLocal && (
        <Flash variant="warning">Conecte-se à internet para alterar sua cidade.</Flash>
      )}
      {profile && saved == null && draft === undefined && (
        <Flash variant="warning">Você ainda não informou sua cidade. Informe quando quiser.</Flash>
      )}
      {status === 'saved' && (
        <Flash variant="success" role="status">
          Cidade salva.
        </Flash>
      )}
      {status === 'error' && errorText && (
        <Flash variant="danger" role="alert">
          {errorText}
        </Flash>
      )}
      <CitySelector
        key={resetKey}
        value={value}
        onChange={(code) => {
          setDraft(code)
          setStatus('idle')
          setErrorText('')
        }}
        disabled={busy || offlineLocal || !profile}
        required={false}
        caption="Selecione sua cidade. Não precisamos do seu endereço."
      />
      {dirty && (
        <p className="profile-pending" role="status">
          Alteração não salva.
        </p>
      )}
      <div className="profile-city-actions">
        <Button
          type="button"
          variant="primary"
          loading={busy}
          disabled={!dirty || busy || offlineLocal || !profile}
          onClick={save}
        >
          Salvar cidade
        </Button>
        {dirty && (
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setDraft(undefined)
              setResetKey((n) => n + 1)
              setStatus('idle')
              setErrorText('')
            }}
          >
            Cancelar
          </Button>
        )}
      </div>
    </div>
  )
}
