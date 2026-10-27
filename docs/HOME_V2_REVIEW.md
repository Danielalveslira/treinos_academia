# Home V2 — integridade e métricas

> Relatório histórico da Home V2. O trecho de offline descreve a limitação daquela versão; o vínculo offline e a execução exclusiva por fichas foram implementados posteriormente. Consulte [REMOVER_TREINO_LIVRE.md](REMOVER_TREINO_LIVRE.md) para o contrato vigente.

Esta alteração pertence ao PR #76, cuja base permanece `feat/workout-sheets` (#75).
Estado confirmado: a migration `20261123000001_workout_sheet_attribution.sql` foi aplicada ao banco
de produção em **25/10/2026 às 22:34 UTC**, após backup completo, restauração isolada, 44 assertions
pgTAP na cópia dos dados e 19 verificações pós-aplicação. Histórico, fichas e contratos de conclusão/
sincronização permaneceram idênticos. A migration anterior de fichas já estava instalada.
O frontend de produção ainda não foi publicado; os PRs #75 e #76 continuam abertos, sem merge.
A correção de fotografias descrita abaixo não altera nem reaplica migrations e não acessa o banco de produção.

## Associação histórica

`workouts.sheet_id` é um fato do INSERT, não um campo editável. A FK composta mantém
`(sheet_id,user_id)` e usa `ON DELETE SET NULL (sheet_id)` (PostgreSQL 17): nunca anula
`user_id`. O trigger de imutabilidade bloqueia atribuir, trocar e limpar a ficha por UPDATE,
e também bloqueia trocar o exercício de um registro atribuído. Peso, repetições e nota
continuam editáveis mesmo depois de arquivar ou retirar um exercício oficial.

A API pública só permite arquivar fichas, preservando os vínculos históricos. Se uma manutenção
privilegiada excluir fisicamente uma ficha, apenas a ação da FK pode limpar a referência:
a guarda SECURITY DEFINER verifica que o pai já não existe, independentemente de RLS ou JWT.
Não há flag de sessão configurável pelo cliente, nem triggers desativados. O trigger existente
de exclusão da conta continua removendo as fichas antes da biblioteca; a limpeza da FK é
compatível com essa ordem e as cascatas de exclusão dos treinos da conta.

A validação de INSERT usa `private.sheet_actor()` (JWT, sessão ativa e acesso), a biblioteca
do próprio dono, a associação real e a disponibilidade do catálogo oficial. Locks SHARE seguem
a ordem ficha → exercício da biblioteca → catálogo. O nome do trigger faz essa guarda rodar
antes da validação oficial preexistente (que bloqueia o catálogo), evitando ordem inversa.
Os RPCs de edição/arquivamento já bloqueiam a ficha com FOR UPDATE; retirar itens e arquivar
não podem ocorrer entre a validação e o commit do registro. Despublicar/desativar o exercício
também conflita com os locks. Nenhuma guarda nova é exigida em edições históricas legítimas.

## Significado dos indicadores

- Planejamento: itens e metas cadastrados na ficha.
- Utilização: registros persistidos com `sheet_id` validado no INSERT.
- Conclusão: `complete_workout_session()` continua sendo um evento diário, com esforço e
  recompensa validados pelo servidor, sem identificador de sessão por ficha. Não comprova
  conclusão individual e não é usado para inferir esse fato.

A Home mostra **Última ficha utilizada**, **Última atividade** e **Mais dias com registros**.
Um dia com vários exercícios conta uma vez. A interface informa que atividade não comprova
conclusão. Quando a recomendada já tem atividade no dia, informa isso e não mostra o selo
"Recomendado para hoje". Recência usa a data real do registro (`workouts.date`), com carimbo
servidor como desempate; são datas autodeclaradas de atividade, nunca evidência de conclusão.
O mês e o limite de hoje são calculados no PostgreSQL em `America/Sao_Paulo`; datas futuras
não inflam os indicadores. Não há associação retroativa com registros livres antigos.

`get_my_sheet_insights()` retorna numa consulta até 40 fichas ativas, mais os dois candidatos
históricos (última utilização e maior atividade mensal), inclusive arquivados. Transfere apenas
resumos; nenhuma janela de 60 dias, histórico bruto ou consulta por ficha no navegador. O índice
parcial `(user_id,sheet_id,date DESC) INCLUDE(created_at)` suporta a leitura por usuário. O script
`home-v2-sql-evidence.mjs` mede planos reais com 2.001 registros e exercita duas conexões reais
competindo por arquivamento, retirada de item, retirada oficial e INSERT.

## Offline e cache

O protocolo da outbox é uma lista fechada de campos, com compactação de create/update,
recibos idempotentes, reconciliação de ACK perdido e controle de versões. Incluir `sheet_id`
com segurança exigiria migrar em conjunto o payload, a compactação e a reconciliação entre
clientes antigos/novos, inclusive quando uma ficha for arquivada antes do envio. Essa mudança
fica fora desta correção. Novos registros que só existem offline continuam sincronizando como treino livre. Atualizações de
registros já atribuídos preservam o vínculo, inclusive na representação local, sem duplicar
registros ou recompensas. A Home avisa essa exclusão dos indicadores e o registro pendente
numa ficha emite aviso específico. Os indicadores não representam todas as execuções do usuário.

A chave `home-sheet-activity:{uid}:{dia-SP}` integra `invalidateWorkoutCache`. O hook observa
invalidações e agrupa um lote de eventos numa microtask; `fetchCached` deduplica consumidores.
Isso atualiza também a interface montada, sem polling. Registro/edição/exclusão, confirmação de
finalização, mutações de ficha e ACKs da outbox invalidam a consulta. A notificação de sincronização
entre abas invalida apenas o usuário correspondente. Mudança de conta troca o escopo sem reusar
os dados da conta anterior. Mudar o dia troca a chave usando a renderização do relógio já existente
da foto, sem adicionar timer.

## Fotografias e desempenho

A seleção usa exclusivamente `useAuth().profile?.sexo`, sem consulta adicional. Os valores aceitos
são `masculino`, `feminino` e `nao_informar`. Ausência, null, vazio ou qualquer valor desconhecido
usam a sequência neutra; nunca se deduz sexo de nome, foto ou outro campo.

| Posição no ciclo | Masculino | Feminino | Não informado/desconhecido |
|---|---|---|---|
| 1 | `capa` | `sexo_mulher` | `home-banner-anilhas` |
| 2 | `home-banner-anilhas` | `home-banner-anilhas` | `home-banner-equipe` |
| 3 | `capa` | `sexo_mulher` | `home-banner-anilhas` |
| 4 | `home-banner-equipe` | `home-banner-equipe` | `home-banner-equipe` |

O ciclo global começa no dia de época 1970-01-01, usando o contador de dias de `dailyRotationIndex`.
Os dias 26–29/10/2026 correspondem às posições 1–4. Repetir as duas neutras num ciclo de quatro
preserva exatamente a rotação neutra anterior. Recarregar não muda a escolha. As regras estão em
`dashboardBanners.js`; `getProfileHeroImage` mantém o contrato de metadados e passa a ter fallback
neutro explícito. O hook existente recebe a sequência e continua com **um único timeout** até a
meia-noite SP, revalidado por visibilitychange/pageshow. Trocar o perfil seleciona imediatamente
outra sequência sem reiniciar esse relógio nem buscar as fichas novamente.

A fotografia escolhida é a única carregada. Em caso de falha, tenta apenas as neutras aprovadas,
sem duplicar a selecionada nem usar o atleta de outro grupo. Depois de esgotar os candidatos,
permanece o fundo estável. Erros são reiniciados por conta, grupo visual ou dia, inclusive quando
a foto selecionada tem o mesmo nome. Atualizar dados dos treinos mantém o mesmo elemento de imagem.
Retratos usam contain, com a pessoa inteira à direita no desktop e centralizada no topo no mobile;
as horizontais mantêm cover e o enquadramento aprovado. O gradiente, o contraste, as alturas mínimas
e os controles à esquerda permanecem. O aviso de métricas foi reunido num details/summary nativo,
acessível por teclado e fechado inicialmente; continua explicando atividade versus conclusão e a
limitação dos novos registros salvos apenas offline.

### Assets reutilizados e origem

Nenhuma imagem foi substituída, gerada novamente ou baixada nesta correção. Os originais continuam
em `imports/images-source/`, e as variantes AVIF/WebP de **480, 800 e 1024 px** já existem em `public/img/`.
`ResponsivePicture` suporta os quatro nomes sem mudar o componente genérico.

| Asset | Original | Variantes (largura × altura) | Peso das variantes |
|---|---|---|---|
| `capa` | PNG 1145 × 1374 | 480 × 576; 800 × 960; 1024 × 1229 | 13–42 KB |
| `sexo_mulher` | PNG 1024 × 1536 | 480 × 720; 800 × 1200; 1024 × 1536 | 15–50 KB |
| `home-banner-anilhas` | PNG 1672 × 941 | 480 × 270; 800 × 450; 1024 × 576 | assets anteriores preservados |
| `home-banner-equipe` | PNG 1672 × 941 | 480 × 270; 800 × 450; 1024 × 576 | assets anteriores preservados |

O histórico Git rastreia o atleta masculino ao commit `5cee8a4` e a atleta feminina a `ad05811`;
os arquivos foram movidos/otimizados em `8f28e10`. Os PNGs não contêm metadados de autoria/licença,
e não foi encontrado registro individual de licença ou fonte externa no repositório. O reuso dos
mesmos arquivos foi solicitado explicitamente; **a comprovação documental da origem/direitos dos
assets preexistentes permanece uma pendência**, sem presumir que a licença do código a resolva.

O budget existente já falha no HEAD anterior: 374.456 B JS gzip, 78.145 B CSS gzip e 13 arquivos,
contra baseline antigo de 320.749 B / 75.572 B / 6 arquivos. A build inicial desta correção mediu
375.168 B / 78.269 B / 13 arquivos: +712 B JS e +124 B CSS (sem aumentar arquivos nem limites).
Parte do custo herdado vem das entradas públicas incluídas no precache. O baseline não foi
alterado para ocultar a diferença. As medições finais e resultados oficiais são registrados no PR.

## Arquivos da correção

- Banco: `supabase/migrations/20261123000001_workout_sheet_attribution.sql`,
  `supabase/tests/workout_sheet_attribution_test.sql`, `supabase/tests/home_sheet_insights_test.sql`.
- Home: `src/features/home/RecommendedSheetPanel.jsx`, `recommendSheet.js`, `useSheetInsights.js`
  e os testes de painel, recomendação e rotação (`useDailyBanner.test.js`).
- Cache: `src/hooks/useCachedQuery.js` e teste novo, `src/utils/pageCache.js` e teste,
  adaptação do stub em `src/hooks/useSponsoredAds.test.js`.
- Escrita/sincronização: `src/services/workoutsService.js`, `src/pages/NewWorkout.jsx`,
  `src/services/offline/syncScheduler.js`, `outbox.js` e teste de preservação local.
- Fichas: `src/features/workoutSheets/workoutSheetsService.js` e teste de RPC.
- Apresentação: `src/components/ResponsivePicture.jsx`, `src/styles/app.css`.
- Verificação: `scripts/home-v2-browser-smoke.mjs`, `scripts/home-v2-sql-evidence.mjs`,
  `.github/workflows/supabase-tests.yml` e este documento.

## Evidência oficial

O CI completo anterior à restauração da personalização foi aprovado no commit `8cfb865`,
run `40239642723` (js, sql, secrets e finance-quality). A alteração atual executa novamente
o workflow completo sobre seu próprio commit; o link e o resultado final ficam no PR #76.

A primeira execução corretiva no Actions (`40237032754`) aprovou o job SQL: 78 suítes,
3.349 assertions pgTAP, quatro cenários reais de concorrência e 207 testes de funções.
A RPC completa mediu 5,380 ms com 2.001 registros nessa execução. Uma consulta simplificada
feita sob RLS custou 353,339 ms; a evidência final passou a extrair e explicar o SQL exato da RPC,
executado no mesmo contexto privilegiado dela e com filtro explícito por dono. Não confundir
os dois planos nem usar o plano simplificado para avaliar o custo real da Home.

No Codespace, a inicialização dos serviços auxiliares e a rede Docker não são reproduzíveis:
foi possível aplicar todas as migrations em base descartável com ajuste temporário de DNS,
mas o health check do GoTrue encerrou a base antes da suíte completa local. O job SQL oficial,
isolado no runner GitHub, é a prova completa do banco; não foram usados mocks para validar
constraints, segurança, cascatas ou concorrência. Essa limitação local foi posteriormente complementada
pela restauração do backup e verificação da aplicação autorizada em produção, descritas no início.
Nesta rodada de fotografias não há acesso nem alteração de banco remoto.


## Verificação da personalização

`dashboardBanners.test.js` cobre os três grupos, valores desconhecidos, sequência completa,
repetição, metadados e candidatos de fallback. `useDailyBanner.test.js` cobre mudança de perfil,
meia-noite SP, suspensão e retorno sem recarregar; as regras do recomendador permanecem intactas.
O harness `home-v2-browser-smoke.mjs` verifica 120 combinações (três perfis × quatro posições ×
cinco larguras × dois temas), com imagens reais, perfil atualizado em tela, fallback, ausência de
requisições extras, erro/retry, preservação do elemento de imagem após invalidar dados de treino,
layout estável e aviso acessível. Evidências locais ficam em `.finance-local/home-v2-photos/`;
os resultados do CI no commit final são registrados no PR #76.


Arquivos desta rodada de fotografias: `src/constants/profileHeroImage.js`,
`src/features/home/dashboardBanners.js` e novo teste, `useDailyBanner.js` e teste,
`RecommendedSheetPanel.jsx` e teste, `src/styles/app.css`,
`scripts/home-v2-browser-smoke.mjs` e este documento. `dailyRotation.js`, `ResponsivePicture`,
as imagens binárias, migrations e serviços de métricas/escrita permanecem inalterados.


Medição local da alteração de fotos (mesmas variáveis de build antes/depois): boot JS gzip
375.185 → 375.179 B (-6 B), CSS gzip 78.405 → 78.517 B (+112 B), 13 arquivos em ambos.
Nenhuma dependência nem variante de imagem nova. O budget global preexistente continua acima
do limite e não foi alterado. A suíte JavaScript completa passou com 2.221 testes; lint sem erros
(com os mesmos 16 avisos preexistentes) e build aprovado. O CI completo é novamente obrigatório.
