-- Catálogo público: paginação por marca e por resultado, sempre sob RLS e
-- com a janela de publicação verificada novamente na própria consulta.
create or replace function public.public_product_catalog(
  p_mode text default 'groups',
  p_search text default '',
  p_category text default '',
  p_brand text default '',
  p_offset integer default 0,
  p_limit integer default 20
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 100000));
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 30));
  v_search text := lower(left(btrim(coalesce(p_search, '')), 80));
  v_category text := left(btrim(coalesce(p_category, '')), 80);
  v_brand text := lower(left(btrim(coalesce(p_brand, '')), 120));
  v_result jsonb;
begin
  if p_mode = 'categories' then
    select coalesce(jsonb_agg(category order by category), '[]'::jsonb)
      into v_result
      from (
        select distinct category from public.partner_products
        where approved and (starts_at is null or starts_at <= now())
          and (ends_at is null or ends_at > now())
      ) categories;
    return v_result;
  elsif p_mode = 'groups' then
    with published as materialized (
      select id, name, brand, left(description, 180) as description,
        category, image_url, store_url, sponsored, created_at,
        lower(btrim(regexp_replace(brand, '\s+', ' ', 'g'))) as brand_key
      from public.partner_products
      where approved and (starts_at is null or starts_at <= now())
        and (ends_at is null or ends_at > now())
    ), brands as (
      select brand_key, min(brand) as brand, count(*) as product_count
      from published group by brand_key
    ), page as (
      select * from brands order by brand_key limit v_limit offset v_offset
    )
    select jsonb_build_object(
      'totalProducts', coalesce((select sum(product_count) from brands), 0),
      'totalBrands', (select count(*) from brands),
      'groups', coalesce(jsonb_agg(jsonb_build_object(
        'key', page.brand_key, 'brand', page.brand,
        'count', page.product_count, 'items', previews.items
      ) order by page.brand_key), '[]'::jsonb)
    ) into v_result
    from page
    cross join lateral (
      select coalesce(jsonb_agg(to_jsonb(item) - 'created_at' order by item.created_at desc, item.id desc), '[]'::jsonb) as items
      from (
        select id, name, brand, description, category, image_url, store_url, sponsored, created_at
        from published where brand_key = page.brand_key
        order by created_at desc, id desc limit 5
      ) item
    ) previews;
    return v_result;
  elsif p_mode = 'items' then
    with filtered as materialized (
      select id, name, brand, left(description, 180) as description,
        category, image_url, store_url, sponsored, created_at,
        lower(btrim(regexp_replace(brand, '\s+', ' ', 'g'))) as brand_key
      from public.partner_products
      where approved and (starts_at is null or starts_at <= now())
        and (ends_at is null or ends_at > now())
        and (v_category = '' or category = v_category)
        and (v_brand = '' or lower(btrim(regexp_replace(brand, '\s+', ' ', 'g'))) = v_brand)
        and (v_search = '' or position(v_search in lower(name)) > 0
          or position(v_search in lower(brand)) > 0
          or position(v_search in lower(category)) > 0)
    ), page as (
      select id, name, brand, description, category, image_url, store_url, sponsored, created_at
      from filtered order by created_at desc, id desc limit v_limit offset v_offset
    )
    select jsonb_build_object(
      'totalProducts', (select count(*) from filtered),
      'totalBrands', (select count(distinct brand_key) from filtered),
      'items', coalesce(jsonb_agg(to_jsonb(page) - 'created_at' order by page.created_at desc, page.id desc), '[]'::jsonb)
    ) into v_result from page;
    return v_result;
  end if;
  raise exception 'invalid catalog mode' using errcode = '22023';
end $$;

revoke all on function public.public_product_catalog(text,text,text,text,integer,integer) from public;
grant execute on function public.public_product_catalog(text,text,text,text,integer,integer) to anon, authenticated;

-- A janela é dinâmica; estes índices apoiam a leitura sem armazenar um estado
-- de publicação que poderia ficar obsoleto ao passar starts_at/ends_at.
create index partner_products_public_recent_idx
  on public.partner_products (created_at desc, id desc) where approved;
create index partner_products_public_category_recent_idx
  on public.partner_products (category, created_at desc, id desc) where approved;
