# Fase 6 — auditoria da base

Base verificada: `finance-profiles-phase5-1`, `8cc0f26f859996e3ff129e3d561cd0cb84f153a5`. Worktree original preservado. `git fsck --connectivity-only` sem objetos corrompidos (objetos dangling preexistentes). Desenvolvimento na branch `finance-advertising-phase6`.

Planejamento mestre lido integralmente. Consultados checklist, correções finais 5.1 e entrega do motor da Fase 3; evidências históricas não equivalem a uma nova execução.

| Implementação real | Reutilização / divergência |
| --- | --- |
| `sponsored_ads` | Conteúdo e componentes reais, CRUD direto superadmin. Sem revisão editorial nem vínculo a direito comercial. RLS original permite leitura de globais sem validade. |
| `enforce_sponsored_ad_caps` | Teto fixo 6 conta inclusive vencidos; não é reserva por intervalo nem serializa disputas. Não serve para cobrança autônoma. |
| `advertiser_accounts`, `advertiser_members` | Identidade comercial já existe, membro somente viewer; não inferir que `created_by` histórico concede propriedade financeira. |
| `advertiser_campaigns` | Atribuição histórica imutável por ad_id; reutilizar nos relatórios, sem segundo dashboard. |
| `sponsored_ad_daily_stats`, `record_ad_events` | Ingestão em lotes, limites, deduplicação e agregados existentes; eligibility antiga usa apenas campos do anúncio, requer vínculo adicional ao contrato. |
| `useAdMetrics`, SponsoredAdBanner/Card | Medição de visibilidade e clique e identificação Patrocinado já existentes. Banner Home já integrado à Home; preservar hierarquia. |
| `useSponsoredAds`, `useGlobalSponsoredAds` | Cache compartilhado e expiração local; suspensão requer autorização renovada/invalidação efetiva, cache atual não prova bloqueio imediato. |
| `promotions`, `create_promotion`, promotionsService | Pacotes de economy_config e débito próprio antigo. Posts/comunidades não podem migrar só mudando componente visual; consumidores e direitos históricos devem ser preservados. |
| `commercial_offerings`, preços, orders, entitlements | Oito ofertas existentes, três de anúncios e duas de boost. Cotação de 5 minutos e preços congelados. Sem capacidade. |
| `private.commercial_resources` | Âncora de propriedade individual. Mantém carteira pessoal; papéis de equipe não autorizam gastar saldo alheio. |
| `confirm_commercial_order` | Reutilizar integralmente débito/ledger/renovação; integrar reserva na mesma transação, sem segunda carteira ou cobrança. |
| Fases 4–5.1 | Snapshots e mídia protegida já resolvidos para vitrines/perfis; adaptar somente após verificar FKs e ofertas suportadas. |

Decisões externas continuam bloqueantes no checklist consolidado. Nenhum preço ou capacidade comercial oficial autorizado; configurações novas devem começar indisponíveis. Nenhum ambiente remoto foi consultado ou alterado.
