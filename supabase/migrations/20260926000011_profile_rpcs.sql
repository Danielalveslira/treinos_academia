-- RPCs backing usersService.js / AuthContext.jsx. security definer so a single call
-- can atomically touch users + usernames + public_profiles, mirroring the
-- runTransaction/writeBatch combos the Firestore version used.

-- Equivalent to ensureUserProfile(userId): first-login bootstrap, idempotent.
create or replace function public.ensure_user_profile() returns public.users
  language plpgsql security definer set search_path = public as $$
declare
  v_user public.users;
begin
  select * into v_user from public.users where id = auth.uid();
  if v_user.public_profile_version = 1 then
    return v_user;
  end if;

  update public.users
    set public_profile_version = 1, share_statistics = false
    where id = auth.uid()
    returning * into v_user;

  insert into public.public_profiles (user_id, username, bio, share_statistics)
    values (auth.uid(), v_user.username, v_user.bio, false)
    on conflict (user_id) do update set
      username = excluded.username, bio = excluded.bio, share_statistics = false;

  return v_user;
end;
$$;

-- Equivalent to setUsername(userId, username): reserves the handle then mirrors it,
-- releasing the previous reservation only after the swap succeeds.
create or replace function public.set_username(p_username text) returns text
  language plpgsql security definer set search_path = public as $$
declare
  v_username text := lower(trim(p_username));
  v_previous text;
  v_bio text;
  v_share boolean;
begin
  if v_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'INVALID_USERNAME';
  end if;

  select username, bio, share_statistics into v_previous, v_bio, v_share
    from public.users where id = auth.uid();

  if v_previous is distinct from v_username then
    insert into public.usernames (username, user_id) values (v_username, auth.uid())
      on conflict (username) do nothing;
    if not exists (select 1 from public.usernames where username = v_username and user_id = auth.uid()) then
      raise exception 'USERNAME_TAKEN';
    end if;
  end if;

  update public.users set username = v_username where id = auth.uid();
  insert into public.public_profiles (user_id, username, bio, share_statistics)
    values (auth.uid(), v_username, v_bio, coalesce(v_share, false))
    on conflict (user_id) do update set username = excluded.username;

  if v_previous is not null and v_previous is distinct from v_username then
    delete from public.usernames where username = v_previous and user_id = auth.uid();
  end if;

  return v_username;
end;
$$;

-- Equivalent to updateUserProfile(userId, changes): only touches keys present in the
-- payload (mirrors Object.hasOwn checks), recomputing/dropping public statistics when
-- shareStatistics flips.
create or replace function public.update_user_profile(payload jsonb) returns public.users
  language plpgsql security definer set search_path = public as $$
declare
  v_username text;
  v_previous_username text;
  v_entries bigint;
  v_sets numeric;
  v_user public.users;
begin
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

-- Equivalent to setBirthInfo(userId, { sexo, dataNascimento }): private fields only,
-- never mirrored to public_profiles.
create or replace function public.set_birth_info(payload jsonb) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if payload ? 'sexo' then
    update public.users set sexo = nullif(payload->>'sexo', '') where id = auth.uid();
  end if;
  if payload ? 'dataNascimento' then
    update public.users set data_nascimento = case
      when coalesce(payload->>'dataNascimento', '') = '' then null
      else (payload->>'dataNascimento')::date
    end where id = auth.uid();
  end if;
end;
$$;
