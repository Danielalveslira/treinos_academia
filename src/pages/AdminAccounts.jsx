import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Box,
  Heading,
  Text,
  Button,
  Spinner,
  Label,
  Dialog,
  FormControl,
  TextInput,
  Textarea,
  Select,
  ActionMenu,
  ActionList,
  IconButton,
} from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import {
  PersonIcon,
  KebabHorizontalIcon,
  TrashIcon,
  CheckIcon,
  BlockedIcon,
} from '@primer/octicons-react'
import { useAdminAccounts } from '../hooks/useAdminAccounts'
import { useBillingConfig } from '../hooks/useBillingConfig'
import { saveBillingConfig } from '../services/billingService'
import { useToast } from '../hooks/useToast'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'
import { getSubscriptionState, formatCurrency, formatDate } from '../utils/billing'

const STATUS_LABELS = {
  TRIAL_ACTIVE: { text: 'Trial', variant: 'accent' },
  ACTIVE: { text: 'Ativa', variant: 'success' },
  PAYMENT_DUE: { text: 'Vencendo', variant: 'attention' },
  GRACE_PERIOD: { text: 'Tolerância', variant: 'attention' },
  BLOCKED: { text: 'Bloqueada', variant: 'danger' },
  NONE: { text: 'Sem assinatura', variant: 'secondary' },
}

function DisableDialog({ account, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  return (
    <Dialog
      title={`Desativar conta de ${account.username || account.email || account.id}`}
      onClose={onClose}
      footerButtons={[
        { content: 'Cancelar', onClick: onClose },
        {
          content: 'Desativar conta',
          buttonType: 'danger',
          disabled: reason.trim().length < 5 || saving,
          onClick: async () => {
            setSaving(true)
            await onConfirm(reason)
            setSaving(false)
          },
        },
      ]}
    >
      <Box sx={{ p: 3 }}>
        <FormControl required>
          <FormControl.Label>Motivo</FormControl.Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            block
            placeholder="Descreva o motivo da desativação"
          />
        </FormControl>
      </Box>
    </Dialog>
  )
}

function ConfirmPaymentDialog({ account, plans, onClose, onConfirm }) {
  const [planId, setPlanId] = useState(account.subscription?.planId || plans[0]?.id)
  const [saving, setSaving] = useState(false)
  return (
    <Dialog
      title={`Confirmar pagamento de ${account.username || account.email || account.id}`}
      onClose={onClose}
      footerButtons={[
        { content: 'Cancelar', onClick: onClose },
        {
          content: 'Pagamento efetivado',
          buttonType: 'primary',
          disabled: !planId || saving,
          onClick: async () => {
            setSaving(true)
            await onConfirm(planId)
            setSaving(false)
          },
        },
      ]}
    >
      <Box sx={{ p: 3 }}>
        <FormControl required>
          <FormControl.Label>Plano</FormControl.Label>
          <Select value={planId} onChange={(e) => setPlanId(e.target.value)} block>
            {plans.map((plan) => (
              <Select.Option key={plan.id} value={plan.id}>
                {plan.name} — {formatCurrency(plan.price)}/mês
              </Select.Option>
            ))}
          </Select>
        </FormControl>
      </Box>
    </Dialog>
  )
}

function DeleteAccountDialog({ account, onClose, onConfirm }) {
  const [confirmation, setConfirmation] = useState('')
  const [saving, setSaving] = useState(false)
  return (
    <Dialog
      title={`Excluir permanentemente ${account.username || account.email || account.id}`}
      onClose={onClose}
      footerButtons={[
        { content: 'Cancelar', onClick: onClose },
        {
          content: 'Excluir permanentemente',
          buttonType: 'danger',
          disabled: confirmation !== 'EXCLUIR' || saving,
          onClick: async () => {
            setSaving(true)
            await onConfirm()
            setSaving(false)
          },
        },
      ]}
    >
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Text sx={{ fontWeight: 'bold', color: 'danger.fg' }}>
          Esta ação não poderá ser desfeita e removerá os dados associados ao usuário.
        </Text>
        <FormControl>
          <FormControl.Label>Digite EXCLUIR para confirmar</FormControl.Label>
          <TextInput value={confirmation} onChange={(e) => setConfirmation(e.target.value)} block />
        </FormControl>
      </Box>
    </Dialog>
  )
}

function BillingConfigForm({ config, onSaved, showToast }) {
  const [form, setForm] = useState(config)
  const [saving, setSaving] = useState(false)

  function updatePlan(planId, price) {
    setForm((prev) => ({
      ...prev,
      plans: prev.plans.map((p) => (p.id === planId ? { ...p, price: Number(price) || 0 } : p)),
    }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await saveBillingConfig(form)
      showToast('Configuração de pagamento salva.')
      onSaved(form)
    } catch (err) {
      console.error('[AdminAccounts] saveBillingConfig:', err)
      showToast('Erro ao salvar configuração.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3, mb: 4 }}>
      <Heading as="h2" sx={{ fontSize: 2, mb: 3 }}>
        Configuração de pagamento
      </Heading>
      <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', '1fr 1fr'], gap: 3, mb: 3 }}>
        <FormControl>
          <FormControl.Label>Chave PIX</FormControl.Label>
          <TextInput
            value={form.pixKey}
            onChange={(e) => setForm((p) => ({ ...p, pixKey: e.target.value }))}
            block
          />
        </FormControl>
        <FormControl>
          <FormControl.Label>Tipo da chave</FormControl.Label>
          <Select
            value={form.pixKeyType}
            onChange={(e) => setForm((p) => ({ ...p, pixKeyType: e.target.value }))}
            block
          >
            <Select.Option value="email">E-mail</Select.Option>
            <Select.Option value="cpf">CPF</Select.Option>
            <Select.Option value="cnpj">CNPJ</Select.Option>
            <Select.Option value="phone">Telefone</Select.Option>
            <Select.Option value="random">Chave aleatória</Select.Option>
          </Select>
        </FormControl>
        <FormControl>
          <FormControl.Label>Nome do recebedor</FormControl.Label>
          <TextInput
            value={form.receiverName}
            onChange={(e) => setForm((p) => ({ ...p, receiverName: e.target.value }))}
            block
          />
        </FormControl>
        <FormControl>
          <FormControl.Label>WhatsApp (só números, com DDI)</FormControl.Label>
          <TextInput
            value={form.whatsapp}
            onChange={(e) => setForm((p) => ({ ...p, whatsapp: e.target.value }))}
            placeholder="5511999999999"
            block
          />
        </FormControl>
        <FormControl>
          <FormControl.Label>Dias de trial</FormControl.Label>
          <TextInput
            type="number"
            min={0}
            value={form.trialDays}
            onChange={(e) => setForm((p) => ({ ...p, trialDays: Number(e.target.value) || 0 }))}
            block
          />
        </FormControl>
        <FormControl>
          <FormControl.Label>Dias de aviso antes do vencimento</FormControl.Label>
          <TextInput
            type="number"
            min={0}
            value={form.warningDaysBeforeDue}
            onChange={(e) =>
              setForm((p) => ({ ...p, warningDaysBeforeDue: Number(e.target.value) || 0 }))
            }
            block
          />
        </FormControl>
        <FormControl>
          <FormControl.Label>Dias úteis de tolerância</FormControl.Label>
          <TextInput
            type="number"
            min={0}
            value={form.graceBusinessDays}
            onChange={(e) =>
              setForm((p) => ({ ...p, graceBusinessDays: Number(e.target.value) || 0 }))
            }
            block
          />
        </FormControl>
      </Box>
      <Text sx={{ display: 'block', fontWeight: 'bold', mb: 2 }}>Valor mensal dos planos</Text>
      <Box sx={{ display: 'flex', gap: 3, mb: 3 }}>
        {form.plans.map((plan) => (
          <FormControl key={plan.id}>
            <FormControl.Label>{plan.name}</FormControl.Label>
            <TextInput
              type="number"
              step="0.01"
              min={0}
              leadingVisual="R$"
              value={plan.price}
              onChange={(e) => updatePlan(plan.id, e.target.value)}
            />
          </FormControl>
        ))}
      </Box>
      <Button variant="primary" onClick={handleSave} loading={saving} disabled={saving}>
        Salvar configuração
      </Button>
    </Box>
  )
}

export default function AdminAccounts() {
  const { accounts, loading, error, refresh, disable, enable, confirm, remove } = useAdminAccounts()
  const { config, loading: configLoading } = useBillingConfig()
  const [localConfig, setLocalConfig] = useState(null)
  const { toasts, showToast } = useToast()
  const [dialog, setDialog] = useState(null) // { type: 'disable'|'confirm'|'delete', account }
  const [search, setSearch] = useState('')

  const effectiveConfig = localConfig || config
  const filtered = accounts.filter((account) => {
    const term = search.trim().toLowerCase()
    if (!term) return true
    return (
      account.username?.toLowerCase().includes(term) || account.email?.toLowerCase().includes(term)
    )
  })

  async function handleDisable(reason) {
    try {
      await disable(dialog.account.id, reason)
      showToast('Conta desativada.')
    } catch (err) {
      console.error('[AdminAccounts] disable:', err)
      showToast('Erro ao desativar conta.', 'danger')
    } finally {
      setDialog(null)
    }
  }

  async function handleEnable(account) {
    try {
      await enable(account.id)
      showToast('Conta ativada.')
    } catch (err) {
      console.error('[AdminAccounts] enable:', err)
      showToast('Erro ao ativar conta.', 'danger')
    }
  }

  async function handleConfirmPayment(planId) {
    try {
      await confirm(dialog.account.id, planId)
      showToast('Pagamento confirmado.')
    } catch (err) {
      console.error('[AdminAccounts] confirmPayment:', err)
      showToast('Erro ao confirmar pagamento.', 'danger')
    } finally {
      setDialog(null)
    }
  }

  async function handleDelete() {
    try {
      await remove(dialog.account.id)
      showToast('Conta excluída permanentemente.')
    } catch (err) {
      console.error('[AdminAccounts] delete:', err)
      showToast('Erro ao excluir conta.', 'danger')
    } finally {
      setDialog(null)
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <Button as={Link} to="/admin/comunidades">
          Administrar comunidades
        </Button>
        <Button as={Link} to="/admin/moderacao">
          Atendimento e moderação
        </Button>
      </Box>
      <ToastFlash toasts={toasts} />
      <Heading as="h1" sx={{ fontSize: 3, mb: 3 }}>
        Contas e assinaturas
      </Heading>

      {!configLoading && (
        <BillingConfigForm
          config={effectiveConfig}
          onSaved={setLocalConfig}
          showToast={showToast}
        />
      )}

      <FormControl sx={{ mb: 3 }}>
        <FormControl.Label visuallyHidden>Buscar conta</FormControl.Label>
        <TextInput
          placeholder="Buscar por @usuário ou e-mail"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          block
        />
      </FormControl>

      {loading && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={error} onRetry={refresh} />

      {!loading && !error && filtered.length === 0 && (
        <Blankslate>
          <Blankslate.Visual>
            <PersonIcon size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>Nenhuma conta encontrada</Blankslate.Heading>
        </Blankslate>
      )}

      {!loading && !error && filtered.length > 0 && (
        <Box
          sx={{
            border: '1px solid',
            borderColor: 'border.default',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          {filtered.map((account, index) => {
            const status = getSubscriptionState(account.subscription)
            const statusInfo = STATUS_LABELS[status] || STATUS_LABELS.NONE
            const plan = effectiveConfig.plans.find((p) => p.id === account.subscription?.planId)
            return (
              <Box
                key={account.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  px: 3,
                  py: 2,
                  borderTop: index === 0 ? 'none' : '1px solid',
                  borderColor: 'border.default',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <Text sx={{ fontWeight: 'bold' }}>
                      {account.username ? `@${account.username}` : account.email || account.id}
                    </Text>
                    <Label variant={account.accountStatus === 'disabled' ? 'danger' : 'success'}>
                      {account.accountStatus === 'disabled' ? 'Desativada' : 'Ativa'}
                    </Label>
                    <Label variant={statusInfo.variant}>{statusInfo.text}</Label>
                    {plan && <Label>{plan.name}</Label>}
                  </Box>
                  <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
                    {account.email}
                    {account.subscription?.nextPaymentAt &&
                      ` · vencimento ${formatDate(account.subscription.nextPaymentAt)}`}
                  </Text>
                </Box>

                {account.accountStatus === 'disabled' ? (
                  <Button
                    size="small"
                    leadingVisual={CheckIcon}
                    onClick={() => handleEnable(account)}
                  >
                    Ativar
                  </Button>
                ) : (
                  <Button
                    size="small"
                    leadingVisual={BlockedIcon}
                    onClick={() => setDialog({ type: 'disable', account })}
                  >
                    Desativar
                  </Button>
                )}

                <ActionMenu>
                  <ActionMenu.Anchor>
                    <IconButton
                      icon={KebabHorizontalIcon}
                      variant="invisible"
                      aria-label="Mais ações"
                      sx={{ color: 'fg.muted' }}
                    />
                  </ActionMenu.Anchor>
                  <ActionMenu.Overlay align="end">
                    <ActionList>
                      <ActionList.Item onSelect={() => setDialog({ type: 'confirm', account })}>
                        <ActionList.LeadingVisual>
                          <CheckIcon />
                        </ActionList.LeadingVisual>
                        Confirmar pagamento
                      </ActionList.Item>
                      <ActionList.Item
                        variant="danger"
                        onSelect={() => setDialog({ type: 'delete', account })}
                      >
                        <ActionList.LeadingVisual>
                          <TrashIcon />
                        </ActionList.LeadingVisual>
                        Excluir permanentemente
                      </ActionList.Item>
                    </ActionList>
                  </ActionMenu.Overlay>
                </ActionMenu>
              </Box>
            )
          })}
        </Box>
      )}

      {dialog?.type === 'disable' && (
        <DisableDialog
          account={dialog.account}
          onClose={() => setDialog(null)}
          onConfirm={handleDisable}
        />
      )}
      {dialog?.type === 'confirm' && (
        <ConfirmPaymentDialog
          account={dialog.account}
          plans={effectiveConfig.plans}
          onClose={() => setDialog(null)}
          onConfirm={handleConfirmPayment}
        />
      )}
      {dialog?.type === 'delete' && (
        <DeleteAccountDialog
          account={dialog.account}
          onClose={() => setDialog(null)}
          onConfirm={handleDelete}
        />
      )}
    </Box>
  )
}
