# Métricas de patrocinados — Fase 5: ativação (runbook com checkpoints)

> **Estado em 2026-10-09:** homologação local do coletor **ligado** concluída; política v1.5.0 **proposta** (não publicada, `legal/`
> intocado, escrita bloqueada ao assistente); migration `20261019000001` pronta e testada localmente (**não aplicada**); coleta
> **desligada** no servidor e **ausente** no build de produção. Cada etapa abaixo exige a autorização indicada.
> Base legal e tratamento de menores: `docs/SPONSORED_AD_METRICS_LEGITIMATE_INTEREST_AND_ECA_DIGITAL.md` (**não aprovada**).


## Checkpoint único — tudo o que falta e quem faz (estado em 2026-10-09)

**Verificado hoje em produção (somente leitura):** `legal_policy` = 1.4.0; migrations 01 e 02 aplicadas; migration `20261019000001`
**ausente** (`admin_set_ad_metrics_opt_out` = 404); `collection_enabled=false`; build sem `VITE_AD_METRICS_ENABLED`; `main` = `origin/main` = `b615764`.

| # | Ação | Quem | Pré-requisito |
|---|---|---|---|
| 1 | Aprovar base legal (legítimo interesse), prazos 48 h/24 meses e `exclude_minors=true` (docs `…LEGITIMATE_INTEREST_AND_ECA_DIGITAL.md`, `…LEGAL_V1.5.0_PROPOSAL.md`) | você + jurídico | — |
| 2 | Aplicar `supabase/migrations/20261019000001_*.sql` no Supabase (SQL Editor, uma transação) e rodar o Apêndice A do ROLLOUT + `select exclude_minors from public.sponsored_ad_metrics_settings` (esperado `true`) | você | 1 |
| 3 | `node docs/legal-drafts/apply-legal-v1.5.0.mjs` (digest esperado `9f7f1292…5d95`), mover `docs/legal-drafts/legalV150.test.js` para `src/utils/`, rodar `npm test`, lint, build, budget | **operador com permissão em `legal/`** | 1 |
| 4 | Commit com staging **explícito** (ver lista abaixo) e `env -u GITHUB_TOKEN git -c credential.helper='!gh auth git-credential' push origin main` → deploy Vercel com a política **ainda 1.4.0** no banco | operador/assistente após sua autorização | 2, 3 |
| 5 | Esperar ~24 h; conferir deploy `success` e que o bundle contém a 1.5.0 | — | 4 |
| 6 | `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/seed-legal.mjs` (reaceite começa) | você, autorização separada | 5 |
| 7 | Testar reaceite com 3 contas (aceitou 1.4.0 / nova / outro aparelho) e uma conta com fila offline | você + assistente | 6 |
| 8 | Vercel: `VITE_AD_METRICS_ENABLED=true` (só Production) + Redeploy; conferir bundle | você | 7 |
| 9 | `update public.sponsored_ad_metrics_settings set collection_enabled = true, updated_at = now();` | você, autorização separada | 8 |
| 10 | Com **conta comum maior de 18 anos**: Home, banner e card da comunidade, clique no WhatsApp; conferir SQL da §3 e a aba Métricas no domínio Vercel | você + assistente | 9 |

**Staging do commit (passo 4, sem `git add -A`):** `supabase/migrations/20261019000001_sponsored_ad_metrics_privacy_controls.sql`,
`supabase/tests/sponsored_ad_metrics_privacy_controls_test.sql`, `supabase/tests/sponsored_ad_metrics_test.sql`,
`supabase/tests/sponsored_ad_metrics_concurrency.sh`, `src/utils/legal.js`, `src/utils/legal.test.js`, `src/utils/legalV150.test.js`,
`legal/manifest.json`, `legal/documents.json`, `legal/approved-digests.json`, `legal/test-fixtures/1.4.0.json`, `docs/rollback/`,
`docs/legal-drafts/`, `docs/SPONSORED_AD_METRICS_ACTIVATION.md`, `docs/SPONSORED_AD_METRICS_LEGAL_V1.5.0_PROPOSAL.md`,
`docs/SPONSORED_AD_METRICS_LEGITIMATE_INTEREST_AND_ECA_DIGITAL.md`. Excluir: as 6 deleções de `docs/` e `docs/promps/`.

**Atenção a um efeito da migration 03:** as contas de teste de **homologação** precisam ter data de nascimento de adulto, senão a
medição as ignora (por desenho). Contas reais sem data de nascimento nunca chegam ao aceite da política (a data é exigida no aceite).

## 0. Pré-requisitos e decisões abertas

1. **Aprovação da base legal e dos prazos** (`docs/SPONSORED_AD_METRICS_LEGITIMATE_INTEREST_AND_ECA_DIGITAL.md` e `…LEGAL_V1.5.0_PROPOSAL.md`, seção 3): legítimo interesse × consentimento,
   menores (12–17), 48 h / 24 meses, transferência internacional, itens extras do texto.
2. **Janela do reaceite** (impacto na seção 5 da proposta): quando rodar o *seed* da v1.5.0 e quanto esperar a propagação do service worker.
3. **Acessos** que eu não tenho e preciso que você faça ou autorize: Vercel (variável de build + redeploy), service-role/SQL para o
   *seed* legal e para ligar a chave do servidor (ou execução por você), e uma **conta comum** de teste em produção.

## 1. Sequência segura (revisada)

> **Escrita em `legal/` bloqueada para o assistente** pelo classificador de permissões (negada 3×; não contornada). O procedimento
> abaixo para `legal/` é executado por um **operador autorizado** (você ou quem tiver a permissão): um único comando, verificável.

| Etapa | O que acontece | Reversível? | Quem / autorização |
|---|---|---|---|
| **A0** | **Migration `20261019000001`** no Supabase de produção (controles de privacidade: `exclude_minors=true`, oposições, `record_ad_events` atualizada). Não grava nada nem liga a coleta | Sim: `docs/rollback/20261019000001_privacy_controls_rollback.sql` | você aplica; **Checkpoint A** |
| **A1** | Operador roda `node docs/legal-drafts/apply-legal-v1.5.0.mjs` (valida o digest da 1.4.0 no HEAD, arquiva a 1.4.0 em `legal/test-fixtures/1.4.0.json`, troca só o bloco de privacidade, sobe o manifesto, calcula e registra o digest 1.5.0, atualiza `src/utils/legal.js`); depois move `docs/legal-drafts/legalV150.test.js` para `src/utils/legalV150.test.js` e roda `npm test`, lint, build e budget | Sim (`git checkout`) | operador; **Checkpoint A** |
| **A2** | Commit (staging explícito) e push do frontend compatível (1.3.0/1.4.0/1.5.0) com `legal_policy` ainda em 1.4.0: **nada muda para os usuários**. Deploy automático na Vercel | Sim (promover deploy anterior) | **Checkpoint A** |
| espera | Propagação do service worker (sugestão: 24 h). Clientes antigos curam sozinhos: ver "Clientes antigos" abaixo | — | sua janela |
| **A3** | `node scripts/seed-legal.mjs` com `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (upsert de `legal_versions` e **depois** `legal_policy`=1.5.0). Dispara o reaceite | Sim: `legal_policy` = 1.4.0 + digest `c40e5e04…0c87` | **autorização separada** |
| A4 | Testar reaceite com contas reais (já aceitou 1.4.0; nova; troca de conta; outro aparelho) | — | — |
| **B1** | Vercel → Environment Variables: `VITE_AD_METRICS_ENABLED=true` **só Production** + Redeploy | Sim | **Checkpoint B** |
| B2 | Validar o bundle servido; servidor ainda `false` ⇒ RPC responde `enabled:false`, **não grava** | — | — |
| **C** | `update public.sponsored_ad_metrics_settings set collection_enabled = true, updated_at = now();` | Sim (kill switch §4) | **autorização separada** |

### Clientes antigos (PWA) e reaceite — o que foi verificado no código

- Cliente antigo (conhece só 1.3.0/1.4.0) com o banco em 1.5.0: `resolveLegalBundle` falha com `LEGAL_POLICY_INCOMPATIBLE`; o gate mostra
  **"Documentos indisponíveis"** com botão **Recarregar** (não é loop de aceite). Teste: `legal.test.js` ("cliente que não conhece a versão publicada…").
- Cura: a navegação do service worker é **network-first** (um F5 busca o shell novo) e o worker novo instala e assume sozinho
  (`skipWaiting`+`claim`); `PwaControls` consulta atualização a cada foco. Quem recarrega cai na tela de aceite da 1.5.0, aceita e segue.
- A tela só pisca de "carregando" para quem já aceitou a versão vigente porque o gate só decide depois de ler perfil+política
  (`resolveLegalGateState`); quem já aceitou a versão que o bundle conhece fica `allowed` (teste incluído).
- Fila offline: erro `APP_ACCESS_DENIED` classifica como `denied` e **preserva os dados locais** sem gastar tentativas
  (`syncEngine.js`); treinos feitos offline sincronizam depois do aceite.
- Superadmin continua alcançando o painel durante qualquer janela de política indisponível.
- **Risco residual:** quem nunca recarregar nem focar a aba fica na tela "Documentos indisponíveis" até agir; por isso a espera de 24 h entre A2 e A3.

### Homologação do reaceite (app real, build de produção, Postgres/PostgREST locais; 2026-10-09)

| Cenário | Resultado |
|---|---|
| Banco 1.4.0 + frontend novo, quem aceitou a 1.4.0 | app liberado (sem tela de aceite) |
| Banco → 1.5.0, frontend novo, quem aceitou a 1.4.0 | tela "Leia a versão 1.5.0"; aceita → app liberado; **recarregar e outro aparelho: sem nova tela (sem loop)**; `legal_acceptances` ganha a 1.5.0 e o perfil recebe versão/digest corretos |
| Usuário novo (sem aceite) | tela de aceite → aceita → liberado |
| **Cliente antigo (b615764) com banco 1.5.0** | "Documentos indisponíveis" → **Recarregar** (frontend novo já no ar) → tela de aceite da 1.5.0 → aceita → liberado; recarregar de novo: liberado |
| Rollback do banco para 1.4.0 (frontend novo) | quem aceitou a 1.5.0 vê a tela de aceite da **1.4.0** (preferir corrigir adiante) |

### Rollout por percentual — **não existe**

`VITE_AD_METRICS_ENABLED` é uma variável de **build** booleana (global) e `collection_enabled` é um booleano global. O mecanismo de
percentual (`rollout_percentage` em `offline_feature_flags`) pertence às funções offline (check de `feature` restrito a
`offline_write`/`offline_cold_start`) e **não** se aplica às métricas. Portanto: **não anunciar rollout por percentual**. Estratégia:
janela assistida de ativação global, com `exclude_minors=true`, kill switch imediato e verificação em minutos. Se quiser coorte,
é uma implementação nova (ex.: hash do `user_id` no servidor), a decidir.

### Oposição à medição (operacional)

Pelo atendimento, como **postgres**: `insert into public.sponsored_ad_metrics_opt_outs (user_id) values ('<uuid>') on conflict do nothing; delete from public.sponsored_ad_event_marks where user_id = '<uuid>';`
Desfazer: `delete from public.sponsored_ad_metrics_opt_outs where user_id = '<uuid>';`

## 2. Evidências da homologação local (coletor ligado, sem dados reais)

Build real de produção do app com `VITE_AD_METRICS_ENABLED=true` + Postgres/PostgREST locais com **todas** as migrations; conta comum
autenticada (membro) e dados sintéticos **só locais** (removidos). Resultados:

| Cenário | Resultado |
|---|---|
| Home (banner global) + comunidade (banner + card) | Impressões nos 3 posicionamentos corretos (`home_banner`, `community_banner`, `community_feed`), 1 cada; **2 requisições** por visita (148 B e 394 B de corpo) |
| Clique no CTA externo (WhatsApp) a ~0,1 s do banner | Nova aba abriu normalmente (navegação não bloqueada); clique contado; como a página seguiu visível, a impressão qualificou depois e foi no **mesmo lote**, então o clique saiu qualificado (`unqualified_clicks`=0). Clique sem impressão no servidor: coberto por pgTAP/concorrência |
| Falha de rede na 1ª tentativa | 2 tentativas com **os mesmos ids** de evento; contado **uma vez** |
| Fechar a página com eventos no buffer | 1 envio (keepalive) ao sair; agregados gravados |
| Superadmin navegando | **0** eventos gravados |
| Conta fora da comunidade | Home conta (anúncio global); comunidade não abre, nada gravado |
| Dashboard (superadmin) | 1 chamada; cartões refletem os agregados |
| Coleta ligada × desligada, CPU 1×/4×/6×, celular fraco | CLS ≈ 0 nas duas; **+1 requisição REST** (394 B) e **+1 arquivo** (`runtime`, 2,7 KB gzip) com a flag ligada; tarefas longas e heap sem diferença acima do ruído |
| Conta comum/anônima no dashboard | Negado (RPC `PERMISSION_DENIED`/401; tabelas sem acesso) — verificado na Fase 4 |

Limites: ambiente local (não é o Supabase hospedado); `pg_cron` hospedado e dashboard no domínio Vercel só podem ser conferidos por
você (Apêndice A do ROLLOUT e a aba Métricas em produção). Nenhum dado sintético foi criado em produção.

## 3. Verificação das primeiras métricas reais (após a etapa C; somente leitura, sem dados pessoais)

```sql
select placement, count(*) as linhas, sum(visible_impressions) as impressoes, sum(unique_viewers) as alcance_diario_agregado,
       sum(clicks) as cliques, sum(unqualified_clicks) as cliques_sem_impressao
  from public.sponsored_ad_daily_stats where day >= (now() at time zone 'America/Sao_Paulo')::date - 1 group by 1 order by 1;
select kind, placement, count(*) as marcadores, min(expires_at) as vence_primeiro from public.sponsored_ad_event_marks group by 1, 2 order by 1, 2;
select jobname, status, start_time from cron.job_run_details d join cron.job j using (jobid) where jobname like 'cleanup-sponsored-ad-%' order by start_time desc limit 4;
select pg_size_pretty(pg_total_relation_size('public.sponsored_ad_event_marks')) as marcadores, pg_size_pretty(pg_total_relation_size('public.sponsored_ad_daily_stats')) as agregados;
```

Conferir: contagens separadas por posicionamento; `alcance_diario_agregado` ≤ `impressoes`; CTR bruto pode passar de 100% (ler o
**CTR qualificado** à parte); marcadores com `expires_at` ≈ +48 h e sumindo após o job horário. Não consultar nem exportar `user_id`.
Teste manual com conta comum: leitura lenta (≥ 1 s) vs rolagem rápida, clique antes de 1 s, clique depois da impressão, tetos
(10 impressões / 5 cliques por chave/dia, 100/hora, 300/dia), conta banida/desativada/não membro e superadmin sem contar.

**Monitorar (pontual, sem polling):** erros 4xx/5xx da RPC nos logs do Supabase, linhas gravadas/hora, latência da RPC, tamanho das
tabelas e execução dos dois jobs, nas primeiras horas e no dia seguinte. Estimativa de custo da Fase 2: ≈ 0,3 KB por evento e
≈ 2 ms de CPU de banco por chamada.

## 4. Contingência

1. **Primeiro freio:** `update public.sponsored_ad_metrics_settings set collection_enabled = false, updated_at = now();` — a RPC passa a
   responder `enabled:false` e **para de gravar**; confirmar com `select count(*) from public.sponsored_ad_event_marks` estável.
2. Remover `VITE_AD_METRICS_ENABLED` da Vercel (Production) e *Redeploy*.
3. **Fluxo legal:** preferir **corrigir adiante** (nova versão) a voltar o banco. Verificado em homologação (R5): se `legal_policy` voltar a
   1.4.0 com o frontend novo, **todos** os usuários que já aceitaram a 1.5.0 recebem a tela de aceite da **1.4.0** (o gate compara a
   versão aceita com a vigente), sem perda de dados nem bloqueio permanente. Se mesmo assim for necessário voltar: `legal_policy` =
   1.4.0 + digest `c40e5e04…0c87` (a linha 1.4.0 de `legal_versions` nunca é apagada) e avisar que haverá novo aceite. Nunca reverter
   só o frontend deixando `has_app_access()` bloqueando usuários.
4. Não apagar tabelas, dados, histórico legal, funções nem jobs sem novo diagnóstico e autorização.
