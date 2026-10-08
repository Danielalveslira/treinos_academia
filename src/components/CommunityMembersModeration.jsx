import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box,
  Button,
  Flash,
  FormControl,
  Label,
  Link,
  Spinner,
  Text,
  Textarea,
} from '@primer/react'
import { useAuth } from '../hooks/useAuth'
import { listCommunityMembers } from '../services/communityMembersService'
import {
  listCommunityRestrictions,
  setCommunityMemberBan,
} from '../services/communityModerationService'
import { listPublicUsernames } from '../services/publicProfilesService'
import { memberHandle } from '../utils/memberHandle'

// Mesmo mínimo de 5 caracteres trimados que o servidor exige (community-moderation-
// service.js) -- só evita gastar uma chamada que sabidamente falharia.
function canSubmitBanReason(reason) {
  return typeof reason === 'string' && reason.trim().length >= 5
}

// Fase 5 -- lista de membros + banir/desbanir de UMA comunidade, usando exclusivamente
// o caminho dedicado (setCommunityMemberBan/community-moderation-service.js). Nunca
// decideSupportRequest, nunca accountRestrictions. Renderizado só onde o chamador já
// confirmou canModerateCommunity (CommunityDetail.jsx) -- as Rules de leitura de
// communityMembers/communityRestrictions (isCommunityOwner) são a autoridade de
// verdade, isto é só a UI.
export function CommunityMembersModeration({ communityId, ownerId = null }) {
  const { user } = useAuth()
  const [members, setMembers] = useState([])
  const [restrictionsByUserId, setRestrictionsByUserId] = useState({})
  const [usernames, setUsernames] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [banningUserId, setBanningUserId] = useState(null)
  const [reasonDraft, setReasonDraft] = useState('')
  const [actionError, setActionError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [memberList, restrictionList] = await Promise.all([
        listCommunityMembers(communityId),
        listCommunityRestrictions(communityId),
      ])
      setMembers(memberList)
      setRestrictionsByUserId(Object.fromEntries(restrictionList.map((r) => [r.userId, r])))
      // @usuário em vez do id da conta: leitura em lote; se falhar, a lista continua útil (mostra
      // "Membro") e nunca cai para o id.
      setUsernames(
        await listPublicUsernames(memberList.map((m) => m.userId)).catch((err) => {
          console.error('[CommunityMembersModeration] usernames:', err)
          return {}
        })
      )
    } catch (err) {
      console.error('[CommunityMembersModeration] load:', err)
      setError('Não foi possível carregar os membros da comunidade.')
    } finally {
      setLoading(false)
    }
  }, [communityId])

  useEffect(() => {
    load()
  }, [load])

  function startBan(userId) {
    setBanningUserId(userId)
    setReasonDraft('')
    setActionError('')
  }
  function cancelBan() {
    setBanningUserId(null)
    setActionError('')
  }

  async function confirmBan(userId) {
    if (saving) return
    setSaving(true)
    setActionError('')
    try {
      await setCommunityMemberBan({
        communityId,
        targetUserId: userId,
        banned: true,
        reason: reasonDraft,
      })
      setBanningUserId(null)
      await load()
    } catch (err) {
      console.error('[CommunityMembersModeration] ban:', err)
      setActionError(
        [
          'functions/failed-precondition',
          'functions/invalid-argument',
          'functions/permission-denied',
        ].includes(err?.code)
          ? err.message
          : 'Não foi possível banir este membro.'
      )
    } finally {
      setSaving(false)
    }
  }

  async function unban(userId) {
    if (saving) return
    setSaving(true)
    setActionError('')
    try {
      await setCommunityMemberBan({ communityId, targetUserId: userId, banned: false })
      await load()
    } catch (err) {
      console.error('[CommunityMembersModeration] unban:', err)
      setActionError(
        [
          'functions/failed-precondition',
          'functions/invalid-argument',
          'functions/permission-denied',
        ].includes(err?.code)
          ? err.message
          : 'Não foi possível desbanir este membro.'
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner aria-label="Carregando membros" />

  return (
    <Box sx={{ mt: 3 }}>
      {error && (
        <Flash variant="danger" sx={{ mb: 2 }}>
          {error} <Button onClick={load}>Tentar novamente</Button>
        </Flash>
      )}
      {actionError && (
        <Flash variant="danger" role="alert" sx={{ mb: 2 }}>
          {actionError}
        </Flash>
      )}
      {members.map((member) => {
        const restriction = restrictionsByUserId[member.userId]
        const isSelf = member.userId === user.uid
        const handle = memberHandle(usernames[member.userId])
        const isOwner = member.role === 'owner' || (ownerId !== null && member.userId === ownerId)
        return (
          <Box
            key={member.id}
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 2,
              borderBottom: '1px solid',
              borderColor: 'border.muted',
              py: 2,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Link as={RouterLink} to={`/comunidades/perfil/${member.userId}`}>
                {handle}
              </Link>
              {isOwner && <Label variant="accent">Dono</Label>}
              {restriction && <Label variant="danger">Banido</Label>}
            </Box>
            {!isSelf && !isOwner && (
              <Box>
                {restriction ? (
                  <Button
                    onClick={() => unban(member.userId)}
                    disabled={saving}
                    aria-label={`Desbanir ${handle}`}
                  >
                    Desbanir
                  </Button>
                ) : banningUserId === member.userId ? null : (
                  <Button
                    variant="danger"
                    onClick={() => startBan(member.userId)}
                    disabled={saving}
                    aria-label={`Banir ${handle}`}
                  >
                    Banir
                  </Button>
                )}
              </Box>
            )}
            {banningUserId === member.userId && (
              <Box sx={{ width: '100%' }}>
                <FormControl required disabled={saving}>
                  <FormControl.Label>Motivo do banimento de {handle}</FormControl.Label>
                  <Textarea
                    block
                    required
                    minLength={5}
                    maxLength={500}
                    rows={2}
                    value={reasonDraft}
                    onChange={(event) => setReasonDraft(event.target.value)}
                  />
                </FormControl>
                <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                  <Button type="button" disabled={saving} onClick={cancelBan}>
                    Voltar
                  </Button>
                  <Button
                    variant="danger"
                    loading={saving}
                    disabled={!canSubmitBanReason(reasonDraft)}
                    onClick={() => confirmBan(member.userId)}
                  >
                    Confirmar banimento
                  </Button>
                </Box>
              </Box>
            )}
          </Box>
        )
      })}
      {members.length === 0 && (
        <Text as="p" sx={{ color: 'fg.muted' }}>
          Nenhum membro encontrado.
        </Text>
      )}
    </Box>
  )
}
