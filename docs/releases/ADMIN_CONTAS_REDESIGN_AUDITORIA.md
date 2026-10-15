# Contas — auditoria defensiva e redesign mobile-first

## Escopo e resultado

Implementação local sobre o HEAD `8e8bcc55bc111c33d907418db024a9285607030a`. O prompt foi lido integralmente. Nenhum commit, push, deploy, consulta de usuários reais ou migration remota foi executado. Mudanças locais anteriores em prompts e relatórios de imagens/push foram preservadas.

A tela agora usa lista própria abaixo de 768 px, tabela com colunas essenciais acima disso e detalhe sobreposto em todas as larguras. No celular o detalhe ocupa a tela; o Primer fornece foco, retorno de foco, Escape e rolagem interna. A navegação administrativa está em um menu compacto; busca, filtros e opções secundárias compartilham uma única linha. Os filtros ativos podem ser removidos individualmente. Os cinco indicadores compartilham um bloco: total em linha inteira e quatro métricas em grade 2×2 no celular, sem quinto card isolado. Busca, seleção, ordenação e paginação têm controles próprios na lista móvel. E-mails aparecem mascarados na lista e completos no detalhe voluntário e no CSV autorizado. O mascaramento é visual: não modifica o payload nem constitui autorização.

Snapshot manual, teto de 1.000 contas, métricas globais, filtros locais, colunas opcionais, abas, financeiro somente leitura, filas de exclusão e retenção foram preservados. Não há polling, Realtime, nova dependência ou índice. O cache pronto de detalhes é reutilizado até atualização/desmontagem; pedidos pendentes são invalidados ao fechar/trocar a conta. Mudar busca, filtros, aba, ordenação, página ou tamanho de página limpa a seleção; abrir/fechar detalhes a preserva. Atualizar e escrever ficam mutuamente bloqueados na interface.

## Diagnóstico anterior à implementação

| Prioridade / natureza | Evidência anterior | Impacto e decisão |
| --- | --- | --- |
| P1 — defeito comprovado | `set_account_status` lia status antes do lock. Duas conexões locais com um trigger de atraso geraram **2 logs de desativação para 1 transição**. | Corrigido com `FOR UPDATE` antes da validação e no-op real para reenvios. Nenhum teste em produção. |
| P1 — risco plausível | `admin_request_account_deletion` verificava existência antes de chamar a fila. Dois wrappers podiam observar inexistência simultaneamente. | Advisory lock transacional por alvo serializa existência/fila/auditoria; teste concorrente agora confirma 1 log. O worker e a fila não foram reescritos. |
| P1 — defeito de ciclo de vida / risco de privacidade | Store não invalidava refresh pendente na desmontagem; cache de detalhe tinha epoch global sem geração por chave; página não era identificada pela sessão. Não há evidência de vazamento real. | Sessão identificada por UID, limpeza do store, invalidação de callbacks e testes de resposta tardia/logout/troca de sessão. |
| P2 — defeito de integridade da UI | Resultado de lote vazio/incompleto era aceito e podia exibir “0 contas desativadas” como sucesso. | Resposta deve conter exatamente os alvos únicos, resultados booleanos e estados válidos; erro mantém o diálogo. |
| P2 — defeito de escopo | Seleção permanecia quando busca/filtros/página mudavam. | Limpeza previsível evita operar em contas fora da página/escopo. |
| P2 — melhoria de UX | Tabela desktop no celular, drawer sticky de 400 px concorrendo com a tabela, várias colunas padrão e controles sempre expostos. | Lista móvel, filtros recolhíveis, colunas essenciais e overlay. Todas as informações continuam no detalhe/seletor. |
| P2 — defesa adicional | CSV antigo só prefixava operadores no primeiro caractere. Espaço antes de fórmula e operadores Unicode não eram prefixados. A execução em Excel não foi demonstrada. | Prefixo preventivo para espaços/controles/operadores Unicode, preservando BOM/escape. Testes verificam bytes; não certificam todos os importadores. |
| P2 — privacidade | Capturas de erro bruto em `console.error` podiam registrar detalhes de uma resposta do banco. | Removidas nesta feature; UI usa mensagens conhecidas ou fallback genérico. Erros individuais do lote passam por allowlist no servidor. |
| P3 — intencional | Refresh manual, detalhes sob demanda, truncamento explícito, financial case/queue_deletion. | Mantidos. Não presumir atualização em tempo real nem completude além do snapshot. |

Não foi comprovada exposição P0 ou acesso de membro comum aos dados administrativos.

## Fluxo e inventário de dados

Entrada: `src/App.jsx` → `ProtectedRoute`/layout → `SuperAdminRoute` → `AdminAccounts`. `useAuth` lê o perfil do servidor; `profile.role` é o gate visual. A página adiciona escopo por `user.uid`. A autoridade real continua no PostgreSQL, por `auth.uid()` + `public.is_superadmin()` em **todas** as RPCs. Só existem os papéis `user` e `superadmin` no constraint do HEAD; administrador/moderador intermediário não foi inventado.

| Campos / painel | Origem confirmada no SQL | Sensibilidade / exposição |
| --- | --- | --- |
| UID, @usuário, papel, criação, versão legal, motivo de desativação | `public.users` | Dados pessoais e operacionais; em memória e autorizados. UID não é protagonista na lista nem tooltip. |
| E-mail e último login | `auth.users` | PII; e-mail mascarado visualmente na lista, disponível no detalhe/CSV. |
| Último uso | `public.user_activity`, migration `20261011000001_user_activity.sql` | Distingue uso de login; não inferir atividade do login. |
| Status e restrição | `users.account_status`, `account_restrictions.action/until`, jobs abertos | Precedência exclusão > desativação > suspensão > ativa preservada. |
| Comunidades, vitrine e flags | agregados de `community_members`, `professional_listings`, `moderation_decisions` | Snapshot sem N+1; não traz histórico completo. |
| Indicador financeiro | compra pendente, revisão financeira ou presença de saldo em `wallets` | Classificação; saldos e compras não entram no snapshot/CSV. |
| KPIs | CTE de todas as contas/status/jobs; criação nos últimos 7 dias | Agregados globais, mesmo quando a lista é truncada. |
| Comunidades no detalhe | `admin_account_communities`: associação + comunidade, até 100 | Somente ao abrir a seção. |
| Financeiro no detalhe | `admin_account_financial`: carteira, até 5 compras e referência de exclusão/caso | Somente leitura, sob demanda; mantém o fluxo de revisão no painel de exclusões. |
| Auditoria/logs | `admin_list_audit_log`, `admin_audit_log` + nomes de ator/alvo | 50 registros por conta, até 100 globais; motivos podem conter texto pessoal e exigem cuidado operacional. |

Snapshot: `admin_accounts_snapshot()` → API → store em memória → filtro/ordenação/paginação/CSV. Montagem faz **0 leituras desta feature**; cada Atualizar faz **1 RPC**. Falha conserva o snapshot anterior e avisa que está obsoleto. Mutação aplica resultado validado e ajusta KPIs sem refetch; horário de alteração local aparece separado da sincronização. Refresh limpa logs/cache/seleção. Desmontagem ou mudança de sessão elimina snapshot, detalhe e logs. A app pode executar suas leituras gerais de auth/termos/economia/atividade; a contagem da feature não atribui essas chamadas a Contas.

## Segurança, autorização e integridade

Referências aplicadas: [autorização OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [API Security](https://api-security.owasp.org/editions/2023/en/0x11-t10/), [logs](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html), [CSV](https://community.owasp.org/attacks/CSV_Injection) e [proteção de dados Supabase](https://supabase.com/docs/guides/database/secure-data). As provas são locais; não equivalem a certificação ASVS.

| Papel / estado | Snapshot / outro UID / financeiro / auditoria | Escrita individual / lote / exclusão | Prova e limite |
| --- | --- | --- | --- |
| Anônimo | Negado por EXECUTE | Negado por EXECUTE | pgTAP sob `SET ROLE anon`, SQLSTATE 42501; PUBLIC também sem EXECUTE. |
| Membro ativo | `PERMISSION_DENIED` | `PERMISSION_DENIED` | Sete funções chamadas diretamente sob `authenticated` e UID fictício. |
| Membro desativado | `PERMISSION_DENIED` | `PERMISSION_DENIED` | Mesma matriz com `account_status=disabled`. |
| Sem sessão/UID | `PERMISSION_DENIED` | `PERMISSION_DENIED` | Matriz com auth.uid nulo. Expiração criptográfica do JWT no GoTrue não foi testada por esse SQL. |
| Superadmin ativo | Permitido dentro dos contratos e limites | Permitido para alvos elegíveis | Fixtures; proteção de superadmin, conta em exclusão, limites e resultados parciais. |
| Superadmin como alvo | Leitura autorizada | Desativação/exclusão recusadas | Suites original/defensiva e `queue_deletion`. |

`admin_audit_log` mantém RLS sem policy de cliente; leitura direta autenticada retorna zero, updates/deletes/truncate são impedidos pelos mecanismos existentes. Clientes não têm UPDATE em `users`; a tentativa de promover papel por update genérico é recusada. RPCs de perfil usam campos permitidos, não `user_metadata` como fonte de papel. Leituras administrativas testadas são SECURITY DEFINER com `search_path=public, pg_temp`, referências de tabelas qualificadas e EXECUTE apenas para authenticated com checagem interna. A migration mantém essa configuração, incluindo o hardening posterior à migration original.

Migration nova: `20261103000001_admin_accounts_integrity.sql`, aplicada **somente** em `evolutus_aud_postgres` local. Recria quatro funções sem mudar suas assinaturas. Status bloqueia a linha antes de ler/validar, preserva motivo/instante no reenvio e audita somente transições. Lote usa ordem estável de UUIDs, deduplica, limita cardinalidade a 100, recusa nulos/múltiplas dimensões/ação nula e sanitiza erro inesperado. Auditoria recusa limite NULL, que antes equivalia a LIMIT sem teto. Exclusão serializa reenvios no wrapper e segue `queue_deletion`; nenhum prazo legal, caso financeiro ou worker foi modificado.

Reativação mantém o contrato anterior de motivo opcional e auditoria de transição; desativação/exclusão continuam exigindo 5–500 caracteres. A razão de preservar esse contrato é compatibilidade com outros consumidores de `set_account_status`. Exportação continua local, mediante clique, sobre lista filtrada ou seleção explicitamente identificada. Não foi criado endpoint/auditoria de exportação nem alegada autorização adicional no ato de download: a autoridade da leitura vem do snapshot e a sessão da tela controla a disponibilidade. Snapshot/CSV ainda contêm PII legitimamente disponível a superadmin. Nenhuma lista administrativa é persistida em storage; tokens/perfil do próprio usuário são parte da infraestrutura de auth existente.

Riscos residuais: `is_superadmin` verifica papel, sem vincular por si só `account_status`; o projeto protege administradores contra desativação pela UI e possui exceção administrativa em `has_app_access`. Desativação de superadmin via manutenção privilegiada exige política operacional de revogação de papel/sessão; essa regra global não foi redefinida. Advisory lock cobre chamadas pelo wrapper auditado; chamadas diretas à fila seguem as garantias da fila, sem prometer auditoria deste wrapper. O scan de assets procura JWT service_role, sb_secret e chaves privadas conhecidas, não todos os formatos possíveis de segredo.

## Layout, acessibilidade e evidências

[WCAG 2.2](https://www.w3.org/TR/WCAG22/) orientou foco/labels/alvos; [NN/g sobre tarefas de tabelas](https://www.nngroup.com/articles/data-tables/) e [tabelas móveis](https://www.nngroup.com/articles/mobile-tables/) orientaram hierarquia e divulgação progressiva. Não se declara certificação WCAG ou validação com leitor de tela físico.

Capturas de React/CSS reais, usando Chromium com todas as chamadas externas interceptadas, em **320, 360, 375, 390, 430, 768, 1024 e 1366 px**, claro/escuro: 28 principais antes e 32 principais depois; capturas adicionais mostram as quatro abas vazias e com dados longos em todas as larguras/temas. A contagem total está no JSON. Diretórios `admin-contas/before` e `admin-contas/after`; `results.json` registra larguras, overflow, erros e RPCs. As capturas de drawer posteriores usam viewport de 900 px para representar tela inteira, e as listas usam fullPage. Movimento reduzido/animations disabled evitam capturar o modal no meio da animação. Comparar também dimensões de viewport no JSON, sem interpretar alturas fullPage como viewport.

| Evidência | Antes | Depois |
| --- | --- | --- |
| Celular claro, lista | [320 px](admin-contas/before/320-light-list.png) | [320 px](admin-contas/after/320-light-list.png) |
| Celular escuro, detalhe | [390 px](admin-contas/before/390-dark-drawer.png) | [390 px](admin-contas/after/390-dark-drawer.png) |
| Tablet claro | [768 px](admin-contas/before/768-light-list.png) | [768 px](admin-contas/after/768-light-list.png) |
| Tablet escuro, detalhe | [768 px](admin-contas/before/768-dark-drawer.png) | [768 px](admin-contas/after/768-dark-drawer.png) |
| Desktop claro | [1366 px](admin-contas/before/1366-light-list.png) | [1366 px](admin-contas/after/1366-light-list.png) |
| Desktop escuro, detalhe | [1366 px](admin-contas/before/1366-dark-drawer.png) | [1366 px](admin-contas/after/1366-dark-drawer.png) |

A lista e o drawer têm verificações de overflow global. O modal possui checagem de foco, Tab, Escape, largura/altura móveis e hit testing para confirmar que a navegação fixa não o encobre. `accounts.css` eleva apenas a pilha de portais enquanto o detalhe está aberto; menus e confirmações aninhadas conservam a ordem do Primer. Busca, seleção, botões e paginação tiveram alvos ampliados; labels/cópia/erros têm nomes acessíveis e feedback. Temas mantêm tokens existentes e status textual. Contraste foi inspecionado visualmente; nenhuma razão numérica de contraste foi medida.

## Refinamentos visuais solicitados antes da conclusão

A primeira iteração funcional foi reavaliada criticamente no navegador. Foram removidos o botão “Ver” repetido em cada linha, a ordenação com controles sempre abertos, os cinco contornos dos indicadores, o quinto card isolado e a exportação competindo com a busca. O menu Administração reúne os cinco destinos; o menu de opções reúne CSV e colunas; filtros são recolhíveis com remoção individual. O contexto móvel usa seletor em português, evitando o overflow “More” do nav desktop. A tabela desktop mantém ordenação e colunas opcionais.

O detalhe recebeu uma segunda revisão completa: nome, papel e status aparecem uma única vez no cabeçalho; Identificação contém e-mail/UID com cópia e feedback local; Atividade reúne três datas; Situação organiza seis campos em duas colunas e mostra restrições/motivo quando existentes. Separadores discretos substituem cards. Gerenciar conta reúne ação comum e menu de ações secundárias. As confirmações e justificativas permanecem. Comunidades e auditoria mostram dez itens inicialmente e expansão local; financeiro separa saldos, revisão e cinco compras. Cabeçalho/ações/abas ficam fora do único scroller do Primer; mudar aba volta ao início do conteúdo. Não foram modificados RPCs, migrations, RLS ou contratos de dados durante esses refinamentos.

As quatro abas foram inspecionadas em claro/escuro, incluindo nomes/e-mails/versionamento legal extensos, restrição e motivo longo, doze comunidades/logs, cinco compras e caso financeiro. O browser testa expansão sem RPC, cópia com feedback, cabeçalho imóvel ao rolar, ausência de overflow interno e validação de CSV pelo menu secundário. As imagens `*-overview-long.png`, `*-overview-long-bottom.png`, `*-communities-long.png`, `*-financial-long.png`, `*-audit-long.png` e `*-empty.png` permitem revisar conteúdo e estados. Os dados são todos fictícios.

## Performance e escala

Dados detalhados e limites estão em `docs/releases/ADMIN_CONTAS_EVIDENCIAS.json` (consolidado via `scripts/build-admin-accounts-evidence.mjs` a partir dos arquivos abaixo, sem reexecutar SQL/browser), `admin-contas/assets.json`, `sql-performance.json` e `before/after/performance.json`.

Baseline: build do workspace antes das alterações, registrado em `/tmp/admin-contas-baseline-build.log`, e interface do HEAD reproduzida em cópia de `/tmp`. Comparação de JS usa gzip nível 9 nos dois lados; Vite usa seu compressor padrão e arredonda kB nos logs. O chunk Primer passou de aproximadamente 184,19 para 184,49 kB gzip no relatório Vite ao reutilizar mais componentes do próprio Primer; não houve nova biblioteca. A página permanece lazy. Budget de boot passou no orçamento já existente; não foi criado SLO novo. Todos os dados/contas de medição são sintéticos.

O payload simulado é igual antes/depois (3.122, 41.469, 413.401 e 413.400 bytes para 7, 100, 1.000 e 1.200 contas; acima do limite só 1.000 são retornadas). SQL real local mede também serialização real: 6.590 / 50.490 / 473.195 / 472.359 bytes. A carga real tem seis contas locais adicionais, por isso os totais são 13/106/1.006/1.206. EXPLAIN ANALYZE da RPC mediu aproximadamente 4,37/8,46/46,55/46,78 ms nesta execução local. Isso não é tempo de produção, HTTP ou plano interno de todas as CTEs. Não justifica adicionar índice/materialized view. [Otimização Supabase](https://supabase.com/docs/guides/database/query-optimization) recomenda medir planos antes de otimizar.

Medições antigas de desenvolvimento foram substituídas pelas medições finais de previews. Navegador registra tempo de refresh, TaskDuration, ScriptDuration, LayoutDuration, JSHeapUsedSize e nós DOM com CDP. As medições finais usam previews de builds locais comparáveis, sessão/HTTP simulados, uma sequência por volume e sem GC forçado; há aquecimento, ruído de CPU e memória não determinística. Não inferir Lighthouse/LCP/CLS, SLO ou latência de backend desses números. Renderização simultânea mobile/desktop foi detectada e eliminada usando `useResponsiveValue` já disponível no Primer. Paginação limita renderização a 8/25/50/100 linhas, independentemente do total no snapshot.

Chamadas da feature: montagem 0; Atualizar 1; busca/filtros/ordenação/página/seleção/overview/CSV 0; cada seção não carregada 1; reabrir seção pronta 0; ação individual/lote 1; logs 1 apenas ao solicitar. Após refresh, detalhe sem cache oferece carregar novamente; nenhuma consulta silenciosa foi acrescentada. Novos callbacks pendentes não reintroduzem dados de outra sessão/conta. Snapshot >1.000 continua limitado; alerta declara busca/filtro/CSV restritos. Paginação/filtros no servidor é evolução futura condicionada a volume/necessidade, não parte desta entrega.

## Validação e reprodução

Os comandos e contagens finais estão no JSON. Suíte JavaScript completa, funções, pgTAP, browser, build, budget, lint e diff foram executados. A primeira execução de `npm test` no sandbox falhou em `businessDate.test.js` por EPERM ao iniciar subprocesso, também no baseline; a repetição autorizada fora do sandbox passou. Lint mantém **14 avisos preexistentes, zero erros**. O aviso de chunk >500 kB no build já existia no baseline (Primer compartilhado).

```sh
npm test
npm run test:functions
npm run lint
npm run build
npm run budget
node scripts/verify-admin-accounts-assets.mjs
node scripts/verify-admin-accounts-browser.mjs http://127.0.0.1:55447 after
node scripts/verify-admin-accounts-browser.mjs http://127.0.0.1:55447 after performance
node scripts/verify-admin-accounts-concurrency.mjs
node scripts/verify-admin-accounts-performance.mjs
node scripts/build-admin-accounts-evidence.mjs
git diff --check
```

Scripts de banco aceitam somente o container local fixo e não recebem URL/credencial remota. Performance SQL faz rollback por volume. Concorrência cria contas example.invalid para sessões concorrentes e remove o trigger no finally; deixa as contas/logs sintéticos no banco local, preservando a imutabilidade da auditoria. O banco local precisa conter migrations do HEAD mais a nova migration; não executar scripts sobre produção. pgTAP é executado via `docker exec -i evolutus_aud_postgres psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < supabase/tests/<arquivo>.sql`; cada suíte faz rollback. Não basta exit code do psql: verificar ausência de `not ok`, `ERROR` e falhas pgTAP.

UI simulada cobre orçamento de leituras, busca/filtros/ordenação, seleção, ação individual/lote parcial, loading/erro/retorno tardio, sessão trocada/logout e contratos inválidos. Navegador usa o app real com backend interceptado; SQL usa PostgreSQL real local. Não houve E2E autenticado contra Supabase hospedado, teste de JWT expirado em GoTrue, screen reader físico ou validação no Excel. Não houve teste/publicação em produção.

## Arquivos e justificativas

| Arquivo/grupo | Mudança |
| --- | --- |
| `src/pages/AdminAccounts.jsx` | Sessão identificada, callbacks/logs tardios invalidados, seleção previsível, sync vs local, layout sem divisão rígida. |
| `components/AccountsTable.jsx` | Lista móvel própria, uma única árvore de listagem por largura, ordenação móvel, colunas essenciais, máscara e foco. |
| `components/AccountsToolbar.jsx`, `AccountsMetrics.jsx`, `BulkActionsBar.jsx` | Filtros recolhíveis, KPIs compactos, escopo do CSV, alvos de toque. |
| `components/AccountDrawer.jsx`, `accounts.css` | Modal Primer responsivo, foco/rolagem, safe areas, seções sob demanda e correção da pilha acima da navegação fixa. Painel final de 480 px no desktop, fullscreen móvel, grupos de identificação/atividade/situação, ações em área própria, cabeçalho/abas fixos e apenas a região de conteúdo rolável. |
| `hooks/useAdminAccountsSnapshot.js`, `useAccountDetails.js`, `utils/snapshotStore.js` | Limpeza de sessão/montagem, gerações de requests/cache e rejeição de snapshot inválido. |
| `api/adminAccounts.api.js`, `utils/accounts.js` | Validação de resultados/contratos, CSV defensivo e máscara visual. |
| Testes `AdminAccounts.test.js`, `adminAccounts.api.test.js`, `accounts.test.js`, `snapshotStore.test.js`, `noBackgroundReads.test.js` | Regressões de fluxo, lifecycle, contratos, CSV e guarda contra persistência/leitura silenciosa. |
| `supabase/migrations/20261103000001_admin_accounts_integrity.sql` | Locks, no-op de replay, limites (inclusive limite NULL dos logs) e erro sanitizado; migrations históricas preservadas. |
| `supabase/tests/admin_accounts_defensive_test.sql` | Matriz com roles reais, grants/RLS/paths, entradas inválidas e auditoria. |
| `scripts/verify-admin-accounts-{browser,concurrency,performance,assets}.mjs` | Evidências locais reproduzíveis, capturas, métricas e scan. |
| `scripts/build-admin-accounts-evidence.mjs` | Consolida os JSONs já gerados em `docs/releases/ADMIN_CONTAS_EVIDENCIAS.json`, sem repetir SQL/browser. |
| `docs/releases/ADMIN_CONTAS_*`, `docs/releases/admin-contas/` | Relatório, JSON consolidado, capturas e resultados locais sintéticos. |

## Publicação e rollback — plano, sem execução

1. Aguardar autorização expressa. Verificar remote `Danielalveslira/treinos_academia`, conta GitHub, branch, projeto Vercel e referência Supabase; conferir diferenças locais e separar documentos alheios. Nada disso foi presumido como autorização.
2. Homologar no projeto isolado, com snapshot de rollback das definições atuais de `set_account_status`, `admin_set_accounts_status`, `admin_request_account_deletion`, `admin_list_audit_log` e grants; confirmar `search_path` e schema do destino. Revisar a nova migration e sua ordenação depois de `20261102000002`.
3. Aplicar backend primeiro **quando autorizado**. Assinaturas/payloads e proteção de alvo permanecem compatíveis. No-op em reenvio preserva evidência anterior; arrays/ações inválidas passam a ser recusados e erros inesperados ficam genéricos.
4. Publicar frontend autorizado em seguida. Testar leitura/CSV com fixture/conta de teste aprovada, matriz negativa em homologação, sete larguras/temas, detalhe e sync. Ações reais de desativação/exclusão exigem autorização específica; não usar usuários reais como teste.
5. Se houver regressão visual, voltar ao bundle frontend anterior; o backend novo suporta o cliente anterior. Se houver problema SQL, preferir correção forward e suspender ações, mantendo locks/auditoria. Rollback de definições só com revisão e migration nova restaurando as definições capturadas; isso reabre a corrida e requer decisão explícita. Não editar migration histórica, não migration repair, não apagar logs/jobs/casos nem “desfazer” ações por restauração de banco.

## Pendências priorizadas / limites da entrega

- P2: testar expiração/revogação de JWT com GoTrue/PostgREST em homologação dedicada; a matriz local prova autorização SQL, não verificação criptográfica de JWT.
- P2: validação manual com screen reader/dispositivo e planilha alvo; cobertura automatizada não certifica WCAG nem todos os importadores CSV.
- P2: links de módulos vizinhos ainda usam `?usuario=<UID>` (`AdminAccountDeletions`, `AdminCashPurchases`, `AdminModeration`); Contas não acrescenta PII a URL nem lê esse parâmetro. Avaliar navegação privada entre módulos como alteração transversal separada, sem fingir que esta entrega removeu esses links.
- P2: definir política operacional para revogar privilégios/sessões de administradores e auditabilidade/retenção de exports, com responsáveis do produto/jurídico. Não redefinir unilateralmente retenção legal ou a fonte global de privilégios.
- P3: quando volume exigir busca completa além de 1.000, implementar contrato backend de filtros/paginação e seleção com desempate estável e contagens globais. A limitação atual está explícita na interface.

Publicação permanece pendente por instrução expressa do usuário, não por resultado dos testes.
