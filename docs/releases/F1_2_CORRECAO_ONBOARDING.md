# F1.2 — Correção do bloqueio de cadastro introduzido pela F1

Data: 2026-10-17. Escopo desta revisão: `supabase/migrations/20261105000001_close_has_app_access_gates.sql`
(editada no lugar), seu rollback em `supabase/rollbacks/`, testes em `supabase/tests/` e este
documento. Nenhum arquivo em `src/`, `supabase/functions/` ou banco remoto foi tocado; nenhum
commit foi criado; `has_app_access()` (`20260926000023_users_new_fields.sql:33-50`) não foi
alterada.

## 0. Contexto e pré-condição

A F1.1 (`docs/releases/F1_1_VERIFICACAO.md`) encontrou um defeito bloqueante: `Register.jsx:124`
chama `set_username` **antes** de `Register.jsx:141` (`accept_legal_documents`, condicional a
`legalBundle.manifest.published`), e `has_app_access()` exige termos aceitos — logo a migration F1
(`20261105000001`), como escrita originalmente, quebraria 100% dos cadastros novos com
`PERMISSION_DENIED`. Decisão do responsável: opção B — afrouxar o gate só onde o cadastro precisa,
sem tocar em `src/`.

Pré-condição verificada via git antes de qualquer edição:

| Verificação | Comando | Resultado |
|---|---|---|
| Arquivo nunca commitado | `git status --porcelain <paths>` | `??` (untracked) nos 3 arquivos |
| Sem entrada em nenhum ref | `git log --all --oneline -- <path>` | vazio |
| Sem entrada em nenhum remoto | `git log --all --source --remotes --oneline -- <path>` | vazio |
| Branches/remotos | `git branch -a`, `git remote -v` | só `main` local, sem remoto aplicado |

Todas verdadeiras → autorizado editar a migration e o rollback no lugar.

## 1. Novo helper: `private.has_account_standing()`

Reproduz **somente** os componentes de bloqueio de `has_app_access()` — `account_status`
(`deleting`/`disabled`) e `account_restrictions` ativa, com a mesma exceção de superadmin — **sem**
`legal_policy` e **sem** `email_verified_ok()`. `security definer`, `search_path = ''`, referências
totalmente qualificadas. Sem grant/revoke explícito: mesmo padrão de `has_app_access()` (nenhuma
das duas tem grant/revoke em nenhuma migration — confirmado por grep); como o schema `private` já
tem `revoke all ... from public, anon, authenticated` (`20261002000003_comments_schema.sql:4`), ela
só é alcançável de dentro de outra função `SECURITY DEFINER` — mesmo raio de alcance de
`private.can_moderate_status`, já existente na mesma migration.

## 2. Tabela de objetos: narrow helper vs. `has_app_access()` completo

Rastreamento exaustivo feito por um agente de exploração (grep de cada `supabase.rpc('<nome>')` em
`src/`, subida na árvore de componentes/rotas até `App.jsx`, leitura de `ProtectedRoute.jsx`,
`EmailVerificationGate.jsx` e `LegalGate.jsx`), e confirmado por leitura direta de `Register.jsx`.

| Objeto | Call site(s) (evidência) | Atrás de ProtectedRoute+LegalGate? | Gate escolhido |
|---|---|---|---|
| `set_username` | `usersService.js:116` ← `Register.jsx:124` | **Não** — rota pública `/cadastro` (`App.jsx:56`) | `private.has_account_standing()` |
| `update_user_profile` | `usersService.js:83` ← `AuthContext.jsx:644` ← `Profile.jsx:89` | Sim — `/perfil`, `App.jsx:84` | `has_app_access()` (inalterado) |
| `create_professional_listing` | `professionalListingsService.js:6` ← `MyProfessionalListing.jsx:210` | Sim — `/minha-vitrine`, `App.jsx:94` | `has_app_access()` (inalterado) |
| `save_professional_listing_draft` | `professionalListingsService.js:10` ← `MyProfessionalListing.jsx:253,280` | Sim — mesma rota | `has_app_access()` (inalterado) |
| `prepare_professional_listing_publish` | `professionalListingsService.js:20-23` ← `MyProfessionalListing.jsx:285` | Sim — mesma rota | `has_app_access()` (inalterado) |
| `allocate_profile_avatar` | `profileAvatarService.js:18` ← `Profile.jsx:115` | Sim — `/perfil` | `has_app_access()` (inalterado) |
| `cast_vote` | `economyService.js:135` ← `EconomyVoteBar.jsx:58` (via `StatusCard`←`CommunityFeedSection`←`CommunityDetail`, `/comunidades/:id`, `App.jsx:145`) | Sim | `has_app_access()` (inalterado) |
| `create_promotion` | `promotionsService.js:49` ← `PromoteDialog.jsx:77` (mesma rota) | Sim | `has_app_access()` + 3 códigos restaurados (seção 3) |

`ProtectedRoute.jsx` tem várias saídas antecipadas que nunca montam `children` (loading, sem user,
conta em exclusão, perfil indisponível, conta desativada, acesso negado pelo servidor), e nos dois
caminhos restantes sempre envolve `children` em `LegalGate` (e também `EmailVerificationGate`
quando a verificação é exigida). Isso é o que torna os objetos 2-6 estruturalmente seguros com o
gate completo — e o que **não** protege `set_username`, porque `Register.jsx` roda inteiramente
fora desse mecanismo.

## 3. `create_promotion`: códigos distintos restaurados

A definição original (`20261028000001_status_expiration.sql:194-321`) **já** checava
`deleting`/`disabled`/`account_restrictions` manualmente — o único gap real que a F1 fechava era
`email_verified_ok()`/`legal_policy`. A troca da F1 por um `has_app_access()` único colapsou os 3
códigos distintos em `PERMISSION_DENIED`. `PromoteDialog.jsx:89-90` tem mensagens amigáveis
mapeadas especificamente para `ACCOUNT_DISABLED` e `ACCOUNT_RESTRICTED` (sem entrada para
`PERMISSION_DENIED`) — colapsar quebra essa UX.

Restaurados os 3 checks manuais na mesma posição/precedência da definição original
(`ACCOUNT_DELETING` logo após a validação de argumentos; `ACCOUNT_DISABLED`/`ACCOUNT_RESTRICTED`
logo após `NOT_OWNER`), com `has_app_access()` acrescentado **depois** deles como fallback — só
alcançado se os 3 checks manuais já passaram, cobrindo exclusivamente o que eles não cobrem
(e-mail/termos).

`cast_vote`: verificado `economyService.js:134-138` (único call site da RPC) e
`EconomyVoteBar.jsx:52-75` (único chamador, único tratamento de erro) — o catch só faz
`console.error` e exibe `error?.message` genérico; nenhum mapa de códigos específicos
(`ACCOUNT_DELETING`/`ACCOUNT_RESTRICTED`) foi encontrado para este call site. O `cast_vote`
original (`20261028000001_status_expiration.sql:324-458`) nem checava `disabled` —
`has_app_access()` aqui é estritamente mais completo, sem UX conhecida que dependa dos códigos
antigos. **Nenhuma mudança feita em `cast_vote`** além do que a F1 já havia aplicado.

## 4. Rollback regenerado do catálogo

Em vez de confiar na transcrição manual (que a F1.1 já havia achado com 4 comentários cosméticos
perdidos, sem diferença de lógica), o rollback foi **regenerado a partir do catálogo real**:
container novo, Storage real, as 137 migrations anteriores à F1/F1.2 aplicadas em ordem
(`ls supabase/migrations/*.sql | sort | grep -v 20261105000001`), e `pg_get_functiondef` sobre cada
uma das 9 funções tocadas.

Diffs encontrados e corrigidos (só comentários — zero diferença de lógica):

| Função | Comentário restaurado |
|---|---|
| `create_professional_listing` | bloco `exception when unique_violation` (corrida de criação concorrente) |
| `save_professional_listing_draft` | 2 comentários (truncamento de `specialties`; validação de contatos) |
| `prepare_professional_listing_publish` | 3 comentários (resposta perdida; retry da mesma intenção; operação stale) |
| `cast_vote` | comentário do `pg_advisory_xact_lock` |

Teste de rollback com comparação EXATA (não por amostragem):

1. Aplicado o catálogo de 137 migrations (sem F1/F1.2) → dump `pg_get_functiondef` das 9 funções +
   `pg_policies` das 6 policies afetadas → **baseline real**.
2. Aplicada a migration F1.2 (138ª) → aplica limpo.
3. Aplicado o rollback regenerado → `DROP FUNCTION private.has_account_standing()` executa,
   as 9 funções voltam.
4. **Comparação byte-a-byte** (`diff`) do dump pós-rollback contra o baseline real: as 9 funções
   `IDENTICAL`; as 6 policies `IDENTICAL`; `proconfig` confere (`cast_vote`/`create_promotion`
   voltam a `search_path=public` sem `pg_temp`, `can_moderate_status` mantém `search_path=''`,
   `has_account_standing` — 0 linhas, removida).
5. Reaplicada a migration F1.2 por cima do estado pós-rollback → dump das 9 funções **idêntico**
   ao dump original pós-primeira-aplicação (`diff` limpo) → confirma que rollback→reaplicação não
   introduz drift em nenhuma direção.

## 5. Testes novos (`supabase/tests/aud_has_app_access_gates_test.sql`, seção 16)

- **16a — sequência real de cadastro**: usuário criado após o corte de verificação de e-mail,
  `email_confirmed_at = null`, sem aceite legal. `set_username` sucede (prova a correção do bug
  bloqueante). `update_user_profile` continua negado neste instante — documentado como
  **não-bug**: seu único call site real (`Profile.jsx:89`) nunca é atingido antes do `LegalGate`
  (tabela da seção 2), então essa chamada nunca ocorre na prática nesta janela; o teste verifica o
  comportamento isolado do objeto, não um caminho real. Depois de `accept_legal_documents`
  (replicando `Register.jsx:141`), `update_user_profile` ainda nega (e-mail não confirmado); só
  depois de confirmar o e-mail é que passa a suceder — confirma que o objeto manteve
  `has_app_access()` completo, sem afrouxamento indevido.
- **16b**: os mesmos 6 estados (ativa/disabled/deleting/suspensa/banida/superadmin) para os
  objetos gateados pela F1 já estão cobertos pelas seções 3-8 e 12-13 do mesmo arquivo (incluindo
  `set_username`, agora sobre `private.has_account_standing()`, e `create_promotion` com os 3
  códigos restaurados) — não duplicado.
- **16c — termos desatualizados**: usuário ativo com `legal_acceptance_version` divergente da
  política publicada. `has_account_standing()` ignora (não checa termos) → `set_username` sucede.
  `has_app_access()` nega (`PERMISSION_DENIED`, comportamento pré-existente, não é mudança da
  F1.2) → `update_user_profile` nega, documentando que exige novo `accept_legal_documents`.
- **16d — equivalência nos estados de bloqueio**: para disabled/deleting/suspensa/banida, `
  has_app_access()` e `has_account_standing()` concordam (ambas `false`) — é esse o recorte de
  "equivalência" pedido (ambas avaliam o mesmo bloco de account_status/restrictions), não que as
  duas sejam idênticas em todo caso (para conta ativa sem termos aceitos elas **divergem** de
  propósito, demonstrado em 16a/16c). **Achado incidental**: `has_app_access()` não isenta
  superadmin do bloco de termos legais — a cláusula de `legal_policy` em
  `20260926000023_users_new_fields.sql:33-50` não tem `u.role = 'superadmin' or` como as outras 3
  cláusulas; sem aceite válido, um superadmin também recebe `PERMISSION_DENIED`/NULL. Comportamento
  pré-existente, não alterado aqui, só documentado.

Resultado: **99/99** asserções passando no arquivo (80 pré-existentes + 19 novas/ajustadas).

## 6. Risco de `profile_avatars_published_read` (relato, sem alteração de código)

Policy (`20261001000003_professional_listing_avatar_publish.sql:18-23`): leitura pública (sem
`auth.uid()`) do avatar de uma vitrine profissional **atualmente publicada**, por desenho — a
própria migration documenta que a página da vitrine precisa funcionar para visitantes sem conta
("Termos da Vitrine, seção 2"). Adicionar `has_app_access()`/`has_account_standing()` aqui
contradiria o propósito da policy (exigiria `auth.uid()` resolvido, quebrando acesso anônimo).

A pergunta real não é sobre a policy de leitura dos bytes, e sim sobre o ciclo de vida de
`published_professional_listings`: busquei (grep exaustivo por `published_professional_listings`
cruzado com `account_status`/`disable`/`ban`/`restrict` em todas as migrations) qualquer cascata
que despublique a vitrine quando a conta do dono é bloqueada — **não encontrei nenhuma**. Isso
significa que uma vitrine (nome, bio, contatos, avatar) de uma conta `disabled`/`deleting`/banida
**permanece publicamente visível** até uma ação explícita (o dono não pode mais despublicar
sozinho, já que as RPCs de vitrine exigem `has_app_access()` desde a F1; só resta o fluxo
administrativo de `20261002000002_admin_vitrines_denuncias.sql`).

**Classificação: risco Médio/pré-existente, fora do escopo de contas** — não é uma lacuna de
`has_app_access()` nem está relacionado à exclusão de contas; é uma decisão de produto sobre o
ciclo de vida de vitrines que antecede toda a auditoria P18. Recomendação (não executada aqui,
nenhuma mudança de código): avaliar como um item de acompanhamento separado (candidato a P21 no
`AUDITORIA_EXCLUSAO_CONTAS.md`) se desejar que o bloqueio da conta também despublique a vitrine
automaticamente.

## 7. Validação final

| Etapa | Resultado |
|---|---|
| Container novo, Storage real (storage-api v1.79.28) | Schema `storage` com 10 tabelas confirmado |
| 138 migrations (`ls \| sort`, ordem íntegra) | Todas aplicadas sem erro |
| Suite pgTAP completa (57 arquivos) | **2750 asserções, 0 `not ok`, 0 `ERROR`** |
| `npm test` | **1951/1951** |
| `test:functions` (`PG_TEST_CONTAINER`/`PG_TEST_USER` apontando pro container) | **156/156** |
| Rollback → comparação exata com catálogo de 137 migrations | 9 funções + 6 policies **idênticas** |
| Reaplicação pós-rollback → comparação com o catálogo original da F1.2 | **idêntico** |

## 8. O que não pôde ser comprovado

- Nenhum teste de navegador real (Register.jsx rodando de fato em um browser) foi executado — a
  prova é por leitura de código (linhas exatas citadas) e por replicar a sequência via pgTAP
  chamando as mesmas RPCs na mesma ordem, não por um E2E de UI.
- O rastreamento exaustivo da seção 2 foi feito por um agente de busca estático (grep +
  leitura de árvore de componentes); não roda o bundler nem resolve importações dinâmicas — para
  os 8 objetos em questão, as cadeias de import são todas estáticas e curtas, então o risco de um
  caminho escondido é baixo, mas não é uma garantia de tipo "coverage 100% comprovado por
  execução".
  - A existência real de uma política legal publicada em produção (que é a precondição de todo o
  bug original) não foi reconfirmada aqui — já havia sido confirmada em fase anterior via
  `legal/manifest.json` (`published: true`, versão `1.5.0`); esta fase assume que esse fato
  continua válido, sem reconsultar produção (fora de escopo: proibido banco remoto).
- `profile_avatars_published_read` (seção 6): o grep por cascatas de despublicação é exaustivo
  contra o texto das migrations, mas não é uma prova formal de que nenhuma rotina externa (ex.: um
  cron ou Edge Function fora de `supabase/migrations/`) faça essa limpeza — não encontrei nenhuma
  referência também em `supabase/functions/`, mas uma leitura completa de todas as Edge Functions
  não fazia parte do escopo desta fase.

## 9. Recomendação

**Seguro para aplicar em dev.** A migration `20261105000001` (versão F1.2), seu rollback e os
testes passaram por validação completa e independente (catálogo regenerado do zero, comparação
byte-a-byte, suite pgTAP/npm/functions 100% verde) sem nenhuma alteração em `src/`,
`supabase/functions/` ou em `has_app_access()`. O defeito bloqueante da F1.1 está corrigido
(`set_username` não depende mais de termos/e-mail) sem reabrir nenhum dos 8 gates do achado P18 nem
regredir o P20 (`search_path`). A UX de `create_promotion` (códigos distintos) foi restaurada.
Antes de aplicar em produção: confirmar contra o schema remoto real (fora do escopo desta fase,
nunca conectado) e considerar o achado da seção 6 como um item de acompanhamento separado.
