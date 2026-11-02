import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, FormControl, TextInput, Textarea, Flash } from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { refreshPublicStatistics } from '../services/publicProfilesService'
import { LegalLinks } from '../components/LegalLinks'
import { UsageProfileField } from '../components/UsageProfileField'
import { USAGE_PROFILE_OPTIONS } from '../constants/usageProfile'
import { validateUsername, hasErrors } from '../utils/validators'
import { BIO_MAX_LENGTH } from '../services/usersService'
import { setUsageProfile } from '../services/usageProfileService'
import { ProfileAvatar } from '../components/ProfileAvatar'
import { removeProfileAvatar, uploadProfileAvatar } from '../services/profileAvatarService'
import { describeAccountAccessError } from '../utils/accountAccessErrors'
import { PushNotificationSettings } from '../features/notifications/components/PushNotificationSettings'
import { GREETING_V2_ENABLED } from '../features/greetings/config'
import { GreetingVoiceSettings } from '../features/greetings/GreetingVoiceSettings'
import { RestPreferenceSettings } from '../components/RestPreferenceSettings'
import { ResidenceCitySettings } from '../components/ResidenceCitySettings'
import { restPreferenceSummary } from '../utils/restPreference'

function Setting({ id, title, summary, open, onToggle, children }) {
  return (
    <section className="profile-setting">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-content`}
          onClick={onToggle}
        >
          <span>{title}</span>
          {summary && <small>{summary}</small>}
          <span className="profile-setting-chevron" aria-hidden="true">
            {open ? '⌄' : '›'}
          </span>
        </button>
      </h3>
      <div id={`${id}-content`} hidden={!open} className="profile-setting-content">
        {children}
      </div>
    </section>
  )
}

export default function Profile() {
  const auth = useAuth()
  return <ProfileContent key={auth.user?.uid || 'anonymous'} {...auth} />
}

function ProfileContent({
  user,
  profile: loadedProfile,
  isSuperAdmin,
  saveProfile,
  refreshProfile,
}) {
  const profile = loadedProfile?.id === user?.uid ? loadedProfile : null
  const [draft, setDraft] = useState({})
  const [fieldErrors, setFieldErrors] = useState({})
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const saving = useRef(false)
  const username = draft.username ?? profile?.username ?? ''
  const bio = draft.bio ?? profile?.bio ?? ''
  const shareStatistics = draft.shareStatistics ?? profile?.shareStatistics === true
  const profileChanges = {}
  if (username.trim().toLowerCase() !== (profile?.username || ''))
    profileChanges.username = username
  if (bio.trim() !== (profile?.bio || '')) profileChanges.bio = bio
  const profileDirty = Object.keys(profileChanges).length > 0
  const privacyDirty = profile && shareStatistics !== (profile.shareStatistics === true)
  const [privacyBusy, setPrivacyBusy] = useState(false)
  const [privacyMessage, setPrivacyMessage] = useState('')
  const [privacyError, setPrivacyError] = useState('')
  const [refreshingStats, setRefreshingStats] = useState(false)
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const fileInput = useRef(null)
  const [usageProfileDraft, setUsageProfileDraft] = useState('')
  const [usageProfileBusy, setUsageProfileBusy] = useState(false)
  const [usageProfileError, setUsageProfileError] = useState('')
  const [usageProfileSuccess, setUsageProfileSuccess] = useState(false)
  const usageProfileValue = usageProfileDraft || profile?.usageProfile || ''
  const usageProfileDirty = Boolean(
    usageProfileDraft && usageProfileDraft !== (profile?.usageProfile || '')
  )
  const [expanded, setExpanded] = useState({})
  const [visited, setVisited] = useState({})
  const toggle = (id) => {
    setExpanded((current) => ({ ...current, [id]: !current[id] }))
    setVisited((current) => ({ ...current, [id]: true }))
  }
  const initial = (profile?.username || user?.email || '?')[0].toUpperCase()
  const usageLabel = USAGE_PROFILE_OPTIONS.find(
    (option) => option.value === profile?.usageProfile
  )?.label

  function edit(field, value) {
    setDraft((current) => ({ ...current, [field]: value }))
    setSuccess('')
    setFieldErrors((current) => ({ ...current, [field]: undefined, form: undefined }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (saving.current || !profileDirty || !profile) return
    setSuccess('')
    const errors = validateUsername(username)
    if (bio.trim().length > BIO_MAX_LENGTH) errors.bio = `Máximo de ${BIO_MAX_LENGTH} caracteres`
    setFieldErrors(errors)
    if (hasErrors(errors)) return
    saving.current = true
    setSubmitting(true)
    try {
      await saveProfile(profileChanges)
      setDraft((current) => ({ ...current, username: undefined, bio: undefined }))
      setSuccess('Alterações salvas.')
    } catch (error) {
      if (error.message === 'USERNAME_TAKEN') {
        setFieldErrors({ username: 'Esse nome de usuário já está em uso' })
      } else {
        setFieldErrors({
          form:
            describeAccountAccessError(error.message) ||
            'Não foi possível salvar. Suas alterações foram mantidas. Tente novamente.',
        })
      }
    } finally {
      saving.current = false
      setSubmitting(false)
    }
  }

  async function savePrivacy() {
    if (privacyBusy || !privacyDirty || !profile) return
    setPrivacyBusy(true)
    setPrivacyMessage('')
    setPrivacyError('')
    try {
      await saveProfile({ shareStatistics })
      setDraft((current) => ({ ...current, shareStatistics: undefined }))
      setPrivacyMessage('Preferência salva.')
    } catch (error) {
      setPrivacyError(
        describeAccountAccessError(error.message) || 'Não foi possível salvar a preferência.'
      )
    } finally {
      setPrivacyBusy(false)
    }
  }

  async function refreshStatistics() {
    if (refreshingStats || !profile) return
    setRefreshingStats(true)
    setPrivacyMessage('')
    setPrivacyError('')
    try {
      await refreshPublicStatistics()
      setPrivacyMessage('Estatísticas atualizadas.')
    } catch {
      setPrivacyError('Não foi possível atualizar as estatísticas. Tente novamente.')
    } finally {
      setRefreshingStats(false)
    }
  }

  async function saveAvatar() {
    if (!avatarFile || avatarBusy || !profile) return
    setAvatarBusy(true)
    setAvatarError('')
    try {
      await uploadProfileAvatar(avatarFile)
      await refreshProfile(user.uid)
      setAvatarFile(null)
      if (fileInput.current) fileInput.current.value = ''
      setSuccess('Foto atualizada.')
    } catch (error) {
      setAvatarError(
        error?.message === 'AVATAR_TOO_LARGE'
          ? 'A imagem compactada ultrapassou 1 MB. Escolha outra foto.'
          : describeAccountAccessError(error?.message) || 'Não foi possível atualizar a foto.'
      )
    } finally {
      setAvatarBusy(false)
    }
  }

  async function removeAvatar() {
    if (avatarBusy || !profile || !window.confirm('Remover sua foto de perfil?')) return
    setAvatarBusy(true)
    setAvatarError('')
    try {
      await removeProfileAvatar()
      await refreshProfile(user.uid)
      setSuccess('Foto removida.')
    } catch {
      setAvatarError('Não foi possível remover a foto.')
    } finally {
      setAvatarBusy(false)
    }
  }

  async function saveUsageProfile() {
    if (usageProfileBusy || !usageProfileDirty || !profile) return
    setUsageProfileBusy(true)
    setUsageProfileError('')
    setUsageProfileSuccess(false)
    try {
      await setUsageProfile(usageProfileDraft)
      setUsageProfileDraft('')
      setUsageProfileSuccess(true)
    } catch (error) {
      setUsageProfileError(
        error?.code === 'functions/failed-precondition' && error?.message
          ? error.message
          : 'Não foi possível salvar seu perfil de uso. Tente novamente.'
      )
    } finally {
      setUsageProfileBusy(false)
    }
  }

  return (
    <div className="profile-page profile-editor">
      <header className="profile-page-heading">
        <h1>Meu perfil</h1>
      </header>
      {!profile && (
        <Flash variant="warning" role="alert">
          Não foi possível carregar seu perfil. Recarregue a página para tentar novamente.
        </Flash>
      )}
      <div className="profile-editor-avatar">
        <ProfileAvatar path={profile?.avatarPath} name={initial} className="profile-avatar" />
        <div className="profile-editor-avatar-actions">
          <input
            ref={fileInput}
            id="profile-photo"
            className="profile-visually-hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={avatarBusy || !profile}
            onChange={(event) => {
              setAvatarFile(event.target.files?.[0] || null)
              setAvatarError('')
            }}
          />
          <Button
            type="button"
            disabled={avatarBusy || !profile}
            onClick={() => fileInput.current?.click()}
          >
            Alterar foto
          </Button>
          {profile?.avatarPath && (
            <Button type="button" variant="danger" disabled={avatarBusy} onClick={removeAvatar}>
              Remover foto
            </Button>
          )}
          {avatarFile && (
            <>
              <span className="profile-file-name">{avatarFile.name}</span>
              <Button type="button" loading={avatarBusy} disabled={avatarBusy} onClick={saveAvatar}>
                Salvar foto
              </Button>
            </>
          )}
        </div>
      </div>
      {avatarError && (
        <Flash variant="danger" role="alert">
          {avatarError}
        </Flash>
      )}
      <form className="profile-editor-form" onSubmit={handleSubmit}>
        {success && (
          <Flash variant="success" role="status">
            {success}
          </Flash>
        )}
        {fieldErrors.form && (
          <Flash variant="danger" role="alert">
            {fieldErrors.form}
          </Flash>
        )}
        <FormControl required disabled={submitting || !profile}>
          <FormControl.Label>Nome de usuário</FormControl.Label>
          <TextInput
            leadingVisual="@"
            value={username}
            onChange={(event) => edit('username', event.target.value)}
            placeholder="seu_usuario"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={20}
            block
            sx={{ minHeight: 44, fontSize: 2 }}
          />
          <FormControl.Caption>
            De 3 a 20 letras, números ou _. Sem espaços ou acentos.
          </FormControl.Caption>
          {fieldErrors.username && (
            <FormControl.Validation variant="error">{fieldErrors.username}</FormControl.Validation>
          )}
        </FormControl>
        <FormControl disabled={submitting || !profile}>
          <FormControl.Label>
            Sobre mim <span className="profile-optional">(opcional)</span>
          </FormControl.Label>
          <Textarea
            value={bio}
            onChange={(event) => edit('bio', event.target.value)}
            rows={3}
            maxLength={BIO_MAX_LENGTH}
            block
            sx={{ fontSize: 2, resize: 'vertical', minHeight: 88 }}
          />
          <FormControl.Caption>
            {bio.length}/{BIO_MAX_LENGTH} caracteres
          </FormControl.Caption>
          {fieldErrors.bio && (
            <FormControl.Validation variant="error">{fieldErrors.bio}</FormControl.Validation>
          )}
        </FormControl>
        <div className="profile-editor-actions">
          {user?.uid && <Link to={`/comunidades/perfil/${user.uid}`}>Ver perfil público</Link>}
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={!profileDirty || submitting || !profile}
            sx={{ minHeight: 44 }}
          >
            Salvar alterações
          </Button>
        </div>
        {profileDirty && (
          <p className="profile-pending" role="status">
            Alterações não salvas.
          </p>
        )}
      </form>

      <section className="profile-settings" aria-labelledby="profile-settings-heading">
        <h2 id="profile-settings-heading">Configurações</h2>
        <Setting
          id="privacy"
          title="Privacidade e estatísticas"
          summary={profile ? (profile.shareStatistics ? 'Ativado' : 'Desativado') : undefined}
          open={Boolean(expanded.privacy)}
          onToggle={() => toggle('privacy')}
        >
          <div className="profile-privacy">
            <label className="profile-privacy-toggle">
              <input
                type="checkbox"
                checked={shareStatistics}
                disabled={privacyBusy || !profile}
                onChange={(event) => {
                  edit('shareStatistics', event.target.checked)
                  setPrivacyMessage('')
                  setPrivacyError('')
                }}
              />
              <span>Mostrar minhas estatísticas no perfil público</span>
            </label>
            <p>
              Compartilha apenas o total de registros e séries. E-mail, cargas e histórico detalhado
              permanecem privados.
            </p>
            {privacyDirty && <p role="status">Preferência ainda não salva.</p>}
            {privacyMessage && (
              <Flash variant="success" role="status">
                {privacyMessage}
              </Flash>
            )}
            {privacyError && (
              <Flash variant="danger" role="alert">
                {privacyError}
              </Flash>
            )}
            <div className="profile-setting-actions">
              <Button
                type="button"
                variant="primary"
                loading={privacyBusy}
                disabled={!privacyDirty || privacyBusy}
                onClick={savePrivacy}
              >
                Salvar preferência
              </Button>
              {profile?.shareStatistics && (
                <Button
                  type="button"
                  loading={refreshingStats}
                  disabled={refreshingStats || privacyDirty}
                  onClick={refreshStatistics}
                >
                  Atualizar estatísticas
                </Button>
              )}
            </div>
          </div>
        </Setting>
        <Setting
          id="usage"
          title="Perfil de uso"
          summary={usageLabel || (profile ? 'Não declarado' : undefined)}
          open={Boolean(expanded.usage)}
          onToggle={() => toggle('usage')}
        >
          <p className="profile-setting-help">
            Personaliza opções exibidas. Não altera permissões nem certifica profissionais.
          </p>
          {!profile?.usageProfile && (
            <Flash variant="warning">Escolha um perfil de uso quando quiser.</Flash>
          )}
          {usageProfileSuccess && (
            <Flash variant="success" role="status">
              Perfil de uso salvo.
            </Flash>
          )}
          {usageProfileError && (
            <Flash variant="danger" role="alert">
              {usageProfileError}
            </Flash>
          )}
          <UsageProfileField
            value={usageProfileValue}
            onChange={(value) => {
              setUsageProfileDraft(value)
              setUsageProfileSuccess(false)
              setUsageProfileError('')
            }}
            disabled={usageProfileBusy || !profile}
          />
          {usageProfileDirty && (
            <p className="profile-pending" role="status">
              Alteração não salva.
            </p>
          )}
          <Button
            type="button"
            variant="primary"
            loading={usageProfileBusy}
            disabled={!usageProfileDirty || usageProfileBusy || !profile}
            onClick={saveUsageProfile}
          >
            Salvar perfil de uso
          </Button>
        </Setting>
        <Setting
          id="city"
          title="Cidade onde mora"
          summary={
            profile
              ? profile.residenceMunicipalityCode
                ? 'Informada'
                : 'Não informada'
              : undefined
          }
          open={Boolean(expanded.city)}
          onToggle={() => toggle('city')}
        >
          {/* Montado só ao abrir: o catálogo de municípios (chunk próprio) não é baixado por quem não usa. */}
          {visited.city && <ResidenceCitySettings />}
        </Setting>
        <Setting
          id="rest"
          title="Descanso entre séries"
          summary={profile ? restPreferenceSummary(profile.defaultRestSeconds) : undefined}
          open={Boolean(expanded.rest)}
          onToggle={() => toggle('rest')}
        >
          {visited.rest && <RestPreferenceSettings />}
        </Setting>
        <Setting
          id="push"
          title="Notificações"
          summary="Configurar"
          open={Boolean(expanded.push)}
          onToggle={() => toggle('push')}
        >
          {visited.push && <PushNotificationSettings userId={user?.uid} compact />}
        </Setting>
        {GREETING_V2_ENABLED && (
          <Setting
            id="greeting"
            title="Mensagens da Home"
            summary={
              profile ? (profile.greetingVoice === 'neutro' ? 'Neutro' : 'Automático') : undefined
            }
            open={Boolean(expanded.greeting)}
            onToggle={() => toggle('greeting')}
          >
            {visited.greeting && <GreetingVoiceSettings compact />}
          </Setting>
        )}
        <Setting
          id="account"
          title="Dados da conta"
          summary={
            profile && !expanded.account ? (isSuperAdmin ? 'Superadmin' : 'Usuário') : undefined
          }
          open={Boolean(expanded.account)}
          onToggle={() => toggle('account')}
        >
          <dl className="profile-account-details">
            <div>
              <dt>E-mail</dt>
              <dd>{user?.email || 'Indisponível'}</dd>
            </div>
            <div>
              <dt>Tipo de conta</dt>
              <dd>{profile ? (isSuperAdmin ? 'Superadmin' : 'Usuário') : 'Indisponível'}</dd>
            </div>
          </dl>
        </Setting>
      </section>
      <footer className="profile-editor-footer">
        <LegalLinks />
      </footer>
    </div>
  )
}
