# Versionar preços e cotações de EvoCash com publicação administrativa auditada

A configuração atual oferece somente pacotes e não possui publicação de preço por unidade com histórico imutável. Esta Fase 1 adiciona versões, cotação calculada no servidor, gate inicialmente pausado e abas de Precificação/Histórico na administração existente, mantendo saldos e pedidos intactos e sem abrir um checkout.

Publicação/pausa usam sessão ativa, autenticação recente, revisão/lock, idempotência e auditoria atômica. Mudanças de grande impacto exigem confirmação adicional conforme a política anterior. Nenhum preço comercial é semeado e nenhuma camada de compatibilidade para clientes inexistentes foi adicionada.

Validação local: 57 asserções pgTAP; corridas reais de publicação/cotação; quatro arquivos JS afetados; lint e build; browser com Auth/PostgREST/Postgres reais e seis combinações de viewport/tema. O teste de concorrência entra no job SQL obrigatório. Evidências, limites e rollout/rollback em `docs/finance-restructure/phase1/ENTREGA.md`.

Sem push, merge ou deploy nesta entrega. A compra em `/evocash` pertence à Fase 2.
