-- AUD-02: grants de coluna + identidade inicial no servidor. Nenhum saneamento histórico.
begin;
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
commit;
