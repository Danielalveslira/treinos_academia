-- Correção de 20261209000001: o CREATE OR REPLACE de public.set_birth_info voltou o search_path para
-- `public` isolado, desfazendo o endurecimento P20 (20261014000005_security_hardening.sql aplicou
-- `public, pg_temp` a toda função SECURITY DEFINER). Restaura exatamente aquele estado; o corpo da
-- função não muda.
alter function public.set_birth_info(jsonb) set search_path = public, pg_temp;
