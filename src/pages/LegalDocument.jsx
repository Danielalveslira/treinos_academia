import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { Button, Flash } from '@primer/react'
import { ShieldLockIcon, ReportIcon } from '@primer/octicons-react'
import { PublicLayout } from '../components/PublicLayout'
import { loadLegalDocumentView } from '../services/legalService'
import { COMMERCIAL_DOCUMENTS, commercialDocumentLink } from '../utils/commercialTerms'

const GENERAL_IDS = ['terms', 'privacy', 'community']
const COMMERCIAL_IDS = Object.keys(COMMERCIAL_DOCUMENTS)

function brDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10).split('-').reverse().join('/')
    : ''
}

function documentPath(documentId, fallbackPath) {
  return COMMERCIAL_DOCUMENTS[documentId]?.path || fallbackPath || '/'
}

function StatusPage({ title, children, role }) {
  return (
    <PublicLayout>
      <section className="support-page" role={role} aria-live={role ? undefined : 'polite'}>
        <h1>{title}</h1>
        {children}
      </section>
    </PublicLayout>
  )
}

export default function LegalDocument({ documentId }) {
  const [view, setView] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [searchParams] = useSearchParams()
  const requestedVersion = searchParams.get('version') || ''
  const { hash } = useLocation()

  useEffect(() => {
    let active = true
    setView(null)
    setLoadError(false)
    loadLegalDocumentView(documentId, requestedVersion, {
      generalIds: GENERAL_IDS,
      commercialIds: COMMERCIAL_IDS,
    })
      .then((result) => active && setView(result))
      .catch(() => active && setLoadError(true))
    return () => {
      active = false
    }
  }, [documentId, requestedVersion])

  const document = view?.status === 'ok' ? view.document : null
  const documentTitle = document?.title
  useEffect(() => {
    if (!documentTitle) return undefined
    const previousTitle = window.document.title
    window.document.title = `${documentTitle} · Evolutus`
    if (hash) {
      const section = window.document.getElementById(hash.slice(1))
      section?.scrollIntoView()
      section?.focus({ preventScroll: true })
    } else window.scrollTo(0, 0)
    return () => {
      window.document.title = previousTitle
    }
  }, [documentTitle, hash])

  const currentPath = documentPath(documentId, document?.path)

  if (loadError) {
    return (
      <StatusPage title="Documento indisponível" role="alert">
        <p>Não foi possível carregar o documento. Verifique sua conexão e tente novamente.</p>
        <Button onClick={() => window.location.reload()}>Recarregar</Button>
      </StatusPage>
    )
  }
  if (!view) {
    return <StatusPage title="Carregando documento" />
  }
  if (view.status === 'not-published') {
    return (
      <StatusPage title="Documento ainda não está em vigor">
        <p>
          Este documento ainda não foi publicado. Enquanto isso, a contratação correspondente
          permanece indisponível. Dúvidas? Use o <Link to="/atendimento">atendimento</Link>.
        </p>
      </StatusPage>
    )
  }
  if (view.status === 'version-not-found') {
    return (
      <StatusPage title="Versão não encontrada">
        <p>
          A versão {requestedVersion} não existe ou nunca foi publicada.
          {view.currentVersion && ' A versão vigente continua disponível.'}
        </p>
        {view.currentVersion && (
          <Button as={Link} to={currentPath}>
            Ler a versão vigente
          </Button>
        )}
      </StatusPage>
    )
  }
  if (!document) {
    return <StatusPage title="Documento não encontrado" />
  }

  const manifest = view.manifest
  const historical = Boolean(view.currentVersion && manifest.version !== view.currentVersion)
  const contact = view.contact || {}
  const related = view.related || []

  return (
    <PublicLayout>
      <div className="legal-page">
        <header className="legal-heading">
          <span className="public-eyebrow">
            <ShieldLockIcon /> CONFIANÇA E CONVIVÊNCIA
          </span>
          <h1>{document.title}</h1>
          {document.description && <p>{document.description}</p>}
          <p className="legal-meta">
            Versão {manifest.version}
            {brDate(manifest.date) && (
              <>
                {' · '}
                <time dateTime={manifest.date}>{brDate(manifest.date)}</time>
              </>
            )}
          </p>
          {historical && (
            <Flash variant="attention" className="legal-history-notice" role="status">
              Você está lendo a versão {manifest.version}, mantida para consulta. A versão vigente é
              a {view.currentVersion}. <Link to={currentPath}>Ler a versão vigente</Link>
            </Flash>
          )}
        </header>
        <div className="legal-layout">
          <aside className="legal-sidebar">
            <nav aria-label="Seções desta página">
              <h2>Nesta página</h2>
              {document.summary?.length > 0 && <a href="#resumo">Resumo</a>}
              {(document.sections || []).map((section) => (
                <a key={section.id} href={`#${section.id}`}>
                  {section.title}
                </a>
              ))}
              <a href="#contato">Contato</a>
              <a href="#historico">Histórico e referências</a>
            </nav>
            <Button as={Link} to="/atendimento?tipo=report" leadingVisual={ReportIcon}>
              Denunciar violação
            </Button>
          </aside>
          <article className="legal-content">
            {document.summary?.length > 0 && (
              <section
                id="resumo"
                tabIndex={-1}
                className="legal-summary"
                aria-labelledby="resumo-title"
              >
                <h2 id="resumo-title">O essencial</h2>
                <ul>
                  {document.summary.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            )}
            {(document.sections || []).map((section) => (
              <section
                key={section.id}
                id={section.id}
                tabIndex={-1}
                aria-labelledby={`${section.id}-title`}
              >
                <h2 id={`${section.id}-title`}>{section.title}</h2>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.items && (
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
                {section.table && (
                  <div
                    className="legal-table-scroll"
                    role="region"
                    aria-label={section.title}
                    tabIndex={0}
                  >
                    <table>
                      <caption className="sr-only">{section.title}</caption>
                      <thead>
                        <tr>
                          {section.table.headers.map((header) => (
                            <th key={header} scope="col">
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {section.table.rows.map((row) => (
                          <tr key={row.cells[0]}>
                            {row.cells.map((cell, index) =>
                              index === 0 ? (
                                <th key={index} scope="row">
                                  {cell}
                                </th>
                              ) : (
                                <td key={index}>{cell}</td>
                              )
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ))}
            <section id="contato" tabIndex={-1} aria-labelledby="contato-title">
              <h2 id="contato-title">Contato e documentos relacionados</h2>
              <p>
                {contact.controllerName
                  ? `Responsável: ${contact.controllerName}.`
                  : 'A identificação do responsável consta da Política de Privacidade vigente.'}
              </p>
              {contact.contactEmail && (
                <p>
                  E-mail: <span className="legal-contact-email">{contact.contactEmail}</span> (
                  <a href={`mailto:${contact.contactEmail}`}>escrever</a>).
                </p>
              )}
              <p>
                Para denúncias, recursos, cancelamentos, reembolsos e pedidos de privacidade, acesse
                o <Link to="/atendimento">atendimento</Link>.
              </p>
              <p>
                Identificação completa do fornecedor e do controlador de dados:{' '}
                <a href="/informacoes-do-fornecedor">Informações do fornecedor</a>.
              </p>
              <ul>
                {related.map((item) => (
                  <li key={item.id}>
                    <Link to={item.path}>{item.title}</Link>
                  </li>
                ))}
                {COMMERCIAL_IDS.filter((id) => id !== documentId).map((id) => (
                  <li key={id}>
                    <Link to={commercialDocumentLink(id)}>{COMMERCIAL_DOCUMENTS[id].label}</Link>
                  </li>
                ))}
              </ul>
            </section>
            <section id="historico" tabIndex={-1} aria-labelledby="historico-title">
              <h2 id="historico-title">Histórico e referências</h2>
              <p>
                {brDate(manifest.date) && `${brDate(manifest.date)} · `}Versão {manifest.version}
              </p>
              {manifest.changes?.length > 0 && (
                <ul>
                  {manifest.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              )}
              <p>
                Versões anteriores continuam disponíveis para consulta pelo endereço deste documento
                com <code>?version=</code> seguido do número da versão.
              </p>
              {document.sources?.length > 0 && (
                <>
                  <p>Referências para consulta:</p>
                  <ul>
                    {document.sources.map((source) => (
                      <li key={source.href}>
                        <a href={source.href} target="_blank" rel="noopener noreferrer">
                          {source.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <Button type="button" onClick={() => window.print()}>
                Imprimir ou salvar em PDF
              </Button>
            </section>
          </article>
        </div>
      </div>
    </PublicLayout>
  )
}
