-- Removal of never-published versions only. Durable tombstones prevent version/path reuse.
-- Physical files are removed by the Storage API, never by deleting storage.objects in SQL.
set local lock_timeout = '5s';
create table public.exercise_visual_deletions (
  visual_set_id uuid primary key,
  catalog_id uuid not null,
  version integer not null,
  previous_status text not null,
  requested_by uuid not null,
  allocation_request_id uuid,
  allocation_created_by uuid,
  files jsonb not null check (jsonb_typeof(files)='array' and jsonb_array_length(files)=6),
  status text not null default 'pending' check (status in ('pending','processing','complete')),
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(catalog_id,version)
);
create index exercise_visual_deletions_pending on public.exercise_visual_deletions(created_at) where status<>'complete';
create index exercise_visual_deletions_allocation on public.exercise_visual_deletions(allocation_created_by,allocation_request_id) where allocation_request_id is not null;
create index exercise_visual_deletions_files on public.exercise_visual_deletions using gin(files);
alter table public.exercise_visual_deletions enable row level security;
revoke all on public.exercise_visual_deletions from public,anon,authenticated,service_role;
grant select on public.exercise_visual_deletions to authenticated,service_role;
create policy exercise_visual_deletions_read on public.exercise_visual_deletions for select to authenticated using(public.is_superadmin());

create function private.lock_visual_file(p_bucket text,p_path text) returns void
language sql set search_path='' as $$
  select pg_advisory_xact_lock(hashtextextended('exercise-visual-file:'||p_bucket||':'||p_path,0))
$$;
revoke all on function private.lock_visual_file(text,text) from public,anon,authenticated;

create function private.visual_file_referenced(p_bucket text,p_path text,p_exclude uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.exercise_visual_assets where visual_set_id<>p_exclude and storage_bucket=p_bucket and storage_path=p_path)
  or exists(select 1 from public.exercise_visual_reference_assets where storage_bucket=p_bucket and storage_path=p_path)
  or exists(select 1 from public.exercise_catalog where strpos(jsonb_build_array(published_media_refs,source_media_refs,media_refs)::text,p_path)>0)
  or exists(select 1 from public.exercise_visual_style_profiles where strpos(reference_assets::text,p_path)>0)
  or exists(select 1 from public.communities where strpos(image_url,p_path)>0)
  or exists(select 1 from public.sponsored_ads where strpos(image_url,p_path)>0)
  or exists(select 1 from public.statuses where strpos(photo_path,p_path)>0)
$$;
revoke all on function private.visual_file_referenced(text,text,uuid) from public,anon,authenticated;

create function public.request_exercise_visual_deletion(p_set_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  s public.exercise_visual_sets;
  j public.exercise_visual_deletions;
  f jsonb; files jsonb:='[]'; r text; b text; path text; cid uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode='28000'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select catalog_id into cid from public.exercise_visual_sets where id=p_set_id;
  if cid is null then
    select * into j from public.exercise_visual_deletions where visual_set_id=p_set_id;
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    return jsonb_build_object('visualSetId',p_set_id,'status',j.status,'replayed',true);
  end if;
  perform private.lock_exercise_visual_catalog(cid);
  select * into s from public.exercise_visual_sets where id=p_set_id for update;
  if not found then
    select * into j from public.exercise_visual_deletions where visual_set_id=p_set_id;
    if not found then raise exception 'INVALID_STATE' using errcode='55000'; end if;
    return jsonb_build_object('visualSetId',p_set_id,'status',j.status,'replayed',true);
  end if;
  if s.status in ('published','archived') or s.published_at is not null or s.approved_at is not null
    or exists(select 1 from public.exercise_catalog where id=s.catalog_id and
      (published_media_refs->>'version'=s.version::text or strpos(published_media_refs::text,s.id::text)>0)) then
    raise exception 'VISUAL_VERSION_PROTECTED' using errcode='55000';
  end if;
  -- Include partial publication copies and an unconfirmed thumbnail as well as drafts.
  foreach b in array array['exercise-visual-drafts','exercise-visuals'] loop
    foreach r in array array['start','end','thumbnail'] loop
      path:=cid::text||'/'||case when b='exercise-visuals' then 'v'||s.version else s.id::text end||'/'||private.exercise_visual_file_name(r);
      files:=files||jsonb_build_array(jsonb_build_object('bucket',b,'path',path));
    end loop;
  end loop;
  for f in select value from jsonb_array_elements(files) order by value->>'bucket',value->>'path' loop
    perform private.lock_visual_file(f->>'bucket',f->>'path');
    if private.visual_file_referenced(f->>'bucket',f->>'path',s.id) then
      raise exception 'VISUAL_FILE_REFERENCED' using errcode='55000';
    end if;
  end loop;
  if exists(select 1 from public.exercise_visual_assets a where a.visual_set_id=s.id
    and not files @> jsonb_build_array(jsonb_build_object('bucket',a.storage_bucket,'path',a.storage_path))) then
    raise exception 'VISUAL_ASSET_PATH_INVALID' using errcode='55000';
  end if;
  insert into public.exercise_visual_deletions(visual_set_id,catalog_id,version,previous_status,requested_by,
    allocation_request_id,allocation_created_by,files)
    values(s.id,s.catalog_id,s.version,s.status,auth.uid(),s.request_id,s.created_by,files);
  -- Only owned assets cascade. Append-only audit and style/reference profiles survive.
  delete from public.exercise_visual_sets where id=s.id;
  insert into public.exercise_visual_audit_log(visual_set_id,catalog_id,actor_id,action,previous_status,new_status,version,metadata)
    values(s.id,s.catalog_id,auth.uid(),'cleanup',s.status,s.status,s.version,'{"deletion":"pending"}');
  return jsonb_build_object('visualSetId',s.id,'status','pending');
end;
$$;
revoke all on function public.request_exercise_visual_deletion(uuid) from public,anon,authenticated;
grant execute on function public.request_exercise_visual_deletion(uuid) to authenticated;

-- Fence references and late copies before they become visible. All participating writes share file locks.
create function private.guard_deleted_visual_file(p_bucket text,p_path text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_visual_file(p_bucket,p_path);
  if exists(select 1 from public.exercise_visual_deletions
    where files @> jsonb_build_array(jsonb_build_object('bucket',p_bucket,'path',p_path))) then
    raise exception 'VISUAL_SET_DELETED' using errcode='55000';
  end if;
end;
$$;
revoke all on function private.guard_deleted_visual_file(text,text) from public,anon,authenticated;

create function private.guard_visual_reference_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare ref text; b text;
begin
  if tg_table_name in ('exercise_visual_assets','exercise_visual_reference_assets') then
    if new.storage_bucket in ('exercise-visuals','exercise-visual-drafts') then
      perform private.guard_deleted_visual_file(new.storage_bucket,new.storage_path);
    end if;
  elsif tg_table_schema='storage' then
    if new.bucket_id in ('exercise-visuals','exercise-visual-drafts') then
      perform private.guard_deleted_visual_file(new.bucket_id,new.name);
    end if;
  else
    -- Canonical keys can be bare paths or embedded in public/signed URLs in legacy JSON.
    if tg_table_name='exercise_catalog' then ref:=jsonb_build_array(new.published_media_refs,new.source_media_refs,new.media_refs)::text;
    elsif tg_table_name='exercise_visual_style_profiles' then ref:=new.reference_assets::text;
    elsif tg_table_name='statuses' then ref:=new.photo_path;
    else ref:=new.image_url; end if;
    for ref in select (m)[1] from regexp_matches(coalesce(ref,''),
      '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(?:v[0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(?:start|end|thumb)\.webp)','g') m order by (m)[1] loop
      b:=case when split_part(ref,'/',2) like 'v%' then 'exercise-visuals' else 'exercise-visual-drafts' end;
      perform private.guard_deleted_visual_file(b,ref);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_visual_reference_write() from public,anon,authenticated;
create trigger visual_deletion_asset_fence before insert or update of storage_bucket,storage_path on public.exercise_visual_assets for each row execute function private.guard_visual_reference_write();
create trigger visual_deletion_reference_fence before insert or update of storage_bucket,storage_path on public.exercise_visual_reference_assets for each row execute function private.guard_visual_reference_write();
create trigger visual_deletion_catalog_fence before insert or update of published_media_refs,source_media_refs,media_refs on public.exercise_catalog for each row execute function private.guard_visual_reference_write();
create trigger visual_deletion_style_fence before insert or update of reference_assets on public.exercise_visual_style_profiles for each row execute function private.guard_visual_reference_write();
create trigger visual_deletion_community_fence before insert or update of image_url on public.communities for each row execute function private.guard_visual_reference_write();
create trigger visual_deletion_ad_fence before insert or update of image_url on public.sponsored_ads for each row execute function private.guard_visual_reference_write();
create trigger visual_deletion_status_fence before insert or update of photo_path on public.statuses for each row execute function private.guard_visual_reference_write();
create trigger visual_deletion_storage_fence before insert or update of bucket_id,name on storage.objects for each row execute function private.guard_visual_reference_write();

-- Max(version) in allocation must never recycle deleted public paths or retry keys.
create function private.guard_visual_allocation_after_deletion() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.lock_exercise_visual_catalog(new.catalog_id);
  if new.request_id is not null and exists(select 1 from public.exercise_visual_deletions
    where allocation_created_by=new.created_by and allocation_request_id=new.request_id) then
    raise exception 'VISUAL_SET_DELETED' using errcode='55000';
  end if;
  new.version:=greatest(new.version,coalesce((select max(version)+1 from public.exercise_visual_deletions where catalog_id=new.catalog_id),1));
  return new;
end;
$$;
revoke all on function private.guard_visual_allocation_after_deletion() from public,anon,authenticated;
create trigger visual_deletion_allocation_fence before insert on public.exercise_visual_sets for each row execute function private.guard_visual_allocation_after_deletion();

create function public.claim_exercise_visual_deletions(p_set_id uuid default null,p_limit integer default 20)
returns setof public.exercise_visual_deletions language plpgsql security definer set search_path='' as $$
declare j public.exercise_visual_deletions; f jsonb;
begin
  if p_limit not between 1 and 20 then raise exception 'INVALID_ARGUMENT'; end if;
  for j in select * from public.exercise_visual_deletions where status<>'complete'
    and (lease_until is null or lease_until<now()) and (p_set_id is null or visual_set_id=p_set_id)
    order by created_at limit p_limit for update skip locked loop
    for f in select value from jsonb_array_elements(j.files) loop
      if private.visual_file_referenced(f->>'bucket',f->>'path',j.visual_set_id) then
        raise exception 'VISUAL_FILE_REFERENCED' using errcode='55000';
      end if;
    end loop;
    update public.exercise_visual_deletions set status='processing',attempts=attempts+1,
      lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',last_error=null
      where visual_set_id=j.visual_set_id returning * into j;
    return next j;
  end loop;
end;
$$;
revoke all on function public.claim_exercise_visual_deletions(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_exercise_visual_deletions(uuid,integer) to service_role;

create function public.finish_exercise_visual_deletion(p_set_id uuid,p_token uuid,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.exercise_visual_deletions;
begin
  select * into j from public.exercise_visual_deletions where visual_set_id=p_set_id for update;
  if not found or j.status<>'processing' or j.lease_token is distinct from p_token then return false; end if;
  if p_error is null and exists(select 1 from storage.objects o join jsonb_array_elements(j.files) f
    on o.bucket_id=f->>'bucket' and o.name=f->>'path') then p_error:='FILES_STILL_PRESENT'; end if;
  update public.exercise_visual_deletions set status=case when p_error is null then 'complete' else 'pending' end,
    last_error=left(p_error,80),lease_until=null,lease_token=null,completed_at=case when p_error is null then now() end
    where visual_set_id=p_set_id;
  if p_error is null then
    insert into public.exercise_visual_audit_log(visual_set_id,catalog_id,actor_id,action,previous_status,new_status,version,metadata)
      values(j.visual_set_id,j.catalog_id,j.requested_by,'cleanup',j.previous_status,j.previous_status,j.version,'{"deletion":"complete"}');
  end if;
  return true;
end;
$$;
revoke all on function public.finish_exercise_visual_deletion(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_exercise_visual_deletion(uuid,uuid,text) to service_role;
