# Antes de publicar a versão jurídica 2.0.0

**Estado:** minutas revisadas para leitura e aprovação humana. A versão vigente continua sendo a **1.5.0**. As migrations `20261212000005` a `00008` já foram aplicadas; `supplierInfo.configured` permanece `false`. Nenhuma minuta foi ativada e vendas continuam bloqueadas.

## Regras já refletidas nos textos

- Cadastro somente a partir de 18 anos, sem CPF, documento, selfie ou biometria do usuário.
- Evolutus operado inicialmente por pessoa física, sem CNPJ; identificação completa na página `/informacoes-do-fornecedor`.
- Medidas corporais opcionais; revogação apaga as medidas guardadas sob o consentimento e mantém só a evidência mínima do evento.
- EvoCash por quantidade, pagamento pela InfinitePay, análise manual de reembolsos e respeito ao arrependimento de sete dias quando aplicável.
- Anúncios e vitrines por período, com aprovação, sem garantia de resultado e com tratamento de serviço não prestado.
- Versões `1.x`, digests, aceites e comprovantes históricos preservados.

## Evidências e decisões ainda necessárias

1. Confirmar os dados reais do fornecedor diretamente na hospedagem e conferir a página pública, sem pôr nome civil, CPF ou endereço no Git ou em logs.
2. Concluir e registrar a análise de [pequeno porte e encarregado](DISPENSA_DPO_PEQUENO_PORTE_2026-11-04.md).
3. Avaliar, por funcionalidade, a suficiência da autodeclaração de idade à luz do ECA Digital, sem impor coleta excessiva.
4. Validar a base do art. 11 da LGPD para dados derivados ou notas que possam revelar saúde.
5. Fechar o [mapa de transferências internacionais](TRANSFERENCIAS_INTERNACIONAIS_2026-11-04.md) com contratos aceitos e mecanismo válido por fluxo.
6. Documentar legítimo interesse e oposição para métricas próprias e Vercel Analytics/Speed Insights; suspender apenas a coleta opcional sem base suficiente.
7. Definir e implementar descarte de contatos comerciais e atendimentos; conferir retenção de logs e decisões legais/contábeis sobre financeiro e aceites. Não anunciar prazos que o sistema não cumpre.
8. Confirmar que atendimento, estornos e devolução de saldo pago conseguem cumprir os textos antes de habilitar cobranças.
9. Obter aprovação humana do texto completo, datas, versões e digests. Publicação e ativação são operações futuras distintas.

O detalhamento de cada ponto está em [Decisões pendentes](DECISOES_PENDENTES_LEGAL_2_0.md). O [procedimento de publicação](PROCEDIMENTO_PUBLICACAO_2_0.md) não é autorização para executá-lo neste PR.
