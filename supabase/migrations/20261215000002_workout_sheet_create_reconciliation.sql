-- P0 fix (auditoria 2026-11-10): create_workout_sheet() era idempotente só para um retry com o
-- MESMO conteúdo -- ao reencontrar create_request_id já usado, devolvia a ficha original sem
-- olhar p_name/p_goal/p_items do novo payload. Cenário real: o INSERT comita no servidor mas a
-- resposta se perde (timeout/offline momentâneo); o editor mostra erro e mantém requestId.current;
-- o usuário edita mais campos e tenta salvar outra vez com o MESMO request_id. A RPC devolvia a
-- ficha v1 (conteúdo da 1ª tentativa); o cliente então marcava sheet v2 (local) como "salvo" e
-- navegava para o detalhe -- perda silenciosa das edições feitas entre as duas tentativas.
--
-- Correção: ao reencontrar o request_id, reconcilia via save_workout_sheet() (compare-and-swap,
-- no-op quando idêntico, validação completa) em vez de devolver o snapshot da 1ª tentativa.
--
-- Cuidado adicional (continuação da auditoria): usar a revisão ATUAL lida nesta própria chamada
-- como "esperada" para o compare-and-swap protegeria contra uma escrita concorrente DURANTE esta
-- chamada (save_workout_sheet relê com lock), mas NÃO contra uma edição normal da mesma ficha
-- (outra aba, pela tela de edição normal) acontecida ENTRE a 1ª tentativa e esta retentativa --
-- "ler o que está lá agora e assumir que é a base correta" aceitaria às cegas qualquer coisa que
-- já esteja lá, inclusive uma edição de outra aba, perdendo-a por sobrescrita. O mesmo problema que
-- offline_mutation_receipts (20261016000001) já resolve para workouts offline: um recibo por
-- idempotency key, com a ÚLTIMA revisão que ESTA sequência de retentativas de fato produziu --
-- nunca "o que está lá agora" cru. Uma retentativa própria subsequente casa com o recibo (avança
-- em conjunto com o próprio histórico de retentativas); uma edição estranha no meio muda a
-- revisão real sem tocar o recibo, e o compare-and-swap de save_workout_sheet detecta a divergência
-- e devolve SHEET_VERSION_CONFLICT -- nunca sobrescreve às cegas.
set local lock_timeout = '5s';

create table private.workout_sheet_create_receipts (
  user_id uuid not null references public.users(id) on delete cascade,
  create_request_id uuid not null,
  last_revision bigint not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, create_request_id)
);
revoke all on private.workout_sheet_create_receipts from public, anon, authenticated;

create or replace function public.create_workout_sheet(p_request_id uuid,p_name text,p_goal text default null,p_description text default '',p_weekdays smallint[] default '{}',p_items jsonb default '[]',p_expected_user uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); s public.workout_sheets; result jsonb; receipt_revision bigint;
begin
 if p_request_id is null then raise exception 'SHEET_INVALID_PAYLOAD'; end if;
 if p_expected_user is not null and p_expected_user<>u then raise exception 'SHEET_ACCOUNT_CHANGED'; end if;
 -- Serialize per account: both retries and the active-sheet limit are race safe.
 perform 1 from public.users where id=u for update;
 select * into s from public.workout_sheets where user_id=u and create_request_id=p_request_id;
 if s.id is not null then
   -- Mesma requisição de criação, revisitada: reconcilia com o que o formulário tem AGORA, em vez
   -- de devolver cegamente o snapshot da 1ª tentativa -- mas usando a revisão que ESTA sequência
   -- de retentativas gravou por último (o recibo), nunca a revisão crua lida agora, para que uma
   -- edição estranha no meio vire SHEET_VERSION_CONFLICT em vez de ser sobrescrita.
   select last_revision into receipt_revision from private.workout_sheet_create_receipts
     where user_id=u and create_request_id=p_request_id;
   if receipt_revision is null then
     -- Nunca deveria faltar (o recibo é gravado junto com toda escrita abaixo); sem ele, o caminho
     -- seguro é não reconciliar às cegas -- devolve o estado atual tal como está.
     return jsonb_build_object('id',s.id,'revision',s.revision);
   end if;
   result := public.save_workout_sheet(s.id, receipt_revision,
     jsonb_build_object('name',p_name,'goal',p_goal,'goal_description',p_description,'weekdays',p_weekdays),
     p_items);
   insert into private.workout_sheet_create_receipts(user_id,create_request_id,last_revision,updated_at)
     values(u,p_request_id,(result->>'revision')::bigint,now())
     on conflict(user_id,create_request_id) do update
       set last_revision=excluded.last_revision, updated_at=excluded.updated_at;
   return result;
 end if;
 if (select count(*) from public.workout_sheets where user_id=u and archived_at is null)>=(private.workout_sheet_limits()->>'active')::int then raise exception 'SHEET_LIMIT_REACHED'; end if;
 insert into public.workout_sheets(user_id,name,create_request_id,sort_order) values(u,'Rascunho',p_request_id,coalesce((select max(sort_order)+1 from public.workout_sheets where user_id=u),0)) returning * into s;
 result:=public.save_workout_sheet(s.id,s.revision,jsonb_build_object('name',p_name,'goal',p_goal,'goal_description',p_description,'weekdays',p_weekdays),p_items);
 insert into private.workout_sheet_create_receipts(user_id,create_request_id,last_revision,updated_at)
   values(u,p_request_id,(result->>'revision')::bigint,now());
 return result;
end $$;
