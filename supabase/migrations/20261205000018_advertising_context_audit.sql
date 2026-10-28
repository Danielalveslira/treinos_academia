set local lock_timeout='5s';
-- Preserve interruption evidence for community context changes as well as posts.
-- This records eligibility changes; it never changes money or contracted time.
create or replace function private.audit_advertising_source() returns trigger
language plpgsql security definer set search_path='' as $$
declare source_type text:=case when tg_table_name='communities' then 'community' else 'post' end;
begin
 insert into public.advertising_operations(actor_user_id,resource_id,action,reason,payload)
 select coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid),p.id,
 case when tg_op='DELETE' then 'source_removed' else 'source_changed' end,
 case when tg_op='DELETE' then 'Origem ou contexto removido; não há compensação automática'
 else 'Origem ou contexto alterado; elegibilidade depende da revisão autorizada' end,
 jsonb_build_object('sourceType',source_type,'sourceId',old.id,
 'approvedFingerprint',s.source_fingerprint,
 'currentFingerprint',case when tg_op='UPDATE' then private.promotion_source_fingerprint(p.target_type,p.target_id) end,
 'contextBefore',case when source_type='community' then jsonb_build_object('owner',to_jsonb(old)->'owner_id','active',to_jsonb(old)->'is_active','deletion',to_jsonb(old)->'deletion_status') end,
 'contextAfter',case when source_type='community' and tg_op='UPDATE' then jsonb_build_object('owner',to_jsonb(new)->'owner_id','active',to_jsonb(new)->'is_active','deletion',to_jsonb(new)->'deletion_status') end)
 from public.promotions p join private.promotion_editorial_snapshots s on s.promotion_id=p.id
 where p.commercial_resource_id is not null and
 ((source_type='post' and p.target_type='post' and p.target_id=old.id)
 or (source_type='community' and p.community_id=old.id));
 return null;
end $$;
create trigger advertising_community_source_audit
after update of name,description,owner_id,is_active,deletion_status or delete on public.communities
for each row execute function private.audit_advertising_source();
