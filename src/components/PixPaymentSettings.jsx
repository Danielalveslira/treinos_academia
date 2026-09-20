import { useState } from 'react'
import {
  Box,
  Button,
  Flash,
  FormControl,
  Heading,
  Label,
  Select,
  Spinner,
  Text,
  TextInput,
} from '@primer/react'
import { usePixPaymentMethods } from '../hooks/usePixPaymentMethods'
import {
  PIX_KEY_TYPE_OPTIONS,
  isValidPixMethodForm,
  canDeletePixMethod,
} from '../utils/pixPaymentAdminFlow'
import { resolvePixKeyTypeLabel } from '../utils/cashPurchaseFlow'

const CALLABLE_ERROR_CODES = [
  'functions/invalid-argument',
  'functions/permission-denied',
  'functions/not-found',
  'functions/failed-precondition',
]

function callableErrorMessage(err, fallback) {
  return CALLABLE_ERROR_CODES.includes(err?.code) ? err.message : fallback
}

function emptyForm() {
  return { methodId: null, label: '', key: '', keyType: 'email', recipientName: '' }
}

// Aba "Configuração PIX" de /admin/compras-evocash (AdminCashPurchases.jsx) --
// cadastro/edição/ativação/exclusão de chaves PIX e o toggle global de habilitação.
// Extraído como componente reutilizável (não uma página própria) porque essa
// configuração pertence ao mesmo domínio de "Compras de EvoCash" -- ver
// implementar_pacotes_evocash_design_persuasivo.md e a decisão de centralizar a UI numa
// rota só. privatePaymentConfig/pix nunca é lido/escrito daqui diretamente (Rules: allow
// read, write: if false) -- tudo passa pelas callables de usePixPaymentMethods/
// pixPaymentAdminService.js, que já fazem toda a validação e verificação de superadmin
// no servidor. Ativar uma chave só muda o que NOVOS pedidos vão usar -- pedidos pending
// já existentes mantêm o próprio pixPaymentSnapshot (ver cash-purchase-service.js), por
// isso a confirmação abaixo antes de trocar.
export function PixPaymentSettings() {
  const {
    enabled,
    activeMethodId,
    methods,
    loading,
    error,
    refresh,
    save,
    activate,
    remove,
    toggleEnabled,
  } = usePixPaymentMethods()
  const [formState, setFormState] = useState(null)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmingActivateId, setConfirmingActivateId] = useState(null)
  const [activating, setActivating] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [togglingEnabled, setTogglingEnabled] = useState(false)
  const [actionError, setActionError] = useState('')

  function startCreate() {
    setFormState(emptyForm())
    setFormError('')
  }
  function startEdit(method) {
    setFormState({
      methodId: method.id,
      label: method.label,
      key: method.key,
      keyType: method.keyType,
      recipientName: method.recipientName,
    })
    setFormError('')
  }
  function cancelForm() {
    setFormState(null)
    setFormError('')
  }
  async function submitForm() {
    if (saving || !formState || !isValidPixMethodForm(formState)) return
    setSaving(true)
    setFormError('')
    try {
      await save(formState)
      setFormState(null)
    } catch (err) {
      setFormError(
        callableErrorMessage(err, 'Não foi possível salvar a chave PIX. Tente novamente.')
      )
    } finally {
      setSaving(false)
    }
  }

  async function submitActivate(methodId) {
    if (activating) return
    setActivating(true)
    setActionError('')
    try {
      await activate(methodId)
      setConfirmingActivateId(null)
    } catch (err) {
      setActionError(
        callableErrorMessage(err, 'Não foi possível ativar esta chave. Tente novamente.')
      )
    } finally {
      setActivating(false)
    }
  }

  async function submitDelete(methodId) {
    if (deletingId) return
    setDeletingId(methodId)
    setActionError('')
    try {
      await remove(methodId)
    } catch (err) {
      setActionError(
        callableErrorMessage(err, 'Não foi possível excluir esta chave. Tente novamente.')
      )
    } finally {
      setDeletingId(null)
    }
  }

  async function submitToggleEnabled() {
    if (togglingEnabled) return
    setTogglingEnabled(true)
    setActionError('')
    try {
      await toggleEnabled(!enabled)
    } catch (err) {
      setActionError(callableErrorMessage(err, 'Não foi possível alterar o status dos pagamentos.'))
    } finally {
      setTogglingEnabled(false)
    }
  }

  const activeMethod = methods.find((method) => method.id === activeMethodId) || null
  const otherMethods = methods.filter((method) => method.id !== activeMethodId)

  return (
    <div>
      <p>
        Cadastre, edite, ative ou desative chaves PIX. Ativar uma chave afeta apenas pedidos{' '}
        <strong>novos</strong> -- pedidos já existentes continuam mostrando a chave registrada no
        momento em que foram criados.
      </p>

      {loading && <Spinner aria-label="Carregando configuração de PIX" />}
      {error && (
        <Flash variant="danger" sx={{ mb: 3 }}>
          {error} <Button onClick={refresh}>Tentar novamente</Button>
        </Flash>
      )}
      {actionError && (
        <Flash variant="danger" role="alert" sx={{ mb: 3 }}>
          {actionError}
        </Flash>
      )}

      {!loading && !error && (
        <>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 2,
              border: '1px solid',
              borderColor: 'border.default',
              borderRadius: 2,
              p: 3,
              mb: 3,
            }}
          >
            <Text as="p" sx={{ fontWeight: 'bold', m: 0 }}>
              Pagamentos via PIX
            </Text>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Label variant={enabled ? 'success' : 'attention'}>
                {enabled ? 'Ativado' : 'Desativado'}
              </Label>
              <Button
                variant={enabled ? 'danger' : 'primary'}
                loading={togglingEnabled}
                onClick={submitToggleEnabled}
              >
                {enabled ? 'Desativar' : 'Ativar'}
              </Button>
            </Box>
          </Box>

          <Heading as="h2" sx={{ fontSize: 1, mb: 2 }}>
            Chave principal
          </Heading>
          {activeMethod ? (
            <Box
              as="article"
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minWidth: 0,
                border: '1px solid',
                borderColor: 'accent.emphasis',
                borderRadius: 2,
                p: 3,
                mb: 3,
              }}
            >
              <Box
                sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 2 }}
              >
                <Text as="p" sx={{ fontWeight: 'bold', m: 0 }}>
                  {activeMethod.label}
                </Text>
                <Label variant="success">Ativa</Label>
              </Box>
              <Text
                as="p"
                sx={{ fontSize: 0, m: 0, wordBreak: 'break-word', overflowWrap: 'anywhere' }}
              >
                Tipo: {resolvePixKeyTypeLabel(activeMethod.keyType)}
              </Text>
              <Text
                as="p"
                sx={{ fontSize: 0, m: 0, wordBreak: 'break-word', overflowWrap: 'anywhere' }}
              >
                Chave: {activeMethod.key}
              </Text>
              <Text
                as="p"
                sx={{ fontSize: 0, m: 0, wordBreak: 'break-word', overflowWrap: 'anywhere' }}
              >
                Recebedor: {activeMethod.recipientName}
              </Text>
              <Box>
                <Button onClick={() => startEdit(activeMethod)}>Editar</Button>
              </Box>
            </Box>
          ) : (
            <Text as="p" sx={{ color: 'fg.muted', mb: 3 }}>
              Nenhuma chave ativa selecionada. Habilitar os pagamentos exige escolher uma chave
              abaixo.
            </Text>
          )}

          {otherMethods.length > 0 && (
            <>
              <Heading as="h2" sx={{ fontSize: 1, mb: 2 }}>
                Outras chaves
              </Heading>
              {otherMethods.map((method) => (
                <Box
                  as="article"
                  key={method.id}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    minWidth: 0,
                    border: '1px solid',
                    borderColor: 'border.default',
                    borderRadius: 2,
                    p: 3,
                    mb: 2,
                  }}
                >
                  <Text as="p" sx={{ fontWeight: 'bold', m: 0 }}>
                    {method.label}
                  </Text>
                  <Text
                    as="p"
                    sx={{
                      fontSize: 0,
                      color: 'fg.muted',
                      m: 0,
                      wordBreak: 'break-word',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {resolvePixKeyTypeLabel(method.keyType)} · {method.recipientName}
                  </Text>

                  {confirmingActivateId === method.id ? (
                    <Box sx={{ borderTop: '1px solid', borderColor: 'border.default', pt: 2 }}>
                      <Text as="p" sx={{ fontSize: 0, m: 0, mb: 2 }}>
                        Novas compras passarão a usar esta chave. Pedidos já existentes continuarão
                        usando a chave registrada no pedido.
                      </Text>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                        <Button
                          type="button"
                          disabled={activating}
                          onClick={() => setConfirmingActivateId(null)}
                        >
                          Voltar
                        </Button>
                        <Button
                          variant="primary"
                          loading={activating}
                          onClick={() => submitActivate(method.id)}
                        >
                          Confirmar ativação
                        </Button>
                      </Box>
                    </Box>
                  ) : (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                      <Button onClick={() => setConfirmingActivateId(method.id)}>Ativar</Button>
                      <Button onClick={() => startEdit(method)}>Editar</Button>
                      <Button
                        variant="danger"
                        disabled={!canDeletePixMethod(method, activeMethodId)}
                        loading={deletingId === method.id}
                        onClick={() => submitDelete(method.id)}
                      >
                        Excluir
                      </Button>
                    </Box>
                  )}
                </Box>
              ))}
            </>
          )}

          {!formState && (
            <Box sx={{ mt: 3 }}>
              <Button variant="primary" onClick={startCreate}>
                + Adicionar chave PIX
              </Button>
            </Box>
          )}

          {formState && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                border: '1px solid',
                borderColor: 'border.default',
                borderRadius: 2,
                p: 3,
                mt: 3,
              }}
            >
              <Heading as="h2" sx={{ fontSize: 1 }}>
                {formState.methodId ? 'Editar chave PIX' : 'Adicionar chave PIX'}
              </Heading>
              {formError && (
                <Flash variant="danger" role="alert">
                  {formError}
                </Flash>
              )}
              <FormControl required disabled={saving}>
                <FormControl.Label>Nome identificador</FormControl.Label>
                <TextInput
                  block
                  maxLength={80}
                  placeholder="Ex.: Conta principal"
                  value={formState.label}
                  onChange={(event) => setFormState({ ...formState, label: event.target.value })}
                />
              </FormControl>
              <FormControl required disabled={saving}>
                <FormControl.Label>Tipo da chave</FormControl.Label>
                <Select
                  value={formState.keyType}
                  onChange={(event) => setFormState({ ...formState, keyType: event.target.value })}
                >
                  {PIX_KEY_TYPE_OPTIONS.map((option) => (
                    <Select.Option key={option.value} value={option.value}>
                      {option.label}
                    </Select.Option>
                  ))}
                </Select>
              </FormControl>
              <FormControl required disabled={saving}>
                <FormControl.Label>Chave PIX</FormControl.Label>
                <TextInput
                  block
                  maxLength={200}
                  value={formState.key}
                  onChange={(event) => setFormState({ ...formState, key: event.target.value })}
                />
              </FormControl>
              <FormControl required disabled={saving}>
                <FormControl.Label>Nome/razão social do recebedor</FormControl.Label>
                <TextInput
                  block
                  maxLength={140}
                  value={formState.recipientName}
                  onChange={(event) =>
                    setFormState({ ...formState, recipientName: event.target.value })
                  }
                />
              </FormControl>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                <Button type="button" disabled={saving} onClick={cancelForm}>
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  loading={saving}
                  disabled={!isValidPixMethodForm(formState)}
                  onClick={submitForm}
                >
                  Salvar
                </Button>
              </Box>
            </Box>
          )}
        </>
      )}
    </div>
  )
}
