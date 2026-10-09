# Medição de anúncios — teste de legítimo interesse (LIA) e ECA Digital

> **Rascunho técnico para revisão jurídica. NÃO é parecer jurídico e a base legal NÃO está aprovada.** Registra os fatos verificados
> no código, a análise em três etapas (LGPD art. 7º, IX e art. 10), os controles implementados e os pontos que dependem de decisão
> do responsável (Wellington Daniel Alves de Lira, controlador) e de assessoria jurídica. Prazos tratados como **propostos**: 48 h
> (marcadores) e 24 meses (agregados).

## 1. Operação de tratamento (o que realmente acontece)

| Item | Fato verificado |
|---|---|
| Quem é medido | Contas autenticadas, com aceite vigente (`has_app_access()`), que **não** sejam superadmin; **por padrão, só maiores de 18 anos** (`sponsored_ad_metrics_settings.exclude_minors = true`, migration `20261019000001`) e que **não tenham se oposto** |
| O que se mede | Impressão (≥ 50% visível por 1 s contínuo) e clique no CTA de anúncios "Patrocinado" da Home, banner e card de comunidade |
| O que o app envia | `{id aleatório do evento, tipo, id do anúncio, posição, id da comunidade}` — sem horário, sem User-Agent, sem IP, sem GPS, sem identificador de aparelho (`src/services/adMetrics/collector.js`); a conta vem do JWT no servidor |
| O que fica | **Agregados** por anúncio/posição/contexto/dia (`impressões`, `soma dos únicos diários`, `cliques`, `cliques sem impressão`) — sem identificação, proposta de 24 meses; **marcador temporário** `(conta, evento, tipo, dia, anúncio, posição, contexto)` por 48 h — **identifica a conta enquanto existe** |
| Quem lê | Só o superadmin (RLS + checagem na RPC); marcadores sem leitura para ninguém; anunciantes não têm acesso |
| Perfilamento/direcionamento | **Não há**: a escolha do anúncio depende apenas da comunidade/Home e do rodízio (`listSponsoredAdsForCommunity`, `composeCommunityAds`); a medição não alimenta nenhuma seleção ou personalização |
| Compartilhamento com terceiros | Nenhum; sem SDK/pixel de terceiros |

## 2. Teste de legítimo interesse

**2.1 Finalidade (legítima, específica e concreta).** Saber se os patrocínios exibidos funcionam (alcance, cliques) para gestão
comercial e prestação de contas ao parceiro, e impedir contagem duplicada/abusiva. Não é finalidade nova nem incompatível: trata-se de
serviço publicitário já oferecido e já sinalizado aos usuários ("Patrocinado").

**2.2 Necessidade (dados mínimos).** Alternativas consideradas:

| Alternativa | Resultado |
|---|---|
| Medir sem identificar a conta (contador anônimo) | Não distingue reenvio/abuso nem "alcance"; inflável por script → **inadequado** para o fim |
| Só cliques | Não mede exibição (a base de qualquer CTR) |
| Contar impressões sem alcance único | Possível: eliminaria só o marcador de "primeiro do dia" por conta, mas o marcador continua necessário para idempotência/antiabuso → a economia de dado pessoal seria pequena |
| **Adotada:** agregados anônimos + marcador temporário de 48 h | Menor intrusão que atende ao fim; dado pessoal só no marcador e por tempo curto |

Pontos a o jurídico confirmar: se o **alcance único por conta/dia** é necessário (hoje é a razão de o marcador carregar `conta + dia`).

**2.3 Balanceamento e salvaguardas.** Impacto esperado baixo: sem decisão automatizada, sem perfil, sem uso para segmentar, sem
compartilhamento, sem dado sensível, sem dado de saúde. Salvaguardas implementadas:

| Salvaguarda | Onde |
|---|---|
| Minimização do evento (sem IP/UA/aparelho/horário) | `collector.js`, contrato da RPC (`INVALID_EVENTS` para campos extras) |
| Retenção curta do dado pessoal (marcador 48 h, limpeza horária por `pg_cron`) | migration 01 |
| Sem leitura de marcadores por ninguém; agregados só superadmin | RLS/grants (pgTAP) |
| Tetos (10 imp./5 cliques por chave/dia, 100/h, 300/dia) | RPC |
| Menores de 18 anos fora da medição por padrão; ligar é decisão explícita | migration `20261019000001` |
| **Direito de oposição operacional** (conta registrada em `sponsored_ad_metrics_opt_outs`: passa a ser ignorada e seus marcadores são apagados na hora) | migration `20261019000001` + `admin_set_ad_metrics_opt_out` |
| Transparência: selo "Patrocinado" + seção própria da Política v1.5.0 (texto em `docs/legal-drafts/`) | proposta legal |
| Coleta desligável sem deploy (`collection_enabled`) | migration 01 |

**2.4 Oposição (LGPD art. 18, § 2º).** O texto promete oposição "pelo atendimento". Operação: o atendimento identifica a conta e o
operador executa **como postgres** (SQL Editor): `insert into public.sponsored_ad_metrics_opt_outs (user_id) values ('<uuid>') on conflict do nothing; delete from public.sponsored_ad_event_marks where user_id = '<uuid>';`
(a RPC `admin_set_ad_metrics_opt_out` exige sessão de superadmin autenticado, não funciona no SQL Editor). **Pendência de produto:** não
há botão de autosserviço no app; avaliar se o jurídico exige.

**2.5 Resultado.** Em tese a finalidade e a necessidade se sustentam com as salvaguardas acima; a conclusão sobre **balanceamento
(especialmente adolescentes)** e a escolha entre legítimo interesse e consentimento **cabem ao responsável/jurídico**. O texto da
v1.5.0 foi redigido para legítimo interesse; **não** trata "aceitar a política" como consentimento específico. Se a decisão for
consentimento, são necessários opt-in específico, revogação e bloqueio no cliente e no servidor antes de qualquer registro (não
implementado) — o `collection_enabled` e o `exclude_minors` já permitem **não coletar** enquanto isso.

## 3. ECA Digital (Lei nº 15.211/2025)

*Fontes consultadas (secundárias; o texto no Planalto não pôde ser aberto nesta sessão): [Machado Meyer — vigência em 17/03/2026](https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/direito-digital/estatuto-digital-da-crianca-e-do-adolescente-lei-n-15-211-2025-entra-em-vigor-em-17-de-marco-de-2026),
[Mayer Brown — fiscalização](https://www.mayerbrown.com/pt/insights/publications/2026/04/enforcement-of-brazils-eca-digital-introduces-new-obligations-for-companies),
[Lefosse](https://lefosse.com/noticias/alerta/eca-digital-nova-lei-introduz-mudancas-significativas-no-ecossistema-digital-do-brasil/),
[Demarest — cartilha](https://www.demarest.com.br/wp-content/uploads/2026/03/Cartilha-ECA-Digital_V2.pdf). **Numeração de artigos e
alcance exato devem ser conferidos no texto legal pelo jurídico.***

| Ponto (segundo as fontes) | Situação do Evolutus |
|---|---|
| Aplica-se a produtos/serviços **direcionados** a crianças e adolescentes ou de **acesso provável** por eles; em vigor desde 17/03/2026 | O app aceita **12+** (`minimumAge=12`): há adolescentes ⇒ **dentro do escopo** |
| **Veda perfilamento** de crianças/adolescentes para direcionar publicidade comercial (e análise emocional, RA/RV para esse fim) | A medição **não perfila nem direciona**; anúncios não são segmentados por comportamento. Compatível **enquanto** isso se mantiver; qualquer futura segmentação por uso exigiria nova análise |
| Dados coletados para **verificação de idade** não podem ser reaproveitados para publicidade/personalização | A data de nascimento (autodeclarada) não entra na medição, salvo para **excluir** menores |
| **Contas de menores de 16 anos vinculadas a responsável legal**; verificação de idade não pode depender só de autodeclaração (obrigação primária de lojas de apps/SO, mas com deveres para plataformas) | **Lacuna fora do escopo das métricas:** o cadastro é autodeclarado e **não há vínculo com responsável** para 12–15 anos. É risco jurídico próprio; recomendo tratar com o jurídico **independentemente** da ativação das métricas |
| Sanções (multa até R$ 50 milhões por infração) e fiscalização pela ANPD, com cronograma escalonado (sanções a partir de 2027, segundo uma das fontes) | Reforça o padrão conservador adotado: menores fora da medição por padrão |

**Recomendação conservadora (já implementada como padrão):** manter `exclude_minors = true` até o jurídico aprovar a medição de
adolescentes. Efeito: contas 12–17 anos não geram métricas (subestima o alcance real em proporção a esse público). Para mudar:
`update public.sponsored_ad_metrics_settings set exclude_minors = false, updated_at = now();` (e a política já diz que não há
perfilamento nem direcionamento "também para adolescentes").

## 4. Decisões pendentes (responsável/jurídico)

1. Base legal: legítimo interesse (texto atual) × consentimento.
2. Medir ou não adolescentes 12–17 (`exclude_minors`).
3. Prazos 48 h / 24 meses; necessidade do alcance único por conta/dia.
4. Canal de oposição: atendimento (manual) é suficiente ou exige autosserviço.
5. Transferência internacional (região do Supabase/Vercel) e o texto "podem processar fora do Brasil".
6. Lacuna de responsável legal para < 16 anos (fora das métricas).
