# Ajustes dos prompts e do zoom — publicado e validado

Implementado sobre o commit 9bc50db; a publicação destes ajustes foi autorizada pelo responsável após a validação local. Conta GitHub Danielalveslira, repositório Danielalveslira/treinos_academia, branch main e remote origin confirmados sem divergência. Vercel: projeto treinos_academia, equipe danielalvesliras-projects, ID prj_WYVlCGYu021KZCrqfp62qRH2cbIE. As alterações preexistentes nos relatórios da publicação anterior e nos prompts estão fora deste release. Commit e SHA remoto: **9295d2aedcd9cadb82e2847080ab2abe229bb784**, push normal para origin/main. Vercel **dpl_57siGCxCebgYfHj3n5ZcTusYzH8E**, **READY / Production**, tempo até READY de 36,9 s; status GitHub success associado a esse deployment. Alias https://treinosacademia-ten.vercel.app. Nenhuma migration, Edge Function ou configuração Supabase reaplicada.

## Correções

- Aviso informativo com ícone e cor suave: “Instruções incompletas. Confira a execução antes de gerar.” Sem caixa de alerta.
- Com o perfil ativo carregado, INICIAL e FINAL podem ser copiados mesmo com instruções incompletas. A confirmação repetitiva de referência foi removida; o aviso de anexar START, as orientações do provedor e a referência obrigatória dentro de FINAL continuam. A cópia só entrega texto; não gera ou publica imagens.
- Prompt v2.2 preserva os dados literais disponíveis, conserva START quando identificado e explica quais detalhes de START/END precisam ser conferidos. Não inventa equipamento, postura ou movimento. Perfil visual V2 preservado.
- Zoom com Dialog existente: máximo de 560px no desktop, margens de 24px (16px no mobile), imagem inteira com object-fit:contain. CSS reserva cabeçalho de 64px, navegação mobile de 76px e safe areas; usa dvh para adaptar a altura útil. Sem listeners de resize/scroll/teclado adicionais. Não há campo de texto no zoom; foi validado também com viewport baixo, representando menos espaço disponível.
- X e Esc fecham; foco retorna explicitamente ao botão de abertura. Rolagem de fundo permanece bloqueada e o zoom reutiliza os mesmos arquivos/URLs, sem consultas adicionais do módulo.
- Upload, revisão humana, publicação e exclusão mantêm suas validações. Sem alterações em migrations, funções, Storage, financeiro ou dependências.

## Arquivos desta etapa

- src/components/exerciseVisuals/ExerciseVisualDetail.jsx
- src/components/exerciseVisuals/ExerciseVisualPreview.jsx
- src/styles/app.css
- src/utils/exerciseVisualPromptBuilder.js
- src/utils/exerciseVisualPromptBuilder.test.js
- src/pages/AdminExerciseVisuals.test.js
- scripts/verify-exercise-visuals-browser.mjs
- scripts/verify-exercise-visual-prompt-zoom.mjs
- Este relatório.

## Validação

Validação local anterior: 77 testes relevantes aprovados (builder, página, serviço e proteções de revisão). Na preparação desta publicação, a regressão geral passou com 1.912 testes JavaScript e 151 testes Edge/um skip preexistente. Os 16 cenários de navegador e os quatro fluxos de upload/revisão/histórico/exclusão foram repetidos e passaram. Lint zero erros/14 avisos preexistentes. Build aprovado, com aviso preexistente de chunk acima de 500kB.

Navegador real com todas as chamadas Supabase simuladas: 16 casos depois e 16 casos equivalentes antes, combinando 320/390/768/1366px × claro/escuro × instruções completas/incompletas. Cópia real pela área de transferência, avisos, referência START, X, Esc, retorno de foco, bloqueio de rolagem, margens, ausência de overflow e viewport reduzido a 420px passaram. As coordenadas gravadas confirmam centralização horizontal e na área útil. Zero erros de página/console. Também passaram quatro casos do fluxo completo de upload, aprovação deliberada, rejeição, histórico e exclusão/retry, somente com fixtures locais.

Comparação desktop 1366px: modal 640×689px antes → 560×609px depois, centro vertical ajustado à área abaixo do cabeçalho. Em 320px, largura 296px antes → 288px depois, corrigindo margens de 12px para 16px. Em 390px, as margens de 16px permitem uma imagem mais confortável sem ocupar a navegação.

Resultados e todos os PNGs ficam em /tmp/exercise-prompt-zoom/before e /tmp/exercise-prompt-zoom/after. A baseline anterior foi servida de uma cópia isolada do commit publicado; nenhuma alteração temporária foi feita no código atual para capturá-la. As imagens são fixtures sintéticas, não novas artes produzidas por IA.

## Screenshots antes/depois

| Caso | Antes | Depois |
|---|---|---|
| Prompts incompletos, mobile claro | [Antes](/tmp/exercise-prompt-zoom/before/390-light-incomplete-prompts.png) | [Depois](/tmp/exercise-prompt-zoom/after/390-light-incomplete-prompts.png) |
| Zoom mobile escuro | [Antes](/tmp/exercise-prompt-zoom/before/390-dark-complete-zoom.png) | [Depois](/tmp/exercise-prompt-zoom/after/390-dark-complete-zoom.png) |
| Zoom desktop claro | [Antes](/tmp/exercise-prompt-zoom/before/1366-light-complete-zoom.png) | [Depois](/tmp/exercise-prompt-zoom/after/1366-light-complete-zoom.png) |
| Zoom 320px | [Antes](/tmp/exercise-prompt-zoom/before/320-light-complete-zoom.png) | [Depois](/tmp/exercise-prompt-zoom/after/320-light-complete-zoom.png) |

Para reproduzir: iniciar Vite local na porta 55446 e executar `node scripts/verify-exercise-visual-prompt-zoom.mjs http://127.0.0.1:55446 after`. Requer Chromium instalado; o helper existente gera as fixtures em /tmp. O script aceita somente origem local e intercepta todas as requisições Supabase.

## Smoke de produção autorizado

Somente leitura de catálogo/versões e ações locais de cópia, zoom, histórico, seleção de arquivos para prévia (sem enviar) e refresh. Requisições de mutação de imagens, versões, publicação ou exclusão foram bloqueadas preventivamente no navegador de teste; nenhuma foi solicitada. Foram comparados os perfis de estilo, versões publicadas/arquivadas, referências de todo o catálogo ativo e os bytes da amostra publicada, todos preservados. Autenticação por sessão administrativa temporária, sem criar usuários, mudar senha ou enviar e-mail; encerramento exclusivo dessa sessão após o smoke, preservando as demais sessões.

Nenhuma migration, Edge Function ou configuração Supabase foi publicada. Credenciais, snapshots operacionais e screenshots ficam somente em /tmp, fora do commit. Evidências pós-deploy serão atualizadas no workspace sem outro deploy apenas documental.


## Resultado em produção

29 verificações concluídas, oito combinações 320/390/768/1366px × claro/escuro. Cópia real de INICIAL/FINAL com instruções completas e incompletas, aviso informativo 12px sem borda, referência START preservada, zoom compacto/centralizado/object-fit:contain, margens, X/Esc, foco, bloqueio de rolagem, ausência de novas consultas do zoom, histórico e proteção da versão publicada, seleção de arquivos apenas para prévia local, cancelamento sem envio e refresh passaram. Zero erros de console/página/HTTP e zero overflow.

A primeira tentativa do guard do teste classificou HEAD como mutação e bloqueou consultas de contagem, causando erros no console do teste. Corrigido somente o helper em /tmp para permitir HEAD; smoke completo repetido e aprovado. Não houve falha ou alteração adicional de produto, nem outro deploy.

V2 segue ativo; todos os perfis de estilo, versões publicadas/arquivadas, catálogo ativo e referências de mídia são idênticos ao snapshot anterior. START/END/miniatura da amostra permanecem idênticos em SHA-256. Nenhum arquivo ou versão existente foi excluído ou publicado. Fluxos de aprovação/rejeição/exclusão foram exercitados somente com fixtures locais, conforme a regra desta publicação de não modificar conteúdo em produção.

Evidência final sanitizada: EXERCISE_VISUAL_PROMPT_ZOOM_PUBLICACAO_EVIDENCIAS.json. Screenshots reais em /tmp/exercise-prompt-final, incluindo [zoom 320px escuro](/tmp/exercise-prompt-final/320-dark-zoom.png), [aviso 390px claro](/tmp/exercise-prompt-final/390-light-incomplete-prompts.png) e [zoom desktop claro](/tmp/exercise-prompt-final/1366-light-zoom.png). Esses artefatos e a atualização pós-deploy deste relatório ficam no workspace, fora do commit publicado, evitando um deploy adicional apenas documental. Sem pendências deste release.
