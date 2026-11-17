# Auditoria: concessão padrão de SELECT a `anon` em tabelas restritas por RLS

**Data:** 17/11/2026 · **Origem:** investigação das falhas em `commercial_terms_evidence_test.sql`
e `legal_acceptance_integrity_test.sql` durante a finalização do PR #151.

## Causa-raiz confirmada

O Postgres do Supabase concede `SELECT`/`REFERENCES`/`TRIGGER` a `anon` e `authenticated` por
padrão em toda tabela nova do schema `public` (confirmado numa tabela de teste criada antes de
qualquer migration do projeto, em banco novo, nas duas versões de Postgres observadas: a já
rodando localmente e `17.11.0.011`, a mesma que o Supabase CLI instalado usa). Esse padrão não é
bug do projeto — é a política de fábrica do Supabase, que pressupõe RLS como o controle real. O
problema é quando uma tabela foi corrigida só parcialmente: revoga-se `insert/update/delete/truncate`
de `anon`, mas esquece-se de revogar o `select` residual, deixando uma concessão de tabela que
nunca deveria existir mesmo que a RLS bloqueie o acesso real hoje.

**Por que isso importa mesmo com RLS bloqueando:** a concessão de tabela e a política RLS são
camadas independentes. Enquanto a RLS estiver correta, `anon` não vê nenhuma linha. Mas se uma
política de RLS for alterada, removida ou tiver uma regressão futura, uma tabela sem a concessão
de `SELECT` falha fechada (nega acesso na camada de permissão, antes mesmo de avaliar RLS);
uma tabela com a concessão residual de `anon` falharia aberta, dependendo só da RLS continuar
certa para sempre.

## Tabelas já corrigidas nesta rodada (PR #151)

| Tabela | RLS | Ação |
|---|---|---|
| `public.commercial_terms_acceptances` | `user_id = auth.uid() OR is_superadmin()` | `revoke select ... from anon` — `20261221000002_restrict_consent_acceptance_anon_select.sql` |
| `public.privacy_consent_events` | `user_id = auth.uid()` | idem |

## Tabelas que já seguem o padrão correto (nenhuma ação necessária)

Estas três **já não têm** `SELECT` de `anon` — algum revoke mais específico, feito em migration
separada, já cobriu o caso corretamente. Servem de referência do padrão a replicar nas demais:

- `public.economy_transactions`
- `public.status_economy_votes`
- `public.wallets`

## Tabelas intencionalmente públicas (RLS confirma a intenção, nenhuma ação necessária)

A própria política de RLS dessas tabelas já é `using (true)` ou equivalente ("qualquer um pode
ler"), e `commercial_terms_evidence_test.sql`/`legal_acceptance_integrity_test.sql` já afirmam
isso como requisito (`'documentos publicados são legíveis sem login'`, `'texto do consentimento é
público'`). A concessão de `anon` aqui está de acordo com a intenção documentada:

| Tabela | RLS |
|---|---|
| `public.legal_document_policy` | `true` (grant explícito a `anon` already present) |
| `public.legal_document_versions` | `true` (grant explícito a `anon` already present) |
| `public.legal_policy` | `true` |
| `public.legal_versions` | `published_at is not null` (só documento já publicado) |
| `public.privacy_consent_texts` | público (grant explícito, teste já confirma) |

## Candidatas reais ao mesmo problema — pendentes de decisão/correção

Estas cinco têm RLS restrita ao próprio usuário ou a superadmin — a mesma forma das duas já
corrigidas — mas **ainda concedem `SELECT` a `anon`** por nunca ter sido revogado explicitamente.
Nenhuma suíte pgTAP afirma hoje o que deveria acontecer com `anon` nelas, então esta auditoria não
está corrigindo — só registrando a evidência para uma decisão e correção futuras (mesmo padrão de
migration das duas já corrigidas: `revoke select on public.<tabela> from anon;`, sem tocar RLS nem
a concessão de `authenticated`):

| Tabela | RLS atual (`USING`) | Por que é suspeita |
|---|---|---|
| `public.legal_acceptances` | `user_id = auth.uid() OR is_superadmin()` | Mesmo formato exato das duas já corrigidas. |
| `public.economy_config` | `auth.uid() is not null` | Exige login, mas não revoga `anon` na concessão de tabela. |
| `public.economy_daily` | `user_id = auth.uid() OR is_superadmin()` AND sessão ativa | Dado financeiro por usuário; mesmo formato das já corrigidas. |
| `public.economy_daily_author_rewards` | `user_id = auth.uid() OR is_superadmin()` | Idem. |
| `public.status_economy_reward_daily` | `is_superadmin()` apenas | Nem `authenticated` comum deveria ler; `anon` muito menos. |

## Recomendação para a próxima rodada

1. Confirmar com o time de produto/segurança se alguma dessas cinco precisa mesmo ser pública
   para algum fluxo anônimo hoje não coberto por RPC `SECURITY DEFINER` (nenhuma função
   `SECURITY INVOKER` encontrada que dependa da concessão direta de `anon` nessas tabelas).
2. Para cada uma confirmada como indevida, adicionar `revoke select on public.<tabela> from anon;`
   numa migration aditiva, mais uma asserção pgTAP (`not has_table_privilege('anon', ..., 'select')`)
   no arquivo de teste correspondente — mesmo molde usado em
   `20261221000002_restrict_consent_acceptance_anon_select.sql`.
3. Considerar uma varredura automatizada (script ou teste pgTAP único) que liste toda tabela de
   `public` com RLS restrita a `auth.uid()`/`is_superadmin()` e falhe se `anon` ainda tiver
   `SELECT` — evitaria esse tipo de lacuna aparecer de novo em tabelas futuras.
