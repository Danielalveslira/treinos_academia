-- Phase 6: adapt existing promotions to the ONE commercial engine.
set local lock_timeout='5s';
alter table public.advertising_placements drop constraint advertising_placements_surface_check;
alter table public.advertising_placements add constraint advertising_placements_surface_check check(surface in('home','community','community_discovery'));
alter table public.advertising_placements drop constraint advertising_placements_content_type_check;
alter table public.advertising_placements add constraint advertising_placements_content_type_check check(content_type in('banner','feed','post','community'));
insert into public.advertising_placements(code,name,description,surface,content_type,offering_code) values
 ('community_post_boost','Publicação em destaque','Destaque de publicação original elegível na comunidade.','community','post','post_boost'),
 ('community_discovery_boost','Comunidade em destaque','Destaque de comunidade na descoberta, sem alterar permissões.','community_discovery','community','community_boost');
create table public.community_advertising_permissions (
 community_id uuid primary key references public.communities(id) on delete cascade,
 post_boosts_enabled boolean not null default false,
 community_boosts_enabled boolean not null default false,
 revision bigint not null default 0
);
alter table public.community_advertising_permissions enable row level security;
revoke all on public.community_advertising_permissions from public,anon,authenticated,service_role;
create function public.configure_community_advertising(p_community uuid,p_posts boolean,p_community_boost boolean,p_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.communities; result public.community_advertising_permissions;
begin
 perform private.require_commercial_user();
 select * into c from public.communities where id=p_community and owner_id=auth.uid() and is_active for update;
 if not found then raise exception 'AD_COMMUNITY_NOT_AUTHORIZED'; end if;
 if p_posts is null or p_community_boost is null or p_revision is null then raise exception 'INVALID_AD_CONFIGURATION'; end if;
 insert into public.community_advertising_permissions(community_id) values(c.id) on conflict do nothing;
 select * into result from public.community_advertising_permissions where community_id=c.id for update;
 if result.revision<>p_revision then raise exception 'AD_CONFIGURATION_CONFLICT'; end if;
 update public.community_advertising_permissions set post_boosts_enabled=p_posts,community_boosts_enabled=p_community_boost,revision=revision+1 where community_id=c.id returning * into result;
 insert into public.advertising_operations(actor_user_id,action,reason,payload) values(auth.uid(),'community_permission','Permissão explícita do proprietário da comunidade',to_jsonb(result));
 return to_jsonb(result);
end $$;
alter table public.promotions add column commercial_resource_id uuid unique references private.commercial_resources(id);
alter table public.promotions add column billing_mode text not null default 'legacy_package' check(billing_mode in('legacy_package','commercial_daily'));
alter table public.promotions alter column package_id drop not null;
alter table public.promotions drop constraint promotions_cash_amount_check;
alter table public.promotions drop constraint promotions_duration_days_check;
alter table public.promotions drop constraint promotions_status_check;
alter table public.promotions add constraint promotions_status_check check(status in('draft','submitted','rejected','approved','active','cancelled','target_removed'));
alter table public.promotions add constraint promotions_billing_shape check(
 (billing_mode='legacy_package' and commercial_resource_id is null and package_id is not null and cash_amount>0 and duration_days>0)
 or(billing_mode='commercial_daily' and commercial_resource_id=id and package_id is null and cash_amount>=0 and duration_days>=0));
-- A prepared daily promotion has no payment yet; preserve whole units and the
-- historical package ceiling without fabricating a positive charge for drafts.
alter table public.promotions drop constraint promotions_whole_units;
alter table public.promotions add constraint promotions_whole_units check (
 cash_amount::text not in ('NaN','Infinity','-Infinity') and cash_amount=trunc(cash_amount)
 and ((billing_mode='legacy_package' and cash_amount between 1 and 1000000)
 or (billing_mode='commercial_daily' and cash_amount between 0 and 9223372036854775807))
) not valid;
create unique index commercial_promotion_target_idx on public.promotions(owner_id,target_type,target_id) where commercial_resource_id is not null;
create table private.promotion_editorial_snapshots (
 promotion_id uuid primary key references public.promotions(id),
 source_fingerprint text not null,
 review_reason text
);
alter table private.promotion_editorial_snapshots enable row level security;
revoke all on private.promotion_editorial_snapshots from public,anon,authenticated,service_role;
create function private.promotion_source_fingerprint(p_type text,p_id uuid) returns text
language sql stable security definer set search_path='' as $$
select case when p_type='post' then
 (select md5(jsonb_build_object('author',s.author_id,'community',s.community_id,'type',s.type,'text',s.text,'poll',s.poll_question,'options',s.poll_options,'photo',s.photo_path,'caption',s.photo_caption,'workout',s.workout_title,'workoutDate',s.workout_date,'location',s.workout_location,'achievement',s.achievement_text)::text) from public.statuses s where s.id=p_id)
 else (select md5(jsonb_build_object('owner',c.owner_id,'name',c.name,'description',to_jsonb(c)->'description')::text) from public.communities c where c.id=p_id) end
$$;
create function private.commercial_promotion_source_eligible(p public.promotions) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.communities c join public.community_advertising_permissions permissions on permissions.community_id=c.id
 where c.id=p.community_id and c.is_active
 and (case when p.target_type='post' then permissions.post_boosts_enabled else permissions.community_boosts_enabled and c.owner_id=p.owner_id end)
 and not exists(select 1 from public.deletion_jobs j where j.kind='community' and j.target_id=c.id and j.state<>'complete')
 and exists(select 1 from public.community_members m where m.community_id=c.id and m.user_id=p.owner_id)
 and not exists(select 1 from public.community_restrictions cr where cr.community_id=c.id and cr.user_id=p.owner_id)
 and (p.target_type='community' or exists(select 1 from public.statuses s where s.id=p.target_id and s.author_id=p.owner_id and s.community_id=c.id and (s.expires_at>statement_timestamp() or s.retention_mode='no_auto_expiration')))
 and exists(select 1 from private.promotion_editorial_snapshots ps where ps.promotion_id=p.id and ps.source_fingerprint=private.promotion_source_fingerprint(p.target_type,p.target_id)))
$$;
create function public.prepare_commercial_promotion(p_type text,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare target_community uuid; p public.promotions; resource uuid; fp text;
begin
 perform private.require_commercial_user();
 perform 1 from public.users where id=auth.uid() for no key update;
 if p_type not in('post','community') or p_type is null then raise exception 'INVALID_TARGET_TYPE'; end if;
 select * into p from public.promotions where owner_id=auth.uid() and target_type=p_type and target_id=p_id and commercial_resource_id is not null;
 if not found then
 if p_type='post' then select community_id into target_community from public.statuses where id=p_id and author_id=auth.uid() and (expires_at>statement_timestamp() or retention_mode='no_auto_expiration');
 else select id into target_community from public.communities where id=p_id and owner_id=auth.uid() and is_active; end if;
 if target_community is null or not coalesce(public.is_community_member(target_community),false) then raise exception 'AD_COMMUNITY_NOT_AUTHORIZED'; end if;
 if exists(select 1 from public.promotions where target_type=p_type and target_id=p_id and commercial_resource_id is null and status='active' and expires_at>statement_timestamp()) then raise exception 'LEGACY_PROMOTION_ACTIVE'; end if;
 resource:=gen_random_uuid();fp:=private.promotion_source_fingerprint(p_type,p_id);
 insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,moderation_state) values(resource,case p_type when 'post' then 'post_boost' else 'community_boost' end,auth.uid(),1,'submitted');
 insert into public.promotions(id,owner_id,request_id,target_type,target_id,community_id,package_id,cash_amount,duration_days,status,started_at,expires_at,commercial_resource_id,billing_mode)
 values(resource,auth.uid(),resource::text,p_type,p_id,target_community,null,0,0,'submitted',clock_timestamp(),clock_timestamp(),resource,'commercial_daily') returning * into p;
 insert into private.promotion_editorial_snapshots(promotion_id,source_fingerprint) values(resource,fp);
 insert into private.advertising_resource_inventory(resource_id,placement_code,context_id) values(resource,case p_type when 'post' then 'community_post_boost' else 'community_discovery_boost' end,case p_type when 'post' then target_community else '00000000-0000-0000-0000-000000000000'::uuid end);
 if not private.commercial_promotion_source_eligible(p) then raise exception 'AD_COMMUNITY_PERMISSION_REQUIRED'; end if;
 insert into public.advertising_operations(actor_user_id,resource_id,action,reason) values(auth.uid(),resource,'submit_promotion','Impulsionamento submetido sem cobrança');
 end if;
 return jsonb_build_object('resourceId',p.id,'state',(select moderation_state from private.commercial_resources where id=p.id),'expiresAt',case when p.duration_days>0 then p.expires_at else null end,
 'tariff',(select jsonb_build_object('salesEnabled',f.sales_enabled and f.integration_ready,'price',v.unit_price_cash::text,'minDays',v.min_days,'maxDays',v.max_days) from public.commercial_offerings f left join lateral(select * from public.commercial_price_versions where offering_code=f.code and active_from<=statement_timestamp() order by active_from desc limit 1)v on true where f.code=case p_type when 'post' then 'post_boost' else 'community_boost' end));
end $$;
create function public.admin_review_commercial_promotion(p_id uuid,p_approve boolean,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare p public.promotions;
begin
 perform private.require_evocash_admin(true);
 if p_approve is null or p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'AD_REVIEW_REASON_REQUIRED'; end if;
 perform 1 from private.commercial_resources where id=p_id for update;
 select * into p from public.promotions where id=p_id and commercial_resource_id is not null for update;
 if not found then raise exception 'PROMOTION_NOT_FOUND'; end if;
 if not private.commercial_promotion_source_eligible(p) then raise exception 'PROMOTION_SOURCE_CHANGED'; end if;
 update private.commercial_resources set approved_revision=case when p_approve then content_revision else approved_revision end,moderation_state=case when moderation_state in('suspended','archived') then moderation_state when p_approve then 'approved' else 'rejected' end where id=p_id;
 update public.promotions set status=case when duration_days>0 then status when p_approve then 'approved' else 'rejected' end where id=p_id;
 update private.promotion_editorial_snapshots set review_reason=btrim(p_reason) where promotion_id=p_id;
 insert into public.advertising_operations(actor_user_id,resource_id,action,reason) values(auth.uid(),p_id,case when p_approve then 'approve_promotion' else 'reject_promotion' end,btrim(p_reason));
end $$;
create function private.commercial_promotion_order_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.promotions;
begin
 select * into p from public.promotions where commercial_resource_id=new.resource_id;
 if not found then return new; end if;
 if tg_op='UPDATE' and (old.status<>'quoted' or new.status<>'fulfilled') then return new; end if;
 -- Resource lock precedes source locks, matching moderation/cancellation.
 perform 1 from public.communities where id=p.community_id for share;
 if p.target_type='post' then perform 1 from public.statuses where id=p.target_id for share; end if;
 if not private.commercial_promotion_source_eligible(p) then raise exception 'PROMOTION_SOURCE_CHANGED'; end if;
 if p.status in('cancelled','target_removed') then raise exception 'ENTITLEMENT_BLOCKED'; end if;
 return new;
end $$;
create trigger commercial_promotion_order_guard before insert or update on public.commercial_orders for each row execute function private.commercial_promotion_order_guard();
create function private.sync_commercial_promotion() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.promotions;
begin
 select * into p from public.promotions where commercial_resource_id=new.resource_id for update;
 if not found then return new; end if;
 update public.promotions set started_at=new.starts_at,expires_at=new.expires_at,status=case when status in('cancelled','target_removed') then status else 'active' end,
 cash_amount=(select coalesce(sum(total_cash),0) from public.commercial_orders where resource_id=new.resource_id and status='fulfilled'),
 duration_days=(select coalesce(sum(duration_days),0) from public.commercial_orders where resource_id=new.resource_id and status='fulfilled') where id=p.id;
 if p.target_type='post' then update public.statuses set promoted=true,promoted_until=new.expires_at,active_promotion_id=p.id where id=p.target_id;
 else update public.communities set promoted=true,promoted_until=new.expires_at,active_promotion_id=p.id where id=p.target_id; end if;
 return new;
end $$;
create trigger sync_commercial_promotion after insert or update on public.visibility_entitlements for each row execute function private.sync_commercial_promotion();
create or replace function private.status_promotion_until(p_status public.statuses) returns timestamptz
language sql stable security definer set search_path='' as $$
select max(p.expires_at) from public.promotions p where p.target_type='post' and p.target_id=p_status.id and p.owner_id=p_status.author_id and p.community_id=p_status.community_id
 and p.status='active' and p.cancelled_at is null and p.started_at<=statement_timestamp() and p.expires_at>statement_timestamp()
 and (p.commercial_resource_id is null or (private.commercial_resource_visible(p.id) and private.commercial_promotion_source_eligible(p)
 and exists(select 1 from public.advertising_placements ap where ap.code='community_post_boost' and ap.delivery_enabled)))
$$;
create function public.list_commercial_featured_communities() returns setof public.communities
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_commercial_user();
 return query select c.* from public.communities c where c.is_active and exists(select 1 from public.promotions p where p.target_type='community' and p.target_id=c.id and p.owner_id=c.owner_id and p.status='active' and p.started_at<=statement_timestamp() and p.expires_at>statement_timestamp()
 and (p.commercial_resource_id is null or (private.commercial_resource_visible(p.id) and private.commercial_promotion_source_eligible(p)
 and exists(select 1 from public.advertising_placements ap where ap.code='community_discovery_boost' and ap.delivery_enabled))))
 order by random() limit 6;
end $$;
-- Preserve historical retries, but new purchases must go through quote/confirm.
-- No second commercial debit path remains available to old clients.
create or replace function public.create_promotion(p_target_type text,p_target_id uuid,p_package_id text,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.promotions;
begin
 perform private.require_commercial_user();
 select * into p from public.promotions where owner_id=auth.uid() and request_id=p_request_id;
 if found and p.billing_mode='legacy_package' and p.target_type=p_target_type and p.target_id=p_target_id and p.package_id=p_package_id then return jsonb_build_object('id',p.id,'replay',true,'expiresAt',p.expires_at); end if;
 raise exception 'USE_COMMERCIAL_PROMOTION';
end $$;
update public.commercial_offerings set integration_ready=true where code in('post_boost','community_boost');
revoke all on function private.promotion_source_fingerprint(text,uuid),private.commercial_promotion_source_eligible(public.promotions),private.commercial_promotion_order_guard(),private.sync_commercial_promotion() from public,anon,authenticated,service_role;
revoke all on function public.configure_community_advertising(uuid,boolean,boolean,bigint),public.prepare_commercial_promotion(text,uuid),public.admin_review_commercial_promotion(uuid,boolean,text),public.list_commercial_featured_communities() from public,anon,service_role;
grant execute on function public.configure_community_advertising(uuid,boolean,boolean,bigint),public.prepare_commercial_promotion(text,uuid),public.admin_review_commercial_promotion(uuid,boolean,text),public.list_commercial_featured_communities() to authenticated;
