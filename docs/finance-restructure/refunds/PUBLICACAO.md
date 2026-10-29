# Publicação técnica de reembolsos

Em 29/10/2026 o usuário autorizou push, PR e, após aprovação e gates obrigatórios, integração técnica e implantação segura. A autorização substitui a restrição de publicação da entrega original; não aprova políticas comerciais/jurídicas nem habilita operações financeiras reais.

Ajuste final: texto principal e descrição expansível de EvoCash conforme solicitado. Removidos rótulos de versão interna e aprovação da interface. Política não aprovada permanece imutável no backend; sua redação não é publicada como contrato. A interface oferece informação geral dos direitos e corpo completo somente para política aprovada. Sem mudança financeira, de prazo, preço ou autorização.

As quatro migrations `20261207000001`–`20261207000004` são aditivas. Compras, checkout, vendas comerciais, liquidação e coleta não serão habilitados. Não há alteração de Edge Functions nesta branch: os contratos das funções InfinitePay existentes permanecem; as funções novas são RPCs PostgreSQL.

Evidências locais anteriores reaproveitadas. Regressão focada de texto e CI obrigatório verificam o ajuste final. Situação de PR, CI, banco e deployment será registrada após execução. Nenhuma transação financeira real de teste é autorizada.

PR [#89](https://github.com/Danielalveslira/treinos_academia/pull/89). O primeiro CI aprovou SQL e encontrou um falso positivo no scanner estático de EvoCoins: a proibição global de `p_action` confundia comandos administrativos de reembolso com recompensa. Corrigido o escopo do teste: todas as RPCs EvoCoins continuam obrigatoriamente sem argumentos, valores de recompensa seguem proibidos globalmente, e fixtures adversariais comprovam rejeição de ação escolhida pelo cliente nas três RPCs protegidas. Nenhum guard/RLS/RPC financeiro foi enfraquecido.

O texto final passou nas seis combinações de 320/390/1440 e claro/escuro, com política expansível, cópia exata, sem rótulos internos e sem overflow. Auditoria prévia de produção: 205 migrations, sete definições financeiras efetivas compatíveis com a main, zero divergências nos diagnósticos financeiros e todos os gates comerciais desligados. As cinco constraints `NOT VALID` já existentes pertencem ao histórico, não são removidas ou alteradas por este release. Backup privado consistente gerado com catálogo e checksum verificados; isso não constitui novo ensaio de restauração.
