import { useRef, useState } from 'react'
import { Box, Button, Dialog, Flash, FormControl, Text, TextInput, Textarea } from '@primer/react'
import {
  createStorefront,
  saveStorefront,
  uploadStorefrontImage,
  discardStorefrontImage,
  isStorefrontImageLinked,
} from '../../services/storefrontService'
import { saveWithImage } from '../../utils/storefrontImageSave'
import { storefrontError } from '../../utils/storefront'
import StorefrontImage from '../StorefrontImage'

export default function StorefrontDialog({ storefront, onSaved, onCancel }) {
  const [values, setValues] = useState(
    storefront
      ? { name: storefront.name, description: storefront.description, contact: storefront.contact, logoMediaId: storefront.logoMediaId }
      : { name: '', description: '', contact: '', logoMediaId: null }
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const requestId = useRef(crypto.randomUUID())

  async function save(e) {
    e.preventDefault()
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (!storefront) {
        await createStorefront(values.name, requestId.current)
      } else {
        const fileInput = e.target.elements.storefrontLogo
        const file = fileInput?.files?.[0]
        await saveWithImage({
          file,
          upload: (image) => uploadStorefrontImage(storefront.id, image),
          save: (uploaded) => saveStorefront(storefront, { ...values, logoMediaId: uploaded || values.logoMediaId }),
          isLinked: (id) => isStorefrontImageLinked(storefront.id, id),
          discard: discardStorefrontImage,
          previousMediaId: values.logoMediaId,
        })
      }
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
    <Dialog
      title={storefront ? 'Editar vitrine' : 'Criar vitrine'}
      onClose={() => !busy && onCancel()}
      width="large"
    >
      <Box as="form" onSubmit={save} sx={{ p: 3 }}>
        <FormControl required disabled={busy} sx={{ mb: 2 }}>
          <FormControl.Label>Nome da vitrine</FormControl.Label>
          <TextInput
            block
            maxLength={120}
            value={values.name}
            onChange={(e) => setValues({ ...values, name: e.target.value })}
          />
        </FormControl>
        {storefront && (
          <>
            <FormControl disabled={busy} sx={{ mb: 2 }}>
              <FormControl.Label>Descrição</FormControl.Label>
              <Textarea
                block
                maxLength={1000}
                value={values.description}
                onChange={(e) => setValues({ ...values, description: e.target.value })}
              />
            </FormControl>
            <FormControl disabled={busy} sx={{ mb: 2 }}>
              <FormControl.Label>Contato público</FormControl.Label>
              <TextInput
                block
                maxLength={300}
                value={values.contact}
                onChange={(e) => setValues({ ...values, contact: e.target.value })}
              />
            </FormControl>
            <FormControl disabled={busy} sx={{ mb: 2 }}>
              <FormControl.Label>Logotipo (opcional)</FormControl.Label>
              <input
                type="file"
                name="storefrontLogo"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                style={{ maxWidth: '100%' }}
              />
              {values.logoMediaId && <StorefrontImage id={values.logoMediaId} size={120} />}
            </FormControl>
          </>
        )}
        {!storefront && (
          <Text as="p" sx={{ fontSize: 0, color: 'fg.muted' }}>
            Depois de criar, você edita descrição, contato, logotipo e adiciona produtos.
          </Text>
        )}
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
            {busy ? 'Salvando…' : 'Salvar'}
          </Button>
        </Box>
      </Box>
    </Dialog>
  )
}
