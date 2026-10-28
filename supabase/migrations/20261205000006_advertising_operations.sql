set local lock_timeout='5s';
-- Preserve existing cancellation implementation and its financial history, but
-- enforce the shared resource lock first for the new commercial adapter.
alter function public.cancel_promotion(uuid,text) set schema private;
alter function private.cancel_promotion(uuid,text) rename to cancel_promotion_previous;
revoke all on function private.cancel_promotion_previous(uuid,text) from public,anon,authenticated,service_role;
create function public.cancel_promotion(p_promotion_id uuid,p_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.promotions; result jsonb;
begin
 perform private.require_commercial_user();
 select * into p from public.promotions where id=p_promotion_id;
 if not found then raise exception 'PROMOTION_NOT_FOUND'; end if;
 if p.owner_id<>auth.uid() then perform private.require_evocash_admin(true); end if;
 if p.commercial_resource_id is not null then
 perform 1 from private.commercial_resources where id=p.id for update;
 end if;
 result:=private.cancel_promotion_previous(p_promotion_id,p_reason);
 if p.commercial_resource_id is not null then
 update private.commercial_resources set moderation_state='suspended' where id=p.id;
 insert into public.advertising_operations(actor_user_id,resource_id,action,reason) values(auth.uid(),p.id,'cancel_promotion',coalesce(nullif(btrim(p_reason),''),'Interrupção solicitada pelo anunciante'));
 end if;
 return result;
end $$;
revoke all on function public.cancel_promotion(uuid,text) from public,anon,service_role;
grant execute on function public.cancel_promotion(uuid,text) to authenticated;
create function public.admin_commercial_promotions(p_after uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_evocash_admin();
 return coalesce((select jsonb_agg(to_jsonb(x)) from(
 select p.id,p.target_type,p.target_id,p.community_id,p.status,p.cash_amount,p.duration_days,p.expires_at,r.moderation_state,ps.review_reason,
 case when p.target_type='community' then c.name else coalesce(s.text,s.photo_caption,s.workout_title,s.poll_question,s.achievement_text) end as title
 from public.promotions p join private.commercial_resources r on r.id=p.commercial_resource_id join private.promotion_editorial_snapshots ps on ps.promotion_id=p.id
 left join public.communities c on c.id=p.community_id left join public.statuses s on s.id=p.target_id and p.target_type='post'
 where p_after is null or p.id<p_after order by p.id desc limit 20)x),'[]'::jsonb);
end $$;
create function public.get_my_advertising_orders(p_id uuid,p_before timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_commercial_user();
 if not exists(select 1 from private.commercial_resources r where r.id=p_id and r.owner_user_id=auth.uid() and
 (exists(select 1 from private.advertising_drafts where ad_id=r.id) or exists(select 1 from public.promotions where commercial_resource_id=r.id))) then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(private.commercial_order_json(o) order by o.created_at desc,o.id desc) from(select * from public.commercial_orders where resource_id=p_id and payer_user_id=auth.uid() and (p_before is null or created_at<p_before) order by created_at desc,id desc limit 20)o),'[]'::jsonb);
end $$;
create function public.admin_resume_advertising_campaign(p_id uuid,p_revision bigint,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare r private.commercial_resources;
begin
 perform private.require_evocash_admin(true);
 if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'AD_REVIEW_REASON_REQUIRED'; end if;
 select * into r from private.commercial_resources where id=p_id for update;
 if not found or r.content_revision is distinct from p_revision or r.approved_revision is distinct from p_revision or r.moderation_state<>'suspended' then raise exception 'AD_REVISION_CONFLICT'; end if;
 if not exists(select 1 from private.advertising_drafts where ad_id=p_id and approved_version=p_revision) then raise exception 'AD_NOT_FOUND'; end if;
 update private.commercial_resources set moderation_state='approved' where id=p_id;
 insert into public.advertising_operations(actor_user_id,resource_id,action,reason) values(auth.uid(),p_id,'resume',btrim(p_reason));
end $$;
create function public.get_community_advertising_permissions(p_community uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_commercial_user();
 if not exists(select 1 from public.communities where id=p_community and owner_id=auth.uid()) then raise exception 'AD_COMMUNITY_NOT_AUTHORIZED'; end if;
 return coalesce((select to_jsonb(p) from public.community_advertising_permissions p where community_id=p_community),jsonb_build_object('revision',0,'post_boosts_enabled',false,'community_boosts_enabled',false));
end $$;
create function public.admin_advertising_operations(p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_evocash_admin();
 return coalesce((select jsonb_agg(to_jsonb(x) order by id desc) from(select * from public.advertising_operations where p_before is null or id<p_before order by id desc limit 30)x),'[]'::jsonb);
end $$;
create or replace function public.admin_advertising_inventory() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_evocash_admin();
 return jsonb_build_object('placements',(select jsonb_agg(to_jsonb(p) order by code) from public.advertising_placements p),'serverTime',statement_timestamp(),
 'networkRevision',(select network_revision::text from private.advertising_configuration where id),
 'networkPlacements',coalesce((select jsonb_agg(placement_code order by placement_code) from private.advertising_network_bundle),'[]'::jsonb));
end $$;
-- Promotion metrics stay in the existing click counter; no invented impressions,
-- audience, CTR or conversions for this distinct format.
create or replace function public.record_promotion_event(p_target_type text,p_target_id uuid,p_promotion_id uuid,p_type text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.promotions; previous timestamptz; t timestamptz:=clock_timestamp();
begin
 perform private.require_commercial_user();
 if p_type is distinct from 'click' then raise exception 'INVALID_EVENT_TYPE'; end if;
 perform pg_advisory_xact_lock(hashtextextended('promotion-click:'||auth.uid()::text,0));
 select * into p from public.promotions where id=p_promotion_id;
 if not found or p.target_type is distinct from p_target_type or p.target_id is distinct from p_target_id then raise exception 'PROMOTION_MISMATCH'; end if;
 if p.status<>'active' or p.started_at>t or p.expires_at<=t or p.owner_id=auth.uid() or public.is_superadmin()
 or (p.target_type='post' and not coalesce(public.is_community_member(p.community_id),false))
 or (p.commercial_resource_id is not null and (not private.commercial_resource_visible(p.id) or not private.commercial_promotion_source_eligible(p))) then return jsonb_build_object('recorded',false); end if;
 select last_click_at into previous from public.promotion_event_limits where user_id=auth.uid() and promotion_id=p.id;
 if previous>t-interval '10 seconds' then return jsonb_build_object('recorded',false); end if;
 if (select count(*) from public.promotion_event_limits where user_id=auth.uid() and last_click_at>t-interval '1 hour')>=120 then return jsonb_build_object('recorded',false); end if;
 update public.promotions set click_count=click_count+1 where id=p.id;
 insert into public.promotion_event_limits(user_id,promotion_id,last_click_at,expire_at) values(auth.uid(),p.id,t,t+interval '24 hours') on conflict(user_id,promotion_id) do update set last_click_at=t,expire_at=t+interval '24 hours';
 return jsonb_build_object('recorded',true);
end $$;
revoke all on function public.admin_commercial_promotions(uuid),public.get_my_advertising_orders(uuid,timestamptz),public.admin_resume_advertising_campaign(uuid,bigint,text),public.get_community_advertising_permissions(uuid),public.admin_advertising_operations(bigint) from public,anon,service_role;
grant execute on function public.admin_commercial_promotions(uuid),public.get_my_advertising_orders(uuid,timestamptz),public.admin_resume_advertising_campaign(uuid,bigint,text),public.get_community_advertising_permissions(uuid),public.admin_advertising_operations(bigint) to authenticated;
