# Métricas de anúncios V2

## Implementação e contrato

Migration: `supabase/migrations/20261116000001_advertiser_metrics_v2.sql`.
Não modifica a coleta, flags, consentimento, retenção, marcadores, agregados existentes ou a RPC administrativa original.

- `advertiser_accounts`: nome, ativação, criador e datas.
- `advertiser_members`: chave `(account_id,user_id)`, somente `viewer`, concessão e revogação. Uma pessoa pode participar de várias contas.
- `advertiser_campaigns`: `ad_id` único e vínculo durável, sem FK para o anúncio ativo. Preserva título/nome/vencimento conhecidos na vinculação. Não há atribuição por `partner_name` ou `created_by`.
- `advertiser_audit`: ator, conta, ação, sujeito e horário das operações administrativas. As tabelas novas têm RLS e nenhum acesso direto para clientes; mutações passam pela RPC administrativa.
- A titularidade é imutável, inclusive por trigger. A API não oferece exclusão ou transferência do vínculo. Para outra empresa, criar outro anúncio com novo UUID; isso preserva o histórico da empresa anterior. Uma vinculação errada exige investigação administrativa; não apagar agregados para corrigir.
- Índices em membros ativos por usuário, campanhas por conta e agregados por anúncio/data. A PK diária e o índice novo atendem às leituras por período e por titularidade.

RPCs públicas novas (todas com `search_path=''`, `SECURITY DEFINER`, autenticação e privilégios explícitos):

| RPC | Acesso |
| --- | --- |
| `list_advertiser_accounts` | Apenas contas ativas do membro; superadmin também lista inativas |
| `list_advertiser_campaigns` | Conta ativa e associação ativa, ou superadmin com sessão válida |
| `get_advertiser_metrics` | Mesmo escopo; `ad_id` deve pertencer à conta antes da agregação |
| `get_admin_ad_metrics_v2` | Superadmin; preserva a RPC original separadamente |
| `admin_manage_advertiser` | Superadmin; criar/editar, conceder/revogar e vincular com auditoria |
| `admin_advertiser_directory` | Superadmin; usuários existentes por username, leitores, campanhas atribuídas/não atribuídas |

A identidade vem de `auth.uid()` e dos guards reais de acesso/sessão. Nenhuma RPC aceita a identidade do leitor como parâmetro. `p_subject_id` é somente o alvo de uma operação administrativa. Erros de autorização não distinguem IDs inexistentes de contas/campanhas sem autorização. Funções privadas não são executáveis pelo cliente. Os relatórios não incluem espectadores, opt-outs ou marcadores.

## Fluxo administrativo

1. Abrir **Administração → Anúncios e parcerias → Anunciantes**.
2. Criar a conta com o nome comercial.
3. Selecioná-la e conferir a empresa antes de vincular as campanhas não atribuídas. O vínculo dá acesso a todo o histórico daquele UUID; o texto da tela avisa que não é transferível.
4. Buscar o username de um usuário já existente (mínimo de três caracteres), selecionar **Conceder leitura**.
5. Usar **Conferir portal autorizado**. A visão usa a mesma RPC autorizada do anunciante. Contas inativas são negadas também nessa visão; seu histórico continua disponível ao superadmin no painel administrativo.
6. Para retirar acesso, **Revogar leitura**; para todos os membros, **Desativar conta**. Os dados históricos ficam preservados.

Campanhas recém-criadas aparecem na lista não atribuída ao abrir a aba. Campanhas excluídas antes da V2 só têm os metadados realmente existentes nos agregados (em geral nome do parceiro); títulos ou imagens ausentes não são reconstruídos. Campanhas vinculadas antes da exclusão conservam o retrato mínimo da vinculação.

## Portal, métricas e relatórios

Rota protegida `/meus-anuncios`, no layout e menu de conta existentes. O login preserva o destino dos links compartilhados desse portal. Múltiplas contas têm seletor; cada troca desmonta o relatório anterior. Não há edição pelo anunciante.

A API compartilhada fica em `src/features/adMetrics/api/`, com componentes, hooks e utilitários reutilizados entre admin e portal. Há presets de 7/30/90 dias, intervalo personalizado até 366 dias, filtro de campanha/posicionamento/comunidade no SQL, gráfico diário sob demanda com seleção de séries, tabela acessível, comparação descritiva de janelas equivalentes e agrupamentos por campanha, posicionamento e comunidade. A busca/ordenação da lista é local à página e está identificada como tal; não altera totais nem exportações. No portal o seletor de comunidades é derivado dos contextos autorizados carregados no recorte/página atual, sem oferecer um catálogo global; o filtro também é preservado na URL compartilhada.

Dias sem registro são `null`, nunca zeros inventados. Zero registrado é preservado. CTR qualificado e bruto são distintos, podem ser nulos e não são limitados artificialmente a 100%. Alcance agregado não é alcance único de pessoas no período; a mesma pessoa pode reaparecer em outro dia, campanha ou contexto. A comparação não infere melhora/piora, pois não existe histórico suficiente das flags para comprovar cobertura equivalente.

O relatório mostra o horário real do snapshot e o fuso de medição `America/Sao_Paulo`; a hora de exibição é local. Metadados de existência e último dia de dados do portal são restritos à conta/campanha. A coleta depende de ambas as flags, autenticação, elegibilidade, ausência de oposição e entrega dos eventos; esta entrega não habilita nenhuma flag.

- **Compartilhar** copia URL profunda autenticada, com conta/campanha/período/filtros. Sem tokens anônimos. Links administrativos continuam protegidos pela rota e RPC administrativas.
- **CSV** usa os mesmos campos autorizados e neutraliza fórmulas, incluindo prefixos de controle/espaços. `aggregate_reach` corresponde à soma de `unique_viewers` nos agregados, com ressalva explícita.
- **PDF** é um PDF 1.4 real, paginado, com fonte padrão, identidade Evolutus, KPIs, séries, filtros, emissão e ressalvas. Não acrescenta dependências ao bundle. O texto é transliterado para ASCII para manter a codificação e os offsets corretos sem embutir fontes; imagens e gráficos decorativos não são inseridos.
- As exportações buscam todas as páginas autorizadas, validam os totais e as séries entre leituras e conferem os valores apresentados antes de emitir o arquivo. Se os dados mudarem ou houver falha/revogação, não se entrega um arquivo parcial: atualizar e tentar novamente. São snapshots, não comprovantes de faturamento.

Limites explícitos: páginas de 100 linhas para campanhas/contextos e catálogos; offset máximo de 100.000; intervalo máximo de 366 dias. Exportações acima do limite falham com mensagem em vez de truncar. Consultas de relatório agregam no banco, sem N+1 por cartão; a janela anterior exige outra agregação dentro da mesma RPC. Não há polling nem Realtime.

O portal não reutiliza snapshots de cache ao reabrir relatórios: toda leitura revalida autorização. O admin preserva cache apenas em memória. Logout/mudança de identidade invalidam respostas pendentes; falha de autorização remove snapshots e cache. Trocar de conta/filtro descarta respostas e exportações antigas. Voltar o foco à janela revalida o portal. Revogação é aplicada nas novas leituras; não existe mecanismo para recolher um arquivo que já foi baixado legitimamente.

## Validação reproduzível

Frontend:

```sh
npm run lint
npm test
npm run test:functions
npm run build
node scripts/ad-metrics-browser-smoke.mjs
```

O smoke usa Chromium/Playwright e RPCs sintéticas para avaliar UX; não substitui os testes de autorização reais no PostgreSQL. Se o ambiente não tiver navegador/bibliotecas: `node node_modules/playwright-core/cli.js install chromium` e `node node_modules/playwright-core/cli.js install-deps chromium`. Capturas e resultados são salvos em `/tmp/ad-v2-*`.

Banco local descartável, conforme os scripts de homologação existentes (nunca usar URL de produção):

```sh
node scripts/homolog/finance/migrate.mjs all
node scripts/homolog/finance/install-check.mjs
node scripts/homolog/finance/sql-tests.mjs evolutus_integrated_clean_db advertiser_metrics_v2
node scripts/homolog/finance/sql-tests.mjs evolutus_integrated_clean_db sponsored_ad_metrics
```

`install-check` requer os serviços locais Auth/Storage e valida instalação limpa, atualização incremental e preservação de dados. Os 50 cenários novos de pgTAP incluem escopo A/B, IDs forjados, sem vínculo/sessão, revogação de membro/sessão, conta inativa, exclusão, titularidade imutável, histórico não atribuído, paginação e valores zero/nulos. As suítes anteriores continuam cobrindo coleta, deduplicação e privacidade. Logs SQL ficam em `.finance-local/logs/` (ignorados pelo Git).

## Publicação — executar somente após revisão humana

Nenhuma migration remota ou publicação é executada por esta implementação.

1. Revisar o diff, os resultados dos checks e o inventário de migrations do ambiente de destino. Há migrations anteriores no repositório; não presumir que já estejam aplicadas.
2. Confirmar backup recuperável do banco e registrar os valores atuais de `VITE_AD_METRICS_ENABLED` e `sponsored_ad_metrics_settings.collection_enabled`. Preservá-los.
3. Executar os checks acima e homologar com uma conta A/B, incluindo leitor sem vínculo, revogado e campanha removida. Validar o SQL de migração no ambiente de homologação.
4. Com a CLI autenticada e vinculada explicitamente ao projeto correto, executar `npx supabase migration list` e `npx supabase db push --dry-run`. Conferir projeto e cada migration pendente; não usar `--include-all` para contornar divergências. Se houver migrations históricas pendentes, resolver sua ordem e compatibilidade antes de prosseguir.
5. Após autorização operacional, executar `npx supabase db push`. A nova migration precisa entrar antes do frontend que chama as RPCs V2. Confirmar tabelas, funções, RLS e privilégios; nenhuma flag de coleta deve mudar.
6. Gerar o frontend com `npm ci && npm run build` e publicar pelo fluxo habitual revisado do projeto, sem adicionar flags de coleta. Fazer smoke autenticado A/B no destino e conferir os erros de autorização também por RPC.
7. Cadastrar e atribuir contas/campanhas manualmente; não fazer backfill por nome. Conceder acesso somente após conferir empresa, usuário e histórico.
8. Em rollback do frontend, manter as tabelas/vínculos/agregados. Para interromper o portal, desativar contas ou revogar `EXECUTE` das RPCs novas para `authenticated`, conforme revisão operacional. A RPC administrativa anterior continua disponível. Não usar `DROP ... CASCADE` nem excluir estatísticas como rollback.

## Evidências desta execução

- Auditoria inicial: a RPC original era exclusivamente administrativa; não havia titularidade confiável no schema. Produtos/parcerias comerciais não foram reutilizados como identidade do anunciante. A coleta e os controles de oposição/elegibilidade ficaram intactos. Corrigidos os zeros artificiais em dias sem registro, o descarte após autorização negada e o limite anterior de 50 linhas sem navegação.
- `npm test`: 2.101 testes aprovados, zero falhas/skips, na execução final isolada (~100 s). Revalidação focada final: 34 testes aprovados. Uma repetição anterior recebeu SIGTERM do ambiente; foi repetida com sucesso sem containers/build concorrentes.
- `npm run lint`: sem erros; 16 warnings preexistentes (Fast Refresh/variáveis não usadas em outros módulos).
- `npm run build`: aprovado; permanece o aviso de tamanho de chunks compartilhados do Primer/gráficos.
- `npm run test:functions`: 204 aprovados, zero falhas, 3 skips declarados pela suíte.
- `node scripts/homolog/finance/install-check.mjs`: 163 migrations na instalação limpa; 148 de baseline + 15 incrementais na atualização com massa sintética; fixture existente preservada. O script também valida seu contrato financeiro anterior, sem alterar o domínio financeiro desta entrega.
- `node scripts/homolog/finance/sql-tests.mjs evolutus_integrated_clean_db advertiser_metrics_v2`: 50 assertions aprovadas.
- `node scripts/homolog/finance/sql-tests.mjs evolutus_integrated_clean_db sponsored_ad_metrics`: 75 + 31 + 179 assertions aprovadas (dashboard/coleta/privacidade). Total SQL relevante: 335, sem skips.
- `node scripts/ad-metrics-browser-smoke.mjs`: mobile 390 px e desktop 1280 px, claro/escuro, sem overflow horizontal ou erros JavaScript; CSV/PDF, compartilhamento, troca de conta, negativa de acesso e concessão/revogação/desativação administrativas aprovados com RPCs sintéticas. O harness carrega CSS, tokens, ThemeSync e shell reais; as verificações de autorização são as do PostgreSQL, separadamente.
- `EXPLAIN (ANALYZE, BUFFERS)`: consulta de série por conta/período, 9.000 linhas sintéticas, 100 campanhas/90 dias, janela de 30 dias: ~3,6 ms, 24 kB no agregado, sem spill. O planner escolheu hash join/seq scan para essa massa pequena. Não é projeção de desempenho em produção; o volume e distribuição reais devem ser observados após homologação.
- `git diff --check`: sem erros. Alterações do usuário que já existiam no workspace foram preservadas.

A criação transacional do índice em agregados pode bloquear escritas durante a construção: planejar a janela conforme o volume real, medir em homologação e respeitar o `lock_timeout` de 5 s. Esse limite controla a aquisição de locks, não toda a duração da construção. Não converter em `CREATE INDEX CONCURRENTLY` dentro de uma transação.

## Autorização de release

Em 24/10/2026 o usuário autorizou publicar a V2 em produção e dispensou explicitamente o backup do banco, informando que ainda não há usuários reais. Essa autorização substitui a restrição inicial de não publicar automaticamente e a etapa de backup para esta execução. Preservar as flags de coleta existentes. A rota `/meus-anuncios` foi incluída no rewrite da Vercel e no teste de classificação de rotas; o smoke da V2 passa a integrar o CI.
