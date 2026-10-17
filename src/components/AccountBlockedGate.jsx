import { Link } from 'react-router-dom'
import { PublicLayout } from './PublicLayout'
import { LogoutButton } from './LogoutButton'
import { formatDateTime } from '../utils/format'
import { toDate } from '../utils/date'

// Tela única para os 4 estados de bloqueio de conta (deleting/disabled/suspended/banned) --
// substitui o antigo DisabledAccountGate.jsx (só cobria 'disabled') para não duplicar a
// mesma estrutura de tela 4 vezes. Regra de negócio: conta bloqueada perde acesso a tudo, exceto
// ver o próprio aviso, abrir chamados de suporte e sair da conta -- por isso o corpo da tela
// nunca tem nada além do aviso + um link para /atendimento + o botão de logout.
// 'deleting' é só um resguardo de UI: no caminho normal (sem bloqueio financeiro),
// AuthContext já encerra a sessão sozinho antes de qualquer tela protegida montar (ver
// checkDeletionStatus) -- isto só cobre a janela entre o status mudar no banco e o logout
// automático resolver, ou um estado de exclusão sem job ativo (não deveria acontecer, mas
// não deixa a pessoa numa tela genérica sem saída se acontecer).
const COPY = {
  deleting: {
    title: 'Conta em exclusão',
    body: () => (
      <p>Sua conta está em processo de exclusão e não pode mais ser usada enquanto isso dura.</p>
    ),
  },
  disabled: {
    title: 'Conta desativada',
    body: ({ reason }) => (
      <p>
        Sua conta foi desativada por um administrador
        {reason ? (
          <>
            : <strong>{reason}</strong>
          </>
        ) : (
          '.'
        )}
      </p>
    ),
  },
  suspended: {
    title: 'Conta suspensa temporariamente',
    body: ({ until }) => (
      <p>
        Sua conta está temporariamente suspensa
        {until ? (
          <>
            {' '}
            até <strong>{formatDateTime(toDate(until))}</strong>
          </>
        ) : (
          '.'
        )}
      </p>
    ),
  },
  banned: {
    title: 'Conta banida',
    body: () => <p>Sua conta foi banida permanentemente por violar as regras da plataforma.</p>,
  },
}

// Regra de negócio: conta banida só pode abrir chamado de contestação ou privacidade (nunca
// denúncia contra terceiros) -- o backend (submit_support_request) ainda NÃO valida essa
// restrição (ver docs/releases, achado J16: ele só impede 'deleting'), então isto é só uma
// conveniência de navegação, não um controle de segurança. Pré-seleciona "appeal" direto no
// link para poupar um clique; qualquer pessoa ainda pode trocar o assunto em /atendimento.
const SUPPORT_HREF = {
  banned: '/atendimento?tipo=appeal',
}

export function AccountBlockedGate({ state, reason, until }) {
  const copy = COPY[state] || COPY.disabled
  const supportHref = SUPPORT_HREF[state] || '/atendimento'
  return (
    <PublicLayout>
      <section className="support-page" aria-labelledby="account-blocked-title">
        <h1 id="account-blocked-title">{copy.title}</h1>
        {copy.body({ reason, until })}
        <p>
          Se acredita que isso é um engano, entre em contato pelo{' '}
          <Link to={supportHref}>atendimento</Link>.
        </p>
        <LogoutButton />
      </section>
    </PublicLayout>
  )
}
