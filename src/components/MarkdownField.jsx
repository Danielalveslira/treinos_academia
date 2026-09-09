import { useRef, useState } from 'react'
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

// Campo de texto com formatação Markdown: toolbar insere sintaxe no textarea (sem
// nenhuma lib de editor pesada) e uma aba de pré-visualização reaproveita o mesmo
// MarkdownViewer usado para exibir o conteúdo já publicado — a prévia é exatamente
// o que vai aparecer depois. Controlado: todo o estado vive em quem usa o campo.
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
  const [mode, setMode] = useState('edit')
  const textareaRef = useRef(null)
  const text = typeof value === 'string' ? value : ''

  function runAction(action) {
    const el = textareaRef.current
    if (!el) return
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
    onChange(nextValue.slice(0, maxLength))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(selectionStart, selectionEnd)
    })
  }

  return (
    <FormControl required={required} disabled={disabled}>
      {label && <FormControl.Label>{label}</FormControl.Label>}
      <Box
        sx={{
          border: '1px solid',
          borderColor: error ? 'danger.emphasis' : 'border.default',
          borderRadius: 2,
          overflow: 'hidden',
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
          <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
            {TOOLBAR_ACTIONS.map(({ action, icon, label: actionLabel }) => (
              <IconButton
                key={action}
                type="button"
                icon={icon}
                variant="invisible"
                size="small"
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
            <SegmentedControl.Button selected={mode === 'edit'} leadingIcon={PencilIcon}>
              Editar
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={mode === 'preview'} leadingIcon={EyeIcon}>
              Prévia
            </SegmentedControl.Button>
          </SegmentedControl>
        </Box>

        {mode === 'edit' ? (
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
            placeholder={placeholder}
            rows={rows}
            maxLength={maxLength}
            disabled={disabled}
            block
            sx={{ border: 0, borderRadius: 0, resize: 'vertical' }}
          />
        ) : (
          <Box sx={{ p: 2, minHeight: `${rows * 1.6}em` }}>
            {text.trim() ? (
              <MarkdownViewer value={text} />
            ) : (
              <Text sx={{ color: 'fg.muted', fontSize: 1 }}>Nada para pré-visualizar ainda.</Text>
            )}
          </Box>
        )}
      </Box>

      <FormControl.Caption>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
          <span>{caption || 'Aceita **negrito**, _itálico_, listas, links e tabelas.'}</span>
          <Text sx={{ flexShrink: 0, color: text.length >= maxLength ? 'danger.fg' : 'fg.muted' }}>
            {text.length}/{maxLength}
          </Text>
        </Box>
      </FormControl.Caption>
      {error && <FormControl.Validation variant="error">{error}</FormControl.Validation>}
    </FormControl>
  )
}
