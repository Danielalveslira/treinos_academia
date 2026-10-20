import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from '../components/BrandMark'
import { useAuth } from '../hooks/useAuth'
import { useWallet } from '../hooks/useWallet'
import { listMyEconomyTransactions } from '../services/economyService'
import { economyTransactionAmount, economyTransactionLabel } from '../utils/economyGuide'
import { formatDailyProgress } from '../utils/evocoins'
import './EconomyGuide.css'

const INITIAL_HISTORY_COUNT = 5

export default function EconomyGuide() {
  const { user } = useAuth()
  const { display, loading, error, dailyCoins } = useWallet()
  const [history, setHistory] = useState({ uid: null, rows: null, loading: false, error: false })
  const [showAllHistory, setShowAllHistory] = useState(false)
  const currentHistory =
    history.uid === user?.uid ? history : { rows: null, loading: false, error: false }
  const dailyProgress = formatDailyProgress(dailyCoins)

  async function loadTransactions() {
    if (currentHistory.loading || !user?.uid) return
    const uid = user.uid
    setShowAllHistory(false)
    setHistory({ uid, rows: null, loading: true, error: false })
    try {
      const rows = await listMyEconomyTransactions(uid)
      setHistory((current) =>
        current.uid === uid ? { uid, rows, loading: false, error: false } : current
      )
    } catch {
      setHistory((current) =>
        current.uid === uid ? { uid, rows: null, loading: false, error: true } : current
      )
    }
  }

  function balance(key) {
    if (loading && !display) return 'Carregando…'
    if (!display) return 'Indisponível'
    const value = display[key]
    return value == null || !Number.isFinite(Number(value))
      ? 'Indisponível'
      : Number(value).toLocaleString('pt-BR')
  }

  return (
    <div className="economy-guide profile-page">
      <header className="profile-page-heading">
        <span className="profile-eyebrow">CARTEIRA EVOLUTUS</span>
        <h1>Entenda suas moedas</h1>
        <p>
          EvoCoins reconhecem sua participação. EvoCash é um crédito comprado para promover conteúdo
          no Evolutus.
        </p>
      </header>

      <section className="economy-guide-balances" aria-label="Seus saldos">
        <div>
          <span>EvoCoins</span>
          <strong>{balance('coinBalance')}</strong>
        </div>
        <div>
          <span>EvoCash</span>
          <strong>{balance('cashBalance')}</strong>
        </div>
        <Link to="/perfil">Ver minha carteira</Link>
      </section>
      {dailyProgress && <p className="economy-guide-note">{dailyProgress}</p>}
      {display?.source === 'snapshot' && (
        <p className="economy-guide-note" role="status">
          Saldo salvo neste aparelho. Conecte-se para ver o valor atualizado.
        </p>
      )}
      {error && !display && (
        <p className="economy-guide-note" role="status">
          Não foi possível consultar o saldo agora. Tente novamente mais tarde.
        </p>
      )}

      <section className="economy-guide-grid" aria-label="Entenda a diferença">
        <article className="economy-guide-card economy-guide-coins">
          <div className="economy-guide-card-heading">
            <span className="economy-guide-mark economy-guide-mark-coins">
              <BrandMark size={25} color="var(--fitness-blue)" />
            </span>
            <h2>EvoCoins</h2>
          </div>
          <p>
            Moeda de participação. Você pode recebê-la por atividade qualificada, treinos concluídos
            e contribuições válidas nas comunidades.
          </p>
          <h3>Onde usar?</h3>
          <p>
            Para reagir a publicações e criar ou melhorar comunidades quando houver uma opção em
            EvoCoins disponível.
          </p>
          <p className="economy-guide-fine">
            As recompensas têm limites diários. Cada ação precisa cumprir os critérios para gerar
            crédito. A primeira reação a uma publicação cobra EvoCoins; mudar ou remover a reação
            não devolve o valor.
          </p>
          <Link to="/comunidades/criar">Ver opções para criar comunidade →</Link>
        </article>
        <article className="economy-guide-card economy-guide-cash">
          <div className="economy-guide-card-heading">
            <span className="economy-guide-mark economy-guide-mark-cash">
              <BrandMark size={25} color="var(--fitness-accent)" />
            </span>
            <h2>EvoCash</h2>
          </div>
          <p>
            Crédito interno adquirido em pacotes. O saldo é liberado após a confirmação do
            pagamento.
          </p>
          <h3>Onde usar?</h3>
          <p>
            Para promover suas publicações ou comunidades, conforme os pacotes disponíveis. O preço
            aparece antes da confirmação.
          </p>
          <p className="economy-guide-fine">
            Uma compra pendente não aumenta o saldo. Cancelar uma promoção não devolve o EvoCash
            gasto.
          </p>
          <Link to="/evocash">Ver pacotes de EvoCash →</Link>
        </article>
      </section>

      <section className="economy-guide-section" aria-labelledby="economy-guide-steps">
        <h2 id="economy-guide-steps">Do saldo ao uso</h2>
        <p>Três passos para acompanhar e usar suas moedas.</p>
        <ol className="economy-guide-steps">
          <li>
            <span className="economy-guide-step-number" aria-hidden="true">
              01
            </span>
            <div>
              <strong>Participe</strong>
              <p>
                Conclua treinos e contribua nas <Link to="/comunidades">comunidades</Link> para se
                qualificar a EvoCoins.
              </p>
            </div>
          </li>
          <li>
            <span className="economy-guide-step-number" aria-hidden="true">
              02
            </span>
            <div>
              <strong>Confira o saldo</strong>
              <p>
                Veja seus saldos acima ou na <Link to="/perfil">carteira</Link>. Acompanhe compras
                de EvoCash em <Link to="/evocash">Minhas compras</Link>.
              </p>
            </div>
          </li>
          <li>
            <span className="economy-guide-step-number" aria-hidden="true">
              03
            </span>
            <div>
              <strong>Escolha onde usar</strong>
              <p>
                Use EvoCoins nas ações disponíveis nas comunidades. Para promover conteúdo com
                EvoCash, escolha “Promover” na publicação e acompanhe em{' '}
                <Link to="/minhas-promocoes">Minhas promoções</Link>.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="economy-guide-section" aria-labelledby="economy-guide-history">
        <h2 id="economy-guide-history">Movimentações recentes</h2>
        <p>Entradas e saídas mais recentes da sua conta.</p>
        {currentHistory.rows === null && !currentHistory.error && (
          <button
            type="button"
            className="economy-guide-button"
            onClick={loadTransactions}
            disabled={currentHistory.loading || !user?.uid}
          >
            {currentHistory.loading ? 'Carregando…' : 'Ver movimentações'}
          </button>
        )}
        {currentHistory.error && (
          <p role="alert">
            Não foi possível carregar as movimentações.{' '}
            <button
              type="button"
              className="economy-guide-inline-button"
              onClick={loadTransactions}
            >
              Tentar novamente
            </button>
          </p>
        )}
        {currentHistory.rows?.length === 0 && (
          <p role="status">Nenhuma movimentação registrada ainda.</p>
        )}
        {currentHistory.rows?.length > 0 && (
          <>
            <ul className="economy-guide-history">
              {currentHistory.rows
                .slice(0, showAllHistory ? undefined : INITIAL_HISTORY_COUNT)
                .map((item) => (
                  <li
                    key={item.id}
                    className={`economy-guide-transaction economy-guide-transaction-${item.direction}`}
                  >
                    <span className="economy-guide-transaction-main">
                      <strong>{economyTransactionLabel(item)}</strong>
                      <small>
                        {new Date(item.created_at).toLocaleDateString('pt-BR')} ·{' '}
                        {item.direction === 'credit' ? 'Entrada' : 'Saída'}
                      </small>
                    </span>
                    <b>{economyTransactionAmount(item)}</b>
                  </li>
                ))}
            </ul>
            {currentHistory.rows.length > INITIAL_HISTORY_COUNT && (
              <button
                type="button"
                className="economy-guide-button economy-guide-history-toggle"
                onClick={() => setShowAllHistory((value) => !value)}
                aria-expanded={showAllHistory}
              >
                {showAllHistory
                  ? 'Mostrar menos'
                  : `Ver mais ${currentHistory.rows.length - INITIAL_HISTORY_COUNT} movimentações`}
              </button>
            )}
          </>
        )}
      </section>

      <section className="economy-guide-section" aria-labelledby="economy-guide-faq">
        <h2 id="economy-guide-faq">Dúvidas frequentes</h2>
        <details>
          <summary>Posso trocar EvoCoins por EvoCash?</summary>
          <p>
            Não há opção de troca entre as moedas no aplicativo. Cada uma tem formas próprias de
            obtenção e uso.
          </p>
        </details>
        <details>
          <summary>EvoCash pode ser sacado?</summary>
          <p>
            Não há função de saque no aplicativo. EvoCash é usado nas opções internas disponíveis.
          </p>
        </details>
        <details>
          <summary>Reputação é saldo de EvoCoins?</summary>
          <p>
            Não. Reputação soma os EvoCoins que você já recebeu. O saldo mostra quantos ainda pode
            usar.
          </p>
        </details>
        <details>
          <summary>Por que não recebi EvoCoins por uma atividade?</summary>
          <p>
            As ações precisam cumprir as regras de qualificação e os limites do dia. Uma
            contribuição pendente de validação só é creditada depois de confirmada.
          </p>
        </details>
      </section>
    </div>
  )
}
