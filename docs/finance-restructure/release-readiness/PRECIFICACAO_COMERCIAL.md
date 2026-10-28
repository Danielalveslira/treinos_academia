# Proposta comercial — nenhuma tarifa aprovada ou publicada

Todas as cifras abaixo são hipóteses para decisão do proprietário, sem promessa de audiência. Recomendação inicial: unidade simples de R$ 1 por EvoCash, preços de serviços versionados independentemente. Comparação: R$ 0,50 facilita pequenos pagamentos mas aumenta números; R$ 1 facilita leitura; R$ 2 reduz quantidade de créditos e aumenta custo em reais do mesmo serviço. Não há conversão com EvoCoins, saque, repasse, venda de fichas por terceiros ou renovação automática.

## Recarga proposta

| Parâmetro | Proposta para aprovação | Suporte/limitação |
|---|---|---|
| Unidade | 100 centavos | Preço inteiro versionado no backend |
| Compra mínima/máxima | 10 / 50 EvoCash | Quantidade configurável; nesta hipótese R$ 10–50 |
| Limite diário | 100 EvoCash | daily_quantity_limit; conferir janela efetiva no contrato antes da ativação |
| Limite total por usuário | 300 EvoCash | total_quantity_limit é cumulativo, não mensal |
| Cotação | 300 segundos | TTL configurável; confirmação usa snapshot original |
| Alteração de tarifa | Nova versão com comunicação prévia | Não reprecificar pedido existente; jurídico define prazo e tratamento de pendências |
| Margem/tributos/reserva | Pendente | Não inferir lucro do saldo pré-pago |

Limites monetários devem ser recalculados a cada versão de preço e respeitar os tetos técnicos do checkout. Sem configuração e aprovações completas, vendas permanecem desligadas. Não há limite mensal apresentado como disponível sem comprovação de implementação.

## Serviços — EvoCash por dia

| Serviço | Conservador (recomendação piloto) | Intermediário | Premium | Duração proposta | Capacidade/condição |
|---|---:|---:|---:|---|---|
| Vitrine | 1 | 2 | 3 | 1–30 dias | Proprietário, aprovação e limite editorial |
| Profissional | 1 | 2 | 3 | 1–30 dias | Um perfil por conta proposto |
| Estabelecimento | 2 | 3 | 5 | 1–30 dias | Cada recurso contrata separadamente |
| Comunidade, feed | 2 | 4 | 6 | 1–7 dias | 2 reservas simultâneas por contexto propostas |
| Home | 5 | 8 | 12 | 1–7 dias | 2 reservas simultâneas propostas |
| Global | 8 | 12 | 18 | 1–7 dias | Reserva atômica em todos os posicionamentos incluídos |
| Publicação impulsionada | 1 | 2 | 3 | 1–7 dias, condicionado | Somente se a origem durar todo o período |
| Comunidade impulsionada | 2 | 3 | 5 | 1–7 dias | Recurso próprio aprovado e elegível |

Banner de comunidade possui offering independente: proposta 3/5/8 por dia; não confundir com feed. Os três cenários são hipóteses de disposição a pagar e posicionamento, não projeções de alcance ou faturamento. Começar conservador somente depois das aprovações; reavaliar demanda e custos com dados lícitos, sem alterar contratos vigentes.

A publicação orgânica com duração de 24 h pode já ter menos de um dia restante no momento da compra: o contrato recusa período excedente. Manter essa modalidade indisponível enquanto não houver origem elegível e regra aprovada; não estender vida editorial para vender. Capacidade global compartilha inventário; não soma estoque independente. Redução de capacidade não pode invalidar reservas existentes.

## Limites administrativos propostos

Uma vitrine e 30 produtos por vitrine; um perfil profissional; três estabelecimentos por conta; duas campanhas simultâneas como política inicial. professional_listing_limits suporta limites por tipo/proprietário (zero pausa e NULL explicitamente ilimitado). Capacidade por placement/contexto e min/max de duração são configuráveis no motor. Limites de vitrine/produtos/campanhas devem ser conferidos contra controles efetivos antes da aprovação: não presumir que todos os tetos desta proposta já tenham configuração dedicada. Se faltar controle obrigatório, manter serviço desligado e abrir ajuste específico; este documento não adiciona regras em código.

## Taxas, custos e decisão

A [tabela pública InfinitePay](https://www.infinitepay.io/taxas) distingue produtos e prazos de recebimento; não representa o contrato do Evolutus. Não usar a taxa de maquininha como taxa do Checkout. Custos contratuais, parcelamento, tributos, infraestrutura, chargebacks e reserva de reembolsos continuam pendentes. Modelo: líquido = bruto × (1 − taxa contratual) − tarifa fixa − custos − reserva − tributos. Simulação puramente matemática com taxa hipotética de 4%: R$ 10/50/100 gerariam R$ 9,60/48/96 antes dos demais custos; não é taxa ofertada pelo provedor. Saldo ainda não consumido exige análise contábil e liquidez, não deve ser tratado como receita livre.

## Contratação e direitos do consumidor

Proposta operacional: período inicia na contratação válida; renovação antecipada acumula a partir do término vigente conforme motor; após expiração inicia novo período. Edição preserva snapshot aprovado; renovação não aprova revisão nem remove suspensão. Não contratar conteúdo inelegível. Cancelamento, indisponibilidade e compensação exigem análise administrativa e mecanismo auditado, sem reembolso automático por ausência de impressões. Reversão existente não deve ser apresentada como ferramenta de reembolso parcial arbitrário.

Jurídico deve validar início/contagem dos dias, arrependimento, reembolso, créditos não consumidos, suspensão, publicidade, finalidade/base legal/consentimento e retenção de métricas. Não criar renúncia a direitos legais por suposição. Responsáveis comercial, jurídico e contábil devem aprovar por escrito preços, limites, termos e adequação do pré-pago ao contrato do provedor. Nenhuma dessas decisões foi tomada pelo agente.
