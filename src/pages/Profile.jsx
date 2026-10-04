import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { refreshPublicStatistics } from '../services/publicProfilesService'
import { Button, FormControl, TextInput, Textarea, Flash, Label } from '@primer/react'
import {
  PersonIcon,
  ShieldLockIcon,
  CalendarIcon,
  MailIcon,
  CheckIcon,
  BriefcaseIcon,
} from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { LegalLinks } from '../components/LegalLinks'
import { WalletCard } from '../components/WalletCard'
import { UsageProfileField } from '../components/UsageProfileField'
import { formatDate } from '../utils/format'
import { validateUsername, hasErrors } from '../utils/validators'
import { BIO_MAX_LENGTH } from '../services/usersService'
import { setUsageProfile } from '../services/usageProfileService'
import { toDate } from '../utils/date'
import { ProfileAvatar } from '../components/ProfileAvatar'
import { removeProfileAvatar, uploadProfileAvatar } from '../services/profileAvatarService'
import { PushNotificationSettings } from '../features/notifications/components/PushNotificationSettings'

export default function Profile() {
  const { user, profile, isSuperAdmin, saveProfile, refreshProfile } = useAuth()
  const [draft, setDraft] = useState({})
  const [fieldErrors, setFieldErrors] = useState({})
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const saving = useRef(false)
  const username = draft.username ?? profile?.username ?? ''
  const bio = draft.bio ?? profile?.bio ?? ''
  const shareStatistics = draft.shareStatistics ?? profile?.shareStatistics ?? false
  const [refreshingStats, setRefreshingStats] = useState(false)
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [usageProfileDraft, setUsageProfileDraft] = useState('')
  const [usageProfileBusy, setUsageProfileBusy] = useState(false)
  const [usageProfileError, setUsageProfileError] = useState('')
  const [usageProfileSuccess, setUsageProfileSuccess] = useState(false)
  const usageProfileValue = usageProfileDraft || profile?.usageProfile || ''
  const usageProfileDirty = usageProfileDraft && usageProfileDraft !== (profile?.usageProfile || '')
  const changes = {}
  if (shareStatistics !== (profile?.shareStatistics === true))
    changes.shareStatistics = shareStatistics
  if (username.trim().toLowerCase() !== (profile?.username || '')) changes.username = username
  if (bio.trim() !== (profile?.bio || '')) changes.bio = bio
  const dirty = Object.keys(changes).length > 0

  async function refreshStatistics() {
    if (saving.current) return
    saving.current = true
    setFieldErrors({})
    setRefreshingStats(true)
    setSuccess(false)
    try {
      await refreshPublicStatistics()
      setSuccess('Estatísticas atualizadas.')
    } catch {
      setFieldErrors({ form: 'Não foi possível atualizar as estatísticas. Tente novamente.' })
    } finally {
      saving.current = false
      setRefreshingStats(false)
    }
  }

  function edit(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }))
    setSuccess(false)
    setFieldErrors((prev) => ({ ...prev, [field]: undefined, form: undefined }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (saving.current || !dirty || !profile) return
    setSuccess(false)
    const errors = validateUsername(username)
    if (bio.trim().length > BIO_MAX_LENGTH) errors.bio = `Máximo de ${BIO_MAX_LENGTH} caracteres`
    setFieldErrors(errors)
    if (hasErrors(errors)) return
    saving.current = true
    setSubmitting(true)
    try {
      await saveProfile(changes)
      setDraft({})
      setSuccess('Perfil salvo com sucesso.')
    } catch (err) {
      if (err.message === 'USERNAME_TAKEN') {
        setFieldErrors({ username: 'Esse nome de usuário já está em uso' })
      } else {
        console.error('[Profile] save:', err)
        setFieldErrors({
          form: 'Não foi possível salvar. Suas alterações foram mantidas. Tente novamente.',
        })
      }
    } finally {
      saving.current = false
      setSubmitting(false)
    }
  }

  const initial = (profile?.username || user?.email || '?')[0].toUpperCase()
  const memberSince = toDate(profile?.createdAt)

  async function saveAvatar() {
    if (!avatarFile || avatarBusy) return
    setAvatarBusy(true)
    setAvatarError('')
    try {
      await uploadProfileAvatar(avatarFile)
      await refreshProfile(user.uid)
      setAvatarFile(null)
      setSuccess('Foto de perfil atualizada.')
    } catch (error) {
      setAvatarError(
        error?.message === 'AVATAR_TOO_LARGE'
          ? 'A imagem compactada ultrapassou 1 MB. Escolha outra foto.'
          : 'Não foi possível atualizar a foto.'
      )
    } finally {
      setAvatarBusy(false)
    }
  }

  async function removeAvatar() {
    if (avatarBusy || !window.confirm('Remover sua foto de perfil?')) return
    setAvatarBusy(true)
    setAvatarError('')
    try {
      await removeProfileAvatar()
      await refreshProfile(user.uid)
      setSuccess('Foto de perfil removida.')
    } catch {
      setAvatarError('Não foi possível remover a foto.')
    } finally {
      setAvatarBusy(false)
    }
  }

  // O AuthContext mantém um listener ao vivo em users/{uid} -- profile.usageProfile já
  // reflete o novo valor assim que a Cloud Function grava, sem precisar de
  // refreshProfile aqui. Ao mudar para "comum" com uma vitrine ainda ativa, o próprio
  // servidor recusa com uma mensagem explicando o que fazer (ver usage-profile-service.js).
  async function saveUsageProfile() {
    if (usageProfileBusy || !usageProfileDirty) return
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
    <div className="profile-page">
      <header className="profile-page-heading">
        <span className="profile-eyebrow">SUA CONTA</span>
        <h1>Meu perfil</h1>
        <p>Seu espaço, do seu jeito.</p>
      </header>

      <section className="profile-identity" aria-label="Resumo do perfil">
        <ProfileAvatar path={profile?.avatarPath} name={initial} className="profile-avatar" />
        <div className="profile-identity-copy">
          <h2>{profile?.username ? `@${profile.username}` : 'Vamos apresentar você?'}</h2>
          <p>{profile?.bio || 'Adicione uma descrição e conte um pouco sobre você.'}</p>
          <div className="profile-meta">
            {memberSince && (
              <span>
                <CalendarIcon size={14} /> Membro desde {formatDate(memberSince)}
              </span>
            )}
            {isSuperAdmin && (
              <Label variant="accent">
                <ShieldLockIcon size={12} /> Superadmin
              </Label>
            )}
          </div>
        </div>
      </section>

      <div className="profile-grid">
        <section className="profile-card" aria-labelledby="edit-profile-heading">
          <header className="profile-card-heading">
            <span className="profile-section-icon">
              <PersonIcon size={20} />
            </span>
            <div>
              <h2 id="edit-profile-heading">Sobre você</h2>
              <p>Como você aparece nas comunidades.</p>
            </div>
          </header>
          <form onSubmit={handleSubmit} className="profile-form">
            {success && (
              <Flash variant="success" role="status">
                <CheckIcon /> {success}
              </Flash>
            )}
            {fieldErrors.form && (
              <Flash variant="danger" role="alert">
                {fieldErrors.form}
              </Flash>
            )}
            {!profile && (
              <Flash variant="warning">
                Não foi possível carregar seu perfil. Recarregue a página para tentar novamente.
              </Flash>
            )}
            <div className="profile-avatar-control">
              <div>
                <strong>Foto de perfil</strong>
                <p>JPEG, PNG, WebP ou GIF. A imagem é convertida para WebP e limitada a 1 MB.</p>
              </div>
              {avatarError && <Flash variant="danger">{avatarError}</Flash>}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={avatarBusy || !profile}
                onChange={(event) => setAvatarFile(event.target.files?.[0] || null)}
              />
              <div>
                <Button
                  type="button"
                  onClick={saveAvatar}
                  loading={avatarBusy && Boolean(avatarFile)}
                  disabled={!avatarFile || avatarBusy}
                >
                  Enviar foto
                </Button>
                {profile?.avatarPath && (
                  <Button
                    type="button"
                    variant="danger"
                    onClick={removeAvatar}
                    disabled={avatarBusy}
                  >
                    Remover foto
                  </Button>
                )}
              </div>
            </div>
            <FormControl required disabled={submitting || !profile}>
              <FormControl.Label>Nome de usuário</FormControl.Label>
              <TextInput
                leadingVisual="@"
                value={username}
                onChange={(e) => edit('username', e.target.value)}
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
                <FormControl.Validation variant="error">
                  {fieldErrors.username}
                </FormControl.Validation>
              )}
            </FormControl>
            <FormControl disabled={submitting || !profile}>
              <FormControl.Label>
                Descrição <span className="profile-optional">(opcional)</span>
              </FormControl.Label>
              <Textarea
                value={bio}
                onChange={(e) => edit('bio', e.target.value)}
                placeholder="O que motiva você a treinar?"
                rows={4}
                maxLength={BIO_MAX_LENGTH}
                block
                sx={{ fontSize: 2, resize: 'vertical', minHeight: 112 }}
              />
              <FormControl.Caption>
                {bio.length}/{BIO_MAX_LENGTH} caracteres
              </FormControl.Caption>
              {fieldErrors.bio && (
                <FormControl.Validation variant="error">{fieldErrors.bio}</FormControl.Validation>
              )}
            </FormControl>
            <div className="profile-privacy">
              <label className="profile-privacy-toggle">
                <input
                  type="checkbox"
                  checked={shareStatistics}
                  disabled={submitting || refreshingStats || !profile}
                  onChange={(e) => edit('shareStatistics', e.target.checked)}
                />
                <span>Mostrar minhas estatísticas no perfil público</span>
              </label>
              <p>
                Compartilha apenas o total de registros e séries. Seu e-mail, cargas e histórico
                detalhado continuam privados.
              </p>
              {profile?.shareStatistics && (
                <>
                  <p>
                    O resumo é atualizado ao ativar esta opção. Atualize quando quiser compartilhar
                    seus novos totais.
                  </p>
                  <Button
                    type="button"
                    onClick={refreshStatistics}
                    loading={refreshingStats}
                    disabled={dirty || submitting || refreshingStats}
                  >
                    Atualizar estatísticas
                  </Button>
                </>
              )}
              <Link to={`/comunidades/perfil/${user.uid}`}>Ver meu perfil público</Link>
            </div>
            <div className="profile-form-footer">
              <span>
                {submitting
                  ? 'Salvando seu perfil…'
                  : dirty
                    ? 'Você tem alterações para salvar.'
                    : 'Tudo em dia por aqui.'}
              </span>
              <Button
                type="submit"
                variant="primary"
                loading={submitting}
                disabled={!dirty || submitting || refreshingStats || !profile}
                sx={{ minHeight: 44 }}
              >
                Salvar alterações
              </Button>
            </div>
          </form>
        </section>
        <aside className="profile-card profile-account" aria-labelledby="account-heading">
          <header className="profile-card-heading">
            <span className="profile-section-icon">
              <ShieldLockIcon size={20} />
            </span>
            <div>
              <h2 id="account-heading">Dados da conta</h2>
              <p>Suas informações de acesso.</p>
            </div>
          </header>
          <dl className="profile-account-details">
            <div>
              <dt>
                <MailIcon size={16} /> E-mail
              </dt>
              <dd>{user?.email}</dd>
            </div>
            <div>
              <dt>
                <PersonIcon size={16} /> Tipo de conta
              </dt>
              <dd>{isSuperAdmin ? 'Superadmin' : 'Usuário'}</dd>
            </div>
          </dl>
          <WalletCard />
          <LegalLinks />
        </aside>
        <section className="profile-card" aria-labelledby="usage-profile-heading">
          <header className="profile-card-heading">
            <span className="profile-section-icon">
              <BriefcaseIcon size={20} />
            </span>
            <div>
              <h2 id="usage-profile-heading">Perfil de uso</h2>
              <p>
                Personaliza as opções exibidas para você. Não é uma certificação
                profissional nem altera suas permissões.
              </p>
            </div>
          </header>
          <div className="profile-form">
            {usageProfileSuccess && (
              <Flash variant="success" role="status">
                <CheckIcon /> Perfil de uso salvo.
              </Flash>
            )}
            {usageProfileError && (
              <Flash variant="danger" role="alert">
                {usageProfileError}
              </Flash>
            )}
            {!profile?.usageProfile && (
              <Flash variant="warning">
                Sua conta ainda não declarou um perfil de uso. Escolha uma opção abaixo
                quando quiser.
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
            <div className="profile-form-footer">
              <span>
                {usageProfileBusy
                  ? 'Salvando…'
                  : usageProfileDirty
                    ? 'Você tem uma alteração para salvar.'
                    : 'Tudo em dia por aqui.'}
              </span>
              <Button
                type="button"
                variant="primary"
                loading={usageProfileBusy}
                disabled={!usageProfileDirty || usageProfileBusy || !profile}
                onClick={saveUsageProfile}
                sx={{ minHeight: 44 }}
              >
                Salvar perfil de uso
              </Button>
            </div>
          </div>
        </section>
        <PushNotificationSettings />
      </div>
    </div>
  )
}
