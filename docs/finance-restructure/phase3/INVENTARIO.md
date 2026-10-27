# Fase 3 — inventário e sequência

Base: `finance-quantity-phase2`, commit `48ea165`. Worktree original preservado. Planejamento mestre e relatórios das fases 0–2 consultados.

Reutilizar `_wallet_debit_cash` (inclui recuperação de dívida e lock da carteira), `_wallet_credit_cash`, `_ledger_record`, `has_app_access`, conta ativa e `private.require_evocash_admin` (superadmin + AMR recente). Não modificar esses contratos compartilhados ou InfinitePay. Preços e centavos de aquisição permanecem independentes de tarifas comerciais.

Não existe catálogo de serviços/pedidos/direitos central. `commercial_leads` são propostas de contato, `partner_products` são conteúdo editorial. `promotions`/`promotionPackages` têm consumidores ativos; sua migração pertence à Fase 6. `advertiser_members.permission` só admite viewer; não concede autorização para debitar outra carteira. Não criar conta/carteira empresarial nesta fase.

Migration prevista `20261130000001_commercial_engine.sql`: catálogo desativado sem preços, versões imutáveis, pedidos cotados/finalizados, eventos append-only, direitos e vínculo interno de recursos. O vínculo não aceita IDs genéricos de conteúdo: é uma entidade própria com FK de proprietário, inacessível a escrita pelo cliente; módulos futuros deverão referenciá-la por FK e atualizar aprovação/revisão atomicamente por adapter privado. Nenhum módulo real fica habilitado nesta fase. Fixtures criam recursos sintéticos reais nesse vínculo, apenas em stack isolada.

Sequência: schema e RPCs → testes de integridade/concorrência → aba do motor no painel atual de anúncios → preview isolado → evidências e entrega. Contratação será uma única transação que revalida sessão/recurso/moderação, debita carteira e registra ledger/pedido/direito. Expiração será predicado SQL com relógio do banco, independente de cron. Suspensão de vendas não revoga direitos. Renovação usa o mesmo recurso e serializa sua vigência.

Limpeza: nenhum consumidor ativo de promoções, relatórios, conciliação ou carteira será removido. Remover apenas duplicações introduzidas ou comprovadamente órfãs. Migrations anteriores permanecem intactas.
