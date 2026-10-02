import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, Flash, Spinner } from '@primer/react'
import { ChevronLeftIcon, ShieldLockIcon } from '@primer/octicons-react'
import { getPublicProfile, getPublicStatistics } from '../services/publicProfilesService'
import { formatDateTime } from '../utils/format'
import { ProfileAvatar } from '../components/ProfileAvatar'

export default function PublicProfile() {
  const { userId } = useParams()
  const [result, setResult] = useState(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const profile = await getPublicProfile(userId)
        let statistics = null
        let statisticsError = false
        if (profile?.shareStatistics) {
          try {
            statistics = await getPublicStatistics(userId)
          } catch {
            statisticsError = true
          }
        }
        if (active) setResult({ userId, attempt, profile, statistics, statisticsError })
      } catch {
        if (active) setResult({ userId, attempt, error: true })
      }
    }
    load()
    return () => {
      active = false
    }
  }, [userId, attempt])
  const ready = result?.userId === userId && result?.attempt === attempt
  return (
    <PublicProfileView ready={ready} result={result} onRetry={() => setAttempt((n) => n + 1)} />
  )
}

// Apresentação pura (sem efeitos/dados): recebe o resultado já carregado -- isolada para ser testada com
// perfil ausente, username/avatar nulos e estatísticas com updatedAt em string ISO (timestamptz do
// Supabase). Nunca assume que o perfil existe: a conta pode ter sido excluída ou nunca ter criado o
// perfil público ("Perfil ainda indisponível"), e username nulo vira "Membro".
export function PublicProfileView({ ready, result, onRetry }) {
  return (
    <div className="profile-page">
      <Link className="profile-back" to="/comunidades">
        <ChevronLeftIcon /> Comunidades
      </Link>
      {!ready ? (
        <Spinner aria-label="Carregando perfil" />
      ) : result.error ? (
        <Flash variant="danger">
          Não foi possível carregar o perfil.{' '}
          <Button onClick={() => onRetry()}>Tentar novamente</Button>
        </Flash>
      ) : !result.profile ? (
        <section className="profile-card profile-empty">
          <h1>Perfil ainda indisponível</h1>
          <p>
            Este membro ainda não ativou o perfil público. Ele será criado no próximo acesso ao app.
          </p>
        </section>
      ) : (
        <>
          <header className="profile-page-heading">
            <span className="profile-eyebrow">NA COMUNIDADE</span>
            <h1>Perfil do membro</h1>
          </header>
          <section className="profile-identity">
            <ProfileAvatar
              path={result.profile.avatarPath}
              name={result.profile.username || 'M'}
              className="profile-avatar"
            />
            <div className="profile-identity-copy">
              <h2>{result.profile.username ? `@${result.profile.username}` : 'Membro'}</h2>
              <p>{result.profile.bio || 'Este membro ainda não adicionou uma descrição.'}</p>
            </div>
          </section>
          <section
            className="profile-card profile-empty"
            aria-labelledby="public-statistics-heading"
          >
            <h2 id="public-statistics-heading">Estatísticas compartilhadas</h2>
            {!result.profile.shareStatistics ? (
              <p>
                <ShieldLockIcon /> Este membro prefere manter suas estatísticas privadas.
              </p>
            ) : result.statisticsError ? (
              <Flash variant="warning">
                Estatísticas indisponíveis. A privacidade pode ter mudado.{' '}
                <Button onClick={() => onRetry()}>Atualizar</Button>
              </Flash>
            ) : !result.statistics ? (
              <p>Nenhum resumo compartilhado ainda.</p>
            ) : (
              <>
                <dl className="profile-statistics">
                  <div>
                    <dt>Registros de exercícios</dt>
                    <dd>{result.statistics.entries.toLocaleString('pt-BR')}</dd>
                  </div>
                  <div>
                    <dt>Séries realizadas</dt>
                    <dd>{result.statistics.sets.toLocaleString('pt-BR')}</dd>
                  </div>
                </dl>
                <p>Atualizado em {formatDateTime(result.statistics.updatedAt)}</p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
