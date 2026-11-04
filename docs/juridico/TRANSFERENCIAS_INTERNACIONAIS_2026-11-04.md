# Transferências internacionais — evidência contratual necessária

**Estado:** não foi possível confirmar os contratos, as regiões reais nem os subprocessadores da conta Evolutus. Não declarar conformidade ou inexistência de transferência para qualquer fornecedor com base apenas no país de sua sede.

A [Resolução CD/ANPD nº 19/2024](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024) regula os mecanismos do art. 33 da LGPD. O prazo geral de 12 meses para incorporação das cláusulas-padrão brasileiras terminou em agosto de 2025. As SCC europeias **não são automaticamente equivalentes** às cláusulas-padrão da ANPD; a [ANPD informa o estado de reconhecimento de cláusulas estrangeiras](https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados).

| Serviço | Dados e fluxo a confirmar | Evidência exigida |
|---|---|---|
| Supabase | Banco, Auth, Storage e Edge Functions; região e subprocessadores | Região da instância, DPA aceito e mecanismo do art. 33 para cada fluxo internacional |
| Vercel, Analytics e Speed Insights | Hospedagem, logs e métricas de navegação | DPA aceito, subprocessadores, regiões e mecanismo aplicável |
| Resend | E-mails transacionais e metadados de entrega | DPA, subprocessadores, regiões e mecanismo aplicável |
| InfinitePay | Pagamentos e metadados financeiros | Termos aceitos, subprocessadores e eventual fluxo transfronteiriço |
| Web Push (Google, Apple, Mozilla, Microsoft, conforme navegador) | Metadados de entrega; conteúdo cifrado pelo protocolo | Mapa de fluxo, região, papel dos provedores e análise do mecanismo aplicável |

**Próxima decisão:** obter os documentos contratuais efetivos e um mapa de dados da operação; formalizar mecanismo válido por fluxo ou interromper o fluxo sem base suficiente. A Política de Privacidade 2.0.0 não deve ser ativada como declaração de conformidade internacional antes dessa verificação jurídica.
