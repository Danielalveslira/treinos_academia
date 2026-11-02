import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  BookIcon,
  ChecklistIcon,
  GraphIcon,
  LocationIcon,
  PeopleIcon,
  PackageIcon,
  PulseIcon,
} from '@primer/octicons-react'
import {
  primerBox,
  primerHeading,
  primerLabel,
  primerLink,
  primerPrimaryLink,
  primerText,
} from './public-primer.mjs'

const icon = (Icon, size = 20) =>
  renderToStaticMarkup(React.createElement(Icon, { size, 'aria-hidden': true }))

const sampleLabel = '<span class="how-sample-label">Exemplo ilustrativo</span>'

const sheetVisual = `<div class="how-sheet-visual" aria-hidden="true"><div class="how-visual-top"><span class="how-visual-symbol">${icon(ChecklistIcon, 18)}</span><span>FICHA DE TREINO</span></div><strong>Treino A · Peito e tríceps</strong><div class="how-sheet-row"><span>01</span><b>Supino reto com barra</b><small>3 séries</small></div><div class="how-sheet-row"><span>02</span><b>Crucifixo na máquina</b><small>3 séries</small></div><div class="how-sheet-row"><span>03</span><b>Tríceps na polia</b><small>3 séries</small></div></div>`

const setVisual = `<div class="how-set-visual" aria-hidden="true"><div class="how-set-title"><strong>Série 1 de 3</strong><span>Supino reto</span></div><p>Última sessão: <strong>60 kg × 10</strong></p><div class="how-set-fields"><div><small>Carga</small><strong>60 <span>kg</span></strong></div><div><small>Repetições</small><strong>10</strong></div></div><span class="how-set-complete">${icon(ChecklistIcon, 17)} Concluir série</span></div>`

const trendVisual = `<figure class="how-trend-visual"><div class="how-trend-top"><span>Volume registrado</span><strong>por sessão</strong></div><svg viewBox="0 0 300 110" preserveAspectRatio="none" aria-hidden="true"><path class="how-chart-grid" d="M0 87H300 M0 53H300 M0 19H300"/><path class="how-chart-line" d="M12 82 L82 70 L152 75 L222 49 L288 30"/><circle cx="12" cy="82" r="4"/><circle cx="82" cy="70" r="4"/><circle cx="152" cy="75" r="4"/><circle cx="222" cy="49" r="4"/><circle cx="288" cy="30" r="4"/></svg><div class="how-trend-days"><span>1ª sessão</span><span>5ª sessão</span></div><figcaption>Exemplo ilustrativo de registros, sem previsão de resultados.</figcaption></figure>`

const flow = `<div class="how-flow" role="img" aria-label="Fluxo do aplicativo: ficha planejada, série registrada e histórico de treino"><span>${icon(ChecklistIcon, 19)} Ficha planejada</span><span class="how-flow-arrow" aria-hidden="true">→</span><span>${icon(PulseIcon, 19)} Série registrada</span><span class="how-flow-arrow" aria-hidden="true">→</span><span>${icon(GraphIcon, 19)} Histórico</span></div>`

const step = (number, title, description, visual, className) =>
  primerBox(
    'li',
    `how-step ${className}`,
    `<div class="how-step-heading"><span class="how-step-number">${number}</span>${primerHeading('h3', '', title)}</div>${visual}${primerText('p', '', description)}`
  )

const possibility = (Icon, title, description) =>
  primerBox(
    'li',
    'how-possibility',
    `<span class="how-possibility-icon">${icon(Icon, 20)}</span><span><strong>${title}</strong><small>${description}</small></span>`
  )

export const howItWorksBody = `<div class="how-page">
  ${primerBox('section', 'how-hero', `<div class="how-hero-copy">${primerLabel('Como funciona', 'how-eyebrow')}${primerHeading('h1', '', 'Seu treino organizado. Sua evolução visível.')}${primerText('p', 'how-lead', 'Organize seus treinos, registre cada série e acompanhe sua evolução com clareza.')}<div class="how-hero-actions">${primerPrimaryLink('/demo', 'Experimentar sem cadastro', 'how-primary-link how-try-link')}${primerLink('/cadastro', 'Criar conta', 'how-secondary-link')}</div><p class="how-trust">Demonstração com dados fictícios, sem cadastro.</p></div><div class="how-hero-visual">${flow}<div class="how-hero-visual-grid">${sheetVisual}<div class="how-hero-register">${setVisual}</div></div></div>`)}

  ${primerBox('section', 'how-section how-steps-section', `${primerHeading('h2', '', 'Entenda em três passos')}${primerText('p', 'how-section-lead', 'Da ficha ao histórico, cada registro fica no seu lugar.')}<ol class="how-steps">${step('01', 'Organize seus treinos', 'Monte fichas com os exercícios e as séries da sua rotina.', sheetVisual, 'how-step-sheet')}${step('02', 'Registre cada série', 'Anote carga e repetições com a referência da última sessão à mão.', setVisual, 'how-step-set')}${step('03', 'Acompanhe sua evolução', 'Consulte sessões e indicadores gerados pelos seus próprios registros.', trendVisual, 'how-step-trend')}</ol>`)}

  ${primerBox('section', 'how-section how-demo-section', `<div class="how-demo-copy">${primerLabel('Experimente na prática', 'how-eyebrow')}${primerHeading('h2', '', 'Não precisa imaginar. Experimente.')}${primerText('p', '', 'Registre uma série, consulte a carga anterior e descubra como acompanhar seus treinos.')}<div class="how-demo-actions">${primerPrimaryLink('/demo', 'Experimentar registro de treino', 'how-primary-link how-try-link')}<small>Dados fictícios · sem cadastro · nada é salvo</small></div></div><div class="how-demo-preview" aria-label="Prévia ilustrativa do registro de série disponível na demonstração"><div class="how-demo-preview-top"><span>${icon(PulseIcon, 18)} FICHA DE EXEMPLO</span><strong>Treino A — Peito e Tríceps</strong></div><div class="how-demo-progress"><span>0 de 12 séries concluídas</span><span>0%</span></div><div class="how-demo-bar" aria-hidden="true"></div>${setVisual}</div>`)}

  ${primerBox('section', 'how-section how-insights-section', `<div class="how-insights-copy">${primerHeading('h2', '', 'Seus registros organizados para você acompanhar seu progresso.')}${primerText('p', '', 'Consulte sessões anteriores e veja indicadores calculados a partir do que você registrou.')}<p class="how-note">Os dados ao lado são apenas exemplos.</p></div><div class="how-insights-visual" aria-label="Exemplo ilustrativo de histórico e indicadores de treino">${sampleLabel}<div class="how-metric-row"><div><small>Treinos registrados</small><strong>5</strong></div><div><small>Séries concluídas</small><strong>15</strong></div><div><small>Volume total</small><strong>4.500 kg</strong></div></div><div class="how-history-row"><span>Histórico de sessões</span><strong>Supino reto · 60 kg × 10</strong><small>Registro de exemplo</small></div></div>`)}

  ${primerBox('section', 'how-section how-more-section', `${primerHeading('h2', '', 'Conheça mais possibilidades')}${primerText('p', 'how-section-lead', 'Além dos treinos, encontre recursos para explorar e participar.')}<ul class="how-possibilities">${possibility(BookIcon, 'Catálogo de exercícios', 'Consulte exercícios e instruções disponíveis.')}${possibility(PeopleIcon, 'Comunidades', 'Participe de conversas sobre interesses em comum.')}${possibility(LocationIcon, 'Profissionais e espaços', 'Explore perfis publicados no diretório.')}${possibility(PackageIcon, 'Vitrines', 'Conheça produtos de marcas aprovadas.')}${possibility(GraphIcon, 'EvoCoins e EvoCash', 'Consulte saldos e entenda as ações disponíveis no app.')}</ul><p class="how-more-link">${primerLink('/para-empresas', 'Saiba mais sobre possibilidades para empresas')}</p>`)}

  ${primerBox('section', 'how-final', `<div>${primerHeading('h2', '', 'Seu próximo treino pode ser mais organizado.')}${primerText('p', '', 'Crie sua conta e comece a registrar sua evolução.')}</div>${primerPrimaryLink('/cadastro', 'Criar minha conta', 'how-primary-link how-signup-link')}`)}
</div>`
