import { existsSync, readdirSync } from 'node:fs'
import { primerBox, primerButton, primerExploreButton, primerFeatureIcon, primerHeading, primerInput, primerLabel, primerLink, primerNavigationList, primerSelect, primerStyles, primerText, primerTextarea } from './public-primer.mjs'
import { BRAZIL_STATES, CATEGORY_OPTIONS, LISTING_KIND_OPTIONS, MODALITY_OPTIONS, SERVICE_MODE_OPTIONS } from '../src/constants/professionalListingTaxonomy.js'

// Production currently redirects apex to www (measured 2026-10-19).
const origin = 'https://www.evolutus.com.br'

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  )
const link = primerLink
const discoveryLinks = [['/como-funciona', 'Como funciona'], ['/funcionalidades', 'Funcionalidades'], ['/guia-registro-treino', 'Guia de registro'], ['/para-empresas', 'Para empresas'], ['/vitrine', 'Vitrine'], ['/profissionais', 'Profissionais']]
const publicPaths = new Set(['/', ...discoveryLinks.map(([href]) => href)])
const enableTurboLinks = (html) => html.replace(/<a\b([^>]*\bhref="([^"]+)"[^>]*)>/g, (match, attributes, href) =>
  publicPaths.has(href) ? `<a${attributes} data-turbo="true">` : match)
const accountLinks = [['/login', 'Entrar'], ['/cadastro', 'Criar conta', true]]
const navLinks = discoveryLinks.map(([href, label]) => link(href, label)).join('')
const nav = `<header id="public-header" class="site-header" data-turbo-permanent data-turbo-prefetch="true"><div class="header-inner"><a class="brand" href="/" aria-label="Evolutus, página inicial"><img src="/icons/icon-192.png" width="38" height="38" alt=""><span>Evolutus</span></a><nav class="desktop-nav" aria-label="Principal">${navLinks}</nav><div class="header-actions"><a class="login-link" href="/login">Entrar</a>${link('/cadastro', 'Criar conta <span aria-hidden="true">↗</span>', 'button small')}</div><div class="mobile-menu">${primerExploreButton()}<nav id="public-menu-panel" class="public-menu-panel" aria-label="Navegação pública" hidden>${primerNavigationList([{ title: 'Descobrir', links: discoveryLinks }, { title: 'Conta', links: accountLinks }])}</nav></div></div></header>`
const footer = `<footer class="site-footer"><div class="footer-inner"><div><a class="brand" href="/"><img src="/icons/icon-192.png" width="34" height="34" alt=""><span>Evolutus</span></a><p>Planeje, registre e consulte seus treinos.</p></div><nav aria-label="Rodapé"><a href="/como-funciona">Como funciona</a><a href="/funcionalidades">Funcionalidades</a><a href="/guia-registro-treino">Guia de registro</a><a href="/para-empresas">Para empresas</a><a href="/vitrine">Vitrine</a><a href="/profissionais">Profissionais</a><a href="/termos-de-uso">Termos</a><a href="/politica-de-privacidade">Privacidade</a></nav></div><div class="footer-bottom"><span>© Evolutus</span></div></footer>`
const sectionHead = (eyebrow, title, description = '') =>
  `<div class="section-head"><p class="eyebrow">${eyebrow}</p>${primerHeading('h2', '', title)}${description ? primerText('p', '', description) : ''}</div>`
const valueCard = (number, title, body) =>
  primerBox('article', 'value-card', `${primerLabel(number, 'card-number')}${primerHeading('h3', '', title)}${primerText('p', '', body)}<span class="card-line" aria-hidden="true"></span>`)
const featureCard = (icon, title, body) =>
  primerBox('article', 'feature-card', `<span class="feature-icon" aria-hidden="true">${primerFeatureIcon(icon)}</span>${primerHeading('h3', '', title)}${primerText('p', '', body)}`)
const finalCta = (title, body) =>
  `<section class="section final-cta"><div><p class="eyebrow">COMECE AGORA</p>${primerHeading('h2', '', title)}${primerText('p', '', body)}</div><div class="cta-actions">${link('/cadastro', 'Criar conta <span aria-hidden="true">↗</span>', 'button')}</div></section>`
const filterOptions = (items, first = 'Todos') => [['', first], ...items.map(({ value, label }) => [value, label])]
const professionalTaxonomy = { category: CATEGORY_OPTIONS, modality: MODALITY_OPTIONS, serviceMode: SERVICE_MODE_OPTIONS, kind: LISTING_KIND_OPTIONS }
const professionalCardTemplate = `<template id="directory-card-template">${primerBox('article', 'directory-card', `<span class="directory-avatar" aria-hidden="true">•</span>${primerLabel('Profissional', 'directory-kind')}${primerHeading('h3', 'directory-name', 'Perfil publicado')}${primerText('p', 'directory-category', '')}${primerText('p', 'directory-location', '')}${primerText('p', 'directory-modalities', '')}${primerText('p', 'directory-service', '')}${link('/profissionais/00000000-0000-0000-0000-000000000000', 'Ver perfil ↗', 'button directory-card-link')}`)}</template>`
const productCardTemplate = `<template id="product-card-template">${primerBox('article', 'product-card', `<button class="product-image-button" type="button" aria-label="Ampliar imagem do produto"><span class="product-image product-placeholder">Imagem indisponível</span></button><div class="product-card-body"><p class="product-brand"></p><h3 class="product-name"></h3><p class="product-description"></p><div class="product-meta"><span class="product-category"></span><span class="product-sponsored" hidden>Patrocinado</span></div>${link('/', 'Ver na loja ↗', 'button product-link')}</div>`)}</template>`
const catalogFilters = `<form id="catalog-filters" class="catalog-filters" role="search" aria-label="Filtrar produtos"><div class="catalog-search-field"><label class="catalog-sr-only" for="catalog-search">Buscar produtos ou marcas</label><svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5"></circle><path d="m10.5 10.5 4 4"></path></svg><input id="catalog-search" name="busca" type="search" maxlength="80" autocomplete="off" placeholder="Buscar produtos ou marcas..."></div><div class="catalog-category"><label id="category-label" class="catalog-sr-only" for="category">Categoria</label><div class="category-field"><select id="category" name="categoria"><option value="">Todas as categorias</option></select><button id="category-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="category-options" aria-labelledby="category-label category-value" hidden><span id="category-value">Todas as categorias</span><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m3.5 6 4.5 4.5L12.5 6"></path></svg></button><div id="category-options" class="category-options" role="listbox" aria-labelledby="category-label" hidden></div></div></div><button id="catalog-clear" type="button" hidden>Limpar filtros</button></form>`
const bannerPicture = (name, alt, priority = false) => `<picture class="official-banner"><source srcset="/img/banners/${name}-960.webp 960w, /img/banners/${name}-1774.webp 1774w" sizes="(max-width: 760px) 100vw, (max-width: 1240px) 94vw, 1184px" type="image/webp"><img src="/img/banners/${name}-1774.webp" alt="${escape(alt)}" width="1774" height="887" loading="${priority ? 'eager' : 'lazy'}"${priority ? ' fetchpriority="high"' : ''} decoding="async"></picture>`

const commercialForm = `<form id="commercial-form" class="lead-form"><div class="form-heading"><span>01 / DADOS DA PROPOSTA</span>${primerHeading('h3', '', 'Conte sobre sua empresa')}<p>Campos com * são obrigatórios.</p></div><div class="form-grid">
  ${primerInput('company', 'Empresa', { required: true, maxLength: 120, autoComplete: 'organization', placeholder: 'Nome da empresa' })}
  ${primerInput('contact', 'Responsável', { required: true, maxLength: 120, autoComplete: 'name', placeholder: 'Seu nome' })}
  ${primerInput('email', 'E-mail', { type: 'email', required: true, maxLength: 254, autoComplete: 'email', placeholder: 'voce@empresa.com' })}
  ${primerInput('whatsapp', 'WhatsApp (opcional)', { type: 'tel', maxLength: 30, autoComplete: 'tel', placeholder: '(00) 00000-0000' })}
  ${primerInput('segment', 'Segmento', { required: true, maxLength: 80, placeholder: 'Ex.: suplementos, vestuário' })}
  ${primerInput('website', 'Site ou rede social', { type: 'url', required: true, maxLength: 500, placeholder: 'https://' })}
  </div>${primerSelect('modality', 'Formato de interesse', [['', 'Selecione um formato'], ['Publicidade', 'Publicidade'], ['Vitrine de produtos', 'Vitrine de produtos'], ['Ambos', 'Ambos']], { required: true })}
  ${primerTextarea('message', 'Conte sobre a proposta', { required: true, minLength: 20, maxLength: 2000, rows: 5, placeholder: 'Descreva seu produto, serviço ou ideia de parceria.' })}
  <label class="consent"><input name="privacy" type="checkbox" required><span>Li a ${link('/politica-de-privacidade', 'política de privacidade')} e concordo com o uso dos dados para resposta comercial.</span></label>
  <label class="trap" aria-hidden="true">Não preencha este campo<input name="website_confirmation" tabindex="-1" autocomplete="off"></label>
  <button class="button form-submit" type="submit">Enviar proposta <span aria-hidden="true">↗</span></button><p id="form-status" role="status" aria-live="polite"></p></form>`

export const publicPages = [
  {
    path: '/',
    file: 'index.html',
    title: 'Evolutus | Organize seus Treinos e Evolua com Clareza',
    description:
      'Planeje treinos, registre séries, repetições e cargas e consulte histórico e indicadores no Evolutus.',
    body: `<section class="official-home-hero"><div class="official-home-intro"><p class="eyebrow">DIÁRIO DE TREINO</p><h1>Seu treino, registrado com clareza.</h1></div>${bannerPicture('quadro-geral', 'Visão oficial do Evolutus com registro de treino, indicadores de progresso e comunidades', true)}<div class="official-hero-below"><p>Planeje suas sessões, registre séries, repetições e cargas e consulte sua evolução no mesmo lugar.</p><div class="actions">${link('/cadastro', 'Criar conta <span aria-hidden="true">↗</span>', 'button')}${link('/como-funciona', 'Ver como funciona', 'text-link')}</div></div></section>
      <section class="section official-feature-section"><div class="official-feature-copy"><p class="eyebrow">DO TREINO AO HISTÓRICO</p><h2>Registre hoje para comparar depois.</h2><p>O formulário reúne exercício, séries, repetições e peso. As sessões salvas alimentam seu histórico e os indicadores de progresso.</p>${link('/funcionalidades', 'Explorar os recursos <span aria-hidden="true">↗</span>', 'text-link')}<p>${link('/guia-registro-treino', 'Aprenda a registrar séries, repetições e cargas no diário de treino')}</p></div>${bannerPicture('exercicio', 'Etapas oficiais do registro: escolha do grupo, exercício e séries')}</section>
      <section class="section" id="beneficios">${sectionHead('O QUE VOCÊ ENCONTRA', 'Ferramentas para manter a rotina.')}<div class="grid three">${valueCard('01 / PLANEJAR', 'Treinos organizados', 'Defina dias de treino e ajuste sua programação quando a semana mudar.')}${valueCard('02 / ESCOLHER', 'Mais de 800 exercícios', 'Pesquise por nome, grupo muscular ou equipamento no catálogo de exercícios.')}${valueCard('03 / ACOMPANHAR', 'Indicadores acessíveis', 'Consulte histórico, cargas e volume para entender o que aconteceu ao longo do tempo.')}</div></section>
      ${finalCta('Comece pelo próximo treino.', 'Crie sua conta e registre sua primeira sessão quando quiser.')}`,
  },
  {
    path: '/como-funciona',
    file: 'como-funciona.html',
    title: 'Como Funciona o Evolutus | Do Primeiro Treino à Evolução',
    description:
      'Veja como criar sua conta, organizar a rotina, registrar séries, repetições e cargas e acompanhar seu histórico e indicadores no Evolutus.',
    body: `<section class="official-page-hero"><div class="official-page-intro"><p class="eyebrow">GUIA RÁPIDO</p><h1>Como usar o Evolutus</h1><p>Comece com uma sessão. O planejamento pode ser feito antes ou depois, conforme sua rotina.</p>${link('#etapas', 'Ver as etapas ↓', 'text-link')}</div>${bannerPicture('exercicio', 'Três etapas oficiais do registro de treino no Evolutus', true)}</section>
      <nav class="journey-nav" aria-label="Etapas do guia"><a href="#conta">01 <span>Entre</span></a><a href="#rotina">02 <span>Planeje</span></a><a href="#registro">03 <span>Registre</span></a><a href="#evolucao">04 <span>Consulte</span></a></nav>
      <section class="section journey" id="etapas">${sectionHead('PASSO A PASSO', 'Do acesso ao histórico.')}
      <div class="journey-row" id="conta"><div class="journey-index">01<span>/ 04</span></div><div><h3>Crie sua conta</h3><p>Preencha o cadastro e siga a confirmação indicada na tela. Depois, entre no app.</p></div><div class="journey-panel"><small>ACESSO</small><strong>Cadastro → confirmação → app</strong><span>${link('/cadastro', 'Abrir cadastro ↗')}</span></div></div>
      <div class="journey-row" id="rotina"><div class="journey-index">02<span>/ 04</span></div><div><h3>Planeje a semana, se quiser</h3><p>Na área de planejamento, escolha os dias de treino. Você pode alterar a programação a qualquer momento.</p></div><div class="journey-panel"><small>PLANEJAMENTO</small><strong>Escolha os dias</strong><span>Depois, ajuste a rotina conforme necessário.</span></div></div>
      <div class="journey-row" id="registro"><div class="journey-index">03<span>/ 04</span></div><div><h3>Salve uma sessão</h3><p>Em Novo treino, escolha o exercício, informe séries, repetições e peso, e salve o que fez.</p></div><div class="journey-panel"><small>NOVO TREINO</small><strong>Exercício</strong><span class="guide-fields">Séries &nbsp; · &nbsp; Repetições &nbsp; · &nbsp; Peso (kg)</span></div></div>
      <div class="journey-row" id="evolucao"><div class="journey-index">04<span>/ 04</span></div><div><h3>Reveja os registros</h3><p>No Histórico, consulte as sessões. Em Progresso, acompanhe os indicadores disponíveis conforme você registra treinos.</p></div><div class="journey-panel"><small>HISTÓRICO / PROGRESSO</small><strong>Registros por sessão</strong><span>Os indicadores aparecem com seus dados reais.</span></div></div></section>
      <section class="section faq-section">${sectionHead('DÚVIDAS', 'Você decide por onde começar.')}<div class="faq-list"><details><summary>Preciso planejar antes de registrar?</summary><p>Não. Você pode salvar uma sessão e organizar a semana depois.</p></details><details><summary>Como acompanhar cargas por exercício?</summary><p>Salve as sessões com o exercício e o peso usado. Depois, consulte seus registros em Histórico. Veja o ${link('/guia-registro-treino', 'guia de registro de treino')}.</p></details><details><summary>Onde encontro ajuda?</summary><p>Na página de ${link('/atendimento', 'atendimento')}.</p></details></div></section>`,
  },
  {
    path: '/funcionalidades',
    file: 'funcionalidades.html',
    title: 'Funcionalidades do Evolutus | Planeje, Registre e Acompanhe',
    description:
      'Explore planejamento, catálogo de exercícios, registro de sessões, histórico, indicadores e comunidades do Evolutus.',
    body: `<section class="official-page-hero"><div class="official-page-intro"><p class="eyebrow">RECURSOS DO PRODUTO</p><h1>Explore as ferramentas de treino.</h1><p>Veja o que cada área permite fazer. Consulte indicadores de carga, volume e frequência gerados pelos treinos registrados.</p>${link('#recursos', 'Ver recursos ↓', 'text-link')}</div>${bannerPicture('progresso', 'Banner oficial do Evolutus com indicadores de treinos, evolução por exercício e composição corporal ilustrativos', true)}</section>
      <section class="section" id="recursos">${sectionHead('FERRAMENTAS', 'Escolha o que precisa fazer.')}<div class="grid three">${featureCard('▦', 'Planejamento', 'Defina dias de treino e reveja sua programação quando a rotina mudar.')}${featureCard('⊞', 'Catálogo de exercícios', 'Pesquise mais de 800 exercícios por nome, grupo muscular ou equipamento antes de adicioná-los.')}${featureCard('≡', 'Registro de sessão', 'Guarde séries, repetições e peso para consultar o que foi feito em cada treino.')}${featureCard('◷', 'Histórico', 'Encontre sessões anteriores e compare seus próprios registros por exercício.')}${featureCard('↗', 'Progresso', 'Acompanhe indicadores de carga, volume e frequência gerados pelos registros disponíveis.')}${featureCard('◎', 'Comunidades', 'Participe de conversas e compartilhe experiências nos espaços da plataforma.')}</div></section>
      <section class="section official-feature-section"><div class="official-feature-copy"><p class="eyebrow">COMUNIDADES</p><h2>Compartilhe a jornada.</h2><p>Participe de comunidades e converse sobre treino nos espaços disponíveis no aplicativo.</p></div>${bannerPicture('comunidade', 'Banner oficial de comunidades do Evolutus com grupos, canais e botão para criar uma comunidade')}</section>`,
  },
  {
    path: '/guia-registro-treino',
    file: 'guia-registro-treino.html',
    title: 'Como Registrar Séries, Repetições e Cargas | Evolutus',
    description: 'Aprenda a registrar uma sessão de musculação e consultar cargas por exercício no histórico do Evolutus.',
    body: `<section class="official-page-hero"><div class="official-page-intro"><p class="eyebrow">GUIA DE REGISTRO</p><h1>Como registrar séries, repetições e cargas</h1><p>Um diário de treino ajuda você a consultar o que fez em cada sessão e a comparar seus próprios registros por exercício.</p>${link('#registrar', 'Ver o passo a passo ↓', 'text-link')}</div>${bannerPicture('exercicio', 'Etapas oficiais para escolher o exercício e registrar séries no Evolutus', true)}</section>
      <section class="section journey" id="registrar">${sectionHead('NO APP', 'Do exercício ao histórico.')}
      <div class="journey-row"><div class="journey-index">01</div><div><h3>Encontre o exercício</h3><p>Abra Novo treino e procure no catálogo por nome, grupo muscular ou equipamento. Escolha o exercício realizado antes de informar os números.</p></div><div class="journey-panel"><small>CATÁLOGO</small><strong>Exercício</strong><span>Selecione o movimento que você treinou.</span></div></div>
      <div class="journey-row"><div class="journey-index">02</div><div><h3>Preencha a sessão</h3><p>Informe as séries, as repetições e o peso em quilogramas nos campos do registro. Use os valores do treino que você fez; não é necessário inventar uma meta.</p></div><div class="journey-panel"><small>REGISTRO</small><strong>Séries · Repetições · Peso (kg)</strong><span>Confira os campos antes de salvar.</span></div></div>
      <div class="journey-row"><div class="journey-index">03</div><div><h3>Consulte as cargas anteriores</h3><p>Depois de salvar, acesse Histórico para rever a sessão e os registros por exercício. Em Progresso, veja os indicadores calculados a partir dos treinos disponíveis na sua conta.</p></div><div class="journey-panel"><small>CONSULTA</small><strong>Histórico · Progresso</strong><span>Os dados aparecem conforme você registra sessões.</span></div></div></section>
      <section class="section faq-section">${sectionHead('ORGANIZAÇÃO', 'Planejamento é opcional.') }<p>Se quiser organizar os dias da semana, use o planejamento de treino. Você também pode registrar uma sessão antes de planejar e ajustar a rotina depois.</p><p>${link('/como-funciona', 'Veja o passo a passo para começar no Evolutus')} · ${link('/funcionalidades', 'Conheça todas as funcionalidades de treino')}</p></section>
      ${finalCta('Registre o próximo treino.', 'Crie uma conta para guardar sessões e consultar seu histórico.')}`,
  },
  {
    path: '/para-empresas',
    file: 'para-empresas.html',
    title: 'Parcerias e Publicidade Fitness | Evolutus para Empresas',
    description:
      'Apresente sua marca ao público fitness por meio de publicidade patrocinada ou vitrine de produtos. Envie uma proposta para análise do Evolutus.',
    body: `<section class="page-hero business-hero"><div><p class="eyebrow">EVOLUTUS PARA EMPRESAS</p><h1>Publicidade e produtos no Evolutus</h1><p>Apresente sua proposta de publicidade patrocinada ou produto para a vitrine. Formato, período e condições são definidos após análise comercial.</p><div class="actions">${link('#proposta', 'Enviar proposta <span aria-hidden="true">↗</span>', 'button')}${link('#formatos', 'Ver formatos', 'text-link')}</div></div><div class="business-visual"><div class="business-visual-inner"><span>EVOLUTUS <i>×</i> SUA MARCA</span><strong>Parcerias<br>em contexto.</strong><div class="business-visual-bars"><i></i><i></i><i></i><i></i></div><small>PUBLICIDADE IDENTIFICADA / PRODUTOS</small></div></div></section>

      <section class="section" id="formatos">${sectionHead('FORMATOS', 'Escolha onde apresentar sua marca.')}<div class="grid two commercial-grid"><article class="commercial-card"><span class="card-number">01 / MÍDIA</span><div class="commercial-icon">◈</div><h3>Publicidade patrocinada</h3><p>Divulgue marca, produto ou serviço em espaços do app, como a área inicial e comunidades. A peça aparece identificada como patrocinada.</p><ul><li>Posição e período definidos em acordo</li><li>Material sujeito à aprovação</li></ul></article><article class="commercial-card"><span class="card-number">02 / VITRINE</span><div class="commercial-icon">▣</div><h3>Vitrine de produtos</h3><p>Apresente imagem, marca, descrição, categoria e link para sua loja. Compra e suporte acontecem no site do parceiro.</p><ul><li>Produto e material sujeitos à aprovação</li><li>Itens patrocinados identificados</li></ul><span class="commercial-card-footer">${link('/vitrine', 'EXPLORAR A VITRINE ↗')}</span></article></div></section>
      <section class="section partnership-section">${sectionHead('PROCESSO TRANSPARENTE', 'Da proposta à publicação.', 'A publicação depende de avaliação, acordo comercial e aprovação dos materiais.')}<ol class="partnership-steps"><li><span>01</span><div><h3>Você apresenta a proposta</h3><p>Conte sobre a empresa, o produto e o formato de interesse.</p></div></li><li><span>02</span><div><h3>Nossa equipe analisa</h3><p>Avaliamos adequação, materiais e compatibilidade com a plataforma.</p></div></li><li><span>03</span><div><h3>Definimos os detalhes</h3><p>Se houver alinhamento, combinamos formato, período e condições.</p></div></li><li><span>04</span><div><h3>Publicamos após aprovação</h3><p>A divulgação segue o formato acordado e as regras do Evolutus.</p></div></li></ol></section>

      <section class="section proposal-section" id="proposta"><div class="proposal-intro"><p class="eyebrow">VAMOS CONVERSAR</p><h2>Apresente sua marca.<br><span>Nós avaliamos o próximo passo.</span></h2><p>Compartilhe as informações essenciais. Nossa equipe usa esses dados para analisar a proposta e responder pelo contato informado.</p><div class="proposal-note"><span aria-hidden="true">↗</span><div><strong>Envio para análise comercial.</strong><p>O envio não garante aprovação nem publicação.</p></div></div></div><form id="commercial-form" class="lead-form"><div class="form-heading"><span>01 / DADOS DA PROPOSTA</span><h3>Conte sobre sua empresa</h3><p>Campos com * são obrigatórios.</p></div><div class="form-grid"><label>Empresa <b aria-hidden="true">*</b><input name="company" required maxlength="120" autocomplete="organization" placeholder="Nome da empresa"></label><label>Responsável <b aria-hidden="true">*</b><input name="contact" required maxlength="120" autocomplete="name" placeholder="Seu nome"></label><label>E-mail <b aria-hidden="true">*</b><input name="email" type="email" required maxlength="254" autocomplete="email" placeholder="voce@empresa.com"></label><label>WhatsApp <span>(opcional)</span><input name="whatsapp" type="tel" maxlength="30" autocomplete="tel" placeholder="(00) 00000-0000"></label><label>Segmento <b aria-hidden="true">*</b><input name="segment" required maxlength="80" placeholder="Ex.: suplementos, vestuário"></label><label>Site ou rede social <b aria-hidden="true">*</b><input name="website" type="url" required maxlength="500" placeholder="https://"></label></div><label>Formato de interesse <b aria-hidden="true">*</b><select name="modality" required><option value="">Selecione um formato</option><option>Publicidade</option><option>Vitrine de produtos</option><option>Ambos</option></select></label><label>Conte sobre a proposta <b aria-hidden="true">*</b><textarea name="message" required minlength="20" maxlength="2000" rows="5" placeholder="Descreva seu produto, serviço ou ideia de parceria."></textarea></label><label class="consent"><input name="privacy" type="checkbox" required><span>Li a ${link('/politica-de-privacidade', 'política de privacidade')} e concordo com o uso dos dados para resposta comercial.</span></label><label class="trap" aria-hidden="true">Não preencha este campo<input name="website_confirmation" tabindex="-1" autocomplete="off"></label><button class="button form-submit" type="submit">Enviar proposta <span aria-hidden="true">↗</span></button><p id="form-status" role="status" aria-live="polite"></p></form></section>`,
  },
  {
    path: '/vitrine',
    file: 'vitrine.html',
    title: 'Vitrine Evolutus | Produtos e Marcas Parceiras',
    description:
      'Explore produtos aprovados de marcas parceiras do Evolutus. Veja os detalhes e siga para a loja externa do parceiro para comprar.',
    indexable: false,
    body: `<section class="section showcase-section showcase-first"><div class="showcase-heading"><p class="eyebrow">VITRINE EVOLUTUS</p><h1>Produtos de parceiros</h1><p>Explore produtos publicados por marcas parceiras.</p></div>${catalogFilters}<p id="catalog-status" class="catalog-status" role="status" aria-live="polite">Carregando produtos…</p><div class="catalog-retry" hidden>${primerButton('catalog-retry', 'Tentar novamente', 'button')}</div><div id="products" class="products-list" aria-busy="true"></div><div class="catalog-pagination"><button id="catalog-more" type="button" hidden>Carregar mais</button></div><p class="external-note">Compra, pagamento e suporte acontecem no site do parceiro.</p><dialog id="product-dialog" class="product-dialog" aria-labelledby="product-dialog-name"><button class="product-dialog-close" type="button" aria-label="Fechar imagem">×</button><div class="product-dialog-image"><span>Carregando imagem…</span></div><div class="product-dialog-details"><p class="product-dialog-brand"></p><h2 id="product-dialog-name"></h2><a class="button product-dialog-link" target="_blank" rel="noopener noreferrer">Ir para a loja ↗</a></div></dialog></section>`,
  },
  {
    path: '/profissionais',
    file: 'profissionais.html',
    title: 'Profissionais e Locais | Evolutus',
    description: 'Encontre profissionais e espaços de treino com informações divulgadas por seus responsáveis. O contato e a contratação são feitos diretamente.',
    indexable: false,
    body: `<section class="section professionals-directory"><div class="directory-hero"><div><p class="eyebrow">REDE EVOLUTUS</p><h1>Profissionais e locais para sua rotina.</h1><p>Explore perfis publicados, compare modalidade e região divulgada, e fale diretamente com quem oferece o serviço.</p><div class="directory-hero-links">${link('/vitrine', 'Explorar produtos ↗', 'text-link')}${link('/app', 'Voltar ao aplicativo', 'text-link')}</div></div><div class="directory-hero-aside"><span>ENCONTRE POR</span><strong>Atuação.<br>Modalidade.<br>Localização.</strong><p>As informações são fornecidas pelos responsáveis por cada perfil.</p></div></div>
    <div class="directory-content"><div class="section-head"><p class="eyebrow">DIRETÓRIO</p>${primerHeading('h2', '', 'Refine sua busca.')}<p>Os resultados são carregados em páginas de até 20 perfis publicados.</p></div><form id="professional-filters" class="directory-filters" aria-label="Filtros do diretório">
      ${primerSelect('tipo', 'Tipo', LISTING_KIND_OPTIONS.map(({ value, label }) => [value, label]), { id: 'directory-kind' })}
      ${primerSelect('modalidade', 'Modalidade', filterOptions(MODALITY_OPTIONS, 'Todas'), { id: 'directory-modality' })}
      ${primerSelect('uf', 'UF', [['', 'Todas'], ...BRAZIL_STATES.map((uf) => [uf, uf])], { id: 'directory-uf' })}
      ${primerInput('cidade', 'Cidade', { id: 'directory-city', maxLength: 80, placeholder: 'Todas as cidades' })}
      ${primerSelect('atendimento', 'Atendimento', filterOptions(SERVICE_MODE_OPTIONS, 'Todos'), { id: 'directory-service' })}
    </form><p id="directory-status" role="status" aria-live="polite">Carregando perfis publicados…</p><div id="directory-results" class="directory-grid" aria-busy="true"><div class="catalog-skeleton" aria-hidden="true"></div><div class="catalog-skeleton" aria-hidden="true"></div><div class="catalog-skeleton" aria-hidden="true"></div></div><div class="directory-pagination">${primerButton('directory-more', 'Carregar mais', 'button', { hidden: true })}${primerButton('directory-retry', 'Tentar novamente', 'button', { hidden: true })}</div><p class="directory-disclaimer">Contato e contratação acontecem diretamente com o profissional ou espaço. O Evolutus não processa pagamentos.</p></div></section>`,
  },
]

export function renderPublicConfig(env = {}) {
  const config = { url: env.VITE_SUPABASE_URL || '', key: env.VITE_SUPABASE_ANON_KEY || '' }
  return `window.EVOLUTUS_PUBLIC_CONFIG=${JSON.stringify(config)};`
}

export function renderPublicPage(path, env = {}, { dev = false } = {}) {
  const page = publicPages.find((entry) => entry.path === path)
  if (!page) return null
  const verification = [
    ['google-site-verification', env.VITE_GOOGLE_SITE_VERIFICATION],
    ['msvalidate.01', env.VITE_BING_SITE_VERIFICATION],
  ]
    .filter(([, value]) => typeof value === 'string' && /^[a-zA-Z0-9_-]{10,200}$/.test(value))
    .map(([name, value]) => `<meta name="${name}" content="${escape(value)}">`)
    .join('')
  const canonical = `${origin}${page.path}`
  const description = escape(page.description)
  const title = escape(page.title)
  const authRef = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(env.VITE_SUPABASE_URL || '')
    ? new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]
    : ''
  const homeBootstrap = path === '/' && authRef
    ? `<script src="/public-home-boot.js" data-auth-ref="${authRef}" data-redirect-src="${dev ? '/src/publicHomeRedirect.js' : '/assets/public-home-redirect.js'}"></script>`
    : ''
  const schema = path === '/'
    ? { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Evolutus', url: origin }
    : { '@context': 'https://schema.org', '@type': 'WebPage', name: page.title, description: page.description, url: canonical, inLanguage: 'pt-BR' }
  const assets = existsSync('dist/assets') ? readdirSync('dist/assets', { withFileTypes: true }) : []
  const primerCss = assets.find((entry) => entry.isFile() && /^primer-.*\.css$/.test(entry.name))?.name
  const publicTurboAsset = assets.find((entry) => entry.isFile() && /^publicTurbo-[\w-]+\.js$/.test(entry.name))?.name
  if (!dev && !publicTurboAsset) throw new Error('Build público sem o bundle Turbo Drive')
  const socialImage = path === '/'
    ? `${origin}/img/banners/quadro-geral-1774.webp`
    : path === '/funcionalidades'
      ? `${origin}/img/banners/progresso-1774.webp`
      : ['/como-funciona', '/guia-registro-treino'].includes(path)
      ? `${origin}/img/banners/exercicio-1774.webp`
      : `${origin}/img/banners/quadro-geral-1774.webp`
  let body = page.body
  if (path === '/como-funciona') body = body.replace('<section class="section faq-section">',
    `<section class="section official-feature-section"><div class="official-feature-copy"><p class="eyebrow">ACOMPANHAMENTO</p><h2>Consulte a evolução no aplicativo.</h2><p>Histórico e indicadores são calculados a partir dos treinos que você registra. A imagem mostra a interface oficial com dados ilustrativos.</p></div>${bannerPicture('progresso', 'Interface oficial de progresso e acompanhamento por exercício')}</section><section class="section faq-section">`)
  if (path === '/guia-registro-treino') {
    body = body.replace('<section class="section journey" id="registrar">',
      '<nav class="guide-toc" aria-label="Neste guia"><a href="#escolher-exercicio">01 Escolha o exercício</a><a href="#preencher-sessao">02 Preencha a sessão</a><a href="#consultar-historico">03 Consulte o histórico</a></nav><section class="section journey" id="registrar">')
    body = body.replace('<div class="journey-row"><div class="journey-index">01', '<div class="journey-row" id="escolher-exercicio"><div class="journey-index">01')
    body = body.replace('<div class="journey-row"><div class="journey-index">02', '<div class="journey-row" id="preencher-sessao"><div class="journey-index">02')
    body = body.replace('<div class="journey-row"><div class="journey-index">03', '<div class="journey-row" id="consultar-historico"><div class="journey-index">03')
    body = body.replace('<section class="section faq-section">',
      '<section class="section guide-example"><p class="eyebrow">EXEMPLO DE PREENCHIMENTO</p><h2>Registre o que aconteceu na sessão.</h2><p>Um exemplo genérico de anotação seria: exercício escolhido, 3 séries, 10 repetições e 20 kg. Informe os números reais de cada treino; eles só aparecem no histórico da sua conta após salvar.</p></section><section class="section faq-section">')
  }
  if (path === '/para-empresas') body = body.replace(/<form id="commercial-form"[\s\S]*?<\/form>/, commercialForm)
  if (path === '/vitrine') body += productCardTemplate
  if (path === '/profissionais') body += `${professionalCardTemplate}<script id="professional-taxonomy" type="application/json">${JSON.stringify(professionalTaxonomy).replace(/</g, '\\u003c')}</script>`
  const activeNav = nav.replace(/<a\b([^>]*\bhref="([^"]+)"[^>]*)>/g, (match, attributes, href) =>
    href === path ? `<a${attributes} aria-current="page">` : match)
  return enableTurboLinks(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0d1117"><meta name="robots" content="${page.indexable === false ? 'noindex,follow' : 'index,follow'}">${verification}<meta name="view-transition" content="same-origin">${['/para-empresas', '/vitrine', '/profissionais'].includes(path) ? '<meta name="turbo-cache-control" content="no-cache">' : ''}<title>${title}</title><meta name="description" content="${description}"><link rel="canonical" href="${canonical}"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${socialImage}"><meta property="og:locale" content="pt_BR"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${socialImage}"><link rel="icon" href="/icons/icon-192.png"><script src="/boot-theme.js"></script>${homeBootstrap}${primerCss ? `<link rel="stylesheet" href="/assets/${primerCss}">` : ''}<link rel="stylesheet" href="/public-pages.css"><link rel="stylesheet" href="/public-light.css"><link rel="stylesheet" href="/public-redesign.css">${path === '/vitrine' ? '<link rel="stylesheet" href="/public-products.css">' : ''}${primerStyles()}<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script><script type="module" src="${dev ? '/src/publicTurbo.js' : `/assets/${publicTurboAsset}`}" data-turbo-track="reload"></script></head><body class="public-${page.path === '/' ? 'home' : page.path.slice(1)}" data-turbo-prefetch="false"><a class="skip" href="#content">Pular para o conteúdo</a>${activeNav}<main id="content" tabindex="-1">${body}</main>${footer}<script src="/public-config.js" defer></script><script src="/public-pages.js" defer></script></body></html>`)
}

export function renderRobots() {
  return `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`
}

export function renderSitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicPages
    .filter((page) => page.indexable !== false)
    .map((page) => `<url><loc>${origin}${page.path}</loc></url>`)
    .join('')}</urlset>`
}
