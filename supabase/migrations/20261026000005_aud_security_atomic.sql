-- Pacote indivisível AUD-01/AUD-02; requer revisão e autorização do destino.
-- Sem escrita manual no journal. Para release, uma migration consolidada via CLI;
-- somente após confirmar que as quatro fontes nunca foram publicadas.
-- Transação e histórico sob responsabilidade da CLI.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- SOURCE 20261026000001_close_account_rollback.sql; SHA256 12a0d4cfd9dbd4350e32f3be4dd33300f2191783d63aafe6657f1116df207fd4
-- AUD-01: rollback imediato desativado. Toda exclusão usa queue_deletion + revisão + worker.
-- Não é possível provar ausência de obrigações por idade da conta ou pelas FKs.

create or replace function public.delete_own_account() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'ACCOUNT_DELETION_REQUIRES_OFFICIAL_FLOW';
end;
$$;
alter function public.delete_own_account() owner to postgres;
revoke all on function public.delete_own_account() from public, anon, authenticated, service_role;

drop policy if exists users_delete_fresh on public.users;
drop policy if exists public_profiles_delete_fresh on public.public_profiles;
drop policy if exists usernames_delete on public.usernames;
revoke delete, truncate on public.users, public.public_profiles, public.public_profile_statistics,
  public.usernames, auth.users from public, anon, authenticated;
-- Não revogar o worker/service_role: suas RPCs continuam com as validações oficiais.



-- SOURCE 20261026000002_status_write_allowlist.sql; SHA256 03967a36ea4edf3d8c8278989036cff4709d4493d1f3f50d7bb4df7bf74f4dea
-- AUD-02: grants de coluna + identidade inicial no servidor. Nenhum saneamento histórico.

-- REVOKE de tabela não remove grants antigos de coluna; limpar ambos antes da allowlist.
revoke insert, update on public.statuses from public, anon, authenticated;
do $$
declare c record;
begin
  for c in select attname from pg_catalog.pg_attribute
    where attrelid = 'public.statuses'::regclass and attnum > 0 and not attisdropped
  loop
    execute format('revoke insert (%I), update (%I) on public.statuses from public, anon, authenticated', c.attname, c.attname);
  end loop;
end;
$$;
-- id é escolhido antes do upload de foto. author_id é validado por RLS e pelo trigger.
-- Conteúdo achievement/progress é declarativo; não credita carteira nem comprova treino.
grant insert (id, community_id, author_id, type, text, poll_question, poll_options,
  workout_title, workout_date, workout_location, achievement_day, achievement_text,
  achievement_entries, achievement_sets, photo_path, photo_caption,
  progress_kind, progress_period_start, progress_period_end) on public.statuses to authenticated;
-- Não existe edição de post nem policy UPDATE no contrato atual. UPSERT DO UPDATE também negado.

create or replace function private.statuses_initialize_identity() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  -- Usa o papel SQL efetivo, não o claim "role" nem a presença de sub no JWT.
  -- RPCs DEFINER e serviço mantêm operações internas mesmo com um sub de usuário.
  if current_user in ('authenticated', 'anon') then
    if v_uid is null then
      raise exception using errcode = '42501', message = 'NOT_AUTHENTICATED';
    end if;
    if new.author_id is distinct from v_uid then
      raise exception using errcode = '42501', message = 'STATUS_AUTHOR_MISMATCH';
    end if;
    new.author_id := v_uid;
  end if;
  select u.username, u.role = 'superadmin' into new.author_username, new.author_is_superadmin
    from public.users u where u.id = new.author_id;
  if current_user in ('authenticated', 'anon') then
    new.created_at := now();
    new.promoted := false;
    new.promoted_until := null;
    new.active_promotion_id := null;
    new.positive_vote_count := 0;
    new.negative_vote_count := 0;
    new.comment_count := 0;
  end if;
  return new;
end;
$$;
alter function private.statuses_initialize_identity() owner to postgres;
revoke all on function private.statuses_initialize_identity() from public, anon, authenticated;
-- Executa depois dos triggers de retenção/selo (ordem alfabética).
drop trigger if exists statuses_initialize_identity on public.statuses;
create trigger statuses_initialize_identity before insert on public.statuses
for each row execute function private.statuses_initialize_identity();



-- SOURCE 20261026000003_status_legacy_author_compat.sql; SHA256 a3a77a6da1ebe619db4ccea37fbdafd53b92a6cb6e243b0888f2efffd398a9b6
-- Compatibilidade de clientes antigos/PWA: estes dois campos são dicas descartadas.
-- O trigger statuses_initialize_identity sobrescreve ambos com public.users.
-- Não restaurar INSERT de tabela nem UPDATE; promoção/contadores continuam proibidos.

grant insert (author_username, author_is_superadmin) on public.statuses to authenticated;



-- SOURCE 20261026000004_community_promotion_server_only.sql; SHA256 26166759bf5f9afc61ddc01d5768841d4c11c5cbfcc8842bffd03a465b7baa49
-- Promoção de comunidade usa a mesma RPC paga do post. UPDATE direto do dono
-- não pode fabricar/cancelar/estender destaque. Admin de aplicação usa as RPCs também.

create or replace function private.communities_guard_promotion_fields() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.promoted or new.promoted_until is not null or new.active_promotion_id is not null then
        raise exception using errcode = '42501', message = 'COMMUNITY_PROMOTION_SERVER_ONLY';
      end if;
    elsif new.promoted is distinct from old.promoted
       or new.promoted_until is distinct from old.promoted_until
       or new.active_promotion_id is distinct from old.active_promotion_id then
      raise exception using errcode = '42501', message = 'COMMUNITY_PROMOTION_SERVER_ONLY';
    end if;
  end if;
  return new;
end;
$$;
alter function private.communities_guard_promotion_fields() owner to postgres;
revoke all on function private.communities_guard_promotion_fields() from public, anon, authenticated;
drop trigger if exists communities_guard_promotion_fields on public.communities;
create trigger communities_guard_promotion_fields before insert or update on public.communities
for each row execute function private.communities_guard_promotion_fields();



NOTIFY pgrst, 'reload schema';
