import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { Button, Flash } from '@primer/react'
import { ShieldLockIcon, ReportIcon } from '@primer/octicons-react'
import { PublicLayout } from '../components/PublicLayout'
import { selectLegalDocument } from '../utils/legal'
import { getActiveLegalBundle } from '../services/legalService'
import { SHOWCASE_LEGAL_DOCUMENT, SHOWCASE_LEGAL_MANIFEST } from '../utils/showcaseLegal'

export default function LegalDocument({ documentId }) {
  const showcase = documentId === SHOWCASE_LEGAL_DOCUMENT.id
  const [bundle, setBundle] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [searchParams] = useSearchParams()
  const requestedVersion = searchParams.get('version') || ''
  const { hash } = useLocation()
  useEffect(() => {
    let active = true
    getActiveLegalBundle()
      .then((activeBundle) => active && setBundle(activeBundle))
      .catch(() => active && setLoadError(true))
    return () => {
      active = false
    }
  }, [])

  const document = showcase
    ? SHOWCASE_LEGAL_DOCUMENT
    : selectLegalDocument(bundle, documentId, requestedVersion)
  const documentManifest = showcase ? SHOWCASE_LEGAL_MANIFEST : bundle?.manifest
  const relatedDocuments = showcase
    ? bundle?.documents || []
    : (bundle?.documents || []).filter((item) => item.id !== documentId)
  const staleTab = Boolean(
    !showcase && bundle && requestedVersion && requestedVersion !== bundle.manifest.version
  )
  const documentTitle = document?.title
  useEffect(() => {
    if (!documentTitle) return undefined
    const previousTitle = window.document.title
    window.document.title = `${documentTitle} · Treinos`
    if (hash) {
      const section = window.document.getElementById(hash.slice(1))
      section?.scrollIntoView()
      section?.focus({ preventScroll: true })
    } else window.scrollTo(0, 0)
    return () => {
      window.document.title = previousTitle
    }
  }, [documentTitle, hash])

  if (loadError) {
    return (
      <PublicLayout>
        <section className="support-page" role="alert">
          <h1>Documento indisponível</h1>
          <p>Não foi possível confirmar a versão ativa. Verifique sua conexão e recarregue.</p>
          <Button onClick={() => window.location.reload()}>Recarregar</Button>
        </section>
      </PublicLayout>
    )
  }
  if (!bundle) {
    return <PublicLayout><section className="support-page" aria-live="polite"><h1>Carregando documento</h1></section></PublicLayout>
  }
  if (staleTab) {
    return (
      <PublicLayout>
        <section className="support-page" role="alert">
          <h1>Esta página está desatualizada</h1>
          <p>
            O link abriu a versão {requestedVersion}, mas a versão ativa é {bundle.manifest.version}.
            Recarregue para consultar o conteúdo correto.
          </p>
          <Button onClick={() => window.location.reload()}>Recarregar</Button>
        </section>
      </PublicLayout>
    )
  }
  if (!document) {
    return <PublicLayout><section className="support-page"><h1>Documento não encontrado</h1></section></PublicLayout>
  }

  return (
    <PublicLayout>
      <div className="legal-page">
        <header className="legal-heading">
          <span className="public-eyebrow">
            <ShieldLockIcon /> CONFIANÇA E CONVIVÊNCIA
          </span>
          <h1>{document.title}</h1>
          <p>{document.description}</p>
          <p className="legal-meta">
            Versão {documentManifest.version} ·{' '}
            <time dateTime={documentManifest.date}>
              {documentManifest.date.split('-').reverse().join('/')}
            </time>
          </p>
          {!documentManifest.published && (
            <Flash variant="warning">
              Minuta para revisão jurídica. Estes documentos ainda não entraram em vigor.
            </Flash>
          )}
        </header>
        <div className="legal-layout">
          <aside className="legal-sidebar">
            <nav aria-label="Seções desta página">
              <h2>Nesta página</h2>
              <a href="#resumo">Resumo</a>
              {document.sections.map((section) => (
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
            {document.sections.map((section) => (
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
                {bundle.manifest.controllerName
                  ? `Responsável: ${bundle.manifest.controllerName}.`
                  : 'Identificação do responsável pendente na minuta.'}
              </p>
              {bundle.manifest.contactEmail ? (
                <p>
                  E-mail:{' '}
                  <a href={`mailto:${bundle.manifest.contactEmail}`}>
                    {bundle.manifest.contactEmail}
                  </a>
                  .
                </p>
              ) : (
                <p>O e-mail de contato será informado antes da entrada em vigor.</p>
              )}
              <p>
                Para denúncias, recursos, cancelamentos e pedidos de privacidade, acesse o{' '}
                <Link to="/atendimento">atendimento</Link>.
              </p>
              <ul>
                {relatedDocuments.map((item) => (
                  <li key={item.id}>
                    <Link to={`${item.path}?version=${bundle.manifest.version}`}>{item.title}</Link>
                  </li>
                ))}
              </ul>
            </section>
            <section id="historico" tabIndex={-1} aria-labelledby="historico-title">
              <h2 id="historico-title">Histórico e referências</h2>
              <p>
                {documentManifest.date.split('-').reverse().join('/')} · Versão{' '}
                {documentManifest.version}
              </p>
              <ul>
                {documentManifest.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
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
