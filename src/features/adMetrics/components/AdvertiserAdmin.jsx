import { useEffect, useRef, useState } from 'react'
import { Box, Button, Flash, FormControl, Heading, Select, Text } from '@primer/react'
import { PlusIcon } from '@primer/octicons-react'
import { useAuth } from '../../../hooks/useAuth'
import { useToast } from '../../../hooks/useToast'
import { ToastFlash } from '../../../components/ToastFlash'
import { advertiserRpc } from '../api/advertisers.api'
import { useAdvertiserPage } from '../hooks/useAdvertiserPage'
import { advertiserError, isAdvertiserAccessDenied } from '../utils/advertiserAdmin'
import { AdvertiserDialog } from './AdvertiserDialog'
import { AdvertiserAccountPanel, AdvertiserLoading as Loading } from './AdvertiserAccountPanel'

export default function AdvertiserAdmin() {
  const { user } = useAuth()
  return <AdvertiserWorkspace key={user?.uid || 'anonymous'} />
}

function AdvertiserWorkspace() {
  const accounts = useAdvertiserPage('list_advertiser_accounts')
  const [selection, setSelection] = useState(null)
  const [creating, setCreating] = useState(false)
  const [denied, setDenied] = useState(false)
  const { toasts, showToast } = useToast()
  const createButton = useRef(null)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const account = selection && (accounts.rows.find((row) => row.id === selection.id) || selection)
  const loading = accounts.status === 'loading'
  const accessDenied = denied || isAdvertiserAccessDenied(accounts.error)
  function deny() {
    setDenied(true)
    setSelection(null)
    setCreating(false)
  }
  return (
    <Box>
      <Heading as="h2" sx={{ fontSize: 2, mb: 1 }}>
        Anunciantes
      </Heading>
      <Text as="p" sx={{ color: 'fg.muted', mt: 0, mb: 3, fontSize: 1 }}>
        Gerencie empresas anunciantes, campanhas vinculadas e permissões de acesso aos relatórios.
      </Text>
      <Box role="status" aria-live="polite">
        <ToastFlash toasts={toasts} />
      </Box>
      {(accounts.error || accessDenied) && (
        <Flash role="alert" variant="danger" sx={{ mb: 3 }}>
          {advertiserError(accessDenied ? { code: '42501' } : accounts.error)}
          <Button
            sx={{ ml: 2 }}
            size="small"
            onClick={() => {
              setDenied(false)
              setSelection(null)
              accounts.refresh()
            }}
          >
            Tentar novamente
          </Button>
        </Flash>
      )}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'end', flexWrap: 'wrap', mb: 2 }}>
        <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
          <FormControl disabled={loading || accessDenied}>
            <FormControl.Label>Anunciante</FormControl.Label>
            <Select
              block
              value={account?.id || ''}
              onChange={(e) => {
                setSelection(accounts.rows.find((row) => row.id === e.target.value) || null)
                setCreating(false)
              }}
            >
              <Select.Option value="">Selecione um anunciante</Select.Option>
              {accounts.rows.map((row) => (
                <Select.Option key={row.id} value={row.id}>
                  {row.name}
                </Select.Option>
              ))}
            </Select>
          </FormControl>
        </Box>
        <Button
          ref={createButton}
          leadingVisual={PlusIcon}
          disabled={accessDenied || loading || Boolean(accounts.error)}
          onClick={() => setCreating(true)}
        >
          Novo anunciante
        </Button>
      </Box>
      {accounts.hasMore && (
        <Button variant="invisible" disabled={loading} onClick={accounts.more}>
          Carregar mais anunciantes
        </Button>
      )}
      {loading && <Loading message="Carregando anunciantes…" />}
      {!loading && !accounts.error && !accessDenied && !account && (
        <Text as="p" sx={{ color: 'fg.muted', my: 3 }}>
          {accounts.rows.length
            ? 'Selecione um anunciante para ver suas campanhas e os usuários com acesso.'
            : 'Nenhum anunciante cadastrado. Comece em Novo anunciante.'}
        </Text>
      )}
      {account && !accessDenied && (
        <AdvertiserAccountPanel
          key={account.id}
          account={account}
          showToast={showToast}
          onDenied={deny}
          onAccountChange={(next) => {
            setSelection(next)
            accounts.patch((rows) => rows.map((row) => (row.id === next.id ? next : row)))
          }}
        />
      )}
      {creating && (
        <AdvertiserDialog
          kind="create"
          onClose={() => setCreating(false)}
          returnFocusRef={createButton}
          onConfirm={async ({ name }) => {
            try {
              const id = await advertiserRpc('admin_manage_advertiser', {
                p_operation: 'create',
                p_name: name,
              })
              if (!live.current) return
              const created = { id, name, active: true }
              accounts.patch((rows) => [...rows, created])
              setSelection(created)
              showToast('Anunciante criado.')
            } catch (error) {
              if (live.current && isAdvertiserAccessDenied(error)) deny()
              throw error
            }
          }}
        />
      )}
    </Box>
  )
}
