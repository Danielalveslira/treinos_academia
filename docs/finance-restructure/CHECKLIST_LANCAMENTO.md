# Checklist consolidado de lançamento — Fases 1 a 6

Controle vigente em 28/10/2026. Os relatórios anteriores permanecem como histórico. Desenvolvimento local concluído não autoriza lançamento, produção, pagamentos reais, push ou merge. A Fase 6 possui entrega local própria, documentada abaixo.

## A. Correções técnicas do escopo, concluídas localmente

- [x] Vários profissionais/estabelecimentos no mesmo proprietário, IDs e âncoras independentes, sem tabela de conteúdo duplicada.
- [x] Criação idempotente e serializada; limites por proprietário/tipo com revisão, auditoria e autenticação recente.
- [x] Ausência de configuração bloqueia novas criações; zero pausa; NULL explicitamente configurado permite quantidade sem teto comercial. Antifraude e rate limit continuam ativos. Nenhuma dessas opções concede publicação.
- [x] Central paginada `/minha-vitrine`, seleção explícita e atalhos de gerenciamento/renovação. Contratos só são lidos no recurso selecionado.
- [x] Resumo de contas administrativas agrega cadastros sem repetir contas.
- [x] Carteira/ledger/cotação/contratação/renovação/reversão permanecem no motor único, sem alterações nas primitivas monetárias.
- [x] Aprovação editorial e direito vigente independentes; edição/reprovação preservam a última versão aprovada.
- [x] Expiração, suspensão, restrição de conta, acesso direto e mídia verificados no servidor; invalidação visual por recurso, sem retirar seus irmãos.
- [x] Gateway, bucket e coletor de mídia reaproveitados; referências públicas/pendentes e leases protegidos. Sem coluna equivalente duplicada.
- [x] Legado preservado, sem atribuição de proprietário por suposição nem publicação gratuita automática.
- [x] Seletor de comunidades filtra proprietário no banco antes do limite e recebe apenas campos necessários.
- [x] Navegação Turbo calcula a idade do pedido HTML, sem envelhecer a página nova pelo tempo da visita anterior.
- [x] Corrida do teste offline investigada e substituída por barreira observável; 12 execuções focadas aprovadas, teste completo mantido.
- [x] Migrations acumuladas testadas com rollback e hashes financeiros inalterados; nenhuma migration histórica editada.
- [x] RLS, propriedade, contratos de recursos diferentes, concorrência e gates locais registrados em `phase5/evidence51`.
- [x] CI preparado com a nova concorrência de múltiplos recursos, sem execução remota nesta etapa.

Não há falha técnica local conhecida que bloqueie a continuidade do desenvolvimento desta etapa. Avisos de lint/chunk anteriores e a variabilidade das medições locais estão explicitados na entrega; não foram ocultados ou tratados como homologação de produção.

## B. Decisões comerciais/jurídicas, pendentes

- [ ] Aprovar preço oficial BRL/EvoCash, limites mínimo/máximo de recarga, limites operacionais e validade de cotações.
- [ ] Aprovar tarifas independentes de vitrine de produtos, perfil profissional e estabelecimento; mínimos/máximos de dias e vigências. Não aproveitar os números do seed local como política.
- [ ] Aprovar quantidades por proprietário/tipo, incluindo tratamento de rascunhos/arquivados e eventual decisão explícita de não impor teto. Configuração ausente continua bloqueando novas criações.
- [ ] Aprovar limites de produtos por vitrine e condições de publicação; nenhum limite ilustrativo deve ser promovido silenciosamente.
- [ ] Aprovar regras editoriais, provas de titularidade, categorias, contatos permitidos, política de imagens e critérios de suspensão/reavaliação.
- [ ] Decidir tratamento comercial de conteúdo legado e registros sem prova suficiente de titularidade; preservar privadamente até decisão.
- [ ] Aprovar cancelamento, arrependimento, compensação, indisponibilidade administrativa/operacional, reversões e reembolso por produto. Não criar crédito/extensão/reembolso automático sem essa política.
- [ ] Aprovar condições de lançamento, comunicação ao empreendedor e textos jurídicos/versionamento de ciência ou aceite correspondentes.
- [ ] Aprovar retenção/tolerância de mídia abandonada e frequência operacional de manutenção, sem apagar referências de versões aprovadas/pendentes.
- [ ] Confirmar escopo de equipes empresariais e papéis: a carteira permanece pessoal; não pressupor carteira corporativa compartilhada.

A plataforma implementada não habilita venda de fichas por terceiros, comissões, saques ou repasses. Publicidade autônoma está implementada localmente na Fase 6 e depende de sua revisão própria e dos bloqueios de lançamento abaixo.

## C. Ambiente, autorização e validações externas, pendentes de lançamento

- [ ] Executar CI remoto completo da revisão final após autorização de push; conferir checks obrigatórios/proteção efetiva do merge. Aprovação local não substitui esse resultado.
- [ ] Homologar InfinitePay em ambiente/conta autorizados: credenciais, callback, valores/identidades, timeout incerto, duplicidade, conciliação e reversões. Simulação/mocks não concluem homologação financeira real; não executar pagamento real para marcar este item.
- [ ] Rever políticas financeiras/jurídicas com os responsáveis apropriados e compatibilidade contratual do crédito pré-pago com o provedor.
- [ ] Fazer inventário read-only atual dos dados e schema de destino: versões efetivamente aplicadas, drift, FKs/grants/RLS, constraints historicamente NOT VALID e diferenças anteriores do catálogo. Não presumir que o inventário de outubro ainda descreve o destino.
- [ ] Revisar registros editoriais reais e suas mídias/proprietários antes das migrations acumuladas. Conteúdo sem direito continua privado, sem destruição ou concessão automática.
- [ ] Definir responsável por backup e comprovar restauração de banco/Storage no ambiente autorizado antes da integração.
- [ ] Revisar ordem das migrations e janela de instalação. `DROP unique(owner_id)` não apaga dados, mas a aplicação anterior que presume unicidade não é um rollback compatível depois de criar vários cadastros.
- [ ] Preparar rollback: pausar novas criações/vendas conforme necessário, manter APIs por UUID e preservar ledger/pedidos/direitos. Não restaurar unicidade apagando cadastros nem executar down migration destrutiva.
- [ ] Configurar segredos, gates comerciais, domínios, URLs de retorno/webhook e permissões no destino, preservando vendas pausadas até aprovação.
- [ ] Validar handlers/rewrite/includeFiles, HTTP 200/404/308/503, canonical, sitemap, cache/CDN/service worker e gateway de mídia no deployment autorizado.
- [ ] Configurar e observar jobs auxiliares (reconciliação, lembretes, manutenção, Vault/cron), com lotes limitados, leases e diagnóstico. Expiração permanece no PostgreSQL, sem depender desses jobs.
- [ ] Validar Realtime de carteira/notificações no ambiente autorizado. A Fase 6 acrescentou o serviço oficial local para invalidação publicitária; isso não homologa os demais canais nem a infraestrutura de destino.
- [ ] Medir latência/cold start/Storage e tráfego no ambiente autorizado; amostras sintéticas locais não constituem SLA ou capacidade de produção.
- [ ] Executar smoke integrado de compra EvoCash e contratação, monitorar conciliação carteira/ledger/pedidos, pedidos incertos e tentativas de exposição de vencidos.
- [ ] Obter autorização explícita separada para integração, merge, deploy e ativação comercial.

Enquanto B/C não forem concluídos, o lançamento permanece bloqueado. Nenhuma política, assinatura jurídica, homologação real ou autorização está sendo presumida.

## D. Fase 6 — publicidade autônoma, revisão local

Entrega e evidências: [phase6/ENTREGA.md](phase6/ENTREGA.md). Nenhum item desta seção autoriza produção.

- [x] Central autônoma, revisão privada/aprovada, mídia protegida e moderação.
- [x] Motor único, carteira pessoal, cotações versionadas, reservas por intervalo e contratação global indivisível.
- [x] Locks concorrentes, idempotência, saldo, renovação manual, suspensão, sessão e RLS.
- [x] Home e comunidades reais, identidade paga explícita, conteúdo orgânico preservado e expiração no servidor.
- [x] Realtime oficial local com eventos PostgreSQL reais; suspensão/retomada sem reload e falha fechada na desconexão.
- [x] Métricas existentes reutilizadas; eventos de homologação explicitamente sintéticos, sem CPC/CPM ou audiência prometida.
- [x] Sequência acumulada de migrations com rollback e hashes financeiros/legados preservados.
- [ ] Aprovar tarifas, capacidade e composição oficial do pacote global; não usar os seeds locais como política.
- [ ] Aprovar publicidade, retenção/LGPD, tratamento do legado, cancelamento e compensações; não há política automática presumida.
- [ ] Validar configuração, disponibilidade, roteamento e contenção de Realtime/inventário no destino autorizado.
- [ ] Executar CI remoto e obter aprovação explícita para integração/deploy/ativação, mantendo os itens B/C pendentes.
