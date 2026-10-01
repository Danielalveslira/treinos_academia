# EVOLUTUS — Vitrine sem aprovação, canal único e descoberta na Home

**Tipo:** especificação executável para Claude/Codex  
**Destino:** `docs/prompts/current/EVOLUTUS_VITRINE_AUTOPUBLICACAO_CANAL_UNICO_HOME.md`  
**Objetivo:** simplificar a Vitrine V1 de profissionais e estabelecimentos, removendo aprovação administrativa prévia, centralizando atendimento e aproveitando a Home. Implementar e limpar código obsoleto sem perder segurança ou dados.

## 1. Regras do produto

1. **Uma única Vitrine por conta**, seja profissional ou estabelecimento/espaço. Reutilize o bloqueio transacional por UID existente; não permitir duplicação por troca de tipo, requisições concorrentes ou rotas alternativas. Quem já tem Vitrine edita a mesma.
2. **Publicação direta:** titular autenticado cria/publica e edita sem revisão do superadmin. Manter validação, aceite jurídico vigente e projeção pública sanitizada. Rascunho, quando existir, é escolha do titular, não fila de aprovação.
3. **Moderação posterior:** atendimento recebe denúncias; equipe autorizada analisa e pode suspender/despublicar quando cabível. Denúncia não gera suspensão automática. Remover aprovação obrigatória de criação/edição, **não** controles de segurança e moderação.
4. **Canal único:** denúncia de profissional ou estabelecimento, reclamações, recursos, dúvidas e pedidos de cancelamento passam pelo canal de atendimento/denúncias já existente. Não criar sistema ou painel paralelo. Preservar autosserviço de despublicação/exclusão de Vitrine e exclusão de conta.
5. **Home:** remover apenas “Ver profissionais” do menu hambúrguer autenticado. Inserir descoberta de profissionais e estabelecimentos abaixo do quadro principal/indicadores, onde ficava “Treinos recentes”. Preservar `/profissionais`, páginas individuais e “Minha Vitrine”.

## 2. Interface e navegação

- Home: seção compacta **“Encontre profissionais e lugares para treinar”**, alternância **Profissionais | Estabelecimentos**, cards com nome, categoria, cidade/UF, modalidades, avatar público elegível/fallback e botão “Ver vitrine”. Carregamento/estado vazio, mobile responsivo e “Ver todos” para o diretório filtrado. Reutilizar projeção e consultas existentes; evitar uma requisição por card.
- Minha Vitrine: oferecer criar apenas a quem não possui; aos demais, editar/publicar/despublicar a existente. Salvar/editar deve refletir na vitrine pública sem pendência de superadmin. Feedback claro de estados e falhas.
- Vitrine pública: CTA discreto **“Denunciar profissional”** ou **“Denunciar estabelecimento”** que abre o atendimento existente, com origem, tipo e `listingId` validados/preenchidos. Observar autenticação e privacidade já exigidas pelo canal.
- Painel administrativo: remover telas/botões/fila destinados **somente à aprovação prévia**; concentrar denúncias, recursos e medidas de moderação no atendimento existente. Não remover ferramentas necessárias para suspensão e auditoria.

## 3. Backend, segurança e dados

- Inventariar criação, draft, submit, review, publicação, projeção, edição e estados. Substituir o gate de aprovação por operações autorizadas de publicação imediata; projeção pública só pelo backend, com whitelist e validação de dados. Proteger titularidade, uma Vitrine/UID, concorrência, limites pertinentes, URLs, vínculo comunitário e exclusão de conta.
- Avatar: a ausência de aprovação da Vitrine **não** autoriza expor foto privada/pendente. Preservar consentimento específico, versão e estado elegível do avatar e fallback. Não copiar automaticamente foto da comunidade.
- Atendimento: integrar tipo de solicitação e referência de Vitrine ao serviço atual. Validar origem e IDs no servidor, manter isolamento dos tickets, permissões administrativas, antispam e histórico. Não criar coleção/Function duplicada apenas para denúncias da Vitrine.
- Limpeza: retirar estados e fluxos `pending_review`, `approved/rejected`, `review`, dados de submissão, Functions, componentes, rotas, índices, Rules e testes **somente quando comprovadamente exclusivos da aprovação de Vitrine**. Não retirar estados necessários a denúncia, suspensão, consentimento da foto ou auditoria. Atualizar imports, referências e testes.
- Legado: manter Vitrines já publicadas; não publicar automaticamente rascunhos/submissões pendentes antigas. Definir conversão segura dos estados após ação do titular e aceite válido. Não apagar registros históricos em massa nem excluir Functions remotas sem plano específico e verificação de dependências.

## 4. Jurídico

Revisar os Termos da Vitrine e referências associadas para descrever publicação direta, responsabilidade do titular, denúncia e moderação posterior, sem promessa de aprovação prévia. Preparar **nova versão e digest**; nunca sobrescrever documento imutável já aceito. Submeter texto final à aprovação humana antes de publicar ou exigir novos aceites. Nesta tarefa, não executar scripts jurídicos nem ativar ponteiros no Firestore.

## 5. Testes e critérios de aceite

- Titular cria uma Vitrine e edita/publica sem superadmin; tentativa de segunda Vitrine (inclusive tipo diferente e concorrência) falha.
- Apenas titular administra; leitor anônimo acessa só projeção pública; Vitrine suspensa/despublicada respeita visibilidade. Avatar sem autorização fica oculto.
- Denúncia de ambos os tipos chega ao atendimento existente com contexto correto, sem duplicidade de fluxos; permissões e proteção de dados mantidas.
- Home alterna os tipos e funciona no mobile; atalho redundante sai do hambúrguer, sem perder diretório ou “Minha Vitrine”.
- Migração não publica rascunhos antigos automaticamente; histórico de auditoria preservado.
- Executar frontend, Functions e Firestore/Storage Rules pertinentes, lint, build e `git diff --check`. Adicionar testes de regressão para lógica alterada. Não mascarar falhas enfraquecendo testes.

## 6. Execução e entrega

1. Ler o código real, localizar todas as referências e apresentar plano curto; **implementar** a mudança completa, sem auditoria genérica interminável.
2. Criar branch nova a partir da `main` atualizada; commits organizados e push ao origin. Preservar `docs/prompts/` e demais alterações não relacionadas.
3. **Não fazer merge na `main`, deploy Firebase/Vercel, publicação jurídica ou mutação de dados de produção.** Não alterar EvoCash, ledger, preços, IAM ou Scheduler sem necessidade comprovada.
4. Entregar SHA, arquivos alterados, funcionalidades removidas/retidas, testes, tratamento do legado, alterações jurídicas pendentes e plano de rollout (inclusive eventual remoção controlada de Functions/índices em produção).

**Pronto quando:** criação e edição de Vitrine não exigem superadmin; existe uma Vitrine por conta; denúncias passam pelo canal único; Home permite descobrir profissionais/estabelecimentos; não resta código ativo de aprovação prévia, sem comprometer consentimento, privacidade e moderação posterior.
