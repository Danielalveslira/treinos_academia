-- Promoção de comunidade usa a mesma RPC paga do post. UPDATE direto do dono
-- não pode fabricar/cancelar/estender destaque. Admin de aplicação usa as RPCs também.
begin;
create or replace function private.communities_guard_promotion_fields() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.promoted or new.promoted_until is not null or new.active_promotion_id is not null then
        raise exception using errcode = '42501', message = 'COMMUNITY_PROMOTION_SERVER_ONLY';
      end if;
    elsif new.promoted is distinct from old.promoted
       or new.promoted_until is distinct from old.promoted_until
       or new.active_promotion_id is distinct from old.active_promotion_id then
      raise exception using errcode = '42501', message = 'COMMUNITY_PROMOTION_SERVER_ONLY';
    end if;
  end if;
  return new;
end;
$$;
alter function private.communities_guard_promotion_fields() owner to postgres;
revoke all on function private.communities_guard_promotion_fields() from public, anon, authenticated;
drop trigger if exists communities_guard_promotion_fields on public.communities;
create trigger communities_guard_promotion_fields before insert or update on public.communities
for each row execute function private.communities_guard_promotion_fields();
commit;
