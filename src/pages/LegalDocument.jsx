import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Button, Flash } from '@primer/react'
import { ShieldLockIcon, ReportIcon } from '@primer/octicons-react'
import { PublicLayout } from '../components/PublicLayout'
import { LEGAL_DOCUMENTS, LEGAL_MANIFEST } from '../utils/legal'

export default function LegalDocument({ documentId }) {
  const document = LEGAL_DOCUMENTS.find((item) => item.id === documentId)
  const { hash } = useLocation()
  useEffect(() => {
    const previousTitle = window.document.title
    window.document.title = `${document.title} · Treinos`
    if (hash) {
      const section = window.document.getElementById(hash.slice(1))
      section?.scrollIntoView()
      section?.focus({ preventScroll: true })
    } else window.scrollTo(0, 0)
    return () => {
      window.document.title = previousTitle
    }
  }, [document.title, hash])

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
            Versão {LEGAL_MANIFEST.version} ·{' '}
            <time dateTime={LEGAL_MANIFEST.date}>
              {LEGAL_MANIFEST.date.split('-').reverse().join('/')}
            </time>
          </p>
          {!LEGAL_MANIFEST.published && (
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
                {LEGAL_MANIFEST.controllerName
                  ? `Responsável: ${LEGAL_MANIFEST.controllerName}.`
                  : 'Identificação do responsável pendente na minuta.'}
              </p>
              {LEGAL_MANIFEST.contactEmail ? (
                <p>
                  E-mail:{' '}
                  <a href={`mailto:${LEGAL_MANIFEST.contactEmail}`}>
                    {LEGAL_MANIFEST.contactEmail}
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
                {LEGAL_DOCUMENTS.filter((item) => item.id !== documentId).map((item) => (
                  <li key={item.id}>
                    <Link to={item.path}>{item.title}</Link>
                  </li>
                ))}
              </ul>
            </section>
            <section id="historico" tabIndex={-1} aria-labelledby="historico-title">
              <h2 id="historico-title">Histórico e referências</h2>
              <p>
                {LEGAL_MANIFEST.date.split('-').reverse().join('/')} · Versão{' '}
                {LEGAL_MANIFEST.version}
              </p>
              <ul>
                {LEGAL_MANIFEST.changes.map((change) => (
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
