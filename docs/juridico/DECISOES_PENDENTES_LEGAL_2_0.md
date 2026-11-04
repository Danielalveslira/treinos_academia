# Decisões jurídicas e operacionais pendentes — 2.0.0

Esta lista separa os pontos que exigem evidência ou aprovação humana das correções técnicas já integradas. As minutas não estão aprovadas nem vigentes.

## Idade mínima e aferição

O cadastro atual exige 18 anos pela data de nascimento informada e não coleta documento ou biometria. A [Lei nº 15.211/2025](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15211.htm), o [Decreto nº 12.880/2026](https://www.gov.br/mj/pt-br/assuntos/arquivos-imprensa/sedigi/decretos-eca-digital.pdf) e as [orientações preliminares da ANPD](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-orientacoes-preliminares-e-cronograma-para-afericao-de-idade-no-ambiente-digital) exigem análise proporcional por serviço e risco. **Decisão necessária:** avaliação jurídica documentada sobre se a autodeclaração basta para as funções atuais e, caso não baste, qual mecanismo de mínima coleta pode ser usado. Não coletar CPF, documento, selfie ou biometria sem decisão específica.

## Analytics e métricas de anúncios

O app usa Vercel Analytics e Speed Insights; as métricas de anúncios são agregadas por campanha e têm um identificador temporário para deduplicação. O legítimo interesse do art. 7º, IX, da LGPD somente pode embasar dados pessoais **não sensíveis** após análise documentada de finalidade, necessidade, balanceamento e salvaguardas, conforme o [guia da ANPD](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-lanca-guia-orientativo-sobre-legitimo-interesse). Não usar medidas corporais ou inferências de saúde para analytics ou anúncios. **Decisão necessária:** inventário de dados efetivamente enviados aos provedores, avaliação de legítimo interesse e mecanismo efetivo de oposição. Se a base não se sustentar, alterar ou desativar a coleta antes de ativar a política 2.0.0.

**Inventário técnico confirmado no código (04/11/2026):** `src/main.jsx` carrega Web Analytics e Speed Insights em todas as rotas React. `src/utils/analyticsRedaction.js` retira query string e fragmento da URL antes do envio, inclusive tokens de recuperação e identificadores de pagamento; o caminho da rota, o referenciador e metadados do dispositivo ainda podem ser tratados pelo provedor. O [inventário do Web Analytics da Vercel](https://vercel.com/docs/analytics/privacy-policy) descreve URL, rota, referenciador, horário, localização aproximada e dispositivo; o [Speed Insights](https://vercel.com/docs/speed-insights/privacy-policy) descreve rota, URL, rede, navegador, dispositivo, país e Web Vitals. O caminho de uma página pode revelar interesses ou informações de saúde pelo contexto, mesmo sem query string. Não assumir anonimização jurídica apenas pela descrição comercial do serviço.

As métricas próprias de anúncios (`record_ad_events`) recebem identificador de usuário autenticado, ID do evento, tipo (impressão/clique), anúncio, posição e, nas comunidades, ID da comunidade. `sponsored_ad_event_marks` conserva esses dados para deduplicação até a limpeza horária após 48 horas; `sponsored_ad_daily_stats` conserva totais por dia, anúncio, posição e comunidade até a limpeza mensal após 24 meses. A oposição já é implementada por `sponsored_ad_metrics_opt_outs` e apaga os marcadores individuais. Verificar no ambiente publicado que os jobs `cleanup-sponsored-ad-marks` e `cleanup-sponsored-ad-stats` estão ativos. A base jurídica e eventual mecanismo de oposição para **Vercel Analytics/Speed Insights** continuam pendentes de avaliação específica; a oposição às métricas próprias não desativa automaticamente a coleta da Vercel.

## Retenção por categoria

Prazos comprovados no código: deduplicação de anúncios até 48 horas; totais agregados até 24 meses; sincronização offline até 30 dias. O art. 15 do Marco Civil da Internet prevê guarda de registros de acesso a aplicações por seis meses, sob as condições legais. A implementação do provedor deve ser confirmada. Medidas corporais são eliminadas ao revogar o consentimento; o histórico mínimo de consentimento continua como evidência.

| Categoria | Situação | Decisão necessária |
|---|---|---|
| Suporte e contatos comerciais | Não há prazo de descarte validado | Definir finalidade, prazo e rotina de eliminação; aplicar à tabela `commercial_leads` |
| Operações financeiras, reembolsos e casos financeiros | Conservação necessária, sem prazo final validado | Contabilidade/jurídico definirem prazos por base legal e evento inicial |
| Aceites, consentimentos e auditoria | Evidência mínima preservada, sem prazo final validado | Definir prazo e regra de anonimização ou eliminação compatível com defesa de direitos |
| Logs de acesso e segurança | Prazo mínimo legal aplicável; prática real não verificada | Confirmar região, retenção e acesso nos provedores; ajustar política e controles |

Não publicar prazo numérico além dos já comprovados sem política operacional que o cumpra. O histórico 1.5.0 e seus digests permanecem imutáveis.
