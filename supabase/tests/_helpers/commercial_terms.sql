-- Test fixtures only. Never a migration, RPC or production installation.
-- Desde 20261212000002, confirmar um pedido ou reservar um checkout de EvoCash exige o
-- aceite explícito da versão publicada do documento comercial aplicável. Estas funções
-- publicam documentos SINTÉTICOS (dentro da transação do teste, desfeita no rollback) e
-- registram o aceite pelo mesmo RPC usado pelo app antes de chamar as RPCs reais.

-- Publica documentos sintéticos aprovados e mapeia ofertas sintéticas criadas pelo teste.
create or replace function pg_temp.publish_test_commercial_terms()
returns void language plpgsql security definer set search_path = '' as $$
declare d text;
begin
  foreach d in array array['advertising-terms','showcase-publication-terms','evocash-terms'] loop
    perform private.publish_legal_document(jsonb_build_object(
      'documentId', d, 'version', '0.0.1', 'approved', true,
      'title', 'Fixture sintética de teste (' || d || ')', 'sections', '[]'::jsonb));
  end loop;
  insert into private.commercial_offering_documents(offering_code, document_id)
    select code, 'advertising-terms' from public.commercial_offerings
    on conflict (offering_code) do nothing;
end $$;

-- Aceita os termos congelados na cotação (quando houver) e chama a RPC real de confirmação.
-- Falhas do aceite são ignoradas de propósito: a confirmação devolve então o erro canônico
-- (ORDER_NOT_FOUND, QUOTE_EXPIRED, COMMERCIAL_TERMS_ACCEPTANCE_REQUIRED...).
create or replace function pg_temp.confirm_with_terms(p_order_id uuid, p_confirm boolean)
returns jsonb language plpgsql as $$
declare t jsonb;
begin
  if p_confirm is true then
    begin
      t := public.get_my_commercial_terms('order', p_order_id);
      perform public.accept_commercial_terms('order', p_order_id, t->>'version', t->>'digest', t->>'conditionsDigest');
    exception when others then null;
    end;
  end if;
  return public.confirm_commercial_order(p_order_id, p_confirm);
end $$;

create or replace function pg_temp.accept_cash_quote_terms(p_quote_id uuid)
returns void language plpgsql as $$
declare t jsonb;
begin
  begin
    t := public.get_my_commercial_terms('evocash_quote', p_quote_id);
    perform public.accept_commercial_terms('evocash_quote', p_quote_id, t->>'version', t->>'digest', t->>'conditionsDigest');
  exception when others then null;
  end;
end $$;

create or replace function pg_temp.reserve_with_terms(p_quote_id uuid, p_request_id uuid)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.accept_cash_quote_terms(p_quote_id);
  return public.reserve_infinitepay_cash_purchase(p_quote_id, p_request_id);
end $$;
