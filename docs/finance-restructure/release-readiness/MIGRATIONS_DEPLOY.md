# Migrations e implantação

205 arquivos SQL locais; 176 na origin/main 5b50b26; 29 adicionais. Manifesto completo com SHA256 em evidence/migrations-manifest.json. 203 históricos da Fase 6 preservados, mais 20261206000001 (consolidação) e 20261206000002 (contrato de sessão). Nenhuma migration histórica reescrita. Instalação limpa local das 205 e 88 suítes/3.790 asserções passaram; CI remoto também aprovou SQL/Edge/concorrência.

Produção reportou 176 registros e máximo 20261127000001, mas não foi obtida lista integral: a sequência abaixo é candidata relativa à main, NÃO uma autorização nem prova de que todo arquivo é inédito no destino. Não aplicar antes de comparar registry, schema e dados. Não executar repair de registry nem reescrever versões aplicadas.

## Ordem candidata (nome e SHA256)

1. `20261128000001_evocash_pricing.sql` — `045cc410d832fae26e586e1665c1173f1b18ae2d75f10c591958e064fdc45793`
2. `20261129000001_evocash_quantity_checkout.sql` — `344148010f3bc964b552e83a61a7d176e0e08d3a60875a5bc27c7bb90d41f747`
3. `20261130000001_commercial_engine.sql` — `4ba6285d790361f8ee6cbb434d31885c4ef59c78727b0c138bc01a9cdaaa59a5`
4. `20261201000001_product_storefronts.sql` — `1c11cdc73036b6b0c54e0ea78be1d8eb7e186264baa03d08cf9a8ddccc482a30`
5. `20261202000001_storefront_editorial_revisions.sql` — `10e605aaee1c6281cc923679b787558bfbd0f1b9c0d1485c025725f0d2ca5926`
6. `20261202000002_storefront_media_maintenance_legacy.sql` — `4266071a0844f3a8dc33f5a03b88d5a0a40c781608405851a5ecdccee5881e04`
7. `20261203000001_professional_commercial_publication.sql` — `c31c7007e84e43a0d56fa8fb415be57d3d5b89b8dfa430cda0d16f856424b9cd`
8. `20261204000001_multiple_professional_listings.sql` — `cfa324a9a3008642db1f075a580057d739a9a08ee489567d422926ee9d05d3e4`
9. `20261204000002_admin_account_listing_summary.sql` — `50d3fd69e3c95041f32696c6a9a1e4d17916de56e672048baef1b62af8dc87f6`
10. `20261205000001_advertising_inventory.sql` — `d8007bd067c0f389b3cf052440e1ec76facf14ee46cddb9e6f52a14453082dcd`
11. `20261205000002_advertising_campaigns.sql` — `3d85f73f5db7e4bfbe30782d117783f0dfc78cdf8412191729ee795de6cb7ea9`
12. `20261205000003_advertising_authorization_metrics.sql` — `ca985a5ed35c5988fe2d245809a666c13f5724c475adbea2b27c439393a97b56`
13. `20261205000004_advertising_delivery.sql` — `1f1e549dc5ccb72edd39d199609bf2e6709f854735a2512e0eceb66b98807205`
14. `20261205000005_commercial_promotions.sql` — `a611fce33ee0b9fc1fdad0b3c3590a0fc34a5b4c07a902760120bfc22b347bbf`
15. `20261205000006_advertising_operations.sql` — `af4a1dc0bb8d744e2c99282213013cf18015df9b9d37b0f22a63961ea7241c5d`
16. `20261205000007_advertising_media.sql` — `217ff8cc0dfe0609e2c5b7d8cbfe70b8f55e50160459bf20138ee132df39dc41`
17. `20261205000008_advertising_lock_order.sql` — `20d8bb3e65f4bc6bbaf53f1f550b7fe8078041346074af6e0379c9827bd0e2ae`
18. `20261205000009_advertising_editorial_history.sql` — `b7dbd8ada92a58b14d62851ade08b6f83e14a9c9f02f8530f319c7b13ee63dee`
19. `20261205000010_advertising_selection.sql` — `d84d606984d52cb6d16ce4e27ed64d4497f3c298d13cb2bdc666fb72064ae1e1`
20. `20261205000011_advertising_legacy_expiry_index.sql` — `5559ee4393eb2211032b58b7e9b7c68bc3f7c2df3e53668386308a382fff1e8d`
21. `20261205000012_advertising_summary.sql` — `440623c5b433f598e4c169412377d246a450a36abd5623ffdc5b614b56663664`
22. `20261205000013_advertising_rls_gate.sql` — `48557005e523b5e9935b5636f2c653b2f5b9f7ffe4d20178fa322e12e95c81bb`
23. `20261205000014_community_promotion_projection.sql` — `19220e2d53e725219dfd4b2ddea9f4e3711c898b26395ad9e0ab89a9610935f8`
24. `20261205000015_advertising_source_invalidation.sql` — `e5020f9e6e9a1a9e200b11371763673c6ad2ee8f45879f864796d28ec10ec476`
25. `20261205000016_advertising_deleted_owner.sql` — `b64b0062da821ec042a5175f0f9e0ef8cc671b5dc0103e539f0e28f68fa2bcbf`
26. `20261205000017_advertising_batch_authorization.sql` — `374856c096b516ae41c3b48779cb382727671670e44f0735524751754e419064`
27. `20261205000018_advertising_context_audit.sql` — `334aca2e60a0ad1c9377561a391f772e76850c6bb1dfc8a458c531f308d14935`
28. `20261206000001_finance_consolidation_guards.sql` — `a7ed4f4763f7b2c8a68e525c2ecf8d5a906e5f9355a4827f406c13d386dc263d`
29. `20261206000002_finance_integration_session_contract.sql` — `399e6033c2800658f1d13ac7f22cca8accea720d20b5b6d428de357f36b8d491`

## Procedimento condicionado

Precondições: auditoria completa, Auth/Storage disponíveis, proprietário dos schemas/extension e grants conhecidos, backup/restauração comprovados, gates fechados e autorização específica. Usar exatamente artefatos revisados pelo hash; comparar a origem real antes de definir delta. Validar ordem em cópia isolada do baseline real com dados legítimos protegidos, além da instalação limpa já realizada.

Separar migrations transacionais e qualquer instrução que exija operação fora de transação após revisar cada arquivo; não envolver cegamente o lote inteiro em uma transação. Medir locks e duração em clone. Capturar exit code e parar na primeira falha, sem avanço de registro manual. Confirmar schema, grants/RLS, RPCs, índices, invariantes e gates por lote. Não chamar RPC de compra/contratação para validar produção. Mudança de contrato exige janela backend/frontend coordenada conforme PLANO_IMPLANTACAO.md.

Após falha, preservar estado e logs redigidos; inspecionar aplicação parcial e dependências antes de retomar. Corrigir aditivamente quando possível; não executar down destrutivo ou apagar ledger/pedidos/dados editoriais. Publicar Edge Functions dependentes somente quando contratos requeridos existirem; frontend depende de ambos. Detalhamento final do delta e cronograma permanece bloqueado pelo inventário de produção incompleto.
