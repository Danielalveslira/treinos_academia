-- Somente inspeção pelo responsável autorizado no projeto confirmado.
-- Não executar no workspace como substituto de confirmação do destino.
-- Não incluir resultados brutos de corpos/expressões em relatório público:
-- revisar e redigir eventual literal sensível. Não consulta linhas de usuários.
begin read only;
select current_database(), current_user, version();
select version, name from supabase_migrations.schema_migrations order by version;
select n.nspname, c.relname, pg_get_userbyid(c.relowner) as owner,
       c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','auth') and c.relname in
 ('users','public_profiles','public_profile_statistics','usernames','statuses','communities',
  'wallets','economy_transactions','cash_purchases','promotions','deletion_jobs');
select * from information_schema.role_table_grants where table_schema='public'
 and table_name in ('users','public_profiles','public_profile_statistics','usernames',
 'statuses','communities','wallets','economy_transactions','cash_purchases','promotions');
select * from information_schema.column_privileges where table_schema='public'
 and table_name in ('users','public_profiles','public_profile_statistics','usernames',
 'statuses','communities','wallets','economy_transactions','cash_purchases','promotions');
-- ACLs efetivas incluem PUBLIC, grants de tabela/coluna e herança.
select r.role, n.nspname, c.relname, a.attname,
 has_column_privilege(r.role,c.oid,a.attnum,'INSERT') as can_insert,
 has_column_privilege(r.role,c.oid,a.attnum,'UPDATE') as can_update,
 has_table_privilege(r.role,c.oid,'DELETE') as can_delete,
 has_table_privilege(r.role,c.oid,'TRUNCATE') as can_truncate
from pg_class c join pg_namespace n on n.oid=c.relnamespace
 join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
 cross join (values ('anon'),('authenticated'),('service_role')) r(role)
where n.nspname in ('public','auth') and c.relkind in ('r','p')
 and c.relname in ('users','public_profiles','public_profile_statistics','usernames',
 'statuses','communities','wallets','economy_transactions','cash_purchases','promotions');
select member_role.rolname as member, parent_role.rolname as inherited_role,
 member_role.rolinherit, m.admin_option
from pg_auth_members m join pg_roles member_role on member_role.oid=m.member
 join pg_roles parent_role on parent_role.oid=m.roleid;
select rolname, rolsuper, rolbypassrls, rolinherit from pg_roles
 where rolname in ('anon','authenticated','service_role','postgres','authenticator');
select schemaname, tablename, policyname, roles, cmd, qual, with_check from pg_policies
 where schemaname='public' and tablename in ('users','public_profiles',
 'public_profile_statistics','usernames','statuses','communities','wallets',
 'economy_transactions','cash_purchases','promotions','deletion_jobs');
select n.nspname, c.relname, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid)
from pg_trigger t join pg_class c on c.oid=t.tgrelid
 join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and n.nspname='public'
 and c.relname in ('users','statuses','communities','wallets','cash_purchases','promotions');
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as signature,
 pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_exec,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_exec,
 has_function_privilege('service_role',p.oid,'EXECUTE') as service_exec,
 pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.prokind='f' and
 (p.proname in ('delete_own_account','statuses_initialize_identity',
 'communities_guard_promotion_fields','create_promotion','cancel_promotion','cast_vote',
 'queue_deletion','run_deletion_job','ensure_user_profile','set_username','set_birth_info')
 or p.oid in (select tgfoid from pg_trigger where tgrelid in
 ('public.statuses'::regclass,'public.communities'::regclass) and not tgisinternal));
commit;
