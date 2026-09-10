import { ActionMenu, ActionList, IconButton } from '@primer/react'
import { ShareIcon } from '@primer/octicons-react'
import { canShareNatively, shareNatively, shareToWhatsApp, shareToInstagram } from '../utils/share'
import { getCachedPhotoUrl } from '../utils/photoBlobCache'

// A foto só entra no compartilhamento nativo se já estiver carregada na tela (o
// usuário está vendo o post que vai compartilhar) — nunca dispara um novo download
// só para anexar o arquivo. Sem isso, cai de volta para compartilhar só o link.
async function photoFileIfLoaded(status) {
  if (status.type !== 'photo') return null
  const cachedUrl = getCachedPhotoUrl(status.photoPath)
  if (!cachedUrl) return null
  try {
    const blob = await fetch(cachedUrl).then((response) => response.blob())
    return new File([blob], 'foto.webp', { type: 'image/webp' })
  } catch {
    return null
  }
}

export function ShareMenu({ status, showToast }) {
  async function handleNativeShare() {
    try {
      await shareNatively(status.communityId, await photoFileIfLoaded(status))
    } catch (error) {
      if (error?.name !== 'AbortError') showToast?.('Não foi possível compartilhar.', 'danger')
    }
  }

  async function handleInstagram() {
    const { copied, text } = await shareToInstagram(status.communityId)
    showToast?.(
      copied ? 'Texto copiado! Cole no Instagram.' : `Copie e cole no Instagram: ${text}`,
      copied ? 'success' : 'attention'
    )
  }

  const button = (onClick) => (
    <IconButton
      icon={ShareIcon}
      variant="invisible"
      size="small"
      aria-label="Compartilhar publicação"
      onClick={onClick}
      sx={{ color: 'fg.muted' }}
    />
  )

  if (canShareNatively()) return button(handleNativeShare)

  return (
    <ActionMenu>
      <ActionMenu.Anchor>{button()}</ActionMenu.Anchor>
      <ActionMenu.Overlay align="end">
        <ActionList>
          <ActionList.Item onSelect={() => shareToWhatsApp(status.communityId)}>
            WhatsApp
          </ActionList.Item>
          <ActionList.Item onSelect={handleInstagram}>Instagram</ActionList.Item>
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  )
}
