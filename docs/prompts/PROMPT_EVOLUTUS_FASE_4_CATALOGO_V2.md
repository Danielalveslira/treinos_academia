# EVOLUTUS — Fase 4: Redesign completo do Catálogo Evolutus (mobile-first)

## Papel e objetivo

Atue como engenheiro sênior responsável por React, UX, acessibilidade, performance, integração Supabase e qualidade do Evolutus. **Implemente integralmente a Fase 4**, usando o código mais recente da `main` como fonte de verdade, sem criar um catálogo paralelo e sem reimplementar funcionalidades já existentes.

O objetivo é transformar a experiência de consulta do **Catálogo Evolutus** em uma biblioteca de exercícios gratuita, atraente, objetiva e fácil de explorar. O usuário deve conseguir **descobrir, pesquisar, visualizar a execução e adicionar exercícios oficiais à sua biblioteca**, com o mínimo de atrito, tanto no celular quanto no desktop.

**Mobile-first é requisito de arquitetura e de aceite, não apenas ajuste final de CSS.** Use componentes, tokens, padrões e convenções existentes do **GitHub Primer**. Respeite light/dark mode. Evite CSS hardcoded, `!important`, componentes visuais redundantes e dependências desnecessárias.

## 1. Contexto do projeto e limites da fase

As mudanças das fases anteriores já estão na `main` e em produção:

- **PR #70 — Fases 1+2:** painel `/admin/exercicios`, gestão de rascunhos, publicação, revisão, imagens START/END e retirada segura de exercícios.
- **PR #71:** correção da rota direta do painel administrativo.
- **PR #72 — Fase 3:** usuário comum seleciona somente exercícios oficiais; criação personalizada removida; biblioteca, histórico, treinos e registros legados preservados; segurança e validações aplicadas no Supabase.

O projeto possui atualmente:

- `src/components/ExerciseCatalog.jsx` — tela atual, busca, quatro filtros, listagem, detalhes e ação de adicionar.
- `src/pages/Exercises.jsx` — biblioteca pessoal e abertura do catálogo.
- `src/hooks/useExerciseCatalogSearch.js` — paginação (20 itens), debounce (400 ms) e proteção contra respostas obsoletas.
- `src/hooks/useExerciseCatalogTaxonomy.js` — opções de filtros a partir dos dados oficiais.
- `src/services/exerciseCatalogService.js` — busca, taxonomia, detalhe e URLs de imagens publicadas.
- `src/components/ExerciseCatalogImage.jsx` — imagens lazy, fallback e estados sem imagem.
- `src/components/WorkoutExerciseGuide.jsx` — demonstrações e instruções durante o treino.
- `src/components/CatalogOfflineStatus.jsx` e `src/services/offline/catalogSnapshot.js` — interface e fluxo **atual** de preparação offline completa.
- `src/utils/exerciseCatalog.js` — mapeamentos de origem, grupos musculares e textos.
- `src/styles/app.css` — estilos atuais de `.exercise-catalog`, `.catalog-*` e responsividade.
- RPC `search_exercise_catalog` — pesquisa server-side, filtros e paginação. Confirmar a definição **vigente** no histórico de migrations antes de alterá-la.

**Não** altere o ciclo de vida administrativo, as RLS, a criação de treinos, a lógica financeira, o histórico ou a segurança das Fases 1–3. **Não implemente agora a Fase 5** (cache seletivo, download de imagens em lote, sincronização incremental, alteração de service worker ou novas políticas de quota). A Fase 6 será a auditoria integrada posterior; esta fase ainda exige testes próprios completos.

## 2. Diagnóstico inicial objetivo

Antes de editar, leia os componentes, hooks, estilos, migrations e testes reais relacionados ao catálogo, inclusive os últimos commits mesclados. Identifique dependências e preserve contratos existentes.

**Problemas concretos que a implementação deve resolver:**

1. **Tela vazia na primeira abertura:** `useExerciseCatalogSearch` define `noQueryIntent` para pesquisa e filtros vazios, então nenhum exercício é apresentado até o usuário interagir.
2. **Baixa valorização do conteúdo:** visual atual é muito orientado a formulários, com pouca hierarquia e miniaturas de 72 px.
3. **Filtros excessivamente expostos:** quatro seletores simultâneos e texto explicativo ocupam grande área, especialmente no celular.
4. **Hierarquia de navegação confusa:** a biblioteca pessoal e o catálogo oficial se confundem na mesma página, inclusive nos títulos.
5. **Bloco offline dominante:** `CatalogOfflineStatus` ocupa espaço acima dos resultados e destaca um download de catálogo completo, quando o objetivo principal da tela é explorar exercícios.
6. **Detalhe interrompe a exploração:** abrir um exercício substitui a lista inteira; é preciso melhorar retorno aos resultados, preservação de filtros e posição.
7. **Paginação potencialmente instável:** confirmar desempate determinístico na ordenação da RPC (por exemplo, `name` + `id`) para evitar repetição ou omissão entre páginas quando nomes se repetem.
8. **Estados de dados pouco claros:** carregar, offline parcial, ausência de imagens, resultado vazio, erro e exercício já adicionado precisam ser distintos e compreensíveis.

Não se limite a alterar espaçamentos: **reorganize a experiência efetivamente**.

## 3. Nova estrutura visual e de navegação

### 3.1 Cabeçalho e identidade

- Deixe clara a separação entre **“Meus exercícios”** (biblioteca pessoal) e **“Explorar catálogo”** (conteúdo oficial).
- Na experiência do catálogo, use título **“Catálogo Evolutus”**, descrição curta orientada a valor (exercícios oficiais gratuitos, instruções e demonstrações) e ação visível de retorno **“Meus exercícios”**.
- Evite repetir o cabeçalho grande de “Exercícios / Sua biblioteca” como se a pessoa ainda estivesse na listagem pessoal. Ajuste a composição em `Exercises.jsx` e/ou `ExerciseCatalog.jsx`, mantendo as rotas e o retorno contextual existentes.
- Não crie banners grandes de marketing, carrosséis pesados, estatísticas fictícias nem CTAs duplicados. O conteúdo deve aparecer rapidamente na dobra inicial, sobretudo no mobile.

### 3.2 Catálogo preenchido ao abrir — sem baixar tudo

- Ao abrir o catálogo online, **mostre automaticamente a primeira página** de exercícios publicados, mesmo com busca e filtros vazios.
- Utilize a RPC de busca e o mecanismo de paginação existentes. Carregue **até 20 resultados por página**; não recupere todo o catálogo para simular a vitrine.
- Garanta que a ordem seja estável/determinística. Se a RPC vigente não tiver desempate suficiente, faça somente a migration mínima necessária, aditiva e testada, preservando parâmetros, retorno, permissões e demais consumidores.
- Mantenha “Carregar mais” ou estratégia paginada equivalente, com controle claro de carregamento, sem requisições duplicadas, saltos de posição ou itens repetidos.
- Ao limpar busca/filtros, volte imediatamente à listagem inicial. Durante alterações rápidas nos filtros, impeça que respostas antigas sobrescrevam a consulta mais recente — inclusive ao voltar ao estado de busca vazia.
- Trate resultados vindos de cache offline como **parciais** quando for o caso. Nunca informe que o catálogo foi integralmente consultado se o cache contém apenas parte dele.

### 3.3 Busca e filtros intuitivos

- Coloque a **busca por nome** no topo da área de descoberta, com ícone, label acessível e botão de limpar quando houver texto.
- Preserve a busca no servidor, debounce e proteção contra consultas excessivas. Pesquisas textuais curtas devem ter tratamento compreensível; retornar ao campo vazio deve restaurar a descoberta inicial.
- Logo abaixo, mostre um conjunto compacto de **atalhos para grupos musculares** (por exemplo, Todos, Peito, Costas, Pernas, Braços), mas **somente quando representarem corretamente os valores e filtros suportados pela taxonomia real**. Não invente grupos que a RPC não reconhece; o atalho “Braços”, caso usado, precisa mapear formalmente os músculos corretos ou ser substituído por opções reais.
- Preserve todos os filtros atuais (músculo, equipamento, categoria e nível), colocando os menos usados em **“Mais filtros”** com controle expansível responsivo; informe filtros ativos e ofereça ação “Limpar filtros”.
- Os atalhos e filtros avançados devem usar o **mesmo estado de consulta**, sem lógicas concorrentes ou inconsistentes. Atualize total, cartões e paginação quando qualquer filtro mudar.
- Retire a explicação longa sobre músculo principal/secundário da área principal. Se necessária, use ajuda contextual curta e acessível.
- Não renderize um filtro se a taxonomia real não possuir opções válidas; não exponha slugs técnicos ao usuário (reutilize `formatCatalogLabel`).

### 3.4 Cards: conteúdo em primeiro plano

Cada card deve priorizar:

1. **Imagem oficial publicada** (thumbnail preferencial; fallback START quando aplicável), com dimensões estáveis para evitar layout shift.
2. **Nome do exercício**, com até duas linhas legíveis e sem cortar informações importantes de forma arbitrária.
3. **Grupo muscular principal** e, em segundo nível, equipamento ou categoria (evite sobrecarregar com quatro metadados na lista).
4. **Ação objetiva de adicionar à biblioteca** e indicação inequívoca de **“Já adicionado”**.

Regras:

- Nunca gere nem busque fotos genéricas para substituir exercícios sem imagem. Use um **placeholder elegante e neutro**, com ícone/identidade do grupo quando pertinente. Imagem ausente não é erro de publicação nem motivo para esconder o exercício.
- O indicador “Com demonstração” ou equivalente só pode aparecer quando houver mídia oficial adequada. Não inferir START/END completos a partir da existência de uma única thumbnail.
- Mantenha lazy-loading de imagens, `decoding="async"`, proporção estável e fallback existente; evite carregar START e END de todos os resultados antecipadamente.
- Destaque exercícios já adicionados sem poluição visual, mantendo o botão desabilitado ou em estado coerente. Preserve identidade por `provider` + `provider_exercise_id` (e o ID oficial quando aplicável), evitando colisões entre origens.
- Ação de adicionar deve ser protegida contra cliques concorrentes/duplicados, com feedback claro de sucesso/erro e sem quebrar o estado da lista.
- Use densidade adequada: **mobile em uma coluna legível**, tablet em duas e desktop com grade adaptativa de duas ou três, conforme espaço real. Nenhum card pode causar rolagem horizontal.

### 3.5 Visualização detalhada do exercício

- Melhore o detalhamento para que o usuário veja claramente **nome, músculos, equipamento, categoria, nível, imagens START e END e instruções passo a passo**, apenas quando disponíveis.
- Considere reutilizar o **Dialog/overlay padrão do Primer já adotado no app**: no desktop, painel confortável; no celular, layout de leitura com rolagem apropriada. Se outro padrão existente for melhor, mantenha consistência com o projeto.
- Preserve resultado, termo, filtros, paginação e posição da listagem ao fechar o detalhe; não force uma nova pesquisa nem devolva o usuário ao início.
- O botão principal “Adicionar aos meus exercícios” deve funcionar também dentro do detalhe, refletindo imediatamente o estado do card.
- START e END devem ser identificados corretamente; quando só parte das imagens existir, não finja um par completo. Sem imagens: layout textual correto, sem espaços vazios excessivos.
- Evite criar outro serviço para buscar o mesmo exercício; use os dados da listagem e busque detalhe adicional sob demanda quando realmente necessário.
- Preserve o guia de execução de treino (`WorkoutExerciseGuide`) e a navegação para exercícios da biblioteca pessoal.

## 4. Mobile-first, acessibilidade e performance

### Mobile-first obrigatório

- Desenvolva e valide primeiro em **320, 360, 390 e 430 px**; depois 768, 1024, 1280 e 1440 px.
- Busca e filtros devem caber na largura disponível; botões precisam ter área de toque confortável; sem texto microscópico, overflow horizontal ou modais fora da viewport.
- Evite cabeçalhos enormes e barras de filtros de quatro colunas no celular. A listagem de exercícios deve aparecer cedo na rolagem.
- Respeite `safe-area-inset-*`, teclado virtual, scroll, tema claro/escuro e estados com textos longos.

### Acessibilidade

- Use componentes Primer com foco visível, rótulos semânticos, nome acessível dos botões, estados `aria-*` quando necessários e teclado funcional.
- Ao abrir detalhes, mova o foco corretamente, implemente Escape/retorno e restauração de foco ao elemento de origem; evite criar armadilhas de foco incorretas.
- Anuncie status de carregamento/erro/sucesso sem excessos de `aria-live` e sem anúncios a cada tecla.
- Não use apenas cor para informar “adicionado”, mídia disponível ou estado de carregamento.
- Garanta navegação e ações com teclado, leitor de tela e contraste baseado nos tokens Primer.

### Performance e qualidade técnica

- Preserve o **limite de página server-side** e lazy-loading; não faça preload integral de imagens, nem download de catálogo completo na montagem.
- Reutilize `useExerciseCatalogSearch`, `useExerciseCatalogTaxonomy`, `exerciseCatalogService` e `ExerciseCatalogImage` sempre que possível; extraia componentes pequenos apenas se reduzirem complexidade.
- Evite N+1, dupla consulta de taxonomia, re-renderizações caras, requisições sobrepostas e queries desnecessárias.
- Garanta chaves estáveis e estado correto ao navegar entre páginas, abrir detalhes, alterar filtros e retornar à biblioteca.
- Remova CSS antigo somente após migrar os consumidores; sem `!important`, cores fixas, valores arbitrários repetidos ou componentes duplicados. Prefira componentes e tokens GitHub Primer.
- Não introduza novas bibliotecas de componentes ou dependências pesadas.

## 5. Offline nesta fase: apenas reorganizar a interface

**A Fase 5 tratará da nova arquitetura offline seletiva.** Aqui:

- Reposicione `CatalogOfflineStatus` em uma seção secundária, compacta e acessível, como **“Uso offline”** expansível. Não deixe download dominar o primeiro contato com o catálogo.
- Preserve as funcionalidades atuais e seus estados de progresso, cancelamento, erro e atualização. Não as remova silenciosamente.
- Seja transparente: o botão atual de preparar catálogo ainda **baixa o catálogo completo**. Não renomeie isso como “baixar só meus exercícios” enquanto a implementação permanecer integral.
- Não inicie downloads automaticamente, não modifique `catalogSnapshot.js`, `service-worker.js`, IndexedDB, Cache Storage ou estratégia de atualização nesta fase, salvo correção pontual inevitável para regressão causada pelo redesign (documentar e testar).
- Estados de navegação offline já suportados devem continuar funcionando. Se o cache for parcial, comunique isso corretamente.

## 6. Segurança e compatibilidade

- Mostrar exclusivamente exercícios oficiais publicados e permitidos pelas regras vigentes. Não exponha drafts, itens em revisão ou retirados em novas buscas.
- Preserve validação server-side, RLS, sessão ativa, origem real dos exercícios, bloqueio de inserções pessoais e retirada de itens inseguros.
- Preservar o fluxo de inclusão na biblioteca, exercício já adicionado, treinos, histórico, exercícios antigos e preferências pessoais conforme Fase 3.
- Nenhuma mudança destrutiva de tabelas, dados ou migrations antigas. Qualquer migration necessária para ordenação deve ser incremental e incluir teste SQL.
- Não criar novas rotas administrativas, serviços paralelos de cadastro ou esquemas de armazenamento só para resolver UI.

## 7. Testes e critérios de aceite

Implemente/atualize testes automatizados e **execute de verdade** os controles aplicáveis:

1. Abertura do catálogo sem pesquisa/filtros retorna automaticamente a primeira página de publicados, nunca o catálogo inteiro.
2. Busca, limpeza, debounce, filtros simples/avançados e paginação funcionam juntos; respostas antigas não sobrescrevem buscas recentes.
3. `Carregar mais` não duplica itens nem perde resultados por ordenação ambígua; confira inclusive nomes iguais e alterações de filtros durante uma requisição.
4. Cards mostram miniatura correta, placeholders coerentes e estado já adicionado; um clique repetido não gera duplicatas.
5. Detalhe mostra START/END, instruções e informações disponíveis; funciona sem imagem, com só uma imagem e com imagens completas.
6. Fechamento de detalhe restaura foco, filtros, posição e resultados; verificar teclado e navegação de retorno.
7. Usuário consegue adicionar exercício à biblioteca e depois registrar treino normalmente; nenhum caminho de criação pessoal retorna.
8. Exercício retirado/não publicado não é oferecido em novas buscas e não é tratado como disponível indevidamente.
9. Biblioteca legada, histórico e preferências seguem funcionando; offline completo **não** começa automaticamente.
10. Validação real em navegador nas larguras 320/360/390/430/768/1280, light/dark, sem overflow, com screenshot de evidência quando possível. Não substituir tudo por mocks se for viável conferir integração real.
11. Testar loading, rede indisponível, cache local parcial, falha de imagem, nenhum resultado e falhas ao adicionar.
12. Se houver alteração de RPC: executar pgTAP de regressão de ordenação/paginação, permissões e publicação.

**Comandos mínimos:**

```bash
npm test
npm run lint
npm run build
```

Execute também os testes de navegador existentes ou acrescente smoke específico da Fase 4, e os testes SQL/funcionais se tocar no banco. CI do GitHub deve continuar bloqueando merge em caso de falha. Não use `|| true`, não ignore exceções e não declare testes aprovados sem resultados observados.

## 8. Entrega esperada

1. Faça as mudanças diretamente no repositório atualizado, em branch/PR próprio da **Fase 4**, sem retrabalho das Fases 1–3.
2. Entregue a experiência pronta, não apenas plano, wireframe ou recomendações.
3. Atualize documentação mínima com o comportamento final, as decisões de UX e quaisquer limitações conhecidas.
4. Abra/atualize PR com resumo dos arquivos alterados, before/after da interface, riscos, evidências de testes, resultado do CI e pendências reais.
5. **Não aplique migrations em produção nem faça deploy de produção automaticamente nesta rodada.** A autorização de publicação virá após revisão do PR.
6. **Não avance para a Fase 5**. Apenas preserve a compatibilidade para que o offline seletivo possa ser implementado depois.

### Definição de concluído

A primeira visita ao catálogo **já mostra exercícios oficiais**; a interface é visualmente clara, atraente e realmente **mobile-first**; pesquisa e filtros são simples e eficientes; as imagens oficiais são valorizadas sem prejudicar exercícios ainda sem foto; o detalhe é fácil de abrir e fechar; adicionar à biblioteca é seguro; paginação, acessibilidade, offline existente e histórico não regridem; o CI comprova a qualidade da entrega.

**Implemente agora sem outra rodada de planejamento nem solicitações de confirmação.** Se encontrar divergência entre este prompt e a versão atual da `main`, dê prioridade ao código e às regras de segurança vigentes, documente a divergência e adapte a implementação sem expandir o escopo.
