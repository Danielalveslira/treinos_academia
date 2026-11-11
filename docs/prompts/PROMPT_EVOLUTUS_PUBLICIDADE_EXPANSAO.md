# EVOLUTUS — Auditoria, correção e expansão do sistema de publicidade

## Papel e objetivo

Atue como engenheiro sênior full-stack, com foco em React, Supabase/PostgreSQL, segurança, desempenho e experiência mobile-first.

**Implemente uma melhoria completa e criteriosa do sistema de publicidade existente**, preservando o que já funciona. O objetivo é ter anúncios **leves, justos, confiáveis, pouco invasivos e simples de contratar e acompanhar**.

**Prioridade absoluta: simplicidade para duas pessoas diferentes:**

1. **Usuário do aplicativo:** deve conseguir treinar e acompanhar seu progresso sem que anúncios atrapalhem.
2. **Cliente anunciante:** deve conseguir criar, contratar e acompanhar um anúncio sem entender inventário, capacidade, reservas, métricas técnicas ou regras internas.

Não reescreva o sistema do zero. Não crie um painel excessivo, dezenas de opções, modais encadeados nem novas abstrações sem necessidade. Toda complexidade deve ficar no backend, enquanto a interface apresenta apenas decisões relevantes.

## Contexto técnico real

Use o código atual como fonte da verdade. Investigue especialmente:

- `src/components/advertising/CreateAdWizard.jsx`
- `src/components/advertising/AdStatusCard.jsx`
- `src/components/AdvertisingCentral.jsx`
- `src/components/AdvertisingAdmin.jsx`
- `src/components/SponsoredAdBanner.jsx`
- `src/hooks/useAdvertisingSelection.js`
- `src/hooks/useGlobalSponsoredAds.js`
- `src/hooks/useSponsoredAds.js`
- `src/hooks/useAdMetrics.js`
- `src/services/advertisingService.js`
- `src/services/sponsoredAdsService.js`
- `src/utils/placementLabels.js`
- `src/pages/Progress.jsx`
- `src/features/adMetrics/`
- `supabase/migrations/` (especialmente migrations de inventário, campanhas, seleção, entrega, autorizações e métricas)
- `supabase/tests/` e testes JS relacionados.

Os posicionamentos atuais incluem `home_banner`, `community_banner` e `community_feed`. Existe também a escolha de pacote `network`, que é expandida para posicionamentos reais no servidor. O banner da Home já permite amostrar e rotacionar até quatro anúncios sem consultar o banco a cada troca. Respeite esse trabalho existente.

**Cuidado:** `/progresso` ainda não é um posicionamento publicitário. Ele precisa ser criado de ponta a ponta. Não reaproveite `home_banner` de maneira que campanhas antigas sejam exibidas automaticamente em uma rota que não contrataram.

## 1. Primeiro: auditoria antes das mudanças

Mapeie e valide o fluxo completo:

**Criação → aprovação → contratação em EvoCash → reserva de capacidade → autorização → seleção → exibição → métricas → vencimento/suspensão/arquivamento.**

Confira o comportamento real do código, do SQL e dos testes, não somente os documentos. Identifique defeitos confirmados, riscos de concorrência e cálculos incorretos. Preserve compatibilidade com contratos, anúncios, dados financeiros e relatórios existentes.

Não faça refatorações cosméticas sem benefício mensurável. Corrija os problemas identificados abaixo e os adicionais que comprovar na análise.

## 2. Confiabilidade, justiça e desempenho

### 2.1. Exibição e autorização

- Confirme e corrija a aplicação de `delivery_enabled` em **todas** as seleções pertinentes, inclusive anúncios legados sem `commercial_resource_id`. Desativar um espaço deve bloquear sua entrega conforme a política administrativa, independentemente da origem do anúncio.
- Respeite `sales_enabled` como controle separado de novas contratações. Desativar vendas não deve, por si só, cancelar veiculações já autorizadas.
- Garanta que somente anúncios efetivamente elegíveis sejam entregues: aprovação, permissão do contexto, contrato/reserva, período vigente e demais regras aplicáveis.
- Mantenha a validação crítica no PostgreSQL/RPC/RLS. Não confie em filtros do frontend como fronteira de segurança.
- Preserve a invalidação de autorização, os prazos de lease, expiração e a política segura em caso de erro ou indisponibilidade. Nunca exiba um anúncio expirado como fallback.
- Garanta que mudanças administrativas relevantes interrompam a veiculação dentro da janela autorizada, sem consultas frenéticas.
- Trate explicitamente cenários de bloqueio, estorno, suspensão, retomada e exclusão do proprietário.

### 2.2. Distribuição justa

A seleção atual usa aleatoriedade. Ela pode produzir sequências desiguais; isso **não significa** que todos os contratos recebam impressões iguais.

- Defina e documente uma regra simples de justiça por **posicionamento e contexto**, sem presumir garantias de visualização que o produto não vende.
- Prefira oportunidades de exibição equilibradas entre campanhas igualmente elegíveis; não introduza pesos comerciais ou preferência por campanhas internas sem política explícita.
- Separe claramente anúncios legados/institucionais de campanhas pagas na análise. Se houver disputa de inventário, adote uma regra explícita, não uma vantagem implícita.
- Não utilize impressões não coletadas ou inconsistentes para calcular compensações, direitos financeiros ou suposta entrega garantida.
- Evite consultas pesadas, `ORDER BY random()` indiscriminado em conjuntos crescentes, contadores atualizados a cada renderização ou gravação por troca de banner. Avalie o volume real e escolha a solução mais simples que escale.
- Preserve a rotação local quando apropriado; trocar o anúncio **não pode gerar nova consulta ao banco**.
- Não invente métricas ou mostre um contador de anúncios como se representasse todas as campanhas elegíveis quando apenas uma amostra foi carregada.

### 2.3. Carregamento e economia de recursos

- Evite requisições simultâneas/redundantes ao montar a página, retornar o foco, reabrir a aba, recuperar Realtime ou revalidar a autorização. Consolide eventos próximos com deduplicação/controle de concorrência.
- Preserve limpeza de timers, listeners, subscriptions e requests obsoletos.
- Pause rotação/animação quando o banner estiver fora da viewport ou a aba estiver oculta; use `IntersectionObserver` quando adequado, com tratamento seguro de compatibilidade.
- Preserve `prefers-reduced-motion`, controle por toque/foco/teclado e navegação acessível.
- Evite layout shift: altura reservada, largura responsiva e texto truncado/rolável de modo acessível.
- Carregue publicidade sem bloquear o conteúdo principal. Se não houver anúncio, **não deixe um espaço vazio**.
- Não dependa de polling contínuo nem de carregamento antecipado de todos os anúncios do sistema.

### 2.4. Métricas confiáveis

- Revise as flags existentes de coleta, a autorização para registrar eventos e o pipeline de impressões/cliques.
- Uma impressão deve representar a exposição visível real segundo o critério já adotado pelo projeto; não contabilize apenas renderizações, mudanças rápidas do carrossel ou anúncios fora de tela.
- Evite duplicações por remount, foco, troca de aba e eventos simultâneos, respeitando a semântica já definida para cada métrica.
- Preserve o consentimento e as configurações de privacidade. Nunca ative coleta opcional silenciosamente.
- Mostre estado **“Dados ainda não disponíveis”** quando não houver coleta confiável; nunca preencha com zero como se fosse uma medição completa.
- Continue usando processamento agregado e consultas sob demanda para relatórios, sem piorar a performance das páginas do usuário.

## 3. Nova publicidade na rota `/progresso`

### 3.1. Novo posicionamento

Criar `progress_banner` como posicionamento independente, com:

- Registro no inventário SQL, nome legível e descrição clara.
- Contexto global apropriado, mesmo que a superfície atual seja chamada `home` no banco. **Revise com cuidado as checagens de superfície e contexto da RPC**, pois não basta inserir uma nova linha: a seleção existente pode aceitar somente `home` e `community`.
- Capacidade, limite de exibição, `sales_enabled`, `delivery_enabled`, precificação/configuração comercial e autorização administrativa compatíveis.
- Suporte a criação de campanha, aprovação, reserva, pagamento, seleção, RLS, métricas, relatórios, auditoria e rótulos da interface.
- Compatibilidade com a estrutura de pacotes `network`, mas **sem incluir `progress_banner` automaticamente em pacotes já contratados ou snapshots históricos**.
- Migração incremental, reversibilidade operacional e nenhuma alteração destrutiva de dados existentes.

Inicialmente, deixe a disponibilização comercial controlável pela administração. Não comece a vender o novo espaço antes de a cadeia completa de seleção, autorização e relatórios estar validada.

### 3.2. Posição e aparência

Em `src/pages/Progress.jsx`, inserir **apenas um banner compacto**, preferencialmente **entre o gráfico de evolução e a seção “Atividade por fichas”**.

Requisitos:

- Visual consistente com o design system, claro/escuro, responsivo e mobile-first.
- Identificação visível de **“Patrocinado”**.
- Altura reduzida, sem animações chamativas, sem modal, overlay, pop-up ou vídeo automático.
- Nenhuma sobreposição a gráficos, ações, métricas, histórico, fotos ou dados corporais.
- Respeitar contexto offline, carregamento, erro e ausência de anúncios, sem prejudicar a página.
- Não usar dados individuais de saúde, peso, composição corporal, desempenho ou exercícios para segmentar anúncios.
- Reaproveitar o componente e hook existentes onde fizer sentido; generalizá-los com cuidado, sem duplicação por rota.
- Rotação, se houver mais de um anúncio elegível, apenas no espaço já destinado ao banner; não renderizar vários anúncios empilhados.

**Nesta entrega, não implementar anúncios novos em `/exercicios`, `/historico` ou durante treinos.** Deixe o sistema preparado para expandir futuramente por configuração explícita, sem criar uma arquitetura genérica excessiva agora.

## 4. Experiência do cliente anunciante: extremamente simples

A experiência externa deve ser menos complexa que a estrutura interna do sistema.

### Criação do anúncio

Aproveite o assistente existente. Mantenha no máximo as quatro etapas atuais **ou reduza somente se isso realmente simplificar sem comprometer revisão e transparência**:

1. **Onde aparecer:** cartões objetivos, por exemplo “Página inicial”, “Progresso”, “Comunidade” e “Feed da comunidade”, somente quando elegíveis para aquela conta. Sem códigos técnicos.
2. **Seu anúncio:** título, texto curto, destino HTTPS e imagem quando aplicável. Validação imediata, mensagens simples e prévia coerente com o formato real.
3. **Duração:** escolha clara em dias, com preço válido apresentado pelo servidor quando houver cotação aplicável. Nunca calcular saldo/preço financeiro crítico exclusivamente no cliente.
4. **Revisar e enviar:** resumo curto de local, conteúdo e duração; informar expressamente que **enviar para análise é gratuito** e que a cobrança/uso de EvoCash acontece na contratação autorizada após aprovação.

Não adicione escolhas de capacidade, política de rotação, distribuição, métricas técnicas ou qualquer opção administrativa ao cliente.

Para “Vários espaços do Evolutus” (`network`): se for oferecido, mostrar **quais posicionamentos estão incluídos naquela oferta e suas condições** com informação real e atualizada; se a API não permitir informação segura, não afirmar posições específicas nem incentivar contratação às cegas. Evite que o cliente descubra restrições somente por erro ao final.

### Meus anúncios

Manter a página enxuta:

- Nome e local do anúncio.
- **Um status claro** por campanha (por exemplo: Rascunho, Em análise, Aguardando contratação, Programado, Ativo, Pausado ou Encerrado), mapeado corretamente do backend.
- Duração restante, período contratado e próxima ação relevante quando existirem.
- **Uma ação principal por situação.** Detalhes, histórico e informações avançadas ficam recolhidos.
- Justificativas de reprovação e problemas de pagamento em português simples e com orientação útil.
- Métricas resumidas apenas se confiáveis e disponíveis. Relatórios detalhados somente sob demanda.
- Continuar evitando cobranças automáticas, renovação implícita, propagandas silenciosamente expandidas e alterações retroativas de direitos contratados.

Nenhuma alteração deve criar novas telas desnecessárias ou obrigar o cliente a entender o fluxo interno de moderação/comercial.

## 5. Experiência de administração

- Mostrar `progress_banner` na gestão existente de **Espaços de anúncio**, sem criar mais uma seção administrativa.
- Manter os controles independentes de **Aceitar contratações** e **Permitir exibição**.
- Mostrar capacidade, status e disponibilidade real; proteger contra redução de capacidade abaixo de compromissos vigentes.
- Preservar auditoria de mudanças críticas, justificativa, reautenticação e controle de concorrência/revisão quando existentes.
- Não misturar aprovação editorial com configuração de espaços. Preservar a fila unificada de Aprovações.
- Definir procedimento operacional para interrupções administrativas de campanhas pagas: identificar contratos afetados e exibir evidências à administração, **sem gerar reembolso automático ou alteração financeira sem regra aprovada**.

## 6. Segurança, manutenção e compatibilidade

- Seguir arquitetura, padrões de componentes, permissões e estilo já utilizados no projeto.
- Alterar migrations de forma **aditiva**: não editar migrations já aplicadas em produção.
- Garantir RLS, `SECURITY DEFINER` com `search_path` seguro, grants explícitos e validação de parâmetros em RPCs novas ou alteradas.
- Validar HTTPS, URLs permitidas, conteúdo e mídias no servidor; prevenir redirecionamentos inseguros e exposição de recursos privados.
- Garantir idempotência de criação/contratação e consistência transacional de reserva, cobrança, saldo, ledger e entitlement.
- Não apagar histórico, campanhas, contratos, impressões, pagamentos, EvoCash ou anúncios antigos.
- Não trocar o mecanismo financeiro existente, não inventar preços nem introduzir dependências pesadas sem justificativa.
- Preservar anúncios de comunidades dentro de suas permissões; não transformar anúncios específicos de comunidade em anúncios globais.
- Não incluir espaços novos automaticamente em compras ou pacotes antigos.
- Não introduzir segmentação por atributos sensíveis ou dados pessoais de treino/saúde.

## 7. Testes obrigatórios e critérios de aceite

Inclua testes de regressão e novos cenários relevantes, preferindo a infraestrutura de testes já existente.

**Banco / regras comerciais**

- `progress_banner` criado, selecionável somente nos contextos permitidos e bloqueado quando administrativamente desativado.
- Anúncios legados e campanhas pagas respeitam a regra de exibição.
- Campanha sem contrato válido, fora do período, suspensa, expirada ou sem autorização não aparece.
- Uma campanha de Home não ganha automaticamente direito de aparecer em Progresso, e vice-versa.
- Pacotes/contratos históricos permanecem imutáveis.
- Limite de capacidade e reservas concorrentes não permitem venda excedente.
- Failsafes e permissões resistem a tentativas diretas de RPC por usuários sem direito.
- Fluxos de interrupção, reversão/estorno e renovação preservam consistência de dados financeiros.

**Frontend / experiência**

- `/progresso` mostra no máximo **um bloco de publicidade**, posicionado sem interromper o conteúdo.
- Rotação não consulta o banco por troca de campanha e não continua fora da viewport.
- Sem anúncio, a página mantém o fluxo normal sem placeholder vazio.
- Foco, retorno à aba, Realtime e remount não disparam chamadas redundantes desnecessárias.
- Criação, revisão, contratação e acompanhamento são utilizáveis em telas móveis pequenas, teclado e leitores de tela.
- Ausência de métricas não produz números falsos.
- Temas claro e escuro, estados de erro/offline, loading, data de expiração e texto longo funcionam corretamente.

Execute, conforme aplicável:

- Testes unitários de serviços, hooks, componentes e estados.
- Testes SQL reais contra PostgreSQL/Supabase, principalmente concorrência e autorização.
- Lint, build e orçamento de bundle.
- Smoke test mobile e desktop dos fluxos de anunciante, usuário final e administrador.

Se alguma validação não puder rodar no ambiente, **diga exatamente qual e por quê**; não trate teste não executado como aprovado. Não acrescente testes redundantes ou ferramentas novas sem necessidade.

## 8. Estratégia de execução e entrega

Organize a implementação em etapas coesas:

1. **Correções da entrega atual:** segurança/visibilidade dos legados, distribuição, revalidações e métricas.
2. **Base comercial de `progress_banner`:** SQL, RPCs, autorização, reservas, preços/configuração, permissões e testes.
3. **Interface de `/progresso`:** único banner discreto, com integração ao pipeline compartilhado.
4. **Simplificação do anunciante e integração administrativa:** rótulos, escolhas claras, status, detalhes e relatórios sob demanda.
5. **Homologação final:** testes, regressão, desempenho e documentação objetiva.

Use branch nova a partir de `main` atualizada e commits/PRs compreensíveis. Não misture mudanças paralelas de fichas, treinos, comunidades ou finanças não relacionadas.

**Não faça deploy em produção, não aplique migrations no banco remoto e não promova domínio sem autorização explícita.** Prepare a migração e o plano de publicação com ordem correta, conferência do ambiente Supabase de destino e possibilidade de desligar o novo espaço por configuração caso haja problema.

### Resposta esperada ao concluir

Seja breve e objetiva. Informe:

1. O que foi corrigido no sistema atual.
2. Como a distribuição e a segurança ficaram garantidas (e as limitações que ainda existirem).
3. Como `/progresso` ficou visualmente e comercialmente.
4. O que mudou para simplificar a vida do anunciante.
5. Testes realmente executados, resultados e pendências.
6. PRs/commits e instruções estritamente necessárias para a publicação.

**Critério principal de sucesso:** publicidade sustentável para o negócio, confiável para quem paga e praticamente imperceptível para quem está usando o Evolutus para treinar. Simplicidade na interface; rigor no backend.
