# Métricas de patrocinados — Fase 2 (coleta)

> **Estado:** infraestrutura de **coleta** implementada e validada localmente. **Coleta desligada** (flag de build ausente e
> chave do servidor em `false`). Nenhuma migration foi aplicada no Supabase hospedado, nada foi publicado, não há dashboard.
> Substitui o rascunho `docs/SPONSORED_AD_METRICS_PROPOSAL.md` (que fica como histórico das alternativas descartadas).
> As métricas são **estimativas operacionais**, não comprovação de entrega para cobrança.

## 1. Definições

| Métrica | Definição exata |
|---|---|
| **Impressão visível** | Anúncio vigente com **≥ 50% da própria área visível por 1 s contínuo**, aba visível e online. Renderizar, carregar a imagem, estar fora da tela ou rodar timer **não** conta. Uma por campanha + contexto + posição por **sessão de exibição** (ver 4). |
| **Clique** | Interação humana (`click` confiável ou botão do meio) no CTA. É enfileirado sem esperar rede e **nunca** bloqueia a navegação (interna, externa, WhatsApp). **Não depende de impressão prévia** (ver 1.1). **Não** prova que o destino abriu e **não** é conversão nem receita. |
| **Alcance único diário** | Uma conta contada **uma vez** por `(anúncio, posição, contexto, dia)`. Decidido **no servidor** pelo marcador temporário; impressões de sessões diferentes continuam somando em `visible_impressions`. |
| **CTR** | `clicks ÷ visible_impressions × 100`, calculado só na leitura futura (Fase 3), com guarda de divisão por zero. Nada é gravado. |
| **Dia** | Fecha à meia-noite de **`America/Sao_Paulo`** (03:00 UTC), calculado no servidor por `private.ad_metrics_day()`. O relógio do cliente nunca define dia nem validade. Timestamps em UTC. |

### 1.1 Clique sem impressão (clique rápido) e CTR

O usuário pode tocar no CTA antes de completar 1 s a ≥ 50% visível, ou antes de a impressão chegar ao servidor. Exigir impressão
prévia descartava esses cliques legítimos (e fazia o CTR subestimar). Estratégia adotada:

- O clique é aceito **sem** impressão prévia, com as mesmas validações (campanha vigente, posição, participação, acesso),
  idempotência e teto (5/dia por conta/chave). **Nenhuma impressão é criada** para justificá-lo: o cliente só enfileira o que
  de fato ocorreu e o servidor nunca sintetiza eventos.
- O servidor separa o que não tem impressão retida: `clicks` conta todos; `unqualified_clicks` (subconjunto) conta os cliques de
  contas **sem impressão aceita (retida, 48 h) naquela chave** no momento do clique. No mesmo lote, a impressão é processada
  **antes** do clique (independente da ordem do array), então "impressão no buffer + clique" sai qualificado.
- **Efeito no CTR (Fase 3, não calculado agora):** `CTR bruto = clicks ÷ visible_impressions` pode passar de 100% em campanhas de
  pouca exposição ou sob forja; `CTR qualificado = (clicks − unqualified_clicks) ÷ visible_impressions` mantém a definição
  estrita. O relatório deve mostrar os dois e rotular "estimativa". `unqualified_clicks` alto em relação a `clicks` é sinal de
  forja ou de coleta de impressões falhando.
- Limitação conhecida: um clique cuja impressão chega em um lote **posterior** conta como não qualificado (classificação
  conservadora). Na prática o cliente envia a impressão primeiro e, se a aba continua visível após o clique, leva clique e
  impressão no mesmo lote.
- Eventos do navegador são manipuláveis: clique sem impressão custa ao falsificador o mesmo que uma impressão forjada (limitado
  pelos tetos). Continua **estimativa operacional**, não base de cobrança.

**Posição (`placement`)** = formato + lugar, valores reais do app:

| `placement` | Onde | Elegibilidade no servidor |
|---|---|---|
| `home_banner` | Banner rotativo da Home | `is_global` e `banner` em `display_mode`; contexto = Home (uuid zero) |
| `community_banner` | Banner rotativo da comunidade | comunidade em `community_ids`, `banner` em `display_mode`, usuário membro |
| `community_feed` | Card no feed da comunidade (topo e intercalados) | comunidade em `community_ids`, `feed` em `display_mode`, usuário membro |

A mesma campanha em dois formatos/lugares mantém **contadores separados**. Não existe "anúncio futuro": `sponsored_ads` só tem
`expires_at` (sem data de início).

## 2. Modelo de dados (`supabase/migrations/20261018000001_sponsored_ad_metrics.sql`)

- **`sponsored_ad_daily_stats`** — PK `(day, ad_id, placement, context_id)`; `visible_impressions`, `unique_viewers`, `clicks`
  (`bigint`, `>= 0`, `unique_viewers <= visible_impressions`), `unqualified_clicks` (subconjunto de `clicks`, ver 1.1), `partner_name` (retrato do dia) e `updated_at`. Sem FK para o
  anúncio de propósito (apagar a campanha não apaga o histórico). Leitura só do **superadmin** (RLS); ninguém escreve pelo
  cliente.
- **`sponsored_ad_event_marks`** — **um** marcador temporário por evento aceito: `(user_id, event_id)` PK, `kind`, `day`,
  `ad_id`, `placement`, `context_id`, `expires_at` (+48 h). Faz três coisas com **uma escrita**: idempotência (retry não
  conta duas vezes), alcance único (primeira impressão do dia da chave) e tetos por usuário. *Combinação dos marcadores 2 e 3
  do pedido:* evita uma segunda tabela e uma segunda escrita por evento; a unicidade do "primeiro do dia" é protegida por
  lock consultivo por usuário (testado, ver 5). Sem `SELECT`/`INSERT` para ninguém; apaga em cascata com a conta.
- **`sponsored_ad_metrics_settings`** — singleton `collection_enabled` (**`false` por padrão**), chave de servidor
  independente da flag de build.
- **Contexto estável:** `context_id` é sempre `NOT NULL`. A Home usa o uuid zero (sem FK); constraint garante
  `home_banner ⇔ uuid zero`. Nada depende de `NULL` em chave única.
- **Sem tabela de eventos brutos.** Índices: apenas as PKs. Um índice em `expires_at` foi **medido e descartado** (limpeza
  horária de ~3% de 150 mil linhas: ~16 ms sem índice contra ~14 ms com; o índice custaria ~9 MB e uma escrita por evento).
  Agregados por anúncio (Fase 3) usam a PK por dia; se o relatório por `ad_id` ficar lento, criar `(ad_id, day)` então.

### RPC `record_ad_events(events jsonb)`

- `SECURITY DEFINER` **justificado**: as tabelas não têm escrita para clientes (dar `INSERT` ao `authenticated` permitiria forjar
  contadores) e a RLS de `sponsored_ads` não vale dentro da função, então a elegibilidade é refeita à mão. `search_path` vazio,
  todo objeto qualificado, **sem SQL dinâmico**, `EXECUTE` só para `authenticated` (revogado de `PUBLIC`/`anon`).
- `user_id` vem **sempre** de `auth.uid()`. Evento: `{id, type: impression|click, ad, placement, community}`; qualquer outro
  campo/tipo/formato, mais de **20 eventos** ou mais de **8 KiB** ⇒ `INVALID_EVENTS` (lote inteiro, nada gravado). Tempo,
  visibilidade e origem declarados pelo cliente **não existem** no contrato.
- Valida **na hora do recebimento**: anúncio existe e está vigente (`expires_at` no relógio do servidor), elegível para a
  posição/comunidade, `has_app_access()` (conta desativada/em exclusão, restrições, aceite legal), `is_community_member()`
  (comunidade ativa, banimento, participação). Evento inelegível é ignorado em silêncio e **não deixa rastro**.
  Superadmin é ignorado (prévias de campanha não contam; **homologue com uma conta comum**).
- Antifraude básica: tetos por conta, **por dia**, por `(anúncio, posição, contexto)`: **10 impressões, 5 cliques**; **300
  eventos aceitos/dia/conta**; mais um teto de rajada de **100 eventos aceitos na última hora** (derivado de `expires_at` dos
  marcadores, sem coluna nem escrita novas; legítimo ≈ 5–10 eventos por visita). Reenvio do mesmo `id` é idempotente. *Os números
  são decisões iniciais ajustáveis (constantes no topo da função).*
- **Chamadas abusivas** (ordem de custo crescente, tudo em leitura; **uma chamada rejeitada não escreve nada**, nem contador de
  rejeição, e não toma o lock do usuário): auth → chave do servidor → contagem/tamanho → forma de cada evento (sem consulta) →
  reenvios (um `ANY` na PK) → conta já no teto (um `count` no prefixo da PK) → acesso → elegibilidade (uma leitura por anúncio
  distinto) → só então lock + gravação. Todos os limites são por `auth.uid()`: um usuário não consome nem altera o teto de outro.
  Não há rate limit por chamada (o Postgres não tem contador gratuito de chamadas rejeitadas, e criar uma tabela de rejeições
  seria uma escrita por requisição abusiva); o custo residual de uma chamada rejeitada é ≈ 0,1 ms (malformada) a ≈ 1,5 ms (20
  eventos válidos de anúncio inelegível). Limite por IP/usuário na borda é responsabilidade da plataforma, fora do escopo.
- Tudo numa **transação**: validação, marcador e incremento (lock consultivo por usuário só quando há algo elegível a gravar,
  para a decisão de "primeira impressão do dia" e os tetos verem a chamada anterior). Agregados são atualizados **uma vez por chave por chamada**
  (`INSERT … ON CONFLICT DO UPDATE SET x = x + excluded.x`, atômico), em **ordem determinística** de chave ⇒ sem deadlock.
- ACK mínimo: `{"enabled": bool, "accepted": n}`. `enabled:false` faz o cliente parar de coletar na sessão.

### Retenção

| Dado | Prazo | Mecanismo |
|---|---|---|
| Marcadores | **48 h** | `pg_cron` horário `cleanup-sponsored-ad-marks` (`private.cleanup_sponsored_ad_metrics()`); pior caso ≈ 49 h |
| Agregados | **24 meses** | `pg_cron` mensal `cleanup-sponsored-ad-stats` |
| Marcadores de conta excluída | imediato | `ON DELETE CASCADE` |

Os dois jobs usam nome fixo (`cron.schedule` substitui, nunca duplica). Prazos são sugestões sujeitas a avaliação jurídica.

## 3. Coletor PWA (`src/services/adMetrics/`, `src/hooks/useAdMetrics.js`)

- `collector.js` (puro, testável): **um** `IntersectionObserver` (`threshold [0.5]`), **no máximo um** timeout de qualificação
  (agendado para o próximo prazo; sem `setInterval`, sem listener de scroll, sem timer por anúncio) e um timeout de envio.
- Aba oculta/`pagehide`/offline **interrompem** o período em curso; voltar recomeça o segundo do zero. Timer atrasado >2 s
  (aba congelada) descarta o período.
- **Sessão de exibição** = permanência no contexto (Home ou uma comunidade). Termina 2 s depois que o último anúncio do
  contexto sai da tela do app; remontagens do React no mesmo commit não a reiniciam. Rodízio do banner mantém a regra por
  campanha; voltar à comunidade conta de novo (o servidor ainda decide o alcance único e os tetos).
- Buffer **em memória** (máx. 100, nunca IndexedDB/localStorage), envio em lote de até **20**, 5 s após o primeiro evento, e
  em `visibilitychange: hidden`/`pagehide`. Retry com **os mesmos ids**, backoff 2 s/4 s, 3 tentativas, depois descarta;
  erro definitivo descarta o lote. Offline não envia nem conta; ao voltar, envia o buffer. Troca de conta/logout zera
  buffer e sessões e o envio confere que o JWT é do dono do lote.
- Saída da página: `fetch` com `keepalive` e o JWT da sessão (beacon sem cabeçalhos não leva token). Cliques nunca esperam.
- `runtime.js` é carregado por `import()` **somente** se `VITE_AD_METRICS_ENABLED === 'true'`; sem a flag os hooks são
  no-ops e nenhum código de coleta é baixado ou executado.
- Sem polling, Realtime, bibliotecas novas, IP, User-Agent, GPS, fingerprint, cookies ou ferramentas externas.

## 4. Flags (duas camadas, ambas desligadas)

1. **Build:** `VITE_AD_METRICS_ENABLED` (ausente = off). Só `true` ativa o coletor no navegador.
2. **Servidor:** `sponsored_ad_metrics_settings.collection_enabled` (padrão `false`). Mesmo com o build ligado, a RPC
   responde `enabled:false` e grava nada; serve de kill switch sem novo deploy.

## 5. Testes

| O quê | Arquivo | Resultado local |
|---|---|---|
| pgTAP (privilégios, RLS, `search_path`, elegibilidade, idempotência, único × impressões, tetos, formato do lote, fuso, retenção, cascata, chave do servidor) | `supabase/tests/sponsored_ad_metrics_test.sql` | 179/179 |
| Concorrência real (30 usuários na linha quente, retry paralelo, teto sob paralelismo, ordem oposta/deadlock, **clique rápido duplicado, teto de cliques sem impressão**) com barreira de tempo | `supabase/tests/sponsored_ad_metrics_concurrency.sh` | OK; **removendo o lock por usuário os cenários C (11 aceitos em vez de 10) e F (17 cliques em vez de 5) falham** |
| Coletor (50%/999 ms/1 s, aba oculta, carrossel, re-render, retorno à comunidade, logout/troca de conta, offline, buffer/retry/idempotência, ACK desligado, sem persistência, **clique rápido / com impressão no buffer / seguido de navegação externa**) | `src/services/adMetrics/collector.test.js` | 33/33 |
| Componentes (flag on/off, CTA interno/externo/WhatsApp, clique sintético, reduced-motion, rodízio) | `src/components/SponsoredAdMetrics.test.js` | 14/14 |

Como rodar localmente (container `pgphase5`; as funções `private.*` pertencem a `supabase_admin` ali):
`docker exec -i pgphase5 psql -U supabase_admin -d postgres -X -q -t < supabase/tests/sponsored_ad_metrics_test.sql`
e `bash supabase/tests/sponsored_ad_metrics_concurrency.sh`.

## 5.1 Medições (locais; não são promessa de custo universal)

**Banco** — Postgres 17 local (container `pgphase5`, 2 vCPU, `shared_buffers` 128 MB), com 150 mil marcadores e 26 mil linhas de
agregados de enchimento (≈ 10 mil usuários/dia × 2 dias; 24 meses de agregados), 300 contas reais:

| Medição | Valor |
|---|---|
| Tempo no servidor por chamada, **tudo aceito** (300 chamadas, sem rede) | 1 evento **1,73 ms** · 4 eventos **1,91 ms** · 20 eventos **4,10 ms** |
| `EXPLAIN (ANALYZE, BUFFERS)` — contagens por chave (prefixo `user_id` da PK, 40 marcadores do usuário) | 0,09 ms, 4 buffers |
| Teto diário (contagem de hoje do usuário) | 0,16 ms, 4 buffers |
| `INSERT` do marcador / `UPSERT` do agregado | 0,14 ms / 0,21 ms |
| Linha quente, 1 cliente × 2688 chamadas (pgbench, com 5 idas ao banco por chamada) | 3,0 ms/chamada, 328 tps |
| Linha quente, 16 clientes × 2688 chamadas | 385 tps, 41 ms de latência média (2 vCPU saturadas), **0 falhas, 0 deadlocks** |
| Tamanho | marcadores: 38 MB heap + 18 MB PK para 150 mil linhas (≈ 370 B/linha); agregados: ≈ 5 MB para 26 mil linhas |
| Limpeza horária (≈ 3% vencido) | ≈ 16 ms (varredura sequencial); 50% vencido: ≈ 660 ms sem índice |

*Não medido:* latência de rede e carga do Supabase hospedado; concorrência acima de 16 conexões; planos com tabelas maiores.

**Estimativas de custo** (premissa explícita: 10 mil usuários ativos/dia, ~7 eventos aceitos por usuário/dia, 1–2 chamadas por
visita): ≈ 15–20 mil chamadas RPC/dia (≈ 0,2/s em média); ≈ 70 mil marcadores/dia ⇒ ≈ 50 MB retidos (48 h);
≈ 400 linhas de agregados/dia ⇒ ≈ 55 MB em 24 meses; tráfego ≈ 0,3 KB por evento (medido: 636 B para 5 eventos em 2 requisições).

**Navegador** — harness em Chromium headless (`playwright-core`), renderizando os componentes **reais**
(`SponsoredAdBanner`, `SponsoredAdCard`, CSS do app) numa página de feed com 30 publicações e 4 cards + banner de 2 campanhas,
com o `supabase` substituído por um servidor local que conta requisições/bytes. Comparação `base` (HEAD, sem esta mudança) ×
`off` (com a mudança, flag desligada) × `on`; 390×844 e 320×640; CPU 1×/4×/6×; leitura com pausa de 1,3 s por anúncio e
rolagem contínua rápida/média. **Não é o app inteiro contra o Supabase hospedado**; CLS absoluto reflete a página de teste.

| Cenário (390 px, CPU 1×) | base | off | on |
|---|---|---|---|
| Impressões registradas na leitura (banner + 4 cards) | 0 | 0 | **5** (`b1,f1..f4`) |
| Requisições / bytes de telemetria | 0 / 0 | 0 / 0 | **2 / 636 B** |
| Rolagem rápida e média sem parar (impressões) | 0 | 0 | **0** (nenhum card fica 1 s a ≥ 50%) |
| CLS (igual em todas as variantes: 0,0258 a 390 px; 0,0363 a 320 px) | 0,0258 | 0,0258 | 0,0258 |
| Frame p95 na rolagem | 16,7 ms | 16,7 ms | 16,7 ms |
| `runtime-*.js` (coletor) requisitado | não | **não** | sim |
| Heap JS ao final | 3249 KB | 3294 KB | 3318 KB |

Com CPU 4×/6×: sem diferença de CLS nem de frame p95 (16,7 ms) entre as variantes; tarefas longas e `TaskDuration` dentro do ruído
entre `base` e `off`; `on` somou ≈ 10–14 ms de `ScriptDuration` na leitura a 6× (carga do chunk e callbacks) e ≈ 50–80 KB de heap.
Rodadas únicas por célula (duas na rolagem): leia como ordem de grandeza, não como diferença estatística.

**Bundle** — `npm run build && npm run budget`: Budget OK. Boot JS gzip **idêntico** ao HEAD (303.172 B antes e depois); o código
dos hooks fica em chunks já lazy e o coletor (`runtime`, ≈ 2,7 KB gzip no harness) só é baixado com a flag ligada. Com a flag
desligada o chunk existe no `dist`, mas nunca é requisitado (verificado no navegador).

## 5.2 Antes × depois da revisão (clique rápido + proteção contra abuso)

Mesmo banco e mesmos dados da seção 5.1 (150 mil marcadores de enchimento, 300 contas, 2 vCPU), função antiga e nova aplicadas
alternadamente; tempo **só de servidor** (300 chamadas por linha, sem rede), média de 2 rodadas. "Escritas" = linhas
inseridas/atualizadas/apagadas nas duas tabelas de métricas (`pg_stat_xact_user_tables`).

| Cenário | Antes (ms) | Depois (ms) | Escritas/chamada | Observação |
|---|---|---|---|---|
| 1 evento aceito | 2,0 | 2,15 | 2 | igual (ruído ±0,3 ms) |
| 4 eventos aceitos | 3,2 | 3,4 | 7 | igual |
| 20 eventos aceitos | 6,6 | 6,85 | 26 | igual |
| Lote malformado | 0,10 | 0,09 | 0 | morre na validação de forma |
| 20 eventos, anúncio inexistente | 1,7 | 1,45 | 0 | 1 leitura de anúncio em vez de 20 |
| 20 eventos, anúncio vencido | 1,4 | 1,2 | 0 | idem |
| 20 eventos, anúncio de outra comunidade | 2,1 | 1,7 | 0 | |
| **Reenvio idêntico de um lote de 20** | **3,5** | **0,63** | 0 | busca única na PK; sem usuário/anúncio/lock |
| **Conta no teto diário (300), eventos válidos** | **2,0** | **0,87** | 0 | `count` no prefixo da PK e sai |
| **Clique sem impressão (anúncio elegível)** | 2,3 (recusado, 0 aceitos) | 3,3 (**aceito**) | 0 → 2 | é o comportamento novo, com a gravação normal |

Carga abusiva, 16 conexões × 8 s (pgbench, 3 rodadas por versão): 20 eventos de anúncio inexistente por chamada **545 → 663
tps** (+22%), **0 linhas escritas** nas duas versões; lote aceito de 4 eventos **266 → 262 tps** (sem diferença, ruído de
±20 tps). Lotes malformados: ≈ 3.200–3.500 tps, 0 escritas. Nenhuma falha ou deadlock.

Não medido: rede/cota do Supabase hospedado. Conta de 300 marcadores no dia faz o `count` ler ≈ 300 linhas (≈ 0,5 ms).

## 6. Deploy e rollback

**Deploy (nada disto foi feito):**
1. Aplicar a migration `20261018000001` no Supabase hospedado (ordem normal; depende de `has_app_access`,
   `is_community_member`, `is_superadmin`, `pg_cron`, schema `private`). Conferir `select * from cron.job where jobname like
   'cleanup-sponsored-ad-%'` (2 linhas).
2. Publicar o frontend **sem** a flag (sem custo: a flag desligada não carrega o coletor).
3. Depois do checklist abaixo: build com `VITE_AD_METRICS_ENABLED=true` **e**
   `update public.sponsored_ad_metrics_settings set collection_enabled = true, updated_at = now();`.

**Rollback (em ordem de rapidez):**
1. Kill switch imediato: `update public.sponsored_ad_metrics_settings set collection_enabled = false, updated_at = now();`
   (clientes recebem `enabled:false` e param).
2. Redeploy sem a flag de build.
3. Remoção total: `select cron.unschedule('cleanup-sponsored-ad-marks'); select
   cron.unschedule('cleanup-sponsored-ad-stats');` e `drop table` das três tabelas e `drop function
   public.record_ad_events(jsonb), private.cleanup_sponsored_ad_metrics(), private.cleanup_sponsored_ad_stats(),
   private.ad_metrics_day(timestamptz)`. Os agregados são perdidos.

## 7. Checklist de ativação futura

- [ ] Política de privacidade revisada e publicada (`docs/SPONSORED_AD_METRICS_PRIVACY_DRAFT.md`), base legal decidida.
- [ ] Migration aplicada em homologação e depois em produção; 2 jobs `cron` presentes; tabelas com RLS e sem `GRANT` a `anon`.
- [ ] Decisão sobre tetos (10 impressões / 5 cliques / 300 por dia / 100 por hora), 48 h e 24 meses.
- [ ] Homologação autenticada com **conta comum** (não superadmin): banner da Home, banner e card da comunidade; conferir
      `sponsored_ad_daily_stats` (impressão, único, clique), um clique rápido (antes de 1 s → `unqualified_clicks`) e que
      não-membro/banido/desativado não geram linhas.
- [ ] Conferir no navegador que, com a flag desligada, `runtime-*.js` nunca é requisitado.
- [ ] Ligar a chave do servidor e o build em etapas; acompanhar erros 4xx/5xx da RPC e o tamanho das tabelas.
- [ ] (Fase 3) RPC de leitura só para superadmin e relatório com rótulo "estimativa".

## 8. Riscos e pendências

- **Privacidade:** marcador temporário liga conta ↔ evento por até 48 h (mínimo necessário). Política ainda não menciona
  publicidade; decisão de base legal pendente. Visitantes anônimos **não** são medidos.
- **Fraude:** um membro autêntico controla o cliente e pode enviar eventos válidos até os tetos (inclusive cliques sem
  impressão, que ficam separados em `unqualified_clicks`); várias contas contam como várias pessoas. Por isso é estimativa
  operacional e não base de cobrança.
- **Cliques:** não confirmam abertura do destino. Podem superar impressões (CTR bruto > 100%) até que a Fase 3 mostre o CTR
  qualificado ao lado.
- **Chamadas rejeitadas** não são limitadas por taxa dentro do banco (ver 2, "Chamadas abusivas"); proteção por IP/usuário na
  borda depende da plataforma. Se a observação em produção mostrar abuso, o próximo passo medido seria limite na borda do
  Supabase, não uma tabela de rejeições.
- **Escala:** a linha agregada de uma campanha/dia é "quente" (serializada por transação curta); medido aqui, sem falhas, mas
  em 2 vCPU local e **sem** rede do Supabase real. Acima de dezenas de eventos/s por campanha, considerar contadores
  fragmentados (não implementado: sem necessidade medida).
- **Dia vs. aceite legal:** `has_app_access()` exige o aceite da política vigente; quem não aceitou não é medido.
