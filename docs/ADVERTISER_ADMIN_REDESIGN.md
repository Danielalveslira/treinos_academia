# Redesign da gestão de anunciantes

Implementação exclusivamente de frontend. Não altera RPCs, RLS, auditoria, titularidade, coleta, flags, agregados, exportações ou regras financeiras. Nenhuma migration ou publicação faz parte desta tarefa.

## Experiência administrativa

A aba segue **selecionar anunciante → visão geral → campanhas → usuários com acesso**.

- Cabeçalho com descrição, seletor identificado e **Novo anunciante**. Criação ocorre em Dialog do Primer; validação fica associada ao campo e a nova conta é selecionada após confirmação do servidor.
- Resumo compacto: nome, ativação, campanhas e acessos ativos. Ações de renomear e ativar/desativar ficam em **Ações da conta**.
- **Visualizar portal do anunciante** é identificado como prévia administrativa com a própria sessão do superadmin. Não simula outro usuário nem contorna o bloqueio de conta inativa.
- Campanhas vinculadas exibem identificação, situação e informações de período disponíveis nas APIs. Métricas abrem o relatório administrativo existente, inclusive para históricos/contas inativas.
- **Vincular campanha** carrega o catálogo global somente ao abrir o diálogo. Há pesquisa, seleção, conferência da empresa e confirmação explícita de que todo o histórico será vinculado permanentemente. Não há transferência, desvinculação ou exclusão.
- **Conceder acesso** pesquisa usernames cadastrados com pelo menos três caracteres, seleciona um usuário e confirma a permissão **Visualização**. Usuários ativos já encontrados na lista de acessos carregada aparecem desabilitados nos resultados. O banco continua decidindo autorização, unicidade e papel viewer.
- A lista mostra somente acessos ativos, com datas em pt-BR. Revogação e desativação pedem confirmação e explicam o bloqueio de novas leituras e a preservação do histórico. Desativar a conta não altera a veiculação dos anúncios.
- Loading, vazio, falha, acesso negado, operação em andamento e sucesso têm feedback próprio; notificações reutilizam `useToast`/`ToastFlash`.

## Arquivos e manutenção

- `AdvertiserAdmin.jsx`: catálogo paginado, seleção de conta e criação.
- `AdvertiserAccountPanel.jsx`: resumo, ações da conta, campanhas e acessos.
- `AdvertiserDialog.jsx`: Dialogs oficiais do Primer para formulários, escolha e confirmação.
- `useAdvertiserPage.js`: leitura administrativa por página, deduplicação, cancelamento lógico e descarte de falhas de autorização.
- `advertiserAdmin.js`: mensagens seguras e formatação de datas.
- `RowActionsMenu.jsx`: aceita rótulo e referência opcionais no gatilho, mantendo o comportamento padrão das demais telas; permite restauração de foco após fechar o diálogo.

Sem CSS novo ou dependências. Usa tokens do Primer, RadioGroup, FormControl, Dialog e os componentes existentes. Escape e Tab usam o gerenciamento de foco do Primer. Após revogar uma linha que sai da lista, o foco retorna a **Conceder acesso**; cancelar retorna ao gatilho original.

## Paginação e limites das APIs existentes

As RPCs retornam páginas de 100 registros e não devolvem totais. A UI carrega somente a primeira página de cada lista necessária, com **Carregar mais**; não usa `readCatalog` para baixar todos os anunciantes/campanhas/usuários.

O resumo é exato quando a lista está completa. Se uma página veio cheia e pode haver mais registros, identifica a contagem dos itens carregados; acessos revogados não entram na contagem de usuários autorizados. Nunca inventa um total global. A pesquisa de campanhas considera os itens já carregados e explica como ampliar os resultados; a RPC atual não oferece busca textual de campanhas no servidor. A pesquisa de username é feita no servidor e também paginada.

A API administrativa não devolve início de veiculação para todos os anúncios históricos. A UI exibe somente os metadados disponíveis, sem reconstruir datas ou materiais ausentes. A conferência de acesso já existente no diálogo usa a lista carregada; as constraints e a RPC existentes continuam impedindo vínculos de membro duplicados e papéis diferentes de viewer.

Trocar conta desmonta o painel anterior, oculta imediatamente seus dados e invalida respostas pendentes. Trocar a sessão desmonta toda a aba; mudar a busca invalida resultados e seleção anteriores. Um lock síncrono impede mutações duplicadas antes da atualização do estado React.

## Testes reproduzíveis

```sh
npm run lint
npm test
npm run build
node scripts/ad-metrics-browser-smoke.mjs
```

`useAdvertiserPage.test.js` cobre paginação limitada, duplo clique, consultas desabilitadas, troca de conta/sessão, respostas atrasadas, acesso negado e resposta malformada. `advertiserAdmin.test.js` cobre datas e mensagens de erro sem vazamento de detalhes técnicos.

O smoke usa RPCs sintéticas em Chromium e mantém as verificações anteriores do portal/CSV/PDF. Para a nova aba, cobre 320/375/768/1280 px e ambos os temas; ausência de formulários permanentes; foco, Escape e Tab nos diálogos; validação; criação e seleção; renomeação; vínculo e confirmação permanente; busca sem resultados; usuário já autorizado; concessão e revogação; cancelamento; desativação/reativação; erros e duplicação de envio; paginação de campanhas e acessos; carregamento/vazio inicial; corrida de respostas entre contas e acesso negado.

Capturas ficam em `/tmp/advertiser-admin-*` e `/tmp/advertiser-dialog-*`; o relatório do smoke fica em `/tmp/ad-v2-browser-results.json`. O harness inclui tokens, CSS, ThemeSync e o shell reais. É validação local de UX com APIs simuladas; não faz chamadas de mutação a produção nem substitui os testes existentes de autorização do banco.

## Resultados desta execução

- `npm test`: 2.109 aprovados, zero falhas/skips.
- Revalidação focada com `node --test --test-concurrency=1 src/features/adMetrics/hooks/useAdvertiserPage.test.js src/features/adMetrics/utils/advertiserAdmin.test.js src/components/RowActionsMenu.test.js src/pages/AdminSponsoredAds.test.js`: 13 aprovados.
- `node scripts/ad-metrics-browser-smoke.mjs`: aprovado. Inclui as oito combinações de largura/tema da aba, ciclo administrativo, cancelamento/erros, envio duplicado, corrida entre contas, acesso negado, paginação de campanhas e usuários revogados, vazio/carregamento inicial e regressões anteriores do portal.
- `npm run lint`: zero erros e 16 warnings preexistentes.
- `npm run build`: aprovado, mantendo o aviso existente sobre tamanho dos chunks compartilhados.
- Prettier nos componentes/hooks/utilitários alterados: aprovado.
- `git diff --check`: aprovado.

Nenhuma migration foi executada, nenhuma configuração de coleta foi alterada e nada foi publicado em produção. As duas exclusões de prompts que já existiam no workspace foram preservadas, sem fazer parte deste redesign.

## Autorização de publicação

Após a validação local descrita acima, o usuário autorizou publicar o redesign em produção. O release inclui somente frontend, testes e esta documentação; não exige migrations, mudanças nas RPCs ou alterações das flags de coleta.
