# EVOLUTUS — Auditoria de Segurança, Privacidade, Performance e Redesign Mobile-First do Gerenciamento de Contas

> **Papel:** atue como engenheiro de software sênior, arquiteto de aplicações React/Supabase, especialista em segurança defensiva, privacidade de dados e UX de painéis administrativos.
>
> **Missão:** auditar e aperfeiçoar **a página administrativa de Contas** do Evolutus, com implementação real, testes automatizados e evidências. Priorizar **proteção de dados pessoais**, **controle de acesso**, **simplicidade**, **velocidade**, **legibilidade** e **uso em celular**. **Não publicar nem alterar produção sem autorização expressa.**

## 0. Contexto obrigatório — conheça o projeto antes de editar

O Evolutus é uma aplicação React com componentes **Primer**, Supabase/PostgreSQL, autenticação Supabase, RLS, RPCs, módulos administrativos, financeiro, moderação e exclusão de contas. Não presumir Firestore/Firebase Database. A tela atual contém:

- Navegação administrativa; título **Contas** e atualização manual com hora da última sincronização.
- Cinco indicadores: **Total de contas**, **Ativas**, **Suspensas**, **Novas em 7 dias** e **Exclusões pendentes**.
- Pesquisa por **@usuário, e-mail ou UID**; filtros **Status, Papel, Último uso, Comunidade, Financeiro**; seleção de colunas; exportação CSV.
- Abas **Todas as contas**, **Exclusões pendentes**, **Moderação / risco**, **Logs administrativos**.
- Tabela com seleção, ordenação, paginação e ações; painel lateral de conta com **Visão geral, Comunidades, Financeiro e Auditoria**.
- Operações administrativas de ativar/desativar, ações em lote e solicitação de exclusão.

**Problemas observáveis na captura:** densidade visual excessiva, tipografia e alvos pequenos, tabela competindo com o painel lateral, rolagem horizontal, muitos controles no mesmo nível e baixa adaptabilidade esperada a celulares. A captura **não comprova vulnerabilidade**; não rotular como falha de segurança sem reproduzir evidência.

Em uma **cópia do repositório anteriormente fornecida**, a implementação estava aproximadamente organizada assim (confirme tudo no **HEAD atual**, que prevalece sobre esta lista):

```text
src/pages/AdminAccounts.jsx
src/features/adminAccounts/api/adminAccounts.api.js
src/features/adminAccounts/hooks/useAdminAccountsSnapshot.js
src/features/adminAccounts/hooks/useAccountDetails.js
src/features/adminAccounts/components/
  AccountsMetrics.jsx
  AccountsToolbar.jsx
  AccountsTable.jsx
  AccountDrawer.jsx
  BulkActionsBar.jsx
  AccountDialogs.jsx
  AuditLogList.jsx
src/features/adminAccounts/utils/accounts.js
src/features/adminAccounts/utils/snapshotStore.js
src/components/SuperAdminRoute.jsx
src/hooks/useAdminAccountDeletions.js
src/services/adminAccountDeletionsService.js
supabase/migrations/20261010000001_admin_accounts_snapshot.sql
supabase/migrations/20261011000001_user_activity.sql
supabase/tests/admin_accounts_snapshot_test.sql
supabase/functions/_shared/superadminAuth.ts
```

A cópia examinada possuía `admin_accounts_snapshot` com **teto de 1.000 linhas e metadados `truncated`**, métricas agregadas, snapshot carregado **somente ao clicar em Atualizar**, filtros/ordenação/paginação inicialmente em memória, detalhes financeiros/comunidades/auditoria **sob demanda**, e operações por RPC. **Não presuma que o estado de produção ainda é idêntico.** Audite primeiro, preserve o que funciona e evite reinventar infraestrutura.

## 1. Princípios inegociáveis

1. **Segurança > integridade de dados > experiência > performance > estética.** Aparência jamais substitui autorização no backend.
2. **Privacidade por padrão.** Dados de e-mail, UID, finanças, histórico e exclusão só para funções legitimamente autorizadas; exposição mínima no frontend, exports, logs e erros.
3. **Mobile-first real:** projetar inicialmente para 320–430 px; depois tablet e desktop. Não entregar apenas tabela desktop com rolagem horizontal no celular.
4. **Simplicidade operacional:** preferir React, Primer, serviços e RPCs existentes. Não adicionar biblioteca de tabelas, store global, SDK ou endpoint sem justificar.
5. **Performance mensurável:** evitar N+1, consultas silenciosas, excesso de payload, renderização pesada e leituras sensíveis sem ação explícita.
6. **Compatibilidade funcional:** preservar filtros, pesquisa, ações, contagens, abas, logs, permissões, regras de exclusão, financeiro e comportamento de sincronização quando ainda adequado.
7. **Sem publicações automáticas:** nada de commit, push, deploy, migrations no Supabase de produção ou mudanças no Vercel sem autorização.
8. **Sem testes invasivos em produção:** não enumerar usuários reais, não contornar autenticação, não forçar endpoints, não realizar varreduras agressivas, não exportar dados reais, não disparar ações destrutivas. Testar segurança em ambiente **local/isolado** com dados fictícios e contas autorizadas. Se algo precisar de teste real, elaborar checklist manual e aguardar autorização específica.

## 2. Etapa A — Diagnóstico profundo, antes de implementar

Mapear, com caminhos, trechos e fluxo de dados:

- Entrada na rota administrativa e verificação de papel no frontend e no banco.
- RPCs e funções que leem ou modificam contas; permissões de `EXECUTE`, `SECURITY DEFINER`, `search_path`, RLS, grants e uso de `auth.uid()`.
- Origem de **cada campo** da tabela, dos KPIs e do painel lateral. Identificar PII e informações financeiras.
- Ciclo de vida do snapshot, cache, botão Atualizar, falhas, estados obsoletos e mudanças após uma ação administrativa.
- Acesso sob demanda ao detalhe, logs, financeiro, comunidades e exclusões.
- Ordem e segurança das operações em lote e individuais, suas confirmações, auditorias e possibilidades de corrida.
- Dependência das funções de conta com moderação, retenção, casos financeiros, exclusão e outros módulos.
- UX atual em desktop/tablet/mobile, teclado, leitor de tela e diferentes temas.
- Tamanho do bundle, payload real do snapshot, número de RPCs, renderizações, pontos lentos e queries caras.

Produzir **diagnóstico com evidências**, separando claramente:

- **Defeito comprovado** — arquivo/linha/teste ou reprodução local.
- **Risco plausível a validar** — hipótese, sem afirmar que houve vazamento.
- **Melhoria de UX/performance** — justificativa e benefício.
- **Comportamento intencional a preservar** — não alterar só por preferência estética.

Classificar prioridades **P0 / P1 / P2 / P3** por severidade, impacto e esforço. Se detectar exposição grave, **não explorar produção**: documentar minimamente, proteger evidências, propor correção e bloquear rollout até revisão.

## 3. Etapa B — Auditoria defensiva de segurança (mentalidade adversarial, execução controlada)

Aplique OWASP ASVS / OWASP API Security, princípio do menor privilégio e **deny by default**. Use testes unitários, de integração e SQL sobre banco de teste local com usuários fictícios. **Não criar scripts para invadir o ambiente público.**

### B1. Autenticação e autorização

- Confirmar que não basta esconder a rota, botão ou aba; o backend deve validar **toda** leitura e **toda** escrita.
- Testar matriz de papéis: **anônimo**, **membro comum**, **administrador/moderador quando existir**, **superadmin**, **sessão expirada**, **usuário desativado**. Não inventar papéis; mapear os reais.
- Verificar acesso direto às RPCs e dados por identificador de outra conta, inclusive os painéis Financeiro, Comunidades, Auditoria, Logs e Exportar.
- Verificar segurança por **objeto** e **campo** (não só permissão de função); nenhum usuário comum pode obter dados privados de outra conta apenas informando UID.
- Revisar `GRANT/REVOKE` de funções/tabelas, RLS, views e `SECURITY DEFINER`; minimizar privilégios e empregar referências a objetos com schema controlado.
- Proibir `service_role`, chaves secretas ou tokens privilegiados no bundle/frontend.
- Não confiar em `user_metadata`, valores de cliente, query params ou UI como fonte isolada de privilégio; autorização deve usar fonte confiável do servidor.
- Confirmar que ninguém altera seu próprio papel ou promove usuário por operações genéricas de perfil.
- Garantir que requisições/seleções tardias após logout ou troca de conta não mostrem detalhes privados de outra sessão.

### B2. Integridade das operações sensíveis

- **Desativar / reativar:** validar alvo, motivo, papel do alvo, restrições, estados de exclusão, resultados e auditoria; impedir auto-bloqueio acidental do superadmin e alterações indevidas de contas protegidas.
- **Operações em lote:** validar limites no servidor, IDs duplicados, resultados parciais, concorrência, motivo obrigatório, ações repetidas e proteção contra operação inadvertida.
- **Exclusão de contas:** jamais criar fluxo paralelo que burle `queue_deletion`, jobs, casos financeiros, revisão, retenção legal/contábil ou bloqueios existentes. Respeitar preservação de caso financeiro pendente e políticas de retenção já implementadas; não apagar dados de terceiros.
- **Financeiro:** somente leitura conforme permissão existente. Nunca permitir alteração de saldo, compra, disputa ou registro pela simples manipulação da interface.
- **Auditoria:** manter trilha persistente para ações relevantes, com ator, alvo, operação, instante, resultado e motivo adequado; evitar duplicatas, permitir fiscalização e impedir alteração/apagamento por clientes.
- Implementar validações, transações/locks e idempotência **quando comprovadamente necessários**, evitando duplicar mecanismos já existentes.

### B3. Privacidade e superfície de dados

- Inventariar dados pessoais enviados no snapshot e em cada aba; verificar necessidade real de e-mail completo/UID/financeiro em massa.
- Avaliar mascaramento ou visualização sob demanda para dados menos necessários, **sem prejudicar tarefas legítimas de suporte**.
- Evitar PII em URL, mensagens de erro, console, analytics, logs genéricos, `localStorage`, `sessionStorage`, cache persistente e relatórios de teste.
- Não armazenar dados da listagem de usuários de forma persistente no navegador; invalidar dados sensíveis ao sair do painel ou trocar sessão.
- Conferir acessos indevidos por alteração de identificadores em requisições **apenas em ambiente isolado**, usando contas fictícias e testes negativos.
- Aplicar regras existentes de retenção e LGPD; **não definir unilateralmente prazos jurídicos** para novos logs ou relatórios.

### B4. Busca, filtros e exportação CSV

- Sanitizar/validar entradas e limites no backend; assegurar que filtros e ordenações não produzam consultas arbitrárias nem vazamento.
- Revisar exportação CSV para **formula injection**, escape correto, codificação UTF-8, campos permitidos, consistência com filtros e autorização.
- Deixar explícito se a exportação representa **página atual**, **seleção**, **lista filtrada** ou **todos os resultados autorizados**, evitando a falsa impressão de completude quando o snapshot é truncado.
- Evitar exportar dados financeiros ou pessoais não exigidos; examinar auditabilidade de exportações sensíveis antes de acrescentá-la.
- Não baixar automaticamente arquivos com dados pessoais nem compartilhá-los por logs ou integrações externas.

### B5. Resiliência

- Tratar sessão expirada, conexão instável, RPC indisponível, resposta malformada, atraso, duplo clique e retorno fora de ordem.
- Confirmações não devem assumir êxito antes de resposta/validação do backend.
- Nunca mostrar sucesso falso ao falhar uma operação em lote.
- Evitar revelação de SQL, nomes de tabelas, stacktrace, e-mails ou IDs em mensagens públicas; manter erros administrativos úteis e sanitizados.
- Usar fixtures sintéticas para testar permissões, paginação, filtros, concorrência e casos de borda.

## 4. Etapa C — Redesign visual premium e mobile-first

### C1. Direção de design

Adotar identidade existente do Evolutus (tema claro/escuro, cores, tipografia, componentes Primer, estados e espaçamentos). Objetivo: painel **minimalista, legível, responsivo, sofisticado e profissional**, sem efeitos chamativos, cards gigantes, gradientes gratuitos ou excesso de contornos.

**Hierarquia proposta:**

1. Título **Contas**, descrição concisa e **Atualizar** com informação visível de quando os dados foram sincronizados.
2. KPIs compactos e legíveis; no celular, grade 2 colunas ou outra organização que conserve a hierarquia; números e rótulos claramente associados.
3. Busca em destaque; botão **Filtros** que revela controles num painel compacto/expandível no celular; filtros ativos identificáveis e ação **Limpar**.
4. Abas de contexto claramente distintas; navegação horizontal acessível quando necessário.
5. Listagem priorizando **identidade, status, última atividade e ação**; restante no detalhe.
6. Painel de conta de leitura confortável, sem esmagar a tabela.

### C2. Comportamentos responsivos

**320–430 px (mobile):**

- **Não encolher a tabela desktop.** Usar lista de **cards/linhas responsivas compactas**, com @usuário, status, e-mail tratado com privacidade, último uso e ação claramente alcançável.
- Seleção para lote acessível sem confundir com abrir detalhes; diferenciar ações de alto risco.
- Abrir informações em **drawer de largura total / tela modal responsiva** com cabeçalho e ação de fechar; rolagem interna correta e foco gerenciado.
- Filtros em gaveta/painel colapsável; priorizar busca e status visível. Não forçar menu horizontal de cinco filtros sempre aberto.
- Evitar rolagem horizontal da página. Respeitar safe areas e eventual navegação inferior fixa do app; os controles não devem ficar encobertos.

**Tablet (aprox. 600–1023 px):**

- Usar lista/tabela simplificada e drawer sobreposto; não reservar painel lateral permanente se prejudicar a leitura.
- Mostrar progressivamente mais colunas conforme a largura disponível.

**Desktop (1024 px ou conforme breakpoints existentes):**

- Tabela com colunas essenciais amplas, cabeçalhos claros, indicação de ordenação e destaque de linha selecionada.
- Painel lateral flexível **somente quando houver espaço suficiente**; caso contrário drawer overlay. Não manter divisão rígida que causa rolagem horizontal como na captura.
- Menu de colunas opcional e controles de ações secundárias compactos.

**Acessibilidade:** foco visível, sem foco encoberto, contraste de texto/estado, labels e avisos de screen reader, navegação por teclado, gestão de foco em drawer/modal, ESC quando adequado, áreas de toque confortáveis (preferencialmente cerca de 44 px para alvos móveis sem aumentar visualmente todos os botões), estados de loading/erro/vazio e respeito a movimento reduzido. Trabalhar com WCAG 2.2 AA como referência.

### C3. Detalhe da conta

- **Visão geral:** hierarquia em pares rótulo/valor com quebra de linha correta; copiar e-mail/UID apenas com interação voluntária e feedback acessível; não expor longos identificadores como protagonista visual.
- **Comunidades / Financeiro / Auditoria:** carregamento somente na aba aberta; manter separação visual e permissões.
- Ações potencialmente irreversíveis com **confirmação contextual**, explicação de consequências e identificação inequívoca da conta.
- Mantenha abas, ações e informações já existentes — sem remover funcionalidades por facilidade de CSS.

### C4. Interações e estados

- Não perder seleção, ordenação e filtros desnecessariamente ao abrir/fechar detalhes.
- Ao mudar filtros/página, atualizar estado de seleção de maneira previsível. Nunca aplicar ação em usuário invisível/fora do escopo sem confirmação clara.
- Diferenciar **última sincronização com o servidor** de alterações locais posteriores; não informar tempo real se os dados são snapshot.
- Mensagens curtas, sem jargão técnico nem poluição visual.
- Tratar corretamente **zero resultados**, snapshot vazio, erro de carga, filtro sem resultado, lista truncada e operação parcialmente concluída.

## 5. Etapa D — Performance e escalabilidade sem sobrearquitetura

**Preserve a estratégia econômica atual** (snapshot em memória, refresh consciente, detalhes sob demanda) **enquanto ela atender ao volume e às necessidades do produto**. Não introduzir polling ou Realtime automaticamente.

Auditar e otimizar:

- Se o limite **1.000 contas** ainda existe, garantir que `truncated` seja mostrado corretamente e que a busca/exportação não prometam abrangência inexistente. Planejar paginação e filtros **no servidor** quando o crescimento exigir, com contagens consistentes.
- Não carregar dados financeiros, logs completos ou comunidades para todas as contas na listagem.
- Se implementar paginação backend, definir contrato de busca/ordenação consistente, desempate estável, limites rígidos, indexação apropriada e estratégia para seleção entre páginas; manter contadores agregados corretos.
- Não criar índice ou materialized view só por hábito: demonstrar benefício com plano de consulta e volume sintético representativo.
- Evitar N+1 RPCs, serialização de dados desnecessários e re-renderizações em cada digitação.
- Medir antes/depois: **bundle gzip**, número de RPCs (montagem, refresh, filtros, drawer, aba e ação), tamanho do payload, interação, CPU/renderização, uso de memória e overflow em larguras-alvo.
- Manter code splitting/lazy-loading quando existente e justificável; não instalar bibliotecas grandes para tabela/drawer que o Primer cobre.
- Cancelar/ignorar respostas tardias ao trocar conta, atualizar snapshot, fechar drawer ou desmontar tela.
- Evitar cache persistente de informações administrativas; cache de memória somente por sessão/montagem e com invalidação segura.
- Não alegar Lighthouse, LCP, CLS ou tempo de produção sem medição real. Não criar SLO arbitrário sem baseline; apresentar variação medida e regressões.

## 6. Etapa E — Testes obrigatórios com dados fictícios

Criar ou atualizar testes no padrão do repositório. Sempre usar ambiente local/isolado **e não atacar produção**:

**Segurança / SQL / autorização**

- Matriz de acesso por papel e sessão, inclusive acesso direto a RPC sem passar pela interface.
- Acesso negado a leitura, exportação e escrita por papéis não autorizados; testes de autorização por UID de outro usuário fictício.
- Usuário com conta desativada; tentativas de operação em superadmin; casos pendentes de exclusão/financeiro.
- Bulk operations com duplicados, concorrência, resultados parciais, reenvio e idempotência.
- Preservação do log administrativo; limites de entrada, texto não confiável e CSV com células potencialmente interpretáveis como fórmulas.
- Verificação de RLS, grants, `SECURITY DEFINER`, privilégios de `EXECUTE` e `search_path`; sem segredos nos assets do frontend.

**UI / UX**

- Capturas com React/CSS reais em **320, 375, 390, 430, 768, 1024 e 1366 px**, temas claro e escuro.
- Sem overflow horizontal global; drawer/modal e filtros acessíveis; layout correto com barra inferior fixa.
- Busca, filtros combinados, ordenar, paginação, seleção e operação individual/lote.
- Aba financeiro/comunidades/auditoria sob demanda e sem requisições redundantes.
- Loading, vazio, erro, dados obsoletos, retorno tardio, logout e troca de conta.
- Teclado, foco, leitores de tela onde disponível, contrastes e alvos tocáveis.

**Performance**

- Comparar antes/depois com fixtures de **7, 100, 1.000 e volume acima do limite atual** (apenas dados fictícios).
- Demonstrar contagem de RPCs e payload; verificar ausência de consulta em loop/polling e ausência de vazamento de estado.
- `npm test`, testes de funções/SQL aplicáveis, lint, build, budget e `git diff --check`, de acordo com scripts realmente disponíveis.
- Reportar falhas preexistentes com evidência comparativa; não mascará-las nem alterar módulos não relacionados sem motivo.

## 7. Migrações, segurança da publicação e rollback

- Dar preferência a correções **sem migration** quando suficientes. Se mudar contratos SQL/RLS, usar migration **nova, versionada, mínima, idempotente onde aplicável**, com autorização explícita antes de executá-la em produção.
- Não editar migration histórica já aplicada em produção; não usar `migration repair` como atalho.
- Para alterações SQL, documentar efeitos sobre outras páginas, funções e grants. Planejar ordem segura frontend/backend, compatibilidade temporária e rollback **operacional**.
- Não executar testes destrutivos, mudanças de papel, desativação, exclusão ou cargas elevadas no Supabase de produção.
- Se testes end-to-end dependerem de infraestrutura real, usar somente conta e dispositivo de teste autorizados, operações benignas e aprovação prévia.
- Antes de qualquer publicação futura, verificar **remote GitHub `Danielalveslira/treinos_academia`**, conta GitHub autenticada, branch, projeto Vercel associado e projeto Supabase correto. **Não assumir que a conta de terminal é o repositório de destino.**
- Nunca fazer commit, push, deploy ou executar migration só porque os testes passaram. Aguardar meu comando.

## 8. Critérios de aceite — nenhuma entrega apenas cosmética

A entrega é aceitável quando:

1. A aparência fica **premium, compacta, legível e alinhada à identidade Evolutus**, com experiência mobile realmente própria e desktop sem tabela apertada por drawer fixo.
2. Todos os recursos administrativos anteriores continuam funcionando, exceto mudanças conscientemente justificadas e documentadas.
3. As leituras e escritas são autorizadas **no backend**, com testes negativos e preservação de RLS/grants/auditoria.
4. Busca, filtros, paginação, seleção e CSV continuam **consistentes e completos dentro do escopo declarado**, especialmente se o snapshot for truncado.
5. Dados pessoais, financeiros e logs não vazam para usuários comuns nem para armazenamento/log desnecessário.
6. Operações perigosas exigem confirmação, são auditáveis e não ignoram estados legais/financeiros ou exclusões pendentes.
7. Sem polling, RPC redundante, regressão relevante de bundle, layout com overflow ou dependências pesadas sem razão.
8. Testes documentados, screenshots em múltiplas resoluções, métricas antes/depois, riscos residuais, rollback e evidências verificáveis.
9. **Nenhuma alteração publicada em produção sem autorização.**

## 9. Formato da resposta e artefatos esperados

### Ao iniciar

Apresente resumo **curto** do diagnóstico e plano de implementação, citando arquivos e riscos encontrados. **Depois implemente** os itens seguros e previstos, sem ficar parado apenas entregando sugestões. Se encontrar risco alto ou mudança incompatível, isole a alteração e solicite aprovação para essa parte.

### Ao concluir

Entregar:

1. **Resumo executivo**: o que melhorou e o que permaneceu intencionalmente igual.
2. **Antes/depois do layout**: evidências de desktop, tablet e mobile, tema claro/escuro.
3. **Relatório de segurança**: matriz com gravidade, achado comprovado/hipótese, evidência local, risco, correção, teste e risco residual. Não revelar segredos/PII reais.
4. **Mapa de arquivos alterados** e justificativa de cada alteração; migrations separadas se necessárias.
5. **Relatório de performance**: bytes gzip, RPCs, payload, responsividade e escalabilidade, com baseline e testes reproduzíveis.
6. **Relatório de testes**: números aprovados/falhos/ignorados, falhas preexistentes, limitações dos testes simulados.
7. **Plano de publicação e rollback**: ordem, pré-requisitos, compatibilidade e verificações pós-publicação **sem executar**.
8. **Pendências priorizadas**: apenas aquilo que realmente ficou por fazer.

Criar preferencialmente:

```text
docs/releases/ADMIN_CONTAS_REDESIGN_AUDITORIA.md
docs/releases/ADMIN_CONTAS_EVIDENCIAS.json
```

Não sobrescrever documentos de outras tarefas. Preserve mudanças locais preexistentes. Não afirmar que algo foi testado em produção quando a prova veio de fixture, navegador simulado ou PostgreSQL local.

## 10. Referências de engenharia a aplicar com senso crítico

- OWASP Authorization Cheat Sheet — *deny by default* e menor privilégio: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP API Security Top 10 — autorização por objeto, propriedade e função: https://api-security.owasp.org/editions/2023/en/0x11-t10/
- OWASP Logging Cheat Sheet — evitar PII/tokens/segredos nos logs: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- OWASP CSV Injection — proteger exports consumidos por planilhas: https://owasp.org/www-community/attacks/CSV_Injection
- Supabase — proteção de dados, RLS e chaves: https://supabase.com/docs/guides/database/secure-data
- Supabase — otimização SQL baseada em evidência: https://supabase.com/docs/guides/database/query-optimization
- Nielsen Norman Group — tarefas das tabelas: https://www.nngroup.com/articles/data-tables/
- Nielsen Norman Group — tabelas responsivas: https://www.nngroup.com/articles/mobile-tables/
- W3C WCAG 2.2 — foco, toque, contraste, navegação: https://www.w3.org/TR/WCAG22/

**Instrução final:** aja como responsável pelos dados dos usuários e pela manutenção de um SaaS real. **Primeiro entenda, depois prove, então implemente**. Quero uma página de Contas mais clara, agradável, rápida e segura — sem fragilizar o ecossistema Evolutus, sem complexidade gratuita e sem tocar em produção por conta própria.
