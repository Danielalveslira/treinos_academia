-- Test fixtures only. Never a migration, RPC or production installation.
-- Uses real GoTrue auth.sessions instead of inventing a table or bypassing guards.
create or replace function pg_temp.set_test_user(p_uid text,p_local boolean default true)
returns text language plpgsql security definer set search_path = '' as $$
declare v_session uuid;
begin
 perform set_config('request.jwt.claim.sub',coalesce(p_uid,''),p_local);
 if nullif(p_uid,'') is null then
  perform set_config('request.jwt.claims','{}',p_local);
 else
  v_session := md5('sql-fixture-session:'||p_uid)::uuid;
  if exists(select 1 from auth.users where id=p_uid::uuid) then
   insert into auth.sessions(id,user_id,created_at,updated_at)
    values(v_session,p_uid::uuid,now(),now()) on conflict(id) do nothing;
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_uid,'role','authenticated','session_id',v_session)::text,p_local);
 end if;
 return coalesce(p_uid,'');
end;
$$;

-- Simula "sair de todos os dispositivos" (ou qualquer outra revogação) para a sessão de teste
-- criada por set_test_user(p_uid): remove a linha de auth.sessions, mas preserva os claims
-- (sub/role/session_id) já setados na transação -- private.current_session_active() passa a
-- negar porque a sessão não existe mais, exatamente como um JWT antigo de verdade se comportaria
-- depois de revogado em outro aparelho (20261113000001_session_revocation_guard.sql).
create or replace function pg_temp.revoke_test_session(p_uid text)
returns void language plpgsql security definer set search_path = '' as $$
begin
 delete from auth.sessions where id = md5('sql-fixture-session:'||coalesce(p_uid,''))::uuid;
end;
$$;
