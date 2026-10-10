# Imagens oficiais dos exercícios — operação e homologação

Implementa as Fases 1, 2 e 4 de `docs/promps/Evolutus_arquitetura_imagens_exercicios_V2_auditada.md`
(banco + mídia manual, tela admin e cache offline sob demanda). Fases 5 (API de IA) e 6 (catálogo
completo) **não** fazem parte desta entrega.

Estado: tudo local. Nenhuma migration aplicada em Supabase hospedado, nenhuma Edge Function publicada,
nenhum commit/deploy.

## O que existe

- **Banco** (`supabase/migrations/20261020000001_exercise_visuals.sql`): colunas `source_media_refs` e
  `published_media_refs` em `exercise_catalog`; tabelas `exercise_visual_sets`, `exercise_visual_assets` e
  `exercise_visual_style_profiles` (seed `EVOLUTUS_FITNESS_V1`); buckets `exercise-visual-drafts`
  (privado), `exercise-visuals` (público) e `exercise-visual-references` (privado).
- **RPCs**: `allocate_exercise_visual_set`, `reject_exercise_visual_set`, `restore_exercise_visual_version`
  (superadmin) e `confirm_exercise_visual_internal` / `publish_exercise_visual_internal` (só service_role).
- **Edge Functions**: `exercise-visual-confirm` e `publish-exercise-visual`; helpers em
  `supabase/functions/_shared/` (`webp.ts`, `exerciseVisualPaths.ts`, `superadminAuth.ts`).
- **Tela** `/admin/exercicios-imagens` (SuperAdminRoute, só online): busca, filtro "sem imagem",
  cobertura, prompt, envio, revisão com checklist, aprovar/rejeitar, histórico e rollback. A interface é
  independente de fornecedor de IA ("Criar com IA", "Copiar prompt", "Enviar imagens"); a ferramenta usada
  é só um metadado opcional (`metadata.tool`) e a origem registrada é `manual_upload`.
- **App do aluno**: `exerciseCatalogService` monta `exercise.images` (início, final) a partir de
  `published_media_refs`. As telas `ExerciseCatalog`, `WorkoutExerciseGuide` e `ExerciseDetail` não mudaram.
- **PWA**: o Service Worker guarda sob demanda (cache `treinos-exercise-images-v1`, teto de 100 arquivos)
  só `…/storage/v1/object/public/exercise-visuals/{catalogId}/v{n}/{start|end|thumb}.webp`.

## Compatibilidade `media_refs` / `source_media_refs` / `published_media_refs`

A migration é só de **expansão** (nada é renomeado nem removido):

| Coluna | Quem escreve | Quem lê | Situação |
| --- | --- | --- | --- |
| `media_refs` | ninguém (importador novo não escreve) | frontend/importador **antigos** | **legado**, intacta; remover em migration futura |
| `source_media_refs` | importador novo | importador novo (comparação) | cópia de `media_refs` feita pela migration |
| `published_media_refs` | só `private.apply_published_visual_set` (publicar/restaurar) | frontend novo | nasce `{"images":[]}`; o importador nunca toca |

- `search_exercise_catalog` continua devolvendo `media_refs` e ganhou `source_media_refs` e
  `published_media_refs` (uma única RPC, sem N+1).
- Verificado em banco real: as consultas do frontend/importador antigos retornam resultado **idêntico**
  antes e depois da migration; o backfill copiou `media_refs` → `source_media_refs` nas linhas existentes.
- Coberto por teste: `supabase/tests/exercise_visuals_test.sql` (seção 9/9b: reimportação nova e antiga não
  alteram `published_media_refs`; `media_refs` legado intacta) e
  `scripts/exercise-catalog-import-core.test.mjs` (o plano de importação só carrega `source_media_refs`,
  nunca `published_media_refs` nem `media_refs`).

### Ordem de rollout

1. Aplicar a migration (o frontend antigo segue funcionando).
2. Publicar o frontend novo (usa `published_media_refs`; **não** publique antes da migration).
3. Só depois rodar o importador novo (`source_media_refs`; falha se a migration não foi aplicada).
4. Publicar as Edge Functions (`exercise-visual-confirm`, `publish-exercise-visual` e
   `profile-avatar-confirm`, que passou a importar `_shared/webp.ts`), todas com `verify_jwt = true`.
5. Garantir `VITE_SUPABASE_URL` https no build: sem ela o Service Worker não liga o cache de imagens.
6. **Migration futura** (não nesta etapa): remover `media_refs` e retirá-la de `search_exercise_catalog`,
   somente depois de o frontend novo estar estável em produção.

## Miniatura

`start` e `end` são **obrigatórios**; a miniatura (`thumbnail`, 320 px, gerada no navegador a partir da
posição inicial) é esperada no fluxo normal mas **opcional** no servidor:

- o navegador não aborta o envio se a miniatura não puder ser gerada/enviada;
- `exercise-visual-confirm` ignora uma miniatura ausente/inválida e confirma só start/end; a RPC remove a
  linha reservada da miniatura (o conjunto fica consistente com 2 assets);
- `published_media_refs` só tem a chave `thumbnail` quando ela existe (nunca um path nulo);
- uma miniatura reservada mas **não confirmada** (sem metadados) bloqueia a publicação, para nunca publicar
  nada pela metade;
- start/end/thumbnail são publicados juntos em `{catalogId}/v{n}/` e o rollback restaura exatamente o
  conjunto da versão escolhida (com ou sem miniatura). O app do aluno ainda não usa a miniatura.

## Auditoria das Edge Functions

Revisadas (e executadas em Node com fakes de `Deno`/Supabase, ver
`supabase/functions/_shared/edgeTestKit.js`). Resultado:

| Item | `exercise-visual-confirm` | `publish-exercise-visual` |
| --- | --- | --- |
| JWT | `verify_jwt` + `auth.getUser()` (401 sem/ruim) | idem |
| `service_role` | só no servidor, para ler `users.role`, baixar/copiar arquivos e chamar RPC interna | idem |
| superadmin | `users.role = 'superadmin'` lido com service_role (403 caso contrário) | idem; a RPC interna revalida o ator |
| Dono do conjunto | `created_by = uid`, status `allocated` | status `review` |
| Paths | recalculados e comparados por **igualdade exata** com o alocado (sem `..`, sem outro conjunto/bucket); o cliente nunca informa path | idem, para origem e destino |
| WebP real | cabeçalho RIFF/WEBP (VP8/VP8L/VP8X) **e** tamanho RIFF coerente com o arquivo (detecta truncado) | revalidado antes de copiar |
| Dimensões / tamanho | 64–1024 px (miniatura até 512), ≤ 2 MB | ≤ 2 MB |
| Arquivo ausente | `MISSING_FILE` (400), nada é confirmado | `MISSING_FILE`, RPC não roda |
| Upload incompleto | `INCOMPLETE_VISUAL_SET` / `INVALID_IMAGE` | `INCOMPLETE_VISUAL_SET` |
| Idempotência | repetir um conjunto já em `review` devolve sucesso (`alreadyConfirmed`) | repetir um já `published` devolve sucesso (`alreadyPublished`); cópia repetida aceita "já existe" |
| Falha parcial | RPC falha: conjunto continua `allocated` | cópia→RPC→limpeza: ver abaixo |

Falhas parciais da publicação (ordem: cópia → RPC → limpeza):

- cópia falha → nada mudou no banco, conjunto segue em `review`, rascunhos preservados; pode repetir;
- RPC falha depois da cópia → arquivos órfãos em `exercise-visuals/{catalog}/v{n}/` (inofensivos: nada aponta
  para eles), conjunto segue em `review`; repetir publica;
- limpeza dos rascunhos falha → só sobra lixo no bucket privado; a publicação já valeu.

Mudanças desta etapa nas funções (além do que já existia): miniatura opcional, idempotência em retry,
igualdade exata de path (`_shared/exerciseVisualPaths.ts`), checagem de arquivo truncado
(`isWebpComplete`), tratamento de `409` do Storage por `statusCode`. Os contratos de entrada
(`{ visualSetId }`) e os códigos de erro existentes foram mantidos (novo: `MISSING_FILE`).

**Limite desta validação:** o ambiente não tem Deno. Os testes cobrem a lógica, não o runtime real da Edge
(import `jsr:`, `Deno.serve`, CORS, limites de memória/tempo, comportamento real do Storage). Por isso o
checklist abaixo é obrigatório em homologação.

## Checklist de homologação (Supabase de homologação)

Pré-requisitos: projeto de homologação com **todas** as migrations (incluindo a nova), as 3 funções
publicadas (`supabase functions deploy exercise-visual-confirm publish-exercise-visual profile-avatar-confirm`),
frontend apontando para ele (`VITE_SUPABASE_URL` https), 1 usuário `superadmin` e 1 usuário comum.

### A. Superadmin (fluxo completo)

- [ ] 1. Abrir `/admin/exercicios-imagens` (carrega lista e cobertura).
- [ ] 2. Marcar "Somente sem imagem" e localizar um exercício sem imagem.
- [ ] 3. **Enviar imagens**: escolher duas imagens → a alocação cria o conjunto `allocated` (v1).
- [ ] 4. `start.webp` sobe para `exercise-visual-drafts/{catalog}/{set}/` (Storage → bucket privado).
- [ ] 5. `end.webp` sobe; a miniatura `thumb.webp` também.
- [ ] 6. A Edge Function `exercise-visual-confirm` responde 200 (aba Network).
- [ ] 7. Status do conjunto = `review` (`select status from exercise_visual_sets`; os 3 assets com `width/height/byte_size`).
- [ ] 8. Marcar o checklist e **Aprovar e publicar** (200; `publish-exercise-visual`).
- [ ] 9. `exercise_catalog.published_media_refs` = `{version:1, images:[start,end], thumbnail}`; arquivos em
      `exercise-visuals/{catalog}/v1/`; rascunhos removidos; assets apontam para o bucket público.
- [ ] 10. Entrar como **usuário comum** e abrir o exercício (catálogo, detalhe e guia do treino).
- [ ] 11. Início e final aparecem (URLs `…/object/public/exercise-visuals/…/v1/…`).
- [ ] 12. Como superadmin, criar a **V2** (outro par de imagens) e levá-la a `review`.
- [ ] 13. Publicar a V2 (revisão aprovada).
- [ ] 14. Histórico: V1 `Arquivada`, V2 `Publicada`; só uma `published` (`select count(*) … where status='published'` = 1).
- [ ] 15. **Restaurar esta versão** na V1.
- [ ] 16. Rollback completo: V1 `published`, V2 `archived`, `published_media_refs` = V1 (inclusive a miniatura da V1), e o app do aluno mostra as imagens da V1 sem regenerar nada.
- [ ] 17. Repetir os passos 3–9 com um conjunto **sem miniatura** (forçar falha na miniatura, ex. bloquear o upload dela) → deve ir a `review`, publicar e `published_media_refs` não ter a chave `thumbnail`.
- [ ] 18. Idempotência: reenviar a mesma chamada de confirm/publish (curl com o mesmo JWT) → 200 com `alreadyConfirmed`/`alreadyPublished`.

### B. Usuário comum — nada disso pode funcionar (todos devem falhar)

- [ ] `rpc('allocate_exercise_visual_set', …)` → erro `FORBIDDEN` (42501).
- [ ] `storage.from('exercise-visual-drafts').upload('qualquer/path.webp', …)` → 403 (RLS).
- [ ] `POST /functions/v1/exercise-visual-confirm` → 403 `FORBIDDEN`.
- [ ] `POST /functions/v1/publish-exercise-visual` → 403 `FORBIDDEN`.
- [ ] `rpc('reject_exercise_visual_set', …)` → `FORBIDDEN`.
- [ ] `rpc('restore_exercise_visual_version', …)` → `FORBIDDEN`.
- [ ] `rpc('publish_exercise_visual_internal', …)` e `rpc('confirm_exercise_visual_internal', …)` → permissão negada (só service_role).
- [ ] `storage.from('exercise-visual-drafts').list()/download()` e `exercise-visual-references` → vazio/403.
- [ ] `from('exercise_visual_sets').select()` / `exercise_visual_assets` → 0 linhas.
- [ ] Sem login (anon): `exercise_catalog` e a URL pública `exercise-visuals/…` continuam legíveis; o resto não.
- [ ] A rota `/admin/exercicios-imagens` redireciona o usuário comum.

### C. Offline (PWA)

Pré-requisito: Service Worker novo ativo (DevTools → Application → Service Workers).

- [ ] 1. Online, abrir um exercício que tenha imagens publicadas.
- [ ] 2. Ver início e final carregarem; Application → Cache Storage → `treinos-exercise-images-v1` contém as 2 URLs.
- [ ] 3. Ficar offline (DevTools → Network → Offline).
- [ ] 4. Abrir o mesmo exercício de novo.
- [ ] 5. As imagens aparecem (do cache) e o treino continua funcionando.
- [ ] 6. Abrir um exercício **nunca visualizado** (com imagem publicada).
- [ ] 7. Aparece o placeholder "Sem imagem" (sem erro, sem bloquear o treino).
- [ ] 8. No Cache Storage, **nenhuma** entrada de `…/auth/v1/`, `…/rest/v1/`, `…/realtime/v1/`, `…/functions/v1/` ou de buckets privados/outros públicos; só `exercise-visuals/{uuid}/v{n}/{start|end|thumb}.webp`.
- [ ] 9. Publicar uma V2 e reabrir online: a imagem nova usa a URL `/v2/` (nova entrada), sem servir a antiga.

## Homologação executada (2026-10-09) — stack Supabase local REAL

O único projeto Supabase configurado no repositório (`ywrjojrjgozdfpddkkuy`) é **produção**; não existe
projeto de homologação hospedado. Nada foi aplicado nele. A homologação foi feita numa stack local com as
imagens oficiais do Supabase (Postgres 17, GoTrue v2.197, PostgREST v14.5, Storage API v1.77.5, **Edge
Runtime v1.77.1 com Deno real**, Kong 2.8.1), todas as migrations do repositório (inclusive a nova) e o app
construído para ela. **Isso não substitui um smoke test no projeto de homologação definitivo** (ver abaixo).

Resultado: **A/B/C-API/compat 97/97** (`scripts/verify-exercise-visuals-homolog.mjs`) e **C/D no navegador
29/29** (Chromium real, Service Worker real); `profile-avatar-confirm` refatorado validado no Deno real.

- **Teste A (superadmin)**: allocation, upload no Storage real (path inventado e sobrescrita recusados),
  confirmação, start/end/thumbnail com medidas lidas no servidor, fluxo sem miniatura, miniatura truncada
  ignorada, arquivo ausente (`MISSING_FILE`, recuperável enviando o que faltou), truncado/PNG/HTML renomeados/
  2000 px/32 px (`INVALID_IMAGE`), path adulterado (`..`, outro conjunto, `/` inicial), idempotência da
  confirmação e da publicação, publicação com destino pré-existente (Storage real devolve "já existe"),
  `published_media_refs`, V2, V1 arquivada, rollback exato (V1↔V2), URLs públicas com `content-type` WebP e CORS.
- **Teste B (usuário comum / outro contexto)**: alocar → `FORBIDDEN` (HTTP 403, SQLSTATE 42501); upload em
  path alocado de terceiro, arbitrário ou no bucket público → recusado pelo RLS do Storage (HTTP 400 com
  "violates row-level security"); confirmar/publicar (funções) → **403 `FORBIDDEN`**; rejeitar/restaurar (RPC) →
  403/42501; RPCs internas → 403/42501; listar/baixar/assinar drafts e listar referências → vazio/recusado;
  sets/assets/style profiles → 0 linhas; INSERT/UPDATE direto em sets → 403/42501; UPDATE em `exercise_catalog`
  → 200 com **0 linhas** (RLS só de leitura; o PostgREST não devolve erro); outro superadmin não confirma nem
  sobe em conjunto alheio (403 `UPLOAD_NOT_AUTHORIZED`); sem JWT e com anon key → 401; anon continua lendo
  catálogo e mídia pública.
- **Teste C (aplicação)**: catálogo, detalhe do exercício e guia durante o treino mostram início e final;
  exercício sem imagem não quebra (o guia mostra "Sem imagens para este exercício" com as instruções); sem
  N+1: cada detalhe faz **1 GET** ao catálogo e as imagens vêm só por URL pública; o aluno nunca consulta
  `exercise_visual_*`.
- **Teste D (offline)**: imagens vistas entram em `treinos-exercise-images-v1` (só URLs públicas versionadas
  de `exercise-visuals`); offline reaparecem (sessão aberta **e** reabertura do app); imagem nunca vista →
  placeholder com instruções e treino funcionando; nenhum cache contém Auth/REST/RPC/Realtime/Functions nem
  Storage privado/assinado.
- **Compatibilidade**: `media_refs` intacta; reimportação (com 7 exercícios publicados) atualiza só
  `source_media_refs` (hash de `published_media_refs` e de `media_refs` idêntico antes/depois); frontend
  legado continua consultando `media_refs`.

**Defeito encontrado e corrigido**: a regra global `.main-content form` (fundo, borda e 24 px de padding em
todo formulário) deformava a busca e o formulário de envio dentro do app; corrigido só com CSS
(`.main-content .ev-search`, `.main-content .ev-upload`). Os testes unitários isolados não mostravam isso.

**Observações (não são defeitos desta feature)**
- Offline, o detalhe do catálogo leva ~7–9 s para cair no cache local (retentativas do postgrest-js em GETs
  que falham por conectividade); as imagens aparecem em seguida, do cache do Service Worker.
- `VITE_OFFLINE_COLD_START_ENABLED` **não** está no `.env` de produção: sem ela, reabrir o app *já offline*
  não é suportado pelo app (independente das imagens). O cache de imagens funciona na sessão aberta; o teste
  de reabertura exigiu o build com a flag e `offline_feature_flags.offline_cold_start` ligado.
- Versões têm "buracos" quando há conjuntos abandonados (ex.: v9 depois de v1–v8 com rascunhos/rejeições):
  a versão é reservada na alocação.
- `profile-avatar-confirm` (que passou a importar `_shared/webp.ts`) foi exercitado no Deno real
  (WebP válido → 200 e `active`; PNG renomeado → 400 `INVALID_IMAGE`; sem JWT → 401). **Não precisa ser
  republicado para ficar compatível** (o comportamento é idêntico ao da cópia inline já implantada); republique
  apenas junto das duas funções novas, se quiser o código implantado igual ao do repositório.

**Limites desta homologação (por isso ainda falta um smoke no projeto de homologação definitivo)**: gateway
Kong simplificado (sem `apikey`), `verify_jwt` emulado por um roteador local, sem Realtime, Storage em disco
local (sem S3/limites do plano), e URL `https://localhost` com certificado autoassinado (necessário para o
Service Worker aceitar a origem). No projeto de homologação definitivo, repita no mínimo: A (passos 1–16),
B (todas), C e D (itens do checklist) e rode o script abaixo.

Para reexecutar a parte de API/RLS/funções contra qualquer stack **não-produção**:

```bash
HOMOLOG_CONFIRM=NOT_PRODUCTION HOMOLOG_URL=<url> HOMOLOG_ANON_KEY=<anon> HOMOLOG_SERVICE_ROLE_KEY=<service> \
SA_EMAIL=… SA_PASSWORD=… SA2_EMAIL=… SA2_PASSWORD=… USER_EMAIL=… USER_PASSWORD=… \
FIXTURES_DIR=<dir com start.webp end.webp thumb.webp start2/end2/thumb2.webp too_big.webp tiny.webp \
              not_webp.png truncated.webp html_as_webp.webp> node scripts/verify-exercise-visuals-homolog.mjs
```

O script recusa o ref de produção conhecido e exige o catálogo importado (usa `Pushups`, `Plank`,
`Barbell_Curl`, `Dumbbell_Bicep_Curl`, `Leg_Press`, `Pullups`) e três usuários já existentes (2 superadmins e
1 comum). Grava dados de teste (sets, arquivos e `published_media_refs`): use só em ambiente descartável.

## Rascunhos abandonados — rotina da V2

Substitui a pendência da V1. Função `cleanup-exercise-visuals` (Edge Function, **só superadmin**, JWT):

1. `expire_stale_exercise_visual_sets`: `allocated`/`draft` com mais de 48 h (a janela de upload da policy é de
   24 h; o banco recusa menos que isso) viram `failed` com motivo `EXPIRED` — a linha, o histórico e o número da
   versão **ficam** (a versão nunca é reaproveitada).
2. `list_exercise_visual_purge_candidates`: `failed` com mais de 7 dias e `rejected` com mais de 30 dias que ainda
   têm bytes no bucket de rascunhos.
3. A função remove os bytes **só do bucket privado `exercise-visual-drafts`**, em paths recalculados
   (`{catalog}/{set}/{start|end|thumb}.webp`; qualquer outro path é ignorado e logado).
4. Só depois disso `mark_exercise_visual_drafts_purged_internal` grava `drafts_purged_at` (e um evento
   `cleanup` na auditoria). Banco e Storage são passos separados e repetíveis: falha ao remover bytes = o banco
   não é tocado e o próximo ciclo tenta de novo; falha ao marcar = o próximo ciclo remove de novo (remover objeto
   inexistente não é erro) e marca.

Nunca tocam: `published`, `archived`, `review` (decisão humana pendente) e o bucket público. Esses limites estão
no banco (`INVALID_STATE` em qualquer outro status) **e** na função (status e paths conferidos de novo).

Uso manual (não há agendamento configurado — ver "Pendências"):

```bash
# simulação (só lista)
curl -s -X POST "$SUPABASE_URL/functions/v1/cleanup-exercise-visuals" \
  -H "Authorization: Bearer $SUPERADMIN_JWT" -H "Content-Type: application/json" -d '{"dryRun":true}'
# execução (lote de até 200)
curl -s -X POST ... -d '{"limit":100}'
```

## V2 — consistência visual e endurecimento do backend

Migration `20261021000001_exercise_visuals_v2.sql` (somente expansão; ver "Ordem de rollout" abaixo).

**Prompts.** `buildStartPrompt` (uma única imagem, posição inicial; proíbe comparação, duas poses, colagem,
sequência e "antes e depois") e `buildEndPrompt` (uma única imagem; manda usar a imagem START como referência
obrigatória, manter personagem/roupa/equipamento/câmera/escala/enquadramento/iluminação e alterar **somente** a
biomecânica da pose). `PROMPT_VERSION = 'v2'`. O seletor "Formato do prompt" (Genérico — padrão, Gemini, ChatGPT)
só ajusta uma linha de abertura e como a referência é citada; novo provider = uma entrada em
`PROMPT_PROVIDER_FORMATS`, sem componente novo.

**Style Profile.** `EVOLUTUS_FITNESS_V2` (3D semi-realista, avatar adulto neutro/andrógino, sem musculatura
exagerada, roupa neutra, rosto pouco caracterizado, fundo transparente, prioridade para a biomecânica; proíbe
texto, números, logos, setas e decoração). O V1 não foi alterado e **continua o perfil ativo**: a migration cria o
V2 **inativo** e não muda o perfil ativo. Perfis têm `family` (`EVOLUTUS_FITNESS` para V1/V2) e um índice parcial
garante no máximo um ativo por família. A troca é explícita: `activate_exercise_visual_style_profile(p_profile_id)`
(superadmin autenticado) ou `activate_exercise_visual_style_profile_internal(p_profile_id, p_actor)` (service_role
com um superadmin como ator) — atômica, idempotente, registra `activated_at`/`activated_by`. A mesma função serve
de **rollback**: ativar o id do V1 devolve o V1 e deixa o V2 cadastrado. Conjuntos já criados mantêm o perfil com
que nasceram. O app **não tem perfil de reserva**: sem o perfil ativo carregado (com id) não há prompt, cópia nem envio — a tela
mostra "Não foi possível carregar o padrão visual. Tente novamente." com "Tentar novamente"; histórico, revisão,
rollback e imagens publicadas seguem normais. O envio registra o `style_profile_id` do perfil que gerou o prompt mostrado.

**Proveniência no conjunto** (`exercise_visual_sets`): `style_version`, `prompt_version` (versão do perfil de
prompt), `prompt_start_hash`, `prompt_end_hash` (SHA-256 do texto exato copiado — registro de proveniência
calculado no cliente, não fronteira de segurança), `provider_hint`, `reference_set_id`,
`reference_style_version`. Nenhum segredo/API key. O `metadata` do cliente não consegue mais sobrescrever
`source`/`styleVersion` (o servidor escreve por último).

**Referências oficiais.** Tabelas `exercise_visual_reference_sets` (pacote versionado, no máximo um ativo) e
`exercise_visual_reference_assets` (`character-front`, `character-side`, `character-back`, `style-reference`;
path exato `{reference_set_id}/{role}.{webp|png|jpg}`), no bucket privado `exercise-visual-references`
(escrita só service_role). A alocação grava a versão da referência ativa no conjunto. Ainda não há assets nem
UI/Edge Function de upload de referência; `activate_exercise_visual_reference_set_internal` (service_role)
já exige pacote completo e confirmado.

**Alocação segura.** Advisory lock transacional por exercício (`private.lock_exercise_visual_catalog`) em vez do
`FOR UPDATE` na linha do catálogo (que também travava as FKs de treinos dos alunos); a publicação/rollback usa o
mesmo lock. `request_id` (uuid por envio, único por usuário) torna a alocação idempotente: duplo clique, retry ou
conexão instável devolvem o mesmo conjunto (`replayed: true`) em vez de criar outro. `unique (catalog_id,
version)` e `unique (created_by, request_id)` continuam como última defesa. O cliente reutiliza a chave em retries
de rede e a renova após erro definitivo (`INVALID_IMAGE`, `IMAGE_METADATA_NOT_ALLOWED`…). Teste real de
concorrência: `scripts/verify-exercise-visuals-concurrency.sh` (sessões simultâneas com barreira; **só em banco
local**).

**Máquina de estados no banco** (trigger `BEFORE UPDATE`; vale para RPC, Edge Function e SQL direto):

| de | para |
| --- | --- |
| `allocated` | `review`, `failed` |
| `draft` (reservado) | `review`, `rejected`, `failed` |
| `review` | `published`, `rejected`, `failed` |
| `published` | `archived` |
| `archived` | `published` (rollback) |
| `rejected`, `failed` | — (terminais) |

Qualquer outra transição lança `INVALID_TRANSITION` (ex.: `allocated→published`, `failed→published`,
`rejected→published`). `catalog_id`, `version`, `created_by` e `request_id` são imutáveis. O estado `failed` agora
é alcançável: a Edge Function de confirmação marca o conjunto como `failed` quando um arquivo obrigatório é
inválido (o path de rascunho é insert-only, não dá para regravar) e a expiração também o usa.

**Auditoria.** `exercise_visual_audit_log` (append-only; sem FK para sobreviver à limpeza; só superadmin lê; ninguém
insere direto): eventos `allocate`, `confirm`, `reject`, `publish`, `archive`, `restore`, `fail`, `cleanup` com
`actor_id` (nulo quando é o sistema, ex. expiração), status anterior/novo, versão, horário e metadata mínima
(motivo, avisos). Gerada por trigger na tabela de conjuntos: não depende de cada caminho lembrar de registrar.

**Arquivos.** `exercise_visual_assets` ganhou `sha256` (calculado **no servidor** na confirmação), `perceptual_hash`
(dHash 64 bits calculado no navegador), `validated_at`, `validation_version` (2 = SHA-256 + metadata). Avisos —
**nunca bloqueiam**, o revisor decide — gravados em `metadata.validation.warnings`: `START_END_IDENTICAL_FILE`
(SHA-256 igual), `START_END_NEARLY_IDENTICAL` (dHash a ≤ 2 bits), `DUPLICATE_FILE_IN_OTHER_SET` (SHA-256 já usado
em outro conjunto). A publicação confere o SHA-256 gravado (`INTEGRITY_MISMATCH`, 409) antes de copiar; conjuntos
confirmados pela v1 não têm hash e seguem normalmente.

**WebP.** `findForbiddenWebpChunk` varre só a lista de chunks de nível superior e rejeita `EXIF` e `XMP `
(`IMAGE_METADATA_NOT_ALLOWED`) e tamanhos de chunk que estouram o arquivo. `ICCP` (perfil de cor) é aceito de
propósito. Não é parser de WebP: não decodifica nada.

**Storage (conferido por pgTAP).** `exercise-visual-drafts` privado, só WebP ≤ 2 MB, leitura só superadmin, upload
só no path alocado, só enquanto `allocated`, sem update/delete do cliente; `exercise-visuals` público sem escrita
do cliente (só a Edge Function de publicação) com paths versionados `{catalog}/v{n}/…`; referências privadas sem
escrita do cliente. URL de preview de rascunho: assinada, 10 min.

### Ordem de rollout da V2

1. Aplicar a migration `20261021000001` (frontend V1 continua funcionando: assinatura retrocompatível e o perfil
   ativo continua o V1).
2. Deploy das Edge Functions `exercise-visual-confirm`, `publish-exercise-visual` e `cleanup-exercise-visuals`
   (`--use-api`: o bundling local falha por DNS no Codespace).
3. Deploy do frontend V2 (push em main).
4. Smoke técnico (checklist acima: allocate → upload → confirm → review → publish → rollback, usuário comum negado).
5. **Só então** ativar o V2:
   `select public.activate_exercise_visual_style_profile_internal((select id from public.exercise_visual_style_profiles where name = 'EVOLUTUS_FITNESS_V2'), '<uuid-de-um-superadmin>');`
   (SQL Editor / `service_role`), ou o RPC `activate_exercise_visual_style_profile` com JWT de superadmin.
6. Rollback do estilo, se preciso: a mesma chamada com o id do `EVOLUTUS_FITNESS_V1`.

## Piloto — Fase 3 (5 exercícios; ainda não executado)

Seleção do catálogo (`imports/exercicios_ptbr.json`, todos completos), cobrindo os tipos de equipamento.
Busque pelo nome em `/admin/exercicios-imagens`.

| # | Exercício (nome no catálogo) | `provider_exercise_id` | Equipamento | Músculo | Por que |
| --- | --- | --- | --- | --- | --- |
| 1 | Flexões | `Pushups` | peso do corpo | peito | pose de solo simples: valida personagem e anatomia |
| 2 | Supino Reto com Barra - Pegada Média | `Barbell_Bench_Press_-_Medium_Grip` | barra | peito | banco + barra: valida equipamento e ponto de vista |
| 3 | Rosca Bíceps com Halteres | `Dumbbell_Bicep_Curl` | halteres | bíceps | movimento pequeno: início/final precisam ser distintos |
| 4 | Leg Press | `Leg_Press` | máquina | quadríceps | máquina grande: valida consistência de equipamento |
| 5 | Pulldown com Pegada Larga | `Wide-Grip_Lat_Pulldown` | cabo | dorsais | polia/cabo: valida posição sentada e trajetória |

Para os 20 seguintes (depois de validar estes 5): Prancha (`Plank`), Agachamento com Barra
(`Barbell_Squat`), Remada Sentada no Pulley (`Seated_Cable_Rows`), Desenvolvimento de Ombros com Halteres
(`Dumbbell_Shoulder_Press`), Tríceps Pulley (`Triceps_Pushdown`), Barra Fixa (`Pullups`), Agachamento
Corporal (`Bodyweight_Squat`), Crucifixo com Halteres (`Dumbbell_Flyes`).

O que validar no piloto: personagem, estilo, equipamento, anatomia, posição inicial/final distintas e
consistência entre os 5. Critério de revisão: o checklist de 10 itens da própria tela.

## Pendências conhecidas

- Smoke no projeto de homologação definitivo (checklist acima + script): as funções já passaram no Deno real
  local, mas ainda não num projeto Supabase hospedado — **bloqueia produção**.
- Agendar `cleanup-exercise-visuals` (hoje só manual, com JWT de superadmin; um cron precisaria de um segredo
  próprio — decisão pendente) e assets reais de referência do personagem.
- Edge Functions da V2 testadas em Node com fakes e empacotadas no edge-runtime real (`bundle`), mas ainda não
  executadas ponta a ponta contra Storage/Auth reais (a stack local `local-stack.sh` não sobe sem baixar ~3 GB).
- A miniatura é publicada mas ainda não usada pela UI do aluno.
- Migration futura para remover `media_refs` (após o frontend novo estabilizar).
- Fase 5 (API de IA, fila, custos) e Fase 6 (catálogo completo) não iniciadas.
