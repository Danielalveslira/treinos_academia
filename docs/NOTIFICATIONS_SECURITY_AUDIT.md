# Auditoria de segurança, robustez e qualidade das notificações (2026-10-05)

Escopo: `notifications`, Realtime, `push_*`, catálogo, lembretes de treino, RPCs, triggers, cron,
worker, Service Worker e frontend. Método: inventário no catálogo do Postgres (local e produção,
somente leitura), leitura do código, provas de fora da API (só com a chave anon pública) e testes
que **falham sem as correções** (mutantes aplicados e revertidos).

## Achados e correção

| # | Achado | Severidade | Correção |
|---|---|---|---|
| 1 | `email_verified_ok(uuid)` era um **oráculo**: qualquer pessoa, até anônima, perguntava se o e-mail de qualquer usuário estava verificado | Média (IDOR de leitura) | `REVOKE` total; só funções DEFINER a usam |
| 2 | 90 das 153 funções `SECURITY DEFINER` com `search_path = public` sem `pg_temp`: o schema temporário é consultado primeiro para tabelas | Defesa em profundidade (hoje **0** referências não qualificadas, verificado por varredura) | `search_path = public, pg_temp` em todas, sem mudar resolução de objetos reais |
| 3 | 59 das 153 funções `DEFINER` executáveis por `anon` (padrão do Supabase) | Média | `REVOKE` de `anon` em 52; ficam 7: a listagem pública de profissionais e 6 auxiliares usados por políticas RLS; o privilégio padrão futuro também foi revogado |
| 4 | Gatilhos `DEFINER` chamáveis por clientes (5) | Baixa | `REVOKE` de `authenticated` |
| 5 | Grants de escrita amplos (`INSERT/UPDATE/DELETE`) para `anon`/`authenticated` em 10 tabelas sensíveis (`notices`, `moderation_decisions`, `support_requests`, `economy_transactions`, `wallets`, `status_economy_votes`…); só o RLS barrava | Defesa em profundidade | `REVOKE`; escrita só por RPC/trigger; `anon` não lê nada disso |
| 6 | View `notification_items` com privilégios de DML | Baixa | `REVOKE` de escrita |
| 7 | `safeActionUrl` (Central), worker, Service Worker e banco não rejeitavam **tab/nova linha/espaço/U+2028**: `"/<TAB>/evil.test"` vira `//evil.test` e abriria redirecionamento em "abrir em nova aba" | Média (open redirect) | Mesma regra nas 4 camadas + `CHECK` no banco + teste de contrato com a mesma lista de URLs maliciosas |
| 8 | `notifications_mark_read/archive` aceitavam lista de ids sem limite | Baixa (DoS) | Máximo de 200 ids |
| 9 | Mensagens de erro persistidas só redigiam o endpoint/chaves da subscription | Baixa | Também removem qualquer URL e token longo |
| 10 | Push de moderação/atendimento revelava a **ação** (suspensão, remoção) na tela bloqueada | Média (privacidade) | Texto genérico para todas as ações; detalhe só dentro do app |
| 11 | Curtir/descurtir/curtir em loop e rajadas geravam Push por evento | Média (spam) | Agrupamento, cooldown e teto por hora (abaixo) |
| 12 | TTL de 1 h e urgência `normal` em tudo | Média (entrega) | Catálogo por tipo: urgência `high` em comentário/resposta/moderação/admin; TTL 24 h (7 dias em moderação) |

## Confirmado sem falha (com prova)

- **Isolamento entre contas**: A não lê, não marca, não arquiva nem reatribui notificação de B (RLS +
  RPC filtram por `auth.uid()`); `recipient_id` nunca vem do cliente.
- **Forja**: cliente não insere em `notifications`, `economy_transactions`, `notices`,
  `moderation_decisions`, `status_economy_votes` nem `workout_reminder_jobs`, e não chama
  `notify_superadmins`, o despachante de lembretes, `claim`/`finish` nem `admin_push_job_trace`.
- **Subscriptions**: sempre da sessão (`auth.uid()`); `unregister` e `get_my_push_status` só enxergam as próprias.
- **Segredos**: nenhum `console.*`, `localStorage` ou resposta carrega endpoint, `p256dh`, `auth`,
  VAPID ou o segredo do worker (varredura estática + teste); o rastreio administrativo não inclui endpoint.
- **Exposição de schemas**: `net`, `cron`, `vault` e `private` **não são alcançáveis pela API**
  (`PGRST106`, testado com a chave anon em produção).
- **Concorrência**: 6 workers em paralelo contra Postgres real enviam 120 de 120 entregas, nenhuma duplicada.
- **Job preso**: `processing` há mais de 10 min é reassumido; recente não é tomado (sem duplicar).
- **404/410** revogam só a subscription inválida.

## Decidi NÃO fazer (e por quê)

- **Revogar `anon`/`authenticated` em `net.*` (pg_net)**: os objetos pertencem ao `supabase_admin` e
  concedem a `PUBLIC`; a role das migrations não é dona nem superusuária (não consegue revogar). Risco
  mitigado: o schema não é exposto na API e o segredo do worker só autoriza **processar a fila** (idempotente,
  sem retorno de dados). Registrado como limitação da plataforma.
- **Trocar `search_path = public` por `''` em massa**: exigiria reescrever 90 funções; sem referência não
  qualificada e agora com `pg_temp` por último, o ganho é nulo e o risco de regressão, alto.
- **Tabela de mensagens no banco**: o catálogo em código (`process-push-outbox/messages.js`) é versionado,
  revisado, importado também pela Central e custa zero consultas por mensagem.
- **Pesos por mensagem**: a rotação determinística evita repetição melhor que sorteio ponderado e não precisa de estado extra.
- **Grupo muscular nos lembretes ("Hoje é Peito + Tríceps")**: o plano semanal só guarda dias e horário.
- **Agregar comentários/respostas**: cada um leva a um comentário diferente; agrupar quebraria a navegação.
- **Atualizar fuso ao viajar sozinho**: muda o comportamento do lembrete sem o usuário pedir; segue valendo o fuso do plano salvo.

## Anti-spam

| Mecanismo | Onde | Regra |
|---|---|---|
| Agrupamento | trigger de enfileiramento | Curtidas na mesma publicação/comentário e alertas administrativos do mesmo tipo esperam 45 s / 30 s e viram **um** job ("@João e mais 3 pessoas curtiram…"); só funde job ainda não tentado |
| Cooldown | `private.push_state` | Mesmo ator + entidade: um Push por 6 h; desfazer **antes** de o Push sair libera o cooldown |
| Teto/hora | `private.push_state` | 30 curtidas, 40 comentários/respostas/menções e 30 alertas admin por hora e tipo; a Central nunca é limitada |
| `tag` no Push | worker + Service Worker | Curtidas/alertas do mesmo alvo **substituem** o aviso anterior no aparelho (`renotify`) |

## Antirrepetição de mensagens

A cada Push o banco avança uma sequência por (destinatário, tipo) em **1 ou 2** passos; o worker usa
`seq mod tamanho do catálogo`. Para qualquer catálogo com 3 ou mais mensagens a mesma não aparece duas vezes
seguidas. A sequência é gravada na outbox no enfileiramento: retry e reprocessamento geram **exatamente o mesmo
texto**. O estado guardado é um inteiro por usuário e tipo (limpo após 30 dias), não um histórico. Treinos usam
os dias desde 2000-01-01 como variante: dias seguidos nunca repetem.

## Preferências

Categorias no catálogo: `social`, `communities`, `economy`, `workouts`, `account`, `administrative`
(equivalentes a social, community, economy, workout, system, admin). Cada tipo tem `critical`: a preferência por
categoria **não silencia** aviso de moderação nem filas administrativas; o interruptor geral de Push continua valendo.
Ainda não há tela de preferências por categoria.

## Desempenho

`pgbench` (8 clientes, 3.200 transações, 200 destinatários): gatilho novo 6,6 ms vs anterior 7,0 ms (social) e
5,4 ms vs 7,1 ms (texto fixo). Claim de 100 jobs: 24 ms. Sem consulta por mensagem, sem polling, sem Realtime novo.

## Telemetria da última milha do Web Push (migration 20261014000007)

Objetivo: saber em qual etapa um Push demora (cron, worker, Push Service, aparelho/Service Worker)
sem mexer no comportamento de entrega (cron, hold, urgency, TTL e reconciliação de subscription
ficam como estão).

Por entrega (`notification_push_deliveries`): `claimed_at`, `worker_started_at`, `provider_accepted_at`,
`last_http_status` (código REAL do Push Service), `sw_received_at`, `show_resolved_at`, `show_failed_at`
(+ `show_failure`, só o NOME do erro), `clicked_at`. A view `private.push_delivery_timeline` calcula as
etapas em ms (hold, espera pelo worker, claim, provedor, provedor→SW, SW→exibição, total).

Segurança:
- o `claim_push_jobs` gera um token opaco de 256 bits por entrega e guarda só o SHA-256; o token em
  claro viaja no payload criptografado do Push e, no aparelho, em `notification.data` (para o clique);
- `push_delivery_ack(token, evento, falha)` é a única função nova executável por `anon`: só avança UMA
  coluna de tempo da entrega dona do token, com o relógio do servidor, uma única vez (retry idempotente),
  e responde igual para token inexistente, inválido ou vencido (>30 dias): sem oráculo;
- `worker_started_at`/`provider_accepted_at` só chegam por `finish_push_batch` (service_role), validados
  (±1h) por `private.push_clock`; HTTP fora de 100–599 vira nulo;
- nenhuma coluna guarda endpoint, p256dh, auth, VAPID, JWT, título/corpo ou metadata;
- no Service Worker o ACK é melhor esforço: o "received" só dispara a requisição, a notificação é
  mostrada logo em seguida, o "shown" vai depois; timeout de 4 s com abort; falhas são engolidas e uma
  falha de `showNotification` continua sendo propagada como antes.
