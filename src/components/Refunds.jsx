import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  Flash,
  FormControl,
  Select,
  Spinner,
  Text,
  Textarea,
  TextInput,
} from '@primer/react'
import {
  getRefundPolicy,
  getRefundBalance,
  listRefundEvents,
  getRefundSource,
  createRefundRequest,
  listRefundRequests,
  getRefundRequest,
  actOnRefundRequest,
} from '../services/refundService'
import { formatCentavosBRL } from '../utils/format'
import './Refunds.css'
import { reauthenticatePricingAdmin } from '../services/evocashPricingService'
import {
  refundCategories,
  refundStates,
  refundDate,
  refundError,
  withdrawalRemaining,
  withdrawalRemainingLabel,
  publicRefundPolicy,
} from '../utils/refunds'

export function RefundPolicyNotice({ snapshot, purchase = false }) {
  const [fetchedPolicy, setPolicy] = useState(null)
  const policy = snapshot || fetchedPolicy
  useEffect(() => {
    let active = true
    if (snapshot) return
    getRefundPolicy()
      .then((p) => active && setPolicy(p))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [snapshot])
  return (
    <Box sx={{ my: 3, fontSize: 1 }}>
      <Text as="p">
        {purchase
          ? 'Você pode solicitar reembolso por arrependimento em até 7 dias, quando aplicável. Após esse prazo, continuam disponíveis solicitações por cobranças indevidas ou falhas no serviço.'
          : 'Arrependimento e reembolso: quando aplicável, até 7 dias conforme o marco legal e a data-limite da aquisição. Outros direitos continuam disponíveis após esse prazo. A duração comercial por dias é independente.'}
      </Text>
      <details>
        <summary>{purchase ? 'Como funciona o reembolso?' : 'Arrependimento e reembolso'}</summary>
        {purchase && (
          <Text as="p">
            Solicite o reembolso pelo aplicativo e acompanhe o andamento. O prazo de arrependimento
            é de até 7 dias, conforme a legislação aplicável.
          </Text>
        )}
        <details>
          <summary>Política completa</summary>
          <Text as="p" sx={{ whiteSpace: 'pre-line' }}>
            {publicRefundPolicy(policy)}
          </Text>
        </details>
      </details>
    </Box>
  )
}

export function RefundSourceButton({ type, id, onCreated }) {
  const triggerRef = useRef(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button ref={triggerRef} onClick={() => setOpen(true)}>
        {type === 'purchase'
          ? 'Ver compra / Solicitar reembolso'
          : 'Ver contratação / Cancelar ou reportar problema'}
      </Button>
      {open && (
        <RefundSourceDialog
          key={id}
          type={type}
          id={id}
          close={() => setOpen(false)}
          returnFocusRef={triggerRef}
          onCreated={onCreated}
        />
      )}
    </>
  )
}
function RefundSourceDialog({ type, id, close, returnFocusRef, onCreated }) {
  const [source, setSource] = useState(null),
    [error, setError] = useState(''),
    [category, setCategory] = useState('withdrawal'),
    [message, setMessage] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [request, setRequest] = useState(null),
    [remaining, setRemaining] = useState(0)
  const lock = useRef(false),
    received = useRef(0),
    intent = useRef(null)
  useEffect(() => {
    let active = true
    const start = performance.now()
    getRefundSource(type, id)
      .then((s) => {
        if (!active) return
        received.current = start
        setSource(s)
        setRemaining(withdrawalRemaining(s, start))
        if (!s.withdrawalOpen || !s.requestsEnabled) setCategory('other')
      })
      .catch((e) => active && setError(refundError(e)))
    return () => {
      active = false
    }
  }, [type, id])
  useEffect(() => {
    if (!source) return
    const timer = setInterval(
      () => setRemaining(withdrawalRemaining(source, received.current)),
      1000
    )
    return () => clearInterval(timer)
  }, [source])
  function changeIntent(fn) {
    intent.current = null
    fn()
  }
  async function submit() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      intent.current ||= crypto.randomUUID()
      const created = await createRefundRequest(type, id, category, message, intent.current)
      setRequest(created)
      onCreated?.(created)
    } catch (e) {
      setError(refundError(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const withdrawalMaySubmit =
    source?.requestsEnabled && (remaining > 0 || source.policy?.historicalUnverified)
  return (
    <Dialog
      title="Cancelamento, reembolso ou problema"
      onClose={busy ? () => {} : close}
      className="refund-dialog"
      returnFocusRef={returnFocusRef}
      sx={{ width: 'min(560px, calc(100vw - 24px))', maxHeight: '90vh', overflowY: 'auto' }}
    >
      <Box sx={{ p: 3, overflowWrap: 'anywhere' }}>
        {error && (
          <Flash variant="danger" role="alert">
            {error}
          </Flash>
        )}
        {!source && !error && <Spinner aria-label="Consultando aquisição" />}
        {request ? (
          <Flash role="status">
            Recebemos sua manifestação. Protocolo {request.protocol} ·{' '}
            {refundDate(request.createdAt)}. Acompanhe em{' '}
            <Link to={`/evocash?request=${request.id}`}>Minhas solicitações</Link>.
          </Flash>
        ) : (
          source && (
            <>
              <Text as="p">
                Aquisição: {id} · {source.acquisition.cashUnits} EvoCash
                {source.acquisition.paidCentavos &&
                  ` · R$ ${(BigInt(source.acquisition.paidCentavos) / 100n).toString()},${(BigInt(source.acquisition.paidCentavos) % 100n).toString().padStart(2, '0')}`}
              </Text>
              <Text as="p">
                {source.policy?.historicalUnverified
                  ? 'Aquisição histórica: marco e prazo sujeitos à análise. Não presumimos que seu direito terminou.'
                  : remaining > 0
                    ? `Arrependimento disponível até ${refundDate(source.deadlineAt)} · ${withdrawalRemainingLabel(remaining)}`
                    : 'Prazo de arrependimento encerrado'}
              </Text>
              <Text as="p">
                Outros problemas e direitos continuam disponíveis. Origem de créditos e consumo
                parcial exigem análise; valor final sujeito à análise conforme a lei.
              </Text>
              <RefundPolicyNotice snapshot={source.policy} />
              {!source.requestsEnabled && (
                <Flash>
                  Arrependimento financeiro aguarda liberação. O canal de problemas e demais
                  direitos permanece disponível.
                </Flash>
              )}
              <FormControl sx={{ mt: 3 }}>
                <FormControl.Label>Categoria</FormControl.Label>
                <Select
                  value={category}
                  onChange={(e) => changeIntent(() => setCategory(e.target.value))}
                  block
                >
                  {Object.entries(refundCategories).map(([value, label]) => (
                    <Select.Option
                      key={value}
                      value={value}
                      disabled={value === 'withdrawal' && !withdrawalMaySubmit}
                    >
                      {label}
                    </Select.Option>
                  ))}
                </Select>
              </FormControl>
              <FormControl sx={{ mt: 3 }}>
                <FormControl.Label>
                  {category === 'withdrawal' ? 'Motivo (opcional)' : 'Descreva o problema'}
                </FormControl.Label>
                <Textarea
                  value={message}
                  maxLength={2000}
                  block
                  onChange={(e) => changeIntent(() => setMessage(e.target.value))}
                />
              </FormControl>
              <FormControl sx={{ my: 3 }}>
                <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <FormControl.Label>
                  Confirmo o envio desta solicitação. Isto não representa renúncia de direitos.
                </FormControl.Label>
              </FormControl>
              <Button
                variant="primary"
                disabled={
                  busy ||
                  !confirmed ||
                  (category === 'withdrawal' && !withdrawalMaySubmit) ||
                  (category !== 'withdrawal' && message.trim().length < 5)
                }
                onClick={submit}
              >
                {busy ? 'Registrando…' : 'Registrar solicitação'}
              </Button>
            </>
          )
        )}
        <Button sx={{ ml: 2, mt: 2 }} onClick={close} disabled={busy}>
          Fechar
        </Button>
      </Box>
    </Dialog>
  )
}

const actionsFor = (r, admin) =>
  admin
    ? {
        requested: ['review', 'needs_information', 'reject'],
        under_review: ['needs_information', 'reserve', 'approve', 'reject'],
        needs_information: ['review', 'reject'],
        disputed: ['review', 'needs_information', 'reject'],
        approved: [r.purchaseId ? 'provider_pending' : 'complete_service', 'investigate'],
        awaiting_provider_refund: ['confirm_provider', 'provider_failed', 'investigate'],
        provider_refund_failed: ['provider_pending', 'review'],
        provider_refund_confirmed: ['complete', 'investigate'],
      }[r.status] || []
    : {
        requested: ['cancel'],
        under_review: ['cancel'],
        needs_information: ['cancel', 'dispute'],
        rejected: ['dispute'],
        provider_refund_failed: ['dispute'],
      }[r.status] || []
const actionLabels = {
  reserve: 'Reservar créditos contestados após análise',
  investigate: 'Registrar divergência e investigar',
  review: 'Iniciar análise',
  needs_information: 'Pedir informação',
  approve: 'Aprovar análise',
  reject: 'Recusar com fundamento',
  provider_pending: 'Registrar estorno em processamento',
  provider_failed: 'Registrar falha externa',
  confirm_provider: 'Registrar comprovação do estorno',
  complete: 'Conciliar e concluir',
  complete_service: 'Devolver EvoCash e cancelar período',
  cancel: 'Cancelar solicitação',
  dispute: 'Contestar decisão',
  comment: 'Enviar comunicação',
}

export function RefundRequestsPanel({ admin = false, initialId, revision = 0 }) {
  const [balance, setBalance] = useState(null)
  const [rows, setRows] = useState([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [detail, setDetail] = useState(null),
    [more, setMore] = useState(false)
  const lock = useRef(false)
  const returnFocusRef = useRef(null)
  const selection = useRef(0)
  async function load(next = false) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const [page, funds] = await Promise.all([
        listRefundRequests(admin, next ? rows.at(-1)?.cursor : null),
        admin ? Promise.resolve(null) : getRefundBalance(),
      ])
      setBalance(funds)
      setRows((old) => (next ? [...old, ...page] : page))
      setMore(page.length === 20)
    } catch (e) {
      setError(refundError(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  useEffect(() => {
    let active = true
    setRows([])
    setDetail(null)
    setBusy(true)
    Promise.all([listRefundRequests(admin), admin ? Promise.resolve(null) : getRefundBalance()])
      .then(([page, funds]) => {
        if (active) setBalance(funds)
        if (active) {
          setRows(page)
          setMore(page.length === 20)
        }
      })
      .catch((e) => active && setError(refundError(e)))
      .finally(() => active && setBusy(false))
    if (initialId)
      getRefundRequest(initialId)
        .then((r) => active && setDetail(r))
        .catch((e) => active && setError(refundError(e)))
    return () => {
      active = false
    }
  }, [admin, initialId, revision])
  async function select(id, trigger) {
    if (trigger) returnFocusRef.current = trigger
    const generation = ++selection.current
    try {
      const result = await getRefundRequest(id)
      if (generation !== selection.current) return
      setDetail(result)
      setError('')
    } catch (e) {
      setError(refundError(e))
    }
  }
  return (
    <Box sx={{ my: 3, minWidth: 0 }}>
      <Text as="h2">{admin ? 'Reembolsos' : 'Minhas solicitações'}</Text>
      {balance && (
        <Text as="p">
          Disponível para uso: {balance.available} EvoCash · Reservado para análise:{' '}
          {balance.reserved} EvoCash
        </Text>
      )}
      <Button onClick={() => load()} disabled={busy}>
        Atualizar solicitações
      </Button>
      {error && (
        <Flash variant="danger" role="alert">
          {error}
        </Flash>
      )}
      {busy && <Spinner aria-label="Carregando solicitações" />}
      {!busy && !rows.length && <Text as="p">Nenhuma solicitação registrada.</Text>}
      {admin &&
        rows.some(
          (r) =>
            !['completed', 'rejected', 'canceled_by_requester'].includes(r.status) &&
            Date.parse(r.serverNow) > Date.parse(r.responseDueAt)
        ) && (
          <Flash variant="warning">
            Há solicitações que ultrapassaram o prazo operacional de resposta. Priorize a fila.
          </Flash>
        )}
      {rows.map((r) => (
        <Box
          key={r.id}
          sx={{
            p: 3,
            my: 2,
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 2,
            overflowWrap: 'anywhere',
          }}
        >
          <Text as="p">
            {r.protocol} · {refundStates[r.status]}
          </Text>
          <Text as="p">
            {refundCategories[r.category]} · Recebida {refundDate(r.createdAt)}
          </Text>
          {admin && (
            <Text as="p">
              Resposta até {refundDate(r.responseDueAt)} · {r.reservedUnits} EvoCash reservados ·
              Solicitante: {r.requesterId}
            </Text>
          )}
          <Button onClick={(event) => select(r.id, event.currentTarget)}>Ver solicitação</Button>
        </Box>
      ))}
      {more && (
        <Button disabled={busy} onClick={() => load(true)}>
          Mais solicitações
        </Button>
      )}
      {detail && (
        <RefundDetail
          key={detail.id + ':' + detail.revision}
          request={detail}
          returnFocusRef={returnFocusRef}
          admin={admin}
          close={() => {
            selection.current++
            setDetail(null)
          }}
          changed={async () => {
            await select(detail.id)
            await load()
          }}
        />
      )}
    </Box>
  )
}
function RefundDetail({ request: r, admin, close, changed, returnFocusRef }) {
  const [events, setEvents] = useState(r.events || []),
    [older, setOlder] = useState(r.eventHistoryLimited)
  async function loadOlder() {
    if (busy) return
    setBusy(true)
    try {
      const page = await listRefundEvents(r.id, events[0]?.id)
      setEvents((old) => [...page, ...old])
      setOlder(page.length === 50)
    } catch (e) {
      setError(refundError(e))
    } finally {
      setBusy(false)
    }
  }
  const [action, setAction] = useState('comment'),
    [message, setMessage] = useState(''),
    [password, setPassword] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [evidence, setEvidence] = useState({
    partyClassification: 'undetermined',
    basis: '',
    legalReview: '',
    relatedContractsReview: '',
    externalId: '',
    reference: '',
    transactionNsu: '',
    merchant: '',
    amountCentavos: '',
    occurredAt: '',
    currency: 'BRL',
    channel: 'infinitepay_original_payment',
    verification: 'administrative_evidence_only',
  })
  const lock = useRef(false),
    intent = useRef(null)
  function edit(fn) {
    intent.current = null
    fn()
  }
  const available = actionsFor(r, admin)
  async function submit() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      intent.current ||= crypto.randomUUID()
      if (admin && action !== 'comment') await reauthenticatePricingAdmin(password)
      setPassword('')
      await actOnRefundRequest(
        r.id,
        action,
        message,
        intent.current,
        r.revision,
        admin ? evidence : {}
      )
      await changed()
    } catch (e) {
      setError(refundError(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Solicitação de reembolso"
      onClose={busy ? () => {} : close}
      className="refund-dialog"
      returnFocusRef={returnFocusRef}
      sx={{ width: 'min(680px, calc(100vw - 24px))', maxHeight: '90vh', overflowY: 'auto' }}
    >
      <Box sx={{ p: 3, overflowWrap: 'anywhere' }}>
        <Text as="p">{r.protocol}</Text>
        <Text as="p">
          {refundStates[r.status]} · Recebida {refundDate(r.createdAt)}
        </Text>
        <Text as="p">
          Aquisição: {r.purchaseId || r.orderId} · {r.acquisition.cashUnits} EvoCash · Reservados:{' '}
          {r.reservedUnits}
        </Text>
        <Text as="p">
          Adquirido em {refundDate(r.originAt)}
          {r.acquisition.paidCentavos &&
            ` · Total pago: ${formatCentavosBRL(r.acquisition.paidCentavos)}`}
        </Text>
        <Text as="p">
          Data-limite: {refundDate(r.deadlineAt)} ·{' '}
          {r.timely ? 'Manifestação recebida no prazo informado' : 'Enquadramento sob análise'}
        </Text>
        {admin && r.purchaseId && (
          <Text as="p">
            Preço unitário original:{' '}
            {r.acquisition.unitPriceCentavos
              ? formatCentavosBRL(r.acquisition.unitPriceCentavos)
              : 'snapshot legado sem tarifa unitária'}{' '}
            · Consumos totais da carteira: {r.acquisition.consumedUnits || '0'} EvoCash · Contratos
            ativos no recebimento: {r.acquisition.activeContractCount || '0'}. Estes totais não
            identificam o lote consumido. Créditos promocionais e saldo pago por compra não são
            classificáveis no histórico atual. Valor final sujeito à análise conforme a lei.
          </Text>
        )}
        <Text as="p">{r.explanation}</Text>
        <RefundPolicyNotice snapshot={r.policy} />
        <Flash>
          {admin
            ? 'Origem dos créditos não rastreada por lote. Consumo e contratos acessórios exigem revisão. Não há cálculo proporcional automático. Estorno na InfinitePay é manual, com verificação administrativa expressamente limitada.'
            : 'Valor final sujeito à análise conforme a lei. O uso de créditos e o início do serviço serão analisados sem descontos automáticos. Acompanhe as decisões e envie informações por esta solicitação.'}
        </Flash>
        {events.map((event) => (
          <Box key={event.id} sx={{ my: 3 }}>
            <Text as="p">
              {refundDate(event.createdAt)} · {event.message}
            </Text>
            {admin && Object.keys(event.evidence || {}).length > 0 && (
              <details>
                <summary>Evidência administrativa</summary>
                <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {JSON.stringify(event.evidence, null, 2)}
                </pre>
              </details>
            )}
          </Box>
        ))}
        {older && (
          <Text as="p">
            <Button onClick={loadOlder} disabled={busy}>
              Carregar eventos anteriores
            </Button>
          </Text>
        )}
        {!['completed', 'canceled_by_requester'].includes(r.status) && (
          <>
            <FormControl sx={{ mt: 3 }}>
              <FormControl.Label>Ação</FormControl.Label>
              <Select
                block
                value={action}
                onChange={(e) =>
                  edit(() => {
                    setAction(e.target.value)
                    setConfirmed(false)
                  })
                }
              >
                {['comment', ...available].map((value) => (
                  <Select.Option key={value} value={value}>
                    {actionLabels[value]}
                  </Select.Option>
                ))}
              </Select>
            </FormControl>
            {admin && action === 'approve' && (
              <>
                <FormControl sx={{ mt: 3 }}>
                  <FormControl.Label>Classificação revisável do contratante</FormControl.Label>
                  <Select
                    value={evidence.partyClassification}
                    onChange={(e) =>
                      edit(() =>
                        setEvidence((v) => ({ ...v, partyClassification: e.target.value }))
                      )
                    }
                  >
                    {['undetermined', 'individual', 'professional', 'company'].map((x) => (
                      <Select.Option key={x} value={x}>
                        {
                          {
                            undetermined: 'Pendente de classificação',
                            individual: 'Pessoa física',
                            professional: 'Profissional',
                            company: 'Empresa',
                          }[x]
                        }
                      </Select.Option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl sx={{ mt: 3 }}>
                  <FormControl.Label>
                    Fundamento jurídico/comercial e valor devido (sem presumir CDC no B2B)
                  </FormControl.Label>
                  <Textarea
                    block
                    value={evidence.basis}
                    onChange={(e) =>
                      edit(() => setEvidence((v) => ({ ...v, basis: e.target.value })))
                    }
                  />
                </FormControl>
                {['legalReview', 'relatedContractsReview'].map((field) => (
                  <FormControl key={field} sx={{ mt: 3 }}>
                    <Checkbox
                      checked={evidence[field] === 'confirmed'}
                      onChange={(e) =>
                        edit(() =>
                          setEvidence((v) => ({
                            ...v,
                            [field]: e.target.checked ? 'confirmed' : '',
                          }))
                        )
                      }
                    />
                    <FormControl.Label>
                      {field === 'legalReview'
                        ? 'Enquadramento jurídico revisado, incluindo consumo e restituição integral quando devida'
                        : 'Contratos relacionados, promoções e compensações anteriores revisados para impedir devolução dupla'}
                    </FormControl.Label>
                  </FormControl>
                ))}
              </>
            )}
            {admin && action === 'confirm_provider' && (
              <>
                <Text as="p">
                  Registre somente um estorno efetivamente confirmado no canal oficial do pagamento
                  original. Nenhuma chamada de estorno será enviada. Esta fase não automatiza
                  confirmação junto ao provedor nem liquida estorno parcial.
                </Text>
                {Object.entries({
                  externalId: 'Identificador único do estorno',
                  reference: 'Referência da evidência administrativa',
                  transactionNsu: 'NSU da transação original',
                  merchant: 'Identificador do lojista',
                  amountCentavos: 'Valor integral em centavos BRL',
                  occurredAt: 'Data/hora efetiva ISO com fuso (ex.: 2026-10-29T12:00:00-03:00)',
                }).map(([field, label]) => (
                  <FormControl key={field} sx={{ mt: 3 }}>
                    <FormControl.Label>{label}</FormControl.Label>
                    <TextInput
                      block
                      value={evidence[field]}
                      onChange={(e) =>
                        edit(() => setEvidence((v) => ({ ...v, [field]: e.target.value })))
                      }
                    />
                  </FormControl>
                ))}
              </>
            )}
            <FormControl sx={{ mt: 3 }}>
              <FormControl.Label>Comunicação ou fundamento da decisão</FormControl.Label>
              <Textarea
                block
                maxLength={2000}
                value={message}
                onChange={(e) => edit(() => setMessage(e.target.value))}
              />
            </FormControl>
            {admin && action !== 'comment' && (
              <FormControl sx={{ mt: 3 }}>
                <FormControl.Label>Confirme sua senha</FormControl.Label>
                <TextInput
                  block
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </FormControl>
            )}
            <FormControl sx={{ my: 3 }}>
              <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <FormControl.Label>
                Confirmo esta ação e a comunicação ao solicitante
              </FormControl.Label>
            </FormControl>
            {error && (
              <Flash variant="danger" role="alert">
                {error}
              </Flash>
            )}
            <Button
              variant="primary"
              disabled={
                busy ||
                !confirmed ||
                message.trim().length < 5 ||
                (admin && action !== 'comment' && !password)
              }
              onClick={submit}
            >
              {busy ? 'Registrando…' : actionLabels[action]}
            </Button>
          </>
        )}
        <Button sx={{ ml: 2, mt: 2 }} disabled={busy} onClick={close}>
          Fechar
        </Button>
      </Box>
    </Dialog>
  )
}
