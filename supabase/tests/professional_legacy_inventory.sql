-- Read-only inventory: may run in an explicitly authorized environment.
-- No contacts, addresses, tokens or personal emails are returned.
begin read only;
select l.kind,l.lifecycle_state,count(*) records,
 count(*) filter(where u.id is not null) verified_owner,
 count(*) filter(where d.listing_id is null) missing_draft,
 count(*) filter(where d.owner_id is distinct from l.owner_id or d.kind is distinct from l.kind) draft_identity_mismatch,
 count(*) filter(where p.listing_id is not null and p.kind<>l.kind) snapshot_kind_mismatch,
 count(*) filter(where p.avatar_path is not null) historical_personal_image_reference,
 count(*) filter(where p.media_id is not null) protected_commercial_image,
 count(*) filter(where e.id is not null) with_commercial_history,
 count(*) filter(where r.moderation_state='approved') approved_anchor
from public.professional_listings l
left join public.users u on u.id=l.owner_id
left join public.professional_listing_drafts d on d.listing_id=l.id
left join public.published_professional_listings p on p.listing_id=l.id
left join private.commercial_resources r on r.id=l.id
left join public.visibility_entitlements e on e.resource_id=l.id
group by l.kind,l.lifecycle_state order by l.kind,l.lifecycle_state;
select count(*) detached_anchors_preserved_for_financial_history from private.commercial_resources r
where r.offering_code in('professional_profile','establishment_profile')
and not exists(select 1 from public.professional_listings l where l.id=r.id);
rollback;
