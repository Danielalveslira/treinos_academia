-- Additive, inert financial rollout. No provider calls, prices or legacy rewrites.
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.refund_policies (
 version text primary key,
 approved boolean not null default false,
 body text not null,
 counting_rule text not null check(counting_rule='civil_days_brasilia'),
 days integer not null check(days>=7),
 cash_origin text not null check(cash_origin='receipt'),
 service_origin text not null check(service_origin='contract'),
 created_at timestamptz not null default clock_timestamp()
);
insert into public.refund_policies values ('draft-1',false,
 'Texto curto: Para contratações abrangidas pelo direito de arrependimento, solicite em até sete dias conforme o marco legal aplicável e a data-limite informada. Você recebe confirmação e protocolo. Após esse prazo, continuam disponíveis reclamações por cobrança indevida, descumprimento da oferta, falha do serviço e outros direitos legais. A duração comercial não é o prazo de arrependimento.

Enquadramento: a classificação como pessoa física, profissional ou empresa é revisável. Nenhum contrato empresarial é automaticamente incluído ou excluído do CDC. O responsável deve fundamentar a decisão, avaliar consumo, início do serviço e contratos acessórios. Não há renúncia, taxa, desconto por uso ou fórmula proporcional automática.

Solicitação: feita no aplicativo, com motivo facultativo para arrependimento. Outros problemas pedem uma descrição para permitir atendimento. Não são solicitados senha de pagamento, cartão completo ou dados bancários. O protocolo e a data de recebimento permanecem preservados, mesmo se a análise acontecer após o prazo. Se houve indisponibilidade ao tentar registrar, usar a categoria de outros problemas e informar a tentativa para análise, sem tratar o atraso como perda de todos os direitos.

Análise financeira: o valor original pago e a taxa congelada vêm da compra. O saldo atual não comprova a origem de cada crédito. Créditos promocionais e consumidos não são artificialmente atribuídos a uma recarga. Valores finais e direito à restituição em dinheiro dependem de análise conforme a lei; EvoCash não substitui automaticamente restituição monetária devida.

Reserva: créditos contestados disponíveis podem ficar reservados durante análise de recarga. Reserva não é consumo nem reembolso em dinheiro. A aplicação distingue saldo disponível e reservado. Recusa fundamentada ou cancelamento cabível libera a reserva de forma auditada. Estorno pendente, falho ou divergente não libera saldo indevidamente.

Devolução: quando devida em reais, o operador usa o canal oficial da InfinitePay para o pagamento original. O aplicativo não envia ordem de estorno nesta fase. Evidência administrativa e conferência dos identificadores, moeda, lojista, valor e data são obrigatórias. Não existe confirmação automatizada de estorno pelo provedor homologada. O retorno de créditos de um serviço é uma operação distinta e exige cancelamento do período e análise dos vínculos para evitar devolução dupla.

Comunicação e contestação: cliente acompanha estado, decisões e comunicação no mesmo protocolo, com histórico paginado. Recusa é fundamentada e pode ser contestada. O prazo operacional de resposta é monitorado separadamente do arrependimento e da duração comercial.

Minuta pendente de aprovação jurídica/comercial. Contagem civil e marco inicial por modalidade exigem aprovação antes de ativação comercial.',
 'civil_days_brasilia',7,'receipt','contract',clock_timestamp());
create table private.refund_settings (
 id boolean primary key default true check(id),
 financial_requests_enabled boolean not null default false,
 settlement_enabled boolean not null default false,
 expected_merchant text,
 policy_version text not null references public.refund_policies(version)
);
insert into private.refund_settings(id,policy_version) values(true,'draft-1');
-- One immutable disclosure per future acquisition. Historical sources have an explicit
-- manual-review snapshot, never a fabricated past acceptance or lot allocation.
create table public.refund_contract_terms (
 id uuid primary key default gen_random_uuid(),
 purchase_id uuid unique references public.cash_purchases(id),
 order_id uuid unique references public.commercial_orders(id),
 check(num_nonnulls(purchase_id,order_id)=1),
 policy_version text not null references public.refund_policies(version),
 policy_snapshot jsonb not null,
 origin_at timestamptz not null,
 origin_kind text not null,
 deadline_at timestamptz not null,
 presented_at timestamptz not null default clock_timestamp()
);
create table public.refund_requests (
 id uuid primary key default gen_random_uuid(),
 sequence_id bigint generated always as identity unique,
 protocol text not null unique default ('EVR-'||upper(replace(gen_random_uuid()::text,'-',''))),
 requester_id uuid not null references public.users(id),
 purchase_id uuid references public.cash_purchases(id),
 order_id uuid references public.commercial_orders(id),
 check(num_nonnulls(purchase_id,order_id)=1),
 category text not null check(category in('withdrawal','duplicate_payment','fraud','not_credited','service_failure','voluntary_cancellation','other')),
 explanation text not null default '' check(length(explanation)<=2000),
 intent_id uuid not null,
 status text not null default 'requested' check(status in('requested','under_review','needs_information','approved','awaiting_provider_refund','provider_refund_confirmed','completed','rejected','canceled_by_requester','provider_refund_failed','disputed')),
 acquisition_snapshot jsonb not null,
 policy_snapshot jsonb not null,
 origin_at timestamptz not null,
 deadline_at timestamptz not null,
 timely boolean not null,
 reserved_units bigint not null default 0 check(reserved_units>=0),
 resolution jsonb,
 revision bigint not null default 1,
 created_at timestamptz not null default clock_timestamp(),
 response_due_at timestamptz not null default (clock_timestamp()+interval '5 days'),
 unique(requester_id,intent_id)
);
create unique index refund_active_purchase on public.refund_requests(purchase_id) where purchase_id is not null and status not in('completed','rejected','canceled_by_requester');
create unique index refund_active_order on public.refund_requests(order_id) where order_id is not null and status not in('completed','rejected','canceled_by_requester');
create index refund_owner_page on public.refund_requests(requester_id,sequence_id desc);
create index refund_admin_page on public.refund_requests(sequence_id desc);
create index refund_holds on public.refund_requests(requester_id) where reserved_units>0;
create table public.refund_request_events (
 id bigint generated always as identity primary key,
 request_id uuid not null references public.refund_requests(id),
 actor_id uuid not null,
 intent_id uuid not null,
 action text not null,
 message text not null check(length(message)<=2000),
 -- Administrative evidence is never returned by the customer projection.
 evidence jsonb not null default '{}',
 input jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(actor_id,intent_id)
);
create index refund_events_page on public.refund_request_events(request_id,id desc);
-- References the existing reversal / service compensation; this is not a ledger.
create table public.refund_settlements (
 request_id uuid primary key references public.refund_requests(id),
 reversal_id uuid unique references public.cash_purchase_reversals(id),
 order_id uuid unique references public.commercial_orders(id),
 external_id text unique,
 evidence_reference text not null,
 amount_centavos integer,
 occurred_at timestamptz not null,
 verified_by uuid not null,
 verification text not null check(verification in('administrative_evidence_only','existing_commercial_reversal')),
 check(num_nonnulls(reversal_id,order_id)=1)
);
create function private.refund_deadline(p_origin timestamptz,p_days integer) returns timestamptz
language sql immutable set search_path='' as $$
 select (((p_origin at time zone 'America/Sao_Paulo')::date+p_days+1)::timestamp at time zone 'America/Sao_Paulo')-interval '1 microsecond'
$$;
create function private.capture_refund_terms() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.refund_policies; t timestamptz;
begin
 select x.* into p from public.refund_policies x join private.refund_settings s on s.policy_version=x.version;
 if tg_table_name='cash_purchases' then
  -- Receipt is credit confirmation, not checkout creation. Before receipt the
  -- available channel is a payment/service complaint with manual legal review.
  if new.status='credited' and (tg_op='INSERT' or old.status is distinct from 'credited') then
   t:=coalesce(new.credited_at,clock_timestamp());
   insert into public.refund_contract_terms(purchase_id,policy_version,policy_snapshot,origin_at,origin_kind,deadline_at)
   values(new.id,p.version,to_jsonb(p),t,'receipt',private.refund_deadline(t,p.days)) on conflict do nothing;
  end if;
 else
  if new.status='fulfilled' and (tg_op='INSERT' or old.status is distinct from 'fulfilled') then
   t:=new.fulfilled_at;
   insert into public.refund_contract_terms(order_id,policy_version,policy_snapshot,origin_at,origin_kind,deadline_at)
   values(new.id,p.version,to_jsonb(p),t,'contract',private.refund_deadline(t,p.days)) on conflict do nothing;
  end if;
 end if;
 return new;
end $$;
create trigger refund_purchase_terms after insert or update on public.cash_purchases for each row execute function private.capture_refund_terms();
create trigger refund_service_terms after insert or update on public.commercial_orders for each row execute function private.capture_refund_terms();
create function private.protect_refund_request() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'REFUND_HISTORY_IMMUTABLE'; end if;
 if (to_jsonb(new)-array['status','reserved_units','resolution','revision']) is distinct from
 (to_jsonb(old)-array['status','reserved_units','resolution','revision']) or new.revision<>old.revision+1 then
 raise exception 'REFUND_HISTORY_IMMUTABLE'; end if;
 return new;
end $$;
create trigger refund_request_snapshot before update or delete on public.refund_requests for each row execute function private.protect_refund_request();
create trigger refund_policy_immutable before update or delete on public.refund_policies for each row execute function private.commercial_immutable();
create trigger refund_terms_immutable before update or delete on public.refund_contract_terms for each row execute function private.commercial_immutable();
create trigger refund_events_immutable before update or delete on public.refund_request_events for each row execute function private.commercial_immutable();
create trigger refund_settlement_immutable before update or delete on public.refund_settlements for each row execute function private.commercial_immutable();
-- Enforces holds for EVERY existing wallet-debit path, including debt recovery.
-- No consumption / financial ledger entry is made merely to reserve credits.
create function private.enforce_refund_hold() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.cash_balance < coalesce((select sum(reserved_units) from public.refund_requests where requester_id=new.user_id and reserved_units>0),0) then
 raise exception 'CASH_RESERVED_FOR_REFUND'; end if;
 return new;
end $$;
create trigger wallet_refund_hold before update of cash_balance on public.wallets for each row execute function private.enforce_refund_hold();
create function private.refund_json(r public.refund_requests) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'requesterId',r.requester_id,'originAt',r.origin_at,'cursor',r.sequence_id::text,'protocol',r.protocol,'purchaseId',r.purchase_id,'orderId',r.order_id,
 'category',r.category,'status',r.status,'createdAt',r.created_at,'responseDueAt',r.response_due_at,'deadlineAt',r.deadline_at,
 'timely',r.timely,'revision',r.revision::text,'reservedUnits',r.reserved_units::text,'acquisition',r.acquisition_snapshot,
 'policy',r.policy_snapshot,'resolution',case when r.resolution is null then null else jsonb_build_object('verification',r.resolution->>'verification','amountCentavos',r.resolution->>'amountCentavos','occurredAt',r.resolution->>'occurredAt') end,'serverNow',clock_timestamp())
$$;
create function public.get_refund_policy() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.require_commercial_user();
 return (select to_jsonb(p)||jsonb_build_object('requestsEnabled',s.financial_requests_enabled,'serverNow',clock_timestamp())
 from private.refund_settings s join public.refund_policies p on p.version=s.policy_version);
end $$;
create function public.get_refund_source(p_source_type text,p_source_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.cash_purchases; o public.commercial_orders; terms public.refund_contract_terms; origin timestamptz; snapshot jsonb; policy jsonb;
begin
 perform private.require_commercial_user();
 if p_source_type='purchase' then
  select * into p from public.cash_purchases where id=p_source_id and user_id=auth.uid();
  if not found then raise exception 'REFUND_SOURCE_NOT_FOUND'; end if;
  origin:=coalesce(p.credited_at,p.created_at);
  snapshot:=jsonb_build_object('type','purchase','id',p.id,'status',p.status,'paidCentavos',p.amount_centavos::text,'cashUnits',p.cash_amount::text,
   'reversedCentavos',p.reversed_centavos::text,
   'creditedUnits',coalesce((select sum(amount) from public.economy_transactions where user_id=auth.uid() and asset='cash' and direction='credit'),0)::text,
   'consumedUnits',coalesce((select sum(amount) from public.economy_transactions where user_id=auth.uid() and asset='cash' and direction='debit'),0)::text,
   'promotionalUnits','not_classifiable_from_current_ledger','purchaseLotBalance',null,
   'activeContractCount',(select count(*) from public.commercial_orders where payer_user_id=auth.uid() and status='fulfilled' and period_end>clock_timestamp()),
   'unitPriceCentavos',p.unit_price_centavos::text,'currency',p.currency,
   'provenance','untracked','manualReviewRequired',true);
  select * into terms from public.refund_contract_terms where purchase_id=p.id;
 elsif p_source_type='order' then
  select * into o from public.commercial_orders where id=p_source_id and payer_user_id=auth.uid() and status in('fulfilled','reversed');
  if not found then raise exception 'REFUND_SOURCE_NOT_FOUND'; end if;
  origin:=o.fulfilled_at;
  snapshot:=jsonb_build_object('type','order','id',o.id,'status',o.status,'cashUnits',o.total_cash::text,'offeringCode',o.offering_code,
  'periodStart',o.period_start,'periodEnd',o.period_end,'manualReviewRequired',true,'provenance','untracked');
  select * into terms from public.refund_contract_terms where order_id=o.id;
 else raise exception 'INVALID_REFUND_SOURCE'; end if;
 if terms.id is null then
  -- Historical source: conservative draft guidance, no invented old consent.
  select to_jsonb(x)||'{"historicalUnverified":true}'::jsonb into policy from public.refund_policies x join private.refund_settings s on s.policy_version=x.version;
 else policy:=terms.policy_snapshot; origin:=terms.origin_at; end if;
 return jsonb_build_object('acquisition',snapshot,'policy',policy,'originAt',origin,
  'deadlineAt',coalesce(terms.deadline_at,private.refund_deadline(origin,(policy->>'days')::integer)),
  'withdrawalOpen',clock_timestamp()<=coalesce(terms.deadline_at,private.refund_deadline(origin,(policy->>'days')::integer)),
  'requestsEnabled',(select financial_requests_enabled from private.refund_settings),'serverNow',clock_timestamp());
end $$;
create function public.create_refund_request(p_source_type text,p_source_id uuid,p_category text,p_explanation text,p_intent_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r public.refund_requests; source jsonb; available numeric; units bigint:=0; payload jsonb; t timestamptz:=clock_timestamp();
begin
 perform private.require_commercial_user();
 if p_intent_id is null or p_category is null or p_category not in('withdrawal','duplicate_payment','fraud','not_credited','service_failure','voluntary_cancellation','other')
 or p_explanation is null or length(p_explanation)>2000 or (p_category<>'withdrawal' and length(btrim(p_explanation))<5) then raise exception 'INVALID_REFUND_REQUEST'; end if;
 -- Matches the commercial engine user lock; purchase -> wallet follows reversals.
 perform 1 from public.users where id=auth.uid() for no key update;
 perform private.require_commercial_user();
 select * into r from public.refund_requests where requester_id=auth.uid() and intent_id=p_intent_id;
 if found then
  if (coalesce(r.purchase_id,r.order_id),r.category,r.explanation) is distinct from (p_source_id,p_category,btrim(p_explanation)) or (r.purchase_id is not null)<>(p_source_type='purchase') then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return private.refund_json(r);
 end if;
 source:=public.get_refund_source(p_source_type,p_source_id);
 -- A distinct click on an already-open case returns its existing protocol.
 select * into r from public.refund_requests where requester_id=auth.uid() and coalesce(purchase_id,order_id)=p_source_id and status not in('completed','rejected','canceled_by_requester');
 if found then return private.refund_json(r); end if;
 -- Unverified historical terms are never used to extinguish a legal claim.
 if p_category='withdrawal' then
  if not (source->>'requestsEnabled')::boolean then raise exception 'REFUND_REQUESTS_NOT_ENABLED'; end if;
  if t>(source->>'deadlineAt')::timestamptz and not coalesce((source->'policy'->>'historicalUnverified')::boolean,false) then raise exception 'WITHDRAWAL_WINDOW_CLOSED_USE_COMPLAINT'; end if;
 end if;
 if p_source_type='purchase' then
  perform 1 from public.cash_purchases where id=p_source_id for update;
  perform 1 from public.wallets where user_id=auth.uid() for update;
  source:=public.get_refund_source(p_source_type,p_source_id);
  select cash_balance-coalesce((select sum(reserved_units) from public.refund_requests where requester_id=auth.uid()),0) into available from public.wallets where user_id=auth.uid();
  -- Aggregate reservation only. NEVER asserts which purchase or promotion funded
  -- the remaining balance. Insufficient balance / untracked origin stays manual.
  if (source->>'requestsEnabled')::boolean and source->'acquisition'->>'status'='credited' and p_category in('withdrawal','duplicate_payment','fraud') then
   units:=least(greatest(coalesce(available,0),0),(source->'acquisition'->>'cashUnits')::numeric)::bigint;
  end if;
 end if;
 insert into public.refund_requests(requester_id,purchase_id,order_id,category,explanation,intent_id,acquisition_snapshot,policy_snapshot,origin_at,deadline_at,timely,reserved_units,created_at)
 values(auth.uid(),case when p_source_type='purchase' then p_source_id end,case when p_source_type='order' then p_source_id end,p_category,btrim(p_explanation),p_intent_id,
 source->'acquisition',source->'policy',(source->>'originAt')::timestamptz,(source->>'deadlineAt')::timestamptz,t<=(source->>'deadlineAt')::timestamptz,units,t) returning * into r;
 payload:=private.refund_json(r);
 insert into public.refund_request_events(request_id,actor_id,intent_id,action,message,input,result)
 values(r.id,auth.uid(),p_intent_id,'requested','Solicitação recebida. Protocolo registrado imediatamente.',source,payload);
 return payload;
end $$;
create function public.list_refund_requests(p_admin boolean default false,p_before bigint default null,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_commercial_user();
 if p_admin then perform private.require_evocash_admin(); end if;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'INVALID_PAGE'; end if;
 return (select coalesce(jsonb_agg(private.refund_json(x) order by x.sequence_id desc),'[]') from
 (select r.* from public.refund_requests r where (p_admin or requester_id=auth.uid()) and (p_before is null or sequence_id<p_before) order by sequence_id desc limit p_limit) x);
end $$;
create function public.get_refund_request(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.refund_requests; admin boolean;
begin
 perform private.require_commercial_user();
 admin:=coalesce(public.is_superadmin(),false);
 select * into r from public.refund_requests where id=p_id and (requester_id=auth.uid() or admin);
 if not found then raise exception 'REFUND_NOT_FOUND'; end if;
 return private.refund_json(r)||jsonb_build_object('explanation',r.explanation,'events',
 (select coalesce(jsonb_agg(jsonb_build_object('id',x.id::text,'action',x.action,'message',x.message,'createdAt',x.created_at,
 'evidence',case when admin then x.evidence else null end) order by x.id),'[]') from
 (select * from public.refund_request_events where request_id=r.id order by id desc limit 100) x),
 'eventHistoryLimited', (select count(*)>100 from public.refund_request_events where request_id=r.id));
end $$;
create function public.act_on_refund_request(p_id uuid,p_action text,p_message text,p_intent_id uuid,p_revision bigint,p_evidence jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r public.refund_requests; prior public.refund_request_events; payload jsonb; result jsonb; next_status text; admin boolean;
 p public.cash_purchases; o public.commercial_orders; reversal public.cash_purchase_reversals; balance numeric; other_holds bigint;
begin
 perform private.require_commercial_user();
 admin:=coalesce(public.is_superadmin(),false);
 if p_action in('comment','cancel','dispute') then null;
 else perform private.require_evocash_admin(true); end if;
 if p_intent_id is null or p_action is null or p_message is null or length(btrim(p_message)) not between 5 and 2000 or p_evidence is null or jsonb_typeof(p_evidence)<>'object' then raise exception 'INVALID_REFUND_ACTION'; end if;
 if not admin and p_evidence<>'{}'::jsonb then raise exception 'INVALID_REFUND_EVIDENCE'; end if;
 payload:=jsonb_build_object('id',p_id,'action',p_action,'message',btrim(p_message),'evidence',p_evidence);
 -- Existing commercial administration takes this lock before the user lock.
 if admin and p_action not in('comment','cancel','dispute') then
 perform pg_catalog.pg_advisory_xact_lock(83101,pg_catalog.hashtext(auth.uid()::text)); end if;
 -- Read identity first, lock user, source then request then wallet, always.
 select * into r from public.refund_requests where id=p_id and (requester_id=auth.uid() or admin);
 if not found then raise exception 'REFUND_NOT_FOUND'; end if;
 perform 1 from public.users where id=r.requester_id for no key update;
 if r.purchase_id is not null then
  select * into p from public.cash_purchases where id=r.purchase_id for update;
 else
  -- Commercial reversal locks resource before order. Use that same discipline.
  select * into o from public.commercial_orders where id=r.order_id;
  perform 1 from private.commercial_resources where id=o.resource_id for update;
  select * into o from public.commercial_orders where id=r.order_id for update;
 end if;
 select * into r from public.refund_requests where id=p_id for update;
 perform private.require_commercial_user();
 if p_action not in('comment','cancel','dispute') then perform private.require_evocash_admin(true); end if;
 select * into prior from public.refund_request_events where actor_id=auth.uid() and intent_id=p_intent_id;
 if found then
  if prior.input<>payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return prior.result;
 end if;
 if p_revision is distinct from r.revision then raise exception 'REFUND_REVISION_CONFLICT'; end if;
 next_status:=r.status;
 if p_action='reserve' and admin and r.purchase_id is not null and r.status in('requested','under_review','disputed') then
  if not (select financial_requests_enabled from private.refund_settings) then raise exception 'REFUND_REQUESTS_NOT_ENABLED'; end if;
  select cash_balance into balance from public.wallets where user_id=r.requester_id for update;
  select coalesce(sum(reserved_units),0) into other_holds from public.refund_requests where requester_id=r.requester_id and id<>r.id;
  if p.status<>'credited' or p.reversed_centavos<>0 then raise exception 'REFUND_SOURCE_CHANGED'; end if;
  update public.refund_requests set reserved_units=least(greatest(balance-other_holds,0),p.cash_amount),revision=revision+1 where id=r.id returning * into r;
 elsif p_action='investigate' and admin and r.status not in('completed','canceled_by_requester') then
  next_status:='disputed';
 elsif p_action='comment' then
  if r.status in('completed','canceled_by_requester') then raise exception 'REFUND_TRANSITION_DENIED'; end if;
 elsif p_action='cancel' then
  if r.requester_id<>auth.uid() or r.status not in('requested','needs_information','under_review') then raise exception 'REFUND_TRANSITION_DENIED'; end if;
  next_status:='canceled_by_requester';
 elsif p_action='dispute' then
  if r.requester_id<>auth.uid() or r.status not in('rejected','provider_refund_failed','needs_information') then raise exception 'REFUND_TRANSITION_DENIED'; end if;
  next_status:='disputed';
 elsif p_action='review' and r.status in('requested','needs_information','disputed','provider_refund_failed') then next_status:='under_review';
 elsif p_action='needs_information' and r.status in('requested','under_review','disputed') then next_status:='needs_information';
 elsif p_action='reject' and r.status in('requested','under_review','needs_information','disputed') then next_status:='rejected';
 elsif p_action='approve' and r.status='under_review' then
  if p_evidence->>'legalReview' is distinct from 'confirmed' or p_evidence->>'relatedContractsReview' is distinct from 'confirmed'
   or length(coalesce(p_evidence->>'basis',''))<10 or coalesce(p_evidence->>'partyClassification','') not in('individual','professional','company','undetermined') then raise exception 'LEGAL_AND_CONTRACT_REVIEW_REQUIRED'; end if;
  -- Approval is a documented decision; it neither pays nor credits.
  next_status:='approved';
 elsif p_action='provider_pending' and r.status in('approved','provider_refund_failed') and r.purchase_id is not null then next_status:='awaiting_provider_refund';
 elsif p_action='provider_failed' and r.status='awaiting_provider_refund' then next_status:='provider_refund_failed';
 elsif p_action='confirm_provider' and r.status='awaiting_provider_refund' then
  if not (select settlement_enabled from private.refund_settings) then raise exception 'REFUND_SETTLEMENT_NOT_ENABLED'; end if;
  if p_evidence->>'channel' is distinct from 'infinitepay_original_payment' or p_evidence->>'verification' is distinct from 'administrative_evidence_only'
   or length(coalesce(p_evidence->>'externalId','')) not between 1 and 128 or length(coalesce(p_evidence->>'reference','')) not between 5 and 200
   or p_evidence->>'transactionNsu' is distinct from p.provider_transaction_nsu or p.provider_transaction_nsu is null
   or p_evidence->>'currency' is distinct from 'BRL' or p.currency<>'BRL'
   or p_evidence->>'merchant' is distinct from (select expected_merchant from private.refund_settings)
   or nullif(p_evidence->>'merchant','') is null then raise exception 'INVALID_REFUND_EVIDENCE'; end if;
  if coalesce(p_evidence->>'amountCentavos','') !~ '^[0-9]{1,10}$' or (p_evidence->>'amountCentavos')::bigint<>p.amount_centavos-p.reversed_centavos
   or p.reversed_centavos<>0 then raise exception 'PARTIAL_OR_PREVIOUS_REVERSAL_REQUIRES_INVESTIGATION'; end if;
  if (p_evidence->>'occurredAt')::timestamptz>clock_timestamp() or (p_evidence->>'occurredAt')::timestamptz<p.created_at
   or p_evidence->>'occurredAt' is null then raise exception 'INVALID_REFUND_DATE'; end if;
  if exists(select 1 from public.refund_settlements where external_id=p_evidence->>'externalId')
   or exists(select 1 from public.cash_purchase_reversals where provider_event_id=p_evidence->>'externalId') then raise exception 'EXTERNAL_REFUND_ALREADY_RECORDED'; end if;
  next_status:='provider_refund_confirmed';
  update public.refund_requests set resolution=p_evidence,revision=revision+1 where id=r.id returning * into r;
 elsif p_action='complete' and r.status='provider_refund_confirmed' then
  if not (select settlement_enabled from private.refund_settings) then raise exception 'REFUND_SETTLEMENT_NOT_ENABLED'; end if;
  if p.reversed_centavos<>0 or p.status<>'credited' or p.user_id is distinct from r.requester_id then raise exception 'REFUND_SOURCE_CHANGED'; end if;
  select cash_balance into balance from public.wallets where user_id=r.requester_id for update;
  select coalesce(sum(reserved_units),0) into other_holds from public.refund_requests where requester_id=r.requester_id and id<>r.id;
  if r.reserved_units<>p.cash_amount or balance-other_holds<p.cash_amount or private.cash_debt(r.requester_id)>0 then raise exception 'CONSUMED_OR_UNRESERVED_CREDITS_REQUIRE_INVESTIGATION'; end if;
  -- Release only inside the SAME transaction as the official reversal. A failure
  -- rolls back release, reversal, ledger, settlement and completion together.
  update public.refund_requests set reserved_units=0,revision=revision+1 where id=r.id returning * into r;
  perform public.admin_record_cash_reversal(p.id,r.resolution->>'externalId','refund',p.amount_centavos,r.resolution->>'reference',left(btrim(p_message),500));
  select * into reversal from public.cash_purchase_reversals where provider_event_id=r.resolution->>'externalId';
  if reversal.recovered_units<>reversal.cash_units or reversal.purchase_id<>p.id then raise exception 'REFUND_RECOVERY_INCONSISTENT'; end if;
  insert into public.refund_settlements(request_id,reversal_id,external_id,evidence_reference,amount_centavos,occurred_at,verified_by,verification)
  values(r.id,reversal.id,r.resolution->>'externalId',r.resolution->>'reference',p.amount_centavos,(r.resolution->>'occurredAt')::timestamptz,auth.uid(),'administrative_evidence_only');
  next_status:='completed';
 elsif p_action='complete_service' and r.status='approved' and r.order_id is not null then
  if not (select settlement_enabled from private.refund_settings) then raise exception 'REFUND_SETTLEMENT_NOT_ENABLED'; end if;
  -- Existing service compensation atomically restores EvoCash, revokes the
  -- corresponding period and releases advertising inventory via existing triggers.
  -- Do not chain into BRL: untracked funding + concurrent cash claim is manual.
  if exists(select 1 from public.refund_requests where requester_id=r.requester_id and purchase_id is not null and status not in('rejected','canceled_by_requester')) then raise exception 'RELATED_CASH_REFUND_REQUIRES_INVESTIGATION'; end if;
  if o.status<>'fulfilled' then raise exception 'REFUND_SOURCE_CHANGED'; end if;
  perform public.admin_reverse_commercial_order(o.id,p_intent_id,left(btrim(p_message),500),true);
  insert into public.refund_settlements(request_id,order_id,evidence_reference,occurred_at,verified_by,verification)
  values(r.id,o.id,'commercial_refund:'||o.id,clock_timestamp(),auth.uid(),'existing_commercial_reversal');
  next_status:='completed';
 else raise exception 'REFUND_TRANSITION_DENIED'; end if;
 if next_status in('rejected','canceled_by_requester') then
  -- Investigation/review must never turn a proved external refund back into
  -- spendable credits, including after a status round trip.
  if r.resolution is not null then
   raise exception 'EXTERNAL_REFUND_REQUIRES_RECONCILIATION';
  end if;
  perform 1 from public.wallets where user_id=r.requester_id for update;
 end if;
 update public.refund_requests set status=next_status,reserved_units=case when next_status in('rejected','canceled_by_requester','completed') then 0 else reserved_units end,
 revision=revision+1 where id=r.id returning * into r;
 result:=private.refund_json(r);
 insert into public.refund_request_events(request_id,actor_id,intent_id,action,message,evidence,input,result)
 values(r.id,auth.uid(),p_intent_id,p_action,btrim(p_message),case when admin then p_evidence else '{}'::jsonb end,payload,result);
 return result;
end $$;
-- Existing generic notification pipeline. Payload contains only entity id/action
-- URL, never amounts, complaint text, evidence, card data or provider identifiers.
create function private.notify_refund_event() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.refund_requests;
begin
 select * into r from public.refund_requests where id=new.request_id;
 insert into public.notifications(recipient_id,type,entity_type,entity_id,action_url,metadata,dedupe_key)
 values(r.requester_id,'report_resolved','refund_request',r.id,'/evocash?solicitacoes=1&request='||r.id,'{}','refund-event:'||new.id);
 perform private.notify_superadmins('admin_appeal','normal','refund_request',r.id,'/admin/compras-evocash?tab=refunds',
 '{}','refund-admin:'||new.id,new.actor_id);
 return new;
end $$;
create trigger refund_event_notification after insert on public.refund_request_events for each row execute function private.notify_refund_event();
-- Keep pending claims / retained funds out of the normal destructive account
-- deletion path; existing financial-case separation needs operator review first.
create function private.prevent_refund_identity_loss() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.refund_requests where requester_id=old.id) then raise exception 'REFUND_HISTORY_REQUIRES_RETENTION_REVIEW'; end if;
 return old;
end $$;
create trigger refund_identity_retention before delete on public.users for each row execute function private.prevent_refund_identity_loss();
-- RLS + zero direct table grants. All projections and mutations use guards.
do $$declare n text; f record;begin
 foreach n in array array['refund_policies','refund_contract_terms','refund_requests','refund_request_events','refund_settlements'] loop
  execute format('alter table public.%I enable row level security',n);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
 end loop;
 revoke all on private.refund_settings from public,anon,authenticated,service_role;
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='private' and p.proname in('refund_deadline','capture_refund_terms','protect_refund_request','enforce_refund_hold','refund_json','notify_refund_event','prevent_refund_identity_loss'))
 or (n.nspname='public' and p.proname in('get_refund_policy','get_refund_source','create_refund_request','list_refund_requests','get_refund_request','act_on_refund_request')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
 end loop;
end $$;
revoke all on sequence public.refund_requests_sequence_id_seq,public.refund_request_events_id_seq from public,anon,authenticated,service_role;
grant execute on function public.get_refund_policy(),public.get_refund_source(text,uuid),public.create_refund_request(text,uuid,text,text,uuid),
 public.list_refund_requests(boolean,bigint,integer),public.get_refund_request(uuid),public.act_on_refund_request(uuid,text,text,uuid,bigint,jsonb) to authenticated;

notify pgrst,'reload schema';
