# Home Inteligente V4

A conclusão é um evento explícito persistido pelo servidor. Registrar séries significa atividade,
não conclusão. Não há backfill de conclusões antigas. Segunda, 26/10/2026: A (seg/qua/sex) inicia,
passa a “Continuar ficha” após registro e, depois de finalizar validamente, dá lugar a B
(ter/qui/sáb), com próxima data 27/10. Se apenas A existir, a próxima ocorrência é 28/10.

## Estados e ordenação

- `unavailable`: arquivada, vazia ou com exercício indisponível; não iniciar.
- `completed`: evento servidor para a ficha e o dia de São Paulo.
- `in_progress`: atividade persistida hoje sem evento de conclusão.
- `not_started`: nenhuma dessas evidências hoje.

Primeiro continuar fichas em andamento (agenda de hoje, depois `sort_order`, `id`). Em seguida,
pendentes agendadas hoje, por maior tempo sem atividade, `sort_order`, `id`. Depois, a ocorrência
futura mais próxima entre fichas agendadas, desempate por ordem e ID. Sem agenda, escolher
pendente por recência/ordem. Todas sem agenda concluídas: estado explícito, sem CTA para iniciar.
A próxima ocorrência futura abre o detalhe, não inicia treino de hoje. Os cartões medem última
utilização e dias distintos com registros, inclusive fichas arquivadas.

## Contratos e segurança

`complete_workout_sheet(p_sheet_id uuid)` retorna JSON com `status`: `completed`,
`already_completed`, `insufficient_activity` ou `not_allowed`; inclui `awardedCoins` quando
aplicável e `business_day` em sucesso. Autenticação, sessão ativa e acesso usam
`private.sheet_actor()`. Dia e horário vêm de `private.sp_today()`/servidor.

Exige ficha própria disponível, com itens disponíveis, e ao menos um registro atribuído à ficha,
datado de hoje e criado pelo servidor hoje. O esforço mínimo continua sendo o critério **diário**
de `complete_workout_session()`, chamado na mesma transação; não exige registrar todos os itens
planejados. Não duplica o motor econômico. Atividade de outra ficha, sozinha, não basta. Um
registro desta ficha pode bastar se o esforço diário já é suficiente. Zero moedas não impede
conclusão. Treino livre e clientes antigos continuam usando a RPC original.

A chave primária `(user_id,sheet_id,business_day)` e o advisory lock por ficha/dia serializam
retries e abas concorrentes. A engine existente serializa o pagamento diário. A RPC e a inserção
na tabela são uma transação; erro reverte ambas. Retry após resposta perdida devolve
`already_completed`. FKs garantem mesmo titular e exclusão em cascata de conta/ficha. RLS permite
somente leitura própria com acesso ativo; clientes não têm INSERT/UPDATE/DELETE. Funções usam
`SECURITY DEFINER`, search path vazio e grants explícitos.

## Frontend, cache e offline

Antes de finalizar, lê o dia servidor e sincroniza as mutações desse dia. Pendências, conflitos,
offline, erro e esforço insuficiente bloqueiam a navegação. Ref bloqueia clique duplicado; erro
libera retry. Sucesso invalida o cache existente por usuário e navega ao histórico. Não há moedas
nem conclusão locais. Uma única RPC de resumo atende a Home; cache/deduplicação/invalidações já
existentes continuam ativos. A virada usa o timer existente do banner, sem polling novo.

`sheet_id` passa apenas no create offline, permanece na linha local e no create compactado com
edições; ACK mantém o vínculo. Updates não enviam associação. O servidor valida a associação
pelos triggers existentes, mantém a imutabilidade e aceita clientes antigos sem `sheet_id`.
Ficha arquivada/indisponível durante desconexão gera erro visível e preserva a pendência local;
não se remove o vínculo para forçar sincronização. A data original da atividade é preservada.
Atividade antiga sincronizada depois não vira conclusão retroativa. Sem rede, a Home oferece
fallback de treino livre e não presume conclusão.

Diálogos pesados da Home agora usam importação sob demanda, sem aquecimento automático no idle.
Fotos AVIF/WebP, seleção diária, prioridades e composição foram preservadas.

## Migrations e consulta

Novas migrations, depois das existentes:

- `20261125000001_home_sheet_completions.sql`: tabela, RLS, RPC de conclusão e resumo atualizado.
- `20261125000002_offline_sheet_attribution.sql`: extensão compatível do protocolo de sync.

A última atividade usa lateral com LIMIT 1 e a contagem mensal tem filtro de datas separado.
Reutiliza `workouts_sheet_activity_idx(user_id,sheet_id,date desc) INCLUDE(created_at)`; não
adiciona índice redundante. O resumo conserva até 40 fichas ativas e dois candidatos históricos.
Os scans por ficha são internos ao banco; não há consulta por ficha no browser.

Medição local real, 45 fichas (5 arquivadas), planos exatos antes/depois, uma rodada de aquecimento
e três amostras, `EXPLAIN (ANALYZE, BUFFERS)`. Valores em ms:

| Registros | Antes | Depois | Shared hits antes/depois | Payload antes/depois |
| --- | --- | --- | --- | --- |
| 2.000 | 21,819 / 23,427 / 19,525 | 12,811 / 14,723 / 10,398 | 674 / 1.034 | 11.066 / 12.105 B |
| 10.000 | 72,784 / 64,625 / 67,965 | 12,396 / 12,875 / 12,149 | 924 / 1.348 | 11.066 / 12.105 B |

Shared reads foram zero em todas essas amostras. Há redução de tempo nesta massa, mas **aumento**
de buffer hits e payload; isso não comprova ganho de I/O frio. CPU compartilhada e caches quentes
limitam a extrapolação. Planos completos: [sql-plans.json](home-v4-evidence/sql-plans.json).

## Validação e limitações

- `npm test`: 2.238 testes aprovados; lint e build aprovados.
- SQL em banco local migrado: 79 suítes, 3.380 asserts, sem skips/falhas; a suíte V4 recebeu
  posteriormente mais dois casos (ficha vazia e criação offline de ficha arquivada), também
  aprovados: total atual 3.382 asserts, suíte V4 com 23.
- Instalação limpa: 173 migrations aplicadas em banco Docker novo com esquema Auth/Storage;
  os 23 asserts de conclusão passaram tanto nele quanto no banco anteriormente migrado.
  A preparação inicial detectou papéis Auth ausentes; os papéis padrão foram criados apenas
  no banco descartável antes de repetir a restauração e executar as migrations.
- `npm run test:functions`: 207 testes aprovados no PostgreSQL local.
- `home-v4-sql-evidence.mjs`: duas transações reais concorrentes, uma conclusão e retry
  `already_completed`; captura os planos antes/depois. Adicionado ao CI.
- `home-v2-browser-smoke.mjs`: 10 cenários de viewport/tema, 120 combinações de fotos, sem erros;
  inclui conclusão A → B com CPU 4x mais lenta, cache e virada do dia. Usa fronteira HTTP
  sintética; autorização/economia são verificadas separadamente no PostgreSQL.
  Atualização para “Continuar”: 157/188 ms; conclusão → B: 134/154 ms (claro/escuro,
  390 px), sem overflow. Tempos incluem a fronteira HTTP local, não latência de produção;
  [medição completa](home-v4-evidence/home-v4-cpu.json).
- `format:check` global já falha na base: 141 arquivos; candidato inicial: 140. Não houve
  formatação em massa; arquivos de código desta entrega foram verificados individualmente.
- Budget global já falha na base: 374.740 B JS gzip, 78.517 B CSS, 13 arquivos. Candidato:
  375.435 B JS, 78.517 B CSS, 13 arquivos; delta +695 B JS. Limites permanecem 330.371 B JS,
  77.839 B CSS e 6 arquivos. O gate não está verde, sem aumento de thresholds.

As dependências já estavam instaladas nesta retomada; `npm ci` não foi repetido durante os
processos de validação para preservar o ambiente em uso. O CI executa instalação pelo lockfile.
O PR deve permanecer em rascunho enquanto gates globais falharem. Evidências são de ambiente
local descartável, sem validação ou alteração de produção.

## Rollout e rollback

Depois de revisão e autorização explícita: aplicar primeiro as duas migrations, validar RPC,
RLS e sync em staging; depois liberar frontend. Cliente antigo funciona com servidor novo.
Cliente novo requer as novas RPCs/migrations: não publicar frontend antes do banco.

Em regressão, reverter o frontend à versão anterior e manter as estruturas aditivas. A versão
anterior não usa os eventos de conclusão, mas os preserva; não apagar tabela, eventos nem
receipts. Corrigir banco por nova migration revisada, sem editar migrations aplicadas. Nenhum
merge, deploy ou `db push` de produção foi executado nesta entrega.
