# PROMPT DE IMPLEMENTAÇÃO — EVOLUTUS
## SEO técnico + páginas públicas + captação de empresas + vitrine de produtos

> **Modo de execução:** atuar como engenheiro de software sênior (React/Vite/Supabase/Vercel), especialista em SEO técnico, acessibilidade, performance e segurança. **Implementar de verdade, testar e apresentar evidências.** Não entregar somente um plano ou telas demonstrativas. Não publicar em produção sem autorização explícita.

## 1. Objetivo e prioridades

Transformar **https://evolutus.com.br** em uma presença pública clara, rápida e indexável, sem prejudicar o aplicativo fitness existente. Entregar:

1. **Homepage pública `/`** explicando o Evolutus e direcionando ao cadastro ou login.
2. **Página `/como-funciona`** ensinando o sistema com explicações extremamente simples, demonstrações e acesso opcional a orientações detalhadas.
3. **Página `/para-empresas`** apresentando publicidade patrocinada, vitrines de produtos com links externos, etapas de parceria e um **formulário comercial funcional**.
4. **Vitrine pública `/vitrine`** de produtos de empresas parceiras, separada da vitrine já existente de profissionais. Vendas/checkout acontecem **exclusivamente fora do Evolutus**.
5. **SEO técnico completo** para as novas páginas: HTML rastreável, metadados por rota, canonicals, Open Graph, sitemap, robots, dados estruturados pertinentes, respostas HTTP corretas e acompanhamento básico.
6. **Preservação total** das áreas autenticadas, PWA/offline, treinos, comunidades, anúncios existentes, permissões, moderação, pagamentos e experiência mobile.

**Ordem de importância:** integridade do app e segurança > indexação real > UX e performance > captação comercial > funcionalidades opcionais.

**Não criar um marketplace próprio**, checkout, carrinho, cobrança publicitária automática, portal de autoatendimento para anunciantes, publicidade invasiva ou infraestrutura que não seja necessária para esses objetivos.

## 2. Primeiro passo obrigatório: auditoria de compatibilidade

Antes de alterar arquivos:

- Conferir `git status`, branch atual, remoto e diferenças em relação a `origin/main`. **Há atualizações provenientes de outra máquina**: sincronizar com a `main` remota de forma segura, sem `reset --hard`, sem sobrescrever trabalho local nem descartar alterações. Se houver conflitos que não possam ser resolvidos com segurança, explicar o bloqueio antes de prosseguir.
- Inspecionar as implementações atuais e suas dependências. Não presumir que o ZIP de referência é idêntico ao repositório atualizado.
- Identificar componentes, serviços, políticas RLS, migrations, testes, estilos, utilitários e estruturas comerciais reutilizáveis.
- Registrar brevemente o diagnóstico e a estratégia arquitetural escolhida antes das mudanças.

### Pontos já identificados na versão de referência (revalidar na `main`)

- Stack: **React 18, Vite 7, React Router 7, Supabase, Vercel**, Primer React, PWA próprio.
- `src/App.jsx`: `/` atualmente é dashboard protegido por `ProtectedRoute`; `/login`, `/cadastro`, `/profissionais` e `/profissionais/:listingId` são públicas.
- `src/components/ProtectedRoute.jsx`: verificações de acesso, termos, bloqueios, perfil e funcionamento offline. **Não simplificar/remover essas barreiras.**
- `src/components/PublicLayout.jsx`: layout público existente, reaproveitável/adaptável.
- `src/components/Layout.jsx`, `src/routeLoaders.js`, `src/pages/Login.jsx`, `src/pages/Register.jsx`: navegação e redirects hoje associados a `/`.
- `public/manifest.webmanifest`, `scripts/pwa-plugin.js`, `scripts/service-worker.js`, `src/utils/offlineRoutes.js`: cold start, precache e rotas offline.
- `src/pages/AdminSponsoredAds.jsx`, `src/components/SponsoredAdBanner.jsx`, `src/components/SponsoredAdCard.jsx`, `src/hooks/useGlobalSponsoredAds.js`, `src/hooks/useSponsoredAds.js`, `src/features/adMetrics/`: **o Evolutus JÁ POSSUI gestão de anúncios patrocinados e coleta de métricas** (sujeita às configurações atuais). Reutilizar; **não recriar campanhas ou métricas paralelas**.
- `/admin/parcerias`: painel já existente, protegido por `SuperAdminRoute`.
- `/profissionais`, `/profissionais/:listingId`, `/minha-vitrine` e `/admin/vitrines`: vitrines **de profissionais/estabelecimentos**, distintas da nova vitrine **de produtos comerciais**. Preservar nomes, permissões e regras; não reutilizar tabelas com semântica incompatível.
- `src/pages/Support.jsx`: suporte existente, com categorias específicas e permissões próprias. **Não usar indevidamente** denúncias/privacidade como canal de leads comerciais.
- `index.html`: título global sem metadados completos; `vercel.json`: fallback de SPA e regras de segurança/cache; `public/manifest.webmanifest`: `start_url` atualmente `/`.

## 3. Arquitetura de rotas e preservação do app

Implementar a seguinte navegação, ajustando apenas se a análise do repositório demonstrar uma alternativa comprovadamente menos arriscada:

| Rota | Função | Indexação |
|---|---|---|
| `/` | Landing pública do Evolutus | `index,follow` |
| `/como-funciona` | Guia visual e simples | `index,follow` |
| `/para-empresas` | Proposta comercial e formulário | `index,follow` |
| `/vitrine` | Produtos de parceiros aprovados | `index,follow` quando houver conteúdo real |
| `/vitrine/:slug` | Detalhe opcional de produto | Somente se houver conteúdo original e renderização rastreável; senão adiar ou `noindex` |
| `/profissionais` e `/profissionais/:listingId` | Diretório público já existente | Manter; tratar melhorias de SEO somente com renderização confiável |
| `/login`, `/cadastro`, recuperação de senha e confirmação | Autenticação | `noindex,follow` quando apropriado |
| `/app` | Dashboard autenticado, antes em `/` | `noindex` + controle de acesso |
| Rotas internas atuais | Treinos, comunidade, perfil, admin, pagamentos | Preservadas; não expor dados privados ao indexador |

**Migração crítica de `/` para `/app`:**

- A homepage `/` deve permanecer **HTML público real**, independentemente de sessão, para ser rastreada. Não resolver SEO com um redirect global de `/` para `/login` ou HTML vazio aguardando React.
- Usuário sem sessão encontra a landing e pode ir diretamente para `/cadastro` ou `/login`; tutorial **nunca obrigatório**.
- Usuário autenticado deve conseguir ir ao dashboard em **um único clique** (`Ir para o app`) e, se optarem por redirecionamento automático no cliente, fazê-lo **somente após estado de sessão conhecido**, sem flash, looping ou privar bots do HTML público.
- Atualizar com cuidado: `App.jsx`, `routeLoaders.js`, navegação do `Layout`, `PublicLayout`, Login/Register e seus redirects, links de marca, origem/voltar, deep links, notificações, atalhos e testes.
- **PWA:** rever o `start_url` (provavelmente `/app`), `id`, `scope`, URLs do precache, navegação offline, cache, restauração de sessões e acesso aos treinos sem rede. Testar atualização de PWA já instalado; não fazer uma mudança de manifest que quebre instalações existentes sem avaliar compatibilidade.
- Manter URLs antigas de funcionalidades; usar redirects apenas onde apropriado e comprovadamente seguros. Nunca abrir acesso não autenticado ao dashboard.

## 4. Landing principal `/`

**Objetivo:** visitante entende o produto em 5–10 segundos, vê evidências visuais reais e consegue iniciar cadastro sem obstáculos.

### Conteúdo obrigatório

1. Header responsivo e leve: logo, `Como funciona`, `Funcionalidades` (âncora, se não houver página própria), `Para empresas`, `Vitrine`, `Entrar` e CTA `Criar conta` (navegação mobile compacta e acessível).
2. Hero com proposta clara: **“Organize seus treinos. Acompanhe sua evolução.”** Subtexto mencionando registro de exercícios, séries, repetições, cargas e histórico. CTA primário para `/cadastro`; secundário para `/como-funciona`.
3. Prévia visual autêntica do aplicativo: telas/elementos reais de planejamento, registro e acompanhamento; **não fabricar métricas, depoimentos, usuários, capturas ou funcionalidades**.
4. Três passos: **Organize → Registre → Evolua**.
5. Grade enxuta de funcionalidades **que já existem** (treinos, evolução, histórico, comunidades etc.); evitar prometer novos recursos.
6. Seção “Como funciona” com link para o tutorial completo.
7. CTA final para cadastro; rodapé com empresas, vitrine, profissionais e páginas legais reais.

**Copywriting:** português do Brasil, objetivo, acolhedor, sem exageros (“melhor app”, “resultados garantidos”, “grátis” se a gratuidade não estiver validada). Manter “Seu diário de evolução” como elemento de marca, mas explicar que é um app para registrar treinos de academia.

## 5. Página `/como-funciona`

Criar uma central de aprendizado visual e curta, acessível antes e depois do login:

- Hero “Aprenda a usar o Evolutus em poucos minutos”.
- Jornada em etapas numeradas: criar conta, organizar a rotina, registrar treino, acompanhar evolução; adicionar comunidades apenas se a experiência real estiver estável.
- Cada etapa: título simples, 1–3 frases, imagem/tela real, instrução objetiva e, se necessário, expansão opcional (`details` acessível ou padrão existente).
- Navegação por âncoras e FAQ editorial real, **não fabricado apenas para rich snippets**.
- Botões `Começar agora` / `Entrar` e acesso a ajuda.
- Reutilizar componentes e textos em uma futura central de ajuda interna; não duplicar conteúdo idêntico entre módulos.
- Sem carrossel obrigatório, autoplay, modal inicial ou tutorial que bloqueie cadastro.

## 6. Página `/para-empresas`

**Objetivo:** captar contatos comerciais qualificados, apresentando dois formatos distintos:

1. **Publicidade patrocinada:** divulgação da marca/produto/serviço em posições aprovadas; aproveitar a infraestrutura de anúncios que já existe (home/comunidades) e destacar sempre a identificação `Patrocinado`.
2. **Vitrine de produtos:** card ou página pública com imagem, marca, descrição e botão externo `Ver na loja`; compra e suporte da compra acontecem no site do parceiro.

### Estrutura da página

- Hero: **“Sua marca mais perto de quem vive o fitness.”** Explicar a proposta sem inventar números de audiência ou retorno.
- Dois cards comparativos de formatos com benefícios, limites e exemplos visuais ilustrativos claramente identificados.
- Etapas comerciais: **Enviar proposta → Análise da equipe → Definir formato e período → Publicação aprovada → Acompanhar resultados disponíveis**.
- Informar que as campanhas passam por revisão e que categorias/peças podem ser recusadas.
- Formulário de contato (abaixo) e alternativa de contato oficial **somente se o contato real for confirmado nas configurações/projeto**. Não inventar número de telefone, e-mail, preços ou parceiros.
- Link para política de privacidade e aviso de tratamento dos dados enviados.

### Formulário comercial FUNCIONAL (não mailto disfarçado)

Campos: nome da empresa, responsável, e-mail, WhatsApp (opcional conforme decisão UX), segmento, site ou rede social, modalidade (`Publicidade`, `Vitrine de produtos`, `Ambos`), mensagem e concordância necessária com a privacidade. Validar no cliente **e no servidor**.

- Persistência segura no Supabase via endpoint/RPC/Edge Function adequada ao projeto, com `commercial_leads` ou entidade equivalente **somente se não existir uma reutilizável**.
- Escrita pública estritamente limitada por validação/limite de tamanho/rate limit/anti-spam; **nunca liberar `select` público** em leads. Usar RLS e serviço autorizado; evitar expor dados ou segredos.
- Antiabuso: rate limit por origem/identificadores adequados sem registrar dados sensíveis desnecessários; honeypot ou outra defesa leve; CAPTCHA só se necessário e justificado.
- UX: loading, sucesso real após persistência, erro tratável, prevenção de duplo envio, feedback acessível e nenhum falso “enviado”.
- Painel administrativo mínimo de leitura/gestão dos leads **integrado à administração existente**, com acesso exclusivo a superadmin. Status simples (`novo`, `em_contato`, `encerrado`) se necessário. Não montar um CRM complexo.
- Se depender de credenciais/canais externos indisponíveis, implementar até o limite seguro, documentar configuração pendente e **não simular envio com sucesso**.

## 7. Vitrine de produtos `/vitrine`

Separar conceitualmente da rota `/profissionais` e do recurso `/minha-vitrine` existente.

### MVP

- Página pública com cards de produtos **reais, cadastrados e aprovados**: imagem, nome, marca/parceiro, descrição curta, categoria, selo `Patrocinado` quando aplicável, CTA `Ver na loja` e aviso “Compra realizada fora do Evolutus”.
- Filtro por categorias já cadastradas; estados vazios e erros elegantes. **Não publicar produtos fictícios** nem exibir preços/estoque sem fonte atualizada e verificável.
- Criar o menor conjunto de entidades necessário (`partner_products` e relacionamento com parceiro/campanha, se a estrutura existente permitir), com leitura pública **somente para itens aprovados e vigentes**; CRUD exclusivamente via administrador autorizado.
- Aproveitar cadastro de parceiros/anúncios existente quando semanticamente compatível. Não substituir nem misturar vitrine de profissionais com catálogo comercial.
- Links externos obrigatoriamente `https:`, URLs validadas contra esquemas perigosos; renderizar com `target="_blank"` e `rel="noopener noreferrer sponsored"` em publicidade/afiliados, sem mascarar o destino; proteger também contra URL maliciosa/redirect abusivo.
- Imagens otimizadas, dimensão reservada, `loading="lazy"` fora da dobra, fallback acessível; considerar privacidade e carregamento de imagens de terceiros conforme padrões existentes.
- Sem carrinho, checkout ou captura de pagamentos/dados de compra.
- Se ainda não houver itens comerciais aprovados, apresentar página institucional útil + estado vazio. **Não listar URLs de produtos no sitemap até serem publicáveis e renderizáveis**.

### Integração com publicidade existente

- **Não recriar** a lógica de `/admin/parcerias`, hooks, métricas e componentes patrocinados existentes.
- Manter anúncios de home/comunidades como estão, a menos que ajustes mínimos sejam necessários para integração.
- Mostrar explicitamente publicidade paga versus seleção editorial. Nenhum pop-up, anúncio entre séries ou interrupção no fluxo de treino.
- Métricas comerciais somente conforme consentimento, base legal, configurações de coleta e controle de privacidade já existentes; não ligar coleta desligada por padrão sem autorização.

## 8. SEO técnico obrigatório

### 8.1 HTML rastreável: requisito inegociável

**Não basta React Helmet/metatags no cliente**. `GET /`, `/como-funciona`, `/para-empresas` e `/vitrine` (quando aplicável) devem retornar **HTML útil e específico por URL antes da execução do JavaScript**, incluindo título, descrição, H1, conteúdo essencial, links internos e canonical.

- Preferir **pré-renderização no build das páginas públicas estáticas** ou solução híbrida equivalente compatível com o Vite/Vercel atuais.
- Não migrar toda a aplicação para Next.js nem converter telas autenticadas para SSR.
- Se separar entry points/builds, preservar CSP, assets hash, cabeçalhos, fallback SPA, links diretos e integridade do PWA. Explicar em 3–5 linhas a decisão arquitetural.
- Para conteúdo dinâmico (produtos/profissionais), **não fingir SSR** com skeleton + metatags do cliente. Só indexar detalhes quando houver entrega confiável e atualizada de HTML público e status adequado; caso contrário, adiar indexação individual.

### 8.2 Metadados por rota

Cada página pública indexável deve ter:

- `<html lang="pt-BR">` e `<title>` exclusivo, descritivo.
- Meta description exclusiva (~140–160 caracteres como orientação editorial, **não limite rígido**).
- `link rel="canonical"` absoluto, consistente com a origem oficial.
- OG (`og:type`, `og:title`, `og:description`, `og:url`, `og:image`, `og:locale=pt_BR`), Twitter Cards e imagem própria otimizada, usando assets reais ou produzidos/fornecidos apropriadamente.
- Uma tag H1 semântica, headings hierárquicos, texto acessível, alt adequado, links descritivos.
- Metadados de `noindex` para autenticação e páginas internas não públicas quando apropriado, **sem impedir que robôs leiam o `noindex`**.

**Sugestões de títulos (validar pelo produto real):**

- `/`: `Evolutus | App para Registrar Treinos e Evolução`
- `/como-funciona`: `Como Funciona o Evolutus | Organize e Registre seus Treinos`
- `/para-empresas`: `Anuncie no Evolutus | Publicidade e Parcerias Fitness`
- `/vitrine`: `Vitrine Evolutus | Produtos e Marcas Parceiras`

**Domínio:** avaliar `evolutus.com.br` versus `www.evolutus.com.br` em produção e escolher **um único canônico**; evitar encadeamento de redirects; preservar antigo domínio `treinosacademia-ten.vercel.app` e deep links existentes. Sem suposições de DNS sem medição.

### 8.3 Sitemap, robots e erros HTTP

- Criar `robots.txt` e `sitemap.xml` públicos, coerentes com domínio escolhido, estáveis e atualizados automaticamente no build ou por geração idempotente.
- Sitemap somente com URLs canônicas indexáveis e acessíveis; **não incluir** login, dashboard, admin, perfis privados, buscas/parametrizações ou páginas suspensas.
- Para páginas que devem sair do índice, usar `noindex` adequadamente (não bloquear a leitura da diretiva com `Disallow`). `robots.txt` **não é controle de segurança**.
- Testar URLs inexistentes e produtos removidos: HTTP 404/410 quando aplicável, sem servir 200 genérico de SPA. Não quebrar deep links válidos das rotas React. Caso exista limitação arquitetural, implementar solução de status por borda/roteamento para URLs públicas e documentar limites restantes; não reportar “404 resolvido” apenas porque o componente mostra “página não encontrada”.
- Revisar regras de `vercel.json`, preservar cabeçalhos de segurança (CSP, `nosniff`, XFO, Referrer Policy, Permissions Policy), cache correto de HTML vs assets e exceções necessárias para pré-renderização.

### 8.4 Dados estruturados (Schema.org)

- JSON-LD **somente com informações verificáveis**, por exemplo `Organization`/`WebSite` e `SoftwareApplication` se os atributos exigidos forem conhecidos.
- Não inventar `aggregateRating`, avaliações, preços, planos, informações de contato, número de usuários ou funcionalidades.
- `Product` apenas quando detalhes públicos, ofertas e dados exibidos forem reais e válidos; evitar dados de comerciante falso e interpretações de checkout próprio.
- Validar sintaxe e correspondência entre dados estruturados e conteúdo visível.

### 8.5 Google e mensuração

- Deixar código preparado para Google Search Console e Bing Webmaster Tools (verificação via config/variável e sem valores fictícios), e orientar submissão do sitemap.
- Manter Vercel Analytics e Speed Insights existentes; medir funil **orgânico → CTA → cadastro**, usando eventos não sensíveis, sem e-mail, nome, histórico de treino ou dados privados.
- URLs externas patrocinadas com `rel="sponsored"` (e `noopener noreferrer` quando aplicável).
- Preferir conteúdo original e útil a múltiplas páginas vazias, duplicadas ou criadas apenas para palavras-chave.

### 8.6 Referências oficiais a seguir

- Google Search Essentials: https://developers.google.com/search/docs/essentials
- SEO para JavaScript: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- Metadados, title e snippet: https://developers.google.com/search/docs/appearance/title-link e https://developers.google.com/search/docs/appearance/snippet
- Canonicals: https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- Sitemaps: https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview
- Robots: https://developers.google.com/search/docs/crawling-indexing/robots/intro
- Rel sponsored: https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links
- Core Web Vitals: https://web.dev/articles/vitals
- Schema.org: https://schema.org/

## 9. Design, mobile, acessibilidade e performance

- Utilizar identidade Evolutus, logo e componentes atuais; manter consistência entre desktop/mobile e com o sistema autenticado. Visual moderno, confiável, fitness, limpo e sem aparência de template genérico.
- Navegação responsiva e acessível: menu por teclado, foco visível, `aria` correto, `skip link`, contraste AA, labels reais, erros do formulário anunciados a leitores de tela, respeito a `prefers-reduced-motion`.
- Conteúdo principal acima da dobra, CTAs evidentes; botões reais com destinos reais.
- Evitar pacotes pesados de animação, sliders, bibliotecas SEO redundantes e carregamento desnecessário de Supabase/área privada nas páginas comerciais.
- Carregar CSS e JS mínimos, usar code splitting, imagens AVIF/WebP quando disponíveis, `srcset/sizes`, dimensões explícitas, `fetchpriority` na imagem LCP correta, `lazy` abaixo da dobra.
- **Metas de campo (75º percentil):** LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1. Não alegar que foram atingidas sem medir.
- Não comprometer performance do cold start offline ou estabilidade de componentes de treino. Respeitar sistema de tema claro/escuro existente.

## 10. Segurança e privacidade (obrigatório)

- Nenhum conteúdo privado de treino, perfil, saúde, faturamento ou administração no HTML pré-renderizado ou endpoints públicos.
- No Supabase: RLS ativada, leitura pública apenas de campanhas/produtos aprovados e vigentes, escrita administrativa protegida no **servidor**, nunca somente pelo UI. Nunca enviar service-role key ao cliente.
- Sanitizar conteúdo comercial, validar URLs e mídia, tratar XSS, abusos de upload, spam e reenvio de formulários.
- Identificar anúncios como publicidade, manter regras existentes de moderação e configurações de métricas.
- Não repassar dados pessoais dos usuários a parceiros. Se houver tracking, limitar ao necessário, tratar privacidade/LGPD e **não introduzir identificadores sensíveis**.
- Não modificar checkout InfinitePay, regras financeiras, EvoCash, autenticação, termos legais ou rotinas de exclusão de contas fora do necessário.
- Não publicar informações comerciais imaginárias (preços, métricas de audiência, contratos, WhatsApp, e-mails).

## 11. Testes automatizados e homologação

Criar testes direcionados e usar a suíte existente. **Critérios de aceite obrigatórios:**

### SEO e HTTP

- `curl` sem JavaScript em `/`, `/como-funciona`, `/para-empresas` e `/vitrine`: HTML com conteúdo da página, H1, title, meta description, canonical e OG corretos.
- Sitemap e robots válidos, status 200 e URLs corretas.
- Canonical único, redirecionamento do host alternativo, sem loops; verificar HTTP real.
- URL pública inexistente retorna HTTP 404, não apenas tela de erro com 200; URL interna válida continua acessível por recarga direta.
- Auth/admin fora do sitemap e com política de indexação correta.
- Dados estruturados parseáveis; não conter campos inventados.

### Fluxo do produto

- Visitante acessa homepage → Como funciona → Cadastro/Login sem autenticação obrigatória para conteúdo público.
- Usuário autenticado entra no dashboard por `/app`; login/cadastro/retorno continuam funcionando.
- Testar deep links existentes, guarda de termos, perfis suspensos/excluindo, logout, perfil incompleto e rotas admin.
- PWA instalado e offline: atualização, abertura fria, `/app`, treino, histórico, recursos precacheados, service worker, push e sincronização continuam operando conforme comportamento anterior.
- Formulário comercial persiste lead real; falhas mostram erro; lead não pode ser consultado por visitante e só admin acessa o painel.
- Vitrine exibe apenas produtos aprovados, links seguros e aviso de compra externa; cards patrocinados identificados; anúncios existentes continuam funcionando.
- Navegação mobile (larguras estreitas e desktop), teclado/leitor de tela, imagem/carregamento/layout estável.

### Comandos e evidências

Executar, conforme scripts do projeto:

```bash
npm run lint
npm test
npm run build
npm run budget
npm run release:offline-check
```

Executar testes adicionais já existentes e pertinentes (funções, PWA/browser smoke, navegação e SEO); não declarar aprovação de um comando que não foi executado ou que falhou. Incluir teste do HTML **gerado e servido**, não somente DOM após hidratação. Se o ambiente não permitir testes de navegador, reportar explicitamente e fornecer roteiro de homologação manual.

## 12. Entregáveis e relatório final

1. Código implementado com componentes organizados, sem duplicações comerciais desnecessárias.
2. Novas páginas públicas acessíveis, responsivas, com conteúdo real e CTAs funcionais.
3. SEO técnico auditável com pré-renderização/HTML inicial específico, metadados, sitemap, robots, canonical, OG e política de indexação.
4. Leads comerciais persistidos com proteção e acesso administrativo.
5. Vitrine pública de produtos e manutenção da publicidade já existente; nenhuma integração de checkout própria.
6. Migrations reversíveis/seguras, quando realmente necessárias; documentação de variáveis e configuração.
7. Testes e resultados documentados, incluindo regressões de autenticação, PWA/offline e segurança.
8. Relatório sucinto em Markdown contendo:
   - arquivos alterados e motivo;
   - arquitetura escolhida (e por que não exige migração do app inteiro);
   - rotas públicas/indexáveis e privadas/não indexáveis;
   - compatibilidade com anúncios/vitrines preexistentes;
   - comandos executados e resultados reais;
   - validações de HTTP/SEO e telas mobile/desktop;
   - pendências externas para produção (Search Console, verificação de domínio, canal de contato etc.);
   - riscos conhecidos e **passos objetivos de rollback**.

**Não fazer deploy, push forçado, aplicar migrations em produção ou trocar DNS automaticamente.** Preparar uma entrega revisável, apta a homologação, e solicitar aprovação antes da publicação.

## 13. Regras de decisão para evitar retrabalho

- **Reaproveitar > recriar.** Principalmente anúncios, métricas, moderação, design system e vitrines de profissionais.
- **Funcionar > simular.** Nenhum formulário ou CTA com comportamento fictício.
- **HTML real > SEO só no navegador.** Pré-renderização pública é condição de aceite.
- **Privacidade > indexação.** Só páginas verdadeiramente públicas entram no índice.
- **Pequenas mudanças, testes frequentes.** Implementar em etapas coerentes e validar antes da próxima.
- **Sem sobreengenharia.** Nada de migrar stack, substituir autenticação ou criar plataforma de anúncios paralela.
- **Não inventar conteúdo.** Onde faltarem dados comerciais reais, usar texto institucional honesto e estado vazio.
- **Não interromper para perguntar detalhes não bloqueantes.** Tomar decisões técnicas seguras e justificadas. Perguntar apenas se faltar algo indispensável (por exemplo, destino oficial de contato que não possa ser obtido no projeto).

**Execute a implementação completa dentro do escopo acima, não apenas um protótipo visual.**
