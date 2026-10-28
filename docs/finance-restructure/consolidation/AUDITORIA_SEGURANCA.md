# Auditoria integrada de segurança

Escopo: código da base 5571e5c, catálogo efetivo dos bancos descartáveis, migrations e testes executados nesta consolidação. Não constitui pentest de infraestrutura hospedada ou homologação real InfinitePay.

## Achados corrigidos

| Achado | Correção | Evidência |
| --- | --- | --- |
| Resposta antiga alterava o estado dos destaques antes da validação do hook | Commit diferido e protegido por geração, montagem e prazo | `advertisingRecovery.test.js`, `affected-final.log` |
| Segunda consulta de destaques podia sobrescrever autorização recente | Efeito redundante removido em Communities | Diff e testes de hooks/acesso |
| Perda do Realtime impedia qualquer revalidação até reconectar | Consultas backend com até três leases curtas, esgotamento fechado | `live-browser.json`, teste com serviço local efetivamente parado |
| Drift de constraints/default/grant | Migration aditiva, validação e privilégio mínimo | `schema-comparison.json`, SQL final |
| CI financeiro apontava concorrência para container de outro job | `finance-e2e` passa seu próprio `evolutus_integrated_db` | Diff de workflow; remoto pendente |
| História de migrations sem gate explícito de imutabilidade | Manifesto SHA-256, scanner de versões e testes de adulteração | `migration-integrity*.log` |
| Harnesses presumiam inexistência de política legal/contas/campanhas anteriores | Fixtures satisfazem o gate atual, nomes únicos, capacidade não reduzida | HTTP, browser e concorrência; checks reais preservados |
| Wrapper local usava backend HTTP recusado pelo contrato seguro de checkout | Alias HTTPS sintético redirecionado exclusivamente para loopback pelo mock existente | Oito cenários HTTP; código de produção InfinitePay intacto |
| Painel local podia mostrar contagens sintéticas sem aviso geral | Aviso DEV explícito no portal de publicidade | Verificação visual focada do preview |

## PostgreSQL e integridade

`consolidation-readonly.sql` executa transação read-only com timeout; retorna somente contagens e metadados. O harness falha com exit code de erro se faltar resultado ou houver divergência financeira/permissão proibida. A comparação de schema também falha em diferenças; não basta o SQL terminar com sucesso.

A execução confirmou zero: saldo divergente do ledger, saldo negativo, chave natural duplicada, débito comercial duplicado, pedido cumprido sem débito, reversão comercial sem crédito, ledger comercial órfão, compra creditada sem ledger e direito habilitado sem pedido cumprido. Grants de UPDATE na carteira para authenticated/service_role e EXECUTE direto de crédito para authenticated estão negados; coleta de métricas está falsa.

Nenhuma tabela pública dos domínios financeiros/comerciais auditados estava sem RLS; nenhum SECURITY DEFINER de public/private estava sem search_path fixo; nenhum índice equivalente duplicado foi encontrado. Isso não significa que a simples existência de search_path comprova segurança: os checks de conta/sessão/propriedade, grants e cenários abaixo completam a análise.

Helpers privados ainda executáveis por authenticated foram inventariados no JSON. São predicates usados por RLS/projeções (e trigger/helper legado), não APIs financeiras públicas. Não foram revogados em massa, pois isso quebraria políticas legítimas. Schema privado não é endpoint REST público. Primitivas monetárias e concessão comercial não foram abertas a clientes.

O catálogo de mutadores EvoCash inclui primitivas de carteira, recuperação privada de dívida, confirmação InfinitePay, revisão de compra retida, reversão comercial e cancelamento de exclusão com restauração auditada; criação/upgrade de comunidade preservam seus contratos existentes. A recuperação de dívida escreve sob o mesmo lock e registra ledger, compondo o mecanismo da carteira. Nenhum desses caminhos é uma segunda carteira ou API livre de saldo. Substituir seu UPDATE pelo helper de débito causaria recursão; foi preservado conscientemente.

## Matriz adversarial reexecutada

| Cenário | Prova atual |
| --- | --- |
| Compra repetida, pagamento falso, webhook repetido, preço alterado | pgTAP de preços/InfinitePay; HTTP: 12 entregas, crédito único, valor exato; Edge valida identidade/valor/provedor |
| Saldo insuficiente, gastos concorrentes, direito sem débito | `commercial_engine_test`, integridade, concorrência de motor/vitrines/múltiplos recursos |
| Contrato de outro proprietário/tipo e renovação duplicada | pgTAP comercial/profissional/vitrines e replays concorrentes |
| Capacidade, renovação sem vaga e pacote global parcial | Concorrência publicitária: última vaga, redução comprometida, multi-posições atômicas |
| Suspensão durante contratação e não removida por pagamento | Corridas publicitária, vitrine e múltiplos recursos |
| Anúncio expirado/cache/resposta antiga | SQL, deadlines monotônicos, testes novos de geração/commit, lifecycle e queda real do canal |
| Métricas manipuladas/entre contas/próprias | Suítes de ingestão, privacidade, V2 e dashboard; lifecycle de deduplicação |
| Mídia de terceiros ou pendente | pgTAP editorial/mídia e lifecycle com gateway/upload reais locais |
| Revisão pendente exposta/aprovação concorrente | SQL de revisões e corridas de edição/aprovação/associação de mídia |
| Conta bloqueada e sessão revogada | Suítes RLS/acesso, HTTP com segunda sessão invalidando a primeira |
| Reversão repetida/inconsistente | pgTAP de reversões/integridade e motor comercial |

Referências: `evidence/sql-summary.json`, logs de concorrência, `http.log`, `edge.log`, `lifecycle.json`, `live-browser.json`. Não há afirmação de testes remotos.

## Métricas e privacidade

Coletor existente: impressão com pelo menos 50% visível por um segundo contínuo; clique separado; batch limitado, UUID/dedup, limites de frequência e autorização no servidor. Membros da própria campanha são excluídos; painel consulta agregados diários com filtros autorizados por conta e janela limitada, sem varrer eventos brutos por render. Não há CPC/CPM, conversão inventada, cookies de terceiros ou escrita direta de agregado pelo anunciante.

O job existente de limpeza de marcas permanece, sem inventar retenção jurídica. Coleta nasce desligada e terminou desligada na base sintética. Eventos sintéticos usados no teste ficam no ambiente descartável e identificados no preview/relatórios. Uma decisão sobre finalidade/base legal/consentimento aplicável e retenção continua bloqueante antes de rastreamento real.

## Storage, público e rede

Bucket comercial privado, autorização por recurso e FK composta, bytes WebP/dimensões validados, gateway no-store revalida após IO; sem URL assinada longa. Leases e referências editoriais/históricas impedem coleta de imagem aprovada durante edição. Suspensão/expiração e imagens pendentes são negadas pelo servidor. Mantidos gateway/coletor, sem outro upload.

HTML, canonical, metadados, sitemap e bootstrap passam pelas mesmas projeções autorizadas. As 18 regressões HTTP/SEO passaram, incluindo vencimento durante IO e rechecagem de páginas do sitemap. Cache/service worker não vira autoridade comercial. Falha backend não deve retornar snapshot privado antigo.

Respostas financeiras não recebem retry automático; URL HTTPS e validação servidor prevalecem. O mock local intercepta explicitamente InfinitePay e bloqueia rede externa; isso não homologa credenciais, webhook ou comportamento real do provedor.

## Limites e operação

Eventos de indisponibilidade da página são diagnósticos limitados, não telemetria durável nem cálculo de ressarcimento. Sem impressões não se prova downtime. Precisa-se validar monitoramento/coleta operacional, Realtime hospedado, CDN/Storage, rate limits de infraestrutura e secrets no destino autorizado. Nenhuma falha crítica conhecida de integridade/autorização/conteúdo privado permaneceu nos cenários locais executados; isso não certifica infraestrutura ou dados remotos.
