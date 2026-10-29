# Instalação técnica do backend — 2026-10-28

PR #87 integrado em `a22f2ecf74fbfb8d1a5145c5ef4d53c4c654a952`, após aprovação e CI verde. Republicação de autoria solicitada pelo proprietário para permitir o deployment Vercel, sem reescrever histórico nem modificar o código da aplicação.

- Acesso por psql/Session Pooler oficial com SSL; auditoria inicial exclusivamente READ ONLY. Nenhum login temporário criado/rotacionado. A role antiga cli_login_postgres encontrada já estava expirada.
- Registro real comparado: 176 versões conhecidas e 29 pendentes, sem versões desconhecidas ou colisões de tabelas. Snapshot privado do schema anterior: SHA256 `18b53829c0683d55c015466660644f8176a811e87a6039af603f12a294bf0a03`.
- As 29 migrations do manifesto foram aplicadas em ordem, atomicamente, com hash conferido, registro efetivo e guards antes do COMMIT. Produção contém 205 migrations, última `20261206000002`.
- Hashes e contagens das colunas anteriores preservados nas dez tabelas financeiras/editoriais verificadas: carteiras, ledger, compras, produtos, perfis/rascunhos/publicações, anúncios, promoções e comunidades. Foram preservadas seis carteiras, 178 lançamentos e 26 compras; nenhuma movimentação financeira foi criada pela implantação.
- Compras/cotações EvoCash e vendas comerciais desligadas; nenhum preço novo, pedido comercial ou direito concedido. Coleta publicitária antiga encontrada ligada foi explicitamente desligada antes da instalação.
- Sete Edge Functions atualizadas via Management API: infinitepay-create-checkout, infinitepay-check-payment, infinitepay-webhook, infinitepay-admin-reconcile, send-cash-purchase-reminder-emails, storefront-media e storefront-media-cleanup. Regras JWT mantidas por função.
- Primeiro deployment automático da revisão integrada foi bloqueado pela Vercel por identidade do autor. A republicação usa Danielalveslira conforme autorização, preservando os gates obrigatórios do GitHub.

Este registro comprova a instalação do backend; publicação do frontend, SHA final e verificações efetivas de produção devem ser consultados no deployment Vercel e no relatório final da execução. Não constitui homologação InfinitePay, aprovação de tarifas ou autorização de ativação comercial. Não foi exigido backup completo de dados de teste pelo proprietário; snapshot do schema e configurações anteriores foram preservados privadamente. Recuperação deve manter ledger/pedidos e usar correções aditivas, nunca rollback destrutivo.
