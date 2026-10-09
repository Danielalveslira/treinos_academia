# Dashboard de métricas de patrocinados — Fase 3

> **Estado:** implementado e validado **localmente**. Nenhuma migration foi aplicada no Supabase hospedado, a coleta continua
> **desligada** (build e servidor), nada foi commitado nem publicado. Depende da Fase 2 (`docs/SPONSORED_AD_METRICS.md`):
> migration `20261018000001` (tabelas e coleta) **antes** de `20261018000002` (esta RPC). Sem a Fase 2 a RPC não existe e a tela
> mostra "relatório indisponível neste ambiente".

## Onde fica

**Administração → Anúncios e parcerias** ganhou duas abas: **Campanhas** (lista, criação, edição, exclusão e filtros exatamente
como antes; o botão **+ Novo** só aparece aqui) e **Métricas**. Nenhum item novo de menu. Arquivos: `src/pages/AdminSponsoredAds.jsx`
e `src/features/adMetrics/` (`api/`, `hooks/`, `utils/`, `components/`).

## RPC `get_sponsored_ad_metrics_dashboard`

`(p_days int = 30, p_from date, p_to date, p_ad_id uuid, p_community_id uuid, p_placement text) → jsonb`

- **Somente superadmin**, verificado no banco (`is_superadmin()` é a primeira instrução; usuário comum, sem login ou com filtros
  alterados recebe `PERMISSION_DENIED`; `anon` não tem `EXECUTE`). `SECURITY DEFINER` justificado: lê também a chave
  `sponsored_ad_metrics_settings` (sem GRANT para clientes) para distinguir "coleta desligada" de "sem dados". `search_path` vazio,
  sem SQL dinâmico, **STABLE** (somente leitura). Não toca em `sponsored_ad_event_marks` nem em `user_id`; não altera `record_ad_events`.
- **Intervalo:** `p_days` (1–366, janela terminando **hoje** em `America/Sao_Paulo`, dia definido no servidor) **ou** `p_from`+`p_to`
  (máx. 366 dias, ordem correta, sem futuro, desde 2020). Inválido → `INVALID_RANGE`; posicionamento desconhecido → `INVALID_FILTER`.
- **Fonte:** só `sponsored_ad_daily_stats` (+ `sponsored_ads` e `communities` por join para nomes). Uma passagem por
  `GROUPING SETS` produz tudo; nada de N+1.
- **Retorno** (estável; chaves de topo testadas): `period {from,to,days,today,timezone}`, `filters`, `collection {server_enabled,
  has_any_data, last_day}`, `has_data`, `summary`, `daily[]` (só dias com registro, crescente), `by_placement[]` (Home, banner da
  comunidade, feed), `by_campaign[]` (≤ 50, impressões desc, `ad_id` desempata; `deleted` e nome histórico quando a campanha foi
  excluída), `campaigns_total/campaigns_truncated`, `by_context[]` (≤ 50 por comunidade+posição, com nome da comunidade; Home sem nome),
  `contexts_total/contexts_truncated`. **Os totais nunca são cortados**: só as listas, e o truncamento é sinalizado.
- Cada bloco de métricas traz `visible_impressions, unique_viewers, clicks, unqualified_clicks, qualified_clicks, ctr_qualified, ctr_raw`.

### Fórmulas

| Campo | Fórmula |
|---|---|
| Impressões visíveis | soma de `visible_impressions` (somente eventos aceitos pela coleta) |
| Alcance diário agregado | soma de `unique_viewers` diários (**não** é "pessoas únicas no período") |
| Cliques | soma de `clicks` |
| Cliques sem impressão registrada | soma de `unqualified_clicks` (podem ser cliques rápidos legítimos; nunca tratados como fraude) |
| Cliques qualificados | `clicks − unqualified_clicks` |
| **CTR qualificado** | `qualificados ÷ impressões × 100` (2 casas; `null` se não há impressões) |
| CTR bruto | `clicks ÷ impressões × 100` (secundário, rotulado; pode passar de 100%) |

Tudo é **estimativa operacional**: não é conversão, venda, receita nem prova de entrega para cobrança; cliques não são "visitas".
Sem dados a tela diz "Ainda não há métricas neste período" e nunca inventa números; sem coleta nem dados, "coleta desligada".

## Tela (aba Métricas)

Filtros: 7/30/90 dias (padrão 30), intervalo personalizado (aplicado só no botão, validado no cliente e no servidor), campanha,
comunidade e posicionamento. Cartões (impressões, alcance diário agregado, cliques, CTR qualificado); "Mais indicadores e definições"
(sem impressão registrada, qualificados, CTR bruto); gráfico diário (barras = impressões, linha = cliques; eixos compactos); comparação
por posicionamento; desempenho por campanha com busca/ordenação **locais**; detalhe de campanha (uma leitura filtrada, cacheada);
lista por comunidade e posicionamento. Mobile first (grade de 2 colunas, alvos ≥ 36 px), claro/escuro pelo tema do Primer.

### Estados distintos

carregando · erro de rede (mantém o **último snapshot válido** com aviso e "Tentar de novo") · offline (não consulta) · sem permissão ·
relatório indisponível (função inexistente = migration ausente) · filtro inválido · coleta desligada sem dados · sem dados no período ·
dados existem mas a coleta está desligada agora (aviso + números já registrados).

## Custo de leitura e desempenho (frontend)

- A aba é `React.lazy` e o gráfico também; a aba **só é montada ao ser aberta** (testado: antes disso, zero leitura) e depois fica
  montada/escondida (mantém filtros e cache ao alternar abas, sem refetch).
- **Uma** leitura principal ao abrir; **uma** ao tocar em Atualizar (descarta o cache da conta); **uma** por combinação de filtros
  nova; combinação já vista = cache em memória (por conta, sem TTL, sem IndexedDB/localStorage). Sem polling nem Realtime.
  Filtros ficam desabilitados durante a leitura; respostas de filtros antigos são descartadas.
- Reaproveita `ads` e `communities` já carregados pela página (nenhuma consulta extra para os seletores).

## Medições

**Reais, locais** (Postgres 17 local 2 vCPU; 146.400 linhas de agregados = 366 dias × 20 campanhas × 20 comunidade/posição):

| Janela | Tempo da RPC | JSON (não comprimido) |
|---|---|---|
| 7 dias | 4,8 ms | 13,5 KB |
| 30 dias | 13 ms | 17,9 KB |
| 90 dias | 33 ms | 28,8 KB |
| 366 dias | 153 ms | 79 KB |
| 30 dias, 1 campanha | 4,5 ms | 12,0 KB |

Iterações: a primeira versão (CTE materializada lida 5 vezes) levava ~440 ms em 366 dias (estourava `work_mem`, temporário em disco);
trocar por `GROUPING SETS` sozinho não ajudou (~510 ms) porque o `array_agg(... order by day desc)` do nome histórico custava ~370 ms;
o nome da campanha excluída passou a ser buscado só para as linhas devolvidas. **Nenhum índice novo**: a PK `(day, …)` serve ao
intervalo por dia (índice por `ad_id` só se um relatório por campanha em intervalos longos ficar lento). Estimativa: 1 janela
longa usa ~0,15 s de CPU; uso humano é de poucas leituras por sessão.

**Navegador** (Chromium headless, componentes reais + RPC real sobre dados sintéticos de 90 dias, 11 mil linhas; harness com bundle
único, **não** o app completo nem o Supabase hospedado): 390 px — 1 requisição ao abrir (14,9 KB), Atualizar +1, 7 dias +1, voltar a
30 dias +0 (cache), Detalhes +1, reabrir detalhe +0, buscar/ordenar +0; **sem rolagem horizontal** a 320/390/430/768/1280 px, claro e
escuro; sem erros no console; cartões visíveis em 380–480 ms (1×), ~0,95 s (4×), ~1,3 s (6×) neste harness. CLS **0,0998 em 4×/6×**
antes de corrigir o cabeçalho (o texto do período quebrava linha e empurrava os filtros); depois, **CLS 0** em 1×/4×/6× e a
320/390/1280 px. Rede lenta emulada (400 ms, 50 KB/s) foi dominada pelo download do bundle único do harness e **não é conclusiva**
sobre o app; o payload da RPC (≈ 15 KB em 30 dias) é a parte que importa.

**Bundle** (`npm run build && npm run budget`: Budget OK): boot JS gzip 303.177 B contra 303.172 B antes (nenhuma mudança relevante).
Chunks lazy novos: `AdMetricsTab` 19,4 kB (6,6 kB gzip) e `DailyChart` 1,7 kB (0,9 kB gzip); `recharts` já estava no chunk `charts`.
O tamanho do chunk `AdminSponsoredAds` antes da mudança não foi medido isoladamente.

**Estimado/não medido:** custo no Supabase hospedado (rede, cota de CPU), volumes acima de 146 mil linhas, desempenho em aparelho físico.

## Testes

pgTAP `supabase/tests/sponsored_ad_metrics_dashboard_test.sql` (75): permissões (anon, sem login, comum, filtros adulterados), tabela vazia,
várias campanhas/comunidades/posições/dias, somas, não qualificados ≤ cliques, CTRs e divisão por zero, janela e `today` em
America/Sao_Paulo, intervalos/filtros inválidos, campanha excluída (inclusive após a coleta), 60 campanhas/contextos com totais
preservados e truncamento sinalizado, ausência de `user_id`/marcadores, chaves estáveis. React: `AdMetricsTab.test.js` (14),
`AdminSponsoredAds.test.js` (2), `metrics.test.js` (9). Suíte completa: 1576 testes ok; Fase 2 (179 pgTAP + concorrência) sem regressão.

## Pendências para homologação e ativação

- Aplicar as duas migrations em homologação (ordem 01 → 02) e conferir `get_sponsored_ad_metrics_dashboard` com superadmin real.
- Homologar visualmente a aba no app real (menu admin, PWA, aparelho físico) com dados sintéticos **somente em ambiente de teste**.
- Aprovação jurídica/base legal e política de privacidade (`docs/SPONSORED_AD_METRICS_PRIVACY_DRAFT.md`) antes de ligar a coleta.
- Decidir tetos, retenção (48 h / 24 meses) e se um índice `(ad_id, day)` será necessário após volume real.
- Futuro (fora de escopo): exportação, relatório para o patrocinador, integração com faturamento (não feita nem prevista aqui).
