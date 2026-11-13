-- PR0: close a concurrency/replay gap in impulsionamento (boost) review.
-- admin_review_commercial_promotion(uuid,boolean,text) let any admin re-apply, repeat
-- or reverse a decision already made: it locked the row but never checked that the
-- resource was still 'submitted' nor compared a caller-supplied revision, unlike the
-- equivalent advertising/storefront review RPCs (admin_review_advertising_campaign,
-- set_storefront_editorial), which already require a matching expected revision.
set local lock_timeout='5s';

-- Expose the revision the client must echo back when deciding, so a stale listing
-- cannot be used to approve/reject a promotion that moved on in the meantime.
create or replace function public.admin_commercial_promotions(p_after uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_evocash_admin();
 return coalesce((select jsonb_agg(to_jsonb(x)) from(
 select p.id,p.target_type,p.target_id,p.community_id,p.status,p.cash_amount,p.duration_days,p.expires_at,r.moderation_state,r.content_revision as revision,ps.review_reason,
 case when p.target_type='community' then c.name else coalesce(s.text,s.photo_caption,s.workout_title,s.poll_question,s.achievement_text) end as title
 from public.promotions p join private.commercial_resources r on r.id=p.commercial_resource_id join private.promotion_editorial_snapshots ps on ps.promotion_id=p.id
 left join public.communities c on c.id=p.community_id left join public.statuses s on s.id=p.target_id and p.target_type='post'
 where p_after is null or p.id<p_after order by p.id desc limit 20)x),'[]'::jsonb);
end $$;

-- New, concurrency-safe signature: requires the expected revision and re-validates
-- that the resource is still pending review inside the same locked transaction.
create function public.admin_review_commercial_promotion(p_id uuid,p_expected_revision bigint,p_approve boolean,p_reason text) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare p public.promotions; r private.commercial_resources;
begin
 perform private.require_evocash_admin(true);
 if p_approve is null or p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'AD_REVIEW_REASON_REQUIRED'; end if;
 -- Resource lock precedes the promotion lock, matching the order already used by
 -- commercial_promotion_order_guard/sync_commercial_promotion for this same pair.
 select * into r from private.commercial_resources where id=p_id for update;
 if not found then raise exception 'PROMOTION_NOT_FOUND'; end if;
 select * into p from public.promotions where id=p_id and commercial_resource_id is not null for update;
 if not found then raise exception 'PROMOTION_NOT_FOUND'; end if;
 -- Optimistic concurrency: a stale revision or a resource that already left
 -- 'submitted' (decided, resubmitted, suspended, archived...) is rejected without
 -- mutating state, snapshot, status or auditing anything.
 if p_expected_revision is null or r.content_revision is distinct from p_expected_revision or r.moderation_state<>'submitted' then
 raise exception 'PROMOTION_REVISION_CONFLICT';
 end if;
 if not private.commercial_promotion_source_eligible(p) then raise exception 'PROMOTION_SOURCE_CHANGED'; end if;
 update private.commercial_resources set approved_revision=case when p_approve then content_revision else approved_revision end,moderation_state=case when p_approve then 'approved' else 'rejected' end where id=p_id;
 update public.promotions set status=case when p_approve then 'approved' else 'rejected' end where id=p_id;
 update private.promotion_editorial_snapshots set review_reason=btrim(p_reason) where promotion_id=p_id;
 insert into public.advertising_operations(actor_user_id,resource_id,action,reason,payload) values(auth.uid(),p_id,case when p_approve then 'approve_promotion' else 'reject_promotion' end,btrim(p_reason),jsonb_build_object('revision',r.content_revision));
end $$;

-- Close the vulnerable signature for good: no caller may decide without a
-- revision/state check, and rollback of this migration must never restore it.
revoke all on function public.admin_review_commercial_promotion(uuid,boolean,text) from public,anon,authenticated,service_role;
drop function public.admin_review_commercial_promotion(uuid,boolean,text);

revoke all on function public.admin_review_commercial_promotion(uuid,bigint,boolean,text) from public,anon,service_role;
grant execute on function public.admin_review_commercial_promotion(uuid,bigint,boolean,text) to authenticated;
