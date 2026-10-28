# Fase 5 — matriz de segurança

Somente usuários, mídia, tarifas e saldos sintéticos em banco/Storage locais. Testes SQL revertem as transações; os testes de concorrência usam conexões independentes e registros próprios. Evidências não contêm tokens de sessão.

| Cenário obrigatório | Verificação e evidência |
|---|---|
| 1. Profissional acessa outro profissional | `professional_commercial_test.sql`: edição de terceiro negada; HTTP real em `http-seo-security.json` |
| 2. Empreendedor altera estabelecimento alheio | Mesma propriedade concreta para ambos os tipos; HTTP real nos dois adaptadores |
| 3. Manipulação de propriedade | Identidade imutável, FKs compostas, whitelist; teste SQL e payload HTTP negado |
| 4. Oferta errada | Código gerado por kind, FK da âncora, tarifas independentes; teste SQL específico |
| 5. Cotação adulterada | Regressão `commercial_engine_test.sql`: valores calculados/validados no banco, confirmação recebe ID |
| 6. Saldo insuficiente | Teste específico de perfil: confirmação negada, saldo preservado; regressões financeiras |
| 7. Contratações simultâneas | `concurrency.json` e regressão de vitrines: conexões independentes e carteira serializada |
| 8. Double-click | Browser real e seis reenvios concorrentes por pedido: um débito |
| 9. Sessão revogada | `session_revocation_guard_test.sql`, `admin_vitrines_denuncias_test.sql`, engine/pricing |
| 10. Conta bloqueada | Perfil com restrição não aparece e getter privado nega; `aud_has_app_access_gates_test.sql` |
| 11. Preço muda durante contratação | Regressão de preços/motor: cotação versionada e guardas preservados |
| 12. Expira com página aberta | Diretório no browser e detalhe nos dois tipos em `detail-browser.json` |
| 13. URL direta vencida | API retorna null e HTTP 404/noindex sem nome antigo; `http-seo-security.json` |
| 14. Mídia vencida | Gateway real retorna 404; SQL nega autorização |
| 15. Edição durante publicação paga | Browser e SQL preservam nome/imagem aprovados, saldo e duração |
| 16. Reprovação mantém aprovado | Browser e SQL mantêm snapshot anterior, sem débito |
| 17. Suspensão durante contratação | Corrida em ambos os adaptadores: suspensão adquire lock e confirmação falha |
| 18. Aprovação concorrente | Uma decisão vence por revisão; a outra recebe conflito, nos dois tipos |
| 19. Renovação simultânea | Reenvio do mesmo pedido não duplica; pedidos independentes somam duração, um entitlement |
| 20. Upload não autorizado | Edge HTTP real retorna 403 para outra conta; `upload-failure.json` |
| 21. Exclusão de mídia referenciada | FK, referência pública/rascunho e coletor; `professional_commercial_test.sql`, `media-http.json` |
| 22. Revisão privada exposta | Tabelas negadas e getters públicos só snapshot; marcador privado ausente do HTML/SEO |
| 23. Dados administrativos | Endpoint admin negado a terceiro, tabelas sem grants; projeções omitem proprietário/email interno/saldo |
| 24. Pagamento reativa suspenso | Teste SQL e corrida: confirmação não remove bloqueio, saldo permanece |
| 25. Bypass por view/RPC | Allowlist de SECURITY DEFINER, grants privados negados e endpoints antigos fechados; SQL/RLS/notification/security suites |

O sitemap revalida produtos e perfis ao final de todo IO; teste adicional em `evidence/sitemap-final-regression.log`.

`evidence/sql-summary.json` lista todas as suítes e contagens. `evidence/concurrency.json` cobre profissional e estabelecimento; `evidence/storefront/concurrency.json` cobre a regressão da Fase 4.1. Browser e HTTP atravessam autenticação, PostgREST, banco e gateway/Storage reais locais. Preço adulterado, reversões e sessão também reutilizam as suítes do motor financeiro: não se criou outra implementação para repetir tais garantias.

A limpeza real removeu órfãos alocados e finalizados sem associação, preservando mídia referenciada e repetição segura. A corrida de associação/limpeza foi executada nos dois tipos. Falha real de rede no upload não salvou nova associação, não perdeu a imagem aprovada e não informou sucesso.

A matriz não afirma teste de infraestrutura de produção, CDN regional ou CI remoto. Um navegador que já recebeu bytes não permite revogação retroativa desses bytes; a expiração limpa a apresentação aberta e novas consultas são sempre autorizadas no servidor.
