# Transferências internacionais de dados — levantamento por fornecedor

**Natureza deste documento:** levantamento preliminar, feito por pesquisa pública sobre páginas legais de cada fornecedor. **Não é verificação de contrato.** Vários pontos abaixo dependem do contrato real assinado (ou dos termos aceitos) com cada fornecedor, que esta pesquisa não teve acesso a. Marcações "não verificado" significam exatamente isso — não significam conformidade nem ausência dela.

## Contexto normativo

A **Resolução CD/ANPD nº 19, de 23/08/2024** aprovou o Regulamento de Transferência Internacional de Dados e o conteúdo das cláusulas-padrão contratuais (CPC) exigidas pela LGPD (art. 33). Mecanismos válidos: decisão de adequação do país, cláusulas-padrão contratuais da ANPD, normas corporativas globais, ou cláusulas contratuais específicas aprovadas pela ANPD (mecanismo residual, só quando as CPC não são viáveis). **O período de adequação (12 meses da publicação) terminou em 23/08/2025 — já passou.** Ou seja: hoje, qualquer transferência internacional feita pelo Evolutus (diretamente ou through seus fornecedores) já deveria estar coberta por um desses mecanismos, não é mais uma pendência "para o futuro".

## Fornecedores identificados no código/documentação deste repositório

Além dos quatro citados pelo proprietário (Supabase, Vercel, Resend, InfinitePay), encontrei estes no código, que também tratam ou transmitem dados pessoais e deveriam entrar na mesma análise:

- **`@vercel/analytics`** (`src/main.jsx`) — métricas de uso, parte do mesmo fornecedor Vercel, mas com finalidade e fluxo de dados distintos do hosting.
- **Serviços de push da Web Push API**: `fcm.googleapis.com` (Google, usado por navegadores Chrome/Android), `push.services.mozilla.com` (Mozilla/Firefox), `push.apple.com` (Apple/Safari), `notify.windows.com` (Microsoft/Edge) — ver `supabase/functions/process-push-outbox/processor.js`. Esses não são fornecedores *escolhidos* pelo Evolutus; são a infraestrutura padrão do protocolo Web Push, acionada automaticamente pelo navegador de cada usuário conforme o Evolutus envia notificações. O conteúdo da notificação é cifrado ponta a ponta (chave VAPID) — essas empresas veem metadados de entrega, não o conteúdo.
- **Não encontrei** chamada a nenhuma API externa de catálogo de exercícios (ex. wger, ExerciseDB) no código atual — o catálogo parece ser interno/self-hosted. Se isso mudar, deve entrar nesta lista.

## Tabela por fornecedor

| Fornecedor | Papel / dados tratados | Região de hospedagem apurada | Mecanismo de transferência encontrado | Status |
|---|---|---|---|---|
| **Supabase** | Banco de dados, autenticação, storage, Edge Functions — praticamente todos os dados pessoais do Evolutus passam por aqui | Depende da região escolhida ao criar o projeto (configurável); **não determinei a região real deste projeto a partir do repositório** — precisa ser confirmada no painel do Supabase. Subprocessadores de infraestrutura citados por análise de terceiros (não confirmado no PDF oficial): AWS, Cloudflare, Google, Fly.io, Vercel. | Supabase publica um DPA próprio (`supabase.com/legal/customer-resources/data-processing-addendum`), que prevê processamento onde a Supabase ou seus subprocessadores mantiverem infraestrutura, sujeito às obrigações de transferência do próprio DPA. **Não verificado**: se o DPA aceito pela conta do Evolutus referencia as cláusulas-padrão da ANPD especificamente (ele provavelmente usa SCCs europeias/GDPR como base, não necessariamente as CPC brasileiras). | **Verificar contrato.** Maior volume de dados pessoais de todos os fornecedores — prioridade mais alta para confirmação. |
| **Vercel** | Hospedagem do frontend, Edge/Serverless Functions, Vercel Analytics | Global (CDN edge); hospedagem principal tipicamente EUA, conforme infraestrutura padrão da Vercel. | DPA próprio (`vercel.com/legal/dpa`), que referencia explicitamente as SCCs da UE/GDPR e o UK Addendum para transferências fora do EEE. Lista de subprocessadores publicada em `security.vercel.com` (não verificada diretamente nesta pesquisa). | **Verificar contrato.** Baseado em SCCs europeias, não nas CPC brasileiras — precisa confirmar se isso satisfaz a Resolução nº 19/2024 ou se é necessário aditivo específico. |
| **Resend** | Envio de e-mails transacionais (lembretes de compra EvoCash) | Fontes de terceiros (não oficiais) indicam infraestrutura primariamente nos EUA, possivelmente sobre AWS SES — **não confirmado na documentação oficial da Resend**, que não apareceu nos resultados de busca. | Fontes de terceiros citam uso de SCCs (UE) 2021/914 Módulo 2 por fornecedores que usam Resend como subprocessador — **não é o DPA da própria Resend**, é inferência de terceiros. | **Não verificado — maior lacuna de informação pública entre os quatro fornecedores citados pelo proprietário.** Consultar diretamente `resend.com` por DPA/subprocessor list oficiais, ou contato comercial. |
| **InfinitePay** | Processamento de pagamentos (EvoCash) | Instituição de pagamento brasileira, regulada pelo Banco Central. Não encontrei declaração pública sobre hospedar dados fora do Brasil. | Não aplicável/não identificado — tudo indica operação doméstica (BR), o que, se confirmado, **não configuraria transferência internacional**. Achado relevante, mas não relacionado a transferência: a empresa declarou publicamente (resposta de atendimento) manter dados cadastrais/transacionais por 10 anos por exigência regulatória do Banco Central, o que é relevante para a política de retenção, não para transferência. | **Baixo risco de transferência internacional**, mas confirmar formalmente (política de privacidade da InfinitePay não foi lida página a página nesta pesquisa) que não há subprocessador estrangeiro. |
| **Serviços de Web Push** (Google/Mozilla/Apple/Microsoft) | Entrega de notificações push; veem metadados de entrega (não o conteúdo, que é cifrado) | EUA (Google, Apple, Microsoft) e infraestrutura própria da Mozilla | Mecanismo específico não pesquisado nesta rodada — são provedores de infraestrutura de protocolo, não fornecedores contratados individualmente. | **Baixa prioridade, mas não nula** — mencionar na Política de Privacidade como transferência automática inerente ao protocolo Web Push, com conteúdo cifrado; não exige o mesmo tipo de contrato que um fornecedor de serviço contratado diretamente, mas vale registrar a existência do fluxo. |

## Avaliação: isso bloqueia a publicação da 2.0.0?

**Não acho que deva bloquear tecnicamente a publicação**, porque:
- Nenhum dos quatro fornecedores citados pelo proprietário aparenta estar fora de conformidade de forma **comprovada** — a lacuna é de **verificação documental**, não de evidência de descumprimento.
- A Política de Privacidade pode (e deve) declarar honestamente a situação real: quais fornecedores processam dados, que alguns deles estão fora do Brasil, e que os mecanismos de transferência exigidos pela Resolução nº 19/2024 estão em processo de confirmação contratual — sem inventar que "tudo está coberto por SCCs" quando isso não foi verificado.

**Mas bloqueia a afirmação, no texto jurídico publicado, de conformidade plena e verificada.** Recomendo:
1. Redigir a cláusula de transferência internacional da Política de Privacidade 2.0.0 de forma factual e **sem superafirmar**: nomear os fornecedores, dizer que alguns processam dados fora do Brasil, e que os mecanismos de proteção aplicáveis (cláusulas-padrão ou equivalentes) estão sendo confirmados/formalizados com cada fornecedor.
2. Como item de acompanhamento pós-publicação (não bloqueante): obter confirmação escrita de cada fornecedor (em especial Resend, por ser a maior lacuna) sobre o mecanismo de transferência vigente, e verificar se o DPA aceito pela conta Supabase/Vercel do Evolutus referencia as CPC da ANPD ou apenas SCCs europeias — e se isso é juridicamente suficiente (pergunta para o jurídico próprio, não resolvida aqui).

## Fontes

- [Consultor Jurídico — Regulamento sobre transferência internacional de dados](https://www.conjur.com.br/2024-set-01/regulamento-sobre-transferencia-internacional-de-dados//?print=1)
- [Demarest — ANPD aprova o regulamento de transferência internacional de dados](https://www.demarest.com.br/anpd-aprova-o-regulamento-de-transferencia-internacional-de-dados/)
- [Mayer Brown — End of grace period: implementation of Brazil's standard contractual clauses](https://www.mayerbrown.com/pt/insights/publications/2025/08/end-of-grace-period-implementation-of-brazils-standard-contractual-clauses-in-international-transfers-of-personal-data)
- [Migalhas — Breve análise sobre a transferência internacional de dados](https://www.migalhas.com.br/coluna/migalhas-de-protecao-de-dados/414287/breve-analise-sobre-a-transferencia-internacional-de-dados)
- [Supabase — Data Processing Addendum](https://supabase.com/legal/customer-resources/data-processing-addendum)
- [ComplyDog — Is Supabase GDPR compliant?](https://complydog.com/blog/is-supabase-gdpr-compliant)
- [Vercel — Data Processing Addendum](https://vercel.com/legal/dpa)
- [ComplyDog — Is Vercel GDPR compliant? The DPA and your deployment](https://complydog.com/blog/is-vercel-gdpr-compliant-the-dpa-and-your-deployment)
- [InfinitePay — Política de Privacidade](https://infinitepay.io/privacidade)
- [InfinitePay — Como a InfinitePay cuida dos dados dos seus clientes](https://www.infinitepay.io/blog/como-a-infinitepay-cuida-dos-dados-dos-seus-clientes)
- [Reclame Aqui — resposta da InfinitePay sobre retenção de dados cadastrais/transacionais](https://www.reclameaqui.com.br/infinite-pay/quero-o-encerramento-da-conta_VS9I0VOtkVJfqppm)

**Não verificado por fonte primária nesta pesquisa (listar explicitamente, não esconder):** DPA/subprocessor list oficial da Resend; subprocessor list oficial atual da Supabase (PDF não acessado diretamente); região real do projeto Supabase do Evolutus; se o DPA da conta Vercel/Supabase do Evolutus referencia as CPC da ANPD especificamente.
