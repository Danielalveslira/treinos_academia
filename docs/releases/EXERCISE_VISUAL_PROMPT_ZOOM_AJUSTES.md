# Ajustes dos prompts e do zoom — publicação autorizada

Implementado sobre o commit 9bc50db; a publicação destes ajustes foi autorizada pelo responsável após a validação local. Conta GitHub Danielalveslira, repositório Danielalveslira/treinos_academia, branch main e remote origin confirmados sem divergência. Vercel: projeto treinos_academia, equipe danielalvesliras-projects, ID prj_WYVlCGYu021KZCrqfp62qRH2cbIE. As alterações preexistentes nos relatórios da publicação anterior e nos prompts estão fora deste release. Commit, SHA remoto, READY e resultado do smoke serão registrados após o push autorizado.

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

Somente leitura de catálogo/versões e ações locais de cópia, zoom, histórico, seleção de arquivos para prévia (sem enviar) e refresh. Requisições de mutação de imagens, versões, publicação ou exclusão serão bloqueadas no navegador de teste. Serão comparados os perfis de estilo, versões publicadas/arquivadas, referências de todo o catálogo ativo e os bytes da amostra publicada. Autenticação por sessão administrativa temporária, sem criar usuários, mudar senha ou enviar e-mail; encerramento exclusivo dessa sessão após o smoke.

Nenhuma migration, Edge Function ou configuração Supabase será publicada. Credenciais, snapshots operacionais e screenshots ficam somente em /tmp, fora do commit. Evidências pós-deploy serão atualizadas no workspace sem outro deploy apenas documental.
