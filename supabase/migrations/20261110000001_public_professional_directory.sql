-- Projeção pública mínima. A tabela continua protegida por has_app_access();
-- somente estas RPCs podem ler publicações de contas ativas sem sessão.
create or replace function public.public_list_professionals(
  p_kind text default 'professional', p_modality text default null,
  p_uf text default null, p_city text default null,
  p_service_mode text default null, p_offset integer default 0,
  p_limit integer default 20
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_rows jsonb;
  v_total integer;
  v_city text;
begin
  if p_kind is null or p_kind not in ('professional', 'space')
    or (p_modality is not null and (length(p_modality) > 40 or p_modality !~ '^[a-z_]+$'))
    or (p_uf is not null and p_uf !~ '^[A-Z]{2}$')
    or (p_city is not null and length(p_city) > 80)
    or (p_service_mode is not null and p_service_mode not in ('in_person', 'online', 'hybrid'))
    or p_offset is null or p_offset < 0 or p_offset > 1000
    or p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;
  v_city := nullif(public._normalize_search_value(trim(p_city)), '');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', item.listing_id, 'kind', item.kind, 'displayName', item.display_name,
    'categoryKey', item.category_key, 'modalityKeys', item.modality_keys,
    'city', item.city, 'uf', item.uf, 'serviceMode', item.service_mode,
    'avatarPath', item.avatar_path
  ) order by item.sort_key, item.listing_id), '[]'::jsonb), count(*)
  into v_rows, v_total
  from (
    select p.listing_id, p.kind, p.display_name, p.category_key,
      p.modality_keys, p.city, p.uf, p.service_mode, p.avatar_path, p.sort_key
    from public.published_professional_listings p
    join public.professional_listings l on l.id = p.listing_id
    join public.users u on u.id = l.owner_id
    where l.lifecycle_state = 'published' and u.account_status = 'active'
      and not exists (select 1 from public.account_restrictions r
        where r.user_id = u.id and not (r.action = 'temporary_suspension' and r.until <= now()))
      and p.kind = p_kind
      and (p_modality is null or p.modality_keys @> array[p_modality])
      and (p_uf is null or p.uf = p_uf)
      and (v_city is null or p.city_key = v_city)
      and (p_service_mode is null or p.service_mode = p_service_mode)
    order by p.sort_key, p.listing_id
    limit p_limit + 1 offset p_offset
  ) item;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(value), '[]'::jsonb)
      from jsonb_array_elements(v_rows) with ordinality as entry(value, position)
      where position <= p_limit),
    'nextOffset', case when v_total > p_limit and p_offset + p_limit <= 1000
      then p_offset + p_limit else null end
  );
end;
$$;

create or replace function public.public_get_professional(p_listing_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.listing_id, 'kind', p.kind, 'displayName', p.display_name,
    'categoryKey', p.category_key, 'modalityKeys', p.modality_keys,
    'specialties', p.specialties, 'bio', p.bio, 'city', p.city, 'uf', p.uf,
    'serviceMode', p.service_mode, 'publicContacts', p.public_contacts,
    'avatarPath', p.avatar_path,
    'linkedCommunityId', p.linked_community_id,
    'linkedCommunity', case when p.linked_community_id is null then null
      else jsonb_build_object('id', p.linked_community_id, 'name', p.linked_community_name) end
  )
  from public.published_professional_listings p
  join public.professional_listings l on l.id = p.listing_id
  join public.users u on u.id = l.owner_id
  where p.listing_id = p_listing_id
    and l.lifecycle_state = 'published' and u.account_status = 'active'
    and not exists (select 1 from public.account_restrictions r
      where r.user_id = u.id and not (r.action = 'temporary_suspension' and r.until <= now()))
$$;

-- O bucket continua privado. A leitura de um objeto exige referência ativa a
-- um perfil publicado; despublicar, suspender ou desabilitar revoga a leitura.
create or replace function public.public_professional_avatar_visible(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.published_professional_listings p
    join public.professional_listings l on l.id = p.listing_id
    join public.users u on u.id = l.owner_id
    where p.avatar_path = p_path and l.lifecycle_state = 'published'
      and u.account_status = 'active'
      and not exists (select 1 from public.account_restrictions r
        where r.user_id = u.id and not (r.action = 'temporary_suspension' and r.until <= now()))
  )
$$;
drop policy if exists profile_avatars_published_read on storage.objects;
create policy profile_avatars_published_read on storage.objects for select
  using (bucket_id = 'profile-avatars' and public.public_professional_avatar_visible(name));

revoke all on function public.public_list_professionals(text,text,text,text,text,integer,integer) from public;
revoke all on function public.public_get_professional(uuid) from public;
revoke all on function public.public_professional_avatar_visible(text) from public;
grant execute on function public.public_list_professionals(text,text,text,text,text,integer,integer) to anon, authenticated;
grant execute on function public.public_get_professional(uuid) to anon, authenticated;
grant execute on function public.public_professional_avatar_visible(text) to anon, authenticated;
