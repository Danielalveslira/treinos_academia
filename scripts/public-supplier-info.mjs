import { primerBox, primerHeading, primerLink, primerText } from './public-primer.mjs'

// Identificação do fornecedor (Decreto nº 7.962/2013, art. 2º) e do controlador de dados
// (LGPD, Lei nº 13.709/2018). O nome civil, o CPF e o endereço físico NÃO ficam no código:
// são lidos de variáveis de ambiente configuradas na hospedagem (Vercel) e, enquanto não
// definidas, a página mostra "Em configuração" para esses três campos -- nunca um valor
// inventado. Configurar em produção: SUPPLIER_LEGAL_NAME, SUPPLIER_CPF, SUPPLIER_ADDRESS.
const CONTACT_EMAIL = 'dnllira1@gmail.com'

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  )

const trimmedOrNull = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const field = (label, valueHtml) =>
  `<div class="supplier-field"><dt>${label}</dt><dd>${valueHtml}</dd></div>`

const pendingField = (label) =>
  field(label, '<span class="supplier-pending">Em configuração</span>')

export function buildSupplierInfoBody(env = process.env) {
  const legalName = trimmedOrNull(env.SUPPLIER_LEGAL_NAME)
  const cpf = trimmedOrNull(env.SUPPLIER_CPF)
  const address = trimmedOrNull(env.SUPPLIER_ADDRESS)

  const identityFields = [
    field('Nome comercial', 'Evolutus'),
    field('Natureza', 'Pessoa física (sem CNPJ)'),
    legalName ? field('Nome civil do responsável', escape(legalName)) : pendingField('Nome civil do responsável'),
    cpf ? field('CPF', escape(cpf)) : pendingField('CPF'),
    address ? field('Endereço', escape(address)) : pendingField('Endereço'),
    field(
      'E-mail de contato',
      `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`
    ),
  ].join('')

  return `<div class="supplier-page">
    ${primerBox(
      'section',
      'supplier-section',
      `${primerHeading('h1', '', 'Informações do fornecedor')}${primerText(
        'p',
        '',
        'Identificação do fornecedor responsável pelo Evolutus, conforme o Decreto nº 7.962/2013 (comércio eletrônico) e a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).'
      )}`
    )}
    ${primerBox(
      'section',
      'supplier-section',
      `${primerHeading('h2', '', 'Identificação')}<dl class="supplier-fields">${identityFields}</dl>`
    )}
    ${primerBox(
      'section',
      'supplier-section',
      `${primerHeading('h2', '', 'Pagamentos')}${primerText(
        'p',
        '',
        'Quando a contratação de serviços pagos estiver disponível, os pagamentos no Evolutus serão processados por InfinitePay, instituição de pagamento responsável pelo processamento das transações financeiras em nome do fornecedor, conforme disponibilidade e condições de contratação.'
      )}`
    )}
    ${primerBox(
      'section',
      'supplier-section',
      `${primerHeading('h2', '', 'Controlador de dados')}<p>O responsável identificado acima é também o controlador dos dados pessoais tratados pelo Evolutus, para os fins da Lei Geral de Proteção de Dados. Para exercer direitos sobre seus dados pessoais, consulte a ${primerLink('/politica-de-privacidade', 'Política de Privacidade')}.</p>`
    )}
  </div>`
}

export const supplierInfoBody = buildSupplierInfoBody()
