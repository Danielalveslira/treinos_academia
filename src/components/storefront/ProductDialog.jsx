import { useRef, useState } from 'react'
import { Box, Button, Dialog, Flash, FormControl, Text, TextInput, Textarea } from '@primer/react'
import {
  saveStorefrontProduct,
  uploadStorefrontImage,
  discardStorefrontImage,
  isStorefrontImageLinked,
} from '../../services/storefrontService'
import { saveWithImage } from '../../utils/storefrontImageSave'
import { storefrontError } from '../../utils/storefront'
import { centavosToDigits } from '../../utils/currency'
import { formatCentavosBRL } from '../../utils/format'
import StorefrontImage from '../StorefrontImage'

const EMPTY = {
  name: '',
  brand: '',
  category: '',
  description: '',
  storeUrl: '',
  mediaId: null,
  priceCentavos: null,
  displayOrder: 0,
}

export default function ProductDialog({ storefront, product, onSaved, onCancel }) {
  const [values, setValues] = useState(product ? { ...EMPTY, ...product } : EMPTY)
  const [priceDigits, setPriceDigits] = useState(centavosToDigits(product?.priceCentavos))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)

  const priceDisplay = priceDigits ? formatCentavosBRL(Number(priceDigits)) : ''

  async function save(e) {
    e.preventDefault()
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const fileInput = e.target.elements.productImage
      const file = fileInput?.files?.[0]
      await saveWithImage({
        file,
        upload: (image) => uploadStorefrontImage(storefront.id, image),
        save: (uploaded) => saveStorefrontProduct(storefront, {
          ...values,
          priceCentavos: priceDigits || '',
          mediaId: uploaded || values.mediaId,
        }),
        isLinked: (id) => isStorefrontImageLinked(storefront.id, id, { product: true }),
        discard: discardStorefrontImage,
        previousMediaId: values.mediaId,
      })
    } catch (err) {
      setError(storefrontError(err))
      lock.current = false
      setBusy(false)
      return
    }
    lock.current = false
    setBusy(false)
    onSaved()
  }

  return (
    <Dialog title={product ? 'Editar produto' : 'Novo produto'} onClose={() => !busy && onCancel()} width="large">
      <Box as="form" onSubmit={save} sx={{ p: 3 }}>
        <FormControl sx={{ mb: 2 }}>
          <FormControl.Label>Imagem do produto</FormControl.Label>
          <input
            type="file"
            name="productImage"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            style={{ maxWidth: '100%' }}
          />
          <FormControl.Caption>
            {values.mediaId
              ? 'Enviar outra imagem substitui a atual.'
              : 'Rascunhos podem ficar sem imagem; publicar exige uma.'}
          </FormControl.Caption>
          {values.mediaId && <StorefrontImage id={values.mediaId} size={120} />}
        </FormControl>
        <FormControl required disabled={busy} sx={{ mb: 2 }}>
          <FormControl.Label>Nome</FormControl.Label>
          <TextInput
            block
            maxLength={120}
            value={values.name}
            onChange={(e) => setValues({ ...values, name: e.target.value })}
          />
        </FormControl>
        <FormControl disabled={busy} sx={{ mb: 2 }}>
          <FormControl.Label>Marca</FormControl.Label>
          <TextInput
            block
            maxLength={120}
            value={values.brand}
            onChange={(e) => setValues({ ...values, brand: e.target.value })}
          />
        </FormControl>
        <FormControl disabled={busy} sx={{ mb: 2 }}>
          <FormControl.Label>Categoria</FormControl.Label>
          <TextInput
            block
            maxLength={80}
            value={values.category}
            onChange={(e) => setValues({ ...values, category: e.target.value })}
          />
        </FormControl>
        <FormControl disabled={busy} sx={{ mb: 2 }}>
          <FormControl.Label>Preço (R$)</FormControl.Label>
          <TextInput
            block
            inputMode="numeric"
            placeholder="R$ 0,00"
            value={priceDisplay}
            onChange={(e) => setPriceDigits(e.target.value.replace(/\D/g, '').slice(0, 12))}
          />
          <FormControl.Caption>Opcional. Deixe em branco se ainda não tiver preço.</FormControl.Caption>
        </FormControl>
        <FormControl disabled={busy} sx={{ mb: 2 }}>
          <FormControl.Label>Descrição</FormControl.Label>
          <Textarea
            block
            maxLength={500}
            value={values.description}
            onChange={(e) => setValues({ ...values, description: e.target.value })}
          />
        </FormControl>
        <FormControl disabled={busy} sx={{ mb: 2 }}>
          <FormControl.Label>Link da loja</FormControl.Label>
          <TextInput
            block
            type="url"
            maxLength={500}
            placeholder="https://sua-loja.com.br/produto"
            value={values.storeUrl}
            onChange={(e) => setValues({ ...values, storeUrl: e.target.value })}
          />
        </FormControl>
        {error && (
          <Flash variant="danger" sx={{ my: 2 }}>
            {error}
          </Flash>
        )}
        <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
          <Button disabled={busy} onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !values.name.trim()}>
            {busy ? 'Salvando…' : 'Salvar produto'}
          </Button>
        </Box>
        <Text as="p" sx={{ fontSize: 0, color: 'fg.muted', mt: 2 }}>
          Salvar um produto não publica a vitrine. Envie para aprovação quando estiver tudo pronto.
        </Text>
      </Box>
    </Dialog>
  )
}
