-- "Quem vai participar" (Treino Marcado): lista e contagem de participantes via RPC.
--
-- Causa do erro PGRST200: o frontend fazia `status_participants?select=user_id,joined_at,public_profiles(username)`
-- (embed do PostgREST), mas NÃO existe relacionamento entre as duas tabelas -- ambas referenciam
-- public.users(id) (status_participants.user_id e public_profiles.user_id), nunca uma à outra, e o
-- PostgREST só embute por FK direta. Criar uma FK artificial só para isso não faz sentido (e não
-- resolveria o segundo problema abaixo).
-- Segundo problema (mesmo código): a policy status_participants_select (20260930000003) só libera a
-- PRÓPRIA linha (user_id = auth.uid()) -- um membro nunca enxergaria os outros participantes, nem na
-- lista nem na contagem do card ("N confirmados" mostrava só 0/1).
-- Solução: duas RPCs security definer, só leitura, mesma regra de acesso de quem enxerga a publicação
-- (statuses_select = membro da comunidade OU superadmin), FAIL-CLOSED (coalesce em toda parcela: NULL de
-- has_app_access() nunca significa permitido), sem N+1 (um JOIN com public_profiles), retornando só
-- { userId, username }. Conta excluída não aparece (o vínculo some em cascata); perfil público ausente
-- vira username null (a UI mostra "Membro").

create or replace function public._can_view_workout_status(p_status public.statuses) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(public.is_superadmin(), false)
    or (
      coalesce(public.is_community_member(p_status.community_id), false)
      and not exists (
        select 1 from public.community_restrictions
        where community_id = p_status.community_id and user_id = auth.uid()
      )
    )
$$;
revoke execute on function public._can_view_workout_status(public.statuses) from public, anon, authenticated;

-- Ordem: quem confirmou primeiro, primeiro (mesma ordem da lista anterior), keyset (joined_at, user_id).
create or replace function public.list_workout_participants(
  p_status_id uuid, p_cursor_at timestamptz default null, p_cursor_user uuid default null, p_limit integer default 20
) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_status public.statuses;
  v_page_size integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_rows jsonb;
  v_count integer;
  v_last_at timestamptz;
  v_last_user uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if (p_cursor_at is null) <> (p_cursor_user is null) then raise exception 'INVALID_CURSOR'; end if;
  select * into v_status from public.statuses where id = p_status_id and type = 'workout';
  if v_status.id is null then raise exception 'STATUS_NOT_FOUND'; end if;
  if not coalesce(public._can_view_workout_status(v_status), false) then raise exception 'PERMISSION_DENIED'; end if;

  with page as (
    select p.user_id, p.joined_at, pp.username
    from public.status_participants p
    left join public.public_profiles pp on pp.user_id = p.user_id
    where p.status_id = p_status_id
      and (p_cursor_at is null or (p.joined_at, p.user_id) > (p_cursor_at, p_cursor_user))
    order by p.joined_at, p.user_id
    limit v_page_size + 1
  ), shown as (
    select * from page order by joined_at, user_id limit v_page_size
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('userId', s.user_id, 'username', s.username) order by s.joined_at, s.user_id), '[]'::jsonb),
    (select count(*) from page),
    (select joined_at from shown order by joined_at desc, user_id desc limit 1),
    (select user_id from shown order by joined_at desc, user_id desc limit 1)
    into v_rows, v_count, v_last_at, v_last_user
  from shown s;

  return jsonb_build_object(
    'participants', v_rows,
    'nextCursor', case when v_count > v_page_size then jsonb_build_object('at', v_last_at, 'userId', v_last_user) else null end
  );
end;
$$;
revoke execute on function public.list_workout_participants(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.list_workout_participants(uuid, timestamptz, uuid, integer) to authenticated;

-- Contagem real ("N confirmados") -- a leitura direta só enxergava a própria linha.
create or replace function public.count_workout_participants(p_status_id uuid) returns integer
  language plpgsql stable security definer set search_path = public as $$
declare
  v_status public.statuses;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_status from public.statuses where id = p_status_id and type = 'workout';
  if v_status.id is null then raise exception 'STATUS_NOT_FOUND'; end if;
  if not coalesce(public._can_view_workout_status(v_status), false) then raise exception 'PERMISSION_DENIED'; end if;
  return (select count(*)::integer from public.status_participants where status_id = p_status_id);
end;
$$;
revoke execute on function public.count_workout_participants(uuid) from public, anon;
grant execute on function public.count_workout_participants(uuid) to authenticated;
