import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button, FormControl, TextInput } from '@primer/react'
import { LocationIcon, XCircleFillIcon } from '@primer/octicons-react'
import { useMunicipalityCatalog } from '../hooks/useMunicipalityCatalog'
import {
  findMunicipality,
  formatMunicipality,
  MUNICIPALITY_MIN_QUERY_LENGTH,
  MUNICIPALITY_SUGGESTION_LIMIT,
  normalizeSearchText,
  resolveExactMunicipality,
  searchMunicipalities,
} from '../utils/municipalities'

export const CITY_SELECTOR_CAPTION = 'Selecione sua cidade. Não precisamos do seu endereço.'
export const CITY_NOT_SELECTED_MESSAGE = 'Escolha uma cidade da lista de sugestões.'

// Seletor de município (catálogo oficial do IBGE, busca 100% local). O valor é SEMPRE o código IBGE
// de uma cidade do catálogo, ou null -- texto digitado nunca vira valor. Combobox no padrão ARIA 1.2
// (lista com seleção automática do 1º item): setas navegam, Enter escolhe, Escape fecha/limpa.
// Nenhuma permissão de localização, nenhum endereço: só a cidade.
//
// Reutilizável (cadastro, conclusão de perfil, Meu Perfil e, no futuro, filtros regionais): quem usa
// decide o rótulo, a obrigatoriedade e o que fazer com o código.
export function CitySelector({
  value = null,
  onChange,
  error = '',
  disabled = false,
  required = true,
  label = 'Cidade onde mora',
  caption = CITY_SELECTOR_CAPTION,
}) {
  const catalog = useMunicipalityCatalog()
  const baseId = useId()
  const listId = `${baseId}-list`
  const inputRef = useRef(null)
  const activeOptionRef = useRef(null)
  // null = mostra a cidade selecionada; string = o que a pessoa está digitando.
  const [query, setQuery] = useState(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [unselectedHint, setUnselectedHint] = useState(false)

  const selected = findMunicipality(catalog.index, value)
  const display =
    query ??
    (value == null
      ? ''
      : selected
        ? formatMunicipality(selected)
        : catalog.status === 'ready'
          ? `Código IBGE ${value}`
          : '')
  const results = useMemo(
    () =>
      query == null
        ? []
        : searchMunicipalities(catalog.index, query, { limit: MUNICIPALITY_SUGGESTION_LIMIT + 1 }),
    [catalog.index, query]
  )
  const visible = results.slice(0, MUNICIPALITY_SUGGESTION_LIMIT)
  const hasMore = results.length > MUNICIPALITY_SUGGESTION_LIMIT
  const ready = catalog.status === 'ready'
  const expanded = open && ready && visible.length > 0
  const typedLength = normalizeSearchText(query ?? '').length

  // Mantém a opção ativa visível quando a lista rola (teclado).
  useEffect(() => {
    if (!expanded) return
    activeOptionRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [active, expanded])

  function choose(entry) {
    setQuery(null)
    setOpen(false)
    setActive(0)
    setUnselectedHint(false)
    if (entry.code !== value) onChange(entry.code)
  }

  function handleInput(event) {
    const text = event.target.value
    setQuery(text)
    setOpen(true)
    setActive(0)
    setUnselectedHint(false)
    // Editar o texto desfaz a seleção: o valor só volta a existir escolhendo uma sugestão.
    if (value != null) onChange(null)
  }

  function clear() {
    setQuery(null)
    setOpen(false)
    setUnselectedHint(false)
    if (value != null) onChange(null)
    inputRef.current?.focus()
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) setOpen(true)
      else if (visible.length) setActive((current) => (current + 1) % visible.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (visible.length) setActive((current) => (current - 1 + visible.length) % visible.length)
    } else if (event.key === 'Enter') {
      // Com a lista aberta, Enter escolhe -- nunca envia o formulário com texto livre no campo.
      if (expanded) {
        event.preventDefault()
        choose(visible[active] ?? visible[0])
      } else if (query != null && query.trim()) {
        event.preventDefault()
        const exact = resolveExactMunicipality(catalog.index, query)
        if (exact) choose(exact)
        else setUnselectedHint(true)
      }
    } else if (event.key === 'Escape') {
      if (expanded) {
        event.preventDefault()
        setOpen(false)
      } else if (query != null) {
        event.preventDefault()
        // Desiste da edição: volta a mostrar a cidade já selecionada (se houver).
        setQuery(null)
        setUnselectedHint(false)
      }
    } else if (event.key === 'Tab' && expanded && query != null) {
      setOpen(false)
    }
  }

  function handleBlur() {
    setOpen(false)
    if (query == null) return
    if (!query.trim()) {
      setQuery(null)
      return
    }
    // Sem ambiguidade (nome completo de uma única cidade, ex.: "Brasília" ou "Bom Jesus PI"), aceita
    // o que foi digitado; caso contrário mantém o texto e pede para escolher na lista.
    const exact = value == null ? resolveExactMunicipality(catalog.index, query) : null
    if (exact) choose(exact)
    else if (value == null) setUnselectedHint(true)
  }

  let status = ''
  if (catalog.status === 'loading') status = 'Carregando a lista de cidades…'
  else if (open && query != null && ready) {
    if (typedLength < MUNICIPALITY_MIN_QUERY_LENGTH)
      status = `Digite pelo menos ${MUNICIPALITY_MIN_QUERY_LENGTH} letras do nome da cidade.`
    else if (!visible.length) status = 'Nenhuma cidade encontrada. Confira a grafia.'
    else
      status = `${visible.length}${hasMore ? '+' : ''} ${
        visible.length === 1 ? 'cidade encontrada' : 'cidades encontradas'
      }. Use as setas para escolher${hasMore ? ' ou continue digitando para refinar' : ''}.`
  }
  const validation = error || (unselectedHint ? CITY_NOT_SELECTED_MESSAGE : '')

  return (
    // TextInput é filho DIRETO do FormControl de propósito: é assim que o Primer liga id, required,
    // disabled e aria-describedby (legenda/erro) ao campo. Lista, status e erro de carregamento vêm
    // logo depois, como irmãos.
    <FormControl required={required} disabled={disabled} className="city-selector">
      <FormControl.Label>{label}</FormControl.Label>
      <TextInput
        ref={inputRef}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
        aria-invalid={validation ? true : undefined}
        leadingVisual={LocationIcon}
        trailingAction={
          display && !disabled && ready ? (
            <TextInput.Action
              onClick={clear}
              icon={XCircleFillIcon}
              aria-label="Limpar cidade"
              tooltipDirection="nw"
            />
          ) : undefined
        }
        value={display}
        placeholder={
          catalog.status === 'loading' ? 'Carregando cidades…' : 'Digite o nome da cidade'
        }
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (query != null) setOpen(true)
        }}
        onBlur={handleBlur}
        readOnly={!ready}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        size="large"
        block
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Cidades sugeridas"
        className="city-selector-list"
        hidden={!expanded}
      >
        {expanded &&
          visible.map((entry, index) => (
            <li
              key={entry.code}
              id={`${listId}-${index}`}
              ref={index === active ? activeOptionRef : undefined}
              role="option"
              aria-selected={index === active}
              className="city-selector-option"
              // mousedown (não click): escolhe antes do blur do campo fechar a lista.
              onMouseDown={(event) => {
                event.preventDefault()
                choose(entry)
              }}
              onMouseMove={() => {
                if (index !== active) setActive(index)
              }}
            >
              <span className="city-selector-name">{entry.name}</span>
              <span className="city-selector-uf"> — {entry.uf}</span>
            </li>
          ))}
      </ul>
      <p className="city-selector-status" role="status" aria-live="polite">
        {status}
      </p>
      {catalog.status === 'error' && (
        <div className="city-selector-error" role="alert">
          <span>
            {catalog.stale
              ? 'O Evolutus foi atualizado. Recarregue a página para carregar a lista de cidades.'
              : 'Não foi possível carregar a lista de cidades. Verifique sua conexão.'}
          </span>
          <Button
            type="button"
            size="small"
            onClick={catalog.stale ? () => window.location.reload() : catalog.retry}
          >
            {catalog.stale ? 'Recarregar' : 'Tentar novamente'}
          </Button>
        </div>
      )}
      {caption && <FormControl.Caption>{caption}</FormControl.Caption>}
      {validation ? (
        <FormControl.Validation variant="error">{validation}</FormControl.Validation>
      ) : (
        // Seleção válida do catálogo: mesmo padrão "validado" dos outros campos (verde + ícone de
        // confirmação do Primer + texto), nunca só a cor. Apagar/editar a cidade some com ele.
        selected &&
        query == null && (
          <FormControl.Validation variant="success">
            {`Cidade selecionada: ${formatMunicipality(selected)}`}
          </FormControl.Validation>
        )
      )}
    </FormControl>
  )
}
