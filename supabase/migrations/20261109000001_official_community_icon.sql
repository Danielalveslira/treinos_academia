-- O ícone da marca só pode pertencer a comunidades oficiais, sem proprietário.
alter table public.communities
  drop constraint if exists communities_icon_name_check;

alter table public.communities
  add constraint communities_icon_name_check
  check (icon_name is null or icon_name in (
    'apple', 'carrot', 'salad', 'utensils', 'cooking-pot', 'chef-hat',
    'fish', 'egg', 'glass-water', 'coffee', 'wheat', 'scale',
    'dumbbell', 'biceps-flexed', 'zap', 'flame', 'target', 'timer', 'medal', 'trophy',
    'route', 'bike', 'footprints', 'mountain', 'goal', 'circle-dot', 'waves', 'move',
    'heart-pulse', 'heart', 'brain', 'moon', 'leaf', 'flower-2', 'sun', 'activity',
    'users', 'messages-square', 'star', 'rocket', 'flag', 'calendar-days',
    'book-open', 'hand-heart', 'evolutus'
  ));

create or replace function private.guard_official_community_icon() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_icon_changed boolean;
begin
  if tg_op = 'INSERT' then
    v_icon_changed := true;
  else
    v_icon_changed := new.icon_name is distinct from old.icon_name;
  end if;
  if new.icon_name = 'evolutus' then
    if new.owner_id is not null then
      raise exception 'OFFICIAL_ICON_REQUIRES_OWNERLESS_COMMUNITY' using errcode = '42501';
    end if;
    if v_icon_changed and not coalesce(public.is_superadmin(), false) then
      raise exception 'OFFICIAL_ICON_REQUIRES_SUPERADMIN' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger communities_guard_official_icon
  before insert or update of icon_name, owner_id on public.communities
  for each row execute function private.guard_official_community_icon();

revoke all on function private.guard_official_community_icon() from public, anon, authenticated;
