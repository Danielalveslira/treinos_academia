# Runbook — Aplicação em produção da migration F1/F1.2 (`20261105000001_close_has_app_access_gates.sql`)

Este documento é para o **responsável** executar manualmente. Nenhum passo aqui foi executado por
mim — a migration nunca foi aplicada em nenhum ambiente remoto (nem dev, nem produção); toda a
validação até agora foi feita só em container local descartável (ver
`docs/releases/F1_2_CORRECAO_ONBOARDING.md`, seção 7). Siga os passos em ordem. Qualquer divergência
do esperado em qualquer passo = **PARAR** e não avançar para o próximo.

## a. Pré-voo — antes de qualquer comando que altere algo

### a.1 Janela de baixo tráfego e backup/PITR

- Escolha uma janela de baixo tráfego (ex.: madrugada no horário de maior parte dos usuários).
- Confirme que existe backup/PITR (Point-in-Time Recovery) disponível para o projeto de produção
  **antes** de aplicar qualquer migration:
  - Painel do Supabase → projeto de produção → **Database** → **Backups**. Confirme a data/hora
    do backup mais recente e se PITR está habilitado (plano Pro+) ou se só há backups diários
    (plano Free/sem PITR — nesse caso, o ponto de restauração mais recente pode ser de até 24h
    atrás, o que deve pesar na decisão de aplicar agora ou esperar o próximo backup).
  - Se PITR estiver disponível, anote o timestamp atual (`select now();`) antes de prosseguir —
    é o ponto de referência para um eventual restore.

### a.2 Confirmar que o projeto linkado é o de produção

- O ref do projeto de produção, confirmado por `vercel.json` (CSP `connect-src`), é
  **`ywrjojrjgozdfpddkkuy`**. Rode:
  ```bash
  supabase projects list
  supabase status  # ou: cat supabase/.temp/project-ref, se existir
  ```
- Confirme **consciente e explicitamente** que o projeto atualmente linkado neste ambiente É esse
  ref, e que isso é o desejado (não há ambiente de homologação separado — confirmado na decisão
  registrada em `docs/prompts/Evolutus_decisoes_pendencias.xlsx`, aba Decisões, item 4: "Não
  existe; há apenas dev e produção"). Se o projeto linkado for outro, **PARE** e relinke
  (`supabase link --project-ref ywrjojrjgozdfpddkkuy`) só depois de ter certeza absoluta.

### a.3 Comparar histórico remoto x local — migrations pendentes

```bash
supabase migration list
```

- Liste **todas** as migrations que aparecem como pendentes (não aplicadas remotamente). Para
  cada uma que não seja `20261105000001_close_has_app_access_gates.sql`, descreva o que ela faz
  em uma linha e confirme explicitamente que está pronta para ir — não assuma que "pendente" =
  "seguro aplicar junto". Monte uma lista como:

  | Migration | O que faz (resumo de 1 linha) | Pronta para ir? (sua confirmação) |
  |---|---|---|
  | `20261105000001_close_has_app_access_gates.sql` | Fecha gates de `has_app_access()` (P18) e corrige `search_path` (P20); F1.2 corrige o bug de cadastro | Sim (é o objeto deste runbook) |
  | *(preencher cada outra migration pendente encontrada)* | | |

- Se houver qualquer migration pendente além da F1/F1.2 que você não reconheça ou não tenha
  revisado, **PARE** — não aplique em lote sem entender cada uma.

### a.4 Dry-run

```bash
supabase db push --dry-run
```

- **Resultado esperado:** a saída deve listar **exatamente** as migrations pendentes confirmadas
  no passo a.3 (idealmente só `20261105000001_close_has_app_access_gates.sql`, se nenhuma outra
  estiver pendente), sem nenhum erro de SQL, sem nenhum aviso de "migration mismatch" ou "schema
  drift" não esperado.
- **Se divergir** (lista diferente da esperada, erro de sintaxe, aviso de drift): **PARE**. Não
  prossiga para a aplicação real. Investigue a divergência primeiro (ex.: `supabase db diff`
  contra o remoto) — uma divergência aqui significa que o estado do catálogo remoto não é o que
  este runbook assume.

## b. Aplicação

```bash
supabase db push
```

- Observe a saída linha a linha. Cada `CREATE FUNCTION`/`CREATE POLICY`/`DROP POLICY` deve
  aparecer sem erro. O comando deve terminar com sucesso (exit code 0) e sem nenhuma mensagem de
  rollback automático.
- Se o comando falhar no meio: a migration inteira roda em uma transação implícita do CLI — uma
  falha deve ter revertido tudo automaticamente (confirme isso no passo c abaixo antes de
  assumir que está seguro). Se falhar, vá direto para o critério de rollback (passo e).

## c. Verificação imediata, somente leitura

Use `scripts/aud-production-readonly.sql` (100% `select`, já roda em `begin read only ... commit`)
e as consultas específicas abaixo, todas via SQL Editor do painel do Supabase (produção) ou
`psql` apontando para o projeto de produção em modo leitura.

1. **Existência do novo helper:**
   ```sql
   select count(*) from pg_proc
   where proname = 'has_account_standing' and pronamespace = 'private'::regnamespace;
   -- esperado: 1
   ```
2. **`proconfig` (search_path) das funções SECURITY DEFINER — contagem de violações do invariante, esperado 0:**
   ```sql
   select count(*)::int from pg_proc p
   where p.prosecdef and p.prokind = 'f'
     and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and exists (
       select 1 from unnest(p.proconfig) c
       where c ~ '^search_path=' and c <> 'search_path=""' and c !~ 'pg_temp'
     );
   -- esperado: 0 (mesma asserção da seção 0 de supabase/tests/aud_has_app_access_gates_test.sql)
   ```
3. **Policies dos objetos da F1 contendo o gate** (devem referenciar `has_app_access()`):
   ```sql
   select tablename, policyname, qual, with_check
   from pg_policies
   where (schemaname = 'public' and tablename in ('communities', 'statuses', 'sponsored_ads'))
      or (schemaname = 'storage' and tablename = 'objects'
          and policyname in ('profile_avatars_insert', 'community_covers_insert', 'community_covers_update'));
   -- esperado: has_app_access() aparece em communities_update, statuses_delete,
   -- sponsored_ads_select, profile_avatars_insert, community_covers_insert/update
   ```
4. **Grants preservados** (nada deve ter sido revogado/concedido — confirme os RPCs principais ainda são chamáveis por `authenticated`):
   ```sql
   select routine_name, grantee, privilege_type
   from information_schema.role_routine_grants
   where routine_schema = 'public'
     and routine_name in ('set_username', 'update_user_profile', 'create_promotion', 'cast_vote',
                           'allocate_profile_avatar', 'create_professional_listing',
                           'save_professional_listing_draft', 'prepare_professional_listing_publish')
     and grantee = 'authenticated';
   -- esperado: EXECUTE para todos os 8
   ```
5. Rode também `scripts/aud-production-readonly.sql` por completo e compare a seção de funções
   `SECURITY DEFINER`/triggers (inclui `cast_vote` desde o commit `chore: track cast_vote...`)
   contra o que você esperava da migration.

Se qualquer um destes 4 itens não confirmar o esperado: **PARE**, não prossiga para o passo d —
vá para o critério de rollback (passo e).

## d. Teste manual de 5 minutos (responsável, na aplicação real em produção)

1. **Cadastrar uma conta nova completa**, do zero, até aceitar os termos e entrar no app — é
   exatamente o caminho que a F1.1 encontrou quebrado e a F1.2 corrigiu (`set_username` antes do
   aceite legal). **Este é o teste mais importante do runbook.**
2. **Login de uma conta já existente** (ativa, normal).
3. **Editar o perfil/@** (nome de usuário e/ou bio) de uma conta já logada.
4. **Abrir o diálogo de impulsionar uma publicação** (`PromoteDialog`) em um post próprio, numa
   comunidade da qual você é membro.
5. **Votar em uma enquete** (ou publicação votável) existente.
6. **Confirmar que o app carrega o feed** normalmente após tudo isso.

Qualquer falha no passo **d.1**, ou qualquer `PERMISSION_DENIED` inesperado em qualquer um dos
passos d.2–d.6 (fluxo legítimo, conta sem nenhum bloqueio) = **rollback imediato** (passo e).

## e. Critério de rollback imediato

**Gatilho:** falha no teste d.1 (cadastro), OU qualquer `PERMISSION_DENIED`/erro de autorização
inesperado em d.2–d.6 com uma conta legítima sem bloqueio, OU qualquer divergência não explicada
na verificação do passo c.

**Comando exato:**
```bash
psql "$(supabase db url --project-ref ywrjojrjgozdfpddkkuy)" \
  -f supabase/rollbacks/20261105000001_close_has_app_access_gates.sql
```
(ou cole o conteúdo do arquivo no SQL Editor do painel de produção e execute — o arquivo já tem
seu próprio `begin;`/`commit;`.)

**Como confirmar o retorno ao estado anterior:**
```sql
select count(*) from pg_proc
where proname = 'has_account_standing' and pronamespace = 'private'::regnamespace;
-- esperado agora: 0 (a função foi removida pelo rollback)

select pg_get_functiondef('public.set_username(text)'::regprocedure);
-- esperado: sem nenhuma referência a has_app_access() nem a private.has_account_standing()
```
Depois do rollback, repita o teste d.1 (cadastro) — deve voltar a funcionar exatamente como
funcionava antes desta migration (sem os gates da F1, mas também sem o bug do cadastro, porque
esse bug só existia com a F1 aplicada).

## f. O que monitorar nas primeiras 24h

- **Taxa de erro `PERMISSION_DENIED`** nos logs do Supabase (painel → **Logs** → filtrar por
  `PERMISSION_DENIED` nas chamadas RPC) — um aumento anormal, especialmente concentrado em
  `set_username`, `update_user_profile`, `create_promotion`, `cast_vote`, `create_professional_listing`,
  `save_professional_listing_draft`, `prepare_professional_listing_publish` ou
  `allocate_profile_avatar`, indica que algum caminho real não foi coberto pela tabela de
  rastreamento da F1.2 (`docs/releases/F1_2_CORRECAO_ONBOARDING.md`, seção 2).
- **Falhas de cadastro** — taxa de conclusão de `Register.jsx` (contas criadas vs. contas que
  terminam o fluxo com termos aceitos). Uma queda súbita após o deploy é o sinal mais direto de
  que o bug da F1.1 voltou de alguma forma não prevista.
- **Erros silenciosos das policies RLS puras** (não aparecem como exceção, só como "0 linhas
  afetadas") — não há como monitorar isso via log de erro; se houver suspeita, validar
  manualmente com uma conta de teste em cada estado (disabled/restrita) tentando editar uma
  comunidade própria ou apagar um post de terceiro na própria comunidade.

## Pendência explícita antes de executar este runbook

Nenhuma validação remota (dev ou produção) foi feita até o momento da escrita deste documento —
confirme a pendência #1 da aba "Condições" de `docs/prompts/Evolutus_plano_pos_auditoria.xlsx`
("Confirmar estado real do banco") antes do passo a.4, se ainda não tiver sido feita.
