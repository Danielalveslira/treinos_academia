-- Single private bucket for community "status" photos, path {communityId}/{statusId}.webp
-- (the "statusPhotos/" prefix used in public.statuses.photo_path is a legacy-shaped
-- logical path kept for the CHECK constraint; the actual bucket-relative object name
-- has no such prefix, see policies below).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('status-photos', 'status-photos', false, 4194304, array['image/webp'])
on conflict (id) do nothing;

create policy status_photos_read on storage.objects for select
  using (
    bucket_id = 'status-photos'
    and exists (
      select 1 from public.statuses s
      where s.photo_path = 'statusPhotos/' || storage.objects.name
        and s.expires_at > now()
        and public.is_community_member(s.community_id)
    )
  );

create policy status_photos_insert on storage.objects for insert
  with check (
    bucket_id = 'status-photos'
    and exists (
      select 1 from public.statuses s
      where s.photo_path = 'statusPhotos/' || storage.objects.name
        and s.author_id = auth.uid()
        and s.created_at > now() - interval '10 minutes'
    )
  );

-- update/delete: no policy for authenticated — cleanup only via service_role.
