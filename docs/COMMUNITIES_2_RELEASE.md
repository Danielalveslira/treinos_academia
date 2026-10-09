# Comunidades 2.0 — publicação, verificação e recuperação

Estado em 2026-10-09: as **3 migrations** (commit `71e6119`) foram aplicadas e verificadas no projeto Supabase
hospedado (`ywrjojrjgozdfpddkkuy`; histórico 3/3, 2 RPCs, 2 índices, `statuses_text_check` até 7000). O **frontend**
passa a usar o limite de **7000** caracteres neste release. As seções abaixo ficam como referência de verificação,
homologação e recuperação.

## 1. O que cada migration faz e do que depende

| Migration | Efeito | Depende de | Obrigatória? |
|---|---|---|---|
| `20261017000001_feed_batch_interaction_rpcs` | RPCs `get_poll_results_batch` e `count_workout_participants_batch` (SECURITY DEFINER, `search_path` fixo, `EXECUTE` só para `authenticated`, fail-closed) | `is_community_member`, `_can_view_workout_status` (já existem desde 2026-10-06) | Não: sem ela o app usa as RPCs unitárias (o código de erro real é `PGRST202`) |
| `20261017000002_feed_partial_indexes` | 2 índices parciais (treinos futuros e destaques por comunidade) | nada | Não, só desempenho (61 → 9,4 ms e 11 → 1,7 ms numa comunidade de 50 mil posts) |
| `20261017000003_status_text_limit_7000` | `statuses_text_check`: 500 → 7000 | nada | **Sim** para permitir textos acima de 500 |

Ordem cronológica = ordem de aplicação (`000001 → 000002 → 000003`). As três são idempotentes (testado aplicando
duas vezes). `supabase db push` aplica todas as pendentes nessa ordem.

**Compatibilidade:** todas só ampliam (funções novas, índices novos, limite maior). O frontend anterior e o atual
funcionam com ou sem elas. A única combinação que falha é *frontend com limite 7000 + banco ainda em 500*
(erro `23514` ao publicar mais de 500 caracteres), por isso o limite do cliente só sobe depois da migration 3.

## 1.1 Pré-checagem (somente leitura, antes de aplicar qualquer coisa)

Confirme que está no projeto certo (`ywrjojrjgozdfpddkkuy`) e rode no SQL Editor:

```sql
-- dependências das RPCs: esperado 2 linhas
select proname from pg_proc
where pronamespace = 'public'::regnamespace and proname in ('is_community_member', '_can_view_workout_status');

-- a migration 3 troca a constraint pelo nome: esperado 1 linha, com char_length(text) <= 500
select conname, convalidated, pg_get_constraintdef(oid)
from pg_constraint where conrelid = 'public.statuses'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%char_length(text)%';

-- tamanho da tabela e maior texto atual (define quanto dura a validação do CHECK)
select count(*) as posts, coalesce(max(char_length(text)), 0) as maior_texto from public.statuses;

-- histórico das migrations já aplicadas no hospedado (compare com supabase/migrations/)
select version from supabase_migrations.schema_migrations order by version desc limit 15;
```

**Cuidado com `supabase db push`:** se o histórico hospedado divergir do repositório (versões aplicadas só no
hospedado, ou migrations locais antigas ausentes lá), o `db push` recusa ou tenta aplicar o que não deveria.
Antes de usá-lo, rode `supabase migration list` (precisa de login/link ao projeto). Na dúvida, prefira colar os
3 arquivos, nessa ordem, no SQL Editor e depois registrar as versões. Qualquer caminho exige sua autorização
explícita; nada disto foi executado.

**Sem interrupção do serviço:** `000001` só cria funções; `000002` usa `CREATE INDEX` comum (bloqueia escrita em
`statuses` durante a criação, instantâneo em tabelas pequenas; em tabela grande rode fora de transação com
`create index concurrently if not exists …`); `000003` troca o CHECK (lock `ACCESS EXCLUSIVE` curto, mas
valida todas as linhas). Para blindar, abra a sessão com `set lock_timeout = '3s';` e, se a tabela for grande,
use `add constraint … check (…) not valid;` seguido de `validate constraint statuses_text_check;` em transações
separadas. Ao final, `notify pgrst, 'reload schema';` garante que o PostgREST enxergue as RPCs novas.

## 2. Ordem exata de publicação

1. **Banco (sem janela de manutenção):** aplicar `000001`, `000002`, `000003` (SQL Editor ou `supabase db push`).
2. **Verificar o banco** (seção 3). Só continue se tudo bater.
3. **Frontend:** em `src/utils/statusLimits.js` trocar `STATUS_TEXT_MAX_LENGTH` de `500` para `7000`
   (o teste `statusLimits.test.js` garante que o cliente nunca passe do que a migration permite), rodar
   `npm test`, commit, push em `main` (deploy automático da Vercel).
4. **Validar após o deploy** (seção 4).

## 3. Verificação do banco (colar no SQL Editor)

```sql
-- RPCs: esperado definer = true, config com search_path=public, pg_temp, anon_exec = false, auth_exec = true
select p.proname, p.prosecdef as definer, p.proconfig as config,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('get_poll_results_batch', 'count_workout_participants_batch');

-- índices: esperado 2 linhas
select indexname from pg_indexes
where schemaname = 'public' and tablename = 'statuses'
  and indexname in ('statuses_community_workout_date_idx', 'statuses_community_promoted_idx');

-- limite: esperado "... <= 7000"
select pg_get_constraintdef(oid) from pg_constraint where conname = 'statuses_text_check';

-- 7000 aceito e 7001 recusado, sem deixar rastro (o ROLLBACK desfaz tudo; o 2º INSERT deve dar erro 23514)
begin;
create temp table _t as select id as community_id, created_by as author_id from public.communities limit 1;
insert into public.statuses (community_id, author_id, type, text)
  select community_id, author_id, 'text', repeat('x', 7000) from _t;
insert into public.statuses (community_id, author_id, type, text)
  select community_id, author_id, 'text', repeat('x', 7001) from _t;
rollback;
```

## 4. Validação após o deploy (homologação com conta de teste, sem service-role)

Automática (somente leitura; precisa de uma conta de teste que seja membro de comunidades com enquetes/treinos):

```
VERIFY_EMAIL=conta-teste@exemplo.com VERIFY_PASSWORD='...' node scripts/verify-communities-activity.mjs
```

Esperado: todas as linhas `PASS` (prévia do hub == consulta por comunidade, RPCs em lote == chamadas unitárias,
ids que a conta não vê não devolvem nada). Se as RPCs em lote ainda não existirem, o script avisa e o app usa o
fallback.

Manual (celular ou DevTools em 390 px, tema claro e escuro):

- [ ] Abrir uma comunidade: cabeçalho compacto, abas Recentes/Destaques, Publicar e Compartilhar progresso.
- [ ] Network: ~13 requisições REST na abertura (não cresce com o número de publicações) e nenhuma conexão
      `realtime` por autor.
- [ ] Rolar até o fim: as páginas carregam sozinhas (10 por vez); abrir um perfil e voltar mantém a posição.
- [ ] Publicar texto de **7000** caracteres com título, lista e tabela: aceito, contador `7000 / 7000`, rascunho
      restaurado após recarregar, publicação com "Ver mais/Ver menos"; **7001** não é possível digitar.
- [ ] Menu ⋯ → "Atualizar publicações" atualiza totais de enquete sem perder a rolagem.
- [ ] Com uma publicação promovida ativa: uma linha "Em destaque" no topo de Recentes que leva à aba Destaques.
- [ ] Destaque vencido: uma publicação promovida que já expirou não aparece em Destaques, no contador nem no
      destaque do topo, mesmo logo após recarregar com o cache; ao promover uma publicação, a aba Destaques
      passa a listá-la sem esperar o cache de 5 min.
- [ ] Conta que **não** é membro: "Entre para ver o feed" e nenhuma publicação nas respostas da rede.
- [ ] Dono da comunidade (não superadmin): "Gerenciar" mostra `@usuário` dos membros, nunca o UUID.

**Limpeza:** o teste de 7000 caracteres cria uma publicação real na conta de teste; apague-a pelo próprio app
(botão "Excluir publicação" no cartão) ao terminar. Não use service-role nem altere dados de outros usuários.

## 5. Recuperação (rollback)

**Frontend:** na Vercel, promover o deploy anterior (ou `git revert` e push). É seguro com qualquer combinação de
migrations aplicadas, pelo que está descrito em "Compatibilidade".

**Banco, por migration:**

| Migration | Reverter? | Como |
|---|---|---|
| `000001` | Pode, sem risco | `drop function if exists public.get_poll_results_batch(uuid[]); drop function if exists public.count_workout_participants_batch(uuid[]);` (o app cai no fallback unitário sozinho; testado contra o PostgREST) |
| `000002` | Pode, sem risco | `drop index if exists public.statuses_community_workout_date_idx; drop index if exists public.statuses_community_promoted_idx;` |
| `000003` | **NÃO reverter** depois que existir post com mais de 500 caracteres | Recolocar `<= 500`, mesmo como `NOT VALID`, faz **todo UPDATE** de um post longo falhar (o `CHECK` é reavaliado em qualquer atualização), quebrando curtidas e contadores de comentário desses posts (verificado). O frontend antigo convive bem com posts longos. Se for indispensável, primeiro tratar os posts com `char_length(text) > 500`. |

Se o problema for só o texto de 7000 no cliente, volte `STATUS_TEXT_MAX_LENGTH` para 500 e publique: não exige
mexer no banco.

## 6. Riscos conhecidos

- A verificação autenticada no projeto hospedado depende de uma conta de teste (não existe no ambiente de
  desenvolvimento); até lá, RLS/RPCs foram validados em PostgreSQL local com PostgREST real e 42 testes pgTAP.
- Paginação profunda custa proporcional à profundidade (12,7 ms a 25 mil posts de profundidade); só uma RPC com
  comparação de linhas e novo índice resolveria, e não se justifica hoje.
- O destaque compacto e os contadores locais usam o relógio do cliente (minuto a minuto): uma promoção que acabou
  de vencer some em até ~1 minuto, inclusive quando a lista veio do cache (a lista de destaques é filtrada no
  cliente por `promoted` e `promotedUntil`). A regra comercial continua sendo a do servidor (RLS/RPC de promoção).
- A identidade do `gh` (wellington-lira-brisa) difere do autor git (danielalveslira): confira antes do push.
