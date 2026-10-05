-- Endurecimento de segurança (auditoria de notificações). Nenhuma mudança de comportamento para
-- usuários legítimos: só remove privilégios que o app não usa e fecha vetores de defesa em profundidade.

-- 1) search_path: `public` sem `pg_temp` deixa o schema temporário ser consultado PRIMEIRO para
-- tabelas, então quem pudesse criar uma tabela temporária (TEMP é concedido a anon/authenticated)
-- sombrearia uma tabela não qualificada dentro de uma função SECURITY DEFINER. Hoje nenhuma das 90
-- funções referencia tabela sem `public.` (verificado por varredura do corpo), mas isto garante que
-- uma futura referência esquecida não vire escalada de privilégio. `pg_temp` por último não altera
-- a resolução de nenhum objeto real.
do $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and p.prokind = 'f' and n.nspname in ('public', 'private')
      and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public')
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
    v_count := v_count + 1;
  end loop;
  raise notice '[security] search_path com pg_temp em % funcoes', v_count;
end $$;

-- 2) EXECUTE: `anon` (visitante sem login) não precisa chamar nenhuma função SECURITY DEFINER do
-- app, exceto a listagem pública de profissionais e os auxiliares usados por políticas RLS (que são
-- avaliados com o papel do chamador). Funções de gatilho nunca devem ser chamáveis por clientes.
-- A lista é calculada no momento da migration, excluindo qualquer função citada por política, view,
-- default, constraint ou pelo CORPO de função INVOKER (o Postgres não registra essa dependência).
do $$
declare
  r record;
  v_anon integer := 0;
  v_trigger integer := 0;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname, (p.prorettype = 'trigger'::regtype) as is_trigger
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
      and p.proname <> 'list_published_professional_listings'
      and (has_function_privilege('anon', p.oid, 'execute')
        or (p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute')))
      and not exists (
        select 1 from pg_depend d
        where d.refobjid = p.oid
          and d.classid in ('pg_policy'::regclass, 'pg_rewrite'::regclass, 'pg_attrdef'::regclass, 'pg_constraint'::regclass))
      and not exists (
        select 1 from pg_proc q
        where not q.prosecdef and q.prokind = 'f' and q.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
          and q.proname <> p.proname and q.prosrc ~* ('\m' || p.proname || '\s*\('))
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    v_anon := v_anon + 1;
    if r.is_trigger then
      execute format('revoke execute on function %s from authenticated', r.sig);
      v_trigger := v_trigger + 1;
    end if;
  end loop;
  raise notice '[security] EXECUTE revogado de anon em % funcoes (% de gatilho tambem de authenticated)', v_anon, v_trigger;
end $$;

-- `email_verified_ok(uuid)` era um oráculo: qualquer pessoa perguntava se o e-mail de QUALQUER
-- usuário está verificado. Só funções DEFINER a usam (rodam como dono), então ninguém precisa dela.
revoke execute on function public.email_verified_ok(uuid) from public, anon, authenticated;

-- Reafirma (idempotente) os fechamentos de funções que só o worker/serviço pode chamar: se um
-- GRANT amplo for aplicado por engano no futuro, a próxima migration o desfaz.
revoke execute on function public.claim_push_jobs(text, integer) from public, anon, authenticated;
revoke execute on function public.finish_push_batch(text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_push_jobs(text, integer) to service_role;
grant execute on function public.finish_push_batch(text, jsonb) to service_role;

-- Auxiliares puros do pipeline de Push (usados só por funções DEFINER) herdavam EXECUTE de PUBLIC.
revoke execute on function private.is_push_endpoint_allowed(text) from public, anon, authenticated;
revoke execute on function private.push_category_enabled(jsonb, text) from public, anon, authenticated;
revoke execute on function private.safe_push_target_url(text) from public, anon, authenticated;

-- Funções criadas daqui para frente pelo papel das migrations não nascem executáveis por `anon`
-- (cada função pública precisa de um GRANT explícito, o que a torna visível em revisão).
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- 3) Tabelas: o RLS destas tabelas só tem política de SELECT, então já nega escrita de cliente,
-- mas os grants amplos (padrão do Supabase) faziam da RLS a ÚNICA barreira. Escrita só por RPC.
revoke insert, update, delete, truncate, references, trigger on
  public.notices, public.moderation_decisions, public.support_requests, public.account_restrictions,
  public.community_restrictions, public.admin_audit_log, public.cash_purchases,
  public.economy_transactions, public.wallets, public.status_economy_votes
  from anon, authenticated;
-- Visitantes não leem nada disto (as políticas dependem de auth.uid()).
revoke all on
  public.notices, public.moderation_decisions, public.support_requests, public.account_restrictions,
  public.community_restrictions, public.admin_audit_log, public.cash_purchases,
  public.economy_transactions, public.wallets, public.status_economy_votes
  from anon;
-- A view da Central é só leitura (security_invoker); DML nela só serviria de superfície.
revoke insert, update, delete, truncate, references, trigger on public.notification_items from anon, authenticated;
revoke all on public.notification_items from anon;
-- Novas tabelas não herdam mais ALL para `anon`.
alter default privileges for role postgres in schema public revoke all on tables from anon;

-- 4) Marcar/arquivar: lista de ids limitada (evita requisição gigante) e sempre restrita ao dono.
create or replace function public.notifications_mark_read(
  p_ids bigint[] default null, p_before timestamptz default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_ids is null and p_before is null then raise exception 'INVALID_ARGUMENT'; end if;
  if p_ids is not null and cardinality(p_ids) > 200 then raise exception 'INVALID_ARGUMENT'; end if;
  update public.notifications
  set read_at = coalesce(read_at, now())
  where recipient_id = v_uid
    and read_at is null
    and (p_ids is null or id = any(p_ids))
    and (p_before is null or created_at <= p_before);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.notifications_archive(
  p_ids bigint[] default null, p_before timestamptz default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_ids is null and p_before is null then raise exception 'INVALID_ARGUMENT'; end if;
  if p_ids is not null and cardinality(p_ids) > 200 then raise exception 'INVALID_ARGUMENT'; end if;
  update public.notifications
  set archived_at = now(),
      read_at = coalesce(read_at, now())
  where recipient_id = v_uid
    and archived_at is null
    and (p_ids is null or id = any(p_ids))
    and (p_before is null or created_at <= p_before);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 5) action_url: o banco só garantia "começa com /, sem //". Agora também rejeita "\" e caracteres de
-- controle (o navegador remove tab/nova linha de URLs: "/<TAB>/host" viraria "//host" e abriria
-- redirecionamento em "abrir em nova aba"). NOT VALID + VALIDATE: linhas antigas conferidas, nenhum
-- produtor existente gera esses caracteres.
alter table public.notifications drop constraint if exists notifications_action_url_safe_chk;
alter table public.notifications add constraint notifications_action_url_safe_chk
  check (action_url is null or (position(chr(92) in action_url) = 0 and action_url !~ E'[[:cntrl:][:space:]\\u2028\\u2029]')) not valid;
alter table public.notifications validate constraint notifications_action_url_safe_chk;

-- Mesma regra no sanitizador usado pelo claim (o que o worker recebe nunca tem espaço/controle/barra invertida).
create or replace function private.safe_push_target_url(p_url text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_url is not null and char_length(p_url) <= 300 and left(p_url, 1) = '/'
      and left(p_url, 2) <> '//' and position(chr(92) in p_url) = 0
      and p_url !~ E'[[:cntrl:][:space:]\\u2028\\u2029]' then p_url
    else '/'
  end
$$;
revoke execute on function private.safe_push_target_url(text) from public, anon, authenticated;
