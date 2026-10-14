# AUD-03 — migration aplicada e validada em produção

Data: 14/10/2026. Base local e `origin/main`: `8742621dd22f7a99d09802c8d6826ab9efa73582`.
Migration `20261031000001_aud03_poll_vote_security.sql` aplicada exclusivamente no Supabase `ywrjojrjgozdfpddkkuy`, com journal e smoke confirmados. Não houve saneamento histórico nem alteração de frontend/Edge. A confirmação final do commit, SHA remoto e deploy automático Vercel é informada na resposta de encerramento; este documento integra o commit da entrega.

## Causa raiz e diagnóstico anterior à correção

A policy `status_votes_all` continuava sendo a única policy na stack local, com `WITH CHECK (user_id = auth.uid())`. INSERT não avalia USING: filiação e acesso à publicação eram ignorados. Não havia validação de `type`, opção JSON ou janela de interação. UPDATE/UPSERT também admitiam opções arbitrárias. A identidade de criação e a associação à publicação tinham grants excessivos.

`scripts/verify-aud03-local.mjs --before` reproduziu sete falhas por PostgREST real com usuários criados no Auth e sessões obtidas por senha: não membro votando; opção inventada; ID encontrado apenas em outra enquete; voto em texto; enquete expirada; promoção indicada apenas nos campos cache; opção JSON com ID numérico aceita como texto. Cada inserção foi verificada como sucesso e removida apenas da fixture sintética. A hipótese adicional de vazamento de resultados para anon foi **rejeitada**, sem atribuir uma falha que não ocorreu. Log: `/tmp/aud03/before.log`.

O frontend publicado foi inspecionado por HTTP GET: `https://treinosacademia-ten.vercel.app` e seu módulo `assets/statusesService-Bd_2eawr.js` responderam 200. Esse módulo usa `from("status_votes").upsert({status_id,user_id,option_id})`, compatível com o contrato local. SHA-256 do módulo: `825cd9809a5734b7be0100e7119cbc57067e153efd6cb137f8b506b5cb731b9a`. O asset principal aponta ao projeto `ywrjojrjgozdfpddkkuy`, mas seu hash difere do build local; o pré-check posterior pela API administrativa Vercel confirmou esse deployment como READY no SHA `8742621dd22f7a99d09802c8d6826ab9efa73582` de `origin/main`. A diferença do build local não é usada como substituto da verificação administrativa. Dados públicos dessa inspeção estão nas evidências JSON.

## Mapa do contrato e impacto

- `statuses`: enquete `type='poll'`, opções JSON de 2 a 6 itens; o cliente cria `{id:String(index),label}`. A integridade anterior validava quantidade, sem validar o tipo do ID de cada opção.
- `status_votes`: PK `(status_id,user_id)`, `option_id text NOT NULL`, FK com cascata; índice por usuário. Totais vêm de `count(*) GROUP BY option_id`, sem contador denormalizado ou trigger financeiro de voto de enquete.
- `get_poll_results` e `get_poll_results_batch`: agregados SECURITY DEFINER, nunca devolvem a identidade do votante. Consulta direta mostra apenas o voto do próprio usuário. O lote mantém teto de 100 IDs e omite destinos inacessíveis.
- `is_community_member`: combina acesso à conta, termos, e-mail verificado, comunidade ativa, ausência de restrição e filiação. Superadmin também precisava de filiação para votos/resultados de enquete, embora outras publicações tenham contratos próprios. Essa regra foi preservada. Moderador é o dono da comunidade; foi testado como membro votando em nome próprio.
- Não há atributo pública/privada no schema atual. `post_access='everyone'/'admins'` controla criação de publicações, não autoriza não membros a votar. Ambos os contratos de postagem foram considerados; filiação continua obrigatória. Comunidade excluída remove publicações/votos por FK; comunidade inativa e acesso revogado são negados.
- Janela: usa `private.comments_open` e `private.status_interaction_expiry`, já existentes. Publicação permanente não expira; promoção só estende o prazo quando há registro ativo, não cancelado, com autor/comunidade/destino corretos e vigência válida. Campos cache não autorizam votos.
- `status_economy_votes`, `cast_vote`, apoio/não apoio, EvoCoins/EvoCash e ledger são contratos separados. Não foram alterados. Os testes financeiros e de reações passaram.
- `voteOnPoll` usa UPSERT; a interface impede nova escolha após votar. A API existente permitia troca/cancelamento, que foram preservados dentro da janela e do acesso autorizados; nenhuma nova interface foi criada. PK e agregação mantêm totais exatos sob concorrência.
- Cache: estado individual e totais carregados em lote por `statusInteractionsService`; refresh/invalidação continuam existentes. `pg_publication_tables` local não publica `status_votes` nem `statuses` em Realtime. Não foi criado canal Realtime, worker ou cron. Não houve alteração de frontend; testes JavaScript pertinentes passaram. Não foi feito smoke de navegador com uma votação remota.

## Mudança e matriz de permissões

Migration nova: `supabase/migrations/20261031000001_aud03_poll_vote_security.sql`. Não altera migrations históricas nem percorre/reescreve votos antigos. Quatro policies explícitas, apenas authenticated; helper privado de acesso; trigger de integridade com `search_path=''`; grants por coluna; RPCs de resultados com a mesma verificação de acesso, tipo e prazo. O trigger valida ID JSON **string**, label string e igualdade exata ao ID da opção. Destino, usuário e `created_at` são imutáveis. A leitura de enquetes expiradas também passa a ser negada enquanto o worker ainda não removeu a publicação.

| Operação/cenário | Antes local | Depois local |
|---|---|---|
| INSERT próprio, não membro ou sem acesso | Permitido apenas conhecendo UUID | Negado |
| INSERT em texto/expirada/sem promoção válida | Permitido | Negado |
| INSERT/UPDATE/UPSERT com opção inventada/de outra enquete/ID JSON numérico | Permitido | Negado |
| Identidade de terceiro | INSERT negado por UID | Negado em todas as mutações |
| Trocar destino, usuário ou timestamp | Grants amplos | Identidade imutável; timestamp sem grant |
| SELECT individual | Próprio voto e membro | Próprio voto, membro, poll vigente |
| RPC agregado | Membro; lote valida tipo | Membro e poll vigente; sem identidades |
| anon | Escrita recusada por RLS | Sem grants de voto nem EXECUTE nas RPCs |
| Troca/retry/cancelamento autorizado | API permitia | Preservado; dentro da janela |
| INSERT duplicado / UPSERT concorrente | PK única | PK mantida; totais exatos |

O trigger bloqueia uma única publicação com `FOR SHARE`, sem lock de tabela ou scan integral. Novas policies desconhecidas coexistentes fazem a migration falhar, em vez de deixar um bypass por OR. UPSERT do PostgREST atribui também os campos da PK: seus grants de UPDATE são necessários e o trigger garante imutabilidade. Service role permanece exclusivo de backend; nenhuma chave foi adicionada ao cliente.

## Testes, falhas iniciais e medições

Resultados finais:

- API/Auth/PostgREST local: **96 verificações** (os 94 casos originais e dois novos casos de privacidade de opções), incluindo anon, token sem identidade, membro/não membro, moderador, superadmin membro/não membro, banido, removido, conta desativada/em exclusão/restrita, termos revogados, comunidade inativa, tipos, opções, prazo, promoção válida e falsa, permanência, métodos e RPCs. Doze UPSERTs concorrentes preservaram unicidade e totais. Fixtures de cada execução foram limpas.
- pgTAP: **18 suítes, 730 assertivas**, incluindo AUD-01/02/03/04/05, feed, comentários, participantes, expiração, promoções, compras e retenção financeira.
- JavaScript: **1.912 testes**, nenhum falhando, ignorado ou cancelado; Edge Functions: **152 testes**, nenhum falhando ou ignorado, incluindo concorrência real com seis workers.
- Lint: exit 0, zero erros e 14 warnings existentes. Build: exit 0; aviso existente de chunks acima de 500 kB. `git diff --check` aprovado.

Falhas iniciais foram registradas, não ocultadas: teste de fusos falhava no sandbox por depender de processos filhos e passou fora dele; teste de apoiadores não preparava aceitação legal, corrigida apenas na fixture; expectativas de search_path/grant anônimo do teste de feed foram atualizadas para o novo contrato. Suítes AUD-04/expiração contavam tabelas inteiras e incluíam fixtures antigas da stack. O runner agora limpa essas tabelas **dentro da transação local que o teste reverte**, preservando o estado anterior e sem enfraquecer RLS/grants. Logs iniciais e finais permanecem em `/tmp/aud03/`.

Benchmark local sem a suíte JS concorrendo: 20 enquetes × 200 usuários, 4.000 votos; 1.000 UPSERTs, 100 leituras unitárias e 100 lotes. O contrato anterior foi reconstruído exclusivamente em transação local revertida; a candidata foi medida em outra transação revertida, com os mesmos dados. Médias por chamada SQL:

| Caminho | Antes (ms) | Depois (ms) |
|---|---:|---:|
| UPSERT | 3,551 | 5,873 |
| Resultados unitários | 0,858 | 1,093 |
| Resultados em lote, 20 enquetes | 12,082 | 21,837 |

São medições locais, sem SLA ou extrapolação para produção. O custo adicional de leitura inclui vigência/promoção antes ausente. O lote foi ajustado para validar diretamente as linhas já selecionadas, evitando uma segunda busca de publicação por helper. Última rodada HTTP de voto local: 16,79/7,12/16,84 ms (normal/permanente/promovida). Não há scan do histórico por voto nem índice novo necessário.

## Histórico, recuperação e publicação

Votos locais remanescentes após limpeza: zero. Auditoria de produção: **1 voto histórico**, zero opções inválidas, zero votos em outro tipo de publicação, zero destinos inexistentes, zero duplicidades, zero não membros atuais e zero votos após o prazo base nas verificações realizadas. O digest do voto permaneceu idêntico antes/depois da migration; nenhuma linha histórica foi saneada. `scripts/aud03-production-readonly.sql` prepara journal, policies, grants, funções, triggers e contagens de votos inválidos/duplicados. Ausência de filiação atual ou voto após prazo base exige análise histórica de acesso/promoção, não prova elegibilidade para exclusão. Não houve saneamento automático. Resultados antigos não são filtrados silenciosamente: a migration preserva as linhas e os agregados existentes de enquetes ainda acessíveis.

GitHub: identidade `Danielalveslira`, repo `Danielalveslira/treinos_academia`, branch `main`, origin correto; SHA remoto igual à base local. Alterações alheias de prompts/relatórios de imagens foram preservadas e não incluídas na candidata.

Supabase: o bloqueio inicial foi a ausência de sessão na CLI. A sessão administrativa passou a responder nos comandos oficiais; o projeto foi confirmado ACTIVE_HEALTHY. O pré-check remoto registrou **131 migrations**, todas presentes localmente, com nomes coincidentes e nenhuma versão desconhecida. O conflito de `20261029000001` era real: essa versão pertence a `exercise_visual_deletion`; a candidata ainda não publicada foi renomeada para **20261031000001**, livre também no journal remoto e posterior a `20261030000001_aud05_status_deletion`. Nenhuma migration histórica foi modificada e não se executou `migration repair`.

Schema de `statuses`/`status_votes`, constraints e helpers não modificados coincidem com a stack validada; o estado remoto anterior continha apenas `status_votes_all`, grants amplos e nenhum trigger de voto. O dry-run selecionou exclusivamente AUD-03. Aplicação oficial: `supabase db push --linked --project-ref ywrjojrjgozdfpddkkuy --skip-vault --yes`. Sem Vault, seeds, roles ou outra migration. O journal passou a **132 migrations**, última entrada `20261031000001 / aud03_poll_vote_security`, com **25 statements**. Policies finais: SELECT/INSERT/UPDATE/DELETE para authenticated; anon sem grants de voto/EXECUTE; authenticated com SELECT/DELETE e INSERT/UPDATE por coluna para o payload do UPSERT, sem TRUNCATE/TRIGGER/REFERENCES ou controle de `created_at`; service_role mantém seus privilégios de backend. O digest de todas as funções públicas/privadas fora do escopo AUD-03 permaneceu idêntico, preservando finanças, moderação, expiração e promoções.

Snapshot anterior de policies, funções, grants, constraints, índices e journal: `/tmp/aud03-final/remote-precheck.json`; posterior: `/tmp/aud03-final/remote-postcheck.json`. São metadados e contagens, sem identidades de votantes. O journal local antigo da stack reutilizada continua sendo somente evidência do ensaio; o journal remoto agora foi consultado diretamente, sem inventar entradas locais.

Vercel: a CLI oficial já estava disponível em cache, e a sessão existente foi validada como `danielalveslira`. Projeto **treinos_academia**, ID `prj_WYVlCGYu021KZCrqfp62qRH2cbIE`. Deployment de produção no pré-check: **dpl_GQz78Qa181PMoLEUoD8FGYfU8yR3**, READY, main do repo correto, SHA **8742621dd22f7a99d09802c8d6826ab9efa73582**. Foram inspecionados apenas nomes de variáveis, sem imprimir valores. Não foi necessário novo login Vercel nem alteração de frontend/Edge. A confirmação do deploy automático após o push é registrada no encerramento da execução.

Smoke de produção: `scripts/aud03-production-smoke.sql`, previamente ensaiado localmente, executou **16 verificações** com os papéis reais anon/authenticated. Criou somente usuários/comunidade/enquetes sintéticos em uma transação, testou voto legítimo, duplicidade, troca, cancelamento, opção inválida, expiração, identidade de terceiro, não membro, privacidade da validade das opções e leitura protegida. **ROLLBACK de tudo; zero recompensas/linhas financeiras adicionais; votos existentes idênticos.** Smoke HTTP direto em PostgREST: três leituras protegidas por tabela/RPC negadas para anon com **HTTP 401 / SQLSTATE 42501**, sem escrita. Não foram usados usuários ou votos reais para operações destrutivas.

A revisão final reproduziu um detalhe adicional de privacidade no trigger candidato: BEFORE INSERT roda antes do WITH CHECK, e não membros conseguiam diferenciar opção válida/inventada pelo SQLSTATE. O único ajuste de implementação nesta etapa foi verificar a autorização no trigger **antes** de revelar a validade da opção. Dois testes permanentes adicionais confirmam a recusa uniforme. Não houve relaxamento de segurança para reduzir latência. O aumento do lote na medição final é aproximadamente 9,76 ms para 20 enquetes/4.000 votos; não é um SLA de produção nem evidência de scan do histórico por voto.
Recuperação: antes de uma futura aplicação, capturar definitions/ACLs/journal reais e revisar contra esta candidata; confirmar baseline e aplicar somente AUD-03 por migration transacional. Em falha na aplicação, ROLLBACK preserva policies/grants e dados. Após aplicação, preferir contenção sem perda de votos e migration corretiva: `scripts/aud03-recovery-containment.sql` revoga todas as mutações de clientes, inclusive grants por coluna, mantendo leitura protegida e dados. Esse script foi apenas preparado e **não executado**. Não restaurar a policy vulnerável para recuperar disponibilidade. Se o problema estiver nas RPCs, revogar EXECUTE temporariamente e corrigir com release versionada.

**Resultado:** AUD-03 aplicada, journal/permissões e integridade confirmados, smoke de produção aprovado. Nenhum passivo histórico foi encontrado nas verificações quantitativas, sem excluir/corrigir votos. Riscos residuais: medições de performance são locais; acesso no instante histórico não pode ser reconstruído apenas pela filiação atual; resultados de enquete permanecem sujeitos à janela vigente; o smoke real foi transacional, com rollback, e não uma sessão persistente de navegador. As alterações alheias no workspace continuam preservadas.
