import { useEffect, useRef, useState } from 'react'
import { Button, useConfirm } from '@primer/react'
import { DownloadIcon, XIcon } from '@primer/octicons-react'

export function PwaControls() {
  const confirm = useConfirm()
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installed, setInstalled] = useState(
    () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  )
  const [help, setHelp] = useState(false)
  const [offline, setOffline] = useState(!navigator.onLine)
  const [waiting, setWaiting] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [updating, setUpdating] = useState(false)
  const dialog = useRef(null)
  const offlinePanel = useRef(null)
  const shouldReload = useRef(false)
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

  useEffect(() => {
    const prompt = (event) => {
      event.preventDefault()
      setInstallPrompt(event)
    }
    const installedHandler = () => {
      setInstalled(true)
      setInstallPrompt(null)
      setHelp(false)
    }
    const online = () => setOffline(false)
    const offlineHandler = () => setOffline(true)
    const display = window.matchMedia('(display-mode: standalone)')
    const displayHandler = () => setInstalled(display.matches || navigator.standalone === true)
    window.addEventListener('beforeinstallprompt', prompt)
    window.addEventListener('appinstalled', installedHandler)
    window.addEventListener('online', online)
    window.addEventListener('offline', offlineHandler)
    display.addEventListener('change', displayHandler)
    return () => {
      window.removeEventListener('beforeinstallprompt', prompt)
      window.removeEventListener('appinstalled', installedHandler)
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offlineHandler)
      display.removeEventListener('change', displayHandler)
    }
  }, [])

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
    let active = true
    let registration
    const checkWaiting = () => {
      if (active && registration?.waiting) {
        setWaiting(registration.waiting)
        setDismissed(false)
      }
    }
    const updateFound = () => {
      const worker = registration.installing
      worker?.addEventListener('statechange', checkWaiting)
    }
    const changed = () => {
      if (shouldReload.current) window.location.reload()
    }
    const checkUpdate = () => {
      if (navigator.onLine) registration?.update().catch(() => {})
    }
    navigator.serviceWorker.addEventListener('controllerchange', changed)
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((result) => {
        if (!active) return
        registration = result
        checkWaiting()
        registration.addEventListener('updatefound', updateFound)
      })
      .catch((error) => console.error('[PWA] Registro indisponível:', error))
    window.addEventListener('focus', checkUpdate)
    return () => {
      active = false
      registration?.removeEventListener('updatefound', updateFound)
      navigator.serviceWorker.removeEventListener('controllerchange', changed)
      window.removeEventListener('focus', checkUpdate)
    }
  }, [])

  useEffect(() => {
    if (help) dialog.current?.showModal()
    else dialog.current?.close()
  }, [help])

  useEffect(() => {
    const content = document.getElementById('app-content')
    if (!offline || !content) return
    const previousFocus = document.activeElement
    content.inert = true
    setHelp(false)
    offlinePanel.current?.focus()
    return () => {
      content.inert = false
      previousFocus?.focus()
    }
  }, [offline])

  async function install() {
    if (!installPrompt) {
      setHelp(true)
      return
    }
    setInstalling(true)
    try {
      await installPrompt.prompt()
      const { outcome } = await installPrompt.userChoice
      if (outcome === 'accepted') setInstalled(true)
    } catch {
      setHelp(true)
    } finally {
      setInstallPrompt(null)
      setInstalling(false)
    }
  }

  async function update() {
    const confirmed = await confirm({
      title: 'Atualizar o app agora?',
      content: 'Salve seus registros antes de continuar; a página será recarregada.',
      confirmButtonContent: 'Atualizar',
      cancelButtonContent: 'Cancelar',
    })
    if (!confirmed) return
    shouldReload.current = true
    setUpdating(true)
    waiting?.postMessage({ type: 'ACTIVATE_UPDATE' })
  }

  return (
    <>
      {!installed && !offline && (
        <div className="pwa-install">
          <Button leadingVisual={DownloadIcon} onClick={install} disabled={installing}>
            Instalar app
          </Button>
        </div>
      )}
      <dialog
        ref={dialog}
        className="pwa-dialog"
        aria-labelledby="install-title"
        onCancel={() => setHelp(false)}
        onClose={() => setHelp(false)}
      >
        <div className="pwa-dialog-heading">
          <h2 id="install-title">Leve o Treinos com você</h2>
          <Button variant="invisible" aria-label="Fechar instruções" onClick={() => setHelp(false)}>
            <XIcon />
          </Button>
        </div>
        <p>Tenha um ícone na tela inicial e abra seu diário como um aplicativo.</p>
        {ios ? (
          <ol>
            <li>Abra este site no Safari.</li>
            <li>
              Toque em <strong>Compartilhar</strong> e em{' '}
              <strong>Adicionar à Tela de Início</strong>.
            </li>
            <li>
              Ative <strong>Abrir como App</strong>, se disponível, e toque em{' '}
              <strong>Adicionar</strong>.
            </li>
          </ol>
        ) : (
          <p>
            Abra o menu do navegador e procure <strong>Instalar app</strong> ou{' '}
            <strong>Adicionar à tela inicial</strong>. Se a opção não aparecer, tente abrir este
            site no Chrome ou Edge. A disponibilidade depende do navegador.
          </p>
        )}
        <p className="pwa-muted">
          Você precisa de internet para consultar e registrar seus treinos.
        </p>
        <Button variant="primary" block onClick={() => setHelp(false)}>
          Entendi
        </Button>
      </dialog>
      {waiting && !offline && (
        <aside className="pwa-update" aria-label="Atualização do aplicativo" hidden={dismissed}>
          <span>Uma nova versão do Treinos está disponível.</span>
          <Button size="small" variant="primary" onClick={update} disabled={updating}>
            {updating ? 'Atualizando…' : 'Atualizar'}
          </Button>
          <Button size="small" onClick={() => setDismissed(true)}>
            Depois
          </Button>
        </aside>
      )}
      {offline && (
        <div className="pwa-offline" role="alert" ref={offlinePanel} tabIndex={-1}>
          <div>
            <img src="/icons/icon-192.png" width="64" height="64" alt="" />
            <h1>Você está sem conexão</h1>
            <p>Conecte-se à internet para consultar ou registrar seus treinos.</p>
            <p>Se houver um formulário aberto, ele continuará aqui quando a conexão voltar.</p>
            <Button onClick={() => setOffline(!navigator.onLine)}>Verificar conexão</Button>
          </div>
        </div>
      )}
    </>
  )
}
