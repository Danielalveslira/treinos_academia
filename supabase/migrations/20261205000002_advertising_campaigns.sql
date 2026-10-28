-- Phase 6 editorial adapter. All existing legacy rows remain unchanged.
set local lock_timeout='5s';
alter table public.advertiser_accounts add column owner_user_id uuid references public.users(id);
-- Historical created_by means attribution, not automatically a commercial owner.
alter table public.advertiser_members drop constraint advertiser_members_permission_check;
alter table public.advertiser_members add constraint advertiser_members_permission_check check(permission in('viewer','manager','owner'));
alter table public.sponsored_ads add column commercial_resource_id uuid unique references private.commercial_resources(id);
alter table public.sponsored_ads add constraint sponsored_ad_resource_identity check(commercial_resource_id is null or commercial_resource_id=id);
create table private.advertising_drafts (
 ad_id uuid primary key references public.sponsored_ads(id),
 account_id uuid not null references public.advertiser_accounts(id),
 version bigint not null default 1,
 state text not null default 'draft' check(state in('draft','submitted','approved','rejected','archived')),
 title text not null check(length(btrim(title)) between 1 and 100),
 description text not null default '' check(length(description)<=500),
 destination text not null check(length(destination)<=300 and destination ~ '^https://[a-zA-Z0-9][a-zA-Z0-9.-]+(:[0-9]+)?(/[^[:space:]\\]*)?$' and destination !~ '@'),
 creation_request jsonb not null,
 review_reason text,
 approved_version bigint,
 unique(ad_id,account_id)
);
alter table private.advertising_drafts enable row level security;
revoke all on private.advertising_drafts from public,anon,authenticated,service_role;

create function private.require_advertising_editor(p_account uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_advertiser(p_account);
 if not exists(select 1 from public.advertiser_accounts a where a.id=p_account and
 (a.owner_user_id=auth.uid() or exists(select 1 from public.advertiser_members m where m.account_id=a.id and m.user_id=auth.uid() and m.revoked_at is null and m.permission in('manager','owner')))) then
 raise exception 'AD_EDITOR_REQUIRED' using errcode='42501'; end if;
end $$;
create function public.create_advertising_account(p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare a uuid;
begin
 perform private.require_commercial_user();
 perform 1 from public.users u where u.id=auth.uid() for no key update;
 if length(btrim(p_name)) not between 1 and 120 or p_name is null then raise exception 'INVALID_AD_ACCOUNT'; end if;
 if (select count(*) from public.advertiser_accounts where owner_user_id=auth.uid())>=1 then raise exception 'AD_ACCOUNT_EXISTS'; end if;
 insert into public.advertiser_accounts(name,created_by,owner_user_id) values(btrim(p_name),auth.uid(),auth.uid()) returning id into a;
 insert into public.advertiser_members(account_id,user_id,permission,granted_by) values(a,auth.uid(),'owner',auth.uid());
 insert into public.advertiser_audit(actor_id,account_id,action) values(auth.uid(),a,'self_create');
 return a;
end $$;
-- Explicit scopes for network campaigns: the configured bundle is frozen at creation.
-- No automatic inclusion from a future placement catalog entry.
create table private.advertising_network_bundle (
 placement_code text primary key references public.advertising_placements(code)
);
alter table private.advertising_network_bundle enable row level security;
revoke all on private.advertising_network_bundle from public,anon,authenticated,service_role;

-- Managed rows use interval reservations, never the old static cap trigger.
create or replace function public.enforce_sponsored_ad_caps() returns trigger
language plpgsql set search_path='' as $$
declare c uuid;
begin
 if new.commercial_resource_id is not null then return new; end if;
 -- Do not let the legacy admin UI expand uncontracted inventory once the adapter
 -- is installed. Existing legacy content remains readable and manageable.
 if tg_op='INSERT' then
  if current_user in('supabase_admin','postgres') then return new; end if;
  raise exception 'USE_ADVERTISING_CAMPAIGN_FLOW';
 end if;
 if (new.is_global,new.community_ids,new.display_mode,new.expires_at) is distinct from (old.is_global,old.community_ids,old.display_mode,old.expires_at) then raise exception 'LEGACY_AD_SCOPE_FROZEN'; end if;
 return new;
end $$;
create function public.create_advertising_campaign(p_account uuid,p_placement text,p_community uuid,p_title text,p_description text,p_destination text,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare a public.advertiser_accounts; id uuid; offering text; scope text[]; existing private.advertising_drafts;
begin
 perform private.require_advertising_editor(p_account);
 perform 1 from public.users u where u.id=auth.uid() for no key update;
 select * into a from public.advertiser_accounts ac where ac.id=p_account for share;
 perform private.require_advertising_editor(p_account);
 if a.owner_user_id is null then raise exception 'AD_ACCOUNT_OWNER_REQUIRED'; end if;
 if p_request_id is null then raise exception 'AD_REQUEST_REQUIRED'; end if;
 -- The resource UUID is the stable creation intent. Replays cannot change payload.
 select * into existing from private.advertising_drafts where ad_id=p_request_id;
 if found then
 if existing.account_id<>p_account or existing.creation_request is distinct from jsonb_build_object('placement',p_placement,'community',p_community,'title',p_title,'description',p_description,'destination',p_destination) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 return existing.ad_id;
 end if;
 if p_placement='network' then
 select array_agg(placement_code order by placement_code) into scope from private.advertising_network_bundle;
 if coalesce(cardinality(scope),0)=0 then raise exception 'AD_NETWORK_UNCONFIGURED'; end if;
 offering:='ad_network';
 else
 select array[code],offering_code into scope,offering from public.advertising_placements where code=p_placement;
 if not found then raise exception 'AD_PLACEMENT_NOT_FOUND'; end if;
 end if;
 if exists(select 1 from public.advertising_placements where code=any(scope) and surface='community') then
 if p_community is null or not exists(select 1 from public.communities c where c.id=p_community and owner_id=a.owner_user_id and is_active) then raise exception 'AD_COMMUNITY_NOT_AUTHORIZED'; end if;
 elsif p_community is not null then raise exception 'AD_CONTEXT_INVALID'; end if;
 if (select count(*) from private.advertising_drafts d where d.account_id=p_account)>=100 then raise exception 'AD_DRAFT_LIMIT'; end if;
 id:=p_request_id;
 insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision) values(id,offering,a.owner_user_id,1);
 insert into public.sponsored_ads(id,partner_name,title,description,cta_label,cta_type,cta_target,community_ids,is_global,display_mode,created_by,commercial_resource_id)
 values(id,left(a.name,60),'Em preparação','','Saiba mais','external',p_destination,
 case when p_community is null then '{}'::uuid[] else array[p_community] end,'home_banner'=any(scope),
 array(select distinct content_type from public.advertising_placements where code=any(scope)),a.owner_user_id,id);
 insert into private.advertising_drafts(ad_id,account_id,title,description,destination,creation_request) values(id,p_account,p_title,p_description,p_destination,jsonb_build_object('placement',p_placement,'community',p_community,'title',p_title,'description',p_description,'destination',p_destination));
 insert into public.advertiser_campaigns(ad_id,account_id,title,partner_name,linked_by) values(id,p_account,p_title,left(a.name,60),auth.uid());
 insert into private.advertising_resource_inventory(resource_id,placement_code,context_id)
 select id,p.code,case when p.surface='home' then '00000000-0000-0000-0000-000000000000'::uuid else p_community end from public.advertising_placements p where code=any(scope);
 insert into public.advertising_operations(actor_user_id,resource_id,action,reason) values(auth.uid(),id,'create','Campanha criada sem cobrança');
 return id;
end $$;

create function public.edit_advertising_campaign(p_id uuid,p_version bigint,p_title text,p_description text,p_destination text,p_submit boolean) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare d private.advertising_drafts;
begin
 select * into d from private.advertising_drafts where ad_id=p_id;
 perform private.require_advertising_editor(d.account_id);
 -- Same lock as quote, fulfil, review, suspension and publication of approved projection.
 perform 1 from private.commercial_resources where id=p_id for update;
 select * into d from private.advertising_drafts where ad_id=p_id for update;
 perform private.require_advertising_editor(d.account_id);
 if d.version is distinct from p_version then raise exception 'AD_REVISION_CONFLICT'; end if;
 update private.advertising_drafts set title=p_title,description=p_description,destination=p_destination,version=version+1,state=case when p_submit then 'submitted' else 'draft' end,review_reason=null where ad_id=p_id returning * into d;
 -- Approved projection/anchor stays untouched during pending revisions.
 insert into public.advertising_operations(actor_user_id,resource_id,action,reason,payload) values(auth.uid(),p_id,case when p_submit then 'submit' else 'edit' end,'Revisão privada do material',jsonb_build_object('version',d.version));
 return to_jsonb(d);
end $$;
create function public.admin_review_advertising_campaign(p_id uuid,p_version bigint,p_approve boolean,p_reason text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare d private.advertising_drafts; r private.commercial_resources;
begin
 perform private.require_evocash_admin(true);
 if p_reason is null or length(btrim(p_reason)) not between 5 and 500 or p_approve is null then raise exception 'AD_REVIEW_REASON_REQUIRED'; end if;
 select * into r from private.commercial_resources where id=p_id for update;
 select * into d from private.advertising_drafts where ad_id=p_id for update;
 if not found then raise exception 'AD_NOT_FOUND'; end if;
 perform private.require_evocash_admin(true);
 if d.version is distinct from p_version or d.state<>'submitted' then raise exception 'AD_REVISION_CONFLICT'; end if;
 update private.advertising_drafts set state=case when p_approve then 'approved' else 'rejected' end,approved_version=case when p_approve then version else approved_version end,review_reason=btrim(p_reason) where ad_id=p_id returning * into d;
 if p_approve then
 update public.sponsored_ads set title=d.title,description=d.description,cta_target=d.destination where id=p_id;
 update private.commercial_resources set content_revision=d.version,approved_revision=d.version,
 moderation_state=case when moderation_state in('suspended','archived') then moderation_state else 'approved' end where id=p_id;
 update public.advertiser_campaigns set title=d.title where ad_id=p_id;
 end if;
 insert into public.advertising_operations(actor_user_id,resource_id,action,reason,payload) values(auth.uid(),p_id,case when p_approve then 'approve' else 'reject' end,btrim(p_reason),jsonb_build_object('version',d.version));
 return to_jsonb(d);
end $$;
create function public.interrupt_advertising_campaign(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare d private.advertising_drafts;
begin
 select * into d from private.advertising_drafts where ad_id=p_id;
 if coalesce(public.is_superadmin(),false) then perform private.require_evocash_admin(true);
 else perform private.require_advertising_editor(d.account_id); end if;
 if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'AD_REVIEW_REASON_REQUIRED'; end if;
 perform 1 from private.commercial_resources where id=p_id for update;
 update private.commercial_resources set moderation_state='suspended' where id=p_id;
 insert into public.advertising_operations(actor_user_id,resource_id,action,reason) values(auth.uid(),p_id,'suspend',btrim(p_reason));
 -- No automatic credit or free time. Reservation and financial history remain intact.
end $$;

create function private.advertising_eligible(p_id uuid,p_placement text,p_context uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.sponsored_ads a join private.advertising_drafts d on d.ad_id=a.id
 join public.advertiser_accounts ac on ac.id=d.account_id
 join private.advertising_resource_inventory i on i.resource_id=a.id and i.placement_code=p_placement and i.context_id=coalesce(p_context,'00000000-0000-0000-0000-000000000000'::uuid)
 join public.advertising_placements p on p.code=i.placement_code
 where a.id=p_id and ac.active and p.delivery_enabled and private.commercial_resource_visible(a.id)
 and exists(select 1 from private.advertising_reservations res join public.commercial_orders o on o.id=res.order_id
 where o.resource_id=a.id and o.status='fulfilled' and res.placement_code=i.placement_code and res.context_id=i.context_id
 and res.starts_at<=statement_timestamp() and res.expires_at>statement_timestamp())
 and (p.surface='home' or exists(select 1 from public.communities c where c.id=p_context and c.owner_id=ac.owner_user_id and c.is_active)))
$$;
-- Managed rows cannot be edited/deleted through the legacy administrative CRUD.
-- Definer RPCs remain the only writable path for approved projection.
drop policy sponsored_ads_insert on public.sponsored_ads;
create policy sponsored_ads_insert on public.sponsored_ads for insert with check(public.is_superadmin() and created_by=auth.uid() and commercial_resource_id is null);
drop policy sponsored_ads_update on public.sponsored_ads;
create policy sponsored_ads_update on public.sponsored_ads for update using(public.is_superadmin() and commercial_resource_id is null) with check(public.is_superadmin() and commercial_resource_id is null);
drop policy sponsored_ads_delete on public.sponsored_ads;
create policy sponsored_ads_delete on public.sponsored_ads for delete using(public.is_superadmin() and commercial_resource_id is null);
drop policy sponsored_ads_select on public.sponsored_ads;
create policy sponsored_ads_select on public.sponsored_ads for select using(
 public.is_superadmin() or
 (commercial_resource_id is null and (expires_at is null or expires_at>statement_timestamp()) and
 ((is_global and auth.uid() is not null) or exists(select 1 from public.community_members cm where cm.user_id=auth.uid() and cm.community_id=any(community_ids))))
 or (commercial_resource_id is not null and coalesce(public.has_app_access(),false) and
 (private.advertising_eligible(id,'home_banner',null) or exists(select 1 from unnest(community_ids) c where public.is_community_member(c) and (private.advertising_eligible(id,'community_banner',c) or private.advertising_eligible(id,'community_feed',c))))));

create function public.get_advertising_campaigns(p_account uuid default null,p_after uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if p_account is null then perform private.require_evocash_admin(); else perform private.require_advertising_editor(p_account); end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.ad_id desc) from (
 select d.*,a.name as partner_name,r.offering_code,r.moderation_state,e.starts_at,e.expires_at,
 (a.owner_user_id=auth.uid()) as can_pay,
 (select jsonb_agg(jsonb_build_object('code',i.placement_code,'context',i.context_id)) from private.advertising_resource_inventory i where i.resource_id=d.ad_id) as placements,
 (select jsonb_build_object('salesEnabled',f.sales_enabled and f.integration_ready,'price',v.unit_price_cash::text,'minDays',v.min_days,'maxDays',v.max_days)
 from public.commercial_offerings f left join lateral(select * from public.commercial_price_versions where offering_code=f.code and active_from<=statement_timestamp() order by active_from desc limit 1)v on true where f.code=r.offering_code) as tariff
 from private.advertising_drafts d join private.commercial_resources r on r.id=d.ad_id
 join public.advertiser_accounts a on a.id=d.account_id
 left join public.visibility_entitlements e on e.resource_id=d.ad_id
 where (p_account is null or d.account_id=p_account) and (p_after is null or d.ad_id<p_after)
 order by d.ad_id desc limit 20)x),'[]'::jsonb);
end $$;
-- A bounded read at the actual surface; all eligibility checks stay server-side.
create function public.select_advertising(p_placement text,p_context uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.advertising_placements;
begin
 perform private.require_commercial_user();
 select * into p from public.advertising_placements where code=p_placement;
 if not found or not p.delivery_enabled then return '[]'; end if;
 if p.surface='community' and not coalesce(public.is_community_member(p_context),false) then return '[]'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (
 select a.id,a.partner_name,a.title,a.description,a.cta_label,a.cta_type,a.cta_target,e.expires_at,a.is_global,a.display_mode
 from public.sponsored_ads a join public.visibility_entitlements e on e.resource_id=a.id
 where private.advertising_eligible(a.id,p_placement,p_context)
 order by random() limit p.display_limit)x),'[]'::jsonb);
end $$;
-- Enable adapter capability only. Sales still require separately published prices
-- and both offering and placement sales gates (all false by default).
update public.commercial_offerings set integration_ready=true where code in('ad_home','ad_community','ad_network');
revoke all on function private.require_advertising_editor(uuid),private.advertising_eligible(uuid,text,uuid) from public,anon,authenticated,service_role;
-- RLS invokes this boolean helper only for the current row; no content is returned.
grant execute on function private.advertising_eligible(uuid,text,uuid) to authenticated;
revoke all on function public.create_advertising_account(text),public.create_advertising_campaign(uuid,text,uuid,text,text,text,uuid),public.edit_advertising_campaign(uuid,bigint,text,text,text,boolean),public.admin_review_advertising_campaign(uuid,bigint,boolean,text),public.interrupt_advertising_campaign(uuid,text),public.get_advertising_campaigns(uuid,uuid),public.select_advertising(text,uuid) from public,anon,service_role;
grant execute on function public.create_advertising_account(text),public.create_advertising_campaign(uuid,text,uuid,text,text,text,uuid),public.edit_advertising_campaign(uuid,bigint,text,text,text,boolean),public.admin_review_advertising_campaign(uuid,bigint,boolean,text),public.interrupt_advertising_campaign(uuid,text),public.get_advertising_campaigns(uuid,uuid),public.select_advertising(text,uuid) to authenticated;
