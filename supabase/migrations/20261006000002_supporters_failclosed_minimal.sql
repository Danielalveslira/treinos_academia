-- Hardening de list_post_supporters ("Quem curtiu"):
--
-- 1. FAIL-OPEN: a checagem `if not (is_superadmin() or (is_community_member(...) and ...))` recebia NULL
--    de has_app_access() para membros que não aceitaram os Termos vigentes; `NOT NULL` é NULL e o IF
--    não bloqueava -- NULL significava "permitido". Agora cada parcela passa por coalesce(..., false) e o
--    resultado final também: NULL nunca libera acesso.
-- 2. MINIMIZAÇÃO: o modal deixou de mostrar avatar (avatarPath só era consumido por ele), então a RPC
--    devolve apenas { userId, username } -- o JOIN com public_profiles passa a ler só `username`.
-- Mesma assinatura e mesmo tipo de retorno (jsonb): CREATE OR REPLACE basta (grants preservados, e
-- reafirmados abaixo).

create or replace function public.list_post_supporters(
  p_status_id uuid, p_cursor_at timestamptz default null, p_cursor_user uuid default null, p_limit integer default 20
) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_status public.statuses;
  v_allowed boolean;
  v_page_size integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_rows jsonb;
  v_count integer;
  v_last_at timestamptz;
  v_last_user uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if (p_cursor_at is null) <> (p_cursor_user is null) then raise exception 'INVALID_CURSOR'; end if;
  select * into v_status from public.statuses where id = p_status_id;
  if v_status is null then raise exception 'STATUS_NOT_FOUND'; end if;

  -- FAIL-CLOSED: has_app_access() (dentro de is_community_member) devolve NULL quando o usuário não
  -- aceitou os Termos vigentes. Com `if not (NULL)` o bloqueio NÃO disparava e o acesso passava.
  -- Cada parcela vira boolean estrito com coalesce(..., false); NULL nunca significa permitido.
  v_allowed := coalesce(public.is_superadmin(), false)
    or (
      coalesce(public.is_community_member(v_status.community_id), false)
      and not exists (
        select 1 from public.community_restrictions
        where community_id = v_status.community_id and user_id = auth.uid()
      )
    );
  if not coalesce(v_allowed, false) then
    raise exception 'PERMISSION_DENIED';
  end if;

  with page as (
    select v.user_id, v.updated_at, pp.username
    from public.status_economy_votes v
    left join public.public_profiles pp on pp.user_id = v.user_id
    where v.status_id = p_status_id and v.value = 1
      and (p_cursor_at is null or (v.updated_at, v.user_id) < (p_cursor_at, p_cursor_user))
    order by v.updated_at desc, v.user_id desc
    limit v_page_size + 1
  ), shown as (
    select * from page order by updated_at desc, user_id desc limit v_page_size
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('userId', s.user_id, 'username', s.username)
      order by s.updated_at desc, s.user_id desc), '[]'::jsonb),
    (select count(*) from page),
    (select updated_at from shown order by updated_at asc, user_id asc limit 1),
    (select user_id from shown order by updated_at asc, user_id asc limit 1)
    into v_rows, v_count, v_last_at, v_last_user
  from shown s;

  return jsonb_build_object(
    'supporters', v_rows,
    'nextCursor', case when v_count > v_page_size
      then jsonb_build_object('at', v_last_at, 'userId', v_last_user) else null end
  );
end;
$$;
revoke execute on function public.list_post_supporters(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.list_post_supporters(uuid, timestamptz, uuid, integer) to authenticated;
