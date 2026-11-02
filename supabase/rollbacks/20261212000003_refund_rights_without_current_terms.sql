-- Rollback de 20261212000003_refund_rights_without_current_terms.sql: volta as oito RPCs
-- de reembolso a exigir o aceite vigente (private.require_commercial_user). Mesma
-- substituição textual verificada, no sentido inverso. Nenhum dado é alterado.
set local lock_timeout = '5s';
do $rollback$
declare v_item record; v_def text; v_count int;
begin
  for v_item in select * from (values
    ('public.get_refund_policy()'::regprocedure, 1),
    ('public.get_refund_source(text,uuid)'::regprocedure, 1),
    ('public.create_refund_request(text,uuid,text,text,uuid)'::regprocedure, 2),
    ('public.list_refund_requests(boolean,bigint,integer)'::regprocedure, 1),
    ('public.get_refund_request(uuid)'::regprocedure, 1),
    ('public.act_on_refund_request(uuid,text,text,uuid,bigint,jsonb)'::regprocedure, 2),
    ('public.get_refund_balance()'::regprocedure, 1),
    ('public.list_refund_events(uuid,bigint,integer)'::regprocedure, 1)
  ) as t(fn, expected) loop
    v_def := pg_catalog.pg_get_functiondef(v_item.fn);
    v_count := (char_length(v_def) - char_length(replace(v_def, 'private.require_rights_user()', '')))
               / char_length('private.require_rights_user()');
    if v_count <> v_item.expected then
      raise exception 'UNEXPECTED_REFUND_FUNCTION_BODY: % has % guard calls', v_item.fn, v_count;
    end if;
    execute replace(v_def, 'private.require_rights_user()', 'private.require_commercial_user()');
  end loop;
end $rollback$;
