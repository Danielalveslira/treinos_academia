# Política de Privacidade v1.5.0 — proposta para aprovação (Checkpoint A)

> **Rascunho para revisão humana/jurídica. Nada foi publicado.** Este documento **não é parecer jurídico**: reúne fatos verificados
> no código, o texto proposto e as decisões que cabem ao responsável. A v1.4.0 permanece intacta (será arquivada como fixture
> imutável, como foi feito com a v1.3.0).

## 1. Fatos verificados no código (base de cada afirmação do texto)

| Afirmação | Evidência |
|---|---|
| Autenticação/banco/armazenamento/funções são **Supabase** (não Firebase) | `src/supabase/config.js` (`@supabase/supabase-js`), `supabase/migrations`, `supabase/functions`; commit `61dbda9` removeu o Firebase |
| Hospedagem do frontend na **Vercel** | `vercel.json`; deploys de Produção do projeto `danielalvesliras-projects/treinos_academia` |
| Pagamento de EvoCash no checkout da **InfinitePay**; o app guarda pacote, valor, situação e link do checkout | `supabase/functions/infinitepay-create-checkout/core.js`, tabela `cash_purchases` |
| Notificações push: guarda `endpoint`, chaves, `user_agent`, `device_label`, `platform`; entrega pelo serviço do navegador (FCM, Apple, Mozilla, Microsoft) | `push_subscriptions` (migration `20261012000001`), `process-push-outbox` |
| "Último uso" da conta: 1 linha por usuário, sem log de eventos | `user_activity` (`20261011000001`) |
| Telemetria técnica offline: eventos enumerados, apagados em **30 dias** | `20261016000003` (`cleanup_offline_telemetry`) |
| Métrica de anúncios: agregados diários (24 meses, a aprovar) e marcador temporário **ligado à conta por até 48 h**; sem IP, sem User-Agent, sem fingerprint nos registros da medição | migrations `20261018000001/02`, `src/services/adMetrics/collector.js` (não lê nenhum identificador de aparelho) |
| Cliques sem impressão são contados (`unqualified_clicks`) | `record_ad_events` |
| Só contas autenticadas e com aceite vigente são medidas; superadmin não conta | `has_app_access()` na RPC |

## 2. Mudanças propostas (v1.4.0 → v1.5.0, somente a Política de Privacidade)

Termos de Uso e Regras da Comunidade **não mudam** (menor diff para revisão). Textos propostos, literais:

**Resumo (2 itens novos):** "Medimos, em totais, quantas vezes anúncios patrocinados são vistos e clicados; não montamos perfil
publicitário seu." / "Você pode pedir acesso, correção ou exclusão dos seus dados, ou se opor à medição de anúncios, pelo
atendimento, a qualquer momento." (substitui o terceiro item atual, que só citava acesso/correção/exclusão).

**"O que coletamos" — 3 linhas novas na tabela:**
- *Pedidos de EvoCash* → "Registrar sua compra (pacote, valor e situação do pedido); o pagamento é feito no checkout da InfinitePay".
- *Dados técnicos de uso e notificações* → "Se você ativar notificações, guardamos o endereço técnico do seu navegador, o tipo de aparelho e o nome do aparelho; guardamos também o momento do último uso da conta e registros técnicos de sincronização offline".
- *Visualizações e cliques em anúncios patrocinados* → "Medir o desempenho dos patrocínios e evitar contagem duplicada ou abuso, sem criar perfil publicitário seu (veja “Anúncios patrocinados e medição”)".

**Nova seção "Anúncios patrocinados e medição":**
1. Anúncios marcados como “Patrocinado” aparecem na Home e nas comunidades: como banner rotativo ou como card no feed.
2. Contamos uma visualização quando pelo menos metade do anúncio fica visível na tela por 1 segundo seguido, com o app aberto. Contamos um clique quando você toca no botão do anúncio. Um clique pode ser contado mesmo sem visualização registrada (por exemplo, quando você toca rápido); o clique não confirma que o destino foi aberto.
3. Guardamos totais por anúncio, posição (Home, banner da comunidade ou feed), comunidade e dia, incluindo quantas contas diferentes viram o anúncio em cada dia. Esses totais não identificam você e são mantidos por até 24 meses.
4. Para não contar duas vezes o mesmo evento e limitar abusos, mantemos por até 48 horas um registro temporário que liga a sua conta ao anúncio, à posição, à comunidade, ao dia e a um código aleatório do evento. Esse registro não é anônimo enquanto existe; é apagado automaticamente e não forma um histórico permanente seu.
5. Os totais são vistos pela administração do Evolutus. Relatórios para anunciantes trazem apenas totais; anunciantes não recebem seus eventos individuais, nem sua identidade, nem seus dados de contato por causa da medição.
6. Não usamos essa medição para criar perfil de interesses, personalizar ou direcionar anúncios, e não a compartilhamos com terceiros para publicidade; isso vale também para contas de adolescentes. Nos registros da medição não gravamos IP, localização, identificador de aparelho nem impressão digital do navegador. Provedores de infraestrutura podem manter registros técnicos de acesso.
7. Fazemos essa medição com base no legítimo interesse do Evolutus em saber se os patrocínios funcionam, usando apenas os dados mínimos descritos acima. Você pode se opor a ela pelo atendimento, escolhendo “Privacidade ou exclusão da conta”.
8. Os números são estimativas operacionais: não comprovam vendas, conversões nem entrega para fins de cobrança.

**"Seus direitos":** acrescenta "Se opor à medição de anúncios patrocinados descrita acima."

**"Segurança e retenção":**
- *Substitui* "Usamos o Google Firebase…" por: "Usamos o Supabase (autenticação, banco de dados PostgreSQL, armazenamento de mídias e funções do servidor) e a Vercel (hospedagem do frontend). O pagamento de EvoCash é processado no checkout da InfinitePay. As notificações push passam pelo serviço do seu navegador ou sistema (como Google, Apple, Mozilla ou Microsoft)."
- *Novo:* "Esses provedores podem processar dados em servidores fora do Brasil e manter registros técnicos de acesso."
- *Novo:* "Registros temporários da medição de anúncios: até 48 horas. Totais da medição, sem identificar você: até 24 meses. Registros técnicos de sincronização offline: até 30 dias."
- Os demais itens ficam como estão.

**Manifesto 1.5.0** (`changes`): (1) medição de anúncios, base legal e direito de oposição; (2) correção dos provedores (Supabase/Vercel em vez de Firebase) e inclusão de InfinitePay, push e prazos de retenção. **Digest calculado (conferido em modo `--check`): `9f7f12926c8788ee4a8dbf03ab1074f330525b3207dac5a5ddc7138b8f5b2d95`** (depende do texto e da data do manifesto; muda se qualquer um mudar).

> A ExerciseAPI (catálogo) **não** é citada: o proxy não envia dados da conta, então a informação não é necessária. As linhas de EvoCash, dados técnicos/notificações, provedores e retenção offline **não são sobre métricas**: corrigem a
> fidelidade da política ao que o código já faz. Se o jurídico preferir, podem sair desta versão sem afetar a medição.

## 3. Decisões que cabem ao responsável/jurídico (não presumidas)

1. **Base legal.** O texto acima assume **legítimo interesse** (LGPD art. 7º, IX): finalidade (medir patrocínios) legítima; dados
   mínimos (totais + marcador de 48 h); sem perfilamento nem compartilhamento; oposição pelo atendimento. Pontos a pesar: necessidade
   (os totais exigem contagem por conta/dia?), proporcionalidade, expectativa do usuário (selo "Patrocinado" e texto da política) e
   a fragilidade de tratar "aceitar a política" como consentimento específico — **por isso o texto não pede consentimento**. Se a
   decisão for **consentimento**, é preciso implementar opt-in específico, revogação e bloqueio **no cliente e no servidor** antes de
   qualquer registro (trabalho adicional, não feito).
2. **Menores (12–17 anos).** O app admite 12+ (`minimumAge`). Para crianças/adolescentes a LGPD (art. 14) exige tratar no melhor
   interesse. Opção técnica de baixo custo, **não implementada** (exigiria migration nova e muda os números): ignorar eventos de
   contas com idade < 18 no servidor. A decisão é de política: medir menores com os mesmos dados mínimos, medir só a partir de
   uma idade, ou excluí-los.
3. **Prazos:** 48 h (marcadores) e 24 meses (agregados) são os da implementação; confirmar necessidade/proporcionalidade (reduzir
   os 24 meses é um parâmetro da função de limpeza, sem mudar o app).
4. **Transferência internacional:** o texto diz que provedores "podem" processar fora do Brasil. Confirmar a região do projeto
   Supabase e a base do art. 33 LGPD.
5. **Itens extras** da seção 2 (EvoCash, push, retenção offline): manter ou retirar.
6. **Quando exigir o reaceite** (seção 5): decisão específica sua.

## 4. Versionamento técnico (mecanismo real do projeto)

- **Digest:** `sha256(JSON.stringify({manifest, documents}))` (`src/utils/legalDigest.js`, igual ao `scripts/seed-legal.mjs`); nunca
  digitado à mão.
- **Arquivos:** `legal/manifest.json` → 1.5.0; `legal/documents.json` com o novo bloco; `legal/approved-digests.json` ganha a entrada
  `1.5.0`; o conteúdo exato da v1.4.0 vai para `legal/test-fixtures/1.4.0.json` (mesmo formato do `1.3.0.json`: manifest, documents,
  digest, createdAt); `src/utils/legal.js` passa a mapear `1.3.0`, `1.4.0` (fixture) e `1.5.0` (arquivos atuais).
- **Banco:** `scripts/seed-legal.mjs` faz *upsert* de `legal_versions` (1.5.0) e **depois** de `legal_policy` (versão, digest,
  `published=true`). É a escrita que dispara o reaceite.
- **Compatibilidade:** o cliente novo aceita 1.3.0/1.4.0/1.5.0 ao mesmo tempo (`resolveLegalBundle` escolhe pelo que está em
  `legal_policy` e valida contra o arquivo aprovado). Logo, **subir o frontend com a v1.5.0 aprovada antes de mexer no banco é
  inofensivo**: enquanto a política do banco for 1.4.0 nada muda para ninguém.

## 5. Reaceite: impacto e ordem segura

- Ao gravar `legal_policy` = 1.5.0, `has_app_access()` passa a ser **falso** para quem não aceitou a 1.5.0 (RLS e RPCs negam
  tudo até o aceite). Quem já aceitou a 1.4.0 vê a tela de confirmação (`LegalGate`) e precisa informar/ter data de nascimento
  (≥ 12 anos) e confirmar os dois aceites. Sessão nova de outro aparelho/conta passa pelo mesmo caminho.
- **Risco real de janela:** um app aberto com o **frontend antigo** (só conhece 1.3.0/1.4.0) fica em **"Documentos indisponíveis"**
  assim que o banco virar 1.5.0, até recarregar e o service worker assumir o novo. Por isso: (1) publicar o frontend; (2) esperar
  a propagação do SW (recomendo **24 h**, com a janela escolhida por você); (3) só então rodar o *seed* da v1.5.0.
- O superadmin continua alcançando o painel durante a transição (regra existente em `resolveLegalGateState`).
- A coleta **não** depende do reaceite estar concluído: quem não aceitou a 1.5.0 já é ignorado pela RPC (`has_app_access()`), então
  nenhum evento é gravado de conta que não viu o texto novo.
- **Recuperação:** preferir corrigir adiante. Se `legal_policy` voltar a 1.4.0, quem aceitou a 1.5.0 vê a tela de aceite da 1.4.0 (verificado em homologação); nunca reverter só o frontend deixando o banco em 1.5.0.

## 6. Estado desta preparação

- Texto proposto: este documento. O arquivo `docs/legal-drafts/documents.v1.5.0.draft.json` é o `documents.json` completo já com o
  novo bloco da Política de Privacidade (os blocos de Termos e Regras são idênticos aos da v1.4.0), pronto para ser copiado para
  `legal/documents.json` **depois da aprovação**. **Nenhum** arquivo de `legal/` está alterado (uma edição preparatória que fiz foi
  revertida com `git checkout`), nenhum digest foi gerado e nenhuma linha de banco foi publicada ou commitada.
- Procedimento para o operador autorizado: ver `docs/SPONSORED_AD_METRICS_ACTIVATION.md` §1 (script `docs/legal-drafts/apply-legal-v1.5.0.mjs`, com `--check`).
- Pendências antes do Checkpoint A: aprovação da base legal e dos prazos (itens 3.1–3.5) e decisão da janela de reaceite (3.6).
