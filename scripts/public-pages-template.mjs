// Production currently redirects apex to www (measured 2026-10-19).
const origin = 'https://www.evolutus.com.br'

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  )
const link = (href, label, kind = '') => `<a class="${kind}" href="${href}">${label}</a>`
const picture = (name, alt, priority = false) =>
  `<picture><source srcset="/img/${name}-480.avif 480w, /img/${name}-800.avif 800w, /img/${name}-1024.avif 1024w" type="image/avif"><img src="/img/${name}-800.webp" alt="${alt}" width="800" height="960" loading="${priority ? 'eager' : 'lazy'}"${priority ? ' fetchpriority="high"' : ''} decoding="async" sizes="(max-width: 760px) 100vw, 45vw"></picture>`
const navLinks = `<a href="/como-funciona">Como funciona</a><a href="/funcionalidades">Funcionalidades</a><a href="/para-empresas">Para empresas</a><a href="/vitrine">Vitrine</a>`
const nav = `<header class="site-header"><div class="header-inner"><a class="brand" href="/" aria-label="Evolutus.com, página inicial"><img src="/icons/icon-192.png" width="38" height="38" alt=""><span>Evolutus<span class="brand-dot">.com</span></span></a><nav class="desktop-nav" aria-label="Principal">${navLinks}</nav><div class="header-actions"><a class="login-link" href="/login">Entrar</a>${link('/cadastro', 'Criar conta <span aria-hidden="true">↗</span>', 'button small')}</div><details class="mobile-menu"><summary aria-label="Abrir menu de navegação"><span></span><span></span><span></span></summary><nav aria-label="Principal, celular">${navLinks}<a href="/login">Entrar</a>${link('/cadastro', 'Criar conta', 'button')}</nav></details></div></header>`
const footer = `<footer class="site-footer"><div class="footer-inner"><div><a class="brand" href="/"><img src="/icons/icon-192.png" width="34" height="34" alt=""><span>Evolutus<span class="brand-dot">.com</span></span></a><p>Planeje, registre e consulte seus treinos.</p></div><nav aria-label="Rodapé"><a href="/como-funciona">Como funciona</a><a href="/funcionalidades">Funcionalidades</a><a href="/para-empresas">Para empresas</a><a href="/vitrine">Vitrine</a><a href="/profissionais">Profissionais</a><a href="/termos-de-uso">Termos</a><a href="/politica-de-privacidade">Privacidade</a></nav></div><div class="footer-bottom"><span>© Evolutus</span></div></footer>`
const sectionHead = (eyebrow, title, description = '') =>
  `<div class="section-head"><p class="eyebrow">${eyebrow}</p><h2>${title}</h2>${description ? `<p>${description}</p>` : ''}</div>`
const valueCard = (number, title, body) =>
  `<article class="value-card"><span class="card-number">${number}</span><h3>${title}</h3><p>${body}</p><span class="card-line" aria-hidden="true"></span></article>`
const featureCard = (icon, title, body) =>
  `<article class="feature-card"><span class="feature-icon" aria-hidden="true">${icon}</span><h3>${title}</h3><p>${body}</p></article>`
const finalCta = (title, body) =>
  `<section class="section final-cta"><div><p class="eyebrow">COMECE AGORA</p><h2>${title}</h2><p>${body}</p></div><div class="cta-actions">${link('/cadastro', 'Criar conta <span aria-hidden="true">↗</span>', 'button')}</div></section>`
// Labels below mirror the app's dashboard, workout form and history; no simulated user records.
const appPreview = `<div class="product-preview" aria-label="Prévia ilustrativa das áreas reais do Evolutus, sem dados pessoais"><div class="preview-top"><span class="preview-mark">E</span><span>Evolutus <i>·</i> Visão do produto</span></div><div class="preview-body"><div class="preview-side"><span class="selected">Início</span><span>Novo treino</span><span>Histórico</span><span>Progresso</span></div><div class="preview-main"><span class="eyebrow">NOVO TREINO</span><h3>Qual grupo você vai treinar?</h3><p>Escolha o exercício e registre a sessão.</p><div class="preview-columns"><div><small>REGISTRO</small><strong>Exercício</strong><span>Selecione no catálogo</span><div class="preview-inputs"><em>Séries</em><em>Repetições</em><em>Peso (kg)</em></div></div><div><small>HISTÓRICO</small><strong>Sessões anteriores</strong><span>Consulte por exercício</span><p>Seu histórico começa depois da primeira sessão.</p></div></div></div></div></div>`

export const publicPages = [
  {
    path: '/',
    file: 'index.html',
    title: 'Evolutus | Organize seus Treinos e Evolua com Clareza',
    description:
      'Planeje treinos, registre séries, repetições e cargas e consulte histórico e indicadores no Evolutus.',
    body: `<section class="hero home-hero"><div class="hero-copy"><p class="eyebrow"><span class="eyebrow-line"></span> DIÁRIO DE TREINO</p><h1>Saiba o que treinou.<br><span>Veja o que mudou.</span></h1><p class="hero-lead">Planeje suas sessões, registre séries, repetições e cargas e consulte sua evolução no mesmo lugar.</p><div class="actions">${link('/cadastro', 'Criar conta <span aria-hidden="true">↗</span>', 'button')}${link('/como-funciona', 'Ver como funciona', 'text-link')}</div></div><div class="hero-art">${picture('capa_principal', 'Homem e mulher treinando em uma academia', true)}</div></section>
      <section class="section product-section"><div class="product-section-copy"><p class="eyebrow">DO TREINO AO HISTÓRICO</p><h2>Registre hoje para comparar depois.</h2><p>O formulário reúne exercício, séries, repetições e peso. As sessões salvas alimentam seu histórico e os indicadores de progresso.</p>${link('/funcionalidades', 'Explorar os recursos <span aria-hidden="true">↗</span>', 'text-link')}</div>${appPreview}</section>
      <section class="section" id="beneficios">${sectionHead('O QUE VOCÊ ENCONTRA', 'Ferramentas para manter a rotina.')}<div class="grid three">${valueCard('01 / PLANEJAR', 'Treinos organizados', 'Defina dias de treino e ajuste sua programação quando a semana mudar.')}${valueCard('02 / ESCOLHER', 'Mais de 800 exercícios', 'Pesquise por nome, grupo muscular ou equipamento no catálogo de exercícios.')}${valueCard('03 / ACOMPANHAR', 'Indicadores acessíveis', 'Consulte histórico, cargas e volume para entender o que aconteceu ao longo do tempo.')}</div></section>
      ${finalCta('Comece pelo próximo treino.', 'Crie sua conta e registre sua primeira sessão quando quiser.')}`,
  },
  {
    path: '/como-funciona',
    file: 'como-funciona.html',
    title: 'Como Funciona o Evolutus | Do Primeiro Treino à Evolução',
    description:
      'Veja como criar sua conta, organizar a rotina, registrar séries, repetições e cargas e acompanhar seu histórico e indicadores no Evolutus.',
    body: `<section class="page-hero guide-hero"><div><p class="eyebrow">GUIA RÁPIDO</p><h1>Como usar o Evolutus</h1><p>Comece com uma sessão. O planejamento pode ser feito antes ou depois, conforme sua rotina.</p>${link('#etapas', 'Ver as etapas ↓', 'text-link')}</div><div class="page-hero-visual">${picture('capa_principal', 'Homem e mulher treinando em uma academia')}</div></section>
      <nav class="journey-nav" aria-label="Etapas do guia"><a href="#conta">01 <span>Entre</span></a><a href="#rotina">02 <span>Planeje</span></a><a href="#registro">03 <span>Registre</span></a><a href="#evolucao">04 <span>Consulte</span></a></nav>
      <section class="section journey" id="etapas">${sectionHead('PASSO A PASSO', 'Do acesso ao histórico.')}
      <div class="journey-row" id="conta"><div class="journey-index">01<span>/ 04</span></div><div><h3>Crie sua conta</h3><p>Preencha o cadastro e siga a confirmação indicada na tela. Depois, entre no app.</p></div><div class="journey-panel"><small>ACESSO</small><strong>Cadastro → confirmação → app</strong><span>${link('/cadastro', 'Abrir cadastro ↗')}</span></div></div>
      <div class="journey-row" id="rotina"><div class="journey-index">02<span>/ 04</span></div><div><h3>Planeje a semana, se quiser</h3><p>Na área de planejamento, escolha os dias de treino. Você pode alterar a programação a qualquer momento.</p></div><div class="journey-panel"><small>PLANEJAMENTO</small><strong>Escolha os dias</strong><span>Depois, ajuste a rotina conforme necessário.</span></div></div>
      <div class="journey-row" id="registro"><div class="journey-index">03<span>/ 04</span></div><div><h3>Salve uma sessão</h3><p>Em Novo treino, escolha o exercício, informe séries, repetições e peso, e salve o que fez.</p></div><div class="journey-panel"><small>NOVO TREINO</small><strong>Exercício</strong><span class="guide-fields">Séries &nbsp; · &nbsp; Repetições &nbsp; · &nbsp; Peso (kg)</span></div></div>
      <div class="journey-row" id="evolucao"><div class="journey-index">04<span>/ 04</span></div><div><h3>Reveja os registros</h3><p>No Histórico, consulte as sessões. Em Progresso, acompanhe os indicadores disponíveis conforme você registra treinos.</p></div><div class="journey-panel"><small>HISTÓRICO / PROGRESSO</small><strong>Registros por sessão</strong><span>Os indicadores aparecem com seus dados reais.</span></div></div></section>
      <section class="section faq-section">${sectionHead('DÚVIDAS', 'Você decide por onde começar.')}<div class="faq-list"><details><summary>Preciso planejar antes de registrar?</summary><p>Não. Você pode salvar uma sessão e organizar a semana depois.</p></details><details><summary>Preciso seguir este guia?</summary><p>Não. Ele é uma referência para consultar quando precisar.</p></details><details><summary>Onde encontro ajuda?</summary><p>Na página de ${link('/atendimento', 'atendimento')}.</p></details></div></section>`,
  },
  {
    path: '/funcionalidades',
    file: 'funcionalidades.html',
    title: 'Funcionalidades do Evolutus | Planeje, Registre e Acompanhe',
    description:
      'Explore planejamento, catálogo de exercícios, registro de sessões, histórico, indicadores e comunidades do Evolutus.',
    body: `<section class="page-hero features-hero"><div><p class="eyebrow">RECURSOS DO PRODUTO</p><h1>Explore as ferramentas de treino.</h1><p>Veja o que cada área permite fazer e escolha o recurso útil para sua rotina.</p>${link('#recursos', 'Ver recursos ↓', 'text-link')}</div><div class="features-hero-art" aria-label="Áreas de planejamento, registro, histórico e progresso"><span class="floating-label top">PLANEJAMENTO</span><div class="feature-orbit"><span>EVOLUTUS</span><strong>Suas ferramentas<br>de treino<span>.</span></strong><small>Registro · histórico · progresso</small></div><span class="floating-label bottom">CATÁLOGO + COMUNIDADES</span></div></section>
      <section class="section" id="recursos">${sectionHead('FERRAMENTAS', 'Escolha o que precisa fazer.')}<div class="grid three">${featureCard('▦', 'Planejamento', 'Defina dias de treino e reveja sua programação quando a rotina mudar.')}${featureCard('⊞', 'Catálogo de exercícios', 'Pesquise mais de 800 exercícios por nome, grupo muscular ou equipamento antes de adicioná-los.')}${featureCard('≡', 'Registro de sessão', 'Guarde séries, repetições e peso para consultar o que foi feito em cada treino.')}${featureCard('◷', 'Histórico', 'Encontre sessões anteriores e compare seus próprios registros por exercício.')}${featureCard('↗', 'Progresso', 'Acompanhe indicadores de carga, volume e frequência gerados pelos registros disponíveis.')}${featureCard('◎', 'Comunidades', 'Participe de conversas e compartilhe experiências nos espaços da plataforma.')}</div></section>
      <section class="section product-section reverse"><div class="product-section-copy"><p class="eyebrow">EXEMPLO DA INTERFACE</p><h2>Campos conhecidos. Dados seus.</h2><p>A prévia mostra os tipos de campo usados no registro e as áreas onde você consulta sessões salvas. Nenhum resultado pessoal é simulado.</p></div>${appPreview}</section>`,
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
    robots: 'noindex,follow',
    body: `<section class="section showcase-section showcase-first"><div class="showcase-heading"><div><p class="eyebrow">VITRINE EVOLUTUS</p><h1>Produtos de parceiros</h1><p>Veja a marca, a categoria e a descrição. Itens pagos são identificados como patrocinados.</p></div><label class="filter-label" for="category">Categoria<select id="category"><option value="">Todas as categorias</option></select></label></div><p id="catalog-status" class="catalog-status" role="status" aria-live="polite">Carregando produtos…</p><div id="products" class="grid three products-grid"></div><div class="external-note"><span aria-hidden="true">↗</span><p>Os links abrem a loja do parceiro. Confira preços, compra e suporte diretamente com ele.</p></div></section>`,
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
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0d1117"><meta name="robots" content="${page.robots || 'index,follow'}">${verification}<title>${title}</title><meta name="description" content="${description}"><link rel="canonical" href="${canonical}"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${origin}/img/capa_principal-1024.webp"><meta property="og:locale" content="pt_BR"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${origin}/img/capa_principal-1024.webp"><link rel="icon" href="/icons/icon-192.png"><script src="/boot-theme.js"></script>${homeBootstrap}<link rel="stylesheet" href="/public-pages.css"><link rel="stylesheet" href="/public-light.css"><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Evolutus', url: origin })}</script></head><body><a class="skip" href="#content">Pular para o conteúdo</a>${nav}<main id="content">${page.body}</main>${footer}<script src="/public-config.js" defer></script><script src="/public-pages.js" defer></script></body></html>`
}

export function renderRobots() {
  return `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`
}

export function renderSitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicPages
    .filter((page) => !page.robots)
    .map((page) => `<url><loc>${origin}${page.path}</loc></url>`)
    .join('')}</urlset>`
}
