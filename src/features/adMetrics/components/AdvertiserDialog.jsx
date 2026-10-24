import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  Flash,
  FormControl,
  Radio,
  RadioGroup,
  Spinner,
  Text,
  TextInput,
} from '@primer/react'
import { useAdvertiserPage } from '../hooks/useAdvertiserPage'
import { advertiserError } from '../utils/advertiserAdmin'

const TITLES = {
  create: 'Novo anunciante',
  rename: 'Renomear anunciante',
  link: 'Vincular campanha',
  grant: 'Conceder acesso',
  revoke: 'Revogar acesso',
  deactivate: 'Desativar conta',
  activate: 'Reativar conta',
}
const CONFIRM = {
  create: 'Criar anunciante',
  rename: 'Salvar nome',
  link: 'Confirmar vinculação',
  grant: 'Confirmar acesso',
  revoke: 'Revogar acesso',
  deactivate: 'Desativar conta',
  activate: 'Reativar conta',
}

// One Primer Dialog for the account action. The picker is mounted only for link/grant.
export function AdvertiserDialog({
  kind,
  account,
  member,
  authorizedIds = [],
  onConfirm,
  onClose,
  returnFocusRef,
}) {
  const [name, setName] = useState(kind === 'rename' ? account.name : '')
  const [selected, setSelected] = useState(null)
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [nameError, setNameError] = useState('')
  const inputRef = useRef(null)
  const locked = useRef(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  // No state updates from operations completing after account/session switch.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const isName = kind === 'create' || kind === 'rename'
  const isPicker = kind === 'link' || kind === 'grant'
  const dangerous = kind === 'revoke' || kind === 'deactivate'
  async function submit() {
    if (locked.current) return
    if (isName && (!name.trim() || name.trim().length > 120)) {
      setNameError('Informe o nome da empresa, com até 120 caracteres.')
      inputRef.current?.focus()
      return
    }
    if (isPicker && (!selected || (kind === 'link' && !accepted))) return
    if (kind === 'grant' && authorizedIds.includes(selected.id)) {
      setError('Este usuário já tem acesso de visualização.')
      return
    }
    locked.current = true
    setBusy(true)
    setError('')
    try {
      await onConfirm({ name: name.trim(), selected })
      if (live.current) closeRef.current()
    } catch (err) {
      if (live.current) setError(advertiserError(err))
    } finally {
      locked.current = false
      if (live.current) setBusy(false)
    }
  }
  // The native dialog's focus trap and restoration handle Escape, Tab and close.
  return (
    <Dialog
      title={TITLES[kind]}
      subtitle={
        kind === 'create' ? 'Cadastre a empresa para organizar campanhas e acessos.' : account.name
      }
      width="large"
      position={{ narrow: 'bottom', regular: 'center' }}
      onClose={() => {
        if (!locked.current) onClose()
      }}
      initialFocusRef={isName ? inputRef : undefined}
      returnFocusRef={returnFocusRef}
      footerButtons={[
        { content: 'Cancelar', disabled: busy, onClick: onClose },
        {
          content: busy ? 'Salvando…' : CONFIRM[kind],
          buttonType: dangerous ? 'danger' : 'primary',
          disabled: busy || (isPicker && (!selected || (kind === 'link' && !accepted))),
          onClick: submit,
        },
      ]}
    >
      <Box sx={{ display: 'grid', gap: 3, p: 3, minWidth: 0 }} aria-busy={busy}>
        {error && (
          <Flash role="alert" variant="danger">
            {error}
          </Flash>
        )}
        {isName && (
          <Box
            as="form"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <FormControl required disabled={busy}>
              <FormControl.Label>Nome da empresa</FormControl.Label>
              <TextInput
                ref={inputRef}
                block
                maxLength={120}
                value={name}
                aria-invalid={Boolean(nameError)}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameError('')
                }}
              />
              {nameError && (
                <FormControl.Validation variant="error">{nameError}</FormControl.Validation>
              )}
            </FormControl>
          </Box>
        )}
        {isPicker && (
          <AdvertiserPicker
            kind={kind}
            account={account}
            authorizedIds={authorizedIds}
            disabled={busy}
            onSelect={(row) => {
              setSelected(row)
              setAccepted(false)
              setError('')
            }}
          />
        )}
        {selected && (
          <Box sx={{ p: 2, bg: 'canvas.subtle', borderRadius: 2, overflowWrap: 'anywhere' }}>
            <Text sx={{ display: 'block', fontWeight: 'bold' }}>
              {kind === 'link'
                ? selected.title || selected.partner_name || 'Campanha histórica'
                : `@${selected.username}`}
            </Text>
            <Text sx={{ display: 'block', fontSize: 1, color: 'fg.muted' }}>
              Empresa de destino: {account.name}
            </Text>
            {kind === 'grant' && (
              <Text sx={{ display: 'block', fontSize: 1 }}>
                Permissão: Visualização. Não permite editar campanhas ou números.
              </Text>
            )}
          </Box>
        )}
        {kind === 'link' && (
          <>
            <Flash variant="warning">
              O vínculo inclui todo o histórico do anúncio e não poderá ser transferido diretamente
              para outra empresa.
            </Flash>
            <FormControl disabled={!selected || busy}>
              <Checkbox checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              <FormControl.Label>
                Confirmo a vinculação permanente a {account.name}.
              </FormControl.Label>
            </FormControl>
          </>
        )}
        {kind === 'revoke' && (
          <Text>
            Revogar o acesso de <b>@{member.username}</b> aos relatórios de <b>{account.name}</b>?
            As novas consultas serão bloqueadas e o histórico será preservado.
          </Text>
        )}
        {kind === 'deactivate' && (
          <Text>
            Desativar <b>{account.name}</b>? Os acessos aos relatórios serão bloqueados para todos
            os usuários. Campanhas vinculadas e histórico serão preservados. A veiculação dos
            anúncios não será alterada por esta ação.
          </Text>
        )}
        {kind === 'activate' && (
          <Text>
            Reativar <b>{account.name}</b>? Os usuários com acesso não revogado poderão voltar a
            consultar os relatórios.
          </Text>
        )}
      </Box>
    </Dialog>
  )
}

function AdvertiserPicker({ kind, account, authorizedIds, disabled, onSelect }) {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [validation, setValidation] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const users = kind === 'grant'
  const page = useAdvertiserPage(
    'admin_advertiser_directory',
    { p_kind: users ? 'users' : 'campaigns', ...(users ? { p_search: submitted } : {}) },
    !users || submitted.length >= 3
  )
  const rows = users
    ? page.rows
    : page.rows.filter((row) =>
        `${row.title || ''} ${row.partner_name || ''}`
          .toLocaleLowerCase('pt-BR')
          .includes(query.trim().toLocaleLowerCase('pt-BR'))
      )
  const loading = page.status === 'loading'
  const reset = () => {
    setSelectedId('')
    onSelect(null)
  }
  return (
    <Box sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
      <Box
        as="form"
        onSubmit={(e) => {
          e.preventDefault()
          if (!users) return
          if (query.trim().length < 3) {
            setValidation('Digite pelo menos 3 caracteres do nome de usuário.')
            return
          }
          setValidation('')
          reset()
          if (submitted === query.trim()) page.refresh()
          else setSubmitted(query.trim())
        }}
        sx={{ display: 'grid', gap: 2 }}
      >
        <FormControl disabled={disabled}>
          <FormControl.Label>
            {users ? 'Nome de usuário' : 'Pesquisar campanhas disponíveis'}
          </FormControl.Label>
          <TextInput
            block
            maxLength={120}
            value={query}
            aria-invalid={Boolean(validation)}
            onChange={(e) => {
              setQuery(e.target.value)
              setValidation('')
              reset()
              if (users) setSubmitted('')
            }}
          />
          <FormControl.Caption>
            {users
              ? 'Busque pelo username de um usuário já cadastrado. Mínimo de 3 caracteres.'
              : 'Campanhas sem anunciante. A busca considera os itens carregados; carregue mais para ampliar os resultados.'}
          </FormControl.Caption>
          {validation && (
            <FormControl.Validation variant="error">{validation}</FormControl.Validation>
          )}
        </FormControl>
        {users && (
          <Button type="submit" disabled={disabled || loading}>
            Buscar usuários
          </Button>
        )}
      </Box>
      {loading && (
        <Box role="status" sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <Spinner size="small" />
          Carregando resultados…
        </Box>
      )}
      {page.error && (
        <Flash variant="danger" role="alert">
          {advertiserError(page.error)}{' '}
          <Button size="small" disabled={loading} onClick={() => page.refresh()}>
            Tentar novamente
          </Button>
        </Flash>
      )}
      {page.status === 'ready' && !rows.length && (
        <Text role="status">
          {users
            ? 'Nenhum usuário encontrado.'
            : page.hasMore
              ? 'Nenhuma campanha encontrada entre os itens carregados.'
              : 'Nenhuma campanha disponível para esta busca.'}
        </Text>
      )}
      {rows.length > 0 && (
        <RadioGroup
          name="advertiser-selection"
          onChange={(id) => {
            setSelectedId(id)
            onSelect(rows.find((row) => row.id === id))
          }}
          disabled={disabled || loading}
        >
          <RadioGroup.Label>
            {users ? 'Selecione um usuário' : 'Selecione uma campanha'}
          </RadioGroup.Label>
          {rows.map((row) => {
            const already = users && authorizedIds.includes(row.id)
            return (
              <FormControl key={row.id} disabled={already || disabled || loading}>
                <Radio value={row.id} checked={selectedId === row.id} />
                <FormControl.Label sx={{ overflowWrap: 'anywhere' }}>
                  {users
                    ? `@${row.username}`
                    : row.title || row.partner_name || 'Campanha histórica'}
                </FormControl.Label>
                <FormControl.Caption>
                  {already
                    ? 'Já tem acesso de visualização.'
                    : users
                      ? 'Usuário cadastrado · Visualização'
                      : row.deleted
                        ? 'Campanha excluída · histórico preservado'
                        : 'Campanha disponível'}
                </FormControl.Caption>
              </FormControl>
            )
          })}
        </RadioGroup>
      )}
      {page.hasMore && (
        <Button disabled={disabled || loading} onClick={page.more}>
          Carregar mais {users ? 'usuários' : 'campanhas disponíveis'}
        </Button>
      )}
      {!users && (
        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
          A disponibilidade é global. Nenhuma campanha é atribuída a {account.name} sem sua
          confirmação.
        </Text>
      )}
    </Box>
  )
}
