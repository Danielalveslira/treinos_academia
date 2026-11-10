import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Box,
  Button,
  Checkbox,
  Flash,
  FormControl,
  Heading,
  Label,
  Select,
  Spinner,
  Text,
  Textarea,
  TextInput,
} from '@primer/react'
import { ChevronDownIcon, ChevronUpIcon } from '@primer/octicons-react'
import { useOnlineStatus as useOnline } from '../../hooks/useOnlineStatus'
import { useAuth } from '../../hooks/useAuth'
import { useWorkoutSheets } from './useWorkoutSheets.js'
import {
  getWorkoutSheet,
  getWorkoutSheetByRequestId,
  saveWorkoutSheet,
  sheetError,
} from './workoutSheetsService.js'
import {
  EMPTY_SHEET,
  prescription,
  SHEET_GOALS,
  SHEET_LIMITS,
  WEEKDAYS,
  sheetFingerprint,
  validateSheet,
} from './workoutSheetValidation.js'
import { WorkoutSheetItemEditor } from './WorkoutSheetItemEditor'
import { WorkoutSheetExercisePicker } from './WorkoutSheetExercisePicker'
import { useSheetDiscardGuard } from './useSheetDiscardGuard.js'
import './workoutSheets.css'
// Reload-sem-duplicar (P0, auditoria 2026-11-10): se o usuário confirmar "saída sem salvar" do
// aviso do navegador enquanto uma criação está em voo, o requestId.current em memória se perde e
// um reload ingênuo mintaria um novo request_id -- duplicando a ficha quando a 1ª tentativa, na
// verdade, já tinha sido aceita no servidor. Guardamos o request_id pendente da ficha NOVA (nunca
// de uma edição existente, que não usa idempotency key) só para o MESMO uid+aba retomar a MESMA
// tentativa; create_workout_sheet() agora reconcilia o retry com o conteúdo atual do formulário
// em vez de descartá-lo (20261215000002), então retomar é seguro mesmo que o conteúdo tenha mudado.
const pendingCreateKey = (uid) => `evolutus:sheet:pendingCreate:${uid}`
function readPendingCreateRequestId(uid) {
  try {
    return sessionStorage.getItem(pendingCreateKey(uid)) || null
  } catch {
    return null
  }
}
function writePendingCreateRequestId(uid, value) {
  try {
    if (value) sessionStorage.setItem(pendingCreateKey(uid), value)
    else sessionStorage.removeItem(pendingCreateKey(uid))
  } catch {
    /* Best-effort only: losing this never duplicates a save, it only loses reload resumption. */
  }
}
function EditorSection({
  id,
  title,
  caption,
  action,
  children,
  optional = false,
  initiallyOpen = true,
}) {
  const [expanded, setExpanded] = useState(initiallyOpen)
  const contentId = useId()
  const open = !optional || expanded
  return (
    <Box
      as="section"
      aria-labelledby={id}
      sx={{
        border: '1px solid',
        borderColor: 'border.default',
        borderRadius: 2,
        p: [3, 4],
        minWidth: 0,
        bg: 'canvas.default',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          mb: open ? (caption ? 1 : 3) : 0,
        }}
      >
        <Heading as="h2" id={id} sx={{ fontSize: 2, m: 0 }}>
          {optional ? (
            <Button
              type="button"
              variant="invisible"
              trailingAction={expanded ? ChevronUpIcon : ChevronDownIcon}
              aria-expanded={expanded}
              aria-controls={contentId}
              onClick={() => setExpanded((value) => !value)}
              sx={{ p: 0, fontSize: 'inherit', fontWeight: 'inherit', textAlign: 'left' }}
            >
              {title}
            </Button>
          ) : (
            title
          )}
        </Heading>
        {action || (optional && !open && <Label>Opcional</Label>)}
      </Box>
      {open && (
        <Box id={contentId}>
          {caption && (
            <Text as="p" sx={{ color: 'fg.muted', fontSize: 0, mt: 0, mb: 3 }}>
              {caption}
            </Text>
          )}
          {children}
        </Box>
      )}
    </Box>
  )
}
function Editor({ initial, online }) {
  const { user, profile } = useAuth()
  const defaultRestSeconds = profile?.defaultRestSeconds ?? null
  const isNew = !initial.id
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const [sheet, setSheet] = useState(initial)
  const [baseline, setBaseline] = useState(() => sheetFingerprint(initial))
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [server, setServer] = useState(null)
  // Meta inválida: identifica o exercício/campo (5.3) para WorkoutSheetItemEditor abrir a seção
  // certa e focar/rolar até o campo -- a própria WorkoutSheetItemEditor expande e foca em
  // sequência (duas renderizações: abre a seção, só então o campo existe no DOM para focar),
  // nunca aqui: um efeito aqui correria na mesma passagem da expansão do filho, antes do campo
  // existir, e nunca rodaria de novo (não depende de nenhum estado que muda depois).
  const [invalidField, setInvalidField] = useState(null)
  const requestId = useRef(isNew ? readPendingCreateRequestId(user.uid) : null),
    lock = useRef(false)
  const navigate = useNavigate()
  const dirty = sheetFingerprint(sheet) !== baseline
  const permitNavigation = useSheetDiscardGuard(dirty)
  const change = (key, value) => setSheet((s) => ({ ...s, [key]: value }))
  const patchItem = useCallback((exerciseId, key, value) => {
    setSheet((s) => ({
      ...s,
      items: s.items.map((item) =>
        item.exercise_id === exerciseId ? { ...item, [key]: value } : item
      ),
    }))
    // Corrigir o campo apontado como inválido limpa o estado de erro -- nunca deixa aria-invalid
    // preso num valor que o usuário já mudou.
    setInvalidField((current) =>
      current?.exerciseId === exerciseId && current.field === key ? null : current
    )
  }, [])
  const move = useCallback((index, delta) => {
    setSheet((s) => {
      const items = [...s.items]
      ;[items[index], items[index + delta]] = [items[index + delta], items[index]]
      return { ...s, items }
    })
  }, [])
  const removeItem = useCallback(
    (exerciseId) =>
      setSheet((s) => ({ ...s, items: s.items.filter((item) => item.exercise_id !== exerciseId) })),
    []
  )
  const addItem = useCallback(
    (exercise) =>
      setSheet((s) =>
        s.items.some((item) => item.exercise_id === exercise.id) ||
        s.items.length >= SHEET_LIMITS.items
          ? s
          : { ...s, items: [...s.items, { exercise_id: exercise.id, exercise, available: true }] }
      ),
    []
  )
  async function save(event) {
    event.preventDefault()
    if (lock.current || !dirty || !online || server) return
    const invalid = validateSheet(sheet)
    if (invalid) {
      setMessage(invalid.message)
      setInvalidField(invalid.exerciseId ? { exerciseId: invalid.exerciseId, field: invalid.field } : null)
      return
    }
    setInvalidField(null)
    lock.current = true
    setBusy(true)
    setMessage('')
    if (isNew && !requestId.current) requestId.current = crypto.randomUUID()
    if (isNew) writePendingCreateRequestId(user.uid, requestId.current)
    try {
      const result = await saveWorkoutSheet(sheet, requestId.current, user.uid)
      if (!active.current) return
      if (isNew) writePendingCreateRequestId(user.uid, null)
      setBaseline(sheetFingerprint(sheet))
      permitNavigation()
      navigate(`/fichas/${result.id}`, { replace: true })
    } catch (error) {
      if (!active.current) return
      setMessage(sheetError(error))
      if (String(error.message).includes('SHEET_VERSION_CONFLICT')) {
        try {
          // Em criação, sheet.id ainda não existe localmente -- a mesma ficha só é resolvível
          // pelo create_request_id desta tentativa (P0, continuação da auditoria 2026-11-10).
          setServer(
            isNew ? await getWorkoutSheetByRequestId(requestId.current) : await getWorkoutSheet(sheet.id)
          )
        } catch {
          /* Original edits remain visible. */
        }
      }
    } finally {
      lock.current = false
      if (active.current) setBusy(false)
    }
  }
  function cancel() {
    if (!dirty || window.confirm('Descartar as alterações não salvas desta ficha?')) {
      if (isNew) writePendingCreateRequestId(user.uid, null)
      permitNavigation()
      navigate(initial.id ? `/fichas/${initial.id}` : '/exercicios')
    }
  }
  function acceptServer() {
    setSheet(server)
    setBaseline(sheetFingerprint(server))
    setServer(null)
    setMessage('')
  }
  function keepMine() {
    // Adota também o id do servidor (nunca só a revisão): numa criação, sheet.id ainda era
    // undefined -- sem o id, o próximo Salvar voltaria a tentar create_workout_sheet() com o
    // recibo antigo e conflitaria de novo, em loop, mesmo com o usuário já ciente da versão atual.
    // Com o id, o próximo Salvar segue o caminho normal de edição (save_workout_sheet), comparando
    // contra a revisão real que acabou de ser buscada -- sem reaproveitar essa revisão às cegas
    // para forçar o salvamento: o usuário ainda precisa revisar e clicar Salvar de novo.
    setSheet((s) => ({ ...s, id: server.id, revision: server.revision }))
    setBaseline(sheetFingerprint(server))
    setServer(null)
    setMessage('Versão atual carregada para comparação. Revise sua edição e salve novamente.')
  }
  const disabled = busy || !online
  return (
    <Box as="section" className="workout-sheets">
      <Box sx={{ display: 'grid', gap: 2, mb: 3 }}>
        <Button type="button" variant="invisible" onClick={cancel} sx={{ justifySelf: 'start' }}>
          Voltar
        </Button>
        <Heading as="h1" sx={{ m: 0 }}>
          {initial.id ? 'Editar ficha' : 'Criar ficha'}
        </Heading>
        <Text as="p" sx={{ color: 'fg.muted', m: 0 }}>
          Organize sua rotina. Objetivo, dias e metas são opcionais.
        </Text>
      </Box>
      {!online && (
        <Flash variant="warning" sx={{ mb: 3 }}>
          Fichas exigem conexão. Sua edição permanece nesta tela; reconecte para salvar.
        </Flash>
      )}
      {message && (
        <Flash role="alert" variant="warning" sx={{ mb: 3 }}>
          {message}
        </Flash>
      )}
      {server && (
        <Box
          as="section"
          aria-label="Conflito de versões"
          sx={{
            border: '1px solid',
            borderColor: 'attention.emphasis',
            borderRadius: 2,
            p: 3,
            mb: 3,
          }}
        >
          <Heading as="h2" sx={{ fontSize: 2 }}>
            Versão atual no servidor
          </Heading>
          <Text as="p">
            {server.name} · revisão {server.revision}
          </Text>
          <Text as="p">{server.goal_description}</Text>
          <Box as="ol">
            {server.items.map((item) => (
              <li key={item.id}>
                {item.exercise.name}: {prescription(item)}
              </li>
            ))}
          </Box>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button onClick={acceptServer}>Usar versão do servidor</Button>
            <Button onClick={keepMine}>Manter minha edição para revisão</Button>
          </Box>
        </Box>
      )}
      <Box
        as="form"
        onSubmit={save}
        sx={{ '&&': { p: 0, m: 0, border: 0, bg: 'canvas.default', display: 'grid', gap: 3 } }}
      >
        <EditorSection id="sheet-identification" title="Identificação">
          <FormControl required disabled={disabled}>
            <FormControl.Label requiredIndicator={false}>Nome obrigatório</FormControl.Label>
            <TextInput
              block
              required
              maxLength={80}
              placeholder="Ex.: Treino A — Peito e tríceps"
              value={sheet.name}
              onChange={(event) => change('name', event.target.value)}
            />
            <FormControl.Caption>
              Escolha um nome fácil de reconhecer. Até 80 caracteres.
            </FormControl.Caption>
          </FormControl>
        </EditorSection>
        <EditorSection
          id="sheet-goal"
          optional
          initiallyOpen={Boolean(initial.goal || initial.goal_description)}
          title="Objetivo e descrição"
          caption="Conte o que você pretende alcançar, se quiser."
        >
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: ['minmax(0,1fr)', 'minmax(0,1fr) minmax(0,2fr)'],
              gap: 3,
              alignItems: 'start',
            }}
          >
            <FormControl disabled={disabled}>
              <FormControl.Label>Objetivo opcional</FormControl.Label>
              <Select
                block
                value={sheet.goal || ''}
                onChange={(event) => change('goal', event.target.value)}
              >
                <Select.Option value="">Sem objetivo</Select.Option>
                {Object.entries(SHEET_GOALS).map(([key, label]) => (
                  <Select.Option key={key} value={key}>
                    {label}
                  </Select.Option>
                ))}
              </Select>
            </FormControl>
            <FormControl disabled={disabled}>
              <FormControl.Label>
                {sheet.goal === 'other' ? 'Descreva seu objetivo' : 'Descrição opcional'}
              </FormControl.Label>
              <Textarea
                block
                rows={2}
                resize="vertical"
                maxLength={500}
                value={sheet.goal_description}
                onChange={(event) => change('goal_description', event.target.value)}
              />
              <FormControl.Caption>Até 500 caracteres.</FormControl.Caption>
            </FormControl>
          </Box>
        </EditorSection>
        <EditorSection
          id="sheet-days"
          optional
          initiallyOpen={initial.weekdays.length > 0}
          title="Dias sugeridos"
          caption="Apenas para organizar a semana. Nenhum lembrete será criado."
        >
          <Box
            role="group"
            aria-labelledby="sheet-days"
            sx={{
              display: 'grid',
              gridTemplateColumns: ['repeat(4,minmax(0,1fr))', 'repeat(7,minmax(0,1fr))'],
              gap: 2,
            }}
          >
            {WEEKDAYS.map((day, index) => (
              <FormControl key={day} disabled={disabled} sx={{ minHeight: 44, gap: 1 }}>
                <Checkbox
                  checked={sheet.weekdays.includes(index)}
                  onChange={(event) =>
                    change(
                      'weekdays',
                      event.target.checked
                        ? [...sheet.weekdays, index]
                        : sheet.weekdays.filter((d) => d !== index)
                    )
                  }
                />
                <FormControl.Label>{day}</FormControl.Label>
              </FormControl>
            ))}
          </Box>
        </EditorSection>
        <EditorSection
          id="sheet-exercises"
          title="Exercícios da ficha"
          caption="Escolha da biblioteca ou do catálogo. Ajuste a ordem e abra as metas somente quando precisar."
          action={
            <Label aria-live="polite">
              {sheet.items.length}/{SHEET_LIMITS.items}
            </Label>
          }
        >
          <WorkoutSheetExercisePicker
            items={sheet.items}
            disabled={disabled || sheet.items.length >= SHEET_LIMITS.items}
            onAdd={addItem}
          />
          {!sheet.items.length ? (
            <Box sx={{ bg: 'canvas.subtle', p: 3, mt: 3, borderRadius: 2 }}>
              <Text as="p" sx={{ m: 0, color: 'fg.muted', fontSize: 0 }}>
                Sua ficha ainda não tem exercícios. Adicione o primeiro ou salve um rascunho para
                continuar depois.
              </Text>
            </Box>
          ) : (
            <Box as="ol" sx={{ listStyle: 'none', p: 0, mb: 0, mt: 3, display: 'grid', gap: 2 }}>
              {sheet.items.map((item, index) => (
                <WorkoutSheetItemEditor
                  key={item.exercise_id}
                  item={item}
                  index={index}
                  total={sheet.items.length}
                  disabled={disabled}
                  defaultRestSeconds={defaultRestSeconds}
                  focusField={invalidField?.exerciseId === item.exercise_id ? invalidField.field : null}
                  onPatch={patchItem}
                  onMove={move}
                  onRemove={removeItem}
                />
              ))}
            </Box>
          )}
          <Text as="p" sx={{ color: 'fg.muted', fontSize: 0, mt: 3, mb: 0 }}>
            Metas são referências. Salvar a ficha não registra séries nem remove exercícios da
            biblioteca.
          </Text>
        </EditorSection>
        <Box
          sx={{
            bg: 'canvas.default',
            borderTop: '1px solid',
            borderColor: 'border.default',
            py: 3,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 2,
          }}
        >
          <Button type="button" disabled={busy} onClick={cancel} sx={{ flex: ['1', 'initial'] }}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!dirty || disabled || Boolean(server)}
            sx={{ flex: ['1', 'initial'] }}
          >
            {busy ? 'Salvando…' : sheet.items.length ? 'Salvar ficha' : 'Salvar rascunho'}
          </Button>
        </Box>
      </Box>
    </Box>
  )
}

export default function WorkoutSheetEditorPage() {
  const { id } = useParams()
  const { user } = useAuth()
  // A new sheet does not need a list round-trip; the hook is mounted only for existing sheets.
  return id ? <ExistingEditor key={`${user.uid}:${id}`} id={id} /> : <NewEditor key={user.uid} />
}
function NewEditor() {
  const { user, offlineLocal } = useAuth()
  const online = useOnline()
  // Retomada segura após reload (P0, continuação da auditoria 2026-11-10): o sessionStorage só
  // guarda o request_id, nunca o conteúdo do formulário (nada sensível e nada que fique
  // desatualizado) -- a retomada reconcilia explicitamente com o servidor em vez de confiar cegamente
  // no id. Se a tentativa pendente já existe de verdade, carrega a ficha real (vira edição normal,
  // nunca mais tenta criar); se não existe (nunca confirmou, ou o id era de outra sessão/conta),
  // descarta o marcador e começa um rascunho limpo -- nunca reaproveita um id antigo para uma
  // criação nova e independente.
  const [state, setState] = useState(null)
  useEffect(() => {
    let active = true
    const pending = readPendingCreateRequestId(user.uid)
    if (!pending) {
      setState({ initial: EMPTY_SHEET })
      return undefined
    }
    getWorkoutSheetByRequestId(pending).then(
      (sheet) => {
        writePendingCreateRequestId(user.uid, null)
        if (active) setState({ initial: sheet })
      },
      (error) => {
        if (String(error?.message || '').includes('SHEET_NOT_FOUND')) {
          writePendingCreateRequestId(user.uid, null)
        }
        // Qualquer outra falha (rede, sessão) preserva o marcador -- só uma falha de rede
        // momentânea não pode apagar a chance de retomar na próxima tentativa.
        if (active) setState({ initial: EMPTY_SHEET })
      }
    )
    return () => {
      active = false
    }
  }, [user.uid])
  if (!state) return <Spinner aria-label="Carregando editor" />
  return <Editor initial={state.initial} online={online && !offlineLocal} />
}
function ExistingEditor({ id }) {
  const { data, loading, error, refresh, online } = useWorkoutSheets(id)
  const initial = useRef(null)
  if (!initial.current && data) initial.current = data
  if (initial.current) return <Editor initial={initial.current} online={online} />
  if (loading) return <Spinner aria-label="Carregando editor" />
  return (
    <section className="workout-sheets">
      <Link to="/exercicios">Voltar</Link>
      <Flash role="alert" variant="danger">
        {sheetError(error)} <Button onClick={refresh}>Tentar novamente</Button>
      </Flash>
    </section>
  )
}
