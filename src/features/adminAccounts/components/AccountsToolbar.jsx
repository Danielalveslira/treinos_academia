import { useState } from 'react'
import { ActionList, ActionMenu, Box, Button, IconButton, TextInput } from '@primer/react'
import {
  DownloadIcon,
  FilterIcon,
  KebabHorizontalIcon,
  SearchIcon,
  XIcon,
} from '@primer/octicons-react'
import {
  COLUMN_OPTIONS,
  COMMUNITY_OPTIONS,
  FINANCIAL_LABELS,
  LAST_ACCESS_OPTIONS,
  ROLE_LABELS,
  STATUS_LABELS,
  hasActiveFilters,
} from '../utils/accounts'

const toOptions = (labels) => Object.entries(labels).map(([key, label]) => ({ key, label }))
const FILTERS = [
  { key: 'status', label: 'Status', options: toOptions(STATUS_LABELS) },
  { key: 'role', label: 'Papel', options: toOptions(ROLE_LABELS) },
  { key: 'lastAccess', label: 'Último uso', options: LAST_ACCESS_OPTIONS },
  { key: 'community', label: 'Comunidade', options: COMMUNITY_OPTIONS },
  { key: 'financial', label: 'Financeiro', options: toOptions(FINANCIAL_LABELS) },
]

function FilterMenu({ label, options, value, onChange }) {
  const selected = options.find((option) => option.key === value)
  return (
    <ActionMenu>
      <ActionMenu.Button variant="invisible">
        {selected ? `${label}: ${selected.label}` : label}
      </ActionMenu.Button>
      <ActionMenu.Overlay width="medium">
        <ActionList selectionVariant="single">
          <ActionList.Item selected={!value} onSelect={() => onChange('')}>
            Todos
          </ActionList.Item>
          {options.map((option) => (
            <ActionList.Item
              key={option.key}
              selected={value === option.key}
              onSelect={() => onChange(option.key)}
            >
              {option.label}
            </ActionList.Item>
          ))}
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}

export function AccountsToolbar({
  filters,
  onFilterChange,
  onClearFilters,
  visibleColumns,
  onToggleColumn,
  onExport,
  exportCount,
}) {
  const [expanded, setExpanded] = useState(false)
  const active = FILTERS.filter((filter) => filters[filter.key])
  return (
    <Box sx={{ mb: 2 }}>
      <Box className="accounts-search-row">
        <TextInput
          block
          sx={{ minHeight: 44, minWidth: 0 }}
          aria-label="Buscar por @usuário, e-mail ou UID"
          placeholder="Buscar conta..."
          leadingVisual={SearchIcon}
          trailingAction={
            filters.search ? (
              <TextInput.Action
                onClick={() => onFilterChange('search', '')}
                icon={XIcon}
                aria-label="Limpar busca"
              />
            ) : undefined
          }
          value={filters.search}
          onChange={(event) => onFilterChange('search', event.target.value)}
        />
        <IconButton
          icon={FilterIcon}
          variant="invisible"
          aria-label={`Filtros${active.length ? ` (${active.length})` : ''}`}
          aria-expanded={expanded}
          aria-controls="accounts-filters"
          onClick={() => setExpanded(!expanded)}
          sx={{ minWidth: 44, color: active.length ? 'accent.fg' : 'fg.muted' }}
        />
        <ActionMenu>
          <ActionMenu.Anchor>
            <IconButton
              icon={KebabHorizontalIcon}
              variant="invisible"
              aria-label="Opções da lista"
              sx={{ minWidth: 44 }}
            />
          </ActionMenu.Anchor>
          <ActionMenu.Overlay align="end" width="medium">
            <ActionList>
              <ActionList.Item onSelect={onExport} disabled={exportCount === 0}>
                <ActionList.LeadingVisual>
                  <DownloadIcon />
                </ActionList.LeadingVisual>
                Exportar CSV
                <ActionList.Description variant="block">
                  Lista filtrada · {exportCount} contas
                </ActionList.Description>
              </ActionList.Item>
              <ActionList.Divider />
              <ActionList.Group title="Colunas da tabela" selectionVariant="multiple">
                {COLUMN_OPTIONS.map((column) => (
                  <ActionList.Item
                    key={column.key}
                    selected={visibleColumns.has(column.key)}
                    onSelect={() => onToggleColumn(column.key)}
                  >
                    {column.label}
                  </ActionList.Item>
                ))}
              </ActionList.Group>
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
      </Box>
      {expanded && (
        <Box
          id="accounts-filters"
          className="accounts-filter-panel"
          sx={{ bg: 'canvas.subtle', borderRadius: 2 }}
        >
          {FILTERS.map((filter) => (
            <FilterMenu
              key={filter.key}
              {...filter}
              value={filters[filter.key]}
              onChange={(value) => onFilterChange(filter.key, value)}
            />
          ))}
        </Box>
      )}
      {hasActiveFilters(filters) && (
        <Box className="accounts-active-filters">
          {active.map((filter) => (
            <Button
              key={filter.key}
              variant="invisible"
              size="small"
              trailingVisual={XIcon}
              onClick={() => onFilterChange(filter.key, '')}
              aria-label={`Remover filtro ${filter.label}`}
            >
              {filter.options.find((option) => option.key === filters[filter.key])?.label}
            </Button>
          ))}
          {filters.card && (
            <Button
              variant="invisible"
              size="small"
              trailingVisual={XIcon}
              onClick={() => onFilterChange('card', '')}
            >
              Remover indicador
            </Button>
          )}
          <Button variant="invisible" size="small" onClick={onClearFilters}>
            Limpar filtros
          </Button>
        </Box>
      )}
    </Box>
  )
}
