// Fixtures sintéticas para os scripts de concorrência (banco descartável allowlisted).
// Desde 20261212000002, confirmar um pedido ou reservar checkout de EvoCash exige o aceite
// da versão publicada do documento comercial aplicável. Estes trechos publicam documentos
// SINTÉTICOS de teste e reproduzem exatamente a chamada feita pelo app.
const DOCUMENTS = ['advertising-terms', 'showcase-publication-terms', 'evocash-terms']

export const SYNTHETIC_COMMERCIAL_TERMS_SQL = `do $fixture$ declare d text; begin
foreach d in array array[${DOCUMENTS.map((d) => `'${d}'`).join(',')}] loop
  perform private.publish_legal_document(jsonb_build_object('documentId', d, 'version', '0.0.1',
    'approved', true, 'title', 'Fixture sintética de teste (' || d || ')', 'sections', '[]'::jsonb));
end loop;
insert into private.commercial_offering_documents(offering_code, document_id)
  select code, 'advertising-terms' from public.commercial_offerings on conflict (offering_code) do nothing;
end $fixture$`

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`

// Mesmo fluxo da interface: lê os termos congelados na cotação e confirma com eles.
export const confirmWithTermsSql = (orderId) =>
  `select public.confirm_commercial_order_with_terms(${literal(orderId)},t->>'version',t->>'digest',t->>'conditionsDigest') from (select public.get_my_commercial_terms('order',${literal(orderId)}) t) s`

export const acceptCashQuoteTermsSql = (quoteId) =>
  `select public.accept_commercial_terms('evocash_quote',${literal(quoteId)},t->>'version',t->>'digest',t->>'conditionsDigest') from (select public.get_my_commercial_terms('evocash_quote',${literal(quoteId)}) t) s`
