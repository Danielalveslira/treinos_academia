import { useId, useRef, useState } from 'react'
import { Box, FormControl, IconButton, SegmentedControl, Text, Textarea } from '@primer/react'
import {
  BoldIcon,
  ItalicIcon,
  LinkIcon,
  QuoteIcon,
  CodeIcon,
  ListUnorderedIcon,
  ListOrderedIcon,
  TasklistIcon,
  PencilIcon,
  EyeIcon,
} from '@primer/octicons-react'
import { applyMarkdownAction } from '../utils/markdownToolbar'
import { MarkdownViewer } from './MarkdownViewer'

const TOOLBAR_ACTIONS = [
  { action: 'bold', icon: BoldIcon, label: 'Negrito' },
  { action: 'italic', icon: ItalicIcon, label: 'Itálico' },
  { action: 'link', icon: LinkIcon, label: 'Link' },
  { action: 'quote', icon: QuoteIcon, label: 'Citação' },
  { action: 'code', icon: CodeIcon, label: 'Código' },
  { action: 'unorderedList', icon: ListUnorderedIcon, label: 'Lista' },
  { action: 'orderedList', icon: ListOrderedIcon, label: 'Lista numerada' },
  { action: 'checklist', icon: TasklistIcon, label: 'Checklist' },
]

const CONTENT_MIN_HEIGHT = ['240px', '320px']

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
  rows = 10,
}) {
  const id = useId()
  const [mode, setMode] = useState('edit')
  const [toolbarError, setToolbarError] = useState('')
  const textareaRef = useRef(null)
  const text = typeof value === 'string' ? value : ''
  const validation = error || toolbarError
  const describedBy = `${id}-caption${validation ? ` ${id}-validationMessage` : ''}`

  function runAction(action) {
    const el = textareaRef.current
    if (!el || disabled || mode !== 'edit') return
    const {
      value: nextValue,
      selectionStart,
      selectionEnd,
    } = applyMarkdownAction(
      action,
      text,
      el.selectionStart ?? text.length,
      el.selectionEnd ?? text.length
    )
    if (nextValue.length > maxLength) {
      setToolbarError(`A formatação ultrapassa o limite de ${maxLength} caracteres.`)
      el.focus()
      return
    }
    setToolbarError('')
    onChange(nextValue)
    requestAnimationFrame(() => {
      if (!el.isConnected) return
      el.focus()
      el.setSelectionRange(selectionStart, selectionEnd)
    })
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
            sx={{ display: 'flex', flexWrap: 'wrap' }}
          >
            {TOOLBAR_ACTIONS.map(({ action, icon, label: actionLabel }) => (
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
              '& textarea': { minHeight: CONTENT_MIN_HEIGHT, fontSize: '16px' },
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
          <Text sx={{ flexShrink: 0, color: text.length >= maxLength ? 'danger.fg' : 'fg.muted' }}>
            {text.length}/{maxLength}
          </Text>
        </Box>
      </FormControl.Caption>
      {validation && <FormControl.Validation variant="error">{validation}</FormControl.Validation>}
    </FormControl>
  )
}
