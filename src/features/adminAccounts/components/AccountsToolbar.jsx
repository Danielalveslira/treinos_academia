import { ActionList, ActionMenu, Box, Button, TextInput } from '@primer/react'
import { DownloadIcon, SearchIcon, XIcon } from '@primer/octicons-react'
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

const STATUS_OPTIONS = toOptions(STATUS_LABELS)
const ROLE_OPTIONS = toOptions(ROLE_LABELS)
const FINANCIAL_OPTIONS = toOptions(FINANCIAL_LABELS)

function FilterMenu({ label, options, value, onChange }) {
  const selected = options.find((option) => option.key === value)
  return (
    <ActionMenu>
      <ActionMenu.Button size="medium" variant={selected ? 'primary' : 'default'}>
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
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
      <TextInput
        block
        aria-label="Buscar por @usuário, e-mail ou UID"
        placeholder="Buscar por @usuário, e-mail ou UID"
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
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
        <FilterMenu
          label="Status"
          options={STATUS_OPTIONS}
          value={filters.status}
          onChange={(value) => onFilterChange('status', value)}
        />
        <FilterMenu
          label="Papel"
          options={ROLE_OPTIONS}
          value={filters.role}
          onChange={(value) => onFilterChange('role', value)}
        />
        <FilterMenu
          label="Último uso"
          options={LAST_ACCESS_OPTIONS}
          value={filters.lastAccess}
          onChange={(value) => onFilterChange('lastAccess', value)}
        />
        <FilterMenu
          label="Comunidade"
          options={COMMUNITY_OPTIONS}
          value={filters.community}
          onChange={(value) => onFilterChange('community', value)}
        />
        <FilterMenu
          label="Financeiro"
          options={FINANCIAL_OPTIONS}
          value={filters.financial}
          onChange={(value) => onFilterChange('financial', value)}
        />
        {hasActiveFilters(filters) && (
          <Button variant="invisible" size="small" onClick={onClearFilters}>
            Limpar filtros
          </Button>
        )}
        <Box sx={{ display: 'flex', gap: 2, ml: [0, null, 'auto'] }}>
          <ActionMenu>
            <ActionMenu.Button>Colunas</ActionMenu.Button>
            <ActionMenu.Overlay width="small">
              <ActionList selectionVariant="multiple">
                {COLUMN_OPTIONS.map((column) => (
                  <ActionList.Item
                    key={column.key}
                    selected={visibleColumns.has(column.key)}
                    onSelect={() => onToggleColumn(column.key)}
                  >
                    {column.label}
                  </ActionList.Item>
                ))}
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
          <Button leadingVisual={DownloadIcon} onClick={onExport} disabled={exportCount === 0}>
            Exportar CSV
          </Button>
        </Box>
      </Box>
    </Box>
  )
}
