-- Adiciona heightCm ao conjunto de campos que update_user_profile aceita (mesmo
-- allowlist client-side do firestore.rules atual: bio/username/shareStatistics/heightCm).
create or replace function public.update_user_profile(payload jsonb) returns public.users
  language plpgsql security definer set search_path = public as $$
declare
  v_username text;
  v_previous_username text;
  v_entries bigint;
  v_sets numeric;
  v_user public.users;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select username into v_previous_username from public.users where id = auth.uid();

  if payload ? 'bio' then
    if char_length(trim(coalesce(payload->>'bio', ''))) > 300 then
      raise exception 'BIO_TOO_LONG';
    end if;
    update public.users set bio = nullif(trim(coalesce(payload->>'bio', '')), '') where id = auth.uid();
  end if;

  if payload ? 'username' then
    v_username := lower(trim(payload->>'username'));
    if v_username !~ '^[a-z0-9_]{3,20}$' then
      raise exception 'INVALID_USERNAME';
    end if;
    if v_previous_username is distinct from v_username then
      insert into public.usernames (username, user_id) values (v_username, auth.uid())
        on conflict (username) do nothing;
      if not exists (select 1 from public.usernames where username = v_username and user_id = auth.uid()) then
        raise exception 'USERNAME_TAKEN';
      end if;
    end if;
    update public.users set username = v_username where id = auth.uid();
  end if;

  if payload ? 'shareStatistics' then
    if jsonb_typeof(payload->'shareStatistics') <> 'boolean' then
      raise exception 'INVALID_PRIVACY';
    end if;
    update public.users set share_statistics = (payload->>'shareStatistics')::boolean where id = auth.uid();
  end if;

  if payload ? 'heightCm' then
    if coalesce(payload->>'heightCm', '') = '' then
      update public.users set height_cm = null where id = auth.uid();
    else
      if (payload->>'heightCm')::numeric not between 50 and 250 then
        raise exception 'INVALID_HEIGHT';
      end if;
      update public.users set height_cm = (payload->>'heightCm')::smallint where id = auth.uid();
    end if;
  end if;

  select * into v_user from public.users where id = auth.uid();

  insert into public.public_profiles (user_id, username, bio, share_statistics)
    values (auth.uid(), v_user.username, v_user.bio, v_user.share_statistics)
    on conflict (user_id) do update set
      username = excluded.username, bio = excluded.bio, share_statistics = excluded.share_statistics;

  if v_user.share_statistics then
    select count(*), coalesce(sum(sets), 0) into v_entries, v_sets
      from public.workouts where user_id = auth.uid();
    insert into public.public_profile_statistics (user_id, entries, sets, updated_at)
      values (auth.uid(), v_entries, v_sets, now())
      on conflict (user_id) do update set entries = excluded.entries, sets = excluded.sets, updated_at = now();
  else
    delete from public.public_profile_statistics where user_id = auth.uid();
  end if;

  if v_username is not null and v_previous_username is not null and v_previous_username is distinct from v_username then
    delete from public.usernames where username = v_previous_username and user_id = auth.uid();
  end if;

  return v_user;
end;
$$;
