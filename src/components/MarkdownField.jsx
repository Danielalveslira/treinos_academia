import { createElement, useId, useRef, useState } from 'react'
import {
  ActionList,
  ActionMenu,
  Box,
  Dialog,
  FormControl,
  IconButton,
  SegmentedControl,
  Text,
  Textarea,
  TextInput,
} from '@primer/react'
import {
  BoldIcon,
  HeadingIcon,
  HorizontalRuleIcon,
  ItalicIcon,
  KebabHorizontalIcon,
  LinkIcon,
  QuoteIcon,
  CodeIcon,
  ListUnorderedIcon,
  ListOrderedIcon,
  TasklistIcon,
  PencilIcon,
  EyeIcon,
  TableIcon,
} from '@primer/octicons-react'
import {
  applyMarkdownAction,
  insertMarkdownLink,
  normalizeMarkdownLinkUrl,
} from '../utils/markdownToolbar'
import { MarkdownViewer } from './MarkdownViewer'

const PRIMARY_ACTIONS = [
  { action: 'bold', icon: BoldIcon, label: 'Negrito' },
  { action: 'italic', icon: ItalicIcon, label: 'Itálico' },
  { action: 'heading', icon: HeadingIcon, label: 'Título' },
  { action: 'link', icon: LinkIcon, label: 'Link' },
]

const SECONDARY_ACTIONS = [
  { action: 'quote', icon: QuoteIcon, label: 'Citação' },
  { action: 'code', icon: CodeIcon, label: 'Código inline' },
  { action: 'unorderedList', icon: ListUnorderedIcon, label: 'Lista com marcadores' },
  { action: 'orderedList', icon: ListOrderedIcon, label: 'Lista numerada' },
  { action: 'checklist', icon: TasklistIcon, label: 'Checklist' },
  { action: 'horizontalRule', icon: HorizontalRuleIcon, label: 'Separador horizontal' },
  { action: 'table', icon: TableIcon, label: 'Tabela simples' },
]

const CONTENT_MIN_HEIGHT = ['128px', '144px']

function LinkDialog({ draft, setDraft, onCancel, onInsert, inputRef, returnFocusRef }) {
  return (
    <Dialog
      title="Inserir link"
      subtitle="Use um endereço HTTP ou HTTPS."
      width="medium"
      onClose={onCancel}
      initialFocusRef={inputRef}
      returnFocusRef={returnFocusRef}
      footerButtons={[
        { content: 'Cancelar', onClick: onCancel },
        { content: 'Inserir link', buttonType: 'primary', onClick: onInsert },
      ]}
    >
      <Box sx={{ display: 'grid', gap: 3, p: 3 }}>
        <FormControl>
          <FormControl.Label>Texto do link</FormControl.Label>
          <TextInput
            value={draft.label}
            onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
            maxLength={200}
            block
          />
        </FormControl>
        <FormControl required>
          <FormControl.Label>Endereço</FormControl.Label>
          <TextInput
            ref={inputRef}
            value={draft.url}
            onChange={(event) =>
              setDraft((current) => ({ ...current, url: event.target.value, error: '' }))
            }
            placeholder="https://exemplo.com"
            aria-invalid={draft.error ? 'true' : undefined}
            block
          />
          {draft.error && (
            <FormControl.Validation variant="error">{draft.error}</FormControl.Validation>
          )}
        </FormControl>
      </Box>
    </Dialog>
  )
}

export function MarkdownField({
  label,
  value,
  onChange,
  placeholder = 'Escreva em Markdown...',
  required = false,
  disabled = false,
  error,
  caption,
  maxLength = 500,
  rows = 5,
}) {
  const id = useId()
  const [mode, setMode] = useState('edit')
  const [toolbarError, setToolbarError] = useState('')
  const [linkDraft, setLinkDraft] = useState(null)
  const textareaRef = useRef(null)
  const linkInputRef = useRef(null)
  const text = typeof value === 'string' ? value : ''
  const validation = error || toolbarError
  const describedBy = `${id}-caption${validation ? ` ${id}-validationMessage` : ''}`

  function restoreSelection(selectionStart, selectionEnd) {
    const el = textareaRef.current
    requestAnimationFrame(() => {
      if (!el?.isConnected) return
      el.focus()
      el.setSelectionRange(selectionStart, selectionEnd)
    })
  }

  function applyResult({ value: nextValue, selectionStart, selectionEnd }) {
    const el = textareaRef.current
    if (!el) return false
    if (nextValue.length > maxLength) {
      setToolbarError(`A formatação ultrapassa o limite de ${maxLength} caracteres.`)
      el.focus()
      return false
    }
    setToolbarError('')
    onChange(nextValue)
    restoreSelection(selectionStart, selectionEnd)
    return true
  }

  function openLinkDialog() {
    const el = textareaRef.current
    if (!el || disabled || mode !== 'edit') return
    const selectionStart = el.selectionStart ?? text.length
    const selectionEnd = el.selectionEnd ?? text.length
    setLinkDraft({
      label: text.slice(selectionStart, selectionEnd),
      url: '',
      error: '',
      selectionStart,
      selectionEnd,
    })
  }

  function closeLinkDialog() {
    if (!linkDraft) return
    const { selectionStart, selectionEnd } = linkDraft
    setLinkDraft(null)
    restoreSelection(selectionStart, selectionEnd)
  }

  function insertLink() {
    if (!linkDraft) return
    const url = normalizeMarkdownLinkUrl(linkDraft.url)
    if (!url) {
      setLinkDraft((current) => ({
        ...current,
        error: 'Informe um endereço HTTP ou HTTPS válido.',
      }))
      return
    }
    const result = insertMarkdownLink(
      text,
      linkDraft.selectionStart,
      linkDraft.selectionEnd,
      linkDraft.label.trim(),
      url
    )
    if (result.value.length > maxLength) {
      setLinkDraft((current) => ({
        ...current,
        error: `O link ultrapassa o limite de ${maxLength} caracteres.`,
      }))
      return
    }
    setLinkDraft(null)
    applyResult(result)
  }

  function runAction(action) {
    if (action === 'link') {
      openLinkDialog()
      return
    }
    const el = textareaRef.current
    if (!el || disabled || mode !== 'edit') return
    applyResult(
      applyMarkdownAction(
        action,
        text,
        el.selectionStart ?? text.length,
        el.selectionEnd ?? text.length
      )
    )
  }

  function handleKeyDown(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return
    const action = { b: 'bold', i: 'italic', k: 'link' }[event.key.toLowerCase()]
    if (!action) return
    event.preventDefault()
    runAction(action)
  }

  return (
    <FormControl id={id} required={required} disabled={disabled} sx={{ minWidth: 0 }}>
      <FormControl.Label visuallyHidden={!label}>{label || 'Conteúdo Markdown'}</FormControl.Label>
      <Box
        sx={{
          border: '1px solid',
          borderColor: validation ? 'danger.emphasis' : 'border.default',
          borderRadius: 2,
          width: '100%',
          minWidth: 0,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            flexWrap: 'wrap',
            p: 1,
            borderBottom: '1px solid',
            borderColor: 'border.default',
            bg: 'canvas.subtle',
          }}
        >
          <Box
            role="group"
            aria-label="Formatação do texto"
            sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
          >
            {PRIMARY_ACTIONS.map(({ action, icon, label: actionLabel }) => (
              <IconButton
                key={action}
                type="button"
                icon={icon}
                variant="invisible"
                size="medium"
                aria-label={actionLabel}
                disabled={disabled || mode === 'preview'}
                onClick={() => runAction(action)}
              />
            ))}
            <ActionMenu>
              <ActionMenu.Anchor>
                <IconButton
                  type="button"
                  icon={KebabHorizontalIcon}
                  variant="invisible"
                  size="medium"
                  aria-label="Mais opções de formatação"
                  disabled={disabled || mode === 'preview'}
                />
              </ActionMenu.Anchor>
              <ActionMenu.Overlay align="start">
                <ActionList>
                  {SECONDARY_ACTIONS.map(({ action, icon, label: actionLabel }) => (
                    <ActionList.Item key={action} onSelect={() => runAction(action)}>
                      <ActionList.LeadingVisual>{createElement(icon)}</ActionList.LeadingVisual>
                      {actionLabel}
                    </ActionList.Item>
                  ))}
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
          </Box>
          <SegmentedControl
            aria-label="Editar ou pré-visualizar"
            size="small"
            onChange={(index) => setMode(index === 0 ? 'edit' : 'preview')}
          >
            <SegmentedControl.Button
              type="button"
              disabled={disabled}
              selected={mode === 'edit'}
              leadingIcon={PencilIcon}
            >
              Editar
            </SegmentedControl.Button>
            <SegmentedControl.Button
              type="button"
              disabled={disabled}
              selected={mode === 'preview'}
              leadingIcon={EyeIcon}
            >
              Prévia
            </SegmentedControl.Button>
          </SegmentedControl>
        </Box>

        {mode === 'edit' ? (
          <Textarea
            id={id}
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setToolbarError('')
              onChange(e.target.value)
            }}
            onKeyDown={handleKeyDown}
            required={required}
            validationStatus={validation ? 'error' : undefined}
            aria-describedby={describedBy}
            placeholder={placeholder}
            rows={rows}
            maxLength={maxLength}
            disabled={disabled}
            resize="vertical"
            block
            sx={{
              border: 0,
              borderRadius: 0,
              '& textarea': {
                minHeight: CONTENT_MIN_HEIGHT,
                p: 3,
                fontSize: '16px',
                lineHeight: 1.6,
              },
            }}
          />
        ) : (
          <Box
            id={id}
            role="region"
            aria-label={`Prévia: ${label || 'Conteúdo Markdown'}`}
            aria-describedby={describedBy}
            tabIndex={0}
            sx={{ p: 2, minHeight: CONTENT_MIN_HEIGHT }}
          >
            {text.trim() ? (
              <MarkdownViewer value={text} />
            ) : (
              <Text sx={{ color: 'fg.muted', fontSize: 1 }}>Nada para pré-visualizar ainda.</Text>
            )}
          </Box>
        )}
      </Box>

      <FormControl.Caption>
        <Box
          as="span"
          sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 2 }}
        >
          <span>{caption || 'Aceita **negrito**, _itálico_, listas, links e tabelas.'}</span>
          <Text
            aria-live="polite"
            sx={{
              flexShrink: 0,
              color:
                text.length >= maxLength
                  ? 'danger.fg'
                  : text.length >= maxLength * 0.9
                    ? 'attention.fg'
                    : 'fg.muted',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {text.length} / {maxLength}
          </Text>
        </Box>
      </FormControl.Caption>
      {validation && <FormControl.Validation variant="error">{validation}</FormControl.Validation>}
      {linkDraft && (
        <LinkDialog
          draft={linkDraft}
          setDraft={setLinkDraft}
          onCancel={closeLinkDialog}
          onInsert={insertLink}
          inputRef={linkInputRef}
          returnFocusRef={textareaRef}
        />
      )}
    </FormControl>
  )
}
