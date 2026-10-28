set local lock_timeout='5s';
create trigger advertising_permission_epoch after insert or update or delete on public.community_advertising_permissions for each statement execute function private.invalidate_advertising_delivery();
create trigger advertising_membership_epoch after delete on public.community_members for each statement execute function private.invalidate_advertising_delivery();
create trigger advertising_source_epoch after update of text,poll_question,poll_options,photo_path,photo_caption,workout_title,workout_date,workout_location,achievement_text on public.statuses for each statement execute function private.invalidate_advertising_delivery();
create trigger advertising_source_removed_epoch after delete on public.statuses for each statement execute function private.invalidate_advertising_delivery();
-- Keep interruption evidence even when the original organic post disappears.
create function private.audit_advertising_source() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.advertising_operations(actor_user_id,resource_id,action,reason,payload)
 select coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid),p.id,
 case when tg_op='DELETE' then 'source_removed' else 'source_changed' end,
 case when tg_op='DELETE' then 'Publicação original removida; não há compensação automática' else 'Publicação original alterada; elegibilidade depende da revisão autorizada' end,
 jsonb_build_object('sourceId',old.id,'approvedFingerprint',s.source_fingerprint,'currentFingerprint',case when tg_op='UPDATE' then private.promotion_source_fingerprint('post',old.id) end)
 from public.promotions p join private.promotion_editorial_snapshots s on s.promotion_id=p.id
 where p.target_type='post' and p.target_id=old.id and p.commercial_resource_id is not null;
 return null;
end $$;
revoke all on function private.audit_advertising_source() from public,anon,authenticated,service_role;
create trigger advertising_source_audit after update of text,poll_question,poll_options,photo_path,photo_caption,workout_title,workout_date,workout_location,achievement_text or delete on public.statuses for each row execute function private.audit_advertising_source();
