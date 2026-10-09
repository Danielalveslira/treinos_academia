# Métricas de patrocinados — Fase 4: homologação e plano de publicação

> **Estado em 2026-10-09:** as migrations `20261018000001` e `…02` foram aplicadas **pelo responsável** no Supabase de produção
> (confirmado por sondagem anônima: RPCs e tabelas passam de 404 para 401; `collection_enabled=false` e 0 agregados/marcadores,
> verificados com a chave de serviço sem alterar dados). Este commit publica o frontend com `VITE_AD_METRICS_ENABLED` **ausente**.
> Os jobs de `pg_cron` e o histórico de migrations hospedado **não puderam ser verificados daqui** (sem acesso ao banco): conferir
> com o Apêndice A. A coleta segue desligada (build e servidor).

## 1. Auditoria (fatos verificados)

| Item | Resultado |
|---|---|
| Git | `main` = `origin/main` = `7df6832` (0 à frente/atrás). Working tree: 6 deleções preexistentes em `docs/`, `docs/promps/` não rastreado, e os arquivos das Fases 2–3 |
| Remote | `https://github.com/Danielalveslira/treinos_academia` (privado, branch padrão `main`) |
| Conta GitHub | **Ativa no terminal: `wellington-lira-brisa`** (via `GITHUB_TOKEN`; tem `push`, sem `admin` no repositório). A conta `Danielalveslira` está logada mas inativa (`admin`; usável com `env -u GITHUB_TOKEN gh …`). Autor dos commits: `danielalveslira <dnllira1@gmail.com>` |
| Vercel | Projeto **`danielalvesliras-projects/treinos_academia`**, ligado ao GitHub: cada commit em `main` gera deployment **Production** (último: `7df6832`, status `success`). Não há `.vercel/` nem CLI/token local, então variáveis de ambiente do projeto **não foram lidas** (pelo código, flag ausente = desligada) |
| Supabase hospedado | Projeto `ywrjojrjgozdfpddkkuy` (único; é produção). **Sem** CLI, token de gestão nem URL de banco no ambiente. Sondagem anônima somente-leitura: `get_sponsored_ad_metrics_dashboard`, `record_ad_events`, `sponsored_ad_daily_stats` e `sponsored_ad_metrics_settings` retornam **404** (não existem); `is_superadmin`/`has_app_access` existem. Histórico de migrations não pôde ser lido |
| Migrations | `20261018000001` e `…02` são as únicas após `20261017000003`; ordem numérica correta; sem dependência de objetos fora de `public/private/auth/cron` |

### Revisão de segurança das migrations (catálogo + pgTAP, local)

- RLS ligada nas 3 tabelas novas; marcadores e configuração **sem policy e sem GRANT** para `anon`/`authenticated`; agregados com
  `SELECT` condicionado a `is_superadmin()`; nenhum `INSERT/UPDATE/DELETE` para clientes.
- `record_ad_events` e `get_sponsored_ad_metrics_dashboard`: `SECURITY DEFINER` justificado, `search_path` vazio, sem SQL dinâmico,
  `EXECUTE` revogado de `PUBLIC`/`anon`; funções `private.*` não executáveis por clientes.
- `pg_cron`: dois jobs com nome fixo (`cleanup-sponsored-ad-marks`, `cleanup-sponsored-ad-stats`); recriar substitui, nunca duplica.
- Flags: `collection_enabled` nasce `false`; build sem `VITE_AD_METRICS_ENABLED`.

## 2. Homologação (local, com evidências)

**Ambiente:** Postgres 17 local com **todas as migrations** do repositório (inclui 01 e 02, aplicadas do zero), PostgREST 12.2.12
na frente, e o **build de produção do aplicativo real** (Vite, o mesmo da Vercel) falando com ele; sessões reais assinadas
(superadmin, usuário comum, anônimo). Dados **sintéticos apenas neste ambiente local** (removidos ao final). **Não** é o Supabase
hospedado nem um branch dele: faltam, portanto, rede real, cota/CPU do plano e o histórico de migrations hospedado.

| Verificação | Resultado |
|---|---|
| Ordem 01 → 02 aplicada do zero + pgTAP | 179 (Fase 2) + 75 (dashboard) ok; concorrência ok |
| RPC como superadmin / comum / anônimo | 200 / `PERMISSION_DENIED` (400, também com filtros adulterados) / 401 `42501` |
| `SELECT` direto: agregados (comum) | `[]` (RLS); (superadmin) linhas |
| `SELECT` direto: marcadores e configuração (superadmin, comum, anon) | 403/401 `42501` |
| `UPDATE` nos agregados (comum); `record_ad_events` (anon) | 403 / 401; comum com coleta OFF → `{"enabled":false,"accepted":0}` |
| Intervalo inválido (400 dias) | `INVALID_RANGE` |
| Página real **Anúncios e parcerias**, superadmin | abas Campanhas/Métricas; **0** chamadas de métricas e **nenhum** chunk de métricas antes de abrir a aba |
| Edição de campanha com opcionais `null` (real) | formulário abre, salva (`PATCH` 204), sem tela de erro |
| Abrir Métricas | **1** chamada à RPC (9,4 KB); Atualizar +1; novo período +1; voltar ao anterior +0 (cache); filtro de posicionamento +1; limpar +0; comunidade sem dados +1 ("Ainda não há métricas neste período"); detalhe +1; reabrir detalhe +0; busca local +0; alternar abas +0 |
| Estados reais no navegador | sem permissão, relatório indisponível (404 `PGRST202`), erro de rede, coleta desligada sem dados, sem dados no período, dados com coleta desligada, offline (0 chamadas, mantém o último snapshot) |
| Responsividade 320/390/430/768/1280 px, claro e escuro | **sem rolagem horizontal** nas duas abas; nenhum elemento fora da viewport; sem erros de console inesperados |
| Usuário comum | `/admin/parcerias` redireciona para `/comunidades`; nenhuma chamada ao dashboard |
| Telemetria (usuário comum navegando Home e comunidade, com banner/card visíveis, rolagem e clique no CTA) | **0** chamadas a `record_ad_events`; chunk do coletor (`runtime-*`) **nunca** baixado |
| PWA | SW instala e controla; `BOOT_ASSETS` continua com 4 arquivos (chunks novos não entram no precache). Com a aba aberta durante um "deploy", abrir Métricas mostra o fallback padrão do app *"Uma nova versão do app foi publicada"*; após recarregar, a aba funciona com o chunk novo |

### Desempenho e consumo (reais, local)

- **Página Campanhas (real):** 14 requisições REST / 22,5 KB no carregamento (já era assim; nenhuma é de métricas).
- **Abrir Métricas:** +1 requisição à RPC (9,4 KB com 826 linhas de agregados sintéticos; latência 101 ms via proxy docker, RPC no banco
  4–13 ms) + download único de chunks: `AdMetricsTab` 6,6 KB gzip, `DailyChart` 0,9 KB gzip e o chunk **`charts` (recharts) 108 KB
  gzip**, já usado pela tela Progresso (cache do navegador depois da primeira vez). **Atenção:** para o superadmin, a primeira
  abertura da aba baixa esse chunk.
- **CPU 1×/4×/6× (cartões e gráfico prontos ao abrir a aba):** 0,42 s / 0,55 s / 0,85 s; tarefas longas ao abrir: 1 / 4 / 5 (≈ 0,15 / 1,2 /
  1,7 s no total, ligadas ao parse do recharts na primeira abertura). CLS 0,0001.
- **RPC no banco com 146 mil linhas (366 dias × 20 campanhas × 20 contextos):** 7 d 4,8 ms · 30 d 13 ms · 90 d 33 ms · 366 d 153 ms;
  JSON 13–79 KB. Plano: varredura por índice da PK em `day`, uma agregação com `GROUPING SETS`. **Nenhum índice novo recomendado.**

### Limites da homologação

Não foram cobertos: Supabase hospedado/branch, a conta superadmin real, aparelho físico, rede real (a emulação lenta no harness
anterior não foi conclusiva), e as variáveis de ambiente do projeto Vercel (não legíveis daqui).

## 3. Plano de rollback (não destrutivo)

1. **Frontend:** na Vercel, *Promote* o deployment anterior (`7df6832`) ou `git revert` do commit da feature. Sem a RPC, a aba
   mostra "relatório indisponível" sem quebrar a página; com a flag ausente nada coleta.
2. **Kill switch da coleta (se algum dia ligada):** `update public.sponsored_ad_metrics_settings set collection_enabled = false, updated_at = now();`
3. **Banco, sem perder dado:** `drop function public.get_sponsored_ad_metrics_dashboard(integer,date,date,uuid,uuid,text);`
   `drop function private.ad_metrics_object(bigint,bigint,bigint,bigint);` e `select cron.unschedule('cleanup-sponsored-ad-marks');`
   `select cron.unschedule('cleanup-sponsored-ad-stats');`. As tabelas ficam (vazias enquanto a coleta nunca for ligada; o
   `DROP` delas só com decisão explícita, pois apaga agregados).

## 4. Plano de execução proposto (aguarda confirmação; nada abaixo foi feito)

Pré-condições a definir por você: **(a)** como aplicar as migrations no Supabase hospedado (não há CLI/token/URL de banco aqui:
você aplica no SQL Editor/CLI, ou me fornece um caminho autorizado), idealmente antes em um **branch/projeto de homologação**;
**(b)** qual conta GitHub fará o push (recomendo `Danielalveslira`: `env -u GITHUB_TOKEN gh auth status` e push com ela, para
bater com o dono do projeto Vercel).

1. **Reconfirmar** remote, conta, projeto Vercel e Supabase de destino (comandos da seção 1).
2. **Supabase (produção):** aplicar `20261018000001` e depois `20261018000002`, nessa ordem, **sem dados sintéticos**. Checar:
   `select collection_enabled from public.sponsored_ad_metrics_settings` = `false`; `select jobname from cron.job where jobname like
   'cleanup-sponsored-ad-%'` = 2 linhas; sondagem anônima: RPCs passam de 404 para 401; tabelas sem acesso para `anon`.
3. **Commit** só dos arquivos da feature (lista explícita, sem `git add -A`; excluídos: deleções de `docs/` e `docs/promps/`):
   - `supabase/migrations/20261018000001_sponsored_ad_metrics.sql`, `…0002_sponsored_ad_metrics_dashboard.sql`
   - `supabase/tests/sponsored_ad_metrics_test.sql`, `…_concurrency.sh`, `…_dashboard_test.sql`
   - `src/services/adMetrics/`, `src/hooks/useAdMetrics.js`, `src/features/adMetrics/`
   - `src/components/SponsoredAdBanner.jsx`, `SponsoredAdCard.jsx`, `SponsoredAdForm.jsx`, `CommunityFeedSection.jsx`, `src/pages/Dashboard.jsx`, `src/pages/AdminSponsoredAds.jsx`
   - `src/utils/sponsoredAds.js` e testes (`SponsoredAdMetrics.test.js`, `SponsoredAdForm.test.js`, `AdminSponsoredAds.test.js`, `sponsoredAds.test.js`)
   - `docs/SPONSORED_AD_METRICS*.md` (5 arquivos: principal, dashboard, privacidade, este plano e a nota de "superado" na proposta antiga)
4. **Push em `main`** (dispara o deploy de Produção na Vercel). Frontend com `VITE_AD_METRICS_ENABLED` **ausente** (conferir em
   Vercel → Settings → Environment Variables que não existe; não criá-la).
5. **Validar o publicado:** (você, com conta superadmin) abrir Administração → Anúncios e parcerias → Métricas: deve mostrar
   "A coleta de métricas está desligada…" (sem números); editar uma campanha com campos vazios. (eu, sem login) conferir no
   bundle publicado que a flag é falsa e, no navegador sem sessão, **0** requisições a `record_ad_events`.
6. **Monitorar** 24 h: erros 4xx/5xx de RPC, console de erros do admin, `select count(*) from public.sponsored_ad_event_marks` = 0.
   Rollback conforme a seção 3.

**Nenhuma ativação de coleta:** continua dependendo da revisão legal (`docs/SPONSORED_AD_METRICS_PRIVACY_DRAFT.md`).


## 5. Checkpoint de produção (2026-10-09) — aguardando autorização

### Auditoria final (verificada de novo)

- **GitHub:** `main` = `origin/main` = `7df6832`; conta `Danielalveslira` logada, com `admin/push` (use `env -u GITHUB_TOKEN`; a variável
  `GITHUB_TOKEN` do Codespace é da `wellington-lira-brisa`). Push com a conta correta:
  `env -u GITHUB_TOKEN git -c credential.helper='!gh auth git-credential' push origin main`.
- **Vercel (evidência indireta, sem token):** o bundle publicado em `treinosacademia-ten.vercel.app` inlina as variáveis `VITE_*` do
  build: `VITE_VERCEL_ENV=production`, commit `7df6832`, autor `Danielalveslira`, repositório `Danielalveslira/treinos_academia`, e **não**
  contém `VITE_AD_METRICS_ENABLED`. Residual: o painel de variáveis da Vercel não é legível daqui; a mesma checagem será repetida no
  bundle pós-deploy.
- **Supabase: BLOQUEADO.** A CLI (`supabase` 2.119, devDependency) existe, mas **não há autenticação** (sem `SUPABASE_ACCESS_TOKEN`,
  senha ou URL do banco; sem `~/.supabase`). Sem isso não é possível listar o histórico remoto de migrations nem aplicar nada. A
  sondagem anônima confirma que as duas RPCs e as tabelas novas **não existem** na produção.

### Alterações exatas das migrations (ensaiadas, cada uma em uma transação `psql -1`, ordem 01 → 02)

| Migration | Cria | Altera dados existentes? |
|---|---|---|
| `20261018000001` | tabelas `sponsored_ad_daily_stats`, `sponsored_ad_event_marks`, `sponsored_ad_metrics_settings` (1 linha, `collection_enabled=false`); funções `private.ad_metrics_day`, `public.record_ad_events`, `private.cleanup_sponsored_ad_metrics`, `private.cleanup_sponsored_ad_stats`; 2 jobs `pg_cron`; RLS e `REVOKE` | **Não**: só objetos novos (FK de `marks` para `public.users` com `ON DELETE CASCADE`; nenhuma tabela existente é alterada) |
| `20261018000002` | funções `private.ad_metrics_object` e `public.get_sponsored_ad_metrics_dashboard` | **Não** |

Nada toca em tabelas financeiras, `sponsored_ads`, comunidades ou contas. Ensaio local: ambas aplicam sem erro; verificação, rollback
e reaplicação passaram; pgTAP 179 + 75, concorrência, e as suítes de exclusão de conta, feed, segurança, contas admin, criação de
comunidade e controle offline sem falhas; `npm test` 1576/1576; lint 0 erros; build e orçamento ok (boot JS gzip 303.187 B).

### Como aplicar sem risco com o histórico remoto desconhecido

1. **Não** usar `supabase db push` às cegas: se o histórico remoto não refletir as migrations anteriores (aplicadas por outro
   caminho), a CLI tentaria reaplicar todas. Primeiro `supabase migration list --linked` e comparar com `supabase/migrations/`.
2. Se o histórico estiver em dia até `20261017000003`: `supabase db push` aplicaria só as duas novas. Se houver divergência:
   **parar** e decidir; as duas podem ser aplicadas isoladamente (SQL Editor ou `psql -1 -f`) e só então registradas com
   `supabase migration repair --status applied <versão>`, **depois** de `verify` comprovar o resultado.
3. Rodar a verificação somente-leitura (apêndice A). Esperado: 3 tabelas com RLS; `anon` sem nenhum privilégio; `authenticated`
   sem escrita e só `SELECT` (com RLS) nos agregados; 6 funções com `search_path=""` (4 `SECURITY DEFINER`); `anon` sem `EXECUTE`;
   `authenticated` com `EXECUTE` apenas nas 2 RPCs públicas; 2 jobs; `collection_enabled = false`; 0 agregados e 0 marcadores.

### Recuperação

Apêndice B (não destrutivo: remove funções e jobs, mantém tabelas e dados, força `collection_enabled=false`); ensaiado localmente.
Frontend: promover na Vercel o deployment anterior (`7df6832`).

### Apêndice A — verificação pós-migration (somente leitura)

```sql
select c.relname, c.relrowsecurity as rls, has_table_privilege('anon', c.oid, 'select,insert,update,delete') as anon_any,
       has_table_privilege('authenticated', c.oid, 'insert,update,delete') as auth_write, has_table_privilege('authenticated', c.oid, 'select') as auth_select
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('sponsored_ad_daily_stats','sponsored_ad_event_marks','sponsored_ad_metrics_settings') order by 1;
select n.nspname || '.' || p.proname as funcao, p.prosecdef as secdef, p.proconfig as config,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.proname in ('record_ad_events','get_sponsored_ad_metrics_dashboard','ad_metrics_day','ad_metrics_object','cleanup_sponsored_ad_metrics','cleanup_sponsored_ad_stats') order by 1;
select jobname, schedule, command from cron.job where jobname like 'cleanup-sponsored-ad-%' order by 1;
select collection_enabled from public.sponsored_ad_metrics_settings;
select (select count(*) from public.sponsored_ad_daily_stats) as agregados, (select count(*) from public.sponsored_ad_event_marks) as marcadores;
```

### Apêndice B — rollback não destrutivo

```sql
select cron.unschedule('cleanup-sponsored-ad-marks');
select cron.unschedule('cleanup-sponsored-ad-stats');
drop function if exists public.get_sponsored_ad_metrics_dashboard(integer, date, date, uuid, uuid, text);
drop function if exists public.record_ad_events(jsonb);
drop function if exists private.ad_metrics_object(bigint, bigint, bigint, bigint);
drop function if exists private.cleanup_sponsored_ad_metrics();
drop function if exists private.cleanup_sponsored_ad_stats();
update public.sponsored_ad_metrics_settings set collection_enabled = false, updated_at = now();
```
