# Métricas de Patrocinados — proposta técnica (rascunho para aprovação)

> **Superado:** a implementação da coleta (Fase 2) está em `docs/SPONSORED_AD_METRICS.md`. As decisões finais diferem deste
> rascunho (um único marcador temporário de 48 h, posicionamentos `home_banner`/`community_banner`/`community_feed`, chave de
> servidor, `record_ad_events`). Mantido só como histórico das alternativas.

> **Estado:** proposta. Nenhuma migration, tabela, RPC ou evento foi criado em `supabase/migrations` nem em ambiente algum.
> O SQL abaixo é um rascunho que foi validado só em **transação revertida (`ROLLBACK`)** num Postgres local descartável
> (resultado na seção 8). Nada aqui foi aplicado.

## 1. Escopo e o que as métricas são (e não são)

Registrar, por **anúncio × comunidade × dia × formato (`banner` | `feed`)**: impressões visíveis, visitantes únicos
(no dia), cliques e clicantes únicos (no dia).

- São métricas **indicativas** (relatório ao anunciante e acompanhamento interno). O cliente só *reporta* o que viu; o
  servidor decide se o evento conta. **Não são prova financeira definitiva** (ver seção 4).
- O modelo comercial atual de `sponsored_ads` é **por período** (`expires_at`), sem cobrança por impressão nem por clique.
  Enquanto for assim, nada do que está aqui altera preço, cobrança, validade ou distribuição.
- Não é rastreamento de pessoas: sem IP, sem user agent, sem identificador de aparelho, sem histórico por usuário
  além de um marcador de **1 dia** necessário para o "único no dia".

## 2. Arquitetura (a mais barata que atende ao requisito)

| Decisão | Escolha | Por quê |
|---|---|---|
| Granularidade | Contadores **diários agregados** (1 linha por dia/anúncio/comunidade/formato) | Nada de uma linha por evento: o crescimento é limitado por *campanhas × comunidades*, não por tráfego. |
| Deduplicação | Marcador `(dia, anúncio, comunidade, formato, usuário)` com contadores `views`/`clicks` e teto | Mesmo padrão de `promotion_event_limits` (existente): tabela de limites com purga por `pg_cron`. |
| Escrita | **1 RPC em lote** (`record_sponsored_ad_events`, ≤ 20 eventos), `SECURITY DEFINER` | Sem Realtime, sem polling, sem consulta por card. ~1 chamada por visita que tenha anúncio. |
| Quem decide | **Servidor**: elegibilidade, validade (`now()` do Postgres), formato contratado, participação, tetos | O cliente nunca informa "valor", só "vi/cliquei" com ids. |
| Leitura | RPC `get_sponsored_ad_report` (só superadmin) | RLS na tabela de agregados + checagem na função. |
| Retenção | Marcadores: hoje + ontem. Agregados: 24 meses | Mínimo para "único no dia" (LGPD) e para contestação de relatório. |

Observação: "visitante único" é **por dia** (e por anúncio/comunidade/formato). Somar dias conta quem volta mais de uma
vez. Único por período exigiria manter marcadores por mais tempo (custo ∝ janela) ou uma estrutura probabilística
(HyperLogLog); fica como decisão (seção 10).

## 3. Coleta no cliente (resumo; não implementada)

- **Impressão visível:** ≥ 50% da área visível por ≥ 1 s contínuo, com a aba em primeiro plano. Um **único**
  `IntersectionObserver` compartilhado (não um por card) e um único timer enquanto houver candidatos (não um por card).
- **Uma vez por (anúncio, formato, comunidade) por visita à página**: re-render, rolagem para cima/baixo e retorno à aba
  não recontam. No rodízio do banner, cada campanha conta quando *ela* ficou visível por 1 s.
- **Cliques:** no CTA do banner/card, enviados no mesmo lote com envio imediato (`fetch` com `keepalive`, para
  sobreviver à navegação para link externo).
- **Envio em lote:** fila em memória; descarrega com ≥ 10 eventos, 15 s após o primeiro, ao ocultar a aba ou em
  `pagehide`. **Offline: descarta** (métrica indicativa não justifica outbox persistente).
- Não envia para superadmin nem para o criador da campanha (o servidor também ignora). Sem rastreamento adicional.

## 4. Evidência financeira — por que o cliente não basta e o que seria necessário

Evento enviado pelo cliente é forjável por quem controla o navegador. Por isso as contagens acima são rotuladas
**indicativas** e a tela do painel deve dizer isso. **Se um dia houver cobrança por impressão (CPM) ou clique (CPC)**,
seria preciso uma segunda fase, que **não** está no rascunho de SQL:

1. **Entrega medida no servidor ("served"):** trocar a leitura REST de anúncios por uma RPC
   `get_community_sponsored_ads(community_id)` que, ao devolver a lista, registra no servidor um fato "anúncio X foi
   entregue ao usuário U na comunidade C no dia D" (uma vez por usuário/anúncio/dia, usando o mesmo marcador). Isso
   fixa um **teto** para impressões: `visíveis ≤ entregues`.
2. **Clique verificado no servidor:** o CTA externo passa por uma Edge Function `/ad-click?t=<token>` que valida um token
   assinado (HMAC de `anúncio+comunidade+usuário+dia`, emitido na entrega) e só então registra o clique e responde 302.
   Clique sem entrega prévia é rejeitado. (Clique interno usa a RPC.)
3. **Conciliação e tráfego inválido:** relatório que compara `entregues ≥ visíveis ≥ cliques`, CTR fora do padrão,
   contas muito novas, picos por conta. Fechamento mensal **imutável** (snapshot com hash) para contestação.
4. **Contrato:** o que conta como impressão/clique para fins de cobrança, tolerância de divergência e quem audita.

Custo extra da fase 2: +1 escrita por usuário/anúncio/dia (marcador de entrega) e a leitura de anúncios deixa de ser um
GET simples (passa a ser `POST` de RPC; o cache em memória continua valendo). Recomendação: **só fazer a fase 2 se e
quando a cobrança por entrega for decidida.**

## 5. Esquema SQL, RPCs e retenção (rascunho)

```sql
-- RASCUNHO PARA REVISÃO -- NÃO é uma migration e não está em supabase/migrations.
-- Métricas de patrocinados: impressões visíveis, visitantes únicos e cliques por
-- anúncio x comunidade x dia x formato (banner | feed).
--
-- Princípios:
--  * O cliente só REPORTA o que viu; o servidor decide se o evento conta (elegibilidade, validade,
--    participação, limites). Os números resultantes são INDICATIVOS (relatório ao anunciante), nunca
--    prova financeira definitiva -- ver a seção "Evidência financeira" do documento da proposta.
--  * Nada de uma linha por evento: só contadores diários + marcadores de deduplicação de curta duração.
--  * Mesmo padrão já usado em record_promotion_event: RPC SECURITY DEFINER, tabela de limites com
--    expiração e purga por pg_cron.

-- ---------------------------------------------------------------------------------------------------
-- 1. Agregados diários: a única tabela de longo prazo (lida só pelo superadmin).
-- ---------------------------------------------------------------------------------------------------
create table public.sponsored_ad_daily_stats (
  day date not null,
  -- Sem FK de propósito: apagar uma campanha (o teto de 6 por comunidade empurra o admin a limpar) não pode
  -- apagar o histórico que o anunciante já pode ter recebido. partner_name é um retrato do momento.
  ad_id uuid not null,
  -- 00000000-... = Home (banner global); qualquer outro valor = comunidade.
  community_id uuid not null,
  format text not null check (format in ('banner', 'feed')),
  partner_name text not null,
  impressions integer not null default 0 check (impressions >= 0),
  unique_viewers integer not null default 0 check (unique_viewers >= 0),
  clicks integer not null default 0 check (clicks >= 0),
  unique_clickers integer not null default 0 check (unique_clickers >= 0),
  primary key (day, ad_id, community_id, format)
);
create index sponsored_ad_daily_stats_ad_day_idx on public.sponsored_ad_daily_stats (ad_id, day);

alter table public.sponsored_ad_daily_stats enable row level security;
create policy sponsored_ad_daily_stats_select on public.sponsored_ad_daily_stats for select
  using (public.is_superadmin());
-- Nenhuma policy de escrita: só a RPC (SECURITY DEFINER) grava.
revoke all on public.sponsored_ad_daily_stats from anon, authenticated;
grant select on public.sponsored_ad_daily_stats to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2. Marcadores de deduplicação e teto por usuário/dia (vida curta: purgados em ~1 dia).
--    Guardam user_id só pelo tempo de decidir "único no dia"; account deletion apaga em cascata.
-- ---------------------------------------------------------------------------------------------------
create table public.sponsored_ad_user_day (
  day date not null,
  ad_id uuid not null,
  community_id uuid not null,
  format text not null check (format in ('banner', 'feed')),
  user_id uuid not null references public.users(id) on delete cascade,
  views smallint not null default 0,
  clicks smallint not null default 0,
  primary key (day, ad_id, community_id, format, user_id)
);
alter table public.sponsored_ad_user_day enable row level security; -- sem policies: ninguém lê pela API
revoke all on public.sponsored_ad_user_day from anon, authenticated;

-- Orçamento diário de eventos PROCESSADOS por usuário (aceitos ou não): protege o banco de laços de chamadas.
create table public.sponsored_ad_user_budget (
  day date not null,
  user_id uuid not null references public.users(id) on delete cascade,
  events integer not null default 0,
  primary key (day, user_id)
);
alter table public.sponsored_ad_user_budget enable row level security;
revoke all on public.sponsored_ad_user_budget from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3. RPC de escrita: lote de até 20 eventos {ad_id, community_id|null, format, type: view|click}.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.record_sponsored_ad_events(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  c_max_batch constant integer := 20;
  c_daily_budget constant integer := 300;
  c_max_views constant smallint := 3;   -- impressões contadas por usuário/anúncio/comunidade/formato/dia
  c_max_clicks constant smallint := 3;
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'America/Sao_Paulo')::date;
  v_is_admin boolean;
  v_total integer;
  v_budget integer;
  v_event jsonb;
  v_ad public.sponsored_ads;
  v_ad_id uuid;
  v_community uuid;
  v_format text;
  v_type text;
  v_count smallint;
  v_accepted integer := 0;
  v_ignored integer := 0;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not coalesce(public.has_app_access(), false) then raise exception 'NO_APP_ACCESS'; end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then raise exception 'INVALID_EVENTS'; end if;
  v_total := jsonb_array_length(p_events);
  if v_total = 0 then return jsonb_build_object('accepted', 0, 'ignored', 0); end if;
  if v_total > c_max_batch then raise exception 'BATCH_TOO_LARGE'; end if;

  insert into public.sponsored_ad_user_budget (day, user_id, events) values (v_day, v_uid, v_total)
  on conflict (day, user_id) do update set events = sponsored_ad_user_budget.events + excluded.events
  returning events into v_budget;
  if v_budget > c_daily_budget then
    return jsonb_build_object('accepted', 0, 'ignored', v_total, 'throttled', true);
  end if;

  v_is_admin := coalesce(public.is_superadmin(), false);

  for v_event in select value from jsonb_array_elements(p_events) loop
    begin
      v_ad_id := (v_event ->> 'ad_id')::uuid;
      v_community := coalesce((v_event ->> 'community_id')::uuid, c_zero);
      v_format := v_event ->> 'format';
      v_type := v_event ->> 'type';
    exception when others then
      v_ignored := v_ignored + 1;
      continue;
    end;

    if v_format not in ('banner', 'feed') or v_type not in ('view', 'click') or v_is_admin then
      v_ignored := v_ignored + 1;
      continue;
    end if;

    select * into v_ad from public.sponsored_ads where id = v_ad_id;
    -- Elegibilidade decidida AQUI, com o relógio e os dados do servidor: campanha existente, no formato
    -- contratado, dentro da validade, e o usuário não é quem criou a campanha (prévia do admin não conta).
    if not found
       or not (v_format = any (v_ad.display_mode))
       or (v_ad.expires_at is not null and v_ad.expires_at <= now())
       or v_ad.created_by = v_uid then
      v_ignored := v_ignored + 1;
      continue;
    end if;

    if v_community = c_zero then
      -- Home: só o banner de campanha global.
      if not (v_ad.is_global and v_format = 'banner') then
        v_ignored := v_ignored + 1;
        continue;
      end if;
    else
      -- Comunidade: campanha direcionada a ela e usuário participante (mesma regra da RLS de leitura).
      if not (v_community = any (v_ad.community_ids)) or not coalesce(public.is_community_member(v_community), false) then
        v_ignored := v_ignored + 1;
        continue;
      end if;
    end if;

    insert into public.sponsored_ad_user_day (day, ad_id, community_id, format, user_id)
    values (v_day, v_ad_id, v_community, v_format, v_uid)
    on conflict do nothing;

    if v_type = 'view' then
      update public.sponsored_ad_user_day
         set views = views + 1
       where day = v_day and ad_id = v_ad_id and community_id = v_community and format = v_format
         and user_id = v_uid and views < c_max_views
      returning views into v_count;
      if not found then v_ignored := v_ignored + 1; continue; end if;

      insert into public.sponsored_ad_daily_stats as s (day, ad_id, community_id, format, partner_name, impressions, unique_viewers)
      values (v_day, v_ad_id, v_community, v_format, v_ad.partner_name, 1, case when v_count = 1 then 1 else 0 end)
      on conflict (day, ad_id, community_id, format) do update
        set impressions = s.impressions + 1,
            unique_viewers = s.unique_viewers + excluded.unique_viewers;
    else
      -- Clique só conta se o mesmo usuário já teve uma impressão aceita hoje (clique sem exibição é forjado).
      update public.sponsored_ad_user_day
         set clicks = clicks + 1
       where day = v_day and ad_id = v_ad_id and community_id = v_community and format = v_format
         and user_id = v_uid and views >= 1 and clicks < c_max_clicks
      returning clicks into v_count;
      if not found then v_ignored := v_ignored + 1; continue; end if;

      insert into public.sponsored_ad_daily_stats as s (day, ad_id, community_id, format, partner_name, clicks, unique_clickers)
      values (v_day, v_ad_id, v_community, v_format, v_ad.partner_name, 1, case when v_count = 1 then 1 else 0 end)
      on conflict (day, ad_id, community_id, format) do update
        set clicks = s.clicks + 1,
            unique_clickers = s.unique_clickers + excluded.unique_clickers;
    end if;
    v_accepted := v_accepted + 1;
  end loop;

  return jsonb_build_object('accepted', v_accepted, 'ignored', v_ignored);
end;
$$;

revoke execute on function public.record_sponsored_ad_events(jsonb) from public, anon;
grant execute on function public.record_sponsored_ad_events(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 4. RPC de leitura para o painel do superadmin (intervalo limitado, CTR calculado no servidor).
-- ---------------------------------------------------------------------------------------------------
create or replace function public.get_sponsored_ad_report(p_from date, p_to date, p_ad_id uuid default null)
returns table (
  day date, ad_id uuid, partner_name text, community_id uuid, format text,
  impressions integer, unique_viewers integer, clicks integer, unique_clickers integer, ctr numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.is_superadmin(), false) then raise exception 'PERMISSION_DENIED'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'INVALID_RANGE';
  end if;
  return query
    select s.day, s.ad_id, s.partner_name, s.community_id, s.format,
           s.impressions, s.unique_viewers, s.clicks, s.unique_clickers,
           case when s.impressions > 0 then round(s.clicks::numeric / s.impressions, 4) else 0 end
    from public.sponsored_ad_daily_stats s
    where s.day between p_from and p_to
      and (p_ad_id is null or s.ad_id = p_ad_id)
    order by s.day desc, s.ad_id, s.community_id, s.format
    limit 5000;
end;
$$;
revoke execute on function public.get_sponsored_ad_report(date, date, uuid) from public, anon;
grant execute on function public.get_sponsored_ad_report(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 5. Retenção (pg_cron, mesmo padrão de purge-promotion-event-limits).
--    marcadores/orçamento: hoje + ontem (basta para "único no dia" na virada de fuso);
--    agregados: 24 meses (contestação de relatório / prazo comercial), depois somem.
-- ---------------------------------------------------------------------------------------------------
select cron.schedule('purge-sponsored-ad-user-day', '10 3 * * *', $$
  delete from public.sponsored_ad_user_day where day < (now() at time zone 'America/Sao_Paulo')::date - 1;
  delete from public.sponsored_ad_user_budget where day < (now() at time zone 'America/Sao_Paulo')::date - 1;
$$);
select cron.schedule('purge-sponsored-ad-stats', '20 3 1 * *', $$
  delete from public.sponsored_ad_daily_stats where day < (now() at time zone 'America/Sao_Paulo')::date - 730;
$$);
```

## 6. Proteção contra abuso

| Ameaça | Mitigação no rascunho | Risco residual |
|---|---|---|
| Console/script enviando eventos forjados | Servidor valida existência, formato contratado, validade (`now()`), comunidade-alvo e **participação**; clique exige impressão aceita no mesmo dia | Um membro autêntico pode inflar até o teto (3 impressões + 3 cliques por anúncio/comunidade/formato/dia) |
| Laço de chamadas (custo no banco) | Lote ≤ 20; orçamento de **300 eventos processados/usuário/dia** (depois responde `throttled` com 1 upsert) | Sem rate-limit de gateway por usuário no Supabase; um laço ainda custa 1 upsert/chamada |
| Várias contas (Sybil) | `has_app_access()` exige conta em dia e e-mail verificado | `unique_viewers` conta contas, não pessoas; anomalias (CTR/contas novas) ficam para a fase 2 |
| Repetição de lote | Tetos por dia; contadores só sobem com `views < teto` | — |
| Falsificar horário | O dia vem do servidor (`America/Sao_Paulo`) | — |
| Inflar com a própria prévia | Criador da campanha e superadmin não contam | — |
| Vazar métricas/ids de usuário | RLS sem policy nos marcadores; agregados só superadmin; funções com `search_path` fixo e `REVOKE` de `public/anon` | — |
| Apagar a campanha apaga o histórico | Agregados **sem FK**, com `partner_name` gravado | Histórico de campanha apagada fica sem ligação com a linha original |

## 6.1 Retenção, privacidade e LGPD

- Marcadores (`sponsored_ad_user_day`, `sponsored_ad_user_budget`): **hoje + ontem**, purga diária às 03:10; apagados em
  cascata se a conta for excluída (`ON DELETE CASCADE` em `users`).
- Agregados: **24 meses** (purga mensal), sem dado pessoal.
- Base legal e aviso: a política de privacidade deve mencionar a contagem agregada de exibição/cliques de publicidade
  (hoje não menciona; texto em `legal/` fica a cargo do jurídico — **pendência**).

## 7. Custos estimados

> **Premissas (estimativas, não medições):** 10 mil usuários ativos/dia, 1,5 visitas/dia com anúncio, ~4 eventos
> aceitos por visita (1–2 banners + 2 cards), 1 chamada em lote por visita (≈ 0,2 chamadas/s em média, ~2/s no pico).

| Item | Estimativa |
|---|---|
| Chamadas RPC | ~15–20 mil/dia |
| Escritas de linha | ~150 mil/dia (≈ 1,7/s): marcador (insert+update) + agregado (upsert) + orçamento (upsert) |
| Armazenamento — marcadores (2 dias) | ~100 mil linhas ≈ 10–20 MB (com índice) |
| Armazenamento — agregados (24 meses) | ~400 linhas/dia (20 anúncios × 10 comunidades × 2 formatos) ≈ 290 mil linhas ≈ 40 MB |
| Tráfego de saída/entrada | ~0,7 KB por chamada ≈ 13 MB/dia ≈ 0,4 GB/mês |
| CPU | ~4 ms por chamada de 4 eventos (**medido** local, ver abaixo) ⇒ ~1–2 min de CPU/dia |
| Ponto de atenção | Linha agregada "quente": todos os eventos de um anúncio numa comunidade atualizam a mesma linha. Aguenta dezenas de eventos/s; acima de ~100/s usar contador fragmentado (N linhas por chave, somadas na leitura) |

**Medido localmente** (Postgres local descartável, transação revertida, um usuário por vez, sem concorrência):
**3,6 ms** por chamada de 4 eventos (primeiro acesso do dia, comunidade "quente"), **3,5 ms** no caminho de teto
(repetição no mesmo dia) e **12,7 ms** por lote de 20 eventos. 500 usuários × 3 passagens geraram 3 linhas de agregado,
~1,5 mil marcadores e 500 linhas de orçamento. **Não medido:** concorrência real (várias conexões na mesma linha
agregada) e latência de rede do Supabase hospedado — entram no teste de carga da seção 8.

## 8. Plano de testes

**Banco (SQL, rodar em `ROLLBACK`; viram pgTAP em `supabase/tests/` na implementação):**
elegibilidade (vencida, formato não contratado, comunidade errada, não membro, campanha própria, id inexistente,
JSON inválido) · deduplicação (teto de 3, único = 1, clique sem impressão) · Home (banner global conta, feed global não) ·
lote > 20 e orçamento diário · acesso negado às tabelas (marcadores ilegíveis, escrita direta negada, agregados só
superadmin) · relatório (permissão, CTR, intervalo) · retenção (purga) · exclusão de conta em cascata.

**Resultado do ensaio do rascunho (já executado, revertido):** 26 verificações, 26 aprovadas — elegibilidade,
deduplicação, tetos, não membro/superadmin/criador, Home, lote e orçamento, permissões de tabela/RLS, relatório,
retenção e cascata na exclusão de conta. O ensaio foi feito numa **transação com `ROLLBACK`** no Postgres local
descartável: nenhum arquivo foi adicionado a `supabase/migrations` e nenhum ambiente real foi tocado.
O roteiro completo está no Apêndice A.

**Cliente (testes unitários, sem navegador):** deduplicação por (anúncio, formato, comunidade) por visita · regra de
50%/1 s (fake de `IntersectionObserver` e relógio) · um único observer/timer · descarga em lote (limiar, 15 s,
`pagehide`) · descarte offline · nenhuma contagem em re-render · clique envia imediatamente com `keepalive`.

**Ponta a ponta (Playwright + PostgREST local, como a matriz de CLS):** rolagem lenta conta 1; rolagem rápida conta 0;
recarregar em laço não passa do teto; cache/voltar à comunidade não recontam; conta não membro não gera linha.

**Carga:** 50 conexões concorrentes chamando a RPC no mesmo anúncio/comunidade (linha quente) para medir latência p95 e
confirmar a decisão sobre fragmentar o contador.

## 9. Rollout e reversão

1. Migration (tabelas + RPCs + `pg_cron`) → homologação com dados sintéticos.
2. Cliente atrás de flag (`VITE_AD_METRICS`), desligada por padrão; ligar por etapas.
3. Painel do superadmin (relatório) em seguida, mostrando "indicativo".
4. **Reversão:** desligar a flag; `cron.unschedule` dos dois jobs; as tabelas podem ficar (sem leitura) ou ser removidas.

## 10. Decisões que preciso de você

1. Fuso do "dia" (`America/Sao_Paulo`) e tetos (3 impressões / 3 cliques por usuário/dia; 300 eventos/dia).
2. "Único" por **dia** (barato) ou por **período** (marcadores por 35 dias ou HyperLogLog)?
3. Retenção: marcadores 1 dia e agregados 24 meses.
4. Fase 2 (evidência no servidor) só se houver cobrança por entrega — confirmar que hoje **não há**.
5. Texto da política de privacidade (jurídico).
6. Onde mostrar o relatório (`AdminSponsoredAds`) e com qual rótulo de "indicativo".

## Apêndice A — roteiro de testes do banco (SQL, roda em `ROLLBACK`)

<details>
<summary>Mostrar</summary>

```sql
-- Testes do rascunho de métricas (SQL puro com asserts). Roda numa transação e termina em ROLLBACK.
-- Cada bloco aborta com "FALHOU: ..." se a expectativa não se cumprir; notice "ok: ..." caso contrário.
\set ON_ERROR_STOP on
begin;
set session_replication_role = replica;

-- ---- cenário -------------------------------------------------------------------------------------------
-- u1 membro, u2 não membro, adm superadmin, bia = criadora das campanhas
insert into public.users (id, role, username, account_status, created_at) values
  ('91111111-1111-1111-1111-111111111111', 'user', 'ana9', 'active', '2026-01-01'),
  ('93333333-3333-3333-3333-333333333333', 'user', 'caio9', 'active', '2026-01-01'),
  ('94444444-4444-4444-4444-444444444444', 'superadmin', 'adm9', 'active', '2026-01-01'),
  ('92222222-2222-2222-2222-222222222222', 'user', 'bia9', 'active', '2026-01-01');
insert into public.communities (id, name, created_by, owner_id, is_active, post_access) values
  ('9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'A', '92222222-2222-2222-2222-222222222222', '92222222-2222-2222-2222-222222222222', true, 'everyone'),
  ('9bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'B', '92222222-2222-2222-2222-222222222222', '92222222-2222-2222-2222-222222222222', true, 'everyone');
insert into public.community_members (community_id, user_id) values
  ('9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '91111111-1111-1111-1111-111111111111'),
  ('9bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '91111111-1111-1111-1111-111111111111');
insert into public.sponsored_ads (id, partner_name, title, community_ids, is_global, display_mode, expires_at, created_by) values
  ('9a000000-0000-0000-0000-000000000001', 'Ambos',   't', array['9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']::uuid[], false, array['banner','feed'], null, '92222222-2222-2222-2222-222222222222'),
  ('9a000000-0000-0000-0000-000000000002', 'Banner',  't', array['9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']::uuid[], false, array['banner'], now() + interval '5 days', '92222222-2222-2222-2222-222222222222'),
  ('9a000000-0000-0000-0000-000000000003', 'Feed',    't', array['9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']::uuid[], false, array['feed'], null, '92222222-2222-2222-2222-222222222222'),
  ('9a000000-0000-0000-0000-000000000004', 'Vencida', 't', array['9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']::uuid[], false, array['banner','feed'], now() - interval '1 minute', '92222222-2222-2222-2222-222222222222'),
  ('9a000000-0000-0000-0000-000000000005', 'Global',  't', '{}', true, array['banner'], null, '92222222-2222-2222-2222-222222222222'),
  ('9a000000-0000-0000-0000-000000000006', 'Propria','t', array['9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']::uuid[], false, array['banner'], null, '91111111-1111-1111-1111-111111111111');

create or replace function pg_temp.as_user(p_uid uuid) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', p_uid::text, true) $$;
create or replace function pg_temp.ev(p_ad text, p_comm text, p_format text, p_type text) returns jsonb language sql as
  $$ select jsonb_build_object('ad_id', p_ad, 'community_id', p_comm, 'format', p_format, 'type', p_type) $$;
create or replace function pg_temp.expect(p_label text, p_ok boolean) returns void language plpgsql as
  $$ begin if not coalesce(p_ok, false) then raise exception 'FALHOU: %', p_label; end if; raise notice 'ok: %', p_label; end $$;

\set ana '''91111111-1111-1111-1111-111111111111'''
\set A '''9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set AD1 '''9a000000-0000-0000-0000-000000000001'''

-- ---- 1. elegibilidade ----------------------------------------------------------------------------------
select pg_temp.as_user(:ana::uuid);
do $$
declare r jsonb; s record;
begin
  r := public.record_sponsored_ad_events(jsonb_build_array(
    pg_temp.ev('9a000000-0000-0000-0000-000000000001', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'banner', 'view')));
  perform pg_temp.expect('membro + campanha vigente no formato contratado: aceito', (r->>'accepted')::int = 1);

  -- campanha vencida, formato não contratado, comunidade errada, campanha própria, lixo
  r := public.record_sponsored_ad_events(jsonb_build_array(
    pg_temp.ev('9a000000-0000-0000-0000-000000000004', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'banner', 'view'),
    pg_temp.ev('9a000000-0000-0000-0000-000000000002', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'feed', 'view'),
    pg_temp.ev('9a000000-0000-0000-0000-000000000001', '9bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'banner', 'view'),
    pg_temp.ev('9a000000-0000-0000-0000-000000000006', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'banner', 'view'),
    pg_temp.ev('a0000000-0000-0000-0000-000000000099', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'banner', 'view'),
    jsonb_build_object('ad_id', 'não-é-uuid', 'format', 'banner', 'type', 'view'),
    pg_temp.ev('9a000000-0000-0000-0000-000000000001', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sidebar', 'view'),
    pg_temp.ev('9a000000-0000-0000-0000-000000000001', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'banner', 'purchase')));
  perform pg_temp.expect('vencida/formato/comunidade/própria/inexistente/lixo: nada conta', (r->>'accepted')::int = 0 and (r->>'ignored')::int = 8);

  select * into s from public.sponsored_ad_daily_stats;
  perform pg_temp.expect('só 1 linha de agregado (a elegível)', (select count(*) from public.sponsored_ad_daily_stats) = 1);
end $$;

-- ---- 2. deduplicação e tetos ---------------------------------------------------------------------------
do $$
declare r jsonb; st record;
begin
  r := public.record_sponsored_ad_events(jsonb_build_array(
    pg_temp.ev('9a000000-0000-0000-0000-000000000001', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'banner', 'view'),
    pg_temp.ev('9a000000-0000-0000-0000-000000000001', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'banner', 'view'),
    pg_temp.ev('9a000000-0000-0000-0000-000000000001', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'banner', 'view')));
  select * into st from public.sponsored_ad_daily_stats where format = 'banner';
  perform pg_temp.expect('teto de 3 impressões/usuário/dia: 3 contadas, 1 ignorada', st.impressions = 3 and (r->>'accepted')::int = 2 and (r->>'ignored')::int = 1);
  perform pg_temp.expect('visitante único no dia = 1 mesmo com várias impressões', st.unique_viewers = 1);

  r := public.record_sponsored_ad_events(jsonb_build_array(
    pg_temp.ev('9a000000-0000-0000-0000-000000000001', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'banner', 'click'),
    pg_temp.ev('9a000000-0000-0000-0000-000000000001', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'banner', 'click')));
  select * into st from public.sponsored_ad_daily_stats where format = 'banner';
  perform pg_temp.expect('cliques: 2 contados, 1 clicante único', st.clicks = 2 and st.unique_clickers = 1);

  r := public.record_sponsored_ad_events(jsonb_build_array(
    pg_temp.ev('9a000000-0000-0000-0000-000000000003', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'feed', 'click')));
  perform pg_temp.expect('clique sem impressão prévia no dia é descartado', (r->>'accepted')::int = 0);

  -- mesma campanha no outro formato é uma linha de agregado separada
  r := public.record_sponsored_ad_events(jsonb_build_array(
    pg_temp.ev('9a000000-0000-0000-0000-000000000001', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'feed', 'view')));
  perform pg_temp.expect('formato feed da mesma campanha: linha própria', (select count(*) from public.sponsored_ad_daily_stats where ad_id = '9a000000-0000-0000-0000-000000000001') = 2);
end $$;

-- ---- 3. quem não conta ---------------------------------------------------------------------------------
select pg_temp.as_user('93333333-3333-3333-3333-333333333333');
do $$ declare r jsonb; begin
  r := public.record_sponsored_ad_events(jsonb_build_array(pg_temp.ev('9a000000-0000-0000-0000-000000000001', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'banner', 'view')));
  perform pg_temp.expect('não membro não conta', (r->>'accepted')::int = 0);
end $$;
select pg_temp.as_user('94444444-4444-4444-4444-444444444444');
do $$ declare r jsonb; begin
  r := public.record_sponsored_ad_events(jsonb_build_array(pg_temp.ev('9a000000-0000-0000-0000-000000000001', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'banner', 'view')));
  perform pg_temp.expect('superadmin (prévia) não conta', (r->>'accepted')::int = 0);
end $$;
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  begin perform public.record_sponsored_ad_events('[]'::jsonb); perform pg_temp.expect('sem login deveria falhar', false);
  exception when others then perform pg_temp.expect('sem login: NOT_AUTHENTICATED', sqlerrm = 'NOT_AUTHENTICATED'); end;
end $$;

-- ---- 4. Home (banner global) ---------------------------------------------------------------------------
select pg_temp.as_user(:ana::uuid);
do $$ declare r jsonb; begin
  r := public.record_sponsored_ad_events(jsonb_build_array(
    jsonb_build_object('ad_id', '9a000000-0000-0000-0000-000000000005', 'format', 'banner', 'type', 'view'),
    jsonb_build_object('ad_id', '9a000000-0000-0000-0000-000000000005', 'format', 'feed', 'type', 'view'),
    jsonb_build_object('ad_id', '9a000000-0000-0000-0000-000000000001', 'format', 'banner', 'type', 'view')));
  perform pg_temp.expect('Home: banner global conta; feed global e campanha não global não contam', (r->>'accepted')::int = 1 and (r->>'ignored')::int = 2);
  perform pg_temp.expect('Home agrega em community_id zero', exists (select 1 from public.sponsored_ad_daily_stats where community_id = '00000000-0000-0000-0000-000000000000'));
end $$;

-- ---- 5. abuso: lote e orçamento diário -----------------------------------------------------------------
do $$ declare v_events jsonb; r jsonb; i int; begin
  select jsonb_agg(pg_temp.ev('9a000000-0000-0000-0000-000000000001', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'banner', 'view')) into v_events from generate_series(1, 21);
  begin perform public.record_sponsored_ad_events(v_events); perform pg_temp.expect('lote de 21 deveria falhar', false);
  exception when others then perform pg_temp.expect('lote > 20: BATCH_TOO_LARGE', sqlerrm = 'BATCH_TOO_LARGE'); end;
  select jsonb_agg(pg_temp.ev('9a000000-0000-0000-0000-000000000001', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'banner', 'view')) into v_events from generate_series(1, 20);
  for i in 1..16 loop r := public.record_sponsored_ad_events(v_events); end loop;
  perform pg_temp.expect('orçamento diário excedido: throttled e nada contado', (r->>'throttled')::boolean and (r->>'accepted')::int = 0);
  perform pg_temp.expect('impressões continuam limitadas pelo teto mesmo sob laço', (select impressions from public.sponsored_ad_daily_stats where ad_id = '9a000000-0000-0000-0000-000000000001' and format = 'banner' and community_id = '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 3);
end $$;

-- ---- 6. permissões de tabela e relatório ---------------------------------------------------------------
do $$ declare n int; begin
  set local role authenticated;
  begin perform 1 from public.sponsored_ad_user_day limit 1; perform pg_temp.expect('marcadores não deveriam ser legíveis', false);
  exception when insufficient_privilege then reset role; perform pg_temp.expect('marcadores ilegíveis pela API (permission denied)', true); end;
  reset role;
  set local role authenticated;
  begin insert into public.sponsored_ad_daily_stats (day, ad_id, community_id, format, partner_name) values (current_date, gen_random_uuid(), gen_random_uuid(), 'feed', 'x'); perform pg_temp.expect('escrita direta deveria falhar', false);
  exception when insufficient_privilege then reset role; perform pg_temp.expect('escrita direta nos agregados negada', true); end;
  reset role;
  set local role authenticated;
  select count(*) into n from public.sponsored_ad_daily_stats;
  reset role;
  perform pg_temp.expect('usuário comum lê 0 linhas de agregado (RLS)', n = 0);
end $$;
do $$ begin
  begin perform * from public.get_sponsored_ad_report(current_date - 1, current_date); perform pg_temp.expect('relatório para não admin deveria falhar', false);
  exception when others then perform pg_temp.expect('relatório: não admin recebe PERMISSION_DENIED', sqlerrm = 'PERMISSION_DENIED'); end;
end $$;
select pg_temp.as_user('94444444-4444-4444-4444-444444444444');
do $$ declare n int; begin
  select count(*) into n from public.get_sponsored_ad_report(current_date - 1, current_date + 1);
  perform pg_temp.expect('relatório do superadmin devolve as linhas agregadas', n >= 3);
  perform pg_temp.expect('CTR calculado no servidor', (select ctr from public.get_sponsored_ad_report(current_date - 1, current_date + 1, '9a000000-0000-0000-0000-000000000001') where format = 'banner') = round(2::numeric / 3, 4));
  begin perform * from public.get_sponsored_ad_report(current_date - 400, current_date); perform pg_temp.expect('intervalo grande deveria falhar', false);
  exception when others then perform pg_temp.expect('intervalo > 366 dias: INVALID_RANGE', sqlerrm = 'INVALID_RANGE'); end;
end $$;

-- ---- 7. retenção ---------------------------------------------------------------------------------------
do $$ begin
  insert into public.sponsored_ad_user_day (day, ad_id, community_id, format, user_id, views)
    values (current_date - 5, '9a000000-0000-0000-0000-000000000001', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'banner', '91111111-1111-1111-1111-111111111111', 1);
  insert into public.sponsored_ad_daily_stats (day, ad_id, community_id, format, partner_name, impressions)
    values (current_date - 800, '9a000000-0000-0000-0000-000000000001', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'banner', 'Ambos', 9),
           (current_date - 5, '9a000000-0000-0000-0000-000000000001', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'banner', 'Ambos', 9);
  -- mesmos comandos dos jobs do pg_cron
  delete from public.sponsored_ad_user_day where day < (now() at time zone 'America/Sao_Paulo')::date - 1;
  delete from public.sponsored_ad_user_budget where day < (now() at time zone 'America/Sao_Paulo')::date - 1;
  delete from public.sponsored_ad_daily_stats where day < (now() at time zone 'America/Sao_Paulo')::date - 730;
  perform pg_temp.expect('purga remove marcadores com mais de 1 dia', not exists (select 1 from public.sponsored_ad_user_day where day = current_date - 5));
  perform pg_temp.expect('purga mantém agregados recentes e remove os de > 24 meses',
    exists (select 1 from public.sponsored_ad_daily_stats where day = current_date - 5)
    and not exists (select 1 from public.sponsored_ad_daily_stats where day = current_date - 800));
end $$;

-- ---- 8. exclusão de conta (LGPD) -----------------------------------------------------------------------
do $$ begin
  insert into public.sponsored_ad_user_day (day, ad_id, community_id, format, user_id, views)
    values (current_date, '9a000000-0000-0000-0000-000000000003', '9aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'feed', '93333333-3333-3333-3333-333333333333', 1);
  set local session_replication_role = origin; -- a semeadura usa 'replica', que desliga as FKs em cascata
  delete from public.users where id = '93333333-3333-3333-3333-333333333333';
  perform pg_temp.expect('excluir a conta apaga os marcadores do usuário em cascata', not exists (select 1 from public.sponsored_ad_user_day where user_id = '93333333-3333-3333-3333-333333333333'));
end $$;

rollback;
```

</details>
