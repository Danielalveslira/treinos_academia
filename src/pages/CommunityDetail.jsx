import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Box, Heading, Button, Spinner } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { PeopleIcon } from '@primer/octicons-react'
import { useAuth } from '../hooks/useAuth'
import { useSingleFlight } from '../hooks/useSingleFlight'
import { useCommunityFeed } from '../hooks/useCommunityFeed'
import { useUpcomingWorkouts } from '../hooks/useUpcomingWorkouts'
import { useSponsoredAds } from '../hooks/useSponsoredAds'
import { useMyEconomyVotes } from '../hooks/useMyEconomyVotes'
import { useCommunityAuthorAvatars } from '../hooks/useCommunityAuthorAvatars'
import { useFeedScrollMemory } from '../hooks/useFeedScrollMemory'
import { useToast } from '../hooks/useToast'
import { useConfirmDelete } from '../hooks/useConfirmDelete'
import {
  getCommunity,
  updateCommunity,
  setCommunityActive,
  deleteCommunity,
} from '../services/communitiesService'
import {
  getCommunityAccess,
  joinCommunity,
  leaveCommunity,
} from '../services/communityMembersService'
import { canModerateCommunity } from '../utils/communityOwnership'
import {
  accessAfterJoin,
  communityContentCachePrefixes,
  describeJoinFailure,
  normalizeCommunityAccess,
  shouldPurgeCommunityState,
} from '../utils/communityAccess'
import {
  createPhotoStatus,
  createTextStatus,
  createPollStatus,
  createWorkoutStatus,
  getSharedStatus,
} from '../services/statusesService'
import { describeQueryError } from '../utils/queryError'
import {
  fetchCached,
  getCached,
  invalidateCache,
  invalidateCommunitiesCache,
  setCached,
} from '../utils/pageCache'
import { CommunityFeedSection } from '../components/CommunityFeedSection'
import { CommunityHeader } from '../components/CommunityHeader'
import { CommunityAccessNotice } from '../components/CommunityAccessNotice'
import { classifyReadError } from '../services/offline/readError'
import { LazyDialogBoundary } from '../components/LazyDialogBoundary'
import { ErrorState } from '../components/ErrorState'
import { ToastFlash } from '../components/ToastFlash'
import { listFeaturedStatusesForCommunity } from '../services/promotionsService'
import { toMillis } from '../utils/expiry.js'
import { expiresAtForRetention } from '../utils/postRetention'
import { readAdHint, writeAdHint } from '../utils/adSlotHint'
import { applyEconomyVoteCountDeltaToList } from '../utils/economyVoteCountDelta'
import { publicationIdFromHash } from '../utils/share'
import { isStatusLoaded } from '../utils/sharedStatus'
import '../styles/community-feed.css'

// Painel de gestão, promoção da comunidade: só o dono/superadmin abre; ficam fora do carregamento
// inicial da comunidade (quase ninguém os usa a cada visita).
// Prazo máximo que o bloco da comunidade espera pelos anúncios para entrarem juntos com o conteúdo (ver holdForAds).
const ADS_HOLD_MS = 300
const NO_ADS = []
const CommunityForm = lazy(() =>
  import('../components/CommunityForm').then((module) => ({ default: module.CommunityForm }))
)
const CommunityMembersModeration = lazy(() =>
  import('../components/CommunityMembersModeration').then((module) => ({
    default: module.CommunityMembersModeration,
  }))
)
const PromoteDialog = lazy(() =>
  import('../components/PromoteDialog').then((module) => ({ default: module.PromoteDialog }))
)

function CommunityDetail({ id }) {
  const navigate = useNavigate()
  const { user, profile, isSuperAdmin } = useAuth()
  const { toasts, showToast } = useToast()
  const confirmDelete = useConfirmDelete()

  // Cabeçalho + associação em cache de sessão (por usuário e comunidade). A chave começa com
  // `communities:{uid}`, então entrar/sair/criar/excluir em QUALQUER tela (invalidateCommunitiesCache) a
  // derruba. Voltar de outra tela repinta na hora, sem refazer as leituras; "Atualizar" revalida.
  const pageKey = `communities:${user.uid}:page:${id}`
  const cachedPage = getCached(pageKey)
  const [community, setCommunity] = useState(cachedPage?.community ?? null)
  // Estado de acesso vindo do servidor (member | not_member | banned | unavailable). A cópia em cache
  // serve só para repintar rápido: toda abertura da página revalida no servidor (ver o efeito abaixo)
  // e quem não é mais membro perde também as caches de conteúdo.
  const [access, setAccess] = useState(cachedPage?.access ?? 'not_member')
  const member = access === 'member'
  const accessRef = useRef(access)
  const [membershipPending, setMembershipPending] = useState(false)
  const [loadingCommunity, setLoadingCommunity] = useState(!cachedPage)
  const [communityError, setCommunityError] = useState(null)
  const { hash } = useLocation()
  const [sharedStatus, setSharedStatus] = useState(null)
  const sharedStatusRequested = useRef('')
  const sharedAnchorScrolled = useRef('')
  const [formOpen, setFormOpen] = useState(false)
  const [managing, setManaging] = useState(false)

  const {
    statuses,
    hasMore,
    loading: loadingFeed,
    loadingMore,
    refreshing,
    refreshEpoch,
    error: feedError,
    moreError,
    refresh: refreshFeed,
    loadMore,
    addStatusLocally,
    remove,
    updateEconomyVoteCounts,
    updateCommentCount,
    updatePostPromotion,
  } = useCommunityFeed(id, member, user.uid)

  const {
    workouts: upcomingWorkouts,
    loading: loadingUpcomingWorkouts,
    error: upcomingWorkoutsError,
    refresh: refreshUpcomingWorkouts,
    setWorkouts: setUpcomingWorkouts,
  } = useUpcomingWorkouts(id, member)

  const featuredKey = `communities:${user.uid}:featured:${id}`
  const [featuredStatuses, setFeaturedStatusesState] = useState(() => getCached(featuredKey) ?? [])
  const [featuredLoaded, setFeaturedLoaded] = useState(() => getCached(featuredKey) !== undefined)

  // Anúncios saem em paralelo com a verificação de participação (enquanto a comunidade ainda carrega) em vez
  // de depois dela: a lista é pequena e, chegando antes dos posts, banner e cards entram junto com o conteúdo
  // em vez de empurrar publicações já visíveis (CLS). Não vaza nada: a RLS de sponsored_ads só devolve linhas
  // que o usuário pode ver (quem não participa recebe lista vazia); depois de confirmado que NÃO é membro a
  // consulta é desligada, e entrar na comunidade invalida a lista vazia guardada (handleJoin).
  const {
    feedAds,
    inlineFeedAds,
    bannerAds,
    loading: loadingAds,
    error: adsError,
  } = useSponsoredAds(id, member || loadingCommunity)
  // Reserva espaço (banner + altura do bloco de cards do topo) enquanto a consulta volta, SÓ se esta comunidade
  // já teve anúncios na última visita (dica local). Ver utils/adSlotHint.js.
  const adHint = useMemo(() => readAdHint(user.uid, id), [user.uid, id])
  const topAdsHeightRef = useRef(0)
  const setTopAdsHeight = useCallback((px) => {
    topAdsHeightRef.current = px
  }, [])
  const adsSettled = member && !loadingAds && !adsError
  // Coordenação anúncios x conteúdo: sem dica COMPLETA de espaço, o bloco da comunidade (barra de ferramentas + feed)
  // espera a lista de anúncios por no máximo ADS_HOLD_MS, mostrando o mesmo spinner de "carregando comunidade".
  // Assim banner e cards entram JUNTO com o resto em vez de empurrar o que já está na tela. Nunca atrasa o feed: o
  // fetch dos posts corre em paralelo (useCommunityFeed) e a espera acaba na hora em que os posts chegam, os
  // anúncios resolvem ou o prazo vence -- o que vier primeiro.
  const hintComplete =
    (adHint.banner || adHint.feedOnly) && (!adHint.feedOnly || adHint.feedTop > 0)
  // Os destaques ("Em destaque") têm consulta própria e também inserem um card acima das publicações: entram na mesma
  // espera, pelo mesmo motivo.
  const waitingForAds = member && loadingFeed && ((loadingAds && !hintComplete) || !featuredLoaded)
  const [adsHoldExpired, setAdsHoldExpired] = useState(false)
  useEffect(() => {
    if (!waitingForAds) return undefined
    const timer = setTimeout(() => setAdsHoldExpired(true), ADS_HOLD_MS)
    return () => clearTimeout(timer)
  }, [waitingForAds])
  useEffect(() => {
    setAdsHoldExpired(false)
  }, [id])
  const holdForAds = waitingForAds && !adsHoldExpired
  // Anúncios que chegam DEPOIS de a comunidade já estar na tela, sem espaço reservado. Nas visitas seguintes a dica
  // de espaço restaura o topo para os cards.
  const [lateAds, setLateAds] = useState(false)
  useEffect(() => {
    setLateAds(false)
  }, [id])
  useEffect(() => {
    if (member && !holdForAds && loadingAds && !hintComplete) setLateAds(true)
  }, [member, holdForAds, loadingAds, hintComplete])
  // Só os cards de feed têm posição flexível ("card no feed da comunidade"): se chegaram tarde e não há altura
  // reservada para o bloco do topo, entram dentro do feed em vez de empurrar publicações já visíveis. O BANNER é o
  // "banner rotativo do topo" e fica SEMPRE no topo (espaço reservado pela dica quando já se sabe que existe; sem
  // dica, o custo de um banner tardio é um único deslocamento de ~100 px, só na 1ª visita com anúncio atrasado).
  const cardsLate = lateAds && !(adHint.feedTop > 0)
  useEffect(() => {
    if (!adsSettled) return
    writeAdHint(user.uid, id, {
      banner: bannerAds.length > 0,
      // -1 = há cards só de feed, mas entraram tarde dentro do feed (altura do topo não medida)
      feedTop: feedAds.length > 0 ? topAdsHeightRef.current || -1 : 0,
    })
  }, [adsSettled, bannerAds.length, feedAds.length, user.uid, id])

  // Fase 6 -- "destaques" (posts promovidos com EvoCash) precisam de uma consulta
  // própria porque o feed normal só cobre a janela de retenção da comunidade (24h, 30d); uma
  // promoção de 7/30 dias precisa continuar visível bem depois disso. Filtrado no
  // servidor por promotedUntil > agora (nunca limit() antes de tirar os expirados, ver
  // promotionsService.js) -- nunca lê promotions/{id} pra isto.
  const [promoteCommunityOpen, setPromoteCommunityOpen] = useState(false)
  // Todo ajuste local dos destaques (voto, exclusão) grava também na cache, para o retorno não repintar
  // contadores antigos.
  const setFeaturedStatuses = useCallback(
    (updater) =>
      setFeaturedStatusesState((previous) => {
        const next = typeof updater === 'function' ? updater(previous) : updater
        setCached(featuredKey, next)
        return next
      }),
    [featuredKey]
  )
  const loadFeatured = useCallback(
    (force = false) =>
      fetchCached(featuredKey, () => listFeaturedStatusesForCommunity(id), { force }).then(
        (items) => {
          setFeaturedStatusesState(items)
          return items
        }
      ),
    [featuredKey, id]
  )
  useEffect(() => {
    if (!member) return undefined
    if (getCached(featuredKey) !== undefined) {
      setFeaturedLoaded(true)
      return undefined
    }
    let active = true
    setFeaturedLoaded(false)
    loadFeatured()
      .catch((err) => console.error('[CommunityDetail] listFeaturedStatusesForCommunity:', err))
      .finally(() => {
        if (active) setFeaturedLoaded(true)
      })
    return () => {
      active = false
    }
  }, [featuredKey, member, loadFeatured])

  // 1 consulta por LOTE de publicações novas (nunca 1 leitura por card) -- ver useMyEconomyVotes.js.
  // Inclui destaques elegíveis: um post promovido pode estar fora da janela de 24h do
  // feed normal. Poll e workout são excluídos porque nenhum deles possui voto econômico.
  const statusIds = member
    ? [
        ...new Set(
          [...statuses, ...featuredStatuses, ...(sharedStatus ? [sharedStatus] : [])]
            .filter((status) => status.type !== 'poll' && status.type !== 'workout')
            .map((status) => status.id)
        ),
      ]
    : []
  const { votesByStatusId, setVote } = useMyEconomyVotes(statusIds, user?.uid)
  const authorAvatars = useCommunityAuthorAvatars(
    member,
    statuses,
    featuredStatuses,
    upcomingWorkouts,
    sharedStatus ? [sharedStatus] : []
  )

  // Um mesmo post pode existir em `statuses` (aba Recentes) e em `featuredStatuses` (aba Destaques, Fase
  // 6) -- um único handler aplica o mesmo voto/delta nos dois lugares onde o statusId existir, pra nunca
  // deixar uma cópia com o número antigo. Estável (useCallback): os cards do feed são React.memo e só o
  // card afetado re-renderiza quando alguém reage.
  const handleEconomyVoted = useCallback(
    (statusId, value, delta) => {
      setVote(statusId, value)
      updateEconomyVoteCounts(statusId, delta)
      setFeaturedStatuses((prev) => applyEconomyVoteCountDeltaToList(prev, statusId, delta))
    },
    [setVote, updateEconomyVoteCounts, setFeaturedStatuses]
  )
  const handleCommentCountChange = useCallback(
    (statusId, delta) => {
      updateCommentCount(statusId, delta)
      setFeaturedStatuses((previous) =>
        previous.map((status) =>
          status.id === statusId
            ? { ...status, commentCount: Math.max(0, (status.commentCount ?? 0) + delta) }
            : status
        )
      )
    },
    [updateCommentCount, setFeaturedStatuses]
  )
  // Quem acabou de pagar a promoção precisa ver o post em Destaques na hora (e não só depois que a cache de 5 min
  // vencer): atualiza o card na lista e rebusca os destaques no servidor.
  const handlePromoted = useCallback(
    (statusId, result) => {
      updatePostPromotion(statusId, { promoted: true, promotedUntil: result.expiresAtMs })
      loadFeatured(true).catch((err) =>
        console.error('[CommunityDetail] listFeaturedStatusesForCommunity:', err)
      )
    },
    [updatePostPromotion, loadFeatured]
  )

  const refreshCommunityContent = useCallback(
    () =>
      Promise.all([
        refreshFeed(),
        refreshUpcomingWorkouts(),
        loadFeatured(true).catch((err) =>
          console.error('[CommunityDetail] listFeaturedStatusesForCommunity:', err)
        ),
      ]),
    [refreshFeed, refreshUpcomingWorkouts, loadFeatured]
  )

  // Link para uma publicação (#treino-{id} / #publicacao-{id}): primeiro procura nas listas já
  // carregadas; só se ela não estiver lá (fora da 1ª página do feed, expirada etc.) faz UMA
  // leitura por ID canônico -- nunca carrega páginas anteriores nem o feed inteiro.
  const sharedStatusId = publicationIdFromHash(hash)
  useEffect(() => {
    setSharedStatus(null)
    sharedStatusRequested.current = ''
    sharedAnchorScrolled.current = ''
  }, [id, sharedStatusId])

  const feedSettled = member && !loadingFeed && !loadingUpcomingWorkouts && featuredLoaded
  useEffect(() => {
    if (!feedSettled || !sharedStatusId) return
    // "Recentes" é onde o link cai: só o que aparece lá conta como carregado (um post que existe apenas em
    // Destaques ainda precisa ser resolvido por ID para ganhar o bloco "Publicação do link").
    if (isStatusLoaded(sharedStatusId, statuses, upcomingWorkouts)) return
    if (sharedStatusRequested.current === sharedStatusId) return

    sharedStatusRequested.current = sharedStatusId
    getSharedStatus(sharedStatusId, id)
      .then((status) => {
        if (sharedStatusRequested.current === sharedStatusId) setSharedStatus(status)
      })
      .catch((error) => console.error('[CommunityDetail] getSharedStatus:', error))
  }, [feedSettled, sharedStatusId, id, statuses, upcomingWorkouts])

  useEffect(() => {
    if (!member || !sharedStatusId) return undefined
    const anchor = hash.slice(1)
    if (sharedAnchorScrolled.current === anchor) return undefined
    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(anchor)
      if (!element) return
      sharedAnchorScrolled.current = anchor
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [member, hash, sharedStatusId, sharedStatus, upcomingWorkouts, featuredStatuses, statuses])

  const loadCommunity = useCallback(
    async (force = false) => {
      setLoadingCommunity(true)
      setCommunityError(null)
      try {
        const page = await fetchCached(
          pageKey,
          async () => {
            const [data, accessState] = await Promise.all([
              getCommunity(id),
              getCommunityAccess(id),
            ])
            return { community: data, access: accessState }
          },
          { force }
        )
        setCommunity(page.community)
        accessRef.current = page.access
        setAccess(page.access)
      } catch (err) {
        setCommunityError(describeQueryError(err, 'CommunityDetail'))
      } finally {
        setLoadingCommunity(false)
      }
    },
    [id, pageKey]
  )

  useEffect(() => {
    if (getCached(pageKey) === undefined) loadCommunity()
  }, [loadCommunity, pageKey])

  // Mantém a cache da página coerente com o que o próprio usuário acabou de fazer aqui.
  function patchPageCache(patch) {
    const current = getCached(pageKey)
    if (current) setCached(pageKey, { ...current, ...patch })
  }

  // Quando o servidor diz que a pessoa deixou de ser membro, nada do conteúdo da comunidade fica
  // guardado nesta sessão (feed, anúncios, destaques) e a lista "Minhas comunidades" é refeita.
  // `communities:{uid}` também derruba a cache desta página e dos destaques (mesmo prefixo).
  const applyAccess = useCallback(
    (value) => {
      const next = normalizeCommunityAccess(value)
      const purge = shouldPurgeCommunityState(accessRef.current, next)
      accessRef.current = next
      setAccess(next)
      if (purge) {
        communityContentCachePrefixes(user.uid, id).forEach((prefix) => invalidateCache(prefix))
        // Estado em memória desta tela: nada do conteúdo interno sobrevive à perda de acesso.
        setFeaturedStatusesState([])
        setFeaturedLoaded(false)
        setSharedStatus(null)
        setManaging(false)
        setFormOpen(false)
      } else {
        const current = getCached(pageKey)
        if (current) setCached(pageKey, { ...current, access: next })
      }
    },
    [id, pageKey, user.uid]
  )

  // Revalida o acesso a cada abertura (e ao voltar para a aba), mesmo com a página vinda da cache:
  // remover alguém de uma comunidade tem efeito imediato aqui, não só quando a cache de 5 min expira.
  // Se a leitura falhar, mantém o estado atual -- o servidor continua negando os dados de qualquer jeito.
  useEffect(() => {
    let active = true
    // Sem cache, loadCommunity já está lendo o acesso agora: evita a segunda chamada idêntica.
    const hadCachedPage = getCached(pageKey) !== undefined
    const revalidate = () => {
      getCommunityAccess(id)
        .then((next) => {
          if (active) applyAccess(next)
        })
        .catch((err) => console.error('[CommunityDetail] access:', err))
    }
    if (hadCachedPage) revalidate()
    const onVisible = () => {
      if (document.visibilityState === 'visible') revalidate()
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      if (typeof document !== 'undefined')
        document.removeEventListener('visibilitychange', onVisible)
    }
  }, [id, pageKey, applyAccess])

  // A guarda contra clique duplo evita dois efeitos: uma segunda escrita inútil (RLS não
  // tem nenhuma policy de update em community_members, então isso nunca corrompe dado
  // nenhum) e, principalmente, o falso "Erro ao entrar/sair" que aparecia quando
  // o segundo clique chegava depois do primeiro já ter concluído.
  async function handleJoin() {
    if (membershipPending) return
    setMembershipPending(true)
    try {
      // O servidor devolve um ESTADO. Banido/indisponível não são erro: a própria página passa a mostrar o aviso
      // (sem feed, sem "Entrar") e a lista da conta já foi invalidada pelo serviço -- sem refresh manual.
      const result = await joinCommunity(id, user.uid)
      const next = accessAfterJoin(result)
      if (next === 'member') {
        // A lista de anúncios guardada pode ser a vazia de quando ainda não era membro.
        invalidateCache(`sponsoredAds:${id}`)
        applyAccess('member')
        showToast('Você entrou na comunidade.')
      } else if (next) {
        applyAccess(next)
      }
    } catch (err) {
      console.error('[CommunityDetail] join:', err)
      showToast(describeJoinFailure(classifyReadError(err)), 'danger')
    } finally {
      setMembershipPending(false)
    }
  }

  async function handleLeave() {
    if (membershipPending) return
    setMembershipPending(true)
    try {
      await leaveCommunity(id, user.uid)
      applyAccess('not_member')
      // Saiu: nada do feed fica guardado para esta conta (a cache da lista e da página já foi derrubada).
      invalidateCache(`communityFeed:${user.uid}:${id}`)
      invalidateCache(featuredKey)
      showToast('Você saiu da comunidade.')
    } catch (err) {
      console.error('[CommunityDetail] leave:', err)
      showToast('Erro ao sair da comunidade.', 'danger')
    } finally {
      setMembershipPending(false)
    }
  }

  // Remover/banir/desbanir mudam quem é membro e o contador público: derruba as caches da conta
  // (lista, página, destaques) e relê a comunidade para o contador refletir o servidor.
  function handleMembershipChanged() {
    invalidateCommunitiesCache(user.uid)
    loadCommunity(true)
  }

  // Fase 5: mesmas funções de communitiesService.js já usadas pelo painel admin --
  // funcionam para o dono porque a policy communities_update agora aceita
  // is_community_owner() ao lado de is_superadmin(), não porque este código sabe algo
  // novo.
  async function handleUpdateCommunity(values) {
    try {
      await updateCommunity(id, values)
      setCommunity((previous) => ({ ...previous, ...values }))
      patchPageCache({ community: { ...community, ...values } })
      invalidateCommunitiesCache(user.uid)
      setManaging(false)
      showToast('Comunidade atualizada.')
    } catch (err) {
      console.error('[CommunityDetail] updateCommunity:', err)
      showToast('Erro ao atualizar a comunidade.', 'danger')
      throw err
    }
  }

  const actionFlight = useSingleFlight()

  function handleToggleActive() {
    return actionFlight.run('toggle-active', toggleActive)
  }

  async function toggleActive() {
    try {
      await setCommunityActive(id, !community.isActive)
      setCommunity((previous) => ({ ...previous, isActive: !previous.isActive }))
      patchPageCache({ community: { ...community, isActive: !community.isActive } })
      invalidateCommunitiesCache(user.uid)
      showToast(community.isActive ? 'Comunidade desativada.' : 'Comunidade reativada.')
    } catch (err) {
      console.error('[CommunityDetail] setCommunityActive:', err)
      showToast('Erro ao alterar o status da comunidade.', 'danger')
    }
  }

  function handleDeleteCommunity() {
    return actionFlight.run('delete-community', deleteThisCommunity)
  }

  async function deleteThisCommunity() {
    const confirmed = await confirmDelete({
      title: 'Excluir esta comunidade?',
      content:
        'Publicações, membros e restrições dela serão apagados. Esta ação não pode ser desfeita.',
    })
    if (!confirmed) return
    try {
      await deleteCommunity(id)
      invalidateCommunitiesCache(user.uid)
      showToast('Exclusão da comunidade solicitada.')
      navigate('/comunidades', { replace: true })
    } catch (err) {
      console.error('[CommunityDetail] deleteCommunity:', err)
      showToast('Erro ao excluir a comunidade.', 'danger')
    }
  }

  async function handleCreateStatus(values) {
    const author = { id: user.uid, username: profile?.username || null, role: profile?.role }
    const authorIsSuperAdmin = author.role === 'superadmin'
    // Só para o post otimista: o prazo real (e a regra guardada no post) vêm do banco.
    const retentionMode = community?.postRetentionMode || '24h'
    const expiresAt = expiresAtForRetention(retentionMode)
    try {
      if (values.type === 'progress') {
        // Card de progresso = foto normal da comunidade (mesmo bucket/pipeline/policies) + metadado de progresso.
        const { done } = await createPhotoStatus(id, author, {
          blob: values.blob,
          caption: values.caption,
          progress: values.progress,
        })
        const ref = await done
        addStatusLocally({
          id: ref.id,
          communityId: id,
          authorId: author.id,
          authorUsername: author.username,
          authorIsSuperAdmin,
          type: 'photo',
          photoPath: `statusPhotos/${id}/${ref.id}.webp`,
          caption: values.caption ? values.caption.trim() : '',
          progress: values.progress,
          _localPhotoBlob: values.blob,
          createdAt: new Date(),
          expiresAt,
          retentionMode,
        })
      } else if (values.type === 'text') {
        const ref = await createTextStatus(id, author, values.text)
        addStatusLocally({
          id: ref.id,
          communityId: id,
          authorId: author.id,
          authorUsername: author.username,
          authorIsSuperAdmin,
          type: 'text',
          text: values.text.trim(),
          createdAt: new Date(),
          expiresAt,
          retentionMode,
        })
      } else if (values.type === 'poll') {
        const ref = await createPollStatus(id, author, values.question, values.options)
        addStatusLocally({
          id: ref.id,
          communityId: id,
          authorId: author.id,
          authorUsername: author.username,
          authorIsSuperAdmin,
          type: 'poll',
          poll: {
            question: values.question.trim(),
            options: values.options.map((label, index) => ({ id: String(index), label })),
          },
          createdAt: new Date(),
          expiresAt,
          retentionMode,
        })
      } else if (values.type === 'workout') {
        const ref = await createWorkoutStatus(id, author, values)
        const workoutStatus = {
          id: ref.id,
          communityId: id,
          authorId: author.id,
          authorUsername: author.username,
          authorIsSuperAdmin,
          type: 'workout',
          workout: {
            title: values.title.trim(),
            date: new Date(values.date),
            location: values.location.trim(),
          },
          createdAt: new Date(),
          expiresAt,
          retentionMode,
        }
        addStatusLocally(workoutStatus)
        setUpcomingWorkouts(
          [workoutStatus, ...upcomingWorkouts]
            .filter(
              (status, index, items) =>
                items.findIndex((candidate) => candidate.id === status.id) === index
            )
            .sort((left, right) => toMillis(left.workout.date) - toMillis(right.workout.date))
            .slice(0, 20)
        )
      } else if (values.type === 'photo') {
        // O upload e a criação do documento já aconteceram dentro do StatusForm (é
        // quem controla o progresso/cancelamento) — aqui só sobra atualizar o feed
        // local. _localPhotoBlob deixa o StatusCard mostrar a própria foto na hora,
        // sem baixar de novo algo que o navegador já tem em memória.
        addStatusLocally({
          id: values.ref.id,
          communityId: id,
          authorId: author.id,
          authorUsername: author.username,
          authorIsSuperAdmin,
          type: 'photo',
          photoPath: `statusPhotos/${id}/${values.ref.id}.webp`,
          caption: values.caption ? values.caption.trim() : '',
          _localPhotoBlob: values.blob,
          createdAt: new Date(),
          expiresAt,
          retentionMode,
        })
      }
      setFormOpen(false)
      showToast(
        values.type === 'progress'
          ? 'Progresso publicado na comunidade.'
          : 'Publicado na comunidade.'
      )
    } catch (err) {
      console.error('[CommunityDetail] createStatus:', err)
      showToast('Erro ao publicar.', 'danger')
      throw err
    }
  }

  // Estável (useCallback + ref com o "agora" da renderização): o pai não muda a identidade do handler a
  // cada render, então os cards do feed (React.memo) não re-renderizam à toa.
  const live = useRef({})
  live.current = { deleteStatus }
  const handleDeleteStatus = useCallback(
    (status) =>
      actionFlight.run(`delete-status:${status.id}`, () => live.current.deleteStatus(status)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  async function deleteStatus(status) {
    const confirmed = await confirmDelete({
      title: 'Excluir esta publicação?',
      content: 'Esta ação não pode ser desfeita.',
    })
    if (!confirmed) return false
    try {
      await remove(status.id)
      setUpcomingWorkouts(upcomingWorkouts.filter((item) => item.id !== status.id))
      setSharedStatus((item) => (item?.id === status.id ? null : item))
      setFeaturedStatuses((items) => items.filter((item) => item.id !== status.id))
      showToast('Publicação excluída.')
      return true
    } catch (err) {
      console.error('[CommunityDetail] delete:', err)
      throw new Error('Não foi possível excluir a publicação.', { cause: err })
    }
  }

  const loading = loadingCommunity || loadingFeed
  useFeedScrollMemory(
    `${user.uid}:${id}`,
    member && !loadingFeed && statuses.length > 0,
    Boolean(sharedStatusId)
  )
  // Fase 5: dono da comunidade conta como moderador só DENTRO dela -- nunca em nenhuma
  // outra (mesma condição is_community_owner() usada nas policies). community?.ownerId
  // já vem do próprio getCommunity(id) acima, sem leitura extra.
  const canModerate = canModerateCommunity({
    isSuperAdmin,
    communityOwnerId: community?.ownerId,
    uid: user.uid,
  })
  const canPost = canModerate || community?.postAccess !== 'admins'

  return (
    <div className="community-page cd-page">
      <ToastFlash toasts={toasts} />
      <CommunityHeader
        communityId={id}
        community={!loadingCommunity && !communityError ? community : null}
        menuProps={{
          member,
          canManage: canModerate,
          managing,
          membershipPending,
          onRefresh: member ? refreshCommunityContent : undefined,
          refreshing,
          onManage: () => setManaging(true),
          onLeave: handleLeave,
        }}
      />

      {loadingCommunity && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}
      <ErrorState error={communityError} onRetry={() => loadCommunity(true)} />

      {!loadingCommunity && !communityError && community && (
        <>
          {/* Fase 5: visível para isSuperAdmin || dono (ownerId) -- as MESMAS
              funções de communitiesService.js que o painel admin global já usa, só que
              aqui restritas (pelas Rules, não só pela UI) a esta comunidade. */}
          {canModerate && managing && (
            <div className="cd-manage">
              <Heading as="h2" sx={{ fontSize: 1, mb: 2 }}>
                Gerenciar comunidade
              </Heading>
              <LazyDialogBoundary onFail={() => setManaging(false)}>
                <CommunityForm
                  initialValue={community}
                  onSubmit={handleUpdateCommunity}
                  onCancel={() => setManaging(false)}
                />
              </LazyDialogBoundary>
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 2,
                  mt: 3,
                  borderTop: '1px solid',
                  borderColor: 'border.default',
                  pt: 3,
                }}
              >
                <Button onClick={handleToggleActive}>
                  {community.isActive ? 'Desativar comunidade' : 'Reativar comunidade'}
                </Button>
                <Button variant="danger" onClick={handleDeleteCommunity}>
                  Excluir comunidade
                </Button>
              </Box>
              {/* Fase 6: promoção paga é uma decisão do DONO, nunca do superadmin agindo
                  como moderador -- diferente de canModerate acima, checa ownerId direto. */}
              {community.ownerId === user.uid && !community.promoted && (
                <Box sx={{ mt: 3, borderTop: '1px solid', borderColor: 'border.default', pt: 3 }}>
                  <Button onClick={() => setPromoteCommunityOpen(true)}>Promover comunidade</Button>
                </Box>
              )}
              <Box sx={{ mt: 3, borderTop: '1px solid', borderColor: 'border.default', pt: 3 }}>
                <Heading as="h3" sx={{ fontSize: 0, mb: 2 }}>
                  Membros e banimentos
                </Heading>
                <LazyDialogBoundary>
                  <CommunityMembersModeration
                    communityId={id}
                    ownerId={community.ownerId ?? null}
                    onMembershipChanged={handleMembershipChanged}
                  />
                </LazyDialogBoundary>
              </Box>
            </div>
          )}
          {promoteCommunityOpen && (
            <LazyDialogBoundary onFail={() => setPromoteCommunityOpen(false)}>
              <PromoteDialog
                targetType="community"
                targetId={id}
                currentUserId={user.uid}
                title="Promover comunidade"
                onClose={() => setPromoteCommunityOpen(false)}
                onPromoted={() => {
                  setPromoteCommunityOpen(false)
                  loadCommunity(true)
                }}
              />
            </LazyDialogBoundary>
          )}

          <CommunityAccessNotice
            access={access}
            onJoin={handleJoin}
            joinDisabled={membershipPending}
            onBack={() => navigate('/comunidades')}
          />

          {member && holdForAds && <Spinner sx={{ display: 'block', mx: 'auto', my: 5 }} />}

          {member && !holdForAds && (
            <CommunityFeedSection
              communityId={id}
              communityName={community.name}
              currentUserId={user.uid}
              author={{ id: user.uid, username: profile?.username || null, role: profile?.role }}
              canModerate={canModerate}
              canPost={canPost}
              bannerAds={bannerAds}
              inlineFirstAfter={cardsLate ? 1 : undefined}
              reserveBannerSlot={adHint.banner && loadingAds}
              reserveFeedTopPx={loadingAds ? adHint.feedTop : 0}
              onTopAdsHeight={setTopAdsHeight}
              feedAds={cardsLate ? NO_ADS : feedAds}
              inlineFeedAds={cardsLate ? [...feedAds, ...inlineFeedAds] : inlineFeedAds}
              upcomingWorkouts={upcomingWorkouts}
              sharedStatus={sharedStatus}
              loadingUpcomingWorkouts={loadingUpcomingWorkouts}
              upcomingWorkoutsError={upcomingWorkoutsError}
              featuredStatuses={featuredStatuses}
              statuses={statuses}
              authorAvatars={authorAvatars}
              loadingFeed={loadingFeed || loadingUpcomingWorkouts}
              feedError={feedError}
              hasMore={hasMore}
              loadingMore={loadingMore}
              moreError={moreError}
              loadMore={loadMore}
              formOpen={formOpen}
              setFormOpen={setFormOpen}
              refreshFeed={refreshCommunityContent}
              showToast={showToast}
              votesByStatusId={votesByStatusId}
              onEconomyVoted={handleEconomyVoted}
              onDeleteStatus={handleDeleteStatus}
              onCreateStatus={handleCreateStatus}
              onPromoted={handlePromoted}
              onCommentCountChange={handleCommentCountChange}
              refreshEpoch={refreshEpoch}
            />
          )}
        </>
      )}

      {!loading && !communityError && !community && (
        <Blankslate>
          <Blankslate.Visual>
            <PeopleIcon size={24} />
          </Blankslate.Visual>
          <Blankslate.Heading>Comunidade não encontrada</Blankslate.Heading>
          <Blankslate.PrimaryAction onClick={() => navigate('/comunidades', { replace: true })}>
            Voltar
          </Blankslate.PrimaryAction>
        </Blankslate>
      )}
    </div>
  )
}

export default function CommunityDetailRoute() {
  const { id } = useParams()
  return <CommunityDetail key={id} id={id} />
}
