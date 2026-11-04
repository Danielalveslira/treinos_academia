# Decisões para aprovar a versão jurídica 2.0.0

As minutas foram simplificadas, mas **não estão aprovadas nem vigentes**. Esta lista distingue o que o produto já faz do que ainda depende de comprovação. Não transformar uma hipótese jurídica em promessa ao usuário.

## 1. Idade mínima: 18 anos, sem documentos do usuário

**Decidido e implementado:** novos cadastros exigem 18 anos completos, calculados da data informada. O Evolutus não coleta CPF, RG, selfie ou biometria para isso. Contas antigas eventualmente identificadas como de menores recebem tratamento protetivo; anúncios não usam perfil comportamental para menores.

**Ainda é preciso decidir:** se o serviço, com comunidades, vitrines e conteúdo fitness, é de acesso provável por crianças ou adolescentes ou oferece algum conteúdo ou serviço inadequado a eles. A [Lei nº 15.211/2025](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15211.htm), o [Decreto nº 12.880/2026](https://www.gov.br/mj/pt-br/assuntos/arquivos-imprensa/sedigi/decretos-eca-digital.pdf) e as [orientações da ANPD](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-orientacoes-preliminares-e-cronograma-para-afericao-de-idade-no-ambiente-digital) pedem análise proporcional ao serviço e ao risco. A autodeclaração isolada não deve ser tratada como mecanismo suficiente para conteúdo proibido a menores. Registrar avaliação jurídica por funcionalidade e, se necessário, escolher sinal de idade ou método com mínima coleta. **Não** adicionar documentos ou biometria por suposição.

## 2. Encarregado de dados

A [análise de pequeno porte](DISPENSA_DPO_PEQUENO_PORTE_2026-11-04.md) mostra que pessoa física pode se enquadrar e que dado sensível, sozinho, não prova alto risco. Ainda faltam fatos de porte, escala e impacto para concluir a dispensa. Manter o canal de privacidade já existente e obter decisão jurídica documentada antes de declarar uma posição pública.

## 3. Transferências internacionais

O [mapa por fornecedor](TRANSFERENCIAS_INTERNACIONAIS_2026-11-04.md) registra países possíveis e fontes públicas. Faltam contratos realmente aceitos, subprocessadores da conta, fluxos efetivos e o mecanismo do art. 33 da LGPD para cada transferência. Não afirmar conformidade apenas porque há DPA público ou servidor em uma região.

## 4. Analytics e métricas próprias

**O que o código já mostra:** `src/main.jsx` usa Vercel Analytics e Speed Insights nas rotas React. `src/utils/analyticsRedaction.js` retira query string e fragmento, inclusive tokens, antes do envio. Caminho, referenciador, horário, localização aproximada, dispositivo e desempenho ainda podem chegar ao fornecedor, conforme [Web Analytics](https://vercel.com/docs/analytics/privacy-policy) e [Speed Insights](https://vercel.com/docs/speed-insights/privacy-policy). Caminhos também podem revelar interesse em saúde por contexto; não chamar os dados de anônimos sem prova.

As métricas próprias de anúncios registram conta, anúncio, tipo de evento, posição e comunidade quando aplicável. `sponsored_ad_event_marks` usa identificador temporário por até 48 horas; `sponsored_ad_daily_stats` guarda totais por até 24 meses. `sponsored_ad_metrics_opt_outs` implementa oposição às **métricas próprias**, não à Vercel. Medidas corporais e inferências de saúde não devem alimentar publicidade.

**Antes da publicação:** documentar teste de legítimo interesse para cada coleta não sensível, necessidade, balanceamento, minimização e oposição efetiva. Confirmar os jobs de descarte das métricas próprias no ambiente publicado. Se a coleta opcional da Vercel não tiver base e oposição sustentáveis, **suspender somente Analytics/Speed Insights** até resolver; não eliminar logs de segurança ou métricas necessárias e lícitas. O art. 7º, IX, não cobre dados sensíveis do art. 11 da LGPD.

## 5. Bases para dados que possam revelar saúde

Medidas corporais têm consentimento específico e opcional; revogá-lo apaga as medidas armazenadas. Porém sexo, altura, indicadores derivados e notas de treino também podem revelar saúde conforme o contexto. Confirmar quais desses dados são usados, se há hipótese específica do art. 11 e se a implementação a respeita. Se não houver fundamento, ajustar **esse tratamento** antes de ativar a versão 2.0.0. Não retirar medidas, IMC ou o diário de treino por padrão.

## 6. Retenção: prazos só com rotina real

| Categoria | Regra já comprovada | Decisão operacional antes de anunciar prazo novo |
|---|---|---|
| Medidas corporais | Apagadas na revogação do consentimento; evidência mínima do evento fica sem medidas. | Confirmar esse fluxo na publicação; sem novo prazo. |
| Marcas de anúncios e totais | Até 48 horas e 24 meses, respectivamente. | Confirmar os jobs de limpeza ativos. |
| Sincronização offline | Até 30 dias. | Manter o limite implementado. |
| Propostas comerciais | Sem descarte automático validado. | **Proposta interna:** 12 meses após o último contato; implementar e verificar a rotina antes de prometer ao público. |
| Atendimentos e denúncias | Sem prazo final validado. | **Proposta interna:** 24 meses após encerramento, com retenção maior só para caso aberto ou defesa de direitos; implementar antes de anunciar. |
| Compras, reembolsos e registros financeiros | Devem preservar obrigações legais, comprovantes e defesa de direitos. | Jurídico e contabilidade definem prazo, evento inicial e exceções; não inventar um número universal. |
| Aceites, consentimentos e histórico jurídico | Versões e evidências mínimas são preservadas. | Definir revisão e descarte compatíveis com direitos e exigências legais, sem alterar digests históricos. |
| Logs de acesso e segurança | O art. 15 do Marco Civil prevê seis meses para registros de acesso a aplicações nas condições legais. | Confirmar retenção real, região e acesso nos provedores; ajustar rotina se necessário. |

A Política de Privacidade informa apenas os prazos já ligados a rotinas ou a exigências legais, e descreve as demais retenções por finalidade. As propostas de 12 e 24 meses **não** são promessas públicas.

## 7. Condições de publicação e vendas

Configurar e conferir, fora do repositório, nome civil, CPF e endereço em `/informacoes-do-fornecedor`. Conferir o fluxo manual de estornos, devolução de saldo pago e compensação de período não prestado antes de vender. Aprovar textos, datas, versões e digests em operações separadas. A versão 1.5.0 e seus aceites não podem ser alterados. Publicar documentos **não** ativa ofertas, EvoCash ou a trava do fornecedor.
