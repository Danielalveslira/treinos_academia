-- P0 fix (auditoria 2026-11-10): create_workout_sheet() era idempotente só para um retry com o
-- MESMO conteúdo -- ao reencontrar create_request_id já usado, devolvia a ficha original sem
-- olhar p_name/p_goal/p_items do novo payload. Cenário real: o INSERT comita no servidor mas a
-- resposta se perde (timeout/offline momentâneo); o editor mostra erro e mantém requestId.current;
-- o usuário edita mais campos e tenta salvar outra vez com o MESMO request_id. A RPC devolvia a
-- ficha v1 (conteúdo da 1ª tentativa); o cliente então marcava sheet v2 (local) como "salvo" e
-- navegava para o detalhe -- perda silenciosa das edições feitas entre as duas tentativas.
--
-- Correção: ao reencontrar o request_id, em vez de devolver a ficha original direto, reconcilia
-- via save_workout_sheet() com o payload ATUAL -- a mesma função que já implementa
-- compare-and-swap, no-op quando idêntico e validação completa para toda edição normal. Uma
-- retentativa com conteúdo igual ao já persistido continua sem gravar nada (revision inalterada);
-- uma retentativa com conteúdo diferente agora aplica a diferença, nunca a descarta.
set local lock_timeout = '5s';

create or replace function public.create_workout_sheet(p_request_id uuid,p_name text,p_goal text default null,p_description text default '',p_weekdays smallint[] default '{}',p_items jsonb default '[]',p_expected_user uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); s public.workout_sheets; result jsonb;
begin
 if p_request_id is null then raise exception 'SHEET_INVALID_PAYLOAD'; end if;
 if p_expected_user is not null and p_expected_user<>u then raise exception 'SHEET_ACCOUNT_CHANGED'; end if;
 -- Serialize per account: both retries and the active-sheet limit are race safe.
 perform 1 from public.users where id=u for update;
 select * into s from public.workout_sheets where user_id=u and create_request_id=p_request_id;
 if s.id is not null then
   -- Mesma requisição de criação, revisitada: reconcilia com o que o formulário tem AGORA, em vez
   -- de devolver cegamente o snapshot da 1ª tentativa. save_workout_sheet() já valida tudo de novo
   -- e não grava nada se o conteúdo não mudou desde então.
   return public.save_workout_sheet(s.id,s.revision,
     jsonb_build_object('name',p_name,'goal',p_goal,'goal_description',p_description,'weekdays',p_weekdays),
     p_items);
 end if;
 if (select count(*) from public.workout_sheets where user_id=u and archived_at is null)>=(private.workout_sheet_limits()->>'active')::int then raise exception 'SHEET_LIMIT_REACHED'; end if;
 insert into public.workout_sheets(user_id,name,create_request_id,sort_order) values(u,'Rascunho',p_request_id,coalesce((select max(sort_order)+1 from public.workout_sheets where user_id=u),0)) returning * into s;
 result:=public.save_workout_sheet(s.id,s.revision,jsonb_build_object('name',p_name,'goal',p_goal,'goal_description',p_description,'weekdays',p_weekdays),p_items);
 return result;
end $$;
