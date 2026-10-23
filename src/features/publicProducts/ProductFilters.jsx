import { Box, Button, FormControl, Select, TextInput } from '@primer/react'
import { SearchIcon } from '@primer/octicons-react'

export function ProductFilters({ searchValue, onSearchChange, category, onCategoryChange, categories, hasFilters, onClear }) {
  return (
    <Box
      as="form"
      role="search"
      aria-label="Filtrar produtos"
      onSubmit={(event) => event.preventDefault()}
      sx={{ display: 'flex', flexDirection: ['column', null, 'row'], gap: 2, alignItems: ['stretch', null, 'flex-end'] }}
    >
      <FormControl sx={{ flex: '1 1 auto', minWidth: 0 }}>
        <FormControl.Label visuallyHidden>Buscar produtos ou marcas</FormControl.Label>
        <TextInput
          block
          type="search"
          leadingVisual={SearchIcon}
          placeholder="Buscar produtos ou marcas"
          value={searchValue}
          maxLength={80}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </FormControl>
      <FormControl sx={{ flex: ['1 1 auto', null, '0 0 240px'] }}>
        <FormControl.Label visuallyHidden>Categoria</FormControl.Label>
        <Select block value={category} onChange={(event) => onCategoryChange(event.target.value)}>
          <Select.Option value="">Todas as categorias</Select.Option>
          {categories.map((value) => (
            <Select.Option key={value} value={value}>{value}</Select.Option>
          ))}
        </Select>
      </FormControl>
      {hasFilters && (
        <Button type="button" variant="invisible" onClick={onClear} sx={{ flex: '0 0 auto' }}>
          Limpar filtros
        </Button>
      )}
    </Box>
  )
}
