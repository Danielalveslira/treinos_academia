-- The client reads this server-owned switch before requesting a passwordless
-- signup OTP. Enable only after the Auth hook, templates and backend gates pass
-- staging tests. It is not an authorization control; restricted roles are.
create table private.auth_flow_control (
  id boolean primary key default true check (id),
  email_first_ready boolean not null default false,
  changed_at timestamptz not null default now()
);
insert into private.auth_flow_control(id,email_first_ready) values(true,false);
alter table private.auth_flow_control enable row level security;
revoke all on private.auth_flow_control from public, anon, authenticated;

create function public.auth_email_first_ready() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select email_first_ready from private.auth_flow_control where id), false)
$$;
revoke all on function public.auth_email_first_ready() from public;
grant execute on function public.auth_email_first_ready() to anon, authenticated,
  auth_signup, auth_recovery, auth_setup;
