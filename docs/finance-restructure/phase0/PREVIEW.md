# Preview local

Em 27/10/2026 o servidor do workspace original foi iniciado com `npm run dev -- --host 0.0.0.0 --port 5173 --strictPort`.

Endereço solicitado: https://organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev/

Verificado: HTTP 200 no loopback em `/`, `/evocash` e `/admin/compras-evocash`; request com o Host exato do Codespaces também retornou 200. A URL externa retornou 302 para autenticação em `github.dev`. Acesso externo depende da sessão GitHub e das permissões da porta. Não foi alterada a visibilidade da porta.

História verificada: abrir a URL encaminhada → porta 5173 → Vite do workspace original → HTML da aplicação. A renderização em navegador autenticado e a execução de pagamentos não foram verificadas. O HTTP 200 das rotas protegidas é a entrega do shell, não prova de autorização administrativa.

Esta Fase 0 não modifica a interface financeira: as telas atuais continuam visíveis. O preview serve o workspace original, não o worktree de inventário em `/tmp/evolutus-finance-phase0`. Mudanças futuras de implementação deverão ser conectadas explicitamente ao servidor desta porta, mantendo os trabalhos anteriores preservados e usando ambiente financeiro de homologação.
