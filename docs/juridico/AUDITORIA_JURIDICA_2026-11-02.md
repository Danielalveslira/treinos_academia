# Auditoria e correção do sistema jurídico — 02/11/2026

Branch `feat/juridico-auditoria-20261102`, a partir de `origin/main` (`2e374d0`). Nada foi publicado, ativado ou aplicado em produção.

## 1. Hipóteses do diagnóstico

| # | Hipótese | Na branch atual | Tratamento |
|---|---|---|---|
| 1 | Pacote geral 1.5.0 desalinhado com cadastro, privacidade e monetização | Confirmada ("Treinos", "pacote" de EvoCash, sem Vercel Analytics/Resend/ExerciseAPI, sem sexo/município) | Minuta 2.0.0 em `legal/drafts/` (não publicada) |
| 2 | Termos da vitrine 1.1.0 descrevem gratuidade e publicação direta | Confirmada | Minuta 2.0.0 no registro comercial; página passa a ler só versões publicadas no banco |
| 3 | Consentimento de saúde obrigatório para criar a conta | Confirmada (UI e RPC) | Consentimento opcional, específico, com histórico e revogação; exigido só para registrar medidas |
| 4 | `acceptLegalDocuments` envia manifest/documents | Confirmada | Payload só com versão, digest, escolha e origem |
| 5 | RPC de aceite grava conteúdo do cliente em `legal_versions` | Confirmada | RPC reescrita; versão precisa estar registrada antes |
| 6 | `seed-legal.mjs` faz upsert silencioso | Confirmada | Histórico imutável no banco; script recusa divergência, minuta e ativação sem confirmação |
| 7 | `?version=` antigo mostra "página desatualizada" | Confirmada | Versão histórica abre o próprio texto; versão inexistente ou não publicada não aparece |
| 8 | Vitrine com texto estático divergente do banco | Confirmada (página lia o JSON do bundle) | Página lê o registro do banco; o JSON estático deixa de ser exibido |
| 9 | Reembolso `draft-1` não aprovado | Confirmada | Preservada; ativação só de versão `approved=true` (`admin_activate_refund_policy`, service role) |
| 10 | Confirmação comercial baseada em `p_confirm` | Confirmada | Aceite por operação com versão, digest e snapshot das condições, exigido no ponto de cobrança |
| 11 | Afirmações da Política de Privacidade | Parcialmente divergentes | Minuta 2.0.0 descreve os fluxos reais, com pendências marcadas |
| 12 | Idade mínima 12 sem controles para menores | Confirmada | Compras/contratações bloqueadas no servidor para menores de 18; adequação ao ECA Digital pendente de decisão |

## 2. Matriz de cobertura (após a correção)

| Funcionalidade | Documento | Momento | Evidência persistida | Regra no backend |
|---|---|---|---|---|
| Cadastro / reaceite | Termos de Uso + Regras da Comunidade | Etapa 3 do cadastro e `LegalGate` | `legal_acceptances` (versão, digest, origem, hora do servidor) | `accept_legal_documents`: versão registrada e vigente, idade calculada no servidor |
| Privacidade | Política de Privacidade | Informada no cadastro (sem caixa de seleção) | `legal_acceptances.privacy_notice_presented` | — (informação, não consentimento) |
| Medidas corporais | Consentimento específico `health-data-1` | Opcional no cadastro, no Perfil ou ao registrar medida | `privacy_consent_events` (concessão/revogação, texto, origem) | Trigger em `body_measurements` (`HEALTH_CONSENT_REQUIRED`) |
| Compra de EvoCash | Condições do EvoCash | Tela de confirmação, antes do checkout | `commercial_terms_acceptances` + snapshot da cotação | Trigger em `cash_purchases` exige aceite vigente |
| Anúncios / impulsionamentos | Termos de Publicidade e Impulsionamento | Confirmação da contratação | Idem, por pedido | Trigger em `commercial_orders` (quoted→fulfilled) |
| Vitrines (profissional, espaço, produtos) | Termos das Vitrines | Confirmação da contratação | Idem, por pedido | Idem |
| Reembolso | Política de Cancelamento, Arrependimento e Reembolsos | Cotação (já existente) | `refund_quote_terms` / `refund_contract_terms` (já existentes) | RPCs de reembolso sem exigir aceite dos termos novos |
| Menores | Termos de Uso §8 | Toda cotação/compra | — | Triggers `*_block_minor` (`MINOR_PURCHASE_BLOCKED`) |
| Documentos | Todos | Rotas públicas estáveis + `?version=` | `legal_versions`, `legal_document_versions` (imutáveis) | RLS: só versões publicadas são legíveis |

## 3. O que mudou

Migrations novas e aditivas (rollbacks em `supabase/rollbacks/`, que preservam toda evidência):

- `20261212000001_legal_acceptance_integrity.sql`: histórico imutável de `legal_versions`, minutas invisíveis ao público, `admin_publish_legal_policy` (service role; recusa minuta), novo `accept_legal_documents`, consentimentos (`privacy_consent_texts`, `privacy_consent_events`, `set_privacy_consent`, `get_my_privacy_consents`), exigência de consentimento para novas medidas e bloqueio de compras de menores.
- `20261212000002_commercial_terms_evidence.sql`: registro único de documentos comerciais (`legal_document_versions`/`legal_document_policy`, digest calculado no servidor), mapeamento oferta→documento (nenhuma oferta isenta), snapshot na cotação, `accept_commercial_terms`, `confirm_commercial_order_with_terms`, `get_my_commercial_terms` (comprovante) e exigência do aceite no ponto de cobrança.
- `20261212000003_refund_rights_without_current_terms.sql`: as oito RPCs de reembolso passam a exigir apenas sessão válida e conta ativa, e não o aceite da versão vigente.

Frontend: `LegalConsent` separa aceite contratual, informação de privacidade e consentimento opcional. `LegalGate` traz um painel "Seus direitos continuam disponíveis" (reembolsos e consentimento, carregado só quando é aberto). O Perfil ganhou "Dados de saúde e direitos". `BodyCompositionCard` pede a autorização no momento do registro. `LegalDocument` passou a ter versões históricas, documentos comerciais e leitura para clientes com cache antigo. A confirmação de EvoCash e de contratações mostra o resumo, o documento e o aceite explícito. Novas rotas: `/condicoes-evocash`, `/termos-publicidade` e `/politica-de-reembolso`.

Scripts: `seed-legal.mjs` endurecido; novo `publish-legal-document.mjs`; fixtures de termos sintéticos para os scripts de concorrência (`scripts/lib/commercial-terms-fixture.mjs`) e para o pgTAP (`supabase/tests/_helpers/commercial_terms.sql`).

## 4. Decisões humanas pendentes

**Decisão registrada em 02/11/2026:** o Evolutus passa a aceitar **novos cadastros somente de pessoas com 18 anos completos ou mais**. A verificação é feita no frontend e no backend, inclusive em retomadas de cadastros incompletos. A minuta geral 2.0.0 foi adaptada; documentos históricos 1.x permanecem imutáveis. Contas preexistentes de menores, caso existam, não são apagadas automaticamente. Esta decisão não equivale à publicação jurídica.

**Jurídicas**

1. **Idade mínima: decisão resolvida (18+)**. Restam a validação da estratégia para contas preexistentes identificadas como menores e a revisão das salvaguardas do ECA Digital aplicáveis ao serviço. Não promover a versão jurídica 2.0.0 sem aprovação.
2. O que fazer com as medidas corporais depois da revogação: eliminação automática ou manutenção até pedido do titular.
3. Bases legais marcadas como pendentes na minuta 2.0.0: sexo/altura, analytics e leads comerciais.
4. Mecanismo de transferência internacional por provedor, prazos de retenção por categoria e aplicabilidade do art. 15 do Marco Civil.
5. Identificação do controlador (pessoa física ou jurídica, CNPJ, endereço) e encarregado (DPO) ou dispensa aplicável.
6. Marco inicial do arrependimento por modalidade e efeitos sobre serviço iniciado ou créditos consumidos (`draft-1` continua minuta).
7. Checkbox obrigatório "Li e concordo com o tratamento dos dados" do formulário Para Empresas (`scripts/public-for-business.mjs`): ciência apresentada como concordância. Revisar a redação junto com a Política de Privacidade.

**Comerciais**

8. Taxa administrativa do EvoCash: hoje não há campo de taxa; o preço unitário é único. Confirmar se há taxa a destacar.
9. Destino do saldo de EvoCash não usado no encerramento da conta ou na descontinuação do produto.
10. Compensação por suspensão sem culpa, por indisponibilidade técnica e por vitrine recusada após o pagamento.
11. Aprovação dos textos: as quatro minutas comerciais e a minuta geral 2.0.0 (`legal/drafts/`).

## 5. Processo de publicação (após aprovação expressa)

1. **Documentos gerais**: mover a minuta aprovada para `legal/manifest.json` e `legal/documents.json` com `published: true`, registrar o digest em `legal/approved-digests.json` e acrescentar o arquivo anterior em `legal/test-fixtures/`. Publicar o frontend. Depois rodar `node scripts/seed-legal.mjs` (só registra) e, por fim, `CONFIRM_LEGAL_ACTIVATION=<versão> node scripts/seed-legal.mjs --activate`.
2. **Documentos comerciais**: definir `"approved": true` e a data no JSON aprovado e rodar `CONFIRM_LEGAL_DOCUMENT=<id>@<versão> node scripts/publish-legal-document.mjs <arquivo> --publish`. Isso não habilita vendas.
3. **Reembolso**: inserir a versão aprovada em `refund_policies` com `approved=true` e chamar `admin_activate_refund_policy` (service role).
4. **Ordem de deploy**: migrations antes do frontend. O frontend novo depende de `confirm_commercial_order_with_terms`, `accept_commercial_terms` e da RPC de aceite que não exige o consentimento de saúde. O frontend antigo continua funcionando com as migrations novas, exceto na confirmação comercial: sem aceite registrado, ela é recusada. Hoje não há impacto, porque todos os gates comerciais estão desligados.

## 6. Verificação local (stack Supabase isolado, recriado do zero)

- pgTAP: 101 arquivos e 4154 testes aprovados (a base era 99/4031), incluindo `legal_acceptance_integrity_test.sql` e `commercial_terms_evidence_test.sql`.
- Concorrência: commercial-engine, advertising, professional-listings, storefront-revisions, multiple-listings, storefront e evocash-pricing aprovados.
- Rollbacks aplicados e revertidos numa transação sem erro.
- `npm test`: 2476/2476. `npm run test:backfill`: 43/43. `npm run lint`: 0 erros (14 avisos já existentes). `npm run build` e `npm run budget` OK (+1,7 KB gzip no boot).
- Navegador (Playwright, 320/390/1440, claro e escuro): documentos, versão histórica, versão inexistente, documento não publicado, `LegalGate` com aceite e painel de direitos, confirmação de EvoCash. Sem overflow horizontal e sem erros de página. Os smokes de UI de vitrine e de anúncios foram aprovados.

## 7. Auditoria do cadastro 18+ e da marca (02/11/2026)

Revisão do HEAD `c7f6fe5` (commits `885129c`, `9a9c133` e `c7f6fe5`), feita sem considerar o CI anterior como prova.

| Problema | Gravidade | Onde | Correção |
|---|---|---|---|
| Idade e "data futura" calculadas pelo fuso do aparelho ou em UTC. O servidor usa `America/Sao_Paulo` (perto da meia-noite, 17 anos podiam passar no cliente; o teste antigo falhava com `TZ=UTC`) | Média | `src/utils/age.js` (`calculateAge`), `validateBirthDate`, `todayString()` de Register/ProfileCompletionForm/LegalGate | Dia civil de Brasília (`businessDayKey`); 29/02 conta a partir de 01/03, igual a `age()`; testes com instantes explícitos em 5 fusos |
| Uma conta concluída podia trocar a data de nascimento por API direta. Uma conta preexistente de menor podia se declarar adulta e liberar compras | Alta | `public.set_birth_info` | `BIRTHDATE_LOCKED` depois de concluído o perfil (`username` gravado); mesmo valor é idempotente; a retomada de perfil incompleto continua corrigível (sempre 18+); lock por linha |
| Regra `Math.max(18, manifest)` repetida em três telas | Baixa | Register, LegalGate | `registrationMinimumAge()` e `MINIMUM_AGE_MESSAGE` em `src/constants/accountAge.js` |
| Mensagem sem o ponto final exigido; no `LegalGate`, `MINIMUM_AGE` aparecia como erro geral | Baixa | validators, registrationErrors, LegalGate | Mensagem exata no campo de nascimento |
| Minuta prometia "verificações adicionais" de idade | Média (jurídica) | Termos 2.0.0 §2 | Texto informa que a idade é autodeclarada; pendência de aferição proporcional registrada |
| A Política de Reembolsos não identificava a plataforma; seções 7 e 8 sem numeração | Baixa | minutas comerciais | Corrigido; teste de integridade passa a cobrir todas as minutas |

**Limitação conhecida:** `supabase.auth.signUp` cria a identidade antes de o servidor receber a data. A UI recusa menores antes do `signUp`. Por API direta, a identidade criada fica inutilizável: `set_birth_info` recusa datas abaixo de 18 anos, e `accept_legal_documents` exige data 18+ (mesmo com o manifesto 1.5.0 declarando 12), sem o que `has_app_access()` é falso. A garantia depende de `legal_policy` estar publicada, como em produção. Bloquear antes da criação exigiria um Auth Hook com idade autodeclarada em metadados, sem ganho real de verificação; não foi implementado.

**Contas preexistentes:** nada é apagado. Menores identificados continuam sem compras, sem medição de anúncios e sem poder trocar a própria data. Na próxima versão jurídica, o reaceite será recusado (`MINIMUM_AGE`), com atendimento, privacidade e reembolsos ainda disponíveis. Falta decidir a política de transição: aviso, prazo e encerramento assistido.

**Marca:** as minutas usam Evolutus. A palavra "treino/treinos" foi mantida onde descreve atividade física. A versão 1.5.0 publicada continua com "Treinos" e "12 anos" por ser histórico imutável (digest verificado em teste). Até a 2.0.0 ser aprovada e publicada, a página `/termos-de-uso` vigente contradiz o cadastro 18+.
