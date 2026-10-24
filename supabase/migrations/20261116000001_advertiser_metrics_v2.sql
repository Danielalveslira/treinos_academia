-- V2: attribution is explicit and immutable. No FK from historical campaign to live ad.
-- No changes to collection, retention, privacy or existing administrative RPC.
set local lock_timeout = '5s';
create table public.advertiser_accounts (
 id uuid primary key default gen_random_uuid(),
 name text not null check(char_length(trim(name)) between 1 and 120),
 active boolean not null default true,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.advertiser_members (
 account_id uuid not null references public.advertiser_accounts(id),
 user_id uuid not null references public.users(id) on delete cascade,
 permission text not null default 'viewer' check(permission='viewer'),
 granted_by uuid references public.users(id) on delete set null,
 granted_at timestamptz not null default now(), revoked_at timestamptz,
 primary key(account_id,user_id)
);
create index advertiser_members_user_idx on public.advertiser_members(user_id,account_id) where revoked_at is null;
create table public.advertiser_campaigns (
 ad_id uuid primary key,
 account_id uuid not null references public.advertiser_accounts(id),
 title text, partner_name text, expires_at timestamptz,
 linked_by uuid references public.users(id) on delete set null,
 linked_at timestamptz not null default now()
);
create index advertiser_campaigns_account_idx on public.advertiser_campaigns(account_id,ad_id);
create index sponsored_ad_daily_stats_ad_day_idx on public.sponsored_ad_daily_stats(ad_id,day);
create table public.advertiser_audit (
 id bigint generated always as identity primary key,
 actor_id uuid references public.users(id) on delete set null,
 account_id uuid not null references public.advertiser_accounts(id),
 action text not null, subject_id uuid, occurred_at timestamptz not null default now()
);
alter table public.advertiser_accounts enable row level security;
alter table public.advertiser_members enable row level security;
alter table public.advertiser_campaigns enable row level security;
alter table public.advertiser_audit enable row level security;
revoke all on public.advertiser_accounts, public.advertiser_members, public.advertiser_campaigns, public.advertiser_audit from public, anon, authenticated;

create function private.advertiser_immutable_owner() returns trigger language plpgsql set search_path='' as $$
begin
 if new.account_id is distinct from old.account_id or new.ad_id is distinct from old.ad_id then
  raise exception 'CAMPAIGN_OWNER_IMMUTABLE';
 end if;
 return new;
end $$;
create trigger advertiser_immutable_owner before update on public.advertiser_campaigns for each row execute function private.advertiser_immutable_owner();
revoke all on function private.advertiser_immutable_owner() from public, anon, authenticated;

create function private.require_advertiser(p_account_id uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(public.has_app_access(),false) then
  raise exception 'PERMISSION_DENIED' using errcode='42501';
 end if;
 if not exists(select 1 from public.advertiser_accounts a where a.id=p_account_id and a.active
    and (coalesce(public.is_superadmin(),false) or exists(select 1 from public.advertiser_members m
      where m.account_id=a.id and m.user_id=auth.uid() and m.revoked_at is null))) then
  raise exception 'PERMISSION_DENIED' using errcode='42501';
 end if;
end $$;
revoke all on function private.require_advertiser(uuid) from public, anon, authenticated;

create function private.advertiser_snapshot(
  p_account_id uuid,
  p_campaign_offset integer,
  p_context_offset integer,
  p_days integer default 30,
  p_from date default null,
  p_to date default null,
  p_ad_id uuid default null,
  p_community_id uuid default null,
  p_placement text default null
) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  c_max_days constant integer := 366;
  c_campaign_limit constant integer := 100;
  c_context_limit constant integer := 100;
  v_today date := private.ad_metrics_day(now());
  v_from date;
  v_to date;
  v_result jsonb;
begin
  if p_campaign_offset is null or p_campaign_offset < 0 or p_campaign_offset > 100000
     or p_context_offset is null or p_context_offset < 0 or p_context_offset > 100000 then
    raise exception 'INVALID_FILTER';
  end if;

  if p_placement is not null and p_placement not in ('home_banner', 'community_banner', 'community_feed') then
    raise exception 'INVALID_FILTER';
  end if;

  if p_from is null and p_to is null then
    -- janela móvel terminando HOJE (dia do servidor em America/Sao_Paulo)
    if p_days is null or p_days < 1 or p_days > c_max_days then raise exception 'INVALID_RANGE'; end if;
    v_to := v_today;
    v_from := v_today - (p_days - 1);
  else
    -- intervalo personalizado: os dois extremos, ordem correta, no máximo 366 dias, sem futuro
    if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > c_max_days
       or p_to > v_today or p_from < date '2020-01-01' then
      raise exception 'INVALID_RANGE';
    end if;
    v_from := p_from;
    v_to := p_to;
  end if;

  -- UMA passagem pelo intervalo (índice da PK por dia): GROUPING SETS calcula resumo, série diária, posições,
  -- campanhas e comunidade/posição de uma vez. (Uma CTE materializada lida 5 vezes estourava work_mem e gravava
  -- temporário em 366 dias. Um array_agg ordenado para o nome histórico também custava ~370 ms: o nome da campanha
  -- excluída é buscado só para as linhas devolvidas, mais abaixo.) grouping(day, ad_id, placement,
  -- context_id): 15 = total, 7 = por dia, 13 = por posição, 11 = por campanha, 12 = por posição e contexto.
  with base as (
    select s.day, s.ad_id, s.placement, s.context_id, s.partner_name,
           s.visible_impressions, s.unique_viewers, s.clicks, s.unqualified_clicks
      from public.sponsored_ad_daily_stats s
     where s.day between v_from and v_to
       and (p_account_id is null or exists (select 1 from public.advertiser_campaigns ac
            where ac.ad_id = s.ad_id and ac.account_id = p_account_id))
       and (p_ad_id is null or s.ad_id = p_ad_id)
       and (p_community_id is null or s.context_id = p_community_id)
       and (p_placement is null or s.placement = p_placement)
  ),
  agg as (
    select grouping(day, ad_id, placement, context_id) as g, day, ad_id, placement, context_id,
           coalesce(sum(visible_impressions), 0)::bigint as imp, coalesce(sum(unique_viewers), 0)::bigint as uniq,
           coalesce(sum(clicks), 0)::bigint as clk, coalesce(sum(unqualified_clicks), 0)::bigint as unq,
           count(*) as row_count
      from base
     group by grouping sets ((), (day), (placement), (ad_id), (placement, context_id))
  ),
  summary as (select * from agg where g = 15),
  daily as (select * from agg where g = 7),
  per_placement as (select * from agg where g = 13),
  campaign_rows as (
    select c.*, coalesce(a.title, ac.title) as title, coalesce(a.partner_name, ac.partner_name) as current_name, coalesce(a.expires_at, ac.expires_at) as expires_at, a.image_url, a.created_at as starts_at, (a.id is null) as deleted,
           row_number() over (order by c.imp desc, c.clk desc, c.ad_id) as rn
      from agg c left join public.sponsored_ads a on a.id = c.ad_id left join public.advertiser_campaigns ac on ac.ad_id=c.ad_id
     where c.g = 11
  ),
  context_rows as (
    select x.*, cm.name as community_name,
           row_number() over (order by x.imp desc, x.clk desc, x.placement, x.context_id) as rn
      from agg x left join public.communities cm on cm.id = x.context_id
     where x.g = 12
  )
  select jsonb_build_object(
    'generated_at', statement_timestamp(),
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'days', v_to - v_from + 1, 'today', v_today,
                                 'timezone', 'America/Sao_Paulo'),
    'filters', jsonb_build_object('ad_id', p_ad_id, 'community_id', p_community_id, 'placement', p_placement),
    'collection', jsonb_build_object(
      'server_enabled', coalesce((select st.collection_enabled from public.sponsored_ad_metrics_settings st where st.id), false),
      'has_any_data', exists (select 1 from public.sponsored_ad_daily_stats h where (p_ad_id is null or h.ad_id=p_ad_id) and (p_account_id is null or exists(select 1 from public.advertiser_campaigns ac where ac.ad_id=h.ad_id and ac.account_id=p_account_id))),
      'last_day', (select max(s2.day) from public.sponsored_ad_daily_stats s2 where (p_ad_id is null or s2.ad_id=p_ad_id) and (p_account_id is null or exists(select 1 from public.advertiser_campaigns ac where ac.ad_id=s2.ad_id and ac.account_id=p_account_id)))
    ),
    'has_data', (select sm.row_count > 0 from summary sm),
    'summary', (select private.ad_metrics_object(case when sm.row_count > 0 then sm.imp end, case when sm.row_count > 0 then sm.uniq end, case when sm.row_count > 0 then sm.clk end, case when sm.row_count > 0 then sm.unq end) from summary sm),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d.day) || private.ad_metrics_object(d.imp, d.uniq, d.clk, d.unq)
                                          order by d.day) from daily d), '[]'::jsonb),
    'by_placement', coalesce((select jsonb_agg(jsonb_build_object('placement', p.placement) || private.ad_metrics_object(p.imp, p.uniq, p.clk, p.unq)
                                                 order by array_position(array['home_banner', 'community_banner', 'community_feed'], p.placement))
                                from per_placement p), '[]'::jsonb),
    'by_campaign', coalesce((select jsonb_agg(jsonb_build_object(
                                 'ad_id', r.ad_id,
                                 -- campanha excluída: retrato mais recente do nome guardado no agregado (só p/ linhas devolvidas)
                                 'partner_name', coalesce(r.current_name, (
                                   select h.partner_name from public.sponsored_ad_daily_stats h
                                    where h.ad_id = r.ad_id and h.day between v_from and v_to
                                    order by h.day desc limit 1)),
                                 'image_url', r.image_url, 'starts_at', r.starts_at, 'title', r.title, 'deleted', r.deleted, 'expires_at', r.expires_at)
                               || private.ad_metrics_object(r.imp, r.uniq, r.clk, r.unq) order by r.rn)
                               from campaign_rows r where r.rn > p_campaign_offset and r.rn <= p_campaign_offset + c_campaign_limit), '[]'::jsonb),
    'campaigns_total', (select count(*) from campaign_rows),
    'campaigns_truncated', (select count(*) > p_campaign_offset + c_campaign_limit from campaign_rows),
    'by_context', coalesce((select jsonb_agg(jsonb_build_object(
                                'placement', r.placement, 'context_id', r.context_id,
                                'community_name', case when r.placement = 'home_banner' then null else r.community_name end)
                              || private.ad_metrics_object(r.imp, r.uniq, r.clk, r.unq) order by r.rn)
                              from context_rows r where r.rn > p_context_offset and r.rn <= p_context_offset + c_context_limit), '[]'::jsonb),
    'contexts_total', (select count(*) from context_rows),
    'contexts_truncated', (select count(*) > p_context_offset + c_context_limit from context_rows)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function private.advertiser_snapshot(uuid,integer,integer,integer,date,date,uuid,uuid,text) from public, anon, authenticated;

create function public.get_advertiser_metrics(
 p_account_id uuid, p_days integer default 30, p_from date default null, p_to date default null,
 p_ad_id uuid default null, p_community_id uuid default null, p_placement text default null,
 p_campaign_offset integer default 0, p_context_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb; prev jsonb; d1 date; d2 date;
begin
 perform private.require_advertiser(p_account_id);
 if p_ad_id is not null and not exists(select 1 from public.advertiser_campaigns c where c.ad_id=p_ad_id and c.account_id=p_account_id) then
  raise exception 'PERMISSION_DENIED' using errcode='42501';
 end if;
 v := private.advertiser_snapshot(p_account_id,p_campaign_offset,p_context_offset,p_days,p_from,p_to,p_ad_id,p_community_id,p_placement);
 d1 := (v#>>'{period,from}')::date; d2 := (v#>>'{period,to}')::date;
 if d1-(d2-d1+1) >= date '2020-01-01' then
 prev := private.advertiser_snapshot(p_account_id,0,0,null,d1-(d2-d1+1),d1-1,p_ad_id,p_community_id,p_placement);
 end if;
 return v || jsonb_build_object('account',(select jsonb_build_object('id',a.id,'name',a.name) from public.advertiser_accounts a where a.id=p_account_id),
 'previous',jsonb_build_object('period',prev->'period','has_data',prev->'has_data','summary',prev->'summary'));
end $$;
revoke all on function public.get_advertiser_metrics(uuid,integer,date,date,uuid,uuid,text,integer,integer) from public,anon;
grant execute on function public.get_advertiser_metrics(uuid,integer,date,date,uuid,uuid,text,integer,integer) to authenticated;

-- Small paginated catalog: authenticated members only; admin can inspect inactive accounts.
create function public.list_advertiser_accounts(p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(public.has_app_access(),false) then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
 if p_offset is null or p_offset < 0 or p_offset > 100000 then raise exception 'INVALID_FILTER'; end if;
 return coalesce((select jsonb_agg(to_jsonb(r)) from (select a.id,a.name,a.active from public.advertiser_accounts a
 where coalesce(public.is_superadmin(),false) or (a.active and exists(select 1 from public.advertiser_members m where m.account_id=a.id and m.user_id=auth.uid() and m.revoked_at is null))
 order by a.name,a.id limit 100 offset p_offset) r),'[]'::jsonb);
end $$;
revoke all on function public.list_advertiser_accounts(integer) from public,anon;
grant execute on function public.list_advertiser_accounts(integer) to authenticated;

-- Unified admin mutations, serialized per account; every successful operation has an audit row.
create function public.admin_manage_advertiser(p_operation text,p_account_id uuid default null,p_name text default null,
 p_active boolean default true,p_subject_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid := p_account_id; v_ad public.sponsored_ads; v_owner uuid;
begin
 if auth.uid() is null or not coalesce(public.is_superadmin(),false) then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
 if p_operation='create' then
  insert into public.advertiser_accounts(name,created_by) values(trim(p_name),auth.uid()) returning id into v_id;
 else
  perform 1 from public.advertiser_accounts a where a.id=v_id for update;
  if not found then raise exception 'INVALID_FILTER'; end if;
  if p_operation='update' then
   update public.advertiser_accounts set name=trim(p_name),active=p_active,updated_at=now() where id=v_id;
  elsif p_operation='grant' then
   if not exists(select 1 from public.users u where u.id=p_subject_id and u.account_status='active') then raise exception 'INVALID_FILTER'; end if;
   insert into public.advertiser_members(account_id,user_id,granted_by) values(v_id,p_subject_id,auth.uid())
   on conflict(account_id,user_id) do update set revoked_at=null,granted_at=now(),granted_by=auth.uid();
  elsif p_operation='revoke' then
   update public.advertiser_members set revoked_at=now() where account_id=v_id and user_id=p_subject_id and revoked_at is null;
   if not found then raise exception 'INVALID_FILTER'; end if;
  elsif p_operation='link' then
   -- Race-safe: unique ad_id + no upsert. Transfer requires a NEW campaign ID.
   select account_id into v_owner from public.advertiser_campaigns where ad_id=p_subject_id;
   if found then raise exception 'CAMPAIGN_OWNER_IMMUTABLE'; end if;
   select * into v_ad from public.sponsored_ads where id=p_subject_id;
   if not found and not exists(select 1 from public.sponsored_ad_daily_stats where ad_id=p_subject_id) then raise exception 'INVALID_FILTER'; end if;
   insert into public.advertiser_campaigns(ad_id,account_id,title,partner_name,expires_at,linked_by)
   values(p_subject_id,v_id,v_ad.title,coalesce(v_ad.partner_name,(select partner_name from public.sponsored_ad_daily_stats where ad_id=p_subject_id order by day desc limit 1)),v_ad.expires_at,auth.uid());
  else raise exception 'INVALID_FILTER'; end if;
 end if;
 insert into public.advertiser_audit(actor_id,account_id,action,subject_id) values(auth.uid(),v_id,p_operation,p_subject_id);
 return v_id;
end $$;
revoke all on function public.admin_manage_advertiser(text,uuid,text,boolean,uuid) from public,anon;
grant execute on function public.admin_manage_advertiser(text,uuid,text,boolean,uuid) to authenticated;

-- No email enumeration: username search, superadmin only, bounded and explicit submit in UI.
create function public.admin_advertiser_directory(p_kind text,p_account_id uuid default null,p_search text default '',p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(public.is_superadmin(),false) then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 or p_offset>100000 or char_length(p_search)>120 then raise exception 'INVALID_FILTER'; end if;
 if p_kind='users' then
  if char_length(trim(p_search))<3 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(r)) from (select u.id,u.username from public.users u where u.account_status='active'
   and position(lower(trim(p_search)) in lower(u.username))>0 order by u.username,u.id limit 100 offset p_offset) r),'[]'::jsonb);
 elsif p_kind='members' then
  return coalesce((select jsonb_agg(to_jsonb(r)) from (select m.user_id as id,u.username,m.granted_at,m.revoked_at from public.advertiser_members m join public.users u on u.id=m.user_id where m.account_id=p_account_id order by m.user_id limit 100 offset p_offset) r),'[]'::jsonb);
 elsif p_kind='campaigns' then
  return coalesce((select jsonb_agg(to_jsonb(r)) from (
    select ids.ad_id as id,coalesce(a.title,c.title,h.partner_name) as title, coalesce(a.partner_name,c.partner_name,h.partner_name) as partner_name,
      c.account_id,(a.id is null) as deleted,a.image_url,a.expires_at
    from (select id as ad_id from public.sponsored_ads union select ad_id from public.sponsored_ad_daily_stats union select ad_id from public.advertiser_campaigns) ids
    left join public.sponsored_ads a on a.id=ids.ad_id left join public.advertiser_campaigns c on c.ad_id=ids.ad_id
    left join lateral(select s.partner_name from public.sponsored_ad_daily_stats s where s.ad_id=ids.ad_id order by s.day desc limit 1) h on true
    where (p_account_id is null and c.account_id is null) or c.account_id=p_account_id
    order by ids.ad_id limit 100 offset p_offset) r),'[]'::jsonb);
 end if;
 raise exception 'INVALID_FILTER';
end $$;
revoke all on function public.admin_advertiser_directory(text,uuid,text,integer) from public,anon;
grant execute on function public.admin_advertiser_directory(text,uuid,text,integer) to authenticated;

create function public.list_advertiser_campaigns(p_account_id uuid,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_advertiser(p_account_id);
 if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'INVALID_FILTER'; end if;
 return coalesce((select jsonb_agg(to_jsonb(r)) from (
 select c.ad_id as id,coalesce(a.title,c.title) as title,coalesce(a.partner_name,c.partner_name) as partner_name,
 a.image_url,coalesce(a.expires_at,c.expires_at) as expires_at,(a.id is null) as deleted
 from public.advertiser_campaigns c left join public.sponsored_ads a on a.id=c.ad_id
 where c.account_id=p_account_id order by c.ad_id limit 100 offset p_offset) r),'[]'::jsonb);
end $$;
revoke all on function public.list_advertiser_campaigns(uuid,integer) from public,anon;
grant execute on function public.list_advertiser_campaigns(uuid,integer) to authenticated;

create function public.get_admin_ad_metrics_v2(p_days integer default 30,p_from date default null,p_to date default null,
 p_ad_id uuid default null,p_community_id uuid default null,p_placement text default null,
 p_campaign_offset integer default 0,p_context_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v jsonb; prev jsonb; d1 date; d2 date;
begin
 if auth.uid() is null or not coalesce(public.is_superadmin(),false) then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
 v := private.advertiser_snapshot(null,p_campaign_offset,p_context_offset,p_days,p_from,p_to,p_ad_id,p_community_id,p_placement);
 d1 := (v#>>'{period,from}')::date; d2 := (v#>>'{period,to}')::date;
 if d1-(d2-d1+1) >= date '2020-01-01' then
 prev := private.advertiser_snapshot(null,0,0,null,d1-(d2-d1+1),d1-1,p_ad_id,p_community_id,p_placement);
 end if;
 return v || jsonb_build_object('previous',jsonb_build_object('period',prev->'period','has_data',prev->'has_data','summary',prev->'summary'));
end $$;
revoke all on function public.get_admin_ad_metrics_v2(integer,date,date,uuid,uuid,text,integer,integer) from public,anon;
grant execute on function public.get_admin_ad_metrics_v2(integer,date,date,uuid,uuid,text,integer,integer) to authenticated;
