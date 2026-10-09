import { useState } from 'react'
import { Box, Button, Select, Text, TextInput } from '@primer/react'
import {
  DEFAULT_FILTERS,
  PERIOD_PRESETS,
  PLACEMENTS,
  placementLabel,
  validateCustomRange,
} from '../utils/metrics'

const label = { fontSize: 0, color: 'fg.muted', display: 'block', mb: 1 }

// Filtros que mudam a consulta (período, campanha, comunidade, posição). Cada mudança é UMA leitura (ou cache);
// o intervalo personalizado só dispara ao tocar em "Aplicar", nunca a cada tecla.
export function MetricsFilters({ filters, onChange, ads, communities, today, disabled }) {
  const custom = Boolean(filters.from && filters.to)
  const [open, setOpen] = useState(custom)
  const [draft, setDraft] = useState({ from: filters.from || '', to: filters.to || '' })
  const [error, setError] = useState(null)

  function apply() {
    const message = validateCustomRange(draft.from, draft.to, today)
    setError(message)
    if (!message) onChange({ ...filters, days: null, from: draft.from, to: draft.to })
  }

  function preset(days) {
    setOpen(false)
    setError(null)
    onChange({ ...filters, days, from: null, to: null })
  }

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}
      role="group"
      aria-label="Filtros das métricas"
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {PERIOD_PRESETS.map((days) => (
          <Button
            key={days}
            size="small"
            disabled={disabled}
            aria-pressed={!custom && filters.days === days}
            variant={!custom && filters.days === days ? 'primary' : 'default'}
            onClick={() => preset(days)}
            sx={{ minHeight: 36 }}
          >
            {days} dias
          </Button>
        ))}
        <Button
          size="small"
          disabled={disabled}
          aria-pressed={custom || open}
          variant={custom ? 'primary' : 'default'}
          onClick={() => setOpen((v) => !v)}
          sx={{ minHeight: 36 }}
        >
          Personalizado
        </Button>
      </Box>

      {open && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: ['1fr 1fr', null, 'repeat(2, 1fr) auto'],
            gap: 2,
            alignItems: 'end',
          }}
        >
          <Box>
            <Text as="label" htmlFor="ad-metrics-from" sx={label}>
              De
            </Text>
            <TextInput
              id="ad-metrics-from"
              type="date"
              block
              value={draft.from}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            />
          </Box>
          <Box>
            <Text as="label" htmlFor="ad-metrics-to" sx={label}>
              Até
            </Text>
            <TextInput
              id="ad-metrics-to"
              type="date"
              block
              value={draft.to}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            />
          </Box>
          <Button onClick={apply} disabled={disabled} sx={{ gridColumn: ['1 / -1', null, 'auto'] }}>
            Aplicar
          </Button>
          {error && (
            <Text role="alert" sx={{ gridColumn: '1 / -1', color: 'danger.fg', fontSize: 1 }}>
              {error}
            </Text>
          )}
          <Text sx={{ gridColumn: '1 / -1', fontSize: 0, color: 'fg.muted' }}>
            Até 366 dias. Os dias fecham à meia-noite de Brasília (America/Sao_Paulo).
          </Text>
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', null, 'repeat(3, 1fr)'], gap: 2 }}>
        <Box>
          <Text as="label" htmlFor="ad-metrics-ad" sx={label}>
            Campanha
          </Text>
          <Select
            id="ad-metrics-ad"
            block
            disabled={disabled}
            value={filters.adId || ''}
            onChange={(e) => onChange({ ...filters, adId: e.target.value || null })}
          >
            <Select.Option value="">Todas as campanhas</Select.Option>
            {ads.map((ad) => (
              <Select.Option key={ad.id} value={ad.id}>
                {ad.partnerName} — {ad.title}
              </Select.Option>
            ))}
          </Select>
        </Box>
        <Box>
          <Text as="label" htmlFor="ad-metrics-community" sx={label}>
            Comunidade
          </Text>
          <Select
            id="ad-metrics-community"
            block
            disabled={disabled}
            value={filters.communityId || ''}
            onChange={(e) => onChange({ ...filters, communityId: e.target.value || null })}
          >
            <Select.Option value="">Todas as comunidades</Select.Option>
            {communities.map((c) => (
              <Select.Option key={c.id} value={c.id}>
                {c.name}
              </Select.Option>
            ))}
          </Select>
        </Box>
        <Box>
          <Text as="label" htmlFor="ad-metrics-placement" sx={label}>
            Posicionamento
          </Text>
          <Select
            id="ad-metrics-placement"
            block
            disabled={disabled}
            value={filters.placement || ''}
            onChange={(e) => onChange({ ...filters, placement: e.target.value || null })}
          >
            <Select.Option value="">Todos os posicionamentos</Select.Option>
            {PLACEMENTS.map((p) => (
              <Select.Option key={p} value={p}>
                {placementLabel(p)}
              </Select.Option>
            ))}
          </Select>
        </Box>
      </Box>

      {(filters.adId ||
        filters.communityId ||
        filters.placement ||
        custom ||
        filters.days !== DEFAULT_FILTERS.days) && (
        <Box>
          <Button
            size="small"
            variant="invisible"
            disabled={disabled}
            onClick={() => {
              setOpen(false)
              setError(null)
              onChange({ ...DEFAULT_FILTERS })
            }}
          >
            Limpar filtros
          </Button>
        </Box>
      )}
    </Box>
  )
}
