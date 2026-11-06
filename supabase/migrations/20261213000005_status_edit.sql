-- Edição de publicação pelo próprio autor (texto e legenda de foto, primeira entrega -- enquete,
-- treino marcado e conquista continuam somente leitura). Sem policy UPDATE em public.statuses
-- (ver 20261026000005_aud_security_atomic.sql: "Não existe edição de post nem policy UPDATE no
-- contrato atual") -- de propósito, continua assim; esta migration NÃO abre UPDATE genérico, só
-- uma RPC estreita que aceita exclusivamente os campos editáveis.

alter table public.statuses add column if not exists edited_at timestamptz;

-- Selo "Admin da comunidade" no cabeçalho do post: dono ATUAL (mesmo raciocínio do selo em
-- comentários, ver 20261213000004_comment_author_role_badges.sql) -- nunca histórico, para não
-- manter o selo depois de perder a comunidade. Superadmin do post permanece histórico
-- (author_is_superadmin já existente, gravado pelo trigger no momento da publicação) -- não
-- regride.
create function private.status_author_is_community_admin(p_status public.statuses) returns boolean
  language sql stable security definer set search_path = '' as $$
    select exists (
      select 1 from public.communities c
      where c.id = p_status.community_id and c.owner_id = p_status.author_id
    )
$$;
revoke all on function private.status_author_is_community_admin(public.statuses) from public, anon;
grant execute on function private.status_author_is_community_admin(public.statuses)
  to authenticated, service_role;

create or replace view public.status_publications with (security_invoker = true) as
select s.*, private.status_promotion_until(s) as verified_promoted_until,
  case when s.expires_at is null or s.retention_mode = 'no_auto_expiration' then null
    else greatest(s.expires_at, private.status_promotion_until(s)) end as publication_expires_at,
  private.status_interaction_expiry(s) as interaction_expires_at,
  private.status_author_is_community_admin(s) as author_is_community_admin
from public.statuses s;

-- RPC estreita: só author_id = auth.uid() (nunca superadmin/dono -- moderação continua sendo só
-- excluir, ver statuses_delete), só text OU photo_caption (nunca id/community_id/author_id/
-- type/created_at/expires_at/retention_mode/contadores/votos/promoção), reaproveita
-- private.comments_open() -- a MESMA janela que já fecha comentários novos -- como o limite de
-- "publicação ainda ativa" para editar; expirar no meio da edição derruba com STATUS_EXPIRED, sem
-- gravar nada. edited_at serve de token de concorrência (igual expected_updated_at em
-- private.comment_edit): duas edições em paralelo, a segunda a chegar recebe EDIT_CONFLICT.
create or replace function private.status_edit(
  p_status_id uuid,
  p_text text,
  p_photo_caption text,
  p_expected_edited_at timestamptz
) returns public.statuses
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_status public.statuses;
  v_text text;
  v_caption text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into v_status from public.statuses where id = p_status_id for update;
  if not found then raise exception 'STATUS_NOT_FOUND'; end if;
  if v_status.author_id is distinct from v_uid then raise exception 'PERMISSION_DENIED'; end if;
  if not coalesce(public.is_community_member(v_status.community_id), false) then
    raise exception 'PERMISSION_DENIED';
  end if;
  -- private.comments_open() pode voltar NULL (retention_mode nulo faz "retention_mode =
  -- 'no_auto_expiration'" virar NULL em vez de false -- lógica de 3 valores do SQL): um `if not
  -- private.comments_open(v_status)` direto trataria esse NULL como falso e deixaria passar uma
  -- publicação já expirada. O EXISTS(... where ...) abaixo é o MESMO contorno que
  -- private.comment_edit já usa para esta função (20261002000004_comments_functions.sql) --
  -- WHERE descarta NULL como "sem linha", então EXISTS sempre devolve true/false, nunca NULL.
  if not exists (select 1 where private.comments_open(v_status)) then
    raise exception 'STATUS_EXPIRED';
  end if;
  if v_status.edited_at is distinct from p_expected_edited_at then raise exception 'EDIT_CONFLICT'; end if;

  if v_status.type = 'text' then
    v_text := btrim(coalesce(p_text, ''));
    -- Mesmo limite de statuses_text_check (20261017000003_status_text_limit_7000.sql).
    if char_length(v_text) not between 1 and 7000 then raise exception 'INVALID_BODY'; end if;
    update public.statuses set text = v_text, edited_at = now()
    where id = p_status_id
    returning * into v_status;
  elsif v_status.type = 'photo' then
    v_caption := btrim(coalesce(p_photo_caption, ''));
    if char_length(v_caption) > 280 then raise exception 'INVALID_BODY'; end if;
    update public.statuses set photo_caption = v_caption, edited_at = now()
    where id = p_status_id
    returning * into v_status;
  else
    raise exception 'EDIT_NOT_SUPPORTED_FOR_TYPE';
  end if;

  return v_status;
end;
$$;

create or replace function public.update_own_status_content(
  p_status_id uuid,
  p_text text default null,
  p_photo_caption text default null,
  p_expected_edited_at timestamptz default null
) returns public.statuses
language sql volatile security definer set search_path = '' as $$
  select private.status_edit(p_status_id, p_text, p_photo_caption, p_expected_edited_at)
$$;

revoke all on function private.status_edit(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.update_own_status_content(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.update_own_status_content(uuid, text, text, timestamptz) to authenticated;

NOTIFY pgrst, 'reload schema';
