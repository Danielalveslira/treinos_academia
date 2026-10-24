import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Button, Text, TextInput, Select, Flash, Heading, Spinner } from '@primer/react'
import { advertiserRpc, readCatalog } from '../api/advertisers.api'

export default function AdvertiserAdmin() {
  const [accounts, setAccounts] = useState([])
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [draft, setDraft] = useState('')
  const [members, setMembers] = useState([])
  const [unassigned, setUnassigned] = useState([])
  const [linked, setLinked] = useState([])
  const [search, setSearch] = useState('')
  const [users, setUsers] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const account = accounts.find((a) => a.id === id)
  useEffect(() => {
    let live = true
    setBusy(true)
    Promise.all([
      readCatalog('list_advertiser_accounts'),
      readCatalog('admin_advertiser_directory', { p_kind: 'campaigns' }),
      id ? readCatalog('admin_advertiser_directory', { p_kind: 'members', p_account_id: id }) : [],
      id
        ? readCatalog('admin_advertiser_directory', { p_kind: 'campaigns', p_account_id: id })
        : [],
    ])
      .then(([a, c, m, l]) => {
        if (live) {
          setAccounts(a)
          setUnassigned(c)
          setMembers(m)
          setLinked(l)
          setDraft(a.find((x) => x.id === id)?.name || '')
        }
      })
      .catch(() => {
        if (live) {
          setAccounts([])
          setMembers([])
          setLinked([])
          setError('Não foi possível carregar a administração de anunciantes.')
        }
      })
      .finally(() => {
        if (live) setBusy(false)
      })
    return () => {
      live = false
    }
  }, [id, version])
  async function mutate(action, subjectId = null, accountName = null, active = true) {
    setBusy(true)
    setError('')
    try {
      const result = await advertiserRpc('admin_manage_advertiser', {
        p_operation: action,
        p_account_id: id || null,
        p_name: accountName,
        p_active: active,
        p_subject_id: subjectId,
      })
      if (action === 'create') {
        setId(result)
        setName('')
      }
      setVersion((v) => v + 1)
    } catch (e) {
      setError(
        /IMMUTABLE|duplicate key/.test(e.message)
          ? 'Titularidade imutável: crie outra campanha para outro anunciante.'
          : 'Operação não concluída. Verifique os campos e sua autorização.'
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <Box>
      <Heading as="h2" sx={{ fontSize: 2, mb: 2 }}>
        Contas de anunciantes
      </Heading>
      {error && (
        <Flash variant="danger" sx={{ mb: 2 }}>
          {error}
        </Flash>
      )}
      {busy && <Spinner size="small" aria-label="Processando anunciantes" />}
      <Box
        as="form"
        sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault()
          mutate('create', null, name)
        }}
      >
        <TextInput
          aria-label="Nome da nova conta"
          value={name}
          maxLength={120}
          required
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={busy || !name.trim()}>
          Criar anunciante
        </Button>
      </Box>
      <Select
        block
        aria-label="Administrar conta"
        value={id}
        disabled={busy}
        onChange={(e) => {
          setId(e.target.value)
          setUsers([])
          setSearch('')
          setError('')
        }}
      >
        <Select.Option value="">Selecione uma conta</Select.Option>
        {accounts.map((a) => (
          <Select.Option key={a.id} value={a.id}>
            {a.name}
            {!a.active ? ' (desativada)' : ''}
          </Select.Option>
        ))}
      </Select>
      {account && (
        <Box sx={{ mt: 3 }}>
          <Box
            as="form"
            sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}
            onSubmit={(e) => {
              e.preventDefault()
              mutate('update', null, draft, account.active)
            }}
          >
            <TextInput
              aria-label="Nome público da conta"
              required
              maxLength={120}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button type="submit" disabled={busy}>
              Salvar nome
            </Button>
            <Button
              disabled={busy}
              onClick={() => mutate('update', null, account.name, !account.active)}
            >
              {account.active ? 'Desativar conta' : 'Reativar conta'}
            </Button>
            <Button as={Link} to={`/meus-anuncios?accountId=${id}`}>
              Conferir portal autorizado
            </Button>
          </Box>
          <Heading as="h3" sx={{ fontSize: 1, mb: 2 }}>
            Leitores
          </Heading>
          <Box
            as="form"
            sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              setError('')
              setUsers([])
              try {
                setUsers(
                  await readCatalog('admin_advertiser_directory', {
                    p_kind: 'users',
                    p_search: search,
                  })
                )
              } catch {
                setError('Não foi possível buscar usuários.')
              } finally {
                setBusy(false)
              }
            }}
          >
            <TextInput
              aria-label="Buscar usuário pelo nome de usuário"
              minLength={3}
              maxLength={120}
              required
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button type="submit" disabled={busy}>
              Buscar usuário existente
            </Button>
          </Box>
          {users.map((u) => (
            <Box key={u.id} sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <Text>{u.username}</Text>
              <Button disabled={busy} onClick={() => mutate('grant', u.id)}>
                Conceder leitura
              </Button>
            </Box>
          ))}
          {members.map((m) => (
            <Box key={m.id} sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
              <Text>
                {m.username} · {m.revoked_at ? 'Revogado' : 'viewer'} · {m.granted_at}
              </Text>
              {!m.revoked_at && (
                <Button disabled={busy} onClick={() => mutate('revoke', m.id)}>
                  Revogar leitura
                </Button>
              )}
            </Box>
          ))}
          <Heading as="h3" sx={{ fontSize: 1, mt: 3, mb: 2 }}>
            Campanhas vinculadas
          </Heading>
          {linked.length === 0 && <Text>Nenhuma campanha vinculada.</Text>}
          {linked.map((c) => (
            <Text key={c.id} sx={{ display: 'block', mb: 2 }}>
              {c.title || c.partner_name} ·{' '}
              {c.deleted ? 'Removida; histórico preservado' : 'Anúncio existente'}
            </Text>
          ))}
          <Heading as="h3" sx={{ fontSize: 1, mt: 3, mb: 2 }}>
            Campanhas não atribuídas
          </Heading>
          <Text sx={{ display: 'block', mb: 2, fontSize: 0 }}>
            Confira a empresa antes de vincular. O vínculo inclui todo o histórico e não pode ser
            transferido; para outra empresa crie um novo anúncio.
          </Text>
          {unassigned.map((c) => (
            <Box key={c.id} sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
              <Text>
                {c.title || c.partner_name}
                {c.deleted ? ' (removida)' : ''}
              </Text>
              <Button disabled={busy} onClick={() => mutate('link', c.id)}>
                Vincular à conta selecionada
              </Button>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
