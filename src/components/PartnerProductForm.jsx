import { useState } from 'react'
import {
  Box,
  Heading,
  Text,
  FormControl,
  TextInput,
  Textarea,
  Checkbox,
  Button,
} from '@primer/react'
import { ImageIcon } from '@primer/octicons-react'
import { isValidPartnerProductUrl } from '../utils/validators'

// Rótulo de seção discreto (Produto / Links e mídia / Publicação) -- só agrupa
// visualmente os campos, sem introduzir um componente Primer novo pra isso.
function SectionLabel({ children }) {
  return (
    <Text
      as="h4"
      sx={{
        fontSize: 0,
        fontWeight: 'bold',
        color: 'fg.muted',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        display: 'block',
        mb: 2,
      }}
    >
      {children}
    </Text>
  )
}

const TWO_COLUMNS = ['1fr', null, '1fr 1fr']

// Formulário de edição de produtos legados (CommercialAdmin) -- só edição: o cadastro
// de novos produtos por este fluxo foi removido (PR3), preservando apenas
// edição/exclusão/associação dos registros legados existentes. Mobile-first: uma
// coluna em telas pequenas, grade de duas colunas a partir do breakpoint "medium" do
// Primer. Validação de campo fica em validatePartnerProduct (utils/validators.js); aqui
// só exibimos o que já vem calculado em `errors`, sem duplicar regra de negócio.
export function PartnerProductForm({
  form,
  errors,
  requireImage,
  busy,
  onFieldChange,
  onSubmit,
  onCancel,
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const trimmedImageUrl = form.image_url.trim()
  const imageUrlLooksValid = trimmedImageUrl !== '' && isValidPartnerProductUrl(trimmedImageUrl)

  function handleChange(field) {
    return (event) => onFieldChange(field, event.target.value)
  }

  function handleImageUrlChange(event) {
    setImageFailed(false)
    onFieldChange('image_url', event.target.value)
  }

  return (
    <Box
      as="form"
      onSubmit={onSubmit}
      sx={{ border: '1px solid', borderColor: 'border.default', borderRadius: 2, p: 3, mb: 4 }}
    >
      <Heading as="h3" sx={{ fontSize: 2, mb: 1 }}>
        Editar produto
      </Heading>
      <Text sx={{ fontSize: 0, color: 'fg.muted', display: 'block', mb: 3 }}>
        Estes registros legados permanecem privados na administração. Publicação comercial exige uma
        vitrine aprovada com contratação vigente.
      </Text>

      <SectionLabel>Produto</SectionLabel>
      <Box sx={{ display: 'grid', gridTemplateColumns: TWO_COLUMNS, gap: 3, mb: 3 }}>
        <FormControl required>
          <FormControl.Label>Nome do produto</FormControl.Label>
          <TextInput
            value={form.name}
            maxLength={120}
            onChange={handleChange('name')}
            block
            autoFocus
          />
          {errors.name && (
            <FormControl.Validation variant="error">{errors.name}</FormControl.Validation>
          )}
        </FormControl>

        <FormControl required>
          <FormControl.Label>Marca</FormControl.Label>
          <TextInput value={form.brand} maxLength={120} onChange={handleChange('brand')} block />
          {errors.brand && (
            <FormControl.Validation variant="error">{errors.brand}</FormControl.Validation>
          )}
        </FormControl>

        <FormControl required>
          <FormControl.Label>Categoria</FormControl.Label>
          <TextInput
            value={form.category}
            maxLength={80}
            onChange={handleChange('category')}
            block
          />
          {errors.category && (
            <FormControl.Validation variant="error">{errors.category}</FormControl.Validation>
          )}
        </FormControl>

        <FormControl required sx={{ gridColumn: ['auto', null, '1 / -1'] }}>
          <FormControl.Label>Descrição</FormControl.Label>
          <Textarea
            value={form.description}
            maxLength={500}
            rows={3}
            onChange={handleChange('description')}
            block
          />
          {errors.description && (
            <FormControl.Validation variant="error">{errors.description}</FormControl.Validation>
          )}
        </FormControl>
      </Box>

      <SectionLabel>Links e mídia</SectionLabel>
      <Box sx={{ display: 'grid', gridTemplateColumns: TWO_COLUMNS, gap: 3, mb: 2 }}>
        <FormControl required>
          <FormControl.Label>URL da loja</FormControl.Label>
          <TextInput
            type="url"
            value={form.store_url}
            maxLength={500}
            onChange={handleChange('store_url')}
            block
          />
          <FormControl.Caption>
            Link HTTPS da página de compra na loja do parceiro.
          </FormControl.Caption>
          {errors.storeUrl && (
            <FormControl.Validation variant="error">{errors.storeUrl}</FormControl.Validation>
          )}
        </FormControl>

        <FormControl required={requireImage}>
          <FormControl.Label>
            {requireImage ? 'URL da imagem' : 'URL da imagem (opcional)'}
          </FormControl.Label>
          <TextInput
            type="url"
            value={form.image_url}
            maxLength={500}
            onChange={handleImageUrlChange}
            block
          />
          <FormControl.Caption>
            {requireImage
              ? 'Obrigatória para cadastrar ou publicar o produto. Link HTTPS de uma imagem do produto.'
              : 'Link HTTPS de uma imagem do produto. Obrigatória antes de publicar.'}
          </FormControl.Caption>
          {errors.imageUrl && (
            <FormControl.Validation variant="error">{errors.imageUrl}</FormControl.Validation>
          )}
        </FormControl>
      </Box>

      {trimmedImageUrl !== '' && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <Box
            sx={{
              width: 64,
              height: 64,
              borderRadius: 2,
              overflow: 'hidden',
              border: '1px solid',
              borderColor: 'border.default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bg: 'canvas.subtle',
              color: 'fg.muted',
              flexShrink: 0,
            }}
          >
            {imageUrlLooksValid && !imageFailed ? (
              <Box
                as="img"
                src={trimmedImageUrl}
                alt=""
                sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                onError={() => setImageFailed(true)}
                onLoad={() => setImageFailed(false)}
              />
            ) : (
              <ImageIcon size={20} />
            )}
          </Box>
          <Text
            sx={{
              fontSize: 0,
              color: imageUrlLooksValid && !imageFailed ? 'fg.muted' : 'danger.fg',
            }}
          >
            {!imageUrlLooksValid
              ? 'Informe uma URL HTTPS válida para ver a prévia.'
              : imageFailed
                ? 'Não foi possível carregar essa imagem.'
                : 'Prévia da imagem do produto.'}
          </Text>
        </Box>
      )}

      <SectionLabel>Histórico editorial legado</SectionLabel>
      <Box sx={{ display: 'grid', gridTemplateColumns: TWO_COLUMNS, gap: 3, mb: 3 }}>
        <FormControl>
          <FormControl.Label>Início (opcional)</FormControl.Label>
          <TextInput
            type="datetime-local"
            value={form.starts_at}
            onChange={handleChange('starts_at')}
            block
          />
        </FormControl>

        <FormControl>
          <FormControl.Label>Fim (opcional)</FormControl.Label>
          <TextInput
            type="datetime-local"
            value={form.ends_at}
            onChange={handleChange('ends_at')}
            block
          />
          {errors.endsAt && (
            <FormControl.Validation variant="error">{errors.endsAt}</FormControl.Validation>
          )}
        </FormControl>
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 4, mb: 3 }}>
        <FormControl>
          <Checkbox
            checked={form.sponsored}
            onChange={(e) => onFieldChange('sponsored', e.target.checked)}
          />
          <FormControl.Label>Patrocinado</FormControl.Label>
        </FormControl>

        <FormControl>
          <Checkbox
            checked={form.approved}
            onChange={(e) => onFieldChange('approved', e.target.checked)}
          />
          <FormControl.Label>Aprovação legada (não publica)</FormControl.Label>
        </FormControl>
      </Box>

      <Box
        sx={{
          display: 'flex',
          flexDirection: ['column-reverse', 'row'],
          gap: 2,
          justifyContent: ['stretch', 'flex-end'],
        }}
      >
        <Button
          type="button"
          variant="invisible"
          onClick={onCancel}
          disabled={busy}
          sx={{ width: ['100%', 'auto'] }}
        >
          Cancelar edição
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={busy}
          sx={{ width: ['100%', 'auto'] }}
        >
          Salvar alterações
        </Button>
      </Box>
    </Box>
  )
}
