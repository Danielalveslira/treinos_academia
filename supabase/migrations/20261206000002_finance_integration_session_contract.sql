-- Integration regression found by the full remote pgTAP suite.
-- No balances, metrics, prices, orders, rights or sales flags are changed.
set local lock_timeout='5s';
set local statement_timeout='30s';
create or replace function public.record_promotion_event(p_target_type text,p_target_id uuid,p_promotion_id uuid,p_type text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.promotions; previous timestamptz; t timestamptz:=clock_timestamp();
begin
 -- Preserve the established revoked-session contract before checking context.
 if auth.uid() is not null and not private.current_session_active() then
  raise exception 'SESSION_REVOKED';
 end if;
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
revoke all on function public.record_promotion_event(text,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.record_promotion_event(text,uuid,uuid,text) to authenticated;
