# Substitui compra por pacotes por cotação de quantidade EvoCash

`/evocash` passa a aceitar quantidade personalizada e confirmar exclusivamente a cotação versionada do backend. O único checkout InfinitePay existente reserva limites atomicamente, persiste o pedido e só credita após verificação do provedor. Remove seleção/configuração/RPC antigos de pacotes e preserva carteira, ledger, histórico, conciliação e reversões compartilhados.

Migration: `20261129000001_evocash_quantity_checkout.sql`. Checkout desativado por padrão, sem preço seed. Backend e frontend precisam ser coordenados pela mudança de assinatura da reserva.

Validação local: 432 asserções pgTAP, concorrência, oito cenários HTTP, testes JS afetados, build/lint e browser responsivo claro/escuro. InfinitePay simulada; validação real e CI remoto pendentes. Sem push, deploy ou produção. Detalhes e riscos em `ENTREGA.md`.
