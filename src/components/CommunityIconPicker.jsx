import { useState } from 'react'
import { CheckIcon, SearchIcon } from '@primer/octicons-react'
import {
  COMMUNITY_ICON_CATEGORIES,
  COMMUNITY_ICON_OPTIONS,
  getCommunityIconOption,
} from '../constants/communityIcons'
import { CommunityIcon } from './CommunityIcon'

function searchText(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function CommunityIconPicker({ value, onChange, name }) {
  const selectedOption = getCommunityIconOption(value)
  const [category, setCategory] = useState(() => selectedOption.category)
  const [query, setQuery] = useState('')
  const normalizedQuery = searchText(query.trim())
  const options = COMMUNITY_ICON_OPTIONS.filter((option) => {
    const inCategory = category === 'all' || option.category === category
    const matchesQuery =
      !normalizedQuery || searchText(`${option.label} ${option.purpose}`).includes(normalizedQuery)
    return inCategory && matchesQuery
  })

  return (
    <div className="community-icon-picker">
      <div className="community-icon-picker-preview" aria-live="polite">
        <CommunityIcon community={{ iconName: selectedOption.name }} size={48} />
        <div>
          <strong>{selectedOption.label}</strong>
          <span>{selectedOption.purpose}</span>
          {name?.trim() && <small>{name.trim()}</small>}
        </div>
      </div>

      <div className="community-icon-filters" role="group" aria-label="Categorias de ícones">
        {COMMUNITY_ICON_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`community-icon-filter${category === item.id ? ' is-active' : ''}`}
            aria-pressed={category === item.id}
            onClick={() => {
              setCategory(item.id)
              setQuery('')
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <label className="community-icon-search">
        <SearchIcon size={16} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="Buscar ícone"
          aria-label="Buscar ícone"
          onChange={(event) => {
            setQuery(event.target.value)
            setCategory('all')
          }}
        />
      </label>

      <div className="community-icon-grid" role="group" aria-label="Ícones da comunidade">
        {options.map((option) => {
          const Icon = option.icon
          const selected = selectedOption.name === option.name
          return (
            <button
              key={option.name}
              type="button"
              aria-pressed={selected}
              aria-label={`${option.label} — ${option.purpose}`}
              title={`${option.label} — ${option.purpose}`}
              className={`community-icon-option${selected ? ' is-selected' : ''}`}
              onClick={() => onChange(option.name)}
            >
              <Icon size={21} strokeWidth={2} aria-hidden="true" />
              <span className="community-icon-option-label">{option.label}</span>
              {selected && (
                <CheckIcon className="community-icon-option-check" size={12} aria-hidden="true" />
              )}
            </button>
          )
        })}
      </div>
      {options.length === 0 && <p className="community-icon-empty">Nenhum ícone encontrado.</p>}
    </div>
  )
}
